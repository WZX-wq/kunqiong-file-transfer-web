// 传输基础设施：分片上传（跨刷新续传）+ 下载/预览配置构造。
// 从 src/main.jsx 拆出，纯函数为主，含 UploadPausedError。
import {
  UPLOAD_RESUME_KEY, UPLOAD_RESUME_TTL_MS, TEXT_PREVIEW_EXTENSIONS
} from './constants.js'
import {
  fileExtension, safeDownloadName, totalFileSize
} from './format.js'
import {
  UploadCancelledError, UploadPausedError, apiRequest, buildShareOptions, canUseImageClipboard, copyImageWithSelection,
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

export function createShareDownloadConfig(share, { password = '', managed = false } = {}) {
  const files = share.files || []
  return {
    url: managed && share.manageToken ? `${window.location.origin}/api/shares/manage/${encodeURIComponent(share.manageToken)}/download` : share.downloadUrl || `${window.location.origin}/api/shares/${encodeURIComponent(share.id)}/download`,
    filename: files.length === 1 ? files[0].name : '鲲穹文件包.zip',
    label: files.length === 1 ? `下载 ${files[0]?.name || '文件'}` : `打包下载 ${files.length} 个文件`,
    totalBytes: totalFileSize(files),
    headers: password ? { 'x-share-password': password } : {},
  }
}

export function createShareFilePreviewConfig(share, file, fileIndex, options = {}) {
  const base = options.managed && share.manageToken
    ? `${window.location.origin}/api/shares/manage/${encodeURIComponent(share.manageToken)}/files/${fileIndex}`
    : `${window.location.origin}/api/shares/${encodeURIComponent(share.id)}/files/${fileIndex}`
  return {
    file,
    kind: previewKind(file),
    url: `${base}/preview`,
    headers: options.password ? { 'x-share-password': options.password } : undefined,
    unlockUrl: share.code && !options.managed ? `/api/shares/lookup/${encodeURIComponent(share.code)}` : '',
    downloadConfig: { ...createShareFileDownloadConfig(share, file, fileIndex, options), url: `${base}/download` },
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
      .map((file, index) => canPreviewFile(file) ? { ...createShareFilePreviewConfig({ id: shareId, code: record.code, manageToken: record.manageToken }, file, index, { managed: record.scope === 'my_sent' && Boolean(record.manageToken) }), key: `share:${shareId}:${index}` } : null)
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

function uploadResumeKey(config = {}) {
  return config.resumeScope ? `${UPLOAD_RESUME_KEY}:${config.resumeScope}` : UPLOAD_RESUME_KEY
}

export function readUploadResume(config = {}) {
  try { return JSON.parse(localStorage.getItem(uploadResumeKey(config)) || 'null') } catch { return null }
}

export function saveUploadResume(files, chunkSize, uploadConfig, shareOptions, sessionId) {
  try {
    localStorage.setItem(uploadResumeKey(uploadConfig), JSON.stringify({ sessionId, chunkSize, savedAt: Date.now(), signature: uploadResumeSignature(files, chunkSize, uploadConfig, shareOptions) }))
  } catch { /* 存储满/隐私模式忽略，退化为普通续传 */ }
}

export function clearUploadResume(config = {}, sessionId = '') {
  try {
    if (!sessionId || readUploadResume(config)?.sessionId === sessionId) localStorage.removeItem(uploadResumeKey(config))
  } catch { /* 忽略 */ }
}

// Cancellation is terminal for this object; pause keeps its chunks for resumption.
// The ID can arrive after cancellation when session creation was still pending.
export function cancelUploadSession(session, config = {}) {
  session.cancelled = true
  session.paused = true
  session.abortCurrent?.()
  if (!session.sessionId) return Promise.resolve()
  clearUploadResume(config, session.sessionId)
  if (session.cleanupSessionId !== session.sessionId) {
    session.cleanupSessionId = session.sessionId
    session.cleanupPromise = apiRequest(`/api/upload-sessions/${encodeURIComponent(session.sessionId)}`, { method: 'DELETE' })
      .catch(error => { if (![404, 410].includes(error.status)) throw error })
  }
  return session.cleanupPromise
}

export function readCollectionUploadResume(token) {
  const config = { resumeScope: `collection:${token}` }
  let entry = readUploadResume(config)
  // Migrate an unfinished collection upload created by the previous UI.
  if (!entry) {
    const legacy = readUploadResume()
    try {
      const manifest = JSON.parse(legacy?.signature || 'null')
      if (manifest?.mode?.mode === 'collection' && manifest.mode.collectionToken === token) {
        localStorage.setItem(uploadResumeKey(config), JSON.stringify(legacy))
        clearUploadResume({}, legacy.sessionId)
        entry = legacy
      }
    } catch { /* No valid legacy record. */ }
  }
  try {
    const manifest = JSON.parse(entry?.signature || 'null')
    if (!entry?.sessionId || manifest?.mode?.mode !== 'collection' || manifest.mode.collectionToken !== token || !Array.isArray(manifest.files)) return null
    return { ...entry, files: manifest.files, fileLastModified: manifest.mode.fileLastModified, participantName: manifest.mode.participantName || '' }
  } catch { return null }
}

export async function queryUploadResume(entry) {
  const data = await apiRequest(`/api/upload-sessions/${encodeURIComponent(entry.sessionId)}`)
  const files = entry.files || JSON.parse(entry.signature).files
  if (Number(data.chunkSize) !== Number(entry.chunkSize) || data.files?.length !== files.length) throw new Error('上传会话的文件清单不一致')
  let uploadedBytes = 0
  const resumedChunks = new Map()
  data.files.forEach((remote, index) => {
    const file = files[index]
    if (remote.name !== file.name || Number(remote.size) !== file.size || (remote.relativePath && remote.relativePath !== file.relativePath)) throw new Error('上传会话的文件清单不一致')
    const done = [...new Set(remote.uploadedChunks || [])].filter((i) => Number.isInteger(i) && i >= 0 && i < Math.max(1, Math.ceil(file.size / entry.chunkSize)))
    resumedChunks.set(index, done)
    done.forEach((i) => { uploadedBytes += Math.min(entry.chunkSize, Math.max(0, file.size - i * entry.chunkSize)) })
  })
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
  return { ...entry, files, resumedChunks, uploadedBytes, totalBytes, progress: totalBytes ? Math.floor(uploadedBytes / totalBytes * 100) : 0 }
}

// 跨刷新续传：刷新/重启后用 localStorage 里的会话指纹换回已传分片清单，
// 文件清单、分片配置、分享参数任一变化即放弃续传重新开session。
export async function tryResumeUploadSession(files, chunkSize, uploadConfig, shareOptions, session) {
  const entry = readUploadResume(uploadConfig)
  if (!entry?.sessionId) return false
  // 明确不可续传（过期/清单变化/服务端不一致）时标记 abandon：
  // 同步中止服务端旧会话释放其预留额度；网络故障等未知错误不中止，保留续传可能。
  const abandon = (message) => {
    const error = new Error(message)
    error.resumeAbandoned = true
    throw error
  }
  try {
    if (Date.now() - Number(entry.savedAt) > UPLOAD_RESUME_TTL_MS) abandon('上传会话已过期')
    if (Number(entry.chunkSize) !== chunkSize || entry.signature !== uploadResumeSignature(files, chunkSize, uploadConfig, shareOptions)) abandon('文件清单变化')
    const restored = await queryUploadResume(entry)
    session.sessionId = entry.sessionId
    session.resumedChunks = restored.resumedChunks
    session.uploadedBytes = restored.uploadedBytes
    return true
  } catch (error) {
    // A temporary query failure must not erase the only route back to the session.
    if (!error.resumeAbandoned && ![404, 410].includes(error.status)) throw error
    if (error?.resumeAbandoned) {
      await apiRequest(`/api/upload-sessions/${encodeURIComponent(entry.sessionId)}`, { method: 'DELETE' })
        .catch(cleanupError => { if (![404, 410].includes(cleanupError.status)) throw cleanupError })
    }
    clearUploadResume(uploadConfig, entry.sessionId)
    if (uploadConfig.resumeScope) throw error
    return false
  }
}

export async function uploadShareInChunks(files, settings, uploadRef, onState, uploadConfig = {}) {
  let chunkSize = uploadConfig.resumeScope ? Number(readUploadResume(uploadConfig)?.chunkSize) || pickUploadChunkSize(files) : pickUploadChunkSize(files)
  const concurrency = Math.min(4, Math.max(2, Number(navigator.hardwareConcurrency || 4) >= 8 ? 4 : 2))
  const session = uploadRef.current
  // Each run owns one immutable session reference, including its concurrent XHRs.
  const sessionRef = { current: session }
  const assertActive = () => {
    if (session.cancelled || uploadRef.current !== session) throw new UploadCancelledError()
    if (session.paused) throw new UploadPausedError()
  }
  const report = state => { assertActive(); onState(state) }
  assertActive()
  session.totalBytes = files.reduce((sum, item) => sum + item.size, 0)
  session.startedAt = session.startedAt || Date.now()
  const shareOptions = buildShareOptions(settings)

  if (!session.sessionId) {
    report({ status: 'uploading', phase: '创建上传会话', progress: 0, totalBytes: session.totalBytes, uploadedBytes: 0, speedBps: 0, etaSeconds: null, currentFile: '', retryCount: 0, error: '' })
    const resumed = await tryResumeUploadSession(files, chunkSize, uploadConfig, shareOptions, session)
    if (session.cancelled || uploadRef.current !== session) {
      await cancelUploadSession(session, uploadConfig)
      throw new UploadCancelledError()
    }
    if (resumed) {
      // Pausing while querying progress still preserves the restored session.
      assertActive()
      report(uploadStateFromProgress(session, session.uploadedBytes, '已恢复上次上传进度', '', 0))
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
      if (session.cancelled || uploadRef.current !== session) {
        await cancelUploadSession(session, uploadConfig)
        throw new UploadCancelledError()
      }
      if (Number.isSafeInteger(response.chunkSize) && response.chunkSize >= 1024*1024 && response.chunkSize <= 16*1024*1024) chunkSize = response.chunkSize
      saveUploadResume(files, chunkSize, uploadConfig, shareOptions, session.sessionId)
    }
  }

  assertActive()

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
        assertActive()
        while (completedChunks.has(nextChunk)) nextChunk += 1
        const chunkIndex = nextChunk
        if (chunkIndex >= totalChunks) return
        nextChunk += 1
        const start = chunkIndex * chunkSize
        const end = Math.min(item.size, start + chunkSize)
        const chunkData = await item.file.slice(start, end).arrayBuffer()
        const chunkHash = await sha256Hex(chunkData)
        let attempt = 0
        while (attempt < 3) {
          assertActive()
          if (firstError) return
          try {
            report(uploadStateFromProgress(session, session.uploadedBytes + [...inFlightProgress.values()].reduce((sum, value) => sum + value, 0), `上传 ${item.name}`, item.name, attempt))
            await xhrUploadChunk(`/api/upload-sessions/${session.sessionId}/chunks`, {
              fileIndex,
              chunkIndex,
              totalChunks,
              chunkData,
              chunkHash,
              filename: item.name,
            }, {
              uploadRef: sessionRef,
              onProgress: (loaded) => {
                if (session.cancelled || session.paused || uploadRef.current !== session || firstError) return
                inFlightProgress.set(chunkIndex, loaded)
                report(uploadStateFromProgress(session, session.uploadedBytes + [...inFlightProgress.values()].reduce((sum, value) => sum + value, 0), `上传 ${item.name}`, item.name, attempt))
              },
            })
            assertActive()
            inFlightProgress.delete(chunkIndex)
            completedChunks.add(chunkIndex)
            if (!(session.resumedChunks instanceof Map)) session.resumedChunks = new Map()
            session.resumedChunks.set(fileIndex, [...completedChunks])
            while (completedChunks.has(lowestIncomplete)) lowestIncomplete += 1
            session.chunkIndex = lowestIncomplete
            session.uploadedBytes += end - start
            report(uploadStateFromProgress(session, session.uploadedBytes + [...inFlightProgress.values()].reduce((sum, value) => sum + value, 0), `上传 ${item.name}`, item.name, 0))
            break
          } catch (error) {
            inFlightProgress.delete(chunkIndex)
            assertActive()
            if (firstError) throw firstError
            // Invalid/expired sessions cannot recover through repeated chunk requests.
            if (error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status)) {
              firstError = error
              if ([404, 410].includes(error.status)) {
                clearUploadResume(uploadConfig, session.sessionId)
                error.restartUpload = true
              }
              session.abortCurrent?.()
              throw error
            }
            attempt += 1
            report(uploadStateFromProgress(session, session.uploadedBytes, `分片失败，正在重试`, item.name, attempt, error.message))
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
    const outcomes = await Promise.allSettled(workers)
    const error = outcomes.find((outcome) => outcome.status === 'rejected')?.reason
    assertActive()
    if (error) throw firstError || error
    session.fileIndex = fileIndex + 1
    session.chunkIndex = 0
    report(uploadStateFromProgress(session, session.uploadedBytes, `上传 ${item.name}`, item.name, 0))
  }

  assertActive()
  report({ status: 'finalizing', phase: '文件已上传，正在进行安全检查', progress: 100, uploadedBytes: session.totalBytes, totalBytes: session.totalBytes, speedBps: currentSpeed(session, session.totalBytes), etaSeconds: 0, currentFile: '', retryCount: 0, error: '' })
  let result
  try {
    result = await apiRequest(`/api/upload-sessions/${session.sessionId}/complete`, {
      method: 'POST',
      body: JSON.stringify({ chunkSize, ...(uploadConfig.completeBody || {}) }),
    })
  } catch (error) {
    if ([404, 410].includes(error.status)) {
      clearUploadResume(uploadConfig, session.sessionId)
      error.restartUpload = true
    }
    throw error
  }
  assertActive()
  clearUploadResume(uploadConfig, session.sessionId)
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
