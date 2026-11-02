import crypto from 'node:crypto'
import path from 'node:path'
import { keyedDigest, protectCredential, revealCredential } from '../lib/private-key.js'
import { readRowsById } from './paged-reader.js'
import { hydrateRows, packEntity } from './normalized-codec.js'
import { filePathDigest, diskKeyDigest } from './file-path-key.js'

const STATE_TABLE = 'kq_relational_store_state'
const PAYLOAD_TABLES = [
  'kq_user', 'kq_organization', 'kq_resource', 'kq_resource_file', 'kq_collection_submission',
  'kq_distribution_batch', 'kq_auth_session', 'kq_verification_code', 'kq_upgrade_order',
  'kq_message', 'kq_user_setting', 'kq_guest_usage', 'kq_audit_log',
]
const DATA_TABLES = [
  'kq_submission_file', 'kq_collection_submission', 'kq_distribution_assignment',
  'kq_distribution_batch', 'kq_resource_file', 'kq_share_config', 'kq_collection_task',
  'kq_resource', 'kq_ownership_handover', 'kq_organization_member', 'kq_organization',
  'kq_auth_session', 'kq_verification_code', 'kq_upgrade_order', 'kq_message',
  'kq_user_setting', 'kq_account_record', 'kq_guest_usage', 'kq_system_setting', 'kq_user',
]
const MANAGED_TABLES = DATA_TABLES.filter(table => table !== 'kq_audit_log')
// Embedded avatars and resource snapshots can make individual JSON rows large.
// Bound these responses while loading over a remote database connection.
const RELATIONAL_READ_PAGE_SIZES = { kq_user: 1, kq_account_record: 1, kq_resource: 1, kq_upgrade_order: 1 }
const IDENTITY_COLUMNS = {
  kq_message: ['user_id', 'legacy_id'],
  kq_user_setting: ['user_id'],
  kq_system_setting: ['setting_key'],
  kq_account_record: ['user_id', 'legacy_id'],
  kq_guest_usage: ['identity_digest'],
  kq_resource_file: ['storage_key'],
  kq_share_config: ['resource_id'],
  kq_collection_task: ['resource_id'],
  kq_submission_file: ['resource_file_id'],
  kq_distribution_assignment: ['batch_id', 'resource_file_id'],
}
const relationalSyncContexts = new WeakMap()
const relationalSyncCaches = new WeakMap()
const STANDARD_KEYS = new Set([
  'users', 'organizations', 'shares', 'collections', 'distributions', 'sessions',
  'verificationCodes', 'upgradeOrders', 'messages', 'notificationSettings', 'records',
  'guestUsage', 'systemConfig', 'collectionTemplates', 'auditLogs', 'auditStorage',
  '_localRevision',
])

function parseJson(value, fallback = null) {
  if (value === null || value === undefined) return fallback
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return fallback }
}

function encodeProtected(value, context) {
  return JSON.stringify(protectCredential(JSON.stringify(value), `relational:${context}`))
}

export function decodeProtected(value, context) {
  let encoded = value
  if (typeof encoded === 'string' && encoded.startsWith('"')) encoded = JSON.parse(encoded)
  if (typeof encoded !== 'string') throw new Error('关系表中的加密业务记录格式无效')
  return JSON.parse(revealCredential(encoded, `relational:${context}`))
}

function dateTime(value, fallback = null) {
  if (!value) return fallback
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return fallback
  return date.toISOString().slice(0, 23).replace('T', ' ')
}

function text(value, max, fallback = '') {
  const result = String(value ?? fallback)
  return result.length > max ? result.slice(0, max) : result
}

function positiveInteger(value, fallback = 0) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback
}

function valuesById(value) {
  return Object.values(value && typeof value === 'object' && !Array.isArray(value) ? value : {})
}

function stableFileId(resourceId, file, index) {
  const seed = `${resourceId}\0${file?.id || ''}\0${index}\0${file?.storageOwnerId || ''}\0${file?.storedName || ''}\0${file?.name || ''}`
  return `file_${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 48)}`
}

export function buildRelationalModel(value = {}) {
  const resources = [
    ...(Array.isArray(value.shares) ? value.shares.map(entity => ({ kind: 'share', entity })) : []),
    ...(Array.isArray(value.collections) ? value.collections.map(entity => ({ kind: 'collection', entity })) : []),
  ]
  const messages = []
  for (const [userId, list] of Object.entries(value.messages || {})) {
    for (const message of Array.isArray(list) ? list : []) messages.push({ userId, entity: message })
  }
  const records = []
  for (const [userId, list] of Object.entries(value.records || {})) {
    for (const record of Array.isArray(list) ? list : []) records.push({ userId, entity: record })
  }
  const notificationSettings = Object.entries(value.notificationSettings || {}).map(([userId, entity]) => ({ userId, entity }))
  const guestUsage = Object.entries(value.guestUsage || {}).map(([key, entity]) => ({ key, entity }))
  const extraSettings = Object.fromEntries(Object.entries(value).filter(([key]) => !STANDARD_KEYS.has(key)))
  return {
    users: valuesById(value.users),
    organizations: valuesById(value.organizations),
    resources,
    distributions: Array.isArray(value.distributions) ? value.distributions : [],
    sessions: Array.isArray(value.sessions) ? value.sessions : [],
    verificationCodes: Array.isArray(value.verificationCodes) ? value.verificationCodes : [],
    upgradeOrders: Array.isArray(value.upgradeOrders) ? value.upgradeOrders : [],
    messages,
    notificationSettings,
    records,
    guestUsage,
    systemSettings: [
      { key: 'systemConfig', value: value.systemConfig || {} },
      { key: 'collectionTemplates', value: Array.isArray(value.collectionTemplates) ? value.collectionTemplates : [] },
      { key: 'legacyExtraMetadata', value: extraSettings },
    ],
  }
}

export function countRelationalModelRows(value = {}) {
  const model = buildRelationalModel(value)
  const shares = model.resources.filter(resource => resource.kind === 'share')
  const collections = model.resources.filter(resource => resource.kind === 'collection')
  const submissions = collections.flatMap(({ entity }) => Array.isArray(entity.submissions) ? entity.submissions : [])
  const organizations = model.organizations
  const counts = {
    kq_submission_file: submissions.reduce((total, submission) => total + (Array.isArray(submission.files) ? submission.files.length : 0), 0),
    kq_collection_submission: submissions.length,
    kq_distribution_assignment: model.distributions.reduce((total, item) => total + (Array.isArray(item.rows) ? item.rows.length : 0), 0),
    kq_distribution_batch: model.distributions.length,
    kq_resource_file: shares.reduce((total, { entity }) => total + (Array.isArray(entity.files) ? entity.files.length : 0), 0)
      + submissions.reduce((total, submission) => total + (Array.isArray(submission.files) ? submission.files.length : 0), 0),
    kq_share_config: shares.length,
    kq_collection_task: collections.length,
    kq_resource: model.resources.length,
    kq_ownership_handover: organizations.reduce((total, organization) => total + (Array.isArray(organization.ownershipHandovers) ? organization.ownershipHandovers.length : 0), 0),
    kq_organization_member: organizations.reduce((total, organization) => total + (Array.isArray(organization.members) ? organization.members.length : 0), 0),
    kq_organization: organizations.length,
    kq_auth_session: model.sessions.length,
    kq_verification_code: model.verificationCodes.length,
    kq_upgrade_order: model.upgradeOrders.length,
    kq_message: model.messages.length,
    kq_user_setting: model.notificationSettings.length,
    kq_account_record: model.records.length,
    kq_guest_usage: model.guestUsage.length,
    kq_system_setting: model.systemSettings.length,
    kq_user: model.users.length,
  }
  return Object.fromEntries(MANAGED_TABLES.map(table => [table, Number(counts[table]) || 0]))
}

