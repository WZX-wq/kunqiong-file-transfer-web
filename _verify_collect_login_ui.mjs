// 真实 Chrome 验证收集页「登录后提交」UI：身份卡渲染 + 徽标几何 + 截图
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9351
const out = []
const line = (s) => { out.push(s); fs.writeFileSync(path.join(ROOT, '_collect_login_ui.txt'), out.join('\n')); console.log(s) }
fs.writeFileSync(path.join(ROOT, '_collect_login_ui.txt'), '')

const getJson = (url) => new Promise((res, rej) => {
  const req = http.get(url, { timeout: 4000 }, (r) => {
    let b = ''; r.on('data', (c) => (b += c))
    r.on('end', () => { try { res(JSON.parse(b)) } catch { res(b) } })
  })
  req.on('error', rej)
  req.on('timeout', () => { req.destroy(); rej(new Error('timeout')) })
})

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${ROOT}\\_chrome_collect_login`,
  '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--hide-scrollbars', '--disable-extensions',
], { stdio: 'ignore' })

let ready = false
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 500))
  try { await getJson(`http://127.0.0.1:${PORT}/json/version`); ready = true; break } catch {}
}
if (!ready) { line('Chrome 未就绪'); process.exit(1) }

const ver = await getJson(`http://127.0.0.1:${PORT}/json/version`)
const bws = new WebSocket(ver.webSocketDebuggerUrl)
let id = 0; const pend = new Map()
bws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } })
const bcmd = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); bws.send(JSON.stringify({ id: i, method, params })) })
await new Promise((r) => bws.addEventListener('open', r))

const t = await bcmd('Target.createTarget', { url: 'about:blank' })
const tid = t.result.targetId

let wsUrl = null
for (let i = 0; i < 20; i++) {
  const l = await getJson(`http://127.0.0.1:${PORT}/json/list`)
  const p = Array.isArray(l) ? l.find((x) => x.id === tid) : null
  if (p?.webSocketDebuggerUrl) { wsUrl = p.webSocketDebuggerUrl; break }
  await new Promise((r) => setTimeout(r, 300))
}
if (!wsUrl) { line('拿不到 page ws'); process.exit(1) }

const sock = new WebSocket(wsUrl)
let pid = 0; const pp = new Map()
sock.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pp.has(m.id)) { pp.get(m.id)(m); pp.delete(m.id) } })
const cmd = (method, params = {}) => new Promise((res) => { const i = ++pid; pp.set(i, res); sock.send(JSON.stringify({ id: i, method, params })) })
await new Promise((r) => sock.addEventListener('open', r))

await cmd('Page.enable')
await cmd('Runtime.enable')

const COLLECTION = {
  id: 'col1', token: 'tok1', title: '第 12 周设计稿收集', description: '请提交本周的设计稿',
  deadline: new Date(Date.now() + 7 * 86400000).toISOString(),
  allowedTypes: 'all', maxFileSizeMb: 500, status: 'active', submissionCount: 0,
  publicUrl: 'http://localhost:8045/collect/tok1', qrDataUrl: '', enterpriseUrl: '',
}

const inject = (loggedIn) => `(function(){
  const COLL = ${JSON.stringify(JSON.stringify(COLLECTION))};
  const USER = ${JSON.stringify(JSON.stringify({ id: 'u_wxz', nickname: '王小张', username: 'wxz', email: 'wxz@kunqiong.com', avatar: null, avatarSource: '', providerAvatar: null, planId: 'free' }))};
  const of = window.fetch;
  window.fetch = function(u, o){
    const s = String(u && u.url ? u.url : u);
    const ok = (body) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    if (s.includes('/api/collections/')) return ok({ collection: JSON.parse(COLL) });
    if (s.includes('/api/auth/me')) return ok({ user: ${loggedIn ? 'JSON.parse(USER)' : 'null'} });
    if (s.includes('/api/organizations/')) return ok({ available: false, reason: 'unavailable' });
    if (s.includes('/api/runtime-config')) return ok({ defaultShareDays: '7' });
    if (s.includes('/api/')) return ok({});
    return of.apply(this, arguments);
  };
})();`

