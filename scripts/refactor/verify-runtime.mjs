// 重构安全网 —— 服务端模块图校验 + 运行时行为断言。
//
// 用法：npm run verify:refactor
//
// 拆分 `server.mjs` 期间本脚本是唯一的安全网，做六件事：
//   1) 模块发现：server.mjs + server/**/*.js 全量纳入（不再硬编码文件清单）
//   2) 静态解析：用 @babel/parser 抽取每个文件的 import/export
//   3) 符号解析：校验具名导入在目标模块确有导出（含 `export ... from` 再导出）
//   4) 环检测：报告循环依赖（ESM 下成环不抛错，表现为运行期 undefined，必须静态抓）
//   5) 分层方向：校验依赖方向符合 ARCHITECTURE.md 的约定
//   6) 运行时断言：常量不变量 + 纯函数行为（权威判据，沿用原脚本）
//
// 退出码：0 = 全部通过；1 = 有失败项

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..', '..')
process.chdir(root)

const require = createRequire(`${root.replace(/\\/g, '/')}/package.json`)
const parser = require('@babel/parser')

const fails = []
const fail = (msg) => { fails.push(msg); console.log(`  [FAIL] ${msg}`) }

// ─────────────────────────────────────────────────────────
// 1) 模块发现
// ─────────────────────────────────────────────────────────
const MODULE_ROOTS = ['server.mjs', 'server']
const modules = []

function collect(abs, rel) {
  const st = fs.statSync(abs)
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(abs)) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      collect(path.join(abs, name), `${rel}/${name}`)
    }
    return
  }
  if (!/\.(m?js)$/.test(rel)) return
  modules.push({ rel: rel.replace(/\\/g, '/'), abs })
}

for (const r of MODULE_ROOTS) {
  const abs = path.join(root, r)
  if (fs.existsSync(abs)) collect(abs, r)
}

modules.sort((a, b) => a.rel.localeCompare(b.rel))
console.log(`发现 ${modules.length} 个模块：`)
modules.forEach((m) => console.log(`  ${m.rel}`))
console.log()

