import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { JSDOM, VirtualConsole } from 'jsdom'
import { build } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const recordsStyles = (await Promise.all([
  'src/styles/base.css',
  'src/styles/components.css',
  'src/styles/app-records.css',
].map(file => readFile(path.resolve(root, file), 'utf8')))).join('\n')
const bundle = await build({
  root, configFile: false, logLevel: 'silent',
  worker: { format: 'es' },
  plugins: [{
    name: 'record-preview-test-entry',
    resolveId(id) { if (id === 'record-preview-test') return '\0record-preview-test' },
    load(id) {
      if (id !== '\0record-preview-test') return
      return `import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { FilePreviewModal, ManageItemModal } from '/src/components/ui.jsx';
        import { RecordsView } from '/src/pages/records.jsx';
        import { recordPreviewConfigs, createShareFilePreviewConfig } from '/src/lib/transfer.js';
        import { syncShareRecord } from '/src/lib/records.js';
        const root = createRoot(document.getElementById('root'));
        window.previewFixture = { recordPreviewConfigs, createShareFilePreviewConfig, syncShareRecord,
          renderManage(data) { root.render(React.createElement(ManageItemModal, {target:{kind:'share',record:{kind:'share'},data},onSave:async payload=>{window.savedSettings=payload;return true},onClose:()=>root.render(null)})) },
          render(preview) { root.render(React.createElement(FilePreviewModal, {preview, onClose:()=>root.render(null), onDownload:()=>{window.downloadClicked=true}})) },
          renderRecords(records) { root.render(React.createElement(RecordsView, {records, onRefresh:async()=>{}, onNotify:()=>{}, onOpen:record=>{window.openedRecord=record}})) },
          unmount() { root.unmount() }
        };`
    },
  }],
  build: { write: false, minify: false, rollupOptions: { input: 'record-preview-test', output: { format: 'iife', inlineDynamicImports: true } } },
})
const code = bundle.output.find(item => item.type === 'chunk').code
let passed = 0
function check(name, condition) { assert.ok(condition, name); passed++; console.log('PASS ' + name) }
async function waitFor(condition, name) {
  for (let i = 0; i < 150; i++) { if (condition()) return; await delay(10) }
  assert.fail(name)
}
async function fixture(handler) {
  const errors = [], requests = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', error => errors.push(error))
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://fixture.local', pretendToBeVisual: true, runScripts: 'outside-only', virtualConsole })
  dom.window.AbortController = AbortController
  dom.window.fetch = async (url, options = {}) => {
    requests.push({ url, method: options.method || 'GET', headers: options.headers || {} })
    return handler(url, options)
  }
  dom.window.eval(code)
  return { dom, window: dom.window, document: dom.window.document, api: dom.window.previewFixture, requests, errors,
    close() { dom.window.previewFixture.unmount(); dom.window.close() } }
}
const ok = body => new Response(body, { status: 200 })
const failure = (status, message) => new Response(JSON.stringify({ message }), { status, headers: { 'x-error-message': encodeURIComponent(message), 'content-type': 'application/json' } })
const record = { kind: 'share', scope: 'my_sent', shareId: 'share', code: 'ABC123', manageToken: 'manage', files: [{ name: 'records.pdf', size: 603 }], status: '已关闭' }

