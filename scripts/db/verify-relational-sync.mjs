import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { databaseEnabled, relationalSchemaEnabled } from '../../server/config.js'
import { mergeMetadataSnapshots, metadataIdSets } from '../../server/lib/metadata-store.js'
import { databasePool } from '../../server/state.js'
import {
  loadRelationalMetadataFromConnection,
  readRelationalState,
  readRelationalSyncRows,
  synchronizeRelationalMetadata,
} from '../../server/db/relational-store.js'

const TEST_USER_COUNT = 5000
const FIXED_TIME = '2026-10-29 12:00:00.000'
const testPrefix = `__kq_sync_test_${process.pid}_${crypto.randomBytes(6).toString('hex')}_`

if (!databaseEnabled || !relationalSchemaEnabled || !databasePool) {
  throw new Error('Enable the local MySQL relational store in .env before running this verification')
}

function addUser(metadata, id, nickname = id) {
  metadata.users[id] = {
    id,
    username: id,
    nickname,
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
  }
}

async function runRollbackOnly(pool, action) {
  const connection = await pool.getConnection()
  let transactionOpen = false
  try {
    await connection.beginTransaction()
    transactionOpen = true
    const state = await readRelationalState(connection, true)
    if (!state) throw new Error('The live relational metadata state row is missing')
    const loaded = await loadRelationalMetadataFromConnection(connection, state)
    const syncRows = await readRelationalSyncRows(connection, state.counts)
    const result = await action(connection, loaded, syncRows)
    await connection.rollback()
    transactionOpen = false
    return result
  } catch (error) {
    if (transactionOpen) await connection.rollback().catch(() => {})
    throw error
  } finally {
    connection.release()
  }
}

async function measure(action) {
  const startedAt = performance.now()
  const result = await action()
  return { result, durationMs: Math.round((performance.now() - startedAt) * 100) / 100 }
}

async function verifyNoNamespacedRowsRemain() {
  const [rows] = await databasePool.execute(
    'SELECT COUNT(*) AS total FROM kq_user WHERE LEFT(legacy_id, ?) = ?',
    [testPrefix.length, testPrefix],
  )
  assert.equal(Number(rows[0].total), 0, 'rollback left a namespaced synthetic user behind')
}

async function verifyNoOpAndEntityChanges() {
  return runRollbackOnly(databasePool, async (connection, loaded, initialSyncRows) => {
    let syncRows = initialSyncRows
    const noOp = await synchronizeRelationalMetadata(connection, loaded.metadata, loaded.state.counts, syncRows)
    syncRows = noOp.syncCache
    if (noOp.changes.inserted + noOp.changes.updated + noOp.changes.deleted) {
      process.stderr.write(`No-op sync changed rows by table: ${JSON.stringify(noOp.changes.byTable)}\n`)
    }
    assert.equal(noOp.changes.inserted + noOp.changes.updated + noOp.changes.deleted, 0)
    assert.ok(noOp.changes.unchanged > 0)

    const userId = `${testPrefix}mutation`
    const insertedMetadata = structuredClone(loaded.metadata)
    addUser(insertedMetadata, userId)
    const inserted = await synchronizeRelationalMetadata(connection, insertedMetadata, noOp.counts, syncRows)
    syncRows = inserted.syncCache
    assert.equal(inserted.changes.byTable.kq_user.inserted, 1)
    const [beforeRows] = await connection.execute('SELECT id FROM kq_user WHERE legacy_id = ?', [userId])
    assert.equal(beforeRows.length, 1)

    const updatedMetadata = structuredClone(insertedMetadata)
    updatedMetadata.users[userId].nickname = 'updated-in-transaction'
    updatedMetadata.users[userId].updatedAt = '2026-10-29 13:00:00.000'
    const updated = await synchronizeRelationalMetadata(connection, updatedMetadata, inserted.counts, syncRows)
    syncRows = updated.syncCache
    assert.equal(updated.changes.byTable.kq_user.updated, 1)
    const [afterRows] = await connection.execute('SELECT id FROM kq_user WHERE legacy_id = ?', [userId])
    assert.equal(String(afterRows[0].id), String(beforeRows[0].id), 'update replaced the stable internal primary key')

    const deletedMetadata = structuredClone(updatedMetadata)
    delete deletedMetadata.users[userId]
    const deleted = await synchronizeRelationalMetadata(connection, deletedMetadata, updated.counts, syncRows)
    assert.equal(deleted.changes.byTable.kq_user.deleted, 1)
    assert.equal(deleted.counts.kq_user, loaded.state.counts.kq_user)
    assert.equal((await readRelationalState(connection)).revision, loaded.revision)
    return { unchangedRows: noOp.changes.unchanged, stablePrimaryKey: true, insertUpdateDelete: true }
  })
}

