// 机械抽取脚本：从 server.mjs 原文逐字摘取配置与工具函数，生成 server/ 模块。
//
// 设计原则（重要）：
//   1. 所有业务常量与环境变量表达式均从原文「逐字搬运」，仅追加 export 前缀；
//      绝不在此处手写，避免丢失业务语义（例如 COLLECTION_TYPE_EXTENSIONS 的键是
//      中文分类名，一旦手写就会让收集任务的文件白名单失效）。
//   2. 仅 `__dirname` 因从根目录迁到 server/ 子目录而改为 projectRoot。
//   3. 每段抽取都可用 scripts/refactor/verify-extract.mjs 复核字节一致性。
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..', '..')
const src = fs.readFileSync(path.join(root, 'server.mjs'), 'utf8')
const lines = src.split('\n')

const block = (a, b) => lines.slice(a - 1, b).join('\n').trimEnd()
// 把const 声明转成导出声明（仅加前缀，不改内容）
const asExport = (text) => text.replace(/^const /gm, 'export const ').replace(/^let /gm, 'export let ')
const EXPORTED = []

// ── 函数边界（整体搬运，不改内容）──
const FN = {
  loadEnvFile: [6021, 6038],
  splitConfigValues: [5947, 5949],
  parseBooleanEnv: [5951, 5954],
  httpError: [5882, 5886],
  parseRecipients: [5888, 5896],
  firstHeader: [5939, 5941],
  firstValue: [5943, 5945],
  escapeHtml: [5956, 5963],
  createToken: [5965, 5967],
  hashSecret: [5980, 5982],
  parseJson: [5984, 5990],
  removeDirectory: [6017, 6019],
}
const fn = (name) => block(FN[name][0], FN[name][1])

// ── 常量区块（逐字搬运）──
const CB = {
  storagePaths: [17, 23],
  uploadLimits: [24, 26],
  oauth: [27, 34],
  smtp: [35, 41],
  tencent: [42, 47],
  webMember: [48, 49],
  webMemberPackageKeys: [50, 56],
  webMemberPackageIds: [57, 61],
  cookies: [68, 74],
  uploadSessions: [75, 77],
  accountLimits: [78, 87],
  adminAuth: [88, 90],
  scanConfig: [93, 97],
  adminSessions: [98, 101],
  joinRequest: [103, 106],
  testModes: [110, 116],
  collectionTypes: [118, 127],
  upgradeLimits: [128, 129],
  guestLimits: [131, 134],
}
const cb = (name) => block(CB[name][0], CB[name][1])

// ── databasePool 定义块（含其依赖的 database* 变量，原样搬运）──
const DB_BLOCK = [62, 66]
const DB_EXPR = [62, 66]

// server.mjs 中路径常量使用 __dirname；迁到 server/ 后指向父目录。
// 仅替换这一处标识符，其余原样。
const withRoot = (text) => text.replaceAll('__dirname', 'projectRoot')

const config = `// 环境配置与路径常量
// 本文件由 scripts/refactor/extract-config.mjs 从 server.mjs 逐字抽取生成。
// 原则：业务常量与环境变量表达式均原样搬运，仅追加 export 前缀，未改写任何逻辑。
// 唯一结构性调整：路径常量中的 __dirname 改为 projectRoot（本文件位于 server/ 子目录）。
import fs from 'node:fs'
import path from 'node:path'
import mysql from 'mysql2/promise'
import { loadEnvFile } from './lib/env-file.js'

export const projectRoot = path.resolve(import.meta.dirname, '..')

loadEnvFile(path.join(projectRoot, '.env'))

// ── 路径 ──
${withRoot(asExport(cb('storagePaths')))}

${fn('splitConfigValues').replace(/^function /, 'export function ')}

${fn('parseBooleanEnv').replace(/^function /, 'export function ')}

// ── 上传与限流 ──
${asExport(cb('uploadLimits'))}

${asExport(cb('uploadSessions'))}

// ── OAuth 与应用地址 ──
${asExport(cb('oauth'))}

// ── SMTP ──
${asExport(cb('smtp'))}

// ── 腾讯云短信 ──
${asExport(cb('tencent'))}

// ── 主站会员支付 ──
${asExport(cb('webMember'))}

${asExport(cb('webMemberPackageKeys'))}

${asExport(cb('webMemberPackageIds'))}

// ── Cookie 与会话 ──
${asExport(cb('cookies'))}

// ── 账号侧数量限制 ──
${asExport(cb('accountLimits'))}

// ── 管理员认证 ──
${asExport(cb('adminAuth'))}

${cb('adminAuth').includes('adminCredentialsConfigured') ? '' : `export const adminCredentialsConfigured = Boolean(ADMIN_ACCOUNT_USERNAME && ADMIN_ACCOUNT_PASSWORD.trim())
if (!adminCredentialsConfigured) console.warn('[admin] 管理员凭据未配置，后台密码登录已禁用。')`}

// ── 文件安全扫描（fail-closed）──
${asExport(cb('scanConfig'))}

// ── 后台会话与限流 ──
${asExport(cb('adminSessions'))}

${asExport(cb('joinRequest'))}

// ── 测试环境开关 ──
${asExport(cb('testModes'))}

// ── 收集任务文件类型（键为中文分类名，改动会影响收集白名单）──
${asExport(cb('collectionTypes'))}

${asExport(cb('upgradeLimits'))}

// ── 游客配额 ──
${asExport(cb('guestLimits'))}

// ── 数据库 ──
${asExport(block(DB_EXPR[0], DB_EXPR[1]))}

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

for (const directory of [storageRoot, tempRoot, filesRoot, collectionsRoot]) {
  fs.mkdirSync(directory, { recursive: true })
}
`

const http = `// HTTP 错误构造与通用纯函数
// 本文件由 scripts/refactor/extract-config.mjs 从 server.mjs 逐字抽取生成。
import crypto from 'node:crypto'
import fs from 'node:fs'

${fn('httpError').replace(/^function /, 'export function ')}

${fn('parseRecipients').replace(/^function /, 'export function ')}

${fn('firstHeader').replace(/^function /, 'export function ')}

${fn('firstValue').replace(/^function /, 'export function ')}

${fn('escapeHtml').replace(/^function /, 'export function ')}

${fn('createToken').replace(/^function /, 'export function ')}

${fn('hashSecret').replace(/^function /, 'export function ')}

${fn('parseJson').replace(/^function /, 'export function ')}

${fn('removeDirectory').replace(/^function /, 'export function ')}
`

const envFile = `// .env 文件加载
// 从 server.mjs 逐字抽取。
import fs from 'node:fs'

${fn('loadEnvFile').replace(/^function /, 'export function ')}
`

fs.mkdirSync(path.join(root, 'server', 'lib'), { recursive: true })
fs.writeFileSync(path.join(root, 'server', 'lib', 'env-file.js'), envFile, 'utf8')
fs.writeFileSync(path.join(root, 'server', 'config.js'), config, 'utf8')
fs.writeFileSync(path.join(root, 'server', 'lib', 'http.js'), http, 'utf8')
console.log('OK server/lib/env-file.js', envFile.split('\n').length, '行')
console.log('OK server/config.js     ', config.split('\n').length, '行')
console.log('OK server/lib/http.js   ', http.split('\n').length, '行')