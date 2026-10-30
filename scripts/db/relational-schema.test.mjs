import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertTableMatches, inspectRelationalSchemaSql, makeIdempotentCreateStatement, splitSqlStatements } from '../../server/db/relational-schema.js'
import { UPLOAD_SESSION_TABLE_SQL } from '../../server/db/upload-session-store.js'
import { inspectExistingRelationalSchema } from '../../server/db/apply-relational-schema.js'

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

test('accepts MySQL 5.7 integer display widths while rejecting range and precision changes', () => {
  for (const type of ['tinyint', 'smallint', 'mediumint', 'int', 'bigint']) {
    const expected = { name: 'fixture', columns: ['id'], columnTypes: { id: `${type} unsigned` }, indexes: ['PRIMARY'] }
    assert.doesNotThrow(() => assertTableMatches([{ COLUMN_NAME: 'id', COLUMN_TYPE: `${type}(20) unsigned` }], [{ INDEX_NAME: 'PRIMARY' }], expected))
    assert.throws(() => assertTableMatches([{ COLUMN_NAME: 'id', COLUMN_TYPE: `${type}(20)` }], [{ INDEX_NAME: 'PRIMARY' }], expected), /column type/)
    assert.throws(() => assertTableMatches([{ COLUMN_NAME: 'id', COLUMN_TYPE: `${type}(20) unsigned zerofill` }], [{ INDEX_NAME: 'PRIMARY' }], expected), /column type/)
  }
  for (const [expectedType, actualType] of [['varchar(20)', 'varchar(21)'], ['datetime(3)', 'datetime(6)'], ['decimal(20,3)', 'decimal(20,4)'], ['bigint unsigned', 'int(11) unsigned']]) {
    assert.throws(() => assertTableMatches([{ COLUMN_NAME: 'id', COLUMN_TYPE: actualType }], [{ INDEX_NAME: 'PRIMARY' }], {
      name: 'fixture', columns: ['id'], columnTypes: { id: expectedType }, indexes: ['PRIMARY'],
    }), /column type/)
  }
})

test('deployment schema preflight uses SELECT only and tolerates absent tables', async () => {
  const schemaSql = fs.readFileSync(schemaPath, 'utf8')
  const tables = inspectRelationalSchemaSql(schemaSql)
  let incompatible = false
  const connection = { execute: async (sql, [name]) => {
    assert.match(sql, /^SELECT /)
    const table = tables.find(item => item.name === name)
    if (sql.includes('information_schema.COLUMNS')) {
      if (name !== 'kq_user') return [[]]
      return [table.columns.map(COLUMN_NAME => ({ COLUMN_NAME, COLUMN_TYPE: incompatible && COLUMN_NAME === 'id' ? 'int(11)' : table.columnTypes[COLUMN_NAME].replace(/^bigint unsigned$/, 'bigint(20) unsigned') }))]
    }
    if (sql.includes('information_schema.STATISTICS')) return [table.indexes.map(INDEX_NAME => ({ INDEX_NAME }))]
    if (sql.includes('information_schema.TABLES')) return [[{ ENGINE: 'InnoDB', TABLE_COLLATION: 'utf8mb4_unicode_ci' }]]
    throw new Error('Unexpected query')
  } }
  assert.deepEqual(await inspectExistingRelationalSchema({ connection, schemaSql }), { existingTableCount: 1 })
  incompatible = true
  await assert.rejects(inspectExistingRelationalSchema({ connection, schemaSql }), /kq_user.*id is int\(11\)/)
})
