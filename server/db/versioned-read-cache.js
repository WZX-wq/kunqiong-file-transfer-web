// Cache only rows actually requested. MySQL checks each predicate and version
// on every read; no startup scan, local JSON or stale fallback is involved.
const pools = new WeakMap()
const MAX_BYTES = 8 * 1024 * 1024
const MAX_ROWS = 512
const supported = new Set(['kq_user', 'kq_organization', 'kq_upgrade_order', 'kq_message'])
// Serving reads reconstruct orders from these columns and the encrypted
// extension. entitlement_json is a duplicate write snapshot; transaction
// conflict checks still fetch the complete row directly from MySQL.
const orderColumns = 'id, legacy_id, order_no, user_id, plan_id, status, amount, pay_type, remote_order_no, paid_at, remote_expire_at, gmt_create, gmt_modified, write_version, entity_payload_json'
const stamp = row => `${row.write_version}:${row.gmt_modified instanceof Date ? row.gmt_modified.toISOString() : row.gmt_modified}`

export async function readVersionedRows(pool, table, where, params, suffix = '', verifiedVersions = null) {
  if (!supported.has(table)) throw new TypeError('Unsupported versioned read table')
  let cache = pools.get(pool)
  if (!cache) { cache = { rows: new Map(), bytes: 0 }; pools.set(pool, cache) }
  // A live session join can supply the same authoritative version projection.
  // Reuse it instead of issuing a second version probe for the joined user.
  const versions = verifiedVersions ?? (await pool.query(`SELECT id, write_version, gmt_modified, COALESCE(OCTET_LENGTH(entity_payload_json), 0) + 1024 AS read_bytes FROM \`${table}\` WHERE ${where}${suffix}`, params))[0]
  const fetched = new Map()
  const batches = []
  let batch = [], bytes = 0
  for (const version of versions) {
    const entry = cache.rows.get(`${table}:${version.id}`)
    if (entry && entry.stamp === stamp(version)) continue
    const size = Number(version.read_bytes) || 1024
    if (batch.length && (bytes + size > 32 * 1024 || batch.length >= (table === 'kq_upgrade_order' ? 2 : 100))) { batches.push(batch); batch = []; bytes = 0 }
    batch.push(version.id); bytes += size
  }
  if (batch.length) batches.push(batch)
  // Batch small cold rows; keep large encrypted entities separate. This avoids
  // both N+1 queries for small teams and oversized multi-entity responses.
  for (const ids of batches) {
    const predicate = ids.length === 1 ? 'id = ?' : `id IN (${ids.map(() => '?').join(', ')})`
    const [loaded] = await pool.query(`SELECT ${table === 'kq_upgrade_order' ? orderColumns : '*'} FROM \`${table}\` WHERE (${where}) AND ${predicate}`, [...params, ...ids])
    for (const row of loaded) fetched.set(String(row.id), row)
  }
  const rows = []
  for (const version of versions) {
    const key = `${table}:${version.id}`, entry = cache.rows.get(key)
    if (entry && entry.stamp === stamp(version)) {
      cache.rows.delete(key); cache.rows.set(key, entry)
      rows.push(structuredClone(entry.row))
      continue
    }
    const row = fetched.get(String(version.id))
    if (!row) continue
    rows.push(row)
    if (entry) { cache.bytes -= entry.bytes; cache.rows.delete(key) }
    const bytes = Buffer.byteLength(JSON.stringify(row))
    if (bytes > MAX_BYTES) continue
    cache.rows.set(key, { stamp: stamp(row), row: structuredClone(row), bytes })
    cache.bytes += bytes
    while (cache.bytes > MAX_BYTES || cache.rows.size > MAX_ROWS) {
      const oldest = cache.rows.keys().next().value
      cache.bytes -= cache.rows.get(oldest).bytes
      cache.rows.delete(oldest)
    }
  }
  return rows
}
