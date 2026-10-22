const MB = 1024 * 1024
export const OFFICE_PREVIEW_LIMITS = Object.freeze({
  maxFileBytes: 20 * MB,
  maxExpandedBytes: 60 * MB,
  maxEntryBytes: 16 * MB,
  maxEntries: 1000,
  maxCompressionRatio: 200,
  maxSheets: 20,
  maxRows: 2000,
  maxColumns: 100,
  maxCellsPerSheet: 50000,
  maxWorkbookCells: 100000,
  rowsPerPage: 100,
  maxCellText: 10000,
  maxHtmlBytes: 2 * MB,
  maxHtmlElements: 12000,
  maxHtmlDepth: 64,
  timeoutMs: 10000,
  presentationFileBytes: 2 * MB,
  presentationExpandedBytes: 8 * MB,
  presentationEntryBytes: MB,
  presentationEntries: 200,
  maxSlides: 10,
  maxPresentationXmlTags: 20000,
  maxImagePixels: 4000000,
  maxTotalImagePixels: 16000000,
})

function limitError(detail) {
  return new Error(`${detail}，已停止预览，请下载后查看完整文件。`)
}

function abortError() { return new DOMException('预览已取消', 'AbortError') }

export function assertOfficeFileSize(bytes, kind = 'document') {
  const maximum = kind === 'presentation' ? OFFICE_PREVIEW_LIMITS.presentationFileBytes : OFFICE_PREVIEW_LIMITS.maxFileBytes
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maximum) throw limitError(`文件超过 ${maximum / MB} MB 预览上限`)
}

// Do not trust Content-Length, and do not buffer an unbounded response when it
// is absent or forged. The caller aborts fetch as well as terminating parsing.
export async function readPreviewResponse(response, { kind = 'document', signal, maxBytes } = {}) {
  const maximum = maxBytes ?? (kind === 'presentation' ? OFFICE_PREVIEW_LIMITS.presentationFileBytes : OFFICE_PREVIEW_LIMITS.maxFileBytes)
  const declared = response.headers.get('content-length')
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum)) {
    await response.body?.cancel()
    throw limitError(`文件超过 ${maximum / MB} MB 预览上限`)
  }
  if (!response.body?.getReader) throw limitError('浏览器不支持安全的流式预览')
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    if (signal?.aborted) throw abortError()
    while (true) {
      const { done, value } = await reader.read()
      if (signal?.aborted) throw abortError()
      if (done) break
      size += value.byteLength
      if (size > maximum) throw limitError(`文件超过 ${maximum / MB} MB 预览上限`)
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return bytes.buffer
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    signal?.removeEventListener('abort', cancel)
    reader.releaseLock()
  }
}

