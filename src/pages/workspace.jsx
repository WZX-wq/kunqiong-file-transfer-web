import { collectionSizeOptions } from '../lib/plan-limits.js'
import { copyImageWithFeedback, copyTextWithFeedback } from '../lib/clipboard-feedback.js'
import { AuthButton } from '../components/account.jsx'
import React from 'react'
import { PrototypeAsset, PrototypeFileIcon } from '../components/prototype-asset.jsx'
import { SecurityCheckFailure, SecurityCheckStatus } from '../components/security-check-status.jsx'
import { defaultDeadline, formatBytes, formatDate, formatDateInput, formatDuration, formatExpiry, formatMessageTime } from '../lib/format.js'
import { COLLECTION_DESCRIPTION_MAX, COLLECTION_TITLE_MAX, COLLECTION_TYPE_OPTIONS, FOOTER_CONTENT, MAIN_VIEWS, MAX_FILES, RECORD_SCOPE_TABS, SETTINGS_NAV_ITEMS, defaultSettings } from '../lib/constants.js'
import { useEffect, useRef, useState } from 'react'
import { apiRequest, createShareFileDownloadConfig, createSubmissionFileDownloadConfig, createUploadSessionState, createUploadState } from '../lib/api.js'
import { useConfirmDialog, useDownloadTask, useToast } from '../hooks.js'
import { canReopenCollection, clearCloudRecords, collectionStatusText, createCollectionRecord, createShareRecord, deleteAllCloudMessages, deleteCloudMessage, deleteCloudRecords, fetchCloudMessages, fetchCloudRecords, getCollectionToken, getManageToken, isDateInputStillOpen, markAllCloudMessagesRead, markCloudMessageRead, normalizeCollectionTypes, normalizeMessages, normalizeNoticeSettings, normalizeRecord, normalizeRecords, readRecords, recordLink, recordManageUrl, replaceCloudRecords, respondWorkspaceInvitation, saveLocalRecord, syncRecords, toggleCollectionType, upsertCloudRecords, upsertRecords, writeRecords } from '../lib/records.js'
import { cancelUploadSession, canPreviewFile, clearUploadResume, createCollectionDownloadConfig, createShareDownloadConfig, createShareFilePreviewConfig, createSubmissionDownloadConfig, createSubmissionFilePreviewConfig, readUploadResume, uploadShareInChunks } from '../lib/transfer.js'
import { ArrowLeft, ArrowRight, Bell, Building2, CalendarDays, Check, ChevronRight, Clock3, CloudUpload, Copy, Download, Eraser, Eye, FileText, FolderOpen, Gauge, HelpCircle, History, Inbox, KeyRound, Link2, LockKeyhole, Mail, MailCheck, Megaphone, MessageCircle, Pause, Play, QrCode, RefreshCw, RotateCcw, Save, Send, Settings2, ShieldCheck, Sparkles, Trash2, UserCheck, UserPlus, UserRound, UserX, X } from 'lucide-react'
import { SettingsPage } from './settings.jsx'
import { RecordsView } from './records.jsx'
import { DistributionView } from './distribution.jsx'
import { CollectionLimitInfo, ContentModal, DatePicker, DownloadProgressPanel, FilePreviewModal, FileRow, ManageItemModal, QrPreviewModal, ValueItem } from '../components/ui.jsx'
import { ConfirmModal, ProductBrand, Toast } from '../components/common.jsx'
import { getRecordOwner } from '../lib/records.js'
import { RECIPIENT_TEXT_MAX, recipientInputError } from '../../server/lib/contact-input.js'
import { limitInputText } from '../lib/input-limits.js'
import { respondWorkspaceOwnershipHandover } from '../lib/records.js'
import { COLLECTION_FILENAME_PATTERN_MAX } from '../lib/collection-naming.js'

export const createDefaultCollectionForm = () => ({
  title: '',
  description: '',
  deadline: defaultDeadline(10),
  allowedTypes: ['全部格式'],
  maxFileSizeMb: 500,
      materials: [],
  customFields: [],
})

function newCollectionFormItemId(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`}`
}

export function normalizeMainView(value) {
  return MAIN_VIEWS.has(value) ? value : 'send'
}

export function mainViewUrl(view) {
  return view === 'send' ? '/' : `/?view=${encodeURIComponent(view)}`
}

function collectionManagePath(value) {
  const token = getManageToken(value)
  return token ? `/collect/manage/${encodeURIComponent(token)}` : ''
}

