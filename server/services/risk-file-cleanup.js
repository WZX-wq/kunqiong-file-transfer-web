import path from 'node:path'
import { filesRoot, userFilesRoot } from '../config.js'
import { databaseMaintenancePool, databasePool } from '../state.js'
import { currentDataContext, runWithDataContext } from '../lib/data-context.js'
import { removeStoredFiles, resolveStoredFilePath } from '../lib/file-storage.js'
import { flushAuditPersistence, flushMetadataWrites, metadata, persistMetadata } from '../lib/metadata-store.js'
import { acquireOperationLock } from '../lib/operation-lock.js'
import { addAccountMessage, recordAuditLog } from './account.js'

function cleanupKey({ shareId, storedName, storageOwnerId = '' }) {
  return `${shareId}:${storageOwnerId}:${storedName}`
}

export async function cleanupBlockedRiskFile(input) {
  const release = await acquireOperationLock(`risk-cleanup:${input.shareId}`)
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (!databasePool) return await clean(input)
        const { createRelationalContext } = await import('../lib/relational-request.js')
        const context = createRelationalContext(databaseMaintenancePool || databasePool)
        return await runWithDataContext(context, async () => {
          await context.store.config()
          await context.store.resource({ kind: 'share', id: input.shareId })
          return clean(input)
        })
      } catch (error) { if (attempt === 2 || error.code !== 'DATA_CONFLICT') throw error }
    }
  } finally { release() }
}

async function clean({ shareId, storedName, storageOwnerId = '', actor = 'admin', scanLogId = '' }) {
  if (actor === 'automatic' && metadata.systemConfig.autoCleanRiskFiles !== true) return { skipped: true }
  let share = metadata.shares.find(item => item.id === shareId && !item.deletedAt)
  if (!share) throw Object.assign(new Error('分享资源不存在或已关闭'), { status: 404 })
  const context = currentDataContext()
  if (share.ownerUserId) {
    await context?.store.account(share.ownerUserId, { messages: true })
    share = metadata.shares.find(item => item.id === shareId && !item.deletedAt)
  }
  const index = share.files.findIndex(file => file.storedName === storedName
    && String(file.storageOwnerId || '') === String(storageOwnerId || '')
    && file.reviewStatus === 'blocked')
  if (index < 0) throw Object.assign(new Error('风险文件已清理或当前状态不允许清理'), { status: 409 })

  const file = share.files[index]
  if (!resolveStoredFilePath(file, path.join(filesRoot, share.id), userFilesRoot)) throw Object.assign(new Error('文件存储位置无效，无法清理'), { status: 409 })
  // A blocked verdict is already durable. Delete bytes before claiming success
  // or notifying the owner; ENOENT is safe to retry after a lost acknowledgement.
  runWithDataContext(undefined, () => removeStoredFiles([file], path.join(filesRoot, share.id), userFilesRoot))
  share.files.splice(index, 1)
  if (!share.files.length) share.status = 'closed'
  share.updatedAt = new Date().toISOString()
  let notified = false
  if (share.ownerUserId) {
    notified = Boolean(addAccountMessage(share.ownerUserId, {
      category: 'system',
      eventType: 'securityRiskCleaned',
      title: '风险文件已清理',
      body: `「${String(file.name || file.originalname || '风险文件').slice(0, 100)}」已从分享中删除。`,
    }, { respectSettings: false }))
  }
  persistMetadata()
  await flushMetadataWrites()
  recordAuditLog({
    type: 'admin',
    action: actor === 'automatic' ? '自动清理风险文件' : '手动清理风险文件',
    userId: actor === 'automatic' ? 'system:scan-cleanup' : actor,
    targetId: share.id,
    details: { shareId: share.id, storedName, storageOwnerId, scanLogId, scanFileKey: cleanupKey({ shareId: share.id, storedName, storageOwnerId }) },
  })
  await flushAuditPersistence()
  return { shareId: share.id, fileName: file.name || file.originalname || '风险文件', notified, scanFileKey: cleanupKey({ shareId: share.id, storedName, storageOwnerId }) }
}
