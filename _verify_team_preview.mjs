// 回归验收：团队资源「多文件」预览（真实 Chrome + 真实后端沙箱）
//
// 修复前：`disabled={resource.files?.length !== 1 || !canPreviewFile(files[0])}`
//   → 多文件资源预览按钮永久禁用；配合 .ghost-icon:disabled 的 cursor:wait，
//     表现成「一直转圈 + 按钮变灰」。
// 修复后：多文件资源可预览，点击弹出文件选择器；按钮仅在「没有任何可预览文件」时禁用。
//
// 覆盖：
//   1) 接口层：多文件资源 files/0/preview 后端本就返回 200（证明是纯前端判断错误）
//   2) 真实 Chrome：1 文件资源 → 直接打开预览弹窗
//   3) 真实 Chrome：2 文件资源 → 按钮可用 + 点击弹出选择器 + 选中后打开预览
//   4) 真实 Chrome：无可预览文件资源 → 按钮禁用且 cursor 为 not-allowed（非 wait）
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { join } from 'node:path'

const ROOT = 'C:\\Users\\admin\\Desktop\\鲲穹文件传输web'
const LOG = join(ROOT, '_team_preview_fix.txt')
const MARK_LOG = join(ROOT, '_team_preview_fix_crash.txt')
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const CDP_PORT = 9363
const APP_PORT = 8123

