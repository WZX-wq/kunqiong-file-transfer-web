// 账号域业务逻辑
//
// 覆盖：身份与会话（登录/OAuth/验证码/绑定）、账号数据（记录/站内消息/通知设置/清理），
//       套餐与用量、升级订单与支付对账、团队组织与入团申请。
//
// 依赖方向（单向，不得反向）：本模块只依赖 config / state / lib，
// 不 import server.mjs，也不 import routes。
//
// 说明：本域内部「身份 / 套餐 / 组织 / 数据」四块互相引用密度极高，
// 实测 4 个子域之间存在 11 条双向环（每一对都有双向边），
// 硬拆成子模块必须引入大范围注入，得不偿失 —— 故保持单一模块。

import path from 'node:path'
import crypto from 'node:crypto'
import nodemailer from 'nodemailer'
import QRCode from 'qrcode'

import {
  ACCOUNT_PLANS, ACCOUNT_PLAN_RANK, ACCOUNT_SINGLE_FILE_BYTES, AUTH_COOKIE_NAME,
  DEFAULT_ACCOUNT_MESSAGES, DEFAULT_WEB_MEMBER_PACKAGE_IDS, EXPIRING_SOON_MS,
  JOIN_REQUEST_MAX_PER_WINDOW, JOIN_REQUEST_REJECT_COOLDOWN_MS, JOIN_REQUEST_WINDOW_MS,
  MAX_ACCOUNT_RECORDS, MAX_VERIFICATION_CODES, OAUTH_STATE_TTL_MS,
  PAYMENT_QUERY_RETENTION_MS, VERIFICATION_CODE_TTL_MS, WEB_MEMBER_PACKAGE_ENV_KEYS,
  collectionsRoot, configuredAppUrl, configuredCallbackUrls, filesRoot, oauthClientId,
  oauthClientSecret, serverPort, smtpFrom, smtpHost, smtpPassword, smtpPort, smtpSecure,
  smtpUser, testEnforceEnterpriseAllowlist, tencentSmsBindTemplateId, tencentSmsRegion, tencentSmsSdkAppId,
  tencentSmsSecretId, tencentSmsSecretKey, tencentSmsSignName, webMemberApiBase,
  webMemberSubsiteName,
} from '../config.js'

import {
  createToken, firstHeader, firstValue, hashSecret, httpError, removeDirectory,
} from '../lib/http.js'

import {
  accountRecordOwnerKey, compareAccountRecords, configuredAccountPlan, mergeAccountRecord,
  mergeAccountUser, normalizeAccountMessage, normalizeAccountMessages,
  normalizeAccountRecords, normalizeAccountUser, normalizeEmailValue,
  normalizeFileCleanupSettings, normalizeNonNegativeInteger, normalizeNotificationSettings,
  normalizePaymentPayload, normalizePaymentQueryCredential,
  normalizePhoneValue, normalizePlanId, normalizeVerificationCodes, normalizeWebMemberPayType,
  publicUser, trimRecordString,
} from '../lib/metadata-normalizers.js'

import { metadata, persistMetadata, persistAuditLog } from '../lib/metadata-store.js'
import { contactMatchesUser } from '../lib/contact-input.js'
import { booleanInput, dateInput, integerInput, objectInput } from '../lib/input-validation.js'

import { normalizeUploadFileName } from '../lib/upload.js'

import {
  joinRequestAttempts, oauthStates, paymentReconcileAttempts, paymentSessionTokens, remotePricingCache, runtime,
  upgradeOrderLocks, verificationIpAttempts, verificationTargetLastSent,
} from '../state.js'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

export function updateFileCleanupSettings(req, res) {
  const session = authSessionFromRequest(req)
  if (!session) return res.status(401).json({ message: '请先登录' })
  const input = objectInput(req.body?.settings, ['enabled','days'], { nonempty:true })
  const settings = { ...normalizeFileCleanupSettings(accountUserById(session.user.id)?.fileCleanup) }
  if (Object.hasOwn(input,'enabled')) settings.enabled = booleanInput(input.enabled,'文件清理开关')
  if (Object.hasOwn(input,'days')) {
    const days = integerInput(input.days,'清理天数',1,7)
    if (![1,3,7].includes(days)) throw httpError(400,'清理天数仅支持 1、3、7 天')
    settings.days = days
  }
  session.user = { ...session.user, fileCleanup: settings }
  const user = upsertAccountUser(session.user)
  syncAccountUserSessions(user)
  cleanupExpired()
  persistMetadata()
  res.json({ user: publicAccountUser(user), settings })
}

// 验证码发送限流：同一目标 60s 1 次、同一来源 IP 每小时 10 次，防止刷短信/邮件造成资损。
const VERIFICATION_TARGET_COOLDOWN_MS = 60 * 1000
const VERIFICATION_IP_WINDOW_MS = 60 * 60 * 1000
const VERIFICATION_IP_MAX = 10
// 限流计数表在 server/state.js

export function verificationSendBlocked(target, req) {
  const now = Date.now()
  const targetKey = `${target.type}:${target.value}`
  const ipKey = `socket:${String(req.socket?.remoteAddress || '').trim() || 'unknown'}`
  if (verificationTargetLastSent.size + verificationIpAttempts.size > 5000) {
    for (const [key, at] of verificationTargetLastSent) {
      if (now - at > VERIFICATION_TARGET_COOLDOWN_MS) verificationTargetLastSent.delete(key)
    }
    for (const [key, entry] of verificationIpAttempts) {
      if (now - entry.startedAt > VERIFICATION_IP_WINDOW_MS) verificationIpAttempts.delete(key)
    }
  }
  const lastSent = verificationTargetLastSent.get(targetKey)
  if (lastSent && now - lastSent < VERIFICATION_TARGET_COOLDOWN_MS) {
    return '验证码发送过于频繁，请 1 分钟后再试'
  }
  const ipEntry = verificationIpAttempts.get(ipKey)
  if (ipEntry && now - ipEntry.startedAt <= VERIFICATION_IP_WINDOW_MS && ipEntry.count >= VERIFICATION_IP_MAX) {
    return '验证码发送过于频繁，请稍后再试'
  }
  verificationTargetLastSent.set(targetKey, now)
  const current = verificationIpAttempts.get(ipKey)
  if (!current || now - current.startedAt > VERIFICATION_IP_WINDOW_MS) {
    verificationIpAttempts.set(ipKey, { count: 1, startedAt: now })
  } else {
    current.count += 1
  }
  return null
}

export function upgradeOrderSummary(order = {}) {
  const plan = configuredAccountPlan(order.planId)
  return {
    id: order.id,
    orderNo: order.orderNo,
    planId: order.planId,
    planLabel: plan.label,
    status: order.status,
    amount: order.amount,
    payType: order.payType || 1,
    remoteOrderNo: order.remoteOrderNo || '',
    remotePackageId: order.remotePackageId || null,
    remotePackageName: order.remotePackageName || '',
    remotePackageDays: order.remotePackageDays || null,
    payment: publicPaymentPayload(order.payment),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    paidAt: order.paidAt,
    remoteExpireAt: order.remoteExpireAt || null,
  }
}

export function upgradeOrdersForUser(userId) {
  const key = String(userId || '')
  return (metadata.upgradeOrders || []).filter((order) => order.userId === key)
}

export function findUpgradeOrder(orderId, userId) {
  return (metadata.upgradeOrders || []).find((order) => order.id === orderId && order.userId === userId) || null
}

export function recordAuditLog(entry = {}) {
  persistAuditLog({
    id: createToken(12),
    type: trimRecordString(entry.type, 30) || 'access',
    action: trimRecordString(entry.action, 180),
    status: normalizeNonNegativeInteger(entry.status),
    durationMs: normalizeNonNegativeInteger(entry.durationMs),
    userId: trimRecordString(entry.userId, 120),
    targetId: trimRecordString(entry.targetId, 160),
    ip: trimRecordString(entry.ip, 80),
    details: entry.details && typeof entry.details === 'object' ? entry.details : {},
    createdAt: new Date().toISOString(),
  })
}

export function accountPlanRank(planId) {
  return ACCOUNT_PLAN_RANK[normalizePlanId(planId)] ?? 0
}

export function configuredAccountPlans() {
  return Object.keys(ACCOUNT_PLANS).map(configuredAccountPlan)
}

export function accountPlanForUser(user = {}) {
  const plan = configuredAccountPlan(user.planId)
  const expiresAt = user.planExpiresAt ? new Date(user.planExpiresAt).getTime() : 0
  if (plan.id !== 'free' && Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt <= Date.now()) return configuredAccountPlan('free')
  return plan
}

// 个人套餐 = 用户**自己**订购的套餐，只取决于 user.planId，与团队归属无关。
// 这是个人空间容量、永久保存、单文件上限等「个人权益」的唯一依据。
export function accountPersonalPlanForUser(user = {}) {
  const directUser = typeof user === 'string' ? accountUserById(user) || {} : user
  return accountPlanForUser(directUser)
}

