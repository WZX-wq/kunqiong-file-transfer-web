import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { DatabaseAuditStore, LocalAuditStore, mergeAuditEntries } from '../server/lib/audit-store.js'
import { normalizeAuditLog } from '../server/lib/metadata-normalizers.js'
import { listValidAuditIds, restoreFixtureAudit } from './lib/read-audit-fixture.mjs'

const normalize = entry => ({ ...entry })
const log = (id, createdAt = '2026-10-12T00:00:00.000Z') => ({ id, action: id, createdAt })
function fixture(limit = 5000) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-audit-unit-'))
  const create = () => new LocalAuditStore(directory, normalize, limit)
  return { directory, create, store: create() }
}

test('relational audit mirror traverses large history in bounded primary-key pages', async () => {
  const queries = []
  const executions = []
  const entries = Array.from({ length: 205 }, (_, index) => log(`audit-${String(index).padStart(4, '0')}`))
  const pool = {
    query: async (sql, values) => {
      queries.push({ sql, values })
      assert.match(sql, /ORDER BY id LIMIT 100$/)
      assert.ok(!sql.includes('OFFSET'))
      return [entries.filter(entry => !values.length || entry.id > values[0]).slice(0, 100).map(payload => ({ id: payload.id, payload: JSON.stringify(payload) }))]
    },
    execute: async (sql, values) => {
      executions.push({ sql, values })
      return [{ affectedRows: entries.length }]
    },
  }
  const store = new DatabaseAuditStore(pool, normalize, 5000)
  store.relationalAuditEnabled = true

  await store.mirrorExistingLogs()

  assert.deepEqual(queries.map(item => item.values), [[], ['audit-0099'], ['audit-0199']])
  assert.deepEqual(executions.map(item => item.values.length / 12), [100, 100, 5])
  assert.deepEqual(executions.flatMap(item => item.values.filter((_, index) => index % 12 === 0)), entries.map(item => item.id))
})

test('deployment audit evidence counts unique logs accepted by the runtime normalizer', () => {
  const entries = [
    { id: 'audit-valid-1', action: ' 文件上传 ' },
    { id: 'audit-invalid', action: '   ' },
    { id: 'audit-valid-1', action: '重复 ID' },
    { id: 'audit-valid-2', action: '文件下载' },
    { action: '缺失稳定 ID' },
  ]

  assert.deepEqual(listValidAuditIds(entries, normalizeAuditLog), ['audit-valid-1', 'audit-valid-2'])
})

test('fixture audit verification uses the runtime priority retention rule', () => {
  const critical = Array.from({ length: 180 }, (_, index) => ({
    id: `critical-${index}`,
    type: 'security',
    action: 'security event',
    createdAt: new Date(Date.UTC(2020, 0, 1, 0, index)).toISOString(),
  }))
  const snapshotAccess = Array.from({ length: 4820 }, (_, index) => ({
    id: `snapshot-access-${index}`,
    type: 'access',
    action: 'read request',
    createdAt: new Date(Date.UTC(2021, 0, 1, 0, index)).toISOString(),
  }))
  const journalAccess = Array.from({ length: 180 }, (_, index) => ({
    id: `journal-access-${index}`,
    type: 'access',
    action: 'read request',
    createdAt: new Date(Date.UTC(2022, 0, 1, 0, index)).toISOString(),
  }))
  const header = JSON.stringify({ version: 1, journalId: 'current-journal' }) + '\n'
  const journal = Buffer.from(header + journalAccess.map(item => JSON.stringify(item)).join('\n') + '\n')
  const snapshot = { logs: [...critical, ...snapshotAccess], appliedJournalId: 'previous-journal', appliedJournalOffset: 0 }
  const restored = restoreFixtureAudit({}, snapshot, journal, { normalize: normalizeAuditLog })
  const expected = mergeAuditEntries([...critical, ...snapshotAccess, ...journalAccess], normalizeAuditLog, 5000)
  const timeOnly = [...critical, ...snapshotAccess, ...journalAccess]
    .sort((first, second) => second.createdAt.localeCompare(first.createdAt))
    .slice(0, 5000)
  const expectedIds = new Set(expected.map(item => item.id))
  const timeOnlyIds = new Set(timeOnly.map(item => item.id))
  const overlap = [...timeOnlyIds].filter(id => expectedIds.has(id))

  assert.equal(expected.length, 5000)
  assert.deepEqual(restored.auditLogs.map(item => item.id), expected.map(item => item.id))
  assert.equal(timeOnly.length, 5000)
  assert.equal(overlap.length, 4820)
  assert.equal(expected.filter(item => item.type === 'security').length, 180)
  assert.equal(timeOnly.filter(item => item.type === 'security').length, 0)
})

