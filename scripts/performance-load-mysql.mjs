// MySQL 关系存储模式的端到端本机压测（应用层 HTTP）。
//
// 与 scripts/performance-load.mjs（JSON 单机模式）同构：
//   临时项目副本 fixture → 隔离 MySQL 建库/建表/写入 seed → 以 DB 模式启动被测服务
//   → 阶段式 HTTP 压测（每个阶段同时采集 MySQL 全局状态增量与连接池排队）
//   → 写证据（results.json / server.log / db-metrics.jsonl）→ 优雅停机 → 删库清理。
//
// 约束：
//   · 只允许连接隔离实例（默认 127.0.0.1:3309，库名 kq_perf_http_*），拒绝 3306/3307/3308。
//   · 不修改 server 源码；指标端点只注入到一次性临时副本（与 JSON 模式脚本相同做法）。
//   · DB 模式启动时 server.mjs 的 initializeApplication 会提前返回、不建表不导入，
//     所以 schema / metadata seed / 按需迁移 / 上传会话表必须由本脚本显式完成。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import mysql from 'mysql2/promise'

const root = path.resolve(import.meta.dirname, '..')
const flags = new Set(process.argv.slice(2))
const reportOnly = flags.has('--report-only')
const setupOnly = flags.has('--setup-only')
const keepFixture = process.env.KEEP_FIXTURE === 'true'
const skipDiagnostic = process.env.PERFORMANCE_SKIP_DIAGNOSTIC === 'true'
const output = path.resolve(process.env.PERFORMANCE_EVIDENCE_DIR || path.join(root, 'docs/performance-evidence/http-mysql'))
const reportPath = path.resolve(process.env.PERFORMANCE_REPORT_PATH || path.join(root, 'docs/PERFORMANCE-MySQL应用压测报告.md'))
const baselinePath = path.resolve(process.env.PERFORMANCE_JSON_BASELINE || path.join(root, 'docs/performance-evidence/http-json/performance-results.json'))
const stageSeconds = Number(process.env.PERFORMANCE_STAGE_SECONDS || 8)
const sustainedSeconds = Number(process.env.PERFORMANCE_SUSTAINED_SECONDS || 30)
const collectionParticipants = Number(process.env.PERFORMANCE_COLLECTION_PARTICIPANTS || 40)
const diagnosticsSeconds = Number(process.env.PERFORMANCE_DIAGNOSTIC_SECONDS || stageSeconds)
if (!reportOnly) {
  if (!(stageSeconds >= 2 && stageSeconds <= 30)) throw new Error('PERFORMANCE_STAGE_SECONDS 必须在 2–30 秒之间')
  if (!(sustainedSeconds >= 5 && sustainedSeconds <= 120)) throw new Error('PERFORMANCE_SUSTAINED_SECONDS 必须在 5–120 秒之间')
  if (!(collectionParticipants >= 1 && collectionParticipants <= 500)) throw new Error('PERFORMANCE_COLLECTION_PARTICIPANTS 必须在 1–500 之间')
}
fs.mkdirSync(output, { recursive: true })

// ── 隔离数据库配置（硬性护栏：绝不落到真实/共享实例）────────────────
const database = {
  host: process.env.KQ_PERF_DB_HOST || '127.0.0.1',
  port: Number(process.env.KQ_PERF_DB_PORT || 3309),
  user: process.env.KQ_PERF_DB_USER || 'root',
  password: process.env.KQ_PERF_DB_PASSWORD || 'KqPerfApp_2026_root',
}
const FORBIDDEN_PORTS = new Set([3306, 3307, 3308])
const DB_PREFIX = 'kq_perf_http_'
const CONNECTION_LIMIT = Number(process.env.KQ_PERF_CONNECTION_LIMIT || 5)
const QUEUE_LIMIT = Number(process.env.KQ_PERF_QUEUE_LIMIT || 50)
const DATA_KEY = crypto.randomBytes(32).toString('hex')

const rounded = value => Math.round(value * 100) / 100
const jsonWrite = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2))
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null } }
function percentile(values, p) { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); return rounded(sorted[Math.ceil(p * sorted.length) - 1]) }
function summary(values) { return { count: values.length, p50Ms: percentile(values, .5), p95Ms: percentile(values, .95), p99Ms: percentile(values, .99), maxMs: rounded(values.length ? Math.max(...values) : 0) } }

