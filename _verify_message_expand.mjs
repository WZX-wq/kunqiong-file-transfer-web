// 消息中心长消息展开/收起：真实 Chrome 验证
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const NODE = process.execPath
const SANDBOX = path.join(ROOT, '_msgui_sandbox')
const PORT = 8128
const CDP_PORT = 9348
const TRACE = path.join(ROOT, '_msgui_trace.txt')
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
const U = 'u_msg_t'
const mkUser = (id, nick, email) => ({
  id, username: id, nickname: nick, email, phone: '', avatar: null, avatarSource: '', providerAvatar: null, provider: '',
  loginMethods: ['oauth'], planId: 'free', planStartedAt: null, planExpiresAt: null,
  organizationId: '', organizationRole: '', status: 'active',
  fileCleanup: { enabled: false, days: 7 }, createdAt: now, updatedAt: now,
})
const longBody = '冰冰林已将团队“奶家帮”的所有权转让给你。注意：你当前套餐不含团队版权益，团队空间功能将停用；升级套餐或再次转让后即可恢复使用。'
fs.writeFileSync(path.join(SANDBOX, 'storage', 'metadata.json'), JSON.stringify({
  users: { [U]: mkUser(U, '验收用户', 'msg@kunqiong.com') },
  sessions: [{ id: 'sess_msg_0', expiresAt: new Date(Date.now() + 86400000).toISOString(), createdAt: now, apiWebToken: '', user: mkUser(U, '验收用户', 'msg@kunqiong.com') }],
  organizations: {},
  messages: {
    [U]: [
      { id: 'msg_long', category: 'other', eventType: 'teamOwnership', title: '你已成为团队所有者', body: longBody, createdAt: now, unread: true },
      { id: 'msg_short', category: 'share', eventType: 'shareDownloaded', title: '分享被下载', body: '王小张下载了你分享的「产品设计方案.pdf」。', createdAt: now, unread: true },
    ],
  },
  shares: [], collections: [], auditLogs: [], uploadSessions: {},
  membershipOrders: [], joinRequests: [], upgradeOrders: [],
  systemConfig: { siteName: '鲲穹', registrationOpen: true },
}, null, 2))
trace('沙箱就绪')

const { spawn } = await import('node:child_process')
const server = spawn(NODE, ['server.mjs'], {
  cwd: SANDBOX, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', KUNQIONG_DB_ENABLED: 'false', NODE_ENV: 'production' },
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
  `--user-data-dir=${path.join(ROOT, '_chrome_msgui')}`,
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

  const { targetId } = await call('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true })
  await call('Page.enable', {}, sessionId)
  await call('Runtime.enable', {}, sessionId)
  await call('Network.enable', {}, sessionId)
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId)
  await call('Network.setCookie', { name: 'kunqiong_session', value: 'sess_msg_0', domain: '127.0.0.1', path: '/' }, sessionId)
  await call('Page.navigate', { url: `http://127.0.0.1:${PORT}/` }, sessionId)
  await sleep(2200)

  // 打开消息中心
  await evalJs(`document.querySelector('.message-trigger')?.click()`, sessionId)
  await sleep(600)

  const measure = `(() => {
    const items = [...document.querySelectorAll('.message-item')]
    const longItem = items.find((el) => el.textContent.includes('你已成为团队所有者'))
    const body = longItem.querySelector('.message-item-content span')
    const range = document.createRange(); range.selectNodeContents(body)
    const rects = [...range.getClientRects()].filter((r) => r.width > 2)
    return { lines: rects.length, h: body.offsetHeight, sh: body.scrollHeight, w: Math.round(body.getBoundingClientRect().width), cls: body.className, hint: longItem.querySelector('.message-item-content small').textContent }
  })()`
  const clampState = await evalJs(measure, sessionId)
  trace('默认态: ' + JSON.stringify(clampState))
  // 折叠判据：max-height 36px 截为 2 行（2×17≈34px），且内容真实被截（scrollHeight 明显大于 offsetHeight）
  check('长消息默认折叠（高度截为 2 行且内容被截）', clampState.h <= 38 && clampState.sh > clampState.h + 4, `h=${clampState.h} scrollH=${clampState.sh} lines=${clampState.lines}`)
  check('时间行含「点击展开」提示', clampState.hint.includes('点击展开'), clampState.hint)

  // 点击展开
  await evalJs(`[...document.querySelectorAll('.message-item')].find((el) => el.textContent.includes('你已成为团队所有者')).querySelector('.message-item-main').click()`, sessionId)
  await sleep(500)
  const expandState = await evalJs(measure, sessionId)
  trace('展开态: ' + JSON.stringify(expandState))
  // 展开判据：64 字在 ~252px 容器需 3 行；元素高度超过 2 行（>40px）才是真正解除视觉截断
  check('点击后正文视觉展开（高度 > 2 行）', expandState.cls.includes('expanded') && expandState.h > 40, `h=${expandState.h} lines=${expandState.lines}`)
  check('展开后时间行变「点击收起」', expandState.hint.includes('点击收起'), expandState.hint)

  // 展开态截图留档
  const shotOpen = await call('Page.captureScreenshot', { format: 'png' }, sessionId)
  fs.writeFileSync(path.join(ROOT, '_msgui_expanded.png'), Buffer.from(shotOpen.data, 'base64'))

  // 展开时标已读是否同时生效（点开的是未读消息）
  const unreadAfter = await evalJs(`document.querySelectorAll('.message-item.unread').length`, sessionId)
  check('展开同时标已读（未读数减少）', unreadAfter === 1, `剩余未读=${unreadAfter}`)

  // 再点收起
  await evalJs(`[...document.querySelectorAll('.message-item')].find((el) => el.textContent.includes('你已成为团队所有者')).querySelector('.message-item-main').click()`, sessionId)
  await sleep(400)
  const collapseState = await evalJs(measure, sessionId)
  check('再点收起恢复折叠态（高度截断）', !collapseState.cls.includes('expanded') && collapseState.h <= 38 && collapseState.sh > collapseState.h + 4 && collapseState.hint.includes('点击展开'), JSON.stringify(collapseState))

  const shot = await call('Page.captureScreenshot', { format: 'png' }, sessionId)
  fs.writeFileSync(path.join(ROOT, '_msgui_shot.png'), Buffer.from(shot.data, 'base64'))

  console.log('==== 结果: PASS=' + results.filter((r) => r.pass).length + ' FAIL=' + results.filter((r) => !r.pass).length + ' ====')
  if (results.some((r) => !r.pass)) process.exit(1)
}

main().catch((e) => { console.error('MSGUI_FAIL:', e.message); try { chromeProc.kill() } catch {}; try { server.kill() } catch {}; process.exit(1) }).finally(() => {
  try { chromeProc.kill() } catch {}
  try { server.kill() } catch {}
})
