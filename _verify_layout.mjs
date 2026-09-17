// 布局验证：团队空间下方两个卡片必须与上方权益卡同宽（通栏），并检查新的内部分区结构。
// 思路：把真实 main.jsx + 真实 styles.css 一起 bundle 进 jsdom 渲染，
// 然后用 getComputedStyle / grid 计算值断言列跨度，而不是靠肉眼。
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'

const ROOT = 'C:/Users/admin/Desktop/鲲穹文件传输web'
const logFile = path.join(ROOT, '_layout.log')
const results = []
const line = (s) => { results.push(s); try { fs.appendFileSync(logFile, s + '\n') } catch {} }
const check = (label, pass, extra = '') => line(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`)
try { fs.writeFileSync(logFile, '') } catch {}

const OWNER = 'u_owner_1'
const SLUG = 'team-layout'
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

line('===== 1. CSS 结构契约 =====')
const css = read('src/styles.css')
// 团队卡「不能」自己写 1 / -1：lower-row 只有 2 列，写了会横跨整行把状态卡挤下去（真实浏览器实测）。
check('团队卡不再横跨整行', !/\.workspace-team-card \{ grid-column: 1 \/ -1; \}/.test(css), '不应有 grid-column: 1/-1')
check('团队卡显式占第 1 栏', /\.workspace-lower-row > \.workspace-team-card \{ grid-column: 1 \/ 2; \}/.test(css))
check('状态卡显式占第 2 栏', /\.workspace-lower-row > \.workspace-status-card \{ grid-column: 2 \/ 3; \}/.test(css))
check('lower-row 内 public-card 放开 570px 上限', /\.workspace-lower-row > \.public-card \{[^}]*max-width: none/.test(css))
check('workspace-grid 用后代选择器覆盖 public-card 宽度', /\.workspace-grid \.public-card \{ width: 100%/.test(css))
check('新增 lower-row 容器', /\.workspace-lower-row \{/.test(css))
check('lower-row 用两栏网格', /\.workspace-lower-row \{[^}]*grid-template-columns: minmax\(0, 1\.6fr\) minmax\(0, 1fr\)/.test(css))
check('状态卡不再单独占列', !/\.workspace-status-card \{ grid-column: span 3/.test(css))
check('新增 team-body 两栏', /\.workspace-team-body \{[^}]*grid-template-columns/.test(css))
check('新增 team-foot 操作条', /\.workspace-team-foot \{/.test(css))
check('区块标签样式存在', /\.workspace-block-label \{/.test(css))
check('owner-summary 在区块内去掉双线', /\.workspace-team-block \.workspace-owner-summary \{[^}]*border-top: 0/.test(css))
// 文件里有多个同名 @media 块，必须按大括号配平取出完整块再判断，否则会匹配到别的断点块。
const mediaBlocks = (query) => {
  const blocks = []
  let p = 0
  while ((p = css.indexOf(query, p)) >= 0) {
    const open = css.indexOf('{', p)
    let depth = 0
    for (let i = open; i < css.length; i += 1) {
      if (css[i] === '{') depth += 1
      else if (css[i] === '}') { depth -= 1; if (depth === 0) { blocks.push(css.slice(p, i + 1)); p = i + 1; break } }
    }
    if (depth !== 0) break
  }
  return blocks
}
const hasIn = (blocks, re) => blocks.some((b) => re.test(b))
const bp900 = mediaBlocks('@media (max-width: 900px)')
const bp650 = mediaBlocks('@media (max-width: 650px)')
check('900px 断点改为堆叠', hasIn(bp900, /\.workspace-lower-row \{ grid-template-columns: minmax\(0, 1fr\)/))
check('650px 断点 team-body 单栏', hasIn(bp650, /\.workspace-team-body \{ grid-template-columns: minmax\(0, 1fr\)/))
check('650px 断点 team-foot 竖排', hasIn(bp650, /\.workspace-team-foot \{ align-items: stretch; flex-direction: column/))
check('650px 断点邀请行换行', hasIn(bp650, /\.workspace-invite-link-row, \.team-invite-link-row \{ flex-wrap: wrap/))

line('\n===== 2. 真实渲染 /workspace =====')
const bundlePath = path.join(ROOT, '_layout_bundle.mjs')
const cssStub = {
  name: 'css-stub',
  setup(b) {
    b.onResolve({ filter: /\.css$/ }, (a) => ({ path: a.path, namespace: 'css-stub' }))
    b.onLoad({ filter: /.*/, namespace: 'css-stub' }, () => ({ contents: 'export default {}', loader: 'js' }))
  },
}
try {
  const esbuild = await import('esbuild')
  const r = await esbuild.build({
    entryPoints: [path.join(ROOT, 'src/main.jsx')],
    bundle: true, write: false, format: 'esm', jsx: 'automatic',
    loader: { '.jsx': 'jsx', '.svg': 'dataurl' },
    external: ['react', 'react-dom', 'react-dom/client'],
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [cssStub], logLevel: 'silent',
  })
  fs.writeFileSync(bundlePath, r.outputFiles[0].text)
} catch (e) { line('构建失败：' + (e?.message || e)) }

const workspacePayload = {
  plan: { id: 'enterprise', label: '企业版', team: true, permanent: true, totalBytes: 1073741824 },
  planStartedAt: '2026-09-01T00:00:00.000Z', planExpiresAt: null,
  plans: [{ id: 'enterprise', label: '企业版', team: true, permanent: true, totalBytes: 1073741824 }],
  capacity: { totalBytes: 1073741824, usedBytes: 1024, shareCount: 0, collectionCount: 0, fileCount: 0 },
  organization: {
    id: 'org_l', slug: SLUG, name: '奶家帮', ownerUserId: OWNER,
    members: [{ id: 'm_owner', userId: OWNER, displayName: '冰希特', email: '15238882808', phone: '', role: 'owner', status: 'active', canRemove: false }],
  },
  canManage: true, orders: [],
}

try {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/workspace', pretendToBeVisual: true })
  const errors = []
  global.window = dom.window; global.document = dom.window.document
  global.HTMLElement = dom.window.HTMLElement; global.Node = dom.window.Node
  global.Event = dom.window.Event; global.CustomEvent = dom.window.CustomEvent
  global.localStorage = dom.window.localStorage; global.location = dom.window.location
  global.getComputedStyle = dom.window.getComputedStyle
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
  try {
    dom.window.history.pushState({}, '', '/workspace')
    await import(`${pathToFileURL(bundlePath).href}?v=layout`)
    await new Promise((r) => setTimeout(r, 350))
  } finally { console.error = orig }

  const doc = dom.window.document
  const html = doc.getElementById('root')?.innerHTML || ''
  check('渲染无异常', errors.length === 0, errors.slice(0, 2).join(' | ') || 'clean')

  const team = doc.querySelector('.workspace-team-card')
  const status = doc.querySelector('.workspace-status-card')
  const benefits = doc.querySelector('.workspace-benefits-card')
  const hero = doc.querySelector('.workspace-hero')
  const lower = doc.querySelector('.workspace-lower-row')

  check('★ 存在 team-card', Boolean(team))
  check('★ 存在 status-card', Boolean(status))
  check('★ 存在 lower-row 容器', Boolean(lower))
  check('★ team/status 同在 lower-row 内', lower?.contains(team) === true && lower?.contains(status) === true)
  // lower-row 本身才是 .workspace-grid 的直接子元素，且与 hero / benefits 同级 —— 宽度由此对齐。
  check('★ lower-row 与 benefits-card 同为 grid 直接子元素', lower?.parentElement === benefits?.parentElement)
  check('★ lower-row 与 hero 同级', lower?.parentElement === hero?.parentElement)
  check('★ lower-row 是 grid 的直接子元素', lower?.parentElement?.classList?.contains('workspace-grid') === true)
  check('team/status 不再直接挂在 grid 上', team?.parentElement?.classList?.contains('workspace-grid') !== true && status?.parentElement?.classList?.contains('workspace-grid') !== true)

  // 内部分区结构
  check('★ team-body 存在', Boolean(doc.querySelector('.workspace-team-body')))
  check('★ team-body 含两个区块', doc.querySelectorAll('.workspace-team-body > .workspace-team-block').length === 2, `n=${doc.querySelectorAll('.workspace-team-body > .workspace-team-block').length}`)
  check('★ team-foot 操作条存在', Boolean(doc.querySelector('.workspace-team-foot')))
  check('团队所有者区块有标签', /团队所有者/.test(html))
  check('邀请链接区块有标签', /团队邀请链接/.test(html))
  check('邀请链接仍渲染', new RegExp(`/e/${SLUG}/share/`).test(html))
  check('复制按钮仍在', /复制/.test(html))
  check('底部含前往团队空间入口', /查看团队成员与使用情况/.test(html))
  check('旧 member-summary 已移除', !doc.querySelector('.workspace-member-summary'))
  check('旧 invite-link 包裹层已移除', !doc.querySelector('.workspace-invite-link-wrap'))
} catch (e) {
  line('渲染异常：' + (e?.stack || e))
} finally {
  try { fs.unlinkSync(bundlePath) } catch {}
}

line('\n===== 3. 计算样式：宽度一致性 =====')
// jsdom 不做真实布局，只能断言「容器级」的列跨度是否一致。
// 两卡并排的真实像素验证在 _verify_layout_real.mjs（真实 Chrome）。
try {
  const cssText = read('src/styles.css')
  const rule = (sel) => {
    const i = cssText.indexOf(sel)
    if (i < 0) return ''
    const end = cssText.indexOf('}', i)
    return cssText.slice(i, end)
  }
  const benefitsRule = rule('.workspace-benefits-card {')
  const heroRule = rule('.workspace-grid .workspace-hero {')
  check('benefits-card 通栏', /grid-column: 1 \/ -1/.test(benefitsRule))
  check('hero 通栏', /grid-column: 1 \/ -1/.test(heroRule))
  check('lower-row 通栏', /grid-column: 1 \/ -1/.test(rule('.workspace-lower-row {')))
  // 团队卡自身只指定占第 1 栏，宽度交给 lower-row 的 1.6fr 轨道。
  check('team-card 占第 1 栏（不自行通栏）', /grid-column: 1 \/ 2/.test(rule('.workspace-lower-row > .workspace-team-card {')) && !/grid-column: 1 \/ -1/.test(rule('.workspace-team-card {')))
} catch (e) { line('样式断言异常：' + (e?.message || e)) }

const failed = results.filter((l) => l.includes('FAIL')).length
const total = results.filter((l) => l.includes('PASS') || l.includes('FAIL')).length
line(`\n结果：${total - failed}/${total} 通过`)
process.exit(failed ? 1 : 0)
