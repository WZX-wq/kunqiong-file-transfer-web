import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import mysql from 'mysql2/promise'
import { spawnSync } from 'node:child_process'
import { gunzipSync } from 'node:zlib'
import { backupMysql } from './backup-mysql.mjs'

// This suite only uses an explicitly selected loopback fixture. Never inherit
// the application's .env database or create/drop a schema on a remote server.
process.env.KUNQIONG_DB_ENABLED = 'false'
process.env.KUNQIONG_DATA_KEY = 'ab'.repeat(32)
const { applyRelationalSchema } = await import('../../server/db/apply-relational-schema.js')
const { ensureRelationalStoreSchema, initializeRelationalMetadata, loadRelationalMetadata } = await import('../../server/db/relational-store.js')
const { migrateOnDemandSchema } = await import('../../server/db/on-demand-schema.js')
const { ensureUploadSessionTable } = await import('../../server/db/upload-session-store.js')
const { RelationalRequestStore } = await import('../../server/db/request-store.js')
const { normalizeMetadata, normalizeAuditLog } = await import('../../server/lib/metadata-normalizers.js')
const { relationalAuditWriter, RelationalAuditStore } = await import('../../server/db/request-audit-store.js')
const { metadata, persistMetadata, flushMetadataWrites } = await import('../../server/lib/metadata-store.js')
const { createRelationalContext } = await import('../../server/lib/relational-request.js')
const { runWithDataContext } = await import('../../server/lib/data-context.js')
const { cleanupTarget, drainCleanup } = await import('../../server/db/cleanup-outbox.js')
const { removeStoredFiles } = await import('../../server/lib/file-storage.js')
const { removeDirectory } = await import('../../server/lib/http.js')
const { decodeProtected } = await import('../../server/db/relational-store.js')
const { cleanupDatabaseOrphans } = await import('../../server/lib/database-cleanup.js')
const { storageOwnerDirectoryName } = await import('../../server/lib/file-storage.js')

