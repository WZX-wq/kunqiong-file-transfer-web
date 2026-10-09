// 传输基础设施：分片上传（跨刷新续传）+ 下载/预览配置构造。
// 从 src/main.jsx 拆出，纯函数为主，含 UploadPausedError。
import {
  UPLOAD_RESUME_KEY, UPLOAD_RESUME_TTL_MS, TEXT_PREVIEW_EXTENSIONS
} from './constants.js'
import {
  fileExtension, safeDownloadName, totalFileSize
} from './format.js'
import {
  apiRequest, buildShareOptions, canUseImageClipboard, copyImageWithSelection,
  createShareFileDownloadConfig, createSubmissionFileDownloadConfig, currentSpeed,
  pickUploadChunkSize, sha256Hex, uploadResumeSignature, wait, xhrUploadChunk
} from './api.js'
import {
  compactRecordFiles, compactRecordSubmissions, getShareToken
} from './records.js'

export async function copyImageToClipboard(dataUrl) {
  if (canUseImageClipboard()) {
    const response = await fetch(dataUrl)
    const blob = await response.blob()
    await navigator.clipboard.write([new window.ClipboardItem({ [blob.type || 'image/png']: blob })])
    return
  }
  if (copyImageWithSelection(dataUrl)) return
  throw new Error('copy-image-not-supported')
}

export function createShareDownloadConfig(share, { password = '' } = {}) {
  const files = share.files || []
  return {
    url: share.downloadUrl || `${window.location.origin}/api/shares/${encodeURIComponent(share.id)}/download`,
    filename: files.length === 1 ? files[0].name : '鲲穹文件包.zip',
    label: files.length === 1 ? `下载 ${files[0]?.name || '文件'}` : `打包下载 ${files.length} 个文件`,
    totalBytes: totalFileSize(files),
    headers: password ? { 'x-share-password': password } : {},
  }
}

export function createShareFilePreviewConfig(share, file, fileIndex, options = {}) {
  return {
    file,
    kind: previewKind(file),
    url: `${window.location.origin}/api/shares/${encodeURIComponent(share.id)}/files/${fileIndex}/preview`,
    downloadConfig: createShareFileDownloadConfig(share, file, fileIndex, options),
  }
}

export function createCollectionDownloadConfig(collection) {
  const submissions = collection.submissions || []
  const fileCount = submissions.reduce((sum, submission) => sum + (submission.files?.length || 0), 0)
  return {
    url: collection.downloadUrl || `${window.location.origin}/api/collections/manage/${encodeURIComponent(collection.manageToken)}/download`,
    filename: `${safeDownloadName(collection.title || '收集文件')}.zip`,
    label: `打包下载 ${submissions.length} 份提交 / ${fileCount} 个文件`,
    totalBytes: submissions.reduce((sum, submission) => sum + totalFileSize(submission.files), 0),
  }
}

export function createSubmissionDownloadConfig(collection, submission) {
  if (submission.files?.length === 1) return createSubmissionFileDownloadConfig(collection, submission, 0)
  return {
    url: `${window.location.origin}/api/collections/manage/${encodeURIComponent(collection.manageToken)}/submissions/${encodeURIComponent(submission.id)}/download`,
    filename: `${safeDownloadName(submission.participantName || '提交文件')}.zip`,
    label: `打包下载 ${submission.participantName || '提交文件'}`,
    totalBytes: totalFileSize(submission.files),
  }
}

export function createSubmissionFilePreviewConfig(collection, submission, fileIndex) {
  const file = submission.files?.[fileIndex] || {}
  return {
    file,
    kind: previewKind(file),
    url: `${window.location.origin}/api/collections/manage/${encodeURIComponent(collection.manageToken)}/submissions/${encodeURIComponent(submission.id)}/files/${fileIndex}/preview`,
    downloadConfig: createSubmissionFileDownloadConfig(collection, submission, fileIndex),
  }
}

