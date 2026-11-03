import crypto from 'node:crypto'
import { decodeProtected } from './relational-store.js'

export const RECORD_LIST_MIGRATION = '008-record-list-projection'
const groups = {
  image: 'jpg jpeg png gif webp bmp svg heic heif ico',
  document: 'pdf doc docx txt rtf xls xlsx csv ppt pptx md',
  video: 'mp4 mov avi mkv webm m4v ogv flv wmv',
  audio: 'mp3 wav m4a aac flac oga ogg wma',
  archive: 'zip rar 7z tar gz bz2 xz',
  code: 'js jsx ts tsx html css json xml yml yaml java py go php rb rs c cpp h cs sh ps1 bat cmd sql',
}
const columns = [
  ['list_name', "VARCHAR(240) NOT NULL DEFAULT ''"],
  ['list_search', 'TEXT NULL'],
  ['list_categories', "VARCHAR(120) NOT NULL DEFAULT ''"],
  ['list_deadline', 'DATETIME(3) NULL'],
  ['list_ready', 'TINYINT NOT NULL DEFAULT 0'],
]
export function recordListProjection(record) {
  const files = record.files?.length ? record.files : (record.submissions || []).flatMap(item => item.files || [])
  const category = file => {
    const extension = String(file.name || '').split('.').at(-1).toLowerCase()
    if (groups.code.split(' ').includes(extension)) return 'code'
    for (const type of ['image', 'video', 'audio']) if (String(file.mimeType || '').startsWith(`${type}/`)) return type
    return Object.keys(groups).find(key => groups[key].split(' ').includes(extension)) || 'other'
  }
  const categories = record.kind === 'collection' ? ['collection'] : [...new Set((files.length ? files : [{ name: record.alias || record.name }]).map(category))]
  if (categories.length > 1) categories.push('mixed')
  const name = String(record.alias || record.name || '').slice(0, 240)
  const search = [name, record.name, record.code, record.meta, record.participantName,
    ...(record.submissions || []).map(item => item.participantName), ...files.map(file => `${file.name || ''} ${file.relativePath || ''}`)].filter(Boolean).join(' ').slice(0, 16000)
  const deadline = new Date(record.expiresAt || record.deadline || NaN)
  return [name, search, categories.join(','), Number.isFinite(deadline.getTime()) ? deadline.toISOString().slice(0, 23).replace('T', ' ') : null]
}
export async function writeRecordListProjection(connection, id, record) {
  await connection.execute('UPDATE kq_account_record SET list_name = ?, list_search = ?, list_categories = ?, list_deadline = ?, list_ready = 1, gmt_modified = gmt_modified WHERE id = ?', [...recordListProjection(record), id])
}
const availability = new WeakMap()
const readiness = new WeakMap()
export async function hasRecordListProjection(pool, { requireMigration = false } = {}) {
  if (!availability.has(pool)) availability.set(pool, pool.query("SELECT COUNT(*) AS found FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kq_account_record' AND COLUMN_NAME = 'list_ready'").then(([rows]) => Number(rows[0].found) > 0).catch(error => { availability.delete(pool); throw error }))
  const found = await availability.get(pool)
  if (!found) availability.delete(pool)
  if (found && requireMigration) {
    if (!readiness.has(pool)) readiness.set(pool, pool.query('SELECT migration_key FROM kq_schema_migration WHERE migration_key = ?', [RECORD_LIST_MIGRATION]).then(([rows]) => rows.length > 0).catch(error => { readiness.delete(pool); throw error }))
    const ready = await readiness.get(pool)
    if (!ready) readiness.delete(pool)
    return ready
  }
  return found
}
// Explicit migration only: individual snapshots, bounded batches, no whole-store JSON.
export async function migrateRecordListProjection(pool) {
  const connection = await pool.getConnection()
  const checksum = crypto.createHash('sha256').update(JSON.stringify(columns)).digest('hex')
  let locked = false
  try {
    const [locks] = await connection.execute('SELECT GET_LOCK(?, 30) AS acquired', [RECORD_LIST_MIGRATION])
    if (Number(locks[0]?.acquired) !== 1) throw new Error('Cannot acquire record projection migration lock')
    locked = true
    const [applied] = await connection.execute('SELECT checksum_sha256 FROM kq_schema_migration WHERE migration_key = ?', [RECORD_LIST_MIGRATION])
    if (applied.length) {
      if (applied[0].checksum_sha256 !== checksum) throw new Error('Record projection migration checksum mismatch')
      return { alreadyApplied: true }
    }
    for (const [name, definition] of columns) {
      const [exists] = await connection.execute('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', ['kq_account_record', name])
      if (!exists.length) await connection.query(`ALTER TABLE kq_account_record ADD COLUMN ${name} ${definition}`)
    }
    let cursor = 0, migrated = 0
    while (true) {
      const [rows] = await connection.query('SELECT id, legacy_id, record_snapshot_json FROM kq_account_record WHERE id > ? AND list_ready = 0 ORDER BY id LIMIT 50', [cursor])
      if (!rows.length) break
      for (const row of rows) {
        // Lock and reread: never project a snapshot replaced by a concurrent writer.
        await connection.beginTransaction()
        const [[latest]] = await connection.query('SELECT legacy_id, record_snapshot_json FROM kq_account_record WHERE id = ? FOR UPDATE', [row.id])
        if (latest) await writeRecordListProjection(connection, row.id, decodeProtected(latest.record_snapshot_json, `account-record:${latest.legacy_id}`))
        await connection.commit()
        migrated++
      }
      cursor = rows.at(-1).id
    }
    await connection.execute('INSERT INTO kq_schema_migration (migration_key, checksum_sha256, applied_at) VALUES (?, ?, UTC_TIMESTAMP(3))', [RECORD_LIST_MIGRATION, checksum])
    availability.delete(pool)
    readiness.delete(pool)
    return { alreadyApplied: false, migrated }
  } catch (error) { await connection.rollback().catch(() => {}); throw error }
  finally { if (locked) await connection.execute('SELECT RELEASE_LOCK(?)', [RECORD_LIST_MIGRATION]).catch(() => {}); connection.release() }
}
