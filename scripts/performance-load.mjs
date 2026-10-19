// Local closed-loop load test against an isolated project copy and synthetic accounts.
// Production routes, persistence, authentication, quotas and rate limits remain enabled.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { readFixtureMetadata } from './lib/read-audit-fixture.mjs'

const root = path.resolve(import.meta.dirname, '..')
function readCgroupLimit(filename) {
  try {
    const value = fs.readFileSync(filename, 'utf8').trim()
    return value === 'max' ? null : value
  } catch { return null }
}
const cgroupCpuMax = readCgroupLimit('/sys/fs/cgroup/cpu.max')
const cgroupMemoryMax = readCgroupLimit('/sys/fs/cgroup/memory.max')
const cgroupCpuQuota = cgroupCpuMax?.split(/\s+/)
const cpuQuotaCores = cgroupCpuQuota?.[1] && cgroupCpuQuota[0] !== 'max'
  ? Number(cgroupCpuQuota[0]) / Number(cgroupCpuQuota[1])
  : null
const memoryLimitGiB = cgroupMemoryMax ? Number(cgroupMemoryMax) / 1024 ** 3 : null
const collectionLoadOnly = process.argv.includes('--collections-only') || process.env.PERFORMANCE_COLLECTION_LOAD_ONLY === 'true'
const collectionRunDirectory = path.join(os.tmpdir(), `kunqiong-collection-load-${Date.now()}`)
const output = path.resolve(process.env.PERFORMANCE_EVIDENCE_DIR || (collectionLoadOnly ? collectionRunDirectory : path.join(root, 'docs/performance-evidence')))
const reportPath = path.resolve(process.env.PERFORMANCE_REPORT_PATH || (collectionLoadOnly ? path.join(output, '收集提交压测报告.md') : path.join(root, 'docs/PERFORMANCE-本机压测报告.md')))
const stageSeconds = Number(process.env.PERFORMANCE_STAGE_SECONDS || 8)
assert.ok(stageSeconds >= 2 && stageSeconds <= 30, 'Stage duration must be 2–30 seconds')
fs.mkdirSync(output, { recursive: true })
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-performance-'))
function copyDirectory(source, target) {
  fs.mkdirSync(target, { recursive: true })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.isDirectory()) copyDirectory(path.join(source, entry.name), path.join(target, entry.name))
    else if (entry.isFile()) fs.copyFileSync(path.join(source, entry.name), path.join(target, entry.name))
  }
}
for (const directory of ['server', 'email-templates']) copyDirectory(path.join(root, directory), path.join(fixture, directory))
fs.copyFileSync(path.join(root, 'package.json'), path.join(fixture, 'package.json'))
for (const directory of ['node_modules', 'dist']) fs.symlinkSync(path.join(root, directory), path.join(fixture, directory), process.platform === 'win32' ? 'junction' : 'dir')

// Metrics are injected into the disposable copy only, before audit middleware.
const metrics = `
const { monitorEventLoopDelay, performance: loadPerformance } = await import('node:perf_hooks');
const loadDelay = monitorEventLoopDelay({resolution: 10}); loadDelay.enable();
let loadPeakRss = process.memoryUsage().rss;
let loadIo = {calls: 0, milliseconds: 0, writeBytes: 0, copyBytes: 0};
const loadMemoryTimer = setInterval(() => { loadPeakRss = Math.max(loadPeakRss, process.memoryUsage().rss); }, 100); loadMemoryTimer.unref();
for (const method of ['writeFileSync', 'copyFileSync', 'renameSync']) {
 const original = fs[method];
 fs[method] = function(...args) {
  if (!String(args[0]).includes('metadata.json')) return original.apply(this, args);
  const started = loadPerformance.now();
  try {
   if (method === 'writeFileSync') loadIo.writeBytes += typeof args[1] === 'string' ? Buffer.byteLength(args[1]) : args[1].length;
   if (method === 'copyFileSync') loadIo.copyBytes += fs.statSync(args[0]).size;
   return original.apply(this, args);
  } finally { loadIo.calls++; loadIo.milliseconds += loadPerformance.now() - started; }
 };
}
app.get('/__performance/metrics', (req, res) => {
 const payload = {cpu: process.cpuUsage(), memory: process.memoryUsage(), peakRss: loadPeakRss, eventLoop: {p95Ms: loadDelay.percentile(95)/1e6, p99Ms: loadDelay.percentile(99)/1e6, maxMs: loadDelay.max/1e6}, elu: loadPerformance.eventLoopUtilization(), io: {...loadIo}, metadataBytes: fs.statSync(path.join(storageRoot, 'metadata.json')).size, auditCount: metadata.auditLogs.length};
 if (req.query.reset) {loadDelay.reset(); loadPeakRss = payload.memory.rss; loadIo = {calls:0, milliseconds:0, writeBytes:0, copyBytes:0};}
 res.json(payload);
});
app.get('/__performance/stop', (_req, res) => {res.json({ok:true}); setTimeout(() => shutdown('performance').catch(() => process.exit(1)), 50);});
`
let serverSource = fs.readFileSync(path.join(root, 'server.mjs'), 'utf8')
assert.ok(serverSource.includes('const app = express()'), 'Server metrics injection anchor')
serverSource = serverSource.replace('const app = express()', 'const app = express()\n' + metrics)
const auditAnchor = "if (req.path === '/api/health' || (!req.path.startsWith('/api/') && !req.path.startsWith('/auth/'))) return"
assert.ok(serverSource.includes(auditAnchor), 'Audit comparison anchor')
serverSource = serverSource.replace(auditAnchor, auditAnchor + "\n    if (process.env.KUNQIONG_PERF_DIAGNOSTIC_NO_ACCESS_AUDIT === 'true') return")
fs.writeFileSync(path.join(fixture, 'server.mjs'), serverSource)

