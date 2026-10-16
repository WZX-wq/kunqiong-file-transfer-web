// 校验元数据快照的并发写保护（revision CAS + 冲突合并）。
// 背景：整个应用状态存成一份 metadata.json，persistMetadata 每次全量覆盖写入。
// 同一份 storage 上跑两个进程时（多实例部署、或本机多开），后写者会把先写者刚加进去的
// 记录整体抹掉——静默丢数据。本脚本起两个真实进程复现该场景并验证修复。
// 修复前：第 3 步只会有 1 个分享；修复后两个分享都必须还在。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-cas-'))
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let passed = 0
let failed = 0
const check = (name, condition, detail = '') => {
  if (condition) { passed++; console.log(`PASS ${name}`) }
  else { failed++; console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}

// 不用 fs.cpSync：部分受限执行环境会直接终止使用了递归复制的进程。
function copyDirectory(source, target) {
  fs.mkdirSync(target, { recursive: true })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name)
    const to = path.join(target, entry.name)
    if (entry.isDirectory()) copyDirectory(from, to)
    else fs.copyFileSync(from, to)
  }
}

const now = new Date().toISOString()
const future = new Date(Date.now() + 20 * 86400000).toISOString()
const UID = 'cas'
const user = {
  id: UID, username: 'cas', nickname: 'cas', email: 'cas@example.com', phone: '',
  avatar: null, avatarSource: '', providerAvatar: null, provider: '', loginMethods: ['oauth'],
  planId: 'free', planStartedAt: null, planExpiresAt: null, organizationId: '', organizationRole: '',
  status: 'active', fileCleanup: { enabled: false, days: 7 }, createdAt: now, updatedAt: now,
}
const seed = {
  users: { [UID]: user },
  sessions: [{ id: 'cas-session', user, apiWebToken: '', expiresAt: future }],
  shares: [], collections: [], messages: {}, auditLogs: [], upgradeOrders: [],
  notificationSettings: {}, guestUsage: {}, organizations: [], verificationCodes: [],
  systemConfig: { anonymousTotalSizeMb: 1 },
}

fs.mkdirSync(path.join(fixture, 'storage'))
fs.writeFileSync(path.join(fixture, 'storage', 'metadata.json'), JSON.stringify(seed, null, 2))
fs.copyFileSync(path.join(root, 'server.mjs'), path.join(fixture, 'server.mjs'))
copyDirectory(path.join(root, 'server'), path.join(fixture, 'server'))
fs.copyFileSync(path.join(root, 'package.json'), path.join(fixture, 'package.json'))
fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
fs.symlinkSync(path.join(root, 'dist'), path.join(fixture, 'dist'), process.platform === 'win32' ? 'junction' : 'dir')

const metadataFile = path.join(fixture, 'storage', 'metadata.json')
const revisionFile = path.join(fixture, 'storage', 'metadata.json.revision')
const stored = () => JSON.parse(fs.readFileSync(metadataFile, 'utf8'))
// 容错读取：修复前的版本不写版本号文件，直接抛错会让脚本崩在中途而不是报出真正的失败项。
const diskRevision = () => {
  try { return Number(fs.readFileSync(revisionFile, 'utf8').trim()) || 0 } catch { return 0 }
}

const cleanEnv = { ...process.env }
for (const key of Object.keys(cleanEnv)) if (key.startsWith('KUNQIONG_') || key.startsWith('OAUTH_')) delete cleanEnv[key]

const children = []
const logs = new Map()
async function startInstance(label) {
  const probe = net.createServer()
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise((resolve) => probe.close(resolve))
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: fixture,
    windowsHide: true,
    env: { ...cleanEnv, PORT: String(port), KUNQIONG_HOST: '127.0.0.1', KUNQIONG_DB_ENABLED: 'false', KUNQIONG_SCAN_MODE: 'optional', NODE_ENV: 'production' },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let output = ''
  child.stderr.on('data', (data) => { output += data.toString() })
  logs.set(label, () => output)
  children.push(child)
  const base = `http://127.0.0.1:${port}`
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(base + '/api/health')).ok) return base } catch {}
    await delay(50)
  }
  throw new Error(`实例 ${label} 启动失败：${output}`)
}
async function stopAll() {
  await Promise.all(children.map(async (child) => {
    if (!child || child.exitCode !== null) return
    const exited = once(child, 'exit')
    child.kill()
    await Promise.race([exited, delay(3000)])
    if (child.exitCode === null) child.kill('SIGKILL')
  }))
}
async function api(base, url, { method = 'GET', body } = {}) {
  const response = await fetch(base + url, {
    method,
    headers: {
      cookie: 'kunqiong_session=cas-session',
      ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}),
    },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => ({}))
  return { status: response.status, data }
}
function shareBody(name) {
  const body = new FormData()
  body.append('files', new Blob([`content of ${name}`]), name)
  return body
}

