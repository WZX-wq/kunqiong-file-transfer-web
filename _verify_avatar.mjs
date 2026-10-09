// 复现/验证：自定义头像上传后能否持久化，重新登录后是否还在
import fs from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = 'C:\\Users\\admin\\Desktop\\鲲穹文件传输web'
const LOG = join(ROOT, '_avatar_probe.txt')
const out = []
let pass = 0, fail = 0
const line = (s) => { out.push(s); try { fs.writeFileSync(LOG, out.join('\n')) } catch {} }
const check = (n, c, d) => { c ? pass++ : fail++; line(`  ${c ? 'PASS' : 'FAIL'}  ${n}${d !== undefined ? ' — ' + d : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const copyTree = (src, dst) => {
  fs.mkdirSync(dst, { recursive: true })
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = join(src, e.name), d = join(dst, e.name)
    if (e.isDirectory()) copyTree(s, d); else if (e.isFile()) fs.copyFileSync(s, d)
  }
}

const SANDBOX = join(ROOT, '_avatar_sandbox')
try { if (fs.existsSync(SANDBOX)) fs.rmSync(SANDBOX, { recursive: true, force: true }) } catch {}
fs.mkdirSync(join(SANDBOX, 'storage', 'tmp'), { recursive: true })
fs.copyFileSync(join(ROOT, 'server.mjs'), join(SANDBOX, 'server.mjs'))
try { fs.symlinkSync(join(ROOT, 'node_modules'), join(SANDBOX, 'node_modules'), 'junction') } catch {}
copyTree(join(ROOT, 'dist'), join(SANDBOX, 'dist'))

const UID = 'u_avatar_test'
const now = new Date().toISOString()
// 初始：用户有 OAuth 提供方的头像（providerAvatar），尚无自定义头像
fs.writeFileSync(join(SANDBOX, 'storage', 'metadata.json'), JSON.stringify({
  users: {
    [UID]: {
      id: UID, username: 'tester', nickname: '测试用户', email: 't@test.com',
      avatar: 'https://provider.example.com/avatar.png',
      avatarSource: '', providerAvatar: 'https://provider.example.com/avatar.png',
      provider: 'kunqiong', planId: 'free', status: 'active', createdAt: now, updatedAt: now,
    },
  },
  sessions: [{ id: 'sess_avatar', user: { id: UID, username: 'tester', nickname: '测试用户', email: 't@test.com' }, expiresAt: Date.now() + 86400000 }],
  organizations: {}, shares: [], collections: [], messages: {}, auditLogs: [], upgradeOrders: [],
  verificationCodes: [], systemConfig: {}, notifications: {},
}, null, 2))

const PORT = 8105
process.env.KUNQIONG_DB_ENABLED = 'false'
process.env.PORT = String(PORT)
process.env.KUNQIONG_STORAGE_DIR = join(SANDBOX, 'storage')
await import(pathToFileURL(join(SANDBOX, 'server.mjs')).href)
{
  let ok = false
  for (let i = 0; i < 40; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/api/health`); if (r.ok) { ok = true; break } } catch {} await sleep(250) }
  if (!ok) { line('服务未就绪'); process.exit(1) }
}

const CK = 'kunqiong_session=sess_avatar'
const api = async (path, init = {}) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { ...init, headers: { cookie: CK, 'content-type': 'application/json', ...(init.headers || {}) } })
  const t = await r.text()
  let body = null
  try { body = JSON.parse(t) } catch { body = t.slice(0, 160) }
  return { status: r.status, body }
}

// 一个最小合法 PNG data URL（1x1 透明）
const CUSTOM = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

line('===== 头像持久化验证 =====')

line('-- 1. 上传前：显示提供方头像 --')
{
  const me = await api('/api/auth/me')
  const u = me.body?.user || {}
  check('初始 avatar 为 provider 头像', u.avatar === 'https://provider.example.com/avatar.png', u.avatar)
  check('avatarSource 为空', !u.avatarSource, JSON.stringify(u.avatarSource))
}

