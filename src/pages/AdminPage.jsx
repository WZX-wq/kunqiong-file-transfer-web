// 后台管理页面（由 main.jsx 抽取）
// AdminPage 子树：管理登录 + 概览 + 资源/用户/配置/日志。
// 只被 App 引用，构成完整独立功能域。

import React, { useEffect, useRef, useState } from 'react'
import { BarChart3, Check, ChevronLeft, ChevronRight, Copy, Database, Eye, ExternalLink, HardDrive, Inbox, KeyRound, Link2, LockKeyhole, LogOut, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Trash2, UserRound, Users, X, XCircle } from 'lucide-react'
import { useConfirmDialog } from '../hooks.js'
import { apiRequest, copyTextToClipboard } from '../lib/api.js'
import { ConfirmModal, ProductBrand } from '../components/common.jsx'
import { formatBytes, formatDate } from '../lib/format.js'
import { limitInputText } from '../lib/input-limits.js'

const ADMIN_TABS = new Set(['dashboard', 'resources', 'users', 'security', 'config'])

function readAdminTab(search) {
  const tab = new URLSearchParams(search).get('tab')
  return ADMIN_TABS.has(tab) ? tab : 'dashboard'
}

function writeAdminTab(tab, replace = false) {
  const url = new URL(window.location.href)
  if (tab === 'dashboard') url.searchParams.delete('tab')
  else url.searchParams.set('tab', tab)
  window.history[replace ? 'replaceState' : 'pushState'](null, '', `${url.pathname}${url.search}${url.hash}`)
}

export function AdminLoginModal({ onSubmit, busy = false, error = '', onBackHome }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const submit = (event) => {
    event.preventDefault()
    if (busy || !username.trim() || !password) return
    onSubmit({ username: username.trim(), password })
  }

  return (
    <main className="admin-login-backdrop admin-login">
      <aside className="admin-login-story">
        <div className="admin-login-brand">运营控制台 <span>内部管理</span></div>
        <div className="admin-login-copy"><span className="eyebrow">OPERATIONS CONSOLE</span><h1>统一查看用户、资源<br />与系统运行状态</h1><p>安全地管理文件资源、账号权益与运行配置，让每一次传输都有迹可循。</p><ul><li><ShieldCheck size={16} /> 独立管理员会话</li><li><Database size={16} /> 资源与用户管理</li><li><SlidersHorizontal size={16} /> 配置与安全日志</li></ul></div>
        <p className="admin-login-story-foot">文件传输 · 运营管理</p>
      </aside>
      <div className="admin-login-form-side">
      <form className="modal confirm-modal admin-login-modal" role="dialog" aria-modal="true" aria-labelledby="admin-login-title" onSubmit={submit}>
        <div className="admin-login-icon"><ShieldCheck size={22} /></div>
        <p className="eyebrow">运营后台</p>
        <h2 id="admin-login-title">管理员登录</h2>
        <p>请输入后台管理员账号与密码，验证通过后可进入系统管理。</p>
        <div className="admin-login-fields">
          <label className="admin-login-field">
            <span><UserRound size={14} /> 账号</span>
            <input
              maxLength={120}
              value={username}
              onChange={(event) => setUsername(limitInputText(event.target.value, 120))}
              placeholder="请输入管理员账号"
              autoComplete="username"
              autoFocus
              disabled={busy}
            />
          </label>
          <label className="admin-login-field">
            <span><LockKeyhole size={14} /> 密码</span>
            <div className="admin-login-password">
              <input
                maxLength={128}
                value={password}
                onChange={(event) => setPassword(limitInputText(event.target.value, 128))}
                type={showPassword ? 'text' : 'password'}
                placeholder="请输入管理员密码"
                autoComplete="current-password"
                disabled={busy}
              />
              <button type="button" className="ghost-icon" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? '隐藏密码' : '显示密码'} title={showPassword ? '隐藏密码' : '显示密码'}>
                <Eye size={15} />
              </button>
            </div>
          </label>
        </div>
        {error && <p className="admin-login-error" role="alert"><XCircle size={14} /> {error}</p>}
        <div className="modal-footer confirm-modal-footer admin-login-footer">
          <button type="button" className="secondary-button" onClick={onBackHome}><ChevronLeft size={15} /> 返回首页</button>
          <button type="submit" className="primary-button" disabled={busy || !username.trim() || !password}>
            {busy ? <><span className="button-spinner" /> 正在验证…</> : <><KeyRound size={15} /> 登录后台</>}
          </button>
        </div>
      </form>
      </div>
    </main>
  )
}

