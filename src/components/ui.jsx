import { collectionSizeOptions } from '../lib/plan-limits.js'
export { UserAvatar, userAvatarSource, displayUserInitial, displayUserSubtitle } from './account.jsx'
import React from 'react'
import { sanitizeOfficeHtml } from '../office-html.js'
import { readTextPreview } from '../lib/text-preview.js'
import { Building2, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Download, Eye, FileText, Link2, PencilLine, RefreshCw, RotateCcw, UserPlus, UserRound, X } from 'lucide-react'
import { apiRequest, downloadResponseError, downloadStatusText } from '../lib/api.js'
import { addMonths, formatBytes, formatDateInput, formatDuration, formatLimitSize, isClosedStatus, parseLocalDate, splitFileNameForDisplay, startOfMonth } from '../lib/format.js'
import { useEffect, useRef, useState } from 'react'
import { previewSupportLabel, previewTypeLabel } from '../lib/transfer.js'
import { FeedbackMessage } from './common.jsx'
import { COLLECTION_DESCRIPTION_MAX, COLLECTION_TITLE_MAX, COLLECTION_TYPE_OPTIONS, TEXT_PREVIEW_MAX_BYTES, fileIcon } from '../lib/constants.js'
import { createCollectionManageForm, createShareManageForm, fileFormatLabel, formatAllowedTypes, formatDateInputDisplay, getManageToken, isClosedOrExpiredStatus, isDateInputStillOpen, normalizeCollectionTypes, recordDisplayName, recordExpiryLabel, recordScopeLabel, toggleCollectionType } from '../lib/records.js'
import { OFFICE_PREVIEW_LIMITS, assertOfficeFileSize, createOfficePreviewSession, readPreviewResponse, spreadsheetSheetHtml as boundedSpreadsheetSheetHtml } from '../lib/office-preview.js'
import { limitInputText } from '../lib/input-limits.js'

export function DownloadProgressPanel({ task, onRetry }) {
  if (!task || task.status === 'idle') return null
  if (task.status === 'handed_off') return <div className="progress-wrap download-progress"><div className="progress-label"><span>已交给浏览器下载</span><Download size={16} /></div>{task.filename && <small>{task.filename}</small>}</div>
  const busy = ['preparing', 'downloading', 'saving'].includes(task.status)
  const statusText = task.needsPassword ? '需要提取密码' : downloadStatusText(task)
  const remainingText = task.status === 'complete' ? '已完成' : formatDuration(task.etaSeconds)
  const progress = task.totalBytes ? Math.min(100, Math.max(0, task.progress || 0)) : task.status === 'complete' ? 100 : task.progress || 0
  const trackWidth = task.totalBytes || task.status === 'complete' ? progress : busy ? 18 : 0
  return (
    <div className={`progress-wrap enhanced-progress download-progress ${task.status}`}>
      <div className="progress-label"><span>{statusText}</span><strong>{task.totalBytes ? `${progress}%` : formatBytes(task.loadedBytes)}</strong></div>
      <div className="progress-track"><span style={{ width: `${trackWidth}%` }} /></div>
      <div className="upload-metrics">
        <span>已下 {formatBytes(task.loadedBytes)}{task.totalBytes ? ` / ${formatBytes(task.totalBytes)}` : ''}</span>
        <span>速度 {task.speedBps ? `${formatBytes(task.speedBps)}/s` : '计算中'}</span>
        <span>{task.status === 'complete' ? '状态' : '剩余'} {remainingText}</span>
      </div>
      {task.filename && <small>文件：{task.filename}</small>}
      {task.canResume && <small>单文件服务端已开启 Range，可被浏览器用于断点续传。</small>}
      {task.isEstimated && <small>ZIP 为实时压缩生成，进度按原文件大小估算。</small>}
      {task.retryCount > 0 && <small>已重试 {task.retryCount} 次</small>}
      {task.status === 'complete' && <small>已调用浏览器保存，请在下载列表查看。</small>}
      {task.error && <p className="upload-error">{task.error}</p>}
      {task.status === 'failed' && task.needsPassword && <DownloadPasswordForm onUnlock={onRetry} />}
      {task.status === 'failed' && !task.needsPassword && (
        <div className="upload-control-row">
          <button className="primary-button" onClick={() => onRetry()}><RotateCcw size={15} /> 重试下载</button>
        </div>
      )}
    </div>
  )
}

function DownloadPasswordForm({ onUnlock }) {
  const [password, setPassword] = useState('')
  return <form className="public-password" onSubmit={(event) => { event.preventDefault(); if (password) onUnlock(password) }}>
    <input type="password" aria-label="提取密码" value={password} maxLength={128} autoFocus autoComplete="off" onChange={(event) => setPassword(limitInputText(event.target.value, 128))} placeholder="请输入提取密码，最多 128 个字符" />
    <button type="submit" className="primary-button" disabled={!password}>验证并下载</button>
  </form>
}

export function QrPreviewModal({ title, detail, qrDataUrl, targetUrl, onClose, onCopyImage, onCopyLink }) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal qr-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="ghost-icon modal-close" aria-label="关闭二维码预览" title="关闭二维码预览" onClick={onClose}><X size={18} /></button>
        <div className="qr-modal-body">
          <p className="eyebrow">二维码预览</p>
          <h2>{title}</h2>
          <p>{detail}</p>
          <img className="qr-preview-image" src={qrDataUrl} alt={title} />
          <div className="qr-preview-link"><Link2 size={14} /><span>{targetUrl}</span></div>
        </div>
        <div className="modal-footer qr-modal-footer">
          <button className="secondary-button" onClick={onCopyLink}><Copy size={15} /> 复制链接</button>
          <button className="primary-button" onClick={onCopyImage}><Copy size={15} /> 复制图片</button>
        </div>
      </div>
    </div>
  )
}

