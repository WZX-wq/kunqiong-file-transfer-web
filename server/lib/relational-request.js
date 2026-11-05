import { RelationalRequestStore } from '../db/request-store.js'
import { revokeAuthSession } from '../db/auth-session.js'
import { relationalAuditWriter } from '../db/request-audit-store.js'
import { liveResourceUsage } from '../db/on-demand-schema.js'
import { runWithDataContext, trackDataOperation } from './data-context.js'
import { AUTH_COOKIE_NAME, MAX_AUDIT_LOGS, storageRoot } from '../config.js'
import { cleanupTarget, drainCleanup } from '../db/cleanup-outbox.js'
import { clientAddress } from './request-security.js'
import { runtime } from '../state.js'
import { normalizeAuditLog, normalizeMetadata } from './metadata-normalizers.js'
import { readCookie, accountOrganizationForUser, isOrganizationManager, currentCollectionStatus, accountUsageForUser, validateShareRecipient, syncOrganizationMemberProfile, retainUserPaymentQueryCredentials, reconcileUserUpgradeOrders, upsertAccountUser } from '../services/account.js'
import { persistMetadata, flushMetadataWrites } from './metadata-store.js'
import { assertCollectionParticipant, participantIdentity } from '../services/entitlements.js'
import { keyedDigest } from './private-key.js'
import { adminSessionFromRequest, restoreDatabaseUploadSession } from '../services/shares.js'
import { parseDistributionRoster } from './distributions.js'
import { measureRequestPreparation } from './request-metrics.js'
import { readOwnedCollectionPage } from '../db/collection-list.js'

const activeCount = (data, userId, guestKey) => data.collections.filter(task => !task.cleanedAt
  && currentCollectionStatus(task) === 'active' && (userId ? task.ownerUserId === userId : !task.ownerUserId && task.ownerGuestKey === guestKey)).length

function decoded(value = '') { try { return decodeURIComponent(value) } catch { return value } }
function recipientValues(body = {}) {
  let assignments = body.assignments ?? body.pairs
  if (typeof assignments === 'string') { try { assignments = JSON.parse(assignments) } catch { assignments = [] } }
  let recipients = body.recipients ?? body.deliveryRecipients ?? []
  if (typeof recipients === 'string') recipients = recipients.split(/[\n,，;]/)
  return [
    body.target, body.userId, body.identity,
    ...(Array.isArray(recipients) ? recipients : []),
    ...parseDistributionRoster(body.roster ?? body.recipientList ?? '').rows.map(row => row.recipient),
    ...(Array.isArray(assignments) ? assignments.map(row => row.recipient || row.userId) : []),
  ].filter(value => typeof value === 'string')
}

function loadedUsage(data, id, team) {
  const totals = { shareBytes: 0, collectionBytes: 0, shareCount: 0, collectionCount: 0, fileCount: 0 }
  for (const [domain, kind] of [['shares', 'share'], ['collections', 'collection']]) for (const resource of data[domain]) {
    if (team ? !resource.teamResource || resource.teamOrganizationId !== id : resource.teamResource || resource.ownerUserId !== id) continue
    const usage = liveResourceUsage(resource, kind)
    totals[`${kind}Bytes`] += usage.bytes
    totals[`${kind}Count`] += usage.resourceCount
    totals.fileCount += usage.fileCount
  }
  return totals
}

