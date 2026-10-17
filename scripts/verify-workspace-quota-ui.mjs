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
const planRank = { free: 0, member: 1, team: 2, enterprise: 3 }
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
async function mount(planId, { includeCapacityTotal = true, organizationRole = '', organizationTeamPlanId = '' } = {}) {
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
      }, ...(organizationRole ? {
        organization: {
          id: 'fixture-team', name: '测试团队', slug: 'fixture-team',
          ownerUserId: organizationRole === 'owner' ? 'quota-user' : 'team-owner',
          members: [
            { userId: 'team-owner', role: 'owner', status: 'active', displayName: '团队所有者', email: 'owner@example.test' },
            { userId: 'quota-user', role: organizationRole, status: 'active', displayName: '额度测试用户', email: 'user@example.test' },
          ],
        },
        canManage: organizationRole === 'owner' || organizationRole === 'admin',
        teamEntitlement: {
          organizationId: 'fixture-team',
          role: organizationRole, canUseTeamSpace: true, teamSpaceBytes: (plans.find(item => item.id === organizationTeamPlanId)?.teamSpaceBytes || 250 * GB),
          teamPlanId: organizationTeamPlanId || (plan.team ? plan.id : 'team'),
          teamPlanLabel: plans.find(item => item.id === organizationTeamPlanId)?.label || (plan.team ? plan.label : '团队版'),
        },
      } : {}) }
    } else throw new Error('Unexpected fixture request: ' + url)
    return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } })
  }
  window.eval(code)
  const document = window.document
  await waitFor(() => document.querySelector('.workspace-page .workspace-capacity'), 'Workspace loads')
  return {
    window, document, errors, mutations,
    usage: () => ({
      label: document.querySelector('.workspace-capacity > div > span').textContent,
      amount: document.querySelector('.workspace-capacity strong').textContent,
      percent: document.querySelector('.workspace-capacity [role="progressbar"]').getAttribute('aria-valuenow'),
      width: document.querySelector('.capacity-bar > span').style.width,
    }),
    openPlanCatalog: async () => {
      document.querySelector('.workspace-benefits-cta .primary-button').click()
      await waitFor(() => document.querySelector('.upgrade-modal'), 'Plan comparison dialog opens')
      check('Full four-tier plan comparison opens', document.querySelectorAll('.upgrade-plan-card').length, 4)
      if (currentPlanId !== 'enterprise') {
        await waitFor(() => [...document.querySelectorAll('.upgrade-plan-card')].some(card => card.textContent.includes('90天')), 'Remote package pricing finishes loading')
      }
    },
    closePlanCatalog: async () => { document.querySelector('[aria-label="关闭升级窗口"]').click(); await delay(20) },
    select: async (label, selector = '.plan-comparison button') => {
      const button = [...document.querySelectorAll(selector)].find(item => item.textContent.includes(label))
      assert.ok(button, 'Plan card exists: ' + label)
      if (selector === '.plan-comparison button') assert.equal(button.disabled, false, 'Plan card can be selected: ' + label)
      button.click(); await delay(20)
      assert.ok(button.classList.contains('selected') || button.getAttribute('aria-pressed') === 'true', 'Selected plan is visibly selected: ' + label)
    },
    refreshPlan: async id => {
      currentPlanId = id
      window.dispatchEvent(new window.Event('focus'))
      await waitFor(() => document.querySelector('.workspace-section-heading h2')?.textContent.includes(plans.find(item => item.id === id).label), 'Actual account upgrade refreshes')
    },
    close: async () => { await delay(20); window.close() },
  }
}

