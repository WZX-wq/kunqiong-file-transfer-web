import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import crypto from 'node:crypto'
import mysql from 'mysql2/promise'

// Only an explicitly selected loopback fixture. Never inherit .env or touch 3306.
process.env.KUNQIONG_DB_ENABLED = 'false'
process.env.KUNQIONG_DATA_KEY ||= 'ab'.repeat(32)
const { applyRelationalSchema } = await import('../../server/db/apply-relational-schema.js')
const { migratePaginationIndexes, PAGINATION_MIGRATION } = await import('../../server/db/pagination-indexes.js')

const port = Number(process.env.KUNQIONG_TEST_DB_PORT || 0)
// Same convention as the other scripts/db fixtures: local root without a
// password. An explicit env override keeps remote/CI fixtures possible.
const password = process.env.KUNQIONG_TEST_DB_PASSWORD ?? ''

async function createFixture(t) {
  const name = `kq_index_test_${crypto.randomBytes(6).toString('hex')}`
  assert.match(name, /^kq_index_test_[a-f0-9]+$/)
  const admin = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password })
  await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
  const pool = mysql.createPool({ host: '127.0.0.1', port, user: 'root', password, database: name, connectionLimit: 4, timezone: 'Z' })
  t.after(async () => {
    await pool.end()
    await admin.query(`DROP DATABASE IF EXISTS \`${name}\``)
    await admin.end()
  })
  const schemaSql = fs.readFileSync(new URL('../../docs/数据库设计-2026-10-29/03-现有功能关系表设计.sql', import.meta.url), 'utf8')
  await applyRelationalSchema({ pool, schemaSql })
  return pool
}

async function indexColumns(pool, table) {
  const [rows] = await pool.query(
    'SELECT INDEX_NAME AS name, SEQ_IN_INDEX AS seq, COLUMN_NAME AS column_name FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX',
    [table],
  )
  const indexes = new Map()
  for (const row of rows) {
    if (!indexes.has(row.name)) indexes.set(row.name, [])
    indexes.get(row.name)[Number(row.seq) - 1] = row.column_name
  }
  return indexes
}

const dateTime = offsetMs => new Date(Date.now() + offsetMs).toISOString().slice(0, 23).replace('T', ' ')

test('pagination migration adds the three composite indexes once and is idempotent', { skip: !port, timeout: 120000 }, async t => {
  const pool = await createFixture(t)
  const first = await migratePaginationIndexes(pool)
  assert.equal(first.alreadyApplied, false)
  assert.deepEqual(new Set(first.created), new Set(['idx_resource_owner_page', 'idx_records_scope_page', 'idx_messages_owner_page2']))
  assert.deepEqual(first.skipped, [])

  assert.deepEqual((await indexColumns(pool, 'kq_resource')).get('idx_resource_owner_page'),
    ['owner_user_id', 'resource_kind', 'status', 'deleted_at', 'gmt_create'])
  assert.deepEqual((await indexColumns(pool, 'kq_account_record')).get('idx_records_scope_page'),
    ['user_id', 'scope', 'id'])
  assert.deepEqual((await indexColumns(pool, 'kq_message')).get('idx_messages_owner_page2'),
    ['user_id', 'id'])

  const [[marker]] = await pool.query('SELECT checksum_sha256 FROM kq_schema_migration WHERE migration_key = ?', [PAGINATION_MIGRATION])
  assert.match(marker.checksum_sha256, /^[a-f0-9]{64}$/)

  const second = await migratePaginationIndexes(pool)
  assert.equal(second.alreadyApplied, true)
  // Re-running must not add duplicates: one (user_id, id) index on messages.
  const messageIndexes = [...(await indexColumns(pool, 'kq_message')).values()]
  assert.equal(messageIndexes.filter(columns => columns.slice(0, 2).join(',') === 'user_id,id').length, 1)
})

test('pagination migration skips idx_messages_owner_page2 when 006 already added (user_id, id)', { skip: !port, timeout: 120000 }, async t => {
  const pool = await createFixture(t)
  // Reproduce a deployed database that already ran 006-normalized-entities.
  await pool.query('ALTER TABLE kq_message ADD INDEX idx_messages_owner_page (user_id, id)')
  const result = await migratePaginationIndexes(pool)
  assert.equal(result.alreadyApplied, false)
  assert.deepEqual(new Set(result.created), new Set(['idx_resource_owner_page', 'idx_records_scope_page']))
  assert.deepEqual(result.skipped, ['idx_messages_owner_page2'])
  assert.equal((await indexColumns(pool, 'kq_message')).has('idx_messages_owner_page2'), false)
  const messageIndexes = [...(await indexColumns(pool, 'kq_message')).values()]
  assert.equal(messageIndexes.filter(columns => columns.slice(0, 2).join(',') === 'user_id,id').length, 1)
})

