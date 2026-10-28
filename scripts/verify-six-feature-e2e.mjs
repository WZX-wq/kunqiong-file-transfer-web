// 六项功能连续回归：隔离真实 HTTP 服务、合成账号、临时存储，不接触正式/开发数据。
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
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-six-feature-e2e-'))
const now = new Date().toISOString(), future = new Date(Date.now() + 20 * 86400000).toISOString()
const users = Object.fromEntries(['owner', 'target', 'alice', 'bob', 'outsider'].map(id => [id, {
  id, username: `${id}@example.test`, email: `${id}@example.test`, nickname: `合成${id}`, status: 'active',
  planId: id === 'owner' ? 'enterprise' : 'free', planExpiresAt: future,
  ...(id === 'owner' ? { organizationId: 'e2e-team', organizationRole: 'owner' } : {}),
  ...(id === 'target' ? { organizationId: 'e2e-team', organizationRole: 'member' } : {}),
}]))
const org = {
  id: 'e2e-team', name: '六项联合验收团队', slug: 'six-feature-e2e', ownerUserId: 'owner',
  teamPlanId: 'enterprise', teamPlanPermanent: true, createdAt: now, updatedAt: now,
  members: [
    { id: 'm-owner', userId: 'owner', displayName: '合成owner', role: 'owner', status: 'active', joinedAt: now },
    { id: 'm-target', userId: 'target', displayName: '合成target', role: 'member', status: 'active', joinedAt: now },
  ],
}
function copyDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: true })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name), to = path.join(destination, entry.name)
    if (entry.isDirectory()) copyDirectory(from, to)
    else if (entry.isFile()) fs.copyFileSync(from, to)
  }
}
fs.copyFileSync(path.join(root, 'server.mjs'), path.join(fixture, 'server.mjs'))
copyDirectory(path.join(root, 'server'), path.join(fixture, 'server'))
fs.copyFileSync(path.join(root, 'package.json'), path.join(fixture, 'package.json'))
fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
fs.mkdirSync(path.join(fixture, 'email-templates'), { recursive: true })
for (const file of fs.readdirSync(path.join(root, 'email-templates'))) fs.copyFileSync(path.join(root, 'email-templates', file), path.join(fixture, 'email-templates', file))
fs.mkdirSync(path.join(fixture, 'storage'), { recursive: true })
const teamContent = Buffer.from('team-trash-e2e-content')
const teamShare = {
  id: 'team-e2e-resource', code: 'E2ETEAM', manageToken: 'team-e2e-manage', ownerUserId: 'owner',
  teamResource: true, teamOrganizationId: org.id, status: 'active', createdAt: now, expiresAt: future,
  files: [{ name: 'team-resource.txt', relativePath: 'team-resource.txt', storedName: 'team-resource.txt', size: teamContent.length, mimeType: 'text/plain', reviewStatus: 'clean', scanEngine: 'fixture', scannedAt: now }],
}
const sessions = Object.values(users).map(user => ({ id: `${user.id}-session`, user, expiresAt: future }))
fs.writeFileSync(path.join(fixture, 'storage', 'metadata.json'), JSON.stringify({
  users, sessions, organizations: { [org.id]: org }, shares: [teamShare], distributions: [], collections: [],
  records: {}, messages: {}, systemConfig: { anonymousTotalSizeMb: 100 },
}))
const teamDirectory = path.join(fixture, 'storage', 'files', teamShare.id)
fs.mkdirSync(teamDirectory, { recursive: true })
fs.writeFileSync(path.join(teamDirectory, 'team-resource.txt'), teamContent)

const probe = net.createServer()
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
const port = probe.address().port
await new Promise(resolve => probe.close(resolve))
const base = `http://127.0.0.1:${port}`
const env = { ...process.env }
for (const key of Object.keys(env)) if (/^(KUNQIONG_|OAUTH_)/.test(key)) delete env[key]
const child = spawn(process.execPath, ['server.mjs'], { cwd: fixture, windowsHide: true, env: { ...env, PORT: String(port), NODE_ENV: 'production', KUNQIONG_HOST: '127.0.0.1', KUNQIONG_DB_ENABLED: 'false', KUNQIONG_SCAN_MODE: 'optional' }, stdio: ['ignore', 'ignore', 'pipe'] })
let startupError = ''
child.stderr.on('data', chunk => { startupError += String(chunk) })
let started = false
for (let index = 0; index < 300; index++) {
  try { if ((await fetch(`${base}/api/health`)).ok) { started = true; break } } catch {}
  if (child.exitCode !== null) break
  await delay(50)
}
if (!started) throw new Error(`联合验收 HTTP fixture 启动失败：${startupError}`)

