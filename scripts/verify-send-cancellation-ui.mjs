// Real React page and chunk uploader; hold requests to exercise cancellation races.
import assert from 'node:assert/strict'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { JSDOM, VirtualConsole } from 'jsdom'
import { build } from 'vite'

const root = path.resolve(import.meta.dirname, '..')
const bundle = await build({ root, configFile: false, logLevel: 'silent', build: {
  write: false, minify: false, rollupOptions: { input: path.join(root, 'src/main.jsx'), output: { format: 'iife', inlineDynamicImports: true } },
} })
const code = bundle.output.find(item => item.type === 'chunk').code
let passed = 0
const check = (name, value) => { assert.ok(value, name); passed++; console.log('PASS ' + name) }
async function waitFor(fn, name) {
  for (let i = 0; i < 300; i++) { if (fn()) return; await delay(10) }
  assert.fail(name)
}
const file = (name, size = 24) => new File([Buffer.alloc(size, name.charCodeAt(0))], name, { type: 'application/octet-stream', lastModified: 123 })
async function mount({ server, storage = {}, guest = false } = {}) {
  const errors = [], vc = new VirtualConsole()
  vc.on('jsdomError', err => errors.push(err))
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://fixture.local/', pretendToBeVisual: true, runScripts: 'outside-only', virtualConsole: vc })
  const { window } = dom, { document } = window
  window.Blob = Blob; window.FormData = FormData
  const s = server || { requests: [], pending: [], sessions: new Map(), completed: [], next: 0, holdCreate: false, releaseCreate: null, holdDelete: false, releaseDelete: null, holdComplete: false, releaseComplete: null }
  for (const [key, value] of Object.entries(storage)) window.localStorage.setItem(key, value)
  window.fetch = async (url, options = {}) => {
    s.requests.push({ url, method: options.method || 'GET' })
    let status = 200, data = {}
    if (url === '/api/auth/me') data = { user: guest ? null : { id: 'owner', username: 'owner' } }
    else if (url === '/api/guest/quota') data = { enabled: guest, limitBytes: 8 * 1024 * 1024 + 19, usedBytes: 0, remainingBytes: s.sessions.size ? 0 : 8 * 1024 * 1024 + 19 }
    else if (url === '/api/upload-sessions') {
      const id = 'session-' + (++s.next), body = JSON.parse(options.body)
      s.sessions.set(id, { ...body, id, chunks: new Map() })
      if (s.holdCreate) { s.holdCreate = false; await new Promise(resolve => { s.releaseCreate = resolve }) }
      data = { sessionId: id }; status = 201
    } else if (String(url).startsWith('/api/upload-sessions/')) {
      const id = url.split('/')[3], session = s.sessions.get(id)
      if (!session) { status = 404; data = { message: '上传会话不存在，请重新开始上传' } }
      else if (options.method === 'DELETE') {
        if (s.holdDelete) { s.holdDelete = false; await new Promise(resolve => { s.releaseDelete = resolve }) }
        s.sessions.delete(id); status = 204
      } else if (url.endsWith('/complete')) {
        if (s.background) {
          if (!session.completion || (session.completion.status === 'failed' && JSON.parse(options.body).retry)) {
            s.scanStarts = (s.scanStarts || 0) + 1
            session.completion = { status: 'scanning', startedAt: new Date(Date.now() - 61000).toISOString(), currentFile: session.files[0].name, fileIndex: 1, fileCount: session.files.length }
          }
          if (s.lostStart) { s.lostStart = false; return new Response('<html>Bad Gateway</html>', { status: 502 }) }
          return new Response(JSON.stringify({ completion: session.completion }), { status: 202 })
        }
        if (s.holdComplete) { s.holdComplete = false; await new Promise(resolve => { s.releaseComplete = resolve }) }
        if (s.completeError) return new Response(JSON.stringify(s.completeError.data), { status: s.completeError.status })
        const files = session.files.map((item, index) => ({ ...item, bytes: Buffer.concat([...session.chunks.entries()].filter(([key]) => key.startsWith(index + ':')).sort(([a], [b]) => Number(a.split(':')[1]) - Number(b.split(':')[1])).map(([, bytes]) => bytes)) }))
        s.completed.push({ id, files })
        data = { share: { id, manageToken: 'manage-' + id, code: '123456', files: session.files, totalSize: session.files.reduce((sum, f) => sum + f.size, 0), shareUrl: '/share/' + id, ...(s.notificationData || {}) } }; status = 201
      } else {
        if (s.failedPolls) { s.failedPolls--; return new Response('<html>Bad Gateway</html>', { status: 502 }) }
        data = { sessionId: id, completion: session.completion, chunkSize: session.chunkSize, files: session.files.map((item, index) => ({ ...item, uploadedChunks: [...session.chunks.keys()].filter(key => key.startsWith(index + ':')).map(key => Number(key.split(':')[1])) })) }
      }
    }
    return new Response(status === 204 ? null : JSON.stringify(data), { status })
  }
  window.XMLHttpRequest = class {
    constructor() { this.upload = {}; this.done = false; this.aborted = false }
    open(method, url) { this.url = url; this.id = url.split('/')[3] }
    send(body) { this.body = body; s.pending.push(this) }
    async accept() {
      if (this.done) return
      this.done = true
      const session = s.sessions.get(this.id)
      if (!session) { this.status = 404; this.responseText = '{"message":"上传会话不存在，请重新开始上传"}' }
      else {
        session.chunks.set(this.body.get('fileIndex') + ':' + this.body.get('chunkIndex'), Buffer.from(await this.body.get('chunk').arrayBuffer()))
        this.status = 200; this.responseText = '{"ok":true}'
      }
      this.onload?.()
    }
    fail(status = 503) { this.done = true; this.status = status; this.responseText = JSON.stringify({ message: status === 404 ? '上传会话不存在，请重新开始上传' : '暂时无法上传' }); this.onload?.() }
    abort() { if (!this.done) { this.done = true; this.aborted = true; this.onabort?.() } }
  }
  window.eval(code)
  await waitFor(() => document.querySelector('.empty-upload') && !document.querySelector('.auth-loading'), 'Send page mounts')
  const button = label => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === label || b.getAttribute('aria-label') === label)
  const click = async label => { const b = button(label); assert.ok(b && !b.disabled, 'Enabled button: ' + label); b.click(); await delay(30) }
  const choose = async items => {
    const input = document.querySelector('.upload-panel input[type=file]:not([webkitdirectory])')
    Object.defineProperty(input, 'files', { configurable: true, value: items })
    input.dispatchEvent(new window.Event('change', { bubbles: true })); await delay(30)
  }
  const start = async () => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('开始上传')); assert.ok(b && !b.disabled); b.click(); await delay(30) }
  const finish = async () => {
    const before = s.completed.length
    for (let i = 0; i < 100 && s.completed.length === before; i++) { await Promise.all(s.pending.filter(x => !x.done).map(x => x.accept())); await delay(20) }
    await waitFor(() => document.querySelector('.share-result'), 'New upload completes')
    return s.completed.at(-1)
  }
  return { s, window, document, errors, button, click, choose, start, finish, storage: () => Object.fromEntries(Object.keys(window.localStorage).map(key => [key, window.localStorage.getItem(key)])), close: () => { window.dispatchEvent(new window.Event('pagehide')); window.close() } }
}

