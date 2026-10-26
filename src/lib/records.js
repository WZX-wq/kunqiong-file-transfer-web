// record 数据层：记录对象的规范化 / 合并 / 展示字段计算 / 本地与云端 CRUD。
// 从 src/main.jsx 拆出，纯函数为主，无 React 组件依赖。
import {
  COLLECTION_TYPE_CATEGORY_KEYS, COLLECTION_TYPE_EXTENSIONS, COLLECTION_TYPE_OPTIONS,
  DEFAULT_NOTICE_SETTINGS, EXPIRING_SOON_MS, FILE_CATEGORY_FILTERS, MAX_LOCAL_RECORDS,
  RECORD_SCOPE_TABS, RECORD_STORAGE_KEY
} from './constants.js'
import {
  addLocalDays, fileExtension, formatBytes, formatDateInput, formatShortDate,
  isClosedStatus, isExpiredStatus, isExpiringSoonStatus, isPastDeadline,
  parseLocalDate, recordAgeLabel, startOfLocalDay, totalFileSize
} from './format.js'
import {
  apiRequest, getUrlParts, markRecordUnavailable
} from './api.js'
import {
  Download, FileArchive, FileCheck2, FileText, Image as ImageIcon, Inbox, Send, UploadCloud
} from 'lucide-react'

const SHARE_PERMISSION_RETRY_MS = 5 * 60 * 1000

export function normalizeNoticeSettings(settings = {}) {
  const next = { ...DEFAULT_NOTICE_SETTINGS }
  if (settings && typeof settings === 'object') {
    Object.keys(DEFAULT_NOTICE_SETTINGS).forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(settings, key)) next[key] = Boolean(settings[key])
    })
  }
  return next
}

export function normalizeFileCleanupSettings(settings = {}) {
  const source = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {}
  const days = Number(source.days)
  return {
    enabled: Boolean(source.enabled),
    days: [1, 3, 7].includes(days) ? days : 3,
  }
}

export function normalizeMessages(messages = []) {
  if (!Array.isArray(messages)) return []
  return messages.map((message) => ({
    id: String(message?.id || `${Date.now()}-${Math.random()}`),
    category: ['system', 'official', 'other'].includes(message?.category) ? message.category : 'system',
    title: String(message?.title || '鲲穹消息'),
    body: String(message?.body || ''),
    createdAt: message?.createdAt || new Date().toISOString(),
    unread: message?.unread !== false,
    actionUrl: String(message?.actionUrl || ''),
    eventType: String(message?.eventType || ''),
    actionType: String(message?.actionType || ''),
    actionId: String(message?.actionId || ''),
  })).sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
}

export function formatAllowedTypes(types) {
  const normalized = normalizeCollectionTypes(types)
  return normalized.includes('全部格式') ? '全部格式' : normalized.join('、')
}
export function normalizeCollectionTypes(types) {
  const values = Array.isArray(types) ? types.filter((type) => COLLECTION_TYPE_OPTIONS.includes(type)) : []
  if (!values.length || values.includes('全部格式')) return ['全部格式']
  return Array.from(new Set(values))
}
export function toggleCollectionType(types, type) {
  if (type === '全部格式') return ['全部格式']
  const current = normalizeCollectionTypes(types).filter((item) => item !== '全部格式')
  const next = current.includes(type) ? current.filter((item) => item !== type) : [...current, type]
  return next.length ? next : ['全部格式']
}

export function getShareToken(value) {
  const parts = getUrlParts(value)
  return parts[0] === 'share' ? parts[1] || '' : ''
}

export function getCollectionToken(value) {
  const parts = getUrlParts(value)
  return parts[0] === 'collect' && parts[1] !== 'manage' ? parts[1] || '' : ''
}

export function getManageToken(value) {
  const parts = getUrlParts(value)
  const index = parts.indexOf('manage')
  return index >= 0 ? parts[index + 1] || '' : ''
}

export async function syncRecords(records) {
  const updates = await Promise.all(normalizeRecords(records).map(syncRecord))
  return normalizeRecords(updates.filter(Boolean))
}

export async function syncRecord(record) {
  if (record.kind === 'collection') return syncCollectionRecord(record)
  return syncShareRecord(record)
}

