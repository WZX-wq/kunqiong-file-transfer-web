import fs from 'node:fs'
import path from 'node:path'
import { collectionsRoot, filesRoot } from '../config.js'
import { metadata, persistMetadata } from '../lib/metadata-store.js'
import { httpError, removeDirectory } from '../lib/http.js'
import { accountRecordOwnerKey, normalizeAccountRecord } from '../lib/metadata-normalizers.js'
import { accountRecordsForUser, fileListSize, mergeAccountRecords, parseAccountRecordResource } from './account.js'

export const TRASH_RETENTION_DAYS = 7
export const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 86400000

function resourceByReference(kind, key) {
  const collection = kind === 'collection'
    ? metadata.collections.find(item => item.id === key || item.token === key || item.manageToken === key)
    : null
  const share = kind === 'share'
    ? metadata.shares.find(item => item.id === key || item.manageToken === key || item.code === key)
    : null
  return kind === 'collection' ? collection : share
}

function resourceDirectory(kind, resource) {
  return kind === 'collection' ? path.join(collectionsRoot, resource.id) : path.join(filesRoot, resource.id)
}

function teamShareDirectory(resource) {
  const directory = path.resolve(filesRoot, String(resource?.id || ''))
  if (path.dirname(directory) !== path.resolve(filesRoot)) throw httpError(500, '团队资源存储路径无效，无法删除')
  return directory
}

function resourceSummary(kind, resource) {
  const files = kind === 'share'
    ? resource.files || []
    : (resource.submissions || []).flatMap(item => item?.files || [])
  return {
    id: resource.id,
    kind,
    name: kind === 'share' ? (files[0]?.name || '文件分享') : (resource.title || '收集任务'),
    ownerUserId: resource.ownerUserId,
    deletedAt: resource.deletedAt,
    trashExpiresAt: resource.trashExpiresAt,
    fileCount: files.length,
    totalSize: fileListSize(files),
    createdAt: resource.createdAt,
    expiresAt: resource.expiresAt || resource.deadline || null,
    status: resource.status || 'closed',
    manageToken: resource.manageToken || '',
    code: resource.code || '',
  }
}

function teamTrashSummary(resource) {
  const files = resource.files || []
  return {
    id: resource.id,
    kind: 'share',
    name: files[0]?.name || '文件分享',
    ownerUserId: resource.ownerUserId,
    deletedByUserId: resource.deletedByUserId || resource.ownerUserId,
    deletedAt: resource.deletedAt,
    trashExpiresAt: resource.trashExpiresAt,
    fileCount: files.length,
    totalSize: fileListSize(files),
    createdAt: resource.createdAt,
    status: resource.status || 'closed',
  }
}

function pruneTeamShareRecords(resource) {
  const removedKeys = new Set([resource.id, resource.manageToken, resource.code].filter(Boolean))
  for (const [userId, records] of Object.entries(metadata.records || {})) {
    if (!Array.isArray(records)) continue
    metadata.records[userId] = records.filter(record => {
      const parsed = parseAccountRecordResource(record?.id)
      return parsed?.kind !== 'share' || !removedKeys.has(parsed.key)
    })
  }
}

function assertOwner(resource, ownerUserId) {
  if (!resource || resource.ownerUserId !== ownerUserId || resource.teamResource) throw httpError(404, '回收站资源不存在')
}

// 删除记录时把记录快照挂在资源上；恢复时用它还原名称、别名和链接等信息。
function trashRecordSnapshot(ownerUserId, recordId) {
  const key = accountRecordOwnerKey(ownerUserId)
  const records = key ? metadata.records?.[key] : null
  if (!Array.isArray(records)) return null
  const record = records.find(item => item?.id === recordId)
  return record ? normalizeAccountRecord(record) : null
}

