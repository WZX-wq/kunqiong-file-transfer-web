import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
process.env.KUNQIONG_DB_ENABLED = 'false'
process.env.KUNQIONG_DATA_KEY = 'ab'.repeat(32)
const { issueExistingAuthSession } = await import('../server/db/auth-session.js')
const { oauthProgressScript } = await import('../server/lib/oauth-callback.js')
const session = { id: 'private-fixture', user: { id: 'alice' }, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString() }

for (const committed of [true, false]) test(`lost COMMIT is read back and never replayed: committed=${committed}`, async () => {
  let commits = 0, acquisitions = 0, destroyed = 0, confirmations = 0
  const pool = {
    async getConnection() {
      acquisitions++
      return { async beginTransaction() {}, async execute() {}, async query(sql) { return /SELECT id, status/.test(sql) ? [[{ id: 1, status: 'active' }]] : [{}] },
        async commit() { commits++; throw Object.assign(Error('lost'), { code: 'ECONNRESET' }) }, destroy() { destroyed++ }, release() {} }
    },
    async query(sql, params) { confirmations++; assert.match(sql, /token_hash = \?/); assert.match(params[0], /^[a-f0-9]{64}$/); return [committed ? [{ id: 1 }] : []] },
  }
  if (committed) assert.equal(await issueExistingAuthSession(pool, 'alice', session), true)
  else await assert.rejects(issueExistingAuthSession(pool, 'alice', session), { code: 'ECONNRESET' })
  assert.deepEqual({ commits, acquisitions, destroyed, confirmations }, { commits: 1, acquisitions: 1, destroyed: 1, confirmations: 1 })
})

test('progress polling waits for each response and navigates only once after readiness', async () => {
  const timers = [], locations = [], requests = []
  const context = vm.createContext({ URLSearchParams, AbortSignal, encodeURIComponent,
    location: { search: '?state=bound-state', replace: value => locations.push(value) },
    setTimeout: fn => timers.push(fn),
    fetch: (url, options) => new Promise(resolve => requests.push({ url, options, resolve })),
  })
  vm.runInContext(oauthProgressScript, context)
  assert.equal(requests.length, 1); assert.equal(timers.length, 0)
  requests[0].resolve({ status: 200, json: async () => ({ ready: false }) })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(locations.length, 0); assert.equal(timers.length, 1)
  timers.shift()()
  assert.equal(requests.length, 2)
  requests[1].resolve({ status: 200, json: async () => ({ ready: true }) })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(locations, ['/auth/pending?state=bound-state'])
  assert.equal(timers.length, 0)
})
