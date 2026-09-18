// 真实 Chrome 验证转让/解散 UI：owner 见转让按钮+危险区；成员不见管理页签
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const ROOT = process.cwd()
const NODE = process.execPath
const SANDBOX = path.join(ROOT, '_transfer_ui_sandbox')
const PORT = 8127
const CDP_PORT = 9347
const TRACE = path.join(ROOT, '_transfer_ui_trace.txt')
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

const trace = (s) => { fs.appendFileSync(TRACE, `${new Date().toISOString().slice(11, 19)} ${s}\n`); console.log(s) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, pass, detail = '') => { results.push({ name, pass }); trace(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`) }

fs.rmSync(SANDBOX, { recursive: true, force: true })
fs.mkdirSync(path.join(SANDBOX, 'storage'), { recursive: true })
fs.copyFileSync(path.join(ROOT, 'server.mjs'), path.join(SANDBOX, 'server.mjs'))
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(SANDBOX, 'node_modules'), 'junction')
fs.symlinkSync(path.join(ROOT, 'dist'), path.join(SANDBOX, 'dist'), 'junction')

const now = new Date().toISOString()
const OWNER = 'u_owner_t', MEMBER_B = 'u_bob_t'
const ORG = 'org_transfer_ui'
const mkUser = (id, nick, email, plan, role) => ({
  id, username: id, nickname: nick, email, phone: '', avatar: null, avatarSource: '', providerAvatar: null, provider: '',
  loginMethods: ['oauth'], planId: plan, planStartedAt: plan === 'free' ? null : now, planExpiresAt: null,
  organizationId: role ? ORG : '', organizationRole: role || '', status: 'active',
  fileCleanup: { enabled: false, days: 7 }, createdAt: now, updatedAt: now,
})
fs.writeFileSync(path.join(SANDBOX, 'storage', 'metadata.json'), JSON.stringify({
  users: {
    [OWNER]: mkUser(OWNER, '林设计', 'lin@kunqiong.com', 'enterprise', 'owner'),
    [MEMBER_B]: mkUser(MEMBER_B, '王小张', 'bob@kunqiong.com', 'free', 'member'),
  },
  sessions: [
    { id: 'sess_ui_0', expiresAt: new Date(Date.now() + 86400000).toISOString(), createdAt: now, apiWebToken: '', user: mkUser(OWNER, '林设计', 'lin@kunqiong.com', 'enterprise', 'owner') },
    { id: 'sess_ui_1', expiresAt: new Date(Date.now() + 86400000).toISOString(), createdAt: now, apiWebToken: '', user: mkUser(MEMBER_B, '王小张', 'bob@kunqiong.com', 'free', 'member') },
  ],
  organizations: {
    [ORG]: {
      id: ORG, slug: 'transfer-ui-team', name: '转让演示团队', ownerUserId: OWNER, createdAt: now, updatedAt: now,
      members: [
        { id: 'm1', userId: OWNER, role: 'owner', status: 'active', displayName: '林设计', email: 'lin@kunqiong.com', phone: '', joinedAt: now },
        { id: 'm2', userId: MEMBER_B, role: 'member', status: 'active', displayName: '王小张', email: 'bob@kunqiong.com', phone: '', joinedAt: now },
      ],
    },
  },
  messages: {}, shares: [], collections: [], auditLogs: [], uploadSessions: {},
  membershipOrders: [], joinRequests: [], upgradeOrders: [],
  systemConfig: { siteName: '鲲穹', registrationOpen: true },
}, null, 2))
trace('沙箱与种子就绪')

const { spawn } = await import('node:child_process')
const server = spawn(NODE, ['server.mjs'], {
  cwd: SANDBOX, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', KUNQIONG_DB_ENABLED: 'false', NODE_ENV: 'production', KUNQIONG_ADMIN_USERNAME: 'admin', KUNQIONG_ADMIN_PASSWORD: 'admin-transfer-123' },
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

const chromeProc = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${path.join(ROOT, '_chrome_transfer_ui')}`,
  '--no-first-run', '--disable-gpu', '--window-size=1400,1000', 'about:blank',
], { stdio: 'ignore' })

