import { isDeepStrictEqual } from 'node:util'
import { keyedDigest } from '../lib/private-key.js'
import { decodeProtected, identityKey, readRelationalState, synchronizeRelationalMetadata } from './relational-store.js'
import { writeResourceUsage } from './on-demand-schema.js'
import { enqueueCleanup } from './cleanup-outbox.js'
import { hydrateRows } from './normalized-codec.js'
import { changeLockKeys, lockWriteScope } from './write-locks.js'
import { MAX_ACCOUNT_MESSAGES, MAX_ACCOUNT_RECORDS } from '../config.js'
import { filePathDigest } from './file-path-key.js'
import { readAdminOverview } from './admin-read-model.js'
import { readVersionedRows } from './versioned-read-cache.js'
import { commitAttempts, commitRetryDelay, isRetryableCommitError, isTransactionConnectionError } from './commit-retry.js'

const TABLES = [
  'kq_user', 'kq_organization', 'kq_organization_member', 'kq_ownership_handover',
  'kq_resource', 'kq_resource_file', 'kq_share_config', 'kq_collection_task',
  'kq_collection_submission', 'kq_submission_file', 'kq_distribution_batch',
  'kq_distribution_assignment', 'kq_auth_session', 'kq_verification_code',
  'kq_upgrade_order', 'kq_message', 'kq_user_setting', 'kq_account_record',
  'kq_guest_usage', 'kq_system_setting',
]
// 分页游标固定索引：调用方只按 user_id 前缀过滤 + id 倒序，避免优化器误选
// 带 filesort 的旧索引（见 docs/PERFORMANCE-数据库压测报告.md 的 EXPLAIN）。
const PAGE_INDEX_HINTS = {
  kq_account_record: 'idx_records_owner_page',
  kq_message: 'idx_messages_owner_page',
}
const ARRAYS = {

  shares: ['kq_resource', item => String(item.id || item.token)],
  collections: ['kq_resource', item => String(item.id || item.token)],
  distributions: ['kq_distribution_batch', item => String(item.id)],
  sessions: ['kq_auth_session', item => keyedDigest(`session-id:${item.id}`).slice(0, 120)],
  verificationCodes: ['kq_verification_code', item => String(item.id)],
  upgradeOrders: ['kq_upgrade_order', item => String(item.id)],
}
const MAPS = { users: 'kq_user', organizations: 'kq_organization', guestUsage: 'kq_guest_usage' }
const USER_LISTS = { messages: 'kq_message', records: 'kq_account_record' }
const emptyRows = () => new Map(TABLES.map(table => [table, new Map()]))
const placeholders = values => values.map(() => '?').join(', ')
const parseJson = value => typeof value === 'string' ? JSON.parse(value) : structuredClone(value)
const conflict = () => Object.assign(new Error('数据已被其他请求更新，请刷新后重试'), { status: 409, code: 'DATA_CONFLICT' })

export function emptyRequestData() {
  return {
    users: {}, organizations: {}, shares: [], collections: [], distributions: [], sessions: [],
    verificationCodes: [], upgradeOrders: [], messages: {}, notificationSettings: {}, records: {},
    guestUsage: {}, systemConfig: {}, collectionTemplates: [], auditLogs: [], auditStorage: 'mysql-v1',
  }
}

function entities(data) {
  const result = new Map()
  const add = (table, key, value, domain, owner = null) => result.set(`${table}:${key}`, { table, key, value, domain, owner })
  for (const [domain, [table, key]] of Object.entries(ARRAYS)) for (const value of data[domain] || []) add(table, key(value), value, domain)
  for (const [domain, table] of Object.entries(MAPS)) for (const [id, value] of Object.entries(data[domain] || {})) {
    add(table, domain === 'guestUsage' ? keyedDigest(`guest-usage:${id}`) : id, value, domain, id)
  }
  for (const [domain, table] of Object.entries(USER_LISTS)) for (const [owner, list] of Object.entries(data[domain] || {})) {
    for (const value of list) add(table, domain === 'records' ? `${owner}:${value.id}` : `${owner}:${value.id}`, value, domain, owner)
  }
  for (const [owner, value] of Object.entries(data.notificationSettings || {})) add('kq_user_setting', owner, value, 'notificationSettings', owner)
  for (const key of ['systemConfig', 'collectionTemplates']) add('kq_system_setting', key, data[key], key)
  return result
}

function put(delta, entry) {
  const { domain, value, owner } = entry
  if (ARRAYS[domain]) delta[domain].push(value)
  else if (MAPS[domain]) delta[domain][owner] = value
  else if (USER_LISTS[domain]) (delta[domain][owner] ??= []).push(value)
  else if (domain === 'notificationSettings') delta.notificationSettings[owner] = value
  else delta[domain] = value
}

// One instance belongs to one request/job. Only explicit key/owner predicates
// enter this object; it is never used as a replacement for a complete database.
export class RelationalRequestStore {
  constructor(pool) {
    this.pool = pool
    this.rows = emptyRows()
    this.data = emptyRequestData()
    this.base = emptyRequestData()
    this.queue = Promise.resolve()
    this.lookups = new Set()
    this.cleanupTasks = []
    this.bulkOperations = []
    this.loadedMailboxes = new Set()
    // 组织图按 org id 记录已加载的子图，避免同一请求内重复 organizationGraph()
    // 时把成员/交接/资源再查一遍（团队概览曾因此重复多段 SQL）。
    this.graph = { members: new Set(), handovers: new Set(), resources: new Set() }
  }

