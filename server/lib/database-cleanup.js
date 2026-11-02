import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { collectionsRoot, filesRoot, userFilesRoot } from '../config.js'
import { createRelationalContext } from './relational-request.js'
import { runWithDataContext } from './data-context.js'
import { normalizeSystemConfig } from './metadata-normalizers.js'
import { purgeStaleResources, purgeExpiredAuditLogs } from '../services/admin.js'
import { planExpiredShare } from '../db/resource-status.js'

async function* entries(root) {
  try { const directory = await fs.opendir(root); for await (const item of directory) yield item }
  catch (error) { if (error.code !== 'ENOENT') throw error }
}

export async function cleanupDatabaseOrphans(context, roots = { filesRoot, collectionsRoot, userFilesRoot }, { now = Date.now() } = {}) {
  const result = { shares: 0, collections: 0, userFiles: 0 }
  const cutoff = now - normalizeSystemConfig(context.store.data.systemConfig).orphanGraceHours * 3600000
  const old = async target => { const stat = await fs.lstat(target); return !stat.isSymbolicLink() && Math.max(stat.mtimeMs, stat.ctimeMs) < cutoff }
  for (const [root, kind] of [[roots.filesRoot, 'shares'], [roots.collectionsRoot, 'collections']]) {
    for await (const item of entries(root)) if (item.isDirectory()) {
      const target = path.join(root, item.name)
      if (!await old(target)) continue
      const [rows] = await context.store.pool.query('SELECT id FROM kq_resource WHERE legacy_id = ? LIMIT 1', [item.name])
      if (rows.length) continue
      context.deferCleanup(target, true, { kind: 'resource', key: item.name })
      result[kind]++
      if (context.store.cleanupTasks.length >= 50) { context.persist(); await context.runtime.metadataWriteQueue; if (context.runtime.persistenceError) throw context.runtime.persistenceError }
    }
  }
  for await (const owner of entries(roots.userFilesRoot)) if (owner.isDirectory()) {
    for await (const file of entries(path.join(roots.userFilesRoot, owner.name))) if (file.isFile()) {
      const target = path.join(roots.userFilesRoot, owner.name, file.name)
      if (!await old(target)) continue
      const key = crypto.createHash('sha256').update(`${owner.name}/${file.name}`).digest('hex')
      const [rows] = await context.store.pool.query('SELECT id FROM kq_resource_file WHERE disk_key_digest = ? LIMIT 1', [key])
      if (rows.length) continue
      context.deferCleanup(target, false, { kind: 'file', key })
      result.userFiles++
      if (context.store.cleanupTasks.length >= 50) { context.persist(); await context.runtime.metadataWriteQueue; if (context.runtime.persistenceError) throw context.runtime.persistenceError }
    }
  }
  return result
}

export async function runDatabaseCleanup(pool) {
  const result = { expiredShares: 0, expiredCollections: 0, orphaned: { shares: 0, collections: 0, userFiles: 0 }, removedAuditLogs: 0 }
  let cursor = 0
  while (true) {
    const [rows] = await pool.query(`SELECT r.id FROM kq_resource r LEFT JOIN kq_user owner ON owner.id = r.owner_user_id
      WHERE r.id > ? AND r.team_resource = 0
      AND (r.status <> 'active' OR r.expires_at <= UTC_TIMESTAMP(3) OR ${planExpiredShare}) ORDER BY r.id LIMIT 50`, [cursor])
    if (!rows.length) break
    const context = createRelationalContext(pool)
    await runWithDataContext(context, async () => {
      await context.store.config()
      await context.store.by('kq_resource', 'id', rows.map(row => row.id))
      await context.store.resourceGraph()
      await context.store.resourceRecords()
      context.normalize()
      const removed = purgeStaleResources()
      result.expiredShares += removed.shares; result.expiredCollections += removed.collections
      context.persist()
      await context.runtime.metadataWriteQueue
      if (context.runtime.persistenceError) throw context.runtime.persistenceError
    })
    cursor = rows.at(-1).id
  }
  const context = createRelationalContext(pool)
  await runWithDataContext(context, async () => {
    await context.store.config()
    result.orphaned = await cleanupDatabaseOrphans(context)
    const cutoff = new Date(Date.now() - normalizeSystemConfig(context.store.data.systemConfig).auditLogRetentionDays * 86400000)
    const [[audit]] = await pool.query('SELECT COUNT(*) AS total FROM kq_audit_log WHERE gmt_create < ?', [cutoff.toISOString().slice(0, 23).replace('T', ' ')])
    result.removedAuditLogs = Number(audit.total)
    purgeExpiredAuditLogs()
    context.persist()
    await context.runtime.metadataWriteQueue
    if (context.runtime.persistenceError) throw context.runtime.persistenceError
    await context.flushAudit()
  })
  return result
}
