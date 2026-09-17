// 单个路由的渲染探针（子进程）。由 _verify_invite.mjs 以 execFileSync 拉起。
// 独立性很重要：产物是 ESM 模块，同一进程内重复 import 会被模块缓存，
// 用 ?v= 绕缓存又会让 URL 解析拿到脏路径。干脆一进程一路由。
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'

const ROOT = process.env.KQ_ROOT
const urlPath = process.argv[2]
const outFile = process.argv[3]

const html = fs.readFileSync(path.join(ROOT, 'dist/index.html'), 'utf8')
const jsName = html.match(/src="\/assets\/([^"]+\.js)"/)?.[1]
const jsPath = path.join(ROOT, 'dist/assets', jsName)

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: `http://localhost${urlPath}`, pretendToBeVisual: true,
})
const errors = []
global.window = dom.window; global.document = dom.window.document
global.HTMLElement = dom.window.HTMLElement; global.Node = dom.window.Node
global.Event = dom.window.Event; global.CustomEvent = dom.window.CustomEvent
global.localStorage = dom.window.localStorage; global.location = dom.window.location
global.getComputedStyle = dom.window.getComputedStyle
global.requestAnimationFrame = (cb) => setTimeout(cb, 0)
global.cancelAnimationFrame = (id) => clearTimeout(id)
global.MutationObserver = dom.window.MutationObserver
global.IntersectionObserver = dom.window.IntersectionObserver || class { observe() {} unobserve() {} disconnect() {} }
global.ResizeObserver = dom.window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} }
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true })
dom.window.matchMedia = dom.window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))

// —— fetch stub ——
// 关键：只要页面会渲染的接口，返回体必须「结构完整」。
// SharePage 期望的是 { share, requiresPassword } 这层包装（它读 data.share.files.length），
// 之前直接回 {} 导致 control 组抛 TypeError，整个脚本在控制组就崩了，
// 邀请页的真实结论根本读不到。
//
// 团队 slug 由 argv[4] 指定：默认 invite-team 返回「团队存在」，
// 传 __missing__ 时返回 unavailable，用于验证落地页的「链接已失效」分支。
const missingTeam = process.argv[4] === '__missing__'
const now = new Date().toISOString()
const SHARE_OBJ = {
  id: 'sh_tok123', token: 'tok123', code: 'ABCD12', title: '测试分享', message: '', senderName: '邀请测试团队',
  createdAt: now, expiresAt: new Date(Date.now() + 3 * 86400000).toISOString(),
  enterpriseSlug: 'invite-team', enterpriseName: '邀请测试团队',
  files: [{ id: 'f1', name: 'demo.txt', relativePath: 'demo.txt', size: 12, uploadedAt: now, previewKind: 'text' }],
  status: 'active',
}
const jsonRes = (body, status = 200) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => body, text: async () => JSON.stringify(body),
})
global.fetch = async (url, opts = {}) => {
  const u = String(url)
  const method = String(opts?.method || 'GET').toUpperCase()
  if (u.includes('/api/auth/me')) return jsonRes({ user: { id: 'u_appl_inv', nickname: '访客小王', username: 'appl' } })
  if (u.includes('/join-request')) {
    if (method === 'POST') {
      if (missingTeam) return jsonRes({ message: '团队不存在' }, 404)
      return jsonRes({ requestId: 'req_x', status: 'requested' }, 201)
    }
    if (missingTeam) return jsonRes({ available: false, reason: 'unavailable' })
    return jsonRes({ available: true, reason: 'eligible', organizationName: '邀请测试团队' })
  }
  if (u.includes('/api/account/team/overview')) return jsonRes({ organization: null, members: [], joinRequests: [], memberUsage: [] })
  if (u.includes('/api/shares/token/')) return jsonRes({ share: SHARE_OBJ, requiresPassword: false })
  if (u.includes('/api/shares/lookup/')) return jsonRes({ share: SHARE_OBJ, requiresPassword: false })
  if (u.includes('/api/collections/token/')) {
    return jsonRes({ collection: { id: 'c1', token: 'tok123', title: '测试收集', enterpriseSlug: 'invite-team', enterpriseName: '邀请测试团队', status: 'active', expiresAt: now, files: [], rules: {} }, requiresPassword: false })
  }
  if (u.includes('/api/auth/session')) return jsonRes({ user: { id: 'u_appl_inv', nickname: '访客小王' } })
  if (u.includes('/api/organizations/')) {
    if (missingTeam) return jsonRes({ available: false, reason: 'unavailable' })
    return jsonRes({ available: true, reason: 'eligible', organizationName: '邀请测试团队' })
  }
  return jsonRes({})
}

const orig = console.error
console.error = (...a) => { const s = a.map(String).join(' '); if (!/createRoot\(\) on a container|not wrapped in act/.test(s)) errors.push(s) }
let fatal = ''
try {
  await import(pathToFileURL(jsPath).href)
  await new Promise((r) => setTimeout(r, 600))
} catch (e) {
  fatal = e?.message || String(e)
} finally { console.error = orig }

const d = dom.window.document
const out = {
  urlPath,
  fatal,
  errors,
  hasInvitePage: Boolean(d.querySelector('.team-invite-page')),
  hasJoinCard: Boolean(d.querySelector('.team-join-card')),
  hasWorkspace: Boolean(d.querySelector('.workspace-grid')),
  hasSharePage: Boolean(d.querySelector('.share-public-card')),
  html: d.getElementById('root')?.innerHTML || '',
}
fs.writeFileSync(outFile, JSON.stringify(out))
process.exit(0)