async function test(name, run) {
  const f = await mount()
  try { await run(f); check(name + ': no React errors', !f.errors.length) }
  finally { f.s.releaseCreate?.(); f.s.releaseDelete?.(); f.s.releaseComplete?.(); f.close() }
}

function watchProgress(f) {
  const values = []
  const read = () => {
    const label = f.document.querySelector('.progress-label strong')
    if (label) values.push(Number.parseInt(label.textContent, 10))
  }
  const observer = new f.window.MutationObserver(read)
  observer.observe(f.document.getElementById('root'), { childList: true, subtree: true, characterData: true, attributes: true })
  read()
  return { values, stop: () => observer.disconnect() }
}

await test('Concurrent chunk retries keep continuous progress', async f => {
  const chunkSize = 8 * 1024 * 1024
  f.s.holdComplete = true
  await f.choose([file('progress.bin', chunkSize * 3 + 19)]); await f.start()
  await waitFor(() => f.s.pending.length >= 2, 'Concurrent progress chunks start')
  const first = f.s.pending[0], other = f.s.pending[1]
  const watch = watchProgress(f)
  first.upload.onprogress({ lengthComputable: true, loaded: chunkSize * 0.75, total: chunkSize })
  other.upload.onprogress({ lengthComputable: true, loaded: chunkSize * 0.5, total: chunkSize })
  await delay(30)
  const beforeRetry = watch.values.at(-1)
  check('Concurrent requests contribute to total progress', beforeRetry > 40)
  first.fail(503)
  await delay(30)
  check('Retry backoff preserves all concurrent progress', watch.values.at(-1) === beforeRetry)
  await waitFor(() => f.s.pending.some(x => !x.done && x.body.get('chunkIndex') === first.body.get('chunkIndex')), 'Failed chunk is retried')
  const retried = f.s.pending.find(x => !x.done && x.body.get('chunkIndex') === first.body.get('chunkIndex'))
  retried.upload.onprogress({ lengthComputable: true, loaded: chunkSize * 0.1, total: chunkSize })
  await delay(30)
  check('Retransmitted bytes do not pull the progress bar backward', watch.values.at(-1) >= beforeRetry)
  await retried.accept(); await delay(30)
  const acknowledged = watch.values.at(-1)
  retried.upload.onprogress({ lengthComputable: true, loaded: chunkSize, total: chunkSize })
  await delay(30)
  check('A late progress event cannot count an acknowledged chunk twice', watch.values.at(-1) === acknowledged)
  const finished = f.finish()
  await waitFor(() => f.s.releaseComplete && f.document.querySelector('.progress-label strong')?.textContent === '100%', 'Acknowledged upload reaches safety check')
  f.s.releaseComplete(); await finished
  watch.stop()
  check('Progress never falls during retry and completion', watch.values.every((value, index) => !index || value >= watch.values[index - 1]) && watch.values.at(-1) === 100)
})

