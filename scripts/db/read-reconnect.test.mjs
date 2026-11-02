import test from 'node:test'
import assert from 'node:assert/strict'
import { boundedPool } from '../../server/db/bounded-pool.js'

test('raising the total budget does not postpone recovery of a stalled read', async () => {
  let timeout
  const pool = boundedPool({ async getConnection() { return {
    async query(options) { timeout = options.timeout; return [[]] }, release() {},
  } } }, { queryTimeoutMs: 60000 })
  await pool.query('SELECT * FROM kq_message WHERE id = ?', [1])
  assert.equal(timeout, 5000)
})

test('a leased connection can recover a failed handshake before any SQL is sent', async () => {
  let calls = 0, queries = 0
  const raw = { query() { queries++; return [[], []] }, release() {} }
  const pool = boundedPool({ async getConnection() {
    calls++
    if (calls === 1) throw Object.assign(new Error('handshake stalled'), { code: 'ETIMEDOUT' })
    return raw
  } })
  const connection = await pool.getConnection()
  assert.equal(calls, 2)
  assert.equal(queries, 0)
  await connection.query('UPDATE kq_user SET nickname = ?', ['verified'])
  assert.equal(queries, 1)
  connection.release()
})

test('failed handshake recovery is bounded and authentication errors do not retry', async () => {
  for (const [code, expected] of [['ETIMEDOUT', 2], ['ER_ACCESS_DENIED_ERROR', 1]]) {
    let calls = 0
    const pool = boundedPool({ async getConnection() { calls++; throw Object.assign(new Error('fixture'), { code }) } })
    await assert.rejects(pool.getConnection(), { code })
    assert.equal(calls, expected)
  }
})

for (const method of ['query', 'execute']) {
  test(`${method} reconnects a lost read without changing its parameters`, async () => {
    let acquired = 0, destroyed = 0, released = 0
    const pool = boundedPool({ async getConnection() {
      const attempt = ++acquired
      return { async [method](options, params) {
        assert.equal(options.sql, 'SELECT * FROM `kq_user` WHERE legacy_id = ?')
        assert.deepEqual(params, ['alice'])
        if (attempt === 1) throw Object.assign(new Error('lost'), { code: 'ECONNRESET' })
        return [[{ id: 1 }]]
      }, destroy() { destroyed++ }, release() { released++ } }
    } })
    assert.deepEqual(await pool[method]('SELECT * FROM `kq_user` WHERE legacy_id = ?', ['alice']), [[{ id: 1 }]])
    assert.equal(acquired, 2)
    assert.equal(destroyed, 1)
    assert.equal(released, 2)
  })
}

test('two stalled reads share one configured query deadline', async () => {
  const timeouts = []
  const destroyed = new Set()
  let acquired = 0
  const pool = boundedPool({ async getConnection() {
    const id = ++acquired
    return { query(options) { timeouts.push(options.timeout); return new Promise(() => {}) },
      destroy() { destroyed.add(id) }, release() {} }
  } }, { queryTimeoutMs: 90 })
  await assert.rejects(pool.query('SELECT * FROM kq_user WHERE id = ?', [1]), { code: 'DATABASE_QUERY_TIMEOUT' })
  assert.equal(timeouts.length, 2)
  assert.ok(timeouts[0] + timeouts[1] <= 90)
  assert.equal(destroyed.size, 2)
})

test('writes, locking reads and leased transaction reads are never replayed', async () => {
  for (const sql of ['UPDATE kq_user SET nickname = ?', 'SELECT * FROM kq_user FOR UPDATE',
    'SELECT GET_LOCK(?, 1) FROM kq_user', 'SELECT * FROM kq_user; DELETE FROM kq_user']) {
    let calls = 0
    const pool = boundedPool({ async getConnection() {
      return { async query() { calls++; throw Object.assign(new Error('lost'), { code: 'ECONNRESET' }) }, release() {} }
    } })
    await assert.rejects(pool.query(sql), { code: 'ECONNRESET' })
    assert.equal(calls, 1)
  }
  let calls = 0
  const pool = boundedPool({ async getConnection() { return {
    async query() { calls++; throw Object.assign(new Error('lost'), { code: 'ECONNRESET' }) }, release() {},
  } } })
  const transaction = await pool.getConnection()
  await assert.rejects(transaction.query('SELECT * FROM kq_user WHERE id = ?', [1]), { code: 'ECONNRESET' })
  assert.equal(calls, 1)
})
