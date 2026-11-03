import test from 'node:test'
import assert from 'node:assert/strict'
import { OAuthCallbackRegistry, oauthPendingPage } from '../server/lib/oauth-callback.js'

test('pending callbacks share one exchange while another browser and completed replay are rejected', async () => {
  const registry = new OAuthCallbackRegistry()
  let release, claims = 0, exchanges = 0
  const gate = new Promise(resolve => { release = resolve })
  const claim = () => { claims++; return { returnTo: '/settings' } }
  const run = async () => { exchanges++; await gate; return { location: '/settings?login=success' } }
  const first = registry.start('state', 'browser', claim, run)
  await Promise.resolve()
  assert.equal(registry.start('state', 'browser', claim, run), first)
  assert.equal(registry.start('state', 'another-browser', claim, run), null)
  assert.equal(claims, 1)
  assert.equal(exchanges, 1)
  assert.equal(first.result, null)
  release(); await first.completion
  assert.equal(registry.get('state', 'browser'), first)
  first.delivered = true
  assert.equal(registry.start('state', 'browser', claim, run), null)
  assert.equal(claims, 1)
  assert.equal(exchanges, 1)
})

test('unbound and expired attempts cannot reveal a pending login result', async () => {
  let now = 0
  const registry = new OAuthCallbackRegistry({ ttlMs: 100, now: () => now })
  assert.equal(registry.start('forged', 'browser', () => null, () => assert.fail()), null)
  const attempt = registry.start('valid', 'browser', () => ({}), async () => ({ session: { id: 'private' } }))
  await attempt.completion
  assert.equal(registry.get('valid', 'another-browser'), null)
  now = 100
  assert.equal(registry.get('valid', 'browser'), null)
  const html = oauthPendingPage('state"<script>bad</script>')
  assert.ok(!html.includes('http-equiv="refresh"'))
  assert.ok(html.includes('src="/auth/progress.js"'))
  assert.ok(html.includes('prefers-reduced-motion'))
  assert.ok(!html.includes('<script>'))
})
