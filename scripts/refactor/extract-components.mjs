// 通用组件/函数抽取器：按符号名从 main.jsx 抽取一组顶层声明到新文件。
// 用法：
//   node scripts/refactor/extract-components.mjs <输出文件> <符号名1> <符号名2> ...
// 行为：
//   - AST 精确提取（FunctionDeclaration / ClassDeclaration / 单声明 VariableDeclaration）
//   - 自动分析自由符号，生成 import 头（import 进来的符号按来源归类）
//   - 若发现「main 残留顶层符号」被引用但未纳入抽取，会报错提示（避免循环 import）
//   - 从 main.jsx 删除已抽取声明，并在 styles.css import 前追加一条 import
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(path.join(process.cwd(), 'package.json'))
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default

const MAIN = 'src/main.jsx'
const outFile = process.argv[2]
const names = process.argv.slice(3)
if (!outFile || names.length === 0) {
  console.error('用法: node extract-components.mjs <输出文件> <符号名>...')
  process.exit(1)
}

const code = fs.readFileSync(MAIN, 'utf8')
const ast = parser.parse(code, { sourceType: 'module', plugins: ['jsx', 'topLevelAwait', 'dynamicImport', 'importMeta'] })

const targets = new Set(names)
const toExtract = []
const allTopDefs = new Set()
const importSources = new Map()

for (const node of ast.program.body) {
  if (node.type === 'ImportDeclaration') {
    for (const sp of node.specifiers) importSources.set(sp.local.name, node.source.value)
    continue
  }
  let name = null
  if (node.type === 'FunctionDeclaration' && node.id) name = node.id.name
  else if (node.type === 'ClassDeclaration' && node.id) name = node.id.name
  else if (node.type === 'VariableDeclaration' && node.declarations.length === 1) {
    const d = node.declarations[0]
    if (d.id.type === 'Identifier' && ['ArrowFunctionExpression', 'FunctionExpression'].includes(d.init?.type)) name = d.id.name
  }
  if (name) allTopDefs.add(name)
  if (name && targets.has(name)) {
    toExtract.push({ name, start: node.loc.start.line, end: node.loc.end.line,
      source: code.split('\n').slice(node.loc.start.line - 1, node.loc.end.line).join('\n') })
  }
}

if (toExtract.length === 0) { console.error('未找到目标符号'); process.exit(1) }
const extractedNames = new Set(toExtract.map(t => t.name))

const GLOBALS = new Set(['window','document','navigator','localStorage','sessionStorage','console','URL','URLSearchParams','Image','Blob','FileReader','File','Date','Math','JSON','Promise','Array','Object','String','Number','Boolean','Map','Set','WeakMap','WeakSet','RegExp','Error','TypeError','RangeError','parseInt','parseFloat','isNaN','isFinite','encodeURIComponent','decodeURIComponent','setTimeout','clearTimeout','setInterval','clearInterval','fetch','crypto','alert','confirm','prompt','location','history','undefined','NaN','Infinity','Intl','AbortController','TextEncoder','TextDecoder','Uint8Array','ArrayBuffer','requestAnimationFrame','cancelAnimationFrame','performance','customElements','HTMLElement','Event','CustomEvent','KeyboardEvent','MouseEvent','PointerEvent','FormData','DOMParser','XMLSerializer','getComputedStyle','matchMedia','ResizeObserver','IntersectionObserver','MutationObserver','Worker','WebSocket','structuredClone','queueMicrotask','Symbol','Proxy','Reflect','BigInt','SharedArrayBuffer','DataView','Float32Array','Float64Array','Int8Array','Int16Array','Int32Array','Uint8ClampedArray','Uint16Array','Uint32Array','TextMetrics','OffscreenCanvas','TransformStream','ReadableStream','WritableStream','Request','Response','Headers','XMLHttpRequest','process','globalThis','CSS','ClipboardItem','XLSX','mammoth','PPTXViewer','sanitizeOfficeHtml','React'])

