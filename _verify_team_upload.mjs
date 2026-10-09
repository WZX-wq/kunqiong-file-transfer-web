// 回归：团队空间上传权限 —— 「团队资源」的永久保存由团队决定，不受上传者个人套餐限制
//
// 历史 Bug（2026-09-18 用户反馈）：
//   基础版（free）用户加入企业版团队后，团队资源页上传文件失败，
//   前端弹窗「永久保存需要会员版或更高权益」，进度条停在 0%。
//
// 根因：
//   前端上传团队文件时固定传 expiryDays:'0'（永久），服务端
//   readShareOptions() 用 accountEffectivePlanForUser(user).permanent 校验，
//   而成员的个人套餐是 free（permanent=false）→ 403。
//   但团队资源是否永久，应由**团队空间**（所有者套餐）决定，与上传者个人套餐无关。
//
// 修复：readShareOptions(body, user, isTeamResource) 增加第三个参数，
//   团队资源跳过个人 permanent 校验。
//
// 必须守住的不变量：
//   ① 基础版成员能上传到企业版团队空间（201）
//   ② 成员的个人套餐不被团队撑大（仍是 free / 20GB / permanent=false）
//   ③ 成员上传「个人」永久分享仍被拒（403）—— 个人权益校验没被放松
//   ④ 非成员不能上传团队资源
//   ⑤ 团队资源不计入成员个人空间用量
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const SANDBOX = path.join(ROOT, '_team_upload_sandbox')
const NODE = process.execPath
const PORT = 4893
const BASE = `http://127.0.0.1:${PORT}`

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  :: ${detail}` : ''}`)
}

// ---------- 静态契约 ----------
const serverSrc = fs.readFileSync(path.join(ROOT, 'server.mjs'), 'utf8')
check('契约: readShareOptions 接受 isTeamResource 参数',
  /function readShareOptions\(body = \{\}, user = null, isTeamResource = false\)/.test(serverSrc))
check('契约: 团队资源跳过个人 permanent 校验',
  /requestedExpiryDays === '0' && !isTeamResource && !accountEffectivePlanForUser/.test(serverSrc))
check('契约: 上传会话创建时按 mode 传入团队标记',
  /const isTeamResourceSession = req\.body\.mode === 'team_resource'/.test(serverSrc)
  && /readShareOptions\(req\.body, ownerSession\?\.user, isTeamResourceSession\)/.test(serverSrc))

// ---------- 沙箱 ----------
fs.rmSync(SANDBOX, { recursive: true, force: true })
fs.mkdirSync(path.join(SANDBOX, 'storage'), { recursive: true })
fs.copyFileSync(path.join(ROOT, 'server.mjs'), path.join(SANDBOX, 'server.mjs'))
try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(SANDBOX, 'node_modules'), 'junction') } catch {}

const now = new Date().toISOString()
const OWNER = 'u_owner_ent', MEMBER = 'u_member_basic', MEMBER2 = 'u_member_pro', OUTSIDER = 'u_outsider'
const mkUser = (id, nick, planId) => ({
  id, username: id, nickname: nick, email: `${id}@kunqiong.com`, phone: '', avatar: null,
  avatarSource: '', providerAvatar: null, provider: '', loginMethods: ['oauth'],
  planId, planStartedAt: null, planExpiresAt: null,
  organizationId: '', organizationRole: '', status: 'active',
  fileCleanup: { enabled: false, days: 7 }, createdAt: now, updatedAt: now,
})

fs.writeFileSync(path.join(SANDBOX, 'storage', 'metadata.json'), JSON.stringify({
  users: {
    [OWNER]: mkUser(OWNER, '企业所有者', 'enterprise'),
    [MEMBER]: mkUser(MEMBER, '基础版成员', 'free'),
    [MEMBER2]: mkUser(MEMBER2, '会员版成员', 'member'),
    [OUTSIDER]: mkUser(OUTSIDER, '外部用户', 'free'),
  },
  sessions: [
    { id: 'sess_owner', expiresAt: new Date(Date.now() + 86400000).toISOString(), createdAt: now, apiWebToken: '', user: mkUser(OWNER, '企业所有者', 'enterprise') },
    { id: 'sess_member', expiresAt: new Date(Date.now() + 86400000).toISOString(), createdAt: now, apiWebToken: '', user: mkUser(MEMBER, '基础版成员', 'free') },
    { id: 'sess_member2', expiresAt: new Date(Date.now() + 86400000).toISOString(), createdAt: now, apiWebToken: '', user: mkUser(MEMBER2, '会员版成员', 'member') },
    { id: 'sess_outsider', expiresAt: new Date(Date.now() + 86400000).toISOString(), createdAt: now, apiWebToken: '', user: mkUser(OUTSIDER, '外部用户', 'free') },
  ],
  organizations: {
    org_ent: {
      id: 'org_ent', name: '测试企业团队', slug: 'ent-team', ownerUserId: OWNER,
      createdAt: now, updatedAt: now,
      members: [
        { userId: OWNER, role: 'owner', status: 'active', displayName: '企业所有者', joinedAt: now },
        { userId: MEMBER, role: 'member', status: 'active', displayName: '基础版成员', joinedAt: now },
        { userId: MEMBER2, role: 'member', status: 'active', displayName: '会员版成员', joinedAt: now },
      ],
    },
  },
  messages: {}, shares: [], collections: [],
  auditLogs: [], uploadSessions: {}, membershipOrders: [], joinRequests: [], upgradeOrders: [],
  systemConfig: { siteName: '鲲穹', registrationOpen: true },
}, null, 2))

