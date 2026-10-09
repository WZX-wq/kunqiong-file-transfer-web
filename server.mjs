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
import multer from 'multer'
import archiver from 'archiver'
import QRCode from 'qrcode'
import net from 'node:net'
import {
  once
} from 'node:events'

import {
  ADMIN_ACCOUNT_PASSWORD, ADMIN_ACCOUNT_USERNAME, ADMIN_COOKIE_NAME, ADMIN_LOGIN_MAX_ATTEMPTS,
  ADMIN_LOGIN_WINDOW_MS, ADMIN_SESSION_TTL_MS, ADMIN_USER_IDS, AUTH_COOKIE_NAME,
  COLLECTION_TYPE_EXTENSIONS, COLLECTION_TYPE_OPTIONS, GUEST_ID_COOKIE,
  GUEST_ID_MAX_AGE_SECONDS, MAX_FILES, MAX_FILE_SIZE, SHARE_ACCESS_COOKIE_PREFIX,
  SHARE_ACCESS_TTL_SECONDS, UPLOAD_CHUNK_DEFAULT_BYTES, UPLOAD_CHUNK_MAX_BYTES,
  UPLOAD_CHUNK_MIN_BYTES, UPLOAD_SESSION_TTL_MS, adminCredentialsConfigured, clamavHost,
  clamavPort, collectionsRoot, configuredAppUrl, configuredCallbackUrls, distRoot, filesRoot,
  oauthClientId, oauthClientSecret, oauthTokenUrl, releaseSha, scanMode, scanTimeoutMs,
  serverPort, shareEmailTemplatePath, smtpFrom, smtpFromName, storageRoot, tempRoot,
  testEnterpriseForAllUsers, testVerificationDebugMode
} from './server/config.js'

import {
  createToken, escapeHtml, firstHeader, firstValue, hashSecret, httpError, parseJson,
  parseRecipients, removeDirectory
} from './server/lib/http.js'

import {
  adminLoginAttempts, adminSessions, databasePool, oauthStates, paymentSessionTokens,
  reservedShareCodes, runtime, shareLookupAttempts, uploadReservations, uploadSessions
} from './server/state.js'

import {
  initMetadata, installNormalizer, loadMetadata, metadata, metadataIdSets, persistMetadata
} from './server/lib/metadata-store.js'

// normalizeMetadata 的传递依赖闭包已移至 metadata-normalizers.js；
// 它同时是注入给 metadata-store 的规范化函数来源。
import {
  mergeLoginMethods, normalizeAuditLogs, normalizeEmailValue, normalizeMetadata,
  normalizePaymentQueryCredential, normalizePhoneValue, normalizePlanId, normalizeRecordDate,
  normalizeSystemConfig, publicUser, trimRecordString
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
  accountEffectivePlanForUser, accountNotificationSettingsForUser, accountOrganizationForUser,
  accountPersonalPlanForUser, accountPlanForUser, accountTeamUsageForOrganization,
  accountUsageForUser, accountUserById, addAccountMessage, appendAuthResult,
  authSessionFromRequest, cleanupExpired, cleanupExpiredAuthSessions, cleanupOAuthStates,
  cleanupPaymentQueryCredentials, configuredAccountPlans, currentCollectionStatus,
  currentShareStatus, displayAccountName, fileListSize, formatByteSize, getEmailTransporter,
  getOrigin, getRequestOrigin, isSecureRequest, isSmtpConfigured, isTencentSmsConfigured,
  mailErrorReason, normalizeContactTarget, normalizeUploadFileName, parseAccountRecordResource,
  publicFile, readCookie, reconcileUpgradeOrder, reconcileUserUpgradeOrders, recordAuditLog,
  retainUserPaymentQueryCredentials, safeRelativePath, safeReturnUrl, serializeCookie,
  sessionApiWebToken, syncAccountUserSessions, syncOrganizationMemberProfile,
  upsertAccountUser, validateShareRecipient
} from './server/services/account.js'

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
// 上传会话/预留、升级订单锁、支付对账、管理后台会话、OAuth state 均在 server/state.js。
const upload = multer({
  dest: tempRoot,
  limits: { files: MAX_FILES, fileSize: MAX_FILE_SIZE },
})
const chunkUpload = multer({ dest: tempRoot, limits: { files: 1, fileSize: UPLOAD_CHUNK_MAX_BYTES } })
const app = express()

function normalizeUploadedFileNames(req, res, next) {
  if (Array.isArray(req.files)) {
    req.files.forEach((file) => {
      file.originalname = normalizeUploadFileName(file.originalname)
    })
  }
  next()
}

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

app.post('/api/shares', upload.array('files', MAX_FILES), normalizeUploadedFileNames, async (req, res, next) => {
  let reservationId
  try {
    assertServiceWritable(req)
    const uploadedFiles = req.files || []
    if (!uploadedFiles.length) return res.status(400).json({ message: '至少选择一个文件' })
    assertConfiguredUploadLimits(req, uploadedFiles)
    const guestKey = assertGuestQuota(req, res, uploadedFiles)
    const ownerSession = authSessionFromRequest(req)
    const options = readShareOptions(req.body, ownerSession?.user)
    reservationId = reserveUploadCapacity({ files: uploadedFiles, guestKey, ownerUserId: ownerSession?.user?.id || '' })
    await assertSafeUploadFiles(uploadedFiles)

    const relativePaths = parseJson(req.body.relativePaths, [])
    const files = uploadedFiles.map((file, index) => {
      const relativePath = safeRelativePath(relativePaths[index] || file.originalname)
      return {
        name: file.originalname,
        relativePath,
        size: file.size,
        mimeType: file.mimetype || 'application/octet-stream',
        tempPath: file.path,
        reviewStatus: file.reviewStatus,
        scanEngine: file.scanEngine,
        scannedAt: file.scannedAt,
      }
    })

    const share = await createShareFromTempFiles(files, options, req)
    addGuestUsage(guestKey, files)
    res.status(201).json({ share: publicShare(share, req, true, true) })
  } catch (error) {
    cleanupUploadedFiles(req.files)
    next(error)
  } finally {
    if (reservationId) uploadReservations.delete(reservationId)
  }
})

app.post('/api/upload-sessions', (req, res) => {
  assertServiceWritable(req)
  const files = Array.isArray(req.body.files) ? req.body.files : []
  if (!files.length) return res.status(400).json({ message: '至少选择一个文件' })
  const config = normalizeSystemConfig(metadata.systemConfig)
  if (files.length > config.maxBatchFiles) return res.status(413).json({ message: `单次最多上传 ${config.maxBatchFiles} 个文件` })

  const normalizedFiles = files.map((file, index) => ({
    name: normalizeUploadFileName(file.name || `文件 ${index + 1}`),
    relativePath: safeRelativePath(normalizeUploadFileName(file.relativePath || file.name || `文件 ${index + 1}`)),
    size: Number(file.size || 0),
    mimeType: String(file.mimeType || 'application/octet-stream'),
    chunks: new Set(),
  }))
  if (normalizedFiles.some((file) => !Number.isSafeInteger(file.size) || file.size < 0)) return res.status(400).json({ message: '文件大小必须为有效的非负整数' })
  const invalid = normalizedFiles.find((file) => file.size > MAX_FILE_SIZE)
  if (invalid) return res.status(413).json({ message: `${invalid.name} 超过 5 GB 限制` })
  assertConfiguredUploadLimits(req, normalizedFiles)
  const guestKey = assertGuestQuota(req, res, normalizedFiles)
  const ownerSession = authSessionFromRequest(req)
  let collectionTask = null
  let teamOrganization = null
  let collectionSubmitter = null
  if (req.body.mode === 'collection') {
    collectionTask = metadata.collections.find((item) => item.token === String(req.body.collectionToken || ''))
    if (!collectionTask) return res.status(404).json({ message: '收集任务不存在' })
    const access = validateCollection(collectionTask)
    if (!access.ok) return res.status(access.status).json({ message: access.message })
    collectionSubmitter = resolveCollectionSubmitter(req)
    if (!collectionSubmitter.participantName) return res.status(400).json({ message: '请先登录，或填写提交人名称' })
    const invalidCollectionFile = normalizedFiles.find((file) => file.size > collectionTask.maxFileSizeMb * 1024 * 1024 || !isAllowedType(file.name, collectionTask.allowedTypes))
    if (invalidCollectionFile) return res.status(413).json({ message: `${invalidCollectionFile.name} 不符合当前收集任务的文件限制` })
  }
  if (req.body.mode === 'team_resource') {
    if (!ownerSession?.user?.id) return res.status(401).json({ message: '请先登录后上传到团队空间' })
    teamOrganization = accountOrganizationForUser(ownerSession.user.id)
    if (!teamOrganization) return res.status(404).json({ message: '你尚未加入团队空间' })
    if (!teamOrganization.members.some((member) => member.userId === ownerSession.user.id && member.status === 'active')) {
      return res.status(403).json({ message: '当前成员状态不能上传到团队空间' })
    }
    assertUniqueTeamResourceNames(teamOrganization, normalizedFiles)
    assertTeamCapacity(teamOrganization, normalizedFiles.reduce((sum, file) => sum + file.size, 0))
  } else {
    assertAccountCapacity(collectionTask ? accountUserById(collectionTask.ownerUserId) : ownerSession?.user, normalizedFiles.reduce((sum, file) => sum + file.size, 0))
  }

  const sessionId = createToken(18)
  const sessionDirectory = path.join(tempRoot, 'upload-sessions', sessionId)
  fs.mkdirSync(sessionDirectory, { recursive: true })
  const isTeamResourceSession = req.body.mode === 'team_resource'
  const session = {
    id: sessionId,
    chunkSize: normalizeUploadChunkSize(req.body.chunkSize),
    files: normalizedFiles,
    // 游客计账 key 冻结在会话上：complete 成功时按它补记累计用量（登录用户为空串）。
    guestKey,
    ownerUserId: ownerSession?.user?.id || '',
    capacityOwnerUserId: collectionTask ? collectionTask.ownerUserId : ownerSession?.user?.id || '',
    // 团队资源走团队空间权益，不校验上传者的个人 permanent。
    options: readShareOptions(req.body, ownerSession?.user, isTeamResourceSession),
    mode: isTeamResourceSession ? 'team_resource' : (req.body.mode === 'collection' ? 'collection' : 'share'),
    organizationId: teamOrganization?.id || '',
    collectionToken: collectionTask?.token || '',
    participantName: collectionSubmitter ? collectionSubmitter.participantName : String(req.body.participantName || '').trim(),
    submitterUserId: collectionSubmitter?.submitterUserId || '',
    submitterName: collectionSubmitter?.submitterName || '',
    relativePaths: Array.isArray(req.body.relativePaths) ? req.body.relativePaths : [],
    directory: sessionDirectory,
    createdAt: new Date().toISOString(),
  }
  assertUploadCapacity(session)
  uploadSessions.set(sessionId, session)
  persistUploadSession(session)
  res.status(201).json({ sessionId, uploaded: session.files.map((file) => ({ name: file.name, chunks: [] })) })
})

