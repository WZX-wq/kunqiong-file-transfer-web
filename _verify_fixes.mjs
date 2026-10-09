// 验证本轮四项改动：
//  1. 后台用户管理行布局（去掉到期日输入、操作区高度对齐）
//  2. 成员可自行退出团队空间（新增 POST /api/account/workspace/leave）
//  3. 团队空间 KPI / 邀请链接字体调大
//  4. 个人资料头像提示文案与实际行为一致
import fs from 'node:fs'
import path from 'node:path'

const ROOT = 'C:\\Users\\admin\\Desktop\\鲲穹文件传输web'
const NODE = 'C:/Users/admin/.workbuddy/binaries/node/versions/22.22.2-3/node.exe'
const SANDBOX = path.join(ROOT, '_fixes_sandbox')
const PORT = 8108
const LOG = path.join(ROOT, '_fixes.txt')

const out = []
let pass = 0, fail = 0
const line = (s) => { out.push(s); fs.writeFileSync(LOG, out.join('\n')) }
const check = (n, c, d) => { c ? pass++ : fail++; line(`  ${c ? 'PASS' : 'FAIL'}  ${n}${d !== undefined ? ' — ' + d : ''}`) }

// ---------- 静态契约检查（源码 + 产物） ----------
const jsx = fs.readFileSync(path.join(ROOT, 'src/main.jsx'), 'utf8')
const css = fs.readFileSync(path.join(ROOT, 'src/styles.css'), 'utf8')
const server = fs.readFileSync(path.join(ROOT, 'server.mjs'), 'utf8')

line('===== 1. 后台用户管理行布局 =====')
check('已移除到期日输入框（admin-plan-expiry 不再渲染）', !jsx.includes('admin-plan-expiry'), '已删除 input')
check('套餐选择器改用 admin-user-plan 类', jsx.includes('admin-user-plan'), 'ok')
check('操作区容器 admin-user-actions 存在', jsx.includes('admin-user-actions'), 'ok')
check('CSS 操作区 align-items:center 对齐', /\.admin-user-actions\s*\{[^}]*align-items:\s*center/.test(css), 'ok')
check('CSS 套餐与按钮统一 height:34px', /\.admin-user-actions\s*>\s*\.secondary-button\s*\{[^}]*height:\s*34px/.test(css), 'ok')
check('CSS 用量改到操作区内（admin-user-usage）', css.includes('.admin-user-usage'), 'ok')
check('旧网格列定义已换成两列', /\.admin-table-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*auto;/.test(css), 'ok')

line('===== 2. 成员自行退出团队空间 =====')
check('后端新增 POST /api/account/workspace/leave', server.includes("app.post('/api/account/workspace/leave'"), 'ok')
check('后端：所有者不可退出（提示转让/解散）', server.includes('团队所有者不能退出团队空间'), 'ok')
check('后端：退出后清空 organizationId/Role', /account\.organizationId = ''[\s\S]{0,80}account\.organizationRole = ''/.test(server), 'ok')
check('后端：退出写审计日志', server.includes("action: '退出团队空间'"), 'ok')
check('后端：退出通知所有者', server.includes("eventType: 'teamMemberLeft'"), 'ok')
check('前端新增 leaveTeam 处理函数', jsx.includes('const leaveTeam = async'), 'ok')
check('前端有退出二次确认弹窗', jsx.includes('退出团队空间') && jsx.includes('确认退出'), 'ok')
check('前端成员视图渲染退出按钮', jsx.includes('team-leave-button'), 'ok')
check('前端退出按钮仅成员可见（!data.canManage）', jsx.includes('{!data.canManage && <div className="public-card team-panel team-leave-card">'), 'ok')
check('★ 团队成员管理页签已加 canManage 门控（成员不可见）', jsx.includes("{data.canManage && <button className={activeTab === 'manage'"), 'ok')
check('★ 团队成员管理面板已加 canManage 门控', jsx.includes("{visibleTab === 'manage' && data.canManage &&"), 'ok')
check('★ 无权限时页签回落到「成员观察」（visibleTab 归一化）', /const visibleTab = data\?\.canManage/.test(jsx), 'ok')
check('CSS 退出卡片已定义', css.includes('.team-leave-card'), 'ok')

