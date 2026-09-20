// 一次性探针：免费成员上传的团队资源，关闭后应能重新开启（applyShareUpdate 不再按上传者个人套餐校验）
// 修复前：PATCH /api/shares/manage/:token {status:'active'} → 403 重新开启分享需要会员版或更高权益
// 修复后：share.teamResource 走团队权益口径 → 200
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = 'C:\\Users\\admin\\Desktop\\鲲穹文件传输web'
const NODE = process.execPath
const PORT = '8201'
const BASE = `http://127.0.0.1:${PORT}`

const filesDir = path.join(ROOT, 'storage', 'files')
const tmpSessionsDir = path.join(ROOT, 'storage', 'tmp', 'upload-sessions')
const snap = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
const beforeFiles = new Set(snap(filesDir))
const beforeTmp = new Set(snap(tmpSessionsDir))
const metaPath = path.join(ROOT, 'storage', 'metadata.json')
const metaBak = metaPath + '.probebak'
fs.copyFileSync(metaPath, metaBak)

const env = { ...process.env, PORT, NODE_ENV: 'test', KUNQIONG_DB_ENABLED: 'false', KUNQIONG_TEST_ENFORCE_ENTERPRISE_ALLOWLIST: 'false' }
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
  const adminRes = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'ljxkjadmin', password: 'jxljxkj009900' }) })
  const adminCookie = cookieOf(adminRes)
  if (adminRes.status !== 200) throw new Error('admin login failed')
  const impersonate = async (userId) => {
    const r = await fetch(`${BASE}/api/admin/impersonate`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: adminCookie }, body: JSON.stringify({ userId }) })
    const b = await r.json()
    if (r.status !== 200 || !b.sessionId) throw new Error(`impersonate ${userId} failed`)
    return `kunqiong_session=${b.sessionId}`
  }

  // 1) 免费成员(13)上传团队资源（永久）
  const memberCookie = await impersonate('13')
  const content = 'team-reopen-probe'
  const createRes = await fetch(`${BASE}/api/upload-sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: memberCookie },
    body: JSON.stringify({ mode: 'team_resource', expiryDays: '0', files: [{ name: 'reopen-probe.txt', size: content.length, mimeType: 'text/plain' }] }),
  })
  const createJson = await createRes.json().catch(() => ({}))
  if (createRes.status !== 201) throw new Error(`创建团队上传会话失败: ${createRes.status} ${createJson.message || ''}`)
  const fd = new FormData()
  fd.append('fileIndex', '0'); fd.append('chunkIndex', '0'); fd.append('totalChunks', '1')
  fd.append('chunk', new Blob([content]), 'part')
  const chunkRes = await fetch(`${BASE}/api/upload-sessions/${createJson.sessionId}/chunks`, { method: 'POST', headers: { cookie: memberCookie }, body: fd })
  if (chunkRes.status !== 200) throw new Error('分片上传失败')
  const compRes = await fetch(`${BASE}/api/upload-sessions/${createJson.sessionId}/complete`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: memberCookie }, body: '{}' })
  const compJson = await compRes.json().catch(() => ({}))
  if (compRes.status !== 201) throw new Error(`合并失败: ${compRes.status} ${compJson.message || ''}`)
  const manageToken = compJson.share?.manageToken || compJson.manageToken
  check('免费成员可创建永久团队资源', Boolean(manageToken))

  // 2) 关闭分享
  const closeRes = await fetch(`${BASE}/api/shares/manage/${encodeURIComponent(manageToken)}`, { method: 'DELETE' })
  check('关闭分享成功', closeRes.status === 200, `status=${closeRes.status}`)

  // 3) 重新开启（修复点：不再按上传者 free 套餐拒绝）
  const reopenRes = await fetch(`${BASE}/api/shares/manage/${encodeURIComponent(manageToken)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'active' }) })
  const reopenJson = await reopenRes.json().catch(() => ({}))
  check('★ 关闭后重新开启成功（修复点）', reopenRes.status === 200 && reopenJson.share?.status === 'active', `status=${reopenRes.status} ${reopenJson.message || ''}`)

  // 4) 调整有效期为永久也放行（同一口径）
  const permRes = await fetch(`${BASE}/api/shares/manage/${encodeURIComponent(manageToken)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expiresAt: null }) })
  check('★ 团队资源可设永久有效期（同口径）', permRes.status === 200, `status=${permRes.status}`)

  // 5) 对照：个人分享的 permanent 校验必须原样 —— 免费成员创建个人分享再改永久应被拒
  const pFd = new FormData()
  pFd.append('files', new Blob([content]), 'personal-probe.txt')
  pFd.append('expiryDays', '7')
  const pRes = await fetch(`${BASE}/api/shares`, { method: 'POST', headers: { cookie: memberCookie }, body: pFd })
  const pJson = await pRes.json().catch(() => ({}))
  if (pRes.status === 201 && pJson.share?.manageToken) {
    const denyRes = await fetch(`${BASE}/api/shares/manage/${encodeURIComponent(pJson.share.manageToken)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expiresAt: null }) })
    check('个人分享永久校验保持原样（free 仍被拒）', denyRes.status === 403, `status=${denyRes.status}`)
  } else {
    check('个人分享创建（对照跳过）', false, `status=${pRes.status}`)
  }
} catch (err) {
  fail += 1
  console.log('  FAIL  探针异常 —', err.message)
} finally {
  try { srv.kill('SIGKILL') } catch {}
  await sleep(800)
  try { fs.copyFileSync(metaBak, metaPath); fs.rmSync(metaBak, { force: true }) } catch (e) { console.log('metadata 还原失败:', e.message) }
  for (const name of snap(filesDir)) if (!beforeFiles.has(name)) fs.rmSync(path.join(filesDir, name), { recursive: true, force: true })
  for (const name of snap(tmpSessionsDir)) if (!beforeTmp.has(name)) fs.rmSync(path.join(tmpSessionsDir, name), { recursive: true, force: true })
  console.log(`\n结果: ${pass}/${pass + fail} 通过`)
  process.exit(fail ? 1 : 0)
}
