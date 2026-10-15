import React from 'react'
import { createRoot } from 'react-dom/client'
import { AdminPage } from './pages/AdminPage.jsx'
import { TeamPage } from './pages/team.jsx'
import { WorkspacePage } from './pages/workspace-page.jsx'
import { SharePage, ShareManagePage, CollectionSubmitPage, CollectionManagePage, TeamInvitePage } from './pages/public.jsx'
import { WorkspaceApp } from './pages/workspace.jsx'
import './styles.css'
import { ACCOUNT_SESSION_EVENT, apiRequest, invalidateAccountSession } from './lib/api.js'
import { setRecordOwner } from './lib/records.js'

// 应用根路由：按 pathname 分发到各页面/子应用。
// 各页面组件已拆到 src/pages/，工具层在 src/lib/，共享 UI 在 src/components/。
function RoutePage() {
  const route = window.location.pathname
  if (route.startsWith('/admin')) return <AdminPage />
  if (route.startsWith('/team')) return <TeamPage />
  if (route.startsWith('/workspace')) return <WorkspacePage />
  if (route.startsWith('/e/')) {
    const parts = route.split('/').filter(Boolean)
    if (parts[2] === 'share') {
      // 带 token → 正常的企业分享页；
      // 不带 token（/e/<slug>/share/）→ 团队邀请链接，渲染入团落地页。
      if (parts[3]) return <SharePage token={parts[3]} enterpriseSlug={parts[1]} />
      return <TeamInvitePage slug={parts[1]} />
    }
    if (parts[2] === 'collect') {
      if (parts[3]) return <CollectionSubmitPage token={parts[3]} enterpriseSlug={parts[1]} />
      return <TeamInvitePage slug={parts[1]} />
    }
    // /e/<slug> 或 /e/<slug>/ 也视为团队邀请入口，避免复制链接时丢掉尾段就失效。
    if (parts[1]) return <TeamInvitePage slug={parts[1]} />
  }
  if (route.startsWith('/share/manage/')) return <ShareManagePage token={route.split('/')[3]} />
  if (route.startsWith('/share/')) return <SharePage token={route.split('/')[2]} />
  if (route.startsWith('/collect/manage/')) return <CollectionManagePage token={route.split('/')[3]} />
  if (route.startsWith('/collect/')) return <CollectionSubmitPage token={route.split('/')[2]} />
  return <WorkspaceApp />
}

function App() {
  const [sessionVersion, setSessionVersion] = React.useState(0)
  React.useEffect(() => {
    // 后台使用独立管理员 Cookie，由 AdminPage 校验；普通账号过期不应重挂后台。
    if (window.location.pathname.startsWith('/admin')) return undefined
    let userId = '', expiryTimer
    const changed = ({ detail }) => {
      userId = detail.userId
      setRecordOwner(userId)
      window.clearTimeout(expiryTimer)
      if (userId && detail.expiresAt) {
        const remaining = new Date(detail.expiresAt).getTime() - Date.now()
        if (Number.isFinite(remaining)) expiryTimer = window.setTimeout(() => {
          if (Date.now() >= new Date(detail.expiresAt).getTime()) invalidateAccountSession()
          else refresh()
        }, Math.max(0, Math.min(remaining, 2147483647)))
      }
      // 重挂页面会同时清除资料、消息、团队数据、分享预览和未完成的异步页面状态。
      if (detail.previousId && detail.previousId !== userId) setSessionVersion(version => version + 1)
    }
    const refresh = () => {
      if (userId && document.visibilityState !== 'hidden') apiRequest('/api/auth/me').catch(() => {})
    }
    window.addEventListener(ACCOUNT_SESSION_EVENT, changed)
    window.addEventListener('focus', refresh)
    window.addEventListener('popstate', refresh)
    document.addEventListener('visibilitychange', refresh)
    const interval = window.setInterval(refresh, 30000)
    apiRequest('/api/auth/me').catch(() => {})
    return () => {
      window.clearTimeout(expiryTimer)
      window.clearInterval(interval)
      window.removeEventListener(ACCOUNT_SESSION_EVENT, changed)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('popstate', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
  return <RoutePage key={sessionVersion} />
}

// Keep previously shared order links inside the account centre.
if (window.location.pathname === '/orders' || window.location.pathname === '/orders/') {
  window.history.replaceState(null, '', `/settings/orders${window.location.search}${window.location.hash}`)
}
createRoot(document.getElementById('root')).render(<App />)
