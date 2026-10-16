import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-private-key-'))
  fs.mkdirSync(path.join(directory, 'server/lib'), { recursive: true })
  fs.mkdirSync(path.join(directory, 'storage'))
  fs.writeFileSync(path.join(directory, 'package.json'), '{"type":"module"}')
  fs.writeFileSync(path.join(directory, 'server/config.js'), `export const storageRoot = ${JSON.stringify(path.join(directory, 'storage'))};`)
  for (const name of ['private-key.js', 'file-lock.js']) {
    fs.copyFileSync(new URL(`../server/lib/${name}`, import.meta.url), path.join(directory, 'server/lib', name))
  }
  const env = { ...process.env }
  delete env.KUNQIONG_DATA_KEY
  return {
    filename: path.join(directory, 'storage/.private-key'),
    run(source, overrides = {}) {
      return spawnSync(process.execPath, ['--input-type=module', '-e', `
        import assert from 'node:assert/strict';
        import fs from 'node:fs';
        import { privateKey, protectCredential, revealCredential } from './server/lib/private-key.js';
        ${source}
      `], { cwd: directory, env: { ...env, ...overrides }, encoding: 'utf8', windowsHide: true, timeout: 10000 })
    },
  }
}

test('an existing key remains readable while another process holds its creation lock', () => {
  const data = fixture()
  fs.writeFileSync(data.filename, Buffer.alloc(32, 73))
  fs.writeFileSync(`${data.filename}.lock`, JSON.stringify({ pid: process.pid, token: 'fixture-held-lock' }))
  const result = data.run('assert.deepEqual(privateKey(false), Buffer.alloc(32, 73));')
  assert.equal(result.status, 0, result.stderr)
  assert.ok(fs.existsSync(`${data.filename}.lock`), 'reader leaves the other owner lock intact')
})

test('a damaged key fails closed on every read without caching invalid bytes', () => {
  const data = fixture()
  fs.writeFileSync(data.filename, Buffer.alloc(8, 73))
  const result = data.run(`
    assert.throws(() => privateKey(false), /密钥损坏/);
    assert.throws(() => privateKey(false), /密钥损坏/);
  `)
  assert.equal(result.status, 0, result.stderr)
})

test('reading an absent key cannot generate a replacement', () => {
  const data = fixture()
  const result = data.run('assert.throws(() => privateKey(false), /密钥缺失/);')
  assert.equal(result.status, 0, result.stderr)
  assert.equal(fs.existsSync(data.filename), false)
})

test('a generated key survives restart and encrypted credentials reject another context', () => {
  const data = fixture()
  const first = data.run(`
    assert.equal(privateKey().length, 32);
    console.log(protectCredential('synthetic-upstream-token', 'session:fixture'));
  `)
  assert.equal(first.status, 0, first.stderr)
  const cipher = first.stdout.trim()
  assert.ok(cipher.startsWith('enc:v1:'))
  assert.ok(!cipher.includes('synthetic-upstream-token'))
  const originalKey = fs.readFileSync(data.filename)
  const second = data.run(`
    assert.equal(revealCredential(process.env.FIXTURE_CIPHER, 'session:fixture'), 'synthetic-upstream-token');
    assert.throws(() => revealCredential(process.env.FIXTURE_CIPHER, 'session:other'));
  `, { FIXTURE_CIPHER: cipher })
  assert.equal(second.status, 0, second.stderr)
  assert.deepEqual(fs.readFileSync(data.filename), originalKey)
})
