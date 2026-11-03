import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'

const requests = new AsyncLocalStorage()

export async function measureDatabaseOperation(kind, task) {
  const metrics = requests.getStore()
  if (!metrics) return task()
  const started = performance.now()
  if (kind === 'sql') metrics.sqlCount++
  try { return await task() }
  finally { metrics[kind === 'queue' ? 'queueMs' : 'sqlMs'] += performance.now() - started }
}

export async function measureRequestPreparation(task) {
  const metrics = requests.getStore(), started = performance.now()
  try { return await task() }
  finally { if (metrics) metrics.prepareMs += performance.now() - started }
}

export function requestMetrics({ onFinish = () => {} } = {}) {
  return (req, res, next) => {
    const metrics = { startedAt: performance.now(), sqlCount: 0, sqlMs: 0, queueMs: 0, prepareMs: 0 }
    req.requestMetrics = metrics
    res.locals.requestId = randomUUID()
    res.setHeader('X-Request-Id', res.locals.requestId)
    const snapshot = () => ({
      durationMs: Math.round(performance.now() - metrics.startedAt), sqlCount: metrics.sqlCount,
      sqlMs: Math.round(metrics.sqlMs), queueMs: Math.round(metrics.queueMs), prepareMs: Math.round(metrics.prepareMs),
    })
    const writeHead = res.writeHead
    res.writeHead = function (...args) {
      if (!res.headersSent && req.path.startsWith('/api/')) {
        const time = snapshot()
        res.setHeader('Server-Timing', `prepare;dur=${time.prepareMs}, db;dur=${time.sqlMs}, dbqueue;dur=${time.queueMs}, total;dur=${time.durationMs}`)
      }
      return writeHead.apply(this, args)
    }
    res.once('finish', () => onFinish(req, res, snapshot()))
    requests.run(metrics, next)
  }
}
