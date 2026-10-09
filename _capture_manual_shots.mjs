// 用户手册配图采集：沙箱真实服务 + 真实 Chrome（CDP），产出 manual_shots/*.png
// 数据全部为演示种子数据，与线上无关。
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const NODE = process.execPath
const SANDBOX = path.join(ROOT, '_manual_sandbox')
const PORT = 8116
const CDP_PORT = 9336
const OUT = path.join(ROOT, 'manual_shots')
const TRACE = path.join(ROOT, '_manual_trace.txt')

const trace = (s) => { fs.appendFileSync(TRACE, `${new Date().toISOString().slice(11, 19)} ${s}\n`); console.log(s) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

fs.rmSync(SANDBOX, { recursive: true, force: true })
fs.mkdirSync(path.join(SANDBOX, 'storage'), { recursive: true })
fs.mkdirSync(OUT, { recursive: true })
fs.copyFileSync(path.join(ROOT, 'server.mjs'), path.join(SANDBOX, 'server.mjs'))
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(SANDBOX, 'node_modules'), 'junction')
fs.symlinkSync(path.join(ROOT, 'dist'), path.join(SANDBOX, 'dist'), 'junction')
trace('沙箱就绪')

// ---------- 种子数据 ----------
const now = new Date().toISOString()
const OWNER = 'u_owner_m', MEMBER = 'u_member_m', APPLICANT = 'u_applicant_m'
const ORG = 'org_manual'
const mkUser = (id, nick, email, plan, role) => ({
  id, username: id, nickname: nick, email, phone: '', avatar: null, avatarSource: '', providerAvatar: null, provider: '',
  loginMethods: ['oauth'], planId: plan, planStartedAt: plan === 'free' ? null : now, planExpiresAt: null,
  organizationId: role ? ORG : '', organizationRole: role || '', status: 'active',
  fileCleanup: { enabled: false, days: 7 }, createdAt: now, updatedAt: now,
})
fs.writeFileSync(path.join(SANDBOX, 'storage', 'metadata.json'), JSON.stringify({
  users: {
    [OWNER]: mkUser(OWNER, '林设计', 'lin@kunqiong.com', 'enterprise', 'owner'),
    [MEMBER]: mkUser(MEMBER, '王小张', 'zhang@kunqiong.com', 'free', 'member'),
    [APPLICANT]: mkUser(APPLICANT, '陈美术', 'chen@kunqiong.com', 'free', ''),
  },
  sessions: [OWNER, MEMBER, APPLICANT].map((id, i) => ({
    id: `sess_m_${i}`, expiresAt: new Date(Date.now() + 86400000).toISOString(), createdAt: now, apiWebToken: '',
    // ⚠️ 会话快照必须是完整用户对象：只写 {id} 会让启动合并时 publicUser 的 nickname 兜底
    //    「鲲穹用户」覆盖真实昵称，截图与 displayAccountName 会全部显示错。
    user: mkUser(
      id,
      { [OWNER]: '林设计', [MEMBER]: '王小张', [APPLICANT]: '陈美术' }[id],
      { [OWNER]: 'lin@kunqiong.com', [MEMBER]: 'zhang@kunqiong.com', [APPLICANT]: 'chen@kunqiong.com' }[id],
      [OWNER, MEMBER, APPLICANT][i] === OWNER ? 'enterprise' : 'free',
      '',
    ),
  })),
  organizations: {
    [ORG]: {
      id: ORG, slug: 'kunqiong-design', name: '鲲穹设计团队', ownerUserId: OWNER, createdAt: now, updatedAt: now,
      members: [
        { id: 'm1', userId: OWNER, role: 'owner', status: 'active', displayName: '林设计', email: 'lin@kunqiong.com', phone: '', joinedAt: now },
        { id: 'm2', userId: MEMBER, role: 'member', status: 'active', displayName: '王小张', email: 'zhang@kunqiong.com', phone: '', joinedAt: now },
      ],
    },
  },
  messages: {
    [OWNER]: [{
      id: 'msg_seed_1', category: 'share', eventType: 'shareDownloaded', title: '分享被下载',
      body: '王小张下载了你分享的「产品设计方案-v2.pdf」。', createdAt: now, read: false,
    }],
  },
  shares: [], collections: [], auditLogs: [
    { id: 'a1', type: 'share', action: '创建分享', userId: OWNER, createdAt: now, status: 'ok' },
    { id: 'a2', type: 'auth', action: '用户登录', userId: MEMBER, createdAt: now, status: 'ok' },
  ],
  uploadSessions: {}, membershipOrders: [], joinRequests: [], upgradeOrders: [],
  systemConfig: { siteName: '鲲穹', registrationOpen: true },
}, null, 2))
trace('种子数据写入')