// 团队权益 = 用户所在团队空间**所有者**的套餐所提供的协作能力（团队空间容量、
// 成员管理、企业专属入口）。加入别人的团队只共享这些团队侧能力。
//
// ⚠️ 关键约束：**加入团队不得提升个人套餐**。
// 此前 accountEffectivePlanForUser 会在「个人是 free」时直接返回所有者的套餐，
// 导致基础版用户加入企业版团队后，个人账户被误判成企业版
// （个人空间 20GB 变 2048GB、临时保存变永久保存、后台用户列表也显示企业版）。
// 现在个人套餐与团队权益彻底分离：个人套餐永远只看自己。
export function accountTeamEntitlementForUser(user = {}) {
  const userId = typeof user === 'string' ? user : user?.id
  const personal = accountPersonalPlanForUser(user)
  // 自己就是团队所有者：团队权益即自己套餐的团队能力
  const organization = accountOrganizationForUser(userId)
  if (!organization) return personal
  if (organization.ownerUserId === userId) return personal
  // 普通成员：借用所有者套餐里的**团队侧**能力，但仅限 teamSpaceBytes / team 开关，
  // 绝不把 owner 的 totalBytes / permanent / label 套到成员头上。
  const ownerPlan = accountPersonalPlanForUser(accountUserById(organization.ownerUserId) || {})
  if (!ownerPlan.team) return personal
  return { ...personal, team: true, teamSpaceBytes: Number(ownerPlan.teamSpaceBytes || 0) }
}

// 对外语义的「当前权益」：个人套餐为主，叠加团队协作能力。
// 用于前端展示与需要「既看个人又看团队」的判定。
export function accountEffectivePlanForUser(user = {}) {
  return accountTeamEntitlementForUser(user)
}

// 团队空间容量：唯一来源是**所有者**的套餐（团队空间属于所有者）。
export function organizationTeamSpaceBytes(organization) {
  if (!organization) return 0
  const ownerPlan = accountPersonalPlanForUser(accountUserById(organization.ownerUserId) || {})
  return ownerPlan.team ? Number(ownerPlan.teamSpaceBytes || 0) : 0
}

export function publicOrganization(organization, viewerId = '') {
  if (!organization) return null
  const isOwner = organization.ownerUserId === viewerId
  const isManager = isOrganizationManager(organization, viewerId)
  const visibleMembers = organization.members.filter(member => isManager ? member.status !== 'requested' : member.status === 'active')
  return {
    id: organization.id,
    slug: organization.slug,
    name: organization.name,
    ownerUserId: organization.ownerUserId,
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
    members: visibleMembers.map(member => publicOrganizationMember(organization, member, viewerId)),
    isOwner,
  }
}

export function organizationRoleForUser(organization, userId) {
  if (!organization || !userId) return ''
  if (organization.ownerUserId === userId) return 'owner'
  const member = organization.members.find(item => item.userId === userId && item.status === 'active')
  return member ? (member.role === 'admin' ? 'admin' : 'member') : ''
}

export function publicOrganizationMember(organization, member, viewerId) {
  const isOwner = organization.ownerUserId === viewerId
  const isManager = isOrganizationManager(organization, viewerId)
  const contactsVisible = isManager || member.userId === viewerId
  const email = normalizeEmailValue(member.email)
  const phone = normalizePhoneValue(member.phone)
  const role = organization.ownerUserId === member.userId ? 'owner' : member.role === 'admin' ? 'admin' : 'member'
  const account = accountUserById(member.userId)
  const accountActive = Boolean(account && account.status !== 'disabled')
  return {
    id: member.id, userId: member.userId, displayName: member.displayName, role, status: member.status,
    email: contactsVisible ? email : email ? `${email.slice(0, 1)}***@${email.split('@')[1]}` : '',
    phone: contactsVisible ? phone : phone ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : '',
    joinedAt: member.joinedAt || null, invitedAt: member.invitedAt || null,
    canRemove: isManager && role !== 'owner' && (isOwner || role === 'member'),
    canChangeRole: isOwner && role !== 'owner' && member.status === 'active' && accountActive,
    canTransfer: isOwner && role !== 'owner' && member.status === 'active' && accountActive,
  }
}

export function accountOrganizationForUser(userId) {
  const key = String(userId || '')
  if (!key) return null
  return Object.values(metadata.organizations || {}).find((organization) => organization.ownerUserId === key || organization.members.some((member) => member.userId === key && member.status === 'active')) || null
}

export function isOrganizationManager(organization, userId) {
  return ['owner', 'admin'].includes(organizationRoleForUser(organization, userId))
}

export function organizationBySlug(slug) {
  const key = trimRecordString(slug, 80)
  if (!key) return null
  return Object.values(metadata.organizations || {}).find((organization) => organization.slug === key) || null
}

export function isJoinRequestRateLimited(ip, userId) {
  const key = `${ip || 'unknown'}::${userId || 'anonymous'}`
  const now = Date.now()
  const record = joinRequestAttempts.get(key)
  if (!record || now - record.startedAt > JOIN_REQUEST_WINDOW_MS) return false
  return record.count >= JOIN_REQUEST_MAX_PER_WINDOW
}

export function recordJoinRequestAttempt(ip, userId) {
  const key = `${ip || 'unknown'}::${userId || 'anonymous'}`
  const now = Date.now()
  const record = joinRequestAttempts.get(key)
  if (!record || now - record.startedAt > JOIN_REQUEST_WINDOW_MS) {
    joinRequestAttempts.set(key, { count: 1, startedAt: now })
    return
  }
  record.count += 1
}

export function joinRequestCooldownRemaining(organization, userId) {
  const previous = organization.members.find((member) => member.userId === userId && member.status !== 'active' && member.reviewedAt && member.joinSource === 'request')
  if (!previous) return 0
  const elapsed = Date.now() - new Date(previous.reviewedAt).getTime()
  return Math.max(0, JOIN_REQUEST_REJECT_COOLDOWN_MS - elapsed)
}

export function publicJoinRequest(member, organization) {
  return {
    id: member.id,
    requestId: member.joinRequestId || member.id,
    userId: member.userId,
    displayName: member.displayName,
    email: member.email,
    phone: member.phone,
    message: member.joinMessage || '',
    requestedAt: member.requestedAt || member.invitedAt || organization?.updatedAt || null,
  }
}

export function publicJoinRequestsForOrganization(organization) {
  if (!organization) return []
  return organization.members
    .filter((member) => member.status === 'requested')
    .map((member) => publicJoinRequest(member, organization))
    .sort((a, b) => new Date(b.requestedAt || 0).getTime() - new Date(a.requestedAt || 0).getTime())
}

export function createOrganization(user, name) {
  const id = createToken(12)
  const organization = {
    id,
    slug: `team-${createToken(6)}`,
    name,
    ownerUserId: user.id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    members: [{
      id: createToken(12),
      userId: user.id,
      email: normalizeEmailValue(user.email),
      phone: normalizePhoneValue(user.phone),
      displayName: displayAccountName(user),
      role: 'owner',
      status: 'active',
      joinedAt: new Date().toISOString(),
      invitedAt: null,
    }],
  }
  metadata.organizations[id] = organization
  const account = accountUserById(user.id) || user
  account.organizationId = id
  account.organizationRole = 'owner'
  account.updatedAt = new Date().toISOString()
  upsertAccountUser(account)
  syncAccountUserSessions(account)
  return organization
}

// 组织 roster 上的 displayName / email / phone 是「入团那一刻」的快照，
// 用户之后改昵称不会回写，团队空间就会一直显示旧名字。这里按 userId 反查账号做一次同步。
export function syncOrganizationMemberProfile(user = {}) {
  const userId = trimRecordString(user?.id, 120)
  if (!userId) return false
  const displayName = displayAccountName(user)
  const email = normalizeEmailValue(user.email)
  const phone = normalizePhoneValue(user.phone)
  let changed = false
  for (const organization of Object.values(metadata.organizations || {})) {
    // 每个组织单独记变更：changed 若只在循环外声明，第一个组织改到后
    // 后续组织的 updatedAt 都会被无谓地刷新一遍。
    let organizationChanged = false
    for (const member of organization.members || []) {
      if (member.userId !== userId) continue
      // 只补「有值且变了」的字段：账号侧为空时保留 roster 上的历史联系方式，避免把已有信息抹掉。
      if (displayName && member.displayName !== displayName) { member.displayName = displayName; organizationChanged = true }
      if (email && member.email !== email) { member.email = email; organizationChanged = true }
      if (phone && member.phone !== phone) { member.phone = phone; organizationChanged = true }
    }
    if (organizationChanged) {
      organization.updatedAt = new Date().toISOString()
      changed = true
    }
  }
  if (changed) runtime.metadataNeedsPersist = true
  return changed
}