// 从资源本身重建收发记录：旧版本恢复的资源没有快照，也能重新出现在「收发记录」。
function restoredRecordForResource(kind, resource) {
  const snapshot = resource?.trashRecord && typeof resource.trashRecord === 'object' && !Array.isArray(resource.trashRecord)
    ? resource.trashRecord
    : {}
  const now = new Date().toISOString()
  if (kind === 'share') {
    const files = Array.isArray(resource.files) ? resource.files : []
    return normalizeAccountRecord({
      ...snapshot,
      id: `my_sent:share:${resource.id}`,
      scope: 'my_sent',
      kind: 'share',
      type: '发送',
      name: files[0]?.name || snapshot.name || '文件分享',
      status: '已关闭',
      shareId: resource.id,
      code: resource.code || snapshot.code || '',
      manageToken: resource.manageToken || snapshot.manageToken || '',
      shareUrl: snapshot.shareUrl || '',
      manageUrl: snapshot.manageUrl || '',
      expiresAt: resource.expiresAt || snapshot.expiresAt || null,
      downloadLimit: resource.downloadLimit ?? snapshot.downloadLimit,
      downloadCount: resource.downloadCount ?? snapshot.downloadCount,
      fileCount: files.length,
      totalSize: fileListSize(files),
      files,
      createdAt: resource.createdAt || snapshot.createdAt,
      updatedAt: now,
    })
  }
  const submissions = Array.isArray(resource.submissions) ? resource.submissions : []
  const files = submissions.flatMap(submission => Array.isArray(submission?.files) ? submission.files : [])
  return normalizeAccountRecord({
    ...snapshot,
    id: `my_collections:collection:${resource.manageToken || resource.id || resource.token}`,
    scope: 'my_collections',
    kind: 'collection',
    type: '收集',
    name: resource.title || snapshot.name || '收集任务',
    status: '已关闭',
    manageToken: resource.manageToken || snapshot.manageToken || '',
    collectionToken: resource.token || snapshot.collectionToken || '',
    publicUrl: snapshot.publicUrl || '',
    shareUrl: snapshot.shareUrl || '',
    manageUrl: snapshot.manageUrl || '',
    deadline: resource.deadline || snapshot.deadline || null,
    allowedTypes: resource.allowedTypes || snapshot.allowedTypes,
    maxFileSizeMb: resource.maxFileSizeMb ?? snapshot.maxFileSizeMb,
    submissionCount: submissions.length,
    fileCount: files.length,
    totalSize: fileListSize(files),
    files,
    submissions,
    createdAt: resource.createdAt || snapshot.createdAt,
    updatedAt: now,
  })
}

function restoreAccountRecord(ownerUserId, kind, resource) {
  const key = accountRecordOwnerKey(ownerUserId)
  if (!key) return null
  const record = restoredRecordForResource(kind, resource)
  if (!record) return null
  metadata.records[key] = mergeAccountRecords(accountRecordsForUser(ownerUserId), [record])
  delete resource.trashRecord
  return record
}

// 兼容修复：旧版本恢复的资源只清了回收站标记，没有补回收发记录。
export function ensureRestoredResourceRecords(ownerUserId) {
  const key = accountRecordOwnerKey(ownerUserId)
  if (!key) return false
  const existing = new Set(accountRecordsForUser(ownerUserId).map(record => record?.id).filter(Boolean))
  let changed = false
  const restore = (kind, resource) => {
    const record = restoredRecordForResource(kind, resource)
    if (!record || existing.has(record.id)) return
    metadata.records[key] = mergeAccountRecords(metadata.records[key] || [], [record])
    existing.add(record.id)
    changed = true
  }
  for (const share of metadata.shares || []) {
    if (share.teamResource || share.deletedAt || share.ownerUserId !== ownerUserId || share.closeReason !== 'trash_restore') continue
    restore('share', share)
  }
  for (const task of metadata.collections || []) {
    if (task.deletedAt || task.ownerUserId !== ownerUserId || task.closeReason !== 'trash_restore') continue
    restore('collection', task)
  }
  return changed
}

export function trashResourceForOwner(ownerUserId, recordId) {
  const parsed = parseAccountRecordResource(recordId)
  if (!parsed || !['my_sent', 'my_collections'].includes(parsed.scope)) return null
  const resource = resourceByReference(parsed.kind, parsed.key)
  if (!resource || resource.ownerUserId !== ownerUserId || resource.teamResource) return null
  if (resource.deletedAt) return resourceSummary(parsed.kind, resource)
  const snapshot = trashRecordSnapshot(ownerUserId, recordId)
  if (snapshot) resource.trashRecord = snapshot
  const now = new Date()
  resource.deletedAt = now.toISOString()
  resource.trashExpiresAt = new Date(now.getTime() + TRASH_RETENTION_MS).toISOString()
  resource.status = 'closed'
  resource.closeReason = 'trash'
  return resourceSummary(parsed.kind, resource)
}

