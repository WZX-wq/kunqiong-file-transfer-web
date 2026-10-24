// 元数据规范化层 —— 把存储中的原始 JSON 规范化为内存模型
//
// 分层位置：config ← state ← metadata-store ← **本模块** ← server.mjs
//
// 为什么单独成模块、以及为什么必须由入口注入：
//   normalizeMetadata 依赖 11 个领域 normalizer，而它的 3 个调用点全在 metadata-store 内部。
//   若把本模块直接 import 进 store，就会形成
//       metadata-store → 本模块 → metadata-store（本模块内多处要 persist）
//   的循环依赖 —— ESM 下成环不抛错，表现为运行期 undefined，极难排查。
//   所以 store 只留一个 installNormalizer 注入缝，由 server.mjs 在启动时接上。
//
// 本模块是唯一「允许 import 多个领域」的地方（账号 / 记录 / 消息 / 通知 / 验证码 /
// 审计 / 组织 / 支付 / 游客 / 系统配置），后续按域拆分领域模块时，这里的 import 源会变，
// 但本模块作为聚合点的位置不变。
//
// 内容由脚本按 normalizeMetadata 的传递依赖闭包生成，未手写清单。

import {
  ACCOUNT_MESSAGE_CATEGORIES, ACCOUNT_PLANS, ACCOUNT_RECORD_KINDS, ACCOUNT_RECORD_SCOPES, DEFAULT_FILE_CLEANUP_SETTINGS, DEFAULT_NOTIFICATION_SETTINGS, DEFAULT_SYSTEM_CONFIG, MAX_ACCOUNT_MESSAGES, MAX_ACCOUNT_RECORDS, MAX_AUDIT_LOGS, MAX_FILES, MAX_GUEST_USAGE_ENTRIES, MAX_RECORD_FILES, MAX_RECORD_SUBMISSIONS, MAX_UPGRADE_ORDERS, MAX_VERIFICATION_CODES, PAYMENT_QUERY_RETENTION_MS, TEST_ENTERPRISE_USER_KEYS, UPGRADE_ORDER_STATUSES, testEnforceEnterpriseAllowlist, testEnterpriseForAllUsers,
} from '../config.js'

import {
  createToken,
} from './http.js'
import { keyedDigest } from './private-key.js'

import {
  runtime,
} from '../state.js'

import { normalizeCollectionCustomFields, normalizeCollectionMaterials } from './collection-forms.js'
import { normalizeStoredTeamBranding } from './team-branding.js'

export function normalizeMetadata(value = {}) {
  const shares = Array.isArray(value.shares) ? value.shares : []
  for (const share of shares) {
    if (!share.manageToken) {
      share.manageToken = createToken(18)
      runtime.metadataNeedsPersist = true
    }
    if (share.status === 'expired') {
      share.status = 'closed'
      share.closeReason = share.closeReason || 'expired'
      runtime.metadataNeedsPersist = true
    }
  }
  const distributions = Array.isArray(value.distributions) ? value.distributions.filter(item => item && typeof item === 'object' && item.id) : []
  for (const distribution of distributions) {
    distribution.id = String(distribution.id).slice(0, 120)
    distribution.ownerUserId = String(distribution.ownerUserId || '').slice(0, 120)
    distribution.idempotencyKey = String(distribution.idempotencyKey || '').slice(0, 200)
    distribution.shareId = String(distribution.shareId || '').slice(0, 120)
    distribution.status = 'published'
    distribution.rows = Array.isArray(distribution.rows) ? distribution.rows.map(row => ({
      key: String(row?.key || '').slice(0, 80), userId: String(row?.userId || '').slice(0, 120),
      recipient: String(row?.recipient || '').slice(0, 160), fileName: String(row?.fileName || '').slice(0, 240),
    })).filter(row => row.key && row.userId && row.fileName) : []
  }
  const collections = Array.isArray(value.collections) ? value.collections : []
  for (const task of collections) {
    if (!task.manageToken) {
      task.manageToken = createToken(18)
      runtime.metadataNeedsPersist = true
    }
    if (!Array.isArray(task.submissions)) {
      task.submissions = []
      runtime.metadataNeedsPersist = true
    }
    let normalizedMaterials = []
    let normalizedFields = []
    try { normalizedMaterials = normalizeCollectionMaterials(task.materials) } catch { runtime.metadataNeedsPersist = true }
    try { normalizedFields = normalizeCollectionCustomFields(task.customFields) } catch { runtime.metadataNeedsPersist = true }
    if (JSON.stringify(normalizedMaterials) !== JSON.stringify(task.materials || []) || JSON.stringify(normalizedFields) !== JSON.stringify(task.customFields || [])) runtime.metadataNeedsPersist = true
    task.materials = normalizedMaterials
    task.customFields = normalizedFields
  }
  const collectionTemplates = Array.isArray(value.collectionTemplates) ? value.collectionTemplates : []
  for (const template of collectionTemplates) {
    try { template.materials = normalizeCollectionMaterials(template.materials) } catch { template.materials = []; runtime.metadataNeedsPersist = true }
    try { template.customFields = normalizeCollectionCustomFields(template.customFields) } catch { template.customFields = []; runtime.metadataNeedsPersist = true }
  }
  const systemConfig = normalizeSystemConfig(value.systemConfig)
  // Upgrade only the previous shipped guest defaults; retain custom admin values.
  if (!value.systemConfig?.entitlementsVersion) {
    if (Number(value.systemConfig?.anonymousMaxFileSizeMb) === 500) systemConfig.anonymousMaxFileSizeMb = DEFAULT_SYSTEM_CONFIG.anonymousMaxFileSizeMb
    if (Number(value.systemConfig?.anonymousTotalSizeMb) === 1024) systemConfig.anonymousTotalSizeMb = DEFAULT_SYSTEM_CONFIG.anonymousTotalSizeMb
    runtime.metadataNeedsPersist = true
  }
  const sessions = Array.isArray(value.sessions)
    ? value.sessions
      .filter((session) => session?.id && session?.user)
      .map((session) => {
        if (Object.prototype.hasOwnProperty.call(session, 'accessToken') || Object.prototype.hasOwnProperty.call(session, 'tokenType')) {
          runtime.metadataNeedsPersist = true
        }
        const { accessToken: _accessToken, tokenType: _tokenType, ...sanitized } = session
        return sanitized
      })
    : []
  const users = normalizeAccountUserStore(value.users, sessions)
  return {
    ...value,
    shares,
    distributions,
    collections,
    collectionTemplates,
    sessions,
    records: normalizeAccountRecordStore(value.records),
    users,
    messages: normalizeAccountMessageStore(value.messages),
    notificationSettings: normalizeNotificationSettingsStore(value.notificationSettings),
    verificationCodes: normalizeVerificationCodes(value.verificationCodes),
    auditLogs: normalizeAuditLogs(value.auditLogs),
    organizations: normalizeOrganizations(value.organizations),
    upgradeOrders: normalizeUpgradeOrders(value.upgradeOrders),
    guestUsage: normalizeGuestUsageStore(value.guestUsage),
    systemConfig,
  }
}