// ---------- 起服务 ----------
const { spawn } = await import('node:child_process')
const server = spawn(NODE, ['server.mjs'], {
  cwd: SANDBOX, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', KUNQIONG_DB_ENABLED: 'false', NODE_ENV: 'production', KUNQIONG_ADMIN_USERNAME: 'admin', KUNQIONG_ADMIN_PASSWORD: 'admin-manual-123' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let serverErr = ''
server.stderr.on('data', (b) => { serverErr += b.toString() })
await new Promise((resolve, reject) => {
  const t0 = Date.now()
  const tick = setInterval(async () => {
    if (Date.now() - t0 > 20000) { clearInterval(tick); reject(new Error('服务启动超时\n' + serverErr)) }
    try { if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok) { clearInterval(tick); resolve() } } catch {}
  }, 250)
})
trace('服务已启动')

const BASE = `http://127.0.0.1:${PORT}`
const api = (p, sid, init = {}) => fetch(`${BASE}${p}`, {
  ...init,
  headers: { Cookie: sid ? `kunqiong_session=${sid}` : '', ...(init.headers || {}) },
})
const file = (name, type, content) => {
  const buf = Buffer.from(content || `演示文件内容：${name}\n`.repeat(40))
  return new File([buf], name, { type })
}
async function createShare(sid, files, options = {}) {
  const fd = new FormData()
  files.forEach((f) => fd.append('files', f))
  Object.entries(options).forEach(([k, v]) => fd.append(k, String(v)))
  const r = await api('/api/shares', sid, { method: 'POST', body: fd })
  const j = await r.json()
  if (!r.ok) throw new Error(`创建分享失败 ${r.status} ${JSON.stringify(j)}`)
  return j.share
}

// ---------- API 造数 ----------
const share1 = await createShare('sess_m_0', [
  file('产品设计方案-v2.pdf', 'application/pdf'), file('品牌素材包.zip', 'application/zip'), file('团队合影.png', 'image/png'),
], { expiryDays: '7' })
trace(`分享1 id=${share1.id} manage=${share1.manageToken}`)
const share2 = await createShare('sess_m_0', [file('预算明细.xlsx', 'application/vnd.ms-excel')], { expiryDays: '7', password: '8686', downloadLimit: '10' })
trace(`分享2(密码) id=${share2.id}`)
const share3 = await createShare('sess_m_1', [file('活动照片精选.zip', 'application/zip')], { expiryDays: '3', recipients: 'lin@kunqiong.com' })
trace(`分享3(成员发给所有者) id=${share3.id}`)

const colRes = await api('/api/collections', 'sess_m_0', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: '第 12 周设计稿收集', description: '请上传本周设计稿与对应源文件，命名格式「姓名-页面名」。', deadline: new Date(Date.now() + 7 * 86400000).toISOString(), allowedTypes: ['文档', '图片'], maxFileSizeMb: 200 }),
})
const colData = await colRes.json()
if (!colRes.ok) throw new Error(`创建收集失败 ${colRes.status} ${JSON.stringify(colData)}`)
const COL_TOKEN = colData.collection.token, COL_MANAGE = colData.manageToken
trace(`收集任务 token=${COL_TOKEN}`)

async function submit(token, name, files, sessionId = '') {
  const fd = new FormData()
  fd.append('participantName', name)
  files.forEach((f) => fd.append('files', f))
  const r = await api(`/api/collections/${token}/submissions`, sessionId, { method: 'POST', body: fd })
  if (!r.ok) throw new Error(`提交失败 ${r.status}: ${await r.text()}`)
}
// 一份登录提交（带账号来源）+ 一份匿名提交，供管理端「账号提交 / 匿名提交」徽标截图对照
await submit(COL_TOKEN, '王小张', [file('王小张-首页设计稿.png', 'image/png'), file('王小张-文案说明.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')], 'sess_m_1')
await submit(COL_TOKEN, '李视觉', [file('李视觉-banner设计.png', 'image/png')])
trace('2 份提交完成（1 份账号提交 + 1 份匿名提交）')

// 注意：入团申请移到 Chrome 阶段（先拍申请表单态，再提交），见下方 chromePhase 标记