for (const current of plans) {
  const fixture = await mount(current.id)
  try {
    check(current.label + '初始显示实际权益', fixture.usage(), expectedUsage[current.id])
    check('套餐价格卡首屏直接显示，且不重复展示状态卡或升级弹窗',
      Boolean(fixture.document.querySelector('.plan-comparison')) && !fixture.document.querySelector('.upgrade-plan-card') && !fixture.document.querySelector('.workspace-status-card'), true)
    check(current.label + '只有一个清晰的套餐入口',
      fixture.document.querySelector('.workspace-benefits-cta .primary-button').textContent.trim(),
      current.id === 'enterprise' ? '查看已购权益' : '套餐对比与升级')
    check('首屏显示全部四档价格卡', [...fixture.document.querySelectorAll('.plan-comparison .plan-title-line strong')].map(item => item.textContent), ['基础版', '会员版', '团队版', '企业版'])
    check('首屏每档价格均有显示', [...fixture.document.querySelectorAll('.plan-price-summary')].every(item => item.textContent.trim().length > 0), true)
    const defaultPlan = plans.find(item => item.id !== 'free' && planRank[item.id] >= planRank[current.id] && !(item.id === current.id && item.permanent)) || current
    check(current.label + '默认高亮弹窗可办理套餐', fixture.document.querySelector('.plan-comparison button.selected .plan-title-line strong')?.textContent, defaultPlan.label)
    for (const card of [...fixture.document.querySelectorAll('.plan-comparison button')]) {
      const label = card.querySelector('.plan-title-line strong').textContent
      if (card.disabled) {
        check(current.label + label + '仍显示价格但不可作为升级目标', Boolean(card.querySelector('.plan-price-summary')?.textContent.trim()), true)
        continue
      }
      await fixture.select(label)
      check(current.label + '选择' + label + '后已购额度保持不变', fixture.usage(), expectedUsage[current.id])
    }
    await fixture.openPlanCatalog()
    check('套餐弹窗完整列出四个等级', [...fixture.document.querySelectorAll('.upgrade-plan-top > strong')].map(item => item.textContent), ['基础版', '会员版', '团队版', '企业版'])
    for (const card of fixture.document.querySelectorAll('.upgrade-plan-card')) {
      const amountColumns = card.querySelectorAll('.plan-space-summary > span')
      const label = card.querySelector('.upgrade-plan-top > strong').textContent
      check(label + '容量指标分列显示', amountColumns.length, ['团队版', '企业版'].includes(label) ? 2 : 1)
    }
    if (current.id !== 'enterprise') {
      check('页面选择的套餐在升级弹窗中保持选中', fixture.document.querySelector('.upgrade-plan-card.selected .upgrade-plan-top > strong')?.textContent, '企业版')
    }
    for (const card of [...fixture.document.querySelectorAll('.upgrade-plan-card')].filter(item => !item.disabled)) {
      await fixture.select(card.querySelector('.upgrade-plan-top > strong').textContent)
      check(current.label + '选择' + card.querySelector('.upgrade-plan-top > strong').textContent + '后已购额度保持不变', fixture.usage(), expectedUsage[current.id])
    }
    if (current.id === 'team') {
      await fixture.select('企业版')
      check('升级弹窗选购其他套餐也不改变现有额度', fixture.usage(), expectedUsage.team)
      await fixture.closePlanCatalog()
      await fixture.refreshPlan('enterprise')
      check('实际账号权益更新后显示新的额度', fixture.usage(), expectedUsage.enterprise)
    } else await fixture.closePlanCatalog()
    check('仅浏览套餐不会修改账号或创建订单', fixture.mutations, [])
    check('页面运行无JS错误', fixture.errors, [])
  } finally { await fixture.close() }
}

const fallback = await mount('team', { includeCapacityTotal: false })
try {
  await fallback.openPlanCatalog()
  await fallback.select('企业版')
  check('容量字段缺省时仍使用当前已购套餐额度', fallback.usage(), expectedUsage.team)
} finally { await fallback.close() }

const manager = await mount('team', { organizationRole: 'admin' })
try {
  check('管理员首屏显示团队名称、身份、所有者和团队入口',
    ['测试团队', '团队管理员', '团队所有者', '查看团队成员与使用情况'].every(text => manager.document.querySelector('.workspace-team-card').textContent.includes(text)), true)
  check('管理员首屏直接显示邀请链接和复制入口',
    Boolean(manager.document.querySelector('.workspace-invite-link-row code') && manager.document.querySelector('.workspace-invite-link-row .copy-button')),
    true)
  check('邀请链接不再收进下拉区', !manager.document.querySelector('.workspace-invite-details'), true)
} finally { await manager.close() }

const member = await mount('free', { organizationRole: 'member' })
try {
  const teamCard = member.document.querySelector('.workspace-team-card')
  check('普通成员看到邀请权限提示，不看到可复制链接',
    teamCard.textContent.includes('邀请链接由团队所有者或管理员管理') && !teamCard.querySelector('.workspace-invite-link-row') && !teamCard.querySelector('.copy-button'), true)
} finally { await member.close() }

const transferredOwner = await mount('free', { organizationRole: 'owner', organizationTeamPlanId: 'enterprise' })
try {
  const entitlementNotice = transferredOwner.document.querySelector('.workspace-team-maximum-notice')
  check('Transferred enterprise owner sees the highest team entitlement notice', entitlementNotice?.textContent.includes('已拥有当前最高等级权益，无需继续升级'), true)
  check('Transferred owner price catalog is explicitly scoped to the personal plan',
    transferredOwner.document.querySelector('.workspace-plan-catalog-heading strong')?.textContent,
    '个人套餐价格')
  check('Transferred owner can distinguish the team-owned enterprise tier from personal pricing',
    transferredOwner.document.querySelector('.plan-comparison button[data-plan-id="enterprise"] .plan-current-tag')?.textContent,
    '团队已拥有')
  await transferredOwner.openPlanCatalog()
  check('Upgrade dialog explains the personal/team entitlement boundary',
    transferredOwner.document.querySelector('.upgrade-modal .upgrade-maximum-notice')?.textContent.includes('以下价格卡和订单用于你的个人套餐'), true)
} finally { await transferredOwner.close() }
console.log(`Workspace quota UI checks: ${passed}/${passed}`)
