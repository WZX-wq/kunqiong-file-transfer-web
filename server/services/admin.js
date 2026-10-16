import { clientAddress } from '../lib/request-security.js'
import { equalSecret, pruneAttempts } from '../lib/security-primitives.js'
// 后台管理与身份（OAuth 回调 / 管理员会话 / 运维清理）域业务逻辑
//
// 依赖方向（单向）：本模块只依赖 config / state / lib / services/*，
// 不 import server.mjs，也不 import routes。
//
// 说明：管理员会话函数（adminSessionFromRequest / cleanupExpiredAdminSessions）
// 上一轮误归入 services/shares.js，且被 shares 的 assertServiceWritable 依赖，
// 搬回会形成 shares→admin 环，故保留在 shares.js，本模块从其 import。

import { integerInput } from '../lib/input-validation.js'

import {
  ADMIN_ACCOUNT_USERNAME, ADMIN_COOKIE_NAME, ADMIN_LOGIN_MAX_ATTEMPTS, ADMIN_LOGIN_WINDOW_MS,
  ADMIN_SESSION_TTL_MS, AUTH_COOKIE_NAME, collectionsRoot, filesRoot, oauthClientId,
  oauthClientSecret, oauthTokenUrl
} from '../config.js'
import {
  createToken, removeDirectory
} from '../lib/http.js'
import { keyedDigest } from '../lib/private-key.js'
import {
  mergeLoginMethods, normalizeSystemConfig, publicUser, trimRecordString
} from '../lib/metadata-normalizers.js'
import {
  metadata, persistMetadata, purgeAuditLogsBefore, readAuditLogs
} from '../lib/metadata-store.js'
import {
  organizationRoleForUser, accountOrganizationForUser, accountPersonalPlanForUser, accountUsageForUser, cleanupExpired,
  cleanupExpiredAuthSessions, cleanupOAuthStates, configuredAccountPlans,
  currentCollectionStatus, currentShareStatus, fileListSize, isSecureRequest,
  parseAccountRecordResource, readCookie, reconcileUserUpgradeOrders,
  retainUserPaymentQueryCredentials, serializeCookie, syncOrganizationMemberProfile,
  upsertAccountUser, oauthStateCookieName
} from '../services/account.js'
import {
  adminSessionFromRequest, cleanupExpiredAdminSessions
} from '../services/shares.js'
import {
  adminLoginAttempts, adminSessions, oauthStates, paymentSessionTokens
} from '../state.js'
import fs from 'node:fs'
import path from 'node:path'

export function createAdminSession(req) {
  cleanupExpiredAdminSessions()
  const token = createToken(48)
  const session = {
    token,
    username: ADMIN_ACCOUNT_USERNAME,
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + ADMIN_SESSION_TTL_MS,
    lastIp: clientIpFromRequest(req),
  }
  adminSessions.set(token, session)
  return session
}

export function adminSessionDescriptor(session) {
  if (!session) return null
  return {
    username: session.username,
    userId: `admin:${session.username}`,
    createdAt: session.createdAt,
    expiresAt: new Date(session.expiresAt).toISOString(),
  }
}

export function removeAdminSession(req) {
  const token = readCookie(req, ADMIN_COOKIE_NAME)
  if (token) adminSessions.delete(token)
}

export function setAdminCookie(res, token, req) {
  res.setHeader('Set-Cookie', serializeCookie(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    maxAge: Math.floor(ADMIN_SESSION_TTL_MS / 1000),
    path: '/',
    sameSite: 'Lax',
    secure: isSecureRequest(req),
  }))
}

export function clearAdminCookie(res, req) {
  res.setHeader('Set-Cookie', serializeCookie(ADMIN_COOKIE_NAME, '', {
    httpOnly: true,
    maxAge: 0,
    path: '/',
    sameSite: 'Lax',
    secure: isSecureRequest(req),
  }))
}

export function clientIpFromRequest(req) {
  return clientAddress(req)
}

// 限流用的客户端标识。
//
// 默认以 socket 地址区分客户端；仅显式配置可信代理时才逐跳读取 XFF，
// 遇到第一个不可信地址即停止，避免伪造头绕过限流或反代用户共用单桶。
// 另保留更宽松的全局桶，约束分布式口令尝试。
export function adminRateLimitKeys(req) {
  const keys = [`client:${clientIpFromRequest(req)}`]
  // 全局兜底桶：无论怎么伪造上游头，总量都受限，避免完全敞开
  keys.push('global')
  return keys
}

