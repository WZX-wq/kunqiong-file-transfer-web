import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const root = path.resolve(import.meta.dirname, '..')
const base = process.env.KUNQIONG_MANUAL_DEMO_URL || 'http://127.0.0.1:8118'
const shotRoot = path.join(root, 'manual_shots/current')
const capturesFile = path.join(shotRoot, 'captures.json')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-manual-new-shots-'))
const outputNames = ['collection-structure', 'collection-naming', 'distribution', 'team-handover', 'team-branding', 'trash']
const chromePath = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find(candidate => fs.existsSync(candidate))
assert.ok(chromePath, 'Google Chrome is required to capture manual screenshots')

const chrome = spawn(chromePath, [
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--headless=new',
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--no-proxy-server',
  '--window-size=1600,1000', 'about:blank',
], { stdio: 'ignore', windowsHide: true })
let socket
let closeBrowser
try {
  const portFile = path.join(profile, 'DevToolsActivePort')
  for (let attempt = 0; attempt < 100 && !fs.existsSync(portFile); attempt++) {
    if (chrome.exitCode !== null) throw new Error('Chrome exited before opening its debugging endpoint')
    await delay(100)
  }
  assert.ok(fs.existsSync(portFile), 'Chrome debugging endpoint did not start')
  const debugPort = Number(fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0])
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
  const target = targets.find(item => item.type === 'page')
  assert.ok(target, 'Chrome page target is unavailable')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  let nextId = 0
  const pending = new Map()
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (!message.id || !pending.has(message.id)) return
    const { resolve, reject } = pending.get(message.id)
    pending.delete(message.id)
    message.error ? reject(new Error(message.error.message)) : resolve(message.result)
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
  closeBrowser = () => send('Browser.close')
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
    return result.result.value
  }
  const navigate = async url => {
    await send('Page.navigate', { url })
    for (let attempt = 0; attempt < 120; attempt++) {
      const ready = await evaluate('document.readyState === "complete"').catch(() => false)
      if (ready) break
      await delay(100)
    }
    await delay(900)
  }
  const waitFor = async (expression, message) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(expression)) return
      await delay(120)
    }
    throw new Error(`Timed out waiting for ${message}`)
  }
  const clickText = async (selector, text) => evaluate(`(() => { const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(n => n.offsetParent !== null && n.textContent.includes(${JSON.stringify(text)})); if (!e) return false; e.click(); return true })()`)
  const setValue = async (selector, value) => evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if (!e) return false; const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(value)}); e.dispatchEvent(new Event('input',{bubbles:true})); return true })()`)
  const capture = async (name, labels, selector) => {
    if (selector) await evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center',inline:'nearest'})`)
    await evaluate('document.fonts.ready')
    await delay(350)
    const snapshot = await evaluate('document.body.innerText')
    for (const label of labels) assert.ok(snapshot.includes(label), `${name} screenshot is missing: ${label}`)
    const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    fs.writeFileSync(path.join(shotRoot, `${name}.png`), Buffer.from(screenshot.data, 'base64'))
    captures.push({ name, url: await evaluate('location.href'), snapshot })
    console.log(`Captured ${name}.png`)
  }

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })
  const captures = JSON.parse(fs.readFileSync(capturesFile, 'utf8')).filter(entry => !outputNames.includes(entry.name))
  await navigate(`${base}/__manual/owner`)

  await navigate(`${base}/?view=collect`)
  await waitFor('Boolean(document.querySelector(".collection-structure-summary"))', 'collection builder')
  await clickText('button.collection-structure-summary', '材料清单与自定义字段')
  await clickText('button', '添加材料')
  await clickText('button', '添加字段')
  await setValue('.collection-material-editor input[aria-label*="材料"]', '营业执照')
  await setValue('.collection-field-editor-section input', '联系人姓名')
  await capture('collection-structure', ['材料清单与自定义字段', '材料清单', '添加材料', '自定义字段', '添加字段'], '.collection-builder-groups')

  await navigate(`${base}/?view=collect`)
  await clickText('button.collection-structure-summary', '材料清单与自定义字段')
  await clickText('button', '添加材料')
  await setValue('.collection-material-editor input[aria-label*="材料"]', '营业执照')
  await clickText('.collection-naming-details summary', '自动命名')
  await setValue('input.collection-material-naming', '{提交人}_{材料项}_{原文件名}')
  await capture('collection-naming', ['自动命名', '命名格式', '插入变量', '示例'], '.collection-naming-details')

  await navigate(`${base}/?view=deliver`)
  await waitFor('Boolean(document.querySelector(".distribution-page"))', 'batch distribution page')
  await evaluate(`(() => { const input=document.querySelector('.distribution-card input[type=file]'); const transfer=new DataTransfer(); transfer.items.add(new File(['演示文件内容'], '合同.pdf', {type:'application/pdf',lastModified:1})); transfer.items.add(new File(['演示文件内容'], '报价单.xlsx', {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',lastModified:2})); Object.defineProperty(input,'files',{configurable:true,value:transfer.files}); input.dispatchEvent(new Event('change',{bubbles:true})); return true })()`)
  await waitFor('document.querySelectorAll(".distribution-entry-recipient").length === 2', 'distribution rows')
  await setValue('.distribution-entry-recipient', 'member')
  await evaluate(`(() => { const e=document.querySelectorAll('.distribution-entry-recipient')[1]; const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(e,'applicant'); e.dispatchEvent(new Event('input',{bubbles:true})); return true })()`)
  await clickText('button.distribution-link-button', '批量填入')
  await capture('distribution', ['批量分发给指定收件人', '文件与收件人', '批量填入', '确认发布'], '.distribution-card')

  await evaluate(`fetch('/api/account/workspace/transfer-ownership',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({targetMemberId:'m-member'})})`)
  await navigate(`${base}/team?tab=manage`)
  await waitFor('Boolean(document.querySelector(".team-management-list"))', 'team members management')
  await waitFor('Boolean(document.querySelector(".team-handover-panel"))', 'pending handover panel')
  await capture('team-handover', ['负责人交接', '等待接收者确认', '交接记录'], '.team-handover-panel')

  await navigate(`${base}/team?tab=branding`)
  await waitFor('Boolean(document.querySelector(".team-branding-panel"))', 'team branding settings')
  await setValue('#team-brand-name', '鲲穹演示团队')
  await setValue('#team-brand-introduction', '团队文件与材料统一交付')
  await capture('team-branding', ['团队品牌展示', '对外展示名称', '简短介绍', '效果预览', '保存并启用'], '.team-branding-panel')

  const recordsResponse = await fetch(`${base}/api/account/records`, { headers: { cookie: 'kunqiong_session=manual-owner' } })
  const recordsData = await recordsResponse.json()
  const trashRecord = recordsData.records.find(record => record.scope === 'my_sent' && record.kind === 'share')
  assert.ok(trashRecord, 'manual fixture must include a synthetic share for the trash screenshot')
  const deleteResponse = await fetch(`${base}/api/account/records`, {
    method: 'DELETE',
    headers: { cookie: 'kunqiong_session=manual-owner', 'content-type': 'application/json' },
    body: JSON.stringify({ ids: [trashRecord.id] }),
  })
  assert.equal(deleteResponse.status, 200, 'synthetic share should move to personal trash')
  await navigate(`${base}/trash`)
  await waitFor('Boolean(document.querySelector(".trash-page"))', 'trash page')
  await waitFor('Boolean(document.querySelector(".trash-scope-tabs"))', 'personal and team trash tabs')
  await waitFor('Boolean(document.querySelector(".trash-row"))', 'synthetic deleted share')
  await capture('trash', ['回收站', '个人回收站', '团队回收站', '恢复'], '.trash-row')

  fs.writeFileSync(capturesFile, `${JSON.stringify(captures, null, 2)}\n`)
  console.log(`Saved ${outputNames.length} screenshots and text snapshots to ${path.relative(root, shotRoot)}`)
} finally {
  try { await closeBrowser?.() } catch {}
  try { socket?.close() } catch {}
  if (chrome.exitCode === null) {
    const exited = new Promise(resolve => chrome.once('close', resolve))
    chrome.kill()
    await Promise.race([exited, delay(3000)])
  }
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
}
