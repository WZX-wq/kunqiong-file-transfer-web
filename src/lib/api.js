import { resumeDigest } from './resume-digest.js'
// 由 main.jsx 抽取的工具函数（2026-10-09）
// 纯函数，零 React/组件依赖。

export function createUploadState() {
  return {
    status: 'idle',
    phase: '',
    progress: 0,
    uploadedBytes: 0,
    totalBytes: 0,
    speedBps: 0,
    etaSeconds: null,
    currentFile: '',
    retryCount: 0,
    error: '',
  }
}

export function createUploadSessionState() {
  return {
    sessionId: '',
    fileIndex: 0,
    chunkIndex: 0,
    chunkSize: 0,
    uploadedBytes: 0,
    // The transport can retry a chunk after the browser has already displayed
    // part of it. Keep the visual position monotonic for this upload session;
    // uploadedBytes remains the server-acknowledged byte count.
    displayedBytes: 0,
    totalBytes: 0,
    startedAt: 0,
    paused: false,
    cancelled: false,
    abortCurrent: null,
    activeXhrs: new Set(),
  }
}

// 分片大小选择：会话创建时确定，服务端按同一配置定位写入。
// 弱网/省流量 → 2MB 减少单片失败代价；大批量 → 16MB 减少请求数；默认 8MB。
export function pickUploadChunkSize(files) {
  const totalBytes = files.reduce((sum, item) => sum + item.size, 0)
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || {}
  if (connection.saveData || ['slow-2g', '2g', '3g'].includes(connection.effectiveType)) return 2 * 1024 * 1024
  if (totalBytes >= 512 * 1024 * 1024) return 16 * 1024 * 1024
  return 8 * 1024 * 1024
}

// 分片 SHA-256：非 secure context（http 局域网地址）下 crypto.subtle 不存在，跳过校验降级传输。
export async function sha256Hex(buffer) {
  if (!globalThis.crypto?.subtle) return ''
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function uploadResumeSignature(files, chunkSize, uploadConfig, shareOptions) {
  return JSON.stringify({
    chunkSize,
    files: files.map((item) => ({ name: item.name, size: item.size, relativePath: item.relativePath || '', mimeType: item.file?.type || item.mimeType || '' })),
    version: 2,
    optionsHash: resumeDigest(JSON.stringify(shareOptions)),
    mode: uploadConfig.sessionBody || {},
  })
}

export function currentSpeed(session, loadedBytes) {
  const elapsedSeconds = Math.max((Date.now() - (session.speedStartedAt || session.startedAt)) / 1000, 0.3)
  return Math.max(0, loadedBytes - (session.speedStartBytes || 0)) / elapsedSeconds
}

// 上传暂停/取消时的专用错误类型：xhrUploadChunk 与 transfer.js 的上传循环共用。
export class UploadPausedError extends Error {
  constructor() {
    super('上传已暂停')
    this.name = 'UploadPausedError'
  }
}

export class UploadCancelledError extends Error {
  constructor() {
    super('上传已取消')
    this.name = 'UploadCancelledError'
  }
}

export function xhrUploadChunk(url, { fileIndex, chunkIndex, totalChunks, chunkData, chunkHash, filename }, { uploadRef, onProgress }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const uploadState = uploadRef.current
    const body = new FormData()
    body.append('fileIndex', String(fileIndex))
    body.append('chunkIndex', String(chunkIndex))
    body.append('totalChunks', String(totalChunks))
    body.append('chunk', new Blob([chunkData], { type: 'application/octet-stream' }), filename)
    if (chunkHash) body.append('chunkHash', chunkHash)
    const activeXhrs = uploadState.activeXhrs || new Set()
    uploadState.activeXhrs = activeXhrs
    activeXhrs.add(xhr)
    uploadState.abortCurrent = () => activeXhrs.forEach((request) => request.abort())
    let settled = false
    const cleanup = () => {
      settled = true
      activeXhrs.delete(xhr)
      if (!activeXhrs.size) uploadState.abortCurrent = null
    }
    xhr.open('POST', url)
    xhr.upload.onprogress = (event) => {
      if (settled || uploadState.paused || uploadState.cancelled || !event.lengthComputable) return
      // XHR measures the multipart request, including its fields and boundaries.
      // Convert its ratio to file bytes so tiny chunks never exceed their size.
      const ratio = event.total > 0 ? event.loaded / event.total : event.loaded / Math.max(chunkData.byteLength, 1)
      onProgress(Math.round(chunkData.byteLength * Math.max(0, Math.min(1, ratio))))
    }
    xhr.onload = () => {
      cleanup()
      let data = {}
      try { data = JSON.parse(xhr.responseText || '{}') } catch { data = {} }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data)
      else {
        const error = new Error(data.message || '分片上传失败')
        error.status = xhr.status
        error.code = data.code || ''
        error.guestQuota = data.guestQuota || null
        reject(error)
      }
    }
    xhr.onerror = () => {
      cleanup()
      reject(new Error('网络连接失败，请确认鲲穹服务已启动'))
    }
    xhr.onabort = () => {
      cleanup()
      reject(uploadState.cancelled ? new UploadCancelledError() : uploadState.paused ? new UploadPausedError() : new Error('上传已中断'))
    }
    xhr.send(body)
  })
}