export async function ensureRelationalStoreSchema(pool) {
  const connection = await pool.getConnection()
  let locked = false
  try {
    const [lockRows] = await connection.execute('SELECT GET_LOCK(?, 30) AS acquired', ['kunqiong-relational-data-schema-v2'])
    if (Number(lockRows?.[0]?.acquired) !== 1) throw new Error('无法获得关系存储增量结构迁移锁')
    locked = true
    await connection.query(`CREATE TABLE IF NOT EXISTS ${STATE_TABLE} (
      state_key VARCHAR(40) COLLATE utf8mb4_bin NOT NULL,
      revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
      schema_version INT UNSIGNED NOT NULL DEFAULT 1,
      source_snapshot_revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
      record_counts_json JSON NOT NULL,
      gmt_create DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      gmt_modified DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (state_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='关系存储版本与迁移状态'`)
    const definition = { stateTable: STATE_TABLE, columns: PAYLOAD_TABLES.map(table => [table, 'entity_payload_json', 'json']) }
    const checksum = crypto.createHash('sha256').update(JSON.stringify(definition)).digest('hex')
    const [appliedRows] = await connection.execute(
      'SELECT checksum_sha256 FROM kq_schema_migration WHERE migration_key = ? LIMIT 1',
      ['002-relational-runtime-payloads'],
    )
    if (appliedRows[0]?.checksum_sha256 && appliedRows[0].checksum_sha256 !== checksum) {
      throw new Error('关系存储增量迁移 checksum 不匹配，请新增迁移版本')
    }
    for (const table of PAYLOAD_TABLES) {
      const [columns] = await connection.execute(
        'SELECT COUNT(*) AS found FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
        [table, 'entity_payload_json'],
      )
      if (!Number(columns?.[0]?.found)) await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN entity_payload_json JSON NULL`)
    }
    if (!appliedRows[0]) {
      await connection.execute(
        'INSERT INTO kq_schema_migration (migration_key, checksum_sha256, applied_at) VALUES (?, ?, UTC_TIMESTAMP(3))',
        ['002-relational-runtime-payloads', checksum],
      )
    }
  } finally {
    if (locked) {
      try { await connection.execute('SELECT RELEASE_LOCK(?)', ['kunqiong-relational-data-schema-v2']) } catch {}
    }
    connection.release()
  }
}

export async function readRelationalState(connection, lock = false) {
  const [rows] = await connection.query(
    `SELECT revision, schema_version, source_snapshot_revision, record_counts_json FROM ${STATE_TABLE} WHERE state_key = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    ['metadata'],
  )
  if (!rows.length) return null
  return {
    revision: Number(rows[0].revision) || 0,
    schemaVersion: Number(rows[0].schema_version) || 1,
    sourceSnapshotRevision: Number(rows[0].source_snapshot_revision) || 0,
    counts: parseJson(rows[0].record_counts_json, {}),
  }
}

async function executeInsert(connection, table, columns, values, options = {}) {
  const sync = relationalSyncContexts.get(connection)
  if (sync) return syncRow(connection, sync, table, columns, values, options)
  const placeholders = columns.map(() => '?').join(', ')
  const [result] = await connection.execute(
    `INSERT INTO \`${table}\` (${columns.map(column => `\`${column}\``).join(', ')}) VALUES (${placeholders})`,
    values,
  )
  return Number(result.insertId)
}

function comparisonForProtected(context, value, { prefix = true, parseJsonValue = true } = {}) {
  return { context, value, prefix, parseJsonValue }
}

async function insertPayload(connection, table, columns, values, payload, context, protectedColumns = {}, options = {}) {
  if (relationalSyncContexts.get(connection)?.normalized) payload = packEntity(table, payload, Object.fromEntries(columns.map((key, index) => [key, values[index]])), options)
  return executeInsert(connection, table, [...columns, 'entity_payload_json'], [...values, encodeProtected(payload, context)], {
    protectedColumns: { entity_payload_json: comparisonForProtected(context, payload), ...protectedColumns },
    ...options,
  })
}

export function identityKey(table, rowOrValues, columns = null) {
  const identityColumns = IDENTITY_COLUMNS[table] || ['legacy_id']
  const parts = identityColumns.map(column => {
    const index = columns?.indexOf(column) ?? -1
    const value = index >= 0 ? rowOrValues[index] : rowOrValues[column]
    return value === null || value === undefined ? null : String(value)
  })
  if (parts.some(part => part === null)) {
    throw new Error(`关系表 ${table} 的稳定业务键缺少值`)
  }
  return JSON.stringify(parts)
}

function stableValue(value) {
  if (value instanceof Date) {
    const two = part => String(part).padStart(2, '0')
    const three = part => String(part).padStart(3, '0')
    return `${value.getUTCFullYear()}-${two(value.getUTCMonth() + 1)}-${two(value.getUTCDate())} ${two(value.getUTCHours())}:${two(value.getUTCMinutes())}:${two(value.getUTCSeconds())}.${three(value.getUTCMilliseconds())}`
  }
  if (Buffer.isBuffer(value)) return `buffer:${value.toString('hex')}`
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function stableDate(value) {
  if (value instanceof Date) return stableValue(value)
  const match = String(value ?? '').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?/)
  return match ? `${match[1]} ${match[2]}.${String(match[3] || '0').padEnd(3, '0')}` : value
}

function decryptForComparison(stored, rule) {
  let encrypted = stored
  if (typeof encrypted === 'string' && encrypted.startsWith('"')) encrypted = JSON.parse(encrypted)
  const context = rule.prefix ? `relational:${rule.context}` : rule.context
  const clear = revealCredential(encrypted, context)
  return rule.parseJsonValue && clear ? JSON.parse(clear) : clear
}

function storedValueMatches(column, stored, desired, protectedColumns = {}) {
  const protectedRule = protectedColumns[column]
  if (protectedRule) {
    try {
      const decoded = decryptForComparison(stored, protectedRule)
      return stableValue(decoded) === stableValue(protectedRule.value)
    } catch { return false }
  }
  if (/_json$/.test(column)) {
    return stableValue(parseJson(stored, stored)) === stableValue(parseJson(desired, desired))
  }
  if (stored instanceof Date || /(?:_at|^gmt_(?:create|modified))$/.test(column)) {
    return stableValue(stableDate(stored)) === stableValue(stableDate(desired))
  }
  if (stored === null || stored === undefined || desired === null || desired === undefined) {
    return (stored === null || stored === undefined) && (desired === null || desired === undefined)
  }
  if (typeof desired === 'number' || typeof desired === 'boolean') return Number(stored) === Number(desired)
  return String(stored) === String(desired)
}

async function syncRow(connection, sync, table, columns, values, options = {}) {
  const key = identityKey(table, values, columns)
  const seen = sync.seenKeys.get(table)
  if (seen.has(key)) throw new Error(`待写入的 ${table} 包含重复业务键`)
  seen.add(key)

  const rows = sync.rowsByTable.get(table)
  const existing = rows.get(key)
  const metric = sync.metrics.byTable[table]
  let rowId
  if (!existing) {
    const placeholders = columns.map(() => '?').join(', ')
    const [result] = await connection.execute(
      `INSERT INTO \`${table}\` (${columns.map(column => `\`${column}\``).join(', ')}) VALUES (${placeholders})`,
      values,
    )
    rowId = Number(result.insertId)
    sync.initialIds.get(table).add(String(rowId))
    metric.inserted += 1
    sync.metrics.inserted += 1
  } else {
    rowId = Number(existing.id)
    const ignoredColumns = new Set(options.ignoreComparisonColumns || [])
    const changed = columns.filter((column, index) => !ignoredColumns.has(column)
      && !storedValueMatches(column, existing[column], values[index], options.protectedColumns))
    if (changed.length) {
      // Normalized entities read their domain timestamp from this column. An
      // extension/version update must not silently replace it via ON UPDATE.
      const written = sync.normalized && columns.includes('gmt_modified') && !changed.includes('gmt_modified')
        ? [...changed, 'gmt_modified'] : changed
      await connection.execute(
        `UPDATE \`${table}\` SET ${written.map(column => `\`${column}\` = ?`).join(', ')} WHERE id = ?`,
        [...written.map(column => values[columns.indexOf(column)]), rowId],
      )
      for (const column of changed) metric.changedColumns[column] = (metric.changedColumns[column] || 0) + 1
      metric.updated += 1
      sync.metrics.updated += 1
    } else {
      metric.unchanged += 1
      sync.metrics.unchanged += 1
    }
  }

  const row = { ...existing, id: rowId }
  columns.forEach((column, index) => { row[column] = values[index] })
  rows.set(key, row)
  sync.retainedIds.get(table).add(String(rowId))
  return rowId
}

export async function readRelationalSyncRows(connection, expectedCounts = null) {
  const rowsByTable = new Map()
  for (const table of MANAGED_TABLES) {
    const rows = await readRowsById(connection, table, '*', RELATIONAL_READ_PAGE_SIZES[table] || 100)
    const byKey = new Map()
    for (const row of rows) {
      const key = identityKey(table, row)
      if (byKey.has(key)) throw new Error(`关系表 ${table} 存在重复业务键，拒绝写入`)
      byKey.set(key, row)
    }
    if (expectedCounts && Object.hasOwn(expectedCounts, table) && rows.length !== Number(expectedCounts[table])) {
      throw new Error(`关系表 ${table} 行数与 revision 状态不一致（期望 ${expectedCounts[table]}，实际 ${rows.length}）`)
    }
    rowsByTable.set(table, byKey)
  }
  return rowsByTable
}

function cloneRelationalRows(rowsByTable) {
  return new Map(MANAGED_TABLES.map(table => {
    const source = rowsByTable?.get(table)
    if (!source) throw new Error(`关系存储缓存缺少数据表 ${table}`)
    return [table, new Map(source)]
  }))
}

async function createRelationalSyncContext(connection, expectedCounts, cachedRowsByTable = null) {
  const context = {
    rowsByTable: cachedRowsByTable
      ? cloneRelationalRows(cachedRowsByTable)
      : await readRelationalSyncRows(connection, expectedCounts),
    initialIds: new Map(),
    initialCounts: new Map(),
    retainedIds: new Map(),
    seenKeys: new Map(),
    metrics: { inserted: 0, updated: 0, deleted: 0, unchanged: 0, byTable: {} },
  }
  for (const table of MANAGED_TABLES) {
    const rows = context.rowsByTable.get(table)
    const ids = new Set([...rows.values()].map(row => String(row.id)))
    if (expectedCounts && Object.hasOwn(expectedCounts, table) && rows.size !== Number(expectedCounts[table])) {
      throw new Error(`关系表 ${table} 行数与 revision 状态不一致（期望 ${expectedCounts[table]}，实际 ${rows.size}）`)
    }
    context.initialIds.set(table, ids)
    context.initialCounts.set(table, rows.size)
    context.retainedIds.set(table, new Set())
    context.seenKeys.set(table, new Set())
    context.metrics.byTable[table] = { inserted: 0, updated: 0, deleted: 0, unchanged: 0, changedColumns: {} }
  }
  return context
}

// Caller owns the transaction and either the legacy revision lock or the complete
// owner/entity lock scope when synchronizing an explicitly bounded write set.
export async function synchronizeRelationalMetadata(connection, value, expectedCounts, cachedRowsByTable = null, options = {}) {
  const sync = await createRelationalSyncContext(connection, expectedCounts, cachedRowsByTable)
  sync.normalized = Boolean(options.normalized)
  relationalSyncContexts.set(connection, sync)
  try {
    await insertAll(connection, value, options)
    for (const table of DATA_TABLES) {
      const staleIds = [...sync.initialIds.get(table)].filter(id => !sync.retainedIds.get(table).has(id))
      for (let offset = 0; offset < staleIds.length; offset += 500) {
        const batch = staleIds.slice(offset, offset + 500)
        await connection.execute(
          `DELETE FROM \`${table}\` WHERE id IN (${batch.map(() => '?').join(', ')})`,
          batch,
        )
      }
      sync.metrics.deleted += staleIds.length
      sync.metrics.byTable[table].deleted += staleIds.length
      const retained = sync.retainedIds.get(table)
      const rows = sync.rowsByTable.get(table)
      for (const [key, row] of rows) {
        if (!retained.has(String(row.id))) rows.delete(key)
      }
    }
    const counts = Object.fromEntries(MANAGED_TABLES.map(table => [
      table,
      Number(sync.initialCounts.get(table) || 0)
        + sync.metrics.byTable[table].inserted
        - sync.metrics.byTable[table].deleted,
    ]))
    return { counts, changes: sync.metrics, syncCache: sync.rowsByTable }
  } finally {
    relationalSyncContexts.delete(connection)
  }
}

