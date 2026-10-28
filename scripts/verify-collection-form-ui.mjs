import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
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
// 材料清单 + 自定义字段（含快速搭建）整块默认收起，摘要条上的「更多」负责展开
const summaryToggle = () => doc.querySelector('.collection-structure-summary')
assert.ok(summaryToggle(), 'Structure summary toggle renders')
assert.equal(summaryToggle().textContent.includes('更多'), true, 'Collapsed block shows 更多')
assert.equal(summaryToggle().getAttribute('aria-expanded'), 'false', 'Collapsed toggle reports aria-expanded=false')
assert.equal(doc.querySelector('.collection-builder-groups'), null, 'Collapsed block hides both cards')
summaryToggle().click()
await delay(20)
assert.ok(doc.querySelector('.collection-builder-groups'), 'Expanded block renders both cards')
assert.ok(doc.querySelector('.collection-quick-presets'), 'Expanded block renders card bodies')
assert.equal(summaryToggle().textContent.includes('收起'), true, 'Expanded toggle shows 收起')
assert.equal(summaryToggle().getAttribute('aria-expanded'), 'true', 'Expanded toggle reports aria-expanded=true')
const presetDisclosures = [...doc.querySelectorAll('.collection-preset-disclosure')]
assert.equal(presetDisclosures.length, 2, 'Material and field shortcuts have separate disclosures')
assert.deepEqual(presetDisclosures.map((item) => item.open), [false, false], 'Shortcut lists start collapsed')
assert.match(presetDisclosures[0].querySelector('summary').textContent, /常用材料/)
assert.match(presetDisclosures[1].querySelector('summary').textContent, /常用字段/)
presetDisclosures[0].querySelector('summary').click()
assert.equal(presetDisclosures[0].open, true, 'Material shortcuts can be expanded')
assert.ok(presetDisclosures[1].querySelector('button'), 'Common field shortcuts remain available')
presetDisclosures[1].querySelector('summary').click()
assert.equal(presetDisclosures[1].open, true, 'Field shortcuts can be expanded')
const collectionBuilderCss = await readFile(path.join(root, 'src/styles/app-main.css'), 'utf8')
assert.match(collectionBuilderCss, /\.collection-builder-groups\s*\{[^}]*align-items:\s*start;/s, 'Builder grid aligns both cards at the top')
assert.match(collectionBuilderCss, /\.collection-builder-section\s*\{[^}]*align-self:\s*start;/s, 'Each card keeps its own content height')
assert.match(collectionBuilderCss, /\.collection-page\s+\.collection-builder-groups\s*>\s*\.collection-builder-section\s*\{[^}]*min-height:\s*190px;/s, 'Both cards share an equal minimum height')
click('添加材料'); await delay(5)
setValue(doc.querySelector('[aria-label="材料名称 1"]'), '营业执照')
click('添加字段'); await delay(5)
setValue(doc.querySelector('[aria-label="字段名称 1"]'), '供应商类型')
await delay(5)
for (let index = 1; index < 30; index++) { click('添加材料'); await delay(5) }
assert.equal(doc.querySelectorAll('[aria-label^="材料名称 "]').length, 30, '30 materials can be added')
const addMaterialButton = [...doc.querySelectorAll('button')].find(item => item.textContent.trim() === '添加材料')
assert.equal(addMaterialButton.disabled, true, 'Material add button is disabled at 30')
assert.ok([...doc.querySelectorAll('.collection-field-limit-note')].some(item => item.textContent.includes('30 项上限')), 'Material limit is explained')
doc.querySelector('[aria-label="复制材料 1"]').click(); await delay(10)
assert.equal(doc.querySelectorAll('[aria-label^="材料名称 "]').length, 30, 'Copy cannot exceed material cap')
assert.equal(doc.querySelector('[aria-label="材料名称 1"]').value, '营业执照', 'Adding and copying at the cap preserves the first material')
for (let index = 1; index < 20; index++) { click('添加字段'); await delay(5) }
assert.equal(doc.querySelectorAll('[aria-label^="字段名称 "]').length, 20, '20 custom fields can be added')
const addFieldButton = [...doc.querySelectorAll('button')].find(item => item.textContent.trim() === '添加字段')
assert.equal(addFieldButton.disabled, true, 'Field add button is disabled at 20')
assert.ok([...doc.querySelectorAll('.collection-field-limit-note')].some(item => item.textContent.includes('20 个上限')), 'Field limit is explained')
doc.querySelector('[aria-label="复制字段 1"]').click(); await delay(10)
assert.equal(doc.querySelectorAll('[aria-label^="字段名称 "]').length, 20, 'Copy cannot exceed field cap')
assert.equal(doc.querySelector('[aria-label="字段名称 1"]').value, '供应商类型', 'Adding and copying at the cap preserves the first field')
for (let index = 30; index >= 2; index--) { doc.querySelector(`[aria-label="删除材料 ${index}"]`).click(); await delay(5) }
for (let index = 20; index >= 2; index--) { doc.querySelector(`[aria-label="删除字段 ${index}"]`).click(); await delay(5) }
assert.equal(doc.querySelectorAll('[aria-label^="材料名称 "]').length, 1, 'Removing excess material fixtures preserves the first item')
assert.equal(doc.querySelectorAll('[aria-label^="字段名称 "]').length, 1, 'Removing excess field fixtures preserves the first item')
setValue(doc.querySelector('.builder-form > label input'), '供应商资料收集')
setValue(doc.querySelector('[aria-label="材料名称 1"]'), '营业执照')
const namingDetails = doc.querySelector('.collection-naming-details')
assert.ok(namingDetails, 'Optional naming settings are grouped in a disclosure')
assert.equal(namingDetails.open, false, 'Advanced naming controls start collapsed to reduce visual clutter')
namingDetails.querySelector('summary').click()
assert.equal(namingDetails.open, true, 'Advanced naming controls can be expanded')
assert.ok(doc.querySelector('.collection-material-naming-preview')?.textContent.includes('留空则保留原文件名'), 'Unconfigured naming rule clearly promises to preserve the source name')
const namingPresetLabels = [...doc.querySelectorAll('.collection-naming-presets button')].map((button) => button.textContent.trim())
assert.deepEqual(namingPresetLabels, ['提交人_原文件名', '提交人_材料项_原文件名'], 'Naming presets omit the redundant original-name option and duplicate token order')
setValue(doc.querySelector('[aria-label="营业执照命名格式"]'), '{提交人}_{材料项}_{原文件名}')
assert.equal(doc.querySelector('[aria-label="营业执照命名格式"]').value, '{提交人}_{材料项}_{原文件名}', '完整命名格式 remains editable')
assert.ok(doc.querySelector('.collection-naming-example')?.textContent.includes('示例：'), 'Generated filename example is shown when a rule is configured')
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