// ─────────────────────────────────────────────────────────
// 2) 静态解析 import / export
// ─────────────────────────────────────────────────────────
function parseModule(mod) {
  const code = fs.readFileSync(mod.abs, 'utf8')
  const ast = parser.parse(code, {
    sourceType: 'module',
    plugins: ['topLevelAwait', 'dynamicImport', 'importMeta'],
    errorRecovery: false,
  })

  const imports = []      // { source, named[], default[], namespace[] }
  const exports = new Set()
  const reExports = []    // { source, names: [...] | '*' }
  const referenced = new Set()   // 被引用的标识符（用于未使用导入检测）
  let hasDefault = false

  // 收集引用：跳过导入声明本身（它不构成“使用”）、非计算属性名、对象字面量的键
  const collectRefs = (node, parent, key) => {
    if (!node || typeof node.type !== 'string') return
    if (node.type === 'ImportDeclaration') return
    if (node.type === 'Identifier') {
      const isPropKey = parent && (
        (parent.type === 'MemberExpression' && key === 'property' && !parent.computed) ||
        (parent.type === 'ObjectProperty' && key === 'key' && !parent.computed) ||
        (parent.type === 'ObjectMethod' && key === 'key' && !parent.computed) ||
        (parent.type === 'ClassMethod' && key === 'key' && !parent.computed)
      )
      const isDeclId = parent && key === 'id' &&
        ['FunctionDeclaration', 'ClassDeclaration', 'VariableDeclarator'].includes(parent.type)
      const isFnParam = parent && parent.type === 'FunctionDeclaration' && key === 'params'
      if (!isPropKey && !isDeclId && !isFnParam) referenced.add(node.name)
      return
    }
    if (node.type === 'JSXIdentifier') { referenced.add(node.name); return }
    for (const k in node) {
      if (k === 'loc' || k.includes('omment')) continue
      const v = node[k]
      if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') collectRefs(c, node, k) }
      else if (v && typeof v.type === 'string') collectRefs(v, node, k)
    }
  }

  for (const node of ast.program.body) {
    if (node.type === 'ImportDeclaration') {
      const names = { named: [], default: [], namespace: [] }
      for (const sp of node.specifiers) {
        if (sp.type === 'ImportSpecifier') names.named.push({ imported: sp.imported.name, local: sp.local.name })
        else if (sp.type === 'ImportDefaultSpecifier') names.default.push(sp.local.name)
        else if (sp.type === 'ImportNamespaceSpecifier') names.namespace.push(sp.local.name)
      }
      imports.push({ source: node.source.value, ...names })
      continue
    }
    if (node.type === 'ExportNamedDeclaration') {
      if (node.source) reExports.push({ source: node.source.value, names: node.specifiers.map((sp) => sp.local.name) })
      for (const sp of node.specifiers || []) if (sp.type === 'ExportSpecifier') exports.add(sp.exported.name)
      const decl = node.declaration
      if (decl) {
        if (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') {
          if (decl.id) exports.add(decl.id.name)
        } else if (decl.type === 'VariableDeclaration') {
          for (const d of decl.declarations) {
            if (d.id.type === 'Identifier') exports.add(d.id.name)
            else if (d.id.type === 'ObjectPattern') {
              for (const p of d.id.properties) {
                const key = p.key?.name || p.key?.value
                if (key) exports.add(key)
              }
            }
          }
        }
      }
      continue
    }
    if (node.type === 'ExportDefaultDeclaration') { hasDefault = true; continue }
    if (node.type === 'ExportAllDeclaration') { reExports.push({ source: node.source.value, names: '*' }); continue }
  }

  // 收集全文件的标识符引用（collectRefs 已跳过 import 声明，故导入绑定不会被误记为“已使用”）
  collectRefs(ast.program, null, 'program')

  // 顶层声明（导入绑定除外），用于「缺失导入」检测
  const declared = new Set()
  for (const n of ast.program.body) {
    if (n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') { if (n.id) declared.add(n.id.name) }
    else if (n.type === 'VariableDeclaration') {
      for (const d of n.declarations) {
        if (d.id.type === 'Identifier') declared.add(d.id.name)
        else if (d.id.type === 'ObjectPattern') {
          for (const p of d.id.properties) {
            if (p.value?.type === 'Identifier') declared.add(p.value.name)
            else if (p.argument?.type === 'Identifier') declared.add(p.argument.name)
          }
        }
      }
    } else if (n.type === 'ExportNamedDeclaration' && n.declaration) {
      const d = n.declaration
      if (d.id) declared.add(d.id.name)
      else if (d.type === 'VariableDeclaration') for (const v of d.declarations) if (v.id.type === 'Identifier') declared.add(v.id.name)
    }
  }

  return { imports, exports, reExports, hasDefault, referenced, declared, lines: code.split(/\r?\n/).length - 1 }
}

// 相对路径解析：./x → ./x.js | ./x.mjs | ./x/index.js
function resolveRel(fromMod, source) {
  if (!source.startsWith('.')) return null
  const base = path.resolve(path.dirname(fromMod.abs), source)
  const candidates = [base, `${base}.js`, `${base}.mjs`, path.join(base, 'index.js'), path.join(base, 'index.mjs')]
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) {
      const rel = path.relative(root, c).replace(/\\/g, '/')
      return modules.find((m) => m.rel === rel) || null
    }
  }
  return { missing: path.relative(root, base).replace(/\\/g, '/') }
}

const graph = new Map()   // rel -> { mod, imports, exports, reExports, hasDefault, deps:Set }
for (const mod of modules) {
  try {
    graph.set(mod.rel, { mod, ...parseModule(mod), deps: new Set() })
  } catch (err) {
    fail(`${mod.rel} 解析失败：${err.message}`)
  }
}

// ─────────────────────────────────────────────────────────
// 3) 符号解析校验
// ─────────────────────────────────────────────────────────
console.log('依赖符号校验：')
let importCount = 0
const missingModules = []

for (const [rel, node] of graph) {
  for (const imp of node.imports) {
    const target = resolveRel(node.mod, imp.source)
    if (target && target.missing) { missingModules.push(`${rel} → ${imp.source}`); continue }
    if (!target) continue          // 裸包名（express 等），不校验
    node.deps.add(target.rel)
    const t = graph.get(target.rel)
    if (!t) continue

    for (const spec of imp.named) {
      importCount++
      if (t.exports.has(spec.imported)) continue
      if (t.reExports.some((r) => r.names === '*')) {
        console.log(`  [跳过] ${rel} 导入 ${spec.imported}：目标 ${target.rel} 含 export *，无法静态判定`)
        continue
      }
      fail(`${rel} 从 ${target.rel} 导入 ${spec.imported}，但后者未导出该符号`)
    }
    for (const _ of imp.default) {
      importCount++
      if (!t.hasDefault) fail(`${rel} 从 ${target.rel} 导入 default，但后者无默认导出`)
    }
  }
}

