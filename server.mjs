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
import nodemailer from 'nodemailer'
import net from 'node:net'
import { once } from 'node:events'

import {
  storageRoot, tempRoot, filesRoot, collectionsRoot, distRoot, metadataPath, shareEmailTemplatePath,
  MAX_FILE_SIZE, MAX_FILES, EXPIRING_SOON_MS,
  UPLOAD_CHUNK_MIN_BYTES, UPLOAD_CHUNK_MAX_BYTES, UPLOAD_CHUNK_DEFAULT_BYTES, UPLOAD_SESSION_TTL_MS,
  oauthAuthorizeUrl, oauthTokenUrl, oauthClientId, oauthClientSecret,
  configuredCallbackUrls, configuredAppUrl, releaseSha,
  smtpHost, smtpPort, smtpSecure, smtpUser, smtpPassword, smtpFrom, smtpFromName,
  tencentSmsSecretId, tencentSmsSecretKey, tencentSmsSdkAppId, tencentSmsSignName,
  tencentSmsBindTemplateId, tencentSmsRegion,
  webMemberApiBase, webMemberSubsiteName, WEB_MEMBER_PACKAGE_ENV_KEYS, DEFAULT_WEB_MEMBER_PACKAGE_IDS,
  AUTH_COOKIE_NAME, SHARE_ACCESS_COOKIE_PREFIX, SHARE_ACCESS_TTL_SECONDS, OAUTH_STATE_TTL_MS,
  MAX_ACCOUNT_RECORDS, MAX_ACCOUNT_MESSAGES, MAX_RECORD_FILES, MAX_RECORD_SUBMISSIONS,
  VERIFICATION_CODE_TTL_MS, MAX_VERIFICATION_CODES, ACCOUNT_SINGLE_FILE_BYTES,
  ACCOUNT_RECORD_SCOPES, ACCOUNT_RECORD_KINDS, ACCOUNT_MESSAGE_CATEGORIES,
  ADMIN_USER_IDS, ADMIN_ACCOUNT_USERNAME, ADMIN_ACCOUNT_PASSWORD, adminCredentialsConfigured,
  ADMIN_COOKIE_NAME, ADMIN_SESSION_TTL_MS, ADMIN_LOGIN_MAX_ATTEMPTS, ADMIN_LOGIN_WINDOW_MS,
  JOIN_REQUEST_MAX_PER_WINDOW, JOIN_REQUEST_WINDOW_MS, JOIN_REQUEST_REJECT_COOLDOWN_MS,
  COLLECTION_TYPE_OPTIONS, COLLECTION_TYPE_EXTENSIONS, UPGRADE_ORDER_STATUSES,
  MAX_UPGRADE_ORDERS, PAYMENT_QUERY_RETENTION_MS, MAX_AUDIT_LOGS,
  MAX_METADATA_WRITE_ATTEMPTS,
  GUEST_ID_COOKIE, GUEST_ID_MAX_AGE_SECONDS, MAX_GUEST_USAGE_ENTRIES,
  scanMode, clamavHost, clamavPort, scanTimeoutMs,
  TEST_ENTERPRISE_USER_KEYS, testEnterpriseForAllUsers, testEnforceEnterpriseAllowlist,
  testVerificationDebugMode,
  databaseEnabled,
  serverPort,
  splitConfigValues, parseBooleanEnv,
} from './server/config.js'

import {
  httpError, parseRecipients, firstHeader, firstValue,
  escapeHtml, createToken, hashSecret, parseJson, removeDirectory,
} from './server/lib/http.js'
const DEFAULT_SYSTEM_CONFIG = {
  maintenanceMode: false,
  defaultShareDays: 3,
  maxShareDays: 30,
  anonymousMaxFileSizeMb: 500,
  // 游客累计可传输大小（MB），0 表示不限制。防止匿名通道被无限白嫖。
  anonymousTotalSizeMb: 1024,
  maxBatchFiles: MAX_FILES,
  auditLogRetentionDays: 90,
  orphanGraceHours: 24,
  planOverrides: {},
}
const ACCOUNT_PLANS = {
  free: {
    id: 'free', label: '基础版', totalBytes: 20 * 1024 * 1024 * 1024, permanent: false, team: false,
    tagline: '个人临时传输', monthlyPrice: 0, validityDays: null,
    features: ['20 GB 存储空间', '文件临时保存，到期自动失效', '分享码 / 链接 / 二维码取件', '文件收集任务'],
  },
  member: {
    id: 'member', label: '会员版', totalBytes: 100 * 1024 * 1024 * 1024, permanent: false, team: false,
    // monthlyPrice 仅作「主站实价拉不到时」的兜底展示价，尽量对齐主站当前挂牌价（轻享月卡 ¥19）；
    // 真实下单/支付金额始终以主站 pay_amount 为准（createWebMemberPaymentOrder 会覆盖 order.amount）。
    tagline: '个人会员空间', monthlyPrice: 1900, validityDays: 30,
    features: ['100 GB 存储空间', '会员期内文件持续保存', '完整分享与收集能力', '会员专属标识'],
  },
  team: {
    id: 'team', label: '团队版', totalBytes: 500 * 1024 * 1024 * 1024, teamSpaceBytes: 250 * 1024 * 1024 * 1024, permanent: false, team: true,
    tagline: '小团队协作', monthlyPrice: 4900, validityDays: 90,
    features: ['500 GB 个人空间', '250 GB 团队空间', '团队成员邀请与协作', '企业专属分享链接'],
  },
  enterprise: {
    id: 'enterprise', label: '企业版', totalBytes: 2 * 1024 * 1024 * 1024 * 1024, teamSpaceBytes: 1024 * 1024 * 1024 * 1024, permanent: true, team: true,
    tagline: '企业统一管控', monthlyPrice: 15900, validityDays: null,
    features: ['2048 GB 个人空间', '1024 GB 团队空间', '组织与成员统一管理', '企业专属入口与审计日志'],
  },
}
const ACCOUNT_PLAN_RANK = { free: 0, member: 1, team: 2, enterprise: 3 }
const DEFAULT_NOTIFICATION_SETTINGS = {
  inApp: true,
  email: false,
  incomingShare: true,
  shareExpiring: true,
  shareDownloaded: true,
  collectionExpiring: true,
  collectionSubmitted: true,
}
const DEFAULT_FILE_CLEANUP_SETTINGS = {
  enabled: false,
  days: 3,
}
const DEFAULT_ACCOUNT_MESSAGES = [
  { id: 'system-welcome', category: 'system', eventType: 'welcome', title: '欢迎使用鲲穹文件传输', body: '你的账户已连接，可以开始发送和收集文件。' },
  { id: 'official-update', category: 'official', eventType: 'official', title: '鲲穹服务通知', body: '站内消息、账号容量和账号绑定已接入当前账户。' },
]
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
const serverHost = process.env.HOST || process.env.KUNQIONG_HOST || '0.0.0.0'
let metadataNeedsPersist = false
let metadataReady = null
let emailTransporter = null
let metadataWriteQueue = Promise.resolve()
// 元数据并发写保护：revision 是快照的单调版本号，落盘走 CAS（MySQL 用 WHERE revision = ?）。
// 冲突时重读远端 + 合并 + 重试，避免多实例各自拿启动时的旧快照互相覆盖。
// MySQL 模式以数据库为准（metadata.json 只作镜像，不参与 CAS）；
// 本地模式以文件为准，用旁挂的 .revision 文件记录版本。两条路径各自独立计数。
const metadataRevisionPath = `${metadataPath}.revision`
const instanceTag = crypto.randomUUID().slice(0, 8)
let metadataRevision = 0
let metadataLocalRevision = 0
let metadataBaseIds = null
let metadataLocalBaseIds = null
let metadataConflictCount = 0
// 快照合并规则（合并算法见后面的 mergeMetadataSnapshots）。放在模块顶部是因为
// 启动阶段就会调用 metadataIdSets，必须早于任何落盘动作完成初始化。
const METADATA_MERGE_RULES = [
  { key: 'shares', kind: 'array', time: ['updatedAt', 'createdAt'] },
  { key: 'collections', kind: 'array', time: ['updatedAt', 'createdAt'] },
  { key: 'sessions', kind: 'array', time: ['createdAt'] },
  { key: 'upgradeOrders', kind: 'array', time: ['updatedAt', 'createdAt'] },
  { key: 'auditLogs', kind: 'array', time: ['createdAt'] },
  { key: 'organizations', kind: 'array', time: ['updatedAt', 'createdAt'] },
  { key: 'verificationCodes', kind: 'array', time: ['createdAt'] },
  { key: 'users', kind: 'map', time: ['updatedAt', 'createdAt'] },
  { key: 'records', kind: 'map', time: ['updatedAt', 'createdAt'] },
  { key: 'messages', kind: 'map', time: ['updatedAt', 'createdAt'] },
  { key: 'notificationSettings', kind: 'map', time: [] },
  { key: 'guestUsage', kind: 'map', time: ['lastAt'] },
]
const reservedShareCodes = new Set()
const databasePool = databaseEnabled ? mysql.createPool({
  host: databaseHost,
  port: databasePort,
  database: databaseName,
  user: databaseUser,
  password: databasePassword,
  waitForConnections: true,
  connectionLimit: Number(process.env.KUNQIONG_DB_CONNECTION_LIMIT || 5),
  queueLimit: 0,
  charset: 'utf8mb4',
}) : null

for (const directory of [storageRoot, tempRoot, filesRoot, collectionsRoot]) {
  fs.mkdirSync(directory, { recursive: true })
}

const metadata = normalizeMetadata(await loadMetadata())
metadataBaseIds = metadataIdSets(metadata)
metadataLocalBaseIds = metadataBaseIds
for (const share of metadata.shares) {
  if (share.deliveryRecipients?.length && !Array.isArray(share.recipientUserIds)) {
    const notifiedIds = (share.notificationLog || []).flatMap((entry) => entry.deliveredUserIds || [])
    share.recipientUserIds = [...new Set([...notifiedIds, ...resolveRecipientUserIds(share.deliveryRecipients, true)])]
    share.recipientContacts = share.deliveryRecipients.filter((recipient) => normalizeContactTarget(recipient) && !resolveRecipientUserIds([recipient], true).length)
    metadataNeedsPersist = true
  }
}
metadataReady = metadata
if (metadataNeedsPersist) persistMetadata()
const uploadSessions = new Map()
const uploadReservations = new Map()
const upgradeOrderLocks = new Map()
const paymentReconcileAttempts = new Map()
const paymentSessionTokens = new Map()
const adminLoginAttempts = new Map()
const adminSessions = new Map()
const oauthStates = new Map()
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

function normalizeUploadFileName(value = '') {
  const raw = String(value || '').trim()
  if (!raw) return raw
  const decoded = Buffer.from(raw, 'latin1').toString('utf8')
  if (decoded && decoded !== raw && !decoded.includes('\uFFFD') && looksLikeMojibake(raw)) return decoded
  return raw
}

function looksLikeMojibake(value = '') {
  return /(?:Ã|Â|Ä|Å|Æ|Ç|È|É|Ê|Ë|Ì|Í|Î|Ï|Ð|Ñ|Ò|Ó|Ô|Õ|Ö|Ø|Ù|Ú|Û|Ü|Ý|Þ|ß|à|á|â|ã|ä|å|æ|ç|è|é|ê|ë|ì|í|î|ï|ð|ñ|ò|ó|ô|õ|ö|ø|ù|ú|û|ü|ý|þ|ÿ)/.test(String(value))
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

app.get('/api/auth/login', (req, res) => {
  let returnTo = safeReturnUrl('', req)
  try {
    returnTo = safeReturnUrl(req.query.return_to, req)
    if (!isOAuthConfigured()) {
      return res.redirect(appendAuthResult(returnTo, 'failed', '登录服务未配置'))
    }

    cleanupOAuthStates()
    const state = createToken(32)
    const redirectUri = authRedirectUri(req)
    returnTo = alignReturnUrlWithAuthHost(returnTo, redirectUri)
    oauthStates.set(state, { redirectUri, returnTo, createdAt: Date.now() })

    const loginUrl = new URL(oauthAuthorizeUrl)
    loginUrl.searchParams.set('client_id', oauthClientId)
    loginUrl.searchParams.set('redirect_uri', redirectUri)
    loginUrl.searchParams.set('response_type', 'code')
    loginUrl.searchParams.set('state', state)
    return res.redirect(loginUrl.toString())
  } catch (error) {
    console.error('OAuth login redirect failed:', error)
    return res.redirect(appendAuthResult(returnTo, 'failed', '登录服务暂时不可用，请稍后重试'))
  }
})

app.get('/api/auth/me', (req, res) => {
  const session = authSessionFromRequest(req)
  res.json({ user: session ? publicAccountUser(session.user) : null })
})

app.patch('/api/auth/profile', (req, res) => {
  const session = authSessionFromRequest(req)
  if (!session) return res.status(401).json({ message: '请先登录' })

  const body = req.body || {}
  const hasNickname = Object.prototype.hasOwnProperty.call(body, 'nickname')
  const hasAvatar = Object.prototype.hasOwnProperty.call(body, 'avatar')
  if (!hasNickname && !hasAvatar) return res.status(400).json({ message: '没有可保存的资料' })

  // ⚠️ session.user 是**快照**，可能已经落后于用户表（例如这次登录后另一台设备刚改过头像）。
  // 用快照整体覆盖 upsertAccountUser 会把过期的 avatar / avatarSource 一并写回，
  // 造成"保存昵称顺手把头像改没了"或"恢复登录头像不生效"。
  // 因此这里始终以**用户表**为准来做合并。
  const stored = accountUserById(session.user.id) || {}
  const patch = { ...stored }

  if (hasNickname) {
    const nickname = String(body.nickname || '').trim()
    if (!nickname) return res.status(400).json({ message: '昵称不能为空' })
    if (nickname.length > 40) return res.status(400).json({ message: '昵称最多 40 个字符' })
    patch.nickname = nickname
  }
  if (hasAvatar) {
    const avatar = body.avatar === null ? null : String(body.avatar || '')
    if (avatar && (!/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(avatar) || Buffer.byteLength(avatar, 'utf8') > 600000)) {
      return res.status(400).json({ message: '头像格式不支持或图片过大，请上传 600 KB 以内的图片' })
    }
    // 显式写入 avatar 与 avatarSource，mergeAccountUser 才会认为"用户表了态"：
    // avatar 有值 → custom；avatar 为 null → 恢复登录头像（回落 provider）。
    const providerAvatar = stored.providerAvatar || session.user.providerAvatar || null
    patch.avatar = avatar || providerAvatar || null
    if (avatar) {
      patch.avatarSource = 'custom'
    } else {
      // 「恢复登录头像」：必须显式清空 avatarSource，并带上一个可识别的标记，
      // 否则 mergeAccountUser 会把这次操作误判成"没有表态的旧快照"而保留 custom。
      patch.avatarSource = ''
      patch.avatarRestoreRequested = true
    }
  }

  const user = upsertAccountUser(patch)
  syncAccountUserSessions(user)
  // 改名/换头像后同步团队 roster，否则团队空间会一直显示入团时的旧快照。
  syncOrganizationMemberProfile(user)
  persistMetadata()
  res.json({ user: publicAccountUser(user) })
})

function updateFileCleanupSettings(req, res) {
  const session = authSessionFromRequest(req)
  if (!session) return res.status(401).json({ message: '请先登录' })
  const settings = normalizeFileCleanupSettings(req.body?.settings)
  session.user = { ...session.user, fileCleanup: settings }
  const user = upsertAccountUser(session.user)
  syncAccountUserSessions(user)
  cleanupExpired()
  persistMetadata()
  res.json({ user: publicAccountUser(user), settings })
}

app.get('/api/account/file-cleanup-settings', (req, res) => {
  const session = authSessionFromRequest(req)
  if (!session) return res.status(401).json({ message: '请先登录' })
  res.json({ settings: normalizeFileCleanupSettings(accountUserById(session.user.id)?.fileCleanup || session.user.fileCleanup) })
})
app.put('/api/account/file-cleanup-settings', updateFileCleanupSettings)
app.patch('/api/account/file-cleanup-settings', updateFileCleanupSettings)
app.post('/api/account/file-cleanup-settings', updateFileCleanupSettings)

// 验证码发送限流：同一目标 60s 1 次、同一来源 IP 每小时 10 次，防止刷短信/邮件造成资损。
const VERIFICATION_TARGET_COOLDOWN_MS = 60 * 1000
const VERIFICATION_IP_WINDOW_MS = 60 * 60 * 1000
const VERIFICATION_IP_MAX = 10
const verificationTargetLastSent = new Map()
const verificationIpAttempts = new Map()

function verificationSendBlocked(target, req) {
  const now = Date.now()
  const targetKey = `${target.type}:${target.value}`
  const ipKey = `socket:${String(req.socket?.remoteAddress || '').trim() || 'unknown'}`
  if (verificationTargetLastSent.size + verificationIpAttempts.size > 5000) {
    for (const [key, at] of verificationTargetLastSent) {
      if (now - at > VERIFICATION_TARGET_COOLDOWN_MS) verificationTargetLastSent.delete(key)
    }
    for (const [key, entry] of verificationIpAttempts) {
      if (now - entry.startedAt > VERIFICATION_IP_WINDOW_MS) verificationIpAttempts.delete(key)
    }
  }
  const lastSent = verificationTargetLastSent.get(targetKey)
  if (lastSent && now - lastSent < VERIFICATION_TARGET_COOLDOWN_MS) {
    return '验证码发送过于频繁，请 1 分钟后再试'
  }
  const ipEntry = verificationIpAttempts.get(ipKey)
  if (ipEntry && now - ipEntry.startedAt <= VERIFICATION_IP_WINDOW_MS && ipEntry.count >= VERIFICATION_IP_MAX) {
    return '验证码发送过于频繁，请稍后再试'
  }
  verificationTargetLastSent.set(targetKey, now)
  const current = verificationIpAttempts.get(ipKey)
  if (!current || now - current.startedAt > VERIFICATION_IP_WINDOW_MS) {
    verificationIpAttempts.set(ipKey, { count: 1, startedAt: now })
  } else {
    current.count += 1
  }
  return null
}

app.post('/api/auth/code', async (req, res) => {
  try {
    const session = requireAuthSession(req, res)
    if (!session) return
    const target = normalizeContactTarget(req.body?.target)
    if (!target) return res.status(400).json({ message: '请输入正确的邮箱或手机号' })
    const blockedMessage = verificationSendBlocked(target, req)
    if (blockedMessage) return res.status(429).json({ message: blockedMessage })
    const debugCode = createVerificationCode(target, 'bind')
    if (target.type === 'email') {
      const transporter = getEmailTransporter()
      if (!transporter) {
        if (testVerificationDebugMode) {
          return res.status(201).json({
            ok: true,
            channel: 'email',
            debugCode,
            expiresIn: Math.floor(VERIFICATION_CODE_TTL_MS / 1000),
            message: '测试环境未配置 SMTP，已生成演示验证码。',
          })
        }
        discardVerificationCode(target, 'bind')
        return res.status(503).json({ message: '邮箱 SMTP 服务未配置，暂时无法发送验证码' })
      }
      try {
        await transporter.sendMail({
          from: { name: smtpFromName || '鲲穹文件传输', address: smtpFrom },
          to: target.value,
          subject: '鲲穹文件传输邮箱绑定验证码',
          text: `你的鲲穹文件传输邮箱绑定验证码是：${debugCode}。验证码 10 分钟内有效，请勿泄露给他人。`,
          html: `<div style="font-family:Arial,'Microsoft YaHei',sans-serif;color:#243b35;line-height:1.7;"><h2 style="margin:0 0 16px;">绑定邮箱验证码</h2><p>你的鲲穹文件传输邮箱绑定验证码是：</p><p style="font-size:28px;font-weight:700;letter-spacing:6px;color:#128c73;">${debugCode}</p><p style="color:#74877f;">验证码 10 分钟内有效，请勿泄露给他人。</p></div>`,
        })
      } catch (error) {
        if (testVerificationDebugMode) {
          return res.status(201).json({
            ok: true,
            channel: 'email',
            debugCode,
            expiresIn: Math.floor(VERIFICATION_CODE_TTL_MS / 1000),
            message: `测试环境邮件投递失败，已生成演示验证码（${mailErrorReason(error)}）。`,
          })
        }
        discardVerificationCode(target, 'bind')
        throw httpError(502, `验证码邮件发送失败：${mailErrorReason(error)}`)
      }
      return res.status(201).json({
        ok: true,
        channel: 'email',
        expiresIn: Math.floor(VERIFICATION_CODE_TTL_MS / 1000),
        message: '验证码已发送至你的邮箱，请查收邮件。',
      })
    }
    if (!isTencentSmsConfigured()) {
      if (testVerificationDebugMode) {
        return res.status(201).json({
          ok: true,
          channel: 'sms',
          debugCode,
          expiresIn: Math.floor(VERIFICATION_CODE_TTL_MS / 1000),
          message: '测试环境未配置短信服务，已生成演示验证码。',
        })
      }
      discardVerificationCode(target, 'bind')
      return res.status(503).json({ message: '短信服务未配置，暂时无法发送验证码' })
    }
    try {
      await sendTencentSmsCode(target.value, debugCode, tencentSmsBindTemplateId)
    } catch (error) {
      if (testVerificationDebugMode) {
        return res.status(201).json({
          ok: true,
          channel: 'sms',
          debugCode,
          expiresIn: Math.floor(VERIFICATION_CODE_TTL_MS / 1000),
          message: `测试环境短信投递失败，已生成演示验证码（${error.message || '腾讯云短信服务异常'}）。`,
        })
      }
      discardVerificationCode(target, 'bind')
      throw httpError(502, `验证码短信发送失败：${error.message || '腾讯云短信服务异常'}`)
    }
    res.status(201).json({
      ok: true,
      channel: 'sms',
      expiresIn: Math.floor(VERIFICATION_CODE_TTL_MS / 1000),
      message: '验证码已发送至你的手机，请查收短信。',
    })
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message || '验证码生成失败' })
  }
})

