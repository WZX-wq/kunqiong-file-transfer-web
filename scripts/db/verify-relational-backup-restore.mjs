import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import mysql from 'mysql2/promise'
import {
  databaseEnabled, databaseHost, databaseName, databasePassword, databasePort, databaseUser, projectRoot,
  relationalSchemaEnabled,
} from '../../server/config.js'
import { applyRelationalSchema } from '../../server/db/apply-relational-schema.js'
import { ensureRelationalStoreSchema, initializeRelationalMetadata, loadRelationalMetadataFromConnection, readRelationalState } from '../../server/db/relational-store.js'

if (!databaseEnabled || !relationalSchemaEnabled || !databasePoolReady()) {
  throw new Error('Enable local MySQL relational mode in .env before running this verification')
}

function databasePoolReady() {
  return Boolean(databaseHost && databaseName && databaseUser)
}

const suffix = crypto.randomBytes(6).toString('hex')
const sourceDatabase = `kq_restore_drill_${suffix}`
const restoredDatabase = `${sourceDatabase}_copy`
const schemaPath = path.join(projectRoot, 'docs', '数据库设计-2026-10-29', '03-现有功能关系表设计.sql')
const schemaSql = await fs.readFile(schemaPath, 'utf8')
let dumpDirectory = null
let dumpPath = null
const adminUser = process.env.KQ_TEST_DB_ADMIN_USER || databaseUser
const adminPassword = process.env.KQ_TEST_DB_ADMIN_PASSWORD ?? databasePassword
const environment = { ...process.env, MYSQL_PWD: adminPassword }
let admin = null
let sourceCreated = false
let restoredCreated = false
let sourcePool = null
let restoredPool = null

function runMysqlTool(command, args, options = {}) {
  const result = spawnSync(command, args, {
    env: environment,
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const details = String(result.stderr || result.stdout || '').trim()
    throw new Error(`${command} failed with status ${result.status}${details ? `: ${details}` : ''}`)
  }
  return result
}

function poolFor(database) {
  return mysql.createPool({
    host: databaseHost,
    port: databasePort,
    database,
    user: adminUser,
    password: adminPassword,
    waitForConnections: true,
    connectionLimit: 2,
    charset: 'utf8mb4',
  })
}

try {
  dumpDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'kq-restore-drill-'))
  dumpPath = path.join(dumpDirectory, 'relational-fixture.sql')
  admin = await mysql.createConnection({ host: databaseHost, port: databasePort, user: adminUser, password: adminPassword })
  const [existing] = await admin.execute(
    'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME IN (?, ?)',
    [sourceDatabase, restoredDatabase],
  )
  assert.equal(existing.length, 0, 'randomly named scratch database already exists')
  await admin.query(`CREATE DATABASE \`${sourceDatabase}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
  sourceCreated = true
  await admin.query(`CREATE DATABASE \`${restoredDatabase}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
  restoredCreated = true

  sourcePool = poolFor(sourceDatabase)
  await applyRelationalSchema({ pool: sourcePool, schemaSql })
  await ensureRelationalStoreSchema(sourcePool)
  await initializeRelationalMetadata(sourcePool, {
    users: {
      restore_drill_user: {
        id: 'restore_drill_user',
        username: 'restore-drill-user',
        nickname: 'Restore fixture',
        status: 'active',
        createdAt: '2026-10-29T00:00:00.000Z',
        updatedAt: '2026-10-29T00:00:00.000Z',
      },
    },
  }, 7)
  await sourcePool.end()
  sourcePool = null

  const dump = runMysqlTool('mysqldump', [
    '--single-transaction', '--skip-lock-tables', '--no-tablespaces',
    '--host', databaseHost, '--port', String(databasePort), '--user', adminUser,
    sourceDatabase,
  ])
  await fs.writeFile(dumpPath, dump.stdout)

  restoredPool = poolFor(restoredDatabase)
  runMysqlTool('mysql', [
    '--host', databaseHost, '--port', String(databasePort), '--user', adminUser,
    restoredDatabase,
  ], { input: dump.stdout })

  const connection = await restoredPool.getConnection()
  try {
    const state = await readRelationalState(connection)
    const restored = await loadRelationalMetadataFromConnection(connection, state)
    assert.equal(state.sourceSnapshotRevision, 7)
    assert.equal(restored.metadata.users.restore_drill_user.nickname, 'Restore fixture')
    assert.equal(restored.state.counts.kq_user, 1)
  } finally {
    connection.release()
  }

  await restoredPool.end()
  restoredPool = null
  await admin.query('DROP DATABASE ' + sourceDatabase)
  sourceCreated = false
  await admin.query('DROP DATABASE ' + restoredDatabase)
  restoredCreated = false
  const [remaining] = await admin.execute(
    'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME IN (?, ?)',
    [sourceDatabase, restoredDatabase],
  )
  assert.equal(remaining.length, 0, 'scratch databases were not cleaned up')

  process.stdout.write(`${JSON.stringify({
    ok: true,
    mode: 'isolated synthetic MySQL database dump and restore',
    sourceSnapshotRevision: 7,
    restoredUserCount: 1,
    dumpBytes: dump.stdout.length,
    businessRowsValidated: true,
    sourceAndRestoreDatabasesDropped: true,
  })}\n`)
} finally {
  if (sourcePool) await sourcePool.end().catch(() => {})
  if (restoredPool) await restoredPool.end().catch(() => {})
  if (admin && sourceCreated) await admin.query(`DROP DATABASE IF EXISTS \`${sourceDatabase}\``).catch(() => {})
  if (admin && restoredCreated) await admin.query(`DROP DATABASE IF EXISTS \`${restoredDatabase}\``).catch(() => {})
  if (admin) await admin.end().catch(() => {})
  if (dumpDirectory) await fs.rm(dumpDirectory, { recursive: true, force: true }).catch(() => {})
}
