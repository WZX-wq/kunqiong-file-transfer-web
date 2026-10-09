// 真实 Chrome 打开「团队邀请链接落地页」，截图 + 测量。
// 目的：jsdom 只能证明 DOM 结构对，证明不了真实浏览器里渲染正常（这是布局 bug 的教训）。
// 同时截一张带 token 的企业分享页做对照，确认邀请页没有污染分享页。
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = 'C:/Users/admin/Desktop/鲲穹文件传输web'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9345
const results = []
const line = (s) => { results.push(s); console.log(s) }

const getJson = (url) => new Promise((res, rej) => {
  const req = http.get(url, { timeout: 4000 }, (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => { try { res(JSON.parse(b)) } catch { res(b) } }) })
  req.on('error', rej); req.on('timeout', () => { req.destroy(); rej(new Error('timeout')) })
})

const joinProbe = { available: true, reason: 'eligible', organizationName: '奶家帮' }
const inject = `(function(){
  const of = window.fetch;
  window.fetch = function(u,o){
    const s = String(u && u.url ? u.url : u);
    const m = String((o && o.method) || 'GET').toUpperCase();
    const J = (b,st) => Promise.resolve(new Response(JSON.stringify(b),{status:st||200,headers:{'Content-Type':'application/json'}}));
    if (s.includes('/api/auth/me')) return J({user:{id:'u_visitor_1',nickname:'访客小王',username:'visitor'}});
    if (s.includes('/join-request')) return m==='POST' ? J({requestId:'req_1',status:'requested'},201) : J(${JSON.stringify(joinProbe)});
    if (s.includes('/api/shares/token/')) return J({share:{id:'sh1',token:'tok123',title:'项目交付文件',senderName:'奶家帮',expiresAt:new Date(Date.now()+259200000).toISOString(),files:[{id:'f1',name:'需求说明.docx',relativePath:'需求说明.docx',size:24576}],status:'active'},requiresPassword:false});
    if (s.includes('/api/')) return J({});
    return of.apply(this,arguments);
  };
})();`

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${ROOT}/_chrome_inv`, '--no-first-run', '--disable-gpu', '--hide-scrollbars', '--disable-extensions'], { stdio: 'ignore' })
let ready = false
for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 500)); try { await getJson(`http://127.0.0.1:${PORT}/json/version`); ready = true; break } catch {} }
if (!ready) { line('FAIL  无法启动 Chrome'); fs.writeFileSync(`${ROOT}/_invite_browser.txt`, results.join('\n')); process.exit(1) }

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
  const hero = q('.team-invite-hero'), card = q('.team-join-card'), grid = q('.workspace-grid')
  const btn = q('.team-join-action')
  return JSON.stringify({
    vw: innerWidth,
    hasInvitePage: !!q('.team-invite-page'),
    hasHero: !!hero, hasJoinCard: !!card, hasGrid: !!grid,
    hero: hero ? R(hero) : null, card: card ? R(card) : null,
    btnText: btn ? btn.textContent.trim() : '',
    heroTitle: hero ? (hero.querySelector('h1')?.textContent || '') : '',
    bodyText: (document.body.innerText || '').replace(/\\s+/g,' ').slice(0, 240),
    overflowing: document.documentElement.scrollWidth > innerWidth + 1,
  })
})()`

const shot = async (name) => {
  const r = await cmd('Page.captureScreenshot', { format: 'png' })
  const b64 = r.result?.data
  if (b64) fs.writeFileSync(path.join(ROOT, name), Buffer.from(b64, 'base64'))
}

// 等页面把加入卡片渲染出来再测量，别用固定 sleep 赌时机。
const waitFor = async (sel, tries = 40) => {
  for (let i = 0; i < tries; i++) {
    const r = await cmd('Runtime.evaluate', { expression: `!!document.querySelector(${JSON.stringify(sel)})`, returnByValue: true })
    if (r.result?.result?.value === true) return true
    await new Promise((r2) => setTimeout(r2, 250))
  }
  return false
}

line('===== 真实浏览器：团队邀请链接落地页 =====')
await cmd('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
await cmd('Page.navigate', { url: 'http://127.0.0.1:8045/e/naijiabang/share/' })
await waitFor('.team-join-card')
await new Promise((r) => setTimeout(r, 600))
let r = await cmd('Runtime.evaluate', { expression: EXPR, returnByValue: true })
let m = JSON.parse(r.result?.result?.value || '{}')
line(`  视口 ${m.vw}  hero=${JSON.stringify(m.hero)}  card=${JSON.stringify(m.card)}`)
const c = (label, pass, extra = '') => line(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`)
c('★ 渲染邀请落地页', m.hasInvitePage)
c('★ 显示加入卡片', m.hasJoinCard)
c('★ 没有落到工作台', !m.hasGrid)
c('标题正确', m.heroTitle === '你收到一个团队空间邀请', m.heroTitle)
c('含团队名', /奶家帮/.test(m.bodyText))
c('有申请按钮', m.btnText.length > 0, `btn="${m.btnText}"`)
c('卡片未溢出视口', !m.overflowing)
await shot('qa-invite-1280.png')

// 窄屏
await cmd('Emulation.setDeviceMetricsOverride', { width: 420, height: 860, deviceScaleFactor: 1, mobile: true })
await cmd('Page.navigate', { url: 'http://127.0.0.1:8045/e/naijiabang/share/' })
await waitFor('.team-join-card')
await new Promise((r) => setTimeout(r, 600))
r = await cmd('Runtime.evaluate', { expression: EXPR, returnByValue: true })
m = JSON.parse(r.result?.result?.value || '{}')
c('★ 窄屏(420) 仍渲染邀请页', m.hasInvitePage)
c('窄屏无横向溢出', !m.overflowing, `scrollW>${m.vw}`)
c('窄屏按钮通栏', m.btn ? m.btn.w <= m.vw : true, `btnW=${m.btn?.w}`)
await shot('qa-invite-420.png')

// 对照：带 token 的企业分享页
await cmd('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
await cmd('Page.navigate', { url: 'http://127.0.0.1:8045/e/naijiabang/share/tok123' })
await waitFor('.share-public-card')
await new Promise((r) => setTimeout(r, 600))
r = await cmd('Runtime.evaluate', { expression: EXPR, returnByValue: true })
m = JSON.parse(r.result?.result?.value || '{}')
c('对照：带 token 仍走分享页（非邀请页）', !m.hasInvitePage, `invitePage=${m.hasInvitePage}`)
c('对照：分享页未落到工作台', !m.hasGrid)
await shot('qa-invite-control-1280.png')

const failed = results.filter((l) => l.includes('FAIL')).length
line(`\n结果：${results.filter((l) => l.includes('PASS')).length}/${results.filter((l) => /PASS|FAIL/.test(l)).length} 通过`)
fs.writeFileSync(`${ROOT}/_invite_browser.txt`, results.join('\n'))
try { chrome.kill() } catch {}
process.exit(failed ? 1 : 0)
