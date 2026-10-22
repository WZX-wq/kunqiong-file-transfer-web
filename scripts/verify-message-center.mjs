// 消息中心交互回归：真实前端挂载（JSDOM），验证
//   1) 含取件码的消息渲染「复制取件码 / 去提取」操作行
//   2) 点击复制 → 剪贴板收到取件码 + 按钮给出已复制反馈
//   3) 删除消息请求携带 keepalive（页面卸载不中断，修复「删除后刷新复活」）
// 用法：node scripts/verify-message-center.mjs
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { JSDOM, VirtualConsole } from 'jsdom'
import { build } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bundle = await build({
  root, configFile: false, logLevel: 'silent', worker: { format: 'es' },
  build: { write: false, minify: false, rollupOptions: {
    input: path.join(root, 'src/main.jsx'), output: { format: 'iife', inlineDynamicImports: true },
  } },
})
const code = bundle.output.find((item) => item.type === 'chunk').code

let passed = 0
function check(name, condition) { assert.ok(condition, name); passed++; console.log('PASS ' + name) }
async function waitFor(condition, name) {
  for (let i = 0; i < 200; i++) { if (condition()) return; await delay(10) }
  assert.fail(name)
}

const jsErrors = []
const virtualConsole = new VirtualConsole()
virtualConsole.on('jsdomError', (error) => jsErrors.push(error))
const dom = new JSDOM('<div id="root"></div>', { url: 'http://fixture.local/', pretendToBeVisual: true, runScripts: 'outside-only', virtualConsole })
const { window } = dom
const document = window.document

// 剪贴板 mock（JSDOM 无 clipboard API）
let copiedText = ''
Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: async (value) => { copiedText = String(value) } }, configurable: true })

// 消息数据（含一条「你收到一个文件分享」取件码消息）
let messages = [
  { id: 'msg-code', category: 'other', title: '你收到一个文件分享', body: 'wzx12 给你发送了 1 个文件，取件码 NXKTSS。', createdAt: '2026-10-10T06:26:00.000Z', unread: true, actionUrl: '/share/facfd50de8', eventType: 'incomingShare', actionType: '', actionId: '' },
  { id: 'msg-plain', category: 'system', title: '鲲穹服务通知', body: '站内消息、账号容量和账号绑定已接入当前账户。', createdAt: '2026-10-08T05:33:00.000Z', unread: true, actionUrl: '', eventType: '', actionType: '', actionId: '' },
]
const deleteCalls = [] // 记录 DELETE 请求的 options（验证 keepalive）
window.setInterval = () => 0
window.clearInterval = () => {}
window.fetch = async (url, options = {}) => {
  let payload = {}, status = 200
  const method = String(options.method || 'GET').toUpperCase()
  if (url === '/api/auth/me') payload = { user: { id: 'fixture-user', nickname: '测试用户' } }
  else if (url === '/api/account/messages' && method === 'GET') payload = { messages, settings: {} }
  else if (url === '/api/account/messages' && method === 'PATCH') {
    messages = messages.map(message => ({ ...message, unread: false }))
    payload = { messages }
  }
  else if (url.startsWith('/api/account/messages/') && method === 'PATCH') {
    const id = decodeURIComponent(url.split('/').pop())
    messages = messages.map((m) => m.id === id ? { ...m, unread: false } : m)
    payload = { message: messages.find((m) => m.id === id), messages }
  } else if (url.startsWith('/api/account/messages/') && method === 'DELETE') {
    deleteCalls.push({ url, keepalive: options.keepalive === true })
    const id = decodeURIComponent(url.split('/').pop())
    messages = messages.filter((m) => m.id !== id)
    payload = { messages }
  } else if (url === '/api/account/messages' && method === 'DELETE') { deleteCalls.push({ url, keepalive: options.keepalive === true }); messages = []; payload = { messages } }
  else if (url === '/api/account/records') payload = { records: [] }
  else if (url === '/api/account/upgrade-pricing') payload = { source: 'local', pricing: {} }
  else if (url === '/api/account/workspace') payload = { plan: { id: 'free', label: '基础版', totalBytes: 1024 ** 3 }, plans: [], capacity: {}, orders: [], paymentReconciliation: { pending: false, requiresLogin: false } }
  else if (url === '/api/guest/quota') payload = { enabled: false }
  else payload = {}
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}

