// 由 main.jsx 抽取的工具函数（2026-10-09）
// 纯函数，零 React/组件依赖。
import {
  Bell, Crown, FileArchive, FileCheck2, FileText, HardDrive, ShieldCheck, Sparkles, Trash2,
  UserRound, Users
} from 'lucide-react'

export const MAX_FILES = 100
export const MAX_FILE_SIZE = 20 * 1024 * 1024 * 1024
export const defaultSettings = {
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

export const COLLECTION_TYPE_OPTIONS = ['全部格式', '图片', '文档', '视频', '音频', '压缩包', '代码文件', '其他']
// 收集任务字段长度上限（与后端 server/config.js 的 COLLECTION_TITLE_MAX / COLLECTION_DESCRIPTION_MAX 保持一致）
// 超长文本会把预览卡、管理页头部、公开提交页撑变形，两端同时设限并给出可理解的错误。
export const COLLECTION_TITLE_MAX = 40
export const COLLECTION_DESCRIPTION_MAX = 120
export const COLLECTION_TYPE_EXTENSIONS = {
  图片: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif', 'ico'],
  文档: ['pdf', 'doc', 'docx', 'txt', 'rtf', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'md'],
  视频: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', 'ogv', 'flv', 'wmv'],
  音频: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'oga', 'ogg', 'wma'],
  压缩包: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'],
  代码文件: ['js', 'jsx', 'ts', 'tsx', 'html', 'css', 'json', 'xml', 'yml', 'yaml', 'java', 'py', 'go', 'php', 'rb', 'rs', 'c', 'cpp', 'h', 'cs', 'sh', 'ps1', 'bat', 'cmd', 'sql'],
}
export const COLLECTION_TYPE_CATEGORY_KEYS = {
  图片: 'image',
  文档: 'document',
  视频: 'video',
  音频: 'audio',
  压缩包: 'archive',
  代码文件: 'code',
  其他: 'other',
}

export const FOOTER_CONTENT = {
  help: {
    eyebrow: '使用帮助',
    title: '帮助中心',
    sections: [
      {
        title: '发送文件',
        items: [
          '在“发文件”页面选择文件或文件夹，也可以直接拖拽到上传区域。',
          '上传完成后系统会生成取件码、分享链接和二维码，对方无需注册即可提取。',
          '首页展示系统最高支持的单文件大小，实际上传额度由登录状态、账号套餐与后台配置决定。选择超过当前额度的文件时会提示限制。大文件会自动分片上传，异常中断后可重试。',
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

export const fileIcon = (name = '') => {
  if (/\.(zip|rar|7z|tar|gz)$/i.test(name)) return FileArchive
  if (/\.(pdf|doc|docx|txt|xls|xlsx|ppt|pptx)$/i.test(name)) return FileText
  return FileCheck2
}

export const MAIN_VIEWS = new Set(['send', 'collect', 'records'])

export const TEXT_PREVIEW_MAX_BYTES = 512 * 1024

export const RECORD_SCOPE_TABS = [
  { key: 'all', label: '全部' },
  { key: 'my_sent', label: '我发送的' },
  { key: 'sent_to_me', label: '发给我的' },
  { key: 'my_collections', label: '我收集的' },
  { key: 'collect_from_me', label: '向我收集的' },
]

export const RECORD_DATE_FILTERS = [
  ['all', '全部日期'],
  ['today', '今天'],
  ['7d', '近 7 天'],
  ['30d', '近 30 天'],
  ['range', '自定义'],
]

export const RECORD_STATUS_FILTERS = [
  ['all', '全部状态'],
  ['active', '有效/进行中'],
  ['expiring', '即将过期'],
  ['expired', '已过期/已截止/已关闭'],
]

export const RECORD_VIEW_MODES = [
  ['records', '收发记录'],
  ['files', '文件管理'],
]

export const FILE_CATEGORY_FILTERS = [
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

export const SETTINGS_NAV_ITEMS = [
  { key: 'profile', label: '个人资料', icon: UserRound, path: '/settings/profile' },
  { key: 'security', label: '账号与安全', icon: ShieldCheck, path: '/settings/security' },
  { key: 'notice', label: '消息通知', icon: Bell, path: '/settings/notice' },
  { key: 'cleanup', label: '文件清理', icon: Trash2, path: '/settings/cleanup' },
  { key: 'orders', label: '我的订单', icon: FileText, path: '/settings/orders' },
]

export const DEFAULT_NOTICE_SETTINGS = {
  inApp: true,
  email: false,
  incomingShare: true,
  shareExpiring: true,
  shareDownloaded: true,
  collectionExpiring: true,
  collectionSubmitted: true,
}

export const UPGRADE_ORDER_STATUS_LABELS = {
  pending_payment: '待支付',
  paid: '已开通',
  canceled: '已取消',
  expired: '已过期',
}
export const ACCOUNT_PLAN_RANK = { free: 0, member: 1, team: 2, halfyear: 3, year: 4, enterprise: 5 }

export const ACCOUNT_PLAN_ICON = { free: HardDrive, member: Sparkles, team: Users, halfyear: Users, year: Crown, enterprise: Crown }

export const RECORD_STORAGE_KEY = 'kunqiong-records'
export const MAX_LOCAL_RECORDS = 100
export const EXPIRING_SOON_MS = 24 * 60 * 60 * 1000

export const UPLOAD_RESUME_KEY = 'kunqiong_upload_resume'
export const UPLOAD_RESUME_TTL_MS = 11 * 60 * 60 * 1000

export const TEXT_PREVIEW_EXTENSIONS = new Set([
  'txt', 'md', 'log', 'json', 'xml', 'yml', 'yaml', 'ini', 'conf',
  'js', 'jsx', 'ts', 'tsx', 'html', 'htm', 'css', 'vue', 'swift', 'kt',
  'java', 'py', 'go', 'php', 'rb', 'rs', 'c', 'cpp', 'h', 'cs',
  'sh', 'ps1', 'bat', 'cmd', 'sql',
])
