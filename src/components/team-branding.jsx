import React, { useEffect, useRef, useState } from 'react'
import { Check, FileText, ImagePlus, Palette, RotateCcw, Upload, X } from 'lucide-react'
import { apiRequest } from '../lib/api.js'
import { FeedbackMessage } from './common.jsx'
import { TeamBrand } from './team-brand.jsx'
import '../styles/team-branding.css'

const defaults = org => ({ enabled: false, name: org.name || '', introduction: '', logoUrl: '', revision: 0, ...org.branding })
const brandingErrorMessage = (error, fallback) => error.status === 404
  ? '团队品牌服务尚未更新，请联系管理员更新服务后重试，当前填写内容已保留'
  : error.message || fallback
export function TeamBrandingPanel({ organization, requestConfirm, onSaved }) {
  const [saved, setSaved] = useState(() => defaults(organization))
  const [name, setName] = useState(saved.name), [introduction, setIntroduction] = useState(saved.introduction)
  const [logo, setLogo] = useState(null), [busy, setBusy] = useState(false), [reading, setReading] = useState(false)
  const [error, setError] = useState(''), [conflict, setConflict] = useState(false), [preview, setPreview] = useState('share')
  const actionRef = useRef(false), inputRef = useRef(null), readVersion = useRef(0)
  const dirty = name !== saved.name || introduction !== saved.introduction || logo !== null
  const applySaved = next => { setSaved(next); setName(next.name); setIntroduction(next.introduction); setLogo(null); setConflict(false); setError('') }
  useEffect(() => () => { readVersion.current++ }, [])
  useEffect(() => {
    if ((organization.branding?.revision || 0) === saved.revision) return
    if (dirty || busy) setConflict(true)
    else applySaved(defaults(organization))
  }, [organization.branding?.revision, organization.name])
  const chooseLogo = async event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || actionRef.current) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setError('请选择静态 PNG、JPEG 或 WebP 图片'); return }
    if (!file.size || file.size > 400 * 1024) { setError('Logo 请选择 400 KB 以内的有效图片'); return }
    const version = ++readVersion.current
    setReading(true); setError('')
    try {
      // 直接读取 Blob，避免预览库覆盖全局 FileReader 后影响品牌图片。
      const bytes = new Uint8Array(await file.arrayBuffer())
      let binary = ''
      for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
      const data = `data:${file.type};base64,${window.btoa(binary)}`
      if (readVersion.current === version) setLogo(data)
    } catch (err) { if (readVersion.current === version) setError(err.message) }
    finally { if (readVersion.current === version) setReading(false) }
  }
  const save = async event => {
    event.preventDefault()
    if (actionRef.current || reading) return
    if (!name.trim() || name.length > 80 || introduction.length > 160 || /[\u0000-\u001f\u007f]/.test(name + introduction)) { setError('展示名称须为 1–80 个字符，简介最多 160 个字符，且不能包含控制字符'); return }
    actionRef.current = true; setBusy(true); setError('')
    try {
      const body = { name: name.trim(), introduction: introduction.trim(), revision: saved.revision, ...(logo !== null ? { logo } : {}) }
      const result = await apiRequest('/api/account/workspace/branding', { method: 'PATCH', body: JSON.stringify(body) })
      applySaved(result.branding); onSaved(result.branding, '团队品牌已保存，公开页面将使用新的展示内容')
    } catch (err) { setError(brandingErrorMessage(err, '保存失败，请重试')); if (err.status === 409) setConflict(true) }
    finally { actionRef.current = false; setBusy(false) }
  }
  const reload = async () => {
    if (actionRef.current) return
    if (dirty && !await requestConfirm({ eyebrow: '重新加载品牌', title: '放弃未保存的修改', detail: '将加载最新品牌，你当前未保存的内容会被丢弃。', confirmText: '重新加载', cancelText: '保留修改' })) return
    actionRef.current = true; setBusy(true)
    try { const result = await apiRequest('/api/account/workspace/branding'); applySaved(result.branding); onSaved(result.branding) }
    catch (err) { setError(brandingErrorMessage(err, '重新加载失败')) }
    finally { actionRef.current = false; setBusy(false) }
  }
  const reset = async () => {
    if (actionRef.current || reading) return
    actionRef.current = true
    try {
      if (!await requestConfirm({ eyebrow: '团队品牌', title: '恢复默认展示', detail: '将清除对外展示名称、Logo 和简介，分享页与收集页恢复平台默认展示。团队名称、文件和访问权限不会改变。', confirmText: '恢复默认', cancelText: '取消' })) return
      setBusy(true); setError('')
      const result = await apiRequest('/api/account/workspace/branding', { method: 'DELETE', body: JSON.stringify({ revision: saved.revision }) })
      applySaved(result.branding); onSaved(result.branding, '已恢复平台默认展示')
    } catch (err) { setError(brandingErrorMessage(err, '恢复默认失败')); if (err.status === 409) setConflict(true) }
    finally { actionRef.current = false; setBusy(false) }
  }
  const disabled = busy || reading
  const previewBrand = { name: name.trim() || organization.name, introduction: introduction.trim(), logoUrl: logo === null ? saved.logoUrl : logo }
  return <section className="public-card team-panel team-tab-panel team-branding-panel" aria-labelledby="team-branding-title" aria-busy={disabled}>
    <div className="team-panel-heading"><div><p className="eyebrow">对外形象</p><h2 id="team-branding-title">团队品牌展示</h2></div><span className="team-branding-status">{dirty ? '有未保存的修改' : saved.enabled ? '已启用' : '平台默认'}</span></div>
    <p className="team-branding-description">在团队文件分享页和团队专属收集链接展示品牌，方便收件人确认来源。</p>
    <div className="team-branding-grid">
      <form onSubmit={save} className="team-branding-form">
        <fieldset disabled={disabled}>
          <legend className="sr-only">品牌设置</legend>
          <div className="team-branding-logo-field"><span className="team-branding-label">团队 Logo</span><div className="team-branding-logo-row"><TeamBrand branding={{ ...previewBrand, introduction: '' }} className="team-branding-logo-sample" /><div><input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseLogo} aria-label="上传团队 Logo" className="team-branding-file-input" /><button type="button" className="secondary-button" onClick={() => inputRef.current?.click()}><Upload size={16} />{reading ? '读取中' : '选择图片'}</button>{Boolean(previewBrand.logoUrl) && <button type="button" className="team-branding-clear" onClick={() => { readVersion.current++; setLogo(''); setError('') }}><X size={14} />移除 Logo</button>}</div></div><small>静态 PNG、JPEG、WebP · 最大 400 KB<br />建议正方形，完整保留图片比例</small></div>
          <label className="team-branding-label" htmlFor="team-brand-name">对外展示名称<span>{name.length}/80</span></label>
          <input id="team-brand-name" value={name} maxLength={80} onChange={event => setName(event.target.value)} placeholder="例如 鲲穹培训服务中心" required aria-describedby="team-brand-name-hint" />
          <small id="team-brand-name-hint">只修改公开页面展示，不更改团队账号名称</small>
          <label className="team-branding-label" htmlFor="team-brand-introduction">简短介绍<span>{introduction.length}/160</span></label>
          <textarea id="team-brand-introduction" rows={3} value={introduction} maxLength={160} onChange={event => setIntroduction(event.target.value.replace(/[\r\n]/g, ''))} placeholder="向收件人说明团队或本次文件往来的用途" />
        </fieldset>
        {error && <FeedbackMessage message={error} tone="error" />}
        {conflict && <div className="team-branding-conflict" role="status"><span>品牌已有新版本，请重新加载后核对。</span><button type="button" className="secondary-button" disabled={disabled} onClick={reload}><RotateCcw size={15} />重新加载</button></div>}
        <div className="team-branding-actions"><button type="submit" className="primary-button" disabled={disabled || conflict || (!dirty && saved.enabled)}><Check size={16} />{busy ? '处理中' : '保存并启用'}</button><button type="button" className="secondary-button" disabled={disabled || !saved.enabled} onClick={reset}><RotateCcw size={16} />恢复默认</button></div>
      </form>
      <aside className="team-branding-preview" aria-label="品牌效果预览"><div className="team-branding-preview-heading"><strong><Palette size={17} />效果预览</strong><span>保存后生效</span></div><div className="team-branding-preview-tabs" role="group" aria-label="预览页面"><button type="button" aria-pressed={preview === 'share'} onClick={() => setPreview('share')}>分享页</button><button type="button" aria-pressed={preview === 'collection'} onClick={() => setPreview('collection')}>收集页</button></div><TeamBrand branding={previewBrand} /><div className="team-branding-preview-content"><span className="team-branding-preview-icon">{preview === 'share' ? <FileText size={26} /> : <ImagePlus size={26} />}</span><h3>{preview === 'share' ? '有人给你发来了文件' : '请提交你的材料'}</h3><p>{preview === 'share' ? '文件资料.pdf' : '填写信息并上传文件'}</p><span className="team-branding-preview-cta">{preview === 'share' ? '下载文件' : '提交文件'}</span></div><p className="team-branding-public-note">名称、Logo 和简介会公开展示。品牌展示不改变文件权限，页面仍保留平台标识。</p></aside>
    </div>
  </section>
}
