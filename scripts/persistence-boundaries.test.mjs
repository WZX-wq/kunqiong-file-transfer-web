import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import * as audit from '../server/lib/audit-store.js'

function database() {
  const rows = new Map()
  let failed = false
  return {
    rows,
    fail(value) { failed = value },
    async query(sql, values = []) {
      if (failed) throw Object.assign(new Error('fixture database unavailable'), { code: 'FIXTURE_DB_DOWN' })
      if (sql.includes('CREATE TABLE')) return [[], []]
      if (sql.includes('SELECT payload')) return [[...rows.values()].filter(row => row.critical === values[0]).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(row => ({ payload: JSON.stringify(row.log) })), []]
      throw new Error('Unexpected fixture SQL: ' + sql)
    },
    async execute(sql, values) {
      if (failed) throw Object.assign(new Error('fixture database unavailable'), { code: 'FIXTURE_DB_DOWN' })
      if (sql.includes('INSERT IGNORE')) {
        for (let i = 0; i < values.length; i += 4) rows.set(values[i], { critical: values[i + 1], createdAt: values[i + 2], log: JSON.parse(values[i + 3]) })
        return [{ affectedRows: 1 }]
      }
      if (sql.includes('DELETE FROM')) {
        for (const [id, row] of rows) if (row.createdAt < values[0]) rows.delete(id)
        return [{ affectedRows: 1 }]
      }
      throw new Error('Unexpected fixture SQL: ' + sql)
    },
  }
}
const entry = (id, type = 'access', createdAt = '2026-10-15T00:00:00.000Z') => ({ id, type, action: id, createdAt })

test('database audit is shared by independent hosts and never stored in business snapshots', async () => {
  assert.equal(typeof audit.DatabaseAuditStore, 'function')
  const pool = database()
  const first = new audit.DatabaseAuditStore(pool, row => row, 5)
  await first.initialize([entry('legacy', 'admin')])
  first.append(entry('first-host'))
  await first.flush()
  const second = new audit.DatabaseAuditStore(pool, row => row, 5)
  assert.deepEqual((await second.initialize([])).map(row => row.id).sort(), ['first-host', 'legacy'])
  second.append(entry('second-host', 'security'))
  await second.flush()
  assert.ok((await first.refresh()).some(row => row.id === 'second-host'))
  first.purgeBefore(Date.parse('2026-10-16T00:00:00.000Z'))
  await first.flush()
  assert.equal((await second.refresh()).length, 0)
})

test('database audit write failure is observable at the durable completion boundary', async () => {
  assert.equal(typeof audit.DatabaseAuditStore, 'function')
  const pool = database(), store = new audit.DatabaseAuditStore(pool, row => row, 5)
  await store.initialize([])
  pool.fail(true)
  store.append(entry('not-durable'))
  await assert.rejects(store.flush(), /fixture database unavailable/)
})

test('database audit retries pending rows after a transient recovery', async () => {
  const pool = database(), store = new audit.DatabaseAuditStore(pool, row => row, 5)
  await store.initialize([])
  pool.fail(true)
  store.append(entry('pending-before-recovery', 'security'))
  await assert.rejects(store.flush(), /fixture database unavailable/)
  pool.fail(false)
  store.append(entry('after-recovery'))
  await store.flush()
  assert.deepEqual([...pool.rows.keys()].sort(), ['after-recovery', 'pending-before-recovery'])
})

test('database mode fails before any query when shared protection key is missing', () => {
  const root = path.resolve(import.meta.dirname, '..')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-missing-key-'))
  const copy = (from, to) => {
    fs.mkdirSync(to, { recursive: true })
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      if (entry.isDirectory()) copy(path.join(from, entry.name), path.join(to, entry.name))
      else fs.copyFileSync(path.join(from, entry.name), path.join(to, entry.name))
    }
  }
  copy(path.join(root, 'server'), path.join(directory, 'server'))
  fs.copyFileSync(path.join(root, 'package.json'), path.join(directory, 'package.json'))
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  fs.writeFileSync(path.join(directory, 'server/state.js'), `export const runtime={}; export const databasePool={query:async()=>{throw Error('QUERY_MUST_NOT_RUN')}};`)
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (/^(KUNQIONG_|OAUTH_)/.test(key)) delete env[key]
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', "const {loadMetadata}=await import('./server/lib/metadata-store.js'); await loadMetadata();"], { cwd: directory, windowsHide: true, encoding: 'utf8', env: { ...env, KUNQIONG_DB_HOST: 'fixture', KUNQIONG_DB_NAME: 'fixture', KUNQIONG_DB_USER: 'fixture' } })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /KUNQIONG_DATA_KEY/)
  assert.doesNotMatch(result.stderr, /QUERY_MUST_NOT_RUN/)
})

test('a fresh database host can start without a copied local audit journal', () => {
  const root = path.resolve(import.meta.dirname, '..')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-fresh-audit-host-'))
  const copy = (from, to) => {
    fs.mkdirSync(to, { recursive: true })
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      if (entry.isDirectory()) copy(path.join(from, entry.name), path.join(to, entry.name))
      else fs.copyFileSync(path.join(from, entry.name), path.join(to, entry.name))
    }
  }
  copy(path.join(root, 'server'), path.join(directory, 'server'))
  fs.copyFileSync(path.join(root, 'package.json'), path.join(directory, 'package.json'))
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  fs.mkdirSync(path.join(directory, 'storage'))
  fs.writeFileSync(path.join(directory, 'storage', 'metadata.json'), JSON.stringify({
    auditStorage: 'journal-v1', auditLogs: [], users: {}, sessions: [], shares: [], collections: [],
  }))
  fs.writeFileSync(path.join(directory, 'server/state.js'), `
export const runtime = {};
export const databasePool = {
  query: async sql => {
    if (sql.includes('information_schema')) return [[{ total: 1 }]];
    if (sql.includes('SELECT revision')) return [[], []];
    if (sql.includes('SELECT payload')) return [[], []];
    return [[], []];
  },
  execute: async () => [{ affectedRows: 1 }],
};
`)
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (/^(KUNQIONG_|OAUTH_)/.test(key)) delete env[key]
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const store = await import('./server/lib/metadata-store.js');
    const snapshot = await store.loadMetadata();
    store.initMetadata(snapshot);
    await store.initializeAuditPersistence(value => value);
    console.log(JSON.stringify({ auditStorage: store.metadata.auditStorage, auditLogs: store.metadata.auditLogs }));
  `], {
    cwd: directory,
    windowsHide: true,
    encoding: 'utf8',
    env: { ...env, KUNQIONG_DB_ENABLED: 'true', KUNQIONG_DATA_KEY: '12'.repeat(32), KUNQIONG_DB_HOST: 'fixture', KUNQIONG_DB_NAME: 'fixture', KUNQIONG_DB_USER: 'fixture' },
  })
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout.trim().split('\n').at(-1))
  assert.equal(output.auditStorage, 'mysql-v1')
  assert.deepEqual(output.auditLogs, [])
  assert.equal(fs.existsSync(path.join(directory, 'storage', 'audit')), false)
})
