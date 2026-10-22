// Real routes in disposable storage. Large sizes are metadata only, never allocated.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'

const root = path.resolve(import.meta.dirname, '..')
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-runtime-plans-'))
function copyDirectory(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const item of fs.readdirSync(from, { withFileTypes: true })) {
    if (item.isDirectory()) copyDirectory(path.join(from, item.name), path.join(to, item.name))
    else fs.copyFileSync(path.join(from, item.name), path.join(to, item.name))
  }
}
copyDirectory(path.join(root, 'server'), path.join(fixture, 'server'))
fs.copyFileSync(path.join(root, 'package.json'), path.join(fixture, 'package.json'))
fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
fs.copyFileSync(path.join(root, 'server.mjs'), path.join(fixture, 'server.mjs'))
const GB = 1024 ** 3, future = new Date(Date.now() + 60 * 86400000).toISOString()
const planIds = ['free', 'member', 'team', 'halfyear', 'year', 'enterprise']
const activePlanIds = planIds.filter(id => id !== 'enterprise')
const users = Object.fromEntries([...planIds, 'sender', 'other', 'buyer', 'permanent-buyer', 'finite-buyer', 'managed', 'legacy-managed', 'invited'].map(id => [id, { id, username: id, planId: planIds.includes(id) ? id : id === 'managed' ? 'enterprise' : 'free', status: 'active', planExpiresAt: ['enterprise', 'managed', 'buyer', 'permanent-buyer', 'finite-buyer'].includes(id) ? null : future }]))
const organizations = { org: { id: 'org', slug: 'org', name: 'fixture', ownerUserId: 'team', teamPlanId: 'team', teamPlanExpiresAt: future, members: ['team', 'sender'].map(userId => ({ id: userId, userId, status: 'active', role: userId === 'team' ? 'owner' : 'member' })) } }
users['timed-member'] = { id: 'timed-member', username: 'timed-member', planId: 'member', status: 'active', planExpiresAt: new Date(Date.now() + 20 * 86400000).toISOString() }
organizations.org.members.push({ id: 'timed-member', userId: 'timed-member', status: 'active', role: 'member' })
const expired = new Date(Date.now() - 1000).toISOString()
users['legacy-expired-owner'] = { id: 'legacy-expired-owner', username: 'legacy-expired-owner', planId: 'team', status: 'active', planExpiresAt: expired, planPermanent: false, planManagedAt: new Date(Date.now() - 30 * 86400000).toISOString() }
users['legacy-paid-peer'] = { id: 'legacy-paid-peer', username: 'legacy-paid-peer', planId: 'team', status: 'active', planExpiresAt: future, planPermanent: false }
organizations['legacy-expiry'] = { id: 'legacy-expiry', slug: 'legacy-expiry', name: 'legacy expiry', ownerUserId: 'legacy-expired-owner', members: ['legacy-expired-owner', 'legacy-paid-peer'].map(userId => ({ id: userId, userId, status: 'active', role: userId === 'legacy-expired-owner' ? 'owner' : 'member' })) }
users['legacy-transfer-owner'] = { id: 'legacy-transfer-owner', username: 'legacy-transfer-owner', planId: 'free', status: 'active', planExpiresAt: null }
users['legacy-original-owner'] = { id: 'legacy-original-owner', username: 'legacy-original-owner', planId: 'team', status: 'active', planExpiresAt: future, planPermanent: false }
organizations['legacy-transferred'] = { id: 'legacy-transferred', slug: 'legacy-transferred', name: 'legacy transferred', ownerUserId: 'legacy-transfer-owner', members: ['legacy-transfer-owner', 'legacy-original-owner'].map(userId => ({ id: userId, userId, status: 'active', role: userId === 'legacy-transfer-owner' ? 'owner' : 'member' })) }
organizations.legacy = { id: 'legacy-org', slug: 'legacy-org', name: 'legacy team', ownerUserId: 'enterprise', teamPlanId: 'enterprise', teamPlanPermanent: true, members: ['enterprise', 'managed', 'legacy-managed', 'invited'].map(userId => ({ id: userId, userId, status: 'active', role: userId === 'enterprise' ? 'owner' : 'member' })) }
fs.mkdirSync(path.join(fixture, 'storage'))
const metadataFile = path.join(fixture, 'storage/metadata.json')
fs.writeFileSync(metadataFile, JSON.stringify({ users, organizations, sessions: Object.values(users).map(user => ({ id: user.id + '-session', user, expiresAt: future, apiWebToken: 'fixture-token' })), shares: [], collections: [], upgradeOrders: [{ id: 'legacy-pending', orderNo: 'LEGACY-PENDING', userId: 'other', planId: 'enterprise', status: 'pending_payment', amount: 15900, createdAt: new Date().toISOString() }], systemConfig: { anonymousMaxFileSizeMb: 500, anonymousTotalSizeMb: 1024, planOverrides: { enterprise: { totalGb: 2100 } } } }))
const seeded = JSON.parse(fs.readFileSync(metadataFile, 'utf8'))
seeded.auditLogs = [
  { id: 'legacy-admin-edit', type: 'admin', action: '更新用户状态或权益', targetId: 'legacy-managed', details: { planId: 'free', status: 'active' }, createdAt: new Date(Date.now() - 60000).toISOString() },
  { id: 'legacy-transfer', type: 'team', action: '转让团队所有权', userId: 'legacy-original-owner', targetId: 'legacy-transfer-owner', details: { organizationId: 'legacy-transferred', previousOwnerId: 'legacy-original-owner', teamPlanId: 'team', teamPlanExpiresAt: future, teamPlanPermanent: false }, createdAt: new Date(Date.now() - 30000).toISOString() },
]
fs.writeFileSync(metadataFile, JSON.stringify(seeded))
const stored = () => JSON.parse(fs.readFileSync(metadataFile, 'utf8'))

