// SHARE 补测：覆盖 verify-remediation 未覆盖的 SHARE-001/006/007/012/013 关键断言。
// 复用隔离 fixture + 账号会话 + 模拟扫描器（与 verify-remediation 同构）。
// 用法：node scripts/verify-share-suite.mjs
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
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-share-suite-'))
const future = new Date(Date.now() + 20 * 86400000).toISOString()
const users = Object.fromEntries(['owner', 'recipient', 'stranger', 'member'].map((id) => [id, { id, username: id, nickname: id, status: 'active', planId: 'free' }]))
users.owner.email = 'sender@example.test'
users.owner.phone = '13507786589'
users.recipient.email = 'recipient@example.test'
users.recipient.phone = '13800001111'
users.member.planId = 'member'
users.member.planExpiresAt = future
const sessions = Object.values(users).map((user) => ({ id: user.id + '-session', user, apiWebToken: 'fixture-token-' + user.id, expiresAt: future }))
fs.copyFileSync(path.join(root, 'server.mjs'), path.join(fixture, 'server.mjs'))
// 只在隔离副本修改绑定资料，验证上传会话和用户资料变更的交叉行为。
const control = `
app.post('/__share_fixture', async (req, res) => {
 const { metadata, persistMetadata } = await import('./server/lib/metadata-store.js');
 metadata.users.owner.email = req.body.email;
 persistMetadata(); res.json({ok:true});
});
`
fs.writeFileSync(path.join(fixture,'server.mjs'),fs.readFileSync(path.join(fixture,'server.mjs'),'utf8').replace('registerShareCreateRoutes(app)',control+'\nregisterShareCreateRoutes(app)'))
function copyDirectory(source, target) {
  fs.mkdirSync(target, { recursive: true })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name); const to = path.join(target, entry.name)
    if (entry.isDirectory()) copyDirectory(from, to); else if (entry.isFile()) fs.copyFileSync(from, to)
  }
}
copyDirectory(path.join(root, 'server'), path.join(fixture, 'server'))
fs.copyFileSync(path.join(root, 'package.json'), path.join(fixture, 'package.json'))
fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
const templateSource = path.join(root, 'email-templates')
fs.mkdirSync(path.join(fixture, 'email-templates'))
for (const name of fs.readdirSync(templateSource)) fs.copyFileSync(path.join(templateSource, name), path.join(fixture, 'email-templates', name))
fs.mkdirSync(path.join(fixture, 'storage'))
fs.writeFileSync(path.join(fixture, 'storage', 'metadata.json'), JSON.stringify({ users, sessions, shares: [], collections: [], messages: {}, systemConfig: { anonymousTotalSizeMb: 1 }, upgradeOrders: [] }))

// 模拟扫描器（返回 OK）
const scanner = net.createServer((socket) => {
  let input = Buffer.alloc(0), command = false, ended = false
  socket.on('error', () => {})
  socket.on('data', (data) => {
    input = Buffer.concat([input, data])
    if (!command) { const e = input.indexOf(0); if (e < 0) return; input = input.subarray(e + 1); command = true }
    while (input.length >= 4 && !ended) {
      const length = input.readUInt32BE(0)
      if (input.length < 4 + length) break
      input = input.subarray(4 + length)
      if (!length) { ended = true; socket.end('stream: OK\0') }
    }
  })
})
await new Promise((r) => scanner.listen(0, '127.0.0.1', r))
const scannerPort = scanner.address().port

const cleanEnv = { ...process.env }
for (const key of Object.keys(cleanEnv)) if (key.startsWith('KUNQIONG_') || key.startsWith('OAUTH_')) delete cleanEnv[key]

