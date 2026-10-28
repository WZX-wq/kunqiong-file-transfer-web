// 使用隔离品牌演示站和本机 Chrome DevTools Protocol 检查真实 390px 页面布局。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const chromePath = [
  process.env.CHROME_PATH,
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
  process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean).find(candidate => fs.existsSync(candidate))
assert.ok(chromePath, '需要安装 Chrome 或 Edge，真实窄屏验收不能以 JSDOM 替代')

async function freePort() {
  const server = net.createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
async function waitFor(check, label, timeout = 15000) {
  const until = Date.now() + timeout
  while (Date.now() < until) { try { const value = await check(); if (value) return value } catch {} await delay(50) }
  assert.fail(label)
}
async function stop(child) {
  if (!child || child.exitCode !== null) return
  const exited = once(child, 'exit')
  child.kill()
  await Promise.race([exited, delay(3000)])
}

const appPort = await freePort(), vitePort = await freePort(), debugPort = await freePort()
const appBase = `http://127.0.0.1:${appPort}`
const viteBase = `http://127.0.0.1:${vitePort}`
const chromeProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-mobile-brand-chrome-'))
let app, chrome, vite
let requestId = 0
const pending = new Map()
let cdp
try {
  app = spawn(process.execPath, [path.join(root, 'scripts/serve-team-branding-demo.mjs')], {
    cwd: root, windowsHide: true,
    env: { ...process.env, BRANDING_DEMO_PORT: String(appPort) },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let appError = ''
  app.stderr.on('data', bytes => { appError += String(bytes) })
  await waitFor(async () => (await fetch(`${appBase}/__branding_demo`)).ok, `isolated brand demo did not start: ${appError}`)
  vite = await createServer({ root, configFile: false, plugins: [react()], appType: 'spa', server: { host: '127.0.0.1', port: vitePort, strictPort: true, proxy: { '/api': { target: appBase } } } })
  await vite.listen()

  chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--no-sandbox',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${chromeProfile}`, 'about:blank',
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] })
  const version = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
    return response.ok ? response.json() : null
  }, 'Chrome DevTools endpoint did not start')
  const targetResponse = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })
  assert.equal(targetResponse.ok, true)
  const target = await targetResponse.json()
  cdp = new WebSocket(target.webSocketDebuggerUrl || version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { cdp.addEventListener('open', resolve, { once: true }); cdp.addEventListener('error', reject, { once: true }) })
  cdp.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (!message.id || !pending.has(message.id)) return
    const entry = pending.get(message.id); pending.delete(message.id)
    if (message.error) entry.reject(new Error(message.error.message))
    else entry.resolve(message.result)
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++requestId; pending.set(id, { resolve, reject }); cdp.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || result.exceptionDetails.exception?.description)
    return result.result.value
  }
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Network.enable')
  await send('Network.setCookie', { name: 'kunqiong_session', value: 'branding-demo-owner', url: viteBase, path: '/', httpOnly: true, sameSite: 'Lax' })
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await send('Page.navigate', { url: `${viteBase}/team?tab=branding` })
  await waitFor(async () => evaluate(`Boolean(document.querySelector('.team-branding-panel'))`), 'team branding editor did not load')

  const editLayout = await evaluate(`(() => {
    const viewport = document.documentElement.clientWidth;
    const selectors = ['.team-branding-panel','.team-branding-grid','.team-branding-form','.team-branding-preview','.team-branding-actions'];
    const elements = Object.fromEntries(selectors.map(selector => {
      const node = document.querySelector(selector), rect = node?.getBoundingClientRect();
      return [selector, node ? { left: rect.left, right: rect.right, width: rect.width, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth } : null];
    }));
    return { viewport, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, elements };
  })()`)
  assert.equal(editLayout.viewport, 390)
  assert.ok(editLayout.documentWidth <= 390 && editLayout.bodyWidth <= 390, `品牌编辑页存在横向溢出 ${JSON.stringify(editLayout)}`)
  for (const [selector, rect] of Object.entries(editLayout.elements)) if (rect) assert.ok(rect.left >= -1 && rect.right <= 391, `${selector} 超出390px视口 ${JSON.stringify(rect)}`)
  console.log('PASS BRAND-005: Chrome 390px 真实视口下品牌编辑页无横向溢出')

  const longName = '六项功能验收团队'.padEnd(80, '甲'), longIntro = '品牌窄屏长简介验收'.padEnd(160, '乙')
  const brandResponse = await fetch(`${appBase}/api/account/workspace/branding`, {
    method: 'PATCH', headers: { cookie: 'kunqiong_session=branding-demo-owner', 'content-type': 'application/json' },
    body: JSON.stringify({ revision: 0, name: longName, introduction: longIntro }),
  })
  assert.equal(brandResponse.status, 200, `隔离品牌夹具设置长名称失败: ${await brandResponse.text()}`)
  await send('Page.navigate', { url: `${viteBase}/team?tab=branding` })
  await waitFor(async () => evaluate(`document.querySelector('#team-brand-name')?.value.length === 80 && document.querySelector('#team-brand-introduction')?.value.length === 160`), 'saved long brand values did not reload')
  const filled = await evaluate(`(() => ({ nameLength: document.querySelector('#team-brand-name').value.length, introLength: document.querySelector('#team-brand-introduction').value.length, width: document.documentElement.scrollWidth }))()`)
  assert.equal(filled.nameLength, 80); assert.equal(filled.introLength, 160); assert.ok(filled.width <= 390)

  const publicPages = [
    ['/e/branding-demo/collect/branding-task', '.collection-submit-hero'],
    ['/e/branding-demo/share/branding-public', '.share-hero'],
  ]
  for (const [route, contentSelector] of publicPages) {
    await send('Page.navigate', { url: viteBase + route })
    await waitFor(async () => evaluate(`Boolean(document.querySelector('${contentSelector}'))`), `${route} public page did not load`)
    const page = await evaluate(`(() => ({ viewport: document.documentElement.clientWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, brandText: document.querySelector('.team-brand-copy strong')?.textContent, brandRight: document.querySelector('.team-brand')?.getBoundingClientRect().right }))()`)
    assert.equal(page.viewport, 390); assert.ok(page.documentWidth <= 390 && page.bodyWidth <= 390, `${route} 长品牌页横向溢出 ${JSON.stringify(page)}`)
    assert.equal(page.brandText?.length, 80); assert.ok(page.brandRight <= 391)
    console.log(`PASS BRAND-005: Chrome 390px 真实视口下 ${route} 长品牌内容完整且无溢出`)
  }

  const report = { executedAt: new Date().toISOString(), passed: 4, viewport: '390x844', browser: path.basename(chromePath), environment: 'Isolated branding demo; synthetic accounts; Chrome DevTools Protocol' }
  const reportRoot = path.join(root, 'test-kits/six-feature-acceptance-2026-10-27/自动化复测-2026-10-27')
  fs.mkdirSync(reportRoot, { recursive: true })
  fs.writeFileSync(path.join(reportRoot, 'test-branding-mobile.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  try { cdp?.close() } catch {}
  await stop(chrome)
  await stop(app)
  try { await vite?.close() } catch {}
  try { fs.rmSync(chromeProfile, { recursive: true, force: true }) } catch {}
}
