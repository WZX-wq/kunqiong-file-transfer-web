import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import mysql from 'mysql2/promise'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const envPath = path.join(projectRoot, '.env')
const databaseName = 'kunqiong_file_transfer'
const databaseHost = '127.0.0.1'
const databasePort = 3306
const mysqlAdminPassword = process.env.KQ_LOCAL_MYSQL_PASSWORD || ''

if (!mysqlAdminPassword) {
  console.error('请通过当前进程环境变量 KQ_LOCAL_MYSQL_PASSWORD 提供本机 MySQL 管理员密码。')
  process.exit(2)
}

function readEnvValues(contents) {
  const values = new Map()
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    values.set(match[1], value)
  }
  return values
}

function updateEnvFile(contents, overrides) {
  const newline = contents.includes('\r\n') ? '\r\n' : '\n'
  const lines = contents.split(/\r?\n/)
  if (lines.at(-1) === '') lines.pop()
  const seen = new Set()
  const next = []
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/)
    const key = match?.[1]
    if (!Object.hasOwn(overrides, key)) {
      next.push(line)
      continue
    }
    if (seen.has(key)) continue
    next.push(`${key}=${overrides[key]}`)
    seen.add(key)
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (!seen.has(key)) next.push(`${key}=${value}`)
  }
  const temporaryPath = `${envPath}.db-setup-${process.pid}.tmp`
  fs.writeFileSync(temporaryPath, `${next.join(newline)}${newline}`, { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(temporaryPath, envPath)
}

const envContents = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : ''
const current = readEnvValues(envContents)
if (current.get('KUNQIONG_DB_NAME') && current.get('KUNQIONG_DB_NAME') !== databaseName) {
  throw new Error('项目已配置其他数据库名；为避免覆盖现有目标，本脚本停止。')
}

const existingDataKey = current.get('KUNQIONG_DATA_KEY') || ''
if (existingDataKey && !/^[a-f0-9]{64}$/i.test(existingDataKey)) {
  throw new Error('现有 KUNQIONG_DATA_KEY 格式无效；未修改数据库或环境配置。')
}
const privateKeyPath = path.join(projectRoot, 'storage', '.private-key')
let dataKey = existingDataKey
if (!dataKey && fs.existsSync(privateKeyPath)) {
  const privateKey = fs.readFileSync(privateKeyPath)
  if (privateKey.length !== 32) {
    throw new Error('现有 storage/.private-key 长度无效；未修改数据库或环境配置。')
  }
  dataKey = privateKey.toString('hex')
}
if (!dataKey) dataKey = crypto.randomBytes(32).toString('hex')
const appUser = current.get('KUNQIONG_DB_USER') || `kq_app_${crypto.randomBytes(4).toString('hex')}`
if (!/^[a-zA-Z0-9_]{1,32}$/.test(appUser)) throw new Error('现有 KUNQIONG_DB_USER 不符合 MySQL 用户名格式。')
const appPassword = current.get('KUNQIONG_DB_PASSWORD') || crypto.randomBytes(32).toString('hex')
if (!/^[a-f0-9]{64}$/i.test(appPassword)) throw new Error('现有 KUNQIONG_DB_PASSWORD 格式不安全；未修改数据库或环境配置。')

const admin = await mysql.createConnection({
  host: databaseHost,
  port: databasePort,
  user: 'root',
  password: mysqlAdminPassword,
  connectTimeout: 5000,
  charset: 'utf8mb4',
})

try {
  const [databaseRows] = await admin.execute(
    'SELECT COUNT(*) AS found FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?',
    [databaseName],
  )
  const databaseExists = Number(databaseRows?.[0]?.found) > 0
  if (databaseExists) {
    const [tableRows] = await admin.execute(
      'SELECT COUNT(*) AS total FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',
      [databaseName],
    )
    if (Number(tableRows?.[0]?.total) > 0) {
      throw new Error('目标数据库已包含表；为保护现有数据，本脚本不会修改该库。')
    }
  }

  const [accountRows] = await admin.execute(
    'SELECT Host FROM mysql.user WHERE User = ? AND Host IN (?, ?)',
    [appUser, '127.0.0.1', 'localhost'],
  )
  const existingHosts = new Set(accountRows.map(row => row.Host))
  if (existingHosts.size && !current.get('KUNQIONG_DB_USER')) {
    throw new Error('生成的本地应用账号已存在，请重新运行准备脚本。')
  }

  updateEnvFile(envContents, {
    KUNQIONG_DB_ENABLED: 'true',
    KUNQIONG_RELATIONAL_SCHEMA_ENABLED: 'true',
    KUNQIONG_DB_HOST: databaseHost,
    KUNQIONG_DB_PORT: String(databasePort),
    KUNQIONG_DB_NAME: databaseName,
    KUNQIONG_DB_USER: appUser,
    KUNQIONG_DB_PASSWORD: appPassword,
    KUNQIONG_DATA_KEY: dataKey,
  })

  await admin.query(`CREATE DATABASE IF NOT EXISTS \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
  for (const host of ['127.0.0.1', 'localhost']) {
    if (!existingHosts.has(host)) {
      await admin.query(`CREATE USER '${appUser}'@'${host}' IDENTIFIED BY '${appPassword}'`)
    }
    await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, CREATE TEMPORARY TABLES ON \`${databaseName}\`.* TO '${appUser}'@'${host}'`)
  }
} finally {
  await admin.end()
}

const applicationConnection = await mysql.createConnection({
  host: databaseHost,
  port: databasePort,
  database: databaseName,
  user: appUser,
  password: appPassword,
  connectTimeout: 5000,
  charset: 'utf8mb4',
})
try {
  await applicationConnection.query('SELECT 1')
} finally {
  await applicationConnection.end()
}

console.log(`本机数据库连接准备完成：${databaseName}，应用账号已验证；密钥已写入项目忽略的 .env。`)
console.log('下一步启动服务时会建关系表，并把现有 metadata.json / 审计日志迁入 MySQL。')
