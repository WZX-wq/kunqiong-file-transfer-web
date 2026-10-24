import { personalEntitlements } from './server/services/entitlements.js'
import { allowedOrigins } from './server/lib/request-security.js'
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
  MAX_FILE_SIZE, MAX_FILES, collectionsRoot, distRoot, filesRoot, releaseSha,
  serverHost, serverPort, storageRoot, tempRoot, testEnterpriseForAllUsers, testVerificationDebugMode
} from './server/config.js'

import {
  createToken, firstHeader
} from './server/lib/http.js'

import {
  databasePool, runtime
} from './server/state.js'

import {
  flushAuditPersistence, initMetadata, initializeAuditPersistence, installNormalizer, loadMetadata, metadata, metadataIdSets, persistMetadata
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
  authSessionFromRequest, cleanupExpired, configuredAccountPlans, isSmtpConfigured,
  isTencentSmsConfigured, normalizeContactTarget, reconcileActiveUpgradeOrders, recordAuditLog, repairLegacyTestAdminPlans, repairLegacyTestPaidPlans, restoreAdminPlanRestrictions
} from './server/services/account.js'

import { registerAdminRoutes } from './server/routes/admin.js'
import { registerCollectionRoutes } from './server/routes/collections.js'

// 按域拆出的路由模块
import { registerShareCreateRoutes, registerShareAccessRoutes } from './server/routes/shares.js'
import { registerDistributionRoutes } from './server/routes/distributions.js'
import { registerUploadRoutes } from './server/routes/upload.js'
import { registerSeoRoutes } from './server/routes/seo.js'
import { renderSpaDocument } from './server/services/seo.js'

// 分享/上传域业务逻辑（路由仍在本文件注册，按域逐步迁移）
import {
  guestQuotaLimitBytes, guestUsageEntry, listGuestPendingUploads, resolveGuestKey, resolveRecipientUserIds,
  restoreUploadSessions, sweepStaleUploadSessions
} from './server/services/shares.js'
// 后台/身份域
import {
  purgeExpiredAuditLogs
} from './server/services/admin.js'
import { purgeExpiredTrash } from './server/services/trash.js'
// 审计工具
import {
  requestIp, sanitizeAuditPath
} from './server/lib/audit.js'

// 业务常量（套餐、默认通知/清理设置、默认站内消息）已移至 server/config.js。
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
await initializeAuditPersistence(normalizeAuditLog)
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
repairLegacyTestAdminPlans()
repairLegacyTestPaidPlans()
restoreAdminPlanRestrictions()
if (runtime.metadataNeedsPersist) persistMetadata()
const app = express()