window.eval(code)
await waitFor(() => document.querySelector('.app-shell'), 'Workspace initially renders')

// 打开消息中心
const trigger = document.querySelector('.message-trigger')
assert.ok(trigger, 'Message trigger exists')
trigger.click()
await waitFor(() => document.querySelector('.message-center'), 'Message center opens')
await waitFor(() => document.querySelectorAll('.message-item').length === 2, 'Two messages render')
check('消息中心打开且渲染两条消息', document.querySelectorAll('.message-item').length === 2)
check('消息中心打开状态写入URL', new URLSearchParams(window.location.search).get('panel') === 'messages')

// 1) 取件码操作行
const chip = [...document.querySelectorAll('.message-code-chip')].find((b) => b.textContent.includes('NXKTSS'))
check('含取件码的消息渲染「复制取件码 NXKTSS」按钮', Boolean(chip))
const openBtn = [...document.querySelectorAll('.message-code-open')].find((b) => b.textContent.includes('去提取'))
check('渲染「去提取」按钮', Boolean(openBtn))
check('普通消息不渲染取件码行', document.querySelectorAll('.message-code-actions').length === 1)

// 2) 点击复制
chip.click()
await waitFor(() => copiedText === 'NXKTSS', 'Clipboard receives the share code')
check('点击复制后剪贴板内容为取件码', copiedText === 'NXKTSS')
await waitFor(() => [...document.querySelectorAll('.message-code-chip')].some((b) => b.textContent.includes('已复制')), 'Copy feedback shows')
check('按钮给出已复制反馈', [...document.querySelectorAll('.message-code-chip')].some((b) => b.textContent.includes('已复制')))
await waitFor(() => document.querySelector('.toast.success')?.textContent.includes('取件码已复制'), 'Copy toast shows above the message panel')
check('复制取件码有全局成功提示', document.querySelector('.toast').parentElement === document.body)

document.querySelector('.message-mark-all').click()
await waitFor(() => document.querySelector('.toast.success')?.textContent.includes('全部消息已标为已读'), 'Mark all read succeeds with feedback')
check('全部已读有成功提示且未读状态已更新', messages.every(message => !message.unread))
check('连续操作替换旧提示，页面只保留一个提示', document.querySelectorAll('.toast').length === 1)

// 3) 删除请求是否携带 keepalive
const delBtn = document.querySelector('.message-item-delete')
delBtn.click()
await waitFor(() => deleteCalls.length > 0, 'Delete request sent')
check('删除请求携带 keepalive（页面卸载不中断）', deleteCalls[0].keepalive === true)
await waitFor(() => document.querySelectorAll('.message-item').length === 1, 'Message removed from list')
await waitFor(() => document.querySelector('.toast.success')?.textContent.includes('消息已删除'), 'Message deletion confirms success')
check('删除消息有成功提示', Boolean(document.querySelector('.toast.success')))

document.querySelector('.message-mark-all.danger').click()
await waitFor(() => document.querySelector('.confirm-modal'), 'Clear all asks for confirmation')
document.querySelector('.confirm-modal .primary-button').click()
await waitFor(() => document.querySelector('.toast.success')?.textContent.includes('全部消息已清除'), 'Clear all confirms success')
check('清除全部有成功提示且消息已清空', messages.length === 0 && document.querySelectorAll('.message-item').length === 0)

document.body.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
await waitFor(() => !document.querySelector('.message-center'), 'Message center closes on outside click')
check('关闭消息中心后清除URL状态，刷新不会重新打开', new URLSearchParams(window.location.search).get('panel') !== 'messages')

check('无 jsdom 运行时错误', jsErrors.length === 0)
dom.window.close()
console.log(`\n消息中心检查: ${passed} 通过`)
