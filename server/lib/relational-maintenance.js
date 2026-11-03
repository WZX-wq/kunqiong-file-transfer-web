import { createRelationalContext } from './relational-request.js'
import { runWithDataContext, trackDataOperation } from './data-context.js'
import { cleanupExpired, reconcileActiveUpgradeOrders, retainUserPaymentQueryCredentials } from '../services/account.js'
import { persistMetadata } from './metadata-store.js'
import { purgeExpiredTrash } from '../services/trash.js'
import { normalizeSystemConfig } from './metadata-normalizers.js'
import { sweepStaleUploadSessions } from '../services/shares.js'
import { drainCleanup } from '../db/cleanup-outbox.js'
import { relationalAuditWriter } from '../db/request-audit-store.js'
import { normalizeAuditLog } from './audit-normalizer.js'
import { storageRoot, MAX_AUDIT_LOGS } from '../config.js'

export function scheduleRelationalMaintenance(pool) {
  let resourceCursor = 0, orderCursor = 0, sessionCursor = 0
  let auditPurgedAt = 0
  const schedule = (milliseconds, task) => {
    let busy = false
    const timer = setInterval(async () => {
      if (busy) return
      busy = true
      const context = createRelationalContext(pool)
      try {
        await trackDataOperation(runWithDataContext(context, async () => {
          await context.store.config()
          await task(context)
          await context.runtime.metadataWriteQueue
          if (context.runtime.persistenceError) throw context.runtime.persistenceError
          await context.flushAudit()
        }))
      } catch (error) {
        console.error(JSON.stringify({ event: 'relational_maintenance_failed', code: error.code || 'DATABASE_TASK_FAILED' }))
      } finally { busy = false }
    }, milliseconds)
    timer.unref()
    return timer
  }
  const cleanup = schedule(60000, async ({ store }) => {
    await drainCleanup(pool, storageRoot)
    const [resources] = await pool.query(`SELECT r.id FROM kq_resource r
      JOIN kq_resource_usage u ON u.resource_id = r.id
      WHERE r.id > ? AND ((r.expires_at <= DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 1 DAY) AND u.live_resource_count > 0)
         OR r.trash_expires_at <= UTC_TIMESTAMP(3)) ORDER BY r.id LIMIT 50`, [resourceCursor])
    resourceCursor = resources.length === 50 ? resources.at(-1).id : 0
    await store.by('kq_resource', 'id', resources.map(row => row.id))
    await store.resourceGraph()
    await store.resourceRecords()
    await store.notifications(Object.keys(store.data.users))
    const [sessions] = await pool.query(`SELECT id, user_id FROM kq_auth_session WHERE id > ?
      AND (expires_at <= UTC_TIMESTAMP(3) OR revoked_at <= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 DAY)) ORDER BY id LIMIT 50`, [sessionCursor])
    sessionCursor = sessions.length === 50 ? sessions.at(-1).id : 0
    await store.by('kq_auth_session', 'id', sessions.map(row => row.id))
    const owners = await store.by('kq_user', 'id', sessions.map(row => row.user_id))
    for (const user of owners) await store.account(user.legacy_id, { orders: true })
    store.hydrate()
    cleanupExpired()
    purgeExpiredTrash()
    await sweepStaleUploadSessions()
  })
  const payment = schedule(30000, async ({ store }) => {
    const [orders] = await pool.query(`SELECT o.id, u.legacy_id AS user_id FROM kq_upgrade_order o
      JOIN kq_user u ON u.id = o.user_id WHERE o.id > ? AND o.status NOT IN ('paid', 'cancelled', 'expired')
      AND o.remote_order_no IS NOT NULL ORDER BY o.id LIMIT 20`, [orderCursor])
    orderCursor = orders.length === 20 ? orders.at(-1).id : 0
    for (const id of new Set(orders.map(row => row.user_id))) {
      await store.account(id, { orders: true, sessions: true, organizations: true, messages: true, settings: true })
      // Logout retains a revoked credential row instead of blocking the UI on
      // reading and rewriting every pending order. Recover that credential only
      // inside payment maintenance; it never grants account access.
      const owner = [...store.rows.get('kq_user').values()].find(row => row.legacy_id === id)
      await store.select('kq_auth_session', 'user_id = ? AND revoked_at IS NOT NULL AND expires_at > UTC_TIMESTAMP(3)', [owner.id], pool, store.rows, { limit: 1 })
      store.hydrate()
      for (const session of store.data.sessions.filter(session => session.user?.id === id)) retainUserPaymentQueryCredentials(session)
      persistMetadata()
    }
    await store.organizationGraph()
    await reconcileActiveUpgradeOrders()
  })
  const audit = schedule(60000, async ({ store }) => {
    const config = normalizeSystemConfig(store.data.systemConfig)
    if (Date.now() - auditPurgedAt < config.auditCleanupIntervalMinutes * 60000) return
    const writer = relationalAuditWriter(pool, normalizeAuditLog, MAX_AUDIT_LOGS)
    await writer.purgeExpired({
      accessCutoff: Date.now() - Math.min(config.auditAccessLogRetentionDays, config.auditLogRetentionDays) * 86400000,
      criticalCutoff: Date.now() - config.auditLogRetentionDays * 86400000,
    })
    auditPurgedAt = writer.retentionHasMore ? 0 : Date.now()
  })
  // Independent high-frequency task: the daily purge only removes aged events,
  // so a busy instance can still exceed MAX_AUDIT_LOGS between two runs. Use the
  // same per-pool audit singleton as request contexts; a failure here is caught
  // by schedule() and never blocks the other maintenance timers.
  const auditRetention = schedule(60000, async () => {
    const store = relationalAuditWriter(pool, normalizeAuditLog, MAX_AUDIT_LOGS)
    if (typeof store.trimToLimit !== 'function') return
    const removed = await store.trimToLimit()
    if (removed > 0) console.log(JSON.stringify({ event: 'audit_retention_trimmed', removed }))
  })
  return { cleanup, payment, audit, auditRetention }
}
