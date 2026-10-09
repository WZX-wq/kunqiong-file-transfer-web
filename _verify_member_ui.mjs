// 真实浏览器验证：基础版成员打开 /workspace 的界面表现
// ⚠️ 已知环境坑：cpSync(目录, 目录, {recursive:true}) 在本沙箱会静默杀掉进程（exit 127）。
//    必须逐文件复制。另：结果一律写文件，不依赖 stdout。
import fs from 'node:fs'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { join, basename } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = 'C:\\Users\\admin\\Desktop\\鲲穹文件传输web'
const LOG = join(ROOT, '_member_ui.txt')
const out = []
let pass = 0, fail = 0
const line = (s) => { out.push(s); try { fs.writeFileSync(LOG, out.join('\n')) } catch {} }
const check = (n, c, d) => { c ? pass++ : fail++; line(`  ${c ? 'PASS' : 'FAIL'}  ${n}${d !== undefined ? ' — ' + d : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const copyTree = (src, dst) => {
  fs.mkdirSync(dst, { recursive: true })
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = join(src, e.name), d = join(dst, e.name)
    if (e.isDirectory()) copyTree(s, d)
    else if (e.isFile()) fs.copyFileSync(s, d)
  }
}

// ---------- 沙箱 ----------
const SANDBOX = join(ROOT, '_member_ui_sandbox')
try { if (fs.existsSync(SANDBOX)) fs.rmSync(SANDBOX, { recursive: true, force: true, maxRetries: 3 }) } catch {}
fs.mkdirSync(join(SANDBOX, 'storage', 'tmp'), { recursive: true })
fs.copyFileSync(join(ROOT, 'server.mjs'), join(SANDBOX, 'server.mjs'))
try { fs.symlinkSync(join(ROOT, 'node_modules'), join(SANDBOX, 'node_modules'), 'junction') } catch {}
copyTree(join(ROOT, 'dist'), join(SANDBOX, 'dist'))
line('沙箱就绪：dist=' + fs.readdirSync(join(SANDBOX, 'dist', 'assets')).length + ' 个资源')

const MEMBER_ID = 'u_member_free', OWNER_ID = 'u_owner_ent', ORG_ID = 'org_ent_1'
const now = new Date().toISOString()
fs.writeFileSync(join(SANDBOX, 'storage', 'metadata.json'), JSON.stringify({
  users: {
    [OWNER_ID]: { id: OWNER_ID, username: 'owner', nickname: '王总', email: 'owner@test.com', planId: 'enterprise', status: 'active', createdAt: now, updatedAt: now },
    [MEMBER_ID]: { id: MEMBER_ID, username: 'member', nickname: '小李', email: 'member@test.com', planId: 'free', status: 'active', createdAt: now, updatedAt: now },
  },
  sessions: [{ id: 'sess_member', user: { id: MEMBER_ID, username: 'member', nickname: '小李', email: 'member@test.com' }, expiresAt: Date.now() + 86400000 }],
  organizations: {
    [ORG_ID]: {
      id: ORG_ID, slug: 'ent-team', name: '鲲穹设计团队', ownerUserId: OWNER_ID, createdAt: now, updatedAt: now,
      members: [
        { id: 'm_o', userId: OWNER_ID, email: 'owner@test.com', phone: '', displayName: '王总', role: 'owner', status: 'active', joinedAt: now, invitedAt: null },
        { id: 'm_m', userId: MEMBER_ID, email: 'member@test.com', phone: '', displayName: '小李', role: 'member', status: 'active', joinedAt: now, invitedAt: null },
      ],
    },
  },
  shares: [], collections: [], messages: {}, auditLogs: [], upgradeOrders: [], verificationCodes: [], systemConfig: {}, notifications: {},
}, null, 2))

const SPORT = 8104
process.env.KUNQIONG_DB_ENABLED = 'false'
process.env.PORT = String(SPORT)
process.env.KUNQIONG_STORAGE_DIR = join(SANDBOX, 'storage')
// server.mjs 通过 side effect 自行 listen（不导出 app），所以只需 import 后等端口可达。
await import(pathToFileURL(join(SANDBOX, 'server.mjs')).href)
{
  let ok = false
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${SPORT}/api/health`); if (r.ok) { ok = true; break } } catch {}
    await sleep(250)
  }
  if (!ok) { line('服务未就绪'); line(`\n结果：${pass}/${pass + fail} 通过`); process.exit(1) }
}

line('===== 真实浏览器：基础版成员 /workspace =====')
line('-- 接口层（先确认数据正确）--')
{
  const res = await fetch(`http://127.0.0.1:${SPORT}/api/auth/me`, { headers: { cookie: 'kunqiong_session=sess_member' } })
  const b = await res.json()
  const u = b.user || {}
  check('★ 接口返回个人套餐 = 基础版', u.plan?.id === 'free' && u.plan?.label === '基础版', `${u.plan?.id}/${u.plan?.label}`)
  check('★ 接口返回个人容量 20GB', u.plan?.totalBytes === 20 * 1024 ** 3, `${u.plan?.totalBytes}`)
  check('★ teamEntitlement.role = member', u.teamEntitlement?.role === 'member', u.teamEntitlement?.role)
  check('★ teamEntitlement 团队空间 = 所有者的 1TB 配额', u.teamEntitlement?.teamSpaceBytes === 1024 * 1024 * 1024 * 1024, `${u.teamEntitlement?.teamSpaceBytes}`)
  check('★ 个人套餐容量未受团队空间影响', u.capacity?.totalBytes === 20 * 1024 ** 3, `${u.capacity?.totalBytes}`)
}

