// 团队邀请链接端到端验证。
// 这段链路此前有个真 bug：邀请链接是 /e/<slug>/share/（不带 token），
// 而 App() 里 `parts[2]==='share' && parts[3]` 要求必须有 token，
// 于是邀请链接落到 WorkspaceApp 兜底分支，访客永远看不到「申请加入团队」。
//
// 本脚本覆盖两层：
//   A. 路由层：真实执行 dist 产物，断言各形态邀请链接渲染出 TeamInvitePage
//   B. 接口层：真实 HTTP，走完「探测 → 申请 → 所有者审批 → 成为成员」
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'

const ROOT = 'C:/Users/admin/Desktop/鲲穹文件传输web'
const logFile = path.join(ROOT, '_invite.log')
const results = []
const line = (s) => { results.push(s); try { fs.appendFileSync(logFile, s + '\n') } catch {} }
const check = (label, pass, extra = '') => line(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`)
try { fs.writeFileSync(logFile, '') } catch {}

const SLUG = 'invite-team'
const OWNER = 'u_owner_inv'
const APPLICANT = 'u_appl_inv'

// ============ A. 路由层：真实执行产物 ============
line('===== A. 路由层：真实产物在各邀请链接形态下的渲染 =====')
const html = fs.readFileSync(path.join(ROOT, 'dist/index.html'), 'utf8')
const jsName = html.match(/src="\/assets\/([^"]+\.js)"/)?.[1]
const cssName = html.match(/href="\/assets\/([^"]+\.css)"/)?.[1]
line(`  产物：js=${jsName} css=${cssName}`)
const jsPath = path.join(ROOT, 'dist/assets', jsName)
const cssText = fs.readFileSync(path.join(ROOT, 'dist/assets', cssName), 'utf8')

// 产物里应含新的邀请落地页。
// 注意：不能断言 "TeamInvitePage" 这个标识符 —— 产物经过压缩，函数名会被 mangle 掉，
// 只有字符串字面量与 className 会保留。断言必须盯「用户可见/可观测」的东西。
const jsText = fs.readFileSync(jsPath, 'utf8')
check('产物含邀请落地页文案', /你收到一个团队空间邀请/.test(jsText))
check('产物含邀请落地页样式类', /team-invite-page/.test(cssText))
check('产物含邀请落地页骨架类', /team-invite-hero/.test(cssText))

const { execFileSync } = await import('node:child_process')
const NODE = process.execPath
const renderAt = (urlPath, missing = false) => {
  const tag = urlPath.replace(/[^a-z0-9]/gi, '_') + (missing ? '_MISS' : '')
  const outFile = path.join(ROOT, `_inv_${tag}.json`)
  const args = [path.join(ROOT, '_invite_child.mjs'), urlPath, outFile]
  if (missing) args.push('__missing__')
  try {
    execFileSync(NODE, args, { env: { ...process.env, KQ_ROOT: ROOT }, stdio: 'pipe', timeout: 60000 })
  } catch (e) {
    return { fatal: '子进程异常：' + (e?.message || e), errors: [], hasInvitePage: false, hasJoinCard: false, hasWorkspace: false, hasSharePage: false, html: '' }
  }
  try { return JSON.parse(fs.readFileSync(outFile, 'utf8')) } catch { return { fatal: '无输出', errors: [], hasInvitePage: false, hasJoinCard: false, hasWorkspace: false, hasSharePage: false, html: '' } }
}

const inviteRoutes = ['/e/invite-team/share/', '/e/invite-team/collect/', '/e/invite-team/', '/e/invite-team']
for (const r of inviteRoutes) {
  const res = await renderAt(r)
  if (res.fatal) line(`  ${r} 渲染失败：${res.fatal}`)
  check(`★ ${r} 渲染邀请落地页`, res.hasInvitePage, `invitePage=${res.hasInvitePage}`)
  check(`★ ${r} 显示加入卡片`, res.hasJoinCard, `joinCard=${res.hasJoinCard}`)
  check(`★ ${r} 不再落到工作台兜底`, !res.hasWorkspace, `workspaceGrid=${res.hasWorkspace}`)
  check(`${r} 含团队名`, /邀请测试团队/.test(res.html))
  check(`${r} 无运行时报错`, res.errors.length === 0 && !res.fatal, res.fatal || res.errors.slice(0, 1).join('') || 'clean')
}

// 团队不存在 / 链接失效：必须明确告知，不能既说「你收到邀请」又没有任何入口，
// 更不能显示「加入『该团队』团队空间」这种兜底文案。
for (const r of ['/e/ghost-team/share/', '/e/ghost-team/']) {
  const res = await renderAt(r, true)
  check(`★ ${r} 失效链接仍渲染落地页`, res.hasInvitePage, `invitePage=${res.hasInvitePage}`)
  check(`★ ${r} 明确提示链接已失效`, /这个邀请链接已失效/.test(res.html))
  check(`★ ${r} 不再渲染无意义的加入卡片`, !res.hasJoinCard, `joinCard=${res.hasJoinCard}`)
  // 断言要精确到「兜底文案」的特征串。只测 /该团队/ 会误命中
  // 「该团队不存在或已解散」这句正常说明，是假阳性。
  check(`★ ${r} 不出现「加入『该团队』」兜底文案`, !/加入「该团队」/.test(res.html))
  check(`${r} 无运行时报错`, res.errors.length === 0 && !res.fatal, res.fatal || res.errors.slice(0, 1).join('') || 'clean')
}

// 带 token 的企业分享链接仍应渲染分享页（不能把邀请页逻辑串味）
const shareRes = await renderAt('/e/invite-team/share/tok123')
if (shareRes.fatal) line(`  控制组渲染失败：${shareRes.fatal}`)
check('带 token 的企业分享链接仍渲染 SharePage（非邀请页）', !shareRes.hasInvitePage && shareRes.hasSharePage, `invitePage=${shareRes.hasInvitePage} sharePage=${shareRes.hasSharePage}`)

// ============ B. 接口层：真实 HTTP 全链路 ============
line('\n===== B. 接口层：探测 → 申请 → 审批 → 成为成员 =====')
const PORT = 8099
const BASE = `http://127.0.0.1:${PORT}`
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'kq-invite-'))
const storage = path.join(sandbox, 'storage')
fs.mkdirSync(storage, { recursive: true })
fs.copyFileSync(path.join(ROOT, 'server.mjs'), path.join(sandbox, 'server.mjs'))
try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(sandbox, 'node_modules'), 'junction') } catch {}
const now = new Date().toISOString()
fs.writeFileSync(path.join(storage, 'metadata.json'), JSON.stringify({
  users: {
    [OWNER]: { id: OWNER, username: 'owner', nickname: '邀请团队所有者', planId: 'enterprise', planStartedAt: now, status: 'active', createdAt: now, updatedAt: now, organizationId: 'org_inv', organizationRole: 'owner' },
    [APPLICANT]: { id: APPLICANT, username: 'appl', nickname: '访客小王', email: 'wang@example.com', planId: 'free', status: 'active', createdAt: now, updatedAt: now },
  },
  sessions: [
    { id: 'sess_owner', user: { id: OWNER, username: 'owner', nickname: '邀请团队所有者' }, expiresAt: new Date(Date.now() + 86400000).toISOString() },
    { id: 'sess_appl', user: { id: APPLICANT, username: 'appl', nickname: '访客小王', email: 'wang@example.com' }, expiresAt: new Date(Date.now() + 86400000).toISOString() },
  ],
  organizations: {
    org_inv: { id: 'org_inv', slug: SLUG, name: '邀请测试团队', ownerUserId: OWNER, createdAt: now, updatedAt: now,
      members: [{ id: 'm_owner', userId: OWNER, displayName: '邀请团队所有者', email: '', phone: '', role: 'owner', status: 'active', joinedAt: now }] },
  },
  shares: [], collections: [], messages: {}, auditLogs: [], systemConfig: {},
}, null, 2))

