// 鲲穹文件传输服务端入口
//
// 分层说明（重构后）：
//   server/config.js        环境变量、路径与业务常量
//   server/lib/env-file.js  .env 加载
//   server/lib/http.js      HTTP 错误构造与通用纯函数
//   server/store.js         metadata 状态与持久化（后续拆分）
//   server/routes/*.js      业务路由模块（后续拆分）
//
// 本文件保留应用装配、运行期状态与全部路由注册，按域逐步迁移且保持行为不变。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import express from 'express'
import QRCode from 'qrcode'

import {
  ADMIN_ACCOUNT_PASSWORD, ADMIN_ACCOUNT_USERNAME, ADMIN_COOKIE_NAME, ADMIN_LOGIN_MAX_ATTEMPTS,
  ADMIN_LOGIN_WINDOW_MS, ADMIN_SESSION_TTL_MS, AUTH_COOKIE_NAME, MAX_FILES,
  UPLOAD_SESSION_TTL_MS, adminCredentialsConfigured, collectionsRoot, distRoot, filesRoot,
  oauthClientId, oauthClientSecret, oauthTokenUrl, releaseSha, serverPort, storageRoot,
  tempRoot, testEnterpriseForAllUsers, testVerificationDebugMode
} from './server/config.js'

import {
  createToken, firstHeader, firstValue, hashSecret, httpError, parseJson, removeDirectory
} from './server/lib/http.js'

import {
  adminLoginAttempts, adminSessions, databasePool, oauthStates, paymentSessionTokens, runtime,
  uploadReservations, uploadSessions
} from './server/state.js'

import {
  initMetadata, installNormalizer, loadMetadata, metadata, metadataIdSets, persistMetadata
} from './server/lib/metadata-store.js'

// normalizeMetadata 的传递依赖闭包已移至 metadata-normalizers.js；
// 它同时是注入给 metadata-store 的规范化函数来源。
import {
  mergeLoginMethods, normalizeAuditLogs, normalizeMetadata, normalizePaymentQueryCredential,
  normalizePlanId, normalizeRecordDate, normalizeSystemConfig, publicUser, trimRecordString
} from './server/lib/metadata-normalizers.js'

// 按域拆出的路由模块
import {
  registerUpgradeRoutes
} from './server/routes/upgrade.js'
import {
  registerWorkspaceRoutes
} from './server/routes/workspace.js'
import {
  registerAccountRoutes
} from './server/routes/account.js'
// 账号域业务逻辑（路由仍在本文件注册，按域逐步迁移）
import {
  accountOrganizationForUser, accountPersonalPlanForUser, accountUsageForUser, accountUserById,
  appendAuthResult, authSessionFromRequest, cleanupExpired, cleanupExpiredAuthSessions,
  cleanupOAuthStates, cleanupPaymentQueryCredentials, configuredAccountPlans,
  currentCollectionStatus, currentShareStatus, fileListSize, getOrigin, getRequestOrigin,
  isSecureRequest, isSmtpConfigured, isTencentSmsConfigured, normalizeContactTarget,
  parseAccountRecordResource, readCookie, reconcileUpgradeOrder, reconcileUserUpgradeOrders,
  recordAuditLog, retainUserPaymentQueryCredentials, safeRelativePath, safeReturnUrl,
  serializeCookie, sessionApiWebToken, syncAccountUserSessions, syncOrganizationMemberProfile,
  upsertAccountUser
} from './server/services/account.js'

// 按域拆出的路由模块
import { registerShareCreateRoutes, registerShareAccessRoutes } from './server/routes/shares.js'
import { registerUploadRoutes } from './server/routes/upload.js'

// 分享/上传域业务逻辑（路由仍在本文件注册，按域逐步迁移）
import {
  addCollectionSubmissionMessage, addGuestUsage, adminSessionFromRequest,
  assertAccountCapacity, assertCollectionFiles, assertConfiguredUploadLimits,
  assertFilesDownloadable, assertGuestQuota, assertSafeUploadFiles, assertServiceWritable,
  assertUploadCapacity, cleanupExpiredAdminSessions, cleanupUploadedFiles,
  collectionCapacityBytes, enforceDownloadOrigin, ensureStoredFilesScanned,
  enterpriseOrganizationForUser, guestQuotaLimitBytes, guestUsageEntry, isAllowedType,
  normalizeCollectionAllowedTypes, normalizeExpiryInput, publicSubmission,
  reserveUploadCapacity, resolveCollectionSubmitter, resolveGuestKey, resolveRecipientUserIds,
  restoreUploadSessions, sendDownloadFile, sendPreviewFile, streamZip, validateCollection,
  validateEnterpriseSlug, zipEntryPath
} from './server/services/shares.js'
import {
  normalizeUploadedFileNames, upload
} from './server/lib/upload.js'

// 业务常量（套餐、默认通知/清理设置、默认站内消息）已移至 server/config.js。
const serverHost = process.env.HOST || process.env.KUNQIONG_HOST || '0.0.0.0'
// 元数据并发写保护：revision 是快照的单调版本号，落盘走 CAS（MySQL 用 WHERE revision = ?）。
// 冲突时重读远端 + 合并 + 重试，避免多实例各自拿启动时的旧快照互相覆盖。
// MySQL 模式以数据库为准（metadata.json 只作镜像，不参与 CAS）；
// 本地模式以文件为准，用旁挂的 .revision 文件记录版本。两条路径各自独立计数。
// 快照合并规则（合并算法见后面的 mergeMetadataSnapshots）。放在模块顶部是因为
// 启动阶段就会调用 metadataIdSets，必须早于任何落盘动作完成初始化。
// 连接池与限流/会话状态已移至 server/state.js（全进程共享同一实例，见该文件说明）。

for (const directory of [storageRoot, tempRoot, filesRoot, collectionsRoot]) {
  fs.mkdirSync(directory, { recursive: true })
}

