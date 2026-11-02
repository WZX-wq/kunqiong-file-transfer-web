const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*$/
const PAGE_QUERY_TIMEOUT_MS = 0

function isStatementTimeout(error) {
  return error?.code === 'ER_QUERY_TIMEOUT'
    || error?.code === 'ER_STATEMENT_TIMEOUT'
    || Number(error?.errno) === 3024
    || Number(error?.errno) === 1969
}

export async function readRowsById(connection, table, columns, pageSize = 100) {
  if (!IDENTIFIER.test(table)) throw new TypeError('Invalid table name for paged read')
  if (columns !== '*' && (!Array.isArray(columns) || columns.some(column => !IDENTIFIER.test(column) || column === 'id'))) {
    throw new TypeError('Invalid column list for paged read')
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
    throw new RangeError('Paged read size must be between 1 and 1000')
  }

  const projection = columns === '*' ? '*' : ['id', ...columns].map(column => `\`${column}\``).join(', ')
  const result = []
  let cursor = null
  let currentPageSize = pageSize
  while (true) {
    const predicate = cursor === null ? '' : ' WHERE `id` > ?'
    const sql = `SELECT ${projection} FROM \`${table}\`${predicate} ORDER BY \`id\` LIMIT ${currentPageSize}`
    let rows
    try {
      const options = { sql, timeout: PAGE_QUERY_TIMEOUT_MS }
      const queryResult = cursor === null
        ? await connection.query(options)
        : await connection.query(options, [cursor])
      rows = queryResult[0]
    } catch (error) {
      error.table = table
      // A client timeout can leave unread packets on the socket. Never reuse
      // that connection or resume its transaction with a smaller query.
      if (error?.code === 'PROTOCOL_SEQUENCE_TIMEOUT') connection.destroy()
      if (!isStatementTimeout(error) || currentPageSize === 1) throw error
      currentPageSize = Math.max(1, Math.floor(currentPageSize / 2))
      continue
    }
    if (!Array.isArray(rows)) throw new TypeError(`Paged read for ${table} returned an invalid row set`)
    result.push(...rows)
    if (rows.length < currentPageSize) break

    const nextCursor = rows.at(-1)?.id
    if (nextCursor === null || nextCursor === undefined) throw new Error(`Paged read for ${table} did not return its primary key`)
    if (cursor !== null && BigInt(nextCursor) <= BigInt(cursor)) throw new Error(`Paged read for ${table} did not advance its primary key`)
    cursor = nextCursor
  }
  return result
}