export function accountWorkspacePayload(user) {
  const stored = accountUserById(user.id) || user
  const organization = accountOrganizationForUser(user.id)
  // plan 仍是「个人套餐」，加入团队不改变它；团队侧能力单独放在 teamEntitlement。
  const plan = accountPersonalPlanForUser(stored)
  return {
    plan,
    teamEntitlement: {
      organizationId: organization?.id || '',
      organizationName: organization?.name || '',
      role: organizationRoleForUser(organization, stored.id),
      canManage: isOrganizationManager(organization, stored.id),
      teamSpaceBytes: organizationTeamSpaceBytes(organization),
      canUseTeamSpace: Boolean(organization && accountEffectivePlanForUser(stored).team),
    },
    planStartedAt: stored.planStartedAt || null,
    planExpiresAt: plan.permanent ? null : stored.planExpiresAt || null,
    plans: configuredAccountPlans(),
    capacity: accountUsageForUser(user.id),
    organization: publicOrganization(organization, user.id),
    canManage: Boolean(organization && isOrganizationManager(organization, user.id)),
    isOwner: Boolean(organization && organization.ownerUserId === user.id),
    orders: upgradeOrdersForUser(user.id).slice(0, 10).map(upgradeOrderSummary),
    paymentReconciliation: {
      pending: upgradeOrdersForUser(user.id).some((order) => order.status !== 'paid' && order.remoteOrderNo && !order.paymentRequiresLogin && new Date(order.createdAt).getTime() + PAYMENT_QUERY_RETENTION_MS > Date.now()),
      requiresLogin: upgradeOrdersForUser(user.id).some((order) => order.status !== 'paid' && order.remoteOrderNo && order.paymentRequiresLogin),
    },
  }
}

// 解析收发记录 id → 底层资源引用。记录 id 形如 `<scope>:share:<shareId>` / `<scope>:collection:<token|manageToken|id>`。
export function parseAccountRecordResource(recordId) {
  const id = String(recordId || '')
  const separator = id.indexOf(':')
  if (separator <= 0) return null
  const scope = id.slice(0, separator)
  const rest = id.slice(separator + 1)
  if (rest.startsWith('share:')) return { scope, kind: 'share', key: rest.slice(6) }
  if (rest.startsWith('collection:')) return { scope, kind: 'collection', key: rest.slice(11) }
  return null
}

// 删除记录时联动清理：只处理记录归属者本人的资源（my_sent=自己发出的分享、
// my_collections=自己的收集任务），sent_to_me / collect_from_me 是别人的资源绝不能动；
// 且只清「已关闭/过期」的，有效期内的资源保留，提取链接不受影响。
export function purgeOwnedStaleResource(userId, recordId) {
  const parsed = parseAccountRecordResource(recordId)
  if (!parsed || !userId || !['my_sent', 'my_collections'].includes(parsed.scope)) return null
  if (parsed.kind === 'share') {
    const index = metadata.shares.findIndex((item) => item.id === parsed.key || item.manageToken === parsed.key)
    if (index < 0) return null
    const share = metadata.shares[index]
    // 团队文件由团队删除接口授权；个人记录清理不能触碰组织资产。
    if (share.teamResource) return null
    if (share.ownerUserId !== userId) return null
    if (currentShareStatus(share) === 'active') return null
    metadata.shares.splice(index, 1)
    removeDirectory(path.join(filesRoot, share.id))
    return { kind: 'share', id: share.id }
  }
  const index = metadata.collections.findIndex((item) => item.id === parsed.key || item.token === parsed.key || item.manageToken === parsed.key)
  if (index < 0) return null
  const collection = metadata.collections[index]
  if (collection.ownerUserId !== userId) return null
  if (currentCollectionStatus(collection) === 'active') return null
  metadata.collections.splice(index, 1)
  removeDirectory(path.join(collectionsRoot, collection.id))
  return { kind: 'collection', id: collection.id }
}

// 现存资源引用键全集（id/token/manageToken/code 任一口径，与记录条目的 key 生成保持兼容）
export function existingRecordResourceKeys() {
  const keys = new Set()
  for (const share of metadata.shares || []) {
    if (share.id) keys.add(share.id)
    if (share.manageToken) keys.add(share.manageToken)
    if (share.code) keys.add(share.code)
  }
  for (const task of metadata.collections || []) {
    if (task.id) keys.add(task.id)
    if (task.token) keys.add(task.token)
    if (task.manageToken) keys.add(task.manageToken)
  }
  return keys
}

// 摘除指向「已不存在资源」的死记录条目：管理员删除资源后，收发记录不应残留死链；
// 同时堵住客户端 localStorage 同步上报把已摘除条目 merge 回来的复活路径。
export function pruneOrphanRecordEntries(records) {
  if (!Array.isArray(records) || !records.length) return Array.isArray(records) ? records : []
  const keys = existingRecordResourceKeys()
  return records.filter((record) => {
    const parsed = parseAccountRecordResource(record && record.id)
    if (!parsed) return true
    return keys.has(parsed.key)
  })
}

export function cleanupExpired() {
  const now = Date.now()
  let changed = false
  for (const share of metadata.shares) {
    const previousStatus = share.status
    currentShareStatus(share, now)
    if (share.status !== previousStatus) changed = true
    if (maybeNotifyExpiringShare(share, now)) changed = true
  }
  for (const task of metadata.collections) {
    if (maybeNotifyExpiringCollection(task, now)) changed = true
  }
  if (cleanupUserExpiredFiles(now)) changed = true
  cleanupExpiredAuthSessions()
  if (cleanupPaymentQueryCredentials()) changed = true
  if (changed) persistMetadata()
}

export function cleanupUserExpiredFiles(now = Date.now()) {
  let changed = false
  for (const share of metadata.shares) {
    if (share.teamResource || share.cleanedAt || !share.ownerUserId || !share.expiresAt || !share.files?.length) continue
    const owner = accountUserById(share.ownerUserId)
    const settings = normalizeFileCleanupSettings(owner?.fileCleanup)
    const expiresAt = new Date(share.expiresAt).getTime()
    if (!settings.enabled || !Number.isFinite(expiresAt) || now < expiresAt + settings.days * 86400000) continue
    removeDirectory(path.join(filesRoot, share.id))
    share.files = []
    share.cleanedAt = new Date(now).toISOString()
    share.status = 'closed'
    share.closeReason = 'auto_cleanup'
    changed = true
  }
  for (const task of metadata.collections) {
    if (task.cleanedAt || !task.ownerUserId || !task.deadline || !task.submissions?.some((submission) => submission.files?.length)) continue
    const owner = accountUserById(task.ownerUserId)
    const settings = normalizeFileCleanupSettings(owner?.fileCleanup)
    const deadline = new Date(task.deadline).getTime()
    if (!settings.enabled || !Number.isFinite(deadline) || now < deadline + settings.days * 86400000) continue
    for (const submission of task.submissions) {
      removeDirectory(path.join(collectionsRoot, task.id, submission.id))
      submission.files = []
    }
    task.cleanedAt = new Date(now).toISOString()
    changed = true
  }
  return changed
}

export function currentShareStatus(share = {}, now = Date.now()) {
  if (share.status === 'closed' || share.status === 'expired') return 'closed'
  if (share.expiresAt && new Date(share.expiresAt).getTime() <= now) {
    share.status = 'closed'
    share.closeReason = share.closeReason || 'expired'
    return 'closed'
  }
  const owner = share.ownerUserId ? accountUserById(share.ownerUserId) : null
  const planExpiresAt = owner?.planExpiresAt ? new Date(owner.planExpiresAt).getTime() : 0
  if (!share.expiresAt && Number.isFinite(planExpiresAt) && planExpiresAt > 0 && now >= planExpiresAt + 7 * 86400000) {
    share.status = 'closed'
    share.closeReason = share.closeReason || 'plan_expired'
    return 'closed'
  }
  return share.status || 'active'
}

export function currentCollectionStatus(task = {}) {
  if (task.status === 'closed') return 'closed'
  if (task.deadline) return new Date(task.deadline).getTime() <= Date.now() ? 'expired' : 'active'
  return task.status || 'active'
}

export function publicAccountUser(user = {}) {
  const stored = accountUserById(user.id) || normalizeAccountUser(user) || publicUser(user)
  const organization = accountOrganizationForUser(stored.id)
  const personalPlan = accountPersonalPlanForUser(stored)
  return {
    ...publicUser(stored),
    capacity: accountUsageForUser(stored.id),
    benefits: accountBenefitsForUser(stored),
    // plan = 个人套餐（自己的空间与权益），加入团队不会改变它。
    plan: personalPlan,
    // teamEntitlement = 借用的团队侧能力（团队空间容量/成员协作），与个人套餐分开表达。
    teamEntitlement: {
      organizationId: organization?.id || '',
      organizationName: organization?.name || '',
      role: organizationRoleForUser(organization, stored.id),
      canManage: isOrganizationManager(organization, stored.id),
      teamSpaceBytes: organizationTeamSpaceBytes(organization),
      // 成员可用团队空间上传；这是共享能力，不代表个人升级
      canUseTeamSpace: Boolean(organization && accountTeamEntitlementForUser(stored).team),
    },
    // 不再下发 isAdmin：后台入口由账号口令控制，不由鲲穹账号身份决定。
    // 前端顶栏据此不再给白名单账号显示「后台管理」按钮，避免误导。
    organization: publicOrganization(organization, stored.id),
    notificationSettings: accountNotificationSettingsForUser(stored.id),
  }
}

