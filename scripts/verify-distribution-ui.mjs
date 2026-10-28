import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { JSDOM, VirtualConsole } from 'jsdom'
import { build } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bundle = await build({
  root, configFile: false, logLevel: 'silent', worker: { format: 'es' },
  build: { write: false, minify: false, rollupOptions: { input: path.join(root, 'src/main.jsx'), output: { format: 'iife', inlineDynamicImports: true } } },
})
const code = bundle.output.find(item => item.type === 'chunk').code
const errors = [], calls = [], previewCalls = [], publishKeys = [], publishedByKey = new Map(), failures = []
let passed = 0, commitCount = 0, holdNextPublish = false, releasePublish, loseNextResponse = false
const owner = { id: 'distribution-owner', username: 'owner', nickname: '验收管理员', status: 'active', planId: 'enterprise' }
const virtualConsole = new VirtualConsole()
virtualConsole.on('jsdomError', error => errors.push(error))
const dom = new JSDOM('<div id="root"></div>', { url: 'http://fixture.local/', pretendToBeVisual: true, runScripts: 'outside-only', virtualConsole })
const { window } = dom, document = window.document
const styles = document.createElement('style')
styles.textContent = ['base.css', 'components.css', 'app-main.css'].map(file => fs.readFileSync(path.join(root, 'src/styles', file), 'utf8')).join('\n')
document.head.append(styles)
const response = (data = {}, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
window.fetch = async (url, options = {}) => {
  const method = options.method || 'GET'
  const pathname = new URL(url, 'http://fixture.local').pathname
  calls.push({ url: String(url), method, body: options.body, headers: options.headers })
  if (pathname === '/api/auth/me') return response({ user: owner })
  if (pathname === '/api/runtime-config') return response({ upload: { singleFileLimitBytes: 1024 ** 3, maxBatchFiles: 100 }, maxBatchFiles: 100 })
  if (pathname === '/api/guest/quota') return response({ enabled: false })
  if (pathname === '/api/account/records') return response({ records: [] })
  if (pathname === '/api/account/messages') return response({ messages: [], settings: {} })
  if (pathname === '/api/account/notification-settings') return response({ settings: {} })
  if (pathname === '/api/distributions/preview' && method === 'POST') {
    const input = JSON.parse(options.body)
    previewCalls.push(input)
    const rows = (input.assignments || []).map(item => ({
      fileIndex: item.fileIndex, fileName: input.files[item.fileIndex], recipient: item.recipient,
      userId: ['alice', 'bob'].includes(item.recipient) ? item.recipient : '',
      recipientName: ['alice', 'bob'].includes(item.recipient) ? item.recipient.toUpperCase() : '',
    }))
    const issues = rows.filter(row => !row.userId).map(row => ({
      code: row.recipient ? 'recipient_not_found' : 'missing_recipient',
      fileIndex: row.fileIndex,
      message: row.recipient ? '收件人“' + row.recipient + '”不存在' : '文件“' + row.fileName + '”还没有指定收件人',
    }))
    return response({ preview: { ok: issues.length === 0, rows, issues } })
  }
  if (pathname === '/api/distributions' && method === 'POST') {
    const key = options.headers?.['Idempotency-Key'] || options.headers?.get?.('Idempotency-Key') || ''
    publishKeys.push(key)
    if (publishedByKey.has(key)) return response({ distribution: publishedByKey.get(key), reused: true })
    const distribution = { id: 'dist-' + (commitCount + 1), rowCount: JSON.parse(options.body.get('assignments')).length, shareUrl: 'http://fixture.local/share/dist-test' }
    if (holdNextPublish) {
      holdNextPublish = false
      return await new Promise(resolve => { releasePublish = () => { commitCount++; publishedByKey.set(key, distribution); resolve(response({ distribution, reused: false }, 201)) } })
    }
    commitCount++
    publishedByKey.set(key, distribution)
    if (loseNextResponse) { loseNextResponse = false; throw new TypeError('connection reset after server commit') }
    return response({ distribution, reused: false }, 201)
  }
  return response({})
}
window.eval(code)

async function waitFor(condition, label, timeout = 4000) {
  const end = Date.now() + timeout
  while (Date.now() < end) { if (condition()) return; await delay(10) }
  assert.fail(label)
}
function check(label, condition) {
  if (condition) { passed++; console.log('PASS ' + label); return }
  failures.push(label)
  console.log('FAIL ' + label)
}
const button = label => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === label || item.getAttribute('aria-label') === label)
async function click(label) { const item = button(label); assert.ok(item, 'button exists: ' + label); item.click(); await delay(30) }
function setValue(element, value) {
  assert.ok(element, 'input exists')
  const proto = element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : element.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value)
  element.dispatchEvent(new window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
}
async function choose(files) {
  const input = document.querySelector('.distribution-card input[type="file"]')
  assert.ok(input, 'distribution file input exists')
  Object.defineProperty(input, 'files', { configurable: true, value: files })
  input.dispatchEvent(new window.Event('change', { bubbles: true }))
  await delay(30)
}
const makeFile = (name, lastModified = 123) => new window.File(['synthetic:' + name], name, { type: 'text/plain', lastModified })

