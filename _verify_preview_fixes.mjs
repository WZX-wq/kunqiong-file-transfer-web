// 验证预览修复：① .jfif 等图片格式可预览 ② 含 EMF 图片的 xlsx 不再整份失败 ③ 其他格式矩阵
import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import XLSX from 'xlsx'
import sharp from 'sharp'

const ROOT = process.cwd()
const SANDBOX = path.join(ROOT, '_preview_fix_sandbox')
const PORT = 8121
const CDP_PORT = 9343
const OUT = 'C:/Users/admin/AppData/Local/Temp/_preview_fix'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const copyDir = (from, to) => {
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name)
    const dst = path.join(to, entry.name)
    if (entry.isDirectory()) copyDir(src, dst)
    else fs.copyFileSync(src, dst)
  }
}

try { fs.rmSync(SANDBOX, { recursive: true, force: true }) } catch {}
fs.mkdirSync(path.join(SANDBOX, 'storage'), { recursive: true })
fs.mkdirSync(OUT, { recursive: true })
copyDir(path.join(ROOT, 'server'), path.join(SANDBOX, 'server'))
fs.copyFileSync(path.join(ROOT, 'server.mjs'), path.join(SANDBOX, 'server.mjs'))
for (const [from, to] of [[path.join(ROOT, 'node_modules'), path.join(SANDBOX, 'node_modules')], [path.join(ROOT, 'dist'), path.join(SANDBOX, 'dist')]]) {
  if (!fs.existsSync(to)) fs.symlinkSync(from, to, 'junction')
}

const now = new Date().toISOString()
const OWNER = 'u_prev'
const mkUser = () => ({
  id: OWNER, username: 'prev_owner', nickname: '测试账号', email: 'prev@example.com', phone: '', avatar: null,
  avatarSource: '', providerAvatar: null, provider: '', loginMethods: ['password'], planId: 'halfyear',
  planStartedAt: '2026-10-19T00:00:00.000Z', planExpiresAt: '2027-04-19T00:00:00.000Z',
  organizationId: '', organizationRole: '', status: 'active', fileCleanup: { enabled: false, days: 3 }, createdAt: now, updatedAt: now,
})
fs.writeFileSync(path.join(SANDBOX, 'storage', 'metadata.json'), JSON.stringify({
  users: { [OWNER]: mkUser() }, sessions: [{ id: 'sess_prev', expiresAt: new Date(Date.now() + 86400000).toISOString(), createdAt: now, apiWebToken: '', user: mkUser() }],
  organizations: {}, shares: [], collections: [], records: [], messages: {}, uploadSessions: {}, auditLogs: [], joinRequests: [],
  upgradeOrders: [], verificationCodes: [], guestUsage: {}, systemConfig: { siteName: '鲲穹', registrationOpen: true },
}, null, 2))