let child, base, passed = 0
const failures = []
function check(name, cond, detail = '') { if (cond) { passed++; console.log(`  PASS  ${name}`) } else { failures.push(name); console.log(`  FAIL  ${name}  ${detail}`) } }
async function start() {
  const probe = net.createServer(); await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port; await new Promise((resolve) => probe.close(resolve))
  base = `http://127.0.0.1:${port}`
  child = spawn(process.execPath, ['server.mjs'], {
    cwd: fixture, windowsHide: true,
    env: { ...cleanEnv, PORT: String(port), NODE_ENV: 'production', KUNQIONG_HOST: '127.0.0.1', KUNQIONG_SCAN_MODE: 'required', KUNQIONG_CLAMAV_HOST: '127.0.0.1', KUNQIONG_CLAMAV_PORT: String(scanner.address().port) },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let errors = ''
  child.stderr.on('data', (d) => { errors += d })
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/api/health')).ok) return } catch {}
    if (child.exitCode !== null) throw new Error('fixture 启动失败: ' + errors)
    await delay(50)
  }
  throw new Error('fixture 启动失败: ' + errors)
}
async function stop() { if (child && child.exitCode === null) { const e = once(child, 'exit'); child.kill(); await Promise.race([e, delay(3000)]) } }
async function api(url, { user = '', method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(base + url, { method, headers: { ...(user ? { cookie: `kunqiong_session=${user}-session` } : {}), ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...headers }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined })
  const data = method === 'HEAD' ? {} : await res.json().catch(() => ({}))
  return { res, data, status: res.status, headers: res.headers }
}
function form(text, name = 'fixture.txt', recipients = '') {
  const b = new FormData(); b.append('files', new Blob([text]), name)
  if (recipients) b.append('recipients', recipients)
  return b
}

await start()

try {
  // 绕过页面也必须拒绝本人联系方式；混合收件人不能静默丢掉本人后发布。
  for (const recipients of ['13507786589','+8613507786589','sender@example.test','SENDER@EXAMPLE.TEST','recipient@example.test，13507786589',Array(50).fill('recipient@example.test').concat('sender@example.test').join(',')]) {
    const direct = await api('/api/shares', { user:'owner', method:'POST', body:form('self-send', 'self.txt', recipients) })
    check('普通上传拒绝本人收件人 '+recipients.slice(0,65),direct.status===400&&/自己|本人/.test(direct.data.message))
    const session = await api('/api/upload-sessions', { user:'owner', method:'POST', body:{recipients,files:[{name:'self.txt',size:4}]} })
    check('分片会话拒绝本人收件人 '+recipients.slice(0,65),session.status===400&&/自己|本人|收件人/.test(session.data.message))
  }
  const directed = await api('/api/shares', { user:'owner', method:'POST', body:form('safe-recipient','recipient.txt','recipient@example.test,13800001111') })
  check('他人联系方式仍可发送',directed.status===201)
  check('他人仍可访问定向资源',(await api('/api/shares/token/'+directed.data.share?.id,{user:'recipient'})).status===200)
  const pending = await api('/api/upload-sessions',{user:'owner',method:'POST',body:{recipients:'new-sender@example.test',files:[{name:'pending.txt',size:4}]}})
  check('变更绑定前可创建会话',pending.status===201)
  const bytes = new FormData();bytes.append('chunk',new Blob(['safe']),'pending.txt');bytes.append('fileIndex','0');bytes.append('chunkIndex','0');bytes.append('totalChunks','1')
  check('待发布会话分片可上传',(await api('/api/upload-sessions/'+pending.data.sessionId+'/chunks',{user:'owner',method:'POST',body:bytes})).status===200)
  await api('/__share_fixture',{method:'POST',body:{email:'new-sender@example.test'}})
  check('服务端按最新资料阻止本人，不采信旧会话快照',(await api('/api/shares',{user:'owner',method:'POST',body:form('safe','stale.txt','new-sender@example.test')})).status===400)
  check('会话完成时重新排除本人',(await api('/api/upload-sessions/'+pending.data.sessionId+'/complete',{user:'owner',method:'POST',body:{}})).status===400)
  await api('/api/upload-sessions/'+pending.data.sessionId,{user:'owner',method:'DELETE'})
  await api('/__share_fixture',{method:'POST',body:{email:'sender@example.test'}})
  // ============ SHARE-001 取件码查询 ============
  console.log('\n=== SHARE-001 取件码查询 + 元数据 ===')
  const share = await api('/api/shares', { user: 'owner', method: 'POST', body: form('hello share', 'TC-03-01-安全文本-可预览.txt') })
  check('创建分享 201', share.status === 201)
  const s = share.data.share
  const lookup = await api(`/api/shares/lookup/${s.code}`, { method: 'POST', body: { password: '' } })
  check('取件码查询 200', lookup.status === 200, `status=${lookup.status}`)
  check('返回文件列表', Array.isArray(lookup.data.share?.files) && lookup.data.share.files.length === 1)
  check('返回二维码', Boolean(lookup.data.share?.qrDataUrl), 'qrDataUrl 缺失')
  check('返回下载入口', Boolean(lookup.data.share?.downloadUrl))
  const lookup2 = await api(`/api/shares/lookup/${s.code}`, { method: 'POST', body: { password: '' } })
  check('重复查询结果一致（刷新可重复）', lookup2.status === 200 && lookup2.data.share?.id === s.id)

  // ============ SHARE-002 不存在/格式错误取件码 ============
  console.log('\n=== SHARE-002 错误取件码 ===')
  const notFound = await api('/api/shares/lookup/ZZZZZZ', { method: 'POST', body: { password: '' } })
  check('不存在取件码 404', notFound.status === 404, `status=${notFound.status}`)
  check('404 有明确中文错误', /不存在|失效|错误/.test(notFound.data.message || ''), JSON.stringify(notFound.data))
  check('不泄漏收件人/管理token', !JSON.stringify(notFound.data).includes('deliveryRecipients') && !JSON.stringify(notFound.data).includes('manageToken'))

  // ============ SHARE-012 下载次数=1 + 过期 ============
  console.log('\n=== SHARE-012 下载次数=1 ===')
  const limited = await api('/api/shares', { user: 'owner', method: 'POST', body: (() => { const b = form('limited'); b.append('downloadLimit', '1'); return b })() })
  const ls = limited.data.share
  const dl1 = await fetch(base + `/api/shares/${ls.id}/download`)
  check('第一次下载 200', dl1.status === 200)
  const dl2 = await api(`/api/shares/${ls.id}/download`)
  check('第二次下载 410（次数耗尽）', dl2.status === 410, `status=${dl2.status}`)
  check('410 文案为次数用完', /次数|用完|耗尽/.test(dl2.data.message || ''), JSON.stringify(dl2.data))

  console.log('\n=== SHARE-012 过期 ===')
  // 过期用 member 账号创建分享（free 用户不能改有效期，会员特权见 applyShareUpdate）
  const shortExpiry = await api('/api/shares', { user: 'member', method: 'POST', body: (() => { const b = form('expires-soon'); b.append('expiryDays', '1'); return b })() })
  const es = shortExpiry.data.share
  const patchExpiry = await api(`/api/shares/manage/${es.manageToken}`, { user: 'member', method: 'PATCH', body: { expiresAt: new Date(Date.now() - 1000).toISOString() } })
  check('会员改过期时间成功', patchExpiry.status === 200, `status=${patchExpiry.status}`)
  const expiredDl = await api(`/api/shares/${es.id}/download`)
  check('过期后访问 410', expiredDl.status === 410, `status=${expiredDl.status}`)
  check('410 文案为已过期', /过期|失效|关闭/.test(expiredDl.data.message || ''), JSON.stringify(expiredDl.data))

  // 反向验证：free 用户不能改有效期（正确拒绝）
  const freeShare = await api('/api/shares', { user: 'owner', method: 'POST', body: form('free-no-expiry-change') })
  const personalManageUnauthenticated = await api(`/api/shares/manage/${freeShare.data.share.manageToken}`)
  check('账号分享管理链接无会话时拒绝', personalManageUnauthenticated.status === 401, `status=${personalManageUnauthenticated.status}`)
  const personalManageStranger = await api(`/api/shares/manage/${freeShare.data.share.manageToken}`, { user: 'member' })
  check('账号分享管理链接拒绝其他账号', personalManageStranger.status === 403, `status=${personalManageStranger.status}`)
  const freePatch = await api(`/api/shares/manage/${freeShare.data.share.manageToken}`, { user: 'owner', method: 'PATCH', body: { expiresAt: new Date(Date.now() + 86400000).toISOString() } })
  check('free 用户改有效期被 403 拒绝', freePatch.status === 403, `status=${freePatch.status}`)
  check('403 文案说明会员特权', /会员|权益/.test(freePatch.data.message || ''), JSON.stringify(freePatch.data))

  // ============ SHARE-007 预览类型 ============
  console.log('\n=== SHARE-007 预览类型 ===')
  const png = fs.readFileSync(path.join(root, '测试数据', '鲲穹文件传输测试数据包', '01-安全文件集', 'TC-03-04-图片预览-1x1.png'))
  const imgShare = await api('/api/shares', { user: 'owner', method: 'POST', body: (() => { const b = new FormData(); b.append('files', new Blob([png]), 'TC-03-04-图片预览-1x1.png'); return b })() })
  const imgPv = await fetch(base + `/api/shares/${imgShare.data.share.id}/files/0/preview`)
  check('图片预览 200', imgPv.status === 200)
  check('图片 X-Preview-Type=image', imgPv.headers.get('x-preview-type') === 'image', imgPv.headers.get('x-preview-type'))

  const noExt = await api('/api/shares', { user: 'owner', method: 'POST', body: (() => { const b = new FormData(); b.append('files', new Blob(['no ext']), 'TC-03-06-无扩展名文件'); return b })() })
  const noExtPv = await fetch(base + `/api/shares/${noExt.data.share.id}/files/0/preview`)
  check('无扩展名预览 415（不支持）', noExtPv.status === 415, `status=${noExtPv.status}`)
  const noExtDl = await fetch(base + `/api/shares/${noExt.data.share.id}/files/0/download`)
  check('无扩展名提供安全下载 200', noExtDl.status === 200)

  // ============ SHARE-013 管理更新（关闭/重开） ============
  console.log('\n=== SHARE-013 关闭与重开 ===')
  const mgr = await api('/api/shares', { user: 'owner', method: 'POST', body: form('manage me') })
  const ms = mgr.data.share
  const closeRes = await api(`/api/shares/manage/${ms.manageToken}`, { user: 'owner', method: 'PATCH', body: { status: 'closed' } })
  check('关闭分享 200', closeRes.status === 200, `status=${closeRes.status}`)
  const accessAfterClose = await api(`/api/shares/${ms.id}/download`)
  check('关闭后访问 410', accessAfterClose.status === 410, `status=${accessAfterClose.status}`)
  // free 用户不能重开（正确拒绝）
  const freeReopen = await api(`/api/shares/manage/${ms.manageToken}`, { user: 'owner', method: 'PATCH', body: { status: 'active' } })
  check('free 用户重开被 403 拒绝', freeReopen.status === 403, `status=${freeReopen.status}`)
  check('403 文案说明会员特权', /会员|权益/.test(freeReopen.data.message || ''), JSON.stringify(freeReopen.data))

  // member 用户可重开（会员特权）
  const mgr2 = await api('/api/shares', { user: 'member', method: 'POST', body: form('member manage me') })
  const ms2 = mgr2.data.share
  await api(`/api/shares/manage/${ms2.manageToken}`, { user: 'member', method: 'PATCH', body: { status: 'closed' } })
  const memberReopen = await api(`/api/shares/manage/${ms2.manageToken}`, { user: 'member', method: 'PATCH', body: { status: 'active' } })
  check('member 用户重开 200', memberReopen.status === 200, `status=${memberReopen.status}`)

  console.log(`\n========== SHARE 补测：${passed} 通过 / ${failures.length} 失败 ==========`)
  if (failures.length) { failures.forEach((f) => console.log('  - ' + f)); process.exitCode=1 }
  else console.log('全部通过')
} finally {
  await stop()
  await new Promise(resolve => scanner.close(resolve))
}
