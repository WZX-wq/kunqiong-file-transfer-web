import React from 'react'
import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import { useRemotePlanPricing } from '../hooks.js'
import { apiRequest, copyTextToClipboard, mergePlanPricing, upgradeApiRequest } from '../lib/api.js'
import { ConfirmModal, FeedbackMessage, PublicShell } from '../components/common.jsx'
import { ArrowLeft, BadgeCheck, Building2, Check, ChevronRight, Clock3, Copy, Crown, HardDrive, History, Info, Link2, PencilLine, RefreshCw, RotateCcw, ScanLine, ShieldCheck, Sparkles, UserRound, Users, Wallet, X, Zap } from 'lucide-react'
import { feedbackTone, formatBytes, formatDate, formatPlanPrice } from '../lib/format.js'
import { PlanSpaceSummary } from '../components/ui.jsx'
import { PlanCarousel } from '../components/plan-carousel.jsx'
import { ACCOUNT_PLAN_ICON, ACCOUNT_PLAN_RANK, UPGRADE_ORDER_STATUS_LABELS } from '../lib/constants.js'
import { TEAM_NAME_MAX, limitInputText } from '../lib/input-limits.js'
import { paymentDeadline, paymentOrderView } from '../lib/upgrade-payment.js'

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
  // 团队共享容量：个人接口只返回个人用量，团队卡片的「已用 / 共享额度」
  // 来自既有团队概览接口；取不到时降级为成员数与额度展示，不编造数字。
  const [teamUsage, setTeamUsage] = useState(null)
  const loadRunning = useRef(null)
  const workspacePlanId = useRef(null)
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
            if (!auth.user) { setUpgradeOpen(false); setTeamUsage(null); return }
            // 团队共享用量单独取；失败时保持空值，卡片降级显示额度与成员数。
            if (data?.organization?.id && data?.teamEntitlement?.canUseTeamSpace) {
              apiRequest('/api/account/team/overview', { signal })
                .then((overview) => { if (mounted.current && !signal.aborted) setTeamUsage(overview?.capacity || null) })
                .catch(() => { if (mounted.current && !signal.aborted) setTeamUsage(null) })
            } else {
              setTeamUsage(null)
            }
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
    if (workspace?.organization?.name && !editingTeamName) setWorkspaceName(workspace.organization.name)
  }, [workspace?.organization?.name, editingTeamName])
  useEffect(() => {
    const nextPlanId = workspace?.plan?.id
    if (!nextPlanId || workspacePlanId.current === nextPlanId) return
    const isInitialPlan = workspacePlanId.current === null
    workspacePlanId.current = nextPlanId
    setSelectedPlanId((current) => isInitialPlan && current ? current : nextPlanId)
  }, [workspace?.plan?.id])
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
  const plans = (workspace?.plans || []).filter(item => !item.retired).map((item) => mergePlanPricing(item, remotePricing))
  const planDisplay = mergePlanPricing(plan, remotePricing)
  const orders = workspace?.orders || []
  const pendingOrder = orders.find((order) => order.status === 'pending_payment') || null
  const capacity = workspace?.capacity || {}
  const organization = workspace?.organization
  // teamEntitlement 是「借用的团队侧能力」，与个人套餐分开：
  // 成员加入团队后可共享团队空间，但个人套餐保持原样（基础版仍是基础版）。
  const teamEntitlement = workspace?.teamEntitlement || {}
  const hasTeamPlan = Boolean(plan.team)
  const canUseTeamSpace = Boolean(teamEntitlement.canUseTeamSpace)
  const teamSpaceBytes = Number(teamEntitlement.teamSpaceBytes || plan.teamSpaceBytes || 0)
  const teamRole = teamEntitlement.role || ''
  const highestTeamPlan = plans.filter((item) => item.team).reduce((highest, item) => !highest || accountPlanRank(item.id) > accountPlanRank(highest.id) ? item : highest, null)
  const hasMaximumTeamEntitlement = Boolean(teamEntitlement.organizationId && teamEntitlement.teamPlanId && highestTeamPlan && accountPlanRank(teamEntitlement.teamPlanId) >= accountPlanRank(highestTeamPlan.id))
  const canManageTeam = Boolean(workspace?.canManage)
  const members = organization?.members || []
  const ownerMember = members.find((member) => member.role === 'owner') || members[0] || null
  const activeMembers = members.filter((member) => member.status === 'active')
  const pendingMemberCount = members.filter((member) => member.status === 'invited' || member.status === 'requested').length
  // 当前空间用量只跟随账号实际权益，套餐比较选择不改变已购额度。
  const currentTotalBytes = Number(capacity.totalBytes ?? plan.totalBytes ?? 0)
  const ratio = currentTotalBytes ? Math.min(100, Math.round((capacity.usedBytes / currentTotalBytes) * 100)) : 0
  const teamUsedBytes = Number(teamUsage?.usedBytes || 0)
  const teamUsedRatio = teamSpaceBytes ? Math.min(100, Math.round((teamUsedBytes / teamSpaceBytes) * 100)) : 0
  const shareBytes = Number(capacity.shareBytes || 0)
  const collectionBytes = Number(capacity.collectionBytes || 0)
  const shareRatio = currentTotalBytes ? Math.min(100, (shareBytes / currentTotalBytes) * 100) : 0
  const collectionRatio = currentTotalBytes ? Math.min(100, (collectionBytes / currentTotalBytes) * 100) : 0
  const isSelectablePlan = (item) => item.id !== 'free' && accountPlanRank(item.id) > accountPlanRank(plan.id)
  const hasMaximumPersonalEntitlement = plans.length > 0 && !plans.some(item => accountPlanRank(item.id) > accountPlanRank(plan.id))
  const defaultSelectedPlan = plans.find(isSelectablePlan) || plan
  const selectedPlan = plans.find((item) => item.id === selectedPlanId && isSelectablePlan(item)) || defaultSelectedPlan
  const currentPlanLabel = plan.label || '基础版'
  const planValidity = plan.id === 'free' ? '长期免费' : plan.permanent ? '永久有效' : workspace?.planExpiresAt ? `有效至 ${formatDate(workspace.planExpiresAt)}` : '长期有效'
  const planCatalogView = new URLSearchParams(window.location.search).get('view') === 'plans'
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
  if (planCatalogView) return (
    <PublicShell className="workspace-shell">
      {(message || error) && <div className="workspace-toast"><FeedbackMessage message={message || error} tone={error ? 'error' : feedbackTone(message)} /></div>}
      <PlanCatalogPage
        plans={plans}
        currentPlan={plan}
        selectedPlanId={selectedPlan.id}
        isSelectablePlan={isSelectablePlan}
        onBack={() => { window.location.href = '/workspace' }}
        onUpgrade={(planId) => { setSelectedPlanId(planId); setUpgradeOpen(true) }}
      />
      {upgradeOpen && <UpgradeModal workspace={workspace} initialPlanId={selectedPlan.id} onClose={() => setUpgradeOpen(false)} onRefresh={load} onNotify={(text, tone) => { if (tone === 'error') setError(text); else setMessage(text) }} />}
    </PublicShell>
  )
  return (
    <PublicShell className="workspace-shell">
      <section className="workspace-page workspace-overview-page">
        {(message || error) && <div className="workspace-toast"><FeedbackMessage message={message || error} tone={error ? 'error' : feedbackTone(message)} /></div>}

        <header className="workspace-page-head">
          <div className="workspace-page-head-copy">
            <div className="workspace-plan-breadcrumb"><a href="/">首页</a><span>/</span><strong>会员与团队</strong></div>
            <h1>会员与团队空间</h1>
            <p>存储空间、保存策略与团队协作能力由账号权益统一管控。</p>
          </div>
          <div className="workspace-page-head-actions">
            <a className="secondary-button" href="/settings/orders"><Wallet size={14} /> 我的订单</a>
            <a className="primary-button" href="/workspace?view=plans"><Crown size={14} /> {hasMaximumPersonalEntitlement ? '查看套餐权益' : '升级套餐'}</a>
          </div>
        </header>

        <div className="workspace-grid">
          <div className="public-card workspace-plan-hero">
            <div className="workspace-plan-hero-copy">
              <span className="ph-badge"><Crown size={14} /> {currentPlanLabel}</span>
              <h2>{formatBytes(currentTotalBytes)} 空间，套餐权益一处管理</h2>
              <p>{planValidity} · {formatPlanPrice(planDisplay)} · 容量、上传上限与协作权益按当前账号配置执行。</p>
              <div className="ph-actions">
                <button type="button" className="primary-button" onClick={() => setUpgradeOpen(true)}>{plan.id === 'enterprise' ? <BadgeCheck size={15} /> : <Zap size={15} />} {plan.id === 'enterprise' ? '查看已购权益' : hasMaximumTeamEntitlement ? '对比可购套餐' : '升级或续费'}</button>
                <a className="secondary-button workspace-back-button" href="/"><ArrowLeft size={14} /> 返回首页</a>
              </div>
            </div>
            <div className="workspace-plan-hero-side">
              <div className="ph-stat"><span>已用容量</span><b>{formatBytes(capacity.usedBytes || 0)} <small>/ {formatBytes(currentTotalBytes)}</small></b><div className="progress sm" role="progressbar" aria-label="个人空间使用率" aria-valuenow={ratio} aria-valuemin="0" aria-valuemax="100"><i style={{ width: `${ratio}%` }} /></div></div>
              <div className="ph-stat workspace-activity-stat"><span>文件与任务</span><b>{capacity.fileCount || 0} 个文件</b><small>{capacity.shareCount || 0} 个分享 · {capacity.collectionCount || 0} 个收集任务</small></div>
            </div>
            <div className="workspace-plan-metrics">
              <div><span><HardDrive size={13} /> 单文件上限</span><b>{formatBytes(plan.singleFileLimitBytes || 0)}</b></div>
              <div><span><Users size={13} /> 收集参与人数</span><b>{plan.collectionParticipantLimit ? `${plan.collectionParticipantLimit} 人` : '不限'}</b></div>
              <div><span><Clock3 size={13} /> 同时进行任务</span><b>{plan.activeCollectionLimit ? `${plan.activeCollectionLimit} 个` : '不限'}</b></div>
              <div><span><Building2 size={13} /> 团队空间</span><b>{(teamSpaceBytes || plan.teamSpaceBytes) ? formatBytes(teamSpaceBytes || plan.teamSpaceBytes) : '未开通'}</b></div>
            </div>
          </div>

          <div className="public-card workspace-benefits-card">
            <div className="workspace-section-heading"><div><p className="eyebrow">当前套餐</p><h2><Crown size={18} /> {currentPlanLabel}</h2><p className="workspace-plan-subtitle">{planValidity} · {formatPlanPrice(planDisplay)}</p></div><a className="text-btn" href="/workspace?view=plans">权益对比 <ChevronRight size={13} /></a></div>
            <div className="workspace-benefits-grid">{(plan.features || []).map((feature, index) => { const FeatureIcon = [Zap, ShieldCheck, Clock3, Users, ScanLine, History][index % 6]; return <div className="workspace-benefit-item" key={`${plan.id}-${feature}`}><span><FeatureIcon size={16} /></span><strong>{feature}</strong></div> })}</div>
            <div className="workspace-plan-attributes" aria-label="套餐与团队权益">
              <span className={plan.permanent ? 'is-on' : 'is-muted'}>{plan.permanent ? <Check size={14} /> : <Clock3 size={14} />} {plan.permanent ? '文件永久保存' : '文件临时保存'}</span>
              <span className={hasTeamPlan || canUseTeamSpace ? 'is-on' : 'is-muted'}>{hasTeamPlan || canUseTeamSpace ? <Check size={14} /> : <X size={14} />} {teamRole === 'member' && !hasTeamPlan ? `共享团队空间${teamSpaceBytes ? ` · ${formatBytes(teamSpaceBytes)}` : ''}` : hasTeamPlan || canUseTeamSpace ? '团队协作已开通' : '团队协作未开通'}</span>
            </div>
            <div className="workspace-plan-note" role="note">
              <Info size={15} />
              <div>{plan.id === 'free' ? '免费版容量与上传上限固定，升级后按新套餐额度立即生效。' : `${currentPlanLabel}${planValidity === '永久有效' ? '永久有效' : planValidity}；套餐到期后按免费版额度重新计算容量。`}</div>
            </div>
            {hasMaximumPersonalEntitlement && <div className="upgrade-maximum-notice workspace-team-maximum-notice" role="status"><BadgeCheck size={20} /><div><strong>你已拥有当前最高等级权益，无需继续升级。</strong></div></div>}
            {pendingOrder && <button type="button" className="workspace-pending-banner" onClick={() => setUpgradeOpen(true)}><Clock3 size={14} /> 有 1 个待支付升级订单，点击查看</button>}
            {workspace?.paymentReconciliation?.requiresLogin && <div className="workspace-payment-warning" role="status">支付订单需要重新登录核对状态。<button type="button" className="team-manage-link" onClick={login}><UserRound size={14} /> 重新登录</button></div>}
            <div className="workspace-benefits-cta"><span>{hasMaximumTeamEntitlement ? '团队空间已拥有最高等级权益' : '套餐升级与支付'}</span><button className="primary-button" onClick={() => setUpgradeOpen(true)}>{plan.id === 'enterprise' ? <BadgeCheck size={15} /> : <Zap size={15} />} {plan.id === 'enterprise' ? '查看已购权益' : hasMaximumTeamEntitlement ? '个人套餐对比' : '立即升级'}</button></div>
          </div>

          <aside className="workspace-side-col">
            <div className="public-card workspace-side-card workspace-team-card">
              <div className="workspace-side-card-head">
                <h3>团队空间</h3>
                {organization
                  ? <span className="workspace-status">{teamRole === 'owner' ? '团队所有者' : teamRole === 'admin' ? '团队管理员' : '团队成员'}</span>
                  : <span className="workspace-status muted team-required-tag" title={canManageTeam ? '当前权益可以创建团队空间。' : '该功能需要升级团队版权限才可解锁。'}>{canManageTeam ? '可创建' : '需团队版'}</span>}
              </div>

              <div className="workspace-side-card-body">
              {!organization ? (
                hasTeamPlan ? <form className="workspace-inline-form" onSubmit={createTeam}><input value={teamName} onChange={(event) => setTeamName(limitInputText(event.target.value, TEAM_NAME_MAX))} maxLength={TEAM_NAME_MAX} title={`团队名称最多 ${TEAM_NAME_MAX} 个字符`} placeholder="例如：鲲穹设计团队" /><button className="primary-button" disabled={saving || !teamName.trim()}><Building2 size={15} /> 创建团队</button></form> : <div className="workspace-upgrade-notice"><Sparkles size={18} /><div><strong>团队空间属于团队版/企业版权益</strong><span>升级至团队版/企业版后，即可创建团队、邀请成员，生成企业专属分享链接。</span></div></div>
              ) : (
                <>
                  <div className="team-mini">
                    <span className="team-logo"><Building2 size={18} /></span>
                    <div className="workspace-team-mini-copy">
                      {organization.ownerUserId === user.id && editingTeamName ? (
                        <form className="workspace-name-form" onSubmit={saveWorkspaceName}>
                          <input value={workspaceName} onChange={(event) => setWorkspaceName(limitInputText(event.target.value, TEAM_NAME_MAX))} maxLength={TEAM_NAME_MAX} title={`团队名称最多 ${TEAM_NAME_MAX} 个字符`} autoFocus aria-label="团队名称" />
                          <button type="submit" className="ghost-icon" disabled={saving || !workspaceName.trim()} aria-label="保存团队名称" title="保存团队名称"><Check size={16} /></button>
                          <button type="button" className="ghost-icon" disabled={saving} onClick={() => { setWorkspaceName(organization.name); setEditingTeamName(false) }} aria-label="取消编辑团队名称" title="取消编辑"><X size={16} /></button>
                        </form>
                      ) : (
                        <div className="workspace-name-line">
                          <b>{organization.name}</b>
                          {organization.ownerUserId === user.id && canManageTeam && <button type="button" className="ghost-icon" onClick={() => setEditingTeamName(true)} aria-label="编辑团队名称" title="编辑团队名称"><PencilLine size={14} /></button>}
                        </div>
                      )}
                      <small>{ownerMember ? `所有者 ${ownerMember.displayName || ownerMember.email || '当前账号'}` : '团队共享空间'}{organization.createdAt ? ` · 创建于 ${new Date(organization.createdAt).toISOString().slice(0, 10)}` : ''}</small>
                    </div>
                  </div>

                  <div className="cap-row">
                    <span>{teamUsage ? <>团队已用 <b>{formatBytes(teamUsedBytes)}</b> / {formatBytes(teamSpaceBytes)}</> : <>成员 <b>{activeMembers.length}</b> 人 · 团队容量 {teamSpaceBytes ? formatBytes(teamSpaceBytes) : '未开通'}</>}</span>
                    <span className="pct">{teamUsage ? `${teamUsedRatio}%` : pendingMemberCount ? `${pendingMemberCount} 位待加入` : ''}</span>
                  </div>
                  {teamUsage && <div className="progress sm" role="progressbar" aria-label="团队空间使用率" aria-valuenow={teamUsedRatio} aria-valuemin="0" aria-valuemax="100"><i style={{ width: `${teamUsedRatio}%` }} /></div>}

                  {!canUseTeamSpace && <div className="workspace-upgrade-notice"><Sparkles size={18} /><div><strong>当前权益已关闭团队协作</strong><span>恢复团队版或企业版权益后，可以继续邀请和管理成员。</span></div></div>}

                  {canManageTeam ? (
                    <div className="workspace-invite-mini">
                      <span className="workspace-block-label"><Link2 size={13} /> 邀请链接</span>
                      <div className="workspace-invite-link-row">
                        <code title={enterpriseInviteLink}>{enterpriseInviteLink}</code>
                        <button type="button" className="copy-button" onClick={copyEnterpriseLink}><Copy size={13} /> 复制</button>
                      </div>
                    </div>
                  ) : (
                    <div className="workspace-invite-notice" role="note"><Link2 size={14} /><span>邀请链接由团队所有者或管理员管理。</span></div>
                  )}

                  <div className="side-foot">
                    <div className="team-avatars" aria-hidden="true">
                      {activeMembers.slice(0, 4).map((member) => <span className="avatar sm" key={member.id}>{(member.displayName || '团').slice(0, 1)}</span>)}
                      {activeMembers.length > 4 && <span className="avatar sm more">+{activeMembers.length - 4}</span>}
                    </div>
                    {canUseTeamSpace
                      ? <button type="button" className="team-manage-link" title="查看团队成员、入团申请和使用情况" onClick={() => { window.location.href = '/team' }}>团队管理 <ChevronRight size={13} /></button>
                      : <button type="button" className="team-manage-link" onClick={() => setUpgradeOpen(true)}>购买团队套餐 <ChevronRight size={13} /></button>}
                  </div>
                </>
              )}
              </div>
            </div>

            <div className="public-card workspace-side-card workspace-storage-card">
              <div className="workspace-side-card-head"><h3>存储用量</h3><a className="text-btn" href="/settings/cleanup">清理空间 <ChevronRight size={13} /></a></div>
              <div className="workspace-side-card-body">
              <div className="usage-total"><b>{formatBytes(capacity.usedBytes || 0)}</b><span>/ {formatBytes(currentTotalBytes)}</span><em>{ratio > 0 && ratio < 1 ? '<1%' : `${ratio}%`}</em></div>
              <div className="usage-bar" role="progressbar" aria-label="个人空间使用率" aria-valuenow={ratio} aria-valuemin="0" aria-valuemax="100">
                <i style={{ width: `${shareRatio}%`, background: '#1f6bff' }} />
                <i style={{ width: `${collectionRatio}%`, background: '#4f95ff' }} />
              </div>
              <div className="usage-legend">
                <span><i style={{ background: '#1f6bff' }} />分享文件<b>{formatBytes(shareBytes)}</b></span>
                <span><i style={{ background: '#4f95ff' }} />收集任务<b>{formatBytes(collectionBytes)}</b></span>
                <span><i style={{ background: '#8fc0ff' }} />文件数量<b>{capacity.fileCount || 0} 个</b></span>
                <span><i style={{ background: '#c3d8f8' }} />剩余可用<b>{formatBytes(capacity.remainingBytes || 0)}</b></span>
              </div>
              </div>
            </div>
          </aside>
        </div>
      </section>
      {upgradeOpen && <UpgradeModal workspace={workspace} initialPlanId={selectedPlan.id} onClose={() => setUpgradeOpen(false)} onRefresh={load} onNotify={(text, tone) => { if (tone === 'error') setError(text); else setMessage(text) }} />}
    </PublicShell>
  )
}

