const BASE = `${process.env.KQ_LIVE_BASE || 'http://127.0.0.1:8045'}`
const WHITELIST_ID = process.env.KQ_ADMIN_USER_ID || 'fixture-admin-id'
let pass = 0, fail = 0
const ok = (n, c, d) => { c ? pass++ : fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${d !== undefined ? ' — ' + d : ''}`) }

async function req(path, init = {}) {
  const r = await fetch(BASE + path, { redirect: 'manual', ...init })
  const text = await r.text()
  let body = null
  try { body = JSON.parse(text) } catch { body = text.slice(0, 120) }
  const raw = r.headers.getSetCookie ? r.headers.getSetCookie() : []
  return { status: r.status, setCookie: raw, body }
}

console.log('===== 线上接口：未登录访问后台一律 401 =====')
const cases = [
  ['GET  /api/admin/session', '/api/admin/session', {}],
  ['GET  /api/admin/overview', '/api/admin/overview', {}],
  ['POST /api/admin/cleanup', '/api/admin/cleanup', { method: 'POST' }],
  ['PATCH /api/admin/config', '/api/admin/config', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{}' }],
  [`PATCH /api/admin/users/${WHITELIST_ID}`, `/api/admin/users/${WHITELIST_ID}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"plan":"pro"}' }],
  ['DELETE /api/admin/resources/share/x', '/api/admin/resources/share/x', { method: 'DELETE' }],
  ['PATCH /api/admin/resources/share/x/review', '/api/admin/resources/share/x/review', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"action":"approve"}' }],
]
for (const [name, path, init] of cases) {
  const r = await req(path, init)
  if (path.endsWith('/session')) {
    ok(`${name} 返回 authenticated:false`, r.status === 200 && r.body && r.body.authenticated === false, JSON.stringify(r.body))
  } else {
    ok(`${name} -> 401`, r.status === 401, `status=${r.status} msg=${(r.body && r.body.message) || ''}`)
  }
}

console.log('-- 无 cookie 时不得下发任何 admin 会话 --')
const s = await req('/api/admin/session')
ok('未下发 kunqiong_admin_session', !s.setCookie.join(';').includes('kunqiong_admin_session'), s.setCookie.join(';') || '(无)')

console.log('-- 口令登录 --')
const bad = await req('/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'ljxkjadmin', password: 'wrong-password' }) })
ok('错误口令 -> 401', bad.status === 401, `status=${bad.status}`)
ok('错误口令不下发会话 cookie', !bad.setCookie.join(';').includes('kunqiong_admin_session'))

const good = await req('/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'ljxkjadmin', password: 'jxljxkj009900' }) })
ok('正确口令 -> 200', good.status === 200, `status=${good.status}`)
const hit = good.setCookie.find((c) => c.startsWith('kunqiong_admin_session')) || ''
const ck = hit.split(';')[0]
ok('下发 kunqiong_admin_session', !!ck)
ok('返回 overview 数据', !!(good.body && good.body.overview))
ok('返回管理员身份 ljxkjadmin', good.body && good.body.admin && good.body.admin.username === 'ljxkjadmin', good.body && good.body.admin && good.body.admin.username)

console.log('-- 带会话访问后台 --')
const ov = await req('/api/admin/overview', { headers: { cookie: ck } })
ok('带会话 GET overview -> 200', ov.status === 200, `status=${ov.status}`)

console.log('-- /api/auth/me 不再泄露 isAdmin --')
const me = await req('/api/auth/me')
const u = me.body && me.body.user
const meHasIsAdmin = !!(u && typeof u === 'object' && 'isAdmin' in u)
ok('未泄露 isAdmin 字段', !meHasIsAdmin, meHasIsAdmin ? JSON.stringify(u).slice(0, 120) : 'ok')

console.log('-- 登出 --')
const lo = await req('/api/admin/logout', { method: 'POST', headers: { cookie: ck } })
ok('登出 -> 200', lo.status === 200, `status=${lo.status}`)
const after = await req('/api/admin/overview', { headers: { cookie: ck } })
ok('登出后 overview -> 401', after.status === 401, `status=${after.status}`)

console.log(`\n结果：${pass}/${pass + fail} 通过`)
process.exit(fail ? 1 : 0)
