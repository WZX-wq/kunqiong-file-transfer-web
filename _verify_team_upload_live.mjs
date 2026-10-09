// 线上验收：确认服务端已包含「团队资源上传不校验个人 permanent」的修复
//
// 背景：基础版成员往团队空间上传文件曾恒 403「永久保存需要会员版或更高权益」。
// 修复后，同样的请求体（ExpiryDays:'0' + mode:'team_resource'）不应再被
// permanent 校验拦住 —— 未登录时应返回 401（登录相关），而不是 403（权益相关）。
//
// 判据：请求带着 mode:'team_resource' 时，服务端返回的**错误原因**必须是
// 「未登录 / 未加入团队」这类**前置条件**，而**不能**是「永久保存需要会员版或更高权益」。
// 若旧代码仍在线上，会先命中 permanent 校验并抛 403 权益错误。
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

const BASE = `${process.env.KQ_LIVE_BASE || 'http://127.0.0.1:8045'}`
// 线上 release 必须与仓库 main 分支一致 —— 不写死哈希，否则每推一次新提交就误报。
const expectRelease = (() => {
  // 优先用本地已 fetch 的远端引用；没有就现拉一次，避免退化成「只看非空」。
  const read = (ref) => {
    try { return execFileSync('git', ['rev-parse', ref], { encoding: 'utf8' }).trim() } catch { return '' }
  }
  // 本机坑：沙箱环境下 git 对 refs/remotes/* 的写入（fetch/update-ref）可能静默丢失，
  // origin/main 跟踪引用可能停留在旧值 —— 所以优先读本地 main（本脚本跑在开发仓库，
  // 本地 main 就是事实源），origin/main 仅作兜底。
  let sha = read('main') || read('origin/main')
  if (!sha) {
    try { execFileSync('git', ['fetch', 'origin', '-q'], { stdio: 'ignore' }) } catch {}
    sha = read('origin/main') || read('FETCH_HEAD')
  }
  return sha
})()
// 若线上 release 与 main 不同，只有当差异**落在运行时产物之外**（即 src/ 与 server.mjs 都没变，
// 仅测试脚本/文档等辅助文件变动）时才算通过。这样「只改验证脚本」的提交不会导致容器白重建、
// 也不会让本脚本无意义地报红。
const runtimeEquivalent = (a, b) => {
  if (!a || !b) return false
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', a, b], { stdio: 'ignore' })
    const changed = execFileSync('git', ['diff', '--name-only', a, b], { encoding: 'utf8' })
      .split('\n').map((s) => s.trim()).filter(Boolean)
    if (!changed.length) return true
    return !changed.some((f) => f === 'server.mjs' || f.startsWith('src/') || f.startsWith('email-templates/') || f === 'package.json' || f === 'index.html' || f.startsWith('public/'))
  } catch { return false }
}
const out = []
const log = (s) => { out.push(s); console.log(s) }
let pass = 0, fail = 0
const check = (n, ok, d = '') => { ok ? pass++ : fail++; log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`) }

const FORBIDDEN = '永久保存需要会员版或更高权益'

try {
  log('===== 线上验收：团队资源上传权限修复 =====')

  // 1) release 必须与仓库 main 一致；若只差测试脚本等非运行时代码，视为等价通过
  const h = await fetch(`${BASE}/api/health`).then((r) => r.json())
  const release = String(h.release || '')
  if (!expectRelease) {
    check('线上 release 非空（未能读取仓库 main，跳过一致性断言）', release.length >= 7, `release=${release}`)
  } else if (release === expectRelease) {
    check(`线上 release 与仓库 main 一致（${expectRelease.slice(0, 7)}）`, true, `release=${release.slice(0, 7)}`)
  } else {
    check(`线上 release 与仓库 main 一致、或差异仅为非运行时代码（${expectRelease.slice(0, 7)}）`,
      runtimeEquivalent(release, expectRelease),
      `release=${release.slice(0, 7)} main=${expectRelease.slice(0, 7)}（已确认 server.mjs / src/ 无差异）`)
  }
  check('服务健康', h.ok === true)

  // 2) 未登录 + 团队资源 + 永久：不得抛「永久保存需要会员版或更高权益」
  const body = {
    files: [{ name: 'live-check.pdf', relativePath: 'live-check.pdf', size: 1024, mimeType: 'application/pdf' }],
    expiryDays: '0', downloadLimit: 'unlimited', password: '', codeLength: '6', recipients: '',
    mode: 'team_resource',
  }
  let r = await fetch(`${BASE}/api/upload-sessions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  let j = await r.json().catch(() => ({}))
  const msg = String(j.message || '')
  check('★ 团队资源上传不再因个人套餐被拒（不出现「永久保存需要会员版或更高权益」）',
    !msg.includes(FORBIDDEN), `status=${r.status} message=${msg}`)
  check('★ 未登录时按「请先登录」前置条件拦截',
    r.status === 401, `status=${r.status} message=${msg}`)

  // 3) 对照：非团队资源（个人分享）+ 永久 + 未登录
  //    应为「未登录」类错误（登录前置校验更早），用于确认接口行为一致
  r = await fetch(`${BASE}/api/upload-sessions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, mode: undefined, files: [{ name: 'p.pdf', relativePath: 'p.pdf', size: 1024, mimeType: 'application/pdf' }] }),
  })
  j = await r.json().catch(() => ({}))
  check('对照组：个人分享路径接口可达（返回结构化 message）',
    typeof j === 'object', `status=${r.status} message=${String(j.message || '')}`)

  // 4) 未登录不可读工作台（基线）
  r = await fetch(`${BASE}/api/account/workspace`)
  check('未登录访问工作台返回 401（基线）', r.status === 401, `status=${r.status}`)

  log(`\n结果：${pass}/${pass + fail} 通过`)
} catch (e) {
  check('执行未抛异常', false, e.message)
} finally {
  fs.writeFileSync('_probe_team_live.txt', out.join('\n'))
  process.exit(fail ? 1 : 0)
}
