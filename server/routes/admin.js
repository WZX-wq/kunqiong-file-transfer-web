// admin 域路由（原 server.mjs 内联处理器，逐行搬迁，未改逻辑）
//
// 依赖方向：routes → services → lib → state → config（单向）
// 注册顺序即 Express 匹配顺序，调用点顺序不可调整。
import {
  ADMIN_ACCOUNT_PASSWORD, ADMIN_ACCOUNT_USERNAME, adminCredentialsConfigured, collectionsRoot,
  filesRoot, ACCOUNT_PLANS
} from '../config.js'
import {
  requestIp
} from '../lib/audit.js'
import {
  firstValue, removeDirectory
} from '../lib/http.js'
import {
  configuredAccountPlan, normalizePlanId, normalizeRecordDate, normalizeSystemConfig, publicUser
} from '../lib/metadata-normalizers.js'
import {
  metadata, persistMetadata, refreshAuditPersistence, flushMetadataWrites
} from '../lib/metadata-store.js'
import {
  accountUserById, appendAuthResult, configuredAccountPlans, recordAuditLog, safeReturnUrl, syncAccountUserSessions,
  syncOrganizationTeamPlanFromOwner,
  setOAuthStateCookie
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
import path from 'node:path'

export function registerAdminRoutes(app) {
  app.post('/api/admin/login', (req, res) => {
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

  app.post('/api/admin/cleanup', (req, res) => {
    const auth = requireAdminSession(req, res)
    if (!auth) return
    const result = runMaintenanceCleanup()
    recordAuditLog({ type: 'admin', action: '手动执行存储清理', userId: auth.user.id, details: result })
    res.json({ ...result, overview: buildAdminOverview() })
  })

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

  app.delete('/api/admin/resources/:kind/:id', (req, res) => {
    const auth = requireAdminSession(req, res)
    if (!auth) return
    const kind = String(req.params.kind)
    const id = String(req.params.id)
    if (kind === 'share') {
      const index = metadata.shares.findIndex((item) => item.id === id)
      if (index < 0) return res.status(404).json({ message: '分享资源不存在' })
      const [share] = metadata.shares.splice(index, 1)
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
    res.json({ ok: true, overview: buildAdminOverview() })
  })

  app.get('/auth/callback', async (req, res) => {
    const code = firstValue(req.query.code)
    const state = firstValue(req.query.state)
    const pendingState = consumeOAuthState(state, req)
    const returnTo = pendingState?.returnTo || safeReturnUrl('', req)

    if (!pendingState) return res.redirect(appendAuthResult(returnTo, 'failed', '登录状态已过期，请重新登录'))
    if (!code) return res.redirect(appendAuthResult(returnTo, 'failed', '授权码缺失，请重新登录'))

    try {
      const tokenData = await exchangeOAuthToken(code, pendingState.redirectUri)
      // 禁用账号不能创建短暂的登录会话，否则后续 /api/auth/me 会静默清掉会话，
      // 前端只能显示“会话未生效”，用户会误以为是地址或 Cookie 问题。
      const existingAccount = accountUserById(tokenData.user?.id)
      if (tokenData.user?.status === 'disabled' || existingAccount?.status === 'disabled') {
        setOAuthStateCookie(res, req, state, '')
        return res.redirect(appendAuthResult(returnTo, 'failed', '该账号已被后台禁用，暂时无法登录，请联系管理员。'))
      }
      const session = createAuthSession(tokenData)
      setAuthCookie(res, session.id, session.expiresAt, req)
      setOAuthStateCookie(res, req, state, '')
      res.redirect(appendAuthResult(returnTo, 'success'))
    } catch (error) {
      setOAuthStateCookie(res, req, state, '')
      res.redirect(appendAuthResult(returnTo, 'failed', '登录服务暂时不可用，请重新登录'))
    }
  })

}