app.post('/api/account/bind', (req, res) => {
  try {
    const session = requireAuthSession(req, res)
    if (!session) return
    const target = normalizeContactTarget(req.body?.target)
    if (!target) return res.status(400).json({ message: '请输入正确的邮箱或手机号' })
    verifyAuthCode(target, req.body?.code, 'bind')
    const existingUser = findAccountUserByTarget(target)
    const boundByAnotherAccount = Object.values(metadata.users || {}).some((user) => (
      user.id !== session.user.id
      && (target.type === 'email'
        ? normalizeEmailValue(user.email) === target.value
        : normalizePhoneValue(user.phone) === target.value)
    ))
    if ((existingUser && existingUser.id !== session.user.id) || boundByAnotherAccount) {
      return res.status(409).json({ message: target.type === 'email' ? '该邮箱已绑定其他账号' : '该手机号已绑定其他账号' })
    }
    // 同样以用户表为准：绑定手机/邮箱不应把 session 快照里可能过期的头像写回去。
    const stored = accountUserById(session.user.id) || session.user
    const user = upsertAccountUser({
      ...stored,
      [target.type]: target.value,
      loginMethods: mergeLoginMethods(stored.loginMethods, [boundMethodForTargetType(target.type)]),
    })
    syncAccountUserSessions(user)
    persistMetadata()
    res.json({ user: publicAccountUser(user) })
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message || '账号绑定失败' })
  }
})

app.post('/api/auth/logout', (req, res) => {
  const sessionId = readCookie(req, AUTH_COOKIE_NAME)
  if (sessionId) removeAuthSession(sessionId)
  clearAuthCookie(res, req)
  res.json({ ok: true })
})

app.get('/api/account/records', (req, res) => {
  const session = requireAuthSession(req, res)
  if (!session) return
  res.json({ records: accountRecordsForUser(session.user.id) })
})

app.put('/api/account/records', (req, res) => {
  const session = requireAuthSession(req, res)
  if (!session) return
  const key = accountRecordOwnerKey(session.user.id)
  metadata.records[key] = pruneOrphanRecordEntries(normalizeAccountRecords(req.body?.records))
  persistMetadata()
  res.json({ records: metadata.records[key] })
})

app.post('/api/account/records', (req, res) => {
  const session = requireAuthSession(req, res)
  if (!session) return
  const body = req.body || {}
  const incoming = Array.isArray(body.records) ? body.records : body.record ? [body.record] : []
  if (!incoming.length) return res.status(400).json({ message: '没有可同步的记录' })
  const key = accountRecordOwnerKey(session.user.id)
  metadata.records[key] = mergeAccountRecords(accountRecordsForUser(session.user.id), incoming)
  persistMetadata()
  res.status(201).json({ records: metadata.records[key] })
})

app.delete('/api/account/records', (req, res) => {
  const session = requireAuthSession(req, res)
  if (!session) return
  const key = accountRecordOwnerKey(session.user.id)
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : []
  // 记录联动清理：删除记录时，把该用户名下「已关闭/过期」的底层分享/收集任务连同磁盘文件一并清掉，
  // 否则记录删了、后台统计和磁盘上还挂着僵尸资源（后台「分享/收集任务/待清理」不同步的根源）。
  // 仍在有效期的资源照旧保留，对方的提取链接不受影响。
  const purged = []
  if (ids.length) {
    const targets = new Set(ids)
    for (const id of ids) {
      const purgedResource = purgeOwnedStaleResource(session.user.id, id)
      if (purgedResource) purged.push(purgedResource)
    }
    metadata.records[key] = accountRecordsForUser(session.user.id).filter((record) => !targets.has(record.id))
  } else {
    for (const record of accountRecordsForUser(session.user.id)) {
      const purgedResource = purgeOwnedStaleResource(session.user.id, record.id)
      if (purgedResource) purged.push(purgedResource)
    }
    metadata.records[key] = []
  }
  persistMetadata()
  res.json({ records: metadata.records[key], purged })
})

app.get('/api/account/messages', (req, res) => {
  const session = requireAuthSession(req, res)
  if (!session) return
  res.json({ messages: accountMessagesForUser(session.user.id), settings: accountNotificationSettingsForUser(session.user.id) })
})

app.patch('/api/account/messages', (req, res) => {
  const session = requireAuthSession(req, res)
  if (!session) return
  const key = accountRecordOwnerKey(session.user.id)
  metadata.messages[key] = accountMessagesForUser(session.user.id).map((message) => ({ ...message, unread: false }))
  persistMetadata()
  res.json({ messages: metadata.messages[key] })
})

app.delete('/api/account/messages', (req, res) => {
  const session = requireAuthSession(req, res)
  if (!session) return
  const key = accountRecordOwnerKey(session.user.id)
  metadata.messages[key] = []
  persistMetadata()
  res.json({ messages: metadata.messages[key] })
})

app.patch('/api/account/messages/:messageId', (req, res) => {
  const session = requireAuthSession(req, res)
  if (!session) return
  const messages = accountMessagesForUser(session.user.id)
  const message = messages.find((item) => item.id === req.params.messageId)
  if (!message) return res.status(404).json({ message: '消息不存在' })
  message.unread = false
  message.readAt = new Date().toISOString()
  persistMetadata()
  res.json({ message, messages })
})

app.delete('/api/account/messages/:messageId', (req, res) => {
  const session = requireAuthSession(req, res)
  if (!session) return
  const key = accountRecordOwnerKey(session.user.id)
  metadata.messages[key] = accountMessagesForUser(session.user.id).filter((message) => message.id !== req.params.messageId)
  persistMetadata()
  res.json({ messages: metadata.messages[key] })
})

app.get('/api/account/notification-settings', (req, res) => {
  const session = requireAuthSession(req, res)
  if (!session) return
  res.json({ settings: accountNotificationSettingsForUser(session.user.id) })
})

app.put('/api/account/notification-settings', (req, res) => {
  const session = requireAuthSession(req, res)
  if (!session) return
  const key = accountRecordOwnerKey(session.user.id)
  metadata.notificationSettings[key] = normalizeNotificationSettings(req.body?.settings)
  persistMetadata()
  res.json({ settings: metadata.notificationSettings[key] })
})

app.get('/api/account/workspace', async (req, res) => {
  const session = requireAuthSession(req, res)
  if (!session) return
  await reconcileUserUpgradeOrders(session)
  res.json(accountWorkspacePayload(session.user))
})

app.get('/api/account/team/overview', (req, res) => {
  const session = requireAuthSession(req, res)
  if (!session) return
  const organization = accountOrganizationForUser(session.user.id)
  if (!organization) return res.status(404).json({ message: '你尚未加入团队空间' })
  // 待审批的入团申请（status='requested'）不是成员，不计入成员观察/成员列表，也不应参与团队资源归属判定。
  const rosterMembers = organization.members.filter((member) => member.status !== 'requested')
  const memberIds = new Set(rosterMembers.map((member) => member.userId).filter(Boolean))
  const memberUsage = rosterMembers.map((member) => {
    const shares = metadata.shares.filter((item) => item.teamResource && item.teamOrganizationId === organization.id && item.ownerUserId === member.userId)
    const shareBytes = shares.reduce((sum, item) => sum + fileListSize(item.files), 0)
    return {
      id: member.id,
      userId: member.userId,
      displayName: member.displayName,
      email: member.email,
      phone: member.phone,
      role: member.role,
      status: member.status,
      shareCount: shares.length,
      collectionCount: 0,
      fileCount: shares.reduce((sum, item) => sum + (item.files?.length || 0), 0),
      usedBytes: shareBytes,
      lastActivityAt: shares.map((item) => item.updatedAt || item.createdAt).filter(Boolean).sort().pop() || null,
    }
  })
  // 团队概览的资源列表：manageToken 是 bearer 管理凭证（可改密/关闭分享，且管理接口
  // 不校验登录身份），只下发给资源所有者本人或团队所有者 —— 普通成员拿不到他人的，
  // 避免越过上传者编辑他人资源（回归见 _verify_team_token_leak.mjs）。
  const canManageTeam = isOrganizationManager(organization, session.user.id)
  const resources = [
    ...metadata.shares.filter((item) => item.teamResource && item.teamOrganizationId === organization.id && memberIds.has(item.ownerUserId) && (canManageTeam || validateShareRecipient(item, session.user).ok)).map((item) => ({
      id: item.id,
      kind: 'share',
      name: item.files?.[0]?.name || '文件分享',
      files: item.files.map(publicFile),
      ownerUserId: item.ownerUserId,
      status: currentShareStatus(item),
      closeReason: item.closeReason || null,
      fileCount: item.files?.length || 0,
      totalSize: fileListSize(item.files),
      downloadCount: item.downloadCount || 0,
      createdAt: item.createdAt,
      expiresAt: item.expiresAt || null,
      ...(item.ownerUserId === session.user.id || canManageTeam ? {
        manageToken: item.manageToken,
        manageUrl: `${getOrigin(req)}/share/manage/${item.manageToken}`,
      } : {}),
    })),
  ].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
  res.json({
    organization: publicOrganization(organization, session.user.id),
    canManage: canManageTeam,
    plan: accountEffectivePlanForUser(organization.ownerUserId),
    capacity: accountTeamUsageForOrganization(organization),
    memberUsage,
    joinRequests: isOrganizationManager(organization, session.user.id) ? publicJoinRequestsForOrganization(organization) : [],
    resources: resources.slice(0, 200),
  })
})

app.get('/api/account/workspace/member-search', (req, res) => {
  const session = requireAuthSession(req, res)
  if (!session) return
  const organization = accountOrganizationForUser(session.user.id)
  if (!organization || !isOrganizationManager(organization, session.user.id)) {
    return res.status(403).json({ message: '只有团队所有者可以检索可邀请成员' })
  }
  const query = trimRecordString(req.query.q, 160).toLowerCase()
  if (!query) return res.json({ users: [] })
  const existingIds = new Set(organization.members.map((member) => String(member.userId || '')))
  const users = Object.values(metadata.users || {})
    .filter((user) => !existingIds.has(String(user.id)))
    .filter((user) => [user.id, user.username, user.nickname, user.email, user.phone].some((value) => String(value || '').toLowerCase().includes(query)))
    .slice(0, 8)
    .map((user) => ({
      id: user.id,
      username: user.username || '',
      nickname: user.nickname || '',
      email: user.email || '',
      phone: user.phone || '',
      displayName: displayAccountName(user),
    }))
  res.json({ users })
})

app.post('/api/account/workspace', (req, res) => {
  const session = requireAuthSession(req, res)
  if (!session) return
  if (!accountEffectivePlanForUser(session.user).team) return res.status(403).json({ message: '团队空间需要团队版或企业版权益' })
  if (accountOrganizationForUser(session.user.id)) return res.status(409).json({ message: '你已经加入一个团队空间' })
  const name = trimRecordString(req.body?.name, 80)
  if (!name) return res.status(400).json({ message: '请填写团队名称' })
  const organization = createOrganization(session.user, name)
  persistMetadata()
  res.status(201).json(accountWorkspacePayload(session.user))
})

app.patch('/api/account/workspace', (req, res) => {
  const session = requireAuthSession(req, res)
  if (!session) return
  const organization = accountOrganizationForUser(session.user.id)
  if (!organization) return res.status(404).json({ message: '尚未创建团队空间' })
  if (organization.ownerUserId !== session.user.id) return res.status(403).json({ message: '只有团队所有者可以修改团队空间' })
  const name = trimRecordString(req.body?.name, 80)
  if (!name) return res.status(400).json({ message: '请填写团队名称' })
  organization.name = name
  organization.updatedAt = new Date().toISOString()
  persistMetadata()
  res.json(accountWorkspacePayload(session.user))
})

app.post('/api/account/workspace/members', (req, res) => {
  const session = requireAuthSession(req, res)
  if (!session) return
  if (!accountEffectivePlanForUser(session.user).team) return res.status(403).json({ message: '成员管理需要团队版或企业版权益' })
  const organization = accountOrganizationForUser(session.user.id)
  if (!organization) return res.status(404).json({ message: '请先创建团队空间' })
  if (!isOrganizationManager(organization, session.user.id)) return res.status(403).json({ message: '只有团队所有者可以管理成员' })
  const rawTarget = trimRecordString(req.body?.target, 160)
  const userId = trimRecordString(req.body?.userId, 120)
  const matchedUser = userId ? accountUserById(userId) : findAccountUserByInvitationTarget(rawTarget)
  if (!rawTarget && !userId) return res.status(400).json({ message: '请输入成员邮箱、手机号或登录账号' })
  if (!matchedUser) return res.status(404).json({ message: '未找到对应的鲲穹账号，请确认邮箱、手机号或登录账号正确' })
  if (matchedUser.id === session.user.id) return res.status(409).json({ message: '不能邀请自己加入团队空间' })
  const existingOrganization = accountOrganizationForUser(matchedUser.id)
  if (existingOrganization && existingOrganization.id !== organization.id) return res.status(409).json({ message: '该账号已经加入其他团队空间' })
  if (organization.members.some((member) => member.userId === matchedUser.id || (member.email && matchedUser.email && member.email === matchedUser.email) || (member.phone && matchedUser.phone && member.phone === matchedUser.phone))) {
    return res.status(409).json({ message: '该成员已在团队空间中' })
  }
  const invitationId = createToken(16)
  const member = {
    id: createToken(12),
    userId: matchedUser.id,
    email: normalizeEmailValue(matchedUser.email),
    phone: normalizePhoneValue(matchedUser.phone),
    displayName: displayAccountName(matchedUser),
    role: 'member',
    status: 'invited',
    invitationId,
    joinedAt: null,
    invitedAt: new Date().toISOString(),
  }
  organization.members.push(member)
  addAccountMessage(matchedUser.id, {
    category: 'other',
    eventType: 'teamInvite',
    title: '新的团队空间邀请',
    body: `${displayAccountName(session.user)}邀请你加入团队“${organization.name}”，请在消息中心选择接受或拒绝。`,
    actionType: 'workspace_invite',
    actionId: invitationId,
  })
  organization.updatedAt = new Date().toISOString()
  persistMetadata()
  res.status(201).json(accountWorkspacePayload(session.user))
})

app.post('/api/account/workspace/invitations/:invitationId', (req, res) => {
  const session = requireAuthSession(req, res)
  if (!session) return
  const decision = req.body?.decision === 'accept' ? 'accept' : req.body?.decision === 'decline' ? 'decline' : ''
  if (!decision) return res.status(400).json({ message: '邀请处理方式无效' })
  const invitationId = trimRecordString(req.params.invitationId, 120)
  const organization = Object.values(metadata.organizations || {}).find((item) => item.members.some((member) => member.invitationId === invitationId && member.userId === session.user.id))
  if (!organization) return res.status(404).json({ message: '团队邀请不存在或已处理' })
  const member = organization.members.find((item) => item.invitationId === invitationId && item.userId === session.user.id)
  if (!member || member.status !== 'invited') return res.status(409).json({ message: '该团队邀请已经处理' })

  const invitationMessages = accountMessagesForUser(session.user.id).filter((item) => item.actionId === invitationId)
  if (decision === 'decline') {
    organization.members = organization.members.filter((item) => item.invitationId !== invitationId)
    invitationMessages.forEach((item) => {
      item.actionType = 'workspace_invite_resolved'
      item.body = `你已拒绝加入团队“${organization.name}”。`
      item.unread = false
      item.readAt = new Date().toISOString()
    })
    addAccountMessage(organization.ownerUserId, {
      category: 'other',
      eventType: 'teamInvite',
      title: '团队邀请已拒绝',
      body: `${displayAccountName(session.user)}拒绝了加入团队“${organization.name}”的邀请。`,
    })
  } else {
    const currentOrganization = accountOrganizationForUser(session.user.id)
    if (currentOrganization && currentOrganization.id !== organization.id) return res.status(409).json({ message: '你已经加入其他团队空间' })
    member.status = 'active'
    member.joinedAt = new Date().toISOString()
    const account = accountUserById(session.user.id) || session.user
    account.organizationId = organization.id
    account.organizationRole = 'member'
    account.updatedAt = new Date().toISOString()
    upsertAccountUser(account)
    syncAccountUserSessions(account)
    invitationMessages.forEach((item) => {
      item.actionType = 'workspace_invite_resolved'
      item.body = `你已加入团队“${organization.name}”。`
      item.unread = false
      item.readAt = new Date().toISOString()
    })
    addAccountMessage(organization.ownerUserId, {
      category: 'other',
      eventType: 'teamInvite',
      title: '成员已加入团队',
      body: `${displayAccountName(session.user)}已接受邀请并加入团队“${organization.name}”。`,
    })
  }
  organization.updatedAt = new Date().toISOString()
  persistMetadata()
  res.json({ workspace: accountWorkspacePayload(session.user), messages: accountMessagesForUser(session.user.id) })
})

app.delete('/api/account/workspace/members/:memberId', (req, res) => {
  const session = requireAuthSession(req, res)
  if (!session) return
  if (!accountEffectivePlanForUser(session.user).team) return res.status(403).json({ message: '成员管理需要团队版或企业版权益' })
  const organization = accountOrganizationForUser(session.user.id)
  if (!organization) return res.status(404).json({ message: '尚未创建团队空间' })
  if (!isOrganizationManager(organization, session.user.id)) return res.status(403).json({ message: '只有团队所有者可以管理成员' })
  const index = organization.members.findIndex((member) => member.id === req.params.memberId)
  if (index < 0) return res.status(404).json({ message: '团队成员不存在' })
  // 先校验再修改：所有者保护必须发生在 splice 之前，否则 400 返回后内存里
  // 成员已被移除，会被后续任意请求的 persistMetadata 落盘，造成团队数据损坏。
  if (organization.members[index].userId === organization.ownerUserId) return res.status(400).json({ message: '团队所有者不能移除' })
  const [removedMember] = organization.members.splice(index, 1)
  const operator = accountUserById(session.user.id) || session.user
  const operatorName = displayAccountName(operator)
  const removedUser = accountUserById(removedMember.userId)
  const notifiedInApp = Boolean(addAccountMessage(removedMember.userId, {
    category: 'other',
    eventType: 'teamRemoved',
    title: '你已被移出团队空间',
    body: `${operatorName}已将你移出团队“${organization.name}”，团队内的共享文件将不再对你展示。如需重新加入，请联系团队所有者重新邀请。`,
  }))
  if (removedUser) {
    removedUser.organizationId = ''
    removedUser.organizationRole = ''
    removedUser.updatedAt = new Date().toISOString()
    upsertAccountUser(removedUser)
    syncAccountUserSessions(removedUser)
  }
  organization.updatedAt = new Date().toISOString()
  persistMetadata()
  recordAuditLog({ type: 'team', action: '移除团队成员', userId: session.user.id, targetId: removedMember.userId, details: { organizationId: organization.id, notifiedInApp } })
  res.json({ ...accountWorkspacePayload(session.user), removedMemberId: removedMember.id, notifiedInApp })
})