export function normalizeUpgradeOrders(value = []) {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const paymentQueryCredential = normalizePaymentQueryCredential(item)
    if (item?.paymentQueryCredential && (!paymentQueryCredential
      || item.paymentQueryCredential.apiWebToken !== paymentQueryCredential.apiWebToken
      || item.paymentQueryCredential.expiresAt !== paymentQueryCredential.expiresAt)) runtime.metadataNeedsPersist = true
    return {
      id: trimRecordString(item?.id, 80) || createToken(10),
      orderNo: trimRecordString(item?.orderNo, 40) || `UPG-${createToken(8).toUpperCase()}`,
      userId: trimRecordString(item?.userId, 120),
      planId: normalizePlanId(item?.planId),
      status: UPGRADE_ORDER_STATUSES.has(item?.status) ? item.status : 'expired',
      amount: Number(item?.amount) > 0 ? Number(item.amount) : null,
      payType: normalizeWebMemberPayType(item?.payType || item?.payment?.pay_type || 1),
      remoteOrderNo: trimRecordString(item?.remoteOrderNo || item?.remoteOrderNumber, 80),
      remotePackageId: normalizeNullablePositiveInteger(item?.remotePackageId),
      remotePackageName: trimRecordString(item?.remotePackageName, 80),
      remotePackageDays: normalizeNullablePositiveInteger(item?.remotePackageDays),
      ...(Object.hasOwn(item || {}, 'entitlementDays') && (item.entitlementDays === null || (Number.isInteger(item.entitlementDays) && item.entitlementDays > 0 && item.entitlementDays <= 3650)) ? { entitlementDays: item.entitlementDays === null ? null : normalizeNullablePositiveInteger(item.entitlementDays) } : {}),
      ...(item?.entitlementSource ? { entitlementSource: item.entitlementSource === 'provider' ? 'provider' : 'local' } : {}),
      payment: normalizePaymentPayload(item?.payment),
      createdAt: normalizeRecordDate(item?.createdAt) || new Date().toISOString(),
      updatedAt: normalizeRecordDate(item?.updatedAt) || new Date().toISOString(),
      paidAt: normalizeRecordDate(item?.paidAt) || null,
      remoteExpireAt: normalizeRecordDate(item?.remoteExpireAt) || null,
      paymentQueryCredential,
      paymentRequiresLogin: Boolean(item?.paymentRequiresLogin),
    }
  }).filter((item) => item.userId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, MAX_UPGRADE_ORDERS)
}

