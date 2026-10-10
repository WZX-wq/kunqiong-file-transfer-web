// 消息删除持久化复现：删除单条 / 删除默认消息 / 清空全部 → 页面刷新（重新 GET）与后端重启后是否「复活」。
// 用法：node scripts/verify-message-delete.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-msg-delete-'))
const future = new Date(Date.now() + 20 * 86400000).toISOString()
const users = { owner: { id: 'owner-uid', username: 'owner', nickname: 'owner', status: 'active', planId: 'member', planExpiresAt: future } }
const sessions = [{ id: 'owner-session', user: users.owner, apiWebToken: 'fixture-token-owner', expiresAt: future }]
fs.copyFileSync(path.join(root, 'server.mjs'), path.join(fixture, 'server.mjs'))
function copyDirectory(source, target) {
  fs.mkdirSync(target, { recursive: true })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name); const to = path.join(target, entry.name)
    if (entry.isDirectory()) copyDirectory(from, to); else if (entry.isFile()) fs.copyFileSync(from, to)
  }
}
copyDirectory(path.join(root, 'server'), path.join(fixture, 'server'))
fs.copyFileSync(path.join(root, 'package.json'), path.join(fixture, 'package.json'))
fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
const templateSource = path.join(root, 'email-templates')
if (fs.existsSync(templateSource)) {
  fs.mkdirSync(path.join(fixture, 'email-templates'))
  for (const name of fs.readdirSync(templateSource)) fs.copyFileSync(path.join(templateSource, name), path.join(fixture, 'email-templates', name))
}
fs.mkdirSync(path.join(fixture, 'storage'))
fs.writeFileSync(path.join(fixture, 'storage', 'metadata.json'), JSON.stringify({ users: Object.fromEntries(Object.entries(users)), sessions, shares: [], collections: [], messages: {}, systemConfig: { anonymousTotalSizeMb: 1 }, upgradeOrders: [] }))

const scanner = net.createServer((socket) => {
  let input = Buffer.alloc(0), command = false, ended = false
  socket.on('error', () => {})
  socket.on('data', (data) => {
    input = Buffer.concat([input, data])
    if (!command) { const e = input.indexOf(0); if (e < 0) return; input = input.subarray(e + 1); command = true }
    while (input.length >= 4 && !ended) {
      const length = input.readUInt32BE(0)
      if (input.length < 4 + length) break
      input = input.subarray(4 + length)
      if (!length) { ended = true; socket.end('stream: OK\0') }
    }
  })
})
await new Promise((r) => scanner.listen(0, '127.0.0.1', r))

const cleanEnv = { ...process.env }
for (const key of Object.keys(cleanEnv)) if (key.startsWith('KUNQIONG_') || key.startsWith('OAUTH_')) delete cleanEnv[key]

