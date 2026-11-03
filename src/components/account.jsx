import { ActionButton } from './action-button.jsx'
import React, { useEffect, useState } from 'react'
import { Building2, ChevronDown, FileText, LogOut, Settings2, UserRound } from 'lucide-react'
import { displayCompactUserName, displayUserName, maskPhone } from '../lib/format.js'
import { ACCOUNT_SESSION_EVENT, apiRequest, getCachedAccountSession, isAccountLogoutPending } from '../lib/api.js'
import { navigateApp } from '../lib/navigation.js'

export function PublicAccountActions() {
  const [user, setUser] = useState(() => getCachedAccountSession()?.user || null)
  const [loading, setLoading] = useState(() => !getCachedAccountSession())
  const [menuOpen, setMenuOpen] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    const sessionChanged = ({ detail }) => {
      setUser(detail.user || null)
      setLoading(false)
      if (!detail.userId) {
        setUser(null)
        setMenuOpen(false)
        setError('')
      } else setError('')
    }
    window.addEventListener(ACCOUNT_SESSION_EVENT, sessionChanged)
    apiRequest('/api/auth/me', { signal: controller.signal, authView: 'identity' }).then(data => {
      if (!controller.signal.aborted) setUser(data.user || null)
    }).catch(() => {}).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => {
      controller.abort()
      window.removeEventListener(ACCOUNT_SESSION_EVENT, sessionChanged)
    }
  }, [])

  useEffect(() => {
    if (!menuOpen) return undefined
    const close = () => setMenuOpen(false)
    const keydown = event => { if (event.key === 'Escape') close() }
    window.addEventListener('click', close)
    window.addEventListener('keydown', keydown)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', keydown)
    }
  }, [menuOpen])

  const logout = async () => {
    setError('')
    setMenuOpen(false)
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' })
      setUser(null)
      setMenuOpen(false)
    } catch (failure) { setError(failure.message || '退出登录失败，请重试') }
  }

  return <div className="public-account-actions">
    <AuthButton user={user} loading={loading} menuOpen={menuOpen}
      onLogin={() => { window.location.href = `/api/auth/login?return_to=${encodeURIComponent(window.location.href)}` }}
      onToggleMenu={event => { event.stopPropagation(); setMenuOpen(open => !open) }}
      onSettings={() => navigateApp('/settings/profile')}
      onOrders={() => navigateApp('/settings/orders')}
      onLogout={logout} />
    {error && <p className="public-account-error" role="alert">{error}</p>}
  </div>
}

export function UserAvatar({ user, overrideSrc = '' }) {
  const avatarSrc = overrideSrc || userAvatarSource(user)
  return avatarSrc ? <img className="user-avatar" src={avatarSrc} alt={`${displayUserName(user)}头像`} /> : <span className="user-avatar"><UserRound size={18} aria-hidden="true" /></span>
}


export function userAvatarSource(user = {}) {
  if (user.avatarSource === 'custom' && user.avatar) return user.avatar
  if (user.providerAvatar || user.avatar) return user.providerAvatar || user.avatar
  const provider = String(user.provider || '').toLowerCase()
  const label = provider.includes('qq') ? 'QQ' : provider.includes('wechat') || provider.includes('weixin') || provider.includes('微信') ? '微' : ''
  if (!label) return ''
  const background = label === 'QQ' ? '#4c9fe8' : '#20ad68'
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" rx="64" fill="${background}"/><text x="64" y="76" text-anchor="middle" fill="white" font-family="Arial,sans-serif" font-size="${label === 'QQ' ? 30 : 42}" font-weight="700">${label}</text></svg>`)}`
}

export function displayUserInitial(user = {}) { return displayUserName(user).trim().slice(0, 1).toUpperCase() || '鲲' }

export function displayUserSubtitle(user = {}) { return user.email || maskPhone(user.phone) || user.username || '已登录' }


export function AuthButton({ user, loading, menuOpen, onLogin, onToggleMenu, onSettings, onOrders, onLogout }) {
  const loggingOut = isAccountLogoutPending()
  if (!user) {
    const checking = loading && !loggingOut
    return <ActionButton className="login-button" aria-label={checking ? '检查登录状态' : '登录'} onClick={onLogin} disabled={loading || loggingOut}><UserRound size={18} /><span>{checking ? '检查登录' : '登录'}</span><ChevronDown size={14} /></ActionButton>
  }
  return (
    <div className="auth-menu-wrap">
      <ActionButton className="login-button signed-in" aria-label="个人中心" onClick={onToggleMenu} aria-haspopup="menu" aria-expanded={menuOpen}>
        <UserAvatar user={user} />
        <span>{displayCompactUserName(user)}</span>
        <ChevronDown size={14} />
      </ActionButton>
      {menuOpen && (
        <div className="auth-menu" role="menu" onClick={(event) => event.stopPropagation()}>
          <div className="auth-menu-profile">
            <UserAvatar user={user} />
            <div><strong>{displayUserName(user)}</strong><span>{displayUserSubtitle(user)}</span></div>
          </div>
          <ActionButton role="menuitem" onClick={onSettings}><Settings2 size={14} /> 账户设置</ActionButton>
          <ActionButton role="menuitem" onClick={onOrders}><FileText size={14} /> 我的订单</ActionButton>
          <ActionButton className="mobile-workspace-link" role="menuitem" onClick={() => navigateApp('/workspace')}><Building2 size={14} /> 会员与团队空间</ActionButton>
          <ActionButton role="menuitem" onClick={onLogout}><LogOut size={14} /> 退出登录</ActionButton>
        </div>
      )}
    </div>
  )
}
