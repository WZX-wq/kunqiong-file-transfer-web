import React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useRemotePlanPricing } from '../hooks.js'
import { apiRequest, copyTextToClipboard, mergePlanPricing, upgradeApiRequest } from '../lib/api.js'
import { ConfirmModal, FeedbackMessage, PublicShell } from '../components/common.jsx'
import { ArrowLeft, BadgeCheck, BarChart3, Building2, Check, ChevronRight, Clock3, Copy, Crown, HardDrive, Link2, ListChecks, PencilLine, RefreshCw, RotateCcw, ScanLine, Sparkles, UserRound, Users, Wallet, X, Zap } from 'lucide-react'
import { feedbackTone, formatBytes, formatDate, formatPlanPrice } from '../lib/format.js'
import { PlanSpaceSummary } from '../components/ui.jsx'
import { ACCOUNT_PLAN_ICON, ACCOUNT_PLAN_RANK, UPGRADE_ORDER_STATUS_LABELS } from '../lib/constants.js'
import { TEAM_NAME_MAX, limitInputText } from '../lib/input-limits.js'

export function WorkspacePage() {
  const [user, setUser] = useState(null)
  const [workspace, setWorkspace] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [teamName, setTeamName] = useState('')
  const [editingTeamName, setEditingTeamName] = useState(false)
  const [workspaceName, setWorkspaceName] = useState('')
  const [saving, setSaving] = useState(false)
  const [selectedPlanId, setSelectedPlanId] = useState('')
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const loadRunning = useRef(null)
  const mounted = useRef(false)
  // 远端主站套餐实价：工作台展示价与升级弹窗/订单支付同源，拉不到时回落本地配置价
  const remotePricing = useRemotePlanPricing(user?.id)

  const load = ({ silent = false } = {}) => {
    if (!mounted.current) return Promise.resolve()
    if (loadRunning.current) {
      // Checkout may finish after the current request took its workspace snapshot.
      loadRunning.current.queued = true
      return loadRunning.current.promise
    }
    const request = { queued: false, controller: new AbortController(), promise: null }
    loadRunning.current = request
    if (!silent) setLoading(true)
    request.promise = (async () => {
      const signal = request.controller.signal
      try {
        do {
          request.queued = false
          try {
            const auth = await apiRequest('/api/auth/me', { signal })
            const data = auth.user ? await apiRequest('/api/account/workspace', { signal }) : null
            if (!mounted.current || signal.aborted) return
            setUser(auth.user || null)
            setWorkspace(data)
            setError('')
            if (!auth.user) { setUpgradeOpen(false); return }
          } catch (err) {
            if (!mounted.current || signal.aborted) return
            if (err.status === 401) {
              setUser(null)
              setWorkspace(null)
              setUpgradeOpen(false)
              return
            }
            setError(err.message || '团队空间加载失败')
          }
        } while (request.queued && mounted.current && !signal.aborted)
      } finally {
        if (loadRunning.current === request) loadRunning.current = null
        if (mounted.current && !signal.aborted && !silent) setLoading(false)
      }
    })()
    return request.promise
  }

  useEffect(() => {
    mounted.current = true
    load()
    return () => {
      mounted.current = false
      loadRunning.current?.controller.abort()
      loadRunning.current = null
    }
  }, [])
  useEffect(() => {
    if (!user) return undefined
    const refresh = () => {
      if (document.visibilityState === 'visible') load({ silent: true })
    }
    const timer = workspace?.paymentReconciliation?.pending ? window.setInterval(refresh, 15000) : null
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      if (timer !== null) window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [user?.id, workspace?.paymentReconciliation?.pending])
  useEffect(() => {
    if (workspace?.plan?.id) setSelectedPlanId(workspace.plan.id)
  }, [workspace?.plan?.id])
  useEffect(() => {
    if (workspace?.organization?.name && !editingTeamName) setWorkspaceName(workspace.organization.name)
  }, [workspace?.organization?.name, editingTeamName])
  useEffect(() => {
    if (!message) return undefined
    const timer = window.setTimeout(() => setMessage(''), 3000)
    return () => window.clearTimeout(timer)
  }, [message])

  const login = () => {
    const returnTo = `${window.location.origin}${window.location.pathname}${window.location.search}${window.location.hash}`
    window.location.href = `/api/auth/login?return_to=${encodeURIComponent(returnTo)}`
  }

  const createTeam = async (event) => {
    event.preventDefault()
    if (!teamName.trim()) return
    if (!workspace?.plan?.team) {
      setError('团队空间需要团队版或企业版权益')
      return
    }
    setSaving(true)
    setError('')
    try {
      setWorkspace(await apiRequest('/api/account/workspace', { method: 'POST', body: JSON.stringify({ name: teamName.trim() }) }))
      setTeamName('')
      setMessage('团队空间已创建')
    } catch (err) {
      setError(err.message || '团队空间创建失败')
    } finally {
      setSaving(false)
    }
  }

  const saveWorkspaceName = async (event) => {
    event.preventDefault()
    const name = workspaceName.trim()
    if (!name || workspace?.organization?.ownerUserId !== user?.id) return
    setSaving(true)
    setError('')
    try {
      setWorkspace(await apiRequest('/api/account/workspace', { method: 'PATCH', body: JSON.stringify({ name }) }))
      setEditingTeamName(false)
      setMessage('团队名称已更新')
    } catch (err) {
      setError(err.message || '团队名称更新失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <PublicShell><div className="state-block"><span className="loading-dot" /><h1>正在打开团队空间</h1><p>正在读取账号权益和团队数据。</p></div></PublicShell>
  if (!user) {
    return <PublicShell><div className="state-block"><div className="settings-state-icon"><Building2 size={24} /></div><h1>登录后使用团队空间</h1><p>会员容量、团队成员和入团申请会与鲲穹账号关联。</p><button className="primary-button" onClick={login}><UserRound size={16} /> 使用鲲穹登录</button></div></PublicShell>
  }
  const plan = workspace?.plan || {}
  const plans = (workspace?.plans || []).map((item) => mergePlanPricing(item, remotePricing))
  const planDisplay = mergePlanPricing(plan, remotePricing)
  const orders = workspace?.orders || []
  const pendingOrder = orders.find((order) => order.status === 'pending_payment') || null
  const selectedPlan = plans.find((item) => item.id === selectedPlanId) || plan
  const capacity = workspace?.capacity || {}
  const organization = workspace?.organization
  // teamEntitlement 是「借用的团队侧能力」，与个人套餐分开：
  // 成员加入团队后可共享团队空间，但个人套餐保持原样（基础版仍是基础版）。
  const teamEntitlement = workspace?.teamEntitlement || {}
  const hasTeamPlan = Boolean(plan.team)
  const canUseTeamSpace = Boolean(teamEntitlement.canUseTeamSpace)
  const teamSpaceBytes = Number(teamEntitlement.teamSpaceBytes || plan.teamSpaceBytes || 0)
  const teamRole = teamEntitlement.role || ''
  const canManageTeam = Boolean(workspace?.canManage)
  const members = organization?.members || []
  const ownerMember = members.find((member) => member.role === 'owner') || members[0] || null
  const selectedTotalBytes = Number(selectedPlan.totalBytes || capacity.totalBytes || 0)
  const ratio = selectedTotalBytes ? Math.min(100, Math.round((capacity.usedBytes / selectedTotalBytes) * 100)) : 0
  const currentPlanLabel = plan.label || '基础版'
  const planValidity = plan.id === 'free' ? '长期免费' : plan.permanent ? '永久有效' : workspace?.planExpiresAt ? `有效至 ${formatDate(workspace.planExpiresAt)}` : '长期有效'
  // 团队邀请入口：走企业专属路径，访客打开后登录即可在页面底部直接申请入团。
  const enterpriseInviteLink = organization ? `${window.location.origin}/e/${organization.slug}/share/` : ''
  const copyEnterpriseLink = async () => {
    setError('')
    setMessage('')
    try {
      await copyTextToClipboard(enterpriseInviteLink)
      setMessage('团队邀请链接已复制，发给同事即可申请加入')
    } catch {
      setError('当前浏览器不支持自动复制，请手动选中链接复制')
    }
  }
  return (
    <PublicShell>
      <section className="workspace-page">
        {(message || error) && <div className="workspace-toast"><FeedbackMessage message={message || error} tone={error ? 'error' : feedbackTone(message)} /></div>}
      <div className="workspace-grid">
            <div className="public-card workspace-hero">
              <div><p className="eyebrow">会员与企业版</p><h1>{currentPlanLabel}空间</h1><p>存储空间、保存策略、团队协作能力均由账号权益统一管控，升级后立即生效。</p></div>
              <div className="orders-workspace-links"><a className="secondary-button" href="/settings/orders"><Wallet size={15} /> 我的订单</a><a className="secondary-button workspace-back-button" href="/"><ArrowLeft size={15} /> 返回首页</a></div>
            </div>
            <div className="public-card workspace-section workspace-benefits-card">
              <div className="workspace-section-heading"><div><p className="eyebrow">当前权益</p><h2><Crown size={18} /> {currentPlanLabel}</h2><p className="workspace-plan-subtitle">{planValidity} · {formatPlanPrice(planDisplay)}</p></div><span className="workspace-status" title={plan.permanent ? '会员版及以上权益支持永久保存文件。' : '临时保存文件到期会失效。'}>{plan.permanent ? '支持永久保存' : '临时保存'}</span></div>
              <div className="workspace-capacity"><div><span>已使用空间 · {selectedPlan.label || currentPlanLabel}</span><strong>{formatBytes(capacity.usedBytes || 0)} / {formatBytes(selectedTotalBytes)}</strong></div><div className="capacity-bar" title={`已使用 ${ratio}%`} role="progressbar" aria-valuenow={ratio} aria-valuemin="0" aria-valuemax="100"><span style={{ width: `${ratio}%` }} /></div><small>{capacity.shareCount || 0} 个分享 · {capacity.collectionCount || 0} 个收集任务 · {capacity.fileCount || 0} 个文件</small></div>
              <div className="plan-comparison" role="tablist" aria-label="账号权益版本">{plans.map((item) => <button type="button" className={item.id === selectedPlan.id ? 'current' : ''} key={item.id} onClick={() => setSelectedPlanId(item.id)} role="tab" aria-selected={item.id === selectedPlan.id ? 'true' : 'false'}><em className="plan-current-tag">{item.id === plan.id ? '当前' : item.team ? '推荐' : ''}</em><span className="plan-title-line">{(() => { const PlanIcon = accountPlanIcon(item.id); return <PlanIcon size={15} /> })()}<strong>{item.label}</strong></span><PlanSpaceSummary plan={item} /><small className="plan-price-summary">{formatPlanPrice(item)}</small></button>)}</div>
              <div className="workspace-benefits-cta"><span>{plan.id === 'enterprise' ? '你已拥有最高企业版权益。' : '需要更多空间、永久保存或团队协作？'}</span><button className="primary-button" onClick={() => setUpgradeOpen(true)}><Zap size={15} /> {plan.id === 'enterprise' ? '查看权益详情' : '升级权益'}</button></div>
            </div>
            <div className="workspace-lower-row">
            <div className="public-card workspace-section workspace-team-card">
              <div className="workspace-section-heading">
                <div className="workspace-team-heading">
                  <p className="eyebrow">团队空间</p>
                  {organization?.ownerUserId === user.id && editingTeamName ? (
                    <form className="workspace-name-form" onSubmit={saveWorkspaceName}>
                      <input value={workspaceName} onChange={(event) => setWorkspaceName(limitInputText(event.target.value, TEAM_NAME_MAX))} maxLength={TEAM_NAME_MAX} title={`团队名称最多 ${TEAM_NAME_MAX} 个字符`} autoFocus aria-label="团队名称" />
                      <button type="submit" className="ghost-icon" disabled={saving || !workspaceName.trim()} aria-label="保存团队名称" title="保存团队名称"><Check size={16} /></button>
                      <button type="button" className="ghost-icon" disabled={saving} onClick={() => { setWorkspaceName(organization.name); setEditingTeamName(false) }} aria-label="取消编辑团队名称" title="取消编辑"><X size={16} /></button>
                    </form>
                  ) : (
                    <div className="workspace-name-line">
                      <h2><Users size={18} /> {organization?.name || '创建团队空间'}</h2>
                      {organization?.ownerUserId === user.id && <button type="button" className="ghost-icon" onClick={() => setEditingTeamName(true)} aria-label="编辑团队名称" title="编辑团队名称"><PencilLine size={15} /></button>}
                    </div>
                  )}
                </div>
                {organization
                  ? <span className="workspace-status">{teamRole === 'owner' ? '团队所有者' : teamRole === 'admin' ? '团队管理员' : '团队成员'}</span>
                  : <span className="workspace-status muted team-required-tag" title={canManageTeam ? '当前权益可以创建团队空间。' : '该功能需要升级团队版权限才可解锁。'}>{canManageTeam ? '可创建' : '需团队版'}</span>}
              </div>
              {!organization ? (
                hasTeamPlan ? <form className="workspace-inline-form" onSubmit={createTeam}><input value={teamName} onChange={(event) => setTeamName(limitInputText(event.target.value, TEAM_NAME_MAX))} maxLength={TEAM_NAME_MAX} title={`团队名称最多 ${TEAM_NAME_MAX} 个字符`} placeholder="例如：鲲穹设计团队" /><button className="primary-button" disabled={saving || !teamName.trim()}><Building2 size={15} /> 创建团队</button></form> : <div className="workspace-upgrade-notice"><Sparkles size={18} /><div><strong>团队空间属于团队版/企业版权益</strong><span>升级至团队版/企业版后，即可创建团队、邀请成员，生成企业专属分享链接。</span></div></div>
              ) : (
                <>
                  {teamRole === 'owner' && !canManageTeam && <div className="workspace-upgrade-notice"><Sparkles size={18} /><div><strong>当前权益已关闭团队协作</strong><span>恢复团队版或企业版权益后，可以继续邀请和管理成员。</span></div></div>}
                  {teamRole === 'member' && <div className="workspace-share-notice"><Users size={18} /><div><strong>你已加入「{organization.name}」，正在共享团队空间</strong><span>团队空间的容量由团队所有者提供，你个人的空间与权益保持不变。</span></div></div>}
                  <div className="workspace-team-body">
                    <div className="workspace-team-block">
                      <p className="workspace-block-label">团队所有者</p>
                      {ownerMember && <div className="workspace-owner-summary"><span className="workspace-member-avatar">{(ownerMember.displayName || '团').slice(0, 1)}</span><div><strong>{ownerMember.displayName || ownerMember.email || ownerMember.phone || '团队所有者'}</strong><span>{ownerMember.email || ownerMember.phone || ownerMember.userId || '当前账号'} · 所有者</span></div><span className="workspace-member-state active">所有者</span></div>}
                    </div>
                    <div className="workspace-team-block">
                      <p className="workspace-block-label"><Link2 size={14} /> 团队邀请链接</p>
                      {canManageTeam ? (
                        <>
                          <p className="workspace-block-hint">把它发给同事，对方登录后即可申请加入，申请会出现在团队空间里由你审批。</p>
                          <div className="workspace-invite-link-row">
                            <code title={enterpriseInviteLink}>{enterpriseInviteLink}</code>
                            <button type="button" className="copy-button" onClick={copyEnterpriseLink}><Copy size={14} /> 复制</button>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="workspace-block-hint">邀请链接由团队所有者管理，如需邀请同事请联系所有者。</p>
                          <div className="workspace-invite-link-row">
                            <code title={enterpriseInviteLink}>{enterpriseInviteLink}</code>
                            <button type="button" className="copy-button" onClick={copyEnterpriseLink}><Copy size={14} /> 复制</button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="workspace-team-foot">
                    <span>其他成员、待加入成员和入团申请请前往团队空间查看</span>
                    <button type="button" className="team-manage-link" onClick={() => { window.location.href = '/team' }}><BarChart3 size={14} /> 查看团队成员与使用情况 <ChevronRight size={14} /></button>
                  </div>
                </>
              )}
            </div>
            <div className="public-card workspace-side-card workspace-status-card"><div className="workspace-side-heading"><ListChecks size={22} /><strong>当前状态</strong></div><div className="workspace-status-list"><span className={plan.permanent ? 'on' : 'off'}>{plan.permanent ? <Check size={13} /> : <X size={13} />} 文件永久保存</span><span className={hasTeamPlan || canUseTeamSpace ? 'on' : 'off'}>{hasTeamPlan || canUseTeamSpace ? <Check size={13} /> : <X size={13} />} {teamRole === 'member' && !hasTeamPlan ? '共享团队空间' : '团队协作与成员管理'}</span><span className={organization ? 'on' : 'off'}>{organization ? <Check size={13} /> : <X size={13} />} 分享链接入团申请</span></div>{pendingOrder && <button type="button" className="workspace-pending-banner" onClick={() => setUpgradeOpen(true)}><Clock3 size={14} /> 有 1 个待支付升级订单，点击查看</button>}{workspace?.paymentReconciliation?.requiresLogin && <div className="workspace-payment-warning" role="status">支付订单需要重新登录核对状态。<button type="button" className="team-manage-link" onClick={login}><UserRound size={14} /> 重新登录</button></div>}<button className="primary-button" onClick={() => setUpgradeOpen(true)}><Zap size={15} /> {canManageTeam ? '升级权益' : '查看升级方式'}</button></div>
            </div>
        </div>
      </section>
      {upgradeOpen && <UpgradeModal workspace={workspace} onClose={() => setUpgradeOpen(false)} onRefresh={load} onNotify={(text, tone) => { if (tone === 'error') setError(text); else setMessage(text) }} />}
    </PublicShell>
  )
}

export const accountPlanRank = (planId) => ACCOUNT_PLAN_RANK[planId] ?? 0

export const accountPlanIcon = (planId) => ACCOUNT_PLAN_ICON[planId] || HardDrive

export function UpgradeModal({ workspace, onClose, onRefresh, onNotify, requireCancelConfirmation = false }) {
  const plan = workspace?.plan || {}
  const localPlans = (workspace?.plans || []).filter((item) => item.id !== 'free')
  const pendingOrder = (workspace?.orders || []).find((order) => order.status === 'pending_payment') || null
  const currentPlanRank = accountPlanRank(plan.id)
  const defaultPlanId = localPlans.find((item) => accountPlanRank(item.id) >= currentPlanRank && !(item.id === plan.id && item.permanent))?.id || ''
  const [selectedPlanId, setSelectedPlanId] = useState(defaultPlanId)
  const [orderView, setOrderView] = useState(pendingOrder)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [cancelConfirmation, setCancelConfirmation] = useState(false)
  const [payType, setPayType] = useState(pendingOrder?.payType || 1)
  const [payment, setPayment] = useState(pendingOrder?.payment || null)
  const attemptedPaymentOrder = useRef(null)
  const paymentRequestRunning = useRef(false)
  // 远端主站套餐实价：与订单创建/支付同源，避免「展示价 ≠ 下单应付金额」
  const remotePricing = useRemotePlanPricing(true)
  const plans = localPlans.map((item) => mergePlanPricing(item, remotePricing))
  const priceAvailable = (id) => Boolean(remotePricing?.[id] && remotePricing[id].available !== false && !remotePricing.error)
  const pricingError = remotePricing?.error || (remotePricing && !priceAvailable(selectedPlanId) ? '套餐暂不可用，请稍后重试' : '')

  useEffect(() => {
    if (pendingOrder) setOrderView(pendingOrder)
  }, [pendingOrder])
  useEffect(() => {
    if (!orderView?.payment) return
    setPayment(orderView.payment)
    if (orderView.payType) setPayType(orderView.payType)
  }, [orderView?.id, orderView?.payment, orderView?.payType])
  useEffect(() => {
    if (!payment || !orderView || orderView.status !== 'pending_payment') return undefined
    const controller = new AbortController()
    let running = false
    const timer = window.setInterval(async () => {
      if (running || controller.signal.aborted) return
      running = true
      try {
        const result = await upgradeApiRequest(`/api/account/upgrade-orders/${encodeURIComponent(orderView.id)}/pay-status`, { method: 'POST', signal: controller.signal })
        if (controller.signal.aborted) return
        setOrderView(result.order)
        if (result.workspace) {
          onRefresh?.({ silent: true })
        }
        if (result.order?.status === 'paid') {
          setError('')
          setPayment(null)
          setNotice('支付成功，会员权益已开通')
          onNotify?.('会员权益已开通', 'success')
        }
      } catch {
        // 轮询失败不打断收银台，用户仍可手动重试。
      } finally { running = false }
    }, 2000)
    return () => { window.clearInterval(timer); controller.abort() }
  }, [payment, orderView?.id, orderView?.status])

  const selectedPlan = plans.find((item) => item.id === selectedPlanId && accountPlanRank(item.id) >= currentPlanRank && !(item.id === plan.id && item.permanent)) || null
  const isCurrentPlan = (item) => item.id === plan.id
  const isIncludedPlan = (item) => accountPlanRank(item.id) < currentPlanRank || (item.id === plan.id && item.permanent)

  const createOrder = async () => {
    if (!selectedPlan || busy || !priceAvailable(selectedPlan.id)) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await upgradeApiRequest('/api/account/upgrade-orders', { method: 'POST', body: JSON.stringify({ planId: selectedPlan.id }) })
      setOrderView(result.order)
      onRefresh?.({ silent: true })
      onNotify?.('升级订单已创建', 'success')
    } catch (err) {
      if (err.order) {
        setOrderView(err.order)
        onRefresh?.({ silent: true })
      } else {
        setError(err.message || '升级订单创建失败')
      }
    } finally {
      setBusy(false)
    }
  }

  const loadPayment = async () => {
    if (!orderView || orderView.status !== 'pending_payment' || busy || paymentRequestRunning.current) return
    paymentRequestRunning.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await upgradeApiRequest(`/api/account/upgrade-orders/${encodeURIComponent(orderView.id)}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ payType }),
      })
      const nextPayment = result.payment || result.order?.payment || null
      const nextPayType = result.order?.payType || payType
      if (nextPayType === 2 ? !nextPayment?.alipaysubmit_html : !nextPayment?.qrcode_img_url) {
        throw new Error(nextPayType === 2 ? '支付服务未返回支付宝收银台，请稍后重试' : '支付服务未返回微信支付二维码，请稍后重试')
      }
      setOrderView(result.order)
      setPayment(nextPayment)
      setPayType(nextPayType)
      onRefresh?.({ silent: true })
      setNotice(nextPayType === 2 ? '支付宝收银台已加载，请完成支付后刷新支付状态' : result.message || '微信支付二维码已创建，请扫码支付')
    } catch (err) {
      setError(err.message || '支付订单创建失败')
    } finally {
      paymentRequestRunning.current = false
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!orderView) { attemptedPaymentOrder.current = null; return }
    if (orderView.status !== 'pending_payment' || payment || busy || attemptedPaymentOrder.current === orderView.id) return
    attemptedPaymentOrder.current = orderView.id
    loadPayment()
  }, [orderView?.id, orderView?.status, payment, busy])

  const checkPayStatus = async () => {
    if (!orderView || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await upgradeApiRequest(`/api/account/upgrade-orders/${encodeURIComponent(orderView.id)}/pay-status`, { method: 'POST' })
      setOrderView(result.order)
      if (result.workspace) onRefresh?.({ silent: true })
      setNotice(result.message || '支付状态已刷新')
      if (result.order?.status === 'paid') {
        setPayment(null)
        onNotify?.('会员权益已开通', 'success')
      }
    } catch (err) {
      setError(err.message || '支付状态查询失败')
    } finally {
      setBusy(false)
    }
  }

  const cancelOrder = async () => {
    if (!orderView || busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await upgradeApiRequest(`/api/account/upgrade-orders/${encodeURIComponent(orderView.id)}/cancel`, { method: 'POST' })
      setOrderView(null)
      setPayment(null)
      onRefresh?.({ silent: true })
      onNotify?.('升级订单已取消', 'success')
    } catch (err) {
      setError(err.message || '订单取消失败')
    } finally {
      setBusy(false)
    }
  }

  const paymentMethodSelector = <div className="upgrade-pay-type" role="group" aria-label="支付方式"><button type="button" className={payType === 1 ? 'selected' : ''} aria-pressed={payType === 1} onClick={() => setPayType(1)} disabled={busy}><ScanLine size={15} /> 微信扫码</button><button type="button" className={payType === 2 ? 'selected' : ''} aria-pressed={payType === 2} onClick={() => setPayType(2)} disabled={busy}><Wallet size={15} /> 支付宝</button></div>

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal upgrade-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div><p className="eyebrow">会员与企业版</p><h2>{orderView ? (orderView.status === 'paid' ? '支付成功' : '升级订单') : '升级权益'}</h2></div>
          <button className="ghost-icon modal-close" aria-label="关闭升级窗口" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body upgrade-modal-body">
          {error && <FeedbackMessage message={error} tone="error" />}
          {!orderView && pricingError && <FeedbackMessage message={pricingError} tone="error" />}
          {!orderView && !remotePricing && <p role="status">正在加载套餐价格…</p>}
          {orderView ? (orderView.status === 'paid' ? (
            <div className="upgrade-success-view" role="status">
              <span className="upgrade-success-icon"><BadgeCheck size={34} /></span>
              <h3>{orderView.planLabel}权益已开通</h3>
              <p>{orderView.planId === 'enterprise' ? '文件永久保存，感谢支持' : '文件保存有效期已自动顺延，立即生效'}</p>
              <dl className="upgrade-order-meta">
                <div><dt>支付金额</dt><dd><strong className="upgrade-success-amount">{Number.isFinite(Number(orderView.amount)) ? `¥${(Number(orderView.amount) / 100).toFixed(2)}` : '—'}</strong></dd></div>
                <div><dt>有效期至</dt><dd>{orderView.planId === 'enterprise' ? '永久有效' : orderView.remoteExpireAt ? formatDate(orderView.remoteExpireAt) : '以主站权益为准'}</dd></div>
                <div><dt>订单号</dt><dd><code>{orderView.orderNo}</code><button type="button" className="copy-button" onClick={async () => { try { await copyTextToClipboard(orderView.orderNo); onNotify?.('订单号已复制', 'success') } catch { /* 忽略 */ } }}><Copy size={13} /> 复制</button></dd></div>
                {orderView.paidAt && <div><dt>支付时间</dt><dd>{formatDate(orderView.paidAt)}</dd></div>}
              </dl>
              <div className="upgrade-order-actions">
                <button className="primary-button upgrade-success-done" onClick={onClose}><Check size={15} /> 完成</button>
              </div>
            </div>
          ) : (
            <div className="upgrade-order-view">
              <div className="upgrade-order-head">
                <span className="upgrade-order-plan"><Crown size={18} /> {orderView.planLabel}</span>
                <span className={`upgrade-order-status ${orderView.status}`}>{UPGRADE_ORDER_STATUS_LABELS[orderView.status] || orderView.status}</span>
              </div>
              <dl className="upgrade-order-meta">
                <div><dt>订单号</dt><dd><code>{orderView.orderNo}</code><button type="button" className="copy-button" onClick={async () => { try { await copyTextToClipboard(orderView.orderNo); onNotify?.('订单号已复制', 'success') } catch { /* 忽略 */ } }}><Copy size={13} /> 复制</button></dd></div>
                <div><dt>创建时间</dt><dd>{formatDate(orderView.createdAt)}</dd></div>
                <div><dt>应付金额</dt><dd>{Number.isFinite(Number(orderView.amount)) ? `¥${(Number(orderView.amount) / 100).toFixed(2)}` : '价格以支付通道为准'}</dd></div>
              </dl>
              {orderView.status === 'pending_payment' && !payment && paymentMethodSelector}
              {orderView.status === 'pending_payment' && !payment && (busy || !error) && <div className="upgrade-payment-qr" role="status"><span className="loading-dot" /><span>{payType === 2 ? '正在加载支付宝收银台…' : '正在加载微信支付二维码…'}</span></div>}
              {payment?.qrcode_img_url && <div className="upgrade-payment-qr"><img src={payment.qrcode_img_url} alt="微信支付二维码" /><span>请使用微信扫码支付</span></div>}
              {payment?.alipaysubmit_html && <div className="upgrade-payment-qr upgrade-payment-alipay"><div className="upgrade-payment-alipay-frame"><iframe title="支付宝收银台" scrolling="no" srcDoc={payment.alipaysubmit_html} /></div><span>请使用支付宝扫码支付</span></div>}
              <div className="upgrade-order-note"><Clock3 size={15} /><span>{notice || '支付成功后会员权益会自动开通。'}</span></div>
              {orderView.status === 'pending_payment' ? (
                <div className="upgrade-order-actions">
                  {!payment && error && <button className="primary-button" onClick={loadPayment} disabled={busy}><RefreshCw size={15} /> {busy ? '正在加载…' : '重新加载支付码'}</button>}
                  {payment && <button className="secondary-button" onClick={checkPayStatus} disabled={busy}><RefreshCw size={15} /> 刷新支付状态</button>}
                  <button className="secondary-button" onClick={() => requireCancelConfirmation ? setCancelConfirmation(true) : cancelOrder()} disabled={busy}><X size={15} /> 取消订单</button>
                </div>
              ) : (
                <div className="upgrade-order-actions">
                  <button className="primary-button" onClick={() => { setOrderView(null); setPayment(null); onRefresh?.({ silent: true }) }}><RotateCcw size={15} /> 重新选择套餐</button>
                </div>
              )}
            </div>
          )) : (
            <>
              <p className="upgrade-intro">当前权益：<strong>{plan.label || '基础版'}</strong>。价格和有效期以当前支付套餐为准，创建订单前会同步主站实际金额。</p>
              <div className="upgrade-plan-grid">
                {plans.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={`upgrade-plan-card ${item.id === selectedPlanId ? 'selected' : ''} ${isIncludedPlan(item) ? 'is-current' : ''}`}
                    onClick={() => !isIncludedPlan(item) && setSelectedPlanId(item.id)}
                    disabled={isIncludedPlan(item) || !priceAvailable(item.id)}
                    aria-pressed={item.id === selectedPlanId}
                  >
                    <span className="upgrade-plan-top">{(() => { const PlanIcon = accountPlanIcon(item.id); return <span className="upgrade-plan-icon"><PlanIcon size={16} /></span> })()}<strong>{item.label}</strong>{isCurrentPlan(item) ? <em>当前权益</em> : isIncludedPlan(item) ? <em>已包含</em> : item.team ? <em className="hot">团队推荐</em> : null}</span>
                    <PlanSpaceSummary plan={item} compact />
                    <span className="upgrade-plan-tags"><strong className="upgrade-plan-price">{formatPlanPrice(item)}</strong><span className="upgrade-plan-detail">{item.permanent ? '永久保存' : '临时保存'}{item.team ? ' · 团队协作' : ''}</span></span>
                    <ul className="upgrade-plan-features">
                      {(item.features || []).map((feature) => <li key={feature}><Check size={12} /> {feature}</li>)}
                    </ul>
                  </button>
                ))}
              </div>
              {selectedPlan && paymentMethodSelector}
              {selectedPlan && (
                <div className="upgrade-summary">
                  <span><Sparkles size={14} /> {plan.label || '基础版'} → <strong>{selectedPlan.label}</strong>：{selectedPlan.tagline}</span>
                  <button className="primary-button" onClick={createOrder} disabled={busy || !priceAvailable(selectedPlan.id)}><Zap size={15} /> {busy ? '正在创建…' : selectedPlan.id === plan.id ? '创建续费订单' : '创建升级订单'}</button>
                </div>
              )}
              <p className="upgrade-hint">支付成功后权益自动生效，续费会顺延有效期。</p>
            </>
          )}
        </div>
      </div>
      {cancelConfirmation && <div onMouseDown={event => event.stopPropagation()}><ConfirmModal state={{ title: '确认取消订单？', detail: '取消后此订单将无法继续支付。', cancelText: '暂不取消', confirmText: '确认取消', tone: 'danger' }} onCancel={() => setCancelConfirmation(false)} onConfirm={() => { setCancelConfirmation(false); cancelOrder() }} /></div>}
    </div>
  )
}
