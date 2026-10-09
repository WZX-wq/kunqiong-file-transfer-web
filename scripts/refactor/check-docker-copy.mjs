// 校验 Dockerfile 的 COPY 清单是否自洽 —— 即"照 Dockerfile 复制出来的目录能否真正启动"。
//
// 背景：2026-10-09 发现 Dockerfile 只 COPY server.mjs，漏了 server/ 目录，
// 而 server.mjs 会 import ./server/config.js —— 镜像启动即崩（ERR_MODULE_NOT_FOUND）。
// 手工模拟容易漏，所以这里直接解析 Dockerfile 的 COPY 指令，按它物化一个目录再启动，
// Dockerfile 改了本检查自动跟着变。
//
// 用法（跨平台，不需要 shell 语法）：
//   npm run verify:docker-copy
//   node scripts/refactor/check-docker-copy.mjs
//
// 退出码：0 = 通过；1 = 有缺失依赖或启动失败

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
// 允许指定 Dockerfile，便于回归验证本脚本本身（例如拿一份"漏 COPY server/"的版本来试）
const dockerfileArg = process.argv.slice(2).find((a) => !a.startsWith('--'))
const dockerfile = dockerfileArg ? path.resolve(dockerfileArg) : path.join(root, 'Dockerfile')

if (!fs.existsSync(dockerfile)) {
  console.error('找不到 Dockerfile')
  process.exit(1)
}

const text = fs.readFileSync(dockerfile, 'utf8')
const lines = text.split(/\r?\n/)

// 找出最终运行阶段的 COPY（最后一次 FROM 之后的）
let lastFromIdx = -1
lines.forEach((l, i) => { if (/^\s*FROM\s+/i.test(l)) lastFromIdx = i })

const copies = []
const cmdLine = []
for (let i = lastFromIdx + 1; i < lines.length; i++) {
  const l = lines[i].trim()
  if (!l || l.startsWith('#')) continue
  const m = l.match(/^COPY\s+(?:--from=\S+\s+)?(\S+)\s+(\S+)/i)
  if (m) { copies.push({ src: m[1], dest: m[2] }); continue }
  const c = l.match(/^CMD\s+(.+)$/i)
  if (c) cmdLine.push(c[1])
}

console.log(`Dockerfile 最终阶段（第 ${lastFromIdx + 1} 行起）的 COPY 清单：`)
copies.forEach((c) => console.log(`  ${c.src.padEnd(34)} → ${c.dest}`))
console.log()

// 把 --from=build 的路径映射回仓库内路径
function resolveSrc(src) {
  if (src.startsWith('/app/')) return path.join(root, src.slice('/app/'.length))
  return null
}

// 物化目录
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'kq-docker-check-'))
const missing = []

function copyRecursive(from, to) {
  const st = fs.statSync(from)
  if (st.isDirectory()) {
    fs.mkdirSync(to, { recursive: true })
    for (const name of fs.readdirSync(from)) copyRecursive(path.join(from, name), path.join(to, name))
  } else {
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to)
  }
}

for (const c of copies) {
  const src = resolveSrc(c.src)
  if (!src) continue
  if (!fs.existsSync(src)) { missing.push(`${c.src}（源不存在）`); continue }
  copyRecursive(src, path.join(stage, c.dest))
}

// node_modules 用链接（镜像里是 npm ci 装的，这里复用本地）
const nm = path.join(stage, 'node_modules')
if (!fs.existsSync(nm)) {
  try { fs.symlinkSync(path.join(root, 'node_modules'), nm, process.platform === 'win32' ? 'junction' : 'dir') }
  catch (e) { missing.push(`node_modules 链接失败：${e.message}`) }
}
if (!fs.existsSync(path.join(stage, 'package.json'))) {
  fs.copyFileSync(path.join(root, 'package.json'), path.join(stage, 'package.json'))
}

// 静态扫描：入口文件及其本地 import 是否都在物化目录里
const entry = 'server.mjs'
const entryPath = path.join(stage, entry)
if (!fs.existsSync(entryPath)) {
  missing.push(`${entry} 未被 COPY 到镜像里`)
} else {
  const seen = new Set()
  const walkImports = (file) => {
    if (seen.has(file)) return
    seen.add(file)
    let src
    try { src = fs.readFileSync(file, 'utf8') } catch { return }
    const re = /from\s+['"](\.[^'"]+)['"]/g
    let m
    while ((m = re.exec(src))) {
      const abs = path.resolve(path.dirname(file), m[1])
      const candidates = [abs, abs + '.js', abs + '.mjs', path.join(abs, 'index.js')]
      const hit = candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile())
      if (!hit) {
        missing.push(`本地 import 缺失：${m[1]}（被 ${path.relative(stage, file)} 引用）`)
        continue
      }
      if (hit.startsWith(stage)) walkImports(hit)
    }
  }
  walkImports(entryPath)
}

// 找空闲端口
function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port
      srv.close(() => resolve(p))
    })
  })
}

console.log(`静态扫描：${missing.length ? '发现 ' + missing.length + ' 个问题' : '本地 import 全部就位'}`)
missing.forEach((m) => console.log(`  ✗ ${m}`))
console.log()

if (missing.length) {
  console.log('静态扫描未通过 —— 镜像里会缺文件，启动必然失败。')
  console.log(`（物化目录保留在 ${stage} 供排查）`)
  process.exit(1)
}

// 真启动
const port = await freePort()
console.log(`按 COPY 清单物化到：${stage}`)
console.log(`启动 server.mjs（端口 ${port}），等待 /api/health ...`)

const env = { ...process.env, PORT: String(port), KUNQIONG_SCAN_MODE: 'optional', KUNQIONG_DB_ENABLED: 'false' }
for (const k of Object.keys(env)) if (k.startsWith('KUNQIONG_OAUTH') || k.startsWith('OAUTH_')) delete env[k]

const child = spawn(process.execPath, [entry], { cwd: stage, env, stdio: ['ignore', 'pipe', 'pipe'] })
let stdout = '', stderr = ''
child.stdout.on('data', (d) => { stdout += d })
child.stderr.on('data', (d) => { stderr += d })

let ok = false
const deadline = Date.now() + 25000
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 600))
  if (child.exitCode !== null) break
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`)
    if (res.ok) { ok = true; break }
  } catch { /* 还没起来 */ }
}

try { child.kill('SIGKILL') } catch { /* ignore */ }

if (ok) {
  console.log('\n✓ /api/health 返回 200 —— 按 Dockerfile 的 COPY 清单能正常启动')
  console.log(`  物化目录：${stage}`)
  process.exit(0)
}

console.log('\n✗ 启动后 /api/health 未就绪')
if (stderr.trim()) console.log(`--- stderr ---\n${stderr.split('\n').slice(0, 15).join('\n')}`)
if (stdout.trim()) console.log(`--- stdout ---\n${stdout.split('\n').slice(0, 10).join('\n')}`)
console.log(`物化目录保留在 ${stage} 供排查`)
process.exit(1)