export function buildShareOptions(settings) {
  const downloadLimit = settings.downloadLimit === 'custom' ? settings.customDownloadLimit : settings.downloadLimit
  return {
    expiryDays: settings.expiryDays,
    downloadLimit,
    password: settings.passwordEnabled ? settings.password : '',
    codeLength: settings.codeLength,
    recipients: settings.recipients,
  }
}

export function wait(ms) { return new Promise((resolve) => window.setTimeout(resolve, ms)) }

export function markRecordUnavailable(record, message = '') {
  if (!/过期|失效|不存在|用完|关闭|截止|不可用/.test(message)) return record
  return {
    ...record,
    status: message.includes('关闭') ? '已关闭' : record.kind === 'collection' ? '已截止' : '已失效',
    updatedAt: new Date().toISOString(),
  }
}

export function getUrlParts(value) {
  if (!value) return []
  try {
    return new URL(value, window.location.origin).pathname.split('/').filter(Boolean)
  } catch {
    return []
  }
}

export const ACCOUNT_SESSION_EVENT = 'kunqiong:account-session'
let sessionUserId = ''
let sessionGeneration = 0
let sessionSnapshot = null
let profileRevision = 0
let logoutState = 'idle'
let logoutFlight = null
const accountReads = new Map()
const requestFlights = new Map()
const READ_TTL = 30000
const SNAPSHOT_MAX_AGE = 5 * 60 * 1000
const MAX_READ_ENTRIES = 80
const sharedReadPaths = new Set(['/api/auth/me', '/api/runtime-config', '/api/account/workspace', '/api/account/upgrade-pricing', '/api/account/team/overview', '/api/account/records', '/api/account/collections', '/api/account/upgrade-orders', '/api/account/file-cleanup-overview'])
function pruneReadCache() {
  for (const [key, entry] of accountReads) {
    if (!entry.promise && (Date.now() - entry.updatedAt > SNAPSHOT_MAX_AGE || accountReads.size > MAX_READ_ENTRIES)) accountReads.delete(key)
  }
}

const requestBodyObjectIds = new WeakMap()
let requestBodyObjectId = 0
let dataRevision = 0

function objectRequestId(value) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return ''
  let id = requestBodyObjectIds.get(value)
  if (!id) { id = ++requestBodyObjectId; requestBodyObjectIds.set(value, id) }
  return id
}

function stableRequestValue(value) {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(stableRequestValue)
  if (value instanceof Date) return value.toISOString()
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableRequestValue(value[key])]))
}

function requestBodyKey(body) {
  if (body === undefined || body === null) return ''
  if (typeof body === 'string') return `text:${body}`
  if (body instanceof URLSearchParams) return `params:${body.toString()}`
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    return `form:${JSON.stringify([...body.entries()].map(([key, value]) => [key, typeof value === 'string' ? value : [value.name, value.size, value.type, value.lastModified, objectRequestId(value)]]))}`
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob) return `blob:${objectRequestId(body)}`
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return `buffer:${objectRequestId(body)}`
  try { return `json:${JSON.stringify(stableRequestValue(body))}` }
  catch { return `object:${objectRequestId(body)}` }
}

function requestHeadersKey(headers = {}) {
  return JSON.stringify(Object.entries(plainRequestHeaders(headers)).sort(([left], [right]) => left.localeCompare(right)))
}

