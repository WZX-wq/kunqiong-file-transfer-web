import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import mammoth from 'mammoth'
import { sanitizeOfficeHtml } from './office-html.js'
import * as XLSX from 'xlsx'
import { PPTXViewer } from 'pptxviewjs'
import QRCode from 'qrcode'
import {
  ArrowRight,
  ArrowLeft,
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Cloud,
  Copy,
  Download,
  Eye,
  ExternalLink,
  FileArchive,
  FileCheck2,
  FileText,
  FolderOpen,
  Gauge,
  History,
  Image as ImageIcon,
  Inbox,
  KeyRound,
  Link2,
  LockKeyhole,
  LogOut,
  Mail,
  Megaphone,
  MessageCircle,
  MoreHorizontal,
  Pause,
  Play,
  QrCode,
  Search,
  RefreshCw,
  RotateCcw,
  Send,
  Settings2,
  ShieldCheck,
  ClipboardCheck,
  Sparkles,
  HardDrive,
  ListChecks,
  PencilLine,
  Trash2,
  UploadCloud,
  UserRound,
  UserPlus,
  Users,
  Database,
  SlidersHorizontal,
  Crown,
  X,
  Zap,
  Save,
  HelpCircle,
  FileWarning,
  BadgeCheck,
  MailCheck,
  UserCheck,
  UserX,
  Eraser,
  ScanLine,
  Wallet,
} from 'lucide-react'
import './styles.css'

const MAX_FILES = 100
const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024
const defaultSettings = {
  expiry: '3 天',
  expiryDays: '3',
  downloads: '不限次数',
  downloadLimit: 'unlimited',
  customDownloadLimit: '5',
  codeLength: '6',
  recipients: '',
  passwordEnabled: false,
  password: '',
}

const createDefaultCollectionForm = () => ({
  title: '',
  description: '',
  deadline: defaultDeadline(10),
  allowedTypes: ['全部格式'],
  maxFileSizeMb: 500,
})

const COLLECTION_TYPE_OPTIONS = ['全部格式', '图片', '文档', '视频', '音频', '压缩包', '代码文件', '其他']
const COLLECTION_TYPE_EXTENSIONS = {
  图片: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif', 'ico'],
  文档: ['pdf', 'doc', 'docx', 'txt', 'rtf', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'md'],
  视频: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', 'ogv', 'flv', 'wmv'],
  音频: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'oga', 'ogg', 'wma'],
  压缩包: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'],
  代码文件: ['js', 'jsx', 'ts', 'tsx', 'html', 'css', 'json', 'xml', 'yml', 'yaml', 'java', 'py', 'go', 'php', 'rb', 'rs', 'c', 'cpp', 'h', 'cs', 'sh', 'ps1', 'bat', 'cmd', 'sql'],
}
const COLLECTION_TYPE_CATEGORY_KEYS = {
  图片: 'image',
  文档: 'document',
  视频: 'video',
  音频: 'audio',
  压缩包: 'archive',
  代码文件: 'code',
  其他: 'other',
}

const FOOTER_CONTENT = {
  help: {
    eyebrow: '使用帮助',
    title: '帮助中心',
    sections: [
      {
        title: '发送文件',
        items: [
          '在“发文件”页面选择文件或文件夹，也可以直接拖拽到上传区域。',
          '上传完成后系统会生成取件码、分享链接和二维码，对方无需注册即可提取。',
          '单次最多 100 个文件；登录后单文件最大 5 GB，未登录 500 MB。大文件会自动分片上传，异常中断后可重试。',
        ],
      },
      {
        title: '收集文件',
        items: [
          '通过“收集文件”创建收集任务，设置截止日期、允许类型和单文件大小限制。',
          '提交人打开收集链接后上传文件，文件会进入你的收集记录和管理页。',
          '如需停止收集，可在收发记录或管理窗口中关闭任务，后续也可以重新开启。',
        ],
      },
      {
        title: '账号与记录',
        items: [
          '登录后，收发记录、容量使用和基础账号资料会同步到当前鲲穹账号。',
          '游客模式下的记录仅保存在当前浏览器，清理浏览器数据后可能无法恢复。',
          '如果遇到上传、下载或登录异常，请刷新页面后重试，并确认服务端地址配置正确。',
        ],
      },
    ],
  },
  terms: {
    eyebrow: '平台规则',
    title: '服务协议',
    sections: [
      {
        title: '服务范围',
        items: [
          '鲲穹文件传输提供临时文件发送、取件码分享、文件收集、记录管理和基础账号同步能力。',
          '本服务用于合法、合规的文件传输场景，不承诺作为长期备份、归档或容灾存储使用。',
          '部分高级能力可能需要会员版、团队版或企业版权益，具体以页面展示和实际配置为准。',
        ],
      },
      {
        title: '用户义务',
        items: [
          '你应确保上传、分享和收集的文件拥有合法权利，不侵犯他人知识产权、隐私权或其他合法权益。',
          '禁止上传违法违规、恶意程序、钓鱼欺诈、侵害他人权益或破坏服务安全稳定的内容。',
          '你需要妥善保管取件码、管理链接和账号登录状态，由泄露导致的访问风险由分享者自行承担。',
        ],
      },
      {
        title: '服务限制',
        items: [
          '平台可能根据容量、文件大小、有效期、安全审核或系统维护需要限制、暂停或清理相关文件。',
          '因不可抗力、网络故障、第三方服务异常或用户配置错误导致的服务中断，平台会尽力恢复但不承担超出法律规定的责任。',
          '继续使用本服务即表示你理解并接受当前协议内容；正式商业版本上线后可能更新协议条款。',
        ],
      },
    ],
  },
  privacy: {
    eyebrow: '数据保护',
    title: '隐私政策',
    sections: [
      {
        title: '我们处理的信息',
        items: [
          '为完成文件传输，我们会处理上传文件、文件名、大小、类型、分享设置、取件码、收集任务和提交记录。',
          '登录后会保存账号标识、昵称、头像、邮箱或手机号等必要账户资料，以及容量和消息通知设置。',
          '系统可能记录访问时间、IP、接口路径和操作结果，用于安全审计、故障排查和服务稳定性维护。',
        ],
      },
      {
        title: '使用与保存',
        items: [
          '文件默认按你设置的有效期保存，到期或被删除后会进入清理流程；会员或团队能力以实际权益为准。',
          '头像等个人资料仅用于账户展示；自定义头像优先显示，恢复后会回到第三方登录头像或默认头像。',
          '未配置 SMTP 等第三方通道时，邮件通知只做本地记录，不会向外部邮箱发送真实邮件。',
        ],
      },
      {
        title: '安全与控制',
        items: [
          '我们通过登录会话、管理链接、提取密码、访问校验和文件格式标签降低误访问风险。',
          '你可以删除分享、关闭收集任务、恢复登录头像或退出登录，以管理自己的内容和账户状态。',
          '如部署到测试或正式服务器，请妥善配置访问域名、回调地址、管理员账号和邮件服务参数。',
        ],
      },
    ],
  },
}

const fileIcon = (name = '') => {
  if (/\.(zip|rar|7z|tar|gz)$/i.test(name)) return FileArchive
  if (/\.(pdf|doc|docx|txt|xls|xlsx|ppt|pptx)$/i.test(name)) return FileText
  return FileCheck2
}

const MAIN_VIEWS = new Set(['send', 'collect', 'records'])

function normalizeMainView(value) {
  return MAIN_VIEWS.has(value) ? value : 'send'
}

function mainViewUrl(view) {
  return view === 'send' ? '/' : `/?view=${encodeURIComponent(view)}`
}

function App() {
  const route = window.location.pathname
  if (route.startsWith('/admin')) return <AdminPage />
  if (route.startsWith('/team')) return <TeamPage />
  if (route.startsWith('/workspace')) return <WorkspacePage />
  if (route.startsWith('/e/')) {
    const parts = route.split('/').filter(Boolean)
    if (parts[2] === 'share') {
      // 带 token → 正常的企业分享页；
      // 不带 token（/e/<slug>/share/）→ 团队邀请链接，渲染入团落地页。
      if (parts[3]) return <SharePage token={parts[3]} enterpriseSlug={parts[1]} />
      return <TeamInvitePage slug={parts[1]} />
    }
    if (parts[2] === 'collect') {
      if (parts[3]) return <CollectionSubmitPage token={parts[3]} enterpriseSlug={parts[1]} />
      return <TeamInvitePage slug={parts[1]} />
    }
    // /e/<slug> 或 /e/<slug>/ 也视为团队邀请入口，避免复制链接时丢掉尾段就失效。
    if (parts[1]) return <TeamInvitePage slug={parts[1]} />
  }
  if (route.startsWith('/share/manage/')) return <ShareManagePage token={route.split('/')[3]} />
  if (route.startsWith('/share/')) return <SharePage token={route.split('/')[2]} />
  if (route.startsWith('/collect/manage/')) return <CollectionManagePage token={route.split('/')[3]} />
  if (route.startsWith('/collect/')) return <CollectionSubmitPage token={route.split('/')[2]} />
  return <WorkspaceApp />
}

function useConfirmDialog() {
  const [confirmState, setConfirmState] = useState(null)
  const resolverRef = useRef(null)

  useEffect(() => () => {
    if (resolverRef.current) resolverRef.current(false)
  }, [])

  const requestConfirm = (options = {}) => new Promise((resolve) => {
    resolverRef.current = resolve
    setConfirmState({
      eyebrow: '操作确认',
      confirmText: '确定',
      cancelText: '取消',
      tone: 'default',
      ...options,
    })
  })

  const settleConfirm = (confirmed) => {
    const resolve = resolverRef.current
    resolverRef.current = null
    setConfirmState(null)
    resolve?.(confirmed)
  }

  return { confirmState, requestConfirm, settleConfirm }
}

