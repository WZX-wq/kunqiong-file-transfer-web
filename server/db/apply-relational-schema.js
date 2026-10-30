import crypto from 'node:crypto'
import { assertTableMatches, makeIdempotentCreateStatement, inspectRelationalSchemaSql } from './relational-schema.js'

const MIGRATION_KEY = '001-existing-features-relational-schema'
const LOCK_NAME = 'kunqiong-relational-schema-v1'

async function ensureMigrationTable(connection) {
  await connection.query(`CREATE TABLE IF NOT EXISTS \`kq_schema_migration\` (
    \`migration_key\` VARCHAR(120) COLLATE utf8mb4_bin NOT NULL,
    \`checksum_sha256\` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    \`applied_at\` DATETIME(3) NOT NULL,
    PRIMARY KEY (\`migration_key\`),
    KEY \`idx_schema_migration_applied_at\` (\`applied_at\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='数据库结构升级记录'`)
  await assertTableIsCurrent(connection, {
    name: 'kq_schema_migration',
    columns: ['migration_key', 'checksum_sha256', 'applied_at'],
    columnTypes: { migration_key: 'varchar(120)', checksum_sha256: 'char(64)', applied_at: 'datetime(3)' },
    indexes: ['PRIMARY', 'idx_schema_migration_applied_at'],
  })
}

async function assertTableIsCurrent(connection, table, { allowMissing = false } = {}) {
  const [columns] = await connection.execute(
    'SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    [table.name],
  )
  if (allowMissing && columns.length === 0) return false
  const [indexes] = await connection.execute(
    'SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    [table.name],
  )
  const [tableRows] = await connection.execute(
    'SELECT ENGINE, TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1',
    [table.name],
  )
  assertTableMatches(columns, indexes, table, tableRows?.[0])
  return true
}

// Read-only gate: reject incompatible existing tables before stopping the old
// service. Missing tables are created by the normal locked startup migration.
export async function inspectExistingRelationalSchema({ connection, schemaSql }) {
  let existingTableCount = 0
  for (const table of inspectRelationalSchemaSql(schemaSql)) {
    if (await assertTableIsCurrent(connection, table, { allowMissing: true })) existingTableCount += 1
  }
  return { existingTableCount }
}

export async function applyRelationalSchema({ pool, schemaSql }) {
  const tables = inspectRelationalSchemaSql(schemaSql)
  const checksum = crypto.createHash('sha256').update(schemaSql).digest('hex')
  const connection = await pool.getConnection()
  let locked = false

  try {
    const [lockRows] = await connection.execute('SELECT GET_LOCK(?, 30) AS acquired', [LOCK_NAME])
    if (Number(lockRows?.[0]?.acquired) !== 1) throw new Error('Could not acquire the database schema migration lock')
    locked = true
    await ensureMigrationTable(connection)

    const [appliedRows] = await connection.execute(
      'SELECT checksum_sha256 FROM kq_schema_migration WHERE migration_key = ? LIMIT 1',
      [MIGRATION_KEY],
    )
    const appliedChecksum = appliedRows?.[0]?.checksum_sha256
    if (appliedChecksum && appliedChecksum !== checksum) {
      throw new Error(`Migration ${MIGRATION_KEY} was already applied with a different checksum; add a new migration instead of editing the applied schema`)
    }

    if (!appliedChecksum) {
      for (const table of tables) {
        await connection.query(makeIdempotentCreateStatement(table.statement))
        await assertTableIsCurrent(connection, table)
      }
      await connection.execute(
        'INSERT INTO kq_schema_migration (migration_key, checksum_sha256, applied_at) VALUES (?, ?, UTC_TIMESTAMP(3))',
        [MIGRATION_KEY, checksum],
      )
    } else {
      for (const table of tables) await assertTableIsCurrent(connection, table)
    }

    return { migrationKey: MIGRATION_KEY, tableCount: tables.length, checksum, alreadyApplied: Boolean(appliedChecksum) }
  } finally {
    if (locked) {
      try { await connection.execute('SELECT RELEASE_LOCK(?)', [LOCK_NAME]) } catch {}
    }
    connection.release()
  }
}
