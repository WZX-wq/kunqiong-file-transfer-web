// 定向分发的输入解析与匹配规则。这里不读写 metadata，便于接口和测试复用。
import { contactMatchesUser, normalizeBindingTarget } from './contact-input.js'

const DISTRIBUTION_ID_MAX = 80
// 兼容历史格式：文件名前缀“编号__”。新流程不再要求改名，带前缀时只用来做编号配对。
const FILE_PREFIX = /^([A-Za-z0-9][A-Za-z0-9._-]{0,79})__(.+)$/
const ROSTER_HEADER = /^(编号|序号|id|key|#|收件人|recipient)$/i

function clean(value, max = 160) {
  const text = String(value ?? '').trim()
  if (!text || text.length > max || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(text)) return ''
  return text
}

export function distributionFileKey(name) {
  const raw = clean(name, 240)
  const match = raw.match(FILE_PREFIX)
  if (!match || !match[2].trim() || match[2].includes('/') || match[2].includes('\\')) return null
  return { key: match[1], displayName: match[2].trim() }
}

// 文件名保持用户上传时的样子：带“编号__”时拆出编号与展示名，不带编号时原样使用。
export function parseDistributionFiles(files = []) {
  const rows = []
  for (const [index, file] of (Array.isArray(files) ? files : []).entries()) {
    const name = clean(file?.name ?? file?.originalname ?? '', 240)
    const parsed = distributionFileKey(name)
    rows.push({ key: parsed?.key || '', name, displayName: parsed?.displayName || name, index, file })
  }
  const issues = []
  const seen = new Map()
  for (const row of rows) {
    if (!row.key) continue
    if (seen.has(row.key)) issues.push({ code: 'duplicate_file_key', key: row.key, fileIndex: row.index, message: `文件编号 ${row.key} 重复` })
    else seen.set(row.key, row)
  }
  return { rows, issues }
}

// 名单每行一个收件人即可；也兼容从表格粘贴的“编号,收件人”两列格式。
export function parseDistributionRoster(input) {
  const text = Array.isArray(input) ? input.join('\n') : String(input ?? '')
  const rows = []
  const issues = []
  text.split(/\r?\n/).forEach((line, index) => {
    const raw = line.trim()
    if (!raw || raw.startsWith('#')) return
    const cells = raw.split(/[\t,，]/).map(item => item.trim())
    if (ROSTER_HEADER.test(cells[0] || '')) return
    let key = ''
    let recipient = raw
    if (cells.length === 2) { key = cells[0]; recipient = cells[1] }
    if (!clean(recipient)) {
      issues.push({ code: 'invalid_roster_line', line: index + 1, message: `第 ${index + 1} 行没有填写收件人` })
      return
    }
    rows.push({ key: clean(key, DISTRIBUTION_ID_MAX), recipient: clean(recipient), line: index + 1 })
  })
  const seen = new Map()
  for (const row of rows) {
    if (!row.key) continue
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

// 前端逐条调整后的配对：fileIndex 对应上传顺序，recipient 是收件人标识。
function normalizeAssignments(assignments) {
  const rows = []
  for (const [order, item] of (Array.isArray(assignments) ? assignments : []).entries()) {
    const fileIndex = Number(item?.fileIndex ?? item?.index)
    if (!Number.isInteger(fileIndex) || fileIndex < 0) continue
    rows.push({ fileIndex, recipient: clean(item?.recipient, 160), order })
  }
  return rows
}

export function buildDistributionPreview({ files = [], roster = '', assignments = null, users = [] } = {}) {
  const fileResult = parseDistributionFiles(files)
  const issues = [...fileResult.issues]
  const fileByIndex = new Map(fileResult.rows.map(row => [row.index, row]))
  const pairs = []

  const explicit = normalizeAssignments(assignments)
  if (explicit.length) {
    const claimed = new Set()
    for (const item of explicit) {
      const file = fileByIndex.get(item.fileIndex)
      if (!file) {
        issues.push({ code: 'unknown_file', line: item.order + 1, message: `第 ${item.order + 1} 条配对找不到对应文件` })
        continue
      }
      if (claimed.has(item.fileIndex)) {
        issues.push({ code: 'duplicate_file_index', fileIndex: item.fileIndex, message: `文件“${file.displayName}”被重复配对` })
        continue
      }
      claimed.add(item.fileIndex)
      pairs.push({ fileIndex: item.fileIndex, recipient: item.recipient, rosterLine: 0 })
    }
  } else {
    const rosterResult = parseDistributionRoster(roster)
    issues.push(...rosterResult.issues)
    const used = new Set()
    const take = predicate => {
      const index = rosterResult.rows.findIndex((row, i) => !used.has(i) && predicate(row))
      if (index < 0) return null
      used.add(index)
      return rosterResult.rows[index]
    }
    const pending = [...fileResult.rows]
    // 文件与名单都带编号时按编号配对，保留原有严格语义；否则按上传顺序配对。
    const strict = pending.some(row => row.key) && rosterResult.rows.some(row => row.key)
    if (strict) {
      for (const file of [...pending]) {
        if (!file.key) continue
        const row = take(item => item.key && item.key === file.key)
        if (!row) continue
        pairs.push({ fileIndex: file.index, recipient: row.recipient, rosterLine: row.line })
        pending.splice(pending.indexOf(file), 1)
      }
    }
    for (const file of pending) {
      const row = take(item => (strict ? !item.key : true))
      if (!row) break
      pairs.push({ fileIndex: file.index, recipient: row.recipient, rosterLine: row.line })
    }
    rosterResult.rows.forEach((row, index) => {
      if (used.has(index)) return
      issues.push(row.key
        ? { code: 'missing_file', key: row.key, line: row.line, message: `编号 ${row.key} 没有对应文件` }
        : { code: 'extra_recipient', line: row.line, message: `第 ${row.line} 行的收件人没有对应文件` })
    })
  }

  const rows = []
  for (const pair of pairs) {
    const file = fileByIndex.get(pair.fileIndex)
    if (!file) continue
    const resolved = pair.recipient ? resolveDistributionRecipient(pair.recipient, users) : { error: 'missing_recipient', message: `文件“${file.displayName}”还没有指定收件人` }
    if (resolved.error) issues.push({ code: resolved.error, key: file.key, fileIndex: file.index, line: pair.rosterLine || undefined, message: resolved.message })
    rows.push({
      key: file.key || String(file.index + 1),
      rosterLine: pair.rosterLine,
      recipient: pair.recipient,
      fileName: file.name,
      displayName: file.displayName,
      userId: resolved.userId || '',
      recipientName: resolved.displayName || '',
      fileIndex: file.index,
    })
  }
  rows.sort((left, right) => left.fileIndex - right.fileIndex)
  const paired = new Set(rows.map(row => row.fileIndex))
  for (const file of fileResult.rows) {
    if (paired.has(file.index)) continue
    issues.push({ code: 'unmatched_file', key: file.key || String(file.index + 1), fileIndex: file.index, message: `文件“${file.displayName}”还没有对应收件人` })
  }
  return { ok: issues.length === 0, rows, issues, recipientUserIds: [...new Set(rows.map(row => row.userId).filter(Boolean))] }
}