export function createRelationalContext(pool, auditPool = pool) {
  const store = new RelationalRequestStore(pool)
  const context = {
    store, data: store.data,
    revokeSession(token) { return revokeAuthSession(pool, token) },
    deferLoginFollowup(session, profile = null) { context.loginFollowup = { token: session.id, profile } },
    finishResponse() {
      if (!context.loginFollowup || context.runtime.persistenceError) return
      const { token, profile } = context.loginFollowup
      context.loginFollowup = null
      const next = createRelationalContext(context.followupPool || pool)
      trackDataOperation(runWithDataContext(next, async () => {
        const session = await next.store.session(token)
        let user = session && next.data.users[session.user?.id]
        if (!session || session.revokedAt || new Date(session.expiresAt).getTime() <= Date.now() || user?.status !== 'active') return
        next.store.authorizedUserId = user.id
        next.store.authorizedSessionHash = keyedDigest(`session-cookie:${token}`)
        await next.store.account(user.id, { organizations: true, orders: true })
        if (profile) {
          await next.store.contacts(['email', 'phone'].filter(key => profile[key] && profile[key] !== user[key]).map(key => profile[key]))
          user = upsertAccountUser({ ...profile, loginMethods: [...(profile.loginMethods || []), 'oauth'] })
        }
        syncOrganizationMemberProfile(user)
        retainUserPaymentQueryCredentials(session, true)
        persistMetadata()
        await flushMetadataWrites()
        await reconcileUserUpgradeOrders(session, true)
        await flushMetadataWrites()
      }).catch(error => {
        console.error(JSON.stringify({ event: 'login_followup_failed', code: error.code || 'LOGIN_FOLLOWUP_FAILED' }))
      }))
    },
    runtime: { ...runtime, metadataReady: store.data, metadataWriteQueue: Promise.resolve(), persistenceError: null, metadataNeedsPersist: false },
    auditStore: relationalAuditWriter(auditPool, normalizeAuditLog, MAX_AUDIT_LOGS),
    totals: new Map(),
    deferCleanup(target, recursive, guard = null) {
      const task = cleanupTarget(storageRoot, target, recursive, guard)
      if (task.relative.startsWith('tmp/')) return false
      store.cleanupTasks.push(task)
      return true
    },
    async loadCollectionCount(userId, guestKey) {
      context.collectionCount = { userId, guestKey, total: await store.activeCollections(userId, guestKey) }
    },
    activeCollections(userId, guestKey, excludeId) {
      const queried = context.collectionCount
      if (!queried || queried.userId !== userId || queried.guestKey !== guestKey) return null
      return queried.total + activeCount(store.data, userId, guestKey) - activeCount(store.base, userId, guestKey)
        - (store.data.collections.some(task => task.id === excludeId && activeCount({ collections: [task] }, userId, guestKey)) ? 1 : 0)
    },
    async loadUsage(id, team = false) { if (id) context.totals.set(`${team}:${id}`, await store.usage(id, team)) },
    usage(id, team = false) {
      const totals = context.totals.get(`${team}:${id}`)
      if (!totals) return null
      const before = loadedUsage(store.base, id, team), after = loadedUsage(store.data, id, team)
      return Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, value + after[key] - before[key]]))
    },
    persist() {
      if (context.runtime.persistenceError) throw context.runtime.persistenceError
      context.runtime.metadataWriteQueue = context.runtime.metadataWriteQueue.then(() => store.commit()).catch(error => {
        context.runtime.persistenceError = error.status ? error : Object.assign(new Error('数据保存失败，请稍后重试'), { status: 503, code: 'METADATA_WRITE_FAILED' })
        console.error(JSON.stringify({ event: 'relational_request_write_failed', code: error.code || 'DATABASE_WRITE_FAILED' }))
      })
      trackDataOperation(context.runtime.metadataWriteQueue)
    },
    flushAudit() { return context.auditStore.flush() },
    async loadAccount(id, login = false) {
      // Login only needs identity, active sessions and the roster profile that
      // createAuthSession updates. Orders, settings and usage load on their APIs.
      await store.account(String(id), { sessions: login, organizations: !login, settings: !login })
      if (login) return
      await store.organizationGraph()
      await context.loadUsage(String(id))
    },
    async publicationExists(predicate) {
      // After a lost COMMIT acknowledgement, inspect only resources this request
      // could have published. Never reload the whole database to decide rollback.
      const probe = new RelationalRequestStore(pool)
      try {
        await probe.by('kq_resource', 'legacy_id', [...store.data.shares, ...store.data.collections].map(item => item.id || item.token))
        probe.hydrate()
        return Boolean(predicate(probe.data))
      } catch { return null }
    },
    normalize() {
      Object.assign(store.data, normalizeMetadata(store.data))
      // Normalization is a view adaptation, not a reason to rewrite records on a read.
      store.base = structuredClone(store.data)
    },
  }
  store.didCommit = (before, after, { cleanupQueued } = {}) => {
    // Cleanup failure does not turn an already committed API operation into an
    // error. The durable outbox is retried by periodic maintenance.
    if (cleanupQueued) trackDataOperation(drainCleanup(pool, storageRoot).catch(error => {
      console.error(JSON.stringify({ event: 'file_cleanup_deferred', code: error.code || 'CLEANUP_FAILED' }))
    }))
    if (context.collectionCount) {
      const count = context.collectionCount
      count.total += activeCount(after, count.userId, count.guestKey) - activeCount(before, count.userId, count.guestKey)
    }
    for (const [key, totals] of context.totals) {
      const separator = key.indexOf(':')
      const team = key.slice(0, separator) === 'true', id = key.slice(separator + 1)
      const previous = loadedUsage(before, id, team), next = loadedUsage(after, id, team)
      context.totals.set(key, Object.fromEntries(Object.entries(totals).map(([name, value]) => [name, value + next[name] - previous[name]])))
    }
  }
  store.beforeCommit = async (connection, changes) => {
    if (!changes.some(change => change.table === 'kq_resource' && !change.deleted)) return
    for (const change of changes.filter(change => change.rebased && !change.deleted)) {
      const latest = store.base.collections.find(task => (task.id || task.token) === change.key)
      const identities = new Set((latest?.submissions || []).map(participantIdentity))
      for (const submission of change.value.submissions || []) if (!identities.has(participantIdentity(submission))) {
        assertCollectionParticipant({ ...change.value, submissions: change.value.submissions.filter(item => item.id !== submission.id) }, submission)
      }
    }
    for (const change of changes.filter(change => change.table === 'kq_resource' && !change.deleted && change.value.teamResource)) {
      if (await store.conflictingTeamPaths(change.value.teamOrganizationId, change.value.files || [], connection, change.key)) {
        throw Object.assign(new Error('团队空间中已存在相同路径的文件'), { status: 409, code: 'TEAM_PATH_CONFLICT' })
      }
    }
    for (const [key, expected] of context.totals) {
      const separator = key.indexOf(':')
      const team = key.slice(0, separator) === 'true', id = key.slice(separator + 1)
      if (!changes.some(change => change.table === 'kq_resource' && [change.value,
        [...store.base.shares, ...store.base.collections].find(resource => (resource.id || resource.token) === change.key)]
        .some(resource => resource && (team ? resource.teamResource && resource.teamOrganizationId === id : !resource.teamResource && resource.ownerUserId === id)))) continue
      const actual = await store.usage(id, team, connection)
      if (Object.keys(expected).some(name => actual[name] !== expected[name])) {
        if (!team && changes.some(change => change.rebased && change.value.ownerUserId === id)) {
          context.totals.set(key, actual)
          const usage = accountUsageForUser(id)
          if (usage.usedBytes <= usage.totalBytes) continue
          throw Object.assign(new Error('存储空间不足，请清理文件后重试'), { status: 507, code: 'CAPACITY_EXCEEDED' })
        }
        throw Object.assign(new Error('空间用量已更新，请重试本次操作'), { status: 409, code: 'CAPACITY_CHANGED' })
      }
    }
    if (context.collectionCount) {
      const count = context.collectionCount
      if (await store.activeCollections(count.userId, count.guestKey, connection) !== count.total) {
        throw Object.assign(new Error('收集任务数量已更新，请重试'), { status: 409, code: 'COLLECTION_COUNT_CHANGED' })
      }
    }
  }
  // 提交重试钩子：事务因容量/收集数量冲突回滚后，用数据库最新用量刷新本请求
  // 的预期值，下一次尝试才能通过 beforeCommit 的乐观校验。
  store.refreshConflictState = async () => {
    for (const [key] of context.totals) {
      const separator = key.indexOf(':')
      const team = key.slice(0, separator) === 'true'
      const id = key.slice(separator + 1)
      context.totals.set(key, await store.usage(id, team))
    }
    if (context.collectionCount) {
      context.collectionCount.total = await store.activeCollections(context.collectionCount.userId, context.collectionCount.guestKey)
    }
  }
  return context
}

