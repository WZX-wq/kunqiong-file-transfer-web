import { isDeepStrictEqual } from 'node:util'

export const EXTRA_PAYLOAD_TABLES = ['kq_organization_member', 'kq_ownership_handover', 'kq_distribution_assignment']
export const jsonValue = value => typeof value === 'string' ? JSON.parse(value) : value
const iso = value => {
  if (value == null) return null
  // Synchronizer cache values are SQL DATETIME strings in UTC; fetched mysql2
  // values are Date objects. Neither may be interpreted in the host timezone.
  const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
    ? `${value.replace(' ', 'T')}Z` : value
  return new Date(date).toISOString()
}
const number = value => value == null ? null : Number(value)
const fields = {
  kq_user: { id: 'legacy_id', username: 'username', nickname: 'nickname', email: 'email', phone: 'phone', status: 'status', provider: 'provider', loginMethods: ['login_methods_json', jsonValue], createdAt: ['gmt_create', iso], updatedAt: ['gmt_modified', iso] },
  kq_organization: { id: 'legacy_id', name: 'name', slug: 'slug', ownerUserId: ['owner_user_id', 'user'], branding: ['branding_json', jsonValue], rowVersion: ['row_version', number], createdAt: ['gmt_create', iso], updatedAt: ['gmt_modified', iso] },
  kq_resource: { id: 'legacy_id', ownerUserId: ['owner_user_id', 'user'], teamResource: ['team_resource', Boolean], teamOrganizationId: ['organization_id', 'organization'], status: 'status', expiresAt: ['expires_at', iso], deadline: ['expires_at', iso], closeReason: 'close_reason', deletedAt: ['deleted_at', iso], trashExpiresAt: ['trash_expires_at', iso], deletedByUserId: ['deleted_by_user_id', 'user'], rowVersion: ['row_version', number], createdAt: ['gmt_create', iso], updatedAt: ['gmt_modified', iso] },
  kq_resource_file: { name: 'file_name', originalName: 'original_file_name', storageOwnerId: 'storage_owner_key', storedName: ['storage_key', value => String(value).split('/').at(-1)], size: ['size_bytes', number], mimeType: 'mime_type', mimetype: 'mime_type', sha256: 'content_sha256', contentSha256: 'content_sha256', scannedAt: ['scanned_at', iso] },
  kq_collection_submission: { participantName: 'participant_name', submitterName: 'submitter_name', submitterUserId: ['submitter_user_id', 'user'], submittedAt: ['submitted_at', iso] },
  kq_distribution_batch: { id: 'legacy_id', ownerUserId: ['owner_user_id', 'user'], shareId: ['share_resource_id', 'resource'], idempotencyKey: 'idempotency_key', frozenAt: ['frozen_at', iso] },
  kq_auth_session: { expiresAt: ['expires_at', iso], revokedAt: ['revoked_at', iso] },
  kq_verification_code: { id: 'legacy_id', scene: 'scene', type: 'target_type', codeHash: 'code_hash', attempts: ['attempts', number], expiresAt: ['expires_at', iso] },
  kq_upgrade_order: { id: 'legacy_id', orderNo: 'order_no', userId: ['user_id', 'user'], planId: 'plan_id', status: 'status', amount: ['amount', number], payType: ['pay_type', number], remoteOrderNo: 'remote_order_no', paidAt: ['paid_at', iso], remoteExpireAt: ['remote_expire_at', iso] },
  kq_message: { id: 'legacy_id', category: 'category', eventType: 'event_type', title: 'title', body: 'body', actionType: 'action_type', actionId: 'action_id', actionUrl: 'action_url', readAt: ['read_at', iso] },
  kq_organization_member: { userId: ['user_id', 'user'], role: 'role', status: 'status', invitationExpiresAt: ['invitation_expires_at', iso], requestedAt: ['requested_at', iso], reviewedAt: ['reviewed_at', iso] },
  kq_ownership_handover: { id: 'legacy_id', fromUserId: ['from_user_id', 'user'], toUserId: ['to_user_id', 'user'], status: 'status', initiatedAt: ['initiated_at', iso], expiresAt: ['expires_at', iso], resolvedAt: ['resolved_at', iso], resolvedByUserId: ['resolved_by_user_id', 'user'], reason: 'reason' },
  kq_distribution_assignment: { userId: ['recipient_user_id', 'user'], fileName: 'file_name_snapshot' },
}
Object.assign(fields.kq_user, {
  avatar: 'avatar_url', providerAvatar: 'avatar_url',
  planId: ['plan_json', value => jsonValue(value)?.planId],
  planStartedAt: ['plan_json', value => jsonValue(value)?.startedAt],
  planExpiresAt: ['plan_json', value => jsonValue(value)?.expiresAt],
  organizationId: ['plan_json', value => jsonValue(value)?.organizationId],
  organizationRole: ['plan_json', value => jsonValue(value)?.organizationRole],
  fileCleanup: ['plan_json', value => jsonValue(value)?.fileCleanup],
})
Object.assign(fields.kq_organization, {
  teamPlanId: ['plan_json', value => jsonValue(value)?.id],
  teamPlanStartedAt: ['plan_json', value => jsonValue(value)?.startedAt],
  teamPlanExpiresAt: ['plan_json', value => jsonValue(value)?.expiresAt],
  teamPlanPermanent: ['plan_json', value => jsonValue(value)?.permanent],
})
fields.kq_message.unread = ['read_at', value => value == null]
const children = { kq_resource: ['files', 'submissions'], kq_organization: ['members', 'ownershipHandovers'], kq_collection_submission: ['files'], kq_distribution_batch: ['rows'] }
const resourceConfig = {
  code: ['share_code', 80], passwordHash: ['password_hash', 255], downloadCount: ['download_count', Number], downloadLimit: ['download_limit', number],
  title: ['title', 160], description: ['description', 1000], allowedTypes: ['allowed_types_json', jsonValue], materials: ['materials_json', jsonValue], customFields: ['custom_fields_json', jsonValue],
  maxFileSizeMb: ['max_file_size_bytes', value => Number(value) / 1024 ** 2], capacityBytes: ['capacity_bytes', number],
}

