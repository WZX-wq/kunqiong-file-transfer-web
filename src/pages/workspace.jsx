import React from 'react'
import { defaultDeadline, displayUserName, formatBytes, formatDate, formatDuration, formatExpiry, formatMessageTime } from '../lib/format.js'
import { COLLECTION_TYPE_OPTIONS, FOOTER_CONTENT, MAIN_VIEWS, MAX_FILES, MAX_FILE_SIZE, RECORD_SCOPE_TABS, SETTINGS_NAV_ITEMS, defaultSettings } from '../lib/constants.js'
import { useEffect, useRef, useState } from 'react'
import { apiRequest, copyTextToClipboard, createShareFileDownloadConfig, createSubmissionFileDownloadConfig, createUploadSessionState, createUploadState } from '../lib/api.js'
import { useConfirmDialog, useDownloadTask } from '../hooks.js'
import { canReopenCollection, clearCloudRecords, collectionStatusText, createCollectionRecord, createShareRecord, deleteAllCloudMessages, deleteCloudMessage, deleteCloudRecords, fetchCloudMessages, fetchCloudRecords, getCollectionToken, getManageToken, markAllCloudMessagesRead, markCloudMessageRead, normalizeCollectionTypes, normalizeMessages, normalizeNoticeSettings, normalizeRecord, normalizeRecords, readRecords, recordLink, recordManageUrl, replaceCloudRecords, respondWorkspaceInvitation, saveLocalRecord, syncRecords, toggleCollectionType, upsertCloudRecords, upsertRecords, writeRecords } from '../lib/records.js'
import { canPreviewFile, copyImageToClipboard, createCollectionDownloadConfig, createShareDownloadConfig, createShareFilePreviewConfig, createSubmissionDownloadConfig, createSubmissionFilePreviewConfig, uploadShareInChunks } from '../lib/transfer.js'
import { ArrowLeft, ArrowRight, Bell, Building2, CalendarDays, Check, ChevronDown, ChevronRight, Clock3, Cloud, Copy, Download, Eraser, Eye, FileText, FolderOpen, Gauge, HelpCircle, History, Inbox, KeyRound, Link2, LockKeyhole, LogOut, Mail, MailCheck, Megaphone, MessageCircle, Pause, Play, QrCode, RefreshCw, RotateCcw, Save, Send, Settings2, ShieldCheck, Sparkles, Trash2, UploadCloud, UserCheck, UserPlus, UserRound, UserX, X, Zap } from 'lucide-react'
import { SettingsPage } from './settings.jsx'
import { RecordsView } from './records.jsx'
import { CollectionLimitInfo, ContentModal, DatePicker, DownloadProgressPanel, FeatureOrb, FilePreviewModal, FileRow, ManageItemModal, QrPreviewModal, UserAvatar, ValueItem, displayUserSubtitle } from '../components/ui.jsx'
import { ConfirmModal, Toast } from '../components/common.jsx'

export const createDefaultCollectionForm = () => ({
  title: '',
  description: '',
  deadline: defaultDeadline(10),
  allowedTypes: ['全部格式'],
  maxFileSizeMb: 500,
})

export function normalizeMainView(value) {
  return MAIN_VIEWS.has(value) ? value : 'send'
}

export function mainViewUrl(view) {
  return view === 'send' ? '/' : `/?view=${encodeURIComponent(view)}`
}

