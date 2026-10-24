import { createToken, httpError } from '../lib/http.js'
import { metadata, persistMetadata } from '../lib/metadata-store.js'
import {
  accountMessagesForUser, accountOrganizationForUser, accountUserById, addAccountMessage,
  displayAccountName, organizationTeamPlanExpiresAtForOrganization, organizationTeamPlanForOrganization,
  recordAuditLog, syncAccountUserSessions, upsertAccountUser,
} from './account.js'

export const OWNERSHIP_HANDOVER_TTL_MS = 7 * 86400000

const outcomeLabels = {
  accepted: '已完成', declined: '已拒绝', canceled: '已取消', expired: '已过期', invalidated: '已失效',
}

function activeAccount(user) {
  return Boolean(user && !['disabled', 'banned'].includes(user.status))
}

function invalidReason(organization, handover) {
  if (organization.ownerUserId !== handover.fromUserId) return '团队所有者已变更'
  if (!activeAccount(accountUserById(handover.fromUserId))) return '原所有者账号已停用或不存在'
  if (!organization.members.some(member => member.userId === handover.fromUserId && member.status === 'active')) return '原所有者已不在团队中'
  const recipient = accountUserById(handover.toUserId)
  if (!activeAccount(recipient)) return '接收者账号已停用或不存在'
  if (!organization.members.some(member => member.id === handover.toMemberId && member.userId === handover.toUserId && member.status === 'active')
    || accountOrganizationForUser(handover.toUserId)?.id !== organization.id
    || (recipient.organizationId && recipient.organizationId !== organization.id)) return '接收者已不是本团队的有效成员'
  return ''
}

function finishHandover(organization, handover, status, actorUserId, reason = '') {
  const now = new Date().toISOString()
  Object.assign(handover, { status, resolvedAt: now, resolvedByUserId: actorUserId || '', reason })
  organization.updatedAt = now
  const body = `团队“${organization.name}”由${handover.fromName}向${handover.toName}发起的负责人交接${outcomeLabels[status]}。${reason ? `${reason}。` : ''}`
  // 已关闭通知也必须能处理授权待办；原消息直接更新，旧按钮不会继续看似可操作。
  for (const message of accountMessagesForUser(handover.toUserId)) {
    if (message.actionType !== 'workspace_ownership_handover' || message.actionId !== handover.id) continue
    message.actionType = 'workspace_ownership_handover_resolved'
    message.body = body
    message.unread = false
    message.readAt = now
  }
  addAccountMessage(handover.fromUserId, {
    category: 'other', eventType: 'teamOwnership', title: `负责人交接${outcomeLabels[status]}`,
    body, actionUrl: '/team?tab=handover',
  }, { respectSettings: false })
  recordAuditLog({
    type: 'team', action: status === 'accepted' ? '转让团队所有权' : `负责人交接${outcomeLabels[status]}`,
    userId: actorUserId || handover.fromUserId, targetId: handover.toUserId,
    details: {
      organizationId: organization.id, handoverId: handover.id,
      previousOwnerId: handover.fromUserId, fromUserId: handover.fromUserId, toUserId: handover.toUserId,
      initiatedAt: handover.initiatedAt, resolvedAt: now, status, reason,
      ...(status === 'accepted' ? {
        teamPlanId: organization.teamPlanId, teamPlanExpiresAt: organization.teamPlanExpiresAt,
        teamPlanPermanent: organization.teamPlanPermanent,
      } : {}),
    },
  })
}

// 同步校验和变更之间无 await：同一服务进程内的并发决定只允许一次成功。
// 不依赖浏览器缓存中的角色、成员状态、旧邀请链接或客户端传入的负责人。
export function reconcileOwnershipHandover(organization) {
  const handover = organization?.ownershipHandovers?.find(item => item.status === 'pending')
  if (!handover) return null
  const reason = invalidReason(organization, handover)
  if (reason) finishHandover(organization, handover, 'invalidated', '', reason)
  else if (!Number.isFinite(Date.parse(handover.expiresAt)) || Date.parse(handover.expiresAt) <= Date.now()) {
    finishHandover(organization, handover, 'expired', '', '超过 7 天未处理，请由所有者重新发起')
  } else return handover
  persistMetadata()
  return null
}

