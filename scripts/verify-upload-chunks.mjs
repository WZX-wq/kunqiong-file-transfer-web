// Regression for SHA-256 chunk uploads; uses isolated storage and a local ClamAV protocol fixture.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'

const root = path.resolve(import.meta.dirname, '..')
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-upload-chunks-'))

// 不用 fs.cpSync：部分受限执行环境会直接终止使用了递归复制的进程
// （表现为无输出 + exit 127，难以定位）。同 verify-metadata-cas.mjs 的处理方式。
function copyDirectory(source, target) {
  fs.mkdirSync(target, { recursive: true })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name)
    const to = path.join(target, entry.name)
    if (entry.isDirectory()) copyDirectory(from, to)
    else if (entry.isFile()) fs.copyFileSync(from, to)
  }
}

fs.copyFileSync(path.join(root, 'server.mjs'), path.join(fixture, 'server.mjs'))
fs.copyFileSync(path.join(root, 'package.json'), path.join(fixture, 'package.json'))
copyDirectory(path.join(root, 'server'), path.join(fixture, 'server'))
copyDirectory(path.join(root, 'email-templates'), path.join(fixture, 'email-templates'))
fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
const user = { id: 'owner', username: 'owner', status: 'active', planId: 'free' }
fs.mkdirSync(path.join(fixture, 'storage'))
fs.writeFileSync(path.join(fixture, 'storage', 'metadata.json'), JSON.stringify({
  users: { owner: user }, sessions: [{ id: 'upload-fixture-session', user, expiresAt: new Date(Date.now() + 3600000).toISOString() }],
}))
const scanned = []
let scannerResult = 'stream: OK'
let holdScan = false
const heldScans = []
const scanner = net.createServer((socket) => {
  let input = Buffer.alloc(0), command = false, ended = false
  const chunks = []
  socket.on('error', () => {})
  socket.on('data', (data) => {
    input = Buffer.concat([input, data])
    if (!command) {
      const end = input.indexOf(0)
      if (end < 0) return
      assert.equal(input.subarray(0, end).toString(), 'zINSTREAM')
      input = input.subarray(end + 1); command = true
    }
    while (input.length >= 4 && !ended) {
      const length = input.readUInt32BE(0)
      if (input.length < 4 + length) break
      chunks.push(input.subarray(4, 4 + length))
      input = input.subarray(4 + length)
      if (!length) {
        ended = true
        scanned.push(Buffer.concat(chunks))
        if (holdScan) heldScans.push(() => socket.end(scannerResult + '\0'))
        else socket.end(scannerResult + '\0')
      }
    }
  })
})
await new Promise((resolve) => scanner.listen(0, '127.0.0.1', resolve))
const cleanEnv = { ...process.env }
for (const key of Object.keys(cleanEnv)) if (key.startsWith('KUNQIONG_') || key.startsWith('OAUTH_')) delete cleanEnv[key]
let child, base, errors = '', passed = 0
async function stop() {
  if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited }
}
async function start() {
  const probe = net.createServer()
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise((resolve) => probe.close(resolve))
  base = `http://127.0.0.1:${port}`
  errors = ''
  child = spawn(process.execPath, ['server.mjs'], { cwd: fixture, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: {
    ...cleanEnv, PORT: String(port), KUNQIONG_HOST: '127.0.0.1', NODE_ENV: 'production',
    KUNQIONG_DB_ENABLED: 'false', KUNQIONG_SCAN_MODE: 'required',
    KUNQIONG_CLAMAV_HOST: '127.0.0.1', KUNQIONG_CLAMAV_PORT: String(scanner.address().port),
  } })
  child.stderr.on('data', (data) => { errors += data })
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/api/health')).ok) return } catch {}
    if (child.exitCode !== null) break
    await delay(50)
  }
  throw new Error('Upload fixture startup failed: ' + errors)
}
async function api(url, body) {
  const response = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: {
    cookie: 'kunqiong_session=upload-fixture-session', ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}),
  }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined })
  return { status: response.status, data: await response.json() }
}
function check(name, condition) { assert.ok(condition, name); passed++; console.log('PASS ' + name) }
const original = Buffer.concat([Buffer.alloc(1024 * 1024, 0x61), Buffer.from('safe-tail')])
function chunk(index, hash) {
  const bytes = index === 0 ? original.subarray(0, 1024 * 1024) : original.subarray(1024 * 1024)
  const body = new FormData()
  body.append('chunk', new Blob([bytes]), 'hashed-chunks.bin')
  body.append('fileIndex', '0'); body.append('chunkIndex', String(index)); body.append('totalChunks', '2')
  body.append('chunkHash', hash || createHash('sha256').update(bytes).digest('hex'))
  return body
}
try {
  await start()
  const upload = await api('/api/upload-sessions', { chunkSize: 1024 * 1024, files: [{ name: 'hashed-chunks.bin', size: original.length }] })
  check('Hashed upload session created', upload.status === 201)
  const url = `/api/upload-sessions/${upload.data.sessionId}`
  const rejected = await api(url + '/chunks', chunk(0, '0'.repeat(64)))
  assert.equal(rejected.status, 400, 'Incorrect SHA-256 must return 400 instead of 500')
  check('Rejected SHA-256 does not mark a chunk complete', (await api(url)).data.files[0].uploadedChunks.length === 0)
  // 临时文件清理已改为异步（受限文件系统上同步删除会阻塞请求），断言改为轮询等待
  let tmpClean = false
  for (let i = 0; i < 100; i++) {
    tmpClean = fs.readdirSync(path.join(fixture, 'storage', 'tmp')).every((name) => name === 'upload-sessions')
    if (tmpClean) break
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  check('Rejected SHA-256 leaves no temporary upload file', tmpClean)
  check('Correct SHA-256 tail chunk uploads out of order', (await api(url + '/chunks', chunk(1))).status === 200)
  await stop(); await start()
  assert.deepEqual((await api(url)).data.files[0].uploadedChunks, [1], 'Restart must restore the tail chunk')
  check('Correct SHA-256 full chunk uploads after restart', (await api(url + '/chunks', chunk(0))).status === 200)
  check('Retrying the same hashed chunk succeeds', (await api(url + '/chunks', chunk(0))).status === 200)
  assert.deepEqual((await api(url)).data.files[0].uploadedChunks, [0, 1], 'Retry must not double-count a chunk')
  for (const scenario of [
    { result: 'stream: Heuristics.Limits.Exceeded.MaxFileSize FOUND', status: 415, code: 'scan_size_limit', limit: 'MaxFileSize', message: '约 2 GB' },
    { result: 'stream: Heuristics.Limits.Exceeded.MaxScanSize FOUND', status: 415, code: 'scan_size_limit', limit: 'MaxScanSize', message: '解压后的总量' },
    { result: 'stream: Heuristics.Limits.Exceeded.MaxScanTime FOUND', status: 503, code: 'scan_timeout', limit: 'MaxScanTime', message: '处理时间' },
    { result: 'stream: Heuristics.Limits.Exceeded.MaxRecursion FOUND', status: 415, code: 'scan_size_limit', limit: 'MaxRecursion', message: '嵌套层数' },
    { result: 'stream: Heuristics.Limits.Exceeded.MaxFiles FOUND', status: 415, code: 'scan_size_limit', limit: 'MaxFiles', message: '文件数量' },
    { result: 'INSTREAM size limit exceeded. ERROR', status: 415, code: 'scan_size_limit', limit: 'StreamMaxLength', message: '接收上限' },
    { result: 'stream: fixture scan error ERROR', status: 503, code: 'scan_incomplete', message: '未完成' },
  ]) {
    scannerResult = scenario.result
    const rejected = await api(url + '/complete', {})
    check('Specific scan diagnostic: ' + scenario.limit + '/' + scenario.code, rejected.status === scenario.status && rejected.data.code === scenario.code && rejected.data.scanLimit === scenario.limit && rejected.data.message.includes(scenario.message))
    check('Scan failure preserves complete chunks and publishes nothing', JSON.parse(fs.readFileSync(path.join(fixture, 'storage/metadata.json'), 'utf8')).shares.length === 0 && (await api(url)).data.files[0].uploadedChunks.length === 2)
  }
  scannerResult = 'stream: OK'
  const completed = await api(url + '/complete', {})
  check('Hashed upload publishes after scanning', completed.status === 201 && completed.data.share.files[0].scanEngine === 'clamav')
  check('Each scan retry receives the complete original bytes', scanned.length === 8 && scanned.every(bytes => bytes.equals(original)))
  const download = await fetch(base + `/api/shares/${completed.data.share.id}/files/0/download`, { headers: { cookie: 'kunqiong_session=upload-fixture-session' } })
  check('Downloaded file matches all original bytes', download.status === 200 && Buffer.from(await download.arrayBuffer()).equals(original))
  check('Completed upload session removed', (await api(url)).status === 404)

  async function prepared(name = 'background.bin') {
    const upload = await api('/api/upload-sessions', { chunkSize: 1024 * 1024, files: [{ name, size: original.length }] })
    assert.equal(upload.status, 201)
    const url = `/api/upload-sessions/${upload.data.sessionId}`
    assert.equal((await api(url + '/chunks', chunk(0))).status, 200)
    assert.equal((await api(url + '/chunks', chunk(1))).status, 200)
    return url
  }
  async function until(fn) {
    for (let i = 0; i < 150; i++) { const result = await fn(); if (result) return result; await delay(20) }
    throw new Error('Timed out waiting for background upload: ' + errors)
  }
  const shares = () => JSON.parse(fs.readFileSync(path.join(fixture, 'storage/metadata.json'), 'utf8')).shares
  const batchFiles = [Buffer.from('parallel-file-one'), Buffer.from('parallel-file-two')]
  const batchCreate = await api('/api/upload-sessions', { files: batchFiles.map((bytes, index) => ({ name: `parallel-${index}.txt`, size: bytes.length })) })
  assert.equal(batchCreate.status, 201)
  const batchUrl = `/api/upload-sessions/${batchCreate.data.sessionId}`
  for (const [index, bytes] of batchFiles.entries()) {
    const body = new FormData()
    for (const [key, value] of Object.entries({ fileIndex: index, chunkIndex: 0, totalChunks: 1, chunkHash: createHash('sha256').update(bytes).digest('hex') })) body.append(key, String(value))
    body.append('chunk', new Blob([bytes]), 'chunk')
    assert.equal((await api(batchUrl + '/chunks', body)).status, 200)
  }
  holdScan = true
  await api(batchUrl + '/complete', { background: true })
  await until(() => heldScans.length === 2)
  const batchState = (await api(batchUrl)).data.completion
  check('Independent batch files scan concurrently with actual progress counters', batchState.activeFileCount === 2 && batchState.completedFileCount === 0 && batchState.fileCount === 2)
  heldScans.shift()()
  await until(async () => (await api(batchUrl)).data.completion.completedFileCount === 1)
  check('Partial safety approval cannot publish a batch', (await api(batchUrl)).data.completion.status === 'scanning')
  holdScan = false; heldScans.shift()()
  const batchResult = await until(async () => { const completion = (await api(batchUrl)).data.completion; return completion.status === 'complete' && completion })
  check('Batch publishes only after every file is approved', batchResult.result.share.files.length === 2 && batchResult.result.share.files.every(file => file.reviewStatus === 'approved'))
  const backgroundUrl = await prepared(), scanCount = scanned.length, beforeShares = shares().length
  holdScan = true
  const before = Date.now()
  const accepted = await api(backgroundUrl + '/complete', { background: true })
  check('Background completion returns 202 before scanner verdict', accepted.status === 202 && Date.now() - before < 1000 && accepted.data.completion.status === 'scanning')
  await until(() => heldScans.length)
  const pending = (await api(backgroundUrl)).data.completion
  check('Status reports actual scan start time and current file', pending.status === 'scanning' && Number.isFinite(Date.parse(pending.startedAt)) && pending.currentFile === 'background.bin' && pending.fileIndex === 1)
  check('Repeated start attaches to one scanner job', (await api(backgroundUrl + '/complete', { background: true, retry: true })).data.completion.startedAt === pending.startedAt && scanned.length === scanCount + 1)
  const denied = await fetch(base + backgroundUrl)
  check('Other session cannot query owner scan results', denied.status === 403)
  const deleted = await fetch(base + backgroundUrl, { method: 'DELETE', headers: { cookie: 'kunqiong_session=upload-fixture-session' } })
  check('Active scanner input cannot be deleted', deleted.status === 409)
  check('Active scanner input cannot be overwritten', (await api(backgroundUrl + '/chunks', chunk(0))).status === 409)
  check('No resource is published before scan approval', shares().length === beforeShares)
  holdScan = false; heldScans.shift()()
  const finished = await until(async () => { const state = (await api(backgroundUrl)).data.completion; return state.status === 'complete' && state })
  check('Polling recovers published result without another complete request', Boolean(finished.result.share.manageToken) && finished.result.share.files[0].reviewStatus === 'approved')
  const repeat = await api(backgroundUrl + '/complete', { background: true })
  check('Lost final response cannot duplicate publication', repeat.data.completion.result.share.id === finished.result.share.id && shares().length === beforeShares + 1 && scanned.length === scanCount + 1)
  await stop(); await start()
  check('Published result survives server restart', (await api(backgroundUrl)).data.completion.result.share.id === finished.result.share.id)
  check('Restarted completion remains idempotent', (await api(backgroundUrl + '/complete', { background: true })).data.completion.result.share.id === finished.result.share.id && scanned.length === scanCount + 1)

  const blockedUrl = await prepared(), blockedCount = scanned.length
  scannerResult = 'stream: Fixture.Threat FOUND'
  await api(blockedUrl + '/complete', { background: true })
  const blocked = await until(async () => { const state = (await api(blockedUrl)).data.completion; return state.status === 'failed' && state })
  check('Threat verdict persists as an explicit safe error', blocked.error.status === 415 && blocked.error.code === 'scan_threat_detected')
  await api(blockedUrl + '/complete', { background: true, retry: true })
  check('Risk file is never published or repeatedly rescanned', scanned.length === blockedCount + 1 && shares().length === beforeShares + 1)
  const duplicateRisk = await prepared()
  await api(duplicateRisk + '/complete', { background: true })
  const repeatedRisk = await until(async () => { const completion = (await api(duplicateRisk)).data.completion; return completion.status === 'failed' && completion })
  check('Same risky content in a new upload is blocked without another scanner request', repeatedRisk.error.code === 'scan_threat_detected' && scanned.length === blockedCount + 1 && shares().length === beforeShares + 1)
  await stop(); await start()
  check('Threat verdict survives restart with original chunks intact', (await api(blockedUrl)).data.completion.error.code === 'scan_threat_detected' && (await api(blockedUrl)).data.files[0].uploadedChunks.length === 2)

  const installerUrl = await prepared('setup.exe'), beforeInstallerShares = shares().length
  scannerResult = 'stream: Heuristics.Limits.Exceeded.MaxFiles FOUND'
  await api(installerUrl + '/complete', { background: true })
  const installerFailure = await until(async () => { const completion = (await api(installerUrl)).data.completion; return completion.status === 'failed' && completion })
  check('EXE count limit reports incomplete embedded-content checking without archive instructions', installerFailure.error.status === 415 && installerFailure.error.code === 'scan_size_limit' && installerFailure.error.scanLimit === 'MaxFiles' && installerFailure.error.message.includes('内嵌') && installerFailure.error.message.includes('未完成') && !installerFailure.error.message.includes('分成多个压缩包'))
  check('EXE exceeding scan budget is never published and retains all uploaded chunks', shares().length === beforeInstallerShares && (await api(installerUrl)).data.files[0].uploadedChunks.length === 2)

  const interruptedUrl = await prepared()
  scannerResult = 'stream: OK'; holdScan = true
  await api(interruptedUrl + '/complete', { background: true })
  await until(() => heldScans.length)
  await stop(); holdScan = false; heldScans.shift()(); await start()
  check('Restart during scan preserves chunks and reports retryable interruption', (await api(interruptedUrl)).data.completion.error.code === 'scan_interrupted')
  const interruptCount = scanned.length
  await api(interruptedUrl + '/complete', { background: true, retry: true })
  await until(async () => (await api(interruptedUrl)).data.completion.status === 'complete')
  check('Explicit retry after interruption scans full bytes once', scanned.length === interruptCount + 1 && scanned.at(-1).equals(original) && shares().length === beforeShares + 2)

  const timeoutUrl = await prepared()
  scannerResult = 'stream: Heuristics.Limits.Exceeded.MaxScanTime FOUND'
  await api(timeoutUrl + '/complete', { background: true })
  await until(async () => (await api(timeoutUrl)).data.completion.status === 'failed')
  const timeoutCount = scanned.length
  await api(timeoutUrl + '/complete', { background: true })
  check('Polling or repeated starts cannot auto-retry failed scans', scanned.length === timeoutCount && (await api(timeoutUrl)).data.completion.error.scanLimit === 'MaxScanTime')
  scannerResult = 'stream: OK'
  await api(timeoutUrl + '/complete', { background: true, retry: true })
  await until(async () => (await api(timeoutUrl)).data.completion.status === 'complete')
  check('Explicit scanner retry completes without retransferring chunks', scanned.length === timeoutCount + 1 && scanned.at(-1).equals(original))
  const expiredUrl = await prepared(), beforeLogout = shares().length
  holdScan = true
  await api(expiredUrl + '/complete', { background: true })
  await until(() => heldScans.length)
  await api('/api/auth/logout', {})
  check('Logging out immediately denies access to background results', (await api(expiredUrl)).status === 403)
  holdScan = false; heldScans.shift()()
  const manifestPath = path.join(fixture, 'storage/tmp/upload-sessions', expiredUrl.split('/').at(-1), 'session.json')
  const revoked = await until(() => { const state = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).completion; return state.status === 'failed' && state })
  check('Lost authorization during async scan blocks publication', revoked.error.status === 403 && shares().length === beforeLogout)
  console.log(`Upload chunk regression: ${passed}/${passed} checks plus status and resume assertions passed`)
} finally {
  await stop()
  await new Promise((resolve) => scanner.close(resolve))
}
