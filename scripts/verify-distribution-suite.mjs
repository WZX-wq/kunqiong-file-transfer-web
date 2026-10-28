// 定向分发接口与权限回归：使用隔离 metadata，不触碰开发环境 storage。
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
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-distribution-suite-'))
const future = new Date(Date.now() + 20 * 86400000).toISOString()
const users = Object.fromEntries(['owner', 'alice', 'bob', 'stranger'].map(id => [id, { id, username: id, nickname: id, status: 'active', planId: 'member', planExpiresAt: future, email: `${id}@example.test`, phone: id === 'bob' ? '13507786589' : '' }]))
const sessions = Object.values(users).map(user => ({ id: `${user.id}-session`, user, expiresAt: future }))
// 生产账号的内部 ID 可能是纯数字；通过“bob-session”登录的测试用户仍代表该账号。
users.bob.id = '706'
function copyDirectory(source, target) { fs.mkdirSync(target, { recursive: true }); for (const entry of fs.readdirSync(source, { withFileTypes: true })) { const from = path.join(source, entry.name); const to = path.join(target, entry.name); if (entry.isDirectory()) copyDirectory(from, to); else if (entry.isFile()) fs.copyFileSync(from, to) } }
fs.copyFileSync(path.join(root, 'server.mjs'), path.join(fixture, 'server.mjs'))
copyDirectory(path.join(root, 'server'), path.join(fixture, 'server'))
fs.copyFileSync(path.join(root, 'package.json'), path.join(fixture, 'package.json'))
fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
fs.mkdirSync(path.join(fixture, 'email-templates'), { recursive: true })
for (const name of fs.readdirSync(path.join(root, 'email-templates'))) fs.copyFileSync(path.join(root, 'email-templates', name), path.join(fixture, 'email-templates', name))
fs.mkdirSync(path.join(fixture, 'storage'))
fs.writeFileSync(path.join(fixture, 'storage', 'metadata.json'), JSON.stringify({ users, sessions, shares: [], distributions: [], collections: [], messages: {}, systemConfig: { anonymousTotalSizeMb: 100 } }))

