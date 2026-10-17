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
const enterprisePlan = { id: 'enterprise', label: '企业版', totalBytes: 2048 * 1024 ** 3, teamSpaceBytes: 1024 ** 3, monthlyPrice: 15900, permanent: true }
const enterprisePlans = [...plans, { id: 'team', label: '团队版', totalBytes: 500 * 1024 ** 3, monthlyPrice: 4900, validityDays: 90 }, enterprisePlan]
const initialWorkspace = () => ({ plan: plans[0], plans, capacity: {}, orders: [], paymentReconciliation: { pending: false, requiresLogin: false } })
const initialOrder = () => ({ id: 'fixture-order', orderNo: 'fixture-order-no', planId: 'member', planLabel: '会员版', status: 'pending_payment', amount: 1900, createdAt: new Date().toISOString() })
let passed = 0
function check(name, condition) { assert.ok(condition, name); passed++; console.log('PASS ' + name) }
async function waitFor(condition, name) {
  for (let i = 0; i < 150; i++) { if (condition()) return; await delay(10) }
  assert.fail(name)
}
async function mount({ pending = false, paymentReady = true, confirmationFailures = 0, statusFailures = 0, conflict = false, ageMs = 0, currentPlan = plans[0], availablePlans = plans, pricing = { member: { available: true, priceCents: 1900, validityDays: 30 } } } = {}) {
  const jsErrors = []
  const console = new VirtualConsole()
  console.on('jsdomError', (error) => jsErrors.push(error))
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://fixture.local/workspace', pretendToBeVisual: true, runScripts: 'outside-only', virtualConsole: console })
  const { window } = dom
  let clock = Date.now()
  window.Date.now = () => clock
  const timers = new Map()
  let nextTimer = 0, workspace = initialWorkspace(), order = null, loggedIn = true
  workspace.plan = currentPlan
  workspace.plans = availablePlans
  if (pending) {
    order = { ...initialOrder(), createdAt: new Date(clock - ageMs).toISOString(), ...(paymentReady ? { remoteOrderNo: 'fixture-remote-order', payment: { qrcode_img_url: 'data:image/png;base64,YQ==' } } : {}) }
    workspace.orders = [order]; workspace.paymentReconciliation.pending = true
  }
  let holdStatus = false, statusAborts = 0, createCalls = 0, confirmCalls = 0
  let holdNextWorkspace = false, heldWorkspace = null, workspaceCalls = 0, active = 0, maxActive = 0, statusCalls = 0
  window.setInterval = (callback, ms) => { const id = ++nextTimer; timers.set(id, { callback, ms }); return id }
  window.clearInterval = (id) => timers.delete(id)
  window.fetch = async (url, options = {}) => {
    let payload = {}, status = 200
    if (url === '/api/auth/me') payload = { user: loggedIn ? { id: 'fixture-user', nickname: '测试用户' } : null }
    else if (url === '/api/account/upgrade-pricing') payload = { source: 'remote', pricing }
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
      createCalls++
      order = { ...initialOrder(), id: 'fixture-order-' + createCalls, createdAt: new Date(clock).toISOString() }; workspace.orders = [order]; payload = { order, orders: [order] }
      if (conflict) { status = 409; payload.message = '已有一个待支付的升级订单' }
    } else if (url.endsWith('/confirm')) {
      confirmCalls++
      if (confirmationFailures > 0) {
        confirmationFailures--; status = 502; payload = { message: '支付服务暂不可用' }
      } else {
        const payType = JSON.parse(options.body).payType
        order = { ...order, payType, remoteOrderNo: 'fixture-remote-order', payment: payType === 2 ? { alipaysubmit_html: '<form>支付宝测试收银台</form>' } : { qrcode_img_url: 'data:image/png;base64,YQ==' } }
        workspace.orders = [order]; workspace.paymentReconciliation.pending = true
        payload = { order, payment: order.payment }
      }
    } else if (url.endsWith('/cancel')) {
      order = { ...order, status: 'canceled' }; workspace.orders = [order]; payload = { order }
    } else if (url.endsWith('/pay-status')) {
      statusCalls++
      if (holdStatus) await new Promise((resolve, reject) => {
        options.signal?.addEventListener('abort', () => { statusAborts++; reject(new window.DOMException('Aborted', 'AbortError')) }, { once: true })
      })
      if (statusFailures > 0) {
        statusFailures--; status = 502; payload = { message: '支付服务返回的套餐有效期无效，请稍后重新查询' }
      } else payload = { order: workspace.orders[0], ...(workspace.plan.id === 'member' ? { workspace } : {}) }
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
    createCalls: () => createCalls, confirmCalls: () => confirmCalls,
    holdStatus: () => { holdStatus = true }, statusAborts: () => statusAborts,
    paid: () => { workspace = { ...workspace, plan: plans[1], orders: [{ ...order, status: 'paid', remoteExpireAt: new Date(Date.now() + 30 * 86400000).toISOString() }], paymentReconciliation: { pending: false, requiresLogin: false } } },
    requiresLogin: () => { workspace.paymentReconciliation = { pending: false, requiresLogin: true } },
    logout: () => { loggedIn = false },
    tick: async (ms) => { for (const timer of [...timers.values()]) if (timer.ms === ms) timer.callback(); await delay(20) },
    advance: async (ms) => { clock += ms; for (const timer of [...timers.values()]) if (timer.ms === 1000) timer.callback(); await delay(20) },
    returnAfter: async (ms) => { clock += ms; window.dispatchEvent(new window.Event('focus')); document.dispatchEvent(new window.Event('visibilitychange')); await delay(20) },
    close: () => dom.window.close(),
  }
}