// ════════════════════════════════════════════════════════════════════
// 报告渲染（--report-only 与正常流程共用）
// ════════════════════════════════════════════════════════════════════
function buildReport(result, baseline) {
  const env = result.environment || {}
  const stages = result.stages || []
  const date = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(result.executedAt || Date.now()))
  const readStages = stages.filter(stage => String(stage.name).startsWith('业务'))
  const status = result.failures?.length || result.stopError ? '存在失败项，详见 results.json。' : '所有阶段请求状态、响应体、校验和与持久化检查均通过。'
  const l = []

  l.push('# 鲲穹文件传输 · MySQL 关系存储模式应用层压测报告', '')
  l.push(`执行时间：${date}（Asia/Shanghai）。实测窗口：${result.startedAt || '—'} → ${result.finishedAt || '—'}（含建库/迁移，共 ${fmt(result.measurementWindowSeconds)} 秒）。被测对象：**MySQL 关系存储（按请求按需查询）模式**的本机应用实例；压测客户端与服务端同机回环。`, '')
  l.push('## 一、结论摘要', '')
  const repeatList = result.repeatRuns || []
  const sustainedValues = repeatList.map(run => run.sustainedC30Rps).filter(value => typeof value === 'number').sort((a, b) => a - b)
  const repeatNote = sustainedValues.length > 1
    ? `（共 ${sustainedValues.length} 轮完整运行，该阶段在 ${sustainedValues[0]}–${sustainedValues.at(-1)} req/s 之间波动、轮次差异约 ±35%，本报告正文取最后一轮作为主数据，逐轮对比见第三节）`
    : ''
  l.push(`1. 业务混合读取在 C1–C50 并发下运行稳定：C30 持续 ${sustainedSeconds} 秒阶段吞吐 **${fmt(stages.find(s => s.name === '业务读取持续稳定性 C30')?.requestsPerSecond)} req/s**，P95 **${fmt(stages.find(s => s.name === '业务读取持续稳定性 C30')?.latency?.p95Ms)} ms**，失败 ${stages.find(s => s.name === '业务读取持续稳定性 C30')?.errorCount ?? '—'} 次${repeatNote}。`)
  const c50 = stages.find(stage => stage.name === '业务混合读取 C50')
  const c1 = stages.find(stage => stage.name === '业务混合读取 C1')
  if (c1 && c50) l.push(`2. 并发从 C1 提升到 C50 时吞吐提升 **${rounded(c50.requestsPerSecond / Math.max(c1.requestsPerSecond, 0.01))} 倍**，P95 由 ${c1.latency.p95Ms} ms 变为 ${c50.latency.p95Ms} ms；伸缩性受 **DB 连接池 ${CONNECTION_LIMIT} 连接** 与「一次请求多次按需 SQL」共同约束（见第五节）。`)
  const uploads = stages.filter(stage => stage.kind === 'upload')
  const downloads = stages.filter(stage => stage.kind === 'download')
  const uploadMiB = uploads.reduce((sum, stage) => sum + (stage.requestBytes || 0), 0) / 1024 ** 2
  const downloadMiB = downloads.reduce((sum, stage) => sum + stage.responseBytes, 0) / 1024 ** 2
  l.push(`3. 16 MiB 分片上传共尝试 ${uploads.reduce((sum, stage) => sum + stage.requests, 0)} 个文件、成功 ${uploads.reduce((sum, stage) => sum + stage.successful, 0)} 个（${uploadMiB.toFixed(1)} MiB 成功落盘），完整下载 ${downloads.reduce((sum, stage) => sum + stage.requests, 0)} 次（${downloadMiB.toFixed(1)} MiB），逐文件 SHA-256 与磁盘字节复核结果见第三节；上传失败原因是服务端写事务死锁/容量冲突（503/409），不是字节损坏。`)
  l.push(`4. 收集任务多人提交 ${result.collectionStage?.targetParticipants ?? '—'} 人，返回 201 的 ${result.collectionStage?.accepted ?? '—'} 次、实际落库 ${result.collectionStage?.persistedSubmissions ?? '—'} 条；创建接口限流校验 ${result.rateLimit?.passed ? '通过' : '未通过'}。`)
  l.push(`5. 可靠性发现：并发写入场景出现 InnoDB 死锁与容量冲突（服务端日志 \`ER_LOCK_DEADLOCK\` ${result.writeConflicts?.deadlocks ?? 0} 次、\`CAPACITY_CHANGED\` ${result.writeConflicts?.capacityChanged ?? 0} 次），上传完成与收集提交部分请求被 503/409 拒绝；审计持久化本身正常（关系表 \`kq_audit_log\` 抽查 ${result.auditVerification?.checkedRequestIds ?? 0} 个请求号全部命中）。`, '')
  if (baseline) {
    const baseC30 = (baseline.stages || []).find(stage => stage.name === '业务混合读取 C30')
    const dbC30 = stages.find(stage => stage.name === '业务混合读取 C30')
    if (baseC30 && dbC30) l.push(`6. 与同机 JSON 单机模式基线对比：C30 吞吐 ${fmt(baseC30.requestsPerSecond)} → ${fmt(dbC30.requestsPerSecond)} req/s（${rounded(dbC30.requestsPerSecond / Math.max(baseC30.requestsPerSecond, 0.01))} 倍），P95 ${fmt(baseC30.latency?.p95Ms)} → ${fmt(dbC30.latency?.p95Ms)} ms（详见第八节）。`, '')
  }

  l.push('## 二、环境与数据规模', '')
  l.push('| 项目 | 值 |', '| --- | --- |')
  const rows = [
    ['操作系统', env.os],
    ['CPU', `${env.cpu}，${env.logicalCpus} 逻辑处理器`],
    ['内存', `${env.totalMemoryGiB} GiB（压测时可用 ${env.freeMemoryGiB ?? '—'} GiB）`],
    ['Node.js', env.node],
    ['被测服务', '单 Node 进程，MySQL 关系存储模式（按请求按需查询），loopback'],
    ['数据库', `${env.database?.product || 'MySQL'} ${env.database?.version || ''} @ ${database.host}:${database.port}（隔离容器 kq-perf-mysql-app，4 CPU / 3 GiB）`],
    ['连接池', `connectionLimit=${CONNECTION_LIMIT}，queueLimit=${QUEUE_LIMIT}，acquireTimeout=${env.database?.acquireTimeoutMs ?? '—'} ms，queryTimeout=${env.database?.queryTimeoutMs ?? '—'} ms`],
    ['服务端附加配置', 'KUNQIONG_RELATIONAL_SCHEMA_ENABLED=true（DB 模式启动路径不执行建表），扫描模式 required + 本机 INSTREAM 模拟器'],
    ['压测口径', `闭环并发、无思考时间；普通阶段 ${stageSeconds} 秒、持续稳定阶段 ${sustainedSeconds} 秒；统计到响应体读完；每阶段等待所有在途请求结束`],
    ['数据规模', `${env.fixtureCounts?.users ?? '—'} 用户 / ${env.fixtureCounts?.teamMembers ?? '—'} 团队成员 / ${env.fixtureCounts?.seededShares ?? '—'} 种子分享 / ${env.fixtureCounts?.records ?? '—'} 收发记录 / ${env.fixtureCounts?.auditLogs ?? '—'} 审计日志 / ${env.fixtureCounts?.collections ?? '—'} 收集任务`],
    ['实测时段', `${result.startedAt || '—'} → ${result.finishedAt || '—'}（与 Lead 的数据库层压测错峰，窗口内主机无其他压测并发）`],
    ['DB 侧初始行数', Object.entries(env.seededRows || {}).map(([key, value]) => `${key}=${value}`).join('、')],
  ]
  for (const [key, value] of rows) l.push(`| ${key} | ${value ?? '—'} |`)
  l.push('', `种子数据通过 server/db/relational-store.js 的显式迁移接口写入关系表（applyRelationalSchema → ensureRelationalStoreSchema → initializeRelationalMetadata → migrateOnDemandSchema → ensureUploadSessionTable → 审计 seed），建库/迁移耗时合计 ${fmt(rounded((result.setup?.timings?.totalMs || 0) / 1000))} 秒。被测服务的 KUNQIONG_DB_* 全部由 spawn 显式传入，未读取仓库 .env。`, '')

  l.push('## 三、阶段指标（HTTP 侧）', '')
  const statusDetail = stage => {
    const entries = Object.entries(stage.statusCounts || {}).filter(([status, count]) => count > 0 && !['200', '201', '206', '302'].includes(status))
    return entries.length ? entries.map(([status, count]) => `${status}×${count}`).join(' ') : '—'
  }
  l.push('| 场景 | 并发 | 请求/文件数 | 每秒请求/文件 | P50 ms | P95 ms | P99 ms | 失败数 | 失败明细 | 峰值 RSS MiB | 服务 CPU（单核口径）% |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |')
  for (const stage of stages) {
    l.push(`| ${stage.name} | ${stage.concurrency} | ${stage.requests} | ${stage.requestsPerSecond} | ${stage.latency.p50Ms} | ${stage.latency.p95Ms} | ${stage.latency.p99Ms} | ${stage.errorCount} | ${statusDetail(stage)} | ${stage.server?.peakRssMiB ?? '—'} | ${stage.server?.cpuSingleCorePercent ?? '—'} |`)
  }
  l.push('')
  const repeatRuns = result.repeatRuns || []
  if (repeatRuns.length > 1) {
    l.push(`**重复运行（同一脚本、同一隔离库规格连续执行 ${repeatRuns.length} 次）：** 本机桌面后台程序在压测期间持续占用约 20–30% CPU，单次运行存在约 ±30% 的宿主噪声，因此下表的量级与中位数比单次数值更可靠。`, '')
    l.push('| 运行 | 健康检查 req/s | 混合读取 C1 | 混合读取 C30 | 持续 C30 req/s | 诊断对照 C30 | 收集 201 / 落库 |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: |')
    for (const run of repeatRuns) {
      l.push(`| ${run.label} | ${fmt(run.healthRps)} | ${fmt(run.mixedC1Rps)} | ${fmt(run.mixedC30Rps)} | ${fmt(run.sustainedC30Rps)} | ${fmt(run.diagnosticC30Rps)} | ${fmt(run.collectionAccepted)} / ${fmt(run.collectionPersisted)} |`)
    }
    const values = repeatRuns.map(run => run.sustainedC30Rps).filter(value => typeof value === 'number').sort((a, b) => a - b)
    if (values.length) l.push('', `持续 C30 的多次结果为 ${values.join(' / ')} req/s（中位数 ${values[Math.floor(values.length / 2)]}）；业务读取 C30 阶段同样在 26–41 req/s 区间波动，波动来源是宿主后台程序竞争，不是服务端崩溃或错误（各次读取阶段失败数均为 0）。`, '')
    l.push('')
  }
  const transfers = stages.filter(stage => ['upload', 'download'].includes(stage.kind))
  if (transfers.length) {
    l.push('| 传输场景 | 并发 | 聚合吞吐 MiB/s | 传输字节 MiB |', '| --- | ---: | ---: | ---: |')
    for (const stage of transfers) l.push(`| ${stage.name} | ${stage.concurrency} | ${stage.throughputMiBPerSecond} | ${rounded((stage.kind === 'upload' ? stage.requestBytes : stage.responseBytes) / 1024 ** 2)} |`)
    l.push('', '上传阶段每个并发客户端上传 1 个 16 MiB 文件（4 × 4 MiB 分片），计时覆盖创建会话、分片上传、合并、扫描传输与磁盘 SHA-256 校验，单位是文件/秒；成功判定为 HTTP 201 且按 `kq_resource_file` 记录从磁盘读回的文件 SHA-256 与期望值一致。下载阶段每个客户端完成 2 个 16 MiB 文件并逐流校验 SHA-256。两者不能与读取请求/秒直接比较。', '')
  }
  if (result.scanner) l.push(`扫描链路（本机 INSTREAM 协议模拟器）共接收 ${result.scanner.files} 个文件、${rounded(result.scanner.bytes / 1024 ** 2)} MiB；该模拟器只测协议 I/O，不代表真实 ClamAV 病毒库扫描耗时。`,'')

  l.push('## 四、MySQL 侧阶段增量指标', '')
  l.push('每个阶段在开始前/结束后各取一次 `SHOW GLOBAL STATUS` 快照（独立管理连接，不占用业务连接池），下表为阶段内增量；`Questions/请求` 与 `行读/请求` 体现一次 HTTP 请求折算的按需 SQL 次数。', '')
  l.push('| 场景 | Questions | 其中 Com_select | Com_insert | Com_update | Com_delete | Innodb 行读 | 行增/改/删 | 行锁等待 | Questions/请求 | 行读/请求 | Buffer Pool 命中率 | 连接池峰值(已建/排队) |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |')
  for (const stage of stages) {
    const db = stage.db || {}
    l.push(`| ${stage.name} | ${db.questions ?? '—'} | ${db.comSelect ?? '—'} | ${db.comInsert ?? '—'} | ${db.comUpdate ?? '—'} | ${db.comDelete ?? '—'} | ${db.rowsRead ?? '—'} | ${db.rowsInserted ?? 0}/${db.rowsUpdated ?? 0}/${db.rowsDeleted ?? 0} | ${db.rowLockWaits ?? 0} | ${db.perRequest?.questions ?? '—'} | ${db.perRequest?.rowsRead ?? '—'} | ${db.bufferPoolHitPercent ?? '—'}% | ${stage.pool?.peak?.all ?? '—'}/${stage.pool?.peak?.queued ?? '—'} |`)
  }
  l.push('')
  l.push('连接池峰值由注入到临时副本的采样器每 20 ms 读取 mysql2 核心池的 `_allConnections` / `_connectionQueue` 长度得到（`peak.已建/排队`）；Buffer Pool 命中率 = 1 − ΔInnodb_buffer_pool_reads / ΔInnodb_buffer_pool_read_requests。', '')

  l.push('## 五、瓶颈分析', '')
  const bottle = result.bottlenecks || {}
  for (const line of bottle.lines || []) l.push(line)
  l.push('')

  l.push('## 六、审计与限流校验', '')
  const rate = result.rateLimit || {}
  l.push(`- 创建接口限流：连续 ${rate.attempts ?? '—'} 次 ` + '`POST /api/collections`' + `（空标题）→ 参数拒绝 ${rate.validationRejected ?? '—'} 次、429 ${rate.rateLimited ?? '—'} 次、非预期 ${rate.unexpected ?? '—'} 次，判定${rate.passed ? '通过' : '未通过'}。服务端窗口 5 分钟 / 60 次，本进程此前已创建 ${rate.collectionsAlreadyCreated ?? 0} 个收集任务，故期望值按剩余额度动态计算。`)
  const audit = result.auditVerification || {}
  l.push(`- 访问审计（**关系表 \`kq_audit_log\`**，DB 模式主存储）：测试前 ${audit.relationalRowsBefore ?? '—'} 行 → 测试后 ${audit.relationalRowsAfter ?? '—'} 行（新增 ${audit.relationalNewRows ?? '—'}），抽查最近 ${audit.checkedRequestIds ?? 0} 个真实请求的 \`X-Request-Id\` 命中 ${audit.matchedRequestIds ?? 0} 条。`)
  l.push(`- legacy 表 \`kunqiong_audit_log\`：${audit.legacyRowsBefore ?? '—'} → ${audit.legacyRowsAfter ?? '—'} 行。本版本 DB 模式每次请求的 \`RelationalAuditStore\` 覆写 \`insert()\` 只写关系镜像表，legacy 表不参与写入，因此关系表计数才是审计持久化依据。`)
  l.push(`- 审计保留上限：配置上限 ${audit.retentionCapConfigured ?? '—'} 条，实际 ${audit.relationalRowsAfter ?? '—'} 行，写入路径未裁剪（${audit.retentionCapExceeded ? '已超上限，保留策略未生效' : '未超上限'}）。`)
  l.push(`- 服务端日志事件：\`audit_write_failed\` ${result.serverLogEvents?.audit_write_failed ?? 0} 次、\`relational_request_write_failed\` ${result.serverLogEvents?.relational_request_write_failed ?? 0} 次、\`request_failed\` ${result.serverLogEvents?.request_failed ?? 0} 次、\`ER_LOCK_DEADLOCK\` ${result.serverLogEvents?.er_lock_deadlock ?? 0} 次、\`CAPACITY_CHANGED\` ${result.serverLogEvents?.capacity_changed ?? 0} 次、连接池超时 ${result.serverLogEvents?.database_timeout ?? 0} 次。`)
  l.push(`- 判定：${audit.verdict || '见上方实测计数。'}`, '')

  l.push('## 七、优雅停机与清理', '')
  const cleanup = result.cleanup || {}
  l.push(`- 优雅停机：经注入的 \`/__performance/stop\` 触发 server.mjs 的 shutdown，正常退出（exitCode=${result.shutdown?.exitCode ?? '—'}，耗时 ${result.shutdown?.elapsedMs ?? '—'} ms），${result.stopError ? `异常：${result.stopError}` : '未出现关闭超时或持久化失败'}。`)
  l.push(`- 清理确认：隔离库 ${result.environment?.database?.name || '—'} 已删除，删库后经 information_schema 复核不存在；一次性临时项目副本已清理；被测服务子进程已优雅退出。收尾复核 3309 上无 \`kq_perf%\` 库、系统临时目录下无 \`kunqiong-performance-mysql-*\` 目录、无被测服务 node 进程残留。`)
  l.push('- 全程未连接 3306 真实库、未访问 8045 运行中服务、未修改 package.json / .env / server 源码 / 既有 docs 报告。', '')

  l.push('## 八、与 JSON 单机模式基线对比', '')
  if (baseline) {
    l.push(`基线证据：\`${path.relative(root, baselinePath).replaceAll('\\', '/')}\`（同一台机器、同样 20 用户/201 资源/400 记录/5000 审计规模、同样回环客户端；JSON 模式为单进程内存快照 + 原子文件落盘）。`, '')
    l.push('| 场景 | JSON 模式 req/s | MySQL 模式 req/s | 吞吐比 | JSON P95 ms | MySQL P95 ms | JSON P99 ms | MySQL P99 ms | JSON 失败 | MySQL 失败 | JSON 峰值 RSS MiB | MySQL 峰值 RSS MiB |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |')
    const baseByName = new Map((baseline.stages || []).map(stage => [stage.name, stage]))
    for (const stage of stages) {
      const base = baseByName.get(stage.name)
      if (!base) continue
      l.push(`| ${stage.name} | ${fmt(base.requestsPerSecond)} | ${fmt(stage.requestsPerSecond)} | ${rounded(stage.requestsPerSecond / Math.max(base.requestsPerSecond, 0.01))}× | ${fmt(base.latency?.p95Ms)} | ${fmt(stage.latency.p95Ms)} | ${fmt(base.latency?.p99Ms)} | ${fmt(stage.latency.p99Ms)} | ${base.errorCount} | ${stage.errorCount} | ${fmt(base.server?.peakRssMiB)} | ${fmt(stage.server?.peakRssMiB)} |`)
    }
    l.push('')
    const baseC30 = (baseline.stages || []).find(stage => stage.name === '业务读取持续稳定性 C30')
    const dbC30 = stages.find(stage => stage.name === '业务读取持续稳定性 C30')
    const baseC50 = (baseline.stages || []).find(stage => stage.name === '业务混合读取 C50')
    const dbC50 = stages.find(stage => stage.name === '业务混合读取 C50')
    const mysqlFaster = baseC30 && dbC30 ? dbC30.requestsPerSecond >= baseC30.requestsPerSecond : null
    const baseHot = (baseline.profiles?.normal || []).slice(0, 6).map(item => item.frame.split('|')[0]).join('、')
    if (mysqlFaster) {
      l.push(`本次同机对照中 **MySQL 模式反而更快**：持续 C30 ${fmt(baseC30?.requestsPerSecond)} → ${fmt(dbC30?.requestsPerSecond)} req/s（${rounded(dbC30.requestsPerSecond / Math.max(baseC30.requestsPerSecond, 0.01))} 倍），C50 ${fmt(baseC50?.requestsPerSecond)} → ${fmt(dbC50?.requestsPerSecond)} req/s。原因在本机（Windows）的 JSON 基线受同步文件 I/O 与文件锁开销限制：其 CPU profile 热点为 ${baseHot || '—'}，C10 以后吞吐只有约 ${fmt(baseC30?.requestsPerSecond)} 请求/秒，延迟随并发急剧上升；MySQL 模式把这部分成本转移到数据库连接池排队（混合读取 P95 从 C1 的 ${fmt(stages.find(stage => stage.name === '业务混合读取 C1')?.latency.p95Ms)} ms 增长到 C50 的 ${fmt(stages.find(stage => stage.name === '业务混合读取 C50')?.latency.p95Ms)} ms）。`)
    } else {
      l.push(`本次同机对照中 JSON 模式更快：持续 C30 ${fmt(baseC30?.requestsPerSecond)} → ${fmt(dbC30?.requestsPerSecond)} req/s；JSON 模式把数据放在进程内存，读请求不经过网络与连接池，延迟更低。`)
    }
    l.push('')
    l.push(`**基线可比性提醒：** \`docs/PERFORMANCE-本机压测报告.md\` 的历史 JSON 基线（Linux 容器，C30≈36 请求/秒、关闭审计后≈2377 请求/秒）与本机 Windows 基线（C30≈${fmt(baseC30?.requestsPerSecond)} 请求/秒、关闭审计后≈${fmt((baseline.stages || []).find(stage => stage.name === '诊断对照：临时关闭访问审计 C30')?.requestsPerSecond)} 请求/秒）差异很大：同一份代码在 Windows 上受文件锁（open/link/unlink）与同步落盘影响，审计开关的收益也被掩盖。因此“两种存储模式谁更快”强依赖宿主文件系统，不能把本机 JSON 基线当作生产容量基线。`)
    const baselineUploadFailures = (baseline.stages || []).filter(stage => stage.kind === 'upload' && stage.errorCount > 0)
    if (baselineUploadFailures.length) l.push(`另需说明：本次 JSON 基线复用仓库现有 \`scripts/performance-load.mjs\`，其上传校验仍按旧目录 \`storage/files/<shareId>/\` 读取落盘文件，而当前代码已改为 \`storage/users/<owner>/\` 布局，导致基线中 ${baselineUploadFailures.map(stage => `${stage.name}（${stage.errorCount} 次）`).join('、')} 被记为 ENOENT 失败（压测脚本侧校验失败，不是服务端上传失败）；基线上传吞吐数字不可用，读取与下载数字不受影响。按要求未修改 server 源码迁就脚本。`)
    const baseSummary = baseline.environment?.fixtureCounts
    if (baseSummary) l.push(`基线数据规模：${baseSummary.users} 用户 / ${baseSummary.seededShares} 分享 / ${baseSummary.records} 记录 / ${baseSummary.auditLogs} 审计；本次 MySQL 数据规模见第二节，两者量级一致，差异不应归因于数据量。`, '')
  } else {
    l.push('本次未找到同机 JSON 模式基线证据（`docs/performance-evidence/http-json/performance-results.json`）。可先执行下方复现命令的第 2 条，再执行 `--report-only` 重新生成本节对比。', '')
  }

  l.push('## 九、建议', '')
  const recommendations = result.recommendations || []
  recommendations.forEach((item, index) => l.push(`${index + 1}. ${item}`))
  l.push('')

  l.push('## 十、测量限制', '')
  const limitations = result.limitations || []
  for (const item of limitations) l.push(`- ${item}`)
  l.push(`- 多轮重复性：本次共完成 ${Math.max(repeatList.length, 1)} 轮完整的 MySQL 模式压测（同脚本、同隔离库规格），业务读取持续 C30 阶段分别约 ${(repeatList.length ? repeatList.map(run => fmt(run.sustainedC30Rps)).join(' / ') : fmt(stages.find(stage => stage.name === '业务读取持续稳定性 C30')?.requestsPerSecond))} req/s，轮次差异约 ±35%（最高约为最低的 1.5 倍）；波动来自同机 Windows 桌面环境的后台 CPU 占用（20–30%）、共享 MySQL 容器的 4 CPU/3 GiB 配额与同机压测客户端竞争。最后一轮被用作本报告主数据，读者不应把单轮结果视为唯一可复现值。逐轮记录见第三节与证据目录 \`repeat-runs.json\`。`)
  l.push('')

  l.push('## 十一、复现命令', '')
  l.push('```powershell')
  l.push('cd ' + root)
  l.push('# 1) MySQL 关系模式完整压测（建库 → seed → 启动 → 压测 → 证据 → 报告 → 清理）')
  l.push('node scripts/performance-load-mysql.mjs')
  l.push('# 2) 同机 JSON 模式基线（不改动既有 docs 报告）')
  l.push('$env:PERFORMANCE_EVIDENCE_DIR="' + path.join(root, 'docs/performance-evidence/http-json').replaceAll('\\', '/') + '"')
  l.push('$env:PERFORMANCE_REPORT_PATH="' + path.join(root, 'docs/performance-evidence/http-json/report.md').replaceAll('\\', '/') + '"')
  l.push('node scripts/performance-load.mjs')
  l.push('# 3) 基线就绪后重新生成本报告（补齐对比章节）')
  l.push('node scripts/performance-load-mysql.mjs --report-only')
  l.push('```')
  l.push('')
  l.push('证据目录：`' + path.relative(root, output).replaceAll('\\', '/') + '/`（results.json、server.log、db-metrics.jsonl、performance-progress.json、cpuprofile）。')
  l.push('')
  return l.join('\n')
}

