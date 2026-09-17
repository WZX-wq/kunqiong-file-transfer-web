// 验证「实际会被浏览器加载的产物」而不是源码：
// 直接从 dist/ 读 JS + CSS，在 jsdom 里执行，然后断言 lower-row 是否真的包住了两张卡，
// 以及两张卡在 DOM 里是否为同一父节点的兄弟（= 同一行）。
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'

const ROOT = 'C:/Users/admin/Desktop/鲲穹文件传输web'
const logFile = path.join(ROOT, '_served.log')
const results = []
const line = (s) => { results.push(s); try { fs.appendFileSync(logFile, s + '\n') } catch {} }
const check = (l, p, e = '') => line(`  ${p ? 'PASS' : 'FAIL'}  ${l}${e ? ` — ${e}` : ''}`)
try { fs.writeFileSync(logFile, '') } catch {}

const OWNER = 'u_owner_1'
const SLUG = 'team-served'

// 读实际产物
const html = fs.readFileSync(path.join(ROOT, 'dist/index.html'), 'utf8')
const jsName = html.match(/src="\/assets\/([^"]+\.js)"/)?.[1]
const cssName = html.match(/href="\/assets\/([^"]+\.css)"/)?.[1]
line(`产物：js=${jsName} css=${cssName}`)
const cssText = fs.readFileSync(path.join(ROOT, 'dist/assets', cssName), 'utf8')
const jsPath = path.join(ROOT, 'dist/assets', jsName)

line('\n===== 1. 产物中的 CSS =====')
const rowRule = cssText.match(/\.workspace-lower-row\{[^}]*\}/)?.[0] || ''
check('★ 产物含 .workspace-lower-row 两栏规则', /grid-template-columns:\s*minmax\(0,\s*1\.6fr\)\s+minmax\(0,\s*1fr\)/.test(rowRule), rowRule.slice(0, 90))
check('★ lower-row 通栏', /grid-column:1 \/ -1/.test(rowRule))
// 团队卡「不再」写 1 / -1：在只有 2 列的 lower-row 里它会横跨整行、把状态卡挤到下一行。
check('★ team-card 不再横跨整行（不是 grid-column:1 / -1）', !/\.workspace-team-card\{grid-column:1 \/ -1\}/.test(cssText))
check('★ 团队卡显式占第 1 栏', /\.workspace-lower-row>\.workspace-team-card\{grid-column:1 \/ 2\}/.test(cssText) || /\.workspace-lower-row \.workspace-team-card\{grid-column:1 \/ 2\}/.test(cssText))
check('★ 状态卡显式占第 2 栏', /\.workspace-lower-row>\.workspace-status-card\{grid-column:2 \/ 3\}/.test(cssText) || /\.workspace-lower-row \.workspace-status-card\{grid-column:2 \/ 3\}/.test(cssText))
check('★ lower-row 内 public-card 放开 570px 上限', /\.workspace-lower-row>\.public-card\{width:100%;max-width:none\}/.test(cssText))
check('status-card 内不再有 span 3', !/\.workspace-status-card\{grid-column:span 3/.test(cssText))

line('\n===== 2. 产物中的 JSX 结构 =====')
const jsText = fs.readFileSync(jsPath, 'utf8')
check('★ 产物含 workspace-lower-row', /workspace-lower-row/.test(jsText))
// lower-row 的 children 数组里应同时出现 team-card 与 status-card
const rowIdx = jsText.indexOf('workspace-lower-row')
const window1 = jsText.slice(rowIdx, rowIdx + 9000)
check('★ lower-row 内紧跟 team-card', /workspace-team-card/.test(window1.slice(0, 200)))
check('★ lower-row 内包含 status-card', /workspace-status-card/.test(window1))
check('team-body 三段结构在产物内', /workspace-team-body/.test(window1))
check('team-foot 在产物内', /workspace-team-foot/.test(window1))

line('\n===== 3. 真实执行产物体 =====')
const workspacePayload = {
  plan: { id: 'enterprise', label: '企业版', team: true, permanent: true, totalBytes: 2199023255552 },
  planStartedAt: '2026-09-01T00:00:00.000Z', planExpiresAt: null,
  plans: [{ id: 'enterprise', label: '企业版', team: true, permanent: true, totalBytes: 2199023255552 }],
  capacity: { totalBytes: 2199023255552, usedBytes: 100139008, shareCount: 27, collectionCount: 3, fileCount: 52 },
  organization: {
    id: 'org_s', slug: SLUG, name: '奶家帮', ownerUserId: OWNER,
    members: [{ id: 'm_owner', userId: OWNER, displayName: '冰希特', email: '15238882808', phone: '', role: 'owner', status: 'active', canRemove: false }],
  },
  canManage: true, orders: [],
}

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/workspace', pretendToBeVisual: true })
const errors = []
global.window = dom.window; global.document = dom.window.document
global.HTMLElement = dom.window.HTMLElement; global.Node = dom.window.Node
global.Event = dom.window.Event; global.CustomEvent = dom.window.CustomEvent
global.localStorage = dom.window.localStorage; global.location = dom.window.location
global.getComputedStyle = dom.window.getComputedStyle
global.requestAnimationFrame = (cb) => setTimeout(cb, 0)
global.cancelAnimationFrame = (id) => clearTimeout(id)
// React 18 需要 MutationObserver；jsdom 未暴露为全局，这里补上。
global.MutationObserver = dom.window.MutationObserver
global.IntersectionObserver = dom.window.IntersectionObserver || class { observe() {} unobserve() {} disconnect() {} }
global.ResizeObserver = dom.window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} }
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true })
dom.window.matchMedia = dom.window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))
global.fetch = async (url) => {
  const u = String(url)
  if (u.includes('/api/auth/me')) return { ok: true, status: 200, json: async () => ({ user: { id: OWNER, nickname: '冰希特' } }) }
  if (u.includes('/api/account/workspace')) return { ok: true, status: 200, json: async () => workspacePayload }
  return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' }
}
const orig = console.error
console.error = (...a) => { const s = a.map(String).join(' '); if (!/createRoot\(\) on a container|not wrapped in act/.test(s)) errors.push(s) }

