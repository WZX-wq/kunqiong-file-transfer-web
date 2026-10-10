// Exercise the real React page and chunk uploader; only HTTP/XHR are controlled.
import assert from 'node:assert/strict'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { JSDOM, VirtualConsole } from 'jsdom'
import { build } from 'vite'

const root = path.resolve(import.meta.dirname, '..')
const bundle = await build({ root, configFile: false, logLevel: 'silent', build: {
  write: false, minify: false, rollupOptions: { input: path.join(root, 'src/main.jsx'), output: { format: 'iife', inlineDynamicImports: true } },
} })
const code = bundle.output.find((item) => item.type === 'chunk').code
const chunkSize = 8 * 1024 * 1024
const bytes = Buffer.alloc(chunkSize * 3 + 19)
for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251
const file = () => new File([bytes], '续传.bin', { type: 'application/octet-stream', lastModified: 123 })
let passed = 0
function check(name, value) { assert.ok(value, name); passed++; console.log('PASS ' + name) }
async function waitFor(fn, name) {
  for (let i = 0; i < 250; i++) { if (fn()) return; await delay(10) }
  assert.fail(name)
}
function server() {
  return { sessions: new Map(), requests: [], uploads: [], pending: [], completed: [], queryError: false, deferCreate: false, releaseCreate: null }
}
async function mount(s, storage = {}, token = 'resume-test') {
  const errors = [], vc = new VirtualConsole()
  vc.on('jsdomError', (err) => errors.push(err))
  const dom = new JSDOM('<div id="root"></div>', { url: `http://fixture.local/collect/${token}`, pretendToBeVisual: true, runScripts: 'outside-only', virtualConsole: vc })
  const { window } = dom, { document } = window
  window.Blob = Blob; window.FormData = FormData
  for (const [key, value] of Object.entries(storage)) window.localStorage.setItem(key, value)
  window.fetch = async (url, options = {}) => {
    s.requests.push({ url, method: options.method || 'GET' })
    let status = 200, data = {}
    if (url === '/api/auth/me') data = { user: null }
    else if (url === `/api/collections/${token}`) data = { collection: {
      id: token, token, title: '分片恢复测试', description: '', deadline: new Date(Date.now() + 86400000).toISOString(),
      allowedTypes: ['全部格式'], maxFileSizeMb: 500, status: 'active', publicUrl: window.location.href,
    } }
    else if (url === '/api/upload-sessions') {
      const body = JSON.parse(options.body), id = 'session-' + (s.sessions.size + 1)
      s.sessions.set(id, { ...body, sessionId: id, chunks: new Map() })
      if (s.deferCreate) await new Promise((resolve) => { s.releaseCreate = resolve })
      status = 201; data = { sessionId: id }
    } else {
      const match = /^\/api\/upload-sessions\/([^/]+)(\/complete)?$/.exec(url)
      const session = match && s.sessions.get(match[1])
      if (!session) { status = 404; data = { message: '上传会话不存在' } }
      else if (options.method === 'DELETE') { s.sessions.delete(session.sessionId); status = 204 }
      else if (match[2]) {
        const chunks = [...session.chunks].sort(([a], [b]) => a - b).map(([, value]) => value)
        s.completed.push(Buffer.concat(chunks))
        data = { submission: { submittedAt: new Date().toISOString(), files: session.files } }
        status = 201
      } else if (s.queryError) { status = 503; data = { message: '暂时无法查询进度' } }
      else data = { sessionId: session.sessionId, chunkSize: session.chunkSize, files: session.files.map((f) => ({ ...f, uploadedChunks: [...session.chunks.keys()] })) }
    }
    return new Response(status === 204 ? null : JSON.stringify(data), { status })
  }
  window.XMLHttpRequest = class {
    constructor() { this.upload = {}; this.done = false }
    open(method, url) { this.url = url }
    send(body) {
      this.index = Number(body.get('chunkIndex')); this.body = body
      s.uploads.push(this.index); s.pending.push(this)
    }
    async accept() {
      if (this.done) return
      this.done = true
      const session = s.sessions.get(this.url.split('/')[3])
      session.chunks.set(this.index, Buffer.from(await this.body.get('chunk').arrayBuffer()))
      this.status = 200; this.responseText = '{"ok":true}'; this.onload?.()
    }
    abort() { if (!this.done) { this.done = true; this.onabort?.() } }
  }
  window.eval(code)
  await waitFor(() => document.querySelector('.public-label input'), 'Collection page mounts')
  const button = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text || b.getAttribute('aria-label') === text)
  const click = async (text) => { const b = button(text); assert.ok(b, 'Button exists: ' + text); b.click(); await delay(30) }
  const choose = async (items) => {
    const picker = document.querySelector('input[type=file]:not([webkitdirectory])')
    Object.defineProperty(picker, 'files', { configurable: true, value: items })
    picker.dispatchEvent(new window.Event('change', { bubbles: true })); await delay(30)
  }
  const name = document.querySelector('.public-label input')
  if (!name.value) {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(name, '恢复提交者')
    name.dispatchEvent(new window.Event('input', { bubbles: true })); await delay(20)
  }
  return { window, document, errors, button, click, choose, storage: () => Object.fromEntries(Object.keys(window.localStorage).map((key) => [key, window.localStorage.getItem(key)])), close: () => { window.dispatchEvent(new window.Event('pagehide')); window.close() } }
}
async function finish(s, f) {
  for (let i = 0; i < 100 && !s.completed.length; i++) {
    await Promise.all(s.pending.filter((xhr) => !xhr.done).map((xhr) => xhr.accept()))
    await delay(20)
  }
  await waitFor(() => f.document.body.textContent.includes('提交成功'), 'Submission finishes')
  check('Completed upload has exactly the original bytes', s.completed[0]?.equals(bytes))
  check('Successful submission clears its resume record', !Object.keys(f.storage()).some((key) => key.startsWith('kunqiong_upload_resume')))
}

