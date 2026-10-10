// COLL-001~012 收集任务回归套件（隔离 fixture + 模拟扫描器）。
// 覆盖：创建/校验/类型限制/截止/匿名提交/姓名异常/分片续传/管理隔离/删除提交/关闭重开/中文 ZIP。
// （容量类 COLL-007 完整覆盖在 verify-remediation.mjs；本套件做一条主路径冒烟）
// 用法：node scripts/verify-collection-suite.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-coll-suite-'))
const future = new Date(Date.now() + 20 * 86400000).toISOString()
const users = Object.fromEntries(['owner', 'recipient', 'stranger', 'member'].map((id) => [id, { id, username: id, nickname: id, status: 'active', planId: 'free' }]))
users.member.planId = 'member'
users.member.planExpiresAt = future
const sessions = Object.values(users).map((user) => ({ id: user.id + '-session', user, apiWebToken: 'fixture-token-' + user.id, expiresAt: future }))
fs.copyFileSync(path.join(root, 'server.mjs'), path.join(fixture, 'server.mjs'))
function copyDirectory(source, target) {
  fs.mkdirSync(target, { recursive: true })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name); const to = path.join(target, entry.name)
    if (entry.isDirectory()) copyDirectory(from, to); else if (entry.isFile()) fs.copyFileSync(from, to)
  }
}
copyDirectory(path.join(root, 'server'), path.join(fixture, 'server'))
fs.copyFileSync(path.join(root, 'package.json'), path.join(fixture, 'package.json'))
fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
const templateSource = path.join(root, 'email-templates')
fs.mkdirSync(path.join(fixture, 'email-templates'))
for (const name of fs.readdirSync(templateSource)) fs.copyFileSync(path.join(templateSource, name), path.join(fixture, 'email-templates', name))
fs.mkdirSync(path.join(fixture, 'storage'))
fs.writeFileSync(path.join(fixture, 'storage', 'metadata.json'), JSON.stringify({ users, sessions, shares: [], collections: [], messages: {}, systemConfig: { anonymousTotalSizeMb: 1 }, upgradeOrders: [] }))

const scanner = net.createServer((socket) => {
  let input = Buffer.alloc(0), command = false, ended = false
  socket.on('error', () => {})
  socket.on('data', (data) => {
    input = Buffer.concat([input, data])
    if (!command) { const e = input.indexOf(0); if (e < 0) return; input = input.subarray(e + 1); command = true }
    while (input.length >= 4 && !ended) {
      const length = input.readUInt32BE(0)
      if (input.length < 4 + length) break
      input = input.subarray(4 + length)
      if (!length) { ended = true; socket.end('stream: OK\0') }
    }
  })
})
await new Promise((r) => scanner.listen(0, '127.0.0.1', r))

const cleanEnv = { ...process.env }
for (const key of Object.keys(cleanEnv)) if (key.startsWith('KUNQIONG_') || key.startsWith('OAUTH_')) delete cleanEnv[key]

