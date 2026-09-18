// 依次跑全部离线回归套件，汇总结果
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = 'C:\\Users\\admin\\Desktop\\鲲穹文件传输web'
const NODE = 'C:/Users/admin/.workbuddy/binaries/node/versions/22.22.2-3/node.exe'

// 需要真实网络/线上服务的排除在外
const EXCLUDE = new Set(['_verify_admin_live.mjs', '_verify_avatar_e2e.mjs', '_verify_avatar_restart.mjs'])

const suites = fs.readdirSync(ROOT)
  .filter((f) => f.startsWith('_verify_') && f.endsWith('.mjs') && !EXCLUDE.has(f))
  .sort()

const out = []
const log = (s) => { out.push(s); fs.writeFileSync(path.join(ROOT, '_regression.txt'), out.join('\n')) }

let totalPass = 0, totalFail = 0, bad = []

for (const suite of suites) {
  const started = Date.now()
  const r = spawnSync(NODE, [suite], { cwd: ROOT, encoding: 'utf8', timeout: 300000 })
  const text = `${r.stdout || ''}\n${r.stderr || ''}`
  // 从输出里抓 "PASS" / "FAIL" 计数，或末尾 "结果：x/y"
  const passCount = (text.match(/\bPASS\b/g) || []).length
  const failCount = (text.match(/\bFAIL\b/g) || []).length
  const summary = text.match(/结果[:：]\s*(\d+)\s*\/\s*(\d+)/)
  const ok = r.status === 0
  totalPass += passCount
  totalFail += failCount
  if (!ok) bad.push(suite)
  log(`${ok ? 'OK  ' : 'FAIL'} ${suite.padEnd(30)} exit=${r.status} PASS=${passCount} FAIL=${failCount}` +
      (summary ? `  (声明 ${summary[0]})` : '') + `  ${Date.now() - started}ms`)
}

log('')
log(`总计：PASS=${totalPass} FAIL=${totalFail}`)
log(`异常套件：${bad.length ? bad.join(', ') : '无'}`)
fs.writeFileSync(path.join(ROOT, '_regression.txt'), out.join('\n'))
console.log(out.join('\n'))
process.exit(bad.length ? 1 : 0)
