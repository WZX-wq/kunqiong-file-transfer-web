import { useSerializedPreference } from '../lib/serialized-preference.js'
import React from 'react'
import { useEffect, useRef, useState } from 'react'
import { SETTINGS_NAV_ITEMS } from '../lib/constants.js'
import { bindAccountTarget, normalizeFileCleanupSettings, normalizeNoticeSettings, requestAccountBindCode, saveCloudFileCleanupSettings, saveCloudNoticeSettings } from '../lib/records.js'
import { ArrowLeft, AlertTriangle, BadgeCheck, Check, ChevronRight, Crown, HardDrive, ImageIcon, KeyRound, RotateCcw, Send, ShieldCheck, Trash2, UserRound, X } from 'lucide-react'
import { UserAvatar } from '../components/ui.jsx'
import { PrototypeAsset } from '../components/prototype-asset.jsx'
import { displayUserName, formatBytes, formatDateInput, maskPhone } from '../lib/format.js'
import { contactInputError, EMAIL_MAX_LENGTH, normalizePhoneContact, PHONE_LENGTH } from '../../server/lib/contact-input.js'
import { OrdersPanel } from './orders.jsx'
import { apiRequest } from '../lib/api.js'

// 清理页顶部「存储与清理」卡（对齐原型 settings-cleanup 的存储卡）：
// 三段容量全部来自 /api/account/file-cleanup-overview 的真实统计，
// 「立即清理」走 /api/account/file-cleanup/run，按当前账号自己的清理规则执行。
function CleanupStorageCard({ user }) {
  const [overview, setOverview] = useState(null)
  const [running, setRunning] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const load = () => apiRequest('/api/account/file-cleanup-overview').then((data) => setOverview(data)).catch(() => {})
  useEffect(() => { load() }, [])
  const runNow = async () => {
    if (running) return
    setRunning(true)
    setFeedback(null)
    try {
      const result = await apiRequest('/api/account/file-cleanup/run', { method: 'POST', body: JSON.stringify({}) })
      if (result.skipped) {
        setFeedback({ tone: 'info', text: '自动清理未开启，请先开启上方开关后再立即清理。' })
      } else {
        setFeedback({ tone: 'success', text: result.files > 0 ? `已清理 ${result.shares} 个分享与 ${result.collections} 个收集任务（共 ${result.files} 个文件），释放 ${formatBytes(result.freedBytes)}。` : '没有满足清理条件的过期文件，无需清理。' })
      }
      load()
    } catch (err) {
      setFeedback({ tone: 'error', text: err.message || '清理失败，请稍后再试' })
    } finally {
      setRunning(false)
    }
  }
  if (!overview) return <div className="cleanup-storage-card is-loading"><span className="loading-dot" /> 正在读取容量使用…</div>
  const total = Math.max(0, Number(overview.totalBytes) || 0)
  const pct = (bytes) => total > 0 ? Math.min(100, (bytes / total) * 100) : 0
  const expired = Math.max(0, Number(overview.expiredBytes) || 0)
  const planLabel = user?.plan?.label || '当前套餐'
  const expiredParts = []
  if (overview.expiredShareCount > 0) expiredParts.push(`${overview.expiredShareCount} 个分享`)
  if (overview.expiredCollectionCount > 0) expiredParts.push(`${overview.expiredCollectionCount} 个收集任务`)
  const expiredDetail = expiredParts.length ? `（${expiredParts.join(' · ')}）` : ''
  return (
    <div className="cleanup-storage-card">
      <div className="cleanup-storage-head">
        <h2><HardDrive size={18} /> 存储与清理</h2>
        <span className="cleanup-plan-chip">{planLabel} {formatBytes(total)}</span>
      </div>
      <div className="cleanup-storage-body">
        <div className="cleanup-storage-line"><span>存储空间</span><em>已用 {total > 0 ? Math.round((overview.usedBytes / total) * 100) : 0}%</em></div>
        <div className="cleanup-storage-total"><b>{formatBytes(overview.usedBytes)}</b><small>/ {formatBytes(total)}</small></div>
        <div className="cleanup-storage-bar" role="img" aria-label={`有效文件 ${formatBytes(overview.activeBytes)}，即将过期 ${formatBytes(overview.expiringBytes)}，已过期待清理 ${formatBytes(expired)}`}>
          <i style={{ width: `${pct(overview.activeBytes)}%`, background: '#1f6bff' }} />
          <i style={{ width: `${pct(overview.expiringBytes)}%`, background: '#7fb0f5' }} />
          <i style={{ width: `${pct(expired)}%`, background: '#d8e4f5' }} />
        </div>
        <div className="cleanup-storage-legend">
          <span><i style={{ background: '#1f6bff' }} />有效文件<b>{formatBytes(overview.activeBytes)}</b></span>
          <span><i style={{ background: '#7fb0f5' }} />即将过期<b>{formatBytes(overview.expiringBytes)}</b></span>
          <span><i style={{ background: '#d8e4f5' }} />已过期待清理<b>{formatBytes(expired)}</b></span>
        </div>
        <div className={`cleanup-storage-action ${expired > 0 ? 'has-expired' : ''}`}>
          <AlertTriangle size={16} />
          <span>{expired > 0 ? `已过期文件仍占用容量，清理后才会释放${expiredDetail}。` : '当前没有已过期占用容量的文件。'}</span>
          <button type="button" className="primary-button" onClick={runNow} disabled={running || !overview.settings.enabled} title={overview.settings.enabled ? '' : '请先开启自动清理开关'}>
            <Trash2 size={14} /> {running ? '清理中…' : '立即清理'}
          </button>
        </div>
        {feedback && <p className={`cleanup-storage-feedback is-${feedback.tone}`}>{feedback.text}</p>}
      </div>
    </div>
  )
}