// ---------- Chrome ----------
const CDP = 9371
const PROFILE = join(ROOT, '_chrome_member')
try { if (fs.existsSync(PROFILE)) fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 3 }) } catch {}

const getJson = (url) => new Promise((res, rej) => {
  const rq = http.get(url, { timeout: 4000 }, (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => { try { res(JSON.parse(b)) } catch { res(b) } }) })
  rq.on('error', rej); rq.on('timeout', () => { rq.destroy(); rej(new Error('timeout')) })
})

const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', '--disable-extensions'],
  { stdio: 'ignore' })

let ready = false
for (let i = 0; i < 40; i++) { await sleep(500); try { await getJson(`http://127.0.0.1:${CDP}/json/version`); ready = true; break } catch {} }
if (!ready) { line('Chrome 未就绪'); line(`\n结果：${pass}/${pass + fail} 通过`); process.exit(1) }
line('Chrome 已就绪')

const ver = await getJson(`http://127.0.0.1:${CDP}/json/version`)
const bws = new WebSocket(ver.webSocketDebuggerUrl)
let id = 0; const pend = new Map()
bws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } })
const bcmd = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); bws.send(JSON.stringify({ id: i, method, params })) })
await new Promise((r) => bws.addEventListener('open', r))

const t = await bcmd('Target.createTarget', { url: 'about:blank' })
const tid = t.result.targetId
let wsUrl = null
for (let i = 0; i < 20; i++) {
  const l = await getJson(`http://127.0.0.1:${CDP}/json/list`)
  const p = Array.isArray(l) ? l.find((x) => x.id === tid) : null
  if (p?.webSocketDebuggerUrl) { wsUrl = p.webSocketDebuggerUrl; break }
  await sleep(300)
}
if (!wsUrl) { line('拿不到 page ws'); line(`\n结果：${pass}/${pass + fail} 通过`); process.exit(1) }

const sock = new WebSocket(wsUrl)
let pid = 0; const pp = new Map()
sock.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pp.has(m.id)) { pp.get(m.id)(m); pp.delete(m.id) } })
const cmd = (method, params = {}) => new Promise((res) => { const i = ++pid; pp.set(i, res); sock.send(JSON.stringify({ id: i, method, params })) })
await new Promise((r) => sock.addEventListener('open', r))

await cmd('Page.enable'); await cmd('Runtime.enable'); await cmd('Network.enable')
await cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1400, deviceScaleFactor: 1, mobile: false })
await cmd('Page.navigate', { url: `http://127.0.0.1:${SPORT}/` })
await sleep(900)
await cmd('Network.setCookie', { name: 'kunqiong_session', value: 'sess_member', domain: '127.0.0.1', path: '/' })
await cmd('Page.navigate', { url: `http://127.0.0.1:${SPORT}/workspace` })
await sleep(4500)

const r = await cmd('Runtime.evaluate', {
  expression: `(() => {
    const txt = (s) => (document.querySelector(s)?.textContent || '').trim()
    const body = document.body.innerText
    return JSON.stringify({
      title: txt('.workspace-hero h1'),
      planName: txt('.workspace-benefits-card h2'),
      roleTag: txt('.workspace-team-card .workspace-status'),
      hasClosed: body.includes('当前权益已关闭团队协作'),
      hasShare: body.includes('正在共享团队空间'),
      hasOwnerList: body.includes('团队所有者'),
      preview: body.replace(/\\n+/g, ' | ').slice(0, 600)
    })
  })()`, returnByValue: true,
})
const info = JSON.parse(r.result?.result?.value || '{}')
line('  页面权益标题：' + info.title)
line('  权益卡片名称：' + info.planName)
line('  团队角色标识：' + info.roleTag)
line('  页面摘要：' + (info.preview || '').slice(0, 260))

check('★ 权益显示「基础版」（未被升级为企业版）', /基础版/.test(info.title || '') || /基础版/.test(info.planName || ''), `${info.title} / ${info.planName}`)
check('★ 团队标识为「团队成员」而非「团队所有者」', info.roleTag === '团队成员', info.roleTag)
check('★ 未误报「当前权益已关闭团队协作」', info.hasClosed === false)
check('★ 显示「正在共享团队空间」提示', info.hasShare === true)

const shot = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
if (shot.result?.data) { fs.writeFileSync(join(ROOT, 'qa-member-workspace.png'), Buffer.from(shot.result.data, 'base64')); line('  截图已保存 qa-member-workspace.png') }

line(`\n结果：${pass}/${pass + fail} 通过`)
try { sock.close(); bws.close() } catch {}
try { chrome.kill() } catch {}

process.exit(fail ? 1 : 0)