export function normalizePaymentQueryCredential(order) {
  const credential = order?.paymentQueryCredential
  const apiWebToken = trimRecordString(credential?.apiWebToken, 300)
  const deadline = new Date(order?.createdAt).getTime() + PAYMENT_QUERY_RETENTION_MS
  const expiresAt = Math.min(new Date(credential?.expiresAt).getTime(), deadline)
  if (!apiWebToken || order.status === 'paid' || order.paymentRequiresLogin || !order.remoteOrderNo || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null
  return { apiWebToken, expiresAt: new Date(expiresAt).toISOString() }
}

export function normalizeMemberStatus(value) {
  if (value === 'invited') return 'invited'
  if (value === 'requested') return 'requested'
  return 'active'
}

export function normalizeSystemConfig(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const defaultShareDays = Number(source.defaultShareDays)
  const maxShareDays = Number(source.maxShareDays)
  const anonymousMaxFileSizeMb = Number(source.anonymousMaxFileSizeMb)
  const anonymousTotalSizeMb = Number(source.anonymousTotalSizeMb)
  const maxBatchFiles = Number(source.maxBatchFiles)
  const auditLogRetentionDays = Number(source.auditLogRetentionDays)
  const orphanGraceHours = Number(source.orphanGraceHours)
  return {
    entitlementsVersion: 1,
    maintenanceMode: Boolean(source.maintenanceMode),
    defaultShareDays: Number.isFinite(defaultShareDays) ? Math.min(365, Math.max(1, Math.floor(defaultShareDays))) : DEFAULT_SYSTEM_CONFIG.defaultShareDays,
    maxShareDays: Number.isFinite(maxShareDays) ? Math.min(365, Math.max(1, Math.floor(maxShareDays))) : DEFAULT_SYSTEM_CONFIG.maxShareDays,
    anonymousMaxFileSizeMb: Number.isFinite(anonymousMaxFileSizeMb) ? Math.min(20480, Math.max(1, anonymousMaxFileSizeMb)) : DEFAULT_SYSTEM_CONFIG.anonymousMaxFileSizeMb,
    anonymousTotalSizeMb: Number.isFinite(anonymousTotalSizeMb) ? Math.min(102400, Math.max(0, Math.floor(anonymousTotalSizeMb))) : DEFAULT_SYSTEM_CONFIG.anonymousTotalSizeMb,
    maxBatchFiles: Number.isFinite(maxBatchFiles) ? Math.min(MAX_FILES, Math.max(1, Math.floor(maxBatchFiles))) : DEFAULT_SYSTEM_CONFIG.maxBatchFiles,
    auditLogRetentionDays: Number.isFinite(auditLogRetentionDays) ? Math.min(3650, Math.max(1, Math.floor(auditLogRetentionDays))) : DEFAULT_SYSTEM_CONFIG.auditLogRetentionDays,
    orphanGraceHours: Number.isFinite(orphanGraceHours) ? Math.min(720, Math.max(1, Math.floor(orphanGraceHours))) : DEFAULT_SYSTEM_CONFIG.orphanGraceHours,
    anonymousCollectionParticipantLimit: Math.min(10000, Math.max(0, Math.floor(Number(source.anonymousCollectionParticipantLimit ?? DEFAULT_SYSTEM_CONFIG.anonymousCollectionParticipantLimit) || 0))),
    anonymousActiveCollectionLimit: Math.min(1000, Math.max(0, Math.floor(Number(source.anonymousActiveCollectionLimit ?? DEFAULT_SYSTEM_CONFIG.anonymousActiveCollectionLimit) || 0))),
    planOverrides: normalizePlanOverrides(source.planOverrides),
  }
}

export function normalizePlanOverrides(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const overrides = {}
  for (const planId of Object.keys(ACCOUNT_PLANS)) {
    const plan = source[planId] && typeof source[planId] === 'object' ? source[planId] : {}
    const normalized = {}
    for (const [field, alias, min, max] of [['totalBytes', 'totalGb', 1, 20480 * 1024 ** 3], ['teamSpaceBytes', 'teamGb', 0, 20480 * 1024 ** 3], ['singleFileLimitBytes', 'singleFileGb', 1, 20 * 1024 ** 3]]) {
      const gb = plan[alias] ?? (field === 'totalBytes' ? plan.totalGB : undefined)
      const value = gb === undefined ? Number(plan[field]) : Number(gb) * 1024 ** 3
      if (Number.isFinite(value) && value >= min) normalized[field] = Math.round(Math.min(max, value))
    }
    for (const [field, max] of [['collectionParticipantLimit', 10000], ['activeCollectionLimit', 1000]]) {
      if (plan[field] !== undefined && Number.isFinite(Number(plan[field])) && Number(plan[field]) >= 0) normalized[field] = Math.min(max, Math.floor(Number(plan[field])))
    }
    if (Object.hasOwn(plan, 'validityDays')) {
      const days = Number(plan.validityDays)
      if (plan.validityDays === null || days === 0) normalized.validityDays = null
      else if (Number.isFinite(days) && days > 0) normalized.validityDays = Math.min(3650, Math.floor(days))
    }
    if (Object.keys(normalized).length) overrides[planId] = normalized
  }
  return overrides
}

export function normalizeAuditLogs(value = []) {
  if (!Array.isArray(value)) return []
  return value.map(normalizeAuditLog).filter((item) => item.action).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, MAX_AUDIT_LOGS)
}

export function normalizeAuditLog(item) {
  return {
    id: trimRecordString(item?.id, 80) || createToken(10),
    type: trimRecordString(item?.type, 30) || 'access',
    action: trimRecordString(item?.action, 180),
    status: normalizeNonNegativeInteger(item?.status),
    durationMs: normalizeNonNegativeInteger(item?.durationMs),
    userId: trimRecordString(item?.userId, 120),
    targetId: trimRecordString(item?.targetId, 160),
    ip: trimRecordString(item?.ip, 80),
    details: item?.details && typeof item.details === 'object' ? item.details : {},
    createdAt: normalizeRecordDate(item?.createdAt) || new Date().toISOString(),
  }
}

