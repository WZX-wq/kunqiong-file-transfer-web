// 审计 P0 复现：团队成员能否拿到团队内【他人】分享的 manageToken，并凭 token 无登录管理他人分享
// 流程：owner(593) 经分片上传造一条 team_resource 分享 → member(13) 拉 overview 看是否带 manageToken
//       → 无登录态用该 token GET /api/shares/manage/:token → 结束后还原 metadata + 清理新增目录
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = 'C:\\Users\\admin\\Desktop\\鲲穹文件传输web'
const NODE = process.execPath
const PORT = '8199'
const BASE = `http://127.0.0.1:${PORT}`

// 记录启动前的文件目录快照，结束时清理新增项
const filesDir = path.join(ROOT, 'storage', 'files')
const tmpSessionsDir = path.join(ROOT, 'storage', 'tmp', 'upload-sessions')
const snap = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
const beforeFiles = new Set(snap(filesDir))
const beforeTmp = new Set(snap(tmpSessionsDir))

const env = {
  ...process.env,
  PORT,
  NODE_ENV: 'test',
  KUNQIONG_DB_ENABLED: 'false',
  KUNQIONG_TEST_ENFORCE_ENTERPRISE_ALLOWLIST: 'false',
}
const srv = spawn(NODE, ['server.mjs'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })
let srvLog = ''
srv.stdout.on('data', (d) => { srvLog += d })
srv.stderr.on('data', (d) => { srvLog += d })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitHealth() {
  for (let i = 0; i < 60; i += 1) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return } catch {}
    await sleep(500)
  }
  throw new Error('server not up\n' + srvLog.slice(-2000))
}
const cookieOf = (res) => (res.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ')

let fail = 0
const check = (name, ok, extra = '') => {
  if (!ok) fail += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
}

try {
  await waitHealth()
  const adminRes = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'ljxkjadmin', password: process.env.KUNQIONG_ADMIN_PASSWORD }),
  })
  const adminCookie = cookieOf(adminRes)
  if (adminRes.status !== 200) throw new Error('admin login failed')
  const impersonate = async (userId) => {
    const r = await fetch(`${BASE}/api/admin/impersonate`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ userId }),
    })
    const b = await r.json()
    if (r.status !== 200 || !b.sessionId) throw new Error(`impersonate ${userId} failed`)
    return `kunqiong_session=${b.sessionId}`
  }

  // 1) 所有者上传一条团队资源
  const ownerCookie = await impersonate('593')
  const content = 'audit-leak-test'
  const createRes = await fetch(`${BASE}/api/upload-sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: ownerCookie },
    body: JSON.stringify({ mode: 'team_resource', expiryDays: '0', files: [{ name: 'audit-test.txt', size: content.length, mimeType: 'text/plain' }] }),
  })
  const createJson = await createRes.json().catch(() => ({}))
  check('所有者创建团队上传会话', createRes.status === 201, `status=${createRes.status} ${createJson.message || ''}`)
  const { sessionId } = createJson
  const fd = new FormData()
  fd.append('fileIndex', '0'); fd.append('chunkIndex', '0'); fd.append('totalChunks', '1')
  fd.append('chunk', new Blob([content]), 'part')
  const chunkRes = await fetch(`${BASE}/api/upload-sessions/${sessionId}/chunks`, { method: 'POST', headers: { cookie: ownerCookie }, body: fd })
  check('分片上传', chunkRes.status === 200, `status=${chunkRes.status}`)
  const compRes = await fetch(`${BASE}/api/upload-sessions/${sessionId}/complete`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: ownerCookie }, body: '{}' })
  const compJson = await compRes.json().catch(() => ({}))
  check('完成合并', compRes.status === 201, `status=${compRes.status} ${compJson.message || ''}`)

  // 2) 普通成员拉团队概览
  const memberCookie = await impersonate('13')
  const ov = await (await fetch(`${BASE}/api/account/team/overview`, { headers: { cookie: memberCookie } })).json()
  const resources = ov.resources || []
  const others = resources.filter((r) => r.ownerUserId !== '13')
  console.log(`   概览共 ${resources.length} 条资源，其中他人(${others.map((r) => r.ownerUserId).join(',') || '无'}) ${others.length} 条`)
  check('成员概览包含他人团队分享', others.length >= 1, '预期含 owner=593 的新分享')

  const leaked = others.find((r) => r.manageToken)
  check('他人分享的 manageToken 被下发给普通成员(越权泄漏)', Boolean(leaked),
    leaked ? `owner=${leaked.ownerUserId} token=${String(leaked.manageToken).slice(0, 10)}…` : '未泄漏')

  // 3) 危害验证：无登录态凭 token 读取他人分享管理数据
  if (leaked) {
    const mg = await fetch(`${BASE}/api/shares/manage/${leaked.manageToken}`)
    const mgBody = await mg.json().catch(() => ({}))
    check('无登录凭 manageToken 可读取他人分享管理数据', mg.status === 200, `status=${mg.status}`)
    check('可看到他人文件名等隐私信息', Array.isArray(mgBody.share?.files) && mgBody.share.files.length >= 1,
      (mgBody.share?.files || []).map((f) => f.name).join(','))
  }
} catch (err) {
  fail += 1
  console.log('FAIL 审计脚本异常 —', err.message)
} finally {
  try {
    srv.kill('SIGKILL')
  } catch {}
  await sleep(800)
  // 还原 metadata（本次审计写入了会话/分享），并清理新增的文件目录
  try {
    fs.copyFileSync(path.join(ROOT, 'storage', 'metadata.json.auditbak'), path.join(ROOT, 'storage', 'metadata.json'))
    console.log('metadata.json 已还原为审计前备份')
  } catch (e) { console.log('metadata 还原失败:', e.message) }
  for (const name of snap(filesDir)) if (!beforeFiles.has(name)) fs.rmSync(path.join(filesDir, name), { recursive: true, force: true })
  for (const name of snap(tmpSessionsDir)) if (!beforeTmp.has(name)) fs.rmSync(path.join(tmpSessionsDir, name), { recursive: true, force: true })
  console.log('storage 新增目录已清理')
  console.log(`\n结果: FAIL=${fail}`)
  process.exit(fail ? 1 : 0)
}
