// 线上验收：3cacd70 五项交互优化 + 两处缺陷修复
const BASE = `${process.env.KQ_LIVE_BASE || 'http://127.0.0.1:8045'}`
const out = []
let pass = 0, fail = 0
const line = (s) => { out.push(s); console.log(s) }
const check = (n, c, d) => { c ? pass++ : fail++; line(`  ${c ? 'PASS' : 'FAIL'}  ${n}${d !== undefined ? ' — ' + d : ''}`) }

const health = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(8000) }).then((r) => r.json()).catch(() => null)
check('★ 线上 release = 3cacd70（本轮提交）', Boolean(health?.release?.startsWith('3cacd70')), health?.release)

// 新接口存在且鉴权完好：匿名退出 → 401（不是 404 = 路由已注册；不是 200 = 没裸奔）
const anonLeave = await fetch(`${BASE}/api/account/workspace/leave`, { method: 'POST', signal: AbortSignal.timeout(8000) }).catch((e) => ({ status: 0, error: e.message }))
check('★ 匿名调用退出接口 → 401（路由存在 + 鉴权完好）', anonLeave.status === 401, `status=${anonLeave.status}${anonLeave.error ? ' ' + anonLeave.error : ''}`)

const anonMe = await fetch(`${BASE}/api/auth/me`, { signal: AbortSignal.timeout(8000) }).then((r) => r.json()).catch(() => null)
check('/api/auth/me 匿名 → user:null（既有行为未破坏）', anonMe?.user === null, JSON.stringify(anonMe?.user))

// 后台鉴权仍完好
const adminWrong = await fetch(`${BASE}/api/admin/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'definitely-wrong' }),
  signal: AbortSignal.timeout(8000),
}).catch((e) => ({ status: 0, error: e.message }))
check('后台错误口令 → 401（鉴权未受影响）', adminWrong.status === 401, `status=${adminWrong.status}${adminWrong.error ? ' ' + adminWrong.error : ''}`)

// 前端产物含新样式与新文案
const indexHtml = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(8000) }).then((r) => r.text()).catch(() => '')
const cssMatch = /href="(\/assets\/index-[^"]+\.css)"/.exec(indexHtml)
const jsMatch = /src="(\/assets\/index-[^"]+\.js)"/.exec(indexHtml)
check('首页产物可访问', Boolean(cssMatch && jsMatch), `${cssMatch?.[1]} ${jsMatch?.[1]}`)
if (cssMatch) {
  const css = await fetch(`${BASE}${cssMatch[1]}`, { signal: AbortSignal.timeout(8000) }).then((r) => r.text()).catch(() => '')
  check('★ 产物 CSS 含退出卡片样式（team-leave-card）', css.includes('.team-leave-card'), 'ok')
  check('★ 产物 CSS 含后台操作区对齐（admin-user-actions）', css.includes('.admin-user-actions'), 'ok')
  check('★ 产物 CSS 旧日期样式已删（admin-plan-expiry 不存在）', !css.includes('admin-plan-expiry'), 'ok')
  check('★ KPI 字号已调大（26px 数值）', /\.team-kpi strong\s*\{[^}]*font-size:\s*26px/.test(css), 'ok')
}
if (jsMatch) {
  const js = await fetch(`${BASE}${jsMatch[1]}`, { signal: AbortSignal.timeout(8000) }).then((r) => r.text()).catch(() => '')
  check('★ 产物 JS 含退出确认文案', js.includes('确认退出'), 'ok')
  check('★ 产物 JS 新头像提示文案', js.includes('未上传时默认显示鲲穹账号的登录头像'), 'ok')
  check('★ 产物 JS 旧头像文案已删', !js.includes('使用微信或 QQ 登录头像'), 'ok')
}

line('')
line(`结果：${pass}/${pass + fail} 通过`)
const fs = await import('node:fs')
fs.writeFileSync('_fixes_live.txt', out.join('\n'))
process.exit(fail ? 1 : 0)
