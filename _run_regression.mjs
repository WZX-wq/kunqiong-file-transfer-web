// 依次跑全部离线回归套件，汇总结果
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = import.meta.dirname
const NODE = process.execPath

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
  // 统计口径：优先解析套件自报的「结果：通过/总数」行（该行本身含 "PASS=" 字样，
  // 若同时用关键词计数会重复多算）；套件没有声明行时才回退到 \bPASS\b/\bFAIL\b 计数。
  const declared = text.match(/结果[:：]\s*(\d+)\s*\/\s*(\d+)/)
  let passCount, failCount
  if (declared) {
    passCount = Number(declared[1])
    failCount = Math.max(0, Number(declared[2]) - passCount)
  } else {
    passCount = (text.match(/\bPASS\b/g) || []).length
    failCount = (text.match(/\bFAIL\b/g) || []).length
  }
  const ok = r.status === 0
  totalPass += passCount
  totalFail += failCount
  if (!ok) bad.push(suite)
  log(`${ok ? 'OK  ' : 'FAIL'} ${suite.padEnd(30)} exit=${r.status} PASS=${passCount} FAIL=${failCount}` +
      (declared ? `  (声明 ${declared[0]})` : '  (按关键词计数)') + `  ${Date.now() - started}ms`)
}

log('')
log(`总计：PASS=${totalPass} FAIL=${totalFail}`)
log(`异常套件：${bad.length ? bad.join(', ') : '无'}`)
fs.writeFileSync(path.join(ROOT, '_regression.txt'), out.join('\n'))
console.log(out.join('\n'))
process.exit(bad.length ? 1 : 0)
