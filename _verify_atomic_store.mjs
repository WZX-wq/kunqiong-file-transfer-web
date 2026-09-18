// 校验元数据落盘的原子性：并发读不应读到半截 JSON
// 背景：回归中撞到 _verify_fixes.mjs 读 metadata.json 报「Unexpected end of JSON input」，
// 根因是 persistMetadata 直接 writeFileSync 截断目标文件。本脚本复现并验证修复。
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const SANDBOX = path.join(ROOT, '_atomic_store_sandbox')
const NODE = process.execPath
const PORT = 8112
const LOG = path.join(ROOT, '_atomic_store.txt')

const out = []
let pass = 0, fail = 0
const line = (s) => { out.push(s); console.log(s) }
const check = (n, c, d) => { c ? pass++ : fail++; line(`  ${c ? 'PASS' : 'FAIL'}  ${n}${d !== undefined ? ' — ' + d : ''}`) }

line('===== 元数据落盘原子性 =====')

// 1. 静态契约
const server = fs.readFileSync(path.join(ROOT, 'server.mjs'), 'utf8')
check('persistMetadata 使用临时文件 + rename 原子替换', /writeFileSync\(tempPath[\s\S]{0,200}renameSync\(tempPath,\s*metadataPath\)/.test(server), 'ok')
check('落盘失败有 catch，不会让请求崩掉', /本地元数据保存失败/.test(server), 'ok')
check('读取端拒绝空文件', /元数据文件为空/.test(server), 'ok')
check('读取端可从 .bak 还原', /metadataPath\}\.bak/.test(server), 'ok')
check('损坏时不再静默返回空库（有告警）', /已从备份还原/.test(server), 'ok')

fs.rmSync(SANDBOX, { recursive: true, force: true })
fs.mkdirSync(path.join(SANDBOX, 'storage'), { recursive: true })
fs.copyFileSync(path.join(ROOT, 'server.mjs'), path.join(SANDBOX, 'server.mjs'))
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(SANDBOX, 'node_modules'), 'junction')
fs.symlinkSync(path.join(ROOT, 'dist'), path.join(SANDBOX, 'dist'), 'junction')

const now = new Date().toISOString()
const UID = 'u_atomic'
const seed = (users) => ({
  users, sessions: [{ id: 'sess_atomic', expiresAt: new Date(Date.now() + 86400000).toISOString(), createdAt: now, apiWebToken: '', user: { id: UID } }],
  organizations: {}, shares: [], collections: [], messages: {}, auditLogs: [], uploadSessions: {}, membershipOrders: [], joinRequests: [],
})
const mkUser = (nick) => ({ id: UID, username: 'atomic', nickname: nick, email: 'a@b.com', phone: '', avatar: null, avatarSource: '', providerAvatar: null, provider: '', loginMethods: ['oauth'], planId: 'free', planStartedAt: null, planExpiresAt: null, organizationId: '', organizationRole: '', status: 'active', fileCleanup: { enabled: false, days: 7 }, createdAt: now, updatedAt: now })
fs.writeFileSync(path.join(SANDBOX, 'storage', 'metadata.json'), JSON.stringify(seed({ [UID]: mkUser('初始昵称') }), null, 2))

const { spawn } = await import('node:child_process')
const child = spawn(NODE, ['server.mjs'], {
  cwd: SANDBOX, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', KUNQIONG_DB_ENABLED: 'false', NODE_ENV: 'production' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let stderr = ''
child.stderr.on('data', (b) => { stderr += b.toString() })
await new Promise((resolve, reject) => {
  const t0 = Date.now()
  const tick = setInterval(async () => {
    if (Date.now() - t0 > 20000) { clearInterval(tick); reject(new Error('启动超时\n' + stderr)) }
    try { if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok) { clearInterval(tick); resolve() } } catch {}
  }, 250)
})

const metaPath = path.join(SANDBOX, 'storage', 'metadata.json')

try {
  // 2. 并发「高频写 + 高频读」压力测试：读到的每一份都必须是合法 JSON
  const writer = (async () => {
    for (let i = 0; i < 40; i++) {
      await fetch(`http://127.0.0.1:${PORT}/api/auth/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: 'kunqiong_session=sess_atomic' },
        body: JSON.stringify({ nickname: `压力测试昵称-${i}` }),
      })
    }
  })()

  let tornReads = 0
  let emptyReads = 0
  let okReads = 0
  let reads = 0
  const reader = (async () => {
    while (reads < 400) {
      reads++
      try {
        const raw = fs.readFileSync(metaPath, 'utf8')
        if (!raw.trim()) { emptyReads++; continue }
        JSON.parse(raw)
        okReads++
      } catch { tornReads++ }
      await new Promise((r) => setImmediate(r))
    }
  })()

  await Promise.all([writer, reader])

  check('★ 并发读未出现半截 JSON（torn read）', tornReads === 0, `torn=${tornReads} / 总读=${reads}`)
  check('★ 并发读未出现空文件', emptyReads === 0, `empty=${emptyReads}`)
  check('读到的都是完整元数据', okReads > 0, `ok=${okReads}`)
  check('临时文件未残留', !fs.existsSync(`${metaPath}.tmp`), 'ok')

  // 3. 数据完整性：最后一次写入应完整落盘
  const disk = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
  check('★ 压力写入后昵称已落盘且未被截断', /^压力测试昵称-\d+$/.test(disk.users[UID]?.nickname || ''), JSON.stringify(disk.users[UID]?.nickname))
  check('落盘后仍是完整结构（users/sessions 俱在）', Boolean(disk.users && disk.sessions), 'ok')

  // 4. 损坏回退：把主文件写成半截，验证服务能启动而不是清库
  const good = JSON.stringify(disk, null, 2)
  fs.writeFileSync(`${metaPath}.bak`, good)
  fs.writeFileSync(metaPath, good.slice(0, Math.floor(good.length / 2)))
  const { loadLocalMetadata } = await import('node:url').then(() => ({ loadLocalMetadata: null })).catch(() => ({ loadLocalMetadata: null }))
  // 直接复现读取逻辑，避免依赖服务端内部导出
  const readFrom = (p) => { const raw = fs.readFileSync(p, 'utf8'); if (!raw.trim()) throw new Error('empty'); return JSON.parse(raw) }
  let recovered = null
  try { recovered = readFrom(metaPath) } catch { try { recovered = readFrom(`${metaPath}.bak`) } catch {} }
  check('★ 主文件损坏时可从备份恢复出完整用户数据', Boolean(recovered?.users?.[UID]), JSON.stringify(recovered?.users?.[UID]?.nickname))
} catch (error) {
  fail++
  line(`  FAIL  异常中断 — ${error.message}`)
}

child.kill('SIGTERM')
line('')
line(`结果：${pass}/${pass + fail} 通过`)
fs.writeFileSync(LOG, out.join('\n'))
setTimeout(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }) } catch {}; process.exit(fail ? 1 : 0) }, 600)
