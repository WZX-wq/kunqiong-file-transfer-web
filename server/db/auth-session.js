import { keyedDigest, protectCredential } from '../lib/private-key.js'
import { packEntity } from './normalized-codec.js'
import { lockWriteScope } from './write-locks.js'
import { isTransactionConnectionError, isRetryableCommitError } from './commit-retry.js'
import { readVersionedRows } from './versioned-read-cache.js'

// Check the live session on every request, but transfer an unchanged historical
// user payload only once. The joined row version is authoritative; this never
// falls back to cached authorization when MySQL is unavailable.
export async function readAuthSession(pool, token) {
  if (!token) return null
  const [rows] = await pool.query({
    sql: `SELECT s.*, u.id, u.legacy_id, u.status, u.write_version, u.gmt_modified, replacement.id FROM kq_auth_session s JOIN kq_user u ON u.id = s.user_id
      LEFT JOIN kq_auth_session replacement ON replacement.user_id = s.user_id
        AND replacement.gmt_create = s.revoked_at AND replacement.id > s.id
      WHERE s.token_hash = ? LIMIT 1`,
    nestTables: true,
  }, [keyedDigest(`session-cookie:${token}`)])
  const result = rows[0]
  if (!result) return null
  const [user] = await readVersionedRows(pool, 'kq_user', 'id = ?', [result.u.id], '', [result.u])
  return user ? { ...result, u: { ...user, ...(result.u.status ? { status: result.u.status } : {}) } } : null
}

// Keep ordinary header checks compact. A data image or a URL truncated to the
// 500-character column needs the user's complete avatar, checked by row version.
export async function readAuthIdentity(pool, token) {
  if (!token) return null
  const [rows] = await pool.query({ sql: `SELECT s.expires_at, s.revoked_at, u.legacy_id, u.username, u.nickname,
    u.id, u.write_version, u.gmt_modified, u.email, u.phone, u.avatar_url, u.status, u.provider, u.login_methods_json, u.plan_json, replacement.id
    FROM kq_auth_session s JOIN kq_user u ON u.id = s.user_id
    LEFT JOIN kq_auth_session replacement ON replacement.user_id = s.user_id
      AND replacement.gmt_create = s.revoked_at AND replacement.id > s.id
    WHERE s.token_hash = ? LIMIT 1`, nestTables: true }, [keyedDigest(`session-cookie:${token}`)])
  const result = rows[0]
  if (!result) return null
  const avatar = result.u.avatar_url || ''
  if (avatar && (!/^https?:\/\//i.test(avatar) || avatar.length >= 500)) {
    const [user] = await readVersionedRows(pool, 'kq_user', 'id = ?', [result.u.id], '', [result.u])
    if (!user) return null
    result.u = { ...user, ...(result.u.status ? { status: result.u.status } : {}) }
  }
  return result
}

const sqlDate = value => new Date(value).toISOString().slice(0, 23).replace('T', ' ')

// Existing profiles are not rewritten during login. The shared user lock also
// serializes against profile/disabled-account writes in RelationalRequestStore.
// Only a compact session identity is stored; readers join the current user.
export async function issueExistingAuthSession(pool, userId, session) {
  if (!userId || session.user?.id !== userId) return false
  const storageId = keyedDigest(`session-id:${session.id}`).slice(0, 120)
  const tokenHash = keyedDigest(`session-cookie:${session.id}`)
  const row = { expires_at: sqlDate(session.expiresAt), revoked_at: null }
  const compact = { ...session, user: { id: userId } }
  const payload = JSON.stringify(protectCredential(JSON.stringify(packEntity('kq_auth_session', compact, row)), `relational:session:${storageId}`))
  const credential = session.apiWebToken ? protectCredential(session.apiWebToken, `session:${session.id}`) : null
  for (let attempt = 0; ; attempt++) {
    const connection = await pool.getConnection()
    let commitSent = false
    try {
      await connection.beginTransaction()
      await lockWriteScope(connection, [`user:${userId}`])
      const [users] = await connection.query('SELECT id, status FROM kq_user WHERE legacy_id = ? LIMIT 1 FOR UPDATE', [userId])
      if (!users.length) { await connection.rollback(); return false }
      if (users[0].status !== 'active') throw Object.assign(new Error('Account disabled'), { code: 'ACCOUNT_DISABLED' })
      // Use the same explicit timestamp in both statements. The join above can
      // identify replacement even for encrypted legacy sessions, without reading
      // and rewriting every old payload. Logout never creates a replacement row.
      await connection.query(`UPDATE kq_auth_session SET revoked_at = ?, write_version = write_version + 1
        WHERE user_id = ? AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP(3)`, [sqlDate(session.createdAt), users[0].id])
      await connection.query(`INSERT INTO kq_auth_session
        (legacy_id, user_id, token_hash, provider_credential_ciphertext, expires_at, revoked_at, entity_payload_json, gmt_create)
        VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
      [storageId, users[0].id, tokenHash, credential, row.expires_at, payload, sqlDate(session.createdAt)])
      commitSent = true
      await connection.commit()
      return true
    } catch (error) {
      const lost = isTransactionConnectionError(error)
      if (lost) connection.destroy()
      else await connection.rollback().catch(() => {})
      if (commitSent) {
        // COMMIT is never replayed. A fresh live read may prove the exact random
        // token was committed; otherwise fail closed and issue no cookie.
        if (lost) {
          const [confirmed] = await pool.query(`SELECT s.id FROM kq_auth_session s JOIN kq_user u ON u.id = s.user_id
            WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > UTC_TIMESTAMP(3) AND u.status = 'active' LIMIT 1`, [tokenHash])
          if (confirmed.length) return true
        }
        throw error
      }
      if (attempt >= 2 || (!lost && !isRetryableCommitError(error))) throw error
      console.warn(JSON.stringify({ event: 'oauth_session_retry', attempt: attempt + 1, code: error.code }))
    } finally { connection.release() }
  }
}

export async function revokeAuthSession(pool, token) {
  if (!token) return
  // Retain the encrypted credential for existing payment reconciliation and
  // normal session retention. A repeated logout leaves an earlier revocation
  // unchanged. The autocommit acknowledgement is required before clearing the
  // cookie; a database failure must never report a successful logout.
  await pool.execute(`UPDATE kq_auth_session
    SET revoked_at = UTC_TIMESTAMP(3), write_version = write_version + 1
    WHERE token_hash = ? AND revoked_at IS NULL`, [keyedDigest(`session-cookie:${token}`)])
}