// ① 先注入领域规范化函数，之后 loadMetadata / mergeMetadataSnapshots 才会真正做规范化
//    （顺序不可颠倒：loadMetadata 内部就要调用它）
installNormalizer(normalizeMetadata)
// ② 再载入并就地填充 metadata 快照
initMetadata(normalizeMetadata(await loadMetadata()))
runtime.metadataBaseIds = metadataIdSets(metadata)
runtime.metadataLocalBaseIds = runtime.metadataBaseIds
for (const share of metadata.shares) {
  if (share.deliveryRecipients?.length && !Array.isArray(share.recipientUserIds)) {
    const notifiedIds = (share.notificationLog || []).flatMap((entry) => entry.deliveredUserIds || [])
    share.recipientUserIds = [...new Set([...notifiedIds, ...resolveRecipientUserIds(share.deliveryRecipients, true)])]
    share.recipientContacts = share.deliveryRecipients.filter((recipient) => normalizeContactTarget(recipient) && !resolveRecipientUserIds([recipient], true).length)
    runtime.metadataNeedsPersist = true
  }
}
runtime.metadataReady = metadata
if (runtime.metadataNeedsPersist) persistMetadata()
const app = express()

app.set('trust proxy', true)
app.use(express.json({ limit: '1mb' }))
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) {
    res.setHeader('Cache-Control', 'no-store')
  }
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('X-Frame-Options', 'DENY')
  const startedAt = Date.now()
  res.on('finish', () => {
    if (req.path === '/api/health' || (!req.path.startsWith('/api/') && !req.path.startsWith('/auth/'))) return
    recordAuditLog({
      type: 'access',
      action: `${req.method} ${sanitizeAuditPath(req.path)}`,
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
      userId: authSessionFromRequest(req)?.user?.id || '',
      ip: requestIp(req),
    })
  })
  next()
})

app.use((req, res, next) => {
  if (!req.path.startsWith('/api/') || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next()
  const origin = firstHeader(req.get('origin'))
  if (!origin) return next()
  if (origin !== getRequestOrigin(req)) {
    // vite dev(4173) 经代理转发时会改写 Host，导致 Origin 与站点不一致；
    // 与 enforceDownloadOrigin 的本机 dev 白名单同口径放行（仅限开发端口，浏览器无法伪造该 Origin）。
    if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]):4173$/.test(origin)) return next()
    return res.status(403).json({ message: '请求来源不受信任' })
  }
  next()
})

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'kunqiong-local-api',
    release: releaseSha,
    now: new Date().toISOString(),
    test: process.env.NODE_ENV === 'test',
    testEnterpriseForAllUsers,
    verification: {
      email: isSmtpConfigured(),
      sms: isTencentSmsConfigured(),
      debugFallback: testVerificationDebugMode,
    },
  })
})

app.get('/api/runtime-config', (_req, res) => {
  const config = normalizeSystemConfig(metadata.systemConfig)
  res.json({
    defaultShareDays: config.defaultShareDays,
    maxShareDays: config.maxShareDays,
    maxBatchFiles: config.maxBatchFiles,
    anonymousMaxFileSizeMb: config.anonymousMaxFileSizeMb,
    anonymousTotalSizeMb: config.anonymousTotalSizeMb,
  })
})

// 未登录传输配额查询：顺便给首次访客发游客 cookie，保证后续上传按同一设备计账。
app.get('/api/guest/quota', (req, res) => {
  const limitBytes = guestQuotaLimitBytes()
  const guestKey = resolveGuestKey(req, res)
  if (!limitBytes || !guestKey) {
    return res.json({ enabled: false, limitBytes: 0, usedBytes: 0, remainingBytes: null })
  }
  const usedBytes = guestUsageEntry(guestKey).bytes
  res.json({
    enabled: true,
    limitBytes,
    usedBytes,
    remainingBytes: Math.max(0, limitBytes - usedBytes),
  })
})
// 按域注册业务路由（顺序即 Express 匹配顺序，不可调整）
registerAccountRoutes(app)
registerWorkspaceRoutes(app)
registerUpgradeRoutes(app)

// 成员主动退出团队空间。
// 与「移除成员」的区别：这条不需要团队版权益、也不需要管理员身份 ——
// 退出是自己的权利，只要你是该团队的普通成员即可执行。团队所有者不能退出（需先解散/转让）。

// 转让团队所有权：所有者指定一位正式成员接管团队。
// 转让后原所有者降级为普通成员，可随时退出团队空间；团队权益（容量、成员管理）跟随「当前所有者的个人套餐」，
// 因此若新所有者没有团队版/企业版权益，团队空间功能会停用（成员个人套餐与文件不受影响），通知里会明确提示。

// 解散团队：所有者专属的最高危操作，解散后所有成员立即失去团队空间访问权。
// 成员的个人文件、个人空间与套餐不受影响（与退出/移除同一语义）；团队分享、收集与站内归属一并清除。

// 入团申请：公开查询入口。分享/收集链接带 ?organization=slug 时会调用它，决定是否展示「申请加入团队」。

// 入团申请：所有者审批。同意后申请人直接成为正式成员，拒绝后进入 24 小时冷却。

// 升级弹窗展示价：与订单创建同源（远端主站套餐实价），避免「展示 ¥0.01、下单 ¥19」的口径分裂

