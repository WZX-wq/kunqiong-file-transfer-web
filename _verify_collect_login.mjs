// 收集任务「登录后提交 + 记录提交者账号」验证
// 覆盖：静态契约 + 沙箱真实 HTTP 全链路（登录提交/匿名提交/名称不可伪造/管理端可见/通知文案）
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const ROOT = process.cwd()
const NODE = process.execPath
const SANDBOX = path.join(ROOT, '_collect_login_sandbox')
const PORT = 8131
const TRACE = path.join(ROOT, '_collect_login.txt')

const trace = (s) => { fs.appendFileSync(TRACE, `${new Date().toISOString().slice(11, 19)} ${s}\n`); console.log(s) }
const results = []
const check = (name, pass, detail = '') => { results.push({ name, pass }); trace(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`) }
let serverErr = ''

fs.writeFileSync(TRACE, '')

// ---------- 静态契约 ----------
const serverSrc = fs.readFileSync(path.join(ROOT, 'server.mjs'), 'utf8')
const mainSrc = fs.readFileSync(path.join(ROOT, 'src', 'main.jsx'), 'utf8')
const cssSrc = fs.readFileSync(path.join(ROOT, 'src', 'styles.css'), 'utf8')

check('契约: 服务端有提交者解析函数', serverSrc.includes('function resolveCollectionSubmitter(req)'))
check('契约: 登录用户以会话为准覆盖 participantName', serverSrc.includes('participantName: name,') && serverSrc.includes('submitterUserId: String(user.id'))
check('契约: 匿名兜底仍读请求体名称', serverSrc.includes("submitterUserId: '', submitterName: '', participantName: String(req.body?.participantName || '').trim()"))
check('契约: submission 落库带 submitterUserId/submitterName', (serverSrc.match(/submitterUserId: (session\.|submitter\.)submitterUserId/g) || []).length >= 2)
check('契约: publicSubmission 下发 submitter 块', serverSrc.includes('submitter: publicSubmissionSubmitter(submission)') && serverSrc.includes('function publicSubmissionSubmitter('))
check('契约: 分片上传会话记住提交者', serverSrc.includes('submitterUserId: collectionSubmitter?.submitterUserId || \'\''))
check('契约: 通知文案区分账号/匿名提交', serverSrc.includes('（已登录账号提交）') && serverSrc.includes('（匿名提交）'))
check('契约: 记录归一化保留提交者字段', /normalizeRecordSubmissions[\s\S]{0,500}submitterUserId: trimRecordString/.test(serverSrc))
check('契约: 前端提交页取 auth/me 判定登录', mainSrc.includes("apiRequest('/api/auth/me').then(({ user: current })") && mainSrc.includes('const signedIn = Boolean(user?.id)'))
check('契约: 登录态展示身份卡而非手填', mainSrc.includes('collection-identity') && mainSrc.includes('登录后提交'))
check('契约: 登录提交时不再强制手填名称', mainSrc.includes("setMessage(signedIn ? '请选择要提交的文件' : '请填写提交人名称并选择文件')"))
check('契约: 管理端渲染账号/匿名徽标', mainSrc.includes('submission-account-badge') && mainSrc.includes('submission-anon-badge'))
check('契约: CSS 身份卡与徽标样式存在', cssSrc.includes('.collection-identity') && cssSrc.includes('.submission-account-badge'))

// ---------- 沙箱 ----------
fs.rmSync(SANDBOX, { recursive: true, force: true })
fs.mkdirSync(path.join(SANDBOX, 'storage'), { recursive: true })
fs.copyFileSync(path.join(ROOT, 'server.mjs'), path.join(SANDBOX, 'server.mjs'))
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(SANDBOX, 'node_modules'), 'junction')
trace('沙箱就绪')

const now = new Date().toISOString()
const OWNER = 'u_owner_c', COLLECTOR = 'u_bob_c'
const C_TOKEN = 'ctok_login_1', C_MANAGE = 'cman_login_1'
const mkUser = (id, nick) => ({
  id, username: id, nickname: nick, email: `${id}@kunqiong.com`, phone: '', avatar: null, avatarSource: '', providerAvatar: null, provider: '',
  loginMethods: ['oauth'], planId: 'free', planStartedAt: null, planExpiresAt: null,
  organizationId: '', organizationRole: '', status: 'active',
  fileCleanup: { enabled: false, days: 7 }, createdAt: now, updatedAt: now,
})
fs.writeFileSync(path.join(SANDBOX, 'storage', 'metadata.json'), JSON.stringify({
  users: { [OWNER]: mkUser(OWNER, '林设计'), [COLLECTOR]: mkUser(COLLECTOR, '王小张') },
  sessions: [
    { id: 'sess_c_owner', expiresAt: new Date(Date.now() + 86400000).toISOString(), createdAt: now, apiWebToken: '', user: mkUser(OWNER, '林设计') },
    { id: 'sess_c_bob', expiresAt: new Date(Date.now() + 86400000).toISOString(), createdAt: now, apiWebToken: '', user: mkUser(COLLECTOR, '王小张') },
  ],
  organizations: {},
  messages: {},
  shares: [],
  collections: [{
    id: 'col_login_1', token: C_TOKEN, manageToken: C_MANAGE, ownerUserId: OWNER,
    title: '第 12 周设计稿收集', description: '', allowedTypes: 'all', maxFileSizeMb: 500,
    deadline: new Date(Date.now() + 7 * 86400000).toISOString(), status: 'active',
    submissions: [], qrDataUrl: '', notificationFlags: {},
  }],
  auditLogs: [], uploadSessions: {}, membershipOrders: [], joinRequests: [], upgradeOrders: [],
  systemConfig: { siteName: '鲲穹', registrationOpen: true },
}, null, 2))

let server = null
const startServer = () => {
  server = spawn(NODE, ['server.mjs'], {
    cwd: SANDBOX,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', KUNQIONG_DB_ENABLED: 'false', NODE_ENV: 'production', KUNQIONG_ADMIN_USERNAME: 'admin', KUNQIONG_ADMIN_PASSWORD: 'admin-collect-123' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stderr.on('data', (b) => { serverErr += b.toString() })
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const tick = setInterval(async () => {
      if (Date.now() - t0 > 25000) { clearInterval(tick); reject(new Error('服务启动超时\n' + serverErr)) }
      try { if ((await fetch(`${BASE}/api/health`)).ok) { clearInterval(tick); resolve() } } catch {}
    }, 250)
  })
}
// 改库后内存态不会自动重载（服务启动即加载 metadata.json），需要重启服务再断言
const restartServer = async () => {
  server.kill()
  await new Promise((r) => setTimeout(r, 700))
  await startServer()
}

const BASE = `http://127.0.0.1:${PORT}`
const readDisk = () => JSON.parse(fs.readFileSync(path.join(SANDBOX, 'storage', 'metadata.json'), 'utf8'))
let exitCode = 0

try {
  await startServer()
  trace('服务已启动')

  // 表单式提交：构造 multipart
  const form = (fields, fileName = 'design.pdf') => {
    const fd = new FormData()
    for (const [k, v] of Object.entries(fields)) fd.append(k, v)
    fd.append('files', new Blob([Buffer.from('hello design')], { type: 'application/pdf' }), fileName)
    return fd
  }

  // 1. 登录用户提交：即使客户端伪造 participantName，也应以账号为准
  let r = await fetch(`${BASE}/api/collections/${C_TOKEN}/submissions`, {
    method: 'POST',
    headers: { Cookie: 'kunqiong_session=sess_c_bob' },
    body: form({ participantName: '我是伪造的名字' }),
  })
  let j = await r.json()
  check('登录提交成功 201', r.status === 201, `status=${r.status} msg=${j.message || ''}`)
  check('登录提交 participantName = 账号昵称（不可伪造）', j.submission?.participantName === '王小张', `got=${j.submission?.participantName}`)
  check('响应下发 submitter.id', j.submission?.submitter?.id === COLLECTOR, `got=${j.submission?.submitter?.id}`)
  check('响应下发 submitter.displayName', j.submission?.submitter?.displayName === '王小张', `got=${j.submission?.submitter?.displayName}`)

  let disk = readDisk()
  let sub = disk.collections[0].submissions[0]
  check('磁盘: 提交记录带 submitterUserId', sub?.submitterUserId === COLLECTOR, `got=${sub?.submitterUserId}`)
  check('磁盘: 提交记录带 submitterName 快照', sub?.submitterName === '王小张', `got=${sub?.submitterName}`)
  const ownerMsgs = disk.messages[OWNER] || []
  check('磁盘: 通知文案标注「已登录账号提交」', ownerMsgs.some((m) => /已登录账号提交/.test(m.body || '')), ownerMsgs.map((m) => m.body).join(' | '))

  // 2. 匿名提交：无 session，带名称 → 仍可提交
  r = await fetch(`${BASE}/api/collections/${C_TOKEN}/submissions`, {
    method: 'POST',
    body: form({ participantName: '路人甲' }, 'anon.png'),
  })
  j = await r.json()
  check('匿名提交成功 201', r.status === 201, `status=${r.status} msg=${j.message || ''}`)
  check('匿名提交 participantName = 手填名称', j.submission?.participantName === '路人甲', `got=${j.submission?.participantName}`)
  check('匿名提交 submitter 为 null', j.submission?.submitter === null, `got=${JSON.stringify(j.submission?.submitter)}`)
  check('匿名提交 submitterUserId 为空', j.submission?.submitterUserId === undefined || !j.submission?.submitterUserId)

  // 3. 匿名且不填名称 → 400
  r = await fetch(`${BASE}/api/collections/${C_TOKEN}/submissions`, { method: 'POST', body: form({ participantName: '   ' }, 'x.png') })
  check('匿名空名称被拒 400', r.status === 400, `status=${r.status}`)

  // 4. 管理端可见两份提交且能区分
  r = await fetch(`${BASE}/api/collections/manage/${C_MANAGE}`, { headers: { Cookie: 'kunqiong_session=sess_c_owner' } })
  j = await r.json()
  const list = j.collection?.submissions || []
  check('管理端返回 2 份提交', list.length === 2, `got=${list.length}`)
  const accountSub = list.find((s) => s.submitter)
  const anonSub = list.find((s) => !s.submitter)
  check('管理端可区分账号提交与匿名提交', Boolean(accountSub) && Boolean(anonSub))
  check('管理端账号提交显示账号名', accountSub?.submitter?.displayName === '王小张', `got=${accountSub?.submitter?.displayName}`)
  check('管理端匿名提交保留手填名称', anonSub?.participantName === '路人甲', `got=${anonSub?.participantName}`)

  disk = readDisk()
  check('磁盘: 共 2 份提交（伪造名未生效）', disk.collections[0].submissions.length === 2)
  check('磁盘: 不存在「我是伪造的名字」', !disk.collections[0].submissions.some((s) => s.participantName === '我是伪造的名字'))

  // 5. 账号昵称改动后的行为
  // ⚠️ 前置认知（与本改动无关的既有行为）：服务启动时 normalizeAccountUserStore 会用
  //    metadata.sessions[].user 快照合并进用户表，快照里的 nickname 会覆盖 users 表的值。
  //    所以"直接改库改昵称"重启后不生效是既有设计，不是本改动的缺陷。
  //    这里改走真实接口 PATCH /api/auth/profile（会同步会话快照），验证 displayName 跟随账号。
  r = await fetch(`${BASE}/api/auth/profile`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: 'kunqiong_session=sess_c_bob' },
    body: JSON.stringify({ nickname: '王小张（改）' }),
  })
  check('改昵称接口 200', r.ok, `status=${r.status}`)
  await restartServer()
  r = await fetch(`${BASE}/api/collections/manage/${C_MANAGE}`, { headers: { Cookie: 'kunqiong_session=sess_c_owner' } })
  j = await r.json()
  const list2 = j.collection?.submissions || []
  check('改昵称后管理端展示最新账号昵称', list2.find((s) => s.submitter)?.submitter?.displayName === '王小张（改）', `got=${list2.find((s) => s.submitter)?.submitter?.displayName}`)
  check('同时保留提交当时的名称快照（历史不会被改写）', readDisk().collections[0].submissions.find((s) => s.submitterUserId)?.submitterName === '王小张', `got=${readDisk().collections[0].submissions.find((s) => s.submitterUserId)?.submitterName}`)

  // 6. 分片上传路径也带提交者
  const small = Buffer.alloc(1024, 7)
  r = await fetch(`${BASE}/api/upload-sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: 'kunqiong_session=sess_c_bob' },
    body: JSON.stringify({ mode: 'collection', collectionToken: C_TOKEN, participantName: '又被伪造了', files: [{ name: 'big.bin', relativePath: 'big.bin', size: small.length, mimeType: 'application/octet-stream' }] }),
  })
  j = await r.json()
  check('分片会话创建成功 201', r.status === 201, `status=${r.status} msg=${j.message || ''}`)
  const sessionId = j.sessionId
  const fd = new FormData()
  fd.append('fileIndex', '0')
  fd.append('chunkIndex', '0')
  fd.append('totalChunks', '1')
  fd.append('chunk', new Blob([small]), 'chunk')
  r = await fetch(`${BASE}/api/upload-sessions/${sessionId}/chunks`, { method: 'POST', headers: { Cookie: 'kunqiong_session=sess_c_bob' }, body: fd })
  check('分片上传成功 200', r.ok, `status=${r.status}`)
  r = await fetch(`${BASE}/api/upload-sessions/${sessionId}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: 'kunqiong_session=sess_c_bob' },
    body: JSON.stringify({ mode: 'collection' }),
  })
  j = await r.json()
  check('分片完成合并成功 201', r.status === 201, `status=${r.status} msg=${j.message || ''}`)
  // 此刻账号昵称已被上一步改成「王小张（改）」，故分片路径应记为新昵称
  check('分片路径 participantName = 最新账号昵称（同样不可伪造）', j.submission?.participantName === '王小张（改）', `got=${j.submission?.participantName}`)
  check('分片路径 submitter.id 正确', j.submission?.submitter?.id === COLLECTOR, `got=${j.submission?.submitter?.id}`)

  disk = readDisk()
  check('磁盘: 分片提交也带提交者账号', disk.collections[0].submissions.some((s) => s.submitterUserId === COLLECTOR && s.files.some((f) => f.name === 'big.bin')))

  // 7. 历史数据（无 submitter 字段）不崩、回落匿名
  disk = readDisk()
  disk.collections[0].submissions.push({ id: 'legacy1', participantName: '老数据', submittedAt: now, files: [{ name: 'old.pdf', relativePath: 'old.pdf', storedName: '01-x-old.pdf', size: 10, mimeType: 'application/pdf', reviewStatus: 'approved' }] })
  fs.writeFileSync(path.join(SANDBOX, 'storage', 'metadata.json'), JSON.stringify(disk, null, 2))
  await restartServer()
  r = await fetch(`${BASE}/api/collections/manage/${C_MANAGE}`, { headers: { Cookie: 'kunqiong_session=sess_c_owner' } })
  j = await r.json()
  const list3 = j.collection?.submissions || []
  const legacy = list3.find((s) => s.id === 'legacy1')
  check('历史提交接口不报错且回落匿名', r.ok && Boolean(legacy) && legacy.submitter === null, `status=${r.status} got=${JSON.stringify(legacy?.submitter)}`)

  // 8. 管理链接是 bearer 凭证（设计如此：谁拿到 manageToken 谁可管理，不校验登录身份）
  r = await fetch(`${BASE}/api/collections/manage/${C_MANAGE}`, { headers: { Cookie: 'kunqiong_session=sess_c_bob' } })
  check('管理链接本身即可访问（token 即凭证，不依赖登录态）', r.status === 200, `status=${r.status}`)
  // 但错误 token 必须 404 —— 这是真正的访问边界
  r = await fetch(`${BASE}/api/collections/manage/token_not_exist_xyz`)
  check('无效管理 token 404', r.status === 404, `status=${r.status}`)
} catch (error) {
  trace(`脚本异常: ${error.message}`)
  exitCode = 1
} finally {
  server.kill()
}

const passed = results.filter((r) => r.pass).length
trace(`\n===== ${passed}/${results.length} 通过 =====`)
for (const r of results.filter((x) => !x.pass)) trace(`FAILED: ${r.name}`)
process.exit(exitCode || (passed === results.length ? 0 : 1))
