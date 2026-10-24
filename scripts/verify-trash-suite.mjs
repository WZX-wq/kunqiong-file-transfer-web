// 回收站接口回归：隔离 fixture，不修改开发环境 storage。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-trash-suite-'))
const future = new Date(Date.now() + 20 * 86400000).toISOString()
const users = Object.fromEntries(['owner', 'other'].map(id => [id, { id, username: id, nickname: id, status: 'active', planId: 'member', planExpiresAt: future }]))
const sessions = Object.values(users).map(user => ({ id: `${user.id}-session`, user, expiresAt: future }))
function copyDirectory(source, target) { fs.mkdirSync(target, { recursive: true }); for (const entry of fs.readdirSync(source, { withFileTypes: true })) { const from = path.join(source, entry.name); const to = path.join(target, entry.name); if (entry.isDirectory()) copyDirectory(from, to); else if (entry.isFile()) fs.copyFileSync(from, to) } }
fs.copyFileSync(path.join(root, 'server.mjs'), path.join(fixture, 'server.mjs')); copyDirectory(path.join(root, 'server'), path.join(fixture, 'server')); fs.copyFileSync(path.join(root, 'package.json'), path.join(fixture, 'package.json')); fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
fs.mkdirSync(path.join(fixture, 'email-templates'), { recursive: true }); for (const name of fs.readdirSync(path.join(root, 'email-templates'))) fs.copyFileSync(path.join(root, 'email-templates', name), path.join(fixture, 'email-templates', name))
fs.mkdirSync(path.join(fixture, 'storage')); fs.writeFileSync(path.join(fixture, 'storage', 'metadata.json'), JSON.stringify({ users, sessions, shares: [], distributions: [], collections: [], messages: {}, systemConfig: { anonymousTotalSizeMb: 100 } }))
const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve)); const base = `http://127.0.0.1:${port}`
const cleanEnv = { ...process.env }; for (const key of Object.keys(cleanEnv)) if (key.startsWith('KUNQIONG_') || key.startsWith('OAUTH_')) delete cleanEnv[key]
const child = spawn(process.execPath, ['server.mjs'], { cwd: fixture, windowsHide: true, env: { ...cleanEnv, PORT: String(port), NODE_ENV: 'production', KUNQIONG_HOST: '127.0.0.1', KUNQIONG_SCAN_MODE: 'optional' }, stdio: ['ignore', 'ignore', 'pipe'] })
let started = false; let startupError = ''; child.stderr.on('data', chunk => { startupError += String(chunk) }); for (let i = 0; i < 300; i++) { try { if ((await fetch(`${base}/api/health`)).ok) { started = true; break } } catch {} if (child.exitCode !== null) break; await delay(50) }; if (!started) throw new Error(`fixture 启动失败: ${startupError}`)
async function api(url, { user = '', method = 'GET', body } = {}) { const form = body instanceof FormData; const res = await fetch(base + url, { method, headers: { ...(user ? { cookie: `kunqiong_session=${user}-session` } : {}), ...(body && !form ? { 'content-type': 'application/json' } : {}) }, body: body ? (form ? body : JSON.stringify(body)) : undefined }); return { res, data: await res.json().catch(() => ({})) } }
try {
  const body = new FormData(); body.append('files', new Blob(['trash-test']), 'trash-test.txt')
  const share = await api('/api/shares', { user: 'owner', method: 'POST', body })
  assert.equal(share.res.status, 201)
  const shareId = share.data.share.id
  await api('/api/account/records', { user: 'owner', method: 'POST', body: { record: { id: `my_sent:share:${shareId}`, kind: 'share', scope: 'my_sent', shareId, name: 'trash-test.txt', fileCount: 1, totalSize: 10 } } })
  const deleted = await api('/api/account/records', { user: 'owner', method: 'DELETE', body: { ids: [`my_sent:share:${shareId}`] } })
  assert.equal(deleted.res.status, 200); assert.equal(deleted.data.purged.length, 1)
  assert.equal((await api(`/api/shares/token/${shareId}`, { user: 'owner' })).res.status, 404)
  const trash = await api('/api/account/trash', { user: 'owner' }); assert.equal(trash.res.status, 200); assert.equal(trash.data.items.length, 1); assert.equal(trash.data.retentionDays, 7)
  assert.equal((await api('/api/account/trash', { user: 'other' })).data.items.length, 0)
  const denied = await api(`/api/account/trash/share/${shareId}/restore`, { user: 'other', method: 'POST' }); assert.equal(denied.res.status, 404)
  const restored = await api(`/api/account/trash/share/${shareId}/restore`, { user: 'owner', method: 'POST' }); assert.equal(restored.res.status, 200)
  assert.equal((await api(`/api/shares/token/${shareId}`, { user: 'owner' })).res.status, 410)
  await api('/api/account/records', { user: 'owner', method: 'POST', body: { record: { id: `my_sent:share:${shareId}`, kind: 'share', scope: 'my_sent', shareId, name: 'trash-test.txt' } } })
  await api('/api/account/records', { user: 'owner', method: 'DELETE', body: { ids: [`my_sent:share:${shareId}`] } })
  const purged = await api(`/api/account/trash/share/${shareId}`, { user: 'owner', method: 'DELETE' }); assert.equal(purged.res.status, 200)
  assert.equal((await api('/api/account/trash', { user: 'owner' })).data.items.length, 0)
  console.log('PASS: 回收站删除、隔离、恢复不重开链接和彻底删除')
} finally { if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await Promise.race([exited, delay(3000)]) } }

