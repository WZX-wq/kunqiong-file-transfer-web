import { DatabaseAuditStore, mergeAuditEntries, auditRetentionCutoffs, retainedAuditLog } from '../lib/audit-store.js'
import { revealCredential } from '../lib/private-key.js'
import { trackDataOperation } from '../lib/data-context.js'

const writers = new WeakMap()
export function relationalAuditWriter(pool, normalize, limit) {
  if (!writers.has(pool)) writers.set(pool, new RelationalAuditStore(pool, normalize, limit))
  return writers.get(pool)
}

// No legacy table, journal import or history scan on the serving path.
export class RelationalAuditStore extends DatabaseAuditStore {
  enqueue(task) { super.enqueue(task); trackDataOperation(this.queue) }
  async insert(logs) { await this.insertRelational(logs) }

  // 写入路径的保留上限：每累计 200 条审计就触发一次后台裁剪，避免只靠 60 秒
  // 维护周期而让 kq_audit_log 在持续高写入下长时间超过 MAX_AUDIT_LOGS。
  append(entry) {
    const logs = super.append(entry)
    this.appendsSinceTrim = (this.appendsSinceTrim || 0) + 1
    if (this.appendsSinceTrim >= 200 && typeof this.trimToLimit === 'function') {
      this.appendsSinceTrim = 0
      this.enqueue(() => this.trimToLimit())
    }
    return logs
  }

  async refresh(requestedLimit = this.limit) {
    this.enqueue(async () => {
      await this.flushPendingRows()
      const limit = Math.max(1, Math.min(this.limit, Math.floor(requestedLimit)))
      const [rows] = await this.pool.query(`SELECT legacy_id, entity_payload_json
        FROM kq_audit_log WHERE event_type <> ? ORDER BY gmt_create DESC, id DESC LIMIT ${limit}`, ['access'])
      if (rows.length < limit) {
        const [access] = await this.pool.query(`SELECT legacy_id, entity_payload_json
          FROM kq_audit_log WHERE event_type = ? ORDER BY gmt_create DESC, id DESC LIMIT ${limit - rows.length}`, ['access'])
        rows.push(...access)
      }
      this.logs = mergeAuditEntries(rows.map(row => {
        const encoded = typeof row.entity_payload_json === 'string' && row.entity_payload_json.startsWith('"')
          ? JSON.parse(row.entity_payload_json) : row.entity_payload_json
        return JSON.parse(revealCredential(encoded, `audit:${row.legacy_id}`))
      }), this.normalize, this.limit)
    })
    await this.flush()
    return this.logs
  }

  purgeBefore(cutoff) {
    const before = this.logs.length
    this.logs = this.logs.filter(log => retainedAuditLog(log, cutoff))
    this.enqueue(() => this.deleteExpired(auditRetentionCutoffs(cutoff)))
    return { logs: this.logs, removed: before - this.logs.length }
  }

  async deleteExpired({ accessCutoff, criticalCutoff, batchSize = 500, maxBatches = 10 }) {
    const size = Math.min(1000, Math.max(1, Math.floor(batchSize)))
    const batches = Math.min(20, Math.max(1, Math.floor(maxBatches)))
    let removed = 0
    this.retentionHasMore = false
    for (const [predicate, cutoff] of [["event_type = 'access'", accessCutoff], ["event_type <> 'access'", criticalCutoff]]) {
      if (!Number.isFinite(cutoff)) continue
      // Give each class a bounded budget so access traffic cannot starve security retention.
      for (let batch = 0; batch < batches; batch++) {
        const [result] = await this.pool.execute(`DELETE FROM kq_audit_log WHERE ${predicate} AND gmt_create < ? ORDER BY gmt_create, id LIMIT ${size}`,
          [new Date(cutoff).toISOString().slice(0, 23).replace('T', ' ')])
        const count = Number(result.affectedRows || 0)
        removed += count
        if (count < size) break
        if (batch === batches - 1) this.retentionHasMore = true
        // Yield between bounded transactions so foreground work gets a pool slot.
        await new Promise(resolve => setImmediate(resolve))
      }
    }
    this.logs = this.logs.filter(log => new Date(log.createdAt).getTime() >= (log.type === 'access' ? accessCutoff : criticalCutoff))
    return removed
  }

  purgeExpired(options) {
    this.enqueue(async () => { await this.flushPendingRows(); await this.deleteExpired(options) })
    return this.flush()
  }
}
