import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowRight, Copy, CreditCard, FileSearch, RefreshCw, Search, X } from 'lucide-react'
import { UpgradeModal } from './workspace-page.jsx'
import { apiRequest, copyTextToClipboard } from '../lib/api.js'
import { formatDate } from '../lib/format.js'

const ORDER_STATUSES = [
  ['all', '全部'],
  ['pending_payment', '待支付'],
  ['paid', '已支付'],
  ['canceled', '已取消'],
  ['expired', '已过期'],
]
const ORDER_STATUS_LABELS = Object.fromEntries(ORDER_STATUSES)
const PAGE_SIZE = 5

function readQuery() {
  const query = new URLSearchParams(window.location.search)
  const page = Number(query.get('page'))
  return {
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    status: ORDER_STATUSES.some(([value]) => value === query.get('status')) ? query.get('status') : 'all',
    q: query.get('q') || '',
  }
}

function writeQuery(next, { replace = false } = {}) {
  const query = new URLSearchParams()
  if (next.status !== 'all') query.set('status', next.status)
  if (next.q) query.set('q', next.q)
  if (next.page > 1) query.set('page', String(next.page))
  const url = `/settings/orders${query.size ? `?${query}` : ''}`
  window.history[replace ? 'replaceState' : 'pushState']({}, '', url)
}

function amountLabel(value) {
  const amount = Number(value)
  return Number.isFinite(amount) && amount >= 0 ? `¥${(amount / 100).toFixed(2)}` : '—'
}

function dateLabel(value) {
  if (!value) return '—'
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? formatDate(value) : '—'
}

function OrderStatus({ status }) {
  const tone = status === 'paid' ? 'paid' : status === 'pending_payment' ? 'pending' : 'inactive'
  return <span className={`orders-status ${tone}`}><i aria-hidden="true" />{ORDER_STATUS_LABELS[status] || status || '未知'}</span>
}