function readField(row, descriptor, maps = {}) {
  const [column, transform] = Array.isArray(descriptor) ? descriptor : [descriptor]
  if (['user', 'resource', 'organization'].includes(transform)) return maps[transform]?.get(String(row[column])) ?? null
  return typeof transform === 'function' ? transform(row[column]) : row[column]
}

// Only extension fields remain encrypted. Present-key metadata preserves the
// distinction between absent/null/empty values in the existing API contracts.
export function packEntity(table, value, row, { position = null } = {}) {
  const extra = { ...value }, columns = []
  if (table === 'kq_guest_usage') {
    extra.entity = { ...value.entity }
    for (const [key, column, transform] of [['bytes', 'used_bytes', number], ['uploads', 'upload_count', number], ['firstAt', 'first_used_at', iso], ['lastAt', 'last_used_at', iso]]) {
      if (Object.hasOwn(extra.entity, key) && isDeepStrictEqual(extra.entity[key], transform(row[column]))) { columns.push(key); delete extra.entity[key] }
    }
  }
  for (const [key, descriptor] of Object.entries(fields[table] || {})) {
    if (!Object.hasOwn(value, key)) continue
    const [column, transform] = Array.isArray(descriptor) ? descriptor : [descriptor]
    const comparable = ['user', 'resource', 'organization'].includes(transform)
      ? row[column] != null && Boolean(value[key]) : isDeepStrictEqual(readField(row, descriptor), value[key])
    if (comparable) { columns.push(key); delete extra[key] }
  }
  for (const key of children[table] || []) if (Array.isArray(value[key])) { columns.push(key); delete extra[key] }
  if (table === 'kq_resource') {
    for (const [key, [, type]] of Object.entries(resourceConfig)) if (Object.hasOwn(value, key)
      && value[key] !== '' && value[key] !== undefined && !(type === jsonValue && value[key] === null)
      && (typeof type !== 'number' || value[key] == null || String(value[key]).length <= type)) {
      columns.push(key); delete extra[key]
    }
  }
  if (table === 'kq_collection_submission' && Object.hasOwn(value, 'fieldValues')) { columns.push('fieldValues'); delete extra.fieldValues }
  if (table === 'kq_user_setting') return { __columns_v: 1, extra: {}, columns: ['notification', 'fileCleanup'] }
  return { __columns_v: 1, extra, columns, ...(position == null ? {} : { position }) }
}

