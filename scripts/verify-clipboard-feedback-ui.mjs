import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { JSDOM, VirtualConsole } from 'jsdom'
import { build } from 'vite'

const root = fileURLToPath(new URL('../', import.meta.url))
const bundle = await build({
  root, configFile: false, logLevel: 'silent', worker: { format: 'es' },
  plugins: [{
    name: 'clipboard-feedback-fixture',
    resolveId(id) { if (id === 'clipboard-feedback-fixture') return '\0clipboard-feedback-fixture' },
    transform(source, id) {
      if (id.endsWith('/src/pages/public.jsx')) return source + '\nexport { CollectionSubmittedPage };'
    },
    load(id) {
      if (id !== '\0clipboard-feedback-fixture') return
      return `import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { SharePage, ShareManagePage, CollectionSubmittedPage, CollectionManagePage } from '/src/pages/public.jsx';
        import { AdminResources } from '/src/pages/AdminPage.jsx';
        import { UpgradeModal } from '/src/pages/workspace-page.jsx';
        import { MessageCenter } from '/src/pages/workspace.jsx';
        const root = createRoot(document.getElementById('root'));
        window.fixture = {
          render(name, props) { root.render(React.createElement({ SharePage, ShareManagePage, CollectionSubmittedPage, CollectionManagePage, AdminResources, UpgradeModal, MessageCenter }[name], props)) },
          unmount() { root.unmount() }
        };`
    },
  }],
  build: { write: false, minify: false, rollupOptions: { input: 'clipboard-feedback-fixture', output: { format: 'iife', inlineDynamicImports: true } } },
})
const code = bundle.output.find(item => item.type === 'chunk').code
const share = { id: 'demo', code: 'ABC123', shareUrl: 'http://fixture.local/share/demo', qrDataUrl: 'data:image/png;base64,aGVsbG8=', status: 'active', files: [{ name: 'demo.txt', size: 12 }], createdAt: '2026-10-22T01:00:00Z' }
const collection = { id: 'collect-demo', title: '测试收集', status: 'active', publicUrl: 'http://fixture.local/collect/demo', manageToken: 'demo', qrDataUrl: share.qrDataUrl, submissions: [], deadline: '2099-01-01T00:00:00Z' }
let passed = 0
const check = (name, condition) => { assert.ok(condition, name); passed++; console.log('PASS ' + name) }
async function waitFor(condition, message) {
  for (let i = 0; i < 120; i++) { if (condition()) return; await delay(10) }
  assert.fail(message)
}
function fixture() {
  const errors = []
  const vc = new VirtualConsole()
  vc.on('jsdomError', error => errors.push(error.message))
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://fixture.local/share/demo', pretendToBeVisual: true, runScripts: 'outside-only', virtualConsole: vc })
  const { window } = dom
  const toastTimers = new Map()
  const nativeSetTimeout = window.setTimeout.bind(window)
  const nativeClearTimeout = window.clearTimeout.bind(window)
  let timerId = -1
  window.setTimeout = (callback, ms, ...args) => {
    if (ms !== 3000) return nativeSetTimeout(callback, ms, ...args)
    const id = timerId--
    toastTimers.set(id, callback)
    return id
  }
  window.clearTimeout = id => { toastTimers.delete(id); nativeClearTimeout(id) }
  window.clipboardWrites = []
  window.textFails = false
  window.imageFails = false
  window.isSecureContext = true
  window.ClipboardItem = class { constructor(data) { this.data = data } }
  Object.defineProperty(window.navigator, 'clipboard', { value: {
    async writeText(text) { if (window.textFails) throw Error('denied'); if (window.holdCopy) await new Promise(resolve => { window.finishCopy = resolve }); window.clipboardWrites.push(text) },
    async write(items) { if (window.imageFails) throw Error('denied'); window.clipboardWrites.push(items) },
  } })
  window.document.execCommand = () => false
  window.shareFixture = structuredClone(share)
  window.collectionFixture = structuredClone(collection)
  window.fetch = async (url, options = {}) => {
    if (String(url).startsWith('data:')) return new Response(new Blob(['png'], { type: 'image/png' }))
    const kind = String(url).includes('/api/shares/') ? 'share' : String(url).includes('/api/collections/') ? 'collection' : null
    if (kind && window.actionFails) return new Response(JSON.stringify({ message: '操作服务暂不可用' }), { status: 503 })
    if (kind && options.method) {
      const current = window[`${kind}Fixture`]
      const patch = options.body ? JSON.parse(options.body) : {}
      window[`${kind}Fixture`] = options.method === 'DELETE'
        ? String(url).includes('/submissions/') ? { ...current, submissions: [] } : { ...current, status: 'closed' }
        : { ...current, ...patch }
    }
    return new Response(JSON.stringify(kind ? { [kind]: window[`${kind}Fixture`] } : { user: null }), { headers: { 'content-type': 'application/json' } })
  }
  window.eval(code)
  const button = text => [...window.document.querySelectorAll('button')].find(el => el.textContent.trim() === text)
  return { window, document: window.document, api: window.fixture, button, errors, toastTimers, close() { window.fixture.unmount(); window.close() } }
}

