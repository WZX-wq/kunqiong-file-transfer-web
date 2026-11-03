// 本机运行中实例的只读压测抽检：真实数据 + 本机 MySQL 8.0（3306）。
// 只调用健康检查、静态页面与管理端只读接口，不创建/修改业务数据。
// 管理员凭据从环境变量或项目 .env 读取，不写入日志与证据。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.resolve(process.env.PERFORMANCE_LIVE_EVIDENCE_DIR || path.join(root, 'docs/performance-evidence/live-local'))
fs.mkdirSync(output, { recursive: true })
const base = process.env.PERFORMANCE_LIVE_BASE || 'http://127.0.0.1:8045'
const stageSeconds = Number(process.env.PERFORMANCE_LIVE_STAGE_SECONDS || 5)

function envFromFile() {
  const values = new Map()
  const file = path.join(root, '.env')
  if (!fs.existsSync(file)) return values
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (match) values.set(match[1], match[2].trim().replace(/^["']|["']$/g, ''))
  }
  return values
}
const fileEnv = envFromFile()
const adminUser = process.env.KUNQIONG_ADMIN_USERNAME || fileEnv.get('KUNQIONG_ADMIN_USERNAME') || ''
const adminPassword = process.env.KUNQIONG_ADMIN_PASSWORD || fileEnv.get('KUNQIONG_ADMIN_PASSWORD') || ''

const results = { executedAt: new Date().toISOString(), base, stageSeconds, stages: [], errors: [], account: { authenticated: false } }
const log = (line) => console.log(line)

function percentile(values, p) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] * 100) / 100
}
function summary(values) {
  return { count: values.length, p50Ms: percentile(values, 0.5), p95Ms: percentile(values, 0.95), p99Ms: percentile(values, 0.99), maxMs: percentile(values, 1) }
}

let cookie = ''
async function login() {
  if (!adminUser || !adminPassword) return false
  const response = await fetch(base + '/api/admin/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: adminUser, password: adminPassword }),
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error('管理员登录失败 HTTP ' + response.status)
  const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []
  cookie = cookies.map(value => value.split(';')[0]).join('; ')
  results.account.authenticated = Boolean(cookie)
  return Boolean(cookie)
}

async function stage(name, { concurrency, url, expectedStatus = 200, validate }) {
  const durations = [], errors = []
  let requests = 0
  const deadline = performance.now() + stageSeconds * 1000
  const workers = Array.from({ length: concurrency }, async () => {
    while (performance.now() < deadline) {
      const begin = performance.now()
      try {
        const response = await fetch(base + url, { headers: cookie ? { cookie } : {}, signal: AbortSignal.timeout(15000) })
        const body = await response.text()
        const ok = response.status === expectedStatus && (!validate || validate(body))
        if (!ok) throw new Error('unexpected response ' + response.status + ' ' + body.slice(0, 120))
        requests++
      } catch (error) {
        if (errors.length < 5) errors.push(String(error.message).slice(0, 200))
      }
      durations.push(performance.now() - begin)
    }
  })
  await Promise.all(workers)
  const record = { name, concurrency, requests, requestsPerSecond: Math.round(10 * requests / stageSeconds) / 10, latency: summary(durations), failures: durations.length - requests, errorSamples: errors }
  results.stages.push(record)
  log(`${name}: rps=${record.requestsPerSecond} p95=${record.latency.p95Ms}ms fail=${record.failures}`)
}

try {
  const health = await (await fetch(base + '/api/health', { signal: AbortSignal.timeout(10000) })).json()
  results.health = health
  if (!health?.ready) throw new Error('本机实例未就绪：' + JSON.stringify(health))
  log('health ready=' + health.ready + ' service=' + health.service)
  const authenticated = await login()
  log('admin authenticated=' + authenticated)
  results.account.authenticated = authenticated
  await stage('健康检查 C20', { concurrency: 20, url: '/api/health', validate: body => JSON.parse(body).ok === true })
  await stage('前端页面 C20', { concurrency: 20, url: '/team', validate: body => body.includes('<div id="root"') || body.includes('<!doctype html') || body.length > 1000 })
  if (authenticated) {
    await stage('管理会话 C5', { concurrency: 5, url: '/api/admin/session', validate: body => JSON.parse(body).authenticated === true })
    await stage('管理总览只读 C5', { concurrency: 5, url: '/api/admin/overview', validate: body => Array.isArray(JSON.parse(body).users) })
  }
} catch (error) {
  results.errors.push(error.stack || error.message)
  console.error('LIVE CHECK FAILED:', error.message)
} finally {
  results.finishedAt = new Date().toISOString()
  results.failed = results.errors.length > 0 || results.stages.some(stage => stage.failures > 0)
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify({ failed: results.failed, stages: results.stages, evidence: output }, null, 2))
  process.exitCode = results.failed ? 1 : 0
}
