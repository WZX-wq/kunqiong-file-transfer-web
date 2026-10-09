// 真实 Chrome 验证：基础版成员在 /team「团队资源」页上传文件
//
// 用户反馈场景：基础版（free）成员加入企业版团队后，团队资源上传失败，
// toast 显示「永久保存需要会员版或更高权益」，进度条停在 0%。
//
// 本套件用真实浏览器 + 真实后端沙箱，走完整上传链路：
//   进入 /team → 切到「团队资源」页签 → 选中文件 → 上传 → 断言成功 toast
//   并确认**不再**出现「永久保存需要会员版或更高权益」。
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { join } from 'node:path'

// 崩溃兜底：任何未捕获异常都写进日志文件，便于排查（本沙箱 stdout 常被吞掉）
const CRASH_LOG = 'C:\\Users\\admin\\Desktop\\鲲穹文件传输web\\_team_upload_ui_crash.txt'
process.on('uncaughtException', (e) => {
  try { fs.writeFileSync(CRASH_LOG, `uncaughtException: ${e?.stack || e?.message || e}`) } catch {}
  process.exit(1)
})
process.on('unhandledRejection', (e) => {
  try { fs.writeFileSync(CRASH_LOG, `unhandledRejection: ${e?.stack || e?.message || e}`) } catch {}
  process.exit(1)
})

const ROOT = 'C:\\Users\\admin\\Desktop\\鲲穹文件传输web'
const LOG = join(ROOT, '_team_upload_ui.txt')
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const CDP_PORT = 9357
const APP_PORT = 8111

const out = []
let pass = 0, fail = 0
const line = (s) => { out.push(s); try { fs.writeFileSync(LOG, out.join('\n')) } catch {} }
const check = (n, c, d) => { c ? pass++ : fail++; line(`  ${c ? 'PASS' : 'FAIL'}  ${n}${d !== undefined ? ' — ' + d : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const MARK_LOG = 'C:\\Users\\admin\\Desktop\\鲲穹文件传输web\\_team_upload_ui_crash.txt'
const mark = (s) => { try { fs.writeFileSync(MARK_LOG, s) } catch {} }
fs.writeFileSync(LOG, '')
mark('step0: 启动')

const copyTree = (src, dst) => {
  fs.mkdirSync(dst, { recursive: true })
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = join(src, e.name), d = join(dst, e.name)
    if (e.isDirectory()) copyTree(s, d)
    else if (e.isFile()) fs.copyFileSync(s, d)
  }
}

// ---------- 沙箱 ----------
mark('step1: 准备沙箱目录')
const SANDBOX = join(ROOT, '_team_upload_ui_sandbox')
try { if (fs.existsSync(SANDBOX)) fs.rmSync(SANDBOX, { recursive: true, force: true, maxRetries: 3 }) } catch {}
fs.mkdirSync(join(SANDBOX, 'storage', 'tmp'), { recursive: true })
fs.copyFileSync(join(ROOT, 'server.mjs'), join(SANDBOX, 'server.mjs'))
try { fs.symlinkSync(join(ROOT, 'node_modules'), join(SANDBOX, 'node_modules'), 'junction') } catch {}
mark('step2: 复制 dist')
copyTree(join(ROOT, 'dist'), join(SANDBOX, 'dist'))
line('沙箱就绪：dist=' + fs.readdirSync(join(SANDBOX, 'dist', 'assets')).length + ' 个资源')
mark('step3: 沙箱就绪')

const OWNER_ID = 'u_owner_ent', MEMBER_ID = 'u_member_free', ORG_ID = 'org_ent_ui'
const now = new Date().toISOString()
const mkUser = (id, nick, planId) => ({
  id, username: id, nickname: nick, email: `${id}@test.com`, phone: '', avatar: null,
  avatarSource: '', providerAvatar: null, provider: '', loginMethods: ['oauth'],
  planId, planStartedAt: null, planExpiresAt: null, organizationId: '',
  organizationRole: '', status: 'active', fileCleanup: { enabled: false, days: 7 },
  createdAt: now, updatedAt: now,
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
      id: ORG_ID, slug: 'ent-team', name: '鲲穹设计团队', ownerUserId: OWNER_ID, createdAt: now, updatedAt: now,
      members: [
        { id: 'm_o', userId: OWNER_ID, email: `${OWNER_ID}@test.com`, phone: '', displayName: '王总', role: 'owner', status: 'active', joinedAt: now },
        { id: 'm_m', userId: MEMBER_ID, email: `${MEMBER_ID}@test.com`, phone: '', displayName: '小李', role: 'member', status: 'active', joinedAt: now },
      ],
    },
  },
  shares: [], collections: [], messages: {}, auditLogs: [], upgradeOrders: [],
  verificationCodes: [], systemConfig: {}, notifications: {},
}, null, 2))

// ---------- 启动后端沙箱 ----------
process.env.KUNQIONG_DB_ENABLED = 'false'
process.env.PORT = String(APP_PORT)
process.env.HOST = '127.0.0.1'
process.env.KUNQIONG_STORAGE_DIR = join(SANDBOX, 'storage')

let serverErr = ''
const serverProc = spawn(process.execPath, ['server.mjs'], {
  cwd: SANDBOX,
  env: { ...process.env, NODE_ENV: 'production' },
  // ⚠️ 必须同时消费 stdout/stderr：只 pipe 不读会让管道缓冲写满，
  //    子进程被阻塞在 write 上，表现为脚本「卡在启动后端之后」零输出。
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
  if (!ok) { line('服务未就绪\n' + serverErr.slice(-1500)); process.exit(1) }
  line('后端沙箱已启动')
}

// ---------- Chrome ----------
const userDataDir = join(ROOT, '_chrome_team_upload')
try { if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3 }) } catch {}
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${userDataDir}`,
  '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--hide-scrollbars', '--disable-extensions',
  '--window-size=1440,1000',
], { stdio: 'ignore' })

