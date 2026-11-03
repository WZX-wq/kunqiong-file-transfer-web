// 验证三处 UI 修复：① 公共头部铃铛非紫红 ② 收集管理文件行操作区对齐 ③ 收集设置弹窗挂 body 且居中
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const NODE = process.execPath
const SANDBOX = path.join(ROOT, '_ui_fix_sandbox')
const PORT = 8119
const CDP_PORT = 9341
const OUT = 'C:/Users/admin/AppData/Local/Temp/_ui_fix'

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

try { fs.rmSync(SANDBOX, { recursive: true, force: true }) } catch { console.log('沙箱残留清理失败，复用目录继续') }
fs.mkdirSync(path.join(SANDBOX, 'storage'), { recursive: true })
fs.mkdirSync(OUT, { recursive: true })
copyDir(path.join(ROOT, 'server'), path.join(SANDBOX, 'server'))
fs.copyFileSync(path.join(ROOT, 'server.mjs'), path.join(SANDBOX, 'server.mjs'))
for (const [from, to] of [[path.join(ROOT, 'node_modules'), path.join(SANDBOX, 'node_modules')], [path.join(ROOT, 'dist'), path.join(SANDBOX, 'dist')]]) {
  if (!fs.existsSync(to)) fs.symlinkSync(from, to, 'junction')
}

const now = new Date().toISOString()
const OWNER = 'u_owner_v'
const ORG = 'org_fix'
const mkUser = () => ({
  id: OWNER, username: 'fix_owner', nickname: '测试账号', email: 'fix@example.com', phone: '', avatar: null,
  avatarSource: '', providerAvatar: null, provider: '', loginMethods: ['password'], planId: 'halfyear',
  planStartedAt: '2026-10-19T06:39:31.000Z', planExpiresAt: '2027-04-19T06:39:31.000Z',
  organizationId: ORG, organizationRole: 'owner', status: 'active', fileCleanup: { enabled: false, days: 3 },
  createdAt: now, updatedAt: now,
})
fs.writeFileSync(path.join(SANDBOX, 'storage', 'metadata.json'), JSON.stringify({
  users: { [OWNER]: mkUser() },
  sessions: [{ id: 'sess_fix', expiresAt: new Date(Date.now() + 86400000).toISOString(), createdAt: now, apiWebToken: '', user: mkUser() }],
  organizations: {
    [ORG]: {
      id: ORG, slug: 'fix-team', name: '测试团队', ownerUserId: OWNER, teamPlanId: 'halfyear',
      teamPlanStartedAt: '2026-10-19T06:39:31.000Z', teamPlanExpiresAt: '2027-04-19T06:39:31.000Z', teamPlanPermanent: false,
      createdAt: now, updatedAt: now,
      members: [{ id: 'm1', userId: OWNER, role: 'owner', status: 'active', displayName: '测试账号', email: 'fix@example.com', phone: '', joinedAt: now }],
    },
  },
  shares: [], collections: [], records: [], messages: {}, uploadSessions: {}, auditLogs: [], joinRequests: [],
  upgradeOrders: [], verificationCodes: [], guestUsage: {}, systemConfig: { siteName: '鲲穹', registrationOpen: true },
}, null, 2))

const { spawn } = await import('node:child_process')
const server = spawn(NODE, ['server.mjs'], {
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

const BASE = `http://127.0.0.1:${PORT}`
const api = (p, sid, init = {}) => fetch(`${BASE}${p}`, { ...init, headers: { Cookie: sid ? `kunqiong_session=${sid}` : '', ...(init.headers || {}) } })
const file = (name, type) => new File([Buffer.from(`演示内容：${name}\n`.repeat(40))], name, { type })

const colRes = await api('/api/collections', 'sess_fix', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'UI 修复验证', description: '验证文件行对齐与弹窗位置', deadline: new Date(Date.now() + 10 * 86400000).toISOString(), maxFileSizeMb: 500 }),
})
const colData = await colRes.json()
if (!colRes.ok) throw new Error('创建收集失败 ' + JSON.stringify(colData))
const COL_TOKEN = colData.collection.token, COL_MANAGE = colData.collection.manageToken

