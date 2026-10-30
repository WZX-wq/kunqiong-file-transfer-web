import assert from 'node:assert/strict'
import test from 'node:test'
import { readRowsById } from '../../server/db/paged-reader.js'

test('reads every row in ordered primary-key pages without duplicates', async () => {
  const source = Array.from({ length: 10 }, (_, index) => ({ id: String(index), value: `row-${index}` }))
  const calls = []
  const connection = {
    async execute(sql, parameters = []) {
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
  const connection = { async execute() { throw new Error('query must not execute') } }
  await assert.rejects(readRowsById(connection, 'kq_bad;DROP', ['id']), /Invalid table name/)
  await assert.rejects(readRowsById(connection, 'kq_user', ['nickname;DROP']), /Invalid column list/)
  await assert.rejects(readRowsById(connection, 'kq_user', ['username'], 0), /between 1 and 1000/)
})
