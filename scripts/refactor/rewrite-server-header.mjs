// 改写 server.mjs：删除已迁出到 server/ 的定义，改为 import。
//
// 设计要点：
//   1. 输入始终取 git HEAD:server.mjs，保证幂等（可重复执行）。
//   2. 所有删除基于精确行号，并在删除前逐行校验前缀，防止行号漂移误删。
//   3. 仅删「已迁出」的行；业务常量（ACCOUNT_PLANS、DEFAULT_SYSTEM_CONFIG 等）保留原位。
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..', '..')
const target = path.join(root, 'server.mjs')

// 输入取自 git HEAD 的导出副本（沙箱内直接调用 git 会被阻塞，故先离线导出到 .orig）。
// 这样脚本可重复执行：每次都以原始版本为输入，不会在已改写的文件上二次改写。
const backup = path.join(root, 'server.mjs.orig')
const original = fs.existsSync(backup)
  ? fs.readFileSync(backup, 'utf8')
  : fs.readFileSync(target, 'utf8')
if (!fs.existsSync(backup)) fs.writeFileSync(backup, original, 'utf8')

const lines = original.split('\n')
console.log('原始行数:', lines.length)

// ── 删除区间（1-based，闭区间）──
// 头部 1-134：import 区 + 路径常量 + 环境变量 + 限流参数 + 收集类型 + 游客配额
// 尾部：已迁入 server/lib/http.js 与 server/lib/env-file.js 的纯函数
const RANGES = [
  [1, 134],
  [5882, 5896],  // httpError + parseRecipients
  [5939, 5945],  // firstHeader + firstValue
  [5947, 5954],  // splitConfigValues + parseBooleanEnv
  [5956, 5967],  // escapeHtml + createToken
  [5980, 5990],  // hashSecret + parseJson
  [6017, 6019],  // removeDirectory
  [6021, 6038],  // loadEnvFile
]

// 逐行校验：确认关键行内容符合预期，否则中止（避免误删）
const EXPECT = {
  1: /^import /, 17: /^const storageRoot/, 27: /^const serverPort/, 68: /^const AUTH_COOKIE_NAME/,
  88: /^const ADMIN_USER_IDS/, 118: /^const COLLECTION_TYPE_OPTIONS/, 134: /^const MAX_GUEST_USAGE_ENTRIES/,
  5882: /^function httpError/, 5888: /^function parseRecipients/, 5939: /^function firstHeader/,
  5947: /^function splitConfigValues/, 5956: /^function escapeHtml/, 5980: /^function hashSecret/,
  6017: /^function removeDirectory/, 6021: /^function loadEnvFile/,
}
let abort = false
for (const [line, re] of Object.entries(EXPECT)) {
  const text = lines[Number(line) - 1] ?? ''
  if (!re.test(text)) {
    console.log(`  [中止] 第 ${line} 行与预期不符：${JSON.stringify(text.slice(0, 60))}`)
    abort = true
  }
}
if (abort) { console.log('边界校验未通过，未做任何修改。'); process.exit(1) }
console.log('边界校验通过，开始改写…')

const drop = new Set()
for (const [a, b] of RANGES) for (let i = a; i <= b; i++) drop.add(i)