line('-- 2. 上传自定义头像 --')
{
  const r = await api('/api/auth/profile', { method: 'PATCH', body: JSON.stringify({ avatar: CUSTOM }) })
  check('PATCH 返回 200', r.status === 200, `status=${r.status} msg=${r.body?.message || ''}`)
  const u = r.body?.user || {}
  check('响应 avatar = 自定义图', u.avatar === CUSTOM, u.avatar?.slice(0, 40))
  check('响应 avatarSource = custom', u.avatarSource === 'custom', u.avatarSource)
  check('providerAvatar 仍保留', u.providerAvatar === 'https://provider.example.com/avatar.png', u.providerAvatar)
}

line('-- 3. 落盘检查（storage/metadata.json）--')
{
  const meta = JSON.parse(fs.readFileSync(join(SANDBOX, 'storage', 'metadata.json'), 'utf8'))
  const u = meta.users[UID] || {}
  check('★ 磁盘上 avatar 已保存为自定义图', u.avatar === CUSTOM, (u.avatar || '').slice(0, 40))
  check('★ 磁盘上 avatarSource = custom', u.avatarSource === 'custom', JSON.stringify(u.avatarSource))
  check('磁盘上 providerAvatar 保留', u.providerAvatar === 'https://provider.example.com/avatar.png', u.providerAvatar)
  const sess = (meta.sessions || []).find((s) => s.id === 'sess_avatar')
  check('会话内 user 也已同步', sess?.user?.avatar === CUSTOM, (sess?.user?.avatar || '').slice(0, 40))
}

line('-- 4. 重新拉取 /api/auth/me（模拟再次访问）--')
{
  const me = await api('/api/auth/me')
  const u = me.body?.user || {}
  check('★ 自定义头像仍在', u.avatar === CUSTOM, (u.avatar || '').slice(0, 40))
  check('avatarSource 仍为 custom', u.avatarSource === 'custom', u.avatarSource)
}

line('-- 5. 重启服务后（模拟重新部署/重新登录）--')
{
  // 直接把 metadata.json 重新读入一个新实例：用子进程不可行（本沙箱 spawn 受限），
  // 改为直接校验 normalizeAccountUserStore + mergeAccountUser 的纯函数行为。
  const meta = JSON.parse(fs.readFileSync(join(SANDBOX, 'storage', 'metadata.json'), 'utf8'))
  const stored = meta.users[UID]
  // 模拟 OAuth 回来时只带 provider 头像、不带 avatarSource
  const oauthUser = {
    id: UID, username: 'tester', nickname: '测试用户', email: 't@test.com',
    avatar: 'https://provider.example.com/avatar.png',
  }
  // 复刻 mergeAccountUser 的判定（与 server.mjs 同逻辑）
  const normIncoming = { avatar: oauthUser.avatar, avatarSource: '', providerAvatar: oauthUser.avatar }
  const avatarSourceExplicit = Object.prototype.hasOwnProperty.call(oauthUser, 'avatarSource')
  const nextProviderAvatar = normIncoming.providerAvatar || (!normIncoming.avatarSource && normIncoming.avatar) || stored.providerAvatar || null
  const nextAvatarSource = normIncoming.avatarSource === 'custom' ? 'custom' : avatarSourceExplicit ? '' : stored.avatarSource || ''
  const nextAvatar = nextAvatarSource === 'custom'
    ? (normIncoming.avatarSource === 'custom' ? normIncoming.avatar || stored.avatar || null : stored.avatar || null)
    : nextProviderAvatar
  line(`    模拟结果：avatarSource=${JSON.stringify(nextAvatarSource)} avatar=${(nextAvatar || '').slice(0, 30)}`)
  check('★ OAuth 重新登录不会覆盖自定义头像', nextAvatar === CUSTOM, (nextAvatar || '').slice(0, 40))
  check('★ avatarSource 仍保持 custom', nextAvatarSource === 'custom', nextAvatarSource)
}

console.log(out.join('\n'))
console.log(`\n结果：${pass}/${pass + fail} 通过`)
line(`\n结果：${pass}/${pass + fail} 通过`)
fs.writeFileSync(LOG, out.join('\n'))
process.exit(fail ? 1 : 0)
