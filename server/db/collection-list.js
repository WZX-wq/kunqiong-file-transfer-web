import { decodeProtected } from './relational-store.js'

const iso = value => value == null ? null : new Date(typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2} /.test(value) ? value.replace(' ', 'T') + 'Z' : value).toISOString()
const json = value => typeof value === 'string' ? JSON.parse(value) : value

// The history is a view of owned resources, independent of browser snapshots or
// account-record sync. Count submissions without loading their files or answers.
export async function readOwnedCollectionPage(pool, userId, { cursor = '', limit = 6 } = {}) {
  if (!userId) return { collections: [], pagination: { limit: 6, nextCursor: null } }
  if (cursor && !/^[1-9][0-9]{0,18}$/.test(String(cursor))) throw Object.assign(new Error('分页游标无效'), { status: 400 })
  const size = Math.min(50, Math.max(1, Math.floor(Number(limit) || 6)))
  const [rows] = await pool.query(`SELECT r.id, r.legacy_id, r.status, r.expires_at, r.gmt_create, r.gmt_modified,
      r.entity_payload_json, c.title, c.allowed_types_json, c.max_file_size_bytes,
      COALESCE(usage_row.live_bytes, 0) AS used_bytes, COALESCE(usage_row.live_file_count, 0) AS file_count,
      (SELECT COUNT(*) FROM kq_collection_submission s WHERE s.resource_id = r.id) AS submission_count
    FROM kq_resource r JOIN kq_user owner ON owner.id = r.owner_user_id
    JOIN kq_collection_task c ON c.resource_id = r.id
    LEFT JOIN kq_resource_usage usage_row ON usage_row.resource_id = r.id
    WHERE owner.legacy_id = ? AND r.resource_kind = 'collection' AND r.deleted_at IS NULL
      ${cursor ? 'AND r.id < ?' : ''} ORDER BY r.id DESC LIMIT ${size + 1}`, [userId, ...(cursor ? [cursor] : [])])
  const page = rows.slice(0, size)
  return {
    collections: page.map(row => {
      const stored = decodeProtected(row.entity_payload_json, `resource:collection:${row.legacy_id}`)
      const extra = stored.__columns_v === 1 ? stored.extra : stored
      const deadline = iso(row.expires_at)
      return {
        id: row.legacy_id, token: extra.token || row.legacy_id, manageToken: extra.manageToken || '',
        title: row.title, allowedTypes: json(row.allowed_types_json),
        maxFileSizeMb: Number(row.max_file_size_bytes) / 1024 ** 2,
        status: row.status === 'active' && deadline && new Date(deadline).getTime() <= Date.now() ? 'expired' : row.status,
        deadline, createdAt: iso(row.gmt_create), updatedAt: iso(row.gmt_modified),
        submissionCount: Number(row.submission_count), fileCount: Number(row.file_count), usedBytes: Number(row.used_bytes),
      }
    }),
    pagination: { limit: size, nextCursor: rows.length > size ? String(page.at(-1).id) : null },
  }
}
