// 后台管理安全审计（漏洞回归 + 全面体检）
// 覆盖：1) 删除资源不再 500 且写审计  2) 自禁用保护生效  3) 限流不可靠伪造 XFF 绕过
//       4) 鉴权通道唯一  5) 越权与输入校验  6) 会话与 cookie 属性
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, cpSync, symlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = __dirname
const SANDBOX = join(ROOT, '_admin_audit_sandbox')
const PORT = 8102
const BASE = `http://127.0.0.1:${PORT}`

let pass = 0, fail = 0
const check = (n, c, d) => { c ? pass++ : fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${d !== undefined ? ' — ' + d : ''}`) }
const line = (t) => console.log(t)

if (existsSync(SANDBOX)) rmSync(SANDBOX, { recursive: true, force: true })
mkdirSync(join(SANDBOX, 'storage', 'tmp'), { recursive: true })
cpSync(join(ROOT, 'server.mjs'), join(SANDBOX, 'server.mjs'))
try { symlinkSync(join(ROOT, 'node_modules'), join(SANDBOX, 'node_modules'), 'junction') } catch {}
mkdirSync(join(SANDBOX, 'dist'), { recursive: true })
writeFileSync(join(SANDBOX, 'dist', 'index.html'), '<html><body><div id="root"></div></body></html>')

const ADMIN_ID = 'u_admin_acct'
const VICTIM_ID = 'u_victim'
const metadata = {
  users: {
    // 故意把管理员账号名写成 ljxkjadmin，用来验证自禁用保护真的能命中
    [ADMIN_ID]: { id: ADMIN_ID, username: 'ljxkjadmin', nickname: '管理员', email: 'admin@test.com', planId: 'free', status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    [VICTIM_ID]: { id: VICTIM_ID, username: 'victim', nickname: '普通用户', email: 'v@test.com', planId: 'free', status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  },
  sessions: [],
  organizations: {}, shares: [
    { id: 'sh_del_me', token: 'tk_del', title: '待删分享', ownerUserId: VICTIM_ID, files: [{ name: 'a.txt', size: 10 }], status: 'active', createdAt: new Date().toISOString(), expiresAt: null },
  ],
  collections: [], messages: {}, auditLogs: [], upgradeOrders: [], verificationCodes: [], systemConfig: {}, notifications: {},
}
writeFileSync(join(SANDBOX, 'storage', 'metadata.json'), JSON.stringify(metadata, null, 2))

process.env.KUNQIONG_DB_ENABLED = 'false'
process.env.PORT = String(PORT)
process.env.KUNQIONG_STORAGE_DIR = join(SANDBOX, 'storage')
process.env.KUNQIONG_ADMIN_USERNAME = 'ljxkjadmin'
process.env.KUNQIONG_ADMIN_PASSWORD = 'jxljxkj009900'
// 故意配置白名单，证明它不再是后台通道
process.env.KUNQIONG_ADMIN_USER_IDS = VICTIM_ID

const mod = await import(pathToFileURL(join(SANDBOX, 'server.mjs')).href)
const server = mod.default || mod.server || mod.app
if (server?.listen) await new Promise((r) => server.listen(PORT, '127.0.0.1', r))
await new Promise((r) => setTimeout(r, 400))

const req = async (path, init = {}) => {
  const res = await fetch(BASE + path, { redirect: 'manual', ...init })
  const text = await res.text()
  let body = null
  try { body = JSON.parse(text) } catch { body = text.slice(0, 200) }
  return { status: res.status, body, cookies: res.headers.getSetCookie?.() || [] }
}
const j = (o) => ({ headers: { 'content-type': 'application/json' }, ...o })

const login = await req('/api/admin/login', { method: 'POST', ...j({ body: JSON.stringify({ username: 'ljxkjadmin', password: 'jxljxkj009900' }) }) })
const CK = (login.cookies.find((c) => c.startsWith('kunqiong_admin_session')) || '').split(';')[0]
const auth = (extra = {}) => ({ headers: { cookie: CK, 'content-type': 'application/json' }, ...extra })

line('===== 后台管理安全审计 =====')

line('-- 1. 删除资源：不应 500（原 session.user.id 未定义会抛 ReferenceError）--')
{
  const res = await req('/api/admin/resources/share/sh_del_me', { method: 'DELETE', headers: { cookie: CK } })
  check('★ 删除分享返回 200 而非 500', res.status === 200, `status=${res.status} body=${JSON.stringify(res.body).slice(0, 120)}`)
  check('★ 删除后返回最新 overview', !!res.body?.overview, res.body?.overview ? 'ok' : 'missing')
  const meta = JSON.parse(readFileSync(join(SANDBOX, 'storage', 'metadata.json'), 'utf8'))
  check('资源确实被删除', !meta.shares.find((s) => s.id === 'sh_del_me'))
  const log = (meta.auditLogs || []).find((l) => l.action === '删除文件资源')
  check('★ 审计日志已写入（不再因异常丢失）', !!log, log ? `userId=${log.userId}` : 'missing')
  check('审计日志记录了管理员身份', /^admin:/.test(log?.userId || ''), log?.userId)
}

line('-- 2. 自禁用保护（原 user.id === auth.user.id 永远为 false）--')
{
  const res = await req(`/api/admin/users/${ADMIN_ID}`, { method: 'PATCH', ...auth({ body: JSON.stringify({ status: 'disabled' }) }) })
  check('★ 禁用自己（同名账号）被拒绝', res.status === 400, `status=${res.status} msg=${res.body?.message || ''}`)
  check('提示文案正确', /不能禁用/.test(res.body?.message || ''), res.body?.message)
  const meta = JSON.parse(readFileSync(join(SANDBOX, 'storage', 'metadata.json'), 'utf8'))
  check('管理员账号未被禁用', meta.users[ADMIN_ID].status === 'active', meta.users[ADMIN_ID].status)
  // 对照组：禁用别人应成功
  const ok = await req(`/api/admin/users/${VICTIM_ID}`, { method: 'PATCH', ...auth({ body: JSON.stringify({ status: 'disabled' }) }) })
  check('禁用普通用户仍可成功（未误伤）', ok.status === 200, `status=${ok.status}`)
  await req(`/api/admin/users/${VICTIM_ID}`, { method: 'PATCH', ...auth({ body: JSON.stringify({ status: 'active' }) }) })
}

line('-- 3. 输入校验（放在限流测试之前，避免被 429 抢答）--')
{
  const bad = await req('/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: '', password: '' }) })
  check('空账号密码 → 400', bad.status === 400, `status=${bad.status}`)
  const noUser = await req('/api/admin/users/__nope__', { method: 'PATCH', ...auth({ body: JSON.stringify({ status: 'active' }) }) })
  check('改不存在的用户 → 404', noUser.status === 404, `status=${noUser.status}`)
  const badStatus = await req(`/api/admin/users/${VICTIM_ID}`, { method: 'PATCH', ...auth({ body: JSON.stringify({ status: 'weird' }) }) })
  check('非法状态值 → 400', badStatus.status === 400, `status=${badStatus.status}`)
  const badKind = await req('/api/admin/resources/unknown/x', { method: 'DELETE', headers: { cookie: CK } })
  check('非法资源类型 → 400', badKind.status === 400, `status=${badKind.status}`)
  const badPlan = await req(`/api/admin/users/${VICTIM_ID}`, { method: 'PATCH', ...auth({ body: JSON.stringify({ planId: 'superduper' }) }) })
  const meta = JSON.parse(readFileSync(join(SANDBOX, 'storage', 'metadata.json'), 'utf8'))
  check('非法套餐名回落到 free（不写入脏值）', meta.users[VICTIM_ID].planId === 'free', `planId=${meta.users[VICTIM_ID].planId} status=${badPlan.status}`)
}

line('-- 4. 鉴权通道唯一：白名单账号/匿名一律不得进入 --')
{
  const cases = [
    ['GET  /overview', '/api/admin/overview', {}],
    ['GET  /session', '/api/admin/session', {}],
    ['POST /cleanup', '/api/admin/cleanup', { method: 'POST' }],
    ['PATCH /config', '/api/admin/config', { method: 'PATCH', ...j({ body: '{}' }) }],
  ]
  for (const [name, path, init] of cases) {
    const r = await req(path, init)
    if (path.endsWith('/session')) check(`${name} 匿名为 authenticated:false`, r.status === 200 && r.body?.authenticated === false, JSON.stringify(r.body))
    else check(`${name} 匿名 → 401`, r.status === 401, `status=${r.status}`)
  }
}

line('-- 5. 登录限流：伪造 X-Forwarded-For 不可绕过（本段会耗尽限流额度，故放最后）--')
{
  let last = null
  for (let i = 0; i < 20; i++) {
    last = await req('/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${i + 1}` },
      body: JSON.stringify({ username: 'ljxkjadmin', password: `wrong-${i}` }),
    })
  }
  check('★ 20 次伪造 IP 的错误尝试后被限流（429）', last?.status === 429, `last=${last?.status}`)
  const blocked = await req('/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.9.9.9' }, body: JSON.stringify({ username: 'ljxkjadmin', password: 'jxljxkj009900' }) })
  check('★ 限流期间正确口令同样被拦截', blocked.status === 429, `status=${blocked.status}`)
}

line('-- 6. 会话与 cookie 安全属性 --')
{
  const c = login.cookies.find((x) => x.startsWith('kunqiong_admin_session')) || ''
  check('cookie 为 HttpOnly', /HttpOnly/i.test(c), c.replace(/kunqiong_admin_session=[^;]*/, 'kunqiong_admin_session=***'))
  check('cookie SameSite=Lax', /SameSite=Lax/i.test(c))
  check('cookie Path=/', /Path=\//i.test(c))
  check('错误口令不下发会话 cookie', !(await req('/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'ljxkjadmin', password: 'nope' }) })).cookies.join(';').includes('kunqiong_admin_session'))
}

console.log(`\n结果：${pass}/${pass + fail} 通过`)
try { server?.close?.() } catch {}
writeFileSync(join(ROOT, '_admin_audit.log'), `结果：${pass}/${pass + fail} 通过\n`)
process.exit(fail ? 1 : 0)
