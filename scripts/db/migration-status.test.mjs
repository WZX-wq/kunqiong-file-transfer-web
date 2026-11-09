import test from 'node:test'
import assert from 'node:assert/strict'
import { missingMigrationKeys } from './migration-status.mjs'

test('reports only migration markers missing from the provisioned database', () => {
  assert.deepEqual(
    missingMigrationKeys(['001', '003'], ['001', '002', '003']),
    ['002'],
  )
})

test('does not report duplicates as missing', () => {
  assert.deepEqual(
    missingMigrationKeys(['001', '001', '002'], ['001', '002']),
    [],
  )
})
