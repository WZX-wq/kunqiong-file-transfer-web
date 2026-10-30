import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { classifyMigrationSource, hasValidImportedCountManifest } from './lib/migration-source-verification.mjs'

test('a migration completed after backup must match the backup source exactly', () => {
  assert.equal(classifyMigrationSource(
    { completedAt: '2026-10-30T10:00:01.000Z' },
    '2026-10-30T10:00:00.000Z',
  ), 'current-deployment')
})

test('a durable migration from an earlier deployment is not compared with a newer backup', () => {
  assert.equal(classifyMigrationSource(
    { completedAt: '2026-10-30T09:59:59.000Z', sourceSha256: '6436ee32b2a05727f79b90ebb750acd177a190ddeb428e971398496ae37dd3d6' },
    '2026-10-30T10:00:00.000Z',
  ), 'previously-migrated')
})

test('missing migration or backup times fail closed', () => {
  assert.equal(classifyMigrationSource({ completedAt: 'invalid' }, '2026-10-30T10:00:00.000Z'), 'unverifiable')
  assert.equal(classifyMigrationSource({ completedAt: '2026-10-30T10:00:01.000Z' }, null), 'unverifiable')
})

test('the classifier source embeds as valid module code for the container probe', () => {
  const source = `const classifyMigrationSource = ${classifyMigrationSource.toString()};\nconst hasValidImportedCountManifest = ${hasValidImportedCountManifest.toString()};\n`
  const result = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: source, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
})

test('historical imported row counts remain valid when live rows have since changed', () => {
  assert.equal(hasValidImportedCountManifest(
    { kq_user: 14, kq_account_record: 42 },
    { kq_user: 14, kq_account_record: 38 },
  ), true)
})

test('imported row-count receipts reject unknown tables and invalid counts', () => {
  const current = { kq_user: 14, kq_account_record: 38 }
  assert.equal(hasValidImportedCountManifest({ kq_user: 14, kq_unknown: 1 }, current), false)
  assert.equal(hasValidImportedCountManifest({ kq_user: -1 }, current), false)
  assert.equal(hasValidImportedCountManifest({ kq_user: 1.5 }, current), false)
  assert.equal(hasValidImportedCountManifest({ kq_user: null }, current), false)
})
