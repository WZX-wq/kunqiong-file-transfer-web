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
import express from 'express'
import { limitResourceCreation } from './server/lib/resource-rate-limit.js'

import {
  MAX_FILES, collectionsRoot, distRoot, filesRoot, releaseSha,
  serverPort, storageRoot, tempRoot, testEnterpriseForAllUsers, testVerificationDebugMode
} from './server/config.js'

import {
  createToken, firstHeader
} from './server/lib/http.js'

import {
  databasePool, runtime
} from './server/state.js'

import {
  initMetadata, initializeAuditPersistence, installNormalizer, loadMetadata, metadata, metadataIdSets, persistMetadata
} from './server/lib/metadata-store.js'

// normalizeMetadata 的传递依赖闭包已移至 metadata-normalizers.js；
// 它同时是注入给 metadata-store 的规范化函数来源。
import {
  normalizeAuditLog, normalizeMetadata, normalizeSystemConfig
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
  authSessionFromRequest, cleanupExpired, getRequestOrigin, isSmtpConfigured,
  isTencentSmsConfigured, normalizeContactTarget, reconcileActiveUpgradeOrders, recordAuditLog, repairLegacyTestPaidPlans
} from './server/services/account.js'

import { registerAdminRoutes } from './server/routes/admin.js'
import { registerCollectionRoutes } from './server/routes/collections.js'

// 按域拆出的路由模块
import { registerShareCreateRoutes, registerShareAccessRoutes } from './server/routes/shares.js'
import { registerUploadRoutes } from './server/routes/upload.js'

// 分享/上传域业务逻辑（路由仍在本文件注册，按域逐步迁移）
import {
  guestQuotaLimitBytes, guestUsageEntry, listGuestPendingUploads, resolveGuestKey, resolveRecipientUserIds,
  restoreUploadSessions, sweepStaleUploadSessions
} from './server/services/shares.js'
// 后台/身份域
import {
  purgeExpiredAuditLogs
} from './server/services/admin.js'
// 审计工具
import {
  requestIp, sanitizeAuditPath
} from './server/lib/audit.js'

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
initializeAuditPersistence(normalizeAuditLog)
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
repairLegacyTestPaidPlans()
if (runtime.metadataNeedsPersist) persistMetadata()
const app = express()

app.set('trust proxy', true)
app.use(express.json({ limit: '1mb' }))
// 4xx/5xx 的 JSON 错误响应统一附带 x-error-message 头：下载预检走 HEAD（无响应体），
// 前端从该头读取人类可读的错误文案，避免界面出现「下载失败（410）」这类裸状态码。
// 头值只允许 latin1，中文先 encodeURIComponent，前端拿到后 decodeURIComponent。
app.use((_req, res, next) => {
  const originalJson = res.json.bind(res)
  res.json = (payload) => {
    if (res.statusCode >= 400 && payload && typeof payload === 'object' && payload.message) {
      res.setHeader('x-error-message', encodeURIComponent(String(payload.message)))
    }
    return originalJson(payload)
  }
  next()
})
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) {
    res.setHeader('Cache-Control', 'no-store')
  }
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('X-Frame-Options', 'DENY')
  const requestId = createToken(16)
  res.setHeader('X-Request-Id', requestId)
  res.locals.requestId = requestId
  const startedAt = Date.now()
  res.on('finish', () => {
    if (req.path === '/api/health' || (!req.path.startsWith('/api/') && !req.path.startsWith('/auth/'))) return
    try { recordAuditLog({
      type: 'access',
      action: `${req.method} ${sanitizeAuditPath(req.path)}`,
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
      details: { release: releaseSha, requestId, ...(res.statusCode >= 400 ? { errorCode: res.locals.errorCode || `http_${res.statusCode}` } : {}) },
      userId: authSessionFromRequest(req)?.user?.id || '',
      ip: requestIp(req),
    }) } catch (error) {
      // finish runs after response delivery; report storage failures without an uncaught
      // exception taking down the service. Operational logs retain sanitized context.
      console.error(JSON.stringify({ event: 'audit_write_failed', release: releaseSha, requestId, method: req.method, path: sanitizeAuditPath(req.path), status: res.statusCode, code: error.code || 'AUDIT_STORE_FAILED' }))
    }
  })
  next()
})