export function adminLoginRateLimited(req) {
  const now = Date.now()
  if (!pruneAttempts(adminLoginAttempts, ADMIN_LOGIN_WINDOW_MS, now)) return true
  return adminRateLimitKeys(req).some((key) => {
    const record = adminLoginAttempts.get(key)
    if (!record || now - record.startedAt > ADMIN_LOGIN_WINDOW_MS) return false
    // 全局桶给更宽松的额度，以免正常用户被少量失败拖累
    const limit = key === 'global' ? ADMIN_LOGIN_MAX_ATTEMPTS * 6 : ADMIN_LOGIN_MAX_ATTEMPTS
    return record.count >= limit
  })
}

export function recordAdminLoginFailure(req) {
  const now = Date.now()
  if (!pruneAttempts(adminLoginAttempts, ADMIN_LOGIN_WINDOW_MS, now)) return
  for (const key of adminRateLimitKeys(req)) {
    const record = adminLoginAttempts.get(key)
    if (!record || now - record.startedAt > ADMIN_LOGIN_WINDOW_MS) {
      adminLoginAttempts.set(key, { count: 1, startedAt: now })
      continue
    }
    record.count += 1
  }
}

export function clearAdminLoginFailures(req) {
  for (const key of adminRateLimitKeys(req)) adminLoginAttempts.delete(key)
}

export function safeEqualString(a, b) {
  return equalSecret(a, b)
}

// 返回 { session } 表示通过管理员口令校验；返回 null 时已写出错误响应。
//
// 后台**只认管理员账号口令**（cookie kunqiong_admin_session）。
// 鲲穹账号通道（KUNQIONG_ADMIN_USER_IDS 白名单）已移除：它让白名单账号
// 无需密码即可进入后台，是权限绕过。注意 isAdminUser 仍保留，
// 它只用于维护模式等服务端豁免，不再参与后台鉴权。
export function requireAdminSession(req, res) {
  const adminSession = adminSessionFromRequest(req)
  if (adminSession) return { type: 'credential', session: adminSession, user: { id: `admin:${adminSession.username}`, name: adminSession.username } }
  res.status(401).json({ message: '请先使用管理员账号密码登录后台' })
  return null
}

export function adminUserSummary(user) {
  const usage = accountUsageForUser(user.id)
  const organization = accountOrganizationForUser(user.id)
  // 后台用户列表展示的是**个人套餐** —— 加入团队不应让这个用户看起来被升级了。
  // 团队归属另用 organizationName 表达，两者互不混淆。
  const plan = accountPersonalPlanForUser(user)
  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    email: user.email,
    phone: user.phone,
    status: user.status || 'active',
    planId: plan.id,
    planLabel: plan.label,
    planExpiresAt: user.planExpiresAt || null,
    organizationName: organization?.name || '',
    organizationRole: organizationRoleForUser(organization, user.id),
    usageBytes: usage.usedBytes,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }
}

export function adminResourceSummary(kind, item) {
  const files = kind === 'share'
    ? item.files || []
    : (item.submissions || []).flatMap((submission) => submission.files || [])
  return {
    id: item.id || item.token,
    kind,
    name: kind === 'share' ? (files[0]?.name || '文件分享') : (item.title || '收集任务'),
    code: kind === 'share' ? (item.code || '') : '',
    ownerUserId: item.ownerUserId || '',
    status: kind === 'share' ? currentShareStatus(item) : currentCollectionStatus(item),
    fileCount: files.length,
    totalSize: fileListSize(files),
    createdAt: item.createdAt,
    expiresAt: kind === 'share' ? item.expiresAt : item.deadline,
  }
}

export function buildAdminOverview() {
  const users = Object.values(metadata.users || {}).map(adminUserSummary).sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
  const resources = [
    ...metadata.shares.map((item) => adminResourceSummary('share', item)),
    ...metadata.collections.map((item) => adminResourceSummary('collection', item)),
  ].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
  const totalBytes = resources.reduce((sum, item) => sum + item.totalSize, 0)
  const trend = adminTrendStats()
  const auditLogsAll = readAuditLogs()
  return {
    stats: {
      users: users.length,
      activeUsers: users.filter((user) => user.status !== 'disabled').length,
      shares: metadata.shares.length,
      collections: metadata.collections.length,
      files: resources.reduce((sum, item) => sum + item.fileCount, 0),
      totalBytes,
      activeResources: resources.filter((item) => item.status === 'active').length,
      activeOrganizations: Object.keys(metadata.organizations || {}).length,
      pendingCleanup: resources.filter((item) => item.status !== 'active' || (item.expiresAt && new Date(item.expiresAt).getTime() <= Date.now())).length,
    },
    trend,
    // 列表接口有 200/100 条截断，totals 保留真实总数供前端提示「仅显示前 N 条」
    totals: { users: users.length, resources: resources.length, auditLogs: auditLogsAll.length },
    users: users.slice(0, 200),
    resources: resources.slice(0, 200),
    auditLogs: auditLogsAll.slice(0, 100),
    config: normalizeSystemConfig(metadata.systemConfig),
    plans: configuredAccountPlans(),
  }
}