// 未使用导入：搬迁后最常见的手尾（搬走了用它的代码，import 忘了删）。
// 反向也说明问题：某符号被 import 却没人用，往往意味着搬迁漏了调用点。
console.log('未使用导入检测：')
let unusedCount = 0
for (const [rel, node] of graph) {
  for (const imp of node.imports) {
    const judge = (name, label) => {
      if (node.referenced.has(name)) return
      unusedCount++
      fail(`${rel} 导入了 ${name}${label}，但全文未引用`)
    }
    for (const n of imp.named) judge(n.local, n.local !== n.imported ? `（来源名 ${n.imported}）` : '')
    for (const n of imp.default) judge(n, '（默认导出）')
    for (const n of imp.namespace) judge(n, '（命名空间）')
  }
}
if (!unusedCount) console.log('  无未使用导入')

// 缺失导入：某符号在本项目其他模块有导出、本文件也引用了它，
// 但既没 import 也没本地声明 —— 运行到那一行就会 ReferenceError。
// 这类问题 import 校验抓不到（根本没有 import 语句），
// 常规启动也未必暴露（引用可能位于某个不常走的分支里，例如 DB 模式）。
// 2026-10-09 的实际案例：config.js 导出 databasePassword/Host/Name/User，
// server.mjs 分别引用却没导入，导致「开 MySQL 就起不来」，且默认路径下完全看不见。
console.log('缺失导入检测：')
const exportIndex = new Map()   // 符号名 -> 导出它的模块
for (const [rel, node] of graph) for (const name of node.exports) if (!exportIndex.has(name)) exportIndex.set(name, rel)

let missingImports = 0
for (const [rel, node] of graph) {
  for (const name of node.referenced) {
    if (node.declared.has(name)) continue
    const owner = exportIndex.get(name)
    if (!owner) continue                 // 非本项目导出（内建/全局/被 import 的第三方），不判
    // 已经 import 进来了就不算缺失
    const importedHere = node.imports.some((imp) =>
      imp.named.some((n) => n.local === name) || imp.default.includes(name) || imp.namespace.includes(name))
    if (importedHere) continue
    missingImports++
    fail(`${rel} 引用了 ${name}（由 ${owner} 导出），但既未 import 也未本地声明 —— 运行到该行会 ReferenceError`)
  }
}
if (!missingImports) console.log('  无缺失导入')

if (missingModules.length) missingModules.forEach((x) => fail(`模块解析失败：${x}`))
const edgeCount = [...graph.values()].reduce((s, n) => s + n.deps.size, 0)
console.log(`  校验 ${importCount} 个具名/默认导入，跨 ${edgeCount} 条模块边\n`)

// ─────────────────────────────────────────────────────────
// 4) 环检测
// ─────────────────────────────────────────────────────────
console.log('循环依赖检测：')
const WHITE = 0, GRAY = 1, BLACK = 2
const color = new Map([...graph.keys()].map((k) => [k, WHITE]))
const cycles = []
const stack = []

function dfs(rel) {
  color.set(rel, GRAY)
  stack.push(rel)
  for (const dep of graph.get(rel).deps) {
    const c = color.get(dep)
    if (c === GRAY) cycles.push([...stack.slice(stack.indexOf(dep)), dep])
    else if (c === WHITE) dfs(dep)
  }
  stack.pop()
  color.set(rel, BLACK)
}
for (const rel of graph.keys()) if (color.get(rel) === WHITE) dfs(rel)

if (cycles.length) {
  const shown = new Set()
  for (const c of cycles) {
    const key = [...c].sort().join('|')
    if (shown.has(key)) continue
    shown.add(key)
    fail(`循环依赖：${c.join(' → ')}`)
  }
} else {
  console.log('  无循环依赖')
}
console.log()

// ─────────────────────────────────────────────────────────
// 5) 结构约束校验
// ─────────────────────────────────────────────────────────
// 不用「目录 = 层次」的粗粒度划分 —— `server/lib/` 本身就跨越多个层次
// （env-file.js 是叶子，config.js 依赖它；而 config.js 又在其他 lib 模块之下），
// 目录分层会误报。改为：
//   a) 从依赖图算出拓扑层级，只做展示（看清结构）
//   b) 用一组显式规则约束真正重要的边界
console.log('结构约束校验：')