app.use((req, res, next) => {
  if (!req.path.startsWith('/api/') || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next()
  const origin = firstHeader(req.get('origin'))
  if (firstHeader(req.get('sec-fetch-site')) === 'cross-site') return res.status(403).json({ message: '请求来源不受信任' })
  if (!origin) return next()
  if (origin !== getRequestOrigin(req)) {
    // vite dev(4173) 经代理转发时会改写 Host，导致 Origin 与站点不一致；
    // 与 enforceDownloadOrigin 的本机 dev 白名单同口径放行（仅限开发端口，浏览器无法伪造该 Origin）。
    if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]):4173$/.test(origin)) return next()
    return res.status(403).json({ message: '请求来源不受信任' })
  }
  next()
})

app.use(limitResourceCreation)

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
    return res.json({ enabled: false, limitBytes: 0, usedBytes: 0, remainingBytes: null, reservedBytes: 0, pendingUploads: [] })
  }
  const usedBytes = guestUsageEntry(guestKey).bytes
  // 未完成上传会话的预留单独返回：让前端展示「进行中占用」并支持主动释放，
  // 剩余额度扣除预留，避免「横幅说剩 523MB、上传却报额度不足」的矛盾。
  const pendingUploads = listGuestPendingUploads(guestKey)
  const reservedBytes = pendingUploads.reduce((sum, item) => sum + Number(item.bytes || 0), 0)
  res.json({
    enabled: true,
    limitBytes,
    usedBytes,
    remainingBytes: Math.max(0, limitBytes - usedBytes - reservedBytes),
    reservedBytes,
    pendingUploads,
  })
})
// 按域注册业务路由（顺序即 Express 匹配顺序，不可调整）
registerAccountRoutes(app)
registerWorkspaceRoutes(app)
registerUpgradeRoutes(app)
registerAdminRoutes(app)

// 按域注册业务路由（顺序即 Express 匹配顺序，不可调整）
registerShareCreateRoutes(app)
registerUploadRoutes(app)
registerShareAccessRoutes(app)
registerCollectionRoutes(app)

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

app.use((error, req, res, _next) => {
  const errorCode = /^[a-zA-Z_0-9]+$/.test(String(error.code || '')) ? error.code : 'REQUEST_FAILED'
  res.locals.errorCode = errorCode
  console.error(JSON.stringify({ event: 'request_failed', release: releaseSha, requestId: res.locals.requestId || '', method: req.method, path: sanitizeAuditPath(req.path), code: errorCode }))
  if (error.code === 'ENOSPC' || error.code === 'EDQUOT') return res.status(507).json({ message: '存储空间不足，请清理空间后重试', code: error.code })
  if (error.status) {
    // guestQuota 仅在游客配额超限时存在，前端据此渲染引导弹窗；code 供前端区分业务错误。
    const payload = { message: error.message || '请求处理失败' }
    if (error.code) payload.code = error.code
    if (error.scanLimit) payload.scanLimit = error.scanLimit
    if (error.guestQuota) payload.guestQuota = error.guestQuota
    return res.status(error.status).json(payload)
  }
  if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ message: '文件超过 5 GB 限制' })
  if (error.code === 'LIMIT_FILE_COUNT') return res.status(413).json({ message: `单次最多上传 ${MAX_FILES} 个文件` })
  if (['LIMIT_FIELD_VALUE','LIMIT_FIELD_COUNT','LIMIT_PART_COUNT'].includes(error.code)) return res.status(413).json({message:'上传表单内容过大或字段过多'})
  if (['LIMIT_UNEXPECTED_FILE','LIMIT_FIELD_KEY'].includes(error.code)) return res.status(400).json({message:'上传文件字段或表单字段不正确'})
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

function cleanupUploadSessions() {
  // 委托给 services 层统一清扫：TTL 12h 过期 + 创建后 30min 零进度
  // （零进度会话没有续传价值，却占着容量预留，挡住后续上传）。
  sweepStaleUploadSessions()
}

function qrDataUrlAttachment(value) {
  const match = /^data:image\/png;base64,([a-z0-9+/=]+)$/i.exec(String(value || ''))
  if (!match) return null
  return { filename: 'kunqiong-share-qr.png', content: Buffer.from(match[1], 'base64'), cid: 'kunqiong-share-qr' }
}
