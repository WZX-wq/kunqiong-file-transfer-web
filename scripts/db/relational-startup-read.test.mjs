import assert from 'node:assert/strict'
import test from 'node:test'

process.env.KUNQIONG_DATA_KEY = 'ab'.repeat(32)
const { buildRelationalModel, countRelationalModelRows, loadRelationalMetadata } = await import('../../server/db/relational-store.js')
const { protectCredential } = await import('../../server/lib/private-key.js')

function fixture(mismatchedCount = false) {
  const users = { u1: { id: 'u1', avatar: 'a'.repeat(40_000) }, u2: { id: 'u2', nickname: 'second' } }
  const source = { users, systemConfig: { maxBatchFiles: 12 } }
  const counts = countRelationalModelRows(source)
  const tables = new Map(Object.keys(counts).map(table => [table, []]))
  tables.set('kq_user', Object.values(users).map((user, index) => ({
    id: index + 1, legacy_id: user.id,
    entity_payload_json: JSON.stringify(protectCredential(JSON.stringify(user), `relational:user:${user.id}`)),
  })))
  tables.set('kq_system_setting', buildRelationalModel(source).systemSettings.map((entry, index) => ({
    id: index + 1, setting_key: entry.key, setting_value_json: structuredClone(entry.value),
  })))
  if (mismatchedCount) counts.kq_user += 1
  const calls = []
  const lifecycle = []
  const connection = {
    async beginTransaction() { lifecycle.push('begin') },
    async commit() { lifecycle.push('commit') },
    async rollback() { lifecycle.push('rollback') },
    release() { lifecycle.push('release') },
    async query(options, parameters = []) {
      const sql = typeof options === 'string' ? options : options.sql
      if (sql.includes('FROM kq_relational_store_state')) return [[{
        revision: 7, schema_version: 1, source_snapshot_revision: 3, record_counts_json: JSON.stringify(counts),
      }], []]
      assert.ok(!sql.includes('COUNT('), 'validated startup rows must not be counted or fetched again')
      const table = sql.match(/FROM `([a-z_]+)`/)?.[1]
      assert.ok(tables.has(table), `unexpected startup query: ${sql}`)
      calls.push(table)
      const limit = Number(sql.match(/LIMIT (\d+)$/)[1])
      const cursor = parameters[0] || 0
      return [tables.get(table).filter(row => row.id > cursor).slice(0, limit), []]
    },
  }
  return { users, tables, calls, lifecycle, pool: { async getConnection() { return connection } } }
}

test('startup decodes the validated snapshot without rereading any table', async () => {
  const f = fixture()
  const loaded = await loadRelationalMetadata(f.pool)
  assert.deepEqual(loaded.metadata.users, f.users)
  assert.deepEqual(loaded.metadata.systemConfig, { maxBatchFiles: 12 })
  assert.equal(loaded.revision, 7)
  assert.equal(f.calls.filter(table => table === 'kq_user').length, 3)
  assert.equal(f.calls.filter(table => table === 'kq_system_setting').length, 1)
  assert.deepEqual(f.lifecycle, ['begin', 'commit', 'release'])
  loaded.metadata.systemConfig.maxBatchFiles = 99
  const persistedConfig = f.tables.get('kq_system_setting').find(row => row.setting_key === 'systemConfig')
  assert.equal(persistedConfig.setting_value_json.maxBatchFiles, 12, 'mutable metadata must not mutate its database comparison cache')
})

test('startup rejects an incomplete snapshot and rolls back before publishing it', async () => {
  const f = fixture(true)
  await assert.rejects(loadRelationalMetadata(f.pool), /kq_user.*行数/)
  assert.deepEqual(f.lifecycle, ['begin', 'rollback', 'release'])
})
