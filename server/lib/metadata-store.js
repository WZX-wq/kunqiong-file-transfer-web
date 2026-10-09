// 元数据存储层 —— 载入 / 合并 / CAS 落盘
//
// 分层位置：config ← state ← metadata-store ← 领域模块 ← metadata-normalizers ← 入口
//
// ⚠️ 本模块**不做领域规范化**。
// normalizeMetadata 依赖 11 个领域 normalizer（账号/记录/消息/通知/验证码/审计/组织/
// 支付/游客/系统配置），若在本模块直接 import 它们，会形成
//     metadata-store → 领域模块 → metadata-store（领域模块需要 persist）
// 的循环依赖 —— ESM 下成环不抛错，表现为运行期 undefined，极难排查。
// 因此规范化函数由入口在启动时通过 installNormalizer 注入。

import fs from 'node:fs'
import crypto from 'node:crypto'
import {
  metadataPath, MAX_METADATA_WRITE_ATTEMPTS, DEFAULT_SYSTEM_CONFIG,
  databaseHost, databaseName, databaseUser,
} from '../config.js'
import { databasePool, runtime } from '../state.js'

// ── 元数据快照本体 ────────────────────────────────────────────
// 全进程唯一实例。**只在启动时就地填充一次，之后只做属性级修改，绝不整体替换** ——
// 路由与定时器持有的是同一个引用，替换对象会让它们继续写到废弃的快照上。
// （applyMergedMetadata 的注释里也写了这条不变量。）
export const metadata = {}

// 由入口注入的领域规范化函数。注入前保持恒等，保证本模块可独立加载与测试。
let normalizeSnapshot = (value) => value

export function installNormalizer(fn) {
  if (typeof fn !== 'function') throw new TypeError('installNormalizer 需要一个函数')
  normalizeSnapshot = fn
}

// 启动时把载入并规范化好的快照就地填入 metadata
export function initMetadata(next) {
  applyMergedMetadata(next)
}

// ── 常量 ─────────────────────────────────────────────────────
const METADATA_MERGE_RULES = [
  { key: 'shares', kind: 'array', time: ['updatedAt', 'createdAt'] },
  { key: 'collections', kind: 'array', time: ['updatedAt', 'createdAt'] },
  { key: 'sessions', kind: 'array', time: ['createdAt'] },
  { key: 'upgradeOrders', kind: 'array', time: ['updatedAt', 'createdAt'] },
  { key: 'auditLogs', kind: 'array', time: ['createdAt'] },
  { key: 'organizations', kind: 'array', time: ['updatedAt', 'createdAt'] },
  { key: 'verificationCodes', kind: 'array', time: ['createdAt'] },
  { key: 'users', kind: 'map', time: ['updatedAt', 'createdAt'] },
  { key: 'records', kind: 'map', time: ['updatedAt', 'createdAt'] },
  { key: 'messages', kind: 'map', time: ['updatedAt', 'createdAt'] },
  { key: 'notificationSettings', kind: 'map', time: [] },
  { key: 'guestUsage', kind: 'map', time: ['lastAt'] },
]
const metadataRevisionPath = `${metadataPath}.revision`
const instanceTag = crypto.randomUUID().slice(0, 8)

// ── 元数据载入 ───────────────────────────────────────────────
export function emptyMetadata() {
  return {
    shares: [],
    collections: [],
    sessions: [],
    records: {},
    users: {},
    messages: {},
    notificationSettings: {},
    verificationCodes: [],
    auditLogs: [],
    organizations: [],
    upgradeOrders: [],
    systemConfig: DEFAULT_SYSTEM_CONFIG,
  }
}

export function readMetadataFileFrom(targetPath) {
  const raw = fs.readFileSync(targetPath, 'utf8')
  if (!raw.trim()) throw new Error('元数据文件为空')
  return JSON.parse(raw)
}