  async select(table, where, params = [], executor = this.pool, target = this.rows, options = {}) {
    if (!TABLES.includes(table) || !where) throw new TypeError('A bounded relational predicate is required')
    const suffix = options.limit ? ` ORDER BY id DESC LIMIT ${Math.min(10000, Math.max(1, Math.floor(options.limit)))}` : ''
    const rows = executor === this.pool && target === this.rows && ['kq_user', 'kq_organization', 'kq_upgrade_order', 'kq_message'].includes(table)
      ? await readVersionedRows(executor, table, where, params, suffix)
      : (await executor.query(`SELECT * FROM \`${table}\` WHERE ${where}${suffix}`, params))[0]
    for (const row of rows) target.get(table).set(identityKey(table, row), row)
    if (executor === this.pool && target === this.rows && rows.length) {
      // A session lookup already loads its user by PK. Subsequent account and
      // roster lookups must reuse that same request's complete row.
      for (const row of rows) {
        if (row.id != null) this.lookups.add(`${table}:id:${row.id}`)
        if (['kq_user', 'kq_organization'].includes(table) && row.legacy_id) this.lookups.add(`${table}:legacy_id:${row.legacy_id}`)
      }
      if (table === 'kq_resource') {
        for (const child of ['kq_resource_file', 'kq_share_config', 'kq_collection_task', 'kq_collection_submission']) await this.by(child, 'resource_id', rows.map(row => row.id))
        await this.by('kq_submission_file', 'submission_id', [...this.rows.get('kq_collection_submission').values()].map(row => row.id))
        await this.by('kq_user', 'id', [...rows.map(row => row.owner_user_id), ...[...this.rows.get('kq_collection_submission').values()].map(row => row.submitter_user_id)])
      }
      if (table === 'kq_organization') {
        for (const child of ['kq_organization_member', 'kq_ownership_handover']) await this.by(child, 'organization_id', rows.map(row => row.id))
        await this.by('kq_user', 'id', [...this.rows.get('kq_organization_member').values()].map(row => row.user_id))
      }
      if (table === 'kq_distribution_batch') {
        await this.by('kq_distribution_assignment', 'batch_id', rows.map(row => row.id))
        await this.by('kq_user', 'id', [...rows.map(row => row.owner_user_id), ...[...this.rows.get('kq_distribution_assignment').values()].map(row => row.recipient_user_id)])
      }
    }
    return rows
  }

  async by(table, column, values, executor = this.pool, target = this.rows) {
    const ids = [...new Set(values.filter(value => value !== null && value !== undefined && value !== ''))]
    if (!ids.length) return []
    if (!TABLES.includes(table) || !/^[a-z_]+$/.test(column)) throw new TypeError('Invalid relational lookup')
    const cached = executor === this.pool && target === this.rows
    const key = value => `${table}:${column}:${value}`
    const missing = cached ? ids.filter(value => !this.lookups.has(key(value))) : ids
    const rows = []
    for (let offset = 0; offset < missing.length; offset += 100) {
      const batch = missing.slice(offset, offset + 100)
      rows.push(...await this.select(table, `\`${column}\` IN (${placeholders(batch)})`, batch, executor, target))
      if (cached) for (const value of batch) this.lookups.add(key(value))
    }
    if (cached) {
      const wanted = new Set(ids.map(String))
      return [...this.rows.get(table).values()].filter(row => wanted.has(String(row[column])))
    }
    return rows
  }

  async page(table, where, params, { cursor = '', limit = 50 } = {}) {
    if (!TABLES.includes(table)) throw new TypeError('Invalid list table')
    if (cursor && !/^[1-9][0-9]{0,18}$/.test(String(cursor))) throw Object.assign(new Error('分页游标无效'), { status: 400 })
    const size = Math.min(200, Math.max(1, Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : 50))
    // MySQL 8.4 在 (user_id, id) 游标查询上会误选更旧的复合索引做 skip scan + filesort；
    // 这两张表的 page() 调用只按 user_id 前缀过滤，固定索引可保证反向索引扫描。索引由
    // 006-normalized-entities / 007-pagination-indexes 迁移建立。
    const hint = PAGE_INDEX_HINTS[table]
    const source = hint ? `\`${table}\` FORCE INDEX (\`${hint}\`)` : `\`${table}\``
    const [ids] = await this.pool.query(`SELECT id FROM ${source} WHERE (${where})${cursor ? ' AND id < ?' : ''} ORDER BY id DESC LIMIT ${size + 1}`, [...params, ...(cursor ? [cursor] : [])])
    const selected = ids.slice(0, size)
    await this.by(table, 'id', selected.map(row => row.id))
    this.hydrate()
    return { limit: size, nextCursor: ids.length > size ? String(selected.at(-1).id) : null }
  }

  async accountPage(id, domain, options) {
    const user = [...this.rows.get('kq_user').values()].find(row => row.legacy_id === id)
    if (!user) return { nextCursor: null }
    const pagination = await this.page(domain === 'messages' ? 'kq_message' : 'kq_account_record', 'user_id = ?', [user.id], options)
    // An empty real mailbox must not be mistaken for uninitialized demo data.
    this.data[domain][id] ??= []
    this.base[domain][id] ??= []
    if (domain === 'messages') this.loadedMailboxes.add(id)
    return pagination
  }

