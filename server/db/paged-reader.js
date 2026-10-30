const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*$/

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
  while (true) {
    const predicate = cursor === null ? '' : ' WHERE `id` > ?'
    const sql = `SELECT ${projection} FROM \`${table}\`${predicate} ORDER BY \`id\` LIMIT ${pageSize}`
    const [rows] = cursor === null
      ? await connection.execute(sql)
      : await connection.execute(sql, [cursor])
    if (!Array.isArray(rows)) throw new TypeError(`Paged read for ${table} returned an invalid row set`)
    result.push(...rows)
    if (rows.length < pageSize) break

    const nextCursor = rows.at(-1)?.id
    if (nextCursor === null || nextCursor === undefined) throw new Error(`Paged read for ${table} did not return its primary key`)
    if (cursor !== null && BigInt(nextCursor) <= BigInt(cursor)) throw new Error(`Paged read for ${table} did not advance its primary key`)
    cursor = nextCursor
  }
  return result
}
