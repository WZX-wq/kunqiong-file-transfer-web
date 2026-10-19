import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { JSDOM, VirtualConsole } from 'jsdom'
import { build } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bundle = await build({ root, configFile: false, logLevel: 'silent', build: { write: false, minify: false,
  rollupOptions: { input: path.join(root, 'src/main.jsx'), output: { format: 'iife', inlineDynamicImports: true } } } })
const code = bundle.output.find(item => item.type === 'chunk').code
let passed = 0
function check(name, condition) { assert.ok(condition, name); passed++; console.log('PASS ' + name) }
async function waitFor(condition, name) { for (let i = 0; i < 200; i++) { if (condition()) return; await delay(10) } assert.fail(name) }
const initialOrders = () => Array.from({ length: 24 }, (_, i) => ({ id: 'order-' + i, orderNo: 'WM1-ORDER-' + i,
  remoteOrderNo: 'PROVIDER-' + i, planId: 'team', planLabel: '团队版', amount: 4900, payType: i % 2 ? 2 : 1,
  status: i === 0 ? 'pending_payment' : i === 1 ? 'paid' : i === 2 ? 'expired' : 'canceled',
  createdAt: i === 0 ? new Date().toISOString() : '2026-10-15T07:16:07Z', paidAt: i === 1 ? '2026-10-15T08:18:52Z' : null,
  remoteExpireAt: i === 1 ? '2027-01-13T08:18:52Z' : null }))
