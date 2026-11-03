// 本机数据库层压测：在隔离 MySQL 实例上使用真实关系表结构 + 规模化合成数据，
// 覆盖点查、分页、聚合、写入事务、行锁竞争、连接池饱和与死锁检测。
// 只连接显式指定的隔离实例（默认 127.0.0.1:3308），不读 .env 中的业务库配置。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import mysql from 'mysql2/promise'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.resolve(process.env.PERFORMANCE_DB_EVIDENCE_DIR || path.join(root, 'docs/performance-evidence/db-stress'))
fs.mkdirSync(output, { recursive: true })
const logLines = []
function log(line) { const text = String(line); logLines.push(text); console.log(text) }

const host = process.env.PERFORMANCE_DB_HOST || '127.0.0.1'
const port = Number(process.env.PERFORMANCE_DB_PORT || 3308)
const user = process.env.PERFORMANCE_DB_USER || 'root'
const password = process.env.PERFORMANCE_DB_PASSWORD || 'KqPerfDb_2026_root'
const database = process.env.PERFORMANCE_DB_NAME || 'kq_perf_stress'
const stageSeconds = Number(process.env.PERFORMANCE_DB_STAGE_SECONDS || 10)
const keepDatabase = process.env.PERFORMANCE_DB_KEEP === 'true'
const seedScale = Number(process.env.PERFORMANCE_DB_SEED_SCALE || 1)
if (!(stageSeconds >= 3 && stageSeconds <= 60)) throw new Error('PERFORMANCE_DB_STAGE_SECONDS 必须在 3-60 之间')

const scale = (value) => Math.max(1, Math.round(value * seedScale))
const SCALE = {
  users: scale(5000),
  sessions: scale(5000),
  resources: scale(20000),
  shareConfigs: scale(15000),
  files: scale(40000),
  records: scale(200000),
  messages: scale(100000),
  audits: scale(200000),
}

// 确定性伪随机，保证同一 seed 下数据分布可复现。
function mulberry32(seed) {
  let value = seed >>> 0
  return () => {
    value = (value + 0x6d2b79f5) >>> 0
    let next = Math.imul(value ^ (value >>> 15), 1 | value)
    next = (next + Math.imul(next ^ (next >>> 7), 61 | next)) ^ next
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296
  }
}
const random = mulberry32(20261102)
const pick = (list, roll) => list[Math.floor(roll * list.length) % list.length]
const hex = (value) => crypto.createHash('sha256').update(String(value)).digest('hex')
const isoOffset = (daysAgo, minutesAgo = 0) => new Date(Date.now() - daysAgo * 86400000 - minutesAgo * 60000)
const fmt = (value) => value.toISOString().slice(0, 23).replace('T', ' ')

const STATUS_KEYS = [
  'Questions', 'Com_select', 'Com_insert', 'Com_update', 'Com_delete', 'Com_commit', 'Com_rollback',
  'Innodb_rows_read', 'Innodb_rows_inserted', 'Innodb_rows_updated', 'Innodb_rows_deleted',
  'Innodb_row_lock_waits', 'Innodb_row_lock_time', 'Innodb_deadlocks',
  'Threads_connected', 'Threads_running', 'Innodb_buffer_pool_read_requests', 'Innodb_buffer_pool_reads',
  'Innodb_buffer_pool_pages_free', 'Innodb_buffer_pool_pages_total', 'Queries', 'Uptime',
]

let admin
let pool
const results = {
  executedAt: new Date().toISOString(),
  target: { host, port, user: '*', database, source: 'isolated Docker MySQL' },
  options: { stageSeconds, seedScale },
  dataScale: SCALE,
  mysql: null,
  tables: [],
  explains: [],
  stages: [],
  connectionPool: null,
  deadlockTest: null,
  errors: [],
  cleanup: null,
}

async function queryStatus(connection) {
  const [rows] = await connection.query('SHOW GLOBAL STATUS')
  const map = new Map(rows.map(row => [row.Variable_name, row.Value]))
  return Object.fromEntries(STATUS_KEYS.map(key => [key, Number(map.get(key) ?? 0)]))
}
function statusDelta(before, after) {
  const delta = {}
  for (const key of STATUS_KEYS) delta[key] = Number(after[key] || 0) - Number(before[key] || 0)
  return delta
}
function percentile(values, p) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] * 100) / 100
}
function summary(values) {
  return { count: values.length, p50Ms: percentile(values, 0.5), p95Ms: percentile(values, 0.95), p99Ms: percentile(values, 0.99), maxMs: percentile(values, 1) }
}

