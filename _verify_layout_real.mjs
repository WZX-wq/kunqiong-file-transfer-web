// 回归测试：真实 Chrome 测量工作台两卡布局。
// 这个脚本是为了防止「两张卡不在同一行」这个 bug 再次出现 ——
// 之前用 jsdom 只能断言 DOM 结构（父子/兄弟关系正确），
// 但结构正确 ≠ 视觉并排。真正的原因是 CSS 的 grid-column 与 width 组合，
// 只有真实浏览器布局引擎才能测出来。
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'

const ROOT = 'C:/Users/admin/Desktop/鲲穹文件传输web'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9341
const results = []
const line = (s) => results.push(s)
const check = (label, pass, extra = '') => line(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`)

const getJson = (url) => new Promise((res, rej) => {
  const req = http.get(url, { timeout: 4000 }, (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => { try { res(JSON.parse(b)) } catch { res(b) } }) })
  req.on('error', rej); req.on('timeout', () => { req.destroy(); rej(new Error('timeout')) })
})

const payload = {
  plan: { id: 'enterprise', label: '企业版', team: true, permanent: true, totalBytes: 2199023255552 },
  planStartedAt: '2026-09-01T00:00:00.000Z', planExpiresAt: null,
  plans: [
    { id: 'free', label: '基础版', team: false, permanent: false, totalBytes: 21474836480 },
    { id: 'member', label: '会员版', team: false, permanent: true, totalBytes: 107374182400 },
    { id: 'team', label: '团队版', team: true, permanent: true, totalBytes: 536870912000 },
    { id: 'enterprise', label: '企业版', team: true, permanent: true, totalBytes: 2199023255552 }],
  capacity: { totalBytes: 2199023255552, usedBytes: 100139008, shareCount: 27, collectionCount: 3, fileCount: 52 },
  organization: { id: 'org_1', slug: 'naijiabang', name: '奶家帮', ownerUserId: 'u_owner_1', canManage: true,
    members: [{ id: 'm_owner', userId: 'u_owner_1', displayName: '冰希特', email: '15238882808', phone: '', role: 'owner', status: 'active', canRemove: false }] },
  canManage: true, orders: [],
}
const inject = `(function(){
  const W = ${JSON.stringify(JSON.stringify(payload))};
  const of = window.fetch;
  window.fetch = function(u,o){
    const s = String(u && u.url ? u.url : u);
    if (s.includes('/api/auth/me')) return Promise.resolve(new Response(JSON.stringify({user:{id:'u_owner_1',nickname:'冰希特'}}),{status:200,headers:{'Content-Type':'application/json'}}));
    if (s.includes('/api/account/workspace')) return Promise.resolve(new Response(W,{status:200,headers:{'Content-Type':'application/json'}}));
    if (s.includes('/api/')) return Promise.resolve(new Response('{}',{status:200,headers:{'Content-Type':'application/json'}}));
    return of.apply(this,arguments);
  };
})();`

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${ROOT}/_chrome_p8`, '--no-first-run', '--disable-gpu', '--hide-scrollbars', '--disable-extensions'], { stdio: 'ignore' })
let ready = false
for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 500)); try { await getJson(`http://127.0.0.1:${PORT}/json/version`); ready = true; break } catch {} }
if (!ready) { line('FAIL  无法启动 Chrome，测试中止'); fs.writeFileSync(`${ROOT}/_verify_layout_real.txt`, results.join('\n')); process.exit(1) }

const ver = await getJson(`http://127.0.0.1:${PORT}/json/version`)
const bws = new WebSocket(ver.webSocketDebuggerUrl)
let id = 0; const pend = new Map()
bws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } })
const bcmd = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); bws.send(JSON.stringify({ id: i, method: m, params: p })) })
await new Promise((r) => bws.addEventListener('open', r))
const t = await bcmd('Target.createTarget', { url: 'about:blank' })
const tid = t.result.targetId
let wsUrl = null
for (let i = 0; i < 20; i++) { const l = await getJson(`http://127.0.0.1:${PORT}/json/list`); const p = Array.isArray(l) ? l.find((x) => x.id === tid) : null; if (p?.webSocketDebuggerUrl) { wsUrl = p.webSocketDebuggerUrl; break } await new Promise((r) => setTimeout(r, 300)) }
const sock = new WebSocket(wsUrl)
let pid = 0; const pp = new Map()
sock.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pp.has(m.id)) { pp.get(m.id)(m); pp.delete(m.id) } })
const cmd = (m, p = {}) => new Promise((res) => { const i = ++pid; pp.set(i, res); sock.send(JSON.stringify({ id: i, method: m, params: p })) })
await new Promise((r) => sock.addEventListener('open', r))
await cmd('Page.enable'); await cmd('Runtime.enable')
await cmd('Page.addScriptToEvaluateOnNewDocument', { source: inject })

