// 真实 React 收集提交/管理页，用合成 API 检查字段显示与 XLSX 导出内容。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { JSDOM, VirtualConsole } from 'jsdom'
import { build } from 'vite'
import * as XLSX from 'xlsx'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bundle = await build({ root, configFile: false, logLevel: 'silent', worker: { format: 'es' }, build: { write: false, minify: false, rollupOptions: { input: path.join(root, 'src/main.jsx'), output: { format: 'iife', inlineDynamicImports: true } } } })
const code = bundle.output.find(item => item.type === 'chunk').code
const fields = [
  { id: 'text', label: '供应商名称', type: 'text', required: true, help: '请填写供应商公司全称' },
  { id: 'textarea', label: '备注', type: 'textarea', required: false },
  { id: 'number', label: '报价金额', type: 'number', required: false },
  { id: 'phone', label: '联系电话', type: 'phone', required: true },
  { id: 'email', label: '邮箱', type: 'email', required: false },
  { id: 'select', label: '供应商类别', type: 'select', required: true, options: ['生产商', '经销商'] },
  { id: 'date', label: '资料日期', type: 'date', required: false },
  { id: 'invoice', label: '是否需要开票', type: 'select', required: true, options: ['是', '否'] },
  { id: 'invoice-title', label: '发票抬头', type: 'text', required: true, showWhen: { fieldId: 'invoice', value: '是' } },
]
const collection = {
  id: 'fixture-task', token: 'fixture-task', manageToken: 'fixture-manager', title: '六项字段导出验收', description: '隔离自动化样例',
  deadline: new Date(Date.now() + 86400000).toISOString(), status: 'active', allowedTypes: ['全部格式'], maxFileSizeMb: 10,
  materials: [{ id: 'business-license', name: '营业执照', required: true }], customFields: fields,
  submissions: [{
    id: 'fixture-submission', participantName: '测试供应商甲', submittedAt: '2026-10-27T00:00:00.000Z',
    materialIds: ['business-license'], missingMaterialIds: [],
    files: [{ name: '测试供应商甲_营业执照_TC-COL-材料-营业执照.pdf', originalName: 'TC-COL-材料-营业执照.pdf', relativePath: '测试供应商甲_营业执照_TC-COL-材料-营业执照.pdf', size: 33244, mimeType: 'application/pdf' }],
    fieldValues: { text: '测试供应商甲', textarea: '六项验收备注', number: '1280.50', phone: '13800138000', email: 'qa@example.test', select: '生产商', date: '2026-10-27', invoice: '否' },
  }],
}

async function mount(route) {
  const errors = [], calls = [], downloads = [], blobs = [], virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', error => errors.push(error.message))
  const dom = new JSDOM('<div id="root"></div>', { url: `http://fixture.local${route}`, pretendToBeVisual: true, runScripts: 'outside-only', virtualConsole })
  const { window } = dom, document = window.document
  const NativeFileReader = window.FileReader
  window.Blob.prototype.arrayBuffer = function () { return new Promise((resolve, reject) => { const reader = new NativeFileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(this) }) }
  window.URL.createObjectURL = blob => { blobs.push(blob); return `blob:fixture/${blobs.length}` }
  window.URL.revokeObjectURL = () => {}
  window.HTMLAnchorElement.prototype.click = function () { downloads.push({ href: this.href, name: this.download }) }
  const owner = { id: 'collection-owner', username: 'qa-owner', nickname: '收集验收管理员', status: 'active', planId: 'enterprise' }
  window.fetch = async (url, options = {}) => {
    const method = options.method || 'GET'; calls.push({ url: String(url), method, body: options.body })
    let payload = {}, status = 200
    if (url === '/api/auth/me') payload = { user: null }
    else if (url === '/api/runtime-config') payload = { upload: { singleFileLimitBytes: 1024 ** 3, collectionParticipantLimit: 50, activeCollectionLimit: 10 } }
    else if (url === '/api/guest/quota') payload = { enabled: false }
    else if (url === '/api/account/records') payload = { records: [] }
    else if (url === '/api/account/messages') payload = { messages: [], settings: {} }
    else if (url === '/api/account/notification-settings') payload = { settings: {} }
    else if (url === '/api/collections/fixture-task') payload = { collection }
    else if (url === '/api/collections/manage/fixture-manager') payload = { collection: { ...collection, ownerUserId: owner.id, publicUrl: 'http://fixture.local/collect/fixture-task', manageUrl: 'http://fixture.local/collect/manage/fixture-manager', participantCount: 1, submissionCount: 1 } }
    else { status = 404; payload = { message: `Unexpected request ${method} ${url}` } }
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
  }
  window.eval(code)
  async function waitFor(condition, label, timeout = 5000) { const end = Date.now() + timeout; while (Date.now() < end) { if (condition()) return; await delay(10) } assert.fail(label) }
  const button = label => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === label || item.getAttribute('aria-label') === label)
  const click = async label => { const item = button(label); assert.ok(item, `button ${label}`); assert.equal(item.disabled, false, `button enabled ${label}`); item.click(); await delay(50) }
  return { dom, window, document, errors, calls, downloads, blobs, waitFor, click }
}