function WorkspaceApp() {
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

function GuestQuotaModal({ quota, onClose, onLogin }) {
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

function Toast({ message }) {
  const tone = feedbackTone(message)
  const Icon = tone === 'error' ? XCircle : CheckCircle2
  return (
    <div className={`toast ${tone}`} role={tone === 'error' ? 'alert' : 'status'} aria-live={tone === 'error' ? 'assertive' : 'polite'}>
      <span className="toast-icon"><Icon size={18} /></span>
      <span>{message}</span>
    </div>
  )
}

function FeedbackMessage({ message, tone = 'error' }) {
  const Icon = tone === 'success' ? CheckCircle2 : XCircle
  return (
    <p className={`public-message feedback-message ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon size={16} />
      <span>{message}</span>
    </p>
  )
}

function feedbackTone(message = '') {
  return /失败|错误|无效|不可用|不能|无法|不能为空|不足|过期|不正确|未配置|未生效|拒绝|异常|请先|请输入|未登录|未投递|不存在|已失效|没有可|不支持|通道|需接入|暂不|暂无|暂未|尚未|需要会员|更高权益/.test(String(message)) ? 'error' : 'success'
}

function SendView({ files, inputRef, folderInputRef, isDragging, setIsDragging, addFiles, removeFile, uploadFiles, isUploading, uploadProgress, uploadState, shareResult, settings, onUpdateSettings, onSettings, onPause, onResume, onRetry, onReset, onCopy, onCopyQrImage, onRetrieve, guestQuota, onLogin }) {
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
                    <span>未登录累计可传 <strong>{formatBytes(guestQuota.limitBytes)}</strong>，本设备已用 {formatBytes(guestQuota.usedBytes)}，剩余 <strong>{formatBytes(guestQuota.remainingBytes)}</strong></span>
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

function UploadProgressPanel({ progress, uploadState, isUploading, onPause, onResume, onRetry }) {
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

function DownloadProgressPanel({ task, onRetry }) {
  if (!task || task.status === 'idle') return null
  if (task.status === 'handed_off') return <div className="progress-wrap download-progress"><div className="progress-label"><span>已交给浏览器下载</span><Download size={16} /></div>{task.filename && <small>{task.filename}</small>}</div>
  const busy = ['preparing', 'downloading', 'saving'].includes(task.status)
  const statusText = downloadStatusText(task)
  const remainingText = task.status === 'complete' ? '已完成' : formatDuration(task.etaSeconds)
  const progress = task.totalBytes ? Math.min(100, Math.max(0, task.progress || 0)) : task.status === 'complete' ? 100 : task.progress || 0
  const trackWidth = task.totalBytes || task.status === 'complete' ? progress : busy ? 18 : 0
  return (
    <div className={`progress-wrap enhanced-progress download-progress ${task.status}`}>
      <div className="progress-label"><span>{statusText}</span><strong>{task.totalBytes ? `${progress}%` : formatBytes(task.loadedBytes)}</strong></div>
      <div className="progress-track"><span style={{ width: `${trackWidth}%` }} /></div>
      <div className="upload-metrics">
        <span>已下 {formatBytes(task.loadedBytes)}{task.totalBytes ? ` / ${formatBytes(task.totalBytes)}` : ''}</span>
        <span>速度 {task.speedBps ? `${formatBytes(task.speedBps)}/s` : '计算中'}</span>
        <span>{task.status === 'complete' ? '状态' : '剩余'} {remainingText}</span>
      </div>
      {task.filename && <small>文件：{task.filename}</small>}
      {task.canResume && <small>单文件服务端已开启 Range，可被浏览器用于断点续传。</small>}
      {task.isEstimated && <small>ZIP 为实时压缩生成，进度按原文件大小估算。</small>}
      {task.retryCount > 0 && <small>已重试 {task.retryCount} 次</small>}
      {task.status === 'complete' && <small>已调用浏览器保存，请在下载列表查看。</small>}
      {task.error && <p className="upload-error">{task.error}</p>}
      {task.status === 'failed' && (
        <div className="upload-control-row">
          <button className="primary-button" onClick={onRetry}><RotateCcw size={15} /> 重试下载</button>
        </div>
      )}
    </div>
  )
}

function ShareResult({ result, settings, onCopy, onCopyQrImage, onReset }) {
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

function ShareNotificationStatus({ result }) {
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

function QrPreviewModal({ title, detail, qrDataUrl, targetUrl, onClose, onCopyImage, onCopyLink }) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal qr-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="qr-modal-body">
          <p className="eyebrow">二维码预览</p>
          <h2>{title}</h2>
          <p>{detail}</p>
          <img className="qr-preview-image" src={qrDataUrl} alt={title} />
          <div className="qr-preview-link"><Link2 size={14} /><span>{targetUrl}</span></div>
        </div>
        <div className="modal-footer qr-modal-footer">
          <button className="secondary-button" onClick={onCopyLink}><Copy size={15} /> 复制链接</button>
          <button className="primary-button" onClick={onCopyImage}><Copy size={15} /> 复制图片</button>
        </div>
      </div>
    </div>
  )
}

function AdminLoginModal({ onSubmit, busy = false, error = '', onBackHome }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const submit = (event) => {
    event.preventDefault()
    if (busy || !username.trim() || !password) return
    onSubmit({ username: username.trim(), password })
  }

  return (
    <div className="modal-backdrop admin-login-backdrop">
      <form className="modal confirm-modal admin-login-modal" role="dialog" aria-modal="true" aria-labelledby="admin-login-title" onSubmit={submit}>
        <div className="admin-login-icon"><ShieldCheck size={22} /></div>
        <p className="eyebrow">运营后台</p>
        <h2 id="admin-login-title">管理员登录</h2>
        <p>请输入后台管理员账号与密码，验证通过后可进入系统管理。</p>
        <div className="admin-login-fields">
          <label className="admin-login-field">
            <span><UserRound size={14} /> 账号</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="请输入管理员账号"
              autoComplete="username"
              autoFocus
              disabled={busy}
            />
          </label>
          <label className="admin-login-field">
            <span><LockKeyhole size={14} /> 密码</span>
            <div className="admin-login-password">
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type={showPassword ? 'text' : 'password'}
                placeholder="请输入管理员密码"
                autoComplete="current-password"
                disabled={busy}
              />
              <button type="button" className="ghost-icon" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? '隐藏密码' : '显示密码'} title={showPassword ? '隐藏密码' : '显示密码'}>
                <Eye size={15} />
              </button>
            </div>
          </label>
        </div>
        {error && <p className="admin-login-error" role="alert"><XCircle size={14} /> {error}</p>}
        <div className="modal-footer confirm-modal-footer admin-login-footer">
          <button type="button" className="secondary-button" onClick={onBackHome}><ChevronLeft size={15} /> 返回首页</button>
          <button type="submit" className="primary-button" disabled={busy || !username.trim() || !password}>
            {busy ? <><span className="button-spinner" /> 正在验证…</> : <><KeyRound size={15} /> 登录后台</>}
          </button>
        </div>
      </form>
    </div>
  )
}

function ConfirmModal({ state, onCancel, onConfirm }) {
  useEffect(() => {
    if (!state) return undefined
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [state, onCancel])

  if (!state) return null

  const Icon = state.tone === 'danger' ? Trash2 : ShieldCheck
  return (
    <div className="modal-backdrop confirm-backdrop" onMouseDown={onCancel}>
      <div className={`modal confirm-modal ${state.tone === 'danger' ? 'danger' : ''}`} role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <div className="confirm-modal-icon"><Icon size={20} /></div>
        <p className="eyebrow">{state.eyebrow || '操作确认'}</p>
        <h2>{state.title || '确认操作'}</h2>
        {state.subject && <p className="confirm-modal-subject" title={state.subject}>{state.subject}</p>}
        {state.detail && <p>{state.detail}</p>}
        <div className="modal-footer confirm-modal-footer">
          <button className="secondary-button" onClick={onCancel}>{state.cancelText || '取消'}</button>
          <button className={`primary-button ${state.tone === 'danger' ? 'danger-button' : ''}`} onClick={onConfirm}>{state.confirmText || '确定'}</button>
        </div>
      </div>
    </div>
  )
}

function ContentModal({ content, onClose }) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  if (!content) return null

  return (
    <div className="modal-backdrop content-backdrop" onMouseDown={onClose}>
      <div className="modal content-modal" role="dialog" aria-modal="true" aria-labelledby="content-modal-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header content-modal-header">
          <div><p className="eyebrow">{content.eyebrow}</p><h2 id="content-modal-title">{content.title}</h2></div>
          <button className="ghost-icon modal-close" aria-label={`关闭${content.title}`} onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body content-modal-body">
          {content.sections.map((section) => (
            <section className="content-section" key={section.title}>
              <h3>{section.title}</h3>
              <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul>
            </section>
          ))}
        </div>
        <div className="modal-footer">
          <button className="primary-button" onClick={onClose}><Check size={15} /> 我知道了</button>
        </div>
      </div>
    </div>
  )
}

function FilePreviewModal({ preview, onClose, onDownload, downloadDisabled = false }) {
  const [error, setError] = useState('')
  const [downloadError, setDownloadError] = useState('')

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  if (!preview) return null
  const file = preview.file || {}
  const handleDownload = async () => {
    if (!onDownload) return
    setDownloadError('')
    try {
      const result = await onDownload()
      if (result?.ok === false) setDownloadError(result.error || '下载失败')
    } catch (downloadException) {
      setDownloadError(downloadException.message || '下载失败')
    }
  }
  return (
    <div className="modal-backdrop preview-backdrop" onMouseDown={onClose}>
      <div className={`modal preview-modal ${preview.kind}`} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header preview-modal-header">
          <div>
            <p className="eyebrow">{previewTypeLabel(preview.kind)}预览</p>
            <h2>{file.name || '文件预览'}</h2>
            <span className="preview-meta">{file.relativePath || file.name} · {formatBytes(file.size)}</span>
          </div>
          <button className="ghost-icon modal-close" aria-label="关闭预览" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="preview-modal-body">
          {error ? <div className="preview-error"><FileText size={28} /><strong>预览加载失败</strong><span>{error}</span></div> : renderPreviewContent(preview, () => setError('浏览器无法打开这个文件，可下载后查看。'))}
        </div>
        <div className="modal-footer preview-modal-footer">
          <span>{previewSupportLabel(preview.kind)}</span>
          {downloadError && <FeedbackMessage message={downloadError} tone="error" />}
          <button className="secondary-button" onClick={handleDownload} disabled={downloadDisabled}><Download size={15} /> 下载文件</button>
        </div>
      </div>
    </div>
  )
}

function RecordPreviewChooser({ previews, onClose, onSelect }) {
  return (
    <div className="modal-backdrop preview-backdrop" onMouseDown={onClose}>
      <div className="modal record-preview-chooser" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">文件预览</p>
            <h2>选择要预览的文件</h2>
          </div>
          <button className="ghost-icon modal-close" aria-label="关闭文件选择" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="record-preview-options">
          {previews.map((preview) => (
            <button type="button" className="record-preview-option" key={preview.key} onClick={() => onSelect(preview)}>
              <span className="record-preview-option-icon"><FileText size={17} /></span>
              <span><strong>{preview.file.name}</strong><small>{previewTypeLabel(preview.kind)} · {formatBytes(preview.file.size)}</small></span>
              <ChevronRight size={16} />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function renderPreviewContent(preview, onError) {
  const title = preview.file?.name || '文件预览'
  if (preview.kind === 'image') return <img className="preview-image" src={preview.url} alt={title} onError={onError} />
  if (preview.kind === 'pdf') return <iframe className="preview-frame" src={preview.url} title={title} onError={onError} />
  if (preview.kind === 'video') return <video className="preview-video" src={preview.url} controls preload="metadata" onError={onError} />
  if (preview.kind === 'audio') {
    return (
      <div className="preview-audio-shell">
        <span className="preview-audio-icon"><FileText size={28} /></span>
        <strong>{title}</strong>
        <audio className="preview-audio" src={preview.url} controls preload="metadata" onError={onError} />
      </div>
    )
  }
  if (preview.kind === 'document' || preview.kind === 'spreadsheet' || preview.kind === 'presentation') {
    return <OfficePreview preview={preview} onError={onError} />
  }
  if (preview.kind === 'text') return <TextPreview preview={preview} onError={onError} />
  return <div className="preview-error"><FileText size={28} /><strong>暂不支持预览</strong><span>请下载后查看这个文件。</span></div>
}

const TEXT_PREVIEW_MAX_BYTES = 512 * 1024

function TextPreview({ preview }) {
  const [state, setState] = useState({ status: 'loading', content: '', truncated: false, error: '' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading', content: '', truncated: false, error: '' })
    const loadPreview = async () => {
      try {
        const response = await fetch(preview.url, { credentials: 'include' })
        if (!response.ok) throw new Error(`预览请求失败（${response.status}）`)
        const buffer = await response.arrayBuffer()
        if (cancelled) return
        const truncated = buffer.byteLength > TEXT_PREVIEW_MAX_BYTES
        const sliced = truncated ? buffer.slice(0, TEXT_PREVIEW_MAX_BYTES) : buffer
        const content = new TextDecoder('utf-8', { fatal: false }).decode(sliced)
        if (!cancelled) setState({ status: 'ready', content, truncated, error: '' })
      } catch (error) {
        if (!cancelled) setState({ status: 'error', content: '', truncated: false, error: error.message || '文件解析失败' })
      }
    }
    loadPreview()
    return () => { cancelled = true }
  }, [preview.url])

  if (state.status === 'loading') return <div className="office-preview-loading"><span className="loading-dot" /><strong>正在生成预览</strong><span>文件只在当前浏览器中解析，不会自动下载。</span></div>
  if (state.status === 'error') return <div className="preview-error"><FileText size={28} /><strong>预览加载失败</strong><span>{state.error}</span></div>
  return (
    <div className="text-preview-shell">
      {state.truncated && <div className="text-preview-truncated">文件较大，仅显示前 512 KB，完整内容请下载查看。</div>}
      <pre className="text-preview">{state.content}</pre>
    </div>
  )
}

function OfficePreview({ preview }) {
  const [state, setState] = useState({ status: 'loading', html: '', workbook: null, sheets: [], activeSheet: 0, error: '' })
  const canvasRef = useRef(null)
  const viewerRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    const loadPreview = async () => {
      try {
        const response = await fetch(preview.url, { credentials: 'include' })
        if (!response.ok) throw new Error(`预览请求失败（${response.status}）`)
        const buffer = await response.arrayBuffer()
        if (cancelled) return
        if (preview.kind === 'document') {
          const result = await mammoth.convertToHtml({ arrayBuffer: buffer })
          if (!result.value.trim()) throw new Error('文档没有可显示的正文内容')
          if (!cancelled) setState({ status: 'ready', html: sanitizeOfficeHtml(result.value), workbook: null, sheets: [], error: '' })
          return
        }
        if (preview.kind === 'spreadsheet') {
          const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
          const sheets = workbook.SheetNames.map((name) => ({
            name,
            html: sanitizeOfficeHtml(spreadsheetSheetHtml(workbook.Sheets[name])),
          }))
          if (!sheets.length) throw new Error('表格中没有可显示的工作表')
          if (!cancelled) setState({ status: 'ready', html: '', workbook, sheets, activeSheet: 0, error: '' })
          return
        }
        if (preview.kind === 'presentation') {
          if (!canvasRef.current) throw new Error('演示文稿画布初始化失败')
          const viewer = new PPTXViewer({ canvas: canvasRef.current })
          viewerRef.current = viewer
          await viewer.loadFile(buffer)
          await viewer.render()
          if (!cancelled) setState({ status: 'ready', html: '', workbook: null, sheets: [], error: '' })
        }
      } catch (error) {
        if (!cancelled) setState({ status: 'error', html: '', workbook: null, sheets: [], error: error.message || '文件解析失败' })
      }
    }
    loadPreview()
    return () => {
      cancelled = true
      viewerRef.current?.destroy?.()
      viewerRef.current = null
    }
  }, [preview.url, preview.kind])

  if (preview.kind === 'presentation') {
    return (
      <div className="presentation-preview">
        <canvas ref={canvasRef} />
        {state.status === 'loading' && <div className="office-preview-overlay"><span className="loading-dot" /><strong>正在生成预览</strong><span>文件只在当前浏览器中解析，不会自动下载。</span></div>}
        {state.status === 'error' && <div className="office-preview-overlay preview-error"><FileText size={28} /><strong>预览加载失败</strong><span>{state.error}</span></div>}
      </div>
    )
  }
  if (state.status === 'loading') return <div className="office-preview-loading"><span className="loading-dot" /><strong>正在生成预览</strong><span>文件只在当前浏览器中解析，不会自动下载。</span></div>
  if (state.status === 'error') return <div className="preview-error"><FileText size={28} /><strong>预览加载失败</strong><span>{state.error}</span></div>
  if (preview.kind === 'document') return <article className="document-preview" dangerouslySetInnerHTML={{ __html: state.html }} />
  if (preview.kind === 'spreadsheet') {
    return (
      <div className="spreadsheet-preview">
        <div className="spreadsheet-tabs">{state.sheets.map((sheet, index) => <span className={index === state.activeSheet ? 'active' : ''} key={sheet.name} onClick={() => setState((prev) => ({ ...prev, activeSheet: index }))}>{sheet.name}</span>)}</div>
        {state.sheets.map((sheet, index) => <div className="spreadsheet-sheet" key={sheet.name} style={{ display: index === state.activeSheet ? 'block' : 'none' }} dangerouslySetInnerHTML={{ __html: sheet.html }} />)}
      </div>
    )
  }
  return null
}

function spreadsheetSheetHtml(sheet) {
  if (!sheet || typeof sheet !== 'object') return '<div class="spreadsheet-empty">此工作表为空</div>'
  try {
    const range = sheet['!ref']
    if (!range) return '<div class="spreadsheet-empty">此工作表为空</div>'
    return XLSX.utils.sheet_to_html(sheet, { editable: false, header: '', footer: '' })
  } catch (error) {
    console.warn('表格工作表渲染失败', error)
    return '<div class="spreadsheet-empty">此工作表无法预览，请下载文件查看。</div>'
  }
}

function CollectionLimitInfo({ allowedTypes, maxFileSizeMb, compact = false }) {
  return (
    <div className={`collection-limit ${compact ? 'compact' : ''}`}>
      <span>文件类型：{formatAllowedTypes(allowedTypes)}</span>
      <span>单人上限：{formatLimitSize(maxFileSizeMb)}</span>
    </div>
  )
}

function DatePicker({ value, onChange, ariaLabel, placeholder = '选择日期', className = '' }) {
  const pickerRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [viewDate, setViewDate] = useState(() => startOfMonth(parseLocalDate(value) || new Date()))

  useEffect(() => {
    if (value) setViewDate(startOfMonth(parseLocalDate(value) || new Date()))
  }, [value])

  useEffect(() => {
    if (!open) return undefined
    const handleOutsideClick = (event) => {
      if (!pickerRef.current?.contains(event.target)) setOpen(false)
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('click', handleOutsideClick)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('click', handleOutsideClick)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const monthStart = startOfMonth(viewDate)
  const leadingDays = (monthStart.getDay() + 6) % 7
  const calendarDays = Array.from({ length: 42 }, (_, index) => {
    const day = index - leadingDays + 1
    return new Date(monthStart.getFullYear(), monthStart.getMonth(), day)
  })
  const todayValue = formatDateInput(new Date())
  const monthLabel = `${monthStart.getFullYear()}年${monthStart.getMonth() + 1}月`

  const chooseDate = (date) => {
    onChange(formatDateInput(date))
    setOpen(false)
  }

  const setToday = () => chooseDate(new Date())
  const clearDate = () => {
    onChange('')
    setOpen(false)
  }

  return (
    <div className={`date-picker ${className}`} ref={pickerRef}>
      <button type="button" className={`date-picker-trigger ${open ? 'open' : ''}`} aria-label={ariaLabel} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <CalendarDays size={15} />
        <span className={value ? '' : 'placeholder'}>{value ? formatDateInputDisplay(value) : placeholder}</span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="date-picker-popover" role="dialog" aria-label={`${ariaLabel}日期选择`}>
          <div className="date-picker-header">
            <button type="button" className="date-picker-nav" aria-label="上个月" title="上个月" onClick={() => setViewDate((current) => addMonths(current, -1))}><ChevronLeft size={16} /></button>
            <strong>{monthLabel}</strong>
            <button type="button" className="date-picker-nav" aria-label="下个月" title="下个月" onClick={() => setViewDate((current) => addMonths(current, 1))}><ChevronRight size={16} /></button>
          </div>
          <div className="date-picker-weekdays">{['一', '二', '三', '四', '五', '六', '日'].map((day) => <span key={day}>{day}</span>)}</div>
          <div className="date-picker-grid">
            {calendarDays.map((date) => {
              const dateValue = formatDateInput(date)
              const isCurrentMonth = date.getMonth() === monthStart.getMonth()
              const isSelected = dateValue === value
              const isToday = dateValue === todayValue
              return (
                <button type="button" key={dateValue} className={`date-picker-day ${isCurrentMonth ? '' : 'outside'} ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''}`} onClick={() => chooseDate(date)}>
                  {date.getDate()}
                </button>
              )
            })}
          </div>
          <div className="date-picker-footer">
            <button type="button" onClick={clearDate} disabled={!value}>清除</button>
            <button type="button" onClick={setToday}>今天</button>
          </div>
        </div>
      )}
    </div>
  )
}

function CollectView({ result, manageData, manageLoading, records, onCreate, onResetResult, onCopy, onCopyQrImage, onOpenManager, onManageSettings, onCloseTask, onReopenTask, onDeleteSubmission, onCloseManager, onRefreshManager, onRefreshRecords }) {
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
                <label>任务名称<input value={form.title} onChange={(event) => update('title', event.target.value)} placeholder="例如：9 月产品素材收集" /></label>
                <label>收集说明<input value={form.description} onChange={(event) => update('description', event.target.value)} placeholder="例如：请上传你负责的图片、文档或视频素材" /></label>
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

function CollectionSuccess({ result, onCopy, onCopyQrImage, onOpenManager, onBack }) {
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

function CollectionFilesPanel({ data, onClose, onRefresh, onManageSettings, onCloseTask, onReopenTask, onDeleteSubmission, onCopy, onCopyQrImage }) {
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

// 分享/收集页底部的「申请加入团队」入口：通过企业专属链接访问时，登录用户可直接向团队所有者发起入团申请。
function TeamJoinRequestCard({ enterpriseSlug }) {
  const [state, setState] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    if (!enterpriseSlug) return undefined
    let active = true
    apiRequest(`/api/organizations/${encodeURIComponent(enterpriseSlug)}/join-request`)
      .then((result) => { if (active) setState(result) })
      .catch(() => { if (active) setLoadFailed(true) })
    return () => { active = false }
  }, [enterpriseSlug])

  if (!enterpriseSlug || loadFailed || !state) return null
  // 团队不存在（无效 slug / 已解散）时整张卡片都不渲染：
  // 否则会显示「加入『该团队』团队空间」这种兜底文案，比不显示更误导人。
  if (state.available === false && state.reason === 'unavailable') return null
  const teamName = state.organizationName || '该团队'
  const login = () => {
    const returnTo = `${window.location.origin}${window.location.pathname}${window.location.search}`
    window.location.href = `/api/auth/login?return_to=${encodeURIComponent(returnTo)}`
  }
  const submit = async () => {
    if (submitting) return
    setSubmitting(true)
    setFeedback('')
    try {
      const result = await apiRequest(`/api/organizations/${encodeURIComponent(enterpriseSlug)}/join-request`, { method: 'POST', body: JSON.stringify({}) })
      setState((current) => ({ ...current, available: false, reason: 'pending', requestedAt: result.requestedAt || new Date().toISOString() }))
      setFeedback('申请已提交，等待团队所有者处理')
    } catch (err) {
      setFeedback(err.message || '申请提交失败，请稍后再试')
      try {
        const latest = await apiRequest(`/api/organizations/${encodeURIComponent(enterpriseSlug)}/join-request`)
        setState(latest)
      } catch { /* 保持当前状态，仅提示错误 */ }
    } finally {
      setSubmitting(false)
    }
  }

  const cooldownText = () => {
    if (!state.cooldownUntil) return ''
    const hours = Math.max(1, Math.ceil((new Date(state.cooldownUntil).getTime() - Date.now()) / (60 * 60 * 1000)))
    return `上次申请未通过，请 ${hours} 小时后再试。`
  }
  const hintByReason = {
    anonymous: '登录鲲穹账号后，可直接向团队所有者申请加入。',
    pending: '申请已提交，等待团队所有者同意或拒绝。',
    invited: '你已收到该团队的邀请，请到消息中心选择接受或拒绝。',
    member: '你已经是该团队成员。',
    owner: '你是该团队的所有者。',
    other_team: '你已加入其他团队空间，无法重复加入。',
    cooldown: cooldownText(),
  }
  const showButton = state.available
  const buttonLabel = state.available ? '申请加入团队' : state.reason === 'anonymous' ? '登录后申请加入' : '申请加入团队'
  const tone = state.reason === 'pending' ? 'pending' : state.reason === 'member' ? 'member' : 'default'

  return (
    <div className={`public-card team-join-card ${tone}`}>
      <span className="team-join-icon"><Building2 size={20} /></span>
      <div className="team-join-body">
        <strong>加入「{teamName}」团队空间</strong>
        <span>{hintByReason[state.reason] || '团队版账号可通过分享链接直接申请加入团队空间。'}</span>
        {feedback && <span className="team-join-feedback"><Check size={13} /> {feedback}</span>}
      </div>
      {(showButton || state.reason === 'anonymous') && !feedback && (
        <button className="secondary-button team-join-action" onClick={state.reason === 'anonymous' ? login : submit} disabled={submitting}>
          {state.reason === 'anonymous' ? <UserRound size={15} /> : <UserPlus size={15} />} {submitting ? '提交中' : buttonLabel}
        </button>
      )}
    </div>
  )
}

// 团队邀请链接的落地页（/e/<slug>/share/、/e/<slug>/collect/、/e/<slug>/）。
// 团队邀请链接不带分享 token，之前会落到 WorkspaceApp 兜底分支，访客根本看不到「申请加入团队」入口。
// 这里给邀请链接一个专属落地页：直接展示加入卡片，不依赖任何分享/收集任务存在。
function TeamInvitePage({ slug }) {
  // 落地页自己探一次团队是否存在：无效 slug 时上方导语必须换成「链接已失效」，
  // 否则页面会一边说「你收到一个团队空间邀请」、一边渲染不出任何可操作入口，自相矛盾。
  const [probe, setProbe] = useState(null)
  useEffect(() => {
    if (!slug) return undefined
    let active = true
    apiRequest(`/api/organizations/${encodeURIComponent(slug)}/join-request`)
      .then((result) => { if (active) setProbe(result) })
      .catch(() => { if (active) setProbe({ available: false, reason: 'unavailable' }) })
    return () => { active = false }
  }, [slug])
  const invalid = probe && probe.reason === 'unavailable'
  return (
    <PublicShell>
      <section className="team-invite-page">
        <div className="team-invite-hero">
          <span className="team-invite-hero-icon">{invalid ? <Building2 size={26} /> : <Users size={26} />}</span>
          <p className="eyebrow">团队空间邀请</p>
          <h1>{invalid ? '这个邀请链接已失效' : '你收到一个团队空间邀请'}</h1>
          <p>{invalid ? '该团队不存在或已解散，请联系邀请你的人重新获取链接。' : '登录鲲穹账号后即可申请加入，申请会提交给团队所有者审批。'}</p>
        </div>
        {!invalid && <TeamJoinRequestCard enterpriseSlug={slug} />}
      </section>
    </PublicShell>
  )
}

function SharePage({ token, enterpriseSlug = '' }) {
  const [data, setData] = useState(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [requiresLogin, setRequiresLogin] = useState(false)
  const { downloadTask, startDownload, retryDownload, downloadBusy } = useDownloadTask()
  const [previewItem, setPreviewItem] = useState(null)
  useEffect(() => {
    const query = enterpriseSlug ? `?organization=${encodeURIComponent(enterpriseSlug)}` : ''
    apiRequest(`/api/shares/token/${token}${query}`).then((result) => {
      setData(result)
      saveLocalRecord(createShareRecord(result.share, 'sent_to_me'))
    }).catch((err) => { setError(err.message); setRequiresLogin(err.code === 'directed_login_required') })
  }, [token, enterpriseSlug])
  const findShare = async () => {
    try {
      const result = await apiRequest(`/api/shares/lookup/${data.share.code}`, { method: 'POST', body: JSON.stringify({ password }) })
      setData(result)
      setActionError('')
      saveLocalRecord(createShareRecord(result.share, 'sent_to_me'))
    } catch (err) { setActionError(err.message) }
  }
  if (error) return <PublicShell><StateBlock title="这个分享暂时不可用" detail={error} />{requiresLogin && <button className="primary-button" onClick={() => { window.location.href = `/api/auth/login?return_to=${encodeURIComponent(window.location.href)}` }}><UserRound size={16} /> 使用收件账号登录</button>}</PublicShell>
  if (!data) return <PublicShell><LoadingBlock /></PublicShell>
  const share = data.share
  const downloadAll = () => startDownload(createShareDownloadConfig(share, { password }))
  const downloadFile = (file, fileIndex) => startDownload(createShareFileDownloadConfig(share, file, fileIndex, { password }))
  const previewFile = (file, fileIndex) => setPreviewItem(createShareFilePreviewConfig(share, file, fileIndex, { password }))
  return (
    <PublicShell>
      <div className="public-card share-public-card">
        <span className="public-icon"><Download size={24} /></span>
        <p className="eyebrow">鲲穹临时分享</p>
        <h1>有人给你发来了文件</h1>
        {data.requiresPassword && !share.files?.length ? (
          <>
            <p className="public-copy">此分享受提取密码保护，验证密码后即可查看文件内容。</p>
            <div className="public-password">
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入提取密码" />
              <button className="primary-button" onClick={findShare}><KeyRound size={15} /> 验证密码</button>
            </div>
          </>
        ) : (
          <>
            <p className="public-copy">{share.files?.length || 0} 个文件 · {formatBytes((share.files || []).reduce((sum, file) => sum + (Number(file.size) || 0), 0))} · {formatExpiry(share.expiresAt)}</p>
            <div className="public-files">
              {(share.files || []).map((file, fileIndex) => <FileRow key={file.relativePath} file={file} onPreview={canPreviewFile(file) ? () => previewFile(file, fileIndex) : null} onDownload={() => downloadFile(file, fileIndex)} downloadDisabled={downloadBusy} />)}
            </div>
            <button className="primary-button wide" onClick={downloadAll} disabled={downloadBusy || !(share.files || []).length}><Download size={17} /> {(share.files || []).length > 1 ? '下载全部文件' : '下载文件'}</button>
            <DownloadProgressPanel task={downloadTask} onRetry={retryDownload} />
          </>
        )}
        {actionError && <FeedbackMessage message={actionError} tone="error" />}
        {previewItem && <FilePreviewModal preview={previewItem} onClose={() => setPreviewItem(null)} onDownload={() => startDownload(previewItem.downloadConfig)} downloadDisabled={downloadBusy} />}
      </div>
      <TeamJoinRequestCard enterpriseSlug={enterpriseSlug} />
    </PublicShell>
  )
}

function ShareManagePage({ token }) {
  const [share, setShare] = useState(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const { downloadTask, startDownload, retryDownload, downloadBusy } = useDownloadTask()
  const [previewItem, setPreviewItem] = useState(null)
  const { confirmState, requestConfirm, settleConfirm } = useConfirmDialog()

  const refreshShare = async () => {
    const result = await apiRequest(`/api/shares/manage/${encodeURIComponent(token)}`)
    setShare(result.share)
    saveLocalRecord(createShareRecord(result.share, 'my_sent'))
  }

  useEffect(() => {
    refreshShare().catch((err) => setError(err.message))
  }, [token])

  const saveShareSettings = async (payload) => {
    try {
      const result = await apiRequest(`/api/shares/manage/${encodeURIComponent(token)}`, { method: 'PATCH', body: JSON.stringify(payload) })
      setShare(result.share)
      saveLocalRecord(createShareRecord(result.share, 'my_sent'))
      return true
    } catch (err) {
      setError(err.message)
      return false
    }
  }

  const closeShare = async () => {
    const confirmed = await requestConfirm({
      title: '关闭分享链接',
      detail: '关闭后下载链接和取件码会立即失效。确定关闭这个分享吗？',
      confirmText: '关闭分享',
      tone: 'danger',
    })
    if (!confirmed) return false
    try {
      const result = await apiRequest(`/api/shares/manage/${encodeURIComponent(token)}`, { method: 'DELETE' })
      setShare(result.share)
      saveLocalRecord(createShareRecord(result.share, 'my_sent'))
      return true
    } catch (err) {
      setError(err.message)
      return false
    }
  }

  const reopenShare = async (payload) => {
    try {
      const result = await apiRequest(`/api/shares/manage/${encodeURIComponent(token)}`, { method: 'PATCH', body: JSON.stringify({ ...payload, status: 'active' }) })
      setShare(result.share)
      saveLocalRecord(createShareRecord(result.share, 'my_sent'))
      return true
    } catch (err) {
      setError(err.message)
      return false
    }
  }

  if (error) return <PublicShell><StateBlock title="分享管理不可用" detail={error} /></PublicShell>
  if (!share) return <PublicShell><LoadingBlock /></PublicShell>

  const isActive = share.status === 'active'
  const fileCount = share.files?.length || 0
  const totalSize = share.files?.reduce((sum, file) => sum + Number(file.size || 0), 0) || 0
  const manageTarget = { kind: 'share', record: createShareRecord(share, 'my_sent'), data: share }
  const downloadFile = (file, fileIndex) => startDownload(createShareFileDownloadConfig(share, file, fileIndex))
  const previewFile = (file, fileIndex) => setPreviewItem(createShareFilePreviewConfig(share, file, fileIndex))

  return (
    <PublicShell>
      <div className="public-card manage-card">
        <p className="eyebrow">分享管理</p>
        <div className="manage-title-row">
          <h1>{share.files?.[0]?.name || '文件分享'}</h1>
          <div className="manage-title-actions">
            <button className="secondary-button" onClick={() => setEditing(true)}><Settings2 size={15} /> 编辑分享</button>
          </div>
        </div>
        <p className="public-copy">{fileCount ? `${fileCount} 个文件 · ${formatBytes(totalSize)} · 状态：${shareStatusText(share.status)}` : `文件已清理 · 状态：${shareStatusText(share.status)}`}</p>
        <div className="manage-list">
          {fileCount ? share.files.map((file) => (
            <div className="manage-submission" key={file.relativePath}>
              <div><strong>{file.name}</strong><span>{file.relativePath} · {formatBytes(file.size)}</span></div>
              <div className="manage-file-actions">{canPreviewFile(file) && <button className="ghost-icon" type="button" onClick={() => previewFile(file, share.files.indexOf(file))} disabled={!isActive} aria-label={`预览 ${file.name}`} title="预览文件"><Eye size={15} /></button>}<button className="ghost-icon" type="button" onClick={() => downloadFile(file, share.files.indexOf(file))} disabled={!isActive || downloadBusy} aria-label={`下载 ${file.name}`} title="下载文件"><Download size={15} /></button></div>
            </div>
          )) : (
            <div className="empty-manage"><FileText size={25} /><span>分享文件已关闭或清理</span></div>
          )}
        </div>
      </div>
      <DownloadProgressPanel task={downloadTask} onRetry={retryDownload} />
      {previewItem && <FilePreviewModal preview={previewItem} onClose={() => setPreviewItem(null)} onDownload={() => startDownload(previewItem.downloadConfig)} downloadDisabled={downloadBusy} />}
      {editing && <ManageItemModal target={manageTarget} onClose={() => setEditing(false)} onSave={saveShareSettings} onCloseTask={async () => { const closed = await closeShare(); if (closed) setEditing(false); return closed }} onReopenTask={async (payload) => { const reopened = await reopenShare(payload); if (reopened) setEditing(false); return reopened }} />}
      <ConfirmModal state={confirmState} onCancel={() => settleConfirm(false)} onConfirm={() => settleConfirm(true)} />
    </PublicShell>
  )
}

function CollectionSubmitPage({ token, enterpriseSlug = '' }) {
  const inputRef = useRef(null)
  const submitRequestRef = useRef(null)
  const submitRunRef = useRef(0)
  const [collection, setCollection] = useState(null)
  const [files, setFiles] = useState([])
  const [user, setUser] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [name, setName] = useState('')
  const [progress, setProgress] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  // 登录后提交：提交者身份由账号决定，不需要也不能手填；
  // 未登录时保留手填入口（匿名提交仍然可用）。
  const signedIn = Boolean(user?.id)
  useEffect(() => {
    const query = enterpriseSlug ? `?organization=${encodeURIComponent(enterpriseSlug)}` : ''
    apiRequest(`/api/collections/${token}${query}`).then((data) => {
      setCollection(data.collection)
      saveLocalRecord(createCollectionRecord(data.collection, 'collect_from_me'))
    }).catch((err) => setMessage(err.message))
    apiRequest('/api/auth/me').then(({ user: current }) => {
      setUser(current || null)
      if (current) setName((existing) => existing.trim() ? existing : (current.nickname || current.username || ''))
    }).catch(() => {}).finally(() => setAuthChecked(true))
  }, [token, enterpriseSlug])

  const startLogin = () => {
    const returnTo = `${window.location.origin}${window.location.pathname}${window.location.search}`
    window.location.href = `/api/auth/login?return_to=${encodeURIComponent(returnTo)}`
  }

  const firstInvalidFile = (selectedFiles) => {
    const limitMb = Number(collection?.maxFileSizeMb || 0)
    return selectedFiles.find((file) => (
      (limitMb > 0 && file.size > limitMb * 1024 * 1024)
      || !isAllowedCollectionFile(file, collection?.allowedTypes)
    ))
  }

  const handleSelectFiles = (incoming) => {
    const selectedFiles = toFileItems(incoming)
    setFiles(selectedFiles)
    const invalidFile = firstInvalidFile(selectedFiles)
    setMessage(invalidFile ? `${invalidFile.name} 不符合当前收集任务的文件限制` : '')
  }

  const cancelSubmit = () => {
    submitRunRef.current += 1
    submitRequestRef.current?.abort()
    submitRequestRef.current = null
    setSubmitting(false)
    setProgress(0)
    setFiles([])
    setMessage('已取消提交，可以重新选择文件')
  }

  const removeSelectedFile = (fileId) => {
    if (submitting) {
      cancelSubmit()
      return
    }
    setFiles((current) => current.filter((item) => item.id !== fileId))
  }

  const submit = () => {
    // 登录后提交者名取账号显示名，服务端也会以会话为准覆写，二者保持一致。
    const participantName = signedIn ? (displayUserName(user) || name.trim()) : name.trim()
    if (!participantName || !files.length) {
      setMessage(signedIn ? '请选择要提交的文件' : '请填写提交人名称并选择文件')
      return
    }
    const invalidFile = firstInvalidFile(files)
    if (invalidFile) {
      setMessage(`${invalidFile.name} 不符合当前收集任务的文件限制`)
      return
    }
    const submitRun = submitRunRef.current + 1
    submitRunRef.current = submitRun
    setSubmitting(true)
    const collectionUploadRef = { current: createUploadSessionState() }
    uploadShareInChunks(files, {}, collectionUploadRef, ({ progress }) => {
      if (submitRunRef.current === submitRun) setProgress(progress)
    }, {
      sessionBody: {
        mode: 'collection',
        collectionToken: token,
        participantName,
        relativePaths: files.map((item) => item.relativePath),
      },
      completeBody: { mode: 'collection' },
    }).then((result) => {
      if (submitRunRef.current !== submitRun) return
      const submittedAt = result.submission?.submittedAt || new Date().toISOString()
      saveLocalRecord(createCollectionRecord(collection, 'collect_from_me', { participantName, submittedAt, files: result.submission?.files || files }))
      setMessage('提交成功，感谢你的文件')
      setFiles([])
    }).catch((err) => {
      if (submitRunRef.current === submitRun && err.name !== 'UploadCancelledError') setMessage(err.message)
    }).finally(() => {
      if (submitRunRef.current === submitRun) {
        submitRequestRef.current = null
        setSubmitting(false)
      }
    })
    submitRequestRef.current = { abort: () => { collectionUploadRef.current.paused = true; collectionUploadRef.current.abortCurrent?.() } }
  }
  return (
    <PublicShell>
      <div className="public-card collection-submit-card">
        <span className="public-icon"><Inbox size={24} /></span>
        {collection ? (
          <>
            <p className="eyebrow">文件收集</p>
            <h1>{collection.title}</h1>
            <p className="public-copy">{collection.description}</p>
            <div className="deadline-line"><Clock3 size={15} /> 截止 {formatDate(collection.deadline)}</div>
            <CollectionLimitInfo allowedTypes={collection.allowedTypes} maxFileSizeMb={collection.maxFileSizeMb} />
            {authChecked && (
              signedIn ? (
                <div className="collection-identity signed-in">
                  <span className="collection-identity-avatar"><UserAvatar user={user} /></span>
                  <div className="collection-identity-copy">
                    <small>提交人</small>
                    <strong>{displayUserName(user)}</strong>
                    <span>本次提交会记录你的鲲穹账号，收集方可以核对是谁提交的</span>
                  </div>
                  <button type="button" className="collection-identity-switch" onClick={() => setUser(null)}><UserRound size={14} /> 改用其他名称</button>
                </div>
              ) : (
                <div className="collection-identity anonymous">
                  <span className="collection-identity-avatar"><UserRound size={17} /></span>
                  <div className="collection-identity-copy">
                    <small>提交人</small>
                    <strong>当前未登录</strong>
                    <span>登录后提交会带上你的账号信息，方便收集方识别；也可以直接填写名称匿名提交</span>
                  </div>
                  <button type="button" className="secondary-button collection-identity-login" onClick={startLogin}><UserRound size={15} /> 登录后提交</button>
                </div>
              )
            )}
            {(!signedIn || !authChecked) && (
              <label className="public-label">提交人名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：张三 / 市场部" /></label>
            )}
            <div className="public-drop" onClick={() => inputRef.current?.click()}>
              <input ref={inputRef} type="file" multiple hidden accept={collectionFileAccept(collection.allowedTypes)} onChange={(event) => handleSelectFiles(event.target.files)} />
              <UploadCloud size={24} />
              <strong>{files.length ? `${files.length} 个文件已选择` : '选择要提交的文件'}</strong>
              <span>按当前任务限制提交，提交者之间互不可见</span>
            </div>
            {files.length > 0 && <div className="public-files">{files.map((file) => <FileRow key={file.id} file={file} onRemove={() => removeSelectedFile(file.id)} />)}</div>}
            {submitting && <div className="progress-wrap"><div className="progress-label"><span>正在提交...</span><strong>{progress}%</strong></div><div className="progress-track"><span style={{ width: `${progress}%` }} /></div></div>}
            {submitting && <button className="secondary-button wide" onClick={cancelSubmit}><X size={16} /> 取消提交</button>}
            <button className="primary-button wide" onClick={submit} disabled={submitting}><UploadCloud size={17} /> {submitting ? '提交中...' : '提交文件'}</button>
            {message && <FeedbackMessage message={message} tone={feedbackTone(message)} />}
          </>
        ) : (
          <StateBlock title="无法打开收集任务" detail={message || '正在加载任务'} />
        )}
      </div>
      <TeamJoinRequestCard enterpriseSlug={enterpriseSlug} />
    </PublicShell>
  )
}

function CollectionManagePage({ token }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  // destroyed 状态已移除：销毁收集任务在记录页完成（DELETE 后管理页 GET 会 404，走 error 分支）
  const [editing, setEditing] = useState(false)
  const [actionError, setActionError] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const { downloadTask, startDownload, retryDownload, downloadBusy } = useDownloadTask()
  const [previewItem, setPreviewItem] = useState(null)
  const [qrOpen, setQrOpen] = useState(false)
  const { confirmState, requestConfirm, settleConfirm } = useConfirmDialog()

  const saveManagedCollection = (collection) => {
    setActionError('')
    setActionMessage('')
    setData(collection)
    saveAuthoritativeLocalRecord(createCollectionRecord(collection, 'my_collections'))
  }

  useEffect(() => {
    apiRequest(`/api/collections/manage/${token}`).then((result) => {
      saveManagedCollection(result.collection)
    }).catch((err) => setError(err.message))
  }, [token])

  const saveTaskSettings = async (payload) => {
    try {
      const result = await apiRequest(`/api/collections/manage/${encodeURIComponent(token)}`, { method: 'PATCH', body: JSON.stringify(payload) })
      saveManagedCollection(result.collection)
      return true
    } catch (err) {
      setActionError(err.message)
      return false
    }
  }

  const closeTask = async () => {
    const confirmed = await requestConfirm({
      title: '关闭收集任务',
      detail: '关闭后提交者将不能继续上传，已收文件仍可在管理页查看。确定关闭这个收集任务吗？',
      confirmText: '关闭收集',
      tone: 'danger',
    })
    if (!confirmed) return false
    try {
      const result = await apiRequest(`/api/collections/manage/${encodeURIComponent(token)}`, { method: 'PATCH', body: JSON.stringify({ status: 'closed' }) })
      saveManagedCollection(result.collection)
      return true
    } catch (err) {
      setActionError(err.message)
      return false
    }
  }

  const reopenTask = async (patch = {}) => {
    try {
      const result = await apiRequest(`/api/collections/manage/${encodeURIComponent(token)}`, { method: 'PATCH', body: JSON.stringify({ ...patch, status: 'active' }) })
      saveManagedCollection(result.collection)
      return true
    } catch (err) {
      setActionError(err.message)
      return false
    }
  }

  const deleteSubmission = async (submissionId) => {
    const confirmed = await requestConfirm({
      title: '删除提交记录',
      detail: '删除后该提交记录和文件会从本机服务中移除。确定删除吗？',
      confirmText: '删除提交',
      tone: 'danger',
    })
    if (!confirmed) return false
    try {
      const result = await apiRequest(`/api/collections/manage/${encodeURIComponent(token)}/submissions/${encodeURIComponent(submissionId)}`, { method: 'DELETE' })
      saveManagedCollection(result.collection)
      return true
    } catch (err) {
      setActionError(err.message)
      return false
    }
  }

  const copyPublicValue = async (value) => {
    setActionError('')
    setActionMessage('')
    try {
      await copyTextToClipboard(value)
      setActionMessage('已复制到剪贴板')
    } catch {
      setActionError('当前浏览器不支持自动复制，请手动复制链接')
    }
  }
  const copyPublicQrImage = async (dataUrl, fallbackText) => {
    setActionError('')
    setActionMessage('')
    try {
      await copyImageToClipboard(dataUrl)
      setActionMessage('二维码图片已复制')
    } catch {
      try {
        await copyTextToClipboard(fallbackText || dataUrl)
        setActionMessage('当前浏览器不支持直接复制图片，已复制链接')
      } catch {
        setActionError('当前浏览器不支持自动复制，请手动复制链接')
      }
    }
  }
  const downloadAll = () => startDownload(createCollectionDownloadConfig(data))
  const downloadSubmissionItem = (submission) => startDownload(createSubmissionDownloadConfig(data, submission))
  const downloadFile = (submission, fileIndex) => startDownload(createSubmissionFileDownloadConfig(data, submission, fileIndex))
  const previewFile = (submission, fileIndex) => setPreviewItem(createSubmissionFilePreviewConfig(data, submission, fileIndex))
  if (error) return <PublicShell><StateBlock title="管理链接不可用" detail={error} /></PublicShell>
  if (!data) return <PublicShell><LoadingBlock /></PublicShell>
  const isActive = data.status === 'active'
  const manageTarget = { kind: 'collection', record: createCollectionRecord(data, 'my_collections'), data }
  return (
    <PublicShell>
      <div className="public-card manage-card">
        <p className="eyebrow">收集任务管理</p>
        <div className="manage-title-row">
          <h1>{data.title}</h1>
          <div className="manage-title-actions">
            <button className="secondary-button" disabled={!data.publicUrl} onClick={() => copyPublicValue(data.publicUrl)}><Link2 size={15} /> 复制提交链接</button>
            <button className="secondary-button" disabled={!data.qrDataUrl} onClick={() => setQrOpen(true)}><QrCode size={15} /> 查看二维码</button>
            <button className="secondary-button" onClick={() => setEditing(true)}><Settings2 size={15} /> 编辑任务</button>
            {isActive ? (
              <button className="secondary-button danger-lite" onClick={closeTask}><X size={15} /> 关闭收集任务</button>
            ) : canReopenCollection(data) ? (
              <button className="secondary-button" onClick={() => reopenTask()}><RefreshCw size={15} /> 重新开启任务</button>
            ) : (
              <button className="secondary-button" onClick={() => setEditing(true)}><CalendarDays size={15} /> 延长后开启</button>
            )}
          </div>
        </div>
        <p className="public-copy">{data.submissions.length} 份提交 · 状态：{collectionStatusText(data.status, data.deadline)}</p>
        {actionMessage && <FeedbackMessage message={actionMessage} tone="success" />}
        {actionError && <FeedbackMessage message={actionError} tone="error" />}
        <CollectionLimitInfo allowedTypes={data.allowedTypes} maxFileSizeMb={data.maxFileSizeMb} />
        <div className="manage-list">
          {data.submissions.length ? data.submissions.map((submission) => (
            <div className="manage-submission" key={submission.id}>
              <div>
                <div className="collection-submission-who">
                  <strong>{submission.participantName}</strong>
                  {submission.submitter
                    ? <span className="submission-account-badge" title={`鲲穹账号：${submission.submitter.displayName || submission.submitter.id}`}><UserRound size={12} /> 账号提交</span>
                    : <span className="submission-anon-badge">匿名提交</span>}
                </div>
                <span>{formatDate(submission.submittedAt)} · {submission.files.length} 个文件</span>
                <div className="manage-file-names">{submission.files.map((file, fileIndex) => <span className="manage-file-chip" key={`${submission.id}-${file.relativePath}`}>{canPreviewFile(file) && <button className="manage-file-icon" aria-label={`预览 ${file.name}`} onClick={() => previewFile(submission, fileIndex)}><Eye size={13} /></button>}<button onClick={() => downloadFile(submission, fileIndex)} disabled={downloadBusy}><FileText size={13} /> <FileFormatBadge file={file} /> {file.name}</button></span>)}</div>
              </div>
              <div className="manage-submission-actions">
                <button className="secondary-button" onClick={() => downloadSubmissionItem(submission)} disabled={downloadBusy}><Download size={15} /> 下载</button>
                <button className="secondary-button danger-lite" onClick={() => deleteSubmission(submission.id)}><Trash2 size={15} /> 删除提交</button>
              </div>
            </div>
          )) : (
            <div className="empty-manage"><Inbox size={25} /><span>暂时还没有人提交文件</span></div>
          )}
        </div>
        {data.submissions.length > 0 && <button className="primary-button wide" onClick={downloadAll} disabled={downloadBusy}><Download size={16} /> 打包下载全部提交</button>}
        <DownloadProgressPanel task={downloadTask} onRetry={retryDownload} />
        {previewItem && <FilePreviewModal preview={previewItem} onClose={() => setPreviewItem(null)} onDownload={() => startDownload(previewItem.downloadConfig)} downloadDisabled={downloadBusy} />}
      </div>
      {editing && <ManageItemModal target={manageTarget} onClose={() => setEditing(false)} onSave={saveTaskSettings} onCloseTask={async () => { const closed = await closeTask(); if (closed) setEditing(false); return closed }} onReopenTask={async (payload) => { const reopened = await reopenTask(payload); if (reopened) setEditing(false); return reopened }} />}
      {qrOpen && (
        <QrPreviewModal
          title="收集二维码"
          detail={data.title || '提交链接'}
          qrDataUrl={data.qrDataUrl}
          targetUrl={data.publicUrl}
          onClose={() => setQrOpen(false)}
          onCopyImage={() => copyPublicQrImage(data.qrDataUrl, data.publicUrl)}
          onCopyLink={() => copyPublicValue(data.publicUrl)}
        />
      )}
      <ConfirmModal state={confirmState} onCancel={() => settleConfirm(false)} onConfirm={() => settleConfirm(true)} />
    </PublicShell>
  )
}

function RetrieveModal({ code, setCode, result, onClose, onFind }) {
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

function SettingsModal({ settings, setSettings, user, onClose, onSave }) {
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

function ShareExpiryModal({ record, canUsePermanent, onClose, onSave }) {
  const currentExpiry = toDateInputValue(record?.expiresAt)
  const [mode, setMode] = useState('date')
  const [expiryDate, setExpiryDate] = useState(currentExpiry && isDateInputStillOpen(currentExpiry) ? currentExpiry : defaultDeadline(7))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const submit = async () => {
    // 自定义截止日期是会员特权（hasMembership 口径），只有「永久保存」才要求企业版 permanent。
    // 此前误在入口处一刀切 !canUsePermanent 直接 return，导致非企业版用户点保存无任何反馈。
    if (mode === 'permanent' && !canUsePermanent) {
      setError('永久保存需要企业版权益，可选择自定义截止日期')
      return
    }
    if (mode === 'date' && !isDateInputStillOpen(expiryDate)) {
      setError('请把截止日期调整到今天或未来日期')
      return
    }
    setSaving(true)
    setError('')
    try {
      const saved = await onSave({ expiresAt: mode === 'permanent' ? null : expiryDate, status: 'active' })
      if (!saved) setSaving(false)
    } catch (saveError) {
      setError(saveError.message || '保存截至时间失败')
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal share-expiry-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div><p className="eyebrow">分享管理</p><h2>设置截至时间</h2></div>
          <button className="ghost-icon modal-close" aria-label="关闭截至时间设置" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body share-expiry-form">
          <div className="setting-block">
            <span>分享截止时间</span>
            <div className="option-grid compact-grid">
              <button className={mode === 'date' ? 'selected' : ''} onClick={() => setMode('date')}>自定义日期{mode === 'date' && <Check size={14} />}</button>
              <button className={mode === 'permanent' ? 'selected' : ''} onClick={() => canUsePermanent && setMode('permanent')} disabled={!canUsePermanent} title={!canUsePermanent ? '永久保存需要企业版权益' : ''}>永久保存{mode === 'permanent' && <Check size={14} />}</button>
            </div>
            {mode === 'date' && <DatePicker value={expiryDate} onChange={setExpiryDate} ariaLabel="分享截止日期" />}
            {!canUsePermanent && <small className="setting-hint">永久保存需要企业版权益，会员可自定义截止时间。</small>}
          </div>
          {error && <p className="manage-form-error">{error}</p>}
        </div>
        <div className="modal-footer">
          <button className="secondary-button" onClick={onClose}>取消</button>
          <button className="primary-button" disabled={saving || (mode === 'permanent' && !canUsePermanent)} onClick={submit}>{saving ? '保存中' : '保存设置'}</button>
        </div>
      </div>
    </div>
  )
}

function ManageItemModal({ target, onClose, onSave, onCloseTask, onReopenTask }) {
  const isShare = target.kind === 'share'
  const data = target.data || {}
  const [shareForm, setShareForm] = useState(() => createShareManageForm(data))
  const [collectionForm, setCollectionForm] = useState(() => createCollectionManageForm(data))
  const [saving, setSaving] = useState(false)
  const [closing, setClosing] = useState(false)
  const [reopening, setReopening] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const updateShare = (patch) => setShareForm((current) => ({ ...current, ...patch }))
  const updateCollection = (patch) => setCollectionForm((current) => ({ ...current, ...patch }))
  const toggleAllowedType = (type) => {
    updateCollection({ allowedTypes: toggleCollectionType(collectionForm.allowedTypes, type) })
  }

  const buildCollectionPayload = ({ reopeningTask = false } = {}) => {
    const title = collectionForm.title.trim()
    if (!title) {
      setError('请填写任务名称')
      return null
    }
    if (!collectionForm.deadline) {
      setError('请选择截止日期')
      return null
    }
    if (reopeningTask && !isDateInputStillOpen(collectionForm.deadline)) {
      setError('请先把截止日期调整到今天或未来日期')
      return null
    }
    return {
      title,
      description: collectionForm.description.trim(),
      deadline: collectionForm.deadline,
      allowedTypes: normalizeCollectionTypes(collectionForm.allowedTypes),
      maxFileSizeMb: Number(collectionForm.maxFileSizeMb),
    }
  }

  const buildSharePayload = ({ reopeningShare = false } = {}) => {
    const customLimit = Number(shareForm.customDownloadLimit)
    if (shareForm.downloadLimit === 'custom' && (!Number.isFinite(customLimit) || customLimit < 1)) {
      setError('请填写正确的下载次数')
      return null
    }
    return {
      downloadLimit: shareForm.downloadLimit === 'custom' ? String(Math.floor(customLimit)) : shareForm.downloadLimit,
      password: shareForm.clearPassword ? '' : shareForm.password.trim(),
      clearPassword: shareForm.clearPassword,
      ...(reopeningShare ? { status: 'active' } : {}),
    }
  }

  const submit = async () => {
    setError('')
    let payload
    if (isShare) {
      payload = buildSharePayload()
      if (!payload) return
    } else {
      payload = buildCollectionPayload()
      if (!payload) return
    }

    setSaving(true)
    try {
      const ok = await onSave(payload)
      if (ok) {
        onClose()
        return
      }
      setSaving(false)
    } catch {
      setSaving(false)
    }
  }

  const closeTask = async () => {
    setClosing(true)
    try {
      const ok = await onCloseTask()
      if (!ok) setClosing(false)
    } catch {
      setClosing(false)
    }
  }

  const reopenTask = async () => {
    setError('')
    const payload = isShare ? buildSharePayload({ reopeningShare: true }) : buildCollectionPayload({ reopeningTask: true })
    if (!payload) return
    setReopening(true)
    try {
      const ok = await onReopenTask?.(payload)
      if (ok) {
        onClose()
        return
      }
      setReopening(false)
    } catch {
      setReopening(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal manage-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div><p className="eyebrow">{isShare ? '分享管理' : '收集任务管理'}</p><h2>{isShare ? '管理分享设置' : '管理收集设置'}</h2></div>
          <button className="ghost-icon modal-close" aria-label="关闭管理窗口" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body manage-form">
          {isShare ? (
            <>
              <div className="setting-block manage-setting-block">
                <span>下载次数</span>
                <div className="option-grid">{[['不限次数', 'unlimited'], ['10 次', '10'], ['1 次', '1'], ['自定义', 'custom']].map(([label, value]) => <button key={value} className={shareForm.downloadLimit === value ? 'selected' : ''} onClick={() => updateShare({ downloadLimit: value })}>{label}{shareForm.downloadLimit === value && <Check size={14} />}</button>)}</div>
                {shareForm.downloadLimit === 'custom' && <label className="inline-setting-input"><span>最多下载次数</span><input type="number" min="1" max="9999" value={shareForm.customDownloadLimit} onChange={(event) => updateShare({ customDownloadLimit: event.target.value })} placeholder="例如：5" /></label>}
              </div>
              <label className="manage-field manage-password-field">
                <span>提取密码</span>
                <input className="modal-inline-input" type="password" value={shareForm.password} disabled={shareForm.clearPassword} onChange={(event) => updateShare({ password: event.target.value })} placeholder={data.requiresPassword ? '输入新密码，留空则不修改' : '可选，设置后下载前需要验证'} />
              </label>
              <label className="manage-check-row">
                <input type="checkbox" checked={shareForm.clearPassword} onChange={(event) => updateShare({ clearPassword: event.target.checked, password: event.target.checked ? '' : shareForm.password })} />
                <span>清除当前提取密码</span>
              </label>
            </>
          ) : (
            <>
              <label className="manage-field manage-title-field">
                <span>任务名称</span>
                <input className="modal-inline-input" value={collectionForm.title} onChange={(event) => updateCollection({ title: event.target.value })} placeholder="例如：9 月产品素材收集" />
              </label>
              <label className="manage-field">
                <span>收集说明</span>
                <textarea value={collectionForm.description} onChange={(event) => updateCollection({ description: event.target.value })} placeholder="请上传你负责的文件" />
              </label>
              <label className="manage-field">
                <span>截止日期</span>
                <DatePicker value={collectionForm.deadline} onChange={(value) => updateCollection({ deadline: value })} ariaLabel="收集任务截止日期" />
              </label>
              <label className="manage-field">
                <span>文件类型</span>
                <div className="chip-group">{COLLECTION_TYPE_OPTIONS.map((type) => <button key={type} className={collectionForm.allowedTypes.includes(type) ? 'selected' : ''} onClick={() => toggleAllowedType(type)}>{type}</button>)}</div>
              </label>
              <label className="manage-field">
                <span>单人大小限制</span>
                <select value={collectionForm.maxFileSizeMb} onChange={(event) => updateCollection({ maxFileSizeMb: event.target.value })}><option value="500">500 MB</option><option value="1024">1 GB</option><option value="5120">5 GB</option></select>
              </label>
            </>
          )}
          {error && <p className="manage-form-error">{error}</p>}
        </div>
        <div className="modal-footer manage-modal-footer">
          {(isShare && !isClosedOrExpiredStatus(data.status)) || (!isShare && data.status === 'active') ? (
            <button className="secondary-button danger-lite" disabled={isClosedStatus(data.status) || closing} onClick={closeTask}><X size={15} /> {closing ? '关闭中' : isShare ? '关闭分享' : '关闭收集任务'}</button>
          ) : (
            <button className="secondary-button reopen-button" disabled={reopening} onClick={reopenTask}><RefreshCw className={reopening ? 'spinning' : ''} size={15} /> {reopening ? '开启中' : isShare ? '重新开启分享' : '重新开启收集任务'}</button>
          )}
          <button className="secondary-button" onClick={onClose}>取消</button>
          <button className="primary-button" disabled={saving} onClick={submit}>{saving ? '保存中' : '保存设置'}</button>
        </div>
      </div>
    </div>
  )
}

function RenameRecordModal({ record, onClose, onSave }) {
  const inputRef = useRef(null)
  const [name, setName] = useState(() => recordDisplayName(record))
  const [error, setError] = useState('')
  const syncsCollectionTitle = record.kind === 'collection' && record.scope === 'my_collections' && Boolean(record.manageToken || getManageToken(record.manageUrl))

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const submit = () => {
    const nextName = name.trim()
    if (!nextName) {
      setError('显示名称不能为空')
      return
    }
    onSave(nextName)
  }

  return (
    <div className="modal-backdrop rename-backdrop" onMouseDown={onClose}>
      <div className="modal rename-modal" role="dialog" aria-modal="true" aria-labelledby="rename-record-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header rename-modal-header">
          <div><p className="eyebrow">文件管理</p><h2 id="rename-record-title">{syncsCollectionTitle ? '重命名收集任务' : '重命名显示名称'}</h2></div>
          <button className="ghost-icon modal-close" aria-label="关闭重命名窗口" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body rename-modal-body">
          <div className="rename-summary">
            <span className={`record-icon ${record.scope}`}><PencilLine size={17} /></span>
            <div><strong>{recordDisplayName(record)}</strong><span>{recordScopeLabel(record.scope)} · {recordExpiryLabel(record)}</span></div>
          </div>
          <label className="manage-field">
            <span>{syncsCollectionTitle ? '新的任务名称' : '新的显示名称'}</span>
            <input ref={inputRef} className="modal-inline-input" value={name} maxLength={80} onChange={(event) => { setName(event.target.value); setError('') }} onKeyDown={(event) => { if (event.key === 'Enter') submit() }} placeholder={syncsCollectionTitle ? '请输入新的任务名称' : '请输入新的显示名称'} />
          </label>
          <p className="rename-helper">{syncsCollectionTitle ? '会同步修改收集任务名称，管理页和提交入口都会显示新名称。' : '仅修改文件管理中心和收发记录中的显示名称，不改动已上传文件本身。'}</p>
          {error && <p className="manage-form-error">{error}</p>}
        </div>
        <div className="modal-footer rename-modal-footer">
          <button className="secondary-button" onClick={onClose}>取消</button>
          <button className="primary-button" onClick={submit}><Check size={15} /> 保存名称</button>
        </div>
      </div>
    </div>
  )
}

const RECORD_SCOPE_TABS = [
  { key: 'all', label: '全部' },
  { key: 'my_sent', label: '我发送的' },
  { key: 'sent_to_me', label: '发给我的' },
  { key: 'my_collections', label: '我收集的' },
  { key: 'collect_from_me', label: '向我收集的' },
]

const RECORD_DATE_FILTERS = [
  ['all', '全部日期'],
  ['today', '今天'],
  ['7d', '近 7 天'],
  ['30d', '近 30 天'],
  ['range', '自定义'],
]

const RECORD_STATUS_FILTERS = [
  ['all', '全部状态'],
  ['active', '有效/进行中'],
  ['expiring', '即将过期'],
  ['expired', '已过期/已截止/已关闭'],
]

const RECORD_VIEW_MODES = [
  ['records', '收发记录'],
  ['files', '文件管理'],
]

const FILE_CATEGORY_FILTERS = [
  ['all', '全部类型'],
  ['image', '图片'],
  ['document', '文档'],
  ['video', '视频'],
  ['audio', '音频'],
  ['archive', '压缩包'],
  ['code', '代码文件'],
  ['collection', '收集任务'],
  ['mixed', '混合文件'],
  ['other', '其他'],
]

function RecordsView({ records, user, syncing = false, onCopy, onCopyQrImage, onDelete, onRename, onClear, onRefresh, onOpen, onOpenCollectionManager, onManage, onCloseManaged, onReopenManaged, onSaveShareExpiry, onNotify }) {
  const [viewMode, setViewMode] = useState('records')
  const [scopeFilter, setScopeFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [fileQuery, setFileQuery] = useState('')
  const [fileCategory, setFileCategory] = useState('all')
  const [expiringOnly, setExpiringOnly] = useState(false)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [openMenu, setOpenMenu] = useState(null)
  const [menuPlacement, setMenuPlacement] = useState('down')
  const [renameTarget, setRenameTarget] = useState(null)
  const [shareExpiryTarget, setShareExpiryTarget] = useState(null)
  const [previewItem, setPreviewItem] = useState(null)
  const [previewChoices, setPreviewChoices] = useState(null)
  const [qrPreview, setQrPreview] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [recordPage, setRecordPage] = useState(1)
  const [filePage, setFilePage] = useState(1)
  const { startDownload: startRecordPreviewDownload, downloadBusy: previewDownloadBusy } = useDownloadTask()

  const normalizedRecords = records.map(normalizeRecord)
  const filteredRecords = normalizedRecords.filter((record) => (
    matchesRecordScope(record, scopeFilter)
    && matchesRecordDate(record, dateFilter, dateFrom, dateTo)
    && matchesRecordStatus(record, statusFilter)
  ))
  const fileItems = managedFileItemsFromRecords(normalizedRecords)
  const filteredFileItems = fileItems.filter((item) => (
    matchesManagedFileSearch(item, fileQuery)
    && matchesManagedFileCategory(item, fileCategory)
    && (!expiringOnly || item.expiringSoon)
  ))
  const recordsPageSize = 8
  const recordPageCount = Math.max(1, Math.ceil(filteredRecords.length / recordsPageSize))
  const filePageCount = Math.max(1, Math.ceil(filteredFileItems.length / recordsPageSize))
  const safeRecordPage = Math.min(recordPage, recordPageCount)
  const safeFilePage = Math.min(filePage, filePageCount)
  const visibleRecords = filteredRecords.slice((safeRecordPage - 1) * recordsPageSize, safeRecordPage * recordsPageSize)
  const visibleFileItems = filteredFileItems.slice((safeFilePage - 1) * recordsPageSize, safeFilePage * recordsPageSize)
  const expiringItems = fileItems.filter((item) => item.expiringSoon)
  const visibleIds = Array.from(new Set((viewMode === 'files' ? visibleFileItems.map((item) => item.record.id) : visibleRecords.map((record) => record.id))))
  const selectedVisibleCount = visibleIds.filter((id) => selectedIds.has(id)).length
  const allVisibleSelected = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length
  const recordCounts = RECORD_SCOPE_TABS.reduce((acc, tab) => {
    acc[tab.key] = tab.key === 'all' ? normalizedRecords.length : normalizedRecords.filter((record) => record.scope === tab.key).length
    return acc
  }, {})
  const managedFileCount = fileItems.reduce((sum, item) => sum + item.fileCount, 0)
  const managedTotalSize = fileItems.reduce((sum, item) => sum + item.size, 0)
  const activeScopeTab = RECORD_SCOPE_TABS.find((tab) => tab.key === scopeFilter) || null
  const scopeClearLabel = scopeFilter === 'all' ? '清空全部' : `清空「${activeScopeTab?.label || '本分类'}」`
  const scopeClearDisabled = !(scopeFilter === 'all' ? normalizedRecords.length : recordCounts[scopeFilter])

  useEffect(() => {
    handleRefresh({ silent: true }).catch(() => {})
  }, [])

  useEffect(() => {
    setSelectedIds(new Set())
    setOpenMenu(null)
    setMenuPlacement('down')
    setRecordPage(1)
    setFilePage(1)
  }, [viewMode, scopeFilter, dateFilter, dateFrom, dateTo, statusFilter, fileQuery, fileCategory, expiringOnly])

  useEffect(() => {
    const liveIds = new Set(normalizedRecords.map((record) => record.id))
    setSelectedIds((current) => {
      const next = new Set(Array.from(current).filter((id) => liveIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [records])

  useEffect(() => {
    if (!openMenu) return undefined
    const closeMenu = () => setOpenMenu(null)
    window.addEventListener('click', closeMenu)
    return () => window.removeEventListener('click', closeMenu)
  }, [openMenu])

  const handleRefresh = async (options = {}) => {
    setRefreshing(true)
    try {
      await onRefresh(options)
    } finally {
      setRefreshing(false)
    }
  }

  const toggleMenu = (menuId, event) => {
    event.stopPropagation()
    if (openMenu !== menuId) {
      const rect = event.currentTarget.getBoundingClientRect()
      const estimatedMenuHeight = 324
      const spaceBelow = window.innerHeight - rect.bottom
      const spaceAbove = rect.top
      setMenuPlacement(spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow ? 'up' : 'down')
    }
    setOpenMenu((current) => (current === menuId ? null : menuId))
  }

  const runMenuAction = (action) => (event) => {
    event.stopPropagation()
    setOpenMenu(null)
    action()
  }

  const toggleRecord = (recordId) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(recordId)) next.delete(recordId)
      else next.add(recordId)
      return next
    })
  }

  const toggleVisibleSelection = () => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id))
      else visibleIds.forEach((id) => next.add(id))
      return next
    })
  }

  const deleteSelected = () => {
    const ids = Array.from(selectedIds)
    if (!ids.length) return
    onDelete(ids)
    setSelectedIds(new Set())
  }

  const hasRecordFilters = dateFilter !== 'all' || Boolean(dateFrom) || Boolean(dateTo) || statusFilter !== 'all'
  const resetRecordFilters = () => {
    setDateFilter('all')
    setDateFrom('')
    setDateTo('')
    setStatusFilter('all')
  }
  const hasFileFilters = Boolean(fileQuery.trim()) || fileCategory !== 'all' || expiringOnly
  const resetFileFilters = () => {
    setFileQuery('')
    setFileCategory('all')
    setExpiringOnly(false)
  }

  const requestRename = (record) => {
    if (!onRename) return
    setRenameTarget(normalizeRecord(record))
  }

  const saveRename = (nextName) => {
    if (!renameTarget || !onRename) return
    onRename(renameTarget, nextName)
    setRenameTarget(null)
  }

  const openRecordPreview = (record) => {
    const previews = recordPreviewConfigs(record)
    if (previews.length === 1) {
      setPreviewItem(previews[0])
      return
    }
    if (previews.length > 1) setPreviewChoices(previews)
  }

  const openCollectionQr = async (record) => {
    const targetUrl = record.publicUrl || record.shareUrl
    if (!targetUrl) return
    try {
      const qrDataUrl = await QRCode.toDataURL(targetUrl, { width: 280, margin: 1 })
      setQrPreview({ qrDataUrl, targetUrl, title: `${recordDisplayName(record)}提交二维码` })
    } catch {
      onCopy?.(targetUrl)
    }
  }

  const openShareQr = async (record) => {
    const targetUrl = record.shareUrl || (record.shareId ? `${window.location.origin}/share/${record.shareId}` : '')
    if (!targetUrl) return
    try {
      const qrDataUrl = await QRCode.toDataURL(targetUrl, { width: 280, margin: 1 })
      setQrPreview({ qrDataUrl, targetUrl, title: `${recordDisplayName(record)}分享二维码`, detail: '扫码打开分享页面' })
    } catch {
      onCopy?.(targetUrl)
    }
  }

  const renderRecordMenu = (record) => {
    const link = recordLink(record)
    const copyTarget = recordCopyTarget(record)
    const shareUrl = record.kind === 'share' ? (record.shareUrl || link) : ''
    const statusGroup = recordStatusGroup(record)
    const closedShare = record.kind === 'share' && isClosedStatus(record.status)
    const reopenableCollection = canReopenCollection(record)
    return (
      <div className={`record-menu row-menu ${menuPlacement === 'up' ? 'menu-up' : ''}`} onClick={(event) => event.stopPropagation()}>
        {record.scope !== 'my_collections' && (
          <button disabled={!copyTarget} onClick={runMenuAction(() => onCopy(copyTarget))}><Copy size={14} /> {recordCopyLabel(record)}</button>
        )}
        {record.scope === 'my_sent' && record.kind === 'share' ? (
          <>
            <button disabled={!shareUrl} onClick={runMenuAction(() => onCopy(shareUrl))}><Link2 size={14} /> 复制分享链接</button>
            <button disabled={!shareUrl} onClick={runMenuAction(() => openShareQr(record))}><QrCode size={14} /> 分享二维码</button>
          </>
        ) : (
          <button disabled={!link} onClick={runMenuAction(() => {
            if (record.scope === 'my_collections' && onOpenCollectionManager) {
              onOpenCollectionManager(recordManageUrl(record))
              return
            }
            onOpen(record)
          })}><ExternalLink size={14} /> {record.scope === 'my_collections' ? '查看已收文件' : recordOpenLabel(record)}</button>
        )}
        <button disabled={!onRename} onClick={runMenuAction(() => requestRename(record))}><PencilLine size={14} /> 重命名</button>
        {record.scope === 'my_sent' && (
          <>
            <button disabled={!recordManageUrl(record)} onClick={runMenuAction(() => onManage(record))}><Settings2 size={14} /> 管理分享设置</button>
            <button disabled={!recordManageUrl(record)} onClick={runMenuAction(() => {
              // 与服务端 applyShareUpdate 同口径：改有效期 = 会员特权（付费且在有效期内），
              // 永久保存才要求 permanent。此前误用 plan.permanent 预检，把月卡/季卡会员拦在门外。
              const hasMembership = Boolean(user?.plan?.permanent || (user?.plan?.id && user?.plan?.id !== 'free'))
              if (!hasMembership) {
                onNotify?.('设置分享截止时间需要会员版或更高权益')
                return
              }
              setShareExpiryTarget(record)
            })}><CalendarDays size={14} /> 设置截至时间</button>
            {closedShare ? (
              <button disabled={!recordManageUrl(record)} onClick={runMenuAction(() => onReopenManaged(record))}><RefreshCw size={14} /> 重新开启分享</button>
            ) : (
              <button className="danger" disabled={!recordManageUrl(record)} onClick={runMenuAction(() => onCloseManaged(record))}><X size={14} /> 关闭分享链接</button>
            )}
          </>
        )}
        {record.scope === 'my_collections' && (
          <>
            <button disabled={!record.publicUrl && !record.shareUrl} onClick={runMenuAction(() => onCopy(record.publicUrl || record.shareUrl))}><Link2 size={14} /> 复制提交链接</button>
            <button disabled={!record.publicUrl && !record.shareUrl} onClick={runMenuAction(() => openCollectionQr(record))}><QrCode size={14} /> 查看提交二维码</button>
            <button disabled={!recordManageUrl(record)} onClick={runMenuAction(() => onManage(record))}><Settings2 size={14} /> 管理收集设置</button>
            {record.status === '已关闭' && reopenableCollection ? (
              <button disabled={!recordManageUrl(record)} onClick={runMenuAction(() => onReopenManaged(record))}><RefreshCw size={14} /> 重新开启收集任务</button>
            ) : statusGroup === 'expired' ? (
              <button disabled={!recordManageUrl(record)} onClick={runMenuAction(() => onManage(record))}><CalendarDays size={14} /> 延长后开启</button>
            ) : (
              <button className="danger" disabled={!recordManageUrl(record) || statusGroup === 'expired'} onClick={runMenuAction(() => onCloseManaged(record))}><X size={14} /> 关闭收集任务</button>
            )}
          </>
        )}
        <button className="danger" onClick={runMenuAction(() => onDelete(record.id))}><Trash2 size={14} /> {user?.id ? '删除记录' : '删除本机记录'}</button>
      </div>
    )
  }

  return (
    <section className="workspace-page records-page">
      <div className="workspace-heading records-heading">
        <div>
          <p className="eyebrow"><span className="eyebrow-dot" /> 你的临时空间</p>
          <h1>{viewMode === 'files' ? '文件管理中心' : '收发记录'}</h1>
          <p>按发送、接收、收集和提交归档最近活动，登录后同步到账号。</p>
        </div>
      </div>

      <div className="records-mode-tabs" role="tablist" aria-label="记录视图">
        {RECORD_VIEW_MODES.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={viewMode === key} className={viewMode === key ? 'active' : ''} onClick={() => setViewMode(key)}>
            <span>{label}</span>
            <strong>{key === 'files' ? fileItems.length : normalizedRecords.length}</strong>
          </button>
        ))}
      </div>

      {viewMode === 'records' ? (
        <>
          <div className="record-scope-tabs" role="tablist" aria-label="记录分类">
            {RECORD_SCOPE_TABS.map((tab) => (
              <button key={tab.key} role="tab" aria-selected={scopeFilter === tab.key} className={scopeFilter === tab.key ? 'active' : ''} onClick={() => setScopeFilter(tab.key)}>
                <span>{tab.label}</span>
                <strong>{recordCounts[tab.key] || 0}</strong>
              </button>
            ))}
          </div>

          <div className="records-filter-panel">
            <div className="records-filter-row">
              <label className="record-filter-field">
                <span>日期</span>
                <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value)}>
                  {RECORD_DATE_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              {dateFilter === 'range' && (
                <div className="record-filter-field record-date-field">
                  <span>日期范围</span>
                  <div className="record-date-range">
                    <DatePicker value={dateFrom} onChange={setDateFrom} ariaLabel="开始日期" placeholder="开始日期" />
                    <DatePicker value={dateTo} onChange={setDateTo} ariaLabel="结束日期" placeholder="结束日期" />
                  </div>
                </div>
              )}
              <label className="record-filter-field">
                <span>状态</span>
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  {RECORD_STATUS_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <div className="record-filter-actions">
                <button className="secondary-button filter-reset-button" onClick={resetRecordFilters} disabled={!hasRecordFilters}><RotateCcw size={15} /> 重置</button>
                <button className="secondary-button" onClick={() => handleRefresh()} disabled={refreshing}><RefreshCw className={refreshing ? 'spinning' : ''} size={16} /> {refreshing ? '刷新中' : '刷新'}</button>
              </div>
            </div>
            <div className="records-bulk-row">
              <label className="record-select-all">
                <input type="checkbox" checked={allVisibleSelected} disabled={!visibleIds.length} onChange={toggleVisibleSelection} />
                <span>已选 {selectedIds.size} 条 · 本页 {visibleRecords.length} 条 / 筛选 {filteredRecords.length} 条</span>
              </label>
              <div className="record-bulk-actions">
                <button className="secondary-button danger-lite" disabled={!selectedIds.size} onClick={deleteSelected}><Trash2 size={15} /> 删除所选</button>
                <button className="secondary-button" disabled={scopeClearDisabled} onClick={() => { onClear(scopeFilter); setSelectedIds(new Set()) }}><Trash2 size={15} /> {scopeClearLabel}</button>
              </div>
            </div>
          </div>

          <div className="records-list enhanced-records-list">
            {filteredRecords.length ? visibleRecords.map((record) => {
              const Icon = recordIconForScope(record.scope)
              const statusGroup = recordStatusGroup(record)
              const selected = selectedIds.has(record.id)
              return (
                <div className={`record-row record-row-enhanced ${selected ? 'selected' : ''}`} key={record.id}>
                  <label className="record-check" aria-label={`选择 ${recordDisplayName(record)}`}>
                    <input type="checkbox" checked={selected} onChange={() => toggleRecord(record.id)} />
                  </label>
                  <span className={`record-icon ${record.scope}`}><Icon size={17} /></span>
                  <div className="record-main">
                    <div className="record-title-line">
                      <RecordNameText name={recordDisplayName(record)} />
                      <FileFormatBadge record={record} />
                      <span className="scope-pill">{recordScopeLabel(record.scope)}</span>
                    </div>
                    <span>{record.meta || recordDetail(record)}</span>
                  </div>
                  <span className="record-expiry">{recordExpiryLabel(record)}</span>
                  <span className={`record-type ${statusGroup}`}>{recordDisplayStatus(record)}</span>
                  <span className="record-code">{record.code || '-'}</span>
                  <div className="menu-wrap row-menu-wrap">
                    {recordPreviewConfigs(record).length > 0 && <button className="ghost-icon record-preview-button" aria-label={`预览文件：${recordDisplayName(record)}`} title="预览文件" onClick={() => openRecordPreview(record)}><Eye size={16} /></button>}
                    <button className="ghost-icon" aria-label={`更多操作：${recordDisplayName(record)}`} onClick={(event) => toggleMenu(record.id, event)}><MoreHorizontal size={17} /></button>
                    {openMenu === record.id && renderRecordMenu(record)}
                  </div>
                </div>
              )
            }) : (
              <div className="empty-manage records-empty"><History size={25} /><span>没有符合当前筛选的记录</span></div>
            )}
          </div>
          <AdminPagination page={safeRecordPage} pageCount={recordPageCount} total={filteredRecords.length} pageSize={recordsPageSize} onPageChange={setRecordPage} />
        </>
      ) : (
        <>
          <div className="file-center-stats">
            <div><span>管理项目</span><strong>{fileItems.length}</strong></div>
            <div><span>文件数</span><strong>{managedFileCount}</strong></div>
            <div><span>总大小</span><strong>{managedTotalSize ? formatBytes(managedTotalSize) : '-'}</strong></div>
            <div><span>即将过期</span><strong>{expiringItems.length}</strong></div>
          </div>

          {expiringItems.length > 0 && (
            <div className="file-expiry-alert">
              <Clock3 size={18} />
              <div><strong>{expiringItems.length} 个项目将在 1 天内过期</strong><span>可进入管理设置延期、关闭或清理记录。</span></div>
              <button className="secondary-button" onClick={() => setExpiringOnly(true)}><FileWarning size={15} /> 查看即将过期</button>
            </div>
          )}

          <div className="records-filter-panel file-center-filter">
            <div className="records-filter-row">
              <label className="record-filter-field file-search-field">
                <span>搜索</span>
                <div className="record-search-box">
                  <Search size={15} />
                  <input value={fileQuery} onChange={(event) => setFileQuery(event.target.value)} placeholder="文件名 / 取件码 / 提交人" />
                </div>
              </label>
              <label className="record-filter-field">
                <span>分类</span>
                <select value={fileCategory} onChange={(event) => setFileCategory(event.target.value)}>
                  {FILE_CATEGORY_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="record-toggle-field">
                <input type="checkbox" checked={expiringOnly} onChange={(event) => setExpiringOnly(event.target.checked)} />
                <span>只看即将过期</span>
              </label>
              <div className="record-filter-actions">
                <button className="secondary-button filter-reset-button" onClick={resetFileFilters} disabled={!hasFileFilters}><RotateCcw size={15} /> 重置</button>
                <button className="secondary-button" onClick={() => handleRefresh()} disabled={refreshing}><RefreshCw className={refreshing ? 'spinning' : ''} size={16} /> {refreshing ? '刷新中' : '刷新'}</button>
              </div>
            </div>
            <div className="records-bulk-row">
              <label className="record-select-all">
                <input type="checkbox" checked={allVisibleSelected} disabled={!visibleIds.length} onChange={toggleVisibleSelection} />
                <span>已选 {selectedIds.size} 项 · 本页 {visibleFileItems.length} 项 / 筛选 {filteredFileItems.length} 项</span>
              </label>
              <div className="record-bulk-actions">
                <button className="secondary-button danger-lite" disabled={!selectedIds.size} onClick={deleteSelected}><Trash2 size={15} /> 删除所选</button>
                <button className="secondary-button" disabled={!normalizedRecords.length} onClick={() => { onClear(); setSelectedIds(new Set()) }}><Trash2 size={15} /> 清空全部</button>
              </div>
            </div>
          </div>

          <div className="records-list enhanced-records-list file-center-list">
            {filteredFileItems.length ? visibleFileItems.map((item) => {
              const record = item.record
              const Icon = fileCategoryIcon(item.category)
              const selected = selectedIds.has(record.id)
              return (
                <div className={`record-row record-row-enhanced file-center-row ${selected ? 'selected' : ''}`} key={item.id}>
                  <label className="record-check" aria-label={`选择 ${item.name}`}>
                    <input type="checkbox" checked={selected} onChange={() => toggleRecord(record.id)} />
                  </label>
                  <span className={`record-icon file-category-${item.category}`}><Icon size={17} /></span>
                  <div className="record-main">
                    <div className="record-title-line">
                      <RecordNameText name={item.name} />
                      <span className="scope-pill">{item.categoryLabel}</span>
                      <span className="scope-pill file-format-pill">{item.formatLabel}</span>
                      <span className="scope-pill muted">{recordScopeLabel(record.scope)}</span>
                    </div>
                    <span>{item.detail}</span>
                  </div>
                  <span className="record-expiry">{recordExpiryLabel(record)}</span>
                  <span className={`record-type ${item.statusGroup}`}>{recordDisplayStatus(record)}</span>
                  <span className="record-code">{item.size ? formatBytes(item.size) : `${item.fileCount || 1} 项`}</span>
                  <div className="menu-wrap row-menu-wrap">
                    {recordPreviewConfigs(record).length > 0 && <button className="ghost-icon record-preview-button" aria-label={`预览文件：${item.name}`} title="预览文件" onClick={() => openRecordPreview(record)}><Eye size={16} /></button>}
                    <button className="ghost-icon" aria-label={`更多操作：${item.name}`} onClick={(event) => toggleMenu(item.id, event)}><MoreHorizontal size={17} /></button>
                    {openMenu === item.id && renderRecordMenu(record)}
                  </div>
                </div>
              )
            }) : (
              <div className="empty-manage records-empty"><HardDrive size={25} /><span>没有符合当前筛选的文件项目</span></div>
            )}
          </div>
          <AdminPagination page={safeFilePage} pageCount={filePageCount} total={filteredFileItems.length} pageSize={recordsPageSize} onPageChange={setFilePage} />
        </>
      )}
      {renameTarget && <RenameRecordModal record={renameTarget} onClose={() => setRenameTarget(null)} onSave={saveRename} />}
      {shareExpiryTarget && <ShareExpiryModal record={shareExpiryTarget} canUsePermanent={Boolean(user?.plan?.permanent)} onClose={() => setShareExpiryTarget(null)} onSave={async (payload) => { const saved = await onSaveShareExpiry?.(shareExpiryTarget, payload); if (saved) setShareExpiryTarget(null); return saved }} />}
      {previewChoices && <RecordPreviewChooser previews={previewChoices} onClose={() => setPreviewChoices(null)} onSelect={(preview) => setPreviewItem(preview)} />}
      {previewItem && <FilePreviewModal preview={previewItem} onClose={() => setPreviewItem(null)} onDownload={() => startRecordPreviewDownload(previewItem.downloadConfig)} downloadDisabled={previewDownloadBusy} />}
      {qrPreview && <QrPreviewModal title={qrPreview.title} detail={qrPreview.detail || '扫码打开提交入口'} qrDataUrl={qrPreview.qrDataUrl} targetUrl={qrPreview.targetUrl} onClose={() => setQrPreview(null)} onCopyImage={() => onCopyQrImage?.(qrPreview.qrDataUrl, qrPreview.targetUrl)} onCopyLink={() => onCopy?.(qrPreview.targetUrl)} />}
      <div className="records-footnote"><HardDrive size={16} /> {syncing ? '账号记录同步中...' : user?.id ? '已登录，记录会同步到账号并可跨设备查看。' : '游客记录仅保留在当前设备，登录后可跨设备同步。'}</div>
    </section>
  )
}

const SETTINGS_NAV_ITEMS = [
  { key: 'profile', label: '个人资料', icon: UserRound, path: '/settings/profile' },
  { key: 'security', label: '账号与安全', icon: ShieldCheck, path: '/settings/security' },
  { key: 'notice', label: '消息通知', icon: Bell, path: '/settings/notice' },
  { key: 'cleanup', label: '文件清理', icon: Trash2, path: '/settings/cleanup' },
]

const DEFAULT_NOTICE_SETTINGS = {
  inApp: true,
  email: false,
  incomingShare: true,
  shareExpiring: true,
  shareDownloaded: true,
  collectionExpiring: true,
  collectionSubmitted: true,
}

function settingsSectionForPath(pathname = '') {
  const section = pathname.split('/')[2]
  return SETTINGS_NAV_ITEMS.some((item) => item.key === section) ? section : 'profile'
}

function SettingsPage({ user, loading, section, onLogin, onLogout, onBack, onSaveProfile, onUpdateUser, onNavigateSection, onOpenWorkspace }) {
  const [nickname, setNickname] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [noticeSettings, setNoticeSettings] = useState(DEFAULT_NOTICE_SETTINGS)
  const [noticeError, setNoticeError] = useState('')
  const [fileCleanupSettings, setFileCleanupSettings] = useState({ enabled: false, days: 3 })
  const [fileCleanupError, setFileCleanupError] = useState('')
  const [bindingType, setBindingType] = useState('')
  const [avatarPreview, setAvatarPreview] = useState('')
  const [avatarError, setAvatarError] = useState('')
  const [savingAvatar, setSavingAvatar] = useState(false)
  const avatarInputRef = useRef(null)

  useEffect(() => {
    if (!user?.id) return
    setNickname(user.nickname || user.username || '')
    setNoticeSettings(normalizeNoticeSettings(user.notificationSettings))
    setNoticeError('')
    setFileCleanupSettings(normalizeFileCleanupSettings(user.fileCleanup))
    setFileCleanupError('')
    setAvatarPreview('')
    setAvatarError('')
  }, [user?.id, user?.notificationSettings, user?.fileCleanup])

  const updateNoticeSetting = (key) => {
    setNoticeError('')
    setNoticeSettings((current) => {
      const next = { ...current, [key]: !current[key] }
      saveCloudNoticeSettings(next)
        .then((data) => {
          const saved = normalizeNoticeSettings(data.settings)
          setNoticeSettings(saved)
          onUpdateUser?.({ ...user, notificationSettings: saved })
        })
        .catch((error) => {
          setNoticeError(error.message || '通知设置保存失败')
          setNoticeSettings(current)
        })
      return next
    })
  }

  const updateFileCleanup = async (patch) => {
    const previous = fileCleanupSettings
    const next = normalizeFileCleanupSettings({ ...previous, ...patch })
    setFileCleanupSettings(next)
    setFileCleanupError('')
    try {
      const data = await saveCloudFileCleanupSettings(next)
      const saved = normalizeFileCleanupSettings(data.settings)
      setFileCleanupSettings(saved)
      onUpdateUser?.({ ...user, fileCleanup: saved })
    } catch (error) {
      setFileCleanupSettings(previous)
      setFileCleanupError(error.message || '文件清理设置保存失败')
    }
  }

  const saveNickname = async (event) => {
    event.preventDefault()
    const nextNickname = nickname.trim()
    if (!nextNickname) return
    setSavingProfile(true)
    setProfileError('')
    try {
      await onSaveProfile({ nickname: nextNickname })
    } catch (error) {
      setProfileError(error.message || '保存失败，请稍后重试')
    } finally {
      setSavingProfile(false)
    }
  }

  const saveAvatarFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setAvatarError('')
    if (!file.type.startsWith('image/')) {
      setAvatarError('请选择图片文件')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setAvatarError('头像图片不能超过 2 MB')
      return
    }
    setSavingAvatar(true)
    try {
      const dataUrl = await resizeAvatarFile(file)
      setAvatarPreview(dataUrl)
      await onSaveProfile({ avatar: dataUrl })
      setAvatarPreview('')
    } catch (error) {
      setAvatarPreview('')
      setAvatarError(error.message || '头像保存失败，请稍后重试')
    } finally {
      setSavingAvatar(false)
    }
  }

  const restoreProviderAvatar = async () => {
    setAvatarError('')
    setSavingAvatar(true)
    try {
      await onSaveProfile({ avatar: null })
    } catch (error) {
      setAvatarError(error.message || '头像恢复失败，请稍后重试')
    } finally {
      setSavingAvatar(false)
    }
  }

  if (loading) {
    return <section className="settings-state"><span className="loading-dot" /><strong>正在加载账户信息</strong><p>请稍候。</p></section>
  }

  if (!user) {
    return (
      <section className="settings-state">
        <div className="settings-state-icon"><UserRound size={23} /></div>
        <strong>登录后管理账户设置</strong>
        <p>个人资料、账号安全和消息通知会与当前账户关联。</p>
        <button className="primary-button" onClick={onLogin}><UserRound size={16} /> 前往登录</button>
      </section>
    )
  }

  return (
    <section className="settings-page">
      <div className="settings-layout">
        <aside className="settings-sidebar">
          <div className="settings-user-card">
            <UserAvatar user={user} />
            <strong>{displayUserName(user)}</strong>
            <span>{displayUserSubtitle(user)}</span>
            <div className="settings-account-line"><CheckCircle2 size={14} /> 鲲穹账号已连接</div>
          </div>
          <nav className="settings-nav" aria-label="账户设置">
            {SETTINGS_NAV_ITEMS.map(({ key, label, icon: Icon, path }) => (
              <button key={key} className={section === key ? 'active' : ''} aria-current={section === key ? 'page' : undefined} onClick={() => { if (section !== key) onNavigateSection?.(path) }}>
                <Icon size={17} />
                <span>{label}</span>
                <ChevronRight size={15} />
              </button>
            ))}
          </nav>
        </aside>

        <div className="settings-panel">
          {section === 'profile' && (
            <>
              <SettingsPanelHeader eyebrow="账户设置" title="个人资料" detail="管理在鲲穹文件传输中展示的账户信息。" onBack={onBack} />
              <div className="settings-form">
                <div className="settings-profile-row">
                  <div className="settings-row-label"><strong>头像</strong><span>上传后仅在当前鲲穹账户中使用</span></div>
                  <div className="settings-avatar-actions">
                    <UserAvatar user={user} overrideSrc={avatarPreview} />
                    <input ref={avatarInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={saveAvatarFile} />
                    <button className="settings-row-action" onClick={() => avatarInputRef.current?.click()} disabled={savingAvatar}>{savingAvatar ? '保存中' : <><ImageIcon size={14} /> 上传头像</>}</button>
                  </div>
                </div>
                {avatarError && <p className="settings-form-error">{avatarError}</p>}
                <div className="settings-avatar-note"><span>未上传时默认显示鲲穹账号的登录头像。</span>{user.avatarSource === 'custom' && <button className="settings-row-action" onClick={restoreProviderAvatar} disabled={savingAvatar}><RotateCcw size={14} /> 恢复登录头像</button>}</div>
                <form className="settings-profile-edit" onSubmit={saveNickname}>
                  <label className="settings-input-field">
                    <span>昵称</span>
                    <input value={nickname} maxLength={40} onChange={(event) => setNickname(event.target.value)} placeholder="请输入昵称" />
                  </label>
                  <button className="primary-button" type="submit" disabled={savingProfile || !nickname.trim()}>{savingProfile ? '保存中' : <><Save size={15} /> 保存昵称</>}</button>
                </form>
                {profileError && <p className="settings-form-error">{profileError}</p>}
                <SettingsInfoRow label="登录账号" value={user.username || user.id || '未设置'} />
                <SettingsInfoRow label="邮箱" value={user.email || '未绑定'} />
                <SettingsInfoRow label="手机号" value={user.phone ? maskPhone(user.phone) : '未绑定'} />
                <AccountCapacityCard user={user} />
                <button className="workspace-entry-button" onClick={onOpenWorkspace}><Building2 size={15} /> 查看会员与团队空间 <ChevronRight size={15} /></button>
                <AccountBenefits benefits={user.benefits} />
              </div>
            </>
          )}

          {section === 'security' && (
            <>
              <SettingsPanelHeader eyebrow="账户设置" title="账号与安全" detail="查看当前登录账户和会话安全状态。" onBack={onBack} />
              <div className="settings-list">
                <SettingsActionRow label="鲲穹账号" value={user.username || user.id || '未设置'} detail={user.id ? `账号 ID：${user.id}` : ''} />
                <SettingsActionRow label="手机号" value={user.phone ? maskPhone(user.phone) : '未绑定手机号'} action={user.phone ? '更换绑定' : '绑定手机号'} onAction={() => setBindingType('phone')} />
                <SettingsActionRow label="邮箱" value={user.email || '未绑定邮箱'} action={user.email ? '更换绑定' : '绑定邮箱'} onAction={() => setBindingType('email')} />
                <SettingsActionRow label="当前会话" value="此设备已安全登录" action="退出登录" onAction={onLogout} />
              </div>
              <div className="settings-notice"><ShieldCheck size={16} /><span>账号认证由鲲穹统一登录中心完成，当前页面仅管理绑定方式和会话。</span></div>
            </>
          )}

          {section === 'notice' && (
            <>
              <SettingsPanelHeader eyebrow="账户设置" title="消息通知" detail="选择你希望收到的账户和文件动态提醒，修改会自动保存。" onBack={onBack} />
              <div className="settings-notice-group">
                <h2>通知方式</h2>
                <NoticeToggle label="站内消息" detail="在鲲穹页面内显示处理结果和状态提醒" checked={noticeSettings.inApp} onChange={() => updateNoticeSetting('inApp')} />
                <NoticeToggle label="邮件提醒" detail="绑定邮箱后接收分享和账户动态提醒" checked={noticeSettings.email} onChange={() => updateNoticeSetting('email')} />
              </div>
              <div className="settings-notice-group">
                <h2>文件与任务动态</h2>
                <NoticeToggle label="有人给我发送文件" checked={noticeSettings.incomingShare} onChange={() => updateNoticeSetting('incomingShare')} />
                <NoticeToggle label="我发送的文件即将过期" checked={noticeSettings.shareExpiring} onChange={() => updateNoticeSetting('shareExpiring')} />
                <NoticeToggle label="我发送的文件已被下载" checked={noticeSettings.shareDownloaded} onChange={() => updateNoticeSetting('shareDownloaded')} />
                <NoticeToggle label="我创建的收集任务即将截止" checked={noticeSettings.collectionExpiring} onChange={() => updateNoticeSetting('collectionExpiring')} />
                <NoticeToggle label="我创建的收集任务有人提交" checked={noticeSettings.collectionSubmitted} onChange={() => updateNoticeSetting('collectionSubmitted')} />
              </div>
              {noticeError && <p className="settings-form-error settings-notice-error">{noticeError}</p>}
            </>
          )}

          {section === 'cleanup' && (
            <>
              <SettingsPanelHeader eyebrow="账户设置" title="文件清理" detail="控制已过期文件是否自动删除，清理后才会释放账号容量。" onBack={onBack} />
              <div className="settings-notice-group file-cleanup-settings">
                <h2><Trash2 size={16} /> 过期文件自动清理</h2>
                <NoticeToggle
                  label="自动删除过期文件"
                  detail="关闭后文件不会自动删除，但会继续占用空间；开启后按下方规则清理。"
                  checked={fileCleanupSettings.enabled}
                  onChange={() => updateFileCleanup({ enabled: !fileCleanupSettings.enabled })}
                />
                <div className={`file-cleanup-options ${fileCleanupSettings.enabled ? '' : 'disabled'}`}>
                  <div className="settings-row-label"><strong>过期后多久删除</strong><span>仅清理已过期的分享文件和收集任务文件。</span></div>
                  <div className="option-grid compact-grid">
                    {[1, 3, 7].map((days) => <button type="button" key={days} disabled={!fileCleanupSettings.enabled} className={fileCleanupSettings.days === days ? 'selected' : ''} onClick={() => updateFileCleanup({ days })}>{days} 天{fileCleanupSettings.days === days && <Check size={14} />}</button>)}
                  </div>
                </div>
                {fileCleanupError && <p className="settings-form-error">{fileCleanupError}</p>}
                <div className="settings-notice"><HardDrive size={16} /><span>文件只有在真正清理后才会从容量统计中扣除；关闭自动清理不会删除已有文件。</span></div>
              </div>
            </>
          )}
        </div>
      </div>
      {bindingType && (
        <AccountBindModal
          type={bindingType}
          currentValue={bindingType === 'email' ? user.email : user.phone}
          onClose={() => setBindingType('')}
          onComplete={(nextUser) => {
            onUpdateUser?.(nextUser)
            setBindingType('')
          }}
        />
      )}
    </section>
  )
}

function TeamPage() {
  const [user, setUser] = useState(null)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(null)
  const [memberTarget, setMemberTarget] = useState('')
  const [memberSuggestions, setMemberSuggestions] = useState([])
  const [savingMember, setSavingMember] = useState(false)
  const [activeTab, setActiveTab] = useState('members')
  const [memberQuery, setMemberQuery] = useState('')
  const [manageMemberQuery, setManageMemberQuery] = useState('')
  const [resourceQuery, setResourceQuery] = useState('')
  const [teamFiles, setTeamFiles] = useState([])
  const [teamUploadState, setTeamUploadState] = useState(createUploadState())
  const [teamUploading, setTeamUploading] = useState(false)
  const teamUploadInputRef = useRef(null)
  const teamUploadRef = useRef(createUploadSessionState())
  const [memberUsagePage, setMemberUsagePage] = useState(1)
  const [teamResourcePage, setTeamResourcePage] = useState(1)
  const [teamMemberPage, setTeamMemberPage] = useState(1)
  const [decidingRequestId, setDecidingRequestId] = useState('')
  const [leavingTeam, setLeavingTeam] = useState(false)
  const [dissolvingTeam, setDissolvingTeam] = useState(false)
  // 成员没有管理权限，若状态残留在「团队成员 / 入团申请」页签会看到空白面板，统一回落到「成员观察」
  const visibleTab = data?.canManage || (activeTab !== 'manage' && activeTab !== 'requests') ? activeTab : 'members'
  const { downloadTask, startDownload, retryDownload, downloadBusy } = useDownloadTask()
  const { confirmState, requestConfirm, settleConfirm } = useConfirmDialog()
  const [previewItem, setPreviewItem] = useState(null)
  // 团队资源可能是「多文件分享」，预览按钮不能只盯着 files[0]：
  // 多文件时先让用户选要预览哪一个（复用记录页的 RecordPreviewChooser）。
  const [previewChoices, setPreviewChoices] = useState(null)
  const load = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true)
    setError('')
    try {
      const auth = await apiRequest('/api/auth/me')
      if (!auth.user) {
        setUser(null)
        return
      }
      setUser(auth.user)
      setData(await apiRequest('/api/account/team/overview'))
    } catch (err) {
      if (silent) setNotice({ message: err.message || '团队数据刷新失败', tone: 'error' })
      else setError(err.message || '团队数据加载失败')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => { load() }, [])
  useEffect(() => {
    if (!notice) return undefined
    const timer = window.setTimeout(() => setNotice(null), 3200)
    return () => window.clearTimeout(timer)
  }, [notice])
  useEffect(() => {
    setMemberUsagePage(1)
    setTeamResourcePage(1)
    setTeamMemberPage(1)
  }, [data?.memberUsage?.length, data?.resources?.length, memberQuery, manageMemberQuery, resourceQuery])
  useEffect(() => {
    if (!data?.canManage || !memberTarget.trim()) {
      setMemberSuggestions([])
      return undefined
    }
    const timer = window.setTimeout(() => {
      apiRequest(`/api/account/workspace/member-search?q=${encodeURIComponent(memberTarget.trim())}`)
        .then((result) => setMemberSuggestions(result.users || []))
        .catch(() => setMemberSuggestions([]))
    }, 180)
    return () => window.clearTimeout(timer)
  }, [data?.canManage, memberTarget])

  const login = () => {
    const returnTo = `${window.location.origin}${window.location.pathname}${window.location.search}${window.location.hash}`
    window.location.href = `/api/auth/login?return_to=${encodeURIComponent(returnTo)}`
  }
  const goWorkspace = () => { window.location.href = '/workspace' }
  const goBack = () => {
    if (window.history.length > 1) window.history.back()
    else window.location.href = '/workspace'
  }
  const inviteMember = async (event) => {
    event.preventDefault()
    if (!memberTarget.trim() || !data?.canManage) return
    setSavingMember(true)
    setError('')
    try {
      await apiRequest('/api/account/workspace/members', { method: 'POST', body: JSON.stringify({ target: memberTarget.trim() }) })
      setMemberTarget('')
      setMemberSuggestions([])
      await load()
    } catch (err) {
      setNotice({ message: err.message || '成员邀请失败', tone: 'error' })
    } finally {
      setSavingMember(false)
    }
  }
  const removeMember = async (member) => {
    if (!data?.canManage || !member?.id || member.role === 'owner') return
    const memberName = member.displayName || member.email || member.phone || '该成员'
    const confirmed = await requestConfirm({
      eyebrow: '团队成员管理',
      title: `移除「${memberName}」`,
      detail: member.status === 'invited'
        ? '移除后，该账号将无法再通过此前收到的邀请加入团队空间。此操作不可撤销，确定继续吗？'
        : `移除后，该成员将无法继续访问“${organization?.name || '团队空间'}”内的共享文件，账号权益也会一并回收。此操作不可撤销，确定继续吗？`,
      confirmText: '确认移除',
      cancelText: '取消',
      tone: 'danger',
    })
    if (!confirmed) return
    setSavingMember(true)
    setError('')
    try {
      const result = await apiRequest(`/api/account/workspace/members/${encodeURIComponent(member.id)}`, { method: 'DELETE' })
      await load()
      setNotice({
        message: member.status === 'invited'
          ? `已移除待加入成员「${memberName}」。`
          : `已移除成员「${memberName}」，站内通知已发送。`,
        tone: 'success',
      })
      return result
    } catch (err) {
      setNotice({ message: err.message || '成员移除失败', tone: 'error' })
    } finally {
      setSavingMember(false)
    }
  }

  // 转让团队所有权：指定正式成员接管，自己降级为普通成员（此后可退出团队空间）。
  const transferOwnership = async (member) => {
    if (!data?.canManage || !member?.id || member.role === 'owner') return
    const memberName = member.displayName || member.email || member.phone || '该成员'
    const confirmed = await requestConfirm({
      eyebrow: '转让团队所有权',
      title: `将团队转让给「${memberName}」`,
      detail: `转让后，「${memberName}」将成为团队所有者，负责成员管理、审批与容量；你将变为普通成员，之后可随时退出团队空间。若对方套餐不含团队版权益，团队空间功能会停用。此操作不可撤销，确定继续吗？`,
      confirmText: '确认转让',
      cancelText: '取消',
      tone: 'danger',
    })
    if (!confirmed) return
    setSavingMember(true)
    setError('')
    try {
      const result = await apiRequest('/api/account/workspace/transfer-ownership', { method: 'POST', body: JSON.stringify({ targetMemberId: member.id }) })
      await load()
      setNotice({ message: `团队所有权已转让给「${result?.nextOwnerName || memberName}」，你现在是团队成员。`, tone: 'success' })
    } catch (err) {
      setNotice({ message: err.message || '团队转让失败', tone: 'error' })
    } finally {
      setSavingMember(false)
    }
  }

  // 解散团队：最高危操作，全员立即失去团队空间访问权（个人数据不受影响）。
  const dissolveTeam = async () => {
    if (!data?.canManage || dissolvingTeam) return
    const memberCount = (data.organization?.members || []).filter((item) => item.status === 'active').length
    const firstConfirmed = await requestConfirm({
      eyebrow: '解散团队',
      title: `解散「${organization?.name || '团队空间'}」`,
      detail: `解散后，全部 ${memberCount} 位成员将立即失去团队空间访问权，团队的分享、收集与专属链接一并停止。所有成员的个人文件、空间容量与套餐权益不受影响。此操作不可撤销。`,
      confirmText: '下一步',
      cancelText: '取消',
      tone: 'danger',
    })
    if (!firstConfirmed) return
    const finalConfirmed = await requestConfirm({
      eyebrow: '解散团队 · 最终确认',
      title: '真的要解散这个团队吗？',
      detail: '解散后团队无法恢复，成员需要重新组建团队并重新邀请才能再次协作。请再次确认。',
      confirmText: '确认解散',
      cancelText: '再想想',
      tone: 'danger',
    })
    if (!finalConfirmed) return
    setDissolvingTeam(true)
    setError('')
    try {
      const result = await apiRequest('/api/account/workspace/dissolve', { method: 'POST' })
      setNotice({ message: `已解散“${organization?.name || '团队空间'}”${result?.notifiedCount ? `，${result.notifiedCount} 位成员已收到通知` : ''}。`, tone: 'success' })
      window.location.href = '/workspace'
    } catch (err) {
      setNotice({ message: err.message || '团队解散失败', tone: 'error' })
    } finally {
      setDissolvingTeam(false)
    }
  }

  // 成员主动退出团队空间。退出的是"团队协作关系"，个人套餐与个人空间不受影响。
  const leaveTeam = async () => {
    if (leavingTeam) return
    const confirmed = await requestConfirm({
      eyebrow: '退出团队空间',
      title: `退出「${organization?.name || '团队空间'}」`,
      detail: '退出后，你将无法继续访问该团队空间内的共享文件与专属链接，团队所有者会收到通知。你个人的文件、空间容量与套餐权益不受任何影响，之后仍可通过邀请重新加入。确定退出吗？',
      confirmText: '确认退出',
      cancelText: '再想想',
      tone: 'danger',
    })
    if (!confirmed) return
    setLeavingTeam(true)
    setError('')
    try {
      await apiRequest('/api/account/workspace/leave', { method: 'POST' })
      setNotice({ message: `已退出“${organization?.name || '团队空间'}”，你的个人空间与套餐不受影响。`, tone: 'success' })
      await load()
    } catch (err) {
      setNotice({ message: err.message || '退出团队失败', tone: 'error' })
    } finally {
      setLeavingTeam(false)
    }
  }

  const reviewJoinRequest = async (request, decision) => {
    if (!data?.canManage || !request?.requestId || decidingRequestId) return
    const applicantName = request.displayName || request.email || request.phone || '该账号'
    const approved = decision === 'approve'
    const confirmed = await requestConfirm({
      eyebrow: '入团申请审批',
      title: approved ? `同意「${applicantName}」加入` : `拒绝「${applicantName}」的申请`,
      detail: approved
        ? `同意后，${applicantName} 将成为“${organization?.name || '团队空间'}”的正式成员，可访问团队共享文件并占用团队容量。确定同意吗？`
        : `拒绝后，${applicantName} 将收到站内通知，并在 24 小时内无法再次申请。确定拒绝吗？`,
      confirmText: approved ? '同意加入' : '拒绝申请',
      cancelText: '取消',
      tone: approved ? 'primary' : 'danger',
    })
    if (!confirmed) return
    setDecidingRequestId(request.requestId)
    setError('')
    try {
      const result = await apiRequest(`/api/account/workspace/join-requests/${encodeURIComponent(request.requestId)}`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      })
      setData((current) => (current ? { ...current, joinRequests: result.joinRequests || [] } : current))
      await load({ silent: true })
      setNotice({ message: approved ? `已同意「${applicantName}」加入团队空间。` : `已拒绝「${applicantName}」的入团申请。`, tone: 'success' })
    } catch (err) {
      setNotice({ message: err.message || '入团申请审批失败', tone: 'error' })
    } finally {
      setDecidingRequestId('')
    }
  }

  const addTeamFiles = (incoming) => {
    const nextFiles = Array.from(incoming || []).map((file, index) => ({
      id: `${file.name}-${file.lastModified}-${index}-${Math.random()}`,
      file,
      name: file.name,
      size: file.size,
      relativePath: file.webkitRelativePath || file.name,
    }))
    if (!nextFiles.length) return
    const names = new Set()
    const duplicate = nextFiles.find((file) => {
      const normalized = file.name.trim().toLowerCase()
      if (names.has(normalized)) return true
      names.add(normalized)
      return false
    })
    if (duplicate) {
      setNotice({ message: `团队空间已存在同名文件“${duplicate.name}”，请修改文件名后再上传。`, tone: 'error' })
      return
    }
    setTeamFiles(nextFiles)
    setTeamUploadState(createUploadState())
    teamUploadRef.current = createUploadSessionState()
    setError('')
  }

  const uploadTeamFiles = async () => {
    if (!teamFiles.length || teamUploading) return
    const uploadCount = teamFiles.length
    setTeamUploading(true)
    setNotice(null)
    try {
      const result = await uploadShareInChunks(
        teamFiles,
        { expiryDays: '0', downloadLimit: 'unlimited', password: '', codeLength: '6', recipients: '' },
        teamUploadRef,
        ({ progress, ...nextState }) => setTeamUploadState((current) => ({ ...current, ...nextState, progress })),
        { sessionBody: { mode: 'team_resource' } },
      )
      if (result?.share) {
        const record = createShareRecord(result.share, 'my_sent')
        saveLocalRecord(record)
        upsertCloudRecords([record]).catch(() => {})
      }
      setTeamFiles([])
      teamUploadRef.current = createUploadSessionState()
      setTeamUploadState(createUploadState())
      await load({ silent: true })
      setNotice({ message: `已成功上传 ${uploadCount} 个文件到团队空间。`, tone: 'success' })
    } catch (err) {
      setTeamUploadState((current) => ({ ...current, status: 'failed', phase: '上传失败', error: err.message }))
      setNotice({ message: err.message || '团队文件上传失败', tone: 'error' })
    } finally {
      setTeamUploading(false)
    }
  }

  if (loading) return <PublicShell><div className="state-block"><span className="loading-dot" /><h1>正在打开团队管理</h1><p>正在读取团队成员和资源使用情况。</p></div></PublicShell>
  if (!user) return <PublicShell><div className="state-block"><div className="settings-state-icon"><Users size={24} /></div><h1>登录后查看团队</h1><p>团队成员、容量和资源使用情况会与鲲穹账号关联。</p><button className="primary-button" onClick={login}><UserRound size={16} /> 使用鲲穹登录</button></div></PublicShell>
  if (error || !data) return <PublicShell><div className="state-block"><div className="settings-state-icon"><Users size={24} /></div><h1>暂未加入团队空间</h1><p>{error || '接受团队邀请后，可以在这里查看团队使用情况。'}</p><button className="secondary-button" onClick={goWorkspace}><ArrowLeft size={15} /> 返回会员与团队空间</button></div></PublicShell>

  const organization = data.organization || {}
  const capacity = data.capacity || {}
  const members = data.memberUsage || []
  const resources = data.resources || []
  const joinRequests = data.joinRequests || []
  const memberName = (userId) => members.find((item) => item.userId === userId)?.displayName || '团队成员'
  // 团队邀请链接：与工作台使用的是同一个企业专属入口。
  const teamInviteLink = organization.slug ? `${window.location.origin}/e/${organization.slug}/share/` : ''
  const copyTeamInviteLink = async () => {
    setNotice(null)
    try {
      await copyTextToClipboard(teamInviteLink)
      setNotice({ message: '团队邀请链接已复制，发给同事即可申请加入', tone: 'success' })
    } catch {
      setNotice({ message: '当前浏览器不支持自动复制，请手动选中链接复制', tone: 'error' })
    }
  }
  const normalizedMemberQuery = memberQuery.trim().toLowerCase()
  const normalizedManageMemberQuery = manageMemberQuery.trim().toLowerCase()
  const normalizedResourceQuery = resourceQuery.trim().toLowerCase()
  const filteredMembers = normalizedMemberQuery
    ? members.filter((member) => [member.displayName, member.email, member.phone, member.userId].some((value) => String(value || '').toLowerCase().includes(normalizedMemberQuery)))
    : members
  const filteredManageMembers = normalizedManageMemberQuery
    ? members.filter((member) => [member.displayName, member.email, member.phone, member.userId].some((value) => String(value || '').toLowerCase().includes(normalizedManageMemberQuery)))
    : members
  const filteredResources = normalizedResourceQuery
    ? resources.filter((resource) => [resource.name, memberName(resource.ownerUserId)].some((value) => String(value || '').toLowerCase().includes(normalizedResourceQuery)))
    : resources
  const totalBytes = Number(capacity.totalBytes || 0)
  const usedBytes = Number(capacity.usedBytes || 0)
  const ratio = totalBytes ? Math.min(100, Math.round((usedBytes / totalBytes) * 100)) : 0
  const statusLabel = (status) => status === 'active' ? '进行中' : status === 'expired' ? '已过期' : status === 'closed' ? '已关闭' : status
  const teamPageSize = 8
  const memberUsagePageCount = Math.max(1, Math.ceil(filteredMembers.length / teamPageSize))
  const teamResourcePageCount = Math.max(1, Math.ceil(filteredResources.length / teamPageSize))
  const teamMemberPageCount = Math.max(1, Math.ceil(filteredManageMembers.length / teamPageSize))
  const safeMemberUsagePage = Math.min(memberUsagePage, memberUsagePageCount)
  const safeTeamResourcePage = Math.min(teamResourcePage, teamResourcePageCount)
  const safeTeamMemberPage = Math.min(teamMemberPage, teamMemberPageCount)
  const visibleMemberUsage = filteredMembers.slice((safeMemberUsagePage - 1) * teamPageSize, safeMemberUsagePage * teamPageSize)
  const visibleTeamResources = filteredResources.slice((safeTeamResourcePage - 1) * teamPageSize, safeTeamResourcePage * teamPageSize)
  const visibleTeamMembers = filteredManageMembers.slice((safeTeamMemberPage - 1) * teamPageSize, safeTeamMemberPage * teamPageSize)
  const downloadResource = (resource) => startDownload(createShareDownloadConfig(resource))
  // 团队资源预览：把资源的每个可预览文件都做成候选。
  // - 只有 1 个可预览文件 → 直接打开
  // - 多个可预览文件     → 弹选择器让用户挑选（与「记录」页交互一致）
  // 之前这里只取 files[0] 且要求 files.length === 1，导致多文件资源的预览按钮
  // 被永久禁用（配合 .ghost-icon:disabled 的 cursor:wait，看起来像一直转圈）。
  const previewResource = (resource) => {
    const files = Array.isArray(resource.files) ? resource.files : []
    const previews = files
      .map((file, index) => (canPreviewFile(file) ? { ...createShareFilePreviewConfig(resource, file, index), key: `${resource.id}:${index}` } : null))
      .filter(Boolean)
    if (previews.length === 1) {
      setPreviewItem(previews[0])
      return
    }
    if (previews.length > 1) setPreviewChoices(previews)
  }
  // 该资源是否有任何可预览文件（决定按钮可用性）
  const resourcePreviewable = (resource) => Array.isArray(resource.files) && resource.files.some((file) => canPreviewFile(file))
  // 关闭分享只切断公开提取链接：所有者仍可打开自己的资源，其他成员按钮禁用并提示。
  const resourceLockedForViewer = (resource) => resource.status === 'closed' && resource.ownerUserId !== user.id
  // 编辑权 = 资源所有者本人 或 团队空间所有者（后端按同规则下发 manageUrl）
  const resourceEditAllowed = (resource) => Boolean(resource.manageUrl) && (resource.ownerUserId === user.id || data.canManage)

  return <PublicShell>
    <section className="team-page">
      <div className="team-page-heading"><div><p className="eyebrow">团队空间</p><h1>{organization.name}</h1><p>统一查看成员使用量、团队资源和空间状态。</p></div><div className="team-page-actions"><button className="secondary-button" onClick={goBack}><ArrowLeft size={15} /> 返回</button></div></div>
      {!data.canManage && <div className="public-card team-panel team-leave-card">
        <div className="team-leave-body">
          <LogOut size={17} />
          <div>
            <strong>你正在共享「{organization.name}」的团队空间</strong>
            <span>团队容量由团队所有者提供，你个人的文件与空间容量不受影响。如果你想结束共享，可以随时退出该团队。</span>
          </div>
        </div>
        <button type="button" className="secondary-button danger-lite team-leave-button" onClick={leaveTeam} disabled={leavingTeam}>
          <LogOut size={14} /> {leavingTeam ? '正在退出' : '退出团队空间'}
        </button>
      </div>}
      {data.canManage && teamInviteLink && <div className="public-card team-panel team-invite-link-card">
        <div className="team-invite-link-head"><Link2 size={16} /><div><strong>团队邀请链接</strong><small>发给同事，对方登录后可在页面底部直接申请加入，申请会出现在「入团申请」里由你审批。</small></div></div>
        <div className="team-invite-link-row">
          <code title={teamInviteLink}>{teamInviteLink}</code>
          <button type="button" className="copy-button" onClick={copyTeamInviteLink}><Copy size={14} /> 复制链接</button>
        </div>
      </div>}
      <div className="team-kpi-grid"><div className="team-kpi"><span><Users size={16} /> 成员</span><strong>{members.filter((item) => item.status !== 'invited').length}</strong><small>{members.filter((item) => item.status === 'invited').length} 个待加入</small></div><div className="team-kpi"><span><HardDrive size={16} /> 已使用空间</span><strong>{formatBytes(usedBytes)}</strong><small>共 {formatBytes(totalBytes)}</small></div><div className="team-kpi"><span><Database size={16} /> 文件资源</span><strong>{resources.reduce((sum, item) => sum + item.fileCount, 0)}</strong><small>{resources.length} 个分享或收集任务</small></div><div className="team-kpi"><span><Link2 size={16} /> 活跃资源</span><strong>{resources.filter((item) => item.status === 'active').length}</strong><small>{data.canManage ? '你是团队所有者' : '团队成员视图'}</small></div></div>
      <div className="team-overview-grid">
        <div className="public-card team-panel team-capacity-panel"><div className="team-panel-heading"><div><p className="eyebrow">空间使用</p><h2>团队容量</h2></div><span className="workspace-status">{ratio}%</span></div><div className="team-capacity-number"><strong>{formatBytes(usedBytes)}</strong><span>/ {formatBytes(totalBytes)}</span></div><div className="capacity-bar"><span style={{ width: `${ratio}%` }} /></div><div className="team-capacity-meta"><span>{capacity.shareCount || 0} 个分享</span><span>{capacity.collectionCount || 0} 个收集任务</span><span>{capacity.fileCount || 0} 个文件</span></div></div>
      </div>
      <div className="team-tabs-shell">
        <div className="team-tabs" role="tablist" aria-label="团队详情">
          <button className={activeTab === 'members' ? 'active' : ''} role="tab" aria-selected={activeTab === 'members'} onClick={() => setActiveTab('members')}><Users size={15} /> 成员观察</button>
          <button className={activeTab === 'resources' ? 'active' : ''} role="tab" aria-selected={activeTab === 'resources'} onClick={() => setActiveTab('resources')}><Database size={15} /> 团队资源 <span>{resources.length}</span></button>
          {data.canManage && <button className={activeTab === 'manage' ? 'active' : ''} role="tab" aria-selected={activeTab === 'manage'} onClick={() => setActiveTab('manage')}><UserPlus size={15} /> 团队成员 <span>{members.length}</span></button>}
          {data.canManage && <button className={activeTab === 'requests' ? 'active' : ''} role="tab" aria-selected={activeTab === 'requests'} onClick={() => setActiveTab('requests')}><ClipboardCheck size={15} /> 入团申请 <span>{joinRequests.length}</span></button>}
        </div>
        {visibleTab === 'members' && <div className="public-card team-panel team-tab-panel"><div className="team-panel-heading"><div><p className="eyebrow">成员观察</p><h2>成员使用量</h2></div><span>{filteredMembers.length} / {members.length} 位成员</span></div>{data.canManage && <div className="team-invite-wrap"><form className="team-invite-form" onSubmit={inviteMember}><label className="team-invite-input"><Search size={15} /><input value={memberTarget} onChange={(event) => setMemberTarget(event.target.value)} placeholder="输入邮箱、手机号或鲲穹账号，直接邀请成员" disabled={savingMember} /></label><button className="primary-button" disabled={savingMember || !memberTarget.trim()}><UserPlus size={14} /> 邀请</button></form>{memberSuggestions.length > 0 && <div className="team-suggestions">{memberSuggestions.map((candidate) => <button type="button" key={candidate.id} onClick={() => { setMemberTarget(candidate.email || candidate.phone || candidate.username || candidate.id); setMemberSuggestions([]) }}><span className="workspace-member-avatar">{(candidate.displayName || '成').slice(0, 1)}</span><span><strong>{candidate.displayName || candidate.username || candidate.id}</strong><small>{candidate.username || candidate.email || candidate.phone || candidate.id}</small></span></button>)}</div>}</div>}<label className="team-search"><Search size={15} /><input value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} placeholder="检索成员姓名、账号、手机号或邮箱" /></label><div className="team-member-usage">{visibleMemberUsage.map((member) => { const memberBytes = Math.max(0, Number(member.usedBytes) || 0); const memberShare = usedBytes > 0 ? Math.min(100, Math.max(0, (memberBytes / usedBytes) * 100)) : 0; const hasUsage = memberBytes > 0; return <div className="team-member-usage-row" key={member.id}><span className="workspace-member-avatar">{(member.displayName || '团').slice(0, 1)}</span><div><div className="team-usage-line"><strong>{member.displayName || '待加入成员'}</strong><small>{member.role === 'owner' ? '所有者' : member.status === 'invited' ? '待加入' : '成员'} · {member.fileCount} 个文件</small></div><div className={`team-usage-bar ${hasUsage ? '' : 'is-empty'}`} title={hasUsage ? `占团队已用空间 ${memberShare.toFixed(memberShare < 1 ? 2 : 1)}%` : '暂未占用团队空间'} role="progressbar" aria-valuenow={Number(memberShare.toFixed(1))} aria-valuemin="0" aria-valuemax="100" aria-label={`${member.displayName || '待加入成员'}空间占用`}><i style={{ width: `${hasUsage ? Math.max(memberShare, 1.5) : 0}%` }} /></div></div><span className="team-usage-value"><b>{formatBytes(memberBytes)}</b><em>{hasUsage ? `${memberShare.toFixed(memberShare < 1 ? 2 : 1)}%` : '未使用'}</em></span></div> })}</div>{!filteredMembers.length && <div className="empty-manage"><Search size={25} /><span>没有匹配的成员</span></div>}<AdminPagination page={safeMemberUsagePage} pageCount={memberUsagePageCount} total={filteredMembers.length} pageSize={teamPageSize} onPageChange={setMemberUsagePage} /></div>}
        {visibleTab === 'resources' && <div className="public-card team-panel team-tab-panel"><div className="team-panel-heading"><div><p className="eyebrow">团队资源</p><h2>专属团队文件</h2></div><span>{filteredResources.length} / {resources.length} 个文件</span></div><div className="team-resource-toolbar"><label className="team-search"><Search size={15} /><input value={resourceQuery} onChange={(event) => setResourceQuery(event.target.value)} placeholder="检索文件名或上传成员" /></label><input ref={teamUploadInputRef} type="file" multiple hidden onChange={(event) => { addTeamFiles(event.target.files); event.target.value = '' }} />{data.organization?.members?.some((member) => member.userId === user.id && member.status === 'active') && <button type="button" className="primary-button" onClick={() => teamUploadInputRef.current?.click()} disabled={teamUploading}><UploadCloud size={15} /> 上传到团队空间</button>}</div>{teamFiles.length > 0 && <div className="team-upload-draft"><div><strong>待上传 {teamFiles.length} 个文件</strong><span>{formatBytes(teamFiles.reduce((sum, file) => sum + file.size, 0))} · 同名文件会被拒绝</span></div><div><button type="button" className="primary-button" onClick={uploadTeamFiles} disabled={teamUploading}><UploadCloud size={14} /> {teamUploading ? '上传中' : '开始上传'}</button><button type="button" className="ghost-icon" onClick={() => setTeamFiles([])} aria-label="清除待上传文件" title="清除待上传文件"><X size={15} /></button></div></div>}{teamUploadState.status !== 'idle' && <div className="team-upload-progress"><div><span>{teamUploadState.phase || '上传处理中'}</span><b>{teamUploadState.progress || 0}%</b></div><div className="capacity-bar"><span style={{ width: `${teamUploadState.progress || 0}%` }} /></div></div>}<div className="team-resource-table">{filteredResources.length ? visibleTeamResources.map((resource) => <div className="team-resource-row" key={`${resource.kind}-${resource.id}`}><span className="team-resource-icon"><FileText size={15} /></span><div><strong>{resource.name}</strong><small>{memberName(resource.ownerUserId)} · {resource.fileCount} 个文件</small></div><span className={`team-resource-status ${resource.status}`}>{statusLabel(resource.status, resource.closeReason)}</span><small className="team-resource-size">{formatBytes(resource.totalSize)}</small><div className="team-resource-actions"><button className={`ghost-icon${resourcePreviewable(resource) && !resourceLockedForViewer(resource) ? '' : ' icon-inapplicable'}`} type="button" onClick={() => previewResource(resource)} disabled={!resourcePreviewable(resource) || resourceLockedForViewer(resource)} aria-label={`预览 ${resource.name}`} title={resourceLockedForViewer(resource) ? '分享已关闭，仅资源所有者可访问' : (resourcePreviewable(resource) ? (resource.files.length === 1 ? '预览文件' : `选择要预览的文件（共 ${resource.files.length} 个）`) : '该资源没有可在线预览的文件')}><Eye size={15} /></button><button className="ghost-icon" type="button" onClick={() => downloadResource(resource)} disabled={downloadBusy || resourceLockedForViewer(resource)} aria-label={`下载 ${resource.name}`} title={resourceLockedForViewer(resource) ? '分享已关闭，仅资源所有者可访问' : '下载文件'}><Download size={15} /></button><button className="ghost-icon" type="button" onClick={() => { if (!resourceEditAllowed(resource)) { setNotice({ message: '仅资源所有者或团队所有者可以编辑该团队资源', tone: 'error' }); return } window.open(resource.manageUrl, '_blank', 'noopener,noreferrer') }} aria-label={`管理 ${resource.name}`} title={resourceEditAllowed(resource) ? '编辑团队资源' : '仅资源所有者或团队所有者可以编辑'}><Settings2 size={15} /></button></div></div>) : <div className="empty-manage"><Database size={25} /><span>{resourceQuery ? '没有匹配的团队文件' : '暂无团队文件，请从专属入口上传'}</span></div>}</div><AdminPagination page={safeTeamResourcePage} pageCount={teamResourcePageCount} total={filteredResources.length} pageSize={teamPageSize} onPageChange={setTeamResourcePage} /></div>}
        {visibleTab === 'manage' && data.canManage && <div className="public-card team-panel team-tab-panel team-members-panel"><div className="team-panel-heading"><div><p className="eyebrow">团队成员</p><h2>成员权限</h2></div><span>{filteredManageMembers.length} / {members.length} 位成员</span></div><label className="team-search team-management-search"><Search size={15} /><input value={manageMemberQuery} onChange={(event) => setManageMemberQuery(event.target.value)} placeholder="检索成员姓名、账号、手机号或邮箱" /></label><div className="team-management-list">{visibleTeamMembers.map((member) => <div className="team-management-row" key={member.id}><span className="workspace-member-avatar">{(member.displayName || '团').slice(0, 1)}</span><div><strong>{member.displayName || '待加入成员'}</strong><small>{member.role === 'owner' ? '所有者' : member.status === 'invited' ? '待加入' : '成员'}</small></div><span className={`workspace-member-state ${member.status === 'invited' ? 'pending' : 'active'}`}>{member.status === 'invited' ? '待加入' : member.role === 'owner' ? '所有者' : '已加入'}</span>{data.canManage && member.role !== 'owner' && <div className="team-management-actions">{member.status === 'active' && <button className="ghost-icon" type="button" onClick={() => transferOwnership(member)} disabled={savingMember} aria-label={`转让给${member.displayName || '成员'}`} title="转让所有权给该成员"><Crown size={15} /></button>}<button className="ghost-icon" type="button" onClick={() => removeMember(member)} disabled={savingMember} aria-label={`移除${member.displayName || '成员'}`} title="移除成员"><X size={15} /></button></div>}</div>)}</div>{!filteredManageMembers.length && <div className="empty-manage"><Search size={25} /><span>没有匹配的团队成员</span></div>}<AdminPagination page={safeTeamMemberPage} pageCount={teamMemberPageCount} total={filteredManageMembers.length} pageSize={teamPageSize} onPageChange={setTeamMemberPage} /><div className="team-danger-zone"><div><strong>解散团队</strong><small>解散后全部成员立即失去团队空间访问权，团队无法恢复。各成员的个人文件与套餐权益不受影响。</small></div><button type="button" className="team-dissolve-button" onClick={dissolveTeam} disabled={dissolvingTeam}><Trash2 size={14} /> {dissolvingTeam ? '解散中…' : '解散团队'}</button></div></div>}
        {visibleTab === 'requests' && data.canManage && <div className="public-card team-panel team-tab-panel team-requests-panel">
          <div className="team-panel-heading"><div><p className="eyebrow">入团申请</p><h2>待处理申请</h2></div><span>{joinRequests.length} 条待处理</span></div>
          <p className="team-requests-hint">成员通过团队的企业专属分享链接提交申请，同意后立即成为正式成员，拒绝后 24 小时内不可再次申请。</p>
          {joinRequests.length ? <div className="team-request-list">{joinRequests.map((request) => <div className="team-request-row" key={request.requestId}>
            <span className="workspace-member-avatar">{(request.displayName || '申').slice(0, 1)}</span>
            <div className="team-request-info">
              <strong>{request.displayName || '待审批申请人'}</strong>
              <small>{request.email || request.phone || request.userId}</small>
              {request.message && <em>申请留言：{request.message}</em>}
            </div>
            <span className="team-request-time">{request.requestedAt ? formatDate(request.requestedAt) : '刚刚提交'}</span>
            <div className="team-request-actions">
              <button type="button" className="primary-button" onClick={() => reviewJoinRequest(request, 'approve')} disabled={Boolean(decidingRequestId)}><Check size={14} /> 同意</button>
              <button type="button" className="secondary-button danger-lite" onClick={() => reviewJoinRequest(request, 'reject')} disabled={Boolean(decidingRequestId)}><X size={14} /> 拒绝</button>
            </div>
          </div>)}</div> : <div className="empty-manage"><ClipboardCheck size={25} /><span>当前没有待处理的入团申请</span></div>}
        </div>}
      </div>
    </section>
    {notice && <div className={`toast ${notice.tone || 'success'}`} role={notice.tone === 'error' ? 'alert' : 'status'} aria-live={notice.tone === 'error' ? 'assertive' : 'polite'}><span className="toast-icon">{notice.tone === 'error' ? <X size={18} /> : <Check size={18} />}</span><span>{notice.message}</span></div>}
    {previewChoices && <RecordPreviewChooser previews={previewChoices} onClose={() => setPreviewChoices(null)} onSelect={(preview) => setPreviewItem(preview)} />}
    {previewItem && <FilePreviewModal preview={previewItem} onClose={() => setPreviewItem(null)} onDownload={() => startDownload(previewItem.downloadConfig)} downloadDisabled={downloadBusy} />}
    {/* 下载进度与上方团队卡片同宽：包一层受限宽容器，避免被 .public-page 的居中网格压缩。 */}
    <div className="team-page team-download-slot"><DownloadProgressPanel task={downloadTask} onRetry={retryDownload} /></div>
    <ConfirmModal state={confirmState} onCancel={() => settleConfirm(false)} onConfirm={() => settleConfirm(true)} />
  </PublicShell>
}

function WorkspacePage() {
  const [user, setUser] = useState(null)
  const [workspace, setWorkspace] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [teamName, setTeamName] = useState('')
  const [editingTeamName, setEditingTeamName] = useState(false)
  const [workspaceName, setWorkspaceName] = useState('')
  const [saving, setSaving] = useState(false)
  const [selectedPlanId, setSelectedPlanId] = useState('')
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const loadRunning = useRef(false)
  // 远端主站套餐实价：工作台展示价与升级弹窗/订单支付同源，拉不到时回落本地配置价
  const remotePricing = useRemotePlanPricing(user?.id)

  const load = async ({ silent = false } = {}) => {
    if (silent && loadRunning.current) return
    loadRunning.current = true
    if (!silent) setLoading(true)
    setError('')
    try {
      const auth = await apiRequest('/api/auth/me')
      if (!auth.user) {
        setUser(null)
        setWorkspace(null)
        return
      }
      setUser(auth.user)
      setWorkspace(await apiRequest('/api/account/workspace'))
    } catch (err) {
      setError(err.message || '团队空间加载失败')
    } finally {
      if (!silent) setLoading(false)
      loadRunning.current = false
    }
  }

  useEffect(() => { load() }, [])
  useEffect(() => {
    if (!user || !workspace?.paymentReconciliation?.pending) return undefined
    const refresh = () => { load({ silent: true }).catch(() => {}) }
    const timer = window.setInterval(refresh, 15000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [user?.id, workspace?.paymentReconciliation?.pending])
  useEffect(() => {
    if (workspace?.plan?.id) setSelectedPlanId(workspace.plan.id)
  }, [workspace?.plan?.id])
  useEffect(() => {
    if (workspace?.organization?.name && !editingTeamName) setWorkspaceName(workspace.organization.name)
  }, [workspace?.organization?.name, editingTeamName])
  useEffect(() => {
    if (!message) return undefined
    const timer = window.setTimeout(() => setMessage(''), 3000)
    return () => window.clearTimeout(timer)
  }, [message])

  const login = () => {
    const returnTo = `${window.location.origin}${window.location.pathname}${window.location.search}${window.location.hash}`
    window.location.href = `/api/auth/login?return_to=${encodeURIComponent(returnTo)}`
  }

  const createTeam = async (event) => {
    event.preventDefault()
    if (!teamName.trim()) return
    if (!workspace?.plan?.team) {
      setError('团队空间需要团队版或企业版权益')
      return
    }
    setSaving(true)
    setError('')
    try {
      setWorkspace(await apiRequest('/api/account/workspace', { method: 'POST', body: JSON.stringify({ name: teamName.trim() }) }))
      setTeamName('')
      setMessage('团队空间已创建')
    } catch (err) {
      setError(err.message || '团队空间创建失败')
    } finally {
      setSaving(false)
    }
  }

  const saveWorkspaceName = async (event) => {
    event.preventDefault()
    const name = workspaceName.trim()
    if (!name || !workspace?.organization || !workspace?.canManage) return
    setSaving(true)
    setError('')
    try {
      setWorkspace(await apiRequest('/api/account/workspace', { method: 'PATCH', body: JSON.stringify({ name }) }))
      setEditingTeamName(false)
      setMessage('团队名称已更新')
    } catch (err) {
      setError(err.message || '团队名称更新失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <PublicShell><div className="state-block"><span className="loading-dot" /><h1>正在打开团队空间</h1><p>正在读取账号权益和团队数据。</p></div></PublicShell>
  if (!user) {
    return <PublicShell><div className="state-block"><div className="settings-state-icon"><Building2 size={24} /></div><h1>登录后使用团队空间</h1><p>会员容量、团队成员和入团申请会与鲲穹账号关联。</p><button className="primary-button" onClick={login}><UserRound size={16} /> 使用鲲穹登录</button></div></PublicShell>
  }
  const plan = workspace?.plan || {}
  const plans = (workspace?.plans || []).map((item) => mergePlanPricing(item, remotePricing))
  const planDisplay = mergePlanPricing(plan, remotePricing)
  const orders = workspace?.orders || []
  const pendingOrder = orders.find((order) => order.status === 'pending_payment') || null
  const selectedPlan = plans.find((item) => item.id === selectedPlanId) || plan
  const capacity = workspace?.capacity || {}
  const organization = workspace?.organization
  // teamEntitlement 是「借用的团队侧能力」，与个人套餐分开：
  // 成员加入团队后可共享团队空间，但个人套餐保持原样（基础版仍是基础版）。
  const teamEntitlement = workspace?.teamEntitlement || {}
  const hasTeamPlan = Boolean(plan.team)
  const canUseTeamSpace = Boolean(teamEntitlement.canUseTeamSpace)
  const teamSpaceBytes = Number(teamEntitlement.teamSpaceBytes || plan.teamSpaceBytes || 0)
  const teamRole = teamEntitlement.role || ''
  const canManageTeam = Boolean(workspace?.canManage)
  const members = organization?.members || []
  const ownerMember = members.find((member) => member.role === 'owner') || members[0] || null
  const selectedTotalBytes = Number(selectedPlan.totalBytes || capacity.totalBytes || 0)
  const ratio = selectedTotalBytes ? Math.min(100, Math.round((capacity.usedBytes / selectedTotalBytes) * 100)) : 0
  const currentPlanLabel = plan.label || '基础版'
  const planValidity = plan.id === 'free' ? '长期免费' : plan.permanent ? '永久有效' : workspace?.planExpiresAt ? `有效至 ${formatDate(workspace.planExpiresAt)}` : '长期有效'
  // 团队邀请入口：走企业专属路径，访客打开后登录即可在页面底部直接申请入团。
  const enterpriseInviteLink = organization ? `${window.location.origin}/e/${organization.slug}/share/` : ''
  const copyEnterpriseLink = async () => {
    setError('')
    setMessage('')
    try {
      await copyTextToClipboard(enterpriseInviteLink)
      setMessage('团队邀请链接已复制，发给同事即可申请加入')
    } catch {
      setError('当前浏览器不支持自动复制，请手动选中链接复制')
    }
  }
  const goBack = () => {
    const referrer = document.referrer
    const hasSameOriginReferrer = referrer && new URL(referrer, window.location.origin).origin === window.location.origin
    if (window.history.length > 1 && hasSameOriginReferrer) {
      window.history.back()
      return
    }
    window.location.href = '/'
  }
  return (
    <PublicShell>
      <section className="workspace-page">
        {(message || error) && <div className="workspace-toast"><FeedbackMessage message={message || error} tone={error ? 'error' : feedbackTone(message)} /></div>}
      <div className="workspace-grid">
            <div className="public-card workspace-hero">
              <div><p className="eyebrow">会员与企业版</p><h1>{currentPlanLabel}空间</h1><p>存储空间、保存策略、团队协作能力均由账号权益统一管控，升级后立即生效。</p></div>
              <button className="secondary-button workspace-back-button" onClick={goBack}><ArrowLeft size={15} /> 返回</button>
            </div>
            <div className="public-card workspace-section workspace-benefits-card">
              <div className="workspace-section-heading"><div><p className="eyebrow">当前权益</p><h2><Crown size={18} /> {currentPlanLabel}</h2><p className="workspace-plan-subtitle">{planValidity} · {formatPlanPrice(planDisplay)}</p></div><span className="workspace-status" title={plan.permanent ? '会员版及以上权益支持永久保存文件。' : '临时保存文件到期会失效。'}>{plan.permanent ? '支持永久保存' : '临时保存'}</span></div>
              <div className="workspace-capacity"><div><span>已使用空间 · {selectedPlan.label || currentPlanLabel}</span><strong>{formatBytes(capacity.usedBytes || 0)} / {formatBytes(selectedTotalBytes)}</strong></div><div className="capacity-bar" title={`已使用 ${ratio}%`} role="progressbar" aria-valuenow={ratio} aria-valuemin="0" aria-valuemax="100"><span style={{ width: `${ratio}%` }} /></div><small>{capacity.shareCount || 0} 个分享 · {capacity.collectionCount || 0} 个收集任务 · {capacity.fileCount || 0} 个文件</small></div>
              <div className="plan-comparison" role="tablist" aria-label="账号权益版本">{plans.map((item) => <button type="button" className={item.id === selectedPlan.id ? 'current' : ''} key={item.id} onClick={() => setSelectedPlanId(item.id)} role="tab" aria-selected={item.id === selectedPlan.id ? 'true' : 'false'}><em className="plan-current-tag">{item.id === plan.id ? '当前' : item.team ? '推荐' : ''}</em><span className="plan-title-line">{(() => { const PlanIcon = accountPlanIcon(item.id); return <PlanIcon size={15} /> })()}<strong>{item.label}</strong></span><PlanSpaceSummary plan={item} /><small className="plan-price-summary">{formatPlanPrice(item)}</small></button>)}</div>
              <div className="workspace-benefits-cta"><span>{plan.id === 'enterprise' ? '你已拥有最高企业版权益。' : '需要更多空间、永久保存或团队协作？'}</span><button className="primary-button" onClick={() => setUpgradeOpen(true)}><Zap size={15} /> {plan.id === 'enterprise' ? '查看权益详情' : '升级权益'}</button></div>
            </div>
            <div className="workspace-lower-row">
            <div className="public-card workspace-section workspace-team-card">
              <div className="workspace-section-heading">
                <div className="workspace-team-heading">
                  <p className="eyebrow">团队空间</p>
                  {organization && editingTeamName ? (
                    <form className="workspace-name-form" onSubmit={saveWorkspaceName}>
                      <input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} maxLength={80} autoFocus aria-label="团队名称" />
                      <button type="submit" className="ghost-icon" disabled={saving || !workspaceName.trim()} aria-label="保存团队名称" title="保存团队名称"><Check size={16} /></button>
                      <button type="button" className="ghost-icon" disabled={saving} onClick={() => { setWorkspaceName(organization.name); setEditingTeamName(false) }} aria-label="取消编辑团队名称" title="取消编辑"><X size={16} /></button>
                    </form>
                  ) : (
                    <div className="workspace-name-line">
                      <h2><Users size={18} /> {organization?.name || '创建团队空间'}</h2>
                      {organization?.canManage !== false && workspace?.canManage && <button type="button" className="ghost-icon" onClick={() => setEditingTeamName(true)} aria-label="编辑团队名称" title="编辑团队名称"><PencilLine size={15} /></button>}
                    </div>
                  )}
                </div>
                {organization
                  ? <span className="workspace-status">{teamRole === 'owner' ? '团队所有者' : '团队成员'}</span>
                  : <span className="workspace-status muted team-required-tag" title={canManageTeam ? '当前权益可以创建团队空间。' : '该功能需要升级团队版权限才可解锁。'}>{canManageTeam ? '可创建' : '需团队版'}</span>}
              </div>
              {!organization ? (
                hasTeamPlan ? <form className="workspace-inline-form" onSubmit={createTeam}><input value={teamName} onChange={(event) => setTeamName(event.target.value)} placeholder="例如：鲲穹设计团队" /><button className="primary-button" disabled={saving || !teamName.trim()}><Building2 size={15} /> 创建团队</button></form> : <div className="workspace-upgrade-notice"><Sparkles size={18} /><div><strong>团队空间属于团队版/企业版权益</strong><span>升级至团队版/企业版后，即可创建团队、邀请成员，生成企业专属分享链接。</span></div></div>
              ) : (
                <>
                  {teamRole === 'owner' && !canManageTeam && <div className="workspace-upgrade-notice"><Sparkles size={18} /><div><strong>当前权益已关闭团队协作</strong><span>恢复团队版或企业版权益后，可以继续邀请和管理成员。</span></div></div>}
                  {teamRole === 'member' && <div className="workspace-share-notice"><Users size={18} /><div><strong>你已加入「{organization.name}」，正在共享团队空间</strong><span>团队空间的容量由团队所有者提供，你个人的空间与权益保持不变。</span></div></div>}
                  <div className="workspace-team-body">
                    <div className="workspace-team-block">
                      <p className="workspace-block-label">团队所有者</p>
                      {ownerMember && <div className="workspace-owner-summary"><span className="workspace-member-avatar">{(ownerMember.displayName || '团').slice(0, 1)}</span><div><strong>{ownerMember.displayName || ownerMember.email || ownerMember.phone || '团队所有者'}</strong><span>{ownerMember.email || ownerMember.phone || ownerMember.userId || '当前账号'} · 所有者</span></div><span className="workspace-member-state active">所有者</span></div>}
                    </div>
                    <div className="workspace-team-block">
                      <p className="workspace-block-label"><Link2 size={14} /> 团队邀请链接</p>
                      {teamRole === 'owner' ? (
                        <>
                          <p className="workspace-block-hint">把它发给同事，对方登录后即可申请加入，申请会出现在团队空间里由你审批。</p>
                          <div className="workspace-invite-link-row">
                            <code title={enterpriseInviteLink}>{enterpriseInviteLink}</code>
                            <button type="button" className="copy-button" onClick={copyEnterpriseLink}><Copy size={14} /> 复制</button>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="workspace-block-hint">邀请链接由团队所有者管理，如需邀请同事请联系所有者。</p>
                          <div className="workspace-invite-link-row">
                            <code title={enterpriseInviteLink}>{enterpriseInviteLink}</code>
                            <button type="button" className="copy-button" onClick={copyEnterpriseLink}><Copy size={14} /> 复制</button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="workspace-team-foot">
                    <span>其他成员、待加入成员和入团申请请前往团队空间查看</span>
                    <button type="button" className="team-manage-link" onClick={() => { window.location.href = '/team' }}><BarChart3 size={14} /> 查看团队成员与使用情况 <ChevronRight size={14} /></button>
                  </div>
                </>
              )}
            </div>
            <div className="public-card workspace-side-card workspace-status-card"><div className="workspace-side-heading"><ListChecks size={22} /><strong>当前状态</strong></div><div className="workspace-status-list"><span className={plan.permanent ? 'on' : 'off'}>{plan.permanent ? <Check size={13} /> : <X size={13} />} 文件永久保存</span><span className={hasTeamPlan || canUseTeamSpace ? 'on' : 'off'}>{hasTeamPlan || canUseTeamSpace ? <Check size={13} /> : <X size={13} />} {teamRole === 'member' && !hasTeamPlan ? '共享团队空间' : '团队协作与成员管理'}</span><span className={organization ? 'on' : 'off'}>{organization ? <Check size={13} /> : <X size={13} />} 分享链接入团申请</span></div>{pendingOrder && <button type="button" className="workspace-pending-banner" onClick={() => setUpgradeOpen(true)}><Clock3 size={14} /> 有 1 个待支付升级订单，点击查看</button>}{workspace?.paymentReconciliation?.requiresLogin && <div className="workspace-payment-warning" role="status">支付订单需要重新登录核对状态。<button type="button" className="team-manage-link" onClick={login}><UserRound size={14} /> 重新登录</button></div>}<button className="primary-button" onClick={() => setUpgradeOpen(true)}><Zap size={15} /> {canManageTeam ? '升级权益' : '查看升级方式'}</button></div>
            </div>
        </div>
      </section>
      {upgradeOpen && <UpgradeModal workspace={workspace} onClose={() => setUpgradeOpen(false)} onRefresh={load} onNotify={(text, tone) => { if (tone === 'error') setError(text); else setMessage(text) }} />}
    </PublicShell>
  )
}

const UPGRADE_ORDER_STATUS_LABELS = {
  pending_payment: '待支付',
  paid: '已开通',
  canceled: '已取消',
  expired: '已过期',
}
const ACCOUNT_PLAN_RANK = { free: 0, member: 1, team: 2, enterprise: 3 }
const accountPlanRank = (planId) => ACCOUNT_PLAN_RANK[planId] ?? 0
const ACCOUNT_PLAN_ICON = { free: HardDrive, member: Sparkles, team: Users, enterprise: Crown }
const accountPlanIcon = (planId) => ACCOUNT_PLAN_ICON[planId] || HardDrive

async function upgradeApiRequest(url, options = {}) {
  const { headers = {}, ...fetchOptions } = options
  const response = await fetch(url, { ...fetchOptions, credentials: 'include', headers: { 'Content-Type': 'application/json', ...headers } })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.message || '请求失败')
    error.order = data.order || null
    throw error
  }
  return data
}

// 远端主站套餐实价（与订单支付同源）：拉取失败或非远端来源时返回 null，调用方沿用本地展示价兜底。
function useRemotePlanPricing(enabledId) {
  const [remotePricing, setRemotePricing] = useState(null)
  useEffect(() => {
    if (!enabledId) return undefined
    let cancelled = false
    upgradeApiRequest('/api/account/upgrade-pricing').then((data) => {
      if (!cancelled && data?.source === 'remote') setRemotePricing(data.pricing || {})
    }).catch(() => { /* 拉不到远端价就沿用本地展示价 */ })
    return () => { cancelled = true }
  }, [enabledId])
  return remotePricing
}

// 把远端实价合并进套餐对象（只改展示字段，不动 permanent/team 等权益字段；
// remotePriced 标记供 formatPlanPrice 区分「天数跟随主站」与本地兜底展示）
function mergePlanPricing(plan, remotePricing) {
  const pricing = remotePricing?.[plan?.id]
  if (!plan || !pricing) return plan
  return { ...plan, monthlyPrice: pricing.priceCents, validityDays: pricing.validityDays, remotePriced: true, remotePackageName: pricing.packageName || '' }
}

function UpgradeModal({ workspace, onClose, onRefresh, onNotify }) {
  const plan = workspace?.plan || {}
  const localPlans = (workspace?.plans || []).filter((item) => item.id !== 'free')
  const pendingOrder = (workspace?.orders || []).find((order) => order.status === 'pending_payment') || null
  const currentPlanRank = accountPlanRank(plan.id)
  const defaultPlanId = localPlans.find((item) => accountPlanRank(item.id) >= currentPlanRank && !(item.id === plan.id && item.permanent))?.id || ''
  const [selectedPlanId, setSelectedPlanId] = useState(defaultPlanId)
  const [orderView, setOrderView] = useState(pendingOrder)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [payType, setPayType] = useState(1)
  const [payment, setPayment] = useState(pendingOrder?.payment || null)
  // 远端主站套餐实价：与订单创建/支付同源，避免「展示价 ≠ 下单应付金额」
  const remotePricing = useRemotePlanPricing(true)
  const plans = localPlans.map((item) => mergePlanPricing(item, remotePricing))

  useEffect(() => {
    if (pendingOrder) setOrderView(pendingOrder)
  }, [pendingOrder])
  useEffect(() => {
    if (!orderView?.payment) return
    setPayment(orderView.payment)
    if (orderView.payType) setPayType(orderView.payType)
  }, [orderView?.id, orderView?.payment, orderView?.payType])
  useEffect(() => {
    if (!payment || !orderView || orderView.status !== 'pending_payment') return undefined
    const timer = window.setInterval(async () => {
      try {
        const result = await upgradeApiRequest(`/api/account/upgrade-orders/${encodeURIComponent(orderView.id)}/pay-status`, { method: 'POST' })
        setOrderView(result.order)
        if (result.workspace) {
          onRefresh?.({ silent: true })
        }
        if (result.order?.status === 'paid') {
          setPayment(null)
          setNotice('支付成功，会员权益已开通')
          onNotify?.('会员权益已开通', 'success')
        }
      } catch {
        // 轮询失败不打断收银台，用户仍可手动重试。
      }
    }, 2000)
    return () => window.clearInterval(timer)
  }, [payment, orderView?.id, orderView?.status])

  const selectedPlan = plans.find((item) => item.id === selectedPlanId && accountPlanRank(item.id) >= currentPlanRank && !(item.id === plan.id && item.permanent)) || null
  const isCurrentPlan = (item) => item.id === plan.id
  const isIncludedPlan = (item) => accountPlanRank(item.id) < currentPlanRank || (item.id === plan.id && item.permanent)

  const createOrder = async () => {
    if (!selectedPlan || busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await upgradeApiRequest('/api/account/upgrade-orders', { method: 'POST', body: JSON.stringify({ planId: selectedPlan.id }) })
      setOrderView(result.order)
      onRefresh?.({ silent: true })
      onNotify?.('升级订单已创建', 'success')
    } catch (err) {
      if (err.order) {
        setOrderView(err.order)
        onRefresh?.({ silent: true })
      } else {
        setError(err.message || '升级订单创建失败')
      }
    } finally {
      setBusy(false)
    }
  }

  const continuePay = async () => {
    if (!orderView || busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await upgradeApiRequest(`/api/account/upgrade-orders/${encodeURIComponent(orderView.id)}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ payType }),
      })
      setOrderView(result.order)
      setPayment(result.payment || null)
      onRefresh?.({ silent: true })
      if (payType === 2) {
        if (result.payment?.alipaysubmit_html) {
          setNotice('支付宝收银台已加载，请完成支付后刷新支付状态')
        } else {
          setError('支付服务未返回支付宝收银台，请稍后重试')
        }
      } else {
        setNotice(result.message || '微信支付二维码已创建，请扫码支付')
      }
    } catch (err) {
      setError(err.message || '支付订单创建失败')
    } finally {
      setBusy(false)
    }
  }

  const checkPayStatus = async () => {
    if (!orderView || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await upgradeApiRequest(`/api/account/upgrade-orders/${encodeURIComponent(orderView.id)}/pay-status`, { method: 'POST' })
      setOrderView(result.order)
      if (result.workspace) onRefresh?.({ silent: true })
      setNotice(result.message || '支付状态已刷新')
      if (result.order?.status === 'paid') {
        setPayment(null)
        onNotify?.('会员权益已开通', 'success')
      }
    } catch (err) {
      setError(err.message || '支付状态查询失败')
    } finally {
      setBusy(false)
    }
  }

  const cancelOrder = async () => {
    if (!orderView || busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await upgradeApiRequest(`/api/account/upgrade-orders/${encodeURIComponent(orderView.id)}/cancel`, { method: 'POST' })
      setOrderView(null)
      onRefresh?.({ silent: true })
      onNotify?.('升级订单已取消', 'success')
    } catch (err) {
      setError(err.message || '订单取消失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal upgrade-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div><p className="eyebrow">会员与企业版</p><h2>{orderView ? (orderView.status === 'paid' ? '支付成功' : '升级订单') : '升级权益'}</h2></div>
          <button className="ghost-icon modal-close" aria-label="关闭升级窗口" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body upgrade-modal-body">
          {error && <FeedbackMessage message={error} tone="error" />}
          {orderView ? (orderView.status === 'paid' ? (
            <div className="upgrade-success-view" role="status">
              <span className="upgrade-success-icon"><BadgeCheck size={34} /></span>
              <h3>{orderView.planLabel}权益已开通</h3>
              <p>{orderView.planId === 'enterprise' ? '文件永久保存，感谢支持' : '文件保存有效期已自动顺延，立即生效'}</p>
              <dl className="upgrade-order-meta">
                <div><dt>支付金额</dt><dd><strong className="upgrade-success-amount">{Number.isFinite(Number(orderView.amount)) ? `¥${(Number(orderView.amount) / 100).toFixed(2)}` : '—'}</strong></dd></div>
                <div><dt>有效期至</dt><dd>{orderView.planId === 'enterprise' ? '永久有效' : orderView.remoteExpireAt ? formatDate(orderView.remoteExpireAt) : '以主站权益为准'}</dd></div>
                <div><dt>订单号</dt><dd><code>{orderView.orderNo}</code><button type="button" className="copy-button" onClick={async () => { try { await copyTextToClipboard(orderView.orderNo); onNotify?.('订单号已复制', 'success') } catch { /* 忽略 */ } }}><Copy size={13} /> 复制</button></dd></div>
                {orderView.paidAt && <div><dt>支付时间</dt><dd>{formatDate(orderView.paidAt)}</dd></div>}
              </dl>
              <div className="upgrade-order-actions">
                <button className="primary-button upgrade-success-done" onClick={onClose}><Check size={15} /> 完成</button>
              </div>
            </div>
          ) : (
            <div className="upgrade-order-view">
              <div className="upgrade-order-head">
                <span className="upgrade-order-plan"><Crown size={18} /> {orderView.planLabel}</span>
                <span className={`upgrade-order-status ${orderView.status}`}>{UPGRADE_ORDER_STATUS_LABELS[orderView.status] || orderView.status}</span>
              </div>
              <dl className="upgrade-order-meta">
                <div><dt>订单号</dt><dd><code>{orderView.orderNo}</code><button type="button" className="copy-button" onClick={async () => { try { await copyTextToClipboard(orderView.orderNo); onNotify?.('订单号已复制', 'success') } catch { /* 忽略 */ } }}><Copy size={13} /> 复制</button></dd></div>
                <div><dt>创建时间</dt><dd>{formatDate(orderView.createdAt)}</dd></div>
                <div><dt>应付金额</dt><dd>{Number.isFinite(Number(orderView.amount)) ? `¥${(Number(orderView.amount) / 100).toFixed(2)}` : '价格以支付通道为准'}</dd></div>
              </dl>
              {!payment && <div className="upgrade-pay-type" role="group" aria-label="支付方式"><button type="button" className={payType === 1 ? 'selected' : ''} onClick={() => setPayType(1)}><ScanLine size={15} /> 微信扫码</button><button type="button" className={payType === 2 ? 'selected' : ''} onClick={() => setPayType(2)}><Wallet size={15} /> 支付宝</button></div>}
              {payment?.qrcode_img_url && <div className="upgrade-payment-qr"><img src={payment.qrcode_img_url} alt="微信支付二维码" /><span>请使用微信扫码支付</span></div>}
              {payment?.alipaysubmit_html && <div className="upgrade-payment-qr upgrade-payment-alipay"><div className="upgrade-payment-alipay-frame"><iframe title="支付宝收银台" scrolling="no" srcDoc={payment.alipaysubmit_html} /></div><span>请使用支付宝扫码支付</span></div>}
              <div className="upgrade-order-note"><Clock3 size={15} /><span>{notice || '请选择支付方式并完成支付，支付成功后会员权益会自动开通。'}</span></div>
              {orderView.status === 'pending_payment' ? (
                <div className="upgrade-order-actions">
                  <button className="primary-button" onClick={continuePay} disabled={busy}><Zap size={15} /> {busy ? '正在处理…' : '继续支付'}</button>
                  {payment && <button className="secondary-button" onClick={checkPayStatus} disabled={busy}><RefreshCw size={15} /> 刷新支付状态</button>}
                  <button className="secondary-button" onClick={cancelOrder} disabled={busy}><X size={15} /> 取消订单</button>
                </div>
              ) : (
                <div className="upgrade-order-actions">
                  <button className="primary-button" onClick={() => { setOrderView(null); setPayment(null); onRefresh?.({ silent: true }) }}><RotateCcw size={15} /> 重新选择套餐</button>
                </div>
              )}
            </div>
          )) : (
            <>
              <p className="upgrade-intro">当前权益：<strong>{plan.label || '基础版'}</strong>。价格和有效期以当前支付套餐为准，创建订单前会同步主站实际金额。</p>
              <div className="upgrade-plan-grid">
                {plans.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={`upgrade-plan-card ${item.id === selectedPlanId ? 'selected' : ''} ${isIncludedPlan(item) ? 'is-current' : ''}`}
                    onClick={() => !isIncludedPlan(item) && setSelectedPlanId(item.id)}
                    disabled={isIncludedPlan(item)}
                    aria-pressed={item.id === selectedPlanId}
                  >
                    <span className="upgrade-plan-top">{(() => { const PlanIcon = accountPlanIcon(item.id); return <span className="upgrade-plan-icon"><PlanIcon size={16} /></span> })()}<strong>{item.label}</strong>{isCurrentPlan(item) ? <em>当前权益</em> : isIncludedPlan(item) ? <em>已包含</em> : item.team ? <em className="hot">团队推荐</em> : null}</span>
                    <PlanSpaceSummary plan={item} compact />
                    <span className="upgrade-plan-tags"><strong className="upgrade-plan-price">{formatPlanPrice(item)}</strong><span className="upgrade-plan-detail">{item.permanent ? '永久保存' : '临时保存'}{item.team ? ' · 团队协作' : ''}</span></span>
                    <ul className="upgrade-plan-features">
                      {(item.features || []).map((feature) => <li key={feature}><Check size={12} /> {feature}</li>)}
                    </ul>
                  </button>
                ))}
              </div>
              {selectedPlan && (
                <div className="upgrade-summary">
                  <span><Sparkles size={14} /> {plan.label || '基础版'} → <strong>{selectedPlan.label}</strong>：{selectedPlan.tagline}</span>
                  <button className="primary-button" onClick={createOrder} disabled={busy}><Zap size={15} /> {busy ? '正在创建…' : selectedPlan.id === plan.id ? '创建续费订单' : '创建升级订单'}</button>
                </div>
              )}
              <p className="upgrade-hint">支付成功后权益自动生效，续费会顺延有效期。</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function AdminPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('dashboard')
  const [savingConfig, setSavingConfig] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [adminInfo, setAdminInfo] = useState(null)
  const [loginBusy, setLoginBusy] = useState(false)
  const [loginError, setLoginError] = useState('')
  const [notice, setNotice] = useState(null)
  const { confirmState, requestConfirm, settleConfirm } = useConfirmDialog()

  // 与用户端一致的右下角 toast 提示
  const showToast = (message, tone = 'success') => setNotice({ message, tone })
  useEffect(() => {
    if (!notice) return undefined
    const timer = window.setTimeout(() => setNotice(null), 3000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const session = await apiRequest('/api/admin/session')
      if (!session.authenticated) {
        setAuthenticated(false)
        setAdminInfo(null)
        setData(null)
        return
      }
      setAuthenticated(true)
      setAdminInfo(session.admin || null)
      setData(await apiRequest('/api/admin/overview'))
    } catch (err) {
      setError(err.message || '后台数据加载失败')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const submitLogin = async ({ username, password }) => {
    setLoginBusy(true)
    setLoginError('')
    try {
      const result = await apiRequest('/api/admin/login', { method: 'POST', body: JSON.stringify({ username, password }) })
      setAuthenticated(true)
      setAdminInfo(result.admin || null)
      setData(result.overview || null)
      setError('')
    } catch (err) {
      setLoginError(err.message || '登录失败')
    } finally {
      setLoginBusy(false)
    }
  }

  const logoutAdmin = async () => {
    try {
      await apiRequest('/api/admin/logout', { method: 'POST' })
    } catch { /* 忽略退出异常，前端一律回到登录态 */ }
    setAuthenticated(false)
    setAdminInfo(null)
    setData(null)
    setError('')
    setLoginError('')
  }
  const updateUser = async (user, patch) => {
    try {
      const result = await apiRequest(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: 'PATCH', body: JSON.stringify(patch) })
      setData((current) => ({ ...current, users: current.users.map((item) => item.id === user.id ? result.user : item) }))
      showToast(patch.status === 'disabled' ? `已禁用 ${user.nickname || user.username || user.id}，其登录会话已全部下线` : patch.status === 'active' ? `已启用 ${user.nickname || user.username || user.id}` : `已更新 ${user.nickname || user.username || user.id} 的套餐权益`)
    } catch (err) {
      showToast(err.message || '用户更新失败', 'error')
    }
  }
  const saveConfig = async (event) => {
    event.preventDefault()
    setSavingConfig(true)
    try {
      const form = new FormData(event.currentTarget)
      const planOverrides = {}
      ;['free', 'member', 'team', 'enterprise'].forEach((planId) => {
        planOverrides[planId] = {
          totalGb: form.get(`plan-${planId}-gb`),
          monthlyPrice: form.get(`plan-${planId}-price`),
          validityDays: form.get(`plan-${planId}-days`) || null,
        }
      })
      const result = await apiRequest('/api/admin/config', { method: 'PATCH', body: JSON.stringify({
        defaultShareDays: form.get('defaultShareDays'),
        maxShareDays: form.get('maxShareDays'),
        anonymousMaxFileSizeMb: form.get('anonymousMaxFileSizeMb'),
        anonymousTotalSizeMb: form.get('anonymousTotalSizeMb'),
        maxBatchFiles: form.get('maxBatchFiles'),
        auditLogRetentionDays: form.get('auditLogRetentionDays'),
        orphanGraceHours: form.get('orphanGraceHours'),
        maintenanceMode: form.get('maintenanceMode') === 'on',
        planOverrides,
      }) })
      setData((current) => ({ ...current, config: result.config }))
      showToast('系统配置已保存，新配置立即生效')
    } catch (err) {
      showToast(err.message || '系统配置保存失败', 'error')
    } finally {
      setSavingConfig(false)
    }
  }
  const runCleanup = async () => {
    const confirmed = await requestConfirm({
      title: '执行存储清理',
      detail: '将永久删除所有已关闭/过期的分享与收集任务及其文件（团队空间资源与仍在有效期的资源不受影响），操作不可恢复。确定继续吗？',
      confirmText: '执行清理',
      tone: 'danger',
    })
    if (!confirmed) return
    try {
      const result = await apiRequest('/api/admin/cleanup', { method: 'POST' })
      setData(result.overview)
      const parts = []
      if (result.expiredShares) parts.push(`分享 ${result.expiredShares} 个`)
      if (result.expiredCollections) parts.push(`收集任务 ${result.expiredCollections} 个`)
      const orphanCount = (result.orphaned?.shares || 0) + (result.orphaned?.collections || 0)
      if (orphanCount) parts.push(`孤儿目录 ${orphanCount} 个`)
      if (result.removedAuditLogs) parts.push(`过期日志 ${result.removedAuditLogs} 条`)
      showToast(parts.length ? `清理完成：已删除 ${parts.join('、')}` : '清理完成：没有需要清理的资源')
    } catch (err) {
      showToast(err.message || '清理失败', 'error')
    }
  }
  if (loading) return <PublicShell><div className="state-block"><span className="loading-dot" /><h1>正在打开后台</h1><p>正在检查管理员登录状态。</p></div></PublicShell>
  // 后台一律先过口令登录。此前这里会因鲲穹白名单账号已登录而直接放行，
  // 表现为「部分账号能直接进后台」—— 白名单通道已移除，访问 /admin 恒定弹登录框。
  if (!authenticated) return <PublicShell><AdminLoginModal onSubmit={submitLogin} busy={loginBusy} error={loginError} onBackHome={() => { window.location.href = '/' }} /></PublicShell>
  if (error && !data) return <PublicShell><div className="state-block"><div className="settings-state-icon"><ShieldCheck size={24} /></div><h1>无法打开后台</h1><p>{error}</p><button className="primary-button" onClick={load}><RefreshCw size={16} /> 重新加载</button><button className="secondary-button" onClick={logoutAdmin}><LogOut size={15} /> 退出后台</button><a className="secondary-button" href="/">返回首页</a></div></PublicShell>
  if (!data) return null
  const stats = data.stats || {}
  const dashboardCards = [['注册用户', stats.users || 0, Users], ['未禁用用户', stats.activeUsers || 0, UserRound], ['分享', stats.shares || 0, Link2], ['收集任务', stats.collections || 0, Inbox], ['占用空间', formatBytes(stats.totalBytes || 0), HardDrive], ['待清理', stats.pendingCleanup || 0, RefreshCw]]
  const trend = data.trend || []
  const trendMax = Math.max(1, ...trend.flatMap((item) => [item.activeUsers, item.uploads, item.downloads]))
  return (
    <PublicShell>
      <section className="admin-page">
        <div className="admin-heading"><div><p className="eyebrow">鲲穹运营后台</p><h1>系统管理</h1><p>统一查看用户、安全日志、运行配置和系统概览。</p></div><div className="admin-heading-actions">{adminInfo?.username && <span className="admin-identity" title={`当前登录管理员：${adminInfo.username}`}><ShieldCheck size={14} /> {adminInfo.username}</span>}<button className="secondary-button" onClick={runCleanup}><RefreshCw size={15} /> 执行清理</button><button className="secondary-button" onClick={load}><RefreshCw size={15} /> 刷新数据</button><button className="secondary-button" onClick={logoutAdmin}><LogOut size={15} /> 退出后台</button></div></div>
        <nav className="admin-tabs" aria-label="后台模块">{[['dashboard', '数据看板', BarChart3], ['resources', '资源管理', Database], ['users', '用户管理', Users], ['security', '安全日志', ShieldCheck], ['config', '系统配置', SlidersHorizontal]].map(([key, label, Icon]) => <button className={tab === key ? 'active' : ''} key={key} onClick={() => setTab(key)}><Icon size={16} /> {label}</button>)}</nav>
        {error && <p className="public-message">{error}</p>}
        <div className="admin-content">
          {tab === 'dashboard' && <><div className="admin-kpi-grid">{dashboardCards.map(([label, value, Icon]) => <div className="admin-kpi" key={label}><span><Icon size={17} /> {label}</span><strong>{value}</strong></div>)}</div><div className="admin-columns"><div className="public-card admin-panel"><div className="admin-panel-heading"><div><p className="eyebrow">近 7 天</p><h2>运营趋势</h2></div></div><div className="admin-trend-list">{trend.map((item) => <div className="admin-trend-row" key={item.date}><span>{item.label}</span><div><i style={{ width: `${(item.activeUsers / trendMax) * 100}%` }} title={`活跃用户 ${item.activeUsers}`} /><i className="upload" style={{ width: `${(item.uploads / trendMax) * 100}%` }} title={`上传 ${item.uploads}`} /><i className="download" style={{ width: `${(item.downloads / trendMax) * 100}%` }} title={`下载 ${item.downloads}`} /></div><small>{item.activeUsers} / {item.uploads} / {item.downloads}</small></div>)}</div><small className="admin-trend-legend"><span><i />活跃用户</span><span><i className="upload" />上传</span><span><i className="download" />下载</span></small></div><div className="public-card admin-panel"><div className="admin-panel-heading"><div><p className="eyebrow">资源状态</p><h2>运营概览</h2></div></div><div className="admin-status-list"><span><i className="status-dot active" /> 活跃资源 <strong>{stats.activeResources || 0}</strong></span><span><i className="status-dot muted" /> 已禁用用户 <strong>{Math.max(0, (stats.users || 0) - (stats.activeUsers || 0))}</strong></span><span><i className="status-dot review" /> 团队空间 <strong>{stats.activeOrganizations || 0}</strong></span></div><div className="admin-log-list">{(data.auditLogs || []).slice(0, 4).map((item) => <div key={item.id}><span>{item.action}</span><small>{formatDate(item.createdAt)} · {item.status || '-'}</small></div>)}</div></div></div></>}
          {tab === 'resources' && <AdminResources resources={data.resources} total={data.totals?.resources ?? data.resources.length} requestConfirm={requestConfirm} onChanged={(message, tone, overview) => { if (overview) { setData((current) => ({ ...current, ...overview })) } else { load() } if (message) showToast(message, tone) }} />}
          {tab === 'users' && <AdminUsers users={data.users} total={data.totals?.users ?? data.users.length} onUpdate={updateUser} />}
          {tab === 'security' && <AdminLogs logs={data.auditLogs} total={data.totals?.auditLogs ?? data.auditLogs.length} />}
          {tab === 'config' && <AdminConfig config={data.config} saving={savingConfig} onSubmit={saveConfig} />}
        </div>
      </section>
      <ConfirmModal state={confirmState} onCancel={() => settleConfirm(false)} onConfirm={() => settleConfirm(true)} />
      {notice && <div className={`toast ${notice.tone || 'success'}`} role={notice.tone === 'error' ? 'alert' : 'status'} aria-live={notice.tone === 'error' ? 'assertive' : 'polite'}><span className="toast-icon">{notice.tone === 'error' ? <X size={18} /> : <Check size={18} />}</span><span>{notice.message}</span></div>}
    </PublicShell>
  )
}

function AdminPagination({ page, pageCount, total, pageSize, onPageChange }) {
  if (total <= pageSize) return null
  const start = (page - 1) * pageSize + 1
  const end = Math.min(total, page * pageSize)
  return <div className="admin-pagination"><span>显示 {start}-{end} / {total}</span><div><button className="secondary-button" onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1}><ChevronLeft size={14} /> 上一页</button><button className="secondary-button" onClick={() => onPageChange(Math.min(pageCount, page + 1))} disabled={page >= pageCount}>下一页 <ChevronRight size={14} /></button></div></div>
}

function AdminResources({ resources = [], total = 0, requestConfirm, onChanged }) {
  const pageSize = 10
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState('')
  const [copiedId, setCopiedId] = useState('')
  const normalizedQuery = query.trim().toLowerCase()
  const filteredResources = normalizedQuery
    ? resources.filter((item) => [item.name, item.id, item.code, item.ownerUserId].some((value) => String(value || '').toLowerCase().includes(normalizedQuery)))
    : resources
  const pageCount = Math.max(1, Math.ceil(filteredResources.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visibleResources = filteredResources.slice((safePage - 1) * pageSize, safePage * pageSize)
  useEffect(() => { setPage(1) }, [resources.length, normalizedQuery])
  const kindLabel = (item) => (item.kind === 'share' ? '分享' : '收集任务')
  const statusLabel = (status) => (status === 'active' ? '活跃' : status === 'expired' ? '已过期' : '已关闭')
  const copyResourceId = async (item) => {
    try {
      await copyTextToClipboard(item.id)
      setCopiedId(item.id)
      setTimeout(() => setCopiedId((current) => (current === item.id ? '' : current)), 1600)
    } catch {}
  }
  const removeResource = async (item) => {
    const confirmed = await requestConfirm({
      title: `删除${kindLabel(item)}？`,
      subject: item.name,
      detail: `将永久删除该资源及其全部文件（${item.fileCount || 0} 个文件，${formatBytes(item.totalSize || 0)}），用户记录中指向它的条目会一并移除${item.status === 'active' ? '；该资源当前仍活跃，删除后提取链接立即失效' : ''}。确定继续吗？`,
      confirmText: '删除资源',
      tone: 'danger',
    })
    if (!confirmed) return
    setBusyId(item.id)
    try {
      // DELETE 响应已携带最新 overview，直接上屏，避免整页退回「正在打开后台」loading
      const result = await apiRequest(`/api/admin/resources/${item.kind}/${encodeURIComponent(item.id)}`, { method: 'DELETE' })
      onChanged?.(`已删除${kindLabel(item)}「${item.name}」`, undefined, result?.overview)
    } catch (err) {
      onChanged?.(err.message || '删除失败', 'error')
    } finally {
      setBusyId('')
    }
  }
  return <div className="public-card admin-panel"><div className="admin-panel-heading"><div><p className="eyebrow">分享与收集</p><h2>资源管理</h2></div><span>共 {total} 个资源{total > resources.length ? ' · 仅显示前 200 条' : ''}</span></div><label className="admin-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索资源名称、ID、提取码或归属用户" /></label><div className="admin-table">{filteredResources.length ? visibleResources.map((item) => <div className="admin-table-row" key={`${item.kind}-${item.id}`}><div className="admin-user-identity"><strong>{kindLabel(item)} · {item.name}</strong><span>{statusLabel(item.status)} · {item.fileCount || 0} 个文件 · {formatBytes(item.totalSize || 0)} · 归属 {item.ownerUserId || '匿名'} · 建于 {formatDate(item.createdAt)}</span><span className="admin-resource-id-row"><button type="button" className="admin-resource-id" title={`资源 ID（${item.kind === 'share' ? '即分享链接 /share/ 末段' : '即收集链接 /collect/ 末段'}），点击复制`} onClick={() => copyResourceId(item)}>{copiedId === item.id ? <Check size={11} /> : <Copy size={11} />}<i>{item.id}</i>{copiedId === item.id ? '已复制' : ''}</button>{item.code ? <em className="admin-resource-code" title="提取码">提取码 {item.code}</em> : null}</span></div><div className="admin-user-actions"><small className="admin-user-usage">{item.expiresAt ? `截止 ${formatDate(item.expiresAt)}` : '永久有效'}</small><button className="secondary-button danger-lite" disabled={busyId === item.id} onClick={() => removeResource(item)}><Trash2 size={14} /> {busyId === item.id ? '删除中' : '删除'}</button></div></div>) : <div className="empty-manage"><Database size={25} /><span>没有匹配的资源</span></div>}</div><AdminPagination page={safePage} pageCount={pageCount} total={filteredResources.length} pageSize={pageSize} onPageChange={setPage} /></div>
}

function AdminUsers({ users = [], total = 0, onUpdate }) {
  const pageSize = 8
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()
  const filteredUsers = normalizedQuery
    ? users.filter((user) => [user.id, user.username, user.nickname, user.email, user.phone].some((value) => String(value || '').toLowerCase().includes(normalizedQuery)))
    : users
  const pageCount = Math.max(1, Math.ceil(filteredUsers.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visibleUsers = filteredUsers.slice((safePage - 1) * pageSize, safePage * pageSize)
  useEffect(() => { setPage(1) }, [users.length, normalizedQuery])
  return <div className="public-card admin-panel"><div className="admin-panel-heading"><div><p className="eyebrow">账号与权益</p><h2>用户管理</h2></div><span>共 {total || users.length} 个用户{total > users.length ? ' · 仅显示前 200 条' : ''}</span></div><label className="admin-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索账号、手机号、邮箱或用户 ID" /></label><div className="admin-table">{filteredUsers.length ? visibleUsers.map((user) => <div className="admin-table-row" key={user.id}><div className="admin-user-identity"><strong>{user.nickname || user.username || user.id}</strong><span>{user.email || user.phone || user.id}</span></div><div className="admin-user-actions"><select className="admin-user-plan" value={user.planId} onChange={(event) => onUpdate(user, { planId: event.target.value })} aria-label={`${user.nickname || user.username || user.id}的套餐`}><option value="free">基础版</option><option value="member">会员版</option><option value="team">团队版</option><option value="enterprise">企业版</option></select><button className={user.status === 'disabled' ? 'secondary-button' : 'secondary-button danger-lite'} onClick={() => onUpdate(user, { status: user.status === 'disabled' ? 'active' : 'disabled' })}>{user.status === 'disabled' ? '启用' : '禁用'}</button><small className="admin-user-usage">{user.planLabel} · {formatBytes(user.usageBytes || 0)}</small></div></div>) : <div className="empty-manage"><Search size={25} /><span>没有匹配的用户</span></div>}</div><AdminPagination page={safePage} pageCount={pageCount} total={filteredUsers.length} pageSize={pageSize} onPageChange={setPage} /></div>
}

function AdminConfig({ config = {}, saving = false, onSubmit }) {
  const overrides = config.planOverrides || {}
  return <form className="public-card admin-panel admin-config-form" onSubmit={onSubmit}>
    <div className="admin-panel-heading"><div><p className="eyebrow">运行参数</p><h2>系统配置</h2></div></div>
    <div className="admin-config-grid">
      <label className="manage-field"><span>默认保存时效（天）</span><input name="defaultShareDays" type="number" min="1" max="365" defaultValue={config.defaultShareDays} /></label>
      <label className="manage-field"><span>普通分享最长有效期（天）</span><input name="maxShareDays" type="number" min="1" max="365" defaultValue={config.maxShareDays} /></label>
      <label className="manage-field"><span>匿名单文件上限（MB）</span><input name="anonymousMaxFileSizeMb" type="number" min="1" max="5120" defaultValue={config.anonymousMaxFileSizeMb} /></label>
      <label className="manage-field"><span>未登录累计传输上限（MB）</span><input name="anonymousTotalSizeMb" type="number" min="0" max="102400" defaultValue={config.anonymousTotalSizeMb} /></label>
      <label className="manage-field"><span>单次最多文件数</span><input name="maxBatchFiles" type="number" min="1" max="100" defaultValue={config.maxBatchFiles} /></label>
      <label className="manage-field"><span>审计日志保留（天）</span><input name="auditLogRetentionDays" type="number" min="1" max="3650" defaultValue={config.auditLogRetentionDays} /></label>
      <label className="manage-field"><span>孤立目录宽限（小时）</span><input name="orphanGraceHours" type="number" min="1" max="720" defaultValue={config.orphanGraceHours} /></label>
    </div>
    <div className="admin-plan-config"><div className="admin-plan-config-heading"><strong>会员权益配置</strong><span>容量使用 GB，价格使用分；价格仍以主站支付套餐为准。</span></div>{[['free', '基础版'], ['member', '会员版'], ['team', '团队版'], ['enterprise', '企业版']].map(([id, label]) => <div className="admin-plan-row" key={id}><strong>{label}</strong><label><span>容量 GB</span><input name={`plan-${id}-gb`} type="number" min="1" step="1" defaultValue={overrides[id]?.totalBytes ? Math.round(overrides[id].totalBytes / 1024 ** 3) : ''} placeholder="默认" /></label><label><span>价格（分）</span><input name={`plan-${id}-price`} type="number" min="0" step="1" defaultValue={overrides[id]?.monthlyPrice ?? ''} placeholder="默认" /></label><label><span>有效期（天）</span><input name={`plan-${id}-days`} type="number" min="1" max="3650" defaultValue={overrides[id]?.validityDays ?? ''} placeholder="永久/默认" /></label></div>)}</div>
    <label className="switch-row"><div><strong>维护模式</strong><span>开启后会阻止非管理员创建分享、收集任务或提交文件。</span></div><input name="maintenanceMode" type="checkbox" defaultChecked={config.maintenanceMode} /></label>
    <button className="primary-button" disabled={saving}><SlidersHorizontal size={15} /> {saving ? '保存中' : '保存配置'}</button>
  </form>
}

function AdminLogs({ logs = [], total = 0 }) {
  const pageSize = 10
  const [page, setPage] = useState(1)
  const pageCount = Math.max(1, Math.ceil(logs.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visibleLogs = logs.slice((safePage - 1) * pageSize, safePage * pageSize)
  useEffect(() => { setPage(1) }, [logs.length])
  return <div className="public-card admin-panel"><div className="admin-panel-heading"><div><p className="eyebrow">安全与访问</p><h2>审计日志</h2></div><span>共 {total || logs.length} 条日志{total > logs.length ? ' · 仅显示最近 100 条' : ''}</span></div><div className="admin-log-list admin-log-list-large">{logs.length ? visibleLogs.map((item) => <div key={item.id}><span><strong>{item.type === 'security' ? '安全拦截' : item.type === 'admin' ? '管理员操作' : '访问'}</strong> {item.action}</span><small>{formatDate(item.createdAt)} · 状态 {item.status || '-'} · IP 摘要 {item.ip || '-'}</small></div>) : <div className="empty-manage"><ShieldCheck size={25} /><span>暂无日志</span></div>}</div><AdminPagination page={safePage} pageCount={pageCount} total={logs.length} pageSize={pageSize} onPageChange={setPage} /></div>
}

function SettingsPanelHeader({ eyebrow, title, detail, onBack }) {
  return <div className="settings-panel-header"><div className="settings-panel-header-top"><p className="eyebrow">{eyebrow}</p><button className="settings-back-button" onClick={onBack}><ArrowLeft size={15} /> 返回</button></div><h1>{title}</h1><p>{detail}</p></div>
}

function SettingsInfoRow({ label, value }) {
  return <div className="settings-info-row"><strong>{label}</strong><span>{value}</span></div>
}

function AccountCapacityCard({ user }) {
  // 设置页套餐价与升级弹窗/工作台同源（远端主站实价），拉不到时回落本地配置价
  const remotePricing = useRemotePlanPricing(user?.id)
  const capacity = user?.capacity || {}
  const plan = user?.plan || {}
  const planDisplay = mergePlanPricing(plan, remotePricing)
  const usedBytes = Number(capacity.usedBytes || 0)
  const totalBytes = Number(capacity.totalBytes || 0)
  const ratio = totalBytes ? Math.min(100, Math.round((usedBytes / totalBytes) * 100)) : 0
  const validity = plan.id === 'free' ? '长期免费' : plan.permanent ? '永久有效' : user.planExpiresAt ? `有效至 ${formatDate(user.planExpiresAt)} · 剩余${planDaysRemaining(user.planExpiresAt)}天` : '长期有效'
  return (
    <div className="account-capacity-card">
      <div>
        <span>账号容量 · {plan.label || '基础版'}</span>
        <strong>{usedBytes ? formatBytes(usedBytes) : '0 KB'} / {totalBytes ? formatBytes(totalBytes) : '不限容量'}</strong>
      </div>
      <div className="capacity-bar" aria-label={`容量已使用 ${ratio}%`}><span style={{ width: `${ratio}%` }} /></div>
      <div className="capacity-meta">
        <span>{capacity.shareCount || 0} 个分享</span>
        <span>{capacity.collectionCount || 0} 个收集任务</span>
        <span>{capacity.fileCount || 0} 个文件</span>
      </div>
      <div className="account-plan-meta"><strong>{plan.label || '基础版'}</strong><span>{validity}</span><span>{formatPlanPrice(planDisplay)}</span></div>
      {user?.teamEntitlement?.organizationName && (
        <p className="account-team-hint">
          <Users size={13} />
          {user.teamEntitlement.role === 'owner'
            ? `你是「${user.teamEntitlement.organizationName}」的所有者，团队空间容量 ${formatBytes(user.teamEntitlement.teamSpaceBytes || 0)}`
            : `已加入「${user.teamEntitlement.organizationName}」，共享团队空间 ${formatBytes(user.teamEntitlement.teamSpaceBytes || 0)}，个人套餐不受影响`}
        </p>
      )}
    </div>
  )
}

function AccountBenefits({ benefits = [] }) {
  if (!benefits.length) return null
  return (
    <div className="account-benefits">
      {benefits.map((benefit) => (
        <div className={benefit.enabled ? '' : 'disabled'} key={benefit.label}>
          <CheckCircle2 size={15} />
          <span><strong>{benefit.label}</strong><small>{benefit.detail}</small></span>
        </div>
      ))}
    </div>
  )
}

function SettingsActionRow({ label, value, detail, action, onAction, disabled = false }) {
  return (
    <div className="settings-action-row">
      <div><strong>{label}</strong><span>{value}</span>{detail && <small>{detail}</small>}</div>
      {action && <button className={disabled || !onAction ? 'settings-row-action disabled' : 'settings-row-action'} onClick={onAction} disabled={disabled || !onAction}>{action}{!disabled && onAction && <ChevronRight size={15} />}</button>}
    </div>
  )
}

function AccountBindModal({ type, currentValue, onClose, onComplete }) {
  const isEmail = type === 'email'
  const label = isEmail ? '邮箱' : '手机号'
  const [target, setTarget] = useState(currentValue || '')
  const [code, setCode] = useState('')
  const [debugCode, setDebugCode] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [binding, setBinding] = useState(false)
  const [resendSeconds, setResendSeconds] = useState(0)

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])
  useEffect(() => {
    if (resendSeconds <= 0) return undefined
    // 只在倒计时启动/结束时创建、清理定时器，避免每秒销毁重建 interval
    const timer = window.setInterval(() => {
      setResendSeconds((current) => Math.max(0, current - 1))
    }, 1000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resendSeconds > 0])

  const sendCode = async () => {
    if (!target.trim()) {
      setError(`请输入要绑定的${label}`)
      return
    }
    setSending(true)
    setError('')
    setMessage('')
    try {
      const data = await requestAccountBindCode(target.trim())
      setDebugCode(data.debugCode || '')
      setMessage(data.message || '绑定验证码已生成')
      setResendSeconds(60)
    } catch (err) {
      setError(err.message || '验证码发送失败')
    } finally {
      setSending(false)
    }
  }

  const submit = async (event) => {
    event.preventDefault()
    if (!target.trim() || !code.trim()) {
      setError(`请输入${label}和验证码`)
      return
    }
    setBinding(true)
    setError('')
    try {
      const data = await bindAccountTarget(target.trim(), code.trim())
      onComplete(data.user)
    } catch (err) {
      setError(err.message || '绑定失败')
    } finally {
      setBinding(false)
    }
  }

  return (
    <div className="modal-backdrop account-bind-backdrop">
      <form className="modal account-bind-modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div><p className="eyebrow">账号绑定</p><h2>绑定{label}</h2></div>
          <button className="ghost-icon modal-close" type="button" aria-label="关闭绑定窗口" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body account-bind-body">
          <p className="modal-intro">登录仍使用鲲穹官方账号；绑定{label}后，可用于站内消息匹配和后续邮件/短信通知。</p>
          <label className="settings-input-field">
            <span>{label}</span>
            <input value={target} onChange={(event) => { setTarget(event.target.value); setError('') }} placeholder={isEmail ? 'name@example.com' : '请输入手机号'} />
          </label>
          <div className="account-bind-code-row">
            <label className="settings-input-field">
              <span>验证码</span>
              <input value={code} maxLength={6} onChange={(event) => { setCode(event.target.value.replace(/\D/g, '').slice(0, 6)); setError('') }} placeholder="6 位验证码" />
            </label>
            <button className="secondary-button" type="button" onClick={sendCode} disabled={sending || resendSeconds > 0}>{sending ? '发送中' : resendSeconds > 0 ? `${resendSeconds}秒后重发` : debugCode ? '重新发送' : '获取验证码'}<Send size={15} /></button>
          </div>
          {debugCode && <div className="account-bind-debug"><KeyRound size={14} /> 演示验证码：<strong>{debugCode}</strong></div>}
          {message && <p className="account-bind-message">{message}</p>}
          {error && <p className="settings-form-error account-bind-error">{error}</p>}
        </div>
        <div className="modal-footer">
          <button className="secondary-button" type="button" onClick={onClose}>取消</button>
          <button className="primary-button" type="submit" disabled={binding}><BadgeCheck size={15} /> {binding ? '绑定中' : '确认绑定'}</button>
        </div>
      </form>
    </div>
  )
}
function NoticeToggle({ label, detail, checked, onChange }) {
  return (
    <div className="settings-notice-row">
      <div><strong>{label}</strong>{detail && <span>{detail}</span>}</div>
      <button className={`switch ${checked ? 'on' : ''}`} aria-label={`${checked ? '关闭' : '开启'}${label}`} aria-pressed={checked} onClick={onChange}><span /></button>
    </div>
  )
}

function PublicShell({ children }) {
  return <div className="app-shell public-shell"><header className="topbar"><div className="brand"><img className="brand-logo" src="/brand-logo.png" alt="鲲穹文件传输" /></div><span className="public-safe"><ShieldCheck size={15} /> 安全临时空间</span></header><main className="public-page">{children}</main><footer className="page-footer"><span>鲲穹文件传输 · 临时传输，轻装上阵</span><div><a className="footer-manual-link" href="/user-manual.html" target="_blank" rel="noopener noreferrer">使用手册</a></div></footer></div>
}

function StateBlock({ title, detail }) { return <div className="state-block"><ShieldCheck size={26} /><h1>{title}</h1><p>{detail}</p><a className="primary-button" href="/">返回鲲穹首页</a></div> }
function LoadingBlock() { return <div className="state-block"><span className="loading-dot" /><h1>正在打开</h1><p>正在检查分享状态，请稍候。</p></div> }
function NavItem({ icon: Icon, label, active, onClick }) { return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}><Icon size={17} strokeWidth={2} /><span>{label}</span></button> }
function MessageCenter({ user, messages, open, onToggle, onClose, onMarkRead, onMarkAllRead, onDelete, onClearAll, onLogin, onInvitationAction }) {
  const unreadCount = messages.filter((message) => message.unread).length
  // 长消息默认两行截断，点击展开/收起完整正文（展开的同时保留标已读行为）
  const [expandedIds, setExpandedIds] = useState(() => new Set())
  const toggleExpanded = (message) => {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(message.id)) next.delete(message.id)
      else next.add(message.id)
      return next
    })
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
              {messages.map((message) => (
                <div key={message.id} className={`message-item ${message.unread ? 'unread' : ''}`}>
                  <button className="message-item-main" onClick={() => { onMarkRead(message); toggleExpanded(message) }} aria-expanded={expandedIds.has(message.id)}>
                  <span className={`message-item-icon ${message.category}`}><MessageIcon category={message.category} /></span>
                  <span className="message-item-content"><strong>{message.title}</strong><span className={expandedIds.has(message.id) ? 'expanded' : ''}>{message.body}</span><small>{formatMessageTime(message.createdAt)}{message.body.length > 60 ? ` · ${expandedIds.has(message.id) ? '点击收起' : '点击展开'}` : ''}</small></span>
                  {message.unread && <i className="message-item-dot" />}
                  </button>
                  {message.actionType === 'workspace_invite' && <div className="message-invite-actions"><button type="button" className="secondary-button" onClick={() => onInvitationAction?.(message, 'decline')}><UserX size={15} /> 拒绝</button><button type="button" className="primary-button" onClick={() => onInvitationAction?.(message, 'accept')}><UserCheck size={15} /> 接受加入</button></div>}
                  <button className="message-item-delete" aria-label={`删除消息：${message.title}`} title="删除消息" onClick={(event) => { event.stopPropagation(); onDelete(message) }}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          ) : (
            <div className="message-empty"><Bell size={22} /><strong>暂无消息</strong><span>新的动态会显示在这里。</span></div>
          )}
        </div>
      )}
    </div>
  )
}
function MessageIcon({ category }) {
  if (category === 'official') return <Megaphone size={15} />
  if (category === 'other') return <MessageCircle size={15} />
  return <ShieldCheck size={15} />
}
function AuthButton({ user, loading, menuOpen, onLogin, onToggleMenu, onSettings, onLogout }) {
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
function UserAvatar({ user, overrideSrc = '' }) {
  const avatarSrc = overrideSrc || userAvatarSource(user)
  return avatarSrc ? <img className="user-avatar" src={avatarSrc} alt={`${displayUserName(user)}头像`} /> : <span className="user-avatar">{displayUserInitial(user)}</span>
}
function RecordNameText({ name }) {
  const text = String(name || '').trim() || '文件分享'
  const { base, extension } = splitFileNameForDisplay(text)
  return (
    <strong className="record-name-text" title={text}>
      <span>{base}</span>{extension && <em>{extension}</em>}
    </strong>
  )
}
function FileFormatBadge({ file, record, label = '' }) {
  const text = label || fileFormatLabel(file, record)
  return text ? <span className="file-format-badge">{text}</span> : null
}
function FeatureOrb({ icon: Icon, value, label, tone }) { return <div className={`feature-orb ${tone}`}><span className="orb-icon"><Icon size={21} /></span><strong>{value}</strong><span>{label}</span></div> }
function ValueItem({ icon: Icon, title, detail }) { return <div className="value-item"><span className="value-icon"><Icon size={18} /></span><div><strong>{title}</strong><span>{detail}</span></div></div> }
function FileRow({ file, onRemove, onPreview, onDownload, downloadDisabled = false }) {
  const Icon = fileIcon(file.name)
  return (
    <div className="file-row">
      <span className="file-type"><Icon size={18} /></span>
      <div className="file-info"><strong>{file.name}</strong><span><FileFormatBadge file={file} /> {formatBytes(file.size)}</span></div>
      {onPreview && <button className="ghost-icon" aria-label={`预览 ${file.name}`} onClick={onPreview}><Eye size={16} /></button>}
      {onDownload && <button className="ghost-icon" aria-label={`下载 ${file.name}`} onClick={onDownload} disabled={downloadDisabled}><Download size={16} /></button>}
      {onRemove && <button className="ghost-icon" aria-label={`移除 ${file.name}`} onClick={onRemove}><X size={16} /></button>}
    </div>
  )
}
function toFileItems(incoming) { return Array.from(incoming || []).map((file, index) => ({ id: `${file.name}-${file.lastModified}-${index}`, file, name: file.name, size: file.size, mimeType: file.type || 'application/octet-stream', relativePath: file.webkitRelativePath || file.name })) }
function compactRecordFiles(files = []) {
  if (!Array.isArray(files)) return []
  return files.map((file, index) => ({
    name: String(file?.name || `文件 ${index + 1}`).trim(),
    relativePath: String(file?.relativePath || file?.webkitRelativePath || file?.name || `文件 ${index + 1}`).trim(),
    size: Number(file?.size || 0),
    mimeType: String(file?.mimeType || file?.type || file?.file?.type || '').trim(),
  })).filter((file) => file.name)
}

function compactRecordSubmissions(submissions = []) {
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
const RECORD_STORAGE_KEY = 'kunqiong-records'
const MAX_LOCAL_RECORDS = 100
const EXPIRING_SOON_MS = 24 * 60 * 60 * 1000

function readRecords() {
  try {
    return normalizeRecords(JSON.parse(window.localStorage.getItem(RECORD_STORAGE_KEY) || '[]'))
  } catch {
    return []
  }
}

function writeRecords(records) {
  const next = normalizeRecords(records).slice(0, MAX_LOCAL_RECORDS)
  // 隐私模式 / 存储配额满时 setItem 会抛异常，不能让本地上报中断上传/分享主流程。
  try {
    window.localStorage.setItem(RECORD_STORAGE_KEY, JSON.stringify(next))
  } catch (error) {
    console.warn('本地记录保存失败（存储不可用）', error)
  }
  // 调用方（saveLocalRecord 等）依赖返回值更新 state，必须返回写入后的数组。
  return next
}

function saveLocalRecord(record, currentRecords) {
  return writeRecords(upsertRecords(currentRecords || readRecords(), [record]))
}

function saveAuthoritativeLocalRecord(record, currentRecords) {
  const normalized = normalizeRecord(record)
  const existing = normalizeRecords(currentRecords || readRecords()).filter((item) => item.id !== normalized.id)
  return writeRecords([normalized, ...existing])
}

async function fetchCloudRecords() {
  const data = await apiRequest('/api/account/records')
  return normalizeRecords(data.records || [])
}

async function replaceCloudRecords(records) {
  return apiRequest('/api/account/records', {
    method: 'PUT',
    body: JSON.stringify({ records: normalizeRecords(records) }),
  })
}

async function upsertCloudRecords(records) {
  return apiRequest('/api/account/records', {
    method: 'POST',
    body: JSON.stringify({ records: normalizeRecords(records) }),
  })
}

async function deleteCloudRecords(ids) {
  return apiRequest('/api/account/records', {
    method: 'DELETE',
    body: JSON.stringify({ ids }),
  })
}

async function clearCloudRecords() {
  return apiRequest('/api/account/records', { method: 'DELETE' })
}

async function fetchCloudMessages() {
  return apiRequest('/api/account/messages')
}

async function markCloudMessageRead(id) {
  return apiRequest(`/api/account/messages/${encodeURIComponent(id)}`, { method: 'PATCH' })
}

async function markAllCloudMessagesRead() {
  return apiRequest('/api/account/messages', { method: 'PATCH' })
}

async function deleteCloudMessage(id) {
  return apiRequest(`/api/account/messages/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

async function deleteAllCloudMessages() {
  return apiRequest('/api/account/messages', { method: 'DELETE' })
}

async function respondWorkspaceInvitation(invitationId, decision) {
  return apiRequest(`/api/account/workspace/invitations/${encodeURIComponent(invitationId)}`, {
    method: 'POST',
    body: JSON.stringify({ decision }),
  })
}

async function saveCloudNoticeSettings(settings) {
  return apiRequest('/api/account/notification-settings', {
    method: 'PUT',
    body: JSON.stringify({ settings: normalizeNoticeSettings(settings) }),
  })
}

async function saveCloudFileCleanupSettings(settings) {
  const body = JSON.stringify({ settings: normalizeFileCleanupSettings(settings) })
  const request = async (method) => {
    const response = await fetch('/api/account/file-cleanup-settings', {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      const error = new Error(data.message || '请求失败')
      error.status = response.status
      throw error
    }
    return data
  }
  try {
    return await request('PUT')
  } catch (error) {
    if (error.status === 404 || /接口不存在/.test(error.message || '')) return request('POST')
    throw error
  }
}

async function requestAccountBindCode(target) {
  return apiRequest('/api/auth/code', {
    method: 'POST',
    body: JSON.stringify({ target, scene: 'bind' }),
  })
}

async function bindAccountTarget(target, code) {
  return apiRequest('/api/account/bind', {
    method: 'POST',
    body: JSON.stringify({ target, code }),
  })
}

function upsertRecords(currentRecords, incomingRecords) {
  const merged = new Map()
  normalizeRecords(currentRecords).forEach((record) => merged.set(record.id, record))
  incomingRecords.map(normalizeRecord).forEach((record) => {
    const existing = merged.get(record.id)
    merged.set(record.id, existing ? mergeRecord(existing, record) : record)
  })
  return Array.from(merged.values()).sort(compareRecords)
}

function mergeRecord(existing, incoming) {
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

function normalizeRecords(records) {
  if (!Array.isArray(records)) return []
  const deduped = new Map()
  records.map(normalizeRecord).filter(Boolean).forEach((record) => {
    const existing = deduped.get(record.id)
    deduped.set(record.id, existing ? mergeRecord(existing, record) : record)
  })
  return Array.from(deduped.values()).sort(compareRecords)
}

function normalizeRecord(record = {}) {
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

function normalizeRecordScope(scope, type) {
  if (['my_sent', 'sent_to_me', 'my_collections', 'collect_from_me'].includes(scope)) return scope
  if (type === '发送') return 'my_sent'
  if (type === '收取' || type === '接收') return 'sent_to_me'
  if (type === '被收集' || type === '提交') return 'collect_from_me'
  if (type === '收集') return 'my_collections'
  return 'my_sent'
}

function legacyTypeForScope(scope) {
  if (scope === 'my_sent') return '发送'
  if (scope === 'sent_to_me') return '收取'
  if (scope === 'collect_from_me') return '被收集'
  return '收集'
}

function normalizeRecordStatus(status, kind, scope) {
  if (!status) return ''
  if (status === 'active') return kind === 'collection' ? (scope === 'collect_from_me' ? '可提交' : '进行中') : '有效'
  if (status === 'closed') return '已关闭'
  if (status === 'expired') return kind === 'collection' ? '已截止' : '已关闭'
  return status
}

function normalizedManageUrl(kind, manageToken, currentUrl = '') {
  const parts = getUrlParts(currentUrl)
  const expectedRoot = kind === 'share' ? 'share' : 'collect'
  if (currentUrl && parts[0] === expectedRoot && parts[1] === 'manage') return currentUrl
  return manageToken ? `${window.location.origin}/${expectedRoot}/manage/${manageToken}` : ''
}

function createShareManageForm(share = {}) {
  const limit = share.downloadLimit ? String(share.downloadLimit) : 'unlimited'
  return {
    downloadLimit: ['unlimited', '1', '10'].includes(limit) ? limit : 'custom',
    customDownloadLimit: share.downloadLimit ? String(share.downloadLimit) : '5',
    password: '',
    clearPassword: false,
  }
}

function createCollectionManageForm(collection = {}) {
  return {
    title: collection.title || '',
    description: collection.description || '',
    deadline: toDateInputValue(collection.deadline),
    allowedTypes: Array.isArray(collection.allowedTypes) ? collection.allowedTypes : [],
    maxFileSizeMb: String(collection.maxFileSizeMb || 500),
  }
}

function toDateInputValue(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return formatDateInput(date)
}

function shareStatusText(status) {
  if (status === 'closed' || status === 'expired') return '已关闭'
  return '有效'
}

function collectionStatusText(status, deadline = null) {
  if (status === 'closed') return '已关闭'
  if (status === 'expired' || isPastDeadline(deadline)) return '已截止'
  return '进行中'
}

function canReopenCollection(collection = {}) {
  return isClosedOrExpiredStatus(collection.status) && Boolean(collection.deadline && !isPastDeadline(collection.deadline))
}

function createShareRecord(share, scope = 'my_sent') {
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

function createCollectionRecord(collection, scope = 'my_collections', extra = {}) {
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

function compareRecords(a, b) {
  return new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime()
}

function matchesRecordScope(record, scope) {
  return scope === 'all' || record.scope === scope
}

function matchesRecordDate(record, dateFilter, dateFrom, dateTo) {
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

function matchesRecordStatus(record, statusFilter) {
  const group = recordStatusGroup(record)
  return statusFilter === 'all' || group === statusFilter
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addLocalDays(date, days) {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

function parseLocalDate(value) {
  if (!value) return null
  const [year, month, day] = value.split('-').map(Number)
  if (![year, month, day].every(Number.isFinite)) return null
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null
}

function isDateInputStillOpen(value) {
  const date = parseLocalDate(value)
  if (!date) return false
  return addLocalDays(date, 1).getTime() > Date.now()
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function addMonths(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1)
}

function formatDateInput(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDateInputDisplay(value) {
  const date = parseLocalDate(value)
  return date ? `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}` : value
}

function recordStatusGroup(record) {
  if (isRecordExpired(record)) return 'expired'
  if (isRecordExpiringSoon(record)) return 'expiring'
  return 'active'
}

function isRecordExpired(record) {
  if (isClosedStatus(record.status)) return true
  const deadline = record.expiresAt || record.deadline
  if (deadline) return isPastDeadline(deadline)
  return isExpiredStatus(record.status)
}

function isRecordExpiringSoon(record) {
  const deadline = record.expiresAt || record.deadline
  if (!deadline) return isExpiringSoonStatus(record.status)
  const deadlineTime = new Date(deadline).getTime()
  const remaining = deadlineTime - Date.now()
  return Number.isFinite(deadlineTime) && remaining > 0 && remaining <= EXPIRING_SOON_MS
}

function isPastDeadline(value) {
  if (!value) return false
  const time = new Date(value).getTime()
  return Number.isFinite(time) && time <= Date.now()
}

function isClosedOrExpiredStatus(status) {
  return isClosedStatus(status) || isExpiredStatus(status)
}

function isClosedStatus(status) {
  return ['closed', '已关闭'].includes(status)
}

function isExpiredStatus(status) {
  return ['expired', '已过期', '已失效', '已截止'].includes(status)
}

function isExpiringSoonStatus(status) {
  return ['expiring', '即将过期', '即将截止'].includes(status)
}

function recordDisplayStatus(record) {
  const group = recordStatusGroup(record)
  if (group === 'expired') {
    if (record.status === 'closed') return '已关闭'
    if (record.status === 'expired') return record.kind === 'collection' ? '已截止' : '已关闭'
    if (record.kind === 'share' && ['已失效', '已关闭', '已过期'].includes(record.status)) return '已关闭'
    if (['已失效', '已关闭', '已过期', '已截止'].includes(record.status)) return record.status
    return record.kind === 'collection' ? '已截止' : '已过期'
  }
  if (group === 'expiring') return '即将过期'
  if (record.kind === 'collection') return record.scope === 'collect_from_me' ? '可提交' : '进行中'
  return '有效'
}

function recordDetail(record) {
  if (record.kind === 'collection') {
    if (record.scope === 'collect_from_me') return record.submittedAt ? `${record.participantName || '我'} · 已提交 ${formatShortDate(record.submittedAt)}` : '待提交'
    return `${Number(record.submissionCount || 0)} 份提交 · ${recordAgeLabel(record.createdAt)}`
  }
  const size = Number(record.totalSize || 0)
  const count = Number(record.fileCount || 0)
  return `${count ? `${count} 个文件` : '文件分享'}${size ? ` · ${formatBytes(size)}` : ''} · ${recordAgeLabel(record.createdAt)}`
}

function recordDisplayName(record) {
  return String(record.alias || record.name || (record.kind === 'collection' ? '收集任务' : '文件分享')).trim()
}

function managedFileItemsFromRecords(records) {
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

function recordManagedFiles(record) {
  const files = compactRecordFiles(record.files)
  if (files.length) return files
  return compactRecordSubmissions(record.submissions).flatMap((submission) => submission.files || [])
}

function managedFileCategories(record, files) {
  if (record.kind === 'collection') return ['collection']
  const categories = Array.from(new Set(files.map(fileCategoryFromFile).filter(Boolean)))
  if (categories.length) return categories
  const fallbackCategory = fileCategoryFromFile({ name: recordDisplayName(record), mimeType: record.mimeType })
  return fallbackCategory ? [fallbackCategory] : ['other']
}

function managedFileDetail(record, fileCount, size) {
  const sizeLabel = size ? ` · ${formatBytes(size)}` : ''
  const updatedLabel = ` · 更新 ${formatShortDate(record.updatedAt || record.createdAt)}`
  if (record.kind === 'collection') {
    if (record.scope === 'collect_from_me') return `${fileCount || 0} 个提交文件${sizeLabel}${updatedLabel}`
    return `${Number(record.submissionCount || 0)} 份提交 · ${fileCount || 0} 个文件${sizeLabel}${updatedLabel}`
  }
  const downloadLabel = record.downloadLimit ? ` · ${Number(record.downloadCount || 0)}/${record.downloadLimit} 次` : ''
  return `${fileCount || 1} 个文件${sizeLabel}${downloadLabel}${updatedLabel}`
}

function fileCategoryFromFile(file = {}) {
  const mimeType = String(file.mimeType || '').toLowerCase()
  const extension = fileExtension(file.name || file.relativePath)
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  const matchedType = collectionTypeForExtension(extension)
  if (matchedType) return COLLECTION_TYPE_CATEGORY_KEYS[matchedType] || 'other'
  return 'other'
}

function collectionTypeForExtension(extension) {
  return Object.entries(COLLECTION_TYPE_EXTENSIONS).find(([, extensions]) => extensions.includes(extension))?.[0] || ''
}

function isAllowedCollectionFile(file = {}, allowedTypes = []) {
  const normalized = normalizeCollectionTypes(allowedTypes)
  if (normalized.includes('全部格式')) return true
  const type = collectionTypeForExtension(fileExtension(file.name || file.relativePath)) || '其他'
  return normalized.includes(type)
}

function collectionFileAccept(allowedTypes = []) {
  const normalized = normalizeCollectionTypes(allowedTypes)
  if (normalized.includes('全部格式') || normalized.includes('其他')) return undefined
  const extensions = normalized.flatMap((type) => COLLECTION_TYPE_EXTENSIONS[type] || [])
  return extensions.length ? Array.from(new Set(extensions)).map((extension) => `.${extension}`).join(',') : undefined
}

function fileCategoryLabel(category) {
  return FILE_CATEGORY_FILTERS.find(([value]) => value === category)?.[1] || '其他'
}

function fileCategoryIcon(category) {
  if (category === 'image') return ImageIcon
  if (category === 'archive') return FileArchive
  if (category === 'document' || category === 'code') return FileText
  if (category === 'collection') return Inbox
  return FileCheck2
}

function matchesManagedFileSearch(item, query) {
  const terms = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean)
  return !terms.length || terms.every((term) => item.searchText.includes(term))
}

function matchesManagedFileCategory(item, category) {
  return category === 'all' || item.category === category || item.categories.includes(category)
}

function recordIconForScope(scope) {
  if (scope === 'my_sent') return Send
  if (scope === 'sent_to_me') return Download
  if (scope === 'collect_from_me') return UploadCloud
  return Inbox
}

function recordScopeLabel(scope) {
  return RECORD_SCOPE_TABS.find((tab) => tab.key === scope)?.label || '记录'
}

function recordLink(record) {
  if (record.scope === 'my_collections') return recordManageUrl(record) || record.publicUrl || record.shareUrl
  return record.shareUrl || record.publicUrl || record.manageUrl
}

function recordCopyTarget(record) {
  if (record.kind === 'share') return record.code || record.shareUrl
  if (record.scope === 'my_collections') return recordManageUrl(record) || record.publicUrl
  return record.publicUrl || record.shareUrl
}

function recordManageUrl(record) {
  return normalizedManageUrl(record.kind, record.manageToken || getManageToken(record.manageUrl), record.manageUrl)
}

function recordCopyLabel(record) {
  if (record.kind === 'share') return record.code ? '复制取件码' : '复制链接'
  return record.scope === 'my_collections' ? '复制管理链接' : '复制提交链接'
}

function recordOpenLabel(record) {
  if (record.kind === 'share') return record.scope === 'my_sent' ? '打开分享链接' : '打开文件链接'
  return record.scope === 'my_collections' ? '查看已收文件' : '打开提交入口'
}

function recordExpiryLabel(record) {
  const deadline = record.expiresAt || record.deadline
  if (!deadline) return record.kind === 'share' ? '永久有效' : '未设置截止'
  return `${record.kind === 'collection' ? '截止' : '到期'} ${formatShortDate(deadline)}`
}

function formatShortDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function createUploadState() {
  return {
    status: 'idle',
    phase: '',
    progress: 0,
    uploadedBytes: 0,
    totalBytes: 0,
    speedBps: 0,
    etaSeconds: null,
    currentFile: '',
    retryCount: 0,
    error: '',
  }
}

function createUploadSessionState() {
  return {
    sessionId: '',
    fileIndex: 0,
    chunkIndex: 0,
    uploadedBytes: 0,
    totalBytes: 0,
    startedAt: 0,
    paused: false,
    abortCurrent: null,
    activeXhrs: new Set(),
  }
}

// 分片大小选择：会话创建时确定，服务端按同一配置定位写入。
// 弱网/省流量 → 2MB 减少单片失败代价；大批量 → 16MB 减少请求数；默认 8MB。
function pickUploadChunkSize(files) {
  const totalBytes = files.reduce((sum, item) => sum + item.size, 0)
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || {}
  if (connection.saveData || ['slow-2g', '2g', '3g'].includes(connection.effectiveType)) return 2 * 1024 * 1024
  if (totalBytes >= 512 * 1024 * 1024) return 16 * 1024 * 1024
  return 8 * 1024 * 1024
}

// 分片 SHA-256：非 secure context（http 局域网地址）下 crypto.subtle 不存在，跳过校验降级传输。
async function sha256Hex(buffer) {
  if (!globalThis.crypto?.subtle) return ''
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const UPLOAD_RESUME_KEY = 'kunqiong_upload_resume'
const UPLOAD_RESUME_TTL_MS = 11 * 60 * 60 * 1000

function uploadResumeSignature(files, chunkSize, uploadConfig, shareOptions) {
  return JSON.stringify({
    chunkSize,
    files: files.map((item) => ({ name: item.name, size: item.size, relativePath: item.relativePath || '', mimeType: item.file?.type || item.mimeType || '' })),
    options: shareOptions,
    mode: uploadConfig.sessionBody || {},
  })
}

function readUploadResume() {
  try { return JSON.parse(localStorage.getItem(UPLOAD_RESUME_KEY) || 'null') } catch { return null }
}

function saveUploadResume(files, chunkSize, uploadConfig, shareOptions, sessionId) {
  try {
    localStorage.setItem(UPLOAD_RESUME_KEY, JSON.stringify({ sessionId, chunkSize, savedAt: Date.now(), signature: uploadResumeSignature(files, chunkSize, uploadConfig, shareOptions) }))
  } catch { /* 存储满/隐私模式忽略，退化为普通续传 */ }
}

function clearUploadResume() {
  try { localStorage.removeItem(UPLOAD_RESUME_KEY) } catch { /* 忽略 */ }
}

// 跨刷新续传：刷新/重启后用 localStorage 里的会话指纹换回已传分片清单，
// 文件清单、分片配置、分享参数任一变化即放弃续传重新开session。
async function tryResumeUploadSession(files, chunkSize, uploadConfig, shareOptions, session) {
  const entry = readUploadResume()
  if (!entry?.sessionId) return false
  try {
    if (Date.now() - Number(entry.savedAt) > UPLOAD_RESUME_TTL_MS) throw new Error('上传会话已过期')
    if (Number(entry.chunkSize) !== chunkSize || entry.signature !== uploadResumeSignature(files, chunkSize, uploadConfig, shareOptions)) throw new Error('文件清单变化')
    const data = await apiRequest(`/api/upload-sessions/${entry.sessionId}`)
    if (Number(data.chunkSize) !== chunkSize || !Array.isArray(data.files) || data.files.length !== files.length) throw new Error('服务端会话不一致')
    const resumedChunks = new Map()
    let resumedBytes = 0
    for (let index = 0; index < data.files.length; index += 1) {
      const remote = data.files[index]
      const local = files[index]
      if (remote.name !== local.name || Number(remote.size) !== local.size) throw new Error('文件清单变化')
      const done = Array.isArray(remote.uploadedChunks) ? remote.uploadedChunks : []
      resumedChunks.set(index, done)
      for (const chunkIndex of done) resumedBytes += Math.min(chunkSize, Math.max(0, local.size - chunkIndex * chunkSize))
    }
    session.sessionId = data.sessionId || entry.sessionId
    session.resumedChunks = resumedChunks
    session.uploadedBytes = Math.min(resumedBytes, session.totalBytes)
    return true
  } catch {
    clearUploadResume()
    return false
  }
}

async function uploadShareInChunks(files, settings, uploadRef, onState, uploadConfig = {}) {
  const chunkSize = pickUploadChunkSize(files)
  const concurrency = Math.min(4, Math.max(2, Number(navigator.hardwareConcurrency || 4) >= 8 ? 4 : 2))
  const session = uploadRef.current
  session.totalBytes = files.reduce((sum, item) => sum + item.size, 0)
  session.startedAt = session.startedAt || Date.now()
  const shareOptions = buildShareOptions(settings)

  if (!session.sessionId) {
    onState({ status: 'uploading', phase: '创建上传会话', progress: 0, totalBytes: session.totalBytes, uploadedBytes: 0, speedBps: 0, etaSeconds: null, currentFile: '', retryCount: 0, error: '' })
    const resumed = await tryResumeUploadSession(files, chunkSize, uploadConfig, shareOptions, session)
    if (resumed) {
      onState(uploadStateFromProgress(session, session.uploadedBytes, '已恢复上次上传进度', '', 0))
    } else {
      const response = await apiRequest('/api/upload-sessions', {
        method: 'POST',
        body: JSON.stringify({
          files: files.map((item) => ({ name: item.name, relativePath: item.relativePath, size: item.size, mimeType: item.file.type })),
          chunkSize,
          ...shareOptions,
          ...(uploadConfig.sessionBody || {}),
        }),
      })
      session.sessionId = response.sessionId
      saveUploadResume(files, chunkSize, uploadConfig, shareOptions, session.sessionId)
    }
  }

  for (let fileIndex = session.fileIndex; fileIndex < files.length; fileIndex += 1) {
    const item = files[fileIndex]
    const totalChunks = Math.max(1, Math.ceil(item.size / chunkSize))
    const resumedDone = session.resumedChunks instanceof Map ? (session.resumedChunks.get(fileIndex) || []) : []
    const completedChunks = new Set(resumedDone)
    const startChunk = fileIndex === session.fileIndex ? session.chunkIndex : 0
    let nextChunk = Math.max(startChunk, 0)
    while (completedChunks.has(nextChunk)) nextChunk += 1
    let lowestIncomplete = nextChunk
    const inFlightProgress = new Map()
    let firstError = null
    const worker = async () => {
      while (!firstError) {
        if (session.paused) throw new UploadPausedError()
        const chunkIndex = nextChunk
        if (chunkIndex >= totalChunks) return
        nextChunk += 1
        const start = chunkIndex * chunkSize
        const end = Math.min(item.size, start + chunkSize)
        const chunkData = await item.file.slice(start, end).arrayBuffer()
        const chunkHash = await sha256Hex(chunkData)
        let attempt = 0
        while (attempt < 3) {
          try {
            onState(uploadStateFromProgress(session, session.uploadedBytes + [...inFlightProgress.values()].reduce((sum, value) => sum + value, 0), `上传 ${item.name}`, item.name, attempt))
            await xhrUploadChunk(`/api/upload-sessions/${session.sessionId}/chunks`, {
              fileIndex,
              chunkIndex,
              totalChunks,
              chunkData,
              chunkHash,
              filename: item.name,
            }, {
              uploadRef,
              onProgress: (loaded) => {
                inFlightProgress.set(chunkIndex, loaded)
                onState(uploadStateFromProgress(session, session.uploadedBytes + [...inFlightProgress.values()].reduce((sum, value) => sum + value, 0), `上传 ${item.name}`, item.name, attempt))
              },
            })
            inFlightProgress.delete(chunkIndex)
            completedChunks.add(chunkIndex)
            while (completedChunks.has(lowestIncomplete)) lowestIncomplete += 1
            session.chunkIndex = lowestIncomplete
            session.uploadedBytes += end - start
            onState(uploadStateFromProgress(session, session.uploadedBytes + [...inFlightProgress.values()].reduce((sum, value) => sum + value, 0), `上传 ${item.name}`, item.name, 0))
            break
          } catch (error) {
            inFlightProgress.delete(chunkIndex)
            if (error.name === 'UploadPausedError') throw error
            attempt += 1
            onState(uploadStateFromProgress(session, session.uploadedBytes, `分片失败，正在重试`, item.name, attempt, error.message))
            if (attempt >= 3) {
              firstError = error
              throw error
            }
            // 指数退避 + 抖动：500ms/1s/2s…封顶 8s，避免集体重试踩踏
            await wait(Math.min(8000, 500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250))
          }
        }
      }
    }
    const workers = Array.from({ length: Math.max(0, Math.min(concurrency, totalChunks - nextChunk)) }, () => worker())
    try {
      await Promise.all(workers)
    } catch (error) {
      if (error.name === 'UploadPausedError' || session.paused) throw new UploadPausedError()
      throw firstError || error
    }
    session.fileIndex = fileIndex + 1
    session.chunkIndex = 0
    onState(uploadStateFromProgress(session, session.uploadedBytes, `上传 ${item.name}`, item.name, 0))
  }

  onState({ status: 'finalizing', phase: '正在生成分享信息', progress: 100, uploadedBytes: session.totalBytes, totalBytes: session.totalBytes, speedBps: currentSpeed(session, session.totalBytes), etaSeconds: 0, currentFile: '', retryCount: 0, error: '' })
  const result = await apiRequest(`/api/upload-sessions/${session.sessionId}/complete`, {
    method: 'POST',
    body: JSON.stringify({ chunkSize, ...(uploadConfig.completeBody || {}) }),
  })
  clearUploadResume()
  return result
}

function uploadStateFromProgress(session, loadedBytes, phase, currentFile, retryCount = 0, error = '') {
  const totalBytes = Math.max(session.totalBytes, 1)
  const speedBps = currentSpeed(session, loadedBytes)
  return {
    status: 'uploading',
    phase,
    progress: Math.min(99, Math.round((loadedBytes / totalBytes) * 100)),
    uploadedBytes: loadedBytes,
    totalBytes: session.totalBytes,
    speedBps,
    etaSeconds: speedBps ? Math.max(0, Math.round((session.totalBytes - loadedBytes) / speedBps)) : null,
    currentFile,
    retryCount,
    error,
  }
}

function currentSpeed(session, loadedBytes) {
  const elapsedSeconds = Math.max((Date.now() - session.startedAt) / 1000, 0.3)
  return loadedBytes / elapsedSeconds
}

function xhrUploadChunk(url, { fileIndex, chunkIndex, totalChunks, chunkData, chunkHash, filename }, { uploadRef, onProgress }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const uploadState = uploadRef.current
    const body = new FormData()
    body.append('fileIndex', String(fileIndex))
    body.append('chunkIndex', String(chunkIndex))
    body.append('totalChunks', String(totalChunks))
    body.append('chunk', new Blob([chunkData], { type: 'application/octet-stream' }), filename)
    if (chunkHash) body.append('chunkHash', chunkHash)
    const activeXhrs = uploadState.activeXhrs || new Set()
    uploadState.activeXhrs = activeXhrs
    activeXhrs.add(xhr)
    uploadState.abortCurrent = () => activeXhrs.forEach((request) => request.abort())
    const cleanup = () => {
      activeXhrs.delete(xhr)
      if (!activeXhrs.size) uploadState.abortCurrent = null
    }
    xhr.open('POST', url)
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(event.loaded) }
    xhr.onload = () => {
      cleanup()
      let data = {}
      try { data = JSON.parse(xhr.responseText || '{}') } catch { data = {} }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data)
      else {
        const error = new Error(data.message || '分片上传失败')
        error.status = xhr.status
        error.code = data.code || ''
        error.guestQuota = data.guestQuota || null
        reject(error)
      }
    }
    xhr.onerror = () => {
      cleanup()
      reject(new Error('网络连接失败，请确认鲲穹服务已启动'))
    }
    xhr.onabort = () => {
      cleanup()
      reject(uploadState.paused ? new UploadPausedError() : new Error('上传已中断'))
    }
    xhr.send(body)
  })
}

function buildShareOptions(settings) {
  const downloadLimit = settings.downloadLimit === 'custom' ? settings.customDownloadLimit : settings.downloadLimit
  return {
    expiryDays: settings.expiryDays,
    downloadLimit,
    password: settings.passwordEnabled ? settings.password : '',
    codeLength: settings.codeLength,
    recipients: settings.recipients,
  }
}

class UploadPausedError extends Error {
  constructor() {
    super('上传已暂停')
    this.name = 'UploadPausedError'
  }
}

function wait(ms) { return new Promise((resolve) => window.setTimeout(resolve, ms)) }

async function syncRecords(records) {
  const updates = await Promise.all(normalizeRecords(records).map(syncRecord))
  return normalizeRecords(updates.filter(Boolean))
}

async function syncRecord(record) {
  if (record.kind === 'collection') return syncCollectionRecord(record)
  return syncShareRecord(record)
}

async function syncShareRecord(record) {
  const lookupUrl = record.shareId
    ? `/api/shares/token/${encodeURIComponent(record.shareId)}`
    : record.code
      ? `/api/shares/lookup/${encodeURIComponent(record.code)}`
      : ''
  if (!lookupUrl) return record
  try {
    const data = await apiRequest(lookupUrl)
    const refreshed = createShareRecord(data.share, record.scope)
    refreshed.createdAt = record.createdAt || refreshed.createdAt
    refreshed.updatedAt = record.updatedAt || refreshed.updatedAt
    return mergeRecord(record, refreshed)
  } catch (error) {
    // 404 = 资源已被物理删除（过期不会 404）：条目是死链，直接移除而非标记状态
    if (error.status === 404) return null
    return markRecordUnavailable(record, error.message)
  }
}

async function syncCollectionRecord(record) {
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
    return mergeRecord(record, refreshed)
  } catch (error) {
    // 同步探测 404 = 资源已被物理删除，记录条目随之移除
    if (error.status === 404) return null
    return markRecordUnavailable(record, error.message)
  }
}

function markRecordUnavailable(record, message = '') {
  if (!/过期|失效|不存在|用完|关闭|截止|不可用/.test(message)) return record
  return {
    ...record,
    status: message.includes('关闭') ? '已关闭' : record.kind === 'collection' ? '已截止' : '已失效',
    updatedAt: new Date().toISOString(),
  }
}

function getUrlParts(value) {
  if (!value) return []
  try {
    return new URL(value, window.location.origin).pathname.split('/').filter(Boolean)
  } catch {
    return []
  }
}

function getShareToken(value) {
  const parts = getUrlParts(value)
  return parts[0] === 'share' ? parts[1] || '' : ''
}

function getCollectionToken(value) {
  const parts = getUrlParts(value)
  return parts[0] === 'collect' && parts[1] !== 'manage' ? parts[1] || '' : ''
}

function getManageToken(value) {
  const parts = getUrlParts(value)
  const index = parts.indexOf('manage')
  return index >= 0 ? parts[index + 1] || '' : ''
}
function recordAgeLabel(createdAt) {
  if (!createdAt) return '已更新'
  const elapsed = Date.now() - new Date(createdAt).getTime()
  // 无效日期（解析为 NaN）兜底，避免渲染「NaN 分钟前创建」
  if (!Number.isFinite(elapsed)) return '已更新'
  const elapsedMinutes = Math.floor(elapsed / 60000)
  if (elapsedMinutes < 1) return '刚刚创建'
  if (elapsedMinutes < 60) return `${elapsedMinutes} 分钟前创建`
  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 24) return `${elapsedHours} 小时前创建`
  return `${Math.floor(elapsedHours / 24)} 天前创建`
}

async function apiRequest(url, options = {}) {
  const { headers = {}, ...fetchOptions } = options
  const response = await fetch(url, { ...fetchOptions, credentials: 'include', headers: { 'Content-Type': 'application/json', ...headers } })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.message || '请求失败')
    error.status = response.status
    error.code = data.code || ''
    error.guestQuota = data.guestQuota || null
    throw error
  }
  return data
}

function xhrRequest(url, { method = 'POST', body, onProgress, onRequest }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(method, url)
    onRequest?.(xhr)
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100)) }
    xhr.onload = () => {
      const data = JSON.parse(xhr.responseText || '{}')
      if (xhr.status >= 200 && xhr.status < 300) resolve(data)
      else reject(new Error(data.message || '上传失败'))
    }
    xhr.onerror = () => reject(new Error('网络连接失败，请确认鲲穹服务已启动'))
    xhr.onabort = () => {
      const error = new Error('提交已取消')
      error.name = 'UploadCancelledError'
      reject(error)
    }
    xhr.send(body)
  })
}

function useDownloadTask() {
  const [downloadTask, setDownloadTask] = useState(createDownloadState())
  const activeRef = useRef(false)
  const retryConfigRef = useRef(null)
  const retryCountRef = useRef(0)

  const startDownload = async (config, options = {}) => {
    if (!config) return { ok: false, error: '下载链接不可用' }
    if (activeRef.current) return { ok: false, error: '已有下载正在进行，请稍候' }
    activeRef.current = true
    retryConfigRef.current = config
    retryCountRef.current = options.retry ? retryCountRef.current + 1 : 0
    const retryCount = retryCountRef.current
    setDownloadTask({ ...createDownloadState(), status: 'preparing', label: config.label, filename: config.filename, totalBytes: config.totalBytes || 0, retryCount, retryConfig: config })
    try {
      const result = await downloadBinaryWithProgress(config, (patch) => {
        setDownloadTask((current) => ({ ...current, ...patch, retryConfig: config, retryCount }))
      })
      setDownloadTask((current) => ({ ...current, status: result?.handedOff ? 'handed_off' : 'complete', progress: result?.handedOff ? 0 : 100, etaSeconds: 0, error: '', retryConfig: config, retryCount }))
      return { ok: true }
    } catch (error) {
      const message = error.message || '下载失败'
      setDownloadTask((current) => ({ ...current, status: 'failed', error: message, retryConfig: config, retryCount }))
      return { ok: false, error: message }
    } finally {
      activeRef.current = false
    }
  }

  const retryDownload = () => {
    const config = retryConfigRef.current || downloadTask.retryConfig
    if (config) startDownload(config, { retry: true })
  }

  return { downloadTask, startDownload, retryDownload, downloadBusy: isDownloadBusy(downloadTask) }
}

function createDownloadState() {
  return {
    status: 'idle',
    label: '',
    filename: '',
    progress: 0,
    loadedBytes: 0,
    totalBytes: 0,
    speedBps: 0,
    etaSeconds: null,
    canResume: false,
    isEstimated: false,
    retryCount: 0,
    retryConfig: null,
    error: '',
  }
}

function isDownloadBusy(task) {
  return ['preparing', 'downloading', 'saving'].includes(task?.status)
}

function downloadStatusText(task) {
  if (task.status === 'preparing') return '准备下载'
  if (task.status === 'saving') return '正在保存'
  if (task.status === 'complete') return '下载完成'
  if (task.status === 'failed') return '下载失败'
  return task.label || '正在下载'
}

async function downloadBinaryWithProgress(config, onProgress) {
  onProgress({ status: 'preparing', label: config.label, filename: config.filename, error: '' })
  const response = await fetch(config.url, { method: 'HEAD', credentials: 'include', headers: config.headers || {} })
  if (!response.ok) throw await downloadResponseError(response)
  const filename = config.filename || filenameFromContentDisposition(response.headers.get('content-disposition')) || '下载文件'
  const link = document.createElement('a')
  link.href = config.url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  onProgress({ status: 'handed_off', filename })
  return { handedOff: true }
}

async function downloadResponseError(response) {
  const text = await response.text().catch(() => '')
  try {
    const data = JSON.parse(text)
    return new Error(data.message || `下载失败（${response.status}）`)
  } catch {
    return new Error(text || `下载失败（${response.status}）`)
  }
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function canUseImageClipboard() {
  return Boolean(window.isSecureContext && navigator.clipboard?.write && typeof window.ClipboardItem !== 'undefined')
}

async function copyImageToClipboard(dataUrl) {
  if (canUseImageClipboard()) {
    const response = await fetch(dataUrl)
    const blob = await response.blob()
    await navigator.clipboard.write([new window.ClipboardItem({ [blob.type || 'image/png']: blob })])
    return
  }
  if (copyImageWithSelection(dataUrl)) return
  throw new Error('copy-image-not-supported')
}

function copyImageWithSelection(dataUrl) {
  const activeElement = document.activeElement
  const container = document.createElement('div')
  container.contentEditable = 'true'
  container.setAttribute('aria-hidden', 'true')
  container.style.position = 'fixed'
  container.style.top = '0'
  container.style.left = '-9999px'
  container.style.width = '220px'
  container.style.height = '220px'
  container.style.overflow = 'hidden'
  container.style.opacity = '0'
  const image = document.createElement('img')
  image.src = dataUrl
  image.alt = '分享二维码'
  image.style.width = '200px'
  image.style.height = '200px'
  container.appendChild(image)
  document.body.appendChild(container)

  const selection = window.getSelection()
  const range = document.createRange()
  range.selectNodeContents(container)
  selection?.removeAllRanges()
  selection?.addRange(range)

  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  }

  selection?.removeAllRanges()
  container.remove()
  if (activeElement && typeof activeElement.focus === 'function') {
    activeElement.focus({ preventScroll: true })
  }
  return copied
}

async function copyTextToClipboard(value) {
  const text = String(value ?? '')
  if (!text) throw new Error('copy-empty-text')

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {}
  }

  if (copyTextWithTextarea(text)) return
  throw new Error('copy-text-not-supported')
}

function copyTextWithTextarea(text) {
  const textarea = document.createElement('textarea')
  const activeElement = document.activeElement
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '-9999px'
  textarea.style.width = '1px'
  textarea.style.height = '1px'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  textarea.setSelectionRange(0, textarea.value.length)
  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  }
  textarea.remove()
  if (activeElement && typeof activeElement.focus === 'function') {
    activeElement.focus({ preventScroll: true })
  }
  return copied
}

function currentDownloadSpeed(startedAt, loadedBytes) {
  const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.1)
  return Math.round(loadedBytes / elapsedSeconds)
}

function filenameFromContentDisposition(value = '') {
  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  if (encoded) {
    try { return decodeURIComponent(encoded) } catch {}
  }
  return value.match(/filename="?([^";]+)"?/i)?.[1] || ''
}

function createShareDownloadConfig(share, { password = '' } = {}) {
  const files = share.files || []
  return {
    url: share.downloadUrl || `${window.location.origin}/api/shares/${encodeURIComponent(share.id)}/download`,
    filename: files.length === 1 ? files[0].name : '鲲穹文件包.zip',
    label: files.length === 1 ? `下载 ${files[0]?.name || '文件'}` : `打包下载 ${files.length} 个文件`,
    totalBytes: totalFileSize(files),
    headers: password ? { 'x-share-password': password } : {},
  }
}

function createShareFileDownloadConfig(share, file, fileIndex, { password = '' } = {}) {
  return {
    url: `${window.location.origin}/api/shares/${encodeURIComponent(share.id)}/files/${fileIndex}/download`,
    filename: file.name || '下载文件',
    label: `下载 ${file.name || '文件'}`,
    totalBytes: Number(file.size || 0),
    headers: password ? { 'x-share-password': password } : {},
  }
}

function createShareFilePreviewConfig(share, file, fileIndex, options = {}) {
  return {
    file,
    kind: previewKind(file),
    url: `${window.location.origin}/api/shares/${encodeURIComponent(share.id)}/files/${fileIndex}/preview`,
    downloadConfig: createShareFileDownloadConfig(share, file, fileIndex, options),
  }
}

function createCollectionDownloadConfig(collection) {
  const submissions = collection.submissions || []
  const fileCount = submissions.reduce((sum, submission) => sum + (submission.files?.length || 0), 0)
  return {
    url: collection.downloadUrl || `${window.location.origin}/api/collections/manage/${encodeURIComponent(collection.manageToken)}/download`,
    filename: `${safeDownloadName(collection.title || '收集文件')}.zip`,
    label: `打包下载 ${submissions.length} 份提交 / ${fileCount} 个文件`,
    totalBytes: submissions.reduce((sum, submission) => sum + totalFileSize(submission.files), 0),
  }
}

function createSubmissionDownloadConfig(collection, submission) {
  if (submission.files?.length === 1) return createSubmissionFileDownloadConfig(collection, submission, 0)
  return {
    url: `${window.location.origin}/api/collections/manage/${encodeURIComponent(collection.manageToken)}/submissions/${encodeURIComponent(submission.id)}/download`,
    filename: `${safeDownloadName(submission.participantName || '提交文件')}.zip`,
    label: `打包下载 ${submission.participantName || '提交文件'}`,
    totalBytes: totalFileSize(submission.files),
  }
}

function createSubmissionFileDownloadConfig(collection, submission, fileIndex) {
  const file = submission.files?.[fileIndex] || {}
  return {
    url: `${window.location.origin}/api/collections/manage/${encodeURIComponent(collection.manageToken)}/submissions/${encodeURIComponent(submission.id)}/files/${fileIndex}/download`,
    filename: file.name || '下载文件',
    label: `下载 ${file.name || '文件'}`,
    totalBytes: Number(file.size || 0),
  }
}

function createSubmissionFilePreviewConfig(collection, submission, fileIndex) {
  const file = submission.files?.[fileIndex] || {}
  return {
    file,
    kind: previewKind(file),
    url: `${window.location.origin}/api/collections/manage/${encodeURIComponent(collection.manageToken)}/submissions/${encodeURIComponent(submission.id)}/files/${fileIndex}/preview`,
    downloadConfig: createSubmissionFileDownloadConfig(collection, submission, fileIndex),
  }
}

function recordPreviewConfigs(record) {
  if (!record) return []
  if (record.kind === 'share') {
    const files = compactRecordFiles(record.files)
    const shareId = record.shareId || getShareToken(record.shareUrl || record.publicUrl)
    if (!shareId) return []
    return files
      .map((file, index) => canPreviewFile(file) ? { ...createShareFilePreviewConfig({ id: shareId }, file, index), key: `share:${shareId}:${index}` } : null)
      .filter(Boolean)
  }
  if (record.scope === 'my_collections') {
    const submissions = compactRecordSubmissions(record.submissions)
    if (!record.manageToken) return []
    return submissions.flatMap((submission) => submission.files.map((file, index) => canPreviewFile(file) && submission.id
      ? {
          ...createSubmissionFilePreviewConfig({ manageToken: record.manageToken }, submission, index),
          key: `collection:${record.manageToken}:${submission.id}:${index}`,
        }
      : [])).filter(Boolean)
  }
  return []
}

function recordPreviewConfig(record) {
  return recordPreviewConfigs(record)[0] || null
}

function canPreviewFile(file) {
  return Boolean(previewKind(file))
}

const TEXT_PREVIEW_EXTENSIONS = new Set([
  'txt', 'md', 'log', 'json', 'xml', 'yml', 'yaml', 'ini', 'conf',
  'js', 'jsx', 'ts', 'tsx', 'html', 'htm', 'css', 'vue', 'swift', 'kt',
  'java', 'py', 'go', 'php', 'rb', 'rs', 'c', 'cpp', 'h', 'cs',
  'sh', 'ps1', 'bat', 'cmd', 'sql',
])

function previewKind(file = {}) {
  const mimeType = String(file.mimeType || '').toLowerCase()
  const extension = fileExtension(file.name || file.relativePath)
  if (mimeType === 'application/pdf' || extension === 'pdf') return 'pdf'
  if ((mimeType.startsWith('image/') && mimeType !== 'image/svg+xml') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(extension)) return 'image'
  if (mimeType.startsWith('video/') || ['mp4', 'webm', 'ogv', 'mov', 'm4v'].includes(extension)) return 'video'
  if (mimeType.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'aac', 'flac', 'oga', 'ogg'].includes(extension)) return 'audio'
  if (mimeType.includes('wordprocessingml') || extension === 'docx') return 'document'
  if (mimeType.includes('spreadsheetml') || ['xlsx', 'xls', 'csv'].includes(extension)) return 'spreadsheet'
  if (mimeType.includes('presentationml') || extension === 'pptx') return 'presentation'
  if (mimeType.startsWith('text/') || TEXT_PREVIEW_EXTENSIONS.has(extension)) return 'text'
  return ''
}

function previewTypeLabel(kind) {
  if (kind === 'pdf') return 'PDF'
  if (kind === 'video') return '视频'
  if (kind === 'audio') return '音频'
  if (kind === 'document') return '文档'
  if (kind === 'spreadsheet') return '表格'
  if (kind === 'presentation') return '演示文稿'
  if (kind === 'text') return '文本'
  return '图片'
}

function previewSupportLabel(kind) {
  if (kind === 'pdf') return '浏览器内嵌 PDF 预览'
  if (kind === 'video') return '在线播放，支持拖动进度'
  if (kind === 'audio') return '在线播放音频'
  if (kind === 'document') return 'DOCX 在线解析预览'
  if (kind === 'spreadsheet') return '表格在线解析预览'
  if (kind === 'presentation') return 'PPTX 在线渲染预览'
  if (kind === 'text') return '文本/代码源码预览，超大文件仅显示前 512 KB'
  return '图片在线预览'
}

function fileExtension(name = '') {
  const match = String(name).toLowerCase().match(/\.([^.\\/]+)$/)
  return match ? match[1] : ''
}

function fileFormatLabel(file = {}, record = null) {
  const extension = fileExtension(file.name || file.relativePath || recordDisplayName(record || {}))
  if (extension) return extension.toUpperCase()
  const mimeType = String(file.mimeType || record?.mimeType || '').trim().toLowerCase()
  if (mimeType && mimeType !== 'application/octet-stream') return mimeType.split('/').pop().toUpperCase()
  return record?.kind === 'collection' ? '收集' : '无后缀'
}

function fileFormatSummary(files = [], fallbackName = '') {
  const labels = Array.from(new Set((files.length ? files : [{ name: fallbackName }]).map((file) => fileFormatLabel(file)).filter(Boolean)))
  if (!labels.length) return '无后缀'
  if (labels.length <= 2) return labels.join(' / ')
  return '多格式'
}

function splitFileNameForDisplay(name = '') {
  const text = String(name || '').trim()
  const match = text.match(/^(.+?)(\.[^.\\/]{1,12})$/)
  if (!match || !match[1]) return { base: text, extension: '' }
  return { base: match[1], extension: match[2] }
}

function totalFileSize(files = []) {
  return files.reduce((sum, file) => sum + Number(file.size || 0), 0)
}

function safeDownloadName(value) {
  return String(value || '下载文件').replace(/[\\/:*?"<>|]+/g, '-').trim() || '下载文件'
}

function formatBytes(bytes = 0) {
  const value = Number(bytes) || 0
  if (value < 1024) return `${Math.max(0, Math.round(value))} B`
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
function formatAllowedTypes(types) {
  const normalized = normalizeCollectionTypes(types)
  return normalized.includes('全部格式') ? '全部格式' : normalized.join('、')
}
function normalizeCollectionTypes(types) {
  const values = Array.isArray(types) ? types.filter((type) => COLLECTION_TYPE_OPTIONS.includes(type)) : []
  if (!values.length || values.includes('全部格式')) return ['全部格式']
  return Array.from(new Set(values))
}
function toggleCollectionType(types, type) {
  if (type === '全部格式') return ['全部格式']
  const current = normalizeCollectionTypes(types).filter((item) => item !== '全部格式')
  const next = current.includes(type) ? current.filter((item) => item !== type) : [...current, type]
  return next.length ? next : ['全部格式']
}
function formatLimitSize(value) {
  const mb = Number(value || 0)
  if (!mb) return '不限大小'
  if (mb >= 1024) return `${Number((mb / 1024).toFixed(1))} GB`
  return `${mb} MB`
}
function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '计算中'
  if (seconds <= 0) return '即将完成'
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const restSeconds = seconds % 60
  if (minutes < 60) return `${minutes} 分 ${restSeconds} 秒`
  const hours = Math.floor(minutes / 60)
  return `${hours} 小时 ${minutes % 60} 分`
}
function formatPlanPrice(plan = {}) {
  const amount = Number(plan.monthlyPrice)
  if (plan.id === 'free' || amount === 0) return '免费使用'
  if (!Number.isFinite(amount) || amount < 0) return '价格以主站为准'
  const days = Number(plan.validityDays)
  // 有主站实价时有效期完全跟随主站套餐（null=买断永久），避免「展示永久、实付年费」反向不一致
  if (plan.remotePriced && Number.isFinite(days) && days > 0) return `¥${(amount / 100).toFixed(2)} / ${days}天`
  if (plan.permanent || plan.validityDays === null || plan.validityDays === undefined) {
    return `¥${(amount / 100).toFixed(2)} / 永久`
  }
  return Number.isFinite(days) && days > 0
    ? `¥${(amount / 100).toFixed(2)} / ${days}天`
    : `¥${(amount / 100).toFixed(2)}`
}
function PlanSpaceSummary({ plan = {}, compact = false }) {
  return <span className={`plan-space-summary${compact ? ' compact' : ''}`}>
    <span><b>{formatBytes(plan.totalBytes)}</b><small>个人空间</small></span>
    {plan.teamSpaceBytes ? <span><b>{formatBytes(plan.teamSpaceBytes)}</b><small>团队空间</small></span> : null}
  </span>
}
function formatExpiry(value) { return value ? `有效期至 ${new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '永久有效' }
function formatDate(value) { return new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }
function planDaysRemaining(value) {
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return 0
  return Math.max(0, Math.ceil((timestamp - Date.now()) / 86400000))
}
function defaultDeadline(days) { return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10) }
function normalizeNoticeSettings(settings = {}) {
  const next = { ...DEFAULT_NOTICE_SETTINGS }
  if (settings && typeof settings === 'object') {
    Object.keys(DEFAULT_NOTICE_SETTINGS).forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(settings, key)) next[key] = Boolean(settings[key])
    })
  }
  return next
}

function normalizeFileCleanupSettings(settings = {}) {
  const source = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {}
  const days = Number(source.days)
  return {
    enabled: Boolean(source.enabled),
    days: [1, 3, 7].includes(days) ? days : 3,
  }
}

function normalizeMessages(messages = []) {
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
function formatMessageTime(value) {
  if (!value) return '刚刚'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '刚刚' : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function resizeAvatarFile(file) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const objectUrl = URL.createObjectURL(file)
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('头像图片无法读取'))
    }
    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      const maxSize = 512
      const scale = Math.min(1, maxSize / Math.max(image.width, image.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.width * scale))
      canvas.height = Math.max(1, Math.round(image.height * scale))
      const context = canvas.getContext('2d')
      if (!context) {
        reject(new Error('当前浏览器不支持头像压缩'))
        return
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      const dataUrl = canvas.toDataURL('image/webp', 0.86)
      if (dataUrl.length > 580000) {
        reject(new Error('头像压缩后仍然过大，请选择更小的图片'))
        return
      }
      resolve(dataUrl)
    }
    image.src = objectUrl
  })
}
function userAvatarSource(user = {}) {
  if (user.avatarSource === 'custom' && user.avatar) return user.avatar
  if (user.providerAvatar || user.avatar) return user.providerAvatar || user.avatar
  const provider = String(user.provider || '').toLowerCase()
  const label = provider.includes('qq') ? 'QQ' : provider.includes('wechat') || provider.includes('weixin') || provider.includes('微信') ? '微' : ''
  if (!label) return ''
  const background = label === 'QQ' ? '#4c9fe8' : '#20ad68'
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" rx="64" fill="${background}"/><text x="64" y="76" text-anchor="middle" fill="white" font-family="Arial,sans-serif" font-size="${label === 'QQ' ? 30 : 42}" font-weight="700">${label}</text></svg>`)}`
}
function displayUserName(user = {}) { return user.nickname || user.username || user.email || '鲲穹用户' }
function displayUserInitial(user = {}) { return displayUserName(user).trim().slice(0, 1).toUpperCase() || '鲲' }
function displayUserSubtitle(user = {}) { return user.email || maskPhone(user.phone) || user.username || '已登录' }
function maskPhone(value = '') {
  const phone = String(value)
  return phone.length >= 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : phone
}

createRoot(document.getElementById('root')).render(<App />)
