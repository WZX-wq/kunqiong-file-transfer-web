import assert from 'node:assert/strict'
import test from 'node:test'
import { readRowsById } from '../../server/db/paged-reader.js'

test('reads every row in ordered primary-key pages without duplicates', async () => {
  const source = Array.from({ length: 10 }, (_, index) => ({ id: String(index), value: `row-${index}` }))
  const calls = []
  const connection = {
    async query({ sql, timeout }, parameters = []) {
      assert.equal(timeout, 0)
      calls.push({ sql, parameters })
      const cursor = parameters.length ? BigInt(parameters[0]) : -1n
      const limit = Number(sql.match(/LIMIT (\d+)$/)?.[1])
      const rows = source.filter(row => BigInt(row.id) > cursor).slice(0, limit)
      return [rows, []]
    },
  }

  const rows = await readRowsById(connection, 'kq_account_record', ['user_id', 'record_snapshot_json'], 4)
  assert.deepEqual(rows, source)
  assert.equal(calls.length, 3)
  assert.match(calls[0].sql, /ORDER BY `id` LIMIT 4$/)
  assert.match(calls[1].sql, /WHERE `id` > \? ORDER BY `id` LIMIT 4$/)
  assert.deepEqual(calls[1].parameters, ['3'])
})

test('validates identifiers and page limits before building SQL', async () => {
  const connection = { async query() { throw new Error('query must not execute') } }
  await assert.rejects(readRowsById(connection, 'kq_bad;DROP', ['id']), /Invalid table name/)
  await assert.rejects(readRowsById(connection, 'kq_user', ['nickname;DROP']), /Invalid column list/)
  await assert.rejects(readRowsById(connection, 'kq_user', ['username'], 0), /between 1 and 1000/)
})

test('retries statement timeouts with smaller pages without losing or duplicating rows', async () => {
  const source = Array.from({ length: 7 }, (_, index) => ({ id: String(index), value: `row-${index}` }))
  const calls = []
  const connection = {
    async query({ sql }, parameters = []) {
      const cursor = parameters.length ? BigInt(parameters[0]) : -1n
      const limit = Number(sql.match(/LIMIT (\d+)$/)?.[1])
      calls.push({ cursor: cursor.toString(), limit })
      if (limit > 2) {
        const error = new Error('maximum statement execution time exceeded')
        error.code = 'ER_QUERY_TIMEOUT'
        throw error
      }
      return [source.filter(row => BigInt(row.id) > cursor).slice(0, limit), []]
    },
  }

  const rows = await readRowsById(connection, 'kq_user', '*', 8)

  assert.deepEqual(rows, source)
  assert.deepEqual(calls.slice(0, 3), [
    { cursor: '-1', limit: 8 },
    { cursor: '-1', limit: 4 },
    { cursor: '-1', limit: 2 },
  ])
  assert.deepEqual(calls.slice(3).map(call => call.limit), [2, 2, 2])
})

test('does not retry non-timeout database errors', async () => {
  let calls = 0
  const error = Object.assign(new Error('access denied'), { code: 'ER_ACCESS_DENIED_ERROR' })
  const connection = { async query() { calls += 1; throw error } }

  await assert.rejects(readRowsById(connection, 'kq_user', '*', 8), error)
  assert.equal(calls, 1)
})

test('reduces the page at the current cursor after a later statement times out', async () => {
  const source = Array.from({ length: 9 }, (_, index) => ({ id: String(index) }))
  const attempts = []
  const connection = {
    async query({ sql }, parameters = []) {
      const cursor = parameters.length ? BigInt(parameters[0]) : -1n
      const limit = Number(sql.match(/LIMIT (\d+)$/)?.[1])
      attempts.push([String(cursor), limit])
      if (cursor >= 3n && limit > 1) throw Object.assign(new Error('statement timeout'), { errno: 3024 })
      return [source.filter(row => BigInt(row.id) > cursor).slice(0, limit), []]
    },
  }
  assert.deepEqual(await readRowsById(connection, 'kq_user', '*', 4), source)
  assert.deepEqual(attempts.slice(0, 4), [['-1', 4], ['3', 4], ['3', 2], ['3', 1]])
})

test('stops retrying a server timeout when a single row still times out', async () => {
  let calls = 0
  const error = Object.assign(new Error('statement timeout'), { code: 'ER_STATEMENT_TIMEOUT' })
  const connection = { async query() { calls += 1; throw error } }
  await assert.rejects(readRowsById(connection, 'kq_user', '*', 4), error)
  assert.equal(calls, 3)
})

test('destroys a timed-out client connection without retrying its transaction', async () => {
  let calls = 0
  let destroyed = false
  const error = Object.assign(new Error('inactivity timeout'), { code: 'PROTOCOL_SEQUENCE_TIMEOUT' })
  const connection = {
    async query() { calls += 1; throw error },
    destroy() { destroyed = true },
  }
  await assert.rejects(readRowsById(connection, 'kq_user', '*', 4), error)
  assert.equal(calls, 1)
  assert.equal(destroyed, true)
})