app.post('/api/admin/login', (req, res) => {
  if (!adminCredentialsConfigured) return res.status(503).json({ message: '后台登录未配置，请设置管理员账号和密码' })
  if (adminLoginRateLimited(req)) {
    return res.status(429).json({ message: '登录尝试过于频繁，请稍后再试' })
  }
  const username = trimRecordString(req.body?.username, 120)
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
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

app.get('/api/admin/overview', (req, res) => {
  const auth = requireAdminSession(req, res)
  if (!auth) return
  res.json(buildAdminOverview())
})

// 测试服验收专用：用管理员口令会话为指定用户签发一个登录会话，
// 便于在真实数据上做端到端验收（此前只能靠浏览器里 monkey-patch /api/auth/me，
// 那种做法拿不到该用户的真实团队/资源，UI 断言会被跳过）。
//
// 安全约束（三条缺一不可）：
//   1) 必须是已有的管理员口令会话（requireAdminSession）；
//   2) 仅测试服可用（NODE_ENV === 'test'），生产环境直接 404，连端点都不存在；
//   3) 只允许给「已存在」的用户签发，不能凭此创建新用户。
// 返回的 sessionId 等同于该用户的登录态，因此不落审计 details，
// 只记录「谁给谁签发了验收会话」这一事实。
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

app.patch('/api/admin/config', (req, res) => {
  const auth = requireAdminSession(req, res)
  if (!auth) return
  metadata.systemConfig = normalizeSystemConfig({
    ...metadata.systemConfig,
    ...req.body,
    planOverrides: req.body?.planOverrides || metadata.systemConfig.planOverrides,
  })
  persistMetadata()
  recordAuditLog({ type: 'admin', action: '更新系统配置', userId: auth.user.id, details: metadata.systemConfig })
  res.json({ config: metadata.systemConfig })
})

app.patch('/api/admin/users/:userId', (req, res) => {
  const auth = requireAdminSession(req, res)
  if (!auth) return
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
  user.status = status
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'planExpiresAt')) {
    user.planExpiresAt = normalizeRecordDate(req.body.planExpiresAt)
  }
  user.updatedAt = new Date().toISOString()
  if (status === 'disabled') {
    metadata.sessions = metadata.sessions.filter((item) => item.user?.id !== user.id)
  }
  syncAccountUserSessions(user)
  persistMetadata()
  recordAuditLog({ type: 'admin', action: '更新用户状态或权益', userId: auth.user.id, targetId: user.id, details: { status, planId } })
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
  const pendingState = consumeOAuthState(state)
  const returnTo = pendingState?.returnTo || safeReturnUrl('', req)

  if (!pendingState) return res.redirect(appendAuthResult(returnTo, 'failed', '登录状态已过期，请重新登录'))
  if (!code) return res.redirect(appendAuthResult(returnTo, 'failed', '授权码缺失，请重新登录'))

  try {
    const tokenData = await exchangeOAuthToken(code, pendingState.redirectUri)
    const session = createAuthSession(tokenData)
    setAuthCookie(res, session.id, session.expiresAt, req)
    res.redirect(appendAuthResult(returnTo, 'success'))
  } catch (error) {
    res.redirect(appendAuthResult(returnTo, 'failed', error.message || '登录失败'))
  }
})
// 按域注册业务路由（顺序即 Express 匹配顺序，不可调整）
registerShareCreateRoutes(app)
registerUploadRoutes(app)
registerShareAccessRoutes(app)

// 查取计数表 shareLookupAttempts 在 server/state.js

app.post('/api/collections', async (req, res, next) => {
  try {
    assertServiceWritable(req)
    const ownerSession = authSessionFromRequest(req)
    const title = String(req.body.title || '').trim()
    if (!title) return res.status(400).json({ message: '请填写任务名称' })
    const token = createToken(10)
    const manageToken = createToken(18)
    const deadline = normalizeExpiryInput(req.body.deadline || new Date(Date.now() + 7 * 86400000).toISOString(), '截止时间')
    if (!deadline) return res.status(400).json({ message: '截止时间格式不正确' })
    const task = {
      id: token,
      token,
      manageToken,
      title,
      description: String(req.body.description || '请上传你负责的文件'),
      deadline,
      allowedTypes: normalizeCollectionAllowedTypes(req.body.allowedTypes),
      maxFileSizeMb: Number(req.body.maxFileSizeMb || 500),
      capacityBytes: ownerSession?.user?.id ? null : guestQuotaLimitBytes() || 1024 * 1024 * 1024,
      createdAt: new Date().toISOString(),
      ownerUserId: ownerSession?.user?.id || '',
      status: 'active',
      submissions: [],
    }
    task.qrDataUrl = await QRCode.toDataURL(`${getOrigin(req)}/collect/${token}`, { width: 180, margin: 1 })
    metadata.collections.push(task)
    persistMetadata()
    res.status(201).json({ collection: publicCollection(task, req, true), manageToken })
  } catch (error) {
    next(error)
  }
})

app.get('/api/collections/:token', async (req, res, next) => {
  try {
    const task = metadata.collections.find((item) => item.token === req.params.token)
    if (!task) return res.status(404).json({ message: '收集任务不存在' })
    if (!validateEnterpriseSlug(task, req.query.organization)) return res.status(404).json({ message: '企业专属链接无效' })
    const access = validateCollection(task)
    if (!access.ok) return res.status(access.status).json({ message: access.message })
    if (await ensureCollectionQrDataUrl(task, req)) persistMetadata()
    res.json({ collection: publicCollection(task, req) })
  } catch (error) {
    next(error)
  }
})

app.post('/api/collections/:token/submissions', upload.array('files', MAX_FILES), normalizeUploadedFileNames, async (req, res, next) => {
  let reservationId
  try {
    assertServiceWritable(req)
    const task = metadata.collections.find((item) => item.token === req.params.token)
    if (!task) {
      cleanupUploadedFiles(req.files)
      return res.status(404).json({ message: '收集任务不存在' })
    }
    const access = validateCollection(task)
    if (!access.ok) {
      cleanupUploadedFiles(req.files)
      return res.status(access.status).json({ message: access.message })
    }
    const submitter = resolveCollectionSubmitter(req)
    const participantName = submitter.participantName
    if (!participantName) {
      cleanupUploadedFiles(req.files)
      return res.status(400).json({ message: '请先登录，或填写提交人名称' })
    }
    const uploadedFiles = req.files || []
    if (!uploadedFiles.length) {
      return res.status(400).json({ message: '至少选择一个文件' })
    }
    assertConfiguredUploadLimits(req, uploadedFiles)
    const guestKey = assertGuestQuota(req, res, uploadedFiles)
    assertCollectionFiles(task, uploadedFiles)
    reservationId = reserveUploadCapacity({ files: uploadedFiles, guestKey, collectionToken: task.token, capacityOwnerUserId: task.ownerUserId })
    await assertSafeUploadFiles(uploadedFiles)
    const invalidFile = uploadedFiles.find((file) => file.size > task.maxFileSizeMb * 1024 * 1024 || !isAllowedType(file.originalname, task.allowedTypes))
    if (invalidFile) {
      cleanupUploadedFiles(uploadedFiles)
      return res.status(413).json({ message: `${invalidFile.originalname} 不符合当前收集任务的文件限制` })
    }
    assertAccountCapacity(accountUserById(task.ownerUserId), uploadedFiles.reduce((sum, file) => sum + file.size, 0))
    assertUploadCapacity(uploadReservations.get(reservationId), reservationId)
    const finalAccess = validateCollection(task)
    if (!finalAccess.ok) throw httpError(finalAccess.status, finalAccess.message)
    assertCollectionFiles(task, uploadedFiles)
    const submissionId = createToken(12)
    const submissionDirectory = path.join(collectionsRoot, task.id, submissionId)
    fs.mkdirSync(submissionDirectory, { recursive: true })
    const relativePaths = parseJson(req.body.relativePaths, [])
    const files = uploadedFiles.map((file, index) => {
      const relativePath = safeRelativePath(relativePaths[index] || file.originalname)
      const storedName = `${String(index + 1).padStart(2, '0')}-${crypto.randomBytes(4).toString('hex')}-${path.basename(relativePath)}`
      fs.renameSync(file.path, path.join(submissionDirectory, storedName))
      return { name: file.originalname, relativePath, storedName, size: file.size, mimeType: file.mimetype || 'application/octet-stream', reviewStatus: file.reviewStatus, scanEngine: file.scanEngine, scannedAt: file.scannedAt }
    })
    const submission = {
      id: submissionId,
      participantName,
      submitterUserId: submitter.submitterUserId,
      submitterName: submitter.submitterName || participantName,
      submittedAt: new Date().toISOString(),
      files,
    }
    task.submissions.push(submission)
    addCollectionSubmissionMessage(task, submission, req)
    addGuestUsage(guestKey, files)
    persistMetadata()
    res.status(201).json({ submission: publicSubmission(submission) })
  } catch (error) {
    cleanupUploadedFiles(req.files)
    next(error)
  } finally {
    if (reservationId) uploadReservations.delete(reservationId)
  }
})

