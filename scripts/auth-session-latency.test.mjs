import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import express from 'express'
import { once } from 'node:events'
process.env.KUNQIONG_DB_ENABLED = 'false'
process.env.KUNQIONG_DATA_KEY = 'ab'.repeat(32)
const { readAuthSession, revokeAuthSession } = await import('../server/db/auth-session.js')
const { relationalDataMiddleware } = await import('../server/lib/relational-request.js')
const { registerAccountRoutes } = await import('../server/routes/account.js')
const { hydrateRows } = await import('../server/db/normalized-codec.js')

test('session identity follows the SQL user foreign key rather than a historical payload', () => {
  const next = { users: {}, sessions: [] }
  const tables = new Map([
    ['kq_user', new Map([[7, { id: 7, legacy_id: 'current', status: 'active', entity_payload_json: { id: 'current' } }]])],
    ['kq_auth_session', new Map([[8, { id: 8, legacy_id: 'session', user_id: 7, expires_at: '2030-01-01 00:00:00', revoked_at: null,
      entity_payload_json: { id: 'session', user: { id: 'historical' }, revokedAt: '2020-01-01' } }]])],
  ])
  hydrateRows(tables, next, value => structuredClone(value))
  assert.equal(next.sessions[0].user.id, 'current')
  assert.equal(next.sessions[0].revokedAt, undefined)
})

test('session reads verify live identity and reuse only the unchanged joined user version', async () => {
  const calls = []
  let version = 1, disabled = false, missing = false
  const user = () => ({ id: 2, legacy_id: 'alice', write_version: version, gmt_modified: '2026-11-03', status: disabled ? 'disabled' : 'active', entity_payload_json: 'historical-profile' })
  const pool = { async query(sql, params) {
    calls.push({ sql, params })
    return [typeof sql === 'object' ? missing ? [] : [{ s: { id: 1 }, u: { id: 2, write_version: version, gmt_modified: '2026-11-03' } }] : [user()]]
  } }
  assert.equal(await readAuthSession(pool, ''), null)
  assert.equal(calls.length, 0)
  assert.equal((await readAuthSession(pool, 'token')).u.status, 'active')
  assert.equal(calls.length, 2)
  assert.equal((await readAuthSession(pool, 'token')).u.status, 'active')
  assert.equal(calls.length, 3, 'warm access still reads the live session but not the large user payload')
  version++; disabled = true
  assert.equal((await readAuthSession(pool, 'token')).u.status, 'disabled')
  assert.equal(calls.length, 5, 'a changed account version reloads current status and profile')
  missing = true
  assert.equal(await readAuthSession(pool, 'token'), null, 'deleted session cannot use cached identity')
  pool.query = async () => { throw Object.assign(Error('outage'), { code: 'DATABASE_QUERY_TIMEOUT' }) }
  await assert.rejects(readAuthSession(pool, 'token'), { code: 'DATABASE_QUERY_TIMEOUT' })
  assert.equal(calls[0].sql.nestTables, true)
  assert.match(calls[0].sql.sql, /s.token_hash = \? LIMIT 1/)
  assert.doesNotMatch(calls[0].sql.sql, /u\.\*/)
  assert.doesNotMatch(calls[0].sql.sql, /resource|order|organization/)
  assert.match(calls[0].params[0], /^[a-f0-9]{64}$/)
})

test('logout awaits its one SQL write, skips unrelated loaders and fails without clearing the cookie', async t => {
  let finish, started = false, fail = false, writes = 0
  const pool = {
    query() { throw Error('Logout must not read any account data') },
    execute(sql, params) {
      writes++
      assert.match(sql, /UPDATE kq_auth_session/); assert.match(sql, /revoked_at IS NULL/)
      assert.equal(params.length, 1)
      started = true
      return fail ? Promise.reject(Object.assign(new Error('Unavailable'), { status: 503 })) : new Promise(resolve => { finish = resolve })
    },
  }
  const app = express(); app.use(express.json()); app.use(relationalDataMiddleware(pool)); registerAccountRoutes(app)
  app.use((error, req, res, next) => res.status(error.status || 500).json({ message: error.message }))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => new Promise(resolve => server.close(resolve)))
  const url = `http://127.0.0.1:${server.address().port}/api/auth/logout`
  let completed = false
  const pending = fetch(url, { method: 'POST', headers: { cookie: 'kunqiong_session=token' } }).then(response => { completed = true; return response })
  while (!started) await new Promise(resolve => setTimeout(resolve, 1))
  assert.equal(completed, false)
  finish([{ affectedRows: 1 }])
  const response = await pending
  assert.equal(response.status, 200); assert.match(response.headers.get('set-cookie'), /Max-Age=0/)
  assert.equal(writes, 1)
  fail = true
  const failure = await fetch(url, { method: 'POST', headers: { cookie: 'kunqiong_session=token' } })
  assert.equal(failure.status, 503); assert.equal(failure.headers.get('set-cookie'), null)
  const anonymous = await fetch(url, { method: 'POST' })
  assert.equal(anonymous.status, 200); assert.equal(writes, 2)
  await revokeAuthSession(pool, ''); assert.equal(writes, 2)
})