export function upsertAccountUser(user = {}) {
  // ⚠️ 必须把**原始** user 交给 mergeAccountUser（而不是先 normalizeAccountUser 的结果）：
  // mergeAccountUser 需要读取 avatarRestoreRequested 这类"意图标记"来决定合并方向，
  // 而 normalizeAccountUser 只输出持久化字段，会把标记吞掉。
  // 之前这里先归一化再合并，导致「恢复登录头像」等显式操作无法生效。
  const normalized = normalizeAccountUser(user)
  if (!normalized?.id) return publicUser(user)
  if (!metadata.users || typeof metadata.users !== 'object' || Array.isArray(metadata.users)) metadata.users = {}
  const existing = metadata.users[normalized.id]
  const merged = mergeAccountUser(existing, user)
  // OAuth 导入等路径也不能新增重复联系方式；历史记录保持原样，不做隐式解绑。
  for (const type of ['email', 'phone']) {
    if (!merged[type]) continue
    const target = { type, value: merged[type] }
    if (!contactMatchesUser(target, existing)) assertContactAvailable(target, normalized.id)
  }
  metadata.users[normalized.id] = merged
  return metadata.users[normalized.id]
}

export function accountUserById(userId) {
  const key = accountRecordOwnerKey(userId)
  return key && metadata.users && typeof metadata.users === 'object' ? metadata.users[key] || null : null
}

export function syncAccountUserSessions(user = {}) {
  if (!user.id) return
  const sessionUser = publicUser(user)
  for (const session of metadata.sessions) {
    if (session.user?.id === user.id) session.user = sessionUser
  }
}

export function normalizeContactTarget(value) {
  const raw = String(value || '').trim()
  if (!raw || raw.length > 160 || /[<>\u0000-\u001f\u007f]/.test(raw)) return null
  const email = normalizeEmailValue(raw)
  if (email) return { type: 'email', value: email, label: email }
  if (!/^[+\d\s()-]+$/.test(raw)) return null
  const phone = normalizePhoneValue(raw)
  if (phone) return { type: 'phone', value: phone, label: phone }
  return null
}

export function findAccountUserByTarget(target) {
  if (!target) return null
  const users = Object.values(metadata.users || {})
  return users.find((user) => contactMatchesUser(target, user)) || null
}

export function assertContactAvailable(target, userId) {
  if (Object.values(metadata.users || {}).some(user => user.id !== userId && contactMatchesUser(target, user))) {
    throw httpError(409, target.type === 'email' ? '该邮箱已绑定其他账号，请使用其他邮箱' : '该手机号已绑定其他账号，请使用其他手机号')
  }
}

export function findAccountUserByInvitationTarget(value) {
  const raw = trimRecordString(value, 160)
  if (!raw) return null
  const contact = normalizeContactTarget(raw)
  if (contact) return findAccountUserByTarget(contact)
  const key = raw.toLowerCase()
  return Object.values(metadata.users || {}).find((user) => [user.id, user.username].some((item) => trimRecordString(item, 160).toLowerCase() === key)) || null
}

export function boundMethodForTargetType(type) {
  return type === 'email' ? 'email_bound' : 'phone_bound'
}

export function cleanupVerificationCodes() {
  const next = normalizeVerificationCodes(metadata.verificationCodes)
  if (next.length !== (metadata.verificationCodes || []).length) {
    metadata.verificationCodes = next
    persistMetadata()
  }
}

export function createVerificationCode(target, scene) {
  cleanupVerificationCodes()
  const code = String(crypto.randomInt(100000, 1000000))
  const now = new Date()
  metadata.verificationCodes = normalizeVerificationCodes(metadata.verificationCodes)
    .filter((item) => !(item.type === target.type && item.target === target.value && item.scene === scene))
  metadata.verificationCodes.unshift({
    id: createToken(10),
    type: target.type,
    target: target.value,
    scene,
    codeHash: hashSecret(code),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + VERIFICATION_CODE_TTL_MS).toISOString(),
  })
  metadata.verificationCodes = metadata.verificationCodes.slice(0, MAX_VERIFICATION_CODES)
  persistMetadata()
  return code
}

export function discardVerificationCode(target, scene) {
  const before = metadata.verificationCodes.length
  metadata.verificationCodes = metadata.verificationCodes.filter((item) => !(item.type === target.type && item.target === target.value && item.scene === scene))
  if (metadata.verificationCodes.length !== before) persistMetadata()
}

export function isTencentSmsConfigured() {
  return Boolean(
    tencentSmsSecretId
      && tencentSmsSecretKey
      && tencentSmsSdkAppId
      && tencentSmsSignName
      && tencentSmsBindTemplateId,
  )
}