await test('Manual retry preserves partially transmitted progress', async f => {
  const chunkSize = 8 * 1024 * 1024
  f.s.holdComplete = true
  await f.choose([file('manual.bin', chunkSize + 19)]); await f.start()
  await waitFor(() => f.s.pending.length === 2, 'Manual retry chunks start')
  await f.s.pending[1].accept()
  const watch = watchProgress(f)
  f.s.pending[0].upload.onprogress({ lengthComputable: true, loaded: chunkSize * 0.75, total: chunkSize })
  await delay(30)
  const original = watch.values.at(-1)
  for (let attempt = 0; attempt < 3; attempt++) {
    const xhr = f.s.pending.find(x => !x.done)
    xhr.fail(503)
    if (attempt < 2) await waitFor(() => f.s.pending.some(x => !x.done), 'Next automatic retry starts')
  }
  await waitFor(() => f.button('重试上传'), 'Manual retry becomes available')
  check('Exhausted retries keep the displayed progress', watch.values.at(-1) === original)
  await f.click('重试上传'); await waitFor(() => f.s.pending.some(x => !x.done), 'Manual retry continues')
  check('Manual retry starts from the existing progress', watch.values.at(-1) === original && f.s.next === 1)
  const finished = f.finish()
  await waitFor(() => f.s.releaseComplete && f.document.querySelector('.progress-label strong')?.textContent === '100%', 'Retried upload reaches safety check')
  f.s.releaseComplete(); await finished; watch.stop()
  check('Manual retry never regresses and preserves original bytes', watch.values.every((value, index) => !index || value >= watch.values[index - 1]) && f.s.completed[0].files[0].bytes.length === chunkSize + 19)
})

