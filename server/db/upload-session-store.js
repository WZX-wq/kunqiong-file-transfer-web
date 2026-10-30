import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import { UPLOAD_SESSION_TTL_MS } from '../config.js'
import { keyedDigest, protectCredential, revealCredential } from '../lib/private-key.js'

export const UPLOAD_SESSION_TABLE = 'kq_upload_session'
const UPLOAD_SESSION_MIGRATION_KEY = '003-upload-session-storage'
const UPLOAD_SESSION_SCHEMA_LOCK = 'kunqiong-upload-session-schema-v1'

export const UPLOAD_SESSION_TABLE_SQL = `CREATE TABLE IF NOT EXISTS \`kq_upload_session\` (
  \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '内部主键',
  \`session_digest\` CHAR(64) COLLATE utf8mb4_bin NOT NULL COMMENT '上传会话ID的HMAC摘要',
  \`manifest_ciphertext\` LONGTEXT COLLATE utf8mb4_bin NOT NULL COMMENT 'AES-GCM加密的会话JSON清单',
  \`expires_at\` DATETIME(3) NOT NULL COMMENT '会话过期时间',
  \`gmt_create\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  \`gmt_modified\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uk_upload_session_digest\` (\`session_digest\`),
  KEY \`idx_upload_session_expiry\` (\`expires_at\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='可恢复上传会话'`

const REQUIRED_COLUMNS = {
  id: 'bigint unsigned',
  session_digest: 'char(64)',
  manifest_ciphertext: 'longtext',
  expires_at: 'datetime(3)',
  gmt_create: 'datetime(3)',
  gmt_modified: 'datetime(3)',
}
const REQUIRED_INDEXES = ['PRIMARY', 'uk_upload_session_digest', 'idx_upload_session_expiry']
const SAFE_SESSION_ID = /^[A-Za-z0-9_-]{12,96}$/

function assertManifest(manifest, directoryId) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
    || !SAFE_SESSION_ID.test(String(manifest.id || ''))
    || (directoryId && manifest.id !== directoryId)
    || !Array.isArray(manifest.files)
    || !Number.isFinite(Number(manifest.chunkSize))
    || !Number.isFinite(new Date(manifest.createdAt).getTime())) {
    throw new Error('上传会话清单格式无效，已保留原始数据并停止迁移')
  }
  return manifest
}

function sessionDigest(id) {
  return keyedDigest(`upload-session:${id}`)
}

function mysqlDate(value) {
  return new Date(value).toISOString().slice(0, 23).replace('T', ' ')
}

export async function ensureUploadSessionTable(pool) {
  const connection = await pool.getConnection()
  let locked = false
  try {
    const [locks] = await connection.execute('SELECT GET_LOCK(?, 30) AS acquired', [UPLOAD_SESSION_SCHEMA_LOCK])
    if (Number(locks?.[0]?.acquired) !== 1) throw new Error('无法获得上传会话表结构迁移锁')
    locked = true

    const [migrationTables] = await connection.execute(
      'SELECT COUNT(*) AS found FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
      ['kq_schema_migration'],
    )
    const migrationTableExists = Number(migrationTables?.[0]?.found) > 0
    let appliedChecksum = null
    if (migrationTableExists) {
      const [migrations] = await connection.execute(
        'SELECT checksum_sha256 FROM kq_schema_migration WHERE migration_key = ? LIMIT 1',
        [UPLOAD_SESSION_MIGRATION_KEY],
      )
      appliedChecksum = migrations?.[0]?.checksum_sha256 || null
      const expectedChecksum = crypto.createHash('sha256').update(UPLOAD_SESSION_TABLE_SQL).digest('hex')
      if (appliedChecksum && appliedChecksum !== expectedChecksum) {
        throw new Error('上传会话表迁移 checksum 不匹配，请新增迁移版本')
      }
    }

    const [existingTables] = await connection.execute(
      'SELECT COUNT(*) AS found FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
      [UPLOAD_SESSION_TABLE],
    )
    const tableExists = Number(existingTables?.[0]?.found) > 0
    if (appliedChecksum && !tableExists) throw new Error('已登记的上传会话迁移表缺失，已停止启动')
    if (!appliedChecksum) await connection.query(UPLOAD_SESSION_TABLE_SQL)

    const [columns] = await connection.execute(
      'SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
      [UPLOAD_SESSION_TABLE],
    )
    const actualColumns = Object.fromEntries(columns.map(column => [column.COLUMN_NAME, String(column.COLUMN_TYPE).toLowerCase()]))
    if (Object.keys(actualColumns).length !== Object.keys(REQUIRED_COLUMNS).length
      || Object.entries(REQUIRED_COLUMNS).some(([name, type]) => actualColumns[name] !== type)) {
      throw new Error('现有 kq_upload_session 字段与项目定义不一致，已停止启动')
    }
    const [indexes] = await connection.execute(
      'SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
      [UPLOAD_SESSION_TABLE],
    )
    const actualIndexes = indexes.map(row => row.INDEX_NAME).sort()
    if (JSON.stringify(actualIndexes) !== JSON.stringify([...REQUIRED_INDEXES].sort())) {
      throw new Error('现有 kq_upload_session 索引与项目定义不一致，已停止启动')
    }
    const [tables] = await connection.execute(
      'SELECT ENGINE, TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
      [UPLOAD_SESSION_TABLE],
    )
    if (tables[0]?.ENGINE !== 'InnoDB' || tables[0]?.TABLE_COLLATION !== 'utf8mb4_unicode_ci') {
      throw new Error('kq_upload_session 必须使用 InnoDB 和 utf8mb4_unicode_ci')
    }
    if (migrationTableExists && !appliedChecksum) {
      await connection.execute(
        'INSERT INTO kq_schema_migration (migration_key, checksum_sha256, applied_at) VALUES (?, ?, UTC_TIMESTAMP(3))',
        [UPLOAD_SESSION_MIGRATION_KEY, crypto.createHash('sha256').update(UPLOAD_SESSION_TABLE_SQL).digest('hex')],
      )
    }
  } finally {
    if (locked) {
      try { await connection.execute('SELECT RELEASE_LOCK(?)', [UPLOAD_SESSION_SCHEMA_LOCK]) } catch {}
    }
    connection.release()
  }
}

