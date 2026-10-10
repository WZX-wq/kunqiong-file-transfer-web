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
    uploadedBytes: 0,
    totalBytes: 0,
    startedAt: 0,
    paused: false,
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
    options: shareOptions,
    mode: uploadConfig.sessionBody || {},
  })
}

export function currentSpeed(session, loadedBytes) {
  const elapsedSeconds = Math.max((Date.now() - session.startedAt) / 1000, 0.3)
  return loadedBytes / elapsedSeconds
}

// 上传暂停/取消时的专用错误类型：xhrUploadChunk 与 transfer.js 的上传循环共用。
export class UploadPausedError extends Error {
  constructor() {
    super('上传已暂停')
    this.name = 'UploadPausedError'
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
    const cleanup = () => {
      activeXhrs.delete(xhr)
      if (!activeXhrs.size) uploadState.abortCurrent = null
    }
    xhr.open('POST', url)
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(event.loaded) }
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
      reject(uploadState.paused ? new UploadPausedError() : new Error('上传已中断'))
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

export async function apiRequest(url, options = {}) {
  const { headers = {}, ...fetchOptions } = options
  const response = await fetch(url, { ...fetchOptions, credentials: 'include', headers: { 'Content-Type': 'application/json', ...headers } })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.message || '请求失败')
    error.status = response.status
    error.code = data.code || ''
    error.guestQuota = data.guestQuota || null
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
      const data = JSON.parse(xhr.responseText || '{}')
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
    error: '',
  }
}

export function isDownloadBusy(task) {
  return ['preparing', 'downloading', 'saving'].includes(task?.status)
}

export function downloadStatusText(task) {
  if (task.status === 'preparing') return '准备下载'
  if (task.status === 'saving') return '正在保存'
  if (task.status === 'complete') return '下载完成'
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
    headers: password ? { 'x-share-password': password } : {},
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
  const response = await fetch(config.url, { method: 'HEAD', credentials: 'include', headers: config.headers || {} })
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
  const { headers = {}, ...fetchOptions } = options
  const response = await fetch(url, { ...fetchOptions, credentials: 'include', headers: { 'Content-Type': 'application/json', ...headers } })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.message || '请求失败')
    error.order = data.order || null
    throw error
  }
  return data
}

// 把远端实价合并进套餐对象（只改展示字段，不动 permanent/team 等权益字段；
// remotePriced 标记供 formatPlanPrice 区分「天数跟随主站」与本地兜底展示）
export function mergePlanPricing(plan, remotePricing) {
  const pricing = remotePricing?.[plan?.id]
  if (!plan || !pricing) return plan
  return { ...plan, monthlyPrice: pricing.priceCents, validityDays: pricing.validityDays, remotePriced: true, remotePackageName: pricing.packageName || '' }
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