export function WorkspaceApp() {
  const [routePath, setRoutePath] = useState(() => window.location.pathname)
  const isSettingsRoute = routePath.startsWith('/settings')
  const inputRef = useRef(null)
  const folderInputRef = useRef(null)
  const uploadRef = useRef(createUploadSessionState())
  const uploadRunRef = useRef(0)
  const uploadCleanupRef = useRef(Promise.resolve())
  const recordSyncUserRef = useRef('')
  const { confirmState, requestConfirm, settleConfirm } = useConfirmDialog()
  const [activeView, setActiveView] = useState(() => normalizeMainView(new URLSearchParams(window.location.search).get('view')))
  const [files, setFiles] = useState([])
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadState, setUploadState] = useState(createUploadState())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [retrieveOpen, setRetrieveOpen] = useState(() => /^[A-Z0-9]{4,6}$/i.test(new URLSearchParams(window.location.search).get('retrieve') || ''))
  const [retrievalCode, setRetrievalCode] = useState(() => (new URLSearchParams(window.location.search).get('retrieve') || '').toUpperCase())
  const [retrieveResult, setRetrieveResult] = useState(null)
  const [shareResult, setShareResult] = useState(null)
  const [collectionResult, setCollectionResult] = useState(null)
  const [collectionManageData, setCollectionManageData] = useState(null)
  const [collectionManageLoading, setCollectionManageLoading] = useState(false)
  const [managementTarget, setManagementTarget] = useState(null)
  const { toast, notify: setToast } = useToast()
  const [settings, setSettings] = useState(defaultSettings)
  const [records, setRecords] = useState(() => readRecords())
  const [recordsSyncing, setRecordsSyncing] = useState(false)
  const [runtimeConfig, setRuntimeConfig] = useState(null)
  const uploadLimitBytes = runtimeConfig?.upload?.singleFileLimitBytes || 1.2 * 1024 ** 3
  const maxSupportedFileSizeBytes = runtimeConfig?.maxSupportedFileSizeBytes
  const batchLimit = runtimeConfig?.maxBatchFiles || MAX_FILES
  const [authUser, setAuthUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authMenuOpen, setAuthMenuOpen] = useState(false)
  const [messageOpen, setMessageOpen] = useState(() => new URLSearchParams(window.location.search).get('panel') === 'messages')
  const [messages, setMessages] = useState([])
  const handoverDecisionRef = useRef(false)
  const [handoverDecisionId, setHandoverDecisionId] = useState('')
  const [footerContentKey, setFooterContentKey] = useState('')
  // 未登录传输配额：enabled=true 时展示剩余额度；null 表示已登录或接口不可用。
  const [guestQuota, setGuestQuota] = useState(null)
  const [guestQuotaDialog, setGuestQuotaDialog] = useState(null)

  const changeMessagePanel = (open) => {
    setMessageOpen(open)
    const url = new URL(window.location.href)
    const wasOpen = url.searchParams.get('panel') === 'messages'
    if (open) url.searchParams.set('panel', 'messages')
    else url.searchParams.delete('panel')
    if (`${url.pathname}${url.search}${url.hash}` === `${window.location.pathname}${window.location.search}${window.location.hash}`) return
    const method = open && !wasOpen ? 'pushState' : 'replaceState'
    window.history[method](null, '', `${url.pathname}${url.search}${url.hash}`)
  }

  useEffect(() => {
    const syncRoute = () => {
      const nextPath = window.location.pathname
      setRoutePath(nextPath)
      setMessageOpen(new URLSearchParams(window.location.search).get('panel') === 'messages')
      if (!nextPath.startsWith('/settings')) {
        setActiveView(normalizeMainView(new URLSearchParams(window.location.search).get('view')))
      }
    }
    window.addEventListener('popstate', syncRoute)
    return () => window.removeEventListener('popstate', syncRoute)
  }, [])

  const refreshAuthUser = async () => {
    setAuthLoading(true)
    try {
      const data = await apiRequest('/api/auth/me')
      const user = data.user || null
      setAuthUser(user)
      return user
    } catch {
      setAuthUser(null)
      return null
    } finally {
      setAuthLoading(false)
    }
  }

  // 未登录时拉取游客传输配额（顺带让服务端签发游客 cookie），登录后清空。
  const refreshGuestQuota = () => apiRequest('/api/guest/quota')
    .then((data) => setGuestQuota(data?.enabled ? data : null))
    .catch(() => {})

  // 主动中止旧的上传会话：服务端会立即释放其预留额度。
  // 不中止的话，中途放弃的会话要等 TTL 过期才释放，期间会把游客配额占满。
  const abortUploadSession = (sessionId) => {
    if (!sessionId) return
    apiRequest(`/api/upload-sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }).catch(() => {})
  }

  // 释放名下全部未完成上传会话（横幅「释放占用」按钮）：立即归还预留额度。
  const releaseGuestUploads = () => {
    const pending = guestQuota?.pendingUploads || []
    for (const item of pending) abortUploadSession(item.id)
    if (pending.length) setTimeout(refreshGuestQuota, 400)
  }

  // 页面卸载（关闭标签页/刷新/跳转离开）时的会话处理：
  // - 已传字节为 0 的会话没有续传价值 → 立即 DELETE 释放预留额度；
  // - 有上传进度的会话保留（跨刷新续传依赖它），由服务端 TTL 清扫兜底。
  // fetch + keepalive 保证卸载过程中请求仍能发出。
  useEffect(() => {
    const releaseOnLeave = () => {
      const current = uploadRef.current
      if (!current?.sessionId || current.uploadedBytes > 0) return
      try {
        void fetch(`/api/upload-sessions/${encodeURIComponent(current.sessionId)}`, {
          method: 'DELETE',
          keepalive: true,
          credentials: 'include',
        })
      } catch { /* 卸载阶段尽力而为 */ }
    }
    window.addEventListener('pagehide', releaseOnLeave)
    window.addEventListener('beforeunload', releaseOnLeave)
    return () => {
      window.removeEventListener('pagehide', releaseOnLeave)
      window.removeEventListener('beforeunload', releaseOnLeave)
    }
  }, [])

  useEffect(() => {
    if (authUser?.id || authLoading) {
      setGuestQuota(null)
      return undefined
    }
    refreshGuestQuota()
  }, [authUser?.id, authLoading])

  const syncAccountRecords = async ({ silent = true } = {}) => {
    if (!authUser?.id) return readRecords()
    const owner = authUser.id
    setRecordsSyncing(true)
    try {
      const cloudRecords = await fetchCloudRecords()
      if (getRecordOwner() !== owner) return []
      const merged = writeRecords(upsertRecords(readRecords(owner), cloudRecords), owner)
      const refreshed = await syncRecords(merged)
      if (getRecordOwner() !== owner) return []
      const synced = writeRecords(refreshed, owner)
      setRecords(synced)
      const persisted = await replaceCloudRecords(synced)
      if (getRecordOwner() !== owner) return []
      const finalRecords = writeRecords(upsertRecords(synced, persisted.records || []), owner)
      setRecords(finalRecords)
      if (!silent) setToast('账号记录已同步')
      return finalRecords
    } catch (error) {
      if (!silent) setToast(`账号记录同步失败：${error.message}`)
      throw error
    } finally {
      setRecordsSyncing(false)
    }
  }

  const syncRecordMutation = (action) => {
    if (!authUser?.id) return
    action().catch((error) => setToast(`账号记录同步失败：${error.message}`))
  }

  const refreshMessages = async (user = authUser, { silent = true } = {}) => {
    if (!user?.id) {      setMessages([])
      return []
    }
    try {
      const data = await fetchCloudMessages()
      const nextMessages = normalizeMessages(data.messages || [])
      setMessages(nextMessages)
      if (data.settings) {
        setAuthUser((current) => current?.id === user.id ? { ...current, notificationSettings: normalizeNoticeSettings(data.settings) } : current)
      }
      return nextMessages
    } catch (error) {
      if (!silent) setToast(`消息同步失败：${error.message}`)
      return []
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const loginStatus = params.get('login')
    const loginMessage = params.get('message') || ''
    params.delete('retrieve')
    if (loginStatus) {
      params.delete('login')
      params.delete('message')
      const query = params.toString()
      window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`)
    }
    refreshAuthUser().then((user) => {
      if (loginStatus === 'success') {
        setToast(user ? '登录成功' : '登录回调完成，但会话未生效，请使用同一地址重新登录')
      } else if (loginStatus) {
        setToast(loginMessage || '登录失败')
      }
    })
    apiRequest('/api/runtime-config').then((config) => {
      setRuntimeConfig(config)
      const days = String(config.defaultShareDays || '')
      if (!['1', '3', '7'].includes(days)) return
      setSettings((current) => current.expiryDays === defaultSettings.expiryDays
        ? { ...current, expiry: `${days} 天`, expiryDays: days }
        : current)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    const refreshLimits = () => apiRequest('/api/runtime-config').then(config => { if (!cancelled) setRuntimeConfig(config) }).catch(() => {})
    refreshLimits()
    window.addEventListener('focus', refreshLimits)
    const timer = window.setInterval(refreshLimits, 30000)
    return () => { cancelled = true; window.removeEventListener('focus', refreshLimits); window.clearInterval(timer) }
  }, [authUser?.id])


  useEffect(() => {
    if (!authMenuOpen) return undefined
    const closeMenu = () => setAuthMenuOpen(false)
    window.addEventListener('click', closeMenu)
    return () => window.removeEventListener('click', closeMenu)
  }, [authMenuOpen])

  useEffect(() => {
    if (!authUser?.id) {
      setMessages([])
      recordSyncUserRef.current = ''
      setRecords(readRecords())
      return
    }
    refreshMessages(authUser).catch((error) => setToast(`消息同步失败：${error.message}`))
    if (recordSyncUserRef.current === authUser.id) return
    recordSyncUserRef.current = authUser.id
    syncAccountRecords({ silent: true }).catch((error) => setToast(`账号记录同步失败：${error.message}`))
  }, [authUser?.id])

  const cancelSendUpload = ({ discardSaved = false } = {}) => {
    uploadRunRef.current += 1
    const previous = uploadRef.current
    // Explicit remove/clear also abandons a saved session restored after refresh.
    if (discardSaved && !previous.sessionId) previous.sessionId = readUploadResume()?.sessionId || ''
    const cleanup = cancelUploadSession(previous)
    if (discardSaved) clearUploadResume()
    // A late create response must be discarded before the next batch reserves quota.
    uploadCleanupRef.current = Promise.allSettled([uploadCleanupRef.current, previous.task, cleanup])
    uploadRef.current = createUploadSessionState()
    setIsUploading(false)
    setUploadProgress(0)
    setUploadState(createUploadState())
  }

  const addFiles = (incoming) => {
    if (uploadState.status === 'finalizing' || uploadState.failurePhase === 'query') return
    const nextFiles = Array.from(incoming || []).map((file, index) => ({
      id: `${file.name}-${file.lastModified}-${index}-${Math.random()}`,
      file,
      name: file.name,
      size: file.size,
      relativePath: file.webkitRelativePath || file.name,
    }))
    if (!nextFiles.length) return
    const invalid = nextFiles.find((item) => item.size > uploadLimitBytes)
    if (invalid) {
      const limitMessage = invalid.size > maxSupportedFileSizeBytes
        ? `超过系统最高支持的单文件大小 ${formatBytes(maxSupportedFileSizeBytes)}`
        : authUser
          ? `超过当前账号单文件上限 ${formatBytes(uploadLimitBytes)}，请前往会员与团队查看更高上传额度`
          : `超过游客单文件上限 ${formatBytes(uploadLimitBytes)}，请登录后选择支持该文件大小的套餐`
      setToast(`${invalid.name} ${limitMessage}`)
      return
    }
    cancelSendUpload()
    setFiles((current) => {
      const merged = [...current, ...nextFiles]
      if (merged.length > batchLimit) setToast(`单次最多选择 ${batchLimit} 个文件，已保留前 ${batchLimit} 个`)
      return merged.slice(0, batchLimit)
    })
    setShareResult(null)
  }

  const removeFile = (id) => {
    if (uploadState.status === 'finalizing' || uploadState.failurePhase === 'query') return
    cancelSendUpload({ discardSaved: true })
    setFiles(current => current.filter(file => file.id !== id))
    setShareResult(null)
  }

  const uploadFiles = async ({ resume = false } = {}) => {
    if (uploadRef.current.running) return
    if (!files.length) {
      inputRef.current?.click()
      return
    }
    const recipientError = recipientInputError(settings.recipients, authUser)
    if (recipientError) {
      setToast(recipientError)
      return
    }
    if (!resume) cancelSendUpload()
    const run = ++uploadRunRef.current
    const session = uploadRef.current
    const isCurrent = () => uploadRunRef.current === run && uploadRef.current === session
    session.running = true
    session.paused = false
    setIsUploading(true)
    setShareResult(null)
    setUploadState(current => ({ ...current, status: 'uploading', phase: '准备上传', error: '' }))
    try {
      await uploadCleanupRef.current
      if (!isCurrent()) return
      // Query quota after cancellation releases the previous reservation; an existing
      // resumable session already owns its reservation and must not count it twice.
      if (!authUser?.id && !session.sessionId && !readUploadResume()) {
        const quota = await apiRequest('/api/guest/quota').catch(() => guestQuota)
        if (!isCurrent()) return
        setGuestQuota(quota?.enabled ? quota : null)
        const pendingBytes = files.reduce((sum, item) => sum + item.size, 0)
        if (quota?.enabled && quota.remainingBytes < pendingBytes) {
          setGuestQuotaDialog({ ...quota, incomingBytes: pendingBytes })
          setUploadState(createUploadState())
          return
        }
      }
      session.task = uploadShareInChunks(files, settings, uploadRef, ({ progress, ...nextState }) => {
        if (!isCurrent()) return
        setUploadProgress(progress)
        setUploadState((current) => ({ ...current, ...nextState, progress }))
      })
      const data = await session.task
      if (!isCurrent()) return
      setShareResult(data.share)
      setFiles([])
      uploadRef.current = createUploadSessionState()
      setUploadState(createUploadState())
      saveRecord(createShareRecord(data.share, 'my_sent'))
      if (authUser?.id) {
        refreshAuthUser().catch(() => {})
        refreshMessages(authUser).catch(() => {})
      }
      setToast(data.share.deliveryRecipients?.length ? '文件已上传，通知状态已更新' : '文件已上传，分享信息已生成')
      if (!authUser?.id) refreshGuestQuota()
    } catch (error) {
      if (!isCurrent() || error.name === 'UploadCancelledError') return
      if (error.name === 'UploadPausedError') {
        setUploadState((current) => ({ ...current, status: 'paused', phase: '已暂停，可继续上传', error: '' }))
        return
      }
      if (error.code === 'guest_quota_exceeded') {
        setGuestQuotaDialog(error.guestQuota || { incomingBytes: 0 })
        refreshGuestQuota()
      }
      if (error.restartUpload) {
        uploadRef.current = createUploadSessionState()
        setUploadProgress(0)
        setUploadState({ ...createUploadState(), status: 'failed', phase: '需要重新开始上传', error: error.message })
        setIsUploading(false)
        setToast(error.message)
        return
      }
      const scanFailure = String(error.code || '').startsWith('scan_')
      const threatDetected = error.code === 'scan_threat_detected'
      setUploadState((current) => ({ ...current, status: 'failed', phase: threatDetected ? '安全检查发现威胁，已阻止发布' : error.completionPending ? '上传完成，暂时无法查询处理结果' : scanFailure ? '上传完成，安全检查未通过' : '上传失败', failurePhase: threatDetected ? 'threat' : error.completionPending ? 'query' : scanFailure ? 'scan' : '', error: error.message, errorCode: error.code, scanFile: error.scanFile, scanFinding: error.scanFinding }))
      setToast(error.message)
    } finally {
      session.running = false
      if (uploadRunRef.current === run) setIsUploading(false)
    }
  }

  const pauseUpload = () => {
    uploadRef.current.paused = true
    uploadRef.current.abortCurrent?.()
  }

  const resetSend = () => {
    if (uploadState.status === 'finalizing' || uploadState.failurePhase === 'query') return
    cancelSendUpload({ discardSaved: true })
    setFiles([])
    setShareResult(null)
  }

  const startLogin = () => {
    const returnTo = `${window.location.origin}${window.location.pathname}${window.location.search}${window.location.hash}`
    window.location.href = `/api/auth/login?return_to=${encodeURIComponent(returnTo)}`
  }

  const logout = async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' })
      setAuthUser(null)
      setAuthMenuOpen(false)
      changeMessagePanel(false)
      setToast('已退出登录')
    } catch (error) {
      setToast(error.message)
    }
  }

  const navigateMainView = (view) => {
    const nextView = normalizeMainView(view)
    const nextUrl = mainViewUrl(nextView)
    if (isSettingsRoute) {
      window.history.pushState(null, '', nextUrl)
      setRoutePath('/')
      setActiveView(nextView)
      return
    }
    if (window.location.pathname !== '/' || `${window.location.pathname}${window.location.search}` !== nextUrl) {
      window.history.pushState(null, '', nextUrl)
    }
    setRoutePath('/')
    setActiveView(nextView)
  }

  const navigateSettingsSection = (path) => {
    setAuthMenuOpen(false)
    setMessageOpen(false)
    if (path !== routePath) window.history.pushState(null, '', path)
    setRoutePath(path)
  }

  const openSettings = () => {
    navigateSettingsSection('/settings/profile')
  }

  const saveProfile = async (profile) => {
    const data = await apiRequest('/api/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify(profile),
    })
    setAuthUser(data.user || null)
    setToast(profile.avatar === null || profile.avatar ? '头像已更新' : '个人资料已保存')
    return data.user
  }

  const markMessageRead = async (message) => {
    if (!authUser?.id || !message?.id) return
    setMessages((current) => current.map((item) => item.id === message.id ? { ...item, unread: false } : item))
    try {
      const data = await markCloudMessageRead(message.id)
      setMessages(normalizeMessages(data.messages || []))
    } catch (error) {
      setToast(`消息更新失败：${error.message}`)
      refreshMessages(authUser).catch(() => {})
    }
  }

  const markAllMessagesRead = async () => {
    if (!authUser?.id) return
    setMessages((current) => current.map((message) => ({ ...message, unread: false })))
    try {
      const data = await markAllCloudMessagesRead()
      setMessages(normalizeMessages(data.messages || []))
      setToast('全部消息已标为已读', 'success')
    } catch (error) {
      setToast(`消息更新失败：${error.message}`)
      refreshMessages(authUser).catch(() => {})
    }
  }

  const deleteMessage = async (message) => {
    if (!authUser?.id || !message?.id) return
    setMessages((current) => current.filter((item) => item.id !== message.id))
    try {
      const data = await deleteCloudMessage(message.id)
      setMessages(normalizeMessages(data.messages || []))
      setToast('消息已删除', 'success')
    } catch (error) {
      setToast(`消息删除失败：${error.message}`)
      refreshMessages(authUser).catch(() => {})
    }
  }

  const respondToWorkspaceInvitation = async (message, decision) => {
    if (!authUser?.id || !message?.actionId) return
    setMessages((current) => current.map((item) => item.id === message.id ? { ...item, unread: false, actionType: 'workspace_invite_resolved', body: decision === 'accept' ? '正在加入团队空间…' : '正在拒绝团队邀请…' } : item))
    try {
      const data = await respondWorkspaceInvitation(message.actionId, decision)
      setMessages(normalizeMessages(data.messages || []))
      if (decision === 'accept') await refreshAuthUser()
      setToast(decision === 'accept' ? '已接受团队邀请' : '已拒绝团队邀请')
    } catch (error) {
      setToast(`邀请处理失败：${error.message}`)
      refreshMessages(authUser).catch(() => {})
    }
  }

  const respondToOwnershipHandover = async (message, decision) => {
    if (!authUser?.id || !message?.actionId || handoverDecisionRef.current) return
    handoverDecisionRef.current = true
    try {
      const confirmed = await requestConfirm({
        eyebrow: '负责人交接', title: decision === 'accept' ? '接受团队负责人交接' : '拒绝团队负责人交接',
        detail: decision === 'accept' ? '接受后你成为该团队所有者，原所有者变为普通成员。团队套餐与容量保留，既有文件和任务归属不变。确认接受吗？' : '拒绝后本次交接结束，团队所有者和成员权限保持原样。',
        confirmText: decision === 'accept' ? '确认接受' : '确认拒绝', cancelText: '再想想', tone: 'danger',
      })
      if (!confirmed) return
      setHandoverDecisionId(message.actionId)
      const data = await respondWorkspaceOwnershipHandover(message.actionId, decision)
      setMessages(normalizeMessages(data.messages || []))
      await refreshAuthUser()
      setToast(decision === 'accept' ? '交接已完成，你现在是团队所有者' : '已拒绝负责人交接', 'success')
    } catch (error) {
      setToast(`交接处理失败：${error.message}`)
      await refreshMessages(authUser).catch(() => {})
    } finally { handoverDecisionRef.current = false; setHandoverDecisionId('') }
  }

  const clearAllMessages = async () => {
    if (!authUser?.id || !messages.length) return
    const confirmed = await requestConfirm({
      eyebrow: '消息管理',
      title: '清除全部消息',
      detail: '清除后，消息中心中的全部消息将被移除，且无法恢复。确定继续吗？',
      confirmText: '清除全部',
      tone: 'danger',
    })
    if (!confirmed) return
    setMessages([])
    try {
      const data = await deleteAllCloudMessages()
      setMessages(normalizeMessages(data.messages || []))
      setToast('全部消息已清除', 'success')
    } catch (error) {
      setToast(`消息清除失败：${error.message}`)
      refreshMessages(authUser).catch(() => {})
    }
  }

  const updateAccountUser = (user) => {
    setAuthUser(user || null)
    if (user?.id) refreshMessages(user).catch(() => {})
  }

  const saveRecord = (record) => {
    const normalized = normalizeRecord(record)
    const next = saveLocalRecord(normalized, readRecords())
    setRecords(next)
    syncRecordMutation(() => upsertCloudRecords([normalized]))
  }

  const replaceRecords = (updater, cloudOptions = {}) => {
    const current = readRecords()
    const next = writeRecords(typeof updater === 'function' ? updater(current) : updater)
    setRecords(next)
    if (cloudOptions.mode === 'delete') {
      syncRecordMutation(() => deleteCloudRecords(cloudOptions.ids || []))
    } else if (cloudOptions.mode === 'clear') {
      syncRecordMutation(() => clearCloudRecords())
    } else if (cloudOptions.mode !== 'local') {
      syncRecordMutation(() => replaceCloudRecords(next))
    }
    return next
  }

  const replaceRecordEntry = (record) => {
    const normalized = normalizeRecord(record)
    replaceRecords((current) => [normalized, ...normalizeRecords(current).filter((item) => item.id !== normalized.id)])
    return normalized
  }

  const createCollection = (form) => {
    const payload = { ...form, title: form.title.trim(), description: form.description.trim(), allowedTypes: normalizeCollectionTypes(form.allowedTypes) }
    if (!payload.title) {
      setToast('请填写任务名称')
      return
    }
    if (payload.title.length > COLLECTION_TITLE_MAX) {
      setToast(`任务名称不能超过 ${COLLECTION_TITLE_MAX} 个字，请精简后重试`)
      return
    }
    if (payload.description.length > COLLECTION_DESCRIPTION_MAX) {
      setToast(`收集说明不能超过 ${COLLECTION_DESCRIPTION_MAX} 个字，请精简后重试`)
      return
    }
    if (!payload.deadline) {
      setToast('请设置截止时间，不能为空')
      return
    }
    if (!isDateInputStillOpen(payload.deadline)) {
      setToast('截止时间不能早于今天，请重新选择')
      return
    }
    apiRequest('/api/collections', { method: 'POST', body: JSON.stringify(payload) })
      .then((data) => {
        const collection = { ...data.collection, manageToken: data.manageToken }
        setCollectionResult(collection)
        setCollectionManageData(null)
        saveRecord(createCollectionRecord(collection, 'my_collections'))
        if (authUser?.id) refreshAuthUser().catch(() => {})
        setToast('收集任务已创建')
      })
      .catch((error) => setToast(error.message))
  }

  const openCollectionManager = async (manageUrl) => {
    setCollectionManageLoading(true)
    try {
      let token = getManageToken(manageUrl)
      if (!token) {
        const collectionToken = getCollectionToken(manageUrl)
        if (collectionToken) {
          const publicData = await apiRequest(`/api/collections/${encodeURIComponent(collectionToken)}`)
          token = getManageToken(publicData.collection?.manageUrl)
        }
      }
      if (!token) {
        setToast('管理链接无效')
        return
      }
      window.location.href = `/collect/manage/${encodeURIComponent(token)}`
    } catch (error) {
      setToast(error.message)
    } finally {
      setCollectionManageLoading(false)
    }
  }

  const refreshCollectionManager = async () => {
    if (!collectionManageData?.manageToken) return
    try {
      const data = await apiRequest(`/api/collections/manage/${encodeURIComponent(collectionManageData.manageToken)}`)
      setCollectionManageData(data.collection)
      replaceRecordEntry(createCollectionRecord(data.collection, 'my_collections'))
      setToast('收集任务已刷新', 'success')
    } catch (error) { setToast(error.message || '刷新收集任务失败，请重试') }
  }

  const destroyCollection = async (target) => {
    const manageToken = target?.manageToken || getManageToken(target?.manageUrl)
    if (!manageToken) {
      setToast('这条收集任务没有可用的管理链接')
      return
    }
    const confirmed = await requestConfirm({
      title: '销毁收集任务',
      detail: '销毁后，收集链接和已提交文件都将失效。确定销毁本次任务吗？',
      confirmText: '销毁任务',
      tone: 'danger',
    })
    if (!confirmed) return
    try {
      await apiRequest(`/api/collections/manage/${encodeURIComponent(manageToken)}`, { method: 'DELETE' })
      replaceRecords((current) => current.filter((record) => {
        const normalized = normalizeRecord(record)
        return !(normalized.scope === 'my_collections' && normalized.manageToken === manageToken)
      }))
      setCollectionResult(null)
      setCollectionManageData(null)
      setToast('收集任务已销毁')
    } catch (error) {
      setToast(error.message)
    }
  }

  const openRecordManagement = async (record) => {
    const normalized = normalizeRecord(record)
    const manageToken = normalized.manageToken || getManageToken(normalized.manageUrl)
    if (!manageToken) {
      setToast(normalized.kind === 'share' ? '这条分享缺少管理链接，请重新生成分享' : '这条收集任务没有可用的管理链接')
      return
    }
    try {
      if (normalized.kind === 'share') {
        const data = await apiRequest(`/api/shares/manage/${encodeURIComponent(manageToken)}`)
        setManagementTarget({ kind: 'share', record: normalized, data: data.share })
        return
      }
      const data = await apiRequest(`/api/collections/manage/${encodeURIComponent(manageToken)}`)
      const record = replaceRecordEntry(createCollectionRecord(data.collection, 'my_collections'))
      setManagementTarget({ kind: 'collection', record, data: data.collection })
    } catch (error) {
      setToast(error.message)
    }
  }

  const saveManagedItem = async (target, payload) => {
    const token = target?.data?.manageToken || target?.record?.manageToken || getManageToken(target?.record?.manageUrl)
    if (!token) {
      setToast('管理链接不可用')
      return false
    }
    try {
      if (target.kind === 'share') {
        const data = await apiRequest(`/api/shares/manage/${encodeURIComponent(token)}`, { method: 'PATCH', body: JSON.stringify(payload) })
        const record = replaceRecordEntry(createShareRecord(data.share, 'my_sent'))
        setManagementTarget({ kind: 'share', record, data: data.share })
        setToast('分享设置已保存')
        return true
      }
      const data = await apiRequest(`/api/collections/manage/${encodeURIComponent(token)}`, { method: 'PATCH', body: JSON.stringify(payload) })
      const record = replaceRecordEntry(createCollectionRecord(data.collection, 'my_collections'))
      setCollectionManageData((current) => current?.manageToken === token ? data.collection : current)
      setManagementTarget({ kind: 'collection', record, data: data.collection })
      setToast('收集任务设置已保存')
      return true
    } catch (error) {
      setToast(error.message)
      return false
    }
  }

  const saveShareExpiry = async (record, payload) => {
    const normalized = normalizeRecord(record)
    const manageToken = normalized.manageToken || getManageToken(normalized.manageUrl)
    if (!manageToken) {
      setToast('管理链接不可用')
      return false
    }
    try {
      const data = await apiRequest(`/api/shares/manage/${encodeURIComponent(manageToken)}`, { method: 'PATCH', body: JSON.stringify(payload) })
      replaceRecordEntry(createShareRecord(data.share, 'my_sent'))
      setToast(data.share.status === 'active' ? '分享截至时间已更新' : '分享已关闭')
      return true
    } catch (error) {
      setToast(error.message)
      return false
    }
  }

  const closeManagedRecord = async (recordOrTarget) => {
    const target = recordOrTarget?.record || recordOrTarget
    const normalized = normalizeRecord(target)
    const manageToken = recordOrTarget?.data?.manageToken || normalized.manageToken || getManageToken(normalized.manageUrl)
    if (!manageToken) {
      setToast('管理链接不可用')
      return false
    }
    const isShare = normalized.kind === 'share'
    const message = isShare ? '关闭后下载链接和取件码会立即失效，确定关闭这个分享吗？' : '关闭后提交者将不能继续上传，已收文件仍可在管理页查看，确定关闭这个收集任务吗？'
    const confirmed = await requestConfirm({
      title: isShare ? '关闭分享链接' : '关闭收集任务',
      detail: message,
      confirmText: isShare ? '关闭分享' : '关闭收集',
      tone: 'danger',
    })
    if (!confirmed) return false
    try {
      if (isShare) {
        const data = await apiRequest(`/api/shares/manage/${encodeURIComponent(manageToken)}`, { method: 'DELETE' })
        const record = createShareRecord(data.share, 'my_sent')
        saveRecord(record)
        setManagementTarget((current) => current?.kind === 'share' && current.data.manageToken === manageToken ? { kind: 'share', record, data: data.share } : current)
        setToast('分享已关闭')
        return true
      }
      const data = await apiRequest(`/api/collections/manage/${encodeURIComponent(manageToken)}`, { method: 'PATCH', body: JSON.stringify({ status: 'closed' }) })
      const record = replaceRecordEntry(createCollectionRecord(data.collection, 'my_collections'))
      setCollectionManageData((current) => current?.manageToken === manageToken ? data.collection : current)
      setManagementTarget((current) => current?.kind === 'collection' && current.data.manageToken === manageToken ? { kind: 'collection', record, data: data.collection } : current)
      setToast('收集任务已关闭')
      return true
    } catch (error) {
      setToast(error.message)
      return false
    }
  }

  const reopenManagedRecord = async (recordOrTarget, patch = {}) => {
    const target = recordOrTarget?.record || recordOrTarget
    const normalized = normalizeRecord(target)
    const manageToken = recordOrTarget?.data?.manageToken || normalized.manageToken || getManageToken(normalized.manageUrl)
    if (!manageToken) {
      setToast('管理链接不可用')
      return false
    }
    try {
      if (normalized.kind === 'share') {
        const hasExpiry = Object.prototype.hasOwnProperty.call(patch || {}, 'expiresAt')
        const sharePatch = hasExpiry ? patch : { ...patch, expiresAt: defaultDeadline(7) }
        const data = await apiRequest(`/api/shares/manage/${encodeURIComponent(manageToken)}`, { method: 'PATCH', body: JSON.stringify({ ...sharePatch, status: 'active' }) })
        const record = replaceRecordEntry(createShareRecord(data.share, 'my_sent'))
        setManagementTarget((current) => current?.kind === 'share' && current.data.manageToken === manageToken ? { kind: 'share', record, data: data.share } : current)
        setToast('分享已重新开启')
        return true
      }
      const data = await apiRequest(`/api/collections/manage/${encodeURIComponent(manageToken)}`, { method: 'PATCH', body: JSON.stringify({ ...patch, status: 'active' }) })
      const record = replaceRecordEntry(createCollectionRecord(data.collection, 'my_collections'))
      setCollectionManageData((current) => current?.manageToken === manageToken ? data.collection : current)
      setManagementTarget((current) => current?.kind === 'collection' && current.data.manageToken === manageToken ? { kind: 'collection', record, data: data.collection } : current)
      setToast('收集任务已重新开启')
      return true
    } catch (error) {
      setToast(error.message)
      return false
    }
  }

  const deleteCollectionSubmission = async (collection, submissionId) => {
    const manageToken = collection?.manageToken
    if (!manageToken || !submissionId) return false
    const confirmed = await requestConfirm({
      title: '删除提交记录',
      detail: '删除后该提交记录和文件会从本机服务中移除。确定删除吗？',
      confirmText: '删除提交',
      tone: 'danger',
    })
    if (!confirmed) return false
    try {
      const data = await apiRequest(`/api/collections/manage/${encodeURIComponent(manageToken)}/submissions/${encodeURIComponent(submissionId)}`, { method: 'DELETE' })
      const record = replaceRecordEntry(createCollectionRecord(data.collection, 'my_collections'))
      setCollectionManageData(data.collection)
      setManagementTarget((current) => current?.kind === 'collection' && current.data.manageToken === manageToken ? { kind: 'collection', record, data: data.collection } : current)
      setToast('提交记录已删除')
      return true
    } catch (error) {
      setToast(error.message)
      return false
    }
  }

  const lookupShare = async (resolvedData) => {
    if (resolvedData?.share) {
      setRetrieveResult(resolvedData)
      saveRecord(createShareRecord(resolvedData.share, 'sent_to_me'))
      return
    }
    const code = retrievalCode.trim().toUpperCase()
    if (!code) {
      setToast('请输入取件码')
      return
    }
    const data = await apiRequest(`/api/shares/lookup/${encodeURIComponent(code)}`)
    setRetrieveResult(data)
    saveRecord(createShareRecord(data.share, 'sent_to_me'))
  }

  const closeRetrieve = () => {
    setRetrieveOpen(false)
    setRetrieveResult(null)
    setRetrievalCode('')
  }

  const copyValue = (value) => copyTextWithFeedback(value, setToast)
  const copyQrImage = (dataUrl, fallbackText) => copyImageWithFeedback(dataUrl, fallbackText, setToast)

  const deleteRecord = (recordIds) => {
    const targets = new Set(Array.isArray(recordIds) ? recordIds : [recordIds])
    replaceRecords((current) => current.filter((record) => !targets.has(normalizeRecord(record).id)), { mode: 'delete', ids: Array.from(targets) })
    setToast(targets.size > 1 ? `已删除 ${targets.size} 条记录` : '记录已删除')
  }

  const recordScopeLabel = (scopeKey) => {
    const tab = RECORD_SCOPE_TABS.find((item) => item.key === scopeKey)
    return tab ? tab.label : '全部'
  }

  const clearRecords = (scopeKey) => {
    if (scopeKey && scopeKey !== 'all') {
      const ids = records.map(normalizeRecord).filter((record) => record.scope === scopeKey).map((record) => record.id)
      if (!ids.length) return
      replaceRecords((current) => current.filter((record) => !ids.includes(normalizeRecord(record).id)), { mode: 'delete', ids })
      setToast(`已清空「${recordScopeLabel(scopeKey)}」记录`)
      return
    }
    replaceRecords([], { mode: 'clear' })
    setToast(authUser?.id ? '账号记录已清空' : '本机记录已清空')
  }

  const clearRecordsWithConfirm = async (scopeKey) => {
    const scope = typeof scopeKey === 'string' ? scopeKey : 'all'
    if (scope !== 'all') {
      const count = records.map(normalizeRecord).filter((record) => record.scope === scope).length
      if (!count) return
      const label = recordScopeLabel(scope)
      const scopeConfirmed = await requestConfirm({
        title: `清空「${label}」记录`,
        detail: authUser?.id
          ? `将清空当前账号「${label}」分类下的 ${count} 条收发记录，其他分类不受影响；其中已关闭/过期的分享与收集任务及其文件会一并删除，仍在有效期的资源不受影响。确定继续吗？`
          : `将清空当前设备「${label}」分类下的 ${count} 条收发记录，其他分类不受影响；其中已关闭/过期的分享与收集任务及其文件会一并删除，仍在有效期的资源不受影响。确定继续吗？`,
        confirmText: `清空「${label}」`,
        tone: 'danger',
      })
      if (!scopeConfirmed) return
      clearRecords(scope)
      return
    }
    const confirmed = await requestConfirm({
      title: '清空全部记录',
      detail: authUser?.id
        ? '将清空当前账号同步的全部收发记录；其中已关闭/过期的分享与收集任务及其文件会一并删除，仍在有效期的资源不受影响。确定继续吗？'
        : '将清空当前设备保存的全部收发记录；其中已关闭/过期的分享与收集任务及其文件会一并删除，仍在有效期的资源不受影响。确定继续吗？',
      confirmText: '清空全部',
      tone: 'danger',
    })
    if (!confirmed) return
    clearRecords()
  }

  const renameRecord = async (recordOrId, nextName) => {
    const alias = String(nextName || '').trim()
    if (!alias) {
      setToast('显示名称不能为空')
      return
    }
    const targetRecord = typeof recordOrId === 'object'
      ? normalizeRecord(recordOrId)
      : records.map(normalizeRecord).find((record) => record.id === recordOrId)
    const manageToken = targetRecord?.manageToken || getManageToken(targetRecord?.manageUrl)
    if (targetRecord?.kind === 'collection' && targetRecord.scope === 'my_collections' && manageToken) {
      try {
        const data = await apiRequest(`/api/collections/manage/${encodeURIComponent(manageToken)}`, {
          method: 'PATCH',
          body: JSON.stringify({ title: alias }),
        })
        const record = replaceRecordEntry(createCollectionRecord(data.collection, 'my_collections'))
        setCollectionManageData((current) => current?.manageToken === manageToken ? data.collection : current)
        setManagementTarget((current) => current?.kind === 'collection' && current.data.manageToken === manageToken ? { kind: 'collection', record, data: data.collection } : current)
        setToast('收集任务名称已更新')
        return
      } catch (error) {
        setToast(error.message || '收集任务名称更新失败')
        return
      }
    }
    replaceRecords((current) => current.map((record) => {
      const normalized = normalizeRecord(record)
      return normalized.id === (targetRecord?.id || recordOrId) ? { ...normalized, alias, updatedAt: new Date().toISOString() } : normalized
    }))
    setToast('显示名称已更新')
  }

  const refreshRecords = async ({ silent = false } = {}) => {
    const owner = authUser?.id || ''
    setRecordsSyncing(Boolean(authUser?.id))
    try {
      let baseRecords = readRecords(owner)
      if (authUser?.id) {
        const cloudRecords = await fetchCloudRecords()
        if (getRecordOwner() !== owner) return
        baseRecords = writeRecords(upsertRecords(baseRecords, cloudRecords), owner)
      }
      const refreshed = await syncRecords(baseRecords)
      if (getRecordOwner() !== owner) return
      const nextRecords = writeRecords(refreshed, owner)
      setRecords(nextRecords)
      if (authUser?.id) await replaceCloudRecords(nextRecords)
      if (!silent) setToast(authUser?.id ? '收发记录已刷新并同步' : '收发记录已刷新')
    } catch (error) {
      if (!silent) setToast(error.message || '刷新失败')
    } finally {
      setRecordsSyncing(false)
    }
  }

  const openRecordLink = (record) => {
    const normalized = normalizeRecord(record)
    const url = recordLink(normalized)
    if (!url) {
      setToast('这条记录没有可打开的链接')
      return
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <ProductBrand />
        <nav className="main-nav" aria-label="主导航">
          <NavItem icon={Send} label="发文件" active={!isSettingsRoute && activeView === 'send'} onClick={() => navigateMainView('send')} />
          <NavItem icon={Inbox} label="收集文件" active={!isSettingsRoute && activeView === 'collect'} onClick={() => navigateMainView('collect')} />
          <NavItem icon={History} label="收发记录" active={!isSettingsRoute && activeView === 'records'} onClick={() => navigateMainView('records')} />
          <NavItem icon={Building2} label="会员与团队" active={false} onClick={() => { window.location.href = '/workspace' }} />
        </nav>
        <div className="topbar-actions">
          <MessageCenter user={authUser} messages={messages} open={messageOpen} onToggle={(event) => { event.stopPropagation(); setAuthMenuOpen(false); changeMessagePanel(!messageOpen) }} onClose={() => changeMessagePanel(false)} onMarkRead={markMessageRead} onMarkAllRead={markAllMessagesRead} onDelete={deleteMessage} onClearAll={clearAllMessages} onLogin={startLogin} onInvitationAction={respondToWorkspaceInvitation} onHandoverAction={respondToOwnershipHandover} handoverDecisionId={handoverDecisionId} onNotify={setToast} />
          {/* 后台入口不再按账号身份显示（白名单通道已移除，后台只认账号口令）。
              需要直接进后台时访问 /admin，未登录会弹出管理员账号密码弹窗。 */}
          <AuthButton user={authUser} loading={authLoading} menuOpen={authMenuOpen} onLogin={startLogin} onToggleMenu={(event) => { event.stopPropagation(); changeMessagePanel(false); setAuthMenuOpen((current) => !current) }} onSettings={openSettings} onOrders={() => navigateSettingsSection('/settings/orders')} onLogout={logout} />
        </div>
      </header>

      <main className={`page-content${!isSettingsRoute && activeView === 'send' ? ' send-content' : !isSettingsRoute && activeView === 'collect' ? ' collect-content' : !isSettingsRoute && activeView === 'records' ? ' records-content' : ''}`}>
        {isSettingsRoute && <SettingsPage user={authUser} loading={authLoading} section={settingsSectionForPath(routePath)} onLogin={startLogin} onLogout={logout} onBack={() => navigateMainView('send')} onSaveProfile={saveProfile} onUpdateUser={updateAccountUser} onNavigateSection={navigateSettingsSection} onOpenWorkspace={() => { window.location.href = '/workspace' }} />}
        {!isSettingsRoute && activeView === 'send' && (
          <SendView
            maxSupportedFileSizeBytes={maxSupportedFileSizeBytes}
            batchLimit={batchLimit}
            user={authUser}
            files={files}
            inputRef={inputRef}
            folderInputRef={folderInputRef}
            isDragging={isDragging}
            setIsDragging={setIsDragging}
            addFiles={addFiles}
            removeFile={removeFile}
            uploadFiles={uploadFiles}
            isUploading={isUploading}
            uploadProgress={uploadProgress}
            uploadState={uploadState}
            shareResult={shareResult}
            settings={settings}
            onUpdateSettings={(patch) => setSettings((current) => ({ ...current, ...patch }))}
            onSettings={() => setSettingsOpen(true)}
            onPause={pauseUpload}
            onResume={() => uploadFiles({ resume: true })}
            onRetry={() => uploadFiles({ resume: true })}
            onReset={resetSend}
            onCopy={copyValue}
            onCopyQrImage={copyQrImage}
            onRetrieve={(code) => { if (code) setRetrievalCode(String(code).toUpperCase()); setRetrieveOpen(true) }}
            onOpenDistribution={() => navigateMainView('deliver')}
            guestQuota={guestQuota}
            onLogin={startLogin}
          />
        )}
        {!isSettingsRoute && activeView === 'collect' && (
          <CollectView
            entitlement={runtimeConfig?.upload}
            result={collectionResult}
            manageData={collectionManageData}
            manageLoading={collectionManageLoading}
            records={records}
            onCreate={createCollection}
            onResetResult={() => setCollectionResult(null)}
            onRetrieve={() => setRetrieveOpen(true)}
            onCopy={copyValue}
            onCopyQrImage={copyQrImage}
            onOpenManager={openCollectionManager}
            onManageSettings={(data) => setManagementTarget({ kind: 'collection', record: createCollectionRecord(data, 'my_collections'), data })}
            onCloseTask={(data) => closeManagedRecord({ kind: 'collection', record: createCollectionRecord(data, 'my_collections'), data })}
            onReopenTask={(data) => reopenManagedRecord({ kind: 'collection', record: createCollectionRecord(data, 'my_collections'), data })}
            onDeleteSubmission={deleteCollectionSubmission}
            onCloseManager={() => setCollectionManageData(null)}
            onRefreshManager={refreshCollectionManager}
            onRefreshRecords={refreshRecords}
          />
        )}
        {!isSettingsRoute && activeView === 'deliver' && <DistributionView user={authUser} onLogin={startLogin} onNotify={setToast} />}
        {!isSettingsRoute && activeView === 'records' && <RecordsView records={records} user={authUser} syncing={recordsSyncing} onCopy={copyValue} onCopyQrImage={copyQrImage} onDelete={deleteRecord} onRename={renameRecord} onClear={clearRecordsWithConfirm} onRefresh={refreshRecords} onOpen={openRecordLink} onOpenCollectionManager={openCollectionManager} onUpload={() => navigateMainView('send')} onManage={openRecordManagement} onCloseManaged={closeManagedRecord} onReopenManaged={reopenManagedRecord} onSaveShareExpiry={saveShareExpiry} onNotify={setToast} />}
      </main>

      <footer className="page-footer">
        <span>鲲穹文件传输 · 临时传输，轻装上阵</span>
        <div><a className="footer-manual-link" href="/user-manual.html" target="_blank" rel="noopener noreferrer">使用手册</a><button onClick={() => setFooterContentKey('help')}><HelpCircle size={13} /> 帮助中心</button><button onClick={() => setFooterContentKey('terms')}><ShieldCheck size={13} /> 服务协议</button><button onClick={() => setFooterContentKey('privacy')}><LockKeyhole size={13} /> 隐私政策</button><a className="footer-manual-link" href="https://www.kunqiongai.com/feedback/" target="_blank" rel="noopener noreferrer"><MessageCircle size={13} /> 问题反馈</a></div>
      </footer>

      {settingsOpen && <SettingsModal settings={settings} setSettings={setSettings} user={authUser} onClose={() => setSettingsOpen(false)} onSave={() => { setSettingsOpen(false); setToast('分享设置已保存') }} />}
      {retrieveOpen && <RetrieveModal code={retrievalCode} setCode={setRetrievalCode} result={retrieveResult} onClose={closeRetrieve} onFind={lookupShare} />}
      {footerContentKey && <ContentModal content={FOOTER_CONTENT[footerContentKey]} onClose={() => setFooterContentKey('')} />}
      {managementTarget && (
        <ManageItemModal
          key={`${managementTarget.kind}-${managementTarget.data?.manageToken || managementTarget.record?.id || 'target'}`}
          target={managementTarget}
          onClose={() => setManagementTarget(null)}
          onSave={(payload) => saveManagedItem(managementTarget, payload)}
          onCloseTask={async () => {
            const closed = await closeManagedRecord(managementTarget)
            if (closed) setManagementTarget(null)
            return closed
          }}
          onReopenTask={(payload) => reopenManagedRecord(managementTarget, payload)}
        />
      )}
      <ConfirmModal state={confirmState} onCancel={() => settleConfirm(false)} onConfirm={() => settleConfirm(true)} />
      {guestQuotaDialog && <GuestQuotaModal quota={guestQuotaDialog} onClose={() => setGuestQuotaDialog(null)} onLogin={startLogin} />}
      {toast && <Toast {...toast} />}
    </div>
  )
}

