// 前端渲染验证：团队邀请链接 + 复制按钮在 /team 与 /workspace 两个页面都要出现，
// 并验证「成员改名后团队空间显示新昵称」这条链路在前端确实吃到了后端的新值。
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'

const ROOT = 'C:/Users/admin/Desktop/鲲穹文件传输web'
const logFile = path.join(ROOT, '_link.log')
const results = []
const line = (s) => { results.push(s); try { fs.appendFileSync(logFile, s + '\n') } catch {} }
const check = (label, pass, extra = '') => line(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`)
try { fs.writeFileSync(logFile, '') } catch {}

const OWNER = 'u_owner_1'
const MEMBER = 'u_member_1'
const SLUG = 'team-link'

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

// 先做静态契约检查（快、稳），再做真实渲染
line('===== 1. 静态契约 =====')
const wsSrc = read('src/main.jsx')
check('WorkspacePage 渲染邀请链接行', /workspace-invite-link-row/.test(wsSrc))
check('WorkspacePage 有复制按钮', /copyEnterpriseLink/.test(wsSrc))
check('TeamPage 渲染邀请链接卡', /team-invite-link-card/.test(wsSrc))
check('TeamPage 有复制按钮', /copyTeamInviteLink/.test(wsSrc))
check('邀请链接指向 /e/<slug>/share/', /\/e\/\$\{[^}]*slug[^}]*\}\/share\//.test(wsSrc))
check('已废弃变量名 enterpriseLink 不再出现', !/\benterpriseLink\b/.test(wsSrc))
const cssSrc = read('src/styles.css')
check('CSS 定义了 workspace-invite-link', /\.workspace-invite-link\b/.test(cssSrc))
check('CSS 定义了 team-invite-link-card', /\.team-invite-link-card\b/.test(cssSrc))
check('CSS 定义了链接行省略号', /text-overflow: ellipsis/.test(cssSrc))

// 关键拷贝文案与旧承诺的区别：新卡片只讲「邀请入团」，不宣称品牌定制
check('新文案不再出现「企业专属链接」字样', !/企业专属链接/.test(wsSrc.split('workspace-invite-link')[1]?.slice(0, 900) || ''))

line('\n===== 2. 真实渲染 /team（所有者） =====')
const bundlePath = path.join(ROOT, '_link_bundle.mjs')

// CSS 在本测试里无关紧要：用插件把它替换成空模块，避免 esbuild 要求 output path。
const cssStubPlugin = {
  name: 'css-stub',
  setup(b) {
    b.onResolve({ filter: /\.css$/ }, (args) => ({ path: args.path, namespace: 'css-stub' }))
    b.onLoad({ filter: /.*/, namespace: 'css-stub' }, () => ({ contents: 'export default {}', loader: 'js' }))
  },
}

const build = async () => {
  const esbuild = await import('esbuild')
  const r = await esbuild.build({
    entryPoints: [path.join(ROOT, 'src/main.jsx')],
    bundle: true, write: false, format: 'esm', jsx: 'automatic',
    loader: { '.jsx': 'jsx', '.svg': 'dataurl' },
    external: ['react', 'react-dom', 'react-dom/client'],
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [cssStubPlugin],
    logLevel: 'silent',
  })
  fs.writeFileSync(bundlePath, r.outputFiles[0].text)
}
try { await build() } catch (e) { line('构建失败：' + (e?.message || e)) }

const teamOverview = {
  organization: {
    id: 'org_link', slug: SLUG, name: '链接测试团队', ownerUserId: OWNER, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-17T00:00:00.000Z',
    members: [
      { id: 'm_owner', userId: OWNER, displayName: '团队所有者', email: '', phone: '', role: 'owner', status: 'active' },
      { id: 'm_member', userId: MEMBER, displayName: '新名字王一博', email: 'wang@example.com', phone: '', role: 'member', status: 'active' },
    ],
  },
  canManage: true,
  plan: { id: 'enterprise', label: '企业版', team: true, permanent: true, totalBytes: 1073741824 },
  capacity: { totalBytes: 1073741824, usedBytes: 1024, shareCount: 0, collectionCount: 0, fileCount: 0 },
  memberUsage: [
    { id: 'm_owner', userId: OWNER, displayName: '团队所有者', email: '', phone: '', role: 'owner', status: 'active', shareCount: 0, collectionCount: 0, fileCount: 0, usedBytes: 0 },
    { id: 'm_member', userId: MEMBER, displayName: '新名字王一博', email: 'wang@example.com', phone: '', role: 'member', status: 'active', shareCount: 0, collectionCount: 0, fileCount: 0, usedBytes: 1024 },
  ],
  joinRequests: [{ id: 'm_req', requestId: 'jr_9', userId: 'u_p_1', displayName: '申请者李四', email: 'li@example.com', phone: '', message: '想加入', requestedAt: '2026-09-17T00:00:00.000Z' }],
  resources: [],
}

const workspacePayload = {
  plan: { id: 'enterprise', label: '企业版', team: true, permanent: true, totalBytes: 1073741824 },
  planStartedAt: '2026-09-01T00:00:00.000Z', planExpiresAt: null,
  plans: [{ id: 'enterprise', label: '企业版', team: true, permanent: true, totalBytes: 1073741824 }],
  capacity: { totalBytes: 1073741824, usedBytes: 1024, shareCount: 0, collectionCount: 0, fileCount: 0 },
  organization: { id: 'org_link', slug: SLUG, name: '链接测试团队', ownerUserId: OWNER, members: [{ id: 'm_owner', userId: OWNER, displayName: '团队所有者', email: '', phone: '', role: 'owner', status: 'active', canRemove: false }] },
  canManage: true, orders: [],
}

const render = async (route, stubs, tag) => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: `http://localhost${route}`, pretendToBeVisual: true })
  const errors = []
  global.window = dom.window
  global.document = dom.window.document
  global.HTMLElement = dom.window.HTMLElement
  global.Node = dom.window.Node
  global.Event = dom.window.Event
  global.CustomEvent = dom.window.CustomEvent
  global.localStorage = dom.window.localStorage
  global.location = dom.window.location
  global.getComputedStyle = dom.window.getComputedStyle
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true })
  dom.window.matchMedia = dom.window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))
  global.fetch = async (url) => {
    const u = String(url)
    for (const [k, v] of Object.entries(stubs)) if (u.includes(k)) return { ok: true, status: 200, json: async () => v, text: async () => JSON.stringify(v) }
    return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' }
  }
  const orig = console.error
  console.error = (...a) => { const s = a.map(String).join(' '); if (!/createRoot\(\) on a container|not wrapped in act/.test(s)) errors.push(s) }
  try {
    dom.window.history.pushState({}, '', route)
    await import(`${pathToFileURL(bundlePath).href}?v=${encodeURIComponent(tag)}`)
    await new Promise((r) => setTimeout(r, 320))
  } finally { console.error = orig }
  return { html: dom.window.document.getElementById('root')?.innerHTML || '', errors }
}