const fixture = await mount()
try {
  await fixture.click('套餐对比与升级', '.workspace-benefits-cta button')
  fixture.hold()
  await fixture.click('创建升级订单')
  await waitFor(fixture.isHeld, 'Pre-checkout workspace response is held')
  await waitFor(() => fixture.document.querySelector('img[alt="微信支付二维码"]'), 'Creating the order automatically displays the payment QR code')
  check('Creating an order opens its QR code without another payment click', fixture.createCalls() === 1 && fixture.confirmCalls() === 1)
  check('QR checkout has no extra continue-payment step', !fixture.text().includes('继续支付'))
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

const alipayFixture = await mount()
try {
  await alipayFixture.click('套餐对比与升级', '.workspace-benefits-cta button')
  await alipayFixture.click('支付宝')
  await alipayFixture.click('创建升级订单')
  await waitFor(() => alipayFixture.document.querySelector('iframe[title="支付宝收银台"]'), 'Selected Alipay checkout loads automatically')
  check('Choosing Alipay before creation directly loads its checkout', alipayFixture.createCalls() === 1 && alipayFixture.confirmCalls() === 1 && !alipayFixture.document.querySelector('img[alt="微信支付二维码"]'))
} finally { alipayFixture.close() }

const retryFixture = await mount({ confirmationFailures: 1 })
try {
  await retryFixture.click('套餐对比与升级', '.workspace-benefits-cta button')
  await retryFixture.click('创建升级订单')
  await waitFor(() => retryFixture.text().includes('支付服务暂不可用'), 'Automatic payment failure is visible')
  await delay(80)
  check('Payment failure keeps the order and does not repeatedly create payment requests', !!retryFixture.document.querySelector('.upgrade-order-meta') && retryFixture.createCalls() === 1 && retryFixture.confirmCalls() === 1)
  await retryFixture.click('重新加载支付码')
  await waitFor(() => retryFixture.document.querySelector('img[alt="微信支付二维码"]'), 'Retry loads the original order payment')
  check('Retry uses the existing order without creating a duplicate', retryFixture.createCalls() === 1 && retryFixture.confirmCalls() === 2)
  await retryFixture.click('取消订单')
  await waitFor(() => retryFixture.document.querySelector('.upgrade-summary'), 'Cancel returns to plan selection')
  check('Cancel removes the previous payment QR code', !retryFixture.document.querySelector('.upgrade-payment-qr'))
  await retryFixture.click('创建升级订单')
  await waitFor(() => retryFixture.document.querySelector('img[alt="微信支付二维码"]'), 'Another order loads a fresh checkout after cancellation')
  check('Creating after cancel requests a fresh payment', retryFixture.createCalls() === 2 && retryFixture.confirmCalls() === 3)
} finally { retryFixture.close() }

for (const options of [{ pending: true, paymentReady: false }, { conflict: true }]) {
  const restored = await mount(options)
  try {
    await restored.click('套餐对比与升级', '.workspace-benefits-cta button')
    if (options.conflict) await restored.click('创建升级订单')
    await waitFor(() => restored.document.querySelector('img[alt="微信支付二维码"]'), 'Existing unpaid order automatically loads its QR code')
    check('Existing unpaid order resumes payment automatically ' + (options.conflict ? 'after creation conflict' : 'when reopened'), restored.confirmCalls() === 1 && restored.createCalls() === (options.conflict ? 1 : 0))
  } finally { restored.close() }
}

const pendingFixture = await mount({ pending: true })
try {
  await pendingFixture.click('套餐对比与升级', '.workspace-benefits-cta button')
  check('Reopening an order with a QR code reuses the existing checkout', pendingFixture.confirmCalls() === 0 && !!pendingFixture.document.querySelector('img[alt="微信支付二维码"]'))
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
for (const refresh of ['manual', 'automatic']) {
  const recovered = await mount({ pending: true, statusFailures: 1 })
  try {
    await recovered.click('套餐对比与升级', '.workspace-benefits-cta button')
    await recovered.click('刷新支付状态')
    check('Payment query failure keeps the original checkout ' + refresh, recovered.text().includes('支付服务返回的套餐有效期无效') && !!recovered.document.querySelector('.upgrade-payment-qr'))
    recovered.paid()
    if (refresh === 'manual') await recovered.click('刷新支付状态')
    else await recovered.tick(2000)
    await waitFor(() => recovered.document.querySelector('.upgrade-success-view'), 'Paid status restores the success view ' + refresh)
    check('Successful payment clears the previous error ' + refresh, !recovered.text().includes('支付服务返回的套餐有效期无效') && !recovered.document.querySelector('.upgrade-payment-qr'))
    check('Successful payment shows a valid expiry ' + refresh, recovered.document.querySelector('.upgrade-success-view').textContent.includes('有效期至') && !/Invalid Date|以主站权益为准/.test(recovered.document.querySelector('.upgrade-success-view').textContent))
    await waitFor(() => recovered.document.querySelector('.workspace-hero h1')?.textContent === '会员版空间', 'Recovered payment refreshes account entitlements ' + refresh)
  } finally { recovered.close() }
}
const expiryFixture = await mount({ pending: true, ageMs: 14 * 60000 })
try {
  await expiryFixture.click('套餐对比与升级', '.workspace-benefits-cta button')
  check('Reopened checkout keeps the original fifteen-minute deadline', expiryFixture.document.querySelector('.upgrade-payment-countdown')?.textContent.includes('01:00'))
  await expiryFixture.advance(59000)
  check('Payment stays visible one second before expiry', !!expiryFixture.document.querySelector('img[alt="微信支付二维码"]') && expiryFixture.text().includes('00:01'))
  await expiryFixture.advance(1000)
  check('At the exact deadline the old payment code disappears', !expiryFixture.document.querySelector('.upgrade-payment-qr') && expiryFixture.text().includes('支付已超时'))
  check('Expired checkout cannot reload or cancel the old payment', !expiryFixture.text().includes('重新加载支付码') && ![...expiryFixture.document.querySelectorAll('button')].some(b => b.textContent.trim() === '取消订单'))
  await expiryFixture.click('重新创建订单')
  await waitFor(() => expiryFixture.document.querySelector('img[alt="微信支付二维码"]'), 'Replacement order loads a fresh code')
  check('Recreating an expired order starts a new fifteen-minute checkout', expiryFixture.createCalls() === 1 && expiryFixture.confirmCalls() === 1 && expiryFixture.text().includes('15:00'))
} finally { expiryFixture.close() }

const expiredOnOpen = await mount({ pending: true, paymentReady: false, ageMs: 15 * 60000 })
try {
  await expiredOnOpen.click('套餐对比与升级', '.workspace-benefits-cta button')
  check('Opening an expired order never requests a new code for it', expiredOnOpen.confirmCalls() === 0 && expiredOnOpen.text().includes('支付已超时'))
} finally { expiredOnOpen.close() }

const suspended = await mount({ pending: true })
try {
  await suspended.click('套餐对比与升级', '.workspace-benefits-cta button')
  await suspended.returnAfter(16 * 60000)
  check('Returning from a suspended tab catches up without restarting the timer', !suspended.document.querySelector('.upgrade-payment-qr') && suspended.text().includes('支付已超时') && suspended.confirmCalls() === 0)
} finally { suspended.close() }

const expiryAlipay = await mount()
try {
  await expiryAlipay.click('套餐对比与升级', '.workspace-benefits-cta button')
  await expiryAlipay.click('支付宝')
  await expiryAlipay.click('创建升级订单')
  await waitFor(() => expiryAlipay.document.querySelector('iframe'), 'Alipay is ready')
  await expiryAlipay.advance(15 * 60000)
  check('Expiry removes the Alipay checkout iframe as well', !expiryAlipay.document.querySelector('iframe') && expiryAlipay.text().includes('支付已超时'))
  expiryAlipay.paid()
  await expiryAlipay.tick(2000)
  await waitFor(() => expiryAlipay.document.querySelector('.upgrade-success-view'), 'Payment at the deadline is still reconciled')
  check('A confirmed payment at expiry still activates entitlements', !expiryAlipay.text().includes('重新创建订单'))
} finally { expiryAlipay.close() }

const highestPlan = await mount({
  currentPlan: enterprisePlan,
  availablePlans: enterprisePlans,
  pricing: {
    member: { available: true, priceCents: 1900, validityDays: 30 },
    team: { available: true, priceCents: 4900, validityDays: 90 },
    enterprise: { available: true, priceCents: 15900, validityDays: 0 },
  },
})
try {
  await highestPlan.click('查看已购权益', '.workspace-benefits-cta button')
  await waitFor(() => highestPlan.document.querySelector('.upgrade-modal'), 'Highest tier modal opens')
  check('Highest tier with no upgrade option does not show an unavailable-plan error', !highestPlan.text().includes('套餐暂不可用，请稍后重试'))
  check('Highest tier explains that the current entitlement is already the maximum', highestPlan.text().includes('已拥有当前最高等级权益'))
} finally { highestPlan.close() }
console.log(`Payment UI checks: ${passed}/${passed}`)