export function recordPreviewConfigs(record) {
  if (!record) return []
  if (record.kind === 'share') {
    const files = compactRecordFiles(record.files)
    const shareId = record.shareId || getShareToken(record.shareUrl || record.publicUrl)
    if (!shareId) return []
    return files
      .map((file, index) => canPreviewFile(file) ? { ...createShareFilePreviewConfig({ id: shareId }, file, index), key: `share:${shareId}:${index}` } : null)
      .filter(Boolean)
  }
  if (record.scope === 'my_collections') {
    const submissions = compactRecordSubmissions(record.submissions)
    if (!record.manageToken) return []
    return submissions.flatMap((submission) => submission.files.map((file, index) => canPreviewFile(file) && submission.id
      ? {
          ...createSubmissionFilePreviewConfig({ manageToken: record.manageToken }, submission, index),
          key: `collection:${record.manageToken}:${submission.id}:${index}`,
        }
      : [])).filter(Boolean)
  }
  return []
}

export function recordPreviewConfig(record) {
  return recordPreviewConfigs(record)[0] || null
}

export function canPreviewFile(file) {
  return Boolean(previewKind(file))
}

export function previewKind(file = {}) {
  const mimeType = String(file.mimeType || '').toLowerCase()
  const extension = fileExtension(file.name || file.relativePath)
  if (mimeType === 'application/pdf' || extension === 'pdf') return 'pdf'
  if ((mimeType.startsWith('image/') && mimeType !== 'image/svg+xml') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(extension)) return 'image'
  if (mimeType.startsWith('video/') || ['mp4', 'webm', 'ogv', 'mov', 'm4v'].includes(extension)) return 'video'
  if (mimeType.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'aac', 'flac', 'oga', 'ogg'].includes(extension)) return 'audio'
  if (mimeType.includes('wordprocessingml') || extension === 'docx') return 'document'
  if (mimeType.includes('spreadsheetml') || ['xlsx', 'xls', 'csv'].includes(extension)) return 'spreadsheet'
  if (mimeType.includes('presentationml') || extension === 'pptx') return 'presentation'
  if (mimeType.startsWith('text/') || TEXT_PREVIEW_EXTENSIONS.has(extension)) return 'text'
  return ''
}

export function previewTypeLabel(kind) {
  if (kind === 'pdf') return 'PDF'
  if (kind === 'video') return '视频'
  if (kind === 'audio') return '音频'
  if (kind === 'document') return '文档'
  if (kind === 'spreadsheet') return '表格'
  if (kind === 'presentation') return '演示文稿'
  if (kind === 'text') return '文本'
  return '图片'
}

export function previewSupportLabel(kind) {
  if (kind === 'pdf') return '浏览器内嵌 PDF 预览'
  if (kind === 'video') return '在线播放，支持拖动进度'
  if (kind === 'audio') return '在线播放音频'
  if (kind === 'document') return 'DOCX 在线解析预览'
  if (kind === 'spreadsheet') return '表格在线解析预览'
  if (kind === 'presentation') return 'PPTX 在线渲染预览'
  if (kind === 'text') return '文本/代码源码预览，超大文件仅显示前 512 KB'
  return '图片在线预览'
}

export function readUploadResume() {
  try { return JSON.parse(localStorage.getItem(UPLOAD_RESUME_KEY) || 'null') } catch { return null }
}

export function saveUploadResume(files, chunkSize, uploadConfig, shareOptions, sessionId) {
  try {
    localStorage.setItem(UPLOAD_RESUME_KEY, JSON.stringify({ sessionId, chunkSize, savedAt: Date.now(), signature: uploadResumeSignature(files, chunkSize, uploadConfig, shareOptions) }))
  } catch { /* 存储满/隐私模式忽略，退化为普通续传 */ }
}

export function clearUploadResume() {
  try { localStorage.removeItem(UPLOAD_RESUME_KEY) } catch { /* 忽略 */ }
}