app.get('/api/collections/manage/:manageToken', async (req, res, next) => {
  try {
    const task = metadata.collections.find((item) => item.manageToken === req.params.manageToken)
    if (!task) return res.status(404).json({ message: '管理链接不存在' })
    if (await ensureCollectionQrDataUrl(task, req)) persistMetadata()
    res.json({ collection: managerCollection(task, req) })
  } catch (error) {
    next(error)
  }
})

app.patch('/api/collections/manage/:manageToken', async (req, res, next) => {
  try {
    const task = metadata.collections.find((item) => item.manageToken === req.params.manageToken)
    if (!task) return res.status(404).json({ message: '管理链接不存在' })
    applyCollectionUpdate(task, req.body || {})
    await ensureCollectionQrDataUrl(task, req)
    task.updatedAt = new Date().toISOString()
    persistMetadata()
    res.json({ collection: managerCollection(task, req) })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/collections/manage/:manageToken', (req, res, next) => {
  try {
    const index = metadata.collections.findIndex((item) => item.manageToken === req.params.manageToken)
    if (index < 0) return res.status(404).json({ message: '管理链接不存在' })
    const [task] = metadata.collections.splice(index, 1)
    removeDirectory(path.join(collectionsRoot, task.id))
    persistMetadata()
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/collections/manage/:manageToken/submissions/:submissionId', (req, res, next) => {
  try {
    const task = metadata.collections.find((item) => item.manageToken === req.params.manageToken)
    if (!task) return res.status(404).json({ message: '管理链接不存在' })
    const submissionIndex = task.submissions.findIndex((item) => item.id === req.params.submissionId)
    if (submissionIndex < 0) return res.status(404).json({ message: '提交记录不存在' })
    const [submission] = task.submissions.splice(submissionIndex, 1)
    removeDirectory(path.join(collectionsRoot, task.id, submission.id))
    task.updatedAt = new Date().toISOString()
    persistMetadata()
    res.json({ collection: managerCollection(task, req) })
  } catch (error) {
    next(error)
  }
})

app.get('/api/collections/manage/:manageToken/download', async (req, res, next) => {
  try {
    enforceDownloadOrigin(req)
    const task = metadata.collections.find((item) => item.manageToken === req.params.manageToken)
    if (!task) return res.status(404).json({ message: '管理链接不存在' })
    assertFilesDownloadable(task.submissions.flatMap((submission) => submission.files || []))
    for (const submission of task.submissions) await ensureStoredFilesScanned(submission.files, path.join(collectionsRoot, task.id, submission.id))
    const entries = collectionZipEntries(task)
    if (!entries.length) return res.status(404).json({ message: '暂无可下载的提交文件' })
    await streamZip(res, next, `${task.title || '收集文件'}.zip`, entries)
  } catch (error) {
    next(error)
  }
})

app.get('/api/collections/manage/:manageToken/submissions/:submissionId/download', async (req, res, next) => {
  try {
    enforceDownloadOrigin(req)
    const task = metadata.collections.find((item) => item.manageToken === req.params.manageToken)
    if (!task) return res.status(404).json({ message: '管理链接不存在' })
    const submission = task.submissions.find((item) => item.id === req.params.submissionId)
    if (!submission) return res.status(404).json({ message: '提交记录不存在' })
    assertFilesDownloadable(submission.files || [])
    await ensureStoredFilesScanned(submission.files, path.join(collectionsRoot, task.id, submission.id))
    const entries = collectionZipEntries(task, submission)
    if (!entries.length) return res.status(404).json({ message: '暂无可下载的提交文件' })
    await streamZip(res, next, `${submission.participantName || '提交文件'}.zip`, entries)
  } catch (error) {
    next(error)
  }
})

app.get('/api/collections/manage/:manageToken/submissions/:submissionId/files/:fileIndex/download', async (req, res, next) => {
  try {
    enforceDownloadOrigin(req)
    const task = metadata.collections.find((item) => item.manageToken === req.params.manageToken)
    if (!task) return res.status(404).json({ message: '管理链接不存在' })
    const submission = task.submissions.find((item) => item.id === req.params.submissionId)
    const file = submission?.files[Number(req.params.fileIndex)]
    if (!file) return res.status(404).json({ message: '文件不存在' })
    assertFilesDownloadable([file])
    await ensureStoredFilesScanned([file], path.join(collectionsRoot, task.id, submission.id))
    sendDownloadFile(req, res, next, path.join(collectionsRoot, task.id, submission.id, file.storedName), file)
  } catch (error) {
    next(error)
  }
})

app.get('/api/collections/manage/:manageToken/submissions/:submissionId/files/:fileIndex/preview', async (req, res, next) => {
  try {
    enforceDownloadOrigin(req)
    const task = metadata.collections.find((item) => item.manageToken === req.params.manageToken)
    if (!task) return res.status(404).json({ message: '管理链接不存在' })
    const submission = task.submissions.find((item) => item.id === req.params.submissionId)
    const file = submission?.files[Number(req.params.fileIndex)]
    if (!file) return res.status(404).json({ message: '文件不存在' })
    assertFilesDownloadable([file])
    await ensureStoredFilesScanned([file], path.join(collectionsRoot, task.id, submission.id))
    sendPreviewFile(req, res, next, path.join(collectionsRoot, task.id, submission.id, file.storedName), file)
  } catch (error) {
    next(error)
  }
})

app.use('/api', (_req, res) => {
  res.status(404).json({ message: '接口不存在' })
})

if (fs.existsSync(distRoot)) {
  app.use(express.static(distRoot, {
    maxAge: '7d',
    immutable: true,
    setHeaders(res, filePath) {
      // HTML 入口（index.html、user-manual.html 等）不缓存，发版后立即生效；其余静态资源 7 天强缓存
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache')
      }
    },
  }))
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(path.join(distRoot, 'index.html'))
  })
}

