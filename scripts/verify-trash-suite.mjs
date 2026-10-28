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
const testOnlyRoutes = `
app.post('/__trash_fixture/seed-expiration', async (_req, res) => {
 const fs = await import('node:fs/promises'); const path = await import('node:path');
 const { metadata, persistMetadata } = await import('./server/lib/metadata-store.js');
 const { filesRoot, collectionsRoot } = await import('./server/config.js');
 const now = Date.now(); const bytes = Buffer.from('expired-trash-fixture');
 const file = { name: 'expired-fixture.txt', storedName: 'fixture.txt', relativePath: 'expired-fixture.txt', size: bytes.length };
 const resources = [
  { id: 'expired-personal-share', kind: 'share', teamResource: false },
  { id: 'expired-team-share', kind: 'share', teamResource: true, teamOrganizationId: 'synthetic-team' },
  { id: 'expired-personal-collection', kind: 'collection' },
  { id: 'active-trash-share', kind: 'share', teamResource: false, active: true },
 ];
 for (const item of resources) {
  const resource = item.kind === 'share'
   ? { id: item.id, ownerUserId: item.teamResource ? 'team-member' : 'owner', teamResource: item.teamResource, teamOrganizationId: item.teamOrganizationId || '', files: [file], status: 'closed', createdAt: new Date(now - 8 * 86400000).toISOString(), ...(item.active ? { deletedAt: new Date(now).toISOString(), trashExpiresAt: new Date(now + 86400000).toISOString() } : { deletedAt: new Date(now - 8 * 86400000).toISOString(), trashExpiresAt: new Date(now - 1).toISOString() }) }
   : { id: item.id, token: item.id, manageToken: item.id + '-manage', ownerUserId: 'owner', title: '过期收集夹具', status: 'closed', createdAt: new Date(now - 8 * 86400000).toISOString(), deletedAt: new Date(now - 8 * 86400000).toISOString(), trashExpiresAt: new Date(now - 1).toISOString(), submissions: [{ id: 'expired-submission', files: [file] }] };
  if (item.kind === 'share') metadata.shares.push(resource); else metadata.collections.push(resource);
  const root = item.kind === 'share' ? filesRoot : collectionsRoot;
  const directory = item.kind === 'share' ? path.join(root, item.id) : path.join(root, item.id, 'expired-submission');
  await fs.mkdir(directory, { recursive: true }); await fs.writeFile(path.join(directory, file.storedName), bytes);
 }
 persistMetadata(); res.json({ ok: true, count: resources.length });
});
app.post('/__trash_fixture/purge-expired', async (req, res) => {
 const { purgeExpiredTrash } = await import('./server/services/trash.js');
 res.json({ changed: purgeExpiredTrash(Number(req.body?.now)), now: Number(req.body?.now) });
});
`
fs.writeFileSync(path.join(fixture, 'server.mjs'), fs.readFileSync(path.join(root, 'server.mjs'), 'utf8').replace('registerWorkspaceRoutes(app)', testOnlyRoutes + '\nregisterWorkspaceRoutes(app)'))
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
  assert.equal(Date.parse(trash.data.items[0].trashExpiresAt) - Date.parse(trash.data.items[0].deletedAt), 7 * 86400000, '个人回收站到期时间严格为删除后7天')
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

  // TRASH-005：可控 now 触发生产清理函数，验证过期个人/团队文件和元数据被实际清除。
  const seededExpiry = await api('/__trash_fixture/seed-expiration', { user: 'owner', method: 'POST', body: {} })
  assert.equal(seededExpiry.res.status, 200)
  const beforePurge = JSON.parse(fs.readFileSync(path.join(fixture, 'storage/metadata.json'), 'utf8'))
  assert.equal(beforePurge.shares.find(item => item.id === 'expired-personal-share').trashExpiresAt < new Date().toISOString(), true)
  assert.ok(fs.existsSync(path.join(fixture, 'storage/files/expired-personal-share/fixture.txt')))
  const purgedExpired = await api('/__trash_fixture/purge-expired', { user: 'owner', method: 'POST', body: { now: Date.now() } })
  assert.equal(purgedExpired.res.status, 200); assert.equal(purgedExpired.data.changed, true)
  const afterPurge = JSON.parse(fs.readFileSync(path.join(fixture, 'storage/metadata.json'), 'utf8'))
  for (const id of ['expired-personal-share', 'expired-team-share']) assert.equal(afterPurge.shares.some(item => item.id === id), false, `${id} 元数据已清除`)
  assert.equal(afterPurge.collections.some(item => item.id === 'expired-personal-collection'), false, '过期收集任务元数据已清除')
  assert.equal(afterPurge.shares.some(item => item.id === 'active-trash-share'), true, '未到期回收站条目保留')
  for (let attempt = 0; attempt < 100 && (['expired-personal-share', 'expired-team-share'].some(id => fs.existsSync(path.join(fixture, 'storage/files', id))) || fs.existsSync(path.join(fixture, 'storage/collections/expired-personal-collection'))); attempt++) await delay(10)
  assert.equal(fs.existsSync(path.join(fixture, 'storage/files/expired-personal-share')), false, '过期个人文件已物理删除')
  assert.equal(fs.existsSync(path.join(fixture, 'storage/files/expired-team-share')), false, '过期团队文件已物理删除')
  assert.equal(fs.existsSync(path.join(fixture, 'storage/collections/expired-personal-collection')), false, '过期收集文件已物理删除')
  assert.equal(fs.existsSync(path.join(fixture, 'storage/files/active-trash-share/fixture.txt')), true, '未到期文件保留')
  console.log('PASS TRASH-005: 7天期限及个人/团队过期资源自动清理元数据和磁盘文件')
  await api('/__trash_fixture/purge-expired', { user: 'owner', method: 'POST', body: { now: Date.now() + 2 * 86400000 } })

  // TRASH-002：收集任务作为个人资源进入回收站，恢复后提交/字段和文件内容完整保留。
  const collectionResponse = await api('/api/collections', { user: 'owner', method: 'POST', body: {
    title: '回收站收集任务恢复验收', materials: [{ id: 'contract', name: '签字合同', required: true }],
    customFields: [{ id: 'vendor', label: '供应商名称', type: 'text', required: true }],
  } })
  assert.equal(collectionResponse.res.status, 201)
  const task = collectionResponse.data.collection, manageToken = collectionResponse.data.manageToken
  const collectionBody = new FormData()
  collectionBody.append('files', new Blob(['collection-trash-content']), 'signed-contract.txt')
  collectionBody.append('participantName', '回收站测试供应商')
  collectionBody.append('fieldValues', JSON.stringify({ vendor: '回收站测试供应商有限公司' }))
  collectionBody.append('materialIds', JSON.stringify(['contract']))
  const submittedCollection = await api(`/api/collections/${task.token}/submissions`, { method: 'POST', body: collectionBody })
  assert.equal(submittedCollection.res.status, 201, JSON.stringify(submittedCollection.data))
  const collectionRecord = {
    id: `my_collections:collection:${manageToken}`, scope: 'my_collections', kind: 'collection', type: '收集',
    name: task.title, status: '进行中', manageToken, collectionToken: task.token,
    publicUrl: task.publicUrl, manageUrl: task.manageUrl, submissionCount: 1,
  }
  await api('/api/account/records', { user: 'owner', method: 'POST', body: { record: collectionRecord } })
  const trashedCollection = await api('/api/account/records', { user: 'owner', method: 'DELETE', body: { ids: [collectionRecord.id] } })
  assert.equal(trashedCollection.res.status, 200)
  assert.equal(trashedCollection.data.purged.length, 1)
  const collectionTrash = await api('/api/account/trash', { user: 'owner' })
  const collectionTrashItem = collectionTrash.data.items.find(item => item.kind === 'collection' && item.id === task.id)
  assert.ok(collectionTrashItem, '收集任务应进入个人回收站')
  assert.equal((await api('/api/account/trash', { user: 'other' })).data.items.some(item => item.id === task.id), false)
  assert.equal((await api(`/api/collections/manage/${manageToken}`, { user: 'owner' })).res.status, 200, '回收期内保留收集管理数据')
  assert.equal((await api(`/api/collections/${task.token}`)).res.status, 410, '移入回收站后提交入口不再接受提交')
  const restoredCollection = await api(`/api/account/trash/collection/${task.id}/restore`, { user: 'owner', method: 'POST' })
  assert.equal(restoredCollection.res.status, 200)
  const recoveredManage = await api(`/api/collections/manage/${manageToken}`, { user: 'owner' })
  const recoveredSubmission = recoveredManage.data.collection?.submissions?.find(item => item.id === submittedCollection.data.submission.id)
  assert.equal(recoveredSubmission?.fieldValues?.vendor, '回收站测试供应商有限公司', JSON.stringify({ recoveredSubmission, recoveredManage: recoveredManage.data.collection?.submissions, submitted: submittedCollection.data.submission }))
  assert.ok(recoveredSubmission?.materialIds?.includes('contract'))
  assert.equal(recoveredSubmission?.files?.[0]?.name, 'signed-contract.txt')
  assert.ok(fs.existsSync(path.join(fixture, 'storage/collections', task.id)))
  const restoredCollectionRecord = (await api('/api/account/records', { user: 'owner' })).data.records.find(item => item.id === collectionRecord.id)
  assert.ok(restoredCollectionRecord, '恢复后任务回到个人收集记录')
  assert.equal(restoredCollectionRecord.kind, 'collection')
  assert.equal(restoredCollectionRecord.manageToken, manageToken)
  const restoredFile = await fetch(`${base}/api/collections/manage/${manageToken}/submissions/${submittedCollection.data.submission.id}/files/0/download`, { headers: { cookie: 'kunqiong_session=owner-session' } })
  assert.equal(restoredFile.status, 200)
  assert.deepEqual(Buffer.from(await restoredFile.arrayBuffer()), Buffer.from('collection-trash-content'), '恢复后的文件正文保持逐字节一致')
  assert.equal((await api(`/api/collections/${task.token}`)).res.status, 410, '恢复任务不自动重新开启公开收集链接')
  console.log('PASS TRASH-002: 个人收集任务恢复后提交、字段答案、材料状态和文件完整保留')

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