const results = []
const check = (name, pass, detail = '') => { results.push({ name, pass }); line(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`) }

const EXPR_LOGGED_IN = `(() => {
  const q = s => document.querySelector(s)
  const R = el => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) } }
  const card = q('.collection-identity')
  if (!card) return JSON.stringify({ missing: true, body: document.body.innerText.slice(0, 400) })
  const drop = q('.public-drop')
  const label = q('.public-label')
  const btn = q('.collection-identity-switch')
  const avatar = q('.collection-identity-avatar .user-avatar')
  const eye = q('.collection-identity-copy strong')
  return JSON.stringify({
    card: R(card), drop: R(drop), btn: btn ? R(btn) : null,
    cardVisible: card.getBoundingClientRect().width > 0 && card.getBoundingClientRect().height > 0,
    hasManualInput: Boolean(label),
    eyeText: eye ? eye.textContent : '',
    avatarRendered: Boolean(avatar),
    switchText: btn ? btn.textContent : '',
    cardAboveDrop: card.getBoundingClientRect().bottom <= drop.getBoundingClientRect().top + 1,
    copyText: (q('.collection-identity-copy') || {}).innerText || '',
  })
})()`

const EXPR_ANON = `(() => {
  const q = s => document.querySelector(s)
  const R = el => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) } }
  const card = q('.collection-identity')
  if (!card) return JSON.stringify({ missing: true })
  const label = q('.public-label')
  const loginBtn = q('.collection-identity-login')
  const input = label ? label.querySelector('input') : null
  return JSON.stringify({
    card: R(card),
    hasManualInput: Boolean(input),
    inputVisible: input ? input.getBoundingClientRect().height > 0 : false,
    loginBtnText: loginBtn ? loginBtn.textContent : '',
    loginBtn: loginBtn ? R(loginBtn) : null,
    copyText: (q('.collection-identity-copy') || {}).innerText || '',
  })
})()`

const shoot = async (name) => {
  const s = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  if (s.result?.data) fs.writeFileSync(path.join(ROOT, name), Buffer.from(s.result.data, 'base64'))
}

const load = async (loggedIn, width = 1280, height = 1100) => {
  await cmd('Page.addScriptToEvaluateOnNewDocument', { source: inject(loggedIn) })
  await cmd('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  await cmd('Page.navigate', { url: 'http://127.0.0.1:8045/collect/__ui_probe__' })
  await new Promise((r) => setTimeout(r, 2200))
  return cmd('Runtime.evaluate', { expression: loggedIn ? EXPR_LOGGED_IN : EXPR_ANON, returnByValue: true })
}

try {
  // ---- 登录态 ----
  let r = await load(true)
  let m = JSON.parse(r.result?.result?.value || '{}')
  if (m.missing) { check('登录态: 身份卡已渲染', false, m.body || '缺少 .collection-identity') }
  else {
    check('登录态: 身份卡已渲染且可见', m.cardVisible, JSON.stringify(m.card))
    check('登录态: 显示账号昵称', m.eyeText === '王小张', `got=${m.eyeText}`)
    check('登录态: 渲染账号头像/首字', m.avatarRendered)
    check('登录态: 不再显示手填输入框', m.hasManualInput === false)
    check('登录态: 提供「改用其他名称」入口', m.switchText.includes('改用其他名称'), `got=${m.switchText}`)
    check('登录态: 身份卡在拖拽区上方', m.cardAboveDrop === true)
    check('登录态: 卡片宽度撑满容器', m.card.w > 400, `w=${m.card.w}`)
    check('登录态: 说明文案包含账号提示', /记录你的鲲穹账号/.test(m.copyText), m.copyText.replace(/\n/g, ' / '))
  }
  await shoot('qa-collect-login-submit.png')

  // ---- 未登录态 ----
  r = await load(false)
  m = JSON.parse(r.result?.result?.value || '{}')
  if (m.missing) { check('未登录: 匿名提示卡已渲染', false) }
  else {
    check('未登录: 显示匿名提示卡', m.card.w > 0)
    check('未登录: 保留手填名称输入框', m.hasManualInput === true && m.inputVisible === true)
    check('未登录: 提供「登录后提交」按钮', m.loginBtnText.includes('登录后提交'), `got=${m.loginBtnText}`)
    check('未登录: 登录按钮宽度撑满卡片', m.loginBtn.w > 380, `w=${m.loginBtn.w}`)
    check('未登录: 说明文案提示可匿名', /匿名提交/.test(m.copyText), m.copyText.replace(/\n/g, ' / '))
  }
  await shoot('qa-collect-anon-submit.png')

  // ---- 窄屏 ----
  r = await load(true, 420, 1000)
  m = JSON.parse(r.result?.result?.value || '{}')
  if (!m.missing) check('窄屏 420px: 身份卡未溢出容器', m.card.w <= 420 - 40 + 2, `cardW=${m.card.w}`)
  await shoot('qa-collect-login-submit-420.png')
} catch (e) {
  line(`脚本异常: ${e.message}`)
} finally {
  const passed = results.filter((x) => x.pass).length
  line(`\n===== ${passed}/${results.length} 通过 =====`)
  for (const x of results.filter((y) => !y.pass)) line(`FAILED: ${x.name}`)
  sock.close(); bws.close()
  try { chrome.kill() } catch {}
  process.exit(0)
}
