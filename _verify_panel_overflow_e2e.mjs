// 端到端验证：CDP DOM.setFileInputFiles 塞真实文件 → React 完整状态 → 量面板几何
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = 'C:/Users/admin/Desktop/鲲穹文件传输web'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9346
const out = []
let pass = 0, fail = 0
const line = (s) => { out.push(s); console.log(s) }
const check = (n, c, d) => { c ? pass++ : fail++; line(`  ${c ? 'PASS' : 'FAIL'}  ${n}${d !== undefined ? ' — ' + d : ''}`) }

const getJson = (url) => new Promise((res, rej) => {
  const req = http.get(url, { timeout: 4000 }, (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => { try { res(JSON.parse(b)) } catch { res(b) } }) })
  req.on('error', rej); req.on('timeout', () => { req.destroy(); rej(new Error('timeout')) })
})

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${ROOT}/_chrome_quota_layout2`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', '--disable-extensions'], { stdio: 'ignore' })
let ready = false
for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 500)); try { await getJson(`http://127.0.0.1:${PORT}/json/version`); ready = true; break } catch {} }
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
await cmd('Page.enable'); await cmd('DOM.enable')

await cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await cmd('Page.navigate', { url: 'http://127.0.0.1:8045/' })
await new Promise((r) => setTimeout(r, 2000))

// 用 DataTransfer 直接构造 File 列表注入 input[type=file]（绕开路径 260 字符限制，可造任意超长名）
const SEED_FILES = `(() => {
  const inputs = [...document.querySelectorAll('input[type=file]')]
  const input = inputs.find((i) => !i.hasAttribute('webkitdirectory'))
  if (!input) return 'no-input'
  const names = [
    'scenesei1生成一张海报_1692K-高清3行-4行-12格的专业-TVC广告脚本分镜画面整体风格-459cff8b1d2a4f0e9c1d2a4f0e9c1d2a-超长后缀继续延长以突破容器宽度测试用例场景模拟补充更多字符确保足够长够长够长.mp4',
    'ebf914f8978748588e6c8bacbcee01e.mp4',
    'screensei小仓鼠写真实拍照片_17241a.png', '矿泉水.png',
    '这是一个同样非常长的中文文件名用来测试第二组长名对面板宽度的影响-additionally-with-english-suffix-and-numbers-1234567890abcdef-继续追加中文后缀保证极限长度足够撑破任何未约束的容器布局.docx',
    '多级目录结构场景-分镜画面-场景1-镜头1-角色A-台词字幕-背景音乐-特效标注-版本v2-最终版-真最终版-审阅修改后再修改版-再改版-终审版-发布版.psd',
    '第三个超长文件名场景-重复重复重复重复重复重复重复重复重复重复重复重复重复重复重复重复重复重复重复重复重复重复重复重复重复重复重复重复重复重复重复重复重复重复重复重复.bin',
  ]
  const dt = new DataTransfer()
  names.forEach((name, i) => dt.items.add(new File([new Uint8Array(1024 * (i + 1))], name, { type: 'application/octet-stream' })))
  input.files = dt.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
  return 'seeded'
})()`

await cmd('Runtime.evaluate', { expression: SEED_FILES, returnByValue: true })
await new Promise((r) => setTimeout(r, 1200))

const MEASURE = `(() => {
  const q = (s) => document.querySelector(s)
  const R = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { w: Math.round(b.width), left: Math.round(b.left), right: Math.round(b.right) } }
  const rows = [...document.querySelectorAll('.file-queue .file-row')]
  const strong = q('.file-queue .file-info strong')
  const hint = q('.guest-quota-hint')
  return JSON.stringify({
    vw: innerWidth, pageScrollW: document.documentElement.scrollWidth,
    rowCount: rows.length, fileCount: q('.queue-heading h2')?.textContent || '',
    panel: R(q('.upload-panel')), col: R(q('.transfer-column')),
    nameTruncated: strong ? strong.scrollWidth > strong.clientWidth + 1 : null,
    widestRow: Math.max(0, ...rows.map((r) => Math.round(r.getBoundingClientRect().width))),
    hint: hint ? R(hint) : null,
  })
})()`
const measure = async () => JSON.parse((await cmd('Runtime.evaluate', { expression: MEASURE, returnByValue: true })).result?.result?.value || '{}')

line('===== 端到端（真实 19 文件场景模拟，React 状态）=====')
const fixed = await measure()
check('React 接收到文件并渲染队列', fixed.rowCount >= 6, `rows=${fixed.rowCount} ${fixed.fileCount}`)
check('修复态：页面无横向溢出', fixed.pageScrollW <= fixed.vw + 1, `scrollW=${fixed.pageScrollW} vw=${fixed.vw}`)
check('修复态：面板宽=中列宽', Math.abs(fixed.panel.w - fixed.col.w) <= 2, `panel=${fixed.panel.w} col=${fixed.col.w}`)
check('修复态：行宽被约束在面板内', fixed.widestRow <= fixed.panel.w, `row=${fixed.widestRow} panel=${fixed.panel.w}`)
check('修复态：长文件名 ellipsis 截断生效', fixed.nameTruncated === true, 'ok')
check('修复态：游客额度提示条在面板内', fixed.hint && fixed.hint.w <= fixed.panel.w, `hint=${fixed.hint?.w} panel=${fixed.panel.w}`)

// 反向对照：同一真实文件状态下还原修复规则
await cmd('Runtime.evaluate', { expression: `(() => {
  const s = document.createElement('style'); s.id = 'revert-fix'
  s.textContent = '.revert-fix .upload-panel { grid-template-columns: auto !important; } .revert-fix .file-queue, .revert-fix .share-result { min-width: auto !important; max-width: none !important; } .revert-fix .file-row { min-width: auto !important; }'
  document.head.appendChild(s); document.documentElement.classList.add('revert-fix')
  return 'ok'
})()`, returnByValue: true })
const reverted = await measure()
line(`  反向对照数据：scrollW=${reverted.pageScrollW} vw=${reverted.vw} panel=${reverted.panel?.w} col=${reverted.col?.w} widestRow=${reverted.widestRow} nameTruncated=${reverted.nameTruncated}`)
check('反向对照：还原修复规则后出现溢出/截断失效（证明修复有效）', reverted.pageScrollW > reverted.vw + 1 || reverted.nameTruncated === false, `scrollW=${reverted.pageScrollW}`)

const shot = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
if (shot.result?.data) fs.writeFileSync(`${ROOT}/_panel_overflow_e2e.png`, Buffer.from(shot.result.data, 'base64'))

sock.close(); bws.close()
try { chrome.kill() } catch {}
line('')
line(`结果：${pass}/${pass + fail}`)
fs.writeFileSync(`${ROOT}/_panel_overflow_e2e.txt`, out.join('\n'))
process.exit(fail ? 1 : 0)