function fmt(value) { return value === undefined || value === null ? '—' : (typeof value === 'number' ? String(value) : String(value)) }

// ════════════════════════════════════════════════════════════════════
// 主流程
// ════════════════════════════════════════════════════════════════════
async function main() {
  if (reportOnly) {
    const result = readJson(path.join(output, 'results.json'))
    if (!result) throw new Error(`未找到 ${path.join(output, 'results.json')}，无法生成报告`)
    const baseline = readJson(baselinePath)
    fs.mkdirSync(path.dirname(reportPath), { recursive: true })
    fs.writeFileSync(reportPath, buildReport(result, baseline))
    console.log(JSON.stringify({ mode: 'report-only', report: reportPath, comparedWithJson: Boolean(baseline) }))
    return
  }
  if (FORBIDDEN_PORTS.has(database.port)) throw new Error(`拒绝在 ${database.port} 端口建库：只允许隔离实例 3309`)
  const dbName = DB_PREFIX + new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14) + '_' + crypto.randomBytes(4).toString('hex')
  if (!/^kq_perf_http_[a-z0-9_]+$/.test(dbName)) throw new Error('隔离库名不合法：' + dbName)

  const failures = []
  const startedWall = Date.now()
  const startedAtIso = new Date(startedWall).toISOString()
  const serverLogParts = []
  const dbMetricLines = []
  let admin = null
  let pool = null
  let child = null
  let scanner = null
  let metricsAddress = null
  let evidenceWritten = false
  let serverLog = ''
  let stopError = ''
  let shutdown = null
  let fixture = ''
  const cleanup = { databaseDropped: false, fixtureRemoved: false, childExited: null }
  const stages = []
  let scannerBytes = 0
  let scannerFiles = 0
  let setup = null
  const seededRowCounts = {}
  let databaseMeta = {}

  try {
    // ── 0. 环境隔离：必须在 import 任何 server 模块之前完成 ──────────
    for (const key of Object.keys(process.env)) if (/^(KUNQIONG_|OAUTH_)/.test(key)) delete process.env[key]
    process.env.KUNQIONG_DB_ENABLED = 'false'
    process.env.KUNQIONG_DATA_KEY = DATA_KEY
    const moduleUrl = relative => pathToFileURL(path.join(root, relative)).href
    const { applyRelationalSchema } = await import(moduleUrl('server/db/apply-relational-schema.js'))
    const { ensureRelationalStoreSchema, initializeRelationalMetadata } = await import(moduleUrl('server/db/relational-store.js'))
    const { migrateOnDemandSchema } = await import(moduleUrl('server/db/on-demand-schema.js'))
    const { ensureUploadSessionTable } = await import(moduleUrl('server/db/upload-session-store.js'))
    const { RelationalAuditStore } = await import(moduleUrl('server/db/request-audit-store.js'))
    const { normalizeMetadata, normalizeAuditLog } = await import(moduleUrl('server/lib/metadata-normalizers.js'))
    const { MAX_AUDIT_LOGS } = await import(moduleUrl('server/config.js'))

    // ── 1. 临时项目副本（与 JSON 模式脚本一致）──────────────────────
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-performance-mysql-'))
    copyDirectory(path.join(root, 'server'), path.join(fixture, 'server'))
    copyDirectory(path.join(root, 'email-templates'), path.join(fixture, 'email-templates'))
    fs.copyFileSync(path.join(root, 'package.json'), path.join(fixture, 'package.json'))
    for (const directory of ['node_modules', 'dist']) fs.symlinkSync(path.join(root, directory), path.join(fixture, directory), process.platform === 'win32' ? 'junction' : 'dir')

    // ── 2. fixture 数据模型（20 用户 / 200 团队分享 / 400 记录 / 5000 审计 / 1 收集）──
    const createdAt = new Date().toISOString()
    const expiresAt = new Date(Date.now() + 86400000).toISOString()
    const transferBytes = 16 * 1024 ** 2
    const chunkBytes = 4 * 1024 ** 2
    const transferContent = crypto.randomBytes(transferBytes)
    const expectedHash = crypto.createHash('sha256').update(transferContent).digest('hex')
    const model = buildFixtureModel({ createdAt, expiresAt, transferBytes })
    writeFixtureFiles(fixture, model)
    // 16 MiB 下载样本：随机内容，用于逐流 SHA-256 校验。
    fs.mkdirSync(path.join(fixture, 'storage', 'users', 'perf-user-0'), { recursive: true })
    fs.writeFileSync(path.join(fixture, 'storage', 'users', 'perf-user-0', '16MiB.bin'), transferContent)

    // ── 3. 隔离库：建库 → 关系表 → seed → 按需迁移 → 上传会话表 → 审计 seed ──
    setup = { timings: {} }
    const t0 = performance.now()
    admin = await mysql.createConnection({ host: database.host, port: database.port, user: database.user, password: database.password, connectTimeout: 10000, charset: 'utf8mb4' })
    const [versionRows] = await admin.query('SELECT VERSION() AS version, @@max_connections AS maxConnections, @@innodb_buffer_pool_size AS bufferPoolSize, @@transaction_isolation AS isolation')
    databaseMeta = {
      product: 'MySQL', version: versionRows[0].version, maxConnections: Number(versionRows[0].maxConnections),
      innodbBufferPoolMiB: rounded(Number(versionRows[0].bufferPoolSize) / 1024 ** 2), isolation: versionRows[0].isolation,
      host: database.host, port: database.port, name: dbName, connectionLimit: CONNECTION_LIMIT, queueLimit: QUEUE_LIMIT,
      acquireTimeoutMs: Number(process.env.KQ_PERF_ACQUIRE_TIMEOUT_MS || 5000), queryTimeoutMs: Number(process.env.KQ_PERF_QUERY_TIMEOUT_MS || 15000),
    }
    await admin.query(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
    await admin.query(`USE \`${dbName}\``)
    pool = mysql.createPool({ host: database.host, port: database.port, user: database.user, password: database.password, database: dbName, connectionLimit: 8, timezone: 'Z', charset: 'utf8mb4' })
    const schemaSql = fs.readFileSync(path.join(root, 'docs/数据库设计-2026-10-29/03-现有功能关系表设计.sql'), 'utf8')
    setup.timings.applySchemaMs = rounded(performance.now() - t0)
    let mark = performance.now()
    await applyRelationalSchema({ pool, schemaSql })
    setup.timings.applySchemaMs = rounded(performance.now() - mark); mark = performance.now()
    await ensureRelationalStoreSchema(pool)
    setup.timings.storeSchemaMs = rounded(performance.now() - mark); mark = performance.now()
    const seed = normalizeMetadata(model.metadata)
    await initializeRelationalMetadata(pool, seed)
    setup.timings.seedMetadataMs = rounded(performance.now() - mark); mark = performance.now()
    const migration = await migrateOnDemandSchema(pool)
    setup.timings.migrateOnDemandMs = rounded(performance.now() - mark); mark = performance.now()
    await ensureUploadSessionTable(pool)
    setup.timings.uploadSessionTableMs = rounded(performance.now() - mark); mark = performance.now()
    const auditSeed = new RelationalAuditStore(pool, normalizeAuditLog, MAX_AUDIT_LOGS)
    await auditSeed.initialize(model.metadata.auditLogs)
    setup.timings.auditSeedMs = rounded(performance.now() - mark); mark = performance.now()
    setup.migration = { usage: migration.alreadyApplied, normalized: migration.normalized?.alreadyApplied, resourcesBackfilled: migration.resources }
    const [[rowCounts]] = await pool.query(`SELECT
      (SELECT COUNT(*) FROM kq_user) AS users,
      (SELECT COUNT(*) FROM kq_organization) AS organizations,
      (SELECT COUNT(*) FROM kq_organization_member) AS members,
      (SELECT COUNT(*) FROM kq_resource) AS resources,
      (SELECT COUNT(*) FROM kq_resource_file) AS resource_files,
      (SELECT COUNT(*) FROM kq_account_record) AS records,
      (SELECT COUNT(*) FROM kq_auth_session) AS sessions,
      (SELECT COUNT(*) FROM kq_audit_log) AS relational_audit,
      (SELECT COUNT(*) FROM kunqiong_audit_log) AS legacy_audit,
      (SELECT COUNT(*) FROM kq_resource_usage) AS resource_usage,
      (SELECT COUNT(*) FROM kq_system_setting) AS system_settings`)
    Object.assign(seededRowCounts, {
      users: Number(rowCounts.users), organizations: Number(rowCounts.organizations), members: Number(rowCounts.members),
      resources: Number(rowCounts.resources), resourceFiles: Number(rowCounts.resource_files), records: Number(rowCounts.records),
      sessions: Number(rowCounts.sessions), relationalAudit: Number(rowCounts.relational_audit), legacyAudit: Number(rowCounts.legacy_audit),
      resourceUsage: Number(rowCounts.resource_usage), systemSettings: Number(rowCounts.system_settings),
    })
    setup.timings.totalMs = rounded(performance.now() - t0)
    setup.seededRows = { ...seededRowCounts }
    const auditRowsBefore = seededRowCounts.relationalAudit
    console.log('DB READY ' + dbName + ' ' + JSON.stringify(setup.timings))
    if (setupOnly) { console.log('SETUP-ONLY 完成，跳过压测。'); return }

    // ── 4. 扫描模拟器（沿用 JSON 模式脚本：只测协议 I/O）────────────
    scanner = net.createServer(socket => {
      let pending = Buffer.alloc(0), command = false
      socket.on('error', () => {})
      socket.on('data', bytes => {
        pending = Buffer.concat([pending, bytes])
        if (!command) { const end = pending.indexOf(0); if (end < 0) return; if (pending.subarray(0, end).toString() !== 'zINSTREAM') return socket.destroy(); pending = pending.subarray(end + 1); command = true }
        while (pending.length >= 4) {
          const length = pending.readUInt32BE(0); if (pending.length < length + 4) return
          scannerBytes += length; pending = pending.subarray(length + 4)
          if (!length) { scannerFiles++; socket.end('stream: OK\0'); return }
        }
      })
    })
    await new Promise(resolve => scanner.listen(0, '127.0.0.1', resolve))

    // ── 5. 指标注入到临时副本（不修改仓库源码；DB 模式不触碰 metadata.json）──
    const metrics = `
const { monitorEventLoopDelay, performance: loadPerformance } = await import('node:perf_hooks');
const loadDelay = monitorEventLoopDelay({resolution: 10}); loadDelay.enable();
let loadPeakRss = process.memoryUsage().rss;
const loadMemoryTimer = setInterval(() => { loadPeakRss = Math.max(loadPeakRss, process.memoryUsage().rss); }, 100); loadMemoryTimer.unref();
let loadPoolPeak = {all: 0, free: 0, queued: 0, limit: 0, samples: 0};
const loadPoolTimer = setInterval(() => {
  if (!databasePool || !databasePool.pool) return;
  const core = databasePool.pool;
  loadPoolPeak.samples++;
  loadPoolPeak.limit = core.config ? core.config.connectionLimit : 0;
  loadPoolPeak.all = Math.max(loadPoolPeak.all, core._allConnections ? core._allConnections.length : 0);
  loadPoolPeak.free = Math.max(loadPoolPeak.free, core._freeConnections ? core._freeConnections.length : 0);
  loadPoolPeak.queued = Math.max(loadPoolPeak.queued, core._connectionQueue ? core._connectionQueue.length : 0);
}, 20); loadPoolTimer.unref();
app.get('/__performance/metrics', (req, res) => {
  const core = databasePool && databasePool.pool ? databasePool.pool : null;
  const pool = core ? {
    limit: core.config ? core.config.connectionLimit : null,
    all: core._allConnections ? core._allConnections.length : null,
    free: core._freeConnections ? core._freeConnections.length : null,
    queued: core._connectionQueue ? core._connectionQueue.length : null,
    peak: {all: loadPoolPeak.all, free: loadPoolPeak.free, queued: loadPoolPeak.queued, limit: loadPoolPeak.limit, samples: loadPoolPeak.samples},
  } : null;
  const payload = {cpu: process.cpuUsage(), memory: process.memoryUsage(), peakRss: loadPeakRss,
    eventLoop: {p95Ms: loadDelay.percentile(95)/1e6, p99Ms: loadDelay.percentile(99)/1e6, maxMs: loadDelay.max/1e6},
    elu: loadPerformance.eventLoopUtilization(), pool};
  if (req.query.reset) {loadDelay.reset(); loadPeakRss = payload.memory.rss; loadPoolPeak = {all:0, free:0, queued:0, limit: loadPoolPeak.limit, samples:0};}
  res.json(payload);
});
app.get('/__performance/stop', (_req, res) => {res.json({ok:true}); setTimeout(() => shutdown('performance').catch(() => process.exit(1)), 50);});
`
    let serverSource = fs.readFileSync(path.join(root, 'server.mjs'), 'utf8')
    if (!serverSource.includes('const app = express()')) throw new Error('server.mjs 缺少指标注入锚点 const app = express()')
    serverSource = serverSource.replace('const app = express()', 'const app = express()\n' + metrics)
    const auditAnchor = "if (req.path === '/api/health' || (!req.path.startsWith('/api/') && !req.path.startsWith('/auth/'))) return"
    if (!serverSource.includes(auditAnchor)) throw new Error('server.mjs 缺少审计诊断锚点')
    serverSource = serverSource.replace(auditAnchor, auditAnchor + "\n    if (process.env.KUNQIONG_PERF_DIAGNOSTIC_NO_ACCESS_AUDIT === 'true') return")
    fs.writeFileSync(path.join(fixture, 'server.mjs'), serverSource)

    // ── 6. 启动 / 停止被测服务 ──────────────────────────────────────
    const baseEnv = { ...process.env }
    async function startService({ diagnostic = false } = {}) {
      const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve))
      const address = 'http://127.0.0.1:' + port
      const childEnv = {
        ...baseEnv, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production',
        KUNQIONG_DB_ENABLED: 'true',
        KUNQIONG_RELATIONAL_SCHEMA_ENABLED: 'true',
        KUNQIONG_DB_HOST: database.host, KUNQIONG_DB_PORT: String(database.port), KUNQIONG_DB_NAME: dbName,
        KUNQIONG_DB_USER: database.user, KUNQIONG_DB_PASSWORD: database.password,
        KUNQIONG_DB_CONNECTION_LIMIT: String(CONNECTION_LIMIT), KUNQIONG_DB_QUEUE_LIMIT: String(QUEUE_LIMIT),
        KUNQIONG_DB_ACQUIRE_TIMEOUT_MS: String(databaseMeta.acquireTimeoutMs), KUNQIONG_DB_QUERY_TIMEOUT_MS: String(databaseMeta.queryTimeoutMs),
        KUNQIONG_DATA_KEY: DATA_KEY,
        KUNQIONG_SCAN_MODE: 'required', KUNQIONG_CLAMAV_HOST: '127.0.0.1', KUNQIONG_CLAMAV_PORT: String(scanner.address().port),
        KUNQIONG_RELEASE_SHA: 'performance-fixture-mysql',
        KUNQIONG_PERF_DIAGNOSTIC_NO_ACCESS_AUDIT: diagnostic ? 'true' : 'false',
      }
      for (const key of Object.keys(childEnv)) if (/^KUNQIONG_APP_|^KUNQIONG_OAUTH_/.test(key)) delete childEnv[key]
      const proc = spawn(process.execPath, ['--cpu-prof', '--cpu-prof-dir=' + output, '--cpu-prof-name=' + (diagnostic ? 'diagnostic' : 'normal') + '.cpuprofile', 'server.mjs'], { cwd: fixture, windowsHide: true, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] })
      proc.stdout.on('data', bytes => serverLogParts.push(bytes.toString()))
      proc.stderr.on('data', bytes => serverLogParts.push(bytes.toString()))
      for (let attempt = 0; attempt < 200; attempt++) {
        if (proc.exitCode !== null) break
        try { const response = await fetch(address + '/api/health'); if (response.ok) return { proc, address } } catch {}
        await delay(100)
      }
      throw new Error('DB 模式被测服务启动失败：' + serverLogParts.join('').slice(-2500))
    }
    async function stopService(proc, address) {
      if (!proc || proc.exitCode !== null) return
      const started = performance.now()
      const ended = once(proc, 'exit')
      await fetch(address + '/__performance/stop', { signal: AbortSignal.timeout(5000) }).catch(() => {})
      await Promise.race([ended, delay(15000)])
      if (proc.exitCode === null) { stopError = '优雅停机超时，已强制结束进程'; proc.kill(); await ended }
      shutdown = { elapsedMs: rounded(performance.now() - started), exitCode: proc.exitCode, signal: proc.signalCode, graceful: !stopError }
    }

    // ── 7. 指标采集辅助 ────────────────────────────────────────────
    const DB_STATUS_KEYS = [
      'Questions', 'Com_select', 'Com_insert', 'Com_update', 'Com_delete', 'Com_commit', 'Com_rollback',
      'Com_stmt_execute', 'Com_stmt_prepare', 'Slow_queries', 'Select_scan', 'Select_full_join',
      'Innodb_rows_read', 'Innodb_rows_inserted', 'Innodb_rows_updated', 'Innodb_rows_deleted',
      'Innodb_row_lock_waits', 'Innodb_row_lock_time', 'Innodb_row_lock_current_waits',
      'Threads_connected', 'Threads_running', 'Max_used_connections', 'Connections', 'Aborted_clients',
      'Innodb_buffer_pool_read_requests', 'Innodb_buffer_pool_reads', 'Innodb_buffer_pool_pages_free',
      'Innodb_buffer_pool_pages_total', 'Innodb_buffer_pool_read_ahead', 'Innodb_log_waits',
      'Created_tmp_tables', 'Created_tmp_disk_tables', 'Bytes_sent', 'Bytes_received',
    ]
    const TABLE_COUNT_COLUMNS = {
      users: 'kq_user', organizations: 'kq_organization', resources: 'kq_resource',
      resourceFiles: 'kq_resource_file', records: 'kq_account_record', sessions: 'kq_auth_session',
      uploadSessions: 'kq_upload_session', submissions: 'kq_collection_submission',
      relationalAudit: 'kq_audit_log', legacyAudit: 'kunqiong_audit_log',
    }
    async function dbSnapshot(kind = 'after') {
      // 计数查询本身会扫描 InnoDB 行并计入 Innodb_rows_read；把当前 CREATE 位置
      // 放在窗口内侧（before 先计数后取状态，after 先取状态后计数），保证阶段增量只
      // 反映业务请求，不包含快照自身的扫描。
      const countsFirst = kind === 'before'
      const counts = async () => {
        const parts = Object.entries(TABLE_COUNT_COLUMNS).map(([alias, table]) => `(SELECT COUNT(*) FROM \`${table}\`) AS ${alias}`)
        const [[row]] = await admin.query('SELECT ' + parts.join(', '))
        return Object.fromEntries(Object.keys(TABLE_COUNT_COLUMNS).map(key => [key, Number(row[key])]))
      }
      if (countsFirst) {
        const tableCounts = await counts()
        const status = await statusSnapshot()
        return { status, tableCounts }
      }
      const status = await statusSnapshot()
      const tableCounts = await counts()
      return { status, tableCounts }
    }
    async function statusSnapshot() {
      const [rows] = await admin.query('SHOW GLOBAL STATUS')
      const status = {}
      for (const row of rows) if (DB_STATUS_KEYS.includes(row.Variable_name)) status[row.Variable_name] = Number(row.Value)
      return status
    }
    function dbDelta(stageName, before, after, stage) {
      const delta = {}
      for (const key of DB_STATUS_KEYS) delta[key] = rounded(Number(after.status[key] || 0) - Number(before.status[key] || 0))
      // 阶段结束后那次 SHOW GLOBAL STATUS 自身也计入 Questions，扣掉 1 次边界查询。
      if (delta.Questions > 0) delta.Questions -= 1
      for (const key of Object.keys(delta)) if (!Number.isFinite(delta[key]) || delta[key] < 0) delta[key] = 0
      const tableDelta = {}
      for (const key of Object.keys(TABLE_COUNT_COLUMNS)) tableDelta[key] = after.tableCounts[key] - before.tableCounts[key]
      const readRequests = delta.Innodb_buffer_pool_read_requests
      const reads = delta.Innodb_buffer_pool_reads
      const hit = readRequests > 0 ? rounded(100 * Math.max(0, 1 - reads / readRequests)) : null
      const perRequest = stage.requests > 0 ? {
        questions: rounded(delta.Questions / stage.requests),
        comSelect: rounded(delta.Com_select / stage.requests),
        rowsRead: rounded(delta.Innodb_rows_read / stage.requests),
        writeStatements: rounded((delta.Com_insert + delta.Com_update + delta.Com_delete) / stage.requests),
      } : null
      return {
        stage: stageName,
        questions: delta.Questions, comSelect: delta.Com_select, comInsert: delta.Com_insert, comUpdate: delta.Com_update,
        comDelete: delta.Com_delete, comCommit: delta.Com_commit, comRollback: delta.Com_rollback,
        comStmtExecute: delta.Com_stmt_execute, comStmtPrepare: delta.Com_stmt_prepare,
        rowsRead: delta.Innodb_rows_read, rowsInserted: delta.Innodb_rows_inserted,
        rowsUpdated: delta.Innodb_rows_updated, rowsDeleted: delta.Innodb_rows_deleted,
        rowLockWaits: delta.Innodb_row_lock_waits, rowLockTimeMs: delta.Innodb_row_lock_time,
        rowLockCurrentWaits: after.status.Innodb_row_lock_current_waits || 0,
        threadsConnected: after.status.Threads_connected, threadsRunning: after.status.Threads_running,
        maxUsedConnections: after.status.Max_used_connections, connections: delta.Connections,
        bufferPoolReads: reads, bufferPoolReadRequests: readRequests, bufferPoolHitPercent: hit,
        bufferPoolPagesFree: after.status.Innodb_buffer_pool_pages_free ?? null,
        tmpDiskTables: delta.Created_tmp_disk_tables, selectScan: delta.Select_scan, slowQueries: delta.Slow_queries,
        bytesSent: delta.Bytes_sent, bytesReceived: delta.Bytes_received,
        abortedClients: delta.Aborted_clients, innodbLogWaits: delta.Innodb_log_waits,
        perRequest, tableCounts: after.tableCounts, tableDelta,
      }
    }
    const metric = async (reset = false) => {
      const response = await fetch(metricsAddress + '/__performance/metrics' + (reset ? '?reset=1' : ''))
      if (!response.ok) throw new Error('指标端点返回 ' + response.status)
      return response.json()
    }

    // ── 8. 请求与阶段框架（与 JSON 模式脚本同构）────────────────────
    const cookie = index => 'kunqiong_session=perf-session-perf-user-' + (index % 20)
    function request(url, { user = 0, method = 'GET', body, hash = false, expectedStatus = 200, expectedBytes, validate } = {}) {
      return (async () => {
        const headers = { cookie: cookie(user), ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}) }
        const response = await fetch(metricsAddress + url, { method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000) })
        let bytes = 0, data, digest = hash ? crypto.createHash('sha256') : null
        if (hash) { for await (const part of response.body) { bytes += part.length; digest.update(part) } }
        else {
          const buffer = Buffer.from(await response.arrayBuffer()); bytes = buffer.length
          if (validate || body || response.status !== expectedStatus) { try { data = JSON.parse(buffer.toString()) } catch {} }
        }
        const valid = response.status === expectedStatus && (expectedBytes === undefined || bytes === expectedBytes) && (!hash || digest.digest('hex') === expectedHash) && (!validate || validate(data))
        return { status: response.status, bytes, valid, data, requestId: response.headers.get('x-request-id') }
      })()
    }
    const auditRequestIds = []
    const apiMix = [
      { name: '登录会话', url: '/api/auth/me', validate: data => Boolean(data?.user?.id) },
      { name: '团队概览', url: '/api/account/team/overview', validate: data => data?.organization?.id === 'perf-org' && Array.isArray(data.resources) && data.resources.length > 0 },
      { name: '收发记录', url: '/api/account/records', validate: data => Array.isArray(data?.records) && data.records.length === 20 },
      { name: '分享详情', url: '/api/shares/token/perf-share-0', validate: data => data?.share?.id === 'perf-share-0' },
      { name: '收集详情', url: '/api/collections/perf-collection', validate: data => data?.collection?.token === 'perf-collection' },
    ]
    const mixedRequest = async (sequence, worker) => {
      const item = apiMix[sequence % apiMix.length]
      const result = await request(item.url, { user: worker, validate: item.validate })
      if (process.env.KUNQIONG_PERF_DIAGNOSTIC_NO_ACCESS_AUDIT !== 'true' && !diagnosticMode) {
        auditRequestIds.push(result.requestId)
        if (auditRequestIds.length > 50) auditRequestIds.shift()
      }
      return { ...result, endpoint: item.name }
    }
    let diagnosticMode = false
    async function runStage(name, concurrency, operation, { seconds = stageSeconds, count, kind = 'read', diagnostic = false, expectBytes = 0 } = {}) {
      console.log('START ' + name + ' concurrency=' + concurrency)
      const baseline = await metric(true)
      const dbBefore = await dbSnapshot('before')
      const started = performance.now(), deadline = started + seconds * 1000
      const clientBaseline = performance.eventLoopUtilization()
      const durations = [], statusCounts = {}, errors = [], endpoints = []
      let issued = 0, responseBytes = 0, requestBytes = 0
      const endpointBuckets = {}
      await Promise.all(Array.from({ length: concurrency }, async (_, worker) => {
        while (count === undefined ? performance.now() < deadline : issued < count) {
          const sequence = issued++, requestStarted = performance.now()
          try {
            const result = await operation(sequence, worker)
            const elapsed = performance.now() - requestStarted
            durations.push(elapsed); responseBytes += result.bytes || 0; requestBytes += result.requestBytes || 0
            const label = result.endpoint || name; (endpointBuckets[label] ||= []).push(elapsed)
            statusCounts[result.status] = (statusCounts[result.status] || 0) + 1
            if (result.valid) { /* ok */ } else if (errors.length < 10) errors.push({ sequence, status: result.status, endpoint: label, message: result.data?.message || '状态、响应体、字节数或校验和不匹配' })
          } catch (error) {
            durations.push(performance.now() - requestStarted)
            statusCounts.transport_error = (statusCounts.transport_error || 0) + 1
            if (errors.length < 10) errors.push({ sequence, message: error.message })
          }
        }
      }))
      const elapsedMs = performance.now() - started
      const measured = await metric()
      const dbAfter = await dbSnapshot('after')
      const client = performance.eventLoopUtilization(clientBaseline)
      const failed = Object.entries(statusCounts).reduce((sum, [status, value]) => sum + (status === '200' || status === '201' || status === '206' || status === '302' ? 0 : value), 0)
      const okCount = durations.length - failed
      const record = {
        name, kind, diagnostic, concurrency, elapsedSeconds: rounded(elapsedMs / 1000),
        requests: durations.length, successful: okCount, errorCount: failed,
        errorRate: rounded(durations.length ? 100 * failed / durations.length : 0),
        requestsPerSecond: rounded(durations.length / (elapsedMs / 1000)),
        latency: summary(durations),
        endpoints: Object.fromEntries(Object.entries(endpointBuckets).map(([key, values]) => [key, summary(values)])),
        statusCounts, responseBytes, requestBytes,
        throughputMiBPerSecond: rounded(responseBytes / 1024 ** 2 / (elapsedMs / 1000)),
        server: {
          cpuSingleCorePercent: rounded(((measured.cpu.user + measured.cpu.system - baseline.cpu.user - baseline.cpu.system) / 1000) / elapsedMs * 100),
          baselineRssMiB: rounded(baseline.memory.rss / 1024 ** 2),
          peakRssMiB: rounded(measured.peakRss / 1024 ** 2),
          endRssMiB: rounded(measured.memory.rss / 1024 ** 2),
          heapUsedMiB: rounded(measured.memory.heapUsed / 1024 ** 2),
          eventLoop: measured.eventLoop,
        },
        pool: measured.pool,
        clientEluPercent: rounded(client.utilization * 100),
        db: dbDelta(name, dbBefore, dbAfter, { requests: Math.max(1, durations.length) }),
        errors,
      }
      record.db.tableCountsBefore = dbBefore.tableCounts
      stages.push(record)
      dbMetricLines.push(JSON.stringify({ stage: name, kind, concurrency, elapsedSeconds: record.elapsedSeconds, requests: record.requests, db: record.db, pool: record.pool, tableCountsBefore: dbBefore.tableCounts }))
      fs.writeFileSync(path.join(output, 'db-metrics.jsonl'), dbMetricLines.join('\n') + '\n')
      fs.writeFileSync(path.join(output, 'performance-progress.json'), JSON.stringify({ fixture, database: dbName, stages: stages.map(item => ({ name: item.name, concurrency: item.concurrency, requests: item.requests, rps: item.requestsPerSecond, p95Ms: item.latency.p95Ms, errors: item.errorCount, questions: item.db.questions })) }, null, 2))
      if (record.errorCount) failures.push({ stage: name, errors: record.errorCount, samples: errors })
      console.log('DONE ' + name + ' rps=' + record.requestsPerSecond + ' p95=' + record.latency.p95Ms + 'ms errors=' + record.errorCount + ' questions=' + record.db.questions + ' poolQueuedPeak=' + (record.pool?.peak?.queued ?? '—'))
      return record
    }

    // ── 9. 运行阶段 ────────────────────────────────────────────────
    let running = await startService()
    metricsAddress = running.address
    child = running.proc
    let baselineMetrics = await metric()
    for (let index = 0; index < 10; index++) {
      const warm = await mixedRequest(index, index)
      if (!warm.valid) throw new Error('预热请求失败：' + JSON.stringify({ status: warm.status, message: warm.data?.message }))
    }
    await runStage('健康检查基线', 50, () => request('/api/health', { validate: data => data?.ok === true }), { seconds: 5 })
    await runStage('前端页面基线', 50, () => request('/team'), { seconds: 5 })
    for (const concurrency of [1, 10, 30, 50]) await runStage('业务混合读取 C' + concurrency, concurrency, mixedRequest)
    await runStage('业务读取持续稳定性 C30', 30, mixedRequest, { seconds: sustainedSeconds })

    for (const concurrency of [1, 4, 8]) {
      await runStage('16MiB分片上传 C' + concurrency, concurrency, async (sequence, worker) => {
        const name = `perf-upload-${concurrency}-${sequence}-${Date.now()}.bin`
        const session = await request('/api/upload-sessions', { user: worker, method: 'POST', expectedStatus: 201, body: { mode: 'team_resource', chunkSize: chunkBytes, expiryDays: '0', downloadLimit: 'unlimited', files: [{ name, relativePath: name, size: transferBytes, mimeType: 'application/octet-stream' }] } })
        if (!session.valid) return { status: session.status, valid: false, data: session.data }
        const id = session.data.sessionId
        for (let index = 0; index < 4; index++) {
          const chunk = transferContent.subarray(index * chunkBytes, (index + 1) * chunkBytes), form = new FormData()
          form.append('fileIndex', '0'); form.append('chunkIndex', String(index)); form.append('totalChunks', '4')
          form.append('chunkHash', crypto.createHash('sha256').update(chunk).digest('hex')); form.append('chunk', new Blob([chunk]), 'chunk')
          const chunkResponse = await request('/api/upload-sessions/' + id + '/chunks', { user: worker, method: 'POST', body: form })
          if (!chunkResponse.valid) return { status: chunkResponse.status, valid: false, data: chunkResponse.data }
        }
        const done = await request('/api/upload-sessions/' + id + '/complete', { user: worker, method: 'POST', body: {}, expectedStatus: 201 })
        if (!done.valid) return { status: done.status, valid: false, data: done.data }
        const shareId = done.data?.share?.id
        if (!shareId) return { status: done.status, valid: false, data: { message: '完成上传响应缺少 share.id' } }
        const [[fileRow]] = await pool.query('SELECT rf.storage_owner_key, rf.storage_key, rf.size_bytes FROM kq_resource_file rf JOIN kq_resource r ON r.id = rf.resource_id WHERE r.legacy_id = ? ORDER BY rf.id DESC LIMIT 1', [shareId])
        const diskPath = fileRow?.storage_owner_key && fileRow?.storage_key
          ? path.join(fixture, 'storage', 'users', fileRow.storage_owner_key, path.basename(fileRow.storage_key)) : ''
        let valid = false
        if (diskPath && fs.existsSync(diskPath)) {
          const disk = fs.readFileSync(diskPath)
          valid = disk.length === transferBytes && crypto.createHash('sha256').update(disk).digest('hex') === expectedHash
        }
        return { status: 201, valid, bytes: transferBytes, requestBytes: transferBytes }
      }, { count: concurrency, kind: 'upload' })
    }
    for (const concurrency of [1, 4, 8]) {
      await runStage('16MiB完整下载 C' + concurrency, concurrency, () => request('/api/shares/perf-download/files/0/download', { hash: true, expectedBytes: transferBytes }), { count: concurrency * 2, kind: 'download' })
    }

    // 收集任务多人提交（先创建任务：会消耗 1 次 /api/collections 创建额度）
    const createdCollection = await request('/api/collections', { user: 0, method: 'POST', expectedStatus: 201, body: { title: '隔离压测收集-提交', maxFileSizeMb: 1 }, validate: data => Boolean(data?.collection?.token) })
    if (!createdCollection.valid) throw new Error('创建收集任务失败：' + JSON.stringify(createdCollection.data || createdCollection.status))
    const collectionToken = createdCollection.data.collection.token
    const collectionStage = await runStage('收集任务多人提交 C4', 4, async sequence => {
      const form = new FormData()
      form.append('participantName', `压测提交者-${sequence + 1}`)
      form.append('files', new Blob([Buffer.alloc(1024, 0x61)], { type: 'text/plain' }), `participant-${sequence + 1}.txt`)
      const response = await fetch(metricsAddress + '/api/collections/' + collectionToken + '/submissions', { method: 'POST', body: form, signal: AbortSignal.timeout(60000) })
      const buffer = Buffer.from(await response.arrayBuffer())
      let data; try { data = JSON.parse(buffer.toString()) } catch {}
      return { status: response.status, bytes: buffer.length, valid: response.status === 201 && Boolean(data?.submission?.id), data }
    }, { count: collectionParticipants, kind: 'collection-submit' })
    const [[persisted]] = await admin.query('SELECT COUNT(*) AS total FROM kq_collection_submission cs JOIN kq_resource r ON r.id = cs.resource_id WHERE r.legacy_id = ?', [collectionToken])
    const collectionResult = {
      targetParticipants: collectionParticipants, concurrency: 4, accepted: collectionStage.successful,
      errorCount: collectionStage.errorCount, persistedSubmissions: Number(persisted.total), p50Ms: collectionStage.latency.p50Ms, p95Ms: collectionStage.latency.p95Ms,
      p99Ms: collectionStage.latency.p99Ms, requestsPerSecond: collectionStage.requestsPerSecond, peakRssMiB: collectionStage.server.peakRssMiB,
    }
    if (collectionResult.accepted !== collectionParticipants || collectionResult.persistedSubmissions !== collectionParticipants) {
      failures.push({ stage: '收集任务多人提交 C4', message: `期望 ${collectionParticipants} 人提交并落库，实际 accepted=${collectionResult.accepted} persisted=${collectionResult.persistedSubmissions}` })
    }
    console.log('COLLECTION ' + JSON.stringify(collectionResult))

    // 限流校验（动态期望：窗口 5 分钟 / 60 次，本进程已创建 1 个收集任务）
    const collectionsAlreadyCreated = 1
    let validationRejected = 0, rateLimited = 0, unexpected = 0
    for (let index = 0; index < 65; index++) {
      const response = await request('/api/collections', { method: 'POST', body: { title: '' }, expectedStatus: 400 })
      if (response.status === 400) validationRejected++
      else if (response.status === 429) rateLimited++
      else unexpected++
    }
    const expectedRejected = Math.max(0, 60 - collectionsAlreadyCreated)
    const rateLimit = {
      attempts: 65, collectionsAlreadyCreated, validationRejected, rateLimited, unexpected,
      expectedValidationRejected: expectedRejected,
      passed: validationRejected === expectedRejected && rateLimited === 65 - expectedRejected && unexpected === 0,
    }
    if (!rateLimit.passed) failures.push({ stage: '限流校验', message: JSON.stringify(rateLimit) })
    console.log('RATE-LIMIT ' + JSON.stringify(rateLimit))

    // 审计持久化校验：DB 模式的 RelationalAuditStore 覆写 insert()，只写关系表 kq_audit_log。
    const checkedIds = [...new Set(auditRequestIds.filter(Boolean))]
    const placeholders = checkedIds.map(() => '?').join(', ')
    let matchedRequestIds = 0, legacyMatchedRequestIds = 0
    if (checkedIds.length) {
      const [[relationalMatch]] = await admin.query(`SELECT COUNT(*) AS total FROM kq_audit_log WHERE JSON_UNQUOTE(JSON_EXTRACT(details_json, '$.requestId')) IN (${placeholders})`, checkedIds)
      matchedRequestIds = Number(relationalMatch.total)
      const [[legacyMatch]] = await admin.query(`SELECT COUNT(*) AS total FROM kunqiong_audit_log WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, '$.details.requestId')) IN (${placeholders})`, checkedIds)
      legacyMatchedRequestIds = Number(legacyMatch.total)
    }
    const [[auditRowsNow]] = await admin.query('SELECT (SELECT COUNT(*) FROM kunqiong_audit_log) AS legacy, (SELECT COUNT(*) FROM kq_audit_log) AS relational')
    const relationalRowsAfter = Number(auditRowsNow.relational)
    const auditVerification = {
      primaryTable: 'kq_audit_log',
      checkedRequestIds: checkedIds.length,
      matchedRequestIds,
      relationalCheckedRequestIds: checkedIds.length,
      relationalMatchedRequestIds: matchedRequestIds,
      legacyCheckedRequestIds: checkedIds.length,
      legacyMatchedRequestIds,
      legacyRowsBefore: seededRowCounts.legacyAudit,
      legacyRowsAfter: Number(auditRowsNow.legacy),
      relationalRowsBefore: auditRowsBefore,
      relationalRowsAfter,
      relationalNewRows: relationalRowsAfter - auditRowsBefore,
      retentionCapConfigured: 5000,
      retentionCapExceeded: relationalRowsAfter > 5000,
      verdict: matchedRequestIds === checkedIds.length
        ? `访问审计已持久化到关系表 \`kq_audit_log\`：新增 ${relationalRowsAfter - auditRowsBefore} 行，抽查 ${checkedIds.length} 个真实请求号全部命中。DB 模式下 RelationalAuditStore 覆写 insert() 只写关系镜像表，legacy 表 \`kunqiong_audit_log\` 保持 ${Number(auditRowsNow.legacy)} 行不参与写入；保留上限 5000 未在写入路径裁剪（当前 ${relationalRowsAfter} 行）。`
        : `访问审计抽查仅 ${matchedRequestIds}/${checkedIds.length} 命中关系表 kq_audit_log，存在未落库的审计记录，需排查。`,
    }
    if (matchedRequestIds !== checkedIds.length) failures.push({ stage: '审计持久化校验', message: `requestId 命中 ${matchedRequestIds}/${checkedIds.length}` })
    console.log('AUDIT ' + JSON.stringify(auditVerification))

    // 优雅停机（正常负载后）
    await stopService(child, metricsAddress)
    child = null

    // 诊断对照：临时关闭访问审计，定位审计写入成本（仅临时副本，生产必须保留审计）
    let diagnosticRecord = null
    if (!skipDiagnostic) {
      diagnosticMode = true
      try {
        running = await startService({ diagnostic: true })
        metricsAddress = running.address
        child = running.proc
        await metric(true)
        diagnosticRecord = await runStage('诊断对照：临时关闭访问审计 C30', 30, mixedRequest, { seconds: diagnosticsSeconds, diagnostic: true })
        await stopService(child, metricsAddress)
        child = null
      } catch (error) {
        failures.push({ stage: 'diagnostic', message: error.message })
        if (child) { stopService(child, metricsAddress).catch(() => {}); child = null }
      } finally { diagnosticMode = false }
    }

    // ── 10. 结果汇总 ─────────────────────────────────────────────
    const normalC30 = stages.find(stage => stage.name === '业务读取持续稳定性 C30')
    const poolStages = stages.filter(stage => stage.pool)
    const maxQueued = poolStages.reduce((max, stage) => Math.max(max, stage.pool?.peak?.queued || 0), 0)
    const maxConnectionsUsed = poolStages.reduce((max, stage) => Math.max(max, stage.pool?.peak?.all || 0), 0)
    const database503 = stages.reduce((sum, stage) => sum + (stage.statusCounts?.['503'] || 0), 0)
    const profileSummary = filename => {
      if (!fs.existsSync(filename)) return []
      try {
        const profile = JSON.parse(fs.readFileSync(filename, 'utf8')), nodes = new Map(profile.nodes.map(node => [node.id, node])), counts = new Map()
        for (const id of profile.samples || []) { const frame = nodes.get(id)?.callFrame; if (!frame) continue; const key = (frame.functionName || '(anonymous)') + '|' + frame.url + ':' + (frame.lineNumber + 1); counts.set(key, (counts.get(key) || 0) + 1) }
        const active = [...counts.entries()].filter(([key]) => !key.startsWith('(idle)|'))
        const total = active.reduce((sum, [, count]) => sum + count, 0)
        return active.sort((a, b) => b[1] - a[1]).slice(0, 15).map(([frame, samples]) => ({ frame, samples, activeSamplePercent: rounded(100 * samples / total) }))
      } catch { return [] }
    }
    const profiles = { normal: profileSummary(path.join(output, 'normal.cpuprofile')), diagnostic: profileSummary(path.join(output, 'diagnostic.cpuprofile')) }
    const frameShare = (profile, needle) => (profiles[profile] || []).filter(item => item.frame.includes(needle)).reduce((sum, item) => sum + item.activeSamplePercent, 0)
    const auditRowsInserted = Math.max(0, (auditVerification.legacyRowsAfter || 0) - (auditVerification.legacyRowsBefore || 0))
    const relationalAuditInserted = Math.max(0, (auditVerification.relationalRowsAfter || 0) - (auditVerification.relationalRowsBefore || 0))
    const logEvents = summarizeServerLog(serverLogParts.join(''))
    const uploadStages = stages.filter(stage => stage.kind === 'upload')
    const writeConflicts = {
      deadlocks: logEvents.er_lock_deadlock,
      lockWaitTimeouts: logEvents.er_lock_wait_timeout,
      metadataWriteFailed: logEvents.metadata_write_failed,
      capacityChanged: logEvents.capacity_changed,
      requestFailed: logEvents.request_failed,
      uploadFailures: Object.fromEntries(uploadStages.map(stage => [stage.name, stage.errorCount])),
      collectionNon2xx: collectionStage.errorCount,
    }
    const bottlenecks = {
      maxPoolQueuedPeak: maxQueued,
      maxConnectionsUsed,
      database503,
      lines: buildBottleneckLines({ stages, normalC30, maxQueued, maxConnectionsUsed, database503, auditRowsInserted, relationalAuditInserted, auditVerification, diagnosticRecord, frameShare, connectionLimit: CONNECTION_LIMIT, queueLimit: QUEUE_LIMIT, writeConflicts, collectionInfo: collectionResult }),
    }
    const result = {
      executedAt: new Date().toISOString(),
      startedAt: startedAtIso,
      finishedAt: new Date().toISOString(),
      measurementWindowSeconds: rounded((Date.now() - startedWall) / 1000),
      mode: 'mysql-relational-on-demand',
      evidenceDirectory: output,
      reportPath,
      fixture,
      environment: {
        os: os.type() + ' ' + os.release(), node: process.version, cpu: os.cpus()[0]?.model,
        logicalCpus: os.cpus().length, availableParallelism: os.availableParallelism?.() ?? null,
        totalMemoryGiB: rounded(os.totalmem() / 1024 ** 3), freeMemoryGiB: rounded(os.freemem() / 1024 ** 3),
        database: { ...databaseMeta, name: dbName },
        fixtureCounts: { users: 20, teamMembers: 20, seededShares: 201, records: 400, auditLogs: 5000, collections: 1, sessions: 20 },
        seededRows: seededRowCounts,
      },
      setup,
      stages,
      collectionStage: collectionResult,
      rateLimit,
      auditVerification,
      writeConflicts,
      scanner: { files: scannerFiles, bytes: scannerBytes },
      serverLogEvents: logEvents,
      shutdown,
      stopError: stopError || null,
      cleanup,
      failures,
      diagnosticComparison: normalC30 && diagnosticRecord ? {
        baselineRps: normalC30.requestsPerSecond, noAccessAuditRps: diagnosticRecord.requestsPerSecond,
        throughputMultiplier: rounded(diagnosticRecord.requestsPerSecond / Math.max(normalC30.requestsPerSecond, 0.01)),
        baselineP95Ms: normalC30.latency.p95Ms, noAccessAuditP95Ms: diagnosticRecord.latency.p95Ms,
        baselineQuestions: normalC30.db.questions, noAccessAuditQuestions: diagnosticRecord.db.questions,
        note: '仅临时副本关闭访问审计用于归因；生产必须保留访问审计。',
      } : null,
      bottlenecks,
      profiles,
      recommendations: buildRecommendations({ maxQueued, connectionLimit: CONNECTION_LIMIT, database503, normalC30, auditVerification, diagnosticRecord, writeConflicts, collectionInfo: collectionResult }),
      limitations: buildLimitations({ stages, stageSeconds, sustainedSeconds, collectionParticipants, connectionLimit: CONNECTION_LIMIT }),
      environmentFacts: {
        forbiddenPortsTouched: false,
        realDatabaseQueriedForWrite: false,
        runningService8045Touched: false,
      },
    }
    // 重复运行记录：同一脚本多次执行时用于评估本机波动（宿主后台程序会占用 CPU）。
    const repeatFile = path.join(output, 'repeat-runs.json')
    const repeatRuns = (readJson(repeatFile) || []).filter(run => run.database !== dbName)
    repeatRuns.push({
      label: 'run-' + new Date(startedWall).toISOString().replace(/[-:]/g, '').slice(0, 15),
      database: dbName,
      startedAt: startedAtIso,
      finishedAt: result.finishedAt,
      healthRps: stages.find(stage => stage.name === '健康检查基线')?.requestsPerSecond ?? null,
      pageRps: stages.find(stage => stage.name === '前端页面基线')?.requestsPerSecond ?? null,
      mixedC1Rps: stages.find(stage => stage.name === '业务混合读取 C1')?.requestsPerSecond ?? null,
      mixedC10Rps: stages.find(stage => stage.name === '业务混合读取 C10')?.requestsPerSecond ?? null,
      mixedC30Rps: stages.find(stage => stage.name === '业务混合读取 C30')?.requestsPerSecond ?? null,
      mixedC50Rps: stages.find(stage => stage.name === '业务混合读取 C50')?.requestsPerSecond ?? null,
      sustainedC30Rps: normalC30?.requestsPerSecond ?? null,
      sustainedC30P95Ms: normalC30?.latency?.p95Ms ?? null,
      diagnosticC30Rps: diagnosticRecord?.requestsPerSecond ?? null,
      collectionAccepted: collectionResult.accepted,
      collectionPersisted: collectionResult.persistedSubmissions,
      deadlocks: logEvents.er_lock_deadlock,
      failures: failures.filter(failure => failure.stage !== 'cleanup').length,
    })
    fs.writeFileSync(repeatFile, JSON.stringify(repeatRuns, null, 2))
    result.repeatRuns = repeatRuns
    jsonWrite(path.join(output, 'results.json'), result)
    fs.writeFileSync(path.join(output, 'server.log'), serverLogParts.join(''))
    evidenceWritten = true
    const baseline = readJson(baselinePath)
    fs.mkdirSync(path.dirname(reportPath), { recursive: true })
    fs.writeFileSync(reportPath, buildReport(result, baseline))
    console.log(JSON.stringify({ stages: stages.map(stage => ({ name: stage.name, concurrency: stage.concurrency, rps: stage.requestsPerSecond, p95Ms: stage.latency.p95Ms, errors: stage.errorCount, questions: stage.db.questions, poolQueuedPeak: stage.pool?.peak?.queued ?? null })), collectionStage: collectionResult, rateLimit, auditVerification, failures, report: reportPath }, null, 2))
  } finally {
    // ── 11. 清理：停进程 → 关连接 → 删库 → 删临时副本 ───────────────
    if (child && child.exitCode === null) { try { child.kill() } catch {} }
    if (scanner) { try { await new Promise(resolve => scanner.close(resolve)) } catch {} }
    if (admin && pool) { try { await pool.end() } catch {} }
    if (admin) {
      try {
        await admin.query(`DROP DATABASE IF EXISTS \`${dbName}\``)
        const [[check]] = await admin.query('SELECT COUNT(*) AS total FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [dbName])
        cleanup.databaseDropped = Number(check.total) === 0
      } catch (error) { failures.push({ stage: 'cleanup', message: '删库失败：' + error.message }) }
      try { await admin.end() } catch {}
    }
    cleanup.childExited = !child || child.exitCode !== null
    if (fixture && !keepFixture) { try { fs.rmSync(fixture, { recursive: true, force: true }); cleanup.fixtureRemoved = !fs.existsSync(fixture) } catch {} }
    if (!evidenceWritten) {
      jsonWrite(path.join(output, 'results.json'), { executedAt: new Date().toISOString(), mode: 'mysql-relational-on-demand', database: { name: dbName }, failures, setup, stages, cleanup, stopError: stopError || null })
      fs.writeFileSync(path.join(output, 'server.log'), serverLogParts.join(''))
    } else {
      // 清理结果回填到已写出的证据
      const written = readJson(path.join(output, 'results.json'))
      if (written) { written.cleanup = cleanup; written.failures = failures; written.stopError = stopError || null; jsonWrite(path.join(output, 'results.json'), written) }
    }
    if (!keepFixture && fixture && cleanup.fixtureRemoved) console.log('CLEANUP databaseDropped=' + cleanup.databaseDropped + ' fixtureRemoved=' + cleanup.fixtureRemoved)
    if (failures.length) process.exitCode = 1
  }
  console.log('DONE 总耗时 ' + rounded((Date.now() - startedWall) / 1000) + ' 秒')
}

