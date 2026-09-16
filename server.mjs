import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import multer from 'multer'
import archiver from 'archiver'
import QRCode from 'qrcode'
import nodemailer from 'nodemailer'
import mysql from 'mysql2/promise'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
loadEnvFile(path.join(__dirname, '.env'))

const storageRoot = path.join(__dirname, 'storage')
const tempRoot = path.join(storageRoot, 'tmp')
const filesRoot = path.join(storageRoot, 'files')
const collectionsRoot = path.join(storageRoot, 'collections')
const distRoot = path.join(__dirname, 'dist')
const metadataPath = path.join(storageRoot, 'metadata.json')
const shareEmailTemplatePath = path.join(__dirname, 'email-templates', 'share-notification.html')
const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024
const MAX_FILES = 100
const EXPIRING_SOON_MS = 24 * 60 * 60 * 1000
const serverPort = Number(process.env.PORT || process.env.KUNQIONG_PORT || 8045)
const oauthAuthorizeUrl = process.env.KUNQIONG_OAUTH_AUTHORIZE_URL || 'https://login.kunqiongai.com/authorize.html'
const oauthTokenUrl = process.env.KUNQIONG_OAUTH_TOKEN_URL || 'https://login.kunqiongai.com/api/oauth/token'
const oauthClientId = process.env.KUNQIONG_OAUTH_CLIENT_ID || 'app_d1fbbfc18f7908d5'
const oauthClientSecret = process.env.KUNQIONG_OAUTH_CLIENT_SECRET || process.env.OAUTH_CLIENT_SECRET || ''
const configuredCallbackUrls = splitConfigValues(process.env.KUNQIONG_AUTH_CALLBACK_URL)
const configuredAppUrl = process.env.KUNQIONG_APP_URL || ''
const releaseSha = String(process.env.KUNQIONG_RELEASE_SHA || '').trim()
const smtpHost = String(process.env.KUNQIONG_SMTP_HOST || '').trim()
const smtpPort = Number(process.env.KUNQIONG_SMTP_PORT || 465)
const smtpSecure = parseBooleanEnv(process.env.KUNQIONG_SMTP_SECURE, smtpPort === 465)
const smtpUser = String(process.env.KUNQIONG_SMTP_USER || '').trim()
const smtpPassword = String(process.env.KUNQIONG_SMTP_PASSWORD || '')
const smtpFrom = String(process.env.KUNQIONG_SMTP_FROM || smtpUser).trim()
const smtpFromName = String(process.env.KUNQIONG_SMTP_FROM_NAME || '鲲穹文件传输').trim()
const tencentSmsSecretId = String(process.env.KUNQIONG_TENCENT_SECRET_ID || '').trim()
const tencentSmsSecretKey = String(process.env.KUNQIONG_TENCENT_SECRET_KEY || '')
const tencentSmsSdkAppId = String(process.env.KUNQIONG_TENCENT_SMS_SDK_APP_ID || '').trim()
const tencentSmsSignName = String(process.env.KUNQIONG_TENCENT_SMS_SIGN_NAME || '').trim()
const tencentSmsBindTemplateId = String(process.env.KUNQIONG_TENCENT_SMS_TEMPLATE_BIND_CODE_ID || '').trim()
const tencentSmsRegion = String(process.env.KUNQIONG_TENCENT_SMS_REGION || 'ap-guangzhou').trim()
const webMemberApiBase = String(process.env.KUNQIONG_WEB_MEMBER_API_BASE || 'https://api-web.kunqiongai.com').replace(/\/+$/, '')
const webMemberSubsiteName = String(process.env.KUNQIONG_WEB_MEMBER_SUBSITE_NAME || configuredAppUrl || 'kunqiong-send').trim()
const WEB_MEMBER_PACKAGE_ENV_KEYS = {
  member: 'KUNQIONG_WEB_MEMBER_PACKAGE_MEMBER_ID',
  team: 'KUNQIONG_WEB_MEMBER_PACKAGE_TEAM_ID',
  enterprise: 'KUNQIONG_WEB_MEMBER_PACKAGE_ENTERPRISE_ID',
}
// These are the currently enabled package IDs returned by the member service.
// Deployments can override them through the environment variables above.
const DEFAULT_WEB_MEMBER_PACKAGE_IDS = {
  member: 1,
  team: 2,
  enterprise: 5,
}
const databaseEnabled = parseBooleanEnv(process.env.KUNQIONG_DB_ENABLED, false)
const databaseHost = String(process.env.KUNQIONG_DB_HOST || '').trim()
const databasePort = Number(process.env.KUNQIONG_DB_PORT || 3306)
const databaseName = String(process.env.KUNQIONG_DB_NAME || '').trim()
const databaseUser = String(process.env.KUNQIONG_DB_USER || '').trim()
const databasePassword = String(process.env.KUNQIONG_DB_PASSWORD || '')
const AUTH_COOKIE_NAME = 'kunqiong_session'
const SHARE_ACCESS_COOKIE_PREFIX = 'kunqiong_share_access_'
const SHARE_ACCESS_TTL_SECONDS = 15 * 60
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000
const UPLOAD_SESSION_TTL_MS = 12 * 60 * 60 * 1000
const MAX_ACCOUNT_RECORDS = 200
const MAX_ACCOUNT_MESSAGES = 120
const MAX_RECORD_FILES = 120
const MAX_RECORD_SUBMISSIONS = 80
const VERIFICATION_CODE_TTL_MS = 10 * 60 * 1000
const MAX_VERIFICATION_CODES = 120
const ACCOUNT_SINGLE_FILE_BYTES = MAX_FILE_SIZE
const ACCOUNT_RECORD_SCOPES = new Set(['my_sent', 'sent_to_me', 'my_collections', 'collect_from_me'])
const ACCOUNT_RECORD_KINDS = new Set(['share', 'collection'])
const ACCOUNT_MESSAGE_CATEGORIES = new Set(['system', 'official', 'other'])
const ADMIN_USER_IDS = new Set(splitConfigValues(process.env.KUNQIONG_ADMIN_USER_IDS))
const TEST_ENTERPRISE_USER_KEYS = new Set(splitConfigValues(process.env.KUNQIONG_TEST_ENTERPRISE_USER_KEYS || process.env.KUNQIONG_TEST_ENTERPRISE_USER_IDS).map((value) => value.toLowerCase()))
const testEnterpriseForAllUsers = process.env.NODE_ENV === 'test'
  && parseBooleanEnv(process.env.KUNQIONG_TEST_ENTERPRISE_ALL, false)
const testVerificationDebugMode = process.env.NODE_ENV === 'test'
  && parseBooleanEnv(process.env.KUNQIONG_VERIFICATION_DEBUG, false)