export function loadLocalMetadata() {
  // 原子写已保证正常路径下不会读到半截文件；这里额外做一次损坏回退：
  // 万一主机异常（断电等）留下坏文件，可用上次覆盖前的备份还原，避免静默清空全部数据。
  try {
    return readMetadataFileFrom(metadataPath)
  } catch (error) {
    try {
      const recovered = readMetadataFileFrom(`${metadataPath}.bak`)
      console.warn(`元数据文件损坏（${error.message || error}），已从备份还原`)
      return recovered
    } catch {
      return emptyMetadata()
    }
  }
}

export function readLocalMetadataRevision() {
  try {
    const value = Math.floor(Number(fs.readFileSync(metadataRevisionPath, 'utf8').trim()))
    return Number.isFinite(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

export async function loadMetadata() {
  const localMetadata = loadLocalMetadata()
  runtime.metadataLocalRevision = readLocalMetadataRevision()
  if (!databasePool) return localMetadata
  if (!databaseHost || !databaseName || !databaseUser) {
    throw new Error('数据库模式已开启，但数据库连接参数不完整')
  }
  await ensureDatabaseStateTable()
  const remote = await readRemoteMetadataRow()
  if (remote) {
    runtime.metadataRevision = remote.revision
    return remote.metadata
  }
  const normalized = normalizeSnapshot(localMetadata)
  const [result] = await databasePool.execute(
    `INSERT INTO kunqiong_app_state (state_key, schema_version, revision, payload)
     VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE state_key = state_key`,
    ['metadata', 1, 1, JSON.stringify(normalized)],
  )
  // affectedRows 为 1 表示本实例建了行；为 0 表示另一个实例抢先建了行，按正常路径重读。
  if (Number(result.affectedRows) === 1) {
    runtime.metadataRevision = 1
    console.log('已将本地 metadata.json 迁移到 MySQL')
    return normalized
  }
  const winner = await readRemoteMetadataRow()
  if (!winner) throw new Error('元数据状态行创建失败，已停止启动以避免覆盖数据')
  runtime.metadataRevision = winner.revision
  return winner.metadata
}

export async function readRemoteMetadataRow() {
  const [rows] = await databasePool.query('SELECT revision, payload FROM kunqiong_app_state WHERE state_key = ? LIMIT 1', ['metadata'])
  if (!rows.length) return null
  try {
    return { revision: Number(rows[0].revision) || 0, metadata: JSON.parse(rows[0].payload) }
  } catch {
    throw new Error('数据库中的鲲穹元数据不是有效 JSON，已停止启动以避免覆盖数据')
  }
}

export async function ensureDatabaseStateTable() {
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS kunqiong_app_state (
      state_key VARCHAR(64) NOT NULL PRIMARY KEY,
      schema_version INT NOT NULL DEFAULT 1,
      revision BIGINT NOT NULL DEFAULT 0,
      payload LONGTEXT NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
  // 老部署的库是上一版建表语句建的，没有 revision 列，这里补列并保留已有数据。
  const [columns] = await databasePool.query(
    `SELECT COUNT(*) AS total FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kunqiong_app_state' AND COLUMN_NAME = 'revision'`,
  )
  if (!Number(columns?.[0]?.total)) {
    await databasePool.query('ALTER TABLE kunqiong_app_state ADD COLUMN revision BIGINT NOT NULL DEFAULT 0')
    console.log('kunqiong_app_state 已补充 revision 列')
  }
}

// ── 快照合并（多实例并发写）────────────────────────────────────────────
// 全量 JSON 快照做不了字段级事务，合并策略如下：
//   1. 按 id / 键求并集：并发时绝不因为覆盖而丢掉任一方新增的记录（这正是原本的静默丢数据故障）；
//   2. 同一条记录两边都有时，按 updatedAt / createdAt 取较新的一份；
//   3. 仅当远端版本恰好领先本进程基线 1 个版本时，两端基线相同，才能可靠识别「删除」并让其生效
//      （例如登出后会话不再被别的实例用旧快照复活）。版本差距更大时基线不可比，
//      退回纯并集语义——宁可短暂复活一条记录，也不丢新数据。
// 注意：这不是水平扩容的替代方案。多实例部署仍应尽快拆表或改为单写者。

// ── 快照合并（多实例并发写）──────────────────────────────────
export function metadataIdSets(value = {}) {
  const sets = {}
  for (const rule of METADATA_MERGE_RULES) {
    const collection = value?.[rule.key]
    if (rule.kind === 'array') {
      sets[rule.key] = new Set((Array.isArray(collection) ? collection : []).map((item) => (item?.id ? String(item.id) : '')).filter(Boolean))
    } else {
      sets[rule.key] = new Set(collection && typeof collection === 'object' && !Array.isArray(collection) ? Object.keys(collection) : [])
    }
  }
  return sets
}

export function metadataRecordTime(record, timeKeys = []) {
  if (!record || typeof record !== 'object') return 0
  for (const key of timeKeys) {
    const value = new Date(record[key]).getTime()
    if (Number.isFinite(value)) return value
  }
  return 0
}

export function mergeMetadataRecord(remote, local, timeKeys) {
  // 时间戳相等时取本地：本地代表本进程最近一次意图。
  return metadataRecordTime(local, timeKeys) >= metadataRecordTime(remote, timeKeys) ? local : remote
}

export function isIdentifiedList(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => item && typeof item === 'object' && item.id)
}

export function mergeMetadataLists(remoteList, localList, timeKeys, baseKeys) {
  const remotes = new Map()
  for (const item of Array.isArray(remoteList) ? remoteList : []) if (item?.id) remotes.set(String(item.id), item)
  const locals = new Map()
  for (const item of Array.isArray(localList) ? localList : []) if (item?.id) locals.set(String(item.id), item)
  const merged = new Map()
  for (const [id, item] of remotes) {
    if (locals.has(id)) {
      merged.set(id, mergeMetadataRecord(item, locals.get(id), timeKeys))
      continue
    }
    // 远端独有：基线里没有 = 对方新增，保留；基线里有 = 本进程已删除，删除生效。
    if (!baseKeys || !baseKeys.has(id)) merged.set(id, item)
  }
  for (const [id, item] of locals) {
    if (remotes.has(id)) continue
    // 本地独有：基线里没有 = 本进程新增，保留；基线里有 = 对方已删除，删除生效。
    if (!baseKeys || !baseKeys.has(id)) merged.set(id, item)
  }
  return [...merged.values()]
}

export function mergeMetadataMaps(remoteMap, localMap, timeKeys, baseKeys) {
  const remotes = remoteMap && typeof remoteMap === 'object' && !Array.isArray(remoteMap) ? remoteMap : {}
  const locals = localMap && typeof localMap === 'object' && !Array.isArray(localMap) ? localMap : {}
  const merged = {}
  for (const [key, value] of Object.entries(remotes)) {
    if (Object.prototype.hasOwnProperty.call(locals, key)) {
      merged[key] = mergeMetadataEntry(value, locals[key], timeKeys)
      continue
    }
    if (!baseKeys || !baseKeys.has(key)) merged[key] = value
  }
  for (const [key, value] of Object.entries(locals)) {
    if (Object.prototype.hasOwnProperty.call(remotes, key)) continue
    if (!baseKeys || !baseKeys.has(key)) merged[key] = value
  }
  return merged
}

export function mergeMetadataEntry(remoteValue, localValue, timeKeys) {
  // 每用户的消息/文件记录是「键 → 带 id 的列表」，需要下探一层按 id 合并，否则会整段丢掉一边。
  // 这一层不做删除识别：基线只记录顶层键，下探时按并集处理。
  if (isIdentifiedList(remoteValue) && isIdentifiedList(localValue)) {
    return mergeMetadataLists(remoteValue, localValue, timeKeys, null)
  }
  return mergeMetadataRecord(remoteValue, localValue, timeKeys)
}

export function mergeMetadataSnapshots(remoteValue, localValue, baseIds) {
  const remote = remoteValue && typeof remoteValue === 'object' && !Array.isArray(remoteValue) ? remoteValue : {}
  const local = localValue && typeof localValue === 'object' && !Array.isArray(localValue) ? localValue : {}
  // 标量配置与未知字段无法判断新旧，默认取本地（本进程最近一次改动的意图）。
  const merged = { ...remote, ...local }
  for (const rule of METADATA_MERGE_RULES) {
    const baseKeys = baseIds ? baseIds[rule.key] : null
    merged[rule.key] = rule.kind === 'array'
      ? mergeMetadataLists(remote[rule.key], local[rule.key], rule.time, baseKeys)
      : mergeMetadataMaps(remote[rule.key], local[rule.key], rule.time, baseKeys)
  }
  return normalizeSnapshot(merged)
}

export function applyMergedMetadata(next) {
  // 就地更新：路由与定时器持有的是同一个 metadata 引用，替换对象会让它们写到废弃的快照上。
  for (const key of Object.keys(metadata)) if (!(key in next)) delete metadata[key]
  Object.assign(metadata, next)
}

export function rememberMetadataBaseIds() {
  const sets = metadataIdSets(metadata)
  runtime.metadataBaseIds = sets
  runtime.metadataLocalBaseIds = sets
}

// ── 持久化 ───────────────────────────────────────────────────
export function persistMetadata() {
  persistLocalMetadata()
  if (!databasePool) return
  runtime.metadataWriteQueue = runtime.metadataWriteQueue
    .catch(() => {})
    .then(() => writeMetadataToDatabase())
    .catch((error) => {
      console.error(`MySQL 元数据保存失败：${error.message || error}`)
    })
}

export function withLocalMetadataLock(task) {
  // 本地模式没有数据库那样的原子 CAS，用「独占创建锁文件」把多进程写入串行化。
  // 拿不到锁（异常退出残留锁文件等）时直接执行：退化成「读最新内容再合并写」，
  // 最坏情况仍是合并而非覆盖，不会把服务卡死。
  const lockPath = `${metadataPath}.lock`
  const deadline = Date.now() + 2000
  let handle = null
  while (Date.now() < deadline) {
    try {
      handle = fs.openSync(lockPath, 'wx')
      break
    } catch {
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > 10000) fs.rmSync(lockPath, { force: true })
      } catch {}
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5)
    }
  }
  try {
    task()
  } finally {
    if (handle !== null) {
      try { fs.closeSync(handle) } catch {}
      try { fs.rmSync(lockPath, { force: true }) } catch {}
    }
  }
}