async function mount({ url = '/settings/orders', loggedIn = true, failList = false, retiredOrders = false, blockedOrders = false } = {}) {
  const errors = [], requests = [], timers = new Map(), copies = []
  const vc = new VirtualConsole(); vc.on('jsdomError', error => errors.push(error))
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://fixture.local' + url, pretendToBeVisual: true, runScripts: 'outside-only', virtualConsole: vc })
  const { window } = dom, { document } = window
  let orders = initialOrders(), force401 = false, detailFailure = false, statusFailure = false, holdQuery = '', holdDetail = false, releaseHeld, releaseDetail, nextTimer = 0
  if (retiredOrders) for (const index of [0, 2]) Object.assign(orders[index], { planId: 'enterprise', planLabel: '历史企业权益', retired: true })
  if (blockedOrders) for (const index of [0, 2]) Object.assign(orders[index], { canPurchase: false, purchaseBlockedReason: '套餐有效期内仅可升级至更高档套餐，不能购买同档或更低档套餐' })
  window.setInterval = (callback, ms) => { const id = ++nextTimer; timers.set(id, { callback, ms }); return id }
  window.clearInterval = id => timers.delete(id)
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: async value => copies.push(value) } })
  window.fetch = async (url, options = {}) => {
    requests.push({ url, method: options.method || 'GET' })
    let data = {}, status = 200
    const parsed = new URL(url, window.location.origin)
    if (url === '/api/auth/me') data = { user: loggedIn && !force401 ? { id: 'fixture-user', nickname: '测试用户', username: 'fixture-user' } : null }
    else if (force401) { status = 401; data = { message: '请先登录' } }
    else if (url === '/api/account/upgrade-pricing') data = { pricing: { team: { available: true, priceCents: 4900, validityDays: 90 } } }
    else if (url === '/api/account/workspace') data = { plan: { id: 'free', label: '基础版' }, plans: [], orders: orders.filter(o => o.status === 'pending_payment'), capacity: {} }
    else if (url === '/api/account/records') data = { records: [] }
    else if (url === '/api/account/messages') data = { messages: [], settings: {} }
    else if (url === '/api/account/file-cleanup-settings') data = { settings: { enabled: false, days: 3 } }
    else if (url === '/api/guest/quota') data = { enabled: false }
    else if (parsed.pathname === '/api/account/upgrade-orders') {
      if (options.method === 'POST') {
        const planId = JSON.parse(options.body).planId
        const order = { ...orders.find(o => o.planId === planId), id: 'replacement-order', orderNo: 'WM1-REPLACEMENT', status: 'pending_payment', createdAt: new Date().toISOString(), remoteOrderNo: '' }
        orders.unshift(order); data = { order: structuredClone(order) }
      }
      else if (failList) { status = 502; data = { message: '订单服务暂不可用' } }
      else {
        const q = parsed.searchParams.get('q') || '', s = parsed.searchParams.get('status') || 'all'
        const filtered = orders.filter(o => (s === 'all' || o.status === s) && (!q || (o.orderNo + o.remoteOrderNo).toLowerCase().includes(q.toLowerCase())))
        const limit = Number(parsed.searchParams.get('limit') || 10)
        const page = Math.min(Number(parsed.searchParams.get('page') || 1), Math.max(1, Math.ceil(filtered.length / limit)))
        data = { orders: structuredClone(filtered.slice((page - 1) * limit, page * limit)), counts: Object.fromEntries(['all', 'pending_payment', 'paid', 'canceled', 'expired'].map(s => [s, s === 'all' ? orders.length : orders.filter(o => o.status === s).length])), pagination: { page, limit, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / limit)) } }
        if (q && q === holdQuery) await new Promise(resolve => { releaseHeld = resolve })
      }
    } else if (parsed.pathname.startsWith('/api/account/upgrade-orders/')) {
      const id = parsed.pathname.split('/')[4], order = orders.find(o => o.id === id)
      if (!order) { status = 404; data = { message: '升级订单不存在' } }
      else if (url.endsWith('/confirm')) data = { order: { ...order, payment: { qrcode_img_url: 'data:image/png;base64,YQ==' } }, payment: { qrcode_img_url: 'data:image/png;base64,YQ==' } }
      else if (url.endsWith('/cancel')) { order.status = 'canceled'; data = { order: structuredClone(order) } }
      else if (url.endsWith('/pay-status')) {
        if (statusFailure) { status = 502; data = { message: '支付平台暂不可用，请稍后核对' } }
        else { order.status = 'paid'; order.paidAt = '2026-10-15T08:18:52Z'; order.remoteExpireAt = '2027-01-13T08:18:52Z'; data = { order: structuredClone(order), message: '支付成功，会员权益已开通' } }
      } else if (detailFailure) { status = 502; data = { message: '详情读取失败' } }
      else { data = { order: structuredClone(order) }; if (holdDetail) await new Promise(resolve => { releaseDetail = resolve }) }
    } else { status = 404; data = { message: 'Unexpected request: ' + url } }
    return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
  }
  window.eval(code)
  const text = () => document.body.textContent
  const click = async (name, scope = document) => {
    const button = [...scope.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === name || b.textContent.trim() === name)
    assert.ok(button, 'Button exists: ' + name); button.click(); await delay(30)
  }
  const input = async value => {
    const element = document.querySelector('input[aria-label="搜索订单号"]')
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(element, value)
    element.dispatchEvent(new window.Event('input', { bubbles: true }))
    await delay(10)
    element.closest('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await delay(40)
  }
  await waitFor(() => document.querySelector(loggedIn ? '.orders-page' : '.settings-state'), 'Account orders panel renders')
  return { window, document, text, click, input, requests, errors, copies, close: () => window.close(),
    allowList: () => { failList = false }, expire: () => { force401 = true }, detailFailure: value => { detailFailure = value },
    statusFailure: value => { statusFailure = value }, hold: value => { holdQuery = value }, release: () => releaseHeld?.(),
    holdDetail: value => { holdDetail = value }, releaseDetail: () => releaseDetail?.() }
}