export async function sendTencentSmsCode(phone, code, templateId) {
  const service = 'sms'
  const host = 'sms.tencentcloudapi.com'
  const action = 'SendSms'
  const version = '2021-01-11'
  const timestamp = Math.floor(Date.now() / 1000)
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const payload = JSON.stringify({
    SmsSdkAppId: tencentSmsSdkAppId,
    SignName: tencentSmsSignName,
    TemplateId: String(templateId),
    // Template 2602343 is a single-variable verification-code template.
    // Expiration is enforced by the server and does not need a second SMS parameter.
    TemplateParamSet: [code],
    PhoneNumberSet: [phone.startsWith('+') ? phone : `+86${phone}`],
  })
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`
  const signedHeaders = 'content-type;host;x-tc-action'
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    sha256(payload),
  ].join('\n')
  const credentialScope = `${date}/${service}/tc3_request`
  const stringToSign = [
    'TC3-HMAC-SHA256',
    String(timestamp),
    credentialScope,
    sha256(canonicalRequest),
  ].join('\n')
  const secretDate = hmac(`TC3${tencentSmsSecretKey}`, date)
  const secretService = hmac(secretDate, service)
  const secretSigning = hmac(secretService, 'tc3_request')
  const signature = hmac(secretSigning, stringToSign).toString('hex')
  const response = await fetch(`https://${host}`, {
    method: 'POST',
    headers: {
      Authorization: `TC3-HMAC-SHA256 Credential=${tencentSmsSecretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      'Content-Type': 'application/json; charset=utf-8',
      Host: host,
      'X-TC-Action': action,
      'X-TC-Version': version,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Region': tencentSmsRegion,
    },
    body: payload,
  })
  const result = await response.json().catch(() => ({}))
  const error = result.Response?.Error
  if (!response.ok || error) {
    throw Object.assign(new Error(error?.Message || `腾讯云短信返回 HTTP ${response.status}`), { code: error?.Code })
  }
  const sendStatus = result.Response?.SendStatusSet?.[0]
  if (sendStatus?.Code !== 'Ok') {
    throw Object.assign(new Error(sendStatus?.Message || '腾讯云短信未接受发送请求'), { code: sendStatus?.Code })
  }
  return result.Response
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export function hmac(key, value) {
  return crypto.createHmac('sha256', key).update(value).digest()
}

export function verifyAuthCode(target, value, scene) {
  cleanupVerificationCodes()
  // 非标量、非六位码也记为一次失败；不能通过错误格式绕过错误次数限制。
  const codeHash = typeof value === 'string' && /^\d{6}$/.test(value) ? hashSecret(value) : null
  const list = metadata.verificationCodes
  const index = list.findIndex((item) => item.type === target.type && item.target === target.value && item.scene === scene)
  if (index < 0) throw httpError(400, '验证码不正确或已过期')
  // 校验失败计数：同一验证码连续错 5 次立即作废，防止 6 位码被暴力枚举。
  if (list[index].codeHash !== codeHash) {
    const attempts = (list[index].attempts || 0) + 1
    if (attempts >= 5) {
      list.splice(index, 1)
      persistMetadata()
      throw httpError(400, '错误次数过多，验证码已失效，请重新获取')
    }
    list[index].attempts = attempts
    persistMetadata()
    throw httpError(400, '验证码不正确')
  }
  list.splice(index, 1)
  persistMetadata()
}

export function accountUsageForUser(userId) {
  const key = accountRecordOwnerKey(userId)
  const user = accountUserById(key) || {}
  // 个人用量必须按**个人套餐**算容量：加入团队不能把个人空间撑大。
  const plan = accountPersonalPlanForUser(user)
  const ownedShares = metadata.shares.filter((share) => share.ownerUserId === key && !share.teamResource && !share.cleanedAt)
  const ownedCollections = metadata.collections.filter((task) => task.ownerUserId === key && !task.cleanedAt)
  const shareBytes = ownedShares.reduce((sum, share) => sum + fileListSize(share.files), 0)
  const collectionBytes = ownedCollections.reduce((sum, task) => sum + task.submissions.reduce((inner, submission) => inner + fileListSize(submission.files), 0), 0)
  const usedBytes = shareBytes + collectionBytes
  const fileCount = ownedShares.reduce((sum, share) => sum + (share.files?.length || 0), 0)
    + ownedCollections.reduce((sum, task) => sum + task.submissions.reduce((inner, submission) => inner + (submission.files?.length || 0), 0), 0)
  return {
    usedBytes,
    totalBytes: plan.totalBytes,
    remainingBytes: Math.max(plan.totalBytes - usedBytes, 0),
    usageRatio: plan.totalBytes ? Math.min(1, usedBytes / plan.totalBytes) : 0,
    shareBytes,
    collectionBytes,
    shareCount: ownedShares.length,
    collectionCount: ownedCollections.length,
    fileCount,
    singleFileLimitBytes: ACCOUNT_SINGLE_FILE_BYTES,
  }
}

export function accountTeamUsageForOrganization(organization) {
  const owner = accountUserById(organization?.ownerUserId) || {}
  // 团队空间容量取自所有者套餐（成员不贡献容量），用 personal 而非 effective，
  // 避免所有者本身也是别的团队成员时被套上别人的 teamSpaceBytes。
  const plan = accountPersonalPlanForUser(owner)
  const shares = metadata.shares.filter((share) => share.teamResource && share.teamOrganizationId === organization?.id && !share.cleanedAt)
  const usedBytes = shares.reduce((sum, share) => sum + fileListSize(share.files), 0)
  const totalBytes = Number(plan.teamSpaceBytes || 0)
  return {
    usedBytes,
    totalBytes,
    remainingBytes: Math.max(totalBytes - usedBytes, 0),
    usageRatio: totalBytes ? Math.min(1, usedBytes / totalBytes) : 0,
    shareBytes: usedBytes,
    collectionBytes: 0,
    shareCount: shares.length,
    collectionCount: 0,
    fileCount: shares.reduce((sum, share) => sum + (share.files?.length || 0), 0),
    singleFileLimitBytes: ACCOUNT_SINGLE_FILE_BYTES,
  }
}

export function formatByteSize(bytes) {
  const value = Number(bytes || 0)
  if (value >= 1024 ** 4) return `${(value / 1024 ** 4).toFixed(1)} TB`
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`
  return `${Math.max(0, Math.round(value / 1024))} KB`
}

export function accountBenefitsForUser(user = {}) {
  const stored = typeof user === 'string' ? accountUserById(user) || {} : user
  const plan = accountPersonalPlanForUser(stored)
  const organization = accountOrganizationForUser(stored.id)
  const isMember = Boolean(organization && organization.ownerUserId !== stored.id)
  return [
    { label: '鲲穹登录', detail: '继续使用官方统一登录完成账号认证', enabled: true },
    { label: '跨设备记录', detail: '收发记录和文件中心跟随账号同步', enabled: true },
    { label: '站内消息', detail: '分享、下载和收集动态进入消息中心', enabled: true },
    { label: '账号绑定', detail: '可绑定邮箱或手机号用于消息匹配', enabled: true },
    { label: '账号容量', detail: `${plan.label}提供 ${formatByteSize(plan.totalBytes)} 空间`, enabled: true },
    { label: '永久保存', detail: plan.permanent ? '当前权益支持永久保存分享' : plan.id === 'free' ? '升级会员后可开启永久保存' : '会员期内可自定义分享有效期，永久保存为企业版权益', enabled: plan.permanent },
    // 团队空间：所有者看自己套餐是否具备；成员看「已加入团队空间」，
    // 但明确标注为团队共享能力，避免误导成个人已升级。
    isMember
      ? { label: '团队空间', detail: `已加入「${organization.name}」，共享其团队空间容量`, enabled: true }
      : { label: '团队空间', detail: plan.team ? '可创建团队空间并管理成员' : '团队空间需要团队版或企业版', enabled: plan.team },
  ]
}

export function fileListSize(files = []) {
  return Array.isArray(files) ? files.reduce((sum, file) => sum + Number(file?.size || 0), 0) : 0
}

export function accountNotificationSettingsForUser(userId) {
  const key = accountRecordOwnerKey(userId)
  if (!key) return normalizeNotificationSettings()
  if (!metadata.notificationSettings || typeof metadata.notificationSettings !== 'object' || Array.isArray(metadata.notificationSettings)) metadata.notificationSettings = {}
  if (!metadata.notificationSettings[key]) metadata.notificationSettings[key] = normalizeNotificationSettings()
  return metadata.notificationSettings[key]
}

export function accountMessagesForUser(userId) {
  const key = accountRecordOwnerKey(userId)
  if (!key) return []
  if (!metadata.messages || typeof metadata.messages !== 'object' || Array.isArray(metadata.messages)) metadata.messages = {}
  if (!Object.prototype.hasOwnProperty.call(metadata.messages, key)) {
    metadata.messages[key] = normalizeAccountMessages(DEFAULT_ACCOUNT_MESSAGES.map((message, index) => ({
      ...message,
      createdAt: new Date(Date.now() - (index + 1) * 1000).toISOString(),
    })))
    return metadata.messages[key]
  }
  const current = normalizeAccountMessages(metadata.messages[key])
  metadata.messages[key] = current
  return metadata.messages[key]
}

export function addAccountMessage(userId, message = {}, { respectSettings = true } = {}) {
  const key = accountRecordOwnerKey(userId)
  if (!key) return null
  if (respectSettings && !shouldDeliverAccountMessage(key, message.eventType)) return null
  const normalized = normalizeAccountMessage({ ...message, id: message.id || createToken(12), createdAt: message.createdAt || new Date().toISOString(), unread: true })
  if (!normalized) return null
  metadata.messages[key] = normalizeAccountMessages([normalized, ...accountMessagesForUser(key)])
  return normalized
}

export function shouldDeliverAccountMessage(userId, eventType) {
  const settings = accountNotificationSettingsForUser(userId)
  if (!settings.inApp) return false
  return !eventType || !Object.prototype.hasOwnProperty.call(settings, eventType) || settings[eventType] !== false
}

export function validateShareRecipient(share, viewer) {
  // 组织是资源的权限边界，不能把上传者的个人链接/令牌当成永久团队权限。
  if (share.teamResource) {
    const organization = metadata.organizations?.[share.teamOrganizationId]
    if (!organization) return { ok: false, status: 404, message: '团队资源所属团队已不存在' }
    if (!viewer?.id) return { ok: false, status: 401, message: '请先登录团队成员账号' }
    if (!organization.members.some(member => member.userId === viewer.id && member.status === 'active')) return { ok: false, status: 403, message: '当前账号不是该团队的有效成员' }
  }
  if (!share.deliveryRecipients?.length) return { ok: true }
  if (!viewer?.id) return { ok: false, status: 401, code: 'directed_login_required', message: '此文件为定向分享，请使用收件账号登录' }
  if (viewer.id === share.ownerUserId || share.recipientUserIds?.includes(viewer.id)) return { ok: true }
  const account = accountUserById(viewer.id)
  const contactMatch = account && (share.recipientContacts || []).some((recipient) => {
    const contact = normalizeContactTarget(recipient)
    return contact && contactMatchesUser(contact, account)
  })
  return contactMatch ? { ok: true } : { ok: false, status: 403, code: 'directed_access_denied', message: '当前账号不是此分享的指定收件人' }
}

export function isSmtpConfigured() {
  return Boolean(smtpHost && Number.isInteger(smtpPort) && smtpPort > 0 && smtpPort <= 65535 && smtpUser && smtpPassword && smtpFrom)
}

export function mailErrorReason(error) {
  const raw = String(error?.responseCode ? `${error.responseCode} ${error.message || ''}` : error?.message || error || '未知邮件错误')
  return raw.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180)
}

export function getEmailTransporter() {
  if (!isSmtpConfigured()) return null
  if (!runtime.emailTransporter) {
    runtime.emailTransporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: { user: smtpUser, pass: smtpPassword },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
    })
  }
  return runtime.emailTransporter
}

export function maybeNotifyExpiringShare(share, now) {
  if (!share.ownerUserId || currentShareStatus(share) !== 'active' || !share.expiresAt) return false
  if (share.notificationFlags?.shareExpiring) return false
  const expiresAt = new Date(share.expiresAt).getTime()
  if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt - now > EXPIRING_SOON_MS) return false
  const message = addAccountMessage(share.ownerUserId, {
    category: 'system',
    eventType: 'shareExpiring',
    title: '文件分享即将过期',
    body: `${share.files?.[0]?.name || '文件分享'} 将在 ${new Date(share.expiresAt).toLocaleString('zh-CN')} 过期。`,
    actionUrl: `/share/manage/${share.manageToken}`,
  })
  if (!message) return false
  share.notificationFlags = { ...(share.notificationFlags || {}), shareExpiring: true }
  return true
}

