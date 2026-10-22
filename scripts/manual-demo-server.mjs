// Isolated current-UI fixture. Never reads or writes the application's storage.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import sharp from 'sharp'
import { createCollectionRecord, createShareRecord } from '../src/lib/records.js'

const root = path.resolve(import.meta.dirname, '..')
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-manual-'))
const port = Number(process.env.KUNQIONG_MANUAL_DEMO_PORT || 8118)
const copyDirectory = (from, to) => {
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name)
    const target = path.join(to, entry.name)
    if (entry.isDirectory()) copyDirectory(source, target)
    else fs.copyFileSync(source, target)
  }
}
copyDirectory(path.join(root, 'server'), path.join(sandbox, 'server'))
fs.symlinkSync(path.join(root, 'node_modules'), path.join(sandbox, 'node_modules'), 'junction')
fs.symlinkSync(path.join(root, 'dist'), path.join(sandbox, 'dist'), 'junction')
fs.mkdirSync(path.join(sandbox, 'storage'))
const now = new Date().toISOString()
const expires = new Date(Date.now() + 180 * 86400000).toISOString()
const expiredAt = new Date(Date.now() - 86400000).toISOString()
const user = (id, nickname, planId, role = '', organizationId = 'manual-team') => ({ id, nickname, username: id, email: `${id}@example.com`, phone: '', avatar: null, loginMethods: ['password'], planId, planStartedAt: now, planExpiresAt: expires, organizationId: role ? organizationId : '', organizationRole: role, status: 'active', createdAt: now, updatedAt: now })
const users = {
  owner: user('owner', '演示用户', 'halfyear', 'owner'),
  member: user('member', '协作成员', 'free', 'member'),
  applicant: user('applicant', '新同事', 'free'),
  expiredOwner: user('expired-owner', '到期团队所有者', 'team', 'owner', 'expired-team'),
  expiredMember: user('expired-member', '到期团队成员', 'free', 'member', 'expired-team'),
}
users.expiredOwner.planExpiresAt = expiredAt
fs.writeFileSync(path.join(sandbox, 'storage/metadata.json'), JSON.stringify({
  users,
  sessions: Object.values(users).map(user => ({ id: `manual-${user.id}`, user, createdAt: now, expiresAt: expires, apiWebToken: '' })),
  organizations: {
    'manual-team': { id: 'manual-team', slug: 'manual-team', name: '产品协作团队', ownerUserId: 'owner', teamPlanId: 'halfyear', teamPlanStartedAt: now, teamPlanExpiresAt: expires, createdAt: now, updatedAt: now, members: ['owner', 'member'].map(id => ({ id: `m-${id}`, userId: id, role: id === 'owner' ? 'owner' : 'member', status: 'active', displayName: users[id].nickname, email: users[id].email, joinedAt: now })) },
    'expired-team': { id: 'expired-team', slug: 'expired-team', name: '产品协作团队', ownerUserId: 'expired-owner', teamPlanId: 'team', teamPlanStartedAt: now, teamPlanExpiresAt: expiredAt, createdAt: now, updatedAt: now, members: ['expired-owner', 'expired-member'].map(id => ({ id: `m-${id}`, userId: id, role: id === 'expired-owner' ? 'owner' : 'member', status: 'active', displayName: users[id === 'expired-owner' ? 'expiredOwner' : 'expiredMember'].nickname, email: users[id === 'expired-owner' ? 'expiredOwner' : 'expiredMember'].email, joinedAt: now })) },
  },
  shares: [], collections: [], records: [], messages: {}, uploadSessions: {}, auditLogs: [], joinRequests: [], upgradeOrders: [
    {
      id: 'manual-canceled-order', userId: 'owner', orderNo: 'WM1-MANUAL-CANCELED-001', planId: 'member', amount: 1900,
      payType: 1, status: 'canceled', remoteOrderNo: '', createdAt: new Date(Date.now() - 86400000).toISOString(), updatedAt: now,
    },
    {
      id: 'manual-linked-canceled-order', userId: 'owner', orderNo: 'WM1-MANUAL-LINKED-002', planId: 'halfyear', amount: 7900,
      payType: 1, status: 'canceled', remoteOrderNo: 'PAY-MANUAL-002', createdAt: new Date(Date.now() - 2 * 86400000).toISOString(), updatedAt: now,
    },
  ], verificationCodes: [], guestUsage: {}, systemConfig: {},
}, null, 2))
let serverSource = fs.readFileSync(path.join(root, 'server.mjs'), 'utf8')
// This route exists only in the copied fixture server bound to loopback.
serverSource = serverSource.replace("app.set('trust proxy', 'loopback')", `app.get('/__manual/:role', (req, res) => {
  const role = req.params.role
  if (!['owner', 'member', 'applicant', 'guest', 'expired-owner', 'expired-member'].includes(role)) return res.sendStatus(404)
  res.cookie('kunqiong_session', role === 'guest' ? '' : 'manual-' + role, { httpOnly: true, sameSite: 'lax' })
  res.redirect('/')
})\napp.set('trust proxy', 'loopback')`)
fs.writeFileSync(path.join(sandbox, 'server.mjs'), serverSource)
const server = spawn(process.execPath, ['server.mjs'], { cwd: sandbox, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', KUNQIONG_DB_ENABLED: 'false', NODE_ENV: 'production', KUNQIONG_SCAN_MODE: 'required', KUNQIONG_CLAMAV_HOST: '127.0.0.1', KUNQIONG_CLAMAV_PORT: '3310', KUNQIONG_SMTP_HOST: '', KUNQIONG_WEB_MEMBER_API_BASE: 'http://127.0.0.1:1' }, stdio: ['ignore', 'pipe', 'pipe'] })
server.stdout.pipe(process.stdout)
server.stderr.pipe(process.stderr)
process.on('SIGINT', () => { server.kill(); process.exit() })
process.on('SIGTERM', () => { server.kill(); process.exit() })
const base = `http://127.0.0.1:${port}`
for (let attempt = 0; attempt < 100; attempt++) {
  try { if ((await fetch(`${base}/api/health`)).ok) break } catch {}
  await new Promise(resolve => setTimeout(resolve, 200))
}
const api = async (url, role, init = {}) => {
  const response = await fetch(`${base}${url}`, { ...init, headers: { Cookie: `kunqiong_session=manual-${role}`, ...init.headers } })
  const data = await response.json()
  if (!response.ok) throw new Error(`${url}: ${response.status} ${JSON.stringify(data)}`)
  return data
}
const image = await sharp(path.join(root, 'public/app-icon.png')).resize(640, 640).png().toBuffer()
const share = async (role, password = '') => {
  const form = new FormData()
  form.append('files', new File(['项目计划\n一、整理素材\n二、评审交付\n'], '项目计划.txt', { type: 'text/plain' }))
  form.append('files', new File([image], '产品图标.png', { type: 'image/png' }))
  form.append('expiryDays', '7')
  if (password) form.append('password', password)
  return (await api('/api/shares', role, { method: 'POST', body: form })).share
}
try {
  const shared = await share('owner')
  const protectedShare = await share('owner', 'Demo2026')
  const incoming = await share('member')
  const { collection } = await api('/api/collections', 'owner', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '活动素材收集', description: '请提交活动素材，文件名使用姓名和内容', deadline: new Date(Date.now() + 7 * 86400000).toISOString(), maxFileSizeMb: 500 }) })
  for (const [role, name] of [['member', '协作成员'], ['guest', '外部协作者']]) {
    const form = new FormData()
    form.append('participantName', name)
    form.append('files', new File([image], `${name}-素材.png`, { type: 'image/png' }))
    await api(`/api/collections/${collection.token}/submissions`, role, { method: 'POST', body: form })
  }
  // Record helpers use the browser origin only to construct management URLs.
  globalThis.window = { location: { origin: base } }
  const managed = await api(`/api/collections/manage/${collection.manageToken}`, 'owner')
  await api('/api/account/records', 'owner', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: [createShareRecord(shared), createShareRecord(protectedShare), createShareRecord(incoming, 'sent_to_me'), createCollectionRecord(managed.collection)] }),
  })
  delete globalThis.window
  const fixture = { base, sandbox, shared, protectedShare, incoming, collection }
  fs.writeFileSync(path.join(sandbox, 'fixture.json'), JSON.stringify(fixture, null, 2))
  console.log('MANUAL_FIXTURE ' + JSON.stringify({ base, sandbox, shareId: shared.id, shareManage: shared.manageToken, passwordId: protectedShare.id, collectionToken: collection.token, collectionManage: collection.manageToken }))
} catch (error) { server.kill(); throw error }