export async function syncShareRecord(record) {
  // Historical shares cannot become available through polling. Keep their
  // stored metadata and avoid issuing requests that are expected to return 410.
  if (record.status === '无管理权限') {
    const lastCheck = new Date(record.updatedAt || 0).getTime()
    if (Number.isFinite(lastCheck) && Date.now() - lastCheck < SHARE_PERMISSION_RETRY_MS) return record
  } else if (isExpiredStatus(record.status) || isPastDeadline(record.expiresAt)) return record
  const lookupUrl = record.scope === 'my_sent' && record.manageToken
    ? `/api/shares/manage/${encodeURIComponent(record.manageToken)}`
    : record.shareId
    ? `/api/shares/token/${encodeURIComponent(record.shareId)}`
    : record.code
      ? `/api/shares/lookup/${encodeURIComponent(record.code)}`
      : ''
  if (!lookupUrl) return record
  try {
    let data = await apiRequest(lookupUrl)
    if (record.scope === 'my_sent' && data.share?.manageToken && !data.share.files?.length && data.requiresPassword) {
      data = await apiRequest(`/api/shares/manage/${encodeURIComponent(data.share.manageToken)}`)
    }
    const refreshed = createShareRecord(data.share, record.scope)
    refreshed.createdAt = record.createdAt || refreshed.createdAt
    refreshed.updatedAt = record.updatedAt || refreshed.updatedAt
    // 密码保护返回的是未解锁元数据；只有完整文件列表才能覆盖已有的文件快照。
    return data.requiresPassword && !data.share.files?.length ? mergeRecord(record, refreshed) : {
      ...mergeRecord(record, refreshed), files: refreshed.files, fileCount: refreshed.fileCount, totalSize: refreshed.totalSize,
    }
  } catch (error) {
    // 404 = 资源已被物理删除（过期不会 404）：条目是死链，直接移除而非标记状态
    if (error.status === 404) return null
    if (record.scope === 'my_sent' && error.status === 403) {
      return { ...record, status: '无管理权限', updatedAt: new Date().toISOString() }
    }
    if (error.status === 410) {
      return { ...record, status: '已失效', updatedAt: new Date().toISOString() }
    }
    return markRecordUnavailable(record, error.message)
  }
}

export async function syncCollectionRecord(record) {
  const manageToken = record.manageToken || getManageToken(record.manageUrl)
  const collectionToken = record.collectionToken || getCollectionToken(record.publicUrl || record.shareUrl)
  const lookupUrl = record.scope === 'my_collections' && manageToken
    ? `/api/collections/manage/${encodeURIComponent(manageToken)}`
    : collectionToken
      ? `/api/collections/${encodeURIComponent(collectionToken)}`
      : manageToken
        ? `/api/collections/manage/${encodeURIComponent(manageToken)}`
        : ''
  if (!lookupUrl) return record
  try {
    const data = await apiRequest(lookupUrl)
    const refreshed = createCollectionRecord(data.collection, record.scope, {
      participantName: record.participantName,
      submittedAt: record.submittedAt,
    })
    refreshed.createdAt = record.createdAt || refreshed.createdAt
    refreshed.updatedAt = record.updatedAt || refreshed.updatedAt
    // 自己提交的文件只有本人的提交快照；管理视图的文件与提交数则以服务端为准。
    return record.scope === 'collect_from_me' ? mergeRecord(record, refreshed) : {
      ...mergeRecord(record, refreshed), files: refreshed.files, submissions: refreshed.submissions,
      fileCount: refreshed.fileCount, totalSize: refreshed.totalSize, submissionCount: refreshed.submissionCount,
    }
  } catch (error) {
    // 同步探测 404 = 资源已被物理删除，记录条目随之移除
    if (error.status === 404) return null
    return markRecordUnavailable(record, error.message)
  }
}

export function compactRecordFiles(files = []) {
  if (!Array.isArray(files)) return []
  return files.map((file, index) => ({
    name: String(file?.name || `文件 ${index + 1}`).trim(),
    relativePath: String(file?.relativePath || file?.webkitRelativePath || file?.name || `文件 ${index + 1}`).trim(),
    size: Number(file?.size || 0),
    mimeType: String(file?.mimeType || file?.type || file?.file?.type || '').trim(),
  })).filter((file) => file.name)
}

export function compactRecordSubmissions(submissions = []) {
  if (!Array.isArray(submissions)) return []
  return submissions.map((submission) => ({
    id: String(submission?.id || '').trim(),
    participantName: String(submission?.participantName || '').trim(),
    submitterUserId: String(submission?.submitterUserId || '').trim(),
    submitterName: String(submission?.submitterName || '').trim(),
    submittedAt: submission?.submittedAt || '',
    files: compactRecordFiles(submission?.files),
  })).filter((submission) => submission.id || submission.files.length)
}

let recordOwner = ''
export function setRecordOwner(userId = '') { recordOwner = String(userId || '') }
export function getRecordOwner() { return recordOwner }
function recordStorageKey(owner = recordOwner) {
  return owner ? `${RECORD_STORAGE_KEY}:account:${encodeURIComponent(owner)}` : RECORD_STORAGE_KEY
}

export function readRecords(owner = recordOwner) {
  try {
    return normalizeRecords(JSON.parse(window.localStorage.getItem(recordStorageKey(owner)) || '[]'))
  } catch {
    return []
  }
}

export function writeRecords(records, owner = recordOwner) {
  const next = normalizeRecords(records).slice(0, MAX_LOCAL_RECORDS)
  // 隐私模式 / 存储配额满时 setItem 会抛异常，不能让本地上报中断上传/分享主流程。
  try {
    window.localStorage.setItem(recordStorageKey(owner), JSON.stringify(next))
  } catch (error) {
    console.warn('本地记录保存失败（存储不可用）', error)
  }
  // 调用方（saveLocalRecord 等）依赖返回值更新 state，必须返回写入后的数组。
  return next
}

