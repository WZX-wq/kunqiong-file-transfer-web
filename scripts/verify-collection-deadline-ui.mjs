import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { JSDOM, VirtualConsole } from 'jsdom'
import { build } from 'vite'

// Render the real creation page, controlling only HTTP responses and the clock.
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
function check(name, condition) { assert.ok(condition, name); passed++; console.log('PASS ' + name) }
async function waitFor(condition, name) {
  for (let i = 0; i < 150; i++) { if (condition()) return; await delay(10) }
  assert.fail(name)
}
async function mount() {
  const errors = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', (error) => errors.push(error))
  const dom = new JSDOM('<div id="root"></div>', {
    url: 'http://fixture.local/?view=collect', pretendToBeVisual: true,
    runScripts: 'outside-only', virtualConsole,
  })
  const { window } = dom
  const NativeDate = window.Date
  let now = new Date(2026, 9, 10, 14).getTime()
  window.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [now])) }
    static now() { return now }
  }
  const requests = []
  window.fetch = async (url, options = {}) => {
    let payload = {}, status = 200
    if (url === '/api/auth/me') payload = { user: null }
    else if (url === '/api/runtime-config') payload = { defaultShareDays: '7' }
    else if (url === '/api/guest/quota') payload = { enabled: false }
    else if (url === '/api/collections' && options.method === 'POST') {
      const form = JSON.parse(options.body)
      requests.push(form)
      payload = { manageToken: 'fixture-manager', collection: {
        ...form, id: 'fixture-collection', token: 'fixture-collection', status: 'active',
        publicUrl: 'http://fixture.local/collect/fixture-collection',
        manageUrl: 'http://fixture.local/collect/manage/fixture-manager',
      } }
      status = 201
    } else { status = 404; payload = { message: 'Unexpected request: ' + url } }
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
  }
  window.eval(code)
  const document = window.document
  await waitFor(() => document.querySelector('.builder-form > label input'), 'Collection form renders')
  const title = document.querySelector('.builder-form > label input')
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(title, '截止日期验证')
  title.dispatchEvent(new window.Event('input', { bubbles: true }))
  await delay(20)
  const click = async (label) => {
    const button = [...document.querySelectorAll('button')].find((item) => item.getAttribute('aria-label') === label || item.textContent.trim() === label)
    assert.ok(button, 'Button exists: ' + label)
    button.click(); await delay(20)
  }
  return { window, document, requests, errors, click, setNow: (value) => { now = value }, close: () => dom.window.close() }
}

const failures = []
async function scenario(name, run) {
  const fixture = await mount()
  try { await run(fixture) } catch (error) { failures.push(name); console.error('FAIL ' + name + ': ' + error.message) }
  finally { fixture.close() }
}
await scenario('Past dates are unavailable', async (f) => {
  await f.click('截止时间')
  const yesterday = [...f.document.querySelectorAll('.date-picker-day')].find((button) => button.textContent.trim() === '9' && !button.classList.contains('outside'))
  check('Yesterday cannot be selected', yesterday?.disabled === true)
  await f.click('上个月')
  check('All days of a past month are disabled', [...f.document.querySelectorAll('.date-picker-day:not(.outside)')].every((button) => button.disabled))
})
await scenario('Cleared deadline is required', async (f) => {
  await f.click('截止时间')
  await f.click('清除')
  await f.click('创建收集任务')
  check('Cleared deadline produces an error without a create request', f.requests.length === 0 && /截止时间/.test(f.document.querySelector('.toast[role="alert"]')?.textContent || ''))
})
await scenario('Deadline is rechecked at submission', async (f) => {
  await f.click('截止时间')
  await f.click('今天')
  f.setNow(new Date(2026, 9, 11, 0, 0, 0).getTime())
  await f.click('创建收集任务')
  check('An overnight stale deadline is rejected before HTTP submission', f.requests.length === 0 && /截止时间/.test(f.document.querySelector('.toast[role="alert"]')?.textContent || ''))
  await f.click('截止时间')
  check('Reopened calendar disables the previously selected expired day', f.document.querySelector('.date-picker-day.selected')?.disabled === true)
})
await scenario('Valid deadlines can still create', async (f) => {
  await f.click('截止时间')
  await f.click('今天')
  await f.click('创建收集任务')
  await waitFor(() => f.document.querySelector('.collection-success'), 'Today can create successfully')
  check('Today is sent as a date-only deadline', f.requests.length === 1 && f.requests[0].deadline === '2026-10-10')
  check('Viewing received files links to the standalone manager', f.document.querySelector('.collection-success .result-actions a[href="/collect/manage/fixture-manager"]') !== null)
  await f.click('返回创建')
  check('Saved collection history links to the standalone manager', f.document.querySelector('.collection-history-actions a[href="/collect/manage/fixture-manager"]') !== null)
  const title = f.document.querySelector('.builder-form > label input')
  Object.getOwnPropertyDescriptor(f.window.HTMLInputElement.prototype, 'value').set.call(title, '未来任务')
  title.dispatchEvent(new f.window.Event('input', { bubbles: true }))
  await delay(20)
  await f.click('创建收集任务')
  await waitFor(() => f.requests.length === 2, 'Future deadline creates')
  check('Future default deadline still creates successfully', f.requests[1].deadline === '2026-10-20')
  check('UI completes without runtime errors', f.errors.length === 0)
})
console.log(`Collection deadline UI: ${passed} passed / ${failures.length} failed`)
if (failures.length) process.exitCode = 1
