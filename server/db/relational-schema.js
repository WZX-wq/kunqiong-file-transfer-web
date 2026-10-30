const CREATE_TABLE_PATTERN = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`(?<name>[a-z0-9_]+)`\s*\(([\s\S]*)\)\s*ENGINE\s*=\s*InnoDB\b/i
const ADDITIVE_COLUMN_TYPES = Object.fromEntries([
  'kq_user', 'kq_organization', 'kq_resource', 'kq_resource_file', 'kq_collection_submission',
  'kq_distribution_batch', 'kq_auth_session', 'kq_verification_code', 'kq_upgrade_order',
  'kq_message', 'kq_user_setting', 'kq_guest_usage', 'kq_audit_log',
].map(name => [name, { entity_payload_json: 'json' }]))

export function splitSqlStatements(sql) {
  const statements = []
  let current = ''
  let quote = ''
  let lineComment = false
  let blockComment = false

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index]
    const next = sql[index + 1]

    if (lineComment) {
      if (char === '\n') {
        lineComment = false
        current += '\n'
      }
      continue
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false
        index += 1
      }
      continue
    }
    if (quote) {
      current += char
      if (char === '\\' && quote !== '`' && next) {
        current += next
        index += 1
      } else if (char === quote) {
        if (next === quote) {
          current += next
          index += 1
        } else {
          quote = ''
        }
      }
      continue
    }

    if (char === '-' && next === '-' && (!sql[index + 2] || /\s/.test(sql[index + 2]))) {
      lineComment = true
      index += 1
      continue
    }
    if (char === '#') {
      lineComment = true
      continue
    }
    if (char === '/' && next === '*') {
      blockComment = true
      index += 1
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
      current += char
      continue
    }
    if (char === ';') {
      if (current.trim()) statements.push(current.trim())
      current = ''
      continue
    }
    current += char
  }

  if (quote || blockComment) throw new Error('SQL contains an unterminated quote or block comment')
  if (current.trim()) statements.push(current.trim())
  return statements
}

function namesFromTableBody(body) {
  const columns = []
  const columnTypes = {}
  const indexes = []
  for (const line of body.split(/\r?\n/)) {
    const column = line.match(/^\s*`([a-z0-9_]+)`\s+([a-z]+(?:\(\d+(?:,\d+)?\))?(?:\s+unsigned)?)/i)
    if (column) {
      columns.push(column[1])
      columnTypes[column[1]] = column[2].toLowerCase().replace(/\s+/g, ' ')
    }
    const index = line.match(/^\s*(?:UNIQUE\s+)?KEY\s+`([a-z0-9_]+)`/i)
    if (index) indexes.push(index[1])
    if (/^\s*PRIMARY\s+KEY\s*\(/i.test(line)) indexes.push('PRIMARY')
  }
  return { columns, columnTypes, indexes }
}

export function inspectRelationalSchemaSql(sql) {
  const statements = splitSqlStatements(sql)
  const tables = []

  for (const statement of statements) {
    const match = statement.match(CREATE_TABLE_PATTERN)
    if (!match) throw new Error('Only InnoDB CREATE TABLE statements are allowed in the relational schema file')
    const { columns, columnTypes, indexes } = namesFromTableBody(match[2])
    if (!columns.includes('id') || !columns.includes('gmt_create') || !columns.includes('gmt_modified')) {
      throw new Error(`Table ${match.groups.name} must define id, gmt_create and gmt_modified`)
    }
    if (!indexes.includes('PRIMARY')) throw new Error(`Table ${match.groups.name} must define a primary key`)
    const invalidIndexes = indexes.filter(name => name !== 'PRIMARY' && !/^(uk|idx)_/.test(name))
    if (invalidIndexes.length) {
      throw new Error(`Table ${match.groups.name} contains indexes without uk_/idx_ prefix: ${invalidIndexes.join(', ')}`)
    }
    tables.push({ name: match.groups.name, columns, columnTypes, indexes, statement })
  }

  if (!tables.length) throw new Error('Relational schema file contains no table definitions')
  if (new Set(tables.map(table => table.name)).size !== tables.length) throw new Error('Relational schema file contains duplicate table names')
  return tables
}

export function makeIdempotentCreateStatement(statement) {
  return statement.replace(/^CREATE\s+TABLE\s+/i, 'CREATE TABLE IF NOT EXISTS ')
}

function canonicalColumnType(value) {
  // MySQL 5.7 reports integer display widths that MySQL 8 omits. They do not
  // change the integer range; retain unsigned/zerofill and all real precisions.
  return String(value).toLowerCase().trim().replace(/\s+/g, ' ')
    .replace(/^(tinyint|smallint|mediumint|int|bigint)\(\d+\)(?=\s|$)/, '$1')
}

export function assertTableMatches(actualColumns, actualIndexes, expected, tableInfo) {
  const actualColumnNames = actualColumns.map(column => column.COLUMN_NAME).sort()
  const allowedAdditions = ADDITIVE_COLUMN_TYPES[expected.name] || {}
  const expectedColumnNames = [...expected.columns, ...actualColumnNames.filter(name => allowedAdditions[name])].sort()
  const actualIndexNames = [...new Set(actualIndexes.map(index => index.INDEX_NAME))].sort()
  const expectedIndexNames = [...new Set(expected.indexes)].sort()
  if (JSON.stringify(actualColumnNames) !== JSON.stringify(expectedColumnNames)) {
    throw new Error(`Existing table ${expected.name} has columns that do not match the project schema`)
  }
  if (JSON.stringify(actualIndexNames) !== JSON.stringify(expectedIndexNames)) {
    throw new Error(`Existing table ${expected.name} has indexes that do not match the project schema`)
  }
  for (const column of actualColumns) {
    const expectedType = expected.columnTypes[column.COLUMN_NAME] || allowedAdditions[column.COLUMN_NAME]
    if (canonicalColumnType(column.COLUMN_TYPE) !== canonicalColumnType(expectedType)) {
      throw new Error(`Existing table ${expected.name} has a column type that does not match the project schema: ${column.COLUMN_NAME} is ${column.COLUMN_TYPE}, expected ${expectedType}`)
    }
  }
  if (tableInfo && (tableInfo.ENGINE !== 'InnoDB' || tableInfo.TABLE_COLLATION !== 'utf8mb4_unicode_ci')) {
    throw new Error(`Existing table ${expected.name} must use InnoDB and utf8mb4_unicode_ci`)
  }
}