const port = Number(process.env.KUNQIONG_TEST_DB_PORT || 0)
test('request-scoped relational persistence against isolated MySQL', { skip: !port, timeout: 60000 }, async t => {
  assert.ok(port >= 1024 && port <= 65535)
  const name = `kunqiong_demand_test_${crypto.randomBytes(6).toString('hex')}`
  assert.match(name, /^kunqiong_demand_test_[a-f0-9]+$/)
  const admin = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root' })
  await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
  const pool = mysql.createPool({ host: '127.0.0.1', port, user: 'root', database: name, connectionLimit: 8, timezone: 'Z' })
  t.after(async () => { await pool.end(); await admin.query(`DROP DATABASE \`${name}\``); await admin.end() })
  const schemaSql = fs.readFileSync(new URL('../../docs/数据库设计-2026-10-29/03-现有功能关系表设计.sql', import.meta.url), 'utf8')
  await applyRelationalSchema({ pool, schemaSql })
  await ensureRelationalStoreSchema(pool)
  const now = new Date().toISOString(), future = new Date(Date.now() + 86400000).toISOString()
  const seed = normalizeMetadata({
    users: { alice: { id: 'alice', username: 'alice', nickname: 'Alice', avatar: 'https://avatar.example.test/alice.png', providerAvatar: 'https://avatar.example.test/alice.png', status: 'active', planId: 'member', createdAt: now }, bob: { id: 'bob', username: 'bob', nickname: 'Bob', status: 'active', planId: 'member', createdAt: now } },
    sessions: [{ id: 'alice-token', user: { id: 'alice', username: 'alice' }, expiresAt: future, createdAt: now }, { id: 'bob-token', user: { id: 'bob', username: 'bob' }, expiresAt: future, createdAt: now }],
    shares: ['alice', 'bob'].map((id, index) => ({ id: `${id}-share`, ownerUserId: id, manageToken: `${id}-manage`, code: `TEST${index}`, status: 'active', createdAt: now, expiresAt: future, downloadCount: 0, files: [{ name: 'file.txt', storedName: `${id}.txt`, storageOwnerId: id, size: 12, mimeType: 'text/plain' }] })),
    messages: { alice: [{ id: 'a-message', title: 'A', body: 'A', unread: true, createdAt: now }], bob: [{ id: 'b-message', title: 'B', body: 'B', unread: true, createdAt: now }] },
    records: { alice: [{ id: 'my_sent:share:alice-share', kind: 'share', scope: 'my_sent', shareId: 'alice-share', createdAt: now }], bob: [{ id: 'my_sent:share:bob-share', kind: 'share', scope: 'my_sent', shareId: 'bob-share', createdAt: now }] },
    systemConfig: { entitlementsVersion: 1, maxBatchFiles: 10 },
    guestUsage: { 'fixture-guest': { bytes: 9, uploads: 2, firstAt: now, lastAt: now } },
  })
  await initializeRelationalMetadata(pool, seed)
  // Interrupt after some aggregates have committed, then resume the migration.
  let interrupted = false
  const flakyMigration = new Proxy(pool, { get(target, key) {
    if (key === 'getConnection') return async () => {
      const connection = await target.getConnection()
      return new Proxy(connection, { get(client, method) {
        if (method === 'query') return (sql, params) => {
          if (!interrupted && /^SELECT id FROM `kq_user` WHERE/.test(sql) && Number(params?.[0]) > 0) {
            interrupted = true; throw new Error('fixture migration interruption')
          }
          return client.query(sql, params)
        }
        const value = client[method]; return typeof value === 'function' ? value.bind(client) : value
      } })
    }
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value
  } })
  await assert.rejects(migrateOnDemandSchema(flakyMigration), /fixture migration interruption/)
  await migrateOnDemandSchema(pool)
  assert.equal((await migrateOnDemandSchema(pool)).alreadyApplied, true)
  const migrated = (await loadRelationalMetadata(pool)).metadata
  for (const domain of ['users', 'shares', 'sessions', 'records', 'messages', 'guestUsage']) assert.deepEqual(migrated[domain], seed[domain], `migration round trip: ${domain}`)
  await ensureUploadSessionTable(pool)

  await t.test('session lookup never reads resources, other users or local JSON', async () => {
    const queries = []
    const recording = { query(sql, params) { queries.push(sql); return pool.query(sql, params) } }
    const scope = new RelationalRequestStore(recording)
    await scope.session('alice-token')
    assert.deepEqual(Object.keys(scope.data.users), ['alice'])
    assert.equal(scope.data.sessions.length, 1)
    assert.equal(scope.data.shares.length, 0)
    assert.equal(queries.length, 2, 'cold access reads a live session and the versioned user payload')
    await scope.session('alice-token')
    assert.equal(queries.length, 3, 'warm access still verifies the live session with one SQL round trip')
    assert.ok(queries.every(sql => /WHERE/.test(sql.sql || sql)))
    assert.ok(queries.every(sql => !/kq_resource|kunqiong_app_state/.test(sql.sql || sql)))
  })

  await t.test('identity projection omits all encrypted snapshots and still checks live revocation and status', async () => {
    const recording = { query(sql, params) {
      assert.doesNotMatch(sql.sql, /SELECT\s+\*|s\.\*|u\.\*|entity_payload_json|provider_credential_ciphertext/)
      return pool.query(sql, params)
    } }
    const context = createRelationalContext(recording)
    await context.store.identity('alice-token')
    context.normalize()
    assert.equal(context.data.users.alice.id, 'alice')
    assert.equal(context.data.users.alice.status, 'active')
    assert.equal(context.data.users.alice.avatar, 'https://avatar.example.test/alice.png')
    assert.equal(context.data.sessions[0].user.id, 'alice')
    assert.equal(context.data.sessions[0].apiWebToken, undefined)
  })

  await t.test('OAuth account loading is independent of order, settings and resource queries', async () => {
    const criticalOnly = { query(sql, params) {
      assert.doesNotMatch(sql, /kq_upgrade_order|kq_user_setting|kq_resource|kq_organization/)
      return pool.query(sql, params)
    } }
    const context = createRelationalContext(criticalOnly)
    await context.loadAccount('alice', true)
    assert.equal(context.data.users.alice.id, 'alice')
    assert.ok(context.data.sessions.some(session => session.id === 'alice-token'))
  })

  await t.test('compact OAuth issuance preserves large local profiles and serializes simultaneous logins', async () => {
    const { issueExistingAuthSession } = await import('../../server/db/auth-session.js')
    const fixture = new RelationalRequestStore(pool)
    fixture.data.users['compact-login'] = { id: 'compact-login', username: 'compact-login', status: 'active',
      avatar: 'data:image/webp;base64,' + 'a'.repeat(50000), avatarSource: 'custom',
      planId: 'enterprise', planPermanent: true, planManagedAt: now, email: 'local@example.test', loginMethods: ['email_bound'] }
    await fixture.commit()
    const [[before]] = await pool.query('SELECT entity_payload_json, plan_json, write_version FROM kq_user WHERE legacy_id=?', ['compact-login'])
    const sessions = [0, 1].map(index => ({ id: `compact-login-${index}`, user: { id: 'compact-login' },
      apiWebToken: 'provider-fixture', createdAt: new Date(Date.now() + index).toISOString(), expiresAt: future }))
    assert.deepEqual(await Promise.all(sessions.map(session => issueExistingAuthSession(pool, 'compact-login', session))), [true, true])
    const [[after]] = await pool.query('SELECT entity_payload_json, plan_json, write_version FROM kq_user WHERE legacy_id=?', ['compact-login'])
    assert.deepEqual(after, before, 'login never overwrites local contacts, avatar or entitlements')
    const readers = await Promise.all(sessions.map(async session => new RelationalRequestStore(pool).session(session.id)))
    assert.equal(readers.filter(session => !session.revokedAt).length, 1)
    assert.equal(readers.find(session => session.revokedAt).revokeReason, 'replaced')
    const reader = new RelationalRequestStore(pool)
    const active = await reader.session(readers.find(session => !session.revokedAt).id)
    assert.equal(reader.data.users['compact-login'].avatarSource, 'custom')
    assert.equal(reader.data.users['compact-login'].planPermanent, true)
    assert.equal(active.apiWebToken, 'provider-fixture')
    const [[sizes]] = await pool.query('SELECT MAX(OCTET_LENGTH(entity_payload_json)) AS bytes FROM kq_auth_session WHERE user_id=(SELECT id FROM kq_user WHERE legacy_id=?)', ['compact-login'])
    assert.ok(sizes.bytes < 1500, 'session does not duplicate the avatar/profile')
    await pool.query('DELETE s FROM kq_auth_session s JOIN kq_user u ON u.id=s.user_id WHERE u.legacy_id=?', ['compact-login'])
    await pool.query('DELETE FROM kq_user WHERE legacy_id=?', ['compact-login'])
  })

  await t.test('single-statement logout revokes normalized and legacy sessions across fresh readers', async () => {
    const { revokeAuthSession } = await import('../../server/db/auth-session.js')
    const { protectCredential, keyedDigest } = await import('../../server/lib/private-key.js')
    const seed = new RelationalRequestStore(pool)
    seed.data.users['logout-fixture'] = { id: 'logout-fixture', username: 'logout-fixture', status: 'active', createdAt: now }
    seed.data.sessions.push({ id: 'logout-normalized', user: { id: 'logout-fixture' }, expiresAt: future, createdAt: now }, { id: 'logout-legacy', user: { id: 'logout-fixture' }, expiresAt: future, createdAt: now })
    await seed.commit()
    const legacyKey = keyedDigest('session-id:logout-legacy').slice(0, 120)
    const legacy = JSON.stringify(protectCredential(JSON.stringify({ id: 'logout-legacy', user: { id: 'logout-fixture' }, expiresAt: future }), 'relational:session:' + legacyKey))
    await pool.execute('UPDATE kq_auth_session SET entity_payload_json=? WHERE legacy_id=?', [legacy, legacyKey])
    for (const token of ['logout-normalized', 'logout-legacy']) {
      await revokeAuthSession(pool, token)
      const reader = new RelationalRequestStore(pool)
      assert.ok((await reader.session(token)).revokedAt)
      const [[first]] = await pool.query('SELECT write_version FROM kq_auth_session WHERE token_hash=?', [keyedDigest('session-cookie:' + token)])
      await revokeAuthSession(pool, token)
      const [[second]] = await pool.query('SELECT write_version FROM kq_auth_session WHERE token_hash=?', [keyedDigest('session-cookie:' + token)])
      assert.equal(first.write_version, second.write_version, 'replay cannot un-revoke or rewrite the session')
    }
    await pool.query('DELETE s FROM kq_auth_session s JOIN kq_user u ON u.id=s.user_id WHERE u.legacy_id=?', ['logout-fixture'])
    await pool.query('DELETE FROM kq_user WHERE legacy_id=?', ['logout-fixture'])
  })

  await t.test('partial profile update preserves every unseen table and Bob', async () => {
    const scope = new RelationalRequestStore(pool)
    await scope.session('alice-token')
    scope.data.users.alice.nickname = 'Alice updated'
    await scope.commit()
    const full = (await loadRelationalMetadata(pool)).metadata
    assert.equal(full.users.alice.nickname, 'Alice updated')
    assert.equal(full.users.bob.nickname, seed.users.bob.nickname)
    assert.equal(full.shares.length, 2)
    assert.equal(full.sessions.length, 2)
    assert.equal(full.messages.bob.length, 1)
    assert.equal(full.records.bob.length, 1)
    assert.equal(full.systemConfig.maxBatchFiles, 10)
  })

  await t.test('read-only requests do not write normalized default settings', async () => {
    const scope = new RelationalRequestStore(pool)
    await scope.config()
    await scope.session('alice-token')
    const [[before]] = await pool.query('SELECT revision FROM kq_relational_store_state')
    await scope.commit()
    const [[after]] = await pool.query('SELECT revision FROM kq_relational_store_state')
    assert.equal(after.revision, before.revision)
  })

  await t.test('deleting one message only deletes that users selected message', async () => {
    const scope = new RelationalRequestStore(pool)
    await scope.account('alice', { messages: true })
    scope.data.messages.alice = []
    await scope.commit()
    const full = (await loadRelationalMetadata(pool)).metadata
    assert.equal(full.messages.alice?.length || 0, 0)
    assert.equal(full.messages.bob.length, 1)
  })

  await t.test('same-entity stale writes roll back, other entities remain writable', async () => {
    const first = new RelationalRequestStore(pool), stale = new RelationalRequestStore(pool), other = new RelationalRequestStore(pool)
    await first.users(['alice']); await stale.users(['alice']); await other.users(['bob'])
    first.data.users.alice.nickname = 'Fresh'
    stale.data.users.alice.nickname = 'Stale'
    other.data.users.bob.nickname = 'Bob independently'
    await first.commit()
    await assert.rejects(stale.commit(), error => error.status === 409)
    await other.commit()
    const full = (await loadRelationalMetadata(pool)).metadata
    assert.equal(full.users.alice.nickname, 'Fresh')
    assert.equal(full.users.bob.nickname, 'Bob independently')
  })

  await t.test('resource save updates its rows and SQL usage without deleting other resources', async () => {
    const scope = new RelationalRequestStore(pool)
    await scope.resource({ kind: 'share', id: 'alice-share' })
    scope.data.shares[0].files[0].size = 20
    await scope.commit()
    await scope.users(['bob']) // Rehydration after commit must use fresh child rows.
    assert.equal(scope.data.shares[0].files[0].size, 20)
    assert.equal(scope.data.shares[0].createdAt, now, 'SQL cache timestamps stay UTC on a non-UTC host')
    assert.equal(scope.data.shares[0].expiresAt, future)
    scope.data.shares[0].files.push({ id: 'temporary-file', name: 'temporary.txt', storedName: 'temporary.txt', storageOwnerId: 'alice', size: 1 })
    await scope.commit()
    scope.data.shares[0].files.pop()
    await scope.commit()
    await scope.users(['bob'])
    assert.equal(scope.data.shares[0].files.length, 1)
    assert.equal((await scope.usage('alice')).shareBytes, 20)
    assert.equal((await scope.usage('bob')).shareBytes, 12)
    const full = (await loadRelationalMetadata(pool)).metadata
    assert.equal(full.shares.find(item => item.id === 'bob-share').files[0].size, 12)
  })

  await t.test('two asynchronous requests have isolated metadata and persistence queues', async () => {
    const a = createRelationalContext(pool), b = createRelationalContext(pool)
    await a.store.users(['alice']); await b.store.users(['bob'])
    await Promise.all([
      runWithDataContext(a, async () => { await new Promise(resolve => setTimeout(resolve, 20)); assert.deepEqual(Object.keys(metadata.users), ['alice']); metadata.users.alice.nickname = 'Concurrent A'; persistMetadata(); await flushMetadataWrites() }),
      runWithDataContext(b, async () => { assert.deepEqual(Object.keys(metadata.users), ['bob']); metadata.users.bob.nickname = 'Concurrent B'; persistMetadata(); await flushMetadataWrites() }),
    ])
    const full = (await loadRelationalMetadata(pool)).metadata
    assert.equal(full.users.alice.nickname, 'Concurrent A')
    assert.equal(full.users.bob.nickname, 'Concurrent B')
  })

  await t.test('revocation during an in-flight write prevents publication', async () => {
    const scope = new RelationalRequestStore(pool)
    await scope.session('alice-token')
    scope.authorizedUserId = 'alice'
    const { keyedDigest } = await import('../../server/lib/private-key.js')
    scope.authorizedSessionHash = keyedDigest('session-cookie:alice-token')
    scope.data.users.alice.nickname = 'Must not persist'
    await pool.query('UPDATE kq_auth_session SET revoked_at = UTC_TIMESTAMP(3) WHERE token_hash = ?', [scope.authorizedSessionHash])
    await assert.rejects(scope.commit(), error => error.status === 401)
    await pool.query('UPDATE kq_auth_session SET revoked_at = NULL WHERE token_hash = ?', [scope.authorizedSessionHash])
    assert.equal((await loadRelationalMetadata(pool)).metadata.users.alice.nickname, 'Concurrent A')
  })

  await t.test('SQL cleanup preserves published distribution file history and unrelated files', async () => {
    const scope = new RelationalRequestStore(pool)
    await scope.users(['alice'])
    scope.data.shares.push({ id: 'distribution-share', ownerUserId: 'alice', code: 'DISTR1', manageToken: 'distribution-manage', status: 'active', createdAt: now,
      files: [{ id: 'distribution-file', name: 'history.txt', storedName: 'history.txt', storageOwnerId: 'alice', size: 7 }] })
    scope.data.distributions.push({ id: 'distribution-batch', ownerUserId: 'alice', shareId: 'distribution-share', createdAt: now,
      rows: [{ key: 'one', userId: 'bob', fileName: 'history.txt' }] })
    await scope.commit()
    const cleanup = new RelationalRequestStore(pool)
    await cleanup.resource({ kind: 'share', id: 'distribution-share' })
    cleanup.data.shares[0].files = []
    cleanup.data.shares[0].cleanedAt = now
    await cleanup.commit()
    const [[row]] = await pool.query('SELECT COUNT(*) AS total FROM kq_distribution_assignment a JOIN kq_resource_file f ON f.id = a.resource_file_id')
    assert.equal(Number(row.total), 1)
    const before = (await pool.query('SELECT revision FROM kq_relational_store_state'))[0][0].revision
    await cleanup.commit()
    assert.equal((await pool.query('SELECT revision FROM kq_relational_store_state'))[0][0].revision, before)
    assert.equal((await cleanup.usage('alice')).shareBytes, 20)
    assert.equal((await cleanup.usage('bob')).shareBytes, 12)
    const removed = new RelationalRequestStore(pool)
    await removed.resource({ kind: 'share', id: 'distribution-share' })
    removed.data.shares = []
    await removed.commit()
    assert.equal((await pool.query('SELECT COUNT(*) AS total FROM kq_distribution_batch WHERE legacy_id = ?', ['distribution-batch']))[0][0].total, 0)
    assert.ok((await loadRelationalMetadata(pool)).metadata.shares.some(item => item.id === 'bob-share'))
  })

  await t.test('SQL audit keeps critical history and retries failed writes from a later request', async () => {
    const store = new RelationalAuditStore(pool, normalizeAuditLog, 2)
    const log = (id, type, offset) => ({ id, type, action: id, createdAt: new Date(Date.now() + offset).toISOString() })
    store.append(log('sql-critical', 'security', -3000))
    store.append(log('sql-access-old', 'access', -2000))
    store.append(log('sql-access-new', 'access', -1000))
    await store.flush()
    assert.deepEqual(new Set((await store.refresh()).map(item => item.id)), new Set(['sql-critical', 'sql-access-new']))
    let unavailable = true
    const flaky = { query: pool.query.bind(pool), execute(...args) {
      if (unavailable) return Promise.reject(Object.assign(new Error('fixture outage'), { code: 'FIXTURE_AUDIT_OUTAGE' }))
      return pool.execute(...args)
    } }
    const first = relationalAuditWriter(flaky, normalizeAuditLog, 2)
    first.append(log('sql-retry-first', 'security', 0))
    await assert.rejects(first.flush())
    unavailable = false
    const later = relationalAuditWriter(flaky, normalizeAuditLog, 2)
    assert.equal(first, later)
    later.append(log('sql-retry-next', 'security', 1))
    await later.flush()
    const [rows] = await pool.query('SELECT legacy_id FROM kq_audit_log WHERE legacy_id IN (?, ?)', ['sql-retry-first', 'sql-retry-next'])
    assert.equal(rows.length, 2)
  })

  await t.test('relational columns and child rows are authoritative without duplicated resource arrays', async () => {
    const [[row]] = await pool.query('SELECT * FROM kq_resource WHERE legacy_id = ?', ['alice-share'])
    const payload = decodeProtected(row.entity_payload_json, 'resource:share:alice-share')
    assert.equal(payload.__columns_v, 1)
    assert.equal(Object.hasOwn(payload.extra, 'files'), false)
    assert.equal(Object.hasOwn(payload.extra, 'status'), false)
    assert.equal(Object.hasOwn(payload.extra, 'createdAt'), false)
    await pool.query('UPDATE kq_resource_file SET file_name = ? WHERE resource_id = ?', ['SQL authority.txt', row.id])
    const scope = new RelationalRequestStore(pool)
    await scope.resource({ kind: 'share', id: 'alice-share' })
    assert.equal(scope.data.shares[0].files[0].name, 'SQL authority.txt')
    await pool.query('UPDATE kq_resource_file SET file_name = ? WHERE resource_id = ?', ['file.txt', row.id])
    await pool.query('UPDATE kq_guest_usage SET used_bytes = 15')
    await scope.guest('fixture-guest')
    assert.equal(scope.data.guestUsage['fixture-guest'].bytes, 15)
  })

  await t.test('an unrelated owner can finish while another owners transaction is held open', async () => {
    const alice = new RelationalRequestStore(pool), bob = new RelationalRequestStore(pool)
    await alice.users(['alice']); await bob.users(['bob'])
    alice.data.users.alice.nickname = 'Holding only Alice'
    bob.data.users.bob.nickname = 'Independent Bob'
    let entered, release
    const enteredPromise = new Promise(resolve => { entered = resolve })
    const gate = new Promise(resolve => { release = resolve })
    alice.beforeCommit = async () => { entered(); await gate }
    const first = alice.commit()
    await enteredPromise
    try {
      const result = await Promise.race([bob.commit().then(() => 'committed'), delay(1500).then(() => 'blocked')])
      assert.equal(result, 'committed', 'independent writers must not wait for a global revision lock')
    } finally { release(); await first }
  })

  await t.test('collection rebases independent submissions, rejects conflicting edits and enforces fresh quotas', async () => {
    const seed = new RelationalRequestStore(pool)
    await seed.config(); await seed.users(['alice'])
    const originalConfig = structuredClone(seed.data.systemConfig)
    seed.data.systemConfig.planOverrides = { member: { totalBytes: 100, collectionParticipantLimit: 2 } }
    seed.data.collections.push({ id: 'race-task', token: 'race-task', manageToken: 'race-manage', ownerUserId: 'alice', status: 'active', title: 'Race', createdAt: now, submissions: [] })
    await seed.commit()
    const load = async () => {
      const context = createRelationalContext(pool)
      await context.store.config(); await context.store.resource({ kind: 'collection', id: 'race-task' }); await context.loadUsage('alice')
      return context
    }
    const submission = (id, bytes = 10) => ({ id, participantKey: id, participantName: id, submittedAt: now,
      files: [{ id: `${id}-file`, name: `${id}.txt`, storedName: `${id}.txt`, storageOwnerId: 'alice', size: bytes }] })
    try {
      const a = await load(), b = await load()
      a.data.collections[0].submissions.push(submission('one')); b.data.collections[0].submissions.push(submission('two'))
      await runWithDataContext(a, () => a.store.commit())
      await runWithDataContext(b, () => b.store.commit())
      assert.deepEqual(new Set((await load()).data.collections[0].submissions.map(item => item.id)), new Set(['one', 'two']))
      await b.store.users(['bob'])
      assert.equal(b.data.collections[0].submissions.length, 2, 'rehydration retains the rebased children')
      const first = await load(), stale = await load()
      first.data.collections[0].submissions[0].participantName = 'fresh'
      stale.data.collections[0].submissions[0].participantName = 'stale'
      await runWithDataContext(first, () => first.store.commit())
      await assert.rejects(runWithDataContext(stale, () => stale.store.commit()), error => error.status === 409)
      const participant = await load(), other = await load()
      participant.data.collections[0].submissions.push(submission('three'))
      other.data.collections[0].submissions[0].participantName = 'newer'
      await runWithDataContext(other, () => other.store.commit())
      await assert.rejects(runWithDataContext(participant, () => participant.store.commit()), /提交上限/)
      const config = new RelationalRequestStore(pool); await config.config()
      config.data.systemConfig.planOverrides.member.collectionParticipantLimit = 10; await config.commit()
      const c = await load(), d = await load()
      c.data.collections[0].submissions.push(submission('quota-one', 40)); d.data.collections[0].submissions.push(submission('quota-two', 40))
      await runWithDataContext(c, () => c.store.commit()) // 20 share + 20 existing + 40 = 80.
      await assert.rejects(runWithDataContext(d, () => d.store.commit()), error => error.status === 507)
      assert.equal((await load()).data.collections[0].submissions.length, 3)
    } finally {
      const cleanup = new RelationalRequestStore(pool); await cleanup.config(); await cleanup.resource({ kind: 'collection', id: 'race-task' })
      cleanup.data.collections = []; cleanup.data.systemConfig = originalConfig; await cleanup.commit()
    }
  })

  await t.test('SQL orphan scan protects unloaded live files and guards candidates again before deletion', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kq-orphan-'))
    t.after(() => fs.rmSync(root, { recursive: true, force: true }))
    const roots = { filesRoot: path.join(root, 'files'), collectionsRoot: path.join(root, 'collections'), userFilesRoot: path.join(root, 'users') }
    const ownerDirectory = path.join(roots.userFilesRoot, storageOwnerDirectoryName('alice'))
    fs.mkdirSync(ownerDirectory, { recursive: true }); fs.mkdirSync(path.join(roots.filesRoot, 'alice-share'), { recursive: true })
    fs.mkdirSync(path.join(roots.filesRoot, 'orphan-resource'), { recursive: true })
    const liveFile = path.join(ownerDirectory, 'alice.txt'), orphanFile = path.join(ownerDirectory, 'orphan.txt')
    const guardedFile = path.join(ownerDirectory, 'guarded.txt')
    fs.writeFileSync(liveFile, 'live'); fs.writeFileSync(orphanFile, 'orphan'); fs.writeFileSync(guardedFile, 'guarded')
    const context = createRelationalContext(pool)
    context.store.didCommit = null
    context.deferCleanup = (target, recursive, guard) => context.store.cleanupTasks.push(cleanupTarget(root, target, recursive, guard))
    await context.store.config()
    const result = await cleanupDatabaseOrphans(context, roots, { now: Date.now() + 32 * 86400000 })
    assert.deepEqual(result, { shares: 1, collections: 0, userFiles: 2 })
    assert.equal(context.data.shares.length, 0, 'live resources were never loaded to perform the scan')
    await context.store.commit()
    // A resource can be published after scanning but before the worker runs.
    const published = new RelationalRequestStore(pool)
    published.data.shares.push({ id: 'orphan-resource', ownerUserId: 'alice', status: 'active', code: 'ORPHAN', manageToken: 'orphan-manage',
      files: [{ name: 'guarded.txt', storedName: 'guarded.txt', storageOwnerId: 'alice', size: 1 }], createdAt: now })
    await published.commit()
    await drainCleanup(pool, root)
    assert.equal(fs.existsSync(path.join(roots.filesRoot, 'orphan-resource')), true)
    assert.equal(fs.existsSync(liveFile), true); assert.equal(fs.existsSync(orphanFile), false)
    assert.equal(fs.existsSync(guardedFile), true, 'a file published after scanning must also be retained')
    const cleanup = new RelationalRequestStore(pool); await cleanup.resource({ kind: 'share', id: 'orphan-resource' })
    cleanup.data.shares = []; await cleanup.commit()
  })

  await t.test('rollback preserves bytes; committed cleanup survives restart and retries filesystem errors', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kq-outbox-'))
    t.after(() => fs.rmSync(root, { recursive: true, force: true }))
    const directory = path.join(root, 'users/owner'), target = path.join(directory, 'keep.txt')
    fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(target, 'must survive rollback')
    const scope = new RelationalRequestStore(pool)
    await scope.users(['alice'])
    const context = { deferCleanup(file, recursive) { scope.cleanupTasks.push(cleanupTarget(root, file, recursive)); return true } }
    runWithDataContext(context, () => {
      removeStoredFiles([{ storedName: 'keep.txt' }], directory)
      removeDirectory(directory)
    })
    assert.equal(fs.readFileSync(target, 'utf8'), 'must survive rollback')
    scope.beforeCommit = () => { throw Object.assign(new Error('fixture rollback'), { code: 'FIXTURE_ROLLBACK' }) }
    await assert.rejects(scope.commit(), /fixture rollback/)
    assert.equal((await pool.query('SELECT COUNT(*) AS total FROM kq_file_cleanup'))[0][0].total, 0)
    assert.equal(fs.existsSync(target), true)
    const committed = new RelationalRequestStore(pool)
    committed.cleanupTasks.push(cleanupTarget(root, target))
    await committed.commit()
    assert.equal(fs.existsSync(target), true, 'commit queues intent and does not require this process to remove bytes')
    await drainCleanup(pool, root, { remove: async () => { throw Object.assign(new Error('disk unavailable'), { code: 'EACCES' }) } })
    const [[pending]] = await pool.query('SELECT attempts, last_error_code FROM kq_file_cleanup')
    assert.equal(pending.attempts, 1); assert.equal(pending.last_error_code, 'EACCES')
    assert.equal(fs.existsSync(target), true)
    await pool.query('UPDATE kq_file_cleanup SET next_attempt_at = UTC_TIMESTAMP(3)')
    await drainCleanup(pool, root)
    assert.equal(fs.existsSync(target), false)
    assert.equal((await pool.query('SELECT COUNT(*) AS total FROM kq_file_cleanup'))[0][0].total, 0)
  })

  await t.test('SQL pages preserve every record and exclude other owners; admin summaries never fetch payloads', async () => {
    const seed = new RelationalRequestStore(pool)
    seed.data.users.paged = { id: 'paged', username: 'paged', nickname: 'Paged', status: 'active', planId: 'free' }
    seed.data.messages.paged = Array.from({ length: 125 }, (_, index) => ({ id: `page-${index}`, title: `Message ${index}`, body: 'Body', unread: true, createdAt: now }))
    seed.data.sessions.push({ id: 'paged-token', user: { id: 'paged', username: 'paged' }, expiresAt: future, createdAt: now })
    await seed.commit()
    const found = [], queries = []
    let cursor
    do {
      const scope = new RelationalRequestStore(pool)
      await scope.users(['paged'])
      const page = await scope.accountPage('paged', 'messages', { limit: 50, cursor })
      assert.ok(scope.data.messages.paged.length <= 50)
      found.push(...scope.data.messages.paged.map(item => item.id)); cursor = page.nextCursor
    } while (cursor)
    assert.equal(new Set(found).size, 125)
    const scope = new RelationalRequestStore({ query(sql, params) { queries.push(sql); return pool.query(sql, params) } })
    const overview = await scope.adminOverview()
    assert.equal(overview.stats.users, 3)
    assert.equal(overview.stats.shares, 2)
    assert.equal(overview.stats.totalBytes, 32)
    assert.ok(overview.users.every(user => typeof user.usageBytes === 'number'))
    assert.equal(queries.some(sql => /entity_payload_json|SELECT \*/i.test(sql)), false)
    assert.equal(scope.data.shares.length, 0)
  })

  await t.test('record SQL filters and projections paginate across all rows without crossing owners', async () => {
    const seed = new RelationalRequestStore(pool)
    seed.data.users.listing = { id: 'listing', username: 'listing', status: 'active', planId: 'free' }
    seed.data.sessions.push({ id: 'listing-token', user: { id: 'listing' }, expiresAt: future, createdAt: now })
    seed.data.records.listing = Array.from({length:125}, (_,index) => ({ id: 'fixture-' + index, kind: 'share', scope: index % 2 ? 'my_sent' : 'sent_to_me', name: 'Findable ' + index, code: '', status: 'active', createdAt: now, files: [{name: index % 2 ? 'photo.png' : 'report.pdf', size:1}], expiresAt: future }))
    await seed.commit()
    const query = async options => { const store = new RelationalRequestStore(pool); await store.users(['listing']); const pagination = await store.recordList('listing',options); return {store,pagination} }
    const first=await query({page:1,limit:8}), second=await query({page:2,limit:8})
    assert.equal(first.pagination.total,125);assert.equal(first.store.data.records.listing.length,8)
    assert.equal(first.pagination.scopeCounts.my_sent,62)
    assert.equal(first.pagination.categoryCounts.image,62)
    assert.ok(second.store.data.records.listing.every(item=>!first.store.data.records.listing.some(other=>other.id===item.id)))
    const searched=await query({page:1,q:'Findable 120'})
    assert.equal(searched.pagination.total,1);assert.equal(searched.store.data.records.listing[0].name,'Findable 120')
    const category=await query({page:1,category:'image'})
    assert.equal(category.pagination.total,62)
    assert.ok(category.store.data.records.listing.every(record=>record.scope==='my_sent'))
    const other=new RelationalRequestStore(pool);await other.users(['bob']);const bob=await other.recordList('bob',{page:1})
    assert.ok(bob.total<125);assert.ok((other.data.records.bob||[]).every(record=>!record.id.startsWith('fixture-')))
    searched.store.data.records.listing[0].alias='Changed projection'
    await searched.store.commit()
    assert.equal((await query({page:1,q:'Changed projection'})).pagination.total,1)
  })

  await t.test('real logical backup restores normalized rows, schema markers and cleanup intent', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kq-mysql-backup-'))
    const restored = `${name}_restore`
    t.after(async () => { await admin.query(`DROP DATABASE IF EXISTS \`${restored}\``); fs.rmSync(directory, { recursive: true, force: true }) })
    const manifest = await backupMysql(directory, { ...process.env, KUNQIONG_DB_ENABLED: 'true', KUNQIONG_DB_HOST: '127.0.0.1', KUNQIONG_DB_PORT: String(port), KUNQIONG_DB_NAME: name, KUNQIONG_DB_USER: 'root', KUNQIONG_DB_PASSWORD: '', KUNQIONG_MYSQL_DUMP_BIN: process.env.KUNQIONG_TEST_DUMP_BIN || 'mysqldump' })
    const compressed = fs.readFileSync(path.join(directory, manifest.file))
    assert.equal(crypto.createHash('sha256').update(compressed).digest('hex'), manifest.sha256)
    await admin.query(`CREATE DATABASE \`${restored}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
    const result = spawnSync(process.env.KUNQIONG_TEST_MYSQL_BIN || 'mysql', ['--host', '127.0.0.1', '--port', String(port), '--user', 'root', '--', restored], { input: gunzipSync(compressed), windowsHide: true, env: { ...process.env, MYSQL_PWD: '' } })
    assert.equal(result.status, 0, String(result.stderr))
    const restorePool = mysql.createPool({ host: '127.0.0.1', port, user: 'root', database: restored, timezone: 'Z' })
    try {
      const loaded = await loadRelationalMetadata(restorePool)
      assert.equal(loaded.metadata.shares.find(item => item.id === 'alice-share').files[0].size, 20)
      assert.equal(loaded.metadata.messages.paged.length, 125)
      assert.equal(loaded.state.schemaVersion, 3)
    } finally { await restorePool.end() }
  })

  await t.test('database HTTP startup ignores broken JSON, routes query on demand and uploads survive restart', async t => {
    const root = path.resolve(import.meta.dirname, '../..')
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-demand-http-'))
    const copy = (source, destination) => {
      fs.mkdirSync(destination, { recursive: true })
      for (const item of fs.readdirSync(source, { withFileTypes: true })) {
        const from = path.join(source, item.name), to = path.join(destination, item.name)
        if (item.isDirectory()) copy(from, to)
        else if (item.isFile()) fs.copyFileSync(from, to)
      }
    }
    fs.copyFileSync(path.join(root, 'server.mjs'), path.join(fixture, 'server.mjs'))
    fs.copyFileSync(path.join(root, 'package.json'), path.join(fixture, 'package.json'))
    copy(path.join(root, 'server'), path.join(fixture, 'server'))
    copy(path.join(root, 'email-templates'), path.join(fixture, 'email-templates'))
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
    fs.mkdirSync(path.join(fixture, 'storage'))
    fs.writeFileSync(path.join(fixture, 'storage/metadata.json'), 'this is intentionally not JSON')
    fs.mkdirSync(path.join(fixture, 'dist'))
    fs.writeFileSync(path.join(fixture, 'dist/index.html'), '<html><head><!--seo:start--><!--seo:end--></head><body>database-shell</body></html>')
    const scanner = net.createServer(socket => {
      let input = Buffer.alloc(0), command = false
      socket.on('error', () => {})
      socket.on('data', part => {
        input = Buffer.concat([input, part])
        if (!command) {
          const end = input.indexOf(0)
          if (end < 0) return
          assert.equal(input.subarray(0, end).toString(), 'zINSTREAM')
          input = input.subarray(end + 1); command = true
        }
        while (input.length >= 4) {
          const size = input.readUInt32BE(0)
          if (input.length < size + 4) return
          input = input.subarray(size + 4)
          if (!size) { socket.end('stream: OK\0'); return }
        }
      })
    })
    await new Promise(resolve => scanner.listen(0, '127.0.0.1', resolve))
    const oauth = http.createServer(async (req, res) => {
      let raw = ''; for await (const part of req) raw += part
      const { code } = JSON.parse(raw)
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ code: 200, data: { access_token: 'sql-fixture-access', expires_in: 3600,
        user: { id: code === 'disabled' ? 'disabled-sql' : 'new-sql-user', username: 'SQL OAuth', status: 'active' } } }))
    })
    await new Promise(resolve => oauth.listen(0, '127.0.0.1', resolve))
    const probe = net.createServer()
    await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
    const httpPort = probe.address().port
    await new Promise(resolve => probe.close(resolve))
    const env = { ...process.env }
    for (const key of Object.keys(env)) if (/^(KUNQIONG_|OAUTH_)/.test(key)) delete env[key]
    let child, logs = ''
    const stop = async () => {
      if (!child || child.exitCode !== null || child.signalCode !== null) return
      const exit = once(child, 'exit'); child.kill(); await exit
    }
    t.after(async () => {
      await stop()
      await new Promise(resolve => scanner.close(resolve))
      await new Promise(resolve => oauth.close(resolve))
      assert.ok(fixture.startsWith(path.join(os.tmpdir(), 'kunqiong-demand-http-')))
      fs.rmSync(fixture, { recursive: true, force: true })
    })
    const base = `http://127.0.0.1:${httpPort}`
    const start = async () => {
      child = spawn(process.execPath, ['server.mjs'], { cwd: fixture, windowsHide: true,
        env: { ...env, PORT: String(httpPort), HOST: '127.0.0.1', NODE_ENV: 'test', KUNQIONG_DB_ENABLED: 'true',
          KUNQIONG_RELATIONAL_SCHEMA_ENABLED: 'true', KUNQIONG_DB_HOST: '127.0.0.1', KUNQIONG_DB_PORT: String(port),
          KUNQIONG_DB_NAME: name, KUNQIONG_DB_USER: 'root', KUNQIONG_DB_PASSWORD: '', KUNQIONG_DATA_KEY: 'ab'.repeat(32),
          KUNQIONG_ADMIN_USERNAME: 'sql-fixture-admin', KUNQIONG_ADMIN_PASSWORD: 'sql-fixture-test-password',
          KUNQIONG_SCAN_MODE: 'required', KUNQIONG_CLAMAV_HOST: '127.0.0.1', KUNQIONG_CLAMAV_PORT: String(scanner.address().port),
          KUNQIONG_AUTH_CALLBACK_URL: `${base}/auth/callback`, KUNQIONG_OAUTH_AUTHORIZE_URL: `http://127.0.0.1:${oauth.address().port}/authorize`,
          KUNQIONG_OAUTH_TOKEN_URL: `http://127.0.0.1:${oauth.address().port}/token`, KUNQIONG_OAUTH_CLIENT_ID: 'sql-fixture', KUNQIONG_OAUTH_CLIENT_SECRET: 'sql-fixture',
        }, stdio: ['ignore', 'pipe', 'pipe'] })
      child.stdout.on('data', data => { logs += data }); child.stderr.on('data', data => { logs += data })
      for (let attempt = 0; attempt < 100; attempt++) {
        try { if ((await fetch(`${base}/api/health`)).ok) return } catch {}
        if (child.exitCode !== null) break
        await delay(30)
      }
      assert.fail(logs)
    }
    const request = async (url, options = {}, token = 'alice-token') => {
      const response = await fetch(`${base}${url}`, { ...options, signal: AbortSignal.timeout(6000), headers: { cookie: `kunqiong_session=${token}`, ...(options.body && typeof options.body === 'string' ? { 'content-type': 'application/json' } : {}), ...options.headers } })
      const body = await response.json()
      assert.ok(response.status < 500, `${url}: ${JSON.stringify(body)} logs: ${logs}`)
      return { response, body }
    }
    await start()
    assert.equal((await fetch(base)).status, 200)
    const identity = await request('/api/auth/me', {headers:{'X-Kunqiong-Auth-View':'identity'}})
    assert.equal(identity.body.user.id,'alice');assert.equal(identity.body.user.capacity,undefined)
    assert.match(identity.response.headers.get('server-timing'),/db;dur=/)
    const summary = await request('/api/auth/me', {headers:{'X-Kunqiong-Auth-View':'summary'}})
    assert.equal(summary.body.user.capacity,undefined);assert.ok(summary.body.user.plan)
    const pageOne = await request('/api/account/records?page=1&limit=8',{},'listing-token')
    const pageTwo = await request('/api/account/records?page=2&limit=8',{},'listing-token')
    assert.equal(pageOne.body.pagination.total,125);assert.equal(pageOne.body.records.length,8)
    assert.ok(pageTwo.body.records.every(item=>!pageOne.body.records.some(other=>other.id===item.id)))
    await request('/api/account/records',{method:'DELETE',body:JSON.stringify({all:true,scope:'my_sent'})},'listing-token')
    const cleared = await request('/api/account/records?page=1&limit=8',{},'listing-token')
    assert.equal(cleared.body.pagination.total,63);assert.equal(cleared.body.pagination.scopeCounts.my_sent,undefined)
    const unread = await request('/api/account/messages?summary=1',{},'paged-token')
    assert.equal(unread.body.total,125);assert.equal(unread.body.unreadCount,125);assert.equal(unread.body.messages,undefined)
    const me = await request('/api/auth/me')
    assert.equal(me.body.user.id, 'alice')
    assert.equal(me.body.user.capacity.shareBytes, 20)
    assert.equal((await request('/api/auth/me', {}, 'bob-token')).body.user.id, 'bob')
    assert.equal((await request('/api/auth/me', {}, 'bad-token')).body.user, null)
    const profile = await request('/api/auth/profile', { method: 'PATCH', body: JSON.stringify({ nickname: 'HTTP Alice' }) })
    assert.equal(profile.response.status, 200)
    assert.equal(profile.body.user.nickname, 'HTTP Alice')
    const records = await request('/api/account/records')
    assert.ok(records.body.records.every(record => !record.id.includes('bob-share')))
    const paged = await request('/api/account/messages?limit=40', {}, 'paged-token')
    assert.equal(paged.body.messages.length, 40)
    assert.ok(paged.body.pagination.nextCursor)
    assert.equal((await request('/api/account/messages?cursor=bad', {}, 'paged-token')).response.status, 400)
    const oldPage = await request('/api/account/messages?cursor=' + paged.body.pagination.nextCursor, {}, 'paged-token')
    const oldId = oldPage.body.messages[0].id, deleteId = oldPage.body.messages[1].id
    assert.equal((await request(`/api/account/messages/${oldId}`, { method: 'PATCH' }, 'paged-token')).response.status, 200)
    assert.equal((await request('/api/account/messages?cursor=' + paged.body.pagination.nextCursor, {}, 'paged-token')).body.messages.find(item => item.id === oldId).unread, false)
    assert.equal((await request(`/api/account/messages/${deleteId}`, { method: 'DELETE' }, 'paged-token')).response.status, 200)
    assert.equal((await pool.query('SELECT COUNT(*) AS total FROM kq_message m JOIN kq_user u ON u.id = m.user_id WHERE u.legacy_id = ?', ['paged']))[0][0].total, 124)
    assert.equal((await request('/api/account/messages/b-message', { method: 'DELETE' }, 'paged-token')).response.status, 200)
    assert.ok((await loadRelationalMetadata(pool)).metadata.messages.bob.some(item => item.id === 'b-message'), 'idempotent delete cannot touch another mailbox')
    await request('/api/account/messages', { method: 'PATCH' }, 'paged-token')
    const readPage = await request('/api/account/messages?cursor=' + paged.body.pagination.nextCursor, {}, 'paged-token')
    assert.ok(readPage.body.messages.every(message => message.unread === false), JSON.stringify(readPage.body.messages.slice(0,3)))
    await request('/api/account/messages', { method: 'DELETE' }, 'paged-token')
    assert.equal((await pool.query('SELECT COUNT(*) AS total FROM kq_message m JOIN kq_user u ON u.id = m.user_id WHERE u.legacy_id = ?', ['paged']))[0][0].total, 0)
    assert.equal((await request('/api/account/messages', {}, 'paged-token')).body.messages.length, 0)
    const foreign = await request('/api/shares/manage/bob-manage')
    assert.equal(foreign.response.status, 403)
    const upload = await request('/api/upload-sessions', { method: 'POST', body: JSON.stringify({ files: [{ name: 'resume.txt', size: 5, mimeType: 'text/plain' }] }) })
    assert.equal(upload.response.status, 201)
    const sessionId = upload.body.sessionId || upload.body.id || upload.body.session?.id
    assert.ok(sessionId, JSON.stringify(upload.body))
    await stop(); await start()
    const restored = await request(`/api/upload-sessions/${sessionId}`)
    assert.equal(restored.response.status, 200, JSON.stringify(restored.body))
    assert.equal((await request(`/api/upload-sessions/${sessionId}`, {}, 'bob-token')).response.status, 403)
    const chunk = new FormData()
    chunk.append('fileIndex', '0'); chunk.append('chunkIndex', '0'); chunk.append('totalChunks', '1')
    chunk.append('chunk', new Blob(['hello']), 'chunk')
    assert.equal((await request(`/api/upload-sessions/${sessionId}/chunks`, { method: 'POST', body: chunk })).response.status, 200)
    const published = await request(`/api/upload-sessions/${sessionId}/complete`, { method: 'POST', body: '{}' })
    assert.equal(published.response.status, 201, JSON.stringify(published.body))
    const publishedShare = published.body.share
    assert.ok(publishedShare?.id, JSON.stringify(published.body))
    const download = await fetch(`${base}/api/shares/${publishedShare.id}/files/0/download`)
    assert.equal(download.status, 200)
    assert.equal(await download.text(), 'hello')
    assert.match(await (await fetch(`${base}/share/${publishedShare.id}`)).text(), /resume\.txt/)
    assert.equal((await request('/api/auth/me')).body.user.capacity.shareBytes, 25)

    await t.test('SQL collection create, submit, manage and delete preserve the other account', async () => {
      const settings = new RelationalRequestStore(pool)
      await settings.config()
      settings.data.systemConfig.planOverrides = { member: { activeCollectionLimit: 1 } }
      await settings.commit()
      const createOptions = { method: 'POST', headers: { 'Idempotency-Key': 'mysql-create-retry-key' }, body: JSON.stringify({ title: 'SQL collection', maxFileSizeMb: 10 }) }
      const creations = await Promise.all(Array.from({ length: 4 }, () => request('/api/collections', createOptions)))
      const created = creations.find(item => item.response.status === 201)
      assert.ok(created, JSON.stringify(creations.map(item => item.body)))
      assert.equal(created.response.status, 201, JSON.stringify(created.body))
      const task = created.body.collection
      const manager = created.body.manageToken
      assert.ok(creations.every(item => [200,201].includes(item.response.status) && item.body.collection?.token === task.token && item.body.manageToken === manager), 'SQL concurrent retries return one task and manager')
      assert.equal((await request('/api/collections', createOptions)).body.collection.token, task.token, 'SQL replay works after the active quota is reached')
      const usage = new RelationalRequestStore(pool)
      assert.equal(await usage.activeCollections('alice'), 1)
      assert.equal(await usage.activeCollections('bob'), 0)
      assert.equal((await request('/api/collections', { method: 'POST', body: JSON.stringify({ title: 'Must respect the SQL limit', maxFileSizeMb: 10 }) })).response.status, 409)
      const form = new FormData(); form.append('files', new Blob(['collected']), 'submitted.txt')
      const submitted = await request(`/api/collections/${task.token}/submissions`, { method: 'POST', body: form }, 'bob-token')
      assert.equal(submitted.response.status, 201, JSON.stringify(submitted.body))
      const managed = await request(`/api/collections/manage/${manager}`)
      assert.equal(managed.body.collection.submissions.length, 1)
      const owned = await request('/api/account/collections?limit=6')
      const ownedTask = owned.body.collections.find(item => item.id === task.id)
      assert.ok(ownedTask, 'new SQL task is visible without a browser/account-record snapshot')
      assert.equal(ownedTask.manageToken, manager)
      assert.equal(ownedTask.title, 'SQL collection')
      assert.equal(ownedTask.submissionCount, 1)
      assert.equal(ownedTask.fileCount, 1)
      assert.equal(ownedTask.usedBytes, 9)
      assert.equal(ownedTask.submissions, undefined, 'history does not download private submissions or file graphs')
      assert.ok(!(await request('/api/account/collections?limit=6', {}, 'bob-token')).body.collections.some(item => item.id === task.id))
      assert.equal((await request('/api/account/collections?limit=6', {}, 'bad-token')).response.status, 401)
      assert.equal((await request(`/api/collections/manage/${manager}`, {}, 'bob-token')).response.status, 403)
      assert.equal((await request('/api/account/collections?cursor=invalid')).response.status, 400)
      const sameFile = () => { const body = new FormData(); body.append('files', new Blob(['replaced!']), 'submitted.txt'); return body }
      const conflict = await request(`/api/collections/${task.token}/submissions`, { method: 'POST', body: sameFile() }, 'bob-token')
      assert.equal(conflict.response.status, 409, JSON.stringify(conflict.body))
      assert.equal(conflict.body.code, 'collection_file_exists')
      const overwrite = sameFile(); overwrite.append('overwriteExisting', 'true')
      const replaced = await request(`/api/collections/${task.token}/submissions`, { method: 'POST', body: overwrite }, 'bob-token')
      assert.equal(replaced.response.status, 201, JSON.stringify(replaced.body))
      const afterOverwrite = (await request(`/api/collections/manage/${manager}`)).body.collection
      assert.equal(afterOverwrite.submissions.flatMap(item => item.files).length, 1)
      const replacementDownload = await fetch(`${base}/api/collections/manage/${manager}/submissions/${replaced.body.submission.id}/files/0/download`, { headers: { cookie: 'kunqiong_session=alice-token' } })
      assert.equal(await replacementDownload.text(), 'replaced!', 'SQL overwrite publishes replacement bytes')
      assert.equal((await request(`/api/collections/manage/${manager}`, {}, 'bob-token')).response.status, 403)
      assert.equal((await request('/api/auth/me')).body.user.capacity.collectionBytes, 9)
      assert.equal((await request(`/api/collections/manage/${manager}`, { method: 'PATCH', body: JSON.stringify({ title: 'SQL updated', status: 'closed' }) })).response.status, 200)
      assert.equal((await request(`/api/collections/${task.token}`)).response.status, 410)
      const another = await request('/api/collections', { method: 'POST', body: JSON.stringify({ title: 'Another collection', maxFileSizeMb: 10 }) })
      assert.equal(another.response.status, 201, JSON.stringify(another.body))
      assert.equal((await request(`/api/collections/manage/${manager}`, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) })).response.status, 409)
      assert.equal((await request(`/api/collections/manage/${another.body.manageToken}`, { method: 'DELETE' })).response.status, 200)
      assert.equal((await request(`/api/collections/manage/${manager}`, { method: 'DELETE' })).response.status, 200)
      assert.equal((await request('/api/auth/me')).body.user.capacity.collectionBytes, 0)
      assert.equal((await request('/api/auth/me', {}, 'bob-token')).body.user.capacity.shareBytes, 12)
    })

    await t.test('SQL team invitations and membership changes preserve other accounts and files', async () => {
      const upgrade = new RelationalRequestStore(pool)
      await upgrade.users(['alice']); upgrade.data.users.alice.planId = 'enterprise'; upgrade.data.users.alice.planPermanent = true
      await upgrade.commit()
      const created = await request('/api/account/workspace', { method: 'POST', body: JSON.stringify({ name: 'SQL team' }) })
      assert.equal(created.response.status, 201, JSON.stringify(created.body))
      const invited = await request('/api/account/workspace/members', { method: 'POST', body: JSON.stringify({ userId: 'bob' }) })
      assert.equal(invited.response.status, 201, JSON.stringify(invited.body))
      const full = (await loadRelationalMetadata(pool)).metadata
      const org = Object.values(full.organizations).find(item => item.name === 'SQL team')
      const invitation = org.members.find(item => item.userId === 'bob').invitationId
      const accepted = await request(`/api/account/workspace/invitations/${invitation}`, { method: 'POST', body: JSON.stringify({ decision: 'accept' }) }, 'bob-token')
      assert.equal(accepted.response.status, 200, JSON.stringify(accepted.body))
      const after = (await loadRelationalMetadata(pool)).metadata
      assert.equal(after.organizations[org.id].members.filter(item => item.status === 'active').length, 2)
      assert.ok(after.shares.some(item => item.id === 'bob-share'))
      const teamForm = new FormData(); teamForm.append('files', new Blob(['team']), 'team.txt'); teamForm.append('mode', 'team_resource')
      const uploaded = await request('/api/shares?mode=team_resource', { method: 'POST', body: teamForm }, 'bob-token')
      assert.equal(uploaded.response.status, 201, JSON.stringify(uploaded.body))
      const duplicateForm = new FormData(); duplicateForm.append('files', new Blob(['team']), 'team.txt'); duplicateForm.append('mode', 'team_resource')
      assert.equal((await request('/api/shares?mode=team_resource', { method: 'POST', body: duplicateForm }, 'bob-token')).response.status, 409)
      const pagingSeed = new RelationalRequestStore(pool)
      await pagingSeed.resource({ kind: 'share', id: uploaded.body.share.id })
      const template = pagingSeed.data.shares.find(share => share.id === uploaded.body.share.id)
      for (let index = 0; index < 18; index++) pagingSeed.data.shares.push({ ...structuredClone(template),
        id: `team-paged-${index}`, code: `TP${index}`, manageToken: `team-paged-manage-${index}`, ownerUserId: 'alice',
        files: template.files.map(file => ({ ...file, id: `team-file-${index}`, name: `page-${index}.txt`, storedName: `team-paged-${index}.txt` })),
        deliveryRecipients: index >= 9 ? ['hidden@example.test'] : [], recipientUserIds: index >= 9 ? ['absent-user'] : [],
      })
      await pagingSeed.commit()
      const first = await request('/api/account/team/overview?page=1&limit=8')
      const second = await request('/api/account/team/overview?page=2&limit=8')
      assert.equal(first.response.status, 200, JSON.stringify(first.body))
      assert.equal(first.body.pagination.total, 19)
      assert.equal(first.body.resources.length, 8)
      assert.ok(second.body.resources.every(item => !first.body.resources.some(previous => previous.id === item.id)))
      assert.equal(first.body.resourceSummary.total, 19)
      const last = await request('/api/account/team/overview?page=999&limit=8')
      assert.equal(last.body.pagination.page, 3); assert.equal(last.body.resources.length, 3)
      const memberFirst = await request('/api/account/team/overview?page=1&limit=8', {}, 'bob-token')
      assert.equal(memberFirst.body.pagination.total, 10, JSON.stringify(memberFirst.body))
      assert.equal(memberFirst.body.resourceSummary.total, 10)
      assert.ok(memberFirst.body.resources.every(item => item.id !== 'team-paged-17'))
      const memberLast = await request('/api/account/team/overview?page=999&limit=8', {}, 'bob-token')
      assert.equal(memberLast.body.pagination.page, 2); assert.equal(memberLast.body.resources.length, 2)
      const search = await request('/api/account/team/overview?page=1&limit=8&q=page-1.txt', {}, 'bob-token')
      assert.equal(search.body.pagination.total, 1); assert.equal(search.body.resources[0].id, 'team-paged-1')
      const hidden = await request('/api/account/team/overview?page=1&limit=8&q=page-17.txt', {}, 'bob-token')
      assert.equal(hidden.body.pagination.total, 0); assert.equal(hidden.body.resources.length, 0)
      const pagingCleanup = new RelationalRequestStore(pool)
      await pagingCleanup.select('kq_resource', "legacy_id LIKE 'team-paged-%'", [])
      pagingCleanup.hydrate(); pagingCleanup.data.shares = []
      await pagingCleanup.commit()
      const memberId = after.organizations[org.id].members.find(item => item.userId === 'bob').id
      assert.equal((await request(`/api/account/workspace/members/${memberId}`, { method: 'DELETE' })).response.status, 200)
      assert.equal((await request(`/api/shares/token/${uploaded.body.share.id}`, {}, 'bob-token')).response.status, 403)
      assert.equal((await request('/api/account/workspace/dissolve', { method: 'POST', body: '{}' })).response.status, 200)
    })
    await t.test('SQL administrator login, summaries, resource deletion and multi-batch cleanup', async () => {
      assert.equal((await request('/api/admin/overview')).response.status, 401)
      const login = await request('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: 'sql-fixture-admin', password: 'sql-fixture-test-password' }) })
      assert.equal(login.response.status, 200, JSON.stringify(login.body))
      const cookie = login.response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
      assert.ok(cookie)
      const adminRequest = (url, options = {}) => request(url, { ...options, headers: { cookie } })
      const overview = await adminRequest('/api/admin/overview')
      assert.equal(overview.response.status, 200)
      assert.ok(overview.body.stats.users >= 3)
      const seed = new RelationalRequestStore(pool)
      await seed.account('alice', { records: true }); await seed.account('bob', { records: true })
      await seed.users(['paged'])
      seed.data.users.paged.planExpiresAt = new Date(Date.now() - 10 * 86400000).toISOString()
      seed.data.shares.push({ id: 'plan-expired-share', ownerUserId: 'paged', status: 'active', createdAt: now, files: [], code: 'PLANEXP', manageToken: 'plan-expired-manage' },
        { id: 'explicit-expiry-share', ownerUserId: 'paged', status: 'active', expiresAt: future, createdAt: now, files: [], code: 'PLANLIVE', manageToken: 'plan-live-manage' })
      for (let index = 0; index < 56; index++) seed.data.shares.push({ id: `admin-cleanup-${index}`, ownerUserId: 'alice',
        status: index === 55 ? 'active' : 'closed', createdAt: now, files: [], code: `CLEAN${index}`, manageToken: `cleanup-manage-${index}` })
      seed.data.records.alice.push({ id: 'my_sent:share:admin-cleanup-0', kind: 'share', scope: 'my_sent', shareId: 'admin-cleanup-0', createdAt: now })
      seed.data.records.bob.push({ id: 'received:share:admin-cleanup-0', kind: 'share', scope: 'received', shareId: 'admin-cleanup-0', createdAt: now })
      await seed.commit()
      const beforeCleanup = await adminRequest('/api/admin/overview')
      assert.equal(beforeCleanup.body.resources.find(item => item.id === 'plan-expired-share').status, 'closed')
      assert.equal(beforeCleanup.body.resources.find(item => item.id === 'explicit-expiry-share').status, 'active')
      assert.equal((await adminRequest('/api/admin/resources/share/admin-cleanup-55', { method: 'DELETE' })).response.status, 200)
      const cleaned = await adminRequest('/api/admin/cleanup', { method: 'POST', body: '{}' })
      assert.equal(cleaned.response.status, 200, JSON.stringify(cleaned.body))
      assert.equal(cleaned.body.expiredShares, 56)
      const after = (await loadRelationalMetadata(pool)).metadata
      assert.equal(after.shares.some(item => item.id.startsWith('admin-cleanup-')), false)
      assert.equal(Object.values(after.records).flat().some(item => item.shareId === 'admin-cleanup-0'), false)
      assert.ok(after.shares.some(item => item.id === 'bob-share'))
      assert.equal(after.shares.some(item => item.id === 'plan-expired-share'), false)
      assert.ok(after.shares.some(item => item.id === 'explicit-expiry-share'))
    })
    await t.test('SQL OAuth creates a new account and rejects a disabled existing account', async () => {
      const authorize = async code => {
        const login = await fetch(`${base}/api/auth/login`, { redirect: 'manual' })
        const state = new URL(login.headers.get('location')).searchParams.get('state')
        assert.ok(state)
        return fetch(`${base}/auth/callback?code=${code}&state=${state}`, { redirect: 'manual',
          headers: { cookie: login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') } })
      }
      const result = await authorize('new')
      assert.equal(new URL(result.headers.get('location')).searchParams.get('login'), 'success', logs)
      const sessionCookie = result.headers.getSetCookie().find(value => value.startsWith('kunqiong_session=')).split(';')[0]
      const me = await request('/api/auth/me', { headers: { cookie: sessionCookie } })
      assert.equal(me.body.user.id, 'new-sql-user')
      const repeated = await authorize('new')
      assert.equal(new URL(repeated.headers.get('location')).searchParams.get('login'), 'success', logs)
      const replacementCookie = repeated.headers.getSetCookie().find(value => value.startsWith('kunqiong_session=')).split(';')[0]
      assert.equal((await request('/api/auth/me', { headers: { cookie: sessionCookie } })).response.status, 401)
      await stop()
      await start()
      assert.equal((await request('/api/auth/me', { headers: { cookie: replacementCookie } })).body.user.id, 'new-sql-user')
      const logout = await request('/api/auth/logout', { method: 'POST', body: '{}', headers: { cookie: replacementCookie } })
      assert.equal(logout.response.status, 200)
      assert.match(logout.response.headers.get('set-cookie'), /Max-Age=0/)
      await stop(); await start()
      assert.equal((await request('/api/auth/me', { headers: { cookie: replacementCookie, 'X-Kunqiong-Auth-View': 'identity' } })).body.user, null, 'logout survives process restart')
      const browserLogin = await fetch(`${base}/api/auth/login`, { redirect: 'manual' })
      const browserState = new URL(browserLogin.headers.get('location')).searchParams.get('state')
      const browserHeaders = { accept: 'text/html', cookie: browserLogin.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') }
      const browserCallback = await fetch(`${base}/auth/callback?code=new&state=${browserState}`, { redirect: 'manual', headers: browserHeaders })
      assert.equal(browserCallback.status, 302)
      assert.match(browserCallback.headers.get('location'), /^\/auth\/pending\?state=/)
      let browserResult
      for (let attempt = 0; attempt < 100; attempt++) {
        browserResult = await fetch(`${base}${browserCallback.headers.get('location')}`, { redirect: 'manual', headers: browserHeaders })
        if (browserResult.status === 302) break
        assert.equal(browserResult.status, 200)
        assert.match(await browserResult.text(), /正在完成登录/)
        await delay(20)
      }
      assert.equal(new URL(browserResult.headers.get('location')).searchParams.get('login'), 'success', logs)
      const browserCookie = browserResult.headers.getSetCookie().find(value => value.startsWith('kunqiong_session=')).split(';')[0]
      assert.equal((await request('/api/auth/me', { headers: { cookie: browserCookie, 'X-Kunqiong-Auth-View': 'identity' } })).body.user.id, 'new-sql-user')
      await stop(); await start()
      assert.equal((await request('/api/auth/me', { headers: { cookie: browserCookie, 'X-Kunqiong-Auth-View': 'identity' } })).body.user.id, 'new-sql-user', 'browser progress login survives process restart')
      const disabled = new RelationalRequestStore(pool)
      disabled.data.users['disabled-sql'] = { id: 'disabled-sql', username: 'disabled-sql', status: 'disabled', planId: 'free' }
      await disabled.commit()
      const denied = await authorize('disabled')
      assert.equal(new URL(denied.headers.get('location')).searchParams.get('login'), 'failed')
      assert.ok((await loadRelationalMetadata(pool)).metadata.shares.some(item => item.id === 'bob-share'))
    })
    assert.equal(fs.readFileSync(path.join(fixture, 'storage/metadata.json'), 'utf8'), 'this is intentionally not JSON')
  })
})
