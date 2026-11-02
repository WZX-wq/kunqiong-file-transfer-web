import crypto from 'node:crypto'
import { EXTRA_PAYLOAD_TABLES } from './normalized-codec.js'
import { CLEANUP_SCHEMA } from './cleanup-outbox.js'
import { WRITE_LOCK_SCHEMA } from './write-locks.js'
import { decodeProtected } from './relational-store.js'

const ROOTS = ['kq_user', 'kq_organization', 'kq_resource', 'kq_distribution_batch', 'kq_auth_session', 'kq_verification_code', 'kq_upgrade_order', 'kq_message', 'kq_user_setting', 'kq_account_record', 'kq_guest_usage', 'kq_system_setting']
const MIGRATION = '006-normalized-entities-and-cleanup'
const COLUMNS = [
  ...EXTRA_PAYLOAD_TABLES.map(table => [table, 'entity_payload_json', 'JSON NULL']),
  ...ROOTS.map(table => [table, 'write_version', 'BIGINT UNSIGNED NOT NULL DEFAULT 0']),
  ['kq_resource_file', 'path_digest', 'CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL'],
  ['kq_resource_file', 'disk_key_digest', 'CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL'],
]
const INDEXES = [
  ['kq_resource_file', 'idx_file_path', 'path_digest, resource_id'],
  ['kq_resource_file', 'idx_file_disk_key', 'disk_key_digest'],
  ['kq_account_record', 'idx_records_owner_page', 'user_id, id'],
  ['kq_message', 'idx_messages_owner_page', 'user_id, id'],
  ['kq_resource', 'idx_resources_team_page', 'organization_id, team_resource, deleted_at, id'],
  ['kq_audit_log', 'idx_audit_time', 'gmt_create, id'],
]

export async function migrateNormalizedSchema(pool) {
  const connection = await pool.getConnection()
  let locked = false
  const checksum = crypto.createHash('sha256').update(JSON.stringify({ version: 1, roots: ROOTS, columns: COLUMNS, indexes: INDEXES, CLEANUP_SCHEMA, WRITE_LOCK_SCHEMA })).digest('hex')
  try {
    const [locks] = await connection.execute('SELECT GET_LOCK(?, 30) AS acquired', [MIGRATION])
    if (Number(locks[0]?.acquired) !== 1) throw new Error('Cannot acquire normalized migration lock')
    locked = true
    const [applied] = await connection.execute('SELECT checksum_sha256 FROM kq_schema_migration WHERE migration_key = ?', [MIGRATION])
    if (applied.length) {
      if (applied[0].checksum_sha256 !== checksum) throw new Error('Normalized migration checksum mismatch')
      return { alreadyApplied: true }
    }
    for (const statement of [CLEANUP_SCHEMA, WRITE_LOCK_SCHEMA]) await connection.query(statement)
    for (const [table, column, type] of COLUMNS) {
      const [columns] = await connection.execute('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [table, column])
      if (!columns.length) await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${type}`)
    }
    for (const [table, index, columns] of INDEXES) {
      const [indexes] = await connection.execute('SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?', [table, index])
      if (!indexes.length) await connection.query(`ALTER TABLE \`${table}\` ADD INDEX \`${index}\` (${columns})`)
    }
    // The release script has stopped the old writer. Every aggregate backfill
    // commits separately; an interruption never repeats the entire database TX.
    const { RelationalRequestStore } = await import('./request-store.js')
    let migrated = 0
    for (const table of ROOTS.filter(table => !['kq_system_setting', 'kq_account_record'].includes(table))) {
      let cursor = 0
      while (true) {
        const [page] = await connection.query(`SELECT id FROM \`${table}\` WHERE id > ? ORDER BY id LIMIT 50`, [cursor])
        if (!page.length) break
        for (const item of page) {
          const store = new RelationalRequestStore(pool)
          const [row] = await store.select(table, 'id = ?', [item.id])
          const contexts = { kq_user: 'user', kq_organization: 'organization', kq_resource: `resource:${row.resource_kind}`, kq_distribution_batch: 'distribution', kq_auth_session: 'session', kq_verification_code: 'verification', kq_upgrade_order: 'upgrade-order', kq_message: 'message' }
          if (table === 'kq_message' || table === 'kq_user_setting') await store.by('kq_user', 'id', [row.user_id])
          const owner = [...store.rows.get('kq_user').values()].find(user => String(user.id) === String(row.user_id))?.legacy_id
          const context = table === 'kq_guest_usage' ? `guest-usage:${row.identity_digest}` : table === 'kq_user_setting' ? `user-setting:${owner}` : table === 'kq_message' ? `message:${owner}:${row.legacy_id}` : `${contexts[table]}:${row.legacy_id}`
          if (decodeProtected(row.entity_payload_json, context).__columns_v === 1) continue
          if (row.user_id) await store.by('kq_user', 'id', [row.user_id])
          if (table === 'kq_organization') await store.organizationGraph({ members: true })
          else if (table === 'kq_resource') await store.resourceGraph()
          else if (table === 'kq_distribution_batch') {
            await store.by('kq_resource', 'id', [row.share_resource_id])
            await store.resourceGraph()
          } else store.hydrate()
          await store.commit({ normalize: true })
          migrated++
        }
        cursor = page.at(-1).id
      }
    }
    await connection.beginTransaction()
    await connection.execute('UPDATE kq_relational_store_state SET schema_version = 3 WHERE state_key = ?', ['metadata'])
    await connection.execute('INSERT INTO kq_schema_migration (migration_key, checksum_sha256, applied_at) VALUES (?, ?, UTC_TIMESTAMP(3))', [MIGRATION, checksum])
    await connection.commit()
    return { alreadyApplied: false, migrated }
  } catch (error) { await connection.rollback().catch(() => {}); throw error }
  finally {
    if (locked) await connection.execute('SELECT RELEASE_LOCK(?)', [MIGRATION]).catch(() => {})
    connection.release()
  }
}
