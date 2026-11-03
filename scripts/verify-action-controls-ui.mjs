// Real React controls under delayed/rejected work, isolated from HTTP and storage.
import assert from 'node:assert/strict'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { JSDOM, VirtualConsole } from 'jsdom'
import { build } from 'vite'

const root = path.resolve(import.meta.dirname, '..')
const entry = path.join(root, 'scripts/action-controls-fixture.jsx')
const bundle = await build({ root, configFile: false, logLevel: 'silent', worker: { format: 'es' }, plugins: [{
  name: 'action-controls-fixture',
  resolveId(id) { if (id === entry) return id },
  load(id) { if (id === entry) return `
    import React from 'react'
    import { createRoot } from 'react-dom/client'
    import { ActionButton, ActionForm } from '../src/components/action-button.jsx'
    import { RenameRecordModal } from '../src/components/ui.jsx'
    window.mountFixture = (handlers) => {
      const root = createRoot(document.getElementById('root'))
      root.render(<>
        <ActionButton id="action" onClick={handlers.action}>保存</ActionButton>
        <ActionButton id="disabled" disabled onClick={handlers.disabled}>不可用</ActionButton>
        <ActionForm id="form" onSubmit={event => { event.preventDefault(); return handlers.submit() }}>
          <input aria-label="名称" />
          <ActionButton id="submit" type="submit">提交</ActionButton>
          <ActionButton id="cancel" type="button" onClick={handlers.cancel}>取消</ActionButton>
        </ActionForm>
        <RenameRecordModal record={{id:'fixture', name:'原名称', kind:'share'}} onClose={() => {}} onSave={handlers.rename} />
      </>)
      return () => root.unmount()
    }
  ` },
}], build: { write: false, minify: false, rollupOptions: { input: entry, output: { format: 'iife', inlineDynamicImports: true } } } })
const errors = [], vc = new VirtualConsole()
vc.on('jsdomError', error => errors.push(error))
const dom = new JSDOM('<div id="root"></div>', { url: 'http://fixture.local/', pretendToBeVisual: true, runScripts: 'outside-only', virtualConsole: vc })
const { window } = dom, doc = window.document
const deferred = () => { let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes; reject=no }); return {promise,resolve,reject} }
let actionCalls=0, submitCalls=0, cancelCalls=0, renameCalls=0, disabledCalls=0, passed=0
let action = deferred(), submission = deferred(), rename = deferred()
const check = (name, condition) => { assert.ok(condition, name); passed++; console.log('PASS ' + name) }
const waitFor = async (fn, name) => { for(let i=0;i<100;i++) { if(fn()) return; await delay(10) } assert.fail(name) }
window.eval(bundle.output.find(item => item.type==='chunk').code)
const unmount = window.mountFixture({
  action: () => { actionCalls++; return action.promise },
  submit: () => { submitCalls++; return submission.promise },
  rename: () => { renameCalls++; return rename.promise },
  cancel: () => { cancelCalls++ }, disabled: () => { disabledCalls++ },
})
try {
  await waitFor(() => doc.querySelector('#action'), 'Controls render')
  const button = doc.querySelector('#action'), form = doc.querySelector('#form'), submit = doc.querySelector('#submit')
  button.click(); button.click()
  await waitFor(() => button.disabled, 'Pending action disables immediately')
  check('Two same-tick clicks execute one action', actionCalls===1)
  check('Pending action exposes busy state', button.getAttribute('aria-busy')==='true' && button.querySelector('[role=status]'))
  button.click(); check('Further clicks while pending are ignored', actionCalls===1)
  action.resolve(); await waitFor(() => !button.disabled, 'Success unlocks action')
  check('Success clears busy state', !button.hasAttribute('aria-busy'))
  action=deferred(); button.click(); await waitFor(() => button.disabled, 'Retry locks')
  action.reject(Error('fixture failure')); await waitFor(() => !button.disabled, 'Failure unlocks action')
  check('Failure allows retry', actionCalls===2)
  action=deferred(); button.click(); action.resolve(); await delay(20)
  check('Retry after failure runs once', actionCalls===3)
  const fireSubmit = () => form.dispatchEvent(new window.Event('submit', {bubbles:true,cancelable:true}))
  fireSubmit(); fireSubmit(); submit.click()
  await waitFor(() => submit.disabled, 'Form locks submit controls')
  check('Repeated form/Enter submission executes once', submitCalls===1 && form.getAttribute('aria-busy')==='true')
  doc.querySelector('#cancel').click()
  check('Independent cancel remains available', cancelCalls===1 && !doc.querySelector('#cancel').disabled)
  submission.reject(Error('fixture submit failure')); await waitFor(() => !submit.disabled, 'Rejected form unlocks')
  submission=deferred(); fireSubmit(); submission.resolve(); await delay(20)
  check('Form can submit again after failure', submitCalls===2 && !form.hasAttribute('aria-busy'))
  doc.querySelector('#disabled').click()
  check('Originally disabled controls stay disabled', disabledCalls===0 && doc.querySelector('#disabled').disabled)
  const name = doc.querySelector('.rename-modal input')
  const enter = () => name.dispatchEvent(new window.KeyboardEvent('keydown', {key:'Enter',bubbles:true,cancelable:true}))
  enter(); enter()
  await waitFor(() => doc.querySelector('.rename-modal .primary-button').disabled, 'Rename locks through keyboard')
  check('Repeated Enter uses the same rename button guard', renameCalls===1)
  rename.resolve(); await waitFor(() => !doc.querySelector('.rename-modal .primary-button').disabled, 'Rename unlocks')
  action=deferred(); button.click(); unmount(); action.resolve(); await delay(20)
  check('Pending completion after unmount has no runtime errors', errors.length===0)
} finally { window.close() }
console.log(`Action controls UI: ${passed} passed`)
