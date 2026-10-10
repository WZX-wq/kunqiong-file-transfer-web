// HTTP 错误构造与通用纯函数
// 本文件由 scripts/refactor/extract-config.mjs 从 server.mjs 逐字抽取生成。
import crypto from 'node:crypto'
import fs from 'node:fs'

export function httpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

export function parseRecipients(value, { max = Infinity } = {}) {
  const list = Array.isArray(value)
    ? value.map(String).map((item) => item.trim()).filter(Boolean)
    : String(value || '')
      .split(/[\n,，;；\s]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  return max === Infinity ? list : list.slice(0, max)
}

export function firstHeader(value) {
  return String(value || '').split(',')[0].trim()
}

export function firstValue(value) {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '')
}

export function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function createToken(length) {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length)
}

export function hashSecret(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

export function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}

export function removeDirectory(directory) {
  // 异步删除（不阻塞事件循环）：此前用 fs.rmSync 同步递归删除，删除大目录
  // （分片上传会话可达上百个文件）或删除系统调用变慢时，会堵住主线程，
  // 所有 API 请求排队（表现为整站周期性卡 10s+）。删除失败的目录由调用方
  // 的清扫/恢复逻辑兜底（过期会话不再恢复，不再反复重试）。
  if (!directory) return
  fs.rm(directory, { recursive: true, force: true }, (error) => {
    if (error && error.code !== 'ENOENT') console.warn('[removeDirectory] 删除失败:', directory, '→', error?.message || error)
  })
}
