// 预览功能探针：全文件类型 kind 判定 + 视频全链路（直传/分片/收集）HTTP 行为验证
// 套路同 _capture_manual_shots.mjs：沙箱起独立服务，种子会话，API 全链路实测。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const ROOT = process.cwd()
const NODE = process.execPath
const SANDBOX = path.join(ROOT, '_preview_probe_sandbox')
const PORT = 8117
const FFMPEG = 'D:/batchAiCutter/ffmpeg-7.1.1-essentials_build/bin/ffmpeg.exe'
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }

fs.rmSync(SANDBOX, { recursive: true, force: true })
fs.mkdirSync(path.join(SANDBOX, 'storage'), { recursive: true })
fs.mkdirSync(path.join(SANDBOX, 'fixtures'), { recursive: true })
fs.copyFileSync(path.join(ROOT, 'server.mjs'), path.join(SANDBOX, 'server.mjs'))
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(SANDBOX, 'node_modules'), 'junction')
fs.symlinkSync(path.join(ROOT, 'dist'), path.join(SANDBOX, 'dist'), 'junction')

// ---------- fixtures：真 mp4 / mp3（ffmpeg），png/pdf/txt 手工构造 ----------
const execSync = (await import('node:child_process')).execSync
const MP4 = path.join(SANDBOX, 'fixtures', 'demo.mp4')
execSync(`"${FFMPEG}" -y -loglevel error -f lavfi -i testsrc=duration=2:size=320x240:rate=15 -f lavfi -i sine=frequency=440:duration=2 -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart "${MP4}"`)
const MP3 = path.join(SANDBOX, 'fixtures', 'demo.mp3')
execSync(`"${FFMPEG}" -y -loglevel error -f lavfi -i sine=frequency=440:duration=1 -c:a libmp3lame "${MP3}"`)
const PNG = path.join(SANDBOX, 'fixtures', 'demo.png')
// 1x1 红色 PNG
fs.writeFileSync(PNG, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
const PDF = path.join(SANDBOX, 'fixtures', 'demo.pdf')
fs.writeFileSync(PDF, Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\nxref\n0 4\ntrailer<</Size 4/Root 1 0 R>>\n%%EOF'))
const TXT = path.join(SANDBOX, 'fixtures', 'demo.txt')
fs.writeFileSync(TXT, 'hello preview\n'.repeat(20))
const mp4Size = fs.statSync(MP4).size
console.log(`fixtures 就绪: mp4=${mp4Size}B`)

// ---------- 种子数据 ----------
const now = new Date().toISOString()
const OWNER = 'u_probe'
const mkUser = (id, nick, email, plan) => ({
  id, username: id, nickname: nick, email, phone: '', avatar: null, avatarSource: '', providerAvatar: null, provider: '',
  loginMethods: ['oauth'], planId: plan, planStartedAt: plan === 'free' ? null : now, planExpiresAt: null,
  organizationId: '', organizationRole: '', status: 'active',
  fileCleanup: { enabled: false, days: 7 }, createdAt: now, updatedAt: now,
})
fs.writeFileSync(path.join(SANDBOX, 'storage', 'metadata.json'), JSON.stringify({
  users: { [OWNER]: mkUser(OWNER, '探针用户', 'probe@kunqiong.com', 'enterprise') },
  sessions: [{ id: 'sess_p_0', expiresAt: new Date(Date.now() + 86400000).toISOString(), createdAt: now, apiWebToken: '', user: mkUser(OWNER, '探针用户', 'probe@kunqiong.com', 'enterprise') }],
  organizations: {}, messages: {}, shares: [], collections: [], auditLogs: [],
  uploadSessions: {}, membershipOrders: [], joinRequests: [], upgradeOrders: [],
  systemConfig: { siteName: '鲲穹', registrationOpen: true },
}, null, 2))

// ---------- 起服务 ----------
const { spawn } = await import('node:child_process')
const server = spawn(NODE, ['server.mjs'], {
  cwd: SANDBOX, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', KUNQIONG_DB_ENABLED: 'false', NODE_ENV: 'production', KUNQIONG_ADMIN_USERNAME: 'admin', KUNQIONG_ADMIN_PASSWORD: 'admin-probe-123' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let serverErr = ''
server.stderr.on('data', (b) => { serverErr += b.toString() })
await new Promise((resolve, reject) => {
  const t0 = Date.now()
  const tick = setInterval(async () => {
    if (Date.now() - t0 > 20000) { clearInterval(tick); reject(new Error('服务启动超时\n' + serverErr)) }
    try { if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok) { clearInterval(tick); resolve() } } catch {}
  }, 250)
})
console.log('服务已启动')

const BASE = `http://127.0.0.1:${PORT}`
const COOKIE = 'kunqiong_session=sess_p_0'
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const mp4Hash = sha256(fs.readFileSync(MP4))

const fileBlob = (p, type) => new Blob([fs.readFileSync(p)], { type })
const mkForm = (entries) => { const fd = new FormData(); for (const [k, v] of entries) fd.append(k, v); return fd }

// ---------- 1. 直传分享：五种类型 ----------
const shareForm = mkForm([
  ['files', fileBlob(MP4, 'video/mp4'), '产品演示.mp4'],
  ['files', fileBlob(PNG, 'image/png'), '截图.png'],
  ['files', fileBlob(MP3, 'audio/mpeg'), '音频.mp3'],
  ['files', fileBlob(PDF, 'application/pdf'), '说明.pdf'],
  ['files', fileBlob(TXT, 'text/plain'), '日志.txt'],
  ['expiryDays', '7'],
])
const shareRes = await fetch(`${BASE}/api/shares`, { method: 'POST', headers: { Cookie: COOKIE }, body: shareForm })
const shareData = await shareRes.json()
check('直传分享创建', shareRes.status === 201, `status=${shareRes.status} ${JSON.stringify(shareData).slice(0, 200)}`)
const shareId = shareData?.share?.id

const KINDS = ['video', 'image', 'audio', 'pdf', 'text']
for (let idx = 0; idx < 5; idx += 1) {
  const r = await fetch(`${BASE}/api/shares/${shareId}/files/${idx}/preview`)
  const body = Buffer.from(await r.arrayBuffer())
  check(`直传预览 files[${idx}] (${KINDS[idx]})`,
    r.status === 200 && r.headers.get('x-preview-type') === KINDS[idx] && body.length > 0,
    `status=${r.status} type=${r.headers.get('x-preview-type')} contentType=${r.headers.get('content-type')} bytes=${body.length}`)
}

// ---------- 2. 视频预览 HTTP 行为（video 标签依赖 Range 206） ----------
{
  const url = `${BASE}/api/shares/${shareId}/files/0/preview`
  const full = await fetch(url)
  const fullBody = Buffer.from(await full.arrayBuffer())
  check('视频全量 200 + Content-Type', full.status === 200 && full.headers.get('content-type') === 'video/mp4', `status=${full.status} ct=${full.headers.get('content-type')} accept-ranges=${full.headers.get('accept-ranges')}`)
  check('视频字节完整性(hash)', sha256(fullBody) === mp4Hash, `hash=${sha256(fullBody).slice(0, 12)}`)

  const head = await fetch(url, { headers: { Range: 'bytes=0-1023' } })
  const headBody = Buffer.from(await head.arrayBuffer())
  check('视频 Range 0-1023 → 206', head.status === 206 && headBody.length === 1024 && head.headers.get('content-range') === `bytes 0-1023/${mp4Size}`, `status=${head.status} len=${headBody.length} cr=${head.headers.get('content-range')}`)

  const mid = await fetch(url, { headers: { Range: `bytes=${mp4Size - 100}-` } })
  const midBody = Buffer.from(await mid.arrayBuffer())
  check('视频尾部 Range（拖进度条场景）', mid.status === 206 && midBody.length === 100 && mid.headers.get('content-range').startsWith(`bytes ${mp4Size - 100}-`), `status=${mid.status} len=${midBody.length}`)

  const bad = await fetch(url, { headers: { Range: `bytes=${mp4Size + 999999}-` } })
  check('越界 Range → 416', bad.status === 416, `status=${bad.status}`)

  const preloadMeta = await fetch(url, { headers: { Range: 'bytes=0-' } })
  await preloadMeta.arrayBuffer()
  check('preload=metadata 请求 bytes=0- → 206', preloadMeta.status === 206 && preloadMeta.headers.get('content-range') === `bytes 0-${mp4Size - 1}/${mp4Size}`, `status=${preloadMeta.status} cr=${preloadMeta.headers.get('content-range')}`)
}

// ---------- 3. 分片上传路径的 mp4 预览（大视频真实路径） ----------
{
  const createRes = await fetch(`${BASE}/api/upload-sessions`, {
    method: 'POST', headers: { Cookie: COOKIE, 'Content-Type': 'application/json' },
    body: JSON.stringify({ files: [{ name: '大视频.mp4', relativePath: '大视频.mp4', size: mp4Size, mimeType: 'video/mp4' }], chunkSize: 65536, expiryDays: '7', mode: 'share' }),
  })
  const { sessionId } = await createRes.json()
  check('分片会话创建', createRes.status === 201 && !!sessionId, `status=${createRes.status}`)
  const buf = fs.readFileSync(MP4)
  const CHUNK = 65536
  for (let i = 0; i * CHUNK < buf.length; i += 1) {
    const slice = buf.subarray(i * CHUNK, Math.min((i + 1) * CHUNK, buf.length))
    const hash = crypto.createHash('sha256').update(slice).digest('hex')
    const fd = mkForm([['fileIndex', '0'], ['chunkIndex', String(i)], ['totalChunks', String(Math.ceil(buf.length / CHUNK))], ['chunkHash', hash], ['chunk', new Blob([slice], { type: 'application/octet-stream' })]])
    const r = await fetch(`${BASE}/api/upload-sessions/${sessionId}/chunks`, { method: 'POST', headers: { Cookie: COOKIE }, body: fd })
    if (r.status !== 200) { check(`分片[${i}]上传`, false, `status=${r.status} ${await r.text()}`); break }
    if (i === 0) check('分片[0]上传', true)
  }
  const completeRes = await fetch(`${BASE}/api/upload-sessions/${sessionId}/complete`, { method: 'POST', headers: { Cookie: COOKIE, 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
  const completeData = await completeRes.json()
  check('分片完成建分享', completeRes.status === 201 && !!completeData?.share?.id, `status=${completeRes.status} ${JSON.stringify(completeData).slice(0, 150)}`)
  const chunkShareId = completeData?.share?.id
  const r = await fetch(`${BASE}/api/shares/${chunkShareId}/files/0/preview`)
  const body = Buffer.from(await r.arrayBuffer())
  check('分片mp4 预览 200 + hash 一致', r.status === 200 && r.headers.get('x-preview-type') === 'video' && sha256(body) === mp4Hash, `status=${r.status} type=${r.headers.get('x-preview-type')} hash=${sha256(body).slice(0, 12)}`)
  const rangeR = await fetch(`${BASE}/api/shares/${chunkShareId}/files/0/preview`, { headers: { Range: 'bytes=100-999' } })
  const rangeBody = Buffer.from(await rangeR.arrayBuffer())
  check('分片mp4 Range 206', rangeR.status === 206 && rangeBody.length === 900, `status=${rangeR.status} len=${rangeBody.length}`)
}

// ---------- 4. 收集任务：视频提交预览（manageToken bearer） ----------
{
  const cRes = await fetch(`${BASE}/api/collections`, {
    method: 'POST', headers: { Cookie: COOKIE, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '视频收集探针', deadline: new Date(Date.now() + 7 * 86400000).toISOString() }),
  })
  const cData = await cRes.json()
  const token = cData?.collection?.token
  const manageToken = cData?.manageToken
  check('收集任务创建', cRes.status === 201 && !!token && !!manageToken, `status=${cRes.status}`)
  const fd = mkForm([['participantName', '访客甲'], ['files', fileBlob(MP4, 'video/mp4'), '访客视频.mp4']])
  const sRes = await fetch(`${BASE}/api/collections/${token}/submissions`, { method: 'POST', body: fd })
  const sData = await sRes.json()
  const subId = sData?.submission?.id
  check('收集提交(含视频)', sRes.status === 201, `status=${sRes.status} ${JSON.stringify(sData).slice(0, 150)}`)
  const pRes = await fetch(`${BASE}/api/collections/manage/${manageToken}/submissions/${subId}/files/0/preview`, { headers: { Authorization: `Bearer ${manageToken}` } })
  const pBody = Buffer.from(await pRes.arrayBuffer())
  check('收集视频预览 200 + hash 一致', pRes.status === 200 && pRes.headers.get('x-preview-type') === 'video' && sha256(pBody) === mp4Hash, `status=${pRes.status} type=${pRes.headers.get('x-preview-type')}`)
}

// ---------- 5. 边界 ----------
{
  const r404 = await fetch(`${BASE}/api/shares/${shareId}/files/9/preview`)
  check('越界下标 → 404（预期行为）', r404.status === 404, `status=${r404.status}`)
  const noKind = await fetch(`${BASE}/api/shares`, { method: 'POST', headers: { Cookie: COOKIE }, body: mkForm([['files', fileBlob(PNG, 'application/octet-stream'), '假装是zip.zip'], ['expiryDays', '7']]) })
  const noKindData = await noKind.json()
  const nkId = noKindData?.share?.id
  const r415 = await fetch(`${BASE}/api/shares/${nkId}/files/0/preview`)
  check('不支持类型(伪装zip) → 415', r415.status === 415, `status=${r415.status}`)
  const r404s = await fetch(`${BASE}/api/shares/nonexistent99/files/0/preview`)
  check('分享不存在 → 404', r404s.status === 404, `status=${r404s.status}`)
}

server.kill()
const pass = results.filter((r) => r.ok).length
console.log(`\n结果：${pass}/${results.length}`)
process.exit(pass === results.length ? 0 : 1)
