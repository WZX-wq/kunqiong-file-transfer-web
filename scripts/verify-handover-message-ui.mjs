import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { JSDOM, VirtualConsole } from 'jsdom'
import { build } from 'vite'

const root = path.resolve(import.meta.dirname, '..')
const bundle = await build({ root, configFile: false, logLevel: 'silent', worker: { format: 'es' }, build: { write: false, minify: false, rollupOptions: { input: path.join(root, 'src/main.jsx'), output: { format: 'iife', inlineDynamicImports: true } } } })
const code = bundle.output.find(item => item.type === 'chunk').code
let passed = 0
function check(label, condition) { assert.ok(condition, label); passed++; console.log('PASS ' + label) }
async function waitFor(fn, label) { for (let index = 0; index < 250; index++) { if (fn()) return; await delay(10) } assert.fail(label) }
async function mount({ fail = false } = {}) {
  const errors = [], calls = [], virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', error => { if (!/navigation/.test(error.message)) errors.push(error) })
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://fixture.local/?panel=messages', pretendToBeVisual: true, runScripts: 'outside-only', virtualConsole })
  const { window } = dom, document = window.document
  let messages = [{ id: 'handover-message', title: '待确认的团队负责人交接', body: '原负责人邀请你接管测试团队，确认后生效', category: 'other', actionType: 'workspace_ownership_handover', actionId: 'handover-fixture', actionUrl: '/team?tab=handover', unread: true, createdAt: new Date().toISOString() }]
  let hold = false, release
  window.setInterval = () => 0; window.clearInterval = () => {}
  window.fetch = async (url, options = {}) => {
    const method = options.method || 'GET'; calls.push({ url, method, body: options.body })
    let data = {}, status = 200
    if (url === '/api/auth/me') data = { user: { id: 'recipient', nickname: '接收者', planId: 'free' } }
    else if (url === '/api/account/messages') data = { messages, settings: {} }
    else if (url.startsWith('/api/account/workspace/ownership-handovers/')) {
      if (hold) await new Promise(resolve => { release = resolve })
      if (fail) { status = 409; data = { message: '该交接已取消，请刷新后查看' } }
      else { const decision = JSON.parse(options.body).decision; messages = messages.map(message => ({ ...message, actionType: 'workspace_ownership_handover_resolved', unread: false, body: decision === 'accept' ? '交接已完成' : '交接已拒绝' })); data = { messages } }
    }
    else if (url === '/api/account/records') data = { records: [] }
    else if (url === '/api/account/upgrade-pricing') data = { source: 'local', pricing: {} }
    else if (url === '/api/account/workspace') data = { plan: { id: 'free', label: '基础版', totalBytes: 1024 ** 3 }, plans: [], capacity: {}, orders: [] }
    else if (url === '/api/guest/quota') data = { enabled: false }
    return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
  }
  window.eval(code)
  await waitFor(() => document.querySelector('.message-center .message-handover-actions'), 'message center and authorization pending action mount')
  const find = label => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === label)
  const click = async label => { assert.ok(find(label), label); find(label).click(); await delay(35) }
  return { document, dom, calls, errors, find, click, hold: () => { hold = true }, release: () => { hold = false; release?.() } }
}
for (const decision of ['accept', 'decline']) {
  const fixture = await mount()
  try {
    check(`${decision}消息展示交接操作与详情入口`, !!fixture.find('接受交接') && !!fixture.find('拒绝交接') && !!fixture.find('查看交接'))
    await fixture.click(decision === 'accept' ? '接受交接' : '拒绝交接')
    check(`${decision}先确认不直接请求`, !!fixture.document.querySelector('.confirm-modal') && !fixture.calls.some(call => call.url.includes('ownership-handovers/')))
    await fixture.click('再想想')
    check(`${decision}取消后待办保留`, !!fixture.find('接受交接') && !fixture.calls.some(call => call.url.includes('ownership-handovers/')))
    fixture.hold(); await fixture.click(decision === 'accept' ? '接受交接' : '拒绝交接')
    const button = fixture.find(decision === 'accept' ? '确认接受' : '确认拒绝'); button.click(); button.click()
    await waitFor(() => fixture.calls.some(call => call.url.includes('ownership-handovers/')), 'handover decision submitted')
    check(`${decision}确认后防止连点重复请求`, fixture.calls.filter(call => call.url.includes('ownership-handovers/')).length === 1 && fixture.find('拒绝交接').disabled)
    check(`${decision}发送指定交接ID和决定`, fixture.calls.some(call => call.url === '/api/account/workspace/ownership-handovers/handover-fixture' && JSON.parse(call.body).decision === decision))
    fixture.release()
    await waitFor(() => !fixture.find('接受交接') && !fixture.find('处理中…'), 'resolved actions removed')
    check(`${decision}成功后刷新身份并提供结果反馈`, fixture.calls.filter(call => call.url === '/api/auth/me').length >= 2 && fixture.document.querySelector('.toast.success')?.textContent.includes(decision === 'accept' ? '交接已完成' : '已拒绝'))
    check(`${decision}处理后仍可查详情`, !!fixture.find('查看交接'))
    check(`${decision}页面无运行时错误`, !fixture.errors.length)
  } finally { fixture.release(); fixture.dom.window.close() }
}
const failed = await mount({ fail: true })
try {
  await failed.click('接受交接'); await failed.click('确认接受')
  await waitFor(() => failed.document.body.textContent.includes('该交接已取消'), 'failure feedback')
  check('失败显示服务端原因并恢复按钮', !failed.find('接受交接').disabled && failed.document.body.textContent.includes('该交接已取消'))
  check('失败会重新读取服务端消息', failed.calls.filter(call => call.url === '/api/account/messages').length >= 2)
  check('失败不会误报接受成功', !failed.document.querySelector('.toast.success'))
} finally { failed.dom.window.close() }
const report = { executedAt: new Date().toISOString(), passed, environment: 'JSDOM real React production bundle; HTTP fixtures' }
const evidence = path.join(root, '.workbuddy', 'team-handover'); fs.mkdirSync(evidence, { recursive: true }); fs.writeFileSync(path.join(evidence, 'message-ui-results.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