function plainRequestHeaders(headers = {}) {
  const entries = typeof headers?.entries === 'function' ? [...headers.entries()] : Array.isArray(headers) ? headers : Object.entries(headers)
  return Object.fromEntries(entries.map(([key, value]) => [String(key).toLowerCase(), String(value)]))
}

function requestWithSingleflight(url, options = {}, signal) {
  const method = (options.method || 'GET').toUpperCase()
  const { headers = {}, body, ...fetchOptions } = options
  const key = JSON.stringify([accountSessionKey(), ['GET', 'HEAD'].includes(method) ? dataRevision : '', method, String(url), requestHeadersKey(headers), requestBodyKey(body), stableRequestValue(fetchOptions)])
  let entry = requestFlights.get(key)
  if (!entry) {
    entry = { promise: null }
    entry.promise = performApiRequest(url, options).finally(() => {
      if (requestFlights.get(key) === entry) requestFlights.delete(key)
    })
    requestFlights.set(key, entry)
  }
  return withConsumerSignal(entry.promise, signal)
}

export function getCachedAccountSession() {
  if (sessionSnapshot?.sessionExpiresAt && Date.now() >= new Date(sessionSnapshot.sessionExpiresAt).getTime()) return null
  return sessionSnapshot
}

export function getCachedAccountData(url) {
  const entry = accountReads.get(url)
  return getCachedAccountSession()?.user?.id && entry?.owner === accountSessionKey() && Date.now() - entry.updatedAt <= SNAPSHOT_MAX_AGE ? entry.data || null : null
}

// Keep confirmed identity visible while revalidating it. Protected API routes
// still authorize every read/write; a 401 clears all snapshots immediately.
export function getPageAccountSession({ signal } = {}) {
  const cached = getCachedAccountSession()
  const refresh = apiRequest('/api/auth/me', { signal, authView: 'identity' })
  if (!cached) return refresh
  refresh.catch(() => {})
  return Promise.resolve(cached)
}

export function updateCachedAccountUser(user) {
  if (!user?.id || user.id !== sessionUserId || !sessionSnapshot) return
  profileRevision += 1
  sessionSnapshot = { ...sessionSnapshot, user }
  reportSession(user.id, sessionSnapshot.sessionExpiresAt || '')
}

export function accountSessionKey() {
  return `${sessionGeneration}:${sessionUserId}`
}

function reportSession(userId = '', expiresAt = '', message = '', code = '') {
  const previousId = sessionUserId
  sessionUserId = userId
  if (previousId !== userId) {
    if (previousId) sessionGeneration += 1
    const identityRequests = [...accountReads].filter(([key, entry]) => key.startsWith('/api/auth/me:') && entry.promise)
    accountReads.clear()
    for (const [key, entry] of identityRequests) accountReads.set(key, entry)
  }
  window.dispatchEvent(new CustomEvent(ACCOUNT_SESSION_EVENT, { detail: { userId, previousId, expiresAt, message, code, user: sessionSnapshot?.user || null } }))
}

export function invalidateAccountSession(message = '', code = '') {
  sessionSnapshot = null
  accountReads.clear()
  // Also invalidate requests started before an explicit logout while identity was pending.
  if (!sessionUserId) sessionGeneration += 1
  reportSession('', '', message, code)
}

const anonymousSession = () => ({ user: null, sessionExpiresAt: null, view: 'identity' })
export function isAccountLogoutPending() { return logoutState === 'pending' }

function logoutAccount(options) {
  if (logoutFlight) return logoutFlight
  logoutState = 'pending'
  invalidateAccountSession('', 'account_logout_pending')
  sessionSnapshot = anonymousSession()
  logoutFlight = requestWithSingleflight('/api/auth/logout', options).then(data => {
    logoutState = 'idle'
    sessionSnapshot = anonymousSession()
    reportSession('', '', '', 'account_logged_out')
    return data
  }).catch(error => {
    logoutState = 'failed'
    invalidateAccountSession('退出登录尚未完成，请重试', 'account_logout_failed')
    sessionSnapshot = anonymousSession()
    throw error
  }).finally(() => { logoutFlight = null })
  return logoutFlight
}

function withConsumerSignal(promise, signal) {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(new DOMException('请求已取消', 'AbortError'))
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new DOMException('请求已取消', 'AbortError')) }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value) }, error => { signal.removeEventListener('abort', abort); reject(error) })
  })
}

