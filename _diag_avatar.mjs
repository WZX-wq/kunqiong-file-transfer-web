// 诊断：线上/本地 /api/auth/me 实际下发的头像字段，找出为何 settings 页显示
// 「优先显示自定义头像；未上传时使用微信或 QQ 登录头像」且仍无默认头像。
import fs from 'node:fs'
import path from 'node:path'

const ROOT = 'C:\\Users\\admin\\Desktop\\鲲穹文件传输web'
const NODE = 'C:/Users/admin/.workbuddy/binaries/node/versions/22.22.2-3/node.exe'
const SANDBOX = path.join(ROOT, '_avatar_diag_sandbox')
const PORT = 8107
const LOG = path.join(ROOT, '_avatar_diag.txt')

const out = []
const line = (s) => { out.push(s); fs.writeFileSync(LOG, out.join('\n')) }

fs.rmSync(SANDBOX, { recursive: true, force: true })
fs.mkdirSync(path.join(SANDBOX, 'storage'), { recursive: true })
fs.copyFileSync(path.join(ROOT, 'server.mjs'), path.join(SANDBOX, 'server.mjs'))
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(SANDBOX, 'node_modules'), 'junction')

// 复刻你截图里的用户：有 provider 头像（kunqiong 默认图）、无 avatarSource
const PROVIDER_URL = 'https://image.kunqiongai.com/avatar/touxiang.jpg'
const UID = 'u_diag'
const SID = 'sess_diag'
const now = new Date().toISOString()
fs.writeFileSync(path.join(SANDBOX, 'storage', 'metadata.json'), JSON.stringify({
  users: {
    [UID]: {
      id: UID, username: 'zhanlinhai_qq', nickname: '占林海',
      email: '266377173@qq.com', phone: '15212345678',
      avatar: PROVIDER_URL, avatarSource: '', providerAvatar: PROVIDER_URL,
      provider: '', loginMethods: ['oauth'],
      planId: 'enterprise', planStartedAt: now, planExpiresAt: null,
      organizationId: '', organizationRole: '', status: 'active',
      fileCleanup: { enabled: false, days: 7 }, createdAt: now, updatedAt: now,
    },
  },
  sessions: [{ id: SID, expiresAt: new Date(Date.now() + 86400000).toISOString(), createdAt: now, apiWebToken: '', user: { id: UID } }],
  organizations: {}, shares: [], collections: [], messages: [], auditLogs: [],
  uploadSessions: {}, membershipOrders: [], joinRequests: [],
}, null, 2))

const { spawn } = await import('node:child_process')
const child = spawn(NODE, ['server.mjs'], {
  cwd: SANDBOX, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', KUNQIONG_DB_ENABLED: 'false', NODE_ENV: 'production' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
const ready = await new Promise((resolve, reject) => {
  const t0 = Date.now()
  const tick = setInterval(async () => {
    if (Date.now() - t0 > 20000) { clearInterval(tick); reject(new Error('启动超时')) }
    try { if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok) { clearInterval(tick); resolve(true) } } catch {}
  }, 250)
})
line('沙箱服务已就绪')

const me = await (await fetch(`http://127.0.0.1:${PORT}/api/auth/me`, { headers: { Cookie: `kunqiong_session=${SID}` } })).json()
line('===== /api/auth/me 下发的头像相关字段 =====')
line('  avatar        = ' + String(me.user?.avatar || '(空)'))
line('  avatarSource  = ' + JSON.stringify(me.user?.avatarSource))
line('  providerAvatar= ' + String(me.user?.providerAvatar || '(空)'))
line('  provider      = ' + JSON.stringify(me.user?.provider))

// 复刻前端 userAvatarSource 的选择过程
const u = me.user || {}
const src = (() => {
  if (u.avatarSource === 'custom' && u.avatar) return 'custom:' + u.avatar
  if (u.providerAvatar || u.avatar) return 'provider/avatar:' + (u.providerAvatar || u.avatar)
  return '(无图 → 渲染首字母)'
})()
line('')
line('===== 前端 userAvatarSource 判定结果 =====')
line('  → ' + String(src).slice(0, 90))

// 截图里那条提示的显示条件：user.avatarSource === 'custom'
line('')
line('===== 关键判定 =====')
line('  「恢复登录头像」按钮是否显示（条件 avatarSource==="custom"）: ' + (u.avatarSource === 'custom'))
line('  提示文案里的兜底是否成立（provider 头像存在）: ' + Boolean(u.providerAvatar || u.avatar))
line('  provider 字段是否可识别微信/QQ: ' + (u.provider ? 'yes:' + u.provider : 'no（为空，无法判断渠道）'))

child.kill('SIGTERM')
setTimeout(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }) } catch {} ; process.exit(0) }, 800)