// 成员主动退出团队空间。
// 与「移除成员」的区别：这条不需要团队版权益、也不需要管理员身份 ——
// 退出是自己的权利，只要你是该团队的普通成员即可执行。团队所有者不能退出（需先解散/转让）。
app.post('/api/account/workspace/leave', (req, res) => {
  const session = requireAuthSession(req, res)
  if (!session) return
  const organization = accountOrganizationForUser(session.user.id)
  if (!organization) return res.status(404).json({ message: '你当前不在任何团队空间中' })
  if (organization.ownerUserId === session.user.id) {
    return res.status(400).json({ message: '团队所有者不能退出团队空间，请先转让或解散团队' })
  }
  const index = organization.members.findIndex((member) => member.userId === session.user.id && member.status !== 'invited')
  if (index < 0) return res.status(404).json({ message: '你在该团队空间中没有有效的成员记录' })
  const [leftMember] = organization.members.splice(index, 1)
  // 清掉账号上的团队归属，个人套餐与个人空间不受影响（个人套餐从来只取决于 user.planId）。
  const account = accountUserById(session.user.id) || session.user
  account.organizationId = ''
  account.organizationRole = ''
  account.updatedAt = new Date().toISOString()
  upsertAccountUser(account)
  syncAccountUserSessions(account)
  organization.updatedAt = new Date().toISOString()
  persistMetadata()

  const leaverName = displayAccountName(account)
  const notifiedInApp = Boolean(addAccountMessage(organization.ownerUserId, {
    category: 'other',
    eventType: 'teamMemberLeft',
    title: '有成员退出了团队空间',
    body: `${leaverName}已退出团队“${organization.name}”，其团队文件访问权限已收回。`,
  }))
  recordAuditLog({
    type: 'team',
    action: '退出团队空间',
    userId: session.user.id,
    targetId: organization.id,
    details: { organizationId: organization.id, memberId: leftMember.id, notifiedInApp },
  })
  // 退出后已不再是团队上下文，工作台按"无团队"返回即可。
  res.json({ ...accountWorkspacePayload(account), leftOrganizationId: organization.id, notifiedInApp })
})

// 转让团队所有权：所有者指定一位正式成员接管团队。
// 转让后原所有者降级为普通成员，可随时退出团队空间；团队权益（容量、成员管理）跟随「当前所有者的个人套餐」，
// 因此若新所有者没有团队版/企业版权益，团队空间功能会停用（成员个人套餐与文件不受影响），通知里会明确提示。
app.post('/api/account/workspace/transfer-ownership', (req, res) => {
  const session = requireAuthSession(req, res)
  if (!session) return
  const organization = accountOrganizationForUser(session.user.id)
  if (!organization) return res.status(404).json({ message: '尚未创建团队空间' })
  if (organization.ownerUserId !== session.user.id) return res.status(403).json({ message: '只有团队所有者可以转让团队' })
  const targetMemberId = trimRecordString(req.body?.targetMemberId, 40)
  if (!targetMemberId) return res.status(400).json({ message: '请指定要接管的成员' })
  const targetMember = organization.members.find((member) => member.id === targetMemberId)
  if (!targetMember || targetMember.status !== 'active') return res.status(400).json({ message: '只能转让给已加入团队的正式成员' })
  if (targetMember.userId === session.user.id) return res.status(400).json({ message: '你已经是团队所有者' })
  const previousOwner = accountUserById(session.user.id) || session.user
  const nextOwner = accountUserById(targetMember.userId)
  if (!nextOwner) return res.status(404).json({ message: '接管成员的账号不存在' })
  const now = new Date().toISOString()
  const previousOwnerName = displayAccountName(previousOwner)
  const nextOwnerName = displayAccountName(nextOwner)

  organization.ownerUserId = nextOwner.id
  targetMember.role = 'owner'
  targetMember.displayName = nextOwnerName
  const previousOwnerMember = organization.members.find((member) => member.userId === previousOwner.id)
  if (previousOwnerMember) previousOwnerMember.role = 'member'
  previousOwner.organizationRole = 'member'
  previousOwner.updatedAt = now
  upsertAccountUser(previousOwner)
  syncAccountUserSessions(previousOwner)
  nextOwner.organizationRole = 'owner'
  nextOwner.updatedAt = now
  upsertAccountUser(nextOwner)
  syncAccountUserSessions(nextOwner)
  organization.updatedAt = now
  persistMetadata()

  const nextOwnerCanUseTeamSpace = Boolean(accountEffectivePlanForUser(nextOwner.id).team)
  addAccountMessage(nextOwner.id, {
    category: 'other',
    eventType: 'teamOwnership',
    title: '你已成为团队所有者',
    body: `${previousOwnerName}已将团队“${organization.name}”的所有权转让给你。${nextOwnerCanUseTeamSpace ? '团队空间容量与成员管理由你的套餐权益提供。' : '注意：你当前套餐不含团队版权益，团队空间功能将停用；升级套餐或再次转让后即可恢复。'}`,
  })
  recordAuditLog({
    type: 'team',
    action: '转让团队所有权',
    userId: previousOwner.id,
    targetId: nextOwner.id,
    details: { organizationId: organization.id, nextOwnerCanUseTeamSpace },
  })
  res.json({ ...accountWorkspacePayload(previousOwner), transferred: true, nextOwnerName, nextOwnerCanUseTeamSpace })
})

// 解散团队：所有者专属的最高危操作，解散后所有成员立即失去团队空间访问权。
// 成员的个人文件、个人空间与套餐不受影响（与退出/移除同一语义）；团队分享、收集与站内归属一并清除。
app.post('/api/account/workspace/dissolve', (req, res) => {
  const session = requireAuthSession(req, res)
  if (!session) return
  const organization = accountOrganizationForUser(session.user.id)
  if (!organization) return res.status(404).json({ message: '尚未创建团队空间' })
  if (organization.ownerUserId !== session.user.id) return res.status(403).json({ message: '只有团队所有者可以解散团队' })
  const now = new Date().toISOString()
  const ownerName = displayAccountName(accountUserById(session.user.id) || session.user)
  const activeMembers = organization.members.filter((member) => member.status === 'active')
  let notifiedCount = 0
  for (const member of organization.members) {
    const account = accountUserById(member.userId)
    // 归属清理只动「归属就是本团队」的账号，防止脏数据误伤其他团队
    if (account && account.organizationId === organization.id) {
      account.organizationId = ''
      account.organizationRole = ''
      account.updatedAt = now
      upsertAccountUser(account)
      syncAccountUserSessions(account)
    }
    if (member.status === 'active' && member.userId !== session.user.id) {
      if (addAccountMessage(member.userId, {
        category: 'other',
        eventType: 'teamDissolved',
        title: '所在团队空间已解散',
        body: `${ownerName}已解散团队“${organization.name}”，你已自动退出。你个人的文件、空间容量与套餐权益不受任何影响。`,
      })) notifiedCount += 1
    }
  }
  delete metadata.organizations[organization.id]
  recordAuditLog({
    type: 'team',
    action: '解散团队',
    userId: session.user.id,
    targetId: organization.id,
    details: { organizationId: organization.id, organizationName: organization.name, memberCount: activeMembers.length, notifiedCount },
  })
  persistMetadata()
  const self = accountUserById(session.user.id) || session.user
  res.json({ ...accountWorkspacePayload(self), dissolvedOrganizationId: organization.id, notifiedCount })
})

// 入团申请：公开查询入口。分享/收集链接带 ?organization=slug 时会调用它，决定是否展示「申请加入团队」。
app.get('/api/organizations/:slug/join-request', (req, res) => {
  const organization = organizationBySlug(req.params.slug)
  // 团队不存在、或团队版权益已失效时，一律按“不可申请”返回，避免把内部状态暴露给外部访客。
  if (!organization || !accountEffectivePlanForUser(organization.ownerUserId).team) {
    return res.json({ available: false, reason: 'unavailable' })
  }
  const session = authSessionFromRequest(req)
  const viewer = session?.user || null
  const payload = { available: false, organizationName: organization.name }
  if (!viewer) return res.json({ ...payload, reason: 'anonymous' })
  if (viewer.id === organization.ownerUserId) return res.json({ ...payload, reason: 'owner' })
  const currentOrganization = accountOrganizationForUser(viewer.id)
  const existing = organization.members.find((member) => member.userId === viewer.id)
  if (existing?.status === 'active') return res.json({ ...payload, reason: 'member' })
  if (currentOrganization && currentOrganization.id !== organization.id) return res.json({ ...payload, reason: 'other_team' })
  if (existing?.status === 'requested') {
    return res.json({ ...payload, available: false, reason: 'pending', requestedAt: existing.requestedAt || null })
  }
  // 冷却判定必须先于 invited：被拒绝的申请会留下 status='invited' 占位记录用于保存冷却锚点，
  // 若先判 invited 会把「刚被拒绝」误报成「收到邀请」，冷却逻辑永远不可达。
  const cooldownMs = joinRequestCooldownRemaining(organization, viewer.id)
  if (cooldownMs > 0) {
    return res.json({ ...payload, reason: 'cooldown', cooldownUntil: new Date(Date.now() + cooldownMs).toISOString() })
  }
  if (existing?.status === 'invited') return res.json({ ...payload, reason: 'invited' })
  res.json({ ...payload, available: true, reason: 'eligible' })
})

app.post('/api/organizations/:slug/join-request', (req, res) => {
  const session = requireAuthSession(req, res)
  if (!session) return
  const organization = organizationBySlug(req.params.slug)
  if (!organization) return res.status(404).json({ message: '团队空间不存在' })
  if (!accountEffectivePlanForUser(organization.ownerUserId).team) {
    return res.status(403).json({ message: '该团队当前未开通团队版权益，暂不接收加入申请' })
  }
  const viewer = session.user
  if (viewer.id === organization.ownerUserId) return res.status(409).json({ message: '你是该团队的所有者，无需申请加入' })
  const currentOrganization = accountOrganizationForUser(viewer.id)
  if (currentOrganization) {
    return res.status(409).json({
      message: currentOrganization.id === organization.id ? '你已经是该团队成员' : `你已加入团队“${currentOrganization.name}”，请先退出后再申请`,
    })
  }
  const existing = organization.members.find((member) => member.userId === viewer.id)
  if (existing?.status === 'active') return res.status(409).json({ message: '你已经是该团队成员' })
  if (existing?.status === 'requested') return res.status(409).json({ message: '你的加入申请已提交，请等待团队所有者处理' })

  // 冷却校验同样要先于 invited 分支，理由与 GET 探测一致。
  const cooldownMs = joinRequestCooldownRemaining(organization, viewer.id)
  if (cooldownMs > 0) {
    const hours = Math.max(1, Math.ceil(cooldownMs / (60 * 60 * 1000)))
    return res.status(429).json({ message: `你的上一次申请已被拒绝，请 ${hours} 小时后再试` })
  }
  if (existing?.status === 'invited') return res.status(409).json({ message: '你已收到该团队的邀请，请先在消息中心处理邀请' })

  // 限流键用真实 socket 地址：trust proxy=true 下 XFF 可伪造，等于没有限流。
  const ip = String(req.socket?.remoteAddress || '').trim() || 'unknown'
  if (isJoinRequestRateLimited(ip, viewer.id)) {
    return res.status(429).json({ message: '申请提交过于频繁，请稍后再试' })
  }

  const joinMessage = trimRecordString(req.body?.message, 120)
  const now = new Date().toISOString()
  const requestId = createToken(16)
  const account = accountUserById(viewer.id) || viewer
  // 复用 member 记录：与「邀请」共用同一套成员表，查重、成员上限、审批流转逻辑无需重写。
  if (existing) {
    Object.assign(existing, {
      displayName: displayAccountName(account),
      email: normalizeEmailValue(account.email),
      phone: normalizePhoneValue(account.phone),
      status: 'requested',
      role: 'member',
      joinSource: 'request',
      joinRequestId: requestId,
      joinMessage,
      requestedAt: now,
      reviewedAt: null,
      invitedAt: null,
      invitationId: '',
    })
  } else {
    organization.members.push({
      id: createToken(12),
      userId: viewer.id,
      email: normalizeEmailValue(account.email),
      phone: normalizePhoneValue(account.phone),
      displayName: displayAccountName(account),
      role: 'member',
      status: 'requested',
      joinSource: 'request',
      joinRequestId: requestId,
      joinMessage,
      requestedAt: now,
      reviewedAt: null,
      joinedAt: null,
      invitedAt: null,
      invitationId: '',
    })
  }
  organization.updatedAt = now
  recordJoinRequestAttempt(ip, viewer.id)
  persistMetadata()
  addAccountMessage(organization.ownerUserId, {
    category: 'other',
    eventType: 'teamJoinRequest',
    title: '新的入团申请',
    body: `${displayAccountName(account)}申请加入团队“${organization.name}”，请前往团队空间选择同意或拒绝。`,
    actionType: 'workspace_join_request',
    actionId: requestId,
  })
  recordAuditLog({ type: 'team', action: '提交入团申请', userId: viewer.id, targetId: organization.id, details: { organizationId: organization.id, slug: organization.slug, ip } })
  res.status(201).json({ requested: true, requestId, organizationName: organization.name, requestedAt: now })
})

// 入团申请：所有者审批。同意后申请人直接成为正式成员，拒绝后进入 24 小时冷却。
app.post('/api/account/workspace/join-requests/:requestId', (req, res) => {
  const session = requireAuthSession(req, res)
  if (!session) return
  const decision = req.body?.decision === 'approve' ? 'approve' : req.body?.decision === 'reject' ? 'reject' : ''
  if (!decision) return res.status(400).json({ message: '审批方式无效' })
  const organization = accountOrganizationForUser(session.user.id)
  if (!organization) return res.status(404).json({ message: '尚未创建团队空间' })
  if (!isOrganizationManager(organization, session.user.id)) return res.status(403).json({ message: '只有团队所有者可以审批入团申请' })
  if (!accountEffectivePlanForUser(organization.ownerUserId).team) {
    return res.status(403).json({ message: '团队版权益已失效，请续费后再处理成员申请' })
  }
  const requestId = trimRecordString(req.params.requestId, 120)
  const member = organization.members.find((item) => item.status === 'requested' && (item.joinRequestId === requestId || item.id === requestId))
  if (!member) return res.status(404).json({ message: '该入团申请不存在或已处理' })

  const applicantUser = accountUserById(member.userId)
  const applicantName = member.displayName || (applicantUser && displayAccountName(applicantUser)) || '该账号'
  const now = new Date().toISOString()
  const resolvedMessages = accountMessagesForUser(organization.ownerUserId).filter((item) => item.actionId === member.joinRequestId || item.actionId === member.id)
  resolvedMessages.forEach((item) => {
    item.actionType = 'workspace_join_request_resolved'
    item.unread = false
    item.readAt = now
  })

  if (decision === 'reject') {
    // 拒绝时保留一条 status='invited' 的空位记录用于记录冷却时间；申请人再次申请会被覆盖。
    member.status = 'invited'
    member.role = 'member'
    member.reviewedAt = now
    member.invitedAt = null
    member.invitationId = ''
    member.requestedAt = member.requestedAt || now
    organization.updatedAt = now
    persistMetadata()
    const notifiedInApp = Boolean(addAccountMessage(member.userId, {
      category: 'other',
      eventType: 'teamJoinRejected',
      title: '入团申请未通过',
      body: `你申请加入团队“${organization.name}”的请求已被拒绝。24 小时后可再次申请。`,
    }))
    recordAuditLog({ type: 'team', action: '拒绝入团申请', userId: session.user.id, targetId: member.userId, details: { organizationId: organization.id, notifiedInApp } })
    return res.json({ ...accountWorkspacePayload(session.user), joinRequests: publicJoinRequestsForOrganization(organization), decided: 'reject', applicantName, notifiedInApp })
  }

  const currentOrganization = accountOrganizationForUser(member.userId)
  if (currentOrganization && currentOrganization.id !== organization.id) {
    return res.status(409).json({ message: `${applicantName}已加入其他团队空间，无法同意该申请` })
  }
  const matched = applicantUser ? accountUserById(applicantUser.id) : null
  if (matched) {
    matched.organizationId = organization.id
    matched.organizationRole = 'member'
    matched.updatedAt = now
    upsertAccountUser(matched)
    syncAccountUserSessions(matched)
    member.displayName = displayAccountName(matched)
    member.email = normalizeEmailValue(matched.email)
    member.phone = normalizePhoneValue(matched.phone)
  }
  member.status = 'active'
  member.role = 'member'
  member.reviewedAt = now
  member.joinedAt = now
  organization.updatedAt = now
  persistMetadata()
  const notifiedInApp = Boolean(addAccountMessage(member.userId, {
    category: 'other',
    eventType: 'teamJoinApproved',
    title: '入团申请已通过',
    body: `你已加入团队“${organization.name}”，现在可以访问团队空间内的共享文件和专属链接。`,
    actionType: 'workspace_joined',
    actionUrl: '/team',
  }))
  recordAuditLog({ type: 'team', action: '同意入团申请', userId: session.user.id, targetId: member.userId, details: { organizationId: organization.id, notifiedInApp } })
  res.json({ ...accountWorkspacePayload(session.user), joinRequests: publicJoinRequestsForOrganization(organization), decided: 'approve', applicantName, notifiedInApp })
})

app.get('/api/account/upgrade-orders', async (req, res) => {
  const session = requireAuthSession(req, res)
  if (!session) return
  await reconcileUserUpgradeOrders(session)
  res.json({ orders: upgradeOrdersForUser(session.user.id).slice(0, 20).map(upgradeOrderSummary) })
})

// 升级弹窗展示价：与订单创建同源（远端主站套餐实价），避免「展示 ¥0.01、下单 ¥19」的口径分裂
app.get('/api/account/upgrade-pricing', async (req, res) => {
  const session = requireAuthSession(req, res)
  if (!session) return
  const pricing = await remoteUpgradePricing(session)
  res.json({ source: Object.keys(pricing).length ? 'remote' : 'local', pricing })
})

app.post('/api/account/upgrade-orders', async (req, res) => {
  let release
  try {
    const session = requireAuthSession(req, res)
    if (!session) return
    release = await acquireUpgradeLock(`create:${session.user.id}`)
    await reconcileUserUpgradeOrders(session, true)
    const stored = accountUserById(session.user.id) || session.user
    const effective = accountEffectivePlanForUser(stored)
    const planId = normalizePlanId(req.body?.planId)
    if (planId === 'free') return res.status(400).json({ message: '基础版为默认权益，无需订购' })
    if (planId === effective.id && effective.permanent) return res.status(409).json({ message: `当前${effective.label}永久有效，无需续费` })
    if (accountPlanRank(planId) < accountPlanRank(effective.id)) {
      return res.status(409).json({ message: `当前已享有${effective.label}权益，无需订购低等级套餐` })
    }

    const staleBefore = Date.now() - 30 * 60 * 1000
    let expiredChanged = false
    for (const item of upgradeOrdersForUser(stored.id)) {
      if (item.status === 'pending_payment' && new Date(item.createdAt).getTime() < staleBefore) {
        item.status = 'expired'
        item.paymentQueryCredential = null
        item.paymentRequiresLogin = false
        item.updatedAt = new Date().toISOString()
        expiredChanged = true
      }
    }
    if (expiredChanged) persistMetadata()
    const existing = upgradeOrdersForUser(stored.id).find((order) => order.status === 'pending_payment')
    if (existing) {
      return res.status(409).json({ message: '已有一个待支付的升级订单', order: upgradeOrderSummary(existing) })
    }

    const { package: memberPackage } = await resolveWebMemberPackage(session, planId)
    const now = new Date().toISOString()
    const remotePrice = Number(memberPackage.price_yuan)
    const order = {
      id: createToken(12),
      orderNo: `WM1${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}${createToken(8).toUpperCase()}`,
      userId: stored.id,
      planId,
      status: 'pending_payment',
      amount: Number.isFinite(remotePrice) && remotePrice >= 0
        ? Math.round(remotePrice * 100)
        : configuredAccountPlan(planId)?.monthlyPrice ?? null,
      payType: 1,
      remoteOrderNo: '',
      remotePackageId: Number(memberPackage.id) || null,
      remotePackageName: trimRecordString(memberPackage.name, 80),
      remotePackageDays: normalizeNullablePositiveInteger(memberPackage.days),
      payment: null,
      createdAt: now,
      updatedAt: now,
      paidAt: null,
    }
    metadata.upgradeOrders.unshift(order)
    // Loaded orders are already normalized. Preserve objects held by in-flight queries.
    metadata.upgradeOrders = metadata.upgradeOrders.slice(0, MAX_UPGRADE_ORDERS)
    persistMetadata()
    res.status(201).json({ order: upgradeOrderSummary(order), orders: upgradeOrdersForUser(stored.id).slice(0, 20).map(upgradeOrderSummary) })
  } catch (error) {
    res.status(error.status || 502).json({ message: error.message || '升级套餐读取失败' })
  } finally {
    release?.()
  }
})

app.post('/api/account/upgrade-orders/:orderId/cancel', (req, res) => {
  const session = requireAuthSession(req, res)
  if (!session) return
  const order = findUpgradeOrder(req.params.orderId, session.user.id)
  if (!order) return res.status(404).json({ message: '升级订单不存在' })
  if (order.status !== 'pending_payment') return res.status(409).json({ message: '当前订单状态不可取消' })
  order.status = 'canceled'
  order.updatedAt = new Date().toISOString()
  persistMetadata()
  res.json({ order: upgradeOrderSummary(order), orders: upgradeOrdersForUser(session.user.id).slice(0, 20).map(upgradeOrderSummary) })
})