async function getCounts(connection) {
  const counts = {}
  for (const table of MANAGED_TABLES) {
    const [rows] = await connection.query(`SELECT COUNT(*) AS total FROM \`${table}\``)
    counts[table] = Number(rows[0].total) || 0
  }
  return counts
}

async function insertAll(connection, value, options = {}) {
  const model = buildRelationalModel(value)
  const userIds = new Map(options.references?.userIds)
  const organizationIds = new Map(options.references?.organizationIds)
  const resourceIds = new Map(options.references?.resourceIds)
  const fileIds = new Map(options.references?.fileIds)
  const submissionIds = new Map()
  const userByLegacyId = new Map([...(options.references?.users || []), ...model.users.map(user => [String(user.id), user])])

  for (const user of model.users) {
    const id = text(user.id, 120)
    if (!id) throw new Error('关系迁移发现缺少用户 ID 的账号记录')
    const plan = {
      planId: user.planId || 'free', startedAt: user.planStartedAt || null,
      expiresAt: user.planExpiresAt || null, organizationId: user.organizationId || '',
      organizationRole: user.organizationRole || '', fileCleanup: user.fileCleanup || null,
    }
    const pk = await insertPayload(connection, 'kq_user',
      ['legacy_id', 'username', 'nickname', 'email', 'phone', 'avatar_url', 'provider', 'login_methods_json', 'status', 'plan_json', 'gmt_create', 'gmt_modified'],
      [id, text(user.username || id, 160), text(user.nickname || user.username || id, 80), user.email || null,
        user.phone || null, text(user.avatar || user.providerAvatar || '', 500) || null, text(user.provider, 40) || null,
        JSON.stringify(user.loginMethods || []), text(user.status || 'active', 20), JSON.stringify(plan),
        dateTime(user.createdAt, new Date().toISOString().slice(0, 23).replace('T', ' ')),
        dateTime(user.updatedAt || user.createdAt, new Date().toISOString().slice(0, 23).replace('T', ' '))],
      user, `user:${id}`, {}, {
        ignoreComparisonColumns: ['gmt_create', ...(!user.updatedAt ? ['gmt_modified'] : [])],
      })
    userIds.set(id, pk)
  }

  for (const organization of model.organizations) {
    const id = text(organization.id, 120)
    const ownerPk = userIds.get(String(organization.ownerUserId))
    if (!id || !ownerPk) throw new Error(`关系迁移发现团队 ${id || '(无 ID)'} 的负责人账号不存在`)
    const pk = await insertPayload(connection, 'kq_organization',
      ['legacy_id', 'slug', 'name', 'owner_user_id', 'plan_json', 'branding_json', 'row_version', 'gmt_create', 'gmt_modified'],
      [id, text(organization.slug || `legacy-${id}`, 80), text(organization.name || '未命名团队', 80), ownerPk,
        JSON.stringify({ id: organization.teamPlanId || '', startedAt: organization.teamPlanStartedAt || null,
          expiresAt: organization.teamPlanExpiresAt || null, permanent: Boolean(organization.teamPlanPermanent) }),
        JSON.stringify(organization.branding || {}), positiveInteger(organization.rowVersion),
        dateTime(organization.createdAt, new Date().toISOString().slice(0, 23).replace('T', ' ')),
        dateTime(organization.updatedAt || organization.createdAt, new Date().toISOString().slice(0, 23).replace('T', ' '))],
      organization, `organization:${id}`, {}, {
        ignoreComparisonColumns: ['gmt_create', ...(!organization.updatedAt ? ['gmt_modified'] : [])],
      })
    organizationIds.set(id, pk)
  }

  for (const organization of model.organizations) {
    const organizationPk = organizationIds.get(String(organization.id))
    for (const member of Array.isArray(organization.members) ? organization.members : []) {
      const userPk = userIds.get(String(member.userId || '')) || null
      const identity = member.userId ? `user:${member.userId}` : member.email ? `email:${String(member.email).toLowerCase()}`
        : member.phone ? `phone:${member.phone}` : `member:${member.id}`
      const legacyId = text(`${organization.id}:${member.id}`, 120)
      const contactSnapshot = { email: member.email || '', phone: member.phone || '', displayName: member.displayName || '', joinMessage: member.joinMessage || '' }
      const memberColumns =
        ['legacy_id', 'organization_id', 'user_id', 'identity_key', 'role', 'status', 'contact_snapshot_json',
          'invitation_token_hash', 'invitation_expires_at', 'requested_at', 'reviewed_at', 'joined_at']
      const memberValues = [legacyId, organizationPk, userPk, keyedDigest(`organization-member:${identity}`), text(member.role || 'member', 20),
          text(member.status || 'active', 20), JSON.stringify(protectCredential(JSON.stringify(contactSnapshot), `relational:member:${legacyId}`)),
          member.invitationToken ? keyedDigest(member.invitationToken) : null, dateTime(member.invitationExpiresAt),
          dateTime(member.requestedAt), dateTime(member.reviewedAt), dateTime(member.joinedAt || member.invitedAt)]
      const memberProtection = { contact_snapshot_json: comparisonForProtected(`member:${legacyId}`, contactSnapshot) }
      if (relationalSyncContexts.get(connection)?.normalized) await insertPayload(connection, 'kq_organization_member', memberColumns, memberValues, member, `member-entity:${legacyId}`, memberProtection, { position: organization.members.indexOf(member) })
      else await executeInsert(connection, 'kq_organization_member', memberColumns, memberValues, { protectedColumns: memberProtection })
    }
    for (const handover of Array.isArray(organization.ownershipHandovers) ? organization.ownershipHandovers : []) {
      const fromUserId = userIds.get(String(handover.fromUserId))
      const toUserId = userIds.get(String(handover.toUserId))
      if (!fromUserId || !toUserId) throw new Error(`关系迁移发现团队交接 ${handover.id} 的交接双方账号不存在`)
      const handoverColumns =
        ['legacy_id', 'organization_id', 'from_user_id', 'to_user_id', 'status', 'initiated_at', 'expires_at', 'resolved_at', 'resolved_by_user_id', 'reason'],
        handoverValues = [text(handover.id, 120), organizationPk, fromUserId, toUserId, text(handover.status || 'invalidated', 20),
          dateTime(handover.initiatedAt, new Date().toISOString().slice(0, 23).replace('T', ' ')), dateTime(handover.expiresAt),
          dateTime(handover.resolvedAt), userIds.get(String(handover.resolvedByUserId || '')) || null, text(handover.reason, 240) || null]
      if (relationalSyncContexts.get(connection)?.normalized) await insertPayload(connection, 'kq_ownership_handover', handoverColumns, handoverValues, handover, `handover-entity:${handover.id}`)
      else await executeInsert(connection, 'kq_ownership_handover', handoverColumns, handoverValues)
    }
  }

  for (const { kind, entity } of model.resources) {
    const id = text(entity.id || entity.token, 120)
    if (!id) throw new Error('关系迁移发现缺少业务 ID 的分享或收集任务')
    const ownerId = String(entity.ownerUserId || '')
    const organizationId = String(entity.teamOrganizationId || entity.brandingOrganizationId || '')
    const expiresAt = kind === 'collection' ? entity.deadline : entity.expiresAt
    const pk = await insertPayload(connection, 'kq_resource',
      ['legacy_id', 'resource_kind', 'owner_user_id', 'organization_id', 'team_resource', 'status', 'close_reason',
        'expires_at', 'deleted_at', 'trash_expires_at', 'deleted_by_user_id', 'row_version', 'gmt_create', 'gmt_modified'],
      [id, kind, userIds.get(ownerId) || null, organizationIds.get(organizationId) || null, entity.teamResource ? 1 : 0,
        ['closed', 'deleted', 'expired'].includes(entity.status) ? 'closed' : 'active', text(entity.closeReason, 40) || null,
        dateTime(expiresAt), dateTime(entity.deletedAt), dateTime(entity.trashExpiresAt),
        userIds.get(String(entity.deletedByUserId || '')) || null, positiveInteger(entity.rowVersion),
        dateTime(entity.createdAt, new Date().toISOString().slice(0, 23).replace('T', ' ')),
        dateTime(entity.updatedAt || entity.createdAt, new Date().toISOString().slice(0, 23).replace('T', ' '))],
      entity, `resource:${kind}:${id}`, {}, {
        ignoreComparisonColumns: ['gmt_create', ...(!entity.updatedAt ? ['gmt_modified'] : [])],
      })
    resourceIds.set(id, pk)

    if (kind === 'share') {
      const recipients = entity.deliveryRecipients || entity.recipients || []
      const notificationLog = entity.notificationLog || []
      await executeInsert(connection, 'kq_share_config',
        ['resource_id', 'share_code', 'manage_token_hash', 'password_hash', 'download_limit', 'download_count', 'recipient_policy_json', 'notification_log_json'],
        [pk, text(entity.code || id, 80), entity.manageToken ? keyedDigest(`manage:${entity.manageToken}`) : null,
          text(entity.passwordHash, 255) || null, entity.downloadLimit === null || entity.downloadLimit === undefined ? null : positiveInteger(entity.downloadLimit),
          positiveInteger(entity.downloadCount), JSON.stringify(protectCredential(JSON.stringify(recipients), `relational:recipients:${id}`)),
          JSON.stringify(protectCredential(JSON.stringify(notificationLog), `relational:notifications:${id}`))],
        { protectedColumns: {
          recipient_policy_json: comparisonForProtected(`recipients:${id}`, recipients),
          notification_log_json: comparisonForProtected(`notifications:${id}`, notificationLog),
        } })
      for (const [index, file] of (Array.isArray(entity.files) ? entity.files : []).entries()) {
        const filePk = await insertResourceFile(connection, file, index, entity, id, pk, userIds, fileIds)
        fileIds.set(`${id}:${index}`, filePk)
      }
    } else {
      const brandingId = String(entity.brandingOrganizationId || '')
      await executeInsert(connection, 'kq_collection_task',
        ['resource_id', 'public_token_hash', 'manage_token_hash', 'title', 'description', 'allowed_types_json',
          'materials_json', 'custom_fields_json', 'max_file_size_bytes', 'capacity_bytes', 'branding_organization_id'],
        [pk, keyedDigest(`collection-public:${entity.token || id}`), keyedDigest(`collection-manage:${entity.manageToken || id}`),
          text(entity.title || '未命名收集', 160), text(entity.description, 1000) || null,
          JSON.stringify(entity.allowedTypes || []), JSON.stringify(entity.materials || []), JSON.stringify(entity.customFields || []),
          positiveInteger(Number(entity.maxFileSizeMb || 0) * 1024 * 1024, null),
          entity.capacityBytes === null ? null : positiveInteger(entity.capacityBytes, null), organizationIds.get(brandingId) || null])
      for (const [submissionIndex, submission] of (Array.isArray(entity.submissions) ? entity.submissions : []).entries()) {
        const submissionLegacyId = text(`${id}:${submission.id || submissionIndex}`, 120)
        const participant = keyedDigest(`collection-participant:${submission.participantKey || `submission:${submission.id || submissionIndex}`}`)
        const fieldValues = submission.fieldValues || {}
        const submissionPk = await insertPayload(connection, 'kq_collection_submission',
          ['legacy_id', 'resource_id', 'participant_key', 'submitter_user_id', 'participant_name', 'submitter_name', 'field_values_json', 'submitted_at'],
          [submissionLegacyId, pk, participant, userIds.get(String(submission.submitterUserId || '')) || null,
            text(submission.participantName, 120) || null, text(submission.submitterName, 120) || null,
            JSON.stringify(protectCredential(JSON.stringify(fieldValues), `relational:field-values:${submissionLegacyId}`)),
            dateTime(submission.submittedAt)], submission, `submission:${submissionLegacyId}`,
          { field_values_json: comparisonForProtected(`field-values:${submissionLegacyId}`, fieldValues) }, { position: submissionIndex })
        submissionIds.set(`${id}:${submission.id || submissionIndex}`, submissionPk)
        for (const [fileIndex, file] of (Array.isArray(submission.files) ? submission.files : []).entries()) {
          const filePk = await insertResourceFile(connection, file, fileIndex, { ...entity, ownerUserId: submission.submitterUserId || entity.ownerUserId }, id, pk, userIds, fileIds)
          fileIds.set(`${id}:${submission.id || submissionIndex}:${fileIndex}`, filePk)
          await executeInsert(connection, 'kq_submission_file',
            ['submission_id', 'resource_file_id', 'material_id'],
            [submissionPk, filePk, text(file.materialId || submission.materialIds?.[fileIndex], 120) || null])
        }
      }
    }
  }

  for (const distribution of model.distributions) {
    const id = text(distribution.id, 120)
    const ownerPk = userIds.get(String(distribution.ownerUserId || ''))
    const resourcePk = resourceIds.get(String(distribution.shareId || ''))
    if (!ownerPk || !resourcePk) throw new Error(`关系迁移发现定向分发 ${id} 缺少所有者或对应分享`)
    const batchPk = await insertPayload(connection, 'kq_distribution_batch',
      ['legacy_id', 'owner_user_id', 'share_resource_id', 'idempotency_key', 'status', 'frozen_at'],
      [id, ownerPk, resourcePk, text(distribution.idempotencyKey || `legacy:${id}`, 200), 'published',
        dateTime(distribution.frozenAt || distribution.createdAt, new Date().toISOString().slice(0, 23).replace('T', ' '))],
      distribution, `distribution:${id}`, {}, {
        ignoreComparisonColumns: distribution.frozenAt || distribution.createdAt ? [] : ['frozen_at'],
      })
    const share = model.resources.find(item => item.kind === 'share' && String(item.entity.id) === String(distribution.shareId))?.entity
      || options.references?.shares?.find(item => String(item.id) === String(distribution.shareId))
    const claimedFiles = new Set()
    const claimedFileIds = new Set()
    const distributionRows = Array.isArray(distribution.rows) ? distribution.rows : []
    const sync = relationalSyncContexts.get(connection)
    const existingAssignments = sync?.rowsByTable.get('kq_distribution_assignment')
    const resourceFilesById = new Map([...(sync?.rowsByTable.get('kq_resource_file')?.values() || [])]
      .map(file => [String(file.id), file]))
    for (const [rowIndex, row] of distributionRows.entries()) {
      const recipientPk = userIds.get(String(row.userId || ''))
      if (!recipientPk) throw new Error(`关系迁移发现定向分发 ${id} 的收件人账号不存在`)
      const files = Array.isArray(share?.files) ? share.files : []
      const fileMatches = file => [file.name, file.originalName, path.basename(String(file.relativePath || ''))].includes(row.fileName)
      const fileKeyMatches = file => path.basename(String(file.relativePath || file.originalName || file.name || '')).match(/^([A-Za-z0-9][A-Za-z0-9._-]{0,79})__/)?.[1] === row.key
      let fileIndex = files.findIndex((file, index) => !claimedFiles.has(index) && fileMatches(file))
      if (fileIndex < 0) fileIndex = files.findIndex((file, index) => !claimedFiles.has(index) && fileKeyMatches(file))
      if (fileIndex < 0 && files.length === distributionRows.length && !claimedFiles.has(rowIndex)) fileIndex = rowIndex
      if (fileIndex < 0) fileIndex = files.findIndex((file, index) => !claimedFiles.has(index) && String(file.distributionRecipientUserId || '') === String(row.userId))
      let filePk = fileIndex >= 0 ? fileIds.get(`${distribution.shareId}:${fileIndex}`) : null
      if (!filePk && existingAssignments && sync) {
        // Automatic file cleanup removes the share's live file metadata, while a
        // published distribution keeps its historical file-name snapshot. Reuse
        // that assignment's existing file row so its foreign-key history survives.
        const previousAssignment = [...existingAssignments.values()].find(assignment =>
          String(assignment.batch_id) === String(batchPk)
          && String(assignment.recipient_user_id) === String(recipientPk)
          && String(assignment.file_name_snapshot) === String(row.fileName)
          && !claimedFileIds.has(String(assignment.resource_file_id)))
        const previousFile = previousAssignment && resourceFilesById.get(String(previousAssignment.resource_file_id))
        if (previousFile && String(previousFile.resource_id) === String(resourcePk)) {
          filePk = Number(previousFile.id)
          sync.retainedIds.get('kq_resource_file').add(String(previousFile.id))
        }
      }
      if (!filePk) throw new Error(`关系迁移无法将分发 ${id} 的文件 ${row.fileName} 关联到资源文件`)
      claimedFiles.add(fileIndex)
      claimedFileIds.add(String(filePk))
      const assignmentColumns = ['batch_id', 'resource_file_id', 'recipient_user_id', 'recipient_snapshot', 'file_name_snapshot']
      const assignmentValues = [batchPk, filePk, recipientPk, text(row.userId, 160), text(row.fileName, 240)]
      if (relationalSyncContexts.get(connection)?.normalized) await insertPayload(connection, 'kq_distribution_assignment', assignmentColumns, assignmentValues, row, `assignment-entity:${id}:${filePk}`, {}, { position: rowIndex })
      else await executeInsert(connection, 'kq_distribution_assignment', assignmentColumns, assignmentValues)
    }
  }

  for (const session of model.sessions) {
    const id = String(session.id || '')
    const userPk = userIds.get(String(session.user?.id || session.userId || ''))
    if (!id || !userPk) throw new Error('关系迁移发现缺少用户关联的登录会话')
    const storageId = keyedDigest(`session-id:${id}`).slice(0, 120)
    await insertPayload(connection, 'kq_auth_session',
      ['legacy_id', 'user_id', 'token_hash', 'provider_credential_ciphertext', 'expires_at', 'revoked_at'],
      [storageId, userPk, keyedDigest(`session-cookie:${id}`),
        session.apiWebToken ? protectCredential(session.apiWebToken, `session:${id}`) : null,
        dateTime(session.expiresAt, new Date().toISOString().slice(0, 23).replace('T', ' ')), dateTime(session.revokedAt)],
      session, `session:${storageId}`, {
        provider_credential_ciphertext: comparisonForProtected(`session:${id}`, session.apiWebToken || null, { prefix: false, parseJsonValue: false }),
      })
  }

  for (const code of model.verificationCodes) {
    const id = text(code.id, 120)
    await insertPayload(connection, 'kq_verification_code',
      ['legacy_id', 'scene', 'target_type', 'target_digest', 'code_hash', 'attempts', 'expires_at', 'consumed_at'],
      [id, text(code.scene || 'bind', 40), text(code.type || 'email', 20), keyedDigest(`verification-target:${String(code.target || '').toLowerCase()}`),
        text(code.codeHash, 80), positiveInteger(code.attempts), dateTime(code.expiresAt, new Date().toISOString().slice(0, 23).replace('T', ' ')), null],
      code, `verification:${id}`)
  }

  for (const order of model.upgradeOrders) {
    const id = text(order.id, 120)
    const userPk = userIds.get(String(order.userId || ''))
    if (!userPk) throw new Error(`关系迁移发现订单 ${id} 的下单用户不存在`)
    await insertPayload(connection, 'kq_upgrade_order',
      ['legacy_id', 'order_no', 'user_id', 'plan_id', 'status', 'amount', 'pay_type', 'remote_order_no',
        'entitlement_json', 'paid_at', 'remote_expire_at'],
      [id, text(order.orderNo || id, 40), userPk, text(order.planId || 'free', 40), text(order.status || 'expired', 20),
        order.amount === null ? null : Number(order.amount) || null, order.payType === null || order.payType === undefined ? null : positiveInteger(order.payType), text(order.remoteOrderNo, 80) || null,
        order.payment ? JSON.stringify(protectCredential(JSON.stringify(order.payment), `relational:order-payment:${id}`)) : null,
        dateTime(order.paidAt), dateTime(order.remoteExpireAt)], order, `upgrade-order:${id}`,
      order.payment ? { entitlement_json: comparisonForProtected(`order-payment:${id}`, order.payment) } : {})
  }

  for (const { userId, entity } of model.messages) {
    const userPk = userIds.get(String(userId))
    if (!userPk) throw new Error(`关系迁移发现用户 ${userId} 的站内消息没有对应账号`)
    const id = text(entity.id, 120)
    await insertPayload(connection, 'kq_message',
      ['legacy_id', 'user_id', 'category', 'event_type', 'title', 'body', 'action_type', 'action_id', 'action_url', 'read_at'],
      [id, userPk, text(entity.category || 'system', 40), text(entity.eventType, 60) || null, text(entity.title || '鲲穹消息', 200),
        text(entity.body, 1000) || null, text(entity.actionType, 40) || null, text(entity.actionId, 120) || null,
        text(entity.actionUrl, 500) || null, entity.unread === false ? dateTime(entity.readAt || entity.createdAt) : dateTime(entity.readAt)],
      entity, `message:${userId}:${id}`)
  }

  for (const { userId, entity } of model.notificationSettings) {
    const userPk = userIds.get(String(userId))
    if (!userPk) throw new Error(`关系迁移发现用户 ${userId} 的通知设置没有对应账号`)
    const user = userByLegacyId.get(String(userId))
    await insertPayload(connection, 'kq_user_setting',
      ['user_id', 'notification_json', 'file_cleanup_json'],
      [userPk, JSON.stringify(entity || {}), JSON.stringify(user?.fileCleanup || { enabled: false, days: 3 })],
      { notification: entity || {}, fileCleanup: user?.fileCleanup || null }, `user-setting:${userId}`)
  }

  for (const { userId, entity } of model.records) {
    const userPk = userIds.get(String(userId))
    if (!userPk) throw new Error(`关系迁移发现用户 ${userId} 的账号记录没有对应账号`)
    const resourceLegacyId = String(entity.shareId || entity.collectionToken || '')
    const recordId = text(`${userId}:${entity.id}`, 200)
    const recordSnapshot = encodeProtected(entity, `account-record:${recordId}`)
    await executeInsert(connection, 'kq_account_record',
      ['legacy_id', 'user_id', 'scope', 'resource_kind', 'resource_id', 'resource_legacy_id', 'status', 'record_snapshot_json', 'gmt_create', 'gmt_modified'],
      [text(recordId, 200), userPk, text(entity.scope || 'my_sent', 30), text(entity.kind || 'share', 30),
        resourceIds.get(resourceLegacyId) || null, text(resourceLegacyId, 120) || null, text(entity.status, 40) || null,
        recordSnapshot, dateTime(entity.createdAt, new Date().toISOString().slice(0, 23).replace('T', ' ')),
        dateTime(entity.updatedAt || entity.createdAt, new Date().toISOString().slice(0, 23).replace('T', ' '))],
      { protectedColumns: { record_snapshot_json: comparisonForProtected(`account-record:${recordId}`, entity) },
        ignoreComparisonColumns: ['gmt_create', 'gmt_modified'] })
  }

  for (const { key, entity } of model.guestUsage) {
    const digest = keyedDigest(`guest-usage:${key}`)
    await insertPayload(connection, 'kq_guest_usage',
      ['identity_digest', 'used_bytes', 'upload_count', 'first_used_at', 'last_used_at'],
      [digest, positiveInteger(entity.bytes), positiveInteger(entity.uploads),
        dateTime(entity.firstAt, new Date().toISOString().slice(0, 23).replace('T', ' ')),
        dateTime(entity.lastAt, new Date().toISOString().slice(0, 23).replace('T', ' '))],
      { key, entity }, `guest-usage:${digest}`)
  }

  for (const setting of model.systemSettings) {
    if (options.systemKeys && !options.systemKeys.has(setting.key)) continue
    await executeInsert(connection, 'kq_system_setting',
      ['setting_key', 'setting_value_json'], [text(setting.key, 100), JSON.stringify(setting.value)])
  }

  return relationalSyncContexts.has(connection) ? null : getCounts(connection)
}