process.env.PORT = String(PORT)
process.env.NODE_ENV = 'test'
process.env.KUNQIONG_DB_ENABLED = 'false'
process.env.KUNQIONG_TEST_ENFORCE_ENTERPRISE_ALLOWLIST = 'false'
process.env.OAUTH_CLIENT_ID = ''
process.env.OAUTH_CLIENT_SECRET = ''
process.chdir(sandbox)

const api = (p, opts = {}, sid) => fetch(`${BASE}${p}`, {
  ...opts,
  headers: { 'Content-Type': 'application/json', ...(sid ? { cookie: `kunqiong_session=${sid}` } : {}), ...(opts.headers || {}) },
})
const readMeta = () => JSON.parse(fs.readFileSync(path.join(storage, 'metadata.json'), 'utf8'))

try {
  await import(pathToFileURL(path.join(sandbox, 'server.mjs')).href)
  for (let i = 0; i < 80; i += 1) { try { if ((await fetch(`${BASE}/api/health`)).ok) break } catch {} await new Promise((r) => setTimeout(r, 300)) }

  // 邀请链接是公开页面，未登录访客也能打开；接口应回 anonymous 而不是 401
  const anon = await (await api(`/api/organizations/${SLUG}/join-request`)).json()
  check('未登录探测回 anonymous（不报 401）', anon.reason === 'anonymous', `reason=${anon.reason}`)

  const q = await (await api(`/api/organizations/${SLUG}/join-request`, {}, 'sess_appl')).json()
  check('登录后 available=true', q.available === true, JSON.stringify(q))
  check('reason=eligible', q.reason === 'eligible', `reason=${q.reason}`)
  check('返回团队名称（落地页要显示）', q.organizationName === '邀请测试团队', `name=${q.organizationName}`)

  const post = await api(`/api/organizations/${SLUG}/join-request`, { method: 'POST', body: JSON.stringify({}) }, 'sess_appl')
  const pj = await post.json()
  check('提交申请 201', post.status === 201, `status=${post.status}`)
  check('返回 requestId', Boolean(pj.requestId), `id=${pj.requestId}`)

  const ov = await (await api('/api/account/team/overview', {}, 'sess_owner')).json()
  check('所有者在团队空间看到申请', ov.joinRequests?.length === 1, `len=${ov.joinRequests?.length}`)
  check('申请人是显示名', ov.joinRequests?.[0]?.displayName === '访客小王', `name=${ov.joinRequests?.[0]?.displayName}`)

  const approve = await api(`/api/account/workspace/join-requests/${encodeURIComponent(ov.joinRequests[0].requestId)}`, { method: 'POST', body: JSON.stringify({ decision: 'approve' }) }, 'sess_owner')
  const ap = await approve.json()
  check('所有者同意 200', approve.status === 200, `status=${approve.status}`)
  check('申请人成为正式成员', ap.organization?.members?.some((m) => m.userId === APPLICANT && m.status === 'active'))
  const ov2 = await (await api('/api/account/team/overview', {}, 'sess_appl')).json()
  check('申请人此后可访问团队空间', ov2.organization?.slug === SLUG, `slug=${ov2.organization?.slug}`)

  // 已入团后再次点邀请链接应显示「已是成员」
  const qAfter = await (await api(`/api/organizations/${SLUG}/join-request`, {}, 'sess_appl')).json()
  check('已是成员后 reason=member', qAfter.reason === 'member', `reason=${qAfter.reason}`)

  // 不存在的 slug 应优雅返回，而不是崩
  const bad = await api('/api/organizations/no-such-team/join-request', {}, 'sess_appl')
  const badJson = await bad.json().catch(() => ({}))
  check('无效 slug 不崩（available=false）', badJson.available === false || bad.status === 404, `status=${bad.status} ${JSON.stringify(badJson)}`)

  const finalMeta = readMeta()
  check('申请已落盘', Boolean(finalMeta.organizations?.org_inv?.members?.find((m) => m.userId === APPLICANT)))
} catch (err) {
  line('接口层异常：' + (err?.stack || err))
  results.push('FAIL 接口层脚本异常')
} finally {
  try { fs.rmSync(sandbox, { recursive: true, force: true }) } catch { /* 忽略 */ }
}

const failed = results.filter((l) => l.includes('FAIL')).length
const total = results.filter((l) => l.includes('PASS') || l.includes('FAIL')).length
line(`\n结果：${total - failed}/${total} 通过`)
process.exit(failed ? 1 : 0)
