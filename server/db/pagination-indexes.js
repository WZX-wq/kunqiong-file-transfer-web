import crypto from 'node:crypto'

// 007: composite indexes that let the three cursor-paginated list queries run as
// ordered index scans instead of "Using filesort". Regression evidence:
// docs/PERFORMANCE-数据库压测报告.md records filesort for all three queries.
//
// Do not fold these into migration 001/006: those checksums are already applied
// in deployed databases, so a new migration key is required.
export const PAGINATION_MIGRATION = '007-pagination-indexes'

const TABLE = { resource: 'kq_resource', record: 'kq_account_record', message: 'kq_message' }

const INDEXES = [
  {
    table: TABLE.resource,
    name: 'idx_resource_owner_page',
    columns: ['owner_user_id', 'resource_kind', 'status', 'deleted_at', 'gmt_create'],
    // WHERE owner_user_id = ? AND resource_kind = ? AND status = ? AND deleted_at IS NULL
    // ORDER BY gmt_create DESC
  },
  {
    table: TABLE.record,
    name: 'idx_records_scope_page',
    columns: ['user_id', 'scope', 'id'],
    // WHERE user_id = ? AND scope = ? AND id < ? ORDER BY id DESC
  },
  {
    table: TABLE.message,
    name: 'idx_messages_owner_page2',
    columns: ['user_id', 'id'],
    // WHERE user_id = ? AND id < ? ORDER BY id DESC
    // 006 already adds idx_messages_owner_page(user_id, id); when an equivalent
    // leading (user_id, id) index exists this entry is skipped, never duplicated.
    skipWhenColumnsExist: ['user_id', 'id'],
  },
]

const DDL = INDEXES.map(({ table, name, columns }) => `ALTER TABLE \`${table}\` ADD INDEX \`${name}\` (${columns.join(', ')})`)
const CHECKSUM = crypto.createHash('sha256').update(JSON.stringify({ version: 1, migration: PAGINATION_MIGRATION, ddl: DDL })).digest('hex')

async function indexNames(connection, table) {
  const [rows] = await connection.execute(
    'SELECT INDEX_NAME AS name, SEQ_IN_INDEX AS seq, COLUMN_NAME AS column_name FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX',
    [table],
  )
  const indexes = new Map()
  for (const row of rows) {
    const name = String(row.name)
    if (!indexes.has(name)) indexes.set(name, [])
    indexes.get(name)[Number(row.seq) - 1] = String(row.column_name)
  }
  return indexes
}

async function tableExists(connection, table) {
  const [rows] = await connection.execute(
    'SELECT COUNT(*) AS found FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    [table],
  )
  return Number(rows?.[0]?.found) > 0
}

export async function migratePaginationIndexes(pool) {
  const connection = await pool.getConnection()
  let locked = false
  try {
    const [locks] = await connection.execute('SELECT GET_LOCK(?, 30) AS acquired', [PAGINATION_MIGRATION])
    if (Number(locks[0]?.acquired) !== 1) throw new Error('Cannot acquire pagination index migration lock')
    locked = true
    const [applied] = await connection.execute('SELECT checksum_sha256 FROM kq_schema_migration WHERE migration_key = ?', [PAGINATION_MIGRATION])
    if (applied.length) {
      if (applied[0].checksum_sha256 !== CHECKSUM) throw new Error('Pagination index migration checksum mismatch')
      return { alreadyApplied: true }
    }
    const created = []
    const skipped = []
    for (const index of INDEXES) {
      if (!await tableExists(connection, index.table)) {
        // A partial schema must not silently record the migration as applied.
        throw new Error(`Cannot add pagination index ${index.name}: table ${index.table} is missing`)
      }
      const indexes = await indexNames(connection, index.table)
      if (indexes.has(index.name)) { skipped.push(index.name); continue }
      if (index.skipWhenColumnsExist) {
        const wanted = index.skipWhenColumnsExist.join(',')
        const equivalent = [...indexes.values()].some(columns => columns.slice(0, index.skipWhenColumnsExist.length).join(',') === wanted)
        if (equivalent) { skipped.push(index.name); continue }
      }
      await connection.query(`ALTER TABLE \`${index.table}\` ADD INDEX \`${index.name}\` (${index.columns.join(', ')})`)
      created.push(index.name)
    }
    await connection.beginTransaction()
    await connection.execute(
      'INSERT INTO kq_schema_migration (migration_key, checksum_sha256, applied_at) VALUES (?, ?, UTC_TIMESTAMP(3))',
      [PAGINATION_MIGRATION, CHECKSUM],
    )
    await connection.commit()
    return { alreadyApplied: false, created, skipped, checksum: CHECKSUM }
  } catch (error) {
    await connection.rollback().catch(() => {})
    throw error
  } finally {
    if (locked) await connection.execute('SELECT RELEASE_LOCK(?)', [PAGINATION_MIGRATION]).catch(() => {})
    connection.release()
  }
}
