// 环境配置与路径常量
// 本文件由 scripts/refactor/extract-config.mjs 从 server.mjs 逐字抽取生成。
// 原则：业务常量与环境变量表达式均原样搬运，仅追加 export 前缀，未改写任何逻辑。
// 唯一结构性调整：路径常量中的 __dirname 改为 projectRoot（本文件位于 server/ 子目录）。
import fs from 'node:fs'
import path from 'node:path'
import { loadEnvFile } from './lib/env-file.js'

export const projectRoot = path.resolve(import.meta.dirname, '..')

loadEnvFile(path.join(projectRoot, '.env'))

// ── 路径 ──
export const storageRoot = path.join(projectRoot, 'storage')
export const tempRoot = path.join(storageRoot, 'tmp')
export const filesRoot = path.join(storageRoot, 'files')
export const collectionsRoot = path.join(storageRoot, 'collections')
export const distRoot = path.join(projectRoot, 'dist')
export const metadataPath = path.join(storageRoot, 'metadata.json')
export const shareEmailTemplatePath = path.join(projectRoot, 'email-templates', 'share-notification.html')

export function splitConfigValues(value = '') {
  return String(value).split(',').map((item) => item.trim()).filter(Boolean)
}

export function parseBooleanEnv(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase())
}

// ── 上传与限流 ──
export const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024
export const MAX_FILES = 100
export const TEAM_NAME_MAX = 80
export const TEAM_QUERY_MAX = 160
export const EXPIRING_SOON_MS = 24 * 60 * 60 * 1000

export const UPLOAD_CHUNK_MIN_BYTES = 1 * 1024 * 1024
export const UPLOAD_CHUNK_MAX_BYTES = 16 * 1024 * 1024
export const UPLOAD_CHUNK_DEFAULT_BYTES = 8 * 1024 * 1024

// ── 业务常量：套餐与默认项 ──
// 元数据层（规范化）与业务层（路由、后台）都要用，放在配置层避免互相 import。

