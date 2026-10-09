// 回归验收：团队概览不再把他人分享的 manageToken 泄漏给普通成员
//
// 修复前：GET /api/account/team/overview 的 resources 无条件下发团队内所有分享的
//         manageToken/manageUrl，而 /api/shares/manage/:manageToken 是 bearer 凭证
//         （不校验登录身份）→ 成员可越权查看/改密/删除他人分享。
// 修复后：仅 canManage（团队所有者）的概览带 manageToken；普通成员资源行只有展示字段。
//
// 覆盖：
//   1) 所有者上传团队资源 → 普通成员拉概览：他人资源【不含】manageToken/manageUrl
//   2) 所有者自己拉概览：自己资源【仍含】manageToken（所有者功能不受影响）
//   3) 所有者的 manageToken 无登录可访问管理接口（bearer 语义保留，合法场景不变）
//   4) 结束后自动还原 metadata + 清理新增文件目录
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = 'C:\\Users\\admin\\Desktop\\鲲穹文件传输web'
const NODE = process.execPath
const PORT = '8199'
const BASE = `http://127.0.0.1:${PORT}`

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

let pass = 0, fail = 0
const check = (name, ok, extra = '') => {
  if (ok) pass += 1; else fail += 1
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`)
}

try {
  await waitHealth()
  const adminRes = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'ljxkjadmin', password: 'jxljxkj009900' }),
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
  const content = 'leak-regression-test'
  const createRes = await fetch(`${BASE}/api/upload-sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: ownerCookie },
    body: JSON.stringify({ mode: 'team_resource', expiryDays: '0', files: [{ name: 'leak-test.txt', size: content.length, mimeType: 'text/plain' }] }),
  })
  const createJson = await createRes.json().catch(() => ({}))
  if (createRes.status !== 201) throw new Error(`创建团队上传会话失败: ${createRes.status} ${createJson.message || ''}`)
  const fd = new FormData()
  fd.append('fileIndex', '0'); fd.append('chunkIndex', '0'); fd.append('totalChunks', '1')
  fd.append('chunk', new Blob([content]), 'part')
  const chunkRes = await fetch(`${BASE}/api/upload-sessions/${createJson.sessionId}/chunks`, { method: 'POST', headers: { cookie: ownerCookie }, body: fd })
  if (chunkRes.status !== 200) throw new Error('分片上传失败')
  const compRes = await fetch(`${BASE}/api/upload-sessions/${createJson.sessionId}/complete`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: ownerCookie }, body: '{}' })
  if (compRes.status !== 201) throw new Error(`合并失败: ${compRes.status}`)

  // 2) 普通成员拉概览：他人资源不得带 manageToken
  const memberCookie = await impersonate('13')
  const memberOverview = await (await fetch(`${BASE}/api/account/team/overview`, { headers: { cookie: memberCookie } })).json()
  const memberResources = memberOverview.resources || []
  const others = memberResources.filter((r) => r.ownerUserId !== '13')
  check('成员概览可见他人团队资源（功能不受影响）', others.length >= 1, `他人资源 ${others.length} 条`)
  check('★ 他人资源不含 manageToken（修复点）', others.every((r) => !r.manageToken), others.map((r) => `owner=${r.ownerUserId} token=${r.manageToken ? 'leaked' : 'none'}`).join(' | '))
  check('★ 他人资源不含 manageUrl（修复点）', others.every((r) => !r.manageUrl))
  check('成员 canManage=false', memberOverview.canManage === false)

  // 3) 所有者拉概览：自己资源仍带 manageToken
  const ownerOverview = await (await fetch(`${BASE}/api/account/team/overview`, { headers: { cookie: ownerCookie } })).json()
  const own = (ownerOverview.resources || []).find((r) => r.ownerUserId === '593')
  check('★ 所有者概览仍带自己资源的 manageToken（所有者功能不变）', Boolean(own?.manageToken), own?.manageToken ? `token=${String(own.manageToken).slice(0, 10)}…` : 'missing')
  check('所有者 canManage=true', ownerOverview.canManage === true)

  // 4) manageToken 的 bearer 语义保留（合法所有者场景不受影响）
  if (own?.manageToken) {
    const mg = await fetch(`${BASE}/api/shares/manage/${own.manageToken}`)
    check('★ manageToken 仍可无登录访问（bearer 语义保留）', mg.status === 200, `status=${mg.status}`)
  }
} catch (err) {
  fail += 1
  console.log('  FAIL  验收脚本异常 —', err.message)
} finally {
  try { srv.kill('SIGKILL') } catch {}
  await sleep(800)
  try {
    fs.copyFileSync(path.join(ROOT, 'storage', 'metadata.json.auditbak'), path.join(ROOT, 'storage', 'metadata.json'))
  } catch (e) { console.log('metadata 还原失败:', e.message) }
  for (const name of snap(filesDir)) if (!beforeFiles.has(name)) fs.rmSync(path.join(filesDir, name), { recursive: true, force: true })
  for (const name of snap(tmpSessionsDir)) if (!beforeTmp.has(name)) fs.rmSync(path.join(tmpSessionsDir, name), { recursive: true, force: true })
  console.log(`\n结果: ${pass}/${pass + fail} 通过`)
  process.exit(fail ? 1 : 0)
}