// 管理员会话
const adminLogin = await fetch(`${BASE}/api/admin/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin-manual-123' }),
})
const ADMIN_COOKIE = /kunqiong_admin_session=([^;]+)/.exec(adminLogin.headers.get('set-cookie') || '')?.[1]
trace(`管理员会话=${ADMIN_COOKIE ? 'ok' : 'fail'}`)

// ---------- Chrome ----------
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => fs.existsSync(p))
if (!CHROME) { console.log('未找到 Chrome'); process.exit(1) }
const profileDir = path.join(SANDBOX, 'chrome-profile')
fs.mkdirSync(profileDir, { recursive: true })
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profileDir}`,
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--window-size=1440,1000', '--hide-scrollbars', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] })

let targets = null
for (let i = 0; i < 60 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json() } catch { await sleep(250) } }
if (!targets) { console.log('CDP 连接失败'); process.exit(1) }
const ws = new WebSocket(targets.find((t) => t.type === 'page')?.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let msgId = 0
const pending = new Map()
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params = {}) => new Promise((res) => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })) })
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 260))
  return r.result?.result?.value
}
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable')
const shoot = async (name) => {
  await sleep(400)
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(r.result.data, 'base64'))
  trace(`📸 ${name}`)
}
const goto = async (url, wait = 2200) => { await send('Page.navigate', { url }); await sleep(wait) }
const setSess = async (sid) => { await send('Network.setCookie', { name: 'kunqiong_session', value: sid, domain: '127.0.0.1', path: '/' }) }
const clearCookies = async () => { await send('Network.clearBrowserCookies') }
const clickByText = async (text, tag = 'button') => evaluate(`(() => {
  const nodes = [...document.querySelectorAll('${tag}')]
  const t = nodes.find(n => (n.textContent || '').includes('${text}') && n.offsetParent !== null)
  if (!t) return false; t.click(); return true
})()`)
const hasText = (t) => evaluate(`document.body.innerText.includes('${t}')`)