export function WorkspaceApp() {
  const [routePath, setRoutePath] = useState(() => window.location.pathname)
  const isSettingsRoute = routePath.startsWith('/settings')
  const inputRef = useRef(null)
  const folderInputRef = useRef(null)
  const uploadRef = useRef(createUploadSessionState())
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
  const [toast, setToast] = useState('')
  const [settings, setSettings] = useState(defaultSettings)
  const [records, setRecords] = useState(() => readRecords())
  const [recordsSyncing, setRecordsSyncing] = useState(false)
  const [authUser, setAuthUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authMenuOpen, setAuthMenuOpen] = useState(false)
  const [messageOpen, setMessageOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [footerContentKey, setFooterContentKey] = useState('')
  // 未登录传输配额：enabled=true 时展示剩余额度；null 表示已登录或接口不可用。
  const [guestQuota, setGuestQuota] = useState(null)
  const [guestQuotaDialog, setGuestQuotaDialog] = useState(null)

  useEffect(() => {
    const syncRoute = () => {
      const nextPath = window.location.pathname
      setRoutePath(nextPath)
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
    setRecordsSyncing(true)
    try {
      const cloudRecords = await fetchCloudRecords()
      const merged = writeRecords(upsertRecords(readRecords(), cloudRecords))
      const synced = writeRecords(await syncRecords(merged))
      setRecords(synced)
      const persisted = await replaceCloudRecords(synced)
      const finalRecords = writeRecords(upsertRecords(synced, persisted.records || []))
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
      const days = String(config.defaultShareDays || '')
      if (!['1', '3', '7'].includes(days)) return
      setSettings((current) => current.expiryDays === defaultSettings.expiryDays
        ? { ...current, expiry: `${days} 天`, expiryDays: days }
        : current)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(''), 3000)
    return () => window.clearTimeout(timer)
  }, [toast])

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

  const addFiles = (incoming) => {
    const nextFiles = Array.from(incoming || []).map((file, index) => ({
      id: `${file.name}-${file.lastModified}-${index}-${Math.random()}`,
      file,
      name: file.name,
      size: file.size,
      relativePath: file.webkitRelativePath || file.name,
    }))
    const invalid = nextFiles.find((item) => item.size > MAX_FILE_SIZE)
    if (invalid) {
      setToast(`${invalid.name} 超过 5 GB 限制`)
      return
    }
    setFiles((current) => {
      const merged = [...current, ...nextFiles]
      if (merged.length > MAX_FILES) setToast(`单次最多选择 ${MAX_FILES} 个文件，已保留前 ${MAX_FILES} 个`)
      return merged.slice(0, MAX_FILES)
    })
    setShareResult(null)
    setUploadProgress(0)
    setUploadState(createUploadState())
    abortUploadSession(uploadRef.current.sessionId)
    uploadRef.current = createUploadSessionState()
  }

  const uploadFiles = async ({ resume = false } = {}) => {
    if (!files.length) {
      inputRef.current?.click()
      return
    }
    // 未登录预检：额度不够就直接引导注册，不浪费一次上传。
    if (!authUser?.id && guestQuota?.enabled) {
      const pendingBytes = files.reduce((sum, item) => sum + item.size, 0)
      if (guestQuota.remainingBytes < pendingBytes) {
        setGuestQuotaDialog({
          usedBytes: guestQuota.usedBytes,
          limitBytes: guestQuota.limitBytes,
          remainingBytes: guestQuota.remainingBytes,
          incomingBytes: pendingBytes,
        })
        return
      }
    }
    setIsUploading(true)
    setShareResult(null)
    if (!resume) {
      abortUploadSession(uploadRef.current.sessionId)
      setUploadProgress(0)
      uploadRef.current = createUploadSessionState()
    }
    uploadRef.current.paused = false
    try {
      const data = await uploadShareInChunks(files, settings, uploadRef, ({ progress, ...nextState }) => {
        setUploadProgress(progress)
        setUploadState((current) => ({ ...current, ...nextState, progress }))
      })
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
      if (error.name === 'UploadPausedError') {
        setUploadState((current) => ({ ...current, status: 'paused', phase: '已暂停，可继续上传', error: '' }))
        return
      }
      if (error.code === 'guest_quota_exceeded') {
        setGuestQuotaDialog(error.guestQuota || { incomingBytes: 0 })
        refreshGuestQuota()
      }
      setUploadState((current) => ({ ...current, status: 'failed', phase: '上传失败', error: error.message }))
      setToast(error.message)
    } finally {
      setIsUploading(false)
    }
  }

  const pauseUpload = () => {
    uploadRef.current.paused = true
    uploadRef.current.abortCurrent?.()
  }

  const resetSend = () => {
    uploadRef.current.paused = true
    uploadRef.current.abortCurrent?.()
    abortUploadSession(uploadRef.current.sessionId)
    uploadRef.current = createUploadSessionState()
    setFiles([])
    setShareResult(null)
    setUploadProgress(0)
    setUploadState(createUploadState())
    setIsUploading(false)
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
      setMessageOpen(false)
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
      const data = await apiRequest(`/api/collections/manage/${encodeURIComponent(token)}`)
      setCollectionManageData(data.collection)
      replaceRecordEntry(createCollectionRecord(data.collection, 'my_collections'))
      setActiveView('collect')
    } catch (error) {
      setToast(error.message)
    } finally {
      setCollectionManageLoading(false)
    }
  }

  const refreshCollectionManager = async () => {
    if (!collectionManageData?.manageToken) return
    const data = await apiRequest(`/api/collections/manage/${encodeURIComponent(collectionManageData.manageToken)}`)
    setCollectionManageData(data.collection)
    replaceRecordEntry(createCollectionRecord(data.collection, 'my_collections'))
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

  const copyValue = async (value) => {
    try {
      await copyTextToClipboard(value)
      setToast('已复制到剪贴板')
    } catch {
      setToast('自动复制失败，请手动复制分享信息')
    }
  }

  const copyQrImage = async (dataUrl, fallbackText) => {
    try {
      await copyImageToClipboard(dataUrl)
      setToast('二维码图片已复制')
    } catch {
      try {
        await copyTextToClipboard(fallbackText || dataUrl)
        setToast('当前浏览器不支持直接复制图片，已复制链接')
      } catch {
        setToast('当前浏览器不支持自动复制，请手动复制链接')
      }
    }
  }

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
    setRecordsSyncing(Boolean(authUser?.id))
    try {
      let baseRecords = readRecords()
      if (authUser?.id) {
        const cloudRecords = await fetchCloudRecords()
        baseRecords = writeRecords(upsertRecords(baseRecords, cloudRecords))
      }
      const nextRecords = writeRecords(await syncRecords(baseRecords))
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
        <div className="brand" onClick={() => navigateMainView('send')} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigateMainView('send') } }} role="button" tabIndex={0} aria-label="返回发文件首页">
          <img className="brand-logo" src="/brand-logo.png" alt="鲲穹文件传输" />
        </div>
        <nav className="main-nav" aria-label="主导航">
          <NavItem icon={Send} label="发文件" active={!isSettingsRoute && activeView === 'send'} onClick={() => navigateMainView('send')} />
          <NavItem icon={Inbox} label="收集文件" active={!isSettingsRoute && activeView === 'collect'} onClick={() => navigateMainView('collect')} />
          <NavItem icon={History} label="收发记录" active={!isSettingsRoute && activeView === 'records'} onClick={() => navigateMainView('records')} />
        </nav>
        <div className="topbar-actions">
          {authUser?.organization ? (
            <button className="team-context-button" onClick={() => { window.location.href = '/team' }} title="打开团队管理">
              <span className="team-context-icon"><Building2 size={15} /></span>
              <span className="team-context-copy">
                <strong>{authUser.organization.name}</strong>
                <small>{authUser.organization.members?.length || 0} 位成员 · 共享空间</small>
              </span>
              <ChevronRight size={14} />
            </button>
          ) : authUser?.plan?.team ? (
            <button className="team-context-button team-context-empty" onClick={() => { window.location.href = '/workspace' }} title="创建团队空间">
              <span className="team-context-icon"><Building2 size={15} /></span>
              <span className="team-context-copy">
                <strong>创建团队空间</strong>
                <small>团队版权益已开启</small>
              </span>
              <ChevronRight size={14} />
            </button>
          ) : null}
          <MessageCenter user={authUser} messages={messages} open={messageOpen} onToggle={(event) => { event.stopPropagation(); setAuthMenuOpen(false); setMessageOpen((current) => !current) }} onClose={() => setMessageOpen(false)} onMarkRead={markMessageRead} onMarkAllRead={markAllMessagesRead} onDelete={deleteMessage} onClearAll={clearAllMessages} onLogin={startLogin} onInvitationAction={respondToWorkspaceInvitation} />
          {/* 后台入口不再按账号身份显示（白名单通道已移除，后台只认账号口令）。
              需要直接进后台时访问 /admin，未登录会弹出管理员账号密码弹窗。 */}
          <button className="merchant-button" onClick={() => { window.location.href = '/workspace' }}><Sparkles size={15} /> 会员与企业版</button>
          <AuthButton user={authUser} loading={authLoading} menuOpen={authMenuOpen} onLogin={startLogin} onToggleMenu={(event) => { event.stopPropagation(); setMessageOpen(false); setAuthMenuOpen((current) => !current) }} onSettings={openSettings} onLogout={logout} />
        </div>
      </header>

      <main className="page-content">
        {isSettingsRoute && <SettingsPage user={authUser} loading={authLoading} section={settingsSectionForPath(routePath)} onLogin={startLogin} onLogout={logout} onBack={() => navigateMainView('send')} onSaveProfile={saveProfile} onUpdateUser={updateAccountUser} onNavigateSection={navigateSettingsSection} onOpenWorkspace={() => { window.location.href = '/workspace' }} />}
        {!isSettingsRoute && activeView === 'send' && (
          <SendView
            files={files}
            inputRef={inputRef}
            folderInputRef={folderInputRef}
            isDragging={isDragging}
            setIsDragging={setIsDragging}
            addFiles={addFiles}
            removeFile={(id) => setFiles((current) => current.filter((file) => file.id !== id))}
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
            onRetrieve={() => setRetrieveOpen(true)}
            guestQuota={guestQuota}
            onLogin={startLogin}
          />
        )}
        {!isSettingsRoute && activeView === 'collect' && (
          <CollectView
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
        {!isSettingsRoute && activeView === 'records' && <RecordsView records={records} user={authUser} syncing={recordsSyncing} onCopy={copyValue} onCopyQrImage={copyQrImage} onDelete={deleteRecord} onRename={renameRecord} onClear={clearRecordsWithConfirm} onRefresh={refreshRecords} onOpen={openRecordLink} onOpenCollectionManager={openCollectionManager} onManage={openRecordManagement} onCloseManaged={closeManagedRecord} onReopenManaged={reopenManagedRecord} onSaveShareExpiry={saveShareExpiry} onNotify={setToast} />}
      </main>

      <footer className="page-footer">
        <span>鲲穹文件传输 · 临时传输，轻装上阵</span>
        <div><a className="footer-manual-link" href="/user-manual.html" target="_blank" rel="noopener noreferrer">使用手册</a><button onClick={() => setFooterContentKey('help')}><HelpCircle size={13} /> 帮助中心</button><button onClick={() => setFooterContentKey('terms')}><ShieldCheck size={13} /> 服务协议</button><button onClick={() => setFooterContentKey('privacy')}><LockKeyhole size={13} /> 隐私政策</button></div>
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
      {toast && <Toast message={toast} />}
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

export function SendView({ files, inputRef, folderInputRef, isDragging, setIsDragging, addFiles, removeFile, uploadFiles, isUploading, uploadProgress, uploadState, shareResult, settings, onUpdateSettings, onSettings, onPause, onResume, onRetry, onReset, onCopy, onCopyQrImage, onRetrieve, guestQuota, onLogin }) {
  const showUploadStatus = ['uploading', 'paused', 'failed', 'finalizing'].includes(uploadState.status)
  return (
    <>
      <section className="hero-layout">
        <aside className="side-rail side-rail-left">
          <FeatureOrb icon={Cloud} value="5 GB" label="登录后单文件上限" tone="blue" />
          <FeatureOrb icon={Zap} value="不限速" label="原生带宽传输" tone="green" />
        </aside>
        <div className="transfer-column">
          <div className="section-intro">
            <div>
              <p className="eyebrow"><span className="eyebrow-dot" /> 不登录也能用</p>
              <h1>简单两步，<span>把文件交给他。</span></h1>
              <p className="intro-copy">拖进来，生成链接。临时传输，不占你的云盘。</p>
            </div>
            <button className="retrieve-trigger" onClick={onRetrieve}><KeyRound size={17} /><span>取件码</span><ArrowRight size={15} /></button>
          </div>
          <div className={`upload-panel ${isDragging ? 'dragging' : ''} ${files.length || shareResult ? 'has-files' : ''}`} onDragEnter={(event) => { event.preventDefault(); setIsDragging(true) }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (event.currentTarget === event.target) setIsDragging(false) }} onDrop={(event) => { event.preventDefault(); setIsDragging(false); addFiles(event.dataTransfer.files) }}>
            <input ref={inputRef} type="file" multiple hidden onChange={(event) => { addFiles(event.target.files); event.target.value = '' }} />
            <input ref={folderInputRef} type="file" multiple webkitdirectory="" directory="" hidden onChange={(event) => { addFiles(event.target.files); event.target.value = '' }} />
            {!files.length && !shareResult && <div className="empty-upload"><div className="upload-icon"><UploadCloud size={30} /></div><h2>把文件拖到这里</h2><p>支持多文件与文件夹，单次最多 100 个文件</p><div className="upload-choice"><button className="primary-button" onClick={() => inputRef.current?.click()}><FolderOpen size={17} /> 选择文件</button><button className="secondary-button" onClick={() => folderInputRef.current?.click()}><FolderOpen size={16} /> 选择文件夹</button></div><span className="upload-note">登录后单文件最大 5 GB（未登录 500 MB）· 分片续传 · 上传后自动生成取件码</span></div>}
            {files.length > 0 && !shareResult && (
              <div className="file-queue">
                <div className="queue-heading">
                  <div><span className="eyebrow">待发送文件</span><h2>{files.length} 个文件，准备就绪</h2></div>
                  <button className="ghost-icon" aria-label="清空文件" onClick={onReset}><X size={17} /></button>
                </div>
                <label className="delivery-field">
                  <span><Mail size={14} /> 定向发送</span>
                  <input value={settings.recipients} onChange={(event) => onUpdateSettings({ recipients: event.target.value })} placeholder="输入手机号或邮箱，多个用逗号分隔（可选）" />
                </label>
                <div className="file-list">{files.map((file) => <FileRow key={file.id} file={file} onRemove={() => removeFile(file.id)} />)}</div>
                {guestQuota?.enabled && (
                  <div className="guest-quota-hint">
                    <Gauge size={15} />
                    <span>未登录累计可传 <strong>{formatBytes(guestQuota.limitBytes)}</strong>，本设备已用 {formatBytes(guestQuota.usedBytes)}{guestQuota.reservedBytes ? <>，未完成上传占用 <strong>{formatBytes(guestQuota.reservedBytes)}</strong><button type="button" className="guest-quota-release" onClick={releaseGuestUploads} aria-label="释放未完成上传占用的额度">释放</button></> : null}，剩余 <strong>{formatBytes(guestQuota.remainingBytes)}</strong></span>
                    <button type="button" onClick={onLogin}><UserPlus size={13} /> 免费注册解锁 20 GB</button>
                  </div>
                )}
                {showUploadStatus ? <UploadProgressPanel progress={uploadProgress} uploadState={uploadState} isUploading={isUploading} onPause={onPause} onResume={onResume} onRetry={onRetry} /> : <div className="queue-actions"><button className="secondary-button" onClick={onSettings}><Settings2 size={16} /> 分享设置</button><button className="primary-button" onClick={() => uploadFiles()}><Send size={16} /> 开始上传 <ArrowRight size={15} /></button></div>}
              </div>
            )}
            {shareResult && <ShareResult result={shareResult} settings={settings} onCopy={onCopy} onCopyQrImage={onCopyQrImage} onReset={onReset} />}
          </div>
        </div>
        <aside className="side-rail side-rail-right">
          <FeatureOrb icon={ShieldCheck} value="私密" label="安全分享" tone="orange" />
          <FeatureOrb icon={Gauge} value="快" label="上传下载不限速" tone="violet" />
        </aside>
      </section>
      <section className="value-strip"><ValueItem icon={LockKeyhole} title="无需注册" detail="即开即用，免登录发送" /><ValueItem icon={Link2} title="多种分享" detail="链接、取件码、二维码" /><ValueItem icon={Clock3} title="到期清理" detail="文件到期可自动清理，可在设置开启" /><ValueItem icon={FolderOpen} title="文件夹直传" detail="保留目录结构，不必压缩" /></section>
    </>
  )
}

export function UploadProgressPanel({ progress, uploadState, isUploading, onPause, onResume, onRetry }) {
  const statusText = uploadState.status === 'paused' ? '已暂停' : uploadState.status === 'failed' ? '上传失败' : uploadState.phase || '正在上传'
  return (
    <div className={`progress-wrap enhanced-progress ${uploadState.status}`}>
      <div className="progress-label"><span>{statusText}</span><strong>{progress}%</strong></div>
      <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
      <div className="upload-metrics">
        <span>已传 {formatBytes(uploadState.uploadedBytes)} / {formatBytes(uploadState.totalBytes)}</span>
        <span>速度 {uploadState.speedBps ? `${formatBytes(uploadState.speedBps)}/s` : '计算中'}</span>
        <span>剩余 {formatDuration(uploadState.etaSeconds)}</span>
      </div>
      {uploadState.currentFile && <small>当前文件：{uploadState.currentFile}</small>}
      {uploadState.retryCount > 0 && <small>已自动重试 {uploadState.retryCount} 次</small>}
      {uploadState.error && <p className="upload-error">{uploadState.error}</p>}
      <div className="upload-control-row">
        {uploadState.status === 'uploading' && <button className="secondary-button" onClick={onPause} disabled={!isUploading}><Pause size={15} /> 暂停</button>}
        {uploadState.status === 'paused' && <button className="primary-button" onClick={onResume}><Play size={15} /> 继续上传</button>}
        {uploadState.status === 'failed' && <button className="primary-button" onClick={onRetry}><RotateCcw size={15} /> 重试上传</button>}
      </div>
    </div>
  )
}

export function ShareResult({ result, settings, onCopy, onCopyQrImage, onReset }) {
  const [qrOpen, setQrOpen] = useState(false)
  return (
    <>
      <div className="share-result">
        <div className="result-topline">
          <span className="success-badge"><Check size={14} /> 上传完成</span>
          <span>{formatExpiry(result.expiresAt)}</span>
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
        <div className="share-link">
          <Link2 size={15} />
          <span>{result.shareUrl}</span>
          <button onClick={() => onCopy(result.shareUrl)} aria-label="复制分享链接"><Copy size={15} /></button>
        </div>
        {result.enterpriseUrl && <div className="share-link enterprise-link"><Building2 size={15} /><span>{result.enterpriseUrl}</span><button onClick={() => onCopy(result.enterpriseUrl)} aria-label="复制企业专属链接"><Copy size={15} /></button></div>}
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
  const delivered = logs.filter((item) => /已发送/.test(item.status || '')).length
  const externalPending = logs.filter((item) => /通道未配置/.test(item.status || '')).length
  const failed = logs.filter((item) => /发送失败/.test(item.status || '')).length
  const skipped = Math.max(logs.length - delivered - externalPending - failed, 0)
  const summary = logs.length
    ? `${delivered ? `${delivered} 个通知已发送` : '暂无通知送达'}${externalPending ? `，${externalPending} 个等待邮件通道配置` : ''}${failed ? `，${failed} 个邮件投递失败` : ''}${skipped ? `，${skipped} 个未投递` : ''}`
    : `已记录 ${result.deliveryRecipients.length} 个通知对象`
  return (
    <div className="notification-list share-notification-status">
      <Mail size={14} />
      <span>{summary}</span>
    </div>
  )
}

export function CollectView({ result, manageData, manageLoading, records, onCreate, onResetResult, onCopy, onCopyQrImage, onOpenManager, onManageSettings, onCloseTask, onReopenTask, onDeleteSubmission, onCloseManager, onRefreshManager, onRefreshRecords }) {
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
    <section className="workspace-page">
      <div className="workspace-heading">
        <div>
          <p className="eyebrow"><span className="eyebrow-dot" /> 多人文件收集</p>
          <h1>让大家把文件交到同一个地方。</h1>
          <p>创建收集任务，分享链接后，提交者无需注册即可上传。</p>
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
                <div className="preview-card">
                  <span className="preview-icon"><Inbox size={20} /></span>
                  <strong>{form.title || '未命名任务'}</strong>
                  <span>{form.description || '请填写收集说明'}</span>
                  <CollectionLimitInfo allowedTypes={form.allowedTypes} maxFileSizeMb={form.maxFileSizeMb} compact />
                  <small>截止 {form.deadline || '未设置'} · 允许匿名提交</small>
                </div>
              </div>
              <div className="builder-form">
                <label>任务名称<input value={form.title} onChange={(event) => update('title', event.target.value)} maxLength={80} placeholder="例如：9 月产品素材收集" /></label>
                <label>收集说明<input value={form.description} onChange={(event) => update('description', event.target.value)} maxLength={500} placeholder="例如：请上传你负责的图片、文档或视频素材" /></label>
                <label>截止时间<DatePicker value={form.deadline} onChange={(value) => update('deadline', value)} ariaLabel="截止时间" /></label>
                <label>文件类型<div className="chip-group">{COLLECTION_TYPE_OPTIONS.map((type) => <button key={type} className={form.allowedTypes.includes(type) ? 'selected' : ''} onClick={() => update('allowedTypes', toggleCollectionType(form.allowedTypes, type))}>{type}</button>)}</div></label>
                <label>单人大小限制<select value={form.maxFileSizeMb} onChange={(event) => update('maxFileSizeMb', Number(event.target.value))}><option value="500">500 MB</option><option value="1024">1 GB</option><option value="5120">5 GB</option></select></label>
                <button className="primary-button wide" onClick={() => onCreate(form)}><Inbox size={16} /> 创建收集任务 <ArrowRight size={15} /></button>
              </div>
            </>
          ) : (
            <CollectionSuccess result={result} onCopy={onCopy} onCopyQrImage={onCopyQrImage} onOpenManager={onOpenManager} onBack={backToCreate} />
          )}
        </div>
      )}
      {!manageData && collectionRecords.length > 0 && (
        <div className="collection-history">
          <div className="collection-history-heading">
            <div><p className="eyebrow">本机保存的任务</p><h2>我的收集任务</h2></div>
            <span>{collectionRecords.length} 个任务</span>
          </div>
          <div className="collection-history-list">
            {collectionRecords.slice(0, 6).map((record, index) => (
              <div className="collection-history-row" key={record.id || `${record.name}-${index}`}>
                <span className="record-icon collect"><Inbox size={17} /></span>
                <div>
                  <strong>{record.name}</strong>
                  <span>{record.meta}</span>
                  <CollectionLimitInfo allowedTypes={record.allowedTypes} maxFileSizeMb={record.maxFileSizeMb} compact />
                </div>
                <div className="collection-history-actions">
                  <button className="secondary-button" disabled={!recordManageUrl(record)} onClick={() => onOpenManager(recordManageUrl(record))}><FolderOpen size={15} /> 查看已收文件</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="collection-note"><ShieldCheck size={17} /><span>提交者之间互不可见，只有创建者通过管理链接查看全部文件。</span></div>
    </section>
  )
}

export function CollectionSuccess({ result, onCopy, onCopyQrImage, onOpenManager, onBack }) {
  const [qrOpen, setQrOpen] = useState(false)

  return (
    <>
      <div className="collection-success">
        <span className="success-large"><Check size={27} /></span>
        <p className="eyebrow">收集任务已创建</p>
        <h2>{result.title}</h2>
        <p>分享下面的链接，参与者即可匿名提交文件。</p>
        <CollectionLimitInfo allowedTypes={result.allowedTypes} maxFileSizeMb={result.maxFileSizeMb} />
        <div className="collection-share"><Link2 size={16} /><strong>{result.publicUrl}</strong><button onClick={() => onCopy(result.publicUrl)} aria-label="复制收集链接"><Copy size={15} /></button></div>
        {result.enterpriseUrl && <div className="collection-share enterprise-link"><Building2 size={16} /><strong>{result.enterpriseUrl}</strong><button onClick={() => onCopy(result.enterpriseUrl)} aria-label="复制企业专属链接"><Copy size={15} /></button></div>}
        {result.qrDataUrl && (
          <button className="qr-trigger" onClick={() => setQrOpen(true)} aria-label="打开收集二维码">
            <img className="collection-qr" src={result.qrDataUrl} alt="收集二维码" />
            <span>点击放大</span>
          </button>
        )}
        <div className="result-actions">
          <button className="secondary-button" onClick={onBack}><ArrowLeft size={15} /> 返回创建</button>
          <button className="secondary-button" onClick={() => onOpenManager(result.manageUrl)}><FolderOpen size={15} /> 查看已收文件</button>
          <button className="primary-button" onClick={() => onCopy(result.manageUrl)}><KeyRound size={15} /> 复制管理链接</button>
        </div>
      </div>
      {qrOpen && (
        <QrPreviewModal
          title="收集二维码"
          detail="分享链接"
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
      {data.submissions.length ? (
        <div className="collection-submissions">
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
              <div className="submission-files">{submission.files.map((file, fileIndex) => <div className="submission-file" key={`${submission.id}-${file.relativePath}`}><FileText size={15} /><span>{file.name}</span><small>{formatBytes(file.size)}</small>{canPreviewFile(file) && <button className="ghost-icon" aria-label={`预览 ${file.name}`} onClick={() => previewFile(submission, fileIndex)}><Eye size={15} /></button>}<button className="ghost-icon" aria-label={`下载 ${file.name}`} onClick={() => downloadFile(submission, fileIndex)} disabled={downloadBusy}><Download size={15} /></button></div>)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-manage collection-empty"><Inbox size={25} /><span>暂时还没有人提交文件</span></div>
      )}
      {data.submissions.length > 0 && <button className="primary-button wide" onClick={downloadAll} disabled={downloadBusy}><Download size={16} /> 打包下载全部提交</button>}
      <DownloadProgressPanel task={downloadTask} onRetry={retryDownload} />
      {previewItem && <FilePreviewModal preview={previewItem} onClose={() => setPreviewItem(null)} onDownload={() => startDownload(previewItem.downloadConfig)} downloadDisabled={downloadBusy} />}
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
              {result.requiresPassword && <input className="modal-inline-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') verify() }} placeholder="请输入提取密码" />}
              {result.requiresPassword && <button className="secondary-button verify-button" onClick={verify}>验证密码</button>}
              {share.files.length > 0 && (
                <div className="public-files compact">
                  {share.files.map((file, fileIndex) => <FileRow key={file.relativePath} file={file} onPreview={canPreviewFile(file) && !result.requiresPassword ? () => previewFile(file, fileIndex) : null} onDownload={() => downloadFile(file, fileIndex)} downloadDisabled={downloadBusy || result.requiresPassword} />)}
                </div>
              )}
              {!result.requiresPassword && <button className="primary-button wide" onClick={downloadAll} disabled={downloadBusy || !(share?.files || []).length}><Download size={16} /> {(share?.files || []).length > 1 ? '下载全部文件' : '下载文件'}</button>}
              <DownloadProgressPanel task={downloadTask} onRetry={retryDownload} />
              {error && <p className="public-message">{error}</p>}
              {previewItem && <FilePreviewModal preview={previewItem} onClose={() => setPreviewItem(null)} onDownload={() => startDownload(previewItem.downloadConfig)} downloadDisabled={downloadBusy} />}
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
            <div className="option-grid">{[['1 天', '1'], ['3 天', '3'], ['7 天', '7'], ['永久', '0']].map(([label, value]) => <button key={value} disabled={value === '0' && !canUsePermanent} className={settings.expiryDays === value ? 'selected' : ''} onClick={() => updateExpiry(label, value)} title={value === '0' && !canUsePermanent ? '会员版或更高权益可用' : ''}>{label}{settings.expiryDays === value && <Check size={14} />}</button>)}</div>
            {!canUsePermanent && <small className="setting-hint">永久保存需要会员版或更高权益，当前会按普通有效期创建。</small>}
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
          {settings.passwordEnabled && <label className="password-field"><span>密码内容</span><input className="modal-inline-input" type="password" value={settings.password} onChange={(event) => setSettings({ ...settings, password: event.target.value })} placeholder="例如：QK2026" /></label>}
        </div>
        <div className="modal-footer"><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" onClick={onSave}><Save size={15} /> 保存设置</button></div>
      </div>
    </div>
  )
}

export function settingsSectionForPath(pathname = '') {
  const section = pathname.split('/')[2]
  return SETTINGS_NAV_ITEMS.some((item) => item.key === section) ? section : 'profile'
}

export function NavItem({ icon: Icon, label, active, onClick }) { return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}><Icon size={17} strokeWidth={2} /><span>{label}</span></button> }

export function MessageCenter({ user, messages, open, onToggle, onClose, onMarkRead, onMarkAllRead, onDelete, onClearAll, onLogin, onInvitationAction }) {
  const unreadCount = messages.filter((message) => message.unread).length
  // 长消息默认两行截断，点击展开/收起完整正文（展开的同时保留标已读行为）
  const [expandedIds, setExpandedIds] = useState(() => new Set())
  // 取件码复制反馈：{ code, ok }，1.8s 后自动清除
  const [codeFeedback, setCodeFeedback] = useState(null)
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
    window.setTimeout(() => setCodeFeedback((current) => (current && current.code === code ? null : current)), 1800)
  }
  const copyMessageCode = async (message, code) => {
    if (!code) return
    try {
      await copyTextToClipboard(code)
      flashCodeFeedback(code, true)
      onMarkRead?.(message)
    } catch {
      flashCodeFeedback(code, false)
    }
  }
  const openMessageAction = (message) => {
    if (!message.actionUrl) return
    onMarkRead?.(message)
    window.location.href = message.actionUrl
  }

  useEffect(() => {
    if (!open) return undefined
    window.addEventListener('click', onClose)
    return () => window.removeEventListener('click', onClose)
  }, [open, onClose])

  return (
    <div className="message-center-wrap">
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

export function AuthButton({ user, loading, menuOpen, onLogin, onToggleMenu, onSettings, onLogout }) {
  if (!user) {
    return <button className="login-button" aria-label={loading ? '检查登录状态' : '登录'} onClick={onLogin} disabled={loading}><UserRound size={18} /><span>{loading ? '检查登录' : '登录'}</span><ChevronDown size={14} /></button>
  }
  return (
    <div className="auth-menu-wrap">
      <button className="login-button signed-in" aria-label="个人中心" onClick={onToggleMenu} aria-haspopup="menu" aria-expanded={menuOpen}>
        <UserAvatar user={user} />
        <span>{displayUserName(user)}</span>
        <ChevronDown size={14} />
      </button>
      {menuOpen && (
        <div className="auth-menu" role="menu" onClick={(event) => event.stopPropagation()}>
          <div className="auth-menu-profile">
            <UserAvatar user={user} />
            <div><strong>{displayUserName(user)}</strong><span>{displayUserSubtitle(user)}</span></div>
          </div>
          <button role="menuitem" onClick={onSettings}><Settings2 size={14} /> 账户设置</button>
          <button className="mobile-workspace-link" role="menuitem" onClick={() => { window.location.href = '/workspace' }}><Building2 size={14} /> 会员与团队空间</button>
          <button role="menuitem" onClick={onLogout}><LogOut size={14} /> 退出登录</button>
        </div>
      )}
    </div>
  )
}
