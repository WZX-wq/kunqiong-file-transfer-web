// 端到端：真实 server + 真实重启（两次 listen），确认自定义头像跨重启存活。
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const ROOT = 'C:\\Users\\admin\\Desktop\\鲲穹文件传输web'
const NODE = 'C:/Users/admin/.workbuddy/binaries/node/versions/22.22.2-3/node.exe'
const SANDBOX = path.join(ROOT, '_avatar_e2e_sandbox')
const PORT = 8106
const LOG = path.join(ROOT, '_avatar_e2e.txt')

const out = []
let pass = 0, fail = 0
const trace = (s) => { fs.appendFileSync(path.join(ROOT, '_avatar_e2e_trace.txt'), `${Date.now()} ${s}\n`) }
try { fs.writeFileSync(path.join(ROOT, '_avatar_e2e_trace.txt'), '') } catch {}
const line = (s) => { out.push(s); trace('LINE: ' + s); fs.writeFileSync(LOG, out.join('\n')) }
const check = (n, c, d) => { c ? pass++ : fail++; line(`  ${c ? 'PASS' : 'FAIL'}  ${n}${d !== undefined ? ' — ' + d : ''}`) }
trace('模块已加载')

// ---- 准备沙箱：复制真实 server.mjs，node_modules 用 junction 链接（避免拷贝 780MB 被杀进程）----
trace('开始准备沙箱')
fs.rmSync(SANDBOX, { recursive: true, force: true })
trace('已清理旧沙箱')
fs.mkdirSync(SANDBOX, { recursive: true })
fs.copyFileSync(path.join(ROOT, 'server.mjs'), path.join(SANDBOX, 'server.mjs'))
trace('已复制 server.mjs')
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(SANDBOX, 'node_modules'), 'junction')
trace('已建立 node_modules junction')
fs.mkdirSync(path.join(SANDBOX, 'storage'), { recursive: true })
trace('已建 storage 目录')

const PROVIDER = 'https://image.kunqiongai.com/avatar/touxiang.jpg'
const CUSTOM = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const UID = 'u_avatar_e2e'

