// 后台管理页面（由 main.jsx 抽取）
// AdminPage 子树：管理登录 + 概览 + 资源/用户/配置/日志。
// 只被 App 引用，构成完整独立功能域。

import React, { useEffect, useRef, useState } from 'react'
import { BarChart3, Check, ChevronLeft, ChevronRight, Copy, Database, Eye, HardDrive, Inbox, KeyRound, Link2, LockKeyhole, LogOut, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Trash2, UserRound, Users, X, XCircle } from 'lucide-react'
import { useConfirmDialog } from '../hooks.js'
import { apiRequest, copyTextToClipboard } from '../lib/api.js'
import { ConfirmModal, PublicShell } from '../components/common.jsx'
import { formatBytes, formatDate } from '../lib/format.js'
import { limitInputText } from '../lib/input-limits.js'
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
    <div className="modal-backdrop admin-login-backdrop">
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
  )
}

export function AdminPage() {
  const requestGeneration = useRef(0)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('dashboard')
  const [savingConfig, setSavingConfig] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [adminInfo, setAdminInfo] = useState(null)
  const [loginBusy, setLoginBusy] = useState(false)
  const [loginError, setLoginError] = useState('')
  const [notice, setNotice] = useState(null)
  const { confirmState, requestConfirm, settleConfirm } = useConfirmDialog()

  // 与用户端一致的右下角 toast 提示
  const showToast = (message, tone = 'success') => setNotice({ message, tone })
  useEffect(() => {
    if (!notice) return undefined
    const timer = window.setTimeout(() => setNotice(null), 3000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const load = async () => {
    const generation = ++requestGeneration.current
    setLoading(true)
    setError('')
    try {
      const session = await apiRequest('/api/admin/session')
      if (generation !== requestGeneration.current) return
      if (!session.authenticated) {
        setAuthenticated(false)
        setAdminInfo(null)
        setData(null)
        return
      }
      setAuthenticated(true)
      setAdminInfo(session.admin || null)
      const overview = await apiRequest('/api/admin/overview')
      if (generation === requestGeneration.current) setData(overview)
    } catch (err) {
      if (generation !== requestGeneration.current) return
      setAuthenticated(false)
      setAdminInfo(null)
      setData(null)
      setError(err.message || '后台数据加载失败')
    } finally {
      if (generation === requestGeneration.current) setLoading(false)
    }
  }
  useEffect(() => {
    const refresh = () => { if (document.visibilityState !== 'hidden') load() }
    load()
    window.addEventListener('focus', refresh)
    window.addEventListener('pageshow', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      requestGeneration.current++
      window.removeEventListener('focus', refresh)
      window.removeEventListener('pageshow', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])

  const submitLogin = async ({ username, password }) => {
    setLoginBusy(true)
    setLoginError('')
    try {
      const result = await apiRequest('/api/admin/login', { method: 'POST', body: JSON.stringify({ username, password }) })
      setAuthenticated(true)
      setAdminInfo(result.admin || null)
      setData(result.overview || null)
      setError('')
    } catch (err) {
      setLoginError(err.message || '登录失败')
    } finally {
      setLoginBusy(false)
    }
  }

  const logoutAdmin = async () => {
    requestGeneration.current++
    setLoading(false)
    try {
      await apiRequest('/api/admin/logout', { method: 'POST' })
    } catch { /* 忽略退出异常，前端一律回到登录态 */ }
    setAuthenticated(false)
    setAdminInfo(null)
    setData(null)
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
      ;['free', 'member', 'team', 'enterprise'].forEach((planId) => {
        const override = {}
        for (const [field, suffix] of [['totalGb', 'gb'], ['monthlyPrice', 'price'], ['validityDays', 'days']]) {
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
        maxBatchFiles: form.get('maxBatchFiles'),
        auditLogRetentionDays: form.get('auditLogRetentionDays'),
        orphanGraceHours: form.get('orphanGraceHours'),
        maintenanceMode: form.get('maintenanceMode') === 'on',
        planOverrides,
      }) })
      setData((current) => ({ ...current, config: result.config }))
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
  if (loading) return <PublicShell><div className="state-block"><span className="loading-dot" /><h1>正在打开后台</h1><p>正在检查管理员登录状态。</p></div></PublicShell>
  // 后台一律先过口令登录。此前这里会因鲲穹白名单账号已登录而直接放行，
  // 表现为「部分账号能直接进后台」—— 白名单通道已移除，访问 /admin 恒定弹登录框。
  if (!authenticated) return <PublicShell><AdminLoginModal onSubmit={submitLogin} busy={loginBusy} error={loginError} onBackHome={() => { window.location.href = '/' }} /></PublicShell>
  if (error && !data) return <PublicShell><div className="state-block"><div className="settings-state-icon"><ShieldCheck size={24} /></div><h1>无法打开后台</h1><p>{error}</p><button className="primary-button" onClick={load}><RefreshCw size={16} /> 重新加载</button><button className="secondary-button" onClick={logoutAdmin}><LogOut size={15} /> 退出后台</button><a className="secondary-button" href="/">返回首页</a></div></PublicShell>
  if (!data) return null
  const stats = data.stats || {}
  const dashboardCards = [['注册用户', stats.users || 0, Users], ['未禁用用户', stats.activeUsers || 0, UserRound], ['分享', stats.shares || 0, Link2], ['收集任务', stats.collections || 0, Inbox], ['占用空间', formatBytes(stats.totalBytes || 0), HardDrive], ['待清理', stats.pendingCleanup || 0, RefreshCw]]
  const trend = data.trend || []
  const trendMax = Math.max(1, ...trend.flatMap((item) => [item.activeUsers, item.uploads, item.downloads]))
  return (
    <PublicShell>
      <section className="admin-page">
        <div className="admin-heading"><div><p className="eyebrow">鲲穹运营后台</p><h1>系统管理</h1><p>统一查看用户、安全日志、运行配置和系统概览。</p></div><div className="admin-heading-actions">{adminInfo?.username && <span className="admin-identity" title={`当前登录管理员：${adminInfo.username}`}><ShieldCheck size={14} /> {adminInfo.username}</span>}<button className="secondary-button" onClick={runCleanup}><RefreshCw size={15} /> 执行清理</button><button className="secondary-button" onClick={load}><RefreshCw size={15} /> 刷新数据</button><button className="secondary-button" onClick={logoutAdmin}><LogOut size={15} /> 退出后台</button></div></div>
        <nav className="admin-tabs" aria-label="后台模块">{[['dashboard', '数据看板', BarChart3], ['resources', '资源管理', Database], ['users', '用户管理', Users], ['security', '安全日志', ShieldCheck], ['config', '系统配置', SlidersHorizontal]].map(([key, label, Icon]) => <button className={tab === key ? 'active' : ''} key={key} onClick={() => setTab(key)}><Icon size={16} /> {label}</button>)}</nav>
        {error && <p className="public-message">{error}</p>}
        <div className="admin-content">
          {tab === 'dashboard' && <><div className="admin-kpi-grid">{dashboardCards.map(([label, value, Icon]) => <div className="admin-kpi" key={label}><span><Icon size={17} /> {label}</span><strong>{value}</strong></div>)}</div><div className="admin-columns"><div className="public-card admin-panel"><div className="admin-panel-heading"><div><p className="eyebrow">近 7 天</p><h2>运营趋势</h2></div></div><div className="admin-trend-list">{trend.map((item) => <div className="admin-trend-row" key={item.date}><span>{item.label}</span><div><i style={{ width: `${(item.activeUsers / trendMax) * 100}%` }} title={`活跃用户 ${item.activeUsers}`} /><i className="upload" style={{ width: `${(item.uploads / trendMax) * 100}%` }} title={`上传 ${item.uploads}`} /><i className="download" style={{ width: `${(item.downloads / trendMax) * 100}%` }} title={`下载 ${item.downloads}`} /></div><small>{item.activeUsers} / {item.uploads} / {item.downloads}</small></div>)}</div><small className="admin-trend-legend"><span><i />活跃用户</span><span><i className="upload" />上传</span><span><i className="download" />下载</span></small></div><div className="public-card admin-panel"><div className="admin-panel-heading"><div><p className="eyebrow">资源状态</p><h2>运营概览</h2></div></div><div className="admin-status-list"><span><i className="status-dot active" /> 活跃资源 <strong>{stats.activeResources || 0}</strong></span><span><i className="status-dot muted" /> 已禁用用户 <strong>{Math.max(0, (stats.users || 0) - (stats.activeUsers || 0))}</strong></span><span><i className="status-dot review" /> 团队空间 <strong>{stats.activeOrganizations || 0}</strong></span></div><div className="admin-log-list">{(data.auditLogs || []).slice(0, 4).map((item) => <div key={item.id}><span>{item.action}</span><small>{formatDate(item.createdAt)} · {item.status || '-'}</small></div>)}</div></div></div></>}
          {tab === 'resources' && <AdminResources resources={data.resources} total={data.totals?.resources ?? data.resources.length} requestConfirm={requestConfirm} onChanged={(message, tone, overview) => { if (overview) { setData((current) => ({ ...current, ...overview })) } else { load() } if (message) showToast(message, tone) }} />}
          {tab === 'users' && <AdminUsers users={data.users} total={data.totals?.users ?? data.users.length} onUpdate={updateUser} />}
          {tab === 'security' && <AdminLogs logs={data.auditLogs} total={data.totals?.auditLogs ?? data.auditLogs.length} />}
          {tab === 'config' && <AdminConfig config={data.config} saving={savingConfig} onSubmit={saveConfig} />}
        </div>
      </section>
      <ConfirmModal state={confirmState} onCancel={() => settleConfirm(false)} onConfirm={() => settleConfirm(true)} />
      {notice && <div className={`toast ${notice.tone || 'success'}`} role={notice.tone === 'error' ? 'alert' : 'status'} aria-live={notice.tone === 'error' ? 'assertive' : 'polite'}><span className="toast-icon">{notice.tone === 'error' ? <X size={18} /> : <Check size={18} />}</span><span>{notice.message}</span></div>}
    </PublicShell>
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

export function AdminUsers({ users = [], total = 0, onUpdate }) {
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
  return <div className="public-card admin-panel"><div className="admin-panel-heading"><div><p className="eyebrow">账号与权益</p><h2>用户管理</h2></div><span>共 {total || users.length} 个用户{total > users.length ? ' · 仅显示前 200 条' : ''}</span></div><label className="admin-search"><Search size={15} /><input maxLength={160} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索账号、手机号、邮箱或用户 ID" /></label><div className="admin-table">{filteredUsers.length ? visibleUsers.map((user) => <div className="admin-table-row" key={user.id}><div className="admin-user-identity"><strong>{user.nickname || user.username || user.id}</strong><span>{user.email || user.phone || user.id}</span></div><div className="admin-user-actions"><select className="admin-user-plan" value={user.planId} onChange={(event) => onUpdate(user, { planId: event.target.value })} aria-label={`${user.nickname || user.username || user.id}的套餐`}><option value="free">基础版</option><option value="member">会员版</option><option value="team">团队版</option><option value="enterprise">企业版</option></select><button className={user.status === 'disabled' ? 'secondary-button' : 'secondary-button danger-lite'} onClick={() => onUpdate(user, { status: user.status === 'disabled' ? 'active' : 'disabled' })}>{user.status === 'disabled' ? '启用' : '禁用'}</button><small className="admin-user-usage">{user.planLabel} · {formatBytes(user.usageBytes || 0)}</small></div></div>) : <div className="empty-manage"><Search size={25} /><span>没有匹配的用户</span></div>}</div><AdminPagination page={safePage} pageCount={pageCount} total={filteredUsers.length} pageSize={pageSize} onPageChange={setPage} /></div>
}

export function AdminConfig({ config = {}, saving = false, onSubmit }) {
  const overrides = config.planOverrides || {}
  return <form className="public-card admin-panel admin-config-form" onSubmit={onSubmit}>
    <div className="admin-panel-heading"><div><p className="eyebrow">运行参数</p><h2>系统配置</h2></div></div>
    <div className="admin-config-grid">
      <label className="manage-field"><span>默认保存时效（天）</span><input name="defaultShareDays" type="number" min="1" max="365" defaultValue={config.defaultShareDays} /></label>
      <label className="manage-field"><span>普通分享最长有效期（天）</span><input name="maxShareDays" type="number" min="1" max="365" defaultValue={config.maxShareDays} /></label>
      <label className="manage-field"><span>匿名单文件上限（MB）</span><input name="anonymousMaxFileSizeMb" type="number" min="1" max="5120" defaultValue={config.anonymousMaxFileSizeMb} /></label>
      <label className="manage-field"><span>未登录累计传输上限（MB）</span><input name="anonymousTotalSizeMb" type="number" min="0" max="102400" defaultValue={config.anonymousTotalSizeMb} /></label>
      <label className="manage-field"><span>单次最多文件数</span><input name="maxBatchFiles" type="number" min="1" max="100" defaultValue={config.maxBatchFiles} /></label>
      <label className="manage-field"><span>审计日志保留（天）</span><input name="auditLogRetentionDays" type="number" min="1" max="3650" defaultValue={config.auditLogRetentionDays} /></label>
      <label className="manage-field"><span>孤立目录宽限（小时）</span><input name="orphanGraceHours" type="number" min="1" max="720" defaultValue={config.orphanGraceHours} /></label>
    </div>
    <div className="admin-plan-config"><div className="admin-plan-config-heading"><strong>会员权益配置</strong><span>留空恢复默认。容量使用 GB，价格使用分；支付价格以主站为准。</span></div>{[['free', '基础版'], ['member', '会员版'], ['team', '团队版'], ['enterprise', '企业版']].map(([id, label]) => <div className="admin-plan-row" key={id}><strong>{label}</strong><label><span>容量 GB</span><input name={`plan-${id}-gb`} type="number" min="1" step="1" defaultValue={overrides[id]?.totalBytes ? Math.round(overrides[id].totalBytes / 1024 ** 3) : ''} placeholder="默认" /></label><label><span>价格（分）</span><input name={`plan-${id}-price`} type="number" min="0" step="1" defaultValue={overrides[id]?.monthlyPrice ?? ''} placeholder="默认" /></label><label><span>有效期（天）</span><input name={`plan-${id}-days`} type="number" min="1" max="3650" defaultValue={overrides[id]?.validityDays ?? ''} placeholder="默认" /></label></div>)}</div>
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