export function GuestQuotaModal({ quota, onClose, onLogin }) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="modal-backdrop confirm-backdrop" onMouseDown={onClose}>
      <div className="modal confirm-modal guest-quota-modal" role="dialog" aria-modal="true" aria-labelledby="guest-quota-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="confirm-modal-icon"><Gauge size={20} /></div>
        <p className="eyebrow">未登录传输额度</p>
        <h2 id="guest-quota-title">免登录传输额度已用完</h2>
        <p className="guest-quota-detail">
          免登录传输按设备累计上限 <strong>{formatBytes(quota.limitBytes)}</strong>
          {quota.usedBytes ? <>，本设备已用 <strong>{formatBytes(quota.usedBytes)}</strong></> : null}
          {quota.incomingBytes ? <>，本次还需传输 <strong>{formatBytes(quota.incomingBytes)}</strong></> : null}。
          免费注册后即可获得 <strong>20 GB</strong> 个人空间，上传与分享不再受此限制。
        </p>
        <div className="modal-footer confirm-modal-footer">
          <button className="secondary-button" onClick={onClose}>知道了</button>
          <button className="primary-button" onClick={onLogin}><UserPlus size={15} /> 免费注册 / 登录</button>
        </div>
      </div>
    </div>
  )
}

export function SendView({ maxSupportedFileSizeBytes, batchLimit = MAX_FILES, user, files, inputRef, folderInputRef, isDragging, setIsDragging, addFiles, removeFile, uploadFiles, isUploading, uploadProgress, uploadState, shareResult, settings, onUpdateSettings, onSettings, onPause, onResume, onRetry, onReset, onCopy, onCopyQrImage, onRetrieve, onOpenDistribution, guestQuota, onLogin }) {
  const [retrieveCode, setRetrieveCode] = useState('')
  const showUploadStatus = ['uploading', 'paused', 'failed', 'finalizing'].includes(uploadState.status)
  const recipientError = recipientInputError(settings.recipients, user)
  // 队列顺序与 uploadShareInChunks 的 files 顺序一致且串行处理，因此当前文件名
  // 可以反推出「哪些已完成 / 正在传 / 等待中」；拿不到当前文件时不猜，统一显示等待。
  const currentFileIndex = uploadState.currentFile ? files.findIndex((file) => file.name === uploadState.currentFile) : -1
  const completedFileCount = uploadState.status === 'finalizing' ? files.length : Math.max(0, currentFileIndex)
  const waitingFileCount = Math.max(files.length - completedFileCount - (uploadState.status === 'uploading' || uploadState.status === 'paused' ? 1 : 0), 0)
  const queueStatusText = uploadState.status === 'paused' ? `已暂停 · ${completedFileCount} 个已完成`
    : uploadState.status === 'failed' ? `上传已中断 · ${completedFileCount} 个已完成`
      : uploadState.status === 'finalizing' ? `安全检查中 · ${files.length} 个已上传`
        : `1 个上传中 · ${completedFileCount} 个已完成${waitingFileCount ? ` · ${waitingFileCount} 个等待中` : ''}`
  const canRemoveDuringUpload = uploadState.status !== 'finalizing' && uploadState.failurePhase !== 'query'
  return (
    <div className="send-prototype-page">
      <div className={`send-prototype-inner${showUploadStatus ? ' send-uploading-inner' : ''}`}>
        {!files.length && !shareResult ? (
          <>
            <section className="send-prototype-hero">
              <div className="send-prototype-hero-copy">
                <span className="send-prototype-pill"><i />临时传输 · 上传即分享</span>
                <h1>轻松发送<em>大文件</em></h1>
                <p>支持多种文件格式，安全快速，随时随地分享</p>
                <div className="send-prototype-stats">
                  <div><b>{maxSupportedFileSizeBytes ? formatBytes(maxSupportedFileSizeBytes) : '—'}</b><span>单文件最高支持</span></div>
                  <div><b>{batchLimit} 个</b><span>单次文件数</span></div>
                  <div><b>{settings.expiry || '3 天'}</b><span>默认有效期</span></div>
                </div>
              </div>
              <div className="send-prototype-hero-art"><PrototypeAsset name="hero.png" width={400} height={300} alt="" /></div>
            </section>

            <section className={`upload-panel send-prototype-drop-card ${isDragging ? 'dragging' : ''}`}>
              <input ref={inputRef} type="file" multiple hidden onChange={(event) => { addFiles(event.target.files); event.target.value = '' }} />
              <input ref={folderInputRef} type="file" multiple webkitdirectory="" directory="" hidden onChange={(event) => { addFiles(event.target.files); event.target.value = '' }} />
              <div className="send-prototype-upload-head">
                <div className="send-prototype-upload-head-spacer" aria-hidden="true" />
                {guestQuota?.enabled ? <div className="send-prototype-guest-strip"><span><Gauge size={15} />游客模式 · 本次剩余 <b>{formatBytes(guestQuota.remainingBytes)}</b></span><button type="button" onClick={onLogin}>登录后同步记录与额度 <ChevronRight size={14} /></button></div> : <div />}
                <button type="button" className="send-distribution-entry" onClick={onOpenDistribution}><Send size={15} />批量定向发布<ArrowRight size={14} /></button>
              </div>
              <div className={`send-prototype-dropzone ${isDragging ? 'dragging' : ''}`} onDragEnter={(event) => { event.preventDefault(); setIsDragging(true) }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (event.currentTarget === event.target) setIsDragging(false) }} onDrop={(event) => { event.preventDefault(); setIsDragging(false); addFiles(event.dataTransfer.files) }}>
                <PrototypeAsset className="send-prototype-cloud" name="ico-cloud.png" width={64} height={54} />
                <h2>{isDragging ? '松开即可添加文件' : '拖拽文件或文件夹到这里'}</h2>
                <p className="send-prototype-drop-copy">支持 PDF / Office / 图片 / 视频 / 压缩包，自动分片上传，中断可续传</p>
                <div className="send-prototype-actions">
                  <button className="primary-button" type="button" onClick={() => inputRef.current?.click()}><FolderOpen size={17} />选择文件</button>
                  <button className="secondary-button" type="button" onClick={() => folderInputRef.current?.click()}><FolderOpen size={16} />选择文件夹</button>
                </div>
                <div className="send-prototype-retrieve">
                  <span><KeyRound size={14} />或通过取件码获取文件</span>
                  <form onSubmit={(event) => { event.preventDefault(); onRetrieve(retrieveCode.trim()) }}>
                    <input aria-label="取件码" inputMode="text" autoComplete="off" maxLength={6} value={retrieveCode} onChange={(event) => setRetrieveCode(event.target.value.replace(/[^a-z\d]/gi, '').toUpperCase())} placeholder="请输入 4–6 位取件码" />
                    <button className="primary-button" type="submit" disabled={retrieveCode.trim().length < 4}>查询</button>
                  </form>
                  <small>取件码可在分享链接或发送记录中找到</small>
                </div>
                <span className="upload-note">上传后自动生成链接、二维码和取件码</span>
              </div>
            </section>

            <section className="value-strip send-prototype-values">
              <ValueItem image="ico-bolt.png" title="高速传输" detail="分片并发，跑满带宽" />
              <ValueItem image="ico-shield.png" title="安全可靠" detail="传输加密 + 病毒检测" />
              <ValueItem image="act-share.png" title="多端可用" detail="电脑 / 手机 / 平板" />
              <ValueItem image="act-upload.png" title="简单易用" detail="链接、二维码、取件码" />
            </section>
            <div className="send-prototype-trust"><span><ShieldCheck size={14} />文件仅保留至有效期结束</span><span><LockKeyhole size={14} />支持提取密码</span><span><PrototypeAsset name="ico-scan.png" size={16} />上传前安全检测</span></div>
          </>
        ) : showUploadStatus ? (
          <>
            <div className="send-page-head">
              <div className="send-page-head-copy">
                <h1>正在上传 {files.length} 个文件</h1>
                <p>{uploadState.status === 'paused' ? '上传已暂停，已传分片会保留，可随时继续。' : uploadState.status === 'failed' ? '上传已中断，可重试本次上传或取消后重新选择文件。' : uploadState.status === 'finalizing' ? '文件已传输完成，正在执行安全检查并生成取件信息。' : '上传过程请保持页面打开，中断后可以继续。'}</p>
              </div>
              <div className="send-page-head-actions">
                {uploadState.status === 'uploading' && <button className="secondary-button" type="button" onClick={onPause} disabled={!isUploading}><Pause size={15} />暂停</button>}
                {uploadState.status === 'paused' && <button className="primary-button" type="button" onClick={onResume}><Play size={15} />继续上传</button>}
                {uploadState.status === 'failed' && uploadState.failurePhase !== 'threat' && <button className="primary-button" type="button" onClick={onRetry}><RotateCcw size={15} />{uploadState.failurePhase === 'scan' ? '重试安全检查' : uploadState.failurePhase === 'query' ? '查询处理结果' : '重试上传'}</button>}
                <button className="secondary-button send-cancel-button" type="button" onClick={onReset} disabled={uploadState.status === 'finalizing' || uploadState.failurePhase === 'query'}><X size={15} />取消上传</button>
              </div>
            </div>

            <UploadProgressPanel progress={uploadProgress} uploadState={uploadState} fileCount={files.length} fileIndex={currentFileIndex + 1} />

            <section className="upload-panel upload-queue-card" aria-label="上传队列">
              {/* 上传中仍保留文件选择入口（隐藏 input）：与「移除文件」同源，
                  finalizing 阶段由 addFiles 的守卫拒绝替换正在发布的批次。 */}
              <input ref={inputRef} type="file" multiple hidden onChange={(event) => { addFiles(event.target.files); event.target.value = '' }} />
              <input ref={folderInputRef} type="file" multiple webkitdirectory="" directory="" hidden onChange={(event) => { addFiles(event.target.files); event.target.value = '' }} />
              <div className="upload-queue-head">
                <div><h2>队列</h2><span>{files.length} 个文件 · {queueStatusText}</span></div>
                <button type="button" className="ghost-icon" aria-label="清空文件" title="取消并清空本次上传" disabled={uploadState.status === 'finalizing' || uploadState.failurePhase === 'query'} onClick={onReset}><X size={17} /></button>
              </div>
              <div className="upload-queue-list">
                {files.map((file, index) => {
                  const done = uploadState.status === 'finalizing' || (currentFileIndex > -1 && index < currentFileIndex)
                  const active = !done && currentFileIndex === index
                  return <div className={`file-row upload-queue-row${done ? ' is-done' : active ? ' is-active' : ''}`} key={file.id}>
                    <span className="file-type"><PrototypeFileIcon name={file.name} size={24} /></span>
                    <div className="file-info">
                      <strong title={file.name}>{file.name}</strong>
                      <span>{formatBytes(file.size)} · {done ? '已上传' : active ? `正在上传${uploadState.status === 'paused' ? '（已暂停）' : ''}` : '等待上传'}</span>
                    </div>
                    {active && <div className="queue-file-progress" aria-hidden="true"><span style={{ width: `${uploadProgress}%` }} /></div>}
                    {done && <span className="queue-file-done" title="已上传"><Check size={15} /></span>}
                    {canRemoveDuringUpload && <button type="button" className="ghost-icon" aria-label={`移除 ${file.name}`} onClick={() => removeFile(file.id)}><X size={16} /></button>}
                  </div>
                })}
              </div>
              <div className="upload-settings-line">
                <span><Mail size={14} />{settings.recipients ? `定向发送：${settings.recipients}` : '公开链接：未填写收件人'}</span>
                <button type="button" className="secondary-button" onClick={onSettings} disabled={uploadState.status === 'finalizing'} title={uploadState.status === 'finalizing' ? '安全检查阶段不可修改分享设置' : '查看本次上传的分享设置'}><Settings2 size={15} />分享设置</button>
              </div>
            </section>
          </>
        ) : (
          <>
            <div className="send-page-head send-page-head-narrow">
              <div className="send-page-head-copy">
                <h1>{shareResult ? '发送完成' : '已选文件'}</h1>
                <p>{shareResult ? '分享链接、取件码和二维码已准备好。' : '确认要发送的内容，可继续添加文件或文件夹。'}</p>
              </div>
              {!shareResult && <div className="send-page-head-actions"><button className="secondary-button" type="button" onClick={() => inputRef.current?.click()} disabled={isUploading}><FolderOpen size={16} />添加文件</button><button className="secondary-button" type="button" onClick={() => folderInputRef.current?.click()} disabled={isUploading}><FolderOpen size={16} />添加文件夹</button></div>}
            </div>
            <section className={`upload-panel send-prototype-drop-card send-prototype-queue-card ${isDragging ? 'dragging' : ''}`} onDragEnter={(event) => { event.preventDefault(); setIsDragging(true) }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (event.currentTarget === event.target) setIsDragging(false) }} onDrop={(event) => { event.preventDefault(); setIsDragging(false); addFiles(event.dataTransfer.files) }}>
              <input ref={inputRef} type="file" multiple hidden onChange={(event) => { addFiles(event.target.files); event.target.value = '' }} />
              <input ref={folderInputRef} type="file" multiple webkitdirectory="" directory="" hidden onChange={(event) => { addFiles(event.target.files); event.target.value = '' }} />
              {files.length > 0 && !shareResult && <div className="file-queue">
                <div className="queue-heading"><div><span className="eyebrow">待发送文件</span><h2>{files.length} 个文件，准备就绪</h2></div><button className="ghost-icon" aria-label="清空文件" disabled={uploadState.status === 'finalizing' || uploadState.failurePhase === 'query'} onClick={onReset}><X size={17} /></button></div>
                <label className="delivery-field"><span><Mail size={14} />定向发送</span><input maxLength={RECIPIENT_TEXT_MAX} value={settings.recipients} disabled={isUploading} onChange={(event) => onUpdateSettings({ recipients: limitInputText(event.target.value, RECIPIENT_TEXT_MAX) })} aria-invalid={Boolean(recipientError)} aria-describedby="delivery-recipient-hint" placeholder="输入手机号或邮箱，多个用逗号分隔（可选）" /><small id="delivery-recipient-hint" className={`contact-input-hint ${recipientError ? 'invalid' : ''}`} aria-live="polite">{recipientError || '可留空；最多 50 个收件人，不能填写自己的手机号或邮箱。'}</small></label>
                <div className="file-list">{files.map((file) => <FileRow key={file.id} file={file} onRemove={uploadState.status === 'finalizing' || uploadState.failurePhase === 'query' ? undefined : () => removeFile(file.id)} />)}</div>
                {guestQuota?.enabled && <div className="guest-quota-hint"><Gauge size={15} /><span>未登录累计可传 <strong>{formatBytes(guestQuota.limitBytes)}</strong>，本设备已用 {formatBytes(guestQuota.usedBytes)}{guestQuota.reservedBytes ? <>，未完成上传占用 <strong>{formatBytes(guestQuota.reservedBytes)}</strong><button type="button" className="guest-quota-release" onClick={releaseGuestUploads} aria-label="释放未完成上传占用的额度">释放</button></> : null}，剩余 <strong>{formatBytes(guestQuota.remainingBytes)}</strong></span><button type="button" onClick={onLogin}><UserPlus size={13} />免费注册</button></div>}
                <div className="queue-actions"><button className="secondary-button" onClick={onSettings}><Settings2 size={16} />分享设置</button><button className="primary-button" disabled={Boolean(recipientError)} onClick={() => uploadFiles()}><Send size={16} />开始上传<ArrowRight size={15} /></button></div>
              </div>}
              {shareResult && <ShareResult result={shareResult} settings={settings} onCopy={onCopy} onCopyQrImage={onCopyQrImage} onReset={onReset} />}
            </section>
          </>
        )}
      </div>
    </div>
  )
}

