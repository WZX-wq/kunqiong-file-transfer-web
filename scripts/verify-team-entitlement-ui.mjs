import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { JSDOM, VirtualConsole } from 'jsdom'
import { build } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bundle = await build({
  root,
  configFile: false,
  logLevel: 'silent',
  worker: { format: 'es' },
  build: { write: false, minify: false, rollupOptions: { input: path.join(root, 'src/main.jsx'), output: { format: 'iife', inlineDynamicImports: true } } },
})
const code = bundle.output.find(item => item.type === 'chunk' && item.isEntry).code
const GB = 1024 ** 3
const plans = [
  { id: 'free', label: '基础版', totalBytes: 20 * GB, teamSpaceBytes: 0, singleFileLimitBytes: 2 * GB, permanent: false, team: false, collectionParticipantLimit: 10, activeCollectionLimit: 1 },
  { id: 'team', label: '团队版', totalBytes: 500 * GB, teamSpaceBytes: 250 * GB, singleFileLimitBytes: 10 * GB, permanent: true, team: true, collectionParticipantLimit: 100, activeCollectionLimit: 20 },
]
let passed = 0
async function mount(role) {
  const errors = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', error => errors.push(error))
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: 'http://fixture.local/workspace', pretendToBeVisual: true, runScripts: 'outside-only', virtualConsole,
  })
  const { window } = dom
  const userId = role === 'owner' ? 'owner' : 'member'
  const owner = { userId: 'owner', role: 'owner', status: 'active', displayName: '团队所有者' }
  const member = { userId: 'member', role: 'member', status: 'active', displayName: '团队成员' }
  window.fetch = async url => {
    let data
    if (url === '/api/auth/me') data = { user: { id: userId, nickname: userId === 'owner' ? '团队所有者' : '团队成员' } }
    else if (url === '/api/account/workspace') data = {
      plan: plans[0], plans, orders: [], planStartedAt: null, planExpiresAt: null,
      capacity: { totalBytes: 20 * GB, usedBytes: 0, remainingBytes: 20 * GB, shareCount: 0, collectionCount: 0, fileCount: 0 },
      organization: { id: 'fixture-team', slug: 'fixture-team', name: '测试团队', ownerUserId: 'owner', members: [owner, member], createdAt: new Date().toISOString() },
      canManage: false, isOwner: role === 'owner',
      teamEntitlement: { organizationId: 'fixture-team', organizationName: '测试团队', role, canManage: false, canUseTeamSpace: false, teamSpaceBytes: 0, teamPlanId: 'free', teamPlanLabel: '基础版', teamPlanExpiresAt: null },
    }
    else if (url === '/api/account/upgrade-pricing') data = { source: 'remote', pricing: {} }
    else throw new Error('Unexpected fixture request: ' + url)
    return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } })
  }
  window.eval(code)
  for (let index = 0; index < 150; index++) {
    const card = window.document.querySelector('.workspace-team-card')
    if (card?.textContent.includes('团队套餐暂不可用')) return { dom, card, errors }
    await delay(10)
  }
  throw new Error(`Workspace team state did not render for ${role}; errors=${errors.map(error => error.message).join('; ')}`)
}

for (const role of ['member', 'owner']) {
  const fixture = await mount(role)
  try {
    const { card } = fixture
    assert.match(card.textContent, /套餐恢复后，所有成员会自动恢复访问|恢复团队套餐后，所有成员都可以继续使用团队空间/)
    if (role === 'member') {
      assert.ok(card.textContent.includes('联系团队所有者'))
      assert.ok(![...card.querySelectorAll('button')].some(button => button.textContent.includes('购买团队套餐')))
      console.log('PASS expired organization plan gives members a contact-owner recovery path')
    } else {
      assert.ok([...card.querySelectorAll('button')].some(button => button.textContent.includes('购买团队套餐')))
      console.log('PASS expired organization plan lets its owner restore the team package')
    }
    passed++
  } finally { fixture.dom.window.close() }
}
assert.equal(passed, 2)
console.log(`Team entitlement UI checks: ${passed}/${passed}`)
