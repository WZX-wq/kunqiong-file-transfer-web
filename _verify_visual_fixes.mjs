// 真实 Chrome 复核本轮视觉改动：
//  1. 后台用户管理行：套餐下拉/禁用按钮/用量 是否同一行且垂直居中对齐、无换行错位
//  2. 团队空间：红框区域（KPI / 邀请链接）字体是否已调大
// 用真实布局框（getBoundingClientRect）+ 计算样式判定，jsdom 判不准这类问题。
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const NODE = process.execPath
const SANDBOX = path.join(ROOT, '_visual_sandbox')
const PORT = 8114
const CDP_PORT = 9334
const LOG = path.join(ROOT, '_visual.txt')
const SHOTS = path.join(ROOT, '_visual_shots')

const out = []
let pass = 0, fail = 0
const line = (s) => { out.push(s); console.log(s) }
const check = (n, c, d) => { c ? pass++ : fail++; line(`  ${c ? 'PASS' : 'FAIL'}  ${n}${d !== undefined ? ' — ' + d : ''}`) }

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find((p) => fs.existsSync(p))
if (!CHROME) { console.log('未找到 Chrome，跳过'); process.exit(0) }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

fs.rmSync(SANDBOX, { recursive: true, force: true })
fs.mkdirSync(path.join(SANDBOX, 'storage'), { recursive: true })
fs.copyFileSync(path.join(ROOT, 'server.mjs'), path.join(SANDBOX, 'server.mjs'))
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(SANDBOX, 'node_modules'), 'junction')
fs.symlinkSync(path.join(ROOT, 'dist'), path.join(SANDBOX, 'dist'), 'junction')

const now = new Date().toISOString()
const OWNER = 'u_vis_owner'
const MEMBER = 'u_vis_member'
const ORG = 'org_vis'
const mkUser = (id, nick, plan, role) => ({ id, username: id, nickname: nick, email: `${id}@v.com`, phone: '', avatar: null, avatarSource: '', providerAvatar: null, provider: '', loginMethods: ['oauth'], planId: plan, planStartedAt: plan === 'free' ? null : now, planExpiresAt: null, organizationId: ORG, organizationRole: role, status: 'active', fileCleanup: { enabled: false, days: 7 }, createdAt: now, updatedAt: now })

fs.writeFileSync(path.join(SANDBOX, 'storage', 'metadata.json'), JSON.stringify({
  users: {
    [OWNER]: mkUser(OWNER, '团队所有者', 'enterprise', 'owner'),
    [MEMBER]: mkUser(MEMBER, '成员小张', 'free', 'member'),
  },
  sessions: [
    { id: 'sess_owner_vis', expiresAt: new Date(Date.now() + 86400000).toISOString(), createdAt: now, apiWebToken: '', user: { id: OWNER } },
    { id: 'sess_member_vis', expiresAt: new Date(Date.now() + 86400000).toISOString(), createdAt: now, apiWebToken: '', user: { id: MEMBER } },
  ],
  organizations: {
    [ORG]: { id: ORG, slug: 'vis-team', name: '可视化复核团队', ownerUserId: OWNER, createdAt: now, updatedAt: now,
      members: [
        { id: 'm1', userId: OWNER, role: 'owner', status: 'active', displayName: '团队所有者', email: 'o@v.com', phone: '', joinedAt: now },
        { id: 'm2', userId: MEMBER, role: 'member', status: 'active', displayName: '成员小张', email: 'm@v.com', phone: '', joinedAt: now },
      ] },
  },
  shares: [], collections: [], messages: {}, auditLogs: [], uploadSessions: {}, membershipOrders: [], joinRequests: [], upgradeOrders: [],
  systemConfig: { siteName: '鲲穹', registrationOpen: true },
}, null, 2))