const s = server()
let f = await mount(s)
try {
  await f.choose([file()]); await f.click('提交文件')
  await waitFor(() => s.pending.length >= 2, 'Concurrent chunks start')
  // Persist a later chunk first: resumption must skip holes as well as prefixes.
  await s.pending.find((xhr) => xhr.index === 1).accept()
  await f.click('暂停上传')
  await waitFor(() => f.button('继续上传')?.disabled === false, 'Paused upload can continue')
  check('Pause keeps the selected files', f.document.querySelectorAll('.file-row').length === 1)
  check('Pause aborts all active requests', s.pending.every((xhr) => xhr.done))
  check('Pause retains a server session and saved progress', s.sessions.size === 1 && /33%/.test(f.document.body.textContent))
  await f.click('继续上传')
  await waitFor(() => s.uploads.filter((i) => i === 0).length === 2, 'Missing chunk restarts')
  check('Resume does not resend an out-of-order saved chunk', s.uploads.filter((i) => i === 1).length === 1)
  await finish(s, f)
} finally { f.close() }

const refreshed = server()
f = await mount(refreshed)
try {
  await f.choose([file()]); await f.click('提交文件')
  await waitFor(() => refreshed.pending.length >= 2, 'Chunks start before refresh')
  await refreshed.pending.find((xhr) => xhr.index === 0).accept()
  await f.click('暂停上传')
  const saved = f.storage(); f.close(); f = await mount(refreshed, saved)
  await waitFor(() => refreshed.requests.some((r) => r.url === '/api/upload-sessions/session-1'), 'Refresh queries server progress')
  check('Refresh restores participant name', f.document.querySelector('.public-label input').value === '恢复提交者')
  check('Refresh shows saved progress and original filename', /33%/.test(f.document.body.textContent) && f.document.body.textContent.includes('续传.bin'))
  check('Refresh requires the original files to continue', f.button('继续上传')?.disabled === true)
  await f.choose([new File(['wrong'], '其他.bin')])
  check('Different files cannot silently restart the old upload', f.button('继续上传')?.disabled === true && refreshed.sessions.size === 1)
  await f.click('移除 其他.bin')
  await f.choose([new File([bytes], '续传.bin', { type: 'application/octet-stream', lastModified: 124 })])
  check('A modified file of the same name and size cannot mix with saved chunks', f.button('继续上传')?.disabled === true)
  await f.click('移除 续传.bin'); await f.choose([file()]); await f.click('继续上传')
  await finish(refreshed, f)
  check('Refresh resumes the same session', refreshed.requests.filter((r) => r.url === '/api/upload-sessions' && r.method === 'POST').length === 1)
  check('Refresh skips previously saved chunks', refreshed.uploads.filter((i) => i === 0).length === 1)
} finally { f.close() }

const early = server(); early.deferCreate = true
f = await mount(early)
try {
  await f.choose([file()]); await f.click('提交文件')
  await waitFor(() => early.releaseCreate, 'Session creation is pending')
  await f.click('暂停上传'); early.releaseCreate()
  await waitFor(() => f.button('继续上传')?.disabled === false, 'Early pause settles')
  check('Pause during session creation sends no chunks', early.uploads.length === 0)
  const saved = f.storage()
  const other = await mount(early, saved, 'different-task')
  check('Another task cannot consume or discard this task session', !other.document.body.textContent.includes('发现未完成') && early.sessions.size === 1)
  other.close()
  early.queryError = true
  await f.click('继续上传')
  check('A failed progress query preserves the resume record', Object.keys(f.storage()).some((key) => key.startsWith('kunqiong_upload_resume')) && early.sessions.size === 1)
  early.queryError = false
  await f.click('放弃本次上传')
  await waitFor(() => early.sessions.size === 0, 'Abandon releases server reservation')
  check('Explicit abandon clears the resume record and selected files', !f.document.querySelector('.file-row') && !Object.keys(f.storage()).some((key) => key.startsWith('kunqiong_upload_resume')))
} finally { f.close() }
console.log(`Collection resume UI: ${passed} passed`)
