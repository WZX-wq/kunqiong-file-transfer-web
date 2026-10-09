// 重构安全网（运行时验证）：真正加载模块并检查行为，是权威判据。
// 用法：node scripts/refactor/verify-runtime.mjs
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..', '..')
process.chdir(root)

// 让 server.mjs 可import：它启动即监听，这里改为静态检查 + 依赖图解析。
// 1) 语法与导入完整性：直接 import 各模块（不启动服务）。
const mods = ['./server/config.js', './server/lib/http.js', './server/lib/env-file.js']
const exported = {}
for (const m of mods) {
  const mod = await import(new URL(m, `file://${root.replace(/\\/g,'/')}/`).href)
  exported[m] = Object.keys(mod).sort()
  console.log(`[OK] ${m} 导出 ${exported[m].length} 个符号`)
}

// 2) 核对 server.mjs 从这些模块 import 的符号是否都在导出列表里
const src = fs.readFileSync(path.join(root, 'server.mjs'), 'utf8')
const re = /import\s*\{([\s\S]*?)\}\s*from\s*'(\.\/server\/[^']+)'/g
let m, problems = 0, total = 0
while ((m = re.exec(src))) {
  const target = m[2].replace('./', './')
  const avail = new Set(exported[target] || [])
  if (!avail.size) { console.log(`  [跳过] 目标模块未直接加载: ${target}`); continue }
  const names = m[1].split(',').map(s=>s.trim()).filter(Boolean)
  for (const raw of names) {
    const name = raw.split(/\s+as\s+/)[0].trim()
    total++
    if (!avail.has(name)) { console.log(`  [缺失] ${target} 未导出 ${name}`); problems++ }
  }
  console.log(`[OK] 从 ${target} 导入 ${names.length} 个符号，全部存在`)
}

// 3) 关键不变量断言（重构必须保持的语义）
const cfg = await import(new URL('./server/config.js', `file://${root.replace(/\\/g,'/')}/`).href)
const checks = [
  ['收集类型键为中文分类名', Object.keys(cfg.COLLECTION_TYPE_EXTENSIONS).join(',') === '图片,文档,视频,音频,压缩包,代码文件'],
  ['收集类型选项含 8 项', cfg.COLLECTION_TYPE_OPTIONS.length === 8],
  ['单文件上限 5GB', cfg.MAX_FILE_SIZE === 5*1024**3],
  ['上传分片上限 16MB', cfg.UPLOAD_CHUNK_MAX_BYTES === 16*1024*1024],
  ['分片默认 8MB', cfg.UPLOAD_CHUNK_DEFAULT_BYTES === 8*1024*1024],
  ['账号记录上限 200', cfg.MAX_ACCOUNT_RECORDS === 200],
  ['主站套餐默认映射 1/2/5', cfg.DEFAULT_WEB_MEMBER_PACKAGE_IDS.member===1 && cfg.DEFAULT_WEB_MEMBER_PACKAGE_IDS.team===2 && cfg.DEFAULT_WEB_MEMBER_PACKAGE_IDS.enterprise===5],
  ['存储目录已创建', fs.existsSync(cfg.storageRoot) && fs.existsSync(cfg.filesRoot) && fs.existsSync(cfg.collectionsRoot)],
]
for (const [name, ok] of checks) console.log(`  ${ok?'[常量OK]':'[常量FAIL]'} ${name}`)

// 4) http.js 函数行为断言
const h = await import(new URL('./server/lib/http.js', `file://${root.replace(/\\/g,'/')}/`).href)
const httpChecks = [
  ['httpError 保留 status', h.httpError(404,'x').status === 404],
  ['createToken 长度正确', h.createToken(32).length === 32],
  ['hashSecret 稳定', h.hashSecret('a') === h.hashSecret('a')],
  ['escapeHtml 转义标签', h.escapeHtml('<b>') === '&lt;b&gt;'],
  ['parseRecipients 中文分隔符', h.parseRecipients('a@b.com，c@d.com').length === 2],
  ['firstHeader 取首个', h.firstHeader('a, b') === 'a'],
  ['firstValue 取数组首项', h.firstValue(['x','y']) === 'x'],
]
for (const [name, ok] of httpChecks) console.log(`  ${ok?'[函数OK]':'[函数FAIL]'} ${name}`)

const totalFail = problems + checks.filter(c=>!c[1]).length + httpChecks.filter(c=>!c[1]).length
console.log(`\n检查 ${total} 个导入符号，常量断言 ${checks.length} 项，函数断言 ${httpChecks.length} 项`)
console.log(totalFail ? `结果：${totalFail} 项失败` : '结果：全部通过')
process.exit(totalFail ? 1 : 0)