const COLLECTION_TYPE_OPTIONS = ['全部格式', '图片', '文档', '视频', '音频', '压缩包', '代码文件', '其他']
const COLLECTION_TYPE_EXTENSIONS = {
  图片: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.heic', '.heif', '.ico'],
  文档: ['.pdf', '.doc', '.docx', '.txt', '.rtf', '.xls', '.xlsx', '.csv', '.ppt', '.pptx', '.md'],
  视频: ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.ogv', '.flv', '.wmv'],
  音频: ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.oga', '.ogg', '.wma'],
  压缩包: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz'],
  代码文件: ['.js', '.jsx', '.ts', '.tsx', '.html', '.css', '.json', '.xml', '.yml', '.yaml', '.java', '.py', '.go', '.php', '.rb', '.rs', '.c', '.cpp', '.h', '.cs', '.sh', '.ps1', '.bat', '.cmd', '.sql'],
}
const UPGRADE_ORDER_STATUSES = new Set(['pending_payment', 'paid', 'canceled', 'expired'])
const MAX_UPGRADE_ORDERS = 500
const MAX_AUDIT_LOGS = 5000
const DEFAULT_SYSTEM_CONFIG = {
  maintenanceMode: false,
  defaultShareDays: 3,
  maxShareDays: 30,
  anonymousMaxFileSizeMb: 500,
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
    id: 'member', label: '会员版', totalBytes: 100 * 1024 * 1024 * 1024, permanent: true, team: false,
    tagline: '个人永久空间', monthlyPrice: 1, validityDays: 30,
    features: ['100 GB 存储空间', '文件永久保存', '完整分享与收集能力', '会员专属标识'],
  },
  team: {
    id: 'team', label: '团队版', totalBytes: 500 * 1024 * 1024 * 1024, teamSpaceBytes: 250 * 1024 * 1024 * 1024, permanent: true, team: true,
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
metadataReady = metadata
if (metadataNeedsPersist) persistMetadata()
const uploadSessions = new Map()
const oauthStates = new Map()
const upload = multer({
  dest: tempRoot,
  limits: { files: MAX_FILES, fileSize: MAX_FILE_SIZE },
})
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

  if (hasNickname) {
    const nickname = String(body.nickname || '').trim()
    if (!nickname) return res.status(400).json({ message: '昵称不能为空' })
    if (nickname.length > 40) return res.status(400).json({ message: '昵称最多 40 个字符' })
    session.user = { ...session.user, nickname }
  }
  if (hasAvatar) {
    const avatar = body.avatar === null ? null : String(body.avatar || '')
    if (avatar && (!/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(avatar) || Buffer.byteLength(avatar, 'utf8') > 600000)) {
      return res.status(400).json({ message: '头像格式不支持或图片过大，请上传 2 MB 以内的图片' })
    }
    session.user = {
      ...session.user,
      avatar: avatar || session.user.providerAvatar || null,
      avatarSource: avatar ? 'custom' : '',
    }
  }
  const user = upsertAccountUser(session.user)
  syncAccountUserSessions(user)
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

app.post('/api/auth/code', async (req, res) => {
  try {
    const session = requireAuthSession(req, res)
    if (!session) return
    const target = normalizeContactTarget(req.body?.target)
    if (!target) return res.status(400).json({ message: '请输入正确的邮箱或手机号' })
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
    const user = upsertAccountUser({
      ...session.user,
      [target.type]: target.value,
      loginMethods: mergeLoginMethods(session.user.loginMethods, [boundMethodForTargetType(target.type)]),
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
  metadata.records[key] = normalizeAccountRecords(req.body?.records)
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
  if (ids.length) {
    const targets = new Set(ids)
    metadata.records[key] = accountRecordsForUser(session.user.id).filter((record) => !targets.has(record.id))
  } else {
    metadata.records[key] = []
  }
  persistMetadata()
  res.json({ records: metadata.records[key] })
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

app.get('/api/account/workspace', (req, res) => {
  const session = requireAuthSession(req, res)
  if (!session) return
  res.json(accountWorkspacePayload(session.user))
})

app.get('/api/account/team/overview', (req, res) => {
  const session = requireAuthSession(req, res)
  if (!session) return
  const organization = accountOrganizationForUser(session.user.id)
  if (!organization) return res.status(404).json({ message: '你尚未加入团队空间' })
  const memberIds = new Set(organization.members.map((member) => member.userId).filter(Boolean))
  const memberUsage = organization.members.map((member) => {
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
  const resources = [
    ...metadata.shares.filter((item) => item.teamResource && item.teamOrganizationId === organization.id && memberIds.has(item.ownerUserId)).map((item) => ({
      id: item.id,
      kind: 'share',
      name: item.files?.[0]?.name || '文件分享',
      ownerUserId: item.ownerUserId,
      status: currentShareStatus(item),
      fileCount: item.files?.length || 0,
      totalSize: fileListSize(item.files),
      downloadCount: item.downloadCount || 0,
      createdAt: item.createdAt,
      expiresAt: item.expiresAt || null,
      manageToken: item.manageToken,
      manageUrl: `${getOrigin(req)}/share/manage/${item.manageToken}`,
    })),
  ].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
  res.json({
    organization: publicOrganization(organization, session.user.id),
    canManage: isOrganizationManager(organization, session.user.id),
    plan: accountEffectivePlanForUser(organization.ownerUserId),
    capacity: accountTeamUsageForOrganization(organization),
    memberUsage,
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
  if (organization.members[index].userId === organization.ownerUserId) return res.status(400).json({ message: '团队所有者不能移除' })
  organization.members.splice(index, 1)
  organization.updatedAt = new Date().toISOString()
  persistMetadata()
  res.json(accountWorkspacePayload(session.user))
})

app.get('/api/account/upgrade-orders', (req, res) => {
  const session = requireAuthSession(req, res)
  if (!session) return
  res.json({ orders: upgradeOrdersForUser(session.user.id).slice(0, 20).map(upgradeOrderSummary) })
})

app.post('/api/account/upgrade-orders', async (req, res) => {
  try {
    const session = requireAuthSession(req, res)
    if (!session) return
    const stored = accountUserById(session.user.id) || session.user
    const effective = accountEffectivePlanForUser(stored)
    const planId = normalizePlanId(req.body?.planId)
    if (planId === 'free') return res.status(400).json({ message: '基础版为默认权益，无需订购' })
    if (planId === effective.id) return res.status(409).json({ message: `当前已是${effective.label}权益` })
    if (accountPlanRank(planId) <= accountPlanRank(effective.id)) {
      return res.status(409).json({ message: `当前已享有${effective.label}权益，无需订购低等级套餐` })
    }

    const staleBefore = Date.now() - 30 * 60 * 1000
    for (const item of upgradeOrdersForUser(stored.id)) {
      if (item.status === 'pending_payment' && new Date(item.createdAt).getTime() < staleBefore) {
        item.status = 'expired'
        item.updatedAt = new Date().toISOString()
      }
    }
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
    metadata.upgradeOrders = normalizeUpgradeOrders(metadata.upgradeOrders)
    persistMetadata()
    res.status(201).json({ order: upgradeOrderSummary(order), orders: upgradeOrdersForUser(stored.id).slice(0, 20).map(upgradeOrderSummary) })
  } catch (error) {
    res.status(error.status || 502).json({ message: error.message || '升级套餐读取失败' })
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
  try {
    const session = requireAuthSession(req, res)
    if (!session) return
    const order = findUpgradeOrder(req.params.orderId, session.user.id)
    if (!order) return res.status(404).json({ message: '升级订单不存在' })
    if (order.status !== 'pending_payment') return res.status(409).json({ message: '当前订单不支持支付确认' })
    const payType = normalizeWebMemberPayType(req.body?.payType || order.payType || 1)
    const payment = order.remoteOrderNo
      ? { order_no: order.remoteOrderNo, pay_type: order.payType || payType, ...(order.payment || {}) }
      : await createWebMemberPaymentOrder(session, order, payType)
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
    const result = await checkWebMemberPaymentStatus(session, order.remoteOrderNo)
    if (Number(result.pay_status) === 1) {
      activatePaidUpgradeOrder(order, result.expire_at)
      persistMetadata()
      return res.json({ message: '支付成功，会员权益已开通', order: upgradeOrderSummary(order), workspace: accountWorkspacePayload(session.user) })
    }
    order.updatedAt = new Date().toISOString()
    persistMetadata()
    res.json({ message: result.msg || '还未支付', order: upgradeOrderSummary(order), paid: false })
  } catch (error) {
    res.status(error.status || 502).json({ message: error.message || '支付状态查询失败' })
  }
})

app.get('/api/admin/overview', (req, res) => {
  const session = requireAdminSession(req, res)
  if (!session) return
  res.json(buildAdminOverview())
})

app.post('/api/admin/cleanup', (req, res) => {
  const session = requireAdminSession(req, res)
  if (!session) return
  const result = runMaintenanceCleanup()
  recordAuditLog({ type: 'admin', action: '手动执行存储清理', userId: session.user.id, details: result })
  res.json({ ...result, overview: buildAdminOverview() })
})

app.patch('/api/admin/config', (req, res) => {
  const session = requireAdminSession(req, res)
  if (!session) return
  metadata.systemConfig = normalizeSystemConfig({
    ...metadata.systemConfig,
    ...req.body,
    planOverrides: req.body?.planOverrides || metadata.systemConfig.planOverrides,
  })
  persistMetadata()
  recordAuditLog({ type: 'admin', action: '更新系统配置', userId: session.user.id, details: metadata.systemConfig })
  res.json({ config: metadata.systemConfig })
})

app.patch('/api/admin/users/:userId', (req, res) => {
  const session = requireAdminSession(req, res)
  if (!session) return
  const user = accountUserById(req.params.userId)
  if (!user) return res.status(404).json({ message: '用户不存在' })
  const status = req.body?.status ? String(req.body.status) : user.status || 'active'
  const planId = normalizePlanId(req.body?.planId || user.planId)
  if (!['active', 'disabled'].includes(status)) return res.status(400).json({ message: '用户状态不支持' })
  if (user.id === session.user.id && status === 'disabled') return res.status(400).json({ message: '不能禁用当前管理员账号' })
  user.status = status
  user.planId = planId
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'planExpiresAt')) {
    user.planExpiresAt = normalizeRecordDate(req.body.planExpiresAt)
  }
  user.updatedAt = new Date().toISOString()
  if (status === 'disabled') {
    metadata.sessions = metadata.sessions.filter((item) => item.user?.id !== user.id)
  }
  syncAccountUserSessions(user)
  persistMetadata()
  recordAuditLog({ type: 'admin', action: '更新用户状态或权益', userId: session.user.id, targetId: user.id, details: { status, planId } })
  res.json({ user: adminUserSummary(user) })
})

app.delete('/api/admin/resources/:kind/:id', (req, res) => {
  const session = requireAdminSession(req, res)
  if (!session) return
  const kind = String(req.params.kind)
  const id = String(req.params.id)
  if (kind === 'share') {
    const index = metadata.shares.findIndex((item) => item.id === id)
    if (index < 0) return res.status(404).json({ message: '分享资源不存在' })
    const [share] = metadata.shares.splice(index, 1)
    removeDirectory(path.join(filesRoot, share.id))
  } else if (kind === 'collection') {
    const index = metadata.collections.findIndex((item) => item.id === id || item.token === id || item.manageToken === id)
    if (index < 0) return res.status(404).json({ message: '收集资源不存在' })
    const [collection] = metadata.collections.splice(index, 1)
    removeDirectory(path.join(collectionsRoot, collection.id))
  } else {
    return res.status(400).json({ message: '资源类型不支持' })
  }
  persistMetadata()
  recordAuditLog({ type: 'admin', action: '删除文件资源', userId: session.user.id, targetId: id, details: { kind } })
  res.json({ ok: true, overview: buildAdminOverview() })
})

app.patch('/api/admin/resources/:kind/:id/review', (req, res) => {
  const session = requireAdminSession(req, res)
  if (!session) return
  const resource = findAdminResource(req.params.kind, req.params.id)
  if (!resource) return res.status(404).json({ message: '文件资源不存在' })
  markResourceReviewStatus(resource.kind, resource.item, 'approved')
  resource.item.updatedAt = new Date().toISOString()
  persistMetadata()
  recordAuditLog({ type: 'admin', action: '通过文件资源审核', userId: session.user.id, targetId: resource.id, details: { kind: resource.kind } })
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
  try {
    assertServiceWritable(req)
    const uploadedFiles = req.files || []
    if (!uploadedFiles.length) return res.status(400).json({ message: '至少选择一个文件' })
    assertConfiguredUploadLimits(req, uploadedFiles)
    assertSafeUploadFiles(uploadedFiles)

    const relativePaths = parseJson(req.body.relativePaths, [])
    const files = uploadedFiles.map((file, index) => {
      const relativePath = safeRelativePath(relativePaths[index] || file.originalname)
      return {
        name: file.originalname,
        relativePath,
        size: file.size,
        mimeType: file.mimetype || 'application/octet-stream',
        tempPath: file.path,
      }
    })

    const ownerSession = authSessionFromRequest(req)
    const share = await createShareFromTempFiles(files, readShareOptions(req.body, ownerSession?.user), req)
    res.status(201).json({ share: publicShare(share, req, true, true) })
  } catch (error) {
    cleanupUploadedFiles(req.files)
    next(error)
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
  const invalid = normalizedFiles.find((file) => file.size > MAX_FILE_SIZE)
  if (invalid) return res.status(413).json({ message: `${invalid.name} 超过 5 GB 限制` })
  assertConfiguredUploadLimits(req, normalizedFiles)
  assertSafeUploadFiles(normalizedFiles)
  const ownerSession = authSessionFromRequest(req)
  let collectionTask = null
  let teamOrganization = null
  if (req.body.mode === 'collection') {
    collectionTask = metadata.collections.find((item) => item.token === String(req.body.collectionToken || ''))
    if (!collectionTask) return res.status(404).json({ message: '收集任务不存在' })
    const access = validateCollection(collectionTask)
    if (!access.ok) return res.status(access.status).json({ message: access.message })
    if (!String(req.body.participantName || '').trim()) return res.status(400).json({ message: '请填写提交人名称' })
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
  const session = {
    id: sessionId,
    files: normalizedFiles,
    options: readShareOptions(req.body, ownerSession?.user),
    mode: req.body.mode === 'collection' ? 'collection' : req.body.mode === 'team_resource' ? 'team_resource' : 'share',
    organizationId: teamOrganization?.id || '',
    collectionToken: collectionTask?.token || '',
    participantName: String(req.body.participantName || '').trim(),
    relativePaths: Array.isArray(req.body.relativePaths) ? req.body.relativePaths : [],
    directory: sessionDirectory,
    createdAt: new Date().toISOString(),
  }
  uploadSessions.set(sessionId, session)
  res.status(201).json({ sessionId, uploaded: session.files.map((file) => ({ name: file.name, chunks: [] })) })
})

app.post('/api/upload-sessions/:sessionId/chunks', upload.single('chunk'), (req, res, next) => {
  try {
    const session = uploadSessions.get(req.params.sessionId)
    if (!session) {
      cleanupUploadedFiles(req.file ? [req.file] : [])
      return res.status(404).json({ message: '上传会话不存在，请重新开始上传' })
    }
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
    const chunksDirectory = path.join(session.directory, String(fileIndex))
    fs.mkdirSync(chunksDirectory, { recursive: true })
    fs.renameSync(req.file.path, path.join(chunksDirectory, `${chunkIndex}.part`))
    file.totalChunks = totalChunks
    file.chunks.add(chunkIndex)
    res.json({ ok: true, fileIndex, chunkIndex, uploadedChunks: file.chunks.size })
  } catch (error) {
    cleanupUploadedFiles(req.file ? [req.file] : [])
    next(error)
  }
})

app.post('/api/upload-sessions/:sessionId/complete', async (req, res, next) => {
  try {
    const session = uploadSessions.get(req.params.sessionId)
    if (!session) return res.status(404).json({ message: '上传会话不存在，请重新开始上传' })
    for (let fileIndex = 0; fileIndex < session.files.length; fileIndex += 1) {
      const file = session.files[fileIndex]
      const expectedChunks = Number(file.totalChunks || Math.max(1, Math.ceil(file.size / Number(req.body.chunkSize || 1))))
      if (file.chunks.size < expectedChunks) {
        return res.status(409).json({ message: `${file.name} 还有分片未上传完成` })
      }
    }

    const mergedFiles = session.files.map((file, fileIndex) => {
      const mergedPath = path.join(session.directory, `${fileIndex}-merged`)
      const output = fs.openSync(mergedPath, 'w')
      const chunksDirectory = path.join(session.directory, String(fileIndex))
      try {
        for (let chunkIndex = 0; chunkIndex < file.totalChunks; chunkIndex += 1) {
          const chunkPath = path.join(chunksDirectory, `${chunkIndex}.part`)
          if (!fs.existsSync(chunkPath)) throw new Error(`${file.name} 分片缺失，请重试上传`)
          fs.writeSync(output, fs.readFileSync(chunkPath))
        }
      } finally {
        fs.closeSync(output)
      }
      if (fs.statSync(mergedPath).size !== file.size) {
        throw httpError(400, `${file.name} 文件大小校验失败，请重新上传`)
      }
      return {
        name: file.name,
        relativePath: file.relativePath,
        size: file.size,
        mimeType: file.mimeType,
        tempPath: mergedPath,
      }
    })
    assertSafeUploadFiles(mergedFiles)
    if (session.mode === 'collection') {
      const task = metadata.collections.find((item) => item.token === session.collectionToken)
      if (!task) return res.status(404).json({ message: '收集任务不存在' })
      const access = validateCollection(task)
      if (!access.ok) return res.status(access.status).json({ message: access.message })
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
        return { name: file.name, relativePath: file.relativePath, storedName: file.storedName, size: file.size, mimeType: file.mimeType, reviewStatus: 'approved' }
      })
      const submission = { id: submissionId, participantName, submittedAt: new Date().toISOString(), files: submissionFiles }
      task.submissions.push(submission)
      addCollectionSubmissionMessage(task, submission, req)
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
    uploadSessions.delete(session.id)
    removeDirectory(session.directory)
    res.status(201).json({ share: publicShare(share, req, true, true) })
  } catch (error) {
    next(error)
  }
})

app.get('/api/shares/lookup/:code', (req, res) => {
  const share = findShareByCode(req.params.code)
  if (!share) return res.status(404).json({ message: '取件码不存在或已失效' })
  const access = validateShare(share, undefined, { allowMissingPassword: true })
  if (!access.ok) return res.status(access.status).json({ message: access.message })
  if (share.passwordHash) return res.json({ share: publicShare(share, req, false), requiresPassword: true })
  res.json({ share: publicShare(share, req, true), requiresPassword: false })
})

app.post('/api/shares/lookup/:code', (req, res) => {
  const share = findShareByCode(req.params.code)
  if (!share) return res.status(404).json({ message: '取件码不存在或已失效' })
  const access = validateShare(share, req.body.password)
  if (!access.ok) return res.status(access.status).json({ message: access.message })
  setShareAccessCookie(res, req, share)
  res.json({ share: publicShare(share, req, true), requiresPassword: false })
})

app.get('/api/shares/token/:token', (req, res) => {
  const share = metadata.shares.find((item) => item.id === req.params.token)
  if (!share) return res.status(404).json({ message: '分享不存在或已失效' })
  if (!validateEnterpriseSlug(share, req.query.organization)) return res.status(404).json({ message: '企业专属链接无效' })
  const access = validateShare(share, undefined, { allowMissingPassword: true })
  if (!access.ok) return res.status(access.status).json({ message: access.message })
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

app.get('/api/shares/:token/files/:fileIndex/download', (req, res, next) => {
  try {
    const share = metadata.shares.find((item) => item.id === req.params.token)
    if (!share) return res.status(404).json({ message: '分享不存在或已失效' })
    enforceDownloadOrigin(req)
    const access = validateShareRequest(share, req, { allowOwner: true })
    if (!access.ok) return res.status(access.status).json({ message: access.message })
    const file = share.files[Number(req.params.fileIndex)]
    if (!file) return res.status(404).json({ message: '文件不存在' })
    registerShareDownload(share, res)
    sendDownloadFile(req, res, next, path.join(filesRoot, share.id, file.storedName), file)
  } catch (error) {
    next(error)
  }
})

app.get('/api/shares/:token/files/:fileIndex/preview', (req, res, next) => {
  try {
    const share = metadata.shares.find((item) => item.id === req.params.token)
    if (!share) return res.status(404).json({ message: '分享不存在或已失效' })
    enforceDownloadOrigin(req)
    const access = validateShareRequest(share, req, { allowOwner: true })
    if (!access.ok) return res.status(access.status).json({ message: access.message })
    const file = share.files[Number(req.params.fileIndex)]
    if (!file) return res.status(404).json({ message: '文件不存在' })
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

app.post('/api/collections/:token/submissions', upload.array('files', MAX_FILES), normalizeUploadedFileNames, (req, res, next) => {
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
    const participantName = String(req.body.participantName || '').trim()
    if (!participantName) {
      cleanupUploadedFiles(req.files)
      return res.status(400).json({ message: '请填写提交人名称' })
    }
    const uploadedFiles = req.files || []
    if (!uploadedFiles.length) {
      return res.status(400).json({ message: '至少选择一个文件' })
    }
    assertConfiguredUploadLimits(req, uploadedFiles)
    assertSafeUploadFiles(uploadedFiles)
    const invalidFile = uploadedFiles.find((file) => file.size > task.maxFileSizeMb * 1024 * 1024 || !isAllowedType(file.originalname, task.allowedTypes))
    if (invalidFile) {
      cleanupUploadedFiles(uploadedFiles)
      return res.status(413).json({ message: `${invalidFile.originalname} 不符合当前收集任务的文件限制` })
    }
    assertAccountCapacity(accountUserById(task.ownerUserId), uploadedFiles.reduce((sum, file) => sum + file.size, 0))
    const submissionId = createToken(12)
    const submissionDirectory = path.join(collectionsRoot, task.id, submissionId)
    fs.mkdirSync(submissionDirectory, { recursive: true })
    const relativePaths = parseJson(req.body.relativePaths, [])
    const files = uploadedFiles.map((file, index) => {
      const relativePath = safeRelativePath(relativePaths[index] || file.originalname)
      const storedName = `${String(index + 1).padStart(2, '0')}-${crypto.randomBytes(4).toString('hex')}-${path.basename(relativePath)}`
      fs.renameSync(file.path, path.join(submissionDirectory, storedName))
      return { name: file.originalname, relativePath, storedName, size: file.size, mimeType: file.mimetype || 'application/octet-stream', reviewStatus: file.reviewStatus || 'approved' }
    })
    const submission = { id: submissionId, participantName, submittedAt: new Date().toISOString(), files }
    task.submissions.push(submission)
    addCollectionSubmissionMessage(task, submission, req)
    persistMetadata()
    res.status(201).json({ submission: publicSubmission(submission) })
  } catch (error) {
    cleanupUploadedFiles(req.files)
    next(error)
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
    const entries = collectionZipEntries(task, submission)
    if (!entries.length) return res.status(404).json({ message: '暂无可下载的提交文件' })
    await streamZip(res, next, `${submission.participantName || '提交文件'}.zip`, entries)
  } catch (error) {
    next(error)
  }
})

app.get('/api/collections/manage/:manageToken/submissions/:submissionId/files/:fileIndex/download', (req, res, next) => {
  try {
    enforceDownloadOrigin(req)
    const task = metadata.collections.find((item) => item.manageToken === req.params.manageToken)
    if (!task) return res.status(404).json({ message: '管理链接不存在' })
    const submission = task.submissions.find((item) => item.id === req.params.submissionId)
    const file = submission?.files[Number(req.params.fileIndex)]
    if (!file) return res.status(404).json({ message: '文件不存在' })
    assertFilesDownloadable([file])
    sendDownloadFile(req, res, next, path.join(collectionsRoot, task.id, submission.id, file.storedName), file)
  } catch (error) {
    next(error)
  }
})

app.get('/api/collections/manage/:manageToken/submissions/:submissionId/files/:fileIndex/preview', (req, res, next) => {
  try {
    enforceDownloadOrigin(req)
    const task = metadata.collections.find((item) => item.manageToken === req.params.manageToken)
    if (!task) return res.status(404).json({ message: '管理链接不存在' })
    const submission = task.submissions.find((item) => item.id === req.params.submissionId)
    const file = submission?.files[Number(req.params.fileIndex)]
    if (!file) return res.status(404).json({ message: '文件不存在' })
    assertFilesDownloadable([file])
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
      if (path.basename(filePath) === 'index.html') {
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
  if (error.status) return res.status(error.status).json({ message: error.message || '请求处理失败' })
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
cleanupExpired()
cleanupUploadSessions()

let shuttingDown = false
async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  clearInterval(cleanupTimer)
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

function loadLocalMetadata() {
  try {
    return JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
  } catch {
    return emptyMetadata()
  }
}

async function loadMetadata() {
  const localMetadata = loadLocalMetadata()
  if (!databasePool) return localMetadata
  if (!databaseHost || !databaseName || !databaseUser) {
    throw new Error('数据库模式已开启，但数据库连接参数不完整')
  }
  await ensureDatabaseStateTable()
  const [rows] = await databasePool.query('SELECT payload FROM kunqiong_app_state WHERE state_key = ? LIMIT 1', ['metadata'])
  if (!rows.length) {
    const normalized = normalizeMetadata(localMetadata)
    await databasePool.execute(
      'INSERT INTO kunqiong_app_state (state_key, schema_version, payload) VALUES (?, ?, ?)',
      ['metadata', 1, JSON.stringify(normalized)],
    )
    console.log('已将本地 metadata.json 迁移到 MySQL')
    return normalized
  }
  try {
    return JSON.parse(rows[0].payload)
  } catch {
    throw new Error('数据库中的鲲穹元数据不是有效 JSON，已停止启动以避免覆盖数据')
  }
}

async function ensureDatabaseStateTable() {
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS kunqiong_app_state (
      state_key VARCHAR(64) NOT NULL PRIMARY KEY,
      schema_version INT NOT NULL DEFAULT 1,
      payload LONGTEXT NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
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
    systemConfig: normalizeSystemConfig(value.systemConfig),
  }
}

function normalizeUpgradeOrders(value = []) {
  if (!Array.isArray(value)) return []
  return value.map((item) => ({
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
  })).filter((item) => item.userId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, MAX_UPGRADE_ORDERS)
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
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8')
  if (!databasePool) return
  const payload = JSON.stringify(metadata)
  metadataWriteQueue = metadataWriteQueue
    .catch(() => {})
    .then(() => databasePool.execute(
      `INSERT INTO kunqiong_app_state (state_key, schema_version, payload)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE schema_version = VALUES(schema_version), payload = VALUES(payload)`,
      ['metadata', 1, payload],
    ))
    .catch((error) => {
      console.error(`MySQL 元数据保存失败：${error.message || error}`)
    })
}

function normalizeSystemConfig(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const defaultShareDays = Number(source.defaultShareDays)
  const maxShareDays = Number(source.maxShareDays)
  const anonymousMaxFileSizeMb = Number(source.anonymousMaxFileSizeMb)
  const maxBatchFiles = Number(source.maxBatchFiles)
  const auditLogRetentionDays = Number(source.auditLogRetentionDays)
  const orphanGraceHours = Number(source.orphanGraceHours)
  return {
    maintenanceMode: Boolean(source.maintenanceMode),
    defaultShareDays: Number.isFinite(defaultShareDays) ? Math.min(365, Math.max(1, Math.floor(defaultShareDays))) : DEFAULT_SYSTEM_CONFIG.defaultShareDays,
    maxShareDays: Number.isFinite(maxShareDays) ? Math.min(365, Math.max(1, Math.floor(maxShareDays))) : DEFAULT_SYSTEM_CONFIG.maxShareDays,
    anonymousMaxFileSizeMb: Number.isFinite(anonymousMaxFileSizeMb) ? Math.min(5120, Math.max(1, Math.floor(anonymousMaxFileSizeMb))) : DEFAULT_SYSTEM_CONFIG.anonymousMaxFileSizeMb,
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
      status: member?.status === 'invited' ? 'invited' : 'active',
      invitationId: trimRecordString(member?.invitationId, 120),
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

function accountEffectivePlanForUser(user = {}) {
  const userId = typeof user === 'string' ? user : user?.id
  const directUser = typeof user === 'string' ? accountUserById(user) || {} : user
  const directPlan = accountPlanForUser(directUser)
  if (directPlan.id !== 'free') return directPlan
  const organization = accountOrganizationForUser(userId)
  if (organization && organization.ownerUserId !== userId) {
    return accountPlanForUser(accountUserById(organization.ownerUserId) || {})
  }
  return directPlan
}

function isAdminUser(user = {}) {
  return Boolean(user?.id && ADMIN_USER_IDS.has(String(user.id)))
}

function requireAdminSession(req, res) {
  const session = authSessionFromRequest(req)
  if (!session) {
    res.status(401).json({ message: '请先登录管理员账号' })
    return null
  }
  if (!isAdminUser(session.user)) {
    res.status(403).json({ message: '当前账号没有后台管理权限' })
    return null
  }
  return session
}

function assertServiceWritable(req) {
  if (!normalizeSystemConfig(metadata.systemConfig).maintenanceMode) return
  if (isAdminUser(authSessionFromRequest(req)?.user)) return
  throw httpError(503, '系统维护中，暂时不能创建或提交文件')
}

function publicOrganization(organization, viewerId = '') {
  if (!organization) return null
  return {
    id: organization.id,
    slug: organization.slug,
    name: organization.name,
    ownerUserId: organization.ownerUserId,
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
    members: organization.members.map((member) => ({
      ...member,
      canRemove: member.userId !== organization.ownerUserId && organization.ownerUserId === viewerId,
    })),
  }
}

function accountOrganizationForUser(userId) {
  const key = String(userId || '')
  if (!key) return null
  return Object.values(metadata.organizations || {}).find((organization) => organization.ownerUserId === key || organization.members.some((member) => member.userId === key)) || null
}

function isOrganizationManager(organization, userId) {
  return organization?.ownerUserId === userId
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

function accountWorkspacePayload(user) {
  const stored = accountUserById(user.id) || user
  const plan = accountEffectivePlanForUser(stored)
  const organization = accountOrganizationForUser(user.id)
  return {
    plan,
    planStartedAt: stored.planStartedAt || null,
    planExpiresAt: plan.permanent ? null : stored.planExpiresAt || null,
    plans: configuredAccountPlans(),
    capacity: accountUsageForUser(user.id),
    organization: publicOrganization(organization, user.id),
    canManage: Boolean(organization && isOrganizationManager(organization, user.id)),
    orders: upgradeOrdersForUser(user.id).slice(0, 10).map(upgradeOrderSummary),
  }
}

function adminUserSummary(user) {
  const plan = accountEffectivePlanForUser(user)
  const usage = accountUsageForUser(user.id)
  const organization = accountOrganizationForUser(user.id)
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
    ownerUserId: item.ownerUserId || '',
    status: kind === 'share' ? currentShareStatus(item) : currentCollectionStatus(item),
    fileCount: files.length,
    totalSize: fileListSize(files),
    createdAt: item.createdAt,
    expiresAt: kind === 'share' ? item.expiresAt : item.deadline,
    reviewStatus: '正常',
  }
}

function findAdminResource(kind, id) {
  const resourceKind = String(kind)
  const resourceId = String(id || '')
  if (resourceKind === 'share') {
    const item = metadata.shares.find((share) => share.id === resourceId || share.manageToken === resourceId)
    return item ? { kind: 'share', id: item.id, item } : null
  }
  if (resourceKind === 'collection') {
    const item = metadata.collections.find((task) => task.id === resourceId || task.token === resourceId || task.manageToken === resourceId)
    return item ? { kind: 'collection', id: item.id || item.token, item } : null
  }
  return null
}

function markResourceReviewStatus(kind, item, status) {
  const files = kind === 'share'
    ? item.files || []
    : (item.submissions || []).flatMap((submission) => submission.files || [])
  for (const file of files) {
    file.reviewStatus = status
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
  return {
    stats: {
      users: users.length,
      activeUsers: users.filter((user) => user.status !== 'disabled').length,
      shares: metadata.shares.length,
      collections: metadata.collections.length,
      files: resources.reduce((sum, item) => sum + item.fileCount, 0),
      totalBytes,
      activeResources: resources.filter((item) => item.status === 'active').length,
      reviewResources: resources.filter((item) => item.reviewStatus === '待审核').length,
      activeOrganizations: Object.keys(metadata.organizations || {}).length,
      pendingCleanup: resources.filter((item) => item.status !== 'active' || (item.expiresAt && new Date(item.expiresAt).getTime() <= Date.now())).length,
    },
    trend,
    users: users.slice(0, 200),
    resources: resources.slice(0, 200),
    auditLogs: normalizeAuditLogs(metadata.auditLogs).slice(0, 100),
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
  for (const entry of safeDirectoryEntries(filesRoot)) {
    const target = path.join(filesRoot, entry)
    if (!validShareIds.has(entry) && fs.statSync(target).mtimeMs < cutoff) {
      removeDirectory(target)
      removed.shares += 1
    }
  }
  for (const entry of safeDirectoryEntries(collectionsRoot)) {
    const target = path.join(collectionsRoot, entry)
    if (!validCollectionIds.has(entry) && fs.statSync(target).mtimeMs < cutoff) {
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

function runMaintenanceCleanup() {
  const before = { shares: metadata.shares.length, collections: metadata.collections.length, auditLogs: metadata.auditLogs.length }
  cleanupExpired()
  const orphaned = cleanupStorageOrphans()
  const retentionMs = normalizeSystemConfig(metadata.systemConfig).auditLogRetentionDays * 86400000
  const cutoff = Date.now() - retentionMs
  metadata.auditLogs = normalizeAuditLogs(metadata.auditLogs).filter((item) => new Date(item.createdAt).getTime() >= cutoff)
  persistMetadata()
  return {
    expiredShares: Math.max(0, before.shares - metadata.shares.length),
    expiredCollections: Math.max(0, before.collections - metadata.collections.length),
    orphaned,
    removedAuditLogs: Math.max(0, before.auditLogs - metadata.auditLogs.length),
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
  const activeSessions = metadata.sessions.filter((session) => new Date(session.expiresAt).getTime() > now)
  if (activeSessions.length !== metadata.sessions.length) {
    metadata.sessions = activeSessions
    changed = true
  }
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
    deliveryRecipients: share.deliveryRecipients || [],
    notificationLog: share.notificationLog || [],
    status,
  }
  if (includeManage) {
    payload.manageToken = share.manageToken
    payload.manageUrl = `${getOrigin(req)}/share/manage/${share.manageToken}`
    payload.canReopen = Boolean(share.ownerUserId && accountEffectivePlanForUser(share.ownerUserId).permanent)
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
  const isOwner = options.allowOwner && viewer?.id && share.ownerUserId && viewer.id === share.ownerUserId
  return validateShare(share, req.get('x-share-password'), {
    ...options,
    skipPassword: isOwner,
    hasAccessCookie: hasShareAccessCookie(req, share),
  })
}

function fileSafetyVerdict(file = {}) {
  return { status: 'approved', message: '' }
}

function assertFilesDownloadable(files = []) {
  return true
}

function assertSafeUploadFiles(files = []) {
  for (const file of files) {
    const verdict = fileSafetyVerdict(file)
    if (verdict.status === 'blocked') {
      recordAuditLog({ type: 'security', action: '拦截高风险文件', targetId: file.originalname || file.name, details: { extension: path.extname(file.originalname || file.name || '').toLowerCase() } })
      throw httpError(415, verdict.message)
    }
    file.reviewStatus = verdict.status
  }
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
  return {
    ...publicUser(stored),
    capacity: accountUsageForUser(stored.id),
    benefits: accountBenefitsForUser(stored),
    plan: accountEffectivePlanForUser(stored),
    isAdmin: isAdminUser(stored),
    organization: publicOrganization(accountOrganizationForUser(stored.id), stored.id),
    notificationSettings: accountNotificationSettingsForUser(stored.id),
  }
}

function normalizeAccountUserStore(value = {}, sessions = []) {
  const store = {}
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const user of Object.values(value)) {
      const normalized = normalizeAccountUser(user)
      if (normalized?.id) store[normalized.id] = mergeAccountUser(store[normalized.id], normalized)
    }
  }
  for (const session of sessions) {
    const normalized = normalizeAccountUser(session.user)
    if (!normalized?.id) continue
    store[normalized.id] = mergeAccountUser(store[normalized.id], normalized)
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
    || (process.env.NODE_ENV === 'test' && testEnterpriseKeys.some((value) => TEST_ENTERPRISE_USER_KEYS.has(value)))
  const planId = testEnterpriseOverride ? 'enterprise' : normalizePlanId(user.planId || base.planId || 'free')
  const plan = configuredAccountPlan(planId)
  const planExpiresAt = plan.permanent ? null : normalizeRecordDate(user.planExpiresAt || base.planExpiresAt)
  if (testEnterpriseOverride || (plan.permanent && (user.planExpiresAt || base.planExpiresAt))) metadataNeedsPersist = true
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
  if (!existing) return normalizeAccountUser(incoming)
  const normalized = normalizeAccountUser(incoming)
  if (!normalized) return existing
  const avatarSourceExplicit = Object.prototype.hasOwnProperty.call(incoming, 'avatarSource')
  const nextProviderAvatar = normalized.providerAvatar || (!normalized.avatarSource && normalized.avatar) || existing.providerAvatar || null
  const nextAvatarSource = normalized.avatarSource === 'custom'
    ? 'custom'
    : avatarSourceExplicit
      ? ''
      : existing.avatarSource || ''
  const nextAvatar = nextAvatarSource === 'custom'
    ? normalized.avatarSource === 'custom'
      ? normalized.avatar || existing.avatar || null
      : existing.avatar || null
    : nextProviderAvatar
  return {
    ...existing,
    ...normalized,
    nickname: normalized.nickname || existing.nickname,
    email: normalized.email || existing.email,
    phone: normalized.phone || existing.phone,
    avatar: nextAvatar,
    avatarSource: nextAvatarSource,
    providerAvatar: nextProviderAvatar,
    provider: normalized.provider || existing.provider,
    loginMethods: mergeLoginMethods(existing.loginMethods, normalized.loginMethods),
    // Do not let a stale upstream free record downgrade a locally confirmed paid plan.
    planId: existing.planId && existing.planId !== 'free' && normalized.planId === 'free'
      ? existing.planId
      : normalized.planId || existing.planId || 'free',
    planStartedAt: normalized.planStartedAt || existing.planStartedAt || null,
    planExpiresAt: normalized.planExpiresAt || existing.planExpiresAt || null,
    organizationId: normalized.organizationId || existing.organizationId,
    organizationRole: normalized.organizationRole || existing.organizationRole,
    status: existing.status === 'disabled' ? 'disabled' : normalized.status || existing.status || 'active',
    fileCleanup: normalized.fileCleanup || existing.fileCleanup || DEFAULT_FILE_CLEANUP_SETTINGS,
    createdAt: existing.createdAt || normalized.createdAt,
    updatedAt: new Date().toISOString(),
  }
}

function upsertAccountUser(user = {}) {
  const normalized = normalizeAccountUser(user)
  if (!normalized?.id) return publicUser(user)
  if (!metadata.users || typeof metadata.users !== 'object' || Array.isArray(metadata.users)) metadata.users = {}
  metadata.users[normalized.id] = mergeAccountUser(metadata.users[normalized.id], normalized)
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
  const index = metadata.verificationCodes.findIndex((item) => item.type === target.type && item.target === target.value && item.scene === scene && item.codeHash === codeHash)
  if (index < 0) throw httpError(400, '验证码不正确或已过期')
  metadata.verificationCodes.splice(index, 1)
  persistMetadata()
}

function accountUsageForUser(userId) {
  const key = accountRecordOwnerKey(userId)
  const user = accountUserById(key) || {}
  const plan = accountEffectivePlanForUser(user)
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
  const plan = accountEffectivePlanForUser(owner)
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
  const plan = accountEffectivePlanForUser(user)
  return [
    { label: '鲲穹登录', detail: '继续使用官方统一登录完成账号认证', enabled: true },
    { label: '跨设备记录', detail: '收发记录和文件中心跟随账号同步', enabled: true },
    { label: '站内消息', detail: '分享、下载和收集动态进入消息中心', enabled: true },
    { label: '账号绑定', detail: '可绑定邮箱或手机号用于消息匹配', enabled: true },
    { label: '账号容量', detail: `${plan.label}提供 ${formatByteSize(plan.totalBytes)} 空间`, enabled: true },
    { label: '永久保存', detail: plan.permanent ? '当前权益支持永久保存分享' : '升级会员后可开启永久保存', enabled: plan.permanent },
    { label: '团队空间', detail: plan.team ? '可创建团队空间并管理成员' : '团队空间需要团队版或企业版', enabled: plan.team },
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
      statusParts.push('短信通道未配置')
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
  return addAccountMessage(task.ownerUserId, {
    category: 'other',
    eventType: 'collectionSubmitted',
    title: '收集任务收到新提交',
    body: `${submission.participantName || '提交者'} 向「${task.title}」提交了 ${submission.files.length} 个文件。`,
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
  return metadata.records[key]
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
  return Array.from(merged.values()).sort(compareAccountRecords).slice(0, MAX_ACCOUNT_RECORDS)
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
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || Number(payload.code) !== 1) {
    throw httpError(response.status >= 400 ? response.status : 502, payload.msg || `会员服务返回 ${response.status}`)
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
  const aliasMatched = packages.find((item) => aliases[planId]?.some((alias) => packageName(item).includes(alias)))
  const durationMatched = planId === 'enterprise'
    ? packages.find((item) => Number(item.days) >= 365 * 1000)
    : planId === 'team'
      ? packages.find((item) => Number(item.days) >= 90 && Number(item.days) < 365 * 1000)
      : packages.find((item) => Number(item.days) >= 30 && Number(item.days) < 90)
  const matched = packages.find((item) => packageName(item).includes(label) || label.includes(packageName(item)))
    || aliasMatched
    || durationMatched
  if (!matched) throw httpError(502, `会员服务中未找到“${planLabel}”套餐，请配置正确的套餐 ID`)
  return { info, package: matched }
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
  await ensurePaymentAssets(order.payment)
  order.updatedAt = new Date().toISOString()
  if (!order.remoteOrderNo) throw httpError(502, '会员服务未返回主站订单号')
  return { ...data, pay_type: order.payType }
}

async function checkWebMemberPaymentStatus(session, remoteOrderNo) {
  return webMemberRequest('/user/check_web_member_order_paystatus', sessionApiWebToken(session), {
    order_no: remoteOrderNo,
  })
}

function activatePaidUpgradeOrder(order, expireAt = null) {
  const account = accountUserById(order.userId)
  if (!account) throw httpError(404, '支付用户不存在')
  const plan = configuredAccountPlan(order.planId)
  const currentExpiry = account.planExpiresAt ? new Date(account.planExpiresAt).getTime() : 0
  const remoteExpiry = expireAt ? new Date(expireAt).getTime() : 0
  const nextExpiry = remoteExpiry > Date.now()
    ? remoteExpiry
    : Date.now() + (Number(order.remotePackageDays) || plan.validityDays || 30) * 86400000
  account.planId = order.planId
  account.planStartedAt = account.planStartedAt || new Date().toISOString()
  account.planExpiresAt = plan.permanent
    ? null
    : new Date(Math.max(currentExpiry, nextExpiry)).toISOString()
  account.updatedAt = new Date().toISOString()
  order.status = 'paid'
  order.paidAt = new Date().toISOString()
  order.remoteExpireAt = plan.permanent
    ? null
    : expireAt || new Date(Math.max(currentExpiry, nextExpiry)).toISOString()
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
  persistMetadata()
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
  const before = metadata.sessions.length
  metadata.sessions = metadata.sessions.filter((session) => session.id !== sessionId)
  if (metadata.sessions.length !== before) persistMetadata()
}

function cleanupExpiredAuthSessions() {
  const now = Date.now()
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
    submittedAt: submission.submittedAt,
    files: submission.files.map(publicFile),
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
        reviewStatus: file.reviewStatus || fileSafetyVerdict(file).status,
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

function readShareOptions(body = {}, user = null) {
  const config = normalizeSystemConfig(metadata.systemConfig)
  const requestedExpiryDays = String(body.expiryDays || config.defaultShareDays)
  const maxShareDays = config.maxShareDays
  if (requestedExpiryDays === '0' && !accountEffectivePlanForUser(user || {}).permanent) {
    throw httpError(403, '永久保存需要会员版或更高权益')
  }
  return {
    expiryDays: requestedExpiryDays === '0' ? '0' : String(Math.min(maxShareDays, Math.max(1, Number(requestedExpiryDays) || config.defaultShareDays))),
    downloadLimit: String(body.downloadLimit || 'unlimited'),
    password: String(body.password || ''),
    codeLength: Number(body.codeLength || 6),
    recipients: parseRecipients(body.recipients),
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
  const wasClosed = currentShareStatus(share) === 'closed'
  if (Object.prototype.hasOwnProperty.call(body, 'expiresAt')) {
    const expiresAt = normalizeExpiryInput(body.expiresAt, '分享有效期')
    const plan = accountEffectivePlanForUser(ownerUser || {})
    const currentExpiresAt = share.expiresAt || null
    if (expiresAt !== currentExpiresAt && !plan.permanent) {
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
      if (wasClosed && !accountEffectivePlanForUser(ownerUser || {}).permanent) {
        throw httpError(403, '重新开启分享需要会员版或更高权益')
      }
      if (share.expiresAt && new Date(share.expiresAt).getTime() <= Date.now()) {
        throw httpError(400, '请先设置未来的截止时间，或选择永久保存')
      }
      if (!share.expiresAt && !accountEffectivePlanForUser(ownerUser || {}).permanent) {
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

function httpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

function parseRecipients(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean)
  return String(value || '')
    .split(/[\n,，;；\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
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

function firstHeader(value) {
  return String(value || '').split(',')[0].trim()
}

function firstValue(value) {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '')
}

function splitConfigValues(value = '') {
  return String(value).split(',').map((item) => item.trim()).filter(Boolean)
}

function parseBooleanEnv(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase())
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function createToken(length) {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length)
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

function hashSecret(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
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

function removeDirectory(directory) {
  try { fs.rmSync(directory, { recursive: true, force: true }) } catch {}
}

function loadEnvFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const index = trimmed.indexOf('=')
      if (index <= 0) continue
      const key = trimmed.slice(0, index).trim()
      let value = trimmed.slice(index + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      if (process.env[key] === undefined) process.env[key] = value
    }
  } catch {}
}