const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve))
const cleanEnv = { ...process.env }; for (const key of Object.keys(cleanEnv)) if (key.startsWith('KUNQIONG_') || key.startsWith('OAUTH_')) delete cleanEnv[key]
const child = spawn(process.execPath, ['server.mjs'], { cwd: fixture, windowsHide: true, env: { ...cleanEnv, PORT: String(port), NODE_ENV: 'production', KUNQIONG_HOST: '127.0.0.1', KUNQIONG_SCAN_MODE: 'optional' }, stdio: ['ignore', 'ignore', 'pipe'] })
const base = `http://127.0.0.1:${port}`
let started = false; let startupError = ''
child.stderr.on('data', chunk => { startupError += String(chunk) })
for (let i = 0; i < 300; i++) { try { if ((await fetch(`${base}/api/health`)).ok) { started = true; break } } catch {} if (child.exitCode !== null) break; await delay(50) }
if (!started) throw new Error(`fixture 启动失败: ${startupError}`)
async function api(url, { user = '', method = 'GET', body, headers = {} } = {}) { const res = await fetch(base + url, { method, headers: { ...(user ? { cookie: `kunqiong_session=${user}-session` } : {}), ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...headers }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined }); return { res, data: await res.json().catch(() => ({})) } }
function form(key = 'k1') { const body = new FormData(); body.append('files', new Blob(['alice file']), '001__alice.txt'); body.append('files', new Blob(['bob file']), '002__bob.txt'); body.append('roster', '001,alice\n002,bob'); body.append('idempotencyKey', key); return body }
try {
  let result = await api('/api/distributions/preview', { user: 'owner', method: 'POST', body: { files: ['001__alice.txt', '002__bob.txt'], roster: '001,alice\n002,bob' } })
  assert.equal(result.res.status, 200); assert.equal(result.data.preview.ok, true); assert.equal(result.data.preview.rows.length, 2)
  result = await api('/api/distributions/preview', { user: 'owner', method: 'POST', body: { files: ['001__alice.txt', '001__duplicate.txt'], roster: '001,alice' } })
  assert.equal(result.data.preview.ok, false); assert.ok(result.data.preview.issues.some(issue => issue.code === 'duplicate_file_key'))
  const published = await api('/api/distributions', { user: 'owner', method: 'POST', body: form('distribution-suite-key') })
  assert.equal(published.res.status, 201); assert.equal(published.data.distribution.rowCount, 2)
  const shareId = published.data.share.id
  const ownerView = await api(`/api/shares/token/${shareId}`, { user: 'owner' }); assert.equal(ownerView.res.status, 200); assert.equal(ownerView.data.share.files.length, 2)
  const aliceView = await api(`/api/shares/token/${shareId}`, { user: 'alice' }); assert.equal(aliceView.res.status, 200); assert.equal(aliceView.data.share.files.length, 1); assert.equal(aliceView.data.share.files[0].name, 'alice.txt'); assert.equal(Object.hasOwn(aliceView.data.share.files[0], 'distributionRecipientUserId'), false)
  const bobViewInitial = await api(`/api/shares/token/${shareId}`, { user: 'bob' }); assert.equal(bobViewInitial.res.status, 200); assert.equal(bobViewInitial.data.share.files.length, 1); assert.equal(bobViewInitial.data.share.files[0].name, 'bob.txt')
  const strangerView = await api(`/api/shares/token/${shareId}`, { user: 'stranger' }); assert.equal(strangerView.res.status, 403)
  const aliceDownload = await fetch(`${base}/api/shares/${shareId}/files/0/download`, { headers: { cookie: 'kunqiong_session=alice-session' } }); assert.equal(aliceDownload.status, 200)
  assert.deepEqual(Buffer.from(await aliceDownload.arrayBuffer()), Buffer.from('alice file'))
  const bobDownload = await fetch(`${base}/api/shares/${shareId}/files/0/download`, { headers: { cookie: 'kunqiong_session=bob-session' } }); assert.equal(bobDownload.status, 200)
  assert.deepEqual(Buffer.from(await bobDownload.arrayBuffer()), Buffer.from('bob file'))
  const wrongDownload = await fetch(`${base}/api/shares/${shareId}/files/1/download`, { headers: { cookie: 'kunqiong_session=alice-session' } }); assert.equal(wrongDownload.status, 404)
  const outsiderDownload = await fetch(`${base}/api/shares/${shareId}/files/0/download`, { headers: { cookie: 'kunqiong_session=stranger-session' } }); assert.equal(outsiderDownload.status, 403)
  const outsiderPreview = await fetch(`${base}/api/shares/${shareId}/files/0/preview`, { headers: { cookie: 'kunqiong_session=stranger-session' } }); assert.equal(outsiderPreview.status, 403)
  const reused = await api('/api/distributions', { user: 'owner', method: 'POST', body: form('distribution-suite-key') }); assert.equal(reused.res.status, 200); assert.equal(reused.data.reused, true); assert.equal(reused.data.share.id, shareId)
  console.log('PASS: 定向分发预览、阻断、发布、逐文件权限、错误领取和幂等重试')

  // 新流程：文件保持原名，前端逐条核对后提交 assignments，不再要求改文件名。
  result = await api('/api/distributions/preview', { user: 'owner', method: 'POST', body: { files: ['劳动合同.txt', '报价单.txt'], roster: 'alice\nbob' } })
  assert.equal(result.data.preview.ok, true); assert.equal(result.data.preview.rows.length, 2); assert.equal(result.data.preview.rows[1].recipient, 'bob')
  const friendly = new FormData()
  friendly.append('files', new Blob(['contract']), '劳动合同.txt')
  friendly.append('files', new Blob(['quote']), '报价单.txt')
  friendly.append('assignments', JSON.stringify([{ fileIndex: 0, recipient: 'bob' }, { fileIndex: 1, recipient: 'alice' }]))
  friendly.append('idempotencyKey', 'distribution-friendly-key')
  const friendlyPublished = await api('/api/distributions', { user: 'owner', method: 'POST', body: friendly })
  assert.equal(friendlyPublished.res.status, 201)
  const friendlyShare = friendlyPublished.data.share.id
  const bobView = await api(`/api/shares/token/${friendlyShare}`, { user: 'bob' })
  assert.equal(bobView.res.status, 200); assert.equal(bobView.data.share.files.length, 1); assert.equal(bobView.data.share.files[0].name, '劳动合同.txt')
  const aliceFriendly = await api(`/api/shares/token/${friendlyShare}`, { user: 'alice' })
  assert.equal(aliceFriendly.data.share.files.length, 1); assert.equal(aliceFriendly.data.share.files[0].name, '报价单.txt')
  const phonePreview = await api('/api/distributions/preview', { user: 'owner', method: 'POST', body: { files: ['手机号文件.txt'], assignments: [{ fileIndex: 0, recipient: '13507786589' }] } })
  assert.equal(phonePreview.res.status, 200); assert.equal(phonePreview.data.preview.ok, true)
  assert.equal(phonePreview.data.preview.rows[0].userId, '706')
  const phoneForm = new FormData()
  phoneForm.append('files', new Blob(['phone recipient file']), '手机号文件.txt')
  phoneForm.append('assignments', JSON.stringify([{ fileIndex: 0, recipient: '13507786589' }]))
  phoneForm.append('idempotencyKey', 'distribution-phone-key')
  const phonePublished = await api('/api/distributions', { user: 'owner', method: 'POST', body: phoneForm })
  assert.equal(phonePublished.res.status, 201)
  const phoneRecipientView = await api(`/api/shares/token/${phonePublished.data.share.id}`, { user: 'bob' })
  assert.equal(phoneRecipientView.res.status, 200); assert.equal(phoneRecipientView.data.share.files.length, 1)
  console.log('PASS DIST-007: 已匹配手机号可正常发布，不会把纯数字内部用户 ID 误判为手机号')
  const frozen = await api(`/api/distributions/${friendlyPublished.data.distribution.id}`, { user: 'owner' })
  assert.equal(frozen.res.status, 200); assert.equal(frozen.data.distribution.rows.length, 2)
  const changedSourceRetry = new FormData()
  changedSourceRetry.append('files', new Blob(['replacement should not be applied']), '劳动合同.txt')
  changedSourceRetry.append('files', new Blob(['new recipient should not receive this']), '报价单.txt')
  changedSourceRetry.append('assignments', JSON.stringify([{ fileIndex: 0, recipient: 'alice' }, { fileIndex: 1, recipient: 'bob' }]))
  changedSourceRetry.append('idempotencyKey', 'distribution-friendly-key')
  const frozenRetry = await api('/api/distributions', { user: 'owner', method: 'POST', body: changedSourceRetry })
  assert.equal(frozenRetry.res.status, 200); assert.equal(frozenRetry.data.reused, true)
  assert.equal(frozenRetry.data.distribution.id, frozen.data.distribution.id)
  assert.equal(frozenRetry.data.distribution.shareId, frozen.data.distribution.shareId)
  assert.deepEqual(frozenRetry.data.distribution.rows, frozen.data.distribution.rows, '同幂等请求不能替换已发布收件人映射')
  const frozenBob = await api(`/api/shares/token/${friendlyShare}`, { user: 'bob' })
  assert.equal(frozenBob.data.share.files.length, 1); assert.equal(frozenBob.data.share.files[0].name, '劳动合同.txt')
  const originalDownload = await fetch(`${base}/api/shares/${friendlyShare}/files/0/download`, { headers: { cookie: 'kunqiong_session=bob-session' } })
  assert.equal(originalDownload.status, 200)
  assert.deepEqual(Buffer.from(await originalDownload.arrayBuffer()), Buffer.from('contract'), '已发布文件快照不随客户端替换文件改变')
  const newReleaseForm = new FormData()
  newReleaseForm.append('files', new Blob(['new contract release']), '劳动合同.txt')
  newReleaseForm.append('files', new Blob(['new quote release']), '报价单.txt')
  newReleaseForm.append('assignments', JSON.stringify([{ fileIndex: 0, recipient: 'alice' }, { fileIndex: 1, recipient: 'bob' }]))
  newReleaseForm.append('idempotencyKey', 'distribution-new-release-key')
  const newRelease = await api('/api/distributions', { user: 'owner', method: 'POST', body: newReleaseForm })
  assert.equal(newRelease.res.status, 201)
  assert.notEqual(newRelease.data.distribution.id, frozen.data.distribution.id)
  const oldReleaseAfterChange = await api(`/api/distributions/${frozen.data.distribution.id}`, { user: 'owner' })
  const oldRecipientAfterChange = await api(`/api/shares/token/${friendlyShare}`, { user: 'bob' })
  const oldContentAfterChange = await fetch(`${base}/api/shares/${friendlyShare}/files/0/download`, { headers: { cookie: 'kunqiong_session=bob-session' } })
  assert.deepEqual(oldReleaseAfterChange.data.distribution.rows, frozen.data.distribution.rows)
  assert.equal(oldRecipientAfterChange.data.share.files[0].name, '劳动合同.txt')
  assert.deepEqual(Buffer.from(await oldContentAfterChange.arrayBuffer()), Buffer.from('contract'))
  console.log('PASS DIST-006: 发布重试保持固定文件快照、收件人映射和发布记录')
  console.log('PASS DIST-006: 新发布创建独立记录，旧链接映射和文件快照继续固定')
  result = await api('/api/distributions/preview', { user: 'owner', method: 'POST', body: { files: ['a.txt'], assignments: [{ fileIndex: 0, recipient: 'nobody' }] } })
  assert.equal(result.data.preview.ok, false); assert.ok(result.data.preview.issues.some(issue => issue.code === 'recipient_not_found'))
  console.log('PASS: 原名上传、顺序配对、逐条调整与收件人校验')
} finally { if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await Promise.race([exited, delay(3000)]) } }

