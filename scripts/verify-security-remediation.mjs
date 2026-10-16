// Focused, dependency-light guards for the shared security boundaries.
// Full route regressions live in verify-remediation/auth/upload/boundary suites;
// this script keeps the highest-risk pure boundaries runnable on every checkout.
import assert from 'node:assert/strict'
import { previewKind, fileContentType, validGuestId } from '../server/services/shares.js'
import { systemConfigError } from '../server/lib/admin-validation.js'
import { passwordDigest, passwordMatches, equalSecret } from '../server/lib/security-primitives.js'
import { requestOrigin } from '../server/lib/request-security.js'
import { safeReturnUrl } from '../server/services/account.js'

let passed = 0
// This pure boundary suite must never acquire the running project's key lock.
process.env.KUNQIONG_DATA_KEY = '91'.repeat(32)
function check(label, value) {
  assert.ok(value, label)
  passed += 1
  console.log(`PASS ${label}`)
}

// Preview MIME is selected from the server-side extension map, never from a
// client supplied multipart MIME that could turn an image/document into HTML.
check('preview ignores active client MIME for PNG', fileContentType({ name: 'evil.png', mimeType: 'text/html' }) === 'image/png')
check('preview still classifies the safe extension', previewKind({ name: 'evil.png', mimeType: 'text/html' }) === 'image')
check('HTML and SVG extensions never receive an active preview MIME', fileContentType({ name: 'evil.html', mimeType: 'text/html' }) === 'text/plain' && fileContentType({ name: 'evil.svg', mimeType: 'image/svg+xml' }) === 'application/octet-stream')

// Guest ownership requires a server-signed value; syntactically plausible
// client-created identifiers must not authorize an existing upload session.
check('unsigned guest identifiers are rejected', validGuestId('a'.repeat(32)) === '')
check('malformed signed guest identifiers are rejected', validGuestId(`${'a'.repeat(32)}.${'b'.repeat(64)}`) === '')

// Passwords use a salted verifier while legacy SHA-256 values remain readable
// for migration. Comparisons are constant-time at the shared primitive.
const digest = passwordDigest('security-test-password')
check('password digest is salted and non-reversible', /^scrypt:[a-f0-9]{32}:[a-f0-9]{64}$/.test(digest))
check('password verifier accepts the original secret only', passwordMatches('security-test-password', digest) && !passwordMatches('wrong-password', digest))
check('secret comparison does not accept different values', !equalSecret('one', 'two'))

// Prototype-looking keys must be treated as unknown configuration fields,
// never used as inherited numeric bounds.
check('admin config rejects prototype keys cleanly', systemConfigError({ constructor: 1 }, {}) === '未知系统配置项')

const fakeRequest = {
  protocol: 'http',
  socket: { remoteAddress: '203.0.113.10' },
  get(name) {
    if (name === 'host') return '127.0.0.1:8045'
    if (name === 'x-forwarded-host') return 'attacker.example'
    if (name === 'x-forwarded-proto') return 'https'
    return ''
  },
}
check('request origin does not trust an unapproved forwarded host', !requestOrigin(fakeRequest).includes('attacker.example'))
check('external return URL is rejected', safeReturnUrl('https://attacker.example/phish', fakeRequest) !== 'https://attacker.example/phish')

console.log(`Security boundary checks: ${passed}/${passed}`)