function AdminTopbar({ username }) {
  return <header className="admin-top">
    <ProductBrand href="/admin" className="admin-top-brand" />
    <span className="admin-session-badge">管理员会话</span>
    <div className="admin-top-right">
      {username && <span>{username}</span>}
      <a href="/"><ExternalLink size={14} /> 返回前台</a>
    </div>
  </header>
}

export function AdminPage() {
  const requestGeneration = useRef(0)
  const requestInFlight = useRef(null)
  const overviewLoaded = useRef(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState(() => readAdminTab(window.location.search))
  const [savingConfig, setSavingConfig] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [adminInfo, setAdminInfo] = useState(null)
  const [loginBusy, setLoginBusy] = useState(false)
  const [loginError, setLoginError] = useState('')
  const [notice, setNotice] = useState(null)
  const { confirmState, requestConfirm, settleConfirm } = useConfirmDialog()

  const changeTab = (nextTab) => {
    if (!ADMIN_TABS.has(nextTab) || nextTab === tab) return
    setTab(nextTab)
    writeAdminTab(nextTab)
  }

  useEffect(() => {
    const syncTab = () => {
      const params = new URLSearchParams(window.location.search)
      const requestedTab = params.get('tab')
      const nextTab = readAdminTab(window.location.search)
      setTab(nextTab)
      if ((requestedTab && !ADMIN_TABS.has(requestedTab)) || (nextTab === 'dashboard' && requestedTab === 'dashboard')) {
        writeAdminTab(nextTab, true)
      }
    }
    window.addEventListener('popstate', syncTab)
    return () => window.removeEventListener('popstate', syncTab)
  }, [])

  // 与用户端一致的右下角 toast 提示
  const showToast = (message, tone = 'success') => setNotice({ message, tone })
  useEffect(() => {
    if (!notice) return undefined
    const timer = window.setTimeout(() => setNotice(null), 3000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const clearAdminSession = () => {
    overviewLoaded.current = false
    setAuthenticated(false)
    setAdminInfo(null)
    setData(null)
    setNotice(null)
    settleConfirm(false)
  }

  const load = async ({ sessionOnly = false } = {}) => {
    // focus、pageshow、visibilitychange 往往连续触发，共用一次校验。
    if (requestInFlight.current !== null) return
    const generation = ++requestGeneration.current
    requestInFlight.current = generation
    if (!sessionOnly) setLoading(true)
    setError('')
    try {
      const session = await apiRequest('/api/admin/session')
      if (generation !== requestGeneration.current) return
      if (!session.authenticated) {
        clearAdminSession()
        return
      }
      setAuthenticated(true)
      setAdminInfo(session.admin || null)
      // 恢复窗口只校验权限，保持列表、弹窗和未保存表单挂载。
      if (sessionOnly && overviewLoaded.current) return
      const overview = await apiRequest('/api/admin/overview')
      if (generation === requestGeneration.current) {
        overviewLoaded.current = true
        setData(overview)
      }
    } catch (err) {
      if (generation !== requestGeneration.current) return
      // 网络/服务异常不代表退出登录；明确失去权限时才清除后台数据。
      if (err.status === 401 || err.status === 403) clearAdminSession()
      setError(err.message || '后台数据加载失败')
    } finally {
      if (generation === requestGeneration.current) setLoading(false)
      if (requestInFlight.current === generation) requestInFlight.current = null
    }
  }
  useEffect(() => {
    const refresh = () => { if (document.visibilityState !== 'hidden') load({ sessionOnly: true }) }
    load()
    window.addEventListener('focus', refresh)
    window.addEventListener('pageshow', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      requestGeneration.current++
      requestInFlight.current = null
      window.removeEventListener('focus', refresh)
      window.removeEventListener('pageshow', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])

  const submitLogin = async ({ username, password }) => {
    const generation = ++requestGeneration.current
    requestInFlight.current = generation
    setLoading(false)
    setLoginBusy(true)
    setLoginError('')
    try {
      const result = await apiRequest('/api/admin/login', { method: 'POST', body: JSON.stringify({ username, password }) })
      if (generation !== requestGeneration.current) return
      overviewLoaded.current = Boolean(result.overview)
      setAuthenticated(true)
      setAdminInfo(result.admin || null)
      setData(result.overview || null)
      setError('')
    } catch (err) {
      if (generation === requestGeneration.current) setLoginError(err.message || '登录失败')
    } finally {
      if (generation === requestGeneration.current) setLoginBusy(false)
      if (requestInFlight.current === generation) requestInFlight.current = null
    }
  }

  const logoutAdmin = async () => {
    const generation = ++requestGeneration.current
    requestInFlight.current = generation
    setLoading(false)
    clearAdminSession()
    try {
      await apiRequest('/api/admin/logout', { method: 'POST' })
    } catch { /* 忽略退出异常，前端一律回到登录态 */ }
    finally { if (requestInFlight.current === generation) requestInFlight.current = null }
    if (generation !== requestGeneration.current) return
    setError('')
    setLoginError('')
  }
  const updateUser = async (user, patch) => {
    try {
      const result = await apiRequest(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: 'PATCH', body: JSON.stringify(patch) })
      setData((current) => ({ ...current, users: current.users.map((item) => item.id === user.id ? result.user : item) }))
      showToast(patch.status === 'disabled' ? `已禁用 ${user.nickname || user.username || user.id}，其登录会话已全部下线` : patch.status === 'active' ? `已启用 ${user.nickname || user.username || user.id}` : `已更新 ${user.nickname || user.username || user.id} 的套餐权益`)
    } catch (err) {
      showToast(err.message || '用户更新失败', 'error')
    }
  }
  const saveConfig = async (event) => {
    event.preventDefault()
    setSavingConfig(true)
    try {
      const form = new FormData(event.currentTarget)
      const planOverrides = {}
      ;(data.plans || []).filter(plan => !plan.retired).forEach(({ id: planId }) => {
        const previousOverride = data.config?.planOverrides?.[planId] || {}
        const override = Object.hasOwn(previousOverride, 'validityDays') ? { validityDays: previousOverride.validityDays } : {}
        for (const [field, suffix] of [['totalGb', 'gb'], ['teamGb', 'teamGb'], ['singleFileGb', 'singleFileGb'], ['collectionParticipantLimit', 'participants'], ['activeCollectionLimit', 'tasks']]) {
          const value = String(form.get(`plan-${planId}-${suffix}`) ?? '').trim()
          if (value !== '') override[field] = value
        }
        planOverrides[planId] = override
      })
      const result = await apiRequest('/api/admin/config', { method: 'PATCH', body: JSON.stringify({
        defaultShareDays: form.get('defaultShareDays'),
        maxShareDays: form.get('maxShareDays'),
        anonymousMaxFileSizeMb: form.get('anonymousMaxFileSizeMb'),
        anonymousTotalSizeMb: form.get('anonymousTotalSizeMb'),
        anonymousCollectionParticipantLimit: form.get('anonymousCollectionParticipantLimit'),
        anonymousActiveCollectionLimit: form.get('anonymousActiveCollectionLimit'),
        maxBatchFiles: form.get('maxBatchFiles'),
        auditLogRetentionDays: form.get('auditLogRetentionDays'),
        orphanGraceHours: form.get('orphanGraceHours'),
        maintenanceMode: form.get('maintenanceMode') === 'on',
        planOverrides,
      }) })
      setData((current) => ({ ...current, config: result.config, plans: result.plans || current.plans }))
      showToast('系统配置已保存，新配置立即生效')
    } catch (err) {
      showToast(err.message || '系统配置保存失败', 'error')
    } finally {
      setSavingConfig(false)
    }
  }
  const runCleanup = async () => {
    const confirmed = await requestConfirm({
      title: '执行存储清理',
      detail: '将永久删除所有已关闭/过期的分享与收集任务及其文件（团队空间资源与仍在有效期的资源不受影响），操作不可恢复。确定继续吗？',
      confirmText: '执行清理',
      tone: 'danger',
    })
    if (!confirmed) return
    try {
      const result = await apiRequest('/api/admin/cleanup', { method: 'POST' })
      setData(result.overview)
      const parts = []
      if (result.expiredShares) parts.push(`分享 ${result.expiredShares} 个`)
      if (result.expiredCollections) parts.push(`收集任务 ${result.expiredCollections} 个`)
      const orphanCount = (result.orphaned?.shares || 0) + (result.orphaned?.collections || 0)
      if (orphanCount) parts.push(`孤儿目录 ${orphanCount} 个`)
      if (result.removedAuditLogs) parts.push(`过期日志 ${result.removedAuditLogs} 条`)
      showToast(parts.length ? `清理完成：已删除 ${parts.join('、')}` : '清理完成：没有需要清理的资源')
    } catch (err) {
      showToast(err.message || '清理失败', 'error')
    }
  }
  if (loading) return <div className="admin-shell"><AdminTopbar /><main className="admin-page"><div className="admin-inner"><div className="admin-state-block"><span className="loading-dot" /><h1>正在打开后台</h1><p>正在检查管理员登录状态。</p></div></div></main></div>
  // 后台一律先过口令登录。此前这里会因鲲穹白名单账号已登录而直接放行，
  // 表现为「部分账号能直接进后台」—— 白名单通道已移除，访问 /admin 恒定弹登录框。
  if (!authenticated) return <AdminLoginModal onSubmit={submitLogin} busy={loginBusy} error={loginError || error} onBackHome={() => { window.location.href = '/' }} />
  if (error && !data) return <div className="admin-shell"><AdminTopbar username={adminInfo?.username} /><main className="admin-page"><div className="admin-inner"><div className="admin-state-block"><div className="settings-state-icon"><ShieldCheck size={24} /></div><h1>无法打开后台</h1><p>{error}</p><button className="primary-button" onClick={load}><RefreshCw size={16} /> 重新加载</button><button className="secondary-button" onClick={logoutAdmin}><LogOut size={15} /> 退出后台</button><a className="secondary-button" href="/">返回首页</a></div></div></main></div>
  if (!data) return null
  const stats = data.stats || {}
  const dashboardCards = [
    ['用户总数', stats.users || 0, Users],
    ['有效账号', stats.activeUsers || 0, UserRound],
    ['资源总数', (stats.shares || 0) + (stats.collections || 0), Database],
    ['占用空间', formatBytes(stats.totalBytes || 0), HardDrive],
  ]
  const trend = data.trend || []
  const trendMax = Math.max(1, ...trend.flatMap((item) => [item.activeUsers, item.uploads, item.downloads]))
  return (
    <div className="admin-shell">
      <AdminTopbar username={adminInfo?.username} />
      <nav className="admin-tabs" aria-label="后台模块">{[['dashboard', '数据看板', BarChart3], ['resources', '资源管理', Database], ['users', '用户管理', Users], ['security', '安全日志', ShieldCheck], ['config', '系统配置', SlidersHorizontal]].map(([key, label, Icon]) => <button type="button" className={tab === key ? 'active' : ''} aria-current={tab === key ? 'page' : undefined} key={key} onClick={() => changeTab(key)}><Icon size={16} /> {label}</button>)}</nav>
      <main className="admin-page">
        <div className="admin-inner">
        <div className="admin-heading"><div><p className="eyebrow">鲲穹运营后台</p><h1>系统管理</h1><p>统一查看用户、安全日志、运行配置和系统概览。</p></div><div className="admin-heading-actions">{adminInfo?.username && <span className="admin-identity" title={`当前登录管理员：${adminInfo.username}`}><ShieldCheck size={14} /> {adminInfo.username}</span>}<button className="secondary-button" onClick={runCleanup}><RefreshCw size={15} /> 执行清理</button><button className="secondary-button" onClick={load}><RefreshCw size={15} /> 刷新数据</button><button className="secondary-button" onClick={logoutAdmin}><LogOut size={15} /> 退出后台</button></div></div>
        {error && <p className="public-message">{error}</p>}
        <div className="admin-content">
          {tab === 'dashboard' && <><div className="admin-kpi-grid">{dashboardCards.map(([label, value, Icon]) => <div className="admin-kpi" key={label}><span><Icon size={17} /> {label}</span><strong>{value}</strong></div>)}</div><div className="admin-columns"><div className="public-card admin-panel"><div className="admin-panel-heading"><div><p className="eyebrow">近 7 天</p><h2>运营趋势</h2></div></div><div className="admin-trend-chart" role="img" aria-label="近 7 天活跃用户、上传和下载趋势"><div className="admin-chart-axis">{[trendMax, Math.round(trendMax * .67), Math.round(trendMax * .33), 0].map((value, index) => <span key={`${value}-${index}`}>{value}</span>)}</div><div className="admin-chart-plot">{trend.map((item) => <div className="admin-chart-day" key={item.date} title={`${item.label} · 活跃用户 ${item.activeUsers} · 上传 ${item.uploads} · 下载 ${item.downloads}`}><div className="admin-chart-bars"><i className="active" style={{ height: `${(item.activeUsers / trendMax) * 100}%` }} /><i className="upload" style={{ height: `${(item.uploads / trendMax) * 100}%` }} /><i className="download" style={{ height: `${(item.downloads / trendMax) * 100}%` }} /></div><span>{item.label}</span></div>)}</div></div><small className="admin-trend-legend"><span><i />活跃用户</span><span><i className="upload" />上传</span><span><i className="download" />下载</span></small></div><div className="public-card admin-panel"><div className="admin-panel-heading"><div><p className="eyebrow">资源状态</p><h2>运营概览</h2></div></div><div className="admin-status-list"><span><i className="status-dot active" /> 活跃资源 <strong>{stats.activeResources || 0}</strong></span><span><i className="status-dot muted" /> 已禁用用户 <strong>{Math.max(0, (stats.users || 0) - (stats.activeUsers || 0))}</strong></span><span><i className="status-dot review" /> 团队空间 <strong>{stats.activeOrganizations || 0}</strong></span></div><div className="admin-log-list">{(data.auditLogs || []).slice(0, 4).map((item) => <div key={item.id}><span>{item.action}</span><small>{formatDate(item.createdAt)} · {item.status || '-'}</small></div>)}</div></div></div></>}
          {tab === 'resources' && <AdminResources resources={data.resources} total={data.totals?.resources ?? data.resources.length} requestConfirm={requestConfirm} onChanged={(message, tone, overview) => { if (overview) { setData((current) => ({ ...current, ...overview })) } else { load() } if (message) showToast(message, tone) }} />}
          {tab === 'users' && <AdminUsers plans={data.plans} users={data.users} total={data.totals?.users ?? data.users.length} onUpdate={updateUser} />}
          {tab === 'security' && <AdminLogs logs={data.auditLogs} total={data.totals?.auditLogs ?? data.auditLogs.length} />}
          {tab === 'config' && <AdminConfig plans={data.plans} planDefaults={data.planDefaults} config={data.config} saving={savingConfig} onSubmit={saveConfig} />}
          {tab === 'dashboard' && <div className="public-card admin-panel admin-quick-panel"><div className="admin-panel-heading"><div><p className="eyebrow">快捷操作</p><h2>常用入口</h2></div><span>待清理资源 <strong>{stats.pendingCleanup || 0}</strong></span></div><div className="admin-quick-grid">{[['resources', '资源管理', '查看分享与收集资源', Database], ['users', '用户管理', '查看账号与套餐权益', Users], ['security', '安全日志', '审计操作与安全事件', ShieldCheck], ['config', '系统配置', '配置上传限制与套餐', SlidersHorizontal]].map(([key, label, detail, Icon]) => <button type="button" className="admin-quick-link" key={key} onClick={() => changeTab(key)}><span><Icon size={16} /></span><strong>{label}</strong><small>{detail}</small></button>)}</div></div>}
        </div>
        </div>
      </main>
      <ConfirmModal state={confirmState} onCancel={() => settleConfirm(false)} onConfirm={() => settleConfirm(true)} />
      {notice && <div className={`toast ${notice.tone || 'success'}`} role={notice.tone === 'error' ? 'alert' : 'status'} aria-live={notice.tone === 'error' ? 'assertive' : 'polite'}><span className="toast-icon">{notice.tone === 'error' ? <X size={18} /> : <Check size={18} />}</span><span>{notice.message}</span></div>}
    </div>
  )
}

export function AdminPagination({ page, pageCount, total, pageSize, onPageChange }) {
  if (total <= pageSize) return null
  const start = (page - 1) * pageSize + 1
  const end = Math.min(total, page * pageSize)
  return <div className="admin-pagination"><span>显示 {start}-{end} / {total}</span><div><button className="secondary-button" onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1}><ChevronLeft size={14} /> 上一页</button><button className="secondary-button" onClick={() => onPageChange(Math.min(pageCount, page + 1))} disabled={page >= pageCount}>下一页 <ChevronRight size={14} /></button></div></div>
}

export function AdminResources({ resources = [], total = 0, requestConfirm, onChanged }) {
  const pageSize = 10
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState('')
  const [copiedId, setCopiedId] = useState('')
  const normalizedQuery = query.trim().toLowerCase()
  const filteredResources = normalizedQuery
    ? resources.filter((item) => [item.name, item.id, item.code, item.ownerUserId].some((value) => String(value || '').toLowerCase().includes(normalizedQuery)))
    : resources
  const pageCount = Math.max(1, Math.ceil(filteredResources.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visibleResources = filteredResources.slice((safePage - 1) * pageSize, safePage * pageSize)
  useEffect(() => { setPage(1) }, [resources.length, normalizedQuery])
  const kindLabel = (item) => (item.kind === 'share' ? '分享' : '收集任务')
  const statusLabel = (status) => (status === 'active' ? '活跃' : status === 'expired' ? '已过期' : '已关闭')
  const copyResourceId = async (item) => {
    try {
      await copyTextToClipboard(item.id)
      setCopiedId(item.id)
      setTimeout(() => setCopiedId((current) => (current === item.id ? '' : current)), 1600)
    } catch {}
  }
  const removeResource = async (item) => {
    const confirmed = await requestConfirm({
      title: `删除${kindLabel(item)}？`,
      subject: item.name,
      detail: `将永久删除该资源及其全部文件（${item.fileCount || 0} 个文件，${formatBytes(item.totalSize || 0)}），用户记录中指向它的条目会一并移除${item.status === 'active' ? '；该资源当前仍活跃，删除后提取链接立即失效' : ''}。确定继续吗？`,
      confirmText: '删除资源',
      tone: 'danger',
    })
    if (!confirmed) return
    setBusyId(item.id)
    try {
      // DELETE 响应已携带最新 overview，直接上屏，避免整页退回「正在打开后台」loading
      const result = await apiRequest(`/api/admin/resources/${item.kind}/${encodeURIComponent(item.id)}`, { method: 'DELETE' })
      onChanged?.(`已删除${kindLabel(item)}「${item.name}」`, undefined, result?.overview)
    } catch (err) {
      onChanged?.(err.message || '删除失败', 'error')
    } finally {
      setBusyId('')
    }
  }
  return <div className="public-card admin-panel"><div className="admin-panel-heading"><div><p className="eyebrow">分享与收集</p><h2>资源管理</h2></div><span>共 {total} 个资源{total > resources.length ? ' · 仅显示前 200 条' : ''}</span></div><label className="admin-search"><Search size={15} /><input maxLength={160} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索资源名称、ID、提取码或归属用户" /></label><div className="admin-table">{filteredResources.length ? visibleResources.map((item) => <div className="admin-table-row" key={`${item.kind}-${item.id}`}><div className="admin-user-identity"><strong>{kindLabel(item)} · {item.name}</strong><span>{statusLabel(item.status)} · {item.fileCount || 0} 个文件 · {formatBytes(item.totalSize || 0)} · 归属 {item.ownerUserId || '匿名'} · 建于 {formatDate(item.createdAt)}</span><span className="admin-resource-id-row"><button type="button" className="admin-resource-id" title={`资源 ID（${item.kind === 'share' ? '即分享链接 /share/ 末段' : '即收集链接 /collect/ 末段'}），点击复制`} onClick={() => copyResourceId(item)}>{copiedId === item.id ? <Check size={11} /> : <Copy size={11} />}<i>{item.id}</i>{copiedId === item.id ? '已复制' : ''}</button>{item.code ? <em className="admin-resource-code" title="提取码">提取码 {item.code}</em> : null}</span></div><div className="admin-user-actions"><small className="admin-user-usage">{item.expiresAt ? `截止 ${formatDate(item.expiresAt)}` : '永久有效'}</small><button className="secondary-button danger-lite" disabled={busyId === item.id} onClick={() => removeResource(item)}><Trash2 size={14} /> {busyId === item.id ? '删除中' : '删除'}</button></div></div>) : <div className="empty-manage"><Database size={25} /><span>没有匹配的资源</span></div>}</div><AdminPagination page={safePage} pageCount={pageCount} total={filteredResources.length} pageSize={pageSize} onPageChange={setPage} /></div>
}

export function AdminUsers({ plans = [], users = [], total = 0, onUpdate }) {
  const pageSize = 8
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()
  const filteredUsers = normalizedQuery
    ? users.filter((user) => [user.id, user.username, user.nickname, user.email, user.phone].some((value) => String(value || '').toLowerCase().includes(normalizedQuery)))
    : users
  const pageCount = Math.max(1, Math.ceil(filteredUsers.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visibleUsers = filteredUsers.slice((safePage - 1) * pageSize, safePage * pageSize)
  useEffect(() => { setPage(1) }, [users.length, normalizedQuery])
  return <div className="public-card admin-panel"><div className="admin-panel-heading"><div><p className="eyebrow">账号与权益</p><h2>用户管理</h2></div><span>共 {total || users.length} 个用户{total > users.length ? ' · 仅显示前 200 条' : ''}</span></div><label className="admin-search"><Search size={15} /><input maxLength={160} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索账号、手机号、邮箱或用户 ID" /></label><div className="admin-table">{filteredUsers.length ? visibleUsers.map((user) => <div className="admin-table-row" key={user.id}><div className="admin-user-identity"><strong>{user.nickname || user.username || user.id}</strong><span>{user.email || user.phone || user.id}</span></div><div className="admin-user-actions"><select className="admin-user-plan" value={user.planId} onChange={(event) => onUpdate(user, { planId: event.target.value })} aria-label={`${user.nickname || user.username || user.id}的套餐`}>{!plans.some(plan => plan.id === user.planId && !plan.retired) && <option value={user.planId} disabled>{user.planLabel || "历史已购权益"}</option>}{plans.filter(plan => !plan.retired).map(plan => <option key={plan.id} value={plan.id}>{plan.label}</option>)}</select><button className={user.status === 'disabled' ? 'secondary-button' : 'secondary-button danger-lite'} onClick={() => onUpdate(user, { status: user.status === 'disabled' ? 'active' : 'disabled' })}>{user.status === 'disabled' ? '启用' : '禁用'}</button><small className="admin-user-usage">{user.planLabel} · {formatBytes(user.usageBytes || 0)}</small></div></div>) : <div className="empty-manage"><Search size={25} /><span>没有匹配的用户</span></div>}</div><AdminPagination page={safePage} pageCount={pageCount} total={filteredUsers.length} pageSize={pageSize} onPageChange={setPage} /></div>
}

export function AdminConfig({ plans = [], planDefaults = [], config = {}, saving = false, onSubmit }) {
  const overrides = config.planOverrides || {}
  return <form className="public-card admin-panel admin-config-form" onSubmit={onSubmit}>
    <div className="admin-panel-heading"><div><p className="eyebrow">运行参数</p><h2>系统配置</h2></div></div>
    <div className="admin-config-grid">
      <label className="manage-field"><span>默认保存时效（天）</span><input name="defaultShareDays" type="number" min="1" max="365" defaultValue={config.defaultShareDays} /></label>
      <label className="manage-field"><span>普通分享最长有效期（天）</span><input name="maxShareDays" type="number" min="1" max="365" defaultValue={config.maxShareDays} /></label>
      <label className="manage-field"><span>匿名单文件上限（MB）</span><input name="anonymousMaxFileSizeMb" type="number" min="1" max="20480" step="0.1" defaultValue={config.anonymousMaxFileSizeMb} /></label>
      <label className="manage-field"><span>未登录累计传输上限（MB）</span><input name="anonymousTotalSizeMb" type="number" min="0" max="102400" defaultValue={config.anonymousTotalSizeMb} /></label>
      <label className="manage-field"><span>游客每个任务最多提交人数（0 不限）</span><input name="anonymousCollectionParticipantLimit" type="number" min="0" max="10000" defaultValue={config.anonymousCollectionParticipantLimit} /></label>
      <label className="manage-field"><span>游客进行中任务数（0 不限）</span><input name="anonymousActiveCollectionLimit" type="number" min="0" max="1000" defaultValue={config.anonymousActiveCollectionLimit} /></label>
      <label className="manage-field"><span>单次最多文件数</span><input name="maxBatchFiles" type="number" min="1" max="100" defaultValue={config.maxBatchFiles} /></label>
      <label className="manage-field"><span>审计日志保留（天）</span><input name="auditLogRetentionDays" type="number" min="1" max="3650" defaultValue={config.auditLogRetentionDays} /></label>
      <label className="manage-field"><span>孤立目录宽限（小时）</span><input name="orphanGraceHours" type="number" min="1" max="720" defaultValue={config.orphanGraceHours} /></label>
    </div>
    <div className="admin-plan-config">
      <div className="admin-plan-config-heading"><strong>套餐权益配置</strong><span>留空恢复默认，价格由会员主站管理</span></div>
      <p className="admin-plan-help">容量按整数 GB 设置，每次增减 1GB。容量、上传和收集限额保存后立即生效。人数和任务数填 0 表示不限。游客按设备统计人数，登录用户按账号统计。</p>
      <div className="admin-plan-scroll"><div className="admin-plan-table">
        {plans.filter(plan => !plan.retired).map(plan => {
          const { id, label } = plan
          const defaults = planDefaults.find(item => item.id === id) || plan
          const override = overrides[id] || {}
          const fields = [
            ['个人容量 GB', 'gb', 'totalBytes', 1024 ** 3, 1, 20480],
            ['团队容量 GB', 'teamGb', 'teamSpaceBytes', 1024 ** 3, 0, 20480],
            ['单文件 GB', 'singleFileGb', 'singleFileLimitBytes', 1024 ** 3, 1, 20],
            ['提交人数 / 任务', 'participants', 'collectionParticipantLimit', 1, 0, 10000],
            ['进行中任务数', 'tasks', 'activeCollectionLimit', 1, 0, 1000],
          ]
          return <div className="admin-plan-row" key={id}><strong>{label}</strong>{fields.map(([title, suffix, key, divisor, min, max]) => <label key={key}><span>{title}</span><input aria-label={`${label}${title}`} name={`plan-${id}-${suffix}`} type="number" min={min} max={max} step="1" defaultValue={Object.hasOwn(override, key) ? (override[key] ?? 0) / divisor : ''} placeholder={`默认 ${(defaults[key] ?? 0) / divisor}`} /></label>)}</div>
        })}
      </div></div>
      <p className="admin-plan-help">单文件业务上限为 20GB。当前 ClamAV 对约 2GB 以上文件可能无法完成完整扫描；超过扫描能力的文件仍会被拦截，请勿通过关闭安全检查放行。</p>
    </div>
    <label className="switch-row"><div><strong>维护模式</strong><span>开启后会阻止非管理员创建分享、收集任务或提交文件。</span></div><input name="maintenanceMode" type="checkbox" defaultChecked={config.maintenanceMode} /></label>
    <button className="primary-button" disabled={saving}><SlidersHorizontal size={15} /> {saving ? '保存中' : '保存配置'}</button>
  </form>
}

export function AdminLogs({ logs = [], total = 0 }) {
  const pageSize = 10
  const [page, setPage] = useState(1)
  const pageCount = Math.max(1, Math.ceil(logs.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visibleLogs = logs.slice((safePage - 1) * pageSize, safePage * pageSize)
  useEffect(() => { setPage(1) }, [logs.length])
  return <div className="public-card admin-panel"><div className="admin-panel-heading"><div><p className="eyebrow">安全与访问</p><h2>审计日志</h2></div><span>共 {total || logs.length} 条日志{total > logs.length ? ' · 仅显示最近 100 条' : ''}</span></div><div className="admin-log-list admin-log-list-large">{logs.length ? visibleLogs.map((item) => <div key={item.id}><span><strong>{item.type === 'security' ? '安全拦截' : item.type === 'admin' ? '管理员操作' : '访问'}</strong> {item.action}</span><small>{formatDate(item.createdAt)} · 状态 {item.status || '-'} · IP 摘要 {item.ip || '-'}</small></div>) : <div className="empty-manage"><ShieldCheck size={25} /><span>暂无日志</span></div>}</div><AdminPagination page={safePage} pageCount={pageCount} total={logs.length} pageSize={pageSize} onPageChange={setPage} /></div>
}