app.use((error, _req, res, _next) => {
  console.error(error)
  if (error.status) {
    // guestQuota 仅在游客配额超限时存在，前端据此渲染引导弹窗；code 供前端区分业务错误。
    const payload = { message: error.message || '请求处理失败' }
    if (error.code) payload.code = error.code
    if (error.guestQuota) payload.guestQuota = error.guestQuota
    return res.status(error.status).json(payload)
  }
  if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ message: '文件超过 5 GB 限制' })
  if (error.code === 'LIMIT_FILE_COUNT') return res.status(413).json({ message: `单次最多上传 ${MAX_FILES} 个文件` })
  res.status(500).json({ message: '服务器处理失败，请稍后重试' })
})

const server = app.listen(serverPort, serverHost, () => {
  console.log(`鲲穹服务 listening on http://${serverHost === '0.0.0.0' ? 'localhost' : serverHost}:${serverPort}`)
})

const cleanupTimer = setInterval(() => {
  cleanupExpired()
  cleanupUploadSessions()
}, 60 * 1000)
cleanupTimer.unref()
const paymentTimer = setInterval(() => { reconcileActiveUpgradeOrders().catch(() => {}) }, 30000)
paymentTimer.unref()
const initialPaymentCheck = setTimeout(() => { reconcileActiveUpgradeOrders().catch(() => {}) }, 1000)
initialPaymentCheck.unref()
// 审计日志按保留期每日自动清除（只动 auditLogs，不碰资源清理——purgeStaleResources 绝不进定时链路）
const auditLogTimer = setInterval(() => {
  try {
    purgeExpiredAuditLogs()
  } catch (error) {
    console.warn('[audit-log-cleanup] failed:', error?.message || error)
  }
}, 24 * 60 * 60 * 1000)
auditLogTimer.unref()
restoreUploadSessions()
cleanupExpired()
cleanupUploadSessions()

let shuttingDown = false
async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  clearInterval(cleanupTimer)
  clearInterval(paymentTimer)
  clearTimeout(initialPaymentCheck)
  try {
    await runtime.metadataWriteQueue
    if (databasePool) await databasePool.end()
    server.close(() => process.exit(0))
  } catch (error) {
    console.error(`服务关闭时保存数据失败（${signal}）：${error.message || error}`)
    process.exit(1)
  }
}
process.once('SIGINT', () => { shutdown('SIGINT').catch(() => process.exit(1)) })
process.once('SIGTERM', () => { shutdown('SIGTERM').catch(() => process.exit(1)) })

function requestIp(req) {
  const raw = firstHeader(req.get('x-forwarded-for')) || req.socket?.remoteAddress || ''
  return hashSecret(raw).slice(0, 16)
}

function sanitizeAuditPath(value = '') {
  return String(value)
    .replace(/\/manage\/[^/]+/g, '/manage/[token]')
    .replace(/\/(shares|collections|upload-sessions)\/[^/]+/g, '/$1/[token]')
    .replace(/\/(share|collect)\/[^/]+/g, '/$1/[token]')
}

function createAdminSession(req) {
  cleanupExpiredAdminSessions()
  const token = createToken(48)
  const session = {
    token,
    username: ADMIN_ACCOUNT_USERNAME,
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + ADMIN_SESSION_TTL_MS,
    lastIp: clientIpFromRequest(req),
  }
  adminSessions.set(token, session)
  return session
}

function adminSessionDescriptor(session) {
  if (!session) return null
  return {
    username: session.username,
    userId: `admin:${session.username}`,
    createdAt: session.createdAt,
    expiresAt: new Date(session.expiresAt).toISOString(),
  }
}

function removeAdminSession(req) {
  const token = readCookie(req, ADMIN_COOKIE_NAME)
  if (token) adminSessions.delete(token)
}

function setAdminCookie(res, token, req) {
  res.setHeader('Set-Cookie', serializeCookie(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    maxAge: Math.floor(ADMIN_SESSION_TTL_MS / 1000),
    path: '/',
    sameSite: 'Lax',
    secure: isSecureRequest(req),
  }))
}

function clearAdminCookie(res, req) {
  res.setHeader('Set-Cookie', serializeCookie(ADMIN_COOKIE_NAME, '', {
    httpOnly: true,
    maxAge: 0,
    path: '/',
    sameSite: 'Lax',
    secure: isSecureRequest(req),
  }))
}

function clientIpFromRequest(req) {
  return firstHeader(req.get('x-forwarded-for'))?.split(',')[0]?.trim() || req.ip || ''
}

// 限流用的客户端标识。
//
// ⚠️ app.set('trust proxy', true) 会让 x-forwarded-for 被无条件信任，
// 攻击者只要每次请求换一个伪造的 XFF 值，就能把限流计数摊到无数个「IP」上 ——
// 后台口令登录的 8 次/10 分钟形同虚设，等于给了无限次暴力破解机会。
// 因此这里**不采用 XFF 作为限流键**，而是用真实 socket 地址；
// 同时再挂一个全局桶兜底，防止伪造/代理场景下按 IP 完全绕开。
function adminRateLimitKeys(req) {
  const socketIp = String(req.socket?.remoteAddress || '').trim()
  const proxyIp = clientIpFromRequest(req)
  const keys = [`socket:${socketIp || 'unknown'}`]
  if (proxyIp && proxyIp !== socketIp) keys.push(`proxy:${proxyIp}`)
  // 全局兜底桶：无论怎么伪造上游头，总量都受限，避免完全敞开
  keys.push('global')
  return keys
}

