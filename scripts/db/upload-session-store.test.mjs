import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { databasePool } from '../../server/state.js'
import {
  importLegacyUploadSessionManifests, MySqlUploadSessionStore, UPLOAD_SESSION_TABLE_SQL,
} from '../../server/db/upload-session-store.js'

test.after(async () => { await databasePool?.end() })

test('MySQL upload sessions import legacy JSON, survive reload, update, expire, and delete', { skip: !databasePool }, async () => {
  const connection = await databasePool.getConnection()
  const tableName = `kq_upload_session_test_${process.pid}_${Date.now().toString(36)}`
  const temporaryTableSql = UPLOAD_SESSION_TABLE_SQL.replace(
    'CREATE TABLE IF NOT EXISTS `kq_upload_session`',
    `CREATE TEMPORARY TABLE \`${tableName}\``,
  )
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kunqiong-upload-session-'))
  const sessionId = '0123456789abcdef01234567'
  const directory = path.join(root, sessionId)
  const manifest = {
    id: sessionId,
    chunkSize: 4 * 1024 * 1024,
    files: [{ name: 'handover.zip', relativePath: 'handover.zip', size: 1024, mimeType: 'application/zip' }],
    options: { passwordHash: 'hashed-secret' },
    participantName: 'legacy participant',
    ownerGuestId: 'private-owner-id',
    createdAt: new Date().toISOString(),
  }

  try {
    await connection.query(temporaryTableSql)
    const store = new MySqlUploadSessionStore(connection, { tableName })
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(directory, 'session.json'), JSON.stringify(manifest))

    assert.equal(await importLegacyUploadSessionManifests(root, store), 1)
    assert.deepEqual(await new MySqlUploadSessionStore(connection, { tableName }).loadAll(), [manifest])
    const [[stored]] = await connection.query(`SELECT session_digest, manifest_ciphertext FROM \`${tableName}\``)
    assert.ok(!stored.manifest_ciphertext.includes(sessionId))
    assert.ok(!stored.manifest_ciphertext.includes('private-owner-id'))
    assert.ok(!stored.manifest_ciphertext.includes('legacy participant'))

    const staleLocalManifest = { ...manifest, participantName: 'stale local copy' }
    await fs.writeFile(path.join(directory, 'session.json'), JSON.stringify(staleLocalManifest))
    assert.equal(await importLegacyUploadSessionManifests(root, store), 0)
    assert.equal((await store.loadAll())[0].participantName, 'legacy participant')

    const updated = { ...manifest, completion: { status: 'complete', finishedAt: new Date().toISOString() } }
    await store.save(updated)
    assert.deepEqual(await new MySqlUploadSessionStore(connection, { tableName }).loadAll(), [updated])

    const expiredId = 'fedcba9876543210fedcba98'
    await store.save({ ...manifest, id: expiredId, createdAt: new Date(Date.now() - 2 * 86400000).toISOString() })
    assert.equal(await store.deleteExpired(), 1)
    assert.equal(await store.delete(sessionId), true)
    assert.deepEqual(await store.loadAll(), [])

    const brokenStore = new MySqlUploadSessionStore({ execute: async () => { throw new Error('database unavailable') } }, { tableName })
    await assert.rejects(brokenStore.save(manifest), /database unavailable/)
  } finally {
    await connection.query(`DROP TEMPORARY TABLE IF EXISTS \`${tableName}\``).catch(() => {})
    connection.release()
    await fs.rm(root, { recursive: true, force: true })
  }
})