await test('Multipart progress excludes request overhead', async f => {
  await f.choose([file('small.bin', 24)]); await f.start()
  await waitFor(() => f.s.pending.length === 1, 'Small file starts')
  const xhr = f.s.pending[0]
  xhr.upload.onprogress({ lengthComputable: true, loaded: 1024, total: 2048 })
  await delay(30)
  check('Small files use payload ratio without exceeding their size', f.document.querySelector('.progress-label strong').textContent === '50%' && f.document.querySelector('.upload-metrics').textContent.includes('已传 12 B / 24 B'))
  xhr.upload.onprogress({ lengthComputable: true, loaded: 2048, total: 2048 }); await delay(30)
  check('Sending the request body waits for server acknowledgement at 99%', f.document.querySelector('.progress-label strong').textContent === '99%' && !f.document.body.textContent.includes('已传 2048'))
  await f.finish()
})

await test('Remove active file then select new file', async f => {
  await f.choose([file('old.rar', 8 * 1024 * 1024 + 19)]); await f.start()
  await waitFor(() => f.s.pending.length === 2, 'Old chunks are in flight')
  const old = [...f.s.pending]
  await f.click('移除 old.rar')
  check('Removing the final file aborts every chunk immediately', old.every(x => x.aborted))
  await f.choose([file('new.apk')])
  // Even an event already queued before abort must not restore old progress.
  for (const xhr of old) xhr.upload.onprogress?.({ lengthComputable: true, loaded: 999 })
  await delay(50)
  check('New selection shows idle controls without old filename/progress', !![...f.document.querySelectorAll('button')].find(b => b.textContent.includes('开始上传')) && !f.document.querySelector('.progress-wrap') && !f.document.body.textContent.includes('old.rar'))
  check('Cancelled resume record is removed', !f.window.localStorage.getItem('kunqiong_upload_resume'))
  await f.start(); const result = await f.finish()
  check('Only newly selected bytes are published', result.files.length === 1 && result.files[0].name === 'new.apk' && result.files[0].bytes.equals(Buffer.alloc(24, 'n'.charCodeAt(0))))
  check('Deleted session receives no retries or completion', f.s.pending.filter(x => x.id === 'session-1').length === 2 && !f.s.requests.some(r => r.url === '/api/upload-sessions/session-1/complete'))
})

await test('Remove one of multiple files', async f => {
  await f.choose([file('one.bin'), file('two.bin')]); await f.start()
  await waitFor(() => f.s.pending.length, 'First file starts')
  await f.click('移除 one.bin')
  check('Remaining selection is preserved and old batch is cancelled', f.document.querySelectorAll('.file-row').length === 1 && f.s.pending[0].aborted && !f.document.querySelector('.progress-wrap'))
  await f.start(); const result = await f.finish()
  check('Restarted batch publishes only the remaining file', result.files.length === 1 && result.files[0].name === 'two.bin')
})

await test('Clear while creating session', async f => {
  f.s.holdCreate = true
  await f.choose([file('early.bin')]); await f.start()
  await waitFor(() => f.s.releaseCreate, 'Create response is held')
  await f.click('清空文件'); await f.choose([file('replacement.bin')]); await f.start()
  f.s.releaseCreate(); await waitFor(() => f.s.pending.some(x => x.id === 'session-2'), 'Replacement starts after old create settles')
  check('Late created session is deleted without uploading chunks', !f.s.sessions.has('session-1') && !f.s.pending.some(x => x.id === 'session-1'))
  const result = await f.finish()
  check('Late create cannot overwrite the new resume record', result.files[0].name === 'replacement.bin' && !f.window.localStorage.getItem('kunqiong_upload_resume'))
})

