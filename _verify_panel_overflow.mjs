// 上传面板长文件名溢出修复验证：真实 Chrome headless + CDP 量几何
// 断言：注入 200 字符长文件名后 —— 1) 页面无横向溢出 2) upload-panel 宽 = transfer-column 宽
// 3) 文件名被 ellipsis 截断 4) 反向移除修复规则后应复现溢出（证明根因与修复有效）
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'

const ROOT = 'C:/Users/admin/Desktop/鲲穹文件传输web'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9345
const out = []
let pass = 0, fail = 0
const line = (s) => { out.push(s); console.log(s) }
const check = (n, c, d) => { c ? pass++ : fail++; line(`  ${c ? 'PASS' : 'FAIL'}  ${n}${d !== undefined ? ' — ' + d : ''}`) }

const getJson = (url) => new Promise((res, rej) => {
  const req = http.get(url, { timeout: 4000 }, (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => { try { res(JSON.parse(b)) } catch { res(b) } }) })
  req.on('error', rej); req.on('timeout', () => { req.destroy(); rej(new Error('timeout')) })
})

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${ROOT}/_chrome_quota_layout`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', '--disable-extensions',
], { stdio: 'ignore' })

let ready = false
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 500))
  try { await getJson(`http://127.0.0.1:${PORT}/json/version`); ready = true; break } catch {}
}
if (!ready) { console.error('Chrome 未就绪'); process.exit(1) }

const ver = await getJson(`http://127.0.0.1:${PORT}/json/version`)
const bws = new WebSocket(ver.webSocketDebuggerUrl)
let id = 0; const pend = new Map()
bws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } })
const bcmd = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); bws.send(JSON.stringify({ id: i, method, params })) })
await new Promise((r) => bws.addEventListener('open', r))
const t = await bcmd('Target.createTarget', { url: 'about:blank' })
let wsUrl = null
for (let i = 0; i < 20; i++) {
  const l = await getJson(`http://127.0.0.1:${PORT}/json/list`)
  const p = Array.isArray(l) ? l.find((x) => x.id === t.result.targetId) : null
  if (p?.webSocketDebuggerUrl) { wsUrl = p.webSocketDebuggerUrl; break }
  await new Promise((r) => setTimeout(r, 300))
}
const sock = new WebSocket(wsUrl)
let pid = 0; const pp = new Map()
sock.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pp.has(m.id)) { pp.get(m.id)(m); pp.delete(m.id) } })
const cmd = (method, params = {}) => new Promise((res) => { const i = ++pid; pp.set(i, res); sock.send(JSON.stringify({ id: i, method, params })) })
await new Promise((r) => sock.addEventListener('open', r))
await cmd('Page.enable')

// 注入「待发送文件」队列：一条 200 字符长名 + 两条普通名（纯 DOM，走真实 CSS 链路）
const SEED = `(() => {
  const panel = document.querySelector('.upload-panel')
  if (!panel) return 'no-panel'
  const longName = 'scenesei1生成一张海报_1692K-高清3行-4行-12格的专业-TVC广告脚本分镜画面整体风格-459cff8b1d2a4f0e9c1d2a4f0e9c1d2a-超长后缀继续延长以突破容器宽度-0123456789-0123456789-0123456789.mp4'
  panel.innerHTML = '<div class="file-queue"><div class="queue-heading"><div><span class="eyebrow">待发送文件</span><h2>19 个文件，准备就绪</h2></div></div><div class="file-list">'
    + '<div class="file-row"><span class="file-type">▊</span><div class="file-info"><strong>' + longName + '</strong><span>MP4 · 4.5 MB</span></div><button class="ghost-icon">✕</button></div>'
    + '<div class="file-row"><span class="file-type">▊</span><div class="file-info"><strong>screensei_tvc_storyboard.png</strong><span>PNG · 1.4 MB</span></div><button class="ghost-icon">✕</button></div>'
    + '</div></div>'
  return 'seeded'
})()`