export function adminTrendStats() {
  const auditLogs = readAuditLogs()
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date()
    date.setHours(0, 0, 0, 0)
    date.setDate(date.getDate() - (6 - index))
    return date
  })
  return days.map((date) => {
    const next = new Date(date)
    next.setDate(next.getDate() + 1)
    const logs = auditLogs.filter((item) => {
      const time = new Date(item.createdAt).getTime()
      return time >= date.getTime() && time < next.getTime()
    })
    const activeUsers = new Set(logs.map((item) => item.userId).filter(Boolean)).size
    const uploads = logs.filter((item) => /POST (?:\/api\/shares|\/api\/upload-sessions|\/api\/collections)/.test(item.action)).length
    const downloads = logs.filter((item) => /GET \/api\/(?:shares|collections\/manage)\/.*download/.test(item.action) && item.status >= 200 && item.status < 300).length
    return {
      date: date.toISOString().slice(0, 10),
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      activeUsers,
      uploads,
      downloads,
    }
  })
}

export function cleanupStorageOrphans() {
  const graceMs = normalizeSystemConfig(metadata.systemConfig).orphanGraceHours * 3600000
  const cutoff = Date.now() - graceMs
  const validShareIds = new Set(metadata.shares.map((item) => item.id))
  const validCollectionIds = new Set(metadata.collections.map((item) => item.id))
  const removed = { shares: 0, collections: 0 }
  const statMtimeMs = (target) => {
    try { return fs.statSync(target).mtimeMs } catch { return 0 }
  }
  for (const entry of safeDirectoryEntries(filesRoot)) {
    const target = path.join(filesRoot, entry)
    if (!validShareIds.has(entry) && statMtimeMs(target) < cutoff) {
      removeDirectory(target)
      removed.shares += 1
    }
  }
  for (const entry of safeDirectoryEntries(collectionsRoot)) {
    const target = path.join(collectionsRoot, entry)
    if (!validCollectionIds.has(entry) && statMtimeMs(target) < cutoff) {
      removeDirectory(target)
      removed.collections += 1
    }
  }
  return removed
}

export function safeDirectoryEntries(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return []
  }
}

// 资源被清掉后，把各用户记录里仍指向这些资源的条目一并摘除，避免记录页出现「点了就 410」的死链。
export function pruneRecordsForPurgedResources(shareKeys, collectionKeys) {
  if ((!shareKeys || !shareKeys.size) && (!collectionKeys || !collectionKeys.size)) return
  for (const [userId, records] of Object.entries(metadata.records || {})) {
    if (!Array.isArray(records) || !records.length) continue
    const next = records.filter((record) => {
      const parsed = parseAccountRecordResource(record.id)
      if (!parsed) return true
      if (parsed.kind === 'share') return !shareKeys.has(parsed.key)
      return !collectionKeys.has(parsed.key)
    })
    if (next.length !== records.length) metadata.records[userId] = next
  }
}

