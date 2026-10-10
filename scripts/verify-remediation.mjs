import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-remediation-'))
const future = new Date(Date.now() + 20 * 86400000).toISOString()
const users = Object.fromEntries(['owner', 'recipient', 'stranger', 'member', 'logout', 'expired', 'canceled', 'auth', 'retention'].map((id) => [id, { id, username: id, nickname: id, status: 'active', planId: 'free' }]))
users.member.planId = 'member'
users.member.planExpiresAt = future
const sessions = Object.values(users).map((user) => ({ id: user.id + '-session', user, apiWebToken: 'fixture-token-' + user.id, expiresAt: future }))
fs.copyFileSync(path.join(root, 'server.mjs'), path.join(fixture, 'server.mjs'))
// 不用 fs.cpSync 复制目录：部分受限执行环境会直接终止使用了递归复制的进程
// （表现为无输出 + exit 127，很难定位）。同 verify-metadata-cas.mjs / verify-upload-chunks.mjs。
function copyDirectory(source, target) {
  fs.mkdirSync(target, { recursive: true })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name)
    const to = path.join(target, entry.name)
    if (entry.isDirectory()) copyDirectory(from, to)
    else if (entry.isFile()) fs.copyFileSync(from, to)
  }
}
copyDirectory(path.join(root, 'server'), path.join(fixture, 'server'))
fs.copyFileSync(path.join(root, 'package.json'), path.join(fixture, 'package.json'))
fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
const templateSource = path.join(root, 'email-templates')
const templateFixture = path.join(fixture, 'email-templates')
fs.mkdirSync(templateFixture)
for (const name of fs.readdirSync(templateSource)) {
  fs.copyFileSync(path.join(templateSource, name), path.join(templateFixture, name))
}
fs.mkdirSync(path.join(fixture, 'storage'))
fs.writeFileSync(path.join(fixture, 'storage', 'metadata.json'), JSON.stringify({ users, sessions, shares: [], collections: [], messages: {}, systemConfig: { anonymousTotalSizeMb: 1 }, upgradeOrders: [] }))
let scanError = false
let scanDelay = 0
let scanCount = 0
const scanner = net.createServer((socket) => {
  let input = Buffer.alloc(0), command = false, chunks = [], ended = false
  socket.on('error', () => {})
  socket.on('data', (data) => {
    input = Buffer.concat([input, data])
    if (!command) {
      const end = input.indexOf(0)
      if (end < 0) return
      assert.equal(input.subarray(0, end).toString(), 'zINSTREAM')
      input = input.subarray(end + 1); command = true
    }
    while (input.length >= 4 && !ended) {
      const length = input.readUInt32BE(0)
      if (input.length < 4 + length) break
      const bytes = input.subarray(4, 4 + length)
      input = input.subarray(4 + length)
      if (!length) {
        ended = true; scanCount++
        const threat = Buffer.concat(chunks).includes(Buffer.from('TEST_THREAT_MARKER'))
        const response = scanError ? 'stream: test failure ERROR\0' : threat ? 'stream: Test.Signature FOUND\0' : 'stream: OK\0'
        setTimeout(() => socket.end(response), scanDelay)
      } else chunks.push(bytes)
    }
  })
})
await new Promise((resolve) => scanner.listen(0, '127.0.0.1', resolve))
const remoteOrders = new Map()
const invalidTokens = new Set()
let loginUserId = 'auth'
let heldPaymentQuery = null
let holdPaymentOrderNo = ''
let remoteSeq = 0
const payments = http.createServer(async (req, res) => {
  let body = ''; for await (const part of req) body += part
  const params = new URLSearchParams(body)
  let data = {}
  if (req.url === '/oauth/token') {
    res.setHeader('content-type', 'application/json')
    const token = 'fixture-fresh-' + loginUserId
    res.end(JSON.stringify({ code: 200, data: { access_token: token, api_web_token: token, expires_in: 3600, user: users[loginUserId] } }))
    return
  }
  if (params.get('order_no') === holdPaymentOrderNo) {
    await new Promise((resolve) => { heldPaymentQuery = resolve })
    holdPaymentOrderNo = ''
  }
  if (invalidTokens.has(req.headers.token)) {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ code: 401, msg: 'fixture token expired' }))
    return
  }
  if (req.url.endsWith('/get_web_member_package_info')) data = { packages: [{ id: 1, name: '会员版', price_yuan: 19, days: 30 }, { id: 2, name: '团队版', price_yuan: 49, days: 90 }, { id: 5, name: '企业版', price_yuan: 159, days: 0 }] }
  else if (req.url.endsWith('/create_web_member_order')) {
    const order_no = 'remote-' + (++remoteSeq)
    remoteOrders.set(order_no, { paid: false, token: req.headers.token })
    data = { order_no, package_id: Number(params.get('package_id')), pay_type: 1, pay_amount: 19, package_days: 30, code_url: 'weixin://fixture' }
  } else if (req.url.endsWith('/check_web_member_order_paystatus')) {
    const order = remoteOrders.get(params.get('order_no'))
    assert.ok(order && (order.token === req.headers.token || req.headers.token === order.token.replace('fixture-token-', 'fixture-fresh-')), 'Payment queries use the order owner token')
    data = { order_no: params.get('order_no'), pay_status: order.paid ? 1 : 0 }
  }
  res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ code: 1, data }))
})
await new Promise((resolve) => payments.listen(0, '127.0.0.1', resolve))
let child, base, errors = '', passed = 0
const cleanEnv = { ...process.env }
for (const key of Object.keys(cleanEnv)) if (key.startsWith('KUNQIONG_') || key.startsWith('OAUTH_')) delete cleanEnv[key]
async function start(extra = {}) {
  const probe = net.createServer(); await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port; await new Promise((resolve) => probe.close(resolve))
  base = `http://127.0.0.1:${port}`
  child = spawn(process.execPath, ['server.mjs'], { cwd: fixture, windowsHide: true, env: { ...cleanEnv, PORT: String(port), NODE_ENV: 'production', KUNQIONG_HOST: '127.0.0.1', KUNQIONG_SCAN_MODE: 'required', KUNQIONG_CLAMAV_HOST: '127.0.0.1', KUNQIONG_CLAMAV_PORT: String(scanner.address().port), KUNQIONG_WEB_MEMBER_API_BASE: `http://127.0.0.1:${payments.address().port}`, KUNQIONG_OAUTH_AUTHORIZE_URL: `http://127.0.0.1:${payments.address().port}/authorize`, KUNQIONG_OAUTH_TOKEN_URL: `http://127.0.0.1:${payments.address().port}/oauth/token`, KUNQIONG_AUTH_CALLBACK_URL: base + '/auth/callback', KUNQIONG_OAUTH_CLIENT_ID: 'fixture', KUNQIONG_OAUTH_CLIENT_SECRET: 'fixture-only', ...extra }, stdio: ['ignore', 'ignore', 'pipe'] })
  child.stderr.on('data', (data) => { errors += data })
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/api/health')).ok) return } catch {}
    await delay(50)
  }
  throw new Error('Fixture startup failed: ' + errors)
}
async function stop() {
  if (!child || child.exitCode !== null) return
  const exited = once(child, 'exit')
  child.kill()
  await Promise.race([exited, delay(3000)])
  if (child.exitCode === null) child.kill('SIGKILL')
}
async function api(url, { user = '', method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(base + url, { method, headers: { ...(user ? { cookie: `kunqiong_session=${user}-session` } : {}), ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...headers }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined })
  const data = method === 'HEAD' ? {} : await response.json().catch(() => ({}))
  return { response, data, status: response.status }
}
function check(name, condition) { assert.ok(condition, name); passed++; console.log('PASS ' + name) }
const metadataFile = path.join(fixture, 'storage', 'metadata.json')
const stored = () => JSON.parse(fs.readFileSync(metadataFile, 'utf8'))
async function waitFor(condition) {
  for (let i = 0; i < 80; i++) { if (condition()) return true; await delay(50) }
  return false
}
function form(bytes = 'safe', name = 'fixture.txt', recipients = '') {
  const body = new FormData(); body.append('files', new Blob([bytes]), name)
  if (recipients) body.append('recipients', recipients)
  return body
}
try {
  await start()
  check('Missing admin configuration disables login', (await api('/api/admin/login', { method: 'POST', body: { username: 'any', password: 'any' } })).status === 503)
  const directed = await api('/api/shares', { user: 'owner', method: 'POST', body: form('safe', 'directed.txt', 'recipient') })
  check('Directed creation and actual scanner protocol', directed.status === 201 && directed.data.share.files[0].scanEngine === 'clamav' && scanCount > 0)
  const share = directed.data.share
  for (const url of [`/api/shares/token/${share.id}`, `/api/shares/lookup/${share.code}`, `/api/shares/${share.id}/download`, `/api/shares/${share.id}/files/0/download`, `/api/shares/${share.id}/files/0/preview`]) {
    check('Anonymous directed access blocked: ' + url, (await api(url)).status === 401)
    check('Stranger directed access blocked: ' + url, (await api(url, { user: 'stranger' })).status === 403)
  }
  check('Password lookup cannot bypass recipient identity', (await api(`/api/shares/lookup/${share.code}`, { method: 'POST', body: { password: '' } })).status === 401)
  const recipient = await api(`/api/shares/token/${share.id}`, { user: 'recipient' })
  check('Authorized recipient metadata remains private', recipient.status === 200 && !('deliveryRecipients' in recipient.data.share) && !('notificationLog' in recipient.data.share))
  check('Owner retains delivery details', (await api(`/api/shares/token/${share.id}`, { user: 'owner' })).data.share.deliveryRecipients.includes('recipient'))
  const download = await fetch(base + `/api/shares/${share.id}/files/0/download`, { headers: { cookie: 'kunqiong_session=recipient-session' } })
  check('Recipient receives original bytes', download.status === 200 && await download.text() === 'safe')
  check('Threat blocks direct publish', (await api('/api/shares', { user: 'owner', method: 'POST', body: form('TEST_THREAT_MARKER') })).status === 415)
  scanError = true
  check('Scanner error fails closed', (await api('/api/shares', { user: 'owner', method: 'POST', body: form() })).status === 503)
  scanError = false
  const collection = (await api('/api/collections', { method: 'POST', body: { title: 'Fixture collection', maxFileSizeMb: 500 } })).data.collection
  check('Anonymous collection has aggregate ceiling', collection.capacityBytes === 1024 * 1024)
  const oversized = form(new Uint8Array(2 * 1024 * 1024)); oversized.append('participantName', 'fixture')
  check('Logged-in submitter cannot bypass anonymous task capacity', (await api(`/api/collections/${collection.token}/submissions`, { user: 'owner', method: 'POST', body: oversized })).status === 507)
  const sessionBody = { mode: 'collection', collectionToken: collection.token, participantName: 'fixture', files: [{ name: 'chunk.bin', size: 700 * 1024 }] }
  const upload = await api('/api/upload-sessions', { user: 'owner', method: 'POST', body: sessionBody })
  check('Chunk capacity reserved', upload.status === 201)
  check('Concurrent chunk sessions cannot exceed task quota', (await api('/api/upload-sessions', { user: 'recipient', method: 'POST', body: sessionBody })).status === 507)
  check('Negative file size rejected', (await api('/api/upload-sessions', { user: 'owner', method: 'POST', body: { files: [{ name: 'bad', size: -1 }] } })).status === 400)
  const chunk = new FormData(); chunk.append('chunk', new Blob([new Uint8Array(700 * 1024)])); chunk.append('fileIndex', '0'); chunk.append('chunkIndex', '0'); chunk.append('totalChunks', '1')
  check('Other account cannot inspect upload session', (await api(`/api/upload-sessions/${upload.data.sessionId}`, { user: 'stranger' })).status === 403)
  check('Other account cannot write upload chunks', (await api(`/api/upload-sessions/${upload.data.sessionId}/chunks`, { user: 'stranger', method: 'POST', body: chunk })).status === 403)
  check('Chunk upload remains functional', (await api(`/api/upload-sessions/${upload.data.sessionId}/chunks`, { user: 'owner', method: 'POST', body: chunk })).status === 200)
  check('Other account cannot complete upload session', (await api(`/api/upload-sessions/${upload.data.sessionId}/complete`, { user: 'stranger', method: 'POST', body: {} })).status === 403)
  const completed = await api(`/api/upload-sessions/${upload.data.sessionId}/complete`, { user: 'owner', method: 'POST', body: {} })
  check('Chunk completion scans actual assembled bytes', completed.status === 201 && completed.data.submission.files[0].scanEngine === 'clamav')
  const anonymousUpload = await api('/api/upload-sessions', { method: 'POST', body: { files: [{ name: 'anonymous.txt', size: 4 }] } })
  const anonymousChunk = new FormData(); anonymousChunk.append('chunk', new Blob(['safe'])); anonymousChunk.append('fileIndex', '0'); anonymousChunk.append('chunkIndex', '0'); anonymousChunk.append('totalChunks', '1')
  const anonymousStatus = await api(`/api/upload-sessions/${anonymousUpload.data.sessionId}`)
  const anonymousChunkResult = await api(`/api/upload-sessions/${anonymousUpload.data.sessionId}/chunks`, { method: 'POST', body: anonymousChunk })
  const anonymousComplete = await api(`/api/upload-sessions/${anonymousUpload.data.sessionId}/complete`, { method: 'POST', body: {} })
  check('Anonymous bearer-session upload and resume remain functional', anonymousUpload.status === 201 && anonymousStatus.status === 200 && anonymousChunkResult.status === 200 && anonymousComplete.status === 201)
  const protectedForm = form('password-file'); protectedForm.append('password', 'fixture-password')
  const protectedShare = (await api('/api/shares', { user: 'owner', method: 'POST', body: protectedForm })).data.share
  const before = (await api(`/api/shares/token/${protectedShare.id}`)).data.share.downloadCount
  const head = await api(`/api/shares/${protectedShare.id}/download`, { method: 'HEAD', headers: { 'x-share-password': 'fixture-password' } })
  const cookies = head.response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ')
  check('HEAD grants password access without downloading/counting', head.status === 200 && !!cookies && (await api(`/api/shares/token/${protectedShare.id}`)).data.share.downloadCount === before)
  const native = await fetch(base + `/api/shares/${protectedShare.id}/download`, { headers: { cookie: cookies, range: 'bytes=0-3' } })
  check('Native password download preserves byte ranges', native.status === 206 && await native.text() === 'pass')
  // 关键回归：拿到 access cookie 后，再主动带「错误密码」访问，必须仍被拒绝。
  // 此前 access cookie 分支无条件放行，导致输错密码也能凭 cookie 拿到文件（安全漏洞）。
  const wrongPwWithCookie = await api(`/api/shares/${protectedShare.id}/download`, { headers: { cookie: cookies, 'x-share-password': 'wrong-password' } })
  check('错误密码即使有 access cookie 仍被拒绝', wrongPwWithCookie.status === 401 || wrongPwWithCookie.status === 403, `status=${wrongPwWithCookie.status}`)
  const correctPwWithCookie = await api(`/api/shares/${protectedShare.id}/download`, { headers: { cookie: cookies, 'x-share-password': 'fixture-password' } })
  check('正确密码 + cookie 仍通过', correctPwWithCookie.status === 200, `status=${correctPwWithCookie.status}`)
  // 关键回归：所有者本人（已登录）访问自己的密码分享，公开提取链接必须与访客同权。
  // 此前 skipPassword 对所有分享生效，owner 输任何密码（甚至不输）都直接放行，
  // 导致所有者自己测试密码防护时「随便输都能过」，密码形同虚设。
  const ownerNoPw = await api(`/api/shares/${protectedShare.id}/download`, { user: 'owner' })
  check('所有者不带密码访问自己的密码分享被要求输密码', ownerNoPw.status === 403, `status=${ownerNoPw.status}`)
  const ownerWrongPw = await api(`/api/shares/${protectedShare.id}/download`, { user: 'owner', headers: { 'x-share-password': 'wrong-password' } })
  check('所有者错误密码仍被拒绝', ownerWrongPw.status === 401, `status=${ownerWrongPw.status}`)
  const ownerCorrectPw = await api(`/api/shares/${protectedShare.id}/download`, { user: 'owner', headers: { 'x-share-password': 'fixture-password' } })
  check('所有者正确密码通过', ownerCorrectPw.status === 200, `status=${ownerCorrectPw.status}`)

  const previewForm = form('name,role\nfixture,owner\n', 'records.csv', 'recipient')
  previewForm.append('password', 'preview-only')
  const previewShare = (await api('/api/shares', { user: 'owner', method: 'POST', body: previewForm })).data.share
  const managedFileUrl = `/api/shares/manage/${previewShare.manageToken}/files/0`
  const csvPreview = await fetch(base + managedFileUrl + '/preview', { headers: { cookie: 'kunqiong_session=owner-session' } })
  check('Owner record previews password-protected CSV', csvPreview.status === 200 && await csvPreview.text() === 'name,role\nfixture,owner\n')
  check('Preview does not consume download count', (await api(`/api/shares/manage/${previewShare.manageToken}`)).data.share.downloadCount === 0)
  for (const action of ['preview', 'download']) {
    check(`Managed ${action} rejects anonymous account access`, (await api(managedFileUrl + '/' + action)).status === 401)
    check(`Managed ${action} rejects another account`, (await api(managedFileUrl + '/' + action, { user: 'recipient' })).status === 403)
  }
  check('Public preview still requires password', (await api(`/api/shares/${previewShare.id}/files/0/preview`, { user: 'owner' })).status === 403)
  check('Managed preview rejects untrusted Origin', (await api(managedFileUrl + '/preview', { user: 'owner', headers: { origin: 'https://foreign.example' } })).status === 403)
  const ownerDownload = await fetch(base + managedFileUrl + '/download', { headers: { cookie: 'kunqiong_session=owner-session' } })
  check('Owner preview download receives original bytes', ownerDownload.status === 200 && await ownerDownload.text() === 'name,role\nfixture,owner\n')
  check('Owner file access does not consume public quota', (await api(`/api/shares/manage/${previewShare.manageToken}`)).data.share.downloadCount === 0)
  check('Managed preview rejects missing file index', (await api(`/api/shares/manage/${previewShare.manageToken}/files/9/preview`, { user: 'owner' })).status === 404)
  const pdfBytes = '%PDF-1.4\nfixture preview bytes\n%%EOF'
  const pdfShare = (await api('/api/shares', { user: 'owner', method: 'POST', body: form(pdfBytes, 'records.pdf') })).data.share
  const pdfUrl = `/api/shares/${pdfShare.id}/files/0/preview`
  const pdfHead = await api(pdfUrl, { method: 'HEAD', user: 'owner' })
  check('PDF allows same-origin embedding after validation', pdfHead.status === 200 && pdfHead.response.headers.get('x-frame-options') === 'SAMEORIGIN')
  check('PDF HEAD has file metadata without body', pdfHead.response.headers.get('content-type').includes('application/pdf') && Number(pdfHead.response.headers.get('content-length')) === Buffer.byteLength(pdfBytes) && await pdfHead.response.text() === '')
  const pdfRange = await fetch(base + pdfUrl, { headers: { range: 'bytes=0-7' } })
  check('PDF range preview remains functional', pdfRange.status === 206 && await pdfRange.text() === pdfBytes.slice(0, 8))
  await api(`/api/shares/manage/${pdfShare.manageToken}`, { method: 'DELETE', user: 'owner' })
  const closedPublic = await api(pdfUrl, { method: 'HEAD', user: 'owner' })
  check('Closed public preview stays blocked with readable error', closedPublic.status === 410 && decodeURIComponent(closedPublic.response.headers.get('x-error-message')) === '分享已关闭' && closedPublic.response.headers.get('x-frame-options') === 'DENY')
  const closedOwner = await fetch(base + `/api/shares/manage/${pdfShare.manageToken}/files/0/preview`, { headers: { cookie: 'kunqiong_session=owner-session' } })
  check('Owner can preview own file after closing public link', closedOwner.status === 200 && await closedOwner.text() === pdfBytes)
  fs.unlinkSync(path.join(fixture, 'storage', 'files', pdfShare.id, stored().shares.find(item => item.id === pdfShare.id).files[0].storedName))
  check('Cleaned owner file returns explicit Gone', (await api(`/api/shares/manage/${pdfShare.manageToken}/files/0/preview`, { user: 'owner' })).status === 410)
  const source = fs.readFileSync(path.join(root, 'src', 'lib', 'api.js'), 'utf8').split('async function downloadBinaryWithProgress')[1].split('async function downloadResponseError')[0]
  check('Client download never buffers file bodies', source.includes("method: 'HEAD'") && !source.includes('new Blob') && !source.includes('getReader') && !source.includes('.blob('))
  const retrievalUi = fs.readFileSync(path.join(root, 'src', 'pages', 'workspace.jsx'), 'utf8')
  check('取件码查找错误可触发收件账号登录并保留取件码', retrievalUi.includes('try { await onFind() } catch (err)') && retrievalUi.includes("setRequiresLogin(err.code === 'directed_login_required')") && retrievalUi.includes("searchParams.set('retrieve', code.trim().toUpperCase())"))
  const scannerConfig = fs.readFileSync(path.join(root, 'deployment', 'clamd.conf'), 'utf8')
  check('ClamAV scan limit covers maximum supported file size', /MaxFileSize\s+5G/.test(scannerConfig) && /MaxScanSize\s+5G/.test(scannerConfig))
  const renew = await api('/api/account/upgrade-orders', { user: 'member', method: 'POST', body: { planId: 'member' } })
  check('Active same-plan renewal creates order', renew.status === 201)
  const [pay1, pay2] = await Promise.all([1, 2].map(() => api(`/api/account/upgrade-orders/${renew.data.order.id}/confirm`, { user: 'member', method: 'POST', body: {} })))
  check('Concurrent checkout creates one provider order', pay1.status === 200 && pay2.status === 200 && remoteSeq === 1)
  remoteOrders.get(pay1.data.order.remoteOrderNo).paid = true
  await stop(); await start()
  await delay(1500)
  let workspace = (await api('/api/account/workspace', { user: 'member' })).data
  const expiry = new Date(workspace.planExpiresAt).getTime()
  check('Startup compensates payment after dialog closure', workspace.orders.some((order) => order.id === renew.data.order.id && order.status === 'paid'))
  check('Renewal preserves remaining time plus package duration', expiry >= new Date(future).getTime() + 30 * 86400000 - 1000)
  await Promise.all([1, 2].map(() => api(`/api/account/upgrade-orders/${renew.data.order.id}/pay-status`, { user: 'member', method: 'POST', body: {} })))
  workspace = (await api('/api/account/workspace', { user: 'member' })).data
  check('Repeated payment checks do not extend twice', new Date(workspace.planExpiresAt).getTime() === expiry)
  const pending = {}
  for (const user of ['logout', 'expired', 'canceled', 'auth', 'retention']) {
    const created = await api('/api/account/upgrade-orders', { user, method: 'POST', body: { planId: 'member' } })
    assert.equal(created.status, 201)
    const checkout = await api(`/api/account/upgrade-orders/${created.data.order.id}/confirm`, { user, method: 'POST', body: {} })
    assert.equal(checkout.status, 200)
    pending[user] = checkout.data.order
    check('Checkout never exposes payment credentials: ' + user, !JSON.stringify(checkout.data).includes('fixture-token'))
  }
  await api(`/api/account/upgrade-orders/${pending.canceled.id}/cancel`, { user: 'canceled', method: 'POST' })
  for (const user of ['logout', 'canceled', 'retention']) await api('/api/auth/logout', { user, method: 'POST' })
  check('Logout immediately revokes account access', (await api('/api/account/workspace', { user: 'logout' })).status === 401)
  await stop()
  const beforeRestart = stored()
  beforeRestart.sessions.find((item) => item.user.id === 'expired').expiresAt = new Date(Date.now() - 1000).toISOString()
  const oldOrder = beforeRestart.upgradeOrders.find((item) => item.id === pending.retention.id)
  oldOrder.createdAt = new Date(Date.now() - 2 * 86400000).toISOString()
  if (oldOrder.paymentQueryCredential) oldOrder.paymentQueryCredential.expiresAt = new Date(Date.now() - 1000).toISOString()
  fs.writeFileSync(metadataFile, JSON.stringify(beforeRestart))
  for (const user of Object.keys(pending)) remoteOrders.get(pending[user].remoteOrderNo).paid = true
  invalidTokens.add('fixture-token-auth')
  await start()
  check('Logout and expired sessions compensate after restart without account access', await waitFor(() => ['logout', 'expired', 'canceled'].every((user) => stored().upgradeOrders.find((item) => item.id === pending[user].id)?.status === 'paid')))
  check('Expired session cookie stays revoked', (await api('/api/account/workspace', { user: 'expired' })).status === 401)
  check('Successful compensation removes retained credentials', ['logout', 'expired', 'canceled'].every((user) => !stored().upgradeOrders.find((item) => item.id === pending[user].id)?.paymentQueryCredential))
  check('Compensation activates the logged-out account', stored().users.logout.planId === 'member' && stored().users.expired.planId === 'member')
  check('Retention timeout stops automatic payment queries and deletes credentials', !stored().upgradeOrders.find((item) => item.id === pending.retention.id)?.paymentQueryCredential && stored().upgradeOrders.find((item) => item.id === pending.retention.id)?.status !== 'paid')
  const authWorkspace = (await api('/api/account/workspace', { user: 'auth' })).data
  check('Expired upstream credential requests re-login without leaking a token', authWorkspace.paymentReconciliation?.requiresLogin === true && !JSON.stringify(authWorkspace).includes('fixture-token'))
  check('Rejected upstream credential is deleted', !stored().upgradeOrders.find((item) => item.id === pending.auth.id)?.paymentQueryCredential)
  const login = await fetch(base + '/api/auth/login?return_to=' + encodeURIComponent(base + '/workspace'), { redirect: 'manual' })
  const state = new URL(login.headers.get('location')).searchParams.get('state')
  const callback = await fetch(base + '/auth/callback?code=fixture&state=' + state, { redirect: 'manual', headers: { cookie: login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ') } })
  check('Fresh login compensates orders rejected by expired upstream credentials', callback.status === 302 && await waitFor(() => stored().upgradeOrders.find((item) => item.id === pending.auth.id)?.status === 'paid'))
  const loginCookie = callback.headers.getSetCookie().map((item) => item.split(';')[0]).join('; ')
  const freshWorkspace = (await api('/api/account/workspace', { headers: { cookie: loginCookie } })).data
  check('Fresh login clears payment warning and preserves credential privacy', freshWorkspace.plan.id === 'member' && !freshWorkspace.paymentReconciliation?.requiresLogin && !JSON.stringify(freshWorkspace).includes('fixture-fresh'))
  const staleCreated = await api('/api/account/upgrade-orders', { headers: { cookie: loginCookie }, method: 'POST', body: { planId: 'member' } })
  await api(`/api/account/upgrade-orders/${staleCreated.data.order.id}/confirm`, { headers: { cookie: loginCookie }, method: 'POST', body: {} })
  await stop()
  const staleOrderMetadata = stored()
  const staleOrder = staleOrderMetadata.upgradeOrders.find((item) => item.id === staleCreated.data.order.id)
  staleOrder.createdAt = new Date(Date.now() - 31 * 60 * 1000).toISOString()
  staleOrder.paymentQueryCredential = { apiWebToken: 'fixture-fresh-auth', expiresAt: new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString() }
  staleOrder.paymentRequiresLogin = false
  fs.writeFileSync(metadataFile, JSON.stringify(staleOrderMetadata))
  await start()
  assert.equal((await api('/api/account/upgrade-orders', { headers: { cookie: loginCookie }, method: 'POST', body: { planId: 'member' } })).status, 201)
  check('Expired local payment order removes its query credential immediately', !stored().upgradeOrders.find((item) => item.id === staleCreated.data.order.id)?.paymentQueryCredential)
  const concurrentOrder = (await api('/api/account/upgrade-orders', { user: 'recipient', method: 'POST', body: { planId: 'member' } })).data.order
  const concurrentCheckout = (await api(`/api/account/upgrade-orders/${concurrentOrder.id}/confirm`, { user: 'recipient', method: 'POST', body: {} })).data.order
  remoteOrders.get(concurrentCheckout.remoteOrderNo).paid = true
  heldPaymentQuery = null
  holdPaymentOrderNo = concurrentCheckout.remoteOrderNo
  const concurrentCheck = api(`/api/account/upgrade-orders/${concurrentOrder.id}/pay-status`, { user: 'recipient', method: 'POST' })
  assert.ok(await waitFor(() => heldPaymentQuery))
  assert.equal((await api('/api/account/upgrade-orders', { user: 'owner', method: 'POST', body: { planId: 'member' } })).status, 201)
  heldPaymentQuery()
  await concurrentCheck
  check('Another user creating an order cannot detach the order being activated', stored().upgradeOrders.find((item) => item.id === concurrentOrder.id)?.status === 'paid')
  const concurrentExpiry = stored().users.recipient.planExpiresAt
  await api(`/api/account/upgrade-orders/${concurrentOrder.id}/pay-status`, { user: 'recipient', method: 'POST' })
  check('Concurrent order creation cannot cause duplicate renewal', stored().users.recipient.planExpiresAt === concurrentExpiry)
  const raceOrder = (await api('/api/account/upgrade-orders', { user: 'stranger', method: 'POST', body: { planId: 'member' } })).data.order
  const raceCheckout = (await api(`/api/account/upgrade-orders/${raceOrder.id}/confirm`, { user: 'stranger', method: 'POST', body: {} })).data.order
  remoteOrders.get(raceCheckout.remoteOrderNo).paid = true
  invalidTokens.add('fixture-token-stranger')
  heldPaymentQuery = null
  holdPaymentOrderNo = raceCheckout.remoteOrderNo
  await stop(); await start()
  assert.ok(await waitFor(() => heldPaymentQuery), 'Old-token query reaches provider before new login')
  loginUserId = 'stranger'
  const raceLogin = await fetch(base + '/api/auth/login?return_to=' + encodeURIComponent(base + '/workspace'), { redirect: 'manual' })
  const raceState = new URL(raceLogin.headers.get('location')).searchParams.get('state')
  const raceCallback = await fetch(base + '/auth/callback?code=fixture&state=' + raceState, { redirect: 'manual', headers: { cookie: raceLogin.headers.getSetCookie().map(c => c.split(';')[0]).join('; ') } })
  heldPaymentQuery()
  check('Fresh login during old-token rejection still compensates without another login', raceCallback.status === 302 && await waitFor(() => stored().upgradeOrders.find((item) => item.id === raceOrder.id)?.status === 'paid'))
  await stop()
  const onlyExpiredCredential = stored()
  onlyExpiredCredential.sessions = []
  onlyExpiredCredential.shares = []
  onlyExpiredCredential.collections = []
  onlyExpiredCredential.upgradeOrders = [{ ...pending.retention, paymentQueryCredential: { apiWebToken: 'fixture-expired-secret', expiresAt: new Date(Date.now() - 1000).toISOString() } }]
  fs.writeFileSync(metadataFile, JSON.stringify(onlyExpiredCredential))
  await start()
  check('Startup persists expired credential removal without unrelated writes', await waitFor(() => !stored().upgradeOrders[0]?.paymentQueryCredential))
  await stop(); await start({ KUNQIONG_CLAMAV_HOST: '' })
  check('Absent scanner rejects publication in required mode', (await api('/api/shares', { user: 'owner', method: 'POST', body: form() })).status === 503)
  await stop(); await start({ KUNQIONG_ADMIN_USERNAME: 'fixture-admin', KUNQIONG_ADMIN_PASSWORD: 'fixture-only-password' })
  check('Explicit configured admin credentials work', (await api('/api/admin/login', { method: 'POST', body: { username: 'fixture-admin', password: 'fixture-only-password' } })).status === 200)
  console.log(`Remediation checks: ${passed}/${passed}; isolated fixture: ${fixture}`)
} finally {
  await stop(); scanner.closeAllConnections?.(); await new Promise((resolve) => scanner.close(resolve)); payments.closeAllConnections(); await new Promise((resolve) => payments.close(resolve))
}
