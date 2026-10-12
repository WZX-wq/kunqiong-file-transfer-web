// 后台登录页真实浏览器验收：起一个干净实例（独立端口 + 独立 storage + 指向最新 dist），
// 用真实 Chrome 走完「访问 /admin → 看到居中弹窗 → 输错口令报错 → 输对口令进后台 → 退出」。
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const ROOT = 'C:/Users/admin/Desktop/鲲穹文件传输web'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const APP_PORT = 8098
const CDP_PORT = 9351
const ADMIN_USER = 'ljxkjadmin'
const ADMIN_PASS = 'jxljxkj009900'
const results = []
const line = (s) => { results.push(s); console.log(s) }
const check = (l, p, e = '') => line(`  ${p ? 'PASS' : 'FAIL'}  ${l}${e ? ` — ${e}` : ''}`)

const getJson = (url) => new Promise((res, rej) => {
  const req = http.get(url, { timeout: 5000 }, (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => { try { res(JSON.parse(b)) } catch { res(b) } }) })
  req.on('error', rej); req.on('timeout', () => { req.destroy(); rej(new Error('timeout')) })
})

// —— 起干净实例：拷贝最新源码 + 指向最新 dist ——
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'kq-adminui-'))
fs.mkdirSync(path.join(sandbox, 'storage'), { recursive: true })
fs.copyFileSync(path.join(ROOT, 'server.mjs'), path.join(sandbox, 'server.mjs'))
try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(sandbox, 'node_modules'), 'junction') } catch {}
try { fs.symlinkSync(path.join(ROOT, 'dist'), path.join(sandbox, 'dist'), 'junction') } catch {}
fs.writeFileSync(path.join(sandbox, 'storage', 'metadata.json'), JSON.stringify({
  users: {}, sessions: [], organizations: {}, shares: [], collections: [], messages: {}, auditLogs: [], systemConfig: {},
}, null, 2))

const env = {
  ...process.env,
  PORT: String(APP_PORT),
  NODE_ENV: 'test',
  KUNQIONG_DB_ENABLED: 'false',
  KUNQIONG_ADMIN_USERNAME: ADMIN_USER,
  KUNQIONG_ADMIN_PASSWORD: ADMIN_PASS,
  // 故意配上白名单：真实浏览器里也要确认它不再构成后台入口
  KUNQIONG_ADMIN_USER_IDS: process.env.KQ_ADMIN_USER_ID || 'fixture-admin-id',
  KUNQIONG_TEST_ENFORCE_ENTERPRISE_ALLOWLIST: 'false',
  OAUTH_CLIENT_ID: '',
  OAUTH_CLIENT_SECRET: '',
}
const app = spawn('C:/Users/admin/.workbuddy/binaries/node/versions/22.22.2-3/node.exe', [path.join(sandbox, 'server.mjs')], {
  cwd: sandbox, env, stdio: 'ignore', detached: false,
})
let appUp = false
for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 400)); try { const r = await fetch(`http://127.0.0.1:${APP_PORT}/api/health`); if (r.ok) { appUp = true; break } } catch {} }
if (!appUp) { line('FAIL 应用实例启动失败'); fs.writeFileSync(path.join(ROOT, '_admin_ui.txt'), results.join('\n')); process.exit(1) }
line(`应用实例已启动 http://127.0.0.1:${APP_PORT}`)

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${path.join(ROOT, '_chrome_admin')}`, '--no-first-run', '--disable-gpu', '--hide-scrollbars', '--disable-extensions'], { stdio: 'ignore' })
let ready = false
for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 500)); try { await getJson(`http://127.0.0.1:${CDP_PORT}/json/version`); ready = true; break } catch {} }
if (!ready) { line('FAIL Chrome 启动失败'); process.exit(1) }
const ver = await getJson(`http://127.0.0.1:${CDP_PORT}/json/version`)
const bws = new WebSocket(ver.webSocketDebuggerUrl)
let id = 0; const pend = new Map()
bws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } })
const bcmd = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); bws.send(JSON.stringify({ id: i, method: m, params: p })) })
await new Promise((r) => bws.addEventListener('open', r))
const t = await bcmd('Target.createTarget', { url: 'about:blank' })
let wsUrl = null
for (let i = 0; i < 20; i++) { const l = await getJson(`http://127.0.0.1:${CDP_PORT}/json/list`); const p = Array.isArray(l) ? l.find((x) => x.id === t.result.targetId) : null; if (p?.webSocketDebuggerUrl) { wsUrl = p.webSocketDebuggerUrl; break } await new Promise((r) => setTimeout(r, 300)) }
const sock = new WebSocket(wsUrl)
let pid = 0; const pp = new Map()
sock.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pp.has(m.id)) { pp.get(m.id)(m); pp.delete(m.id) } })
const cmd = (m, p = {}) => new Promise((res) => { const i = ++pid; pp.set(i, res); sock.send(JSON.stringify({ id: i, method: m, params: p })) })
await new Promise((r) => sock.addEventListener('open', r))
await cmd('Page.enable'); await cmd('Runtime.enable')