export function apiRequest(url, options = {}) {
  if (options.signal?.aborted) return Promise.reject(new DOMException('请求已取消', 'AbortError'))
  const { force = false, authView: selectedView, ...requestOptions } = options
  const method = (options.method || 'GET').toUpperCase()
  if (url === '/api/auth/logout' && method === 'POST') {
    const { signal, ...logoutOptions } = requestOptions
    return withConsumerSignal(logoutAccount(logoutOptions), signal)
  }
  // An old cookie can remain until the revocation response arrives. During a
  // pending or failed logout, background refreshes must never restore it.
  if (logoutState !== 'idle') {
    if (url === '/api/auth/me') return withConsumerSignal(Promise.resolve(anonymousSession()), options.signal)
    if (String(url).startsWith('/api/account/')) return Promise.reject(Object.assign(new Error('退出登录尚未完成，请重试'), { status: 401, code: 'account_logout_pending' }))
  }
  const authView = url === '/api/auth/me' ? selectedView || (window.location.pathname.startsWith('/settings') || window.location.pathname.startsWith('/trash') || new URLSearchParams(window.location.search).get('view') === 'records' ? 'full' : 'summary') : ''
  if (authView) {
    requestOptions.headers = plainRequestHeaders(requestOptions.headers)
    delete requestOptions.headers['x-kunqiong-auth-view']
    requestOptions.headers['X-Kunqiong-Auth-View'] = authView
  }
  const key = authView ? `${url}:${authView}` : url
  const shared = method === 'GET' && sharedReadPaths.has(String(url).split('?')[0])
  const { signal, ...sharedOptions } = requestOptions
  if (!shared) return requestWithSingleflight(url, sharedOptions, signal)
  if (sessionSnapshot && !getCachedAccountSession()) invalidateAccountSession()
  const owner = accountSessionKey()
  let entry = accountReads.get(key)
  if (entry?.owner === owner) {
    if (entry.promise) return withConsumerSignal(entry.promise, options.signal)
    if (!force && entry.data && Date.now() - entry.updatedAt < READ_TTL) return withConsumerSignal(Promise.resolve(entry.data), options.signal)
  }
  entry = { owner, data: entry?.owner === owner ? entry.data : null, updatedAt: 0, promise: null }
  accountReads.set(key, entry)
  entry.promise = requestWithSingleflight(url, sharedOptions).then(data => {
    // Initial identity discovery can change the owner; only auth may adopt that new owner.
    if (accountReads.get(key) === entry) {
      entry.owner = accountSessionKey()
      entry.data = data
      entry.updatedAt = Date.now()
      accountReads.set(key, entry)
      pruneReadCache()
    }
    return data
  }).finally(() => { entry.promise = null })
  return withConsumerSignal(entry.promise, signal)
}