let child, base, passed = 0
const failures = []
function check(name, cond, detail = '') { if (cond) { passed++; console.log(`  PASS  ${name}`) } else { failures.push(name); console.log(`  FAIL  ${name}  ${detail}`) } }
async function start() {
  const probe = net.createServer(); await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port; await new Promise((resolve) => probe.close(resolve))
  base = `http://127.0.0.1:${port}`
  child = spawn(process.execPath, ['server.mjs'], {
    cwd: fixture, windowsHide: true,
    env: { ...cleanEnv, PORT: String(port), NODE_ENV: 'production', KUNQIONG_HOST: '127.0.0.1', KUNQIONG_SCAN_MODE: 'required', KUNQIONG_CLAMAV_HOST: '127.0.0.1', KUNQIONG_CLAMAV_PORT: String(scanner.address().port) },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let errors = ''
  child.stderr.on('data', (d) => { errors += d })
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/api/health')).ok) return } catch {}
    if (child.exitCode !== null) throw new Error('fixture 启动失败: ' + errors)
    await delay(50)
  }
  throw new Error('fixture 启动失败: ' + errors)
}
async function stop() { if (child && child.exitCode === null) { const e = once(child, 'exit'); child.kill(); await Promise.race([e, delay(3000)]) } }
async function api(url, { user = '', method = 'GET', body, raw = false, headers = {} } = {}) {
  const isForm = body instanceof FormData
  const res = await fetch(base + url, {
    method,
    headers: { ...(user ? { cookie: `kunqiong_session=${user}-session` } : {}), ...(body && !isForm ? { 'content-type': 'application/json' } : {}), ...headers },
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  })
  if (raw) return { res, status: res.status, buffer: Buffer.from(await res.arrayBuffer()), headers: res.headers }
  const data = await res.json().catch(() => ({}))
  return { res, data, status: res.status, headers: res.headers }
}
function form(files = [], fields = {}) {
  const b = new FormData()
  for (const [key, value] of Object.entries(fields)) b.append(key, value)
  for (const file of files) b.append('files', new Blob([file.content ?? 'fixture-bytes']), file.name)
  return b
}
const diskCollections = () => JSON.parse(fs.readFileSync(path.join(fixture, 'storage', 'metadata.json'), 'utf8')).collections || []
// 极简 ZIP 中央目录解析：返回 [{name, utf8}]
function zipEntryNames(buffer) {
  let eocd = -1
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 65536); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) return []
  const count = buffer.readUInt16LE(eocd + 10)
  let off = buffer.readUInt32LE(eocd + 16)
  const names = []
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(off) !== 0x02014b50) break
    const flag = buffer.readUInt16LE(off + 8)
    const nameLen = buffer.readUInt16LE(off + 28)
    const extraLen = buffer.readUInt16LE(off + 30)
    const commentLen = buffer.readUInt16LE(off + 32)
    names.push({ name: buffer.slice(off + 46, off + 46 + nameLen).toString('utf8'), utf8: (flag & 0x0800) !== 0 })
    off += 46 + nameLen + extraLen + commentLen
  }
  return names
}

