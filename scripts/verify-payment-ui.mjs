import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { JSDOM, VirtualConsole } from 'jsdom'
import { build } from 'vite'

// Render the real application. Only HTTP responses and the browser clock are faked.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bundle = await build({
  root, configFile: false, logLevel: 'silent',
  build: { write: false, minify: false, rollupOptions: {
    input: path.join(root, 'src/main.jsx'), output: { format: 'iife', inlineDynamicImports: true },
  } },
})
const code = bundle.output.find((item) => item.type === 'chunk').code
const plans = [
  { id: 'free', label: '基础版', totalBytes: 1024 ** 3, monthlyPrice: 0 },
  { id: 'member', label: '会员版', totalBytes: 100 * 1024 ** 3, monthlyPrice: 1900, validityDays: 30 },
]
const initialWorkspace = () => ({ plan: plans[0], plans, capacity: {}, orders: [], paymentReconciliation: { pending: false, requiresLogin: false } })
const initialOrder = () => ({ id: 'fixture-order', orderNo: 'fixture-order-no', planId: 'member', planLabel: '会员版', status: 'pending_payment', amount: 1900, createdAt: new Date().toISOString() })
let passed = 0
function check(name, condition) { assert.ok(condition, name); passed++; console.log('PASS ' + name) }
async function waitFor(condition, name) {
  for (let i = 0; i < 150; i++) { if (condition()) return; await delay(10) }
  assert.fail(name)
}
async function mount({ pending = false } = {}) {
  const jsErrors = []
  const console = new VirtualConsole()
  console.on('jsdomError', (error) => jsErrors.push(error))
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://fixture.local/workspace', pretendToBeVisual: true, runScripts: 'outside-only', virtualConsole: console })
  const { window } = dom
  const timers = new Map()
  let nextTimer = 0, workspace = initialWorkspace(), order = null, loggedIn = true
  if (pending) {
    order = { ...initialOrder(), remoteOrderNo: 'fixture-remote-order', payment: { qrcode_img_url: 'data:image/png;base64,YQ==' } }
    workspace.orders = [order]; workspace.paymentReconciliation.pending = true
  }
  let holdStatus = false, statusAborts = 0
  let holdNextWorkspace = false, heldWorkspace = null, workspaceCalls = 0, active = 0, maxActive = 0, statusCalls = 0
  window.setInterval = (callback, ms) => { const id = ++nextTimer; timers.set(id, { callback, ms }); return id }
  window.clearInterval = (id) => timers.delete(id)
  window.fetch = async (url, options = {}) => {
    let payload = {}, status = 200
    if (url === '/api/auth/me') payload = { user: loggedIn ? { id: 'fixture-user', nickname: '测试用户' } : null }
    else if (url === '/api/account/upgrade-pricing') payload = { source: 'local', pricing: {} }
    else if (url === '/api/account/workspace') {
      workspaceCalls++; active++; maxActive = Math.max(maxActive, active)
      payload = structuredClone(workspace)
      if (holdNextWorkspace) {
        holdNextWorkspace = false
        await new Promise((resolve, reject) => {
          heldWorkspace = resolve
          options.signal?.addEventListener('abort', () => reject(new window.DOMException('Aborted', 'AbortError')), { once: true })
        }).finally(() => { heldWorkspace = null; active-- })
      } else active--
    } else if (url === '/api/account/upgrade-orders' && options.method === 'POST') {
      order = initialOrder(); workspace.orders = [order]; payload = { order, orders: [order] }
    } else if (url.endsWith('/confirm')) {
      order = { ...order, remoteOrderNo: 'fixture-remote-order', payment: { qrcode_img_url: 'data:image/png;base64,YQ==' } }
      workspace.orders = [order]; workspace.paymentReconciliation.pending = true
      payload = { order, payment: order.payment }
    } else if (url.endsWith('/pay-status')) {
      statusCalls++
      if (holdStatus) await new Promise((resolve, reject) => {
        options.signal?.addEventListener('abort', () => { statusAborts++; reject(new window.DOMException('Aborted', 'AbortError')) }, { once: true })
      })
      payload = { order: workspace.orders[0], ...(workspace.plan.id === 'member' ? { workspace } : {}) }
    } else { status = 404; payload = { message: 'Unexpected fixture request: ' + url } }
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
  }
  window.eval(code)
  const document = window.document
  const text = () => document.body.textContent
  const click = async (label, selector = 'button') => {
    const button = [...document.querySelectorAll(selector)].find((item) => item.textContent.trim() === label || item.getAttribute('aria-label') === label)
    assert.ok(button, 'Button exists: ' + label)
    button.click(); await delay(20)
  }
  await waitFor(() => document.querySelector('.workspace-page'), 'Workspace initially renders')
  return {
    window, document, text, click, timers, jsErrors,
    hold: () => { holdNextWorkspace = true }, release: () => heldWorkspace?.(),
    isHeld: () => Boolean(heldWorkspace), calls: () => workspaceCalls, maxActive: () => maxActive,
    statusCalls: () => statusCalls,
    holdStatus: () => { holdStatus = true }, statusAborts: () => statusAborts,
    paid: () => { workspace = { ...workspace, plan: plans[1], orders: [{ ...order, status: 'paid' }], paymentReconciliation: { pending: false, requiresLogin: false } } },
    requiresLogin: () => { workspace.paymentReconciliation = { pending: false, requiresLogin: true } },
    logout: () => { loggedIn = false },
    tick: async (ms) => { for (const timer of [...timers.values()]) if (timer.ms === ms) timer.callback(); await delay(20) },
    close: () => dom.window.close(),
  }
}