export function normalizeOwnershipHandovers(value) {
  if (!Array.isArray(value)) return []
  const statuses = new Set(['pending', 'accepted', 'declined', 'canceled', 'expired', 'invalidated'])
  const seen = new Set()
  return value.filter(item => item && typeof item === 'object').map(item => ({
    id: trimRecordString(item.id, 80),
    fromUserId: trimRecordString(item.fromUserId, 120), toUserId: trimRecordString(item.toUserId, 120),
    toMemberId: trimRecordString(item.toMemberId, 80),
    fromName: trimRecordString(item.fromName, 80) || '原所有者', toName: trimRecordString(item.toName, 80) || '接收者',
    status: statuses.has(item.status) ? item.status : 'invalidated',
    initiatedAt: normalizeRecordDate(item.initiatedAt), expiresAt: normalizeRecordDate(item.expiresAt),
    resolvedAt: normalizeRecordDate(item.resolvedAt), resolvedByUserId: trimRecordString(item.resolvedByUserId, 120),
    reason: trimRecordString(item.reason, 180),
  })).filter(item => {
    if (!item.id || !item.fromUserId || !item.toUserId || seen.has(item.id)) return false
    seen.add(item.id)
    return true
  }).sort((a, b) => Date.parse(b.initiatedAt || 0) - Date.parse(a.initiatedAt || 0))
}

export function normalizeOrganizations(value = []) {
  const source = Array.isArray(value)
    ? Object.fromEntries(value.map((item) => [item?.id, item]))
    : value && typeof value === 'object' ? value : {}
  const organizations = {}
  for (const item of Object.values(source)) {
    if (!item?.id) continue
    const members = Array.isArray(item.members) ? item.members.map((member) => ({
      id: trimRecordString(member?.id, 80) || createToken(10),
      userId: trimRecordString(member?.userId, 120),
      email: normalizeEmailValue(member?.email),
      phone: normalizePhoneValue(member?.phone),
      displayName: trimRecordString(member?.displayName, 80) || '团队成员',
      role: member?.role === 'owner' ? 'owner' : member?.role === 'admin' ? 'admin' : 'member',
      status: normalizeMemberStatus(member?.status),
      invitationId: trimRecordString(member?.invitationId, 120),
      joinRequestId: trimRecordString(member?.joinRequestId, 120),
      joinSource: trimRecordString(member?.joinSource, 20),
      joinMessage: trimRecordString(member?.joinMessage, 120),
      requestedAt: normalizeRecordDate(member?.requestedAt),
      reviewedAt: normalizeRecordDate(member?.reviewedAt),
      joinedAt: normalizeRecordDate(member?.joinedAt),
      invitedAt: normalizeRecordDate(member?.invitedAt),
      invitationExpiresAt: normalizeRecordDate(member?.invitationExpiresAt),
    })) : []
    organizations[item.id] = {
      id: trimRecordString(item.id, 80),
      slug: trimRecordString(item.slug, 80) || `team-${createToken(6)}`,
      name: trimRecordString(item.name, 80) || '未命名团队',
      ownerUserId: trimRecordString(item.ownerUserId, 120),
      // 团队套餐属于组织，不随所有权转让而丢失。旧数据没有这些字段时，
      // account 服务会按所有者/历史成员套餐兼容读取并在后续写入时补齐。
      teamPlanId: item.teamPlanId ? normalizePlanId(item.teamPlanId) : '',
      teamPlanStartedAt: normalizeRecordDate(item.teamPlanStartedAt),
      teamPlanExpiresAt: normalizeRecordDate(item.teamPlanExpiresAt),
      teamPlanPermanent: item.teamPlanPermanent ?? (!item.teamPlanExpiresAt && Boolean(ACCOUNT_PLANS[item.teamPlanId]?.permanent)),
      ownershipHandovers: normalizeOwnershipHandovers(item.ownershipHandovers),
      branding: normalizeStoredTeamBranding(item.branding),
      createdAt: normalizeRecordDate(item.createdAt) || new Date().toISOString(),
      updatedAt: normalizeRecordDate(item.updatedAt) || new Date().toISOString(),
      members,
    }
  }
  return organizations
}

export function normalizePlanId(value) {
  const id = String(value || '').trim().toLowerCase()
  return Object.prototype.hasOwnProperty.call(ACCOUNT_PLANS, id) ? id : 'free'
}

export function configuredAccountPlan(planId) {
  const id = normalizePlanId(planId)
  const base = ACCOUNT_PLANS[id] || ACCOUNT_PLANS.free
  const override = normalizeSystemConfig(runtime.metadataReady?.systemConfig || {}).planOverrides[id] || {}
  const plan = { ...base, ...override, id: base.id, label: base.label }
  plan.permanent = id !== 'free' && plan.validityDays === null
  plan.team = plan.teamSpaceBytes > 0
  const gb = bytes => `${Number((bytes / 1024 ** 3).toFixed(3))} GB`
  plan.features = [
    `${gb(plan.totalBytes)} 个人空间`,
    ...(plan.team ? [`${gb(plan.teamSpaceBytes)} 团队空间`] : []),
    `单文件最大 ${gb(plan.singleFileLimitBytes)}`,
    plan.collectionParticipantLimit ? `每个收集任务最多 ${plan.collectionParticipantLimit} 人` : '收集提交人数不限',
    plan.activeCollectionLimit ? `同时进行 ${plan.activeCollectionLimit} 个收集任务` : '进行中的收集任务数不限',
    id === 'free' ? '文件临时保存，到期自动失效' : plan.permanent ? '永久权益' : `权益有效期 ${plan.validityDays} 天`,
  ]
  return plan
}