async function performApiRequest(url, options = {}) {
  const generation = sessionGeneration
  const revision = profileRevision
  const { headers = {}, ...fetchOptions } = options
  let response, data
  for (let attempt = 0; ; attempt++) {
    response = await fetch(url, { ...fetchOptions, credentials: 'include', headers: { 'content-type': 'application/json', ...plainRequestHeaders(headers) } })
    data = await response.json().catch(() => ({}))
    // Only retry a transient database read. Permission failures and writes are
    // never replayed, and every subscriber shares this one recovery request.
    if (attempt || !['GET', 'HEAD'].includes((options.method || 'GET').toUpperCase())
      || response.status !== 503 || !/^DATABASE_(?:QUERY_TIMEOUT|QUEUE_TIMEOUT|UNAVAILABLE)$/.test(data.code || '')
      || generation !== sessionGeneration) break
    await wait(250)
    if (generation !== sessionGeneration) break
  }
  if (generation !== sessionGeneration) {
    const error = new Error('登录状态已更新，请重试')
    error.status = 401
    throw error
  }
  if (url === '/api/auth/me' && response.ok) {
    // A slower identity check must not overwrite a profile saved after it started.
    if (revision !== profileRevision && data.user?.id && data.user.id === sessionSnapshot?.user?.id) data.user = sessionSnapshot.user
    else if (data.user?.id && data.user.id === sessionSnapshot?.user?.id && plainRequestHeaders(headers)['x-kunqiong-auth-view'] !== 'full') {
      // Identity is deliberately a small projection. It must not downgrade an
      // already loaded avatar, local plan or capacity to its absent defaults.
      data.user = plainRequestHeaders(headers)['x-kunqiong-auth-view'] === 'identity'
        ? { ...data.user, ...sessionSnapshot.user, ...Object.fromEntries(['id', 'username', 'nickname', 'email', 'phone', 'status'].map(key => [key, data.user[key]])),
          ...(!sessionSnapshot.user.avatar && data.user.avatar ? { avatar: data.user.avatar, providerAvatar: data.user.providerAvatar || data.user.avatar } : {}) }
        : { ...sessionSnapshot.user, ...data.user }
    }
    sessionSnapshot = data
    reportSession(data.user?.id || '', data.sessionExpiresAt || '')
  }
  if (url === '/api/auth/logout' && response.ok) invalidateAccountSession()
  if (response.ok && !['GET', 'HEAD'].includes((options.method || 'GET').toUpperCase())) {
    dataRevision += 1
    // A completed mutation invalidates paged snapshots too. An older in-flight
    // read may finish, but cannot repopulate a replaced/deleted cache entry.
    accountReads.clear()
    if (['/api/auth/profile', '/api/account/bind'].includes(url)) updateCachedAccountUser(data.user)
  }
  if (!response.ok) {
    if (response.status === 401 && data.code !== 'share_password_invalid' && !String(url).startsWith('/api/admin/')) invalidateAccountSession(data.message || '', data.code || '')
    const error = new Error(data.message || ([502, 504].includes(response.status) ? '服务连接暂时中断，请稍后重试' : '请求失败'))
    error.status = response.status
    error.code = data.code || ''
    // 410 时服务端会附带脱敏的分享/收集元信息，用于渲染已过期/已截止状态页。
    error.shareMeta = data.share || null
    error.collectionMeta = data.collection || null
    error.guestQuota = data.guestQuota || null
    error.existingFiles = Array.isArray(data.existingFiles) ? data.existingFiles : []
    error.order = data.order || null
    error.scanLimit = data.scanLimit || ''
    error.scanFile = data.scanFile || ''
    error.scanFinding = data.scanFinding || null
    throw error
  }
  return data
}

export function xhrRequest(url, { method = 'POST', body, onProgress, onRequest }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(method, url)
    onRequest?.(xhr)
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100)) }
    xhr.onload = () => {
      let data
      try { data = JSON.parse(xhr.responseText || '{}') } catch { reject(new Error('服务响应格式不正确，请重试')); return }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data)
      else reject(new Error(data.message || '上传失败'))
    }
    xhr.onerror = () => reject(new Error('网络连接失败，请确认鲲穹服务已启动'))
    xhr.onabort = () => {
      const error = new Error('提交已取消')
      error.name = 'UploadCancelledError'
      reject(error)
    }
    xhr.send(body)
  })
}

export function createDownloadState() {
  return {
    status: 'idle',
    label: '',
    filename: '',
    progress: 0,
    loadedBytes: 0,
    totalBytes: 0,
    speedBps: 0,
    etaSeconds: null,
    canResume: false,
    isEstimated: false,
    retryCount: 0,
    retryConfig: null,
    needsPassword: false,
    error: '',
  }
}

export function isDownloadBusy(task) {
  return ['preparing', 'downloading', 'saving'].includes(task?.status)
}

export function downloadStatusText(task) {
  if (task.status === 'preparing') return '准备下载'
  if (task.status === 'downloading') return '正在下载'
  if (task.status === 'saving') return '正在保存'
  if (task.status === 'complete') return '下载完成'
  if (task.status === 'cancelled') return '已取消下载'
  if (task.status === 'failed') return '下载失败'
  return task.label || '正在下载'
}

// 下载错误的状态码中文兜底：任何情况下不向用户展示裸状态码。
const DOWNLOAD_STATUS_FALLBACK = {
  400: '下载请求无效，请刷新页面后重试',
  401: '请先登录后再下载',
  403: '没有这个文件的下载权限',
  404: '分享不存在或已失效',
  410: '分享已失效或下载次数已用完',
  415: '文件安全检查未通过，无法下载',
  429: '操作过于频繁，请稍后再试',
  500: '服务器处理失败，请稍后重试',
  503: '服务暂不可用，请稍后重试',
}