try {
  await waitFor(() => document.querySelector('.app-shell'), 'workspace mounts')
  await waitFor(() => document.querySelector('.upload-panel.send-prototype-drop-card'), 'upload panel mounts')
  const entry = document.querySelector('.send-distribution-entry')
  check('DIST-001 入口位于上传框右上角而不在顶部栏或横幅', entry?.closest('.upload-panel.send-prototype-drop-card') !== null && !document.querySelector('.topbar .send-distribution-entry') && !document.querySelector('.send-prototype-hero .send-distribution-entry'))
  check('DIST-001 上传框入口使用右上角定位样式', entry && window.getComputedStyle(entry).position === 'absolute' && window.getComputedStyle(entry).top !== 'auto' && window.getComputedStyle(entry).right !== 'auto')
  await click('批量定向发布')
  await waitFor(() => document.querySelector('.distribution-page h1')?.textContent.includes('批量分发'), 'distribution view opens from upload card')
  check('DIST-001 点击上传框入口打开定向发布页', Boolean(document.querySelector('.distribution-page')))

  await choose([makeFile('合同.txt'), makeFile('报价.txt', 124)])
  check('DIST-004 两个文件分别显示独立收件人字段', document.querySelectorAll('.distribution-entry-recipient').length === 2)
  await click('批量填入')
  setValue(document.querySelector('.distribution-bulk textarea'), '编号,收件人\n1,alice\n2,alice')
  await click('按顺序填入')
  await waitFor(() => document.querySelectorAll('.distribution-entry-recipient')[1]?.value === 'alice', 'bulk assignment applied')
  check('DIST-004 名单粘贴可按行填入且支持同一收件人多文件', [...document.querySelectorAll('.distribution-entry-recipient')].every(input => input.value === 'alice'))
  await waitFor(() => previewCalls.length > 0 && !button('确认发布')?.disabled, 'valid assignments preview')
  check('DIST-004 预览请求保留逐文件相同收件人映射', JSON.stringify(previewCalls.at(-1).assignments) === JSON.stringify([{ fileIndex: 0, recipient: 'alice' }, { fileIndex: 1, recipient: 'alice' }]))

  holdNextPublish = true
  const beforeHeld = calls.filter(call => call.url === '/api/distributions' && call.method === 'POST').length
  await click('确认发布')
  await waitFor(() => calls.filter(call => call.url === '/api/distributions' && call.method === 'POST').length === beforeHeld + 1, 'publish request starts')
  check('DIST-005 发布中按钮立即禁用', button('发布中…')?.disabled === true)
  await click('发布中…')
  check('DIST-005 快速重复点击只发送一个发布请求', calls.filter(call => call.url === '/api/distributions' && call.method === 'POST').length === beforeHeld + 1)
  releasePublish?.()
  await waitFor(() => document.querySelector('.distribution-success'), 'distribution publishes')
  check('DIST-001 发布成功显示固定映射反馈', document.querySelector('.distribution-success')?.textContent.includes('已冻结 2 条'))

  await choose([makeFile('合同.txt'), makeFile('报价.txt', 124)])
  await click('批量填入')
  setValue(document.querySelector('.distribution-bulk textarea'), 'alice\nalice')
  await click('按顺序填入')
  await waitFor(() => document.querySelectorAll('.distribution-entry-recipient')[1]?.value === 'alice', 'second bulk assignment')
  const validPreviewCount = previewCalls.length
  await waitFor(() => previewCalls.length > validPreviewCount && !button('确认发布')?.disabled, 'second assignments preview')

  loseNextResponse = true
  await click('确认发布')
  await waitFor(() => document.querySelector('.distribution-alert.error'), 'network failure displayed')
  const firstKey = publishKeys.at(-1)
  check('DIST-005 网络响应丢失后显示错误并允许重试', Boolean(firstKey) && !button('确认发布')?.disabled)
  await click('确认发布')
  await waitFor(() => document.querySelector('.distribution-success'), 'idempotent retry completes')
  check('DIST-005 响应丢失重试复用幂等键且不重复发布', publishKeys.length === 3 && publishKeys.at(-1) === firstKey && commitCount === 2)

  await choose([makeFile('无效收件人.txt', 126)])
  const recipient = document.querySelector('.distribution-entry-recipient')
  setValue(recipient, 'missing-account')
  const previousPreviewCount = previewCalls.length
  await waitFor(() => previewCalls.length > previousPreviewCount
    && document.querySelector('.distribution-issues')?.textContent.includes('不存在')
    && button('确认发布')?.disabled === true, 'unknown recipient is blocked')
  check('DIST-003 未注册收件人显示问题且禁止发布', document.querySelector('.distribution-issues')?.textContent.includes('不存在') && button('确认发布')?.disabled === true)
  setValue(recipient, '')
  const blankPreviewCount = previewCalls.length
  await delay(450)
  check('DIST-003 空白收件人阻止发布且不向服务端发起无效预览', previewCalls.length === blankPreviewCount && button('确认发布')?.disabled === true)
  const blankAssignmentCount = previewCalls.length
  setValue(recipient, 'alice')
  await waitFor(() => previewCalls.length > blankAssignmentCount && !button('确认发布')?.disabled, 'assignment repaired')
  check('DIST-003 未匹配文件经分配后可发布', button('确认发布')?.disabled === false)

  check('UI 测试运行无脚本错误', errors.length === 0)
  if (failures.length) throw new Error(failures.length + ' distribution UI checks failed: ' + failures.join('; '))
  console.log(JSON.stringify({ passed, failed: failures.length, previewRequests: previewCalls.length, publishRequests: publishKeys.length, createdDistributions: commitCount, environment: 'Real React app bundle in JSDOM with synthetic HTTP fixtures' }, null, 2))
} finally {
  window.close()
}
