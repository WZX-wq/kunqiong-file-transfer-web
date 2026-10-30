import test from 'node:test'
import assert from 'node:assert/strict'
import { readRelationalAuthSessionState } from '../server/lib/relational-auth-session.js'

test('relational session expiry is compared in UTC, independent of MySQL session timezone', async () => {
  let query = ''
  let values = []
  const pool = {
    async execute(sql, params) {
      query = sql
      values = params
      return [[{ is_unexpired: 1, is_revoked: 0 }]]
    },
  }

  const state = await readRelationalAuthSessionState(pool, 'token-digest')

  assert.match(query, /expires_at\s*>\s*UTC_TIMESTAMP\(3\)/)
  assert.match(query, /revoked_at\s+IS\s+NOT\s+NULL/)
  assert.doesNotMatch(query, /\bNOW\(/)
  assert.deepEqual(values, ['token-digest'])
  assert.deepEqual(state, { expired: false, revoked: false })
})

test('relational session lookup distinguishes missing, expired and revoked rows', async () => {
  const pool = {
    async execute(_sql, [tokenHash]) {
      if (tokenHash === 'missing') return [[]]
      if (tokenHash === 'expired') return [[{ is_unexpired: 0, is_revoked: 0 }]]
      return [[{ is_unexpired: 1, is_revoked: 1 }]]
    },
  }

  assert.equal(await readRelationalAuthSessionState(pool, 'missing'), null)
  assert.deepEqual(await readRelationalAuthSessionState(pool, 'expired'), { expired: true, revoked: false })
  assert.deepEqual(await readRelationalAuthSessionState(pool, 'revoked'), { expired: false, revoked: true })
})