function adminLoginRateLimited(req) {
  const now = Date.now()
  return adminRateLimitKeys(req).some((key) => {
    const record = adminLoginAttempts.get(key)
    if (!record || now - record.startedAt > ADMIN_LOGIN_WINDOW_MS) return false
    // 全局桶给更宽松的额度，以免正常用户被少量失败拖累
    const limit = key === 'global' ? ADMIN_LOGIN_MAX_ATTEMPTS * 6 : ADMIN_LOGIN_MAX_ATTEMPTS
    return record.count >= limit
  })
}

function recordAdminLoginFailure(req) {
  const now = Date.now()
  for (const key of adminRateLimitKeys(req)) {
    const record = adminLoginAttempts.get(key)
    if (!record || now - record.startedAt > ADMIN_LOGIN_WINDOW_MS) {
      adminLoginAttempts.set(key, { count: 1, startedAt: now })
      continue
    }
    record.count += 1
  }
}

function clearAdminLoginFailures(req) {
  for (const key of adminRateLimitKeys(req)) adminLoginAttempts.delete(key)
}

function safeEqualString(a, b) {
  const left = Buffer.from(String(a ?? ''), 'utf8')
  const right = Buffer.from(String(b ?? ''), 'utf8')
  if (left.length !== right.length) return false
  return crypto.timingSafeEqual(left, right)
}

// 返回 { session } 表示通过管理员口令校验；返回 null 时已写出错误响应。
//
// 后台**只认管理员账号口令**（cookie kunqiong_admin_session）。
// 鲲穹账号通道（KUNQIONG_ADMIN_USER_IDS 白名单）已移除：它让白名单账号
// 无需密码即可进入后台，是权限绕过。注意 isAdminUser 仍保留，
// 它只用于维护模式等服务端豁免，不再参与后台鉴权。
function requireAdminSession(req, res) {
  const adminSession = adminSessionFromRequest(req)
  if (adminSession) return { type: 'credential', session: adminSession, user: { id: `admin:${adminSession.username}`, name: adminSession.username } }
  res.status(401).json({ message: '请先使用管理员账号密码登录后台' })
  return null
}

function adminUserSummary(user) {
  const usage = accountUsageForUser(user.id)
  const organization = accountOrganizationForUser(user.id)
  // 后台用户列表展示的是**个人套餐** —— 加入团队不应让这个用户看起来被升级了。
  // 团队归属另用 organizationName 表达，两者互不混淆。
  const plan = accountPersonalPlanForUser(user)
  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    email: user.email,
    phone: user.phone,
    status: user.status || 'active',
    planId: plan.id,
    planLabel: plan.label,
    planExpiresAt: user.planExpiresAt || null,
    organizationName: organization?.name || '',
    organizationRole: organization ? (organization.ownerUserId === user.id ? 'owner' : 'member') : '',
    usageBytes: usage.usedBytes,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }
}

function adminResourceSummary(kind, item) {
  const files = kind === 'share'
    ? item.files || []
    : (item.submissions || []).flatMap((submission) => submission.files || [])
  return {
    id: item.id || item.token,
    kind,
    name: kind === 'share' ? (files[0]?.name || '文件分享') : (item.title || '收集任务'),
    code: kind === 'share' ? (item.code || '') : '',
    ownerUserId: item.ownerUserId || '',
    status: kind === 'share' ? currentShareStatus(item) : currentCollectionStatus(item),
    fileCount: files.length,
    totalSize: fileListSize(files),
    createdAt: item.createdAt,
    expiresAt: kind === 'share' ? item.expiresAt : item.deadline,
  }
}

function buildAdminOverview() {
  const users = Object.values(metadata.users || {}).map(adminUserSummary).sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
  const resources = [
    ...metadata.shares.map((item) => adminResourceSummary('share', item)),
    ...metadata.collections.map((item) => adminResourceSummary('collection', item)),
  ].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
  const totalBytes = resources.reduce((sum, item) => sum + item.totalSize, 0)
  const trend = adminTrendStats()
  const auditLogsAll = normalizeAuditLogs(metadata.auditLogs)
  return {
    stats: {
      users: users.length,
      activeUsers: users.filter((user) => user.status !== 'disabled').length,
      shares: metadata.shares.length,
      collections: metadata.collections.length,
      files: resources.reduce((sum, item) => sum + item.fileCount, 0),
      totalBytes,
      activeResources: resources.filter((item) => item.status === 'active').length,
      activeOrganizations: Object.keys(metadata.organizations || {}).length,
      pendingCleanup: resources.filter((item) => item.status !== 'active' || (item.expiresAt && new Date(item.expiresAt).getTime() <= Date.now())).length,
    },
    trend,
    // 列表接口有 200/100 条截断，totals 保留真实总数供前端提示「仅显示前 N 条」
    totals: { users: users.length, resources: resources.length, auditLogs: auditLogsAll.length },
    users: users.slice(0, 200),
    resources: resources.slice(0, 200),
    auditLogs: auditLogsAll.slice(0, 100),
    config: normalizeSystemConfig(metadata.systemConfig),
    plans: configuredAccountPlans(),
  }
}

function adminTrendStats() {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date()
    date.setHours(0, 0, 0, 0)
    date.setDate(date.getDate() - (6 - index))
    return date
  })
  return days.map((date) => {
    const next = new Date(date)
    next.setDate(next.getDate() + 1)
    const logs = normalizeAuditLogs(metadata.auditLogs).filter((item) => {
      const time = new Date(item.createdAt).getTime()
      return time >= date.getTime() && time < next.getTime()
    })
    const activeUsers = new Set(logs.map((item) => item.userId).filter(Boolean)).size
    const uploads = logs.filter((item) => /POST (?:\/api\/shares|\/api\/upload-sessions|\/api\/collections)/.test(item.action)).length
    const downloads = logs.filter((item) => /GET \/api\/(?:shares|collections\/manage)\/.*download/.test(item.action) && item.status >= 200 && item.status < 300).length
    return {
      date: date.toISOString().slice(0, 10),
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      activeUsers,
      uploads,
      downloads,
    }
  })
}

