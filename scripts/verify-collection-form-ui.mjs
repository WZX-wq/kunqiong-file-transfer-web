import assert from 'node:assert/strict'
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
const code = bundle.output.find((item) => item.type === 'chunk').code
const errors = []
const virtualConsole = new VirtualConsole()
virtualConsole.on('jsdomError', (error) => errors.push(error))
const dom = new JSDOM('<div id="root"></div>', { url: 'http://fixture.local/?view=collect', pretendToBeVisual: true, runScripts: 'outside-only', virtualConsole })
const { window } = dom
const requests = []
let createdCollection = null
const owner = { id: 'collection-owner', username: 'owner', nickname: '收集管理员', status: 'active', planId: 'free' }
window.fetch = async (url, options = {}) => {
  let status = 200, payload = {}
  if (url === '/api/auth/me') payload = { user: owner }
  else if (url === '/api/runtime-config') payload = { upload: { singleFileLimitBytes: 1200 * 1024 ** 2, collectionParticipantLimit: 50, activeCollectionLimit: 5 } }
  else if (url === '/api/guest/quota') payload = { enabled: false }
  else if (url === '/api/collections' && options.method === 'POST') {
    const body = JSON.parse(options.body)
    requests.push({ url, body })
    createdCollection = body
    payload = { manageToken: 'fixture-manager', collection: { ...body, id: 'fixture-task', token: 'fixture-task', status: 'active', publicUrl: 'http://fixture.local/collect/fixture-task', manageUrl: 'http://fixture.local/collect/manage/fixture-manager' } }
    status = 201
  } else {
    status = 404
    payload = { message: `Unexpected request: ${url}` }
  }
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}
window.eval(code)

async function waitFor(condition, message) {
  for (let attempt = 0; attempt < 200; attempt++) { if (condition()) return; await delay(10) }
  assert.fail(message)
}
function setValue(element, value) {
  assert.ok(element, 'Input exists')
  const prototype = element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : element.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value)
  element.dispatchEvent(new window.Event(element instanceof window.HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
}
function click(label) {
  const button = [...window.document.querySelectorAll('button')].find((item) => item.textContent.trim() === label || item.getAttribute('aria-label') === label)
  assert.ok(button, `Button exists: ${label}`)
  button.click()
}

await waitFor(() => window.document.querySelector('.builder-form input'), 'Collection form renders')
const doc = window.document
await delay(40)
assert.equal(doc.querySelector('.collection-template-tools'), null, 'Template tools are removed')
assert.equal([...doc.querySelectorAll('button')].some((item) => /保存为新模板|更新所选模板|复制模板|载入模板/.test(item.textContent)), false, 'Template actions are removed')
assert.equal(requests.some((item) => item.url.includes('/api/collection-templates')), false, 'Page makes no template API requests')
setValue(doc.querySelector('.builder-form > label input'), '供应商资料收集')
click('添加材料')
await delay(20)
setValue(doc.querySelector('[aria-label="材料名称 1"]'), '营业执照')
setValue(doc.querySelector('[aria-label="营业执照命名格式"]'), '{提交人}_{材料项}_{原文件名}')
assert.equal(doc.querySelector('.collection-material-naming-preview code')?.textContent, '{提交人}_{材料项}_{原文件名}', '完整命名格式预览可见')
click('添加字段')
await delay(20)
setValue(doc.querySelector('[aria-label="字段名称 1"]'), '供应商类型')
setValue(doc.querySelector('[aria-label="字段类型 1"]'), 'select')
setValue(doc.querySelector('[aria-label="供应商类型下拉选项"]'), '生产商, 经销商')
doc.querySelector('.collection-field-editor-main .collection-rule-required input')?.click()
await delay(20)
click('创建收集任务')
await waitFor(() => createdCollection !== null, 'Collection task is created')
await waitFor(() => doc.querySelector('.collection-success') !== null, 'Collection success view renders')
assert.equal(createdCollection.materials[0].name, '营业执照')
assert.equal(createdCollection.materials[0].namingPattern, '{提交人}_{材料项}_{原文件名}')
assert.equal(createdCollection.customFields[0].label, '供应商类型')
assert.equal(createdCollection.customFields[0].options[1], '经销商')
assert.equal(Object.hasOwn(createdCollection, 'templateId'), false, 'New collection does not send a template id')
assert.ok(doc.querySelector('.collection-success'))
assert.equal(errors.length, 0, errors.map((error) => error.message).join('\n'))
console.log('Collection form UI: template tools removed; materials, custom fields and task creation passed')
window.close()