const { spawn } = await import('node:child_process')
const server = spawn(process.execPath, ['server.mjs'], {
  cwd: SANDBOX, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', KUNQIONG_DB_ENABLED: 'false', NODE_ENV: 'production', KUNQIONG_SCAN_MODE: 'required', KUNQIONG_CLAMAV_HOST: '127.0.0.1', KUNQIONG_CLAMAV_PORT: '3310' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
await new Promise((resolve, reject) => {
  const t0 = Date.now()
  const tick = setInterval(async () => {
    if (Date.now() - t0 > 25000) { clearInterval(tick); reject(new Error('服务启动超时')) }
    try { if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok) { clearInterval(tick); resolve() } } catch {}
  }, 250)
})
console.log('沙箱服务已启动')

const BASE = `http://127.0.0.1:${PORT}`
const api = (p, init = {}) => fetch(`${BASE}${p}`, { ...init, headers: { Cookie: 'kunqiong_session=sess_prev', ...(init.headers || {}) } })

// ---------- 造各种格式的文件 ----------
const jpegBytes = await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 40, g: 90, b: 200 } } }).jpeg().toBuffer()
const pngBytes = await sharp({ create: { width: 12, height: 12, channels: 3, background: { r: 200, g: 80, b: 40 } } }).png().toBuffer()
const webpBytes = await sharp({ create: { width: 12, height: 12, channels: 3, background: { r: 20, g: 160, b: 90 } } }).webp().toBuffer()
const bmpBytes = (() => {
  const b = Buffer.alloc(54 + 2 * 2 * 3, 0)
  b.write('BM', 0); b.writeUInt32LE(b.length, 2); b.writeUInt32LE(54, 10); b.writeUInt32LE(40, 14)
  b.writeInt32LE(2, 18); b.writeInt32LE(2, 22); b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28); b.writeUInt32LE(b.length - 54, 34)
  return b
})()
const icoBytes = (() => {
  const w = 16, h = 16, payload = 40 + w * h * 4 + h * 4
  const b = Buffer.alloc(6 + 16 + payload, 0)
  b.writeUInt16LE(0, 0); b.writeUInt16LE(1, 2); b.writeUInt16LE(1, 4)
  b[6] = w; b[7] = h; b.writeUInt16LE(1, 10); b.writeUInt16LE(32, 12); b.writeUInt32LE(payload, 14); b.writeUInt32LE(22, 18)
  b.writeUInt32LE(40, 22); b.writeInt32LE(w, 26); b.writeInt32LE(h * 2, 30); b.writeUInt16LE(1, 34); b.writeUInt16LE(32, 36); b.writeUInt32LE(payload - 40, 42)
  return b
})()
const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF')
const txtBytes = Buffer.from('这是一份纯文本预览测试。\nline 2', 'utf8')
const csvBytes = Buffer.from('\ufeff姓名,部门\n张三,设计\n', 'utf8')
const xlsxBytes = XLSX.write({ SheetNames: ['花名册'], Sheets: { 花名册: XLSX.utils.aoa_to_sheet([['员工', '部门'], ['张三', '设计'], ['李四', '市场']]) } }, { type: 'buffer', bookType: 'xlsx' })
const xlsxEmfBytes = await (async () => {
  const zip = await JSZip.loadAsync(xlsxBytes)
  zip.file('xl/media/image1.emf', Uint8Array.from([0x01, 0, 0, 0, 0x6c, 0, 0, 0, 0, 0, 0, 0]))
  return Buffer.from(await zip.generateAsync({ type: 'arraybuffer' }))
})()

const files = [
  ['活动照片.jpeg~tplv-a9rns2rl98-image.jfif', jpegBytes],
  ['示例图片.png', pngBytes],
  ['示例图片.webp', webpBytes],
  ['示例图片.bmp', bmpBytes],
  ['站点图标.ico', icoBytes],
  ['说明文档.pdf', pdfBytes],
  ['说明文本.txt', txtBytes],
  ['花名册.csv', csvBytes],
  ['员工花名册管理.xlsx', xlsxBytes],
  ['员工花名册管理-含图片.xlsx', xlsxEmfBytes],
]
const fd = new FormData()
for (const [name, buf] of files) fd.append('files', new File([buf], name, { type: '' }))
fd.append('expiryDays', '7')
const shareRes = await api('/api/shares', { method: 'POST', body: fd })
const shareJson = await shareRes.json()
if (!shareRes.ok) throw new Error('创建分享失败 ' + JSON.stringify(shareJson))
const share = shareJson.share
console.log('分享已创建:', share.id, '| 文件数:', share.files.length)

// ---------- ① 服务端预览矩阵 ----------
console.log('\n=== ① 预览接口矩阵 ===')
for (let i = 0; i < share.files.length; i += 1) {
  const r = await fetch(`${BASE}/api/shares/${share.id}/files/${i}/preview`)
  console.log(`${String(i).padStart(2)} ${share.files[i].name.padEnd(38)} → ${r.status} ${r.headers.get('content-type') || ''} | X-Preview-Type=${r.headers.get('x-preview-type') || '-'}${r.ok ? '' : ' | ' + (await r.text()).slice(0, 80)}`)
}