// Protocol emulator verifies application publication logic, not antivirus performance.
const scanner = net.createServer(socket => {
  let pending = Buffer.alloc(0), started = false
  socket.on('data', data => {
    pending = Buffer.concat([pending, data])
    if (!started) { if (pending.length < 10) return; assert.equal(pending.subarray(0, 10).toString(), 'zINSTREAM\0'); pending = pending.subarray(10); started = true }
    while (pending.length >= 4) {
      const size = pending.readUInt32BE(0)
      if (pending.length < size + 4) return
      pending = pending.subarray(size + 4)
      if (!size) { socket.end('stream: OK\0'); return }
    }
  })
})
await new Promise(resolve => scanner.listen(0, '127.0.0.1', resolve))
const packages = [
  { id: 1, name: '月卡', price_yuan: 19, days: 30 }, { id: 2, name: '季卡', price_yuan: 49, days: 90 },
  { id: 3, name: '半年卡', price_yuan: 79, days: 180 }, { id: 4, name: '年卡', price_yuan: 129, days: 365 }, { id: 5, name: '永久', price_yuan: 159, days: 0 },
]
let paid = false
const provider = http.createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk
  const params = new URLSearchParams(body)
  const pkg = packages.find(pkg => pkg.id === Number(params.get('package_id')))
  const data = req.url.endsWith('get_web_member_package_info') ? { packages }
    : req.url.endsWith('create_web_member_order') ? { order_no: 'fixture-' + pkg.id, package_id: pkg.id, pay_amount: pkg.price_yuan, package_days: pkg.days, pay_type: 1, code_url: 'weixin://fixture' }
      : { pay_status: paid ? 1 : 0, expire_at: null }
  res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ code: 1, data }))
})
await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve))
const env = { ...process.env }
for (const key of Object.keys(env)) if (/^(KUNQIONG_|OAUTH_)/.test(key)) delete env[key]
let child, base, adminCookie = '', log = '', checks = 0
async function start() {
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve)); base = 'http://127.0.0.1:' + port
  child = spawn(process.execPath, ['server.mjs'], { cwd: fixture, windowsHide: true, env: { ...env, NODE_ENV: 'test', PORT: String(port), KUNQIONG_HOST: '127.0.0.1', KUNQIONG_DB_ENABLED: 'false', KUNQIONG_TEST_ENFORCE_ENTERPRISE_ALLOWLIST: 'false', KUNQIONG_ADMIN_USERNAME: 'fixture', KUNQIONG_ADMIN_PASSWORD: 'fixture-password', KUNQIONG_SCAN_MODE: 'required', KUNQIONG_CLAMAV_HOST: '127.0.0.1', KUNQIONG_CLAMAV_PORT: String(scanner.address().port), KUNQIONG_WEB_MEMBER_API_BASE: 'http://127.0.0.1:' + provider.address().port }, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', data => log += data); child.stderr.on('data', data => log += data)
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health')).ok) return } catch {} await delay(50) }
  throw Error('Fixture startup failed: ' + log)
}
async function stop() { if (child?.exitCode === null) { const end = once(child, 'exit'); child.kill(); await end } }
async function api(url, { user = '', admin = false, cookie = '', method = 'GET', body } = {}) {
  const form = body instanceof FormData
  const response = await fetch(base + url, { method, headers: { ...(admin ? { cookie: adminCookie } : user ? { cookie: 'kunqiong_session=' + user + '-session' } : cookie ? { cookie } : {}), ...(body && !form ? { 'content-type': 'application/json' } : {}) }, body: form ? body : body ? JSON.stringify(body) : undefined })
  return { status: response.status, data: await response.json().catch(() => ({})), headers: response.headers }
}
function eq(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++; console.log('PASS ' + label) }
const config = body => api('/api/admin/config', { admin: true, method: 'PATCH', body })
async function login() { const result = await api('/api/admin/login', { method: 'POST', body: { username: 'fixture', password: 'fixture-password' } }); eq(result.status, 200, 'admin login'); adminCookie = result.headers.getSetCookie()[0].split(';')[0] }
async function session(user, size, extra = {}) { return api('/api/upload-sessions', { user, method: 'POST', body: { files: [{ name: 'file.bin', size }], ...extra } }) }
async function discard(result, user) { if (result.data.sessionId) await api('/api/upload-sessions/' + result.data.sessionId, { user, method: 'DELETE' }) }
const create = (user, extra = {}) => api('/api/collections', { user, method: 'POST', body: { title: 'fixture', maxFileSizeMb: 500, ...extra } })
const submit = (token, user = '', cookie = '', name = 'guest') => { const form = new FormData(); form.append('participantName', name); form.append('files', new Blob(['fixture']), 'fixture.txt'); return api('/api/collections/' + token + '/submissions', { user, cookie, method: 'POST', body: form }) }
try {
  await start(); await login()
  eq((await api('/api/account/workspace', { user: 'legacy-expired-owner' })).data.teamEntitlement.canUseTeamSpace, false, 'legacy owner expiry disables organization team access')
  eq((await api('/api/account/workspace', { user: 'legacy-paid-peer' })).data.teamEntitlement.canUseTeamSpace, false, 'legacy member personal plan cannot keep expired owner organization active')
  eq([(await api('/api/account/team/overview', { user: 'legacy-expired-owner' })).status, (await api('/api/account/team/overview', { user: 'legacy-paid-peer' })).status], [403, 403], 'legacy expired team denies every member consistently')
  eq((await api('/api/account/team/overview', { user: 'legacy-transfer-owner' })).status, 200, 'legacy ownership transfer recovers the recorded organization plan')
  eq((await api('/api/account/team/overview', { user: 'legacy-original-owner' })).status, 200, 'legacy transfer plan applies to previous owner and other members')
  eq((await api('/api/account/team/overview', { user: 'timed-member' })).data.teamPlanExpiresAt, future, 'inherited team expiry is independent from personal monthly expiry')
  eq((await api('/api/account/workspace', { user: 'legacy-managed' })).data.teamEntitlement.canUseTeamSpace, true, 'member admin downgrade does not revoke the active organization plan')
  eq((await api('/api/account/workspace', { user: 'managed' })).data.teamEntitlement.canUseTeamSpace, true, 'enterprise member initially has team access')
  eq((await api('/api/admin/users/managed', { admin: true, method: 'PATCH', body: { planId: 'free' } })).status, 200, 'admin downgrades former enterprise account')
  const downgraded = (await api('/api/account/workspace', { user: 'managed' })).data
  eq([downgraded.plan.id, downgraded.teamEntitlement.canUseTeamSpace, downgraded.teamEntitlement.teamPlanId], ['free', true, 'enterprise'], 'member personal downgrade does not change organization team access')
  eq((await api('/api/account/team/overview', { user: 'managed' })).status, 200, 'downgraded personal account shares the active organization team API')
  const managedTeamSession = await session('managed', 1, { mode: 'team_resource' })
  eq(managedTeamSession.status, 201, 'downgraded personal account can upload within the active organization plan')
  await discard(managedTeamSession, 'managed')
  eq((await api('/api/account/workspace', { user: 'invited' })).data.teamEntitlement.canUseTeamSpace, true, 'member downgrade leaves the shared organization plan active for everyone')
  eq((await api('/api/account/workspace', { user: 'enterprise' })).data.teamEntitlement.teamPlanId, 'enterprise', 'admin member downgrade does not rewrite another owner organization')
  await api('/api/admin/users/managed', { admin: true, method: 'PATCH', body: { planId: 'member' } })
  eq((await api('/api/account/workspace', { user: 'managed' })).data.teamEntitlement.canUseTeamSpace, true, 'monthly personal plan does not change enterprise organization access')
  paid = true
  const restoredOrder = (await api('/api/account/upgrade-orders', { user: 'managed', method: 'POST', body: { planId: 'team' } })).data.order
  await api('/api/account/upgrade-orders/' + restoredOrder.id + '/confirm', { user: 'managed', method: 'POST' })
  await api('/api/account/upgrade-orders/' + restoredOrder.id + '/pay-status', { user: 'managed', method: 'POST' })
  const restored = (await api('/api/account/workspace', { user: 'managed' })).data
  eq([restored.plan.id, restored.teamEntitlement.canUseTeamSpace, restored.teamEntitlement.teamPlanId], ['team', true, 'enterprise'], 'personal payment does not overwrite the independent organization plan')
  const restoredTeam = (await api('/api/account/team/overview', { user: 'managed' })).data
  eq([restoredTeam.plan.id, restoredTeam.capacity.totalBytes, restoredTeam.capacity.singleFileLimitBytes], ['enterprise', 1024 * GB, 20 * GB], 'team quota and file limit stay on the organization plan after a member purchase')
  paid = false
  let overview = (await api('/api/admin/overview', { admin: true })).data
  eq(overview.plans.map(plan => plan.id), activePlanIds, 'only five active plans are editable')
  eq(overview.planDefaults.map(plan => plan.id), activePlanIds, 'retired plan absent from default catalog')
  eq((await api('/api/account/workspace', { user: 'free' })).data.plans.map(plan => plan.id), activePlanIds, 'customer catalog excludes retired enterprise plan')
  eq((await api('/api/account/upgrade-orders', { user: 'other', method: 'POST', body: { planId: 'enterprise' } })).status, 410, 'retired plan cannot be ordered through a stale client')
  const retiredConfirm = await api('/api/account/upgrade-orders/legacy-pending/confirm', { user: 'other', method: 'POST' })
  eq([retiredConfirm.status, retiredConfirm.data.order.retired, retiredConfirm.data.order.remoteOrderNo], [410, true, ''], 'retired pending order cannot create a provider payment')
  eq((await api('/api/admin/users/other', { admin: true, method: 'PATCH', body: { planId: 'enterprise' } })).status, 400, 'admin cannot newly grant retired plan')
  eq((await config({ planOverrides: { enterprise: { totalGb: 1 } } })).status, 400, 'retired plan configuration cannot be overwritten')
  eq(overview.config.anonymousMaxFileSizeMb, 1228.8, 'legacy guest default migrated to 1.2GB')
  eq(overview.config.anonymousTotalSizeMb, 2048, 'guest cumulative cap accommodates 1.2GB')
  eq(overview.plans.map(plan => [plan.totalBytes / GB, plan.teamSpaceBytes / GB, plan.singleFileLimitBytes / GB, plan.collectionParticipantLimit, plan.activeCollectionLimit, plan.validityDays]), [[20,0,2,10,1,null],[100,0,5,50,5,30],[500,200,10,100,20,90],[1024,500,15,300,50,180],[1024,500,20,500,100,365]], 'approved entitlement table')
  eq((await api('/api/admin/config', { method: 'PATCH', body: { planOverrides: {} } })).status, 401, 'non-admin configuration rejected')
  for (const patch of [{ member: { monthlyPrice: 1 } }, { year: { singleFileGb: 21 } }, { member: { activeCollectionLimit: -1 } }, { unknown: {} }]) eq((await config({ planOverrides: patch })).status, 400, 'invalid entitlement/price write rejected')
  for (const [field, min, max] of [['totalGb', 1, 20480], ['totalGB', 1, 20480], ['teamGb', 0, 20480], ['singleFileGb', 1, 20], ['totalBytes', GB, 20480 * GB], ['teamSpaceBytes', 0, 20480 * GB], ['singleFileLimitBytes', GB, 20 * GB]]) {
    for (const invalid of [min - 1, max + 1, field.endsWith('Bytes') ? GB / 2 : 0.005]) {
      eq((await config({ planOverrides: { member: { [field]: invalid } } })).status, 400, field + ' rejects out-of-range or fractional GB ' + invalid)
    }
    for (const valid of [min, max]) eq((await config({ planOverrides: { member: { [field]: valid } } })).status, 200, field + ' accepts inclusive boundary ' + valid)
  }
  await config({ planOverrides: {} })
  eq((await config({ anonymousTotalSizeMb: 100 })).status, 400, 'inconsistent guest budget rejected')
  for (const [id, limit] of [['free',2],['member',5],['team',10],['halfyear',15],['year',20],['enterprise',20]]) {
    const accepted = await session(id, limit * GB); eq(accepted.status, 201, id + ' accepts file boundary'); await discard(accepted, id)
    eq((await session(id, limit * GB + 1)).status, 413, id + ' rejects boundary plus one byte')
  }
  const teamSession = await session('sender', 10 * GB, { mode: 'team_resource' }); eq(teamSession.status, 201, 'free member uses organization upload cap'); await discard(teamSession, 'sender')
  const overrides = { member: { totalGb: 120, teamGb: 0, singleFileGb: 3, collectionParticipantLimit: 2, activeCollectionLimit: 1, validityDays: 45 }, team: { teamGb: 220 } }
  const saved = await config({ planOverrides: overrides })
  eq(saved.status, 200, 'runtime save successful')
  eq(saved.data.plans.map(plan => plan.id), activePlanIds, 'saving does not reintroduce retired plan')
  eq((await api('/api/account/workspace', { user: 'enterprise' })).data.capacity.totalBytes, 2100 * GB, 'active config save preserves purchased legacy quota overrides')
  eq((await api('/api/account/workspace', { user: 'member' })).data.capacity.totalBytes, 120 * GB, 'personal quota changes immediately')
  eq((await api('/api/account/team/overview', { user: 'sender' })).data.capacity.totalBytes, 220 * GB, 'organization quota changes immediately for all members')
  eq((await session('member', 3 * GB + 1)).status, 413, 'new upload cap enforced immediately')
  const runtime = (await api('/api/runtime-config', { user: 'member' })).data
  eq(runtime.upload.collectionParticipantLimit, 2, 'frontend receives effective collection quota')
  const raced = await Promise.all([create('member'), create('member')]); eq(raced.map(result => result.status).sort(), [201,409], 'concurrent creation cannot exceed active task quota')
  const task = raced.find(result => result.status === 201).data.collection
  const concurrent = await Promise.all(['sender','other','free'].map(user => submit(task.token, user)))
  eq(concurrent.map(result => result.status).sort(), [201,201,409], 'concurrent submissions cannot exceed participant quota')
  const acceptedUser = ['sender','other','free'][concurrent.findIndex(result => result.status === 201)]
  eq((await submit(task.token, acceptedUser)).status, 201, 'same participant can resubmit without taking another seat')
  eq((await api('/api/collections/' + task.token, { user: 'sender' })).data.collection.participantCount, 2, 'unique participant count exposed')
  await api('/api/collections/manage/' + task.manageToken, { user: 'member', method: 'PATCH', body: { status: 'closed' } })
  eq((await create('member')).status, 201, 'closing a task releases active slot')
  eq((await api('/api/collections/manage/' + task.manageToken, { user: 'member', method: 'PATCH', body: { status: 'active' } })).status, 409, 'reopening also checks active quota')
  const anonymous = await create('', { title: 'anonymous' }); eq(anonymous.status, 201, 'guest collection creation')
  const guestFirst = await submit(anonymous.data.collection.token)
  eq(guestFirst.status, 201, 'guest participant can submit')
  const guestCookie = guestFirst.headers.getSetCookie().find(value => value.startsWith('kq_guest_id=')).split(';')[0]
  eq((await submit(anonymous.data.collection.token, '', guestCookie, 'renamed')).status, 201, 'guest identity survives display name change')
  eq((await api('/api/collections/' + anonymous.data.collection.token)).data.collection.participantCount, 1, 'guest device is counted once')
  const pricing = (await api('/api/account/upgrade-pricing', { user: 'buyer' })).data.pricing
  eq(Object.keys(pricing), activePlanIds.filter(id => id !== 'free'), 'pricing excludes retired main-site package even when provider still offers it')
  eq([pricing.halfyear.packageId, pricing.halfyear.priceCents, pricing.year.packageId, pricing.year.priceCents], [3,7900,4,12900], '79/129 prices come from main-site package 3/4')
  const order = (await api('/api/account/upgrade-orders', { user: 'buyer', method: 'POST', body: { planId: 'member' } })).data.order
  eq(order.amount, 1900, 'local duration does not change main-site price')
  await config({ planOverrides: { ...overrides, member: { ...overrides.member, validityDays: 60 } } })
  eq((await api('/api/account/upgrade-orders/' + order.id + '/confirm', { user: 'buyer', method: 'POST', body: { payType: 1 } })).status, 200, 'payment order confirms against provider')
  paid = true
  eq((await api('/api/account/upgrade-orders/' + order.id + '/pay-status', { user: 'buyer', method: 'POST' })).status, 200, 'payment activation succeeds')
  const remainingDays = (new Date(stored().users.buyer.planExpiresAt) - Date.now()) / 86400000
  eq(Math.round(remainingDays), 45, 'activation honors the duration frozen before configuration changed')
  eq(stored().upgradeOrders.find(item => item.id === order.id).entitlementDays, 45, 'pending order freezes duration at creation')
  await config({ planOverrides: { ...overrides, year: { validityDays: 360 } } })
  eq((await api('/api/account/workspace', { user: 'enterprise' })).data.plan.permanent, true, 'legacy permanent owner retains lifetime rights after term changes')
  const finiteOrder = (await api('/api/account/upgrade-orders', { user: 'finite-buyer', method: 'POST', body: { planId: 'year' } })).data.order
  eq(finiteOrder.entitlementDays, 360, 'new year order uses configured finite term')
  await api('/api/account/upgrade-orders/' + finiteOrder.id + '/confirm', { user: 'finite-buyer', method: 'POST', body: { payType: 1 } })
  eq((await api('/api/account/upgrade-orders/' + finiteOrder.id + '/pay-status', { user: 'finite-buyer', method: 'POST' })).data.order.permanent, false, 'year purchase is not labeled permanent')
  await config({ planOverrides: { ...overrides, member: { ...overrides.member, validityDays: 0 } } })
  const lifetimeOrder = (await api('/api/account/upgrade-orders', { user: 'permanent-buyer', method: 'POST', body: { planId: 'member' } })).data.order
  await api('/api/account/upgrade-orders/' + lifetimeOrder.id + '/confirm', { user: 'permanent-buyer', method: 'POST', body: { payType: 1 } })
  eq((await api('/api/account/upgrade-orders/' + lifetimeOrder.id + '/pay-status', { user: 'permanent-buyer', method: 'POST' })).data.order.permanent, true, 'zero-day configuration activates permanent rights')
  await config({ planOverrides: { ...overrides, member: { ...overrides.member, validityDays: 60 } } })
  eq((await api('/api/account/workspace', { user: 'permanent-buyer' })).data.plan.permanent, true, 'changing package term does not revoke purchased permanent rights')
  const originalExpiry = stored().users.member.planExpiresAt
  await stop(); await start(); await login()
  overview = (await api('/api/admin/overview', { admin: true })).data
  eq(overview.plans.find(plan => plan.id === 'member').validityDays, 60, 'configuration survives restart')
  eq((await api('/api/account/workspace', { user: 'permanent-buyer' })).data.plan.permanent, true, 'new permanent grant survives restart and configuration changes')
  eq((await api('/api/account/workspace', { user: 'finite-buyer' })).data.plan.permanent, false, 'finite year grant survives restart without becoming permanent')
  eq(stored().users.member.planExpiresAt, originalExpiry, 'changing validity never rewrites existing paid expiry')
  const legacy = (await api('/api/account/workspace', { user: 'enterprise' })).data
  eq([legacy.plan.permanent, legacy.capacity.totalBytes], [true, 2100 * GB], 'legacy permanent rights and quotas survive retirement and restart')
  eq((await api('/api/account/workspace', { user: 'managed' })).data.teamEntitlement.teamPlanId, 'enterprise', 'organization plan remains independent after member payment and restart')
  await api('/api/admin/users/team', { admin: true, method: 'PATCH', body: { planId: 'member' } })
  eq([(await api('/api/account/team/overview', { user: 'team' })).status, (await api('/api/account/team/overview', { user: 'sender' })).status], [403, 403], 'admin downgrade of the owner disables team access for every member')
  eq((await api('/api/account/workspace', { user: 'team', method: 'PATCH', body: { name: 'blocked rename' } })).status, 403, 'downgraded owner cannot rename team through a direct request')
  eq((await api('/api/account/workspace/members/sender/role', { user: 'team', method: 'PATCH', body: { role: 'admin' } })).status, 403, 'downgraded owner cannot manage roles through a direct request')
  await api('/api/admin/users/team', { admin: true, method: 'PATCH', body: { planId: 'team', planExpiresAt: future } })
  eq([(await api('/api/account/team/overview', { user: 'team' })).status, (await api('/api/account/team/overview', { user: 'sender' })).status], [200, 200], 'restoring owner team plan re-enables team access for every member')
  console.log(`Runtime entitlement checks: ${checks} passed; fixture ${fixture}`)
} finally {
  await stop(); await new Promise(resolve => scanner.close(resolve)); await new Promise(resolve => provider.close(resolve))
}
