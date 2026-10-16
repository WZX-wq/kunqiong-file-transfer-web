// 未登录（游客）累计传输配额验证
// 覆盖：直传计账 / 分片计账 / 超限 413+code / 登录用户豁免 / quota 查询 / cookie 与 IP 双维度
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const ROOT = process.cwd()
const SANDBOX = path.join(ROOT, '_guest_quota_sandbox')
const NODE = process.execPath
const PORT = 8131
const BASE = `http://127.0.0.1:${PORT}`

const out = []
let pass = 0, fail = 0
const line = (s) => { out.push(s); console.log(s) }
const check = (n, c, d) => { c ? pass++ : fail++; line(`  ${c ? 'PASS' : 'FAIL'}  ${n}${d !== undefined ? ' — ' + d : ''}`) }
const KB = 1024, MB = 1024 * 1024

line('===== 未登录累计传输配额 =====')

// ---------- 静态契约 ----------
const server = fs.readFileSync(path.join(ROOT, 'server.mjs'), 'utf8')
check('游客配额校验入口 assertGuestQuota 存在', server.includes('function assertGuestQuota'))
check('计账函数 addGuestUsage 存在', server.includes('function addGuestUsage'))
check('配额超限返回业务码 guest_quota_exceeded', server.includes('guest_quota_exceeded'))
check('错误处理透传 code 与 guestQuota', /payload\.code = error\.code[\s\S]{0,80}payload\.guestQuota = error\.guestQuota/.test(server))
check('metadata 归一化保留 guestUsage', server.includes('guestUsage: normalizeGuestUsageStore(value.guestUsage)'))
check('直传 /api/shares 接入校验+计账', /assertGuestQuota\(req, res, uploadedFiles\)[\s\S]{0,900}addGuestUsage\(guestKey, files\)/.test(server))
check('分片 create 接入校验并冻结 guestKey', /const guestKey = assertGuestQuota\(req, res, normalizedFiles\)/.test(server) && /guestKey,/.test(server))
check('分片 complete 补记游客用量', server.includes('addGuestUsage(session.guestKey, mergedFiles)') && server.includes('addGuestUsage(session.guestKey, submissionFiles)'))
check('收集直传提交接入校验+计账', /assertGuestQuota\(req, res, uploadedFiles\)[\s\S]{0,2600}addGuestUsage\(guestKey, files\)/.test(server))
check('游客条目数有上限（防 metadata 膨胀）', /MAX_GUEST_USAGE_ENTRIES = \d+/.test(server))
check('无有效游客 cookie 时回落 IP 键并仍签发 cookie（防换头绕过）', /issueGuestCookie\(req, res\)\s*\n\s*const ip = String\(req\.socket\?\.remoteAddress \|\| ''\)\.trim\(\) \|\| 'unknown'\s*\n\s*return `ip:\$\{ip\}`/.test(server))

// ---------- 沙箱启动 ----------
fs.rmSync(SANDBOX, { recursive: true, force: true })
fs.mkdirSync(path.join(SANDBOX, 'storage'), { recursive: true })
fs.copyFileSync(path.join(ROOT, 'server.mjs'), path.join(SANDBOX, 'server.mjs'))
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(SANDBOX, 'node_modules'), 'junction')
fs.symlinkSync(path.join(ROOT, 'dist'), path.join(SANDBOX, 'dist'), 'junction')

const now = new Date().toISOString()
const UID = 'u_gquota'
const seed = {
  users: { [UID]: { id: UID, username: 'gquota', nickname: '配额用户', email: 'g@q.com', phone: '', avatar: null, avatarSource: '', providerAvatar: null, provider: '', loginMethods: ['oauth'], planId: 'free', planStartedAt: null, planExpiresAt: null, organizationId: '', organizationRole: '', status: 'active', fileCleanup: { enabled: false, days: 7 }, createdAt: now, updatedAt: now } },
  sessions: [{ id: 'sess_gquota', expiresAt: new Date(Date.now() + 86400000).toISOString(), createdAt: now, user: { id: UID } }],
  organizations: {}, shares: [], collections: [], messages: {}, auditLogs: [],
}
fs.writeFileSync(path.join(SANDBOX, 'storage', 'metadata.json'), JSON.stringify(seed, null, 2))

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
    try { if ((await fetch(`${BASE}/api/health`)).ok) { clearInterval(tick); resolve() } } catch {}
  }, 250)
})

