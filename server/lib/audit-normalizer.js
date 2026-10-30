import { createToken } from './http.js'

function trimRecordString(value, maxLength) {
  const text = String(value ?? '').trim()
  const sliced = text.length > maxLength ? text.slice(0, maxLength) : text
  return sliced.replace(/[\uD800-\uDBFF]$/, '').toWellFormed()
}

function normalizeRecordDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function normalizeNonNegativeInteger(value) {
  const number = Number(value || 0)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0
}

export function normalizeAuditLog(item) {
  return {
    id: trimRecordString(item?.id, 80) || createToken(10),
    type: trimRecordString(item?.type, 30) || 'access',
    action: trimRecordString(item?.action, 180),
    status: normalizeNonNegativeInteger(item?.status),
    durationMs: normalizeNonNegativeInteger(item?.durationMs),
    userId: trimRecordString(item?.userId, 120),
    targetId: trimRecordString(item?.targetId, 160),
    ip: trimRecordString(item?.ip, 80),
    details: item?.details && typeof item.details === 'object' ? item.details : {},
    createdAt: normalizeRecordDate(item?.createdAt) || new Date().toISOString(),
  }
}