const createdAt = new Date().toISOString(), expiresAt = new Date(Date.now() + 86400000).toISOString()
const users = Object.fromEntries(Array.from({ length: 20 }, (_, index) => {
  const id = 'perf-user-' + index
  return [id, { id, username: id, nickname: '压测成员' + index, planId: index ? 'free' : 'enterprise', status: 'active', organizationId: 'perf-org', organizationRole: index ? 'member' : 'owner', fileCleanup: { enabled: false, days: 7 } }]
}))
const organization = { id: 'perf-org', slug: 'perf-team', name: '隔离性能测试团队', ownerUserId: 'perf-user-0', createdAt, updatedAt: createdAt, members: Object.values(users).map(user => ({ id: 'm-' + user.id, userId: user.id, displayName: user.nickname, role: user.organizationRole, status: 'active', joinedAt: createdAt })) }
const shares = Array.from({ length: 200 }, (_, index) => ({
  id: 'perf-share-' + index, code: 'PF' + String(index).padStart(4, '0'), manageToken: 'perf-manage-' + index,
  ownerUserId: 'perf-user-' + (index % 20), teamResource: true, teamOrganizationId: organization.id,
  status: 'active', createdAt, expiresAt, downloadCount: 0,
  files: [{ name: 'sample-' + index + '.txt', relativePath: 'sample-' + index + '.txt', storedName: 'sample.txt', size: 1024, mimeType: 'text/plain', reviewStatus: 'approved', scanEngine: 'clamav', scannedAt: createdAt }],
}))
const collections = [{ id: 'perf-collection', token: 'perf-collection', manageToken: 'perf-collection-manage', title: '隔离压测收集', description: '', ownerUserId: 'perf-user-0', status: 'active', createdAt, deadline: expiresAt, allowedTypes: ['全部格式'], maxFileSizeMb: 100, submissions: [], qrDataUrl: 'data:image/png;base64,fixture' }]
const records = Object.fromEntries(Object.keys(users).map(id => [id, shares.slice(0, 20).map(share => ({ id: 'my_sent:share:' + share.id, scope: 'my_sent', kind: 'share', shareId: share.id, name: share.files[0].name, createdAt, updatedAt: createdAt }))]))
// Start at the audit retention cap so successive stages have comparable metadata size.
const auditLogs = Array.from({ length: 5000 }, (_, index) => ({ id: 'perf-log-' + index, type: 'access', action: 'GET /api/account/team/overview', status: 200, durationMs: 1, userId: 'perf-user-0', details: { release: 'performance-fixture', requestId: 'seed-' + index }, createdAt }))
fs.mkdirSync(path.join(fixture, 'storage/files'), { recursive: true })
const metadataFile = path.join(fixture, 'storage/metadata.json')
fs.writeFileSync(metadataFile, JSON.stringify({ users, shares, collections, records, auditLogs, organizations: { [organization.id]: organization }, sessions: Object.values(users).map(user => ({ id: 'perf-session-' + user.id, user, expiresAt })), messages: {}, upgradeOrders: [] }))
for (const share of shares) { const directory = path.join(fixture, 'storage/files', share.id); fs.mkdirSync(directory); fs.writeFileSync(path.join(directory, 'sample.txt'), Buffer.alloc(1024, 0x61)) }
const transferBytes = 16 * 1024 ** 2, chunkBytes = 4 * 1024 ** 2
const transferContent = crypto.randomBytes(transferBytes), expectedHash = crypto.createHash('sha256').update(transferContent).digest('hex')
const downloadShare = { ...shares[0], id: 'perf-download', code: 'PFDOWN', manageToken: 'perf-download-manage', files: [{ ...shares[0].files[0], name: '16MiB.bin', relativePath: '16MiB.bin', storedName: '16MiB.bin', size: transferBytes, mimeType: 'application/octet-stream' }] }
const metadataSeed = JSON.parse(fs.readFileSync(metadataFile, 'utf8')); metadataSeed.shares.push(downloadShare); fs.writeFileSync(metadataFile, JSON.stringify(metadataSeed))
fs.mkdirSync(path.join(fixture, 'storage/files/perf-download')); fs.writeFileSync(path.join(fixture, 'storage/files/perf-download/16MiB.bin'), transferContent)