async function insertResourceFile(connection, file, index, entity, resourceId, resourcePk, userIds, fileIds) {
  const ownerKey = text(file.storageOwnerId || entity.ownerUserId || `legacy:${resourceId}`, 160)
  const storedName = String(file.storedName || path.basename(String(file.path || '')) || file.name || `file-${index + 1}`)
  const storageKey = text(`${ownerKey}/${storedName}`, 500)
  const id = stableFileId(resourceId, file, index)
  const ownerPk = userIds.get(String(file.ownerUserId || entity.ownerUserId || '')) || null
  const sha = /^[a-f0-9]{64}$/i.test(file.sha256 || file.contentSha256 || '') ? String(file.sha256 || file.contentSha256) : null
  const normalized = Boolean(relationalSyncContexts.get(connection)?.normalized)
  const pk = await insertPayload(connection, 'kq_resource_file',
    ['legacy_id', 'resource_id', 'owner_user_id', 'storage_owner_key', 'file_name', 'original_file_name', 'storage_key',
      'size_bytes', 'mime_type', 'content_sha256', 'scan_status', 'scanned_at', ...(normalized ? ['path_digest', 'disk_key_digest'] : [])],
    [id, resourcePk, ownerPk, ownerKey, text(file.name || file.originalName || storedName, 240), text(file.originalName, 240) || null,
      storageKey, positiveInteger(file.size), text(file.mimeType || file.mimetype, 160) || null, sha,
      text(file.reviewStatus || file.scanStatus, 30) || null, dateTime(file.scannedAt), ...(normalized ? [filePathDigest(file), diskKeyDigest(ownerKey, storedName)] : [])],
    file, `resource-file:${resourceId}:${id}`, {}, { position: index })
  return pk
}