const freeSymbols = new Map()
for (const t of toExtract) {
  const frag = parser.parse(t.source, { sourceType: 'module', plugins: ['jsx'] })
  const free = new Set()
  traverse(frag, {
    Identifier(path) {
      if (!path.isReferencedIdentifier()) return
      const n = path.node.name
      if (GLOBALS.has(n)) return
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(n)) return
      if (path.scope.getBinding(n)) return
      free.add(n)
    },
    JSXIdentifier(path) {
      const n = path.node.name
      if (!/^[A-Z]/.test(n)) return
      if (path.scope.getBinding(n)) return
      free.add(n)
    }
  })
  freeSymbols.set(t.name, free)
}

const needImport = new Map()
const mainResidual = new Set()
for (const t of toExtract) {
  for (const sym of freeSymbols.get(t.name)) {
    if (extractedNames.has(sym)) continue
    if (importSources.has(sym)) needImport.set(sym, importSources.get(sym))
    else if (allTopDefs.has(sym)) mainResidual.add(sym)
  }
}

if (mainResidual.size) {
  console.error(`错误：以下符号仍在 main.jsx 顶层，但被抽取内容引用，请一并纳入抽取清单：`)
  console.error([...mainResidual].join(', '))
  process.exit(1)
}

// 相对路径调整：importSources 里的 source 是相对 src/ 的（如 ./lib/api.js），
// 新文件可能在 src/components/ 或 src/pages/ 下，需要重新计算相对路径。
const outAbs = path.resolve(outFile)
const outDir = path.dirname(outAbs)
const srcDir = path.join(process.cwd(), 'src')

function rebaseRelative(src) {
  if (!src.startsWith('.')) return src // 非相对（如 lucide-react / react）
  const absSrc = path.resolve(srcDir, src)
  let rel = path.relative(outDir, absSrc).replace(/\\/g, '/')
  if (!rel.startsWith('.')) rel = './' + rel
  return rel
}

const externalBySource = new Map()
for (const [sym, src] of needImport) {
  if (!externalBySource.has(src)) externalBySource.set(src, [])
  externalBySource.get(src).push(sym)
}
let header = ''
for (const [src, syms] of externalBySource) {
  header += `import { ${[...new Set(syms)].sort().join(', ')} } from '${rebaseRelative(src)}'\n`
}
if (header) header += '\n'

const body = toExtract.map(t => {
  // 给顶层声明加 export（函数/类）
  const src = t.source.replace(/^(async )?function /, 'export $1function ').replace(/^class /, 'export class ').replace(/^const /, 'export const ')
  return src
}).join('\n\n') + '\n'
let newContent = header + body
// classic JSX runtime（payment-ui 测试走 vite build 无 react 插件）要求显式 import React；
// 只要抽取内容含 JSX 且输出是 .jsx，就补一条默认导入。
if (outFile.endsWith('.jsx') && /<[A-Za-z][^>]*>/.test(body) && !header.includes("import React from 'react'")) {
  newContent = "import React from 'react'\n" + newContent
}
fs.writeFileSync(outFile, newContent)
console.log(`已生成 ${outFile}（${toExtract.length} 个符号，${newContent.split('\n').length} 行）`)

const lines = code.split('\n')
const sorted = toExtract.slice().sort((a, b) => b.start - a.start)
for (const t of sorted) lines.splice(t.start - 1, t.end - t.start + 1)

const rel = path.relative(path.dirname(MAIN), outFile).replace(/\\/g, '/').replace(/^\.\.\//, '')
const importLine = `import { ${toExtract.map(t => t.name).sort().join(', ')} } from './${rel}'`
const cssIdx = lines.findIndex(l => l.includes("'./styles.css'"))
lines.splice(cssIdx >= 0 ? cssIdx : 0, 0, importLine)

fs.writeFileSync(MAIN, lines.join('\n'))
console.log(`已从 main.jsx 删除并追加 import`)