await test('Clear waits for server reservation release', async f => {
  await f.choose([file('quota.bin')]); await f.start(); await waitFor(() => f.s.pending.length, 'Quota batch starts')
  f.s.holdDelete = true; await f.click('清空文件'); await f.choose([file('later.bin')]); await f.start()
  await waitFor(() => f.s.releaseDelete, 'Delete response held')
  check('New session is not created before old reservation is released', f.s.next === 1)
  f.s.releaseDelete(); await waitFor(() => f.s.next === 2, 'Next create follows cleanup')
  const result = await f.finish(); check('Upload works after reservation cleanup', result.files[0].name === 'later.bin')
})

await test('Cancelled retry backoff', async f => {
  await f.choose([file('retry.bin')]); await f.start(); await waitFor(() => f.s.pending.length, 'Retry batch starts')
  f.s.pending[0].fail(); await delay(30)
  await f.click('清空文件'); await f.choose([file('fresh.bin')]); await f.start()
  await waitFor(() => f.s.next === 2, 'Fresh batch starts after backoff settles')
  const result = await f.finish()
  check('Old batch does not retry after cancellation', f.s.pending.filter(x => x.id === 'session-1').length === 1 && result.files[0].name === 'fresh.bin')
})

await test('Missing session can restart', async f => {
  await f.choose([file('expired.bin')]); await f.start(); await waitFor(() => f.s.pending.length, 'Session batch starts')
  f.s.sessions.delete('session-1'); f.s.pending[0].fail(404)
  await waitFor(() => f.button('重试上传'), 'Missing session fails promptly')
  check('Missing session is not retried three times', f.s.pending.length === 1)
  await f.click('重试上传'); await waitFor(() => f.s.next === 2, 'Retry creates a fresh session')
  const result = await f.finish(); check('Retry succeeds with a fresh session', result.id === 'session-2' && result.files[0].name === 'expired.bin')
})

await test('Pause remains resumable', async f => {
  await f.choose([file('paused.bin', 8 * 1024 * 1024 + 19)]); await f.start(); await waitFor(() => f.s.pending.length === 2, 'Pause batch starts')
  await f.s.pending[1].accept(); await f.click('暂停'); await waitFor(() => f.button('继续上传'), 'Pause settles')
  check('Pause preserves session and saved chunks', f.s.sessions.has('session-1') && !!f.window.localStorage.getItem('kunqiong_upload_resume'))
  await f.click('继续上传'); const result = await f.finish()
  check('Resume keeps the session and skips the saved chunk', f.s.next === 1 && f.s.pending.filter(x => x.body.get('chunkIndex') === '1').length === 1 && result.files[0].bytes.length === 8 * 1024 * 1024 + 19)
})

await test('Finalization cannot be cancelled accidentally', async f => {
  f.s.holdComplete = true
  await f.choose([file('publishing.bin')]); await f.start(); await waitFor(() => f.s.pending.length, 'Publishing batch starts')
  await f.s.pending[0].accept(); await waitFor(() => f.s.releaseComplete, 'Publish response held')
  check('Finalization explains the safety check without a false upload ETA', f.document.querySelector('.progress-label').textContent.includes('正在进行安全检查') && f.document.querySelector('.upload-metrics').textContent.includes('等待安全检查结果') && !f.document.querySelector('.upload-metrics').textContent.includes('剩余'))
  check('Removal is unavailable while scanning/publishing and clear is disabled', !f.button('移除 publishing.bin') && f.button('清空文件').disabled)
  await f.choose([file('unwanted.bin')])
  check('New selection cannot change a publishing batch', f.document.querySelectorAll('.file-row').length === 1 && !f.document.body.textContent.includes('unwanted.bin'))
  f.s.releaseComplete(); await waitFor(() => f.document.querySelector('.share-result'), 'Finalized result shows')
  check('Finalized batch produces exactly one share', f.s.completed.length === 1 && f.s.completed[0].files[0].name === 'publishing.bin')
})