export function UploadProgressPanel({ progress, uploadState, fileCount = 0, fileIndex = 0 }) {
  const failed = uploadState.status === 'failed'
  const checking = uploadState.status === 'finalizing'
  const publishing = checking && uploadState.checkStage === 'publishing'
  const transportDone = checking || ['scan', 'threat', 'query'].includes(uploadState.failurePhase)
  // 状态文案沿用真实阶段：上传中/已暂停/安全检查/生成取件码，不虚构分片序号。
  const phasePrefix = String(uploadState.phase || '')
  const statusText = uploadState.status === 'paused' ? '已暂停'
    : failed ? (uploadState.phase || '上传中断')
      : checking ? (publishing ? '安全检查通过，正在生成取件码' : '正在进行安全检查')
        : phasePrefix.includes('重试') ? '正在重试上传'
          : phasePrefix.includes('恢复') ? '已恢复上传进度'
            : phasePrefix.includes('创建') ? '正在创建上传会话'
              : '上传中'
  const phaseOneState = transportDone ? 'done' : failed ? 'failed' : 'active'
  const phaseTwoState = publishing ? 'done' : checking ? 'active' : ['scan', 'threat'].includes(uploadState.failurePhase) ? 'failed' : 'pending'
  const phaseThreeState = publishing ? 'active' : 'pending'
  const phaseOneCopy = phaseOneState === 'done' ? `${fileCount || 1} 个文件已全部上传`
    : phaseOneState === 'failed' ? '上传已中断，可重试本次上传'
      : uploadState.status === 'paused' ? '已暂停，已传分片会保留'
        : `正在上传 ${uploadState.currentFile || '文件'}`
  const phaseTwoCopy = phaseTwoState === 'done' ? '安全检查已通过'
    : phaseTwoState === 'active' ? (uploadState.checkFileCount > 1 ? `正在检测 ${uploadState.checkFileCount} 个文件` : '正在检测已上传的文件')
      : phaseTwoState === 'failed' ? '安全检查未通过，已停止发布' : '上传完成后逐文件检测'
  const phaseThreeCopy = phaseThreeState === 'active' ? '正在生成链接、二维码与取件码' : '完成后生成链接、二维码与取件码'
  const totalBytes = uploadState.totalBytes || 0
  const byteRatio = totalBytes ? Math.min(100, Math.round(((uploadState.uploadedBytes || 0) / totalBytes) * 100)) : 0
  return (
    <div className={`progress-wrap enhanced-progress upload-progress-card ${uploadState.status}`}>
      <div className="upload-top">
        <div className="upload-file">
          <span className="upload-file-icon"><PrototypeFileIcon name={uploadState.currentFile} size={32} /></span>
          <div className="upload-file-copy">
            <b title={uploadState.currentFile || undefined}>{uploadState.currentFile || '正在准备上传'}</b>
            <span>{fileIndex > 0 && fileCount > 0 ? `第 ${fileIndex} / ${fileCount} 个文件 · ` : ''}{formatBytes(totalBytes)} · 已上传 {formatBytes(uploadState.uploadedBytes || 0)}（{byteRatio}%）</span>
          </div>
        </div>
        <div className="progress-label"><span>{statusText}</span><strong>{progress}%</strong></div>
      </div>
      <div className="progress-track upload-progress-track" role="progressbar" aria-label="上传进度" aria-valuenow={progress} aria-valuemin="0" aria-valuemax="100"><span style={{ width: `${progress}%` }} /></div>
      <div className="upload-metrics">
        <span>已传 {formatBytes(uploadState.uploadedBytes)} / {formatBytes(uploadState.totalBytes)}</span>
        <span>{transportDone ? '文件传输已完成' : failed ? '上传已中断' : <>速度 {uploadState.speedBps ? `${formatBytes(uploadState.speedBps)}/s` : '计算中'}</>}</span>
        <span>{transportDone ? uploadState.failurePhase === 'threat' ? '已阻止发布' : uploadState.failurePhase === 'scan' ? '安全检查未通过' : uploadState.failurePhase === 'query' ? '处理结果待查询' : publishing ? '正在完成发布' : '等待安全检查结果' : failed ? '可重试或取消本次上传' : uploadState.status === 'paused' ? '已暂停，可继续上传' : <>剩余 {formatDuration(uploadState.etaSeconds)}</>}</span>
      </div>

      <div className="upload-phase-list">
        <div className={`upload-phase ${phaseOneState}`}><i>{phaseOneState === 'done' ? <Check size={12} /> : phaseOneState === 'active' ? <CloudUpload size={12} /> : '1'}</i><div><b>分片上传</b><small>{phaseOneCopy}</small></div>{phaseOneState === 'active' && <span className="upload-phase-badge">{uploadState.status === 'paused' ? '已暂停' : '进行中'}</span>}</div>
        <div className={`upload-phase ${phaseTwoState}`}><i>{phaseTwoState === 'done' ? <Check size={12} /> : phaseTwoState === 'active' ? <ShieldCheck size={12} /> : phaseTwoState === 'failed' ? <X size={12} /> : '2'}</i><div><b>安全检查</b><small>{phaseTwoCopy}</small></div>{phaseTwoState === 'active' && <span className="upload-phase-badge">进行中</span>}</div>
        <div className={`upload-phase ${phaseThreeState}`}><i>{phaseThreeState === 'done' ? <Check size={12} /> : '3'}</i><div><b>生成取件码</b><small>{phaseThreeCopy}</small></div>{phaseThreeState === 'active' && <span className="upload-phase-badge">进行中</span>}</div>
      </div>

      {checking && <SecurityCheckStatus startedAt={uploadState.checkStartedAt} stage={uploadState.checkStage} currentFile={uploadState.currentFile} fileIndex={uploadState.checkFileIndex} fileCount={uploadState.checkFileCount} completedCount={uploadState.checkCompletedCount} activeCount={uploadState.checkActiveCount} connectionMessage={uploadState.connectionMessage} />}
      {uploadState.retryCount > 0 && <small className="upload-retry-note">已自动重试 {uploadState.retryCount} 次</small>}
      {uploadState.error && (['threat', 'scan'].includes(uploadState.failurePhase)
        ? <SecurityCheckFailure message={uploadState.error} code={uploadState.errorCode} fileName={uploadState.scanFile} finding={uploadState.scanFinding} />
        : <p className="upload-error">{uploadState.error}</p>)}

      <div className="upload-security-note">
        <ShieldCheck size={16} />
        <div><b>安全检查说明</b><span>上传完成后系统会逐个文件检测病毒与敏感内容，通常只需要几秒；命中风险时整批任务会停止并列出涉及文件。</span></div>
      </div>
    </div>
  )
}