const seed = () => ({
  users: {
    [UID]: {
      id: UID, username: 'avatar_tester', nickname: '头像测试', email: 'avatar@test.com', phone: '',
      avatar: PROVIDER, avatarSource: '', providerAvatar: PROVIDER, provider: 'kunqiong',
      loginMethods: ['oauth'], planId: 'free', planStartedAt: null, planExpiresAt: null,
      organizationId: '', organizationRole: '', status: 'active',
      fileCleanup: { enabled: false, days: 7 }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
  },
  sessions: [],
  organizations: {}, shares: [], collections: [], messages: [], auditLogs: [],
  uploadSessions: {}, membershipOrders: [], joinRequests: [],
})
fs.writeFileSync(path.join(SANDBOX, 'storage', 'metadata.json'), JSON.stringify(seed(), null, 2))
trace('已写入种子 metadata.json')

// ---- 启动一个真实 server 进程，等待健康检查 ----
const boot = (tag) => new Promise((resolve, reject) => {
  trace(`boot[${tag}] spawn 开始`)
  const child = spawn(NODE, ['server.mjs'], {
    cwd: SANDBOX,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', KUNQIONG_DB_ENABLED: 'false', NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (b) => { stderr += b.toString(); trace(`boot[${tag}] stderr: ` + b.toString().slice(0, 300)) })
  child.on('error', (e) => trace(`boot[${tag}] spawn error: ` + e.message))
  child.on('exit', (c, s) => trace(`boot[${tag}] 退出 code=${c} signal=${s}`))
  const started = Date.now()
  const tick = setInterval(async () => {
    if (Date.now() - started > 20000) { clearInterval(tick); child.kill(); return reject(new Error('启动超时\n' + stderr)) }
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/health`)
      if (r.ok) { clearInterval(tick); trace(`boot[${tag}] 健康检查通过`); resolve(child) }
    } catch {}
  }, 250)
})

const stop = (child) => new Promise((resolve) => {
  child.on('exit', resolve)
  child.kill('SIGTERM')
  setTimeout(() => { try { child.kill('SIGKILL') } catch {} ; resolve() }, 4000)
})

const api = (p, init = {}) => fetch(`http://127.0.0.1:${PORT}${p}`, {
  ...init,
  headers: { 'Content-Type': 'application/json', Cookie: `kunqiong_session=${sessionId}`, ...(init.headers || {}) },
})

// 造一个登录会话：直接写 metadata 后重启让服务端加载
function seedSession(sid) {
  const file = path.join(SANDBOX, 'storage', 'metadata.json')
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  data.sessions = [{
    id: sid,
    expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    createdAt: new Date().toISOString(),
    apiWebToken: '',
    user: data.users[UID],
  }]
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

const sessionId = 'sess_avatar_e2e_1'
seedSession(sessionId)

line('===== 端到端：自定义头像跨重启持久化 =====')

let child = await boot('first')
line('-- 第一轮：登录后上传自定义头像 --')
{
  const me1 = await (await api('/api/auth/me')).json()
  check('初始为 provider 头像', me1.user?.avatar === PROVIDER, String(me1.user?.avatar).slice(0, 45))
  check('初始 avatarSource 为空', !me1.user?.avatarSource, JSON.stringify(me1.user?.avatarSource))

  const patch = await api('/api/auth/profile', { method: 'PATCH', body: JSON.stringify({ avatar: CUSTOM }) })
  const body = await patch.json()
  check('PATCH 保存自定义头像 → 200', patch.status === 200, `status=${patch.status} ${body.message || ''}`)
  check('响应 avatarSource=custom', body.user?.avatarSource === 'custom', JSON.stringify(body.user?.avatarSource))
  check('响应 avatar 为自定义图', body.user?.avatar === CUSTOM, String(body.user?.avatar).slice(0, 40))
  check('providerAvatar 保留', body.user?.providerAvatar === PROVIDER, String(body.user?.providerAvatar).slice(0, 45))
}

await stop(child)

line('-- 第二轮：重启服务后（模拟发版/重部署）--')
child = await boot('second')
{
  const me2 = await (await api('/api/auth/me')).json()
  check('★ 重启后 avatar 仍为自定义图', me2.user?.avatar === CUSTOM, String(me2.user?.avatar).slice(0, 40))
  check('★ 重启后 avatarSource 仍为 custom', me2.user?.avatarSource === 'custom', JSON.stringify(me2.user?.avatarSource))

  const disk = JSON.parse(fs.readFileSync(path.join(SANDBOX, 'storage', 'metadata.json'), 'utf8'))
  const stored = disk.users[UID]
  check('★ 磁盘用户表 avatar 仍为自定义图', stored.avatar === CUSTOM, String(stored.avatar).slice(0, 40))
  check('★ 磁盘用户表 avatarSource=custom', stored.avatarSource === 'custom', JSON.stringify(stored.avatarSource))
  check('磁盘会话快照未污染用户表', disk.sessions[0]?.user?.avatar === CUSTOM, String(disk.sessions[0]?.user?.avatar).slice(0, 40))
}

line('-- 第三轮：模拟重新登录（OAuth 回调写回 provider 快照）--')
{
  // 模拟真实 OAuth 回调链路：上游只给 avatar（provider 图），createAuthSession 走 upsertAccountUser。
  // 关键：上游对象**没有 avatarSource 键**，且 avatar 是 truthy —— 这是真实重登最容易被误判的场景。
  const diskPath = path.join(SANDBOX, 'storage', 'metadata.json')
  const disk = JSON.parse(fs.readFileSync(diskPath, 'utf8'))
  const providerSnap = {
    id: UID, username: 'avatar_tester', nickname: '头像测试', email: 'avatar@test.com',
    avatar: PROVIDER, providerAvatar: PROVIDER, provider: 'kunqiong',
    loginMethods: ['oauth'], planId: 'free', status: 'active',
    // 注意：不提供 avatarSource，模拟上游不表态
  }
  disk.sessions.push({
    id: 'sess_avatar_e2e_2',
    expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    createdAt: new Date().toISOString(),
    apiWebToken: '',
    user: providerSnap,
  })
  fs.writeFileSync(diskPath, JSON.stringify(disk, null, 2))
  trace('已注入 OAuth 重登会话快照')
}

await stop(child)
child = await boot('third')
{
  const me3 = await (await api('/api/auth/me')).json()
  check('★ 模拟重新登录后 avatar 仍为自定义图', me3.user?.avatar === CUSTOM, String(me3.user?.avatar).slice(0, 40))
  check('★ avatarSource 仍为 custom', me3.user?.avatarSource === 'custom', JSON.stringify(me3.user?.avatarSource))

  const back = await api('/api/auth/profile', { method: 'PATCH', body: JSON.stringify({ avatar: null }) })
  const backBody = await back.json()
  check('「恢复登录头像」生效 → 回落 provider', backBody.user?.avatar === PROVIDER, String(backBody.user?.avatar).slice(0, 45))
  check('「恢复登录头像」后 avatarSource 清空', backBody.user?.avatarSource === '', JSON.stringify(backBody.user?.avatarSource))
}

await stop(child)

line(`\n结果：${pass}/${pass + fail} 通过`)
fs.writeFileSync(LOG, out.join('\n'))
console.log(out.join('\n'))
process.exit(fail ? 1 : 0)