export function normalizeGuestUsageStore(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const entries = []
  for (const [key, entry] of Object.entries(source)) {
    if (!key || !entry || typeof entry !== 'object') continue
    const bytes = Math.max(0, Math.floor(Number(entry.bytes) || 0))
    if (!bytes) continue
    entries.push({
      key,
      entry: {
        bytes,
        uploads: Math.max(0, Math.floor(Number(entry.uploads) || 0)),
        firstAt: normalizeRecordDate(entry.firstAt) || new Date().toISOString(),
        lastAt: normalizeRecordDate(entry.lastAt) || new Date().toISOString(),
      },
    })
  }
  entries.sort((a, b) => new Date(a.entry.lastAt).getTime() - new Date(b.entry.lastAt).getTime())
  const store = {}
  for (const { key, entry } of entries.slice(-MAX_GUEST_USAGE_ENTRIES)) store[key] = entry
  return store
}

export function publicUser(user = {}) {
  const avatarSource = String(user.avatarSource || '')
  const providerAvatar = user.providerAvatar || (!avatarSource ? user.avatar : null) || null
  const provider = String(user.provider || user.login_provider || user.oauth_provider || user.channel || user.source || '').trim()
  const email = normalizeEmailValue(user.email || user.mail)
  const phone = normalizePhoneValue(user.phone || user.mobile)
  const username = trimRecordString(user.username || user.name || user.login || email || phone, 80)
  return {
    id: trimRecordString(user.id || user.userId || user.user_id || user.openid || user.open_id || user.unionid || user.sub || email || phone, 120),
    username,
    nickname: trimRecordString(user.nickname || user.displayName || user.display_name || username || '鲲穹用户', 80),
    email,
    phone,
    avatar: user.avatar || null,
    avatarSource,
    providerAvatar,
    provider,
    loginMethods: mergeLoginMethods(user.loginMethods, provider ? ['oauth'] : []),
    planId: user.planId || null,
    planStartedAt: normalizeRecordDate(user.planStartedAt),
    planExpiresAt: normalizeRecordDate(user.planExpiresAt),
    organizationId: trimRecordString(user.organizationId, 80),
    organizationRole: ['owner', 'admin', 'member'].includes(user.organizationRole) ? user.organizationRole : '',
    status: user.status === 'disabled' ? 'disabled' : 'active',
    fileCleanup: normalizeFileCleanupSettings(user.fileCleanup),
    createdAt: normalizeRecordDate(user.createdAt),
    updatedAt: normalizeRecordDate(user.updatedAt),
  }
}

export function normalizeAccountUserStore(value = {}, sessions = []) {
  const store = {}
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const user of Object.values(value)) {
      const normalized = normalizeAccountUser(user)
      if (normalized?.id) store[normalized.id] = mergeAccountUser(store[normalized.id], user)
    }
  }
  for (const session of sessions) {
    const normalized = normalizeAccountUser(session.user)
    if (!normalized?.id) continue
    // 传原始快照（而非归一化结果），保留 mergeAccountUser 需要的意图标记。
    store[normalized.id] = mergeAccountUser(store[normalized.id], session.user)
    session.user = publicUser(store[normalized.id])
  }
  return store
}

export function normalizeAccountUser(user = {}) {
  const base = publicUser(user)
  const contactTarget = base.email
    ? { type: 'email', value: base.email }
    : base.phone
      ? { type: 'phone', value: base.phone }
      : null
  const id = base.id || (contactTarget ? accountUserIdForTarget(contactTarget) : '')
  if (!id) return null
  const testEnterpriseKeys = [id, base.username, base.email, base.phone]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
  const testEnterpriseOverride = !normalizeRecordDate(user.planManagedAt) && (testEnterpriseForAllUsers
    || (testEnforceEnterpriseAllowlist && testEnterpriseKeys.some((value) => TEST_ENTERPRISE_USER_KEYS.has(value))))
  // 白名单仅补充演示企业权益；普通账号的真实购买和后台配置不能被测试开关降级。
  const planId = testEnterpriseOverride ? 'enterprise' : normalizePlanId(user.planId || base.planId || 'free')
  const plan = configuredAccountPlan(planId)
  const planExpiresAt = testEnterpriseOverride ? null : normalizeRecordDate(user.planExpiresAt || base.planExpiresAt)
  if (testEnterpriseOverride) runtime.metadataNeedsPersist = true
  const now = new Date().toISOString()
  return {
    ...base,
    id,
    loginMethods: mergeLoginMethods(base.loginMethods, user.loginMethods),
    planId,
    planStartedAt: normalizeRecordDate(user.planStartedAt || base.planStartedAt),
    planExpiresAt,
    planPermanent: testEnterpriseOverride || (user.planPermanent ?? base.planPermanent ?? (!planExpiresAt && Boolean(ACCOUNT_PLANS[planId]?.permanent))),
    planManagedAt: normalizeRecordDate(user.planManagedAt),
    organizationId: trimRecordString(user.organizationId || base.organizationId, 80),
    organizationRole: ['owner', 'admin', 'member'].includes(user.organizationRole) ? user.organizationRole : '',
    status: user.status === 'disabled' ? 'disabled' : 'active',
    fileCleanup: normalizeFileCleanupSettings(user.fileCleanup),
    createdAt: normalizeRecordDate(user.createdAt) || now,
    updatedAt: normalizeRecordDate(user.updatedAt) || now,
  }
}

