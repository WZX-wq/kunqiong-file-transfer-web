// 回归验收：验证码发送限流 + 取件码查询限流
//   1) POST /api/auth/code 同一目标 60s 内第二次 → 429
//   2) GET /api/shares/lookup/:code 同一来源 30 次/10min → 第 31 次起 429（global 不触发）
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = 'C:\\Users\\admin\\Desktop\\鲲穹文件传输web'
const NODE = process.execPath
const PORT = '8199'
const BASE = `http://127.0.0.1:${PORT}`

const env = {
  ...process.env,
  PORT,
  NODE_ENV: 'test',
  KUNQIONG_DB_ENABLED: 'false',
  KUNQIONG_TEST_ENFORCE_ENTERPRISE_ALLOWLIST: 'false',
}
const srv = spawn(NODE, ['server.mjs'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })
let srvLog = ''
srv.stderr.on('data', (d) => { srvLog += d })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitHealth() {
  for (let i = 0; i < 60; i += 1) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return } catch {}
    await sleep(500)
  }
  throw new Error('server not up\n' + srvLog.slice(-1500))
}
const cookieOf = (res) => (res.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ')

let pass = 0, fail = 0
const check = (name, ok, extra = '') => {
  if (ok) pass += 1; else fail += 1
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`)
}

try {
  await waitHealth()
  const adminRes = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'ljxkjadmin', password: 'jxljxkj009900' }),
  })
  const adminCookie = cookieOf(adminRes)
  const imp = await fetch(`${BASE}/api/admin/impersonate`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ userId: '13' }),
  })
  const { sessionId } = await imp.json()
  const session = `kunqiong_session=${sessionId}`

  // 1) 验证码发送限流（未配置 SMTP/短信时会先 503，但限流检查在创建之前，第二次必 429）
  const sendCode = () => fetch(`${BASE}/api/auth/code`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: session },
    body: JSON.stringify({ target: '13800001111' }),
  })
  const first = await sendCode()
  const second = await sendCode()
  check('★ 同一目标 60s 内第二次发送 → 429（修复点）', second.status === 429, `first=${first.status} second=${second.status}`)

  // 2) 取件码查询限流
  let hit429 = false, statuses = []
  for (let i = 0; i < 35; i += 1) {
    const r = await fetch(`${BASE}/api/shares/lookup/ZZZZ`, { headers: { cookie: session } })
    statuses.push(r.status)
    if (r.status === 429) { hit429 = true; break }
  }
  check('★ lookup 连续查询触发 429（修复点）', hit429, `第 ${statuses.length} 次命中，status=${statuses[statuses.length - 1]}`)
  check('lookup 前置次数内返回正常业务状态（404）', statuses.slice(0, 10).every((s) => s === 404), statuses.slice(0, 3).join(','))
} catch (err) {
  fail += 1
  console.log('  FAIL  验收脚本异常 —', err.message)
} finally {
  try { srv.kill('SIGKILL') } catch {}
  await sleep(500)
  // impersonate 会写 session 进 metadata，还原为跑前备份保持数据干净
  try { fs.copyFileSync(path.join(ROOT, 'storage', 'metadata.json.auditbak'), path.join(ROOT, 'storage', 'metadata.json')) } catch {}
  console.log(`\n结果: ${pass}/${pass + fail} 通过`)
  process.exit(fail ? 1 : 0)
}