function cleanupStorageOrphans() {
  const graceMs = normalizeSystemConfig(metadata.systemConfig).orphanGraceHours * 3600000
  const cutoff = Date.now() - graceMs
  const validShareIds = new Set(metadata.shares.map((item) => item.id))
  const validCollectionIds = new Set(metadata.collections.map((item) => item.id))
  const removed = { shares: 0, collections: 0 }
  const statMtimeMs = (target) => {
    try { return fs.statSync(target).mtimeMs } catch { return 0 }
  }
  for (const entry of safeDirectoryEntries(filesRoot)) {
    const target = path.join(filesRoot, entry)
    if (!validShareIds.has(entry) && statMtimeMs(target) < cutoff) {
      removeDirectory(target)
      removed.shares += 1
    }
  }
  for (const entry of safeDirectoryEntries(collectionsRoot)) {
    const target = path.join(collectionsRoot, entry)
    if (!validCollectionIds.has(entry) && statMtimeMs(target) < cutoff) {
      removeDirectory(target)
      removed.collections += 1
    }
  }
  return removed
}

function safeDirectoryEntries(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return []
  }
}

// 资源被清掉后，把各用户记录里仍指向这些资源的条目一并摘除，避免记录页出现「点了就 410」的死链。
function pruneRecordsForPurgedResources(shareKeys, collectionKeys) {
  if ((!shareKeys || !shareKeys.size) && (!collectionKeys || !collectionKeys.size)) return
  for (const [userId, records] of Object.entries(metadata.records || {})) {
    if (!Array.isArray(records) || !records.length) continue
    const next = records.filter((record) => {
      const parsed = parseAccountRecordResource(record.id)
      if (!parsed) return true
      if (parsed.kind === 'share') return !shareKeys.has(parsed.key)
      return !collectionKeys.has(parsed.key)
    })
    if (next.length !== records.length) metadata.records[userId] = next
  }
}

// 后台「执行清理」的实质动作：把所有已关闭/过期的非团队资源连同文件彻底移除。
// ⚠️ 只能由 POST /api/admin/cleanup（带确认弹窗）触发，绝不能挂进 cleanupExpired 定时链路 ——
// 团队资源关闭后所有者仍可打开/重新开启，自动清理会让「重新开启分享」功能变成摆设。
function purgeStaleResources() {
  const removed = { shares: 0, collections: 0 }
  // 团队资源关闭后仍归团队空间与所有者管理，不参与清理
  const staleShares = metadata.shares.filter((share) => !share.teamResource && currentShareStatus(share) !== 'active')
  if (staleShares.length) {
    const removedShareKeys = new Set()
    for (const share of staleShares) {
      removeDirectory(path.join(filesRoot, share.id))
      removedShareKeys.add(share.id)
      if (share.manageToken) removedShareKeys.add(share.manageToken)
      if (share.code) removedShareKeys.add(share.code)
    }
    metadata.shares = metadata.shares.filter((share) => !staleShares.includes(share))
    removed.shares = staleShares.length
    pruneRecordsForPurgedResources(removedShareKeys, new Set())
  }
  const staleCollections = metadata.collections.filter((task) => currentCollectionStatus(task) !== 'active')
  if (staleCollections.length) {
    const removedCollectionKeys = new Set()
    for (const task of staleCollections) {
      removeDirectory(path.join(collectionsRoot, task.id))
      if (task.id) removedCollectionKeys.add(task.id)
      if (task.token) removedCollectionKeys.add(task.token)
      if (task.manageToken) removedCollectionKeys.add(task.manageToken)
    }
    metadata.collections = metadata.collections.filter((task) => !staleCollections.includes(task))
    removed.collections = staleCollections.length
    pruneRecordsForPurgedResources(new Set(), removedCollectionKeys)
  }
  return removed
}

// 按系统配置的保留天数清除过期审计日志；只有真删了才落盘，避免空转写
function purgeExpiredAuditLogs() {
  const before = metadata.auditLogs.length
  const retentionMs = normalizeSystemConfig(metadata.systemConfig).auditLogRetentionDays * 86400000
  const cutoff = Date.now() - retentionMs
  metadata.auditLogs = normalizeAuditLogs(metadata.auditLogs).filter((item) => new Date(item.createdAt).getTime() >= cutoff)
  const removed = Math.max(0, before - metadata.auditLogs.length)
  if (removed > 0) persistMetadata()
  return removed
}

function runMaintenanceCleanup() {
  cleanupExpired()
  // 真实清除已关闭/过期资源（此前 cleanupExpired 只标记状态不删对象，expiredShares 恒为 0 的假计数由此而来）
  const purged = purgeStaleResources()
  const orphaned = cleanupStorageOrphans()
  const removedAuditLogs = purgeExpiredAuditLogs()
  return {
    expiredShares: purged.shares,
    expiredCollections: purged.collections,
    orphaned,
    removedAuditLogs,
  }
}

function cleanupUploadSessions() {
  const cutoff = Date.now() - UPLOAD_SESSION_TTL_MS
  for (const [sessionId, session] of uploadSessions.entries()) {
    if (new Date(session.createdAt).getTime() > cutoff) continue
    uploadSessions.delete(sessionId)
    removeDirectory(session.directory)
  }
}

function publicCollection(task, req, includeManage = false) {
  const organization = task.ownerUserId ? enterpriseOrganizationForUser(task.ownerUserId) : null
  const status = currentCollectionStatus(task)
  const payload = {
    id: task.id,
    token: task.token,
    title: task.title,
    description: task.description,
    deadline: task.deadline,
    allowedTypes: task.allowedTypes,
    maxFileSizeMb: task.maxFileSizeMb,
    capacityBytes: collectionCapacityBytes(task),
    usedBytes: task.submissions.reduce((sum, submission) => sum + fileListSize(submission.files), 0),
    status,
    submissionCount: task.submissions.length,
    publicUrl: `${getOrigin(req)}/collect/${task.token}`,
    qrDataUrl: task.qrDataUrl,
    enterpriseUrl: organization ? `${getOrigin(req)}/e/${organization.slug}/collect/${task.token}` : '',
  }
  if (includeManage) {
    payload.manageToken = task.manageToken
    payload.manageUrl = `${getOrigin(req)}/collect/manage/${task.manageToken}`
  }
  return payload
}