const fd = new FormData()
fd.append('participantName', '测试用户甲')
fd.append('files', file('季度报告.pdf', 'application/pdf'))
fd.append('files', file('预览图.png', 'image/png'))
fd.append('files', file('缓存数据.tmp', 'application/octet-stream'))
const subRes = await api(`/api/collections/${COL_TOKEN}/submissions`, '', { method: 'POST', body: fd })
console.log('提交状态:', subRes.status)

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => fs.existsSync(p))
const profileDir = path.join(SANDBOX, 'chrome-profile')
fs.mkdirSync(profileDir, { recursive: true })
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profileDir}`,
  '--headless=new', '--no-first-run', '--disable-gpu', '--no-proxy-server',
  '--window-size=1440,900', '--hide-scrollbars', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] })

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
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable')

try {
  await send('Network.setCookie', { name: 'kunqiong_session', value: 'sess_fix', domain: '127.0.0.1', path: '/' })
  await send('Page.navigate', { url: `${BASE}/collect/manage/${COL_MANAGE}` })
  await sleep(4000)

  // ① 铃铛颜色
  const bell = await evaluate(`(() => {
    const el = document.querySelector('.public-message-link') || document.querySelector('.message-trigger')
    if (!el) return null
    const cs = getComputedStyle(el)
    return { cls: el.className, tag: el.tagName, color: cs.color, href: el.getAttribute('href') }
  })()`)
  console.log('① 铃铛:', JSON.stringify(bell))

  // ② 文件行：取每行 small（大小）的右边界与下载按钮左边界，判断是否对齐
  const rows = await evaluate(`(() => {
    return [...document.querySelectorAll('.cm-file-row')].map((row) => {
      const size = row.querySelector('small')
      const actions = row.querySelector('.cm-file-actions')
      const name = row.querySelector('span')
      const sr = size.getBoundingClientRect()
      const ar = actions ? actions.getBoundingClientRect() : null
      return { name: name.textContent.slice(0, 18), sizeRight: Math.round(sr.right), actionsLeft: ar ? Math.round(ar.left) : null }
    })
  })()`)
  console.log('② 文件行:', JSON.stringify(rows, null, 1))
  // 截图（含文件行区域）
  let shot = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(OUT, 'collect-manage.png'), Buffer.from(shot.result.data, 'base64'))

  // ③ 打开「管理收集设置」：检查 backdrop 父节点、是否覆盖全屏、弹窗是否居中
  const opened = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '收集设置')
    if (!btn) return 'not-found'
    btn.click(); return 'clicked'
  })()`)
  console.log('③ 打开设置弹窗:', opened)
  await sleep(1200)

  const modal = await evaluate(`(() => {
    const backdrop = document.querySelector('.modal-backdrop')
    const dialog = backdrop?.querySelector('.modal')
    if (!backdrop || !dialog) return null
    const br = backdrop.getBoundingClientRect()
    const dr = dialog.getBoundingClientRect()
    return {
      parentIsBody: backdrop.parentElement === document.body,
      backdrop: { top: Math.round(br.top), height: Math.round(br.height), width: Math.round(br.width) },
      viewport: { h: window.innerHeight, w: window.innerWidth },
      dialog: { top: Math.round(dr.top), bottom: Math.round(dr.bottom), height: Math.round(dr.height) },
      centerDelta: Math.round((dr.top + dr.bottom) / 2 - window.innerHeight / 2),
      title: dialog.querySelector('h2')?.textContent,
    }
  })()`)
  console.log('③ 弹窗:', JSON.stringify(modal, null, 1))
  shot = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(OUT, 'settings-modal.png'), Buffer.from(shot.result.data, 'base64'))
  await evaluate(`(() => { const c = document.querySelector('.modal-close'); if (c) c.click(); return true })()`)
  await sleep(600)

  // ④ 导出清单：拦截 createObjectURL 拿到 xlsx 二进制，用 SheetJS 读回数据与列宽
  await evaluate(`(() => {
    window.__xlsxB64 = null
    const orig = URL.createObjectURL.bind(URL)
    URL.createObjectURL = (blob) => {
      try {
        blob.arrayBuffer().then((buf) => {
          const bytes = new Uint8Array(buf)
          let bin = ''
          for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i])
          window.__xlsxB64 = btoa(bin)
        })
      } catch {}
      return orig(blob)
    }
    return 'patched'
  })()`)
  const exportClicked = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('导出清单'))
    if (!btn) return 'not-found'
    btn.click(); return 'clicked'
  })()`)
  console.log('④ 导出清单:', exportClicked)
  await sleep(3500)
  const b64 = await evaluate('window.__xlsxB64')
  if (b64) {
    const XLSX = await import('xlsx')
    const buffer = Buffer.from(b64, 'base64')
    fs.writeFileSync(path.join(OUT, 'export-check.xlsx'), buffer)
    const book = XLSX.read(buffer, { type: 'buffer', cellStyles: true })
    const sheet = book.Sheets[book.SheetNames[0]]
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false })
    console.log('④ 工作表名:', book.SheetNames[0], '| 文件大小:', buffer.length, 'bytes')
    console.log('④ 表头:', JSON.stringify(data[0]))
    console.log('④ 首行数据:', JSON.stringify(data[1]))
    console.log('④ 列宽(!cols):', JSON.stringify(sheet['!cols']))
  } else {
    console.log('④ 未拦截到 xlsx 内容')
  }
} catch (e) {
  console.error('FAIL', e.message)
} finally {
  try { ws.close() } catch {}
  try { chrome.kill() } catch {}
  try { server.kill('SIGTERM') } catch {}
}
console.log('done')