export function persistLocalMetadata() {
  // 临时文件名带上实例标识：多进程共用一份 storage 时，固定名字的 .tmp 会被
  // 另一个进程 rename 走，导致本进程 rename 报 ENOENT 并静默丢掉这次写入。
  const tempPath = `${metadataPath}.${instanceTag}.tmp`
  try {
    if (databasePool) {
      // 数据库模式：metadata.json 只是镜像，直接整体重写即可。
      if (fs.existsSync(metadataPath)) {
        const backupTempPath = `${metadataPath}.${instanceTag}.bak.tmp`
        fs.copyFileSync(metadataPath, backupTempPath)
        fs.renameSync(backupTempPath, `${metadataPath}.bak`)
      }
      fs.writeFileSync(tempPath, JSON.stringify(metadata, null, 2), 'utf8')
      fs.renameSync(tempPath, metadataPath)
      return
    }
    withLocalMetadataLock(() => {
      // 本地模式：文件是唯一真源。磁盘版本领先说明另一个进程（同机多实例、
      // 开发与生产共用 storage）改过，先合并再写，不要拿本进程的旧快照直接覆盖。
      const diskRevision = readLocalMetadataRevision()
      if (diskRevision > runtime.metadataLocalRevision) {
        applyMergedMetadata(mergeMetadataSnapshots(loadLocalMetadata(), metadata, diskRevision === runtime.metadataLocalRevision + 1 ? runtime.metadataLocalBaseIds : null))
        runtime.metadataLocalRevision = diskRevision
        runtime.metadataConflictCount += 1
        console.warn(`[metadata-cas] 实例 ${instanceTag} 检测到本地快照被其他进程更新，已合并后重写`)
      }
      // 原子落盘：先写临时文件再 rename。直接 writeFileSync 会先截断目标文件，
      // 并发读（含服务重启、其他进程）可能读到「已截断但未写完」的半截 JSON。
      // 覆盖前留一份 .bak，走同样的 tmp + rename，保证备份本身也是完整快照。
      if (fs.existsSync(metadataPath)) {
        const backupTempPath = `${metadataPath}.${instanceTag}.bak.tmp`
        fs.copyFileSync(metadataPath, backupTempPath)
        fs.renameSync(backupTempPath, `${metadataPath}.bak`)
      }
      fs.writeFileSync(tempPath, JSON.stringify(metadata, null, 2), 'utf8')
      fs.renameSync(tempPath, metadataPath)
      const revisionTempPath = `${metadataRevisionPath}.${instanceTag}.tmp`
      fs.writeFileSync(revisionTempPath, String(runtime.metadataLocalRevision + 1), 'utf8')
      fs.renameSync(revisionTempPath, metadataRevisionPath)
      runtime.metadataLocalRevision += 1
      runtime.metadataLocalBaseIds = metadataIdSets(metadata)
    })
  } catch (error) {
    console.error(`本地元数据保存失败：${error.message || error}`)
    try {
      if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true })
    } catch {}
  }
}

