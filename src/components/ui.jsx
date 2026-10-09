import React from 'react'
import mammoth from 'mammoth'
import { sanitizeOfficeHtml } from '../office-html.js'
import * as XLSX from 'xlsx'
import { PPTXViewer } from 'pptxviewjs'
import { Building2, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Download, Eye, FileText, Link2, PencilLine, RefreshCw, RotateCcw, UserPlus, UserRound, X } from 'lucide-react'
import { apiRequest, downloadStatusText } from '../lib/api.js'
import { addMonths, displayUserName, formatBytes, formatDateInput, formatDuration, formatLimitSize, isClosedStatus, maskPhone, parseLocalDate, splitFileNameForDisplay, startOfMonth } from '../lib/format.js'
import { useEffect, useRef, useState } from 'react'
import { previewSupportLabel, previewTypeLabel } from '../lib/transfer.js'
import { FeedbackMessage } from './common.jsx'
import { COLLECTION_TYPE_OPTIONS, TEXT_PREVIEW_MAX_BYTES, fileIcon } from '../lib/constants.js'
import { createCollectionManageForm, createShareManageForm, fileFormatLabel, formatAllowedTypes, formatDateInputDisplay, getManageToken, isClosedOrExpiredStatus, isDateInputStillOpen, normalizeCollectionTypes, recordDisplayName, recordExpiryLabel, recordScopeLabel, toggleCollectionType } from '../lib/records.js'

export function DownloadProgressPanel({ task, onRetry }) {
  if (!task || task.status === 'idle') return null
  if (task.status === 'handed_off') return <div className="progress-wrap download-progress"><div className="progress-label"><span>已交给浏览器下载</span><Download size={16} /></div>{task.filename && <small>{task.filename}</small>}</div>
  const busy = ['preparing', 'downloading', 'saving'].includes(task.status)
  const statusText = downloadStatusText(task)
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
      {task.status === 'failed' && (
        <div className="upload-control-row">
          <button className="primary-button" onClick={onRetry}><RotateCcw size={15} /> 重试下载</button>
        </div>
      )}
    </div>
  )
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
      <div className="modal qr-modal" onMouseDown={(event) => event.stopPropagation()}>
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

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  if (!preview) return null
  const file = preview.file || {}
  const handleDownload = async () => {
    if (!onDownload) return
    setDownloadError('')
    try {
      const result = await onDownload()
      if (result?.ok === false) setDownloadError(result.error || '下载失败')
    } catch (downloadException) {
      setDownloadError(downloadException.message || '下载失败')
    }
  }
  return (
    <div className="modal-backdrop preview-backdrop" onMouseDown={onClose}>
      <div className={`modal preview-modal ${preview.kind}`} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header preview-modal-header">
          <div>
            <p className="eyebrow">{previewTypeLabel(preview.kind)}预览</p>
            <h2>{file.name || '文件预览'}</h2>
            <span className="preview-meta">{file.relativePath || file.name} · {formatBytes(file.size)}</span>
          </div>
          <button className="ghost-icon modal-close" aria-label="关闭预览" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="preview-modal-body">
          {error ? <div className="preview-error"><FileText size={28} /><strong>预览加载失败</strong><span>{error}</span></div> : renderPreviewContent(preview, () => setError('浏览器无法打开这个文件，可下载后查看。'))}
        </div>
        <div className="modal-footer preview-modal-footer">
          <span>{previewSupportLabel(preview.kind)}</span>
          {downloadError && <FeedbackMessage message={downloadError} tone="error" />}
          <button className="secondary-button" onClick={handleDownload} disabled={downloadDisabled}><Download size={15} /> 下载文件</button>
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
    let cancelled = false
    setState({ status: 'loading', content: '', truncated: false, error: '' })
    const loadPreview = async () => {
      try {
        const response = await fetch(preview.url, { credentials: 'include' })
        if (!response.ok) throw new Error(`预览请求失败（${response.status}）`)
        const buffer = await response.arrayBuffer()
        if (cancelled) return
        const truncated = buffer.byteLength > TEXT_PREVIEW_MAX_BYTES
        const sliced = truncated ? buffer.slice(0, TEXT_PREVIEW_MAX_BYTES) : buffer
        const content = new TextDecoder('utf-8', { fatal: false }).decode(sliced)
        if (!cancelled) setState({ status: 'ready', content, truncated, error: '' })
      } catch (error) {
        if (!cancelled) setState({ status: 'error', content: '', truncated: false, error: error.message || '文件解析失败' })
      }
    }
    loadPreview()
    return () => { cancelled = true }
  }, [preview.url])

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
  const [state, setState] = useState({ status: 'loading', html: '', workbook: null, sheets: [], activeSheet: 0, error: '' })
  const canvasRef = useRef(null)
  const viewerRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    const loadPreview = async () => {
      try {
        const response = await fetch(preview.url, { credentials: 'include' })
        if (!response.ok) throw new Error(`预览请求失败（${response.status}）`)
        const buffer = await response.arrayBuffer()
        if (cancelled) return
        if (preview.kind === 'document') {
          const result = await mammoth.convertToHtml({ arrayBuffer: buffer })
          if (!result.value.trim()) throw new Error('文档没有可显示的正文内容')
          if (!cancelled) setState({ status: 'ready', html: sanitizeOfficeHtml(result.value), workbook: null, sheets: [], error: '' })
          return
        }
        if (preview.kind === 'spreadsheet') {
          const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
          const sheets = workbook.SheetNames.map((name) => ({
            name,
            html: sanitizeOfficeHtml(spreadsheetSheetHtml(workbook.Sheets[name])),
          }))
          if (!sheets.length) throw new Error('表格中没有可显示的工作表')
          if (!cancelled) setState({ status: 'ready', html: '', workbook, sheets, activeSheet: 0, error: '' })
          return
        }
        if (preview.kind === 'presentation') {
          if (!canvasRef.current) throw new Error('演示文稿画布初始化失败')
          const viewer = new PPTXViewer({ canvas: canvasRef.current })
          viewerRef.current = viewer
          await viewer.loadFile(buffer)
          await viewer.render()
          if (!cancelled) setState({ status: 'ready', html: '', workbook: null, sheets: [], error: '' })
        }
      } catch (error) {
        if (!cancelled) setState({ status: 'error', html: '', workbook: null, sheets: [], error: error.message || '文件解析失败' })
      }
    }
    loadPreview()
    return () => {
      cancelled = true
      viewerRef.current?.destroy?.()
      viewerRef.current = null
    }
  }, [preview.url, preview.kind])

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
        <div className="spreadsheet-tabs">{state.sheets.map((sheet, index) => <span className={index === state.activeSheet ? 'active' : ''} key={sheet.name} onClick={() => setState((prev) => ({ ...prev, activeSheet: index }))}>{sheet.name}</span>)}</div>
        {state.sheets.map((sheet, index) => <div className="spreadsheet-sheet" key={sheet.name} style={{ display: index === state.activeSheet ? 'block' : 'none' }} dangerouslySetInnerHTML={{ __html: sheet.html }} />)}
      </div>
    )
  }
  return null
}