export function ContentModal({ content, onClose }) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  if (!content) return null

  return (
    <div className="modal-backdrop content-backdrop" onMouseDown={onClose}>
      <div className="modal content-modal" role="dialog" aria-modal="true" aria-labelledby="content-modal-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header content-modal-header">
          <div><p className="eyebrow">{content.eyebrow}</p><h2 id="content-modal-title">{content.title}</h2></div>
          <button className="ghost-icon modal-close" aria-label={`关闭${content.title}`} onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body content-modal-body">
          {content.sections.map((section) => (
            <section className="content-section" key={section.title}>
              <h3>{section.title}</h3>
              <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul>
            </section>
          ))}
        </div>
        <div className="modal-footer">
          <button className="primary-button" onClick={onClose}><Check size={15} /> 我知道了</button>
        </div>
      </div>
    </div>
  )
}

export function FilePreviewModal({ preview, onClose, onDownload, downloadDisabled = false }) {
  const [error, setError] = useState('')
  const [downloadError, setDownloadError] = useState('')
  const [access, setAccess] = useState({ url: '', status: 'loading', error: '' })
  const [password, setPassword] = useState('')
  const [unlocking, setUnlocking] = useState(false)
  const [accessAttempt, setAccessAttempt] = useState(0)
  const [unlockedUrl, setUnlockedUrl] = useState('')
  const unlocked = unlockedUrl === preview?.url
  const previewHeaders = unlocked ? undefined : preview?.headers

  useEffect(() => {
    if (!preview?.url) return
    const controller = new AbortController()
    setError('')
    setDownloadError('')
    setAccess({ url: preview.url, status: 'loading', error: '' })
    const checkAccess = async () => {
      try {
        if (!unlocked && preview.unlockUrl && preview.headers?.['x-share-password']) {
          const unlockResponse = await fetch(preview.unlockUrl, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: preview.headers['x-share-password'] }), signal: controller.signal })
          if (!unlockResponse.ok) throw await downloadResponseError(unlockResponse)
          if (!controller.signal.aborted) setUnlockedUrl(preview.url)
          return
        }
        const response = await fetch(preview.url, { method: 'HEAD', credentials: 'include', headers: previewHeaders || {}, signal: controller.signal })
        if (!response.ok) throw await downloadResponseError(response)
        if (!controller.signal.aborted) setAccess({ url: preview.url, status: 'ready', error: '' })
      } catch (requestError) {
        if (controller.signal.aborted) return
        const needsPassword = preview.unlockUrl && [401, 403].includes(requestError.status) && /提取密码/.test(requestError.message)
        setAccess({ url: preview.url, status: needsPassword ? 'password' : 'error', error: requestError.message || '预览加载失败，请稍后重试。' })
      }
    }
    checkAccess()
    return () => controller.abort()
  }, [preview?.url, previewHeaders, unlocked, accessAttempt])

  useEffect(() => { setPassword('') }, [preview?.url])

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  if (!preview) return null
  const file = preview.file || {}
  const ready = access.url === preview.url && access.status === 'ready'
  const previewError = error || (access.url === preview.url && access.status === 'error' ? access.error : '')
  const authorizedPreview = unlocked ? { ...preview, headers: undefined, downloadConfig: preview.downloadConfig ? { ...preview.downloadConfig, headers: {} } : undefined } : preview
  const unlockPreview = async (event) => {
    event.preventDefault()
    if (!password || unlocking) return
    if (password.length > 128) {
      setAccess({ url: preview.url, status: 'password', error: '提取密码不能超过 128 个字符' })
      return
    }
    setUnlocking(true)
    try {
      // 提取密码错误的 401 不代表账号会话失效。
      const response = await fetch(preview.unlockUrl, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
      if (!response.ok) throw await downloadResponseError(response)
      setPassword('')
      setUnlockedUrl(preview.url)
      setAccessAttempt((attempt) => attempt + 1)
    } catch (requestError) {
      setAccess({ url: preview.url, status: 'password', error: requestError.message || '密码验证失败' })
    } finally {
      setUnlocking(false)
    }
  }
  const handleDownload = async () => {
    if (!onDownload) return
    setDownloadError('')
    try {
      const result = await onDownload(authorizedPreview.downloadConfig)
      if (result?.ok === false) setDownloadError(result.error || '下载失败')
    } catch (downloadException) {
      setDownloadError(downloadException.message || '下载失败')
    }
  }
  return (
    <div className="modal-backdrop preview-backdrop" onMouseDown={onClose}>
      <div className={`modal preview-modal ${preview.kind}`} role="dialog" aria-modal="true" aria-label={`${file.name || '文件'}预览`} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header preview-modal-header">
          <div>
            <p className="eyebrow">{previewTypeLabel(preview.kind)}预览</p>
            <h2>{file.name || '文件预览'}</h2>
            <span className="preview-meta">{file.relativePath || file.name} · {formatBytes(file.size)}</span>
          </div>
          <button className="ghost-icon modal-close" aria-label="关闭预览" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="preview-modal-body">
          {previewError ? <div className="preview-error"><FileText size={28} /><strong>预览加载失败</strong><span>{previewError}</span></div>
            : access.url === preview.url && access.status === 'password' ? (
              <form className="preview-error" onSubmit={unlockPreview}>
                <FileText size={28} /><strong>此文件需要提取密码</strong><span>{access.error}</span>
                <div className="public-password"><input type="password" aria-label="提取密码" placeholder="请输入提取密码，最多 128 个字符" autoComplete="off" maxLength={128} value={password} onChange={(event) => setPassword(limitInputText(event.target.value, 128))} /><button type="submit" className="primary-button" disabled={unlocking || !password}>{unlocking ? '验证中' : '验证并预览'}</button></div>
                <small>{password.length}/128 个字符</small>
              </form>
            ) : ready ? renderPreviewContent(authorizedPreview, () => setError('浏览器无法打开这个文件，可下载后查看。'))
              : <div className="office-preview-loading"><span className="loading-dot" /><strong>正在加载预览</strong></div>}
        </div>
        <div className="modal-footer preview-modal-footer">
          <span>{previewSupportLabel(preview.kind)}</span>
          {downloadError && <FeedbackMessage message={downloadError} tone="error" />}
          <button className="secondary-button" onClick={handleDownload} disabled={downloadDisabled || !ready}><Download size={15} /> 下载文件</button>
        </div>
      </div>
    </div>
  )
}