// 产物是 ESM，直接 import；它内部会 import css 吗？vite 会把 css 抽离，所以不会。
try {
  dom.window.history.pushState({}, '', '/workspace')
  await import(`${pathToFileURL(jsPath).href}?v=served`)
  await new Promise((r) => setTimeout(r, 420))
} catch (e) {
  line('  执行产物异常：' + (e?.message || e))
} finally { console.error = orig }

const doc = dom.window.document
const root = doc.getElementById('root')
check('产物渲染出内容', (root?.innerHTML || '').length > 200, `len=${(root?.innerHTML || '').length}`)
check('无运行时报错', errors.length === 0, errors.slice(0, 1).join('') || 'clean')

const lower = doc.querySelector('.workspace-lower-row')
const team = doc.querySelector('.workspace-team-card')
const status = doc.querySelector('.workspace-status-card')
const hero = doc.querySelector('.workspace-hero')
const benefits = doc.querySelector('.workspace-benefits-card')

check('★ 存在 lower-row', Boolean(lower))
check('★ team 与 status 是同一父节点的兄弟（= 同一行）', Boolean(team && status) && team.parentElement === status.parentElement && team.parentElement === lower)
check('★ lower-row 是 grid 直接子元素', lower?.parentElement?.classList?.contains('workspace-grid') === true)
check('★ lower-row 与 hero / benefits 同级', lower?.parentElement === hero?.parentElement && lower?.parentElement === benefits?.parentElement)

line('\n===== 4. 用真实 CSS 计算宽度占比 =====')
// 并排布局下，宽度由 lower-row 的 1.6fr:1fr 轨道决定，而不是由各卡自己声明 grid-column。
const spanOf = (sel) => {
  const re = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}')
  const m = cssText.match(re)
  if (!m) return null
  const g = m[1].match(/grid-column:\s*([^;]+)/)
  return g ? g[1].trim() : null
}
const heroCol = spanOf('.workspace-grid .workspace-hero')
const benCol = spanOf('.workspace-benefits-card')
const rowCol = spanOf('.workspace-lower-row')
line(`  hero=${heroCol} | benefits=${benCol} | lower-row=${rowCol}`)
check('★ 三者列跨度一致（都是 1 / -1，宽度相同）', [heroCol, benCol, rowCol].every((v) => v === '1 / -1'))

// 两卡并排必须由 lower-row 的轨道决定；真实像素级验证见 _verify_layout_real.mjs
const track = rowRule.match(/grid-template-columns:\s*([^;]+)/)?.[1] || ''
line(`  lower-row 轨道 = ${track}`)
check('★ 轨道为 1.6fr : 1fr 双栏', /1\.6fr/.test(track) && /\b1fr\b/.test(track))
check('★ 团队卡不自行声明占满整行', spanOf('.workspace-team-card') === null, `team span=${spanOf('.workspace-team-card')}`)

const failed = results.filter((l) => l.includes('FAIL')).length
const total = results.filter((l) => l.includes('PASS') || l.includes('FAIL')).length
line(`\n结果：${total - failed}/${total} 通过`)
process.exit(failed ? 1 : 0)