export function initiateOwnershipHandover(organization, ownerId, targetMemberId) {
  if (organization.ownerUserId !== ownerId) throw httpError(403, '只有团队所有者可以发起负责人交接')
  const previousOwner = accountUserById(ownerId)
  if (!activeAccount(previousOwner) || !organization.members.some(member => member.userId === ownerId && member.status === 'active')) {
    throw httpError(403, '当前所有者账号或团队成员身份无效')
  }
  const member = organization.members.find(item => item.id === targetMemberId && item.status === 'active')
  if (!member) throw httpError(400, '只能交接给已加入本团队的正式成员')
  if (member.userId === ownerId) throw httpError(400, '你已经是团队所有者')
  const recipient = accountUserById(member.userId)
  if (!activeAccount(recipient)) throw httpError(400, '接收者账号已停用或不存在，请选择有效成员')
  if (accountOrganizationForUser(recipient.id)?.id !== organization.id
    || (recipient.organizationId && recipient.organizationId !== organization.id)) throw httpError(409, '接收者的团队归属已变更')
  const pending = reconcileOwnershipHandover(organization)
  if (pending) {
    if (pending.toMemberId === targetMemberId) return { handover: pending, reused: true }
    throw httpError(409, '已有待确认的负责人交接，请先取消或等待接收者处理')
  }
  const now = new Date().toISOString()
  const handover = {
    id: createToken(16), fromUserId: ownerId, toUserId: recipient.id, toMemberId: member.id,
    fromName: displayAccountName(previousOwner), toName: displayAccountName(recipient),
    status: 'pending', initiatedAt: now, expiresAt: new Date(Date.now() + OWNERSHIP_HANDOVER_TTL_MS).toISOString(),
    resolvedAt: null, resolvedByUserId: '', reason: '',
  }
  organization.ownershipHandovers = [handover, ...(organization.ownershipHandovers || [])]
  organization.updatedAt = now
  addAccountMessage(recipient.id, {
    category: 'other', eventType: 'teamOwnership', title: '待确认的团队负责人交接',
    body: `${handover.fromName}邀请你接管团队“${organization.name}”。接受后你成为所有者，对方变为普通成员；团队套餐、文件和原任务归属保留。请在 7 天内处理。`,
    actionType: 'workspace_ownership_handover', actionId: handover.id, actionUrl: '/team?tab=handover',
  }, { respectSettings: false })
  recordAuditLog({ type: 'team', action: '发起负责人交接', userId: ownerId, targetId: recipient.id,
    details: { organizationId: organization.id, handoverId: handover.id, fromUserId: ownerId, toUserId: recipient.id, initiatedAt: now, expiresAt: handover.expiresAt } })
  persistMetadata()
  return { handover, reused: false }
}

export function respondOwnershipHandover(organization, handover, actorId, decision) {
  if (decision === 'cancel') {
    if (actorId !== handover.fromUserId || organization.ownerUserId !== actorId) throw httpError(403, '只有发起交接的当前所有者可以取消')
  } else if (actorId !== handover.toUserId) throw httpError(403, '只有指定接收者可以处理这次交接')

  reconcileOwnershipHandover(organization)
  const expectedStatus = { accept: 'accepted', decline: 'declined', cancel: 'canceled' }[decision]
  if (handover.status === expectedStatus) return { handover, reused: true }
  if (handover.status !== 'pending') throw httpError(handover.status === 'expired' ? 410 : 409, `该交接${outcomeLabels[handover.status] || '已处理'}，请刷新后查看`)
  if (decision === 'accept') {
    const previousOwner = accountUserById(handover.fromUserId)
    const nextOwner = accountUserById(handover.toUserId)
    const now = new Date().toISOString()
    // 团队套餐属于组织，与新所有者的个人套餐分别计算。
    const teamPlan = organizationTeamPlanForOrganization(organization)
    organization.teamPlanId = teamPlan.id
    organization.teamPlanStartedAt = organization.teamPlanStartedAt || previousOwner.planStartedAt || now
    organization.teamPlanExpiresAt = organizationTeamPlanExpiresAtForOrganization(organization)
    organization.teamPlanPermanent = teamPlan.permanent
    organization.ownerUserId = nextOwner.id
    for (const member of organization.members) {
      if (member.userId === nextOwner.id) member.role = 'owner'
      else if (member.userId === previousOwner.id || member.role === 'owner') member.role = 'member'
    }
    for (const [account, role] of [[previousOwner, 'member'], [nextOwner, 'owner']]) {
      Object.assign(account, { organizationId: organization.id, organizationRole: role, updatedAt: now })
      upsertAccountUser(account)
      syncAccountUserSessions(account)
    }
  }
  finishHandover(organization, handover, expectedStatus, actorId)
  persistMetadata()
  return { handover, reused: false }
}

export function cancelOwnershipHandoverForDissolution(organization, ownerId) {
  const pending = organization.ownershipHandovers?.find(item => item.status === 'pending')
  if (pending) finishHandover(organization, pending, 'canceled', ownerId, '团队已解散')
}

export function findOwnershipHandover(id, viewerId) {
  for (const organization of Object.values(metadata.organizations || {})) {
    const handover = organization.ownershipHandovers?.find(item => item.id === id)
    if (handover && [handover.fromUserId, handover.toUserId].includes(viewerId)) return { organization, handover }
  }
  return null
}
