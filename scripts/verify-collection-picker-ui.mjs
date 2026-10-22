import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { JSDOM, VirtualConsole } from 'jsdom'
import { build } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bundle = await build({
  root, configFile: false, logLevel: 'silent',
  worker: { format: 'es' },
  build: { write: false, minify: false, rollupOptions: {
    input: path.join(root, 'src/main.jsx'), output: { format: 'iife', inlineDynamicImports: true },
  } },
})
const code = bundle.output.find((item) => item.type === 'chunk').code
let passed = 0
const failures = []
function check(name, condition) { assert.ok(condition, name); passed++; console.log('PASS ' + name) }
async function waitFor(condition, name) {
  for (let i = 0; i < 150; i++) { if (condition()) return; await delay(10) }
  assert.fail(name)
}
async function mount({ allowedTypes = ['全部格式'], maxFileSizeMb = 500 } = {}) {
  const errors = [], requests = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', (error) => errors.push(error))
  const dom = new JSDOM('<div id="root"></div>', {
    url: 'http://fixture.local/collect/picker-test', pretendToBeVisual: true,
    runScripts: 'outside-only', virtualConsole,
  })
  const { window } = dom
  window.fetch = async (url, options = {}) => {
    let status = 200, payload = {}
    if (url === '/api/auth/me') payload = { user: null }
    else if (url === '/api/collections/picker-test') payload = { collection: {
      id: 'picker-test', token: 'picker-test', title: '文件夹收集测试', description: '请上传文件或文件夹',
      deadline: new Date(Date.now() + 86400000).toISOString(), allowedTypes, maxFileSizeMb,
      status: 'active', publicUrl: 'http://fixture.local/collect/picker-test',
    } }
    else if (url === '/api/upload-sessions' && options.method === 'POST') {
      requests.push(JSON.parse(options.body))
      // Stop at the HTTP boundary; the real uploader has built its complete manifest.
      status = 400; payload = { message: 'fixture: stop before uploading bytes' }
    } else { status = 404; payload = { message: 'Unexpected request: ' + url } }
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
  }
  window.eval(code)
  const document = window.document
  await waitFor(() => document.querySelector('.public-label input'), 'Anonymous collection page loads')
  const input = document.querySelector('.public-label input')
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, '测试提交者')
  input.dispatchEvent(new window.Event('input', { bubbles: true }))
  await delay(20)
  const file = (name, relativePath = name, size = 10) => {
    const item = new File(['x'.repeat(Math.min(size, 100))], name, { type: 'text/plain', lastModified: 123 })
    Object.defineProperty(item, 'webkitRelativePath', { value: relativePath })
    if (size > 100) Object.defineProperty(item, 'size', { value: size })
    return item
  }
  const button = (name) => [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === name || item.getAttribute('aria-label') === name)
  const click = async (name) => { const item = button(name); assert.ok(item, 'Button exists: ' + name); item.click(); await delay(20) }
  const choose = async (items, folder = false) => {
    const picker = document.querySelector(folder ? 'input[webkitdirectory]' : 'input[type="file"]:not([webkitdirectory])')
    assert.ok(picker, folder ? 'Folder picker exists' : 'File picker exists')
    Object.defineProperty(picker, 'files', { configurable: true, value: items })
    picker.dispatchEvent(new window.Event('change', { bubbles: true }))
    await delay(20)
  }
  return { window, document, errors, requests, file, button, click, choose, close: () => window.close() }
}
async function scenario(name, run, options) {
  const fixture = await mount(options)
  try { await run(fixture); check(name + ': no runtime errors', fixture.errors.length === 0) }
  catch (error) { failures.push(name); console.error('FAIL ' + name + ': ' + error.message) }
  finally { fixture.close() }
}

