// 运行期共享状态容器
//
// 这里的 Map/Set 与缓存由路由、定时器和业务模块共同持有，**必须是同一实例** ——
// 例如限流计数、上传会话、管理后台会话、OAuth state，
// 各自持有一份副本会静默失效（限流不生效、会话查不到）。
//
// 拆分 server.mjs 时先把它们集中到本模块，后续各业务模块按需 import，
// 避免“搬走一个函数就得连带搬走它引用的状态”。

import mysql from 'mysql2/promise'
import { boundedPool, positiveSetting } from './db/bounded-pool.js'
import { contextualObject } from './lib/data-context.js'
import {
  databaseEnabled, databaseHost, databasePort, databaseName, databaseUser, databasePassword,
} from './config.js'

// ── 数据库连接池 ─────────────────────────────────────────────
// 全进程唯一。databaseEnabled 为 false 时是 null，调用方需自行判空。
// 注意 mysql2 的 createPool 不会立即建连，首个查询才真正连接。
function createDatabasePool(connectionLimit, lockWaitSeconds = null,
  queryTimeoutMs = positiveSetting(process.env.KUNQIONG_DB_QUERY_TIMEOUT_MS, 60000)) {
  if (!databaseEnabled) return null
  const pool = boundedPool(mysql.createPool({
    host: databaseHost,
    port: databasePort,
    database: databaseName,
    user: databaseUser,
    password: databasePassword,
    waitForConnections: true,
    connectionLimit,
    // mysql2 only schedules idle eviction when maxIdle is below the pool cap.
    // Retire unused proxy connections before their silent network expiry.
    maxIdle: Math.max(0, connectionLimit - 1),
    idleTimeout: 15000,
    queueLimit: positiveSetting(process.env.KUNQIONG_DB_QUEUE_LIMIT, 50, 10000),
    connectTimeout: positiveSetting(process.env.KUNQIONG_DB_CONNECT_TIMEOUT_MS, 10000),
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    timezone: 'Z',
    ...(process.env.KUNQIONG_DB_TLS === 'true' ? { ssl: { rejectUnauthorized: true } } : {}),
    charset: 'utf8mb4',
  }), {
    acquireTimeoutMs: positiveSetting(process.env.KUNQIONG_DB_ACQUIRE_TIMEOUT_MS, 30000),
    queryTimeoutMs,
  })
  pool.on('connection', connection => {
    connection.query(`SET time_zone = '+00:00', max_execution_time = ${positiveSetting(process.env.KUNQIONG_DB_QUERY_TIMEOUT_MS, 60000)}${lockWaitSeconds ? `, innodb_lock_wait_timeout = ${lockWaitSeconds}` : ''}`, error => {
      if (error) connection.destroy()
    })
  })
  return pool
}

export const databasePool = createDatabasePool(positiveSetting(process.env.KUNQIONG_DB_CONNECTION_LIMIT, 5, 100))
// Maintenance and resource queries must not exhaust authentication connections.
// A stalled authentication statement must not hold its transaction for a minute.
// Pre-COMMIT failures can retry the whole transaction; COMMIT is never replayed.
export const databaseAuthPool = createDatabasePool(2, 4, 10000)
// Audit/cleanup/payment work has a separate, small budget and cannot occupy
// all foreground slots while a remote connection is unavailable.
export const databaseMaintenancePool = createDatabasePool(2, 4, 10000)

// ── 元数据运行期标记 ─────────────────────────────────────────
// 为什么要包成对象：ESM 的导入绑定是只读的 —— `import { x }` 之后不能 `x = 1`，
// 而这些值在业务代码里被赋值（如 metadataNeedsPersist = true，共 40 余处）。
// 所以统一放进可变容器，引用处写 runtime.xxx。
export const runtime = contextualObject({
  // 启动期规范化时若修正了旧数据，置为 true，触发一次落盘
  metadataNeedsPersist: false,
  // 指向当前 metadata 快照（与 metadata 同一引用），供少数需要判空的路径使用
  metadataReady: null,
  // SMTP 传输器惰性单例（首次发信时创建）
  emailTransporter: null,
  // 元数据落盘串行队列：所有写入排队，避免并发写覆盖
  metadataWriteQueue: Promise.resolve(),
  // 以下 6 个是 CAS 并发写保护的计数与基线，详见 persistMetadata / persistLocalMetadata
  metadataRevision: 0,
  metadataLocalRevision: 0,
  metadataBaseIds: null,
  metadataLocalBaseIds: null,
  metadataConflictCount: 0,
}, context => context?.runtime)

// ── 分享 ─────────────────────────────────────────────────────
// 已分配的提取码，用于生成时避免碰撞
export const reservedShareCodes = new Set()

// ── 分片上传 ─────────────────────────────────────────────────
// sessionId → 会话状态；容量预留表用于在传输期间就占住配额
export const uploadSessions = new Map()
export const uploadReservations = new Map()
// 分片会话会把完整目标文件逐步写入临时盘。按会话预留其尚未发布的
// 总字节数，避免多个「各自合法」的会话累计耗尽物理存储。
export const uploadDiskReservations = new Map()
export const uploadIntakeReservations = new Map()

// ── 支付与升级 ───────────────────────────────────────────────
// 同一订单的互斥锁，防止并发重复处理
export const upgradeOrderLocks = new Map()
// 对账尝试计数（退避用）与保留的查单凭证
export const paymentReconcileAttempts = new Map()
export const paymentSessionTokens = new Map()

// ── 管理后台 ─────────────────────────────────────────────────
export const adminLoginAttempts = new Map()
export const adminSessions = new Map()

// ── 登录 ─────────────────────────────────────────────────────
// OAuth state，防 CSRF
export const oauthStates = new Map()

// ── 限流计数 ─────────────────────────────────────────────────
// 验证码：按目标（手机/邮箱）+ 按来源 IP
export const verificationTargetLastSent = new Map()
export const verificationIpAttempts = new Map()
// 分享提取码查取
export const shareLookupAttempts = new Map()
export const resourceCreateAttempts = new Map()
// 企业专属入口入团申请：按来源 IP 与申请账号。
export const joinRequestAttempts = new Map()

// ── 缓存 ─────────────────────────────────────────────────────
// 远端套餐实价缓存：升级弹窗展示与订单计价必须同源（价格以主站支付套餐为准）
export const remotePricingCache = { at: 0, data: null }
