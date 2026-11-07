import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import mysql from 'mysql2/promise'

// Explicit loopback fixture only. Never use the project's configured database.
process.env.KUNQIONG_DB_ENABLED = 'false'
process.env.KUNQIONG_DATA_KEY = 'ab'.repeat(32)
const port = Number(process.env.KUNQIONG_TEST_DB_PORT || 0)
const root = path.resolve(import.meta.dirname, '../..')
const { applyRelationalSchema } = await import('../../server/db/apply-relational-schema.js')
const { ensureRelationalStoreSchema, initializeRelationalMetadata } = await import('../../server/db/relational-store.js')
const { migrateOnDemandSchema } = await import('../../server/db/on-demand-schema.js')
const { ensureUploadSessionTable } = await import('../../server/db/upload-session-store.js')
const { normalizeMetadata, normalizeAuditLog } = await import('../../server/lib/metadata-normalizers.js')
const { RelationalRequestStore } = await import('../../server/db/request-store.js')
const { RelationalAuditStore } = await import('../../server/db/request-audit-store.js')

test('background verdicts persist in MySQL, retain concurrent changes and appear in admin logs', { skip: !port, timeout: 60000 }, async t => {
  assert.ok(port >= 1024 && port <= 65535)
  const name = `kunqiong_scan_test_${crypto.randomBytes(6).toString('hex')}`
  const admin = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root' })
  await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4`)
  const pool = mysql.createPool({ host: '127.0.0.1', port, user: 'root', database: name, timezone: 'Z' })
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-scan-sql-'))
  let child, stderr = '', held = [], verdict = 'stream: OK'
  const sockets = new Set()
  const scanner = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {})
    let data = Buffer.alloc(0), command = false
    socket.on('data', chunk => {
      data = Buffer.concat([data, chunk])
      if (!command) {
        const end = data.indexOf(0); if (end < 0) return
        assert.equal(data.subarray(0, end).toString(), 'zINSTREAM')
        data = data.subarray(end + 1); command = true
      }
      while (data.length >= 4) {
        const size = data.readUInt32BE(0); if (data.length < size + 4) return
        data = data.subarray(size + 4)
        if (!size) { held.push(() => socket.end(verdict + '\0')); return }
      }
    })
  })
  const stop = async () => {
    if (child && child.exitCode === null && !child.signalCode) { const exit = once(child, 'exit'); child.kill(); await exit }
  }
  t.after(async () => {
    await stop(); for (const socket of sockets) socket.destroy()
    if (scanner.listening) await new Promise(resolve => scanner.close(resolve))
    await pool.end(); await admin.query(`DROP DATABASE \`${name}\``); await admin.end()
    assert.ok(fixture.startsWith(path.join(os.tmpdir(), 'kunqiong-scan-sql-')))
    fs.rmSync(fixture, { recursive: true, force: true })
  })
  await applyRelationalSchema({ pool, schemaSql: fs.readFileSync(path.join(root, 'docs/数据库设计-2026-10-29/03-现有功能关系表设计.sql'), 'utf8') })
  await ensureRelationalStoreSchema(pool)
  const user = { id: 'scan-owner', username: 'scan-owner', status: 'active', planId: 'member' }
  await initializeRelationalMetadata(pool, normalizeMetadata({ users: { [user.id]: user }, sessions: [{ id: 'scan-token', user, expiresAt: new Date(Date.now() + 3600000).toISOString() }] }))
  await migrateOnDemandSchema(pool); await ensureUploadSessionTable(pool)
  function copy(source, target) {
    fs.mkdirSync(target, { recursive: true })
    for (const item of fs.readdirSync(source, { withFileTypes: true })) {
      if (item.isDirectory()) copy(path.join(source, item.name), path.join(target, item.name))
      else fs.copyFileSync(path.join(source, item.name), path.join(target, item.name))
    }
  }
  for (const file of ['server.mjs', 'package.json']) fs.copyFileSync(path.join(root, file), path.join(fixture, file))
  for (const directory of ['server', 'email-templates']) copy(path.join(root, directory), path.join(fixture, directory))
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  fs.mkdirSync(path.join(fixture, 'storage')); fs.writeFileSync(path.join(fixture, 'storage/metadata.json'), 'must never be read')
  await new Promise(resolve => scanner.listen(0, '127.0.0.1', resolve))
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${probe.address().port}`; await new Promise(resolve => probe.close(resolve))
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (/^(KUNQIONG_|OAUTH_)/.test(key)) delete env[key]
  const until = async predicate => {
    for (let i = 0; i < 300; i++) { const value = await predicate(); if (value) return value; await delay(30) }
    assert.fail('Timed out: ' + stderr)
  }
  const start = async () => {
    child = spawn(process.execPath, ['server.mjs'], { cwd: fixture, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: {
      ...env, PORT: new URL(base).port, KUNQIONG_HOST: '127.0.0.1', NODE_ENV: 'test',
      KUNQIONG_DB_ENABLED: 'true', KUNQIONG_DB_HOST: '127.0.0.1', KUNQIONG_DB_PORT: String(port), KUNQIONG_DB_NAME: name,
      KUNQIONG_DB_USER: 'root', KUNQIONG_DB_PASSWORD: '', KUNQIONG_DATA_KEY: 'ab'.repeat(32),
      KUNQIONG_SCAN_MODE: 'required', KUNQIONG_CLAMAV_HOST: '127.0.0.1', KUNQIONG_CLAMAV_PORT: String(scanner.address().port),
      KUNQIONG_ADMIN_USERNAME: 'fixture-admin', KUNQIONG_ADMIN_PASSWORD: 'fixture-admin-password',
    } })
    child.stderr.on('data', data => { stderr += data })
    await until(async () => { try { return (await fetch(base + '/api/health')).ok } catch { return false } })
  }
  const api = async (url, body) => {
    const response = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: { cookie: 'kunqiong_session=scan-token', ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined })
    const data = await response.json(); assert.ok(response.ok, JSON.stringify(data)); return data
  }
  const load = async id => { const store = new RelationalRequestStore(pool); await store.resource({ kind: 'share', id }); return { store, share: store.data.shares[0] } }
  const upload = async label => {
    const bytes = Buffer.from(label), created = await api('/api/upload-sessions', { chunkSize: 1024 * 1024, files: [{ name: label + '.txt', size: bytes.length }] })
    const url = `/api/upload-sessions/${created.sessionId}`
    const form = new FormData(); form.append('chunk', new Blob([bytes]), label + '.txt')
    for (const [key, value] of Object.entries({ fileIndex: '0', chunkIndex: '0', totalChunks: '1', chunkHash: crypto.createHash('sha256').update(bytes).digest('hex') })) form.append(key, value)
    await api(url + '/chunks', form); const data = await api(url + '/complete', { deferScan: true })
    assert.equal(data.share.files[0].reviewStatus, 'pending'); return data.share
  }
  await start()
  const first = await upload('approved')
  await until(() => held.length); const concurrent = await load(first.id)
  concurrent.share.downloadCount = 9; await concurrent.store.commit()
  held.shift()(); await until(async () => (await load(first.id)).share.files[0].reviewStatus === 'approved')
  assert.equal((await load(first.id)).share.downloadCount, 9)
  const audit = new RelationalAuditStore(pool, normalizeAuditLog, 500)
  await until(async () => (await audit.refresh()).some(log => log.details?.shareId === first.id && log.details.scanResult === 'passed' && log.details.background && log.userId === user.id))
  const login = await fetch(base + '/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'fixture-admin', password: 'fixture-admin-password' }) })
  assert.equal(login.status, 200)
  let adminCookie = login.headers.get('set-cookie').split(';')[0]
  const adminRequest = (url, body, method = 'POST', cookie = adminCookie) => fetch(base + url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const scanResponse = await fetch(base + '/api/admin/scans', { headers: { cookie: adminCookie } })
  assert.equal(scanResponse.status, 200)
  const scanResults = await scanResponse.json()
  assert.equal(scanResults.counts.passed, 1)
  assert.ok(scanResults.logs.some(log => log.targetId === 'approved.txt' && log.details.shareId === first.id))
  assert.equal((await adminRequest('/api/admin/config', { autoCleanRiskFiles: 'true' }, 'PATCH')).status, 400)
  const second = await upload('restart-blocked'); await until(() => held.length)
  await stop(); held = []; for (const socket of sockets) socket.destroy()
  verdict = 'stream: Fixture.Threat FOUND'; await start(); await until(() => held.length); held.shift()()
  const renewedLogin = await fetch(base + '/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'fixture-admin', password: 'fixture-admin-password' }) })
  assert.equal(renewedLogin.status, 200)
  adminCookie = renewedLogin.headers.get('set-cookie').split(';')[0]
  await until(async () => (await load(second.id)).share.files[0].reviewStatus === 'blocked')
  const blocked = await load(second.id); assert.equal(blocked.share.files[0].scanAccess, undefined)
  assert.equal((await fetch(`${base}/api/shares/${second.id}/files/0/download`)).status, 415)
  await until(async () => (await audit.refresh()).some(log => log.details?.shareId === second.id && log.details.scanResult === 'blocked' && log.details.signature === 'Fixture.Threat'))
  const threatLog = (await audit.refresh()).find(log => log.details?.shareId === second.id && log.details.scanResult === 'blocked')
  const filePath = path.join(fixture, 'storage/users', user.id, blocked.share.files[0].storedName)
  assert.ok(fs.existsSync(filePath), 'default off retains blocked bytes')
  // An unlink failure must retain blocking metadata and send no success notice.
  fs.renameSync(filePath, filePath + '.fixture-backup'); fs.mkdirSync(filePath)
  assert.ok((await adminRequest(`/api/admin/scans/${threatLog.id}/cleanup`, {})).status >= 500)
  assert.equal((await load(second.id)).share.files[0].reviewStatus, 'blocked')
  const failedMessages = new RelationalRequestStore(pool); await failedMessages.account(user.id, { messages: true })
  assert.equal((failedMessages.data.messages[user.id] || []).filter(item => item.eventType === 'securityRiskCleaned').length, 0)
  fs.rmdirSync(filePath); fs.renameSync(filePath + '.fixture-backup', filePath)
  assert.equal((await adminRequest(`/api/admin/scans/${threatLog.id}/cleanup`, {}, 'POST', 'kunqiong_session=scan-token')).status, 401)
  const passLog = (await audit.refresh()).find(log => log.details?.shareId === first.id && log.details.scanResult === 'passed')
  assert.equal((await adminRequest(`/api/admin/scans/${passLog.id}/cleanup`, {})).status, 400, 'safe files cannot be deleted')
  const approvedPath = path.join(fixture, 'storage/users', user.id, (await load(first.id)).share.files[0].storedName)
  // Keep an approved file in the same share to prove targeted cleanup retains it.
  const mixed = await load(second.id)
  const safeCopy = { ...(await load(first.id)).share.files[0], storedName: `safe-${crypto.randomUUID()}.txt` }
  const safeCopyPath = path.join(fixture, 'storage/users', user.id, safeCopy.storedName)
  fs.copyFileSync(approvedPath, safeCopyPath)
  mixed.share.files.push(safeCopy)
  await mixed.store.commit()
  const manual = await adminRequest(`/api/admin/scans/${threatLog.id}/cleanup`, {})
  assert.equal(manual.status, 200, await manual.text())
  assert.equal(fs.existsSync(filePath), false)
  assert.ok(fs.existsSync(approvedPath))
  assert.ok(fs.existsSync(safeCopyPath))
  assert.equal((await load(second.id)).share.files.length, 1)
  assert.equal((await adminRequest(`/api/admin/scans/${threatLog.id}/cleanup`, {})).status, 409)
  const messages = new RelationalRequestStore(pool); await messages.account(user.id, { messages: true })
  assert.equal(messages.data.messages[user.id].filter(item => item.eventType === 'securityRiskCleaned').length, 1)
  const cleanedList = await fetch(base + '/api/admin/scans', { headers: { cookie: adminCookie } })
  assert.ok((await cleanedList.json()).logs.find(log => log.id === threatLog.id).cleaned)
  // Enabling the switch also sweeps existing blocked files, with audit intact.
  const historical = await upload('historical-threat'); await until(() => held.length); held.shift()()
  await until(async () => (await load(historical.id)).share.files[0].reviewStatus === 'blocked')
  assert.equal((await adminRequest('/api/admin/config', { autoCleanRiskFiles: true }, 'PATCH')).status, 200)
  await until(async () => (await load(historical.id)).share.files.length === 0)
  assert.equal((await load(historical.id)).share.status, 'closed')
  await until(async () => (await audit.refresh()).some(log => log.action === '自动清理风险文件' && log.details.shareId === historical.id))
  // A fresh threat follows the same automatic cleanup path.
  const automatic = await upload('automatic-threat'); await until(() => held.length); held.shift()()
  await until(async () => (await load(automatic.id)).share.files.length === 0)
  const finalMessages = new RelationalRequestStore(pool); await finalMessages.account(user.id, { messages: true })
  assert.equal(finalMessages.data.messages[user.id].filter(item => item.eventType === 'securityRiskCleaned').length, 3)
  assert.ok(fs.existsSync(approvedPath), 'all safe bytes retained')
  verdict = 'stream: ERROR'; const incomplete = await upload('scan-failure'); await until(() => held.length); held.shift()()
  await until(async () => (await load(incomplete.id)).share.files[0].reviewStatus === 'scan_failed')
  assert.ok(fs.existsSync(path.join(fixture, 'storage/users', user.id, (await load(incomplete.id)).share.files[0].storedName)), 'scanner failures are never deleted')
  assert.equal(fs.readFileSync(path.join(fixture, 'storage/metadata.json'), 'utf8'), 'must never be read')
})
