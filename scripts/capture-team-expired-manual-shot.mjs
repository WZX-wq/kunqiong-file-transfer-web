import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const root = path.resolve(import.meta.dirname, '..')
const port = Number(process.env.KUNQIONG_MANUAL_DEMO_PORT || 8118)
const base = `http://127.0.0.1:${port}`
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-manual-shot-'))
const output = path.join(root, 'manual_shots/current/team-plan-unavailable.png')
const capturesFile = path.join(root, 'manual_shots/current/captures.json')
const chromePath = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find(candidate => fs.existsSync(candidate))
assert.ok(chromePath, 'Google Chrome is required to capture the manual screenshot')

const chrome = spawn(chromePath, [
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--headless=new',
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--no-proxy-server',
  '--window-size=1600,1000', 'about:blank',
], { stdio: 'ignore' })
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
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: `${base}/__manual/expired-member` })
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate('location.pathname === "/"')) break
    await delay(100)
  }
  await send('Page.navigate', { url: `${base}/workspace` })
  let text = ''
  for (let attempt = 0; attempt < 100; attempt++) {
    text = await evaluate('document.body.innerText') || ''
    if (text.includes('团队套餐暂不可用')) break
    await delay(100)
  }
  for (const label of ['团队套餐暂不可用', '联系团队所有者', '所有成员会自动恢复访问']) {
    assert.ok(text.includes(label), `Expired-team member UI is missing ${label}`)
  }
  await evaluate('document.querySelector(".workspace-team-card").scrollIntoView({block:"center",inline:"nearest"})')
  await evaluate('document.fonts.ready')
  await delay(400)
  text = await evaluate('document.body.innerText')
  const screenshot = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(output, Buffer.from(screenshot.data, 'base64'))
  const captures = JSON.parse(fs.readFileSync(capturesFile, 'utf8'))
  const entry = { name: 'team-plan-unavailable', url: `${base}/workspace`, snapshot: text }
  const existing = captures.findIndex(item => item.name === entry.name)
  if (existing < 0) captures.push(entry)
  else captures[existing] = entry
  fs.writeFileSync(capturesFile, `${JSON.stringify(captures, null, 2)}\n`)
  console.log(`Captured ${path.relative(root, output)} from ${entry.url}`)
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
