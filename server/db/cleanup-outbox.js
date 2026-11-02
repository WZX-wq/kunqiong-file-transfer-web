import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { lockWriteScope } from './write-locks.js'

export const CLEANUP_SCHEMA = `CREATE TABLE IF NOT EXISTS kq_file_cleanup (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  path_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  relative_path VARCHAR(1000) NOT NULL,
  recursive_delete TINYINT UNSIGNED NOT NULL DEFAULT 0,
  guard_kind VARCHAR(20) NULL,
  guard_key VARCHAR(160) NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_error_code VARCHAR(80) NULL,
  UNIQUE KEY uk_cleanup_path (path_digest),
  KEY idx_cleanup_due (next_attempt_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`

export function cleanupTarget(root, target, recursive = false, guard = null) {
  const base = path.resolve(root), absolute = path.resolve(target)
  const relative = path.relative(base, absolute)
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)
    || relative.split(path.sep).length < 2 || !['users', 'files', 'collections', 'tmp'].includes(relative.split(path.sep)[0])) {
    throw new Error('File cleanup target is outside an allowed storage directory')
  }
  return { relative: relative.split(path.sep).join('/'), recursive: Boolean(recursive), guard }
}

export async function enqueueCleanup(connection, tasks) {
  for (const task of tasks) {
    await connection.execute(`INSERT INTO kq_file_cleanup (path_digest, relative_path, recursive_delete, guard_kind, guard_key, next_attempt_at)
      VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE recursive_delete = GREATEST(recursive_delete, VALUES(recursive_delete)),
      guard_kind = IF(guard_kind IS NULL OR VALUES(guard_kind) IS NULL, NULL, VALUES(guard_kind)), guard_key = VALUES(guard_key)`,
    [crypto.createHash('sha256').update(task.relative).digest('hex'), task.relative, task.recursive ? 1 : 0, task.guard?.kind || null, task.guard?.key || null])
  }
}

// SELECT FOR UPDATE makes independent workers safe. Filesystem removal is
// idempotent, so a crash after rm and before COMMIT simply retries the same task.
export async function drainCleanup(pool, root, { limit = 50, remove = fs.rm } = {}) {
  let processed = 0
  for (let index = 0; index < Math.min(500, Math.max(1, limit)); index++) {
    const connection = await pool.getConnection()
    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED')
      await connection.beginTransaction()
      const [candidates] = await connection.query(`SELECT * FROM kq_file_cleanup
        WHERE next_attempt_at <= UTC_TIMESTAMP(3) ORDER BY next_attempt_at, id LIMIT 1`)
      const candidate = candidates[0]
      if (candidate?.guard_kind) await lockWriteScope(connection, [candidate.guard_kind === 'file' ? `disk:${candidate.guard_key}` : `entity:kq_resource:${candidate.guard_key}`])
      const [rows] = candidate ? await connection.query('SELECT * FROM kq_file_cleanup WHERE id = ? AND next_attempt_at <= UTC_TIMESTAMP(3) FOR UPDATE', [candidate.id]) : [[]]
      if (!rows.length) { await connection.commit(); break }
      const task = rows[0]
      try {
        if (task.guard_kind) {
          const [references] = task.guard_kind === 'file'
            ? await connection.query('SELECT id FROM kq_resource_file WHERE disk_key_digest = ? LIMIT 1', [task.guard_key])
            : await connection.query('SELECT id FROM kq_resource WHERE legacy_id = ? LIMIT 1', [task.guard_key])
          if (references.length) {
            await connection.execute('DELETE FROM kq_file_cleanup WHERE id = ?', [task.id])
            await connection.commit()
            continue
          }
        }
        const target = path.resolve(root, task.relative_path)
        cleanupTarget(root, target, task.recursive_delete)
        // Do not follow a directory symlink placed inside the storage tree.
        let parent = path.dirname(target)
        while (parent !== path.resolve(root)) {
          try { if ((await fs.lstat(parent)).isSymbolicLink()) throw Object.assign(new Error('Unsafe cleanup parent'), { code: 'UNSAFE_CLEANUP_PATH' }) }
          catch (error) { if (error.code !== 'ENOENT') throw error }
          parent = path.dirname(parent)
        }
        await remove(target, { recursive: Boolean(task.recursive_delete), force: true })
        await connection.execute('DELETE FROM kq_file_cleanup WHERE id = ?', [task.id])
        processed++
      } catch (error) {
        const seconds = Math.min(3600, 5 * 2 ** Math.min(10, Number(task.attempts)))
        await connection.execute(`UPDATE kq_file_cleanup SET attempts = attempts + 1,
          last_error_code = ?, next_attempt_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND) WHERE id = ?`,
        [String(error.code || 'CLEANUP_FAILED').slice(0, 80), seconds, task.id])
      }
      await connection.commit()
    } catch (error) { await connection.rollback().catch(() => {}); throw error }
    finally { connection.release() }
  }
  return processed
}