app.post('/api/account/upgrade-orders/:orderId/confirm', async (req, res) => {
  let release
  try {
    const session = requireAuthSession(req, res)
    if (!session) return
    const order = findUpgradeOrder(req.params.orderId, session.user.id)
    if (!order) return res.status(404).json({ message: '升级订单不存在' })
    release = await acquireUpgradeLock(order.id)
    if (order.status !== 'pending_payment') return res.status(409).json({ message: '当前订单不支持支付确认' })
    const payType = normalizeWebMemberPayType(req.body?.payType || order.payType || 1)
    const payment = order.remoteOrderNo
      ? { order_no: order.remoteOrderNo, pay_type: order.payType || payType, ...(order.payment || {}) }
      : await createWebMemberPaymentOrder(session, order, payType)
    retainPaymentQueryCredential(session, order)
    persistMetadata()
    await ensurePaymentAssets(payment)
    order.payment = normalizePaymentPayload(payment)
    order.payType = normalizeWebMemberPayType(payment.pay_type || order.payType || payType)
    persistMetadata()
    res.json({
      message: payment.pay_type === 2 ? '支付宝收银台已创建，请在当前弹窗完成支付' : '微信支付二维码已创建，请扫码支付',
      order: upgradeOrderSummary(order),
      payment: publicPaymentPayload(payment),
    })
  } catch (error) {
    res.status(error.status || 502).json({ message: error.message || '支付订单创建失败' })
  } finally {
    release?.()
  }
})

app.post('/api/account/upgrade-orders/:orderId/pay-status', async (req, res) => {
  try {
    const session = requireAuthSession(req, res)
    if (!session) return
    const order = findUpgradeOrder(req.params.orderId, session.user.id)
    if (!order) return res.status(404).json({ message: '升级订单不存在' })
    if (!order.remoteOrderNo) return res.status(409).json({ message: '请先创建支付二维码或支付宝订单' })
    if (order.status === 'paid') {
      return res.json({ message: '支付成功', order: upgradeOrderSummary(order), workspace: accountWorkspacePayload(session.user) })
    }
    const result = await reconcileUpgradeOrder(session, order)
    if (order.status === 'paid') {
      return res.json({ message: '支付成功，会员权益已开通', order: upgradeOrderSummary(order), workspace: accountWorkspacePayload(session.user) })
    }
    order.updatedAt = new Date().toISOString()
    persistMetadata()
    res.json({ message: result.msg || '还未支付', order: upgradeOrderSummary(order), paid: false })
  } catch (error) {
    res.status(error.status || 502).json({ message: error.message || '支付状态查询失败' })
  }
})

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
const shareLookupAttempts = new Map()

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
    await metadataWriteQueue
    if (databasePool) await databasePool.end()
    server.close(() => process.exit(0))
  } catch (error) {
    console.error(`服务关闭时保存数据失败（${signal}）：${error.message || error}`)
    process.exit(1)
  }
}
process.once('SIGINT', () => { shutdown('SIGINT').catch(() => process.exit(1)) })
process.once('SIGTERM', () => { shutdown('SIGTERM').catch(() => process.exit(1)) })

function emptyMetadata() {
  return {
    shares: [],
    collections: [],
    sessions: [],
    records: {},
    users: {},
    messages: {},
    notificationSettings: {},
    verificationCodes: [],
    auditLogs: [],
    organizations: [],
    upgradeOrders: [],
    systemConfig: DEFAULT_SYSTEM_CONFIG,
  }
}

function readMetadataFileFrom(targetPath) {
  const raw = fs.readFileSync(targetPath, 'utf8')
  if (!raw.trim()) throw new Error('元数据文件为空')
  return JSON.parse(raw)
}

function loadLocalMetadata() {
  // 原子写已保证正常路径下不会读到半截文件；这里额外做一次损坏回退：
  // 万一主机异常（断电等）留下坏文件，可用上次覆盖前的备份还原，避免静默清空全部数据。
  try {
    return readMetadataFileFrom(metadataPath)
  } catch (error) {
    try {
      const recovered = readMetadataFileFrom(`${metadataPath}.bak`)
      console.warn(`元数据文件损坏（${error.message || error}），已从备份还原`)
      return recovered
    } catch {
      return emptyMetadata()
    }
  }
}

function readLocalMetadataRevision() {
  try {
    const value = Math.floor(Number(fs.readFileSync(metadataRevisionPath, 'utf8').trim()))
    return Number.isFinite(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

async function loadMetadata() {
  const localMetadata = loadLocalMetadata()
  metadataLocalRevision = readLocalMetadataRevision()
  if (!databasePool) return localMetadata
  if (!databaseHost || !databaseName || !databaseUser) {
    throw new Error('数据库模式已开启，但数据库连接参数不完整')
  }
  await ensureDatabaseStateTable()
  const remote = await readRemoteMetadataRow()
  if (remote) {
    metadataRevision = remote.revision
    return remote.metadata
  }
  const normalized = normalizeMetadata(localMetadata)
  const [result] = await databasePool.execute(
    `INSERT INTO kunqiong_app_state (state_key, schema_version, revision, payload)
     VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE state_key = state_key`,
    ['metadata', 1, 1, JSON.stringify(normalized)],
  )
  // affectedRows 为 1 表示本实例建了行；为 0 表示另一个实例抢先建了行，按正常路径重读。
  if (Number(result.affectedRows) === 1) {
    metadataRevision = 1
    console.log('已将本地 metadata.json 迁移到 MySQL')
    return normalized
  }
  const winner = await readRemoteMetadataRow()
  if (!winner) throw new Error('元数据状态行创建失败，已停止启动以避免覆盖数据')
  metadataRevision = winner.revision
  return winner.metadata
}

async function readRemoteMetadataRow() {
  const [rows] = await databasePool.query('SELECT revision, payload FROM kunqiong_app_state WHERE state_key = ? LIMIT 1', ['metadata'])
  if (!rows.length) return null
  try {
    return { revision: Number(rows[0].revision) || 0, metadata: JSON.parse(rows[0].payload) }
  } catch {
    throw new Error('数据库中的鲲穹元数据不是有效 JSON，已停止启动以避免覆盖数据')
  }
}

async function ensureDatabaseStateTable() {
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS kunqiong_app_state (
      state_key VARCHAR(64) NOT NULL PRIMARY KEY,
      schema_version INT NOT NULL DEFAULT 1,
      revision BIGINT NOT NULL DEFAULT 0,
      payload LONGTEXT NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
  // 老部署的库是上一版建表语句建的，没有 revision 列，这里补列并保留已有数据。
  const [columns] = await databasePool.query(
    `SELECT COUNT(*) AS total FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kunqiong_app_state' AND COLUMN_NAME = 'revision'`,
  )
  if (!Number(columns?.[0]?.total)) {
    await databasePool.query('ALTER TABLE kunqiong_app_state ADD COLUMN revision BIGINT NOT NULL DEFAULT 0')
    console.log('kunqiong_app_state 已补充 revision 列')
  }
}

// ── 快照合并（多实例并发写）────────────────────────────────────────────
// 全量 JSON 快照做不了字段级事务，合并策略如下：
//   1. 按 id / 键求并集：并发时绝不因为覆盖而丢掉任一方新增的记录（这正是原本的静默丢数据故障）；
//   2. 同一条记录两边都有时，按 updatedAt / createdAt 取较新的一份；
//   3. 仅当远端版本恰好领先本进程基线 1 个版本时，两端基线相同，才能可靠识别「删除」并让其生效
//      （例如登出后会话不再被别的实例用旧快照复活）。版本差距更大时基线不可比，
//      退回纯并集语义——宁可短暂复活一条记录，也不丢新数据。
// 注意：这不是水平扩容的替代方案。多实例部署仍应尽快拆表或改为单写者。
function metadataIdSets(value = {}) {
  const sets = {}
  for (const rule of METADATA_MERGE_RULES) {
    const collection = value?.[rule.key]
    if (rule.kind === 'array') {
      sets[rule.key] = new Set((Array.isArray(collection) ? collection : []).map((item) => (item?.id ? String(item.id) : '')).filter(Boolean))
    } else {
      sets[rule.key] = new Set(collection && typeof collection === 'object' && !Array.isArray(collection) ? Object.keys(collection) : [])
    }
  }
  return sets
}

function metadataRecordTime(record, timeKeys = []) {
  if (!record || typeof record !== 'object') return 0
  for (const key of timeKeys) {
    const value = new Date(record[key]).getTime()
    if (Number.isFinite(value)) return value
  }
  return 0
}

function mergeMetadataRecord(remote, local, timeKeys) {
  // 时间戳相等时取本地：本地代表本进程最近一次意图。
  return metadataRecordTime(local, timeKeys) >= metadataRecordTime(remote, timeKeys) ? local : remote
}

function isIdentifiedList(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => item && typeof item === 'object' && item.id)
}

function mergeMetadataLists(remoteList, localList, timeKeys, baseKeys) {
  const remotes = new Map()
  for (const item of Array.isArray(remoteList) ? remoteList : []) if (item?.id) remotes.set(String(item.id), item)
  const locals = new Map()
  for (const item of Array.isArray(localList) ? localList : []) if (item?.id) locals.set(String(item.id), item)
  const merged = new Map()
  for (const [id, item] of remotes) {
    if (locals.has(id)) {
      merged.set(id, mergeMetadataRecord(item, locals.get(id), timeKeys))
      continue
    }
    // 远端独有：基线里没有 = 对方新增，保留；基线里有 = 本进程已删除，删除生效。
    if (!baseKeys || !baseKeys.has(id)) merged.set(id, item)
  }
  for (const [id, item] of locals) {
    if (remotes.has(id)) continue
    // 本地独有：基线里没有 = 本进程新增，保留；基线里有 = 对方已删除，删除生效。
    if (!baseKeys || !baseKeys.has(id)) merged.set(id, item)
  }
  return [...merged.values()]
}

function mergeMetadataMaps(remoteMap, localMap, timeKeys, baseKeys) {
  const remotes = remoteMap && typeof remoteMap === 'object' && !Array.isArray(remoteMap) ? remoteMap : {}
  const locals = localMap && typeof localMap === 'object' && !Array.isArray(localMap) ? localMap : {}
  const merged = {}
  for (const [key, value] of Object.entries(remotes)) {
    if (Object.prototype.hasOwnProperty.call(locals, key)) {
      merged[key] = mergeMetadataEntry(value, locals[key], timeKeys)
      continue
    }
    if (!baseKeys || !baseKeys.has(key)) merged[key] = value
  }
  for (const [key, value] of Object.entries(locals)) {
    if (Object.prototype.hasOwnProperty.call(remotes, key)) continue
    if (!baseKeys || !baseKeys.has(key)) merged[key] = value
  }
  return merged
}

function mergeMetadataEntry(remoteValue, localValue, timeKeys) {
  // 每用户的消息/文件记录是「键 → 带 id 的列表」，需要下探一层按 id 合并，否则会整段丢掉一边。
  // 这一层不做删除识别：基线只记录顶层键，下探时按并集处理。
  if (isIdentifiedList(remoteValue) && isIdentifiedList(localValue)) {
    return mergeMetadataLists(remoteValue, localValue, timeKeys, null)
  }
  return mergeMetadataRecord(remoteValue, localValue, timeKeys)
}

function mergeMetadataSnapshots(remoteValue, localValue, baseIds) {
  const remote = remoteValue && typeof remoteValue === 'object' && !Array.isArray(remoteValue) ? remoteValue : {}
  const local = localValue && typeof localValue === 'object' && !Array.isArray(localValue) ? localValue : {}
  // 标量配置与未知字段无法判断新旧，默认取本地（本进程最近一次改动的意图）。
  const merged = { ...remote, ...local }
  for (const rule of METADATA_MERGE_RULES) {
    const baseKeys = baseIds ? baseIds[rule.key] : null
    merged[rule.key] = rule.kind === 'array'
      ? mergeMetadataLists(remote[rule.key], local[rule.key], rule.time, baseKeys)
      : mergeMetadataMaps(remote[rule.key], local[rule.key], rule.time, baseKeys)
  }
  return normalizeMetadata(merged)
}

function applyMergedMetadata(next) {
  // 就地更新：路由与定时器持有的是同一个 metadata 引用，替换对象会让它们写到废弃的快照上。
  for (const key of Object.keys(metadata)) if (!(key in next)) delete metadata[key]
  Object.assign(metadata, next)
}

function rememberMetadataBaseIds() {
  const sets = metadataIdSets(metadata)
  metadataBaseIds = sets
  metadataLocalBaseIds = sets
}

function normalizeMetadata(value = {}) {
  const shares = Array.isArray(value.shares) ? value.shares : []
  for (const share of shares) {
    if (!share.manageToken) {
      share.manageToken = createToken(18)
      metadataNeedsPersist = true
    }
    if (share.status === 'expired') {
      share.status = 'closed'
      share.closeReason = share.closeReason || 'expired'
      metadataNeedsPersist = true
    }
  }
  const collections = Array.isArray(value.collections) ? value.collections : []
  for (const task of collections) {
    if (!task.manageToken) {
      task.manageToken = createToken(18)
      metadataNeedsPersist = true
    }
    if (!Array.isArray(task.submissions)) {
      task.submissions = []
      metadataNeedsPersist = true
    }
  }
  const sessions = Array.isArray(value.sessions)
    ? value.sessions
      .filter((session) => session?.id && session?.user)
      .map((session) => {
        if (Object.prototype.hasOwnProperty.call(session, 'accessToken') || Object.prototype.hasOwnProperty.call(session, 'tokenType')) {
          metadataNeedsPersist = true
        }
        const { accessToken: _accessToken, tokenType: _tokenType, ...sanitized } = session
        return sanitized
      })
    : []
  const users = normalizeAccountUserStore(value.users, sessions)
  return {
    ...value,
    shares,
    collections,
    sessions,
    records: normalizeAccountRecordStore(value.records),
    users,
    messages: normalizeAccountMessageStore(value.messages),
    notificationSettings: normalizeNotificationSettingsStore(value.notificationSettings),
    verificationCodes: normalizeVerificationCodes(value.verificationCodes),
    auditLogs: normalizeAuditLogs(value.auditLogs),
    organizations: normalizeOrganizations(value.organizations),
    upgradeOrders: normalizeUpgradeOrders(value.upgradeOrders),
    guestUsage: normalizeGuestUsageStore(value.guestUsage),
    systemConfig: normalizeSystemConfig(value.systemConfig),
  }
}

function normalizeUpgradeOrders(value = []) {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const paymentQueryCredential = normalizePaymentQueryCredential(item)
    if (item?.paymentQueryCredential && (!paymentQueryCredential
      || item.paymentQueryCredential.apiWebToken !== paymentQueryCredential.apiWebToken
      || item.paymentQueryCredential.expiresAt !== paymentQueryCredential.expiresAt)) metadataNeedsPersist = true
    return {
      id: trimRecordString(item?.id, 80) || createToken(10),
      orderNo: trimRecordString(item?.orderNo, 40) || `UPG-${createToken(8).toUpperCase()}`,
      userId: trimRecordString(item?.userId, 120),
      planId: normalizePlanId(item?.planId),
      status: UPGRADE_ORDER_STATUSES.has(item?.status) ? item.status : 'expired',
      amount: Number(item?.amount) > 0 ? Number(item.amount) : null,
      payType: normalizeWebMemberPayType(item?.payType || item?.payment?.pay_type || 1),
      remoteOrderNo: trimRecordString(item?.remoteOrderNo || item?.remoteOrderNumber, 80),
      remotePackageId: normalizeNullablePositiveInteger(item?.remotePackageId),
      remotePackageName: trimRecordString(item?.remotePackageName, 80),
      remotePackageDays: normalizeNullablePositiveInteger(item?.remotePackageDays),
      payment: normalizePaymentPayload(item?.payment),
      createdAt: normalizeRecordDate(item?.createdAt) || new Date().toISOString(),
      updatedAt: normalizeRecordDate(item?.updatedAt) || new Date().toISOString(),
      paidAt: normalizeRecordDate(item?.paidAt) || null,
      remoteExpireAt: normalizeRecordDate(item?.remoteExpireAt) || null,
      paymentQueryCredential,
      paymentRequiresLogin: Boolean(item?.paymentRequiresLogin),
    }
  }).filter((item) => item.userId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, MAX_UPGRADE_ORDERS)
}

function normalizePaymentQueryCredential(order) {
  const credential = order?.paymentQueryCredential
  const apiWebToken = trimRecordString(credential?.apiWebToken, 300)
  const deadline = new Date(order?.createdAt).getTime() + PAYMENT_QUERY_RETENTION_MS
  const expiresAt = Math.min(new Date(credential?.expiresAt).getTime(), deadline)
  if (!apiWebToken || order.status === 'paid' || order.paymentRequiresLogin || !order.remoteOrderNo || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null
  return { apiWebToken, expiresAt: new Date(expiresAt).toISOString() }
}

function upgradeOrderSummary(order = {}) {
  const plan = configuredAccountPlan(order.planId)
  return {
    id: order.id,
    orderNo: order.orderNo,
    planId: order.planId,
    planLabel: plan.label,
    status: order.status,
    amount: order.amount,
    payType: order.payType || 1,
    remoteOrderNo: order.remoteOrderNo || '',
    remotePackageId: order.remotePackageId || null,
    remotePackageName: order.remotePackageName || '',
    remotePackageDays: order.remotePackageDays || null,
    payment: publicPaymentPayload(order.payment),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    paidAt: order.paidAt,
    remoteExpireAt: order.remoteExpireAt || null,
  }
}

function upgradeOrdersForUser(userId) {
  const key = String(userId || '')
  return (metadata.upgradeOrders || []).filter((order) => order.userId === key)
}

function findUpgradeOrder(orderId, userId) {
  return (metadata.upgradeOrders || []).find((order) => order.id === orderId && order.userId === userId) || null
}

function persistMetadata() {
  persistLocalMetadata()
  if (!databasePool) return
  metadataWriteQueue = metadataWriteQueue
    .catch(() => {})
    .then(() => writeMetadataToDatabase())
    .catch((error) => {
      console.error(`MySQL 元数据保存失败：${error.message || error}`)
    })
}

function withLocalMetadataLock(task) {
  // 本地模式没有数据库那样的原子 CAS，用「独占创建锁文件」把多进程写入串行化。
  // 拿不到锁（异常退出残留锁文件等）时直接执行：退化成「读最新内容再合并写」，
  // 最坏情况仍是合并而非覆盖，不会把服务卡死。
  const lockPath = `${metadataPath}.lock`
  const deadline = Date.now() + 2000
  let handle = null
  while (Date.now() < deadline) {
    try {
      handle = fs.openSync(lockPath, 'wx')
      break
    } catch {
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > 10000) fs.rmSync(lockPath, { force: true })
      } catch {}
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5)
    }
  }
  try {
    task()
  } finally {
    if (handle !== null) {
      try { fs.closeSync(handle) } catch {}
      try { fs.rmSync(lockPath, { force: true }) } catch {}
    }
  }
}

function persistLocalMetadata() {
  // 临时文件名带上实例标识：多进程共用一份 storage 时，固定名字的 .tmp 会被
  // 另一个进程 rename 走，导致本进程 rename 报 ENOENT 并静默丢掉这次写入。
  const tempPath = `${metadataPath}.${instanceTag}.tmp`
  try {
    if (databasePool) {
      // 数据库模式：metadata.json 只是镜像，直接整体重写即可。
      if (fs.existsSync(metadataPath)) {
        const backupTempPath = `${metadataPath}.${instanceTag}.bak.tmp`
        fs.copyFileSync(metadataPath, backupTempPath)
        fs.renameSync(backupTempPath, `${metadataPath}.bak`)
      }
      fs.writeFileSync(tempPath, JSON.stringify(metadata, null, 2), 'utf8')
      fs.renameSync(tempPath, metadataPath)
      return
    }
    withLocalMetadataLock(() => {
      // 本地模式：文件是唯一真源。磁盘版本领先说明另一个进程（同机多实例、
      // 开发与生产共用 storage）改过，先合并再写，不要拿本进程的旧快照直接覆盖。
      const diskRevision = readLocalMetadataRevision()
      if (diskRevision > metadataLocalRevision) {
        applyMergedMetadata(mergeMetadataSnapshots(loadLocalMetadata(), metadata, diskRevision === metadataLocalRevision + 1 ? metadataLocalBaseIds : null))
        metadataLocalRevision = diskRevision
        metadataConflictCount += 1
        console.warn(`[metadata-cas] 实例 ${instanceTag} 检测到本地快照被其他进程更新，已合并后重写`)
      }
      // 原子落盘：先写临时文件再 rename。直接 writeFileSync 会先截断目标文件，
      // 并发读（含服务重启、其他进程）可能读到「已截断但未写完」的半截 JSON。
      // 覆盖前留一份 .bak，走同样的 tmp + rename，保证备份本身也是完整快照。
      if (fs.existsSync(metadataPath)) {
        const backupTempPath = `${metadataPath}.${instanceTag}.bak.tmp`
        fs.copyFileSync(metadataPath, backupTempPath)
        fs.renameSync(backupTempPath, `${metadataPath}.bak`)
      }
      fs.writeFileSync(tempPath, JSON.stringify(metadata, null, 2), 'utf8')
      fs.renameSync(tempPath, metadataPath)
      const revisionTempPath = `${metadataRevisionPath}.${instanceTag}.tmp`
      fs.writeFileSync(revisionTempPath, String(metadataLocalRevision + 1), 'utf8')
      fs.renameSync(revisionTempPath, metadataRevisionPath)
      metadataLocalRevision += 1
      metadataLocalBaseIds = metadataIdSets(metadata)
    })
  } catch (error) {
    console.error(`本地元数据保存失败：${error.message || error}`)
    try {
      if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true })
    } catch {}
  }
}