try {
  // ===== A. 未登录视角 =====
  await clearCookies()
  await goto(`${BASE}/`)
  await shoot('01-home')
  // 取件码取件弹窗
  await evaluate(`(() => { const b = document.querySelector('.retrieve-trigger'); if (b) { b.click(); return true } return false })()`)
  await sleep(600)
  await shoot('01b-retrieve-modal')
  await evaluate(`(() => { const c = document.querySelector('.modal-close'); if (c) c.click(); return true })()`)
  await goto(`${BASE}/share/${share1.id}`)
  await shoot('02-visitor-share')
  await goto(`${BASE}/share/${share2.id}`)
  await shoot('03-visitor-share-password')

  // ===== B. 申请人视角：企业邀请落地页（先拍表单态） =====
  await setSess('sess_m_2')
  await goto(`${BASE}/e/kunqiong-design`)
  await shoot('04-join-landing')
  // 再提交入团申请，供「入团申请」页签截图使用
  const jr = await api('/api/organizations/kunqiong-design/join-request', 'sess_m_2', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '我是视觉组实习生，希望加入团队协作。' }),
  })
  trace(`入团申请 status=${jr.status}`)

  // ===== C. 所有者视角 =====
  await setSess('sess_m_0')
  await goto(`${BASE}/`)
  await shoot('05-send-logged-in')

  // 选择文件 → 出现待发送队列
  const picked = await evaluate(`(() => {
    const input = document.querySelector('input[type=file]')
    if (!input) return false
    const dt = new DataTransfer()
    dt.items.add(new File(['演示内容'.repeat(200)], '新品发布方案.pdf', { type: 'application/pdf' }))
    dt.items.add(new File(['数据'.repeat(300)], 'Q3 运营数据.xlsx', { type: 'application/vnd.ms-excel' }))
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  trace(`选择文件=${picked}`)
  await sleep(700)

  // 分享设置弹窗（队列出现后才能点）
  const openedSettings = await clickByText('分享设置')
  if (openedSettings) {
    await sleep(500)
    await evaluate(`(() => { const sw = document.querySelector('.switch'); if (sw) sw.click(); return true })()`)
    await sleep(300)
    await evaluate(`(() => { const inp = document.querySelector('.password-field input'); if (inp) { const st = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; st.call(inp, 'QK2026'); inp.dispatchEvent(new Event('input', { bubbles: true })) } return true })()`)
    await sleep(300)
    await shoot('06-share-settings-modal')
    await clickByText('保存设置')
    await sleep(400)
  } else { trace('!! 未找到分享设置按钮') }

  await shoot('07-upload-queue')
  // 点击开始上传
  const started = await clickByText('开始上传')
  trace(`开始上传=${started}`)
  let done = false
  for (let i = 0; i < 40 && !done; i++) { done = await evaluate(`document.body.innerText.includes('上传完成')`); if (!done) await sleep(500) }
  trace(`上传完成=${done}`)
  await shoot('08-share-result')

  // 二维码弹窗（qr-trigger）
  const qrOpened = await evaluate(`(() => { const b = document.querySelector('.qr-trigger'); if (b) { b.click(); return true } return false })()`)
  trace(`二维码入口=${qrOpened}`)
  await sleep(700)
  await shoot('09-qr-modal')
  await evaluate(`(() => { const c = document.querySelector('.modal-close'); if (c) c.click(); return true })()`)
  await sleep(300)

  await goto(`${BASE}/?view=collect`)
  await shoot('10-collect-create')
  await goto(`${BASE}/collect/manage/${COL_MANAGE}`)
  await shoot('11-collect-manage')
  // 提交页两种身份态：登录后（账号身份卡）/ 未登录（匿名表单）
  await setSess('sess_m_1')
  await goto(`${BASE}/collect/${COL_TOKEN}`)
  await sleep(800)
  await shoot('11b-collect-submit-logged-in')
  await clearCookies()
  await goto(`${BASE}/collect/${COL_TOKEN}`)
  await sleep(800)
  await shoot('11c-collect-submit-anonymous')
  await setSess('sess_m_0')
  await goto(`${BASE}/?view=records`)
  await shoot('12-records')
  await goto(`${BASE}/workspace`)
  await shoot('13-workspace')
  await goto(`${BASE}/team`)
  await shoot('14-team-owner')
  if (await clickByText('团队成员')) { await sleep(700); await shoot('15-team-manage-tab') }
  if (await clickByText('入团申请')) { await sleep(700); await shoot('16-team-requests-tab') }
  await goto(`${BASE}/`)
  if (await evaluate(`(() => { const b = document.querySelector('[aria-label*=消息], [class*=message] button, [class*=bell]'); if (b) { b.click(); return true } const bell = [...document.querySelectorAll('button')].find(n => n.querySelector('svg') && (n.getAttribute('aria-label') || '').includes('消息')); if (bell) { bell.click(); return true } return false })()`)) { await sleep(700); await shoot('17-message-center') } else trace('!! 消息中心入口未找到')
  await goto(`${BASE}/settings`)
  await shoot('18-settings')
  await goto(`${BASE}/share/manage/${share1.manageToken}`)
  await shoot('19-share-manage')

  // ===== D. 成员视角：退出团队卡片 =====
  await setSess('sess_m_1')
  await goto(`${BASE}/team`)
  await shoot('20-team-member')

  // ===== E. 管理后台 =====
  await clearCookies()
  await goto(`${BASE}/admin`)
  await shoot('21-admin-login')
  await send('Network.setCookie', { name: 'kunqiong_admin_session', value: ADMIN_COOKIE, domain: '127.0.0.1', path: '/' })
  await goto(`${BASE}/admin`)
  await shoot('22-admin-dashboard')
  if (await clickByText('用户管理')) { await sleep(900); await shoot('23-admin-users') }
  if (await clickByText('安全日志')) { await sleep(900); await shoot('24-admin-security') }
  if (await clickByText('系统配置')) { await sleep(900); await shoot('25-admin-config') }

  // ===== F. 邮件通知模板示意 =====
  let tpl = fs.readFileSync(path.join(ROOT, 'email-templates', 'share-notification.html'), 'utf8')
  tpl = tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key) => ({
    OWNER_NAME: '林设计', SHARE_URL: `${BASE}/share/${share1.id}`, CODE: share1.code || 'D2CY7D',
    EXPIRY_TEXT: '2026-09-25 18:00 前有效', FILE_COUNT: '3', TITLE: '产品设计方案',
    PASSWORD_HINT: '该分享已开启提取密码，请向分享者获取。', QR_IMAGE: share1.qrDataUrl || '',
  }[key] ?? m))
  fs.writeFileSync(path.join(SANDBOX, 'email-preview.html'), tpl)
  await goto(`file:///${SANDBOX.replace(/\\/g, '/')}/email-preview.html`, 1500)
  await shoot('26-email-preview')
} catch (error) {
  trace(`异常中断: ${error.message}`)
} finally {
  try { ws.close() } catch {}
  try { chrome.kill() } catch {}
  try { server.kill('SIGTERM') } catch {}
}
trace('采集结束')
