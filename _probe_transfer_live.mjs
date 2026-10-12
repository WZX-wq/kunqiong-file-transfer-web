// 线上验收：最新 release、手册与页脚链接、转让/解散接口、消息中心修复已部署
const BASE = `${process.env.KQ_LIVE_BASE || 'http://127.0.0.1:8045'}`
const results = []
const check = (name, pass, detail = '') => { results.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`) }

const r0 = await fetch(`${BASE}/api/health`)
const h = await r0.json()
check('线上 /api/health 可达', r0.ok, JSON.stringify(h).slice(0, 120))
// release 随每次 push 滚动；断言「已滚动离开 35f232b（转让/解散版）」即可长期复用
check('release 已滚动至消息修复版本及以后', Boolean(h.release) && h.release !== 'unknown' && !String(h.release).startsWith('35f232b'), h.release)

const m = await fetch(`${BASE}/user-manual.html`)
check('线上 /user-manual.html 200', m.status === 200, `status=${m.status} len=${(await m.arrayBuffer()).byteLength}`)
check('手册 Cache-Control: no-cache', (m.headers.get('cache-control') || '').includes('no-cache'), m.headers.get('cache-control'))

const idx = await fetch(`${BASE}/`)
const html = await idx.text()
const jsMatch = html.match(/src="(\/assets\/[^"]+\.js)"/)
check('首页 200 且能取到 bundle 路径', idx.status === 200 && Boolean(jsMatch), jsMatch?.[1])
if (jsMatch) {
  const bundle = await (await fetch(`${BASE}${jsMatch[1]}`)).text()
  check('bundle 含页脚「使用手册」链接', bundle.includes('/user-manual.html'))
  check('bundle 含转让接口调用', bundle.includes('/api/account/workspace/transfer-ownership'))
  check('bundle 含解散接口调用', bundle.includes('/api/account/workspace/dissolve'))
  check('bundle 含解散危险区样式类', bundle.includes('team-danger-zone'))
  check('bundle 含消息展开交互（点击展开）', bundle.includes('点击展开'), '长消息截断修复已上线')
}

// 未登录访问新接口 → 401 说明路由已部署且鉴权正常
const t = await fetch(`${BASE}/api/account/workspace/transfer-ownership`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetMemberId: 'x' }) })
check('线上转让接口已部署（未登录 401）', t.status === 401, `status=${t.status}`)
const d = await fetch(`${BASE}/api/account/workspace/dissolve`, { method: 'POST' })
check('线上解散接口已部署（未登录 401）', d.status === 401, `status=${d.status}`)

console.log(`==== 结果: PASS=${results.filter((r) => r.pass).length} FAIL=${results.filter((r) => !r.pass).length} ====`)
if (results.some((r) => !r.pass)) process.exit(1)
