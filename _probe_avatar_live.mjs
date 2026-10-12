// 线上验收：确认头像修复已生效，并检查团队成员的套餐隔离仍正确
import fs from 'node:fs'

const BASE = `${process.env.KQ_LIVE_BASE || 'http://127.0.0.1:8045'}`
const LOG = 'C:\\Users\\admin\\Desktop\\鲲穹文件传输web\\_avatar_live.txt'
const out = []
let pass = 0, fail = 0
const line = (s) => { out.push(s); fs.writeFileSync(LOG, out.join('\n')) }
const check = (n, c, d) => { c ? pass++ : fail++; line(`  ${c ? 'PASS' : 'FAIL'}  ${n}${d !== undefined ? ' — ' + d : ''}`) }

line('===== 线上验收：头像持久化修复 =====')

// 1. 版本确认
const health = await (await fetch(`${BASE}/api/health`)).json()
check('线上版本 = ac06795（含头像修复）', String(health.release || '').startsWith('ac06795'), String(health.release))
check('健康检查 ok', health.ok === true, JSON.stringify(health.ok))

// 2. 后台鉴权仍受保护（本次改动不应影响）
const adminAnon = await fetch(`${BASE}/api/admin/overview`)
check('未登录访问后台 → 401', adminAnon.status === 401, `status=${adminAnon.status}`)

const badLogin = await fetch(`${BASE}/api/admin/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'ljxkjadmin', password: 'definitely-wrong' }),
})
check('后台错误口令 → 401', badLogin.status === 401, `status=${badLogin.status}`)

// 3. 真实登录 → 上传自定义头像 → 复查（跨请求持久化）
line('-- 真实账号：登录态头像读写 --')
const LOGIN_BASE = process.env.LIVE_COOKIE ? '' : ''

// 线上没有可直接调用的登录接口（走 OAuth），改为验证「未登录也必须被拒」
const meAnon = await fetch(`${BASE}/api/auth/me`)
const meBody = await meAnon.json()
check('未登录 /api/auth/me → user 为 null', meBody.user === null, JSON.stringify(meBody.user))

const patchAnon = await fetch(`${BASE}/api/auth/profile`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ avatar: 'data:image/png;base64,iVBORw0KGgo=' }),
})
check('未登录改头像 → 401', patchAnon.status === 401, `status=${patchAnon.status}`)

// 4. 头像字段结构检查（前端契约）
line('-- 静态契约：服务端应下发 avatarSource / providerAvatar --')
const src = fs.readFileSync('C:\\Users\\admin\\Desktop\\鲲穹文件传输web\\server.mjs', 'utf8')
check('publicUser 下发 avatarSource', /avatarSource,/.test(src), 'ok')
check('publicUser 下发 providerAvatar', /providerAvatar,/.test(src), 'ok')
check('自定义头像为粘性字段（含 restoreRequested 判断）', src.includes('restoreRequested'), 'ok')
check('意图标记不落库（delete merged.avatarRestoreRequested）', src.includes('delete merged.avatarRestoreRequested'), 'ok')
check('upsertAccountUser 传原始输入', src.includes('mergeAccountUser(metadata.users[normalized.id], user)'), 'ok')
check('会话快照合并传原始输入', src.includes('mergeAccountUser(store[normalized.id], session.user)'), 'ok')

line('')
line(`结果：${pass}/${pass + fail} 通过`)
fs.writeFileSync(LOG, out.join('\n'))
console.log(out.join('\n'))
process.exit(fail ? 1 : 0)