  async conflictingTeamPaths(organizationId, files, executor = this.pool, excludeId = '') {
    const digests = [...new Set(files.map(filePathDigest))]
    if (!digests.length) return false
    for (let offset = 0; offset < digests.length; offset += 100) {
      const batch = digests.slice(offset, offset + 100)
      const [rows] = await executor.query(`SELECT f.id FROM kq_resource_file f JOIN kq_resource r ON r.id = f.resource_id
        JOIN kq_organization o ON o.id = r.organization_id JOIN kq_resource_usage usage_row ON usage_row.resource_id = r.id
        WHERE o.legacy_id = ? AND r.team_resource = 1 AND r.deleted_at IS NULL AND usage_row.live_resource_count > 0
        AND r.legacy_id <> ? AND f.path_digest IN (${placeholders(batch)}) LIMIT 1`, [organizationId, excludeId, ...batch])
      if (rows.length) return true
    }
    return false
  }

  async teamMemberUsage(organizationId) {
    const [rows] = await this.pool.query(`SELECT owner.legacy_id, COUNT(*) AS share_count,
      SUM(u.live_bytes) AS bytes, SUM(u.live_file_count) AS files, MAX(r.gmt_modified) AS last_activity
      FROM kq_resource r JOIN kq_resource_usage u ON u.resource_id = r.id
      JOIN kq_organization o ON o.id = r.organization_id JOIN kq_user owner ON owner.id = r.owner_user_id
      WHERE o.legacy_id = ? AND r.team_resource = 1 AND u.live_resource_count > 0 GROUP BY owner.legacy_id`, [organizationId])
    return new Map(rows.map(row => [row.legacy_id, { shareCount: Number(row.share_count), fileCount: Number(row.files), usedBytes: Number(row.bytes), lastActivityAt: row.last_activity ? new Date(row.last_activity).toISOString() : null }]))
  }

  hydrate() {
    const next = hydrateRows(this.rows, emptyRequestData(), decodeProtected)
    for (const id of this.loadedMailboxes) next.messages[id] ??= []
    // Additional data may be requested after OAuth or multipart parsing. Keep
    // existing objects and local changes, rather than replacing them mid-route.
    const previous = entities(this.base), current = entities(this.data)
    const changes = new Map([...new Set([...previous.keys(), ...current.keys()])]
      .filter(key => !isDeepStrictEqual(previous.get(key)?.value, current.get(key)?.value))
      .map(key => [key, current.get(key) || { ...previous.get(key), deleted: true }]))
    this.base = structuredClone(next)
    if (!changes.size) { Object.assign(this.data, next); return }
    const merged = entities(next)
    for (const [key, value] of changes) if (value.deleted) merged.delete(key); else merged.set(key, value)
    const data = emptyRequestData()
    for (const value of merged.values()) put(data, value)
    Object.assign(this.data, data)
  }

  async config() { await this.by('kq_system_setting', 'setting_key', ['systemConfig']); this.hydrate() }

  async session(token) {
    if (!token) return null
    const rows = await this.by('kq_auth_session', 'token_hash', [keyedDigest(`session-cookie:${token}`)])
    await this.by('kq_user', 'id', rows.map(row => row.user_id))
    this.hydrate()
    return this.data.sessions.find(session => session.id === token) || null
  }

  async users(ids) { await this.by('kq_user', 'legacy_id', ids); this.hydrate() }

  async contacts(values) {
    const targets = [...new Set(values.filter(value => typeof value === 'string' && value.length <= 200).map(value => value.trim()).filter(Boolean))]
    if (!targets.length) return
    await this.select('kq_user', ['legacy_id', 'username', 'email', 'phone'].map(column => `\`${column}\` IN (${placeholders(targets)})`).join(' OR '), [...targets, ...targets, ...targets, ...targets])
    this.hydrate()
  }

  async account(id, { sessions = false, organizations = false, messages = false, records = false, settings = false, orders = false, resources = false } = {}) {
    await this.users([id])
    const user = [...this.rows.get('kq_user').values()].find(row => row.legacy_id === id)
    if (!user) return
    if (sessions) await this.select('kq_auth_session', 'user_id = ? AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP(3)', [user.id])
    if (messages) await this.select('kq_message', 'user_id = ?', [user.id], this.pool, this.rows, { limit: MAX_ACCOUNT_MESSAGES })
    if (records) await this.select('kq_account_record', 'user_id = ?', [user.id], this.pool, this.rows, { limit: MAX_ACCOUNT_RECORDS })
    if (settings) await this.by('kq_user_setting', 'user_id', [user.id])
    if (orders) await this.by('kq_upgrade_order', 'user_id', [user.id])
    if (organizations) {
      const members = await this.by('kq_organization_member', 'user_id', [user.id])
      await this.by('kq_organization', 'id', members.map(row => row.organization_id))
      await this.by('kq_organization', 'owner_user_id', [user.id])
    }
    if (resources) await this.by('kq_resource', 'owner_user_id', [user.id])
    this.hydrate()
  }

