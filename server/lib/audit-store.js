// Local audit uses small synchronous appends, independent of business metadata CAS.
// Checkpoints bound disk usage; a short exclusive lock serializes append/rotation/purge.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

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
          if (Number.isSafeInteger(owner?.pid) && owner.pid > 0) {
            try { process.kill(owner.pid, 0) } catch (probe) {
              if (probe.code === 'ESRCH') {
                try {
                  const current = JSON.parse(fs.readFileSync(this.lockPath, 'utf8'))
                  if (current.pid === owner.pid && current.token === owner.token) fs.unlinkSync(this.lockPath)
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
      if (acquired) fs.unlinkSync(this.lockPath)
      fs.unlinkSync(candidate)
    }
  }

  stamp(filename) {
    const stat = fs.statSync(filename, { bigint: true })
    return `${stat.ino}:${stat.size}:${stat.mtimeNs}`
  }

  merge(logs) {
    const byId = new Map()
    for (const entry of logs) {
      const log = this.normalize(entry)
      if (log.action) byId.set(log.id, log)
    }
    return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, this.limit)
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
      this.logs.length = Math.min(this.logs.length, this.limit)
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
