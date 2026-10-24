import React, { useMemo, useRef, useState } from 'react'
import { CheckCircle2, FileArchive, LockKeyhole, Send, UploadCloud, UserRound, XCircle } from 'lucide-react'

function fileKey(name) { return String(name || '').split('__')[0] || '' }

export function DistributionView({ user, onLogin, onNotify }) {
  const inputRef = useRef(null)
  const [files, setFiles] = useState([])
  const [roster, setRoster] = useState('')
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const names = useMemo(() => files.map(file => file.name), [files])

  const runPreview = async () => {
    setError(''); setResult(null)
    if (!user) return onLogin?.()
    try {
      setLoading(true)
      const response = await fetch('/api/distributions/preview', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: names, roster }) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || '预览失败')
      setPreview(data.preview)
    } catch (nextError) { setError(nextError.message) } finally { setLoading(false) }
  }

  const publish = async () => {
    if (!preview?.ok || !files.length) return
    setError(''); setResult(null)
    const key = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
    try {
      setLoading(true)
      const body = new FormData()
      files.forEach(file => body.append('files', file, file.name))
      body.append('roster', roster)
      body.append('idempotencyKey', key)
      const response = await fetch('/api/distributions', { method: 'POST', credentials: 'include', headers: { 'Idempotency-Key': key }, body })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (data.preview) setPreview(data.preview)
        throw new Error(data.message || '发布失败')
      }
      setResult(data); onNotify?.(data.reused ? '已返回原分发结果' : '定向分发已发布')
    } catch (nextError) { setError(nextError.message) } finally { setLoading(false) }
  }

  return <div className="workspace-page distribution-page">
    <div className="distribution-heading">
      <div><span className="distribution-eyebrow"><Send size={14} />定向交付</span><h1>批量分发给指定收件人</h1><p>文件名使用“编号__文件名.ext”，名单使用“编号,收件人”。发布后映射固定，收件人只能领取自己的文件。</p></div>
      {!user && <button className="primary-button" type="button" onClick={onLogin}><UserRound size={16} />登录后使用</button>}
    </div>
    <div className="distribution-grid">
      <section className="distribution-card">
        <div className="distribution-card-title"><span className="distribution-icon"><UploadCloud size={19} /></span><div><strong>选择待分发文件</strong><small>文件名必须以唯一编号开头，例如 001__合同.pdf</small></div></div>
        <input ref={inputRef} hidden type="file" multiple onChange={event => { setFiles(Array.from(event.target.files || [])); setPreview(null); setResult(null) }} />
        <button className="distribution-drop" type="button" onClick={() => inputRef.current?.click()}><FileArchive size={23} /><span>{files.length ? `已选择 ${files.length} 个文件` : '点击选择文件'}</span><small>支持一次选择多个文件</small></button>
        {files.length > 0 && <div className="distribution-file-list">{files.map(file => <div key={`${file.name}-${file.lastModified}`}><span><b>{fileKey(file.name) || '无编号'}</b>{file.name}</span><button type="button" title={`移除 ${file.name}`} onClick={() => setFiles(current => current.filter(item => item !== file))}><XCircle size={16} /></button></div>)}</div>}
      </section>
      <section className="distribution-card">
        <div className="distribution-card-title"><span className="distribution-icon"><UserRound size={19} /></span><div><strong>导入收件人名单</strong><small>每行一条：编号,收件人；收件人填写账号 ID、用户名、邮箱或手机号</small></div></div>
        <textarea value={roster} onChange={event => { setRoster(event.target.value); setPreview(null); setResult(null) }} placeholder={'001,alice\n002,13800138000'} rows={9} />
        <div className="distribution-actions"><button className="secondary-button" type="button" disabled={loading || !files.length || !roster.trim()} onClick={runPreview}>预览匹配</button><button className="primary-button" type="button" disabled={loading || !preview?.ok} onClick={publish}><LockKeyhole size={15} />确认发布</button></div>
      </section>
    </div>
    {error && <div className="distribution-alert error"><XCircle size={17} />{error}</div>}
    {preview && <section className={`distribution-preview ${preview.ok ? 'is-valid' : 'has-issues'}`}><div className="distribution-preview-head"><div><strong>{preview.ok ? '匹配成功，可以发布' : '存在问题，暂不能发布'}</strong><small>{preview.rows.length} 条映射 · {preview.issues.length} 个问题</small></div>{preview.ok ? <CheckCircle2 size={22} /> : <XCircle size={22} />}</div><div className="distribution-table">{preview.rows.map(row => <div className="distribution-row" key={`${row.key}-${row.rosterLine}`}><b>{row.key}</b><span>{row.fileName || '缺少文件'}</span><span>{row.recipientName || row.recipient}</span><em>{row.userId ? '已匹配' : '未匹配'}</em></div>)}{preview.issues.map((issue, index) => <div className="distribution-issue" key={`${issue.code}-${issue.key || issue.line}-${index}`}><XCircle size={15} />{issue.message}</div>)}</div></section>}
    {result?.distribution && <section className="distribution-success"><CheckCircle2 size={20} /><div><strong>发布成功</strong><span>已冻结 {result.distribution.rowCount} 条文件与收件人映射</span></div><button className="secondary-button" type="button" onClick={() => navigator.clipboard?.writeText(result.distribution.shareUrl)}>复制分享链接</button></section>}
  </div>
}