export function maybeNotifyExpiringCollection(task, now) {
  if (!task.ownerUserId || currentCollectionStatus(task) !== 'active' || !task.deadline) return false
  if (task.notificationFlags?.collectionExpiring) return false
  const deadline = new Date(task.deadline).getTime()
  if (!Number.isFinite(deadline) || deadline <= now || deadline - now > EXPIRING_SOON_MS) return false
  const message = addAccountMessage(task.ownerUserId, {
    category: 'system',
    eventType: 'collectionExpiring',
    title: '收集任务即将截止',
    body: `「${task.title}」将在 ${new Date(task.deadline).toLocaleString('zh-CN')} 截止。`,
    actionUrl: `/collect/manage/${task.manageToken}`,
  })
  if (!message) return false
  task.notificationFlags = { ...(task.notificationFlags || {}), collectionExpiring: true }
  return true
}

export function displayAccountName(user = {}) {
  return trimRecordString(user?.nickname || user?.username || user?.email || user?.phone, 80) || '对方'
}

export function requireAuthSession(req, res) {
  const session = authSessionFromRequest(req)
  if (!session) res.status(401).json({ message: '请先登录' })
  return session
}

export function accountRecordsForUser(userId) {
  const key = accountRecordOwnerKey(userId)
  if (!key) return []
  if (!metadata.records || typeof metadata.records !== 'object' || Array.isArray(metadata.records)) metadata.records = {}
  if (!Array.isArray(metadata.records[key])) metadata.records[key] = []
  // 读取时过滤死条目：存量「资源已删但记录还在」的脏数据在此统一拦截
  return pruneOrphanRecordEntries(metadata.records[key])
}

export function mergeAccountRecords(currentRecords, incomingRecords) {
  const merged = new Map()
  normalizeAccountRecords(currentRecords).forEach((record) => merged.set(record.id, record))
  normalizeAccountRecords(incomingRecords).forEach((record) => {
    const existing = merged.get(record.id)
    merged.set(record.id, existing ? mergeAccountRecord(existing, record) : record)
  })
  // 合并后再过滤：客户端 localStorage 里残留的死条目上报回来也不能复活
  return pruneOrphanRecordEntries(Array.from(merged.values()).sort(compareAccountRecords).slice(0, MAX_ACCOUNT_RECORDS))
}

export function isOAuthConfigured() {
  return Boolean(oauthClientId && oauthClientSecret)
}

export function publicPaymentPayload(value) {
  return normalizePaymentPayload(value)
}

export async function ensurePaymentAssets(payment) {
  if (!payment || normalizeWebMemberPayType(payment.pay_type) !== 1 || payment.qrcode_img_url || !payment.code_url) {
    return payment
  }
  try {
    payment.qrcode_img_url = await QRCode.toDataURL(payment.code_url, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 280,
    })
  } catch {
    // Keep code_url available so the caller can retry or copy the payment address.
  }
  return payment
}

export function sessionApiWebToken(session) {
  return trimRecordString(session?.apiWebToken, 300)
}