const recordsLayout = await fixture(() => ok('{}'))
try {
  const received = { ...record, id: 'received-share', shareId: 'received-share', code: 'ZX9876', scope: 'sent_to_me', alias: '客户需求.zip', files: [{ name: '客户需求.zip', size: 2048 }], status: '有效' }
  recordsLayout.api.renderRecords([record, received])
  await waitFor(() => recordsLayout.document.querySelectorAll('.record-row').length === 2, 'Records table rows mount')
  const headings = [...recordsLayout.document.querySelectorAll('.records-table-head [role="columnheader"]')].map(item => item.textContent.trim())
  check('Records page uses prototype table columns', headings.join('|') === '文件名|方向|取件码/入口|大小|有效期|状态|操作')
  const recordsHeading = recordsLayout.document.querySelector('.records-heading')
  check('Records view tabs and clear action share the page heading row', Boolean(recordsHeading?.querySelector('.records-mode-tabs') && recordsHeading.querySelector('.records-clear-button')))
  const primaryFilters = recordsLayout.document.querySelector('.records-toolbar-main')
  check('Category, status, date and search share the primary filter row', Boolean(primaryFilters?.querySelector('.record-scope-tabs') && primaryFilters.querySelector('[aria-label="状态筛选"]') && primaryFilters.querySelector('[aria-label="日期筛选"]') && primaryFilters.querySelector('.records-search-box')))
  const utilityRow = recordsLayout.document.querySelector('.records-secondary-row')
  check('Selection, reset, refresh and bulk deletion remain in the compact utility row', Boolean(utilityRow?.querySelector('.record-select-all input') && utilityRow.querySelector('.filter-reset-button') && utilityRow.querySelector('[aria-label="刷新记录"]') && utilityRow.querySelector('.record-bulk-actions .danger-lite')))
  check('Records page retains all categories and status options', recordsLayout.document.querySelectorAll('.record-scope-tabs [role="tab"]').length === 5 && recordsLayout.document.querySelectorAll('[aria-label="状态筛选"] option').length === 4)
  check('Status and date filters use matching native select controls', recordsLayout.document.querySelector('.record-status-select select') && recordsLayout.document.querySelector('.record-date-select:not(.record-status-select) select') && recordsStyles.includes('.record-status-select select'))
  check('Records page retains date, refresh, selection and bulk deletion controls', Boolean(recordsLayout.document.querySelector('[aria-label="日期筛选"]')) && Boolean(recordsLayout.document.querySelector('[aria-label="刷新记录"]')) && Boolean(recordsLayout.document.querySelector('.record-select-all input')) && Boolean(recordsLayout.document.querySelector('.record-bulk-actions .danger-lite')))
  check('Table headings and record rows share responsive grid tracks', recordsStyles.includes('--records-grid-columns: 28px') && recordsStyles.includes('grid-template-columns: var(--records-grid-columns)'))
  check('Every record row retains one cell for each heading, including selection', [...recordsLayout.document.querySelectorAll('.record-row')].every(row => row.children.length === headings.length + 1))
  check('Operation buttons reserve a stable preview slot even when preview is unavailable', recordsLayout.document.querySelectorAll('.record-row .record-preview-slot').length === 2 && recordsLayout.document.querySelectorAll('.record-row .record-preview-slot .record-preview-button').length === 1 && recordsStyles.includes('.record-preview-slot'))
  const search = recordsLayout.document.querySelector('input[placeholder="搜索文件名或取件码"]')
  check('Records page adds prototype filename and pickup-code search', Boolean(search))
  Object.getOwnPropertyDescriptor(recordsLayout.window.HTMLInputElement.prototype, 'value').set.call(search, 'ZX9876')
  search.dispatchEvent(new recordsLayout.window.Event('input', { bubbles: true }))
  await waitFor(() => recordsLayout.document.querySelectorAll('.record-row').length === 1, 'Pickup-code search filters records')
  check('Pickup-code search matches the expected record', recordsLayout.document.querySelector('.record-row .record-main').textContent.includes('客户需求.zip'))
  recordsLayout.document.querySelector('.records-mode-tabs [role="tab"]:not(.active)').click()
  await waitFor(() => recordsLayout.document.querySelectorAll('.file-center-row').length === 2, 'File management rows mount')
  const fileHeadings = [...recordsLayout.document.querySelectorAll('.file-head > span[role="columnheader"]')].map(item => item.textContent.trim())
  check('File center follows the prototype category rail and six-column table', fileHeadings.join('|') === '文件名|类型|来源|大小|状态|操作' && recordsLayout.document.querySelector('.files-layout .file-cats') && recordsLayout.document.querySelector('.file-center-card'))
  check('File center keeps search, filter, upload, and return actions', !!recordsLayout.document.querySelector('.file-center-search input') && !!recordsLayout.document.querySelector('.file-filter-button') && [...recordsLayout.document.querySelectorAll('.records-heading button')].some(button => button.textContent.includes('上传文件')) && [...recordsLayout.document.querySelectorAll('.records-heading button')].some(button => button.textContent.includes('返回收发记录')))
  check('File center row actions preserve preview, download, delete, and management menu', recordsLayout.document.querySelectorAll('.file-center-row .file-row-actions .icon-act').length === 8 && recordsLayout.document.querySelectorAll('.file-center-row .file-more-button').length === 2)
  check('File center URL can restore its current view', new URLSearchParams(recordsLayout.window.location.search).get('center') === 'files')
} finally { recordsLayout.close() }

