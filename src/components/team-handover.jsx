import React, { useState } from 'react'
import { ArrowRight, Check, Crown, History, X } from 'lucide-react'
import { formatDate } from '../lib/format.js'

const statusLabels = { accepted: '已完成', declined: '已拒绝', canceled: '已取消', expired: '已过期', invalidated: '已失效' }

export function TeamHandoverPanel({ pending, history = [], busy, onDecision }) {
  const [page, setPage] = useState(1)
  const pageCount = Math.max(1, Math.ceil(history.length / 5))
  const safePage = Math.min(page, pageCount)
  const visibleHistory = history.slice((safePage - 1) * 5, safePage * 5)
  if (!pending && history.length === 0) return null
  return <section className="public-card team-panel team-tab-panel team-handover-panel" aria-labelledby="team-handover-title">
    <div className="team-panel-heading"><div><p className="eyebrow">管理授权</p><h2 id="team-handover-title">负责人交接</h2></div><Crown size={22} aria-hidden="true" /></div>
    <p className="team-handover-description">所有者可在成员列表中发起转让；指定接收人确认后生效，团队套餐、文件和任务归属保持不变。</p>
    {pending ? <div className="team-handover-pending" aria-label="待确认的负责人交接" aria-busy={busy}>
      <div className="team-handover-state"><span className="team-handover-badge">{pending.canRespond ? '待你确认' : '等待接收者确认'}</span><span>有效至 {formatDate(pending.expiresAt)}</span></div>
      <div className="team-handover-people"><strong>{pending.fromName}</strong><ArrowRight size={18} aria-label="交接给" /><strong>{pending.toName}</strong></div>
      <p>发起于 {formatDate(pending.initiatedAt)}。确认前权限保持原样，超过 7 天自动失效。</p>
      {pending.canRespond ? <div className="team-handover-actions"><button className="secondary-button" type="button" disabled={busy} onClick={() => onDecision(pending, 'decline')}><X size={16} /> 拒绝交接</button><button className="primary-button" type="button" disabled={busy} onClick={() => onDecision(pending, 'accept')}><Check size={16} /> 接受交接</button></div>
        : pending.canCancel ? <div className="team-handover-actions"><button className="secondary-button" type="button" disabled={busy} onClick={() => onDecision(pending, 'cancel')}><X size={16} /> 取消本次交接</button></div> : null}
    </div> : null}
    <div className="team-handover-history-heading"><h3><History size={17} /> 交接记录</h3><span>{history.length} 条</span></div>
    {visibleHistory.length ? <ol className="team-handover-history">{visibleHistory.map(item => <li key={item.id}>
      <div><strong>{item.fromName} <span aria-hidden="true">→</span> {item.toName}</strong><span className={`team-handover-badge ${item.status}`}>{statusLabels[item.status] || '已处理'}</span></div>
      <p>发起 {formatDate(item.initiatedAt)}<span>处理 {formatDate(item.resolvedAt)}</span></p>
      {item.reason && <small>{item.reason}</small>}
    </li>)}</ol> : <p className="team-handover-no-history">暂无交接记录</p>}
    {pageCount > 1 && <nav className="team-handover-pagination" aria-label="交接记录分页"><button type="button" className="secondary-button" disabled={safePage === 1} onClick={() => setPage(safePage - 1)}>上一页</button><span>{safePage} / {pageCount}</span><button type="button" className="secondary-button" disabled={safePage === pageCount} onClick={() => setPage(safePage + 1)}>下一页</button></nav>}
  </section>
}