const MEASURE = `(() => {
  const q = (s) => document.querySelector(s)
  const R = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { w: Math.round(b.width), left: Math.round(b.left), right: Math.round(b.right) } }
  const panel = q('.upload-panel'), col = q('.transfer-column'), strong = q('.file-queue .file-info strong'), hint = q('.guest-quota-hint')
  return JSON.stringify({
    vw: innerWidth,
    pageScrollW: document.documentElement.scrollWidth,
    panel: R(panel), col: R(col), hint: hint ? R(hint) : null,
    nameTruncated: strong ? strong.scrollWidth > strong.clientWidth + 1 : null,
    nameClientW: strong ? strong.clientWidth : null,
  })
})()`

const runAt = async (w, h) => {
  await cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
  await cmd('Page.navigate', { url: 'http://127.0.0.1:8045/' })
  await new Promise((r) => setTimeout(r, 1800))
  await cmd('Runtime.evaluate', { expression: SEED })
  const r = await cmd('Runtime.evaluate', { expression: MEASURE, returnByValue: true })
  return JSON.parse(r.result?.result?.value || '{}')
}

const disableFix = async () => {
  // 反向对照：移除「9. 溢出修复」块的 grid-template-columns 约束，模拟修复前
  await cmd('Runtime.evaluate', { expression: `(() => {
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules } catch { continue }
      for (const rule of rules || []) {
        if (rule.selectorText === '.upload-panel' && /minmax\\(0, 1fr\\)/.test(rule.style.gridTemplateColumns)) {
          rule.style.gridTemplateColumns = ''; return 'disabled'
        }
      }
    }
    return 'not-found'
  })()`, returnByValue: true })
}

line('===== 上传面板长文件名溢出验证 =====')
for (const [w, h] of [[1440, 900], [1200, 900], [1024, 900]]) {
  const m = await runAt(w, h)
  if (m.vw === undefined) { check(`${w}px 页面加载`, false, JSON.stringify(m)); continue }
  check(`${w}px 页面无横向溢出`, m.pageScrollW <= m.vw + 1, `scrollW=${m.pageScrollW} vw=${m.vw}`)
  check(`${w}px 面板宽=中列宽(不超容器)`, Math.abs(m.panel.w - m.col.w) <= 2, `panel=${m.panel.w} col=${m.col.w}`)
  check(`${w}px 长文件名被 ellipsis 截断`, m.nameTruncated === true, `nameClientW=${m.nameClientW}`)
}

// 反向对照：独立导航到 1440px → seed → 注入 revert 覆盖样式（还原「9.」修复块全部规则）→ 不重载直接测量
await cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await cmd('Page.navigate', { url: 'http://127.0.0.1:8045/' })
await new Promise((r) => setTimeout(r, 1800))
await cmd('Runtime.evaluate', { expression: SEED })
await cmd('Runtime.evaluate', { expression: `(() => {
  const s = document.createElement('style'); s.id = 'revert-fix'
  s.textContent = '.revert-fix .upload-panel { grid-template-columns: auto !important; } .revert-fix .file-queue, .revert-fix .share-result { min-width: auto !important; max-width: none !important; } .revert-fix .file-row { min-width: auto !important; }'
  document.head.appendChild(s); document.documentElement.classList.add('revert-fix')
  return 'reverted'
})()`, returnByValue: true })
const m2raw = await cmd('Runtime.evaluate', { expression: MEASURE, returnByValue: true })
const m2 = JSON.parse(m2raw.result?.result?.value || '{}')
check('反向对照：还原修复规则后 1440px 复现横向溢出（证明根因）', m2.pageScrollW > m2.vw + 1, `scrollW=${m2.pageScrollW} vw=${m2.vw} panel=${m2.panel?.w} col=${m2.col?.w}`)

// 截图复核（带修复状态重新加载）
const m3 = await runAt(1440, 900)
const shot = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
if (shot.result?.data) fs.writeFileSync(`${ROOT}/_quota_layout_fix.png`, Buffer.from(shot.result.data, 'base64'))

sock.close(); bws.close()
try { chrome.kill() } catch {}
line('')
line(`结果：${pass}/${pass + fail}`)
fs.writeFileSync(`${ROOT}/_quota_layout_verify.txt`, out.join('\n'))
process.exit(fail ? 1 : 0)