export function saveLocalRecord(record, currentRecords) {
  return writeRecords(upsertRecords(currentRecords || readRecords(), [record]))
}

export async function savePublicRecord(record) {
  try {
    const { user } = await apiRequest('/api/auth/me')
    saveLocalRecord(record)
    if (user?.id) await upsertCloudRecords([record])
  } catch (error) {
    if (error.status !== 401) console.warn('收发记录同步失败', error.message)
  }
}

export function saveAuthoritativeLocalRecord(record, currentRecords) {
  const normalized = normalizeRecord(record)
  const existing = normalizeRecords(currentRecords || readRecords()).filter((item) => item.id !== normalized.id)
  return writeRecords([normalized, ...existing])
}

export async function fetchCloudRecords() {
  const data = await apiRequest('/api/account/records')
  return normalizeRecords(data.records || [])
}

export async function replaceCloudRecords(records) {
  return apiRequest('/api/account/records', {
    method: 'PUT',
    body: JSON.stringify({ records: normalizeRecords(records) }),
  })
}

export async function upsertCloudRecords(records) {
  return apiRequest('/api/account/records', {
    method: 'POST',
    body: JSON.stringify({ records: normalizeRecords(records) }),
  })
}

export async function deleteCloudRecords(ids) {
  return apiRequest('/api/account/records', {
    method: 'DELETE',
    body: JSON.stringify({ ids }),
  })
}

export async function clearCloudRecords() {
  return apiRequest('/api/account/records', { method: 'DELETE', body: JSON.stringify({ all: true }) })
}

export async function fetchCloudMessages() {
  return apiRequest('/api/account/messages')
}

export async function markCloudMessageRead(id) {
  return apiRequest(`/api/account/messages/${encodeURIComponent(id)}`, { method: 'PATCH' })
}

export async function markAllCloudMessagesRead() {
  return apiRequest('/api/account/messages', { method: 'PATCH' })
}

export async function deleteCloudMessage(id) {
  // keepalive：用户点删除后立即刷新/关闭页面时，浏览器默认会取消飞行中的请求，
  // 服务端收不到 DELETE，刷新后消息「复活」。keepalive 保证请求送达（msg 体很小，无 64KB 限制风险）。
  return apiRequest(`/api/account/messages/${encodeURIComponent(id)}`, { method: 'DELETE', keepalive: true })
}

export async function deleteAllCloudMessages() {
  return apiRequest('/api/account/messages', { method: 'DELETE', keepalive: true })
}

export async function respondWorkspaceInvitation(invitationId, decision) {
  return apiRequest(`/api/account/workspace/invitations/${encodeURIComponent(invitationId)}`, {
    method: 'POST',
    body: JSON.stringify({ decision }),
  })
}

export async function respondWorkspaceOwnershipHandover(handoverId, decision) {
  return apiRequest(`/api/account/workspace/ownership-handovers/${encodeURIComponent(handoverId)}`, {
    method: 'POST', body: JSON.stringify({ decision }),
  })
}

export async function saveCloudNoticeSettings(settings) {
  return apiRequest('/api/account/notification-settings', {
    method: 'PUT',
    body: JSON.stringify({ settings: normalizeNoticeSettings(settings) }),
  })
}

export async function saveCloudFileCleanupSettings(settings) {
  const body = JSON.stringify({ settings: normalizeFileCleanupSettings(settings) })
  const request = method => apiRequest('/api/account/file-cleanup-settings', { method, body })
  try {
    return await request('PUT')
  } catch (error) {
    if (error.status === 404 || /接口不存在/.test(error.message || '')) return request('POST')
    throw error
  }
}

export async function requestAccountBindCode(target, type) {
  return apiRequest('/api/auth/code', {
    method: 'POST',
    body: JSON.stringify({ target, type, scene: 'bind' }),
  })
}

export async function bindAccountTarget(target, code, type) {
  return apiRequest('/api/account/bind', {
    method: 'POST',
    body: JSON.stringify({ target, code, type }),
  })
}

export function upsertRecords(currentRecords, incomingRecords) {
  const merged = new Map()
  normalizeRecords(currentRecords).forEach((record) => merged.set(record.id, record))
  incomingRecords.map(normalizeRecord).forEach((record) => {
    const existing = merged.get(record.id)
    merged.set(record.id, existing ? mergeRecord(existing, record) : record)
  })
  return Array.from(merged.values()).sort(compareRecords)
}

