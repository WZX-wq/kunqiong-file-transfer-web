// Real server regression: access audit must survive crashes without rewriting business metadata.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'

const root = path.resolve(import.meta.dirname, '..')
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-audit-persistence-'))
function copy(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.isDirectory()) copy(path.join(from, entry.name), path.join(to, entry.name))
    else fs.copyFileSync(path.join(from, entry.name), path.join(to, entry.name))
  }
}
copy(path.join(root, 'server'), path.join(fixture, 'server'))
fs.copyFileSync(path.join(root, 'package.json'), path.join(fixture, 'package.json'))
fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
const control = `
let failAudit = false;
const auditOpen = fs.openSync;
fs.openSync = (filename, flags, ...rest) => {
 if (failAudit && String(filename).endsWith('events.jsonl') && flags === 'a') { const error = new Error('fixture: audit disk full'); error.code = 'ENOSPC'; throw error; }
 return auditOpen(filename, flags, ...rest);
};
app.post('/__fixture/failure', (req, res) => { failAudit = req.query.enabled === '1'; res.json({ok:true}); });
app.get('/__fixture/audit', (_req, res) => res.json({logs: metadata.auditLogs}));
app.post('/__fixture/write', (_req, res) => { metadata.systemConfig.maxBatchFiles = 77; persistMetadata(); res.json({ok:true}); });
app.post('/__fixture/purge', (_req, res) => res.json(purgeExpiredAuditLogs()));
app.post('/__fixture/stop', (_req, res) => { res.json({ok:true}); setTimeout(() => shutdown('fixture'), 20); });
`
fs.writeFileSync(path.join(fixture, 'server.mjs'), fs.readFileSync(path.join(root, 'server.mjs'), 'utf8').replace("app.set('trust proxy', true)", control + "\napp.set('trust proxy', true)"))
fs.mkdirSync(path.join(fixture, 'storage'))
const metadataFile = path.join(fixture, 'storage/metadata.json')
const now = new Date().toISOString()
const old = new Date(Date.now() - 400 * 86400000).toISOString()
fs.writeFileSync(metadataFile, JSON.stringify({
  auditLogs: Array.from({ length: 5000 }, (_, i) => ({ id: 'legacy-' + i, type: 'access', action: 'legacy-' + i, createdAt: i === 0 ? old : now })),
  users: {}, shares: [], collections: [], sessions: [],
  systemConfig: { auditLogRetentionDays: 30 },
}))
const env = { ...process.env }
for (const key of Object.keys(env)) if (/^(KUNQIONG_|OAUTH_)/.test(key)) delete env[key]
const children = []
let passed = 0
async function start() {
  const probe = net.createServer()
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  const child = spawn(process.execPath, ['server.mjs'], { cwd: fixture, windowsHide: true, env: { ...env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production', KUNQIONG_DB_ENABLED: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  child.stdout.on('data', data => { log += data })
  child.stderr.on('data', data => { log += data })
  const instance = { child, base: 'http://127.0.0.1:' + port, log: () => log }
  children.push(instance)
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(instance.base + '/api/health')).ok) return instance } catch {}
    if (child.exitCode !== null) throw Error('Startup: ' + log)
    await delay(50)
  }
  throw Error('Startup timeout: ' + log)
}
async function kill(instance, graceful = false) {
  if (instance.child.exitCode !== null || instance.child.signalCode !== null) return
  const ended = once(instance.child, 'exit')
  if (graceful) await fetch(instance.base + '/__fixture/stop', { method: 'POST' })
  else instance.child.kill('SIGKILL')
  await ended
  if (graceful) assert.equal(instance.child.exitCode, 0, instance.log())
}
async function logs(instance) { return (await (await fetch(instance.base + '/__fixture/audit')).json()).logs }
function check(name, condition) { assert.ok(condition, name); passed++; console.log('PASS ' + name) }
try {
  const first = await start()
  check('legacy audit migrated', (await logs(first)).length === 5000)
  check('startup durably commits the audit migration marker', JSON.parse(fs.readFileSync(metadataFile, 'utf8')).auditStorage === 'journal-v1')
  const before = fs.readFileSync(metadataFile, 'utf8')
  const response = await fetch(first.base + '/api/auth/me')
  await response.arrayBuffer()
  const requestId = response.headers.get('x-request-id')
  await delay(20)
  check('reads do not rewrite business metadata', fs.readFileSync(metadataFile, 'utf8') === before)
  check('new access audit retained at cap', (await logs(first)).some(row => row.details?.requestId === requestId) && (await logs(first)).length === 5000)
  await kill(first)
  const second = await start()
  check('forced restart recovers acknowledged access audit', (await logs(second)).some(row => row.details?.requestId === requestId))
  await fetch(second.base + '/__fixture/write', { method: 'POST' })
  check('business changes remain durable', JSON.parse(fs.readFileSync(metadataFile, 'utf8')).systemConfig.maxBatchFiles === 77)
  const third = await start()
  const ids = await Promise.all([second, third].map(async instance => {
    const r = await fetch(instance.base + '/api/auth/me'); await r.arrayBuffer(); return r.headers.get('x-request-id')
  }))
  // finish handlers run after bytes are handed to the socket; wait for both writers to finish.
  await logs(second); await logs(third)
  await kill(second); await kill(third)
  const fourth = await start()
  const logsSnapshot = await logs(fourth)
  check('multiple writers retain both audits', ids.every(id => logsSnapshot.some(row => row.details?.requestId === id)))
  await fetch(fourth.base + '/__fixture/failure?enabled=1', { method: 'POST' })
  await (await fetch(fourth.base + '/api/auth/me')).arrayBuffer()
  await delay(50)
  check('audit disk error does not crash read-only service', fourth.child.exitCode === null && fourth.child.signalCode === null && (await fetch(fourth.base + '/api/health')).ok)
  check('audit disk error is visible with request context', /audit_write_failed/.test(fourth.log()))
  await fetch(fourth.base + '/__fixture/failure?enabled=0', { method: 'POST' })
  const recoveredResponse = await fetch(fourth.base + '/api/auth/me'); await recoveredResponse.arrayBuffer()
  check('audit recording resumes after disk recovery', (await logs(fourth)).some(row => row.details?.requestId === recoveredResponse.headers.get('x-request-id')))
  await kill(fourth, true)
  // A fake database transport captures the actual migration payload; no live DB is changed.
  fs.writeFileSync(path.join(fixture, 'server/state.js'), `
export const runtime = {};
export const databasePool = {
 query: async sql => sql.includes('information_schema') ? [[{total:1}]] : [[]],
 execute: async () => [{affectedRows:1}]
};
`)
  const migration = spawnSync(process.execPath, ['--input-type=module', '-e', "const {loadMetadata}=await import('./server/lib/metadata-store.js'); console.log(JSON.stringify(await loadMetadata()));"], { cwd: fixture, windowsHide: true, env: { ...env, KUNQIONG_DB_HOST: 'fixture', KUNQIONG_DB_NAME: 'fixture', KUNQIONG_DB_USER: 'fixture' }, encoding: 'utf8' })
  assert.equal(migration.status, 0, migration.stderr)
  const migrated = JSON.parse(migration.stdout.trim().split('\n').at(-1))
  check('JSON to database migration retains independent audit history', migrated.auditLogs.some(row => row.details?.requestId === requestId) && migrated.auditLogs.some(row => row.details?.requestId === recoveredResponse.headers.get('x-request-id')))
} finally {
  await Promise.all(children.map(instance => kill(instance)))
  console.log('Audit persistence checks: ' + passed + '; fixture=' + fixture)
}