export function RecordPreviewChooser({ previews, onClose, onSelect }) {
  return (
    <div className="modal-backdrop preview-backdrop" onMouseDown={onClose}>
      <div className="modal record-preview-chooser" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">文件预览</p>
            <h2>选择要预览的文件</h2>
          </div>
          <button className="ghost-icon modal-close" aria-label="关闭文件选择" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="record-preview-options">
          {previews.map((preview) => (
            <button type="button" className="record-preview-option" key={preview.key} onClick={() => onSelect(preview)}>
              <span className="record-preview-option-icon"><FileText size={17} /></span>
              <span><strong>{preview.file.name}</strong><small>{previewTypeLabel(preview.kind)} · {formatBytes(preview.file.size)}</small></span>
              <ChevronRight size={16} />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export function renderPreviewContent(preview, onError) {
  const title = preview.file?.name || '文件预览'
  if (preview.kind === 'image') return <img className="preview-image" src={preview.url} alt={title} onError={onError} />
  if (preview.kind === 'pdf') return <iframe className="preview-frame" src={preview.url} title={title} onError={onError} />
  if (preview.kind === 'video') return <video className="preview-video" src={preview.url} controls preload="metadata" onError={onError} />
  if (preview.kind === 'audio') {
    return (
      <div className="preview-audio-shell">
        <span className="preview-audio-icon"><FileText size={28} /></span>
        <strong>{title}</strong>
        <audio className="preview-audio" src={preview.url} controls preload="metadata" onError={onError} />
      </div>
    )
  }
  if (preview.kind === 'document' || preview.kind === 'spreadsheet' || preview.kind === 'presentation') {
    return <OfficePreview preview={preview} onError={onError} />
  }
  if (preview.kind === 'text') return <TextPreview preview={preview} onError={onError} />
  return <div className="preview-error"><FileText size={28} /><strong>暂不支持预览</strong><span>请下载后查看这个文件。</span></div>
}

export function TextPreview({ preview }) {
  const [state, setState] = useState({ status: 'loading', content: '', truncated: false, error: '' })

  useEffect(() => {
    const controller = new AbortController()
    setState({ status:'loading', content:'', truncated:false, error:'' })
    const loadPreview = async () => {
      try {
        const response = await fetch(preview.url, { credentials:'include', signal:controller.signal, headers:{ ...preview.headers, Range:`bytes=0-${TEXT_PREVIEW_MAX_BYTES}` } })
        if (!response.ok) throw await downloadResponseError(response)
        const result = await readTextPreview(response, TEXT_PREVIEW_MAX_BYTES, controller.signal)
        if (!controller.signal.aborted) setState({ status:'ready', ...result, error:'' })
      } catch (error) {
        if (!controller.signal.aborted) setState({ status:'error', content:'', truncated:false, error:error.message || '文件解析失败' })
      }
    }
    loadPreview()
    return () => controller.abort()
  }, [preview.url, preview.headers])

  if (state.status === 'loading') return <div className="office-preview-loading"><span className="loading-dot" /><strong>正在生成预览</strong><span>文件只在当前浏览器中解析，不会自动下载。</span></div>
  if (state.status === 'error') return <div className="preview-error"><FileText size={28} /><strong>预览加载失败</strong><span>{state.error}</span></div>
  return (
    <div className="text-preview-shell">
      {state.truncated && <div className="text-preview-truncated">文件较大，仅显示前 512 KB，完整内容请下载查看。</div>}
      <pre className="text-preview">{state.content}</pre>
    </div>
  )
}

export function OfficePreview({ preview }) {
  const [state, setState] = useState({ status: 'loading', html: '', sheets: [], activeSheet: 0, page: 0, pages: 1, changingPage: false, error: '' })
  const canvasRef = useRef(null)
  const viewerRef = useRef(null)
  const sessionRef = useRef(null)
  const pageRequestRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    let deadline
    setState({ status: 'loading', html: '', sheets: [], activeSheet: 0, page: 0, pages: 1, changingPage: false, error: '' })
    const stopLoading = () => {
      if (cancelled) return
      controller.abort()
      sessionRef.current?.close()
      viewerRef.current?.destroy?.()
      setState((current) => ({ ...current, status: 'error', error: '预览加载超时，已停止解析，请下载后查看。' }))
    }
    deadline = setTimeout(stopLoading, OFFICE_PREVIEW_LIMITS.timeoutMs * 2)
    const loadPreview = async () => {
      try {
        if (preview.file?.size !== undefined) assertOfficeFileSize(preview.file.size, preview.kind)
        const response = await fetch(preview.url, { credentials: 'include', headers: preview.headers || {}, signal: controller.signal })
        if (!response.ok) throw await downloadResponseError(response)
        const buffer = await readPreviewResponse(response, { kind: preview.kind, signal: controller.signal })
        if (cancelled || controller.signal.aborted) return
        const session = createOfficePreviewSession({ signal: controller.signal, workerFactory: () => {
          if (typeof Worker === 'undefined') throw new Error('浏览器不支持安全的 Office 预览，请下载后查看。')
          return new Worker(new URL('../workers/office-preview.js', import.meta.url), { type: 'module' })
        } })
        sessionRef.current = session
        const result = await session.request('parse', { kind: preview.kind, buffer }, [buffer])
        if (cancelled || controller.signal.aborted) return
        if (preview.kind === 'document') {
          session.close()
          setState((current) => ({ ...current, status: 'ready', html: sanitizeOfficeHtml(result.html), error: '' }))
          return
        }
        if (preview.kind === 'spreadsheet') {
          setState((current) => ({ ...current, status: 'ready', html: sanitizeOfficeHtml(result.html), sheets: result.sheets, page: result.page, pages: result.pages, activeSheet: 0, error: '' }))
          return
        }
        if (preview.kind === 'presentation') {
          session.close()
          if (!canvasRef.current) throw new Error('演示文稿画布初始化失败')
          const { PPTXViewer } = await import('pptxviewjs')
          if (cancelled || controller.signal.aborted) return
          const viewer = new PPTXViewer({ canvas: canvasRef.current })
          viewerRef.current = viewer
          await viewer.loadFile(result.buffer)
          if (cancelled || controller.signal.aborted) { viewer.destroy?.(); return }
          await viewer.render()
          if (!cancelled && !controller.signal.aborted) setState((current) => ({ ...current, status: 'ready', error: '' }))
        }
      } catch (error) {
        sessionRef.current?.close()
        if (!cancelled && !controller.signal.aborted) setState((current) => ({ ...current, status: 'error', html: '', error: error.message || '文件解析失败' }))
      } finally { clearTimeout(deadline) }
    }
    loadPreview()
    return () => {
      cancelled = true
      pageRequestRef.current++
      clearTimeout(deadline)
      controller.abort()
      sessionRef.current?.close()
      sessionRef.current = null
      viewerRef.current?.destroy?.()
      viewerRef.current = null
    }
  }, [preview.url, preview.kind, preview.headers])

  const showSheetPage = async (sheet, page) => {
    if (!sessionRef.current || state.changingPage) return
    const request = ++pageRequestRef.current
    setState((current) => ({ ...current, changingPage: true }))
    try {
      const result = await sessionRef.current.request('page', { sheet, page })
      if (request === pageRequestRef.current) setState((current) => ({ ...current, html: sanitizeOfficeHtml(result.html), activeSheet: sheet, page: result.page, pages: result.pages, changingPage: false }))
    } catch (error) {
      if (request === pageRequestRef.current) setState((current) => ({ ...current, status: 'error', error: error.message || '工作表预览失败', changingPage: false }))
    }
  }

  if (preview.kind === 'presentation') {
    return (
      <div className="presentation-preview">
        <canvas ref={canvasRef} />
        {state.status === 'loading' && <div className="office-preview-overlay"><span className="loading-dot" /><strong>正在生成预览</strong><span>文件只在当前浏览器中解析，不会自动下载。</span></div>}
        {state.status === 'error' && <div className="office-preview-overlay preview-error"><FileText size={28} /><strong>预览加载失败</strong><span>{state.error}</span></div>}
      </div>
    )
  }
  if (state.status === 'loading') return <div className="office-preview-loading"><span className="loading-dot" /><strong>正在生成预览</strong><span>文件只在当前浏览器中解析，不会自动下载。</span></div>
  if (state.status === 'error') return <div className="preview-error"><FileText size={28} /><strong>预览加载失败</strong><span>{state.error}</span></div>
  if (preview.kind === 'document') return <article className="document-preview" dangerouslySetInnerHTML={{ __html: state.html }} />
  if (preview.kind === 'spreadsheet') {
    return (
      <div className="spreadsheet-preview">
        <div className="spreadsheet-tabs" role="tablist" aria-label="工作表">{state.sheets.map((sheet, index) => <span role="tab" tabIndex={state.changingPage ? -1 : 0} aria-selected={index === state.activeSheet} aria-disabled={state.changingPage} className={index === state.activeSheet ? 'active' : ''} key={sheet.name} onClick={() => showSheetPage(index, 0)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showSheetPage(index, 0) } }}>{sheet.name}</span>)}</div>
        {state.pages > 1 && <div className="upload-control-row"><button type="button" className="secondary-button" disabled={state.changingPage || state.page === 0} onClick={() => showSheetPage(state.activeSheet, state.page - 1)}><ChevronLeft size={14} /> 上一页</button><span>第 {state.page + 1}/{state.pages} 页 · 每页最多 {OFFICE_PREVIEW_LIMITS.rowsPerPage} 行</span><button type="button" className="secondary-button" disabled={state.changingPage || state.page + 1 >= state.pages} onClick={() => showSheetPage(state.activeSheet, state.page + 1)}>下一页 <ChevronRight size={14} /></button></div>}
        <div className="spreadsheet-sheet" style={{ display: 'block' }} aria-busy={state.changingPage} dangerouslySetInnerHTML={{ __html: state.html }} />
      </div>
    )
  }
  return null
}

export function spreadsheetSheetHtml(sheet) {
  return boundedSpreadsheetSheetHtml(sheet)
}

export function CollectionLimitInfo({ allowedTypes, maxFileSizeMb, compact = false }) {
  return (
    <div className={`collection-limit ${compact ? 'compact' : ''}`}>
      <span>文件类型：{formatAllowedTypes(allowedTypes)}</span>
      <span>单文件上限：{formatLimitSize(maxFileSizeMb)}</span>
    </div>
  )
}

export function DatePicker({ value, onChange, ariaLabel, placeholder = '选择日期', className = '', min = '' }) {
  const pickerRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [viewDate, setViewDate] = useState(() => startOfMonth(parseLocalDate(value) || new Date()))

  useEffect(() => {
    if (value) setViewDate(startOfMonth(parseLocalDate(value) || new Date()))
  }, [value])

  useEffect(() => {
    if (!open) return undefined
    const handleOutsideClick = (event) => {
      if (!pickerRef.current?.contains(event.target)) setOpen(false)
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('click', handleOutsideClick)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('click', handleOutsideClick)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const monthStart = startOfMonth(viewDate)
  const leadingDays = (monthStart.getDay() + 6) % 7
  const calendarDays = Array.from({ length: 42 }, (_, index) => {
    const day = index - leadingDays + 1
    return new Date(monthStart.getFullYear(), monthStart.getMonth(), day)
  })
  const todayValue = formatDateInput(new Date())
  const monthLabel = `${monthStart.getFullYear()}年${monthStart.getMonth() + 1}月`

  const chooseDate = (date) => {
    const dateValue = formatDateInput(date)
    if (min && dateValue < min) return
    onChange(dateValue)
    setOpen(false)
  }

  const setToday = () => chooseDate(new Date())
  const clearDate = () => {
    onChange('')
    setOpen(false)
  }

  return (
    <div className={`date-picker ${className}`} ref={pickerRef}>
      <button type="button" className={`date-picker-trigger ${open ? 'open' : ''}`} aria-label={ariaLabel} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <CalendarDays size={15} />
        <span className={value ? '' : 'placeholder'}>{value ? formatDateInputDisplay(value) : placeholder}</span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="date-picker-popover" role="dialog" aria-label={`${ariaLabel}日期选择`}>
          <div className="date-picker-header">
            <button type="button" className="date-picker-nav" aria-label="上个月" title="上个月" onClick={() => setViewDate((current) => addMonths(current, -1))}><ChevronLeft size={16} /></button>
            <strong>{monthLabel}</strong>
            <button type="button" className="date-picker-nav" aria-label="下个月" title="下个月" onClick={() => setViewDate((current) => addMonths(current, 1))}><ChevronRight size={16} /></button>
          </div>
          <div className="date-picker-weekdays">{['一', '二', '三', '四', '五', '六', '日'].map((day) => <span key={day}>{day}</span>)}</div>
          <div className="date-picker-grid">
            {calendarDays.map((date) => {
              const dateValue = formatDateInput(date)
              const isCurrentMonth = date.getMonth() === monthStart.getMonth()
              const isSelected = dateValue === value
              const isToday = dateValue === todayValue
              const isDisabled = Boolean(min && dateValue < min)
              return (
                <button type="button" key={dateValue} className={`date-picker-day ${isCurrentMonth ? '' : 'outside'} ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''}`} disabled={isDisabled} onClick={() => chooseDate(date)}>
                  {date.getDate()}
                </button>
              )
            })}
          </div>
          <div className="date-picker-footer">
            <button type="button" onClick={clearDate} disabled={!value}>清除</button>
            <button type="button" onClick={setToday} disabled={Boolean(min && todayValue < min)}>今天</button>
          </div>
        </div>
      )}
    </div>
  )
}

export function TeamJoinRequestCard({ enterpriseSlug }) {
  const [state, setState] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    if (!enterpriseSlug) return undefined
    let active = true
    apiRequest(`/api/organizations/${encodeURIComponent(enterpriseSlug)}/join-request`)
      .then((result) => { if (active) setState(result) })
      .catch(() => { if (active) setLoadFailed(true) })
    return () => { active = false }
  }, [enterpriseSlug])

  if (!enterpriseSlug || loadFailed || !state) return null
  // 团队不存在（无效 slug / 已解散）时整张卡片都不渲染：
  // 否则会显示「加入『该团队』团队空间」这种兜底文案，比不显示更误导人。
  if (state.available === false && state.reason === 'unavailable') return null
  const teamName = state.organizationName || '该团队'
  const login = () => {
    const returnTo = `${window.location.origin}${window.location.pathname}${window.location.search}`
    window.location.href = `/api/auth/login?return_to=${encodeURIComponent(returnTo)}`
  }
  const submit = async () => {
    if (submitting) return
    setSubmitting(true)
    setFeedback('')
    try {
      const result = await apiRequest(`/api/organizations/${encodeURIComponent(enterpriseSlug)}/join-request`, { method: 'POST', body: JSON.stringify({}) })
      setState((current) => ({ ...current, available: false, reason: 'pending', requestedAt: result.requestedAt || new Date().toISOString() }))
      setFeedback('申请已提交，等待团队所有者处理')
    } catch (err) {
      setFeedback(err.message || '申请提交失败，请稍后再试')
      try {
        const latest = await apiRequest(`/api/organizations/${encodeURIComponent(enterpriseSlug)}/join-request`)
        setState(latest)
      } catch { /* 保持当前状态，仅提示错误 */ }
    } finally {
      setSubmitting(false)
    }
  }

  const cooldownText = () => {
    if (!state.cooldownUntil) return ''
    const hours = Math.max(1, Math.ceil((new Date(state.cooldownUntil).getTime() - Date.now()) / (60 * 60 * 1000)))
    return `上次申请未通过，请 ${hours} 小时后再试。`
  }
  const hintByReason = {
    anonymous: '登录鲲穹账号后，可直接向团队所有者申请加入。',
    pending: '申请已提交，等待团队所有者同意或拒绝。',
    invited: '你已收到该团队的邀请，请到消息中心选择接受或拒绝。',
    member: '你已经是该团队成员。',
    owner: '你是该团队的所有者。',
    other_team: '你已加入其他团队空间，无法重复加入。',
    cooldown: cooldownText(),
  }
  const showButton = state.available
  const buttonLabel = state.available ? '申请加入团队' : state.reason === 'anonymous' ? '登录后申请加入' : '申请加入团队'
  const tone = state.reason === 'pending' ? 'pending' : state.reason === 'member' ? 'member' : 'default'

  return (
    <div className={`public-card team-join-card ${tone}`}>
      <span className="team-join-icon"><Building2 size={20} /></span>
      <div className="team-join-body">
        <strong>加入「{teamName}」团队空间</strong>
        <span>{hintByReason[state.reason] || '团队版账号可通过分享链接直接申请加入团队空间。'}</span>
        {feedback && <span className="team-join-feedback"><Check size={13} /> {feedback}</span>}
      </div>
      {(showButton || state.reason === 'anonymous') && !feedback && (
        <button className="secondary-button team-join-action" onClick={state.reason === 'anonymous' ? login : submit} disabled={submitting}>
          {state.reason === 'anonymous' ? <UserRound size={15} /> : <UserPlus size={15} />} {submitting ? '提交中' : buttonLabel}
        </button>
      )}
    </div>
  )
}