function PlanCatalogPage({ plans, currentPlan, selectedPlanId, isSelectablePlan, onBack, onUpgrade }) {
  const sortedPlans = [...plans].sort((a, b) => accountPlanRank(a.id) - accountPlanRank(b.id))
  const comparisonRows = [
    ['个人空间', (plan) => formatBytes(plan.totalBytes)],
    ['团队空间', (plan) => plan.teamSpaceBytes ? formatBytes(plan.teamSpaceBytes) : '—'],
    ['单文件上限', (plan) => formatBytes(plan.singleFileLimitBytes)],
    ['收集参与人数', (plan) => plan.collectionParticipantLimit ? `${plan.collectionParticipantLimit} 人` : '不限'],
    ['进行中的收集任务', (plan) => plan.activeCollectionLimit ? `${plan.activeCollectionLimit} 个` : '不限'],
    ['权益有效期', (plan) => plan.id === 'free' ? '长期免费' : plan.permanent ? '永久' : plan.validityDays ? `${plan.validityDays} 天` : '按套餐配置'],
  ]

  return <section className="plan-catalog-page">
    <div className="plan-catalog-heading">
      <div>
        <div className="plan-catalog-breadcrumb"><a href="/">首页</a><span>/</span><a href="/workspace">会员与团队</a><span>/</span><strong>套餐</strong></div>
        <h1>选择适合你的套餐</h1>
        <p>套餐权益与价格以当前账号可购买配置为准，选择后通过现有订单流程完成升级。</p>
      </div>
      <button type="button" className="secondary-button" onClick={onBack}><ArrowLeft size={15} /> 返回会员空间</button>
    </div>

    <div className="plan-catalog-grid">
      {sortedPlans.map((item) => {
        const selectable = isSelectablePlan(item)
        const isCurrent = item.id === currentPlan.id
        const Icon = accountPlanIcon(item.id)
        return <article className={`plan-catalog-card${item.id === 'member' ? ' featured' : ''}${selectedPlanId === item.id ? ' selected' : ''}${isCurrent ? ' current' : ''}`} key={item.id}>
          {item.id === 'member' && <span className="plan-catalog-flag">个人常用</span>}
          <div className="plan-catalog-card-heading">
            <span className="plan-catalog-icon"><Icon size={18} /></span>
            <div><h2>{item.label}</h2><p>{item.tagline || '按当前套餐配置提供权益'}</p></div>
          </div>
          <div className="plan-catalog-price"><strong>{item.id === 'free' || Number(item.monthlyPrice) === 0 ? '¥0' : Number.isFinite(Number(item.monthlyPrice)) ? `¥${(Number(item.monthlyPrice) / 100).toFixed(2)}` : '价格以主站为准'}</strong><span>{item.id === 'free' ? '/ 长期' : item.permanent ? '/ 永久' : item.validityDays ? `/ ${item.validityDays} 天` : ''}</span></div>
          <p className="plan-catalog-price-note">{formatPlanPrice(item)}</p>
          <PlanSpaceSummary plan={item} compact />
          <ul className="plan-catalog-features">
            {(item.features || []).map((feature) => <li key={feature}><Check size={14} /> <span>{feature}</span></li>)}
          </ul>
          <button type="button" className={selectable ? 'primary-button' : 'secondary-button'} disabled={!selectable} aria-pressed={selectedPlanId === item.id} onClick={() => selectable && onUpgrade(item.id)}>
            {isCurrent ? '当前套餐' : selectable ? (selectedPlanId === item.id ? '立即升级' : '选择并升级') : '已包含'}
          </button>
        </article>
      })}
    </div>

    <section className="plan-catalog-comparison public-card" aria-labelledby="plan-comparison-title">
      <div className="plan-catalog-section-heading"><div><p className="eyebrow">套餐权益</p><h2 id="plan-comparison-title">权益对比</h2></div><span>配置随账号和服务端规则更新</span></div>
      <div className="plan-catalog-table-wrap"><table><thead><tr><th scope="col">权益</th>{sortedPlans.map((item) => <th className={item.id === currentPlan.id ? 'current' : ''} scope="col" key={item.id}>{item.label}{item.id === currentPlan.id ? <small>当前</small> : null}</th>)}</tr></thead>
        <tbody>{comparisonRows.map(([label, value]) => <tr key={label}><th scope="row">{label}</th>{sortedPlans.map((item) => <td className={item.id === currentPlan.id ? 'current' : ''} key={item.id}>{value(item)}</td>)}</tr>)}
          <tr><th scope="row">文件保存</th>{sortedPlans.map((item) => <td className={item.id === currentPlan.id ? 'current' : ''} key={item.id}>{item.permanent ? '永久保存' : '按文件期限'}</td>)}</tr>
          <tr><th scope="row">团队协作</th>{sortedPlans.map((item) => <td className={item.id === currentPlan.id ? 'current' : ''} key={item.id}>{item.team ? '支持' : '—'}</td>)}</tr>
        </tbody>
      </table></div>
    </section>

    <section className="plan-catalog-faq" aria-labelledby="plan-faq-title">
      <div className="plan-catalog-section-heading"><div><p className="eyebrow">帮助</p><h2 id="plan-faq-title">常见问题</h2></div></div>
      <div className="plan-catalog-faq-grid">
        <article><h3>升级后权益何时生效？</h3><p>支付通道确认成功后，系统会同步套餐权益；也可以在会员空间查看最新状态。</p></article>
        <article><h3>套餐价格和期限如何确定？</h3><p>价格从现有套餐服务读取，权益期限按当前服务端套餐配置执行。</p></article>
        <article><h3>个人空间和团队空间如何计算？</h3><p>个人用量与团队共享用量分别统计，加入团队不会改变个人套餐。</p></article>
        <article><h3>支付中的订单在哪里查看？</h3><p>待支付订单可从会员空间继续查看，并使用原有支付状态核对流程。</p></article>
      </div>
    </section>
  </section>
}