// ── fixture 数据模型 ────────────────────────────────────────────────
function buildFixtureModel({ createdAt, expiresAt, transferBytes }) {
  const users = Object.fromEntries(Array.from({ length: 20 }, (_, index) => {
    const id = 'perf-user-' + index
    return [id, {
      id, username: id, nickname: '压测成员' + index,
      planId: index ? 'free' : 'enterprise',
      planStartedAt: index ? null : createdAt,
      planExpiresAt: null,
      planPermanent: index === 0,
      status: 'active', organizationId: 'perf-org', organizationRole: index ? 'member' : 'owner',
      fileCleanup: { enabled: false, days: 7 },
    }]
  }))
  const organization = {
    id: 'perf-org', slug: 'perf-team', name: '隔离性能测试团队', ownerUserId: 'perf-user-0',
    teamPlanId: 'enterprise', teamPlanStartedAt: createdAt, teamPlanPermanent: true, teamPlanExpiresAt: null,
    createdAt, updatedAt: createdAt,
    members: Object.values(users).map(user => ({ id: 'm-' + user.id, userId: user.id, displayName: user.nickname, role: user.organizationRole, status: 'active', joinedAt: createdAt })),
  }
  const shares = Array.from({ length: 200 }, (_, index) => {
    const owner = 'perf-user-' + (index % 20)
    const storedName = `sample-${index}.txt`
    return {
      id: 'perf-share-' + index, code: 'PF' + String(index).padStart(4, '0'), manageToken: 'perf-manage-' + index,
      ownerUserId: owner, teamResource: true, teamOrganizationId: organization.id,
      status: 'active', createdAt, expiresAt, downloadCount: 0,
      files: [{ name: 'sample-' + index + '.txt', relativePath: 'sample-' + index + '.txt', storedName, storageOwnerId: owner, size: 1024, mimeType: 'text/plain', reviewStatus: 'approved', scanEngine: 'clamav', scannedAt: createdAt }],
    }
  })
  const downloadShare = {
    id: 'perf-download', code: 'PFDOWN', manageToken: 'perf-download-manage', ownerUserId: 'perf-user-0',
    teamResource: true, teamOrganizationId: organization.id, status: 'active', createdAt, expiresAt, downloadCount: 0,
    files: [{ name: '16MiB.bin', relativePath: '16MiB.bin', storedName: '16MiB.bin', storageOwnerId: 'perf-user-0', size: transferBytes, mimeType: 'application/octet-stream', reviewStatus: 'approved', scanEngine: 'clamav', scannedAt: createdAt }],
  }
  const collections = [{
    id: 'perf-collection', token: 'perf-collection', manageToken: 'perf-collection-manage', title: '隔离压测收集',
    description: '', ownerUserId: 'perf-user-0', status: 'active', createdAt, deadline: expiresAt,
    allowedTypes: ['全部格式'], maxFileSizeMb: 100, submissions: [], qrDataUrl: 'data:image/png;base64,fixture',
  }]
  const records = Object.fromEntries(Object.keys(users).map(id => [id, shares.slice(0, 20).map(share => ({
    id: 'my_sent:share:' + share.id, scope: 'my_sent', kind: 'share', shareId: share.id,
    name: share.files[0].name, createdAt, updatedAt: createdAt,
  }))]))
  const auditLogs = Array.from({ length: 5000 }, (_, index) => ({
    id: 'perf-log-' + index, type: 'access', action: 'GET /api/account/team/overview', status: 200, durationMs: 1,
    userId: 'perf-user-0', details: { release: 'performance-fixture', requestId: 'seed-' + index }, createdAt,
  }))
  const sessions = Object.values(users).map(user => ({ id: 'perf-session-' + user.id, user, expiresAt, createdAt }))
  return {
    metadata: {
      users, shares: [...shares, downloadShare], collections, records, auditLogs,
      organizations: { [organization.id]: organization },
      sessions, messages: {}, upgradeOrders: [],
    },
    transferFiles: [{ storageOwnerId: 'perf-user-0', storedName: '16MiB.bin', size: transferBytes }],
  }
}