  async organizationGraph({ resources = false, members = false } = {}) {
    const organizations = [...this.rows.get('kq_organization').values()]
    const orgIds = organizations.map(row => row.id)
    const graph = this.graph
    await this.by('kq_user', 'id', organizations.map(row => row.owner_user_id))
    const pendingMembers = orgIds.filter(id => !graph.members.has(String(id)))
    if (pendingMembers.length) {
      await this.by('kq_organization_member', 'organization_id', pendingMembers)
      for (const id of pendingMembers) graph.members.add(String(id))
    }
    const pendingHandovers = orgIds.filter(id => !graph.handovers.has(String(id)))
    if (pendingHandovers.length) {
      await this.by('kq_ownership_handover', 'organization_id', pendingHandovers)
      for (const id of pendingHandovers) graph.handovers.add(String(id))
    }
    await this.by('kq_user', 'id', [...this.rows.get('kq_organization_member').values()].map(row => row.user_id))
    if (resources) {
      const pendingResources = orgIds.filter(id => !graph.resources.has(String(id)))
      if (pendingResources.length) {
        await this.by('kq_resource', 'organization_id', pendingResources)
        for (const id of pendingResources) graph.resources.add(String(id))
      }
    }
    this.hydrate()
    if (members) await this.users(Object.values(this.data.organizations).flatMap(org => (org.members || []).map(member => member.userId)).filter(Boolean))
  }

  async resource({ kind, id, token, manageToken, code }) {
    if (id) await this.select('kq_resource', 'legacy_id = ? AND resource_kind = ?', [id, kind])
    if (kind === 'share' && (manageToken || code)) {
      const configs = await this.by('kq_share_config', manageToken ? 'manage_token_hash' : 'share_code', [manageToken ? keyedDigest(`manage:${manageToken}`) : code])
      await this.by('kq_resource', 'id', configs.map(row => row.resource_id))
    }
    if (kind === 'collection' && (manageToken || token)) {
      const tasks = await this.by('kq_collection_task', manageToken ? 'manage_token_hash' : 'public_token_hash', [keyedDigest(`collection-${manageToken ? 'manage' : 'public'}:${manageToken || token}`)])
      await this.by('kq_resource', 'id', tasks.map(row => row.resource_id))
    }
    await this.resourceGraph()
  }

  async resourceGraph() {
    const resources = [...this.rows.get('kq_resource').values()]
    for (const table of ['kq_resource_file', 'kq_share_config', 'kq_collection_task', 'kq_collection_submission']) await this.by(table, 'resource_id', resources.map(row => row.id))
    await this.by('kq_submission_file', 'submission_id', [...this.rows.get('kq_collection_submission').values()].map(row => row.id))
    await this.by('kq_user', 'id', [...this.rows.get('kq_collection_submission').values()].map(row => row.submitter_user_id))
    await this.by('kq_user', 'id', resources.map(row => row.owner_user_id))
    await this.by('kq_organization', 'id', resources.map(row => row.organization_id))
    const distributions = await this.by('kq_distribution_batch', 'share_resource_id', resources.map(row => row.id))
    await this.by('kq_distribution_assignment', 'batch_id', distributions.map(row => row.id))
    await this.by('kq_user', 'id', [...this.rows.get('kq_distribution_assignment').values()].map(row => row.recipient_user_id))
    this.hydrate()
    await this.organizationGraph()
    const relatedUsers = [
      ...this.data.shares.flatMap(share => [...(share.recipientUserIds || []), ...(share.deliveryRecipients || []).map(recipient => typeof recipient === 'string' ? recipient : recipient?.userId)]),
      ...this.data.collections.flatMap(task => (task.submissions || []).map(submission => submission.submitterUserId)),
      ...this.data.distributions.flatMap(distribution => [distribution.ownerUserId, ...(distribution.rows || []).map(row => row.userId)]),
    ].filter(Boolean)
    await this.users(relatedUsers)
    if (distributions.length) await this.by('kq_distribution_assignment', 'batch_id', distributions.map(row => row.id))
    this.hydrate()
  }

  async notifications(ids) {
    await this.users(ids)
    const wanted = new Set(ids)
    const pks = [...this.rows.get('kq_user').values()].filter(row => wanted.has(row.legacy_id)).map(row => row.id)
    await this.loadRecentMessages(pks)
    await this.by('kq_user_setting', 'user_id', pks)
    this.hydrate()
  }

  // 一次查询取回多个账号的最近消息（每人最多 MAX_ACCOUNT_MESSAGES 条），
  // 避免团队/工作区页面按成员逐个 SELECT 造成 N+1（团队概览曾达 20+ 条）。
  async loadRecentMessages(ownerPks) {
    const owners = [...new Set(ownerPks.filter(value => value !== null && value !== undefined))]
    if (!owners.length) return []
    const limit = Math.max(1, Math.min(1000, Math.floor(MAX_ACCOUNT_MESSAGES)))
    const loaded = []
    for (let offset = 0; offset < owners.length; offset += 100) {
      const batch = owners.slice(offset, offset + 100)
      // MySQL 5.7 has no window functions. Each indexed owner range has its
      // own limit before UNION ALL, preserving the per-user bound on both 5.7/8.
      const [ids] = await this.pool.query(batch.map((_, index) =>
        `SELECT id FROM (SELECT id FROM kq_message WHERE user_id = ? ORDER BY id DESC LIMIT ${limit}) AS recent_${index}`).join(' UNION ALL '), batch)
      // Only ids cross the link first. Fetch changed message contents through
      // the same version check and bounded batches used by the message API.
      loaded.push(...await this.by('kq_message', 'id', ids.map(row => row.id)))
    }
    return loaded
  }

  async recordResources() {
    const records = [...this.rows.get('kq_account_record').values()]
    await this.by('kq_resource', 'id', records.map(row => row.resource_id))
    await this.recordReferences(Object.values(this.data.records).flat())
    this.hydrate()
  }

