// 仅启动临时合成账号验收站，不读 .env，不使用真实 storage/数据库。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..'), fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-branding-demo-'))
const port = Number(process.env.BRANDING_DEMO_PORT || 18048)
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid demo port')
function copy(from, to) { fs.mkdirSync(to, { recursive: true }); for (const entry of fs.readdirSync(from, { withFileTypes: true })) { if (entry.isDirectory()) copy(path.join(from, entry.name), path.join(to, entry.name)); else if (entry.isFile()) fs.copyFileSync(path.join(from, entry.name), path.join(to, entry.name)) } }
if (!fs.existsSync(path.join(root, 'dist/index.html'))) throw new Error('请先运行 npx vite build')
for (const dir of ['server', 'dist']) copy(path.join(root, dir), path.join(fixture, dir))
fs.copyFileSync(path.join(root, 'package.json'), path.join(fixture, 'package.json'))
fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
const now = new Date().toISOString(), future = new Date(Date.now() + 7 * 86400000).toISOString()
const users = Object.fromEntries([['owner', '团队所有者'], ['admin', '团队管理员'], ['member', '普通成员']].map(([id, nickname]) => [id, { id, username: `branding-demo-${id}`, nickname, status: 'active', planId: id === 'owner' ? 'enterprise' : 'free', organizationId: 'branding-demo', organizationRole: id }]))
const organization = { id: 'branding-demo', name: '团队品牌验收团队', slug: 'branding-demo', ownerUserId: 'owner', teamPlanId: 'enterprise', teamPlanPermanent: true, createdAt: now, updatedAt: now, members: Object.values(users).map(user => ({ id: `m-${user.id}`, userId: user.id, displayName: user.nickname, role: user.organizationRole, status: 'active', joinedAt: now })) }
const content = Buffer.from('Synthetic branding acceptance file\n')
const shares = ['public', 'team'].map(kind => ({ id: `branding-${kind}`, code: kind === 'public' ? 'BRAND1' : 'BRAND2', manageToken: `branding-${kind}-manage`, ownerUserId: 'owner', brandingOrganizationId: organization.id, teamResource: kind === 'team', teamOrganizationId: kind === 'team' ? organization.id : '', status: 'active', createdAt: now, expiresAt: future, files: [{ name: '品牌展示验收.txt', relativePath: '品牌展示验收.txt', storedName: 'fixture.txt', size: content.length, mimeType: 'text/plain', reviewStatus: 'clean', scanEngine: 'clamav', scannedAt: now }] }))
for (const share of shares) { const dir = path.join(fixture, 'storage/files', share.id); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'fixture.txt'), content) }
const task = { id: 'branding-task', token: 'branding-task', manageToken: 'branding-task-manage', ownerUserId: 'owner', brandingOrganizationId: organization.id, title: '培训报名材料收集', description: '请核对收集方后上传材料。本页面使用合成测试数据。', deadline: future, maxFileSizeMb: 10, allowedTypes: ['全部格式'], submissions: [], createdAt: now, status: 'active', materials: [], customFields: [] }
fs.writeFileSync(path.join(fixture, 'storage/metadata.json'), JSON.stringify({ users, organizations: { [organization.id]: organization }, shares, collections: [task], messages: {}, sessions: Object.values(users).map(user => ({ id: `branding-demo-${user.id}`, user, expiresAt: future })) }))
const links = '<h2>选择测试身份</h2><a href="/__branding_demo/login/owner">以团队所有者身份进入</a><a href="/__branding_demo/login/admin">以团队管理员身份进入</a><a href="/__branding_demo/login/member">以普通成员身份进入</a><h2>检查展示效果</h2><a href="/e/branding-demo/share/branding-public">专属分享页</a><a href="/e/branding-demo/collect/branding-task">专属收集页</a><a href="/collect/branding-task">普通收集页（默认展示对照）</a><a href="/share/branding-team">团队文件（仍要求成员登录）</a><a href="/__branding_demo/guest">未登录查看专属收集页</a>'
const entry = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>团队品牌隔离验收</title><style>body{max-width:780px;margin:36px auto;padding:20px;font:17px/1.7 system-ui;color:#17212f;background:#fff}h1{font-size:28px}h2{font-size:19px;margin-top:26px}a{display:block;padding:11px 15px;margin:8px 0;background:#eff5ff;color:#1759bd;border-radius:9px;text-decoration:none}a:hover{background:#dfeaff}a:focus-visible{outline:2px solid #2563eb}small{color:#526174}</style><h1>团队品牌展示验收</h1><p>独立临时目录、合成账号及示例文件，不连接真实团队或数据库</p>${links}<p><small>先以所有者保存品牌，再查看分享页和收集页；切换身份使用同一浏览器 Cookie。需要同时测试冲突时，在另一浏览器或隐私窗口打开此入口。重启本脚本会创建全新的测试数据。</small></p></html>`
const fixtureRoutes = `
app.get('/__branding_demo', (_req,res)=>res.type('html').send(${JSON.stringify(entry)}));
app.get('/__branding_demo/login/:role',(req,res)=>{
 if(!['owner','admin','member'].includes(req.params.role)) return res.sendStatus(404);
 res.setHeader('Set-Cookie','kunqiong_session=branding-demo-'+req.params.role+'; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800');
 res.redirect('/team?tab=branding');
});
app.get('/__branding_demo/guest',(_req,res)=>{res.setHeader('Set-Cookie','kunqiong_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');res.redirect('/e/branding-demo/collect/branding-task')});
`
fs.writeFileSync(path.join(fixture, 'server.mjs'), fs.readFileSync(path.join(root, 'server.mjs'), 'utf8').replace('registerWorkspaceRoutes(app)', fixtureRoutes + '\nregisterWorkspaceRoutes(app)'))
const env = { ...process.env }; for (const key of Object.keys(env)) if (/^(KUNQIONG_|OAUTH_)/.test(key)) delete env[key]
const child = spawn(process.execPath, ['server.mjs'], { cwd: fixture, windowsHide: true, env: { ...env, PORT: String(port), NODE_ENV: 'production', KUNQIONG_HOST: '127.0.0.1', KUNQIONG_DB_ENABLED: 'false', KUNQIONG_SCAN_MODE: 'required', KUNQIONG_RELEASE_SHA: 'branding-demo' }, stdio: ['ignore', 'inherit', 'inherit'] })
console.log(JSON.stringify({ url: `http://localhost:${port}/__branding_demo`, fixture, syntheticAccountsOnly: true }))
process.on('SIGINT', () => child.kill()); process.on('SIGTERM', () => child.kill()); child.on('exit', code => { process.exitCode = code || 0 })