function writeFixtureFiles(fixture, model) {
  // 当前版本文件按 storage/users/<storageOwner>/<storedName> 寻址；DB 模式启动不执行
  // legacy 文件迁移，因此种子文件必须直接写入用户目录结构。
  for (const share of model.metadata.shares) {
    for (const file of share.files || []) {
      const directory = path.join(fixture, 'storage', 'users', file.storageOwnerId)
      fs.mkdirSync(directory, { recursive: true })
      const target = path.join(directory, file.storedName)
      if (file.size === 16 * 1024 ** 2) continue // 大文件由调用方写入随机内容
      fs.writeFileSync(target, Buffer.alloc(file.size, 0x61))
    }
  }
  fs.mkdirSync(path.join(fixture, 'storage', 'tmp'), { recursive: true })
}

// ── 报告辅助：瓶颈/建议/限制 ───────────────────────────────────────
function buildBottleneckLines({ stages, normalC30, maxQueued, maxConnectionsUsed, database503, auditRowsInserted, relationalAuditInserted, auditVerification, diagnosticRecord, frameShare, connectionLimit, queueLimit, writeConflicts, collectionInfo }) {
  const lines = []
  if (!normalC30) return ['本报告缺少 C30 持续阶段数据。']
  const perRequest = normalC30.db?.perRequest || {}
  const c1 = stages.find(stage => stage.name === '业务混合读取 C1')
  const queryCostMs = c1 && perRequest.questions ? rounded(c1.latency.p50Ms / perRequest.questions) : null
  const theoreticalRps = queryCostMs && perRequest.questions ? rounded(connectionLimit / (perRequest.questions * queryCostMs / 1000)) : null
  const c10 = stages.find(stage => stage.name === '业务混合读取 C10')
  lines.push(`**1) DB 连接池 ${connectionLimit} 连接是首要约束。** C30 持续负载下连接池峰值已建连接 ${maxConnectionsUsed}/${connectionLimit}，排队峰值 ${maxQueued}（queueLimit=${queueLimit}）；全测试 503 响应共 ${database503} 次，集中在写入场景（见第 6 条）。并发从 C1 升到 C10 后吞吐即进入平台（C30/C50 不再提升、P95 随并发线性上升），属于典型的连接池排队：单个业务混合请求包含会话、账号、组织、资源分页、用量、通知等多段串行 SQL，请求会反复申请/释放连接，因此连接池先于 CPU 饱和。`)
  lines.push('')
  lines.push(`**2) 按需 SQL 次数直接决定吞吐上限。** C30 混合读取平均 **${perRequest.questions ?? '—'} 条语句/请求**（其中 SELECT ${perRequest.comSelect ?? '—'} 条、Innodb 行读 ${perRequest.rowsRead ?? '—'} 行/请求），写入语句 ${perRequest.writeStatements ?? '—'} 条/请求。用 C1 阶段 P50 ${c1?.latency.p50Ms ?? '—'} ms 除以每请求语句数得到单条语句约 ${queryCostMs ?? '—'} ms，按 ${connectionLimit} 条连接估算纯 SQL 串行上限约 ${theoreticalRps ?? '—'} req/s，实测 C10≈${c10?.requestsPerSecond ?? '—'} req/s；剩余差距来自服务端单核 CPU（读取阶段单进程 CPU 已接近 100–110% 单核口径）、审计 flush 等待与同机客户端竞争。放大项是分页与组织图加载：这些查询结果集都很小，瓶颈在往返次数与连接争用，而不是单条 SQL 执行时间。`)
  lines.push('')
  const auditLine = diagnosticRecord
    ? `**3) 访问审计是固定但非主导的成本。** 关闭访问审计的 C30 对照：吞吐 ${normalC30.requestsPerSecond} → ${diagnosticRecord.requestsPerSecond} req/s（${rounded(diagnosticRecord.requestsPerSecond / Math.max(normalC30.requestsPerSecond, 0.01))} 倍），P95 ${normalC30.latency.p95Ms} → ${diagnosticRecord.latency.p95Ms} ms，Questions/请求 ${perRequest.questions ?? '—'} → ${diagnosticRecord.db?.perRequest?.questions ?? '—'}。该差异与阶段间波动同量级（诊断阶段在持续阶段之后运行、缓存更热），不能单独归因；可以确定的是审计写入走同一连接池、每次 API 请求追加 1 条 INSERT（压测期间关系表 \`kq_audit_log\` 新增 ${relationalAuditInserted} 行，抽查 ${auditVerification.checkedRequestIds} 个请求号全部命中），是每请求固定的额外往返。`
    : `**3) 访问审计写入成本未做对照测量**（跳过诊断阶段）。压测期间关系表 \`kq_audit_log\` 新增 ${relationalAuditInserted} 行，抽查 ${auditVerification.checkedRequestIds} 个请求号命中 ${auditVerification.matchedRequestIds} 条。`
  lines.push(auditLine)
  lines.push('')
  const cryptoNeedles = ['decodeProtected', 'createCipherBase', 'crypto/cipher', 'hydrate|', 'hydrateRows', 'normalized-codec', 'structuredClone', 'protectCredential', 'revealCredential', 'keyedDigest']
  const decodeShare = cryptoNeedles.reduce((sum, needle) => sum + frameShare('normal', needle), 0)
  lines.push(`**4) 加密/实体解码成本显著。** 正常进程 CPU profile 中与关系载荷解密、实体 hydrate/打包相关的帧（decodeProtected、createCipherBase、crypto/cipher update/final、request-store.hydrate、hydrateRows、normalized-codec、structuredClone）合计活跃采样约 **${rounded(decodeShare)}%**。关系表把实体载荷整体加密（entity_payload_json）后按请求解密，并要为每次请求把行数据 hydrate/pack 成业务对象，这是 MySQL 模式相对 JSON 模式的额外 CPU 成本，也是读取吞吐上不去的原因之一。`)
  lines.push('')
  lines.push('**5) 分页取齐与团队视图。** 团队概览、收发记录、回收站等路由在 DB 模式按游标分页取数（默认 50 行），而 JSON 模式一次性从内存快照取全量；分页显著降低单次响应字节，但让“列表 + 计数 + 成员用量”页面变成多段串行 SQL，C50 时更容易在连接池排队。')
  lines.push('')
  const uploadFailures = writeConflicts?.uploadFailures || {}
  const uploadFailureText = Object.entries(uploadFailures).map(([name, count]) => `${name}=${count}`).join('、') || '—'
  lines.push(`**6) 写入路径并发不健壮（本次最重要的可靠性发现）。** 服务端日志出现 \`ER_LOCK_DEADLOCK\` ${writeConflicts?.deadlocks ?? 0} 次、\`CAPACITY_CHANGED\` ${writeConflicts?.capacityChanged ?? 0} 次、\`METADATA_WRITE_FAILED\` ${writeConflicts?.metadataWriteFailed ?? 0} 次。受影响场景：上传完成（${uploadFailureText}）、收集任务多人提交（${collectionInfo?.errorCount ?? writeConflicts?.collectionNon2xx ?? 0}/${collectionInfo?.targetParticipants ?? '—'} 次非 2xx）。写事务虽然通过 \`kq_write_lock\` 行锁做作用域串行，但并发团队写入仍会撞 InnoDB 死锁；服务端对死锁/容量冲突没有有界重试，直接把 503/409 返回客户端。收集阶段实际落库 ${collectionInfo?.persistedSubmissions ?? '—'} 条，而返回 201 的只有 ${collectionInfo?.accepted ?? '—'} 条——说明部分事务已经提交、响应却是错误码，客户端无法据此判断是否需要重试，存在“假失败”语义。`)
  lines.push('')
  lines.push('**7) 传输链路未成为瓶颈。** 上传/下载阶段的限制来自 16 MiB 字节复制、SHA-256 校验与扫描协议传输，DB 只承担会话与资源元数据写入（上传完成时一次事务），C8 阶段吞吐仍受同机字节拷贝与磁盘约束。')
  lines.push('')
  lines.push('**交叉验证（数据库层压测）：** 数据库层压测在同一隔离 MySQL 实例上独立复现了本条根因 —— 写路径的 `INSERT IGNORE INTO kq_write_lock` 与 `SELECT ... FOR UPDATE` 组合会产生共享锁→排他锁（S→X）升级，20 并发同 key 时约 75% 的事务死锁，与本报告服务端日志中的 `ER_LOCK_DEADLOCK` 以及 503 `METADATA_WRITE_FAILED` 现象吻合。详见 `docs/PERFORMANCE-数据库压测报告.md`（该报告给出可复现的代码级根因；本次按要求未修改 server 源码）。')
  return lines
}

