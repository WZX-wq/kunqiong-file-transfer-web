// admin 域路由（原 server.mjs 内联处理器，逐行搬迁，未改逻辑）
//
// 依赖方向：routes → services → lib → state → config（单向）
// 注册顺序即 Express 匹配顺序，调用点顺序不可调整。
import {
  ADMIN_ACCOUNT_PASSWORD, ADMIN_ACCOUNT_USERNAME, adminCredentialsConfigured, collectionsRoot,
  filesRoot, userFilesRoot, ACCOUNT_PLANS
} from '../config.js'
import {
  requestIp
} from '../lib/audit.js'
import {
  firstValue, removeDirectory
} from '../lib/http.js'
import { removeStoredFiles } from '../lib/file-storage.js'
import {
  configuredAccountPlan, normalizePlanId, normalizeRecordDate, normalizeSystemConfig, publicUser
} from '../lib/metadata-normalizers.js'
import {
  metadata, persistMetadata, refreshAuditPersistence, flushMetadataWrites, readAuditLogs
} from '../lib/metadata-store.js'
import {
  accountUserById, appendAuthResult, configuredAccountPlans, recordAuditLog, safeReturnUrl, syncAccountUserSessions,
  syncOrganizationTeamPlanFromOwner,
  setOAuthStateCookie, readCookie, oauthStateCookieName
} from '../services/account.js'
import {
  adminLoginRateLimited, adminSessionDescriptor, adminUserSummary, buildAdminOverview,
  clearAdminCookie, clearAdminLoginFailures, consumeOAuthState, createAdminSession,
  createAuthSession, exchangeOAuthToken, pruneRecordsForPurgedResources,
  recordAdminLoginFailure, removeAdminSession, requireAdminSession, runMaintenanceCleanup,
  safeEqualString, setAdminCookie, setAuthCookie
} from '../services/admin.js'
import {
  adminSessionFromRequest
} from '../services/shares.js'
import { systemConfigError, userUpdateError } from '../lib/admin-validation.js'
import { OAuthCallbackRegistry, oauthPendingPage, oauthProgressScript } from '../lib/oauth-callback.js'
import { issueExistingAuthSession } from '../db/auth-session.js'
import { authSessionDescriptor } from '../services/admin.js'
import { keyedDigest } from '../lib/private-key.js'
import { trackDataOperation } from '../lib/data-context.js'
import path from 'node:path'
import { runDatabaseCleanup } from '../lib/database-cleanup.js'
import { getBackgroundScanStatus } from '../services/background-scans.js'
import { cleanupBlockedRiskFile } from '../services/risk-file-cleanup.js'