async function createSchema() {
  const schemaSql = fs.readFileSync(path.join(root, 'docs/数据库设计-2026-10-29/03-现有功能关系表设计.sql'), 'utf8')
  // 基础关系表：直接执行应用自身的结构文件。
  await pool.query(schemaSql.replace(/^\s*--.*$/gm, ''))
  // 应用在真实部署里由 ensureRelationalStoreSchema / migrateNormalizedSchema 补齐的增量结构。
  const extra = [
    `CREATE TABLE IF NOT EXISTS kq_relational_store_state (
      state_key VARCHAR(40) COLLATE utf8mb4_bin NOT NULL,
      revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
      schema_version INT UNSIGNED NOT NULL DEFAULT 1,
      source_snapshot_revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
      record_counts_json JSON NOT NULL,
      gmt_create DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      gmt_modified DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (state_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS kq_write_lock (
      lock_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS kq_resource_usage (
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ]
  const payloadTables = ['kq_user', 'kq_organization', 'kq_resource', 'kq_resource_file', 'kq_collection_submission', 'kq_distribution_batch', 'kq_auth_session', 'kq_verification_code', 'kq_upgrade_order', 'kq_message', 'kq_user_setting', 'kq_guest_usage', 'kq_audit_log']
  for (const table of payloadTables) extra.push(`ALTER TABLE \`${table}\` ADD COLUMN entity_payload_json JSON NULL`)
  for (const table of ['kq_user', 'kq_organization', 'kq_resource', 'kq_distribution_batch', 'kq_auth_session', 'kq_verification_code', 'kq_upgrade_order', 'kq_message', 'kq_user_setting', 'kq_account_record', 'kq_guest_usage', 'kq_system_setting']) extra.push(`ALTER TABLE \`${table}\` ADD COLUMN write_version BIGINT UNSIGNED NOT NULL DEFAULT 0`)
  extra.push(`ALTER TABLE kq_resource_file ADD COLUMN path_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL`)
  extra.push(`ALTER TABLE kq_resource_file ADD COLUMN disk_key_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL`)
  for (const [table, index, columns] of [
    ['kq_resource_file', 'idx_file_path', 'path_digest, resource_id'],
    ['kq_resource_file', 'idx_file_disk_key', 'disk_key_digest'],
    ['kq_account_record', 'idx_records_owner_page', 'user_id, id'],
    ['kq_message', 'idx_messages_owner_page', 'user_id, id'],
    ['kq_resource', 'idx_resources_team_page', 'organization_id, team_resource, deleted_at, id'],
    ['kq_audit_log', 'idx_audit_time', 'gmt_create, id'],
  ]) extra.push(`ALTER TABLE \`${table}\` ADD INDEX \`${index}\` (${columns})`)
  for (const statement of extra) await pool.query(statement)
}