async function loadRouteData(context, req) {
  const { store } = context
  const pathname = req.path.toLowerCase()
  const readOnly = ['GET', 'HEAD'].includes(req.method)
  const resourceRead = readOnly && /^\/api\/(?:shares|collections)(?:\/|$)/.test(pathname)
  const smallRead = resourceRead || (readOnly && ['/api/runtime-config', '/api/guest/quota'].includes(pathname))
  // OAuth state is browser-bound and independent of the current SQL session.
  // An unavailable/old session must not prevent starting or completing login.
  if (['/api/auth/login', '/auth/callback', '/auth/pending', '/auth/progress.js', '/api/auth/progress'].includes(pathname)) { context.normalize(); return }
  // Logging out is a credential revocation, independent of orders, teams,
  // runtime configuration and storage usage. The route awaits its SQL write.
  if (pathname === '/api/auth/logout' && req.method === 'POST') { context.normalize(); return }
  const authView = pathname === '/api/auth/me' && req.method === 'GET' ? req.get('X-Kunqiong-Auth-View') : ''
  if (authView !== 'identity') await store.config()
  const session = await store[authView === 'identity' ? 'identity' : 'session'](readCookie(req, AUTH_COOKIE_NAME))
  const userId = session && !session.revokedAt && new Date(session.expiresAt).getTime() > Date.now() ? session.user?.id : ''
  if (pathname === '/api/account/collections' && req.method === 'GET') {
    context.collectionPage = await readOwnedCollectionPage(store.pool, userId, req.query)
    context.normalize()
    return
  }
  if (authView === 'identity' || authView === 'summary') {
    if (userId) {
      store.authorizedUserId = userId
      store.authorizedSessionHash = keyedDigest(`session-cookie:${session.id}`)
      if (authView === 'summary') await store.accountSummary(userId)
    }
    context.normalize()
    return
  }
  const personalList = /^\/api\/account\/(records|messages|notification-settings)(?:\/|$)/.test(pathname)
  if (userId) {
    store.authorizedUserId = userId
    store.authorizedSessionHash = keyedDigest(`session-cookie:${session.id}`)
  }
  // Resource views need the viewer identity and the requested resource graph,
  // not the viewer's unrelated teams, settings, sessions and storage totals.
  // HEAD preview authorization has exactly the same read requirements as GET.
  if (userId && !smallRead) {
    await store.account(userId, {
      organizations: !personalList,
      // Preferences need their saved row and write version on both GET and PUT.
      // Omitting it makes an update look like an insert and falsely conflicts.
      settings: !personalList || pathname.endsWith('/messages') || pathname.endsWith('/notification-settings'),
      sessions: !personalList && !readOnly,
      orders: pathname === '/api/account/workspace' && req.method === 'GET' ? 10 : /upgrade|workspace|logout/.test(pathname),
      messages: false,
      records: req.method === 'PUT' && /\/records(?:\/|$)/.test(pathname),
      resources: /\/file-cleanup(?:\/|-|$)/.test(pathname),
    })
    if (pathname === '/api/account/messages' && req.method !== 'GET') {
      store.loadedMailboxes.add(userId)
      store.data.messages[userId] ??= []; store.base.messages[userId] ??= []
    }
    if (pathname === '/api/account/records' && ['POST','DELETE'].includes(req.method)) {
      const ids = req.method === 'DELETE' ? req.body?.ids : (req.body?.records || [req.body?.record]).map(record => record?.id)
      if (Array.isArray(ids) && ids.length <= 200) {
        const owner = [...store.rows.get('kq_user').values()].find(row => row.legacy_id === userId)
        await store.select('kq_account_record', `user_id = ? AND legacy_id IN (${ids.map(() => '?').join(',') || 'NULL'})`, [owner.id, ...ids.map(id => `${userId}:${id}`)])
        store.hydrate()
      }
    }
    if (req.method === 'GET' && /^\/api\/account\/(records|messages)$/.test(pathname)) {
      if (pathname.endsWith('messages') && req.query.summary === '1') {
        const owner = [...store.rows.get('kq_user').values()].find(row => row.legacy_id === userId)
        const [[summary]] = await store.pool.query('SELECT COUNT(*) AS total, SUM(read_at IS NULL) AS unread FROM kq_message WHERE user_id = ?', [owner.id])
        context.messageSummary = { total: Number(summary.total), unreadCount: Number(summary.unread || 0) }
      } else context.pagination = pathname.endsWith('records') && req.query.page
        ? await store.recordList(userId, req.query)
        : await store.accountPage(userId, pathname.endsWith('records') ? 'records' : 'messages', { cursor: req.query.cursor, limit: req.query.limit || 50 })
    }
    const message = req.path.match(/^\/api\/account\/messages\/([^/]+)$/)
    if (message) {
      const owner = [...store.rows.get('kq_user').values()].find(row => row.legacy_id === userId)
      await store.select('kq_message', 'user_id = ? AND legacy_id = ?', [owner.id, decoded(message[1])])
      store.hydrate()
    }
    if (!personalList) await store.organizationGraph({ members: /\/(?:team|workspace)(?:\/|$)/.test(pathname) })
    const organization = accountOrganizationForUser(userId)
    const orgRow = organization && [...store.rows.get('kq_organization').values()].find(row => row.legacy_id === organization.id)
    const options = { cursor: req.query.cursor, limit: req.query.limit || 50 }
    if (pathname === '/api/account/team/overview' && req.method === 'GET' && orgRow) {
      context.memberUsage = await store.teamMemberUsage(organization.id)
      if (req.query.summary !== '1') context.pagination = req.query.page
        ? await store.teamResourcePage(orgRow, userId, req.query, isOrganizationManager(organization, userId) ? null : share => validateShareRecipient(share, session.user).ok)
        : await store.page('kq_resource', 'organization_id = ? AND team_resource = 1 AND deleted_at IS NULL AND resource_kind = ?', [orgRow.id, 'share'], options)
    }
    if (pathname === '/api/account/trash') {
      const user = [...store.rows.get('kq_user').values()].find(row => row.legacy_id === userId)
      if (req.method === 'GET') context.pagination = await store.page('kq_resource', 'owner_user_id = ? AND team_resource = 0 AND deleted_at IS NOT NULL', [user.id], options)
      else await store.select('kq_resource', 'owner_user_id = ? AND team_resource = 0 AND deleted_at IS NOT NULL', [user.id])
    }
    const trashResource = req.path.match(/^\/api\/account\/trash\/(share|collection)\/([^/]+)/i)
    if (trashResource) await store.resource({ kind: trashResource[1], id: decoded(trashResource[2]) })
    if (orgRow && pathname === '/api/account/team/trash') {
      if (req.method === 'GET') context.pagination = await store.page('kq_resource', 'organization_id = ? AND team_resource = 1 AND deleted_at IS NOT NULL', [orgRow.id], options)
      else await store.select('kq_resource', 'organization_id = ? AND team_resource = 1 AND deleted_at IS NOT NULL', [orgRow.id])
    }
    const teamResource = req.path.match(/^\/api\/account\/team\/(?:resources|trash)\/([^/]+)/i)
    if (teamResource) await store.resource({ kind: 'share', id: decoded(teamResource[1]) })
    if (orgRow && pathname === '/api/account/workspace/dissolve') await store.organizationGraph({ resources: true })
    if (!personalList) {
      await context.loadUsage(userId)
      for (const org of Object.values(store.data.organizations)) await context.loadUsage(org.id, true)
    }
    await store.recordResources()
  }

  const share = req.path.match(/^\/api\/shares\/(manage|lookup|token)\/([^/]+)/i)
  const download = req.path.match(/^\/api\/shares\/([^/]+)\/(?:files|download)/i)
  const collection = req.path.match(/^\/api\/collections\/(?:manage\/([^/]+)|([^/]+))/i)
  if (share) await store.resource({ kind: 'share', [share[1].toLowerCase() === 'manage' ? 'manageToken' : share[1].toLowerCase() === 'lookup' ? 'code' : 'id']: decoded(share[2]) })
  if (download) await store.resource({ kind: 'share', id: decoded(download[1]) })
  if (collection) await store.resource({ kind: 'collection', manageToken: decoded(collection[1]), token: decoded(collection[2]) })
  const distribution = req.path.match(/^\/api\/distributions\/([^/]+)/i)
  if (distribution && userId && distribution[1] !== 'preview') {
    const rows = await store.by('kq_distribution_batch', 'legacy_id', [decoded(distribution[1])])
    await store.by('kq_resource', 'id', rows.map(row => row.share_resource_id))
  }
  if (pathname === '/api/distributions' && userId) {
    const owner = [...store.rows.get('kq_user').values()].find(row => row.legacy_id === userId)
    const key = req.get('Idempotency-Key') || req.body?.idempotencyKey
    if (owner && key) await store.select('kq_distribution_batch', 'owner_user_id = ? AND idempotency_key = ?', [owner.id, String(key)])
  }
  const organization = req.path.match(/^\/api\/organizations\/([^/]+)/i)
  if (organization) { await store.by('kq_organization', 'slug', [decoded(organization[1])]); store.hydrate(); await store.organizationGraph({ members: Boolean(userId) }) }

  if (pathname.startsWith('/api/admin/') && adminSessionFromRequest(req)) {
    if (/\/overview$/.test(pathname)) await store.adminOverview()
    if (pathname === '/api/admin/impersonate' && typeof req.body?.userId === 'string') {
      await store.account(req.body.userId.trim(), { sessions: true, orders: true, organizations: true, settings: true })
      await store.organizationGraph()
      await context.loadUsage(req.body.userId.trim())
    }
    const target = req.path.match(/^\/api\/admin\/users\/([^/]+)/i)
    if (target) { await store.account(decoded(target[1]), { sessions: true, organizations: true, resources: true }); await store.organizationGraph({ members: true }) }
    const resource = req.path.match(/^\/api\/admin\/resources\/(share|collection)\/([^/]+)/i)
    if (resource) { await store.resource({ kind: resource[1].toLowerCase(), id: decoded(resource[2]) }); await store.resourceRecords() }
  }

  if (userId && pathname === '/api/account/workspace/member-search' && isOrganizationManager(accountOrganizationForUser(userId), userId)) {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    if (query.length >= 3 && query.length <= 160 && !/[\u0000-\u001f\u007f]/.test(query)) {
      // Public response masking and authorization stay in the route. Only candidate
      // rows matching this search enter the request, rather than every user.
      const escaped = query.replace(/[\\%_]/g, '\\$&')
      await store.select('kq_user', '(legacy_id = ? OR email = ? OR phone = ? OR username LIKE ? OR nickname LIKE ?)', [query, query, query, `%${escaped}%`, `%${escaped}%`], store.pool, store.rows, { limit: 20 })
    }
  }

  await context.loadInput(req)
  const upload = req.path.match(/^\/api\/upload-sessions\/([^/]+)/i)
  if (upload) {
    const manifest = await restoreDatabaseUploadSession(decoded(upload[1]), { manifestOnly: true })
    if (manifest) {
      if (manifest.collectionToken) await store.resource({ kind: 'collection', token: manifest.collectionToken })
      if (manifest.ownerUserId) await store.account(manifest.ownerUserId, { organizations: true })
      if (manifest.organizationId) await store.by('kq_organization', 'legacy_id', [manifest.organizationId])
      store.hydrate()
      if (manifest.mode === 'team_resource') await store.organizationGraph()
      // Publication identity survives restarts; check the owner's relevant domain.
      await store.uploadPublication(decoded(upload[1]))
      await store.resourceGraph()
      await restoreDatabaseUploadSession(decoded(upload[1]))
    }
  }
  if (!userId && /\/(guest|shares|collections|upload-sessions)(?:\/|$)/.test(pathname)) await store.guest(`ip:${clientAddress(req)}`)
  if (pathname === '/api/collections' && req.method === 'POST') await context.loadCollectionCount(userId || '', userId ? '' : `ip:${clientAddress(req)}`)
  if (req.method === 'PATCH' && /^\/api\/collections\/manage\//.test(pathname)) {
    const task = store.data.collections.find(item => item.manageToken === decoded(collection?.[1]))
    if (task) await context.loadCollectionCount(task.ownerUserId || '', task.ownerGuestKey || '')
  }
  await store.resourceGraph()
  if (/\/account\/(?:workspace|team)(?:\/|$)/.test(pathname) && !pathname.endsWith('/member-search')) {
    await store.notifications(req.method === 'GET' ? [userId].filter(Boolean) : Object.keys(store.data.users))
  }
  if (/^\/(?:api\/shares|api\/collections|api\/upload-sessions|api\/distributions)/.test(pathname) && (!readOnly || /download/.test(pathname))) {
    const notify = [...new Set([
      ...Object.keys(store.data.users),
      ...store.data.shares.map(item => item.ownerUserId), ...store.data.collections.map(item => item.ownerUserId),
    ].filter(Boolean))]
    await store.notifications(notify)
    for (const id of new Set([...store.data.shares, ...store.data.collections].map(resource => resource.ownerUserId).filter(Boolean))) {
      if (!context.totals.has(`false:${id}`)) await context.loadUsage(id)
    }
    for (const org of Object.values(store.data.organizations)) if (!context.totals.has(`true:${org.id}`)) await context.loadUsage(org.id, true)
  }
  context.normalize()
}