  async recordReferences(records) {
    const keys = [...new Set(records.flatMap(record => [record?.shareId, record?.collectionToken,
      String(record?.id || '').match(/^[^:]+:(?:share|collection):(.+)$/)?.[1]]).filter(value => typeof value === 'string' && value.length <= 180))]
    await this.by('kq_resource', 'legacy_id', keys)
    const shares = await this.by('kq_share_config', 'manage_token_hash', keys.map(key => keyedDigest(`manage:${key}`)))
    const publicTasks = await this.by('kq_collection_task', 'public_token_hash', keys.map(key => keyedDigest(`collection-public:${key}`)))
    const managedTasks = await this.by('kq_collection_task', 'manage_token_hash', keys.map(key => keyedDigest(`collection-manage:${key}`)))
    await this.by('kq_resource', 'id', [...shares, ...publicTasks, ...managedTasks].map(row => row.resource_id))
    this.hydrate()
  }

  async uploadPublication(id) {
    const [rows] = await this.pool.query('SELECT resource_id FROM kq_upload_publication WHERE session_digest = ? LIMIT 1', [keyedDigest(`upload-session:${id}`)])
    await this.by('kq_resource', 'id', rows.map(row => row.resource_id))
    this.hydrate()
  }

  async resourceRecords() {
    const resources = [...this.rows.get('kq_resource').values()]
    const records = await this.by('kq_account_record', 'resource_legacy_id', resources.map(row => row.legacy_id))
    await this.by('kq_user', 'id', records.map(row => row.user_id))
    this.hydrate()
  }

  async guest(key) { if (key) { await this.by('kq_guest_usage', 'identity_digest', [keyedDigest(`guest-usage:${key}`)]); this.hydrate() } }

  async verification(target) {
    if (target) { await this.by('kq_verification_code', 'target_digest', [keyedDigest(`verification-target:${target.toLowerCase()}`)]); this.hydrate() }
  }

  async activeCollections(userId, guestKey = '', executor = this.pool) {
    const [rows] = await executor.query(`SELECT COUNT(*) AS total FROM kq_resource r
      JOIN kq_resource_usage u ON u.resource_id = r.id
      LEFT JOIN kq_user owner ON owner.id = r.owner_user_id
      WHERE r.resource_kind = 'collection' AND r.status = 'active' AND r.deleted_at IS NULL
        AND (r.expires_at IS NULL OR r.expires_at > UTC_TIMESTAMP(3)) AND u.live_resource_count = 1
        AND ${userId ? 'owner.legacy_id = ?' : 'r.owner_user_id IS NULL AND u.owner_guest_digest = ?'}`,
    [userId || keyedDigest(`guest-usage:${guestKey}`)])
    return Number(rows[0].total)
  }

  async usage(id, team = false, executor = this.pool) {
    const [rows] = await executor.query(`SELECT r.resource_kind,
      COALESCE(SUM(u.live_bytes), 0) AS bytes, COALESCE(SUM(u.live_file_count), 0) AS file_count,
      COALESCE(SUM(u.live_resource_count), 0) AS resource_count
      FROM kq_resource r JOIN kq_resource_usage u ON u.resource_id = r.id
      JOIN ${team ? 'kq_organization' : 'kq_user'} owner ON owner.id = r.${team ? 'organization_id' : 'owner_user_id'}
      WHERE owner.legacy_id = ? AND r.team_resource = ? GROUP BY r.resource_kind`, [id, team ? 1 : 0])
    return {
      shareBytes: Number(rows.find(row => row.resource_kind === 'share')?.bytes || 0),
      collectionBytes: Number(rows.find(row => row.resource_kind === 'collection')?.bytes || 0),
      shareCount: Number(rows.find(row => row.resource_kind === 'share')?.resource_count || 0),
      collectionCount: Number(rows.find(row => row.resource_kind === 'collection')?.resource_count || 0),
      fileCount: rows.reduce((sum, row) => sum + Number(row.file_count), 0),
    }
  }

  async adminOverview() {
    this.adminReadModel = await readAdminOverview(this.pool)
    return this.adminReadModel
  }

