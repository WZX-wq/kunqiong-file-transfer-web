// 专项探针：分片 offset 直写 + SHA-256 校验 + 会话状态查询 + 重启恢复
// 覆盖回归套件没打到的多分片路径（套件只发单分片=整文件）。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const SANDBOX = path.join(ROOT, '_direct_write_sandbox')
const NODE = process.execPath
const PORT = 4895
const BASE = `http://127.0.0.1:${PORT}`
const CHUNK = 8 * 1024 * 1024

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  :: ${detail}` : ''}`)
}

fs.rmSync(SANDBOX, { recursive: true, force: true })
fs.mkdirSync(path.join(SANDBOX, 'storage'), { recursive: true })
fs.copyFileSync(path.join(ROOT, 'server.mjs'), path.join(SANDBOX, 'server.mjs'))
try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(SANDBOX, 'node_modules'), 'junction') } catch {}

const now = new Date().toISOString()
const mkUser = (id, nick) => ({
  id, username: id, nickname: nick, email: `${id}@kunqiong.com`, phone: '', avatar: null,
  avatarSource: '', providerAvatar: null, provider: '', loginMethods: ['oauth'],
  planId: 'member', planStartedAt: null, planExpiresAt: null,
  organizationId: '', organizationRole: '', status: 'active',
  fileCleanup: { enabled: false, days: 7 }, createdAt: now, updatedAt: now,
})
fs.writeFileSync(path.join(SANDBOX, 'storage', 'metadata.json'), JSON.stringify({
  users: { u_probe: mkUser('u_probe', '探针用户') },
  sessions: [
    { id: 'sess_probe', expiresAt: new Date(Date.now() + 86400000).toISOString(), createdAt: now, apiWebToken: '', user: mkUser('u_probe', '探针用户') },
  ],
  organizations: {}, messages: {}, shares: [], collections: [],
  auditLogs: [], uploadSessions: {}, membershipOrders: [], joinRequests: [], upgradeOrders: [],
  systemConfig: { siteName: '鲲穹', registrationOpen: true },
}, null, 2))

let serverErr = ''
let child = null
const startServer = () => {
  serverErr = ''
  child = spawn(NODE, ['server.mjs'], {
    cwd: SANDBOX,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', KUNQIONG_DB_ENABLED: 'false', NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stderr.on('data', (b) => { serverErr += b.toString() })
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const tick = setInterval(async () => {
      if (Date.now() - t0 > 25000) { clearInterval(tick); reject(new Error('服务启动超时\n' + serverErr)) }
      try { if ((await fetch(`${BASE}/api/health`)).ok) { clearInterval(tick); resolve() } } catch {}
    }, 250)
  })
}
const stopServer = () => new Promise((resolve) => {
  if (!child) return resolve()
  child.removeAllListeners('exit')
  child.on('exit', () => resolve())
  child.kill()
})

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

async function createSession(name, size, chunkSize = CHUNK) {
  const r = await fetch(`${BASE}/api/upload-sessions`, {
    method: 'POST',
    headers: { Cookie: 'kunqiong_session=sess_probe', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      files: [{ name, relativePath: name, size, mimeType: 'application/octet-stream' }],
      chunkSize, expiryDays: '3', downloadLimit: 'unlimited', password: '', codeLength: '6', recipients: '',
    }),
  })
  return { status: r.status, body: await r.json() }
}

async function uploadChunk(sid, chunkIndex, totalChunks, data, hash) {
  const fd = new FormData()
  fd.append('fileIndex', '0')
  fd.append('chunkIndex', String(chunkIndex))
  fd.append('totalChunks', String(totalChunks))
  if (hash !== undefined) fd.append('chunkHash', hash)
  fd.append('chunk', new Blob([data], { type: 'application/octet-stream' }), 'probe.bin')
  const r = await fetch(`${BASE}/api/upload-sessions/${sid}/chunks`, {
    method: 'POST', headers: { Cookie: 'kunqiong_session=sess_probe' }, body: fd,
  })
  return { status: r.status, body: await r.json().catch(() => ({})) }
}

async function complete(sid, chunkSize = CHUNK) {
  const r = await fetch(`${BASE}/api/upload-sessions/${sid}/complete`, {
    method: 'POST', headers: { Cookie: 'kunqiong_session=sess_probe', 'Content-Type': 'application/json' },
    body: JSON.stringify({ chunkSize }),
  })
  return { status: r.status, body: await r.json().catch(() => ({})) }
}

async function getStatus(sid) {
  const r = await fetch(`${BASE}/api/upload-sessions/${sid}`)
  return { status: r.status, body: await r.json().catch(() => ({})) }
}

