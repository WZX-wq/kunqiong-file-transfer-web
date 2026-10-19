// Real admin/account routes and restart persistence in a disposable storage copy.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { readFixtureMetadata } from './lib/read-audit-fixture.mjs'

const root = path.resolve(import.meta.dirname, '..')
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-admin-plans-'))
function copy(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const item of fs.readdirSync(from, { withFileTypes: true })) {
    if (item.isDirectory()) copy(path.join(from, item.name), path.join(to, item.name))
    else fs.copyFileSync(path.join(from, item.name), path.join(to, item.name))
  }
}
copy(path.join(root, 'server'), path.join(fixture, 'server'))
fs.copyFileSync(path.join(root, 'package.json'), path.join(fixture, 'package.json'))
fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
const control = `
app.post('/__fixture_login', async (req, res) => {
 const { createAuthSession } = await import('./server/services/admin.js');
 const session = createAuthSession({ user: req.body, expires_in: 3600 });
 res.json({ user: session.user });
});
`
fs.writeFileSync(path.join(fixture, 'server.mjs'), fs.readFileSync(path.join(root, 'server.mjs'), 'utf8').replace('registerAccountRoutes(app)', control + '\nregisterAccountRoutes(app)'))
const timestamp = new Date().toISOString()
const grantAt = new Date(Date.now() - 60000).toISOString()
const future = new Date(Date.now() + 30 * 86400000).toISOString()
const past = new Date(Date.now() - 86400000).toISOString()
const ids = ['legacy-open', 'legacy-dated', 'legacy-enterprise', 'revoked', 'disabled', 'expired', 'no-evidence', 'later-paid', 'manual', 'manual-permanent']
const users = Object.fromEntries(ids.map(id => [id, { id, username: id, planId: 'free', status: id === 'disabled' ? 'disabled' : 'active', planExpiresAt: ['legacy-dated', 'later-paid'].includes(id) ? future : id === 'expired' ? past : null }]))
users['manual-permanent'].planId = 'enterprise' // Purchased legacy rights, never a new retired-plan grant.
const audit = (id, planId, extra = {}) => ({ id: 'grant-' + id, type: 'admin', action: '更新用户状态或权益', userId: 'admin:fixture', targetId: id, details: { status: 'active', planId }, createdAt: grantAt, ...extra })
const auditLogs = ids.filter(id => id !== 'no-evidence' && !id.startsWith('manual')).map(id => audit(id, id === 'legacy-enterprise' ? 'enterprise' : id === 'later-paid' ? 'member' : 'team'))
auditLogs.push(audit('revoked', 'free', { id: 'revocation', createdAt: new Date(Date.now() - 30000).toISOString() }))
const organizations = Object.fromEntries(['legacy-open', 'manual'].map(id => [id, { id, name: id, slug: id, ownerUserId: id, members: [{ id: 'owner-' + id, userId: id, role: 'owner', status: 'active' }], createdAt: grantAt }]))
const order = { id: 'later-payment', orderNo: 'PAID-LATER', userId: 'later-paid', planId: 'team', status: 'paid', amount: 4900, remoteOrderNo: 'provider-later', paidAt: new Date(Date.now() - 10000).toISOString(), remoteExpireAt: future, createdAt: grantAt }
fs.mkdirSync(path.join(fixture, 'storage'), { recursive: true })
const metadataFile = path.join(fixture, 'storage/metadata.json')
fs.writeFileSync(metadataFile, JSON.stringify({ users, sessions: ids.map(id => ({ id: id + '-session', user: users[id], expiresAt: future })), organizations, auditLogs, shares: [], collections: [], upgradeOrders: [order], messages: {} }))
const env = { ...process.env }
for (const key of Object.keys(env)) if (/^(KUNQIONG_|OAUTH_)/.test(key)) delete env[key]
let child, base, adminCookie = '', log = '', passed = 0
const failures = []
const stored = () => readFixtureMetadata(metadataFile)
function check(label, condition) {
  if (condition) { passed++; console.log('PASS ' + label) }
  else { failures.push(label); console.log('FAIL ' + label) }
}
async function start(allowlist = true) {
  const probe = net.createServer()
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  base = 'http://127.0.0.1:' + port
  child = spawn(process.execPath, ['server.mjs'], { cwd: fixture, windowsHide: true, env: { ...env, NODE_ENV: 'test', PORT: String(port), KUNQIONG_HOST: '127.0.0.1', KUNQIONG_DB_ENABLED: 'false', KUNQIONG_TEST_ENFORCE_ENTERPRISE_ALLOWLIST: String(allowlist), KUNQIONG_ADMIN_USERNAME: 'fixture-admin', KUNQIONG_ADMIN_PASSWORD: 'fixture-admin-password' }, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', data => log += data)
  child.stderr.on('data', data => log += data)
  for (let index = 0; index < 100; index++) {
    try { if ((await fetch(base + '/api/health')).ok) return } catch {}
    await delay(50)
  }
  throw Error('Fixture startup failed: ' + log)
}
async function stop() {
  if (!child || child.exitCode !== null) return
  const exited = once(child, 'exit')
  child.kill()
  await Promise.race([exited, delay(3000)])
}
async function api(url, { user, admin = false, method = 'GET', body } = {}) {
  const response = await fetch(base + url, { method, headers: { ...(user ? { cookie: 'kunqiong_session=' + user + '-session' } : admin ? { cookie: adminCookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: response.status, data: await response.json(), headers: response.headers }
}
async function login() {
  const result = await api('/api/admin/login', { method: 'POST', body: { username: 'fixture-admin', password: 'fixture-admin-password' } })
  assert.equal(result.status, 200)
  adminCookie = result.headers.get('set-cookie').split(';')[0]
}
const patch = (id, body) => api('/api/admin/users/' + id, { admin: true, method: 'PATCH', body })
try {
  await start()
  for (const [id, plan, expiry] of [['legacy-open', 'team', null], ['legacy-dated', 'team', future], ['legacy-enterprise', 'enterprise', null]]) {
    const me = (await api('/api/auth/me', { user: id })).data.user
    const workspace = (await api('/api/account/workspace', { user: id })).data
    check('历史后台授予套餐恢复 ' + id, me?.planId === plan && workspace.plan?.id === plan)
    check('原有效期保持 ' + id, stored().users[id].planExpiresAt === expiry)
  }
  const team = (await api('/api/account/team/overview', { user: 'legacy-open' })).data
  check('无支付订单的后台团队版恢复200GB', team.capacity?.totalBytes === 200 * 1024 ** 3)
  for (const id of ['revoked', 'expired', 'no-evidence']) check('撤销、过期或无证据不补发 ' + id, (await api('/api/account/workspace', { user: id })).data.plan?.id === 'free')
  check('禁用账号不补发或恢复访问', stored().users.disabled.planId === 'free' && (await api('/api/account/workspace', { user: 'disabled' })).status === 401)
  check('后台操作后较新的支付套餐优先', (await api('/api/account/workspace', { user: 'later-paid' })).data.plan?.id === 'team')
  await login()
  check('新后台团队版设置成功', (await patch('manual', { planId: 'team', planExpiresAt: future })).status === 200)
  check('下架套餐禁止新增授予且历史用户权益保留', (await patch('manual-permanent', { planId: 'enterprise', planExpiresAt: null })).status === 400 && stored().users['manual-permanent'].planId === 'enterprise')
  check('新审计保存准确的套餐有效期', stored().auditLogs.some(item => item.targetId === 'manual' && item.details?.planExpiresAt === future))
  check('后台设置立即更新团队容量', (await api('/api/account/team/overview', { user: 'manual' })).data.capacity?.totalBytes === 200 * 1024 ** 3)
  await stop()
  const snapshot = stored()
  for (const session of snapshot.sessions) if (session.user.id === 'manual' || session.user.id === 'manual-permanent') session.user = { ...session.user, planId: 'member', planExpiresAt: past }
  fs.writeFileSync(metadataFile, JSON.stringify(snapshot))
  await start()
  for (const [id, plan, expiry] of [['manual', 'team', future], ['manual-permanent', 'enterprise', null]]) {
    check('旧会话不能覆盖后台套餐与有效期 ' + id, (await api('/api/account/workspace', { user: id })).data.plan?.id === plan && stored().users[id].planExpiresAt === expiry)
    await api('/__fixture_login', { method: 'POST', body: { id, username: id, planId: 'free', planExpiresAt: past } })
    check('重新登录不能覆盖后台套餐与有效期 ' + id, (await api('/api/account/workspace', { user: id })).data.plan?.id === plan && stored().users[id].planExpiresAt === expiry)
  }
  const before = stored()
  await stop(); await start()
  check('历史恢复重启幂等', stored().users['legacy-open'].planId === 'team' && stored().users['legacy-dated'].planExpiresAt === future)
  check('恢复不创建订单或开通通知', stored().upgradeOrders.length === before.upgradeOrders.length && JSON.stringify(stored().messages) === JSON.stringify(before.messages))
  await login()
  await patch('legacy-open', { planId: 'free' })
  await stop(); await start()
  check('恢复后管理员仍可主动撤销', (await api('/api/account/workspace', { user: 'legacy-open' })).data.plan?.id === 'free')
  check('撤销后团队接口立即拒绝访问', (await api('/api/account/team/overview', { user: 'legacy-open' })).status === 403)
  await login()
  const regrant = await patch('expired', { planId: 'team' })
  check('后台重新授予不继承旧过期时间', regrant.data.user?.planId === 'team' && Math.round((new Date(stored().users.expired.planExpiresAt) - Date.now()) / 86400000) === 90)
  await patch('expired', { planId: 'team', planExpiresAt: past })
  check('管理员明确设置的过期日期仍生效', (await api('/api/account/workspace', { user: 'expired' })).data.plan?.id === 'free')
  await api('/api/admin/config', { admin: true, method: 'PATCH', body: { planOverrides: { member: { validityDays: 0 } } } })
  const permanent = await patch('expired', { planId: 'member' })
  check('后台配置永久有效期仍可清除旧套餐过期日期', permanent.data.user?.planId === 'member' && stored().users.expired.planExpiresAt === null)
  await stop()
  const unaffected = stored()
  unaffected.users['legacy-open'].planId = 'free'
  unaffected.users['legacy-dated'].planId = 'free'
  for (const session of unaffected.sessions) if (session.user.id === 'legacy-dated') session.user.planId = 'free'
  fs.writeFileSync(metadataFile, JSON.stringify(unaffected))
  await start(false)
  check('未开启旧白名单的环境不回放历史授权', stored().users['legacy-dated'].planId === 'free')
} finally { await stop() }
console.log(JSON.stringify({ passed, failures, fixture }, null, 2))
process.exitCode = failures.length ? 1 : 0
