// 精准复现：重启时 normalizeMetadata → normalizeAccountUserStore 是否丢失自定义头像
// 关键疑点：normalizeAccountUserStore 会把 **session.user**（publicUser 快照）也 merge 进 users。
import fs from 'node:fs'
import { join } from 'node:path'

const ROOT = 'C:\\Users\\admin\\Desktop\\鲲穹文件传输web'
const LOG = join(ROOT, '_avatar_restart.txt')
const out = []
let pass = 0, fail = 0
const line = (s) => { out.push(s); try { fs.writeFileSync(LOG, out.join('\n')) } catch {} }
const check = (n, c, d) => { c ? pass++ : fail++; line(`  ${c ? 'PASS' : 'FAIL'}  ${n}${d !== undefined ? ' — ' + d : ''}`) }

const src = fs.readFileSync(join(ROOT, 'server.mjs'), 'utf8')

// —— 从 server.mjs 里抽取真实实现，避免"复刻逻辑"导致的偏差 ——
const grab = (name, kind = 'function') => {
  const i = src.indexOf(`\n${kind} ${name}(`)
  if (i < 0) throw new Error('找不到 ' + name)
  // 注意：函数签名可能跨行（参数默认值后换行再接 `{`），所以要从签名末尾往后找首个 `{`
  const sigEnd = src.indexOf(')', i)
  let s = src.indexOf('{', sigEnd), depth = 0, j = s
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}') { depth--; if (!depth) break }
  }
  return src.slice(i + 1, j + 1)
}

// 把这些函数拼成一个可执行模块（剥离对全局 metadata 等的依赖，用最小桩）
const CUSTOM = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const PROV = 'https://provider.example.com/avatar.png'

const code = `
const metadata = {}
let metadataNeedsPersist = false
const testEnterpriseForAllUsers = false
const testEnforceEnterpriseAllowlist = false
const TEST_ENTERPRISE_USER_KEYS = new Set()
const DEFAULT_FILE_CLEANUP_SETTINGS = { enabled: false, ttlDays: 0 }
const configuredAccountPlan = (id) => ({ id, permanent: id === 'enterprise' })
const accountUserById = () => null
const accountUserIdForTarget = () => ''
const accountOrganizationForUser = () => null
const accountPersonalPlanForUser = () => ({ id: 'free' })
const accountTeamEntitlementForUser = () => ({ id: 'free' })
const accountUsageForUser = () => ({})
const accountBenefitsForUser = () => []
const organizationTeamSpaceBytes = () => 0
const publicOrganization = () => null
const accountNotificationSettingsForUser = () => ({})
const hashSecret = (v) => 'h' + String(v || '').length
const trimRecordString = (v, n) => String(v ?? '').trim().slice(0, n)
const normalizeRecordDate = (v) => v || null
const mergeLoginMethods = (a = [], b = []) => Array.from(new Set([...(a||[]), ...(b||[])]))
const normalizeEmailValue = (v) => String(v||'').trim().toLowerCase()
const normalizePhoneValue = (v) => String(v||'').replace(/[^\\d]/g,'')
const normalizeFileCleanupSettings = (v) => v || {}
const normalizePlanId = (v) => v || 'free'

${grab('publicUser')}

${grab('normalizeAccountUser')}

${grab('mergeAccountUser')}

${grab('normalizeAccountUserStore')}

export { publicUser, normalizeAccountUser, mergeAccountUser, normalizeAccountUserStore }
`
fs.writeFileSync(join(ROOT, '_avatar_extract.mjs'), code)

const M = await import(`file:///${join(ROOT, '_avatar_extract.mjs').replace(/\\/g, '/')}`)

line('===== 重启归一化：头像是否丢失 =====')