// /team 需要登录 + 团队总览
const teamStubs = { '/api/auth/me': { user: { id: OWNER, nickname: '团队所有者' } }, '/api/account/team/overview': teamOverview }
const wsStubs = { '/api/auth/me': { user: { id: OWNER, nickname: '团队所有者' } }, '/api/account/workspace': workspacePayload }

try {
  const team = await render('/team', teamStubs, 'team')
  check('/team 无渲染异常', team.errors.length === 0, team.errors.slice(0, 2).join(' | ') || 'clean')
  check('★ /team 出现邀请链接卡', /team-invite-link-card/.test(team.html))
  check('/team 链接含企业专属路径', new RegExp(`/e/${SLUG}/share/`).test(team.html), `/e/${SLUG}/share/`)
  check('★ /team 有复制链接按钮', /复制链接/.test(team.html))
  check('/team 邀请说明文案正确', /申请会出现在「入团申请」里由你审批/.test(team.html))
  check('★ /team 成员显示改后新昵称', /新名字王一博/.test(team.html))
  check('/team 旧昵称已消失', !/老名字/.test(team.html))
  check('/team 入团申请 tab 仍在', /入团申请/.test(team.html))

  const ws = await render('/workspace', wsStubs, 'ws')
  check('/workspace 无渲染异常', ws.errors.length === 0, ws.errors.slice(0, 2).join(' | ') || 'clean')
  check('★ /workspace 出现邀请链接', /workspace-invite-link/.test(ws.html))
  check('★ /workspace 有复制按钮', /复制/.test(ws.html))
  check('/workspace 链接含企业专属路径', new RegExp(`/e/${SLUG}/share/`).test(ws.html))
  check('/workspace 无「企业专属标识」残留', !/企业专属标识/.test(ws.html))
} catch (e) {
  line('渲染异常：' + (e?.stack || e))
} finally {
  try { fs.unlinkSync(bundlePath) } catch {}
}

const failed = results.filter((l) => l.includes('FAIL')).length
const total = results.filter((l) => l.includes('PASS') || l.includes('FAIL')).length
line(`\n结果：${total - failed}/${total} 通过`)
process.exit(failed ? 1 : 0)