await test('Background safety check recovers a lost 502 response', async f => {
  f.s.background = true; f.s.lostStart = true
  await f.choose([file('background.rar')]); await f.start(); await f.s.pending[0].accept()
  await waitFor(() => f.document.querySelector('.security-check-status'), 'Waiting UI shown')
  await waitFor(() => f.document.querySelector('.security-check-status').textContent.includes('正在恢复连接'), 'Lost start is identified as reconnecting')
  check('A lost response keeps uploaded bytes and does not offer re-upload', f.document.querySelector('.progress-label strong').textContent === '100%' && !f.button('重试上传'))
  await waitFor(() => f.document.querySelector('.security-check-file'), 'Status query reconnects to scanner')
  const status = f.document.querySelector('.security-check-status')
  check('Elapsed time resumes from server start with useful archive explanation', status.textContent.includes('已等待 1 分') && status.textContent.includes('background.rar') && status.textContent.includes('压缩包需要解压检查') && status.textContent.includes('无需重新上传'))
  const oldTime = status.querySelector('[aria-label="处理已等待时间"]').textContent
  await delay(1100)
  check('Waiting time updates while scanner has no verdict', status.querySelector('[aria-label="处理已等待时间"]').textContent !== oldTime)
  check('Reconnect never starts a second scan or sends duplicate bytes', f.s.scanStarts === 1 && f.s.pending.length === 1 && f.s.completed.length === 0)
  const session = f.s.sessions.get('session-1')
  session.completion = { ...session.completion, fileCount: 4, completedFileCount: 2, activeFileCount: 2 }
  await waitFor(() => status.textContent.includes('已检查 2 / 4 个文件'), 'Batch counters displayed')
  check('Parallel scan UI reports completed files and active work', status.textContent.includes('2 个文件处理中'))
  session.completion = { ...session.completion, status: 'publishing', currentFile: '' }
  await waitFor(() => status.textContent.includes('安全检查通过，正在完成发布'), 'Publication stage shown')
  session.completion = { ...session.completion, status: 'complete', result: { share: { id: 'session-1', manageToken: 'manage-1', code: '123456', files: session.files, shareUrl: '/share/session-1' } } }
  await waitFor(() => f.document.querySelector('.share-result'), 'Background result recovered')
  check('Polling displays final result and clears resume storage', !f.window.localStorage.getItem('kunqiong_upload_resume') && !f.document.querySelector('.security-check-status') && f.s.scanStarts === 1)
})

await test('Polled threat verdict is shown without a retry loop', async f => {
  f.s.background = true
  await f.choose([file('blocked.rar')]); await f.start(); await f.s.pending[0].accept()
  await waitFor(() => f.s.sessions.get('session-1')?.completion, 'Scan started')
  const session = f.s.sessions.get('session-1')
  session.completion = { ...session.completion, status: 'failed', error: { status: 415, code: 'scan_threat_detected', message: '文件扫描发现威胁，已阻止发布' } }
  await waitFor(() => f.document.querySelector('.upload-error'), 'Polled verdict shown')
  check('Background threat keeps the specific verdict and no retry action', f.document.querySelector('.upload-error').textContent.includes('文件扫描发现威胁') && !f.button('重试安全检查') && !f.button('重试上传') && f.s.scanStarts === 1)
  check('A blocked verdict no longer claims to be waiting', !f.document.querySelector('.upload-metrics').textContent.includes('等待安全检查结果') && f.document.querySelector('.upload-metrics').textContent.includes('已阻止发布'))
})

await test('Exhausted status retries keep the original scan resumable', async f => {
  f.s.background = true; f.s.failedPolls = 5
  await f.choose([file('query.rar')]); await f.start(); await f.s.pending[0].accept()
  for (let i = 0; i < 2000 && !f.button('查询处理结果'); i++) await delay(10)
  check('Repeated 502 keeps 100 percent and offers a status query', f.button('查询处理结果') && f.document.querySelector('.progress-label strong').textContent === '100%' && f.document.querySelector('.upload-error').textContent.includes('已上传文件保留'))
  check('Unknown completion cannot be deleted or replaced accidentally', f.button('清空文件').disabled && !f.button('移除 query.rar') && f.s.sessions.size === 1)
  const session = f.s.sessions.get('session-1')
  session.completion = { ...session.completion, status: 'complete', result: { share: { id: 'session-1', manageToken: 'manage-1', code: '123456', files: session.files, shareUrl: '/share/session-1' } } }
  await f.click('查询处理结果')
  await waitFor(() => f.document.querySelector('.share-result'), 'Manual query recovers result')
  check('Manual status query never reuploads or rescans', f.s.scanStarts === 1 && f.s.pending.length === 1 && !f.window.localStorage.getItem('kunqiong_upload_resume'))
})