test('purged history stays purged if rotation is interrupted before journal reset', () => {
  const { directory, store, create } = fixture()
  store.initialize([])
  store.append(log('old', '2020-01-01T00:00:00.000Z'))
  store.append(log('new'))
  const journal = fs.readFileSync(path.join(directory, 'events.jsonl'))
  assert.equal(store.purgeBefore(Date.parse('2026-01-01')).removed, 1)
  // Model process death after snapshot commit but before the old journal is replaced.
  fs.writeFileSync(path.join(directory, 'events.jsonl'), journal)
  assert.deepEqual(create().initialize([]).map(row => row.id), ['new'])
})

test('retention is bounded and complete records recover after a torn final row', () => {
  const { directory, store, create } = fixture(5)
  store.initialize([log('legacy')])
  for (let i = 0; i < 1005; i++) store.append(log('row-' + i, new Date(Date.parse('2026-10-12') + i).toISOString()))
  fs.appendFileSync(path.join(directory, 'events.jsonl'), '{"id":"unfinished')
  const restored = create()
  assert.deepEqual(restored.initialize([]).map(row => row.id), ['row-1004', 'row-1003', 'row-1002', 'row-1001', 'row-1000'])
  restored.append(log('after', '2026-10-13T00:00:00.000Z'))
  assert.equal(create().initialize([])[0].id, 'after')
  assert.ok(fs.statSync(path.join(directory, 'events.jsonl')).size < 8 * 1024 ** 2)
})

test('retention cap covers critical and access records together', () => {
  const { store } = fixture(3)
  store.initialize([])
  store.append({ id: 'access-1', type: 'access', action: 'access-1', createdAt: '2026-10-15T00:00:03.000Z' })
  store.append({ id: 'security-1', type: 'security', action: 'security-1', createdAt: '2026-10-15T00:00:02.000Z' })
  store.append({ id: 'admin-1', type: 'admin', action: 'admin-1', createdAt: '2026-10-15T00:00:01.000Z' })
  store.append({ id: 'access-2', type: 'access', action: 'access-2', createdAt: '2026-10-15T00:00:00.000Z' })
  assert.equal(store.read().length, 3)
  assert.deepEqual(new Set(store.read().map(row => row.id)), new Set(['access-1', 'security-1', 'admin-1']))
})

test('backup restores checkpoint and journal without dropping subsequent records', () => {
  const { directory, store, create } = fixture()
  store.initialize([log('legacy')])
  store.append(log('appended', '2026-10-13T00:00:00.000Z'))
  fs.writeFileSync(path.join(directory, 'snapshot.json'), '{bad-json')
  assert.deepEqual(create().initialize([]).map(row => row.id), ['appended', 'legacy'])
})

test('malformed complete records are reported instead of silently dropped', () => {
  const { directory, store, create } = fixture()
  store.initialize([])
  fs.appendFileSync(path.join(directory, 'events.jsonl'), '{bad-json}\n')
  assert.throws(() => create().initialize([]), SyntaxError)
})

test('missing migrated audit storage stops startup rather than returning empty history', () => {
  const { store } = fixture()
  assert.throws(() => store.initialize([], true), /快照及备份丢失/)
})

test('concurrent processes preserve all records across checkpoint rotation', async () => {
  const { directory, store, create } = fixture()
  store.initialize([log('legacy')])
  const moduleUrl = pathToFileURL(path.resolve(import.meta.dirname, '../server/lib/audit-store.js')).href
  const code = `
const {LocalAuditStore}=await import(process.argv[3]);
const store=new LocalAuditStore(process.argv[1], row=>row, 5000);
store.initialize([]);
for(let i=0;i<700;i++) store.append({id:process.argv[2]+'-'+i,action:'write',createdAt:new Date(Date.parse('2026-10-13')+i).toISOString()});
`
  await Promise.all(['first', 'second'].map(label => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code, directory, label, moduleUrl], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let errors = ''
    child.stderr.on('data', data => { errors += data })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolve() : reject(Error(errors)))
  })))
  const rows = create().initialize([])
  assert.equal(rows.length, 1401)
  assert.equal(new Set(rows.map(row => row.id)).size, 1401)
  for (const label of ['first', 'second']) for (let i = 0; i < 700; i++) assert.ok(rows.some(row => row.id === label + '-' + i))
})
