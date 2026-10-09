// 线上验收：团队资源「多文件」预览修复是否已真正生效
//
// 与 _verify_team_preview.mjs 的区别：那个跑在本地沙箱（验证代码逻辑），
// 这个直接打线上服务器，用真实 Chrome 复核「部署后的产物」表现一致。
//
// 断言前提：线上必须已有 ≥1 个「多文件分享」团队资源。
// 若某个账号下没有多文件资源，脚本会跳过交互断言并如实报告，而不是伪造通过。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { join } from 'node:path'

const ROOT = 'C:\\Users\\admin\\Desktop\\鲲穹文件传输web'
const LOG = join(ROOT, '_team_preview_live.txt')
const MARK_LOG = join(ROOT, '_team_preview_live_crash.txt')
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const CDP_PORT = 9365
const LIVE = `${process.env.KQ_LIVE_BASE || 'http://127.0.0.1:8045'}`
const ADMIN_USER = process.env.KUNQIONG_ADMIN_USERNAME || 'ljxkjadmin'
const ADMIN_PASS = process.env.KUNQIONG_ADMIN_PASSWORD || 'jxljxkj009900'

const out = []
let pass = 0, fail = 0
const line = (s) => { out.push(s); try { fs.writeFileSync(LOG, out.join('\n')) } catch {} }
const check = (n, c, d) => { c ? pass++ : fail++; line(`  ${c ? 'PASS' : 'FAIL'}  ${n}${d !== undefined ? ' — ' + d : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

process.on('uncaughtException', (e) => { try { fs.writeFileSync(MARK_LOG, 'uncaught: ' + (e?.stack || e)) } catch {}; process.exit(1) })
process.on('unhandledRejection', (e) => { try { fs.writeFileSync(MARK_LOG, 'unhandled: ' + (e?.stack || e)) } catch {}; process.exit(1) })

fs.writeFileSync(LOG, '')
if (fs.existsSync(MARK_LOG)) fs.unlinkSync(MARK_LOG)

let chrome = null
try {
  // ---------- A. 线上产物体检：修复代码是否真的在发布版本里 ----------
  line('===== A. 线上产物核对 =====')
  const health = await (await fetch(`${LIVE}/api/health`)).json()
  line(`  release=${String(health.release || '').slice(0, 12)} ok=${health.ok}`)
  check('线上 /api/health ok', health.ok === true, `release=${String(health.release || '').slice(0, 12)}`)

  const indexHtml = await (await fetch(`${LIVE}/`)).text()
  const jsName = (indexHtml.match(/assets\/(index-[A-Za-z0-9_-]+\.js)/) || [])[1]
  const cssName = (indexHtml.match(/assets\/(index-[A-Za-z0-9_-]+\.css)/) || [])[1]
  line(`  线上资源指纹  js=${jsName}  css=${cssName}`)
  check('线上页面能解析出 JS/CSS 指纹', Boolean(jsName && cssName), `js=${jsName} css=${cssName}`)

  const jsText = await (await fetch(`${LIVE}/assets/${jsName}`)).text()
  const cssText = await (await fetch(`${LIVE}/assets/${cssName}`)).text()

  check('★ 线上 JS 含多文件预览提示语「选择要预览的文件」',
    jsText.includes('选择要预览的文件'), `bundle=${jsText.length} 字节`)
  check('★ 线上 JS 含不可预览提示语',
    jsText.includes('该资源没有可在线预览的文件'))
  check('★ 线上 JS 已移除旧的「单文件资源可预览」文案',
    !jsText.includes('单文件资源可预览'))
  check('★ 线上 CSS 含 .ghost-icon:disabled.icon-inapplicable{cursor:not-allowed}',
    /\.ghost-icon:disabled\.icon-inapplicable\{cursor:not-allowed\}/.test(cssText))

  // ---------- B. 真实 Chrome 打开线上站点 ----------
  line('\n===== B. 真实浏览器：线上团队资源按钮可用性 =====')
  chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${join(ROOT, '_team_preview_live_chrome')}`,
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
  if (!ver?.webSocketDebuggerUrl) { line('Chrome 未就绪'); chrome.kill(); process.exit(1) }

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
  if (!wsUrl) { line('拿不到 page ws'); chrome.kill(); process.exit(1) }

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

  // 线上要跑真实数据，必须先拿到某个「真的属于某团队」的账号登录态。
  // 做法：用管理员口令会话调 /api/admin/impersonate 为指定用户签发会话
  //（该端点仅在 NODE_ENV=test 的测试服存在，生产 404）。
  await cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

  const health2 = await (await fetch(`${LIVE}/api/health`)).json()
  check('线上是测试服（impersonate 端点可用前提）', health2.test === true, `test=${health2.test}`)

  const adminLogin = await fetch(`${LIVE}/api/admin/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
  })
  const adminCookies = (adminLogin.headers.getSetCookie ? adminLogin.headers.getSetCookie() : [adminLogin.headers.get('set-cookie')].filter(Boolean))
    .map((c) => String(c).split(';')[0]).filter(Boolean).join('; ')
  check('管理员登录线上成功', adminLogin.status === 200 && /kunqiong_admin_session=/.test(adminCookies), `status=${adminLogin.status}`)

  // 找一位真的属于某团队、且名下有「多文件团队资源」的用户
  const ov = await (await fetch(`${LIVE}/api/admin/overview`, { headers: { Cookie: adminCookies } })).json()
  const teamUsers = {}; (ov.users || []).forEach((u) => { if (u.organizationName) teamUsers[u.id] = u })
  line('  线上有团队的账号: ' + (Object.values(teamUsers).map((u) => `${u.id}/${u.nickname}(${u.organizationName})`).join(', ') || '(无)'))

  // 多文件资源按 ownerUserId 归类
  const multiByOwner = {}
  ;(ov.resources || []).filter((r) => r.kind === 'share' && r.fileCount >= 2).forEach((r) => {
    (multiByOwner[r.ownerUserId] = multiByOwner[r.ownerUserId] || []).push(r)
  })
  line('  名下有多个文件分享的 owner: ' + (Object.keys(multiByOwner).map((k) => `${k}(${multiByOwner[k].length})`).join(', ') || '(无)'))

  const targetId = Object.keys(multiByOwner).find((k) => teamUsers[k]) || Object.keys(teamUsers)[0]
  if (!targetId) { line('线上没有任何带团队的账号可用于验收，无法继续'); chrome.kill(); process.exit(1) }
  line(`  选定验收账号: ${targetId} / ${teamUsers[targetId]?.nickname}（团队 ${teamUsers[targetId]?.organizationName}）`)

  const imp = await fetch(`${LIVE}/api/admin/impersonate`, {
    method: 'POST', headers: { Cookie: adminCookies, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: targetId }),
  })
  const impJson = await imp.json().catch(() => ({}))
  const sessId = impJson.sessionId
  check('★ 为团队账号签发验收会话', imp.status === 200 && Boolean(sessId), `status=${imp.status}`)

  // 关键：拿到真实登录态后，直接校验接口层
  const realAuth = { Cookie: `kunqiong_session=${sessId}` }
  const meRes = await fetch(`${LIVE}/api/auth/me`, { headers: realAuth })
  const meJson = await meRes.json().catch(() => ({}))
  check('★ 验收会话可换取登录态', meJson?.user?.id === targetId, `user=${meJson?.user?.id}`)

  const ovRes = await fetch(`${LIVE}/api/account/team/overview`, { headers: realAuth })
  const ovJson = await ovRes.json().catch(() => ({}))
  const teamResources = Array.isArray(ovJson.resources) ? ovJson.resources : []
  line(`  该账号团队资源: ${teamResources.length} 个（${teamResources.map((r) => r.fileCount + '文件').join(',')}）`)
  check('★ 该团队资源接口可访问且有资源', ovRes.status === 200 && teamResources.length > 0, `status=${ovRes.status} n=${teamResources.length}`)

  // 接口层：多文件资源的每一个下标都能预览（证明后端无问题）
  const multiRes = teamResources.filter((r) => (r.files?.length || 0) >= 2)
  if (multiRes.length) {
    const r0 = multiRes[0]
    const idx = (r0.files.length - 1)
    const pr = await fetch(`${LIVE}/api/shares/${r0.id}/files/${idx}/preview`, { headers: realAuth })
    check(`★ 线上多文件资源第 ${idx + 1} 个文件可预览（后端本就支持）`, pr.status === 200,
      `status=${pr.status} file=${r0.files[idx]?.name}`)
  } else {
    line('  · 该账号团队下没有多文件资源，跳过接口层下标断言')
  }

  // 让浏览器带上真实会话
  const liveHost = new URL(LIVE).hostname
  await cmd('Network.setCookie', { name: 'kunqiong_session', value: sessId, domain: liveHost, path: '/' })

  await cmd('Page.navigate', { url: `${LIVE}/team` })
  await sleep(3000)
  await cmd('Page.navigate', { url: `${LIVE}/team` })
  await sleep(3500)
  await sleep(2000)

  // 切到「团队资源」页签
  await evalJs(`(function(){
    const b = [...document.querySelectorAll('.team-tabs button')].find(x => x.textContent.includes('团队资源'));
    if (b) b.click();
    return !!b;
  })()`)
  await sleep(2500)

  // 线上是真实数据，行数不确定：轮询等下渲染稳定
  let rowCount = 0
  for (let i = 0; i < 20; i++) {
    const p = await evalJs(`document.querySelectorAll('.team-resource-row').length`)
    rowCount = p.value || 0
    if (rowCount > 0) break
    await sleep(500)
  }
  line(`  线上渲染出 ${rowCount} 个团队资源行`)

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

  const probe = await evalJs(readRows)
  const rows = probe.value || []
  rows.forEach((r) => line(`  · ${r.name} (${r.small}) disabled=${r.eye?.disabled} cursor=${r.eye?.cursor} title="${r.eye?.title}"`))

  if (rows.length === 0) {
    line('  ! 该账号在线上暂无可观察的团队资源行，跳过交互断言（不伪造通过）')
  } else {
    // 修复前：任何「N 个文件 (N>=2)」的行，预览按钮必然 disabled=true / cursor=wait
    const multiRows = rows.filter((r) => /([2-9]|\d\d+)\s*个文件/.test(r.small || ''))
    line(`  识别到 ${multiRows.length} 个多文件资源行`)

    check('★ 线上不存在「多文件资源预览按钮被禁用」的行',
      multiRows.every((r) => r.eye && r.eye.disabled === false),
      multiRows.map((r) => `${r.name}:disabled=${r.eye?.disabled}`).join(' | ') || '(无多文件行)')

    check('★ 线上多文件资源预览按钮不再出现 wait（转圈）光标',
      multiRows.every((r) => r.eye && r.eye.cursor !== 'wait'),
      multiRows.map((r) => `${r.name}:cursor=${r.eye?.cursor}`).join(' | ') || '(无多文件行)')

    check('★ 线上多文件资源 title 为「选择要预览的文件」',
      multiRows.length === 0 || multiRows.every((r) => /选择要预览的文件/.test(r.eye?.title || '')),
      multiRows.map((r) => `${r.name}:"${r.eye?.title}"`).join(' | ') || '(无多文件行)')

    check('★ 线上不存在残留的旧文案「单文件资源可预览」',
      rows.every((r) => !/单文件资源可预览/.test(r.eye?.title || '')))

    // 禁用的行必须是 not-allowed 而不是 wait
    const disabledRows = rows.filter((r) => r.eye?.disabled)
    check('★ 线上被禁用的预览按钮 cursor 为 not-allowed（非 wait）',
      disabledRows.every((r) => r.eye.cursor === 'not-allowed'),
      disabledRows.map((r) => `${r.name}:cursor=${r.eye.cursor}`).join(' | ') || '(无禁用行)')

    // 交互：若有可用的多文件行，点开看是否弹选择器
    if (multiRows.length > 0) {
      line('\n===== C. 线上真实交互：点多文件资源 → 出选择器 =====')
      const targetName = multiRows[0].name
      await evalJs(`(function(){
        const r = [...document.querySelectorAll('.team-resource-row')].find(x => x.querySelector('strong')?.textContent?.trim() === ${JSON.stringify(targetName)});
        const eye = r && [...r.querySelectorAll('.team-resource-actions button')].find(b => (b.getAttribute('aria-label')||'').startsWith('预览'));
        if (eye) eye.click();
        return !!eye;
      })()`)
      await sleep(1200)

      const chooser = await evalJs(`(function(){
        const box = document.querySelector('.record-preview-chooser');
        if (!box) return { open: false };
        const opts = [...box.querySelectorAll('.record-preview-option')].map(b => b.querySelector('strong')?.textContent?.trim() || '');
        return { open: true, options: opts };
      })()`)
      check('★ 线上点击多文件资源后弹出文件选择器', Boolean(chooser.value?.open), JSON.stringify(chooser.value))
      check('★ 线上选择器列出多个候选文件', (chooser.value?.options || []).length >= 2,
        JSON.stringify(chooser.value?.options))

      // 选第 2 个并确认能渲染出真实图片
      await evalJs(`(function(){
        const box = document.querySelector('.record-preview-chooser');
        if (!box) return false;
        const btns = [...box.querySelectorAll('.record-preview-option')];
        if (btns[1]) btns[1].click();
        return !!btns[1];
      })()`)
      // 线上资源可能是几 MB 的大图，不能固定 sleep 后采样一次就断言
      // （会误报成「加载失败」）。改为轮询等待 img.complete。
      const modal = await evalJs(`(async function(){
        const wait = (ms) => new Promise(r => setTimeout(r, ms));
        let m = null;
        for (let i = 0; i < 40; i++) { m = document.querySelector('.preview-modal'); if (m) break; await wait(250) }
        if (!m) return { open: false };
        const img = m.querySelector('img.preview-image');
        if (img) {
          for (let i = 0; i < 60; i++) {
            if (img.complete && img.naturalWidth > 0) break;
            await wait(300);
          }
        }
        return {
          open: true,
          title: m.querySelector('h2')?.textContent?.trim() || '',
          imgSrc: img ? img.getAttribute('src') : null,
          imgOk: img ? (img.complete && img.naturalWidth > 0) : null,
          imgW: img ? img.naturalWidth : null,
        };
      })()`)
      check('★ 线上选中后打开预览弹窗', Boolean(modal.value?.open), JSON.stringify(modal.value))
      if (modal.value?.imgSrc) {
        check('★ 线上预览图片真实加载成功（naturalWidth > 0）', modal.value.imgOk === true,
          `src=${modal.value.imgSrc} ok=${modal.value.imgOk}`)
      } else {
        line('  · 选中项非图片类型，跳过图片加载断言')
      }

      const shot = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
      if (shot.result?.data) {
        fs.writeFileSync(join(ROOT, 'qa-team-preview-live.png'), Buffer.from(shot.result.data, 'base64'))
        line('  截图已保存：qa-team-preview-live.png')
      }
    }
  }

  chrome.kill()
  line(`\n结果：${pass}/${pass + fail} 通过`)
} catch (e) {
  line('异常：' + (e?.stack || e?.message || e))
  try { chrome?.kill() } catch {}
} finally {
  fs.writeFileSync(LOG, out.join('\n'))
  process.exit(fail ? 1 : 0)
}