export function ShareResult({ result, settings, onCopy, onCopyQrImage, onReset }) {
  const [qrOpen, setQrOpen] = useState(false)
  // 下载次数上限来自本次分享的真实配置（null/0 = 不限）。
  // 这里展示「上限」而不是「剩余」：卡片可能长时间停留，剩余次数会与真实下载进度脱节。
  const downloadLimit = Number(result.downloadLimit || 0)
  return (
    <>
      <div className="share-result">
        <div className="result-topline">
          <span className="success-badge"><PrototypeAsset className="success-badge-image" name="act-success.png" size={22} /> 上传完成</span>
          <span className="result-topline-meta">
            <span><Download size={13} /> {downloadLimit > 0 ? `下载次数 最多 ${downloadLimit} 次` : '下载次数 不限'}</span>
            <span><Clock3 size={13} /> {formatExpiry(result.expiresAt)}</span>
          </span>
        </div>
        <div className="result-main">
          <div className="result-code">
            <span>{result.code.length} 位取件码</span>
            <strong>{result.code}</strong>
            <button className="copy-button" onClick={() => onCopy(result.code)}><Copy size={14} /> 复制</button>
          </div>
          {result.qrDataUrl && (
            <button className="qr-trigger" onClick={() => setQrOpen(true)} aria-label="打开分享二维码">
              <img className="qr-image" src={result.qrDataUrl} alt="分享二维码" />
              <span>点击放大</span>
            </button>
          )}
        </div>
        <div className="share-link-list">
          <div className="share-link-item">
            {/* 两条链接此前只有图标差异，用户分不清该发哪一条，这里明确标注用途。 */}
            <div className="share-link-label"><Link2 size={13} /><span>公开分享链接</span><small>任何人打开都能取件</small></div>
            <div className="share-link">
              <span>{result.shareUrl}</span>
              <button onClick={() => onCopy(result.shareUrl)} aria-label="复制公开分享链接" title="复制公开分享链接"><Copy size={15} /></button>
            </div>
          </div>
          {result.enterpriseUrl && (
            <div className="share-link-item">
              <div className="share-link-label"><Building2 size={13} /><span>团队链接</span><small>带团队标识，打开后可申请加入团队</small></div>
              <div className="share-link enterprise-link">
                <span>{result.enterpriseUrl}</span>
                <button onClick={() => onCopy(result.enterpriseUrl)} aria-label="复制团队链接" title="复制团队链接"><Copy size={15} /></button>
              </div>
            </div>
          )}
        </div>
        {result.deliveryRecipients?.length > 0 && <ShareNotificationStatus result={result} />}
        <div className="result-actions">
          <button className="secondary-button" onClick={onReset}><RotateCcw size={15} /> 继续发送</button>
          <button className="primary-button" onClick={() => onCopy(`${result.shareUrl} · 取件码 ${result.code}`)}><Link2 size={15} /> 分享信息</button>
        </div>
        {settings.passwordEnabled && <p className="result-security"><LockKeyhole size={14} /> 已开启提取密码保护</p>}
      </div>
      {qrOpen && (
        <QrPreviewModal
          title="分享二维码"
          detail={`取件码 ${result.code}`}
          qrDataUrl={result.qrDataUrl}
          targetUrl={result.shareUrl}
          onClose={() => setQrOpen(false)}
          onCopyImage={() => onCopyQrImage(result.qrDataUrl, result.shareUrl)}
          onCopyLink={() => onCopy(result.shareUrl)}
        />
      )}
    </>
  )
}