async function main() {
  let version = null
  for (let i = 0; i < 30; i++) {
    try { const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`); version = await r.json(); break } catch {}
    await sleep(300)
  }
  if (!version) throw new Error('CDP 未就绪')
  const ws = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let msgId = 0
  const pending = new Map()
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++msgId
    pending.set(id, (msg) => msg.error ? reject(new Error(method + ': ' + JSON.stringify(msg.error))) : resolve(msg.result))
    ws.send(JSON.stringify({ id, method, params, sessionId }))
  })
  const evalJs = async (expr, sessionId) => (await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId)).result.value
  const openAs = async (sid) => {
    const { targetId } = await call('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true })
    await call('Page.enable', {}, sessionId)
    await call('Runtime.enable', {}, sessionId)
    await call('Network.enable', {}, sessionId)
    await call('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId)
    await call('Network.setCookie', { name: 'kunqiong_session', value: sid, domain: '127.0.0.1', path: '/' }, sessionId)
    await call('Page.navigate', { url: `http://127.0.0.1:${PORT}/team` }, sessionId)
    await sleep(2200)
    return sessionId
  }

  // 场景 A：owner 视角
  const sA = await openAs('sess_ui_0')
  const ownerUi = await evalJs(`(() => {
    const transferBtn = document.querySelector('button[title="转让所有权给该成员"]')
    const dissolveBtn = document.querySelector('.team-dissolve-button')
    const dangerZone = document.querySelector('.team-danger-zone')
    // 切到管理页签再查
    const manageTab = [...document.querySelectorAll('.team-tabs button')].find((b) => b.textContent.includes('团队成员'))
    if (manageTab) manageTab.click()
    return new Promise((resolve) => setTimeout(() => {
      const tBtn = document.querySelector('button[title="转让所有权给该成员"]')
      const dBtn = document.querySelector('.team-dissolve-button')
      const dZone = document.querySelector('.team-danger-zone')
      const ownerRow = [...document.querySelectorAll('.team-management-row')].find((row) => row.textContent.includes('林设计'))
      const memberRow = [...document.querySelectorAll('.team-management-row')].find((row) => row.textContent.includes('王小张'))
      resolve({
        manageTabVisible: Boolean(manageTab),
        transferBtn: Boolean(tBtn), transferBtnVisible: tBtn ? tBtn.getBoundingClientRect().width > 0 : false,
        dissolveBtn: Boolean(dBtn), dissolveText: dBtn?.textContent.trim() || '',
        dangerZone: Boolean(dZone), dangerText: dZone?.textContent.slice(0, 40) || '',
        ownerRowHasTransfer: ownerRow ? Boolean(ownerRow.querySelector('button[title^="转让所有权"]')) : null,
        ownerRowHasRemove: ownerRow ? Boolean(ownerRow.querySelector('button[title="移除成员"]')) : null,
        memberRowHasTransfer: memberRow ? Boolean(memberRow.querySelector('button[title^="转让所有权"]')) : null,
        memberRowHasRemove: memberRow ? Boolean(memberRow.querySelector('button[title="移除成员"]')) : null,
      })
    }, 400))
  })()`, sA)
  trace('owner UI: ' + JSON.stringify(ownerUi))
  check('owner: 管理页签可见', ownerUi.manageTabVisible)
  check('owner: 成员行有转让按钮', ownerUi.transferBtn && ownerUi.transferBtnVisible)
  check('owner: 解散按钮与危险区渲染', ownerUi.dissolveBtn && ownerUi.dangerZone && ownerUi.dissolveText.includes('解散团队'))
  check('owner: 所有者行无转让/移除按钮', ownerUi.ownerRowHasTransfer === false && ownerUi.ownerRowHasRemove === false)
  check('owner: 成员行有转让+移除按钮', ownerUi.memberRowHasTransfer === true && ownerUi.memberRowHasRemove === true)
  const shotA = await call('Page.captureScreenshot', { format: 'png' }, sA)
  // 滚动到页签+成员管理区域，让转让按钮与解散危险区入镜
  await evalJs(`document.querySelector('.team-tabs-shell')?.scrollIntoView({ block: 'start' })`, sA)
  await sleep(500)
  const shotA2 = await call('Page.captureScreenshot', { format: 'png' }, sA)
  fs.writeFileSync(path.join(ROOT, 'manual_shots', '15-team-manage-tab.png'), Buffer.from(shotA.data, 'base64'))
  fs.writeFileSync(path.join(ROOT, 'manual_shots', '15b-team-manage-actions.png'), Buffer.from(shotA2.data, 'base64'))
  trace('已更新截图 15-team-manage-tab.png + 15b-team-manage-actions.png')

  // 场景 B：点击转让按钮 → 确认弹窗文案（不真正点确认，避免破坏后续成员场景）
  await evalJs(`document.querySelector('button[title="转让所有权给该成员"]').click()`, sA)
  await sleep(600)
  const dialog = await evalJs(`(() => {
    const backdrop = document.querySelector('.modal-backdrop')
    return { open: Boolean(backdrop), text: backdrop?.textContent.slice(0, 120) || '', confirmText: [...(backdrop?.querySelectorAll('button') || [])].map((b) => b.textContent.trim()).join('|') }
  })()`, sA)
  trace('转让弹窗: ' + JSON.stringify(dialog))
  check('owner: 转让二次确认弹窗出现且文案含后果说明', dialog.open && dialog.text.includes('变为普通成员') && dialog.text.includes('不可撤销'), dialog.confirmText)
  await evalJs(`[...(document.querySelectorAll('.modal-backdrop button') || [])].find((b) => b.textContent.includes('取消'))?.click()`, sA)
  await sleep(400)

  // 场景 C：成员 B 视角 —— 无管理页签、无危险区（转让后权限门控与成员视角一致）
  const sC = await openAs('sess_ui_1')
  const memberUi = await evalJs(`(() => ({
    manageTab: [...document.querySelectorAll('.team-tabs button')].some((b) => b.textContent.includes('团队成员')),
    dissolve: Boolean(document.querySelector('.team-danger-zone')),
    transfer: Boolean(document.querySelector('button[title^="转让所有权"]')),
  }))()`, sC)
  trace('member UI: ' + JSON.stringify(memberUi))
  check('成员: 无管理页签/无转让按钮/无危险区', !memberUi.manageTab && !memberUi.dissolve && !memberUi.transfer, JSON.stringify(memberUi))
  const shotC = await call('Page.captureScreenshot', { format: 'png' }, sC)
  fs.writeFileSync(path.join(ROOT, 'manual_shots', '20-team-member.png'), Buffer.from(shotC.data, 'base64'))
  trace('已更新截图 20-team-member.png')

  console.log('==== 结果: PASS=' + results.filter((r) => r.pass).length + ' FAIL=' + results.filter((r) => !r.pass).length + ' ====')
  if (results.some((r) => !r.pass)) process.exit(1)
}

main().catch((e) => { console.error('UI_FAIL:', e.message); try { chromeProc.kill() } catch {}; try { server.kill() } catch {}; process.exit(1) }).finally(() => {
  try { chromeProc.kill() } catch {}
  try { server.kill() } catch {}
})