export async function webMemberRequest(pathname, token, params = {}) {
  if (!token) throw httpError(401, '登录会话缺少会员支付凭证，请退出后重新登录')
  const response = await fetch(`${webMemberApiBase}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      token,
    },
    body: new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value ?? '')])).toString(),
    signal: AbortSignal.timeout(10000),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || Number(payload.code) !== 1) {
    const authRejected = response.status === 401 || Number(payload.code) === 401
    const error = httpError(authRejected ? 401 : response.status >= 400 ? response.status : 502, authRejected ? '会员支付凭证已失效，请重新登录后核对支付状态' : '会员服务暂时不可用，请稍后重试')
    if (authRejected) error.code = 'payment_login_required'
    throw error
  }
  return payload.data || {}
}

export async function getWebMemberPackageInfo(session) {
  return webMemberRequest('/user/get_web_member_package_info', sessionApiWebToken(session), {
    subsite_name: webMemberSubsiteName,
  })
}

export function paymentAmountCents(value) {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') throw httpError(502, '会员服务返回无效金额，请稍后重试')
  const yuan = Number(value)
  const cents = Math.round(yuan * 100)
  if (!Number.isFinite(yuan) || yuan <= 0 || !Number.isSafeInteger(cents) || cents <= 0 || Math.abs(yuan * 100 - cents) > 0.000001) throw httpError(502, '会员服务返回无效金额，请稍后重试')
  return cents
}

export function selectWebMemberPackage(planId, packages) {
  const envKey = WEB_MEMBER_PACKAGE_ENV_KEYS[planId]
  const explicitId = envKey && process.env[envKey]
  const configuredId = Number(explicitId || DEFAULT_WEB_MEMBER_PACKAGE_IDS[planId] || 0)
  const pkg = packages.find((item) => Number(item.id) === configuredId)
    || (!explicitId ? matchWebMemberPackageFromPackages(planId, packages) : null)
  if (!pkg || !Number.isSafeInteger(Number(pkg.id)) || Number(pkg.id) <= 0) throw httpError(502, '会员套餐不可用，请核对主站套餐配置')
  paymentAmountCents(pkg.price_yuan)
  const days = Number(pkg.days)
  if (pkg.days === null || pkg.days === '' || !Number.isSafeInteger(days) || days < 0
    || (planId === 'enterprise' ? days !== 0 && days < 36500 : days <= 0 || days >= 36500)) throw httpError(502, '会员服务返回无效有效期，请核对主站套餐配置')
  return pkg
}

export async function resolveWebMemberPackage(session, planId) {
  const info = await getWebMemberPackageInfo(session)
  return { info, package: selectWebMemberPackage(planId, Array.isArray(info.packages) ? info.packages : []) }
}

// 按套餐 ID 从远端套餐列表里挑出对应套餐（与订单创建同源；远端没有匹配时返回 null，由调用方决定回落策略）
export function matchWebMemberPackageFromPackages(planId, packages) {
  const list = Array.isArray(packages) ? packages : []
  const planLabel = configuredAccountPlan(planId)?.label || ''
  const normalizePackageName = (value) => String(value || '')
    .replace(/\s+/g, '')
    .replace(/[（(].*?[）)]/g, '')
    .toLowerCase()
  const packageName = (item) => normalizePackageName(item.name)
  const label = normalizePackageName(planLabel)
  const aliases = {
    member: ['会员', '月卡', '季卡', '半年卡', '年卡', '永久'],
    team: ['团队', '成长', '进阶', '半年', '年卡'],
    enterprise: ['企业', '永久'],
  }
  const aliasMatched = list.find((item) => aliases[planId]?.some((alias) => packageName(item).includes(alias)))
  const durationMatched = planId === 'enterprise'
    ? list.find((item) => Number(item.days) >= 365 * 1000)
    : planId === 'team'
      ? list.find((item) => Number(item.days) >= 90 && Number(item.days) < 365 * 1000)
      : list.find((item) => Number(item.days) >= 30 && Number(item.days) < 90)
  return list.find((item) => packageName(item).includes(label) || label.includes(packageName(item)))
    || aliasMatched
    || durationMatched
    || null
}

// 远端套餐实价缓存 remotePricingCache 在 server/state.js（展示与订单计价必须同源）
const REMOTE_PRICING_TTL = 60 * 1000

export async function remoteUpgradePricing(session) {
  const now = Date.now()
  if (remotePricingCache.data && now - remotePricingCache.at < REMOTE_PRICING_TTL) return remotePricingCache.data
  const info = await getWebMemberPackageInfo(session)
  const packages = Array.isArray(info.packages) ? info.packages : []
  const pricing = {}
  for (const planId of ['member', 'team', 'enterprise']) {
    try {
      const pkg = selectWebMemberPackage(planId, packages)
      pricing[planId] = { priceCents: paymentAmountCents(pkg.price_yuan), validityDays: planId === 'enterprise' ? null : Number(pkg.days), packageName: trimRecordString(pkg.name, 80), packageId: Number(pkg.id), available: true }
    } catch {
      pricing[planId] = { available: false, message: '套餐暂不可用，请稍后重试' }
    }
  }
  remotePricingCache.data = pricing
  remotePricingCache.at = now
  return pricing
}

export async function createWebMemberPaymentOrder(session, order, payType) {
  const { package: memberPackage } = await resolveWebMemberPackage(session, order.planId)
  const data = await webMemberRequest('/user/create_web_member_order', sessionApiWebToken(session), {
    package_id: memberPackage.id,
    pay_type: payType,
    subsite_name: webMemberSubsiteName,
  })
  // Validate the response before attaching a remotely payable order or query credential.
  const amount = paymentAmountCents(data.pay_amount)
  const remoteOrderNo = trimRecordString(data.order_no, 80)
  const days = Number(data.package_days ?? memberPackage.days)
  if (!remoteOrderNo || Number(data.package_id) !== order.remotePackageId
    || Number(memberPackage.id) !== order.remotePackageId || amount !== order.amount
    || paymentAmountCents(memberPackage.price_yuan) !== order.amount
    || days !== Number(memberPackage.days) || days !== Number(order.remotePackageDays || 0)
    || Number(data.pay_type ?? payType) !== payType) throw httpError(502, '支付订单金额或套餐不一致，请重新创建订单')
  order.payType = payType
  order.remoteOrderNo = remoteOrderNo
  order.remotePackageName = trimRecordString(memberPackage.name, 80)
  order.payment = normalizePaymentPayload(data)
  order.updatedAt = new Date().toISOString()
  retainPaymentQueryCredential(session, order)
  persistMetadata()
  await ensurePaymentAssets(order.payment)
  return { ...data, pay_type: order.payType }
}

export async function checkWebMemberPaymentStatus(session, remoteOrderNo) {
  return webMemberRequest('/user/check_web_member_order_paystatus', sessionApiWebToken(session), {
    order_no: remoteOrderNo,
  })
}

export async function acquireUpgradeLock(key) {
  const previous = upgradeOrderLocks.get(key) || Promise.resolve()
  let unlock
  const current = new Promise((resolve) => { unlock = resolve })
  upgradeOrderLocks.set(key, current)
  await previous
  return () => { unlock(); if (upgradeOrderLocks.get(key) === current) upgradeOrderLocks.delete(key) }
}

export async function reconcileUpgradeOrder(session, order) {
  const release = await acquireUpgradeLock(order.id)
  let queriedToken
  try {
    if (order.status === 'paid' || !order.remoteOrderNo) return { pay_status: order.status === 'paid' ? 1 : 0 }
    // A login can refresh credentials while this query waits for the order lock.
    const credential = normalizePaymentQueryCredential(order)
    if (!credential && !session.user) return { pay_status: 0 }
    queriedToken = sessionApiWebToken(credential || session)
    const result = await checkWebMemberPaymentStatus({ apiWebToken: queriedToken }, order.remoteOrderNo)
    if (Number(result.pay_status) === 1) {
      activatePaidUpgradeOrder(order, result.expire_at)
      persistMetadata()
    }
    return result
  } catch (error) {
    const currentSessionToken = paymentSessionTokens.get(order.userId)
    if (error.code === 'payment_login_required'
      && (!order.paymentQueryCredential || order.paymentQueryCredential.apiWebToken === queriedToken)
      && (!currentSessionToken || currentSessionToken === queriedToken)) {
      order.paymentRequiresLogin = true
      order.paymentQueryCredential = null
      persistMetadata()
    }
    throw error
  } finally { release() }
}

export function retainPaymentQueryCredential(session, order, freshLogin = false) {
  const apiWebToken = sessionApiWebToken(session)
  const expiresAt = new Date(order.createdAt).getTime() + PAYMENT_QUERY_RETENTION_MS
  if (!apiWebToken || order.userId !== session.user?.id || order.status === 'paid' || !order.remoteOrderNo || expiresAt <= Date.now() || accountUserById(order.userId)?.status === 'disabled') return
  if (freshLogin) order.paymentRequiresLogin = false
  if (order.paymentRequiresLogin || (!freshLogin && normalizePaymentQueryCredential(order))) return
  order.paymentQueryCredential = { apiWebToken, expiresAt: new Date(expiresAt).toISOString() }
}

export function retainUserPaymentQueryCredentials(session, freshLogin = false) {
  for (const order of upgradeOrdersForUser(session.user.id)) {
    if (freshLogin && sessionApiWebToken(session)) order.paymentRequiresLogin = false
    retainPaymentQueryCredential(session, order, freshLogin)
  }
}

export function cleanupPaymentQueryCredentials() {
  let changed = false
  for (const order of metadata.upgradeOrders) {
    if (order.paymentQueryCredential && (!normalizePaymentQueryCredential(order) || accountUserById(order.userId)?.status === 'disabled')) {
      order.paymentQueryCredential = null
      changed = true
    }
  }
  return changed
}

export async function reconcileUserUpgradeOrders(session, force = false) {
  if (!sessionApiWebToken(session)) return
  const key = session.user.id
  paymentSessionTokens.set(key, sessionApiWebToken(session))
  const previous = paymentReconcileAttempts.get(key)
  if (previous?.running) {
    if (force) {
      await previous.completion
      return reconcileUserUpgradeOrders(session, true)
    }
    return
  }
  if (!force && previous?.at > Date.now() - 30000) return
  let complete
  const state = { running: true, at: Date.now(), completion: new Promise((resolve) => { complete = resolve }) }
  paymentReconcileAttempts.set(key, state)
  try {
    for (const order of upgradeOrdersForUser(key).filter((item) => item.status !== 'paid' && item.remoteOrderNo && !item.paymentRequiresLogin)) {
      try { await reconcileUpgradeOrder(session, order) }
      catch { /* Retry on the next interval or a fresh login token. */ }
    }
  } finally { state.running = false; complete() }
}

// 旧测试白名单曾保留到期日却把已支付用户的套餐改成 free。
// 启动时仅修复与已确认订单吻合的记录，不重新付款、续期或发送开通通知。
export function repairLegacyTestPaidPlans() {
  if (!testEnforceEnterpriseAllowlist) return 0
  let repaired = 0
  for (const account of Object.values(metadata.users || {})) {
    if (account.planId !== 'free' || account.status === 'disabled') continue
    const candidates = upgradeOrdersForUser(account.id).filter(order => {
      const plan = configuredAccountPlan(order.planId)
      const paidAt = new Date(order.paidAt).getTime()
      if (order.status !== 'paid' || !order.remoteOrderNo || !(order.amount > 0)
        || plan.id === 'free' || !Number.isFinite(paidAt) || paidAt <= 0 || paidAt > Date.now()) return false
      const expiry = new Date(order.remoteExpireAt).getTime()
      if (!plan.permanent && (!Number.isFinite(expiry) || expiry <= Date.now()
        || expiry !== new Date(account.planExpiresAt).getTime())) return false
      if (plan.permanent && account.planExpiresAt) return false
      // 后台主动撤销的权益不属于本次自动修复范围。
      return !metadata.auditLogs.some(log => log.type === 'admin' && log.action === '更新用户状态或权益'
        && log.targetId === account.id && log.details?.planId && new Date(log.createdAt).getTime() >= paidAt)
    }).sort((a, b) => accountPlanRank(b.planId) - accountPlanRank(a.planId)
      || new Date(b.remoteExpireAt || 0).getTime() - new Date(a.remoteExpireAt || 0).getTime())
    const order = candidates[0]
    if (!order) continue
    account.planId = order.planId
    account.planStartedAt = account.planStartedAt || order.paidAt
    account.planExpiresAt = configuredAccountPlan(order.planId).permanent ? null : order.remoteExpireAt
    account.updatedAt = new Date().toISOString()
    syncAccountUserSessions(account)
    repaired++
  }
  if (repaired) runtime.metadataNeedsPersist = true
  return repaired
}

export function activatePaidUpgradeOrder(order, expireAt = null) {
  if (order.status === 'paid') return
  let checkedExpiry = null
  if (expireAt !== null && expireAt !== undefined && expireAt !== '') {
    // The member API returns China local time as Y-m-d H:i:s. Specify the
    // offset so UTC deployments agree with local ones; keep strict validation.
    const expiry = typeof expireAt === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(expireAt)
      ? `${expireAt.replace(' ', 'T')}+08:00`
      : expireAt
    try { checkedExpiry = dateInput(expiry,'支付套餐有效期') } catch { throw httpError(502,'支付服务返回的套餐有效期无效，请稍后重新查询') }
  }
  const account = accountUserById(order.userId)
  if (!account) throw httpError(404, '支付用户不存在')
  const plan = configuredAccountPlan(order.planId)
  const storedExpiry = account.planExpiresAt ? new Date(account.planExpiresAt).getTime() : 0
  const currentExpiry = Number.isFinite(storedExpiry) ? storedExpiry : 0
  const remoteExpiry = checkedExpiry ? new Date(checkedExpiry).getTime() : 0
  const currentPlan = accountPlanForUser(account)
  const renewalBase = currentPlan.id === order.planId ? Math.max(Date.now(), currentExpiry || 0) : Date.now()
  let packageDays
  try { packageDays = integerInput(order.remotePackageDays ?? plan.validityDays ?? 30,'套餐有效天数',1,3650) }
  catch { throw httpError(502,'支付服务返回的套餐有效天数无效，请稍后重新查询') }
  const nextExpiry = Math.max(remoteExpiry, renewalBase + packageDays * 86400000)
  if (nextExpiry > Date.now() + 3650 * 86400000) throw httpError(502,'套餐有效期超出允许范围')
  const keepHigherPlan = accountPlanRank(currentPlan.id) > accountPlanRank(order.planId)
  if (!keepHigherPlan) account.planId = order.planId
  account.planStartedAt = account.planStartedAt || new Date().toISOString()
  if (!keepHigherPlan) account.planExpiresAt = plan.permanent
    ? null
    : new Date(Math.max(currentExpiry, nextExpiry)).toISOString()
  account.updatedAt = new Date().toISOString()
  order.status = 'paid'
  order.paymentQueryCredential = null
  order.paymentRequiresLogin = false
  order.paidAt = new Date().toISOString()
  order.remoteExpireAt = plan.permanent
    ? null
    : new Date(Math.max(currentExpiry, nextExpiry)).toISOString()
  order.updatedAt = new Date().toISOString()
  upsertAccountUser(account)
  syncAccountUserSessions(account)
  addAccountMessage(account.id, {
    category: 'other',
    eventType: 'membershipActivated',
    title: '会员权益已开通',
    body: plan.permanent
      ? `你的${plan.label}已开通，文件永久保存。`
      : `你的${plan.label}已开通，有效期至${new Date(account.planExpiresAt).toLocaleString('zh-CN')}。`,
  })
}

export function authRedirectUri(req) {
  const origin = getRequestOrigin(req)
  if (configuredCallbackUrls.length) {
    try {
      const requestHost = new URL(origin).hostname
      const exactMatch = configuredCallbackUrls.find((item) => new URL(item).hostname === requestHost)
      if (exactMatch) return exactMatch
      if (['localhost', '127.0.0.1', '::1'].includes(requestHost)) {
        const localMatch = configuredCallbackUrls.find((item) => ['localhost', '127.0.0.1', '::1'].includes(new URL(item).hostname))
        if (localMatch) return localMatch
      }
    } catch {}
    return configuredCallbackUrls[0]
  }
  try {
    const url = new URL(origin)
    if (['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
      return `http://localhost:${serverPort}/auth/callback`
    }
    return `${url.origin}/auth/callback`
  } catch {
    return `http://localhost:${serverPort}/auth/callback`
  }
}

