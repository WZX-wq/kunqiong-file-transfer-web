import { activeResource as active } from './resource-status.js'
const json = value => typeof value === 'string' ? JSON.parse(value) : value || {}
const iso = value => value ? new Date(value).toISOString() : null

export async function readAdminOverview(pool) {
  const [[usersStats]] = await pool.query("SELECT COUNT(*) AS users, SUM(status <> 'disabled') AS activeUsers FROM kq_user")
  const [[resourceStats]] = await pool.query(`SELECT COUNT(*) AS resources,
    SUM(r.resource_kind = 'share') AS shares, SUM(r.resource_kind = 'collection') AS collections,
    COALESCE(SUM(u.live_file_count), 0) AS files, COALESCE(SUM(u.live_bytes), 0) AS totalBytes,
    SUM(${active}) AS activeResources, SUM(NOT ${active}) AS pendingCleanup
    FROM kq_resource r LEFT JOIN kq_resource_usage u ON u.resource_id = r.id LEFT JOIN kq_user owner ON owner.id = r.owner_user_id`)
  const [[organizations]] = await pool.query('SELECT COUNT(*) AS total FROM kq_organization')
  const [[audit]] = await pool.query('SELECT COUNT(*) AS total FROM kq_audit_log')
  const [userRows] = await pool.query(`SELECT u.id, u.legacy_id, u.username, u.nickname, u.email, u.phone, u.status, u.plan_json, u.gmt_create, u.gmt_modified,
    (SELECT o.name FROM kq_organization_member m JOIN kq_organization o ON o.id = m.organization_id WHERE m.user_id = u.id AND m.status = 'active' ORDER BY m.id LIMIT 1) AS organization_name,
    (SELECT m.role FROM kq_organization_member m WHERE m.user_id = u.id AND m.status = 'active' ORDER BY m.id LIMIT 1) AS organization_role
    FROM kq_user u ORDER BY u.gmt_modified DESC, u.id DESC LIMIT 200`)
  const userIds = userRows.map(row => row.id), usage = new Map()
  if (userIds.length) {
    const [totals] = await pool.query(`SELECT r.owner_user_id, SUM(u.live_bytes) AS bytes FROM kq_resource r
      JOIN kq_resource_usage u ON u.resource_id = r.id WHERE r.team_resource = 0 AND r.owner_user_id IN (${userIds.map(() => '?').join(',')}) GROUP BY r.owner_user_id`, userIds)
    for (const row of totals) usage.set(String(row.owner_user_id), Number(row.bytes))
  }
  const [resources] = await pool.query(`SELECT r.legacy_id, r.resource_kind, r.gmt_create, r.expires_at,
    owner.legacy_id AS owner_id, s.share_code, c.title,
    CASE WHEN ${active} THEN 'active' WHEN r.resource_kind = 'collection' AND r.status <> 'closed' THEN 'expired' ELSE 'closed' END AS effective_status,
    COALESCE(u.live_file_count, 0) AS file_count, COALESCE(u.live_bytes, 0) AS bytes,
    (SELECT f.file_name FROM kq_resource_file f WHERE f.resource_id = r.id ORDER BY f.id LIMIT 1) AS file_name
    FROM kq_resource r LEFT JOIN kq_resource_usage u ON u.resource_id = r.id LEFT JOIN kq_user owner ON owner.id = r.owner_user_id
    LEFT JOIN kq_share_config s ON s.resource_id = r.id LEFT JOIN kq_collection_task c ON c.resource_id = r.id
    ORDER BY r.gmt_create DESC, r.id DESC LIMIT 200`)
  const start = new Date(); start.setUTCHours(0, 0, 0, 0); start.setUTCDate(start.getUTCDate() - 6)
  const [events] = await pool.query(`SELECT DATE(gmt_create) AS day, COUNT(DISTINCT user_legacy_id) AS active_users,
    SUM(action REGEXP '^POST /api/(shares|upload-sessions|collections)') AS uploads,
    SUM(action REGEXP '^GET /api/(shares|collections/manage)/.*download' AND CAST(result_status AS UNSIGNED) BETWEEN 200 AND 299) AS downloads
    FROM kq_audit_log WHERE gmt_create >= ? GROUP BY DATE(gmt_create)`, [start.toISOString().slice(0, 23).replace('T', ' ')])
  const trend = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start.getTime() + index * 86400000), date = day.toISOString().slice(0, 10)
    const row = events.find(row => (row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day)) === date)
    return { date, label: `${day.getUTCMonth() + 1}/${day.getUTCDate()}`, activeUsers: Number(row?.active_users || 0), uploads: Number(row?.uploads || 0), downloads: Number(row?.downloads || 0) }
  })
  return {
    stats: { ...Object.fromEntries(Object.entries({ ...usersStats, ...resourceStats }).map(([key, value]) => [key, Number(value || 0)])), activeOrganizations: Number(organizations.total) },
    totals: { users: Number(usersStats.users), resources: Number(resourceStats.resources), auditLogs: Number(audit.total) },
    users: userRows.map(row => ({ id: row.legacy_id, username: row.username, nickname: row.nickname, email: row.email, phone: row.phone, status: row.status,
      ...json(row.plan_json), planStartedAt: json(row.plan_json).startedAt, planExpiresAt: json(row.plan_json).expiresAt,
      organizationName: row.organization_name || '', organizationRole: row.organization_role || '', usageBytes: usage.get(String(row.id)) || 0, createdAt: iso(row.gmt_create), updatedAt: iso(row.gmt_modified) })),
    resources: resources.map(row => ({ id: row.legacy_id, kind: row.resource_kind, name: row.resource_kind === 'share' ? row.file_name || '文件分享' : row.title || '收集任务',
      code: row.share_code || '', ownerUserId: row.owner_id || '', status: row.effective_status, fileCount: Number(row.file_count), totalSize: Number(row.bytes), createdAt: iso(row.gmt_create), expiresAt: iso(row.expires_at) })),
    trend,
  }
}