export function mergeAccountUser(existing = null, incoming = {}) {
  // 即便还没有既有记录，也要走完整合并流程：否则「首次保存 = 恢复登录头像」
  // 这类只靠 avatarRestoreRequested 表达意图的调用会被 normalizeAccountUser 直接吞掉标记。
  const normalized = normalizeAccountUser(incoming)
  if (!normalized) return existing || null
  const base = existing || normalized
  // 自定义头像一旦保存，就是用户的明确意愿，属于"粘性"字段：
  // 只有「用户主动恢复登录头像」或「重新上传」才允许变更。
  // 此前逻辑用 `avatarSourceExplicit`（incoming 是否带该键）判断"用户是否表态"，
  // 但 OAuth 登录快照、会话快照、后台改库都会带一个显式 avatarSource:''，
  // 于是每次重启归一化 / 重新登录都会把已保存的自定义头像抹成 provider 头像 —— 即"头像丢"。
  // 注意：不能简单用"avatar 为 null"判断恢复，因为恢复时 avatar 会被填成 provider 地址。
  // 因此由调用方通过 avatarRestoreRequested 显式标记"用户就是要恢复登录头像"。
  const restoreRequested = incoming.avatarRestoreRequested === true
  const nextProviderAvatar = normalized.providerAvatar || (!normalized.avatarSource && normalized.avatar) || base.providerAvatar || null
  const nextAvatarSource = normalized.avatarSource === 'custom'
    ? 'custom'
    : base.avatarSource === 'custom' && !restoreRequested
      ? 'custom'
      : ''
  const nextAvatar = nextAvatarSource === 'custom'
    ? normalized.avatarSource === 'custom'
      ? normalized.avatar || base.avatar || null
      : base.avatar || null
    : restoreRequested
      ? (base.providerAvatar || nextProviderAvatar || null)
      : nextProviderAvatar
  const merged = {
    ...base,
    ...normalized,
    nickname: normalized.nickname || base.nickname,
    // 本地验证绑定后，只能通过绑定流程更换；OAuth 和旧会话快照不可覆盖。
    email: base.loginMethods?.includes('email_bound') && incoming.contactBindingType !== 'email' ? base.email : normalized.email || base.email,
    phone: base.loginMethods?.includes('phone_bound') && incoming.contactBindingType !== 'phone' ? base.phone : normalized.phone || base.phone,
    avatar: nextAvatar,
    avatarSource: nextAvatarSource,
    providerAvatar: nextProviderAvatar,
    provider: normalized.provider || base.provider,
    loginMethods: mergeLoginMethods(base.loginMethods, normalized.loginMethods),
    // 套餐由后台和支付流程直接更新账号记录；登录资料、旧会话只能补充身份信息。
    // 有效期与套餐一起保留，包括明确的 null（后台授予的长期/永久权益）。
    planId: base.planId || normalized.planId || 'free',
    planStartedAt: base.planStartedAt || null,
    planExpiresAt: base.planExpiresAt || null,
    planPermanent: base.planPermanent ?? normalized.planPermanent ?? false,
    planManagedAt: base.planManagedAt || null,
    organizationId: normalized.organizationId || base.organizationId,
    organizationRole: normalized.organizationRole || base.organizationRole,
    status: base.status === 'disabled' ? 'disabled' : normalized.status || base.status || 'active',
    fileCleanup: normalized.fileCleanup || base.fileCleanup || DEFAULT_FILE_CLEANUP_SETTINGS,
    createdAt: base.createdAt || normalized.createdAt,
    updatedAt: new Date().toISOString(),
  }
  // 意图标记只在合并过程中有意义，绝不能落库/下发。
  delete merged.avatarRestoreRequested
  delete merged.contactBindingType
  return merged
}

export function normalizeEmailValue(value) {
  const email = trimRecordString(value, 160).toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''
}

export function normalizePhoneValue(value) {
  const digits = String(value || '').replace(/[^\d]/g, '')
  return digits.length >= 6 && digits.length <= 20 ? digits : ''
}

export function accountUserIdForTarget(target) {
  // Contact-derived ids can appear in exported metadata. A keyed digest
  // prevents offline recovery of common email/phone values. Existing users
  // keep their explicit ids, so this only changes newly materialized records.
  return `contact_${target.type}_${keyedDigest(target.value).slice(0, 18)}`
}

export function mergeLoginMethods(...groups) {
  return Array.from(new Set(groups.flatMap((group) => Array.isArray(group) ? group : group ? [group] : []).map((item) => trimRecordString(item, 40)).filter(Boolean)))
}

export function normalizeVerificationScene() {
  return 'bind'
}

