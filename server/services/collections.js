import { assertActiveCollectionLimit, collectionFileLimitBytes, collectionParticipantCount, personalEntitlements } from './entitlements.js'
// 收集（匿名文件收集）域业务逻辑
//
// 依赖方向（单向）：本模块只依赖 config / state / lib / services/*，
// 不 import server.mjs，也不 import routes。
//
// 说明：collect 相关的大量校验函数（validateCollection / assertCollectionFiles /
// publicSubmission 等）上一轮随 shares 域迁出（上传/分享/收集共用文件流转逻辑），
// 本模块从其 import。

import {
  COLLECTION_DESCRIPTION_MAX, COLLECTION_TITLE_MAX, collectionsRoot
} from '../config.js'
import {
  httpError
} from '../lib/http.js'
import {
  accountUserById, authSessionFromRequest, currentCollectionStatus, displayAccountName, fileListSize, getOrigin
} from '../services/account.js'
import {
  collectionCapacityBytes, resourceEnterpriseOrganization, collectionTypesInput,
  normalizeExpiryInput, publicSubmission, zipEntryPath
} from '../services/shares.js'
import { integerInput, objectInput, textInput } from '../lib/input-validation.js'
import path from 'node:path'
import QRCode from 'qrcode'
import { publicTeamBrand } from '../lib/team-branding.js'

// 收集人展示名：公开提交页要写「收集人「xxx」已收到」，只暴露昵称/用户名，不暴露邮箱手机号。
export function collectionOwnerName(task = {}) {
  const owner = task.ownerUserId ? accountUserById(task.ownerUserId) : null
  return owner ? displayAccountName(owner) : '收集人'
}

// 410（已关闭/已截止）时给公开提交页的脱敏元信息：标题、截止时间、参与人数、收集人展示名。
export function collectionClosedMeta(task = {}) {
  const status = currentCollectionStatus(task)
  const deadlinePassed = Boolean(task.deadline && new Date(task.deadline).getTime() <= Date.now())
  return {
    state: status === 'expired' || deadlinePassed ? 'expired' : 'closed',
    title: task.title || '',
    deadline: task.deadline || '',
    participantCount: collectionParticipantCount(task),
    ownerName: collectionOwnerName(task),
  }
}

export function publicCollection(task, req, includeManage = false) {
  const organization = resourceEnterpriseOrganization(task)
  const status = currentCollectionStatus(task)
  const payload = {
    id: task.id,
    token: task.token,
    title: task.title,
    description: task.description,
    ownerName: collectionOwnerName(task),
    deadline: task.deadline,
    allowedTypes: task.allowedTypes,
    materials: Array.isArray(task.materials) ? task.materials : [],
    customFields: Array.isArray(task.customFields) ? task.customFields : [],
    maxFileSizeMb: Math.min(collectionFileLimitBytes(task), includeManage ? Infinity : personalEntitlements(authSessionFromRequest(req)?.user?.id).singleFileLimitBytes) / 1024 ** 2,
    maxConfigurableFileSizeMb: Math.floor(personalEntitlements(task.ownerUserId).singleFileLimitBytes / 1024 ** 2),
    participantLimit: personalEntitlements(task.ownerUserId).collectionParticipantLimit,
    participantCount: collectionParticipantCount(task),
    capacityBytes: collectionCapacityBytes(task),
    usedBytes: task.submissions.reduce((sum, submission) => sum + fileListSize(submission.files), 0),
    status,
    submissionCount: task.submissions.length,
    publicUrl: `${getOrigin(req)}/collect/${task.token}`,
    qrDataUrl: task.qrDataUrl,
    enterpriseUrl: organization ? `${getOrigin(req)}/e/${organization.slug}/collect/${task.token}` : '',
    branding: organization && req.query?.organization === organization.slug ? publicTeamBrand(organization) : null,
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
  const submissions = task.submissions.map(publicSubmission)
  const requiredMaterialIds = (task.materials || []).filter((material) => material.required).map((material) => material.id)
  const materialGroups = new Map()
  for (const submission of task.submissions) {
    const key = submission.submitterUserId
      ? `user:${submission.submitterUserId}`
      : submission.participantKey
        ? `participant:${submission.participantKey}`
        : `submission:${submission.id}`
    const submitted = materialGroups.get(key) || new Set()
    for (const id of submission.materialIds || []) submitted.add(id)
    materialGroups.set(key, submitted)
  }
  const missingBySubmission = new Map()
  for (const submission of task.submissions) {
    const key = submission.submitterUserId
      ? `user:${submission.submitterUserId}`
      : submission.participantKey
        ? `participant:${submission.participantKey}`
        : `submission:${submission.id}`
    const submitted = materialGroups.get(key) || new Set()
    missingBySubmission.set(submission.id, requiredMaterialIds.filter((id) => !submitted.has(id)))
  }
  return {
    ...publicCollection(task, req, true),
    submissions: submissions.map((submission) => ({ ...submission, missingMaterialIds: missingBySubmission.get(submission.id) || [] })),
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
  objectInput(body, ['title','description','deadline','allowedTypes','maxFileSizeMb','status'], {nonempty:true})
  const draft = structuredClone(task)
  applyCollectionUpdateDraft(draft, body)
  if (currentCollectionStatus(draft) === 'active' && currentCollectionStatus(task) !== 'active') assertActiveCollectionLimit(task.ownerUserId, task.ownerGuestKey, task.id)
  Object.assign(task, draft)
}
function applyCollectionUpdateDraft(task, body = {}) {
  if (Object.prototype.hasOwnProperty.call(body, 'title')) {
    const title = textInput(body.title, '任务名称', COLLECTION_TITLE_MAX)
    if (!title) throw httpError(400, '请填写任务名称')
    if (title.length > COLLECTION_TITLE_MAX) throw httpError(400, `任务名称不能超过 ${COLLECTION_TITLE_MAX} 个字`)
    task.title = title
  }
  if (Object.prototype.hasOwnProperty.call(body, 'description')) {
    const description = textInput(body.description, '收集说明', COLLECTION_DESCRIPTION_MAX, {optional:true,multiline:true})
    if (description.length > COLLECTION_DESCRIPTION_MAX) throw httpError(400, `收集说明不能超过 ${COLLECTION_DESCRIPTION_MAX} 个字`)
    task.description = description || '请上传你负责的文件'
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
    task.allowedTypes = collectionTypesInput(body.allowedTypes)
  }
  if (Object.prototype.hasOwnProperty.call(body, 'maxFileSizeMb')) {
    const maxFileSizeMb = integerInput(body.maxFileSizeMb,'单文件大小限制',1,Math.floor(personalEntitlements(task.ownerUserId).singleFileLimitBytes / 1024 ** 2))
    if (!Number.isFinite(maxFileSizeMb) || maxFileSizeMb <= 0) throw httpError(400, '单人大小限制不正确')
    task.maxFileSizeMb = Math.floor(maxFileSizeMb)
  }
  if (Object.prototype.hasOwnProperty.call(body, 'status')) {
    const status = textInput(body.status, '收集任务状态', 20)
    if (!['active', 'closed'].includes(status)) throw httpError(400, '收集任务状态不支持')
    if (status === 'active' && new Date(task.deadline).getTime() <= Date.now()) {
      throw httpError(400, '截止时间已过，请先延长截止时间')
    }
    task.status = status
  }
}
