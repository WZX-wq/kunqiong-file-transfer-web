// 符号定位器 —— 取代手写行号。
//
// 拆分 `server.mjs` / `src/main.jsx` 时，方案里的行号会随每次编辑失效。
// 本脚本按符号边界输出当前行号，施工前重跑、取当次结果，不手抄。
//
// 用法：
//   npm run verify:locate                    # 默认扫描 server.mjs
//   node scripts/refactor/locate.mjs server  # 同上
//   node scripts/refactor/locate.mjs front   # 扫描 src/main.jsx
//   node scripts/refactor/locate.mjs server --routes    # 只看路由注册
//   node scripts/refactor/locate.mjs server --state     # 只看可变状态
//   node scripts/refactor/locate.mjs server --json      # 机器可读
//
// 退出码：0 = 正常；1 = 解析失败或前置断言不通过

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const require = createRequire(`${root}/package.json`)
const parser = require('@babel/parser')

const TARGETS = {
  server: { file: 'server.mjs', jsx: false },
  front: { file: 'src/main.jsx', jsx: true },
}

const args = process.argv.slice(2)
const which = args.find((a) => !a.startsWith('--')) || 'server'
const flags = new Set(args.filter((a) => a.startsWith('--')))
const target = TARGETS[which]

if (!target) {
  console.error(`未知目标 "${which}"，可选：${Object.keys(TARGETS).join(' / ')}`)
  process.exit(1)
}

const abs = path.join(root, target.file)
if (!fs.existsSync(abs)) {
  console.error(`文件不存在：${target.file}`)
  process.exit(1)
}

const code = fs.readFileSync(abs, 'utf8')
let ast
try {
  ast = parser.parse(code, {
    sourceType: 'module',
    plugins: ['jsx', 'topLevelAwait', 'dynamicImport', 'importMeta'],
    errorRecovery: false,
  })
} catch (err) {
  console.error(`${target.file} 解析失败：${err.message}`)
  process.exit(1)
}

const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all', 'use'])
const out = {
  file: target.file,
  totalLines: code.split(/\r?\n/).length - 1,
  bytes: Buffer.byteLength(code),
  scannedAt: new Date().toISOString(),
  functions: [],
  routes: [],
  stateMaps: [],
  stateLets: [],
  constants: [],
  imports: [],
  inlineHandlers: [],
  topLevelStatements: 0,
}

for (const node of ast.program.body) {
  out.topLevelStatements++
  const s = node.loc.start.line
  const e = node.loc.end.line

  if (node.type === 'FunctionDeclaration') {
    out.functions.push({ name: node.id?.name || '(匿名)', start: s, end: e, lines: e - s + 1 })
    continue
  }

  if (node.type === 'VariableDeclaration') {
    for (const d of node.declarations) {
      const name = d.id.type === 'Identifier' ? d.id.name : '(解构)'
      const ini = d.init?.type
      const callee = d.init?.callee?.name

      if (ini === 'NewExpression' && (callee === 'Map' || callee === 'Set')) {
        // 只读常量集合与可变运行期状态要分开：前者可直接搬，后者要进 state.js
        const READONLY = new Set(['LOOPBACK_HOSTS', 'TEXT_PREVIEW_EXTENSIONS', 'METADATA_MERGE_RULES'])
        out.stateMaps.push({ name, kind: callee, start: s, mutable: !READONLY.has(name) })
      }
      if (node.kind === 'let') {
        out.stateLets.push({ name, start: s, init: ini })
      }
      if (node.kind === 'const' && !['ArrowFunctionExpression', 'FunctionExpression'].includes(ini)) {
        out.constants.push({ name, start: s, end: e, lines: e - s + 1, init: ini })
      }
    }
    continue
  }

  if (node.type === 'ImportDeclaration') {
    out.imports.push({
      source: node.source.value,
      start: s,
      symbols: node.specifiers.filter((sp) => sp.imported).map((sp) => sp.imported.name),
    })
    continue
  }

  if (node.type === 'ExpressionStatement' && node.expression.type === 'CallExpression') {
    const callee = node.expression.callee
    if (callee.type === 'MemberExpression' && callee.object.type === 'Identifier') {
      const owner = callee.object.name
      const method = callee.property.name || callee.property.value
      const arg0 = node.expression.arguments[0]
      let routePath = ''
      if (arg0?.type === 'StringLiteral') routePath = arg0.value
      else if (arg0?.type === 'TemplateLiteral') routePath = arg0.quasis.map((q) => q.value.cooked).join('${}')

      const handler = node.expression.arguments.find(
        (a) => a.type === 'ArrowFunctionExpression' || a.type === 'FunctionExpression'
      )

      if (owner === 'app' && METHODS.has(method)) {
        out.routes.push({
          method, path: routePath, start: s, end: e, lines: e - s + 1,
          handlerStart: handler?.loc.start.line || null,
          handlerLines: handler ? handler.loc.end.line - handler.loc.start.line + 1 : 0,
        })
      }
    }
    continue
  }

  // 顶层 else 分支（如 class / if / for）也记录，便于确认没有被漏掉的东西
  out.topLevelStatements--
  out.topLevelStatements++
}

