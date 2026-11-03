import assert from 'node:assert/strict'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { JSDOM, VirtualConsole } from 'jsdom'
import { build } from 'vite'

const root = path.resolve(import.meta.dirname, '..')
const bundle = await build({ root, configFile: false, logLevel: 'silent', worker: { format: 'es' }, build: {
  write: false, minify: false, rollupOptions: { input: path.join(root, 'src/main.jsx'), output: { format: 'iife', inlineDynamicImports: true } },
} })
const code = bundle.output.find(item => item.type === 'chunk').code
let passed = 0
function check(label, value) { assert.ok(value, label); passed++; console.log('PASS ' + label) }
async function waitFor(fn, label) {
  for (let attempt = 0; attempt < 300; attempt++) { if (fn()) return; await delay(10) }
  assert.fail(label)
}
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const stale = { id: 'my_collections:collection:guest-manage', kind: 'collection', scope: 'my_collections',
  name: '旧账号本机任务', collectionToken: 'guest-task', manageToken: 'guest-manage', status: 'active' }
const task = { id: 'owned-task', token: 'owned-task', manageToken: 'owned-manage', title: '数据库里的当前任务',
  status: 'active', submissionCount: 4, fileCount: 2, usedBytes: 9, allowedTypes: ['全部格式'], maxFileSizeMb: 500 }
function mount({ user = null, authGate = null, guestGate = null, listGate = null, tasks = [] } = {}) {
  const errors = [], calls = [], vc = new VirtualConsole()
  vc.on('jsdomError', error => errors.push(error))
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://fixture.local/?view=collect', pretendToBeVisual: true, runScripts: 'outside-only', virtualConsole: vc })
  const { window } = dom
  const storage = window.localStorage
  storage.setItem('kunqiong-records', JSON.stringify([stale]))
  storage.setItem('kunqiong-records:account:229', JSON.stringify([stale]))
  window.fetch = async (url, options = {}) => {
    calls.push(url)
    let data = {}
    if (url === '/api/auth/me') { if (authGate) await authGate.promise; data = { user } }
    else if (url.startsWith('/api/account/collections')) { if (listGate) await listGate.promise; data = { collections: tasks } }
    else if (url === '/api/runtime-config') data = { upload: {} }
    else if (url === '/api/collections/manage/guest-manage') {
      if (guestGate) await guestGate.promise
      data = { collection: { ...task, id: 'guest-task', token: 'guest-task', manageToken: 'guest-manage', title: stale.name } }
    } else if (url === '/api/auth/logout') { user = null; data = { ok: true } }
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  window.eval(code)
  return { window, document: window.document, errors, calls, storage, close: () => window.close() }
}

const authGate = gate()
const signedIn = mount({ user: { id: '229', username: '19211532795', nickname: '鲲穹用户', avatar: 'https://avatar.example.test/provider.png', providerAvatar: 'https://avatar.example.test/provider.png' }, authGate, tasks: [task] })
try {
  await waitFor(() => signedIn.document.querySelector('.collection-page'), 'collection page mounted before slow identity')
  check('unconfirmed login never flashes local tasks', !signedIn.document.querySelector('.collection-history'))
  check('unconfirmed login never probes stale management links', !signedIn.calls.includes('/api/collections/manage/guest-manage'))
  authGate.resolve()
  await waitFor(() => signedIn.document.querySelector('.collection-history-row'), 'database-owned history loaded')
  const history = signedIn.document.querySelector('.collection-history')
  check('signed-in history contains only database tasks despite guest and account browser snapshots', history.textContent.includes(task.title) && !history.textContent.includes(stale.name))
  check('signed-in label identifies the current account source', history.textContent.includes('当前账号的任务') && !history.textContent.includes('本机保存的任务'))
  check('header displays only the last four phone digits instead of generic nickname', signedIn.document.querySelector('.topbar [aria-label="个人中心"]').textContent.includes('2795') && !signedIn.document.querySelector('.topbar [aria-label="个人中心"]').textContent.includes('19211532795') && !signedIn.document.body.textContent.includes('鲲穹用户'))
  check('cold refresh keeps the third-party avatar in the header', signedIn.document.querySelector('.topbar img.user-avatar')?.getAttribute('src') === 'https://avatar.example.test/provider.png')
  check('summary opens the management token returned for that resource', history.querySelector('a').getAttribute('href') === '/collect/manage/owned-manage')
  check('collection history does not download all account records or probe local links', !signedIn.calls.some(url => url.startsWith('/api/account/records') || url.includes('guest-manage')))
  check('summary preserves the submission count', history.textContent.includes('4 份提交'))
  check('history renders without React or browser errors', signedIn.errors.length === 0)
} finally { signedIn.close() }

const guestGate = gate(), racing = mount({ guestGate, tasks: [task] })
try {
  await waitFor(() => racing.calls.includes('/api/collections/manage/guest-manage'), 'guest refresh begins')
  const before = racing.storage.getItem('kunqiong-records:account:229')
  racing.window.dispatchEvent(new racing.window.CustomEvent('kunqiong:account-session', { detail: {
    userId: '229', previousId: '', user: { id: '229', username: '19211532795' },
  } }))
  await waitFor(() => racing.document.querySelector('.collection-history')?.textContent.includes(task.title), 'login replaces guest history with owned tasks')
  guestGate.resolve(); await delay(80)
  check('late guest refresh cannot write to a newly logged-in account', racing.storage.getItem('kunqiong-records:account:229') === before)
  check('late guest response cannot replace the signed-in task list', !racing.document.querySelector('.collection-history').textContent.includes(stale.name))
  check('guest/login race renders without errors', racing.errors.length === 0)
} finally { racing.close() }

const listGate = gate(), late = mount({ user: { id: '229', username: '19211532795' }, listGate, tasks: [task] })
try {
  await waitFor(() => late.calls.some(url => url.startsWith('/api/account/collections')), 'old account list is pending')
  late.document.querySelector('.topbar [aria-label="个人中心"]').click()
  await waitFor(() => [...late.document.querySelectorAll('button')].some(button => button.textContent.includes('退出登录')), 'logout menu opened')
  ;[...late.document.querySelectorAll('button')].find(button => button.textContent.includes('退出登录')).click()
  await waitFor(() => late.document.querySelector('.topbar [aria-label="登录"]'), 'logged out before list response')
  listGate.resolve(); await delay(80)
  check('old account list response cannot publish private tasks after logout', !late.document.body.textContent.includes(task.title))
  check('logout during history load renders without errors', late.errors.length === 0)
} finally { late.close() }

for (const [label, user, expectedAvatar] of [
  ['custom avatar remains preferred', { id: '9', username: 'wzx1', avatarSource: 'custom', avatar: 'data:image/png;base64,eA==', providerAvatar: 'https://avatar.example.test/provider.png' }, 'data:image/png;base64,eA=='],
  ['missing avatar never becomes a username initial', { id: '9', username: 'wzx1' }, null],
]) {
  const fresh = mount({ user })
  try {
    await waitFor(() => fresh.document.querySelector('.topbar [aria-label="个人中心"]'), label)
    const header = fresh.document.querySelector('.topbar [aria-label="个人中心"]')
    check(label, expectedAvatar ? header.querySelector('img.user-avatar')?.getAttribute('src') === expectedAvatar : header.querySelector('.user-avatar')?.textContent === '')
    check('ordinary username remains complete: ' + label, header.textContent.includes('wzx1'))
  } finally { fresh.close() }
}
console.log('Collection ownership and avatar UI: ' + passed + ' passed')
