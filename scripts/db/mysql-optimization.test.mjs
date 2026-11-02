import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { boundedPool, positiveSetting } from '../../server/db/bounded-pool.js'
import { cleanupTarget } from '../../server/db/cleanup-outbox.js'
import { backupMysql } from './backup-mysql.mjs'

test('pool creation is lazy; abandoned acquisitions release their late connection', async () => {
  let calls = 0, release = 0, deliver
  const pool = boundedPool({ getConnection() { calls++; return new Promise(resolve => { deliver = resolve }) } }, { acquireTimeoutMs: 15 })
  assert.equal(calls, 0)
  await assert.rejects(pool.getConnection(), error => error.status === 503 && error.code === 'DATABASE_QUEUE_TIMEOUT')
  deliver({ release() { release++ } })
  await delay(0)
  assert.equal(release, 1)
})

test('stalled SQL and transaction acknowledgements destroy their connection', async () => {
  for (const method of ['query', 'execute', 'commit', 'beginTransaction']) {
    let destroyed = false
    const connection = { [method]() { return new Promise(() => {}) }, destroy() { destroyed = true }, release() {} }
    const pool = boundedPool({ async getConnection() { return connection } }, { queryTimeoutMs: 15 })
    const leased = await pool.getConnection()
    await assert.rejects(leased[method]('SELECT 1'), error => error.status === 503 && error.code === 'DATABASE_QUERY_TIMEOUT')
    assert.equal(destroyed, true)
  }
})

test('invalid limits cannot accidentally create unlimited queues', () => {
  for (const value of ['0', '-1', 'NaN', 'Infinity', '100000000']) assert.equal(positiveSetting(value, 50, 1000), 50)
  assert.equal(positiveSetting('25', 50), 25)
})

test('cleanup only accepts descendants of explicit storage domains', () => {
  const root = path.join(os.tmpdir(), 'kq-path-fixture')
  for (const target of [root, path.dirname(root), path.join(root, 'metadata.json'), path.join(root, 'users/../../outside'), ...['users', 'files', 'collections', 'tmp'].map(name => path.join(root, name))]) assert.throws(() => cleanupTarget(root, target, true))
  assert.equal(cleanupTarget(root, path.join(root, 'users/owner/file.txt')).relative, 'users/owner/file.txt')
})

test('failed database dump never produces a completion marker', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kq-backup-failure-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  await assert.rejects(backupMysql(directory, { KUNQIONG_DB_ENABLED: 'true', KUNQIONG_DB_HOST: '127.0.0.1', KUNQIONG_DB_NAME: 'fixture', KUNQIONG_DB_USER: 'fixture', KUNQIONG_MYSQL_DUMP_BIN: process.execPath }))
  assert.deepEqual(await fs.readdir(directory), [])
})

test('an existing complete backup cannot be overwritten by a retry', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kq-backup-existing-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  await fs.writeFile(path.join(directory, 'mysql.sql.gz'), 'keep-original')
  await assert.rejects(backupMysql(directory, { KUNQIONG_DB_ENABLED: 'true', KUNQIONG_DB_HOST: '127.0.0.1', KUNQIONG_DB_NAME: 'fixture', KUNQIONG_DB_USER: 'fixture' }), error => error.code === 'BACKUP_ALREADY_EXISTS')
  assert.equal(await fs.readFile(path.join(directory, 'mysql.sql.gz'), 'utf8'), 'keep-original')
  assert.deepEqual(await fs.readdir(directory), ['mysql.sql.gz'])
})
