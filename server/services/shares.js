// 分享 / 上传会话域业务逻辑
//
// 覆盖：上传会话生命周期（创建/分片/查询/完成）、游客配额、文件落盘与扫描、
//       分享创建/查询/管理/下载/预览、打包下载、分享邮件与站内通知。
//
// 依赖方向（单向）：本模块只依赖 config / state / lib / services/account.js，
// 不 import server.mjs，也不 import routes。
//
// 说明：上传与分享两个子簇**互相引用**（实测 6 条双向边，例如
// assertUploadCapacity → assertCollectionFiles / collectionCapacityBytes，
// 而 collectionCapacityBytes → guestQuotaLimitBytes），故不拆为两个模块。
// 其中 assertCollectionFiles / publicSubmission 等属于收集域，后续收集域拆分时
// 由收集模块从本模块 import（单向）。

import {
  ADMIN_COOKIE_NAME, ADMIN_USER_IDS, COLLECTION_TYPE_EXTENSIONS, COLLECTION_TYPE_OPTIONS,
  GUEST_ID_COOKIE, GUEST_ID_MAX_AGE_SECONDS, SHARE_ACCESS_COOKIE_PREFIX,
  SHARE_ACCESS_TTL_SECONDS, UPLOAD_CHUNK_DEFAULT_BYTES, UPLOAD_CHUNK_MAX_BYTES,
  UPLOAD_CHUNK_MIN_BYTES, UPLOAD_SESSION_TTL_MS, UPLOAD_SESSION_ZERO_PROGRESS_TTL_MS,
  clamavHost, clamavPort, configuredAppUrl, configuredCallbackUrls,
  filesRoot, scanMode, scanTimeoutMs, shareEmailTemplatePath, smtpFrom, smtpFromName, tempRoot
} from '../config.js'

import {
  createToken, escapeHtml, hashSecret, httpError, parseRecipients, removeDirectory
} from '../lib/http.js'

import {
  normalizeEmailValue, normalizePhoneValue, normalizeSystemConfig, trimRecordString
} from '../lib/metadata-normalizers.js'

import {
  metadata, persistMetadata
} from '../lib/metadata-store.js'

import {
  accountEffectivePlanForUser, accountNotificationSettingsForUser, accountOrganizationForUser,
  accountPlanForUser, accountTeamUsageForOrganization, accountUsageForUser, accountUserById,
  addAccountMessage, authSessionFromRequest, currentCollectionStatus, currentShareStatus,
  displayAccountName, fileListSize, formatByteSize, getEmailTransporter, getOrigin,
  getRequestOrigin, isOrganizationManager, isSecureRequest, isSmtpConfigured, mailErrorReason, normalizeContactTarget,
  publicFile, readCookie, recordAuditLog, safeRelativePath,
  serializeCookie, validateShareRecipient
} from '../services/account.js'

import { normalizeUploadFileName } from '../lib/upload.js'

import {
  adminSessions, reservedShareCodes, shareLookupAttempts, uploadReservations, uploadSessions
} from '../state.js'

import { booleanInput, dateInput, integerInput, objectInput, textInput } from '../lib/input-validation.js'
import fs from 'node:fs'
import path from 'node:path'
import { contactMatchesUser, recipientInputError } from '../lib/contact-input.js'
import crypto from 'node:crypto'
import net from 'node:net'
import { once } from 'node:events'

import archiver from 'archiver'
import QRCode from 'qrcode'

export function requireUploadSessionOwner(req, res, next) {
  const session = uploadSessions.get(req.params.sessionId)
  if (!session) return res.status(404).json({ message: '上传会话不存在，请重新开始上传' })
  const created = new Date(session.createdAt).getTime()
  if (!Number.isFinite(created) || Date.now() - created >= UPLOAD_SESSION_TTL_MS) {
    discardUploadSession(session)
    return res.status(410).json({ message: '上传会话已过期，请重新开始上传' })
  }
  const userId = authSessionFromRequest(req)?.user?.id
  const taskOwner = session.mode === 'collection' && userId && metadata.collections.some((task) => task.token === session.collectionToken && task.ownerUserId === userId)
  if (!taskOwner && session.ownerUserId && userId !== session.ownerUserId) {
    return res.status(403).json({ message: '请使用创建上传的账号继续操作' })
  }
  if (!taskOwner && session.ownerGuestId && readCookie(req, GUEST_ID_COOKIE) !== session.ownerGuestId) {
    return res.status(403).json({ message: '请使用创建上传的浏览器继续操作' })
  }
  if (session.organizationId) {
    const organization = metadata.organizations?.[session.organizationId]
    if (!organization) return res.status(404).json({ message: '团队空间不存在' })
    if (!organization.members.some(member => member.userId === userId && member.status === 'active')) return res.status(403).json({ message: '团队成员权限已失效，无法继续上传' })
  }
  req.uploadSession = session
  next()
}