line('-- 场景 A：用户表已存自定义头像，会话快照也带自定义头像 --')
{
  const stored = {
    id: 'u1', username: 'tester', nickname: '测试', email: 't@test.com',
    avatar: CUSTOM, avatarSource: 'custom', providerAvatar: PROV, provider: 'kunqiong',
    planId: 'free', status: 'active',
  }
  const sessionUser = M.publicUser(stored)   // 登录时写入会话的快照
  line(`    会话快照：avatarSource=${JSON.stringify(sessionUser.avatarSource)} avatar=${(sessionUser.avatar||'').slice(0,30)} providerAvatar=${(sessionUser.providerAvatar||'').slice(0,40)}`)
  const session = { id: 's1', user: sessionUser, expiresAt: Date.now() + 1e7 }
  const sessions = [session]
  const store = M.normalizeAccountUserStore({ u1: stored }, sessions)
  check('★ 归一化后 avatar 仍为自定义图', store.u1?.avatar === CUSTOM, (store.u1?.avatar || '').slice(0, 40))
  check('★ 归一化后 avatarSource 仍为 custom', store.u1?.avatarSource === 'custom', JSON.stringify(store.u1?.avatarSource))
  check('会话快照未被污染', session.user.avatar === CUSTOM, (session.user.avatar || '').slice(0, 40))
}

line('-- 场景 B：会话快照缺失 avatarSource（历史会话/旧数据）--')
{
  const stored = {
    id: 'u2', username: 'tester2', nickname: '测试2', email: 't2@test.com',
    avatar: CUSTOM, avatarSource: 'custom', providerAvatar: PROV, provider: 'kunqiong',
    planId: 'free', status: 'active',
  }
  // 模拟一个"旧会话"：当时 publicUser 还没写 avatarSource 字段
  const legacySessionUser = {
    id: 'u2', username: 'tester2', nickname: '测试2', email: 't2@test.com',
    avatar: PROV, providerAvatar: PROV, provider: 'kunqiong',   // 注意：这里是 provider 头像
  }
  const session = { id: 's2', user: legacySessionUser, expiresAt: Date.now() + 1e7 }
  const store = M.normalizeAccountUserStore({ u2: stored }, [session])
  line(`    结果：avatarSource=${JSON.stringify(store.u2?.avatarSource)} avatar=${(store.u2?.avatar||'').slice(0,32)}`)
  check('★ 旧会话快照不得覆盖已保存的自定义头像', store.u2?.avatar === CUSTOM, (store.u2?.avatar || '').slice(0, 40))
  check('★ avatarSource 仍为 custom', store.u2?.avatarSource === 'custom', JSON.stringify(store.u2?.avatarSource))
}

line('-- 场景 C：会话快照带 avatarSource:"" 且 avatar 为 provider 图 --')
{
  const stored = {
    id: 'u3', username: 'tester3', nickname: '测试3', email: 't3@test.com',
    avatar: CUSTOM, avatarSource: 'custom', providerAvatar: PROV, provider: 'kunqiong',
    planId: 'free', status: 'active',
  }
  const sessUser = {
    id: 'u3', username: 'tester3', nickname: '测试3', email: 't3@test.com',
    avatar: PROV, avatarSource: '', providerAvatar: PROV, provider: 'kunqiong',
  }
  const session = { id: 's3', user: sessUser, expiresAt: Date.now() + 1e7 }
  const store = M.normalizeAccountUserStore({ u3: stored }, [session])
  line(`    结果：avatarSource=${JSON.stringify(store.u3?.avatarSource)} avatar=${(store.u3?.avatar||'').slice(0,32)}`)
  check('★ 显式 avatarSource:"" 的会话快照不得抹掉自定义头像', store.u3?.avatar === CUSTOM, (store.u3?.avatar || '').slice(0, 40))
}

