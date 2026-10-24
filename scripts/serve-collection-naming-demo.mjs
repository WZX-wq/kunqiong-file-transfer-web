// Isolated browser demo with a synthetic collection and local protocol scanner.
// It never reads the project .env, database, or live storage.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-collection-naming-demo-'))
const port = Number(process.env.COLLECTION_NAMING_DEMO_PORT || 18049)
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid demo port')
if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) throw new Error('请先运行 npx vite build')

function copyDirectory(source, target) {
  fs.mkdirSync(target, { recursive: true })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name), to = path.join(target, entry.name)
    if (entry.isDirectory()) copyDirectory(from, to)
    else if (entry.isFile()) fs.copyFileSync(from, to)
  }
}

for (const directory of ['server', 'dist']) copyDirectory(path.join(root, directory), path.join(fixture, directory))
fs.copyFileSync(path.join(root, 'package.json'), path.join(fixture, 'package.json'))
fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')

const scanServer = net.createServer((socket) => {
  let input = Buffer.alloc(0), command = false, finished = false
  socket.on('error', () => {})
  socket.on('data', (chunk) => {
    input = Buffer.concat([input, chunk])
    if (!command) {
      const end = input.indexOf(0)
      if (end < 0) return
      input = input.subarray(end + 1)
      command = true
    }
    while (input.length >= 4 && !finished) {
      const length = input.readUInt32BE(0)
      if (input.length < 4 + length) break
      input = input.subarray(4 + length)
      if (!length) { finished = true; socket.end('stream: OK\0') }
    }
  })
})
await new Promise((resolve) => scanServer.listen(0, '127.0.0.1', resolve))

const now = new Date().toISOString(), deadline = new Date(Date.now() + 7 * 86400000).toISOString()
const user = { id: 'naming-owner', username: 'naming-demo-owner', nickname: '命名验收提交人', status: 'active', planId: 'free' }
const task = {
  id: 'collection-naming-demo', token: 'collection-naming-demo', manageToken: 'collection-naming-demo-manage',
  ownerUserId: user.id, ownerGuestKey: '', title: '文件命名规则验收',
  description: '请上传测试文件，检查逐文件命名预览、提交结果和打包下载。', deadline,
  allowedTypes: ['全部格式'], maxFileSizeMb: 10, capacityBytes: null, status: 'active',
  materials: [{ id: 'naming-material', name: '验收材料', required: true, namingPattern: '{提交人}_{材料项}_{原文件名}' }],
  customFields: [], submissions: [], createdAt: now,
}
fs.mkdirSync(path.join(fixture, 'storage'), { recursive: true })
fs.writeFileSync(path.join(fixture, 'storage', 'metadata.json'), JSON.stringify({
  users: { [user.id]: user },
  sessions: [{ id: 'naming-demo-session', user, expiresAt: deadline }],
  shares: [], collections: [task], messages: {}, auditLogs: [],
}))

const entry = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>文件命名规则验收</title><style>body{max-width:760px;margin:40px auto;padding:20px;font:17px/1.7 system-ui;color:#17212f}h1{font-size:28px}a{display:block;padding:12px 15px;margin:10px 0;background:#eff5ff;color:#1759bd;border-radius:7px;text-decoration:none}small{color:#526174}</style><h1>文件命名规则验收</h1><p>独立临时目录、合成账号和本地扫描模拟器，不连接真实账号、数据库或正式文件。</p><a href="/__naming_demo/login">以合成所有者身份打开提交页</a><a href="/collect/manage/collection-naming-demo-manage">打开收集管理页</a><p><small>先提交测试文件，再打开管理页检查提交名称、原文件名及 ZIP。重启脚本会重置临时验收数据。杀毒扫描由本机协议模拟器返回通过，不属于病毒检测验收。</small></p></html>'
const fixtureRoutes = `
app.get('/__naming_demo', (_req, res) => res.type('html').send(${JSON.stringify(entry)}));
app.get('/__naming_demo/login', (_req, res) => {
 res.setHeader('Set-Cookie', 'kunqiong_session=naming-demo-session; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400');
 res.redirect('/collect/collection-naming-demo');
});
`
const serverSource = fs.readFileSync(path.join(root, 'server.mjs'), 'utf8').replace('registerWorkspaceRoutes(app)', fixtureRoutes + '\nregisterWorkspaceRoutes(app)')
fs.writeFileSync(path.join(fixture, 'server.mjs'), serverSource)

const env = { ...process.env }
for (const key of Object.keys(env)) if (/^(KUNQIONG_|OAUTH_)/.test(key)) delete env[key]
const child = spawn(process.execPath, ['server.mjs'], {
  cwd: fixture, windowsHide: true,
  env: { ...env, PORT: String(port), NODE_ENV: 'production', KUNQIONG_HOST: '127.0.0.1', KUNQIONG_DB_ENABLED: 'false', KUNQIONG_SCAN_MODE: 'required', KUNQIONG_CLAMAV_HOST: '127.0.0.1', KUNQIONG_CLAMAV_PORT: String(scanServer.address().port), KUNQIONG_RELEASE_SHA: 'collection-naming-demo' },
  stdio: ['ignore', 'inherit', 'inherit'],
})
console.log(JSON.stringify({ url: `http://localhost:${port}/__naming_demo`, fixture, syntheticAccountsOnly: true }))
const close = () => { child.kill(); scanServer.close() }
process.on('SIGINT', close)
process.on('SIGTERM', close)
child.on('exit', (code) => { process.exitCode = code || 0; scanServer.close() })