export function mergeRecord(existing, incoming) {
  const merged = { ...existing, ...incoming }
  merged.createdAt = existing.createdAt || incoming.createdAt
  merged.updatedAt = incoming.updatedAt || existing.updatedAt || new Date().toISOString()
  if (!incoming.shareId && existing.shareId) merged.shareId = existing.shareId
  if (!incoming.shareUrl && existing.shareUrl) merged.shareUrl = existing.shareUrl
  if (!incoming.manageToken && existing.manageToken) merged.manageToken = existing.manageToken
  if (!incoming.manageUrl && existing.manageUrl) merged.manageUrl = existing.manageUrl
  if (!incoming.alias && existing.alias) merged.alias = existing.alias
  if ((!incoming.name || incoming.name === '文件分享') && existing.name) merged.name = existing.name
  if (!incoming.meta && existing.meta) merged.meta = existing.meta
  if (!incoming.fileCount && existing.fileCount) merged.fileCount = existing.fileCount
  if (!incoming.totalSize && existing.totalSize) merged.totalSize = existing.totalSize
  if (!incoming.submissionCount && existing.submissionCount) merged.submissionCount = existing.submissionCount
  if ((!incoming.files || !incoming.files.length) && existing.files?.length) merged.files = existing.files
  if ((!incoming.submissions || !incoming.submissions.length) && existing.submissions?.length) merged.submissions = existing.submissions
  return merged
}

export function normalizeRecords(records) {
  if (!Array.isArray(records)) return []
  const deduped = new Map()
  records.map(normalizeRecord).filter(Boolean).forEach((record) => {
    const existing = deduped.get(record.id)
    deduped.set(record.id, existing ? mergeRecord(existing, record) : record)
  })
  return Array.from(deduped.values()).sort(compareRecords)
}

