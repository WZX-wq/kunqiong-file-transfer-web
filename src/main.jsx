import React, { lazy, Suspense } from 'react'
import { loadPage, prefetchRoute } from './lib/page-loaders.js'
import { subscribeRefresh } from './lib/refresh-scheduler.js'
import { PageLoadBoundary, PageLoading } from './components/page-load-boundary.jsx'
const page = (name, component) => lazy(() => loadPage(name).then(module => ({ default: module[component] })))
const AdminPage = page('admin', 'AdminPage'), TeamPage = page('team', 'TeamPage'), WorkspacePage = page('workspace', 'WorkspacePage'), WorkspaceApp = page('app', 'WorkspaceApp')
const SharePage = page('public','SharePage'), ShareManagePage = page('public','ShareManagePage'), CollectionSubmitPage = page('public','CollectionSubmitPage'), CollectionManagePage = page('public','CollectionManagePage'), TeamInvitePage = page('public','TeamInvitePage')
import { createRoot } from 'react-dom/client'
import { LogIn, ShieldAlert, X } from 'lucide-react'
import './styles.css'
import { ACCOUNT_SESSION_EVENT, apiRequest, invalidateAccountSession } from './lib/api.js'
import { setRecordOwner } from './lib/records.js'
import { handleAppLink } from './lib/navigation.js'

// 应用根路由：按 pathname 分发到各页面/子应用。
// 各页面组件已拆到 src/pages/，工具层在 src/lib/，共享 UI 在 src/components/。
function RoutePage() {
  const route = window.location.pathname
  const publicKey = route + window.location.search
  if (route.startsWith('/admin')) return <AdminPage />
  if (route.startsWith('/team')) return <TeamPage />
  if (route.startsWith('/workspace')) return <WorkspacePage />
  if (route.startsWith('/e/')) {
    const parts = route.split('/').filter(Boolean)
    if (parts[2] === 'share') {
      // 带 token → 正常的企业分享页；
      // 不带 token（/e/<slug>/share/）→ 团队邀请链接，渲染入团落地页。
      if (parts[3]) return <SharePage key={publicKey} token={parts[3]} enterpriseSlug={parts[1]} />
      return <TeamInvitePage key={publicKey} slug={parts[1]} />
    }
    if (parts[2] === 'collect') {
      if (parts[3]) return <CollectionSubmitPage key={publicKey} token={parts[3]} enterpriseSlug={parts[1]} />
      return <TeamInvitePage key={publicKey} slug={parts[1]} />
    }
    // /e/<slug> 或 /e/<slug>/ 也视为团队邀请入口，避免复制链接时丢掉尾段就失效。
    if (parts[1]) return <TeamInvitePage key={publicKey} slug={parts[1]} />
  }
  if (route.startsWith('/share/manage/')) return <ShareManagePage key={publicKey} token={route.split('/')[3]} />
  if (route.startsWith('/share/')) return <SharePage key={publicKey} token={route.split('/')[2]} />
  if (route.startsWith('/collect/manage/')) return <CollectionManagePage key={publicKey} token={route.split('/')[3]} />
  if (route.startsWith('/collect/')) return <CollectionSubmitPage key={publicKey} token={route.split('/')[2]} />
  return <WorkspaceApp />
}

function App() {
  const [route, setRoute] = React.useState(window.location.href)
  const [sessionVersion, setSessionVersion] = React.useState(0)
  const [sessionNotice, setSessionNotice] = React.useState('')
  const [sessionNoticeCode, setSessionNoticeCode] = React.useState('')
  React.useEffect(() => {
    const changed = () => setRoute(window.location.href)
    window.addEventListener('popstate', changed)
    document.addEventListener('click', handleAppLink)
    const prefetch = event => { const target = event.target?.closest?.('a[href], [data-prefetch-route]'); if (target) prefetchRoute(target.dataset.prefetchRoute || target.getAttribute('href')) }
    document.addEventListener('pointerover', prefetch); document.addEventListener('focusin', prefetch)
    return () => { window.removeEventListener('popstate', changed); document.removeEventListener('click', handleAppLink); document.removeEventListener('pointerover', prefetch); document.removeEventListener('focusin', prefetch) }
  }, [])
  React.useEffect(() => {
    // 后台使用独立管理员 Cookie，由 AdminPage 校验；普通账号过期不应重挂后台。
    if (window.location.pathname.startsWith('/admin')) return undefined
    let userId = '', expiryTimer
    const changed = ({ detail }) => {
      userId = detail.userId
      setRecordOwner(userId)
      setSessionNoticeCode(detail.code || '')
      if (['account_session_replaced', 'account_logout_failed'].includes(detail.code)) setSessionNotice(detail.message)
      else if (userId || ['account_logout_pending', 'account_logged_out'].includes(detail.code)) setSessionNotice('')
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
    const refresh = (event) => {
      if (userId && document.visibilityState !== 'hidden') apiRequest('/api/auth/me', { force: true, authView: 'identity' }).catch(() => {})
    }
    window.addEventListener(ACCOUNT_SESSION_EVENT, changed)
    const unsubscribe = subscribeRefresh('account-identity', () => refresh())
    apiRequest('/api/auth/me', { authView: 'identity' }).catch(() => {})
    return () => {
      window.clearTimeout(expiryTimer)
      unsubscribe()
      window.removeEventListener(ACCOUNT_SESSION_EVENT, changed)
    }
  }, [])
  return <>
    <PageLoadBoundary resetKey={route + ':' + sessionVersion}><Suspense fallback={<PageLoading fullPage />}><RoutePage key={sessionVersion} /></Suspense></PageLoadBoundary>
    {sessionNotice && <div className="account-session-notice" role="alert">
      <ShieldAlert size={17} aria-hidden="true" />
      <span>{sessionNotice}</span>
      {sessionNoticeCode === 'account_logout_failed'
        ? <button type="button" className="secondary-button" onClick={() => apiRequest('/api/auth/logout', { method: 'POST' }).catch(() => {})}>重试退出</button>
        : <button type="button" className="secondary-button" onClick={() => { window.location.href = `/api/auth/login?return_to=${encodeURIComponent(window.location.href)}` }}><LogIn size={14} /> 重新登录</button>}
      <button type="button" className="ghost-icon" aria-label="关闭登录提示" onClick={() => setSessionNotice('')}><X size={16} /></button>
    </div>}
  </>
}

// Keep previously shared order links inside the account centre.
if (window.location.pathname === '/orders' || window.location.pathname === '/orders/') {
  window.history.replaceState(null, '', `/settings/orders${window.location.search}${window.location.hash}`)
}
createRoot(document.getElementById('root')).render(<App />)