function requireUploadSessionOwner(req, res, next) {
  const session = uploadSessions.get(req.params.sessionId)
  if (!session) return res.status(404).json({ message: '上传会话不存在，请重新开始上传' })
  if (session.ownerUserId && authSessionFromRequest(req)?.user?.id !== session.ownerUserId) {
    return res.status(403).json({ message: '请使用创建上传的账号继续操作' })
  }
  req.uploadSession = session
  next()
}

app.post('/api/upload-sessions/:sessionId/chunks', requireUploadSessionOwner, chunkUpload.single('chunk'), async (req, res, next) => {
  try {
    const session = req.uploadSession
    const fileIndex = Number(req.body.fileIndex)
    const chunkIndex = Number(req.body.chunkIndex)
    const totalChunks = Number(req.body.totalChunks)
    if (!Number.isInteger(fileIndex) || !Number.isInteger(chunkIndex) || !Number.isInteger(totalChunks) || fileIndex < 0 || fileIndex >= session.files.length || chunkIndex < 0 || totalChunks < 1 || chunkIndex >= totalChunks) {
      cleanupUploadedFiles(req.file ? [req.file] : [])
      return res.status(400).json({ message: '分片参数不完整' })
    }
    const file = session.files[fileIndex]
    if (!file || !req.file) {
      cleanupUploadedFiles(req.file ? [req.file] : [])
      return res.status(400).json({ message: '分片文件不存在' })
    }
    if (file.totalChunks && file.totalChunks !== totalChunks) {
      cleanupUploadedFiles(req.file ? [req.file] : [])
      return res.status(409).json({ message: '分片总数发生变化，请重新开始上传' })
    }
    // 分片位置与会话配置强校验：offset 只能由 chunkIndex*chunkSize 推出，
    // 大小必须是 min(chunkSize, 文件剩余)。旧客户端不带 chunkSize 时按默认 8MB 兼容。
    const expectedOffset = chunkIndex * session.chunkSize
    const expectedSize = Math.min(session.chunkSize, Math.max(0, file.size - expectedOffset))
    if ((file.size > 0 && expectedOffset >= file.size) || req.file.size !== expectedSize) {
      cleanupUploadedFiles(req.file ? [req.file] : [])
      return res.status(400).json({ message: '分片大小与上传会话配置不一致，请重新开始上传' })
    }
    // 内容校验：客户端带 SHA-256 时必须匹配，防止静默损坏/串片。
    const chunkBuffer = await fs.promises.readFile(req.file.path)
    if (req.body.chunkHash) {
      const actualHash = crypto.createHash('sha256').update(chunkBuffer).digest('hex')
      if (actualHash !== String(req.body.chunkHash).toLowerCase()) {
        cleanupUploadedFiles(req.file ? [req.file] : [])
        return res.status(400).json({ message: '分片校验失败，将自动重试' })
      }
    }
    // 分片直写：按 offset 定位写入目标文件（pwrite，乱序到达也安全），complete 阶段零合并。
    const targetPath = path.join(session.directory, `${fileIndex}.target`)
    const target = await fs.promises.open(targetPath, fs.constants.O_RDWR | fs.constants.O_CREAT, 0o644)
    try {
      await target.write(chunkBuffer, 0, chunkBuffer.length, expectedOffset)
    } finally {
      await target.close()
    }
    await fs.promises.unlink(req.file.path).catch(() => {})
    const markerDirectory = path.join(session.directory, String(fileIndex))
    fs.mkdirSync(markerDirectory, { recursive: true })
    fs.writeFileSync(path.join(markerDirectory, `${chunkIndex}.done`), '')
    file.totalChunks = totalChunks
    file.chunks.add(chunkIndex)
    res.json({ ok: true, fileIndex, chunkIndex, uploadedChunks: file.chunks.size })
  } catch (error) {
    cleanupUploadedFiles(req.file ? [req.file] : [])
    next(error)
  }
})

// 会话级分片大小：客户端在创建会话时声明，服务端收敛到 [1MB, 16MB]，
// 未携带（旧客户端）回落默认 8MB —— 与旧版前端固定分片值保持一致。
function normalizeUploadChunkSize(value) {
  const size = Math.round(Number(value))
  if (!Number.isFinite(size) || size <= 0) return UPLOAD_CHUNK_DEFAULT_BYTES
  return Math.min(UPLOAD_CHUNK_MAX_BYTES, Math.max(UPLOAD_CHUNK_MIN_BYTES, size))
}

// 会话清单落盘：重启后可从 session.json + {fileIndex}/{chunkIndex}.done 标记恢复
// 续传状态（uploadSessions 是内存 Map，重启即失；清单让 12h TTL 真正跨重启生效）。
function persistUploadSession(session) {
  try {
    const manifest = {
      id: session.id,
      chunkSize: session.chunkSize,
      files: session.files.map((file) => ({ name: file.name, relativePath: file.relativePath, size: file.size, mimeType: file.mimeType })),
      options: session.options,
      mode: session.mode,
      organizationId: session.organizationId,
      collectionToken: session.collectionToken,
      participantName: session.participantName,
      submitterUserId: session.submitterUserId,
      submitterName: session.submitterName,
      guestKey: session.guestKey || '',
      ownerUserId: session.ownerUserId || '',
      capacityOwnerUserId: session.capacityOwnerUserId || '',
      relativePaths: session.relativePaths,
      createdAt: session.createdAt,
    }
    const manifestPath = path.join(session.directory, 'session.json')
    const tmpPath = `${manifestPath}.tmp`
    fs.writeFileSync(tmpPath, JSON.stringify(manifest))
    fs.renameSync(tmpPath, manifestPath)
  } catch (error) {
    console.warn('上传会话清单写入失败', error?.message || error)
  }
}

function restoreUploadSessions() {
  const root = path.join(tempRoot, 'upload-sessions')
  let entries = []
  try {
    entries = fs.readdirSync(root)
  } catch {
    return
  }
  for (const entry of entries) {
    const directory = path.join(root, entry)
    const manifestPath = path.join(directory, 'session.json')
    try {
      if (!fs.existsSync(manifestPath)) {
        removeDirectory(directory)
        continue
      }
      const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      if (raw?.id !== entry || !Array.isArray(raw.files) || !Number.isFinite(Number(raw.chunkSize))) {
        removeDirectory(directory)
        continue
      }
      const session = {
        ...raw,
        directory,
        chunkSize: normalizeUploadChunkSize(raw.chunkSize),
        files: raw.files.map((file) => ({ ...file, totalChunks: 0, chunks: new Set() })),
      }
      let broken = false
      session.files.forEach((file, fileIndex) => {
        const targetPath = path.join(directory, `${fileIndex}.target`)
        if (!fs.existsSync(targetPath)) {
          broken = true
          return
        }
        const markerDirectory = path.join(directory, String(fileIndex))
        let markers = []
        try {
          markers = fs.readdirSync(markerDirectory)
        } catch {
          markers = []
        }
        for (const name of markers) {
          const match = /^(\d+)\.done$/.exec(name)
          if (match) file.chunks.add(Number(match[1]))
        }
      })
      if (broken) {
        removeDirectory(directory)
        continue
      }
      uploadSessions.set(session.id, session)
    } catch {
      removeDirectory(directory)
    }
  }
}

app.get('/api/upload-sessions/:sessionId', requireUploadSessionOwner, (req, res) => {
  const session = req.uploadSession
  res.json({
    sessionId: session.id,
    chunkSize: session.chunkSize,
    createdAt: session.createdAt,
    files: session.files.map((file, fileIndex) => ({
      name: file.name,
      size: file.size,
      totalChunks: Math.max(1, Math.ceil(file.size / session.chunkSize)),
      uploadedChunks: Array.from(file.chunks).sort((a, b) => a - b),
      targetReady: fs.existsSync(path.join(session.directory, `${fileIndex}.target`)),
    })),
  })
})

