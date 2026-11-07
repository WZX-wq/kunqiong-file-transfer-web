import path from 'node:path'
import { filesRoot, userFilesRoot } from '../config.js'
import { databasePool, databaseMaintenancePool } from '../state.js'
import { metadata, persistMetadata, flushMetadataWrites, flushAuditPersistence, readAuditLogs } from '../lib/metadata-store.js'
import { currentDataContext, runWithDataContext, trackDataOperation } from '../lib/data-context.js'
import { resolveStoredFilePath } from '../lib/file-storage.js'
import { assertSafeUploadFiles } from './shares.js'
import { cleanupBlockedRiskFile } from './risk-file-cleanup.js'

// Persisted pending file rows are the queue. Publication and enqueue therefore
// share one transaction; a restart discovers unfinished work without a JSON
// business snapshot or an additional queue service. One background consumer
// shares the existing scanner coordinator with foreground uploads.
let pumping = null
let stopped = true
const activeScans = new Map()
let cleanupCursor = 0
const pending = file => file.reviewStatus === 'pending' && file.scanAccess === 'early'

async function withShare(id, task) {
  if (!databasePool) return task(metadata.shares.find(share => share.id === id))
  const { createRelationalContext } = await import('../lib/relational-request.js')
  const context = createRelationalContext(databaseMaintenancePool || databasePool)
  return runWithDataContext(context, async () => {
    await context.store.resource({ kind: 'share', id })
    return task(context.data.shares.find(share => share.id === id))
  })
}

async function candidates() {
  if (!databasePool) return metadata.shares.filter(share => !share.deletedAt && share.files?.some(pending)).slice(0, 10).map(share => share.id)
  const [rows] = await (databaseMaintenancePool || databasePool).query(`SELECT r.legacy_id FROM kq_resource r
    WHERE r.resource_kind = 'share' AND r.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM kq_resource_file f WHERE f.resource_id = r.id AND f.scan_status = 'pending')
    ORDER BY r.id LIMIT 10`)
  return rows.map(row => row.legacy_id)
}

async function scanShare(id) {
  const snapshot = await withShare(id, share => !share || share.deletedAt ? null : structuredClone(share))
  if (!snapshot) return
  const files = snapshot.files.filter(pending)
  for (const [fileOffset, file] of files.entries()) {
    if (stopped) return
    const checked = { ...file, tempPath: resolveStoredFilePath(file, path.join(filesRoot, id), userFilesRoot) }
    let failure
    let auditSaved = false
    const jobKey = `${id}:${file.storedName}:${file.storageOwnerId || ''}`
    const progress = {
      shareId: id,
      fileName: file.relativePath || file.originalname || file.name || '未命名文件',
      fileIndex: fileOffset + 1,
      fileCount: files.length,
      completedFileCount: fileOffset,
      size: Number(file.size) || 0,
      startedAt: new Date().toISOString(),
      stage: 'scanning',
    }
    activeScans.set(jobKey, progress)
    try {
      // Database audit writes need a relational context too. The scanner runs
      // without an open transaction; verdict persistence loads a fresh graph.
      await withShare(id, async () => {
        try { await assertSafeUploadFiles([checked], (activeFile, _index, state) => {
          Object.assign(progress, { completedFileCount: fileOffset + (state?.completedFileCount || 0), stage: 'scanning' })
        }, { userId: snapshot.ownerUserId, shareId: id, background: true }) }
        catch (error) { failure = error }
        try {
          await flushAuditPersistence()
          auditSaved = readAuditLogs().some(log => log.details?.shareId === id && log.details.storedName === file.storedName && log.details.scanResult === (failure?.code === 'scan_threat_detected' ? 'blocked' : failure ? 'failed' : 'passed'))
        }
        catch (error) { console.error(JSON.stringify({ event: 'scan_audit_write_failed', code: error.code || 'AUDIT_STORE_FAILED' })) }
      })
      // Never commit the snapshot held during a long scan: download counters,
      // recipient settings, deletion and other file verdicts may have changed.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await withShare(id, async share => {
            if (!share || share.deletedAt) return
            const current = share.files.find(item => item.storedName === file.storedName && item.storageOwnerId === file.storageOwnerId)
            if (!current || !pending(current)) return
            Object.assign(current, {
              reviewStatus: failure ? (failure.code === 'scan_threat_detected' ? 'blocked' : 'scan_failed') : checked.reviewStatus === 'approved' ? 'approved' : 'scan_failed',
              scanEngine: checked.scanEngine || 'clamav',
              scannedAt: new Date().toISOString(),
              scanAuditPersisted: auditSaved,
              ...(failure ? { scanErrorCode: failure.code || 'scan_incomplete' } : {}),
            })
            delete current.scanAccess
            persistMetadata()
            await flushMetadataWrites()
          })
          break
        } catch (error) {
          if (attempt === 2 || error.code !== 'DATA_CONFLICT') throw error
        }
      }
      if (failure?.code === 'scan_threat_detected' && auditSaved) {
        try { await cleanupBlockedRiskFile({ shareId: id, storedName: file.storedName, storageOwnerId: file.storageOwnerId, actor: 'automatic' }) }
        catch (error) { console.error(JSON.stringify({ event: 'risk_file_cleanup_failed', code: error.code || 'RISK_CLEANUP_FAILED' })) }
      }
    } finally { activeScans.delete(jobKey) }
  }
}

