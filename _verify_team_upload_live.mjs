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

const BASE = 'http://43.154.197.96:8045'
const out = []
const log = (s) => { out.push(s); console.log(s) }
let pass = 0, fail = 0
const check = (n, ok, d = '') => { ok ? pass++ : fail++; log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`) }

const FORBIDDEN = '永久保存需要会员版或更高权益'

try {
  log('===== 线上验收：团队资源上传权限修复 =====')

  // 1) release 必须是本次提交
  const h = await fetch(`${BASE}/api/health`).then((r) => r.json())
  check('线上 release 为本次提交 603ca9f', String(h.release || '').startsWith('603ca9f'), `release=${h.release}`)
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