export function registerAdminRoutes(app) {
  const callbacks = new OAuthCallbackRegistry()
  const callbackBrowser = (req, state) => keyedDigest(readCookie(req, oauthStateCookieName(state)))
  const expiredCallback = (req, res) => res.redirect(appendAuthResult(safeReturnUrl('', req), 'failed', '登录状态已过期，请重新登录'))
  const deliverCallback = (req, res, state, attempt) => {
    const result = attempt.result
    res.set('Cache-Control', 'no-store').set('Referrer-Policy', 'no-referrer')
    if (!attempt.delivered) {
      attempt.delivered = true
      if (result.session) setAuthCookie(res, result.session.id, result.session.expiresAt, req)
      setOAuthStateCookie(res, req, state, '')
    }
    return res.redirect(result.location)
  }

  app.get('/auth/pending', (req, res) => {
    const state = firstValue(req.query.state)
    const attempt = callbacks.get(state, callbackBrowser(req, state))
    if (!attempt) return expiredCallback(req, res)
    if (attempt.result) return deliverCallback(req, res, state, attempt)
    res.set('Cache-Control', 'no-store').set('Referrer-Policy', 'no-referrer')
      .type('html').send(oauthPendingPage(state))
  })
  app.get('/auth/progress.js', (req, res) => res.set('Cache-Control', 'no-store').type('js').send(oauthProgressScript))
  app.get('/api/auth/progress', (req, res) => {
    const state = firstValue(req.query.state)
    const attempt = callbacks.get(state, callbackBrowser(req, state))
    res.set('Cache-Control', 'no-store').set('Referrer-Policy', 'no-referrer')
    return res.status(attempt ? 200 : 410).json({ ready: Boolean(attempt?.result) })
  })
  app.post('/api/admin/login', async (req, res, next) => {
    if (!adminCredentialsConfigured) return res.status(503).json({ message: '后台登录未配置，请设置管理员账号和密码' })
    if (adminLoginRateLimited(req)) {
      return res.status(429).json({ message: '登录尝试过于频繁，请稍后再试' })
    }
    if (typeof req.body?.username !== 'string' || req.body.username.length > 120) return res.status(400).json({message:'管理员账号格式不正确或过长'})
    const username = req.body.username.trim()
    const password = typeof req.body?.password === 'string' ? req.body.password : ''
    if (password.length > 128) return res.status(400).json({message:'管理员密码不能超过 128 个字符'})
    if (!username || !password) return res.status(400).json({ message: '请输入管理员账号和密码' })
    const matched = safeEqualString(username, ADMIN_ACCOUNT_USERNAME) & safeEqualString(password, ADMIN_ACCOUNT_PASSWORD)
    if (!matched) {
      recordAdminLoginFailure(req)
      recordAuditLog({ type: 'admin', action: '后台登录失败', ip: requestIp(req), details: { username: username.slice(0, 40) } })
      return res.status(401).json({ message: '管理员账号或密码不正确' })
    }
    clearAdminLoginFailures(req)
    const adminSession = createAdminSession(req)
    setAdminCookie(res, adminSession.token, req)
    recordAuditLog({ type: 'admin', action: '后台登录成功', userId: `admin:${adminSession.username}`, ip: requestIp(req) })
    try { await req.dataContext?.store.adminOverview() } catch (error) { return next(error) }
    res.json({ admin: adminSessionDescriptor(adminSession), overview: buildAdminOverview() })
  })

  app.post('/api/admin/logout', (req, res) => {
    const adminSession = adminSessionFromRequest(req)
    removeAdminSession(req)
    clearAdminCookie(res, req)
    if (adminSession) recordAuditLog({ type: 'admin', action: '后台退出登录', userId: `admin:${adminSession.username}`, ip: requestIp(req) })
    res.json({ ok: true })
  })

  app.get('/api/admin/session', (req, res) => {
    // 后台只认账号口令会话。此前这里允许 KUNQIONG_ADMIN_USER_IDS 白名单里的
    // 鲲穹账号直接通过（mode:'kunqiong'），后果是那个账号一登录就绕过密码弹窗，
    // 表现为「部分账号还能直接进后台」。白名单通道已彻底移除。
    const adminSession = adminSessionFromRequest(req)
    if (adminSession) return res.json({ authenticated: true, admin: adminSessionDescriptor(adminSession), mode: 'credential' })
    res.json({ authenticated: false, admin: null })
  })

  app.get('/api/admin/overview', async (req, res, next) => {
    const auth = requireAdminSession(req, res)
    if (!auth) return
    try {
      await refreshAuditPersistence()
      res.json(buildAdminOverview())
    } catch (error) { next(error) }
  })

  app.get('/api/admin/scans', async (req, res, next) => {
    const auth = requireAdminSession(req, res)
    if (!auth) return
    try {
      const allLogs = req.dataContext?.auditStore
        ? await req.dataContext.auditStore.refresh(5000)
        : readAuditLogs()
      const scanLogs = allLogs.filter(item => item.type === 'security' && ['passed', 'blocked', 'failed', 'skipped'].includes(item.details?.scanResult))
      const cleaned = new Set(allLogs.filter(item => ['自动清理风险文件', '手动清理风险文件'].includes(item.action)).map(item => item.details?.scanFileKey))
      const counts = { all: scanLogs.length, passed: 0, blocked: 0, failed: 0, skipped: 0 }
      for (const item of scanLogs) counts[item.details.scanResult]++
      res.set('Cache-Control', 'no-store').json({
        logs: scanLogs.map(item => ({ ...item, cleaned: cleaned.has(`${item.details?.shareId}:${item.details?.storageOwnerId || ''}:${item.details?.storedName}`) })),
        total: scanLogs.length, counts, retainedScanResults: scanLogs.length,
      })
    } catch (error) { next(error) }
  })

  app.get('/api/admin/scan-progress', async (req, res, next) => {
    if (!requireAdminSession(req, res)) return
    try { res.set('Cache-Control', 'no-store').json(await getBackgroundScanStatus()) }
    catch (error) { next(error) }
  })

  app.post('/api/admin/scans/:logId/cleanup', async (req, res, next) => {
    const auth = requireAdminSession(req, res)
    if (!auth) return
    try {
      const logs = req.dataContext?.auditStore ? await req.dataContext.auditStore.refresh(5000) : readAuditLogs()
      const log = logs.find(item => item.id === req.params.logId && item.type === 'security' && item.details?.scanResult === 'blocked')
      if (!log?.details?.shareId || !log.details.storedName) return res.status(400).json({ message: '该扫描记录没有可清理的已发布风险文件' })
      const result = await cleanupBlockedRiskFile({ ...log.details, actor: auth.user.id, scanLogId: log.id })
      res.json({ ok: true, ...result, message: result.notified ? '风险文件已清理，已通知文件所有者' : '风险文件已清理，该文件为游客上传，无账号接收站内通知' })
    } catch (error) { next(error) }
  })

  // 测试服验收专用：用管理员口令会话为指定用户签发一个登录会话。
  // 安全约束（三条缺一不可）：
  //   1) 必须是已有的管理员口令会话（requireAdminSession）；
  //   2) 仅测试服可用（NODE_ENV === 'test'），生产环境直接 404；
  //   3) 只允许给「已存在」的用户签发，不能凭此创建新用户。
  app.post('/api/admin/impersonate', (req, res) => {
    if (process.env.NODE_ENV !== 'test') return res.status(404).json({ message: 'Not found' })
    const auth = requireAdminSession(req, res)
    if (!auth) return
    const userId = String(req.body?.userId || '').trim()
    if (!userId) return res.status(400).json({ message: '缺少 userId' })
    const user = accountUserById(userId)
    if (!user) return res.status(404).json({ message: '用户不存在' })
    if (user.status === 'disabled') return res.status(400).json({ message: '该用户已被禁用，无法签发验收会话' })
    const session = createAuthSession({ user: publicUser(user), expires_in: 3600 })
    recordAuditLog({ type: 'admin', action: '签发验收会话', userId: auth.user.id, targetId: user.id })
    res.json({ sessionId: session.id, user: adminUserSummary(user) })
  })

  app.post('/api/admin/cleanup', (req, res, next) => Promise.resolve().then(async () => {
    const auth = requireAdminSession(req, res)
    if (!auth) return
    const result = req.dataContext ? await runDatabaseCleanup(req.dataContext.store.pool) : runMaintenanceCleanup()
    recordAuditLog({ type: 'admin', action: '手动执行存储清理', userId: auth.user.id, details: result })
    await req.dataContext?.store.adminOverview()
    res.json({ ...result, overview: buildAdminOverview() })
  }).catch(next))

  app.patch('/api/admin/config', async (req, res, next) => {
    try {
      const auth = requireAdminSession(req, res)
      if (!auth) return
      const validationError = systemConfigError(req.body, metadata.systemConfig)
      if (validationError) return res.status(400).json({ message: validationError })
      metadata.systemConfig = normalizeSystemConfig({
        ...metadata.systemConfig,
        ...req.body,
        planOverrides: req.body?.planOverrides ? {
          // The visible form replaces active overrides but must not reset purchased legacy quotas.
          ...Object.fromEntries(Object.entries(metadata.systemConfig.planOverrides || {}).filter(([id]) => ACCOUNT_PLANS[id]?.retired)),
          ...req.body.planOverrides,
        } : metadata.systemConfig.planOverrides,
      })
      persistMetadata()
      recordAuditLog({ type: 'admin', action: '更新系统配置', userId: auth.user.id, details: metadata.systemConfig })
      await flushMetadataWrites()
      res.json({ config: metadata.systemConfig, plans: configuredAccountPlans() })
    } catch (error) { next(error) }
  })

  app.patch('/api/admin/users/:userId', (req, res) => {
    const auth = requireAdminSession(req, res)
    if (!auth) return
    const validationError = userUpdateError(req.body)
    if (validationError) return res.status(400).json({ message: validationError })
    const user = accountUserById(req.params.userId)
    if (!user) return res.status(404).json({ message: '用户不存在' })
    const status = req.body?.status ? String(req.body.status) : user.status || 'active'
    const planId = normalizePlanId(req.body?.planId || user.planId)
    if (!['active', 'disabled'].includes(status)) return res.status(400).json({ message: '用户状态不支持' })
    // auth.user.id 形如 `admin:ljxkjadmin`，不是鲲穹账号 id，所以用账号名比对才有效。
    // 原先写 `user.id === auth.user.id` 永远为 false，等于没有这层保护。
    const adminUsername = String(auth.user.id || '').replace(/^admin:/, '')
    const isSelfAccount = adminUsername && (user.username === adminUsername || user.id === adminUsername)
    if (isSelfAccount && status === 'disabled') {
      return res.status(400).json({ message: '不能禁用当前登录的管理员账号' })
    }
    user.planId = planId
    const planChanged = Object.hasOwn(req.body, 'planId') || Object.hasOwn(req.body, 'planExpiresAt')
    if (planChanged) user.planManagedAt = new Date().toISOString()
    if (req.body.planId) user.planPermanent = configuredAccountPlan(planId).permanent
    user.status = status
    if (req.body.planId && configuredAccountPlan(planId).permanent) {
      user.planExpiresAt = null
    } else if (Object.prototype.hasOwnProperty.call(req.body || {}, 'planExpiresAt')) {
      user.planExpiresAt = normalizeRecordDate(req.body.planExpiresAt)
    } else if (req.body.planId && planId !== 'free') {
      user.planExpiresAt = new Date(Date.now() + (configuredAccountPlan(planId).validityDays || 30) * 86400000).toISOString()
    }
    user.updatedAt = new Date().toISOString()
    if (status === 'disabled') {
      metadata.sessions = metadata.sessions.filter((item) => item.user?.id !== user.id)
    }
    syncAccountUserSessions(user)
    syncOrganizationTeamPlanFromOwner(user)
    persistMetadata()
    recordAuditLog({ type: 'admin', action: '更新用户状态或权益', userId: auth.user.id, targetId: user.id, details: { status, planId, planChanged, planExpiresAt: user.planExpiresAt || null } })
    res.json({ user: adminUserSummary(user) })
  })

  app.delete('/api/admin/resources/:kind/:id', (req, res, next) => Promise.resolve().then(async () => {
    const auth = requireAdminSession(req, res)
    if (!auth) return
    const kind = String(req.params.kind)
    const id = String(req.params.id)
    if (kind === 'share') {
      const index = metadata.shares.findIndex((item) => item.id === id)
      if (index < 0) return res.status(404).json({ message: '分享资源不存在' })
      const [share] = metadata.shares.splice(index, 1)
      removeStoredFiles(share.files || [], path.join(filesRoot, share.id), userFilesRoot)
      removeDirectory(path.join(filesRoot, share.id))
      // 与「执行清理」同口径：资源已物理删除，用户收发记录里指向它的条目一并摘除，避免残留死条目
      const removedShareKeys = new Set([share.id])
      if (share.manageToken) removedShareKeys.add(share.manageToken)
      if (share.code) removedShareKeys.add(share.code)
      pruneRecordsForPurgedResources(removedShareKeys, new Set())
    } else if (kind === 'collection') {
      const index = metadata.collections.findIndex((item) => item.id === id || item.token === id || item.manageToken === id)
      if (index < 0) return res.status(404).json({ message: '收集资源不存在' })
      const [collection] = metadata.collections.splice(index, 1)
      for (const submission of collection.submissions || []) removeStoredFiles(submission.files || [], path.join(collectionsRoot, collection.id, submission.id), userFilesRoot)
      removeDirectory(path.join(collectionsRoot, collection.id))
      const removedCollectionKeys = new Set([collection.id, collection.token, collection.manageToken].filter(Boolean))
      pruneRecordsForPurgedResources(new Set(), removedCollectionKeys)
    } else {
      return res.status(400).json({ message: '资源类型不支持' })
    }
    persistMetadata()
    // 此前这里写的是 `session.user.id`，但本作用域内没有 session（应为 auth），
    // 会在资源已经 splice 掉之后抛 ReferenceError → 接口 500、审计日志丢失。
    recordAuditLog({ type: 'admin', action: '删除文件资源', userId: auth.user.id, targetId: id, details: { kind } })
    await flushMetadataWrites()
    await req.dataContext?.store.adminOverview()
    res.json({ ok: true, overview: buildAdminOverview() })
  }).catch(next))

  app.get('/auth/callback', async (req, res) => {
    const code = firstValue(req.query.code)
    const state = firstValue(req.query.state)
    const attempt = callbacks.start(state, callbackBrowser(req, state), () => consumeOAuthState(state, req),
      pending => completeCallback(req, res, pending, code))
    if (!attempt) return expiredCallback(req, res)
    trackDataOperation(attempt.completion)
    // Browsers leave the provider immediately; the bound progress endpoint only
    // sets a login cookie after the original exchange and SQL commit succeed.
    if (req.get('accept')?.includes('text/html')) {
      return res.redirect(`/auth/pending?state=${encodeURIComponent(state)}`)
    }
    await attempt.completion
    deliverCallback(req, res, state, attempt)
  })

  async function completeCallback(req, res, pendingState, code) {
    const returnTo = pendingState.returnTo
    const startedAt = Date.now()
    if (!code) return { location: appendAuthResult(returnTo, 'failed', '授权码缺失，请重新登录') }
    let stage = 'token_exchange'
    try {
      const tokenData = await exchangeOAuthToken(code, pendingState.redirectUri)
      // Established accounts already own their local profile and entitlements.
      // Persist only the new credential here; merge provider updates separately.
      if (req.dataContext) {
        stage = 'session_commit'
        const incoming = publicUser(tokenData.user)
        if (incoming.status === 'disabled') return { location: appendAuthResult(returnTo, 'failed', '该账号已被后台禁用，暂时无法登录，请联系管理员。') }
        const session = authSessionDescriptor(tokenData, { id: incoming.id })
        if (await issueExistingAuthSession(req.dataContext.store.pool, incoming.id, session)) {
          req.dataContext.deferLoginFollowup(session, tokenData.user)
          console.log(JSON.stringify({ event: 'oauth_callback_completed', path: 'existing_account', durationMs: Date.now() - startedAt, sqlCount: req.requestMetrics?.sqlCount }))
          return { session, location: appendAuthResult(returnTo, 'success') }
        }
      }
      stage = 'account_load'
      if (req.dataContext) {
        await req.dataContext.loadAccount(String(tokenData.user?.id || ''), true)
        const incoming = publicUser(tokenData.user)
        const previous = accountUserById(incoming.id)
        // Existing, unchanged contacts cannot introduce a new collision. Only
        // changed contacts need candidate loading; the write transaction still
        // enforces uniqueness under its contact locks.
        await req.dataContext.store.contacts(['email', 'phone'].filter(key => incoming[key] && incoming[key] !== previous?.[key]).map(key => incoming[key]))
        req.dataContext.normalize()
      }
      // 禁用账号不能创建短暂的登录会话，否则后续 /api/auth/me 会静默清掉会话，
      // 前端只能显示“会话未生效”，用户会误以为是地址或 Cookie 问题。
      const existingAccount = accountUserById(tokenData.user?.id)
      if (tokenData.user?.status === 'disabled' || existingAccount?.status === 'disabled') {
        return { location: appendAuthResult(returnTo, 'failed', '该账号已被后台禁用，暂时无法登录，请联系管理员。') }
      }
      stage = 'session_create'
      const session = createAuthSession(tokenData)
      stage = 'session_commit'
      await flushMetadataWrites()
      console.log(JSON.stringify({ event: 'oauth_callback_completed', durationMs: Date.now() - startedAt, sqlCount: req.requestMetrics?.sqlCount }))
      return { session, location: appendAuthResult(returnTo, 'success') }
    } catch (error) {
      // Never log provider errors/messages: they can contain codes or tokens.
      console.error(JSON.stringify({ event: 'oauth_callback_failed', stage,
        durationMs: Date.now() - startedAt,
        code: /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code || '') ? error.code : 'OAUTH_CALLBACK_FAILED' }))
      return { location: appendAuthResult(returnTo, 'failed', error.code === 'ACCOUNT_DISABLED' ? '该账号已被后台禁用，暂时无法登录，请联系管理员。' : '登录服务暂时不可用，请重新登录') }
    } finally {
      // The initial browser redirect can already have finished before persistence.
      // Start the existing independent follow-up only after a successful commit.
      if (res.writableFinished) req.dataContext?.finishResponse()
    }
  }

}