export async function writeMetadataToDatabase() {
  for (let attempt = 0; attempt < MAX_METADATA_WRITE_ATTEMPTS; attempt++) {
    const expected = runtime.metadataRevision
    const [result] = await databasePool.execute(
      'UPDATE kunqiong_app_state SET revision = revision + 1, payload = ? WHERE state_key = ? AND revision = ?',
      [JSON.stringify(metadata), 'metadata', expected],
    )
    if (Number(result.affectedRows) > 0) {
      runtime.metadataRevision = expected + 1
      runtime.metadataBaseIds = metadataIdSets(metadata)
      return
    }
    const remote = await readRemoteMetadataRow()
    if (!remote) {
      // 状态行被清掉了（手工删库/换库）：按迁移路径重新建行，不动远端数据。
      await databasePool.execute(
        `INSERT INTO kunqiong_app_state (state_key, schema_version, revision, payload)
         VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE state_key = state_key`,
        ['metadata', 1, expected + 1, JSON.stringify(metadata)],
      )
      runtime.metadataRevision = expected + 1
      runtime.metadataBaseIds = metadataIdSets(metadata)
      return
    }
    if (remote.revision === expected) continue
    // CAS 失败：另一个实例先写了。重读远端，合并本进程的改动后重试。
    // 远端恰好领先 1 个版本时两端基线相同，可以可靠识别删除；否则退回并集语义。
    const exactBase = remote.revision === expected + 1
    applyMergedMetadata(mergeMetadataSnapshots(remote.metadata, metadata, exactBase ? runtime.metadataBaseIds : null))
    runtime.metadataRevision = remote.revision
    runtime.metadataConflictCount += 1
    console.warn(`[metadata-cas] 实例 ${instanceTag} 写入冲突，已合并重试（本地 rev ${expected}，远端 rev ${remote.revision}${exactBase ? '，删除可识别' : '，基线不可比按并集处理'}）`)
  }
  throw new Error(`元数据写入连续 ${MAX_METADATA_WRITE_ATTEMPTS} 次与其他实例冲突`)
}
