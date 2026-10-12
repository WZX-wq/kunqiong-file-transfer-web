// Optional heavyweight integration. Build kunqiong-acceptance:local first.
// Uses generated deployment Compose, synthetic users, isolated volumes and bounded tmpfs.
import assert from 'node:assert/strict'
import { restoreFixtureAudit } from './lib/read-audit-fixture.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { Readable } from 'node:stream'
import { execFileSync, spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const root = path.resolve(import.meta.dirname, '..')
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-container-'))
const project = 'kq-acceptance-' + crypto.randomBytes(4).toString('hex')
const image = process.env.ACCEPTANCE_IMAGE || 'kunqiong-acceptance:local'
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const release = revision + '-worktree'
const evidence = process.env.ACCEPTANCE_EVIDENCE_DIR || fixture
fs.mkdirSync(evidence, { recursive: true })
let passed = 0, current = '', failures = [], requests = [], cases = [], measurements = {}, log = ''
function check(label, value) {
  if (value) { passed++; console.log('PASS ' + current + ' ' + label) }
  else { failures.push({ id: current, message: label }); console.log('FAIL ' + current + ' ' + label) }
}
async function group(id, fn) {
  current = id; const before = failures.length
  try { await fn() } catch (e) { failures.push({ id, message: e.message }); console.log('ERROR ' + id + ' ' + e.message) }
  cases.push({ id, status: before === failures.length ? 'PASS' : 'FAIL' })
}
function docker(args) { return execFileSync('docker', args, { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 ** 2 }).trim() }
const composeArgs = ['compose', '-p', project, '-f', path.join(fixture, 'compose.yml'), '-f', path.join(fixture, 'fault.yml')]
function compose(args) { return docker([...composeArgs, ...args]) }
async function composeAsync(args) {
  const p = spawn('docker', [...composeArgs, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  p.stdout.on('data', b => { log += b; process.stdout.write(b) }); p.stderr.on('data', b => { log += b; process.stdout.write(b) })
  const code = await new Promise(resolve => p.on('exit', resolve)); assert.equal(code, 0, 'Compose command failed')
}
const probe = net.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r))
const port = probe.address().port; await new Promise(r => probe.close(r))
const base = 'http://127.0.0.1:' + port
// Read the actual deployment template instead of maintaining another app/scanner definition.
const deploy = fs.readFileSync(path.join(root, 'scripts/deploy-test.sh'), 'utf8')
let template = deploy.slice(deploy.indexOf('write_compose_file()')).match(/cat > "\$target" <<EOF\r?\n([\s\S]*?)\r?\nEOF/)[1]
for (const [key, value] of Object.entries({ APP_NAME: project, IMAGE_NAME: image, PORT: port, COMPOSE_DIR: fixture.replaceAll('\\', '/') })) template = template.replaceAll('$' + key, String(value))
assert.ok(!/\$[A-Z_]+/.test(template), 'All Compose variables must be resolved')
fs.writeFileSync(path.join(fixture, 'compose.yml'), template)
fs.copyFileSync(path.join(root, 'deployment/clamd.conf'), path.join(fixture, 'clamd.conf'))
fs.writeFileSync(path.join(fixture, '.env'), [
  'NODE_ENV=production', 'PORT=' + port, 'KUNQIONG_HOST=0.0.0.0', 'KUNQIONG_DB_ENABLED=false',
  'KUNQIONG_ADMIN_USERNAME=fixture-admin', 'KUNQIONG_ADMIN_PASSWORD=fixture-password',
  'KUNQIONG_RELEASE_SHA=' + release, 'KUNQIONG_SCAN_TIMEOUT_MS=600000',
].join('\n'))
// Fault service has the same single-filesystem storage layout as deployment,
// bounded to 32MiB. No host filesystem is filled.
fs.writeFileSync(path.join(fixture, 'fault.yml'), JSON.stringify({ services: { fault: {
  image, env_file: [path.join(fixture, '.env')], environment: { KUNQIONG_SCAN_MODE: 'required', KUNQIONG_CLAMAV_HOST: 'scanner', KUNQIONG_CLAMAV_PORT: '3310' },
  ports: ['127.0.0.1::' + port], tmpfs: ['/app/storage:size=33554432'],
  depends_on: { scanner: { condition: 'service_healthy' } },
} } }, null, 2))

const future = new Date(Date.now() + 86400000).toISOString()
const users = Object.fromEntries(['a', 'b', 'c', 'quota', 'stranger'].map(id => [id, { id, username: 'fixture-' + id, nickname: 'fixture-' + id, planId: 'free', status: 'active' }]))
const safePath = path.join(root, '测试数据/鲲穹文件传输测试数据包/01-安全文件集/TC-03-01-安全文本-可预览.txt')
const largePath = path.join(root, '测试数据/鲲穹文件传输测试数据包/02-边界大小文件/TC-04-01-单文件大小边界-500MB.bin')
const safe = fs.readFileSync(safePath), size = fs.statSync(largePath).size, chunkSize = 8 * 1024 ** 2
assert.equal(size, 500 * 1024 ** 2, 'Requires real 500MiB boundary dataset')
const seed = { users, sessions: Object.values(users).map(user => ({ id: user.id + '-session', user, expiresAt: future })),
  shares: [{ id: 'quota-filler', code: 'QUOTAF', ownerUserId: 'quota', status: 'active', expiresAt: future, createdAt: new Date().toISOString(), files: [{ name: 'quota accounting only', size: 20 * 1024 ** 3 - 750 * 1024 ** 2 }] }],
  collections: [{ id: 'quota-task', token: 'quota-task', manageToken: 'quota-task-manage', title: 'Concurrent quota fixture', ownerUserId: '', status: 'active', createdAt: new Date().toISOString(), deadline: future, maxFileSizeMb: 500, allowedTypes: ['全部格式'], capacityBytes: 750 * 1024 ** 2, submissions: [] }],
}
fs.writeFileSync(path.join(fixture, 'metadata.json'), JSON.stringify(seed))
const auth = user => user ? { cookie: 'kunqiong_session=' + user + '-session' } : {}
async function api(url, { user = '', method = 'GET', body, headers = {}, origin = base } = {}) {
  const r = await fetch(origin + url, { method, headers: { connection: 'close', ...auth(user), ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...headers }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined })
  const bytes = Buffer.from(await r.arrayBuffer()); let data; try { data = JSON.parse(bytes.toString()) } catch { data = {} }
  requests.push({ case: current, method, url, status: r.status }); return { status: r.status, data, bytes, headers: r.headers }
}
function form(bytes = safe, name = 'safe.txt', fields = {}) {
  const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v)
  f.append('files', new Blob([bytes]), name); return f
}
function metadata(service = 'app') {
  const stored = JSON.parse(compose(['exec', '-T', service, 'node', '-e', "const fs=require('fs'),dir='/app/storage/audit/';const value={metadata:JSON.parse(fs.readFileSync('/app/storage/metadata.json','utf8'))};if(fs.existsSync(dir+'snapshot.json')){value.snapshot=JSON.parse(fs.readFileSync(dir+'snapshot.json','utf8'));value.journal=fs.readFileSync(dir+'events.jsonl').toString('base64')}process.stdout.write(JSON.stringify(value))"]))
  return stored.snapshot ? restoreFixtureAudit(stored.metadata, stored.snapshot, Buffer.from(stored.journal, 'base64')) : stored.metadata
}
function memory(service = 'app') { return Number(compose(['exec', '-T', service, 'node', '-e', "process.stdout.write(require('fs').readFileSync('/proc/1/status','utf8').match(/VmRSS:\\s+(\\d+)/)[1])"])) * 1024 }
async function healthy(service) {
  const id = compose(['ps', '-a', '-q', service])
  for (let i = 0; i < 300; i++) {
    const state = JSON.parse(docker(['inspect', '-f', '{{json .State}}', id]))
    if (state.Health?.Status === 'healthy') return state
    if (state.Status === 'exited') throw Error(service + ' exited: ' + state.ExitCode)
    await delay(1000)
  }
  throw Error(service + ' health timeout')
}
async function session(user, name, extra = {}) { return api('/api/upload-sessions', { user, method: 'POST', body: { files: [{ name, size }], chunkSize, ...extra } }) }
async function chunk(user, id, bytes, index, count, origin = base) {
  const f = new FormData(); for (const [k, v] of Object.entries({ fileIndex: 0, chunkIndex: index, totalChunks: count, chunkHash: crypto.createHash('sha256').update(bytes).digest('hex') })) f.append(k, String(v))
  f.append('chunk', new Blob([bytes]), 'chunk')
  return api('/api/upload-sessions/' + id + '/chunks', { user, method: 'POST', body: f, origin })
}
async function uploadChunks(user, name, extra = {}) {
  const created = await session(user, name, extra); assert.equal(created.status, 201, JSON.stringify(created.data)); const id = created.data.sessionId
  const fd = fs.openSync(largePath, 'r'), count = Math.ceil(size / chunkSize)
  try {
    for (let index = 0; index < count; index++) {
      const bytes = Buffer.allocUnsafe(Math.min(chunkSize, size - index * chunkSize)); assert.equal(fs.readSync(fd, bytes, 0, bytes.length, index * chunkSize), bytes.length)
      const r = await chunk(user, id, bytes, index, count); assert.equal(r.status, 200, JSON.stringify(r.data))
      if (index === 2) {
        const progress = await api('/api/upload-sessions/' + id, { user }); assert.equal(progress.data.files[0].uploadedChunks.length, 3)
        const retry = await chunk(user, id, bytes, index, count); assert.equal(retry.status, 200)
        assert.equal((await api('/api/upload-sessions/' + id, { user })).data.files[0].uploadedChunks.length, 3)
      }
      if ((index + 1) % 16 === 0) console.log('500MiB ' + user + ' ' + (index + 1) + '/' + count)
    }
  } finally { fs.closeSync(fd) }
  const done = await api('/api/upload-sessions/' + id + '/complete', { user, method: 'POST', body: {} }); assert.equal(done.status, 201, JSON.stringify(done.data)); return done.data
}
async function directUpload(user) {
  const boundary = 'kq-fixture-' + crypto.randomBytes(12).toString('hex')
  async function* bytes() {
    yield Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="files"; filename="500MiB-direct.bin"\r\nContent-Type: application/octet-stream\r\n\r\n')
    for await (const b of fs.createReadStream(largePath)) yield b
    yield Buffer.from('\r\n--' + boundary + '--\r\n')
  }
  const r = await fetch(base + '/api/shares', { method: 'POST', headers: { connection: 'close', ...auth(user), 'content-type': 'multipart/form-data; boundary=' + boundary }, body: Readable.from(bytes()), duplex: 'half' })
  const data = await r.json(); assert.equal(r.status, 201, JSON.stringify(data)); return data
}
async function digest(url, headers = {}) {
  const r = await fetch(base + url, { headers: { connection: 'close', ...headers } }); assert.equal(r.status, 200)
  const hash = crypto.createHash('sha256'); let bytes = 0
  for await (const b of r.body) { hash.update(b); bytes += b.length }
  return { bytes, sha256: hash.digest('hex') }
}
function zipContent(b) {
  let end = b.length - 22; while (end >= 0 && b.readUInt32LE(end) !== 0x06054b50) end--
  assert.ok(end >= 0); assert.equal(b.readUInt16LE(end + 10), 1)
  const off = b.readUInt32LE(end + 16), local = b.readUInt32LE(off + 42), length = b.readUInt32LE(off + 20), method = b.readUInt16LE(off + 10)
  const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28), compressed = b.subarray(start, start + length)
  return method === 8 ? zlib.inflateRawSync(compressed) : compressed
}
let smokeShare, smokeCollection
try {
  await composeAsync(['create'])
  docker(['cp', path.join(fixture, 'metadata.json'), compose(['ps', '-a', '-q', 'app']) + ':/app/storage/metadata.json'])
  await composeAsync(['up', '-d', '--wait', '--wait-timeout', '300'])
  await group('SMOKE-06/07', async () => {
    const health = await api('/api/health'); check('release matches explicit worktree build', health.status === 200 && health.data.ok && health.data.release === release)
    check('app and scanner healthy', (await healthy('app')).Health.Status === 'healthy' && (await healthy('scanner')).Health.Status === 'healthy')
    const runtimeHash = compose(['exec', '-T', 'app', 'node', '-e', "process.stdout.write(require('crypto').createHash('sha256').update(require('fs').readFileSync('/app/server.mjs')).digest('hex'))"])
    check('container entry matches current worktree', runtimeHash === crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'server.mjs'))).digest('hex'))
    measurements.scannerVersion = compose(['exec', '-T', 'scanner', 'clamd', '--version'])
    measurements.composeStatus = compose(['ps', '--format', 'json']).split('\n').map(line => { const row = JSON.parse(line); return { service: row.Service, state: row.State, health: row.Health } })
  })
  await group('SMOKE-02/03/08', async () => {
    const upload = await api('/api/shares', { method: 'POST', body: form() }); assert.equal(upload.status, 201, JSON.stringify(upload.data)); smokeShare = upload.data.share
    check('guest share code and QR exist', !!smokeShare.code && smokeShare.qrDataUrl.startsWith('data:image/png'))
    check('guest lookup and download', (await api('/api/shares/lookup/' + smokeShare.code)).status === 200 && (await api('/api/shares/' + smokeShare.id + '/files/0/download')).bytes.equals(safe))
    const task = await api('/api/collections', { method: 'POST', body: { title: 'container smoke' } }); assert.equal(task.status, 201); smokeCollection = task.data
    const submit = await api('/api/collections/' + task.data.collection.token + '/submissions', { method: 'POST', body: form(safe, 'safe.txt', { participantName: 'guest-fixture' }) }); assert.equal(submit.status, 201)
    check('anonymous collection visible to manager', (await api('/api/collections/manage/' + task.data.manageToken)).data.collection.submissions.length === 1)
    compose(['restart', 'app']); await healthy('app')
    check('container restart preserves share bytes', (await api('/api/shares/' + smokeShare.id + '/files/0/download')).bytes.equals(safe))
    const zip = await api('/api/collections/manage/' + task.data.manageToken + '/download'); check('container restart preserves collection ZIP bytes', zip.status === 200 && zipContent(zip.bytes).equals(safe))
  })
  await group('NFR-007', async () => {
    const reservations = await Promise.all(['quota-a.bin', 'quota-b.bin'].map(name => session('quota', name)))
    check('500MiB reservations cannot oversell 750MiB capacity', reservations.filter(x => x.status === 201).length === 1 && reservations.filter(x => x.status === 507).length === 1)
    const id = reservations.find(x => x.status === 201).data.sessionId
    check('other user cannot query/write/complete session', (await api('/api/upload-sessions/' + id, { user: 'stranger' })).status === 403 && (await chunk('stranger', id, Buffer.alloc(1), 0, 63)).status === 403 && (await api('/api/upload-sessions/' + id + '/complete', { user: 'stranger', method: 'POST', body: {} })).status === 403)
    await api('/api/upload-sessions/' + id, { user: 'quota', method: 'DELETE' })
    const retry = await session('quota', 'retry.bin'); check('cancel releases reservation for 500MiB retry', retry.status === 201); await api('/api/upload-sessions/' + retry.data.sessionId, { user: 'quota', method: 'DELETE' })
    const collectionReservations = await Promise.all(['b', 'c'].map(user => session(user, user + '-quota.bin', { mode: 'collection', collectionToken: 'quota-task', participantName: user })))
    check('collection reservations cannot oversell 750MiB capacity', collectionReservations.filter(x => x.status === 201).length === 1 && collectionReservations.filter(x => x.status === 507).length === 1)
    for (let i = 0; i < collectionReservations.length; i++) if (collectionReservations[i].status === 201) await api('/api/upload-sessions/' + collectionReservations[i].data.sessionId, { user: ['b', 'c'][i], method: 'DELETE' })
    const task = await api('/api/collections', { user: 'a', method: 'POST', body: { title: '500MiB concurrency', maxFileSizeMb: 500 } }); assert.equal(task.status, 201)
    const hash = crypto.createHash('sha256'); for await (const b of fs.createReadStream(largePath)) hash.update(b); const expectedHash = hash.digest('hex')
    const baselineRss = memory(); let peakRss = baselineRss
    const sampler = setInterval(() => { try { peakRss = Math.max(peakRss, memory()) } catch {} }, 2000)
    const start = Date.now(); let results
    try { results = await Promise.all([directUpload('a'), uploadChunks('b', '500MiB-chunk.bin'), uploadChunks('c', '500MiB-collect.bin', { mode: 'collection', collectionToken: task.data.collection.token, participantName: 'c' })]) } finally { clearInterval(sampler) }
    check('three concurrent real 500MiB transfers pass ClamAV', results[0].share.files[0].scanEngine === 'clamav' && results[1].share.files[0].reviewStatus === 'approved' && results[2].submission.files[0].reviewStatus === 'approved')
    for (let i = 0; i < 2; i++) {
      const r = await digest('/api/shares/' + results[i].share.id + '/files/0/download')
      check('500MiB share ' + i + ' download byte/hash integrity', r.bytes === size && r.sha256 === expectedHash)
    }
    const saved = metadata().collections.find(x => x.token === task.data.collection.token).submissions[0]
    const storedHash = compose(['exec', '-T', 'app', 'node', '-e', "const fs=require('fs'),c=require('crypto'),h=c.createHash('sha256');fs.createReadStream(process.argv[1]).on('data',b=>h.update(b)).on('end',()=>process.stdout.write(h.digest('hex')))" , '/app/storage/collections/' + task.data.collection.id + '/' + saved.id + '/' + saved.files[0].storedName])
    check('500MiB collection has independent bytes/hash and owner', saved.files[0].size === size && storedHash === expectedHash && saved.submitterUserId === 'c')
    check('concurrent upload memory is bounded', peakRss - baselineRss < 384 * 1024 ** 2)
    measurements.concurrency = { count: 3, fileBytes: size, totalBytes: size * 3, expectedHash, baselineRss, peakRss, rssDelta: peakRss - baselineRss, durationMs: Date.now() - start }
  })
  await group('NFR-013', async () => {
    compose(['stop', 'scanner']); const before = metadata().shares.length
    check('scanner outage rejects upload without publishing', (await api('/api/shares', { user: 'a', method: 'POST', body: form() })).status === 503 && metadata().shares.length === before)
    check('approved file remains readable during scanner outage', (await api('/api/shares/' + smokeShare.id + '/files/0/download')).bytes.equals(safe))
    const created = await api('/api/upload-sessions', { user: 'b', method: 'POST', body: { files: [{ name: 'retry.txt', size: safe.length }], chunkSize } }); assert.equal(created.status, 201)
    const id = created.data.sessionId; assert.equal((await chunk('b', id, safe, 0, 1)).status, 200)
    check('scan failure preserves completed chunks', (await api('/api/upload-sessions/' + id + '/complete', { user: 'b', method: 'POST', body: {} })).status === 503 && (await api('/api/upload-sessions/' + id, { user: 'b' })).data.files[0].uploadedChunks.length === 1)
    compose(['start', 'scanner']); await healthy('scanner')
    check('scanner recovery completes same session', (await api('/api/upload-sessions/' + id + '/complete', { user: 'b', method: 'POST', body: {} })).status === 201)
    const faultPort = compose(['port', 'fault', String(port)]).split(':').at(-1), faultBase = 'http://127.0.0.1:' + faultPort
    // Start with an actual persisted resource; empty storage persists metadata lazily.
    assert.equal((await api('/api/shares', { method: 'POST', body: form(), origin: faultBase })).status, 201)
    const diskBefore = metadata('fault').shares.length
    compose(['exec', '-T', 'fault', 'node', '-e', "const fs=require('fs'),fd=fs.openSync('/app/storage/fixture-fill','w'),b=Buffer.alloc(1048576);for(let i=0;i<31;i++)fs.writeSync(fd,b);fs.closeSync(fd)"])
    const failed = await api('/api/shares', { method: 'POST', body: form(Buffer.alloc(8 * 1024 ** 2), 'disk-full.bin'), origin: faultBase })
    check('real tmpfs ENOSPC yields 507 without publishing', failed.status === 507 && metadata('fault').shares.length === diskBefore)
    measurements.diskFull = { tmpfsBytes: 32 * 1024 ** 2, filledBytes: 31 * 1024 ** 2, attemptedBytes: 8 * 1024 ** 2, status: failed.status, responseCode: failed.data.code }
    compose(['exec', '-T', 'fault', 'node', '-e', "require('fs').unlinkSync('/app/storage/fixture-fill')"])
    check('disk recovery accepts retry', (await api('/api/shares', { method: 'POST', body: form(), origin: faultBase })).status === 201)
    const cleanupLogin = await api('/api/admin/login', { method: 'POST', body: { username: 'fixture-admin', password: 'fixture-password' } }); assert.equal(cleanupLogin.status, 200)
    const cleanup = await api('/api/admin/cleanup', { method: 'POST', headers: { cookie: cleanupLogin.headers.get('set-cookie').split(';')[0] }, body: {} })
    check('cleanup after recovery preserves active resources', cleanup.status === 200 && (await api('/api/shares/' + smokeShare.id + '/files/0/download')).bytes.equals(safe))
  })
  await group('NFR-014', async () => {
    const entries = [...metadata().auditLogs, ...metadata('fault').auditLogs].filter(x => x.type === 'access')
    check('real container logs include request/release/error context', entries.some(x => x.status === 503 && x.details?.requestId && x.details.release === release) && entries.some(x => x.status === 507 && x.details?.errorCode === 'ENOSPC'))
    const containerLog = compose(['logs', '--no-color', 'app', 'fault']); fs.writeFileSync(path.join(evidence, 'container-runtime.log'), containerLog)
    check('real container logs omit synthetic passwords and session cookies', !containerLog.includes('fixture-password') && !containerLog.includes('a-session') && !JSON.stringify(entries).includes('fixture-password'))
    check('no unhandled exceptions', !/UnhandledPromiseRejection|uncaughtException|ERR_UNHANDLED_ERROR/.test(containerLog))
  })
} finally {
  try { fs.writeFileSync(path.join(evidence, 'container-compose-status.txt'), compose(['ps', '-a'])); await composeAsync(['stop']) } catch (e) { console.log('Fixture stop: ' + e.message) }
  const result = { executedAt: new Date().toISOString(), passed, failures, cases, fixture, project, image, release, dirtyWorktree: true, base, measurements, requests }
  fs.writeFileSync(path.join(evidence, 'container-acceptance-results.json'), JSON.stringify(result, null, 2))
  fs.writeFileSync(path.join(evidence, 'container-compose.log'), log)
  console.log(JSON.stringify({ ...result, requests: undefined }, null, 2)); process.exitCode = failures.length ? 1 : 0
}
