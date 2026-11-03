import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { createStartupLifecycle } from '../server/lib/startup-lifecycle.js'

function copyDirectory(source, target) {
  fs.mkdirSync(target, { recursive: true })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name), to = path.join(target, entry.name)
    if (entry.isDirectory()) copyDirectory(from, to)
    else if (entry.isFile()) fs.copyFileSync(from, to)
  }
}

test('initialization runs once and readiness follows completion', async () => {
  let finish, calls = 0
  const pending = new Promise(resolve => { finish = resolve })
  const startup = createStartupLifecycle({
    async initialize(stage) { calls++; stage('metadata'); await pending },
    onError: assert.fail,
  })
  const first = startup.start()
  assert.equal(startup.start(), first)
  await delay(0)
  assert.equal(startup.ready, false)
  assert.equal(startup.stage, 'metadata')
  finish()
  await first
  assert.equal(calls, 1)
  assert.equal(startup.ready, true)
  let allowed = false
  startup.middleware({ path: '/api/upload-sessions' }, {}, () => { allowed = true })
  assert.equal(allowed, true)
})

test('shutdown during initialization never publishes readiness', async () => {
  let finish
  const pending = new Promise(resolve => { finish = resolve })
  const startup = createStartupLifecycle({ initialize: () => pending, onError: assert.fail })
  const run = startup.start()
  startup.stop()
  finish()
  await run
  assert.equal(startup.status, 'stopping')
  assert.equal(startup.ready, false)
})

test('database startup makes no queries and a failed on-demand request leaves pages available', { timeout: 20000 }, async (t) => {
  const root = path.resolve(import.meta.dirname, '..')
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-http-startup-'))
  const sockets = new Set()
  let rejectHandshake = false
  const database = net.createServer(socket => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    // Accept TCP but deliberately never send a MySQL handshake.
    if (rejectHandshake) socket.destroy()
  })
  await new Promise(resolve => database.listen(0, '127.0.0.1', resolve))
  let child
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exit = once(child, 'exit')
      child.kill('SIGKILL')
      await exit
    }
    for (const socket of sockets) socket.destroy()
    await new Promise(resolve => database.close(resolve))
    assert.ok(fixture.startsWith(path.join(os.tmpdir(), 'kunqiong-http-startup-')))
    fs.rmSync(fixture, { recursive: true, force: true })
  })
  fs.copyFileSync(path.join(root, 'server.mjs'), path.join(fixture, 'server.mjs'))
  fs.copyFileSync(path.join(root, 'package.json'), path.join(fixture, 'package.json'))
  copyDirectory(path.join(root, 'server'), path.join(fixture, 'server'))
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  fs.mkdirSync(path.join(fixture, 'dist'))
  fs.writeFileSync(path.join(fixture, 'dist/index.html'), '<!doctype html><html><body>startup-page-fixture</body></html>')
  fs.writeFileSync(path.join(fixture, 'dist/app.js'), 'window.startupFixture = true')
  const probe = net.createServer()
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (key.startsWith('KUNQIONG_') || key.startsWith('OAUTH_')) delete env[key]
  child = spawn(process.execPath, ['server.mjs'], {
    cwd: fixture, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production',
      KUNQIONG_DB_ENABLED: 'true', KUNQIONG_RELATIONAL_SCHEMA_ENABLED: 'false',
      KUNQIONG_DB_HOST: '127.0.0.1', KUNQIONG_DB_PORT: String(database.address().port),
      KUNQIONG_DB_NAME: 'fixture', KUNQIONG_DB_USER: 'fixture', KUNQIONG_DATA_KEY: 'ab'.repeat(32),
    },
  })
  let logs = ''
  child.stdout.on('data', chunk => { logs += chunk })
  child.stderr.on('data', chunk => { logs += chunk })
  const base = `http://127.0.0.1:${port}`
  const request = (url, options = {}) => fetch(`${base}${url}`, { signal: AbortSignal.timeout(1500), ...options })
  let live
  for (let attempt = 0; attempt < 80; attempt++) {
    try { live = await request('/api/health/live'); break } catch {}
    if (child.exitCode !== null) break
    await delay(50)
  }
  assert.equal(live?.status, 200, logs)
  assert.equal((await live.json()).ok, true)
  const cookie = { cookie: 'kunqiong_session=must-not-query-before-ready' }
  const health = await request('/api/health', { headers: cookie })
  assert.equal(health.status, 200)
  assert.equal((await health.json()).status, 'ready')
  assert.match(await (await request('/')).text(), /startup-page-fixture/)
  assert.equal((await request('/app.js')).status, 200)
  assert.equal(sockets.size, 0, 'HTTP startup and health must not open a database connection')
  const pending = request('/api/runtime-config')
  for (let attempt = 0; attempt < 40 && sockets.size === 0; attempt++) await delay(10)
  assert.equal(sockets.size, 1, 'The database connection should open only after a business request')
  assert.equal(fs.existsSync(path.join(fixture, 'storage/metadata.json')), false)
  // The connection layer may retry a failed handshake once; fail that fresh
  // socket too, while keeping the HTTP response bounded by the original test deadline.
  rejectHandshake = true
  for (const socket of sockets) socket.destroy()
  assert.equal((await pending).status, 503)
  assert.equal((await (await request('/api/health')).json()).status, 'ready')
  assert.equal((await request('/api/health/live')).status, 200)
  assert.match(await (await request('/')).text(), /startup-page-fixture/)
  assert.equal(fs.existsSync(path.join(fixture, 'storage/metadata.json')), false)
})