app.post('/api/upload-sessions/:sessionId/complete', requireUploadSessionOwner, async (req, res, next) => {
  let activeSession
  try {
    const session = req.uploadSession
    if (session.completing) return res.status(409).json({ message: '此上传正在发布，请稍后重试' })
    activeSession = session
    session.completing = true
    assertUploadCapacity(session, session.id)
    // 分片直写模式：这里只做完整性校验（逐 index 齐片 + 目标文件大小），
    // 不再合并 —— 旧版同步合并 5GB 文件会阻塞事件循环 10~35 秒。
    for (let fileIndex = 0; fileIndex < session.files.length; fileIndex += 1) {
      const file = session.files[fileIndex]
      const expectedChunks = Math.max(1, Math.ceil(file.size / session.chunkSize))
      const hasAllChunks = file.chunks.size === expectedChunks && Array.from({ length: expectedChunks }, (_, index) => index).every((index) => file.chunks.has(index))
      if (!hasAllChunks) {
        return res.status(409).json({ message: `${file.name} 还有分片未上传完成` })
      }
    }

    const mergedFiles = session.files.map((file, fileIndex) => {
      const targetPath = path.join(session.directory, `${fileIndex}.target`)
      if (!fs.existsSync(targetPath)) throw httpError(400, `${file.name} 分片缺失，请重试上传`)
      if (fs.statSync(targetPath).size !== file.size) {
        throw httpError(400, `${file.name} 文件大小校验失败，请重新上传`)
      }
      return {
        name: file.name,
        relativePath: file.relativePath,
        size: file.size,
        mimeType: file.mimeType,
        tempPath: targetPath,
      }
    })
    await assertSafeUploadFiles(mergedFiles)
    if (session.mode === 'collection') {
      const task = metadata.collections.find((item) => item.token === session.collectionToken)
      if (!task) return res.status(404).json({ message: '收集任务不存在' })
      const access = validateCollection(task)
      if (!access.ok) return res.status(access.status).json({ message: access.message })
      assertCollectionFiles(task, mergedFiles)
      assertUploadCapacity(session, session.id)
      const participantName = session.participantName.trim()
      const files = mergedFiles.map((file, index) => {
        const relativePath = safeRelativePath(session.relativePaths[index] || file.relativePath || file.name)
        const storedName = `${String(index + 1).padStart(2, '0')}-${crypto.randomBytes(4).toString('hex')}-${path.basename(relativePath)}`
        return { ...file, relativePath, storedName }
      })
      const submissionId = createToken(12)
      const submissionDirectory = path.join(collectionsRoot, task.id, submissionId)
      fs.mkdirSync(submissionDirectory, { recursive: true })
      const submissionFiles = files.map((file) => {
        fs.renameSync(file.tempPath, path.join(submissionDirectory, file.storedName))
        return { name: file.name, relativePath: file.relativePath, storedName: file.storedName, size: file.size, mimeType: file.mimeType, reviewStatus: file.reviewStatus, scanEngine: file.scanEngine, scannedAt: file.scannedAt }
      })
      const submission = {
        id: submissionId,
        participantName,
        submitterUserId: session.submitterUserId || '',
        submitterName: session.submitterName || participantName,
        submittedAt: new Date().toISOString(),
        files: submissionFiles,
      }
      task.submissions.push(submission)
      addCollectionSubmissionMessage(task, submission, req)
      addGuestUsage(session.guestKey, submissionFiles)
      persistMetadata()
      uploadSessions.delete(session.id)
      removeDirectory(session.directory)
      return res.status(201).json({ submission: publicSubmission(submission) })
    }
    if (session.mode === 'team_resource') {
      const organization = Object.values(metadata.organizations || {}).find((item) => item.id === session.organizationId)
      if (!organization) return res.status(404).json({ message: '团队空间不存在' })
      assertUniqueTeamResourceNames(organization, mergedFiles)
      assertTeamCapacity(organization, mergedFiles.reduce((sum, file) => sum + file.size, 0))
    }
    const share = await createShareFromTempFiles(mergedFiles, {
      ...session.options,
      teamResource: session.mode === 'team_resource',
      teamOrganizationId: session.organizationId,
    }, req)
    addGuestUsage(session.guestKey, mergedFiles)
    uploadSessions.delete(session.id)
    removeDirectory(session.directory)
    res.status(201).json({ share: publicShare(share, req, true, true) })
  } catch (error) {
    next(error)
  } finally {
    if (activeSession) activeSession.completing = false
  }
})

// 取件码查询限流：取件码空间小（最短 4 位），不限流可被枚举。
// 与后台登录同理，不能用 XFF 做键（trust proxy=true 可伪造），用真实 socket 地址 + 全局兜底。
const SHARE_LOOKUP_WINDOW_MS = 10 * 60 * 1000
const SHARE_LOOKUP_MAX_PER_WINDOW = 30
const SHARE_LOOKUP_GLOBAL_MAX = 300
// 查取计数表 shareLookupAttempts 在 server/state.js

function shareLookupRateLimited(req) {
  const socketIp = String(req.socket?.remoteAddress || '').trim() || 'unknown'
  const now = Date.now()
  if (shareLookupAttempts.size > 5000) {
    for (const [key, entry] of shareLookupAttempts) {
      if (now - entry.startedAt > SHARE_LOOKUP_WINDOW_MS) shareLookupAttempts.delete(key)
    }
  }
  const bump = (key) => {
    const entry = shareLookupAttempts.get(key)
    if (!entry || now - entry.startedAt > SHARE_LOOKUP_WINDOW_MS) {
      shareLookupAttempts.set(key, { count: 1, startedAt: now })
      return 1
    }
    entry.count += 1
    return entry.count
  }
  return bump(`socket:${socketIp}`) > SHARE_LOOKUP_MAX_PER_WINDOW
    || bump('global') > SHARE_LOOKUP_GLOBAL_MAX
}

app.get('/api/shares/lookup/:code', (req, res) => {
  if (shareLookupRateLimited(req)) return res.status(429).json({ message: '查询过于频繁，请稍后再试' })
  const share = findShareByCode(req.params.code)
  if (!share) return res.status(404).json({ message: '取件码不存在或已失效' })
  const access = validateShareRequest(share, req, { allowMissingPassword: true, allowOwner: true })
  if (!access.ok) return res.status(access.status).json({ message: access.message, code: access.code || '' })
  if (share.passwordHash) return res.json({ share: publicShare(share, req, false), requiresPassword: true })
  res.json({ share: publicShare(share, req, true), requiresPassword: false })
})

app.post('/api/shares/lookup/:code', (req, res) => {
  if (shareLookupRateLimited(req)) return res.status(429).json({ message: '查询过于频繁，请稍后再试' })
  const share = findShareByCode(req.params.code)
  if (!share) return res.status(404).json({ message: '取件码不存在或已失效' })
  const access = validateShareRequest(share, req, { password: req.body.password, allowOwner: true })
  if (!access.ok) return res.status(access.status).json({ message: access.message, code: access.code || '' })
  setShareAccessCookie(res, req, share)
  res.json({ share: publicShare(share, req, true), requiresPassword: false })
})

app.get('/api/shares/token/:token', (req, res) => {
  const share = metadata.shares.find((item) => item.id === req.params.token)
  if (!share) return res.status(404).json({ message: '分享不存在或已失效' })
  if (!validateEnterpriseSlug(share, req.query.organization)) return res.status(404).json({ message: '企业专属链接无效' })
  const access = validateShareRequest(share, req, { allowMissingPassword: true, allowOwner: true })
  if (!access.ok) return res.status(access.status).json({ message: access.message, code: access.code || '' })
  const viewer = authSessionFromRequest(req)?.user
  const includeManage = Boolean(viewer?.id && share.ownerUserId && viewer.id === share.ownerUserId)
  res.json({ share: publicShare(share, req, !share.passwordHash, includeManage), requiresPassword: Boolean(share.passwordHash) })
})

app.get('/api/shares/manage/:manageToken', (req, res) => {
  const share = findShareByManageToken(req.params.manageToken)
  if (!share) return res.status(404).json({ message: '分享管理链接不存在' })
  res.json({ share: publicShare(share, req, true, true) })
})

