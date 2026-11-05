import assert from 'node:assert/strict'
import test from 'node:test'

process.env.KUNQIONG_DB_ENABLED = 'false'
const { runWithDataContext } = await import('../server/lib/data-context.js')
const { publicOrganizationMember } = await import('../server/services/account.js')
const { normalizeMetadata } = await import('../server/lib/metadata-normalizers.js')

function fixture(task) {
  const member = { id: 'm-member', userId: 'member', displayName: '成员昵称', role: 'member', status: 'active', email: 'old@example.test', phone: '13800000000' }
  const organization = { id: 'org', slug: 'org', name: '团队', ownerUserId: 'owner', teamPlanId: 'enterprise',
    teamPlanStartedAt: new Date().toISOString(), teamPlanExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    members: [{ id: 'm-owner', userId: 'owner', role: 'owner', status: 'active' }, member] }
  const data = normalizeMetadata({ users: {
    owner: { id: 'owner', username: 'owner-login', planId: 'enterprise', status: 'active' },
    member: { id: 'member', username: 'member-login', nickname: '成员昵称', email: 'new@example.test', phone: '13900001111', status: 'active' },
  }, organizations: { org: organization } })
  return runWithDataContext({ data }, () => task(data.organizations.org, data.organizations.org.members.find(item => item.userId === 'member'), data))
}

test('team owner sees current bound contacts and username instead of the stale roster snapshot', () => fixture((org, member) => {
  const result = publicOrganizationMember(org, member, 'owner')
  assert.equal(result.email, 'new@example.test')
  assert.equal(result.phone, '13900001111')
  assert.equal(result.username, 'member-login')
}))

test('self lookup uses the current account email even when the roster has another email', () => fixture((org, member) => {
  assert.equal(publicOrganizationMember(org, member, 'member').email, 'new@example.test')
}))

test('other members receive masked current contacts', () => fixture((org, member) => {
  const result = publicOrganizationMember(org, member, 'peer')
  assert.equal(result.email, 'n***@example.test')
  assert.equal(result.phone, '139****1111')
}))

test('cleared contacts never resurrect the old membership email or phone', () => fixture((org, member, data) => {
  data.users.member.email = ''
  data.users.member.phone = ''
  const result = publicOrganizationMember(org, member, 'owner')
  assert.equal(result.email, '')
  assert.equal(result.phone, '')
}))

test('historical membership without an account retains its snapshot contacts', () => fixture((org, member, data) => {
  delete data.users.member
  const result = publicOrganizationMember(org, member, 'owner')
  assert.equal(result.email, 'old@example.test')
  assert.equal(result.phone, '13800000000')
}))