export function normalizeRecord(record = {}) {
  const now = new Date().toISOString()
  const scope = normalizeRecordScope(record.scope, record.type)
  const kind = record.kind || (scope === 'my_collections' || scope === 'collect_from_me' ? 'collection' : 'share')
  const files = compactRecordFiles(record.files)
  const submissions = compactRecordSubmissions(record.submissions)
  const submissionFiles = submissions.flatMap((submission) => submission.files || [])
  const allFiles = files.length ? files : submissionFiles
  const shareId = record.shareId || getShareToken(record.shareUrl)
  const manageToken = record.manageToken || getManageToken(record.manageUrl)
  const collectionToken = record.collectionToken || getCollectionToken(record.publicUrl || record.shareUrl)
  const manageUrl = normalizedManageUrl(kind, manageToken, record.manageUrl)
  const publicUrl = record.publicUrl || record.shareUrl || (collectionToken ? `${window.location.origin}/collect/${collectionToken}` : '')
  const stableToken = kind === 'share' ? (shareId || record.code) : (scope === 'my_collections' ? (manageToken || collectionToken) : (collectionToken || manageToken))
  const id = stableToken ? `${scope}:${kind}:${stableToken}` : (record.id || `${scope}:${kind}:${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const createdAt = record.createdAt || record.submittedAt || now
  const expiresAt = kind === 'share' ? (record.expiresAt || null) : null
  const deadline = kind === 'collection' ? (record.deadline || record.expiresAt || null) : null
  const normalized = {
    ...record,
    id,
    scope,
    kind,
    type: record.type || legacyTypeForScope(scope),
    name: record.name || (kind === 'collection' ? '收集任务' : '文件分享'),
    alias: record.alias || '',
    code: record.code || (kind === 'collection' ? (scope === 'collect_from_me' ? '提交入口' : '收集任务') : ''),
    shareId,
    manageToken,
    manageUrl,
    collectionToken,
    publicUrl,
    expiresAt,
    deadline,
    files,
    submissions,
    fileCount: Number(record.fileCount || allFiles.length || 0),
    totalSize: Number(record.totalSize || totalFileSize(allFiles) || 0),
    createdAt,
    updatedAt: record.updatedAt || record.lastSeenAt || createdAt,
  }
  normalized.status = normalizeRecordStatus(record.status, kind, scope) || recordDisplayStatus(normalized)
  normalized.meta = record.meta || recordDetail(normalized)
  return normalized
}

export function normalizeRecordScope(scope, type) {
  if (['my_sent', 'sent_to_me', 'my_collections', 'collect_from_me'].includes(scope)) return scope
  if (type === '发送') return 'my_sent'
  if (type === '收取' || type === '接收') return 'sent_to_me'
  if (type === '被收集' || type === '提交') return 'collect_from_me'
  if (type === '收集') return 'my_collections'
  return 'my_sent'
}

export function legacyTypeForScope(scope) {
  if (scope === 'my_sent') return '发送'
  if (scope === 'sent_to_me') return '收取'
  if (scope === 'collect_from_me') return '被收集'
  return '收集'
}

export function normalizeRecordStatus(status, kind, scope) {
  if (!status) return ''
  if (status === 'active') return kind === 'collection' ? (scope === 'collect_from_me' ? '可提交' : '进行中') : '有效'
  if (status === 'closed') return '已关闭'
  if (status === 'expired') return kind === 'collection' ? '已截止' : '已关闭'
  return status
}

export function normalizedManageUrl(kind, manageToken, currentUrl = '') {
  const parts = getUrlParts(currentUrl)
  const expectedRoot = kind === 'share' ? 'share' : 'collect'
  if (currentUrl && parts[0] === expectedRoot && parts[1] === 'manage') return currentUrl
  return manageToken ? `${window.location.origin}/${expectedRoot}/manage/${manageToken}` : ''
}

export function createShareManageForm(share = {}) {
  const limit = share.downloadLimit ? String(share.downloadLimit) : 'unlimited'
  return {
    downloadLimit: ['unlimited', '1', '10'].includes(limit) ? limit : 'custom',
    customDownloadLimit: share.downloadLimit ? String(share.downloadLimit) : '5',
    password: '',
    clearPassword: false,
  }
}

export function createCollectionManageForm(collection = {}) {
  return {
    title: collection.title || '',
    description: collection.description || '',
    deadline: toDateInputValue(collection.deadline),
    allowedTypes: Array.isArray(collection.allowedTypes) ? collection.allowedTypes : [],
    maxFileSizeMb: String(collection.maxFileSizeMb || 500),
    // 管理端可继续维护材料清单和字段；id 必须原样保留，已提交记录的 materialIds/fieldValues 都依赖它。
    materials: (Array.isArray(collection.materials) ? collection.materials : []).map((material) => ({
      id: material.id,
      name: material.name || '',
      required: Boolean(material.required),
      ...(material.namingPattern ? { namingPattern: material.namingPattern } : {}),
    })),
    customFields: (Array.isArray(collection.customFields) ? collection.customFields : []).map((field) => ({
      id: field.id,
      label: field.label || '',
      type: field.type || 'text',
      required: Boolean(field.required),
      ...(field.help ? { help: field.help } : {}),
      ...(field.type === 'select' && Array.isArray(field.options) ? { options: [...field.options] } : {}),
      ...(field.showWhen?.fieldId ? { showWhen: { ...field.showWhen } } : {}),
    })),
  }
}

export function toDateInputValue(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return formatDateInput(date)
}

export function shareStatusText(status) {
  if (status === 'closed' || status === 'expired') return '已关闭'
  return '有效'
}

export function collectionStatusText(status, deadline = null) {
  if (status === 'closed') return '已关闭'
  if (status === 'expired' || isPastDeadline(deadline)) return '已截止'
  return '进行中'
}

export function canReopenCollection(collection = {}) {
  return isClosedOrExpiredStatus(collection.status) && Boolean(collection.deadline && !isPastDeadline(collection.deadline))
}

export function createShareRecord(share, scope = 'my_sent') {
  const files = compactRecordFiles(share?.files)
  const totalSize = totalFileSize(files)
  const fileLabel = files.length ? `${files.length} 个文件` : '文件未解锁'
  const recipientLabel = share?.deliveryRecipients?.length ? ` · 通知 ${share.deliveryRecipients.length} 人` : ''
  const now = new Date().toISOString()
  return normalizeRecord({
    id: `${scope}:share:${share?.id || share?.code || Date.now()}`,
    scope,
    kind: 'share',
    type: scope === 'my_sent' ? '发送' : '收取',
    name: files[0]?.name || '文件分享',
    meta: `${fileLabel}${totalSize ? ` · ${formatBytes(totalSize)}` : ''}${recipientLabel} · ${recordAgeLabel(share?.createdAt)}`,
    code: share?.code || '',
    status: share?.status === 'closed' || share?.status === 'expired' ? '已关闭' : share?.status === 'active' || !share?.status ? '有效' : '已关闭',
    shareId: share?.id || '',
    shareUrl: share?.shareUrl || '',
    manageUrl: share?.manageUrl || '',
    manageToken: share?.manageToken || getManageToken(share?.manageUrl),
    expiresAt: share?.expiresAt || null,
    downloadLimit: share?.downloadLimit,
    downloadCount: share?.downloadCount,
    fileCount: files.length,
    totalSize,
    files,
    createdAt: scope === 'sent_to_me' ? now : share?.createdAt || now,
    updatedAt: now,
  })
}

export function createCollectionRecord(collection, scope = 'my_collections', extra = {}) {
  const now = new Date().toISOString()
  const submissionCount = Number(collection?.submissionCount ?? collection?.submissions?.length ?? extra.submissionCount ?? 0)
  const submissions = compactRecordSubmissions(collection?.submissions)
  const extraFiles = compactRecordFiles(extra.files)
  const files = extraFiles.length ? extraFiles : submissions.flatMap((submission) => submission.files || [])
  const totalSize = totalFileSize(files)
  const submittedAt = extra.submittedAt || collection?.submittedAt || ''
  const participantName = extra.participantName || collection?.participantName || ''
  const activityAt = scope === 'my_collections' ? collection?.createdAt || now : submittedAt || extra.createdAt || now
  const ownerMeta = `${submissionCount} 份提交 · ${recordAgeLabel(collection?.createdAt)}`
  const submitterMeta = submittedAt ? `${participantName || '我'} · 已提交 ${formatShortDate(submittedAt)}` : `${recordAgeLabel(activityAt)}打开 · 待提交`
  return normalizeRecord({
    id: `${scope}:collection:${scope === 'my_collections' ? (collection?.manageToken || collection?.id || collection?.token || Date.now()) : (collection?.token || collection?.id || Date.now())}`,
    scope,
    kind: 'collection',
    type: scope === 'my_collections' ? '收集' : '被收集',
    name: collection?.title || '收集任务',
    meta: scope === 'my_collections' ? ownerMeta : submitterMeta,
    code: scope === 'my_collections' ? '收集任务' : '提交入口',
    status: collection?.status === 'closed' ? '已关闭' : collection?.status === 'active' || !collection?.status ? (scope === 'my_collections' ? '进行中' : '可提交') : '已截止',
    publicUrl: collection?.publicUrl || collection?.shareUrl || '',
    shareUrl: collection?.publicUrl || collection?.shareUrl || '',
    manageUrl: collection?.manageUrl || '',
    manageToken: collection?.manageToken || getManageToken(collection?.manageUrl),
    collectionToken: collection?.token || getCollectionToken(collection?.publicUrl || collection?.shareUrl),
    deadline: collection?.deadline || null,
    allowedTypes: normalizeCollectionTypes(collection?.allowedTypes),
    maxFileSizeMb: collection?.maxFileSizeMb,
    submissionCount,
    fileCount: files.length,
    totalSize,
    files,
    submissions,
    participantName,
    submittedAt,
    createdAt: activityAt,
    updatedAt: now,
  })
}

export function compareRecords(a, b) {
  return new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime()
}

export function matchesRecordScope(record, scope) {
  return scope === 'all' || record.scope === scope
}

export function matchesRecordDate(record, dateFilter, dateFrom, dateTo) {
  if (dateFilter === 'all') return true
  const date = new Date(record.createdAt)
  if (Number.isNaN(date.getTime())) return false
  const today = startOfLocalDay(new Date())
  let from = null
  let to = null
  if (dateFilter === 'today') {
    from = today
    to = addLocalDays(today, 1)
  } else if (dateFilter === '7d') {
    from = addLocalDays(today, -6)
    to = addLocalDays(today, 1)
  } else if (dateFilter === '30d') {
    from = addLocalDays(today, -29)
    to = addLocalDays(today, 1)
  }
  if (dateFilter === 'range') {
    from = parseLocalDate(dateFrom)
    const endDate = parseLocalDate(dateTo)
    to = endDate ? addLocalDays(endDate, 1) : null
  }
  if (from && date < from) return false
  if (to && date >= to) return false
  return true
}

export function matchesRecordStatus(record, statusFilter) {
  const group = recordStatusGroup(record)
  return statusFilter === 'all' || group === statusFilter
}

export function isDateInputStillOpen(value) {
  const date = parseLocalDate(value)
  if (!date) return false
  return addLocalDays(date, 1).getTime() > Date.now()
}

export function formatDateInputDisplay(value) {
  const date = parseLocalDate(value)
  return date ? `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}` : value
}

export function recordStatusGroup(record) {
  if (isRecordExpired(record)) return 'expired'
  if (isRecordExpiringSoon(record)) return 'expiring'
  return 'active'
}

export function isRecordExpired(record) {
  if (isClosedStatus(record.status)) return true
  const deadline = record.expiresAt || record.deadline
  if (deadline) return isPastDeadline(deadline)
  return isExpiredStatus(record.status)
}

export function isRecordExpiringSoon(record) {
  const deadline = record.expiresAt || record.deadline
  if (!deadline) return isExpiringSoonStatus(record.status)
  const deadlineTime = new Date(deadline).getTime()
  const remaining = deadlineTime - Date.now()
  return Number.isFinite(deadlineTime) && remaining > 0 && remaining <= EXPIRING_SOON_MS
}

export function isClosedOrExpiredStatus(status) {
  return isClosedStatus(status) || isExpiredStatus(status)
}

export function recordDisplayStatus(record) {
  const group = recordStatusGroup(record)
  if (group === 'expired') {
    if (record.status === 'closed') return '已关闭'
    if (record.status === 'expired') return record.kind === 'collection' ? '已截止' : '已关闭'
    if (record.kind === 'share' && ['已失效', '已关闭', '已过期'].includes(record.status)) return '已关闭'
    if (['已失效', '已关闭', '已过期', '已截止', '无管理权限'].includes(record.status)) return record.status
    return record.kind === 'collection' ? '已截止' : '已过期'
  }
  if (group === 'expiring') return '即将过期'
  if (record.kind === 'collection') return record.scope === 'collect_from_me' ? (record.submittedAt ? '已提交' : '待提交') : '进行中'
  return '有效'
}

export function recordDetail(record) {
  if (record.kind === 'collection') {
    if (record.scope === 'collect_from_me') return record.submittedAt ? `${record.participantName || '我'} · 已提交 ${formatShortDate(record.submittedAt)}` : '待提交'
    return `${Number(record.submissionCount || 0)} 份提交 · ${recordAgeLabel(record.createdAt)}`
  }
  const size = Number(record.totalSize || 0)
  const count = Number(record.fileCount || 0)
  return `${count ? `${count} 个文件` : '文件分享'}${size ? ` · ${formatBytes(size)}` : ''} · ${recordAgeLabel(record.createdAt)}`
}

export function recordDisplayName(record) {
  return String(record.alias || record.name || (record.kind === 'collection' ? '收集任务' : '文件分享')).trim()
}

export function managedFileItemsFromRecords(records) {
  return normalizeRecords(records).map((record) => {
    const files = recordManagedFiles(record)
    const categories = managedFileCategories(record, files)
    const category = record.kind === 'collection' ? 'collection' : categories.length === 1 ? categories[0] : categories.length > 1 ? 'mixed' : 'other'
    const fileCount = Number(record.fileCount || files.length || (record.kind === 'collection' ? record.submissionCount : 1) || 1)
    const size = files.length ? totalFileSize(files) : Number(record.totalSize || 0)
    const participants = record.submissions?.map((submission) => submission.participantName).filter(Boolean) || []
    const fileNames = files.map((file) => `${file.name} ${file.relativePath || ''}`)
    return {
      id: `file-center:${record.id}`,
      record,
      name: recordDisplayName(record),
      category,
      categories,
      categoryLabel: fileCategoryLabel(category),
      formatLabel: fileFormatSummary(files, recordDisplayName(record)),
      fileCount,
      size,
      statusGroup: recordStatusGroup(record),
      expiringSoon: isRecordExpiringSoon(record),
      detail: managedFileDetail(record, fileCount, size),
      searchText: [
        recordDisplayName(record),
        record.name,
        record.alias,
        record.code,
        record.meta,
        record.participantName,
        recordScopeLabel(record.scope),
        fileFormatSummary(files, recordDisplayName(record)),
        ...participants,
        ...fileNames,
      ].filter(Boolean).join(' ').toLowerCase(),
    }
  })
}

export function recordManagedFiles(record) {
  const files = compactRecordFiles(record.files)
  if (files.length) return files
  return compactRecordSubmissions(record.submissions).flatMap((submission) => submission.files || [])
}

export function managedFileCategories(record, files) {
  if (record.kind === 'collection') return ['collection']
  const categories = Array.from(new Set(files.map(fileCategoryFromFile).filter(Boolean)))
  if (categories.length) return categories
  const fallbackCategory = fileCategoryFromFile({ name: recordDisplayName(record), mimeType: record.mimeType })
  return fallbackCategory ? [fallbackCategory] : ['other']
}

export function managedFileDetail(record, fileCount, size) {
  const sizeLabel = size ? ` · ${formatBytes(size)}` : ''
  const updatedLabel = ` · 更新 ${formatShortDate(record.updatedAt || record.createdAt)}`
  if (record.kind === 'collection') {
    if (record.scope === 'collect_from_me') return `${fileCount || 0} 个提交文件${sizeLabel}${updatedLabel}`
    return `${Number(record.submissionCount || 0)} 份提交 · ${fileCount || 0} 个文件${sizeLabel}${updatedLabel}`
  }
  const downloadLabel = record.downloadLimit ? ` · ${Number(record.downloadCount || 0)}/${record.downloadLimit} 次` : ''
  return `${fileCount || 1} 个文件${sizeLabel}${downloadLabel}${updatedLabel}`
}

export function fileCategoryFromFile(file = {}) {
  const mimeType = String(file.mimeType || '').toLowerCase()
  const extension = fileExtension(file.name || file.relativePath)
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  const matchedType = collectionTypeForExtension(extension)
  if (matchedType) return COLLECTION_TYPE_CATEGORY_KEYS[matchedType] || 'other'
  return 'other'
}

export function collectionTypeForExtension(extension) {
  return Object.entries(COLLECTION_TYPE_EXTENSIONS).find(([, extensions]) => extensions.includes(extension))?.[0] || ''
}

export function isAllowedCollectionFile(file = {}, allowedTypes = []) {
  const normalized = normalizeCollectionTypes(allowedTypes)
  if (normalized.includes('全部格式')) return true
  const type = collectionTypeForExtension(fileExtension(file.name || file.relativePath)) || '其他'
  return normalized.includes(type)
}

export function collectionFileAccept(allowedTypes = []) {
  const normalized = normalizeCollectionTypes(allowedTypes)
  if (normalized.includes('全部格式') || normalized.includes('其他')) return undefined
  const extensions = normalized.flatMap((type) => COLLECTION_TYPE_EXTENSIONS[type] || [])
  return extensions.length ? Array.from(new Set(extensions)).map((extension) => `.${extension}`).join(',') : undefined
}

export function fileCategoryLabel(category) {
  return FILE_CATEGORY_FILTERS.find(([value]) => value === category)?.[1] || '其他'
}

export function fileCategoryIcon(category) {
  if (category === 'image') return ImageIcon
  if (category === 'archive') return FileArchive
  if (category === 'document' || category === 'code') return FileText
  if (category === 'collection') return Inbox
  return FileCheck2
}

export function matchesManagedFileSearch(item, query) {
  const terms = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean)
  return !terms.length || terms.every((term) => item.searchText.includes(term))
}

export function matchesManagedFileCategory(item, category) {
  return category === 'all' || item.category === category || item.categories.includes(category)
}

export function recordIconForScope(scope) {
  if (scope === 'my_sent') return Send
  if (scope === 'sent_to_me') return Download
  if (scope === 'collect_from_me') return UploadCloud
  return Inbox
}

export function recordScopeLabel(scope) {
  return RECORD_SCOPE_TABS.find((tab) => tab.key === scope)?.label || '记录'
}

export function recordLink(record) {
  if (record.scope === 'my_collections') return recordManageUrl(record) || record.publicUrl || record.shareUrl
  return record.shareUrl || record.publicUrl || record.manageUrl
}

export function recordCopyTarget(record) {
  if (record.kind === 'share') return record.code || record.shareUrl
  if (record.scope === 'my_collections') return recordManageUrl(record) || record.publicUrl
  return record.publicUrl || record.shareUrl
}

export function recordManageUrl(record) {
  return normalizedManageUrl(record.kind, record.manageToken || getManageToken(record.manageUrl), record.manageUrl)
}

export function recordCopyLabel(record) {
  if (record.kind === 'share') return record.code ? '复制取件码' : '复制链接'
  return record.scope === 'my_collections' ? '复制管理链接' : '复制提交链接'
}

export function recordOpenLabel(record) {
  if (record.kind === 'share') return record.scope === 'my_sent' ? '打开分享链接' : '打开文件链接'
  if (record.scope === 'my_collections') return '查看已收文件'
  if (recordStatusGroup(record) === 'expired') return '查看任务'
  return record.submittedAt ? '再次提交' : '提交文件'
}

export function recordExpiryLabel(record) {
  const deadline = record.expiresAt || record.deadline
  if (!deadline) return record.kind === 'share' ? '永久有效' : '未设置截止'
  return `${record.kind === 'collection' ? '截止' : '到期'} ${formatShortDate(deadline)}`
}

// 「有效期」列的展示值：对齐原型（剩余 N 天 / MM-DD 截止 / MM-DD 过期 / 永久有效），
// 全部由真实 expiresAt / deadline + 当前时间算出，不引入原型里的演示状态。
export function recordValidityLabel(record) {
  const deadline = record.expiresAt || record.deadline
  if (!deadline) return record.kind === 'share' ? '永久有效' : '未设置截止'
  const time = new Date(deadline).getTime()
  if (!Number.isFinite(time)) return '—'
  const day = formatMonthDay(deadline)
  if (isRecordExpired(record)) return isClosedStatus(record.status) ? `${day} 关闭` : `${day} 过期`
  // 收集任务有明确截止：直接给日期，和原型 `10-30 截止` 一致。
  if (record.kind === 'collection') return `${day} 截止`
  const remaining = time - Date.now()
  // 先四舍五入到小时再换算天：`expiresAt = now + 2 天` 时剩余的毫秒已经略少于 48h，
  // 直接按天取整会显示成「剩余 1 天」。同理 23.5 小时会归到「剩余 1 天」而不是 24 小时。
  const hours = Math.max(1, Math.round(remaining / 3600000))
  if (hours < 24) return `剩余 ${hours} 小时`
  return `剩余 ${Math.round(hours / 24)} 天`
}

// 状态色调：只映射产品真实存在的状态，配色沿用原型 badge（ok/warn/blue/灰）。
export function recordStatusTone(record) {
  const group = recordStatusGroup(record)
  if (group === 'expired') return 'expired'
  if (group === 'expiring') return 'warn'
  const label = recordDisplayStatus(record)
  if (label === '已提交') return 'blue'
  if (label === '待提交') return 'warn'
  return 'ok'
}

function formatMonthDay(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function fileFormatLabel(file = {}, record = null) {
  const extension = fileExtension(file.name || file.relativePath || recordDisplayName(record || {}))
  if (extension) return extension.toUpperCase()
  const mimeType = String(file.mimeType || record?.mimeType || '').trim().toLowerCase()
  if (mimeType && mimeType !== 'application/octet-stream') return mimeType.split('/').pop().toUpperCase()
  return record?.kind === 'collection' ? '收集' : '无后缀'
}

export function fileFormatSummary(files = [], fallbackName = '') {
  const labels = Array.from(new Set((files.length ? files : [{ name: fallbackName }]).map((file) => fileFormatLabel(file)).filter(Boolean)))
  if (!labels.length) return '无后缀'
  if (labels.length <= 2) return labels.join(' / ')
  return '多格式'
}