try {
  const first = await startInstance('first')
  const second = await startInstance('second')
  check('两个实例共用同一份 storage 正常启动', true)
  const initialRevision = diskRevision()

  const createdByFirst = await api(first, '/api/shares', { method: 'POST', body: shareBody('from-first.txt') })
  assert.equal(createdByFirst.status, 201, `实例一创建分享失败：${JSON.stringify(createdByFirst.data)}`)
  const firstShareId = createdByFirst.data.share.id
  check('实例一写入后快照有 1 个分享', stored().shares.length === 1)
  const revisionAfterFirst = diskRevision()
  check('落盘版本号随之递增', revisionAfterFirst > initialRevision, `实际 ${initialRevision} → ${revisionAfterFirst}`)

  // 关键场景：实例二的内存快照停留在启动时刻（0 个分享），此时才写入。
  const createdBySecond = await api(second, '/api/shares', { method: 'POST', body: shareBody('from-second.txt') })
  assert.equal(createdBySecond.status, 201, `实例二创建分享失败：${JSON.stringify(createdBySecond.data)}`)
  const store = stored()
  check('后写者不会覆盖先写者的记录（并发写不丢数据）', store.shares.length === 2, `实际 ${store.shares.length} 个分享`)
  check('先写者写入的分享仍在快照中', store.shares.some((item) => item.id === firstShareId))
  check('冲突已被识别并走合并路径', /\[metadata-cas\]/.test([...logs.values()].map((read) => read()).join('\n')))
  check('版本号随写入单调递增', diskRevision() > revisionAfterFirst, `${revisionAfterFirst} → ${diskRevision()}`)
  check('覆盖前留有 .bak 备份', fs.existsSync(`${metadataFile}.bak`))

  // 同一记录的并发修改：按 updatedAt 取较新的一份，关闭状态不能被旧快照顶回 active。
  const closed = await api(first, `/api/shares/manage/${store.shares.find((item) => item.id === firstShareId).manageToken}`, { method: 'DELETE' })
  assert.equal(closed.status, 200, `关闭分享失败：${JSON.stringify(closed.data)}`)
  const removed = await api(second, `/api/shares/manage/${store.shares.find((item) => item.id !== firstShareId).manageToken}`, { method: 'DELETE' })
  assert.equal(removed.status, 200)
  const afterClose = stored()
  const describe = () => afterClose.shares.map((item) => `${item.id === firstShareId ? 'first' : 'second'}:${item.status}@${item.updatedAt}`).join(' | ')
  check('并发关闭不会让分享数量回退', afterClose.shares.length === 2, `实际 ${afterClose.shares.length}`)
  check('两个分享都保持关闭状态（时间戳较新的改动生效）', afterClose.shares.every((item) => item.status === 'closed'), describe())
  if (!afterClose.shares.every((item) => item.status === 'closed')) console.log([...logs.entries()].map(([label, read]) => `--- ${label} ---\n${read()}`).join('\n'))

  // 版本号会随每次落盘单调递增，重启后从磁盘续接而不是归零。
  const beforeRestart = diskRevision()
  await stopAll()
  children.length = 0
  const restarted = await startInstance('restarted')
  await api(restarted, '/api/shares', { method: 'POST', body: shareBody('after-restart.txt') })
  check('重启后版本号续接，不回到 0', diskRevision() > beforeRestart, `${beforeRestart} → ${diskRevision()}`)
  check('重启后的快照保留此前全部分享', stored().shares.length === 3, `实际 ${stored().shares.length}`)

  console.log(`\n元数据并发写检查：${passed}/${passed + failed}${failed ? `（${failed} 项失败）` : '，全部通过'}`)
  console.log(`隔离沙箱：${fixture}`)
} finally {
  await stopAll()
}

if (failed) process.exit(1)
