// 全局通用组件（由 main.jsx 抽取）
// 被多个页面共用，抽到这里作为共享层，供各页面子树 import。

import React, { useEffect } from 'react'
import brandLogo from '../assets/brand-logo-header.webp'
import { CheckCircle2, ShieldCheck, Trash2, XCircle } from 'lucide-react'
import { feedbackTone } from '../lib/format.js'
import { PublicAccountActions } from './account.jsx'
export function Toast({ message }) {
  const tone = feedbackTone(message)
  const Icon = tone === 'error' ? XCircle : CheckCircle2
  return (
    <div className={`toast ${tone}`} role={tone === 'error' ? 'alert' : 'status'} aria-live={tone === 'error' ? 'assertive' : 'polite'}>
      <span className="toast-icon"><Icon size={18} /></span>
      <span>{message}</span>
    </div>
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
  return <div className={`app-shell public-shell ${className}`}><header className="topbar"><div className="brand"><img className="brand-logo" src={brandLogo} width="480" height="228" alt="鲲穹文件传输" /></div><div className="topbar-actions public-topbar-actions"><span className="public-safe"><ShieldCheck size={15} /> 安全临时空间</span><PublicAccountActions /></div></header><main className="public-page">{children}</main><footer className="page-footer"><span>鲲穹文件传输 · 临时传输，轻装上阵</span><div><a className="footer-manual-link" href="/user-manual.html" target="_blank" rel="noopener noreferrer">使用手册</a></div></footer></div>
}

export function StateBlock({ title, detail }) { return <div className="state-block"><ShieldCheck size={26} /><h1>{title}</h1><p>{detail}</p><a className="primary-button" href="/">返回鲲穹首页</a></div> }

export function LoadingBlock() { return <div className="state-block"><span className="loading-dot" /><h1>正在打开</h1><p>正在检查分享状态，请稍候。</p></div> }