// Reject declared ZIP expansion before allocating decompressed data. ZIP64,
// encrypted files and duplicate/ambiguous entries are intentionally not previewed.
export function inspectOfficeZip(buffer, kind = 'document') {
  assertOfficeFileSize(buffer.byteLength, kind)
  const bytes = new Uint8Array(buffer), view = new DataView(buffer)
  const isZip = bytes.length >= 4 && view.getUint32(0, true) === 0x04034b50
  if (!isZip) {
    if (kind === 'spreadsheet') return null // Legacy XLS / delimited text also run inside the worker.
    throw new Error('文件不是有效的 Office 文档，请下载后查看。')
  }
  let end = -1
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) { end = offset; break }
  }
  if (end < 0) throw new Error('Office 压缩目录损坏，无法预览。')
  const count = view.getUint16(end + 10, true), directorySize = view.getUint32(end + 12, true), directoryOffset = view.getUint32(end + 16, true)
  const ppt = kind === 'presentation'
  const maxEntries = ppt ? OFFICE_PREVIEW_LIMITS.presentationEntries : OFFICE_PREVIEW_LIMITS.maxEntries
  const maxEntryBytes = ppt ? OFFICE_PREVIEW_LIMITS.presentationEntryBytes : OFFICE_PREVIEW_LIMITS.maxEntryBytes
  const maxExpandedBytes = ppt ? OFFICE_PREVIEW_LIMITS.presentationExpandedBytes : OFFICE_PREVIEW_LIMITS.maxExpandedBytes
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== count || directoryOffset + directorySize !== end) throw new Error('不支持此 Office 压缩格式，请下载后查看。')
  if (count > maxEntries || !count) throw limitError('文档内部文件数量超过预览上限')
  const names = new Set(), entries = [], localRegions = []
  let offset = directoryOffset, expandedBytes = 0, slides = 0
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error('Office 压缩目录损坏，无法预览。')
    const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true), size = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true), extraLength = view.getUint16(offset + 30, true), commentLength = view.getUint16(offset + 32, true)
    const localOffset = view.getUint32(offset + 42, true)
    if (offset + 46 + nameLength + extraLength + commentLength > end || localOffset + 30 > directoryOffset) throw new Error('Office 压缩目录损坏，无法预览。')
    const rawName = bytes.subarray(offset + 46, offset + 46 + nameLength)
    const name = new TextDecoder().decode(rawName)
    if (flags & 1 || ![0, 8].includes(method) || [size, compressedSize, localOffset].includes(0xffffffff) || !name || names.has(name) || /[\u0000-\u001f\\]/.test(name) || name.split('/').includes('..')) throw new Error('Office 内部文件格式无效，无法预览。')
    names.add(name)
    if (size > maxEntryBytes || size > Math.max(1, compressedSize) * OFFICE_PREVIEW_LIMITS.maxCompressionRatio) throw limitError('文档解压大小超过预览上限')
    expandedBytes += size
    if (expandedBytes > maxExpandedBytes) throw limitError('文档解压总大小超过预览上限')
    if (view.getUint32(localOffset, true) !== 0x04034b50 || view.getUint16(localOffset + 8, true) !== method || view.getUint16(localOffset + 6, true) !== flags) throw new Error('Office 内部文件头不一致，无法预览。')
    const localNameLength = view.getUint16(localOffset + 26, true), localExtraLength = view.getUint16(localOffset + 28, true)
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength
    if (localNameLength !== nameLength || dataOffset + compressedSize > directoryOffset || rawName.some((value, position) => bytes[localOffset + 30 + position] !== value)) throw new Error('Office 内部文件位置无效，无法预览。')
    localRegions.push([localOffset, dataOffset + compressedSize])
    entries.push({ name, size, method, compressedSize, dataOffset })
    if (/^ppt\/slides\/slide\d+\.xml$/.test(name)) slides++
    offset += 46 + nameLength + extraLength + commentLength
  }
  if (offset !== end) throw new Error('Office 压缩目录损坏，无法预览。')
  localRegions.sort((left, right) => left[0] - right[0])
  if (localRegions.some((region, index) => index && region[0] < localRegions[index - 1][1])) throw new Error('Office 内部文件重叠，无法预览。')
  if (ppt && slides > OFFICE_PREVIEW_LIMITS.maxSlides) throw limitError(`演示文稿超过 ${OFFICE_PREVIEW_LIMITS.maxSlides} 页预览上限`)
  return { entries, expandedBytes }
}

function validateImageDimensions(bytes, name) {
  let width, height
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (/\.png$/i.test(name) && bytes.length >= 24 && view.getUint32(0) === 0x89504e47) { width = view.getUint32(16); height = view.getUint32(20) }
  else if (/\.gif$/i.test(name) && bytes.length >= 10) { width = view.getUint16(6, true); height = view.getUint16(8, true) }
  else if (/\.jpe?g$/i.test(name) && bytes[0] === 255 && bytes[1] === 216) {
    for (let offset = 2; offset + 9 < bytes.length;) {
      if (bytes[offset] !== 255) break
      const marker = bytes[offset + 1], length = view.getUint16(offset + 2)
      if (length < 2) break
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) { height = view.getUint16(offset + 5); width = view.getUint16(offset + 7); break }
      offset += length + 2
    }
  } else if (/\.bmp$/i.test(name) && bytes.length >= 26 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    width = view.getInt32(18, true); height = Math.abs(view.getInt32(22, true))
  } else if (/\.webp$/i.test(name) && bytes.length >= 30 && String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === 'RIFF' && String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) === 'WEBP') {
    const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15])
    if (chunk === 'VP8 ') { width = view.getUint16(26, true) & 0x3fff; height = view.getUint16(28, true) & 0x3fff }
    else if (chunk === 'VP8L' && bytes[20] === 0x2f) { const bits = view.getUint32(21, true); width = (bits & 0x3fff) + 1; height = ((bits >> 14) & 0x3fff) + 1 }
    else if (chunk === 'VP8X') { width = (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) + 1; height = (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) + 1 }
  } else if (/\.ico$/i.test(name) && bytes.length >= 8 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) {
    width = bytes[6] || 256; height = bytes[7] || 256
  } else {
    // EMF/WMF/TIFF/AVIF 等：浏览器不渲染、也无法在此安全测量尺寸的格式，
    // 跳过该图片而不是让整份文档预览失败。体积仍受 maxEntryBytes / maxHtmlBytes 约束。
    return 0
  }
  if (!width || !height || width > 8192 || height > 8192 || width * height > OFFICE_PREVIEW_LIMITS.maxImagePixels) throw limitError('文档内图片尺寸超过预览上限')
  return width * height
}

