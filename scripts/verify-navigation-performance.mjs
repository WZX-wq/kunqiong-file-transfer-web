import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { JSDOM, VirtualConsole } from 'jsdom'
import { build } from 'vite'

let passed = 0
const check = (label, value) => { assert.ok(value, label); passed++; console.log(`PASS ${label}`) }
async function waitFor(fn, label) {
  for (let i = 0; i < 250; i++) { if (fn()) return; await delay(10) }
  assert.fail(label)
}

// Exercise the real request coordinator, including overlapping callers and late responses.
const apiDom = new JSDOM('', { url: 'http://fixture.local' })
const original = { window: globalThis.window, CustomEvent: globalThis.CustomEvent, fetch: globalThis.fetch, now: Date.now }
globalThis.window = apiDom.window
globalThis.CustomEvent = apiDom.window.CustomEvent
try {
  const api = await import('../src/lib/api.js')
  let release, calls = 0, currentUser = 'alice', failure = false, unauthorized = false, holdWorkspace = false, releaseWorkspace, holdIdentity = false, releaseIdentity
  let clock = original.now()
  Date.now = () => clock
  globalThis.fetch = async (url, options = {}) => {
    calls++
    const data = url === '/api/auth/me' ? { user: currentUser ? { id: currentUser, nickname: currentUser } : null }
      : url === '/api/auth/profile' ? { user: { id: currentUser, nickname: 'Updated name' } }
        : { owner: currentUser, ok: true }
    if (url === '/api/auth/me' && calls === 1) await new Promise(resolve => { release = resolve })
    if (url === '/api/auth/me' && holdIdentity) await new Promise(resolve => { releaseIdentity = resolve })
    if (url === '/api/account/workspace' && holdWorkspace) await new Promise(resolve => { releaseWorkspace = resolve })
    return new Response(JSON.stringify(unauthorized ? { message: 'session expired' } : failure ? { message: 'temporary failure' } : data), { status: unauthorized ? 401 : failure ? 503 : 200 })
  }
  const controller = new AbortController()
  const cancelled = api.apiRequest('/api/auth/me', { signal: controller.signal }).catch(error => error.name)
  const one = api.apiRequest('/api/auth/me')
  const two = api.apiRequest('/api/auth/me')
  controller.abort()
  release()
  check('one cancelled subscriber does not cancel the shared request', await cancelled === 'AbortError' && (await one).user.id === 'alice' && (await two).user.id === 'alice')
  check('three overlapping identity consumers send one request', calls === 1)
  await api.apiRequest('/api/auth/me')
  check('fresh identity is reused on navigation', calls === 1)
  await api.apiRequest('/api/account/workspace')
  check('workspace snapshot belongs to the current session', api.getCachedAccountData('/api/account/workspace').owner === 'alice')
  clock += 31000
  failure = true
  await assert.rejects(api.apiRequest('/api/auth/me'), /temporary failure/)
  check('temporary network error preserves confirmed identity', api.getCachedAccountSession().user.id === 'alice')
  failure = false
  await api.apiRequest('/api/auth/profile', { method: 'PATCH', body: '{}' })
  check('profile mutation publishes the updated identity', api.getCachedAccountSession().user.nickname === 'Updated name')
  check('account mutation invalidates workspace data', api.getCachedAccountData('/api/account/workspace') === null)
  holdWorkspace = true
  const late = api.apiRequest('/api/account/workspace').catch(error => error.status)
  await waitFor(() => releaseWorkspace, 'workspace request pending')
  api.invalidateAccountSession()
  releaseWorkspace()
  check('late response after logout is rejected', await late === 401)
  check('logout clears both identity and workspace snapshots', !api.getCachedAccountSession() && !api.getCachedAccountData('/api/account/workspace'))
  holdWorkspace = false
  currentUser = 'bob'
  await api.apiRequest('/api/auth/me')
  check('next account never receives the previous workspace snapshot', api.getCachedAccountSession().user.id === 'bob' && !api.getCachedAccountData('/api/account/workspace'))
  const before = calls
  const alreadyCancelled = new AbortController(); alreadyCancelled.abort()
  await assert.rejects(api.apiRequest('/api/auth/me', { force: true, signal: alreadyCancelled.signal }), { name: 'AbortError' })
  check('already cancelled consumers never start a request', calls === before)
  holdIdentity = true
  const staleIdentity = api.apiRequest('/api/auth/me', { force: true })
  await waitFor(() => releaseIdentity, 'identity refresh pending')
  await api.apiRequest('/api/auth/profile', { method: 'PATCH', body: '{}' })
  releaseIdentity(); holdIdentity = false
  check('slow identity response cannot overwrite a newly saved profile', (await staleIdentity).user.nickname === 'Updated name' && api.getCachedAccountSession().user.nickname === 'Updated name')
  await api.apiRequest('/api/account/workspace')
  const beforeForce = calls
  await api.apiRequest('/api/account/workspace', { force: true })
  check('explicit workspace refresh bypasses a fresh cache', calls === beforeForce + 1)
  const recordPage = '/api/account/records?page=1&limit=8&scope=all&q=&status=all'
  const teamPage = '/api/account/team/overview?page=1&limit=8&q='
  const pageReadsBefore = calls
  for (const url of [recordPage, teamPage]) { await api.apiRequest(url); await api.apiRequest(url) }
  check('revisiting record and team pages reuses the exact account query', calls === pageReadsBefore + 2 && api.getCachedAccountData(recordPage)?.owner === 'bob')
  await api.apiRequest('/api/account/records?page=2&limit=8')
  check('another page never reuses the first page cache', calls === pageReadsBefore + 3)
  await api.apiRequest('/api/auth/profile', { method: 'PATCH', body: '{}' })
  check('successful writes invalidate all cached list pages', !api.getCachedAccountData(recordPage) && !api.getCachedAccountData(teamPage))
  holdWorkspace = true; releaseWorkspace = null
  const oldWorkspace = api.apiRequest('/api/account/workspace', { force: true })
  await waitFor(() => releaseWorkspace, 'old workspace read waits before mutation')
  await api.apiRequest('/api/auth/profile', { method: 'PATCH', body: '{}' })
  releaseWorkspace(); holdWorkspace = false
  await oldWorkspace
  check('a late pre-mutation response cannot refill an invalidated snapshot', !api.getCachedAccountData('/api/account/workspace'))
  await api.apiRequest(recordPage)
  clock += 31000
  holdIdentity = true; releaseIdentity = null
  const pageSession = await api.getPageAccountSession()
  await waitFor(() => releaseIdentity, 'background identity revalidation starts')
  check('confirmed page identity is available before slow revalidation finishes', pageSession.user.id === 'bob')
  releaseIdentity(); holdIdentity = false
  await delay(0)
  clock += 5 * 60 * 1000
  check('old display snapshots expire rather than remaining forever', !api.getCachedAccountData(recordPage))
  unauthorized = true
  await assert.rejects(api.apiRequest('/api/account/messages'), error => error.status === 401)
  check('protected API 401 clears identity and workspace snapshots', !api.getCachedAccountSession() && !api.getCachedAccountData('/api/account/workspace'))
} finally {
  Date.now = original.now
  globalThis.window = original.window
  globalThis.CustomEvent = original.CustomEvent
  globalThis.fetch = original.fetch
  apiDom.window.close()
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bundle = await build({ root, configFile: false, logLevel: 'silent', worker: { format: 'es' }, build: { write: false, minify: false, rollupOptions: { input: path.join(root, 'src/main.jsx'), output: { format: 'iife', inlineDynamicImports: true } } } })
const code = bundle.output.find(item => item.type === 'chunk').code
const errors = [], calls = [], virtualConsole = new VirtualConsole()
virtualConsole.on('jsdomError', error => errors.push(error))
const dom = new JSDOM('<div id="root"></div>', { url: 'http://fixture.local/', pretendToBeVisual: true, runScripts: 'outside-only', virtualConsole })
const { window } = dom, { document } = window
let currentUser = 'alice', workspaceHold = null, authHold = null, logoutHold = null, temporaryCollectionFailures = 0
const plan = { id: 'free', label: '基础版', totalBytes: 1024 ** 3, features: [] }
window.fetch = async (url, options = {}) => {
  calls.push({ url, method: options.method || 'GET', authView: new Headers(options.headers).get('X-Kunqiong-Auth-View') })
  if (url === '/api/auth/me' && authHold) await authHold.promise
  if (url === '/api/account/workspace' && workspaceHold) await workspaceHold.promise
  const user = currentUser ? { id: currentUser, nickname: currentUser, plan, notificationSettings: {}, fileCleanup: { enabled: false, days: 3 } } : null
  let data = {}
  if (url === '/api/auth/me') data = { user }
  else if (url === '/api/runtime-config') data = { defaultShareDays: 3 }
  else if (url === '/api/account/messages') data = { messages: [], settings: {} }
  else if (url === '/api/account/workspace') data = { plan, plans: [plan], capacity: { totalBytes: 1024 ** 3 }, orders: [], organization: null }
  else if (url === '/api/account/upgrade-pricing') data = { source: 'local', pricing: {} }
  else if (url.startsWith('/api/account/records')) data = { records: [] }
  else if (url.startsWith('/api/collections/manage/')) {
    const token = url.split('/').at(-1)
    if (token === 'owner-switch' && currentUser !== 'bob') return new Response(JSON.stringify({ message: '仅任务所有者可以管理该收集任务', code: 'collection_owner_required' }), { status: 403 })
    if (token === 'temporary' && temporaryCollectionFailures++ < 2) return new Response(JSON.stringify({ message: '数据库暂时繁忙，请稍后重试', code: 'DATABASE_QUERY_TIMEOUT' }), { status: 503 })
    data = { collection: { id: token, token: 'public-' + token, manageToken: token, title: '任务 ' + token, status: 'active', submissions: [], materials: [], customFields: [] } }
  }
  else if (url === '/api/collections/public-fixture') data = { collection: { id: 'collection', token: 'public-fixture', title: '公开收集任务', status: 'active', materials: [], customFields: [], allowedTypes: ['全部格式'], maxFileSizeMb: 500 } }
  else if (url === '/api/auth/logout') { if (logoutHold) await logoutHold.promise; currentUser = ''; data = { ok: true } }
  return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
}
const count = url => calls.filter(call => call.url === url || call.url.startsWith(url + '?')).length
const button = text => [...document.querySelectorAll('button')].find(node => node.textContent.trim() === text || node.getAttribute('aria-label') === text)
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const openProfile = async () => {
  document.querySelector('.topbar [aria-label="个人中心"]').click()
  await waitFor(() => button('账户设置'), 'account menu opened')
  button('账户设置').click()
  await waitFor(() => document.querySelector('.settings-page'), 'profile mounted')
}
try {
  window.eval(code)
  await waitFor(() => document.querySelector('.topbar [aria-label="个人中心"]') && count('/api/runtime-config') === 1, 'homepage authenticated')
  await delay(60)
  check('homepage sends one identity request', count('/api/auth/me') === 1)
  check('homepage sends one runtime-config request', count('/api/runtime-config') === 1)
  check('homepage does not read or rewrite the entire record list', count('/api/account/records') === 0)
  for (const item of [
    { label: 'Ctrl-click', href: '/workspace', init: { ctrlKey: true } },
    { label: 'new tab', href: '/workspace', target: '_blank' },
    { label: 'download', href: '/', download: true },
    { label: 'external link', href: 'https://example.test/' },
    { label: 'login redirect', href: '/api/auth/login' },
    { label: 'manual', href: '/user-manual.html' },
    { label: 'page anchor', href: '/#footer' },
  ]) {
    const link = document.createElement('a'); link.href = item.href
    if (item.target) link.target = item.target
    if (item.download) link.setAttribute('download', '')
    document.body.append(link)
    let intercepted = true
    const observe = event => { intercepted = event.defaultPrevented; event.preventDefault() }
    document.addEventListener('click', observe)
    link.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...item.init }))
    document.removeEventListener('click', observe); link.remove()
    check(`${item.label} keeps native link behavior`, !intercepted && window.location.pathname === '/')
  }
  button('会员与团队').click()
  await waitFor(() => document.querySelector('.workspace-page'), 'membership mounted')
  check('homepage to membership uses in-app navigation', window.location.pathname === '/workspace')
  check('membership and its header share the confirmed identity', count('/api/auth/me') === 1 && !document.body.textContent.includes('检查登录'))
  await openProfile()
  check('membership to profile reuses identity without a blocking loader', window.location.pathname === '/settings/profile' && !document.body.textContent.includes('正在加载账户信息') && count('/api/auth/me') === 2 && calls.filter(call => call.authView === 'identity').length === 1 && calls.filter(call => call.authView === 'full').length === 1)
  check('profile does not synchronize all file records', count('/api/account/records') === 0)
  window.history.back()
  await waitFor(() => window.location.pathname === '/workspace' && document.querySelector('.workspace-page'), 'history restores membership')
  check('returning to membership reuses its existing data', count('/api/account/workspace') === 1 && !document.body.textContent.includes('正在打开团队空间'))
  document.querySelector('a.nav-item[href="/"]').click()
  await waitFor(() => window.location.pathname === '/' && button('会员与团队'), 'native anchor uses React navigation')
  check('returning home retains identity and runtime config', count('/api/auth/me') === 2 && count('/api/runtime-config') === 1)
  const realNow = window.Date.now
  window.Date.now = () => realNow() + 31000
  authHold = gate(); workspaceHold = gate()
  button('会员与团队').click()
  await waitFor(() => count('/api/auth/me') === 3 && count('/api/account/workspace') === 2, 'stale auth and workspace refresh concurrently')
  check('stale membership data stays visible during background refresh', !!document.querySelector('.workspace-page') && !document.body.textContent.includes('正在打开团队空间') && !document.body.textContent.includes('检查登录'))
  authHold.resolve(); workspaceHold.resolve(); authHold = null; workspaceHold = null
  await delay(50)
  window.Date.now = realNow
  await openProfile()
  button('收发记录').click()
  await waitFor(() => count('/api/account/records') > 0, 'record list is fetched when requested')
  check('record list remains available on demand', count('/api/account/records') > 0)
  const identityBeforeDetails = count('/api/auth/me')
  const openInternalLink = href => { const link = document.createElement('a'); link.href = href; document.body.append(link); link.click(); link.remove() }
  openInternalLink('/collect/manage/task-a')
  await waitFor(() => document.body.textContent.includes('任务 task-a'), 'collection management detail mounted')
  check('collection detail opens inside the app without checking login again', window.location.pathname === '/collect/manage/task-a' && count('/api/auth/me') === identityBeforeDetails && !document.body.textContent.includes('检查登录'))
  openInternalLink('/collect/manage/task-b')
  await waitFor(() => document.body.textContent.includes('任务 task-b'), 'second collection detail mounted')
  check('changing collection tokens resets the previous detail state', !document.body.textContent.includes('任务 task-a'))
  openInternalLink('/collect/manage/temporary')
  await waitFor(() => document.body.textContent.includes('收集任务暂时加载失败'), 'transient read retries once then shows recoverable error')
  check('database failure is not labelled an invalid management link', !document.body.textContent.includes('管理链接不可用') && count('/api/collections/manage/temporary') === 2)
  button('重新加载').click()
  await waitFor(() => document.body.textContent.includes('任务 temporary'), 'manual retry recovers the same collection page')
  check('retry clears the error and restores management data', !document.body.textContent.includes('数据库暂时繁忙'))
  openInternalLink('/collect/manage/owner-switch')
  await waitFor(() => document.body.textContent.includes('仅任务所有者'), 'wrong account sees an ownership denial')
  currentUser = 'bob'
  window.dispatchEvent(new window.CustomEvent('kunqiong:account-session', { detail: { userId: 'bob', previousId: 'alice', user: { id: 'bob', nickname: 'bob' } } }))
  await waitFor(() => document.body.textContent.includes('任务 owner-switch'), 'switching to owner clears old permission error')
  check('owner login reloads the resource without leaving the failed page', !document.body.textContent.includes('仅任务所有者') && count('/api/collections/manage/owner-switch') === 2)
  currentUser = 'alice'
  window.dispatchEvent(new window.CustomEvent('kunqiong:account-session', { detail: { userId: 'alice', previousId: 'bob', user: { id: 'alice', nickname: 'alice' } } }))
  await waitFor(() => document.body.textContent.includes('仅任务所有者'), 'switching away from owner removes private task data')
  check('switching away from owner removes previously loaded private files', !document.body.textContent.includes('任务 owner-switch'))
  openInternalLink('/collect/public-fixture')
  await waitFor(() => document.body.textContent.includes('公开收集任务'), 'public collection submission detail mounted')
  check('public collection details reuse the same identity without another auth view', count('/api/auth/me') === identityBeforeDetails && !document.body.textContent.includes('检查登录') && !document.querySelector('#collection-submitter-name'))
  document.querySelector('.public-main-nav a[href="/?view=records"]').click()
  await waitFor(() => document.querySelector('.records-page'), 'return from public detail to records')
  check('returning from detail keeps identity visible after background record synchronization', !document.body.textContent.includes('检查登录') && calls.filter(call => call.url === '/api/auth/me').slice(identityBeforeDetails).every(call => call.authView === 'identity'))
  document.querySelector('.topbar [aria-label="个人中心"]').click()
  await waitFor(() => button('退出登录'), 'logout menu opened')
  logoutHold = gate()
  button('退出登录').click()
  await waitFor(() => document.querySelector('.topbar [aria-label="登录"]'), 'pending logout clears private header before response')
  check('slow logout immediately shows the anonymous header without a progress notice', !document.body.textContent.includes('alice') && !document.body.textContent.includes('正在退出') && !document.querySelector('.account-session-notice') && document.querySelector('.topbar [aria-label="登录"]').disabled)
  logoutHold.resolve(); logoutHold = null
  await waitFor(() => document.querySelector('.topbar [aria-label="登录"]')?.disabled === false, 'logout completes revocation before login is enabled')
  button('会员与团队').click()
  await waitFor(() => document.body.textContent.includes('登录后使用团队空间'), 'logout clears member data')
  check('logout removes private membership state across navigation', !document.querySelector('.workspace-page') && !document.body.textContent.includes('alice'))
  check('navigation has no browser or React runtime errors', errors.length === 0)
} finally { dom.window.close() }
console.log(`Navigation performance and session isolation: ${passed} passed`)
