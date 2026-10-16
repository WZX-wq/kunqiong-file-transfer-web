// 线上 /admin 最终验收：真实 Chrome 打开 `${process.env.KQ_LIVE_BASE || 'http://127.0.0.1:8045'}`/admin
// 确认真实站点上「访问 /admin → 居中弹窗 → 输账号密码 → 进后台」全程可用。
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = 'C:/Users/admin/Desktop/鲲穹文件传输web'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const CDP = 9353
const BASE = `${process.env.KQ_LIVE_BASE || 'http://127.0.0.1:8045'}`
const results = []
const line = (s) => { results.push(s); console.log(s) }
const check = (l, p, e = '') => line(`  ${p ? 'PASS' : 'FAIL'}  ${l}${e ? ` — ${e}` : ''}`)
const getJson = (url) => new Promise((res, rej) => {
  const req = http.get(url, { timeout: 5000 }, (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => { try { res(JSON.parse(b)) } catch { res(b) } }) })
  req.on('error', rej); req.on('timeout', () => { req.destroy(); rej(new Error('timeout')) })
})

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${path.join(ROOT, '_chrome_liveadmin')}`, '--no-first-run', '--disable-gpu', '--hide-scrollbars', '--disable-extensions'], { stdio: 'ignore' })
let ready = false
for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 500)); try { await getJson(`http://127.0.0.1:${CDP}/json/version`); ready = true; break } catch {} }
if (!ready) { line('FAIL Chrome 启动失败'); process.exit(1) }
const ver = await getJson(`http://127.0.0.1:${CDP}/json/version`)
const bws = new WebSocket(ver.webSocketDebuggerUrl)
let id = 0; const pend = new Map()
bws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } })
const bcmd = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); bws.send(JSON.stringify({ id: i, method: m, params: p })) })
await new Promise((r) => bws.addEventListener('open', r))
const t = await bcmd('Target.createTarget', { url: 'about:blank' })
let wsUrl = null
for (let i = 0; i < 20; i++) { const l = await getJson(`http://127.0.0.1:${CDP}/json/list`); const p = Array.isArray(l) ? l.find((x) => x.id === t.result.targetId) : null; if (p?.webSocketDebuggerUrl) { wsUrl = p.webSocketDebuggerUrl; break } await new Promise((r) => setTimeout(r, 300)) }
const sock = new WebSocket(wsUrl)
let pid = 0; const pp = new Map()
sock.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pp.has(m.id)) { pp.get(m.id)(m); pp.delete(m.id) } })
const cmd = (m, p = {}) => new Promise((res) => { const i = ++pid; pp.set(i, res); sock.send(JSON.stringify({ id: i, method: m, params: p })) })
await new Promise((r) => sock.addEventListener('open', r))
await cmd('Page.enable'); await cmd('Runtime.enable')
const evalJs = async (e) => (await cmd('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value
const waitFor = async (sel, tries = 60) => {
  for (let i = 0; i < tries; i++) { if (await evalJs(`!!document.querySelector(${JSON.stringify(sel)})`)) return true; await new Promise((r) => setTimeout(r, 300)) }
  return false
}
const shot = async (n) => { const r = await cmd('Page.captureScreenshot', { format: 'png' }); if (r.result?.data) fs.writeFileSync(path.join(ROOT, n), Buffer.from(r.result.data, 'base64')) }

line(`===== 线上验收：${BASE}/admin =====`)
await cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await cmd('Page.navigate', { url: `${BASE}/admin` })
check('★ 线上 /admin 弹出管理员登录框', await waitFor('.admin-login-modal'))
const g = JSON.parse(await evalJs(`(() => {
  const m=document.querySelector('.admin-login-modal'), b=document.querySelector('.admin-login-backdrop')
  if(!m) return '{}'
  const r=m.getBoundingClientRect(), rb=b.getBoundingClientRect(), cs=getComputedStyle(b)
  return JSON.stringify({ vw:innerWidth, vh:innerHeight, modal:{x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)},
    backdrop:{w:Math.round(rb.width),h:Math.round(rb.height)}, position:cs.position, title:(document.querySelector('#admin-login-title')||{}).textContent||'',
    hasShell: !!document.querySelector('.public-shell') })
})()`))
line(`  视口 ${g.vw}x${g.vh}  弹窗 ${JSON.stringify(g.modal)}`)
check('★ 弹窗水平居中', Math.abs((g.modal.x + g.modal.w / 2) - g.vw / 2) <= 2, `${g.modal.x + g.modal.w / 2} vs ${g.vw / 2}`)
check('★ 弹窗垂直居中', Math.abs((g.modal.y + g.modal.h / 2) - g.vh / 2) <= 2, `${g.modal.y + g.modal.h / 2} vs ${g.vh / 2}`)
check('★ 遮罩铺满且 fixed', g.backdrop.w >= g.vw - 1 && g.position === 'fixed', `${JSON.stringify(g.backdrop)} ${g.position}`)
check('★ 标题为「管理员登录」', g.title === '管理员登录', g.title)
check('★ 有完整页面骨架', g.hasShell)
await shot('qa-admin-live-login.png')

line('-- 错误口令 --')
await evalJs(`(() => {
  const set=(el,v)=>{Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))}
  set(document.querySelector('.admin-login-field input[autocomplete=username]'),'ljxkjadmin')
  set(document.querySelector('.admin-login-password input'),'wrong-123')
  document.querySelector('.admin-login-modal').requestSubmit()
})()`)
check('★ 错误口令显示报错', await waitFor('.admin-login-error'))
check('★ 错误口令未进后台', !(await evalJs(`!!document.querySelector('.admin-page')`)))

line('-- 正确口令 --')
await evalJs(`(() => {
  const set=(el,v)=>{Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))}
  set(document.querySelector('.admin-login-field input[autocomplete=username]'),'ljxkjadmin')
  set(document.querySelector('.admin-login-password input'),process.env.KUNQIONG_ADMIN_PASSWORD)
  document.querySelector('.admin-login-modal').requestSubmit()
})()`)
check('★ 正确口令进入线上后台', await waitFor('.admin-page'))
const info = JSON.parse(await evalJs(`JSON.stringify({id:(document.querySelector('.admin-identity')||{}).textContent||'',tabs:document.querySelectorAll('.admin-tabs button').length,modal:!!document.querySelector('.admin-login-modal')})`))
line(`  身份：${info.id.trim()}`)
check('★ 显示管理员身份', info.id.includes('ljxkjadmin'), info.id.trim())
check('★ 后台模块已渲染', info.tabs >= 4, `tabs=${info.tabs}`)
check('★ 登录框已关闭', !info.modal)
await shot('qa-admin-live-dashboard.png')

const failed = results.filter((l) => l.includes('FAIL')).length
const total = results.filter((l) => /PASS|FAIL/.test(l)).length
line(`\n结果：${total - failed}/${total} 通过`)
fs.writeFileSync(path.join(ROOT, '_admin_live.txt'), results.join('\n'))
try { chrome.kill() } catch {}
await new Promise((r) => setTimeout(r, 500))
try { fs.rmSync(path.join(ROOT, '_chrome_liveadmin'), { recursive: true, force: true }) } catch {}
process.exit(failed ? 1 : 0)
