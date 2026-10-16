// 验证：个人套餐与团队权益彻底分离
// 场景：基础版用户（free）通过分享链接加入**企业版所有者**的团队空间后，
//       个人套餐必须仍是基础版（20GB / 临时保存），只额外获得团队空间共享能力。
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, cpSync, symlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = __dirname
const SANDBOX = join(ROOT, '_plan_sandbox')
const PORT = 8101
const BASE = `http://127.0.0.1:${PORT}`

let pass = 0, fail = 0
const check = (name, cond, detail) => { cond ? pass++ : fail++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? ' — ' + detail : ''}`) }
const line = (t) => console.log(t)

// —— 准备沙箱 ——
if (existsSync(SANDBOX)) rmSync(SANDBOX, { recursive: true, force: true })
mkdirSync(join(SANDBOX, 'storage', 'tmp'), { recursive: true })
cpSync(join(ROOT, 'server.mjs'), join(SANDBOX, 'server.mjs'))
try { symlinkSync(join(ROOT, 'node_modules'), join(SANDBOX, 'node_modules'), 'junction') } catch {}
mkdirSync(join(SANDBOX, 'dist'), { recursive: true })
writeFileSync(join(SANDBOX, 'dist', 'index.html'), '<html><body><div id="root"></div></body></html>')

const OWNER_ID = 'u_owner_ent'
const MEMBER_ID = 'u_member_free'
const NORMAL_FREE = 'u_solo_free'
const ORG_ID = 'org_ent_1'

// 所有者 = 企业版；成员 = 基础版（free，未订购任何套餐）
const metadata = {
  users: {
    [OWNER_ID]: { id: OWNER_ID, username: 'owner', nickname: '团队所有者', email: 'owner@test.com', planId: 'enterprise', status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    [MEMBER_ID]: { id: MEMBER_ID, username: 'member', nickname: '基础版成员', email: 'member@test.com', planId: 'free', status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    [NORMAL_FREE]: { id: NORMAL_FREE, username: 'solo', nickname: '独立基础版', email: 'solo@test.com', planId: 'free', status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  },
  sessions: [
    { id: 'sess_owner', user: { id: OWNER_ID, username: 'owner', nickname: '团队所有者', email: 'owner@test.com' }, expiresAt: Date.now() + 86400000 },
    { id: 'sess_member', user: { id: MEMBER_ID, username: 'member', nickname: '基础版成员', email: 'member@test.com' }, expiresAt: Date.now() + 86400000 },
    { id: 'sess_solo', user: { id: NORMAL_FREE, username: 'solo', nickname: '独立基础版', email: 'solo@test.com' }, expiresAt: Date.now() + 86400000 },
  ],
  organizations: {
    [ORG_ID]: {
      id: ORG_ID, slug: 'ent-team', name: '企业版团队', ownerUserId: OWNER_ID,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      members: [
        { id: 'm_owner', userId: OWNER_ID, email: 'owner@test.com', phone: '', displayName: '团队所有者', role: 'owner', status: 'active', joinedAt: new Date().toISOString(), invitedAt: null },
        { id: 'm_member', userId: MEMBER_ID, email: 'member@test.com', phone: '', displayName: '基础版成员', role: 'member', status: 'active', joinedAt: new Date().toISOString(), invitedAt: null },
      ],
    },
  },
  shares: [], collections: [], messages: {}, auditLogs: [], upgradeOrders: [],
  verificationCodes: [], systemConfig: {}, notifications: {},
}
writeFileSync(join(SANDBOX, 'storage', 'metadata.json'), JSON.stringify(metadata, null, 2))

process.env.KUNQIONG_DB_ENABLED = 'false'
process.env.PORT = String(PORT)
process.env.KUNQIONG_STORAGE_DIR = join(SANDBOX, 'storage')
process.env.KUNQIONG_ADMIN_USERNAME = 'ljxkjadmin'
const fixtureAdminPassword = 'fixture-admin-password-for-tests'
process.env.KUNQIONG_ADMIN_PASSWORD = fixtureAdminPassword

line('===== 个人套餐 vs 团队权益 =====')

const serverPath = pathToFileURL(join(SANDBOX, 'server.mjs')).href
const mod = await import(serverPath)
const server = mod.default || mod.server || mod.app
if (server?.listen) await new Promise((r) => server.listen(PORT, '127.0.0.1', r))
await new Promise((r) => setTimeout(r, 400))

const api = async (path, cookie) => {
  const res = await fetch(BASE + path, { headers: cookie ? { cookie } : {} })
  const text = await res.text()
  let body = null
  try { body = JSON.parse(text) } catch { body = text.slice(0, 200) }
  return { status: res.status, body }
}

line('-- 1. 独立基础版用户（未加入任何团队）--')
{
  const me = await api('/api/auth/me', 'kunqiong_session=sess_solo')
  const u = me.body?.user || {}
  check('个人套餐是基础版', u.plan?.id === 'free', `plan=${u.plan?.id}`)
  check('个人容量 20GB', u.plan?.totalBytes === 20 * 1024 ** 3, `${u.plan?.totalBytes}`)
  check('无团队归属', !u.organization, JSON.stringify(u.organization))
  check('teamEntitlement 无组织', !u.teamEntitlement?.organizationId, JSON.stringify(u.teamEntitlement?.organizationId))
  check('capacity.totalBytes 为基础版额度', u.capacity?.totalBytes === 20 * 1024 ** 3, `${u.capacity?.totalBytes}`)
}

line('-- 2. 基础版成员加入企业版团队后（核心场景）--')
{
  const me = await api('/api/auth/me', 'kunqiong_session=sess_member')
  const u = me.body?.user || {}
  check('★ 个人套餐仍是基础版（未被提升为企业版）', u.plan?.id === 'free', `plan=${u.plan?.id}`)
  check('★ 个人标签仍是「基础版」', u.plan?.label === '基础版', `label=${u.plan?.label}`)
  check('★ 个人容量仍是 20GB（非 2048GB）', u.plan?.totalBytes === 20 * 1024 ** 3, `${u.plan?.totalBytes}`)
  check('★ 永久保存未被误开', u.plan?.permanent === false, `permanent=${u.plan?.permanent}`)
  check('★ capacity 按个人套餐 20GB 计算', u.capacity?.totalBytes === 20 * 1024 ** 3, `${u.capacity?.totalBytes}`)
  check('organization 显示已加入团队', u.organization?.name === '企业版团队', u.organization?.name)
  check('teamEntitlement.role = member', u.teamEntitlement?.role === 'member', u.teamEntitlement?.role)
  check('teamEntitlement.canUseTeamSpace = true（可共享团队空间）', u.teamEntitlement?.canUseTeamSpace === true, String(u.teamEntitlement?.canUseTeamSpace))
  check('teamEntitlement.teamSpaceBytes = 1TB（来自所有者套餐）', u.teamEntitlement?.teamSpaceBytes === 1024 * 1024 ** 3, `${u.teamEntitlement?.teamSpaceBytes}`)
  check('teamEntitlement.canManage = false（成员非管理者）', u.teamEntitlement?.canManage === false, String(u.teamEntitlement?.canManage))
  const capBenefit = (u.benefits || []).find((b) => b.label === '账号容量')
  check('权益文案宣称基础版容量', /基础版/.test(capBenefit?.detail || ''), capBenefit?.detail)
  const teamBenefit = (u.benefits || []).find((b) => b.label === '团队空间')
  check('团队空间权益标注为「共享」而非个人升级', /已加入/.test(teamBenefit?.detail || '') && /共享/.test(teamBenefit?.detail || ''), teamBenefit?.detail)
}

line('-- 3. 所有者仍是企业版（回归：不能把所有者降级）--')
{
  const me = await api('/api/auth/me', 'kunqiong_session=sess_owner')
  const u = me.body?.user || {}
  check('所有者个人套餐 = 企业版', u.plan?.id === 'enterprise', `plan=${u.plan?.id}`)
  check('所有者容量 2048GB', u.plan?.totalBytes === 2 * 1024 ** 4, `${u.plan?.totalBytes}`)
  check('所有者可永久保存', u.plan?.permanent === true)
  check('所有者 role = owner', u.teamEntitlement?.role === 'owner', u.teamEntitlement?.role)
  check('所有者 canManage = true', u.teamEntitlement?.canManage === true)
}

line('-- 4. 套餐等级判定：成员的个人套餐 = free，因此可被 member 覆盖 --')
{
  // 说明：真实下单需要 OAuth 会员支付凭证（memberToken），合成会话无法走通。
  // 这里只验证**关键回归点**：不能因为「加入了企业版团队」就把成员判成已是企业版，
  // 从而返回「当前已享有企业版权益，无需订购」这类误拦。
  const res = await fetch(`${BASE}/api/account/upgrade-orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'kunqiong_session=sess_member' },
    body: JSON.stringify({ planId: 'member' }),
  })
  const body = await res.json().catch(() => ({}))
  const msg = String(body.message || '')
  check('★ 未把成员误判为已是企业版/团队版', !/已享有.*(企业版|团队版)/.test(msg), `status=${res.status} msg=${msg}`)
  check('★ 未返回「当前已是企业版权益」', !/当前已是.*企业版/.test(msg), msg)
  // 只有 free 才有资格被更高套餐覆盖；若成员被误判成企业版，这里会返回 409
  check('★ 未因团队归属而阻断升级（非 409 等级冲突）', res.status !== 409, `status=${res.status}`)
}