// Scan transport remains required. This emulator measures protocol I/O, not antivirus CPU cost.
let scannerBytes = 0, scannerFiles = 0
const scanner = net.createServer(socket => {
  let pending = Buffer.alloc(0), command = false
  socket.on('error', () => {})
  socket.on('data', bytes => {
    pending = Buffer.concat([pending, bytes])
    if (!command) { const end = pending.indexOf(0); if (end < 0) return; if (pending.subarray(0, end).toString() !== 'zINSTREAM') return socket.destroy(); pending = pending.subarray(end + 1); command = true }
    while (pending.length >= 4) {
      const length = pending.readUInt32BE(0); if (pending.length < length + 4) return
      scannerBytes += length; pending = pending.subarray(length + 4)
      if (!length) { scannerFiles++; socket.end('stream: OK\0'); return }
    }
  })
})
await new Promise(resolve => scanner.listen(0, '127.0.0.1', resolve))
const env = { ...process.env }
for (const key of Object.keys(env)) if (/^(KUNQIONG_|OAUTH_)/.test(key)) delete env[key]
let child, base, stopError, serverLog = ''
async function start(diagnostic = false) {
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve))
  base = 'http://127.0.0.1:' + port
  child = spawn(process.execPath, ['--cpu-prof', '--cpu-prof-dir=' + output, '--cpu-prof-name=' + (diagnostic ? 'diagnostic' : 'normal') + '.cpuprofile', 'server.mjs'], { cwd: fixture, windowsHide: true, env: { ...env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production', KUNQIONG_DB_ENABLED: 'false', KUNQIONG_SCAN_MODE: 'required', KUNQIONG_CLAMAV_HOST: '127.0.0.1', KUNQIONG_CLAMAV_PORT: String(scanner.address().port), KUNQIONG_RELEASE_SHA: 'performance-fixture', KUNQIONG_PERF_DIAGNOSTIC_NO_ACCESS_AUDIT: diagnostic ? 'true' : 'false' }, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', bytes => serverLog += bytes); child.stderr.on('data', bytes => serverLog += bytes)
  for (let attempt = 0; attempt < 100; attempt++) { try { if ((await fetch(base + '/api/health')).ok) return } catch {} await delay(100) }
  throw new Error('Isolated service failed to start: ' + serverLog.slice(-1000))
}
async function stop() {
  if (!child || child.exitCode !== null) return
  const ended = once(child, 'exit')
  await fetch(base + '/__performance/stop', { signal: AbortSignal.timeout(5000) }).catch(() => {})
  await Promise.race([ended, delay(5000)])
  if (child.exitCode === null) { stopError = 'Graceful fixture shutdown timed out'; child.kill(); await ended }
}
const cookie = index => 'kunqiong_session=perf-session-perf-user-' + (index % 20)
async function metricsSnapshot(reset = false) { const response = await fetch(base + '/__performance/metrics' + (reset ? '?reset=1' : '')); assert.equal(response.status, 200); return response.json() }
const stages = [], collectionStages = [], failures = [], auditRequestIds = []
const rounded = value => Math.round(value * 100) / 100
function percentile(values, p) { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); return rounded(sorted[Math.ceil(p * sorted.length) - 1]) }
function summary(values) { return { count: values.length, p50Ms: percentile(values, .5), p95Ms: percentile(values, .95), p99Ms: percentile(values, .99), maxMs: rounded(Math.max(0, ...values)) } }
async function request(url, { user = 0, method = 'GET', body, hash = false, expectedStatus = 200, expectedBytes, validate } = {}) {
  const headers = { cookie: cookie(user), ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}) }
  const response = await fetch(base + url, { method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) })
  let bytes = 0, data, digest = hash ? crypto.createHash('sha256') : null
  if (hash) { for await (const part of response.body) { bytes += part.length; digest.update(part) } }
  else { const buffer = Buffer.from(await response.arrayBuffer()); bytes = buffer.length; if (validate || body || response.status !== expectedStatus) { try { data = JSON.parse(buffer.toString()) } catch {} } }
  const valid = response.status === expectedStatus && (expectedBytes === undefined || bytes === expectedBytes) && (!hash || digest.digest('hex') === expectedHash) && (!validate || validate(data))
  return { status: response.status, bytes, valid, data, requestId: response.headers.get('x-request-id') }
}
async function submitCollectionFile(token, sequence) {
  const form = new FormData()
  form.append('participantName', `压测提交者-${sequence + 1}`)
  form.append('files', new Blob([Buffer.alloc(1024, 0x61)], { type: 'text/plain' }), `participant-${sequence + 1}.txt`)
  const response = await fetch(base + '/api/collections/' + token + '/submissions', { method: 'POST', body: form, signal: AbortSignal.timeout(30000) })
  const buffer = Buffer.from(await response.arrayBuffer())
  let data
  try { data = JSON.parse(buffer.toString()) } catch {}
  return { status: response.status, bytes: buffer.length, valid: response.status === 201 && Boolean(data?.submission?.id), data }
}
const apiMix = [
  { name: '登录会话', url: '/api/auth/me', validate: data => Boolean(data?.user?.id) },
  { name: '团队概览', url: '/api/account/team/overview', validate: data => data?.organization?.id === 'perf-org' && data.resources.length === 200 },
  { name: '收发记录', url: '/api/account/records', validate: data => Array.isArray(data?.records) && data.records.length === 20 },
  { name: '分享详情', url: '/api/shares/token/perf-share-0', validate: data => data?.share?.id === 'perf-share-0' },
  { name: '收集详情', url: '/api/collections/perf-collection', validate: data => data?.collection?.token === 'perf-collection' },
]
async function stage(name, concurrency, operation, { seconds = stageSeconds, count, kind = 'read', diagnostic = false } = {}) {
  console.log('START ' + name + ' concurrency=' + concurrency)
  const baseline = await metricsSnapshot(true), started = performance.now(), deadline = started + seconds * 1000
  const clientBaseline = performance.eventLoopUtilization(), durations = [], statusCounts = {}, errors = [], endpoints = {}
  let issued = 0, responseBytes = 0, successful = 0
  await Promise.all(Array.from({ length: concurrency }, async (_, worker) => {
    while (count === undefined ? performance.now() < deadline : issued < count) {
      const sequence = issued++, requestStarted = performance.now()
      try {
        const result = await operation(sequence, worker)
        const elapsed = performance.now() - requestStarted; durations.push(elapsed); responseBytes += result.bytes || 0
        const label = result.endpoint || name; (endpoints[label] ||= []).push(elapsed)
        statusCounts[result.status] = (statusCounts[result.status] || 0) + 1
        if (result.valid) successful++
        else if (errors.length < 10) errors.push({ sequence, status: result.status, endpoint: label, message: result.data?.message || 'Status, body, bytes or checksum validation failed' })
      } catch (error) { durations.push(performance.now() - requestStarted); statusCounts.transport_error = (statusCounts.transport_error || 0) + 1; if (errors.length < 10) errors.push({ sequence, message: error.message }) }
    }
  }))
  const elapsedMs = performance.now() - started, measured = await metricsSnapshot(), client = performance.eventLoopUtilization(clientBaseline)
  const cpuMs = (measured.cpu.user + measured.cpu.system - baseline.cpu.user - baseline.cpu.system) / 1000
  const record = { name, kind, diagnostic, concurrency, elapsedSeconds: rounded(elapsedMs / 1000), requests: durations.length, successful, errorCount: durations.length - successful, errorRate: rounded(100 * (durations.length - successful) / durations.length), requestsPerSecond: rounded(durations.length / (elapsedMs / 1000)), latency: summary(durations), endpoints: Object.fromEntries(Object.entries(endpoints).map(([key, values]) => [key, summary(values)])), statusCounts, responseBytes, throughputMiBPerSecond: rounded(responseBytes / 1024 ** 2 / (elapsedMs / 1000)), server: { cpuSingleCorePercent: rounded(cpuMs / elapsedMs * 100), baselineRssMiB: rounded(baseline.memory.rss / 1024 ** 2), peakRssMiB: rounded(measured.peakRss / 1024 ** 2), endRssMiB: rounded(measured.memory.rss / 1024 ** 2), heapUsedMiB: rounded(measured.memory.heapUsed / 1024 ** 2), eventLoop: measured.eventLoop, syncMetadataIo: measured.io, metadataBytes: measured.metadataBytes }, clientEluPercent: rounded(client.utilization * 100), errors }
  stages.push(record)
  if (record.errorCount) failures.push({ stage: name, errors: record.errorCount, samples: errors })
  fs.writeFileSync(path.join(output, 'performance-progress.json'), JSON.stringify({ fixture, stages, failures }, null, 2))
  console.log('DONE ' + name + ' rps=' + record.requestsPerSecond + ' p95=' + record.latency.p95Ms + 'ms errors=' + record.errorCount + ' rss=' + record.server.peakRssMiB + 'MiB')
  return record
}
const mixedRequest = async (sequence, worker) => {
  const item = apiMix[sequence % apiMix.length]
  const result = await request(item.url, { user: worker, validate: item.validate })
  if (process.env.KUNQIONG_PERF_DIAGNOSTIC_NO_ACCESS_AUDIT !== 'true') {
    auditRequestIds.push(result.requestId)
    if (auditRequestIds.length > 50) auditRequestIds.shift()
  }
  return { ...result, endpoint: item.name }
}
let baselineMetadataBytes, rateLimit, auditVerification
try {
  await start(); baselineMetadataBytes = (await metricsSnapshot()).metadataBytes
  if (collectionLoadOnly) {
    for (const target of [10, 30, 100, 300, 500]) {
      const created = await request('/api/collections', { user: 0, method: 'POST', expectedStatus: 201, body: { title: `收集人数压测-${target}`, maxFileSizeMb: 1 }, validate: data => Boolean(data?.collection?.token && data?.manageToken) })
      assert.ok(created.valid, 'Collection creation ' + JSON.stringify(created.data))
      const token = created.data.collection.token
      const concurrency = Math.min(target, 4)
      const measured = await stage(`收集任务提交 ${target} 人`, concurrency, sequence => submitCollectionFile(token, sequence), { count: target, kind: 'collection-submit' })
      const persisted = readFixtureMetadata(metadataFile).collections.find(item => item.token === token)?.submissions?.length || 0
      const row = { targetParticipants: target, concurrency, accepted: measured.successful, failures: measured.errorCount, persistedParticipants: persisted, p50Ms: measured.latency.p50Ms, p95Ms: measured.latency.p95Ms, p99Ms: measured.latency.p99Ms, requestsPerSecond: measured.requestsPerSecond, peakRssMiB: measured.server.peakRssMiB, metadataBytes: measured.server.metadataBytes }
      collectionStages.push(row)
      console.log(`COLLECTION target=${target} accepted=${row.accepted} persisted=${persisted} p95=${row.p95Ms}ms errors=${row.failures}`)
      if (row.accepted !== target || row.persistedParticipants !== target) failures.push({ stage: `收集任务提交 ${target} 人`, message: `Expected ${target} persisted submissions; accepted=${row.accepted}, persisted=${row.persistedParticipants}` })
    }
    await stop()
  } else {
    for (let index = 0; index < 10; index++) assert.ok((await mixedRequest(index, index)).valid, 'Warmup endpoint response')
    await stage('健康检查基线', 50, () => request('/api/health', { validate: data => data?.ok === true }), { seconds: 5 })
    await stage('前端页面基线', 50, () => request('/team'), { seconds: 5 })
    for (const concurrency of [1, 10, 30, 50]) await stage('业务混合读取 C' + concurrency, concurrency, mixedRequest)
    await stage('业务读取持续稳定性 C30', 30, mixedRequest, { seconds: 30 })
    for (const concurrency of [1, 4, 8]) {
      await stage('16MiB分片上传 C' + concurrency, concurrency, async (sequence, worker) => {
        const name = `perf-upload-${concurrency}-${sequence}.bin`
        const session = await request('/api/upload-sessions', { user: worker, method: 'POST', expectedStatus: 201, body: { mode: 'team_resource', chunkSize: chunkBytes, expiryDays: '0', downloadLimit: 'unlimited', files: [{ name, relativePath: name, size: transferBytes, mimeType: 'application/octet-stream' }] } })
        assert.ok(session.valid, 'Upload session creation ' + JSON.stringify(session.data)); const id = session.data.sessionId
        for (let index = 0; index < 4; index++) {
          const chunk = transferContent.subarray(index * chunkBytes, (index + 1) * chunkBytes), form = new FormData()
          form.append('fileIndex', '0'); form.append('chunkIndex', String(index)); form.append('totalChunks', '4'); form.append('chunkHash', crypto.createHash('sha256').update(chunk).digest('hex')); form.append('chunk', new Blob([chunk]), 'chunk')
          assert.ok((await request('/api/upload-sessions/' + id + '/chunks', { user: worker, method: 'POST', body: form })).valid, 'Upload chunk acknowledgement')
        }
        const done = await request('/api/upload-sessions/' + id + '/complete', { user: worker, method: 'POST', body: {}, expectedStatus: 201 })
        assert.ok(done.valid && done.data.share.files[0].scanEngine === 'clamav', 'Upload completion and scan')
        const original = JSON.parse(fs.readFileSync(metadataFile, 'utf8')).shares.find(share => share.id === done.data.share.id)
        const disk = fs.readFileSync(path.join(fixture, 'storage/files', original.id, original.files[0].storedName))
        const valid = disk.length === transferBytes && crypto.createHash('sha256').update(disk).digest('hex') === expectedHash
        return { status: 201, valid, bytes: transferBytes }
      }, { count: concurrency, kind: 'upload' })
    }
    for (const concurrency of [1, 4, 8]) await stage('16MiB完整下载 C' + concurrency, concurrency, () => request('/api/shares/perf-download/files/0/download', { hash: true, expectedBytes: transferBytes }), { count: concurrency * 2, kind: 'download' })
    let invalid = 0, limited = 0, unexpected = 0
    for (let index = 0; index < 65; index++) { const response = await request('/api/collections', { method: 'POST', body: { title: '' }, expectedStatus: 400 }); if (response.status === 400) invalid++; else if (response.status === 429) limited++; else unexpected++ }
    rateLimit = { attempts: 65, validationRejected: invalid, rateLimited: limited, unexpected, passed: invalid === 60 && limited === 5 && unexpected === 0 }
    assert.ok(rateLimit.passed, 'Resource creation rate limit')
    await metricsSnapshot()
    const durableAudit = readFixtureMetadata(metadataFile).auditLogs
    auditVerification = { retained: durableAudit.length, checkedRequestIds: auditRequestIds.length, matchedRequestIds: auditRequestIds.filter(id => durableAudit.some(row => row.details?.requestId === id)).length }
    assert.equal(auditVerification.matchedRequestIds, auditVerification.checkedRequestIds, 'Audit remains enabled and persisted under load')
    assert.equal(auditVerification.retained, 5000, 'Audit retention cap')
    await stop()
    // Attribution experiment only: same fixture, no modification to repository source or service.
    if (process.env.PERFORMANCE_SKIP_DIAGNOSTIC !== 'true') {
      await start(true)
      await stage('诊断对照：临时关闭访问审计 C30', 30, mixedRequest, { diagnostic: true })
    }
  }
} catch (error) { failures.push({ stage: 'harness', message: error.stack || error.message }); console.error(error.message) }
finally { await stop(); await new Promise(resolve => scanner.close(resolve)); fs.writeFileSync(path.join(output, 'server.log'), serverLog) }

