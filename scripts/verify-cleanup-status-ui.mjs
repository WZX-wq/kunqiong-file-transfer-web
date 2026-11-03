import assert from 'node:assert/strict'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { build } from 'vite'
import { JSDOM, VirtualConsole } from 'jsdom'

const root = path.resolve(import.meta.dirname, '..')
const entry = path.join(root, '__cleanup_status_fixture.jsx')
const bundle = await build({ root, configFile: false, logLevel: 'silent', worker: { format: 'es' }, plugins: [{
  name: 'cleanup-status-fixture',
  resolveId(id) { if (id === entry) return id },
  load(id) { if (id === entry) return `
    import React, {useState} from 'react'
    import {createRoot} from 'react-dom/client'
    import {SettingsPage} from './src/pages/settings.jsx'
    import {apiRequest} from './src/lib/api.js'
    function Fixture() {
      const [user, setUser] = useState({id:'alice', username:'alice', fileCleanup:{enabled:false,days:3}})
      return <SettingsPage user={user} section="cleanup" onUpdateUser={setUser} />
    }
    const root = createRoot(document.getElementById('root'))
    window.startFixture = async () => {
      await apiRequest('/api/auth/me', {authView:'identity'})
      root.render(<React.StrictMode><Fixture /></React.StrictMode>)
    }
    window.stopFixture = () => root.unmount()
  ` },
}], build: { write: false, minify: false, rollupOptions: { input: entry, output: { format: 'iife', inlineDynamicImports: true } } } })
const code = bundle.output.find(item => item.type === 'chunk').code
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
let passed = 0
const check = (label, value) => { assert.ok(value, label); passed++; console.log('PASS ' + label) }
async function waitFor(condition, label) {
  for (let i = 0; i < 250; i++) { if (condition()) return; await delay(10) }
  assert.fail(label)
}
async function mount() {
  const errors = [], calls = [], vc = new VirtualConsole()
  vc.on('jsdomError', error => errors.push(error))
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://fixture.local/settings/cleanup', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc })
  const state = { enabled: false, usedBytes: 2048, saveGate: null, readGate: null, runGate: null, failSave: false, failRead: false }
  dom.window.fetch = async (url, options = {}) => {
    const method = options.method || 'GET'
    calls.push({ url, method })
    let data = {}, status = 200
    if (url === '/api/auth/me') data = { user: { id: 'alice', username: 'alice' } }
    else if (url === '/api/account/file-cleanup-overview') {
      // Capture before waiting to catch stale pre-mutation responses.
      data = { usedBytes: state.usedBytes, totalBytes: 1024 ** 3, activeBytes: 0, expiringBytes: 0,
        expiredBytes: state.usedBytes, expiredFileCount: state.usedBytes ? 2 : 0,
        expiredShareCount: state.usedBytes ? 1 : 0, expiredCollectionCount: 0, settings: { enabled: state.enabled, days: 3 } }
      if (state.readGate) await state.readGate.promise
      if (state.failRead) { status = 500; data = { message: '容量读取失败' } }
    } else if (url === '/api/account/file-cleanup-settings') {
      const settings = JSON.parse(options.body).settings
      if (state.saveGate) await state.saveGate.promise
      if (state.failSave) { status = 500; data = { message: '清理设置保存失败' } }
      else { state.enabled = settings.enabled; state.usedBytes = 0; data = { settings } }
    } else if (url === '/api/account/file-cleanup/run') {
      if (state.runGate) await state.runGate.promise
      state.usedBytes = 0
      data = { files: 2, shares: 1, collections: 0, freedBytes: 2048 }
    }
    return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
  }
  dom.window.eval(code)
  await dom.window.startFixture()
  const doc = dom.window.document
  await waitFor(() => doc.querySelector('.cleanup-storage-total'), 'initial overview')
  await waitFor(() => doc.querySelector('.cleanup-storage-card')?.getAttribute('aria-busy') === 'false', 'initial refresh complete')
  return { state, calls, errors, doc, window: dom.window,
    run: () => doc.querySelector('.cleanup-storage-action button'),
    toggle: () => doc.querySelector('.file-cleanup-settings .switch'),
    close() { dom.window.stopFixture(); dom.window.close() } }
}

const automatic = await mount()
try {
  const { state, doc, calls } = automatic
  check('disabled setting initially disables manual cleanup', automatic.run().disabled)
  state.saveGate = gate()
  automatic.toggle().click(); automatic.toggle().click()
  await waitFor(() => doc.body.textContent.includes('正在执行自动清理'), 'enable displays execution immediately')
  check('automatic cleanup blocks duplicate writes and manual cleanup', calls.filter(c => c.method === 'PUT').length === 1 && automatic.toggle().disabled && automatic.run().disabled)
  check('cleanup status is announced to assistive technology', doc.querySelector('.cleanup-storage-action [role="status"]').textContent.includes('正在执行自动清理'))
  state.readGate = gate()
  state.saveGate.resolve()
  await waitFor(() => doc.body.textContent.includes('正在更新清理结果'), 'completion refresh stays visible')
  check('button stays locked until fresh capacity arrives', automatic.run().disabled)
  state.readGate.resolve()
  await waitFor(() => !automatic.run().disabled, 'manual cleanup enabled without reload')
  check('automatic cleanup refreshes real capacity without page reload', doc.querySelector('.cleanup-storage-total b').textContent === '0 B')
  check('completed automatic cleanup has a visible result', doc.body.textContent.includes('自动清理已按当前规则执行，容量已更新'))
  check('enabling auto cleanup does not invoke manual grace-period bypass', !calls.some(c => c.url.endsWith('/run')))

  state.runGate = gate()
  automatic.run().click(); automatic.run().click()
  await waitFor(() => doc.body.textContent.includes('正在执行清理操作'), 'manual progress visible')
  check('manual cleanup blocks repeat clicks and conflicting settings', calls.filter(c => c.url.endsWith('/run')).length === 1 && automatic.toggle().disabled)
  state.runGate.resolve()
  await waitFor(() => !automatic.run().disabled, 'manual cleanup finishes')
  check('manual result remains visible after refresh', doc.body.textContent.includes('释放 2 KB'))

  state.failSave = true
  automatic.toggle().click()
  await waitFor(() => doc.body.textContent.includes('清理设置保存失败'), 'save failure shown')
  await waitFor(() => !automatic.run().disabled, 'failed disable restores enabled state')
  check('failed settings changes roll back and unlock without refresh', automatic.toggle().getAttribute('aria-pressed') === 'true')
  check('cleanup UI has no runtime errors', automatic.errors.length === 0)
} finally { automatic.close() }

const retry = await mount()
try {
  retry.state.failRead = true
  retry.toggle().click()
  await waitFor(() => retry.doc.querySelector('.cleanup-storage-feedback[role="alert"]'), 'failed refresh surfaced')
  check('capacity refresh failure does not falsely announce completion', !retry.doc.body.textContent.includes('自动清理已按当前规则执行，容量已更新'))
  retry.state.failRead = false
  retry.doc.querySelector('.cleanup-storage-feedback[role="alert"] button').click()
  await waitFor(() => retry.doc.querySelector('.cleanup-storage-total b')?.textContent === '0 B' && !retry.run().disabled, 'retry refresh succeeds')
  check('capacity refresh can recover without reloading the page', !retry.doc.querySelector('.cleanup-storage-feedback[role="alert"]'))
} finally { retry.close() }

console.log(`Cleanup status UI: ${passed} passed`)