await test('Network failure still retries successfully', async f => {
  await f.choose([file('network.bin')]); await f.start(); await waitFor(() => f.s.pending.length, 'Network batch starts')
  f.s.pending[0].fail(503); await waitFor(() => f.s.pending.length === 2, 'Transient failure retries')
  const result = await f.finish()
  check('Transient failure reuses the session and produces original bytes', f.s.next === 1 && result.files[0].bytes.equals(Buffer.alloc(24, 'n'.charCodeAt(0))))
})

await test('Scan failure retries the saved file without retransmission', async f => {
  f.s.completeError = { status: 415, data: { code: 'scan_size_limit', scanLimit: 'MaxScanSize', message: '压缩包解压后的总量超过安全扫描上限，请分成多个较小的压缩包再上传' } }
  await f.choose([file('large.zip', 8 * 1024 * 1024 + 19)]); await f.start()
  await waitFor(() => f.s.pending.length === 2, 'Both large file chunks start')
  await Promise.all(f.s.pending.map(xhr => xhr.accept()))
  await waitFor(() => f.button('重试安全检查'), 'Scan failure is identified separately')
  check('Completed upload shows safety failure rather than upload failure', f.document.querySelector('.progress-label').textContent.includes('上传完成，安全检查未通过') && !f.document.querySelector('.progress-label').textContent.includes('上传失败'))
  check('Scan limit keeps the full progress and original resume session', f.document.querySelector('.progress-label').textContent.includes('100%') && f.window.localStorage.getItem('kunqiong_upload_resume').includes('session-1'))
  f.s.completeError = null; await f.click('重试安全检查')
  await waitFor(() => f.document.querySelector('.share-result'), 'Rescan publishes after configuration recovery')
  check('Scan retry reuses complete bytes without new chunk uploads', f.s.next === 1 && f.s.pending.length === 2 && f.s.completed[0].files[0].bytes.length === 8 * 1024 * 1024 + 19)
})

await test('Detected threat is blocked without a retry loop', async f => {
  f.s.completeError = { status: 415, data: { code: 'scan_threat_detected', message: '文件扫描发现威胁，已阻止发布' } }
  await f.choose([file('threat.rar')]); await f.start()
  await waitFor(() => f.s.pending.length, 'Threat file uploads')
  await f.s.pending[0].accept()
  await waitFor(() => f.document.querySelector('.upload-error'), 'Threat result is shown')
  check('Threat result explains the safety block and next action', f.document.querySelector('.progress-label').textContent.includes('安全检查发现威胁，已阻止发布') && f.document.querySelector('.upload-error').textContent.includes('请移除风险文件'))
  check('Threat is not published or offered repetitive scan retries', f.s.completed.length === 0 && !f.button('重试安全检查') && !f.button('重试上传'))
  await f.click('移除 threat.rar'); f.s.completeError = null
  await f.choose([file('replacement.txt')]); await f.start(); await f.finish()
  check('Replacing the detected file starts a clean upload', f.s.completed.length === 1 && f.s.completed[0].files[0].name === 'replacement.txt')
})