export function trashTeamResourceForOrganization(organizationId, userId, resourceId, canManage = false) {
  const resource = metadata.shares.find(item => item.id === String(resourceId || '') && item.teamResource && item.teamOrganizationId === organizationId)
  if (!resource || resource.deletedAt) throw httpError(404, '团队资源不存在或已删除')
  if (!canManage && resource.ownerUserId !== userId) throw httpError(403, '仅资源上传者或团队管理者可以移入回收站')
  const now = new Date()
  resource.deletedAt = now.toISOString()
  resource.trashExpiresAt = new Date(now.getTime() + TRASH_RETENTION_MS).toISOString()
  resource.deletedByUserId = userId
  resource.status = 'closed'
  resource.closeReason = 'team_trash'
  resource.updatedAt = now.toISOString()
  return teamTrashSummary(resource)
}

export function listTeamTrashForOrganization(organizationId, userId, canManage = false) {
  return (metadata.shares || [])
    .filter(item => item.teamResource && item.teamOrganizationId === organizationId && item.deletedAt)
    .filter(item => canManage || item.ownerUserId === userId)
    .map(teamTrashSummary)
    .sort((a, b) => new Date(b.deletedAt || 0).getTime() - new Date(a.deletedAt || 0).getTime())
}

function findTeamTrashResource(organizationId, resourceId) {
  return metadata.shares.find(item => item.id === String(resourceId || '') && item.teamResource && item.teamOrganizationId === organizationId && item.deletedAt) || null
}

export function restoreTeamTrashResource(organizationId, userId, canManage, resourceId) {
  const resource = findTeamTrashResource(organizationId, resourceId)
  if (!resource) throw httpError(404, '团队回收站资源不存在')
  if (!canManage && resource.ownerUserId !== userId) throw httpError(403, '仅资源上传者或团队管理者可以恢复该资源')
  if (!resource.trashExpiresAt || new Date(resource.trashExpiresAt).getTime() <= Date.now()) {
    throw httpError(410, '团队回收站保留期限已到，资源不可恢复')
  }
  if (!resource.files?.length || !fs.existsSync(teamShareDirectory(resource))) {
    throw httpError(410, '文件已被物理清理，资源不可恢复')
  }
  delete resource.deletedAt
  delete resource.trashExpiresAt
  delete resource.deletedByUserId
  resource.status = 'closed'
  resource.closeReason = 'team_trash_restore'
  resource.updatedAt = new Date().toISOString()
  return teamTrashSummary(resource)
}

export async function permanentlyDeleteTeamTrashResource(organizationId, resourceId) {
  const resource = findTeamTrashResource(organizationId, resourceId)
  if (!resource) throw httpError(404, '团队回收站资源不存在')
  await fs.promises.rm(teamShareDirectory(resource), { recursive: true, force: true })
  const index = metadata.shares.indexOf(resource)
  if (index < 0) throw httpError(404, '团队回收站资源不存在')
  metadata.shares.splice(index, 1)
  pruneTeamShareRecords(resource)
  return teamTrashSummary(resource)
}

// 一键清空只处理当前回收站内的资源；活动资源和其他账号/团队的回收站不受影响。
export async function emptyTeamTrashForOrganization(organizationId) {
  const resources = (metadata.shares || [])
    .filter(item => item.teamResource && item.teamOrganizationId === organizationId && item.deletedAt)
  const result = { deletedCount: 0, deletedFileCount: 0, releasedBytes: 0 }
  try {
    for (const resource of resources) {
      const summary = teamTrashSummary(resource)
      await fs.promises.rm(teamShareDirectory(resource), { recursive: true, force: true })
      const index = metadata.shares.indexOf(resource)
      if (index < 0) continue
      metadata.shares.splice(index, 1)
      pruneTeamShareRecords(resource)
      result.deletedCount += 1
      result.deletedFileCount += summary.fileCount
      result.releasedBytes += summary.totalSize
    }
  } finally {
    // 批量删除中途失败时也把已完成的删除落盘，避免重启后元数据指向已删除的文件。
    if (result.deletedCount > 0) persistMetadata()
  }
  return result
}

