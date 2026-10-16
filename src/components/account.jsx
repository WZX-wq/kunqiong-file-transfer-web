import React, { useEffect, useState } from 'react'
import { Building2, ChevronDown, FileText, LogOut, Settings2, UserRound } from 'lucide-react'
import { displayUserName, maskPhone } from '../lib/format.js'
import { ACCOUNT_SESSION_EVENT, apiRequest } from '../lib/api.js'

export function PublicAccountActions() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    const sessionChanged = ({ detail }) => {
      if (!detail.userId) { setUser(null); setMenuOpen(false) }
    }
    window.addEventListener(ACCOUNT_SESSION_EVENT, sessionChanged)
    apiRequest('/api/auth/me', { signal: controller.signal }).then(data => {
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
      onSettings={() => { window.location.href = '/settings/profile' }}
      onOrders={() => { window.location.href = '/settings/orders' }}
      onLogout={logout} />
    {error && <p className="public-account-error" role="alert">{error}</p>}
  </div>
}

export function UserAvatar({ user, overrideSrc = '' }) {
  const avatarSrc = overrideSrc || userAvatarSource(user)
  return avatarSrc ? <img className="user-avatar" src={avatarSrc} alt={`${displayUserName(user)}头像`} /> : <span className="user-avatar">{displayUserInitial(user)}</span>
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
  if (!user) {
    return <button className="login-button" aria-label={loading ? '检查登录状态' : '登录'} onClick={onLogin} disabled={loading}><UserRound size={18} /><span>{loading ? '检查登录' : '登录'}</span><ChevronDown size={14} /></button>
  }
  return (
    <div className="auth-menu-wrap">
      <button className="login-button signed-in" aria-label="个人中心" onClick={onToggleMenu} aria-haspopup="menu" aria-expanded={menuOpen}>
        <UserAvatar user={user} />
        <span>{displayUserName(user)}</span>
        <ChevronDown size={14} />
      </button>
      {menuOpen && (
        <div className="auth-menu" role="menu" onClick={(event) => event.stopPropagation()}>
          <div className="auth-menu-profile">
            <UserAvatar user={user} />
            <div><strong>{displayUserName(user)}</strong><span>{displayUserSubtitle(user)}</span></div>
          </div>
          <button role="menuitem" onClick={onSettings}><Settings2 size={14} /> 账户设置</button>
          <button role="menuitem" onClick={onOrders}><FileText size={14} /> 我的订单</button>
          <button className="mobile-workspace-link" role="menuitem" onClick={() => { window.location.href = '/workspace' }}><Building2 size={14} /> 会员与团队空间</button>
          <button role="menuitem" onClick={onLogout}><LogOut size={14} /> 退出登录</button>
        </div>
      )}
    </div>
  )
}