// ---------- ② 浏览器：真实打开图片预览与含 EMF 的 xlsx 预览 ----------
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => fs.existsSync(p))
const profileDir = path.join(SANDBOX, 'chrome-profile')
fs.mkdirSync(profileDir, { recursive: true })
const chrome = spawn(CHROME, [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profileDir}`, '--headless=new', '--no-first-run', '--disable-gpu', '--no-proxy-server', '--window-size=1440,900', '--hide-scrollbars', 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] })
let targets = null
for (let i = 0; i < 60 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json() } catch { await sleep(250) } }
const ws = new WebSocket(targets.find((t) => t.type === 'page')?.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let msgId = 0
const pending = new Map()
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params = {}) => new Promise((res) => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })) })
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300))
  return r.result?.result?.value
}
await send('Page.enable'); await send('Runtime.enable')

await send('Page.navigate', { url: `${BASE}/share/${share.id}` })
await sleep(3000)

async function openPreview(namePart) {
  const clicked = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('.file-row, .public-file-row, .file-item')]
    const row = rows.find((r) => (r.textContent || '').includes('${namePart}'))
    if (!row) return 'row-not-found'
    const btn = [...row.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '').includes('预览') || (b.getAttribute('title') || '').includes('预览'))
    if (!btn) return 'btn-not-found'
    btn.click(); return 'clicked'
  })()`)
  await sleep(1200)
  return clicked
}

console.log('\n=== ② 浏览器实测 ===')
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent||'').includes('预览')); return b ? 'has-preview-btn' : 'no-btn' })()`)

// jfif 图片（轮询等待图片真正解码完成）
await evaluate(`(() => { window.__imgErr = ''; const iv = setInterval(() => { const img = document.querySelector('.preview-image'); if (!img) return; if (!img.__bound) { img.__bound = true; img.addEventListener('error', () => { window.__imgErr = 'error event' }) } if (img.complete && img.naturalWidth > 0) clearInterval(iv) }, 200); return true })()`)
const jfifOpen = await openPreview('image.jfif')
const jfifState = await evaluate(`(async () => {
  for (let i = 0; i < 30; i++) {
    const img = document.querySelector('.preview-image')
    if (img && img.complete && img.naturalWidth > 0) return { found: true, loaded: true, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, src: (img.getAttribute('src') || '').slice(0, 60) }
    if (document.querySelector('.preview-error')) return { found: false, error: document.querySelector('.preview-error').innerText.slice(0, 100) }
    await new Promise((r) => setTimeout(r, 200))
  }
  const img = document.querySelector('.preview-image')
  return { found: !!img, loaded: false, complete: img?.complete, naturalWidth: img?.naturalWidth, imgErr: window.__imgErr, src: (img?.getAttribute('src') || '').slice(0, 60) }
})()`)
console.log('jfif 预览:', jfifOpen, JSON.stringify(jfifState))
await evaluate(`(() => { const c = document.querySelector('.modal-close'); if (c) c.click(); return true })()`)
await sleep(500)

// 含 EMF 的 xlsx
const xlsxOpen = await openPreview('含图片.xlsx')
await sleep(2500)
const xlsxState = await evaluate(`(() => {
  const sheet = document.querySelector('.spreadsheet-preview')
  const err = document.querySelector('.preview-error')
  return { sheetMounted: !!sheet, hasTable: !!(sheet && sheet.querySelector('table')), error: err ? err.innerText.slice(0, 120) : '', text: sheet ? sheet.innerText.slice(0, 80) : '' }
})()`)
console.log('xlsx(含EMF) 预览:', xlsxOpen, JSON.stringify(xlsxState))
const shot = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync(path.join(OUT, 'xlsx-emf-preview.png'), Buffer.from(shot.result.data, 'base64'))
await evaluate(`(() => { const c = document.querySelector('.modal-close'); if (c) c.click(); return true })()`)
await sleep(500)

// 普通 xlsx
const plainOpen = await openPreview('员工花名册管理.xlsx')
await sleep(2500)
const plainState = await evaluate(`(() => {
  const sheet = document.querySelector('.spreadsheet-preview')
  return { sheetMounted: !!sheet, hasTable: !!(sheet && sheet.querySelector('table')), error: document.querySelector('.preview-error')?.innerText?.slice(0, 80) || '' }
})()`)
console.log('xlsx(普通) 预览:', plainOpen, JSON.stringify(plainState))

ws.close(); chrome.kill(); server.kill('SIGTERM')
console.log('\ndone')
