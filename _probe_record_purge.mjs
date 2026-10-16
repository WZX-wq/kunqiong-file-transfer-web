// 一次性探针：收发记录删除联动清理 + 后台「执行清理」真实清理
// 背景：记录删除此前只过滤 metadata.records，底层 shares/collections 与磁盘文件全部残留，
//       后台「分享/收集任务/待清理」统计不同步（用户删光了记录后台仍显示 78 分享/76 待清理）。
// 修复：① DELETE /api/account/records 联动清理名下已关闭/过期资源（活跃资源保留、他人资源绝不动）
//       ② POST /api/admin/cleanup 经 purgeStaleResources 真实清除（团队资源保留）并返回诚实计数
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = 'C:\\Users\\admin\\Desktop\\鲲穹文件传输web'
const NODE = process.execPath
const PORT = '8202'
const BASE = `http://127.0.0.1:${PORT}`

const filesDir = path.join(ROOT, 'storage', 'files')
const collectionsDir = path.join(ROOT, 'storage', 'collections')
const tmpSessionsDir = path.join(ROOT, 'storage', 'tmp', 'upload-sessions')
const snap = (dir) => (fs.existsSync(dir) ? new Set(fs.readdirSync(dir)) : new Set())
const beforeFiles = snap(filesDir)
const beforeCollections = snap(collectionsDir)
const beforeTmp = snap(tmpSessionsDir)
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
  const adminRes = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'ljxkjadmin', password: process.env.KUNQIONG_ADMIN_PASSWORD }) })
  const adminCookie = cookieOf(adminRes)
  if (adminRes.status !== 200) throw new Error('admin login failed')
  const impersonate = async (userId) => {
    const r = await fetch(`${BASE}/api/admin/impersonate`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: adminCookie }, body: JSON.stringify({ userId }) })
    const b = await r.json()
    if (r.status !== 200 || !b.sessionId) throw new Error(`impersonate ${userId} failed`)
    return `kunqiong_session=${b.sessionId}`
  }
  const overview = async () => (await (await fetch(`${BASE}/api/admin/overview`, { headers: { cookie: adminCookie } })).json())
  const user13 = await impersonate('13')
  const user593 = await impersonate('593')

  const createShare = async (cookie, name = 'purge-probe.txt', expiryDays = '7') => {
    const fd = new FormData()
    fd.append('files', new Blob([`content-of-${name}`]), name)
    fd.append('expiryDays', expiryDays)
    const r = await fetch(`${BASE}/api/shares`, { method: 'POST', headers: { cookie }, body: fd })
    const b = await r.json().catch(() => ({}))
    if (r.status !== 201) throw new Error(`create share failed: ${r.status} ${b.message || ''}`)
    return b.share || b
  }
  const closeShare = async (manageToken) => {
    const r = await fetch(`${BASE}/api/shares/manage/${manageToken}`, { method: 'DELETE' })
    if (r.status !== 200) {
      const bodyText = await r.text().catch(() => '')
      const ov = await fetch(`${BASE}/api/admin/overview`, { headers: { cookie: adminCookie } }).then((x) => x.json()).catch(() => null)
      const shareRow = ov?.resources?.filter((x) => x.kind === 'share').find((x) => x.name === 'purge-probe.txt' || x.status !== 'active')
      console.log(`  [debug] close ${manageToken} → ${r.status} ${bodyText.slice(0, 200)}`)
      console.log(`  [debug] share 总数=${ov?.stats?.shares} 匹配行=${JSON.stringify(shareRow)}`)
      throw new Error(`close share failed: ${r.status}`)
    }
  }
  const addRecord = async (cookie, record) => {
    const r = await fetch(`${BASE}/api/account/records`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ records: [record] }) })
    if (r.status !== 201) throw new Error(`add record failed: ${r.status}`)
  }
  const deleteRecords = async (cookie, ids) => {
    const r = await fetch(`${BASE}/api/account/records`, { method: 'DELETE', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ ids }) })
    const b = await r.json().catch(() => ({}))
    if (r.status !== 200) throw new Error(`delete records failed: ${r.status}`)
    return b
  }

  // ---- Case A：关闭的分享，删记录 → 资源 + 磁盘文件一并清理 ----
  const shareA = await createShare(user13)
  await addRecord(user13, { id: `my_sent:share:${shareA.id}`, scope: 'my_sent', kind: 'share', name: 'probe-share-a' })
  await closeShare(shareA.manageToken)
  const delA = await deleteRecords(user13, [`my_sent:share:${shareA.id}`])
  check('A1 关闭分享删记录返回 purged', (delA.purged || []).some((p) => p.kind === 'share' && p.id === shareA.id))
  const ovA = await overview()
  check('A2 后台不再统计该分享', !ovA.resources.some((r) => r.kind === 'share' && r.id === shareA.id))
  check('A3 磁盘文件目录已删除', !fs.existsSync(path.join(filesDir, shareA.id)))

  // ---- Case B：活跃分享，删记录 → 资源保留 ----
  const shareB = await createShare(user13)
  await addRecord(user13, { id: `my_sent:share:${shareB.id}`, scope: 'my_sent', kind: 'share', name: 'probe-share-b' })
  const delB = await deleteRecords(user13, [`my_sent:share:${shareB.id}`])
  check('B1 活跃分享删记录无 purged', !(delB.purged || []).length)
  const ovB = await overview()
  check('B2 活跃分享仍保留', ovB.resources.some((r) => r.kind === 'share' && r.id === shareB.id))

  // ---- Case C：sent_to_me 删记录绝不动别人的资源（即使已关闭）----
  const shareC = await createShare(user13)
  await closeShare(shareC.manageToken)
  await addRecord(user593, { id: `sent_to_me:share:${shareC.id}`, scope: 'sent_to_me', kind: 'share', name: 'probe-share-c' })
  const delC = await deleteRecords(user593, [`sent_to_me:share:${shareC.id}`])
  check('C1 他人分享删记录无 purged', !(delC.purged || []).length)
  const ovC = await overview()
  check('C2 他人已关闭分享仍保留', ovC.resources.some((r) => r.kind === 'share' && r.id === shareC.id))

  // ---- Case D：关闭的收集任务，删记录 → 资源清理 ----
  const colRes = await fetch(`${BASE}/api/collections`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: user13 },
    body: JSON.stringify({ title: 'purge-probe-收集', deadline: new Date(Date.now() + 7 * 86400000).toISOString() }),
  })
  const colJson = await colRes.json()
  if (colRes.status !== 201) throw new Error(`create collection failed: ${colRes.status}`)
  const col = colJson.collection
  const closeRes = await fetch(`${BASE}/api/collections/manage/${col.manageToken}`, { method: 'PATCH', headers: { 'content-type': 'application/json', cookie: user13 }, body: JSON.stringify({ status: 'closed' }) })
  if (closeRes.status !== 200) throw new Error(`close collection failed: ${closeRes.status}`)
  await addRecord(user13, { id: `my_collections:collection:${col.manageToken}`, scope: 'my_collections', kind: 'collection', name: 'probe-collection' })
  const delD = await deleteRecords(user13, [`my_collections:collection:${col.manageToken}`])
  check('D1 关闭收集删记录返回 purged', (delD.purged || []).some((p) => p.kind === 'collection' && p.id === col.id))
  const ovD = await overview()
  check('D2 后台不再统计该收集任务', !ovD.resources.some((r) => r.kind === 'collection' && r.id === col.id))

  // ---- Case E：后台「执行清理」→ 真实清除 + 诚实计数 + 团队资源保留 + 记录同步摘除 ----
  const shareE = await createShare(user13)
  console.log('  [debug] shareE =', JSON.stringify({ id: shareE?.id, manageToken: shareE?.manageToken, code: shareE?.code }))
  await addRecord(user13, { id: `my_sent:share:${shareE.id}`, scope: 'my_sent', kind: 'share', name: 'probe-share-e' })
  await closeShare(shareE.manageToken) // 不删记录，留给后台清理

  // 团队资源（成员13 上传）→ 关闭 → 后台清理必须保留
  const teamContent = 'team-purge-probe!!!'
  const trRes = await fetch(`${BASE}/api/upload-sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: user13 },
    body: JSON.stringify({ mode: 'team_resource', expiryDays: '0', files: [{ name: 'purge-probe-team.txt', size: teamContent.length, mimeType: 'text/plain' }] }),
  })
  const trJson = await trRes.json().catch(() => ({}))
  if (trRes.status !== 201) throw new Error(`创建团队上传会话失败: ${trRes.status}`)
  const tfd = new FormData()
  tfd.append('fileIndex', '0'); tfd.append('chunkIndex', '0'); tfd.append('totalChunks', '1')
  tfd.append('chunk', new Blob([teamContent]), 'part')
  const tChunk = await fetch(`${BASE}/api/upload-sessions/${trJson.sessionId}/chunks`, { method: 'POST', headers: { cookie: user13 }, body: tfd })
  if (tChunk.status !== 200) throw new Error(`团队资源分片上传失败: ${tChunk.status}`)
  const tComp = await (await fetch(`${BASE}/api/upload-sessions/${trJson.sessionId}/complete`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: user13 }, body: '{}' })).json()
  if (!tComp.share) throw new Error(`团队资源合并失败: ${JSON.stringify(tComp).slice(0, 200)}`)
  const teamShare = { id: tComp.share.id, manageToken: tComp.share.manageToken || tComp.manageToken }
  await closeShare(teamShare.manageToken)

  const beforeClean = await overview()
  const cleanRes = await fetch(`${BASE}/api/admin/cleanup`, { method: 'POST', headers: { cookie: adminCookie } })
  const cleanJson = await cleanRes.json()
  check('E1 清理接口 200', cleanRes.status === 200)
  check('E2 expiredShares 诚实计数(≥1)', (cleanJson.expiredShares || 0) >= 1, `expiredShares=${cleanJson.expiredShares}`)
  check('E3 已关闭分享被清除', !cleanJson.overview.resources.some((r) => r.kind === 'share' && r.id === shareE.id))
  check('E4 磁盘文件已删除', !fs.existsSync(path.join(filesDir, shareE.id)))
  check('E5 已关闭团队资源保留', cleanJson.overview.resources.some((r) => r.kind === 'share' && r.id === teamShare.id), `teamShare=${teamShare.id}`)
  const recs13 = await (await fetch(`${BASE}/api/account/records`, { headers: { cookie: user13 } })).json()
  check('E6 指向被清资源的记录同步摘除', !(recs13.records || []).some((r) => r.id === `my_sent:share:${shareE.id}`))
  check('E7 分享计数下降=诚实计数', cleanJson.overview.stats.shares === beforeClean.stats.shares - (cleanJson.expiredShares || 0), `before=${beforeClean.stats.shares} expired=${cleanJson.expiredShares} after=${cleanJson.overview.stats.shares}`)

  console.log(`\n结果：${pass}/${pass + fail}`)
  if (fail > 0) {
    console.log('--- server tail ---')
    console.log(srvLog.slice(-1500))
  }
} catch (error) {
  fail += 1
  console.error('PROBE ERROR:', error.message)
  console.log(srvLog.slice(-2000))
} finally {
  srv.kill()
  await sleep(300)
  fs.copyFileSync(metaBak, metaPath)
  fs.rmSync(metaBak, { force: true })
  for (const [dir, before] of [[filesDir, beforeFiles], [collectionsDir, beforeCollections], [tmpSessionsDir, beforeTmp]]) {
    if (!fs.existsSync(dir)) continue
    for (const entry of fs.readdirSync(dir)) {
      if (!before.has(entry)) fs.rmSync(path.join(dir, entry), { recursive: true, force: true })
    }
  }
  process.exit(fail > 0 ? 1 : 0)
}