async function api(url, { user = '', method = 'GET', body, raw = false } = {}) {
  const multipart = body instanceof FormData
  const response = await fetch(base + url, {
    method,
    headers: { ...(user ? { cookie: `kunqiong_session=${user}-session` } : {}), ...(body && !multipart ? { 'content-type': 'application/json' } : {}) },
    body: body ? (multipart ? body : JSON.stringify(body)) : undefined,
  })
  if (raw) return { response, bytes: Buffer.from(await response.arrayBuffer()) }
  return { response, data: await response.json().catch(() => ({})) }
}
function zipNames(buffer) {
  let end = -1
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 22 - 65536); offset--) if (buffer.readUInt32LE(offset) === 0x06054b50) { end = offset; break }
  if (end < 0) return []
  const count = buffer.readUInt16LE(end + 10); let offset = buffer.readUInt32LE(end + 16); const result = []
  for (let index = 0; index < count; index++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break
    const size = buffer.readUInt16LE(offset + 28), extra = buffer.readUInt16LE(offset + 30), comment = buffer.readUInt16LE(offset + 32)
    result.push(buffer.subarray(offset + 46, offset + 46 + size).toString('utf8'))
    offset += 46 + size + extra + comment
  }
  return result
}
const passed = []
function check(id, condition, detail = '') { assert.ok(condition, `${id} ${detail}`); passed.push(id); console.log(`PASS ${id}`) }