export function relationalDataMiddleware(pool, authPool = pool, maintenancePool = pool) {
  return (req, res, next) => {
    const publicPage = req.path.match(/^\/(?:e\/[^/]+\/)?(share|collect)\/([^/]+)\/?$/i)
    if (!/^\/(?:api|auth)(?:\/|$)/i.test(req.path)) {
      if (!publicPage || publicPage[2] === 'manage') return next()
      const context = createRelationalContext(pool, maintenancePool)
      return runWithDataContext(context, async () => {
        try {
          await context.store.resource({ kind: publicPage[1].toLowerCase() === 'share' ? 'share' : 'collection',
            [publicPage[1].toLowerCase() === 'share' ? 'id' : 'token']: decoded(publicPage[2]) })
        } catch {
          // The application shell remains available while this resource's API
          // reports any database error. Static pages never need a full snapshot.
        }
        next()
      })
    }
    const authentication = /^\/auth\/(?:callback|pending)$/.test(req.path) || /^\/api\/auth\/(?:login|logout)$/.test(req.path)
      || (req.path === '/api/auth/me' && req.get('X-Kunqiong-Auth-View') === 'identity')
    const context = createRelationalContext(authentication ? authPool : pool, maintenancePool)
    context.followupPool = maintenancePool
    if (req.path === '/auth/callback') context.store.commitAttemptLimit = 3
    res.once('finish', () => context.finishResponse())
    context.loadInput = async (request) => {
      const values = recipientValues(request.body)
      if (values.length) {
        await context.store.contacts(values)
        await context.store.notifications(Object.keys(context.store.data.users))
      }
      if (request.body?.mode === 'team_resource' || request.query?.mode === 'team_resource') await context.store.organizationGraph()
      const distributionKey = request.get('Idempotency-Key') || request.body?.idempotencyKey
      if (request.path === '/api/distributions' && distributionKey && context.store.authorizedUserId) {
        const user = [...context.store.rows.get('kq_user').values()].find(row => row.legacy_id === context.store.authorizedUserId)
        if (user) await context.store.select('kq_distribution_batch', 'owner_user_id = ? AND idempotency_key = ?', [user.id, String(distributionKey)])
      }
      if (/\/workspace\/members/.test(request.path)) {
        for (const id of Object.keys(context.store.data.users)) await context.store.account(id, { organizations: true })
        await context.store.organizationGraph()
        await context.store.notifications(Object.keys(context.store.data.users))
      }
      if (/\/auth\/code$|\/account\/bind$/.test(request.path)) await context.store.verification(request.body?.target)
      const token = request.body?.collectionToken
      if (typeof token === 'string') await context.store.resource({ kind: 'collection', token })
      const records = request.body?.records || (request.body?.record ? [request.body.record] : [])
      if (Array.isArray(records)) {
        await context.store.recordReferences(records)
      }
    }
    req.dataContext = context
    runWithDataContext(context, () => measureRequestPreparation(() => loadRouteData(context, req)).then(() => next(), next))
  }
}