const CONSTRAINTS = [
  {
    why: '入口 server.mjs 只能被启动命令引用，不得被任何模块 import',
    from: /^server\//,
    to: /^server\.mjs$/,
  },
  {
    why: 'config.js 是配置层的唯一出口，只能依赖 lib/env-file.js（它在模块顶层调用 loadEnvFile 读 .env）',
    from: /^server\/config\.js$/,
    to: /^server\/lib\/(?!env-file\.js$)/,
  },
  {
    why: '路由只能由入口 server.mjs 引用，业务模块不得反向依赖路由',
    from: /^(server\/|server\.mjs$)/,
    to: /^server\/routes\//,
    allowFrom: /^server\.mjs$/,
  },
  {
    why: '工具层不得依赖路由层',
    from: /^server\/lib\//,
    to: /^server\/routes\//,
  },
  {
    why: '状态容器不得依赖路由层',
    from: /^server\/state\.js$/,
    to: /^server\/routes\//,
  },
  {
    why: 'lib 是基础层，不得依赖业务服务层 services（依赖方向只能 services → lib）',
    from: /^server\/lib\//,
    to: /^server\/services\//,
  },
  {
    why: 'state 是基础层，不得依赖业务服务层 services',
    from: /^server\/state\.js$/,
    to: /^server\/services\//,
  },
  {
    why: 'config 是配置层，不得依赖业务服务层 services',
    from: /^server\/config\.js$/,
    to: /^server\/services\//,
  },
]

let constraintViolations = 0
for (const [rel, node] of graph) {
  for (const dep of node.deps) {
    for (const c of CONSTRAINTS) {
      if (!c.from.test(rel)) continue
      if (!c.to.test(dep)) continue
      if (c.allowFrom && c.allowFrom.test(rel)) continue
      constraintViolations++
      fail(`结构违规：${rel} → ${dep}　（${c.why}）`)
    }
  }
}
if (!constraintViolations) console.log('  未发现结构违规')

// 拓扑层级（最长路径分层），仅展示
const depth = new Map()
const computeDepth = (rel, seen = new Set()) => {
  if (depth.has(rel)) return depth.get(rel)
  if (seen.has(rel)) return 0
  seen.add(rel)
  let d = 0
  for (const dep of graph.get(rel).deps) d = Math.max(d, computeDepth(dep, seen) + 1)
  depth.set(rel, d)
  return d
}
for (const rel of graph.keys()) computeDepth(rel)

const byDepth = {}
for (const [rel, d] of depth) (byDepth[d] ||= []).push(rel)
console.log('  计算层级（层级 = 最长依赖链长度，0 为叶子）：')
Object.keys(byDepth).map(Number).sort((a, b) => a - b).forEach((d) => {
  console.log(`    层${d}: ${byDepth[d].sort().join(', ')}`)
})
const maxDepth = Math.max(...Object.keys(byDepth).map(Number))
console.log(`  最大依赖深度：${maxDepth}（建议不超过 6 —— 过深说明分层失控）`)
if (maxDepth > 6) fail(`依赖深度 ${maxDepth} 超过阈值 6，分层可能失控`)
console.log()

// ─────────────────────────────────────────────────────────
// 6) 运行时断言（权威判据）
// ─────────────────────────────────────────────────────────
const url = (rel) => pathToFileURL(path.join(root, rel)).href

console.log('运行时模块加载：')
for (const mod of modules) {
  if (mod.rel === 'server.mjs') { console.log('  [跳过] server.mjs（启动即监听；已由静态检查覆盖）'); continue }
  try {
    const m = await import(url(mod.rel))
    console.log(`  [OK] ${mod.rel} 导出 ${Object.keys(m).length} 个符号`)
  } catch (err) {
    fail(`${mod.rel} 无法加载：${err.message}`)
  }
}
console.log()

const cfg = await import(url('server/config.js'))
const checks = [
  ['收集类型键为中文分类名', Object.keys(cfg.COLLECTION_TYPE_EXTENSIONS).join(',') === '图片,文档,视频,音频,压缩包,代码文件'],
  ['收集类型选项含 8 项', cfg.COLLECTION_TYPE_OPTIONS.length === 8],
  ['单文件上限 5GB', cfg.MAX_FILE_SIZE === 5 * 1024 ** 3],
  ['上传分片上限 16MB', cfg.UPLOAD_CHUNK_MAX_BYTES === 16 * 1024 * 1024],
  ['分片默认 8MB', cfg.UPLOAD_CHUNK_DEFAULT_BYTES === 8 * 1024 * 1024],
  ['账号记录上限 200', cfg.MAX_ACCOUNT_RECORDS === 200],
  ['主站套餐默认映射 1/2/5', cfg.DEFAULT_WEB_MEMBER_PACKAGE_IDS.member === 1 && cfg.DEFAULT_WEB_MEMBER_PACKAGE_IDS.team === 2 && cfg.DEFAULT_WEB_MEMBER_PACKAGE_IDS.enterprise === 5],
  ['存储目录已创建', fs.existsSync(cfg.storageRoot) && fs.existsSync(cfg.filesRoot) && fs.existsSync(cfg.collectionsRoot)],
]
console.log('常量不变量：')
for (const [name, ok] of checks) console.log(`  ${ok ? '[常量OK]' : '[常量FAIL]'} ${name}`)

