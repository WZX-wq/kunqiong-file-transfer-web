// 用户手册配图采集 v2：隔离沙箱 + 中性测试账号（零真实个人信息）
// 与 v1（_capture_manual_shots.mjs）的区别：种子数据全部改为测试账号/测试团队，
// 图名与现版手册 figure 一一对应，覆盖设置/清理/团队/收发记录/消息等新页面。
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const NODE = process.execPath
const SANDBOX = path.join(ROOT, '_manual_sandbox2')
const PORT = 8117
const CDP_PORT = 9337
const OUT = 'C:/Users/admin/AppData/Local/Temp/_manual_shots2'
const TRACE = path.join(ROOT, '_manual_trace2.txt')

const trace = (s) => { fs.appendFileSync(TRACE, `${new Date().toISOString().slice(11, 19)} ${s}\n`); console.log(s) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 沙箱坑：fs.cpSync(目录,目录,{recursive}) 会直接杀进程（无输出）→ 逐文件递归复制
const copyDir = (from, to) => {
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name)
    const dst = path.join(to, entry.name)
    if (entry.isDirectory()) copyDir(src, dst)
    else fs.copyFileSync(src, dst)
  }
}

fs.rmSync(TRACE, { force: true })
fs.rmSync(SANDBOX, { recursive: true, force: true })
fs.mkdirSync(path.join(SANDBOX, 'storage'), { recursive: true })
fs.mkdirSync(OUT, { recursive: true })
copyDir(path.join(ROOT, 'server'), path.join(SANDBOX, 'server'))
fs.copyFileSync(path.join(ROOT, 'server.mjs'), path.join(SANDBOX, 'server.mjs'))
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(SANDBOX, 'node_modules'), 'junction')
fs.symlinkSync(path.join(ROOT, 'dist'), path.join(SANDBOX, 'dist'), 'junction')
trace('沙箱就绪')

// ---------- 种子数据：全部为中性测试身份 ----------
const now = new Date().toISOString()
const PLAN_START = '2026-10-19T06:39:31.000Z'
const PLAN_END = '2027-04-19T06:39:31.000Z'
const OWNER = 'u_owner_t', MEMBER = 'u_member_t', APPLICANT = 'u_applicant_t'
const ORG = 'org_test'
const mkUser = (id, nick, username, email, plan, role) => ({
  id, username, nickname: nick, email, phone: '', avatar: null, avatarSource: '', providerAvatar: null, provider: '',
  loginMethods: ['password'], planId: plan,
  planStartedAt: plan === 'free' ? null : PLAN_START,
  planExpiresAt: plan === 'free' ? null : PLAN_END,
  organizationId: role ? ORG : '', organizationRole: role || '', status: 'active',
  fileCleanup: { enabled: false, days: 3 }, createdAt: now, updatedAt: now,
})
const USERS = {
  [OWNER]: mkUser(OWNER, '测试账号', 'test_owner', 'test-owner@example.com', 'halfyear', 'owner'),
  [MEMBER]: mkUser(MEMBER, '测试成员', 'test_member', 'test-member@example.com', 'free', 'member'),
  [APPLICANT]: mkUser(APPLICANT, '测试申请人', 'test_applicant', 'test-applicant@example.com', 'free', ''),
}
fs.writeFileSync(path.join(SANDBOX, 'storage', 'metadata.json'), JSON.stringify({
  users: USERS,
  sessions: [OWNER, MEMBER, APPLICANT].map((id, i) => ({
    id: `sess_t_${i}`, expiresAt: new Date(Date.now() + 86400000).toISOString(), createdAt: now, apiWebToken: '',
    // 会话快照必须是完整用户对象（与 v1 同一坑：只写 {id} 会让昵称被兜底值覆盖）
    user: USERS[id],
  })),
  organizations: {
    [ORG]: {
      id: ORG, slug: 'team-test01', name: '测试团队', ownerUserId: OWNER,
      teamPlanId: 'halfyear', teamPlanStartedAt: PLAN_START, teamPlanExpiresAt: PLAN_END, teamPlanPermanent: false,
      createdAt: '2026-10-13T02:27:18.000Z', updatedAt: now,
      members: [
        { id: 'm1', userId: OWNER, role: 'owner', status: 'active', displayName: '测试账号', email: 'test-owner@example.com', phone: '', joinedAt: now },
        { id: 'm2', userId: MEMBER, role: 'member', status: 'active', displayName: '测试成员', email: 'test-member@example.com', phone: '', joinedAt: now },
      ],
    },
  },
  shares: [], collections: [], records: [], messages: {}, uploadSessions: {}, auditLogs: [], joinRequests: [],
  upgradeOrders: [], verificationCodes: [], guestUsage: {},
  systemConfig: { siteName: '鲲穹', registrationOpen: true },
}, null, 2))
trace('种子数据写入（测试账号 / 测试团队）')