function profileSummary(filename) {
  if (!fs.existsSync(filename)) return []
  const profile = JSON.parse(fs.readFileSync(filename, 'utf8')), nodes = new Map(profile.nodes.map(node => [node.id, node])), counts = new Map()
  for (const id of profile.samples || []) { const frame = nodes.get(id)?.callFrame; if (!frame) continue; const key = (frame.functionName || '(anonymous)') + '|' + frame.url + ':' + (frame.lineNumber + 1); counts.set(key, (counts.get(key) || 0) + 1) }
  const active = [...counts.entries()].filter(([key]) => !key.startsWith('(idle)|'))
  const total = active.reduce((sum, [, count]) => sum + count, 0)
  return active.sort((a, b) => b[1] - a[1]).slice(0, 15).map(([frame, samples]) => ({ frame, samples, activeSamplePercent: rounded(100 * samples / total) }))
}
const normal = stages.find(stage => stage.name === '业务混合读取 C30'), diagnostic = stages.find(stage => stage.diagnostic)
const result = { executedAt: new Date().toISOString(), fixture, environment: { os: os.type() + ' ' + os.release(), node: process.version, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, availableParallelism: os.availableParallelism?.() ?? null, cpuQuotaCores, memoryLimitGiB: memoryLimitGiB === null ? null : rounded(memoryLimitGiB), totalMemoryGiB: rounded(os.totalmem() / 1024 ** 3), freeMemoryGiB: rounded(os.freemem() / 1024 ** 3), mode: 'single Node process, local JSON metadata, loopback, client and server on same host', fixtureCounts: { users: 20, teamMembers: 20, seededShares: 201, records: 400, auditLogs: 5000 }, baselineMetadataBytes, scanMode: 'required INSTREAM emulator; real antivirus processing not measured' }, stages, rateLimit, auditVerification, scanner: { files: scannerFiles, bytes: scannerBytes }, failures, stopError, diagnosticComparison: normal && diagnostic ? { baselineRps: normal.requestsPerSecond, noAccessAuditRps: diagnostic.requestsPerSecond, throughputMultiplier: rounded(diagnostic.requestsPerSecond / normal.requestsPerSecond), baselineP95Ms: normal.latency.p95Ms, noAccessAuditP95Ms: diagnostic.latency.p95Ms, note: 'Attribution experiment only; access audit must remain enabled in deployed service.' } : null, profiles: { normal: profileSummary(path.join(output, 'normal.cpuprofile')), diagnostic: profileSummary(path.join(output, 'diagnostic.cpuprofile')) } }
result.collectionStages = collectionStages
fs.writeFileSync(path.join(output, 'performance-results.json'), JSON.stringify(result, null, 2))
const apiStages = stages.filter(stage => stage.name.startsWith('业务'))
const row = stage => `| ${stage.name} | ${stage.concurrency} | ${stage.requests} | ${stage.requestsPerSecond} | ${stage.latency.p95Ms} | ${stage.latency.p99Ms} | ${stage.errorCount} | ${stage.server.peakRssMiB} |`
const date = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'medium' }).format(new Date())
const report = `# 本机性能压测报告\n\n执行时间：${date}（Asia/Shanghai）。${failures.length ? '发现失败，见结果 JSON。' : '请求状态及数据完整性检查通过。'}\n\n环境：${result.environment.cpu}，${result.environment.logicalCpus} 个逻辑处理器，${result.environment.totalMemoryGiB} GiB 内存，Node ${process.version}，${result.environment.os}。单 Node 进程，本地 JSON 持久化；压测客户端与服务端同机，回环网络。业务存储使用临时项目副本和合成账号，未修改实际账号、文件或部署配置。\n\n固定初始规模：20 用户、20 团队成员、201 分享资源、400 收发记录、5000 条审计日志（保留上限），启动规范化后 metadata.json 为 ${(baselineMetadataBytes / 1024 ** 2).toFixed(2)} MiB。混合接口等比例包含登录会话、团队概览、收发记录、分享详情及收集详情。采用无思考时间的闭环并发，普通阶段 ${stageSeconds} 秒，持续稳定性 30 秒；统计包含响应体读完的耗时，每阶段等待所有在途请求结束。\n\n| 场景 | 并发 | 请求/文件数 | 每秒请求/文件 | P95 ms | P99 ms | 失败数 | 服务峰值 RSS MiB |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n${stages.map(row).join('\n')}\n\n上传场景每个并发客户端只上传一个 16 MiB 文件，4 个 4 MiB 分片，计时覆盖创建会话、上传、合并、扫描传输与磁盘 SHA-256 完整性校验；该场景的吞吐单位是文件/秒，不能与读取请求/秒直接比较。下载每个客户端完成两个 16 MiB 文件，逐流 SHA-256 校验。上传量 ${scannerBytes / 1024 ** 2} MiB，扫描闭环 ${scannerFiles} 次；下载量 ${stages.filter(stage => stage.kind === 'download').reduce((sum, stage) => sum + stage.responseBytes, 0) / 1024 ** 2} MiB。\n\n| 传输场景 | 并发 | 聚合吞吐 MiB/s |\n| --- | ---: | ---: |\n${stages.filter(stage => ['upload', 'download'].includes(stage.kind)).map(stage => `| ${stage.name} | ${stage.concurrency} | ${stage.throughputMiBPerSecond} |`).join('\n')}\n\n${result.diagnosticComparison ? `诊断对照：仅在临时副本关闭访问审计，同一 C30 混合读取从 ${normal.requestsPerSecond} 提升至 ${diagnostic.requestsPerSecond} 请求/秒（${result.diagnosticComparison.throughputMultiplier} 倍），P95 从 ${normal.latency.p95Ms} 降至 ${diagnostic.latency.p95Ms} ms。该对照用于定位审计及元数据持久化的成本，不能作为生产性能，也不能以关闭审计作为优化方案。` : ''}\n\n业务读取阶段 P95 最大为 ${Math.max(0, ...apiStages.map(stage => stage.latency.p95Ms))} ms。参考响应目标为 P95 ≤ 500 ms、非预期限流/失败为 0；此目标是本次诊断参照，并非已约定的业务 SLO。${apiStages.some(stage => stage.latency.p95Ms > 500) ? '部分并发阶段未达到 500 ms 参考目标。' : '本次阶段达到 500 ms 参考目标。'}\n\n创建接口额外尝试 65 次非法空标题，前 ${rateLimit?.validationRejected ?? '?'} 次返回参数拒绝，后 ${rateLimit?.rateLimited ?? '?'} 次返回 429，非预期响应 ${rateLimit?.unexpected ?? '?'} 次，验证限流仍启用。\n\nCPU 按单核 100% 计，事件循环直方图分辨率 10 ms，RSS 为进程常驻内存。完整指标、每接口分位数、同步 metadata 文件 I/O 字节及时间在 [结果 JSON](${path.join(output, 'performance-results.json').replaceAll('\\', '/')})；[正常服务 CPU profile](${path.join(output, 'normal.cpuprofile').replaceAll('\\', '/')}) 可在 DevTools 中查看。\n\n测试不包括跨机网络、真实 ClamAV 病毒引擎 CPU、MySQL/多实例、CDN、浏览器首屏或真实支付服务。文件扫描使用本机 INSTREAM 协议模拟器，传输和权限仍执行实际实现。16 MiB 文件不足以证明 500 MiB/5 GiB 场景容量。业务指标始终启用访问审计，诊断对照单独标注。压测副本保留在 ${fixture}。\n\n复现：在项目根执行 node scripts/performance-load.mjs，可设置 PERFORMANCE_EVIDENCE_DIR 和 PERFORMANCE_STAGE_SECONDS。\n`
const profileShare = needle => result.profiles.normal.filter(item => item.frame.includes(needle)).reduce((sum, item) => sum + item.activeSamplePercent, 0)
const persistenceFrames = ['writeFileUtf8|', 'rename|', 'writeFileSync|', 'copyFile|']
const analysis = normal && diagnostic ? `
瓶颈证据：正常 C30 阶段服务 CPU 约 ${normal.server.cpuSingleCorePercent}%（单核口径），事件循环 P95 ${normal.server.eventLoop.p95Ms.toFixed(2)} ms；同步 metadata 写入、备份及重命名耗时合计 ${(normal.server.syncMetadataIo.milliseconds / 1000).toFixed(2)} 秒，占该阶段 ${normal.elapsedSeconds} 秒的一部分。${normal.requests} 次请求产生 ${(normal.server.syncMetadataIo.writeBytes / 1024 ** 2).toFixed(2)} MiB 写入和 ${(normal.server.syncMetadataIo.copyBytes / 1024 ** 2).toFixed(2)} MiB 备份复制，均为逻辑文件字节，不能当作物理磁盘流量。

正常进程 CPU profile 中，normalizeRecordDate 占 ${profileShare('normalizeRecordDate|').toFixed(2)}%；writeFileUtf8、rename、writeFileSync、copyFile 四类帧合计 ${persistenceFrames.reduce((sum, frame) => sum + profileShare(frame), 0).toFixed(2)}%。这些是整个正常进程的活动采样比例，不是单一阶段的耗时比例。详细热点以结果 JSON 的 profiles 字段为准；日志及业务持久化是否分离，应结合当前版本代码确认。

建议按以下顺序优化，保留现有审计与权限校验：

1. 将审计从业务 metadata 分离，使用独立追加日志或审计表；若采用有界队列批量写入，明确容量、背压、失败重试和退出落盘策略，避免高风险操作日志丢失。
2. 只规范化新增审计条目，维护有序且有上限的记录；避免每个请求重新处理、排序全部历史日志。
3. 减少业务 metadata 的同步全量序列化与备份，评估增量持久化或可恢复的异步批量保存，同时保留原子提交、并发冲突处理和恢复能力。
4. 优化后在相同数据规模、启用审计及真实扫描引擎的环境复测，并增加跨机压力、长时间运行及 500 MiB/5 GiB 文件场景，再确定上线容量。

测量限制：健康检查和前端 HTML 基线各 5 秒，业务读取普通阶段 ${stageSeconds} 秒，最长阶段仅 30 秒；上传只有 13 个文件、下载只有 26 个文件，其分位数样本有限。RSS 每 100 ms 采样，表中峰值是观测值。测试启用了 CPU profiler 与指标采集；同机客户端也会竞争 CPU，健康检查基线客户端事件循环接近饱和。诊断复用正常测试后的存储，包含前序上传和审计变化，结束 metadata 约 ${(diagnostic.server.metadataBytes / 1024 ** 2).toFixed(2)} MiB（正常 C30 结束约 ${(normal.server.metadataBytes / 1024 ** 2).toFixed(2)} MiB）；它用于定位瓶颈，吞吐提升倍数不能直接作为优化收益承诺。
` : ''
fs.mkdirSync(path.dirname(reportPath), { recursive: true })
fs.writeFileSync(reportPath, report + analysis)
if (collectionLoadOnly) {
  const rows = collectionStages.map(stage => `| ${stage.targetParticipants} | ${stage.concurrency} | ${stage.accepted} | ${stage.persistedParticipants} | ${stage.p50Ms} | ${stage.p95Ms} | ${stage.p99Ms} | ${stage.requestsPerSecond} | ${stage.peakRssMiB} |`).join('\n')
  const collectionReport = `# 收集任务多人提交压测报告\n\n执行时间：${date}（Asia/Shanghai）。${failures.length ? '存在失败或持久化条数不匹配，详见结果 JSON。' : '各档提交成功且持久化人数与目标一致。'}\n\n测试资源硬限制：CPU 配额 ${result.environment.cpuQuotaCores ?? '未检测到'} 核、内存上限 ${result.environment.memoryLimitGiB ?? '未检测到'} GiB；容器可见 ${result.environment.logicalCpus} 个逻辑处理器和 ${result.environment.totalMemoryGiB} GiB 内存。Node ${process.version}，${result.environment.os}。压测在临时项目副本中运行，使用合成账号和本机回环请求，没有访问线上服务或当前本地服务。扫描路径使用本机 INSTREAM 协议模拟器，不代表真实 ClamAV 的扫描耗时。\n\n每位提交者上传一个 1 KiB 文本文件，5 档分别以最多4路并发提交者发送 ${collectionStages.reduce((sum, stage) => sum + stage.targetParticipants, 0)} 个请求；每档单独创建收集任务，并从临时副本的 metadata.json 核对落盘提交数。服务端当前每进程限制最多4个直传请求同时接收。\n\n| 目标提交人数 | 并发提交数 | HTTP成功 | 落盘提交数 | P50 ms | P95 ms | P99 ms | 提交/秒 | 进程峰值RSS MiB |\n| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n${rows}\n\n客户端、服务端与文件写入均在同一台机器；此结果用于本机容量诊断，不等同线上公网并发能力。真实 ClamAV、MySQL/多实例、跨机网络、磁盘长期容量和大文件扫描未纳入本次测试。临时副本：${fixture}\n\n完整指标和失败样本：[performance-results.json](${path.join(output, 'performance-results.json').replaceAll('\\', '/')})。复现命令：容器设置 --cpus=4、--memory=8g 后执行 node scripts/performance-load.mjs --collections-only。\n`
  fs.writeFileSync(reportPath, collectionReport)
}
console.log(JSON.stringify({ stages: stages.map(stage => ({ name: stage.name, concurrency: stage.concurrency, rps: stage.requestsPerSecond, p95Ms: stage.latency.p95Ms, errors: stage.errorCount })), collectionStages, failures, diagnosticComparison: result.diagnosticComparison, report: reportPath }, null, 2))
process.exitCode = failures.length || stopError ? 1 : 0
