// 浏览器和服务端共用的纯校验；仅约束新输入，不改写历史 OAuth 联系方式。
export const EMAIL_MAX_LENGTH = 160
export const PHONE_LENGTH = 11
export const MAX_RECIPIENTS = 50
export const RECIPIENT_TEXT_MAX = 8050

export function normalizePhoneContact(value) {
  const raw = String(value || '').trim()
  if (!/^[+\d ()-]+$/.test(raw)) return ''
  const compact = raw.replace(/[ ()-]/g, '')
  const match = compact.match(/^(?:\+86|0086|86)?(1[3-9]\d{9})$/)
  return match?.[1] || ''
}

export function normalizeBindingTarget(value, type = '') {
  if (typeof value !== 'string' || (type && !['phone', 'email'].includes(type))) return null
  if (value.length > EMAIL_MAX_LENGTH || /[<>\u0000-\u001f\u007f]/.test(value)) return null
  const raw = value.trim()
  if (!raw) return null
  if (type !== 'phone' && raw.includes('@')) {
    const parts = raw.split('@')
    if (parts.length !== 2) return null
    const [local, domain] = parts
    if (!local || local.length > 64 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)
      || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return null
    const labels = domain.split('.')
    if (labels.length < 2 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return null
    if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/i.test(labels.at(-1))) return null
    const email = raw.toLowerCase()
    return { type: 'email', value: email, label: email }
  }
  if (type === 'email') return null
  const phone = normalizePhoneContact(raw)
  return phone ? { type: 'phone', value: phone, label: phone } : null
}

export function contactInputError(value, type) {
  const label = type === 'email' ? '邮箱' : '手机号'
  if (!String(value || '').trim()) return `请输入要绑定的${label}`
  if (normalizeBindingTarget(value, type)) return ''
  return type === 'email' ? '邮箱格式不正确，请输入如 name@example.com 的地址（最多 160 个字符）' : '请输入 11 位中国大陆手机号，以 1 开头，第二位为 3–9'
}

export function contactMatchesUser(target, user = {}) {
  if (target?.type === 'email') return String(user?.email || '').trim().toLowerCase() === target.value.toLowerCase()
  if (target?.type === 'phone') {
    const phone = normalizePhoneContact(target.value)
    return phone ? normalizePhoneContact(user?.phone) === phone : String(user?.phone || '').replace(/[^\d]/g, '') === target.value
  }
  return false
}

export function recipientInputError(value, user = {}) {
  if (typeof value !== 'string' && !Array.isArray(value)) return '收件人须为文本或文本列表'
  if (typeof value === 'string' && value.length > RECIPIENT_TEXT_MAX) return `收件人内容最多 ${RECIPIENT_TEXT_MAX} 个字符`
  if (Array.isArray(value) && value.some(item => typeof item !== 'string')) return '收件人列表只能包含文本'
  const recipients = Array.isArray(value) ? value.map(String).map(item => item.trim()).filter(Boolean)
    : String(value || '').split(/[\n,，;；\s]+/).filter(Boolean)
  // 检查整个列表后再限制数量，避免本人联系人被截断后静默发送。
  if (recipients.some(raw => contactMatchesUser({ type: raw.includes('@') ? 'email' : 'phone', value: raw }, user)
    || [user?.id, user?.username].filter(Boolean).some(id => String(id).toLowerCase() === raw.toLowerCase()))) {
    return '定向发送不能填写自己的手机号、邮箱或账号，请选择其他收件人'
  }
  if (recipients.some(raw => raw.length > EMAIL_MAX_LENGTH || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(raw))) return '收件人内容过长或包含不支持的字符'
  if (recipients.some(raw => (raw.includes('@') || /^[+\d ()-]+$/.test(raw)) && !normalizeBindingTarget(raw))) return '手机号或邮箱格式不正确，请输入 11 位中国大陆手机号或有效邮箱'
  return recipients.length > MAX_RECIPIENTS ? `定向发送最多填写 ${MAX_RECIPIENTS} 个收件人` : ''
}
