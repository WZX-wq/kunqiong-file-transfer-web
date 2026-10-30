export async function readRelationalAuthSessionState(pool, tokenHash) {
  const [rows] = await pool.execute(
    `SELECT expires_at > UTC_TIMESTAMP(3) AS is_unexpired,
       revoked_at IS NOT NULL AS is_revoked
     FROM kq_auth_session
     WHERE token_hash = ?
     LIMIT 1`,
    [tokenHash],
  )
  if (!rows.length) return null
  return {
    expired: Number(rows[0].is_unexpired) !== 1,
    revoked: Number(rows[0].is_revoked) === 1,
  }
}
