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
async function uploadShare(user, name, content = 'trash-test') {
  const body = new FormData()
  body.append('files', new Blob([content]), name)
  const response = await api('/api/shares', { user, method: 'POST', body })
  assert.equal(response.res.status, 201, JSON.stringify(response.data))
  return response.data.share
}
async function trashShare(user, shareId) {
  const response = await api('/api/account/records', { user, method: 'DELETE', body: { ids: [`my_sent:share:${shareId}`] } })
  assert.equal(response.res.status, 200)
  return response
}
try {
  const share = await uploadShare('owner', 'trash-test.txt')
  const shareId = share.id
  await api('/api/account/records', { user: 'owner', method: 'POST', body: { record: { id: `my_sent:share:${shareId}`, kind: 'share', scope: 'my_sent', shareId, name: 'trash-test.txt', fileCount: 1, totalSize: 10 } } })
  const deleted = await trashShare('owner', shareId)
  assert.equal(deleted.data.purged.length, 1)
  assert.equal((await api(`/api/shares/token/${shareId}`, { user: 'owner' })).res.status, 404)
  const trash = await api('/api/account/trash', { user: 'owner' }); assert.equal(trash.res.status, 200); assert.equal(trash.data.items.length, 1); assert.equal(trash.data.retentionDays, 7)
  assert.equal((await api('/api/account/trash', { user: 'other' })).data.items.length, 0)
  const denied = await api(`/api/account/trash/share/${shareId}/restore`, { user: 'other', method: 'POST' }); assert.equal(denied.res.status, 404)
  const restored = await api(`/api/account/trash/share/${shareId}/restore`, { user: 'owner', method: 'POST' }); assert.equal(restored.res.status, 200)
  assert.equal((await api(`/api/shares/token/${shareId}`, { user: 'owner' })).res.status, 410)
  const restoredRecords = await api('/api/account/records', { user: 'owner' })
  const restoredRecord = restoredRecords.data.records.find(record => record.id === `my_sent:share:${shareId}`)
  assert.ok(restoredRecord, '恢复后记录应重新出现在收发记录')
  assert.equal(restoredRecord.status, '已关闭')
  await api('/api/account/records', { user: 'owner', method: 'PUT', body: { records: [] } })
  const repairedRecords = await api('/api/account/records', { user: 'owner' })
  assert.ok(repairedRecords.data.records.some(record => record.id === `my_sent:share:${shareId}`), '旧版本恢复的资源应自动补回收发记录')
  await api('/api/account/records', { user: 'owner', method: 'POST', body: { record: { id: `my_sent:share:${shareId}`, kind: 'share', scope: 'my_sent', shareId, name: 'trash-test.txt' } } })
  await api('/api/account/records', { user: 'owner', method: 'DELETE', body: { ids: [`my_sent:share:${shareId}`] } })
  const purged = await api(`/api/account/trash/share/${shareId}`, { user: 'owner', method: 'DELETE' }); assert.equal(purged.res.status, 200)
  assert.equal((await api('/api/account/trash', { user: 'owner' })).data.items.length, 0)

  // 一键清空：只删除当前账号回收站，不影响活动资源或其他账号。
  const ownerTrashA = await uploadShare('owner', 'bulk-a.txt', 'bulk-a')
  const ownerTrashB = await uploadShare('owner', 'bulk-b.txt', 'bulk-b')
  const otherTrash = await uploadShare('other', 'other-trash.txt', 'other')
  const active = await uploadShare('owner', 'keep-active.txt', 'keep')
  await trashShare('owner', ownerTrashA.id)
  await trashShare('owner', ownerTrashB.id)
  await trashShare('other', otherTrash.id)
  assert.equal((await api('/api/account/trash', { user: 'owner' })).data.items.length, 2)
  assert.equal((await api('/api/account/trash', { user: 'other' })).data.items.length, 1)
  assert.equal((await api('/api/account/trash', { user: '', method: 'DELETE' })).res.status, 401)
  const emptied = await api('/api/account/trash', { user: 'owner', method: 'DELETE' })
  assert.equal(emptied.res.status, 200)
  assert.equal(emptied.data.deletedCount, 2)
  assert.equal(emptied.data.deletedFileCount, 2)
  assert.equal(emptied.data.releasedBytes, 12)
  assert.equal((await api('/api/account/trash', { user: 'owner' })).data.items.length, 0)
  assert.equal((await api('/api/account/trash', { user: 'other' })).data.items.length, 1)
  assert.ok(!fs.existsSync(path.join(fixture, 'storage/files', ownerTrashA.id)), '一键清空应移除已删除分享的磁盘目录')
  assert.ok(!fs.existsSync(path.join(fixture, 'storage/files', ownerTrashB.id)), '一键清空应移除已删除分享的磁盘目录')
  assert.ok(fs.existsSync(path.join(fixture, 'storage/files', otherTrash.id)), '其他账号的回收站不受影响')
  assert.ok(fs.existsSync(path.join(fixture, 'storage/files', active.id)), '活动资源不受一键清空影响')
  assert.equal((await api('/api/shares/token/' + active.id, { user: 'owner' })).res.status, 200)
  const emptiedAgain = await api('/api/account/trash', { user: 'owner', method: 'DELETE' })
  assert.equal(emptiedAgain.res.status, 200)
  assert.equal(emptiedAgain.data.deletedCount, 0)
  console.log('PASS: 回收站删除、隔离、恢复不重开链接、彻底删除和一键清空')
} finally { if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await Promise.race([exited, delay(3000)]) } }

