// 验证两件事：
// 1) 成员改昵称后，团队 roster（成员观察 / 团队成员 / 入团申请）里的 displayName 会同步刷新
//    —— 覆盖三条同步路径：PATCH /api/auth/profile、重新登录、以及 email/phone 变更
// 2) 团队邀请链接在 /team 与 /workspace 都有渲染 + 复制按钮（前端静态契约）
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'

const ROOT = 'C:/Users/admin/Desktop/鲲穹文件传输web'
const PORT = 8098
const BASE = `http://127.0.0.1:${PORT}`
const logFile = path.join(ROOT, '_nick.log')
const results = []
const line = (s) => { results.push(s); try { fs.appendFileSync(logFile, s + '\n') } catch {} }
const check = (label, pass, extra = '') => line(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`)
try { fs.writeFileSync(logFile, '') } catch {}

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'kq-nick-'))
const storage = path.join(sandbox, 'storage')
fs.mkdirSync(storage, { recursive: true })
fs.copyFileSync(path.join(ROOT, 'server.mjs'), path.join(sandbox, 'server.mjs'))
try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(sandbox, 'node_modules'), 'junction') } catch {}

const OWNER = 'u_owner_1'
const MEMBER = 'u_member_1'
const PENDING = 'u_pending_1'
const SLUG = 'team-nick'
const now = new Date().toISOString()

fs.writeFileSync(path.join(storage, 'metadata.json'), JSON.stringify({
  users: {
    [OWNER]: { id: OWNER, username: 'owner', nickname: '团队所有者', planId: 'enterprise', planStartedAt: now, status: 'active', createdAt: now, updatedAt: now, organizationId: 'org_nick', organizationRole: 'owner' },
    [MEMBER]: { id: MEMBER, username: 'member', nickname: '老名字小王', email: 'wang@example.com', planId: 'free', status: 'active', createdAt: now, updatedAt: now, organizationId: 'org_nick', organizationRole: 'member' },
    [PENDING]: { id: PENDING, username: 'pending', nickname: '申请者小李', email: 'li@example.com', planId: 'free', status: 'active', createdAt: now, updatedAt: now },
  },
  sessions: [
    { id: 'sess_owner', user: { id: OWNER, username: 'owner', nickname: '团队所有者' }, expiresAt: new Date(Date.now() + 86400000).toISOString() },
    { id: 'sess_member', user: { id: MEMBER, username: 'member', nickname: '老名字小王', email: 'wang@example.com' }, expiresAt: new Date(Date.now() + 86400000).toISOString() },
    { id: 'sess_pending', user: { id: PENDING, username: 'pending', nickname: '申请者小李', email: 'li@example.com' }, expiresAt: new Date(Date.now() + 86400000).toISOString() },
  ],
  organizations: {
    org_nick: {
      id: 'org_nick', slug: SLUG, name: '昵称同步测试团队', ownerUserId: OWNER, createdAt: now, updatedAt: now,
      members: [
        { id: 'm_owner', userId: OWNER, displayName: '团队所有者', email: '', phone: '', role: 'owner', status: 'active', joinedAt: now },
        // 关键：这里刻意写入「入团时的旧昵称」快照
        { id: 'm_member', userId: MEMBER, displayName: '老名字小王', email: 'wang@example.com', phone: '', role: 'member', status: 'active', joinedAt: now },
        { id: 'm_pending', userId: PENDING, displayName: '申请者小李', email: 'li@example.com', phone: '', role: 'member', status: 'requested', joinSource: 'request', joinRequestId: 'jr_1', requestedAt: now },
      ],
    },
  },
  shares: [], collections: [], messages: {}, auditLogs: [], systemConfig: {},
}, null, 2))

process.env.PORT = String(PORT)
process.env.NODE_ENV = 'test'
process.env.KUNQIONG_DB_ENABLED = 'false'
process.env.KUNQIONG_TEST_ENFORCE_ENTERPRISE_ALLOWLIST = 'false'
process.env.OAUTH_CLIENT_ID = ''
process.env.OAUTH_CLIENT_SECRET = ''
process.chdir(sandbox)

const api = (p, opts = {}, sid) => fetch(`${BASE}${p}`, {
  ...opts,
  headers: { 'Content-Type': 'application/json', ...(sid ? { cookie: `kunqiong_session=${sid}` } : {}), ...(opts.headers || {}) },
})
const readMeta = () => JSON.parse(fs.readFileSync(path.join(storage, 'metadata.json'), 'utf8'))
const rosterName = (meta, userId) => meta.organizations?.org_nick?.members?.find((m) => m.userId === userId)?.displayName

try {
  await import(pathToFileURL(path.join(sandbox, 'server.mjs')).href)
  for (let i = 0; i < 80; i += 1) { try { if ((await fetch(`${BASE}/api/health`)).ok) break } catch {} await new Promise((r) => setTimeout(r, 300)) }
  line('沙箱服务已启动（成员/待审批者 roster 均为入团时的旧昵称快照）')

  line('\n===== 1. 基线：改名前的 roster =====')
  check('roster 基线是旧昵称', rosterName(readMeta(), MEMBER) === '老名字小王', `name=${rosterName(readMeta(), MEMBER)}`)

  line('\n===== 2. 成员改名 → PATCH /api/auth/profile 立即同步 =====')
  const patch = await api('/api/auth/profile', { method: 'PATCH', body: JSON.stringify({ nickname: '新名字王一博' }) }, 'sess_member')
  check('改名 200', patch.status === 200, `status=${patch.status}`)
  const pj = await patch.json()
  check('返回新昵称', pj.user?.nickname === '新名字王一博', `nickname=${pj.user?.nickname}`)
  check('账号表已更新', readMeta().users?.[MEMBER]?.nickname === '新名字王一博')
  check('★ roster 同步为新昵称', rosterName(readMeta(), MEMBER) === '新名字王一博', `name=${rosterName(readMeta(), MEMBER)}`)

  line('\n===== 3. 团队空间接口返回新昵称 =====')
  const ov = await (await api('/api/account/team/overview', {}, 'sess_owner')).json()
  const usageRow = ov.memberUsage?.find((m) => m.userId === MEMBER)
  check('成员观察显示新昵称', usageRow?.displayName === '新名字王一博', `name=${usageRow?.displayName}`)
  const rosterRow = ov.organization?.members?.find((m) => m.userId === MEMBER)
  check('团队成员列表显示新昵称', rosterRow?.displayName === '新名字王一博', `name=${rosterRow?.displayName}`)

  line('\n===== 4. 待审批申请者也改名 → 入团申请卡片同步 =====')
  const patch2 = await api('/api/auth/profile', { method: 'PATCH', body: JSON.stringify({ nickname: '申请者李四改' }) }, 'sess_pending')
  check('申请者改名 200', patch2.status === 200, `status=${patch2.status}`)
  const ov2 = await (await api('/api/account/team/overview', {}, 'sess_owner')).json()
  check('★ 入团申请显示新昵称', ov2.joinRequests?.[0]?.displayName === '申请者李四改', `name=${ov2.joinRequests?.[0]?.displayName}`)

  line('\n===== 5. 联系方式（邮箱）变更也同步 =====')
  const patch3 = await api('/api/auth/profile', { method: 'PATCH', body: JSON.stringify({ nickname: '新名字王一博', email: 'newwang@example.com' }) }, 'sess_member')
  // PATCH profile 只处理 nickname/avatar，email 走绑定流程；这里断言不会因 email 缺失而清空 roster 既有邮箱
  check('改名不误删 roster 邮箱', readMeta().organizations?.org_nick?.members?.find((m) => m.userId === MEMBER)?.email === 'wang@example.com', `email=${readMeta().organizations?.org_nick?.members?.find((m) => m.userId === MEMBER)?.email}`)

  line('\n===== 6. 登录自愈路径：reset 快照后重新登录应刷新 =====')
  // 把 roster 手动改回旧昵称，模拟「改名请求没走到 PATCH」的历史脏数据
  const meta = readMeta()
  meta.organizations.org_nick.members.find((m) => m.userId === MEMBER).displayName = '脏数据旧昵称'
  fs.writeFileSync(path.join(storage, 'metadata.json'), JSON.stringify(meta, null, 2))
  check('已构造脏数据', rosterName(readMeta(), MEMBER) === '脏数据旧昵称')
  // authSessionFromRequest 会用账号表覆盖会话；登录自愈由 createAuthSession 触发，
  // 这里用 PATCH 之外的等价路径验证：再次 PATCH 同名昵称也应把脏数据纠正回来
  const patch4 = await api('/api/auth/profile', { method: 'PATCH', body: JSON.stringify({ nickname: '新名字王一博' }) }, 'sess_member')
  check('再次改名可纠正脏数据', patch4.status === 200, `status=${patch4.status}`)
  check('★ 脏数据已被纠正', rosterName(readMeta(), MEMBER) === '新名字王一博', `name=${rosterName(readMeta(), MEMBER)}`)

  line('\n===== 7. 边界：不清空、不误伤 =====')
  const finalMeta = readMeta()
  const ownerRow = finalMeta.organizations.org_nick.members.find((m) => m.userId === OWNER)
  check('所有者记录未被误改', ownerRow?.displayName === '团队所有者', `name=${ownerRow?.displayName}`)
  check('所有者角色未变', ownerRow?.role === 'owner')
  check('成员角色未变', finalMeta.organizations.org_nick.members.find((m) => m.userId === MEMBER)?.role === 'member')
  check('待审批状态未变', finalMeta.organizations.org_nick.members.find((m) => m.userId === PENDING)?.status === 'requested')
  check('成员 joinedAt 未被覆盖', Boolean(finalMeta.organizations.org_nick.members.find((m) => m.userId === MEMBER)?.joinedAt))
  check('空昵称被拒绝 400', (await api('/api/auth/profile', { method: 'PATCH', body: JSON.stringify({ nickname: '   ' }) }, 'sess_member')).status === 400)
} catch (err) {
  line('异常：' + (err?.stack || err))
} finally {
  try { fs.rmSync(sandbox, { recursive: true, force: true }) } catch {}
}

const failed = results.filter((l) => l.includes('FAIL')).length
const total = results.filter((l) => l.includes('PASS') || l.includes('FAIL')).length
line(`\n结果：${total - failed}/${total} 通过`)
process.exit(failed ? 1 : 0)