function client() {
  const calls = [], events = [], window = new EventTarget()
  window.location = new URL('http://fixture.local/')
  window.setTimeout = setTimeout
  window.addEventListener('kunqiong:account-session', event => events.push(event.detail))
  const context = vm.createContext({ window, Headers, URL, URLSearchParams, FormData, Blob, ArrayBuffer, Date, DOMException, setTimeout,
    CustomEvent: class extends Event { constructor(type, options) { super(type); this.detail = options.detail } },
    fetch: (url, options) => new Promise(resolve => calls.push({ url, options, respond: (data, status = 200) => resolve(new Response(JSON.stringify(data), { status })) })),
  })
  const source = fs.readFileSync(new URL('../src/lib/api.js', import.meta.url), 'utf8').replace(/^import .*$/m, '').replaceAll(/export (?=(?:async )?function|const|class)/g, '')
  vm.runInContext(source + '\nglobalThis.api={apiRequest,getCachedAccountSession,isAccountLogoutPending}', context)
  return { ...context.api, calls, events }
}

test('client retries a temporary database read once but never replays writes or permission denials', async () => {
  const api = client()
  const read = api.apiRequest('/api/collections/manage/test')
  api.calls[0].respond({ code: 'DATABASE_QUERY_TIMEOUT' }, 503)
  for (let attempt = 0; api.calls.length < 2 && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(api.calls.length, 2)
  api.calls[1].respond({ ok: true })
  assert.equal((await read).ok, true)
  for (const [method, status, code] of [['POST', 503, 'DATABASE_QUERY_TIMEOUT'], ['GET', 403, 'collection_owner_required']]) {
    const before = api.calls.length
    const pending = api.apiRequest('/api/collections/manage/other', { method }).catch(error => error.status)
    api.calls[before].respond({ code }, status)
    assert.equal(await pending, status)
    assert.equal(api.calls.length, before + 1)
  }
})
test('slow and failed logout hides private state immediately, blocks old replies, deduplicates and retries', async () => {
  const api = client()
  const login = api.apiRequest('/api/auth/me')
  api.calls[0].respond({ user: { id: 'alice' } }); await login
  const late = api.apiRequest('/api/auth/me', { force: true }).catch(error => error.status)
  const logout = api.apiRequest('/api/auth/logout', { method: 'POST' }).catch(error => error.status)
  const repeated = api.apiRequest('/api/auth/logout', { method: 'POST' }).catch(error => error.status)
  assert.equal(api.isAccountLogoutPending(), true)
  assert.equal(api.getCachedAccountSession().user, null)
  assert.equal(api.calls.filter(call => call.url.endsWith('logout')).length, 1)
  assert.equal((await api.apiRequest('/api/auth/me', { force: true })).user, null)
  api.calls[1].respond({ user: { id: 'alice' } })
  assert.equal(await late, 401)
  api.calls[2].respond({ message: 'Database unavailable' }, 503)
  assert.equal(await logout, 503); assert.equal(await repeated, 503)
  assert.equal(api.isAccountLogoutPending(), false)
  assert.equal(api.getCachedAccountSession().user, null)
  assert.equal(api.events.at(-1).code, 'account_logout_failed')
  const retry = api.apiRequest('/api/auth/logout', { method: 'POST' })
  api.calls[3].respond({ ok: true }); await retry
  assert.equal(api.events.at(-1).code, 'account_logged_out')
  assert.equal(api.getCachedAccountSession().user, null)
})

test('small identity refresh preserves the complete profile and entitlements already loaded', async () => {
  const api = client()
  const full = api.apiRequest('/api/auth/me', { authView: 'full' })
  api.calls[0].respond({ user: { id: 'alice', avatar: 'custom-avatar', avatarSource: 'custom', plan: { id: 'enterprise' }, capacity: { usedBytes: 123 } } })
  await full
  const identity = api.apiRequest('/api/auth/me', { authView: 'identity', force: true })
  api.calls[1].respond({ view: 'identity', user: { id: 'alice', username: 'current', status: 'active', avatar: null, planId: 'free' } })
  const result = await identity
  assert.equal(result.user.avatar, 'custom-avatar')
  assert.equal(result.user.avatarSource, 'custom')
  assert.equal(result.user.plan.id, 'enterprise')
  assert.equal(result.user.capacity.usedBytes, 123)
  assert.equal(result.user.username, 'current')
})

test('identity refresh restores a provider avatar missing from a cached small profile', async () => {
  const api = client()
  const initial = api.apiRequest('/api/auth/me', { authView: 'identity' })
  api.calls[0].respond({ view: 'identity', user: { id: 'alice', username: 'alice', avatar: null } })
  await initial
  const refreshed = api.apiRequest('/api/auth/me', { authView: 'identity', force: true })
  api.calls[1].respond({ view: 'identity', user: { id: 'alice', username: 'alice', avatar: 'https://avatar.example.test/alice.png' } })
  const result = await refreshed
  assert.equal(result.user.avatar, 'https://avatar.example.test/alice.png')
  assert.equal(api.getCachedAccountSession().user.avatar, result.user.avatar)
})
