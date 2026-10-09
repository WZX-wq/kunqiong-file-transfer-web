// 运营后台鉴权专项测试。
//
// 背景：后台原有两个登录通道 —— 管理员账号口令 + KUNQIONG_ADMIN_USER_IDS 白名单里的
// 鲲穹账号。后者让白名单账号无需密码即可进入后台，是权限绕过。
// 本脚本钉死「后台只认账号口令」这一不变量，防止白名单通道被重新引入。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'

const ROOT = 'C:/Users/admin/Desktop/鲲穹文件传输web'
const logFile = path.join(ROOT, '_admin.log')
const results = []
const line = (s) => { results.push(s); try { fs.appendFileSync(logFile, s + '\n') } catch {} }
const check = (label, pass, extra = '') => line(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`)
try { fs.writeFileSync(logFile, '') } catch {}

const PORT = 8097
const BASE = `http://127.0.0.1:${PORT}`
const ADMIN_USER = 'ljxkjadmin'
const ADMIN_PASS = 'jxljxkj009900'

// 白名单里的鲲穹账号 —— 修复前它可以完全绕过密码进后台。
const WHITELIST_ID = process.env.KQ_ADMIN_USER_ID || 'fixture-admin-id'
const NORMAL_ID = 'u_normal_1'
const now = new Date().toISOString()

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'kq-admin-'))
const storage = path.join(sandbox, 'storage')
fs.mkdirSync(storage, { recursive: true })
fs.copyFileSync(path.join(ROOT, 'server.mjs'), path.join(sandbox, 'server.mjs'))
try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(sandbox, 'node_modules'), 'junction') } catch {}

fs.writeFileSync(path.join(storage, 'metadata.json'), JSON.stringify({
  users: {
    [WHITELIST_ID]: { id: WHITELIST_ID, username: 'boss', nickname: '白名单管理员', planId: 'enterprise', status: 'active', createdAt: now, updatedAt: now },
    [NORMAL_ID]: { id: NORMAL_ID, username: 'normal', nickname: '普通用户', planId: 'free', status: 'active', createdAt: now, updatedAt: now },
  },
  sessions: [
    { id: 'sess_whitelist', user: { id: WHITELIST_ID, username: 'boss', nickname: '白名单管理员' }, expiresAt: new Date(Date.now() + 86400000).toISOString() },
    { id: 'sess_normal', user: { id: NORMAL_ID, username: 'normal', nickname: '普通用户' }, expiresAt: new Date(Date.now() + 86400000).toISOString() },
  ],
  organizations: {}, shares: [], collections: [], messages: {}, auditLogs: [], systemConfig: {},
}, null, 2))

process.env.PORT = String(PORT)
process.env.NODE_ENV = 'test'
process.env.KUNQIONG_DB_ENABLED = 'false'
// 显式把白名单配上（模拟线上 CI env），确认它不再构成后台入口。
process.env.KUNQIONG_ADMIN_USER_IDS = WHITELIST_ID
process.env.KUNQIONG_ADMIN_USERNAME = ADMIN_USER
process.env.KUNQIONG_ADMIN_PASSWORD = ADMIN_PASS
process.env.KUNQIONG_TEST_ENFORCE_ENTERPRISE_ALLOWLIST = 'false'
process.env.OAUTH_CLIENT_ID = ''
process.env.OAUTH_CLIENT_SECRET = ''
process.chdir(sandbox)

const req = async (p, opts = {}, cookies = []) => {
  const r = await fetch(`${BASE}${p}`, {
    ...opts,
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/json',
      ...(cookies.length ? { cookie: cookies.join('; ') } : {}),
      ...(opts.headers || {}),
    },
  })
  let body = null
  const text = await r.text()
  try { body = JSON.parse(text) } catch { body = text }
  const setCookie = r.headers.getSetCookie ? r.headers.getSetCookie() : []
  return { status: r.status, body, setCookie }
}
const cookieValue = (setCookie, name) => {
  for (const c of setCookie) { const m = c.match(new RegExp(`^${name}=([^;]*)`)); if (m) return `${name}=${m[1]}` }
  return ''
}

