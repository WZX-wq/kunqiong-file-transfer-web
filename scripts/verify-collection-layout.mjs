// Real Chromium geometry checks. Synthetic API responses never touch live data.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const root = path.resolve(import.meta.dirname, '..')
const chromePath = [process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean).find(candidate => fs.existsSync(candidate))
assert.ok(chromePath, 'Chrome or Edge is required for layout verification')
async function freePort() {
  const server = net.createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
async function waitFor(check, label) {
  const until = Date.now() + 15000
  while (Date.now() < until) { try { if (await check()) return } catch {} await delay(50) }
  assert.fail(label)
}
const vitePort = await freePort(), debugPort = await freePort()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-layout-chrome-'))
let vite, chrome, cdp
try {
  vite = await createServer({ root, configFile: false, plugins: [react()], appType: 'spa', server: { host: '127.0.0.1', port: vitePort, strictPort: true } })
  await vite.listen()
  chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--no-sandbox', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok, 'Chrome did not start')
  const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })).json()
  cdp = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { cdp.addEventListener('open', resolve, { once: true }); cdp.addEventListener('error', reject, { once: true }) })
  let requestId = 0
  const pending = new Map()
  cdp.addEventListener('message', event => {
    const message = JSON.parse(event.data), entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    if (message.error) entry.reject(new Error(message.error.message))
    else entry.resolve(message.result)
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++requestId; pending.set(id, { resolve, reject }); cdp.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
    return result.result.value
  }
  await send('Page.enable')
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.fetch = async url => {
      const route = String(url);
      const fields = Array.from({length: Number(new URL(location.href).searchParams.get('fields') || 1)}, (_, i) => ({ id: 'company-' + i, label: '公司名称', type: 'text', required: true }));
      let body;
      if (route === '/api/auth/me') body = {user: null};
      else if (route === '/api/runtime-config') body = {upload: {singleFileLimitBytes: 1024 ** 3}};
      else if (route === '/api/guest/quota') body = {enabled: false};
      else if (route === '/api/collections/layout-fixture') body = {collection: {
        id: 'layout-fixture', token: 'layout-fixture', title: '布局验收', status: 'active',
        deadline: '2026-11-07T15:59:00.000Z', allowedTypes: ['PDF', 'Word', 'Excel', 'PPT', '图片', '压缩包'], maxFileSizeMb: 500,
        materials: [{id: 'material', name: '营业执照', required: true}], customFields: fields, submissions: []
      }};
      else body = {records: [], messages: [], settings: {}};
      return new Response(JSON.stringify(body), {headers: {'content-type': 'application/json'}});
    };
  ` })
  const measure = () => evaluate(`(() => {
    const rect = selector => { const node = document.querySelector(selector), r = node.getBoundingClientRect(); return {x:r.x, y:r.y, width:r.width, height:r.height, scrollWidth:node.scrollWidth, clientWidth:node.clientWidth}; };
    return {viewport:document.documentElement.clientWidth, pageWidth:document.documentElement.scrollWidth,
      name:rect('#collection-submitter-name'), company:rect('.collection-submit-custom-fields input'),
      nameCount:rect('.collection-submit-name .collection-field-count'), companyCount:rect('.collection-submit-custom-fields .collection-field-count'),
      cards:Array.from(document.querySelectorAll('.collection-submit-workflow-grid > fieldset'), node => {const r=node.getBoundingClientRect();return {width:r.width,height:r.height}}),
      pills:Array.from(document.querySelectorAll('.collection-submit-meta .deadline-line, .collection-submit-meta .collection-limit span'), node => ({width:node.clientWidth,scrollWidth:node.scrollWidth,height:node.getBoundingClientRect().height}))};
  })()`)
  for (const fields of [1, 5]) {
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
    await send('Page.navigate', { url: `http://127.0.0.1:${vitePort}/collect/layout-fixture?fields=${fields}` })
    await waitFor(() => evaluate(`document.querySelectorAll('.collection-submit-custom-fields input').length === ${fields}`), 'Collection inputs did not render')
    await evaluate('document.fonts.ready')
    const desktop = await measure()
    console.log(JSON.stringify({ fields, desktop }))
    assert.ok(Math.abs(desktop.name.y - desktop.company.y) <= 1, 'Name and first custom input must align within 1px')
    assert.ok(Math.abs(desktop.nameCount.y - desktop.companyCount.y) <= 1, 'Character counts must align within 1px')
    for (const card of desktop.cards) {
      assert.ok(Math.abs(card.width - desktop.cards[0].width) <= 1, 'Desktop cards have equal widths')
      assert.ok(Math.abs(card.height - desktop.cards[0].height) <= 1, 'Desktop cards have equal heights')
    }
    for (const pill of desktop.pills) assert.ok(pill.scrollWidth <= pill.width, 'Long file type labels stay inside their pill')
    console.log(`PASS desktop layout with ${fields} custom fields`)
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  const mobile = await measure()
  assert.ok(mobile.pageWidth <= mobile.viewport, 'Mobile page has no horizontal overflow')
  for (const pill of mobile.pills) assert.ok(pill.scrollWidth <= pill.width, 'Mobile file type labels stay inside their pill')
  console.log('PASS mobile layout at 390px')
} finally {
  cdp?.close()
  if (chrome && chrome.exitCode === null) {
    const exited = once(chrome, 'exit'); chrome.kill(); await Promise.race([exited, delay(3000)])
  }
  await vite?.close()
  try { fs.rmSync(profile, { recursive: true, force: true }) } catch {}
}