app.patch('/api/shares/manage/:manageToken', async (req, res, next) => {
  try {
    const share = findShareByManageToken(req.params.manageToken)
    if (!share) return res.status(404).json({ message: '分享管理链接不存在' })
    applyShareUpdate(share, req.body || {}, accountUserById(share.ownerUserId))
    share.updatedAt = new Date().toISOString()
    persistMetadata()
    res.json({ share: publicShare(share, req, true, true) })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/shares/manage/:manageToken', (req, res, next) => {
  try {
    const share = findShareByManageToken(req.params.manageToken)
    if (!share) return res.status(404).json({ message: '分享管理链接不存在' })
    share.status = 'closed'
    share.updatedAt = new Date().toISOString()
    persistMetadata()
    res.json({ share: publicShare(share, req, false, true) })
  } catch (error) {
    next(error)
  }
})

app.get('/api/shares/:token/download', async (req, res, next) => {
  try {
    const share = metadata.shares.find((item) => item.id === req.params.token)
    if (!share) return res.status(404).json({ message: '分享不存在或已失效' })
    enforceDownloadOrigin(req)
    const access = validateShareRequest(share, req, { allowOwner: true })
    if (!access.ok) return res.status(access.status).json({ message: access.message })
    await ensureStoredFilesScanned(share.files, path.join(filesRoot, share.id))
    if (req.method === 'HEAD') setShareAccessCookie(res, req, share)
    registerShareDownload(share, res)
    const shareDirectory = path.join(filesRoot, share.id)
    if (share.files.length === 1) {
      const file = share.files[0]
      sendDownloadFile(req, res, next, path.join(shareDirectory, file.storedName), file)
      return
    }
    await streamZip(res, next, '鲲穹文件包.zip', share.files.map((file) => ({
      path: path.join(shareDirectory, file.storedName),
      name: file.relativePath,
      size: file.size,
    })))
  } catch (error) {
    next(error)
  }
})

app.get('/api/shares/:token/files/:fileIndex/download', async (req, res, next) => {
  try {
    const share = metadata.shares.find((item) => item.id === req.params.token)
    if (!share) return res.status(404).json({ message: '分享不存在或已失效' })
    enforceDownloadOrigin(req)
    const access = validateShareRequest(share, req, { allowOwner: true })
    if (!access.ok) return res.status(access.status).json({ message: access.message })
    const file = share.files[Number(req.params.fileIndex)]
    if (!file) return res.status(404).json({ message: '文件不存在' })
    await ensureStoredFilesScanned([file], path.join(filesRoot, share.id))
    if (req.method === 'HEAD') setShareAccessCookie(res, req, share)
    registerShareDownload(share, res)
    sendDownloadFile(req, res, next, path.join(filesRoot, share.id, file.storedName), file)
  } catch (error) {
    next(error)
  }
})

app.get('/api/shares/:token/files/:fileIndex/preview', async (req, res, next) => {
  try {
    const share = metadata.shares.find((item) => item.id === req.params.token)
    if (!share) return res.status(404).json({ message: '分享不存在或已失效' })
    enforceDownloadOrigin(req)
    const access = validateShareRequest(share, req, { allowOwner: true })
    if (!access.ok) return res.status(access.status).json({ message: access.message })
    const file = share.files[Number(req.params.fileIndex)]
    if (!file) return res.status(404).json({ message: '文件不存在' })
    await ensureStoredFilesScanned([file], path.join(filesRoot, share.id))
    sendPreviewFile(req, res, next, path.join(filesRoot, share.id, file.storedName), file)
  } catch (error) {
    next(error)
  }
})

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

function isAdminUser(user = {}) {
  return Boolean(user?.id && ADMIN_USER_IDS.has(String(user.id)))
}

// —— 后台管理员会话（账号密码登录，独立于鲲穹 OAuth 会话）——
function cleanupExpiredAdminSessions() {
  const now = Date.now()
  for (const [token, session] of adminSessions.entries()) {
    if (session.expiresAt <= now) adminSessions.delete(token)
  }
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

function adminSessionFromRequest(req) {
  cleanupExpiredAdminSessions()
  const token = readCookie(req, ADMIN_COOKIE_NAME)
  if (!token) return null
  return adminSessions.get(token) || null
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

function assertServiceWritable(req) {
  if (!normalizeSystemConfig(metadata.systemConfig).maintenanceMode) return
  // 维护模式豁免：管理员口令会话（后台登录后的同一个浏览器）与白名单鲲穹账号都放行。
  // 只认白名单会导致「管理员从后台登录后反而不能传文件」——口令会话必须一并豁免。
  if (adminSessionFromRequest(req)) return
  if (isAdminUser(authSessionFromRequest(req)?.user)) return
  throw httpError(503, '系统维护中，暂时不能创建或提交文件')
}

function enterpriseOrganizationForUser(userId) {
  const organization = accountOrganizationForUser(userId)
  if (!organization || !accountEffectivePlanForUser(organization.ownerUserId).team) return null
  return organization
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

function publicShare(share, req, includeFiles = true, includeManage = false) {
  const organization = share.ownerUserId ? enterpriseOrganizationForUser(share.ownerUserId) : null
  const status = currentShareStatus(share)
  const payload = {
    id: share.id,
    code: share.code,
    files: includeFiles ? share.files.map(publicFile) : [],
    createdAt: share.createdAt,
    expiresAt: share.expiresAt,
    downloadLimit: share.downloadLimit,
    downloadCount: share.downloadCount,
    remainingDownloads: share.downloadLimit ? Math.max(share.downloadLimit - share.downloadCount, 0) : null,
    shareUrl: `${getOrigin(req)}/share/${share.id}`,
    downloadUrl: `${getOrigin(req)}/api/shares/${share.id}/download`,
    qrDataUrl: share.qrDataUrl,
    enterpriseUrl: organization ? `${getOrigin(req)}/e/${organization.slug}/share/${share.id}` : '',
    requiresPassword: Boolean(share.passwordHash),
    closeReason: share.closeReason || null,
    directed: Boolean(share.deliveryRecipients?.length),
    status,
  }
  if (includeManage) {
    payload.deliveryRecipients = share.deliveryRecipients || []
    payload.notificationLog = share.notificationLog || []
    payload.manageToken = share.manageToken
    payload.manageUrl = `${getOrigin(req)}/share/manage/${share.manageToken}`
    // 重新开启是「会员特权」而非「永久特权」：付费套餐在有效期内即可（到期由 accountPlanForUser 回落 free 自动收回）。
    const ownerPlanForReopen = share.ownerUserId ? accountEffectivePlanForUser(share.ownerUserId) : null
    payload.canReopen = Boolean(ownerPlanForReopen && (ownerPlanForReopen.permanent || (ownerPlanForReopen.id && ownerPlanForReopen.id !== 'free')))
  }
  return payload
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

function validateEnterpriseSlug(item, slug) {
  if (!slug) return true
  const organization = item?.ownerUserId ? enterpriseOrganizationForUser(item.ownerUserId) : null
  return Boolean(organization && organization.slug === String(slug))
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

function validateShareRequest(share, req, options = {}) {
  const viewer = authSessionFromRequest(req)?.user
  const recipientAccess = validateShareRecipient(share, viewer)
  if (!recipientAccess.ok) return recipientAccess
  assertFilesDownloadable(share.files)
  const isOwner = options.allowOwner && viewer?.id && share.ownerUserId && viewer.id === share.ownerUserId
  // 团队资源：关闭分享只应切断公开提取链接，文件本体仍在团队空间。
  // 所有者本人登录后始终可以打开自己的资源 —— 否则所有者关闭分享后连自己也打不开文件。
  if (isOwner && share.teamResource && currentShareStatus(share) === 'closed') return { ok: true }
  return validateShare(share, options.password ?? req.get('x-share-password'), {
    ...options,
    skipPassword: isOwner,
    hasAccessCookie: hasShareAccessCookie(req, share),
  })
}

function assertFilesDownloadable(files = []) {
  if (files.some((file) => file.reviewStatus === 'blocked')) throw httpError(415, '文件安全检查未通过，无法下载或预览')
  return true
}

async function scanFileBytes(filePath) {
  if (!clamavHost) {
    if (scanMode === 'required') throw httpError(503, '文件扫描服务未配置，暂时无法发布或读取未扫描文件')
    return { reviewStatus: 'unscanned', scanEngine: null, scannedAt: null }
  }
  const socket = net.createConnection({ host: clamavHost, port: clamavPort })
  let source
  let response = ''
  let timer
  const verdict = new Promise((resolve, reject) => {
    const fail = (error) => { source?.destroy(); socket.destroy(); reject(error) }
    timer = setTimeout(() => fail(httpError(503, '文件扫描超时，请稍后重试')), scanTimeoutMs)
    socket.on('error', () => fail(httpError(503, '文件扫描服务连接失败，请稍后重试')))
    socket.on('end', () => { if (!response.includes('\0')) fail(httpError(503, '文件扫描服务未返回完整结果')) })
    socket.on('data', (data) => {
      response += data.toString('utf8')
      if (response.length > 4096) return fail(httpError(503, '文件扫描结果无效'))
      if (!response.includes('\0')) return
      const result = response.split('\0')[0].trim()
      if (/^stream: OK$/.test(result)) resolve({ reviewStatus: 'approved', scanEngine: 'clamav', scannedAt: new Date().toISOString() })
      else if (/ FOUND$/.test(result)) reject(httpError(415, '文件扫描发现威胁或超出扫描安全限制，已阻止发布'))
      else reject(httpError(503, '文件扫描未完成，请检查扫描服务和大小限制'))
      socket.destroy()
    })
  })
  // Await both producer and verdict; buffers stay bounded by stream backpressure.
  const producer = (async () => {
    await once(socket, 'connect')
    const write = async (buffer) => {
      if (socket.destroyed) throw httpError(503, '文件扫描连接已关闭')
      if (!socket.write(buffer)) await once(socket, 'drain')
    }
    await write(Buffer.from('zINSTREAM\0'))
    source = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 })
    for await (const chunk of source) {
      const length = Buffer.alloc(4)
      length.writeUInt32BE(chunk.length)
      await write(length)
      await write(chunk)
    }
    await write(Buffer.alloc(4))
  })()
  try {
    const [result] = await Promise.all([verdict, producer])
    return result
  } finally {
    clearTimeout(timer)
    source?.destroy()
    socket.destroy()
  }
}

async function assertSafeUploadFiles(files = []) {
  for (const file of files) {
    try {
      Object.assign(file, await scanFileBytes(file.tempPath || file.path))
    } catch (error) {
      if (error.status === 415) {
        file.reviewStatus = 'blocked'
        recordAuditLog({ type: 'security', action: '文件扫描拦截', targetId: file.originalname || file.name })
      }
      throw error
    }
  }
}

async function ensureStoredFilesScanned(files, directory) {
  assertFilesDownloadable(files)
  for (const file of files) {
    if (file.reviewStatus === 'approved' && file.scanEngine === 'clamav' && file.scannedAt) continue
    const targetPath = path.join(directory, file.storedName)
    if (!fs.existsSync(targetPath)) throw httpError(410, '文件已清理，无法读取')
    try { Object.assign(file, await scanFileBytes(targetPath)) }
    catch (error) { if (error.status === 415) file.reviewStatus = 'blocked'; persistMetadata(); throw error }
  }
  persistMetadata()
}

function assertConfiguredUploadLimits(req, files = []) {
  const config = normalizeSystemConfig(metadata.systemConfig)
  if (files.length > config.maxBatchFiles) {
    throw httpError(413, `单次最多上传 ${config.maxBatchFiles} 个文件`)
  }
  const isAnonymous = !authSessionFromRequest(req)?.user?.id
  if (!isAnonymous) return
  const maxBytes = config.anonymousMaxFileSizeMb * 1024 * 1024
  const invalid = files.find((file) => Number(file.size || 0) > maxBytes)
  if (invalid) throw httpError(413, `匿名上传单文件不能超过 ${config.anonymousMaxFileSizeMb} MB`)
}

// ---------- 未登录（游客）累计传输配额 ----------
// 身份维度：优先设备 cookie（kq_guest_id），请求完全没有 cookie 头时回落 IP；
// 登录用户返回空串（不参与游客计费，走个人空间配额）。
function resolveGuestKey(req, res) {
  if (authSessionFromRequest(req)?.user?.id) return ''
  const existing = readCookie(req, GUEST_ID_COOKIE)
  if (existing && /^[A-Za-z0-9]{16,64}$/.test(existing)) return `cookie:${existing}`
  // 无 cookie 头，或带了 cookie 头却没有有效 kq_guest_id（脚本换头绕过）：
  // 本次一律按 socket IP 计账，防止每次签发新 key 绕过累计额度；
  // 同时仍签发游客 cookie，真实浏览器从下一个请求起就切到独立的 cookie 键。
  issueGuestCookie(req, res)
  const ip = String(req.socket?.remoteAddress || '').trim() || 'unknown'
  return `ip:${ip}`
}

function issueGuestCookie(req, res) {
  const token = createToken(24)
  res.append('Set-Cookie', serializeCookie(GUEST_ID_COOKIE, token, {
    httpOnly: true,
    maxAge: GUEST_ID_MAX_AGE_SECONDS,
    path: '/',
    sameSite: 'Lax',
    secure: isSecureRequest(req),
  }))
  return token
}

function guestQuotaLimitBytes(config = metadata.systemConfig) {
  const mb = Number(normalizeSystemConfig(config).anonymousTotalSizeMb)
  if (!Number.isFinite(mb) || mb <= 0) return 0
  return Math.floor(mb) * 1024 * 1024
}

function guestUsageEntry(key) {
  const entry = key ? metadata.guestUsage?.[key] : null
  return entry && typeof entry === 'object' ? entry : { bytes: 0, uploads: 0 }
}

function formatBytesLabel(bytes = 0) {
  const value = Math.max(0, Number(bytes) || 0)
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(value % 1024 ** 3 ? 1 : 0)} GB`
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(value % 1024 ** 2 ? 1 : 0)} MB`
  return `${Math.round(value / 1024)} KB`
}

function guestQuotaExceededError({ usedBytes, limitBytes, incomingBytes }) {
  const remaining = Math.max(0, limitBytes - usedBytes)
  const error = httpError(413, `未登录累计可传输 ${formatBytesLabel(limitBytes)}（本设备已用 ${formatBytesLabel(usedBytes)}，剩余 ${formatBytesLabel(remaining)}，本次还需 ${formatBytesLabel(incomingBytes)}）。免费注册后即可获得 20 GB 个人空间，继续传输不受此限制`)
  error.code = 'guest_quota_exceeded'
  error.guestQuota = { usedBytes, limitBytes, incomingBytes, remainingBytes: remaining }
  return error
}

// 上传前预校验：返回本请求对应的游客 key（成功后用于计账），登录用户返回 ''。
function assertGuestQuota(req, res, files = []) {
  const limitBytes = guestQuotaLimitBytes()
  if (!limitBytes) return ''
  const key = resolveGuestKey(req, res)
  if (!key) return ''
  const usedBytes = guestUsageEntry(key).bytes
  const incomingBytes = files.reduce((sum, file) => sum + Number(file.size || 0), 0)
  if (usedBytes + incomingBytes > limitBytes) throw guestQuotaExceededError({ usedBytes, limitBytes, incomingBytes })
  return key
}

function addGuestUsage(key, files = []) {
  if (!key) return
  const bytes = files.reduce((sum, file) => sum + Number(file.size || 0), 0)
  if (!Number.isFinite(bytes) || bytes <= 0) return
  const store = metadata.guestUsage || (metadata.guestUsage = {})
  const entry = store[key] || { bytes: 0, uploads: 0, firstAt: '', lastAt: '' }
  entry.bytes += bytes
  entry.uploads = (entry.uploads || 0) + 1
  entry.firstAt = entry.firstAt || new Date().toISOString()
  entry.lastAt = new Date().toISOString()
  store[key] = entry
  persistMetadata()
}

function enforceDownloadOrigin(req) {
  const requestOrigin = getRequestOrigin(req)
  const directOrigin = `${req.protocol}://${req.get('host')}`
  const allowedOrigins = new Set([requestOrigin, directOrigin, configuredAppUrl, 'http://localhost:4173', 'http://127.0.0.1:4173', ...configuredCallbackUrls].filter(Boolean).map((value) => {
    try { return new URL(value).origin } catch { return '' }
  }).filter(Boolean))
  for (const header of [req.get('origin'), req.get('referer')]) {
    if (!header) continue
    try {
      if (!allowedOrigins.has(new URL(header).origin)) throw httpError(403, '下载来源不受信任，请从鲲穹页面发起下载')
    } catch (error) {
      if (error.status) throw error
      throw httpError(403, '下载来源不受信任，请从鲲穹页面发起下载')
    }
  }
}

function setShareAccessCookie(res, req, share) {
  if (!share.passwordHash) return
  res.setHeader('Set-Cookie', serializeCookie(shareAccessCookieName(share), shareAccessCookieValue(share), {
    httpOnly: true,
    maxAge: SHARE_ACCESS_TTL_SECONDS,
    path: `/api/shares/${share.id}`,
    sameSite: 'Lax',
    secure: isSecureRequest(req),
  }))
}

function hasShareAccessCookie(req, share) {
  if (!share.passwordHash) return false
  return readCookie(req, shareAccessCookieName(share)) === shareAccessCookieValue(share)
}

function shareAccessCookieName(share) {
  return `${SHARE_ACCESS_COOKIE_PREFIX}${share.id}`
}

function shareAccessCookieValue(share) {
  return hashSecret(`share-preview:${share.id}:${share.passwordHash}`)
}

function registerShareDownload(share, res) {
  if (res.req.method === 'HEAD') return
  let counted = false
  res.on('finish', () => {
    if (counted || res.statusCode < 200 || res.statusCode >= 300) return
    counted = true
    share.downloadCount += 1
    share.updatedAt = new Date().toISOString()
    addShareDownloadedMessage(share)
    persistMetadata()
  })
}

function sendPreviewFile(req, res, next, filePath, file) {
  const kind = previewKind(file)
  if (!kind) return res.status(415).json({ message: '当前文件类型暂不支持在线预览' })
  if (!fs.existsSync(filePath)) return res.status(410).json({ message: '文件已清理，无法预览' })
  const stat = fs.statSync(filePath)
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Content-Disposition', contentDisposition('inline', normalizeUploadFileName(file.name || path.basename(filePath))))
  res.setHeader('X-Preview-Type', kind)
  res.setHeader('X-Preview-File-Size', String(stat.size))
  // 文本类预览一律按纯文本返回，避免 html/xml 等以 text/html 内联渲染带来 XSS 风险
  res.type(kind === 'text' ? 'text/plain; charset=utf-8' : fileContentType(file))
  const range = req.get('range')
  if (!range) {
    res.setHeader('Content-Length', String(stat.size))
    fs.createReadStream(filePath).on('error', next).pipe(res)
    return
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
  if (!match || (match[1] === '' && match[2] === '')) {
    res.setHeader('Content-Range', `bytes */${stat.size}`)
    return res.status(416).end()
  }
  let start = match[1] === '' ? Math.max(0, stat.size - Number(match[2])) : Number(match[1])
  let end = match[2] === '' ? stat.size - 1 : Number(match[2])
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= stat.size) {
    res.setHeader('Content-Range', `bytes */${stat.size}`)
    return res.status(416).end()
  }
  end = Math.min(end, stat.size - 1)
  res.status(206)
  res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`)
  res.setHeader('Content-Length', String(end - start + 1))
  fs.createReadStream(filePath, { start, end }).on('error', next).pipe(res)
}

function sendDownloadFile(req, res, next, filePath, file) {
  if (!fs.existsSync(filePath)) return res.status(410).json({ message: '文件已清理，无法下载' })
  const stat = fs.statSync(filePath)
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('X-Download-File-Count', '1')
  res.setHeader('X-Download-Resume', 'range')
  res.setHeader('X-Download-Total-Size', String(stat.size))
  if (file.mimeType) res.type(file.mimeType)
  res.setHeader('Content-Disposition', contentDisposition('attachment', normalizeUploadFileName(file.name || path.basename(filePath))))
  if (req.method === 'HEAD') { res.setHeader('Content-Length', String(stat.size)); return res.end() }
  const range = req.get('range')
  if (!range) {
    res.setHeader('Content-Length', String(stat.size))
    fs.createReadStream(filePath).on('error', next).pipe(res)
    return
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
  if (!match || (match[1] === '' && match[2] === '')) {
    res.setHeader('Content-Range', `bytes */${stat.size}`)
    return res.status(416).end()
  }
  let start = match[1] === '' ? Math.max(0, stat.size - Number(match[2])) : Number(match[1])
  let end = match[2] === '' ? stat.size - 1 : Number(match[2])
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= stat.size) {
    res.setHeader('Content-Range', `bytes */${stat.size}`)
    return res.status(416).end()
  }
  end = Math.min(end, stat.size - 1)
  res.status(206)
  res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`)
  res.setHeader('Content-Length', String(end - start + 1))
  fs.createReadStream(filePath, { start, end }).on('error', next).pipe(res)
}

async function streamZip(res, next, filename, entries) {
  const availableEntries = entries.filter((entry) => fs.existsSync(entry.path))
  if (!availableEntries.length) return res.status(410).json({ message: '文件已清理，无法下载' })
  const totalSize = availableEntries.reduce((sum, entry) => sum + Number(entry.size || 0), 0)
  res.setHeader('X-Download-File-Count', String(availableEntries.length))
  res.setHeader('X-Download-Resume', 'unsupported-for-archive')
  res.setHeader('X-Download-Total-Size', String(totalSize))
  res.setHeader('Accept-Ranges', 'none')
  res.attachment(filename)
  if (res.req.method === 'HEAD') return res.end()
  const archive = archiver('zip', { zlib: { level: 6 } })
  archive.on('warning', (error) => {
    if (error.code === 'ENOENT') console.warn(error)
    else next(error)
  })
  archive.on('error', next)
  archive.pipe(res)
  for (const entry of availableEntries) {
    archive.file(entry.path, { name: zipEntryPath(entry.name) })
  }
  await archive.finalize()
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

function zipEntryPath(...parts) {
  return parts
    .filter((part) => String(part || '').trim())
    .flatMap((part) => safeRelativePath(part).split('/'))
    .filter(Boolean)
    .join('/') || '未命名文件'
}

const TEXT_PREVIEW_EXTENSIONS = new Set([
  '.txt', '.md', '.log', '.json', '.xml', '.yml', '.yaml', '.ini', '.conf',
  '.js', '.jsx', '.ts', '.tsx', '.html', '.htm', '.css', '.vue', '.swift', '.kt',
  '.java', '.py', '.go', '.php', '.rb', '.rs', '.c', '.cpp', '.h', '.cs',
  '.sh', '.ps1', '.bat', '.cmd', '.sql',
])

function previewKind(file = {}) {
  const contentType = fileContentType(file)
  const extension = path.extname(file.name || file.relativePath || '').toLowerCase()
  if (contentType === 'application/pdf' || extension === '.pdf') return 'pdf'
  if ((contentType.startsWith('image/') && contentType !== 'image/svg+xml') || ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(extension)) return 'image'
  if (contentType.startsWith('video/') || ['.mp4', '.webm', '.ogv', '.mov', '.m4v'].includes(extension)) return 'video'
  if (contentType.startsWith('audio/') || ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.oga', '.ogg'].includes(extension)) return 'audio'
  if (contentType.includes('wordprocessingml') || extension === '.docx') return 'document'
  if (contentType.includes('spreadsheetml') || ['.xlsx', '.xls', '.csv'].includes(extension)) return 'spreadsheet'
  if (contentType.includes('presentationml') || extension === '.pptx') return 'presentation'
  if (contentType.startsWith('text/') || TEXT_PREVIEW_EXTENSIONS.has(extension)) return 'text'
  return ''
}

function fileContentType(file = {}) {
  const mimeType = String(file.mimeType || '').trim().toLowerCase()
  if (mimeType && mimeType !== 'application/octet-stream') return mimeType
  const extension = path.extname(file.name || file.relativePath || '').toLowerCase()
  const mimeTypes = {
    '.aac': 'audio/aac',
    '.bmp': 'image/bmp',
    '.csv': 'text/csv',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.flac': 'audio/flac',
    '.gif': 'image/gif',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.m4a': 'audio/mp4',
    '.m4v': 'video/mp4',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.oga': 'audio/ogg',
    '.ogg': 'audio/ogg',
    '.ogv': 'video/ogg',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.svg': 'image/svg+xml',
    '.wav': 'audio/wav',
    '.webm': 'video/webm',
    '.webp': 'image/webp',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }
  return mimeTypes[extension] || 'application/octet-stream'
}

function contentDisposition(type, filename) {
  const fallback = String(filename || 'preview')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '')
    .trim() || 'preview'
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(String(filename || fallback))}`
}

function assertTeamCapacity(organization, incomingBytes) {
  const usage = accountTeamUsageForOrganization(organization)
  if (!usage.totalBytes) throw httpError(403, '当前团队套餐没有配置团队空间')
  if (usage.usedBytes + Number(incomingBytes || 0) > usage.totalBytes) {
    throw httpError(507, `团队空间不足，剩余 ${formatByteSize(usage.remainingBytes)}`)
  }
}

function assertUniqueTeamResourceNames(organization, files) {
  const existingNames = new Set(
    metadata.shares
      .filter((share) => share.teamResource && share.teamOrganizationId === organization?.id)
      .flatMap((share) => share.files || [])
      .map((file) => normalizeUploadFileName(file.name || '').trim().toLowerCase())
      .filter(Boolean),
  )
  const incomingNames = new Set()
  for (const file of files || []) {
    const name = normalizeUploadFileName(file.name || '').trim()
    const normalized = name.toLowerCase()
    if (!normalized || existingNames.has(normalized) || incomingNames.has(normalized)) {
      throw httpError(409, `团队空间中已存在同名文件“${name || '未命名文件'}”`)
    }
    incomingNames.add(normalized)
  }
}

function collectionCapacityBytes(task) {
  if (task.ownerUserId) return accountUsageForUser(task.ownerUserId).totalBytes
  const configured = guestQuotaLimitBytes() || 1024 * 1024 * 1024
  return Math.min(Number(task.capacityBytes) > 0 ? Number(task.capacityBytes) : configured, configured)
}

function assertCollectionFiles(task, files) {
  if (files.some((file) => file.size > task.maxFileSizeMb * 1024 * 1024 || !isAllowedType(file.originalname || file.name, task.allowedTypes))) {
    throw httpError(413, '文件不符合当前收集任务的大小或格式限制')
  }
}

function pendingUploadBytes(predicate, excludeId) {
  let bytes = 0
  for (const [id, item] of [...uploadSessions, ...uploadReservations]) {
    if (id !== excludeId && predicate(item)) bytes += fileListSize(item.files)
  }
  return bytes
}

function assertUploadCapacity(item, excludeId) {
  const incomingBytes = fileListSize(item.files)
  if (item.guestKey && guestQuotaLimitBytes()) {
    const usedBytes = guestUsageEntry(item.guestKey).bytes + pendingUploadBytes((other) => other.guestKey === item.guestKey, excludeId)
    if (usedBytes + incomingBytes > guestQuotaLimitBytes()) throw guestQuotaExceededError({ usedBytes, limitBytes: guestQuotaLimitBytes(), incomingBytes })
  }
  if (item.collectionToken) {
    const task = metadata.collections.find((task) => task.token === item.collectionToken)
    if (!task) throw httpError(404, '收集任务不存在')
    assertCollectionFiles(task, item.files)
    if (!task.ownerUserId) {
      const usedBytes = task.submissions.reduce((sum, submission) => sum + fileListSize(submission.files), 0)
      const reservedBytes = pendingUploadBytes((other) => other.collectionToken === task.token, excludeId)
      if (usedBytes + reservedBytes + incomingBytes > collectionCapacityBytes(task)) throw httpError(507, '此匿名收集任务的总容量已不足，请联系发起人')
    }
  }
  if (item.organizationId) {
    const organization = Object.values(metadata.organizations).find((organization) => organization.id === item.organizationId)
    if (!organization) throw httpError(404, '团队空间不存在')
    assertTeamCapacity(organization, incomingBytes + pendingUploadBytes((other) => other.organizationId === item.organizationId, excludeId))
  } else {
    const ownerId = item.capacityOwnerUserId || item.ownerUserId
    assertAccountCapacity(accountUserById(ownerId), incomingBytes + pendingUploadBytes((other) => !other.organizationId && (other.capacityOwnerUserId || other.ownerUserId) === ownerId, excludeId))
  }
}

function reserveUploadCapacity(item) {
  assertUploadCapacity(item)
  const id = createToken(18)
  uploadReservations.set(id, item)
  return id
}

function assertAccountCapacity(user, incomingBytes) {
  if (!user?.id) return
  const usage = accountUsageForUser(user.id)
  if (usage.usedBytes + Number(incomingBytes || 0) > usage.totalBytes) {
    throw httpError(507, `账号容量不足，当前${accountPlanForUser(user).label}剩余 ${formatByteSize(usage.remainingBytes)}`)
  }
}

function shouldDeliverAccountEmail(userId, eventType) {
  const settings = accountNotificationSettingsForUser(userId)
  if (!settings.email) return false
  return !eventType || !Object.prototype.hasOwnProperty.call(settings, eventType) || settings[eventType] !== false
}

function resolveRecipientUserIds(recipients = [], legacy = false) {
  const ids = new Set()
  for (const recipient of recipients) {
    const contact = normalizeContactTarget(recipient)
    const raw = String(recipient).trim().toLowerCase()
    const matches = Object.values(metadata.users || {}).filter((user) => contact
      ? (contact.type === 'email' ? normalizeEmailValue(user.email) === contact.value : normalizePhoneValue(user.phone) === contact.value)
      : [user.id, user.username].some((value) => String(value || '').toLowerCase() === raw))
    if (!contact && matches.length !== 1 && !legacy) throw httpError(400, '指定账号不存在或不唯一，请使用账号 ID、邮箱或手机号')
    for (const user of matches) ids.add(user.id)
  }
  return [...ids]
}

function findUsersByRecipient(recipient) {
  const raw = trimRecordString(recipient, 160).toLowerCase()
  if (!raw) return []
  const target = normalizeContactTarget(raw)
  return Object.values(metadata.users || {}).filter((user) => {
    if (target?.type === 'email' && normalizeEmailValue(user.email) === target.value) return true
    if (target?.type === 'phone' && normalizePhoneValue(user.phone) === target.value) return true
    return [user.id, user.username, user.nickname].some((value) => trimRecordString(value, 160).toLowerCase() === raw)
  })
}

async function notifyShareRecipients(share, req, ownerUser = null) {
  const recipients = Array.isArray(share.deliveryRecipients) ? share.deliveryRecipients : []
  const ownerName = displayAccountName(ownerUser)
  const title = share.files?.[0]?.name || '文件分享'
  return Promise.all(recipients.map(async (recipient) => {
    const matchedUsers = findUsersByRecipient(recipient)
    const deliveredUserIds = []
    for (const user of matchedUsers) {
      const delivered = addAccountMessage(user.id, {
        category: 'other',
        eventType: 'incomingShare',
        title: '你收到一个文件分享',
        body: `${ownerName} 给你发送了 ${share.files.length} 个文件，取件码 ${share.code}。`,
        actionUrl: `/share/${share.id}`,
      })
      if (delivered) deliveredUserIds.push(user.id)
    }
    const target = normalizeContactTarget(recipient)
    const statusParts = []
    if (deliveredUserIds.length) statusParts.push('站内已发送')
    let emailSent = false
    if (target?.type === 'email') {
      const matchedEmailUsers = matchedUsers.filter((user) => normalizeEmailValue(user.email) === target.value)
      const emailEnabled = !matchedEmailUsers.length || matchedEmailUsers.some((user) => shouldDeliverAccountEmail(user.id, 'incomingShare'))
      if (!emailEnabled) {
        statusParts.push('邮件提醒已关闭')
      } else if (!isSmtpConfigured()) {
        statusParts.push('邮件通道未配置')
      } else {
        try {
          const result = await sendShareEmail({ recipient: target.value, share, req, ownerName, title })
          emailSent = Array.isArray(result?.accepted) ? result.accepted.some((item) => String(item).toLowerCase() === target.value) : true
          statusParts.push(emailSent ? '邮件已提交投递' : '邮件未被服务器接受')
        } catch (error) {
          console.error(`邮件投递失败（${target.value}）：`, error.message || error)
          statusParts.push(`邮件发送失败：${mailErrorReason(error)}`)
        }
      }
    } else if (target?.type === 'phone' && !deliveredUserIds.length) {
      // 该手机号未匹配到平台账号：短信验证码类通道本来就不给陌生人发，如实说明。
      statusParts.push('该手机号未匹配到平台账号，未发送短信通知')
    }
    if (!statusParts.length) statusParts.push('未匹配账号')
    return {
      recipient,
      status: statusParts.join('，'),
      channel: emailSent ? 'email' : deliveredUserIds.length ? 'in-app' : target?.type || 'unknown',
      sentAt: new Date().toISOString(),
      deliveredUserIds,
      title,
      shareUrl: `${getOrigin(req)}/share/${share.id}`,
    }
  }))
}

async function sendShareEmail({ recipient, share, req, ownerName, title }) {
  const transporter = getEmailTransporter()
  if (!transporter) throw new Error('SMTP 邮件服务未配置')
  const shareInfo = publicShare(share, req, false, false)
  const shareUrl = shareInfo.enterpriseUrl || shareInfo.shareUrl
  const expiryText = share.expiresAt ? new Date(share.expiresAt).toLocaleString('zh-CN') : '永久有效'
  // 腾讯云 SMTP 会拒绝当前二维码 Data URL 生成的 MIME Base64 附件，邮件改用可点击分享链接。
  return transporter.sendMail({
    from: { name: smtpFromName || '鲲穹文件传输', address: smtpFrom },
    to: recipient,
    subject: `你收到一个文件分享：${title}`,
    text: `${ownerName} 通过鲲穹文件传输向你发送了 ${share.files.length} 个文件。\n\n打开链接：${shareUrl}\n取件码：${share.code}\n有效期：${expiryText}\n${share.passwordHash ? '该分享还需要输入提取密码。' : ''}`,
    html: buildShareEmailHtml({ share, shareUrl, ownerName, title, expiryText, hasQr: false }),
  })
}

function buildShareEmailHtml({ share, shareUrl, ownerName, title, expiryText, hasQr }) {
  const passwordHint = share.passwordHash ? '<p style="color:#9a6d23;">该分享还需要输入提取密码。</p>' : ''
  const qr = hasQr ? '<img src="cid:kunqiong-share-qr" alt="分享二维码" width="180" height="180" style="display:block;width:180px;height:180px;margin:20px auto 0;border:1px solid #e1ece8;" />' : ''
  const template = fs.readFileSync(shareEmailTemplatePath, 'utf8')
  return template
    .replaceAll('{{OWNER_NAME}}', escapeHtml(ownerName))
    .replaceAll('{{FILE_COUNT}}', String(share.files.length))
    .replaceAll('{{TITLE}}', escapeHtml(title))
    .replaceAll('{{SHARE_URL}}', escapeHtml(shareUrl))
    .replaceAll('{{CODE}}', escapeHtml(share.code))
    .replaceAll('{{EXPIRY_TEXT}}', escapeHtml(expiryText))
    .replaceAll('{{PASSWORD_HINT}}', passwordHint)
    .replaceAll('{{QR_IMAGE}}', qr)
}

function qrDataUrlAttachment(value) {
  const match = /^data:image\/png;base64,([a-z0-9+/=]+)$/i.exec(String(value || ''))
  if (!match) return null
  return { filename: 'kunqiong-share-qr.png', content: Buffer.from(match[1], 'base64'), cid: 'kunqiong-share-qr' }
}

function addShareDownloadedMessage(share) {
  if (!share.ownerUserId) return null
  return addAccountMessage(share.ownerUserId, {
    category: 'system',
    eventType: 'shareDownloaded',
    title: '你发送的文件已被下载',
    body: `${share.files?.[0]?.name || '文件分享'} 已产生第 ${share.downloadCount} 次下载。`,
    actionUrl: `/share/manage/${share.manageToken}`,
  })
}

function addCollectionSubmissionMessage(task, submission, req) {
  if (!task.ownerUserId) return null
  // 登录提交时明确标注「账号提交」，与匿名提交在通知里一眼可分。
  const who = submission.submitterUserId
    ? `${submission.participantName || '提交者'}（已登录账号提交）`
    : `${submission.participantName || '提交者'}（匿名提交）`
  return addAccountMessage(task.ownerUserId, {
    category: 'other',
    eventType: 'collectionSubmitted',
    title: '收集任务收到新提交',
    body: `${who} 向「${task.title}」提交了 ${submission.files.length} 个文件。`,
    actionUrl: `${getOrigin(req)}/collect/manage/${task.manageToken}`,
  })
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

function publicSubmission(submission) {
  return {
    id: submission.id,
    participantName: submission.participantName,
    // 提交者账号信息：登录提交时记录，管理端据此区分「谁提交的」。
    // 匿名/历史提交没有这段，管理端回落到 participantName。
    submitter: publicSubmissionSubmitter(submission),
    submittedAt: submission.submittedAt,
    files: submission.files.map(publicFile),
  }
}

function publicSubmissionSubmitter(submission = {}) {
  const id = trimRecordString(submission.submitterUserId, 120)
  if (!id) return null
  const user = accountUserById(id) || {}
  return {
    id,
    nickname: trimRecordString(user.nickname, 80),
    username: trimRecordString(user.username, 80),
    // 显示名优先取账号昵称；账号已被删除时回落提交当时的快照名。
    displayName: trimRecordString(user.nickname || user.username, 80) || trimRecordString(submission.submitterName, 80),
    avatar: user.avatar || null,
    avatarSource: String(user.avatarSource || ''),
    providerAvatar: user.providerAvatar || (!user.avatarSource ? user.avatar : null) || null,
    email: normalizeEmailValue(user.email),
    phone: normalizePhoneValue(user.phone),
  }
}

// 收集任务提交者身份：登录用户优先（以服务端会话为准，客户端无法伪造），
// 未登录时回落请求体中的 participantName（保留匿名提交能力）。
function resolveCollectionSubmitter(req) {
  const session = authSessionFromRequest(req)
  const user = session?.user?.id ? accountUserById(session.user.id) : null
  if (!user) {
    return { submitterUserId: '', submitterName: '', participantName: String(req.body?.participantName || '').trim() }
  }
  const name = displayAccountName(user)
  return {
    submitterUserId: String(user.id || ''),
    submitterName: name,
    // 登录用户不再采信客户端传的名称，统一记为账号显示名 —— 否则统计口径会被前端参数带偏。
    participantName: name,
  }
}

async function createShareFromTempFiles(tempFiles, options, req) {
  let reservedCode = ''
  try {
    const ownerSession = authSessionFromRequest(req)
    const totalSize = tempFiles.reduce((sum, file) => sum + Number(file.size || 0), 0)
    if (options.teamResource) {
      const organization = Object.values(metadata.organizations || {}).find((item) => item.id === options.teamOrganizationId)
      if (!organization) throw httpError(404, '团队空间不存在')
      assertUniqueTeamResourceNames(organization, tempFiles)
      assertTeamCapacity(organization, totalSize)
    } else {
      assertAccountCapacity(ownerSession?.user, totalSize)
    }
    const shareToken = createToken(10)
    const shareDirectory = path.join(filesRoot, shareToken)
    fs.mkdirSync(shareDirectory, { recursive: true })
    const files = tempFiles.map((file, index) => {
      const relativePath = safeRelativePath(file.relativePath || file.name)
      const storedName = `${String(index + 1).padStart(2, '0')}-${crypto.randomBytes(4).toString('hex')}-${path.basename(relativePath)}`
      fs.renameSync(file.tempPath, path.join(shareDirectory, storedName))
      return {
        name: file.name,
        relativePath,
        storedName,
        size: Number(file.size || 0),
        mimeType: file.mimeType || 'application/octet-stream',
        reviewStatus: file.reviewStatus || 'unscanned',
        scanEngine: file.scanEngine || null,
        scannedAt: file.scannedAt || null,
      }
    })
    const expiryDays = String(options.expiryDays || '3')
    const downloadLimit = normalizeDownloadLimit(options.downloadLimit)
    reservedCode = createCode(options.codeLength)
    const share = {
      id: shareToken,
      manageToken: createToken(18),
      code: reservedCode,
      files,
      createdAt: new Date().toISOString(),
      expiresAt: expiryDays === '0' ? null : new Date(Date.now() + Number(expiryDays) * 86400000).toISOString(),
      downloadLimit,
      downloadCount: 0,
      passwordHash: options.password ? hashSecret(options.password) : null,
      deliveryRecipients: options.recipients,
      recipientUserIds: options.recipientUserIds,
      recipientContacts: options.recipientContacts,
      notificationLog: [],
      ownerUserId: ownerSession?.user?.id || '',
      status: 'active',
      teamResource: Boolean(options.teamResource),
      teamOrganizationId: options.teamResource ? String(options.teamOrganizationId || '') : '',
    }
    const shareUrl = `${getOrigin(req)}/share/${shareToken}`
    share.qrDataUrl = await QRCode.toDataURL(shareUrl, { width: 180, margin: 1 })
    share.notificationLog = await notifyShareRecipients(share, req, ownerSession?.user)
    metadata.shares.push(share)
    reservedShareCodes.delete(reservedCode)
    persistMetadata()
    return share
  } catch (error) {
    if (reservedCode) reservedShareCodes.delete(reservedCode)
    throw error
  }
}

// 读取分享参数。isTeamResource=true 表示文件进入团队空间：
// 团队资源的「永久保存」由团队空间本身决定（团队容量属于所有者），
// **不**受上传者个人套餐的 permanent 限制 —— 否则基础版/未升级成员加入企业版团队后
// 会因个人 permanent=false 而无法往团队空间上传文件。
function readShareOptions(body = {}, user = null, isTeamResource = false) {
  const config = normalizeSystemConfig(metadata.systemConfig)
  const recipients = parseRecipients(body.recipients, { max: 50 })
  if (recipients.length && !user?.id) throw httpError(401, '定向发送需要先登录')
  const recipientUserIds = resolveRecipientUserIds(recipients)
  // 兼容数字 0：'0'/'0'（永久）是合法值，不能被 || 吞掉回落默认天数。
  const rawExpiryDays = body.expiryDays
  const requestedExpiryDays = String(rawExpiryDays === 0 || rawExpiryDays === '0' ? '0' : (rawExpiryDays || config.defaultShareDays))
  const maxShareDays = config.maxShareDays
  if (requestedExpiryDays === '0' && !isTeamResource && !accountEffectivePlanForUser(user || {}).permanent) {
    throw httpError(403, '永久保存需要会员版或更高权益')
  }
  return {
    expiryDays: requestedExpiryDays === '0' ? '0' : String(Math.min(maxShareDays, Math.max(1, Number(requestedExpiryDays) || config.defaultShareDays))),
    downloadLimit: String(body.downloadLimit || 'unlimited'),
    password: String(body.password || ''),
    codeLength: Number(body.codeLength || 6),
    // 收件人上限：防止一次创建触发海量外发邮件（邮件放大/发信域名被封）。
    recipients,
    recipientUserIds,
    recipientContacts: recipients.filter((recipient) => normalizeContactTarget(recipient) && !resolveRecipientUserIds([recipient], true).length),
    teamResource: Boolean(isTeamResource),
  }
}

function normalizeDownloadLimit(value) {
  if (!value || value === 'unlimited') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null
}

function findShareByManageToken(manageToken) {
  return metadata.shares.find((share) => share.manageToken === String(manageToken || ''))
}

function applyShareUpdate(share, body = {}, ownerUser = null) {
  // 团队资源的有效期/永久权益由团队决定（与上传路径 readShareOptions(isTeamResource=true) 同口径），
  // 不按上传者个人套餐校验 —— 否则基础版成员上传的团队资源，连团队所有者都无法重新开启或调整有效期。
  const plan = share.teamResource ? { permanent: true } : accountEffectivePlanForUser(ownerUser || {})
  // 两级特权：会员特权（改有效期/重新开启）= 永久权益或付费订阅在有效期内
  // （accountPlanForUser 会把到期订阅回落 free，特权随之自动收回）；
  // 永久特权（永久保存分享）仍仅限 permanent 权益（企业版/团队资源）。
  const hasMembership = Boolean(plan.permanent || (plan.id && plan.id !== 'free'))
  const wasClosed = currentShareStatus(share) === 'closed'
  if (Object.prototype.hasOwnProperty.call(body, 'expiresAt')) {
    const expiresAt = normalizeExpiryInput(body.expiresAt, '分享有效期')
    const currentExpiresAt = share.expiresAt || null
    if (expiresAt !== currentExpiresAt && !hasMembership) {
      throw httpError(403, '设置分享截止时间需要会员版或更高权益')
    }
    if (!expiresAt && !plan.permanent) throw httpError(403, '永久保存需要会员版或更高权益')
    if (expiresAt && !plan.permanent) {
      const maxDate = Date.now() + normalizeSystemConfig(metadata.systemConfig).maxShareDays * 86400000
      if (new Date(expiresAt).getTime() > maxDate) throw httpError(400, '当前权益不能超过系统设置的最长有效期')
    }
    share.expiresAt = expiresAt
    if ((share.status === 'expired' || share.status === 'closed') && (!expiresAt || new Date(expiresAt).getTime() > Date.now())) share.status = 'active'
    if (share.notificationFlags?.shareExpiring) share.notificationFlags = { ...share.notificationFlags, shareExpiring: false }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'downloadLimit')) {
    share.downloadLimit = normalizeDownloadLimit(body.downloadLimit)
  }
  if (body.clearPassword) {
    share.passwordHash = null
  } else if (Object.prototype.hasOwnProperty.call(body, 'password') && String(body.password || '').trim()) {
    share.passwordHash = hashSecret(String(body.password).trim())
  }
  if (Object.prototype.hasOwnProperty.call(body, 'status')) {
    const status = String(body.status || '').trim()
    if (!['active', 'closed'].includes(status)) throw httpError(400, '分享状态不支持')
    if (status === 'active') {
      if (!fs.existsSync(path.join(filesRoot, share.id))) {
        throw httpError(410, '分享文件已清理，无法重新开启，请重新发送文件')
      }
      if (wasClosed && !hasMembership) {
        throw httpError(403, '重新开启分享需要会员版或更高权益')
      }
      if (share.expiresAt && new Date(share.expiresAt).getTime() <= Date.now()) {
        throw httpError(400, '请先设置未来的截止时间，或选择永久保存')
      }
      if (!share.expiresAt && !plan.permanent) {
        throw httpError(403, '永久保存需要会员版或更高权益')
      }
      share.closeReason = ''
    } else {
      share.closeReason = 'manual'
    }
    share.status = status
  }
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

function normalizeExpiryInput(value, label) {
  if (value === null || value === 'permanent' || value === 'unlimited') return null
  const raw = String(value || '').trim()
  if (!raw) return null
  let date
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split('-').map(Number)
    date = new Date(year, month - 1, day, 23, 59, 59, 999)
  } else {
    date = new Date(raw)
  }
  if (Number.isNaN(date.getTime())) throw httpError(400, `${label}格式不正确`)
  return date.toISOString()
}

function findShareByCode(code) {
  return metadata.shares.find((share) => share.code.toLowerCase() === String(code).trim().toLowerCase())
}

function validateShare(share, password, { allowMissingPassword = false, hasAccessCookie = false, skipPassword = false } = {}) {
  const status = currentShareStatus(share)
  if (status === 'closed') return { ok: false, status: 410, message: '分享已关闭' }
  if (status === 'expired') {
    return { ok: false, status: 410, message: '分享已过期' }
  }
  if (share.downloadLimit && share.downloadCount >= share.downloadLimit) {
    return { ok: false, status: 410, message: '下载次数已用完' }
  }
  if (skipPassword) return { ok: true }
  if (hasAccessCookie && share.passwordHash) return { ok: true }
  if (allowMissingPassword && share.passwordHash && !password) return { ok: true }
  if (share.passwordHash && hashSecret(password || '') !== share.passwordHash) {
    return { ok: false, status: password ? 401 : 403, message: password ? '提取密码不正确' : '请输入提取密码' }
  }
  return { ok: true }
}

function validateCollection(task) {
  const status = currentCollectionStatus(task)
  if (status === 'closed') return { ok: false, status: 410, message: '收集任务已关闭' }
  if (status === 'expired') {
    return { ok: false, status: 410, message: '收集任务已截止' }
  }
  return { ok: true }
}

function createCode(requestedLength = 4) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const length = Math.min(6, Math.max(4, Number(requestedLength) || 6))
  let code = ''
  do {
    code = Array.from({ length }, () => alphabet[crypto.randomInt(alphabet.length)]).join('')
  } while (metadata.shares.some((share) => share.code === code) || reservedShareCodes.has(code))
  reservedShareCodes.add(code)
  return code
}

function normalizeCollectionAllowedTypes(types) {
  const allowed = Array.isArray(types) ? types.map(String).filter((type) => COLLECTION_TYPE_OPTIONS.includes(type)) : []
  if (!allowed.length || allowed.includes('全部格式')) return ['全部格式']
  return Array.from(new Set(allowed))
}

function isAllowedType(filename, allowedTypes) {
  const allowed = normalizeCollectionAllowedTypes(allowedTypes)
  if (allowed.includes('全部格式')) return true
  const extension = path.extname(filename).toLowerCase()
  const matchedType = Object.entries(COLLECTION_TYPE_EXTENSIONS).find(([, extensions]) => extensions.includes(extension))?.[0] || '其他'
  return allowed.includes(matchedType)
}

function cleanupUploadedFiles(files = []) {
  for (const file of files) {
    try { fs.unlinkSync(file.path) } catch {}
  }
}
