import test from 'node:test'
import assert from 'node:assert/strict'
import { readVersionedRows } from '../../server/db/versioned-read-cache.js'

test('warm reads verify MySQL versions and reload changed or removed rows', async () => {
  let row = { id: 1, write_version: 1, gmt_modified: '2026-11-02', status: 'active', entity_payload_json: 'large-profile' }
  let fullReads = 0, probes = 0
  const pool = { async query(sql) {
    if (sql.startsWith('SELECT id,')) { probes++; return [row ? [{ id: row.id, write_version: row.write_version, gmt_modified: row.gmt_modified }] : []] }
    fullReads++; return [[structuredClone(row)]]
  } }
  const read = () => readVersionedRows(pool, 'kq_user', 'id = ?', [1])
  const first = await read()
  first[0].status = 'caller-modified'
  assert.equal((await read())[0].status, 'active')
  assert.equal(fullReads, 1)
  row = { ...row, status: 'disabled', write_version: 2 }
  assert.equal((await read())[0].status, 'disabled')
  assert.equal(fullReads, 2)
  row = null
  assert.deepEqual(await read(), [])
  assert.equal(probes, 4)
  pool.query = async () => { throw Object.assign(new Error('outage'), { code: 'DATABASE_QUERY_TIMEOUT' }) }
  await assert.rejects(read(), { code: 'DATABASE_QUERY_TIMEOUT' })
})

test('database predicates and request limits remain authoritative', async () => {
  const queries = []
  const pool = { async query(sql, params) {
    queries.push({ sql, params })
    return sql.startsWith('SELECT id,') ? [[{ id: 7, write_version: 1, gmt_modified: 'today' }]]
      : [[{ id: 7, write_version: 1, gmt_modified: 'today', legacy_id: 'alice' }]]
  } }
  await readVersionedRows(pool, 'kq_user', 'email = ?', ['alice@example.test'], ' ORDER BY id DESC LIMIT 2')
  assert.match(queries[0].sql, /WHERE email = \? ORDER BY id DESC LIMIT 2$/)
  assert.match(queries[1].sql, /WHERE \(email = \?\) AND id = \?$/)
  assert.deepEqual(queries[1].params, ['alice@example.test', 7])
})