export async function downloadResponseError(response) {
  // 下载预检走 HEAD（无响应体），服务端把文案放在 x-error-message 头里
  // （值为 encodeURIComponent 后的中文）；其余场景从 JSON body 读 message。
  // 都拿不到时按状态码给中文兜底。
  let headerMessage = ''
  const rawHeader = response.headers?.get('x-error-message') || ''
  if (rawHeader) headerMessage = decodeURIComponent(rawHeader)
  const text = await response.text().catch(() => '')
  let bodyMessage = ''
  if (text) {
    try { bodyMessage = JSON.parse(text).message || '' } catch { bodyMessage = text }
  }
  const message = headerMessage || bodyMessage || DOWNLOAD_STATUS_FALLBACK[response.status] || '下载失败，请稍后重试'
  const error = new Error(message)
  error.status = response.status
  return error
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function canUseImageClipboard() {
  return Boolean(window.isSecureContext && navigator.clipboard?.write && typeof window.ClipboardItem !== 'undefined')
}

export function copyImageWithSelection(dataUrl) {
  const activeElement = document.activeElement
  const container = document.createElement('div')
  container.contentEditable = 'true'
  container.setAttribute('aria-hidden', 'true')
  container.style.position = 'fixed'
  container.style.top = '0'
  container.style.left = '-9999px'
  container.style.width = '220px'
  container.style.height = '220px'
  container.style.overflow = 'hidden'
  container.style.opacity = '0'
  const image = document.createElement('img')
  image.src = dataUrl
  image.alt = '分享二维码'
  image.style.width = '200px'
  image.style.height = '200px'
  container.appendChild(image)
  document.body.appendChild(container)

  const selection = window.getSelection()
  const range = document.createRange()
  range.selectNodeContents(container)
  selection?.removeAllRanges()
  selection?.addRange(range)

  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  }

  selection?.removeAllRanges()
  container.remove()
  if (activeElement && typeof activeElement.focus === 'function') {
    activeElement.focus({ preventScroll: true })
  }
  return copied
}

export function copyTextWithTextarea(text) {
  const textarea = document.createElement('textarea')
  const activeElement = document.activeElement
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '-9999px'
  textarea.style.width = '1px'
  textarea.style.height = '1px'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  textarea.setSelectionRange(0, textarea.value.length)
  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  }
  textarea.remove()
  if (activeElement && typeof activeElement.focus === 'function') {
    activeElement.focus({ preventScroll: true })
  }
  return copied
}

export function currentDownloadSpeed(startedAt, loadedBytes) {
  const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.1)
  return Math.round(loadedBytes / elapsedSeconds)
}

export function filenameFromContentDisposition(value = '') {
  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  if (encoded) {
    try { return decodeURIComponent(encoded) } catch {}
  }
  return value.match(/filename="?([^";]+)"?/i)?.[1] || ''
}

export function createShareFileDownloadConfig(share, file, fileIndex, { password = '' } = {}) {
  return {
    url: `${window.location.origin}/api/shares/${encodeURIComponent(share.id)}/files/${fileIndex}/download`,
    filename: file.name || '下载文件',
    label: `下载 ${file.name || '文件'}`,
    totalBytes: Number(file.size || 0),
    requiresPassword: Boolean(share.requiresPassword),
    passwordVerified: Boolean(password),
    headers: password ? { 'x-share-password': password } : {},
    unlockUrl: share.code ? `/api/shares/lookup/${encodeURIComponent(share.code)}` : '',
  }
}

export function createSubmissionFileDownloadConfig(collection, submission, fileIndex) {
  const file = submission.files?.[fileIndex] || {}
  return {
    url: `${window.location.origin}/api/collections/manage/${encodeURIComponent(collection.manageToken)}/submissions/${encodeURIComponent(submission.id)}/files/${fileIndex}/download`,
    filename: file.name || '下载文件',
    label: `下载 ${file.name || '文件'}`,
    totalBytes: Number(file.size || 0),
  }
}

