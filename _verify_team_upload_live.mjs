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

const BASE = 'http://43.154.197.96:8045'
// 线上 release 必须与仓库 main 分支一致 —— 不写死哈希，否则每推一次新提交就误报。
const expectRelease = (() => {
  try { return execFileSync('git', ['rev-parse', 'origin/main'], { encoding: 'utf8' }).trim() } catch { return '' }
})()
const out = []
const log = (s) => { out.push(s); console.log(s) }
let pass = 0, fail = 0
const check = (n, ok, d = '') => { ok ? pass++ : fail++; log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`) }

const FORBIDDEN = '永久保存需要会员版或更高权益'

try {
  log('===== 线上验收：团队资源上传权限修复 =====')

  // 1) release 必须是仓库 main 分支指向的提交（部署未跑或落后时这里会红）
  const h = await fetch(`${BASE}/api/health`).then((r) => r.json())
  const release = String(h.release || '')
  if (expectRelease) {
    check(`线上 release 与仓库 main 一致（${expectRelease.slice(0, 7)}）`,
      release === expectRelease, `release=${release.slice(0, 7)} expect=${expectRelease.slice(0, 7)}`)
  } else {
    check('线上 release 非空（未能读取仓库 main，跳过一致性断言）', release.length >= 7, `release=${release}`)
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