async function insertBatches(table, columns, rows, batchSize = 1000) {
  const placeholders = `(${columns.map(() => '?').join(',')})`
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize)
    await pool.query(`INSERT INTO \`${table}\` (${columns.map(column => `\`${column}\``).join(',')}) VALUES ${batch.map(() => placeholders).join(',')}`, batch.flat())
  }
}

async function seed() {
  const started = performance.now()
  log(`SEED start users=${SCALE.users} resources=${SCALE.resources} files=${SCALE.files} records=${SCALE.records} messages=${SCALE.messages} audits=${SCALE.audits}`)
  const now = new Date()
  const expires = new Date(Date.now() + 30 * 86400000)

  const users = []
  for (let index = 1; index <= SCALE.users; index++) {
    users.push([index, `perf-user-${index}`, `perf-user-${index}`, `压测用户${index}`, index % 7 === 0 ? `perf${index}@example.test` : null, 'active', JSON.stringify({ id: index % 4 ? 'free' : 'member', since: '2026-01-01' }), isoOffset(200 - (index % 180)), isoOffset(10), 0])
  }
  await insertBatches('kq_user', ['id', 'legacy_id', 'username', 'nickname', 'email', 'status', 'plan_json', 'gmt_create', 'gmt_modified', 'write_version'], users)

  const sessions = []
  for (let index = 1; index <= SCALE.sessions; index++) {
    sessions.push([index, `perf-session-${index}`, (index % SCALE.users) + 1, hex(`session-${index}`), fmt(expires), isoOffset(1), isoOffset(1)])
  }
  await insertBatches('kq_auth_session', ['id', 'legacy_id', 'user_id', 'token_hash', 'expires_at', 'gmt_create', 'gmt_modified'], sessions)

  const shareCodes = []
  const resources = []
  for (let index = 1; index <= SCALE.resources; index++) {
    const kind = index <= SCALE.shareConfigs ? 'share' : 'collection'
    const owner = (index % SCALE.users) + 1
    resources.push([index, `perf-resource-${index}`, kind, owner, null, 0, 'active', fmt(expires), isoOffset(120 - (index % 100)), isoOffset(5), 0])
    if (kind === 'share') shareCodes.push([index, index, `PF${String(index).padStart(7, '0')}`, hex(`manage-${index}`), 0, isoOffset(120 - (index % 100)), isoOffset(5)])
  }
  await insertBatches('kq_resource', ['id', 'legacy_id', 'resource_kind', 'owner_user_id', 'organization_id', 'team_resource', 'status', 'expires_at', 'gmt_create', 'gmt_modified', 'write_version'], resources)
  await insertBatches('kq_share_config', ['id', 'resource_id', 'share_code', 'manage_token_hash', 'download_count', 'gmt_create', 'gmt_modified'], shareCodes)

  const files = []
  const usage = new Map()
  for (let index = 1; index <= SCALE.files; index++) {
    const resource = (index % SCALE.resources) + 1
    const size = 4096 + Math.floor(random() * 8 * 1024 * 1024)
    files.push([index, `perf-file-${index}`, resource, (resource % SCALE.users) + 1, `user-${(resource % SCALE.users) + 1}`, `压测文件${index}.bin`, `压测文件${index}.bin`, `users/${resource}/perf-file-${index}.bin`, size, 'application/octet-stream', hex(`file-${index}`), 'clean', isoOffset(90 - (index % 80)), isoOffset(5)])
    const entry = usage.get(resource) || { bytes: 0, count: 0 }
    entry.bytes += size
    entry.count += 1
    usage.set(resource, entry)
  }
  await insertBatches('kq_resource_file', ['id', 'legacy_id', 'resource_id', 'owner_user_id', 'storage_owner_key', 'file_name', 'original_file_name', 'storage_key', 'size_bytes', 'mime_type', 'content_sha256', 'scan_status', 'gmt_create', 'gmt_modified'], files)
  const usageRows = [...usage.entries()].map(([resource, entry]) => [resource, entry.bytes, entry.count, 1])
  await insertBatches('kq_resource_usage', ['resource_id', 'live_bytes', 'live_file_count', 'live_resource_count'], usageRows)

  const records = []
  for (let index = 1; index <= SCALE.records; index++) {
    const owner = (index % SCALE.users) + 1
    const resource = (index % SCALE.resources) + 1
    records.push([index, `perf-user-${owner}:record-${index}`, owner, index % 3 ? 'my_sent' : 'my_received', 'share', resource, `perf-resource-${resource}`, 'active', JSON.stringify({ title: `记录${index}`, bytes: index * 37 }), isoOffset(index % 90, index % 1440), isoOffset(1)])
  }
  await insertBatches('kq_account_record', ['id', 'legacy_id', 'user_id', 'scope', 'resource_kind', 'resource_id', 'resource_legacy_id', 'status', 'record_snapshot_json', 'gmt_create', 'gmt_modified'], records)

  const messages = []
  for (let index = 1; index <= SCALE.messages; index++) {
    const owner = (index % SCALE.users) + 1
    messages.push([index, `perf-message-${index}`, owner, 'system', 'share_received', `站内消息${index}`, `消息正文${index}`, index % 4 === 0 ? null : fmt(isoOffset(3)), isoOffset(index % 60, index % 1440), isoOffset(1)])
  }
  await insertBatches('kq_message', ['id', 'legacy_id', 'user_id', 'category', 'event_type', 'title', 'body', 'read_at', 'gmt_create', 'gmt_modified'], messages)

  const audits = []
  const actions = ['GET /api/account/records', 'GET /api/account/team/overview', 'POST /api/shares', 'GET /api/shares/token', 'GET /api/collections']
  for (let index = 1; index <= SCALE.audits; index++) {
    const owner = (index % SCALE.users) + 1
    audits.push([index, `perf-audit-${index}`, index % 9 === 0 ? 'critical' : 'access', pick(actions, random()), '200', Math.floor(random() * 40), `perf-user-${owner}`, null, '127.0.0.1', JSON.stringify({ release: 'performance-db-stress', requestId: `seed-${index}` }), isoOffset(index % 30, index % 1440), isoOffset(index % 30, index % 1440)])
  }
  await insertBatches('kq_audit_log', ['id', 'legacy_id', 'event_type', 'action', 'result_status', 'duration_ms', 'user_legacy_id', 'target_legacy_id', 'ip_address', 'details_json', 'gmt_create', 'gmt_modified'], audits)

  const tables = ['kq_user', 'kq_auth_session', 'kq_resource', 'kq_share_config', 'kq_resource_file', 'kq_resource_usage', 'kq_account_record', 'kq_message', 'kq_audit_log']
  for (const table of tables) await pool.query(`ANALYZE TABLE \`${table}\``)
  results.seed = { seconds: Math.round((performance.now() - started) / 100) / 10, tables: Object.fromEntries(tables.map(table => [table, table === 'kq_user' ? SCALE.users : table === 'kq_auth_session' ? SCALE.sessions : table === 'kq_resource' ? SCALE.resources : table === 'kq_share_config' ? SCALE.shareConfigs : table === 'kq_resource_file' ? SCALE.files : table === 'kq_resource_usage' ? usageRows.length : table === 'kq_account_record' ? SCALE.records : table === 'kq_message' ? SCALE.messages : SCALE.audits])) }
  log(`SEED done in ${results.seed.seconds}s`)
}