export function listTrashForOwner(ownerUserId) {
  return [
    ...(metadata.shares || []).filter(item => item.deletedAt && item.ownerUserId === ownerUserId && !item.teamResource).map(item => resourceSummary('share', item)),
    ...(metadata.collections || []).filter(item => item.deletedAt && item.ownerUserId === ownerUserId).map(item => resourceSummary('collection', item)),
  ].sort((a, b) => new Date(b.deletedAt || 0).getTime() - new Date(a.deletedAt || 0).getTime())
}

export function findTrashResource(ownerUserId, kind, id) {
  const resource = resourceByReference(kind, id)
  if (!resource || resource.ownerUserId !== ownerUserId || resource.teamResource || !resource.deletedAt) return null
  return resource
}

export function restoreTrashResource(ownerUserId, kind, id) {
  const resource = findTrashResource(ownerUserId, kind, id)
  if (!resource) throw httpError(404, '回收站资源不存在')
  if (resource.trashExpiresAt && new Date(resource.trashExpiresAt).getTime() <= Date.now()) throw httpError(410, '回收站保留期限已到，资源不可恢复')
  const hasFiles = kind === 'share'
    ? Boolean(resource.files?.length)
    : Boolean((resource.submissions || []).some(item => item?.files?.length))
  if (!hasFiles || !fs.existsSync(resourceDirectory(kind, resource))) throw httpError(410, '文件已被物理清理，资源不可恢复')
  delete resource.deletedAt
  delete resource.trashExpiresAt
  resource.status = 'closed'
  resource.closeReason = 'trash_restore'
  restoreAccountRecord(ownerUserId, kind, resource)
  return resourceSummary(kind, resource)
}

export async function permanentlyDeleteTrashResource(ownerUserId, kind, id) {
  const resource = findTrashResource(ownerUserId, kind, id)
  if (!resource) throw httpError(404, '回收站资源不存在')
  await fs.promises.rm(resourceDirectory(kind, resource), { recursive: true, force: true })
  const list = kind === 'share' ? metadata.shares : metadata.collections
  const index = list.indexOf(resource)
  if (index >= 0) list.splice(index, 1)
  return resourceSummary(kind, resource)
}

export async function emptyTrashForOwner(ownerUserId) {
  const resources = [
    ...(metadata.shares || [])
      .filter(item => item.deletedAt && item.ownerUserId === ownerUserId && !item.teamResource)
      .map(item => ['share', item]),
    ...(metadata.collections || [])
      .filter(item => item.deletedAt && item.ownerUserId === ownerUserId)
      .map(item => ['collection', item]),
  ]
  const result = { deletedCount: 0, deletedFileCount: 0, releasedBytes: 0 }
  try {
    for (const [kind, resource] of resources) {
      const summary = resourceSummary(kind, resource)
      await fs.promises.rm(resourceDirectory(kind, resource), { recursive: true, force: true })
      const list = kind === 'share' ? metadata.shares : metadata.collections
      const index = list.indexOf(resource)
      if (index < 0) continue
      list.splice(index, 1)
      result.deletedCount += 1
      result.deletedFileCount += summary.fileCount
      result.releasedBytes += summary.totalSize
    }
  } finally {
    // 批量删除中途失败时也把已完成的删除落盘，避免重启后元数据指向已删除的文件。
    if (result.deletedCount > 0) persistMetadata()
  }
  return result
}

export function purgeExpiredTrash(now = Date.now()) {
  let changed = false
  for (const [kind, list] of [['share', metadata.shares || []], ['collection', metadata.collections || []]]) {
    for (const resource of [...list]) {
      if (!resource.deletedAt || !resource.trashExpiresAt || new Date(resource.trashExpiresAt).getTime() > now) continue
      removeDirectory(resourceDirectory(kind, resource))
      const index = list.indexOf(resource)
      if (index >= 0) list.splice(index, 1)
      if (kind === 'share' && resource.teamResource) pruneTeamShareRecords(resource)
      changed = true
    }
  }
  if (changed) persistMetadata()
  return changed
}

export function trashCapacityForOwner(ownerUserId) {
  return listTrashForOwner(ownerUserId).reduce((sum, item) => sum + Number(item.totalSize || 0), 0)
}