// ---------- 主流程 ----------
await startServer()
try {
  const FILE = crypto.randomBytes(20 * 1024 * 1024)
  const totalChunks = Math.ceil(FILE.length / CHUNK)

  // T8 清单落盘
  const created = await createSession('probe.bin', FILE.length)
  check('T8 创建会话 201 且 chunkSize 收敛', created.status === 201 && created.body.sessionId, `status=${created.status} msg=${created.body.message}`)
  const sid = created.body.sessionId
  if (!sid) {
    const pass = results.filter((r) => r.ok).length
    console.log(`\n结果：${pass}/${results.length} 通过`)
    await stopServer()
    process.exit(1)
  }
  const manifestOk = fs.existsSync(path.join(SANDBOX, 'storage', 'tmp', 'upload-sessions', sid, 'session.json'))
  check('T8 session.json 清单落盘', manifestOk)

  // T2 分片大小不符 → 400
  const wrong = await uploadChunk(sid, 0, totalChunks, FILE.subarray(0, 1024 * 1024), sha256(FILE.subarray(0, 1024 * 1024)))
  check('T2 分片大小与配置不符被拒', wrong.status === 400, `status=${wrong.status} msg=${wrong.body.message}`)

  // T3 哈希不符 → 400
  const badHash = await uploadChunk(sid, 0, totalChunks, FILE.subarray(0, CHUNK), 'f'.repeat(64))
  check('T3 分片哈希不符被拒', badHash.status === 400, `status=${badHash.status}`)

  // T6 缺分片 complete → 409
  const early = await complete(sid)
  check('T6 缺分片 complete 返回 409', early.status === 409, `status=${early.status} msg=${early.body.message}`)

  // T1 乱序上传 2,0,1 → complete 201 → 内容一致
  const order = [2, 0, 1]
  for (const i of order) {
    const start = i * CHUNK
    const data = FILE.subarray(start, Math.min(FILE.length, start + CHUNK))
    const up = await uploadChunk(sid, i, totalChunks, data, sha256(data))
    if (up.status !== 200) { check(`T1 分片${i}上传`, false, `status=${up.status}`); break }
    if (i === order[order.length - 1]) check('T1 分片乱序上传全部 200', true)
  }
  const st = await getStatus(sid)
  check('T4 GET 会话状态返回已传分片', st.status === 200 && JSON.stringify(st.body.files[0].uploadedChunks) === '[0,1,2]', `chunks=${JSON.stringify(st.body.files?.[0]?.uploadedChunks)}`)
  const done = await complete(sid)
  check('T1 乱序分片 complete 201', done.status === 201, `status=${done.status} msg=${done.body.message}`)
  let contentOk = false
  if (done.status === 201) {
    const shareDir = path.join(SANDBOX, 'storage', 'files', done.body.share.id)
    const stored = fs.readdirSync(shareDir)[0]
    contentOk = fs.readFileSync(path.join(shareDir, stored)).equals(FILE)
  }
  check('T1 合并内容逐字节一致（直写无合并损耗）', contentOk)

  // T7 空文件
  const empty = await createSession('empty.bin', 0)
  const esid = empty.body.sessionId
  await uploadChunk(esid, 0, 1, new ArrayBuffer(0), sha256(Buffer.alloc(0)))
  const emptyDone = await complete(esid)
  check('T7 空文件上传 complete 201', emptyDone.status === 201, `status=${emptyDone.status} msg=${emptyDone.body.message}`)

  // T5 重启恢复：传 2/3 片 → 杀进程 → 重启 → 状态还在 → 补传最后一片
  const big = crypto.randomBytes(17 * 1024 * 1024)
  const bt = Math.ceil(big.length / CHUNK)
  const resumed = await createSession('resume.bin', big.length)
  const rsid = resumed.body.sessionId
  for (const i of [0, 1]) {
    const start = i * CHUNK
    const data = big.subarray(start, Math.min(big.length, start + CHUNK))
    await uploadChunk(rsid, i, bt, data, sha256(data))
  }
  await stopServer()
  await startServer()
  const after = await getStatus(rsid)
  check('T5 重启后 GET 会话状态恢复', after.status === 200 && JSON.stringify(after.body.files[0].uploadedChunks) === '[0,1]', `status=${after.status} chunks=${JSON.stringify(after.body.files?.[0]?.uploadedChunks)}`)
  const last = big.subarray(2 * CHUNK)
  const lastUp = await uploadChunk(rsid, 2, bt, last, sha256(last))
  const resumedDone = await complete(rsid)
  let resumedOk = lastUp.status === 200 && resumedDone.status === 201
  if (resumedOk) {
    const shareDir = path.join(SANDBOX, 'storage', 'files', resumedDone.body.share.id)
    const stored = fs.readdirSync(shareDir)[0]
    resumedOk = fs.readFileSync(path.join(shareDir, stored)).equals(big)
  }
  check('T5 重启续传后内容一致', resumedOk, `last=${lastUp.status} complete=${resumedDone.status}`)

  const pass = results.filter((r) => r.ok).length
  console.log(`\n结果：${pass}/${results.length} 通过`)
  process.exit(pass === results.length ? 0 : 1)
} finally {
  await stopServer()
}