line('-- 场景 D：用户重新上传头像（必须能覆盖旧自定义图）--')
{
  const NEW = CUSTOM.replace('iVBORw0KGgo', 'iVBORw0KGgo')
  const stored = {
    id: 'u4', username: 'tester4', nickname: '测试4', email: 't4@test.com',
    avatar: 'data:image/png;base64,OLDOLDOLD', avatarSource: 'custom', providerAvatar: PROV, provider: 'kunqiong',
    planId: 'free', status: 'active',
  }
  const store = M.normalizeAccountUserStore({ u4: stored }, [])
  const merged = M.mergeAccountUser(store.u4, { id: 'u4', avatar: CUSTOM, avatarSource: 'custom' })
  check('★ 重新上传能覆盖为新的自定义图', merged.avatar === CUSTOM, (merged.avatar || '').slice(0, 34))
  check('★ avatarSource 仍为 custom', merged.avatarSource === 'custom', JSON.stringify(merged.avatarSource))
}

line('-- 场景 E：用户点「恢复登录头像」（avatar:null）必须真的回落 provider --')
{
  const stored = {
    id: 'u5', username: 'tester5', nickname: '测试5', email: 't5@test.com',
    avatar: CUSTOM, avatarSource: 'custom', providerAvatar: PROV, provider: 'kunqiong',
    planId: 'free', status: 'active',
  }
  const store = M.normalizeAccountUserStore({ u5: stored }, [])
  const merged = M.mergeAccountUser(store.u5, { id: 'u5', avatar: null, avatarSource: '', avatarRestoreRequested: true })
  check('★ 恢复后 avatar 回落 provider 头像', merged.avatar === PROV, (merged.avatar || '').slice(0, 40))
  check('★ avatarSource 清空', merged.avatarSource === '', JSON.stringify(merged.avatarSource))
  check('providerAvatar 仍保留', merged.providerAvatar === PROV, (merged.providerAvatar || '').slice(0, 40))
  check('★ 内部标记不落库', !Object.prototype.hasOwnProperty.call(merged, 'avatarRestoreRequested')
    || merged.avatarRestoreRequested === undefined,
    JSON.stringify(merged.avatarRestoreRequested))
}

line('-- 场景 F：重新登录（OAuth 快照带 provider 头像，无 avatarSource 键）--')
{
  const stored = {
    id: 'u6', username: 'tester6', nickname: '测试6', email: 't6@test.com',
    avatar: CUSTOM, avatarSource: 'custom', providerAvatar: PROV, provider: 'kunqiong',
    planId: 'free', status: 'active',
  }
  const store = M.normalizeAccountUserStore({ u6: stored }, [])
  // 上游 OAuth 只给 avatar，不给 avatarSource
  const merged = M.mergeAccountUser(store.u6, { id: 'u6', avatar: PROV, providerAvatar: PROV, provider: 'kunqiong', nickname: '测试6' })
  check('★ 重新登录后自定义头像不丢', merged.avatar === CUSTOM, (merged.avatar || '').slice(0, 34))
  check('★ avatarSource 仍为 custom', merged.avatarSource === 'custom', JSON.stringify(merged.avatarSource))
  check('providerAvatar 被刷新（保留上游最新值）', merged.providerAvatar === PROV, (merged.providerAvatar || '').slice(0, 40))
}

line('-- 场景 G：普通用户（从未自定义）不受影响 --')
{
  const stored = {
    id: 'u7', username: 'tester7', nickname: '测试7', email: 't7@test.com',
    avatar: PROV, avatarSource: '', providerAvatar: PROV, provider: 'kunqiong',
    planId: 'free', status: 'active',
  }
  const store = M.normalizeAccountUserStore({ u7: stored }, [])
  const merged = M.mergeAccountUser(store.u7, { id: 'u7', avatar: PROV, avatarSource: '', nickname: '测试7' })
  check('普通用户仍是 provider 头像', merged.avatar === PROV, (merged.avatar || '').slice(0, 40))
  check('avatarSource 保持空', merged.avatarSource === '', JSON.stringify(merged.avatarSource))
}

console.log(out.join('\n'))
line(`\n结果：${pass}/${pass + fail} 通过`)
fs.writeFileSync(LOG, out.join('\n'))
process.exit(fail ? 1 : 0)