const fixture = await mount()
try {
  await fixture.click('升级权益', '.workspace-benefits-cta button')
  fixture.hold()
  await fixture.click('创建升级订单')
  await waitFor(fixture.isHeld, 'Pre-checkout workspace response is held')
  await fixture.click('继续支付')
  await fixture.click('关闭升级窗口')
  fixture.release()
  await waitFor(() => fixture.calls() >= 3, 'Checkout refresh is queued behind the earlier workspace snapshot')
  await waitFor(() => [...fixture.timers.values()].some((timer) => timer.ms === 15000), 'Workbench tracks the pending remote payment')
  check('Delayed workspace snapshot cannot discard checkout refresh', fixture.maxActive() === 1)
  const modalQueries = fixture.statusCalls()
  fixture.paid()
  await fixture.tick(15000)
  await waitFor(() => fixture.document.querySelector('.workspace-hero h1')?.textContent === '会员版空间', 'Entitlements refresh after the payment dialog closes')
  check('Closed payment dialog still refreshes paid entitlements', fixture.statusCalls() === modalQueries)
  await waitFor(() => ![...fixture.timers.values()].some((timer) => timer.ms === 15000), 'Paid workspace stops pending-payment polling')
  check('Paid workspace stops periodic payment refresh', true)

  fixture.requiresLogin()
  fixture.window.dispatchEvent(new fixture.window.Event('focus'))
  await waitFor(() => fixture.text().includes('支付订单需要重新登录核对状态'), 'Focus refresh discovers login-required payments')
  check('Upstream expiry offers a fresh login', Boolean(fixture.document.querySelector('.workspace-payment-warning button')))
  fixture.logout()
  fixture.window.dispatchEvent(new fixture.window.Event('focus'))
  await waitFor(() => fixture.text().includes('登录后使用团队空间'), 'Expired login removes private workspace data')
  check('Focus refresh handles lost login access', !fixture.document.querySelector('.workspace-page'))
  check('Real React UI completes without runtime errors', fixture.jsErrors.length === 0)
} finally { fixture.close() }

const pendingFixture = await mount({ pending: true })
try {
  await pendingFixture.click('升级权益', '.workspace-benefits-cta button')
  pendingFixture.holdStatus()
  await pendingFixture.tick(2000)
  await pendingFixture.tick(2000)
  check('Slow modal payment queries cannot overlap', pendingFixture.statusCalls() === 1)
  await pendingFixture.click('关闭升级窗口')
  check('Closing the modal aborts its in-flight payment query', pendingFixture.statusAborts() === 1 && ![...pendingFixture.timers.values()].some((timer) => timer.ms === 2000))
  const calls = pendingFixture.calls()
  Object.defineProperty(pendingFixture.document, 'visibilityState', { configurable: true, value: 'hidden' })
  await pendingFixture.tick(15000)
  pendingFixture.document.dispatchEvent(new pendingFixture.window.Event('visibilitychange'))
  await delay(20)
  check('Hidden workspace avoids unnecessary refresh requests', pendingFixture.calls() === calls)
  Object.defineProperty(pendingFixture.document, 'visibilityState', { configurable: true, value: 'visible' })
  pendingFixture.document.dispatchEvent(new pendingFixture.window.Event('visibilitychange'))
  await waitFor(() => pendingFixture.calls() > calls, 'Returning to the workspace refreshes payment state')
  check('Visible workspace resumes payment refresh', true)
} finally { pendingFixture.close() }
console.log(`Payment UI checks: ${passed}/${passed}`)
