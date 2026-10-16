// Real browser regression: settings containment must not clip order/payment dialogs.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import QRCode from 'qrcode'
import { build } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const chromePath = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync)
assert.ok(chromePath, 'Set CHROME_PATH to a Chromium browser to run layout checks')
const bundle = await build({ root, configFile: false, logLevel: 'silent', build: {
  write: false, minify: false,
  rollupOptions: { input: path.join(root, 'src/main.jsx'), output: { format: 'iife', inlineDynamicImports: true } },
} })
const js = bundle.output.find(item => item.type === 'chunk').code
const css = bundle.output.filter(item => item.type === 'asset' && item.fileName.endsWith('.css'))
  .map(item => item.source).join('\n').replace(/@import\s+url\([^;]+;/g, '')
const qr = await QRCode.toDataURL('https://fixture.local/payment/layout-check', { width: 220 })
const orders = [
  { id: 'paid', status: 'paid', payType: 2, paidAt: '2026-10-15T08:18:52Z', remoteExpireAt: '2027-01-13T08:18:52Z' },
  { id: 'wechat', status: 'pending_payment', payType: 1 },
  { id: 'alipay', status: 'pending_payment', payType: 2 },
].map(order => ({ orderNo: 'WM1202610160218518BF0617E-' + order.id, remoteOrderNo: 'PROVIDER-' + order.id,
  planId: 'team', planLabel: '团队版', amount: 4900, createdAt: new Date().toISOString(), ...order }))
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://fixture.local')
  if (url.pathname === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(js); return }
  if (url.pathname === '/app.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); return }
  if (!url.pathname.startsWith('/api/')) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>'); return
  }
  let data = {}
  if (url.pathname === '/api/auth/me') data = { user: { id: 'layout-user', nickname: '订单布局测试用户', username: 'layout-user' } }
  else if (url.pathname === '/api/account/upgrade-pricing') data = { pricing: { team: { available: true, priceCents: 4900, validityDays: 90 } } }
  else if (url.pathname === '/api/account/workspace') data = { plan: { id: 'free', label: '基础版' }, plans: [], orders: [], capacity: {} }
  else if (url.pathname === '/api/account/upgrade-orders') data = { orders, counts: { all: 3, paid: 1, pending_payment: 2 }, pagination: { page: 1, total: 3, totalPages: 1 } }
  else if (url.pathname.startsWith('/api/account/upgrade-orders/')) {
    const order = orders.find(item => item.id === url.pathname.split('/')[4])
    data = { order }
    if (url.pathname.endsWith('/confirm')) {
      const payment = order.payType === 1 ? { qrcode_img_url: qr } : {
        alipaysubmit_html: `<style>body{margin:0}img{width:130px;height:130px}</style><img src="${qr}" alt="支付宝测试二维码">`,
      }
      data = { order: { ...order, payment }, payment }
    }
  } else if (url.pathname.endsWith('/records')) data = { records: [] }
  else if (url.pathname.endsWith('/messages')) data = { messages: [], settings: {} }
  else if (url.pathname.endsWith('/file-cleanup-settings')) data = { settings: { enabled: false, days: 3 } }
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const profile = await mkdtemp(path.join(os.tmpdir(), 'kunqiong-order-layout-'))
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
let socket, nextId = 0
const pending = new Map(), failures = [], runtimeErrors = []
async function waitFor(predicate, label) {
  for (let i = 0; i < 200; i++) { if (await predicate()) return; await delay(50) }
  throw new Error('Timed out: ' + label)
}
function cdp(method, params = {}) {
  const id = ++nextId
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)) }, 10000)
    pending.set(id, { resolve, reject, timeout }); socket.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails))
  return result.result.value
}
const click = label => evaluate(`document.querySelector('button[aria-label=${JSON.stringify(label)}]').click()`)
const visible = selector => evaluate(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)}), r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && el.contains(hit);
})()`)
async function check(label, condition) {
  const pass = await condition
  console.log((pass ? 'PASS ' : 'FAIL ') + label)
  if (!pass) failures.push(label)
}
async function checkOverlay(selector, label) {
  await check(label + ' covers the viewport', evaluate(`(() => {
    const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return Math.abs(r.x) < 1 && Math.abs(r.y) < 1 && Math.abs(r.width - document.documentElement.clientWidth) < 1 && Math.abs(r.height - innerHeight) < 1;
  })()`))
}
try {
  let port
  await waitFor(async () => { try { port = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); return port > 0 } catch { return false } }, 'Chromium startup')
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl)
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params)
    const entry = pending.get(message.id)
    if (entry) { pending.delete(message.id); clearTimeout(entry.timeout); message.error ? entry.reject(message.error) : entry.resolve(message.result) }
  })
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  await cdp('Page.enable'); await cdp('Runtime.enable')
  for (const [width, height] of [[1551, 862], [1296, 674], [1280, 500], [390, 844], [844, 390]]) {
    const size = `${width}x${height}`
    await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    await cdp('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/settings/orders` })
    await waitFor(() => evaluate('!!document.querySelector("[data-order-id=paid]")'), 'Order list')
    // A scrolled settings page must not become the coordinate system for a fixed dialog.
    await evaluate('window.scrollTo(0, document.documentElement.scrollHeight)')
    await click('查看订单 ' + orders[0].orderNo)
    await waitFor(() => evaluate('!!document.querySelector("#order-detail-title") && !document.body.textContent.includes("正在读取订单详情")'), 'Order details')
    await checkOverlay('.orders-dialog-backdrop', size + ' details')
    await check(size + ' detail title and close button are visible', (await visible('#order-detail-title')) && (await visible('[aria-label="关闭订单详情"]')))
    await evaluate('document.querySelector(".orders-validity-note").scrollIntoView({block:"center"})')
    await check(size + ' final validity information is reachable', visible('.orders-validity-note'))
    await click('关闭订单详情')
    for (const order of orders.slice(1)) {
      await click('查看订单 ' + order.orderNo)
      await waitFor(() => evaluate('!document.querySelector(".orders-inline-note[role=status]")'), 'Pending order details')
      await evaluate('[...document.querySelectorAll("button")].find(el => el.textContent.trim() === "继续支付").click()')
      const qrSelector = order.payType === 1 ? '.upgrade-payment-qr img' : '.upgrade-payment-alipay iframe'
      await waitFor(() => evaluate(`!!document.querySelector(${JSON.stringify(qrSelector)})`), 'Payment QR')
      const backdrop = '.upgrade-modal'
      // Check the backdrop independently of its class so the regression also runs against the old layout.
      await check(size + ' ' + order.id + ' backdrop covers the viewport', evaluate(`(() => {
        const r = document.querySelector(${JSON.stringify(backdrop)}).closest('.modal-backdrop').getBoundingClientRect();
        return Math.abs(r.x) < 1 && Math.abs(r.y) < 1 && Math.abs(r.width-document.documentElement.clientWidth) < 1 && Math.abs(r.height-innerHeight) < 1;
      })()`))
      await check(size + ' ' + order.id + ' title and close button are visible', (await visible('.upgrade-modal h2')) && (await visible('[aria-label="关闭升级窗口"]')))
      await evaluate('document.querySelector(".upgrade-payment-countdown").scrollIntoView({block:"center"})')
      await check(size + ' ' + order.id + ' countdown is fully readable', visible('.upgrade-payment-countdown'))
      await evaluate(`document.querySelector(${JSON.stringify(qrSelector)}).scrollIntoView({block:'center'})`)
      await check(size + ' ' + order.id + ' QR is completely visible', visible(qrSelector))
      await evaluate('document.querySelector(".upgrade-order-actions").scrollIntoView({block:"center"})')
      await check(size + ' ' + order.id + ' payment actions are reachable', visible('.upgrade-order-actions'))
      if (process.env.ORDER_LAYOUT_SCREENSHOT && width === 1551 && order.id === 'wechat') {
        await evaluate(`document.querySelector(${JSON.stringify(qrSelector)}).scrollIntoView({block:'center'})`)
        const shot = await cdp('Page.captureScreenshot', { format: 'png' })
        await writeFile(process.env.ORDER_LAYOUT_SCREENSHOT, Buffer.from(shot.data, 'base64'))
      }
      await click('关闭升级窗口')
    }
    await check(size + ' closing dialogs restores page scrolling', evaluate('document.body.style.overflow !== "hidden"'))
    await check(size + ' has no horizontal page overflow', evaluate('document.documentElement.scrollWidth <= innerWidth'))
  }
  await check('No browser JavaScript errors', runtimeErrors.length === 0)
  assert.deepEqual(failures, [], 'Order dialogs must remain visible at every viewport size')
} finally {
  socket?.close(); chrome.kill(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
  await new Promise(resolve => chrome.exitCode !== null ? resolve() : chrome.once('exit', resolve))
  assert.equal(path.dirname(profile), path.resolve(os.tmpdir()), 'Only delete the temporary browser profile created by this test')
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
