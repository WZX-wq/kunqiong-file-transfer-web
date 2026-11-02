import { DatabaseAuditStore, mergeAuditEntries } from '../lib/audit-store.js'
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
    this.logs = this.logs.filter(log => new Date(log.createdAt).getTime() >= cutoff)
    this.enqueue(() => this.pool.execute('DELETE FROM kq_audit_log WHERE gmt_create < ?', [new Date(cutoff).toISOString().slice(0, 23).replace('T', ' ')]))
    return { logs: this.logs, removed: before - this.logs.length }
  }
}