// 会话级分片大小：客户端在创建会话时声明，服务端收敛到 [1MB, 16MB]，
// 未携带（旧客户端）回落默认 8MB —— 与旧版前端固定分片值保持一致。
export function normalizeUploadChunkSize(value) {
  const size = Math.round(Number(value))
  if (!Number.isFinite(size) || size <= 0) return UPLOAD_CHUNK_DEFAULT_BYTES
  return Math.min(UPLOAD_CHUNK_MAX_BYTES, Math.max(UPLOAD_CHUNK_MIN_BYTES, size))
}

// 会话清单落盘：重启后可从 session.json + {fileIndex}/{chunkIndex}.done 标记恢复
// 续传状态（uploadSessions 是内存 Map，重启即失；清单让 12h TTL 真正跨重启生效）。
export function persistUploadSession(session) {
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
      ownerGuestId: session.ownerGuestId || '',
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

export function restoreUploadSessions() {
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
        // A paused session may not have uploaded its first chunk yet.
        if (file.chunks.size && !fs.existsSync(targetPath)) broken = true
      })
      if (broken) {
        removeDirectory(directory)
        continue
      }
      // 已过期会话不再恢复进内存：恢复只会让清扫器每分钟对它发起一次删除，
      // 目录残余时反复产生无效 IO/日志。过期口径与 sweepStaleUploadSessions 一致：
      // 超过 12h TTL，或零进度且超过 30min。
      const createdAt = new Date(raw.createdAt).getTime()
      const age = Number.isFinite(createdAt) ? Date.now() - createdAt : 0
      const hasProgress = session.files.some((file) => file.chunks.size > 0)
      if (age > UPLOAD_SESSION_TTL_MS || (!hasProgress && age > UPLOAD_SESSION_ZERO_PROGRESS_TTL_MS)) {
        removeDirectory(directory)
        continue
      }
      uploadSessions.set(session.id, session)
    } catch {
      removeDirectory(directory)
    }
  }
}

// 取件码查询限流：取件码空间小（最短 4 位），不限流可被枚举。
// 与后台登录同理，不能用 XFF 做键（trust proxy=true 可伪造），用真实 socket 地址 + 全局兜底。
const SHARE_LOOKUP_WINDOW_MS = 10 * 60 * 1000
const SHARE_LOOKUP_MAX_PER_WINDOW = 30
const SHARE_LOOKUP_GLOBAL_MAX = 300

