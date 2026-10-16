import crypto from 'node:crypto'

export function equalSecret(a, b) {
  const digest = value => crypto.createHash('sha256').update(String(value ?? '')).digest()
  return crypto.timingSafeEqual(digest(a), digest(b))
}

export function passwordDigest(password) {
  if (!password) return null
  const salt = crypto.randomBytes(16).toString('hex')
  const digest = crypto.scryptSync(String(password), salt, 32)
  return `scrypt:${salt}:${digest.toString('hex')}`
}

// Verification is intentionally synchronous at the shared synchronous access boundary.
// Failed attempts are rate limited before this relatively expensive operation.
export function passwordMatches(password, digest) {
  if (typeof password !== 'string' || password.length > 128 || typeof digest !== 'string') return false
  if (/^[a-f0-9]{64}$/.test(digest)) return equalSecret(crypto.createHash('sha256').update(password).digest('hex'), digest)
  const parts = /^scrypt:([a-f0-9]{32}):([a-f0-9]{64})$/.exec(digest)
  return Boolean(parts && equalSecret(crypto.scryptSync(password, parts[1], 32).toString('hex'), parts[2]))
}

export function pruneAttempts(map, ttl, now = Date.now(), max = 5000) {
  for (const [key, entry] of map) if (now - entry.startedAt >= ttl) map.delete(key)
  // Fail closed at the caller rather than evicting a live attacker bucket.
  return map.size < max
}