try {
  await start()

  console.log('\n=== COLL-001 创建任务 ===')
  const created = await api('/api/collections', { user: 'owner', method: 'POST', body: { title: '季度资料收集', description: '请上传 PDF', allowedTypes: ['文档'], maxFileSizeMb: 10 } })
  const task = created.data.collection
  check('创建返回 201 且带提交链接 token', created.status === 201 && Boolean(task?.token), `status=${created.status}`)
  check('带管理链接 manageToken', Boolean(created.data.manageToken))
  check('生成二维码 qrDataUrl', typeof task?.qrDataUrl === 'string' && task.qrDataUrl.startsWith('data:image/png'), `qr=${String(task?.qrDataUrl).slice(0, 24)}`)
  check('任务状态为 active', task?.status === 'active')
  const publicView = await api(`/api/collections/${task.token}`)
  check('提交链接可匿名访问且状态 active', publicView.status === 200 && publicView.data.collection.status === 'active')

  console.log('\n=== COLL-002 表单校验 ===')
  const beforeCount = diskCollections().length
  const emptyTitle = await api('/api/collections', { user: 'owner', method: 'POST', body: { title: '   ' } })
  check('空标题 400 且提示可理解', emptyTitle.status === 400 && /名称/.test(emptyTitle.data.message || ''), `status=${emptyTitle.status} msg=${emptyTitle.data.message}`)
  const badDate = await api('/api/collections', { user: 'owner', method: 'POST', body: { title: 'x', deadline: 'not-a-date' } })
  check('非法日期 400', badDate.status === 400, `status=${badDate.status} msg=${badDate.data.message}`)
  const longTitle = '超长标题'.repeat(100)
  const longTitleRes = await api('/api/collections', { user: 'owner', method: 'POST', body: { title: longTitle } })
  const longTitleStored = longTitleRes.status === 201 ? (diskCollections().find((item) => item.token === longTitleRes.data.collection?.token)?.title || '') : ''
  check('超长标题有服务端约束（拒绝或截断，未原样落库）', longTitleRes.status !== 201 || longTitleStored.length < longTitle.length, `status=${longTitleRes.status} stored=${longTitleStored.length}/${longTitle.length}`)
  const negSize = await api('/api/collections', { user: 'owner', method: 'POST', body: { title: '负数限制', maxFileSizeMb: -5 } })
  check('负数单人大小限制不产生可用任务', negSize.status === 400, `status=${negSize.status}（若 201 则为缺陷：任务永远无法提交）`)
  const afterCount = diskCollections().length
  check('校验失败不残留半成品任务（仅合法创建落库）', afterCount - beforeCount === (longTitleRes.status === 201 ? 1 : 0), `before=${beforeCount} after=${afterCount}`)

  console.log('\n=== COLL-003 类型限制 ===')
  const imgTask = (await api('/api/collections', { user: 'owner', method: 'POST', body: { title: '仅图片', allowedTypes: ['图片'], maxFileSizeMb: 10 } })).data.collection
  const pngOk = await api(`/api/collections/${imgTask.token}/submissions`, { method: 'POST', body: form([{ name: 'TC-03-04-图片预览-1x1.png', content: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }], { participantName: '图片提交者' }) })
  check('允许类型（png）可提交', pngOk.status === 201, `status=${pngOk.status} msg=${pngOk.data.message}`)
  const txtRejected = await api(`/api/collections/${imgTask.token}/submissions`, { method: 'POST', body: form([{ name: 'TC-03-01-安全文本-可预览.txt' }], { participantName: '文本提交者' }) })
  check('不允许类型（txt）被阻止', txtRejected.status === 413, `status=${txtRejected.status}`)
  const renamedExe = await api(`/api/collections/${imgTask.token}/submissions`, { method: 'POST', body: form([{ name: '伪装程序.exe' }], { participantName: '改名绕过者' }) })
  check('非白名单扩展名（exe）被阻止（按扩展名白名单判定）', renamedExe.status === 413, `status=${renamedExe.status}`)

  console.log('\n=== COLL-004 截止时间 ===')
  const deadlineTask = (await api('/api/collections', { user: 'owner', method: 'POST', body: { title: '限时任务' } })).data.collection
  const beforeDeadline = await api(`/api/collections/${deadlineTask.token}/submissions`, { method: 'POST', body: form([{ name: 'ok.txt' }], { participantName: '截止前' }) })
  check('截止前可提交', beforeDeadline.status === 201, `status=${beforeDeadline.status}`)
  const expireTask = (await api('/api/collections', { user: 'owner', method: 'POST', body: { title: '过期任务' } })).data
  // 通过管理接口把截止时间改到过去（走正常更新链路，避免直接改盘与运行中进程的文件锁冲突）
  const expirePatch = await api(`/api/collections/manage/${expireTask.manageToken}`, { user: 'owner', method: 'PATCH', body: { deadline: new Date(Date.now() - 3600000).toISOString() } })
  check('管理接口可把截止时间改到过去（模拟时间流逝）', expirePatch.status === 200, `status=${expirePatch.status} msg=${expirePatch.data.message}`)
  const expiredSubmit = await api(`/api/collections/${expireTask.collection.token}/submissions`, { method: 'POST', body: form([{ name: 'late.txt' }], { participantName: '截止后' }) })
  check('截止后提交被拒绝（410）', expiredSubmit.status === 410, `status=${expiredSubmit.status} msg=${expiredSubmit.data.message}`)
  const expiredPage = await api(`/api/collections/${expireTask.collection.token}`)
  check('截止后提交页返回明确状态', expiredPage.status === 410 && /截止/.test(expiredPage.data.message || ''), `status=${expiredPage.status} msg=${expiredPage.data.message}`)

  console.log('\n=== COLL-005 匿名提交全链路 ===')
  const anonTask = (await api('/api/collections', { method: 'POST', body: { title: '匿名收集', maxFileSizeMb: 10 } })).data
  const anonSubmit = await api(`/api/collections/${anonTask.collection.token}/submissions`, { method: 'POST', body: form([{ name: 'TC-03-01-安全文本-可预览.txt', content: '匿名提交内容' }], { participantName: '匿名同学' }) })
  check('匿名（无登录）可提交', anonSubmit.status === 201, `status=${anonSubmit.status} msg=${anonSubmit.data.message}`)
  check('返回提交成功与提交 id', Boolean(anonSubmit.data.submission?.id))
  const anonManage = await api(`/api/collections/manage/${anonTask.manageToken}`)
  const anonSubmission = (anonManage.data.collection?.submissions || []).find((item) => item.participantName === '匿名同学')
  check('创建者管理页可见该提交', Boolean(anonSubmission), `names=${(anonManage.data.collection?.submissions || []).map((item) => item.participantName).join('|')}`)

  console.log('\n=== COLL-006 提交者姓名与 HTML 输入 ===')
  const nameTask = (await api('/api/collections', { user: 'owner', method: 'POST', body: { title: '姓名校验' } })).data.collection
  const emptyName = await api(`/api/collections/${nameTask.token}/submissions`, { method: 'POST', body: form([{ name: 'a.txt' }], { participantName: '   ' }) })
  check('姓名为空（空白）被拒绝', emptyName.status === 400, `status=${emptyName.status}`)
  const htmlName = '<script>alert(1)</script>'
  const htmlSubmit = await api(`/api/collections/${nameTask.token}/submissions`, { method: 'POST', body: form([{ name: 'b.txt' }], { participantName: htmlName }) })
  check('HTML 姓名按文本接受（存储原样，渲染层转义）', htmlSubmit.status === 201, `status=${htmlSubmit.status}`)
  const storedHtml = (await api(`/api/collections/manage/${diskCollections().find((item) => item.token === nameTask.token).manageToken}`)).data.collection.submissions.find((item) => item.participantName === htmlName)
  check('管理数据中姓名按原文保留（不做 HTML 解析）', Boolean(storedHtml))
  const longName = '很长的名字'.repeat(80)
  const longNameSubmit = await api(`/api/collections/${nameTask.token}/submissions`, { method: 'POST', body: form([{ name: 'c.txt' }], { participantName: longName }) })
  const longNameStored = diskCollections().find((item) => item.token === nameTask.token).submissions.find((item) => longName.startsWith(item.participantName) && item.participantName.length <= 40)
  check('超长姓名被服务端截断受限（或拒绝）', longNameSubmit.status !== 201 || Boolean(longNameStored), `status=${longNameSubmit.status} stored=${longNameStored?.participantName.length}`)
  const htmlFile = await api(`/api/collections/${nameTask.token}/submissions`, { method: 'POST', body: form([{ name: 'TC-07-02-危险HTML链接与脚本.html', content: '<a href="javascript:alert(1)">x</a><script>alert(2)</script>' }], { participantName: 'HTML文件提交者' }) })
  check('HTML 文件可提交（内容交给扫描与预览层防护）', htmlFile.status === 201, `status=${htmlFile.status}`)

  console.log('\n=== COLL-007 容量限制（冒烟；完整覆盖在 verify-remediation）===')
  const smallAnonTask = (await api('/api/collections', { method: 'POST', body: { title: '小容量', maxFileSizeMb: 500 } })).data
  const oversized = await api(`/api/collections/${smallAnonTask.collection.token}/submissions`, { method: 'POST', body: form([{ name: 'big.bin', content: Buffer.alloc(1.5 * 1024 * 1024) }], { participantName: '超容量' }) })
  check('匿名任务超容量提交被拒绝（507 或 413）', [507, 413].includes(oversized.status), `status=${oversized.status} msg=${oversized.data.message}`)

  console.log('\n=== COLL-008 分片上传与断点恢复 ===')
  const chunkTask = (await api('/api/collections', { user: 'owner', method: 'POST', body: { title: '分片收集', maxFileSizeMb: 100 } })).data.collection
  const bigChunkA = Buffer.alloc(1024 * 1024, 0x61)
  const bigChunkB = Buffer.from('tail-B')
  const sessionCreate = await api('/api/upload-sessions', { user: 'owner', method: 'POST', body: { chunkSize: 1024 * 1024, files: [{ name: '分段大文件.bin', size: bigChunkA.length + bigChunkB.length }], mode: 'collection', collectionToken: chunkTask.token, participantName: '分片提交者' } })
  const sessionId = sessionCreate.data.sessionId
  check('仅任务相关方可创建分片会话（所有者创建成功）', sessionCreate.status === 201, `status=${sessionCreate.status}`)
  const strangerCreate = await api('/api/upload-sessions', { user: 'stranger', method: 'POST', body: { chunkSize: 1024 * 1024, files: [{ name: 'x.bin', size: 10 }], mode: 'collection', collectionToken: 'unknown-token' } })
  check('未知任务令牌创建会话被拒绝', strangerCreate.status === 404, `status=${strangerCreate.status}`)
  const putChunk = async (index, bytes) => {
    const b = new FormData()
    b.append('chunk', new Blob([bytes]), 'part')
    b.append('fileIndex', '0'); b.append('chunkIndex', String(index)); b.append('totalChunks', '2')
    b.append('filename', '分段大文件.bin')
    return api(`/api/upload-sessions/${sessionId}/chunks`, { user: 'owner', method: 'POST', body: b })
  }
  const firstChunk = await putChunk(0, bigChunkA)
  check('首片上传成功', firstChunk.status === 200, `status=${firstChunk.status}`)
  await stop(); await start() // 模拟刷新/重启
  const sessionAfterRestart = await api(`/api/upload-sessions/${sessionId}`, { user: 'owner' })
  check('刷新（重启）后可查询进度：首片已完成', sessionAfterRestart.status === 200 && JSON.stringify(sessionAfterRestart.data.files?.[0]?.uploadedChunks) === '[0]', `chunks=${JSON.stringify(sessionAfterRestart.data.files?.[0]?.uploadedChunks)}`)
  const strangerProbe = await api(`/api/upload-sessions/${sessionId}`, { user: 'stranger' })
  check('非会话持有者不能查询会话（403/404）', [403, 404].includes(strangerProbe.status), `status=${strangerProbe.status}`)
  await putChunk(1, bigChunkB)
  const complete = await api(`/api/upload-sessions/${sessionId}/complete`, { user: 'owner', method: 'POST', body: {} })
  const submittedFile = complete.data.submission?.files?.[0]
  check('完成后文件完整且扫描通过', complete.status === 201 && submittedFile?.size === bigChunkA.length + bigChunkB.length && submittedFile?.scanEngine === 'clamav', `status=${complete.status} size=${submittedFile?.size} engine=${submittedFile?.scanEngine}`)
  const projSub = diskCollections().find((item) => item.token === chunkTask.token).submissions.find((item) => item.id === complete.data.submission.id)
  const assembled = fs.readFileSync(path.join(fixture, 'storage', 'collections', chunkTask.token, projSub.id, projSub.files[0].storedName))
  check('组装后字节逐位一致（含跨片尾部）', assembled.equals(Buffer.concat([bigChunkA, bigChunkB])))

  console.log('\n=== COLL-009 管理页数据隔离 ===')
  const taskX = (await api('/api/collections', { user: 'owner', method: 'POST', body: { title: '任务X' } })).data
  const taskY = (await api('/api/collections', { user: 'owner', method: 'POST', body: { title: '任务Y-机密' } })).data
  await api(`/api/collections/${taskX.collection.token}/submissions`, { method: 'POST', body: form([{ name: 'x.txt' }], { participantName: 'X的提交者' }) })
  const manageX = await api(`/api/collections/manage/${taskX.manageToken}`)
  const manageXText = JSON.stringify(manageX.data)
  check('管理页只含本任务提交', (manageX.data.collection.submissions || []).every((item) => item.participantName === 'X的提交者'))
  check('不泄漏其他任务的 token/manageToken', !manageXText.includes(taskY.collection.token) && !manageXText.includes(taskY.manageToken))

  console.log('\n=== COLL-010 删除提交 ===')
  const delTask = (await api('/api/collections', { user: 'owner', method: 'POST', body: { title: '删除提交' } })).data
  const s1 = await api(`/api/collections/${delTask.collection.token}/submissions`, { method: 'POST', body: form([{ name: 'keep.txt', content: '保留内容' }], { participantName: '甲' }) })
  const s2 = await api(`/api/collections/${delTask.collection.token}/submissions`, { method: 'POST', body: form([{ name: 'remove.txt', content: '待删除内容' }], { participantName: '乙' }) })
  const delRes = await api(`/api/collections/manage/${delTask.manageToken}/submissions/${s2.data.submission.id}`, { method: 'DELETE' })
  check('删除指定提交成功且列表更新', delRes.status === 200 && !JSON.stringify(delRes.data).includes(s2.data.submission.id), `status=${delRes.status}`)
  check('其余提交不受影响', (delRes.data.collection.submissions || []).some((item) => item.id === s1.data.submission.id))
  await delay(300) // 异步目录删除（不阻塞请求）
  const delZip = await api(`/api/collections/manage/${delTask.manageToken}/download`, { raw: true })
  const delZipNames = zipEntryNames(delZip.buffer).map((item) => item.name)
  check('ZIP 只含剩余提交内容', delZipNames.some((name) => name.includes('keep.txt')) && !delZipNames.some((name) => name.includes('remove.txt')), `entries=${delZipNames.join('|')}`)

  console.log('\n=== COLL-011 关闭与重新开放 ===')
  const closeTask = (await api('/api/collections', { user: 'owner', method: 'POST', body: { title: '可关闭任务' } })).data
  const closeRes = await api(`/api/collections/manage/${closeTask.manageToken}`, { user: 'owner', method: 'PATCH', body: { status: 'closed' } })
  check('关闭任务成功', closeRes.status === 200 && closeRes.data.collection.status === 'closed', `status=${closeRes.status}`)
  const submitWhenClosed = await api(`/api/collections/${closeTask.collection.token}/submissions`, { method: 'POST', body: form([{ name: 'closed.txt' }], { participantName: '关闭后' }) })
  check('关闭后提交被拒绝（410）', submitWhenClosed.status === 410, `status=${submitWhenClosed.status} msg=${submitWhenClosed.data.message}`)
  const reopenRes = await api(`/api/collections/manage/${closeTask.manageToken}`, { user: 'owner', method: 'PATCH', body: { status: 'active' } })
  check('重新开放成功（截止时间未过）', reopenRes.status === 200 && reopenRes.data.collection.status === 'active', `status=${reopenRes.status} msg=${reopenRes.data.message}`)
  const submitAfterReopen = await api(`/api/collections/${closeTask.collection.token}/submissions`, { method: 'POST', body: form([{ name: 'again.txt' }], { participantName: '重开后' }) })
  check('重开后恢复提交', submitAfterReopen.status === 201, `status=${submitAfterReopen.status}`)

  console.log('\n=== COLL-012 中文目录 ZIP ===')
  const zipTask = (await api('/api/collections', { user: 'owner', method: 'POST', body: { title: '中文目录收集' } })).data
  const zipForm = new FormData()
  const dirFiles = [
    ['一/根目录文件.txt', 'root'],
    ['一级目录/同名文件.txt', 'l1'],
    ['一级目录/二级目录/深层文件.txt', 'l2'],
  ]
  for (const [name, content] of dirFiles) zipForm.append('files', new Blob([content]), path.basename(name))
  zipForm.append('participantName', '张三')
  zipForm.append('relativePaths', JSON.stringify(dirFiles.map(([name]) => name)))
  const zipSubmit = await api(`/api/collections/${zipTask.collection.token}/submissions`, { method: 'POST', body: zipForm })
  check('中文目录结构提交成功', zipSubmit.status === 201, `status=${zipSubmit.status} msg=${zipSubmit.data.message}`)
  const allZip = await api(`/api/collections/manage/${zipTask.manageToken}/download`, { raw: true })
  const allEntries = zipEntryNames(allZip.buffer)
  check('ZIP 下载 200 且含全部文件', allZip.status === 200 && allEntries.length === 3, `entries=${allEntries.map((item) => item.name).join('|')}`)
  check('ZIP 内保留中文目录层级（提交者名-哈希/目录/文件）', allEntries.some((item) => /^张三-[0-9a-f]{6}\/一级目录\/二级目录\/深层文件\.txt$/.test(item.name)) || allEntries.some((item) => item.name.includes('一级目录/二级目录/深层文件.txt')), `entries=${allEntries.map((item) => item.name).join('|')}`)
  check('ZIP 文件名 UTF-8 标记（中文不乱码）', allEntries.every((item) => item.utf8), `flags=${allEntries.map((item) => item.utf8).join(',')}`)
  const oneZip = await api(`/api/collections/manage/${zipTask.manageToken}/submissions/${zipSubmit.data.submission.id}/download`, { raw: true })
  const oneEntries = zipEntryNames(oneZip.buffer)
  check('单提交 ZIP 下载内容正确', oneZip.status === 200 && oneEntries.length === 3, `entries=${oneEntries.map((item) => item.name).join('|')}`)
  const previewFile = await api(`/api/collections/manage/${zipTask.manageToken}/submissions/${zipSubmit.data.submission.id}/files/0/preview`, { raw: true })
  check('单文件预览可用（text/plain 防注入）', previewFile.status === 200 && String(previewFile.headers.get('content-type') || '').includes('text/plain'), `status=${previewFile.status} type=${previewFile.headers.get('content-type')}`)
} catch (error) {
  console.error('\n套件异常:', error.message)
  failures.push('套件异常: ' + error.message)
} finally {
  await stop()
  await new Promise((r) => scanner.close(r))
  console.log(`\n收集任务套件: ${passed} 通过 / ${failures.length} 失败`)
  if (failures.length) { for (const f of failures) console.log(`  FAIL: ${f}`); process.exitCode = 1 }
}