export async function getBackgroundScanStatus() {
  let pendingCount
  if (databasePool) {
    const [rows] = await (databaseMaintenancePool || databasePool).query("SELECT COUNT(*) AS total FROM kq_resource_file f JOIN kq_resource r ON r.id = f.resource_id WHERE r.resource_kind = 'share' AND r.deleted_at IS NULL AND f.scan_status = 'pending'")
    pendingCount = Number(rows?.[0]?.total || 0)
  } else {
    pendingCount = metadata.shares.reduce((total, share) => total + (share.files || []).filter(pending).length, 0)
  }
  const active = [...activeScans.values()].map(item => ({ ...item, elapsedMs: Math.max(0, Date.now() - Date.parse(item.startedAt)) }))
  return { active, queuedCount: Math.max(0, pendingCount - active.length), pendingCount }
}

async function cleanBlockedFiles() {
  let ids
  if (!databasePool) {
    if (!metadata.systemConfig.autoCleanRiskFiles) return
    ids = metadata.shares.filter(share => !share.deletedAt && share.files?.some(file => file.reviewStatus === 'blocked')).slice(0, 10).map(share => share.id)
  } else {
    const { createRelationalContext } = await import('../lib/relational-request.js')
    const pool = databaseMaintenancePool || databasePool
    const enabled = await runWithDataContext(createRelationalContext(pool), async () => {
      await currentDataContext().store.config()
      return metadata.systemConfig.autoCleanRiskFiles === true
    })
    if (!enabled) return
    const [rows] = await pool.query(`SELECT r.id, r.legacy_id FROM kq_resource r WHERE r.id > ? AND r.resource_kind = 'share' AND r.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM kq_resource_file f WHERE f.resource_id = r.id AND f.scan_status = 'blocked') ORDER BY r.id LIMIT 10`, [cleanupCursor])
    cleanupCursor = rows.length ? rows.at(-1).id : 0
    ids = rows.map(row => row.legacy_id)
  }
  for (const id of ids) {
    if (stopped) return
    const files = await withShare(id, async share => {
      const logs = currentDataContext()?.auditStore ? await currentDataContext().auditStore.refresh(5000) : readAuditLogs()
      return (share?.files || []).filter(file => file.reviewStatus === 'blocked' && file.scanAuditPersisted !== false
        && logs.some(log => log.details?.scanResult === 'blocked' && log.details.shareId === id
          && (log.details.storedName ? log.details.storedName === file.storedName && String(log.details.storageOwnerId || '') === String(file.storageOwnerId || '') : log.details.fileName === (file.relativePath || file.originalname || file.name))))
        .map(file => ({ ...file }))
    })
    for (const file of files) {
      try { await cleanupBlockedRiskFile({ shareId: id, storedName: file.storedName, storageOwnerId: file.storageOwnerId, actor: 'automatic' }) }
      catch (error) { console.error(JSON.stringify({ event: 'risk_file_cleanup_failed', code: error.code || 'RISK_CLEANUP_FAILED' })) }
    }
  }
}

export function wakeBackgroundScans() {
  if (stopped || pumping) return pumping
  pumping = trackDataOperation(runWithDataContext(undefined, async () => {
    await cleanBlockedFiles()
    for (const id of await candidates()) {
      if (stopped) break
      await scanShare(id)
    }
    await cleanBlockedFiles()
  }).catch(error => {
    // A failed commit leaves the file pending, so the next pass/restart retries
    // it. Scan failures themselves are persisted as scan_failed, never approved.
    console.error(JSON.stringify({ event: 'background_scan_failed', code: error.code || 'BACKGROUND_SCAN_FAILED' }))
  }).finally(() => { pumping = null }))
  return pumping
}

export function startBackgroundScans() {
  stopped = false
  const timer = setInterval(wakeBackgroundScans, 5000)
  timer.unref()
  wakeBackgroundScans()
  return () => { stopped = true; clearInterval(timer) }
}