export function normalizeVerificationCodes(value = []) {
  if (!Array.isArray(value)) return []
  const now = Date.now()
  return value.map((item) => ({
    id: trimRecordString(item?.id, 80) || createToken(10),
    type: item?.type === 'phone' ? 'phone' : 'email',
    target: trimRecordString(item?.target, 160),
    scene: normalizeVerificationScene(item?.scene),
    codeHash: trimRecordString(item?.codeHash, 80),
    attempts: Math.max(0, Math.min(99, Math.floor(Number(item?.attempts) || 0))),
    createdAt: normalizeRecordDate(item?.createdAt) || new Date().toISOString(),
    expiresAt: normalizeRecordDate(item?.expiresAt),
  })).filter((item) => item.target && item.codeHash && item.expiresAt && new Date(item.expiresAt).getTime() > now).slice(0, MAX_VERIFICATION_CODES)
}

export function normalizeNotificationSettingsStore(value = {}) {
  const store = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return store
  for (const [userId, settings] of Object.entries(value)) {
    const key = accountRecordOwnerKey(userId)
    if (key) store[key] = normalizeNotificationSettings(settings)
  }
  return store
}

export function normalizeNotificationSettings(settings = {}) {
  const next = { ...DEFAULT_NOTIFICATION_SETTINGS }
  if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
    for (const key of Object.keys(DEFAULT_NOTIFICATION_SETTINGS)) {
      if (Object.prototype.hasOwnProperty.call(settings, key)) next[key] = Boolean(settings[key])
    }
  }
  return next
}

export function normalizeFileCleanupSettings(settings = {}) {
  const source = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {}
  const days = Number(source.days)
  return {
    enabled: Boolean(source.enabled),
    days: [1, 3, 7].includes(days) ? days : DEFAULT_FILE_CLEANUP_SETTINGS.days,
  }
}

export function normalizeAccountMessageStore(value = {}) {
  const store = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return store
  for (const [userId, messages] of Object.entries(value)) {
    const key = accountRecordOwnerKey(userId)
    if (key) store[key] = normalizeAccountMessages(messages)
  }
  return store
}

export function normalizeAccountMessages(messages = []) {
  if (!Array.isArray(messages)) return []
  const deduped = new Map()
  messages.map(normalizeAccountMessage).filter(Boolean).forEach((message) => {
    deduped.set(message.id, { ...deduped.get(message.id), ...message })
  })
  return Array.from(deduped.values()).sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()).slice(0, MAX_ACCOUNT_MESSAGES)
}

export function normalizeAccountMessage(message = {}) {
  if (!message || typeof message !== 'object') return null
  const title = trimRecordString(message.title, 80)
  const body = trimRecordString(message.body, 280)
  if (!title && !body) return null
  const createdAt = normalizeRecordDate(message.createdAt) || new Date().toISOString()
  const category = ACCOUNT_MESSAGE_CATEGORIES.has(message.category) ? message.category : 'system'
  return {
    id: trimRecordString(message.id, 120) || createToken(12),
    category,
    eventType: trimRecordString(message.eventType, 40),
    title: title || '鲲穹消息',
    body,
    createdAt,
    unread: message.unread !== false,
    readAt: normalizeRecordDate(message.readAt),
    actionUrl: trimRecordString(message.actionUrl, 400),
    actionType: trimRecordString(message.actionType, 50),
    actionId: trimRecordString(message.actionId, 120),
  }
}

export function accountRecordOwnerKey(userId) {
  return trimRecordString(userId, 120)
}

export function normalizeAccountRecordStore(value = {}) {
  const store = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return store
  for (const [userId, records] of Object.entries(value)) {
    const key = accountRecordOwnerKey(userId)
    if (key) store[key] = normalizeAccountRecords(records)
  }
  return store
}

export function normalizeAccountRecords(records) {
  if (!Array.isArray(records)) return []
  const deduped = new Map()
  records.map(normalizeAccountRecord).filter(Boolean).forEach((record) => {
    const existing = deduped.get(record.id)
    deduped.set(record.id, existing ? mergeAccountRecord(existing, record) : record)
  })
  return Array.from(deduped.values()).sort(compareAccountRecords).slice(0, MAX_ACCOUNT_RECORDS)
}

export function normalizeAccountRecord(record = {}) {
  if (!record || typeof record !== 'object') return null
  const id = trimRecordString(record.id, 180)
  if (!id) return null
  const scope = ACCOUNT_RECORD_SCOPES.has(record.scope) ? record.scope : legacyScopeFromType(record.type)
  const kind = ACCOUNT_RECORD_KINDS.has(record.kind)
    ? record.kind
    : scope === 'my_collections' || scope === 'collect_from_me'
      ? 'collection'
      : 'share'
  const now = new Date().toISOString()
  const createdAt = normalizeRecordDate(record.createdAt || record.submittedAt) || now
  const updatedAt = normalizeRecordDate(record.updatedAt || record.lastSeenAt) || createdAt
  return {
    id,
    scope,
    kind,
    type: trimRecordString(record.type, 20) || (kind === 'collection' ? '收集' : '发送'),
    name: trimRecordString(record.name, 160) || (kind === 'collection' ? '收集任务' : '文件分享'),
    alias: trimRecordString(record.alias, 160),
    meta: trimRecordString(record.meta, 240),
    code: trimRecordString(record.code, 40),
    status: trimRecordString(record.status, 40),
    shareId: trimRecordString(record.shareId, 80),
    shareUrl: trimRecordString(record.shareUrl, 400),
    manageToken: trimRecordString(record.manageToken, 120),
    manageUrl: trimRecordString(record.manageUrl, 400),
    collectionToken: trimRecordString(record.collectionToken, 120),
    publicUrl: trimRecordString(record.publicUrl, 400),
    expiresAt: normalizeRecordDate(record.expiresAt),
    deadline: normalizeRecordDate(record.deadline),
    downloadLimit: normalizeNullablePositiveInteger(record.downloadLimit),
    downloadCount: normalizeNonNegativeInteger(record.downloadCount),
    fileCount: normalizeNonNegativeInteger(record.fileCount),
    totalSize: normalizeNonNegativeInteger(record.totalSize),
    submissionCount: normalizeNonNegativeInteger(record.submissionCount),
    participantName: trimRecordString(record.participantName, 80),
    submittedAt: normalizeRecordDate(record.submittedAt),
    allowedTypes: normalizeRecordStringArray(record.allowedTypes, 12, 20),
    maxFileSizeMb: normalizeNullablePositiveInteger(record.maxFileSizeMb),
    files: normalizeRecordFiles(record.files),
    submissions: normalizeRecordSubmissions(record.submissions),
    createdAt,
    updatedAt,
  }
}