const getJson = (url) => new Promise((res, rej) => {
  const req = http.get(url, { timeout: 4000 }, (r) => {
    let b = ''; r.on('data', (c) => (b += c))
    r.on('end', () => { try { res(JSON.parse(b)) } catch { res(b) } })
  })
  req.on('error', rej)
  req.on('timeout', () => { req.destroy(); rej(new Error('timeout')) })
})

let ready = false
for (let i = 0; i < 30; i++) {
  await sleep(500)
  try { await getJson(`http://127.0.0.1:${CDP_PORT}/json/version`); ready = true; break } catch {}
}
if (!ready) {
  line('Chrome 未就绪')
  line(`  chrome.exitCode=${chrome.exitCode} chrome.killed=${chrome.killed} pid=${chrome.pid}`)
  try { line(`  profileDir exists=${fs.existsSync(userDataDir)}`) } catch {}
  serverProc.kill(); chrome.kill(); process.exit(1)
}

const ver = await getJson(`http://127.0.0.1:${CDP_PORT}/json/version`)
const bws = new WebSocket(ver.webSocketDebuggerUrl)
let id = 0; const pend = new Map()
bws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } })
const bcmd = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); bws.send(JSON.stringify({ id: i, method, params })) })
await new Promise((r) => bws.addEventListener('open', r))

const t = await bcmd('Target.createTarget', { url: 'about:blank' })
const tid = t.result.targetId
let wsUrl = null
for (let i = 0; i < 20; i++) {
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
await cmd('Page.enable')
await cmd('Runtime.enable')
await cmd('Network.enable')

const evalJs = async (expr) => {
  const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.text || 'exception' }
  return { value: r.result?.result?.value }
}

const BASE_URL = `http://127.0.0.1:${APP_PORT}`