async function writeMetadataToDatabase() {
  for (let attempt = 0; attempt < MAX_METADATA_WRITE_ATTEMPTS; attempt++) {
    const expected = metadataRevision
    const [result] = await databasePool.execute(
      'UPDATE kunqiong_app_state SET revision = revision + 1, payload = ? WHERE state_key = ? AND revision = ?',
      [JSON.stringify(metadata), 'metadata', expected],
    )
    if (Number(result.affectedRows) > 0) {
      metadataRevision = expected + 1
      metadataBaseIds = metadataIdSets(metadata)
      return
    }
    const remote = await readRemoteMetadataRow()
    if (!remote) {
      // 状态行被清掉了（手工删库/换库）：按迁移路径重新建行，不动远端数据。
      await databasePool.execute(
        `INSERT INTO kunqiong_app_state (state_key, schema_version, revision, payload)
         VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE state_key = state_key`,
        ['metadata', 1, expected + 1, JSON.stringify(metadata)],
      )
      metadataRevision = expected + 1
      metadataBaseIds = metadataIdSets(metadata)
      return
    }
    if (remote.revision === expected) continue
    // CAS 失败：另一个实例先写了。重读远端，合并本进程的改动后重试。
    // 远端恰好领先 1 个版本时两端基线相同，可以可靠识别删除；否则退回并集语义。
    const exactBase = remote.revision === expected + 1
    applyMergedMetadata(mergeMetadataSnapshots(remote.metadata, metadata, exactBase ? metadataBaseIds : null))
    metadataRevision = remote.revision
    metadataConflictCount += 1
    console.warn(`[metadata-cas] 实例 ${instanceTag} 写入冲突，已合并重试（本地 rev ${expected}，远端 rev ${remote.revision}${exactBase ? '，删除可识别' : '，基线不可比按并集处理'}）`)
  }
  throw new Error(`元数据写入连续 ${MAX_METADATA_WRITE_ATTEMPTS} 次与其他实例冲突`)
}

function normalizeMemberStatus(value) {
  if (value === 'invited') return 'invited'
  if (value === 'requested') return 'requested'
  return 'active'
}

function normalizeSystemConfig(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const defaultShareDays = Number(source.defaultShareDays)
  const maxShareDays = Number(source.maxShareDays)
  const anonymousMaxFileSizeMb = Number(source.anonymousMaxFileSizeMb)
  const anonymousTotalSizeMb = Number(source.anonymousTotalSizeMb)
  const maxBatchFiles = Number(source.maxBatchFiles)
  const auditLogRetentionDays = Number(source.auditLogRetentionDays)
  const orphanGraceHours = Number(source.orphanGraceHours)
  return {
    maintenanceMode: Boolean(source.maintenanceMode),
    defaultShareDays: Number.isFinite(defaultShareDays) ? Math.min(365, Math.max(1, Math.floor(defaultShareDays))) : DEFAULT_SYSTEM_CONFIG.defaultShareDays,
    maxShareDays: Number.isFinite(maxShareDays) ? Math.min(365, Math.max(1, Math.floor(maxShareDays))) : DEFAULT_SYSTEM_CONFIG.maxShareDays,
    anonymousMaxFileSizeMb: Number.isFinite(anonymousMaxFileSizeMb) ? Math.min(5120, Math.max(1, Math.floor(anonymousMaxFileSizeMb))) : DEFAULT_SYSTEM_CONFIG.anonymousMaxFileSizeMb,
    anonymousTotalSizeMb: Number.isFinite(anonymousTotalSizeMb) ? Math.min(102400, Math.max(0, Math.floor(anonymousTotalSizeMb))) : DEFAULT_SYSTEM_CONFIG.anonymousTotalSizeMb,
    maxBatchFiles: Number.isFinite(maxBatchFiles) ? Math.min(MAX_FILES, Math.max(1, Math.floor(maxBatchFiles))) : DEFAULT_SYSTEM_CONFIG.maxBatchFiles,
    auditLogRetentionDays: Number.isFinite(auditLogRetentionDays) ? Math.min(3650, Math.max(1, Math.floor(auditLogRetentionDays))) : DEFAULT_SYSTEM_CONFIG.auditLogRetentionDays,
    orphanGraceHours: Number.isFinite(orphanGraceHours) ? Math.min(720, Math.max(1, Math.floor(orphanGraceHours))) : DEFAULT_SYSTEM_CONFIG.orphanGraceHours,
    planOverrides: normalizePlanOverrides(source.planOverrides),
  }
}

function normalizePlanOverrides(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const overrides = {}
  for (const planId of Object.keys(ACCOUNT_PLANS)) {
    const plan = source[planId] && typeof source[planId] === 'object' ? source[planId] : {}
    const totalGb = Number(plan.totalGb ?? plan.totalGB)
    const monthlyPrice = Number(plan.monthlyPrice)
    const validityDays = plan.validityDays === null || plan.validityDays === '' ? null : Number(plan.validityDays)
    const normalized = {}
    if (Number.isFinite(totalGb) && totalGb > 0) normalized.totalBytes = Math.round(Math.min(20480, totalGb) * 1024 ** 3)
    if (Number.isFinite(monthlyPrice) && monthlyPrice >= 0) normalized.monthlyPrice = Math.round(monthlyPrice)
    if (validityDays === null || (Number.isFinite(validityDays) && validityDays > 0)) normalized.validityDays = validityDays === null ? null : Math.min(3650, Math.floor(validityDays))
    if (Object.keys(normalized).length) overrides[planId] = normalized
  }
  return overrides
}

function normalizeAuditLogs(value = []) {
  if (!Array.isArray(value)) return []
  return value.map((item) => ({
    id: trimRecordString(item?.id, 80) || createToken(10),
    type: trimRecordString(item?.type, 30) || 'access',
    action: trimRecordString(item?.action, 180),
    status: normalizeNonNegativeInteger(item?.status),
    durationMs: normalizeNonNegativeInteger(item?.durationMs),
    userId: trimRecordString(item?.userId, 120),
    targetId: trimRecordString(item?.targetId, 160),
    ip: trimRecordString(item?.ip, 80),
    details: item?.details && typeof item.details === 'object' ? item.details : {},
    createdAt: normalizeRecordDate(item?.createdAt) || new Date().toISOString(),
  })).filter((item) => item.action).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, MAX_AUDIT_LOGS)
}

function normalizeOrganizations(value = []) {
  const source = Array.isArray(value)
    ? Object.fromEntries(value.map((item) => [item?.id, item]))
    : value && typeof value === 'object' ? value : {}
  const organizations = {}
  for (const item of Object.values(source)) {
    if (!item?.id) continue
    const members = Array.isArray(item.members) ? item.members.map((member) => ({
      id: trimRecordString(member?.id, 80) || createToken(10),
      userId: trimRecordString(member?.userId, 120),
      email: normalizeEmailValue(member?.email),
      phone: normalizePhoneValue(member?.phone),
      displayName: trimRecordString(member?.displayName, 80) || '团队成员',
      role: member?.role === 'owner' ? 'owner' : 'member',
      status: normalizeMemberStatus(member?.status),
      invitationId: trimRecordString(member?.invitationId, 120),
      joinRequestId: trimRecordString(member?.joinRequestId, 120),
      joinSource: trimRecordString(member?.joinSource, 20),
      joinMessage: trimRecordString(member?.joinMessage, 120),
      requestedAt: normalizeRecordDate(member?.requestedAt),
      reviewedAt: normalizeRecordDate(member?.reviewedAt),
      joinedAt: normalizeRecordDate(member?.joinedAt),
      invitedAt: normalizeRecordDate(member?.invitedAt),
    })) : []
    organizations[item.id] = {
      id: trimRecordString(item.id, 80),
      slug: trimRecordString(item.slug, 80) || `team-${createToken(6)}`,
      name: trimRecordString(item.name, 80) || '未命名团队',
      ownerUserId: trimRecordString(item.ownerUserId, 120),
      createdAt: normalizeRecordDate(item.createdAt) || new Date().toISOString(),
      updatedAt: normalizeRecordDate(item.updatedAt) || new Date().toISOString(),
      members,
    }
  }
  return organizations
}

function recordAuditLog(entry = {}) {
  if (!metadata.auditLogs) metadata.auditLogs = []
  metadata.auditLogs.unshift({
    id: createToken(12),
    type: trimRecordString(entry.type, 30) || 'access',
    action: trimRecordString(entry.action, 180),
    status: normalizeNonNegativeInteger(entry.status),
    durationMs: normalizeNonNegativeInteger(entry.durationMs),
    userId: trimRecordString(entry.userId, 120),
    targetId: trimRecordString(entry.targetId, 160),
    ip: trimRecordString(entry.ip, 80),
    details: entry.details && typeof entry.details === 'object' ? entry.details : {},
    createdAt: new Date().toISOString(),
  })
  metadata.auditLogs = normalizeAuditLogs(metadata.auditLogs)
  persistMetadata()
}

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

function normalizePlanId(value) {
  const id = String(value || '').trim().toLowerCase()
  return Object.prototype.hasOwnProperty.call(ACCOUNT_PLANS, id) ? id : 'free'
}

function accountPlanRank(planId) {
  return ACCOUNT_PLAN_RANK[normalizePlanId(planId)] ?? 0
}

function configuredAccountPlan(planId) {
  const id = normalizePlanId(planId)
  const base = ACCOUNT_PLANS[id] || ACCOUNT_PLANS.free
  const override = normalizeSystemConfig(metadataReady?.systemConfig || {}).planOverrides[id] || {}
  return { ...base, ...override, id: base.id, label: base.label, permanent: base.permanent, team: base.team, features: base.features }
}

function configuredAccountPlans() {
  return Object.keys(ACCOUNT_PLANS).map(configuredAccountPlan)
}

function accountPlanForUser(user = {}) {
  const plan = configuredAccountPlan(user.planId)
  const expiresAt = user.planExpiresAt ? new Date(user.planExpiresAt).getTime() : 0
  if (plan.id !== 'free' && Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt <= Date.now()) return configuredAccountPlan('free')
  return plan
}

// 个人套餐 = 用户**自己**订购的套餐，只取决于 user.planId，与团队归属无关。
// 这是个人空间容量、永久保存、单文件上限等「个人权益」的唯一依据。
function accountPersonalPlanForUser(user = {}) {
  const directUser = typeof user === 'string' ? accountUserById(user) || {} : user
  return accountPlanForUser(directUser)
}

// 团队权益 = 用户所在团队空间**所有者**的套餐所提供的协作能力（团队空间容量、
// 成员管理、企业专属入口）。加入别人的团队只共享这些团队侧能力。
//
// ⚠️ 关键约束：**加入团队不得提升个人套餐**。
// 此前 accountEffectivePlanForUser 会在「个人是 free」时直接返回所有者的套餐，
// 导致基础版用户加入企业版团队后，个人账户被误判成企业版
// （个人空间 20GB 变 2048GB、临时保存变永久保存、后台用户列表也显示企业版）。
// 现在个人套餐与团队权益彻底分离：个人套餐永远只看自己。
function accountTeamEntitlementForUser(user = {}) {
  const userId = typeof user === 'string' ? user : user?.id
  const personal = accountPersonalPlanForUser(user)
  // 自己就是团队所有者：团队权益即自己套餐的团队能力
  const organization = accountOrganizationForUser(userId)
  if (!organization) return personal
  if (organization.ownerUserId === userId) return personal
  // 普通成员：借用所有者套餐里的**团队侧**能力，但仅限 teamSpaceBytes / team 开关，
  // 绝不把 owner 的 totalBytes / permanent / label 套到成员头上。
  const ownerPlan = accountPersonalPlanForUser(accountUserById(organization.ownerUserId) || {})
  if (!ownerPlan.team) return personal
  return { ...personal, team: true, teamSpaceBytes: Number(ownerPlan.teamSpaceBytes || 0) }
}

// 对外语义的「当前权益」：个人套餐为主，叠加团队协作能力。
// 用于前端展示与需要「既看个人又看团队」的判定。
function accountEffectivePlanForUser(user = {}) {
  return accountTeamEntitlementForUser(user)
}