try {
  // 1) 品牌与收集字段、材料、命名规则同源。
  const branding = await api('/api/account/workspace/branding', { user: 'owner', method: 'PATCH', body: { revision: 0, name: '六项联合验收中心', introduction: '自动化隔离验收' } })
  check('E2E-BRAND-SAVE', branding.response.status === 200 && branding.data.branding.enabled && branding.data.branding.revision === 1)
  const created = await api('/api/collections', { user: 'owner', method: 'POST', body: {
    title: '六项联合验收收集任务', description: '合成数据', maxFileSizeMb: 10, allowedTypes: ['全部格式'],
    materials: [{ id: 'qualification', name: '资质证明', required: true, namingPattern: '{提交人}_{材料项}_{原文件名}' }],
    customFields: [{ id: 'supplier-name', label: '供应商名称', type: 'text', required: true }],
  } })
  check('E2E-COLLECTION-CREATE', created.response.status === 201 && created.data.collection.customFields[0].label === '供应商名称' && created.data.collection.materials[0].required)
  const publicTask = await api(`/api/collections/${created.data.collection.token}?organization=${org.slug}`)
  check('E2E-BRAND-COLLECTION', publicTask.response.status === 200 && publicTask.data.collection.branding.name === '六项联合验收中心')
  const payload = new FormData()
  payload.append('files', new Blob(['named-qualification-content']), 'qualification-original.txt')
  payload.append('participantName', '验收供应商')
  payload.append('fieldValues', JSON.stringify({ 'supplier-name': '验收供应商有限公司' }))
  payload.append('materialIds', JSON.stringify(['qualification']))
  payload.append('fileMaterialIds', JSON.stringify(['qualification']))
  const submitted = await api(`/api/collections/${created.data.collection.token}/submissions`, { method: 'POST', body: payload })
  const namedFile = submitted.data.submission?.files?.[0]
  check('E2E-COLLECTION-SUBMIT', submitted.response.status === 201 && submitted.data.submission.fieldValues['supplier-name'] === '验收供应商有限公司' && namedFile.name === '验收供应商_资质证明_qualification-original.txt' && namedFile.originalName === 'qualification-original.txt')
  const archive = await api(`/api/collections/manage/${created.data.manageToken}/download`, { user: 'owner', raw: true })
  check('E2E-NAMING-ZIP', archive.response.status === 200 && zipNames(archive.bytes).some(name => name.endsWith('/验收供应商_资质证明_qualification-original.txt')))

  // 2) 品牌保持团队关联；接收者确认后团队负责人切换。
  const startedHandover = await api('/api/account/workspace/transfer-ownership', { user: 'owner', method: 'POST', body: { targetMemberId: 'm-target' } })
  check('E2E-HANDOVER-INIT', startedHandover.response.status === 201 && !startedHandover.data.transferred)
  const acceptedHandover = await api(`/api/account/workspace/ownership-handovers/${startedHandover.data.handover.id}`, { user: 'target', method: 'POST', body: { decision: 'accept' } })
  const overview = await api('/api/account/team/overview', { user: 'target' })
  check('E2E-HANDOVER-ACCEPT', acceptedHandover.response.status === 200 && acceptedHandover.data.transferred && overview.data.organization.ownerUserId === 'target')
  const brandedTaskAfterHandover = await api(`/api/collections/${created.data.collection.token}?organization=${org.slug}`)
  check('E2E-BRAND-HANDOVER-PRESERVED', brandedTaskAfterHandover.data.collection.branding.name === '六项联合验收中心')

  // 3) 按行分配文件给合成收件人，验证本人文件视图与冻结记录。
  const preview = await api('/api/distributions/preview', { user: 'owner', method: 'POST', body: { files: ['alice-proof.txt', 'bob-proof.txt'], assignments: [{ fileIndex: 0, recipient: 'alice' }, { fileIndex: 1, recipient: 'bob' }] } })
  check('E2E-DISTRIBUTION-PREVIEW', preview.response.status === 200 && preview.data.preview.ok && preview.data.preview.rows.length === 2)
  const distributionForm = new FormData()
  distributionForm.append('files', new Blob(['alice-private']), 'alice-proof.txt')
  distributionForm.append('files', new Blob(['bob-private']), 'bob-proof.txt')
  distributionForm.append('assignments', JSON.stringify([{ fileIndex: 0, recipient: 'alice' }, { fileIndex: 1, recipient: 'bob' }]))
  distributionForm.append('idempotencyKey', 'six-feature-e2e-key')
  const distribution = await api('/api/distributions', { user: 'owner', method: 'POST', body: distributionForm })
  const alice = await api(`/api/shares/token/${distribution.data.share.id}`, { user: 'alice' })
  const bob = await api(`/api/shares/token/${distribution.data.share.id}`, { user: 'bob' })
  const stranger = await api(`/api/shares/token/${distribution.data.share.id}`, { user: 'outsider' })
  check('E2E-DISTRIBUTION-PUBLISH', distribution.response.status === 201 && distribution.data.distribution.frozenAt && alice.data.share.files.length === 1 && alice.data.share.files[0].name === 'alice-proof.txt' && bob.data.share.files.length === 1 && bob.data.share.files[0].name === 'bob-proof.txt' && stranger.response.status === 403)

  // 4) 删除并恢复个人收集任务、团队文件；数据仍在，公开任务不自动重新开放。
  const record = { id: `my_collections:collection:${created.data.manageToken}`, scope: 'my_collections', kind: 'collection', type: '收集', name: created.data.collection.title, status: '进行中', manageToken: created.data.manageToken, collectionToken: created.data.collection.token, publicUrl: created.data.collection.publicUrl, manageUrl: created.data.collection.manageUrl, submissionCount: 1 }
  const synced = await api('/api/account/records', { user: 'owner', method: 'POST', body: { record } })
  check('E2E-TRASH-RECORD', synced.response.status === 201)
  const deletedRecord = await api('/api/account/records', { user: 'owner', method: 'DELETE', body: { ids: [record.id] } })
  const collectionTrash = await api('/api/account/trash', { user: 'owner' })
  const trashItem = collectionTrash.data.items.find(item => item.kind === 'collection' && item.id === created.data.collection.id)
  check('E2E-TRASH-COLLECTION', deletedRecord.response.status === 200 && trashItem && collectionTrash.data.retentionDays === 7)
  const restoreCollection = await api(`/api/account/trash/collection/${created.data.collection.id}/restore`, { user: 'owner', method: 'POST' })
  const restoredSubmission = await api(`/api/collections/manage/${created.data.manageToken}`, { user: 'owner' })
  const restoredFile = await fetch(`${base}/api/collections/manage/${created.data.manageToken}/submissions/${submitted.data.submission.id}/files/0/download`, { headers: { cookie: 'kunqiong_session=owner-session' } })
  check('E2E-TRASH-RESTORE', restoreCollection.response.status === 200 && restoredSubmission.data.collection.submissions[0].fieldValues['supplier-name'] === '验收供应商有限公司' && Buffer.from(await restoredFile.arrayBuffer()).equals(Buffer.from('named-qualification-content')) && (await api(`/api/collections/${created.data.collection.token}`)).response.status === 410)
  const trashTeam = await api('/api/account/team/resources/team-e2e-resource', { user: 'target', method: 'DELETE' })
  const teamTrash = await api('/api/account/team/trash', { user: 'target' })
  const teamItem = teamTrash.data.items.find(item => item.id === teamShare.id)
  const teamRestore = await api(`/api/account/team/trash/${teamShare.id}/restore`, { user: 'target', method: 'POST' })
  const restoredTeamResource = await api(`/api/shares/token/${teamShare.id}`, { user: 'target' })
  check('E2E-TEAM-TRASH-RESTORE', trashTeam.response.status === 200 && teamItem?.totalSize === teamContent.length && teamRestore.response.status === 200 && teamRestore.data.item.status === 'closed' && restoredTeamResource.response.status === 200 && restoredTeamResource.data.share.status === 'closed' && restoredTeamResource.data.share.closeReason === 'team_trash_restore')

  console.log(JSON.stringify({ executedAt: new Date().toISOString(), passed: passed.length, failed: 0, caseIds: passed, environment: 'Isolated HTTP server, temporary JSON/file storage, synthetic accounts only' }, null, 2))
} finally {
  if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await Promise.race([exited, delay(3000)]) }
}
