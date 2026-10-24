// 定向分发的输入解析与匹配规则。这里不读写 metadata，便于接口和测试复用。
import { contactMatchesUser, normalizeBindingTarget } from './contact-input.js'
const DISTRIBUTION_ID_MAX = 80

function clean(value, max = 160) {
  const text = String(value ?? '').trim()
  if (!text || text.length > max || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(text)) return ''
  return text
}

export function distributionFileKey(name) {
  const raw = clean(name, 240)
  const match = raw.match(/^([A-Za-z0-9][A-Za-z0-9._-]{0,79})__(.+)$/)
  if (!match || !match[2].trim() || match[2].includes('/') || match[2].includes('\\')) return null
  return { key: match[1], displayName: match[2].trim() }
}

export function parseDistributionFiles(files = []) {
  const rows = []
  const issues = []
  for (const [index, file] of (Array.isArray(files) ? files : []).entries()) {
    const name = clean(file?.name ?? file?.originalname ?? '', 240)
    const parsed = distributionFileKey(name)
    if (!parsed) {
      issues.push({ code: 'invalid_file_name', line: index + 1, message: `文件“${name || `第 ${index + 1} 个文件`}”不符合“编号__文件名.ext”格式` })
      continue
    }
    rows.push({ key: parsed.key, name, displayName: parsed.displayName, index, file })
  }
  const seen = new Map()
  for (const row of rows) {
    if (seen.has(row.key)) issues.push({ code: 'duplicate_file_key', key: row.key, message: `文件编号 ${row.key} 重复` })
    else seen.set(row.key, row)
  }
  return { rows, issues }
}

export function parseDistributionRoster(input) {
  const text = Array.isArray(input) ? input.join('\n') : String(input ?? '')
  const rows = []
  const issues = []
  text.split(/\r?\n/).forEach((line, index) => {
    const raw = line.trim()
    if (!raw || raw.startsWith('#')) return
    const cells = raw.split(/[\t,，]/).map(item => item.trim())
    if (index === 0 && /^(编号|id|key)$/i.test(cells[0] || '') && /收件人|recipient/i.test(cells[1] || '')) return
    if (cells.length !== 2 || !clean(cells[0], DISTRIBUTION_ID_MAX) || !clean(cells[1])) {
      issues.push({ code: 'invalid_roster_line', line: index + 1, message: `第 ${index + 1} 行应为“编号,收件人”` })
      return
    }
    rows.push({ key: clean(cells[0], DISTRIBUTION_ID_MAX), recipient: clean(cells[1]), line: index + 1 })
  })
  const seen = new Map()
  for (const row of rows) {
    if (seen.has(row.key)) issues.push({ code: 'duplicate_roster_key', key: row.key, line: row.line, message: `名单编号 ${row.key} 重复` })
    else seen.set(row.key, row)
  }
  return { rows, issues }
}

function recipientMatches(raw, user) {
  const value = String(raw || '').trim().toLowerCase()
  const contact = normalizeBindingTarget(String(raw || ''))
  if (contact && contactMatchesUser(contact, user)) return true
  return [user?.id, user?.username, user?.email, user?.phone]
    .filter(Boolean)
    .some(item => String(item).trim().toLowerCase() === value)
}

export function resolveDistributionRecipient(raw, users = []) {
  const matches = (Array.isArray(users) ? users : []).filter(user => recipientMatches(raw, user) && user.status !== 'disabled')
  if (!matches.length) return { error: 'recipient_not_found', message: `收件人“${raw}”不存在或未绑定账号` }
  if (matches.length > 1) return { error: 'recipient_ambiguous', message: `收件人“${raw}”匹配到多个账号` }
  const user = matches[0]
  return { userId: String(user.id), displayName: String(user.nickname || user.username || user.email || user.phone || user.id) }
}

export function buildDistributionPreview({ files = [], roster = '', users = [] } = {}) {
  const fileResult = parseDistributionFiles(files)
  const rosterResult = parseDistributionRoster(roster)
  const issues = [...fileResult.issues, ...rosterResult.issues]
  const fileByKey = new Map(fileResult.rows.map(row => [row.key, row]))
  const rosterKeys = new Set(rosterResult.rows.map(row => row.key))
  const rows = []
  for (const row of rosterResult.rows) {
    const file = fileByKey.get(row.key)
    const resolved = resolveDistributionRecipient(row.recipient, users)
    if (!file) issues.push({ code: 'missing_file', key: row.key, line: row.line, message: `编号 ${row.key} 没有对应文件` })
    if (resolved.error) issues.push({ code: resolved.error, key: row.key, line: row.line, message: resolved.message })
    rows.push({ key: row.key, rosterLine: row.line, recipient: row.recipient, fileName: file?.name || '', displayName: file?.displayName || '', userId: resolved.userId || '', recipientName: resolved.displayName || '', fileIndex: file?.index ?? -1 })
  }
  for (const file of fileResult.rows) {
    if (!rosterKeys.has(file.key)) issues.push({ code: 'unmatched_file', key: file.key, message: `文件编号 ${file.key} 没有对应收件人` })
  }
  return { ok: issues.length === 0, rows, issues, recipientUserIds: [...new Set(rows.map(row => row.userId).filter(Boolean))] }
}