// 团队空间容量：唯一来源是**所有者**的套餐（团队空间属于所有者）。
function organizationTeamSpaceBytes(organization) {
  if (!organization) return 0
  const ownerPlan = accountPersonalPlanForUser(accountUserById(organization.ownerUserId) || {})
  return ownerPlan.team ? Number(ownerPlan.teamSpaceBytes || 0) : 0
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

function publicOrganization(organization, viewerId = '') {
  if (!organization) return null
  const isManager = organization.ownerUserId === viewerId
  // 待审批的入团申请只对团队所有者可见，成员与外部访客看到的仍是正式成员列表。
  const visibleMembers = isManager ? organization.members : organization.members.filter((member) => member.status !== 'requested')
  return {
    id: organization.id,
    slug: organization.slug,
    name: organization.name,
    ownerUserId: organization.ownerUserId,
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
    members: visibleMembers.map((member) => ({
      ...member,
      canRemove: member.userId !== organization.ownerUserId && isManager,
    })),
  }
}

function accountOrganizationForUser(userId) {
  const key = String(userId || '')
  if (!key) return null
  return Object.values(metadata.organizations || {}).find((organization) => organization.ownerUserId === key || organization.members.some((member) => member.userId === key && member.status === 'active')) || null
}

function isOrganizationManager(organization, userId) {
  return organization?.ownerUserId === userId
}

function organizationBySlug(slug) {
  const key = trimRecordString(slug, 80)
  if (!key) return null
  return Object.values(metadata.organizations || {}).find((organization) => organization.slug === key) || null
}

function isJoinRequestRateLimited(ip, userId) {
  const key = `${ip || 'unknown'}::${userId || 'anonymous'}`
  const now = Date.now()
  const record = joinRequestAttempts.get(key)
  if (!record || now - record.startedAt > JOIN_REQUEST_WINDOW_MS) return false
  return record.count >= JOIN_REQUEST_MAX_PER_WINDOW
}

function recordJoinRequestAttempt(ip, userId) {
  const key = `${ip || 'unknown'}::${userId || 'anonymous'}`
  const now = Date.now()
  const record = joinRequestAttempts.get(key)
  if (!record || now - record.startedAt > JOIN_REQUEST_WINDOW_MS) {
    joinRequestAttempts.set(key, { count: 1, startedAt: now })
    return
  }
  record.count += 1
}

function joinRequestCooldownRemaining(organization, userId) {
  const previous = organization.members.find((member) => member.userId === userId && member.status !== 'active' && member.reviewedAt && member.joinSource === 'request')
  if (!previous) return 0
  const elapsed = Date.now() - new Date(previous.reviewedAt).getTime()
  return Math.max(0, JOIN_REQUEST_REJECT_COOLDOWN_MS - elapsed)
}

function publicJoinRequest(member, organization) {
  return {
    id: member.id,
    requestId: member.joinRequestId || member.id,
    userId: member.userId,
    displayName: member.displayName,
    email: member.email,
    phone: member.phone,
    message: member.joinMessage || '',
    requestedAt: member.requestedAt || member.invitedAt || organization?.updatedAt || null,
  }
}

function publicJoinRequestsForOrganization(organization) {
  if (!organization) return []
  return organization.members
    .filter((member) => member.status === 'requested')
    .map((member) => publicJoinRequest(member, organization))
    .sort((a, b) => new Date(b.requestedAt || 0).getTime() - new Date(a.requestedAt || 0).getTime())
}

function enterpriseOrganizationForUser(userId) {
  const organization = accountOrganizationForUser(userId)
  if (!organization || !accountEffectivePlanForUser(organization.ownerUserId).team) return null
  return organization
}

function createOrganization(user, name) {
  const id = createToken(12)
  const organization = {
    id,
    slug: `team-${createToken(6)}`,
    name,
    ownerUserId: user.id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    members: [{
      id: createToken(12),
      userId: user.id,
      email: normalizeEmailValue(user.email),
      phone: normalizePhoneValue(user.phone),
      displayName: displayAccountName(user),
      role: 'owner',
      status: 'active',
      joinedAt: new Date().toISOString(),
      invitedAt: null,
    }],
  }
  metadata.organizations[id] = organization
  const account = accountUserById(user.id) || user
  account.organizationId = id
  account.organizationRole = 'owner'
  account.updatedAt = new Date().toISOString()
  upsertAccountUser(account)
  syncAccountUserSessions(account)
  return organization
}

// 组织 roster 上的 displayName / email / phone 是「入团那一刻」的快照，
// 用户之后改昵称不会回写，团队空间就会一直显示旧名字。这里按 userId 反查账号做一次同步。
function syncOrganizationMemberProfile(user = {}) {
  const userId = trimRecordString(user?.id, 120)
  if (!userId) return false
  const displayName = displayAccountName(user)
  const email = normalizeEmailValue(user.email)
  const phone = normalizePhoneValue(user.phone)
  let changed = false
  for (const organization of Object.values(metadata.organizations || {})) {
    // 每个组织单独记变更：changed 若只在循环外声明，第一个组织改到后
    // 后续组织的 updatedAt 都会被无谓地刷新一遍。
    let organizationChanged = false
    for (const member of organization.members || []) {
      if (member.userId !== userId) continue
      // 只补「有值且变了」的字段：账号侧为空时保留 roster 上的历史联系方式，避免把已有信息抹掉。
      if (displayName && member.displayName !== displayName) { member.displayName = displayName; organizationChanged = true }
      if (email && member.email !== email) { member.email = email; organizationChanged = true }
      if (phone && member.phone !== phone) { member.phone = phone; organizationChanged = true }
    }
    if (organizationChanged) {
      organization.updatedAt = new Date().toISOString()
      changed = true
    }
  }
  if (changed) metadataNeedsPersist = true
  return changed
}

function accountWorkspacePayload(user) {
  const stored = accountUserById(user.id) || user
  const organization = accountOrganizationForUser(user.id)
  // plan 仍是「个人套餐」，加入团队不改变它；团队侧能力单独放在 teamEntitlement。
  const plan = accountPersonalPlanForUser(stored)
  return {
    plan,
    teamEntitlement: {
      organizationId: organization?.id || '',
      organizationName: organization?.name || '',
      role: organization ? (organization.ownerUserId === stored.id ? 'owner' : 'member') : '',
      canManage: Boolean(organization && organization.ownerUserId === stored.id),
      teamSpaceBytes: organizationTeamSpaceBytes(organization),
      canUseTeamSpace: Boolean(organization && accountEffectivePlanForUser(stored).team),
    },
    planStartedAt: stored.planStartedAt || null,
    planExpiresAt: plan.permanent ? null : stored.planExpiresAt || null,
    plans: configuredAccountPlans(),
    capacity: accountUsageForUser(user.id),
    organization: publicOrganization(organization, user.id),
    canManage: Boolean(organization && isOrganizationManager(organization, user.id)),
    orders: upgradeOrdersForUser(user.id).slice(0, 10).map(upgradeOrderSummary),
    paymentReconciliation: {
      pending: upgradeOrdersForUser(user.id).some((order) => order.status !== 'paid' && order.remoteOrderNo && !order.paymentRequiresLogin && new Date(order.createdAt).getTime() + PAYMENT_QUERY_RETENTION_MS > Date.now()),
      requiresLogin: upgradeOrdersForUser(user.id).some((order) => order.status !== 'paid' && order.remoteOrderNo && order.paymentRequiresLogin),
    },
  }
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

// 解析收发记录 id → 底层资源引用。记录 id 形如 `<scope>:share:<shareId>` / `<scope>:collection:<token|manageToken|id>`。
function parseAccountRecordResource(recordId) {
  const id = String(recordId || '')
  const separator = id.indexOf(':')
  if (separator <= 0) return null
  const scope = id.slice(0, separator)
  const rest = id.slice(separator + 1)
  if (rest.startsWith('share:')) return { scope, kind: 'share', key: rest.slice(6) }
  if (rest.startsWith('collection:')) return { scope, kind: 'collection', key: rest.slice(11) }
  return null
}

// 删除记录时联动清理：只处理记录归属者本人的资源（my_sent=自己发出的分享、
// my_collections=自己的收集任务），sent_to_me / collect_from_me 是别人的资源绝不能动；
// 且只清「已关闭/过期」的，有效期内的资源保留，提取链接不受影响。
function purgeOwnedStaleResource(userId, recordId) {
  const parsed = parseAccountRecordResource(recordId)
  if (!parsed || !userId || !['my_sent', 'my_collections'].includes(parsed.scope)) return null
  if (parsed.kind === 'share') {
    const index = metadata.shares.findIndex((item) => item.id === parsed.key || item.manageToken === parsed.key)
    if (index < 0) return null
    const share = metadata.shares[index]
    if (share.ownerUserId !== userId) return null
    if (currentShareStatus(share) === 'active') return null
    metadata.shares.splice(index, 1)
    removeDirectory(path.join(filesRoot, share.id))
    return { kind: 'share', id: share.id }
  }
  const index = metadata.collections.findIndex((item) => item.id === parsed.key || item.token === parsed.key || item.manageToken === parsed.key)
  if (index < 0) return null
  const collection = metadata.collections[index]
  if (collection.ownerUserId !== userId) return null
  if (currentCollectionStatus(collection) === 'active') return null
  metadata.collections.splice(index, 1)
  removeDirectory(path.join(collectionsRoot, collection.id))
  return { kind: 'collection', id: collection.id }
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

// 现存资源引用键全集（id/token/manageToken/code 任一口径，与记录条目的 key 生成保持兼容）
function existingRecordResourceKeys() {
  const keys = new Set()
  for (const share of metadata.shares || []) {
    if (share.id) keys.add(share.id)
    if (share.manageToken) keys.add(share.manageToken)
    if (share.code) keys.add(share.code)
  }
  for (const task of metadata.collections || []) {
    if (task.id) keys.add(task.id)
    if (task.token) keys.add(task.token)
    if (task.manageToken) keys.add(task.manageToken)
  }
  return keys
}

// 摘除指向「已不存在资源」的死记录条目：管理员删除资源后，收发记录不应残留死链；
// 同时堵住客户端 localStorage 同步上报把已摘除条目 merge 回来的复活路径。
function pruneOrphanRecordEntries(records) {
  if (!Array.isArray(records) || !records.length) return Array.isArray(records) ? records : []
  const keys = existingRecordResourceKeys()
  return records.filter((record) => {
    const parsed = parseAccountRecordResource(record && record.id)
    if (!parsed) return true
    return keys.has(parsed.key)
  })
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

function cleanupExpired() {
  const now = Date.now()
  let changed = false
  for (const share of metadata.shares) {
    const previousStatus = share.status
    currentShareStatus(share, now)
    if (share.status !== previousStatus) changed = true
    if (maybeNotifyExpiringShare(share, now)) changed = true
  }
  for (const task of metadata.collections) {
    if (maybeNotifyExpiringCollection(task, now)) changed = true
  }
  if (cleanupUserExpiredFiles(now)) changed = true
  cleanupExpiredAuthSessions()
  if (cleanupPaymentQueryCredentials()) changed = true
  if (changed) persistMetadata()
}

function cleanupUserExpiredFiles(now = Date.now()) {
  let changed = false
  for (const share of metadata.shares) {
    if (share.teamResource || share.cleanedAt || !share.ownerUserId || !share.expiresAt || !share.files?.length) continue
    const owner = accountUserById(share.ownerUserId)
    const settings = normalizeFileCleanupSettings(owner?.fileCleanup)
    const expiresAt = new Date(share.expiresAt).getTime()
    if (!settings.enabled || !Number.isFinite(expiresAt) || now < expiresAt + settings.days * 86400000) continue
    removeDirectory(path.join(filesRoot, share.id))
    share.files = []
    share.cleanedAt = new Date(now).toISOString()
    share.status = 'closed'
    share.closeReason = 'auto_cleanup'
    changed = true
  }
  for (const task of metadata.collections) {
    if (task.cleanedAt || !task.ownerUserId || !task.deadline || !task.submissions?.some((submission) => submission.files?.length)) continue
    const owner = accountUserById(task.ownerUserId)
    const settings = normalizeFileCleanupSettings(owner?.fileCleanup)
    const deadline = new Date(task.deadline).getTime()
    if (!settings.enabled || !Number.isFinite(deadline) || now < deadline + settings.days * 86400000) continue
    for (const submission of task.submissions) {
      removeDirectory(path.join(collectionsRoot, task.id, submission.id))
      submission.files = []
    }
    task.cleanedAt = new Date(now).toISOString()
    changed = true
  }
  return changed
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

function currentShareStatus(share = {}, now = Date.now()) {
  if (share.status === 'closed' || share.status === 'expired') return 'closed'
  if (share.expiresAt && new Date(share.expiresAt).getTime() <= now) {
    share.status = 'closed'
    share.closeReason = share.closeReason || 'expired'
    return 'closed'
  }
  const owner = share.ownerUserId ? accountUserById(share.ownerUserId) : null
  const planExpiresAt = owner?.planExpiresAt ? new Date(owner.planExpiresAt).getTime() : 0
  if (!share.expiresAt && Number.isFinite(planExpiresAt) && planExpiresAt > 0 && now >= planExpiresAt + 7 * 86400000) {
    share.status = 'closed'
    share.closeReason = share.closeReason || 'plan_expired'
    return 'closed'
  }
  return share.status || 'active'
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

function currentCollectionStatus(task = {}) {
  if (task.status === 'closed') return 'closed'
  if (task.deadline) return new Date(task.deadline).getTime() <= Date.now() ? 'expired' : 'active'
  return task.status || 'active'
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
function normalizeGuestUsageStore(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const entries = []
  for (const [key, entry] of Object.entries(source)) {
    if (!key || !entry || typeof entry !== 'object') continue
    const bytes = Math.max(0, Math.floor(Number(entry.bytes) || 0))
    if (!bytes) continue
    entries.push({
      key,
      entry: {
        bytes,
        uploads: Math.max(0, Math.floor(Number(entry.uploads) || 0)),
        firstAt: normalizeRecordDate(entry.firstAt) || new Date().toISOString(),
        lastAt: normalizeRecordDate(entry.lastAt) || new Date().toISOString(),
      },
    })
  }
  entries.sort((a, b) => new Date(a.entry.lastAt).getTime() - new Date(b.entry.lastAt).getTime())
  const store = {}
  for (const { key, entry } of entries.slice(-MAX_GUEST_USAGE_ENTRIES)) store[key] = entry
  return store
}

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

function publicUser(user = {}) {
  const avatarSource = String(user.avatarSource || '')
  const providerAvatar = user.providerAvatar || (!avatarSource ? user.avatar : null) || null
  const provider = String(user.provider || user.login_provider || user.oauth_provider || user.channel || user.source || '').trim()
  const email = normalizeEmailValue(user.email || user.mail)
  const phone = normalizePhoneValue(user.phone || user.mobile)
  const username = trimRecordString(user.username || user.name || user.login || email || phone, 80)
  return {
    id: trimRecordString(user.id || user.userId || user.user_id || user.openid || user.open_id || user.unionid || user.sub || email || phone, 120),
    username,
    nickname: trimRecordString(user.nickname || user.displayName || user.display_name || username || '鲲穹用户', 80),
    email,
    phone,
    avatar: user.avatar || null,
    avatarSource,
    providerAvatar,
    provider,
    loginMethods: mergeLoginMethods(user.loginMethods, provider ? ['oauth'] : []),
    planId: user.planId || null,
    planStartedAt: normalizeRecordDate(user.planStartedAt),
    planExpiresAt: normalizeRecordDate(user.planExpiresAt),
    organizationId: trimRecordString(user.organizationId, 80),
    organizationRole: user.organizationRole === 'owner' ? 'owner' : user.organizationRole === 'member' ? 'member' : '',
    status: user.status === 'disabled' ? 'disabled' : 'active',
    fileCleanup: normalizeFileCleanupSettings(user.fileCleanup),
    createdAt: normalizeRecordDate(user.createdAt),
    updatedAt: normalizeRecordDate(user.updatedAt),
  }
}

function publicAccountUser(user = {}) {
  const stored = accountUserById(user.id) || normalizeAccountUser(user) || publicUser(user)
  const organization = accountOrganizationForUser(stored.id)
  const personalPlan = accountPersonalPlanForUser(stored)
  return {
    ...publicUser(stored),
    capacity: accountUsageForUser(stored.id),
    benefits: accountBenefitsForUser(stored),
    // plan = 个人套餐（自己的空间与权益），加入团队不会改变它。
    plan: personalPlan,
    // teamEntitlement = 借用的团队侧能力（团队空间容量/成员协作），与个人套餐分开表达。
    teamEntitlement: {
      organizationId: organization?.id || '',
      organizationName: organization?.name || '',
      role: organization ? (organization.ownerUserId === stored.id ? 'owner' : 'member') : '',
      canManage: Boolean(organization && organization.ownerUserId === stored.id),
      teamSpaceBytes: organizationTeamSpaceBytes(organization),
      // 成员可用团队空间上传；这是共享能力，不代表个人升级
      canUseTeamSpace: Boolean(organization && accountTeamEntitlementForUser(stored).team),
    },
    // 不再下发 isAdmin：后台入口由账号口令控制，不由鲲穹账号身份决定。
    // 前端顶栏据此不再给白名单账号显示「后台管理」按钮，避免误导。
    organization: publicOrganization(organization, stored.id),
    notificationSettings: accountNotificationSettingsForUser(stored.id),
  }
}

function normalizeAccountUserStore(value = {}, sessions = []) {
  const store = {}
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const user of Object.values(value)) {
      const normalized = normalizeAccountUser(user)
      if (normalized?.id) store[normalized.id] = mergeAccountUser(store[normalized.id], user)
    }
  }
  for (const session of sessions) {
    const normalized = normalizeAccountUser(session.user)
    if (!normalized?.id) continue
    // 传原始快照（而非归一化结果），保留 mergeAccountUser 需要的意图标记。
    store[normalized.id] = mergeAccountUser(store[normalized.id], session.user)
    session.user = publicUser(store[normalized.id])
  }
  return store
}

function normalizeAccountUser(user = {}) {
  const base = publicUser(user)
  const contactTarget = base.email
    ? { type: 'email', value: base.email }
    : base.phone
      ? { type: 'phone', value: base.phone }
      : null
  const id = base.id || (contactTarget ? accountUserIdForTarget(contactTarget) : '')
  if (!id) return null
  const testEnterpriseKeys = [id, base.username, base.email, base.phone]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
  const testEnterpriseOverride = testEnterpriseForAllUsers
    || (testEnforceEnterpriseAllowlist && testEnterpriseKeys.some((value) => TEST_ENTERPRISE_USER_KEYS.has(value)))
  // 测试服按白名单强制收敛权益：不在 KUNQIONG_TEST_ENTERPRISE_USER_KEYS 内的账号一律回落基础版，
  // 避免历史数据或手工改库残留的高等级权益（升级需走充值流程）。
  const testEnforceFree = testEnforceEnterpriseAllowlist
    && !testEnterpriseOverride
    && normalizePlanId(user.planId || base.planId || 'free') !== 'free'
  const planId = testEnterpriseOverride ? 'enterprise' : testEnforceFree ? 'free' : normalizePlanId(user.planId || base.planId || 'free')
  const plan = configuredAccountPlan(planId)
  const planExpiresAt = plan.permanent ? null : normalizeRecordDate(user.planExpiresAt || base.planExpiresAt)
  if (testEnterpriseOverride || testEnforceFree || (plan.permanent && (user.planExpiresAt || base.planExpiresAt))) metadataNeedsPersist = true
  const now = new Date().toISOString()
  return {
    ...base,
    id,
    loginMethods: mergeLoginMethods(base.loginMethods, user.loginMethods),
    planId,
    planStartedAt: normalizeRecordDate(user.planStartedAt || base.planStartedAt),
    planExpiresAt,
    organizationId: trimRecordString(user.organizationId || base.organizationId, 80),
    organizationRole: user.organizationRole === 'owner' || user.organizationRole === 'member' ? user.organizationRole : '',
    status: user.status === 'disabled' ? 'disabled' : 'active',
    fileCleanup: normalizeFileCleanupSettings(user.fileCleanup),
    createdAt: normalizeRecordDate(user.createdAt) || now,
    updatedAt: normalizeRecordDate(user.updatedAt) || now,
  }
}

function mergeAccountUser(existing = null, incoming = {}) {
  // 即便还没有既有记录，也要走完整合并流程：否则「首次保存 = 恢复登录头像」
  // 这类只靠 avatarRestoreRequested 表达意图的调用会被 normalizeAccountUser 直接吞掉标记。
  const normalized = normalizeAccountUser(incoming)
  if (!normalized) return existing || null
  const base = existing || normalized
  // 自定义头像一旦保存，就是用户的明确意愿，属于"粘性"字段：
  // 只有「用户主动恢复登录头像」或「重新上传」才允许变更。
  // 此前逻辑用 `avatarSourceExplicit`（incoming 是否带该键）判断"用户是否表态"，
  // 但 OAuth 登录快照、会话快照、后台改库都会带一个显式 avatarSource:''，
  // 于是每次重启归一化 / 重新登录都会把已保存的自定义头像抹成 provider 头像 —— 即"头像丢"。
  // 注意：不能简单用"avatar 为 null"判断恢复，因为恢复时 avatar 会被填成 provider 地址。
  // 因此由调用方通过 avatarRestoreRequested 显式标记"用户就是要恢复登录头像"。
  const restoreRequested = incoming.avatarRestoreRequested === true
  const nextProviderAvatar = normalized.providerAvatar || (!normalized.avatarSource && normalized.avatar) || base.providerAvatar || null
  const nextAvatarSource = normalized.avatarSource === 'custom'
    ? 'custom'
    : base.avatarSource === 'custom' && !restoreRequested
      ? 'custom'
      : ''
  const nextAvatar = nextAvatarSource === 'custom'
    ? normalized.avatarSource === 'custom'
      ? normalized.avatar || base.avatar || null
      : base.avatar || null
    : restoreRequested
      ? (base.providerAvatar || nextProviderAvatar || null)
      : nextProviderAvatar
  const merged = {
    ...base,
    ...normalized,
    nickname: normalized.nickname || base.nickname,
    email: normalized.email || base.email,
    phone: normalized.phone || base.phone,
    avatar: nextAvatar,
    avatarSource: nextAvatarSource,
    providerAvatar: nextProviderAvatar,
    provider: normalized.provider || base.provider,
    loginMethods: mergeLoginMethods(base.loginMethods, normalized.loginMethods),
    // Do not let a stale upstream free record downgrade a locally confirmed paid plan.
    planId: base.planId && base.planId !== 'free' && normalized.planId === 'free'
      ? base.planId
      : normalized.planId || base.planId || 'free',
    planStartedAt: normalized.planStartedAt || base.planStartedAt || null,
    planExpiresAt: normalized.planExpiresAt || base.planExpiresAt || null,
    organizationId: normalized.organizationId || base.organizationId,
    organizationRole: normalized.organizationRole || base.organizationRole,
    status: base.status === 'disabled' ? 'disabled' : normalized.status || base.status || 'active',
    fileCleanup: normalized.fileCleanup || base.fileCleanup || DEFAULT_FILE_CLEANUP_SETTINGS,
    createdAt: base.createdAt || normalized.createdAt,
    updatedAt: new Date().toISOString(),
  }
  // 意图标记只在合并过程中有意义，绝不能落库/下发。
  delete merged.avatarRestoreRequested
  return merged
}

function upsertAccountUser(user = {}) {
  // ⚠️ 必须把**原始** user 交给 mergeAccountUser（而不是先 normalizeAccountUser 的结果）：
  // mergeAccountUser 需要读取 avatarRestoreRequested 这类"意图标记"来决定合并方向，
  // 而 normalizeAccountUser 只输出持久化字段，会把标记吞掉。
  // 之前这里先归一化再合并，导致「恢复登录头像」等显式操作无法生效。
  const normalized = normalizeAccountUser(user)
  if (!normalized?.id) return publicUser(user)
  if (!metadata.users || typeof metadata.users !== 'object' || Array.isArray(metadata.users)) metadata.users = {}
  metadata.users[normalized.id] = mergeAccountUser(metadata.users[normalized.id], user)
  return metadata.users[normalized.id]
}

function accountUserById(userId) {
  const key = accountRecordOwnerKey(userId)
  return key && metadata.users && typeof metadata.users === 'object' ? metadata.users[key] || null : null
}

function syncAccountUserSessions(user = {}) {
  if (!user.id) return
  const sessionUser = publicUser(user)
  for (const session of metadata.sessions) {
    if (session.user?.id === user.id) session.user = sessionUser
  }
}

function normalizeEmailValue(value) {
  const email = trimRecordString(value, 160).toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''
}

function normalizePhoneValue(value) {
  const digits = String(value || '').replace(/[^\d]/g, '')
  return digits.length >= 6 && digits.length <= 20 ? digits : ''
}

function normalizeContactTarget(value) {
  const raw = trimRecordString(value, 160)
  if (!raw) return null
  const email = normalizeEmailValue(raw)
  if (email) return { type: 'email', value: email, label: email }
  const phone = normalizePhoneValue(raw)
  if (phone) return { type: 'phone', value: phone, label: phone }
  return null
}

function accountUserIdForTarget(target) {
  return `contact_${target.type}_${hashSecret(target.value).slice(0, 18)}`
}

function findAccountUserByTarget(target) {
  if (!target) return null
  const users = Object.values(metadata.users || {})
  return users.find((user) => target.type === 'email' ? normalizeEmailValue(user.email) === target.value : normalizePhoneValue(user.phone) === target.value) || null
}

function findAccountUserByInvitationTarget(value) {
  const raw = trimRecordString(value, 160)
  if (!raw) return null
  const contact = normalizeContactTarget(raw)
  if (contact) return findAccountUserByTarget(contact)
  const key = raw.toLowerCase()
  return Object.values(metadata.users || {}).find((user) => [user.id, user.username].some((item) => trimRecordString(item, 160).toLowerCase() === key)) || null
}

function boundMethodForTargetType(type) {
  return type === 'email' ? 'email_bound' : 'phone_bound'
}

function mergeLoginMethods(...groups) {
  return Array.from(new Set(groups.flatMap((group) => Array.isArray(group) ? group : group ? [group] : []).map((item) => trimRecordString(item, 40)).filter(Boolean)))
}

function normalizeVerificationScene() {
  return 'bind'
}

function normalizeVerificationCodes(value = []) {
  if (!Array.isArray(value)) return []
  const now = Date.now()
  return value.map((item) => ({
    id: trimRecordString(item?.id, 80) || createToken(10),
    type: item?.type === 'phone' ? 'phone' : 'email',
    target: trimRecordString(item?.target, 160),
    scene: normalizeVerificationScene(item?.scene),
    codeHash: trimRecordString(item?.codeHash, 80),
    attempts: Math.max(0, Math.min(99, Math.floor(Number(item?.attempts) || 0))),
    createdAt: normalizeRecordDate(item?.createdAt) || new Date().toISOString(),
    expiresAt: normalizeRecordDate(item?.expiresAt),
  })).filter((item) => item.target && item.codeHash && item.expiresAt && new Date(item.expiresAt).getTime() > now).slice(0, MAX_VERIFICATION_CODES)
}

function cleanupVerificationCodes() {
  const next = normalizeVerificationCodes(metadata.verificationCodes)
  if (next.length !== (metadata.verificationCodes || []).length) {
    metadata.verificationCodes = next
    persistMetadata()
  }
}

function createVerificationCode(target, scene) {
  cleanupVerificationCodes()
  const code = String(crypto.randomInt(100000, 1000000))
  const now = new Date()
  metadata.verificationCodes = normalizeVerificationCodes(metadata.verificationCodes)
    .filter((item) => !(item.type === target.type && item.target === target.value && item.scene === scene))
  metadata.verificationCodes.unshift({
    id: createToken(10),
    type: target.type,
    target: target.value,
    scene,
    codeHash: hashSecret(code),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + VERIFICATION_CODE_TTL_MS).toISOString(),
  })
  metadata.verificationCodes = metadata.verificationCodes.slice(0, MAX_VERIFICATION_CODES)
  persistMetadata()
  return code
}

function discardVerificationCode(target, scene) {
  const before = metadata.verificationCodes.length
  metadata.verificationCodes = metadata.verificationCodes.filter((item) => !(item.type === target.type && item.target === target.value && item.scene === scene))
  if (metadata.verificationCodes.length !== before) persistMetadata()
}

function isTencentSmsConfigured() {
  return Boolean(
    tencentSmsSecretId
      && tencentSmsSecretKey
      && tencentSmsSdkAppId
      && tencentSmsSignName
      && tencentSmsBindTemplateId,
  )
}

async function sendTencentSmsCode(phone, code, templateId) {
  const service = 'sms'
  const host = 'sms.tencentcloudapi.com'
  const action = 'SendSms'
  const version = '2021-01-11'
  const timestamp = Math.floor(Date.now() / 1000)
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const payload = JSON.stringify({
    SmsSdkAppId: tencentSmsSdkAppId,
    SignName: tencentSmsSignName,
    TemplateId: String(templateId),
    // Template 2602343 is a single-variable verification-code template.
    // Expiration is enforced by the server and does not need a second SMS parameter.
    TemplateParamSet: [code],
    PhoneNumberSet: [phone.startsWith('+') ? phone : `+86${phone}`],
  })
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`
  const signedHeaders = 'content-type;host;x-tc-action'
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    sha256(payload),
  ].join('\n')
  const credentialScope = `${date}/${service}/tc3_request`
  const stringToSign = [
    'TC3-HMAC-SHA256',
    String(timestamp),
    credentialScope,
    sha256(canonicalRequest),
  ].join('\n')
  const secretDate = hmac(`TC3${tencentSmsSecretKey}`, date)
  const secretService = hmac(secretDate, service)
  const secretSigning = hmac(secretService, 'tc3_request')
  const signature = hmac(secretSigning, stringToSign).toString('hex')
  const response = await fetch(`https://${host}`, {
    method: 'POST',
    headers: {
      Authorization: `TC3-HMAC-SHA256 Credential=${tencentSmsSecretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      'Content-Type': 'application/json; charset=utf-8',
      Host: host,
      'X-TC-Action': action,
      'X-TC-Version': version,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Region': tencentSmsRegion,
    },
    body: payload,
  })
  const result = await response.json().catch(() => ({}))
  const error = result.Response?.Error
  if (!response.ok || error) {
    throw new Error(error?.Message || `腾讯云短信返回 HTTP ${response.status}`)
  }
  const sendStatus = result.Response?.SendStatusSet?.[0]
  if (sendStatus?.Code !== 'Ok') {
    throw new Error(sendStatus?.Message || '腾讯云短信未接受发送请求')
  }
  return result.Response
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function hmac(key, value) {
  return crypto.createHmac('sha256', key).update(value).digest()
}

function verifyAuthCode(target, value, scene) {
  cleanupVerificationCodes()
  const codeHash = hashSecret(trimRecordString(value, 12))
  const list = metadata.verificationCodes
  const index = list.findIndex((item) => item.type === target.type && item.target === target.value && item.scene === scene)
  if (index < 0) throw httpError(400, '验证码不正确或已过期')
  // 校验失败计数：同一验证码连续错 5 次立即作废，防止 6 位码被暴力枚举。
  if (list[index].codeHash !== codeHash) {
    const attempts = (list[index].attempts || 0) + 1
    if (attempts >= 5) {
      list.splice(index, 1)
      persistMetadata()
      throw httpError(400, '错误次数过多，验证码已失效，请重新获取')
    }
    list[index].attempts = attempts
    persistMetadata()
    throw httpError(400, '验证码不正确')
  }
  list.splice(index, 1)
  persistMetadata()
}

function accountUsageForUser(userId) {
  const key = accountRecordOwnerKey(userId)
  const user = accountUserById(key) || {}
  // 个人用量必须按**个人套餐**算容量：加入团队不能把个人空间撑大。
  const plan = accountPersonalPlanForUser(user)
  const ownedShares = metadata.shares.filter((share) => share.ownerUserId === key && !share.teamResource && !share.cleanedAt)
  const ownedCollections = metadata.collections.filter((task) => task.ownerUserId === key && !task.cleanedAt)
  const shareBytes = ownedShares.reduce((sum, share) => sum + fileListSize(share.files), 0)
  const collectionBytes = ownedCollections.reduce((sum, task) => sum + task.submissions.reduce((inner, submission) => inner + fileListSize(submission.files), 0), 0)
  const usedBytes = shareBytes + collectionBytes
  const fileCount = ownedShares.reduce((sum, share) => sum + (share.files?.length || 0), 0)
    + ownedCollections.reduce((sum, task) => sum + task.submissions.reduce((inner, submission) => inner + (submission.files?.length || 0), 0), 0)
  return {
    usedBytes,
    totalBytes: plan.totalBytes,
    remainingBytes: Math.max(plan.totalBytes - usedBytes, 0),
    usageRatio: plan.totalBytes ? Math.min(1, usedBytes / plan.totalBytes) : 0,
    shareBytes,
    collectionBytes,
    shareCount: ownedShares.length,
    collectionCount: ownedCollections.length,
    fileCount,
    singleFileLimitBytes: ACCOUNT_SINGLE_FILE_BYTES,
  }
}

function accountTeamUsageForOrganization(organization) {
  const owner = accountUserById(organization?.ownerUserId) || {}
  // 团队空间容量取自所有者套餐（成员不贡献容量），用 personal 而非 effective，
  // 避免所有者本身也是别的团队成员时被套上别人的 teamSpaceBytes。
  const plan = accountPersonalPlanForUser(owner)
  const shares = metadata.shares.filter((share) => share.teamResource && share.teamOrganizationId === organization?.id && share.status === 'active')
  const usedBytes = shares.reduce((sum, share) => sum + fileListSize(share.files), 0)
  const totalBytes = Number(plan.teamSpaceBytes || 0)
  return {
    usedBytes,
    totalBytes,
    remainingBytes: Math.max(totalBytes - usedBytes, 0),
    usageRatio: totalBytes ? Math.min(1, usedBytes / totalBytes) : 0,
    shareBytes: usedBytes,
    collectionBytes: 0,
    shareCount: shares.length,
    collectionCount: 0,
    fileCount: shares.reduce((sum, share) => sum + (share.files?.length || 0), 0),
    singleFileLimitBytes: ACCOUNT_SINGLE_FILE_BYTES,
  }
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

function formatByteSize(bytes) {
  const value = Number(bytes || 0)
  if (value >= 1024 ** 4) return `${(value / 1024 ** 4).toFixed(1)} TB`
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`
  return `${Math.max(0, Math.round(value / 1024))} KB`
}

function accountBenefitsForUser(user = {}) {
  const stored = typeof user === 'string' ? accountUserById(user) || {} : user
  const plan = accountPersonalPlanForUser(stored)
  const organization = accountOrganizationForUser(stored.id)
  const isMember = Boolean(organization && organization.ownerUserId !== stored.id)
  return [
    { label: '鲲穹登录', detail: '继续使用官方统一登录完成账号认证', enabled: true },
    { label: '跨设备记录', detail: '收发记录和文件中心跟随账号同步', enabled: true },
    { label: '站内消息', detail: '分享、下载和收集动态进入消息中心', enabled: true },
    { label: '账号绑定', detail: '可绑定邮箱或手机号用于消息匹配', enabled: true },
    { label: '账号容量', detail: `${plan.label}提供 ${formatByteSize(plan.totalBytes)} 空间`, enabled: true },
    { label: '永久保存', detail: plan.permanent ? '当前权益支持永久保存分享' : plan.id === 'free' ? '升级会员后可开启永久保存' : '会员期内可自定义分享有效期，永久保存为企业版权益', enabled: plan.permanent },
    // 团队空间：所有者看自己套餐是否具备；成员看「已加入团队空间」，
    // 但明确标注为团队共享能力，避免误导成个人已升级。
    isMember
      ? { label: '团队空间', detail: `已加入「${organization.name}」，共享其团队空间容量`, enabled: true }
      : { label: '团队空间', detail: plan.team ? '可创建团队空间并管理成员' : '团队空间需要团队版或企业版', enabled: plan.team },
  ]
}

function fileListSize(files = []) {
  return Array.isArray(files) ? files.reduce((sum, file) => sum + Number(file?.size || 0), 0) : 0
}

function normalizeNotificationSettingsStore(value = {}) {
  const store = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return store
  for (const [userId, settings] of Object.entries(value)) {
    const key = accountRecordOwnerKey(userId)
    if (key) store[key] = normalizeNotificationSettings(settings)
  }
  return store
}

function normalizeNotificationSettings(settings = {}) {
  const next = { ...DEFAULT_NOTIFICATION_SETTINGS }
  if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
    for (const key of Object.keys(DEFAULT_NOTIFICATION_SETTINGS)) {
      if (Object.prototype.hasOwnProperty.call(settings, key)) next[key] = Boolean(settings[key])
    }
  }
  return next
}

function normalizeFileCleanupSettings(settings = {}) {
  const source = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {}
  const days = Number(source.days)
  return {
    enabled: Boolean(source.enabled),
    days: [1, 3, 7].includes(days) ? days : DEFAULT_FILE_CLEANUP_SETTINGS.days,
  }
}

function accountNotificationSettingsForUser(userId) {
  const key = accountRecordOwnerKey(userId)
  if (!key) return normalizeNotificationSettings()
  if (!metadata.notificationSettings || typeof metadata.notificationSettings !== 'object' || Array.isArray(metadata.notificationSettings)) metadata.notificationSettings = {}
  if (!metadata.notificationSettings[key]) metadata.notificationSettings[key] = normalizeNotificationSettings()
  return metadata.notificationSettings[key]
}

function normalizeAccountMessageStore(value = {}) {
  const store = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return store
  for (const [userId, messages] of Object.entries(value)) {
    const key = accountRecordOwnerKey(userId)
    if (key) store[key] = normalizeAccountMessages(messages)
  }
  return store
}

function normalizeAccountMessages(messages = []) {
  if (!Array.isArray(messages)) return []
  const deduped = new Map()
  messages.map(normalizeAccountMessage).filter(Boolean).forEach((message) => {
    deduped.set(message.id, { ...deduped.get(message.id), ...message })
  })
  return Array.from(deduped.values()).sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()).slice(0, MAX_ACCOUNT_MESSAGES)
}

function normalizeAccountMessage(message = {}) {
  if (!message || typeof message !== 'object') return null
  const title = trimRecordString(message.title, 80)
  const body = trimRecordString(message.body, 280)
  if (!title && !body) return null
  const createdAt = normalizeRecordDate(message.createdAt) || new Date().toISOString()
  const category = ACCOUNT_MESSAGE_CATEGORIES.has(message.category) ? message.category : 'system'
  return {
    id: trimRecordString(message.id, 120) || createToken(12),
    category,
    eventType: trimRecordString(message.eventType, 40),
    title: title || '鲲穹消息',
    body,
    createdAt,
    unread: message.unread !== false,
    readAt: normalizeRecordDate(message.readAt),
    actionUrl: trimRecordString(message.actionUrl, 400),
    actionType: trimRecordString(message.actionType, 50),
    actionId: trimRecordString(message.actionId, 120),
  }
}

function accountMessagesForUser(userId) {
  const key = accountRecordOwnerKey(userId)
  if (!key) return []
  if (!metadata.messages || typeof metadata.messages !== 'object' || Array.isArray(metadata.messages)) metadata.messages = {}
  if (!Object.prototype.hasOwnProperty.call(metadata.messages, key)) {
    metadata.messages[key] = normalizeAccountMessages(DEFAULT_ACCOUNT_MESSAGES.map((message, index) => ({
      ...message,
      createdAt: new Date(Date.now() - (index + 1) * 1000).toISOString(),
    })))
    return metadata.messages[key]
  }
  const current = normalizeAccountMessages(metadata.messages[key])
  metadata.messages[key] = current
  return metadata.messages[key]
}

function addAccountMessage(userId, message = {}, { respectSettings = true } = {}) {
  const key = accountRecordOwnerKey(userId)
  if (!key) return null
  if (respectSettings && !shouldDeliverAccountMessage(key, message.eventType)) return null
  const normalized = normalizeAccountMessage({ ...message, id: message.id || createToken(12), createdAt: message.createdAt || new Date().toISOString(), unread: true })
  if (!normalized) return null
  metadata.messages[key] = normalizeAccountMessages([normalized, ...accountMessagesForUser(key)])
  return normalized
}

function shouldDeliverAccountMessage(userId, eventType) {
  const settings = accountNotificationSettingsForUser(userId)
  if (!settings.inApp) return false
  return !eventType || !Object.prototype.hasOwnProperty.call(settings, eventType) || settings[eventType] !== false
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

function validateShareRecipient(share, viewer) {
  if (!share.deliveryRecipients?.length) return { ok: true }
  if (!viewer?.id) return { ok: false, status: 401, code: 'directed_login_required', message: '此文件为定向分享，请使用收件账号登录' }
  if (viewer.id === share.ownerUserId || share.recipientUserIds?.includes(viewer.id)) return { ok: true }
  const account = accountUserById(viewer.id)
  const contactMatch = account && (share.recipientContacts || []).some((recipient) => {
    const contact = normalizeContactTarget(recipient)
    return contact && (contact.type === 'email' ? normalizeEmailValue(account.email) === contact.value : normalizePhoneValue(account.phone) === contact.value)
  })
  return contactMatch ? { ok: true } : { ok: false, status: 403, code: 'directed_access_denied', message: '当前账号不是此分享的指定收件人' }
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

function isSmtpConfigured() {
  return Boolean(smtpHost && Number.isInteger(smtpPort) && smtpPort > 0 && smtpPort <= 65535 && smtpUser && smtpPassword && smtpFrom)
}

function mailErrorReason(error) {
  const raw = String(error?.responseCode ? `${error.responseCode} ${error.message || ''}` : error?.message || error || '未知邮件错误')
  return raw.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180)
}

function getEmailTransporter() {
  if (!isSmtpConfigured()) return null
  if (!emailTransporter) {
    emailTransporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: { user: smtpUser, pass: smtpPassword },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
    })
  }
  return emailTransporter
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

function maybeNotifyExpiringShare(share, now) {
  if (!share.ownerUserId || currentShareStatus(share) !== 'active' || !share.expiresAt) return false
  if (share.notificationFlags?.shareExpiring) return false
  const expiresAt = new Date(share.expiresAt).getTime()
  if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt - now > EXPIRING_SOON_MS) return false
  const message = addAccountMessage(share.ownerUserId, {
    category: 'system',
    eventType: 'shareExpiring',
    title: '文件分享即将过期',
    body: `${share.files?.[0]?.name || '文件分享'} 将在 ${new Date(share.expiresAt).toLocaleString('zh-CN')} 过期。`,
    actionUrl: `/share/manage/${share.manageToken}`,
  })
  if (!message) return false
  share.notificationFlags = { ...(share.notificationFlags || {}), shareExpiring: true }
  return true
}

function maybeNotifyExpiringCollection(task, now) {
  if (!task.ownerUserId || currentCollectionStatus(task) !== 'active' || !task.deadline) return false
  if (task.notificationFlags?.collectionExpiring) return false
  const deadline = new Date(task.deadline).getTime()
  if (!Number.isFinite(deadline) || deadline <= now || deadline - now > EXPIRING_SOON_MS) return false
  const message = addAccountMessage(task.ownerUserId, {
    category: 'system',
    eventType: 'collectionExpiring',
    title: '收集任务即将截止',
    body: `「${task.title}」将在 ${new Date(task.deadline).toLocaleString('zh-CN')} 截止。`,
    actionUrl: `/collect/manage/${task.manageToken}`,
  })
  if (!message) return false
  task.notificationFlags = { ...(task.notificationFlags || {}), collectionExpiring: true }
  return true
}

function displayAccountName(user = {}) {
  return trimRecordString(user?.nickname || user?.username || user?.email || user?.phone, 80) || '对方'
}

function requireAuthSession(req, res) {
  const session = authSessionFromRequest(req)
  if (!session) res.status(401).json({ message: '请先登录' })
  return session
}

function accountRecordOwnerKey(userId) {
  return trimRecordString(userId, 120)
}

function accountRecordsForUser(userId) {
  const key = accountRecordOwnerKey(userId)
  if (!key) return []
  if (!metadata.records || typeof metadata.records !== 'object' || Array.isArray(metadata.records)) metadata.records = {}
  if (!Array.isArray(metadata.records[key])) metadata.records[key] = []
  // 读取时过滤死条目：存量「资源已删但记录还在」的脏数据在此统一拦截
  return pruneOrphanRecordEntries(metadata.records[key])
}

function normalizeAccountRecordStore(value = {}) {
  const store = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return store
  for (const [userId, records] of Object.entries(value)) {
    const key = accountRecordOwnerKey(userId)
    if (key) store[key] = normalizeAccountRecords(records)
  }
  return store
}

function mergeAccountRecords(currentRecords, incomingRecords) {
  const merged = new Map()
  normalizeAccountRecords(currentRecords).forEach((record) => merged.set(record.id, record))
  normalizeAccountRecords(incomingRecords).forEach((record) => {
    const existing = merged.get(record.id)
    merged.set(record.id, existing ? mergeAccountRecord(existing, record) : record)
  })
  // 合并后再过滤：客户端 localStorage 里残留的死条目上报回来也不能复活
  return pruneOrphanRecordEntries(Array.from(merged.values()).sort(compareAccountRecords).slice(0, MAX_ACCOUNT_RECORDS))
}

function normalizeAccountRecords(records) {
  if (!Array.isArray(records)) return []
  const deduped = new Map()
  records.map(normalizeAccountRecord).filter(Boolean).forEach((record) => {
    const existing = deduped.get(record.id)
    deduped.set(record.id, existing ? mergeAccountRecord(existing, record) : record)
  })
  return Array.from(deduped.values()).sort(compareAccountRecords).slice(0, MAX_ACCOUNT_RECORDS)
}

function normalizeAccountRecord(record = {}) {
  if (!record || typeof record !== 'object') return null
  const id = trimRecordString(record.id, 180)
  if (!id) return null
  const scope = ACCOUNT_RECORD_SCOPES.has(record.scope) ? record.scope : legacyScopeFromType(record.type)
  const kind = ACCOUNT_RECORD_KINDS.has(record.kind)
    ? record.kind
    : scope === 'my_collections' || scope === 'collect_from_me'
      ? 'collection'
      : 'share'
  const now = new Date().toISOString()
  const createdAt = normalizeRecordDate(record.createdAt || record.submittedAt) || now
  const updatedAt = normalizeRecordDate(record.updatedAt || record.lastSeenAt) || createdAt
  return {
    id,
    scope,
    kind,
    type: trimRecordString(record.type, 20) || (kind === 'collection' ? '收集' : '发送'),
    name: trimRecordString(record.name, 160) || (kind === 'collection' ? '收集任务' : '文件分享'),
    alias: trimRecordString(record.alias, 160),
    meta: trimRecordString(record.meta, 240),
    code: trimRecordString(record.code, 40),
    status: trimRecordString(record.status, 40),
    shareId: trimRecordString(record.shareId, 80),
    shareUrl: trimRecordString(record.shareUrl, 400),
    manageToken: trimRecordString(record.manageToken, 120),
    manageUrl: trimRecordString(record.manageUrl, 400),
    collectionToken: trimRecordString(record.collectionToken, 120),
    publicUrl: trimRecordString(record.publicUrl, 400),
    expiresAt: normalizeRecordDate(record.expiresAt),
    deadline: normalizeRecordDate(record.deadline),
    downloadLimit: normalizeNullablePositiveInteger(record.downloadLimit),
    downloadCount: normalizeNonNegativeInteger(record.downloadCount),
    fileCount: normalizeNonNegativeInteger(record.fileCount),
    totalSize: normalizeNonNegativeInteger(record.totalSize),
    submissionCount: normalizeNonNegativeInteger(record.submissionCount),
    participantName: trimRecordString(record.participantName, 80),
    submittedAt: normalizeRecordDate(record.submittedAt),
    allowedTypes: normalizeRecordStringArray(record.allowedTypes, 12, 20),
    maxFileSizeMb: normalizeNullablePositiveInteger(record.maxFileSizeMb),
    files: normalizeRecordFiles(record.files),
    submissions: normalizeRecordSubmissions(record.submissions),
    createdAt,
    updatedAt,
  }
}

function mergeAccountRecord(existing, incoming) {
  const merged = { ...existing, ...incoming }
  merged.createdAt = existing.createdAt || incoming.createdAt
  merged.updatedAt = incoming.updatedAt || existing.updatedAt || merged.createdAt
  if (!incoming.shareId && existing.shareId) merged.shareId = existing.shareId
  if (!incoming.shareUrl && existing.shareUrl) merged.shareUrl = existing.shareUrl
  if (!incoming.manageToken && existing.manageToken) merged.manageToken = existing.manageToken
  if (!incoming.manageUrl && existing.manageUrl) merged.manageUrl = existing.manageUrl
  if (!incoming.alias && existing.alias) merged.alias = existing.alias
  if ((!incoming.name || incoming.name === '文件分享' || incoming.name === '收集任务') && existing.name) merged.name = existing.name
  if (!incoming.meta && existing.meta) merged.meta = existing.meta
  if (!incoming.fileCount && existing.fileCount) merged.fileCount = existing.fileCount
  if (!incoming.totalSize && existing.totalSize) merged.totalSize = existing.totalSize
  if (!incoming.submissionCount && existing.submissionCount) merged.submissionCount = existing.submissionCount
  if ((!incoming.files || !incoming.files.length) && existing.files?.length) merged.files = existing.files
  if ((!incoming.submissions || !incoming.submissions.length) && existing.submissions?.length) merged.submissions = existing.submissions
  return merged
}

function normalizeRecordFiles(files) {
  if (!Array.isArray(files)) return []
  return files.slice(0, MAX_RECORD_FILES).map((file, index) => ({
    name: trimRecordString(file?.name, 180) || `文件 ${index + 1}`,
    relativePath: trimRecordString(file?.relativePath || file?.name, 260),
    size: normalizeNonNegativeInteger(file?.size),
    mimeType: trimRecordString(file?.mimeType, 100),
  }))
}

function normalizeRecordSubmissions(submissions) {
  if (!Array.isArray(submissions)) return []
  return submissions.slice(0, MAX_RECORD_SUBMISSIONS).map((submission) => ({
    id: trimRecordString(submission?.id, 120),
    participantName: trimRecordString(submission?.participantName, 80),
    submitterUserId: trimRecordString(submission?.submitterUserId, 120),
    submitterName: trimRecordString(submission?.submitterName, 80),
    submittedAt: normalizeRecordDate(submission?.submittedAt),
    files: normalizeRecordFiles(submission?.files),
  })).filter((submission) => submission.id || submission.files.length)
}

function normalizeRecordStringArray(value, limit, maxLength) {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((item) => trimRecordString(item, maxLength)).filter(Boolean))).slice(0, limit)
}

function normalizeRecordDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function normalizeNullablePositiveInteger(value) {
  if (value === null || value === undefined || value === '' || value === 'unlimited') return null
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null
}

function normalizeNonNegativeInteger(value) {
  const number = Number(value || 0)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0
}

function trimRecordString(value, maxLength) {
  const text = String(value ?? '').trim()
  return text.length > maxLength ? text.slice(0, maxLength) : text
}

function legacyScopeFromType(type) {
  if (type === '收取' || type === '接收') return 'sent_to_me'
  if (type === '被收集' || type === '提交') return 'collect_from_me'
  if (type === '收集') return 'my_collections'
  return 'my_sent'
}

function compareAccountRecords(a, b) {
  return new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime()
}

function isOAuthConfigured() {
  return Boolean(oauthClientId && oauthClientSecret)
}

function normalizeWebMemberPayType(value) {
  return Number(value) === 2 ? 2 : 1
}

function normalizePaymentPayload(value) {
  if (!value || typeof value !== 'object') return null
  return {
    pay_type: normalizeWebMemberPayType(value.pay_type),
    code_url: trimRecordString(value.code_url, 1000),
    qrcode_img_url: trimRecordString(value.qrcode_img_url, 2_000_000),
    alipaysubmit_html: trimRecordString(value.alipaysubmit_html, 2_000_000),
  }
}