async function collectTables() {
  const [rows] = await pool.query(`SELECT TABLE_NAME AS name, TABLE_ROWS AS tableRows, ROUND((DATA_LENGTH + INDEX_LENGTH)/1024/1024, 2) AS sizeMiB
    FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY (DATA_LENGTH + INDEX_LENGTH) DESC`, [database])
  results.tables = rows.map(row => ({ name: row.name, tableRows: Number(row.tableRows), sizeMiB: Number(row.sizeMiB) }))
}

async function collectMysqlSettings() {
  const [settings] = await pool.query(`SELECT @@version AS version, @@innodb_buffer_pool_size/1024/1024 AS bufferPoolMiB,
    @@innodb_log_file_size/1024/1024 AS logFileMiB, @@max_connections AS maxConnections,
    @@innodb_flush_log_at_trx_commit AS flushLogAtTrxCommit, @@transaction_isolation AS isolation,
    @@innodb_io_capacity AS ioCapacity, @@sync_binlog AS syncBinlog, @@innodb_doublewrite AS doublewrite, @@sql_mode AS sqlMode`)
  results.mysql = settings[0]
}

async function collectExplains() {
  const cases = [
    { name: '用户按 legacy_id 点查', sql: 'SELECT * FROM kq_user WHERE legacy_id = ?', params: ['perf-user-42'] },
    { name: '会话按 token_hash 鉴权', sql: 'SELECT s.expires_at > UTC_TIMESTAMP(3) AS active, s.revoked_at, u.status FROM kq_auth_session s JOIN kq_user u ON u.id = s.user_id WHERE s.token_hash = ? LIMIT 1', params: [hex('session-42')] },
    { name: '资源列表按 owner/kind/status 分页', sql: 'SELECT * FROM kq_resource WHERE owner_user_id = ? AND resource_kind = ? AND status = ? AND deleted_at IS NULL ORDER BY gmt_create DESC LIMIT 50', params: [42, 'share', 'active'] },
    { name: '收发记录游标分页', sql: 'SELECT * FROM kq_account_record WHERE user_id = ? AND scope = ? AND id < ? ORDER BY id DESC LIMIT 50', params: [42, 'my_sent', 999999] },
    { name: '站内消息游标分页', sql: 'SELECT id FROM kq_message WHERE user_id = ? AND id < ? ORDER BY id DESC LIMIT 50', params: [42, 999999] },
    { name: '分享码联查资源与配置', sql: 'SELECT r.*, s.share_code FROM kq_share_config s JOIN kq_resource r ON r.id = s.resource_id WHERE s.share_code = ? LIMIT 1', params: ['PF0000042'] },
    { name: '空间用量聚合', sql: 'SELECT r.resource_kind, COALESCE(SUM(u.live_bytes),0) AS bytes, COALESCE(SUM(u.live_file_count),0) AS file_count FROM kq_resource r JOIN kq_resource_usage u ON u.resource_id = r.id WHERE r.owner_user_id = ? GROUP BY r.resource_kind', params: [42] },
    { name: '审计列表按类型时间', sql: 'SELECT legacy_id FROM kq_audit_log WHERE event_type <> ? ORDER BY gmt_create DESC, id DESC LIMIT 50', params: ['access'] },
  ]
  for (const item of cases) {
    const [rows] = await pool.query('EXPLAIN ' + item.sql, item.params)
    results.explains.push({ name: item.name, plan: rows.map(row => ({ table: row.table, type: row.type, possibleKeys: row.possible_keys, key: row.key, rows: row.rows, filtered: row.filtered, extra: row.Extra })) })
  }
}