line('===== 3. 团队空间字体调大 =====')
check('KPI 标签 11px → 13px', /\.team-kpi span\s*\{[^}]*font-size:\s*13px/.test(css), 'ok')
check('KPI 数值 24px → 26px', /\.team-kpi strong\s*\{[^}]*font-size:\s*26px/.test(css), 'ok')
check('KPI 说明 10px → 12px', /\.team-kpi small\s*\{[^}]*font-size:\s*12px/.test(css), 'ok')
check('邀请链接标题 12px → 14px', /\.team-invite-link-head strong\s*\{[^}]*font-size:\s*14px/.test(css), 'ok')
check('邀请链接说明 10px → 12px', /\.team-invite-link-head small\s*\{[^}]*font-size:\s*12px/.test(css), 'ok')
check('邀请链接 URL 10px → 12px', /\.team-invite-link-row code\s*\{[^}]*font-size:\s*12px/.test(css), 'ok')
check('容量明细 11px → 12px', /\.team-capacity-meta\s*\{[^}]*font-size:\s*12px/.test(css), 'ok')

line('===== 4. 个人资料头像提示文案 =====')
check('旧文案「微信或 QQ 登录头像」已删除', !jsx.includes('使用微信或 QQ 登录头像'), 'ok')
check('新文案描述与实际行为一致', jsx.includes('未上传时默认显示鲲穹账号的登录头像'), 'ok')

// ---------- 真实 HTTP：跑通退出团队全链路 ----------
line('===== 5. 退出团队空间：真实 HTTP 全链路 =====')

fs.rmSync(SANDBOX, { recursive: true, force: true })
fs.mkdirSync(path.join(SANDBOX, 'storage'), { recursive: true })
fs.copyFileSync(path.join(ROOT, 'server.mjs'), path.join(SANDBOX, 'server.mjs'))
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(SANDBOX, 'node_modules'), 'junction')
fs.symlinkSync(path.join(ROOT, 'dist'), path.join(SANDBOX, 'dist'), 'junction')

const now = new Date().toISOString()
const OWNER = 'u_owner_fx'
const MEMBER = 'u_member_fx'
const ORG = 'org_fx_1'
fs.writeFileSync(path.join(SANDBOX, 'storage', 'metadata.json'), JSON.stringify({
  users: {
    [OWNER]: { id: OWNER, username: 'owner_fx', nickname: '所有者', email: 'owner@fx.com', phone: '', avatar: null, avatarSource: '', providerAvatar: null, provider: '', loginMethods: ['oauth'], planId: 'enterprise', planStartedAt: now, planExpiresAt: null, organizationId: ORG, organizationRole: 'owner', status: 'active', fileCleanup: { enabled: false, days: 7 }, createdAt: now, updatedAt: now },
    [MEMBER]: { id: MEMBER, username: 'member_fx', nickname: '成员小张', email: 'member@fx.com', phone: '', avatar: null, avatarSource: '', providerAvatar: null, provider: '', loginMethods: ['oauth'], planId: 'free', planStartedAt: null, planExpiresAt: null, organizationId: ORG, organizationRole: 'member', status: 'active', fileCleanup: { enabled: false, days: 7 }, createdAt: now, updatedAt: now },
  },
  sessions: [
    { id: 'sess_owner_fx', expiresAt: new Date(Date.now() + 86400000).toISOString(), createdAt: now, apiWebToken: '', user: { id: OWNER } },
    { id: 'sess_member_fx', expiresAt: new Date(Date.now() + 86400000).toISOString(), createdAt: now, apiWebToken: '', user: { id: MEMBER } },
  ],
  organizations: {
    [ORG]: {
      id: ORG, slug: 'fx-team', name: '修复验证团队', ownerUserId: OWNER,
      createdAt: now, updatedAt: now,
      members: [
        { id: 'm_owner', userId: OWNER, role: 'owner', status: 'active', displayName: '所有者', email: 'owner@fx.com', phone: '', joinedAt: now },
        { id: 'm_member', userId: MEMBER, role: 'member', status: 'active', displayName: '成员小张', email: 'member@fx.com', phone: '', joinedAt: now },
      ],
    },
  },
  shares: [], collections: [], messages: {}, auditLogs: [], uploadSessions: {}, membershipOrders: [], joinRequests: [],
}, null, 2))

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

const api = (p, sid, init = {}) => fetch(`http://127.0.0.1:${PORT}${p}`, {
  ...init,
  headers: { 'Content-Type': 'application/json', Cookie: `kunqiong_session=${sid}`, ...(init.headers || {}) },
})