// Reproduce the three paginated statements from docs/PERFORMANCE-数据库压测报告.md.
const PAGE_QUERIES = [
  {
    name: '资源列表按 owner/kind/status 分页',
    sql: 'SELECT * FROM kq_resource WHERE owner_user_id = ? AND resource_kind = ? AND status = ? AND deleted_at IS NULL ORDER BY gmt_create DESC LIMIT 50',
    params: [7, 'share', 'active'],
    expectedIndex: 'idx_resource_owner_page',
  },
  {
    name: '收发记录游标分页',
    sql: 'SELECT * FROM kq_account_record WHERE user_id = ? AND scope = ? AND id < ? ORDER BY id DESC LIMIT 50',
    params: [7, 'my_sent', 99999999],
    expectedIndex: 'idx_records_scope_page',
  },
  {
    name: '站内消息游标分页',
    sql: 'SELECT id FROM kq_message WHERE user_id = ? AND id < ? ORDER BY id DESC LIMIT 50',
    params: [7, 99999999],
    expectedIndex: 'idx_messages_owner_page2',
  },
]

const explain = async (pool, query, { forceIndex = '' } = {}) => {
  const sql = forceIndex ? query.sql.replace(/(FROM `?\w+`?)(?= WHERE)/, `$1 FORCE INDEX (\`${forceIndex}\`)`) : query.sql
  const [rows] = await pool.query(`EXPLAIN ${sql}`, query.params)
  const plan = rows[0]
  return { name: query.name, key: plan.key, rows: plan.rows, type: plan.type, extra: plan.Extra }
}

async function seed(connection, users, perUser) {
  const resources = [], records = [], messages = []
  for (let index = 0; index < users * perUser; index++) {
    const owner = 1 + Math.floor(index / perUser)
    const createdAt = dateTime(-(index % perUser) * 60000)
    resources.push([`page-resource-${index}`, index % 2 ? 'collection' : 'share', owner,
      index % 3 === 0 ? 'closed' : 'active', index % 10 === 0 ? createdAt : null, createdAt, createdAt])
    records.push([`page-record-${index}`, owner, index % 2 ? 'my_sent' : 'my_received', '{}', createdAt, createdAt])
    messages.push([`page-message-${index}`, owner, 'system', `Message ${index}`, createdAt, createdAt])
  }
  const batches = (table, columns, rows) => rows.length && connection.query(
    `INSERT INTO \`${table}\` (${columns.join(', ')}) VALUES ${rows.map(() => `(${rows[0].map(() => '?').join(', ')})`).join(', ')}`,
    rows.flat(),
  )
  for (let offset = 0; offset < resources.length; offset += 500) {
    await batches('kq_resource', ['legacy_id', 'resource_kind', 'owner_user_id', 'status', 'deleted_at', 'gmt_create', 'gmt_modified'], resources.slice(offset, offset + 500))
    await batches('kq_account_record', ['legacy_id', 'user_id', 'scope', 'record_snapshot_json', 'gmt_create', 'gmt_modified'], records.slice(offset, offset + 500))
    await batches('kq_message', ['legacy_id', 'user_id', 'category', 'title', 'gmt_create', 'gmt_modified'], messages.slice(offset, offset + 500))
  }
}

test('three paginated queries lose Using filesort after the migration', { skip: !port, timeout: 180000 }, async t => {
  const pool = await createFixture(t)
  await seed(pool, 10, 500)
  for (const table of ['kq_resource', 'kq_account_record', 'kq_message']) await pool.query(`ANALYZE TABLE \`${table}\``)

  const before = []
  for (const query of PAGE_QUERIES) before.push(await explain(pool, query))
  t.diagnostic(`EXPLAIN before 007: ${JSON.stringify(before)}`)
  // The regression being fixed: the old composite indexes require a sort.
  assert.ok(before.some(plan => /Using filesort/.test(plan.extra || '')), JSON.stringify(before))

  const migration = await migratePaginationIndexes(pool)
  assert.equal(migration.alreadyApplied, false)
  for (const table of ['kq_resource', 'kq_account_record', 'kq_message']) await pool.query(`ANALYZE TABLE \`${table}\``)

  const after = []
  for (const query of PAGE_QUERIES) after.push(await explain(pool, query))
  t.diagnostic(`EXPLAIN after 007: ${JSON.stringify(after)}`)

  const forced = []
  for (const query of PAGE_QUERIES) forced.push(await explain(pool, query, { forceIndex: query.expectedIndex }))
  t.diagnostic(`EXPLAIN after 007 (FORCE INDEX control): ${JSON.stringify(forced)}`)

  // 资源列表：优化器已选新索引且无 filesort，属于 007 迁移的直接收益。
  assert.equal(/Using filesort/.test(after[0].extra || ''), false, `资源列表仍 filesort：${JSON.stringify(after[0])}`)
  assert.equal(after[0].key, PAGE_QUERIES[0].expectedIndex)
  // 记录/消息：MySQL 8.4 优化器在当前统计下仍可能选择旧索引（skip scan + filesort）。
  // 应用层分页通过 FORCE INDEX 固定 (user_id, id) 索引（server/db/request-store.js
  // 的 PAGE_INDEX_HINTS），这里用 FORCE INDEX 对照证明新索引本身已消除 filesort。
  for (const [index, plan] of forced.entries()) {
    assert.equal(/Using filesort/.test(plan.extra || ''), false, `${PAGE_QUERIES[index].name} FORCE INDEX 仍 filesort`)
    assert.equal(plan.key, PAGE_QUERIES[index].expectedIndex)
  }
  for (const plan of after.slice(1)) if (/Using filesort/.test(plan.extra || '')) t.diagnostic(`优化器未选固定索引：${plan.name || ''} key=${plan.key}（应用层已 FORCE INDEX）`)
})