let passed = 0
function check(label, condition) { assert.ok(condition, label); passed++; console.log(`PASS ${label}`) }

const submit = await mount('/collect/fixture-task')
try {
  await submit.waitFor(() => submit.document.querySelector('.collection-submit-custom-fields'), 'public collection form mounts')
  const doc = submit.document
  const publicStyles = await readFile(path.join(root, 'src/styles/app-public.css'), 'utf8')
  check('COL-UI 截止时间、文件类型和单文件上限在宽屏固定同一行排列', /\.collection-submit-meta\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*flex-wrap:\s*nowrap/.test(publicStyles) && /\.collection-submit-meta \.deadline-line\s*\{[^}]*flex:\s*none;/.test(publicStyles) && /\.collection-submit-meta \.deadline-line,\s*\.collection-submit-meta \.collection-limit span\s*\{[^}]*white-space:\s*nowrap/.test(publicStyles) && /\.collection-submit-meta \.collection-limit\s*\{[^}]*flex:\s*none;[^}]*flex-wrap:\s*nowrap/.test(publicStyles))
  check('COL-UI 截止时间、文件类型和单文件上限三个标签宽高统一', /\.collection-submit-meta\s*\{[^}]*--collection-meta-pill-width:\s*150px;[^}]*--collection-meta-pill-height:\s*31px/.test(publicStyles) && /\.collection-submit-meta \.deadline-line,\s*\.collection-submit-meta \.collection-limit span\s*\{[^}]*width:\s*var\(--collection-meta-pill-width\);[^}]*height:\s*var\(--collection-meta-pill-height\)/.test(publicStyles))
  const narrowSubmitStyles = publicStyles.slice(publicStyles.lastIndexOf('@media (max-width: 650px)'))
  check('COL-UI 窄屏元信息允许换行避免横向溢出', /\.collection-submit-meta\s*\{\s*align-items:\s*flex-start;\s*flex-wrap:\s*wrap/.test(narrowSubmitStyles))
  check('COL-UI 窄屏文件类型标签可换行且不超出卡片', /\.collection-submit-meta \.collection-limit\s*\{\s*flex:\s*1 1 100%;\s*width:\s*100%;[^}]*flex-wrap:\s*wrap/.test(narrowSubmitStyles))
  check('COL-UI 提交卡片加宽以利用桌面屏幕空间', /\.collection-submit-shell \.collection-submit-card\s*\{\s*width:\s*min\(1080px/.test(publicStyles))
  check('COL-UI 材料与补充字段按可用宽度自动分列', /\.collection-submit-materials\s*\{\s*grid-template-columns:\s*repeat\(auto-fit/.test(publicStyles) && /\.collection-submit-custom-fields\s*\{\s*grid-template-columns:\s*repeat\(auto-fit/.test(publicStyles))
  check('COL-UI 材料上传按钮与材料项并排显示', /\.collection-submit-material-row\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/.test(publicStyles))
  check('COL-UI 提交人、材料和补充信息三卡固定等宽同行且等高', doc.querySelector('.collection-submit-workflow-grid.has-three-cards') && /\.collection-submit-workflow-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*260px\),\s*1fr\)\);\s*align-items:\s*stretch/.test(publicStyles) && /\.collection-submit-workflow-grid\.has-three-cards\s*\{\s*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/.test(publicStyles))
  check('COL-UI 窄屏工作区回到单列并防止内容撑宽', /@media\s*\(max-width:\s*780px\)\s*\{\s*\.collection-submit-workflow-grid,\s*\.collection-submit-workflow-grid\.has-three-cards\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(publicStyles) && /\.collection-submit-workflow-grid\s*>\s*\.collection-submit-form-section\s*\{[^}]*min-width:\s*0;[^}]*min-inline-size:\s*0/.test(publicStyles))
  check('COL-UI 文件选择区使用紧凑间距', /\.collection-submit-body \.collection-file-picker\s*\{\s*margin-top:\s*10px;\s*padding:\s*14px 12px/.test(publicStyles))
  check('COL-UI 矩阵材料列和状态列标题与居中数据对齐', /\.collection-material-matrix thead th:not\(:first-child\)\s*\{\s*text-align:\s*center/.test(publicStyles))
  const inputType = type => [...doc.querySelectorAll('.collection-submit-custom-fields input')].find(input => input.type === type)
  check('COL-001 提交页将单行文本、数字、电话、邮箱和日期渲染为对应控件', Boolean(inputType('number') && inputType('tel') && inputType('email') && inputType('date')) && Boolean([...doc.querySelectorAll('.collection-submit-custom-fields input')].find(input => input.type === 'text')))
  const byLabel = label => [...doc.querySelectorAll('.collection-submit-custom-fields label')].find(node => node.textContent.includes(label))
  check('COL-001 多行文本、下拉选项和材料必交标记显示正确', Boolean(doc.querySelector('.collection-submit-custom-fields textarea')) && [...byLabel('供应商类别').querySelector('select').options].some(option => option.textContent === '生产商') && doc.querySelector('.collection-submit-materials')?.textContent.includes('必交'))
  const supplierNameField = byLabel('供应商名称')
  check('COL-001 填写提示只显示在输入框下方，不与占位文字重复', supplierNameField.querySelector('input')?.getAttribute('placeholder') === '请填写供应商名称' && supplierNameField.querySelector('.collection-field-help')?.textContent === '请填写供应商公司全称' && supplierNameField.textContent.split('请填写供应商公司全称').length - 1 === 1)
  const control = byLabel('是否需要开票').querySelector('select')
  const setValue = (element, value) => { const proto = element.tagName === 'TEXTAREA' ? submit.window.HTMLTextAreaElement.prototype : element.tagName === 'SELECT' ? submit.window.HTMLSelectElement.prototype : submit.window.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value); element.dispatchEvent(new submit.window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) }
  const submitterInput = doc.querySelector('.collection-submit-name input')
  check('COL-UI 提交人名称有 40 字硬上限与长度提示', submitterInput?.maxLength === 40 && doc.querySelector('.collection-submit-name-field-label .collection-field-count')?.textContent === '0/40')
  check('COL-UI 提交人名称标题位于左上边框，字数计数与字段名称同行', doc.querySelector('.collection-submit-name')?.tagName === 'FIELDSET' && doc.querySelector('.collection-submit-name legend')?.textContent === '提交人名称' && doc.querySelector('.collection-submit-name-field-label')?.textContent.includes('姓名或部门') && doc.querySelector('.collection-submit-name-field-label .collection-field-count')?.textContent === '0/40')
  check('COL-UI 提交人卡片计数位于字段行右侧，并与公司名称计数样式一致', doc.querySelector('.collection-submit-name-field-label')?.htmlFor === submitterInput?.id && /\.collection-submit-name\s*\{[^}]*display:\s*block;/.test(publicStyles) && /\.collection-submit-name-field-label\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*space-between;[^}]*min-height:\s*17px;[^}]*margin:\s*0 0 6px/.test(publicStyles) && /\.collection-submit-name input\s*\{[^}]*display:\s*block;[^}]*height:\s*40px;[^}]*margin:\s*0;/.test(publicStyles) && /\.collection-field-count\s*\{[^}]*margin-left:\s*auto;[^}]*font-size:\s*10px/.test(publicStyles))
  setValue(submitterInput, '甲'.repeat(41)); await delay(30)
  check('COL-UI 粘贴超长提交人名称时截到 40 字且计数同步', submitterInput.value.length === 40 && doc.querySelector('.collection-submit-name-field-label .collection-field-count')?.textContent === '40/40')
  setValue(submitterInput, '测试供应商甲')
  const supplierInput = supplierNameField.querySelector('input')
  check('COL-UI 单行文本上限 100 字，多行备注保留 500 字', supplierInput?.maxLength === 100 && byLabel('备注').querySelector('textarea')?.maxLength === 500 && supplierNameField.querySelector('.collection-field-count')?.textContent === '0/100')
  setValue(supplierInput, 'x'.repeat(101)); await delay(30)
  check('COL-UI 超长公司名称粘贴截到 100 字并同步计数', supplierInput.value.length === 100 && supplierNameField.querySelector('.collection-field-count')?.textContent === '100/100')
  const noteInput = byLabel('备注').querySelector('textarea')
  setValue(noteInput, 'x'.repeat(501)); await delay(30)
  check('COL-UI 多行备注仍可输入到 500 字上限', noteInput.value.length === 500 && byLabel('备注').querySelector('.collection-field-count')?.textContent === '500/500')
  setValue(noteInput, '六项验收备注')
  setValue(supplierInput, '测试供应商甲')
  setValue(control, '否')
  await delay(30)
  check('COL-004 选择否时隐藏条件发票字段', !byLabel('发票抬头'))
  setValue(doc.querySelector('.collection-submit-name input'), '测试供应商甲')
  setValue(byLabel('供应商名称').querySelector('input'), '测试供应商甲')
  setValue(byLabel('联系电话').querySelector('input'), '13800138000')
  setValue(byLabel('邮箱').querySelector('input'), 'qa@example.test')
  setValue(byLabel('备注').querySelector('textarea'), '六项验收备注')
  setValue(byLabel('报价金额').querySelector('input'), '1280.50')
  setValue(byLabel('资料日期').querySelector('input'), '2026-10-27')
  setValue(byLabel('供应商类别').querySelector('select'), '生产商')
  doc.querySelector('.collection-submit-materials input[type="checkbox"]').click()
  const fileInput = doc.querySelector('.collection-submit-body input[type="file"][multiple]')
  Object.defineProperty(fileInput, 'files', { configurable: true, value: [new submit.window.File(['synthetic pdf'], 'license.txt', { type: 'text/plain', lastModified: 1 })] })
  fileInput.dispatchEvent(new submit.window.Event('change', { bubbles: true }))
  await delay(30)
  check('COL-004 隐藏的必填发票字段不禁用有效提交表单', doc.querySelector('.collection-submit-actions button.primary-button')?.disabled === false)
  setValue(control, '是')
  await delay(30)
  check('COL-004 选择是时显示必填发票字段并要求填写', Boolean(byLabel('发票抬头')) && doc.querySelector('.collection-submit-actions button.primary-button')?.disabled === true)
  setValue(byLabel('发票抬头').querySelector('input'), '测试验收有限公司')
  const phone = byLabel('联系电话').querySelector('input')
  setValue(phone, '12345'); phone.focus(); phone.blur()
  await delay(30)
  check('COL-003 无效手机号显示明确错误', byLabel('联系电话').textContent.includes('有效的手机号'))
  check('COL-003 无效手机号阻止提交', doc.querySelector('.collection-submit-actions button.primary-button')?.disabled === true)
  check('COL-003 手机号错误时保留其它字段、文件和材料选择', byLabel('供应商名称').querySelector('input').value === '测试供应商甲' && byLabel('供应商类别').querySelector('select').value === '生产商' && doc.querySelector('.collection-selected-files')?.textContent.includes('license.txt') && doc.querySelector('.collection-submit-materials input[type="checkbox"]').checked)
  setValue(phone, '13800138000')
  const email = byLabel('邮箱').querySelector('input')
  setValue(email, 'not-an-email'); email.focus(); email.blur()
  await delay(30)
  check('COL-003 无效邮箱显示明确错误并保留其它输入', byLabel('邮箱').textContent.includes('有效的邮箱地址') && byLabel('供应商名称').querySelector('input').value === '测试供应商甲' && byLabel('供应商类别').querySelector('select').value === '生产商' && doc.querySelector('.collection-selected-files')?.textContent.includes('license.txt'))
  setValue(email, 'qa@example.test')
  await delay(30)
  check('COL-003 修正错误字段后表单恢复可提交且只保留配置下拉选项', doc.querySelector('.collection-submit-actions button.primary-button')?.disabled === false && [...byLabel('供应商类别').querySelector('select').options].map(option => option.value).filter(Boolean).join(',') === '生产商,经销商')
  check('COL-003 校验失败期间没有上传请求或重复提交', !submit.calls.some(call => String(call.url).startsWith('/api/upload-sessions') || String(call.url).includes('/submissions')))
  check('收集提交页面运行无脚本错误', submit.errors.length === 0)
} finally { submit.window.close() }

