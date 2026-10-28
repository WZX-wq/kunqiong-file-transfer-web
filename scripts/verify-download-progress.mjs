import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { downloadBinaryWithProgress } from '../src/lib/api.js'

let passed = 0
function check(label, condition) {
  assert.ok(condition, label)
  passed++
  console.log('PASS ' + label)
}

const originalFetch = globalThis.fetch
const originalWindow = globalThis.window
try {
  const writes = []
  const updates = []
  let pickerCalled = false
  let writableClosed = false
  const fetchCalls = []
  globalThis.window = {
    showSaveFilePicker(options) {
      pickerCalled = true
      check('Save picker opens synchronously from the user action', options.suggestedName === 'sample.bin')
      return Promise.resolve({
        async createWritable() {
          return {
            async write(chunk) { writes.push(Buffer.from(chunk)) },
            async close() { writableClosed = true },
            async abort() { writes.length = 0 },
          }
        },
      })
    },
  }
  globalThis.fetch = async (url, options) => {
    fetchCalls.push({ url, options })
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('first-'))
        controller.enqueue(new TextEncoder().encode('second'))
        controller.close()
      },
    }), { status: 200, headers: { 'content-length': '12' } })
  }

  const pending = downloadBinaryWithProgress({ url: '/download', filename: 'sample.bin', headers: { 'x-share-password': 'fixture' } }, patch => updates.push(patch))
  check('Save picker is invoked before asynchronous download work', pickerCalled)
  const result = await pending
  check('Download uses authenticated GET with supplied headers', fetchCalls.length === 1 && fetchCalls[0].options.method === 'GET' && fetchCalls[0].options.credentials === 'include' && fetchCalls[0].options.headers['x-share-password'] === 'fixture')
  check('Response chunks stream into the selected file in order', Buffer.concat(writes).toString() === 'first-second' && writableClosed)
  check('Page receives real byte progress and a saving state', updates.some(item => item.status === 'downloading' && item.loadedBytes === 12 && item.totalBytes === 12 && item.progress === 99) && updates.at(-1).status === 'saving')
  check('Successful result reports the exact received size', result.saved && result.loadedBytes === 12 && result.totalBytes === 12)
  const downloadPanel = await readFile(new URL('../src/components/ui.jsx', import.meta.url), 'utf8')
  check('完成提示指向用户选择的保存位置，而非浏览器下载列表', downloadPanel.includes("task.status === 'complete' && <small>文件已保存到你选择的位置。</small>") && !downloadPanel.includes('已调用浏览器保存，请在下载列表查看。'))

  let requestedAfterCancel = false
  globalThis.window.showSaveFilePicker = () => Promise.reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }))
  globalThis.fetch = async () => { requestedAfterCancel = true; throw new Error('should not fetch') }
  await assert.rejects(downloadBinaryWithProgress({ url: '/download', filename: 'sample.bin' }, () => {}), error => error.name === 'AbortError')
  check('Canceling the save picker starts no network download', !requestedAfterCancel)

  let createdWritable = false
  globalThis.window.showSaveFilePicker = () => Promise.resolve({ async createWritable() { createdWritable = true; return { async write() {}, async close() {}, async abort() {} } } })
  globalThis.fetch = async () => new Response(JSON.stringify({ message: '下载权限已失效' }), { status: 403, headers: { 'content-type': 'application/json' } })
  await assert.rejects(downloadBinaryWithProgress({ url: '/download', filename: 'sample.bin' }, () => {}), /下载权限已失效/)
  check('Failed download response does not create or save a local file', !createdWritable)

  let protectedPickerCalled = false
  globalThis.window.showSaveFilePicker = () => { protectedPickerCalled = true; return Promise.resolve({ async createWritable() { return { async write() {}, async close() {}, async abort() {} } } }) }
  const protectedCalls = []
  globalThis.fetch = async (url, options) => {
    protectedCalls.push({ url, options })
    if (url === '/unlock') return new Response(JSON.stringify({ message: '提取密码不正确' }), { status: 401, headers: { 'content-type': 'application/json' } })
    return new Response('not expected', { status: 200 })
  }
  await assert.rejects(downloadBinaryWithProgress({ url: '/protected', unlockUrl: '/unlock', filename: 'sample.bin', requiresPassword: true, headers: { 'x-share-password': 'wrong' } }, () => {}), /提取密码不正确/)
  check('Unverified protected downloads validate password before opening picker', !protectedPickerCalled && protectedCalls.length === 1 && protectedCalls[0].url === '/unlock' && protectedCalls[0].options.method === 'POST' && JSON.parse(protectedCalls[0].options.body).password === 'wrong')
} finally {
  globalThis.fetch = originalFetch
  if (originalWindow === undefined) delete globalThis.window
  else globalThis.window = originalWindow
}

console.log(`Download progress checks: ${passed} passed`)
