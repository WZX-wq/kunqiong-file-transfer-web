import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const root = new URL('../', import.meta.url)
function addresses(trusted, requests) {
  const source = `
    const {clientAddress} = await import('./server/lib/request-security.js');
    const requests = JSON.parse(process.env.REQUEST_FIXTURES);
    console.log(JSON.stringify(requests.map(([peer, forwarded]) => clientAddress({
      socket:{remoteAddress:peer}, headers:{'x-forwarded-for':forwarded}
    }))));
  `
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd: root, encoding:'utf8', windowsHide:true,
    env:{...process.env, KUNQIONG_TRUSTED_PROXIES:trusted, REQUEST_FIXTURES:JSON.stringify(requests)},
  })
  assert.equal(run.status, 0, run.stderr)
  return JSON.parse(run.stdout.trim().split('\n').at(-1))
}
test('direct callers cannot change identity through forwarding headers', () => {
  assert.deepEqual(addresses('', [['127.0.0.1','198.51.100.1'],['127.0.0.1','198.51.100.2']]), ['127.0.0.1','127.0.0.1'])
})
test('explicit trusted proxies preserve independent real client identities', () => {
  assert.deepEqual(addresses('127.0.0.1/32', [['127.0.0.1','198.51.100.1'],['127.0.0.1','198.51.100.2']]), ['198.51.100.1','198.51.100.2'])
})
test('forwarding stops at the nearest untrusted address', () => {
  assert.deepEqual(addresses('127.0.0.1/32', [['127.0.0.1','192.0.2.99, 198.51.100.8'],['203.0.113.4','192.0.2.99']]), ['198.51.100.8','203.0.113.4'])
})