export function hydrateRows(rowsByTable, next, decode) {
  const rows = table => [...(rowsByTable.get(table)?.values() || [])]
  const decoded = new WeakMap()
  const storedFor = (row, context) => {
    if (!decoded.has(row)) decoded.set(row, decode(row.entity_payload_json, context))
    return decoded.get(row)
  }
  const maps = {
    user: new Map(rows('kq_user').map(row => [String(row.id), row.legacy_id])),
    resource: new Map(rows('kq_resource').map(row => [String(row.id), row.legacy_id])),
    organization: new Map(rows('kq_organization').map(row => [String(row.id), row.legacy_id])),
  }
  const protectedJson = (value, context, fallback) => value == null ? fallback : decode(value, context)
  const payload = (table, row, context) => {
    const stored = storedFor(row, context)
    if (stored.__columns_v !== 1) return stored
    const value = { ...stored.extra }
    for (const key of stored.columns) if (fields[table]?.[key]) value[key] = readField(row, fields[table][key], maps)
    return value
  }
  const ordered = (table, list, context) => list.sort((a, b) => {
    const ordinal = row => row.entity_payload_json ? storedFor(row, context(row)).position ?? Number(row.id) : Number(row.id)
    return ordinal(a) - ordinal(b)
  })
  for (const row of rows('kq_system_setting')) if (['systemConfig', 'collectionTemplates'].includes(row.setting_key)) next[row.setting_key] = jsonValue(row.setting_value_json)
  for (const row of rows('kq_user')) {
    next.users[row.legacy_id] = payload('kq_user', row, `user:${row.legacy_id}`)
    next.users[row.legacy_id].status = row.status
  }
  for (const row of rows('kq_organization')) {
    const org = payload('kq_organization', row, `organization:${row.legacy_id}`)
    const stored = storedFor(row, `organization:${row.legacy_id}`)
    if (stored.__columns_v === 1) {
      if (stored.columns.includes('members')) org.members = ordered('kq_organization_member', rows('kq_organization_member').filter(child => String(child.organization_id) === String(row.id)), child => `member-entity:${child.legacy_id}`)
        .map(child => payload('kq_organization_member', child, `member-entity:${child.legacy_id}`))
      if (stored.columns.includes('ownershipHandovers')) org.ownershipHandovers = rows('kq_ownership_handover').filter(child => String(child.organization_id) === String(row.id))
        .map(child => payload('kq_ownership_handover', child, `handover-entity:${child.legacy_id}`))
    }
    next.organizations[row.legacy_id] = org
  }
  const fileValues = new Map(), filePositions = new Map()
  for (const row of rows('kq_resource_file')) {
    const resourceId = maps.resource.get(String(row.resource_id))
    if (resourceId) {
      const context = `resource-file:${resourceId}:${row.legacy_id}`
      fileValues.set(String(row.id), payload('kq_resource_file', row, context))
      filePositions.set(String(row.id), storedFor(row, context).position ?? Number(row.id))
    }
  }
  for (const row of rows('kq_resource')) {
    const context = `resource:${row.resource_kind}:${row.legacy_id}`
    const value = payload('kq_resource', row, context), stored = storedFor(row, context)
    if (stored.__columns_v === 1) {
      const config = rows(row.resource_kind === 'share' ? 'kq_share_config' : 'kq_collection_task').find(child => String(child.resource_id) === String(row.id))
      for (const key of stored.columns) if (resourceConfig[key]) {
        if (!config) throw new Error('Normalized resource configuration is missing')
        const [column, transform] = resourceConfig[key]
        value[key] = typeof transform === 'function' ? transform(config[column]) : config[column]
      }
      if (stored.columns.includes('files')) value.files = value.cleanedAt ? [] : ordered('kq_resource_file', rows('kq_resource_file').filter(child => String(child.resource_id) === String(row.id)), child => `resource-file:${row.legacy_id}:${child.legacy_id}`).map(child => fileValues.get(String(child.id)))
      if (stored.columns.includes('submissions')) value.submissions = ordered('kq_collection_submission', rows('kq_collection_submission').filter(child => String(child.resource_id) === String(row.id)), child => `submission:${child.legacy_id}`).map(child => {
        const submission = payload('kq_collection_submission', child, `submission:${child.legacy_id}`)
        const extension = storedFor(child, `submission:${child.legacy_id}`)
        if (extension.__columns_v === 1) {
          if (extension.columns.includes('fieldValues')) submission.fieldValues = protectedJson(child.field_values_json, `field-values:${child.legacy_id}`, {})
          if (extension.columns.includes('files')) submission.files = rows('kq_submission_file').filter(link => String(link.submission_id) === String(child.id)).sort((a, b) => filePositions.get(String(a.resource_file_id)) - filePositions.get(String(b.resource_file_id))).map(link => fileValues.get(String(link.resource_file_id))).filter(Boolean)
        }
        return submission
      })
    }
    next[row.resource_kind === 'collection' ? 'collections' : 'shares'].push(value)
  }
  for (const row of rows('kq_distribution_batch')) {
    const value = payload('kq_distribution_batch', row, `distribution:${row.legacy_id}`)
    const extension = storedFor(row, `distribution:${row.legacy_id}`)
    if (extension.__columns_v === 1 && extension.columns.includes('rows')) value.rows = ordered('kq_distribution_assignment', rows('kq_distribution_assignment').filter(child => String(child.batch_id) === String(row.id)), child => `assignment-entity:${row.legacy_id}:${child.resource_file_id}`).map(child => payload('kq_distribution_assignment', child, `assignment-entity:${row.legacy_id}:${child.resource_file_id}`))
    next.distributions.push(value)
  }
  for (const [table, domain, context] of [['kq_auth_session', 'sessions', 'session'], ['kq_verification_code', 'verificationCodes', 'verification'], ['kq_upgrade_order', 'upgradeOrders', 'upgrade-order']]) {
    for (const row of rows(table)) {
      const value = payload(table, row, `${context}:${row.legacy_id}`)
      // Revocation must also invalidate an unconverted legacy payload. These
      // two SQL columns are authoritative regardless of its encoding version.
      if (table === 'kq_auth_session') {
        // The SQL foreign key identifies the current account. A historical
        // encrypted profile inside a session is never an identity authority.
        const userId = maps.user.get(String(row.user_id))
        if (userId) value.user = { ...value.user, id: userId }
        value.expiresAt = iso(row.expires_at)
        if (row.revoked_at != null) {
          value.revokedAt = iso(row.revoked_at)
          if (row.replacement_session_id) value.revokeReason = 'replaced'
        }
        else delete value.revokedAt
      }
      next[domain].push(value)
    }
  }
  for (const row of rows('kq_message')) {
    const owner = maps.user.get(String(row.user_id))
    if (!owner) throw new Error('Message owner was not loaded')
    ;(next.messages[owner] ??= []).push(payload('kq_message', row, `message:${owner}:${row.legacy_id}`))
  }
  for (const row of rows('kq_account_record')) {
    const owner = maps.user.get(String(row.user_id))
    if (!owner) throw new Error('Record owner was not loaded')
    ;(next.records[owner] ??= []).push(decode(row.record_snapshot_json, `account-record:${row.legacy_id}`))
  }
  for (const row of rows('kq_user_setting')) {
    const owner = maps.user.get(String(row.user_id))
    const extension = decode(row.entity_payload_json, `user-setting:${owner}`)
    next.notificationSettings[owner] = extension.__columns_v === 1 ? jsonValue(row.notification_json) || {} : extension.notification || {}
  }
  for (const row of rows('kq_guest_usage')) {
    const stored = decode(row.entity_payload_json, `guest-usage:${row.identity_digest}`)
    const value = stored.__columns_v === 1 ? stored.extra : stored
    if (stored.__columns_v === 1) for (const [key, column, transform] of [['bytes', 'used_bytes', number], ['uploads', 'upload_count', number], ['firstAt', 'first_used_at', iso], ['lastAt', 'last_used_at', iso]]) {
      if (stored.columns.includes(key)) value.entity[key] = transform(row[column])
    }
    next.guestUsage[value.key] = value.entity
  }
  return next
}