async function assertCounts(connection, expected) {
  const actual = await getCounts(connection)
  for (const [table, count] of Object.entries(expected || {})) {
    if (actual[table] !== Number(count)) {
      throw new Error(`关系表 ${table} 行数与已提交迁移校验不一致（期望 ${count}，实际 ${actual[table]}）`)
    }
  }
}

export async function loadRelationalMetadataFromConnection(connection, state = null, rowsByTable = null) {
  const currentState = state || await readRelationalState(connection)
  if (!currentState) return null
  if (currentState.schemaVersion >= 3) {
    const source = rowsByTable || await readRelationalSyncRows(connection)
    const metadata = { users: {}, organizations: {}, shares: [], collections: [], distributions: [], sessions: [], verificationCodes: [], upgradeOrders: [], messages: {}, notificationSettings: {}, records: {}, guestUsage: {}, systemConfig: {}, collectionTemplates: [], auditLogs: [] }
    hydrateRows(source, metadata, decodeProtected)
    return { metadata, revision: currentState.revision, state: { ...currentState, counts: Object.fromEntries([...source].map(([table, rows]) => [table, rows.size])) } }
  }
  if (rowsByTable) {
    for (const [table, count] of Object.entries(currentState.counts)) {
      if (rowsByTable.get(table)?.size !== Number(count)) {
        throw new Error(`关系表 ${table} 行数与已提交迁移校验不一致`)
      }
    }
  } else {
    await assertCounts(connection, currentState.counts)
  }
  const readTable = (table, columns) => rowsByTable
    ? [...rowsByTable.get(table).values()]
    : readRowsById(connection, table, columns, RELATIONAL_READ_PAGE_SIZES[table] || 100)
  const userRows = await readTable('kq_user', ['legacy_id', 'entity_payload_json'])
  const organizationRows = await readTable('kq_organization', ['legacy_id', 'entity_payload_json'])
  const resourceRows = await readTable('kq_resource', ['legacy_id', 'resource_kind', 'entity_payload_json'])
  const distributionRows = await readTable('kq_distribution_batch', ['legacy_id', 'entity_payload_json'])
  const sessionRows = await readTable('kq_auth_session', ['legacy_id', 'entity_payload_json'])
  const verificationRows = await readTable('kq_verification_code', ['legacy_id', 'entity_payload_json'])
  const upgradeRows = await readTable('kq_upgrade_order', ['legacy_id', 'entity_payload_json'])
  const messageRows = await readTable('kq_message', ['user_id', 'legacy_id', 'entity_payload_json'])
  const settingRows = await readTable('kq_user_setting', ['user_id', 'notification_json', 'entity_payload_json'])
  const recordRows = await readTable('kq_account_record', ['user_id', 'legacy_id', 'record_snapshot_json'])
  const guestRows = await readTable('kq_guest_usage', ['identity_digest', 'entity_payload_json'])
  const systemRows = await readTable('kq_system_setting', ['setting_key', 'setting_value_json'])
  const userByPk = new Map(userRows.map(row => [String(row.id), String(row.legacy_id)]))
  const system = Object.fromEntries(systemRows.map(row => [row.setting_key, structuredClone(parseJson(row.setting_value_json, {}))]))
  const metadata = {
    users: {}, organizations: {}, shares: [], collections: [], distributions: [], sessions: [],
    verificationCodes: [], upgradeOrders: [], messages: {}, notificationSettings: {}, records: {},
    guestUsage: {}, systemConfig: system.systemConfig || {},
    collectionTemplates: Array.isArray(system.collectionTemplates) ? system.collectionTemplates : [],
    auditLogs: [],
    ...(system.legacyExtraMetadata && typeof system.legacyExtraMetadata === 'object' ? system.legacyExtraMetadata : {}),
  }
  for (const row of userRows) {
    const user = decodeProtected(row.entity_payload_json, `user:${row.legacy_id}`)
    metadata.users[user.id] = user
  }
  for (const row of organizationRows) {
    const organization = decodeProtected(row.entity_payload_json, `organization:${row.legacy_id}`)
    metadata.organizations[organization.id] = organization
  }
  for (const row of resourceRows) {
    const entity = decodeProtected(row.entity_payload_json, `resource:${row.resource_kind}:${row.legacy_id}`)
    metadata[row.resource_kind === 'collection' ? 'collections' : 'shares'].push(entity)
  }
  for (const row of distributionRows) metadata.distributions.push(decodeProtected(row.entity_payload_json, `distribution:${row.legacy_id}`))
  for (const row of sessionRows) metadata.sessions.push(decodeProtected(row.entity_payload_json, `session:${row.legacy_id}`))
  for (const row of verificationRows) metadata.verificationCodes.push(decodeProtected(row.entity_payload_json, `verification:${row.legacy_id}`))
  for (const row of upgradeRows) metadata.upgradeOrders.push(decodeProtected(row.entity_payload_json, `upgrade-order:${row.legacy_id}`))
  for (const row of messageRows) {
    const ownerId = userByPk.get(String(row.user_id))
    const message = decodeProtected(row.entity_payload_json, `message:${ownerId}:${row.legacy_id}`)
    if (!metadata.messages[ownerId]) metadata.messages[ownerId] = []
    metadata.messages[ownerId].push(message)
  }
  for (const row of settingRows) {
    const ownerId = userByPk.get(String(row.user_id))
    const payload = decodeProtected(row.entity_payload_json, `user-setting:${ownerId}`)
    if (payload.notification && Object.keys(payload.notification).length) metadata.notificationSettings[ownerId] = payload.notification
  }
  for (const row of recordRows) {
    const ownerId = userByPk.get(String(row.user_id))
    if (!metadata.records[ownerId]) metadata.records[ownerId] = []
    metadata.records[ownerId].push(decodeProtected(row.record_snapshot_json, `account-record:${row.legacy_id}`))
  }
  for (const row of guestRows) {
    const payload = decodeProtected(row.entity_payload_json, `guest-usage:${row.identity_digest}`)
    metadata.guestUsage[payload.key] = payload.entity
  }
  return { metadata, revision: currentState.revision, state: currentState }
}

