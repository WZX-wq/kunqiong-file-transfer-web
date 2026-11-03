import { apiRequest, getCachedAccountSession } from './api.js'

const loaders = {
  app: () => import('../pages/workspace.jsx'),
  admin: () => import('../pages/AdminPage.jsx'),
  team: () => import('../pages/team.jsx'),
  workspace: () => import('../pages/workspace-page.jsx'),
  public: () => import('../pages/public.jsx'),
  records: () => import('../pages/records.jsx'),
  settings: () => import('../pages/settings.jsx'),
  distribution: () => import('../pages/distribution.jsx'),
}
const pending = new Map()
export function loadPage(name) {
  if (!pending.has(name)) pending.set(name, loaders[name]().catch(error => { pending.delete(name); throw error }))
  return pending.get(name)
}
export function prefetchRoute(href) {
  if (navigator.connection?.saveData || /(^|-)2g$/.test(navigator.connection?.effectiveType || '')) return
  const url = new URL(href, window.location.origin)
  if (url.origin !== window.location.origin) return
  const path = url.pathname
  const name = path.startsWith('/admin') ? 'admin' : path.startsWith('/workspace') ? 'workspace' : path.startsWith('/team') ? 'team'
    : /^\/(e|share|collect)\//.test(path) ? 'public' : path.startsWith('/settings') ? 'settings'
      : path.startsWith('/trash') || url.searchParams.get('view') === 'records' ? 'records'
        : ['distribution', 'deliver'].includes(url.searchParams.get('view')) ? 'distribution' : 'app'
  loadPage(name).catch(() => {})
  if (!getCachedAccountSession()?.user?.id) return
  const dataUrl = name === 'workspace' ? '/api/account/workspace'
    : name === 'team' ? '/api/account/team/overview?page=1&limit=8&q='
      : name === 'records' && path !== '/trash' && !path.startsWith('/trash/')
        ? '/api/account/records?page=1&limit=8&scope=all&q=&status=all' : ''
  if (dataUrl) apiRequest(dataUrl).catch(() => {})
}

