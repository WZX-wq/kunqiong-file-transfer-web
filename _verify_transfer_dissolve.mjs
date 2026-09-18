// 转让所有权 + 解散团队：静态契约 + 沙箱真实 HTTP 全链路验证
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const NODE = process.execPath
const SANDBOX = path.join(ROOT, '_transfer_sandbox')
const PORT = 8126
const TRACE = path.join(ROOT, '_transfer_trace.txt')

const trace = (s) => { fs.appendFileSync(TRACE, `${new Date().toISOString().slice(11, 19)} ${s}\n`); console.log(s) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, pass, detail = '') => { results.push({ name, pass }); trace(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`) }

// ---------- 静态契约 ----------
const serverSrc = fs.readFileSync(path.join(ROOT, 'server.mjs'), 'utf8')
const mainSrc = fs.readFileSync(path.join(ROOT, 'src', 'main.jsx'), 'utf8')
const cssSrc = fs.readFileSync(path.join(ROOT, 'src', 'styles.css'), 'utf8')

check('契约: 后端转让路由存在', serverSrc.includes("app.post('/api/account/workspace/transfer-ownership'"))
check('契约: 后端解散路由存在', serverSrc.includes("app.post('/api/account/workspace/dissolve'"))
check('契约: 转让校验目标必须是 active 成员', serverSrc.includes("只能转让给已加入团队的正式成员"))
check('契约: 解散清理所有成员归属(含 invited)', /for \(const member of organization\.members\)[\s\S]{0,400}account\.organizationId === organization\.id/.test(serverSrc))
check('契约: 前端转让函数与 Crown 按钮', mainSrc.includes('const transferOwnership') && mainSrc.includes('transferOwnership(member)') && mainSrc.includes('<Crown size={15} />'))
check('契约: 前端解散函数与危险区', mainSrc.includes('const dissolveTeam') && mainSrc.includes('team-danger-zone') && mainSrc.includes('team-dissolve-button'))
check('契约: 双重确认弹窗(解散两次 requestConfirm)', (mainSrc.match(/确认解散/g) || []).length >= 1 && /解散团队 · 最终确认/.test(mainSrc))
check('契约: CSS 危险区与按钮样式', cssSrc.includes('.team-danger-zone') && cssSrc.includes('.team-dissolve-button') && cssSrc.includes('.team-management-actions'))
check('契约: 转让/解散均写审计', serverSrc.includes("action: '转让团队所有权'") && serverSrc.includes("action: '解散团队'"))

// ---------- 沙箱 ----------
fs.rmSync(SANDBOX, { recursive: true, force: true })
fs.mkdirSync(path.join(SANDBOX, 'storage'), { recursive: true })
fs.copyFileSync(path.join(ROOT, 'server.mjs'), path.join(SANDBOX, 'server.mjs'))
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(SANDBOX, 'node_modules'), 'junction')
fs.symlinkSync(path.join(ROOT, 'dist'), path.join(SANDBOX, 'dist'), 'junction')
trace('沙箱就绪')

const now = new Date().toISOString()
const OWNER = 'u_owner_t', MEMBER_B = 'u_bob_t', MEMBER_C = 'u_caty_t', OUTSIDER = 'u_out_t'
const ORG = 'org_transfer'
const mkUser = (id, nick, email, plan, role) => ({
  id, username: id, nickname: nick, email, phone: '', avatar: null, avatarSource: '', providerAvatar: null, provider: '',
  loginMethods: ['oauth'], planId: plan, planStartedAt: plan === 'free' ? null : now, planExpiresAt: null,
  organizationId: role ? ORG : '', organizationRole: role || '', status: 'active',
  fileCleanup: { enabled: false, days: 7 }, createdAt: now, updatedAt: now,
})
fs.writeFileSync(path.join(SANDBOX, 'storage', 'metadata.json'), JSON.stringify({
  users: {
    [OWNER]: mkUser(OWNER, '林设计', 'lin@kunqiong.com', 'enterprise', 'owner'),
    [MEMBER_B]: mkUser(MEMBER_B, '王小张', 'bob@kunqiong.com', 'free', 'member'),
    [MEMBER_C]: mkUser(MEMBER_C, '李视觉', 'caty@kunqiong.com', 'free', 'member'),
    [OUTSIDER]: mkUser(OUTSIDER, '陈美术', 'out@kunqiong.com', 'free', ''),
  },
  sessions: [OWNER, MEMBER_B, MEMBER_C, OUTSIDER].map((id, i) => ({
    id: `sess_t_${i}`, expiresAt: new Date(Date.now() + 86400000).toISOString(), createdAt: now, apiWebToken: '',
    // 真实环境的会话快照是完整用户对象（登录时写入）；只写 {id} 会在启动合并时把兜底昵称覆盖进用户表
    user: mkUser(id, { [OWNER]: '林设计', [MEMBER_B]: '王小张', [MEMBER_C]: '李视觉', [OUTSIDER]: '陈美术' }[id], '', 'free', ''),
  })),
  organizations: {
    [ORG]: {
      id: ORG, slug: 'transfer-team', name: '转让测试团队', ownerUserId: OWNER, createdAt: now, updatedAt: now,
      members: [
        { id: 'm1', userId: OWNER, role: 'owner', status: 'active', displayName: '林设计', email: 'lin@kunqiong.com', phone: '', joinedAt: now },
        { id: 'm2', userId: MEMBER_B, role: 'member', status: 'active', displayName: '王小张', email: 'bob@kunqiong.com', phone: '', joinedAt: now },
        { id: 'm3', userId: MEMBER_C, role: 'member', status: 'active', displayName: '李视觉', email: 'caty@kunqiong.com', phone: '', joinedAt: now },
      ],
    },
  },
  messages: {}, shares: [], collections: [], auditLogs: [], uploadSessions: {},
  membershipOrders: [], joinRequests: [], upgradeOrders: [],
  systemConfig: { siteName: '鲲穹', registrationOpen: true },
}, null, 2))

const { spawn } = await import('node:child_process')
const server = spawn(NODE, ['server.mjs'], {
  cwd: SANDBOX, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', KUNQIONG_DB_ENABLED: 'false', NODE_ENV: 'production', KUNQIONG_ADMIN_USERNAME: 'admin', KUNQIONG_ADMIN_PASSWORD: 'admin-transfer-123' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let serverErr = ''
server.stderr.on('data', (b) => { serverErr += b.toString() })
await new Promise((resolve, reject) => {
  const t0 = Date.now()
  const tick = setInterval(async () => {
    if (Date.now() - t0 > 20000) { clearInterval(tick); reject(new Error('服务启动超时\n' + serverErr)) }
    try { if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok) { clearInterval(tick); resolve() } } catch {}
  }, 250)
})
trace('服务已启动')

const BASE = `http://127.0.0.1:${PORT}`
const SID = { owner: 'sess_t_0', bob: 'sess_t_1', caty: 'sess_t_2', out: 'sess_t_3' }
const api = (p, sid, init = {}) => fetch(`${BASE}${p}`, { ...init, headers: { Cookie: sid ? `kunqiong_session=${sid}` : '', ...(init.headers?.['Content-Type'] ? {} : { 'Content-Type': 'application/json' }), ...(init.headers || {}) } })
const readDisk = () => JSON.parse(fs.readFileSync(path.join(SANDBOX, 'storage', 'metadata.json'), 'utf8'))
const auditCount = (disk, action) => disk.auditLogs.filter((a) => a.action === action).length
const msgCount = (disk, uid, eventType) => (disk.messages[uid] || []).filter((m) => m.eventType === eventType).length

try {
  // 1. 权限：成员 B 调转让 → 403
  let r = await api('/api/account/workspace/transfer-ownership', SID.bob, { method: 'POST', body: JSON.stringify({ targetMemberId: 'm3' }) })
  check('成员调转让接口被拒 403', r.status === 403, `status=${r.status}`)

  // 2. 外人（不在任何团队）调解散 → 404
  r = await api('/api/account/workspace/dissolve', SID.out, { method: 'POST' })
  check('无团队用户调解散 404', r.status === 404, `status=${r.status}`)

  // 3. 参数校验：空 target / 不存在 member / 转给自己
  r = await api('/api/account/workspace/transfer-ownership', SID.owner, { method: 'POST', body: JSON.stringify({}) })
  check('转让缺目标 400', r.status === 400)
  r = await api('/api/account/workspace/transfer-ownership', SID.owner, { method: 'POST', body: JSON.stringify({ targetMemberId: 'm_nope' }) })
  check('转让目标不存在 400', r.status === 400)
  r = await api('/api/account/workspace/transfer-ownership', SID.owner, { method: 'POST', body: JSON.stringify({ targetMemberId: 'm1' }) })
  check('转让给自己 400', r.status === 400)

  // 4. 核心转让：owner → B
  r = await api('/api/account/workspace/transfer-ownership', SID.owner, { method: 'POST', body: JSON.stringify({ targetMemberId: 'm2' }) })
  let j = await r.json()
  check('转让成功 200 且 transferred=true', r.status === 200 && j.transferred === true, `status=${r.status} next=${j.nextOwnerName}`)
  check('原 owner 视角 canManage=false role=member', j.canManage === false && j.teamEntitlement?.role === 'member')
  check('新 owner 是 free 套餐时 nextOwnerCanUseTeamSpace=false', j.nextOwnerCanUseTeamSpace === false)
  let disk = readDisk()
  check('磁盘: org.ownerUserId 已切换', disk.organizations[ORG].ownerUserId === MEMBER_B)
  check('磁盘: m1.role=member m2.role=owner', disk.organizations[ORG].members.find((m) => m.id === 'm1').role === 'member' && disk.organizations[ORG].members.find((m) => m.id === 'm2').role === 'owner')
  check('磁盘: 双方账号 organizationRole 更新', disk.users[OWNER].organizationRole === 'member' && disk.users[MEMBER_B].organizationRole === 'owner')
  check('磁盘: 转让审计已写', auditCount(disk, '转让团队所有权') === 1)
  check('磁盘: 新 owner 收到接管通知', msgCount(disk, MEMBER_B, 'teamOwnership') === 1)

  r = await api('/api/account/workspace', SID.bob)
  j = await r.json()
  check('新 owner 会话 canManage=true', r.status === 200 && j.canManage === true && j.teamEntitlement?.role === 'owner')

  // 5. 转让后原 owner 可退出（核心闭环）
  r = await api('/api/account/workspace/leave', SID.owner, { method: 'POST' })
  j = await r.json()
  check('原 owner 转让后可退出 200', r.status === 200 && j.leftOrganizationId === ORG, `status=${r.status}`)
  disk = readDisk()
  check('磁盘: 原 owner 成员记录已移除且归属清空', !disk.organizations[ORG].members.some((m) => m.userId === OWNER) && disk.users[OWNER].organizationId === '')
  check('磁盘: 新 owner 收到退出通知', msgCount(disk, MEMBER_B, 'teamMemberLeft') === 1)

  // 6. 成员 C 调解散 → 403
  r = await api('/api/account/workspace/dissolve', SID.caty, { method: 'POST' })
  check('成员调解散被拒 403', r.status === 403, `status=${r.status}`)

  // 7. 核心解散：B 解散团队
  r = await api('/api/account/workspace/dissolve', SID.bob, { method: 'POST' })
  j = await r.json()
  check('解散成功 200', r.status === 200 && j.dissolvedOrganizationId === ORG, `status=${r.status} notified=${j.notifiedCount}`)
  disk = readDisk()
  check('磁盘: 组织已删除', !disk.organizations[ORG])
  check('磁盘: 成员 C 归属清空', disk.users[MEMBER_C].organizationId === '' && disk.users[MEMBER_C].organizationRole === '')
  check('磁盘: 成员 C 收到解散通知', msgCount(disk, MEMBER_C, 'teamDissolved') === 1)
  check('磁盘: 解散审计已写', auditCount(disk, '解散团队') === 1)

  r = await api('/api/account/workspace', SID.caty)
  j = await r.json()
  check('解散后成员 workspace 无团队且个人空间仍在', r.status === 200 && !j.organization && j.capacity && typeof j.capacity.usedBytes === 'number')
  r = await api('/api/account/team/overview', SID.caty)
  check('解散后成员 overview 404', r.status === 404, `status=${r.status}`)
  r = await api('/api/account/workspace/dissolve', SID.bob, { method: 'POST' })
  check('重复解散 404', r.status === 404, `status=${r.status}`)

  // 8. 企业分享入口随解散失效
  r = await fetch(`${BASE}/api/organizations/transfer-team/join-request`)
  j = await r.json()
  check('解散后企业加入入口 unavailable', r.status === 200 && j.available === false)
} catch (err) {
  check('异常中断', false, err.message)
} finally {
  server.kill()
}

const pass = results.filter((r) => r.pass).length
trace(`==== 结果: PASS=${pass} FAIL=${results.length - pass} ====`)
if (pass !== results.length) process.exit(1)