let child, base, port = 0, passed = 0
const failures = []
function check(name, cond, detail = '') { if (cond) { passed++; console.log(`  PASS  ${name}`) } else { failures.push(name); console.log(`  FAIL  ${name}  ${detail}`) } }
async function startProcess() {
  const probe = net.createServer(); await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const probePort = probe.address().port; await new Promise((resolve) => probe.close(resolve))
  const proc = spawn(process.execPath, ['server.mjs'], {
    cwd: fixture, windowsHide: true,
    env: { ...cleanEnv, PORT: String(probePort), NODE_ENV: 'production', KUNQIONG_HOST: '127.0.0.1', KUNQIONG_SCAN_MODE: 'required', KUNQIONG_CLAMAV_HOST: '127.0.0.1', KUNQIONG_CLAMAV_PORT: String(scanner.address().port) },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let errors = ''
  proc.stderr.on('data', (d) => { errors += d })
  const procBase = `http://127.0.0.1:${probePort}`
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(procBase + '/api/health')).ok) return { child: proc, base: procBase, port: probePort } } catch {}
    if (proc.exitCode !== null) throw new Error('fixture 启动失败: ' + errors)
    await delay(50)
  }
  throw new Error('fixture 启动失败: ' + errors)
}
async function start() {
  const proc = await startProcess()
  child = proc.child; base = proc.base; port = proc.port
}
async function callWith(proc, url, { method = 'GET', body, headers = {} } = {}) {
  const isForm = body instanceof FormData
  const res = await fetch(proc.base + url, { method, headers: { cookie: 'kunqiong_session=owner-session', ...(body && !isForm ? { 'content-type': 'application/json' } : {}), ...headers }, body: isForm ? body : body ? JSON.stringify(body) : undefined })
  return await res.json().catch(() => ({}))
}
async function stop() { if (child && child.exitCode === null) { const e = once(child, 'exit'); child.kill(); await Promise.race([e, delay(3000)]) } }
async function api(url, { method = 'GET', body, headers = {} } = {}) {
  const isForm = body instanceof FormData
  const res = await fetch(base + url, { method, headers: { cookie: 'kunqiong_session=owner-session', ...(body && !isForm ? { 'content-type': 'application/json' } : {}), ...headers }, body: isForm ? body : body ? JSON.stringify(body) : undefined })
  const data = await res.json().catch(() => ({}))
  return { res, data, status: res.status }
}
const diskMessages = () => {
  const snapshot = JSON.parse(fs.readFileSync(path.join(fixture, 'storage', 'metadata.json'), 'utf8'))
  return (snapshot.messages || {})['owner-uid'] || []
}

