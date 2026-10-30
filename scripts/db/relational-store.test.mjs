import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildRelationalModel, synchronizeRelationalMetadata } from '../../server/db/relational-store.js'
import { inspectRelationalSchemaSql } from '../../server/db/relational-schema.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const schemaPath = path.join(projectRoot, 'docs', '数据库设计-2026-10-29', '03-现有功能关系表设计.sql')
const managedTables = inspectRelationalSchemaSql(fs.readFileSync(schemaPath, 'utf8'))
  .map(table => table.name)
  .filter(table => table !== 'kq_audit_log')

test('maps every metadata domain to its owning relational record set', () => {
  const source = {
    users: { u1: { id: 'u1' } },
    organizations: { o1: { id: 'o1', members: [{ id: 'm1' }] } },
    shares: [{ id: 's1', files: [{ id: 'f1' }] }],
    collections: [{ id: 'c1', submissions: [{ id: 'sub1' }] }],
    distributions: [{ id: 'd1' }],
    sessions: [{ id: 'session1' }],
    verificationCodes: [{ id: 'v1' }],
    upgradeOrders: [{ id: 'order1' }],
    messages: { u1: [{ id: 'message1' }] },
    notificationSettings: { u1: { email: true } },
    records: { u1: [{ id: 'record1' }] },
    guestUsage: { 'ip:127.0.0.1': { bytes: 42 } },
    systemConfig: { maxBatchFiles: 12 },
    collectionTemplates: [{ id: 'template1' }],
    extensionState: { retained: true },
  }

  const model = buildRelationalModel(source)
  assert.deepEqual(model.users, [{ id: 'u1' }])
  assert.deepEqual(model.organizations, [{ id: 'o1', members: [{ id: 'm1' }] }])
  assert.deepEqual(model.resources.map(row => [row.kind, row.entity.id]), [['share', 's1'], ['collection', 'c1']])
  assert.deepEqual(model.distributions, source.distributions)
  assert.deepEqual(model.sessions, source.sessions)
  assert.deepEqual(model.verificationCodes, source.verificationCodes)
  assert.deepEqual(model.upgradeOrders, source.upgradeOrders)
  assert.deepEqual(model.messages, [{ userId: 'u1', entity: { id: 'message1' } }])
  assert.deepEqual(model.notificationSettings, [{ userId: 'u1', entity: { email: true } }])
  assert.deepEqual(model.records, [{ userId: 'u1', entity: { id: 'record1' } }])
  assert.deepEqual(model.guestUsage, [{ key: 'ip:127.0.0.1', entity: { bytes: 42 } }])
  assert.deepEqual(model.systemSettings, [
    { key: 'systemConfig', value: source.systemConfig },
    { key: 'collectionTemplates', value: source.collectionTemplates },
    { key: 'legacyExtraMetadata', value: { extensionState: { retained: true } } },
  ])
})

test('uses empty relational sets for absent and malformed optional domains', () => {
  const model = buildRelationalModel({ users: [], messages: null, records: 'invalid', guestUsage: [] })
  assert.equal(model.users.length, 0)
  assert.equal(model.messages.length, 0)
  assert.equal(model.records.length, 0)
  assert.equal(model.guestUsage.length, 0)
  assert.deepEqual(model.resources, [])
})

test('cached relational sync skips table reads and performs no writes for an unchanged model', async () => {
  const counts = Object.fromEntries(managedTables.map(table => [table, 0]))
  const cachedRows = new Map(managedTables.map(table => [table, new Map()]))
  let tableReads = 0
  let writes = 0
  let nextId = 1
  const connection = {
    async query() {
      tableReads += 1
      throw new Error('cached sync must not read tables')
    },
    async execute() {
      writes += 1
      return [{ insertId: nextId++ }, []]
    },
  }

  const first = await synchronizeRelationalMetadata(connection, {}, counts, cachedRows)
  assert.equal(tableReads, 0)
  assert.equal(first.changes.inserted, 3)
  assert.equal(first.counts.kq_system_setting, 3)
  const writesAfterInsert = writes

  const second = await synchronizeRelationalMetadata(connection, {}, first.counts, first.syncCache)
  assert.equal(tableReads, 0)
  assert.equal(writes, writesAfterInsert)
  assert.equal(second.changes.updated + second.changes.inserted + second.changes.deleted, 0)
  assert.equal(second.changes.unchanged, 3)
})

test('account record replay ignores the database-managed modification timestamp', async () => {
  const counts = Object.fromEntries(managedTables.map(table => [table, 0]))
  const cachedRows = new Map(managedTables.map(table => [table, new Map()]))
  let nextId = 1
  let writes = 0
  let lastUpdate = ''
  const connection = {
    async query() { throw new Error('cached sync must not read tables') },
    async execute(sql) {
      writes += 1
      if (sql.startsWith('UPDATE')) lastUpdate = sql
      return [{ insertId: nextId++ }, []]
    },
  }
  const metadata = {
    users: { u1: { id: 'u1', username: 'u1', createdAt: '2026-10-29T12:00:00.000Z', updatedAt: '2026-10-29T12:00:00.000Z' } },
    records: { u1: [{ id: 'r1', name: 'Original', createdAt: '2026-10-29T12:00:00.000Z', updatedAt: '2026-10-29T12:00:00.000Z' }] },
  }

  const initial = await synchronizeRelationalMetadata(connection, metadata, counts, cachedRows)
  const recordRows = initial.syncCache.get('kq_account_record')
  const [recordKey, recordRow] = [...recordRows.entries()][0]
  recordRows.set(recordKey, { ...recordRow, gmt_modified: '2099-01-01 00:00:00.000' })
  const initialWrites = writes

  const replay = await synchronizeRelationalMetadata(connection, metadata, initial.counts, initial.syncCache)
  assert.equal(writes, initialWrites)
  assert.equal(replay.changes.updated + replay.changes.inserted + replay.changes.deleted, 0)

  const changed = structuredClone(metadata)
  changed.records.u1[0].name = 'Updated'
  changed.records.u1[0].updatedAt = '2026-10-29T13:00:00.000Z'
  const updated = await synchronizeRelationalMetadata(connection, changed, replay.counts, replay.syncCache)
  assert.equal(updated.changes.byTable.kq_account_record.updated, 1)
  assert.ok(!lastUpdate.includes('`gmt_modified`'), 'updates must let MySQL maintain gmt_modified automatically')
})
