import React from 'react'
import { createRoot } from 'react-dom/client'
import { AdminPage } from './pages/AdminPage.jsx'
import { TeamPage } from './pages/team.jsx'
import { WorkspacePage } from './pages/workspace-page.jsx'
import { SharePage, ShareManagePage, CollectionSubmitPage, CollectionManagePage, TeamInvitePage } from './pages/public.jsx'
import { WorkspaceApp } from './pages/workspace.jsx'
import './styles.css'

// 应用根路由：按 pathname 分发到各页面/子应用。
// 各页面组件已拆到 src/pages/，工具层在 src/lib/，共享 UI 在 src/components/。
function App() {
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

createRoot(document.getElementById('root')).render(<App />)