async function stage(name, { concurrency, operation, seconds = stageSeconds, kind = 'read', note = '' }) {
  log(`STAGE start ${name} C${concurrency} ${seconds}s`)
  const connection = await mysql.createConnection({ host, port, user, password, database, charset: 'utf8mb4', timezone: 'Z' })
  const before = await queryStatus(connection)
  const started = performance.now()
  const deadline = started + seconds * 1000
  const durations = []
  const acquireWaits = []
  const errors = []
  const errorCounts = {}
  let issued = 0
  let succeeded = 0
  const peak = { threadsRunning: 0, threadsConnected: 0 }
  const poller = setInterval(async () => {
    try {
      const snapshot = await queryStatus(connection)
      peak.threadsRunning = Math.max(peak.threadsRunning, snapshot.Threads_running)
      peak.threadsConnected = Math.max(peak.threadsConnected, snapshot.Threads_connected)
    } catch {}
  }, 250)
  poller.unref()
  const workers = Array.from({ length: concurrency }, async (_, worker) => {
    while (performance.now() < deadline) {
      const sequence = issued++
      const begin = performance.now()
      try {
        const outcome = await operation(worker, sequence)
        if (outcome && typeof outcome === 'object') {
          if (outcome.acquireMs !== undefined) acquireWaits.push(outcome.acquireMs)
          if (outcome.valid === false) throw new Error(outcome.message || 'validation failed')
        }
        succeeded++
      } catch (error) {
        const code = error.code || 'ERROR'
        errorCounts[code] = (errorCounts[code] || 0) + 1
        if (errors.length < 8) errors.push({ code, message: String(error.message).slice(0, 240) })
      }
      durations.push(performance.now() - begin)
    }
  })
  await Promise.all(workers)
  clearInterval(poller)
  const elapsedMs = performance.now() - started
  const after = await queryStatus(connection)
  const delta = statusDelta(before, after)
  const record = {
    name, kind, note, concurrency, elapsedSeconds: Math.round(elapsedMs) / 1000,
    operations: durations.length, succeeded, failures: durations.length - succeeded,
    errorRatePercent: durations.length ? Math.round(1000 * (durations.length - succeeded) / durations.length) / 10 : 0,
    opsPerSecond: Math.round(1000 * durations.length / elapsedMs) / 10,
    latency: summary(durations),
    acquireLatency: acquireWaits.length ? summary(acquireWaits) : null,
    sqlPerOperation: durations.length ? Math.round(1000 * delta.Questions / durations.length) / 1000 : 0,
    mysqlDelta: {
      queries: delta.Questions, comSelect: delta.Com_select, comInsert: delta.Com_insert, comUpdate: delta.Com_update, comDelete: delta.Com_delete,
      comCommit: delta.Com_commit, comRollback: delta.Com_rollback,
      innodbRowsRead: delta.Innodb_rows_read, rowsInserted: delta.Innodb_rows_inserted, rowsUpdated: delta.Innodb_rows_updated, rowsDeleted: delta.Innodb_rows_deleted,
      rowLockWaits: delta.Innodb_row_lock_waits, rowLockTimeMs: delta.Innodb_row_lock_time, deadlocks: delta.Innodb_deadlocks,
    },
    peakThreads: peak,
    bufferPoolHitPercent: (() => {
      const requests = delta.Innodb_buffer_pool_read_requests
      const reads = delta.Innodb_buffer_pool_reads
      return requests ? Math.round(10000 * (requests - reads) / requests) / 100 : null
    })(),
    errors: errorCounts,
    errorSamples: errors,
  }
  results.stages.push(record)
  fs.writeFileSync(path.join(output, 'results-partial.json'), JSON.stringify({ stages: results.stages, dataScale: results.dataScale }, null, 2))
  log(`STAGE done ${name} ops/s=${record.opsPerSecond} p95=${record.latency.p95Ms}ms errors=${record.failures} sql/op=${record.sqlPerOperation}`)
  await connection.end()
  return record
}

async function connectionPoolTest() {
  log('STAGE start 连接池饱和 C50 (connectionLimit=2)')
  const smallPool = mysql.createPool({ host, port, user, password, database, connectionLimit: 2, charset: 'utf8mb4', timezone: 'Z', waitForConnections: true })
  const probe = await mysql.createConnection({ host, port, user, password, database, charset: 'utf8mb4' })
  const before = await queryStatus(probe)
  const started = performance.now()
  const deadline = started + stageSeconds * 1000
  const acquireWaits = []
  const durations = []
  let issued = 0
  const workers = Array.from({ length: 50 }, async () => {
    while (performance.now() < deadline) {
      const begin = performance.now()
      const acquireStart = performance.now()
      const connection = await smallPool.getConnection()
      acquireWaits.push(performance.now() - acquireStart)
      try { await connection.query('SELECT id FROM kq_user WHERE legacy_id = ?', [`perf-user-${(issued++ % SCALE.users) + 1}`]) } finally { connection.release() }
      durations.push(performance.now() - begin)
    }
  })
  await Promise.all(workers)
  const elapsedMs = performance.now() - started
  const after = await queryStatus(probe)
  const delta = statusDelta(before, after)
  results.connectionPool = {
    connectionLimit: 2, concurrency: 50, elapsedSeconds: Math.round(elapsedMs) / 1000,
    operations: durations.length, opsPerSecond: Math.round(1000 * durations.length / elapsedMs) / 10,
    latency: summary(durations), acquireLatency: summary(acquireWaits),
    sqlPerOperation: Math.round(1000 * delta.Questions / Math.max(1, durations.length)) / 1000,
    peakThreads: { threadsRunning: Number(after.Threads_running), threadsConnected: Number(after.Threads_connected) },
  }
  log(`STAGE done 连接池饱和 ops/s=${results.connectionPool.opsPerSecond} acquireP95=${results.connectionPool.acquireLatency.p95Ms}ms`)
  await smallPool.end()
  await probe.end()
}