export function ShareNotificationStatus({ result }) {
  const logs = Array.isArray(result.notificationLog) ? result.notificationLog : []
  // A recipient may receive both channels, or only one when the other fails.
  // SMTP acceptance means the email was sent; it does not confirm inbox delivery.
  const categories = [
    { pattern: /邮件已提交投递|邮件已发送/, text: count => `已发送 ${count} 封邮件通知` },
    { pattern: /站内已发送/, text: count => `已发送 ${count} 条站内通知` },
    { pattern: /^已发送$/, text: count => `已发送 ${count} 个通知` },
    { pattern: /邮件发送失败|邮件未被服务器接受/, text: count => `${count} 个邮箱发送失败` },
    { pattern: /邮件通道未配置/, text: count => `${count} 个邮箱未发送（邮件服务未配置）` },
    { pattern: /邮件提醒已关闭/, text: count => `${count} 个邮箱未发送（收件人已关闭邮件提醒）` },
    { pattern: /该手机号未匹配到平台账号/, text: count => `${count} 个手机号未发送通知（未匹配平台账号）` },
    { pattern: /^未匹配账号$/, text: count => `${count} 个收件人未匹配平台账号` },
  ]
  const counts = categories.map(category => ({ ...category, count: logs.filter(item => category.pattern.test(item?.status || '')).length }))
  const summaries = counts.filter(category => category.count).map(category => category.text(category.count))
  const unknown = logs.filter(item => !categories.some(category => category.pattern.test(item?.status || ''))).length
  if (unknown) summaries.push(`${unknown} 个收件人的通知状态待确认`)
  if (counts[0].count) summaries.push('请收件人查看收件箱或垃圾邮件')
  const summary = summaries.join('；') || `已记录 ${result.deliveryRecipients?.length || 0} 个收件人，通知状态待确认`
  return (
    <div className="notification-list share-notification-status" role="status">
      <Mail size={14} />
      <span>{summary}</span>
    </div>
  )
}

