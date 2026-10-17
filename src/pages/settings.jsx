import { useSerializedPreference } from '../lib/serialized-preference.js'
import React from 'react'
import { useEffect, useRef, useState } from 'react'
import { SETTINGS_NAV_ITEMS } from '../lib/constants.js'
import { bindAccountTarget, normalizeFileCleanupSettings, normalizeNoticeSettings, requestAccountBindCode, saveCloudFileCleanupSettings, saveCloudNoticeSettings } from '../lib/records.js'
import { ArrowLeft, BadgeCheck, Building2, Check, CheckCircle2, ChevronRight, HardDrive, ImageIcon, KeyRound, RotateCcw, Save, Send, ShieldCheck, Trash2, UserRound, Users, X } from 'lucide-react'
import { UserAvatar, displayUserSubtitle } from '../components/ui.jsx'
import { displayUserName, formatBytes, formatDate, formatPlanPrice, maskPhone, planDaysRemaining } from '../lib/format.js'
import { useRemotePlanPricing } from '../hooks.js'
import { mergePlanPricing } from '../lib/api.js'
import { contactInputError, EMAIL_MAX_LENGTH, normalizePhoneContact, PHONE_LENGTH } from '../../server/lib/contact-input.js'
import { OrdersPanel } from './orders.jsx'

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

  return (
    <section className="settings-page">
      <div className="settings-layout">
        <aside className="settings-sidebar">
          <div className="settings-user-card">
            <UserAvatar user={user} />
            <strong>{displayUserName(user)}</strong>
            <span>{displayUserSubtitle(user)}</span>
            <div className="settings-account-line"><CheckCircle2 size={14} /> 鲲穹账号已连接</div>
          </div>
          <nav className="settings-nav" aria-label="账户设置">
            {SETTINGS_NAV_ITEMS.map(({ key, label, icon: Icon, path }) => (
              <button key={key} className={section === key ? 'active' : ''} aria-current={section === key ? 'page' : undefined} onClick={() => { if (section !== key) onNavigateSection?.(path) }}>
                <Icon size={17} />
                <span>{label}</span>
                <ChevronRight size={15} />
              </button>
            ))}
          </nav>
        </aside>

        <div className="settings-panel">
          {section === 'orders' && <><SettingsPanelHeader eyebrow="账户设置" title="我的订单" detail="查询会员套餐订单和支付状态。" onBack={onBack} /><OrdersPanel user={user} onLogin={onLogin} /></>}
          {section === 'profile' && (
            <>
              <SettingsPanelHeader eyebrow="账户设置" title="个人资料" detail="管理在鲲穹文件传输中展示的账户信息。" onBack={onBack} />
              <div className="settings-form">
                <div className="settings-profile-row">
                  <div className="settings-row-label"><strong>头像</strong><span>上传后仅在当前鲲穹账户中使用</span></div>
                  <div className="settings-avatar-actions">
                    <UserAvatar user={user} overrideSrc={avatarPreview} />
                    <input ref={avatarInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={saveAvatarFile} />
                    <button className="settings-row-action" onClick={() => avatarInputRef.current?.click()} disabled={savingAvatar}>{savingAvatar ? '保存中' : <><ImageIcon size={14} /> 上传头像</>}</button>
                  </div>
                </div>
                {avatarError && <p className="settings-form-error">{avatarError}</p>}
                <div className="settings-avatar-note"><span>未上传时默认显示鲲穹账号的登录头像。</span>{user.avatarSource === 'custom' && <button className="settings-row-action" onClick={restoreProviderAvatar} disabled={savingAvatar}><RotateCcw size={14} /> 恢复登录头像</button>}</div>
                <form className="settings-profile-edit" onSubmit={saveNickname}>
                  <label className="settings-input-field">
                    <span>昵称</span>
                    <input value={nickname} maxLength={40} onChange={(event) => setNickname(event.target.value)} placeholder="请输入昵称" />
                  </label>
                  <button className="primary-button" type="submit" disabled={savingProfile || !nickname.trim()}>{savingProfile ? '保存中' : <><Save size={15} /> 保存昵称</>}</button>
                </form>
                {profileError && <p className="settings-form-error">{profileError}</p>}
                <SettingsInfoRow label="登录账号" value={user.username || user.id || '未设置'} />
                <SettingsInfoRow label="邮箱" value={user.email || '未绑定'} />
                <SettingsInfoRow label="手机号" value={user.phone ? maskPhone(user.phone) : '未绑定'} />
                <AccountCapacityCard user={user} />
                <button className="workspace-entry-button" onClick={onOpenWorkspace}><Building2 size={15} /> 查看会员与团队空间 <ChevronRight size={15} /></button>
                <AccountBenefits benefits={user.benefits?.filter((benefit) => benefit.label !== '账号容量' && !(user.teamEntitlement?.organizationName && benefit.label === '团队空间'))} />
              </div>
            </>
          )}

          {section === 'security' && (
            <>
              <SettingsPanelHeader eyebrow="账户设置" title="账号与安全" detail="查看当前登录账户和会话安全状态。" onBack={onBack} />
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
              <SettingsPanelHeader eyebrow="账户设置" title="消息通知" detail="选择你希望收到的账户和文件动态提醒，修改会自动保存。" onBack={onBack} />
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
              <SettingsPanelHeader eyebrow="账户设置" title="文件清理" detail="控制已过期文件是否自动删除，清理后才会释放账号容量。" onBack={onBack} />
              <div className="settings-notice-group file-cleanup-settings">
                <h2><Trash2 size={16} /> 过期文件自动清理</h2>
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

export function SettingsPanelHeader({ eyebrow, title, detail, onBack }) {
  return <div className="settings-panel-header"><div className="settings-panel-header-top"><p className="eyebrow">{eyebrow}</p><button className="settings-back-button" onClick={onBack}><ArrowLeft size={15} /> 返回</button></div><h1>{title}</h1><p>{detail}</p></div>
}

export function SettingsInfoRow({ label, value }) {
  return <div className="settings-info-row"><strong>{label}</strong><span>{value}</span></div>
}

export function AccountCapacityCard({ user }) {
  // 设置页套餐价与升级弹窗/工作台同源（远端主站实价），拉不到时回落本地配置价
  const remotePricing = useRemotePlanPricing(user?.id)
  const capacity = user?.capacity || {}
  const plan = user?.plan || {}
  const planDisplay = mergePlanPricing(plan, remotePricing)
  const usedBytes = Number(capacity.usedBytes || 0)
  const totalBytes = Number(capacity.totalBytes || 0)
  const ratio = totalBytes ? Math.min(100, Math.round((usedBytes / totalBytes) * 100)) : 0
  const validity = plan.id === 'free' ? '长期免费' : plan.permanent ? '永久有效' : user.planExpiresAt ? `有效至 ${formatDate(user.planExpiresAt)} · 剩余${planDaysRemaining(user.planExpiresAt)}天` : '长期有效'
  return (
    <div className="account-capacity-card">
      <div>
        <span>账号容量 · {plan.label || '基础版'}</span>
        <strong>{usedBytes ? formatBytes(usedBytes) : '0 KB'} / {totalBytes ? formatBytes(totalBytes) : '不限容量'}</strong>
      </div>
      <div className="capacity-bar" aria-label={`容量已使用 ${ratio}%`}><span style={{ width: `${ratio}%` }} /></div>
      <div className="capacity-meta">
        <span>{capacity.shareCount || 0} 个分享</span>
        <span>{capacity.collectionCount || 0} 个收集任务</span>
        <span>{capacity.fileCount || 0} 个文件</span>
      </div>
      <div className="account-plan-meta"><strong>{plan.label || '基础版'}</strong><span>{validity}</span><span>{formatPlanPrice(planDisplay)}</span></div>
      {user?.teamEntitlement?.organizationName && (
        <p className="account-team-hint">
          <Users size={13} />
          {user.teamEntitlement.role === 'owner'
            ? `你是「${user.teamEntitlement.organizationName}」的所有者，团队使用${user.teamEntitlement.teamPlanLabel || '团队套餐'}，团队总容量 ${formatBytes(user.teamEntitlement.teamSpaceBytes || 0)}；上方是你的个人套餐容量`
            : `已加入「${user.teamEntitlement.organizationName}」，共享${user.teamEntitlement.teamPlanLabel || '团队套餐'}团队空间 ${formatBytes(user.teamEntitlement.teamSpaceBytes || 0)}；上方是你的个人套餐容量`}
        </p>
      )}
    </div>
  )
}

export function AccountBenefits({ benefits = [] }) {
  if (!benefits.length) return null
  return (
    <div className="account-benefits">
      {benefits.map((benefit) => (
        <div className={benefit.enabled ? '' : 'disabled'} key={benefit.label}>
          <CheckCircle2 size={15} />
          <span><strong>{benefit.label}</strong><small>{benefit.detail}</small></span>
        </div>
      ))}
    </div>
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