async function deadlockTest() {
  log('TEST start 死锁注入')
  const left = await mysql.createConnection({ host, port, user, password, database, charset: 'utf8mb4', timezone: 'Z' })
  const right = await mysql.createConnection({ host, port, user, password, database, charset: 'utf8mb4', timezone: 'Z' })
  const rows = [1, 2]
  const detected = []
  for (let attempt = 0; attempt < 20; attempt++) {
    const [a, b] = attempt % 2 ? rows : [rows[1], rows[0]]
    const resultsForAttempt = await Promise.allSettled([
      (async () => {
        try {
          await left.beginTransaction()
          await left.query('UPDATE kq_user SET nickname = ? WHERE id = ?', [`deadlock-a-${attempt}`, a])
          await new Promise(resolve => setTimeout(resolve, 15))
          await left.query('UPDATE kq_user SET nickname = ? WHERE id = ?', [`deadlock-b-${attempt}`, b])
          await left.commit()
        } catch (error) { await left.rollback().catch(() => {}); throw error }
      })(),
      (async () => {
        try {
          await right.beginTransaction()
          await right.query('UPDATE kq_user SET nickname = ? WHERE id = ?', [`deadlock-c-${attempt}`, b])
          await new Promise(resolve => setTimeout(resolve, 15))
          await right.query('UPDATE kq_user SET nickname = ? WHERE id = ?', [`deadlock-d-${attempt}`, a])
          await right.commit()
        } catch (error) { await right.rollback().catch(() => {}); throw error }
      })(),
    ])
    for (const outcome of resultsForAttempt) {
      if (outcome.status === 'rejected' && outcome.reason?.code === 'ER_LOCK_DEADLOCK') detected.push(attempt)
      if (outcome.status === 'rejected' && outcome.reason?.code === 'ER_LOCK_WAIT_TIMEOUT') detected.push(attempt)
    }
  }
  const [innodb] = await left.query("SHOW GLOBAL STATUS LIKE 'Innodb_deadlocks'")
  results.deadlockTest = { attempts: 20, detectedAttempts: [...new Set(detected)].length, serverDeadlockCounter: Number(innodb[0]?.Value ?? 0), note: '应用层捕获 ER_LOCK_DEADLOCK / ER_LOCK_WAIT_TIMEOUT 后应返回可重试错误' }
  log(`TEST done 死锁注入 attempts=20 detected=${results.deadlockTest.detectedAttempts}`)
  await left.end()
  await right.end()
}