function OrderDetail({ order, busy, loading, notice, error, confirmCancel, onClose, onCopy, onCheck, onContinue, onCancel, onAskCancel, onDismissCancel, onRetry, onLogin }) {
  const dialog = useRef(null)
  useEffect(() => {
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.current?.querySelector('button')?.focus()
    const handleKeys = event => {
      if (event.key === 'Escape') { event.preventDefault(); dialog.current?.querySelector('[aria-label="关闭订单详情"]')?.click() }
      if (event.key !== 'Tab') return
      const elements = [...(dialog.current?.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled)') || [])]
      const first = elements[0], last = elements.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    window.addEventListener('keydown', handleKeys)
    return () => { window.removeEventListener('keydown', handleKeys); document.body.style.overflow = previousOverflow; if (previousFocus?.isConnected) previousFocus.focus() }
  }, [])

  const hasProviderOrder = Boolean(order.remoteOrderNo)
  const canCheck = hasProviderOrder && ['pending_payment', 'canceled', 'expired'].includes(order.status)
  const actionsDisabled = busy || loading || Boolean(onRetry)
  // Settings panels contain paint/layout; dialogs must escape that clipping boundary.
  return createPortal(
    <div className="orders-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section className="orders-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="order-detail-title">
        <header className="orders-dialog-header">
          <div><p className="eyebrow">订单详情</p><h2 id="order-detail-title">{order.planLabel || '会员套餐'}</h2></div>
          <button type="button" className="ghost-icon" aria-label="关闭订单详情" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="orders-dialog-body">
          {loading && <p className="orders-inline-note" role="status">正在读取订单详情…</p>}
          <div className="orders-detail-summary"><OrderStatus status={order.status} /><strong>{amountLabel(order.amount)}</strong></div>
          <dl className="orders-detail-list">
            <div><dt>本站订单号</dt><dd><code>{order.orderNo || '—'}</code>{order.orderNo && <button type="button" className="orders-copy" aria-label="复制本站订单号" onClick={() => onCopy(order.orderNo)}><Copy size={14} /></button>}</dd></div>
            <div><dt>套餐</dt><dd>{order.planLabel || '会员套餐'}</dd></div>
            <div><dt>支付方式</dt><dd>{order.payType === 2 ? '支付宝' : order.payType === 1 ? '微信支付' : '—'}</dd></div>
            <div><dt>支付平台订单号</dt><dd>{order.remoteOrderNo ? <><code>{order.remoteOrderNo}</code><button type="button" className="orders-copy" aria-label="复制支付平台订单号" onClick={() => onCopy(order.remoteOrderNo)}><Copy size={14} /></button></> : '尚未创建支付单'}</dd></div>
            <div><dt>创建时间</dt><dd>{dateLabel(order.createdAt)}</dd></div>
            {order.paymentExpiresAt && <div><dt>支付截止时间</dt><dd>{dateLabel(order.paymentExpiresAt)}</dd></div>}
            <div><dt>支付确认时间</dt><dd>{order.paidAt ? dateLabel(order.paidAt) : '—'}</dd></div>
            <div><dt>本单有效期</dt><dd>{order.planId === 'enterprise' && order.status === 'paid' ? '永久有效' : dateLabel(order.remoteExpireAt)}</dd></div>
          </dl>
          {order.status === 'paid' && <p className="orders-validity-note">本单有效期为历史支付记录，<a href="/workspace">查看当前会员权益</a>。</p>}
          {order.status === 'expired' && <p className="orders-inline-note">支付已超时，请重新创建订单支付。如已付款，可核对原单支付状态。</p>}
          {order.paymentRequiresLogin && <div className="orders-inline-note" role="status">此支付单需要重新登录后核对。<button type="button" className="orders-text-action" onClick={onLogin}>重新登录</button></div>}
          {notice && <p className="orders-inline-note success" role="status">{notice}</p>}
          {error && <div className="orders-inline-note error" role="alert">{error}{onRetry && <button className="orders-text-action" onClick={onRetry}>重试详情</button>}</div>}
          {confirmCancel ? (
            <div className="orders-cancel-confirm" role="alertdialog" aria-label="确认取消订单">
              <strong>确认取消订单？</strong><span>取消后此订单将无法继续支付。</span>
              <div><button type="button" className="secondary-button" onClick={onDismissCancel} disabled={busy}>暂不取消</button><button type="button" className="danger-button" onClick={onCancel} disabled={busy}>{busy ? '处理中…' : '确认取消'}</button></div>
            </div>
          ) : (
            <div className="orders-dialog-actions">
              {order.status === 'pending_payment' && <button type="button" className="primary-button" onClick={onContinue} disabled={actionsDisabled}><CreditCard size={15} /> 继续支付</button>}
              {order.status === 'expired' && <button type="button" className="primary-button" onClick={onContinue} disabled={actionsDisabled}><CreditCard size={15} /> 重新下单</button>}
              {canCheck && <button type="button" className="secondary-button" onClick={onCheck} disabled={actionsDisabled}><RefreshCw size={15} className={busy ? 'is-spinning' : ''} /> {busy ? '正在核对…' : '核对支付状态'}</button>}
              {order.status === 'pending_payment' && <button type="button" className="orders-text-action" onClick={onAskCancel} disabled={actionsDisabled}>取消订单</button>}
            </div>
          )}
        </div>
      </section>
    </div>, document.body
  )
}

export function OrdersPanel({ user, onLogin }) {
  const [sessionLost, setSessionLost] = useState(false)
  const [query, setQuery] = useState(readQuery)
  const [searchInput, setSearchInput] = useState(query.q)
  const [result, setResult] = useState({ orders: [], counts: {}, pagination: { page: 1, limit: PAGE_SIZE, total: 0, totalPages: 1 } })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [detail, setDetail] = useState(null)
  const [detailBusy, setDetailBusy] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [detailLoadFailed, setDetailLoadFailed] = useState(false)
  const [detailNotice, setDetailNotice] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [upgradeOrder, setUpgradeOrder] = useState(null)
  const [copyNotice, setCopyNotice] = useState('')
  const requestId = useRef(0)
  const detailRequestId = useRef(0)
  const actionRunning = useRef(false)
  const latestQuery = useRef(query)
  latestQuery.current = query

  const clearSession = () => {
    requestId.current++; detailRequestId.current++
    setSessionLost(true); setDetail(null); setUpgradeOrder(null); setLoading(false)
    setResult({ orders: [], counts: {}, pagination: { page: 1, limit: PAGE_SIZE, total: 0, totalPages: 1 } })
  }

  const fetchOrders = useCallback(async (next = latestQuery.current, { quiet = false } = {}) => {
    if (!user || sessionLost) return
    const id = ++requestId.current
    if (!quiet) setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ page: String(next.page), limit: String(PAGE_SIZE), status: next.status })
      if (next.q) params.set('q', next.q)
      const data = await apiRequest(`/api/account/upgrade-orders?${params}`)
      if (requestId.current !== id) return
      setResult(data)
      if (data.pagination?.page && data.pagination.page !== next.page) {
        const normalized = { ...next, page: data.pagination.page }
        setQuery(normalized)
        writeQuery(normalized, { replace: true })
      }
    } catch (err) {
      if (requestId.current !== id) return
      if (err.status === 401) {
        clearSession()
      } else setError(err.message || '订单列表加载失败，请稍后重试')
    } finally {
      if (requestId.current === id) setLoading(false)
    }
  }, [user?.id, sessionLost])

  useEffect(() => {
    return () => { requestId.current++; detailRequestId.current++ }
  }, [])

  useEffect(() => {
    if (user && !sessionLost) fetchOrders(query)
  }, [user?.id, sessionLost, query.page, query.status, query.q])

  useEffect(() => {
    const sync = () => {
      const next = readQuery()
      setQuery(next)
      setSearchInput(next.q)
    }
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])

  const changeQuery = next => {
    setQuery(next)
    setSearchInput(next.q)
    writeQuery(next)
  }

  const submitSearch = event => {
    event.preventDefault()
    const next = { ...query, q: searchInput.trim(), page: 1 }
    changeQuery(next)
  }

  const openDetail = async order => {
    setDetail(order)
    setDetailError('')
    setDetailLoadFailed(false)
    setDetailLoading(true)
    setDetailNotice('')
    setConfirmCancel(false)
    const id = ++detailRequestId.current
    try {
      const data = await apiRequest(`/api/account/upgrade-orders/${encodeURIComponent(order.id)}`)
      if (id === detailRequestId.current) setDetail(data.order)
    } catch (err) {
      if (id !== detailRequestId.current) return
      if (err.status === 401) clearSession()
      else { setDetailError(err.message || '详情读取失败'); setDetailLoadFailed(true) }
    } finally {
      if (id === detailRequestId.current) setDetailLoading(false)
    }
  }

  const closeDetail = () => { detailRequestId.current++; setDetail(null); setConfirmCancel(false); setDetailError(''); setDetailNotice('') }
  const copyOrder = async value => {
    try { await copyTextToClipboard(value); setCopyNotice('订单号已复制'); window.setTimeout(() => setCopyNotice(''), 1800) }
    catch { setCopyNotice('复制失败，请手动选择订单号'); window.setTimeout(() => setCopyNotice(''), 2200) }
  }

  const checkPayment = async () => {
    if (!detail || actionRunning.current) return
    const id = detailRequestId.current
    actionRunning.current = true
    setDetailBusy(true); setDetailError(''); setDetailNotice('')
    try {
      const data = await apiRequest(`/api/account/upgrade-orders/${encodeURIComponent(detail.id)}/pay-status`, { method: 'POST' })
      if (id !== detailRequestId.current) return
      setDetail(data.order)
      setDetailNotice(data.message || '支付状态已刷新')
      fetchOrders(undefined, { quiet: true })
    } catch (err) { if (id === detailRequestId.current) { if (err.status === 401) clearSession(); else setDetailError(err.message || '支付状态查询失败') } }
    finally { actionRunning.current = false; setDetailBusy(false) }
  }

  const cancelOrder = async () => {
    if (!detail || actionRunning.current) return
    const id = detailRequestId.current
    actionRunning.current = true
    setDetailBusy(true); setDetailError('')
    try {
      const data = await apiRequest(`/api/account/upgrade-orders/${encodeURIComponent(detail.id)}/cancel`, { method: 'POST' })
      if (id !== detailRequestId.current) return
      setDetail(data.order); setDetailNotice('订单已取消'); setConfirmCancel(false)
      fetchOrders(undefined, { quiet: true })
    } catch (err) { if (id === detailRequestId.current) { if (err.status === 401) clearSession(); else setDetailError(err.message || '取消订单失败') } }
    finally { actionRunning.current = false; setDetailBusy(false) }
  }

  const startLogin = () => {
    if (onLogin) { onLogin(); return }
    const returnTo = `${window.location.origin}${window.location.pathname}${window.location.search}${window.location.hash}`
    window.location.href = `/api/auth/login?return_to=${encodeURIComponent(returnTo)}`
  }

  const counts = result.counts || {}
  const pagination = result.pagination || { page: query.page, total: 0, totalPages: 1 }
  const visibleOrders = useMemo(() => result.orders || [], [result.orders])
  const paymentWorkspace = upgradeOrder ? { plan: { id: 'free', label: '当前权益' }, plans: [], orders: [upgradeOrder] } : null

  return (
    <section className="orders-page orders-embedded" aria-label="我的订单">
      {!user || sessionLost ? (
        <section className="orders-state"><span className="orders-state-icon"><FileSearch size={23} /></span><h2>登录后查看订单</h2><p>订单记录与当前鲲穹账号关联，只有你本人可以查询。</p><button type="button" className="primary-button" onClick={startLogin}>登录鲲穹账号</button></section>
      ) : (
        <>
          <div className="orders-account-line"><span>共 {counts.all ?? pagination.total ?? 0} 笔订单</span><a href="/workspace">查看当前会员权益<ArrowRight size={13} /></a></div>
          <section className="orders-toolbar" aria-label="订单查询">
            <div className="orders-filters" role="group" aria-label="按状态筛选订单">
              {ORDER_STATUSES.map(([value, label]) => <button key={value} type="button" aria-label={label} className={query.status === value ? 'active' : ''} aria-pressed={query.status === value} onClick={() => changeQuery({ ...query, status: value, page: 1 })}>{label}<span>{counts[value] ?? 0}</span></button>)}
            </div>
            <form className="orders-search" onSubmit={submitSearch}><Search size={16} /><input aria-label="搜索订单号" value={searchInput} maxLength={80} onChange={event => setSearchInput(event.target.value)} placeholder="搜索本站或支付平台订单号" /><button type="submit" aria-label="搜索订单"><Search size={15} /></button></form>
          </section>
          <div className="orders-list-heading"><strong>订单记录</strong><button type="button" className="orders-refresh" aria-label="刷新订单" onClick={() => fetchOrders(query)} disabled={loading}><RefreshCw size={14} className={loading ? 'is-spinning' : ''} />刷新</button></div>
          {error ? <section className="orders-state orders-error"><p role="alert">{error}</p><button type="button" className="secondary-button" onClick={() => fetchOrders(query)}><RefreshCw size={15} /> 重试</button></section> : loading && !visibleOrders.length ? <div className="orders-state"><span className="loading-dot" /><p>正在加载订单…</p></div> : visibleOrders.length ? (
            <>
              <div className="orders-table" role="list" aria-label="订单列表" aria-busy={loading}>
                {visibleOrders.map(order => <article className="orders-row" role="listitem" data-order-id={order.id} key={order.id}>
                  <div className="orders-row-main"><strong>{order.planLabel || '会员套餐'}</strong><code>{order.orderNo}</code><span className="orders-created">创建于 {dateLabel(order.createdAt)}</span></div>
                  <div className="orders-row-amount">{amountLabel(order.amount)}</div><OrderStatus status={order.status} />
                  <button type="button" className="orders-detail-button" aria-label={`查看订单 ${order.orderNo}`} onClick={() => openDetail(order)} disabled={loading}>查看详情<ArrowRight size={14} /></button>
                </article>)}
              </div>
              <nav className="orders-pagination" aria-label="订单分页"><span>第 {pagination.page || query.page} 页，共 {pagination.totalPages || 1} 页 · {pagination.total || 0} 笔</span><div><button type="button" aria-label="上一页" onClick={() => changeQuery({ ...query, page: Math.max(1, query.page - 1) })} disabled={query.page <= 1 || loading}><ArrowLeft size={14} />上一页</button><button type="button" aria-label="下一页" onClick={() => changeQuery({ ...query, page: Math.min(pagination.totalPages || 1, query.page + 1) })} disabled={query.page >= (pagination.totalPages || 1) || loading}>下一页<ArrowRight size={14} /></button></div></nav>
            </>
          ) : <section className="orders-state orders-empty"><span className="orders-state-icon"><FileSearch size={23} /></span><h2>{query.q ? '没有找到匹配订单' : '暂无订单'}</h2><p>{query.q ? '请检查订单号，或清空搜索条件。' : '创建会员套餐订单后，会显示在这里。'}</p>{query.q && <button type="button" className="secondary-button" aria-label="清空搜索" onClick={() => changeQuery({ ...query, q: '', page: 1 })}>清空搜索</button>}</section>}
        </>
      )}
      {copyNotice && <div className="orders-toast" role="status">{copyNotice}</div>}
      {detail && <OrderDetail order={detail} busy={detailBusy} loading={detailLoading} notice={detailNotice} error={detailError} confirmCancel={confirmCancel} onClose={closeDetail} onCopy={copyOrder} onCheck={checkPayment} onContinue={() => { setUpgradeOrder(detail); closeDetail() }} onAskCancel={() => setConfirmCancel(true)} onDismissCancel={() => setConfirmCancel(false)} onCancel={cancelOrder} onRetry={detailLoadFailed ? () => openDetail(detail) : null} onLogin={startLogin} />}
      {upgradeOrder && paymentWorkspace && <UpgradeModal workspace={paymentWorkspace} initialOrder={upgradeOrder} onClose={() => { setUpgradeOrder(null); fetchOrders(undefined, { quiet: true }) }} onRefresh={() => fetchOrders(undefined, { quiet: true })} onNotify={message => setCopyNotice(message)} requireCancelConfirmation />}
    </section>
  )
}