export async function loadRelationalMetadata(pool) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const state = await readRelationalState(connection)
    const rowsByTable = state ? await readRelationalSyncRows(connection, state.schemaVersion >= 3 ? null : state.counts) : null
    const loaded = state ? await loadRelationalMetadataFromConnection(connection, state, rowsByTable) : null
    await connection.commit()
    if (state && state.schemaVersion < 3) relationalSyncCaches.set(pool, { revision: state.revision, rowsByTable })
    return loaded
  } catch (error) {
    await connection.rollback().catch(() => {})
    throw error
  } finally { connection.release() }
}

export async function replaceRelationalMetadata(connection, value) {
  // Full replacement is reserved for the one-time initial migration only.
  await assertUninitializedRelationalTablesEmpty(connection)
  for (const table of DATA_TABLES) await connection.query(`DELETE FROM \`${table}\``)
  return insertAll(connection, value)
}

export async function assertUninitializedRelationalTablesEmpty(connection) {
  for (const table of DATA_TABLES) {
    const [rows] = await connection.query(`SELECT 1 AS present FROM \`${table}\` LIMIT 1`)
    if (rows.length) throw new Error(`关系表 ${table} 已有记录但缺少迁移状态，已停止首次导入以避免覆盖数据`)
  }
}

// Read-only deployment preflight, before the running container is replaced.
export async function inspectRelationalMigrationTarget(connection) {
  await connection.beginTransaction()
  try {
    const [tables] = await connection.query('SELECT TABLE_NAME AS table_name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()')
    const available = new Set(tables.map(row => row.table_name))
    const state = available.has(STATE_TABLE) ? await readRelationalState(connection) : null
    if (state) {
      await loadRelationalMetadataFromConnection(connection, state)
      await connection.commit()
      return { initialized: true, revision: state.revision, managedTableCount: Object.keys(state.counts).length }
    }
    for (const table of DATA_TABLES.filter(name => available.has(name))) {
      const [rows] = await connection.query(`SELECT 1 AS present FROM \`${table}\` LIMIT 1`)
      if (rows.length) throw new Error(`关系表 ${table} 已有记录但缺少迁移状态，已停止部署以避免覆盖数据`)
    }
    await connection.commit()
    return { initialized: false, managedTableCount: 0 }
  } catch (error) {
    await connection.rollback().catch(() => {})
    throw error
  }
}

