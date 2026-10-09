// 完整真实流转：先在沙箱里写好 metadata.json，再加载 server.mjs，然后用真实 HTTP + 真实 session
// 走完「申请 → 所有者看到申请 → 同意 → 申请人成为成员 → 移除 → 再申请 → 拒绝 → 冷却」全链路。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'

const ROOT = 'C:/Users/admin/Desktop/鲲穹文件传输web'
const PORT = 8096
const BASE = `http://127.0.0.1:${PORT}`

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'kq-flow-'))
const storage = path.join(sandbox, 'storage')
fs.mkdirSync(storage, { recursive: true })
fs.copyFileSync(path.join(ROOT, 'server.mjs'), path.join(sandbox, 'server.mjs'))
try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(sandbox, 'node_modules'), 'junction') } catch { /* 已存在 */ }

const OWNER = 'u_owner_1'
const APPLICANT = 'u_apply_1'
const SLUG = 'team-e2etest'
const now = new Date().toISOString()

// 关键：在 server.mjs 加载前写入快照，让它启动时就带测试数据。
fs.writeFileSync(path.join(storage, 'metadata.json'), JSON.stringify({
  users: {
    [OWNER]: { id: OWNER, username: 'owner', nickname: '团队所有者', planId: 'enterprise', planExpiresAt: null, planStartedAt: now, status: 'active', createdAt: now, updatedAt: now, organizationId: '', organizationRole: '' },
    [APPLICANT]: { id: APPLICANT, username: 'applicant', nickname: '申请者小张', email: 'zhang@example.com', planId: 'free', status: 'active', createdAt: now, updatedAt: now },
  },
  // 真实会话由 OAuth 回调写入，带有完整用户资料；这里必须模拟同样形态，
  // 否则 displayAccountName 会因会话缺 nickname 而回落，测试结果是假阳性。
  sessions: [
    { id: 'sess_owner', user: { id: OWNER, username: 'owner', nickname: '团队所有者', email: '', phone: '' }, expiresAt: new Date(Date.now() + 86400000).toISOString() },
    { id: 'sess_applicant', user: { id: APPLICANT, username: 'applicant', nickname: '申请者小张', email: 'zhang@example.com', phone: '' }, expiresAt: new Date(Date.now() + 86400000).toISOString() },
  ],
  organizations: {
    org_e2e: {
      id: 'org_e2e', slug: SLUG, name: '端到端测试团队', ownerUserId: OWNER, createdAt: now, updatedAt: now,
      members: [{ id: 'm_owner', userId: OWNER, displayName: '团队所有者', role: 'owner', status: 'active', joinedAt: now, invitedAt: null }],
    },
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

const logFile = path.join(ROOT, '_flow.log')
const results = []
const log = (line) => { results.push(line); try { fs.appendFileSync(logFile, line + '\n') } catch { /* 忽略 */ } }
const check = (label, pass, extra = '') => log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`)
try { fs.writeFileSync(logFile, '') } catch { /* 忽略 */ }
process.on('uncaughtException', (e) => log('UNCAUGHT: ' + (e?.stack || e)))
process.on('unhandledRejection', (e) => log('UNHANDLED: ' + (e?.stack || e)))

const waitFor = async (fn, tries = 80) => {
  for (let i = 0; i < tries; i += 1) {
    try { const v = await fn(); if (v) return v } catch { /* 重试 */ }
    await new Promise((r) => setTimeout(r, 300))
  }
  return null
}
const api = (p, opts = {}, sid) => fetch(`${BASE}${p}`, {
  ...opts,
  headers: { 'Content-Type': 'application/json', ...(sid ? { cookie: `kunqiong_session=${sid}` } : {}), ...(opts.headers || {}) },
})
const readMeta = () => JSON.parse(fs.readFileSync(path.join(storage, 'metadata.json'), 'utf8'))

try {
  await import(pathToFileURL(path.join(sandbox, 'server.mjs')).href)
  const ready = await waitFor(async () => (await fetch(`${BASE}/api/health`)).ok)
  if (!ready) { log('服务未启动'); process.exit(1) }
  log('沙箱服务已启动，快照已预置（企业版所有者 + 组织 slug=' + SLUG + '）')

  // 会话是否被服务端接受
  const me1 = await api('/api/auth/me', {}, 'sess_owner')
  const me1j = await me1.json()
  log('\n===== 0. 会话可用性 =====')
  check('所有者 session 有效', me1j.user?.id === OWNER, `user=${me1j.user?.id || 'null'}`)
  const me2 = await (await api('/api/auth/me', {}, 'sess_applicant')).json()
  check('申请者 session 有效', me2.user?.id === APPLICANT, `user=${me2.user?.id || 'null'}`)

  log('\n===== 1. 入团资格查询 =====')
  const q1 = await (await api(`/api/organizations/${SLUG}/join-request`, {}, 'sess_applicant')).json()
  check('企业版团队开放申请', q1.available === true, JSON.stringify(q1))
  check('reason=eligible', q1.reason === 'eligible', `reason=${q1.reason}`)
  check('返回团队名称', q1.organizationName === '端到端测试团队', `name=${q1.organizationName}`)
  const qAnon = await (await api(`/api/organizations/${SLUG}/join-request`)).json()
  check('未登录 reason=anonymous', qAnon.reason === 'anonymous', `reason=${qAnon.reason}`)
  const qOwner = await (await api(`/api/organizations/${SLUG}/join-request`, {}, 'sess_owner')).json()
  check('所有者 reason=owner', qOwner.reason === 'owner', `reason=${qOwner.reason}`)

  log('\n===== 2. 提交申请 =====')
  const post1 = await api(`/api/organizations/${SLUG}/join-request`, { method: 'POST', body: JSON.stringify({ message: '想加入团队一起传文件' }) }, 'sess_applicant')
  const pj1 = await post1.json()
  check('提交申请 201', post1.status === 201, `status=${post1.status} ${JSON.stringify(pj1)}`)
  check('返回 requestId', Boolean(pj1.requestId), `id=${pj1.requestId}`)
  check('重复申请 409', (await api(`/api/organizations/${SLUG}/join-request`, { method: 'POST', body: '{}' }, 'sess_applicant')).status === 409)
  const qj2 = await (await api(`/api/organizations/${SLUG}/join-request`, {}, 'sess_applicant')).json()
  check('状态变为 pending', qj2.reason === 'pending', `reason=${qj2.reason}`)

  log('\n===== 3. 所有者查看待处理申请 =====')
  const ovRes = await api('/api/account/team/overview', {}, 'sess_owner')
  const ov = await ovRes.json()
  check('团队总览 200', ovRes.status === 200, `status=${ovRes.status}`)
  check('joinRequests 是数组', Array.isArray(ov.joinRequests), `len=${ov.joinRequests?.length}`)
  check('含申请人姓名', ov.joinRequests?.[0]?.displayName === '申请者小张', `name=${ov.joinRequests?.[0]?.displayName}`)
  check('含申请留言', ov.joinRequests?.[0]?.message === '想加入团队一起传文件', `msg=${ov.joinRequests?.[0]?.message}`)
  check('含联络方式', ov.joinRequests?.[0]?.email === 'zhang@example.com', `email=${ov.joinRequests?.[0]?.email}`)
  const pendingInRoster = ov.organization.members.some((m) => m.userId === APPLICANT && m.status === 'requested')
  check('所有者可见待审批占位记录', pendingInRoster, `members=${ov.organization.members.length}`)
  check('待审批者不计入成员观察', !ov.memberUsage.some((m) => m.userId === APPLICANT), `memberUsage=${ov.memberUsage.length}`)
  check('申请者尚无团队总览 404', (await api('/api/account/team/overview', {}, 'sess_applicant')).status === 404)

  log('\n===== 4. 所有者同意 =====')
  const requestId = ov.joinRequests[0].requestId
  const approve = await api(`/api/account/workspace/join-requests/${encodeURIComponent(requestId)}`, { method: 'POST', body: JSON.stringify({ decision: 'approve' }) }, 'sess_owner')
  const ap = await approve.json()
  check('同意 200', approve.status === 200, `status=${approve.status}`)
  check('decided=approve', ap.decided === 'approve', `decided=${ap.decided}`)
  check('待处理清空', ap.joinRequests?.length === 0, `len=${ap.joinRequests?.length}`)
  check('申请人成为正式成员', ap.organization?.members?.some((m) => m.userId === APPLICANT && m.status === 'active'), 'status=active')
  check('已发站内通知', ap.notifiedInApp === true, `notifiedInApp=${ap.notifiedInApp}`)
  const ov2Res = await api('/api/account/team/overview', {}, 'sess_applicant')
  const ov2 = await ov2Res.json()
  check('申请人可看到团队总览', ov2Res.status === 200 && ov2.organization?.slug === SLUG, `status=${ov2Res.status}`)
  const qj3 = await (await api(`/api/organizations/${SLUG}/join-request`, {}, 'sess_applicant')).json()
  check('已是成员 reason=member', qj3.reason === 'member', `reason=${qj3.reason}`)
  check('已是成员不能再申请 409', (await api(`/api/organizations/${SLUG}/join-request`, { method: 'POST', body: '{}' }, 'sess_applicant')).status === 409)

  log('\n===== 5. 拒绝流程与冷却 =====')
  const applicantMember = ov2.organization.members.find((m) => m.userId === APPLICANT)
  check('所有者可移除成员 200', (await api(`/api/account/workspace/members/${applicantMember.id}`, { method: 'DELETE' }, 'sess_owner')).status === 200)
  const reapply = await api(`/api/organizations/${SLUG}/join-request`, { method: 'POST', body: JSON.stringify({}) }, 'sess_applicant')
  check('被移除后可重新申请 201', reapply.status === 201, `status=${reapply.status}`)
  const ov3 = await (await api('/api/account/team/overview', {}, 'sess_owner')).json()
  check('所有者再次看到申请', ov3.joinRequests?.length === 1, `len=${ov3.joinRequests?.length}`)
  const reject = await api(`/api/account/workspace/join-requests/${encodeURIComponent(ov3.joinRequests[0].requestId)}`, { method: 'POST', body: JSON.stringify({ decision: 'reject' }) }, 'sess_owner')
  const rp = await reject.json()
  check('拒绝 200', reject.status === 200, `status=${reject.status}`)
  check('decided=reject', rp.decided === 'reject', `decided=${rp.decided}`)
  check('拒绝后列表清空', rp.joinRequests?.length === 0, `len=${rp.joinRequests?.length}`)
  check('拒绝后通知申请人', rp.notifiedInApp === true, `notifiedInApp=${rp.notifiedInApp}`)
  const qj4 = await (await api(`/api/organizations/${SLUG}/join-request`, {}, 'sess_applicant')).json()
  check('进入冷却期', qj4.reason === 'cooldown', `reason=${qj4.reason}`)
  check('带 cooldownUntil', Boolean(qj4.cooldownUntil), `until=${qj4.cooldownUntil}`)
  check('冷却期内申请 429', (await api(`/api/organizations/${SLUG}/join-request`, { method: 'POST', body: '{}' }, 'sess_applicant')).status === 429)

  log('\n===== 6. 权限边界与参数校验 =====')
  check('未登录看总览 401', (await api('/api/account/team/overview')).status === 401)
  const appApprove = await api('/api/account/workspace/join-requests/fake', { method: 'POST', body: '{"decision":"approve"}' }, 'sess_applicant')
  check('非所有者不能审批', [403, 404].includes(appApprove.status), `status=${appApprove.status}`)
  const badDecision = await api(`/api/account/workspace/join-requests/${encodeURIComponent(ov3.joinRequests?.[0]?.requestId || 'x')}`, { method: 'POST', body: '{"decision":"whatever"}' }, 'sess_owner')
  check('非法 decision 400', badDecision.status === 400, `status=${badDecision.status}`)
  check('所有者不能申请自己团队 409', (await api(`/api/organizations/${SLUG}/join-request`, { method: 'POST', body: '{}' }, 'sess_owner')).status === 409)

  log('\n===== 7. 快照落盘与可观测性 =====')
  const finalMeta = readMeta()
  const org = finalMeta.organizations?.org_e2e
  check('organization 已落盘', Boolean(org))
  const applicantFinal = org?.members?.find((m) => m.userId === APPLICANT)
  check('被拒成员保留 reviewedAt', Boolean(applicantFinal?.reviewedAt), `status=${applicantFinal?.status}`)
  const messages = Object.values(finalMeta.messages || {}).flat()
  const eventTypes = [...new Set(messages.map((m) => m.eventType))]
  check('申请人收到入团结果通知', messages.some((m) => ['teamJoinApproved', 'teamJoinRejected'].includes(m.eventType)), `事件=${eventTypes.join(',')}`)
  check('所有者收到申请通知', messages.some((m) => m.eventType === 'teamJoinRequest'))
  const actions = (finalMeta.auditLogs || []).map((l) => l.action)
  check('审计日志含「提交入团申请」', actions.includes('提交入团申请'), `日志=${actions.join(' / ')}`)
  check('审计日志含「同意入团申请」', actions.includes('同意入团申请'))
  check('审计日志含「拒绝入团申请」', actions.includes('拒绝入团申请'))
} catch (err) {
  log('异常：' + (err?.stack || err))
  results.push('FAIL 脚本异常')
} finally {
  try { fs.rmSync(sandbox, { recursive: true, force: true }) } catch { /* 忽略 */ }
}

const failed = results.filter((l) => l.includes('FAIL')).length
const total = results.filter((l) => l.includes('PASS') || l.includes('FAIL')).length
log(`\n结果：${total - failed}/${total} 通过`)
process.exit(failed ? 1 : 0)
