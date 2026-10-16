// Real routes with isolated storage and a controlled scanner; no user data is touched.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'

const root = path.resolve(import.meta.dirname, '..')
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-publication-'))
const copy = (from, to) => {
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
let failPublication=false;
const fixtureRename=fs.renameSync;
fs.renameSync=(from,to)=>{if(failPublication && String(to).endsWith('metadata.json')){const e=new Error('fixture metadata disk full'); e.code='ENOSPC';throw e}return fixtureRename(from,to)};
app.post('/__fixture/fail',(_req,res)=>{failPublication=true;res.json({ok:true})});
`
fs.writeFileSync(path.join(fixture, 'server.mjs'), fs.readFileSync(path.join(root, 'server.mjs'), 'utf8').replace("app.set('trust proxy', 'loopback')", "app.set('trust proxy', 'loopback')\n" + control))
const env = { ...process.env }
for (const key of Object.keys(env)) if (/^(KUNQIONG_|OAUTH_)/.test(key)) delete env[key]
let child, base, log = '', passed = 0
const storage = path.join(fixture, 'storage')
const now = new Date().toISOString(), future = new Date(Date.now() + 86400000).toISOString()
const users = { owner: { id: 'owner', planId: 'enterprise', status: 'active' }, member: { id: 'member', planId: 'free', status: 'active' } }
const task = { id: 'collection', token: 'collection-token', manageToken: 'manager', title: 'fixture', ownerUserId: 'owner', status: 'active', maxFileSizeMb: 5000, allowedTypes: ['全部类型'], submissions: [], createdAt: now }
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exit = once(child, 'exit'); child.kill(); await exit
}
async function start() {
  await stop()
  // Retain previous isolated fixture evidence under a new directory per case.
  if (fs.existsSync(storage)) fs.renameSync(storage, storage + '-' + passed + '-' + Date.now())
  fs.mkdirSync(storage)
  fs.writeFileSync(path.join(storage, 'metadata.json'), JSON.stringify({ users, sessions: Object.values(users).map(user => ({ id: user.id + '-session', user, expiresAt: future })), shares: [{ id: 'personal-full', ownerUserId: 'member', status: 'active', createdAt: now, files: [{ name: 'filler', size: 20 * 1024 ** 3 }] }], collections: [task], organizations: { org: { id: 'org', name: 'fixture', slug: 'fixture', ownerUserId: 'owner', members: [{ userId: 'owner', role: 'owner', status: 'active' }, { userId: 'member', role: 'member', status: 'active' }], createdAt: now } } }))
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve))
  base = 'http://127.0.0.1:' + port
  child = spawn(process.execPath, ['server.mjs'], { cwd: fixture, windowsHide: true, env: { ...env, HOST: '127.0.0.1', PORT: String(port), KUNQIONG_DB_ENABLED: 'false', KUNQIONG_SCAN_MODE: 'optional', NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', data => { log += data }); child.stderr.on('data', data => { log += data })
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health')).ok) return } catch {} if (child.exitCode !== null) break; await delay(50) }
  throw Error('Fixture start failed: ' + log)
}
async function api(url, { body, user = 'owner', method = body ? 'POST' : 'GET' } = {}) {
  const response = await fetch(base + url, { method, headers: { cookie: 'kunqiong_session=' + user + '-session', ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined })
  return { status: response.status, data: await response.json() }
}
const form = fields => { const body = new FormData(); body.append('files', new Blob(['safe']), 'fixture.txt'); for (const [key, value] of Object.entries(fields || {})) body.append(key, value); return body }
function check(label, condition) { assert.ok(condition, label); passed++; console.log('PASS ' + label) }
const directories = directory => fs.readdirSync(directory).filter(name => fs.statSync(path.join(directory, name)).isDirectory())
try {
  await start()
  const team = await api('/api/shares?mode=team_resource', { user: 'member', body: form({ mode: 'team_resource', expiryDays: '0' }) })
  assert.equal(team.status, 201, JSON.stringify(team.data))
  const storedTeam = JSON.parse(fs.readFileSync(path.join(storage, 'metadata.json'), 'utf8')).shares.find(share => share.id === team.data.share.id)
  check('team multipart uses team capacity when member personal capacity is full', storedTeam.teamResource === true)
  check('team multipart binds the actual organization', storedTeam.teamOrganizationId === 'org' && storedTeam.ownerUserId === 'member')
  check('mode cannot change after preflight', (await api('/api/shares?mode=team_resource', { body: form({ mode: 'share' }) })).status === 400)
  for (const collection of [false, true]) {
    await start()
    await api('/__fixture/fail', { body: {} })
    const failed = await api(collection ? '/api/collections/collection-token/submissions' : '/api/shares', { body: form({ participantName: 'fixture' }) })
    check(`${collection ? 'collection' : 'share'} metadata failure is rejected`, failed.status === 503)
    const directory = path.join(storage, collection ? 'collections/collection' : 'files')
    check(`${collection ? 'collection' : 'share'} metadata failure leaves no orphan directory`, !fs.existsSync(directory) || directories(directory).length === 0)
  }
  for (const collection of [false, true]) {
    await start()
    const created = await api('/api/upload-sessions', { body: { ...(collection ? { mode: 'collection', collectionToken: 'collection-token' } : {}), files: [{ name: 'chunk.txt', size: 4 }] } })
    assert.equal(created.status, 201, JSON.stringify(created.data))
    const id = created.data.sessionId, body = new FormData()
    for (const [key, value] of Object.entries({ fileIndex: '0', chunkIndex: '0', totalChunks: '1' })) body.append(key, value)
    body.append('chunk', new Blob(['safe']), 'chunk')
    assert.equal((await api(`/api/upload-sessions/${id}/chunks`, { body })).status, 200)
    await api('/__fixture/fail', { body: {} })
    const failed = await api(`/api/upload-sessions/${id}/complete`, { body: { background: true } })
    // Background starts may be accepted; the fixture's fault must settle as failed,
    // rather than claiming complete from an uncommitted in-memory resource.
    assert.ok([202, 503].includes(failed.status))
    await delay(150)
    const manifest = JSON.parse(fs.readFileSync(path.join(storage, 'tmp/upload-sessions', id, 'session.json'), 'utf8'))
    check(`${collection ? 'collection' : 'share'} background never reports an uncommitted upload complete`, manifest.completion.status === 'failed')
    check(`${collection ? 'collection' : 'share'} failed chunk publication restores resumable bytes`, fs.readFileSync(path.join(storage, 'tmp/upload-sessions', id, '0.target'), 'utf8') === 'safe')
  }
} finally { await stop(); console.log(`Upload publication checks: ${passed}; fixture=${fixture}`) }