export function ManageItemModal({ target, onClose, onSave, onCloseTask, onReopenTask }) {
  const isShare = target.kind === 'share'
  const data = target.data || {}
  const [shareForm, setShareForm] = useState(() => createShareManageForm(data))
  const [collectionForm, setCollectionForm] = useState(() => createCollectionManageForm(data))
  const [saving, setSaving] = useState(false)
  const [closing, setClosing] = useState(false)
  const [reopening, setReopening] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const updateShare = (patch) => setShareForm((current) => ({ ...current, ...patch }))
  const updateCollection = (patch) => setCollectionForm((current) => ({ ...current, ...patch }))
  const toggleAllowedType = (type) => {
    updateCollection({ allowedTypes: toggleCollectionType(collectionForm.allowedTypes, type) })
  }

  const buildCollectionPayload = ({ reopeningTask = false } = {}) => {
    const title = collectionForm.title.trim()
    if (!title) {
      setError('请填写任务名称')
      return null
    }
    if (title.length > COLLECTION_TITLE_MAX) {
      setError(`任务名称不能超过 ${COLLECTION_TITLE_MAX} 个字`)
      return null
    }
    const description = collectionForm.description.trim()
    if (description.length > COLLECTION_DESCRIPTION_MAX) {
      setError(`收集说明不能超过 ${COLLECTION_DESCRIPTION_MAX} 个字`)
      return null
    }
    if (!collectionForm.deadline) {
      setError('请选择截止日期')
      return null
    }
    if (reopeningTask && !isDateInputStillOpen(collectionForm.deadline)) {
      setError('请先把截止日期调整到今天或未来日期')
      return null
    }
    return {
      title,
      description,
      deadline: collectionForm.deadline,
      allowedTypes: normalizeCollectionTypes(collectionForm.allowedTypes),
      maxFileSizeMb: Math.min(Number(collectionForm.maxFileSizeMb), data.maxConfigurableFileSizeMb || 20480),
    }
  }

  const buildSharePayload = ({ reopeningShare = false } = {}) => {
    if (!shareForm.clearPassword && shareForm.password.length > 128) {
      setError('提取密码不能超过 128 个字符')
      return null
    }
    const customLimit = Number(shareForm.customDownloadLimit)
    if (shareForm.downloadLimit === 'custom' && (!Number.isFinite(customLimit) || customLimit < 1)) {
      setError('请填写正确的下载次数')
      return null
    }
    return {
      downloadLimit: shareForm.downloadLimit === 'custom' ? String(Math.floor(customLimit)) : shareForm.downloadLimit,
      password: shareForm.clearPassword ? '' : shareForm.password.trim(),
      clearPassword: shareForm.clearPassword,
      ...(reopeningShare ? { status: 'active' } : {}),
    }
  }

  const submit = async () => {
    setError('')
    let payload
    if (isShare) {
      payload = buildSharePayload()
      if (!payload) return
    } else {
      payload = buildCollectionPayload()
      if (!payload) return
    }

    setSaving(true)
    try {
      const ok = await onSave(payload)
      if (ok) {
        onClose()
        return
      }
      setSaving(false)
    } catch {
      setSaving(false)
    }
  }

  const closeTask = async () => {
    setClosing(true)
    try {
      const ok = await onCloseTask()
      if (!ok) setClosing(false)
    } catch {
      setClosing(false)
    }
  }

  const reopenTask = async () => {
    setError('')
    const payload = isShare ? buildSharePayload({ reopeningShare: true }) : buildCollectionPayload({ reopeningTask: true })
    if (!payload) return
    setReopening(true)
    try {
      const ok = await onReopenTask?.(payload)
      if (ok) {
        onClose()
        return
      }
      setReopening(false)
    } catch {
      setReopening(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal manage-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div><p className="eyebrow">{isShare ? '分享管理' : '收集任务管理'}</p><h2>{isShare ? '管理分享设置' : '管理收集设置'}</h2></div>
          <button className="ghost-icon modal-close" aria-label="关闭管理窗口" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body manage-form">
          {isShare ? (
            <>
              <div className="setting-block manage-setting-block">
                <span>下载次数</span>
                <div className="option-grid">{[['不限次数', 'unlimited'], ['10 次', '10'], ['1 次', '1'], ['自定义', 'custom']].map(([label, value]) => <button key={value} className={shareForm.downloadLimit === value ? 'selected' : ''} onClick={() => updateShare({ downloadLimit: value })}>{label}{shareForm.downloadLimit === value && <Check size={14} />}</button>)}</div>
                {shareForm.downloadLimit === 'custom' && <label className="inline-setting-input"><span>最多下载次数</span><input type="number" min="1" max="9999" value={shareForm.customDownloadLimit} onChange={(event) => updateShare({ customDownloadLimit: event.target.value })} placeholder="例如：5" /></label>}
              </div>
              <label className="manage-field manage-password-field">
                <span className="manage-field-label"><span>提取密码</span><small className="field-count">{shareForm.password.length}/128</small></span>
                <input className="modal-inline-input" type="password" maxLength={128} value={shareForm.password} disabled={shareForm.clearPassword} onChange={(event) => updateShare({ password: limitInputText(event.target.value, 128) })} placeholder={data.requiresPassword ? '输入新密码，留空则不修改（最多 128 字符）' : '可选，最多 128 个字符'} />
              </label>
              <label className="manage-check-row">
                <input type="checkbox" checked={shareForm.clearPassword} onChange={(event) => updateShare({ clearPassword: event.target.checked, password: event.target.checked ? '' : shareForm.password })} />
                <span>清除当前提取密码</span>
              </label>
            </>
          ) : (
            <>
              <label className="manage-field manage-title-field">
                <span className="manage-field-label"><span>任务名称</span><small className={collectionForm.title.length >= COLLECTION_TITLE_MAX ? 'field-count at-limit' : 'field-count'}>{collectionForm.title.length}/{COLLECTION_TITLE_MAX}</small></span>
                <input className="modal-inline-input" value={collectionForm.title} maxLength={COLLECTION_TITLE_MAX} onChange={(event) => updateCollection({ title: event.target.value })} placeholder="例如：9 月产品素材收集" />
              </label>
              <label className="manage-field">
                <span className="manage-field-label"><span>收集说明</span><small className={collectionForm.description.length >= COLLECTION_DESCRIPTION_MAX ? 'field-count at-limit' : 'field-count'}>{collectionForm.description.length}/{COLLECTION_DESCRIPTION_MAX}</small></span>
                <textarea value={collectionForm.description} maxLength={COLLECTION_DESCRIPTION_MAX} onChange={(event) => updateCollection({ description: event.target.value })} placeholder="请上传你负责的文件" />
              </label>
              <label className="manage-field">
                <span>截止日期</span>
                <DatePicker value={collectionForm.deadline} onChange={(value) => updateCollection({ deadline: value })} ariaLabel="收集任务截止日期" />
              </label>
              <label className="manage-field">
                <span>文件类型</span>
                <div className="chip-group">{COLLECTION_TYPE_OPTIONS.map((type) => <button key={type} className={collectionForm.allowedTypes.includes(type) ? 'selected' : ''} onClick={() => toggleAllowedType(type)}>{type}</button>)}</div>
              </label>
              <label className="manage-field">
                <span>单文件大小限制</span>
                <select value={Math.min(Number(collectionForm.maxFileSizeMb), data.maxConfigurableFileSizeMb || 20480)} onChange={(event) => updateCollection({ maxFileSizeMb: event.target.value })}>{collectionSizeOptions(data.maxConfigurableFileSizeMb || 20480, collectionForm.maxFileSizeMb).map(size => <option key={size} value={size}>{formatBytes(size * 1024 ** 2)}</option>)}</select>
              </label>
            </>
          )}
          {error && <p className="manage-form-error">{error}</p>}
        </div>
        <div className="modal-footer manage-modal-footer">
          {(isShare && !isClosedOrExpiredStatus(data.status)) || (!isShare && data.status === 'active') ? (
            <button className="secondary-button danger-lite" disabled={isClosedStatus(data.status) || closing} onClick={closeTask}><X size={15} /> {closing ? '关闭中' : isShare ? '关闭分享' : '关闭收集任务'}</button>
          ) : (
            <button className="secondary-button reopen-button" disabled={reopening} onClick={reopenTask}><RefreshCw className={reopening ? 'spinning' : ''} size={15} /> {reopening ? '开启中' : isShare ? '重新开启分享' : '重新开启收集任务'}</button>
          )}
          <button className="secondary-button" onClick={onClose}>取消</button>
          <button className="primary-button" disabled={saving} onClick={submit}>{saving ? '保存中' : '保存设置'}</button>
        </div>
      </div>
    </div>
  )
}

export function RenameRecordModal({ record, onClose, onSave }) {
  const inputRef = useRef(null)
  const [name, setName] = useState(() => recordDisplayName(record))
  const [error, setError] = useState('')
  const syncsCollectionTitle = record.kind === 'collection' && record.scope === 'my_collections' && Boolean(record.manageToken || getManageToken(record.manageUrl))
  const nameLimit = syncsCollectionTitle ? COLLECTION_TITLE_MAX : 80

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const submit = () => {
    const nextName = name.trim()
    if (!nextName) {
      setError('显示名称不能为空')
      return
    }
    if (nextName.length > nameLimit) {
      setError(syncsCollectionTitle ? `任务名称不能超过 ${COLLECTION_TITLE_MAX} 个字` : `显示名称不能超过 ${nameLimit} 个字`)
      return
    }
    onSave(nextName)
  }

  return (
    <div className="modal-backdrop rename-backdrop" onMouseDown={onClose}>
      <div className="modal rename-modal" role="dialog" aria-modal="true" aria-labelledby="rename-record-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header rename-modal-header">
          <div><p className="eyebrow">文件管理</p><h2 id="rename-record-title">{syncsCollectionTitle ? '重命名收集任务' : '重命名显示名称'}</h2></div>
          <button className="ghost-icon modal-close" aria-label="关闭重命名窗口" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body rename-modal-body">
          <div className="rename-summary">
            <span className={`record-icon ${record.scope}`}><PencilLine size={17} /></span>
            <div><strong>{recordDisplayName(record)}</strong><span>{recordScopeLabel(record.scope)} · {recordExpiryLabel(record)}</span></div>
          </div>
          <label className="manage-field">
            <span className="manage-field-label"><span>{syncsCollectionTitle ? '新的任务名称' : '新的显示名称'}</span><small className={name.length >= nameLimit ? 'field-count at-limit' : 'field-count'}>{name.length}/{nameLimit}</small></span>
            <input ref={inputRef} className="modal-inline-input" value={name} maxLength={nameLimit} onChange={(event) => { setName(event.target.value); setError('') }} onKeyDown={(event) => { if (event.key === 'Enter') submit() }} placeholder={syncsCollectionTitle ? '请输入新的任务名称' : '请输入新的显示名称'} />
          </label>
          <p className="rename-helper">{syncsCollectionTitle ? '会同步修改收集任务名称，管理页和提交入口都会显示新名称。' : '仅修改文件管理中心和收发记录中的显示名称，不改动已上传文件本身。'}</p>
          {error && <p className="manage-form-error">{error}</p>}
        </div>
        <div className="modal-footer rename-modal-footer">
          <button className="secondary-button" onClick={onClose}>取消</button>
          <button className="primary-button" onClick={submit}><Check size={15} /> 保存名称</button>
        </div>
      </div>
    </div>
  )
}

export function RecordNameText({ name }) {
  const text = String(name || '').trim() || '文件分享'
  const { base, extension } = splitFileNameForDisplay(text)
  return (
    <strong className="record-name-text" title={text}>
      <span>{base}</span>{extension && <em>{extension}</em>}
    </strong>
  )
}

export function FileFormatBadge({ file, record, label = '' }) {
  const text = label || fileFormatLabel(file, record)
  return text ? <span className="file-format-badge">{text}</span> : null
}

export function ValueItem({ icon: Icon, title, detail }) { return <div className="value-item"><span className="value-icon"><Icon size={18} /></span><div><strong>{title}</strong><span>{detail}</span></div></div> }

export function FileRow({ file, onRemove, onPreview, onDownload, downloadDisabled = false, showPath = false }) {
  const Icon = fileIcon(file.name)
  return (
    <div className="file-row">
      <span className="file-type"><Icon size={18} /></span>
      <div className="file-info"><strong title={file.name}>{file.name}</strong>{showPath && file.relativePath && file.relativePath !== file.name && <small className="file-relative-path" title={file.relativePath}>{file.relativePath}</small>}<span><FileFormatBadge file={file} /> {formatBytes(file.size)}</span></div>
      {onPreview && <button className="ghost-icon" aria-label={`预览 ${file.name}`} onClick={onPreview}><Eye size={16} /></button>}
      {onDownload && <button className="ghost-icon" aria-label={`下载 ${file.name}`} onClick={onDownload} disabled={downloadDisabled}><Download size={16} /></button>}
      {onRemove && <button className="ghost-icon" aria-label={`移除 ${file.name}`} onClick={onRemove}><X size={16} /></button>}
    </div>
  )
}

export function PlanSpaceSummary({ plan = {}, compact = false }) {
  return <span className={`plan-space-summary${compact ? ' compact' : ''}`}>
    <span><b>{formatBytes(plan.totalBytes)}</b><small>个人空间</small></span>
    {plan.teamSpaceBytes ? <span><b>{formatBytes(plan.teamSpaceBytes)}</b><small>团队空间</small></span> : null}
  </span>
}

export function toFileItems(incoming) { return Array.from(incoming || []).map((file, index) => ({ id: `${file.name}-${file.lastModified}-${index}`, file, name: file.name, size: file.size, mimeType: file.type || 'application/octet-stream', relativePath: file.webkitRelativePath || file.name })) }