const metaPath = path.join(SANDBOX, 'storage', 'metadata.json')
const readGuestUsage = () => JSON.parse(fs.readFileSync(metaPath, 'utf8')).guestUsage || {}
const readConfig = () => JSON.parse(fs.readFileSync(metaPath, 'utf8')).systemConfig || {}

const buf = (mb) => crypto.randomBytes(Math.round(mb * MB))
const sha256Hex = (data) => crypto.createHash('sha256').update(data).digest('hex')
const setCookiesOf = (res) => (typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie') || ''])
const guestCookieOf = (res) => {
  for (const item of setCookiesOf(res)) {
    const m = /kq_guest_id=([^;]+)/.exec(item || '')
    if (m) return m[1]
  }
  return ''
}

try {
  // ---------- 步骤 0：带无关 cookie 请求 quota → 签发游客 cookie（模拟浏览器首次进站） ----------
  const q0 = await fetch(`${BASE}/api/guest/quota`, { headers: { cookie: 'other=1' } })
  const guestCookie = guestCookieOf(q0)
  const q0data = await q0.json()
  check('quota 接口为首次访客签发游客 cookie', q0.status === 200 && /^[A-Za-z0-9]{16,64}$/.test(guestCookie), `setCookie=${guestCookie}`)
  check('初始额度：enabled，上限 1024MB，已用 0', q0data.enabled === true && q0data.limitBytes === 1024 * MB && q0data.usedBytes === 0, JSON.stringify(q0data))
  const GUEST = `kq_guest_id=${guestCookie}`

  // ---------- 场景 1：匿名直传（0.5MB，带游客 cookie） ----------
  const first = await fetch(`${BASE}/api/shares`, { method: 'POST', headers: { cookie: GUEST }, body: (() => { const fd = new FormData(); fd.append('files', new Blob([buf(0.5)]), 'a.bin'); return fd })() })
  check('匿名直传成功', first.status === 201, `status=${first.status}`)
  const usage1 = readGuestUsage()
  const key1 = `cookie:${guestCookie}`
  check('直传后按游客 cookie 计账 0.5MB', Number(usage1[key1]?.bytes) === Math.round(0.5 * MB), JSON.stringify(usage1))
  check('已有有效游客 cookie 时不再重复签发', guestCookieOf(first) === '', `setCookie=${guestCookieOf(first)}`)

  // ---------- 场景 2：quota 查询与计账一致 ----------
  const q1 = await fetch(`${BASE}/api/guest/quota`, { headers: { cookie: GUEST } })
  const q1data = await q1.json()
  check('quota 接口返回已用 0.5MB / 剩余 1023.5MB', q1data.enabled === true && q1data.usedBytes === Math.round(0.5 * MB) && q1data.remainingBytes === 1024 * MB - Math.round(0.5 * MB), JSON.stringify(q1data))

  // ---------- 场景 3：匿名分片上传（2 片 1.5MB），complete 后补记 ----------
  const chunkSize = MB
  const big = buf(1.5)
  const cs = await fetch(`${BASE}/api/upload-sessions`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: GUEST },
    body: JSON.stringify({ files: [{ name: 'big.bin', relativePath: 'big.bin', size: big.length, mimeType: 'application/octet-stream' }], chunkSize }),
  })
  check('匿名分片会话创建成功', cs.status === 201, `status=${cs.status}`)
  const { sessionId } = await cs.json()
  for (let i = 0; i < 2; i += 1) {
    const part = big.subarray(i * chunkSize, Math.min(big.length, (i + 1) * chunkSize))
    const fd = new FormData()
    fd.append('fileIndex', '0'); fd.append('chunkIndex', String(i)); fd.append('totalChunks', '2')
    fd.append('chunkHash', sha256Hex(part))
    fd.append('chunk', new Blob([part]), 'big.bin')
    const cr = await fetch(`${BASE}/api/upload-sessions/${sessionId}/chunks`, { method: 'POST', body: fd, headers: { cookie: GUEST } })
    if (cr.status !== 200) check(`分片 ${i} 上传`, false, `status=${cr.status} ${await cr.text()}`)
  }
  check('分片上传被接受（200）', true)
  const done = await fetch(`${BASE}/api/upload-sessions/${sessionId}/complete`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: GUEST }, body: '{}' })
  check('分片 complete 成功', done.status === 201, `status=${done.status}`)
  const usage2 = readGuestUsage()
  check('complete 后累计 2MB（0.5+1.5）', Number(usage2[key1]?.bytes) === Math.round(2 * MB), JSON.stringify(usage2))
  check('complete 后会话目录已清理', !fs.existsSync(path.join(SANDBOX, 'storage', 'tmp', 'upload-sessions', sessionId)))

  // ---------- 场景 4：管理员把游客累计上限调到 3MB ----------
  const adminLogin = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'ljxkjadmin', password: process.env.KUNQIONG_ADMIN_PASSWORD }) })
  check('管理员登录成功', adminLogin.status === 200, `status=${adminLogin.status}`)
  const adminCookie = setCookiesOf(adminLogin).map((c) => c.split(';')[0]).join('; ')
  const patch = await fetch(`${BASE}/api/admin/config`, { method: 'PATCH', headers: { 'content-type': 'application/json', cookie: adminCookie }, body: JSON.stringify({ anonymousTotalSizeMb: 3 }) })
  check('管理员将游客累计上限调为 3MB', patch.status === 200 && readConfig().anonymousTotalSizeMb === 3, `config=${JSON.stringify(readConfig())}`)

  // ---------- 场景 5：超限 413 + 业务码，且失败不计账 ----------
  const over = await fetch(`${BASE}/api/shares`, { method: 'POST', headers: { cookie: GUEST }, body: (() => { const fd = new FormData(); fd.append('files', new Blob([buf(1.5)]), 'over.bin'); return fd })() })
  const overData = await over.json()
  check('超限上传被拒 413', over.status === 413, `status=${over.status}`)
  check('超限响应携带业务码与配额详情', overData.code === 'guest_quota_exceeded' && overData.guestQuota?.limitBytes === 3 * MB && overData.guestQuota?.usedBytes === Math.round(2 * MB) && overData.guestQuota?.incomingBytes === Math.round(1.5 * MB), JSON.stringify(overData))
  check('超限提示文案包含引导注册', /免费注册/.test(overData.message || ''), overData.message)
  check('失败请求不计账（仍为 2MB）', Number(readGuestUsage()[key1]?.bytes) === Math.round(2 * MB), JSON.stringify(readGuestUsage()))

  // ---------- 场景 6：剩余额度内（0.9MB，累计 2.9 ≤ 3）仍可传 ----------
  const okReq = await fetch(`${BASE}/api/shares`, { method: 'POST', headers: { cookie: GUEST }, body: (() => { const fd = new FormData(); fd.append('files', new Blob([buf(0.9)]), 'ok.bin'); return fd })() })
  check('剩余额度内直传成功', okReq.status === 201, `status=${okReq.status} ${await okReq.text()}`)
  check('成功后累计 2.9MB', Number(readGuestUsage()[key1]?.bytes) === Math.round(2.9 * MB), JSON.stringify(readGuestUsage()))

  // ---------- 场景 7：登录用户不受游客上限限制，也不计入游客条目 ----------
  const beforeKeys = Object.keys(readGuestUsage()).length
  const loginShare = await fetch(`${BASE}/api/shares`, { method: 'POST', headers: { cookie: 'kunqiong_session=sess_gquota' }, body: (() => { const fd = new FormData(); fd.append('files', new Blob([buf(1.5)]), 'login.bin'); return fd })() })
  check('登录用户 1.5MB 直传不受 3MB 游客上限限制', loginShare.status === 201, `status=${loginShare.status}`)
  check('登录上传不计入游客条目（条目数不变）', Object.keys(readGuestUsage()).length === beforeKeys, JSON.stringify(Object.keys(readGuestUsage())))

  // ---------- 场景 8：完全无 cookie 头的请求按 IP 计账，但同样签发 cookie ----------
  const ipA = await fetch(`${BASE}/api/shares`, { method: 'POST', body: (() => { const fd = new FormData(); fd.append('files', new Blob([buf(0.5)]), 'ip1.bin'); return fd })() })
  check('无 cookie 头直传成功且签发游客 cookie', ipA.status === 201 && /^[A-Za-z0-9]{16,64}$/.test(guestCookieOf(ipA)), `status=${ipA.status} setCookie=${guestCookieOf(ipA)}`)
  const ipB = await fetch(`${BASE}/api/shares`, { method: 'POST', body: (() => { const fd = new FormData(); fd.append('files', new Blob([buf(0.5)]), 'ip2.bin'); return fd })() })
  check('无 cookie 头第二次直传成功', ipB.status === 201, `status=${ipB.status}`)
  const q2 = await fetch(`${BASE}/api/guest/quota`)
  const q2data = await q2.json()
  check('IP 维度独立计账 1MB（与 cookie 维度隔离）', q2data.enabled === true && q2data.usedBytes === Math.round(1 * MB), JSON.stringify(q2data))

  // ---------- 场景 9：带无关 cookie 头（模拟换 key 攻击）必须归入同一 IP 键，配额仍然生效 ----------
  const atkPost = (tracker, mb, name) => fetch(`${BASE}/api/shares`, { method: 'POST', headers: { cookie: `tracker=${tracker}` }, body: (() => { const fd = new FormData(); fd.append('files', new Blob([buf(mb)]), name); return fd })() })
  const atk1 = await atkPost('aaa', 0.5, 'atk1.bin')
  check('换 cookie 头攻击第一次直传成功（按 IP 计账）', atk1.status === 201, `status=${atk1.status}`)
  const atk2 = await atkPost('bbb', 0.5, 'atk2.bin')
  check('换 cookie 头攻击第二次直传成功', atk2.status === 201, `status=${atk2.status}`)
  const usage9 = readGuestUsage()
  const ipKey = Object.keys(usage9).find((k) => k.startsWith('ip:'))
  check('两次攻击请求归入同一 IP 键（累计 2MB）', Boolean(ipKey) && Number(usage9[ipKey]?.bytes) === Math.round(2 * MB), JSON.stringify(usage9))
  check('攻击请求未产生新的 cookie 计账键', Object.keys(usage9).filter((k) => k.startsWith('cookie:')).length === 1, JSON.stringify(Object.keys(usage9)))
  const atk3 = await atkPost('ccc', 1.5, 'atk3.bin')
  const atk3Data = await atk3.json()
  check('换 key 攻击超限同样被拒 413', atk3.status === 413 && atk3Data.code === 'guest_quota_exceeded', `status=${atk3.status}`)
  check('413 详情按 IP 键口径（已用 2MB / 上限 3MB）', atk3Data.guestQuota?.usedBytes === Math.round(2 * MB) && atk3Data.guestQuota?.limitBytes === 3 * MB, JSON.stringify(atk3Data))
} finally {
  child.kill('SIGKILL')
  fs.rmSync(path.join(SANDBOX, 'node_modules'), { recursive: true, force: true })
  fs.rmSync(path.join(SANDBOX, 'dist'), { recursive: true, force: true })
}

line('')
line(`结果：${pass}/${pass + fail}`)
fs.writeFileSync(path.join(ROOT, '_guest_quota.txt'), out.join('\n'))
process.exit(fail ? 1 : 0)