export class MySqlUploadSessionStore {
  constructor(executor, { tableName = UPLOAD_SESSION_TABLE } = {}) {
    if (!/^[a-z0-9_]+$/.test(tableName)) throw new TypeError('上传会话表名无效')
    this.executor = executor
    this.table = `\`${tableName}\``
  }

  async save(manifest, { insertOnly = false } = {}) {
    assertManifest(manifest)
    const digest = sessionDigest(manifest.id)
    const encrypted = protectCredential(JSON.stringify(manifest), `upload-session:${digest}`)
    const expiresAt = new Date(new Date(manifest.createdAt).getTime() + UPLOAD_SESSION_TTL_MS)
    const insert = `INSERT ${insertOnly ? 'IGNORE ' : ''}INTO ${this.table}
      (session_digest, manifest_ciphertext, expires_at) VALUES (?, ?, ?)`
    const sql = insertOnly
      ? insert
      : `${insert} ON DUPLICATE KEY UPDATE manifest_ciphertext = VALUES(manifest_ciphertext), expires_at = VALUES(expires_at), gmt_modified = CURRENT_TIMESTAMP(3)`
    const [result] = await this.executor.execute(sql, [digest, encrypted, mysqlDate(expiresAt)])
    return { inserted: Number(result.affectedRows) === 1 }
  }

  async loadAll() {
    const [rows] = await this.executor.query(`SELECT session_digest, manifest_ciphertext FROM ${this.table} ORDER BY id`)
    return rows.map(row => {
      let manifest
      try {
        manifest = JSON.parse(revealCredential(row.manifest_ciphertext, `upload-session:${row.session_digest}`))
      } catch {
        throw new Error('MySQL 上传会话清单损坏，已停止恢复')
      }
      if (sessionDigest(manifest?.id) !== row.session_digest) throw new Error('MySQL 上传会话摘要校验失败，已停止恢复')
      return assertManifest(manifest)
    })
  }

  async delete(id) {
    const [result] = await this.executor.execute(`DELETE FROM ${this.table} WHERE session_digest = ?`, [sessionDigest(id)])
    return Number(result.affectedRows) > 0
  }

  async deleteExpired(now = Date.now()) {
    const [result] = await this.executor.execute(`DELETE FROM ${this.table} WHERE expires_at <= ?`, [mysqlDate(now)])
    return Number(result.affectedRows) || 0
  }
}

export async function importLegacyUploadSessionManifests(root, store) {
  let entries
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return 0
    throw error
  }

  let imported = 0
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const directory = path.join(root, entry.name)
    const filename = path.join(directory, 'session.json')
    if (!fs.existsSync(filename)) continue
    let manifest
    try {
      manifest = JSON.parse(await fs.promises.readFile(filename, 'utf8'))
    } catch (error) {
      throw new Error(`旧上传会话 ${entry.name} 的 JSON 清单无法解析，原文件已保留，已停止迁移`, { cause: error })
    }
    assertManifest(manifest, entry.name)
    const result = await store.save(manifest, { insertOnly: true })
    if (result.inserted) imported += 1
  }
  return imported
}