const out = []
let pass = 0, fail = 0
const line = (s) => { out.push(s); try { fs.writeFileSync(LOG, out.join('\n')) } catch {} }
const check = (n, c, d) => { c ? pass++ : fail++; line(`  ${c ? 'PASS' : 'FAIL'}  ${n}${d !== undefined ? ' — ' + d : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const mark = (s) => { try { fs.writeFileSync(MARK_LOG, s) } catch {} }

process.on('uncaughtException', (e) => { mark('uncaughtException: ' + (e?.stack || e)); process.exit(1) })
process.on('unhandledRejection', (e) => { mark('unhandledRejection: ' + (e?.stack || e)); process.exit(1) })

fs.writeFileSync(LOG, '')
if (fs.existsSync(MARK_LOG)) fs.unlinkSync(MARK_LOG)
mark('step0')

const copyTree = (src, dst) => {
  fs.mkdirSync(dst, { recursive: true })
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = join(src, e.name), d = join(dst, e.name)
    if (e.isDirectory()) copyTree(s, d)
    else if (e.isFile()) fs.copyFileSync(s, d)
  }
}

// ---------- 沙箱 ----------
mark('step1: 沙箱')
const SANDBOX = join(ROOT, '_team_preview_fix_sandbox')
try { if (fs.existsSync(SANDBOX)) fs.rmSync(SANDBOX, { recursive: true, force: true, maxRetries: 3 }) } catch {}
fs.mkdirSync(join(SANDBOX, 'storage', 'tmp'), { recursive: true })
fs.copyFileSync(join(ROOT, 'server.mjs'), join(SANDBOX, 'server.mjs'))
try { fs.symlinkSync(join(ROOT, 'node_modules'), join(SANDBOX, 'node_modules'), 'junction') } catch {}
mark('step2: 复制 dist')
copyTree(join(ROOT, 'dist'), join(SANDBOX, 'dist'))

const OWNER_ID = 'u_owner_ent', MEMBER_ID = 'u_member_free', ORG_ID = 'org_fix'
const SHARE_ONE = 'fixshare1'
const SHARE_MANY = 'fixshare2'
const SHARE_NONE = 'fixshare3'   // 全是不可预览类型（如 .bin）
const now = new Date().toISOString()

const mkUser = (id, nick, planId) => ({
  id, username: id, nickname: nick, email: `${id}@test.com`, phone: '', avatar: null,
  avatarSource: '', providerAvatar: null, provider: '', loginMethods: ['oauth'],
  planId, planStartedAt: null, planExpiresAt: null, organizationId: '',
  organizationRole: '', status: 'active', fileCleanup: { enabled: false, days: 7 },
  createdAt: now, updatedAt: now,
})

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
)

function seedImageFiles(shareId, names) {
  const dir = join(SANDBOX, 'storage', 'files', shareId)
  fs.mkdirSync(dir, { recursive: true })
  return names.map((name, i) => {
    const storedName = `${i}_${name}`
    fs.writeFileSync(join(dir, storedName), PNG)
    return { name, relativePath: name, storedName, size: PNG.length, mimeType: 'image/png' }
  })
}

function seedBinaryFiles(shareId, names) {
  const dir = join(SANDBOX, 'storage', 'files', shareId)
  fs.mkdirSync(dir, { recursive: true })
  return names.map((name, i) => {
    const storedName = `${i}_${name}`
    fs.writeFileSync(join(dir, storedName), Buffer.from([0, 1, 2, 3]))
    return { name, relativePath: name, storedName, size: 4, mimeType: 'application/octet-stream' }
  })
}

const filesOne = seedImageFiles(SHARE_ONE, ['单图.png'])
const filesMany = seedImageFiles(SHARE_MANY, ['甲图.png', '乙图.png', '丙图.png'])
const filesNone = seedBinaryFiles(SHARE_NONE, ['不可预览.bin'])

const mkShare = (id, files) => ({
  id, ownerUserId: OWNER_ID, files,
  teamResource: true, teamOrganizationId: ORG_ID,
  createdAt: now, updatedAt: now, expiresAt: null,
  downloadCount: 0, downloadLimit: null, expiryDays: '0',
  manageToken: 'man' + id, passwordHash: '', code: 'ABC123',
})

fs.writeFileSync(join(SANDBOX, 'storage', 'metadata.json'), JSON.stringify({
  users: {
    [OWNER_ID]: mkUser(OWNER_ID, '王总', 'enterprise'),
    [MEMBER_ID]: mkUser(MEMBER_ID, '小李', 'free'),
  },
  sessions: [
    { id: 'sess_owner', expiresAt: new Date(Date.now() + 86400000).toISOString(), createdAt: now, apiWebToken: '', user: mkUser(OWNER_ID, '王总', 'enterprise') },
    { id: 'sess_member', expiresAt: new Date(Date.now() + 86400000).toISOString(), createdAt: now, apiWebToken: '', user: mkUser(MEMBER_ID, '小李', 'free') },
  ],
  organizations: {
    [ORG_ID]: {
      id: ORG_ID, slug: 'fix-team', name: '验收团队', ownerUserId: OWNER_ID, createdAt: now, updatedAt: now,
      members: [
        { id: 'm_o', userId: OWNER_ID, email: `${OWNER_ID}@test.com`, phone: '', displayName: '王总', role: 'owner', status: 'active', joinedAt: now },
        { id: 'm_m', userId: MEMBER_ID, email: `${MEMBER_ID}@test.com`, phone: '', displayName: '小李', role: 'member', status: 'active', joinedAt: now },
      ],
    },
  },
  shares: [mkShare(SHARE_ONE, filesOne), mkShare(SHARE_MANY, filesMany), mkShare(SHARE_NONE, filesNone)],
  collections: [], messages: {}, auditLogs: [], upgradeOrders: [],
  verificationCodes: [], systemConfig: {}, notifications: {},
}, null, 2))

// ---------- 启动后端 ----------
mark('step3: 启动后端')
process.env.KUNQIONG_DB_ENABLED = 'false'
let serverErr = ''
const serverProc = spawn(process.execPath, ['server.mjs'], {
  cwd: SANDBOX,
  env: { ...process.env, NODE_ENV: 'production', PORT: String(APP_PORT), HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
serverProc.stdout.on('data', () => {})
serverProc.stderr.on('data', (b) => { serverErr += b.toString() })

{
  let ok = false
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${APP_PORT}/api/health`); if (r.ok) { ok = true; break } } catch {}
    await sleep(300)
  }
  if (!ok) { line('后端未就绪\n' + serverErr.slice(-1200)); serverProc.kill(); process.exit(1) }
  line('后端沙箱已启动')
}

