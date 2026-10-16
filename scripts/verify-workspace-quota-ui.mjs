import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { JSDOM, VirtualConsole } from 'jsdom'
import { build } from 'vite'

// Selecting a comparison card must never change the account's current usage.
// Render the real application; only account/pricing HTTP responses are fixtures.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bundle = await build({ root, configFile: false, logLevel: 'silent', build: {
  write: false, minify: false,
  rollupOptions: { input: path.join(root, 'src/main.jsx'), output: { format: 'iife', inlineDynamicImports: true } },
} })
const code = bundle.output.find(item => item.type === 'chunk').code
const GB = 1024 ** 3
const plans = [
  { id: 'free', label: '基础版', totalBytes: 20 * GB, monthlyPrice: 0 },
  { id: 'member', label: '会员版', totalBytes: 1000 * GB, monthlyPrice: 1900, permanent: true },
  { id: 'team', label: '团队版', totalBytes: 500 * GB, teamSpaceBytes: 250 * GB, monthlyPrice: 4900, permanent: true, team: true },
  { id: 'enterprise', label: '企业版', totalBytes: 2048 * GB, teamSpaceBytes: 1024 * GB, monthlyPrice: 15900, permanent: true, team: true },
]
const expectedUsage = {
  free: { label: '已使用空间 · 基础版', amount: '10.00 GB / 20.00 GB', percent: '50', width: '50%' },
  member: { label: '已使用空间 · 会员版', amount: '100.00 GB / 1000.00 GB', percent: '10', width: '10%' },
  team: { label: '已使用空间 · 团队版', amount: '100.00 GB / 500.00 GB', percent: '20', width: '20%' },
  enterprise: { label: '已使用空间 · 企业版', amount: '100.00 GB / 2048.00 GB', percent: '5', width: '5%' },
}
let passed = 0
function check(name, actual, expected) {
  assert.deepEqual(actual, expected, name)
  passed++; console.log('PASS ' + name)
}
async function waitFor(condition, name) {
  for (let i = 0; i < 150; i++) { if (condition()) return; await delay(10) }
  assert.fail(name)
}
async function mount(planId, { includeCapacityTotal = true } = {}) {
  const errors = [], mutations = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', error => errors.push(error))
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: 'http://fixture.local/workspace', pretendToBeVisual: true, runScripts: 'outside-only', virtualConsole,
  })
  const { window } = dom
  let currentPlanId = planId
  window.fetch = async (url, options = {}) => {
    if (options.method && options.method !== 'GET') mutations.push({ url, method: options.method })
    let payload
    if (url === '/api/auth/me') payload = { user: { id: 'quota-user', nickname: '额度测试用户' } }
    else if (url === '/api/account/upgrade-pricing') payload = {
      source: 'remote', pricing: Object.fromEntries(plans.map(plan => [plan.id, { available: true, priceCents: plan.monthlyPrice, validityDays: 90 }])),
    }
    else if (url === '/api/account/workspace') {
      const plan = plans.find(item => item.id === currentPlanId)
      payload = { plan, plans, orders: [], capacity: {
        ...(includeCapacityTotal ? { totalBytes: plan.totalBytes } : {}),
        usedBytes: (currentPlanId === 'free' ? 10 : 100) * GB, shareCount: 4, collectionCount: 1, fileCount: 39,
      } }
    } else throw new Error('Unexpected fixture request: ' + url)
    return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } })
  }
  window.eval(code)
  const document = window.document
  await waitFor(() => document.querySelector('.workspace-page'), 'Workspace loads')
  await waitFor(() => document.querySelector('.plan-comparison')?.textContent.includes('90天'), 'Initial account effects and remote pricing finish')
  return {
    window, document, errors, mutations,
    usage: () => ({
      label: document.querySelector('.workspace-capacity > div > span').textContent,
      amount: document.querySelector('.workspace-capacity strong').textContent,
      percent: document.querySelector('.workspace-capacity [role="progressbar"]').getAttribute('aria-valuenow'),
      width: document.querySelector('.capacity-bar > span').style.width,
    }),
    select: async (label, selector = '.plan-comparison [role="tab"]') => {
      const button = [...document.querySelectorAll(selector)].find(item => item.textContent.includes(label))
      assert.ok(button, 'Plan card exists: ' + label)
      button.click(); await delay(20)
    },
    refreshPlan: async id => {
      currentPlanId = id
      window.dispatchEvent(new window.Event('focus'))
      await waitFor(() => document.querySelector('.workspace-section-heading h2')?.textContent.includes(plans.find(item => item.id === id).label), 'Actual account upgrade refreshes')
    },
    close: () => window.close(),
  }
}

for (const current of plans) {
  const fixture = await mount(current.id)
  try {
    check(current.label + '初始显示实际权益', fixture.usage(), expectedUsage[current.id])
    for (const selected of plans) {
      await fixture.select(selected.label)
      check(current.label + '选择' + selected.label + '后额度、名称和进度保持不变', fixture.usage(), expectedUsage[current.id])
      check('套餐比较仍可选中' + selected.label, fixture.document.querySelector('.plan-comparison [aria-selected="true"] strong').textContent, selected.label)
    }
    if (current.id === 'team') {
      fixture.document.querySelector('.workspace-benefits-cta button').click()
      await waitFor(() => fixture.document.querySelector('.upgrade-plan-card'), 'Upgrade dialog opens')
      await fixture.select('企业版', '.upgrade-plan-card')
      check('升级弹窗选购其他套餐也不改变现有额度', fixture.usage(), expectedUsage.team)
      fixture.document.querySelector('[aria-label="关闭升级窗口"]').click()
      await fixture.refreshPlan('enterprise')
      check('实际账号权益更新后显示新的额度', fixture.usage(), expectedUsage.enterprise)
    }
    check('仅浏览套餐不会修改账号或创建订单', fixture.mutations, [])
    check('页面运行无JS错误', fixture.errors, [])
  } finally { fixture.close() }
}

const fallback = await mount('team', { includeCapacityTotal: false })
try {
  await fallback.select('会员版')
  check('容量字段缺省时仍使用当前已购套餐额度', fallback.usage(), expectedUsage.team)
} finally { fallback.close() }
console.log(`Workspace quota UI checks: ${passed}/${passed}`)