export async function initializeRelationalMetadata(pool, source, sourceSnapshotRevision = 0) {
  const connection = await pool.getConnection()
  let locked = false
  try {
    const [lockRows] = await connection.execute('SELECT GET_LOCK(?, 30) AS acquired', ['kunqiong-relational-data-v1'])
    if (Number(lockRows?.[0]?.acquired) !== 1) throw new Error('无法获得关系数据迁移锁')
    locked = true
    const existing = await readRelationalState(connection)
    if (existing) {
      await connection.beginTransaction()
      try {
        const current = await readRelationalState(connection)
        if (!current) throw new Error('关系存储状态行在迁移期间消失，已停止启动')
        const rowsByTable = await readRelationalSyncRows(connection, current.schemaVersion >= 3 ? null : current.counts)
        const loaded = await loadRelationalMetadataFromConnection(connection, current, rowsByTable)
        await connection.commit()
        if (current.schemaVersion < 3) relationalSyncCaches.set(pool, { revision: current.revision, rowsByTable })
        return { ...loaded, alreadyInitialized: true }
      } catch (error) {
        await connection.rollback().catch(() => {})
        throw error
      }
    }
    await connection.beginTransaction()
    try {
      const counts = await replaceRelationalMetadata(connection, source)
      const expectedCounts = countRelationalModelRows(source)
      for (const [table, count] of Object.entries(expectedCounts)) {
        if (Number(counts[table]) !== count) throw new Error(`关系迁移 ${table} 的源数据行数与导入结果不一致，已回滚`)
      }
      const rowsByTable = await readRelationalSyncRows(connection, counts)
      await connection.execute(
        `INSERT INTO ${STATE_TABLE} (state_key, revision, schema_version, source_snapshot_revision, record_counts_json)
         VALUES (?, 1, 1, ?, ?)`,
        ['metadata', positiveInteger(sourceSnapshotRevision), JSON.stringify(counts)],
      )
      await connection.commit()
      relationalSyncCaches.set(pool, { revision: 1, rowsByTable })
      return { metadata: source, revision: 1, state: { revision: 1, schemaVersion: 1, sourceSnapshotRevision, counts }, alreadyInitialized: false }
    } catch (error) {
      await connection.rollback().catch(() => {})
      throw error
    }
  } finally {
    if (locked) {
      try { await connection.execute('SELECT RELEASE_LOCK(?)', ['kunqiong-relational-data-v1']) } catch {}
    }
    connection.release()
  }
}