// 前端：组件内的内联 handler（const xxx = () => {}）
if (target.jsx) {
  for (const node of ast.program.body) {
    if (node.type !== 'FunctionDeclaration') continue
    for (const stmt of node.body?.body || []) {
      if (stmt.type !== 'VariableDeclaration') continue
      for (const d of stmt.declarations) {
        const ini = d.init?.type
        if (ini !== 'ArrowFunctionExpression' && ini !== 'FunctionExpression') continue
        out.inlineHandlers.push({
          owner: node.id.name,
          name: d.id.name,
          start: d.loc.start.line,
          end: d.loc.end.line,
          lines: d.loc.end.line - d.loc.start.line + 1,
          async: !!d.init.async,
        })
      }
    }
  }
}

// ---------- 输出 ----------
if (flags.has('--json')) {
  console.log(JSON.stringify(out, null, 2))
  process.exit(0)
}

const yes = (n) => String(n).padStart(5)
const line = (a, b) => `行${String(a).padStart(5)}-${String(b).padEnd(5)}`

console.log(`文件：${out.file}`)
console.log(`行数：${out.totalLines}    字节：${out.bytes}    顶层语句：${out.topLevelStatements}`)
console.log(`扫描时间：${out.scannedAt}`)
console.log()

const only = (f) => flags.has(`--${f}`)
const showAll = !['routes', 'state', 'fn', 'imports'].some((f) => flags.has(`--${f}`))

if (showAll || only('state')) {
  console.log(`【可变状态：Map/Set】${out.stateMaps.filter((m) => m.mutable).length} 个可变 + ${out.stateMaps.filter((m) => !m.mutable).length} 个只读`)
  out.stateMaps.forEach((m) =>
    console.log(`  ${yes(m.start)}  ${m.name}  (${m.kind})  ${m.mutable ? '← 需进 state.js' : '只读常量'}`))
  console.log()
  console.log(`【可变状态：let 标量】${out.stateLets.length} 个 ← 必须改成容器，ESM 导入绑定只读`)
  out.stateLets.forEach((v) => console.log(`  ${yes(v.start)}  ${v.name}  <${v.init}>`))
  console.log()
}

if (showAll || only('routes')) {
  const total = out.routes.reduce((s, r) => s + r.handlerLines, 0)
  console.log(`【路由注册】${out.routes.length} 条，内联处理器合计 ${total} 行`)
  out.routes.forEach((r) =>
    console.log(`  ${line(r.start, r.end)} ${String(r.lines).padStart(4)}行  ${r.method.toUpperCase().padEnd(6)} ${r.path || '(中间件)'}`))
  console.log()
}

if (showAll || only('fn')) {
  const sorted = out.functions.slice().sort((a, b) => b.lines - a.lines)
  console.log(`【函数】共 ${out.functions.length} 个，最长 20 个：`)
  sorted.slice(0, 20).forEach((f, i) =>
    console.log(`  ${String(i + 1).padStart(3)}. ${yes(f.lines)} 行  ${line(f.start, f.end)}  ${f.name}`))
  console.log()
}

if (showAll || only('imports')) {
  console.log(`【import】${out.imports.length} 条`)
  out.imports.forEach((i) =>
    console.log(`  ${yes(i.start)}  ${i.source}${i.symbols.length ? `  (${i.symbols.length} 个符号)` : ''}`))
  console.log()
}

if (target.jsx && out.inlineHandlers.length) {
  const byOwner = {}
  for (const h of out.inlineHandlers) (byOwner[h.owner] ||= []).push(h)
  console.log('【组件内联 handler】')
  for (const [owner, list] of Object.entries(byOwner)) {
    if (list.length < 3) continue
    const total = list.reduce((s, h) => s + h.lines, 0)
    console.log(`  ${owner}：${list.length} 个 handler，合计 ${total} 行`)
    list.forEach((h) => console.log(`      ${yes(h.start)}  ${String(h.lines).padStart(4)}行  ${h.async ? 'async ' : ''}${h.name}`))
  }
  console.log()
}

// ---------- 断言：结构完整性 ----------
const problems = []
if (out.functions.length === 0 && out.routes.length === 0) problems.push('既没有函数也没有路由，可能解析不完整')
// app.use 无路径参数是合法的中间件注册；只有 HTTP 方法路由才要求带路径
for (const r of out.routes) {
  if (r.method === 'use') continue
  if (!r.path) problems.push(`路由缺路径：行 ${r.start}（${r.method.toUpperCase()}）`)
}
const dupNames = out.functions.map((f) => f.name).filter((n, i, a) => a.indexOf(n) !== i)
if (dupNames.length) problems.push(`函数重名：${[...new Set(dupNames)].join(', ')}`)

if (problems.length) {
  console.log('【断言未通过】')
  problems.forEach((p) => console.log(`  ✗ ${p}`))
  process.exit(1)
}
console.log('【断言通过】符号边界完整，可用于施工定位')