export const ACCOUNT_PLANS = {
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

export const ACCOUNT_PLAN_RANK = { free: 0, member: 1, team: 2, enterprise: 3 }

export const DEFAULT_NOTIFICATION_SETTINGS = {
  inApp: true,
  email: false,
  incomingShare: true,
  shareExpiring: true,
  shareDownloaded: true,
  collectionExpiring: true,
  collectionSubmitted: true,
}

export const DEFAULT_FILE_CLEANUP_SETTINGS = {
  enabled: false,
  days: 3,
}

export const DEFAULT_ACCOUNT_MESSAGES = [
  { id: 'system-welcome', category: 'system', eventType: 'welcome', title: '欢迎使用鲲穹文件传输', body: '你的账户已连接，可以开始发送和收集文件。' },
  { id: 'official-update', category: 'official', eventType: 'official', title: '鲲穹服务通知', body: '站内消息、账号容量和账号绑定已接入当前账户。' },
]

// ── 元数据默认值 ──
// 元数据层与业务层都要用（emptyMetadata 造初始快照、normalizeSystemConfig 兜底），
// 放在配置层避免两边互相 import。
export const DEFAULT_SYSTEM_CONFIG = {
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

// ── OAuth 与应用地址 ──
export const serverPort = Number(process.env.PORT || process.env.KUNQIONG_PORT || 8045)
export const oauthAuthorizeUrl = process.env.KUNQIONG_OAUTH_AUTHORIZE_URL || 'https://login.kunqiongai.com/authorize.html'
export const oauthTokenUrl = process.env.KUNQIONG_OAUTH_TOKEN_URL || 'https://login.kunqiongai.com/api/oauth/token'
export const oauthClientId = process.env.KUNQIONG_OAUTH_CLIENT_ID || ''
export const oauthClientSecret = process.env.KUNQIONG_OAUTH_CLIENT_SECRET || process.env.OAUTH_CLIENT_SECRET || ''
export const configuredCallbackUrls = splitConfigValues(process.env.KUNQIONG_AUTH_CALLBACK_URL)
export const configuredAppUrl = process.env.KUNQIONG_APP_URL || ''
export const releaseSha = String(process.env.KUNQIONG_RELEASE_SHA || '').trim()

// ── SMTP ──
export const smtpHost = String(process.env.KUNQIONG_SMTP_HOST || '').trim()
export const smtpPort = Number(process.env.KUNQIONG_SMTP_PORT || 465)
export const smtpSecure = parseBooleanEnv(process.env.KUNQIONG_SMTP_SECURE, smtpPort === 465)
export const smtpUser = String(process.env.KUNQIONG_SMTP_USER || '').trim()
export const smtpPassword = String(process.env.KUNQIONG_SMTP_PASSWORD || '')
export const smtpFrom = String(process.env.KUNQIONG_SMTP_FROM || smtpUser).trim()
export const smtpFromName = String(process.env.KUNQIONG_SMTP_FROM_NAME || '鲲穹文件传输').trim()

// ── 腾讯云短信 ──
export const tencentSmsSecretId = String(process.env.KUNQIONG_TENCENT_SECRET_ID || '').trim()
export const tencentSmsSecretKey = String(process.env.KUNQIONG_TENCENT_SECRET_KEY || '')
export const tencentSmsSdkAppId = String(process.env.KUNQIONG_TENCENT_SMS_SDK_APP_ID || '').trim()
export const tencentSmsSignName = String(process.env.KUNQIONG_TENCENT_SMS_SIGN_NAME || '').trim()
export const tencentSmsBindTemplateId = String(process.env.KUNQIONG_TENCENT_SMS_TEMPLATE_BIND_CODE_ID || '').trim()
export const tencentSmsRegion = String(process.env.KUNQIONG_TENCENT_SMS_REGION || 'ap-guangzhou').trim()

// ── 主站会员支付 ──
export const webMemberApiBase = String(process.env.KUNQIONG_WEB_MEMBER_API_BASE || 'https://api-web.kunqiongai.com').replace(/\/+$/, '')
export const webMemberSubsiteName = String(process.env.KUNQIONG_WEB_MEMBER_SUBSITE_NAME || configuredAppUrl || 'kunqiong-send').trim()

export const WEB_MEMBER_PACKAGE_ENV_KEYS = {
  member: 'KUNQIONG_WEB_MEMBER_PACKAGE_MEMBER_ID',
  team: 'KUNQIONG_WEB_MEMBER_PACKAGE_TEAM_ID',
  enterprise: 'KUNQIONG_WEB_MEMBER_PACKAGE_ENTERPRISE_ID',
}
// These are the currently enabled package IDs returned by the member service.
// Deployments can override them through the environment variables above.

export const DEFAULT_WEB_MEMBER_PACKAGE_IDS = {
  member: 1,
  team: 2,
  enterprise: 5,
}

// ── Cookie 与会话 ──
export const AUTH_COOKIE_NAME = 'kunqiong_session'
export const SHARE_ACCESS_COOKIE_PREFIX = 'kunqiong_share_access_'
export const SHARE_ACCESS_TTL_SECONDS = 15 * 60
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000
export const UPLOAD_SESSION_TTL_MS = 12 * 60 * 60 * 1000
// 创建后长期零进度（一个分片都没传成功）的会话没有续传价值，提前回收，
// 避免其容量预留以「进行中占用」挡住后续上传。
export const UPLOAD_SESSION_ZERO_PROGRESS_TTL_MS = 30 * 60 * 1000
// 分片直写模式：会话级分片大小固定，服务端按 chunkIndex*chunkSize 定位写入，
// complete 阶段零合并（旧实现 readSync/writeSync 同步合并会阻塞整个事件循环）。

// ── 账号侧数量限制 ──
export const MAX_ACCOUNT_RECORDS = 200
export const MAX_ACCOUNT_MESSAGES = 120
export const MAX_RECORD_FILES = 120
export const MAX_RECORD_SUBMISSIONS = 80
export const VERIFICATION_CODE_TTL_MS = 10 * 60 * 1000
export const MAX_VERIFICATION_CODES = 120
export const ACCOUNT_SINGLE_FILE_BYTES = MAX_FILE_SIZE
export const ACCOUNT_RECORD_SCOPES = new Set(['my_sent', 'sent_to_me', 'my_collections', 'collect_from_me'])
export const ACCOUNT_RECORD_KINDS = new Set(['share', 'collection'])
export const ACCOUNT_MESSAGE_CATEGORIES = new Set(['system', 'official', 'other'])

// ── 收集任务字段长度上限 ──
// 与前端 maxLength 保持一致；服务端超长直接拒绝（明确报错，不做静默截断）。
// 超长文本会把收集页骨架（预览卡、管理页头部、公开提交页）撑变形，必须两端同时设限。
export const COLLECTION_TITLE_MAX = 40
export const COLLECTION_DESCRIPTION_MAX = 120

// ── 管理员认证 ──
export const ADMIN_USER_IDS = new Set(splitConfigValues(process.env.KUNQIONG_ADMIN_USER_IDS))
export const ADMIN_ACCOUNT_USERNAME = String(process.env.KUNQIONG_ADMIN_USERNAME || '').trim()
export const ADMIN_ACCOUNT_PASSWORD = String(process.env.KUNQIONG_ADMIN_PASSWORD || '')

export const adminCredentialsConfigured = Boolean(ADMIN_ACCOUNT_USERNAME && ADMIN_ACCOUNT_PASSWORD.trim())
if (!adminCredentialsConfigured) console.warn('[admin] 管理员凭据未配置，后台密码登录已禁用。')

// ── 文件安全扫描（fail-closed）──
export const scanMode = String(process.env.KUNQIONG_SCAN_MODE || 'required').toLowerCase()
if (!['required', 'optional'].includes(scanMode)) throw new Error('KUNQIONG_SCAN_MODE 必须是 required 或 optional')
export const clamavHost = String(process.env.KUNQIONG_CLAMAV_HOST || '').trim()
export const clamavPort = Number(process.env.KUNQIONG_CLAMAV_PORT || 3310)
// Allow stream transfer in addition to clamd's 10-minute processing budget.
export const scanTimeoutMs = Math.max(1000, Number(process.env.KUNQIONG_SCAN_TIMEOUT_MS) || 900000)
// Bound concurrent scanner jobs across all upload entry points.
export const scanConcurrency = Math.max(1, Math.min(8, Math.floor(Number(process.env.KUNQIONG_SCAN_CONCURRENCY) || 3)))
export const scanLargeConcurrency = Math.min(scanConcurrency, Math.max(1, Math.min(4, Math.floor(Number(process.env.KUNQIONG_SCAN_LARGE_CONCURRENCY) || 2))))
export const scanLargeFileBytes = 128 * 1024 * 1024

// ── 后台会话与限流 ──
export const ADMIN_COOKIE_NAME = 'kunqiong_admin_session'
export const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000
export const ADMIN_LOGIN_MAX_ATTEMPTS = 8
export const ADMIN_LOGIN_WINDOW_MS = 10 * 60 * 1000

export const JOIN_REQUEST_MAX_PER_WINDOW = 5
export const JOIN_REQUEST_WINDOW_MS = 60 * 60 * 1000
// 被拒绝后的重新申请冷却，避免持续骚扰团队所有者。
export const JOIN_REQUEST_REJECT_COOLDOWN_MS = 24 * 60 * 60 * 1000

// ── 测试环境开关 ──
export const TEST_ENTERPRISE_USER_KEYS = new Set(splitConfigValues(process.env.KUNQIONG_TEST_ENTERPRISE_USER_KEYS || process.env.KUNQIONG_TEST_ENTERPRISE_USER_IDS).map((value) => value.toLowerCase()))
export const testEnterpriseForAllUsers = process.env.NODE_ENV === 'test'
  && parseBooleanEnv(process.env.KUNQIONG_TEST_ENTERPRISE_ALL, false)
// 测试服权益白名单模式：仅 KUNQIONG_TEST_ENTERPRISE_USER_KEYS 内的账号为高等级权益，其余强制基础版。
export const testEnforceEnterpriseAllowlist = process.env.NODE_ENV === 'test'
  && parseBooleanEnv(process.env.KUNQIONG_TEST_ENFORCE_ENTERPRISE_ALLOWLIST, true)
export const testVerificationDebugMode = process.env.NODE_ENV === 'test'

// ── 收集任务文件类型（键为中文分类名，改动会影响收集白名单）──
export const COLLECTION_TYPE_OPTIONS = ['全部格式', '图片', '文档', '视频', '音频', '压缩包', '代码文件', '其他']
export const COLLECTION_TYPE_EXTENSIONS = {
  图片: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.heic', '.heif', '.ico'],
  文档: ['.pdf', '.doc', '.docx', '.txt', '.rtf', '.xls', '.xlsx', '.csv', '.ppt', '.pptx', '.md'],
  视频: ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.ogv', '.flv', '.wmv'],
  音频: ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.oga', '.ogg', '.wma'],
  压缩包: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz'],
  代码文件: ['.js', '.jsx', '.ts', '.tsx', '.html', '.css', '.json', '.xml', '.yml', '.yaml', '.java', '.py', '.go', '.php', '.rb', '.rs', '.c', '.cpp', '.h', '.cs', '.sh', '.ps1', '.bat', '.cmd', '.sql'],
}
export const UPGRADE_ORDER_STATUSES = new Set(['pending_payment', 'paid', 'canceled', 'expired'])

export const MAX_UPGRADE_ORDERS = 500
// 支付单创建后，后台最多保留 24 小时的主站查单凭证。它不是登录会话，
// 仅用于核对未完成订单，完成、过期或主站拒绝后立即删除。
export const PAYMENT_QUERY_RETENTION_MS = 24 * 60 * 60 * 1000
export const MAX_AUDIT_LOGS = 5000

// ── 游客配额 ──
// 条目数设上限防止 metadata 无限膨胀（超限淘汰最久未活跃的条目）。
export const GUEST_ID_COOKIE = 'kq_guest_id'
export const GUEST_ID_MAX_AGE_SECONDS = 365 * 24 * 3600
export const MAX_GUEST_USAGE_ENTRIES = 20000

// ── 数据库 ──
// 元数据快照的并发写保护：写入走 revision CAS，冲突后重读远端合并再重试。
// 重试上限用于兜住持续的写竞争，超过后放弃本次落盘并告警，由下一次业务写入重试。
export const MAX_METADATA_WRITE_ATTEMPTS = 5
export const databaseEnabled = parseBooleanEnv(process.env.KUNQIONG_DB_ENABLED, false)
export const databaseHost = String(process.env.KUNQIONG_DB_HOST || '').trim()
export const databasePort = Number(process.env.KUNQIONG_DB_PORT || 3306)
export const databaseName = String(process.env.KUNQIONG_DB_NAME || '').trim()
export const databaseUser = String(process.env.KUNQIONG_DB_USER || '').trim()
export const databasePassword = String(process.env.KUNQIONG_DB_PASSWORD || '')

// 注意：连接池不在这里创建。
// config 层只读取配置值、不持有运行期资源 —— 池由 server/state.js 创建并持有。
// 历史上这里曾有一份 databasePool，但引用了一个未定义的 databasePassword，
// 导致 KUNQIONG_DB_ENABLED=true 时本模块 import 即抛 ReferenceError。已移除。

for (const directory of [storageRoot, tempRoot, filesRoot, collectionsRoot]) {
  fs.mkdirSync(directory, { recursive: true })
}
