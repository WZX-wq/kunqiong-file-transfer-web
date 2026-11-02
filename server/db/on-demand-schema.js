import crypto from 'node:crypto'
import { decodeProtected, readRelationalState } from './relational-store.js'
import { keyedDigest } from '../lib/private-key.js'
import { CLEANUP_SCHEMA } from './cleanup-outbox.js'

const STATEMENTS = [`CREATE TABLE IF NOT EXISTS kq_resource_usage (
  resource_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  live_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  live_file_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  live_resource_count TINYINT UNSIGNED NOT NULL DEFAULT 1,
  owner_guest_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  KEY idx_usage_guest (owner_guest_digest)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
`CREATE TABLE IF NOT EXISTS kq_upload_publication (
  session_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  resource_id BIGINT UNSIGNED NOT NULL,
  KEY idx_upload_publication_resource (resource_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`]
const MIGRATION = '005-on-demand-resource-usage'

export function liveResourceUsage(resource, kind) {
  if (resource.cleanedAt) return { bytes: 0, fileCount: 0, resourceCount: 0 }
  const files = kind === 'collection' ? (resource.submissions || []).flatMap(item => item.files || []) : resource.files || []
  return { bytes: files.reduce((sum, file) => sum + Number(file.size || 0), 0), fileCount: files.length, resourceCount: 1 }
}

export async function writeResourceUsage(connection, id, value, kind) {
  const usage = liveResourceUsage(value, kind)
  await connection.execute(`INSERT INTO kq_resource_usage (resource_id, live_bytes, live_file_count, live_resource_count, owner_guest_digest)
    VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE live_bytes = VALUES(live_bytes),
      live_file_count = VALUES(live_file_count), live_resource_count = VALUES(live_resource_count),
      owner_guest_digest = VALUES(owner_guest_digest)`, [id, usage.bytes, usage.fileCount, usage.resourceCount,
    value.ownerGuestKey ? keyedDigest(`guest-usage:${value.ownerGuestKey}`) : null])
  await connection.execute('DELETE FROM kq_upload_publication WHERE resource_id = ?', [id])
  const sessionIds = kind === 'collection' ? (value.submissions || []).map(item => item.uploadSessionId) : [value.uploadSessionId]
  for (const sessionId of sessionIds.filter(Boolean)) {
    await connection.execute('INSERT INTO kq_upload_publication (session_digest, resource_id) VALUES (?, ?)', [keyedDigest(`upload-session:${sessionId}`), id])
  }
}

// Explicit deployment/migration command only. Serving HTTP never calls this
// backfill, nor reads metadata.json or the legacy whole-database JSON row.
async function migrateUsageSchema(pool) {
  const connection = await pool.getConnection()
  let locked = false
  try {
    await connection.query(CLEANUP_SCHEMA)
    const [locks] = await connection.execute('SELECT GET_LOCK(?, 30) AS acquired', [MIGRATION])
    if (Number(locks[0]?.acquired) !== 1) throw new Error('Cannot acquire on-demand migration lock')
    locked = true
    const checksum = crypto.createHash('sha256').update(STATEMENTS.join('\n')).digest('hex')
    const [applied] = await connection.execute('SELECT checksum_sha256 FROM kq_schema_migration WHERE migration_key = ?', [MIGRATION])
    if (applied.length) {
      if (applied[0].checksum_sha256 !== checksum) throw new Error('On-demand migration checksum mismatch')
      return { alreadyApplied: true }
    }
    for (const statement of STATEMENTS) await connection.query(statement)
    if (!await readRelationalState(connection)) throw new Error('Run the explicit legacy-to-relational migration first')
    let cursor = 0, resources = 0
    while (true) {
      const [rows] = await connection.query('SELECT id, legacy_id, resource_kind, entity_payload_json FROM kq_resource WHERE id > ? ORDER BY id LIMIT 50', [cursor])
      if (!rows.length) break
      await connection.beginTransaction()
      for (const row of rows) {
        const value = decodeProtected(row.entity_payload_json, `resource:${row.resource_kind}:${row.legacy_id}`)
        await writeResourceUsage(connection, row.id, value, row.resource_kind)
      }
      await connection.commit()
      cursor = rows.at(-1).id
      resources += rows.length
    }
    await connection.beginTransaction()
    await connection.execute('INSERT INTO kq_schema_migration (migration_key, checksum_sha256, applied_at) VALUES (?, ?, UTC_TIMESTAMP(3))', [MIGRATION, checksum])
    await connection.commit()
    return { alreadyApplied: false, resources }
  } catch (error) { await connection.rollback().catch(() => {}); throw error }
  finally {
    if (locked) await connection.execute('SELECT RELEASE_LOCK(?)', [MIGRATION]).catch(() => {})
    connection.release()
  }
}

export async function migrateOnDemandSchema(pool) {
  const usage = await migrateUsageSchema(pool)
  const { migrateNormalizedSchema } = await import('./normalized-schema.js')
  const normalized = await migrateNormalizedSchema(pool)
  // Runs after 006 so the normalized columns/indexes exist; only adds the
  // pagination indexes that remain missing.
  const { migratePaginationIndexes } = await import('./pagination-indexes.js')
  const pagination = await migratePaginationIndexes(pool)
  return { ...usage, normalized, pagination }
}