const publicShare = fixture()
try {
  publicShare.api.render('SharePage', { token: 'demo' })
  await waitFor(() => publicShare.button('二维码'), 'Share page mounts')
  publicShare.button('二维码').click()
  await waitFor(() => publicShare.button('复制链接'), 'QR dialog opens')
  publicShare.button('复制链接').click()
  await waitFor(() => publicShare.document.querySelector('.toast.success'), 'Copying a public share link must display success above the dialog')
  check('Public share link displays success feedback', publicShare.document.querySelector('.toast').textContent.includes('链接已复制'))
  check('Feedback escapes transformed page containers', publicShare.document.querySelector('.toast').parentElement === publicShare.document.body)
  check('QR backdrop covers the viewport outside page containers', publicShare.document.querySelector('.modal-backdrop').parentElement === publicShare.document.body)
  const firstToast = publicShare.document.querySelector('.toast')
  const firstTimer = [...publicShare.toastTimers.keys()][0]
  publicShare.button('复制链接').click()
  await waitFor(() => publicShare.document.querySelector('.toast') !== firstToast, 'Repeated copy reannounces success')
  await waitFor(() => !publicShare.toastTimers.has(firstTimer) && publicShare.toastTimers.size === 1, 'Repeated copy resets its dismissal timer')
  check('Repeated copy restarts feedback with only one timer', publicShare.toastTimers.size === 1)
  publicShare.button('复制图片').click()
  await waitFor(() => publicShare.document.querySelector('.toast')?.textContent.includes('二维码图片已复制'), 'Image copy displays success')
  check('Image is actually written before success feedback', Array.isArray(publicShare.window.clipboardWrites.at(-1)))
  publicShare.window.imageFails = true
  publicShare.button('复制图片').click()
  await waitFor(() => publicShare.document.querySelector('.toast.success')?.textContent.includes('已改为复制链接'), 'Image fallback explains the actual copied content')
  check('Image fallback copies the share URL', publicShare.window.clipboardWrites.at(-1) === share.shareUrl)
  publicShare.window.textFails = true
  publicShare.button('复制图片').click()
  await waitFor(() => publicShare.document.querySelector('.toast.error'), 'Both clipboard paths failing displays error')
  check('Failure provides an accessible alert and recovery advice', publicShare.document.querySelector('[role="alert"].toast')?.textContent.includes('手动'))
  await waitFor(() => publicShare.toastTimers.size === 1, 'Error schedules dismissal')
  const dismiss = [...publicShare.toastTimers.values()][0]
  dismiss()
  await waitFor(() => !publicShare.document.querySelector('.toast'), 'Feedback disappears automatically')
  check('Dismissal cleans up the timer', publicShare.toastTimers.size === 0)
  publicShare.window.textFails = false
  publicShare.window.holdCopy = true
  publicShare.button('复制链接').click()
  await waitFor(() => publicShare.window.finishCopy, 'Clipboard operation is pending')
  check('No success is displayed before clipboard completion', !publicShare.document.querySelector('.toast'))
  publicShare.window.finishCopy()
  await waitFor(() => publicShare.document.querySelector('.toast.success'), 'Pending copy reports success only when complete')
  check('Public share has no runtime errors', publicShare.errors.length === 0)
} finally { publicShare.close() }

for (const [name, props, findButton, success] of [
  ['ShareManagePage', { token: 'demo' }, f => f.button('复制链接'), '分享链接已复制'],
  ['CollectionManagePage', { token: 'demo' }, f => f.button('提交链接'), '提交链接已复制'],
  ['CollectionSubmittedPage', { collection, submission: { id: 'receipt-demo', files: share.files, submittedAt: share.createdAt }, onAgain() {} }, f => f.button('复制回执') || f.button('已复制回执'), '提交回执已复制'],
  ['AdminResources', { resources: [{ id: 'resource-demo', kind: 'share', name: '测试资源', status: 'active' }] }, f => f.document.querySelector('.admin-resource-id'), '资源 ID 已复制'],
  ['UpgradeModal', { workspace: { plan: { id: 'free' }, plans: [] }, initialOrder: { id: 'order-demo', orderNo: 'KQ20261022', planId: 'member', status: 'paid', amount: 1900 }, onClose() {} }, f => f.button('复制'), '订单号已复制'],
  ['MessageCenter', { user: { id: 'user-demo' }, messages: [{ id: 'message-demo', title: '新文件', body: '取件码 ABC123。', unread: true }], open: true, onClose() {} }, f => f.document.querySelector('.message-code-chip'), '取件码已复制'],
]) {
  const f = fixture()
  try {
    f.api.render(name, props)
    await waitFor(() => findButton(f), `${name} copy control mounts`)
    findButton(f).click()
    await waitFor(() => f.document.querySelector('.toast.success')?.textContent.includes(success), `${name} displays copy success`)
    check(`${name} confirms clipboard success`, f.window.clipboardWrites.length === 1)
    f.window.textFails = true
    findButton(f).click()
    await waitFor(() => f.document.querySelector('.toast.error'), `${name} displays copy failure`)
    check(`${name} reports failure without claiming success`, f.window.clipboardWrites.length === 1 && f.document.querySelector('.toast').textContent.includes('复制失败'))
    check(`${name} has no runtime errors`, f.errors.length === 0)
  } finally { f.close() }
}

