// 全局通用组件（由 main.jsx 抽取）
// 被多个页面共用，抽到这里作为共享层，供各页面子树 import。

import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Bell, CheckCircle2, Crown, History, Inbox, Send, ShieldCheck, Trash2, XCircle } from 'lucide-react'
import { feedbackTone } from '../lib/format.js'
import { PublicAccountActions } from './account.jsx'

export function ProductBrand({ href = '/', className = '' }) {
  return (
    <a className={`product-brand ${className}`.trim()} href={href} aria-label="鲲穹文件传输">
      <img src="/app-icon.png" alt="" draggable="false" />
      <span><strong>鲲穹</strong><em>文件传输</em></span>
    </a>
  )
}

export function Toast({ message, tone = feedbackTone(message), id }) {
  const Icon = tone === 'error' ? XCircle : CheckCircle2
  return createPortal(
    <div key={id} className={`toast ${tone}`} role={tone === 'error' ? 'alert' : 'status'} aria-live={tone === 'error' ? 'assertive' : 'polite'} aria-atomic="true" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <span className="toast-icon"><Icon size={18} /></span>
      <span>{message}</span>
    </div>, document.body
  )
}

export function FeedbackMessage({ message, tone = 'error' }) {
  const Icon = tone === 'success' ? CheckCircle2 : XCircle
  return (
    <p className={`public-message feedback-message ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon size={16} />
      <span>{message}</span>
    </p>
  )
}

export function ConfirmModal({ state, onCancel, onConfirm }) {
  useEffect(() => {
    if (!state) return undefined
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [state, onCancel])

  if (!state) return null

  const Icon = state.tone === 'danger' ? Trash2 : ShieldCheck
  return (
    <div className="modal-backdrop confirm-backdrop" onMouseDown={onCancel}>
      <div className={`modal confirm-modal ${state.tone === 'danger' ? 'danger' : ''}`} role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <div className="confirm-modal-icon"><Icon size={20} /></div>
        <p className="eyebrow">{state.eyebrow || '操作确认'}</p>
        <h2>{state.title || '确认操作'}</h2>
        {state.subject && <p className="confirm-modal-subject" title={state.subject}>{state.subject}</p>}
        {state.detail && <p>{state.detail}</p>}
        <div className="modal-footer confirm-modal-footer">
          <button className="secondary-button" onClick={onCancel}>{state.cancelText || '取消'}</button>
          <button className={`primary-button ${state.tone === 'danger' ? 'danger-button' : ''}`} onClick={onConfirm}>{state.confirmText || '确定'}</button>
        </div>
      </div>
    </div>
  )
}

export function PublicShell({ children, className = '' }) {
  const path = window.location.pathname
  const view = new URLSearchParams(window.location.search).get('view')
  const active = path === '/' ? (view === 'collect' ? 'collect' : view === 'records' ? 'records' : view === 'send' || !view ? 'send' : '')
    : path.startsWith('/workspace') || path.startsWith('/team') || path.startsWith('/e/') ? 'workspace' : ''
  const showMessages = !path.startsWith('/admin')
  const showTrash = path.startsWith('/workspace') || path.startsWith('/team')
  return <div className={`app-shell public-shell ${className}`}>
    <header className="topbar public-topbar">
      <div className="public-topbar-content">
        <ProductBrand />
        <nav className="main-nav public-main-nav" aria-label="主导航">
          <a className={`nav-item${active === 'send' ? ' active' : ''}`} href="/"><Send size={17} /><span>发文件</span></a>
          <a className={`nav-item${active === 'collect' ? ' active' : ''}`} href="/?view=collect"><Inbox size={17} /><span>收集文件</span></a>
          <a className={`nav-item${active === 'records' ? ' active' : ''}`} href="/?view=records"><History size={17} /><span>收发记录</span></a>
          <a className={`nav-item${active === 'workspace' ? ' active' : ''}`} href="/workspace"><Crown size={17} /><span>会员与团队</span></a>
        </nav>
        <div className="topbar-actions public-topbar-actions">
          {showTrash && <a className="public-message-link topbar-trash-link" href={path.startsWith('/team') ? '/trash?tab=team' : '/trash'} aria-label="回收站" title="回收站"><Trash2 size={17} /></a>}
          {showMessages && <a className="public-message-link" href="/?view=records&panel=messages" aria-label="打开消息中心" title="消息中心"><Bell size={17} /></a>}
          <PublicAccountActions />
        </div>
      </div>
    </header>
    <main className="public-page">{children}</main>
    <footer className="page-footer"><span>鲲穹文件传输 · 临时传输，轻装上阵</span><div><a className="footer-manual-link" href="/user-manual.html" target="_blank" rel="noopener noreferrer">使用手册</a></div></footer>
  </div>
}

export function StateBlock({ title, detail }) { return <div className="state-block"><ShieldCheck size={26} /><h1>{title}</h1><p>{detail}</p><a className="primary-button" href="/">返回鲲穹首页</a></div> }

export function LoadingBlock() { return <div className="state-block"><span className="loading-dot" /><h1>正在打开</h1><p>正在检查分享状态，请稍候。</p></div> }