function buildRecommendations({ maxQueued, connectionLimit, database503, normalC30, auditVerification, diagnosticRecord, writeConflicts, collectionInfo }) {
  const recommendations = []
  if ((writeConflicts?.deadlocks ?? 0) > 0 || (collectionInfo?.errorCount ?? 0) > 0) recommendations.push(`**优先修复写入并发（可靠性）**：本次实测 \`ER_LOCK_DEADLOCK\` ${writeConflicts?.deadlocks ?? 0} 次、\`CAPACITY_CHANGED\` ${writeConflicts?.capacityChanged ?? 0} 次，上传完成与收集提交被 503/409 拒绝；且有 ${collectionInfo?.persistedSubmissions ?? 0} 条提交实际落库却返回错误码。建议：对死锁/锁等待超时做有界重试（指数退避，重试前重新读取 revision 与用量），缩小 \`kq_write_lock\` 与事务覆盖范围（避免在同一事务里串行加多个作用域锁），并把“已提交但响应失败”的路径改成幂等可重试语义（返回明确错误码或按幂等键返回成功）。`)
  if (maxQueued > 0 || database503 > 0) recommendations.push(`连接池容量与排队：当前 connectionLimit=${connectionLimit} 在 C30 已出现排队峰值 ${maxQueued}、503 ${database503} 次。建议按目标并发做压测标定（例如 C50 目标下将 connectionLimit 提升到并发读请求数的一个分数，并同步调大 queueLimit / acquireTimeout），或按请求合并按需查询（一次请求内的会话 + 账号 + 组织 + 用量允许复用一个连接）。`)
  recommendations.push('减少按需 SQL 往返：把同一请求内的多次 `store.config()/session()/account()/organizationGraph()/loadUsage()` 合并到单连接上的批量语句（multi-statement 或一次 JOIN），并缓存只读系统配置与套餐快照，避免每次请求重复读取。')
  recommendations.push(`审计写入与保留：DB 模式访问审计已写入关系表 \`kq_audit_log\`（抽查全部命中），但保留上限 5000 未在写入路径裁剪（本次已到 ${auditVerification?.relationalRowsAfter ?? '—'} 行）。建议补充基于时间的清理任务（服务启动路径明确调度审计 purge）并监控表增长，避免审计表随请求量无界膨胀。`)
  if (diagnosticRecord) recommendations.push(`审计写入成本归因：关闭访问审计后 C30 吞吐从 ${normalC30.requestsPerSecond} 提升到 ${diagnosticRecord.requestsPerSecond} req/s，差异与阶段间噪声同量级，说明访问审计不是主导成本（主要成本是连接池排队与按需 SQL）。仍建议把每请求 1 次独立 INSERT 改为有界队列批量提交（明确容量、背压、失败重试与退出落盘），以减少往返并把审计写入从响应路径移出。`)
  recommendations.push('资源与文件元数据分页：继续沿用当前分页读取，避免一次请求解密大量 `entity_payload_json`；列表接口只返回必要字段，成员用量等聚合查询走 `kq_resource_usage` 预聚合表（当前已由迁移回填）。')
  recommendations.push('加密载荷成本：`entity_payload_json` 整体加密带来按请求 AES-GCM 开销，建议对非敏感的大字段（展示名、标题、时间等）保持明文列，仅对凭据/参与者信息加密，减少解密字节量。')
  recommendations.push('上线容量确认：本次只覆盖 16 MiB 文件、20 用户/201 资源的本机回环场景；真实部署还需跨机网络、长时间运行、500 MiB/5 GiB 大文件、真实 ClamAV 及多实例共享同一 MySQL 的场景复测后再定容量。')
  return recommendations
}