export async function commitRelationalMetadata(pool, value, expectedRevision, mergeConflict, options = {}) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const state = await readRelationalState(connection, true)
    if (!state) throw new Error('关系存储迁移标记缺失，拒绝将业务数据写回快照模式')
    if (state.schemaVersion >= 3) throw new Error('数据库已升级为实体事务写入，禁止旧版本整库快照保存；请恢复匹配的数据库备份后再回退应用')
    let next = value
    let conflict = false
    let rowsByTable = null
    if (state.revision !== expectedRevision) {
      const loaded = await loadRelationalMetadataFromConnection(connection, state)
      next = mergeConflict(loaded.metadata, value, state.revision === expectedRevision + 1)
      conflict = true
    }
    const cached = relationalSyncCaches.get(pool)
    const cacheIsCurrent = cached?.revision === state.revision
      && MANAGED_TABLES.every(table => cached.rowsByTable.get(table)?.size === Number(state.counts[table]))
    rowsByTable = cacheIsCurrent ? cached.rowsByTable : await readRelationalSyncRows(connection, state.counts)
    const { counts, changes, syncCache } = await synchronizeRelationalMetadata(connection, next, state.counts, rowsByTable)
    const nextRevision = state.revision + 1
    const sourceSnapshotRevision = Number.isSafeInteger(options.sourceSnapshotRevision)
      && options.sourceSnapshotRevision >= state.sourceSnapshotRevision
      ? options.sourceSnapshotRevision
      : state.sourceSnapshotRevision
    const [revisionResult] = await connection.execute(
      `UPDATE ${STATE_TABLE}
          SET revision = ?, source_snapshot_revision = ?, record_counts_json = ?
        WHERE state_key = ? AND revision = ?`,
      [nextRevision, sourceSnapshotRevision, JSON.stringify(counts), 'metadata', state.revision],
    )
    if (Number(revisionResult.affectedRows) !== 1) throw new Error('关系存储 revision 已变化，本次事务已回滚')
    await connection.commit()
    relationalSyncCaches.set(pool, { revision: nextRevision, rowsByTable: syncCache })
    return { metadata: next, revision: nextRevision, conflict, changes }
  } catch (error) {
    await connection.rollback().catch(() => {})
    throw error
  } finally { connection.release() }
}