await scenario('Folder selection', async (f) => {
  const folderInput = f.document.querySelector('input[webkitdirectory]')
  check('Directory input supports nested multi-file selection', folderInput?.multiple === true)
  let opens = 0
  folderInput.addEventListener('click', (event) => { opens++; event.preventDefault() })
  await f.click('选择文件夹')
  check('Folder button opens the directory picker', opens === 1)
  await f.choose([f.file('同名.txt', '资料/甲/同名.txt'), f.file('同名.txt', '资料/乙/同名.txt')], true)
  check('Same filenames in different folders remain separate', f.document.querySelectorAll('.public-files .file-row').length === 2)
  check('Selected list displays relative paths', f.document.querySelector('.public-files')?.textContent.includes('资料/乙/同名.txt'))
  await f.click('提交文件')
  await waitFor(() => f.requests.length === 1, 'Collection uploader creates its manifest')
  check('Upload manifest preserves nested paths', JSON.stringify(f.requests[0].files.map((item) => item.relativePath)) === JSON.stringify(['资料/甲/同名.txt', '资料/乙/同名.txt']))
  check('Collection upload also receives directory paths', JSON.stringify(f.requests[0].relativePaths) === JSON.stringify(['资料/甲/同名.txt', '资料/乙/同名.txt']))
})
await scenario('Selection editing', async (f) => {
  const first = f.file('a.txt'), second = f.file('b.txt')
  await f.choose([first])
  await f.choose([])
  check('Cancelling selection keeps existing files', f.document.querySelectorAll('.file-row').length === 1)
  await f.choose([first, second])
  check('Additional selections append without duplicates', f.document.querySelectorAll('.file-row').length === 2)
  await f.click('移除 a.txt')
  check('Removing a file keeps the other selection', f.document.querySelectorAll('.file-row').length === 1 && f.document.querySelector('.file-row')?.textContent.includes('b.txt'))
  await f.choose([first])
  check('A removed file can be selected again', f.document.querySelectorAll('.file-row').length === 2)
  await f.click('清空')
  check('Clear removes the list and disables submission', !f.document.querySelector('.public-files') && f.button('提交文件')?.disabled === true)
})
await scenario('Batch limit and recovery', async (f) => {
  await f.choose(Array.from({ length: 101 }, (_, index) => f.file(`文件${index}.txt`)))
  check('Excess files are reported before upload', /100/.test(f.document.querySelector('[role="alert"]')?.textContent || '') && f.button('提交文件')?.disabled === true)
  await f.click('提交文件')
  check('101 files cannot create an upload session', f.requests.length === 0)
  await f.click('移除 文件100.txt')
  check('Removing the excess file clears the error and enables submission', !f.document.querySelector('[role="alert"]') && f.button('提交文件')?.disabled === false)
  await f.click('提交文件')
  await waitFor(() => f.requests.length === 1, 'Exactly 100 files can be submitted')
  check('The maximum batch sends all 100 files', f.requests[0].files.length === 100)
})
await scenario('Folder type restrictions', async (f) => {
  await f.choose([f.file('允许.txt', '资料/允许.txt'), f.file('不允许.exe', '资料/不允许.exe')], true)
  check('Folder selection enforces task file types', /不允许.exe/.test(f.document.querySelector('[role="alert"]')?.textContent || '') && f.button('提交文件')?.disabled === true)
  await f.click('移除 不允许.exe')
  check('Removing an invalid file restores submission', !f.document.querySelector('[role="alert"]') && f.button('提交文件')?.disabled === false)
}, { allowedTypes: ['文档'] })
await scenario('Folder size restrictions', async (f) => {
  await f.choose([f.file('过大.txt', '资料/过大.txt', 2 * 1024 * 1024)], true)
  check('Folder selection enforces task size limits', /过大.txt/.test(f.document.querySelector('[role="alert"]')?.textContent || '') && f.button('提交文件')?.disabled === true)
}, { maxFileSizeMb: 1 })
console.log(`Collection picker UI: ${passed} passed / ${failures.length} failed`)
if (failures.length) process.exitCode = 1
