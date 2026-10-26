// 仅在临时副本启动合成账号验收站点，不读取 .env、不使用真实 storage。
// 先运行 npx vite build，再执行 node scripts/serve-team-handover-demo.mjs。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-handover-demo-'))
const port = Number(process.env.HANDOVER_DEMO_PORT || 18047)
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid demo port')
function copyDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: true })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name), to = path.join(destination, entry.name)
    if (entry.isDirectory()) copyDirectory(from, to)
    else if (entry.isFile()) fs.copyFileSync(from, to)
  }
}
if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) throw new Error('请先运行 npx vite build')
for (const directory of ['server', 'dist']) copyDirectory(path.join(root, directory), path.join(fixture, directory))
fs.copyFileSync(path.join(root, 'package.json'), path.join(fixture, 'package.json'))
fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
const now = new Date().toISOString(), expiresAt = new Date(Date.now() + 86400000).toISOString()
const users = Object.fromEntries([['owner', '原负责人'], ['recipient', '新负责人'], ['peer', '普通成员']].map(([id, nickname]) => [id, { id, username: `handover-demo-${id}`, nickname, status: 'active', planId: id === 'owner' ? 'enterprise' : 'free', organizationId: 'handover-demo', organizationRole: id === 'owner' ? 'owner' : 'member' }]))
const organization = { id: 'handover-demo', name: '负责人交接验收团队', slug: 'handover-demo', ownerUserId: 'owner', teamPlanId: 'enterprise', teamPlanPermanent: true, teamPlanStartedAt: now, createdAt: now, updatedAt: now, members: Object.values(users).map(user => ({ id: `demo-member-${user.id}`, userId: user.id, displayName: user.nickname, role: user.organizationRole, status: 'active', joinedAt: now })) }
const file = { name: '交接验收说明.txt', storedName: 'fixture.txt', size: 24, mimeType: 'text/plain', reviewStatus: 'clean', scanEngine: 'clamav', scannedAt: now }
fs.mkdirSync(path.join(fixture, 'storage', 'files', 'demo-share'), { recursive: true })
fs.writeFileSync(path.join(fixture, 'storage', 'files', 'demo-share', 'fixture.txt'), 'Synthetic handover file\n')
fs.writeFileSync(path.join(fixture, 'storage', 'metadata.json'), JSON.stringify({
  users, organizations: { [organization.id]: organization }, messages: {},
  sessions: Object.values(users).map(user => ({ id: `handover-demo-${user.id}`, user, expiresAt })),
  shares: [{ id: 'demo-share', code: 'HDTEST', manageToken: 'demo-share-manage', ownerUserId: 'peer', teamOrganizationId: organization.id, teamResource: true, status: 'active', files: [file], createdAt: now, expiresAt }], collections: [],
}))
const fixtureRoutes = `
app.get('/__handover_demo', (_req, res) => res.type('html').send('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>交接隔离验收入口</title><style>body{max-width:680px;margin:60px auto;padding:24px;font:18px/1.8 system-ui;color:#17212f}a{display:block;padding:14px 18px;margin:14px 0;background:#eef4ff;color:#1759bd;border-radius:10px}small{color:#536175}</style><h1>负责人交接验收</h1><p>临时合成团队与账号，不连接真实账号和文件</p><a href="/__handover_demo/login/owner">以原负责人身份进入</a><a href="/__handover_demo/login/recipient">以新负责人身份进入</a><a href="/__handover_demo/login/peer">以普通成员身份进入</a><small>先以原负责人在团队成员页发起交接，再切换新负责人接受或拒绝；重新启动此脚本可创建一套全新的临时数据</small></html>'));
app.get('/__handover_demo/login/:role', (req, res) => {
 if (!['owner','recipient','peer'].includes(req.params.role)) return res.sendStatus(404);
 res.setHeader('Set-Cookie', 'kunqiong_session=handover-demo-' + req.params.role + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400');
 res.redirect('/team?tab=members');
});
`
fs.writeFileSync(path.join(fixture, 'server.mjs'), fs.readFileSync(path.join(root, 'server.mjs'), 'utf8').replace('registerWorkspaceRoutes(app)', fixtureRoutes + '\nregisterWorkspaceRoutes(app)'))
const env = { ...process.env }
for (const key of Object.keys(env)) if (/^(KUNQIONG_|OAUTH_)/.test(key)) delete env[key]
const child = spawn(process.execPath, ['server.mjs'], { cwd: fixture, windowsHide: true, env: { ...env, PORT: String(port), NODE_ENV: 'production', KUNQIONG_DB_ENABLED: 'false', KUNQIONG_HOST: '127.0.0.1', KUNQIONG_SCAN_MODE: 'required', KUNQIONG_RELEASE_SHA: 'handover-demo' }, stdio: ['ignore', 'inherit', 'inherit'] })
console.log(JSON.stringify({ url: `http://localhost:${port}/__handover_demo`, fixture, syntheticAccountsOnly: true }))
process.on('SIGINT', () => child.kill())
process.on('SIGTERM', () => child.kill())
child.on('exit', code => { process.exitCode = code || 0 })
