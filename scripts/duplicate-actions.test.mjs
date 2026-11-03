import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
import { assertMergedCollectionPaths, conflictsForNamedCollectionFiles } from '../server/lib/collection-conflicts.js'

function client() {
  const calls = []
  const window = new EventTarget()
  window.location = new URL('http://fixture.local/')
  const context = vm.createContext({ window, Headers, URL, URLSearchParams, FormData, Blob, ArrayBuffer, Date, DOMException,
    CustomEvent: class extends Event { constructor(type, options) { super(type); this.detail = options.detail } },
    fetch: (url, options) => new Promise(resolve => {
      calls.push({ url, options, respond: (data = {}, status = 200) => resolve(new Response(JSON.stringify(data), { status })) })
    }),
  })
  const source = fs.readFileSync(new URL('../src/lib/api.js', import.meta.url), 'utf8').replace(/^import .*$/m, '').replaceAll(/export (?=(?:async )?function|const|class)/g, '')
  vm.runInContext(source + '\nglobalThis.api = {apiRequest, invalidateAccountSession}', context)
  return { ...context.api, calls }
}
const tick = async () => { for (let index = 0; index < 12; index++) await Promise.resolve() }

test('identical concurrent CRUD calls send one request and completed/failed operations can be retried', async () => {
  for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
    const api = client(), options = { method, ...(method === 'GET' ? {} : { body: '{"name":"same"}' }) }
    const requests = Array.from({ length: 20 }, () => api.apiRequest('/api/example', options))
    await tick(); assert.equal(api.calls.length, 1, method)
    api.calls[0].respond({ id: 'one' })
    const responses = await Promise.all(requests)
    assert.ok(responses.every(item => item.id === 'one'))
    const failed = api.apiRequest('/api/example', options)
    await tick(); assert.equal(api.calls.length, 2)
    api.calls[1].respond({ message: 'failure' }, 503)
    await assert.rejects(failed, /failure/)
    const retry = api.apiRequest('/api/example', options)
    await tick(); assert.equal(api.calls.length, 3)
    api.calls[2].respond({ id: 'retry' }); assert.equal((await retry).id, 'retry')
  }
})

test('different bodies, headers and methods are independent while header order is irrelevant', async () => {
  const api = client()
  const a = api.apiRequest('/api/example', { method: 'POST', body: 'a', headers: { 'X-Other': '1', 'Idempotency-Key': 'one' } })
  const b = api.apiRequest('/api/example', { method: 'POST', body: 'a', headers: new Headers({ 'Idempotency-Key': 'one', 'X-Other': '1' }) })
  const c = api.apiRequest('/api/example', { method: 'POST', body: 'b' })
  const d = api.apiRequest('/api/example', { method: 'PATCH', body: 'a' })
  const e = api.apiRequest('/api/example', { method: 'POST', body: 'a', headers: { 'Idempotency-Key': 'two' } })
  await tick(); assert.equal(api.calls.length, 4)
  api.calls.forEach(call => call.respond()); await Promise.all([a,b,c,d,e])
})

test('consumer cancellation does not interrupt another consumer or a pending write and retry', async () => {
  const api = client(), controller = new AbortController()
  const cancelled = api.apiRequest('/api/example', { method: 'POST', body: '{}', signal: controller.signal })
  const waiting = api.apiRequest('/api/example', { method: 'POST', body: '{}' })
  await tick(); controller.abort()
  await assert.rejects(cancelled, { name: 'AbortError' })
  const retry = api.apiRequest('/api/example', { method: 'POST', body: '{}' })
  await tick(); assert.equal(api.calls.length, 1)
  assert.equal(api.calls[0].options.signal, undefined)
  api.calls[0].respond({ id: 'committed' })
  assert.equal((await waiting).id, 'committed'); assert.equal((await retry).id, 'committed')
})

test('a successful mutation or changed login generation prevents reuse of an earlier read', async () => {
  const api = client()
  const old = api.apiRequest('/api/example')
  const save = api.apiRequest('/api/example', { method: 'PATCH', body: '{}' })
  await tick(); api.calls[1].respond(); await save
  const fresh = api.apiRequest('/api/example')
  await tick(); assert.equal(api.calls.length, 3)
  api.calls[0].respond({ version: 1 }); api.calls[2].respond({ version: 2 })
  assert.equal((await fresh).version, 2); await old
  const stale = api.apiRequest('/api/example')
  await tick(); api.invalidateAccountSession()
  const next = api.apiRequest('/api/example')
  await tick(); assert.equal(api.calls.length, 5)
  api.calls[3].respond(); api.calls[4].respond()
  await assert.rejects(stale, /登录状态已更新/); await next
})

test('file conflicts use task-local submitter identity and full path, never display name', () => {
  const task = { submissions: [
    { id: 'a', submitterUserId: 'alice', participantName: 'Same', files: [{ name: 'a.txt', relativePath: 'docs/a.txt' }] },
    { id: 'b', submitterUserId: 'bob', participantName: 'Same', files: [{ name: 'b.txt' }] },
    { id: 'c', participantKey: 'guest:one', participantName: 'Same', files: [{ name: 'c.txt' }] },
  ] }
  assert.equal(conflictsForNamedCollectionFiles(task, [{ relativePath: 'docs/A.txt' }], { submitterUserId: 'alice' }).length, 1)
  assert.equal(conflictsForNamedCollectionFiles(task, [{ name: 'a.txt' }, { name: 'b.txt' }, { name: 'c.txt' }], { submitterUserId: 'alice' }).length, 0)
  assert.equal(conflictsForNamedCollectionFiles(task, [{ name: 'c.txt' }], { participantKey: 'guest:two', participantName: 'Same' }).length, 0)
  assert.equal(conflictsForNamedCollectionFiles(task, [{ name: 'c.txt' }], { participantKey: 'guest:one' }).length, 1)
})

test('database rebase rejects simultaneous same-path inserts and permits other paths or submitters', () => {
  const before = { submissions: [] }
  const submission = (id, owner, relativePath) => ({ id, submitterUserId: owner, files: [{ name: 'a.txt', relativePath, storedName: id + '.txt', storageOwnerId: owner }] })
  const first = submission('one', 'alice', 'docs/a.txt'), second = submission('two', 'alice', 'docs/a.txt')
  assert.throws(() => assertMergedCollectionPaths(before, { submissions: [second] }, [first, second]), { code: 'collection_file_exists', status: 409 })
  for (const other of [submission('three', 'bob', 'docs/a.txt'), submission('four', 'alice', 'other/a.txt')]) {
    assert.doesNotThrow(() => assertMergedCollectionPaths(before, { submissions: [other] }, [first, other]))
  }
  assert.doesNotThrow(() => assertMergedCollectionPaths({ submissions: [first] }, { submissions: [second] }, [second]))
})
