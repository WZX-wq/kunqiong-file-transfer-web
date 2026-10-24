// 真实 HTTP / JSON 持久化，所有账号和文件均在独立临时目录。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import sharp from 'sharp'
import { readFixtureMetadata } from './lib/read-audit-fixture.mjs'

const root = path.resolve(import.meta.dirname, '..'), fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-branding-'))
function copy(from, to) { fs.mkdirSync(to, { recursive: true }); for (const e of fs.readdirSync(from, { withFileTypes: true })) { if (e.isDirectory()) copy(path.join(from, e.name), path.join(to, e.name)); else if (e.isFile()) fs.copyFileSync(path.join(from, e.name), path.join(to, e.name)) } }
copy(path.join(root, 'server'), path.join(fixture, 'server'))
fs.copyFileSync(path.join(root, 'package.json'), path.join(fixture, 'package.json'))
fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
// 只在临时副本延长图片 await，用于确定性复现校验后撤权。
const brandFile = path.join(fixture, 'server/lib/team-branding.js')
fs.writeFileSync(brandFile, fs.readFileSync(brandFile, 'utf8').replace('return await normalizeAvatarData(value)', 'const result = await normalizeAvatarData(value); if (globalThis.__brandGate) { globalThis.__brandEntered = true; await globalThis.__brandGate }; return result'))
const control = `
let releaseBrandGate;
app.post('/__brand_fixture', async (req, res) => {
 const {metadata, persistMetadata} = await import('./server/lib/metadata-store.js'); const body=req.body;
 if (body.hold) { globalThis.__brandEntered=false; globalThis.__brandGate=new Promise(resolve=>releaseBrandGate=resolve) }
 if (body.release) { releaseBrandGate?.(); globalThis.__brandGate=null }
 if (body.role) { metadata.organizations[body.role.org].members.find(m=>m.userId===body.role.id).role=body.role.value; metadata.users[body.role.id].organizationRole=body.role.value }
 if (body.disable) metadata.users[body.disable].status='disabled';
 if (body.password) { const { passwordDigest } = await import('./server/lib/security-primitives.js'); metadata.shares.find(s=>s.id===body.password).passwordHash=passwordDigest('测试密码123'); }
 if (body.expire) { const org=metadata.organizations[body.expire]; org.teamPlanPermanent=false; org.teamPlanExpiresAt=new Date(Date.now()-1000).toISOString(); }
 if (body.move) { const org=metadata.organizations[body.move.org]; org.members=org.members.filter(m=>m.userId!==body.move.id); metadata.users[body.move.id].organizationId='other'; metadata.organizations.other.members.push({id:'moved',userId:body.move.id,role:'member',status:'active'}) }
 persistMetadata(); res.json({entered:globalThis.__brandEntered===true});
});
`
fs.writeFileSync(path.join(fixture, 'server.mjs'), fs.readFileSync(path.join(root, 'server.mjs'), 'utf8').replace('registerWorkspaceRoutes(app)', control + '\nregisterWorkspaceRoutes(app)'))
const now = new Date().toISOString(), future = new Date(Date.now() + 30 * 86400000).toISOString()
const users = { outsider: { id: 'outsider', nickname: '外部用户', status: 'active', planId: 'free' } }, organizations = {}, shares = [], collections = []
for (const org of ['config', 'images', 'race', 'revoke', 'disabled', 'moved', 'expired', 'other']) {
  const members = ['owner', 'admin', 'member'].map(role => {
    const id = `${org}-${role}`
    users[id] = { id, username: id, nickname: id, status: 'active', planId: role === 'owner' ? 'enterprise' : 'free', organizationId: org, organizationRole: role }
    return { id: `m-${id}`, userId: id, role, status: 'active', joinedAt: now }
  })
  organizations[org] = { id: org, name: `验收团队 ${org}`, slug: `${org}-slug`, ownerUserId: `${org}-owner`, teamPlanId: 'enterprise', teamPlanPermanent: true, createdAt: now, updatedAt: now, members }
  const file = { name: '品牌验收.txt', storedName: 'fixture.txt', relativePath: '品牌验收.txt', size: 7, mimeType: 'text/plain', reviewStatus: 'clean', scanEngine: 'clamav', scannedAt: now }
  shares.push({ id: `${org}-team`, code: `${org}team`.toUpperCase(), manageToken: `${org}-manage`, teamResource: true, teamOrganizationId: org, ownerUserId: `${org}-member`, files: [file], status: 'active', createdAt: now, expiresAt: future })
  shares.push({ id: `${org}-personal`, code: `${org}personal`.toUpperCase(), manageToken: `${org}-personal-manage`, brandingOrganizationId: org, ownerUserId: `${org}-member`, files: [file], status: 'active', createdAt: now, expiresAt: future })
  collections.push({ id: `${org}-task`, token: `${org}-task`, manageToken: `${org}-task-manage`, brandingOrganizationId: org, ownerUserId: `${org}-member`, title: '收集品牌验收', description: '合成材料', deadline: future, maxFileSizeMb: 1, allowedTypes: ['全部格式'], submissions: [], createdAt: now })
}
users['disabled-owner'].status = 'disabled'
const metadataFile = path.join(fixture, 'storage/metadata.json')
fs.mkdirSync(path.dirname(metadataFile), { recursive: true })
fs.writeFileSync(metadataFile, JSON.stringify({ users, organizations, shares, collections, messages: {}, sessions: Object.values(users).map(user => ({ id: `${user.id}-session`, user, expiresAt: future })) }))
const stored = () => readFixtureMetadata(metadataFile)
const uri = (type, bytes) => `data:image/${type};base64,${bytes.toString('base64')}`
const png = await sharp({ create: { width: 720, height: 360, channels: 4, background: '#2563eb' } }).png().withMetadata().toBuffer()
let child, base, passed = 0, stderr = ''
async function start() {
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve)); base = `http://127.0.0.1:${port}`
  const env = { ...process.env }; for (const key of Object.keys(env)) if (/^(KUNQIONG_|OAUTH_)/.test(key)) delete env[key]
  child = spawn(process.execPath, ['server.mjs'], { cwd: fixture, windowsHide: true, env: { ...env, NODE_ENV: 'production', PORT: String(port), KUNQIONG_HOST: '127.0.0.1', KUNQIONG_DB_ENABLED: 'false', KUNQIONG_SCAN_MODE: 'required' }, stdio: ['ignore', 'ignore', 'pipe'] })
  child.stderr.on('data', bytes => { stderr += bytes })
  for (let i = 0; i < 120; i++) { try { if ((await fetch(base + '/api/health')).ok) return } catch {} await delay(50) }
  throw new Error(stderr || 'Fixture not ready')
}
async function stop() { if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await Promise.race([exited, delay(3000)]) } }
async function api(url, user = 'config-owner', method = 'GET', body) {
  const response = await fetch(base + url, { method, headers: { ...(user ? { cookie: `kunqiong_session=${user}-session` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: response.status, data: await response.json() }
}
const settings = '/api/account/workspace/branding'
const save = (user, revision, extra = {}) => api(settings, user, 'PATCH', { revision, name: '鲲穹测试中心', introduction: '请核对资料后提交', ...extra })
const controlFixture = body => api('/__brand_fixture', 'outsider', 'POST', body)
function check(label, condition) { assert.ok(condition, label); passed++; console.log('PASS ' + label) }
try {
  await start()
  check('游客不能读取配置', (await api(settings, '')).status === 401)
  for (const user of ['', 'outsider', 'config-member', 'disabled-owner']) {
    check(`${user || '游客'}不能保存`, [401, 403].includes((await save(user, 0)).status))
    check(`${user || '游客'}不能重置`, [401, 403].includes((await api(settings, user, 'DELETE', { revision: 0 })).status))
  }
  check('成员不能读取管理配置', (await api(settings, 'config-member')).status === 403)
  check('默认未启用且名称回退团队', (await api(settings)).data.branding.name === '验收团队 config' && !(await api(settings)).data.branding.enabled)
  check('其他团队只读自己的品牌', (await api(settings, 'other-owner')).data.branding.name === '验收团队 other')
  for (const extra of [{ name: '' }, { name: 'x'.repeat(81) }, { introduction: 'x'.repeat(161) }, { name: '<b>\u0000' }, { name: [] }, { introduction: {} }, { revision: '0' }, { revision: -1 }, { organizationId: 'other' }]) {
    check('非法字段不落库 ' + JSON.stringify(extra), (await save('config-owner', 0, extra)).status === 400 && !stored().organizations.config.branding.enabled)
  }
  const saved = await save('config-admin', 0, { logo: uri('png', png), name: '<script>alert(1)</script> 测试中心' })
  check('管理员可保存公开名称Logo简介', saved.status === 200 && saved.data.branding.enabled && saved.data.branding.revision === 1)
  check('品牌设置不更改团队账号名称', stored().organizations.config.name === '验收团队 config')
  check('管理返回URL而非原始图片', saved.data.branding.logoUrl.includes('/brand-logo?v=1') && !JSON.stringify(saved.data).includes('base64'))
  const logoResponse = await fetch(base + saved.data.branding.logoUrl), logoMetadata = await sharp(Buffer.from(await logoResponse.arrayBuffer())).metadata()
  check('公开Logo格式正确且限制尺寸', logoResponse.status === 200 && logoResponse.headers.get('content-type').includes('image/webp') && logoMetadata.width === 512 && logoMetadata.height === 256)
  check('Logo清除EXIF元数据', !logoMetadata.exif && !logoMetadata.orientation)
  check('旧版本编辑不能覆盖', (await save('config-owner', 0)).status === 409 && stored().organizations.config.branding.revision === 1)
  for (const endpoint of ['/api/shares/token/config-team', '/api/shares/token/config-team?organization=config-slug', '/api/shares/token/config-personal?organization=config-slug']) {
    const result = await api(endpoint, endpoint.includes('config-team') ? 'config-member' : '')
    check('公开分享只含品牌公开字段 ' + endpoint, result.status === 200 && Object.keys(result.data.share.branding).sort().join(',') === 'introduction,logoUrl,name')
  }
  check('个人普通分享保持默认', (await api('/api/shares/token/config-personal', '')).data.share.branding === null)
  check('品牌不开放团队文件给游客', (await api('/api/shares/token/config-team', '')).status === 401)
  await controlFixture({ password: 'config-personal' })
  check('密码验证后保留企业品牌', (await api('/api/shares/lookup/CONFIGPERSONAL?organization=config-slug', '', 'POST', { password: '测试密码123' })).data.share.branding.name === saved.data.branding.name)
  check('密码验证也拒绝错误团队链接', (await api('/api/shares/lookup/CONFIGPERSONAL?organization=other-slug', '', 'POST', { password: '测试密码123' })).status === 404)
  const brandedTask = await api('/api/collections/config-task?organization=config-slug', '')
  check('收集和分享品牌一致', brandedTask.status === 200 && brandedTask.data.collection.branding.name === saved.data.branding.name)
  check('普通收集链接保持默认', (await api('/api/collections/config-task', '')).data.collection.branding === null)
  check('跨团队slug不能套用品牌', (await api('/api/collections/config-task?organization=other-slug', '')).status === 404 && (await api('/api/shares/token/config-personal?organization=other-slug', '')).status === 404)
  check('未知Logo不泄露团队配置', (await fetch(base + '/api/organizations/missing/brand-logo')).status === 404)
  for (const logo of [uri('svg+xml', Buffer.from('<svg/>')), uri('gif', Buffer.from('GIF89a')), uri('jpeg', png), uri('png', Buffer.from('corrupt')), uri('png', png.subarray(0, 35)), uri('png', Buffer.alloc(400 * 1024 + 1)), 'https://example.invalid/logo.png', 23]) {
    const result = await save('images-owner', 0, { logo })
    check('坏图拒绝且原配置不变 ' + (typeof logo === 'string' ? logo.slice(0, 22) : logo), result.status === 400 && !stored().organizations.images.branding.enabled)
  }
  for (const format of ['jpeg', 'webp']) {
    const before = (await api(settings, 'images-admin')).data.branding.revision
    const bytes = await sharp(png)[format]().toBuffer()
    check('接受静态图片 ' + format, (await save('images-admin', before, { logo: uri(format, bytes) })).status === 200)
  }
  const before = stored().organizations.config.branding
  check('上传失败保留已保存Logo', (await save('config-owner', 1, { logo: uri('png', Buffer.from('bad')) })).status === 400 && stored().organizations.config.branding.logo === before.logo)
  const parallel = await Promise.all([save('race-owner', 0, { logo: uri('png', png) }), save('race-admin', 0, { logo: uri('png', png) })])
  check('同版本并发只有一个成功', parallel.filter(x => x.status === 200).length === 1 && parallel.filter(x => x.status === 409).length === 1)
  for (const scenario of ['revoke', 'disabled', 'moved']) {
    const actor = `${scenario}-admin`
    await controlFixture({ hold: true })
    const request = save(actor, 0, { logo: uri('png', png) })
    let entered = false
    for (let i = 0; i < 100; i++) { if ((await controlFixture({})).data.entered) { entered = true; break } await delay(10) }
    check('已进入图片await ' + scenario, entered)
    const change = scenario === 'revoke' ? { role: { org: scenario, id: actor, value: 'member' } } : scenario === 'disabled' ? { disable: actor } : { move: { org: scenario, id: actor } }
    await controlFixture({ ...change, release: true })
    check('解码期间撤权禁止写入 ' + scenario, [401, 403, 409].includes((await request).status) && !stored().organizations[scenario].branding.enabled)
  }
  const task = await api('/api/collections', 'config-owner', 'POST', { title: '固定品牌关联', description: '', maxFileSizeMb: 1 })
  check('新收集任务冻结品牌组织关联', task.status === 201 && stored().collections.find(x => x.token === task.data.collection.token).brandingOrganizationId === 'config')
  await controlFixture({ move: { org: 'config', id: 'config-member' } })
  check('换团队后旧个人分享不套新品牌', (await api('/api/shares/token/config-personal?organization=other-slug', '')).status === 404)
  check('换团队后旧收集不套新品牌', (await api('/api/collections/config-task?organization=other-slug', '')).status === 404)
  check('团队资源仍固定原团队品牌', (await api('/api/shares/token/config-team', 'config-owner')).data.share.branding.name === saved.data.branding.name)
  const handover = await api('/api/account/workspace/transfer-ownership', 'config-owner', 'POST', { targetMemberId: 'm-config-admin' })
  check('可以发起所有权交接', handover.status === 201)
  check('交接确认成功', (await api(`/api/account/workspace/ownership-handovers/${handover.data.handover.id}`, 'config-admin', 'POST', { decision: 'accept' })).status === 200)
  check('品牌不随负责人交接丢失', (await api(settings, 'config-admin')).data.branding.revision === 1 && stored().organizations.config.branding.logo === before.logo)
  check('交接后原负责人不能修改品牌', (await save('config-owner', 1)).status === 403)
  await stop(); await start()
  check('重启后品牌与版本保留', (await api(settings, 'config-admin')).data.branding.logoUrl.endsWith('v=1'))
  check('新所有者可清除Logo', (await save('config-admin', 1, { logo: '' })).data.branding.logoUrl === '')
  check('原Logo不再提供', (await fetch(base + '/api/organizations/config-slug/brand-logo')).status === 404)
  check('旧版本不能重置', (await api(settings, 'config-admin', 'DELETE', { revision: 1 })).status === 409)
  const reset = await api(settings, 'config-admin', 'DELETE', { revision: 2 })
  check('恢复默认清空品牌但不重命名', reset.status === 200 && !reset.data.branding.enabled && reset.data.branding.name === '验收团队 config')
  check('重置后公开资源回到默认', (await api('/api/shares/token/config-team', 'config-admin')).data.share.branding === null)
  check('品牌更新重置有审计且无图片内容', stored().auditLogs.some(x => x.action === '恢复默认团队品牌') && !JSON.stringify(stored().auditLogs).includes('data:image'))
  await save('expired-owner', 0, { logo: uri('png', png) }); await controlFixture({ expire: 'expired' })
  check('到期团队不能修改品牌', (await save('expired-owner', 1)).status === 403)
  check('到期团队Logo不继续提供', (await fetch(base + '/api/organizations/expired-slug/brand-logo')).status === 404)
} finally { await stop() }
const report = { executedAt: new Date().toISOString(), passed, fixture, environment: 'Isolated HTTP server, JSON storage, synthetic accounts only' }
fs.mkdirSync(path.join(root, '.workbuddy/team-branding'), { recursive: true })
fs.writeFileSync(path.join(root, '.workbuddy/team-branding/results.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report))