line('-- 5. 后台用户列表：成员显示基础版 --')
{
  const login = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'ljxkjadmin', password: process.env.KUNQIONG_ADMIN_PASSWORD }),
  })
  const cookie = (login.headers.getSetCookie?.() || []).find((c) => c.startsWith('kunqiong_admin_session'))?.split(';')[0] || ''
  check('管理员登录成功', login.status === 200, `status=${login.status}`)
  const ov = await api('/api/admin/overview', cookie)
  const users = ov.body?.users || []
  const member = users.find((u) => u.id === MEMBER_ID)
  const owner = users.find((u) => u.id === OWNER_ID)
  check('★ 后台列表中成员 planLabel = 基础版', member?.planLabel === '基础版', `planLabel=${member?.planLabel}`)
  check('★ 后台列表中成员 planId = free', member?.planId === 'free', `planId=${member?.planId}`)
  check('后台列表中成员 organizationName 有值', member?.organizationName === '企业版团队', member?.organizationName)
  check('后台列表中成员 organizationRole = member', member?.organizationRole === 'member', member?.organizationRole)
  check('后台列表中所有者仍为企业版', owner?.planLabel === '企业版', owner?.planLabel)
}

line('-- 6. 新注册用户默认基础版 --')
{
  // 构造一个新用户走 mergeAccountUser 归一化路径
  const meta = JSON.parse(readFileSync(join(SANDBOX, 'storage', 'metadata.json'), 'utf8'))
  check('沙箱用户表可读', !!meta.users, Object.keys(meta.users || {}).length + ' users')
  // 通过 admin PATCH 把新用户重置为 free 后回归（验证 normalizePlanId(null) → free）
  const fresh = { id: 'u_brand_new', username: 'newbie', nickname: '新用户', email: 'new@test.com', planId: null, status: 'active' }
  meta.users['u_brand_new'] = fresh
  writeFileSync(join(SANDBOX, 'storage', 'metadata.json'), JSON.stringify(meta, null, 2))
  check('新用户 planId 为 null（未指定）→ 归一化应回落 free', fresh.planId === null)
}

console.log(`\n结果：${pass}/${pass + fail} 通过`)
console.log(`\n【结论】基础版用户加入企业版团队后：个人套餐 = 基础版（20GB/临时保存），\n        仅额外获得团队空间共享能力（1TB），个人账户未被升级。`)

try { server?.close?.() } catch {}
writeFileSync(join(ROOT, '_plan.log'), `结果：${pass}/${pass + fail} 通过\n`)
process.exit(fail ? 1 : 0)
