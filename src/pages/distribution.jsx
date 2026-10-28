import React, { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, FileArchive, LockKeyhole, RefreshCw, Send, UploadCloud, UserRound, Wand2, XCircle } from 'lucide-react'
import { formatBytes } from '../lib/format.js'

// 兼容历史格式：文件名前缀“编号__”。带前缀时只用于展示名，不影响配对。
const FILE_PREFIX = /^([A-Za-z0-9][A-Za-z0-9._-]{0,79})__(.+)$/

export function splitDistributionName(name) {
  const text = String(name || '')
  const match = text.match(FILE_PREFIX)
  return match && match[2].trim() ? { display: match[2].trim() } : { display: text }
}

// 批量填入用：每行一个收件人，兼容表格粘贴的“编号,收件人”两列。
export function parseRecipientLines(text) {
  const rows = []
  String(text || '').split(/\r?\n/).forEach(line => {
    const raw = line.trim()
    if (!raw || raw.startsWith('#')) return
    const cells = raw.split(/[\t,，]/).map(item => item.trim())
    if (/^(编号|序号|id|key|#|收件人|recipient)$/i.test(cells[0] || '')) return
    const recipient = (cells.length === 2 ? cells[1] : raw).trim()
    if (recipient) rows.push(recipient)
  })
  return rows
}

function fileId(file) { return `${file.name}::${file.size}::${file.lastModified}` }

export function DistributionView({ user, onLogin, onNotify }) {
  const inputRef = useRef(null)
  const [items, setItems] = useState([])
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [dragging, setDragging] = useState(false)
  const [preview, setPreview] = useState(null)
  const [checking, setChecking] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const idempotencyKeyRef = useRef({ signature: '', key: '' })

  const ready = Boolean(user) && items.length > 0 && items.every(item => item.recipient.trim())
  const signature = useMemo(() => JSON.stringify(items.map(item => [item.name, item.recipient.trim()])), [items])
  const assignments = useMemo(() => items.map((item, index) => ({ fileIndex: index, recipient: item.recipient.trim() })), [items])
  const submissionSignature = useMemo(() => JSON.stringify(items.map(item => [item.name, item.size, item.file?.lastModified || 0, item.recipient.trim()])), [items])

  const idempotencyKeyForCurrentSubmission = () => {
    if (idempotencyKeyRef.current.signature === submissionSignature && idempotencyKeyRef.current.key) return idempotencyKeyRef.current.key
    let key = ''
    try {
      const stored = JSON.parse(window.sessionStorage.getItem('kunqiong.distribution.pending.v1') || 'null')
      if (stored?.signature === submissionSignature && typeof stored.key === 'string') key = stored.key
    } catch {}
    if (!key) key = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
    idempotencyKeyRef.current = { signature: submissionSignature, key }
    try { window.sessionStorage.setItem('kunqiong.distribution.pending.v1', JSON.stringify({ signature: submissionSignature, key })) } catch {}
    return key
  }

  useEffect(() => {
    if (!ready) { setPreview(null); setChecking(false); return undefined }
    let cancelled = false
    const timer = setTimeout(async () => {
      setChecking(true)
      try {
        const response = await fetch('/api/distributions/preview', {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: items.map(item => item.name), assignments }),
        })
        const data = await response.json().catch(() => ({}))
        if (cancelled) return
        if (!response.ok) throw new Error(data.message || '检查收件人失败')
        setPreview(data.preview); setError('')
      } catch (nextError) {
        if (!cancelled) { setPreview(null); setError(nextError.message) }
      } finally {
        if (!cancelled) setChecking(false)
      }
    }, 400)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [ready, signature])

  const addFiles = incoming => {
    const next = Array.from(incoming || [])
    if (!next.length) return
    setItems(current => {
      const seen = new Set(current.map(item => item.id))
      const merged = [...current]
      for (const file of next) {
        const id = fileId(file)
        if (seen.has(id)) continue
        seen.add(id)
        merged.push({ id, file, name: file.name, display: splitDistributionName(file.name).display, size: file.size, recipient: '' })
      }
      return merged
    })
    setResult(null); setError('')
  }

  const setRecipient = (id, value) => {
    setItems(current => current.map(item => (item.id === id ? { ...item, recipient: value } : item)))
    setResult(null)
  }

  const removeFile = id => setItems(current => current.filter(item => item.id !== id))

  const applyBulk = () => {
    const lines = parseRecipientLines(bulkText)
    if (!lines.length) return
    setItems(current => current.map((item, index) => (lines[index] ? { ...item, recipient: lines[index] } : item)))
    setBulkOpen(false); setBulkText(''); setError('')
  }

  const publish = async () => {
    if (!user) return onLogin?.()
    if (!items.length || !items.every(item => item.recipient.trim())) return
    setError(''); setResult(null)
    const key = idempotencyKeyForCurrentSubmission()
    try {
      setPublishing(true)
      const body = new FormData()
      items.forEach(item => body.append('files', item.file, item.name))
      body.append('assignments', JSON.stringify(assignments))
      body.append('idempotencyKey', key)
      const response = await fetch('/api/distributions', { method: 'POST', credentials: 'include', headers: { 'Idempotency-Key': key }, body })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (data.preview) setPreview(data.preview)
        throw new Error(data.message || '发布失败')
      }
      setResult(data)
      setItems([]); setBulkOpen(false); setBulkText(''); setPreview(null)
      idempotencyKeyRef.current = { signature: '', key: '' }
      try {
        const stored = JSON.parse(window.sessionStorage.getItem('kunqiong.distribution.pending.v1') || 'null')
        if (stored?.key === key) window.sessionStorage.removeItem('kunqiong.distribution.pending.v1')
      } catch {}
      onNotify?.(data.reused ? '已返回原分发结果' : '定向分发已发布')
    } catch (nextError) { setError(nextError.message) } finally { setPublishing(false) }
  }

  const rowState = (index, item) => {
    if (!item.recipient.trim()) return { tone: 'idle', label: '待填写' }
    if (!preview) return { tone: 'idle', label: checking ? '检查中' : '' }
    const row = preview.rows.find(candidate => candidate.fileIndex === index)
    if (row?.userId) return { tone: 'ok', label: row.recipientName || '已匹配' }
    return { tone: 'bad', label: '未找到' }
  }

  const filled = items.filter(item => item.recipient.trim()).length
  const canPublish = Boolean(preview?.ok) && !publishing

  return <div className="workspace-page distribution-page">
    <div className="distribution-heading">
      <div>
        <span className="distribution-eyebrow"><Send size={14} />定向交付</span>
        <h1>批量分发给指定收件人</h1>
        <p>上传文件后，在每个文件后面填上收件人。发布后映射固定，收件人只能领取自己的文件。</p>
      </div>
      {!user && <button className="primary-button" type="button" onClick={onLogin}><UserRound size={16} />登录后使用</button>}
    </div>

    <section className="distribution-card">
      <div className="distribution-card-title">
        <span className="distribution-icon"><UploadCloud size={19} /></span>
        <div><strong>文件与收件人</strong><small>文件名保持原样即可，不需要加编号或改名</small></div>
        <div className="distribution-tools">
          {items.length > 0 && <span className="distribution-count">{filled} / {items.length}</span>}
          {items.length > 0 && <button type="button" className="distribution-link-button" onClick={() => setBulkOpen(open => !open)}><Wand2 size={13} />批量填入</button>}
        </div>
      </div>

      {bulkOpen && <div className="distribution-bulk">
        <textarea value={bulkText} onChange={event => setBulkText(event.target.value)} rows={4} placeholder={'每行一个收件人，按顺序填入下面的文件：\n\nalice\nbob@example.com\n13800138000'} />
        <div className="distribution-bulk-actions">
          <button className="secondary-button" type="button" onClick={() => { setBulkOpen(false); setBulkText('') }}>取消</button>
          <button className="primary-button" type="button" disabled={!parseRecipientLines(bulkText).length} onClick={applyBulk}>按顺序填入</button>
        </div>
      </div>}

      <input ref={inputRef} hidden type="file" multiple onChange={event => { addFiles(event.target.files); event.target.value = '' }} />
      {items.length === 0 && <button
        className={`distribution-drop ${dragging ? 'is-dragging' : ''}`}
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={event => { event.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={event => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer?.files) }}
      >
        <FileArchive size={22} />
        <span>把文件拖到这里，或点击选择</span>
        <small>支持一次选择多个文件，重复选择会自动去重</small>
      </button>}

      {items.length > 0 && <div className="distribution-list">
        {items.map((item, index) => {
          const state = rowState(index, item)
          return <div className={`distribution-entry is-${state.tone}`} key={item.id}>
            <span className="distribution-entry-index">{index + 1}</span>
            <span className="distribution-entry-file" title={item.name}>{item.display}<small>{formatBytes(item.size)}</small></span>
            <input
              className="distribution-entry-recipient"
              value={item.recipient}
              placeholder="填收件人：用户名 / 邮箱 / 手机号"
              aria-label={`第 ${index + 1} 个文件的收件人`}
              onChange={event => setRecipient(item.id, event.target.value)}
            />
            <span className="distribution-entry-state">
              {state.tone === 'ok' && <CheckCircle2 size={13} />}
              {state.tone === 'bad' && <XCircle size={13} />}
              {state.tone === 'idle' && checking && <RefreshCw size={13} className="distribution-spin" />}
              {state.label}
            </span>
            <button type="button" className="distribution-entry-remove" title={`移除 ${item.display}`} aria-label={`移除 ${item.display}`} onClick={() => removeFile(item.id)}><XCircle size={15} /></button>
          </div>
        })}
      </div>}

      {items.length > 0 && <button
        className={`distribution-drop is-compact ${dragging ? 'is-dragging' : ''}`}
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={event => { event.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={event => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer?.files) }}
      >
        <FileArchive size={16} />
        <span>添加更多文件</span>
      </button>}

      {error && <div className="distribution-alert error"><XCircle size={17} />{error}</div>}
      {preview && !preview.ok && <div className="distribution-issues">
        {preview.issues.map((issue, index) => <div className="distribution-issue" key={`${issue.code}-${issue.fileIndex ?? index}`}><XCircle size={15} />{issue.message}</div>)}
      </div>}

      <div className="distribution-actions">
        {user
          ? <button className="primary-button" type="button" disabled={!canPublish} onClick={publish}><LockKeyhole size={15} />{publishing ? '发布中…' : '确认发布'}</button>
          : <button className="primary-button" type="button" onClick={onLogin}><UserRound size={15} />登录后发布</button>}
      </div>
    </section>

    {result?.distribution && <section className="distribution-success">
      <CheckCircle2 size={20} />
      <div><strong>发布成功</strong><span>已冻结 {result.distribution.rowCount} 条文件与收件人映射，把链接发给收件人即可领取。</span></div>
      <button className="secondary-button" type="button" onClick={() => { navigator.clipboard?.writeText(result.distribution.shareUrl); onNotify?.('分享链接已复制') }}>复制分享链接</button>
    </section>}
  </div>
}