function publicPaymentPayload(value) {
  return normalizePaymentPayload(value)
}

async function ensurePaymentAssets(payment) {
  if (!payment || normalizeWebMemberPayType(payment.pay_type) !== 1 || payment.qrcode_img_url || !payment.code_url) {
    return payment
  }
  try {
    payment.qrcode_img_url = await QRCode.toDataURL(payment.code_url, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 280,
    })
  } catch {
    // Keep code_url available so the caller can retry or copy the payment address.
  }
  return payment
}

function sessionApiWebToken(session) {
  return trimRecordString(session?.apiWebToken, 300)
}

async function webMemberRequest(pathname, token, params = {}) {
  if (!token) throw httpError(401, '登录会话缺少会员支付凭证，请退出后重新登录')
  const response = await fetch(`${webMemberApiBase}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      token,
    },
    body: new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value ?? '')])).toString(),
    signal: AbortSignal.timeout(10000),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || Number(payload.code) !== 1) {
    const authRejected = response.status === 401 || Number(payload.code) === 401
    const error = httpError(authRejected ? 401 : response.status >= 400 ? response.status : 502, authRejected ? '会员支付凭证已失效，请重新登录后核对支付状态' : payload.msg || `会员服务返回 ${response.status}`)
    if (authRejected) error.code = 'payment_login_required'
    throw error
  }
  return payload.data || {}
}

async function getWebMemberPackageInfo(session) {
  return webMemberRequest('/user/get_web_member_package_info', sessionApiWebToken(session), {
    subsite_name: webMemberSubsiteName,
  })
}

async function resolveWebMemberPackage(session, planId) {
  const envKey = WEB_MEMBER_PACKAGE_ENV_KEYS[planId]
  const configuredId = envKey
    ? Number(process.env[envKey] || DEFAULT_WEB_MEMBER_PACKAGE_IDS[planId] || 0)
    : 0
  const info = await getWebMemberPackageInfo(session)
  const packages = Array.isArray(info.packages) ? info.packages : []
  if (configuredId > 0) {
    const configured = packages.find((item) => Number(item.id) === configuredId)
    if (configured) return { info, package: configured }
  }
  const matched = matchWebMemberPackageFromPackages(planId, packages)
  if (!matched) {
    const planLabel = configuredAccountPlan(planId)?.label || ''
    throw httpError(502, `会员服务中未找到“${planLabel}”套餐，请配置正确的套餐 ID`)
  }
  return { info, package: matched }
}

// 按套餐 ID 从远端套餐列表里挑出对应套餐（与订单创建同源；远端没有匹配时返回 null，由调用方决定回落策略）
function matchWebMemberPackageFromPackages(planId, packages) {
  const list = Array.isArray(packages) ? packages : []
  const planLabel = configuredAccountPlan(planId)?.label || ''
  const normalizePackageName = (value) => String(value || '')
    .replace(/\s+/g, '')
    .replace(/[（(].*?[）)]/g, '')
    .toLowerCase()
  const packageName = (item) => normalizePackageName(item.name)
  const label = normalizePackageName(planLabel)
  const aliases = {
    member: ['会员', '月卡', '季卡', '半年卡', '年卡', '永久'],
    team: ['团队', '成长', '进阶', '半年', '年卡'],
    enterprise: ['企业', '永久'],
  }
  const aliasMatched = list.find((item) => aliases[planId]?.some((alias) => packageName(item).includes(alias)))
  const durationMatched = planId === 'enterprise'
    ? list.find((item) => Number(item.days) >= 365 * 1000)
    : planId === 'team'
      ? list.find((item) => Number(item.days) >= 90 && Number(item.days) < 365 * 1000)
      : list.find((item) => Number(item.days) >= 30 && Number(item.days) < 90)
  return list.find((item) => packageName(item).includes(label) || label.includes(packageName(item)))
    || aliasMatched
    || durationMatched
    || null
}

// 远端套餐实价缓存：升级弹窗展示与订单计价必须同源（价格以主站支付套餐为准）
const remotePricingCache = { at: 0, data: null }
const REMOTE_PRICING_TTL = 60 * 1000

async function remoteUpgradePricing(session) {
  const now = Date.now()
  if (remotePricingCache.data && now - remotePricingCache.at < REMOTE_PRICING_TTL) return remotePricingCache.data
  const pricing = {}
  try {
    const info = await getWebMemberPackageInfo(session)
    const packages = Array.isArray(info.packages) ? info.packages : []
    for (const planId of ['member', 'team', 'enterprise']) {
      const pkg = matchWebMemberPackageFromPackages(planId, packages)
      const priceYuan = Number(pkg?.price_yuan)
      const days = normalizeNullablePositiveInteger(pkg?.days)
      if (!pkg || !Number.isFinite(priceYuan) || priceYuan < 0) continue
      pricing[planId] = {
        priceCents: Math.round(priceYuan * 100),
        // ≥100 年的时长视为永久；其余按天数展示，与激活后权益一致
        validityDays: days && days < 36500 ? days : null,
        packageName: trimRecordString(pkg.name, 80),
        packageId: Number(pkg.id) || null,
      }
    }
  } catch {
    // 远端不可达/未配置：返回空 pricing，前端回落本地展示价
  }
  remotePricingCache.data = pricing
  remotePricingCache.at = now
  return pricing
}

async function createWebMemberPaymentOrder(session, order, payType) {
  const { package: memberPackage } = await resolveWebMemberPackage(session, order.planId)
  const data = await webMemberRequest('/user/create_web_member_order', sessionApiWebToken(session), {
    package_id: memberPackage.id,
    pay_type: payType,
    subsite_name: webMemberSubsiteName,
  })
  order.payType = normalizeWebMemberPayType(data.pay_type || payType)
  order.remoteOrderNo = trimRecordString(data.order_no, 80)
  order.remotePackageId = Number(data.package_id || memberPackage.id) || null
  order.remotePackageName = trimRecordString(data.package_name || memberPackage.name, 80)
  order.remotePackageDays = normalizeNullablePositiveInteger(data.package_days || memberPackage.days)
  order.amount = Math.round(Number(data.pay_amount) * 100) || order.amount
  order.payment = normalizePaymentPayload(data)
  order.updatedAt = new Date().toISOString()
  if (!order.remoteOrderNo) throw httpError(502, '会员服务未返回主站订单号')
  retainPaymentQueryCredential(session, order)
  persistMetadata()
  await ensurePaymentAssets(order.payment)
  return { ...data, pay_type: order.payType }
}

async function checkWebMemberPaymentStatus(session, remoteOrderNo) {
  return webMemberRequest('/user/check_web_member_order_paystatus', sessionApiWebToken(session), {
    order_no: remoteOrderNo,
  })
}

async function acquireUpgradeLock(key) {
  const previous = upgradeOrderLocks.get(key) || Promise.resolve()
  let unlock
  const current = new Promise((resolve) => { unlock = resolve })
  upgradeOrderLocks.set(key, current)
  await previous
  return () => { unlock(); if (upgradeOrderLocks.get(key) === current) upgradeOrderLocks.delete(key) }
}

async function reconcileUpgradeOrder(session, order) {
  const release = await acquireUpgradeLock(order.id)
  let queriedToken
  try {
    if (order.status === 'paid' || !order.remoteOrderNo) return { pay_status: order.status === 'paid' ? 1 : 0 }
    // A login can refresh credentials while this query waits for the order lock.
    const credential = normalizePaymentQueryCredential(order)
    if (!credential && !session.user) return { pay_status: 0 }
    queriedToken = sessionApiWebToken(credential || session)
    const result = await checkWebMemberPaymentStatus({ apiWebToken: queriedToken }, order.remoteOrderNo)
    if (Number(result.pay_status) === 1) {
      activatePaidUpgradeOrder(order, result.expire_at)
      persistMetadata()
    }
    return result
  } catch (error) {
    const currentSessionToken = paymentSessionTokens.get(order.userId)
    if (error.code === 'payment_login_required'
      && (!order.paymentQueryCredential || order.paymentQueryCredential.apiWebToken === queriedToken)
      && (!currentSessionToken || currentSessionToken === queriedToken)) {
      order.paymentRequiresLogin = true
      order.paymentQueryCredential = null
      persistMetadata()
    }
    throw error
  } finally { release() }
}

function retainPaymentQueryCredential(session, order, freshLogin = false) {
  const apiWebToken = sessionApiWebToken(session)
  const expiresAt = new Date(order.createdAt).getTime() + PAYMENT_QUERY_RETENTION_MS
  if (!apiWebToken || order.userId !== session.user?.id || order.status === 'paid' || !order.remoteOrderNo || expiresAt <= Date.now() || accountUserById(order.userId)?.status === 'disabled') return
  if (freshLogin) order.paymentRequiresLogin = false
  if (order.paymentRequiresLogin || (!freshLogin && normalizePaymentQueryCredential(order))) return
  order.paymentQueryCredential = { apiWebToken, expiresAt: new Date(expiresAt).toISOString() }
}

function retainUserPaymentQueryCredentials(session, freshLogin = false) {
  for (const order of upgradeOrdersForUser(session.user.id)) {
    if (freshLogin && sessionApiWebToken(session)) order.paymentRequiresLogin = false
    retainPaymentQueryCredential(session, order, freshLogin)
  }
}

function cleanupPaymentQueryCredentials() {
  let changed = false
  for (const order of metadata.upgradeOrders) {
    if (order.paymentQueryCredential && (!normalizePaymentQueryCredential(order) || accountUserById(order.userId)?.status === 'disabled')) {
      order.paymentQueryCredential = null
      changed = true
    }
  }
  return changed
}

async function reconcileUserUpgradeOrders(session, force = false) {
  if (!sessionApiWebToken(session)) return
  const key = session.user.id
  paymentSessionTokens.set(key, sessionApiWebToken(session))
  const previous = paymentReconcileAttempts.get(key)
  if (previous?.running) {
    if (force) {
      await previous.completion
      return reconcileUserUpgradeOrders(session, true)
    }
    return
  }
  if (!force && previous?.at > Date.now() - 30000) return
  let complete
  const state = { running: true, at: Date.now(), completion: new Promise((resolve) => { complete = resolve }) }
  paymentReconcileAttempts.set(key, state)
  try {
    for (const order of upgradeOrdersForUser(key).filter((item) => item.status !== 'paid' && item.remoteOrderNo && !item.paymentRequiresLogin)) {
      try { await reconcileUpgradeOrder(session, order) }
      catch { /* Retry on the next interval or a fresh login token. */ }
    }
  } finally { state.running = false; complete() }
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

function activatePaidUpgradeOrder(order, expireAt = null) {
  if (order.status === 'paid') return
  const account = accountUserById(order.userId)
  if (!account) throw httpError(404, '支付用户不存在')
  const plan = configuredAccountPlan(order.planId)
  const currentExpiry = account.planExpiresAt ? new Date(account.planExpiresAt).getTime() : 0
  const remoteExpiry = expireAt ? new Date(expireAt).getTime() : 0
  const currentPlan = accountPlanForUser(account)
  const renewalBase = currentPlan.id === order.planId ? Math.max(Date.now(), currentExpiry || 0) : Date.now()
  const nextExpiry = Math.max(remoteExpiry || 0, renewalBase + (Number(order.remotePackageDays) || plan.validityDays || 30) * 86400000)
  const keepHigherPlan = accountPlanRank(currentPlan.id) > accountPlanRank(order.planId)
  if (!keepHigherPlan) account.planId = order.planId
  account.planStartedAt = account.planStartedAt || new Date().toISOString()
  if (!keepHigherPlan) account.planExpiresAt = plan.permanent
    ? null
    : new Date(Math.max(currentExpiry, nextExpiry)).toISOString()
  account.updatedAt = new Date().toISOString()
  order.status = 'paid'
  order.paymentQueryCredential = null
  order.paymentRequiresLogin = false
  order.paidAt = new Date().toISOString()
  order.remoteExpireAt = plan.permanent
    ? null
    : new Date(Math.max(currentExpiry, nextExpiry)).toISOString()
  order.updatedAt = new Date().toISOString()
  upsertAccountUser(account)
  syncAccountUserSessions(account)
  addAccountMessage(account.id, {
    category: 'other',
    eventType: 'membershipActivated',
    title: '会员权益已开通',
    body: plan.permanent
      ? `你的${plan.label}已开通，文件永久保存。`
      : `你的${plan.label}已开通，有效期至${new Date(account.planExpiresAt).toLocaleString('zh-CN')}。`,
  })
}

function authRedirectUri(req) {
  const origin = getRequestOrigin(req)
  if (configuredCallbackUrls.length) {
    try {
      const requestHost = new URL(origin).hostname
      const exactMatch = configuredCallbackUrls.find((item) => new URL(item).hostname === requestHost)
      if (exactMatch) return exactMatch
      if (['localhost', '127.0.0.1', '::1'].includes(requestHost)) {
        const localMatch = configuredCallbackUrls.find((item) => ['localhost', '127.0.0.1', '::1'].includes(new URL(item).hostname))
        if (localMatch) return localMatch
      }
    } catch {}
    return configuredCallbackUrls[0]
  }
  try {
    const url = new URL(origin)
    if (['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
      return `http://localhost:${serverPort}/auth/callback`
    }
    return `${url.origin}/auth/callback`
  } catch {
    return `http://localhost:${serverPort}/auth/callback`
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

function authSessionFromRequest(req) {
  const sessionId = readCookie(req, AUTH_COOKIE_NAME)
  if (!sessionId) return null
  const session = metadata.sessions.find((item) => item.id === sessionId)
  if (!session) return null
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    removeAuthSession(sessionId)
    return null
  }
  if (accountUserById(session.user?.id)?.status === 'disabled') {
    removeAuthSession(sessionId)
    return null
  }
  const storedUser = accountUserById(session.user?.id)
  if (storedUser) session.user = publicUser(storedUser)
  return session
}

function removeAuthSession(sessionId) {
  const session = metadata.sessions.find((item) => item.id === sessionId)
  if (session) retainUserPaymentQueryCredentials(session)
  const before = metadata.sessions.length
  metadata.sessions = metadata.sessions.filter((session) => session.id !== sessionId)
  if (metadata.sessions.length !== before) persistMetadata()
}

function cleanupExpiredAuthSessions() {
  const now = Date.now()
  for (const session of metadata.sessions) {
    if (new Date(session.expiresAt).getTime() <= now) retainUserPaymentQueryCredentials(session)
  }
  const nextSessions = metadata.sessions.filter((session) => new Date(session.expiresAt).getTime() > now)
  if (nextSessions.length !== metadata.sessions.length) {
    metadata.sessions = nextSessions
    persistMetadata()
  }
}

function cleanupOAuthStates() {
  const now = Date.now()
  for (const [state, value] of oauthStates.entries()) {
    if (now - value.createdAt > OAUTH_STATE_TTL_MS) oauthStates.delete(state)
  }
}

function consumeOAuthState(state) {
  cleanupOAuthStates()
  if (!state || !oauthStates.has(state)) return null
  const value = oauthStates.get(state)
  oauthStates.delete(state)
  return value
}

function safeReturnUrl(value, req) {
  const fallback = getRequestOrigin(req)
  const requestOrigin = new URL(fallback).origin
  const configuredOrigin = configuredAppUrl ? (() => {
    try { return new URL(configuredAppUrl).origin } catch { return '' }
  })() : ''
  const allowedOrigins = new Set([
    requestOrigin,
    configuredOrigin === requestOrigin ? configuredOrigin : '',
  ].filter(Boolean).map((item) => {
    try { return new URL(item).origin } catch { return '' }
  }).filter(Boolean))
  try {
    const candidate = new URL(firstValue(value) || fallback, fallback)
    return allowedOrigins.has(candidate.origin) ? candidate.toString() : fallback
  } catch {
    return fallback
  }
}

function alignReturnUrlWithAuthHost(returnTo, redirectUri) {
  try {
    const target = new URL(returnTo)
    const callback = new URL(redirectUri)
    if (isLoopbackHost(target.hostname) && isLoopbackHost(callback.hostname) && target.hostname !== callback.hostname) {
      target.hostname = callback.hostname
      return target.toString()
    }
  } catch {}
  return returnTo
}

function isLoopbackHost(hostname) {
  return LOOPBACK_HOSTS.has(String(hostname || '').toLowerCase().replace(/^\[|\]$/g, ''))
}

function appendAuthResult(value, status, message = '') {
  let url
  try {
    url = new URL(value)
  } catch {
    url = new URL(`http://localhost:${serverPort}/`)
  }
  url.searchParams.set('login', status)
  if (message) url.searchParams.set('message', message)
  else url.searchParams.delete('message')
  return url.toString()
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

function clearAuthCookie(res, req) {
  res.setHeader('Set-Cookie', serializeCookie(AUTH_COOKIE_NAME, '', {
    httpOnly: true,
    maxAge: 0,
    path: '/',
    sameSite: 'Lax',
    secure: isSecureRequest(req),
  }))
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`]
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`)
  if (options.path) parts.push(`Path=${options.path}`)
  if (options.httpOnly) parts.push('HttpOnly')
  if (options.secure) parts.push('Secure')
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`)
  return parts.join('; ')
}

function readCookie(req, name) {
  const cookies = String(req.get('cookie') || '').split(';')
  for (const cookie of cookies) {
    const [key, ...valueParts] = cookie.trim().split('=')
    if (key === name) return decodeURIComponent(valueParts.join('=') || '')
  }
  return ''
}

function isSecureRequest(req) {
  return req.secure || firstHeader(req.get('x-forwarded-proto')) === 'https'
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

function publicFile(file = {}) {
  const { storedName, ...safeFile } = file
  return {
    ...safeFile,
    name: normalizeUploadFileName(safeFile.name || safeFile.relativePath || storedName || ''),
    relativePath: safeRelativePath(normalizeUploadFileName(safeFile.relativePath || safeFile.name || storedName || '')),
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

function getOrigin(req) {
  return getRequestOrigin(req)
}

function getRequestOrigin(req) {
  const proto = firstHeader(req.get('x-forwarded-proto')) || req.protocol
  const host = firstHeader(req.get('x-forwarded-host')) || req.get('host') || `localhost:${serverPort}`
  return `${proto}://${host}`
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


function safeRelativePath(value) {
  const normalized = path.posix.normalize(String(value).replaceAll('\\', '/')).replace(/^(\.\.(\/|\\|$))+/, '')
  return normalized.replace(/^\/+/, '') || '未命名文件'
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