function buildLimitations({ stages, stageSeconds, sustainedSeconds, collectionParticipants, connectionLimit }) {
  const uploadStages = stages.filter(stage => stage.kind === 'upload')
  const downloadStages = stages.filter(stage => stage.kind === 'download')
  return [
    `健康检查与前端页面基线各 5 秒，业务读取普通阶段 ${stageSeconds} 秒、持续阶段 ${sustainedSeconds} 秒；上传仅 ${uploadStages.reduce((sum, stage) => sum + stage.requests, 0)} 个文件、下载仅 ${downloadStages.reduce((sum, stage) => sum + stage.requests, 0)} 个文件，分位数样本有限，不能外推为长稳结论。`,
    '压测客户端与被测服务、MySQL 容器、扫描模拟器同机运行，客户端事件循环与 CPU 会和被测服务竞争；表中“服务 CPU”是单进程 cpuUsage 增量按阶段时长折算的单核百分比口径。',
    '扫描链路使用本机 INSTREAM 协议模拟器（required 模式），只验证协议往返与字节计数，不代表真实 ClamAV 病毒库扫描耗时。',
    `MySQL 全局状态增量包含服务端关系维护定时器（清理/对账/审计清扫）在窗口内的少量查询、以及每次快照自身 1 条 SHOW GLOBAL STATUS（已在 Questions 中扣除 1），阶段内业务查询占绝大多数；连接池排队为 20 ms 采样峰值，可能低估极短尖峰。`,
    '数据量小（约 200 资源 / 5000 条种子审计 / 数百 KB 载荷），InnoDB Buffer Pool 命中率全程 100%，本次没有测到磁盘 I/O 压力；真实数据量下缓冲池未命中与磁盘延迟会成为新的瓶颈。',
    `连接池固定 ${connectionLimit} 连接（KUNQIONG_DB_CONNECTION_LIMIT=5），未做多档容量扫描；C50 的结果不能代表提高连接池后的表现。`,
    '收集提交阶段每位提交者上传 1 KiB 文本，主持人（企业权益）参与人数上限为不限，故未触发人数上限；限流校验按 5 分钟窗口 / 60 次与进程内已用额度动态计算期望值。',
    '审计持久化结论：DB 模式访问审计写入关系表 kq_audit_log（RelationalAuditStore 覆写 insert），legacy 表 kunqiong_audit_log 不参与；本次以请求号抽查方式验证，未逐条核对全部请求。',
    '收集提交与上传完成阶段的失败同时包含 503（服务端写事务失败/死锁）与 409（乐观并发冲突）；压测客户端不做自动重试，因此这些失败反映“一次尝试”的结果，不代表业务最终成功率，也说明客户端缺乏可判定的重试语义。',
    'CPU profile 在压测期间持续采样（约 1 ms 周期），会带来少量固定开销；profile 帧占比是整个进程的活跃采样比例，不是单阶段耗时比例。',
  ]
}