export const accountPlanRank = (planId) => ACCOUNT_PLAN_RANK[planId] ?? 0

export const accountPlanIcon = (planId) => ACCOUNT_PLAN_ICON[planId] || HardDrive

export function UpgradeModal({ workspace, initialPlanId = '', initialOrder = null, onClose, onRefresh, onNotify, requireCancelConfirmation = false }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [])

  const plan = workspace?.plan || {}
  const accountPlans = (workspace?.plans || []).filter(item => !item.retired)
  const teamEntitlement = workspace?.teamEntitlement || {}
  const localPlans = accountPlans.filter((item) => item.id !== 'free')
  const freePlan = accountPlans.find((item) => item.id === 'free') || (plan.id === 'free' ? plan : null)
  const pendingOrder = (workspace?.orders || []).find((order) => order.status === 'pending_payment') || null
  const currentPlanRank = accountPlanRank(plan.id)
  const hasPlanCatalog = localPlans.length > 0
  const highestTeamPlan = localPlans.filter((item) => item.team).reduce((highest, item) => !highest || accountPlanRank(item.id) > accountPlanRank(highest.id) ? item : highest, null)
  const hasMaximumTeamEntitlement = Boolean(teamEntitlement.organizationId && teamEntitlement.teamPlanId && highestTeamPlan && accountPlanRank(teamEntitlement.teamPlanId) >= accountPlanRank(highestTeamPlan.id))
  const isUpgradePlan = (item) => accountPlanRank(item.id) > currentPlanRank
  const defaultPlanId = localPlans.find(isUpgradePlan)?.id || ''
  const canCreateOrder = hasPlanCatalog ? Boolean(defaultPlanId) : plan.id !== 'year'
  const hasMaximumPersonalEntitlement = hasPlanCatalog && !localPlans.some(item => accountPlanRank(item.id) > currentPlanRank)
  const preferredPlanId = localPlans.find((item) => item.id === initialPlanId && isUpgradePlan(item))?.id || ''
  const [selectedPlanId, setSelectedPlanId] = useState(preferredPlanId || defaultPlanId)
  const [storedOrder, setOrderView] = useState(initialOrder || pendingOrder)
  const [now, setNow] = useState(Date.now)
  const orderView = paymentOrderView(storedOrder, now)
  const orderPurchaseBlocked = Boolean(orderView && (orderView.canPurchase === false || !isUpgradePlan({ id: orderView.planId })))
  const canPurchaseOrder = Boolean(orderView && !orderView.retired && !orderPurchaseBlocked)
  const orderPurchaseBlockedReason = orderView?.purchaseBlockedReason || '套餐有效期内仅可升级至更高档套餐，不能购买同档或更低档套餐'
  const remainingSeconds = Math.max(0, Math.ceil((paymentDeadline(orderView) - now) / 1000))
  const countdown = `${String(Math.floor(remainingSeconds / 60)).padStart(2, '0')}:${String(remainingSeconds % 60).padStart(2, '0')}`
  const currentOrderId = useRef(orderView?.id)
  currentOrderId.current = orderView?.id
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [cancelConfirmation, setCancelConfirmation] = useState(false)
  const [payType, setPayType] = useState(initialOrder?.payType || pendingOrder?.payType || 1)
  const [payment, setPayment] = useState(initialOrder?.payment || pendingOrder?.payment || null)
  const attemptedPaymentOrder = useRef(null)
  const paymentRequestRunning = useRef(false)
  // 远端主站套餐实价：与订单创建/支付同源，避免「展示价 ≠ 下单应付金额」
  const remotePricing = useRemotePlanPricing(Boolean(defaultPlanId))
  const plans = localPlans.map((item) => mergePlanPricing(item, remotePricing))
  const comparisonPlans = [...(freePlan ? [mergePlanPricing(freePlan, remotePricing)] : []), ...plans]
  const priceAvailable = (id) => Boolean(remotePricing?.[id] && remotePricing[id].available !== false && !remotePricing.error)
  const pricingError = canCreateOrder && defaultPlanId
    ? remotePricing?.error || (remotePricing && selectedPlanId && !priceAvailable(selectedPlanId) ? '套餐暂不可用，请稍后重试' : '')
    : ''

  useEffect(() => {
    if (!localPlans.some(item => item.id === selectedPlanId && isUpgradePlan(item))) setSelectedPlanId(defaultPlanId)
  }, [selectedPlanId, defaultPlanId, currentPlanRank])
  useEffect(() => {
    if (pendingOrder) setOrderView(current => {
      if (current && current.id !== pendingOrder.id) return current
      if (current?.status === 'paid') return current
      return pendingOrder
    })
  }, [pendingOrder])
  useEffect(() => {
    if (orderView?.status !== 'pending_payment' || !orderView?.payment) return
    setPayment(orderView.payment)
    if (orderView.payType) setPayType(orderView.payType)
  }, [orderView?.id, orderView?.payment, orderView?.payType])
  useEffect(() => {
    if (storedOrder?.status !== 'pending_payment') return undefined
    const update = () => setNow(Date.now())
    update()
    const timer = window.setInterval(update, 1000)
    window.addEventListener('focus', update)
    document.addEventListener('visibilitychange', update)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update) }
  }, [storedOrder?.id, storedOrder?.status])
  useEffect(() => {
    if (!orderView?.remoteOrderNo || !['pending_payment', 'expired'].includes(orderView.status)) return undefined
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
  }, [orderView?.remoteOrderNo, orderView?.id, orderView?.status])

  const selectedPlan = plans.find((item) => item.id === selectedPlanId && isUpgradePlan(item)) || null
  const isCurrentPlan = (item) => item.id === plan.id
  const isIncludedPlan = (item) => accountPlanRank(item.id) <= currentPlanRank

  const createOrder = async (replacementPlanId = null) => {
    const isReplacement = typeof replacementPlanId === 'string'
    const planId = isReplacement ? replacementPlanId : selectedPlan?.id
    if (!canCreateOrder || !planId || !isUpgradePlan({ id: planId }) || (isReplacement && !canPurchaseOrder) || busy || (!isReplacement && !priceAvailable(planId))) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await upgradeApiRequest('/api/account/upgrade-orders', { method: 'POST', body: JSON.stringify({ planId }) })
      setOrderView(result.order)
      setPayment(null)
      setNow(Date.now())
      onRefresh?.({ silent: true })
      onNotify?.('升级订单已创建', 'success')
    } catch (err) {
      if (err.order) {
        setOrderView(err.order)
        setPayment(err.order.payment || null)
        setNow(Date.now())
        onRefresh?.({ silent: true })
      } else {
        setError(err.message || '升级订单创建失败')
      }
    } finally {
      setBusy(false)
    }
  }

  const loadPayment = async () => {
    if (!canPurchaseOrder || paymentOrderView(orderView)?.status !== 'pending_payment' || busy || paymentRequestRunning.current) return
    paymentRequestRunning.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await upgradeApiRequest(`/api/account/upgrade-orders/${encodeURIComponent(orderView.id)}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ payType }),
      })
      if (currentOrderId.current !== orderView.id) return
      if (paymentOrderView(result.order)?.status !== 'pending_payment') {
        setOrderView(paymentOrderView(result.order)); setPayment(null); setNow(Date.now())
        return
      }
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
      if (err.order) { setOrderView(err.order); setPayment(null); setNow(Date.now()); onRefresh?.({ silent: true }) }
      setError(err.message || '支付订单创建失败')
    } finally {
      paymentRequestRunning.current = false
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!orderView) { attemptedPaymentOrder.current = null; return }
    if (!canPurchaseOrder || orderView.status !== 'pending_payment' || payment || busy || attemptedPaymentOrder.current === orderView.id) return
    attemptedPaymentOrder.current = orderView.id
    loadPayment()
  }, [orderView?.id, orderView?.status, canPurchaseOrder, payment, busy])

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

  return createPortal(
    <div className="modal-backdrop upgrade-backdrop" onMouseDown={onClose}>
      <div className={`modal upgrade-modal${orderView ? '' : ' upgrade-modal-compare'}`} role="dialog" aria-modal="true" aria-labelledby="upgrade-modal-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div><p className="eyebrow">会员与企业版</p><h2 id="upgrade-modal-title">{orderView ? (orderView.status === 'paid' ? '支付成功' : '升级订单') : '升级权益'}</h2></div>
          <button className="ghost-icon modal-close" aria-label="关闭升级窗口" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body upgrade-modal-body">
          {error && <FeedbackMessage message={error} tone="error" />}
          {!orderView && pricingError && <FeedbackMessage message={pricingError} tone="error" />}
          {!orderView && defaultPlanId && !remotePricing && <p role="status">正在加载套餐价格…</p>}
          {orderView ? (orderView.status === 'paid' ? (
            <div className="upgrade-success-view" role="status">
              <span className="upgrade-success-icon"><BadgeCheck size={34} /></span>
              <h3>{orderView.planLabel}权益已开通</h3>
              <p>{(orderView.permanent ?? (orderView.planId === 'enterprise' && !orderView.remoteExpireAt)) ? '文件永久保存，感谢支持' : '文件保存有效期已自动顺延，立即生效'}</p>
              <dl className="upgrade-order-meta">
                <div><dt>支付金额</dt><dd><strong className="upgrade-success-amount">{Number.isFinite(Number(orderView.amount)) ? `¥${(Number(orderView.amount) / 100).toFixed(2)}` : '—'}</strong></dd></div>
                <div><dt>有效期至</dt><dd>{(orderView.permanent ?? (orderView.planId === 'enterprise' && !orderView.remoteExpireAt)) ? '永久有效' : orderView.remoteExpireAt ? formatDate(orderView.remoteExpireAt) : '以主站权益为准'}</dd></div>
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
                {Object.hasOwn(orderView, 'entitlementDays') && <div><dt>权益期限</dt><dd>{orderView.entitlementDays === null ? '永久有效' : `${orderView.entitlementDays} 天`}</dd></div>}
                <div><dt>应付金额</dt><dd>{Number.isFinite(Number(orderView.amount)) ? `¥${(Number(orderView.amount) / 100).toFixed(2)}` : '价格以支付通道为准'}</dd></div>
              </dl>
              {orderView.retired && <p className="upgrade-order-note" role="status">该套餐已下架，不能继续支付或重新下单。已购权益保留；如已付款，可核对原单支付状态。</p>}
              {canPurchaseOrder && <>
              {orderView.status === 'pending_payment' && !payment && paymentMethodSelector}
              {orderView.status === 'pending_payment' && !payment && (busy || !error) && <div className="upgrade-payment-qr" role="status"><span className="loading-dot" /><span>{payType === 2 ? '正在加载支付宝收银台…' : '正在加载微信支付二维码…'}</span></div>}
              {orderView.status === 'pending_payment' && <div className={`upgrade-payment-countdown ${remainingSeconds <= 60 ? 'is-urgent' : ''}`}><Clock3 size={15} /><span>支付剩余时间 <strong role="timer" aria-label="支付剩余时间">{countdown}</strong><small>订单创建后 15 分钟内有效，超时需重新创建订单</small></span></div>}
              {orderView.status === 'pending_payment' && payment?.qrcode_img_url && <div className="upgrade-payment-qr"><img src={payment.qrcode_img_url} alt="微信支付二维码" /><span>请使用微信扫码支付</span></div>}
              {orderView.status === 'pending_payment' && payment?.alipaysubmit_html && <div className="upgrade-payment-qr upgrade-payment-alipay"><div className="upgrade-payment-alipay-frame"><iframe title="支付宝收银台" scrolling="no" sandbox="allow-scripts allow-forms allow-popups allow-top-navigation-by-user-activation" referrerPolicy="no-referrer" srcDoc={payment.alipaysubmit_html} /></div><span>请使用支付宝扫码支付</span></div>}
              </>}
              <div className="upgrade-order-note" role="status"><Clock3 size={15} /><span>{orderView.retired ? '请选择当前在售套餐，或查看已购权益。' : orderPurchaseBlocked ? `${orderPurchaseBlockedReason}。如已付款，可核对原单支付状态。` : orderView.status === 'expired' ? '支付已超时，请重新创建订单支付；如已付款，可核对原单支付状态。' : notice || '支付成功后会员权益会自动开通。'}</span></div>
              {orderView.status === 'pending_payment' ? (
                <div className="upgrade-order-actions">
                  {canPurchaseOrder && !payment && error && <button className="primary-button" onClick={loadPayment} disabled={busy}><RefreshCw size={15} /> {busy ? '正在加载…' : '重新加载支付码'}</button>}
                  {(payment || orderView.remoteOrderNo) && <button className="secondary-button" onClick={checkPayStatus} disabled={busy}><RefreshCw size={15} /> 刷新支付状态</button>}
                  <button className="secondary-button" onClick={() => requireCancelConfirmation ? setCancelConfirmation(true) : cancelOrder()} disabled={busy}><X size={15} /> 取消订单</button>
                </div>
              ) : (
                <div className="upgrade-order-actions">
                  {orderView.status === 'expired' && !orderView.retired ? <>
                    {canCreateOrder && canPurchaseOrder && <button className="primary-button" onClick={() => createOrder(orderView.planId)} disabled={busy}><RotateCcw size={15} /> {busy ? '正在创建…' : '重新创建订单'}</button>}
                    {orderPurchaseBlocked && <button className="secondary-button" onClick={() => { setOrderView(null); setPayment(null); setError('') }}><RotateCcw size={15} /> 重新选择套餐</button>}
                    {orderView.remoteOrderNo && <button className="secondary-button" onClick={checkPayStatus} disabled={busy}><RefreshCw size={15} /> 核对支付状态</button>}
                  </> : <button className="primary-button" onClick={() => { setOrderView(null); setPayment(null); onRefresh?.({ silent: true }) }}><RotateCcw size={15} /> 重新选择套餐</button>}
                </div>
              )}
            </div>
          )) : (
            <>
              <p className="upgrade-intro">当前个人套餐：<strong>{plan.label || '基础版'}</strong>。价格由主站提供，权益有效期以本站套餐配置为准{canCreateOrder ? '；创建订单时会确认金额和期限。' : '。'}</p>
              <PlanCarousel className="upgrade-plan-grid">
                {comparisonPlans.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={`upgrade-plan-card ${item.id === selectedPlanId ? 'selected' : ''} ${item.id === 'free' || isIncludedPlan(item) ? 'is-current' : ''}`}
                    onClick={() => canCreateOrder && item.id !== 'free' && !isIncludedPlan(item) && setSelectedPlanId(item.id)}
                    disabled={!canCreateOrder || item.id === 'free' || isIncludedPlan(item) || !priceAvailable(item.id)}
                    aria-pressed={item.id === selectedPlanId}
                  >
                    <span className="upgrade-plan-top">{(() => { const PlanIcon = accountPlanIcon(item.id); return <span className="upgrade-plan-icon"><PlanIcon size={16} /></span> })()}<strong>{item.label}</strong>{isCurrentPlan(item) ? <em>当前权益</em> : isIncludedPlan(item) ? <em>已包含</em> : item.team && teamEntitlement.teamPlanId && accountPlanRank(item.id) <= accountPlanRank(teamEntitlement.teamPlanId) ? <em>团队已拥有</em> : item.team ? <em className="hot">团队推荐</em> : null}</span>
                    <PlanSpaceSummary plan={item} compact />
                    <span className="upgrade-plan-tags"><strong className="upgrade-plan-price">{formatPlanPrice(item)}</strong><span className="upgrade-plan-detail">{item.permanent ? '永久保存' : '临时保存'}{item.team ? ' · 团队协作' : ''}</span></span>
                    <ul className="upgrade-plan-features">
                      {(item.features || []).map((feature) => <li key={feature}><Check size={12} /> {feature}</li>)}
                    </ul>
                  </button>
                ))}
              </PlanCarousel>
              {hasMaximumPersonalEntitlement && <div className="upgrade-maximum-notice" role="status"><BadgeCheck size={20} /><div><strong>你已拥有当前最高等级权益，无需继续升级。</strong></div></div>}
              {canCreateOrder && selectedPlan && paymentMethodSelector}
              {canCreateOrder && selectedPlan && (
                <div className="upgrade-summary">
                  <span><Sparkles size={14} /> {plan.label || '基础版'} → <strong>{selectedPlan.label}</strong>：{selectedPlan.tagline}</span>
                  <button className="primary-button" onClick={createOrder} disabled={busy || !priceAvailable(selectedPlan.id)}><Zap size={15} /> {busy ? '正在创建…' : '创建升级订单'}</button>
                </div>
              )}
              {canCreateOrder && <p className="upgrade-hint">套餐有效期内仅可升级至更高档套餐，到期后可重新购买。支付成功后权益自动生效。</p>}
            </>
          )}
        </div>
      </div>
      {cancelConfirmation && <div onMouseDown={event => event.stopPropagation()}><ConfirmModal state={{ title: '确认取消订单？', detail: '取消后此订单将无法继续支付。', cancelText: '暂不取消', confirmText: '确认取消', tone: 'danger' }} onCancel={() => setCancelConfirmation(false)} onConfirm={() => { setCancelConfirmation(false); cancelOrder() }} /></div>}
    </div>, document.body
  )
}