async function main() {
  admin = await mysql.createConnection({ host, port, user, password, connectTimeout: 10000, charset: 'utf8mb4' })
  const [versionRows] = await admin.query('SELECT VERSION() AS version')
  log(`TARGET MySQL ${versionRows[0].version} at ${host}:${port}, database=${database}`)
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``)
  await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
  await admin.end()
  admin = null
  pool = mysql.createPool({ host, port, user, password, database, connectionLimit: 5, charset: 'utf8mb4', timezone: 'Z', waitForConnections: true, multipleStatements: true })
  await createSchema()
  await collectMysqlSettings()
  await seed()
  await collectTables()
  await collectExplains()

  const userLegacy = () => `perf-user-${(Math.random() * SCALE.users | 0) + 1}`
  const resourceOwner = () => (Math.random() * SCALE.users | 0) + 1
  const recordCursor = () => SCALE.records + 1 - (Math.random() * 1000 | 0)

  await stage('用户主键/唯一键点查 C20', { concurrency: 20, operation: async () => { const [rows] = await pool.query('SELECT id, legacy_id, nickname, plan_json FROM kq_user WHERE legacy_id = ?', [userLegacy()]); return { valid: rows.length === 1 } } })
  await stage('会话鉴权查询 C20', { concurrency: 20, operation: async () => { const token = hex(`session-${(Math.random() * SCALE.sessions | 0) + 1}`); const [rows] = await pool.query('SELECT s.expires_at > UTC_TIMESTAMP(3) AS active, s.revoked_at, u.status FROM kq_auth_session s JOIN kq_user u ON u.id = s.user_id WHERE s.token_hash = ? LIMIT 1', [token]); return { valid: rows.length === 1 } } })
  await stage('资源列表分页 C20', { concurrency: 20, operation: async () => { const [rows] = await pool.query('SELECT * FROM kq_resource WHERE owner_user_id = ? AND resource_kind = ? AND status = ? AND deleted_at IS NULL ORDER BY gmt_create DESC LIMIT 50', [resourceOwner(), 'share', 'active']); return { valid: Array.isArray(rows) } } })
  await stage('收发记录游标分页 C20', { concurrency: 20, operation: async () => { const [rows] = await pool.query('SELECT id FROM kq_account_record WHERE user_id = ? AND scope = ? AND id < ? ORDER BY id DESC LIMIT 50', [resourceOwner(), 'my_sent', recordCursor()]); if (rows.length) await pool.query(`SELECT * FROM kq_account_record WHERE id IN (${rows.map(() => '?').join(',')})`, rows.map(row => row.id)); return { valid: rows.length <= 50 } } })
  await stage('站内消息游标分页 C20', { concurrency: 20, operation: async () => { const [rows] = await pool.query('SELECT id FROM kq_message WHERE user_id = ? AND id < ? ORDER BY id DESC LIMIT 50', [resourceOwner(), SCALE.messages + 1]); return { valid: rows.length <= 50 } } })
  await stage('分享码联查 C20', { concurrency: 20, operation: async () => { const code = `PF${String((Math.random() * SCALE.shareConfigs | 0) + 1).padStart(7, '0')}`; const [rows] = await pool.query('SELECT r.legacy_id, r.status, s.share_code FROM kq_share_config s JOIN kq_resource r ON r.id = s.resource_id WHERE s.share_code = ? LIMIT 1', [code]); return { valid: rows.length === 1 } } })
  await stage('空间用量聚合 C10', { concurrency: 10, operation: async () => { const [rows] = await pool.query('SELECT r.resource_kind, COALESCE(SUM(u.live_bytes),0) AS bytes, COALESCE(SUM(u.live_file_count),0) AS files FROM kq_resource r JOIN kq_resource_usage u ON u.resource_id = r.id WHERE r.owner_user_id = ? GROUP BY r.resource_kind', [resourceOwner()]); return { valid: rows.length >= 1 } } })
  await stage('审计写入 C20', { concurrency: 20, kind: 'write', operation: async () => { await pool.query('INSERT INTO kq_audit_log (legacy_id, event_type, action, result_status, duration_ms, user_legacy_id, ip_address, details_json, gmt_create, gmt_modified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))', [`stress-audit-${crypto.randomUUID()}`, 'access', 'GET /api/account/records', '200', 3, userLegacy(), '127.0.0.1', JSON.stringify({ source: 'db-stress' })]); return true } })
  await stage('写事务：记录+审计+版本号 C20', { concurrency: 20, kind: 'write', operation: async () => { const connection = await pool.getConnection(); try { await connection.beginTransaction(); const owner = resourceOwner(); await connection.query('INSERT INTO kq_account_record (legacy_id, user_id, scope, resource_kind, resource_id, resource_legacy_id, status, record_snapshot_json, gmt_create, gmt_modified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))', [`stress-record-${crypto.randomUUID()}`, owner, 'my_sent', 'share', (owner % SCALE.resources) + 1, `perf-resource-${(owner % SCALE.resources) + 1}`, 'active', JSON.stringify({ source: 'db-stress' })]); await connection.query('INSERT INTO kq_audit_log (legacy_id, event_type, action, result_status, duration_ms, user_legacy_id, details_json, gmt_create, gmt_modified) VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))', [`stress-tx-audit-${crypto.randomUUID()}`, 'access', 'POST /api/shares', '201', 5, `perf-user-${owner}`, JSON.stringify({ source: 'db-stress' })]); await connection.query('UPDATE kq_user SET write_version = write_version + 1, gmt_modified = gmt_modified WHERE id = ?', [owner]); await connection.commit(); return true } catch (error) { await connection.rollback().catch(() => {}); throw error } finally { connection.release() } } })
  await stage('同实体并发更新（行锁竞争）C20', { concurrency: 20, kind: 'write', operation: async () => { await pool.query('UPDATE kq_user SET write_version = write_version + 1, nickname = ? WHERE id = ?', [`contended-${Math.random()}`, 1]); return true } })
  await stage('写锁获取事务（同 key 串行化）C20', { concurrency: 20, kind: 'write', note: '模拟 lockWriteScope：INSERT IGNORE + SELECT ... FOR UPDATE', operation: async () => { const connection = await pool.getConnection(); try { await connection.beginTransaction(); await connection.query('INSERT IGNORE INTO kq_write_lock (lock_key) VALUES (?)', ['a'.repeat(64)]); await connection.query('SELECT lock_key FROM kq_write_lock WHERE lock_key = ? FOR UPDATE', ['a'.repeat(64)]); await connection.query('UPDATE kq_user SET write_version = write_version + 1 WHERE id = ?', [2]); await connection.commit(); return true } catch (error) { await connection.rollback().catch(() => {}); throw error } finally { connection.release() } } })

  const mixedOperations = [
    async () => { const [rows] = await pool.query('SELECT id FROM kq_user WHERE legacy_id = ?', [userLegacy()]); return { valid: rows.length === 1 } },
    async () => { const [rows] = await pool.query('SELECT * FROM kq_resource WHERE owner_user_id = ? AND resource_kind = ? AND status = ? AND deleted_at IS NULL ORDER BY gmt_create DESC LIMIT 50', [resourceOwner(), 'share', 'active']); return { valid: rows.length >= 0 } },
    async () => { const [rows] = await pool.query('SELECT id FROM kq_account_record WHERE user_id = ? AND id < ? ORDER BY id DESC LIMIT 50', [resourceOwner(), recordCursor()]); return { valid: rows.length <= 50 } },
    async () => { const [rows] = await pool.query('SELECT r.resource_kind, COALESCE(SUM(u.live_bytes),0) AS bytes FROM kq_resource r JOIN kq_resource_usage u ON u.resource_id = r.id WHERE r.owner_user_id = ? GROUP BY r.resource_kind', [resourceOwner()]); return { valid: rows.length >= 1 } },
    async () => { await pool.query('INSERT INTO kq_audit_log (legacy_id, event_type, action, result_status, duration_ms, user_legacy_id, details_json, gmt_create, gmt_modified) VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))', [`mixed-audit-${crypto.randomUUID()}`, 'access', 'GET /api/account/team/overview', '200', 2, userLegacy(), JSON.stringify({ source: 'db-stress-mixed' })]); return true },
    async () => { const connection = await pool.getConnection(); try { await connection.beginTransaction(); const owner = resourceOwner(); await connection.query('UPDATE kq_user SET write_version = write_version + 1 WHERE id = ?', [owner]); await connection.query('INSERT INTO kq_account_record (legacy_id, user_id, scope, resource_kind, resource_id, status, record_snapshot_json, gmt_create, gmt_modified) VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))', [`mixed-record-${crypto.randomUUID()}`, owner, 'my_sent', 'share', (owner % SCALE.resources) + 1, 'active', '{}']); await connection.commit(); return true } catch (error) { await connection.rollback().catch(() => {}); throw error } finally { connection.release() } },
  ]
  for (const concurrency of [5, 20, 50]) {
    await stage(`混合 OLTP C${concurrency}`, { concurrency, kind: 'mixed', operation: async (worker, sequence) => mixedOperations[sequence % mixedOperations.length](worker) })
  }
  await connectionPoolTest()
  await deadlockTest()

  await collectTables()
  results.cleanup = keepDatabase ? { dropped: false, database } : null
  if (!keepDatabase) {
    await pool.end()
    pool = null
    const cleanupConnection = await mysql.createConnection({ host, port, user, password, charset: 'utf8mb4' })
    await cleanupConnection.query(`DROP DATABASE IF EXISTS \`${database}\``)
    await cleanupConnection.end()
    results.cleanup = { dropped: true, database }
    log(`CLEANUP dropped database ${database}`)
  }
}

let failure = null
try {
  await main()
} catch (error) {
  failure = error
  results.errors.push({ message: error.stack || error.message })
  console.error('DB STRESS FAILED:', error.message)
} finally {
  if (pool) await pool.end().catch(() => {})
  const finishedAt = new Date()
  results.finishedAt = finishedAt.toISOString()
  results.failed = Boolean(failure)
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
  fs.writeFileSync(path.join(output, 'run.log'), logLines.join('\n') + '\n')
  fs.writeFileSync(path.join(output, 'mysql-settings.json'), JSON.stringify(results.mysql, null, 2))
  fs.writeFileSync(path.join(output, 'execution.log'), logLines.join('\n') + '\n')
  console.log(JSON.stringify({ failed: Boolean(failure), stages: results.stages.map(item => ({ name: item.name, concurrency: item.concurrency, opsPerSecond: item.opsPerSecond, p95Ms: item.latency.p95Ms, failures: item.failures })), dataScale: results.dataScale, explains: results.explains.map(item => ({ name: item.name, key: item.plan.map(plan => plan.key) })), deadlockTest: results.deadlockTest, evidenceDir: output }, null, 2))
  process.exitCode = failure ? 1 : 0
}