const NEW_HEADER = `// 鲲穹文件传输服务端入口
//
// 分层说明（重构后）：
//   server/config.js        环境变量、路径与业务常量
//   server/lib/env-file.js  .env 加载
//   server/lib/http.js      HTTP 错误构造与通用纯函数
//   server/store.js         metadata 状态与持久化（后续拆分）
//   server/routes/*.js      业务路由模块（后续拆分）
//
// 本文件保留应用装配、运行期状态与全部路由注册，按域逐步迁移且保持行为不变。
import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import crypto from 'node:crypto'
import multer from 'multer'
import archiver from 'archiver'
import QRCode from 'qrcode'
import nodemailer from 'nodemailer'
import net from 'node:net'
import { once } from 'node:events'

import {
  storageRoot, tempRoot, filesRoot, collectionsRoot, distRoot, metadataPath, shareEmailTemplatePath,
  MAX_FILE_SIZE, MAX_FILES, EXPIRING_SOON_MS,
  UPLOAD_CHUNK_MIN_BYTES, UPLOAD_CHUNK_MAX_BYTES, UPLOAD_CHUNK_DEFAULT_BYTES, UPLOAD_SESSION_TTL_MS,
  oauthAuthorizeUrl, oauthTokenUrl, oauthClientId, oauthClientSecret,
  configuredCallbackUrls, configuredAppUrl, releaseSha,
  smtpHost, smtpPort, smtpSecure, smtpUser, smtpPassword, smtpFrom, smtpFromName,
  tencentSmsSecretId, tencentSmsSecretKey, tencentSmsSdkAppId, tencentSmsSignName,
  tencentSmsBindTemplateId, tencentSmsRegion,
  webMemberApiBase, webMemberSubsiteName, WEB_MEMBER_PACKAGE_ENV_KEYS, DEFAULT_WEB_MEMBER_PACKAGE_IDS,
  AUTH_COOKIE_NAME, SHARE_ACCESS_COOKIE_PREFIX, SHARE_ACCESS_TTL_SECONDS, OAUTH_STATE_TTL_MS,
  MAX_ACCOUNT_RECORDS, MAX_ACCOUNT_MESSAGES, MAX_RECORD_FILES, MAX_RECORD_SUBMISSIONS,
  VERIFICATION_CODE_TTL_MS, MAX_VERIFICATION_CODES, ACCOUNT_SINGLE_FILE_BYTES,
  ACCOUNT_RECORD_SCOPES, ACCOUNT_RECORD_KINDS, ACCOUNT_MESSAGE_CATEGORIES,
  ADMIN_USER_IDS, ADMIN_ACCOUNT_USERNAME, ADMIN_ACCOUNT_PASSWORD, adminCredentialsConfigured,
  ADMIN_COOKIE_NAME, ADMIN_SESSION_TTL_MS, ADMIN_LOGIN_MAX_ATTEMPTS, ADMIN_LOGIN_WINDOW_MS,
  JOIN_REQUEST_MAX_PER_WINDOW, JOIN_REQUEST_WINDOW_MS, JOIN_REQUEST_REJECT_COOLDOWN_MS,
  COLLECTION_TYPE_OPTIONS, COLLECTION_TYPE_EXTENSIONS, UPGRADE_ORDER_STATUSES,
  MAX_UPGRADE_ORDERS, MAX_AUDIT_LOGS,
  GUEST_ID_COOKIE, GUEST_ID_MAX_AGE_SECONDS, MAX_GUEST_USAGE_ENTRIES,
  scanMode, clamavHost, clamavPort, scanTimeoutMs,
  TEST_ENTERPRISE_USER_KEYS, testEnterpriseForAllUsers, testEnforceEnterpriseAllowlist,
  testVerificationDebugMode,
  databaseEnabled,
  serverPort,
  splitConfigValues, parseBooleanEnv,
} from './server/config.js'

import {
  httpError, parseRecipients, firstHeader, firstValue,
  escapeHtml, createToken, hashSecret, parseJson, removeDirectory,
} from './server/lib/http.js'
`

// 保留原 135 行起的内容（跳过删除区间）。
// 注意：原第 15 行 loadEnvFile(...) 调用随头部删除 —— config.js 内部已完成加载。
const body = []
for (let i = 135; i <= lines.length; i++) {
  if (drop.has(i)) continue
  body.push(lines[i - 1])
}

const out = NEW_HEADER + body.join('\n')
fs.writeFileSync(target, out, 'utf8')
console.log('改写完成:', out.split('\n').length, '行（原', lines.length, '行）')
console.log('删除行数:', drop.size)