async function ensureCollectionQrDataUrl(task, req) {
  if (!task || task.qrDataUrl) return false
  task.qrDataUrl = await QRCode.toDataURL(`${getOrigin(req)}/collect/${task.token}`, { width: 180, margin: 1 })
  return true
}

function managerCollection(task, req) {
  return {
    ...publicCollection(task, req, true),
    submissions: task.submissions.map(publicSubmission),
    downloadUrl: `${getOrigin(req)}/api/collections/manage/${task.manageToken}/download`,
  }
}

function collectionZipEntries(task, targetSubmission = null) {
  const submissions = targetSubmission ? [targetSubmission] : task.submissions
  return submissions.flatMap((submission) => {
    const folder = targetSubmission ? '' : `${submission.participantName || '提交文件'}-${submission.id.slice(0, 6)}`
    return submission.files.map((file) => ({
      path: path.join(collectionsRoot, task.id, submission.id, file.storedName),
      name: zipEntryPath(folder, file.relativePath),
      size: file.size,
    }))
  })
}

function qrDataUrlAttachment(value) {
  const match = /^data:image\/png;base64,([a-z0-9+/=]+)$/i.exec(String(value || ''))
  if (!match) return null
  return { filename: 'kunqiong-share-qr.png', content: Buffer.from(match[1], 'base64'), cid: 'kunqiong-share-qr' }
}

async function reconcileActiveUpgradeOrders() {
  if (cleanupPaymentQueryCredentials()) persistMetadata()
  const seen = new Set()
  for (const session of [...metadata.sessions].reverse()) {
    if (seen.has(session.user.id) || !sessionApiWebToken(session) || new Date(session.expiresAt).getTime() <= Date.now() || accountUserById(session.user.id)?.status === 'disabled') continue
    seen.add(session.user.id)
    paymentSessionTokens.set(session.user.id, sessionApiWebToken(session))
    await reconcileUserUpgradeOrders(session)
  }
  for (const order of metadata.upgradeOrders) {
    const credential = normalizePaymentQueryCredential(order)
    if (!credential || seen.has(order.userId) || accountUserById(order.userId)?.status === 'disabled') continue
    try { await reconcileUpgradeOrder(credential, order) }
    catch { /* Keep transient failures retryable within the retention window. */ }
  }
}

async function exchangeOAuthToken(code, redirectUri) {
  const response = await fetch(oauthTokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      client_id: oauthClientId,
      client_secret: oauthClientSecret,
      redirect_uri: redirectUri,
    }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || (payload.code && payload.code !== 200)) {
    throw new Error(payload.message || `登录服务返回 ${response.status}`)
  }
  const data = payload.data || payload
  if (!data.access_token || !data.user) throw new Error('登录服务返回数据不完整')
  return data
}

function createAuthSession(tokenData) {
  cleanupExpiredAuthSessions()
  const now = new Date()
  const expiresIn = Math.max(60, Number(tokenData.expires_in || 3600))
  const user = upsertAccountUser({
    ...(tokenData.user || {}),
    loginMethods: mergeLoginMethods(tokenData.user?.loginMethods, ['oauth']),
  })
  const session = {
    id: createToken(40),
    expiresAt: new Date(now.getTime() + expiresIn * 1000).toISOString(),
    createdAt: now.toISOString(),
    apiWebToken: trimRecordString(tokenData.api_web_token || tokenData.apiWebToken || tokenData.access_token, 300),
    user: publicUser(user),
  }
  metadata.sessions.push(session)
  paymentSessionTokens.set(user.id, session.apiWebToken)
  retainUserPaymentQueryCredentials(session, true)
  // 每次登录顺带把团队 roster 上的旧昵称/联系方式刷新一遍，
  // 这样即使改名的请求没走到 PATCH /api/auth/profile（例如离线改的），下次登录也能自愈。
  syncOrganizationMemberProfile(user)
  persistMetadata()
  reconcileUserUpgradeOrders(session, true).catch(() => {})
  return session
}

function consumeOAuthState(state) {
  cleanupOAuthStates()
  if (!state || !oauthStates.has(state)) return null
  const value = oauthStates.get(state)
  oauthStates.delete(state)
  return value
}

function setAuthCookie(res, sessionId, expiresAt, req) {
  const maxAge = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))
  res.setHeader('Set-Cookie', serializeCookie(AUTH_COOKIE_NAME, sessionId, {
    httpOnly: true,
    maxAge,
    path: '/',
    sameSite: 'Lax',
    secure: isSecureRequest(req),
  }))
}

function applyCollectionUpdate(task, body = {}) {
  if (Object.prototype.hasOwnProperty.call(body, 'title')) {
    const title = String(body.title || '').trim()
    if (!title) throw httpError(400, '请填写任务名称')
    task.title = title
  }
  if (Object.prototype.hasOwnProperty.call(body, 'description')) {
    task.description = String(body.description || '').trim() || '请上传你负责的文件'
  }
  if (Object.prototype.hasOwnProperty.call(body, 'deadline')) {
    const deadline = normalizeExpiryInput(body.deadline, '截止时间')
    if (!deadline) throw httpError(400, '截止时间格式不正确')
    task.deadline = deadline
    if (task.status === 'expired' && new Date(task.deadline).getTime() > Date.now()) {
      task.status = 'active'
    }
    if (task.notificationFlags?.collectionExpiring) task.notificationFlags = { ...task.notificationFlags, collectionExpiring: false }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'allowedTypes')) {
    task.allowedTypes = normalizeCollectionAllowedTypes(body.allowedTypes)
  }
  if (Object.prototype.hasOwnProperty.call(body, 'maxFileSizeMb')) {
    const maxFileSizeMb = Number(body.maxFileSizeMb)
    if (!Number.isFinite(maxFileSizeMb) || maxFileSizeMb <= 0) throw httpError(400, '单人大小限制不正确')
    task.maxFileSizeMb = Math.floor(maxFileSizeMb)
  }
  if (Object.prototype.hasOwnProperty.call(body, 'status')) {
    const status = String(body.status || '').trim()
    if (!['active', 'closed'].includes(status)) throw httpError(400, '收集任务状态不支持')
    if (status === 'active' && new Date(task.deadline).getTime() <= Date.now()) {
      throw httpError(400, '截止时间已过，请先延长截止时间')
    }
    task.status = status
  }
}