try {
  // 成员退出前：应看到团队归属与团队权益
  const before = await (await api('/api/auth/me', 'sess_member_fx')).json()
  check('退出前 成员 organizationRole=member', before.user?.organizationRole === 'member', JSON.stringify(before.user?.organizationRole))
  check('退出前 成员仍是基础版（个人套餐未被团队影响）', before.user?.plan?.id === 'free', JSON.stringify(before.user?.plan?.id))

  const wsBefore = await (await api('/api/account/workspace', 'sess_member_fx')).json()
  check('退出前 工作台显示团队成员身份', wsBefore.teamEntitlement?.role === 'member', JSON.stringify(wsBefore.teamEntitlement?.role))
  check('退出前 canManage=false（不是所有者）', wsBefore.canManage === false, JSON.stringify(wsBefore.canManage))

  // 所有者不能退出
  const ownerLeave = await api('/api/account/workspace/leave', 'sess_owner_fx', { method: 'POST' })
  check('★ 所有者退出被拒 400', ownerLeave.status === 400, `status=${ownerLeave.status}`)

  // 未登录不能退出
  const anonLeave = await fetch(`http://127.0.0.1:${PORT}/api/account/workspace/leave`, { method: 'POST' })
  check('未登录退出 → 401', anonLeave.status === 401, `status=${anonLeave.status}`)

  // 成员退出
  const leave = await api('/api/account/workspace/leave', 'sess_member_fx', { method: 'POST' })
  const leaveBody = await leave.json()
  check('★ 成员退出 → 200', leave.status === 200, `status=${leave.status} ${leaveBody.message || ''}`)
  check('响应带 leftOrganizationId', leaveBody.leftOrganizationId === ORG, JSON.stringify(leaveBody.leftOrganizationId))
  check('★ 退出后 teamEntitlement.role 为空', !leaveBody.teamEntitlement?.role, JSON.stringify(leaveBody.teamEntitlement?.role))
  check('★ 退出后 canUseTeamSpace=false', leaveBody.teamEntitlement?.canUseTeamSpace === false, JSON.stringify(leaveBody.teamEntitlement?.canUseTeamSpace))

  // 退出后复查 /api/auth/me：团队归属清空，个人套餐与容量不变
  const after = await (await api('/api/auth/me', 'sess_member_fx')).json()
  check('★ 退出后 organizationRole 已清空', after.user?.organizationRole === '', JSON.stringify(after.user?.organizationRole))
  check('★ 退出后个人套餐仍是基础版（未被连带影响）', after.user?.plan?.id === 'free', JSON.stringify(after.user?.plan?.id))
  check('★ 退出后个人容量仍是 20GB 基础版', Number(after.user?.capacity?.totalBytes) === 21474836480, String(after.user?.capacity?.totalBytes))
  check('退出后 organization 为 null', after.user?.organization === null || after.user?.organization === undefined, JSON.stringify(after.user?.organization))

  // 重复退出应报"不在任何团队"
  const again = await api('/api/account/workspace/leave', 'sess_member_fx', { method: 'POST' })
  check('重复退出 → 404 不在团队', again.status === 404, `status=${again.status}`)

  // 落盘校验
  const disk = JSON.parse(fs.readFileSync(path.join(SANDBOX, 'storage', 'metadata.json'), 'utf8'))
  check('★ 磁盘：成员已从 organization.members 移除', !disk.organizations[ORG].members.some((m) => m.userId === MEMBER), 'ok')
  check('磁盘：所有者仍在团队', disk.organizations[ORG].members.some((m) => m.userId === OWNER), 'ok')
  check('★ 磁盘：成员账号 organizationId 已清空', disk.users[MEMBER].organizationId === '', JSON.stringify(disk.users[MEMBER].organizationId))
  check('磁盘：退出写入审计日志', (disk.auditLogs || []).some((log) => log.action === '退出团队空间'), 'ok')
  check('磁盘：所有者收到退出通知', (disk.messages?.[OWNER] || []).some((m) => m.eventType === 'teamMemberLeft'), 'ok')

  // 所有者视图：成员数应变为 1
  const ownerWs = await (await api('/api/account/workspace', 'sess_owner_fx')).json()
  check('所有者视图：团队仅剩 1 人', (ownerWs.organization?.members || []).length === 1, String((ownerWs.organization?.members || []).length))
} catch (error) {
  fail++
  line(`  FAIL  异常中断 — ${error.message}`)
}

child.kill('SIGTERM')
line('')
line(`结果：${pass}/${pass + fail} 通过`)
fs.writeFileSync(LOG, out.join('\n'))
console.log(out.join('\n'))
setTimeout(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }) } catch {} ; process.exit(fail ? 1 : 0) }, 600)