try {
  await start()

  console.log('\n=== 场景 1：默认消息（欢迎/服务通知）删除后刷新 ===')
  const init = await api('/api/account/messages')
  check('初始默认消息 2 条', init.data.messages?.length === 2, `len=${init.data.messages?.length}`)
  const welcome = init.data.messages.find((m) => m.title.includes('欢迎'))
  const del1 = await api(`/api/account/messages/${encodeURIComponent(welcome.id)}`, { method: 'DELETE' })
  check('删除欢迎消息 200', del1.status === 200, `status=${del1.status}`)
  const afterDel1 = await api('/api/account/messages')
  check('删除后立即 GET 只剩 1 条（刷新模拟）', afterDel1.data.messages?.length === 1, `len=${afterDel1.data.messages?.length}`)
  check('磁盘同步删除（1 条）', diskMessages().length === 1, `disk=${diskMessages().length}`)

  console.log('\n=== 场景 2：删除后重启后端，消息是否复活 ===')
  await stop(); await start()
  const afterRestart = await api('/api/account/messages')
  check('重启后仍为 1 条（不复活）', afterRestart.data.messages?.length === 1, `len=${afterRestart.data.messages?.length}`)

  console.log('\n=== 场景 3：清空全部 → 重启 → 是否重建默认消息 ===')
  const clear = await api('/api/account/messages', { method: 'DELETE' })
  check('清空全部 200 且为空', clear.status === 200 && clear.data.messages?.length === 0, `status=${clear.status} len=${clear.data.messages?.length}`)
  const afterClearGet = await api('/api/account/messages')
  check('清空后立即 GET 仍为空（不重建）', afterClearGet.data.messages?.length === 0, `len=${afterClearGet.data.messages?.length}`)
  await stop(); await start()
  const afterClearRestart = await api('/api/account/messages')
  check('重启后仍为空（不重建默认消息）', afterClearRestart.data.messages?.length === 0, `len=${afterClearRestart.data.messages?.length}`)

  console.log('\n=== 场景 4：「已被下载」消息删除 → 重启 → 是否重生 ===')
  // 上传分享并下载一次，触发「你发送的文件已被下载」消息
  const form = new FormData()
  form.append('files', new Blob(['download-me']), 'fixture-download.txt')
  const up = await api('/api/shares', { method: 'POST', body: form })
  const share = up.data.share
  await fetch(`${base}/api/shares/${share.id}/download`, { headers: { cookie: 'kunqiong_session=owner-session' } })
  await delay(300)
  const withDownloadMsg = await api('/api/account/messages')
  const downloadMsg = (withDownloadMsg.data.messages || []).find((m) => m.title.includes('已被下载'))
  check('下载后生成「已被下载」消息', Boolean(downloadMsg), `titles=${(withDownloadMsg.data.messages || []).map((m) => m.title).join('|')}`)
  if (downloadMsg) {
    const delMsg = await api(`/api/account/messages/${encodeURIComponent(downloadMsg.id)}`, { method: 'DELETE' })
    check('删除「已被下载」200', delMsg.status === 200, `status=${delMsg.status}`)
    await stop(); await start()
    const afterRestart2 = await api('/api/account/messages')
    const reborn = (afterRestart2.data.messages || []).find((m) => m.title.includes('已被下载'))
    check('重启后「已被下载」未重生', !reborn, `titles=${(afterRestart2.data.messages || []).map((m) => m.title).join('|')}`)
    check('磁盘上无「已被下载」残留', !diskMessages().some((m) => String(m.title).includes('已被下载')), `disk=${JSON.stringify(diskMessages().map((m) => m.title))}`)
  }

  console.log('\n=== 场景 5：双进程共用 storage（旧进程写盘触发合并，删除是否复活）===')
  await stop()
  // 进程 A（“当前”进程）：先触发一条「已被下载」消息
  await start()
  const form5 = new FormData()
  form5.append('files', new Blob(['shared-bytes']), 'shared.txt')
  const up5 = await api('/api/shares', { method: 'POST', body: form5 })
  const share5 = up5.data.share
  await fetch(`${base}/api/shares/${share5.id}/download`, { headers: { cookie: 'kunqiong_session=owner-session' } })
  await delay(300)
  const listA1 = await api('/api/account/messages')
  const target5 = (listA1.data.messages || []).find((m) => m.title.includes('已被下载'))
  check('进程 A：下载消息已生成', Boolean(target5), `titles=${(listA1.data.messages || []).map((m) => m.title).join('|')}`)

  // 进程 B：在 A 删除之前启动，B 的内存快照里含有该消息（模拟“未退出的旧进程”）
  const procB = await startProcess()
  const listB1 = await callWith(procB, '/api/account/messages')
  check('进程 B：启动时快照含该消息', (listB1.messages || []).some((m) => m.id === target5.id), `len=${(listB1.messages || []).length}`)

  // A 删除消息 → 写盘（A 的 revision 前进）
  const delA = await api(`/api/account/messages/${encodeURIComponent(target5.id)}`, { method: 'DELETE' })
  check('进程 A：删除成功', delA.status === 200 && !(delA.data.messages || []).some((m) => m.id === target5.id), `status=${delA.status}`)

  // B 做一次写盘（删除另一条消息，或触发一次持久化操作）→ B 内存快照落后于磁盘 → 触发合并
  const listB2 = await callWith(procB, '/api/account/messages')
  const otherMsg = (listB2.messages || []).find((m) => m.id !== target5.id)
  if (otherMsg) await callWith(procB, `/api/account/messages/${encodeURIComponent(otherMsg.id)}`, { method: 'DELETE' })
  else await callWith(procB, '/api/account/messages', { method: 'DELETE' }) // 清空也会写盘
  await delay(300)

  // 合并后：磁盘/服务端是否又把 target5 带回？
  const finalDisk = diskMessages()
  const revived = finalDisk.some((m) => m.id === target5.id)
  check('合并后目标消息未复活（磁盘校验）', !revived, `disk=${JSON.stringify(finalDisk.map((m) => m.title))}`)
  const finalGet = await api('/api/account/messages')
  check('合并后 GET 无目标消息', !(finalGet.data.messages || []).some((m) => m.id === target5.id), `len=${(finalGet.data.messages || []).length}`)
  const e5 = once(procB.child, 'exit'); procB.child.kill(); await Promise.race([e5, delay(3000)])
} catch (error) {
  console.error('\n复现脚本异常:', error.message)
  failures.push('脚本异常: ' + error.message)
} finally {
  await stop()
  await new Promise((r) => scanner.close(r))
  console.log(`\n结果: ${passed} 通过 / ${failures.length} 失败`)
  if (failures.length) { for (const f of failures) console.log(`  FAIL: ${f}`); process.exitCode = 1 }
}
