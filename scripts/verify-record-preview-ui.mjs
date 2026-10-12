import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { JSDOM, VirtualConsole } from 'jsdom'
import { build } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bundle = await build({
  root, configFile: false, logLevel: 'silent',
  plugins: [{
    name: 'record-preview-test-entry',
    resolveId(id) { if (id === 'record-preview-test') return '\0record-preview-test' },
    load(id) {
      if (id !== '\0record-preview-test') return
      return `import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { FilePreviewModal } from '/src/components/ui.jsx';
        import { recordPreviewConfigs, createShareFilePreviewConfig } from '/src/lib/transfer.js';
        import { syncShareRecord } from '/src/lib/records.js';
        const root = createRoot(document.getElementById('root'));
        window.previewFixture = { recordPreviewConfigs, createShareFilePreviewConfig, syncShareRecord,
          render(preview) { root.render(React.createElement(FilePreviewModal, {preview, onClose:()=>root.render(null), onDownload:()=>{window.downloadClicked=true}})) },
          unmount() { root.unmount() }
        };`
    },
  }],
  build: { write: false, minify: false, rollupOptions: { input: 'record-preview-test', output: { format: 'iife', inlineDynamicImports: true } } },
})
const code = bundle.output.find(item => item.type === 'chunk').code
let passed = 0
function check(name, condition) { assert.ok(condition, name); passed++; console.log('PASS ' + name) }
async function waitFor(condition, name) {
  for (let i = 0; i < 150; i++) { if (condition()) return; await delay(10) }
  assert.fail(name)
}
async function fixture(handler) {
  const errors = [], requests = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', error => errors.push(error))
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://fixture.local', pretendToBeVisual: true, runScripts: 'outside-only', virtualConsole })
  dom.window.AbortController = AbortController
  dom.window.fetch = async (url, options = {}) => {
    requests.push({ url, method: options.method || 'GET', headers: options.headers || {} })
    return handler(url, options)
  }
  dom.window.eval(code)
  return { dom, window: dom.window, document: dom.window.document, api: dom.window.previewFixture, requests, errors,
    close() { dom.window.previewFixture.unmount(); dom.window.close() } }
}
const ok = body => new Response(body, { status: 200 })
const failure = (status, message) => new Response(JSON.stringify({ message }), { status, headers: { 'x-error-message': encodeURIComponent(message), 'content-type': 'application/json' } })
const record = { kind: 'share', scope: 'my_sent', shareId: 'share', code: 'ABC123', manageToken: 'manage', files: [{ name: 'records.pdf', size: 603 }], status: '已关闭' }

const configs = await fixture(() => ok('{}'))
try {
  const [own] = configs.api.recordPreviewConfigs(record)
  check('Own record uses managed preview', own.url.endsWith('/api/shares/manage/manage/files/0/preview'))
  check('Own preview download uses same permission path', own.downloadConfig.url.endsWith('/api/shares/manage/manage/files/0/download'))
  const [received] = configs.api.recordPreviewConfigs({ ...record, scope: 'sent_to_me' })
  check('Received record uses public permission path', received.url.endsWith('/api/shares/share/files/0/preview'))
  check('Received password challenge has verification endpoint', received.unlockUrl === '/api/shares/lookup/ABC123')
} finally { configs.close() }

const blocked = await fixture(() => failure(410, '分享已关闭'))
try {
  blocked.api.render({ file: record.files[0], kind: 'pdf', url: '/gone' })
  await waitFor(() => blocked.document.body.textContent.includes('分享已关闭'), 'Closed PDF displays real reason')
  check('Expired PDF never embeds error endpoint', !blocked.document.querySelector('iframe'))
  check('Failed preflight disables unavailable download', blocked.document.querySelector('.preview-modal-footer button').disabled)
  check('Preflight checks with HEAD', blocked.requests.length === 1 && blocked.requests[0].method === 'HEAD')
} finally { blocked.close() }