// Validate actual inflated bytes as well: a forged central-directory size must
// never be handed to a converter which might allocate its full expansion.
export async function verifyOfficeZip(buffer, kind = 'document') {
  const archive = inspectOfficeZip(buffer, kind)
  if (!archive) return null
  const bytes = new Uint8Array(buffer)
  let actualTotal = 0, xmlTags = 0, imagePixels = 0
  for (const entry of archive.entries) {
    const compressed = bytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize)
    const stream = new Blob([compressed]).stream()
    let reader
    if (entry.method === 8) {
      try { reader = stream.pipeThrough(new DecompressionStream('deflate-raw')).getReader() }
      catch { throw new Error('浏览器不支持安全的 Office 解压预览，请下载后查看。') }
    } else reader = stream.getReader()
    const inspectContent = kind === 'presentation' && /\.(xml|rels)$/i.test(entry.name) || /\/(media)\//.test(entry.name)
    const chunks = []
    let actual = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        actual += value.byteLength
        actualTotal += value.byteLength
        if (actual > entry.size || actualTotal > archive.expandedBytes) throw limitError('文档实际解压大小与声明不一致')
        if (inspectContent) chunks.push(value)
      }
    } catch (error) {
      await reader.cancel().catch(() => {})
      throw error
    } finally { reader.releaseLock() }
    if (actual !== entry.size) throw new Error('文档实际解压大小与声明不一致，请下载后查看。')
    if (inspectContent) {
      const content = new Uint8Array(actual)
      let offset = 0
      for (const chunk of chunks) { content.set(chunk, offset); offset += chunk.byteLength }
      if (/\/(media)\//.test(entry.name) && !entry.name.endsWith('/')) {
        imagePixels += validateImageDimensions(content, entry.name)
        if (imagePixels > OFFICE_PREVIEW_LIMITS.maxTotalImagePixels) throw limitError('文档内图片总尺寸超过预览上限')
      }
      if (kind === 'presentation' && /\.(xml|rels)$/i.test(entry.name)) {
        const xml = new TextDecoder().decode(content)
        xmlTags += (xml.match(/</g) || []).length
        if (xmlTags > OFFICE_PREVIEW_LIMITS.maxPresentationXmlTags || /<!DOCTYPE|<!ENTITY/i.test(xml) || /TargetMode\s*=\s*["']External["']/i.test(xml)) throw limitError('演示文稿复杂度超过安全预览上限')
      }
    }
  }
  return archive
}
export function assertPreviewHtmlBudget(html) {
  if (html.length > OFFICE_PREVIEW_LIMITS.maxHtmlBytes || (html.match(/<(?!\/|!|\?)[a-z]/gi) || []).length > OFFICE_PREVIEW_LIMITS.maxHtmlElements) throw limitError('文档正文或页面元素超过预览上限')
  let depth = 0
  for (const match of html.matchAll(/<(\/?)([a-z][a-z0-9]*)\b[^>]*>/gi)) {
    if (match[1]) depth = Math.max(0, depth - 1)
    else if (!['br', 'img', 'hr', 'meta', 'link', 'input', 'wbr'].includes(match[2].toLowerCase()) && !match[0].endsWith('/>')) {
      depth++
      if (depth > OFFICE_PREVIEW_LIMITS.maxHtmlDepth) throw limitError('文档页面嵌套层级超过预览上限')
    }
  }
}

// Each RPC has a hard deadline. A worker stuck in synchronous XML/XLS parsing
// is terminated, not merely ignored after the user closes the modal.
export function createOfficePreviewSession({ signal, workerFactory } = {}) {
  const worker = workerFactory()
  let nextId = 0, closed = false
  const pending = new Map()
  const close = (reason = abortError()) => {
    if (closed) return
    closed = true
    signal?.removeEventListener('abort', abort)
    worker.terminate()
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(reason) }
    pending.clear()
  }
  const abort = () => close()
  worker.onmessage = ({ data }) => {
    const entry = pending.get(data.id)
    if (!entry) return
    pending.delete(data.id); clearTimeout(entry.timer)
    if (data.error) { entry.reject(new Error(data.error)); close(new Error(data.error)) }
    else entry.resolve(data.result)
  }
  worker.onerror = () => close(new Error('Office 解析失败，请下载后查看。'))
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) close()
  return {
    request(type, payload, transfer = []) {
      if (closed) return Promise.reject(abortError())
      const id = ++nextId
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => close(limitError('Office 解析超时')), OFFICE_PREVIEW_LIMITS.timeoutMs)
        pending.set(id, { resolve, reject, timer })
        try { worker.postMessage({ id, type, ...payload }, transfer) }
        catch (error) { close(error) }
      })
    },
    close,
  }
}