const EXPR = `(() => {
  const q = s => document.querySelector(s)
  const R = el => { const b = el.getBoundingClientRect(); return {x:Math.round(b.left),y:Math.round(b.top),w:Math.round(b.width),h:Math.round(b.height)} }
  const row=q('.workspace-lower-row'), team=q('.workspace-team-card'), status=q('.workspace-status-card')
  const hero=q('.workspace-hero'), ben=q('.workspace-benefits-card')
  if (!row||!team||!status) return JSON.stringify({missing:true})
  const cr=getComputedStyle(row), ct=getComputedStyle(team), cs=getComputedStyle(status)
  return JSON.stringify({ vw:innerWidth, row:R(row), team:R(team), status:R(status), hero:R(hero), ben:R(ben),
    colCount: cr.gridTemplateColumns.split(' ').filter(Boolean).length,
    sameRow: Math.abs(team.getBoundingClientRect().top-status.getBoundingClientRect().top)<2,
    teamMaxW: ct.maxWidth, statusMaxW: cs.maxWidth,
    teamGridCol: ct.gridColumnStart, statusGridCol: cs.gridColumnStart })
})()`

const measure = async (w, h) => {
  await cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
  await cmd('Page.navigate', { url: 'http://127.0.0.1:8045/workspace' })
  await new Promise((r) => setTimeout(r, 2200))
  const r = await cmd('Runtime.evaluate', { expression: EXPR, returnByValue: true })
  return JSON.parse(r.result?.result?.value || '{}')
}

const WIDE = [[1440, 1000], [1280, 1000], [1200, 1000], [1100, 1000], [1000, 1000]]
const NARROW = [[900, 1000], [860, 1000]]

line('===== 1. 宽屏（>900px）：两卡必须并排且与上方卡片同宽 =====')
const wideRes = []
for (const [w, h] of WIDE) {
  const m = await measure(w, h)
  wideRes.push(m)
  if (m.missing) { check(`${w}px 渲染出布局`, false, 'lower-row / team / status 缺失'); continue }
  line(`  · ${m.vw}px  row=${m.row.w}  team=${m.team.w}  status=${m.status.w}  cols=${m.colCount}  sameRow=${m.sameRow}`)
  check(`${w}px 两卡同一行`, m.sameRow === true, `team.y=${m.team.y} status.y=${m.status.y}`)
  check(`${w}px 两栏网格生效`, m.colCount === 2, `colCount=${m.colCount}`)
  check(`${w}px 团队卡未被 570px 限制`, m.teamMaxW === 'none', `max-width=${m.teamMaxW}`)
  check(`${w}px lower-row 与上方卡片同宽`, m.row.w === m.ben.w, `row=${m.row.w} benefits=${m.ben.w}`)
  check(`${w}px 两卡宽度之和 + gap = 行宽`, m.team.w + m.status.w + 22 === m.row.w, `${m.team.w}+${m.status.w}+22 vs ${m.row.w}`)
  check(`${w}px 团队卡比状态卡宽（1.6fr > 1fr）`, m.team.w > m.status.w, `team=${m.team.w} status=${m.status.w}`)
  check(`${w}px 两卡高度一致（align-items:stretch）`, m.team.h === m.status.h, `team.h=${m.team.h} status.h=${m.status.h}`)
}

line('\n===== 2. 窄屏（<=900px）：应优雅退化为竖排 =====')
for (const [w, h] of NARROW) {
  const m = await measure(w, h)
  if (m.missing) { check(`${w}px 渲染出布局`, false); continue }
  line(`  · ${m.vw}px  row=${m.row.w}  team=${m.team.w}  status=${m.status.w}  cols=${m.colCount}  sameRow=${m.sameRow}`)
  check(`${w}px 退化为单列`, m.colCount === 1, `colCount=${m.colCount}`)
  check(`${w}px 两卡等宽（单列占满）`, m.team.w === m.status.w, `team=${m.team.w} status=${m.status.w}`)
  check(`${w}px 两卡均占满行宽`, m.team.w === m.row.w && m.status.w === m.row.w)
  check(`${w}px lower-row 与上方卡片同宽`, m.row.w === m.ben.w)
}

line('\n===== 3. 关键回归点（此前的 bug） =====')
const first = wideRes.find((m) => !m.missing)
if (first) {
  check('★ 团队卡不再横跨整行（grid-column 不是 1/-1）', first.teamGridCol === '1', `grid-column-start=${first.teamGridCol}`)
  check('★ 状态卡独立占第 2 栏', first.statusGridCol === '2', `grid-column-start=${first.statusGridCol}`)
  check('★ 团队卡宽度 < 行宽（没独占整行）', first.team.w < first.row.w, `team=${first.team.w} row=${first.row.w}`)
}

const failed = results.filter((l) => l.includes('FAIL')).length
const total = results.filter((l) => l.includes('PASS') || l.includes('FAIL')).length
line(`\n结果：${total - failed}/${total} 通过`)

sock.close(); bws.close()
try { chrome.kill() } catch {}
fs.writeFileSync(`${ROOT}/_verify_layout_real.txt`, results.join('\n'))
process.exit(failed ? 1 : 0)