async function verifyCapacity() {
  return runRollbackOnly(databasePool, async (connection, loaded, initialSyncRows) => {
    let syncRows = initialSyncRows
    const largeMetadata = structuredClone(loaded.metadata)
    for (let index = 0; index < TEST_USER_COUNT; index += 1) {
      addUser(largeMetadata, `${testPrefix}capacity_${String(index).padStart(4, '0')}`)
    }

    const populated = await synchronizeRelationalMetadata(connection, largeMetadata, loaded.state.counts, syncRows)
    syncRows = populated.syncCache
    assert.equal(populated.changes.byTable.kq_user.inserted, TEST_USER_COUNT)

    const noOp = await measure(() => synchronizeRelationalMetadata(connection, largeMetadata, populated.counts, syncRows))
    syncRows = noOp.result.syncCache
    assert.equal(noOp.result.changes.inserted + noOp.result.changes.updated + noOp.result.changes.deleted, 0)
    assert.ok(noOp.result.changes.unchanged >= TEST_USER_COUNT)

    const changedMetadata = structuredClone(largeMetadata)
    const changedUserId = `${testPrefix}capacity_0500`
    changedMetadata.users[changedUserId].nickname = 'one-row-updated'
    changedMetadata.users[changedUserId].updatedAt = '2026-10-29 14:00:00.000'
    const oneRowUpdate = await measure(() => synchronizeRelationalMetadata(connection, changedMetadata, noOp.result.counts, syncRows))
    assert.equal(oneRowUpdate.result.changes.byTable.kq_user.updated, 1)
    assert.equal(oneRowUpdate.result.changes.byTable.kq_user.inserted, 0)
    assert.equal(oneRowUpdate.result.changes.byTable.kq_user.deleted, 0)
    assert.equal((await readRelationalState(connection)).revision, loaded.revision)

    return {
      syntheticUsers: TEST_USER_COUNT,
      noOpCommitEquivalentMs: noOp.durationMs,
      oneRowUpdateMs: oneRowUpdate.durationMs,
      noOpRowsSkipped: noOp.result.changes.unchanged,
    }
  })
}

async function verifyConcurrentLockAndRollback() {
  const first = await databasePool.getConnection()
  const second = await databasePool.getConnection()
  let firstTransactionOpen = false
  let secondTransactionOpen = false
  try {
    await first.beginTransaction()
    firstTransactionOpen = true
    const firstState = await readRelationalState(first, true)
    const firstLoaded = await loadRelationalMetadataFromConnection(first, firstState)
    const syncRows = await readRelationalSyncRows(first, firstState.counts)
    const base = structuredClone(firstLoaded.metadata)
    const remote = structuredClone(base)
    const local = structuredClone(base)
    addUser(remote, `${testPrefix}merge_a`)
    addUser(local, `${testPrefix}merge_b`)
    const merged = mergeMetadataSnapshots(remote, local, metadataIdSets(base))
    assert.ok(merged.users[`${testPrefix}merge_a`])
    assert.ok(merged.users[`${testPrefix}merge_b`])

    const syntheticId = `${testPrefix}concurrent_uncommitted`
    const writerMetadata = structuredClone(firstLoaded.metadata)
    addUser(writerMetadata, syntheticId)
    const staged = await synchronizeRelationalMetadata(first, writerMetadata, firstState.counts, syncRows)
    assert.equal(staged.changes.byTable.kq_user.inserted, 1)

    await second.beginTransaction()
    secondTransactionOpen = true
    let secondResolved = false
    const waitingState = readRelationalState(second, true).then(state => {
      secondResolved = true
      return state
    })
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.equal(secondResolved, false, 'second metadata writer did not wait for the revision-row lock')

    await first.rollback()
    firstTransactionOpen = false
    const secondState = await waitingState
    assert.equal(secondState.revision, firstState.revision)
    const [uncommittedRows] = await second.execute('SELECT id FROM kq_user WHERE legacy_id = ?', [syntheticId])
    assert.equal(uncommittedRows.length, 0, 'second writer observed data that the first transaction rolled back')
    await second.rollback()
    secondTransactionOpen = false
    return { independentChangesMerge: true, revisionRowSerializesWriters: true, rollbackInvisibleToNextWriter: true }
  } finally {
    if (firstTransactionOpen) await first.rollback().catch(() => {})
    if (secondTransactionOpen) await second.rollback().catch(() => {})
    first.release()
    second.release()
  }
}

try {
  const noOpAndEntityChanges = await verifyNoOpAndEntityChanges()
  await verifyNoNamespacedRowsRemain()
  const concurrentLockAndRollback = await verifyConcurrentLockAndRollback()
  await verifyNoNamespacedRowsRemain()
  const capacity = await verifyCapacity()
  await verifyNoNamespacedRowsRemain()
  process.stdout.write(`${JSON.stringify({
    ok: true,
    mode: 'local MySQL transactions; every synthetic mutation rolled back',
    noOpAndEntityChanges,
    concurrentLockAndRollback,
    capacity,
    durableTestRows: 0,
    metadataRevisionCommittedByTest: false,
  })}\n`)
} catch (error) {
  process.stderr.write(`Relational sync verification failed: ${error.stack || error.message}\n`)
  process.exitCode = 1
} finally {
  await databasePool.end().catch(() => {})
}
