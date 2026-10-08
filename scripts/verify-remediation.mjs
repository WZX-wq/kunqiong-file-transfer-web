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
const users = Object.fromEntries(['owner', 'recipient', 'stranger', 'member'].map((id) => [id, { id, username: id, nickname: id, status: 'active', planId: 'free' }]))
users.member.planId = 'member'
users.member.planExpiresAt = future
const sessions = Object.values(users).map((user) => ({ id: user.id + '-session', user, apiWebToken: 'fixture-token', expiresAt: future }))
fs.copyFileSync(path.join(root, 'server.mjs'), path.join(fixture, 'server.mjs'))
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
let remoteSeq = 0
const payments = http.createServer(async (req, res) => {
  let body = ''; for await (const part of req) body += part
  const params = new URLSearchParams(body)
  let data = {}
  if (req.url.endsWith('/get_web_member_package_info')) data = { packages: [{ id: 1, name: '会员版', price_yuan: 19, days: 30 }, { id: 2, name: '团队版', price_yuan: 49, days: 90 }, { id: 5, name: '企业版', price_yuan: 159, days: 0 }] }
  else if (req.url.endsWith('/create_web_member_order')) {
    const order_no = 'remote-' + (++remoteSeq)
    remoteOrders.set(order_no, false)
    data = { order_no, package_id: Number(params.get('package_id')), pay_type: 1, pay_amount: 19, package_days: 30, code_url: 'weixin://fixture' }
  } else if (req.url.endsWith('/check_web_member_order_paystatus')) data = { pay_status: remoteOrders.get(params.get('order_no')) ? 1 : 0 }
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
  child = spawn(process.execPath, ['server.mjs'], { cwd: fixture, windowsHide: true, env: { ...cleanEnv, PORT: String(port), NODE_ENV: 'production', KUNQIONG_HOST: '127.0.0.1', KUNQIONG_SCAN_MODE: 'required', KUNQIONG_CLAMAV_HOST: '127.0.0.1', KUNQIONG_CLAMAV_PORT: String(scanner.address().port), KUNQIONG_WEB_MEMBER_API_BASE: `http://127.0.0.1:${payments.address().port}`, ...extra }, stdio: ['ignore', 'ignore', 'pipe'] })
  child.stderr.on('data', (data) => { errors += data })
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/api/health')).ok) return } catch {}
    await delay(50)
  }
  throw new Error('Fixture startup failed: ' + errors)
}
async function stop() { if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited } }
async function api(url, { user = '', method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(base + url, { method, headers: { ...(user ? { cookie: `kunqiong_session=${user}-session` } : {}), ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...headers }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined })
  const data = method === 'HEAD' ? {} : await response.json().catch(() => ({}))
  return { response, data, status: response.status }
}
function check(name, condition) { assert.ok(condition, name); passed++; console.log('PASS ' + name) }
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
  const source = fs.readFileSync(path.join(root, 'src', 'main.jsx'), 'utf8').split('async function downloadBinaryWithProgress')[1].split('async function downloadResponseError')[0]
  check('Client download never buffers file bodies', source.includes("method: 'HEAD'") && !source.includes('new Blob') && !source.includes('getReader') && !source.includes('.blob('))
  const retrievalUi = fs.readFileSync(path.join(root, 'src', 'main.jsx'), 'utf8')
  check('取件码查找错误可触发收件账号登录并保留取件码', retrievalUi.includes('try { await onFind() } catch (err)') && retrievalUi.includes("setRequiresLogin(err.code === 'directed_login_required')") && retrievalUi.includes("searchParams.set('retrieve', code.trim().toUpperCase())"))
  const scannerConfig = fs.readFileSync(path.join(root, 'deployment', 'clamd.conf'), 'utf8')
  check('ClamAV scan limit covers maximum supported file size', /MaxFileSize\s+5G/.test(scannerConfig) && /MaxScanSize\s+5G/.test(scannerConfig))
  const renew = await api('/api/account/upgrade-orders', { user: 'member', method: 'POST', body: { planId: 'member' } })
  check('Active same-plan renewal creates order', renew.status === 201)
  const [pay1, pay2] = await Promise.all([1, 2].map(() => api(`/api/account/upgrade-orders/${renew.data.order.id}/confirm`, { user: 'member', method: 'POST', body: {} })))
  check('Concurrent checkout creates one provider order', pay1.status === 200 && pay2.status === 200 && remoteSeq === 1)
  remoteOrders.set(pay1.data.order.remoteOrderNo, true)
  await stop(); await start()
  await delay(1500)
  let workspace = (await api('/api/account/workspace', { user: 'member' })).data
  const expiry = new Date(workspace.planExpiresAt).getTime()
  check('Startup compensates payment after dialog closure', workspace.orders.some((order) => order.id === renew.data.order.id && order.status === 'paid'))
  check('Renewal preserves remaining time plus package duration', expiry >= new Date(future).getTime() + 30 * 86400000 - 1000)
  await Promise.all([1, 2].map(() => api(`/api/account/upgrade-orders/${renew.data.order.id}/pay-status`, { user: 'member', method: 'POST', body: {} })))
  workspace = (await api('/api/account/workspace', { user: 'member' })).data
  check('Repeated payment checks do not extend twice', new Date(workspace.planExpiresAt).getTime() === expiry)
  await stop(); await start({ KUNQIONG_CLAMAV_HOST: '' })
  check('Absent scanner rejects publication in required mode', (await api('/api/shares', { user: 'owner', method: 'POST', body: form() })).status === 503)
  await stop(); await start({ KUNQIONG_ADMIN_USERNAME: 'fixture-admin', KUNQIONG_ADMIN_PASSWORD: 'fixture-only-password' })
  check('Explicit configured admin credentials work', (await api('/api/admin/login', { method: 'POST', body: { username: 'fixture-admin', password: 'fixture-only-password' } })).status === 200)
  console.log(`Remediation checks: ${passed}/${passed}; isolated fixture: ${fixture}`)
} finally {
  await stop(); scanner.closeAllConnections?.(); await new Promise((resolve) => scanner.close(resolve)); payments.closeAllConnections(); await new Promise((resolve) => payments.close(resolve))
}