// 页面头：标题与说明随分区切换（对齐原型 settingsLayout 的 title / sub）。
const SECTION_HEADINGS = {
  profile: { title: '个人资料', detail: '管理在鲲穹文件传输中展示的账户信息。' },
  security: { title: '账号与安全', detail: '查看当前登录账户和会话安全状态。' },
  notice: { title: '消息通知', detail: '选择你希望收到的账户和文件动态提醒，修改会自动保存。' },
  cleanup: { title: '文件清理', detail: '控制已过期文件是否自动删除，清理后才会释放账号容量。' },
  orders: { title: '我的订单', detail: '查询会员套餐订单和支付状态。' },
}

export function SettingsPage({ user, loading, section, onLogin, onLogout, onBack, onSaveProfile, onUpdateUser, onNavigateSection, onOpenWorkspace }) {
  const [nickname, setNickname] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileError, setProfileError] = useState('')
  const userRef = useRef(user)
  userRef.current = user
  const updatePreferenceUser = (field, saved) => {
    const next = { ...userRef.current, [field]:saved }
    userRef.current = next
    onUpdateUser?.(next)
  }
  const [noticeSettings, updateNotice, noticeError] = useSerializedPreference(user?.notificationSettings, user?.id, normalizeNoticeSettings, saveCloudNoticeSettings, saved => updatePreferenceUser('notificationSettings', saved))
  const [fileCleanupSettings, updateFileCleanup, fileCleanupError] = useSerializedPreference(user?.fileCleanup, user?.id, normalizeFileCleanupSettings, saveCloudFileCleanupSettings, saved => updatePreferenceUser('fileCleanup', saved))
  const [bindingType, setBindingType] = useState('')
  const [avatarPreview, setAvatarPreview] = useState('')
  const [avatarError, setAvatarError] = useState('')
  const [savingAvatar, setSavingAvatar] = useState(false)
  const avatarInputRef = useRef(null)

  useEffect(() => {
    if (!user?.id) return
    setNickname(user.nickname || user.username || '')
    setAvatarPreview('')
    setAvatarError('')
  }, [user?.id])

  const updateNoticeSetting = key => updateNotice(current => ({ ...current, [key]:!current[key] }))

  const saveNickname = async (event) => {
    event.preventDefault()
    const nextNickname = nickname.trim()
    if (!nextNickname) return
    setSavingProfile(true)
    setProfileError('')
    try {
      await onSaveProfile({ nickname: nextNickname })
    } catch (error) {
      setProfileError(error.message || '保存失败，请稍后重试')
    } finally {
      setSavingProfile(false)
    }
  }

  const saveAvatarFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setAvatarError('')
    if (!file.type.startsWith('image/')) {
      setAvatarError('请选择图片文件')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setAvatarError('头像图片不能超过 2 MB')
      return
    }
    setSavingAvatar(true)
    try {
      const dataUrl = await resizeAvatarFile(file)
      setAvatarPreview(dataUrl)
      await onSaveProfile({ avatar: dataUrl })
      setAvatarPreview('')
    } catch (error) {
      setAvatarPreview('')
      setAvatarError(error.message || '头像保存失败，请稍后重试')
    } finally {
      setSavingAvatar(false)
    }
  }

  const restoreProviderAvatar = async () => {
    setAvatarError('')
    setSavingAvatar(true)
    try {
      await onSaveProfile({ avatar: null })
    } catch (error) {
      setAvatarError(error.message || '头像恢复失败，请稍后重试')
    } finally {
      setSavingAvatar(false)
    }
  }

  if (loading) {
    return <section className="settings-state"><span className="loading-dot" /><strong>正在加载账户信息</strong><p>请稍候。</p></section>
  }

  if (!user) {
    return (
      <section className="settings-state">
        <div className="settings-state-icon"><UserRound size={23} /></div>
        <strong>登录后管理账户设置</strong>
        <p>个人资料、账号安全和消息通知会与当前账户关联。</p>
        <button className="primary-button" onClick={onLogin}><UserRound size={16} /> 前往登录</button>
      </section>
    )
  }

  const heading = SECTION_HEADINGS[section] || SECTION_HEADINGS.profile
  const plan = user.plan || {}
  const capacity = user.capacity || {}
  const planExpiry = user.planExpiresAt ? formatDateInput(new Date(user.planExpiresAt)) : ''
  // 侧边栏副标题对齐原型「会员版 · 至 2027-06-18」：只展示套餐与到期日。
  const planLine = `${
    plan.id === 'free' ? '免费版' : plan.permanent ? `${plan.label || '会员版'} · 永久有效` : plan.label || '会员版'
  }${!plan.permanent && planExpiry ? ` · 至 ${planExpiry}` : ''}`
  const usedBytes = Number(capacity.usedBytes || 0)
  const totalBytes = Number(capacity.totalBytes || 0)
  const resetProfileForm = () => {
    setNickname(user.nickname || user.username || '')
    setProfileError('')
    setAvatarError('')
  }

  return (
    <section className="settings-page">
      <header className="settings-page-head">
        <div className="settings-page-title">
          <div className="settings-crumb"><a href="/">首页</a><i>/</i><span>账户设置</span></div>
          <h1>{heading.title}</h1>
          <p>{heading.detail}</p>
        </div>
        {section === 'profile' && <div className="settings-page-actions"><button className="secondary-button" onClick={onOpenWorkspace}><Crown size={15} /> 会员权益</button></div>}
      </header>
      <div className="settings-layout">
        <aside className="settings-sidebar">
          <div className="settings-identity">
            <UserAvatar user={user} />
            <div>
              <strong>{displayUserName(user)}</strong>
              <span>{planLine}</span>
            </div>
          </div>
          <nav className="settings-nav" aria-label="账户设置">
            {SETTINGS_NAV_ITEMS.map(({ key, label, icon: Icon, path }) => (
              <button key={key} className={section === key ? 'active' : ''} aria-current={section === key ? 'page' : undefined} onClick={() => { if (section !== key) onNavigateSection?.(path) }}>
                <Icon size={16} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
          <div className="settings-sidebar-foot">
            <button onClick={onOpenWorkspace}><Crown size={16} /> 会员与团队空间</button>
            <button onClick={onBack}><ArrowLeft size={16} /> 返回发文件</button>
          </div>
        </aside>

        <div className={`settings-panel${section === 'profile' ? ' settings-panel-bare' : ''}`}>
          {section === 'orders' && <OrdersPanel user={user} onLogin={onLogin} />}
          {section === 'profile' && (
            <>
              <div className="settings-card">
                <div className="settings-profile-head">
                  <UserAvatar user={user} overrideSrc={avatarPreview} />
                  <div className="settings-profile-id">
                    <strong>{displayUserName(user)}</strong>
                    <span>账号 ID：{user.id || user.username}</span>
                  </div>
                  <div className="settings-profile-actions">
                    <button className="secondary-button" onClick={() => avatarInputRef.current?.click()} disabled={savingAvatar}><ImageIcon size={14} /> {savingAvatar ? '保存中' : '更换头像'}</button>
                    <button className="secondary-button" onClick={restoreProviderAvatar} disabled={savingAvatar || user.avatarSource !== 'custom'}><RotateCcw size={14} /> 恢复默认</button>
                  </div>
                  <div className="settings-plan-chip">
                    <Crown size={14} />
                    <strong>{plan.label || '免费版'}</strong>
                    <small>{plan.permanent ? '永久有效' : planExpiry ? `${planExpiry} 到期` : '长期有效'}</small>
                  </div>
                </div>
                <input ref={avatarInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={saveAvatarFile} />

                <form className="settings-profile-form" onSubmit={saveNickname}>
                  <div className="settings-form-row">
                    <label htmlFor="settings-nickname">昵称</label>
                    <div className="settings-form-body">
                      <div className="settings-field"><input id="settings-nickname" value={nickname} maxLength={40} onChange={(event) => setNickname(event.target.value)} placeholder="请输入昵称" /></div>
                      <p className="settings-form-hint">最多 40 个字符，显示在分享页与团队列表</p>
                    </div>
                  </div>
                  <div className="settings-form-row">
                    <label htmlFor="settings-email">邮箱</label>
                    <div className="settings-form-body">
                      <div className="settings-field"><input id="settings-email" value={user.email || ''} readOnly placeholder="未绑定邮箱" /></div>
                      <p className="settings-form-hint">用于接收取件通知与安全提醒</p>
                    </div>
                  </div>
                  <div className="settings-form-row">
                    <label htmlFor="settings-phone">手机号</label>
                    <div className="settings-form-body is-inline">
                      <div className="settings-field"><input id="settings-phone" value={user.phone ? maskPhone(user.phone) : ''} readOnly placeholder="未绑定手机号" /></div>
                      <span className={`settings-bind-badge ${user.phone ? 'is-bound' : ''}`}><i />{user.phone ? '已绑定' : '未绑定'}</span>
                      <button type="button" className="secondary-button" onClick={() => setBindingType('phone')}>{user.phone ? '更换' : '绑定'}</button>
                      <p className="settings-form-hint">用于登录与安全验证</p>
                    </div>
                  </div>
                  {(profileError || avatarError) && <p className="settings-form-error">{profileError || avatarError}</p>}
                  <div className="settings-form-foot">
                    <button type="button" className="secondary-button" onClick={resetProfileForm}>取消</button>
                    <button type="submit" className="primary-button" disabled={savingProfile || !nickname.trim()}>{savingProfile ? '保存中' : '保存资料'}</button>
                  </div>
                </form>
              </div>

              <div className="settings-stat-strip">
                <div><span>已用容量</span><b>{formatBytes(usedBytes)}</b><small>/ {totalBytes ? formatBytes(totalBytes) : '不限'}</small></div>
                <div><span>分享任务</span><b>{capacity.shareCount || 0} 个</b><small>共 {formatBytes(capacity.shareBytes || 0)}</small></div>
                <div><span>收集任务</span><b>{capacity.collectionCount || 0} 个</b><small>{capacity.fileCount || 0} 个文件</small></div>
                <button type="button" className="settings-stat-link" onClick={() => onNavigateSection?.('/settings/cleanup')}>容量明细 <ChevronRight size={13} /></button>
              </div>
            </>
          )}

          {section === 'security' && (
            <>
              <div className="settings-list">
                <SettingsActionRow label="鲲穹账号" value={user.username || user.id || '未设置'} detail={user.id ? `账号 ID：${user.id}` : ''} />
                <SettingsActionRow label="手机号" value={user.phone ? maskPhone(user.phone) : '未绑定手机号'} action={user.phone ? '更换绑定' : '绑定手机号'} onAction={() => setBindingType('phone')} />
                <SettingsActionRow label="邮箱" value={user.email || '未绑定邮箱'} action={user.email ? '更换绑定' : '绑定邮箱'} onAction={() => setBindingType('email')} />
                <SettingsActionRow label="当前会话" value="此设备已安全登录" action="退出登录" onAction={onLogout} />
              </div>
              <div className="settings-notice"><ShieldCheck size={16} /><span>账号认证由鲲穹统一登录中心完成，当前页面仅管理绑定方式和会话。</span></div>
            </>
          )}

          {section === 'notice' && (
            <>
              <div className="settings-notice-group">
                <h2>通知方式</h2>
                <NoticeToggle label="站内消息" detail="在鲲穹页面内显示处理结果和状态提醒" checked={noticeSettings.inApp} onChange={() => updateNoticeSetting('inApp')} />
                <NoticeToggle label="邮件提醒" detail="绑定邮箱后接收分享和账户动态提醒" checked={noticeSettings.email} onChange={() => updateNoticeSetting('email')} />
              </div>
              <div className="settings-notice-group">
                <h2>文件与任务动态</h2>
                <NoticeToggle label="有人给我发送文件" checked={noticeSettings.incomingShare} onChange={() => updateNoticeSetting('incomingShare')} />
                <NoticeToggle label="我发送的文件即将过期" checked={noticeSettings.shareExpiring} onChange={() => updateNoticeSetting('shareExpiring')} />
                <NoticeToggle label="我发送的文件已被下载" checked={noticeSettings.shareDownloaded} onChange={() => updateNoticeSetting('shareDownloaded')} />
                <NoticeToggle label="我创建的收集任务即将截止" checked={noticeSettings.collectionExpiring} onChange={() => updateNoticeSetting('collectionExpiring')} />
                <NoticeToggle label="我创建的收集任务有人提交" checked={noticeSettings.collectionSubmitted} onChange={() => updateNoticeSetting('collectionSubmitted')} />
              </div>
              {noticeError && <p className="settings-form-error settings-notice-error">{noticeError}</p>}
            </>
          )}

          {section === 'cleanup' && (
            <>
              <CleanupStorageCard user={user} />
              <div className="settings-notice-group file-cleanup-settings">
                <h2><PrototypeAsset className="settings-prototype-heading-icon" name="act-trash.png" size={22} /> 过期文件自动清理</h2>
                <NoticeToggle
                  label="自动删除过期文件"
                  detail="关闭后文件不会自动删除，但会继续占用空间；开启后按下方规则清理。"
                  checked={fileCleanupSettings.enabled}
                  onChange={() => updateFileCleanup({ enabled: !fileCleanupSettings.enabled })}
                />
                <div className={`file-cleanup-options ${fileCleanupSettings.enabled ? '' : 'disabled'}`}>
                  <div className="settings-row-label"><strong>过期后多久删除</strong><span>仅清理已过期的分享文件和收集任务文件。</span></div>
                  <div className="option-grid compact-grid">
                    {[1, 3, 7].map((days) => <button type="button" key={days} disabled={!fileCleanupSettings.enabled} className={fileCleanupSettings.days === days ? 'selected' : ''} onClick={() => updateFileCleanup({ days })}>{days} 天{fileCleanupSettings.days === days && <Check size={14} />}</button>)}
                  </div>
                </div>
                {fileCleanupError && <p className="settings-form-error">{fileCleanupError}</p>}
                <div className="settings-notice"><HardDrive size={16} /><span>文件只有在真正清理后才会从容量统计中扣除；关闭自动清理不会删除已有文件。</span></div>
              </div>
            </>
          )}
        </div>
      </div>
      {bindingType && (
        <AccountBindModal
          type={bindingType}
          currentValue={bindingType === 'email' ? user.email : user.phone}
          onClose={() => setBindingType('')}
          onComplete={(nextUser) => {
            onUpdateUser?.(nextUser)
            setBindingType('')
          }}
        />
      )}
    </section>
  )
}

export function SettingsActionRow({ label, value, detail, action, onAction, disabled = false }) {
  return (
    <div className="settings-action-row">
      <div><strong>{label}</strong><span>{value}</span>{detail && <small>{detail}</small>}</div>
      {action && <button className={disabled || !onAction ? 'settings-row-action disabled' : 'settings-row-action'} onClick={onAction} disabled={disabled || !onAction}>{action}{!disabled && onAction && <ChevronRight size={15} />}</button>}
    </div>
  )
}

export function AccountBindModal({ type, currentValue, onClose, onComplete }) {
  const isEmail = type === 'email'
  const label = isEmail ? '邮箱' : '手机号'
  const [target, setTarget] = useState(isEmail ? currentValue || '' : normalizePhoneContact(currentValue))
  const [targetTouched, setTargetTouched] = useState(false)
  const [code, setCode] = useState('')
  const [debugCode, setDebugCode] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [binding, setBinding] = useState(false)
  const [resendSeconds, setResendSeconds] = useState(0)
  const targetError = contactInputError(target, type)
  const showTargetError = targetTouched && Boolean(targetError)
  const validCode = /^\d{6}$/.test(code)

  const changeTarget = (value) => {
    setTarget(isEmail ? value.slice(0, EMAIL_MAX_LENGTH) : value.replace(/\D/g, '').slice(0, PHONE_LENGTH))
    setTargetTouched(true)
    setCode('')
    setDebugCode('')
    setMessage('')
    setError('')
  }

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])
  useEffect(() => {
    if (resendSeconds <= 0) return undefined
    // 只在倒计时启动/结束时创建、清理定时器，避免每秒销毁重建 interval
    const timer = window.setInterval(() => {
      setResendSeconds((current) => Math.max(0, current - 1))
    }, 1000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resendSeconds > 0])

  const sendCode = async () => {
    setTargetTouched(true)
    if (targetError) {
      return
    }
    setSending(true)
    setError('')
    setMessage('')
    setDebugCode('')
    setCode('')
    try {
      const data = await requestAccountBindCode(target.trim(), type)
      setDebugCode(data.debugCode || '')
      setMessage(data.message || '绑定验证码已生成')
      setResendSeconds(60)
    } catch (err) {
      setError(err.message || '验证码发送失败')
    } finally {
      setSending(false)
    }
  }

  const submit = async (event) => {
    event.preventDefault()
    setTargetTouched(true)
    if (targetError || !validCode) {
      setError(targetError ? '' : '请输入 6 位数字验证码')
      return
    }
    setBinding(true)
    setError('')
    try {
      const data = await bindAccountTarget(target.trim(), code, type)
      onComplete(data.user)
    } catch (err) {
      setError(err.message || '绑定失败')
    } finally {
      setBinding(false)
    }
  }

  return (
    <div className="modal-backdrop account-bind-backdrop">
      <form className="modal account-bind-modal" noValidate onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div><p className="eyebrow">账号绑定</p><h2>绑定{label}</h2></div>
          <button className="ghost-icon modal-close" type="button" aria-label="关闭绑定窗口" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body account-bind-body">
          <p className="modal-intro">登录仍使用鲲穹官方账号；绑定{label}后，可用于站内消息匹配和后续邮件/短信通知。</p>
          <label className="settings-input-field">
            <span>{label}</span>
            <input type={isEmail ? 'email' : 'tel'} inputMode={isEmail ? 'email' : 'numeric'} autoComplete={isEmail ? 'email' : 'tel-national'} maxLength={isEmail ? EMAIL_MAX_LENGTH : PHONE_LENGTH} value={target} onChange={(event) => changeTarget(event.target.value)} onBlur={() => setTargetTouched(true)} disabled={sending || binding} aria-invalid={showTargetError} aria-describedby="account-bind-target-hint" placeholder={isEmail ? 'name@example.com' : '请输入 11 位手机号'} />
          </label>
          <p id="account-bind-target-hint" className={`contact-input-hint ${showTargetError ? 'invalid' : !targetError ? 'valid' : ''}`} aria-live="polite">
            {showTargetError ? targetError : !targetError ? `${label}格式正确，验证后完成绑定` : isEmail ? '请输入完整邮箱地址，最多 160 个字符；一个邮箱只能绑定一个账号。' : '请输入 11 位中国大陆手机号；一个手机号只能绑定一个账号。'}
          </p>
          <div className="account-bind-code-row">
            <label className="settings-input-field">
              <span>验证码</span>
              <input value={code} inputMode="numeric" autoComplete="one-time-code" maxLength={6} onChange={(event) => { setCode(event.target.value.replace(/\D/g, '').slice(0, 6)); setError('') }} disabled={binding} placeholder="6 位验证码" />
            </label>
            <button className="secondary-button" type="button" onClick={sendCode} disabled={sending || binding || resendSeconds > 0 || Boolean(targetError)}>{sending ? '发送中' : resendSeconds > 0 ? `${resendSeconds}秒后重发` : debugCode ? '重新发送' : '获取验证码'}<Send size={15} /></button>
          </div>
          {debugCode && <div className="account-bind-debug"><KeyRound size={14} /> 演示验证码：<strong>{debugCode}</strong></div>}
          {message && <p className="account-bind-message">{message}</p>}
          {error && <p className="settings-form-error account-bind-error" role="alert">{error}</p>}
        </div>
        <div className="modal-footer">
          <button className="secondary-button" type="button" onClick={onClose}>取消</button>
          <button className="primary-button" type="submit" disabled={binding || sending || Boolean(targetError) || !validCode}><BadgeCheck size={15} /> {binding ? '绑定中' : '确认绑定'}</button>
        </div>
      </form>
    </div>
  )
}

export function NoticeToggle({ label, detail, checked, onChange }) {
  return (
    <div className="settings-notice-row">
      <div><strong>{label}</strong>{detail && <span>{detail}</span>}</div>
      <button className={`switch ${checked ? 'on' : ''}`} aria-label={`${checked ? '关闭' : '开启'}${label}`} aria-pressed={checked} onClick={onChange}><span /></button>
    </div>
  )
}

export function resizeAvatarFile(file) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const objectUrl = URL.createObjectURL(file)
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('头像图片无法读取'))
    }
    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      const maxSize = 512
      const scale = Math.min(1, maxSize / Math.max(image.width, image.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.width * scale))
      canvas.height = Math.max(1, Math.round(image.height * scale))
      const context = canvas.getContext('2d')
      if (!context) {
        reject(new Error('当前浏览器不支持头像压缩'))
        return
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      const dataUrl = canvas.toDataURL('image/webp', 0.86)
      if (dataUrl.length > 580000) {
        reject(new Error('头像压缩后仍然过大，请选择更小的图片'))
        return
      }
      resolve(dataUrl)
    }
    image.src = objectUrl
  })
}