const f = await mount()
try {
  await waitFor(() => f.document.querySelectorAll('[data-order-id]').length === 5, 'First page loads')
  check('我的订单显示在个人中心右侧并保留账号侧栏', f.document.querySelector('.settings-panel .orders-page') && f.document.querySelector('.settings-user-card').textContent.includes('测试用户') && f.document.querySelector('.settings-nav .active')?.textContent.trim() === '我的订单')
  check('订单栏目下方保留设置栏目与返回入口', !!f.document.querySelector('.settings-back-button') && !!f.document.querySelector('a[href="/workspace"]'))
  await f.click('账号与安全')
  check('切换其他设置只替换右侧内容', f.window.location.pathname === '/settings/security' && !f.document.querySelector('.orders-page') && f.document.querySelector('.settings-sidebar'))
  await f.click('我的订单'); await waitFor(() => f.document.querySelector('[data-order-id]'), 'Sidebar opens orders')
  check('点击左栏在同一个人中心打开订单', f.window.location.pathname === '/settings/orders' && f.document.querySelector('h1')?.textContent === '我的订单' && f.document.querySelector('.settings-nav .active')?.previousElementSibling?.textContent.trim() === '文件清理')
  check('每页五条订单且按服务端总数显示五页', f.document.querySelectorAll('[data-order-id]').length === 5 && f.text().includes('24') && f.text().includes('¥49.00') && f.document.querySelector('.orders-pagination').textContent.includes('5') && f.requests.some(request => request.url.includes('limit=5')))
  await f.click('下一页'); await waitFor(() => f.document.querySelector('[data-order-id="order-5"]'), 'Second page')
  check('分页状态保存到URL', new URL(f.window.location).searchParams.get('page') === '2')
  await f.click('已支付'); await waitFor(() => f.document.querySelectorAll('[data-order-id]').length === 1, 'Paid filter')
  check('切换筛选重置分页并只显示已支付', f.document.querySelector('[data-order-id="order-1"]') && new URL(f.window.location).searchParams.get('page') !== '2')
  await f.click('查看订单 WM1-ORDER-1')
  await waitFor(() => f.document.querySelector('[role="dialog"][aria-labelledby="order-detail-title"]'), 'Detail opens')
  check('订单详情包含渠道、确认时间和本单有效期', f.text().includes('支付宝') && f.text().includes('支付确认时间') && f.text().includes('本单有效期') && f.text().includes('PROVIDER-1'))
  check('历史付款显示已支付并说明与当前权益的区别', f.document.querySelector('.orders-detail-summary').textContent.includes('已支付') && f.text().includes('本单有效期为历史支付记录'))
  check('详情打开后焦点进入弹窗', f.document.activeElement.getAttribute('aria-label') === '关闭订单详情')
  await f.click('复制本站订单号'); check('本站订单号可以复制', f.copies.includes('WM1-ORDER-1'))
  await f.click('复制支付平台订单号'); check('支付平台订单号可以复制', f.copies.includes('PROVIDER-1'))
  f.window.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape' })); await delay(20)
  check('Esc可以关闭详情', !f.document.querySelector('#order-detail-title'))
  await f.click('全部'); await f.input('PROVIDER-23')
  await waitFor(() => f.document.querySelector('[data-order-id="order-23"]'), 'Provider order search')
  check('支持支付平台订单号搜索并写入URL', f.document.querySelectorAll('[data-order-id]').length === 1 && f.window.location.search.includes('PROVIDER-23'))
  await f.input('NOT-FOUND'); check('无匹配订单有清空入口', f.text().includes('没有找到匹配订单') && !!f.document.querySelector('button[aria-label="清空搜索"]'))
  await f.click('清空搜索'); await waitFor(() => f.document.querySelectorAll('[data-order-id]').length === 5, 'Clear search')
  f.hold('ORDER-23'); await f.input('ORDER-23'); await f.input('ORDER-1')
  await waitFor(() => f.document.querySelector('[data-order-id="order-1"]'), 'Newer search completes')
  f.release(); await delay(40)
  check('旧请求不会覆盖新搜索结果', new URL(f.window.location).searchParams.get('q') === 'ORDER-1' && f.document.querySelector('[data-order-id="order-1"]') && !f.document.querySelector('[data-order-id="order-23"]'))
  f.window.history.pushState({}, '', '/settings/orders?status=expired&page=1')
  f.window.dispatchEvent(new f.window.PopStateEvent('popstate')); await delay(50)
  check('浏览器导航恢复URL筛选', f.document.querySelector('[data-order-id="order-2"]') && f.document.querySelectorAll('[data-order-id]').length === 1)
  await f.click('查看订单 WM1-ORDER-2'); await waitFor(() => f.document.querySelector('#order-detail-title'), 'Expired order details')
  f.statusFailure(true); await f.click('核对支付状态')
  check('支付核对失败保留详情且明确提示', f.text().includes('支付平台暂不可用') && f.document.querySelector('#order-detail-title'))
  f.statusFailure(false); await f.click('核对支付状态'); await delay(40)
  check('已过期但付款的原订单可核对恢复', f.text().includes('支付成功') && f.text().includes('本单有效期') && !f.text().includes('支付平台暂不可用'))
  await f.click('关闭订单详情'); await f.click('待支付'); await f.click('查看订单 WM1-ORDER-0')
  await f.click('继续支付'); await waitFor(() => f.document.querySelector('img[alt="微信支付二维码"]'), 'Original checkout')
  check('继续支付复用原订单不新建', f.requests.some(r => r.url.endsWith('/order-0/confirm')) && !f.requests.some(r => r.url === '/api/account/upgrade-orders' && r.method === 'POST'))
  await f.click('取消订单'); check('续付收银台取消也需要确认', f.text().includes('确认取消订单？'))
  await f.click('暂不取消'); check('收银台取消确认可撤回且保留二维码', f.document.querySelector('img[alt="微信支付二维码"]') && !f.requests.some(r => r.url.endsWith('/cancel')))
  await f.click('关闭升级窗口'); await f.click('查看订单 WM1-ORDER-0'); await f.click('取消订单')
  check('取消订单有二次确认', f.text().includes('确认取消订单'))
  await f.click('暂不取消'); check('取消确认不发修改请求', !f.requests.some(r => r.url.endsWith('/cancel')))
  await f.click('取消订单'); await f.click('确认取消'); await delay(50)
  check('确认后取消原订单', f.requests.filter(r => r.url.endsWith('/order-0/cancel')).length === 1 && f.text().includes('已取消'))
  await f.click('关闭订单详情'); await f.click('全部')
  f.expire(); await f.click('刷新订单'); await delay(50)
  check('会话失效清空订单数据', !f.document.querySelector('[data-order-id]') && /登录后管理账户设置|登录后查看订单/.test(f.text()))
  check('页面运行无JS错误', f.errors.length === 0)
} finally { f.close() }