export function shareLookupRateLimited(req) {
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

export function isAdminUser(user = {}) {
  return Boolean(user?.id && ADMIN_USER_IDS.has(String(user.id)))
}

// —— 后台管理员会话（账号密码登录，独立于鲲穹 OAuth 会话）——
export function cleanupExpiredAdminSessions() {
  const now = Date.now()
  for (const [token, session] of adminSessions.entries()) {
    if (session.expiresAt <= now) adminSessions.delete(token)
  }
}

export function adminSessionFromRequest(req) {
  cleanupExpiredAdminSessions()
  const token = readCookie(req, ADMIN_COOKIE_NAME)
  if (!token) return null
  return adminSessions.get(token) || null
}

export function assertServiceWritable(req) {
  if (!normalizeSystemConfig(metadata.systemConfig).maintenanceMode) return
  // 维护模式豁免：管理员口令会话（后台登录后的同一个浏览器）与白名单鲲穹账号都放行。
  // 只认白名单会导致「管理员从后台登录后反而不能传文件」——口令会话必须一并豁免。
  if (adminSessionFromRequest(req)) return
  if (isAdminUser(authSessionFromRequest(req)?.user)) return
  throw httpError(503, '系统维护中，暂时不能创建或提交文件')
}

export function enterpriseOrganizationForUser(userId) {
  const organization = accountOrganizationForUser(userId)
  if (!organization || !accountEffectivePlanForUser(organization.ownerUserId).team) return null
  return organization
}

export function resourceEnterpriseOrganization(item) {
  if (!item?.teamResource) return item?.ownerUserId ? enterpriseOrganizationForUser(item.ownerUserId) : null
  const organization = metadata.organizations?.[item.teamOrganizationId]
  return organization && accountEffectivePlanForUser(organization.ownerUserId).team ? organization : null
}

export function validateTeamShareManager(share, req) {
  if (!share.teamResource) return { ok: true }
  const viewer = authSessionFromRequest(req)?.user
  const organization = metadata.organizations[share.teamOrganizationId]
  if (!organization) return { ok: false, status: 404, message: '团队资源所属团队已不存在' }
  if (!viewer) return { ok: false, status: 401, message: '请先登录团队成员账号' }
  if (!organization.members.some(member => member.userId === viewer.id && member.status === 'active')) return { ok: false, status: 403, message: '当前账号不是该团队的有效成员' }
  if (viewer.id !== share.ownerUserId && !isOrganizationManager(organization, viewer.id)) return { ok: false, status: 403, message: '仅资源上传者或团队管理者可以管理该团队资源' }
  return { ok: true }
}

export function publicShare(share, req, includeFiles = true, includeManage = false) {
  const organization = resourceEnterpriseOrganization(share)
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

export function validateEnterpriseSlug(item, slug) {
  if (!slug) return true
  const organization = resourceEnterpriseOrganization(item)
  return Boolean(organization && organization.slug === String(slug))
}

export function validateShareRequest(share, req, options = {}) {
  const viewer = authSessionFromRequest(req)?.user
  const manager = share.teamResource && options.allowOwner && validateTeamShareManager(share, req).ok
  const recipientAccess = validateShareRecipient(share, viewer)
  if (!recipientAccess.ok && !manager) return recipientAccess
  assertFilesDownloadable(share.files)
  const isOwner = manager || (options.allowOwner && viewer?.id && share.ownerUserId && viewer.id === share.ownerUserId)
  // 团队资源：关闭分享只应切断公开提取链接，文件本体仍在团队空间。
  // 所有者本人登录后始终可以打开自己的资源 —— 否则所有者关闭分享后连自己也打不开文件。
  if (isOwner && share.teamResource && currentShareStatus(share) === 'closed') return { ok: true }
  // 免密码跳过仅限团队资源：普通分享的所有者访问公开提取链接时与访客同权，
  // 必须输入提取密码 —— 否则所有者自己测试密码分享时，输任何密码都会被放行，
  // 既无法验证访客视角的密码防护，也构成「密码形同虚设」的安全观感问题。
  return validateShare(share, options.password ?? req.get('x-share-password'), {
    ...options,
    skipPassword: Boolean(isOwner && share.teamResource),
    hasAccessCookie: hasShareAccessCookie(req, share),
  })
}

export function assertFilesDownloadable(files = []) {
  if (files.some((file) => file.reviewStatus === 'blocked')) throw httpError(415, '文件安全检查未通过，无法下载或预览')
  return true
}

function scanError(status, message, code) {
  return Object.assign(httpError(status, message), { code })
}

function scanResultError(result) {
  const limit = result.match(/Heuristics\.Limits\.Exceeded\.([A-Za-z0-9]+)/)?.[1]
  if (limit || /INSTREAM size limit exceeded/i.test(result)) {
    const messages = {
      MaxFileSize: '文件或压缩包内的文件超过安全扫描上限（约 2 GB），请拆分文件后再上传',
      MaxScanSize: '压缩包解压后的总量超过安全扫描上限，请分成多个较小的压缩包再上传',
      MaxScanTime: '文件安全扫描超过处理时间，请联系管理员调整扫描时间后重试安全检查',
      MaxRecursion: '压缩包嵌套层数超过安全扫描上限，请减少嵌套后再上传',
      MaxFiles: '压缩包内的文件数量超过安全扫描上限，请分成多个压缩包再上传',
      StreamMaxLength: '文件超过扫描服务的接收上限，请联系管理员调整配置后重试安全检查',
    }
    const kind = limit || 'StreamMaxLength'
    const error = scanError(kind === 'MaxScanTime' ? 503 : 415, messages[kind] || '文件超过安全扫描处理限制，请联系管理员检查扫描配置', kind === 'MaxScanTime' ? 'scan_timeout' : 'scan_size_limit')
    if (Object.hasOwn(messages, kind)) error.scanLimit = kind
    return error
  }
  if (/ FOUND$/.test(result)) return scanError(415, '文件扫描发现威胁，已阻止发布', 'scan_threat_detected')
  return scanError(503, '文件安全扫描未完成，请稍后重试安全检查', 'scan_incomplete')
}

export async function scanFileBytes(filePath) {
  if (!clamavHost) {
    if (scanMode === 'required') throw scanError(503, '文件扫描服务未配置，暂时无法发布或读取未扫描文件', 'scan_unavailable')
    return { reviewStatus: 'unscanned', scanEngine: null, scannedAt: null }
  }
  const socket = net.createConnection({ host: clamavHost, port: clamavPort })
  let source
  let response = ''
  let timer
  const verdict = new Promise((resolve, reject) => {
    const fail = (error) => { source?.destroy(); socket.destroy(); reject(error) }
    timer = setTimeout(() => fail(scanError(503, '文件安全扫描超时，请稍后重试安全检查', 'scan_timeout')), scanTimeoutMs)
    socket.on('error', () => fail(scanError(503, '文件扫描服务连接失败，请稍后重试安全检查', 'scan_unavailable')))
    socket.on('end', () => { if (!response.includes('\0')) fail(scanError(503, '文件扫描服务未返回完整结果，请重试安全检查', 'scan_incomplete')) })
    socket.on('close', () => { if (!response.includes('\0')) fail(scanError(503, '文件扫描连接已关闭，请重试安全检查', 'scan_incomplete')) })
    socket.on('data', (data) => {
      response += data.toString('utf8')
      if (response.length > 4096) return fail(scanError(503, '文件扫描结果无效', 'scan_incomplete'))
      if (!response.includes('\0')) return
      const result = response.split('\0')[0].trim()
      if (/^stream: OK$/.test(result)) resolve({ reviewStatus: 'approved', scanEngine: 'clamav', scannedAt: new Date().toISOString() })
      else reject(scanResultError(result))
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

export async function assertSafeUploadFiles(files = []) {
  for (const file of files) {
    try {
      Object.assign(file, await scanFileBytes(file.tempPath || file.path))
    } catch (error) {
      if (error.code === 'scan_threat_detected') {
        file.reviewStatus = 'blocked'
        recordAuditLog({ type: 'security', action: '文件扫描拦截', targetId: file.originalname || file.name })
      }
      throw error
    }
  }
}

export async function ensureStoredFilesScanned(files, directory) {
  assertFilesDownloadable(files)
  for (const file of files) {
    if (file.reviewStatus === 'approved' && file.scanEngine === 'clamav' && file.scannedAt) continue
    const targetPath = path.join(directory, file.storedName)
    if (!fs.existsSync(targetPath)) throw httpError(410, '文件已清理，无法读取')
    try { Object.assign(file, await scanFileBytes(targetPath)) }
    catch (error) { if (error.code === 'scan_threat_detected') file.reviewStatus = 'blocked'; persistMetadata(); throw error }
  }
  persistMetadata()
}

export function assertConfiguredUploadLimits(req, files = []) {
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
export function resolveGuestKey(req, res) {
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

export function issueGuestCookie(req, res) {
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

export function guestQuotaLimitBytes(config = metadata.systemConfig) {
  const mb = Number(normalizeSystemConfig(config).anonymousTotalSizeMb)
  if (!Number.isFinite(mb) || mb <= 0) return 0
  return Math.floor(mb) * 1024 * 1024
}

export function guestUsageEntry(key) {
  const entry = key ? metadata.guestUsage?.[key] : null
  return entry && typeof entry === 'object' ? entry : { bytes: 0, uploads: 0 }
}

export function formatBytesLabel(bytes = 0) {
  const value = Math.max(0, Number(bytes) || 0)
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(value % 1024 ** 3 ? 1 : 0)} GB`
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(value % 1024 ** 2 ? 1 : 0)} MB`
  return `${Math.round(value / 1024)} KB`
}

export function guestQuotaExceededError({ usedBytes, limitBytes, incomingBytes, reservedBytes = 0 }) {
  // reservedBytes = 同一游客其他未完成上传会话的预留。单独展示，
  // 否则「已用」把预留混进去，会和顶部横幅的已计账用量对不上。
  const remaining = Math.max(0, limitBytes - usedBytes - reservedBytes)
  const reservedLabel = reservedBytes > 0 ? `，另有进行中上传占用 ${formatBytesLabel(reservedBytes)}` : ''
  const error = httpError(413, `未登录累计可传输 ${formatBytesLabel(limitBytes)}（本设备已用 ${formatBytesLabel(usedBytes)}${reservedLabel}，剩余 ${formatBytesLabel(remaining)}，本次还需 ${formatBytesLabel(incomingBytes)}）。免费注册后即可获得 20 GB 个人空间，继续传输不受此限制`)
  error.code = 'guest_quota_exceeded'
  error.guestQuota = { usedBytes, limitBytes, incomingBytes, remainingBytes: remaining, reservedBytes }
  return error
}

// 上传前预校验：返回本请求对应的游客 key（成功后用于计账），登录用户返回 ''。
export function assertGuestQuota(req, res, files = []) {
  const limitBytes = guestQuotaLimitBytes()
  if (!limitBytes) return ''
  const key = resolveGuestKey(req, res)
  if (!key) return ''
  const usedBytes = guestUsageEntry(key).bytes
  const incomingBytes = files.reduce((sum, file) => sum + Number(file.size || 0), 0)
  if (usedBytes + incomingBytes > limitBytes) throw guestQuotaExceededError({ usedBytes, limitBytes, incomingBytes })
  return key
}

export function addGuestUsage(key, files = []) {
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

export function enforceDownloadOrigin(req) {
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

export function setShareAccessCookie(res, req, share) {
  if (!share.passwordHash) return
  res.setHeader('Set-Cookie', serializeCookie(shareAccessCookieName(share), shareAccessCookieValue(share), {
    httpOnly: true,
    maxAge: SHARE_ACCESS_TTL_SECONDS,
    path: `/api/shares/${share.id}`,
    sameSite: 'Lax',
    secure: isSecureRequest(req),
  }))
}

export function hasShareAccessCookie(req, share) {
  if (!share.passwordHash) return false
  return readCookie(req, shareAccessCookieName(share)) === shareAccessCookieValue(share)
}

export function shareAccessCookieName(share) {
  return `${SHARE_ACCESS_COOKIE_PREFIX}${share.id}`
}

export function shareAccessCookieValue(share) {
  return hashSecret(`share-preview:${share.id}:${share.passwordHash}`)
}

const pendingDownloads = new WeakMap()
export function registerShareDownload(share, res) {
  if (res.req.method === 'HEAD') return
  const pending = pendingDownloads.get(share) || 0
  if (share.downloadLimit && share.downloadCount + pending >= share.downloadLimit) throw httpError(410,'下载次数已用完')
  pendingDownloads.set(share, pending + 1)
  let settled = false
  const release = () => {
    if (settled) return false
    settled = true
    pendingDownloads.set(share, Math.max(0,(pendingDownloads.get(share) || 0)-1))
    return true
  }
  res.on('finish', () => {
    if (!release() || res.statusCode < 200 || res.statusCode >= 300) return
    share.downloadCount += 1
    share.updatedAt = new Date().toISOString()
    addShareDownloadedMessage(share)
    persistMetadata()
  })
  res.on('close', release)
}

export function sendPreviewFile(req, res, next, filePath, file) {
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
  // 仅已通过权限、扫描和存在性检查的 PDF 允许本站嵌入；错误页继续使用 DENY。
  if (kind === 'pdf') res.setHeader('X-Frame-Options', 'SAMEORIGIN')
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
  let end = match[1] === '' || match[2] === '' ? stat.size - 1 : Number(match[2])
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= stat.size) {
    res.setHeader('Content-Range', `bytes */${stat.size}`)
    return res.status(416).end()
  }
  end = Math.min(end, stat.size - 1)
  res.status(206)
  res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`)
  res.setHeader('Content-Length', String(end - start + 1))
  fs.createReadStream(filePath, { start, end }).on('error', next).pipe(res)
}

export function sendDownloadFile(req, res, next, filePath, file) {
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
  let end = match[1] === '' || match[2] === '' ? stat.size - 1 : Number(match[2])
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= stat.size) {
    res.setHeader('Content-Range', `bytes */${stat.size}`)
    return res.status(416).end()
  }
  end = Math.min(end, stat.size - 1)
  res.status(206)
  res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`)
  res.setHeader('Content-Length', String(end - start + 1))
  fs.createReadStream(filePath, { start, end }).on('error', next).pipe(res)
}

export async function streamZip(res, next, filename, entries) {
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

export function zipEntryPath(...parts) {
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

export function previewKind(file = {}) {
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

export function fileContentType(file = {}) {
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

export function contentDisposition(type, filename) {
  const fallback = String(filename || 'preview')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '')
    .trim() || 'preview'
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(String(filename || fallback))}`
}

export function assertTeamCapacity(organization, incomingBytes) {
  const usage = accountTeamUsageForOrganization(organization)
  if (!usage.totalBytes) throw httpError(403, '当前团队套餐没有配置团队空间')
  if (usage.usedBytes + Number(incomingBytes || 0) > usage.totalBytes) {
    throw httpError(507, `团队空间不足，剩余 ${formatByteSize(usage.remainingBytes)}`)
  }
}

export function assertUniqueTeamResourceNames(organization, files) {
  const resourcePath = (file) => safeRelativePath(normalizeUploadFileName(file.relativePath || file.name || '')).trim().toLowerCase()
  const existingNames = new Set(
    metadata.shares
      .filter((share) => share.teamResource && share.teamOrganizationId === organization?.id)
      .flatMap((share) => share.files || [])
      .map(resourcePath)
      .filter(Boolean),
  )
  const incomingNames = new Set()
  for (const file of files || []) {
    const name = normalizeUploadFileName(file.name || '').trim()
    const normalized = resourcePath(file)
    if (!normalized || existingNames.has(normalized) || incomingNames.has(normalized)) {
      throw httpError(409, `团队空间中已存在相同路径的文件“${file.relativePath || name || '未命名文件'}”`)
    }
    incomingNames.add(normalized)
  }
}

export function collectionCapacityBytes(task) {
  if (task.ownerUserId) return accountUsageForUser(task.ownerUserId).totalBytes
  const configured = guestQuotaLimitBytes() || 1024 * 1024 * 1024
  return Math.min(Number(task.capacityBytes) > 0 ? Number(task.capacityBytes) : configured, configured)
}

export function assertCollectionFiles(task, files) {
  if (files.some((file) => file.size > task.maxFileSizeMb * 1024 * 1024 || !isAllowedType(file.originalname || file.name, task.allowedTypes))) {
    throw httpError(413, '文件不符合当前收集任务的大小或格式限制')
  }
}

export function pendingUploadBytes(predicate, excludeId) {
  let bytes = 0
  for (const [id, item] of [...uploadSessions, ...uploadReservations]) {
    if (id !== excludeId && predicate(item)) bytes += fileListSize(item.files)
  }
  return bytes
}

// 主动放弃上传会话：从内存移除并清理临时分片，立即释放其预留额度。
// 客户端在「重置/重新选择文件/放弃续传开新会话」时调用，防止僵尸会话占满游客配额。
export function discardUploadSession(session) {
  if (!session) return
  uploadSessions.delete(session.id)
  removeDirectory(session.directory)
}

// 上传会话文件清单指纹：同一游客重复上传相同文件时，用于识别「该被替换的旧会话」。
export function uploadSessionSignature(files = []) {
  return files
    .map((file) => `${file.relativePath || file.name}|${file.name}|${file.size}`)
    .sort()
    .join('\n')
}

// 游客名下未完成上传会话明细：供配额接口展示「进行中占用」，让用户可见、可主动释放。
export function listGuestPendingUploads(guestKey) {
  const sessions = []
  for (const [, item] of uploadSessions) {
    if (item.guestKey === guestKey) {
      sessions.push({ id: item.id, bytes: fileListSize(item.files), createdAt: item.createdAt })
    }
  }
  return sessions.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
}

// 上传会话定时清扫：TTL 过期的会话、以及创建后长期零进度（一个分片都没传成功）的
// 会话。零进度会话没有续传价值，却占着容量预留，是「看不见的占用」的主要来源。
export function sweepStaleUploadSessions(now = Date.now()) {
  const swept = []
  for (const [, item] of [...uploadSessions]) {
    const createdAt = new Date(item.createdAt).getTime()
    const age = Number.isFinite(createdAt) ? now - createdAt : 0
    const hasProgress = item.files.some((file) => file.chunks instanceof Set && file.chunks.size > 0)
    const expired = age > UPLOAD_SESSION_TTL_MS
    const idleZeroProgress = !hasProgress && age > UPLOAD_SESSION_ZERO_PROGRESS_TTL_MS
    if (expired || idleZeroProgress) {
      discardUploadSession(item)
      swept.push(item.id)
    }
  }
  return swept
}

export function assertUploadCapacity(item, excludeId) {
  const incomingBytes = fileListSize(item.files)
  if (item.guestKey && guestQuotaLimitBytes()) {
    const usedBytes = guestUsageEntry(item.guestKey).bytes
    const reservedBytes = pendingUploadBytes((other) => other.guestKey === item.guestKey, excludeId)
    if (usedBytes + reservedBytes + incomingBytes > guestQuotaLimitBytes()) {
      throw guestQuotaExceededError({ usedBytes, reservedBytes, limitBytes: guestQuotaLimitBytes(), incomingBytes })
    }
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

export function reserveUploadCapacity(item) {
  assertUploadCapacity(item)
  const id = createToken(18)
  uploadReservations.set(id, item)
  return id
}

export function assertAccountCapacity(user, incomingBytes) {
  if (!user?.id) return
  const usage = accountUsageForUser(user.id)
  if (usage.usedBytes + Number(incomingBytes || 0) > usage.totalBytes) {
    throw httpError(507, `账号容量不足，当前${accountPlanForUser(user).label}剩余 ${formatByteSize(usage.remainingBytes)}`)
  }
}

export function shouldDeliverAccountEmail(userId, eventType) {
  const settings = accountNotificationSettingsForUser(userId)
  if (!settings.email) return false
  return !eventType || !Object.prototype.hasOwnProperty.call(settings, eventType) || settings[eventType] !== false
}

export function resolveRecipientUserIds(recipients = [], legacy = false) {
  const ids = new Set()
  for (const recipient of recipients) {
    const contact = normalizeContactTarget(recipient)
    const raw = String(recipient).trim().toLowerCase()
    const matches = Object.values(metadata.users || {}).filter((user) => contact
      ? contactMatchesUser(contact, user)
      : [user.id, user.username].some((value) => String(value || '').toLowerCase() === raw))
    if (!contact && matches.length !== 1 && !legacy) throw httpError(400, '指定账号不存在或不唯一，请使用账号 ID、邮箱或手机号')
    for (const user of matches) ids.add(user.id)
  }
  return [...ids]
}

export function findUsersByRecipient(recipient) {
  // 展示昵称不能参与寻址，通知对象与资源授权使用相同的账号/联系方式解析。
  return resolveRecipientUserIds([recipient], true).map(accountUserById).filter(Boolean)
}

function uniqueRecipients(recipients) {
  const targets = new Map()
  for (const recipient of recipients) {
    const ids = resolveRecipientUserIds([recipient]).sort()
    const contact = normalizeContactTarget(recipient)
    const key = ids.length ? 'users:' + JSON.stringify(ids) : 'contact:' + (contact?.value || recipient.toLowerCase())
    // 同一账号填写邮箱和账号 ID 时保留邮箱入口，同时只发送一次站内通知。
    if (!targets.has(key) || contact?.type === 'email') targets.set(key, recipient)
  }
  return [...targets.values()]
}

export async function notifyShareRecipients(share, req, ownerUser = null) {
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

export async function sendShareEmail({ recipient, share, req, ownerName, title }) {
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

export function buildShareEmailHtml({ share, shareUrl, ownerName, title, expiryText, hasQr }) {
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

export function addShareDownloadedMessage(share) {
  if (!share.ownerUserId) return null
  return addAccountMessage(share.ownerUserId, {
    category: 'system',
    eventType: 'shareDownloaded',
    title: '你发送的文件已被下载',
    body: `${share.files?.[0]?.name || '文件分享'} 已产生第 ${share.downloadCount} 次下载。`,
    actionUrl: `/share/manage/${share.manageToken}`,
  })
}

export function addCollectionSubmissionMessage(task, submission, req) {
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

export function publicSubmission(submission) {
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

export function publicSubmissionSubmitter(submission = {}) {
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
export function resolveCollectionSubmitter(req) {
  const session = authSessionFromRequest(req)
  const user = session?.user?.id ? accountUserById(session.user.id) : null
  if (!user) {
    return { submitterUserId: '', submitterName: '', participantName: textInput(req.body?.participantName ?? '', '提交人名称', 40, { optional:true }) }
  }
  const name = displayAccountName(user)
  return {
    submitterUserId: String(user.id || ''),
    submitterName: name,
    // 登录用户不再采信客户端传的名称，统一记为账号显示名 —— 否则统计口径会被前端参数带偏。
    participantName: name,
  }
}

export async function createShareFromTempFiles(tempFiles, options, req) {
  let reservedCode = ''
  try {
    // 耗时准备在提交之前完成；此后直到元数据提交不再 await，撤权可立即阻止发布。
    const shareToken = createToken(10)
    const shareUrl = `${getOrigin(req)}/share/${shareToken}`
    const qrDataUrl = await QRCode.toDataURL(shareUrl, { width: 180, margin: 1 })
    const ownerSession = authSessionFromRequest(req)
    // 断点恢复期间可能更换绑定，发布时仍需以当前用户资料校验收件人。
    const recipientError = recipientInputError(options.recipients, accountUserById(ownerSession?.user?.id) || ownerSession?.user)
    if (recipientError) throw httpError(400, recipientError)
    const totalSize = tempFiles.reduce((sum, file) => sum + Number(file.size || 0), 0)
    if (options.teamResource) {
      const organization = Object.values(metadata.organizations || {}).find((item) => item.id === options.teamOrganizationId)
      if (!organization) throw httpError(404, '团队空间不存在')
      if (!organization.members.some(member => member.userId === ownerSession?.user?.id && member.status === 'active')) throw httpError(403, '团队成员权限已失效，无法提交资源')
      assertUniqueTeamResourceNames(organization, tempFiles)
      assertTeamCapacity(organization, totalSize)
    } else {
      assertAccountCapacity(ownerSession?.user, totalSize)
    }
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
    share.qrDataUrl = qrDataUrl
    metadata.shares.push(share)
    reservedShareCodes.delete(reservedCode)
    persistMetadata()
    share.notificationLog = await notifyShareRecipients(share, req, ownerSession?.user)
    if (metadata.shares.includes(share)) persistMetadata()
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
export function readShareOptions(body = {}, user = null, isTeamResource = false) {
  const config = normalizeSystemConfig(metadata.systemConfig)
  const rawRecipients = body.recipients ?? ''
  const rawRecipientError = recipientInputError(rawRecipients, accountUserById(user?.id) || user)
  if (rawRecipientError) throw httpError(400, rawRecipientError)
  const recipients = uniqueRecipients(parseRecipients(rawRecipients))
  if (recipients.length && !user?.id) throw httpError(401, '定向发送需要先登录')
  const recipientError = recipientInputError(recipients, accountUserById(user?.id) || user)
  if (recipientError) throw httpError(400, recipientError)
  const recipientUserIds = resolveRecipientUserIds(recipients)
  if (user?.id && recipientUserIds.includes(user.id)) throw httpError(400, '定向发送不能填写自己的手机号、邮箱或账号')
  // 兼容数字 0：'0'/'0'（永久）是合法值，不能被 || 吞掉回落默认天数。
  const rawExpiryDays = body.expiryDays === undefined || body.expiryDays === '' ? config.defaultShareDays : body.expiryDays
  integerInput(rawExpiryDays,'保存天数',0,config.maxShareDays)
  if (body.codeLength !== undefined) integerInput(body.codeLength,'取件码长度',4,6)
  const checkedDownloadLimit = normalizeDownloadLimit(body.downloadLimit)
  const password = sharePasswordInput(body.password)
  const requestedExpiryDays = String(rawExpiryDays === 0 || rawExpiryDays === '0' ? '0' : (rawExpiryDays || config.defaultShareDays))
  const maxShareDays = config.maxShareDays
  if (requestedExpiryDays === '0' && !isTeamResource && !accountEffectivePlanForUser(user || {}).permanent) {
    throw httpError(403, '永久保存需要会员版或更高权益')
  }
  return {
    expiryDays: requestedExpiryDays === '0' ? '0' : String(Math.min(maxShareDays, Math.max(1, Number(requestedExpiryDays) || config.defaultShareDays))),
    downloadLimit: checkedDownloadLimit === null ? 'unlimited' : String(checkedDownloadLimit),
    password,
    codeLength: Number(body.codeLength || 6),
    // 收件人上限：防止一次创建触发海量外发邮件（邮件放大/发信域名被封）。
    recipients,
    recipientUserIds,
    recipientContacts: recipients.filter((recipient) => normalizeContactTarget(recipient) && !resolveRecipientUserIds([recipient], true).length),
    teamResource: Boolean(isTeamResource),
  }
}

export function normalizeDownloadLimit(value) {
  if (value === 'unlimited' || value === null || value === undefined) return null
  return integerInput(value,'下载次数',1,9999)
}
export function sharePasswordInput(value) {
  if (value === undefined || value === '') return ''
  return textInput(value,'提取密码',128)
}

export function findShareByManageToken(manageToken) {
  return metadata.shares.find((share) => share.manageToken === String(manageToken || ''))
}

export function applyShareUpdate(share, body = {}, ownerUser = null) {
  objectInput(body, ['expiresAt','downloadLimit','clearPassword','password','status'], { nonempty:true })
  if (Object.hasOwn(body,'clearPassword')) booleanInput(body.clearPassword,'清除密码')
  if (Object.hasOwn(body,'password')) sharePasswordInput(body.password)
  const draft = structuredClone(share)
  applyShareUpdateDraft(draft, body, ownerUser)
  Object.assign(share, draft)
}
function applyShareUpdateDraft(share, body = {}, ownerUser = null) {
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
    share.passwordHash = hashSecret(sharePasswordInput(body.password))
  }
  if (Object.prototype.hasOwnProperty.call(body, 'status')) {
    const status = textInput(body.status, '分享状态', 20)
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

export function normalizeExpiryInput(value, label) {
  if (value === null || value === 'permanent' || value === 'unlimited') return null
  dateInput(value, label)
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number)
    return new Date(year, month - 1, day, 23, 59, 59, 999).toISOString()
  }
  return dateInput(value, label)
}

export function findShareByCode(code) {
  return metadata.shares.find((share) => share.code.toLowerCase() === String(code).trim().toLowerCase())
}

export function validateShare(share, password, { allowMissingPassword = false, hasAccessCookie = false, skipPassword = false } = {}) {
  const status = currentShareStatus(share)
  if (status === 'closed') return { ok: false, status: 410, message: '分享已关闭' }
  if (status === 'expired') {
    return { ok: false, status: 410, message: '分享已过期' }
  }
  if (share.downloadLimit && share.downloadCount >= share.downloadLimit) {
    return { ok: false, status: 410, message: '下载次数已用完' }
  }
  if (skipPassword) return { ok: true }
  // access cookie 只应放行「未主动提供密码」的请求（记住已解锁的分享）；
  // 一旦请求带了密码，就必须校验密码本身，否则输错密码也能凭 cookie 蒙混过关。
  if (hasAccessCookie && share.passwordHash && !password) return { ok: true }
  if (allowMissingPassword && share.passwordHash && !password) return { ok: true }
  if (share.passwordHash && hashSecret(password || '') !== share.passwordHash) {
    return { ok: false, status: password ? 401 : 403, message: password ? '提取密码不正确' : '请输入提取密码' }
  }
  return { ok: true }
}

export function validateCollection(task) {
  const status = currentCollectionStatus(task)
  if (status === 'closed') return { ok: false, status: 410, message: '收集任务已关闭' }
  if (status === 'expired') {
    return { ok: false, status: 410, message: '收集任务已截止' }
  }
  return { ok: true }
}

export function createCode(requestedLength = 4) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const length = Math.min(6, Math.max(4, Number(requestedLength) || 6))
  let code = ''
  do {
    code = Array.from({ length }, () => alphabet[crypto.randomInt(alphabet.length)]).join('')
  } while (metadata.shares.some((share) => share.code === code) || reservedShareCodes.has(code))
  reservedShareCodes.add(code)
  return code
}

export function normalizeCollectionAllowedTypes(types) {
  const allowed = Array.isArray(types) ? types.map(String).filter((type) => COLLECTION_TYPE_OPTIONS.includes(type)) : []
  if (!allowed.length || allowed.includes('全部格式')) return ['全部格式']
  return Array.from(new Set(allowed))
}
export function collectionTypesInput(types) {
  if (!Array.isArray(types) || !types.length || types.length > COLLECTION_TYPE_OPTIONS.length || types.some(type => typeof type !== 'string' || !COLLECTION_TYPE_OPTIONS.includes(type))) throw httpError(400,'请选择有效的文件类型')
  return normalizeCollectionAllowedTypes(types)
}

export function isAllowedType(filename, allowedTypes) {
  const allowed = normalizeCollectionAllowedTypes(allowedTypes)
  if (allowed.includes('全部格式')) return true
  const extension = path.extname(filename).toLowerCase()
  const matchedType = Object.entries(COLLECTION_TYPE_EXTENSIONS).find(([, extensions]) => extensions.includes(extension))?.[0] || '其他'
  return allowed.includes(matchedType)
}

export function cleanupUploadedFiles(files = []) {
  for (const file of files) {
    // 异步清理（不阻塞请求）：受限文件系统上删除操作可能同步阻塞数百毫秒，
    // 而临时文件清理失败无需让请求方感知（残留文件由后续清理兜底）。
    try { fs.unlink(file.path, () => {}) } catch {}
  }
}