const BASE_URL = `http://127.0.0.1:${APP_PORT}`
const CK = { Cookie: 'kunqiong_session=sess_member' }

let chrome = null
try {
  line('\n===== A. 接口层：后端对多文件资源的预览支持 =====')
  {
    const r = await fetch(`${BASE_URL}/api/shares/${SHARE_ONE}/files/0/preview`, { headers: CK })
    check('单文件资源 files/0/preview → 200', r.status === 200, `status=${r.status}`)
  }
  {
    const r = await fetch(`${BASE_URL}/api/shares/${SHARE_MANY}/files/0/preview`, { headers: CK })
    const ct = r.headers.get('content-type') || ''
    check('★ 多文件资源 files/0/preview → 200（后端本就支持）', r.status === 200, `status=${r.status} ct=${ct}`)
  }
  {
    const r = await fetch(`${BASE_URL}/api/shares/${SHARE_MANY}/files/2/preview`, { headers: CK })
    check('★ 多文件资源 files/2/preview（第 3 个）→ 200', r.status === 200, `status=${r.status}`)
  }

  // ---------- Chrome ----------
  mark('step4: 启动 Chrome')
  chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${join(SANDBOX, 'chrome-profile')}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-gpu', '--hide-scrollbars', 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  chrome.stdout.on('data', () => {})
  chrome.stderr.on('data', () => {})

  const getJson = async (u) => JSON.parse(await (await fetch(u)).text())
  let ver = null
  for (let i = 0; i < 40; i++) {
    try { ver = await getJson(`http://127.0.0.1:${CDP_PORT}/json/version`); if (ver?.webSocketDebuggerUrl) break } catch {}
    await sleep(300)
  }
  if (!ver?.webSocketDebuggerUrl) { line('Chrome 未就绪'); serverProc.kill(); chrome.kill(); process.exit(1) }

  const bws = new WebSocket(ver.webSocketDebuggerUrl)
  let id = 0; const pend = new Map()
  bws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } })
  const bcmd = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); bws.send(JSON.stringify({ id: i, method, params })) })
  await new Promise((r) => bws.addEventListener('open', r))

  const t = await bcmd('Target.createTarget', { url: 'about:blank' })
  const tid = t.result.targetId
  let wsUrl = null
  for (let i = 0; i < 25; i++) {
    const l = await getJson(`http://127.0.0.1:${CDP_PORT}/json/list`)
    const p = Array.isArray(l) ? l.find((x) => x.id === tid) : null
    if (p?.webSocketDebuggerUrl) { wsUrl = p.webSocketDebuggerUrl; break }
    await sleep(300)
  }
  if (!wsUrl) { line('拿不到 page ws'); serverProc.kill(); chrome.kill(); process.exit(1) }

  const sock = new WebSocket(wsUrl)
  let pid = 0; const pp = new Map()
  sock.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pp.has(m.id)) { pp.get(m.id)(m); pp.delete(m.id) } })
  const cmd = (method, params = {}) => new Promise((res) => { const i = ++pid; pp.set(i, res); sock.send(JSON.stringify({ id: i, method, params })) })
  await new Promise((r) => sock.addEventListener('open', r))
  await cmd('Page.enable'); await cmd('Runtime.enable'); await cmd('Network.enable')

  const evalJs = async (expr) => {
    const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.text || 'exception' }
    return { value: r.result?.result?.value }
  }

  mark('step5: 打开 /team')
  await cmd('Network.setCookie', { name: 'kunqiong_session', value: 'sess_member', domain: '127.0.0.1', path: '/' })
  await cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

  const patch = `(function(){
    if (window.__kqPatched) return 'already';
    window.__kqPatched = true;
    const of = window.fetch;
    window.fetch = function(input, init){
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.includes('/api/auth/me')) {
        return Promise.resolve(new Response(JSON.stringify({ user: ${JSON.stringify(JSON.stringify({
          id: MEMBER_ID, nickname: '小李', username: MEMBER_ID, email: `${MEMBER_ID}@test.com`,
          avatar: null, avatarSource: '', providerAvatar: null, planId: 'free',
        }))} }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return of.apply(this, arguments);
    };
  })()`

  await cmd('Page.navigate', { url: `${BASE_URL}/team` })
  await sleep(2500)
  await evalJs(patch)
  await cmd('Page.navigate', { url: `${BASE_URL}/team` })
  await sleep(3000)
  await evalJs(patch)
  await sleep(1500)

  mark('step6: 切到团队资源页签')
  await evalJs(`(function(){
    const b = [...document.querySelectorAll('.team-tabs button')].find(x => x.textContent.includes('团队资源'));
    if (b) b.click();
    return !!b;
  })()`)
  for (let i = 0; i < 25; i++) {
    const p = await evalJs(`document.querySelectorAll('.team-resource-row').length`)
    if ((p.value || 0) >= 3) break
    await sleep(400)
  }

  const readRows = `(function(){
    return [...document.querySelectorAll('.team-resource-row')].map(r => {
      const btns = [...r.querySelectorAll('.team-resource-actions button, .team-resource-actions a')];
      const eye = btns.find(b => (b.getAttribute('aria-label')||'').startsWith('预览'));
      return {
        name: r.querySelector('strong')?.textContent?.trim() || '',
        small: r.querySelector('small')?.textContent?.trim() || '',
        eye: eye ? {
          disabled: eye.disabled === true,
          title: eye.getAttribute('title') || '',
          cursor: getComputedStyle(eye).cursor,
          opacity: getComputedStyle(eye).opacity,
          cls: eye.className,
        } : null,
      };
    });
  })()`

  line('\n===== B. 真实浏览器：修复后按钮可用性 =====')
  let probe = await evalJs(readRows)
  let rows = probe.value || []
  rows.forEach((r) => line(`  · ${r.name} (${r.small}) disabled=${r.eye?.disabled} cursor=${r.eye?.cursor} title="${r.eye?.title}"`))

  check('页面渲染出 3 个团队资源行', rows.length >= 3, `rows=${rows.length}`)

  const oneRow = rows.find((r) => r.name.includes('单图'))
  const manyRow = rows.find((r) => r.name.includes('甲图') || r.small.includes('3 个文件'))
  const noneRow = rows.find((r) => r.name.includes('不可预览'))

  check('★ 1 文件资源：按钮可用', oneRow?.eye?.disabled === false,
    `disabled=${oneRow?.eye?.disabled} cursor=${oneRow?.eye?.cursor}`)
  check('★ 3 文件资源：按钮可用（修复点）', manyRow?.eye?.disabled === false,
    `disabled=${manyRow?.eye?.disabled} cursor=${manyRow?.eye?.cursor}`)
  check('★ 3 文件资源：不再出现 wait（转圈）光标', manyRow?.eye?.cursor !== 'wait',
    `cursor=${manyRow?.eye?.cursor}`)
  check('★ 3 文件资源：title 提示可选择文件', /选择要预览的文件/.test(manyRow?.eye?.title || ''),
    `title="${manyRow?.eye?.title}"`)
  check('无可预览文件资源：按钮仍禁用（语义正确）', noneRow?.eye?.disabled === true,
    `disabled=${noneRow?.eye?.disabled}`)
  check('★ 无可预览文件资源：cursor 为 not-allowed 而非 wait',
    noneRow?.eye?.cursor === 'not-allowed',
    `cursor=${noneRow?.eye?.cursor} cls=${noneRow?.eye?.cls}`)

  line('\n===== C. 真实交互：点 3 文件资源 → 出选择器 → 选第 2 个 → 打开预览 =====')
  mark('step7: 点击多文件资源预览')
  await evalJs(`(function(){
    const r = [...document.querySelectorAll('.team-resource-row')].find(x => x.querySelector('strong')?.textContent?.includes('甲图'));
    const eye = r && [...r.querySelectorAll('.team-resource-actions button')].find(b => (b.getAttribute('aria-label')||'').startsWith('预览'));
    if (eye) eye.click();
    return !!eye;
  })()`)
  await sleep(900)

  const chooser = await evalJs(`(function(){
    const box = document.querySelector('.record-preview-chooser');
    if (!box) return { open: false };
    const opts = [...box.querySelectorAll('.record-preview-option')].map(b => b.querySelector('strong')?.textContent?.trim() || '');
    return { open: true, options: opts };
  })()`)
  check('★ 点击后弹出文件选择器', Boolean(chooser.value?.open), JSON.stringify(chooser.value))
  check('★ 选择器列出全部 3 个可预览文件', (chooser.value?.options || []).length === 3,
    JSON.stringify(chooser.value?.options))

  // 选第 2 个（乙图.png）
  await evalJs(`(function(){
    const box = document.querySelector('.record-preview-chooser');
    if (!box) return false;
    const btns = [...box.querySelectorAll('.record-preview-option')];
    const target = btns.find(b => (b.querySelector('strong')?.textContent||'').includes('乙图')) || btns[1];
    if (target) target.click();
    return !!target;
  })()`)
  await sleep(1200)

  const modal = await evalJs(`(function(){
    const m = document.querySelector('.preview-modal');
    if (!m) return { open: false };
    const img = m.querySelector('img.preview-image');
    return {
      open: true,
      title: m.querySelector('h2')?.textContent?.trim() || '',
      kindClass: m.className,
      imgSrc: img ? img.getAttribute('src') : null,
      imgComplete: img ? (img.complete && img.naturalWidth > 0) : null,
    };
  })()`)
  check('★ 选中后打开预览弹窗', Boolean(modal.value?.open), JSON.stringify(modal.value))
  check('★ 预览的是被选中的文件（乙图.png）', modal.value?.title === '乙图.png', `title=${modal.value?.title}`)
  check('★ 预览地址指向该文件的真实下标（files/1/preview）',
    /\/files\/1\/preview$/.test(modal.value?.imgSrc || ''), `src=${modal.value?.imgSrc}`)
  check('★ 图片真实加载成功（naturalWidth > 0）', modal.value?.imgComplete === true,
    `complete=${modal.value?.imgComplete}`)

  mark('step8: 截图')
  const shot = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  if (shot.result?.data) {
    fs.writeFileSync(join(ROOT, 'qa-team-preview-fixed.png'), Buffer.from(shot.result.data, 'base64'))
    line('  截图已保存：qa-team-preview-fixed.png')
  }

  // 关掉弹窗，回到列表再截一张
  await evalJs(`(function(){ const b = document.querySelector('.preview-modal .modal-close'); if (b) b.click(); return true; })()`)
  await sleep(700)
  const shot2 = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  if (shot2.result?.data) {
    fs.writeFileSync(join(ROOT, 'qa-team-preview-list.png'), Buffer.from(shot2.result.data, 'base64'))
    line('  截图已保存：qa-team-preview-list.png')
  }

  mark('step9: 收尾')
  chrome.kill()
  serverProc.kill()

  line(`\n结果：${pass}/${pass + fail} 通过`)
} catch (e) {
  line('异常：' + (e?.stack || e?.message || e))
  try { serverProc.kill() } catch {}
  try { chrome?.kill() } catch {}
} finally {
  fs.writeFileSync(LOG, out.join('\n'))
  process.exit(fail ? 1 : 0)
}