export function CollectView({ entitlement, result, manageData, manageLoading, records, onCreate, onResetResult, onCopy, onCopyQrImage, onOpenManager, onManageSettings, onCloseTask, onReopenTask, onDeleteSubmission, onCloseManager, onRefreshManager, onRefreshRecords }) {
  const collectionMaxMb = Math.floor((entitlement?.singleFileLimitBytes || 1.2 * 1024 ** 3) / 1024 ** 2)
  const [form, setForm] = useState(createDefaultCollectionForm)
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const collectionRecords = records.map(normalizeRecord).filter((record) => record.scope === 'my_collections')

  useEffect(() => {
    onRefreshRecords?.({ silent: true }).catch(() => {})
  }, [])

  const backToCreate = () => {
    setForm(createDefaultCollectionForm())
    onResetResult()
  }

  return (
    <section className="workspace-page collection-page">
      <div className="collect-page-heading">
        <div className="collect-page-heading-row">
          <div><h1>创建收集任务</h1><p>生成一个提交链接，向多人收集文件，无需对方注册。</p></div>
          {collectionRecords.length > 0 && <button className="secondary-button" type="button" onClick={() => document.getElementById('collection-history')?.scrollIntoView({ block: 'start' })}>管理已有收集 <ArrowRight size={14} /></button>}
        </div>
      </div>
      {manageLoading ? (
        <div className="collection-files-card collection-loading"><span className="loading-dot" /><p>正在加载已收文件...</p></div>
      ) : manageData ? (
        <CollectionFilesPanel data={manageData} onClose={onCloseManager} onRefresh={onRefreshManager} onManageSettings={onManageSettings} onCloseTask={onCloseTask} onReopenTask={onReopenTask} onDeleteSubmission={onDeleteSubmission} onCopy={onCopy} onCopyQrImage={onCopyQrImage} />
      ) : (
        <div className={`collect-builder ${result ? 'created' : ''}`}>
          {!result ? (
            <>
              <div className="builder-preview">
                <div className="preview-label">收集任务预览</div>
                <div className="preview-card collection-preview-card">
                  <div className="collection-preview-title"><span className="preview-icon"><Inbox size={19} /></span><strong>{form.title || '未命名任务'}</strong></div>
                  <span className="collection-preview-description">{form.description || '请填写收集说明'}</span>
                  <CollectionLimitInfo allowedTypes={form.allowedTypes} maxFileSizeMb={form.maxFileSizeMb} compact />
                  <div className="collection-preview-drop"><PrototypeAsset name="ico-cloud.png" width={26} height={22} /><span>拖拽文件到这里，或点击选择</span></div>
                  <small>截止 {form.deadline || '未设置'} · 允许匿名提交</small>
                </div>
              </div>
              <div className="builder-form">
                <div className="builder-form-heading"><h2>收集任务信息</h2><p>设置收集内容与提交要求</p></div>
                <label>
                  <span className="builder-label"><span>任务名称</span><small className={form.title.length >= COLLECTION_TITLE_MAX ? 'field-count at-limit' : 'field-count'}>{form.title.length}/{COLLECTION_TITLE_MAX}</small></span>
                  <input value={form.title} onChange={(event) => update('title', event.target.value)} maxLength={COLLECTION_TITLE_MAX} placeholder="例如：9 月产品素材收集" />
                </label>
                <label>
                  <span className="builder-label"><span>收集说明</span><small className={form.description.length >= COLLECTION_DESCRIPTION_MAX ? 'field-count at-limit' : 'field-count'}>{form.description.length}/{COLLECTION_DESCRIPTION_MAX}</small></span>
                  <textarea value={form.description} onChange={(event) => update('description', event.target.value)} maxLength={COLLECTION_DESCRIPTION_MAX} placeholder="例如：请上传你负责的图片、文档或视频素材" rows={4} />
                </label>
                <div className="collection-inline-fields">
                  <label>截止时间<DatePicker value={form.deadline} onChange={(value) => update('deadline', value)} min={formatDateInput(new Date())} ariaLabel="截止时间" /></label>
                  <label>单文件大小限制<select value={Math.min(form.maxFileSizeMb, collectionMaxMb)} onChange={(event) => update('maxFileSizeMb', Number(event.target.value))}>{collectionSizeOptions(collectionMaxMb, form.maxFileSizeMb).map(size => <option key={size} value={size}>{formatBytes(size * 1024 ** 2)}</option>)}</select></label>
                </div>
                <label>文件类型<div className="chip-group">{COLLECTION_TYPE_OPTIONS.map((type) => <button key={type} className={form.allowedTypes.includes(type) ? 'selected' : ''} onClick={() => update('allowedTypes', toggleCollectionType(form.allowedTypes, type))}>{type}</button>)}</div></label>
                <div className="collection-builder-groups">
                  <section className={`collection-builder-section ${form.materials.length ? 'has-items' : ''}`} aria-labelledby="collection-materials-heading">
                    <div className="collection-builder-section-heading"><div><strong id="collection-materials-heading">材料清单</strong><small>标记必交项；命名格式支持 {'{提交人}'}、{'{材料项}'}、{'{原文件名}'}</small></div><button type="button" className="secondary-button" disabled={form.materials.length >= 30} onClick={() => update('materials', [...form.materials, { id: newCollectionFormItemId('mat'), name: '', required: true }])}><span>添加材料</span></button></div>
                    {form.materials.length ? form.materials.map((material, index) => <div className="collection-rule-row" key={material.id}>
                      <input aria-label={`材料名称 ${index + 1}`} value={material.name} maxLength={40} onChange={(event) => update('materials', form.materials.map((item) => item.id === material.id ? { ...item, name: event.target.value } : item))} placeholder="例如：营业执照" />
                      <label className="collection-rule-required"><input type="checkbox" checked={material.required} onChange={(event) => update('materials', form.materials.map((item) => item.id === material.id ? { ...item, required: event.target.checked } : item))} />必交</label>
                      <button type="button" className="ghost-icon" aria-label={`删除材料 ${index + 1}`} title="删除材料" onClick={() => update('materials', form.materials.filter((item) => item.id !== material.id))}><Trash2 size={15} /></button>
                      <label className="collection-material-naming-field">
                        <span>命名格式（可选）</span>
                        <input className="collection-material-naming" aria-label={`${material.name || `材料 ${index + 1}`}命名格式`} value={material.namingPattern || ''} maxLength={COLLECTION_FILENAME_PATTERN_MAX} onChange={(event) => update('materials', form.materials.map((item) => item.id === material.id ? { ...item, namingPattern: event.target.value } : item))} placeholder="例如：{提交人}_{材料项}_{原文件名}" />
                        <small className="collection-material-naming-preview">当前规则：<code>{material.namingPattern || '未设置，提交时使用原文件名'}</code></small>
                      </label>
                    </div>) : <p className="collection-builder-empty">未设置时可直接上传任意文件</p>}
                  </section>
                  <section className={`collection-builder-section ${form.customFields.length ? 'has-items' : ''}`} aria-labelledby="collection-fields-heading">
                    <div className="collection-builder-section-heading"><div><strong id="collection-fields-heading">自定义字段</strong><small>设置提交人需补充填写的信息，支持文本、下拉和日期，最多 20 项</small></div><button type="button" className="secondary-button" disabled={form.customFields.length >= 20} onClick={() => update('customFields', [...form.customFields, { id: newCollectionFormItemId('field'), label: '', type: 'text', required: false }])}><span>添加字段</span></button></div>
                    {form.customFields.length ? form.customFields.map((field, index) => <div className="collection-field-editor" key={field.id}>
                      <div className="collection-field-editor-main">
                        <input aria-label={`字段名称 ${index + 1}`} value={field.label} maxLength={40} onChange={(event) => update('customFields', form.customFields.map((item) => item.id === field.id ? { ...item, label: event.target.value } : item))} placeholder="字段名称，例如：供应商类型" />
                        <div className="collection-field-controls">
                          <select aria-label={`字段类型 ${index + 1}`} value={field.type} onChange={(event) => update('customFields', form.customFields.map((item) => item.id === field.id ? { ...item, type: event.target.value, ...(event.target.value === 'select' ? { options: item.options?.length >= 2 ? item.options : ['选项一', '选项二'] } : {}) } : item))}><option value="text">文本填写</option><option value="select">下拉选择</option><option value="date">日期选择</option></select>
                          <label className="collection-rule-required"><input type="checkbox" checked={field.required} onChange={(event) => update('customFields', form.customFields.map((item) => item.id === field.id ? { ...item, required: event.target.checked } : item))} />必填</label>
                          <button type="button" className="secondary-button collection-field-delete" aria-label={`删除字段 ${index + 1}`} onClick={() => update('customFields', form.customFields.filter((item) => item.id !== field.id))}><Trash2 size={16} /><span>删除</span></button>
                        </div>
                      </div>
                      {field.type === 'select' && <input className="collection-field-options" aria-label={`${field.label || `字段 ${index + 1}`}下拉选项`} value={(field.options || []).join(', ')} onChange={(event) => update('customFields', form.customFields.map((item) => item.id === field.id ? { ...item, options: event.target.value.split(',').map((option) => option.trim()).filter(Boolean) } : item))} placeholder="选项之间用逗号分隔，例如：生产商, 经销商" />}
                    </div>) : <p className="collection-builder-empty">未添加时只需选择材料并上传文件</p>}
                  </section>
                </div>
                <p className="admin-plan-help">每个任务最多 {(entitlement?.collectionParticipantLimit ?? 10) || '不限'} 人提交 · 同时进行 {(entitlement?.activeCollectionLimit ?? 1) || '不限'} 个任务</p>
                <button className="primary-button wide" onClick={() => onCreate({ ...form, maxFileSizeMb: Math.min(form.maxFileSizeMb, collectionMaxMb) })}><Inbox size={16} /> 创建收集任务 <ArrowRight size={15} /></button>
              </div>
            </>
          ) : (
            <CollectionSuccess result={result} onCopy={onCopy} onCopyQrImage={onCopyQrImage} onOpenManager={onOpenManager} onBack={backToCreate} />
          )}
        </div>
      )}
      {!manageData && collectionRecords.length > 0 && (
          <div className="collection-history" id="collection-history">
          <div className="collection-history-heading">
            <div><p className="eyebrow">本机保存的任务</p><h2>我的收集任务</h2></div>
            <span>{collectionRecords.length} 个任务</span>
          </div>
          <div className="collection-history-list">
            {collectionRecords.slice(0, 6).map((record, index) => {
              const managePath = collectionManagePath(recordManageUrl(record))
              return (
                <div className="collection-history-row" key={record.id || `${record.name}-${index}`}>
                  <span className="record-icon collect"><PrototypeAsset name="act-clipboard.png" size={24} /></span>
                  <div>
                    <strong>{record.name}</strong>
                    <span>{record.meta}</span>
                    <CollectionLimitInfo allowedTypes={record.allowedTypes} maxFileSizeMb={record.maxFileSizeMb} compact />
                  </div>
                  <div className="collection-history-actions">
                    {managePath
                      ? <a className="secondary-button" href={managePath}><FolderOpen size={15} /> 查看已收文件</a>
                      : <button className="secondary-button" disabled={!recordManageUrl(record)} onClick={() => onOpenManager(recordManageUrl(record))}><FolderOpen size={15} /> 查看已收文件</button>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
      <div className="collection-note"><ShieldCheck size={17} /><span>提交者之间互不可见，只有创建者通过管理链接查看全部文件。</span></div>
    </section>
  )
}

export function CollectionSuccess({ result, onCopy, onCopyQrImage, onOpenManager, onBack }) {
  const [qrOpen, setQrOpen] = useState(false)
  const managePath = collectionManagePath(result.manageUrl)

  return (
    <>
      <div className="collection-success">
        <PrototypeAsset className="success-large-image" name="act-success.png" width={52} height={52} />
        <p className="eyebrow">收集任务已创建</p>
        <h2>{result.title}</h2>
        <p>分享下面的链接，参与者即可匿名提交文件。</p>
        <CollectionLimitInfo allowedTypes={result.allowedTypes} maxFileSizeMb={result.maxFileSizeMb} />
        <div className="collection-links">
          <div className="collection-link-item">
            <strong className="collection-link-label">普通收集链接</strong>
            <span className="collection-link-description">发给参与者，用于提交文件</span>
            <div className="collection-share"><Link2 size={16} /><strong title={result.publicUrl}>{result.publicUrl}</strong><button onClick={() => onCopy(result.publicUrl)} aria-label="复制普通收集链接" title="复制普通收集链接"><Copy size={15} /></button></div>
          </div>
          {result.enterpriseUrl && <div className="collection-link-item">
            <strong className="collection-link-label">团队专属收集链接</strong>
            <span className="collection-link-description">提交到同一任务，页面另有申请加入团队入口</span>
            <div className="collection-share enterprise-link"><Building2 size={16} /><strong title={result.enterpriseUrl}>{result.enterpriseUrl}</strong><button onClick={() => onCopy(result.enterpriseUrl)} aria-label="复制团队专属收集链接" title="复制团队专属收集链接"><Copy size={15} /></button></div>
          </div>}
        </div>
        {result.qrDataUrl && (
          <button className="qr-trigger" onClick={() => setQrOpen(true)} aria-label="打开收集二维码">
            <img className="collection-qr" src={result.qrDataUrl} alt="收集二维码" />
            <span>普通收集链接二维码 · 点击放大</span>
          </button>
        )}
        <div className="result-actions">
          <button className="secondary-button" onClick={onBack}><ArrowLeft size={15} /> 返回创建</button>
          {managePath
            ? <a className="secondary-button" href={managePath}><FolderOpen size={15} /> 查看已收文件</a>
            : <button className="secondary-button" onClick={() => onOpenManager(result.manageUrl)}><FolderOpen size={15} /> 查看已收文件</button>}
          <button className="primary-button" onClick={() => onCopy(result.manageUrl)}><KeyRound size={15} /> 复制管理链接</button>
        </div>
        <div className="collection-management-note">管理链接供创建者查看、下载和管理已收文件</div>
      </div>
      {qrOpen && (
        <QrPreviewModal
          title="收集二维码"
          detail="普通收集链接，参与者扫码后即可提交文件"
          qrDataUrl={result.qrDataUrl}
          targetUrl={result.publicUrl}
          onClose={() => setQrOpen(false)}
          onCopyImage={() => onCopyQrImage(result.qrDataUrl, result.publicUrl)}
          onCopyLink={() => onCopy(result.publicUrl)}
        />
      )}
    </>
  )
}

export function CollectionFilesPanel({ data, onClose, onRefresh, onManageSettings, onCloseTask, onReopenTask, onDeleteSubmission, onCopy, onCopyQrImage }) {
  const isActive = data.status === 'active'
  const { downloadTask, startDownload, retryDownload, downloadBusy } = useDownloadTask()
  const [previewItem, setPreviewItem] = useState(null)
  const [qrOpen, setQrOpen] = useState(false)
  const downloadAll = () => startDownload(createCollectionDownloadConfig(data))
  const downloadSubmissionItem = (submission) => startDownload(createSubmissionDownloadConfig(data, submission))
  const downloadFile = (submission, fileIndex) => startDownload(createSubmissionFileDownloadConfig(data, submission, fileIndex))
  const previewFile = (submission, fileIndex) => setPreviewItem(createSubmissionFilePreviewConfig(data, submission, fileIndex))
  return (
    <div className="collection-files-card">
      <div className="collection-files-header">
        <div>
          <p className="eyebrow">收集任务管理</p>
          <h2>{data.title}</h2>
          <p>{data.submissions.length} 份提交 · {collectionStatusText(data.status, data.deadline)}</p>
          <CollectionLimitInfo allowedTypes={data.allowedTypes} maxFileSizeMb={data.maxFileSizeMb} />
        </div>
        <div className="collection-files-actions">
          <button className="secondary-button" onClick={onClose}><ArrowLeft size={15} /> 返回任务</button>
          <button className="secondary-button" disabled={!data.publicUrl} onClick={() => onCopy?.(data.publicUrl)}><Link2 size={15} /> 复制提交链接</button>
          <button className="secondary-button" disabled={!data.qrDataUrl} onClick={() => setQrOpen(true)}><QrCode size={15} /> 查看二维码</button>
          <button className="secondary-button" onClick={() => onManageSettings(data)}><Settings2 size={15} /> 编辑任务</button>
          <button className="secondary-button collection-refresh-button" onClick={onRefresh}><RefreshCw size={15} /> 刷新</button>
          {isActive ? (
            <button className="secondary-button danger-lite" onClick={() => onCloseTask(data)}><X size={15} /> 关闭收集</button>
          ) : canReopenCollection(data) ? (
            <button className="secondary-button" onClick={() => onReopenTask(data)}><RefreshCw size={15} /> 重新开启</button>
          ) : (
            <button className="secondary-button" onClick={() => onManageSettings(data)}><CalendarDays size={15} /> 延长后开启</button>
          )}
        </div>
      </div>
      {(data.materials?.length > 0 || data.customFields?.length > 0) && <div className="collection-manager-rules">
        {data.materials?.length > 0 && <div><strong>材料清单</strong><span>{data.materials.map((material) => `${material.name}${material.required ? '（必交）' : '（选交）'}${material.namingPattern ? ` · 命名：${material.namingPattern}` : ''}`).join('、')}</span></div>}
        {data.customFields?.length > 0 && <div><strong>自定义字段</strong><span>{data.customFields.map((field) => `${field.label}${field.required ? '（必填）' : ''}`).join('、')}</span></div>}
      </div>}
      {data.submissions.length > 0 && <button className="primary-button wide collection-download-all" onClick={downloadAll} disabled={downloadBusy}><Download size={16} /> 打包下载全部提交</button>}
      <DownloadProgressPanel task={downloadTask} onRetry={retryDownload} />
      {data.submissions.length ? (
        <div className="collection-submissions" role="region" aria-label="已收提交列表" tabIndex={0}>
          {data.submissions.map((submission) => (
            <div className="collection-submission" key={submission.id}>
              <div className="collection-submission-heading">
                <div>
                  <div className="collection-submission-who">
                    <strong>{submission.participantName}</strong>
                    {submission.submitter
                      ? <span className="submission-account-badge" title={`鲲穹账号：${submission.submitter.displayName || submission.submitter.id}`}><UserRound size={12} /> 账号提交</span>
                      : <span className="submission-anon-badge">匿名提交</span>}
                  </div>
                  <span>{formatDate(submission.submittedAt)} · {submission.files.length} 个文件</span>
                </div>
                <div className="submission-heading-actions">
                  <span className="submission-badge">已提交</span>
                  <button className="submission-download-button" onClick={() => downloadSubmissionItem(submission)} disabled={downloadBusy}><Download size={14} /> 下载此提交</button>
                  <button className="submission-delete-button" onClick={() => onDeleteSubmission(data, submission.id)}><Trash2 size={14} /> 删除提交</button>
                </div>
              </div>
              <div className="submission-files" role="region" aria-label={`${submission.participantName}的文件列表`} tabIndex={0}>{submission.files.map((file, fileIndex) => <div className="submission-file" key={`${submission.id}-${file.relativePath}`}><PrototypeFileIcon name={file.name} size={20} fallback={FileText} /><span title={file.name}>{file.name}{file.originalName && file.originalName !== file.name && <small className="submission-original-name">原文件名：{file.originalName}</small>}</span><small>{formatBytes(file.size)}</small>{canPreviewFile(file) && <button className="ghost-icon" aria-label={`预览 ${file.name}`} onClick={() => previewFile(submission, fileIndex)}><Eye size={15} /></button>}<button className="ghost-icon" aria-label={`下载 ${file.name}`} onClick={() => downloadFile(submission, fileIndex)} disabled={downloadBusy}><Download size={15} /></button></div>)}</div>
              {(data.materials?.length > 0 || data.customFields?.length > 0) && <div className="submission-form-values">
                {data.materials?.length > 0 && <div className="submission-value-group"><strong>本次材料</strong><span>{(submission.materialIds || []).map((id) => data.materials.find((material) => material.id === id)?.name || id).join('、') || '未标记'}</span>{submission.missingMaterialIds?.length > 0 && <em>缺少必交：{submission.missingMaterialIds.map((id) => data.materials.find((material) => material.id === id)?.name || id).join('、')}</em>}</div>}
                {data.customFields?.map((field) => <div className="submission-value-group" key={field.id}><strong>{field.label}</strong><span>{submission.fieldValues?.[field.id] || '未填写'}</span></div>)}
              </div>}
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-manage collection-empty"><Inbox size={25} /><span>暂时还没有人提交文件</span></div>
      )}
      {previewItem && <FilePreviewModal preview={previewItem} onClose={() => setPreviewItem(null)} onDownload={(config) => startDownload(config || previewItem.downloadConfig)} downloadDisabled={downloadBusy} />}
      {qrOpen && (
        <QrPreviewModal
          title="收集二维码"
          detail={data.title || '提交链接'}
          qrDataUrl={data.qrDataUrl}
          targetUrl={data.publicUrl}
          onClose={() => setQrOpen(false)}
          onCopyImage={() => onCopyQrImage?.(data.qrDataUrl, data.publicUrl)}
          onCopyLink={() => onCopy?.(data.publicUrl)}
        />
      )}
    </div>
  )
}

export function RetrieveModal({ code, setCode, result, onClose, onFind }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [requiresLogin, setRequiresLogin] = useState(false)
  const { downloadTask, startDownload, retryDownload, downloadBusy } = useDownloadTask()
  const [previewItem, setPreviewItem] = useState(null)
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !previewItem) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, previewItem])
  const verify = async () => {
    try { const data = await apiRequest(`/api/shares/lookup/${code.trim().toUpperCase()}`, { method: 'POST', body: JSON.stringify({ password }) }); setError(''); setRequiresLogin(false); onFind(data) } catch (err) { setError(err.message); setRequiresLogin(err.code === 'directed_login_required') }
  }
  const findShare = async () => {
    setError('')
    try { await onFind() } catch (err) { setError(err.message); setRequiresLogin(err.code === 'directed_login_required') }
  }
  const loginAsRecipient = () => {
    const returnTo = new URL(window.location.href)
    returnTo.searchParams.set('retrieve', code.trim().toUpperCase())
    returnTo.searchParams.set('view', 'send')
    window.location.href = `/api/auth/login?return_to=${encodeURIComponent(returnTo.toString())}`
  }
  const share = result?.share
  const downloadAll = () => share && startDownload(createShareDownloadConfig(share, { password }))
  const downloadFile = (file, fileIndex) => share && startDownload(createShareFileDownloadConfig(share, file, fileIndex, { password }))
  const previewFile = (file, fileIndex) => share && setPreviewItem(createShareFilePreviewConfig(share, file, fileIndex, { password }))
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={`modal retrieve-modal ${result ? 'retrieve-modal-result' : ''}`} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div><p className="eyebrow">取件</p><h2>{result ? '文件已找到' : '输入取件码'}</h2></div>
          <button className="ghost-icon modal-close" aria-label="关闭取件窗口" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          {!result ? (
            <>
              <p className="modal-intro">输入分享者发给你的 4-6 位取件码，开始下载文件。</p>
              <input className="code-input" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} onKeyDown={(event) => { if (event.key === 'Enter') findShare() }} placeholder="例如 QK7P" autoFocus />
              <div className="retrieve-hint"><ShieldCheck size={15} /> 定向分享需使用收件账号登录</div>
              {error && <p className="public-message">{error}</p>}
              {requiresLogin && <button className="secondary-button" onClick={loginAsRecipient}><UserRound size={15} /> 使用收件账号登录</button>}
            </>
          ) : (
            <>
              <p className="modal-intro">{result.requiresPassword ? '这个分享已开启提取密码，验证后即可查看文件。' : `${share.files.length} 个文件 · ${formatExpiry(share.expiresAt)}`}</p>
              {result.requiresPassword && <input maxLength={128} className="modal-inline-input" type="password" value={password} onChange={(event) => setPassword(limitInputText(event.target.value, 128))} onKeyDown={(event) => { if (event.key === 'Enter') verify() }} placeholder="请输入提取密码，最多 128 个字符" />}
              {result.requiresPassword && <button className="secondary-button verify-button" onClick={verify}>验证密码</button>}
              {share.files.length > 0 && (
                <div className="public-files compact">
                  {share.files.map((file, fileIndex) => <FileRow key={file.relativePath} file={file} onPreview={canPreviewFile(file) && !result.requiresPassword ? () => previewFile(file, fileIndex) : null} onDownload={() => downloadFile(file, fileIndex)} downloadDisabled={downloadBusy || result.requiresPassword} />)}
                </div>
              )}
              {!result.requiresPassword && <button className="primary-button wide" onClick={downloadAll} disabled={downloadBusy || !(share?.files || []).length}><Download size={16} /> {(share?.files || []).length > 1 ? '下载全部文件' : '下载文件'}</button>}
              <DownloadProgressPanel task={downloadTask} onRetry={retryDownload} />
              {error && <p className="public-message">{error}</p>}
              {previewItem && <FilePreviewModal preview={previewItem} onClose={() => setPreviewItem(null)} onDownload={(config) => startDownload(config || previewItem.downloadConfig)} downloadDisabled={downloadBusy} />}
            </>
          )}
        </div>
        {!result && <div className="modal-footer retrieve-footer"><button className="primary-button" onClick={findShare}><KeyRound size={16} /> 查找文件</button></div>}
      </div>
    </div>
  )
}

export function SettingsModal({ settings, setSettings, user, onClose, onSave }) {
  const canUsePermanent = Boolean(user?.plan?.permanent)
  const count = Number(settings.customDownloadLimit)
  const settingError = settings.downloadLimit === 'custom' && (!/^\d+$/.test(String(settings.customDownloadLimit)) || !Number.isSafeInteger(count) || count < 1 || count > 9999)
    ? '下载次数请输入 1–9999 的整数'
    : settings.passwordEnabled && (!settings.password.trim() || settings.password.length > 128)
      ? '提取密码请输入 1–128 个字符，不能全部为空格' : ''
  const updateExpiry = (label, value) => {
    if (value === '0' && !canUsePermanent) return
    setSettings({ ...settings, expiry: label, expiryDays: value })
  }
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div><p className="eyebrow">分享设置</p><h2>让文件按你的规则消失</h2></div>
          <button className="ghost-icon" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="setting-block">
            <span>分享有效期</span>
            <div className="option-grid">{[['1 天', '1'], ['3 天', '3'], ['7 天', '7'], ['永久', '0']].map(([label, value]) => <button key={value} disabled={value === '0' && !canUsePermanent} className={settings.expiryDays === value ? 'selected' : ''} onClick={() => updateExpiry(label, value)} title={value === '0' && !canUsePermanent ? '当前账号不支持永久保存' : ''}>{label}{settings.expiryDays === value && <Check size={14} />}</button>)}</div>
            {!canUsePermanent && <small className="setting-hint">当前账号不支持永久保存，会按所选有效期创建分享。</small>}
          </div>
          <div className="setting-block">
            <span>下载次数</span>
            <div className="option-grid">{[['不限次数', 'unlimited'], ['10 次', '10'], ['1 次', '1'], ['自定义', 'custom']].map(([label, value]) => <button key={value} className={settings.downloadLimit === value ? 'selected' : ''} onClick={() => setSettings({ ...settings, downloads: label, downloadLimit: value })}>{label}{settings.downloadLimit === value && <Check size={14} />}</button>)}</div>
            {settings.downloadLimit === 'custom' && <label className="inline-setting-input"><span>最多下载次数</span><input type="number" min="1" max="9999" value={settings.customDownloadLimit} onChange={(event) => setSettings({ ...settings, customDownloadLimit: event.target.value })} placeholder="例如：5" /></label>}
          </div>
          <div className="setting-block">
            <span>取件码长度</span>
            <div className="option-grid compact-grid">{[['4 位', '4'], ['5 位', '5'], ['6 位', '6']].map(([label, value]) => <button key={value} className={settings.codeLength === value ? 'selected' : ''} onClick={() => setSettings({ ...settings, codeLength: value })}>{label}{settings.codeLength === value && <Check size={14} />}</button>)}</div>
          </div>
          <div className="switch-row"><div><strong>提取密码</strong><span>取件时需要额外输入密码</span></div><button className={`switch ${settings.passwordEnabled ? 'on' : ''}`} aria-label={settings.passwordEnabled ? '关闭提取密码' : '开启提取密码'} onClick={() => setSettings({ ...settings, passwordEnabled: !settings.passwordEnabled })}><span /></button></div>
          {settings.passwordEnabled && <label className="password-field"><span>密码内容</span><input maxLength={128} className="modal-inline-input" type="password" value={settings.password} onChange={(event) => setSettings({ ...settings, password: limitInputText(event.target.value, 128) })} placeholder="请输入密码，最多 128 个字符" /><small>{settings.password.length}/128</small></label>}
          {settingError && <p className="public-message" role="alert">{settingError}</p>}
        </div>
        <div className="modal-footer"><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={Boolean(settingError)} onClick={onSave}><Save size={15} /> 保存设置</button></div>
      </div>
    </div>
  )
}

export function settingsSectionForPath(pathname = '') {
  const section = pathname.split('/')[2]
  return SETTINGS_NAV_ITEMS.some((item) => item.key === section) ? section : 'profile'
}

export function NavItem({ icon: Icon, label, active, onClick }) { return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}><Icon size={17} strokeWidth={2} /><span>{label}</span></button> }

export function MessageCenter({ user, messages, open, onToggle, onClose, onMarkRead, onMarkAllRead, onDelete, onClearAll, onLogin, onInvitationAction, onHandoverAction, handoverDecisionId, onNotify }) {
  const { toast, notify: localNotify } = useToast()
  const notify = onNotify || localNotify
  const unreadCount = messages.filter((message) => message.unread).length
  // 长消息默认两行截断，点击展开/收起完整正文（展开的同时保留标已读行为）
  const [expandedIds, setExpandedIds] = useState(() => new Set())
  // 取件码复制反馈：{ code, ok }，1.8s 后自动清除
  const [codeFeedback, setCodeFeedback] = useState(null)
  useEffect(() => {
    if (!codeFeedback) return undefined
    const timer = window.setTimeout(() => setCodeFeedback(null), 1800)
    return () => window.clearTimeout(timer)
  }, [codeFeedback])
  const toggleExpanded = (message) => {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(message.id)) next.delete(message.id)
      else next.add(message.id)
      return next
    })
  }
  // 从消息正文提取取件码（服务端固定生成「…取件码 XXXXXX。」格式）
  const shareCodeOf = (message) => {
    const match = /取件码\s*([A-Z0-9]{4,8})/.exec(message.body || '')
    return match ? match[1] : ''
  }
  const flashCodeFeedback = (code, ok) => {
    setCodeFeedback({ code, ok })
  }
  const copyMessageCode = async (message, code) => {
    if (!code) return
    const copied = await copyTextWithFeedback(code, notify, '取件码已复制')
    flashCodeFeedback(code, copied)
    if (copied) onMarkRead?.(message)
  }
  const openMessageAction = (message) => {
    if (!message.actionUrl) return
    onMarkRead?.(message)
    try {
      const target = new URL(message.actionUrl, window.location.origin)
      if (target.origin !== window.location.origin || !/^https?:$/.test(target.protocol) || !/^\/(?:share|collect|e|settings|workspace|team)(?:\/|$)/.test(target.pathname)) return
      window.location.href = `${target.pathname}${target.search}${target.hash}`
    } catch { /* Invalid historical message links are not navigable. */ }
  }

  useEffect(() => {
    if (!open) return undefined
    const closeOnOutsideClick = (event) => {
      // 授权确认弹窗属于消息待办流程；点击确认/再想想不应收起底层消息面板。
      if (event.target?.closest?.('.confirm-backdrop')) return
      onClose?.()
    }
    window.addEventListener('click', closeOnOutsideClick)
    return () => window.removeEventListener('click', closeOnOutsideClick)
  }, [open, onClose])

  return (
    <div className="message-center-wrap">
      {toast && <Toast {...toast} />}
      <button className={`message-trigger ${open ? 'active' : ''}`} aria-label={unreadCount ? `消息中心，有 ${unreadCount} 条未读消息` : '消息中心'} aria-haspopup="dialog" aria-expanded={open} onClick={onToggle}>
        <Bell size={18} />
        {unreadCount > 0 && <span className="message-unread-dot" />}
      </button>
      {open && (
        <div className="message-center" role="dialog" aria-label="消息中心" onClick={(event) => event.stopPropagation()}>
          <div className="message-center-header">
            <div><strong>消息中心</strong><span>{unreadCount ? `${unreadCount} 条未读消息` : '没有未读消息'}</span></div>
            {user ? <div className="message-header-actions"><button className="message-mark-all" onClick={onMarkAllRead} disabled={!unreadCount}><MailCheck size={14} /> 全部已读</button><button className="message-mark-all danger" onClick={onClearAll} disabled={!messages.length}><Eraser size={14} /> 清除全部</button></div> : null}
          </div>
          {!user ? (
            <div className="message-empty"><MessageCircle size={22} /><strong>登录后查看消息</strong><span>登录后可以接收系统、官方和他人发送的消息。</span><button className="secondary-button" onClick={onLogin}><UserRound size={15} /> 前往登录</button></div>
          ) : messages.length ? (
            <div className="message-list">
              {messages.map((message) => {
                const shareCode = shareCodeOf(message)
                return (
                <div key={message.id} className={`message-item ${message.unread ? 'unread' : ''}`}>
                  <button className="message-item-main" onClick={() => { onMarkRead(message); toggleExpanded(message) }} aria-expanded={expandedIds.has(message.id)}>
                  <span className={`message-item-icon ${message.category}`}><MessageIcon category={message.category} /></span>
                  <span className="message-item-content"><strong>{message.title}</strong><span className={expandedIds.has(message.id) ? 'expanded' : ''}>{message.body}</span><small>{formatMessageTime(message.createdAt)}{message.body.length > 60 ? ` · ${expandedIds.has(message.id) ? '点击收起' : '点击展开'}` : ''}</small></span>
                  {message.unread && <i className="message-item-dot" />}
                  </button>
                  {shareCode && (
                    <div className="message-code-actions">
                      <button type="button" className="message-code-chip" onClick={(event) => { event.stopPropagation(); copyMessageCode(message, shareCode) }}>
                        <Copy size={12} /> {codeFeedback?.code === shareCode ? (codeFeedback.ok ? '已复制，去提取页粘贴即可' : '复制失败，请手动选取') : `复制取件码 ${shareCode}`}
                      </button>
                      {message.actionUrl && (
                        <button type="button" className="message-code-open" onClick={(event) => { event.stopPropagation(); openMessageAction(message) }}>
                          <ArrowRight size={12} /> 去提取
                        </button>
                      )}
                    </div>
                  )}
                  {message.actionType === 'workspace_invite' && <div className="message-invite-actions"><button type="button" className="secondary-button" onClick={() => onInvitationAction?.(message, 'decline')}><UserX size={15} /> 拒绝</button><button type="button" className="primary-button" onClick={() => onInvitationAction?.(message, 'accept')}><UserCheck size={15} /> 接受加入</button></div>}
                  {message.actionType === 'workspace_ownership_handover' && <div className="message-invite-actions message-handover-actions" aria-busy={Boolean(handoverDecisionId)}><button type="button" className="secondary-button" disabled={Boolean(handoverDecisionId)} onClick={() => onHandoverAction?.(message, 'decline')}><UserX size={15} /> 拒绝交接</button><button type="button" className="primary-button" disabled={Boolean(handoverDecisionId)} onClick={() => onHandoverAction?.(message, 'accept')}><UserCheck size={15} /> {handoverDecisionId === message.actionId ? '处理中…' : '接受交接'}</button></div>}
                  {(message.actionType || '').startsWith('workspace_ownership_handover') && message.actionUrl && <div className="message-invite-actions message-handover-actions"><button type="button" className="secondary-button" onClick={() => openMessageAction(message)}><ArrowRight size={14} /> 查看交接</button></div>}
                  <button className="message-item-delete" aria-label={`删除消息：${message.title}`} title="删除消息" onClick={(event) => { event.stopPropagation(); onDelete(message) }}><Trash2 size={14} /></button>
                </div>
                )
              })}
            </div>
          ) : (
            <div className="message-empty"><Bell size={22} /><strong>暂无消息</strong><span>新的动态会显示在这里。</span></div>
          )}
        </div>
      )}
    </div>
  )
}

export function MessageIcon({ category }) {
  if (category === 'official') return <Megaphone size={15} />
  if (category === 'other') return <MessageCircle size={15} />
  return <ShieldCheck size={15} />
}