for (const [name, settings, closed, reopened, reopenButton, closeButton] of [
  ['ShareManagePage', '分享设置', '分享已关闭', '分享已重新开启', '重新开启', '关闭分享'],
  ['CollectionManagePage', '收集设置', '收集任务已关闭', '收集任务已重新开启', '重新开启任务', '关闭收集'],
]) {
  const f = fixture()
  try {
    f.api.render(name, { token: 'demo' })
    await waitFor(() => f.button(settings), `${name} settings mount`)
    f.button(settings).click()
    await waitFor(() => f.button('保存设置'), `${name} settings dialog opens`)
    f.button('保存设置').click()
    await waitFor(() => f.document.querySelector('.toast.success')?.textContent.includes('设置已保存'), `${name} settings save confirms success`)
    check(`${name} settings save closes dialog with feedback`, !f.button('保存设置'))
    f.button('立即关闭').click()
    await waitFor(() => f.button(closeButton), `${name} close confirmation opens`)
    f.button(closeButton).click()
    await waitFor(() => f.document.querySelector('.toast.success')?.textContent.includes(closed), `${name} close confirms success`)
    check(`${name} closing confirms completion`, Boolean(f.button(reopenButton)))
    f.button(reopenButton).click()
    await waitFor(() => f.document.querySelector('.toast.success')?.textContent.includes(reopened), `${name} reopening confirms success`)
    check(`${name} reopening confirms completion`, Boolean(f.button('立即关闭')))
    f.button(settings).click()
    await waitFor(() => f.button('保存设置'), `${name} reopens settings`)
    f.window.actionFails = true
    f.button('保存设置').click()
    await waitFor(() => f.document.querySelector('.toast.error')?.textContent.includes('操作服务暂不可用'), `${name} failed save is visible above modal`)
    check(`${name} failed save preserves the settings dialog`, Boolean(f.button('保存设置')))
    check(`${name} management actions have no runtime errors`, f.errors.length === 0)
  } finally { f.close() }
}

const overlay = fixture()
try {
  let closed = false
  overlay.api.render('UpgradeModal', { workspace: { plan: { id: 'free' }, plans: [] }, initialOrder: { id: 'order-demo', orderNo: 'KQ20261022', planId: 'member', status: 'paid', amount: 1900 }, onClose() { closed = true } })
  await waitFor(() => overlay.button('复制'), 'Upgrade dialog copy mounts')
  overlay.button('复制').click()
  await waitFor(() => overlay.document.querySelector('.toast.success'), 'Upgrade copy feedback mounts')
  overlay.document.querySelector('.toast').dispatchEvent(new overlay.window.MouseEvent('mousedown', { bubbles: true }))
  check('Interacting with feedback does not close the underlying modal', !closed)
} finally { overlay.close() }

const submissionActions = fixture()
try {
  submissionActions.window.collectionFixture.submissions = [{ id: 'submission-demo', participantName: '测试提交人', submittedAt: share.createdAt, files: share.files }]
  submissionActions.api.render('CollectionManagePage', { token: 'demo' })
  await waitFor(() => submissionActions.button('刷新'), 'Collection manager mounts')
  submissionActions.button('刷新').click()
  await waitFor(() => submissionActions.document.querySelector('.toast.success')?.textContent.includes('收集任务已刷新'), 'Refresh reports completion')
  check('Refreshing a collection displays success feedback', true)
  submissionActions.window.actionFails = true
  submissionActions.button('刷新').click()
  await waitFor(() => submissionActions.document.querySelector('.toast.error')?.textContent.includes('操作服务暂不可用'), 'Refresh reports failure')
  check('Failed refresh preserves existing submissions', Boolean(submissionActions.document.querySelector('.cm-delete')))
  submissionActions.window.actionFails = false
  submissionActions.document.querySelector('.cm-delete').click()
  await waitFor(() => submissionActions.button('删除提交'), 'Submission deletion asks for confirmation')
  submissionActions.button('删除提交').click()
  await waitFor(() => submissionActions.document.querySelector('.toast.success')?.textContent.includes('提交记录已删除'), 'Deletion confirms success')
  check('Deleting a submission displays completion and updates the list', !submissionActions.document.querySelector('.cm-delete'))
  check('Submission management has no runtime errors', submissionActions.errors.length === 0)
} finally { submissionActions.close() }

console.log(`Operation feedback UI checks passed: ${passed}`)
