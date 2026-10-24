import fs from 'node:fs'
import path from 'node:path'
import { collectionsRoot, filesRoot } from '../config.js'
import { metadata, persistMetadata } from '../lib/metadata-store.js'
import { httpError, removeDirectory } from '../lib/http.js'
import { fileListSize, parseAccountRecordResource } from './account.js'

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

function assertOwner(resource, ownerUserId) {
  if (!resource || resource.ownerUserId !== ownerUserId || resource.teamResource) throw httpError(404, '回收站资源不存在')
}

export function trashResourceForOwner(ownerUserId, recordId) {
  const parsed = parseAccountRecordResource(recordId)
  if (!parsed || !['my_sent', 'my_collections'].includes(parsed.scope)) return null
  const resource = resourceByReference(parsed.kind, parsed.key)
  if (!resource || resource.ownerUserId !== ownerUserId || resource.teamResource) return null
  if (resource.deletedAt) return resourceSummary(parsed.kind, resource)
  const now = new Date()
  resource.deletedAt = now.toISOString()
  resource.trashExpiresAt = new Date(now.getTime() + TRASH_RETENTION_MS).toISOString()
  resource.status = 'closed'
  resource.closeReason = 'trash'
  return resourceSummary(parsed.kind, resource)
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

export function purgeExpiredTrash(now = Date.now()) {
  let changed = false
  for (const [kind, list] of [['share', metadata.shares || []], ['collection', metadata.collections || []]]) {
    for (const resource of [...list]) {
      if (!resource.deletedAt || !resource.trashExpiresAt || new Date(resource.trashExpiresAt).getTime() > now) continue
      removeDirectory(resourceDirectory(kind, resource))
      const index = list.indexOf(resource)
      if (index >= 0) list.splice(index, 1)
      changed = true
    }
  }
  if (changed) persistMetadata()
  return changed
}

export function trashCapacityForOwner(ownerUserId) {
  return listTrashForOwner(ownerUserId).reduce((sum, item) => sum + Number(item.totalSize || 0), 0)
}

