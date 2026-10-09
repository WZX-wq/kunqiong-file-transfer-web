// 收集（匿名文件收集）域业务逻辑
//
// 依赖方向（单向）：本模块只依赖 config / state / lib / services/*，
// 不 import server.mjs，也不 import routes。
//
// 说明：collect 相关的大量校验函数（validateCollection / assertCollectionFiles /
// publicSubmission 等）上一轮随 shares 域迁出（上传/分享/收集共用文件流转逻辑），
// 本模块从其 import。

import {
  collectionsRoot
} from '../config.js'
import {
  httpError
} from '../lib/http.js'
import {
  currentCollectionStatus, fileListSize, getOrigin
} from '../services/account.js'
import {
  collectionCapacityBytes, enterpriseOrganizationForUser, normalizeCollectionAllowedTypes,
  normalizeExpiryInput, publicSubmission, zipEntryPath
} from '../services/shares.js'
import path from 'node:path'
import QRCode from 'qrcode'

export function publicCollection(task, req, includeManage = false) {
  const organization = task.ownerUserId ? enterpriseOrganizationForUser(task.ownerUserId) : null
  const status = currentCollectionStatus(task)
  const payload = {
    id: task.id,
    token: task.token,
    title: task.title,
    description: task.description,
    deadline: task.deadline,
    allowedTypes: task.allowedTypes,
    maxFileSizeMb: task.maxFileSizeMb,
    capacityBytes: collectionCapacityBytes(task),
    usedBytes: task.submissions.reduce((sum, submission) => sum + fileListSize(submission.files), 0),
    status,
    submissionCount: task.submissions.length,
    publicUrl: `${getOrigin(req)}/collect/${task.token}`,
    qrDataUrl: task.qrDataUrl,
    enterpriseUrl: organization ? `${getOrigin(req)}/e/${organization.slug}/collect/${task.token}` : '',
  }
  if (includeManage) {
    payload.manageToken = task.manageToken
    payload.manageUrl = `${getOrigin(req)}/collect/manage/${task.manageToken}`
  }
  return payload
}

export async function ensureCollectionQrDataUrl(task, req) {
  if (!task || task.qrDataUrl) return false
  task.qrDataUrl = await QRCode.toDataURL(`${getOrigin(req)}/collect/${task.token}`, { width: 180, margin: 1 })
  return true
}

export function managerCollection(task, req) {
  return {
    ...publicCollection(task, req, true),
    submissions: task.submissions.map(publicSubmission),
    downloadUrl: `${getOrigin(req)}/api/collections/manage/${task.manageToken}/download`,
  }
}

export function collectionZipEntries(task, targetSubmission = null) {
  const submissions = targetSubmission ? [targetSubmission] : task.submissions
  return submissions.flatMap((submission) => {
    const folder = targetSubmission ? '' : `${submission.participantName || '提交文件'}-${submission.id.slice(0, 6)}`
    return submission.files.map((file) => ({
      path: path.join(collectionsRoot, task.id, submission.id, file.storedName),
      name: zipEntryPath(folder, file.relativePath),
      size: file.size,
    }))
  })
}

export function applyCollectionUpdate(task, body = {}) {
  if (Object.prototype.hasOwnProperty.call(body, 'title')) {
    const title = String(body.title || '').trim()
    if (!title) throw httpError(400, '请填写任务名称')
    task.title = title
  }
  if (Object.prototype.hasOwnProperty.call(body, 'description')) {
    task.description = String(body.description || '').trim() || '请上传你负责的文件'
  }
  if (Object.prototype.hasOwnProperty.call(body, 'deadline')) {
    const deadline = normalizeExpiryInput(body.deadline, '截止时间')
    if (!deadline) throw httpError(400, '截止时间格式不正确')
    task.deadline = deadline
    if (task.status === 'expired' && new Date(task.deadline).getTime() > Date.now()) {
      task.status = 'active'
    }
    if (task.notificationFlags?.collectionExpiring) task.notificationFlags = { ...task.notificationFlags, collectionExpiring: false }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'allowedTypes')) {
    task.allowedTypes = normalizeCollectionAllowedTypes(body.allowedTypes)
  }
  if (Object.prototype.hasOwnProperty.call(body, 'maxFileSizeMb')) {
    const maxFileSizeMb = Number(body.maxFileSizeMb)
    if (!Number.isFinite(maxFileSizeMb) || maxFileSizeMb <= 0) throw httpError(400, '单人大小限制不正确')
    task.maxFileSizeMb = Math.floor(maxFileSizeMb)
  }
  if (Object.prototype.hasOwnProperty.call(body, 'status')) {
    const status = String(body.status || '').trim()
    if (!['active', 'closed'].includes(status)) throw httpError(400, '收集任务状态不支持')
    if (status === 'active' && new Date(task.deadline).getTime() <= Date.now()) {
      throw httpError(400, '截止时间已过，请先延长截止时间')
    }
    task.status = status
  }
}
