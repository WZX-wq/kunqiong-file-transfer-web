import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldSkipRelationalSchemaPreflight } from '../../server/db/deployment-preflight.js'

const expectedMigrations = {
  '001-existing-features-relational-schema': 'schema-checksum',
  '003-upload-session-storage': 'upload-checksum',
}

test('skips full inspection only when every current migration and relational state are present', () => {
  assert.equal(shouldSkipRelationalSchemaPreflight({
    expectedMigrations,
    appliedMigrations: { ...expectedMigrations },
    hasRelationalState: true,
  }), true)
})

test('requires full inspection when a migration is missing or changed', () => {
  assert.equal(shouldSkipRelationalSchemaPreflight({
    expectedMigrations,
    appliedMigrations: { ...expectedMigrations, '003-upload-session-storage': 'old-checksum' },
    hasRelationalState: true,
  }), false)
  assert.equal(shouldSkipRelationalSchemaPreflight({
    expectedMigrations,
    appliedMigrations: { '001-existing-features-relational-schema': expectedMigrations['001-existing-features-relational-schema'] },
    hasRelationalState: true,
  }), false)
})

test('requires full inspection before relational data initialization', () => {
  assert.equal(shouldSkipRelationalSchemaPreflight({
    expectedMigrations,
    appliedMigrations: { ...expectedMigrations },
    hasRelationalState: false,
  }), false)
})