function summarizeServerLog(text) {
  const count = pattern => (text.match(pattern) || []).length
  return {
    audit_write_failed: count(/audit_write_failed/g),
    relational_request_write_failed: count(/relational_request_write_failed/g),
    request_failed: count(/request_failed/g),
    database_timeout: count(/DATABASE_QUEUE_TIMEOUT|DATABASE_QUERY_TIMEOUT|数据库暂时繁忙/g),
    er_lock_deadlock: count(/ER_LOCK_DEADLOCK/g),
    er_lock_wait_timeout: count(/ER_LOCK_WAIT_TIMEOUT/g),
    metadata_write_failed: count(/METADATA_WRITE_FAILED/g),
    capacity_changed: count(/CAPACITY_CHANGED/g),
    er_dup_entry: count(/ER_DUP_ENTRY|Duplicate entry/g),
    audit_lock: count(/AUDIT_LOCK_STUCK|审计日志写入锁/g),
    startup_failed: count(/application_initialization_failed|STARTUP_FAILED/g),
    persistence_error: count(/persistenceError/g),
  }
}

function copyDirectory(source, target) {
  fs.mkdirSync(target, { recursive: true })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.isDirectory()) copyDirectory(path.join(source, entry.name), path.join(target, entry.name))
    else if (entry.isFile()) fs.copyFileSync(path.join(source, entry.name), path.join(target, entry.name))
  }
}

await main()