export function mergeAccountRecord(existing, incoming) {
  const merged = { ...existing, ...incoming }
  merged.createdAt = existing.createdAt || incoming.createdAt
  merged.updatedAt = incoming.updatedAt || existing.updatedAt || merged.createdAt
  if (!incoming.shareId && existing.shareId) merged.shareId = existing.shareId
  if (!incoming.shareUrl && existing.shareUrl) merged.shareUrl = existing.shareUrl
  if (!incoming.manageToken && existing.manageToken) merged.manageToken = existing.manageToken
  if (!incoming.manageUrl && existing.manageUrl) merged.manageUrl = existing.manageUrl
  if (!incoming.alias && existing.alias) merged.alias = existing.alias
  if ((!incoming.name || incoming.name === '文件分享' || incoming.name === '收集任务') && existing.name) merged.name = existing.name
  if (!incoming.meta && existing.meta) merged.meta = existing.meta
  if (!incoming.fileCount && existing.fileCount) merged.fileCount = existing.fileCount
  if (!incoming.totalSize && existing.totalSize) merged.totalSize = existing.totalSize
  if (!incoming.submissionCount && existing.submissionCount) merged.submissionCount = existing.submissionCount
  if ((!incoming.files || !incoming.files.length) && existing.files?.length) merged.files = existing.files
  if ((!incoming.submissions || !incoming.submissions.length) && existing.submissions?.length) merged.submissions = existing.submissions
  return merged
}

export function normalizeRecordFiles(files) {
  if (!Array.isArray(files)) return []
  return files.slice(0, MAX_RECORD_FILES).map((file, index) => ({
    name: trimRecordString(file?.name, 240) || `文件 ${index + 1}`,
    relativePath: trimRecordString(file?.relativePath || file?.name, 1024),
    size: normalizeNonNegativeInteger(file?.size),
    mimeType: trimRecordString(file?.mimeType, 100),
  }))
}

export function normalizeRecordSubmissions(submissions) {
  if (!Array.isArray(submissions)) return []
  return submissions.slice(0, MAX_RECORD_SUBMISSIONS).map((submission) => ({
    id: trimRecordString(submission?.id, 120),
    participantName: trimRecordString(submission?.participantName, 80),
    submitterUserId: trimRecordString(submission?.submitterUserId, 120),
    submitterName: trimRecordString(submission?.submitterName, 80),
    submittedAt: normalizeRecordDate(submission?.submittedAt),
    files: normalizeRecordFiles(submission?.files),
  })).filter((submission) => submission.id || submission.files.length)
}

export function normalizeRecordStringArray(value, limit, maxLength) {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((item) => trimRecordString(item, maxLength)).filter(Boolean))).slice(0, limit)
}

export function normalizeRecordDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function normalizeNullablePositiveInteger(value) {
  if (value === null || value === undefined || value === '' || value === 'unlimited') return null
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null
}

export function normalizeNonNegativeInteger(value) {
  const number = Number(value || 0)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0
}

export function trimRecordString(value, maxLength) {
  const text = String(value ?? '').trim()
  const sliced = text.length > maxLength ? text.slice(0,maxLength) : text
  return sliced.replace(/[\uD800-\uDBFF]$/, '').toWellFormed()
}

export function legacyScopeFromType(type) {
  if (type === '收取' || type === '接收') return 'sent_to_me'
  if (type === '被收集' || type === '提交') return 'collect_from_me'
  if (type === '收集') return 'my_collections'
  return 'my_sent'
}

export function compareAccountRecords(a, b) {
  return new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime()
}

export function normalizeWebMemberPayType(value) {
  return Number(value) === 2 ? 2 : 1
}

export function normalizePaymentPayload(value) {
  if (!value || typeof value !== 'object') return null
  return {
    pay_type: normalizeWebMemberPayType(value.pay_type),
    code_url: trimRecordString(value.code_url, 1000),
    qrcode_img_url: trimRecordString(value.qrcode_img_url, 2_000_000),
    alipaysubmit_html: trimRecordString(value.alipaysubmit_html, 2_000_000),
  }
}