const retry = await mount({ failList: true })
try {
  await waitFor(() => retry.text().includes('订单服务暂不可用'), 'Failure shown')
  retry.allowList(); await retry.click('重试')
  await waitFor(() => retry.document.querySelector('[data-order-id]'), 'Retry succeeds')
  check('列表失败后可以重试恢复', retry.document.querySelectorAll('[data-order-id]').length === 5)
  retry.detailFailure(true); await retry.click('查看订单 WM1-ORDER-1')
  await waitFor(() => retry.text().includes('详情读取失败'), 'Detail failure shown')
  retry.detailFailure(false); await retry.click('重试详情')
  await waitFor(() => retry.text().includes('PROVIDER-1'), 'Detail retry')
  check('详情失败后可重试', retry.text().includes('本单有效期'))
} finally { retry.close() }
const closing = await mount()
try {
  await waitFor(() => closing.document.querySelector('[data-order-id]'), 'Closing fixture loads')
  closing.holdDetail(true); await closing.click('查看订单 WM1-ORDER-0')
  check('详情未读取完成时禁止续付与取消以防状态回退', [...closing.document.querySelectorAll('.orders-dialog-actions button')].every(button => button.disabled) && closing.text().includes('正在读取订单详情'))
  await closing.click('关闭订单详情'); closing.releaseDetail(); await delay(30)
  check('关闭详情后迟到响应不会重新打开弹窗', !closing.document.querySelector('#order-detail-title'))
  closing.holdDetail(false); closing.expire(); await closing.click('查看订单 WM1-ORDER-1'); await delay(30)
  check('详情接口401也清除已显示的订单', !closing.document.querySelector('[data-order-id]') && !closing.document.querySelector('#order-detail-title') && /登录后管理账户设置|登录后查看订单/.test(closing.text()))
} finally { closing.close() }
const legacy = await mount({ url: '/orders?status=paid' })
try {
  await waitFor(() => legacy.document.querySelector('[data-order-id="order-1"]'), 'Legacy order URL loads')
  check('旧订单地址回到个人中心并保留筛选参数', legacy.window.location.pathname === '/settings/orders' && legacy.window.location.search === '?status=paid' && legacy.document.querySelector('.settings-panel .orders-page'))
} finally { legacy.close() }
const guest = await mount({ loggedIn: false })
try { await waitFor(() => guest.text().includes('登录后管理账户设置'), 'Guest state'); check('游客不请求任何订单数据', !guest.requests.some(r => r.url.startsWith('/api/account/upgrade-orders'))) }
finally { guest.close() }
const replacement = await mount({ url: '/settings/orders?status=expired' })
try {
  await waitFor(() => replacement.document.querySelector('[data-order-id="order-2"]'), 'Expired order is listed')
  await replacement.click('查看订单 WM1-ORDER-2')
  await replacement.click('重新下单')
  check('订单中心的过期单显示超时提示并提供重新创建入口', replacement.text().includes('支付已超时') && !replacement.document.querySelector('iframe, .upgrade-payment-qr'))
  await replacement.click('重新创建订单')
  await waitFor(() => replacement.document.querySelector('img[alt="微信支付二维码"]'), 'Order centre replacement checkout is ready')
  check('订单中心无需套餐列表也能创建新单并显示倒计时', replacement.requests.filter(r => r.url === '/api/account/upgrade-orders' && r.method === 'POST').length === 1 && replacement.requests.some(r => r.url.endsWith('/replacement-order/confirm')) && replacement.text().includes('15:00'))
  check('重新下单不复用过期支付单', !replacement.requests.some(r => r.url.endsWith('/order-2/confirm')))
} finally { replacement.close() }
for (const [index, status] of [[0, 'pending_payment'], [2, 'expired']]) {
  const retired = await mount({ url: '/settings/orders?status=' + status, retiredOrders: true })
  try {
    await waitFor(() => retired.document.querySelector(`[data-order-id="order-${index}"]`), 'Retired order listed')
    await retired.click('查看订单 WM1-ORDER-' + index)
    const actions = retired.document.querySelector('.orders-dialog-actions').textContent
    check('下架订单不提供继续支付或重新下单 ' + status, retired.text().includes('该套餐已下架') && !actions.includes('继续支付') && !actions.includes('重新下单'))
    check('下架订单保留历史支付核对入口 ' + status, actions.includes('核对支付状态'))
  } finally { retired.close() }
}
for (const [index, status] of [[0, 'pending_payment'], [2, 'expired']]) {
  const blocked = await mount({ url: '/settings/orders?status=' + status, blockedOrders: true })
  try {
    await waitFor(() => blocked.document.querySelector(`[data-order-id="order-${index}"]`), 'Blocked order listed')
    await blocked.click('查看订单 WM1-ORDER-' + index)
    const actions = blocked.document.querySelector('.orders-dialog-actions').textContent
    check('同档或低档订单隐藏支付与重新下单入口 ' + status, blocked.text().includes('仅可升级') && !actions.includes('继续支付') && !actions.includes('重新下单'))
    check('受限订单保留核对支付状态 ' + status, actions.includes('核对支付状态'))
    await blocked.click('核对支付状态')
    check('受限订单已付款仍可核对成功 ' + status, blocked.text().includes('支付成功，会员权益已开通'))
    check('受限订单不会发起新支付单 ' + status, !blocked.requests.some(r => r.url.endsWith('/confirm') || (r.method === 'POST' && r.url === '/api/account/upgrade-orders')))
  } finally { blocked.close() }
}
console.log(JSON.stringify({ passed }))
