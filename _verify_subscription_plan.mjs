// 验证：会员等级与有效期（订阅制对齐）
// 背景：主站 member/team 是订阅卡（月卡30天/季卡90天），本地套餐配置 permanent 改为 false 后：
//   1) 开通授予 planExpiresAt = now + days（不再是永久）；enterprise 仍永久
//   2) 订阅到期后 accountPlanForUser 自动回落 free（特权随之收回）
//   3) 会员特权（改分享有效期/重新开启）= 付费套餐在有效期内；永久特权（永久分享）= 仅 permanent 权益
//   4) sharePayload.canReopen 与 applyShareUpdate 同口径
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, cpSync, symlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = __dirname
const SANDBOX = join(ROOT, '_sub_sandbox')
const PORT = 8102
const BASE = `http://127.0.0.1:${PORT}`

let pass = 0, fail = 0
const check = (name, cond, detail) => { cond ? pass++ : fail++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? ' — ' + detail : ''}`) }
const line = (t) => console.log(t)

if (existsSync(SANDBOX)) rmSync(SANDBOX, { recursive: true, force: true })
mkdirSync(join(SANDBOX, 'storage', 'tmp'), { recursive: true })
cpSync(join(ROOT, 'server.mjs'), join(SANDBOX, 'server.mjs'))
try { symlinkSync(join(ROOT, 'node_modules'), join(SANDBOX, 'node_modules'), 'junction') } catch {}
mkdirSync(join(SANDBOX, 'dist'), { recursive: true })
writeFileSync(join(SANDBOX, 'dist', 'index.html'), '<html><body><div id="root"></div></body></html>')

const FREE_ID = 'u_sub_free'
const MEMBER_ID = 'u_sub_member'
const MEMBER_EXP_ID = 'u_sub_member_exp'
const ENT_ID = 'u_sub_ent'
const in20d = new Date(Date.now() + 20 * 86400000).toISOString()
const expired2d = new Date(Date.now() - 2 * 86400000).toISOString()

const mkShare = (id, owner, token) => ({
  id, manageToken: token, ownerUserId: owner, code: 'ABC123', name: `分享-${id}`,
  status: 'active', expiresAt: in20d, files: [{ name: 'a.txt', size: 10 }], createdAt: new Date().toISOString(),
})

const metadata = {
  users: {
    [FREE_ID]: { id: FREE_ID, username: 'subfree', nickname: '基础用户', email: 'subfree@test.com', planId: 'free', status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    [MEMBER_ID]: { id: MEMBER_ID, username: 'submember', nickname: '订阅会员', email: 'submember@test.com', planId: 'member', planExpiresAt: in20d, status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    [MEMBER_EXP_ID]: { id: MEMBER_EXP_ID, username: 'subexpired', nickname: '过期会员', email: 'subexpired@test.com', planId: 'member', planExpiresAt: expired2d, status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    [ENT_ID]: { id: ENT_ID, username: 'subent', nickname: '企业永久', email: 'subent@test.com', planId: 'enterprise', status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  },
  sessions: [
    { id: 'sess_free', user: { id: FREE_ID, username: 'subfree' }, expiresAt: Date.now() + 86400000 },
    { id: 'sess_member', user: { id: MEMBER_ID, username: 'submember' }, expiresAt: Date.now() + 86400000 },
    { id: 'sess_member_exp', user: { id: MEMBER_EXP_ID, username: 'subexpired' }, expiresAt: Date.now() + 86400000 },
    { id: 'sess_ent', user: { id: ENT_ID, username: 'subent' }, expiresAt: Date.now() + 86400000 },
  ],
  organizations: {},
  shares: [
    mkShare('sh_free', FREE_ID, 'mtok_free'),
    mkShare('sh_member', MEMBER_ID, 'mtok_member'),
    mkShare('sh_member_exp', MEMBER_EXP_ID, 'mtok_member_exp'),
    mkShare('sh_ent', ENT_ID, 'mtok_ent'),
  ],
  collections: [], records: {}, messages: {}, auditLogs: [], upgradeOrders: [],
  verificationCodes: [], systemConfig: {}, notifications: {},
}
writeFileSync(join(SANDBOX, 'storage', 'metadata.json'), JSON.stringify(metadata, null, 2))

process.env.KUNQIONG_DB_ENABLED = 'false'
process.env.PORT = String(PORT)
process.env.KUNQIONG_STORAGE_DIR = join(SANDBOX, 'storage')
process.env.KUNQIONG_ADMIN_USERNAME = 'ljxkjadmin'
const fixtureAdminPassword = 'fixture-admin-password-for-tests'
process.env.KUNQIONG_ADMIN_PASSWORD = fixtureAdminPassword

const serverPath = pathToFileURL(join(SANDBOX, 'server.mjs')).href
const mod = await import(serverPath)
const server = mod.default || mod.server || mod.app
if (server?.listen) await new Promise((r) => server.listen(PORT, '127.0.0.1', r))
await new Promise((r) => setTimeout(r, 400))

const api = async (method, path, cookie, body) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data = null
  try { data = JSON.parse(text) } catch { data = text.slice(0, 200) }
  return { status: res.status, body: data }
}

line('===== A. 会员等级与有效期 payload =====')
{
  const wsFree = (await api('GET', '/api/account/workspace', 'kunqiong_session=sess_free')).body
  check('free 用户等级 = 基础版', wsFree?.plan?.id === 'free', `plan=${wsFree?.plan?.id}`)
  check('free 用户无到期时间', !wsFree?.planExpiresAt, `planExpiresAt=${wsFree?.planExpiresAt}`)

  const wsMember = (await api('GET', '/api/account/workspace', 'kunqiong_session=sess_member')).body
  check('★ 订阅会员等级 = 会员版', wsMember?.plan?.id === 'member', `plan=${wsMember?.plan?.id}`)
  check('★ 订阅会员 permanent=false（非买断）', wsMember?.plan?.permanent === false, `permanent=${wsMember?.plan?.permanent}`)
  check('★ 订阅会员 planExpiresAt 有值且在未来', Boolean(wsMember?.planExpiresAt) && new Date(wsMember.planExpiresAt).getTime() > Date.now(), wsMember?.planExpiresAt)

  const meMember = (await api('GET', '/api/auth/me', 'kunqiong_session=sess_member')).body
  check('★ 设置页可见到期时间（user.planExpiresAt）', Boolean(meMember?.user?.planExpiresAt), meMember?.user?.planExpiresAt)

  const wsExp = (await api('GET', '/api/account/workspace', 'kunqiong_session=sess_member_exp')).body
  check('★ 过期订阅自动回落基础版', wsExp?.plan?.id === 'free', `plan=${wsExp?.plan?.id}`)
  check('★ 过期订阅容量回落 20GB', wsExp?.capacity?.totalBytes === 20 * 1024 ** 3, `${wsExp?.capacity?.totalBytes}`)

  const wsEnt = (await api('GET', '/api/account/workspace', 'kunqiong_session=sess_ent')).body
  check('企业版权益 = 永久（permanent=true）', wsEnt?.plan?.permanent === true && !wsEnt?.planExpiresAt, `permanent=${wsEnt?.plan?.permanent}, expiresAt=${wsEnt?.planExpiresAt}`)
}

line('===== B. 会员特权：修改分享有效期 =====')
{
  const future = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10)
  const rFree = await api('PATCH', '/api/shares/manage/mtok_free', null, { expiresAt: future })
  check('基础版改有效期 → 403', rFree.status === 403, `${rFree.status} ${rFree.body?.message || ''}`)
  const rMember = await api('PATCH', '/api/shares/manage/mtok_member', null, { expiresAt: future })
  check('★ 有效期内会员改有效期 → 200', rMember.status === 200, `${rMember.status} ${rMember.body?.message || ''}`)
  const rExp = await api('PATCH', '/api/shares/manage/mtok_member_exp', null, { expiresAt: future })
  check('★ 过期会员改有效期 → 403（特权随回落收回）', rExp.status === 403, `${rExp.status} ${rExp.body?.message || ''}`)
  const rEnt = await api('PATCH', '/api/shares/manage/mtok_ent', null, { expiresAt: future })
  check('企业版改有效期 → 200', rEnt.status === 200, `${rEnt.status}`)
}

line('===== C. 永久特权：永久分享仅限 permanent 权益 =====')
{
  const rMember = await api('PATCH', '/api/shares/manage/mtok_member', null, { expiresAt: 'permanent' })
  check('★ 有效期内会员开永久分享 → 403（企业版专属）', rMember.status === 403, `${rMember.status} ${rMember.body?.message || ''}`)
  const rEnt = await api('PATCH', '/api/shares/manage/mtok_ent', null, { expiresAt: 'permanent' })
  check('企业版开永久分享 → 200', rEnt.status === 200, `${rEnt.status}`)
}

line('===== D. canReopen 与特权同口径（owner 登录视图） =====')
{
  const dFree = (await api('GET', '/api/shares/token/sh_free', 'kunqiong_session=sess_free')).body
  check('基础版 canReopen = false', dFree?.share?.canReopen === false, `canReopen=${dFree?.share?.canReopen}`)
  const dMember = (await api('GET', '/api/shares/token/sh_member', 'kunqiong_session=sess_member')).body
  check('★ 有效期内会员 canReopen = true', dMember?.share?.canReopen === true, `canReopen=${dMember?.share?.canReopen}`)
  const dExp = (await api('GET', '/api/shares/token/sh_member_exp', 'kunqiong_session=sess_member_exp')).body
  check('★ 过期会员 canReopen = false', dExp?.share?.canReopen === false, `canReopen=${dExp?.share?.canReopen}`)
  const dEnt = (await api('GET', '/api/shares/token/sh_ent', 'kunqiong_session=sess_ent')).body
  check('企业版 canReopen = true', dEnt?.share?.canReopen === true, `canReopen=${dEnt?.share?.canReopen}`)
}

line('===== E. 开通授予（admin 设订阅有效期 → payload 保真） =====')
{
  const login = await api('POST', '/api/admin/login', null, { username: 'ljxkjadmin', password: process.env.KUNQIONG_ADMIN_PASSWORD })
  const setCookie = login.body ? null : null
  // admin 会话 cookie 从响应头取
  const res = await fetch(BASE + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'ljxkjadmin', password: process.env.KUNQIONG_ADMIN_PASSWORD }) })
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0]
  check('管理员登录', res.status === 200, `${res.status}`)
  const in30d = new Date(Date.now() + 30 * 86400000).toISOString()
  const patch = await api('PATCH', `/api/admin/users/${FREE_ID}`, cookie, { planId: 'member', planExpiresAt: in30d })
  check('★ admin 授予 member + 30天有效期', patch.status === 200 && patch.body?.user?.planId === 'member', `${patch.status} plan=${patch.body?.user?.planId}`)
  check('★ 授予后 planExpiresAt 保真（未被强抹）', patch.body?.user?.planExpiresAt === in30d, `${patch.body?.user?.planExpiresAt}`)
  const ws = (await api('GET', '/api/account/workspace', 'kunqiong_session=sess_free')).body
  check('★ 授予后工作台等级 = 会员版 且有效期在未来', ws?.plan?.id === 'member' && new Date(ws?.planExpiresAt || 0).getTime() > Date.now(), `plan=${ws?.plan?.id}, expiresAt=${ws?.planExpiresAt}`)
}

console.log(`\n结果：${pass}/${pass + fail} 通过`)
if (fail > 0) { console.log('【结论】存在失败项，需排查'); process.exit(1) }
console.log('【结论】订阅制对齐生效：等级/有效期/回落/两级特权全部符合预期')
process.exit(0)
