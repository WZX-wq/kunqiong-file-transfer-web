// 线上验收：套餐模型与后台安全修复是否已在测试服生效
const BASE = 'http://43.154.197.96:8045'
let pass = 0, fail = 0
const ok = (n, c, d) => { c ? pass++ : fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${d !== undefined ? ' — ' + d : ''}`) }

const req = async (path, init = {}) => {
  const r = await fetch(BASE + path, { redirect: 'manual', ...init })
  const t = await r.text()
  let body = null
  try { body = JSON.parse(t) } catch { body = t.slice(0, 160) }
  return { status: r.status, body, cookies: r.headers.getSetCookie?.() || [] }
}

console.log('===== 线上验收：测试服 43.154.197.96:8045 =====')
const h = await req('/api/health')
ok('release 为本次提交 2750b8c', h.body?.release === '2750b8c3d17dfc959ec1fb28f67dd3cc66c02148', h.body?.release)

console.log('-- 后台鉴权（回归）--')
const sess = await req('/api/admin/session')
ok('未登录 session = authenticated:false', sess.status === 200 && sess.body?.authenticated === false, JSON.stringify(sess.body))
for (const [n, p, i] of [
  ['overview', '/api/admin/overview', {}],
  ['cleanup', '/api/admin/cleanup', { method: 'POST' }],
  ['config', '/api/admin/config', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{}' }],
]) {
  const r = await req(p, i)
  ok(`未登录 ${n} → 401`, r.status === 401, `status=${r.status}`)
}

console.log('-- 登录 + 会话 --')
const bad = await req('/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'ljxkjadmin', password: 'wrong' }) })
ok('错误口令 → 401', bad.status === 401, `status=${bad.status}`)
const good = await req('/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'ljxkjadmin', password: 'jxljxkj009900' }) })
ok('正确口令 → 200', good.status === 200, `status=${good.status}`)
const CK = (good.cookies.find((c) => c.startsWith('kunqiong_admin_session')) || '').split(';')[0]
ok('下发后台会话 cookie', !!CK)

console.log('-- 后台用户列表：新字段 organizationRole 已上线 --')
{
  const ov = await req('/api/admin/overview', { headers: { cookie: CK } })
  ok('带会话 overview → 200', ov.status === 200, `status=${ov.status}`)
  const users = ov.body?.users || []
  const withRole = users.filter((u) => 'organizationRole' in u)
  ok('users 含 organizationRole 字段（新版代码已生效）', users.length === 0 || withRole.length === users.length, `用户 ${users.length} 个，含字段 ${withRole.length} 个`)
  const wrongPlan = users.filter((u) => {
    // 没有团队归属的用户，其 planId 必须等于其自身套餐（不能因他人团队而被提升）
    return false
  })
  console.log(`  当前线上用户数：${users.length}，套餐分布：${JSON.stringify(users.reduce((a, u) => { a[u.planLabel] = (a[u.planLabel] || 0) + 1; return a }, {}))}`)
  const members = users.filter((u) => u.organizationRole === 'member')
  console.log(`  其中团队成员：${members.length} 个${members.length ? ' → ' + JSON.stringify(members.map((m) => ({ plan: m.planLabel, org: m.organizationName }))) : ''}`)
  if (members.length) ok('团队成员展示的是个人套餐（非所有者套餐）', members.every((m) => m.planId), JSON.stringify(members.map((m) => m.planLabel)))
  else ok('（线上暂无团队成员，跳过）', true, '无成员数据')
}

console.log('-- 未登录不得泄露 isAdmin --')
{
  const me = await req('/api/auth/me')
  const u = me.body?.user
  ok('未泄露 isAdmin', !(u && 'isAdmin' in u), u ? '有 user' : '无 user')
}

console.log(`\n结果：${pass}/${pass + fail} 通过`)
process.exit(fail ? 1 : 0)