let serverErr = ''
const startServer = () => {
  const s = spawn(NODE, ['server.mjs'], {
    cwd: SANDBOX,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', KUNQIONG_DB_ENABLED: 'false', NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  s.stderr.on('data', (b) => { serverErr += b.toString() })
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const tick = setInterval(async () => {
      if (Date.now() - t0 > 25000) { clearInterval(tick); reject(new Error('服务启动超时\n' + serverErr)) }
      try { if ((await fetch(`${BASE}/api/health`)).ok) { clearInterval(tick); resolve(s) } } catch {}
    }, 250)
  })
}

const teamSessionBody = (name, size = 2048) => ({
  files: [{ name, relativePath: name, size, mimeType: 'application/pdf' }],
  expiryDays: '0', downloadLimit: 'unlimited', password: '', codeLength: '6', recipients: '',
  mode: 'team_resource',
})

// 完整闭环：建会话 → 分片 → complete
async function fullTeamUpload(cookie, name, content = 'hello team!') {
  let r = await fetch(`${BASE}/api/upload-sessions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(teamSessionBody(name, Buffer.byteLength(content))),
  })
  let j = await r.json().catch(() => ({}))
  if (r.status !== 201) return { create: r.status, message: j.message || '', complete: 0 }
  const sid = j.sessionId
  const fd = new FormData()
  fd.append('fileIndex', '0'); fd.append('chunkIndex', '0'); fd.append('totalChunks', '1')
  fd.append('chunk', new Blob([Buffer.from(content)], { type: 'application/octet-stream' }), 'chunk')
  r = await fetch(`${BASE}/api/upload-sessions/${sid}/chunks`, { method: 'POST', headers: { Cookie: cookie }, body: fd })
  const chunkStatus = r.status
  r = await fetch(`${BASE}/api/upload-sessions/${sid}/complete`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ chunkSize: Buffer.byteLength(content) }),
  })
  j = await r.json().catch(() => ({}))
  return { create: 201, chunk: chunkStatus, complete: r.status, message: j.message || '' }
}

let server = null
try {
  server = await startServer()
  console.log(`\n${'='.repeat(60)}\n沙箱服务已启动\n${'='.repeat(60)}`)

  // ===== ① 基础版成员：核心修复点 =====
  let r = await fetch(`${BASE}/api/account/workspace`, { headers: { Cookie: 'kunqiong_session=sess_member' } })
  let j = await r.json()
  check('① 基础版成员个人套餐仍是 free（未被团队撑大）', j.plan?.id === 'free' && j.plan?.permanent === false,
    `plan=${j.plan?.id} permanent=${j.plan?.permanent}`)
  check('① 基础版成员已加入企业版团队', Boolean(j.teamEntitlement?.organizationId))
  check('① 团队空间容量来自所有者（1TB）',
    Number(j.teamEntitlement?.teamSpaceBytes) === 1024 ** 4, `=${j.teamEntitlement?.teamSpaceBytes}`)
  check('① 基础版成员个人容量仍是 20GB（非 2048GB）',
    Number(j.capacity?.totalBytes) === 20 * 1024 ** 3, `=${j.capacity?.totalBytes}`)

  let out = await fullTeamUpload('kunqiong_session=sess_member', 'basic-member.pdf')
  check('★① 基础版成员上传团队资源：建会话放行', out.create === 201, `status=${out.create} ${out.message}`)
  check('★① 基础版成员上传团队资源：完整闭环 201', out.complete === 201, `complete=${out.complete} ${out.message}`)

  // ===== ② 会员版成员：也应放行（member.permanent=true，但不能被个人套餐绑死） =====
  out = await fullTeamUpload('kunqiong_session=sess_member2', 'member-plan.pdf')
  check('② 会员版成员上传团队资源放行', out.complete === 201, `complete=${out.complete} ${out.message}`)

  // ===== ③ 所有者也应放行 =====
  out = await fullTeamUpload('kunqiong_session=sess_owner', 'owner.pdf')
  check('③ 所有者上传团队资源放行', out.complete === 201, `complete=${out.complete} ${out.message}`)

  // ===== ④ 落库正确性 =====
  let disk = JSON.parse(fs.readFileSync(path.join(SANDBOX, 'storage', 'metadata.json'), 'utf8'))
  const basicShare = disk.shares.find((s) => s.files?.some((f) => f.name === 'basic-member.pdf'))
  check('④ 团队资源标记 teamResource=true 且归属组织正确',
    basicShare?.teamResource === true && basicShare?.teamOrganizationId === 'org_ent',
    `teamResource=${basicShare?.teamResource} org=${basicShare?.teamOrganizationId}`)
  check('④ 团队资源永久保存（expiresAt 为空）', !basicShare?.expiresAt, `expiresAt=${basicShare?.expiresAt}`)
  check('④ 团队资源记录上传者身份',
    basicShare?.ownerUserId === MEMBER, `ownerUserId=${basicShare?.ownerUserId}`)

  // ===== ⑤ 非成员不能上传团队资源 =====
  r = await fetch(`${BASE}/api/upload-sessions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: 'kunqiong_session=sess_outsider' },
    body: JSON.stringify(teamSessionBody('outsider.pdf')),
  })
  check('⑤ 非成员上传团队资源被拒', r.status === 404 || r.status === 403, `status=${r.status}`)

  // ===== ⑥ 个人权益未被放松：基础版成员个人永久分享仍被拒 =====
  r = await fetch(`${BASE}/api/upload-sessions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: 'kunqiong_session=sess_member' },
    body: JSON.stringify({
      files: [{ name: 'personal-permanent.pdf', relativePath: 'personal-permanent.pdf', size: 2048, mimeType: 'application/pdf' }],
      expiryDays: '0', downloadLimit: 'unlimited', password: '', codeLength: '6', recipients: '',
    }),
  })
  j = await r.json().catch(() => ({}))
  check('★⑥ 基础版成员「个人」永久分享仍被拒 403（个人校验未被放松）',
    r.status === 403, `status=${r.status} message=${j.message || ''}`)

  // ===== ⑦ 团队资源不计入成员个人空间用量 =====
  r = await fetch(`${BASE}/api/account/workspace`, { headers: { Cookie: 'kunqiong_session=sess_member' } })
  j = await r.json()
  check('⑦ 团队资源不计入成员个人空间用量',
    Number(j.capacity?.usedBytes || 0) === 0, `usedBytes=${j.capacity?.usedBytes}`)

  // ===== ⑧ 团队用量正确统计（团队成员视图） =====
  r = await fetch(`${BASE}/api/account/team/overview`, { headers: { Cookie: 'kunqiong_session=sess_member' } })
  j = await r.json()
  const memberRow = (j.memberUsage || []).find((m) => m.userId === MEMBER)
  check('⑧ 团队视图中基础版成员的团队资源被计入',
    Number(memberRow?.fileCount || 0) >= 1, `fileCount=${memberRow?.fileCount} shareCount=${memberRow?.shareCount}`)
  check('⑧ 团队容量为所有者套餐的 1TB',
    Number(j.capacity?.totalBytes) === 1024 ** 4, `=${j.capacity?.totalBytes}`)
  check('⑧ 团队视图中基础版成员个人套餐未被误升',
    (j.memberUsage || []).length === 3, `members=${(j.memberUsage || []).length}`)

  // ===== ⑨ 团队成员可看到自己上传的团队资源 =====
  check('⑨ 团队资源出现在资源列表',
    (j.resources || []).some((item) => item.files?.some((f) => f.name === 'basic-member.pdf')),
    `resources=${(j.resources || []).length}`)

  // ===== ⑩ 同名文件仍被拒（团队空间唯一性） =====
  r = await fetch(`${BASE}/api/upload-sessions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: 'kunqiong_session=sess_member' },
    body: JSON.stringify(teamSessionBody('basic-member.pdf')),
  })
  check('⑩ 团队空间同名文件被拒', r.status === 409, `status=${r.status}`)

  // ===== ⑪ 默认（非永久）个人分享不受影响 =====
  r = await fetch(`${BASE}/api/upload-sessions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: 'kunqiong_session=sess_member' },
    body: JSON.stringify({
      files: [{ name: 'personal-temp.pdf', relativePath: 'personal-temp.pdf', size: 2048, mimeType: 'application/pdf' }],
      expiryDays: '3', downloadLimit: 'unlimited', password: '', codeLength: '6', recipients: '',
    }),
  })
  check('⑪ 基础版成员个人普通分享正常放行', r.status === 201, `status=${r.status}`)
} catch (e) {
  check('执行未抛异常', false, e.message)
} finally {
  if (server) server.kill()
  await new Promise((r) => setTimeout(r, 500))
  const fail = results.filter((x) => !x.ok)
  console.log(`\n结果：${results.length - fail.length}/${results.length} 通过`)
  if (fail.length) { console.log('失败项：'); fail.forEach((f) => console.log(' -', f.name, f.detail)) }
  process.exit(fail.length ? 1 : 0)
}