// 跨刷新续传：刷新/重启后用 localStorage 里的会话指纹换回已传分片清单，
// 文件清单、分片配置、分享参数任一变化即放弃续传重新开session。
export async function tryResumeUploadSession(files, chunkSize, uploadConfig, shareOptions, session) {
  const entry = readUploadResume()
  if (!entry?.sessionId) return false
  try {
    if (Date.now() - Number(entry.savedAt) > UPLOAD_RESUME_TTL_MS) throw new Error('上传会话已过期')
    if (Number(entry.chunkSize) !== chunkSize || entry.signature !== uploadResumeSignature(files, chunkSize, uploadConfig, shareOptions)) throw new Error('文件清单变化')
    const data = await apiRequest(`/api/upload-sessions/${entry.sessionId}`)
    if (Number(data.chunkSize) !== chunkSize || !Array.isArray(data.files) || data.files.length !== files.length) throw new Error('服务端会话不一致')
    const resumedChunks = new Map()
    let resumedBytes = 0
    for (let index = 0; index < data.files.length; index += 1) {
      const remote = data.files[index]
      const local = files[index]
      if (remote.name !== local.name || Number(remote.size) !== local.size) throw new Error('文件清单变化')
      const done = Array.isArray(remote.uploadedChunks) ? remote.uploadedChunks : []
      resumedChunks.set(index, done)
      for (const chunkIndex of done) resumedBytes += Math.min(chunkSize, Math.max(0, local.size - chunkIndex * chunkSize))
    }
    session.sessionId = data.sessionId || entry.sessionId
    session.resumedChunks = resumedChunks
    session.uploadedBytes = Math.min(resumedBytes, session.totalBytes)
    return true
  } catch {
    clearUploadResume()
    return false
  }
}

