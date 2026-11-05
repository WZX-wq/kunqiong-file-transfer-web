import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import crypto from 'node:crypto'
import express from 'express'
import mysql from 'mysql2/promise'

// An explicitly selected loopback fixture only; never inherit the application's DB.
const port = Number(process.env.KUNQIONG_TEST_DB_PORT || 0)
process.env.KUNQIONG_DB_ENABLED = port ? 'true' : 'false'
process.env.KUNQIONG_DB_HOST = '127.0.0.1'
process.env.KUNQIONG_DB_PORT = String(port || 3306)
process.env.KUNQIONG_DB_NAME = 'unused_notice_fixture'
process.env.KUNQIONG_DB_USER = 'root'
process.env.KUNQIONG_DB_PASSWORD = ''
process.env.KUNQIONG_DATA_KEY = 'ab'.repeat(32)
const { applyRelationalSchema } = await import('../../server/db/apply-relational-schema.js')
const { ensureRelationalStoreSchema, initializeRelationalMetadata } = await import('../../server/db/relational-store.js')
const { migrateOnDemandSchema } = await import('../../server/db/on-demand-schema.js')
const { normalizeMetadata, normalizeNotificationSettings } = await import('../../server/lib/metadata-normalizers.js')
const { relationalDataMiddleware } = await import('../../server/lib/relational-request.js')
const { registerAccountRoutes } = await import('../../server/routes/account.js')
const { flushMetadataWrites } = await import('../../server/lib/metadata-store.js')
const { databasePool, databaseAuthPool, databaseMaintenancePool } = await import('../../server/state.js')

test('notification preference HTTP reads and writes use the existing MySQL row', { skip: !port, timeout: 30000 }, async t => {
  assert.ok(port >= 1024 && port <= 65535)
  t.after(() => Promise.all([databasePool, databaseAuthPool, databaseMaintenancePool].filter(Boolean).map(pool => pool.end())))
  const database = `kunqiong_notice_test_${crypto.randomBytes(6).toString('hex')}`
  const admin = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root' })
  await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
  const pool = mysql.createPool({ host: '127.0.0.1', port, user: 'root', database, timezone: 'Z' })
  t.after(async () => { await pool.end(); await admin.query(`DROP DATABASE \`${database}\``); await admin.end() })
  const schemaSql = fs.readFileSync(new URL('../../docs/数据库设计-2026-10-29/03-现有功能关系表设计.sql', import.meta.url), 'utf8')
  await applyRelationalSchema({ pool, schemaSql })
  await ensureRelationalStoreSchema(pool)
  const now = new Date().toISOString(), expiresAt = new Date(Date.now() + 86400000).toISOString()
  const expected = normalizeNotificationSettings({ email: false, shareDownloaded: false, collectionSubmitted: false })
  await initializeRelationalMetadata(pool, normalizeMetadata({
    users: { alice: { id: 'alice', username: 'alice', email: 'alice@example.test', status: 'active', createdAt: now, fileCleanup: { enabled: true, days: 7 } },
      bob: { id: 'bob', username: 'bob', status: 'active', createdAt: now } },
    sessions: ['alice', 'bob'].map(id => ({ id: `${id}-token`, user: { id }, expiresAt, createdAt: now })),
    notificationSettings: { alice: expected },
  }))
  await migrateOnDemandSchema(pool)
  const queries = []
  const recording = new Proxy(pool, { get(target, key) {
    if (key === 'query') return (sql, params) => { queries.push(typeof sql === 'string' ? sql : sql.sql); return target.query(sql, params) }
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value
  } })
  const app = express()
  app.use(express.json(), relationalDataMiddleware(recording))
  // As in server.mjs, send success only after the request's real transaction finishes.
  app.use((_req, res, next) => {
    const json = res.json.bind(res)
    res.json = body => {
      void flushMetadataWrites().then(() => json(body), error => {
        res.status(error.status || 503)
        json({ message: error.message, code: error.code })
      })
      return res
    }
    next()
  })
  registerAccountRoutes(app)
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ message: error.message, code: error.code }))
  const server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)) })
  t.after(() => new Promise(resolve => server.close(resolve)))
  const request = async (method = 'GET', settings, user = 'alice') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/account/notification-settings`, {
      method, headers: { cookie: `kunqiong_session=${user}-token`, 'content-type': 'application/json' },
      ...(settings ? { body: JSON.stringify({ settings }) } : {}), signal: AbortSignal.timeout(5000),
    })
    const data = await response.json()
    assert.equal(response.status, 200, JSON.stringify(data))
    return data.settings
  }
  await t.test('GET reads saved preferences without rewriting them', async () => {
    const [before] = await pool.query('SELECT write_version FROM kq_user_setting')
    assert.deepEqual(await request(), expected)
    assert.deepEqual((await pool.query('SELECT write_version FROM kq_user_setting'))[0], before)
    assert.ok(queries.some(sql => /FROM `kq_user_setting` WHERE user_id IN/.test(sql.replaceAll('`user_id`', 'user_id'))))
    assert.ok(queries.every(sql => !/kq_organization|kq_resource|kq_upgrade_order/.test(sql)), 'preferences do not load unrelated business data')
  })
  await t.test('enabling email preserves other switches and survives a fresh GET', async () => {
    expected.email = true
    assert.deepEqual(await request('PUT', { email: true }), expected)
    assert.deepEqual(await request(), expected)
    const [[row]] = await pool.query('SELECT file_cleanup_json FROM kq_user_setting')
    assert.deepEqual(typeof row.file_cleanup_json === 'string' ? JSON.parse(row.file_cleanup_json) : row.file_cleanup_json, { enabled: true, days: 7 })
  })
  await t.test('every notification switch can be toggled and restored repeatedly', async () => {
    for (const key of Object.keys(expected)) {
      for (let change = 0; change < 2; change++) {
        expected[key] = !expected[key]
        assert.deepEqual(await request('PUT', { [key]: expected[key] }), expected)
        assert.deepEqual(await request(), expected)
      }
    }
  })
  await t.test('first save creates one row for an account with no preferences', async () => {
    const settings = normalizeNotificationSettings({ email: true })
    assert.deepEqual(await request('PUT', { email: true }, 'bob'), settings)
    assert.deepEqual(await request('PUT', { email: true }, 'bob'), settings)
    const [[count]] = await pool.query('SELECT COUNT(*) AS total FROM kq_user_setting')
    assert.equal(Number(count.total), 2)
    assert.deepEqual(await request(), expected, 'another account cannot change Alice preferences')
  })
})