app.set('trust proxy', 'loopback')
app.use(express.json({ limit: '1mb' }))
// 4xx/5xx 的 JSON 错误响应统一附带 x-error-message 头：下载预检走 HEAD（无响应体），
// 前端从该头读取人类可读的错误文案，避免界面出现「下载失败（410）」这类裸状态码。
// 头值只允许 latin1，中文先 encodeURIComponent，前端拿到后 decodeURIComponent。
app.use((_req, res, next) => {
  const originalJson = res.json.bind(res)
  res.json = (payload) => {
    if (databasePool && res.statusCode < 400) {
      Promise.all([runtime.metadataWriteQueue, flushAuditPersistence()]).then(() => {
        if (res.destroyed) return
        if (runtime.persistenceError) return originalJsonAfterError()
        originalJson(payload)
      }).catch(originalJsonAfterError)
      return res
    }
    return sendJson(payload)
  }
  const originalJsonAfterError = () => {
    res.status(503)
    return sendJson({ message:'数据保存失败，服务暂不可写，请联系管理员', code:'METADATA_WRITE_FAILED' })
  }
  const originalRedirect = res.redirect.bind(res)
  res.redirect = (...args) => {
    if (!databasePool || res.headersSent) return originalRedirect(...args)
    Promise.all([runtime.metadataWriteQueue, flushAuditPersistence()]).then(() => {
      if (res.headersSent) return
      if (runtime.persistenceError) return originalJsonAfterError()
      originalRedirect(...args)
    }).catch(originalJsonAfterError)
    return res
  }
  const sendJson = (payload) => {
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
  if (runtime.persistenceError && req.path.startsWith('/api/') && req.path !== '/api/health') return next(runtime.persistenceError)
  if (!req.path.startsWith('/api/') || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next()
  const origin = firstHeader(req.get('origin'))
  if (firstHeader(req.get('sec-fetch-site')) === 'cross-site') return res.status(403).json({ message: '请求来源不受信任' })
  if (!origin) return next()
  if (!allowedOrigins(req).has(origin)) return res.status(403).json({ message: '请求来源不受信任' })
  next()
})

app.use(limitResourceCreation)

app.get('/api/health', (_req, res) => {
  res.json({
    ok: !runtime.persistenceError,
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

app.get('/api/runtime-config', (req, res) => {
  res.set('Cache-Control', 'no-store')
  const config = normalizeSystemConfig(metadata.systemConfig)
  res.json({
    upload: personalEntitlements(authSessionFromRequest(req)?.user?.id),
    maxSupportedFileSizeBytes: Math.min(MAX_FILE_SIZE, Math.max(config.anonymousMaxFileSizeMb * 1024 ** 2, ...configuredAccountPlans().map(plan => plan.singleFileLimitBytes))),
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
registerDistributionRoutes(app)
registerShareAccessRoutes(app)
registerCollectionRoutes(app)

app.use('/api', (_req, res) => {
  res.status(404).json({ message: '接口不存在' })
})

// SEO 路由必须在静态托管之前注册：public/ 里没有同名文件，靠路由动态生成。
registerSeoRoutes(app)

// dist 重建窗口（vite build 的 emptyOutDir）里 index.html 会短暂缺失，
// 此时返回可自愈的提示页，而不是把 ENOENT 交给错误处理变成 404 JSON。
const UPDATING_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>正在更新版本 · 鲲穹文件传输</title>
</head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f4f7fc;color:#172a45;font-family:-apple-system,'Segoe UI','Microsoft YaHei',sans-serif">
<div style="max-width:400px;padding:34px 30px;text-align:center">
<h1 style="margin:0 0 10px;font-size:18px;font-weight:700">正在更新版本</h1>
<p style="margin:0 0 20px;color:#63788f;font-size:13px;line-height:1.8">页面资源正在刷新，通常几秒后恢复。稍等片刻再刷新本页即可。</p>
<button onclick="location.reload()" style="padding:9px 24px;color:#fff;background:#1f6bff;border:0;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">刷新页面</button>
</div>
</body>
</html>`

if (fs.existsSync(distRoot)) {
  app.use(express.static(distRoot, {
    // index:false —— 否则 express.static 会直接吐出未注入 head 的 index.html，绕过下面的路由注入。
    index: false,
    maxAge: '7d',
    immutable: true,
    setHeaders(res, filePath) {
      // HTML 入口（index.html、user-manual.html 等）不缓存，发版后立即生效；其余静态资源 7 天强缓存
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache')
      }
    },
  }))
  app.get('*', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-cache')
    // 按路由注入 title / description / canonical / OG / JSON-LD —— SPA 唯一的 SEO 出口。
    const html = renderSpaDocument(distRoot, req)
    if (html) return res.type('html').send(html)
    // 注入失败（dist 未构建或 index.html 的 SEO 标记被改动）时退回原行为，页面照常渲染。
    res.sendFile(path.join(distRoot, 'index.html'), (error) => {
      if (!error) return
      if (res.headersSent) return res.end()
      // 发布窗口兜底：vite build 会先清空 dist，此时 index.html 短暂不存在。
      // 不要让它冒泡成 404 JSON（浏览器里就是整页白底报错），给一个可自愈的提示页。
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
        return res.status(503).set('Cache-Control', 'no-store').set('Retry-After', '5').type('html').send(UPDATING_HTML)
      }
      return next(error)
    })
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
    if (error.scanFile) payload.scanFile = error.scanFile
    if (error.scanFinding) payload.scanFinding = error.scanFinding
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
  purgeExpiredTrash()
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
purgeExpiredTrash()
cleanupUploadSessions()

let shuttingDown = false
async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  clearInterval(cleanupTimer)
  clearInterval(paymentTimer)
  clearTimeout(initialPaymentCheck)
  clearInterval(auditLogTimer)
  const deadline = setTimeout(() => {
    console.error('服务关闭等待超时，已停止进程')
    server.closeAllConnections?.()
    process.exit(1)
  }, 30000)
  deadline.unref()
  try {
    await new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections?.() })
    await runtime.metadataWriteQueue
    await flushAuditPersistence()
    if (databasePool) await databasePool.end()
    if (runtime.persistenceError) throw runtime.persistenceError
    clearTimeout(deadline)
    process.exit(0)
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