// Actual statuses returned by notifyShareRecipients: SMTP success is not "已发送".
for (const scenario of [
  { name: 'SMTP accepted for an external email', statuses: ['邮件已提交投递'], expected: ['已发送 1 封邮件通知', '收件箱或垃圾邮件'], absent: ['站内通知', '发送失败', '未发送', '待确认'] },
  { name: 'Both email and in-app succeeded', statuses: ['站内已发送，邮件已提交投递'], expected: ['已发送 1 封邮件通知', '已发送 1 条站内通知'], absent: ['发送失败', '未发送', '待确认'] },
  { name: 'In-app success does not hide email failure', statuses: ['站内已发送，邮件发送失败：连接超时'], expected: ['已发送 1 条站内通知', '1 个邮箱发送失败'], absent: ['封邮件通知', '待确认'] },
  { name: 'SMTP rejected recipient', statuses: ['邮件未被服务器接受'], expected: ['1 个邮箱发送失败'], absent: ['已发送', '待确认'] },
  { name: 'Mail service not configured', statuses: ['邮件通道未配置'], expected: ['1 个邮箱未发送（邮件服务未配置）'], absent: ['已发送', '等待', '待确认'] },
  { name: 'Recipient disabled email but received in-app', statuses: ['站内已发送，邮件提醒已关闭'], expected: ['已发送 1 条站内通知', '收件人已关闭邮件提醒'], absent: ['封邮件通知', '发送失败', '待确认'] },
  { name: 'Phone did not match an account', statuses: ['该手机号未匹配到平台账号，未发送短信通知'], expected: ['1 个手机号未发送通知（未匹配平台账号）'], absent: ['已发送', '邮箱', '待确认'] },
  { name: 'Mixed recipients keep independent results', statuses: ['邮件已提交投递', '站内已发送，邮件已提交投递', '邮件发送失败：连接超时', '未知状态'], expected: ['已发送 2 封邮件通知', '已发送 1 条站内通知', '1 个邮箱发送失败', '1 个收件人的通知状态待确认'], absent: ['3 封邮件', '2 个邮箱发送失败'] },
  { name: 'Missing log stays unconfirmed', statuses: [], expected: ['已记录 1 个收件人，通知状态待确认'], absent: ['已发送', '发送失败', '未发送'] },
]) {
  await test(scenario.name, async f => {
    f.s.notificationData = {
      deliveryRecipients: Array.from({ length: Math.max(1, scenario.statuses.length) }, (_, i) => `recipient${i}@example.test`),
      notificationLog: scenario.statuses.map((status, i) => ({ recipient: `recipient${i}@example.test`, status })),
    }
    await f.choose([file('notice.txt')]); await f.start(); await f.finish()
    const element = f.document.querySelector('.share-notification-status'), text = element?.textContent || ''
    check(scenario.name + ': correct channel results shown', scenario.expected.every(part => text.includes(part)) && scenario.absent.every(part => !text.includes(part)))
    check(scenario.name + ': no false delivery claim and status is accessible', !/暂无通知送达|未投递|已送达/.test(text) && element?.getAttribute('role') === 'status')
  })
}

let guestFixture = await mount({ guest: true })
try {
  await guestFixture.choose([file('guest.bin', 8 * 1024 * 1024 + 19)]); await guestFixture.start()
  await waitFor(() => guestFixture.s.pending.length === 2, 'Guest batch starts')
  await guestFixture.s.pending[1].accept(); await guestFixture.click('暂停')
  await waitFor(() => guestFixture.button('继续上传'), 'Guest pauses')
  const saved = guestFixture.storage(), server = guestFixture.s
  guestFixture.close(); guestFixture = await mount({ guest: true, storage: saved, server })
  await guestFixture.choose([file('guest.bin', 8 * 1024 * 1024 + 19)]); await guestFixture.start()
  await waitFor(() => server.pending.some(xhr => !xhr.done), 'Refresh guest resumes despite full reservation')
  check('Refresh does not charge the saved guest reservation twice', server.next === 1 && !guestFixture.document.querySelector('.guest-quota-modal'))
  const result = await guestFixture.finish()
  check('Refresh restores guest upload without resending saved chunks', result.files[0].bytes.length === 8 * 1024 * 1024 + 19 && server.pending.filter(xhr => xhr.body.get('chunkIndex') === '1').length === 1)
} finally { guestFixture.close() }

console.log(`Send cancellation and notification UI: ${passed} passed`)