export async function downloadBinaryWithProgress(config, onProgress) {
  onProgress({ status: 'preparing', label: config.label, filename: config.filename, error: '' })
  const headers = { ...config.headers }

  // Supported browsers can stream directly to the chosen file and report real
  // byte progress without buffering a large download in memory. Open the picker
  // before the first await so it remains tied to the user's click gesture.
  if (typeof window.showSaveFilePicker === 'function' && (!config.requiresPassword || config.passwordVerified)) {
    let pickerPromise
    try {
      pickerPromise = window.showSaveFilePicker({ suggestedName: config.filename || '下载文件' })
    } catch (error) {
      throw error
    }
    const pickerResult = pickerPromise.then(handle => ({ handle }), error => ({ error }))
    const { handle, error: pickerError } = await pickerResult
    if (pickerError) throw pickerError

    let writable
    let reader
    try {
      if (config.unlockUrl && headers['x-share-password']) {
        // Keep passwords in a same-origin JSON body, never in a download URL
        // or header. The unlock endpoint issues a scoped HttpOnly cookie.
        const unlocked = await fetch(config.unlockUrl, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: headers['x-share-password'] }) })
        if (!unlocked.ok) throw await downloadResponseError(unlocked)
        delete headers['x-share-password']
      }
      const response = await fetch(config.url, { method: 'GET', credentials: 'include', headers })
      if (!response.ok) throw await downloadResponseError(response)
      if (!response.body?.getReader) throw new Error('当前浏览器不支持流式下载，请更换浏览器后重试')
      reader = response.body.getReader()
      writable = await handle.createWritable()
      const contentLength = Number(response.headers.get('content-length')) || 0
      const totalBytes = contentLength || Number(response.headers.get('x-download-total-size')) || Number(config.totalBytes) || 0
      const isEstimated = !contentLength && totalBytes > 0
      const startedAt = Date.now()
      let loadedBytes = 0
      onProgress({ status: 'downloading', filename: config.filename, loadedBytes, totalBytes, progress: 0, speedBps: 0, etaSeconds: null, isEstimated })
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        await writable.write(value)
        loadedBytes += value.byteLength
        const speedBps = currentDownloadSpeed(startedAt, loadedBytes)
        const progress = totalBytes ? Math.min(99, Math.floor(loadedBytes / totalBytes * 100)) : 0
        const etaSeconds = totalBytes && speedBps > 0 ? Math.max(0, (totalBytes - loadedBytes) / speedBps) : null
        onProgress({ status: 'downloading', filename: config.filename, loadedBytes, totalBytes, progress, speedBps, etaSeconds, isEstimated })
      }
      onProgress({ status: 'saving', filename: config.filename, loadedBytes, totalBytes, progress: 99, speedBps: currentDownloadSpeed(startedAt, loadedBytes), etaSeconds: 0, isEstimated })
      await writable.close()
      return { saved: true, loadedBytes, totalBytes, isEstimated }
    } catch (error) {
      await reader?.cancel().catch(() => {})
      await writable?.abort().catch(() => {})
      throw error
    }
  }

  // Browsers without a save picker retain native downloads; their byte progress
  // and final disk state are intentionally left to the browser download panel.
  if (config.unlockUrl && headers['x-share-password']) {
    // JSON 同时支持中文密码；解锁凭证供后续原生下载使用，密码不进入 URL。
    const unlocked = await fetch(config.unlockUrl, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: headers['x-share-password'] }) })
    if (!unlocked.ok) throw await downloadResponseError(unlocked)
    delete headers['x-share-password']
  }
  const response = await fetch(config.url, { method: 'HEAD', credentials: 'include', headers })
  if (!response.ok) throw await downloadResponseError(response)
  const filename = config.filename || filenameFromContentDisposition(response.headers.get('content-disposition')) || '下载文件'
  const link = document.createElement('a')
  link.href = config.url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  onProgress({ status: 'handed_off', filename })
  return { handedOff: true }
}

export async function upgradeApiRequest(url, options = {}) {
  return apiRequest(url, options)
}

// 把远端实价合并进套餐对象（只改展示字段，不动 permanent/team 等权益字段；
// remotePriced 标记价格来源；本站配置的权益期限保持不变）
export function mergePlanPricing(plan, remotePricing) {
  const pricing = remotePricing?.[plan?.id]
  if (!plan || !pricing || pricing.available === false) return plan
  return { ...plan, monthlyPrice: pricing.priceCents, remotePriced: true, remotePackageName: pricing.packageName || '' }
}

export async function copyTextToClipboard(value) {
  const text = String(value ?? '')
  if (!text) throw new Error('copy-empty-text')

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {}
  }

  if (copyTextWithTextarea(text)) return
  throw new Error('copy-text-not-supported')
}
