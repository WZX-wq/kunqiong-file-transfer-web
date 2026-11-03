import test from 'node:test'
import assert from 'node:assert/strict'

process.env.KUNQIONG_DB_ENABLED = 'false'
const { relationalDataMiddleware } = await import('../../server/lib/relational-request.js')

for (const path of ['/api/auth/login', '/auth/callback', '/auth/pending', '/auth/progress.js', '/api/auth/progress']) {
  test(`${path} does not depend on an existing session or unrelated business tables`, async () => {
    const queries = []
    const pool = { async query(sql) {
      queries.push(sql)
      assert.match(sql, /FROM `kq_system_setting`/)
      return [[]]
    } }
    const req = { path, method: 'GET', query: {}, body: {},
      get: name => name === 'cookie' ? 'kunqiong_session=unreadable-old-session' : '' }
    await new Promise((resolve, reject) => {
      relationalDataMiddleware(pool)(req, { once() {} }, error => error ? reject(error) : resolve())
    })
    assert.equal(queries.length, 0)
  })
}

test('identity can use its reserved pool while the business pool is unavailable', async () => {
  let queries = 0
  const businessPool = { query() { assert.fail('business pool must not serve authentication') } }
  const authPool = { async query(sql) { queries++; assert.match(sql.sql, /JOIN kq_user/); return [[]] } }
  const req = { path: '/api/auth/me', method: 'GET', query: {}, body: {}, get: name => ({ cookie: 'kunqiong_session=token', 'X-Kunqiong-Auth-View': 'identity' })[name] || '' }
  await new Promise((resolve, reject) => relationalDataMiddleware(businessPool, authPool)(req, { once() {} }, error => error ? reject(error) : resolve()))
  assert.equal(queries, 1)
  assert.equal(req.dataContext.followupPool, businessPool)
})
