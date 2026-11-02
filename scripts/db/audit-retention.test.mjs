import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import crypto from 'node:crypto'
import mysql from 'mysql2/promise'

// Only an explicitly selected loopback fixture. Never inherit .env or touch 3306.
process.env.KUNQIONG_DB_ENABLED = 'false'
process.env.KUNQIONG_DATA_KEY ||= 'ab'.repeat(32)
const { applyRelationalSchema } = await import('../../server/db/apply-relational-schema.js')
const { DatabaseAuditStore } = await import('../../server/lib/audit-store.js')
const { normalizeAuditLog } = await import('../../server/lib/audit-normalizer.js')

const port = Number(process.env.KUNQIONG_TEST_DB_PORT || 0)
// Same convention as the other scripts/db fixtures: local root without a
// password. An explicit env override keeps remote/CI fixtures possible.
const password = process.env.KUNQIONG_TEST_DB_PASSWORD ?? ''

const toDateTime = value => new Date(value).toISOString().slice(0, 23).replace('T', ' ')

async function createFixture(t) {
  const name = `kq_audit_test_${crypto.randomBytes(6).toString('hex')}`
  assert.match(name, /^kq_audit_test_[a-f0-9]+$/)
  const admin = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password })
  await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
  const pool = mysql.createPool({ host: '127.0.0.1', port, user: 'root', password, database: name, connectionLimit: 4, timezone: 'Z' })
  t.after(async () => {
    await pool.end()
    await admin.query(`DROP DATABASE IF EXISTS \`${name}\``)
    await admin.end()
  })
  const schemaSql = fs.readFileSync(new URL('../../docs/数据库设计-2026-10-29/03-现有功能关系表设计.sql', import.meta.url), 'utf8')
  await applyRelationalSchema({ pool, schemaSql })
  return pool
}

// Insert `events` rows with the given type, keeping gmt_create in the supplied
// order so "oldest first" is deterministic and independent of insertion order.
async function seedAudit(pool, prefix, events) {
  for (let offset = 0; offset < events.length; offset += 100) {
    const batch = events.slice(offset, offset + 100)
    await pool.query(
      `INSERT INTO kq_audit_log (legacy_id, event_type, action, gmt_create, gmt_modified) VALUES ${batch.map(() => '(?, ?, ?, ?, ?)').join(', ')}`,
      batch.flatMap(event => [`${prefix}-${event.id}`, event.type, 'fixture', toDateTime(event.createdAt), toDateTime(event.createdAt)]),
    )
  }
}

const countByType = async pool => {
  const [[row]] = await pool.query(`SELECT COUNT(*) AS total,
    SUM(event_type = 'access') AS access, SUM(event_type <> 'access') AS critical FROM kq_audit_log`)
  return { total: Number(row.total), access: Number(row.access), critical: Number(row.critical) }
}

test('audit retention trims the MySQL table to MAX_AUDIT_LOGS without touching critical events', { skip: !port, timeout: 120000 }, async t => {
  const pool = await createFixture(t)
  const limit = 200
  const base = Date.now() - 3_600_000
  const critical = Array.from({ length: 80 }, (_, index) => ({ id: `critical-${index}`, type: 'security', createdAt: base - 1_000_000 - index * 1000 }))
  const access = Array.from({ length: 170 }, (_, index) => ({ id: `access-${index}`, type: 'access', createdAt: base + index * 1000 }))
  await seedAudit(pool, 'retention', [...critical, ...access])
  assert.deepEqual(await countByType(pool), { total: 250, access: 170, critical: 80 })

  const store = new DatabaseAuditStore(pool, normalizeAuditLog, limit)
  assert.equal(await store.trimToLimit(), 50)
  assert.deepEqual(await countByType(pool), { total: 200, access: 120, critical: 80 })

  // The 50 oldest access events are the ones removed; every critical event —
  // even the ones older than all access rows — is retained.
  const [remainingAccess] = await pool.query(`SELECT legacy_id FROM kq_audit_log WHERE event_type = 'access' ORDER BY gmt_create ASC`)
  assert.equal(remainingAccess[0].legacy_id, 'retention-access-50')
  assert.equal(remainingAccess.at(-1).legacy_id, 'retention-access-169')
  const [[oldestCritical]] = await pool.query(`SELECT legacy_id FROM kq_audit_log WHERE event_type <> 'access' ORDER BY gmt_create ASC LIMIT 1`)
  assert.equal(oldestCritical.legacy_id, 'retention-critical-79')

  // A second run is a no-op and must never throw.
  assert.equal(await store.trimToLimit(), 0)
  assert.deepEqual(await countByType(pool), { total: 200, access: 120, critical: 80 })
})