export function spreadsheetSheetHtml(sheet) {
  if (!sheet || typeof sheet !== 'object') return '<div class="spreadsheet-empty">此工作表为空</div>'
  try {
    const range = sheet['!ref']
    if (!range) return '<div class="spreadsheet-empty">此工作表为空</div>'
    return XLSX.utils.sheet_to_html(sheet, { editable: false, header: '', footer: '' })
  } catch (error) {
    console.warn('表格工作表渲染失败', error)
    return '<div class="spreadsheet-empty">此工作表无法预览，请下载文件查看。</div>'
  }
}

export function CollectionLimitInfo({ allowedTypes, maxFileSizeMb, compact = false }) {
  return (
    <div className={`collection-limit ${compact ? 'compact' : ''}`}>
      <span>文件类型：{formatAllowedTypes(allowedTypes)}</span>
      <span>单人上限：{formatLimitSize(maxFileSizeMb)}</span>
    </div>
  )
}

export function DatePicker({ value, onChange, ariaLabel, placeholder = '选择日期', className = '' }) {
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
    onChange(formatDateInput(date))
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
              return (
                <button type="button" key={dateValue} className={`date-picker-day ${isCurrentMonth ? '' : 'outside'} ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''}`} onClick={() => chooseDate(date)}>
                  {date.getDate()}
                </button>
              )
            })}
          </div>
          <div className="date-picker-footer">
            <button type="button" onClick={clearDate} disabled={!value}>清除</button>
            <button type="button" onClick={setToday}>今天</button>
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
      description: collectionForm.description.trim(),
      deadline: collectionForm.deadline,
      allowedTypes: normalizeCollectionTypes(collectionForm.allowedTypes),
      maxFileSizeMb: Number(collectionForm.maxFileSizeMb),
    }
  }

  const buildSharePayload = ({ reopeningShare = false } = {}) => {
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
                <span>提取密码</span>
                <input className="modal-inline-input" type="password" value={shareForm.password} disabled={shareForm.clearPassword} onChange={(event) => updateShare({ password: event.target.value })} placeholder={data.requiresPassword ? '输入新密码，留空则不修改' : '可选，设置后下载前需要验证'} />
              </label>
              <label className="manage-check-row">
                <input type="checkbox" checked={shareForm.clearPassword} onChange={(event) => updateShare({ clearPassword: event.target.checked, password: event.target.checked ? '' : shareForm.password })} />
                <span>清除当前提取密码</span>
              </label>
            </>
          ) : (
            <>
              <label className="manage-field manage-title-field">
                <span>任务名称</span>
                <input className="modal-inline-input" value={collectionForm.title} onChange={(event) => updateCollection({ title: event.target.value })} placeholder="例如：9 月产品素材收集" />
              </label>
              <label className="manage-field">
                <span>收集说明</span>
                <textarea value={collectionForm.description} onChange={(event) => updateCollection({ description: event.target.value })} placeholder="请上传你负责的文件" />
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
                <span>单人大小限制</span>
                <select value={collectionForm.maxFileSizeMb} onChange={(event) => updateCollection({ maxFileSizeMb: event.target.value })}><option value="500">500 MB</option><option value="1024">1 GB</option><option value="5120">5 GB</option></select>
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
            <span>{syncsCollectionTitle ? '新的任务名称' : '新的显示名称'}</span>
            <input ref={inputRef} className="modal-inline-input" value={name} maxLength={80} onChange={(event) => { setName(event.target.value); setError('') }} onKeyDown={(event) => { if (event.key === 'Enter') submit() }} placeholder={syncsCollectionTitle ? '请输入新的任务名称' : '请输入新的显示名称'} />
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

export function UserAvatar({ user, overrideSrc = '' }) {
  const avatarSrc = overrideSrc || userAvatarSource(user)
  return avatarSrc ? <img className="user-avatar" src={avatarSrc} alt={`${displayUserName(user)}头像`} /> : <span className="user-avatar">{displayUserInitial(user)}</span>
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

export function FeatureOrb({ icon: Icon, value, label, tone }) { return <div className={`feature-orb ${tone}`}><span className="orb-icon"><Icon size={21} /></span><strong>{value}</strong><span>{label}</span></div> }

export function ValueItem({ icon: Icon, title, detail }) { return <div className="value-item"><span className="value-icon"><Icon size={18} /></span><div><strong>{title}</strong><span>{detail}</span></div></div> }

export function FileRow({ file, onRemove, onPreview, onDownload, downloadDisabled = false }) {
  const Icon = fileIcon(file.name)
  return (
    <div className="file-row">
      <span className="file-type"><Icon size={18} /></span>
      <div className="file-info"><strong>{file.name}</strong><span><FileFormatBadge file={file} /> {formatBytes(file.size)}</span></div>
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

export function userAvatarSource(user = {}) {
  if (user.avatarSource === 'custom' && user.avatar) return user.avatar
  if (user.providerAvatar || user.avatar) return user.providerAvatar || user.avatar
  const provider = String(user.provider || '').toLowerCase()
  const label = provider.includes('qq') ? 'QQ' : provider.includes('wechat') || provider.includes('weixin') || provider.includes('微信') ? '微' : ''
  if (!label) return ''
  const background = label === 'QQ' ? '#4c9fe8' : '#20ad68'
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" rx="64" fill="${background}"/><text x="64" y="76" text-anchor="middle" fill="white" font-family="Arial,sans-serif" font-size="${label === 'QQ' ? 30 : 42}" font-weight="700">${label}</text></svg>`)}`
}

export function displayUserInitial(user = {}) { return displayUserName(user).trim().slice(0, 1).toUpperCase() || '鲲' }

export function displayUserSubtitle(user = {}) { return user.email || maskPhone(user.phone) || user.username || '已登录' }

export function toFileItems(incoming) { return Array.from(incoming || []).map((file, index) => ({ id: `${file.name}-${file.lastModified}-${index}`, file, name: file.name, size: file.size, mimeType: file.type || 'application/octet-stream', relativePath: file.webkitRelativePath || file.name })) }
