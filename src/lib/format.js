// 由 main.jsx 抽取的工具函数（2026-10-09）
// 纯函数，零 React/组件依赖。

export function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function addLocalDays(date, days) {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

export function parseLocalDate(value) {
  if (!value) return null
  const [year, month, day] = value.split('-').map(Number)
  if (![year, month, day].every(Number.isFinite)) return null
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null
}

export function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

export function addMonths(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1)
}

export function formatDateInput(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function isPastDeadline(value) {
  if (!value) return false
  const time = new Date(value).getTime()
  return Number.isFinite(time) && time <= Date.now()
}

export function isClosedStatus(status) {
  return ['closed', '已关闭'].includes(status)
}

export function isExpiredStatus(status) {
  return ['expired', '已过期', '已失效', '已截止', '无管理权限'].includes(status)
}

export function isExpiringSoonStatus(status) {
  return ['expiring', '即将过期', '即将截止'].includes(status)
}

export function formatShortDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function recordAgeLabel(createdAt) {
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

export function fileExtension(name = '') {
  const match = String(name).toLowerCase().match(/\.([^.\\/]+)$/)
  return match ? match[1] : ''
}

export function splitFileNameForDisplay(name = '') {
  const text = String(name || '').trim()
  const match = text.match(/^(.+?)(\.[^.\\/]{1,12})$/)
  if (!match || !match[1]) return { base: text, extension: '' }
  return { base: match[1], extension: match[2] }
}

export function totalFileSize(files = []) {
  return files.reduce((sum, file) => sum + Number(file.size || 0), 0)
}

export function safeDownloadName(value) {
  return String(value || '下载文件').replace(/[\\/:*?"<>|]+/g, '-').trim() || '下载文件'
}

export function formatBytes(bytes = 0) {
  const value = Number(bytes) || 0
  if (value < 1024) return `${Math.max(0, Math.round(value))} B`
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function formatLimitSize(value) {
  const mb = Number(value || 0)
  if (!mb) return '不限大小'
  if (mb >= 1024) return `${Number((mb / 1024).toFixed(1))} GB`
  return `${mb} MB`
}
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '计算中'
  if (seconds <= 0) return '即将完成'
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const restSeconds = seconds % 60
  if (minutes < 60) return `${minutes} 分 ${restSeconds} 秒`
  const hours = Math.floor(minutes / 60)
  return `${hours} 小时 ${minutes % 60} 分`
}
export function formatPlanPrice(plan = {}) {
  const amount = Number(plan.monthlyPrice)
  if (plan.id === 'free' || amount === 0) return '免费使用'
  if (!Number.isFinite(amount) || amount < 0) return '价格以主站为准'
  const days = Number(plan.validityDays)
  // Price comes from the provider; duration is the configured local entitlement.
  if (plan.remotePriced && Number.isFinite(days) && days > 0) return `¥${(amount / 100).toFixed(2)} / ${days}天`
  if (plan.permanent || plan.validityDays === null || plan.validityDays === undefined) {
    return `¥${(amount / 100).toFixed(2)} / 永久`
  }
  return Number.isFinite(days) && days > 0
    ? `¥${(amount / 100).toFixed(2)} / ${days}天`
    : `¥${(amount / 100).toFixed(2)}`
}

export function formatExpiry(value) { return value ? `有效期至 ${new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '永久有效' }
export function formatDate(value) { return new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }
export function planDaysRemaining(value) {
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return 0
  return Math.max(0, Math.ceil((timestamp - Date.now()) / 86400000))
}
export function defaultDeadline(days) { return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10) }

export function formatMessageTime(value) {
  if (!value) return '刚刚'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '刚刚' : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function displayUserName(user = {}) { return user.nickname || user.username || user.email || '鲲穹用户' }

export function maskPhone(value = '') {
  const phone = String(value)
  return phone.length >= 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : phone
}

export function feedbackTone(message = '') {
  return /失败|错误|无效|不可用|不能|无法|不能为空|不足|过期|不正确|未配置|未生效|拒绝|异常|请先|请输入|未登录|未投递|不存在|已失效|没有可|不支持|通道|需接入|暂不|暂无|暂未|尚未|需要会员|更高权益/.test(String(message)) ? 'error' : 'success'
}