// 后台「执行清理」的实质动作：把所有已关闭/过期的非团队资源连同文件彻底移除。
// ⚠️ 只能由 POST /api/admin/cleanup（带确认弹窗）触发，绝不能挂进 cleanupExpired 定时链路 ——
// 团队资源关闭后所有者仍可打开/重新开启，自动清理会让「重新开启分享」功能变成摆设。
export function purgeStaleResources() {
  const removed = { shares: 0, collections: 0 }
  // 团队资源关闭后仍归团队空间与所有者管理，不参与清理
  const staleShares = metadata.shares.filter((share) => !share.teamResource && currentShareStatus(share) !== 'active')
  if (staleShares.length) {
    const removedShareKeys = new Set()
    for (const share of staleShares) {
      removeDirectory(path.join(filesRoot, share.id))
      removedShareKeys.add(share.id)
      if (share.manageToken) removedShareKeys.add(share.manageToken)
      if (share.code) removedShareKeys.add(share.code)
    }
    metadata.shares = metadata.shares.filter((share) => !staleShares.includes(share))
    removed.shares = staleShares.length
    pruneRecordsForPurgedResources(removedShareKeys, new Set())
  }
  const staleCollections = metadata.collections.filter((task) => currentCollectionStatus(task) !== 'active')
  if (staleCollections.length) {
    const removedCollectionKeys = new Set()
    for (const task of staleCollections) {
      removeDirectory(path.join(collectionsRoot, task.id))
      if (task.id) removedCollectionKeys.add(task.id)
      if (task.token) removedCollectionKeys.add(task.token)
      if (task.manageToken) removedCollectionKeys.add(task.manageToken)
    }
    metadata.collections = metadata.collections.filter((task) => !staleCollections.includes(task))
    removed.collections = staleCollections.length
    pruneRecordsForPurgedResources(new Set(), removedCollectionKeys)
  }
  return removed
}

// 按系统配置的保留天数清除过期审计日志；只有真删了才落盘，避免空转写
export function purgeExpiredAuditLogs() {
  const retentionMs = normalizeSystemConfig(metadata.systemConfig).auditLogRetentionDays * 86400000
  const cutoff = Date.now() - retentionMs
  return purgeAuditLogsBefore(cutoff)
}

export function runMaintenanceCleanup() {
  cleanupExpired()
  // 真实清除已关闭/过期资源（此前 cleanupExpired 只标记状态不删对象，expiredShares 恒为 0 的假计数由此而来）
  const purged = purgeStaleResources()
  if (purged.shares || purged.collections) persistMetadata()
  const orphaned = cleanupStorageOrphans()
  const removedAuditLogs = purgeExpiredAuditLogs()
  return {
    expiredShares: purged.shares,
    expiredCollections: purged.collections,
    orphaned,
    removedAuditLogs,
  }
}

export async function exchangeOAuthToken(code, redirectUri) {
  const response = await fetch(oauthTokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      client_id: oauthClientId,
      client_secret: oauthClientSecret,
      redirect_uri: redirectUri,
    }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || (payload.code && payload.code !== 200)) {
    throw new Error(payload.message || `登录服务返回 ${response.status}`)
  }
  const data = payload.data || payload
  if (!data.access_token || !data.user) throw new Error('登录服务返回数据不完整')
  return data
}

export function createAuthSession(tokenData) {
  const expiresIn = integerInput(tokenData.expires_in === undefined ? 3600 : tokenData.expires_in,'登录会话有效期',1,30*86400,{string:false})
  cleanupExpiredAuthSessions()
  const now = new Date()
  const user = upsertAccountUser({
    ...(tokenData.user || {}),
    loginMethods: mergeLoginMethods(tokenData.user?.loginMethods, ['oauth']),
  })
  const session = {
    id: createToken(40),
    expiresAt: new Date(now.getTime() + expiresIn * 1000).toISOString(),
    createdAt: now.toISOString(),
    apiWebToken: trimRecordString(tokenData.api_web_token || tokenData.apiWebToken || tokenData.access_token, 300),
    user: publicUser(user),
  }
  metadata.sessions.push(session)
  paymentSessionTokens.set(user.id, session.apiWebToken)
  retainUserPaymentQueryCredentials(session, true)
  // 每次登录顺带把团队 roster 上的旧昵称/联系方式刷新一遍，
  // 这样即使改名的请求没走到 PATCH /api/auth/profile（例如离线改的），下次登录也能自愈。
  syncOrganizationMemberProfile(user)
  persistMetadata()
  reconcileUserUpgradeOrders(session, true).catch(() => {})
  return session
}

export function consumeOAuthState(state, req) {
  cleanupOAuthStates()
  if (!state || !oauthStates.has(state)) return null
  const value = oauthStates.get(state)
  if (!req || !value.browserHash || keyedDigest(readCookie(req, oauthStateCookieName(state))) !== value.browserHash) return null
  oauthStates.delete(state)
  return value
}

export function setAuthCookie(res, sessionId, expiresAt, req) {
  const maxAge = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))
  res.setHeader('Set-Cookie', serializeCookie(AUTH_COOKIE_NAME, sessionId, {
    httpOnly: true,
    maxAge,
    path: '/',
    sameSite: 'Lax',
    secure: isSecureRequest(req),
  }))
}