const h = await import(url('server/lib/http.js'))
const httpChecks = [
  ['httpError 保留 status', h.httpError(404, 'x').status === 404],
  ['createToken 长度正确', h.createToken(32).length === 32],
  ['hashSecret 稳定', h.hashSecret('a') === h.hashSecret('a')],
  ['escapeHtml 转义标签', h.escapeHtml('<b>') === '&lt;b&gt;'],
  ['parseRecipients 中文分隔符', h.parseRecipients('a@b.com，c@d.com').length === 2],
  ['firstHeader 取首个', h.firstHeader('a, b') === 'a'],
  ['firstValue 取数组首项', h.firstValue(['x', 'y']) === 'x'],
]
console.log('函数行为：')
for (const [name, ok] of httpChecks) console.log(`  ${ok ? '[函数OK]' : '[函数FAIL]'} ${name}`)

// ─────────────────────────────────────────────────────────
// 7) 配置模块的环境分支覆盖
// ─────────────────────────────────────────────────────────
// 起因：config.js 曾有一处 `password: databasePassword` 引用未定义变量，
// 而该行位于 `databaseEnabled ? ... : null` 的三元真分支里 ——
// 默认 KUNQIONG_DB_ENABLED=false 时永远不执行，所以静态检查和常规启动都发现不了；
// 一旦开启 MySQL，import 即抛 ReferenceError，服务完全起不来。
// 教训：带环境分支的模块必须在**每个分支**下各跑一次导入。
console.log('配置模块环境分支覆盖：')
const ENV_CASES = [
  { name: '默认（DB 关闭）', env: {} },
  { name: 'KUNQIONG_DB_ENABLED=true', env: { KUNQIONG_DB_ENABLED: 'true' } },
]
// 注意：这里必须用异步 spawn，不能用 spawnSync ——
// 受限执行环境下 spawnSync 启动子进程会直接 EBUSY（与 execFileSync('git') 同类问题）。
// 同目录下的 verify-metadata-cas.mjs 也是因此改用 spawn。
const runInEnv = (url, extraEnv) => new Promise((resolve) => {
  const cleanEnv = { ...process.env }
  for (const k of Object.keys(cleanEnv)) if (k.startsWith('KUNQIONG_') || k.startsWith('OAUTH_')) delete cleanEnv[k]
  const child = spawn(process.execPath, ['-e', `import(${JSON.stringify(url)}).catch(e=>{console.error(e.constructor.name+': '+e.message);process.exit(1)})`], {
    env: { ...cleanEnv, ...extraEnv },
    cwd: root,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (d) => { stderr += d })
  const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 30000)
  child.on('error', (err) => { clearTimeout(timer); resolve({ code: -1, stderr: err.message }) })
  child.on('close', (code) => { clearTimeout(timer); resolve({ code, stderr }) })
})

const probe = pathToFileURL(path.join(root, 'scripts/refactor/_probe-config.mjs')).href
for (const c of ENV_CASES) {
  const r = await runInEnv(probe, c.env)
  if (r.code === 0) console.log(`  [OK] ${c.name}`)
  else fail(`config.js 在「${c.name}」下无法导入：${(r.stderr || '').trim().split('\n').filter(Boolean)[0] || `exit=${r.code}`}`)
}
console.log()

// ─────────────────────────────────────────────────────────
// 汇总
// ─────────────────────────────────────────────────────────
const constFail = checks.filter((c) => !c[1]).length
const fnFail = httpChecks.filter((c) => !c[1]).length

console.log()
console.log(`模块 ${modules.length} 个 ｜ 导入符号 ${importCount} 个 ｜ 模块边 ${edgeCount} 条 ｜ 最大深度 ${maxDepth}`)
console.log(`常量断言 ${checks.length} 项 ｜ 函数断言 ${httpChecks.length} 项 ｜ 循环依赖 ${cycles.length ? '有' : '无'} ｜ 结构违规 ${constraintViolations} 处`)

const totalFail = fails.length
console.log(totalFail ? `结果：${totalFail} 项失败` : '结果：全部通过')
process.exit(totalFail ? 1 : 0)