  async loadAffected(connection, changes) {
    const rows = emptyRows()
    const userPks = new Map([...this.rows.get('kq_user').values()].map(row => [row.legacy_id, row.id]))
    for (const entry of changes) {
      let where = 'legacy_id = ?', params = [entry.key]
      if (entry.table === 'kq_system_setting') where = 'setting_key = ?'
      if (entry.table === 'kq_guest_usage') where = 'identity_digest = ?'
      if (entry.table === 'kq_user_setting') { where = 'user_id = ?'; params = [userPks.get(entry.owner) || -1] }
      if (entry.table === 'kq_message') { where = 'user_id = ? AND legacy_id = ?'; params = [userPks.get(entry.owner) || -1, entry.value.id] }
      const current = await this.select(entry.table, where, params, connection, rows)
      const initial = [...this.rows.get(entry.table).values()].filter(row => {
        if (entry.table === 'kq_system_setting') return row.setting_key === entry.key
        if (entry.table === 'kq_guest_usage') return row.identity_digest === entry.key
        if (entry.table === 'kq_user_setting') return Number(row.user_id) === Number(userPks.get(entry.owner))
        if (entry.table === 'kq_message') return Number(row.user_id) === Number(userPks.get(entry.owner)) && row.legacy_id === entry.value.id
        return row.legacy_id === entry.key
      })
      const signature = list => list.map(row => [Number(row.id), Number(row.write_version || 0)]).sort((a, b) => a[0] - b[0])
      if (!isDeepStrictEqual(signature(initial), signature(current))) {
        if (entry.domain !== 'collections' || entry.deleted || !current.length || !initial.length) throw conflict()
        const before = this.base.collections.find(task => (task.id || task.token) === entry.key)
        const header = task => Object.fromEntries(Object.entries(task || {}).filter(([key]) => !['submissions', 'updatedAt'].includes(key)))
        if (!isDeepStrictEqual(header(before), header(entry.value))) throw conflict()
        const latestStore = new RelationalRequestStore(connection)
        await latestStore.resource({ kind: 'collection', id: entry.key })
        const latest = latestStore.data.collections[0]
        if (!latest || !isDeepStrictEqual(header(before), header(latest))) throw conflict()
        const oldItems = new Map((before.submissions || []).map(item => [item.id, item]))
        const desired = new Map((entry.value.submissions || []).map(item => [item.id, item]))
        const actual = new Map((latest.submissions || []).map(item => [item.id, item]))
        for (const id of new Set([...oldItems.keys(), ...desired.keys()])) {
          if (isDeepStrictEqual(oldItems.get(id), desired.get(id))) continue
          if (!isDeepStrictEqual(oldItems.get(id), actual.get(id))) throw conflict()
          if (desired.has(id)) actual.set(id, desired.get(id)); else actual.delete(id)
        }
        const original = structuredClone(entry.value.submissions)
        entry.value.submissions = [...actual.values()]
        const baseIndex = this.base.collections.findIndex(task => (task.id || task.token) === entry.key)
        this.base.collections[baseIndex] = structuredClone(latest)
        entry.rebased = true
        const local = this.data.collections.find(task => (task.id || task.token) === entry.key)
        if (local && isDeepStrictEqual(local.submissions, original)) local.submissions = structuredClone(entry.value.submissions)
      }
    }
    const ids = table => [...rows.get(table).values()].map(row => row.id)
    const resourceIds = ids('kq_resource')
    for (const table of ['kq_resource_file', 'kq_share_config', 'kq_collection_task', 'kq_collection_submission']) await this.by(table, 'resource_id', resourceIds, connection, rows)
    await this.by('kq_submission_file', 'submission_id', ids('kq_collection_submission'), connection, rows)
    await this.by('kq_organization_member', 'organization_id', ids('kq_organization'), connection, rows)
    await this.by('kq_ownership_handover', 'organization_id', ids('kq_organization'), connection, rows)
    await this.by('kq_distribution_assignment', 'batch_id', ids('kq_distribution_batch'), connection, rows)
    return rows
  }

  async references(connection, snapshot) {
    const refs = { userIds: [], organizationIds: [], resourceIds: [], fileIds: [], users: Object.entries(snapshot.users), shares: snapshot.shares }
    const identities = async (table, column, input, columns = 'id, legacy_id') => {
      const values = [...new Set(input.filter(Boolean))]
      if (!values.length) return []
      const rows = []
      for (let offset = 0; offset < values.length; offset += 100) {
        const batch = values.slice(offset, offset + 100)
        const [found] = await connection.query(`SELECT ${columns} FROM \`${table}\` WHERE \`${column}\` IN (${placeholders(batch)})`, batch)
        rows.push(...found)
      }
      return rows
    }
    // Foreign keys need stable identities, not the other users' private payloads.
    const userKeys = [
      ...Object.keys(snapshot.users), ...Object.keys(snapshot.messages), ...Object.keys(snapshot.records), ...Object.keys(snapshot.notificationSettings),
      ...snapshot.sessions.map(session => session.user?.id), ...snapshot.upgradeOrders.map(order => order.userId),
      ...Object.values(snapshot.organizations).flatMap(org => [org.ownerUserId, ...(org.members || []).map(member => member.userId),
        ...(org.ownershipHandovers || []).flatMap(item => [item.fromUserId, item.toUserId, item.resolvedByUserId])]),
      ...[...snapshot.shares, ...snapshot.collections].flatMap(resource => [resource.ownerUserId, resource.deletedByUserId,
        ...(resource.files || []).map(file => file.ownerUserId), ...(resource.submissions || []).flatMap(submission => [submission.submitterUserId, ...(submission.files || []).map(file => file.ownerUserId)])]),
      ...snapshot.distributions.flatMap(batch => [batch.ownerUserId, ...(batch.rows || []).map(row => row.userId)]),
    ]
    const users = await identities('kq_user', 'legacy_id', userKeys)
    refs.userIds = users.map(row => [row.legacy_id, row.id])
    const orgs = await identities('kq_organization', 'legacy_id', [...Object.keys(snapshot.organizations), ...[...snapshot.shares, ...snapshot.collections].flatMap(resource => [resource.teamOrganizationId, resource.brandingOrganizationId])])
    refs.organizationIds = orgs.map(row => [row.legacy_id, row.id])
    const resources = await identities('kq_resource', 'legacy_id', [...snapshot.shares, ...snapshot.collections].map(item => item.id || item.token))
    refs.resourceIds = resources.map(row => [row.legacy_id, row.id])
    if (snapshot.distributions.length) {
      const files = await identities('kq_resource_file', 'resource_id', resources.map(row => row.id), 'id, resource_id, storage_key')
      for (const share of snapshot.shares) for (const [index, file] of (share.files || []).entries()) {
        const row = files.find(row => row.storage_key === `${file.storageOwnerId || share.ownerUserId || `legacy:${share.id}`}/${file.storedName}`)
        if (row) refs.fileIds.push([`${share.id}:${index}`, row.id])
      }
    }
    return refs
  }