line('===== 后台鉴权：只认账号口令，白名单通道必须不可用 =====')
try {
  await import(pathToFileURL(path.join(sandbox, 'server.mjs')).href)
  for (let i = 0; i < 80; i += 1) { try { if ((await fetch(`${BASE}/api/health`)).ok) break } catch {} await new Promise((r) => setTimeout(r, 300)) }

  // —— 1. 白名单账号不得绕过密码 ——
  line('\n-- 1. 鲲穹白名单账号（原漏洞路径）--')
  const s1 = await req('/api/admin/session', {}, ['kunqiong_session=sess_whitelist'])
  check('★ 白名单账号访问 /api/admin/session → authenticated:false', s1.body?.authenticated === false, JSON.stringify(s1.body))
  check('★ 白名单账号不再返回 kunqiong 模式', s1.body?.mode !== 'kunqiong', `mode=${s1.body?.mode}`)

  const o1 = await req('/api/admin/overview', {}, ['kunqiong_session=sess_whitelist'])
  check('★ 白名单账号访问 /api/admin/overview → 401', o1.status === 401, `status=${o1.status} body=${JSON.stringify(o1.body)}`)

  const c1 = await req('/api/admin/cleanup', { method: 'POST' }, ['kunqiong_session=sess_whitelist'])
  check('★ 白名单账号执行清理 → 401', c1.status === 401, `status=${c1.status}`)

  const cfg1 = await req('/api/admin/config', { method: 'PATCH', body: JSON.stringify({ maintenanceMode: true }) }, ['kunqiong_session=sess_whitelist'])
  check('★ 白名单账号改系统配置 → 401', cfg1.status === 401, `status=${cfg1.status}`)

  const u1 = await req(`/api/admin/users/${encodeURIComponent(NORMAL_ID)}`, { method: 'PATCH', body: JSON.stringify({ planId: 'enterprise' }) }, ['kunqiong_session=sess_whitelist'])
  check('★ 白名单账号改他人账号 → 401', u1.status === 401, `status=${u1.status}`)

  // —— 2. 普通账号同样不得进入 ——
  line('\n-- 2. 普通鲲穹账号 --')
  const s2 = await req('/api/admin/session', {}, ['kunqiong_session=sess_normal'])
  check('★ 普通账号 session → authenticated:false', s2.body?.authenticated === false, JSON.stringify(s2.body))
  const o2 = await req('/api/admin/overview', {}, ['kunqiong_session=sess_normal'])
  check('★ 普通账号 overview → 401', o2.status === 401, `status=${o2.status}`)

  // —— 3. 未登录 ——
  line('\n-- 3. 未登录 --')
  const s3 = await req('/api/admin/session')
  check('★ 未登录 session → authenticated:false', s3.body?.authenticated === false, JSON.stringify(s3.body))
  const o3 = await req('/api/admin/overview')
  check('★ 未登录 overview → 401', o3.status === 401, `status=${o3.status}`)

  // —— 4. 口令登录正确路径 ——
  line('\n-- 4. 管理员账号口令登录（正确路径）--')
  const bad = await req('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: ADMIN_USER, password: 'wrong-password' }) })
  check('★ 错误口令 → 401', bad.status === 401, `status=${bad.status}`)
  check('★ 错误口令不下发会话 cookie', !cookieValue(bad.setCookie, 'kunqiong_admin_session'), bad.setCookie.join('|').slice(0, 80))

  const badUser = await req('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: 'someone-else', password: ADMIN_PASS }) })
  check('★ 错误账号 → 401', badUser.status === 401, `status=${badUser.status}`)

  const empty = await req('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: '', password: '' }) })
  check('★ 空账号密码 → 400', empty.status === 400, `status=${empty.status}`)

  const ok = await req('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }) })
  check('★ 正确口令 → 200', ok.status === 200, `status=${ok.status}`)
  check('★ 正确口令返回 overview', Boolean(ok.body?.overview?.stats), Object.keys(ok.body || {}).join(','))
  check('★ 返回 admin.username', ok.body?.admin?.username === ADMIN_USER, `username=${ok.body?.admin?.username}`)
  const adminCookie = cookieValue(ok.setCookie, 'kunqiong_admin_session')
  check('★ 下发 kunqiong_admin_session cookie', Boolean(adminCookie), adminCookie ? 'set' : 'MISSING')

  // —— 5. 口令会话可正常访问后台 ——
  line('\n-- 5. 口令会话访问后台 --')
  const s5 = await req('/api/admin/session', {}, [adminCookie])
  check('★ session → authenticated:true', s5.body?.authenticated === true, JSON.stringify(s5.body))
  check('★ mode=credential', s5.body?.mode === 'credential', `mode=${s5.body?.mode}`)
  const o5 = await req('/api/admin/overview', {}, [adminCookie])
  check('★ overview → 200', o5.status === 200, `status=${o5.status}`)

  // —— 6. 退出后失效 ——
  line('\n-- 6. 退出后台 --')
  const lo = await req('/api/admin/logout', { method: 'POST' }, [adminCookie])
  check('★ 退出 → 200', lo.status === 200, `status=${lo.status}`)
  const s6 = await req('/api/admin/session', {}, [adminCookie])
  check('★ 退出后 session → authenticated:false', s6.body?.authenticated === false, JSON.stringify(s6.body))
  const o6 = await req('/api/admin/overview', {}, [adminCookie])
  check('★ 退出后 overview → 401', o6.status === 401, `status=${o6.status}`)

  // —— 7. 前端不应再拿到 isAdmin ——
  line('\n-- 7. 账号信息不再下发 isAdmin --')
  const me = await req('/api/auth/me', {}, ['kunqiong_session=sess_whitelist'])
  const meUser = me.body?.user || me.body
  check('★ /api/auth/me 不再下发 isAdmin', meUser?.isAdmin === undefined, `isAdmin=${meUser?.isAdmin}`)

  // —— 8. 登录失败审计 ——
  line('\n-- 8. 失败登录留审计记录 --')
  const meta = JSON.parse(fs.readFileSync(path.join(storage, 'metadata.json'), 'utf8'))
  const failLogs = (meta.auditLogs || []).filter((l) => l.action === '后台登录失败')
  check('★ 失败登录写入审计日志', failLogs.length >= 1, `count=${failLogs.length}`)
  const okLogs = (meta.auditLogs || []).filter((l) => l.action === '后台登录成功')
  check('★ 成功登录写入审计日志', okLogs.length >= 1, `count=${okLogs.length}`)
} catch (err) {
  line('异常：' + (err?.stack || err))
  results.push('FAIL 脚本异常')
} finally {
  try { fs.rmSync(sandbox, { recursive: true, force: true }) } catch {}
}

const failed = results.filter((l) => l.includes('FAIL')).length
const total = results.filter((l) => /PASS|FAIL/.test(l)).length
line(`\n结果：${total - failed}/${total} 通过`)
process.exit(failed ? 1 : 0)