const loaded = await fixture(() => ok(null))
try {
  loaded.api.render({ file: record.files[0], kind: 'pdf', url: '/approved-pdf' })
  await waitFor(() => loaded.document.querySelector('iframe'), 'Valid PDF iframe appears')
  check('Valid PDF embeds approved preview URL', loaded.document.querySelector('iframe').getAttribute('src') === '/approved-pdf')
  check('Valid PDF allows download', !loaded.document.querySelector('.preview-modal-footer button').disabled)
  loaded.document.querySelector('.preview-modal-footer button').click()
  check('Preview download uses supplied callback', loaded.window.downloadClicked)
  loaded.document.querySelector('[aria-label="关闭预览"]').click()
  await waitFor(() => !loaded.document.querySelector('.preview-modal'), 'Close removes file preview')
  check('Preview close button works', !loaded.document.querySelector('.preview-modal'))
} finally { loaded.close() }

let unlocked = false
const protectedCsv = await fixture((url, options) => {
  if (url === '/unlock') {
    if (JSON.parse(options.body).password !== 'correct') return failure(401, '提取密码不正确')
    unlocked = true
    return ok('{"share":{"files":[]}}')
  }
  if (!unlocked) return failure(403, '请输入提取密码')
  return options.method === 'HEAD' ? ok(null) : ok('name,role\nfixture,owner\n')
})
try {
  let sessionInvalidations = 0
  protectedCsv.window.addEventListener('kunqiong:account-session', () => { sessionInvalidations++ })
  protectedCsv.api.render({ file: { name: 'roles.csv' }, kind: 'spreadsheet', url: '/protected-csv', unlockUrl: '/unlock' })
  await waitFor(() => protectedCsv.document.querySelector('input[type=password]'), 'Password prompt visible')
  check('Protected CSV prompts before loading bytes', protectedCsv.requests.every(req => req.method === 'HEAD'))
  const input = protectedCsv.document.querySelector('input')
  const enterPassword = async value => {
    Object.getOwnPropertyDescriptor(protectedCsv.window.HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new protectedCsv.window.Event('input', { bubbles: true }))
    await delay(20)
    protectedCsv.document.querySelector('form').dispatchEvent(new protectedCsv.window.Event('submit', { bubbles: true, cancelable: true }))
  }
  await enterPassword('wrong')
  await waitFor(() => protectedCsv.document.body.textContent.includes('提取密码不正确'), 'Wrong password displayed')
  check('Wrong password keeps content hidden', !protectedCsv.document.querySelector('table'))
  check('Wrong extraction password does not invalidate account session', sessionInvalidations === 0)
  await enterPassword('correct')
  await waitFor(() => protectedCsv.document.querySelector('table'), 'Unlocked CSV renders')
  check('Unlocked CSV displays original table content', protectedCsv.document.querySelector('table').textContent.includes('fixture') && protectedCsv.document.querySelector('table').textContent.includes('owner'))
  check('Password field removed after successful validation', !protectedCsv.document.querySelector('input[type=password]'))
  check('No password placed in preview URL', protectedCsv.requests.every(req => !req.url.includes('correct') && !req.url.includes('wrong')))
  check('CSV fetch follows successful preflight', protectedCsv.requests.some(req => req.url === '/protected-csv' && req.method === 'GET'))
  check('Preview has no UI runtime errors', protectedCsv.errors.length === 0)
} finally { protectedCsv.close() }

const synced = await fixture(() => ok(JSON.stringify({ share: { id: 'share', status: 'closed', manageToken: 'manage', files: record.files } })))
try {
  const result = await synced.api.syncShareRecord(record)
  check('Owner sync restores closed share files', result.files.length === 1 && result.files[0].name === 'records.pdf')
  check('Owner sync reads management metadata', synced.requests[0].url === '/api/shares/manage/manage')
} finally { synced.close() }
const lockedSync = await fixture(() => ok(JSON.stringify({ requiresPassword: true, share: { id: 'share', code: 'ABC123', files: [] } })))
try {
  const result = await lockedSync.api.syncShareRecord({ ...record, scope: 'sent_to_me' })
  check('Locked response preserves received file snapshot for password challenge', result.files.length === 1)
} finally { lockedSync.close() }
const cleanedSync = await fixture(() => ok(JSON.stringify({ share: { id: 'share', manageToken: 'manage', files: [] } })))
try {
  const result = await cleanedSync.api.syncShareRecord(record)
  check('Authoritative empty file list clears cleaned snapshot', result.files.length === 0 && result.fileCount === 0)
} finally { cleanedSync.close() }
console.log(JSON.stringify({ passed, failures: 0 }))
