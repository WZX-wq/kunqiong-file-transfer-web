// 冒烟：/api/admin/impersonate 的三条安全约束是否成立
//   1) 未登录（无管理员 cookie） → 401
//   2) 生产模式（NODE_ENV != test）→ 404
//   3) 用户不存在 → 404；用户存在 → 200 且 sessionId 可直接用于登录态
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { join } from 'node:path'

const ROOT = 'C:\\Users\\admin\\Desktop\\鲲穹文件传输web'
const LOG = join(ROOT, '_impersonate_smoke.txt')
const SANDBOX = join(ROOT, '_impersonate_sandbox')
const NODE = process.execPath
const PORT_PROD = 8231
const PORT_TEST = 8234

const out = []
let pass = 0, fail = 0
const line = (s) => { out.push(s); fs.writeFileSync(LOG, out.join('\n')) }
const check = (n, c, d) => { c ? pass++ : fail++; line(`  ${c ? 'PASS' : 'FAIL'}  ${n}${d !== undefined ? ' — ' + d : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const copyTree = (src, dst) => {
  fs.mkdirSync(dst, { recursive: true })
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = join(src, e.name), d = join(dst, e.name)
    if (e.isDirectory()) copyTree(s, d)
    else if (e.isFile()) fs.copyFileSync(s, d)
  }
}

fs.writeFileSync(LOG, '')
try { if (fs.existsSync(SANDBOX)) fs.rmSync(SANDBOX, { recursive: true, force: true, maxRetries: 3 }) } catch {}
fs.mkdirSync(join(SANDBOX, 'storage'), { recursive: true })
fs.copyFileSync(join(ROOT, 'server.mjs'), join(SANDBOX, 'server.mjs'))
try { fs.symlinkSync(join(ROOT, 'node_modules'), join(SANDBOX, 'node_modules'), 'junction') } catch {}

// 预置一个用户，供 impersonate 命中。
// 注意：metadata.users / records / messages 都是「以 userId 为键的对象」而非数组
// （accountUserById → metadata.users[key]），写成数组会永远查不到用户。
const seed = {
  users: {
    u_smoke: {

    id: 'u_smoke', username: 'smoke001', nickname: '冒烟用户', email: 'smoke@test.com',
    phone: '', status: 'active', planId: 'free', avatar: null, avatarSource: '', providerAvatar: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    },
  },
  organizations: [], shares: [], collections: [], sessions: [], records: {}, messages: {},
  auditLogs: [], upgradeOrders: [],
}
fs.writeFileSync(join(SANDBOX, 'storage', 'metadata.json'), JSON.stringify(seed))

let proc = null
const start = async (env, PORT) => {
  proc = spawn(NODE, ['server.mjs'], {
    cwd: SANDBOX,
    env: { ...process.env, PORT: String(PORT), KUNQIONG_HOST: '127.0.0.1', NODE_ENV: env,
      KUNQIONG_ADMIN_USERNAME: 'smokeadmin', KUNQIONG_ADMIN_PASSWORD: 'smokepass123',
      KUNQIONG_OAUTH_CLIENT_ID: 'x', KUNQIONG_OAUTH_CLIENT_SECRET: 'y',
      KUNQIONG_APP_URL: `http://127.0.0.1:${PORT}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  proc.stdout.on('data', () => {})
  proc.stderr.on('data', () => {})
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/api/health`); if (r.ok) return true } catch {}
    await sleep(300)
  }
  return false
}
const stop = async () => {
  if (!proc) return
  const p = proc
  proc = null
  try { p.kill() } catch {}
  // 等端口真正释放：子进程退出后端口可能仍被占用，直接复用会让下一个实例静默失败
  for (let i = 0; i < 30; i++) { if (p.exitCode !== null || p.signalCode) break; await sleep(200) }
  await sleep(500)
}

try {
  // ---------- 生产模式：端点必须不存在 ----------
  line('===== A. NODE_ENV=production：端点必须 404 =====')
  if (!await start('production', PORT_PROD)) { line('服务未起（production）'); process.exit(1) }
  {
    const r = await fetch(`http://127.0.0.1:${PORT_PROD}/api/admin/impersonate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'u_smoke' }),
    })
    check('生产模式未登录 → 404（端点不存在，不泄露存在性）', r.status === 404, `status=${r.status}`)
  }
  await stop()

  // ---------- 测试模式 ----------
  line('\n===== B. NODE_ENV=test =====')
  if (!await start('test', PORT_TEST)) { line('服务未起（test）'); process.exit(1) }
  const base = `http://127.0.0.1:${PORT_TEST}`

  {
    const r = await fetch(`${base}/api/admin/impersonate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'u_smoke' }),
    })
    check('★ 未登录 → 401（必须持管理员口令会话）', r.status === 401, `status=${r.status}`)
  }

  // 管理员登录
  const lr = await fetch(`${base}/api/admin/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'smokeadmin', password: 'smokepass123' }),
  })
  const setCookie = lr.headers.getSetCookie ? lr.headers.getSetCookie() : [lr.headers.get('set-cookie')].filter(Boolean)
  const adminCookie = (setCookie.map((c) => String(c).split(';')[0]).join('; '))
  check('管理员登录成功', lr.status === 200 && /kunqiong_admin_session=/.test(adminCookie), `status=${lr.status}`)
  const ADMIN = { Cookie: adminCookie, 'Content-Type': 'application/json' }

  {
    const r = await fetch(`${base}/api/admin/impersonate`, {
      method: 'POST', headers: ADMIN, body: JSON.stringify({ userId: 'nobody_x' }),
    })
    check('★ 用户不存在 → 404（不能凭空造用户）', r.status === 404, `status=${r.status}`)
  }
  {
    const r = await fetch(`${base}/api/admin/impersonate`, {
      method: 'POST', headers: ADMIN, body: JSON.stringify({}),
    })
    check('缺少 userId → 400', r.status === 400, `status=${r.status}`)
  }

  let sessId = null
  {
    const r = await fetch(`${base}/api/admin/impersonate`, {
      method: 'POST', headers: ADMIN, body: JSON.stringify({ userId: 'u_smoke' }),
    })
    const j = await r.json().catch(() => ({}))
    sessId = j.sessionId
    check('★ 合法请求 → 200 且返回 sessionId', r.status === 200 && Boolean(sessId),
      `status=${r.status} len=${String(sessId || '').length}`)
  }
  {
    const r = await fetch(`${base}/api/auth/me`, { headers: { Cookie: `kunqiong_session=${sessId}` } })
    const j = await r.json().catch(() => ({}))
    const uid = j?.user?.id
    check('★ 签发的会话可直接换取登录态（/api/auth/me 命中该用户）', uid === 'u_smoke', `user=${uid}`)
  }

  await stop()
  line(`\n结果：${pass}/${pass + fail} 通过`)
} catch (e) {
  line('异常：' + (e?.stack || e?.message || e))
} finally {
  await stop()
  fs.writeFileSync(LOG, out.join('\n'))
  process.exit(fail ? 1 : 0)
}