  async commit({ normalize = false } = {}) {
    const present = new Set([...this.data.shares, ...this.data.collections].map(item => item.id || item.token))
    const deleted = new Set([...this.base.shares, ...this.base.collections].map(item => item.id || item.token).filter(id => !present.has(id)))
    if (deleted.size) this.data.distributions = this.data.distributions.filter(batch => !deleted.has(batch.shareId))
    const snapshot = structuredClone(this.data)
    const originalBase = structuredClone(this.base)
    const before = entities(this.base), after = entities(snapshot)
    const keys = new Set([...before.keys(), ...after.keys()])
    const changes = [...keys].filter(key => (normalize && after.get(key)?.table !== 'kq_system_setting') || !isDeepStrictEqual(before.get(key)?.value, after.get(key)?.value))
      .map(key => ({ ...(after.get(key) || before.get(key)), deleted: !after.has(key) }))
    if (!changes.length && !this.cleanupTasks.length && !this.bulkOperations.length) return
    const cleanupTasks = this.cleanupTasks.splice(0)
    const bulkOperations = this.bulkOperations.splice(0)
    const changedResources = new Set(changes.filter(entry => entry.table === 'kq_resource').map(entry => entry.key))
    // A cleaned share retains the immutable distribution/file assignment history.
    for (const entry of after.values()) if (entry.table === 'kq_distribution_batch' && changedResources.has(entry.value.shareId) && !changes.some(change => change.table === entry.table && change.key === entry.key)) changes.push(entry)
    const delta = emptyRequestData()
    for (const entry of changes) if (!entry.deleted) put(delta, entry)
    // Bounded retry: deadlocks / lock-wait timeouts / capacity conflicts are rolled
    // back cleanly and replayed. A lost connection before COMMIT may recover once.
    // Commit acknowledgement loss is NOT retried here
    // because MySQL may already have committed; callers handle that as uncertain.
    const maxAttempts = commitAttempts()
    let attempt = 0
    let connectionRetries = 0
    while (true) {
      attempt += 1
      const connection = await this.pool.getConnection()
      let retryError = null
      let commitSent = false
      try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED')
      await connection.beginTransaction()
      await lockWriteScope(connection, [...changeLockKeys(changes, this.authorizedUserId, this.base),
        ...bulkOperations.map(operation => `user:${operation.owner}`),
        ...[...this.rows.get('kq_organization').values()].map(row => `organization:${row.legacy_id}`)])
      const state = await readRelationalState(connection)
      if (!state) throw Object.assign(new Error('关系数据库尚未迁移，请先执行数据库迁移'), { status: 503, code: 'RELATIONAL_MIGRATION_REQUIRED' })
      if (this.authorizedUserId) {
        const [sessions] = await connection.query(`SELECT s.expires_at > UTC_TIMESTAMP(3) AS active,
          s.revoked_at, u.status FROM kq_auth_session s JOIN kq_user u ON u.id = s.user_id
          WHERE s.token_hash = ? LIMIT 1`, [this.authorizedSessionHash])
        if (!sessions.length || !Number(sessions[0].active) || sessions[0].revoked_at || sessions[0].status !== 'active') {
          throw Object.assign(new Error('登录或账号权限已失效，请重新登录'), { status: 401, code: 'SESSION_INVALIDATED' })
        }
        const guards = [
          ...[...this.rows.get('kq_user').values()].filter(row => row.legacy_id === this.authorizedUserId).map(row => ({ table: 'kq_user', key: row.legacy_id, value: {} })),
          ...[...this.rows.get('kq_organization').values()].map(row => ({ table: 'kq_organization', key: row.legacy_id, value: {} })),
        ]
        await this.loadAffected(connection, guards)
      }
      for (const entry of changes.filter(entry => entry.table === 'kq_user' && !entry.deleted)) {
        for (const column of ['email', 'phone']) if (entry.value[column]) {
          const [occupied] = await connection.query(`SELECT legacy_id FROM kq_user WHERE \`${column}\` = ? AND legacy_id <> ? LIMIT 1`, [entry.value[column], entry.key])
          if (occupied.length) throw Object.assign(new Error('该联系方式已绑定其他账号'), { status: 409, code: 'CONTACT_ALREADY_BOUND' })
        }
      }
      for (const entry of changes.filter(entry => entry.table === 'kq_organization' && !entry.deleted)) {
        const [occupied] = await connection.query('SELECT legacy_id FROM kq_organization WHERE name = ? AND legacy_id <> ? LIMIT 1', [entry.value.name, entry.key])
        if (occupied.length) throw Object.assign(new Error('团队名称已存在，请使用其他名称'), { status: 409, code: 'ORGANIZATION_NAME_TAKEN' })
      }
      const rows = await this.loadAffected(connection, changes)
      await this.beforeCommit?.(connection, changes)
      const references = await this.references(connection, snapshot)
      const result = await synchronizeRelationalMetadata(connection, delta, null, rows, {
        normalized: true,
        references,
        systemKeys: new Set(changes.filter(entry => entry.table === 'kq_system_setting').map(entry => entry.key)),
      })
      for (const entry of changes.filter(entry => entry.table === 'kq_resource')) {
        const row = [...(entry.deleted ? rows : result.syncCache).get('kq_resource').values()].find(row => row.legacy_id === entry.key)
        if (!row) throw new Error('Changed resource identity missing')
        if (entry.deleted) {
          await connection.execute('DELETE FROM kq_resource_usage WHERE resource_id = ?', [row.id])
          await connection.execute('DELETE FROM kq_upload_publication WHERE resource_id = ?', [row.id])
        }
        else await writeResourceUsage(connection, row.id, entry.value, entry.domain === 'collections' ? 'collection' : 'share')
      }
      for (const entry of changes) {
        const identity = [...result.syncCache.get(entry.table).values()].find(row => {
          if (entry.table === 'kq_system_setting') return row.setting_key === entry.key
          if (entry.table === 'kq_guest_usage') return row.identity_digest === entry.key
          if (entry.table === 'kq_user_setting') return String(row.user_id) === String(references.userIds.find(([key]) => key === entry.owner)?.[1])
          if (entry.table === 'kq_message') return row.legacy_id === entry.value.id && String(row.user_id) === String(references.userIds.find(([key]) => key === entry.owner)?.[1])
          return row.legacy_id === entry.key
        })
        if (identity && !entry.deleted) {
          await connection.execute(`UPDATE \`${entry.table}\` SET write_version = write_version + 1, gmt_modified = gmt_modified WHERE id = ?`, [identity.id])
          identity.write_version = Number(identity.write_version || 0) + 1
        }
      }
      for (const operation of bulkOperations) {
        const ownerPk = references.userIds.find(([id]) => id === operation.owner)?.[1]
        if (!ownerPk) throw new Error('Bulk operation owner is missing')
        if (operation.type === 'clearMessages') await connection.execute('DELETE FROM kq_message WHERE user_id = ?', [ownerPk])
        else if (operation.type === 'markMessagesRead') {
          await connection.execute('UPDATE kq_message SET read_at = COALESCE(read_at, UTC_TIMESTAMP(3)), write_version = write_version + 1 WHERE user_id = ?', [ownerPk])
        } else if (operation.type === 'replaceRecords') {
          const keep = (snapshot.records[operation.owner] || []).map(record => `${operation.owner}:${record.id}`)
          await connection.execute(`DELETE FROM kq_account_record WHERE user_id = ?${keep.length ? ` AND legacy_id NOT IN (${placeholders(keep)})` : ''}`, [ownerPk, ...keep])
        } else throw new Error('Unsupported bulk operation')
        // Keep the request cache in step with SQL-wide actions, including rows
        // that were loaded by an earlier page in this same request.
        const table = operation.type === 'replaceRecords' ? 'kq_account_record' : 'kq_message'
        for (const [key, row] of result.syncCache.get(table)) if (String(row.user_id) === String(ownerPk)) {
          if (operation.type === 'clearMessages' || (operation.type === 'replaceRecords'
            && !(snapshot.records[operation.owner] || []).some(record => row.legacy_id === `${operation.owner}:${record.id}`))) result.syncCache.get(table).delete(key)
          else if (operation.type === 'markMessagesRead') {
            row.read_at ||= new Date().toISOString()
            row.write_version = Number(row.write_version || 0) + 1
          }
        }
      }
      await enqueueCleanup(connection, cleanupTasks)
      commitSent = true
      await connection.commit()
      // Preserve mutations made while SQL awaited; only advance the saved base.
      this.didCommit?.(this.base, snapshot, { cleanupQueued: cleanupTasks.length > 0 })
      this.base = snapshot
      for (const [name, table] of this.rows) {
        const affected = new Set([...rows.get(name).values()].map(row => String(row.id)))
        for (const [key, row] of table) if (affected.has(String(row.id))) table.delete(key)
        for (const [key, row] of result.syncCache.get(name)) table.set(key, row)
        for (const operation of bulkOperations) if ((name === 'kq_message' && operation.type === 'clearMessages')
          || (name === 'kq_account_record' && operation.type === 'replaceRecords')) {
          const ownerPk = references.userIds.find(([id]) => id === operation.owner)?.[1]
          for (const [key, row] of table) if (String(row.user_id) === String(ownerPk) && !result.syncCache.get(name).has(key)) table.delete(key)
        }
      }
      this.lookups.clear()
        return
      } catch (error) {
        this.base = originalBase
        const connectionFailed = isTransactionConnectionError(error)
        // Destroy before reconnecting: the original transaction must never be
        // reused, and its uncommitted writes are rolled back by MySQL.
        if (connectionFailed) connection.destroy()
        else await connection.rollback().catch(() => {})
        if (connectionFailed && !commitSent && connectionRetries === 0 && attempt < maxAttempts) connectionRetries += 1
        else if (!isRetryableCommitError(error) || commitSent) throw error
        if (attempt >= maxAttempts) {
          throw Object.assign(new Error('数据库繁忙，请稍后重试'), { status: 503, code: 'DATABASE_RETRY_EXHAUSTED', retryable: true, cause: error })
        }
        retryError = error
      } finally { connection.release() }
      // 连接已释放后再刷新基线，避免重试期间同时占用两个连接导致连接池饥饿。
      console.warn(JSON.stringify({ event: 'relational_commit_retry', attempt, code: retryError.code || 'UNKNOWN' }))
      try { await this.refreshConflictState?.(retryError) } catch {}
      await commitRetryDelay(attempt)
    }
  }
}
