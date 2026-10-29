import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'

const root = path.resolve(import.meta.dirname, '..')
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-legacy-storage-startup-'))
const future = new Date(Date.now() + 86400000).toISOString()
const content = 'legacy-file-migration-keeps-bytes'
let child

function copyDirectory(source, target) {
  fs.mkdirSync(target, { recursive: true })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name), to = path.join(target, entry.name)
    if (entry.isDirectory()) copyDirectory(from, to)
    else if (entry.isFile()) fs.copyFileSync(from, to)
  }
}

async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exit = once(child, 'exit')
  child.kill()
  await exit
}

try {
  fs.copyFileSync(path.join(root, 'server.mjs'), path.join(fixture, 'server.mjs'))
  copyDirectory(path.join(root, 'server'), path.join(fixture, 'server'))
  copyDirectory(path.join(root, 'email-templates'), path.join(fixture, 'email-templates'))
  fs.copyFileSync(path.join(root, 'package.json'), path.join(fixture, 'package.json'))
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')

  const storage = path.join(fixture, 'storage')
  const legacyDirectory = path.join(storage, 'files', 'legacy-share')
  fs.mkdirSync(legacyDirectory, { recursive: true })
  fs.writeFileSync(path.join(legacyDirectory, 'old.txt'), content)
  const legacyCollectionDirectory = path.join(storage, 'collections', 'legacy-collection', 'legacy-submission')
  fs.mkdirSync(legacyCollectionDirectory, { recursive: true })
  fs.writeFileSync(path.join(legacyCollectionDirectory, 'old-proof.txt'), content)
  fs.writeFileSync(path.join(storage, 'metadata.json'), JSON.stringify({
    users: { alice: { id: 'alice', username: 'alice', nickname: 'Alice', planId: 'member', status: 'active' } },
    sessions: [{ id: 'alice-session', user: { id: 'alice', username: 'alice', nickname: 'Alice', planId: 'member', status: 'active' }, expiresAt: future }],
    shares: [{
      id: 'legacy-share', ownerUserId: 'alice', code: 'LEGACY', manageToken: 'legacy-manage',
      status: 'active', createdAt: new Date().toISOString(), expiresAt: future,
      downloadLimit: null, downloadCount: 0, files: [{ name: '合同.txt', relativePath: '合同.txt', storedName: 'old.txt', size: Buffer.byteLength(content), mimeType: 'text/plain', reviewStatus: 'clean', scanEngine: 'clamav', scannedAt: new Date().toISOString() }],
    }],
    collections: [{
      id: 'legacy-collection', token: 'LEGACY-COLLECT', manageToken: 'legacy-collection-manage',
      ownerUserId: 'alice', title: '历史收集任务', status: 'active',
      submissions: [{
        id: 'legacy-submission', participantName: 'Alice', submitterUserId: 'alice',
        submittedAt: new Date().toISOString(), files: [{ name: '证明.txt', relativePath: '证明.txt', storedName: 'old-proof.txt', size: Buffer.byteLength(content), mimeType: 'text/plain', reviewStatus: 'clean', scanEngine: 'clamav', scannedAt: new Date().toISOString() }],
      }],
    }],
    distributions: [], organizations: {}, systemConfig: { anonymousTotalSizeMb: 100 },
  }))

  const probe = net.createServer()
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  const cleanEnv = { ...process.env }
  for (const key of Object.keys(cleanEnv)) if (key.startsWith('KUNQIONG_') || key.startsWith('OAUTH_')) delete cleanEnv[key]
  child = spawn(process.execPath, ['server.mjs'], { cwd: fixture, windowsHide: true, env: { ...cleanEnv, HOST: '127.0.0.1', PORT: String(port), NODE_ENV: 'production', KUNQIONG_DB_ENABLED: 'false', KUNQIONG_SCAN_MODE: 'optional' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = ''
  child.stdout.on('data', chunk => { logs += String(chunk) })
  child.stderr.on('data', chunk => { logs += String(chunk) })
  const base = `http://127.0.0.1:${port}`
  let started = false
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) { started = true; break } } catch {}
    if (child.exitCode !== null) break
    await delay(50)
  }
  assert.ok(started, `fixture server failed to start: ${logs}`)

  const stored = JSON.parse(fs.readFileSync(path.join(storage, 'metadata.json'), 'utf8')).shares[0].files[0]
  assert.equal(stored.storageOwnerId, 'alice')
  assert.match(stored.storedName, /^[0-9a-f]{16}-[0-9a-f-]{36}\.txt$/)
  assert.equal(Object.hasOwn(stored, 'storageMigration'), false)
  assert.equal(fs.existsSync(path.join(storage, 'users', 'alice', stored.storedName)), true)
  assert.equal(fs.existsSync(path.join(legacyDirectory, 'old.txt')), false)
  const migratedCollectionFile = JSON.parse(fs.readFileSync(path.join(storage, 'metadata.json'), 'utf8')).collections[0].submissions[0].files[0]
  assert.equal(migratedCollectionFile.storageOwnerId, 'alice')
  assert.match(migratedCollectionFile.storedName, /^[0-9a-f]{16}-[0-9a-f-]{36}\.txt$/)
  assert.equal(fs.existsSync(path.join(storage, 'users', 'alice', migratedCollectionFile.storedName)), true)
  assert.equal(fs.existsSync(path.join(legacyCollectionDirectory, 'old-proof.txt')), false)
  assert.equal(fs.existsSync(path.join(storage, 'collections', 'legacy-collection')), false)
  const response = await fetch(`${base}/api/shares/legacy-share/files/0/download`, { headers: { cookie: 'kunqiong_session=alice-session' } })
  assert.equal(response.status, 200)
  assert.equal(await response.text(), content)
  const collectionResponse = await fetch(`${base}/api/collections/manage/legacy-collection-manage/submissions/legacy-submission/files/0/download`, { headers: { cookie: 'kunqiong_session=alice-session' } })
  const collectionBody = await collectionResponse.text()
  assert.equal(collectionResponse.status, 200, collectionBody)
  assert.equal(collectionBody, content)

  console.log('PASS startup migrated legacy share and collection files into the submitter directory, cleaned empty legacy folders, and kept both download routes byte-identical')
} finally {
  await stop()
  fs.rmSync(fixture, { recursive: true, force: true })
}
