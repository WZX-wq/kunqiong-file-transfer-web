import test from 'node:test'
import assert from 'node:assert/strict'

process.env.KUNQIONG_DB_ENABLED = 'false'
process.env.KUNQIONG_DATA_KEY = 'ab'.repeat(32)
const { normalizeAccountUserStore, mergeAccountUser } = await import('../server/lib/metadata-normalizers.js')
const { displayUserName } = await import('../src/lib/format.js')
const { displayAccountName } = await import('../server/services/account.js')
const { readOwnedCollectionPage } = await import('../server/db/collection-list.js')
const { protectCredential } = await import('../server/lib/private-key.js')

test('compact and historical sessions cannot replace the database username or current profile', () => {
  for (const snapshot of [{ id: '706' }, { id: '706', username: 'old-name', nickname: '鲲穹用户', email: 'old@example.test' }]) {
    const sessions = [{ user: snapshot }]
    const users = normalizeAccountUserStore({ '706': { id: '706', username: 'wzx12', nickname: '最新昵称', email: 'current@example.test', status: 'active' } }, sessions)
    assert.equal(users['706'].username, 'wzx12')
    assert.equal(users['706'].nickname, '最新昵称')
    assert.equal(users['706'].email, 'current@example.test')
    assert.equal(sessions[0].user.username, 'wzx12')
    assert.equal(displayUserName(sessions[0].user), 'wzx12')
    assert.equal(displayAccountName(users['706']), 'wzx12')
  }
  const sessions = [{ user: { id: 'legacy-only', username: 'legacy-login' } }]
  assert.equal(normalizeAccountUserStore({}, sessions)['legacy-only'].username, 'legacy-login', 'legacy session-only import still works')
  const merged = mergeAccountUser({ id: '706', username: 'wzx12', nickname: '最新昵称' }, { id: '706' })
  assert.equal(merged.username, 'wzx12')
  assert.equal(merged.nickname, '最新昵称')
})

test('owned collection summaries use an owner predicate, bounded SQL, and omit submission/file snapshots', async () => {
  const calls = []
  const pool = { async query(sql, params) {
    calls.push({ sql, params })
    return [[1, 2, 3].map(id => ({ id, legacy_id: 'task-' + id, status: 'active', expires_at: null,
      gmt_create: '2026-11-03 00:00:00', gmt_modified: '2026-11-03 00:00:00',
      title: '数据库标题', allowed_types_json: '["全部格式"]', max_file_size_bytes: 500 * 1024 ** 2,
      used_bytes: 9, file_count: 1, submission_count: 4,
      entity_payload_json: JSON.stringify(protectCredential(JSON.stringify({ __columns_v: 1, extra: { token: 'public-' + id, manageToken: 'manage-' + id, title: '过期标题', ownerUserId: 'old-owner', submissions: [{ privateAnswer: 'secret' }] } }), `relational:resource:collection:task-${id}`)),
    }))]
  } }
  const page = await readOwnedCollectionPage(pool, '706', { limit: 2, cursor: '9' })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].params, ['706', '9'])
  assert.match(calls[0].sql, /owner\.legacy_id = \?/)
  assert.match(calls[0].sql, /r\.deleted_at IS NULL/)
  assert.match(calls[0].sql, /LIMIT 3/)
  assert.doesNotMatch(calls[0].sql, /kq_account_record|kq_resource_file|kq_submission_file|SELECT\s+\*/)
  assert.equal(page.collections.length, 2)
  assert.equal(page.pagination.nextCursor, '2')
  assert.equal(page.collections[0].title, '数据库标题')
  assert.equal(page.collections[0].manageToken, 'manage-1')
  assert.equal(page.collections[0].submissionCount, 4)
  assert.equal(page.collections[0].createdAt, '2026-11-03T00:00:00.000Z')
  assert.equal(page.collections[0].submissions, undefined)
  assert.equal(page.collections[0].ownerUserId, undefined)
  await assert.rejects(readOwnedCollectionPage(pool, '706', { cursor: '1 OR 1=1' }), { status: 400 })
  assert.deepEqual((await readOwnedCollectionPage(pool, '')).collections, [])
  assert.equal(calls.length, 1, 'anonymous or invalid requests never query task data')
})

test('cold identity includes the bounded provider avatar URL without encrypted blobs', async () => {
  const { RelationalRequestStore } = await import('../server/db/request-store.js')
  for (const [stored, expected] of [['https://avatar.example.test/provider.png', 'https://avatar.example.test/provider.png'], ['data:image/png;base64,truncated', null], [null, null]]) {
    const queries = []
    const scope = new RelationalRequestStore({ async query(sql) {
      queries.push(sql.sql)
      return [[{ u: { legacy_id: '9', username: 'wzx1', status: 'active', avatar_url: stored }, s: { expires_at: new Date(Date.now() + 60000).toISOString() }, replacement: {} }]]
    } })
    await scope.identity('fixture-token')
    assert.equal(scope.data.users['9'].avatar, expected)
    assert.equal(queries.length, 1)
    assert.match(queries[0], /u\.avatar_url/)
    assert.doesNotMatch(queries[0], /entity_payload_json|provider_credential_ciphertext|kq_resource/)
  }
})
