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
    window.collectionPatches = [];
    window.fetch = async (url, options = {}) => {
      const route = String(url);
      if (route === '/api/collections/manage/layout-fixture' && options.method === 'PATCH') window.collectionPatches.push(JSON.parse(options.body));
      const fields = Array.from({length: Number(new URL(location.href).searchParams.get('fields') || 1)}, (_, i) => ({ id: 'company-' + i, label: '公司名称', type: 'text', required: true }));
      let body;
      if (route === '/api/auth/me') body = {user: null};
      else if (route === '/api/runtime-config') body = {upload: {singleFileLimitBytes: 1024 ** 3}};
      else if (route === '/api/guest/quota') body = {enabled: false};
      else if (route === '/api/collections/manage/layout-fixture') body = {collection: {
        id: 'layout-fixture', token: 'layout-fixture', title: '布局验收', status: options.method === 'PATCH' ? JSON.parse(options.body).status || 'active' : 'active',
        deadline: '2026-11-07T15:59:00.000Z', allowedTypes: ['PDF', 'Word'], maxFileSizeMb: 500,
        materials: [{id: 'material-0', name: '营业执照', required: true}], customFields: [], submissions: []
      }};
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

  for (const viewport of [
    { width: 1280, height: 620, mobile: false, label: 'short desktop' },
    { width: 390, height: 620, mobile: true, label: 'mobile' },
  ]) {
    await send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1 })
    await send('Page.navigate', { url: `http://127.0.0.1:${vitePort}/collect/manage/layout-fixture` })
    await waitFor(() => evaluate("document.querySelector('.cm-head-actions button')?.textContent.includes('收集设置')"), 'Collection management page did not render')
    await evaluate("[...document.querySelectorAll('.cm-head-actions button')].find(button => button.textContent.includes('收集设置')).click()")
    await waitFor(() => evaluate("Boolean(document.querySelector('.manage-modal'))"), 'Manage collection modal did not open')
    await evaluate("[...document.querySelectorAll('.manage-modal button')].find(button => button.textContent.includes('添加字段')).click()")
    await waitFor(() => evaluate("Boolean(document.querySelector('.manage-collection-structure .collection-field-name > input'))"), 'Custom field did not render')
    if (!viewport.mobile) {
      const fieldAlignment = await evaluate(`(() => {
        const name = document.querySelector('.manage-collection-structure .collection-field-name > input').getBoundingClientRect();
        const typeLabel = document.querySelector('.manage-collection-structure .collection-field-type-label').getBoundingClientRect();
        const type = document.querySelector('.manage-collection-structure .collection-field-type > select').getBoundingClientRect();
        return {nameTop: name.top, typeTop: type.top, nameHeight: name.height, typeHeight: type.height, typeLabelHeight: typeLabel.height};
      })()`)
      assert.ok(Math.abs(fieldAlignment.nameTop - fieldAlignment.typeTop) <= 1, `${viewport.label}: field name and type controls should align (${JSON.stringify(fieldAlignment)})`)
      assert.ok(Math.abs(fieldAlignment.nameHeight - fieldAlignment.typeHeight) <= 1, `${viewport.label}: field name and type controls should have equal heights`)
    }
    for (let index = 0; index < 8; index++) {
      await evaluate("[...document.querySelectorAll('.manage-modal button')].find(button => button.textContent.includes('添加材料')).click()")
    }
    await waitFor(() => evaluate("document.querySelectorAll('.manage-collection-structure .collection-rule-row').length >= 9"), 'Added materials did not render')
    const scrollState = await evaluate(`(() => {
      const body = document.querySelector('.manage-modal .manage-form');
      const footer = document.querySelector('.manage-modal .modal-footer');
      const modal = document.querySelector('.manage-modal');
      const box = node => { const rect = node.getBoundingClientRect(); return {top: rect.top, bottom: rect.bottom, height: rect.height}; };
      return {body: box(body), header: box(document.querySelector('.manage-modal .modal-header')), footer: box(footer), modal: box(modal), scrollHeight: body.scrollHeight, clientHeight: body.clientHeight,
        overflowY: getComputedStyle(body).overflowY, contentBottom: box(document.querySelector('.manage-collection-structure')).bottom};
    })()`)
    assert.ok(scrollState.scrollHeight > scrollState.clientHeight, `${viewport.label}: manage settings body should overflow after adding materials`)
    assert.equal(scrollState.overflowY, 'auto', `${viewport.label}: manage settings body should use vertical scrolling`)
    assert.ok(scrollState.modal.bottom <= viewport.height + 1, `${viewport.label}: modal stays within viewport`)
    assert.ok(scrollState.header.top >= -1, `${viewport.label}: modal title stays visible`)
    assert.ok(scrollState.footer.bottom <= viewport.height + 1, `${viewport.label}: save and cancel actions stay visible`)
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.floor(viewport.width / 2), y: Math.floor((scrollState.body.top + scrollState.body.bottom) / 2), deltaY: 5000, deltaX: 0 })
    await delay(120)
    const bottomState = await evaluate(`(() => {
      const body = document.querySelector('.manage-modal .manage-form');
      return {scrollTop: body.scrollTop, maxScroll: body.scrollHeight - body.clientHeight,
        contentBottom: document.querySelector('.manage-collection-structure').getBoundingClientRect().bottom,
        bodyBottom: body.getBoundingClientRect().bottom};
    })()`)
    assert.ok(bottomState.scrollTop > 0, `${viewport.label}: wheel input scrolls the manage settings body`)
    assert.ok(bottomState.maxScroll - bottomState.scrollTop <= 2, `${viewport.label}: content can scroll to its end`)
    assert.ok(bottomState.contentBottom <= bottomState.bodyBottom + 1, `${viewport.label}: last settings section is visible at the scroll end`)
    console.log(`PASS manage collection settings scroll at ${viewport.label}`)

    const openCloseConfirmation = async () => {
      await evaluate("document.querySelector('.manage-modal-footer .danger-lite').click()")
      await waitFor(() => evaluate("Boolean(document.querySelector('.confirm-modal'))"), 'Close confirmation did not render')
    }
    const clickVisible = async (selector) => {
      const point = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2}; })()`)
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
    }
    await openCloseConfirmation()
    const layer = await evaluate(`(() => {
      const backdrop = document.querySelector('.confirm-backdrop'), modal = backdrop.querySelector('.confirm-modal');
      const button = modal.querySelector('.primary-button'), r = modal.getBoundingClientRect(), b = button.getBoundingClientRect();
      return {rootPortal: backdrop.parentElement === document.body, width: r.width, top: r.top, bottom: r.bottom,
        centered: Math.abs(r.y + r.height / 2 - innerHeight / 2) <= 1,
        clickable: button.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2))};
    })()`)
    assert.ok(layer.rootPortal && layer.clickable, `${viewport.label}: confirmation must appear above settings and receive pointer input`)
    assert.ok(layer.centered && layer.top >= 0 && layer.bottom <= viewport.height && layer.width <= 421, `${viewport.label}: confirmation stays compact and centered`)
    await clickVisible('.confirm-modal .secondary-button')
    await waitFor(() => evaluate("!document.querySelector('.confirm-modal') && !document.querySelector('.manage-modal-footer .danger-lite').disabled"), 'Cancel must return to the settings')
    await openCloseConfirmation()
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await waitFor(() => evaluate("!document.querySelector('.confirm-modal') && Boolean(document.querySelector('.manage-modal'))"), 'Escape only cancels confirmation')
    assert.equal(await evaluate('window.collectionPatches.length'), 0, 'Cancel and Escape must not close the task')
    assert.ok(await evaluate("document.querySelectorAll('.manage-collection-structure .collection-rule-row').length >= 9"), 'Cancel must preserve unsaved settings')
    await openCloseConfirmation()
    await clickVisible('.confirm-modal .primary-button')
    await waitFor(() => evaluate("!document.querySelector('.confirm-modal') && !document.querySelector('.manage-modal')"), 'Confirm must close both dialogs')
    assert.deepEqual(await evaluate('window.collectionPatches'), [{ status: 'closed' }], 'Confirm closes the task exactly once')
    console.log(`PASS close confirmation layer, pointer input, cancel, Escape and one close request at ${viewport.label}`)
  }
} finally {
  cdp?.close()
  if (chrome && chrome.exitCode === null) {
    const exited = once(chrome, 'exit'); chrome.kill(); await Promise.race([exited, delay(3000)])
  }
  await vite?.close()
  try { fs.rmSync(profile, { recursive: true, force: true }) } catch {}
}
