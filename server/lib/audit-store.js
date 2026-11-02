// Local audit uses small synchronous appends, independent of business metadata CAS.
// Checkpoints bound disk usage; a short exclusive lock serializes append/rotation/purge.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { removeFile } from './file-lock.js'
import { protectCredential } from './private-key.js'

// v2 replays the retained local journal after repairing the legacy MySQL
// source key. v1 used a case-insensitive VARCHAR(64) primary key and could
// silently drop distinct access IDs through INSERT IGNORE.
export const LOCAL_AUDIT_JOURNAL_MIGRATION = 'local-audit-journal-v2'

export function mergeAuditEntries(logs, normalize, limit) {
  const byId = new Map()
  for (const entry of logs) {
    const log = normalize(entry)
    if (log.action) byId.set(log.id, log)
  }
  const sorted = [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  // Preserve critical evidence before access noise, while keeping one hard
  // bound for the complete store. The previous two independent slices could
  // retain 2 * limit rows and make the configured retention cap misleading.
  const critical = sorted.filter(log => log.type !== 'access').slice(0, limit)
  const access = sorted.filter(log => log.type === 'access').slice(0, Math.max(0, limit - critical.length))
  return [...critical, ...access].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

// MySQL instances share a dedicated append table. No audit request rewrites the
// business snapshot and no fresh host needs another host's storage/audit directory.
export class DatabaseAuditStore {
  constructor(pool, normalize, limit) {
    this.pool = pool
    this.normalize = normalize
    this.limit = limit
    this.logs = []
    this.queue = Promise.resolve()
    this.error = null
    this.pending = new Map()
    this.relationalAuditEnabled = false
    this.legacyAuditSchemaRepaired = false
  }

  async initializeWithLocalJournal(legacy, directory, { migrated = false, alreadyImported = false } = {}) {
    const hasArtifacts = ['snapshot.json', 'snapshot.json.bak', 'events.jsonl']
      .some(name => fs.existsSync(path.join(directory, name)))
    if (!hasArtifacts || alreadyImported) return { logs: await this.initialize(legacy), importedLocalJournal: false }

    const restored = new LocalAuditStore(directory, this.normalize, this.limit).initialize(legacy, migrated)
    const logs = await this.initialize(restored)
    return { logs, importedLocalJournal: true }
  }

  async initialize(legacy = []) {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS kunqiong_audit_log (
      id VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
      critical TINYINT NOT NULL,
      created_at VARCHAR(32) NOT NULL,
      payload LONGTEXT NOT NULL,
      INDEX audit_time (critical, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
    const [legacyIdColumns] = await this.pool.execute(
      `SELECT CHARACTER_MAXIMUM_LENGTH AS max_length, CHARACTER_SET_NAME AS character_set_name,
              COLLATION_NAME AS collation_name, IS_NULLABLE AS is_nullable
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      ['kunqiong_audit_log', 'id'],
    )
    const legacyId = legacyIdColumns?.[0]
    if (!legacyId || Number(legacyId.max_length) < 80 || legacyId.character_set_name !== 'utf8mb4' || legacyId.collation_name !== 'utf8mb4_bin' || legacyId.is_nullable !== 'NO') {
      await this.pool.query('ALTER TABLE kunqiong_audit_log MODIFY COLUMN id VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL')
      this.legacyAuditSchemaRepaired = true
    }
    const [auditTableRows] = await this.pool.execute(
      'SELECT COUNT(*) AS found FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
      ['kq_audit_log'],
    )
    if (Number(auditTableRows?.[0]?.found)) {
      const [payloadColumns] = await this.pool.execute(
        'SELECT COUNT(*) AS found FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
        ['kq_audit_log', 'entity_payload_json'],
      )
      this.relationalAuditEnabled = Number(payloadColumns?.[0]?.found) > 0
    }
    const logs = mergeAuditEntries(legacy, this.normalize, this.limit)
    for (let offset = 0; offset < logs.length; offset += 100) await this.insert(logs.slice(offset, offset + 100))
    if (this.relationalAuditEnabled) await this.mirrorExistingLogs()
    return this.refresh()
  }

  async insert(logs) {
    if (!logs.length) return
    await this.pool.execute(`INSERT IGNORE INTO kunqiong_audit_log (id, critical, created_at, payload) VALUES ${logs.map(() => '(?, ?, ?, ?)').join(', ')}`,
      logs.flatMap(log => [log.id, log.type === 'access' ? 0 : 1, log.createdAt, JSON.stringify(log)]))
    if (this.relationalAuditEnabled) await this.insertRelational(logs)
  }

  async insertRelational(logs) {
    if (!logs.length) return
    const toDateTime = value => {
      const date = new Date(value)
      return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 23).replace('T', ' ') : new Date().toISOString().slice(0, 23).replace('T', ' ')
    }
    await this.pool.execute(`INSERT IGNORE INTO kq_audit_log
      (legacy_id, event_type, action, result_status, duration_ms, user_legacy_id, target_legacy_id, ip_address,
       details_json, gmt_create, gmt_modified, entity_payload_json)
      VALUES ${logs.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
    logs.flatMap(log => [
      log.id, log.type, String(log.action || '').slice(0, 120), log.status === null || log.status === undefined ? null : String(log.status),
      log.durationMs, log.userId || null, log.targetId || null, String(log.ip || '').slice(0, 45) || null,
      JSON.stringify(log.details || {}), toDateTime(log.createdAt), toDateTime(log.createdAt),
      JSON.stringify(protectCredential(JSON.stringify(log), `audit:${log.id}`)),
    ]))
  }

  async mirrorExistingLogs() {
    // The legacy audit table can contain many large JSON payloads. Read it in
    // bounded pages so MySQL statement execution limits and packet buffers do
    // not abort startup during the one-time relational mirror.
    const batchSize = 100
    let cursor = null
    while (true) {
      const [rows] = await this.pool.query(`SELECT id, payload FROM kunqiong_audit_log${cursor === null ? '' : ' WHERE id > ?'} ORDER BY id LIMIT ${batchSize}`, cursor === null ? [] : [cursor])
      if (!rows.length) break
      const logs = rows.map(row => this.normalize(JSON.parse(row.payload))).filter(log => log.action)
      await this.insertRelational(logs)
      cursor = rows.at(-1).id
      if (rows.length < batchSize) break
    }
  }

  async flushPendingRows() {
    const rows = [...this.pending.values()]
    if (!rows.length) return
    await this.insert(rows)
    for (const row of rows) this.pending.delete(row.id)
  }

  enqueue(task) {
    // Always keep the chain alive after a transient database failure. Pending
    // rows remain in `this.pending` and the next queued operation retries them
    // after the database becomes available again.
    this.queue = this.queue.then(async () => {
      try {
        await task()
        this.error = null
      } catch (error) {
        this.error = error
        console.error(JSON.stringify({ event: 'audit_write_failed', code: error.code || 'DATABASE_AUDIT_FAILED' }))
      }
    })
  }

  read() { return this.logs }

  append(entry) {
    const log = this.normalize(entry)
    this.logs = mergeAuditEntries([log, ...this.logs], this.normalize, this.limit)
    this.pending.set(log.id, log)
    this.enqueue(() => this.flushPendingRows())
    return this.logs
  }

  async flush() {
    await this.queue
    if (this.error) throw this.error
  }

  async readRecentRows(critical, limit) {
    // Keep the ordered index scan small: reading thousands of LONGTEXT payloads
    // in one statement can exceed MySQL's statement execution-time limit.
    const [keys] = await this.pool.query(
      `SELECT id, created_at FROM kunqiong_audit_log WHERE critical = ? ORDER BY created_at DESC, id DESC LIMIT ${limit}`,
      [critical],
    )
    const rows = []
    for (let offset = 0; offset < keys.length; offset += 100) {
      const batch = keys.slice(offset, offset + 100)
      const placeholders = batch.map(() => '?').join(', ')
      const [payloadRows] = await this.pool.execute(
        `SELECT id, payload FROM kunqiong_audit_log WHERE id IN (${placeholders})`,
        batch.map(row => row.id),
      )
      const payloadById = new Map(payloadRows.map(row => [String(row.id), row.payload]))
      for (const key of batch) {
        const payload = payloadById.get(String(key.id))
        if (payload !== undefined) rows.push({ payload })
      }
    }
    return rows
  }

  async refresh() {
    // Serialize reads with appends/purges. Entries appended while SELECT is in
    // flight remain pending, and are merged without reviving remotely purged rows.
    this.enqueue(async () => {
      await this.flushPendingRows()
      const logs = []
      for (const critical of [0, 1]) {
        const rows = await this.readRecentRows(critical, Math.max(1, Math.floor(this.limit)))
        logs.push(...rows.map(row => JSON.parse(row.payload)))
      }
      this.logs = mergeAuditEntries([...logs, ...this.pending.values()], this.normalize, this.limit)
    })
    await this.flush()
    return this.logs
  }

  purgeBefore(cutoff) {
    if (this.error) throw this.error
    const before = this.logs.length
    this.logs = this.logs.filter(log => new Date(log.createdAt).getTime() >= cutoff)
    this.enqueue(async () => {
      const at = new Date(cutoff).toISOString()
      await this.pool.execute('DELETE FROM kunqiong_audit_log WHERE created_at < ?', [at])
      if (this.relationalAuditEnabled) await this.pool.execute('DELETE FROM kq_audit_log WHERE gmt_create < ?', [at.slice(0, 23).replace('T', ' ')])
    })
    return { logs: this.logs, removed: before - this.logs.length }
  }

  // Enforce MAX_AUDIT_LOGS on the structured MySQL table as well. The append
  // path only bounds the in-memory merge, so a long-running instance grew
  // kq_audit_log without limit. Retention priority keeps evidence: oldest
  // access noise goes first, then oldest non-access (critical) events. Batches
  // are capped so a DELETE never holds a long lock or grows one huge undo log.
  // Safe no-op for JSON/local stores and for databases without the table.
  async trimToLimit() {
    const batchSize = 1000
    const limit = Math.max(1, Math.floor(Number(this.limit) || 0))
    const tableExists = async () => {
      const [rows] = await this.pool.execute(
        'SELECT COUNT(*) AS found FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
        ['kq_audit_log'],
      )
      return Number(rows?.[0]?.found) > 0
    }
    if (!await tableExists()) return 0
    const [[totalRow]] = await this.pool.query('SELECT COUNT(*) AS total FROM kq_audit_log')
    let excess = Number(totalRow?.total || 0) - limit
    if (excess <= 0) return 0
    let removed = 0
    // 1) oldest access events, 2) oldest critical events. Both statements use
    // the (event_type, gmt_create) index and stop at a hard per-batch ceiling.
    for (const predicate of [`event_type = 'access'`, `event_type <> 'access'`]) {
      while (excess > 0) {
        const batch = Math.min(batchSize, excess)
        let result
        try {
          ;[result] = await this.pool.query(
            `DELETE FROM kq_audit_log WHERE ${predicate} ORDER BY gmt_create ASC, id ASC LIMIT ${batch}`,
          )
        } catch (error) {
          if (error.code === 'ER_NO_SUCH_TABLE') return removed
          throw error
        }
        const affected = Number(result?.affectedRows || 0)
        removed += affected
        excess -= affected
        // Fewer rows than requested means this priority class is exhausted.
        if (affected < batch) break
      }
    }
    // The in-memory list is already bounded by append/refresh; the next
    // refresh() reflects this purge. Pending (not yet flushed) rows are left
    // untouched here so a concurrent append cannot be dropped by the trimmer.
    return removed
  }
}

export class LocalAuditStore {
  constructor(directory, normalize, limit) {
    this.directory = directory
    this.snapshotPath = path.join(directory, 'snapshot.json')
    this.journalPath = path.join(directory, 'events.jsonl')
    this.lockPath = path.join(directory, 'write.lock')
    this.normalize = normalize
    this.limit = limit
    this.logs = []
    this.snapshotStamp = ''
    this.journalOffset = 0
    this.journalLines = 0
    this.journalId = ''
    this.appliedJournalId = ''
    this.appliedJournalOffset = 0
    this.tag = crypto.randomUUID()
  }

  locked(task) {
    // 本地单进程开发可复用 file-lock 的开关关掉跨进程锁：本方法全同步、Node 单线程，
    // 同进程内不会真并发；而部分 Windows 环境（安全软件 / 受限目录）拒绝删除锁文件，
    // 会让这里每次都等到 5s 超时。生产多进程 / MySQL 部署不要设置该变量。
    if (process.env.KUNQIONG_DISABLE_FILE_LOCK === '1') return task()
    const deadline = Date.now() + 5000
    const candidate = this.lockPath + '.' + process.pid + '.' + this.tag + '.owner'
    fs.writeFileSync(candidate, JSON.stringify({ pid: process.pid, token: this.tag }), { mode: 0o600 })
    let acquired = false
    try {
      while (!acquired) {
        try {
          // Publish fully-written ownership atomically; death cannot leave an empty lock.
          fs.linkSync(candidate, this.lockPath)
          acquired = true
        } catch (error) {
          if (error.code !== 'EEXIST') throw error
          let owner
          try { owner = JSON.parse(fs.readFileSync(this.lockPath, 'utf8')) } catch {}
          // 属主是本进程：本次尚未获得锁，而 locked() 全同步且不可重入，所以它必然是
          // 释放失败（unlink 被拒）留下的自锁。不回收就只能一路等到超时——历史故障：
          // 每个请求都为此空转 5s 的 Atomics.wait，把事件循环堵死，登录 / 回调全部卡住。
          if (Number.isSafeInteger(owner?.pid) && owner.pid === process.pid) {
            // 属主是本进程 → 这是上次释放失败留下的自锁（locked() 全同步、不可重入，
            // 同进程内不会真有第二个持有者）。token 一致就直接认领执行，避免为了删一个
            // 删不掉的文件反复空转；token 不一致（pid 被复用的旧实例）则先尝试清理。
            if (owner.token === this.tag) { acquired = true; continue }
            if (removeFile(this.lockPath)) continue
            // 自锁删不掉（安全软件 / 受限目录）：立刻报错，别把事件循环空转 5s。
            throw Object.assign(new Error('审计日志写入锁无法释放，请检查目录权限或设置 KUNQIONG_DISABLE_FILE_LOCK=1'), { status: 503, code: 'AUDIT_LOCK_STUCK' })
          }
          if (Number.isSafeInteger(owner?.pid) && owner.pid > 0) {
            try { process.kill(owner.pid, 0) } catch (probe) {
              if (probe.code === 'ESRCH') {
                try {
                  const current = JSON.parse(fs.readFileSync(this.lockPath, 'utf8'))
                  if (current.pid === owner.pid && current.token === owner.token) removeFile(this.lockPath)
                } catch {}
                continue
              }
            }
          }
          if (Date.now() >= deadline) throw new Error('审计日志写入锁等待超时')
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2)
        }
      }
      return task()
    } finally {
      // 释放失败绝不能抛：它会盖掉任务本身的异常，还会把锁连同候选文件一起泄漏给下一个
      // 写者。removeFile 内部已做 8×20ms 重试并吞掉 EPERM/EBUSY，最差由自锁回收兜底。
      if (acquired) removeFile(this.lockPath)
      removeFile(candidate)
    }
  }

  stamp(filename) {
    const stat = fs.statSync(filename, { bigint: true })
    return `${stat.ino}:${stat.size}:${stat.mtimeNs}`
  }

  merge(logs) {
    return mergeAuditEntries(logs, this.normalize, this.limit)
  }

  initialize(legacy = [], migrated = false) {
    fs.mkdirSync(this.directory, { recursive: true })
    return this.locked(() => {
      if (!fs.existsSync(this.snapshotPath)) {
        if (fs.existsSync(this.snapshotPath + '.bak')) {
          fs.copyFileSync(this.snapshotPath + '.bak', this.snapshotPath)
        } else {
          if (migrated) throw new Error('已迁移的审计快照及备份丢失，请恢复 storage/audit 后重试')
          this.logs = this.merge(legacy)
          // Existing orphan journal entries are replayed before the first checkpoint.
          this.readJournal()
          this.checkpoint()
        }
      }
      this.refresh()
      return this.logs
    })
  }

  readSnapshot() {
    const parse = filename => {
      const data = JSON.parse(fs.readFileSync(filename, 'utf8'))
      if (data.version !== 1 || !Array.isArray(data.logs)) throw new Error('审计快照格式无效')
      return data
    }
    try { return parse(this.snapshotPath) } catch (error) {
      const recovered = parse(this.snapshotPath + '.bak')
      console.warn(`[audit-store] 审计快照损坏，使用备份恢复：${error.message}`)
      fs.copyFileSync(this.snapshotPath + '.bak', this.snapshotPath)
      return recovered
    }
  }

  refresh() {
    const stamp = this.stamp(this.snapshotPath)
    if (stamp !== this.snapshotStamp) {
      const snapshot = this.readSnapshot()
      this.logs = this.merge(snapshot.logs)
      this.appliedJournalId = snapshot.appliedJournalId || ''
      this.appliedJournalOffset = snapshot.appliedJournalOffset || 0
      this.snapshotStamp = this.stamp(this.snapshotPath)
      this.journalOffset = 0
      this.journalLines = 0
      this.journalId = ''
    }
    this.readJournal()
    return this.logs
  }

  readJournal() {
    if (!fs.existsSync(this.journalPath)) this.atomicWrite(this.journalPath, this.journalHeader())
    // Generation + committed byte offset prevents a crash between checkpoint and journal
    // rotation from replaying already-applied records (especially records removed by purge).
    const prefix = Buffer.alloc(256)
    const headerDescriptor = fs.openSync(this.journalPath, 'r')
    let prefixBytes
    try { prefixBytes = fs.readSync(headerDescriptor, prefix, 0, prefix.length, 0) } finally { fs.closeSync(headerDescriptor) }
    const headerEnd = prefix.subarray(0, prefixBytes).indexOf(10) + 1
    if (!headerEnd) throw new Error('审计日志缺少有效代次标记')
    const header = JSON.parse(prefix.subarray(0, headerEnd).toString('utf8'))
    if (header.version !== 1 || !header.journalId) throw new Error('审计日志代次格式无效')
    if (this.journalId !== header.journalId) {
      this.journalId = header.journalId
      this.journalOffset = this.appliedJournalId === header.journalId ? Math.max(headerEnd, this.appliedJournalOffset) : headerEnd
      this.journalLines = 0
    }
    const size = fs.statSync(this.journalPath).size
    if (size === this.journalOffset) return
    if (size < this.journalOffset) throw new Error('审计日志被截断但快照未更新')
    const buffer = Buffer.alloc(size - this.journalOffset)
    const descriptor = fs.openSync(this.journalPath, 'r')
    try {
      let read = 0
      while (read < buffer.length) {
        const n = fs.readSync(descriptor, buffer, read, buffer.length - read, this.journalOffset + read)
        if (!n) throw new Error('审计日志读取不完整')
        read += n
      }
    } finally { fs.closeSync(descriptor) }
    const end = buffer.lastIndexOf(10) + 1
    const lines = buffer.subarray(0, end).toString('utf8').split('\n').filter(Boolean)
    // Invalid complete rows indicate corruption; refuse to silently discard history.
    const entries = lines.map(line => JSON.parse(line))
    this.logs = this.merge([...entries, ...this.logs])
    this.journalLines += lines.length
    this.journalOffset += end
    if (end !== buffer.length) {
      // An interrupted write can leave an incomplete final row. Repair before appending.
      const repair = fs.openSync(this.journalPath, 'r+')
      try { fs.ftruncateSync(repair, this.journalOffset) } finally { fs.closeSync(repair) }
      console.warn('[audit-store] 已移除中断写入留下的不完整日志尾部')
    }
  }

  atomicWrite(filename, content) {
    const temporary = filename + '.' + this.tag + '.tmp'
    const descriptor = fs.openSync(temporary, 'w', 0o600)
    try { fs.writeFileSync(descriptor, content); fs.fsyncSync(descriptor) } finally { fs.closeSync(descriptor) }
    fs.renameSync(temporary, filename)
  }

  journalHeader() { return JSON.stringify({ version: 1, journalId: crypto.randomUUID() }) + '\n' }

  checkpoint() {
    const serialized = JSON.stringify({ version: 1, generation: crypto.randomUUID(), logs: this.logs, appliedJournalId: this.journalId, appliedJournalOffset: this.journalOffset })
    this.atomicWrite(this.snapshotPath, serialized)
    // Backup must contain the same retained set before journal reset, including purges.
    this.atomicWrite(this.snapshotPath + '.bak', serialized)
    const header = this.journalHeader()
    this.atomicWrite(this.journalPath, header)
    this.snapshotStamp = this.stamp(this.snapshotPath)
    this.journalId = JSON.parse(header).journalId
    this.journalOffset = Buffer.byteLength(header)
    this.journalLines = 0
  }

  append(log) {
    return this.locked(() => {
      this.refresh()
      const row = Buffer.from(JSON.stringify(log) + '\n')
      const descriptor = fs.openSync(this.journalPath, 'a', 0o600)
      try {
        let written = 0
        while (written < row.length) written += fs.writeSync(descriptor, row, written, row.length - written)
        if (log.type !== 'access') fs.fsyncSync(descriptor)
      } finally { fs.closeSync(descriptor) }
      this.journalOffset += row.length
      this.journalLines++
      this.logs.unshift(log)
      this.logs = this.merge(this.logs)
      if (this.journalLines >= 1000 || this.journalOffset >= 8 * 1024 ** 2) this.checkpoint()
      return this.logs
    })
  }

  read() { return this.locked(() => this.refresh()) }

  purgeBefore(cutoff) {
    return this.locked(() => {
      this.refresh()
      const before = this.logs.length
      this.logs = this.logs.filter(log => new Date(log.createdAt).getTime() >= cutoff)
      if (this.logs.length !== before) this.checkpoint()
      return { logs: this.logs, removed: before - this.logs.length }
    })
  }
}
