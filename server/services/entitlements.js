// Shared runtime entitlement rules for every upload/collection entry point.
import { MAX_FILE_SIZE } from '../config.js'
import { normalizeSystemConfig } from '../lib/metadata-normalizers.js'
import { metadata } from '../lib/metadata-store.js'
import { httpError } from '../lib/http.js'
import { accountPlanForUser, accountUserById, accountOrganizationPlanForUser, authSessionFromRequest, currentCollectionStatus } from './account.js'

export function personalEntitlements(userId = '') {
  if (userId) return accountPlanForUser(accountUserById(userId) || {})
  const config = normalizeSystemConfig(metadata.systemConfig)
  return {
    id: 'anonymous', singleFileLimitBytes: Math.round(config.anonymousMaxFileSizeMb * 1024 ** 2),
    collectionParticipantLimit: config.anonymousCollectionParticipantLimit,
    activeCollectionLimit: config.anonymousActiveCollectionLimit,
  }
}

export function collectionFileLimitBytes(task) {
  return Math.min(MAX_FILE_SIZE, Number(task.maxFileSizeMb) * 1024 ** 2, personalEntitlements(task.ownerUserId).singleFileLimitBytes)
}

export function requestUploadLimitBytes(req, context = {}) {
  const userId = authSessionFromRequest(req)?.user?.id || ''
  const token = context.collectionToken || req.params?.token || req.body?.collectionToken
  const task = token && metadata.collections.find(task => task.token === token)
  if (task) return Math.min(personalEntitlements(userId).singleFileLimitBytes, collectionFileLimitBytes(task))
  if ((context.mode || req.body?.mode || req.query?.mode) === 'team_resource' && userId) {
    const plan = accountOrganizationPlanForUser(userId)
    if (!plan.team) throw httpError(403, '管理员已调整当前套餐，请购买团队套餐后使用团队功能')
    return Math.min(MAX_FILE_SIZE, plan.singleFileLimitBytes)
  }
  return Math.min(MAX_FILE_SIZE, personalEntitlements(userId).singleFileLimitBytes)
}

export function assertFileEntitlement(files, limit) {
  const file = files.find(file => Number(file.size || 0) > limit)
  if (file) throw httpError(413, `${file.originalname || file.name || '文件'} 超过当前单文件上限 ${Number((limit / 1024 ** 3).toFixed(3))} GB`)
}

export function participantIdentity(submission) {
  return submission.submitterUserId ? `user:${submission.submitterUserId}` : submission.participantKey || `legacy:${submission.id}`
}

export function collectionParticipantCount(task) {
  return new Set(task.submissions.map(participantIdentity)).size
}

export function assertCollectionParticipant(task, submitter) {
  const limit = personalEntitlements(task.ownerUserId).collectionParticipantLimit
  if (!limit) return
  const identities = new Set(task.submissions.map(participantIdentity))
  if (!identities.has(participantIdentity(submitter)) && identities.size >= limit) throw httpError(409, `此收集任务已达到 ${limit} 人的提交上限，请联系发起人`)
}

export function assertActiveCollectionLimit(ownerUserId, guestKey = '', excludeId = '') {
  const limit = personalEntitlements(ownerUserId).activeCollectionLimit
  if (!limit) return
  const count = metadata.collections.filter(task => task.id !== excludeId && !task.cleanedAt && currentCollectionStatus(task) === 'active'
    && (ownerUserId ? task.ownerUserId === ownerUserId : !task.ownerUserId && task.ownerGuestKey === guestKey)).length
  if (count >= limit) throw httpError(409, `当前最多同时进行 ${limit} 个收集任务，请先关闭已有任务或升级套餐`)
}
