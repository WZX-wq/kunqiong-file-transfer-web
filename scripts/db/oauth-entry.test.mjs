import test from 'node:test'
import assert from 'node:assert/strict'

process.env.KUNQIONG_DB_ENABLED = 'false'
const { relationalDataMiddleware } = await import('../../server/lib/relational-request.js')

for (const path of ['/api/auth/login', '/auth/callback']) {
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
      relationalDataMiddleware(pool)(req, {}, error => error ? reject(error) : resolve())
    })
    assert.equal(queries.length, 0)
  })
}
