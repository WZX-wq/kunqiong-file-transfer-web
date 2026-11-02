// Aliases r (resource) and owner (user) are shared by the read models/cleanup.
export const planExpiredShare = `(r.resource_kind = 'share' AND r.expires_at IS NULL
  AND STR_TO_DATE(LEFT(JSON_UNQUOTE(JSON_EXTRACT(owner.plan_json, '$.expiresAt')), 19), '%Y-%m-%dT%H:%i:%s')
    <= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 7 DAY))`
export const activeResource = `(r.status = 'active' AND r.deleted_at IS NULL
  AND (r.expires_at IS NULL OR r.expires_at > UTC_TIMESTAMP(3)) AND NOT COALESCE(${planExpiredShare}, 0))`