// ---------- 起服务 ----------
const { spawn } = await import('node:child_process')
const server = spawn(NODE, ['server.mjs'], {
  cwd: SANDBOX, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', KUNQIONG_DB_ENABLED: 'false', NODE_ENV: 'production', KUNQIONG_SCAN_MODE: 'required', KUNQIONG_CLAMAV_HOST: '127.0.0.1', KUNQIONG_CLAMAV_PORT: '3310' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let serverErr = ''
server.stderr.on('data', (b) => { serverErr += b.toString() })
await new Promise((resolve, reject) => {
  const t0 = Date.now()
  const tick = setInterval(async () => {
    if (Date.now() - t0 > 25000) { clearInterval(tick); reject(new Error('服务启动超时\n' + serverErr)) }
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

// ---------- API 造数（全部走真实接口） ----------
const share1 = await createShare('sess_t_0', [
  file('产品设计方案-v2.pdf', 'application/pdf'), file('品牌素材包.zip', 'application/zip'), file('团队合影.png', 'image/png'),
], { expiryDays: '7' })
trace(`多文件分享 id=${share1.id} manage=${share1.manageToken}`)
const share2 = await createShare('sess_t_0', [file('项目周报.pdf', 'application/pdf')], { expiryDays: '7', password: 'QK2026' })
trace(`密码分享 id=${share2.id}`)
const share3 = await createShare('sess_t_1', [file('活动照片精选.zip', 'application/zip')], { expiryDays: '3', recipients: 'test-owner@example.com' })
trace(`成员发给所有者 id=${share3.id}`)
// 图 2-4 访客取件页：无密码、无定向收件人的单文件分享（定向分享公开页会要求登录，不适合）
const share4 = await createShare('sess_t_0', [file('活动照片精选.zip', 'application/zip')], { expiryDays: '3' })
trace(`单文件公开分享 id=${share4.id}`)

const colRes = await api('/api/collections', 'sess_t_0', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: '活动素材收集', description: '请上传本次活动所需的素材文件，命名格式「姓名-内容」。',
    deadline: new Date(Date.now() + 10 * 86400000).toISOString(), maxFileSizeMb: 500,
  }),
})
const colData = await colRes.json()
if (!colRes.ok) throw new Error(`创建收集失败 ${colRes.status} ${JSON.stringify(colData)}`)
const COL_TOKEN = colData.collection.token, COL_MANAGE = colData.collection.manageToken
trace(`收集任务 token=${COL_TOKEN}`)

async function submit(token, name, files, sessionId = '') {
  const fd = new FormData()
  fd.append('participantName', name)
  files.forEach((f) => fd.append('files', f))
  const r = await api(`/api/collections/${token}/submissions`, sessionId, { method: 'POST', body: fd })
  if (!r.ok) throw new Error(`提交失败 ${r.status}: ${await r.text()}`)
}
await submit(COL_TOKEN, '测试成员', [file('测试成员-主视觉.png', 'image/png'), file('测试成员-文案说明.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')], 'sess_t_1')
await submit(COL_TOKEN, '测试用户甲', [file('测试用户甲-banner设计.png', 'image/png')])
await submit(COL_TOKEN, '测试用户乙', [file('测试用户乙-现场照片.jpg', 'image/jpeg')])
trace('3 份提交完成（1 份账号提交 + 2 份匿名提交）')

// ---------- Chrome ----------
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => fs.existsSync(p))
if (!CHROME) { console.log('未找到 Chrome'); process.exit(1) }
const profileDir = path.join(SANDBOX, 'chrome-profile')
fs.mkdirSync(profileDir, { recursive: true })
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profileDir}`,
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--no-proxy-server',
  '--window-size=1280,900', '--hide-scrollbars', 'about:blank',
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
  if (r.result?.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300))
  return r.result?.result?.value
}
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable')
// 全页截图（默认）：先唤醒懒加载图片并滚到底部再回顶，保证 captureBeyondViewport 拿到完整内容。
// 弹窗/浮层为 position:fixed，全页截图会错位 → 传 { full: false } 用视口截图。
const shoot = async (name, { full = true, warm = true } = {}) => {
  await sleep(500)
  if (full && warm) {
    await evaluate(`(() => { document.querySelectorAll('img[loading="lazy"]').forEach((im) => { im.loading = 'eager' }); window.scrollTo(0, document.body.scrollHeight); return true })()`)
    await sleep(450)
    await evaluate(`window.scrollTo(0, 0)`)
    await sleep(350)
  }
  const r = await send('Page.captureScreenshot', full ? { format: 'png', captureBeyondViewport: true } : { format: 'png' })
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(r.result.data, 'base64'))
  trace(`📸 ${name}${full ? '（全页）' : '（视口）'}`)
}
const goto = async (url, wait = 2400) => { await send('Page.navigate', { url }); await sleep(wait) }
const setSess = async (sid) => { await send('Network.setCookie', { name: 'kunqiong_session', value: sid, domain: '127.0.0.1', path: '/' }) }
const clearCookies = async () => { await send('Network.clearBrowserCookies') }
const clickByText = async (text, tag = 'button') => evaluate(`(() => {
  const nodes = [...document.querySelectorAll('${tag}')]
  const t = nodes.find(n => (n.textContent || '').includes('${text}') && n.offsetParent !== null)
  if (!t) return false; t.click(); return true
})()`)
// 页签等异步渲染元素：轮询等待后再点，避免固定 sleep 赶不上数据加载
const waitAndClick = async (text, timeout = 12000) => {
  for (let i = 0; i < timeout / 250; i++) {
    if (await clickByText(text)) return true
    await sleep(250)
  }
  return false
}
const step = async (name, fn) => { try { await fn() } catch (e) { trace(`!! ${name} 失败: ${e.message}`) } }

try {
  // ===== A. 未登录视角 =====
  await clearCookies()
  await step('fig10-1', async () => { await goto(`${BASE}/e/team-test01`); await shoot('fig10-1_invite') })
  await step('fig4-1', async () => { await goto(`${BASE}/share/${share1.id}`); await shoot('fig4-1_share_files') })
  await step('fig4-2', async () => { await goto(`${BASE}/share/${share2.id}`); await shoot('fig4-2_password') })
  await step('fig2-4', async () => { await goto(`${BASE}/share/${share4.id}`); await shoot('fig2-4_share_view') })
  await step('fig6-1', async () => { await goto(`${BASE}/collect/${COL_TOKEN}`); await shoot('fig6-1_collect_view') })
  await step('fig6-3', async () => {
    await goto(`${BASE}/collect/${COL_TOKEN}`, 1200)
    await evaluate(`(() => {
      const inp = document.querySelector('input[placeholder*="例如"]')
      if (!inp) return false
      const st = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      st.call(inp, '测试用户丙'); inp.dispatchEvent(new Event('input', { bubbles: true })); return true
    })()`)
    await sleep(400)
    await shoot('fig6-3_collect_anonymous')
  })
  await step('fig2-1', async () => { await goto(`${BASE}/`); await shoot('fig2-1_home') })
  await step('fig2-3', async () => { await goto(`${BASE}/?retrieve=A1B2`); await shoot('fig2-3_retrieve', { full: false }) })

  // ===== B. 申请人：提交入团申请（供「入团申请」页签） =====
  const jr = await api('/api/organizations/team-test01/join-request', 'sess_t_2', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '我是测试申请人，希望加入团队协作。' }),
  })
  trace(`入团申请 status=${jr.status}`)

  // ===== C. 所有者视角：上传流程 =====
  await setSess('sess_t_0')
  await step('fig3-1', async () => { await goto(`${BASE}/`); await shoot('fig3-1_send_view') })
  await step('fig3-2', async () => {
    await goto(`${BASE}/`, 1200)
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
    if (!picked) throw new Error('未能注入文件')
    await sleep(800)
    await shoot('fig3-2_queue')
  })
  await step('fig3-3', async () => {
    if (!await clickByText('分享设置')) throw new Error('未找到分享设置按钮')
    await sleep(600)
    await evaluate(`(() => { const sw = document.querySelector('.switch-row .switch'); if (sw && !sw.classList.contains('on')) sw.click(); return true })()`)
    await sleep(300)
    await evaluate(`(() => {
      const inp = document.querySelector('.password-field input')
      if (!inp) return false
      const st = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      st.call(inp, 'QK2026'); inp.dispatchEvent(new Event('input', { bubbles: true })); return true
    })()`)
    await sleep(400)
    await shoot('fig3-3_share_settings', { full: false })
    await clickByText('保存设置')
    await sleep(500)
  })
  await step('fig2-2', async () => {
    if (!await clickByText('开始上传')) throw new Error('未找到开始上传按钮')
    let done = false
    for (let i = 0; i < 60 && !done; i++) {
      done = await evaluate(`!!document.querySelector('.share-link-list') || document.body.innerText.includes('发送完成')`)
      if (!done) await sleep(500)
    }
    if (!done) throw new Error('上传未完成')
    await sleep(600)
    await shoot('fig2-2_upload_done')
  })
  await step('fig3-4', async () => {
    const opened = await evaluate(`(() => { const b = document.querySelector('.qr-trigger'); if (b) { b.click(); return true } return false })()`)
    if (!opened) throw new Error('未找到二维码入口')
    await sleep(800)
    await shoot('fig3-4_share_qr', { full: false })
    await evaluate(`(() => { const c = document.querySelector('.modal-close'); if (c) c.click(); return true })()`)
  })

  // ===== D. 所有者视角：其余页面 =====
  await step('fig9-1', async () => { await goto(`${BASE}/workspace`); await shoot('fig9-1_workspace') })
  await step('fig9-2', async () => { await goto(`${BASE}/settings`); await shoot('fig9-2_settings') })
  await step('fig7-1', async () => { await goto(`${BASE}/?view=records`); await shoot('fig7-1_records') })
  await step('fig8-1', async () => {
    await goto(`${BASE}/`, 1500)
    const opened = await evaluate(`(() => { const b = document.querySelector('.message-trigger'); if (b) { b.click(); return true } return false })()`)
    if (!opened) throw new Error('未找到消息中心入口')
    await sleep(800)
    // 下拉是 absolute 定位，全页截图位置正确；不滚屏（避免关闭下拉）
    await shoot('fig8-1_messages', { warm: false })
  })
  await step('fig5-1', async () => { await goto(`${BASE}/share/manage/${share1.manageToken}`); await shoot('fig5-1_share_manage') })
  await step('fig6-4', async () => { await goto(`${BASE}/collect/manage/${COL_MANAGE}`); await shoot('fig6-4_collect_manage') })

  // ===== E. 团队页（所有者） =====
  await step('fig10-2', async () => { await goto(`${BASE}/team`); await shoot('fig10-2_team_overview') })
  await step('fig10-3', async () => {
    await goto(`${BASE}/team`, 1200)
    if (!await waitAndClick('团队成员')) throw new Error('未找到团队成员页签')
    await sleep(900)
    await shoot('fig10-3_team_members')
  })
  await step('fig10-5', async () => {
    await goto(`${BASE}/team`, 1200)
    if (!await waitAndClick('团队成员')) throw new Error('未找到团队成员页签')
    await sleep(900)
    const onManage = await evaluate(`!!document.querySelector('.team-management-list')`)
    if (!onManage) throw new Error('团队成员面板未渲染')
    await evaluate(`(() => { const d = document.querySelector('.team-danger-zone') || document.querySelector('.team-management-list'); if (d) { d.scrollIntoView({ block: 'start' }); window.scrollBy(0, -160) } return true })()`)
    await sleep(500)
    // 细节图：滚动到成员操作区 + 解散危险区，保持视口截图（与全页的 10-3 形成粗细搭配）
    await shoot('fig10-5_team_manage_area', { full: false })
  })
  await step('fig10-4', async () => {
    await goto(`${BASE}/team`, 1200)
    if (!await waitAndClick('入团申请')) throw new Error('未找到入团申请页签')
    await sleep(900)
    await shoot('fig10-4_team_requests')
  })

  // ===== F. 成员视角 =====
  await step('fig10-6', async () => { await setSess('sess_t_1'); await goto(`${BASE}/team`); await shoot('fig10-6_team_member') })
  await step('fig6-2', async () => { await goto(`${BASE}/collect/${COL_TOKEN}`); await shoot('fig6-2_collect_signed') })

  // ===== G. 邮件通知样张（蓝色品牌 + 测试数据） =====
  await step('fig8-2', async () => {
    const tpl = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>你收到一个文件分享</title></head>
<body style="margin:0;padding:0;background:#f4f8fd;font-family:Arial,'Microsoft YaHei',sans-serif;color:#101c2e;">
<div style="padding:36px 16px;background:#f4f8fd;">
<div style="max-width:560px;margin:0 auto;padding:28px;background:#ffffff;border:1px solid #d9e6fa;border-radius:10px;">
<p style="margin:0 0 8px;color:#1f6bff;font-size:12px;font-weight:bold;letter-spacing:1px;">鲲穹文件传输</p>
<h2 style="margin:0 0 16px;font-size:22px;">你收到一个文件分享</h2>
<p style="line-height:1.7;">测试账号 向你发送了 <strong>3</strong> 个文件：产品设计方案-v2.pdf 等</p>
<p style="margin:20px 0 8px;color:#8b9bb0;font-size:13px;">打开链接</p>
<p style="margin:0;word-break:break-all;"><a href="${BASE}/share/${share1.id}" style="color:#1f6bff;">${BASE}/share/${share1.id}</a></p>
<div style="margin-top:18px;padding:14px;background:#eef5ff;border:1px solid #d9e6fa;border-radius:8px;">
<span style="color:#8b9bb0;font-size:12px;">取件码</span>
<strong style="display:block;margin-top:5px;color:#1f6bff;font-size:24px;letter-spacing:3px;">${share1.code || 'QK2026'}</strong></div>
<p style="color:#8b9bb0;font-size:12px;">有效期：7 天内有效</p>
<p style="margin:24px 0 0;color:#8b9bb0;font-size:11px;line-height:1.6;">本邮件由鲲穹文件传输自动发送，请勿直接回复。</p>
</div></div></body></html>`
    fs.writeFileSync(path.join(SANDBOX, 'email-preview.html'), tpl)
    await send('Page.navigate', { url: `file:///${SANDBOX.replace(/\\/g, '/')}/email-preview.html` })
    await sleep(1800)
    await shoot('fig8-2_mail')
  })
} catch (error) {
  trace(`异常中断: ${error.message}`)
} finally {
  try { ws.close() } catch {}
  try { chrome.kill() } catch {}
  try { server.kill('SIGTERM') } catch {}
}
trace('采集结束')
