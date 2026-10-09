// 运行期共享状态容器
//
// 这里的 Map/Set 与缓存由路由、定时器和业务模块共同持有，**必须是同一实例** ——
// 例如限流计数、上传会话、管理后台会话、OAuth state，
// 各自持有一份副本会静默失效（限流不生效、会话查不到）。
//
// 拆分 server.mjs 时先把它们集中到本模块，后续各业务模块按需 import，
// 避免“搬走一个函数就得连带搬走它引用的状态”。

import mysql from 'mysql2/promise'
import {
  databaseEnabled, databaseHost, databasePort, databaseName, databaseUser, databasePassword,
} from './config.js'

// ── 数据库连接池 ─────────────────────────────────────────────
// 全进程唯一。databaseEnabled 为 false 时是 null，调用方需自行判空。
// 注意 mysql2 的 createPool 不会立即建连，首个查询才真正连接。
export const databasePool = databaseEnabled ? mysql.createPool({
  host: databaseHost,
  port: databasePort,
  database: databaseName,
  user: databaseUser,
  password: databasePassword,
  waitForConnections: true,
  connectionLimit: Number(process.env.KUNQIONG_DB_CONNECTION_LIMIT || 5),
  queueLimit: 0,
  charset: 'utf8mb4',
}) : null

// ── 元数据运行期标记 ─────────────────────────────────────────
// 为什么要包成对象：ESM 的导入绑定是只读的 —— `import { x }` 之后不能 `x = 1`，
// 而这些值在业务代码里被赋值（如 metadataNeedsPersist = true，共 40 余处）。
// 所以统一放进可变容器，引用处写 runtime.xxx。
export const runtime = {
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
}

// ── 分享 ─────────────────────────────────────────────────────
// 已分配的提取码，用于生成时避免碰撞
export const reservedShareCodes = new Set()

// ── 分片上传 ─────────────────────────────────────────────────
// sessionId → 会话状态；容量预留表用于在传输期间就占住配额
export const uploadSessions = new Map()
export const uploadReservations = new Map()

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

// ── 缓存 ─────────────────────────────────────────────────────
// 远端套餐实价缓存：升级弹窗展示与订单计价必须同源（价格以主站支付套餐为准）
export const remotePricingCache = { at: 0, data: null }