export function authSessionFromRequest(req) {
  const sessionId = readCookie(req, AUTH_COOKIE_NAME)
  if (!sessionId) return null
  const session = metadata.sessions.find((item) => item.id === sessionId)
  if (!session) return null
  if (!Number.isFinite(new Date(session.expiresAt).getTime()) || new Date(session.expiresAt).getTime() <= Date.now()) {
    removeAuthSession(sessionId)
    return null
  }
  if (accountUserById(session.user?.id)?.status === 'disabled') {
    removeAuthSession(sessionId)
    return null
  }
  const storedUser = accountUserById(session.user?.id)
  if (storedUser) session.user = publicUser(storedUser)
  return session
}

export function removeAuthSession(sessionId) {
  const session = metadata.sessions.find((item) => item.id === sessionId)
  if (session) retainUserPaymentQueryCredentials(session)
  const before = metadata.sessions.length
  metadata.sessions = metadata.sessions.filter((session) => session.id !== sessionId)
  if (metadata.sessions.length !== before) persistMetadata()
}

export function cleanupExpiredAuthSessions() {
  const now = Date.now()
  for (const session of metadata.sessions) {
    if (new Date(session.expiresAt).getTime() <= now) retainUserPaymentQueryCredentials(session)
  }
  const nextSessions = metadata.sessions.filter((session) => new Date(session.expiresAt).getTime() > now)
  if (nextSessions.length !== metadata.sessions.length) {
    metadata.sessions = nextSessions
    persistMetadata()
  }
}

export function cleanupOAuthStates() {
  const now = Date.now()
  for (const [state, value] of oauthStates.entries()) {
    if (now - value.createdAt > OAUTH_STATE_TTL_MS) oauthStates.delete(state)
  }
}

export function safeReturnUrl(value, req) {
  const fallback = getRequestOrigin(req)
  const requestOrigin = new URL(fallback).origin
  const configuredOrigin = configuredAppUrl ? (() => {
    try { return new URL(configuredAppUrl).origin } catch { return '' }
  })() : ''
  const allowedOrigins = new Set([
    requestOrigin,
    configuredOrigin === requestOrigin ? configuredOrigin : '',
  ].filter(Boolean).map((item) => {
    try { return new URL(item).origin } catch { return '' }
  }).filter(Boolean))
  try {
    const candidate = new URL(firstValue(value) || fallback, fallback)
    return allowedOrigins.has(candidate.origin) ? candidate.toString() : fallback
  } catch {
    return fallback
  }
}

export function alignReturnUrlWithAuthHost(returnTo, redirectUri) {
  try {
    const target = new URL(returnTo)
    const callback = new URL(redirectUri)
    if (isLoopbackHost(target.hostname) && isLoopbackHost(callback.hostname) && target.hostname !== callback.hostname) {
      target.hostname = callback.hostname
      return target.toString()
    }
  } catch {}
  return returnTo
}

export function isLoopbackHost(hostname) {
  return LOOPBACK_HOSTS.has(String(hostname || '').toLowerCase().replace(/^\[|\]$/g, ''))
}

export function appendAuthResult(value, status, message = '') {
  let url
  try {
    url = new URL(value)
  } catch {
    url = new URL(`http://localhost:${serverPort}/`)
  }
  url.searchParams.set('login', status)
  if (message) url.searchParams.set('message', message)
  else url.searchParams.delete('message')
  return url.toString()
}

export function clearAuthCookie(res, req) {
  res.setHeader('Set-Cookie', serializeCookie(AUTH_COOKIE_NAME, '', {
    httpOnly: true,
    maxAge: 0,
    path: '/',
    sameSite: 'Lax',
    secure: isSecureRequest(req),
  }))
}

export function oauthStateCookieName(state) {
  return `kunqiong_oauth_${state}`
}

export function setOAuthStateCookie(res, req, state, value) {
  res.append('Set-Cookie', serializeCookie(oauthStateCookieName(state), value, {
    httpOnly: true, maxAge: value ? Math.floor(OAUTH_STATE_TTL_MS / 1000) : 0,
    path: '/', sameSite: 'Lax', secure: isSecureRequest(req),
  }))
}

export function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`]
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`)
  if (options.path) parts.push(`Path=${options.path}`)
  if (options.httpOnly) parts.push('HttpOnly')
  if (options.secure) parts.push('Secure')
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`)
  return parts.join('; ')
}

export function readCookie(req, name) {
  const cookies = String(req.get('cookie') || '').split(';')
  for (const cookie of cookies) {
    const [key, ...valueParts] = cookie.trim().split('=')
    if (key === name) {
      try { return decodeURIComponent(valueParts.join('=') || '') } catch { return '' }
    }
  }
  return ''
}

export function isSecureRequest(req) {
  return req.secure || firstHeader(req.get('x-forwarded-proto')) === 'https'
}

export function publicFile(file = {}) {
  const { storedName, ...safeFile } = file
  return {
    ...safeFile,
    name: normalizeUploadFileName(safeFile.name || safeFile.relativePath || storedName || ''),
    relativePath: safeRelativePath(normalizeUploadFileName(safeFile.relativePath || safeFile.name || storedName || '')),
  }
}

export function getOrigin(req) {
  return getRequestOrigin(req)
}

export function getRequestOrigin(req) {
  const proto = firstHeader(req.get('x-forwarded-proto')) || req.protocol
  const host = firstHeader(req.get('x-forwarded-host')) || req.get('host') || `localhost:${serverPort}`
  return `${proto}://${host}`
}

export function safeRelativePath(value) {
  const normalized = path.posix.normalize(String(value).replaceAll('\\', '/')).replace(/^(\.\.(\/|\\|$))+/, '')
  return normalized.replace(/^\/+/, '') || '未命名文件'
}


export async function reconcileActiveUpgradeOrders() {
  if (cleanupPaymentQueryCredentials()) persistMetadata()
  const seen = new Set()
  for (const session of [...metadata.sessions].reverse()) {
    if (seen.has(session.user.id) || !sessionApiWebToken(session) || new Date(session.expiresAt).getTime() <= Date.now() || accountUserById(session.user.id)?.status === 'disabled') continue
    seen.add(session.user.id)
    paymentSessionTokens.set(session.user.id, sessionApiWebToken(session))
    await reconcileUserUpgradeOrders(session)
  }
  for (const order of metadata.upgradeOrders) {
    const credential = normalizePaymentQueryCredential(order)
    if (!credential || seen.has(order.userId) || accountUserById(order.userId)?.status === 'disabled') continue
    try { await reconcileUpgradeOrder(credential, order) }
    catch { /* Keep transient failures retryable within the retention window. */ }
  }
}