const evalJs = async (expr) => (await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value
const waitFor = async (sel, tries = 40) => {
  for (let i = 0; i < tries; i++) {
    if (await evalJs(`!!document.querySelector(${JSON.stringify(sel)})`)) return true
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}
const shot = async (name) => {
  const r = await cmd('Page.captureScreenshot', { format: 'png' })
  if (r.result?.data) fs.writeFileSync(path.join(ROOT, name), Buffer.from(r.result.data, 'base64'))
}

line('\n===== 真实浏览器：/admin 登录流程 =====')
await cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await cmd('Page.navigate', { url: `http://127.0.0.1:${APP_PORT}/admin` })
const gotModal = await waitFor('.admin-login-modal')
check('★ 访问 /admin 弹出管理员登录框', gotModal)

// 弹窗居中 + 尺寸
const geom = JSON.parse(await evalJs(`(() => {
  const m = document.querySelector('.admin-login-modal')
  const b = document.querySelector('.admin-login-backdrop')
  if (!m || !b) return '{}'
  const r = m.getBoundingClientRect(), rb = b.getBoundingClientRect()
  const cs = getComputedStyle(b)
  return JSON.stringify({
    vw: innerWidth, vh: innerHeight,
    modal: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    backdrop: { w: Math.round(rb.width), h: Math.round(rb.height) },
    position: cs.position, display: cs.display,
    hasUser: !!document.querySelector('.admin-login-field input[autocomplete=username]'),
    hasPass: !!document.querySelector('.admin-login-password input'),
    title: (document.querySelector('#admin-login-title')||{}).textContent || '',
    hasShell: !!document.querySelector('.public-shell'),
  })
})()`))
line(`  视口 ${geom.vw}x${geom.vh}  弹窗 ${JSON.stringify(geom.modal)}  遮罩 ${JSON.stringify(geom.backdrop)}`)
check('★ 弹窗水平居中', Math.abs((geom.modal.x + geom.modal.w / 2) - geom.vw / 2) <= 2, `中心 ${geom.modal.x + geom.modal.w / 2} vs ${geom.vw / 2}`)
check('★ 弹窗垂直居中', Math.abs((geom.modal.y + geom.modal.h / 2) - geom.vh / 2) <= 2, `中心 ${geom.modal.y + geom.modal.h / 2} vs ${geom.vh / 2}`)
check('★ 遮罩铺满视口', geom.backdrop.w >= geom.vw - 1 && geom.backdrop.h >= geom.vh - 1, JSON.stringify(geom.backdrop))
check('★ 遮罩为 fixed 定位', geom.position === 'fixed', geom.position)
check('★ 有账号输入框', geom.hasUser)
check('★ 有密码输入框', geom.hasPass)
check('★ 标题为「管理员登录」', geom.title === '管理员登录', geom.title)
check('★ 弹窗背后有完整页面骨架（顶栏/页脚）', geom.hasShell)
await shot('qa-admin-login.png')

// —— 输错口令 ——
line('\n-- 错误口令 --')
await evalJs(`(() => {
  const set = (el, v) => {
    const proto = Object.getPrototypeOf(el)
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  set(document.querySelector('.admin-login-field input[autocomplete=username]'), ${JSON.stringify(ADMIN_USER)})
  set(document.querySelector('.admin-login-password input'), 'wrong-password-123')
  document.querySelector('.admin-login-modal').requestSubmit()
})()`)
await waitFor('.admin-login-error')
const errText = await evalJs(`(document.querySelector('.admin-login-error')||{}).textContent || ''`)
check('★ 错误口令显示报错提示', /不正确|失败/.test(errText), errText.trim())
const stillModal = await evalJs(`!!document.querySelector('.admin-login-modal')`)
check('★ 错误口令仍停留在登录框', stillModal)
const noOverview = await evalJs(`!!document.querySelector('.admin-page')`)
check('★ 错误口令未进入后台', !noOverview)
await shot('qa-admin-login-error.png')

// —— 输对口令 ——
line('\n-- 正确口令 --')
await evalJs(`(() => {
  const set = (el, v) => {
    const proto = Object.getPrototypeOf(el)
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  set(document.querySelector('.admin-login-field input[autocomplete=username]'), ${JSON.stringify(ADMIN_USER)})
  set(document.querySelector('.admin-login-password input'), ${JSON.stringify(ADMIN_PASS)})
  document.querySelector('.admin-login-modal').requestSubmit()
})()`)
const gotAdmin = await waitFor('.admin-page')
check('★ 正确口令进入后台', gotAdmin)
const adminInfo = JSON.parse(await evalJs(`(() => {
  const el = document.querySelector('.admin-identity')
  return JSON.stringify({
    identity: el ? el.textContent.trim() : '',
    hasTabs: document.querySelectorAll('.admin-tabs button').length,
    hasLoginModal: !!document.querySelector('.admin-login-modal'),
    bodyStart: (document.body.innerText||'').replace(/\\s+/g,' ').slice(0,120),
  })
})()`))
line(`  身份标识：${adminInfo.identity}`)
check('★ 后台显示登录管理员身份', adminInfo.identity.includes(ADMIN_USER), adminInfo.identity)
check('★ 后台标签页已渲染', adminInfo.hasTabs >= 4, `tabs=${adminInfo.hasTabs}`)
check('★ 进入后台后登录框已关闭', !adminInfo.hasLoginModal)
await shot('qa-admin-dashboard.png')

// —— 退出后回到登录框 ——
line('\n-- 退出后台 --')
await evalJs(`(() => {
  const btns = [...document.querySelectorAll('.admin-heading-actions .secondary-button')]
  const out = btns.find(b => /退出后台/.test(b.textContent))
  if (out) out.click()
})()`)
const backToModal = await waitFor('.admin-login-modal')
check('★ 退出后回到登录框', backToModal)

const failed = results.filter((l) => l.includes('FAIL')).length
const total = results.filter((l) => /PASS|FAIL/.test(l)).length
line(`\n结果：${total - failed}/${total} 通过`)
fs.writeFileSync(path.join(ROOT, '_admin_ui.txt'), results.join('\n'))

try { chrome.kill() } catch {}
try { app.kill() } catch {}
await new Promise((r) => setTimeout(r, 500))
try { fs.rmSync(sandbox, { recursive: true, force: true }) } catch {}
try { fs.rmSync(path.join(ROOT, '_chrome_admin'), { recursive: true, force: true }) } catch {}
process.exit(failed ? 1 : 0)