try {
  line(`\n===== 真实浏览器：基础版成员 /team 团队资源上传 =====`)

  // 接口层先确认
  let r = await fetch(`${BASE_URL}/api/account/workspace`, { headers: { Cookie: 'kunqiong_session=sess_member' } })
  let j = await r.json()
  check('接口：基础版成员个人套餐 = free', j.plan?.id === 'free', `plan=${j.plan?.id} label=${j.plan?.label}`)
  check('接口：已加入企业版团队，团队空间 1TB',
    Number(j.teamEntitlement?.teamSpaceBytes) === 1024 ** 4, `=${j.teamEntitlement?.teamSpaceBytes}`)

  // 注入会话 cookie + 拦掉 OAuth 跳转
  await cmd('Network.setCookie', { name: 'kunqiong_session', value: 'sess_member', domain: '127.0.0.1', path: '/' })
  await cmd('Page.navigate', { url: `${BASE_URL}/team` })
  await sleep(2500)

  // 覆盖 fetch：把 /api/auth/me 伪装成已登录成员，其余透传（团队页需要 organization 数据）
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
  await evalJs(patch)
  await cmd('Page.navigate', { url: `${BASE_URL}/team` })
  await sleep(3000)
  await evalJs(patch)
  await sleep(1200)

  // 断言：页面渲染了团队资源页签
  let probe = await evalJs(`(function(){
    const tabs = [...document.querySelectorAll('.team-tabs button')].map(b => b.textContent.trim());
    return { tabs, hasResourcesTab: tabs.some(t => t.includes('团队资源')) };
  })()`)
  check('团队页渲染出「团队资源」页签', Boolean(probe.value?.hasResourcesTab), JSON.stringify(probe.value?.tabs || []))

  // 切到团队资源页签
  await evalJs(`(function(){
    const btn = [...document.querySelectorAll('.team-tabs button')].find(b => b.textContent.includes('团队资源'));
    if (btn) btn.click();
    return true;
  })()`)
  await sleep(1200)

  // 断言：上传按钮存在且可用（不因个人套餐被禁用）
  probe = await evalJs(`(function(){
    const btn = [...document.querySelectorAll('.team-resource-toolbar button')].find(b => b.textContent.includes('上传到团队空间'));
    return btn ? { exists: true, disabled: btn.disabled, text: btn.textContent.trim() } : { exists: false };
  })()`)
  check('★ 基础版成员可见「上传到团队空间」按钮', Boolean(probe.value?.exists), JSON.stringify(probe.value))
  check('★ 上传按钮未被禁用（不因个人套餐受限）', probe.value?.exists && probe.value.disabled === false,
    `disabled=${probe.value?.disabled}`)

  // 用 DataTransfer 往 file input 注入文件，并触发 change
  const inject = `(function(){
    const input = document.querySelector('.team-resource-toolbar input[type=file]');
    if (!input) return { error: 'no input' };
    const dt = new DataTransfer();
    dt.items.add(new File([new Blob(['hello team ui test'], {type:'application/pdf'})], 'ui-team-upload.pdf', { type: 'application/pdf' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return { injected: true, count: input.files.length };
  })()`
  probe = await evalJs(inject)
  check('文件已注入 file input', Boolean(probe.value?.injected), JSON.stringify(probe.value))
  await sleep(900)

  // 断言：出现待上传草稿区
  probe = await evalJs(`(function(){
    const draft = document.querySelector('.team-upload-draft');
    return draft ? { exists: true, text: draft.textContent.trim().slice(0, 80) } : { exists: false };
  })()`)
  check('待上传草稿区出现', Boolean(probe.value?.exists), JSON.stringify(probe.value))

  // 点击「开始上传」
  await evalJs(`(function(){
    const btn = [...document.querySelectorAll('.team-upload-draft button')].find(b => b.textContent.includes('开始上传'));
    if (btn) btn.click();
    return true;
  })()`)
  // 上传完成后 chained load() 会刷新数据，成功提示出现有延迟 —— 轮询等待，
  // 而不是固定 sleep（固定 sleep 会在 toast 渲染前取样，误判失败）。
  for (let i = 0; i < 30; i += 1) {
    await sleep(800)
    probe = await evalJs(`(function(){
      const nodes = [...document.querySelectorAll('.notice, .toast, [class*="notice"], [class*="toast"], .team-upload-progress')];
      const texts = nodes.map(n => (n.textContent || '').trim()).filter(Boolean);
      const body = document.body ? document.body.innerText : '';
      return {
        texts,
        hasForbidden: body.includes('永久保存需要会员版或更高权益'),
        hasSuccess: body.includes('已成功上传') || body.includes('上传成功'),
        hasFailure: body.includes('上传失败'),
        progressText: (document.querySelector('.team-upload-progress')?.textContent || '').trim(),
      };
    })()`)
    if (probe.value?.hasSuccess || probe.value?.hasForbidden || probe.value?.hasFailure) break
  }

  line(`  页面提示集合：${JSON.stringify(probe.value?.texts || [])}`)
  check('★ 不再出现「永久保存需要会员版或更高权益」', probe.value?.hasForbidden === false,
    `hasForbidden=${probe.value?.hasForbidden}`)
  check('★ 上传成功（页面出现成功提示）', probe.value?.hasSuccess === true,
    `hasSuccess=${probe.value?.hasSuccess}`)
  check('★ 未出现「上传失败」', probe.value?.hasFailure === false, `hasFailure=${probe.value?.hasFailure}`)

  // 后端复核：文件确实落库为团队资源
  await sleep(1200)
  const disk = JSON.parse(fs.readFileSync(join(SANDBOX, 'storage', 'metadata.json'), 'utf8'))
  const saved = (disk.shares || []).find((s) => s.files?.some((f) => f.name === 'ui-team-upload.pdf'))
  check('★ 后端落库：团队资源已创建', Boolean(saved), `shares=${(disk.shares || []).length}`)
  if (saved) {
    check('★ 落库标记为团队资源且归属正确组织',
      saved.teamResource === true && saved.teamOrganizationId === ORG_ID,
      `teamResource=${saved.teamResource} org=${saved.teamOrganizationId}`)
    check('★ 上传者为基础版成员', saved.ownerUserId === MEMBER_ID, `ownerUserId=${saved.ownerUserId}`)
    check('★ 团队资源永久保存', !saved.expiresAt, `expiresAt=${saved.expiresAt}`)
  }

  // 截图
  const shot = await cmd('Page.captureScreenshot', { format: 'png' })
  if (shot.result?.data) {
    fs.writeFileSync(join(ROOT, 'qa-team-upload-member.png'), Buffer.from(shot.result.data, 'base64'))
    line('  截图已保存 qa-team-upload-member.png')
  }
} catch (e) {
  check('执行未抛异常', false, e.message)
} finally {
  try { chrome.kill() } catch {}
  try { serverProc.kill() } catch {}
  await sleep(500)
  line(`\n结果：${pass}/${pass + fail} 通过`)
  fs.writeFileSync(LOG, out.join('\n'))
  process.exit(fail ? 1 : 0)
}
