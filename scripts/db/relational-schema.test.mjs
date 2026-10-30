import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertTableMatches, inspectRelationalSchemaSql, makeIdempotentCreateStatement, splitSqlStatements } from '../../server/db/relational-schema.js'
import { UPLOAD_SESSION_TABLE_SQL } from '../../server/db/upload-session-store.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const schemaPath = path.join(projectRoot, 'docs', '数据库设计-2026-10-29', '03-现有功能关系表设计.sql')

test('splits statements while preserving semicolons inside strings and comments', () => {
  assert.deepEqual(splitSqlStatements("-- comment;\nSELECT 'a;b'; # ignored;\nSELECT `x;y`; /* block; */ SELECT 3;"), [
    "SELECT 'a;b'", 'SELECT `x;y`', 'SELECT 3',
  ])
})

test('project schema contains 21 named InnoDB tables with primary keys and standard indexes', () => {
  const tables = inspectRelationalSchemaSql(fs.readFileSync(schemaPath, 'utf8'))
  assert.equal(tables.length, 21)
  assert.ok(tables.every(table => table.name.startsWith('kq_')))
  assert.ok(tables.every(table => table.columns.includes('id') && table.indexes.includes('PRIMARY')))
  assert.ok(tables.every(table => table.columnTypes.id === 'bigint unsigned'))
  assert.ok(tables.some(table => table.name === 'kq_distribution_assignment'))
  assert.ok(tables.some(table => table.name === 'kq_collection_task'))
})

test('rejects schema statements that could alter or remove existing data', () => {
  assert.throws(() => inspectRelationalSchemaSql('DROP TABLE `kq_user`;'), /Only InnoDB CREATE TABLE statements/)
  assert.throws(() => inspectRelationalSchemaSql('CREATE TABLE `x` (`id` BIGINT PRIMARY KEY) ENGINE=InnoDB;'), /gmt_create and gmt_modified/)
})

test('upload session state has its own additive InnoDB migration table', () => {
  const [table] = inspectRelationalSchemaSql(UPLOAD_SESSION_TABLE_SQL)
  assert.equal(table.name, 'kq_upload_session')
  assert.deepEqual(table.indexes.sort(), ['PRIMARY', 'idx_upload_session_expiry', 'uk_upload_session_digest'])
  assert.equal(table.columnTypes.manifest_ciphertext, 'longtext')
})

test('makes bootstrap DDL retryable without allowing an existing table to go unchecked', () => {
  assert.equal(makeIdempotentCreateStatement('CREATE TABLE `kq_user` (`id` BIGINT);'), 'CREATE TABLE IF NOT EXISTS `kq_user` (`id` BIGINT);')
  const expected = {
    name: 'kq_user', columns: ['id', 'gmt_create'], columnTypes: { id: 'bigint unsigned', gmt_create: 'datetime(3)' },
    indexes: ['PRIMARY', 'uk_user_legacy_id'],
  }
  assert.doesNotThrow(() => assertTableMatches(
    [{ COLUMN_NAME: 'id', COLUMN_TYPE: 'bigint unsigned' }, { COLUMN_NAME: 'gmt_create', COLUMN_TYPE: 'datetime(3)' }],
    [{ INDEX_NAME: 'PRIMARY' }, { INDEX_NAME: 'uk_user_legacy_id' }],
    expected,
    { ENGINE: 'InnoDB', TABLE_COLLATION: 'utf8mb4_unicode_ci' },
  ))
  assert.throws(() => assertTableMatches([{ COLUMN_NAME: 'id', COLUMN_TYPE: 'bigint' }], [{ INDEX_NAME: 'PRIMARY' }], expected), /columns that do not match/)
  assert.throws(() => assertTableMatches(
    [{ COLUMN_NAME: 'id', COLUMN_TYPE: 'bigint' }, { COLUMN_NAME: 'gmt_create', COLUMN_TYPE: 'datetime(3)' }],
    [{ INDEX_NAME: 'PRIMARY' }, { INDEX_NAME: 'uk_user_legacy_id' }], expected,
  ), /column type that does not match/)
  assert.doesNotThrow(() => assertTableMatches(
    [
      { COLUMN_NAME: 'id', COLUMN_TYPE: 'bigint unsigned' },
      { COLUMN_NAME: 'gmt_create', COLUMN_TYPE: 'datetime(3)' },
      { COLUMN_NAME: 'entity_payload_json', COLUMN_TYPE: 'json' },
    ],
    [{ INDEX_NAME: 'PRIMARY' }, { INDEX_NAME: 'uk_user_legacy_id' }], expected,
  ))
  assert.throws(() => assertTableMatches(
    [
      { COLUMN_NAME: 'id', COLUMN_TYPE: 'bigint unsigned' },
      { COLUMN_NAME: 'gmt_create', COLUMN_TYPE: 'datetime(3)' },
      { COLUMN_NAME: 'unexpected_column', COLUMN_TYPE: 'json' },
    ],
    [{ INDEX_NAME: 'PRIMARY' }, { INDEX_NAME: 'uk_user_legacy_id' }], expected,
  ), /columns that do not match/)
})
