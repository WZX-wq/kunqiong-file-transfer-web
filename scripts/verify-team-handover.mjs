// 隔离的真实 HTTP / 文件持久化验收，所有账号与资源均为合成数据。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { readFixtureMetadata } from './lib/read-audit-fixture.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-handover-'))
function copyDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: true })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name), to = path.join(destination, entry.name)
    if (entry.isDirectory()) copyDirectory(from, to)
    else if (entry.isFile()) fs.copyFileSync(from, to)
  }
}
copyDirectory(path.join(root, 'server'), path.join(fixture, 'server'))
fs.copyFileSync(path.join(root, 'package.json'), path.join(fixture, 'package.json'))
fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), 'junction')
const control = `
app.post('/__handover_fixture', async (req, res) => {
 const { metadata, persistMetadata } = await import('./server/lib/metadata-store.js');
 if (req.body.status) metadata.users[req.body.status.id].status = req.body.status.value;
 if (req.body.expire) metadata.organizations[req.body.expire].ownershipHandovers.find(h => h.status === 'pending').expiresAt = new Date(Date.now() - 1000).toISOString();
 persistMetadata(); res.json({ ok: true });
});
`
fs.writeFileSync(path.join(fixture, 'server.mjs'), fs.readFileSync(path.join(root, 'server.mjs'), 'utf8').replace('registerWorkspaceRoutes(app)', control + '\nregisterWorkspaceRoutes(app)'))
const now = new Date().toISOString(), future = new Date(Date.now() + 30 * 86400000).toISOString()
const users = { outsider: { id: 'outsider', nickname: '外部用户', planId: 'free', status: 'active' } }, organizations = {}, shares = [], collections = []
for (const name of ['accept', 'decline', 'cancel', 'expire', 'disabled-target', 'disabled-owner', 'removed', 'leave', 'dissolve', 'restart', 'race']) {
  const members = ['owner', 'target', 'admin', 'peer'].map(role => {
    const id = `${name}-${role}`
    users[id] = { id, username: id, nickname: role === 'owner' ? '原负责人' : role === 'target' ? '新负责人' : role, planId: role === 'owner' ? 'enterprise' : 'free', status: 'active', organizationId: name, organizationRole: role === 'target' || role === 'peer' ? 'member' : role }
    return { id: `m-${id}`, userId: id, displayName: users[id].nickname, status: 'active', role: users[id].organizationRole, joinedAt: now }
  })
  organizations[name] = { id: name, name: `交接验收 ${name}`, slug: `${name}-slug`, ownerUserId: `${name}-owner`, teamPlanId: 'enterprise', teamPlanStartedAt: now, teamPlanPermanent: true, createdAt: now, updatedAt: now, members }
  shares.push({ id: `${name}-file`, code: `${name}file`.replaceAll('-', '').toUpperCase(), manageToken: `${name}-manage`, ownerUserId: `${name}-peer`, teamResource: true, teamOrganizationId: name, status: 'active', createdAt: now, expiresAt: future, files: [{ name: '验收文件.txt', storedName: 'fixture.txt', size: 7, mimeType: 'text/plain', reviewStatus: 'clean', scanEngine: 'clamav', scannedAt: now }] })
  collections.push({ id: `${name}-task`, token: `${name}-task`, manageToken: `${name}-task-manage`, ownerUserId: `${name}-owner`, title: '个人任务归属保持', deadline: future, maxFileSizeMb: 10, allowedTypes: ['全部格式'], submissions: [], createdAt: now })
}
const metadataFile = path.join(fixture, 'storage', 'metadata.json')
fs.mkdirSync(path.dirname(metadataFile), { recursive: true })
fs.writeFileSync(metadataFile, JSON.stringify({ users, organizations, shares, collections, messages: {}, notificationSettings: { 'accept-target': { inApp: false } }, sessions: Object.values(users).flatMap(user => [1, 2].map(index => ({ id: `${user.id}-session-${index}`, user, expiresAt: future }))) }))
for (const share of shares) {
  const directory = path.join(fixture, 'storage', 'files', share.id)
  fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(path.join(directory, 'fixture.txt'), 'fixture')
}
const cleanEnv = { ...process.env }
for (const key of Object.keys(cleanEnv)) if (/^(KUNQIONG_|OAUTH_)/.test(key)) delete cleanEnv[key]
let child, base, stderr = '', passed = 0
const cases = []
async function start() {
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve)); base = `http://127.0.0.1:${port}`
  child = spawn(process.execPath, ['server.mjs'], { cwd: fixture, windowsHide: true, env: { ...cleanEnv, PORT: String(port), NODE_ENV: 'production', KUNQIONG_HOST: '127.0.0.1', KUNQIONG_DB_ENABLED: 'false', KUNQIONG_SCAN_MODE: 'required' }, stdio: ['ignore', 'ignore', 'pipe'] })
  child.stderr.on('data', data => { stderr += data })
  for (let index = 0; index < 120; index++) { try { if ((await fetch(base + '/api/health')).ok) return } catch {} await delay(50) }
  throw new Error(stderr || 'Fixture did not start')
}
async function stop() { if (!child || child.exitCode !== null) return; const exited = once(child, 'exit'); child.kill(); await Promise.race([exited, delay(3000)]) }
const stored = () => readFixtureMetadata(metadataFile)
async function api(url, user = 'accept-owner', method = 'GET', body, session = 1) {
  const response = await fetch(base + url, { method, headers: { ...(user ? { cookie: `kunqiong_session=${user}-session-${session}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: response.status, data: await response.json() }
}
function check(label, condition) { assert.ok(condition, label); passed++; console.log('PASS ' + label) }
async function group(id, run) { await run(); cases.push({ id, status: 'PASS' }) }
const initiate = (name, target = 'target', actor = 'owner') => api('/api/account/workspace/transfer-ownership', `${name}-${actor}`, 'POST', { targetMemberId: `m-${name}-${target}` })
const decide = (id, user, decision, session) => api(`/api/account/workspace/ownership-handovers/${id}`, user, 'POST', { decision }, session)
const controlFixture = body => api('/__handover_fixture', 'outsider', 'POST', body)
try {
  await start()
  await group('HANDOVER-AUTH', async () => {
    check('游客不能发起', (await api('/api/account/workspace/transfer-ownership', '', 'POST', { targetMemberId: 'm-accept-target' })).status === 401)
    for (const role of ['target', 'peer', 'admin']) check(`${role}不能发起所有权交接`, (await initiate('accept', 'target', role)).status === 403)
    for (const targetMemberId of ['m-accept-owner', 'm-decline-target', 'missing', ['m-accept-target'], 'x'.repeat(81)]) {
      check('非法接收者明确拒绝 ' + JSON.stringify(targetMemberId), (await api('/api/account/workspace/transfer-ownership', 'accept-owner', 'POST', { targetMemberId })).status === 400)
    }
    check('非法请求不创建交接', stored().organizations.accept.ownershipHandovers.length === 0)
  })
  await group('HANDOVER-ACCEPT', async () => {
    const before = stored(), result = await initiate('accept'), id = result.data.handover.id
    check('发起仅产生待确认状态', result.status === 201 && result.data.handover.status === 'pending' && result.data.transferred === false && stored().organizations.accept.ownerUserId === 'accept-owner')
    check('关闭通知仍收到授权待办', (await api('/api/account/messages', 'accept-target')).data.messages.some(message => message.actionId === id && message.actionType === 'workspace_ownership_handover'))
    check('待确认时接收者仍无管理权限', !(await api('/api/account/team/overview', 'accept-target')).data.canManage)
    const retry = await initiate('accept')
    check('同一目标重试复用待办', retry.status === 200 && retry.data.reused && retry.data.handover.id === id && stored().organizations.accept.ownershipHandovers.length === 1)
    check('同时不能再交给其他成员', (await initiate('accept', 'peer')).status === 409)
    check('普通成员看不到他人交接', !(await api('/api/account/team/overview', 'accept-peer')).data.organization.ownershipHandover)
    check('管理员不能代接收者确认', (await decide(id, 'accept-admin', 'accept')).status === 404)
    check('跨团队不能处理', (await decide(id, 'decline-target', 'accept')).status === 404)
    check('发起者不能自我确认', (await decide(id, 'accept-owner', 'accept')).status === 403)
    check('接收者不能取消发起者待办', (await decide(id, 'accept-target', 'cancel')).status === 403)
    check('未知决定不改变状态', (await decide(id, 'accept-target', 'unknown')).status === 400 && stored().organizations.accept.ownerUserId === 'accept-owner')
    const accepted = await decide(id, 'accept-target', 'accept'), after = stored()
    check('指定成员确认后完成交接', accepted.status === 200 && accepted.data.transferred && after.organizations.accept.ownerUserId === 'accept-target')
    check('团队恰好一位所有者', after.organizations.accept.members.filter(member => member.role === 'owner').length === 1)
    for (const session of [1, 2]) {
      check(`旧所有者会话${session}立即失去团队管理权`, !(await api('/api/account/team/overview', 'accept-owner', 'GET', undefined, session)).data.canManage)
      check(`新所有者会话${session}获得管理权`, (await api('/api/account/team/overview', 'accept-target', 'GET', undefined, session)).data.canManage)
    }
    check('旧所有者不能管理他人团队文件', (await api('/api/shares/manage/accept-manage', 'accept-owner')).status === 403)
    check('新所有者可管理团队文件', (await api('/api/shares/manage/accept-manage', 'accept-target')).status === 200)
    check('团队文件归属和组织标识保持', JSON.stringify(after.shares.find(item => item.id === 'accept-file')) === JSON.stringify(before.shares.find(item => item.id === 'accept-file')))
    check('个人收集任务归属不被错误转移', after.collections.find(item => item.id === 'accept-task').ownerUserId === 'accept-owner')
    const workspace = (await api('/api/account/workspace', 'accept-target')).data
    check('新负责人个人套餐独立且组织容量保留', workspace.plan.id === 'free' && workspace.teamEntitlement.canUseTeamSpace && workspace.teamEntitlement.teamSpaceBytes === 1024 ** 4)
    check('原所有者不能继续改团队名称', (await api('/api/account/workspace', 'accept-owner', 'PATCH', { name: '无权限改名' })).status === 403)
    check('接受结果丢失后重试不重复交接', (await decide(id, 'accept-target', 'accept')).data.reused === true && stored().organizations.accept.ownershipHandovers.length === 1)
    check('接受后不可再拒绝', (await decide(id, 'accept-target', 'decline')).status === 409)
    const history = workspace.organization.ownershipHandoverHistory[0]
    check('历史记录包含双方身份和时间', history.fromUserId === 'accept-owner' && history.toUserId === 'accept-target' && history.initiatedAt && history.resolvedAt && history.status === 'accepted')
    check('原消息变为已处理', !(await api('/api/account/messages', 'accept-target')).data.messages.some(message => message.actionType === 'workspace_ownership_handover' && message.actionId === id))
  })
  await group('HANDOVER-DECLINE-CANCEL', async () => {
    for (const [name, decision, role, status] of [['decline', 'decline', 'target', 'declined'], ['cancel', 'cancel', 'owner', 'canceled']]) {
      const id = (await initiate(name)).data.handover.id
      check(`${decision}成功并留痕`, (await decide(id, `${name}-${role}`, decision)).status === 200 && stored().organizations[name].ownershipHandovers[0].status === status)
      check(`${decision}不改变负责人`, stored().organizations[name].ownerUserId === `${name}-owner`)
      check(`${decision}可安全重试`, (await decide(id, `${name}-${role}`, decision)).data.reused === true)
      check(`${decision}之后旧按钮不能接管`, (await decide(id, `${name}-target`, 'accept')).status === 409)
      check(`${decision}后可重新发起`, (await initiate(name)).status === 201)
    }
  })
  await group('HANDOVER-INVALIDATION', async () => {
    for (const name of ['disabled-target', 'disabled-owner', 'removed', 'leave', 'expire']) {
      const id = (await initiate(name)).data.handover.id
      if (name.startsWith('disabled')) await controlFixture({ status: { id: name + (name === 'disabled-target' ? '-target' : '-owner'), value: 'disabled' } })
      if (name === 'removed') await api('/api/account/workspace/members/m-removed-target', 'removed-owner', 'DELETE')
      if (name === 'leave') await api('/api/account/workspace/leave', 'leave-target', 'POST', {})
      if (name === 'expire') await controlFixture({ expire: name })
      const result = await decide(id, `${name}-target`, 'accept')
      check(`${name}不能接管团队`, [401, 409, 410].includes(result.status) && stored().organizations[name].ownerUserId === `${name}-owner`)
      await api('/api/account/team/overview', `${name}-admin`)
      const handover = stored().organizations[name].ownershipHandovers[0]
      check(`${name}记录失效原因和时间`, ['invalidated', 'expired'].includes(handover.status) && handover.reason && handover.resolvedAt)
    }
    check('已禁用成员无法发起新交接目标', (await initiate('disabled-target')).status === 400)
  })
  await group('HANDOVER-RESTART', async () => {
    const id = (await initiate('restart')).data.handover.id
    await stop(); await start()
    check('重启后待办和原权限保留', (await api('/api/account/team/overview', 'restart-target')).data.organization.ownershipHandover.id === id && stored().organizations.restart.ownerUserId === 'restart-owner')
    check('重启后可继续接受', (await decide(id, 'restart-target', 'accept')).status === 200)
    await stop(); await start()
    check('再次重启后完成状态和权限保留', stored().organizations.restart.ownerUserId === 'restart-target' && (await api('/api/account/team/overview', 'restart-target')).data.organization.ownershipHandoverHistory[0].status === 'accepted')
  })
  await group('HANDOVER-CONCURRENCY', async () => {
    const id = (await initiate('race')).data.handover.id
    const results = await Promise.all([decide(id, 'race-target', 'accept'), decide(id, 'race-target', 'decline'), decide(id, 'race-owner', 'cancel')])
    check('接受拒绝取消并发只有一个决定成功', results.filter(result => result.status === 200).length === 1)
    check('并发后仅一个所有者和一条终态记录', stored().organizations.race.members.filter(member => member.role === 'owner').length === 1 && stored().organizations.race.ownershipHandovers.length === 1 && stored().organizations.race.ownershipHandovers[0].status !== 'pending')
  })
  await group('HANDOVER-DISSOLVE', async () => {
    const id = (await initiate('dissolve')).data.handover.id
    check('待确认期间仍可由所有者解散', (await api('/api/account/workspace/dissolve', 'dissolve-owner', 'POST', {})).status === 200)
    check('解散后旧待办不可接管', (await decide(id, 'dissolve-target', 'accept')).status === 404)
    check('解散后待办消息已关闭', !(await api('/api/account/messages', 'dissolve-target')).data.messages.some(message => message.actionId === id && message.actionType === 'workspace_ownership_handover'))
    check('解散中止交接仍有审计记录', stored().auditLogs.some(log => log.details?.handoverId === id && log.details.status === 'canceled'))
  })
} finally { await stop() }
const report = { executedAt: new Date().toISOString(), passed, cases, fixture, environment: 'Disposable real HTTP server; JSON persistence; synthetic accounts and resources' }
const evidence = path.join(root, '.workbuddy', 'team-handover')
fs.mkdirSync(evidence, { recursive: true }); fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