test('audit retention batches access deletes and only then removes oldest critical events', { skip: !port, timeout: 120000 }, async t => {
  const pool = await createFixture(t)
  const batches = []
  const recorder = {
    execute: (...args) => pool.execute(...args),
    query: (sql, params) => {
      if (/^DELETE FROM kq_audit_log/.test(sql)) batches.push(sql)
      return pool.query(sql, params)
    },
  }
  const base = Date.now() - 7_200_000
  const access = Array.from({ length: 1200 }, (_, index) => ({ id: `a-${index}`, type: 'access', createdAt: base + index * 1000 }))
  const critical = Array.from({ length: 50 }, (_, index) => ({ id: `c-${index}`, type: 'security', createdAt: base - 1_000_000 - index * 1000 }))
  await seedAudit(pool, 'batch', [...critical, ...access])

  // limit 100 of 1250 → trim 1150. That needs two batches (1000 + 150) and
  // exhausts all 1200 access rows before touching critical history.
  const store = new DatabaseAuditStore(recorder, normalizeAuditLog, 100)
  assert.equal(await store.trimToLimit(), 1150)
  assert.deepEqual(await countByType(pool), { total: 100, access: 50, critical: 50 })
  assert.equal(batches.length, 2)
  assert.match(batches[0], /event_type = 'access'/)
  assert.match(batches[0], /LIMIT 1000$/)
  assert.match(batches[1], /event_type = 'access'/)
  assert.match(batches[1], /LIMIT 150$/)
  assert.equal(await store.trimToLimit(), 0)
})

test('audit retention falls back to oldest critical events when access rows are exhausted', { skip: !port, timeout: 120000 }, async t => {
  const pool = await createFixture(t)
  const base = Date.now() - 3_600_000
  const access = Array.from({ length: 50 }, (_, index) => ({ id: `a-${index}`, type: 'access', createdAt: base + index * 1000 }))
  const critical = Array.from({ length: 200 }, (_, index) => ({ id: `c-${index}`, type: 'business', createdAt: base + 1_000_000 + index * 1000 }))
  await seedAudit(pool, 'fallback', [...access, ...critical])
  const store = new DatabaseAuditStore(pool, normalizeAuditLog, 100)
  // 250 rows, limit 100 → remove 50 access + 100 oldest critical.
  assert.equal(await store.trimToLimit(), 150)
  assert.deepEqual(await countByType(pool), { total: 100, access: 0, critical: 100 })
  const [[firstKept]] = await pool.query('SELECT legacy_id FROM kq_audit_log ORDER BY gmt_create ASC LIMIT 1')
  assert.equal(firstKept.legacy_id, 'fallback-c-100')
})

test('audit retention is a safe no-op when the structured table is absent', { skip: !port, timeout: 120000 }, async t => {
  const pool = await createFixture(t)
  await pool.query('DROP TABLE kq_audit_log')
  const store = new DatabaseAuditStore(pool, normalizeAuditLog, 10)
  assert.equal(await store.trimToLimit(), 0)
  assert.equal(await store.trimToLimit(), 0)
})