const paginationLayout = await fixture(() => ok('{}'))
try {
  const pageRecords = Array.from({ length: 11 }, (_, index) => ({
    ...record,
    id: `page-record-${index}`,
    shareId: `page-record-${index}`,
    manageToken: `page-manager-${index}`,
    code: `PC${index}`,
    files: [{ name: `分页文件-${index}.pdf`, size: 1024 }],
    createdAt: `2026-10-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
  }))
  paginationLayout.api.renderRecords(pageRecords)
  await waitFor(() => paginationLayout.document.querySelectorAll('.record-row').length === 8, 'First records page mounts eight rows')
  check('Records first page follows the prototype eight-row density', paginationLayout.document.querySelector('.admin-pagination span')?.textContent.trim() === '显示 1-8 / 11')
  paginationLayout.document.querySelector('.records-mode-tabs [role="tab"]:not(.active)').click()
  await waitFor(() => paginationLayout.document.querySelectorAll('.file-center-row').length === 7, 'First file-management page mounts seven rows')
  check('File management first page follows the prototype seven-row density', paginationLayout.document.querySelector('.file-center-footer')?.textContent.includes('1 / 2'))
} finally { paginationLayout.close() }

const configs = await fixture(() => ok('{}'))
try {
  const [own] = configs.api.recordPreviewConfigs(record)
  check('Own record uses managed preview', own.url.endsWith('/api/shares/manage/manage/files/0/preview'))
  check('Own preview download uses same permission path', own.downloadConfig.url.endsWith('/api/shares/manage/manage/files/0/download'))
  const [received] = configs.api.recordPreviewConfigs({ ...record, scope: 'sent_to_me' })
  check('Received record uses public permission path', received.url.endsWith('/api/shares/share/files/0/preview'))
  check('Received password challenge has verification endpoint', received.unlockUrl === '/api/shares/lookup/ABC123')
} finally { configs.close() }

const collectionRecord = { id: 'my_collections:collection:collection-manager', kind: 'collection', scope: 'my_collections', name: '10月素材', manageToken: 'collection-manager', status: '进行中', submissions: [
  { id: 'first-submission', participantName: '张三', files: [{ name: 'package.exe', size: 250 }, { name: '说明.txt', size: 12 }] },
  { id: 'second-submission', participantName: '李四', files: [{ name: 'archive.zip', size: 40 }, { name: '素材.pdf', size: 60 }] },
] }
const collection = await fixture((url, options) => options.method === 'HEAD' ? ok(null) : ok('收集素材正文'))
try {
  const previews = collection.api.recordPreviewConfigs(collectionRecord)
  check('Mixed collection filters unsupported files without placeholder entries', previews.length === 2 && previews.every(preview => preview.file?.name))
  check('Collection preview retains original submission and file index', previews[0].url.endsWith('/api/collections/manage/collection-manager/submissions/first-submission/files/1/preview') && previews[1].url.endsWith('/submissions/second-submission/files/1/preview'))
  collection.api.renderRecords([collectionRecord])
  await waitFor(() => collection.document.querySelector('.record-preview-button'), 'Collection record preview button appears')
  collection.document.querySelector('.record-preview-button').click()
  await waitFor(() => collection.document.querySelector('.record-preview-chooser'), 'Mixed collection opens file chooser without blanking the page')
  check('Collection chooser shows only supported materials', collection.document.querySelectorAll('.record-preview-option').length === 2 && !collection.document.querySelector('.record-preview-options').textContent.includes('package.exe'))
  collection.document.querySelector('.record-preview-option').click()
  await waitFor(() => collection.document.body.textContent.includes('收集素材正文'), 'Selected collection text loads')
  check('Collection preview uses owner permission endpoint', collection.requests.some(request => request.url.endsWith('/submissions/first-submission/files/1/preview') && request.method === 'HEAD'))
  collection.document.querySelector('[aria-label="关闭预览"]').click()
  await waitFor(() => !collection.document.querySelector('.preview-modal'), 'Collection preview closes')
  check('Closing collection preview preserves records and chooser', Boolean(collection.document.querySelector('.record-preview-button')) && Boolean(collection.document.querySelector('.record-preview-chooser')) && collection.errors.length === 0)
  collection.api.renderRecords([{ ...collectionRecord, submissions: [{ id: 'first-submission', files: [{ name: 'package.exe', size: 250 }] }] }])
  await waitFor(() => !collection.document.querySelector('.record-preview-button'), 'Unsupported-only collection hides preview action')
  check('Unsupported-only collection produces no previews', collection.api.recordPreviewConfigs({ ...collectionRecord, submissions: [{ id: 'first-submission', files: [{ name: 'package.exe' }] }] }).length === 0)
  check('Submission without server identity cannot create an invalid preview URL', collection.api.recordPreviewConfigs({ ...collectionRecord, submissions: [{ files: [{ name: '说明.txt' }] }] }).length === 0)
} finally { collection.close() }

const submissionActions = await fixture(() => ok('{}'))
try {
  const submitted = { kind: 'collection', scope: 'collect_from_me', name: '素材收集', publicUrl: 'http://fixture.local/collect/submission-task', status: 'active', submittedAt: '2026-01-01T08:00:00Z' }
  const pending = { ...submitted, publicUrl: 'http://fixture.local/collect/pending-task', submittedAt: '' }
  const closed = { ...submitted, publicUrl: 'http://fixture.local/collect/closed-task', status: 'closed' }
  const expired = { ...submitted, publicUrl: 'http://fixture.local/collect/expired-task', deadline: '2000-01-01T00:00:00Z' }
  const missingLink = { ...pending, id: 'missing-link', publicUrl: '' }
  submissionActions.api.renderRecords([submitted, pending, closed, expired, missingLink, record])
  await waitFor(() => submissionActions.document.querySelectorAll('.record-submit-button').length === 5, 'Submission actions render')
  const buttons = [...submissionActions.document.querySelectorAll('.record-submit-button')]
  check('Previously submitted collection offers a direct resubmission action and clear status', buttons[0].textContent === '再次提交' && buttons[0].closest('.record-row').querySelector('.record-type').textContent === '已提交')
  buttons[0].click()
  check('Direct submission action opens the original public collection, not its management page', submissionActions.window.openedRecord.publicUrl === submitted.publicUrl && submissionActions.window.openedRecord.scope === 'collect_from_me')
  check('Pending collection offers file submission', buttons[1].textContent === '提交文件' && buttons[1].closest('.record-row').querySelector('.record-type').textContent === '待提交')
  check('Closed and past-deadline collections offer viewing instead of submission', buttons[2].textContent === '查看任务' && buttons[2].closest('.record-row').querySelector('.record-type').textContent === '已关闭' && buttons[3].textContent === '查看任务' && buttons[3].closest('.record-row').querySelector('.record-type').textContent === '已截止')
  check('Missing submission link is disabled while share pickup code remains visible', buttons[4].disabled && [...submissionActions.document.querySelectorAll('.record-code')].some(item => item.tagName === 'SPAN' && item.textContent === 'ABC123') && !submissionActions.document.querySelector('.records-list').textContent.includes('提交入口') && submissionActions.errors.length === 0)
  const inaccessible = { ...record, id: 'my_sent:share:inaccessible', shareId: 'inaccessible', status: '无管理权限' }
  submissionActions.api.renderRecords([inaccessible])
  await waitFor(() => submissionActions.document.querySelector('.record-type')?.textContent === '无管理权限', 'Lost management permission is displayed')
  check('Records without management permission hide protected preview action', !submissionActions.document.querySelector('.record-preview-button'))
  submissionActions.document.querySelector('[aria-label^="更多操作"]').click()
  await waitFor(() => submissionActions.document.querySelector('.record-menu'), 'Inaccessible share menu opens')
  check('Lost management permission disables protected management actions', ['管理分享设置', '设置截至时间', '关闭分享链接'].every(label => [...submissionActions.document.querySelectorAll('.record-menu button')].find(button => button.textContent.includes(label))?.disabled))
} finally { submissionActions.close() }

const blocked = await fixture(() => failure(410, '分享已关闭'))
try {
  blocked.api.render({ file: record.files[0], kind: 'pdf', url: '/gone' })
  await waitFor(() => blocked.document.body.textContent.includes('分享已关闭'), 'Closed PDF displays real reason')
  check('Expired PDF never embeds error endpoint', !blocked.document.querySelector('iframe'))
  check('Failed preflight disables unavailable download', blocked.document.querySelector('.preview-modal-footer button').disabled)
  check('Preflight checks with HEAD', blocked.requests.length === 1 && blocked.requests[0].method === 'HEAD')
} finally { blocked.close() }

const loaded = await fixture(() => ok(null))
try {
  loaded.api.render({ file: record.files[0], kind: 'pdf', url: '/approved-pdf' })
  await waitFor(() => loaded.document.querySelector('iframe'), 'Valid PDF iframe appears')
  check('Valid PDF embeds approved preview URL', loaded.document.querySelector('iframe').getAttribute('src') === '/approved-pdf')
  check('Valid PDF allows download', !loaded.document.querySelector('.preview-modal-footer button').disabled)
  loaded.document.querySelector('.preview-modal-footer button').click()
  check('Preview download uses supplied callback', loaded.window.downloadClicked)
  loaded.document.querySelector('[aria-label="关闭预览"]').click()
  await waitFor(() => !loaded.document.querySelector('.preview-modal'), 'Close removes file preview')
  check('Preview close button works', !loaded.document.querySelector('.preview-modal'))
} finally { loaded.close() }

let unlocked = false
const protectedText = await fixture((url, options) => {
  if (url === '/unlock') {
    if (JSON.parse(options.body).password !== 'correct') return failure(401, '提取密码不正确')
    unlocked = true
    return ok('{"share":{"files":[]}}')
  }
  if (!unlocked) return failure(403, '请输入提取密码')
  return options.method === 'HEAD' ? ok(null) : ok('name,role\nfixture,owner\n')
})
try {
  let sessionInvalidations = 0
  // Test extraction-password access with text; Office parsing runs in its own
  // Worker and has separate integration tests, outside this jsdom environment.
  protectedText.window.addEventListener('kunqiong:account-session', () => { sessionInvalidations++ })
  protectedText.api.render({ file: { name: 'roles.txt' }, kind: 'text', url: '/protected-text', unlockUrl: '/unlock' })
  await waitFor(() => protectedText.document.querySelector('input[type=password]'), 'Password prompt visible')
  check('Protected text prompts before loading bytes', protectedText.requests.every(req => req.method === 'HEAD'))
  const input = protectedText.document.querySelector('input')
  const enterPassword = async value => {
    Object.getOwnPropertyDescriptor(protectedText.window.HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new protectedText.window.Event('input', { bubbles: true }))
    await delay(20)
    protectedText.document.querySelector('form').dispatchEvent(new protectedText.window.Event('submit', { bubbles: true, cancelable: true }))
  }
  await enterPassword('wrong')
  await waitFor(() => protectedText.document.body.textContent.includes('提取密码不正确'), 'Wrong password displayed')
  check('Wrong password keeps content hidden', !protectedText.document.querySelector('.text-preview'))
  check('Wrong extraction password does not invalidate account session', sessionInvalidations === 0)
  await enterPassword('correct')
  await waitFor(() => protectedText.document.querySelector('.text-preview'), 'Unlocked text renders')
  check('Unlocked text displays original content', protectedText.document.querySelector('.text-preview').textContent.includes('fixture') && protectedText.document.querySelector('.text-preview').textContent.includes('owner'))
  check('Password field removed after successful validation', !protectedText.document.querySelector('input[type=password]'))
  check('No password placed in preview URL', protectedText.requests.every(req => !req.url.includes('correct') && !req.url.includes('wrong')))
  check('Text fetch follows successful preflight', protectedText.requests.some(req => req.url === '/protected-text' && req.method === 'GET'))
  check('Preview has no UI runtime errors', protectedText.errors.length === 0)
} finally { protectedText.close() }

let managedUnlocked = false
const managedText = await fixture((url, options) => {
  if (url.endsWith('/unlock')) {
    if (JSON.parse(options.body).password !== '中文密码123') return failure(401, '提取密码不正确')
    managedUnlocked=true
    return ok('{}')
  }
  if (!managedUnlocked) return failure(403, '请输入提取密码')
  return options.method === 'HEAD' ? ok(null) : ok('解锁后的团队正文')
})
try {
  const config=managedText.api.createShareFilePreviewConfig({id:'team',manageToken:'manager'}, {name:'team.txt'},0,{managed:true,password:'stale'})
  managedText.api.render(config)
  await waitFor(()=>managedText.document.querySelector('input[type=password]'),'Stale password prompts again')
  const input=managedText.document.querySelector('input')
  Object.getOwnPropertyDescriptor(managedText.window.HTMLInputElement.prototype,'value').set.call(input,'中文密码123')
  input.dispatchEvent(new managedText.window.Event('input',{bubbles:true}));await delay(20)
  managedText.document.querySelector('form').dispatchEvent(new managedText.window.Event('submit',{bubbles:true,cancelable:true}))
  await waitFor(()=>managedText.document.querySelector('.text-preview'),'Managed preview unlocks')
  check('Managed preview supports Chinese password and replaces stale password',managedText.document.querySelector('.text-preview').textContent==='解锁后的团队正文')
  check('Managed preview never resends stale password after unlock',managedText.requests.filter(r=>!r.url.endsWith('/unlock')).every(r=>!r.headers['x-share-password']))
} finally { managedText.close() }

const manageSettings=await fixture(()=>ok('{}'))
try {
  manageSettings.api.renderManage({id:'team',downloadLimit:10,requiresPassword:true,status:'active',files:[]})
  await waitFor(()=>manageSettings.document.querySelector('.manage-modal'),'Manage settings mount')
  const buttons=()=>[...manageSettings.document.querySelectorAll('button')]
  buttons().find(b=>b.textContent.trim()==='1 次').click()
  const input=manageSettings.document.querySelector('input[type=password]')
  Object.getOwnPropertyDescriptor(manageSettings.window.HTMLInputElement.prototype,'value').set.call(input,'中文密码123')
  input.dispatchEvent(new manageSettings.window.Event('input',{bubbles:true}));await delay(20)
  buttons().find(b=>b.textContent.includes('保存设置')).click()
  await waitFor(()=>manageSettings.window.savedSettings,'Settings submitted')
  check('Share settings submit selected one-download limit and new password together',manageSettings.window.savedSettings.downloadLimit==='1'&&manageSettings.window.savedSettings.password==='中文密码123'&&!manageSettings.window.savedSettings.clearPassword)
} finally {manageSettings.close()}

const synced = await fixture(() => ok(JSON.stringify({ share: { id: 'share', status: 'closed', manageToken: 'manage', files: record.files } })))
try {
  const result = await synced.api.syncShareRecord(record)
  check('Owner sync restores closed share files', result.files.length === 1 && result.files[0].name === 'records.pdf')
  check('Owner sync reads management metadata', synced.requests[0].url === '/api/shares/manage/manage')
} finally { synced.close() }
const expiredSync = await fixture(() => failure(410, '分享已关闭'))
try {
  const expiredRecord = { ...record, scope: 'sent_to_me', status: '已关闭', expiresAt: '2000-01-01T00:00:00.000Z' }
  const result = await expiredSync.api.syncShareRecord(expiredRecord)
  check('Expired received share skips its known-gone public token', result.status === '已关闭' && expiredSync.requests.length === 0)
} finally { expiredSync.close() }
const forbiddenSync = await fixture(() => failure(403, '无权管理其他账号的文件'))
try {
  const activeRecord = { ...record, status: '有效', expiresAt: '2099-01-01T00:00:00.000Z' }
  const first = await forbiddenSync.api.syncShareRecord(activeRecord)
  const second = await forbiddenSync.api.syncShareRecord(first)
  check('Lost share-management permission is shown explicitly', first.status === '无管理权限')
  check('Lost share-management permission is not probed again', second.status === '无管理权限' && forbiddenSync.requests.length === 1)
  const retry = await forbiddenSync.api.syncShareRecord({ ...first, updatedAt: new Date(Date.now() - 6 * 60 * 1000).toISOString() })
  check('Lost share-management permission can be retried after cooldown', retry.status === '无管理权限' && forbiddenSync.requests.length === 2)
} finally { forbiddenSync.close() }
const goneSync = await fixture(() => failure(410, '分享已关闭'))
try {
  const activeRecord = { ...record, status: '有效', expiresAt: '2099-01-01T00:00:00.000Z' }
  const first = await goneSync.api.syncShareRecord(activeRecord)
  const second = await goneSync.api.syncShareRecord(first)
  check('Gone share is recorded as unavailable and not probed again', first.status === '已失效' && second.status === '已失效' && goneSync.requests.length === 1)
} finally { goneSync.close() }
const lockedSync = await fixture(() => ok(JSON.stringify({ requiresPassword: true, share: { id: 'share', code: 'ABC123', files: [] } })))
try {
  const result = await lockedSync.api.syncShareRecord({ ...record, scope: 'sent_to_me' })
  check('Locked response preserves received file snapshot for password challenge', result.files.length === 1)
} finally { lockedSync.close() }
const cleanedSync = await fixture(() => ok(JSON.stringify({ share: { id: 'share', manageToken: 'manage', files: [] } })))
try {
  const result = await cleanedSync.api.syncShareRecord(record)
  check('Authoritative empty file list clears cleaned snapshot', result.files.length === 0 && result.fileCount === 0)
} finally { cleanedSync.close() }
console.log(JSON.stringify({ passed, failures: 0 }))
