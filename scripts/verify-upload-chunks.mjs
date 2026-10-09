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
fs.copyFileSync(path.join(root, 'server.mjs'), path.join(fixture, 'server.mjs'))
fs.copyFileSync(path.join(root, 'package.json'), path.join(fixture, 'package.json'))
fs.cpSync(path.join(root, 'server'), path.join(fixture, 'server'), { recursive: true })
fs.cpSync(path.join(root, 'email-templates'), path.join(fixture, 'email-templates'), { recursive: true })
fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
const user = { id: 'owner', username: 'owner', status: 'active', planId: 'free' }
fs.mkdirSync(path.join(fixture, 'storage'))
fs.writeFileSync(path.join(fixture, 'storage', 'metadata.json'), JSON.stringify({
  users: { owner: user }, sessions: [{ id: 'upload-fixture-session', user, expiresAt: new Date(Date.now() + 3600000).toISOString() }],
}))
const scanned = []
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
        socket.end('stream: OK\0')
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
  check('Rejected SHA-256 leaves no temporary upload file', fs.readdirSync(path.join(fixture, 'storage', 'tmp')).every((name) => name === 'upload-sessions'))
  check('Correct SHA-256 tail chunk uploads out of order', (await api(url + '/chunks', chunk(1))).status === 200)
  await stop(); await start()
  assert.deepEqual((await api(url)).data.files[0].uploadedChunks, [1], 'Restart must restore the tail chunk')
  check('Correct SHA-256 full chunk uploads after restart', (await api(url + '/chunks', chunk(0))).status === 200)
  check('Retrying the same hashed chunk succeeds', (await api(url + '/chunks', chunk(0))).status === 200)
  assert.deepEqual((await api(url)).data.files[0].uploadedChunks, [0, 1], 'Retry must not double-count a chunk')
  const completed = await api(url + '/complete', {})
  check('Hashed upload publishes after scanning', completed.status === 201 && completed.data.share.files[0].scanEngine === 'clamav')
  check('Scanner receives all original bytes', scanned.length === 1 && scanned[0].equals(original))
  const download = await fetch(base + `/api/shares/${completed.data.share.id}/files/0/download`, { headers: { cookie: 'kunqiong_session=upload-fixture-session' } })
  check('Downloaded file matches all original bytes', download.status === 200 && Buffer.from(await download.arrayBuffer()).equals(original))
  check('Completed upload session removed', (await api(url)).status === 404)
  console.log(`Upload chunk regression: ${passed}/${passed} checks plus status and resume assertions passed`)
} finally {
  await stop()
  await new Promise((resolve) => scanner.close(resolve))
}
