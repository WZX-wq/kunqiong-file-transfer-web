import assert from 'node:assert/strict'
import test from 'node:test'

process.env.KUNQIONG_DB_ENABLED = 'false'
process.env.KUNQIONG_DATA_KEY = 'ab'.repeat(32)
const { RelationalRequestStore } = await import('../server/db/request-store.js')
const { protectCredential } = await import('../server/lib/private-key.js')
const { packEntity } = await import('../server/db/normalized-codec.js')

function fixture(profile) {
  const calls = []
  const row = { id: 7, legacy_id: profile.id, username: profile.username, nickname: profile.nickname,
    status: 'active', avatar_url: (profile.avatar || profile.providerAvatar || '').slice(0, 500),
    write_version: 1, gmt_modified: new Date('2026-11-05T00:00:00Z'),
  }
  row.entity_payload_json = JSON.stringify(protectCredential(JSON.stringify(packEntity('kq_user', profile, row)), `relational:user:${profile.id}`))
  const pool = { async query(query, params) {
    const sql = typeof query === 'string' ? query : query.sql
    calls.push({ sql, params })
    if (sql.includes('JOIN kq_user')) return [[{ u: { ...row, entity_payload_json: undefined },
      s: { expires_at: new Date('2099-01-01T00:00:00Z'), revoked_at: null }, replacement: {} }]]
    assert.match(sql, /FROM `kq_user` WHERE/)
    return [[structuredClone(row)]]
  } }
  return { pool, calls, row }
}

test('cold identity restores a complete custom image and its provider fallback', async () => {
  const profile = { id: 'alice', nickname: 'Alice', avatar: 'data:image/webp;base64,' + 'A'.repeat(800),
    avatarSource: 'custom', providerAvatar: 'https://example.invalid/provider.png' }
  const f = fixture(profile)
  const first = new RelationalRequestStore(f.pool)
  await first.identity('session')
  assert.equal(first.data.users.alice.avatar, profile.avatar)
  assert.equal(first.data.users.alice.avatarSource, 'custom')
  assert.equal(first.data.users.alice.providerAvatar, profile.providerAvatar)
  assert.equal(f.calls.length, 2, 'one live session join and one bounded user read')
  const warm = new RelationalRequestStore(f.pool)
  await warm.identity('session')
  assert.equal(warm.data.users.alice.avatar, profile.avatar)
  assert.equal(f.calls.length, 3, 'unchanged image reuses its versioned row after a live join')
  f.row.status = 'disabled'
  const disabled = new RelationalRequestStore(f.pool)
  await disabled.identity('session')
  assert.equal(disabled.data.users.alice.status, 'disabled', 'a cached image cannot hide the live disabled-account status')
  // Profile changes must invalidate the image cache even with the same account/session.
  f.row.write_version++
  f.row.entity_payload_json = JSON.stringify(protectCredential(JSON.stringify({ ...profile, avatar: profile.avatar + 'BBBB' }), 'relational:user:alice'))
  const changed = new RelationalRequestStore(f.pool)
  await changed.identity('session')
  assert.equal(changed.data.users.alice.avatar, profile.avatar + 'BBBB')
})

test('a failed live session lookup never falls back to the cached avatar/profile', async () => {
  const f = fixture({ id: 'alice', avatar: 'data:image/webp;base64,AAAA' })
  await new RelationalRequestStore(f.pool).identity('session')
  f.pool.query = async () => { throw new Error('database unavailable') }
  await assert.rejects(new RelationalRequestStore(f.pool).identity('session'), /database unavailable/)
})

test('ordinary provider URLs keep identity to one compact live query', async () => {
  const profile = { id: 'bob', nickname: 'Bob', avatar: 'https://example.invalid/bob.png' }
  const f = fixture(profile), store = new RelationalRequestStore(f.pool)
  await store.identity('other-session')
  assert.equal(store.data.users.bob.avatar, profile.avatar)
  assert.equal(store.data.users.alice, undefined)
  assert.equal(f.calls.length, 1)
})

test('truncated long avatar URLs are restored from the user row', async () => {
  const profile = { id: 'long-url', avatar: 'https://example.invalid/image?token=' + 'x'.repeat(600) }
  const f = fixture(profile), store = new RelationalRequestStore(f.pool)
  await store.identity('session')
  assert.equal(store.data.users[profile.id].avatar, profile.avatar)
})
