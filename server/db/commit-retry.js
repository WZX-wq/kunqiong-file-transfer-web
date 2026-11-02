// 事务提交的有界重试策略：只重试可安全重放的事务级冲突。
// 提交确认丢失不在其中：MySQL 可能已提交，必须按结果不确定处理。
export const RETRYABLE_DATABASE_COMMIT_CODES = new Set([
  'ER_LOCK_DEADLOCK',
  'ER_LOCK_WAIT_TIMEOUT',
])

export const RETRYABLE_CONFLICT_CODES = new Set([
  'CAPACITY_CHANGED',
  'COLLECTION_COUNT_CHANGED',
])

export function isRetryableCommitError(error) {
  return Boolean(error) && (RETRYABLE_DATABASE_COMMIT_CODES.has(error.code) || RETRYABLE_CONFLICT_CODES.has(error.code))
}

// Only the caller knows whether COMMIT has been sent. Before that boundary an
// abandoned InnoDB transaction can be discarded and retried on a new connection.
const TRANSACTION_CONNECTION_ERRORS = new Set([
  'DATABASE_QUERY_TIMEOUT', 'PROTOCOL_SEQUENCE_TIMEOUT', 'PROTOCOL_CONNECTION_LOST',
  'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
])
export function isTransactionConnectionError(error) {
  return Boolean(error) && TRANSACTION_CONNECTION_ERRORS.has(error.code)
}

export function commitAttempts() {
  const value = Number(process.env.KUNQIONG_DB_COMMIT_ATTEMPTS || 8)
  return Number.isSafeInteger(value) && value >= 1 && value <= 10 ? value : 8
}

export function commitRetryDelay(attempt) {
  const base = Math.min(80, 15 * 2 ** Math.max(0, attempt - 1))
  return base + Math.floor(Math.random() * 15)
}

export const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