export async function uploadShareInChunks(files, settings, uploadRef, onState, uploadConfig = {}) {
  const chunkSize = pickUploadChunkSize(files)
  const concurrency = Math.min(4, Math.max(2, Number(navigator.hardwareConcurrency || 4) >= 8 ? 4 : 2))
  const session = uploadRef.current
  session.totalBytes = files.reduce((sum, item) => sum + item.size, 0)
  session.startedAt = session.startedAt || Date.now()
  const shareOptions = buildShareOptions(settings)

  if (!session.sessionId) {
    onState({ status: 'uploading', phase: '创建上传会话', progress: 0, totalBytes: session.totalBytes, uploadedBytes: 0, speedBps: 0, etaSeconds: null, currentFile: '', retryCount: 0, error: '' })
    const resumed = await tryResumeUploadSession(files, chunkSize, uploadConfig, shareOptions, session)
    if (resumed) {
      onState(uploadStateFromProgress(session, session.uploadedBytes, '已恢复上次上传进度', '', 0))
    } else {
      const response = await apiRequest('/api/upload-sessions', {
        method: 'POST',
        body: JSON.stringify({
          files: files.map((item) => ({ name: item.name, relativePath: item.relativePath, size: item.size, mimeType: item.file.type })),
          chunkSize,
          ...shareOptions,
          ...(uploadConfig.sessionBody || {}),
        }),
      })
      session.sessionId = response.sessionId
      saveUploadResume(files, chunkSize, uploadConfig, shareOptions, session.sessionId)
    }
  }

  for (let fileIndex = session.fileIndex; fileIndex < files.length; fileIndex += 1) {
    const item = files[fileIndex]
    const totalChunks = Math.max(1, Math.ceil(item.size / chunkSize))
    const resumedDone = session.resumedChunks instanceof Map ? (session.resumedChunks.get(fileIndex) || []) : []
    const completedChunks = new Set(resumedDone)
    const startChunk = fileIndex === session.fileIndex ? session.chunkIndex : 0
    let nextChunk = Math.max(startChunk, 0)
    while (completedChunks.has(nextChunk)) nextChunk += 1
    let lowestIncomplete = nextChunk
    const inFlightProgress = new Map()
    let firstError = null
    const worker = async () => {
      while (!firstError) {
        if (session.paused) throw new UploadPausedError()
        const chunkIndex = nextChunk
        if (chunkIndex >= totalChunks) return
        nextChunk += 1
        const start = chunkIndex * chunkSize
        const end = Math.min(item.size, start + chunkSize)
        const chunkData = await item.file.slice(start, end).arrayBuffer()
        const chunkHash = await sha256Hex(chunkData)
        let attempt = 0
        while (attempt < 3) {
          try {
            onState(uploadStateFromProgress(session, session.uploadedBytes + [...inFlightProgress.values()].reduce((sum, value) => sum + value, 0), `上传 ${item.name}`, item.name, attempt))
            await xhrUploadChunk(`/api/upload-sessions/${session.sessionId}/chunks`, {
              fileIndex,
              chunkIndex,
              totalChunks,
              chunkData,
              chunkHash,
              filename: item.name,
            }, {
              uploadRef,
              onProgress: (loaded) => {
                inFlightProgress.set(chunkIndex, loaded)
                onState(uploadStateFromProgress(session, session.uploadedBytes + [...inFlightProgress.values()].reduce((sum, value) => sum + value, 0), `上传 ${item.name}`, item.name, attempt))
              },
            })
            inFlightProgress.delete(chunkIndex)
            completedChunks.add(chunkIndex)
            while (completedChunks.has(lowestIncomplete)) lowestIncomplete += 1
            session.chunkIndex = lowestIncomplete
            session.uploadedBytes += end - start
            onState(uploadStateFromProgress(session, session.uploadedBytes + [...inFlightProgress.values()].reduce((sum, value) => sum + value, 0), `上传 ${item.name}`, item.name, 0))
            break
          } catch (error) {
            inFlightProgress.delete(chunkIndex)
            if (error.name === 'UploadPausedError') throw error
            attempt += 1
            onState(uploadStateFromProgress(session, session.uploadedBytes, `分片失败，正在重试`, item.name, attempt, error.message))
            if (attempt >= 3) {
              firstError = error
              throw error
            }
            // 指数退避 + 抖动：500ms/1s/2s…封顶 8s，避免集体重试踩踏
            await wait(Math.min(8000, 500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250))
          }
        }
      }
    }
    const workers = Array.from({ length: Math.max(0, Math.min(concurrency, totalChunks - nextChunk)) }, () => worker())
    try {
      await Promise.all(workers)
    } catch (error) {
      if (error.name === 'UploadPausedError' || session.paused) throw new UploadPausedError()
      throw firstError || error
    }
    session.fileIndex = fileIndex + 1
    session.chunkIndex = 0
    onState(uploadStateFromProgress(session, session.uploadedBytes, `上传 ${item.name}`, item.name, 0))
  }

  onState({ status: 'finalizing', phase: '正在生成分享信息', progress: 100, uploadedBytes: session.totalBytes, totalBytes: session.totalBytes, speedBps: currentSpeed(session, session.totalBytes), etaSeconds: 0, currentFile: '', retryCount: 0, error: '' })
  const result = await apiRequest(`/api/upload-sessions/${session.sessionId}/complete`, {
    method: 'POST',
    body: JSON.stringify({ chunkSize, ...(uploadConfig.completeBody || {}) }),
  })
  clearUploadResume()
  return result
}

export function uploadStateFromProgress(session, loadedBytes, phase, currentFile, retryCount = 0, error = '') {
  const totalBytes = Math.max(session.totalBytes, 1)
  const speedBps = currentSpeed(session, loadedBytes)
  return {
    status: 'uploading',
    phase,
    progress: Math.min(99, Math.round((loadedBytes / totalBytes) * 100)),
    uploadedBytes: loadedBytes,
    totalBytes: session.totalBytes,
    speedBps,
    etaSeconds: speedBps ? Math.max(0, Math.round((session.totalBytes - loadedBytes) / speedBps)) : null,
    currentFile,
    retryCount,
    error,
  }
}

export class UploadPausedError extends Error {
  constructor() {
    super('上传已暂停')
    this.name = 'UploadPausedError'
  }
}