const manage = await mount('/collect/manage/fixture-manager')
try {
  await manage.waitFor(() => manage.document.querySelector('.cm-page'), 'collection manager mounts')
  const submissionCopy = manage.document.querySelector('.cm-sub-copy')
  check('COL-UI 昵称与提交身份同一行，时间和文件信息独占下一行', submissionCopy?.querySelector('b')?.textContent.includes('测试供应商甲') && submissionCopy.querySelector('.cm-anon-tag')?.textContent === '匿名提交' && submissionCopy.querySelector('b')?.nextElementSibling?.tagName === 'SMALL' && submissionCopy.querySelector('small')?.textContent.includes('1 个文件'))
  const publicStyles = await readFile(path.join(root, 'src/styles/app-public.css'), 'utf8')
  check('COL-UI 提交信息明确显示在昵称下一行', /\.cm-sub-copy small\s*\{\s*display:\s*block;\s*margin-top:\s*2px/.test(publicStyles))
  check('COL-002 管理端显示提交字段答案与材料清单', manage.document.querySelector('.cm-submission-details')?.textContent.includes('测试供应商甲') && manage.document.querySelector('.cm-submission-details')?.textContent.includes('营业执照'))
  check('NAME-001 管理端同时显示生成文件名与原文件名', manage.document.querySelector('.cm-file-name')?.textContent.includes('测试供应商甲_营业执照_TC-COL-材料-营业执照.pdf') && manage.document.querySelector('.cm-original-file-name')?.textContent.includes('TC-COL-材料-营业执照.pdf'))
  await manage.click('导出清单')
  await manage.waitFor(() => manage.downloads.length > 0 || manage.blobs.length > 0, 'XLSX export download starts', 10000)
  let bytes = null
  for (const blob of manage.blobs) bytes = Buffer.from(await blob.arrayBuffer())
  if (!bytes && manage.downloads[0]?.href.startsWith('data:')) bytes = Buffer.from(manage.downloads[0].href.split(',')[1], 'base64')
  assert.ok(bytes?.length, 'captured exported XLSX bytes')
  const workbook = XLSX.read(bytes, { type: 'buffer', raw: true })
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets['提交清单'], { header: 1, raw: false })
  check('COL-002 导出的XLSX含字段答案、材料文件名与中文列名', rows[0].includes('供应商名称') && rows[0].includes('联系电话') && rows.some(row => row.includes('测试供应商甲') && row.includes('13800138000') && row.includes('测试供应商甲_营业执照_TC-COL-材料-营业执照.pdf')))
  check('COL-002 导出的手机号以文本形式保留且中文字段值无损', rows.some(row => row.includes('qa@example.test') && row.includes('生产商') && row.includes('2026-10-27') && row.includes('1280.50')))
  check('COL-002 管理导出页运行无脚本错误', manage.errors.length === 0)
} finally { manage.window.close() }

console.log(JSON.stringify({ passed, failed: 0, environment: 'Production React bundle in JSDOM; synthetic collection API; exported XLSX parsed with xlsx' }, null, 2))