const { spawn } = await import('node:child_process')
const server = spawn(NODE, ['server.mjs'], {
  cwd: SANDBOX, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', KUNQIONG_DB_ENABLED: 'false', NODE_ENV: 'production', KUNQIONG_ADMIN_USERNAME: 'admin', KUNQIONG_ADMIN_PASSWORD: 'admin-vis-123' },
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

const profileDir = path.join(SANDBOX, 'chrome-profile')
fs.mkdirSync(profileDir, { recursive: true })
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profileDir}`,
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--window-size=1440,1000', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] })

const targets = await (async () => {
  for (let i = 0; i < 60; i++) {
    try { return await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json() } catch {}
    await sleep(250)
  }
  return null
})()
if (!targets) { line('无法连接 Chrome CDP'); console.log(out.join('\n')); process.exit(1) }

const wsUrl = targets.find((t) => t.type === 'page')?.webSocketDebuggerUrl
const ws = new WebSocket(wsUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

let msgId = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
}
const send = (method, params = {}) => new Promise((res) => {
  const id = ++msgId
  pending.set(id, res)
  ws.send(JSON.stringify({ id, method, params }))
})
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300))
  return r.result?.result?.value
}

await send('Page.enable')
await send('Runtime.enable')

const goto = async (url) => {
  await send('Page.navigate', { url })
  await sleep(2600)
}
const setCookie = async (name, value) => {
  await send('Network.enable')
  await send('Network.setCookie', { name, value, domain: '127.0.0.1', path: '/' })
}
const shoot = async (name) => {
  fs.mkdirSync(SHOTS, { recursive: true })
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  const p = path.join(SHOTS, `${name}.png`)
  fs.writeFileSync(p, Buffer.from(r.result.data, 'base64'))
  return p
}

try {
  // ---------- A. 团队空间字体（成员视角，能看到退出卡片） ----------
  line('===== A. 团队空间：字体 + 退出按钮（成员视角） =====')
  await goto(`http://127.0.0.1:${PORT}/`)
  await setCookie('kunqiong_session', 'sess_member_vis')
  await goto(`http://127.0.0.1:${PORT}/team`)
  await sleep(1200)

  const teamInfo = await evaluate(`(() => {
    const pick = (sel) => { const el = document.querySelector(sel); if (!el) return null
      const cs = getComputedStyle(el); const r = el.getBoundingClientRect()
      return { fontSize: parseFloat(cs.fontSize), w: Math.round(r.width), h: Math.round(r.height), text: (el.textContent || '').trim().slice(0, 30), visible: r.width > 0 && r.height > 0 } }
    return {
      kpiSpan: pick('.team-kpi span'), kpiStrong: pick('.team-kpi strong'), kpiSmall: pick('.team-kpi small'),
      capacityMeta: pick('.team-capacity-meta'),
      leaveCard: pick('.team-leave-card'), leaveBtn: pick('.team-leave-button'),
      leaveTitle: pick('.team-leave-body strong'), leaveDesc: pick('.team-leave-body span'),
      inviteCardVisible: !!document.querySelector('.team-invite-link-card'),
      manageTabVisible: [...document.querySelectorAll('[role="tab"]')].some((b) => (b.textContent || '').includes('团队成员')),
      requestsTabVisible: [...document.querySelectorAll('[role="tab"]')].some((b) => (b.textContent || '').includes('入团申请')),
      bodyText: document.body.innerText.slice(0, 400),
    }
  })()`)

  const f = (k) => teamInfo?.[k]?.fontSize
  check('KPI 标签字号 ≥13px', f('kpiSpan') >= 13, `${f('kpiSpan')}px`)
  check('KPI 数值字号 ≥26px', f('kpiStrong') >= 26, `${f('kpiStrong')}px`)
  check('KPI 说明字号 ≥12px', f('kpiSmall') >= 12, `${f('kpiSmall')}px`)
  check('容量明细字号 ≥12px', f('capacityMeta') >= 12, `${f('capacityMeta')}px`)
  check('退出卡片标题字号 14px', f('leaveTitle') === 14, `${f('leaveTitle')}px`)
  check('退出卡片说明字号 12px', f('leaveDesc') === 12, `${f('leaveDesc')}px`)
  check('邀请链接卡片仅管理者可见（成员看不到，符合预期）', teamInfo?.inviteCardVisible === false, String(teamInfo?.inviteCardVisible))
  check('★ 成员看不到「团队成员」管理页签', teamInfo?.manageTabVisible === false, String(teamInfo?.manageTabVisible))
  check('★ 成员看不到「入团申请」页签', teamInfo?.requestsTabVisible === false, String(teamInfo?.requestsTabVisible))
  check('★ 成员看不到成员管理面板（成员权限/移除按钮）', (teamInfo?.bodyText || '').includes('成员权限') === false, 'ok')
  check('★ 成员能看到退出团队卡片', Boolean(teamInfo?.leaveCard?.visible), JSON.stringify(teamInfo?.leaveCard))
  check('★ 退出按钮已渲染且可见', Boolean(teamInfo?.leaveBtn?.visible), JSON.stringify(teamInfo?.leaveBtn))
  check('退出按钮文案为「退出团队空间」', (teamInfo?.leaveBtn?.text || '').includes('退出团队空间'), teamInfo?.leaveBtn?.text)

  // 点击退出按钮 → 应弹出二次确认
  const confirmInfo = await evaluate(`(async () => {
    const btn = document.querySelector('.team-leave-button'); if (!btn) return { ok: false, reason: 'no-button' }
    btn.click(); await new Promise(r => setTimeout(r, 700))
    const dlg = document.querySelector('[role="dialog"], .confirm-dialog, .modal-card, .dialog-card')
    return { ok: true, dialogText: dlg ? dlg.innerText.slice(0, 200) : '', bodyHas: document.body.innerText.includes('确认退出') }
  })()`)
  check('★ 点击退出弹出二次确认', confirmInfo?.ok && (confirmInfo.bodyHas || (confirmInfo.dialogText || '').includes('确认退出')), JSON.stringify(confirmInfo).slice(0, 160))
  const shotA = await shoot('team-member-fonts')
  line(`  截图：${path.basename(shotA)}`)

  // ---------- B. 团队空间（所有者视角：不应出现退出卡片） ----------
  line('')
  line('===== B. 团队空间：所有者看不到退出按钮 =====')
  await setCookie('kunqiong_session', 'sess_owner_vis')
  await goto(`http://127.0.0.1:${PORT}/team`)
  await sleep(1200)
  const ownerView = await evaluate(`(() => {
    const pick = (sel) => { const el = document.querySelector(sel); if (!el) return null
      const cs = getComputedStyle(el); const r = el.getBoundingClientRect()
      return { fontSize: parseFloat(cs.fontSize), visible: r.width > 0 && r.height > 0, text: (el.textContent || '').trim().slice(0, 24) } }
    return {
      hasLeaveCard: !!document.querySelector('.team-leave-card'),
      hasLeaveBtn: !!document.querySelector('.team-leave-button'),
      hasMemberList: document.body.innerText.includes('成员小张'),
      inviteCard: !!document.querySelector('.team-invite-link-card'),
      linkHeadStrong: pick('.team-invite-link-head strong'),
      linkHeadSmall: pick('.team-invite-link-head small'),
      linkCode: pick('.team-invite-link-row code'),
    }
  })()`)
  check('★ 所有者不显示退出卡片', ownerView?.hasLeaveCard === false, JSON.stringify(ownerView?.hasLeaveCard))
  check('所有者能看到成员列表', ownerView?.hasMemberList === true, 'ok')
  check('所有者能看到邀请链接卡片', ownerView?.inviteCard === true, 'ok')
  check('★ 邀请链接标题字号 ≥14px', (ownerView?.linkHeadStrong?.fontSize || 0) >= 14, `${ownerView?.linkHeadStrong?.fontSize}px "${ownerView?.linkHeadStrong?.text}"`)
  check('★ 邀请链接说明字号 ≥12px', (ownerView?.linkHeadSmall?.fontSize || 0) >= 12, `${ownerView?.linkHeadSmall?.fontSize}px`)
  check('★ 邀请链接 URL 字号 ≥12px', (ownerView?.linkCode?.fontSize || 0) >= 12, `${ownerView?.linkCode?.fontSize}px`)
  const shotB = await shoot('team-owner-invite')
  line(`  截图：${path.basename(shotB)}`)

  // ---------- C. 后台用户管理行对齐 ----------
  line('')
  line('===== C. 后台用户管理：行内控件对齐 + 无日期字段 =====')
  await goto(`http://127.0.0.1:${PORT}/`)
  await setCookie('kunqiong_admin_session', '')
  // 走登录接口拿管理员会话
  const loginRes = await fetch(`http://127.0.0.1:${PORT}/api/admin/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin-vis-123' }),
  })
  const setCookieHeader = loginRes.headers.get('set-cookie') || ''
  const adminCookie = /kunqiong_admin_session=([^;]+)/.exec(setCookieHeader)?.[1]
  check('管理员登录成功并下发会话', Boolean(adminCookie), `status=${loginRes.status}`)

  if (adminCookie) {
    await setCookie('kunqiong_admin_session', adminCookie)
    await goto(`http://127.0.0.1:${PORT}/admin`)
    await sleep(2000)
    // 切到用户管理页签
    const tapped = await evaluate(`(async () => {
      const nodes = [...document.querySelectorAll('button, [role="tab"], a')]
      const t = nodes.find(n => /用户管理/.test(n.textContent || ''))
      if (!t) return false
      t.click(); await new Promise(r => setTimeout(r, 900)); return true
    })()`)
    check('已进入「用户管理」页签', tapped === true, String(tapped))
    await sleep(700)

    const rowInfo = await evaluate(`(() => {
      const rows = [...document.querySelectorAll('.admin-table-row')]
      return {
        rowCount: rows.length,
        expiryInputs: document.querySelectorAll('.admin-plan-expiry').length,
        hasDateText: /到期|有效期/.test(document.body.innerText),
        rows: rows.slice(0, 4).map(r => {
          const a = r.querySelector('.admin-user-actions'); if (!a) return { missingActions: true }
          const ab = a.getBoundingClientRect()
          const kids = [...a.children].map(k => { const b = k.getBoundingClientRect(); const cs = getComputedStyle(k)
            return { cls: k.className, h: Math.round(b.height), top: Math.round(b.top), bottom: Math.round(b.bottom), fs: parseFloat(cs.fontSize), text: (k.textContent||'').trim().slice(0,18) } })
          const centers = kids.map(k => (k.top + k.bottom) / 2)
          return { actionH: Math.round(ab.height), kids,
            centerSpread: centers.length ? Math.round(Math.max(...centers) - Math.min(...centers)) : null,
            sameLine: centers.length ? (Math.max(...centers) - Math.min(...centers)) <= 4 : null }
        }),
      }
    })()`)

    check('★ 已移除到期日输入框', rowInfo?.expiryInputs === 0, `count=${rowInfo?.expiryInputs}`)
    check('★ 页面上不再出现日期字段', rowInfo?.hasDateText === false, `hasDate=${rowInfo?.hasDateText}`)
    check('用户行已渲染', (rowInfo?.rowCount || 0) > 0, `rows=${rowInfo?.rowCount}`)
    const r0 = rowInfo?.rows?.[0]
    check('★ 行内控件垂直居中对齐（中心偏差 ≤4px）', r0?.sameLine === true, `spread=${r0?.centerSpread}px kids=${JSON.stringify(r0?.kids)}`)
    check('★ 控件不换行挤成两排（操作区高度 ≤ 44px）', (r0?.actionH || 999) <= 44, `h=${r0?.actionH}px`)
    const shotC = await shoot('admin-user-row')
    line(`  截图：${path.basename(shotC)}`)
  }
} catch (error) {
  fail++
  line(`  FAIL  异常中断 — ${error.message}`)
}

try { ws.close() } catch {}
chrome.kill()
server.kill('SIGTERM')
line('')
line(`结果：${pass}/${pass + fail} 通过`)
fs.writeFileSync(LOG, out.join('\n'))
setTimeout(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }) } catch {}; process.exit(fail ? 1 : 0) }, 800)
