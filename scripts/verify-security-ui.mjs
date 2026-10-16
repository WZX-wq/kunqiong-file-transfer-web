import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { build } from 'vite'
import { JSDOM, VirtualConsole } from 'jsdom'
import { readTextPreview } from '../src/lib/text-preview.js'
import { resumeDigest } from '../src/lib/resume-digest.js'

const root = path.resolve(import.meta.dirname, '..')
let passed = 0
function check(label, value) { assert.ok(value, label); passed++; console.log('PASS ' + label) }
async function waitFor(condition, label) {
  for (let i = 0; i < 150; i++) { if (condition()) return; await delay(10) }
  assert.fail(label)
}

for (const value of ['', 'abc', '中文😀', 'x'.repeat(1024)]) {
  check('resume digest agrees with SHA-256 for length ' + value.length, resumeDigest(value) === crypto.createHash('sha256').update(value).digest('hex'))
}
const limit = 512 * 1024
let pulled = 0, cancelled = false
const response = new Response(new ReadableStream({
  pull(controller) { pulled++; controller.enqueue(new Uint8Array(64 * 1024).fill(65)) },
  cancel() { cancelled = true },
}, { highWaterMark: 0 }), { headers: { 'content-length': String(1024 ** 3) } })
const text = await readTextPreview(response, limit)
check('text preview retains only the allowed bytes and reports truncation', text.content.length === limit && text.truncated)
check('text preview cancels the remaining large response', cancelled && pulled <= 9)
const controller = new AbortController()
let cancelPending = false
const pending = readTextPreview(new Response(new ReadableStream({ cancel() { cancelPending = true } })), limit, controller.signal)
controller.abort()
await assert.rejects(pending, error => error.name === 'AbortError')
check('closing a stalled text preview cancels its pending read', cancelPending)

const entry = `
  import React, {useState} from 'react';
  import {createRoot} from 'react-dom/client';
  import {useSerializedPreference} from './src/lib/serialized-preference.js';
  import {useConfirmDialog} from './src/hooks.js';
  import {apiRequest, xhrRequest, uploadResumeSignature} from './src/lib/api.js';
  const normalize = value => ({enabled:Boolean(value?.enabled), days:Number(value?.days || 3)});
  const save = next => window.savePreference(next);
  function Harness() {
    const [owner, setOwner] = useState('first');
    const [state, update, error] = useSerializedPreference({enabled:false,days:3}, owner, normalize, save, value => window.saved.push(value));
    const confirm = useConfirmDialog();
    window.harness = {state, update, error, setOwner, ...confirm};
    return React.createElement('div', null, JSON.stringify(state));
  }
  const root = createRoot(document.getElementById('root'));
  window.startHarness = () => root.render(React.createElement(React.StrictMode,null,React.createElement(Harness)));
  window.unmountHarness = () => root.unmount();
  Object.assign(window, {apiRequest, xhrRequest, uploadResumeSignature});
`
const bundle = await build({ root, configFile:false, logLevel:'silent', plugins:[{
  name:'security-ui-fixture',
  resolveId(id) { if (id === 'security-ui-entry') return path.join(root, '__security_ui_entry.jsx') },
  load(id) { if (id === path.join(root, '__security_ui_entry.jsx')) return entry },
}], build:{write:false,minify:false,rollupOptions:{input:'security-ui-entry',output:{format:'iife',inlineDynamicImports:true}}} })
const code = bundle.output.find(item => item.type === 'chunk').code
async function mount() {
  const errors = [], virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', error => errors.push(error))
  const dom = new JSDOM('<div id="root"></div>', {url:'http://fixture.local/settings/notice',pretendToBeVisual:true,runScripts:'outside-only',virtualConsole})
  const {window} = dom
  let user = 'first'
  window.saved = []
  window.fetch = async () => new Response(JSON.stringify({user:{id:user}}), {headers:{'content-type':'application/json'}})
  window.eval(code)
  const requests = []
  window.savePreference = value => new Promise((resolve,reject) => requests.push({value,resolve,reject}))
  await window.apiRequest('/api/auth/me')
  window.startHarness()
  await waitFor(() => window.harness, 'hook mounts')
  await delay(20)
  return {window,requests,errors,close:()=>window.close(),switchUser:async id=>{user=id;await window.apiRequest('/api/auth/me')}}
}

const serial = await mount()
try {
  serial.window.harness.update({enabled:true})
  serial.window.harness.update(current => ({...current,days:7}))
  await waitFor(() => serial.requests.length === 1, 'first preference request')
  check('StrictMode does not duplicate preference requests', serial.requests.length === 1)
  serial.requests[0].resolve({settings:serial.requests[0].value})
  await waitFor(() => serial.requests.length === 2, 'serialized second request')
  check('rapid preference changes preserve the latest full intent', serial.requests[1].value.enabled && serial.requests[1].value.days === 7)
  serial.requests[1].reject(new Error('fixture save rejected'))
  await waitFor(() => serial.window.harness.error, 'visible preference error')
  check('failed last preference rolls back to last confirmed state', serial.window.harness.state.enabled && serial.window.harness.state.days === 3 && serial.window.saved.length === 0)
  const first = serial.window.harness.requestConfirm({title:'first'})
  const second = serial.window.harness.requestConfirm({title:'second'})
  check('replacing a confirmation resolves the previous caller as cancelled', await first === false)
  serial.window.harness.settleConfirm(true)
  check('the current confirmation resolves to the actual choice', await second === true)
  const third = serial.window.harness.requestConfirm({title:'third'})
  serial.window.unmountHarness()
  check('unmount resolves any pending confirmation as cancelled', await third === false)
  check('preference and confirmation hooks have no runtime errors', serial.errors.length === 0)
} finally { serial.close() }

const unmount = await mount()
try {
  unmount.window.harness.update({enabled:true})
  unmount.window.harness.update({days:7})
  await waitFor(() => unmount.requests.length === 1, 'unmount first request')
  unmount.window.unmountHarness()
  unmount.requests[0].resolve({settings:unmount.requests[0].value})
  await waitFor(() => unmount.requests.length === 2, 'same owner queued request survives navigation')
  unmount.requests[1].resolve({settings:unmount.requests[1].value})
  await delay(20)
  check('same account settings queued before navigation are still saved', unmount.requests[1].value.days === 7 && unmount.window.saved.length === 0)
} finally { unmount.close() }

const isolation = await mount()
try {
  isolation.window.harness.update({enabled:true})
  isolation.window.harness.update({days:7})
  await waitFor(() => isolation.requests.length === 1, 'isolation first request')
  isolation.window.unmountHarness()
  await isolation.switchUser('second')
  isolation.requests[0].resolve({settings:isolation.requests[0].value})
  await delay(60)
  check('an unmounted old account queue cannot write with a new account session', isolation.requests.length === 1 && isolation.window.saved.length === 0)
} finally { isolation.close() }

const transport = await mount()
try {
  const {window} = transport
  window.XMLHttpRequest = class {
    constructor() { this.upload = {} }
    open() {}
    send() { this.status = 502; this.responseText = '<html>Bad Gateway</html>'; queueMicrotask(() => this.onload()) }
  }
  await assert.rejects(window.xhrRequest('/fixture',{body:'x'}), /服务响应格式不正确/)
  check('non-JSON upload responses settle with a readable error', true)
  const signature = window.uploadResumeSignature([{name:'fixture.txt',size:1}],1048576,{}, {password:'PRIVATE_TEST_PASSWORD',recipients:'private@example.test'})
  check('resume storage contains no literal password or recipient contact', !signature.includes('PRIVATE_TEST_PASSWORD') && !signature.includes('private@example.test') && JSON.parse(signature).version === 2)
  let invalidations=0
  window.addEventListener('kunqiong:account-session',()=>invalidations++)
  window.fetch=async()=>new Response(JSON.stringify({message:'提取密码不正确',code:'share_password_invalid'}),{status:401})
  await assert.rejects(window.apiRequest('/api/shares/lookup/ABC123',{method:'POST',body:JSON.stringify({password:'wrong'})}),/提取密码不正确/)
  check('wrong extraction password preserves account session',invalidations===0)
  window.fetch=async()=>new Response(JSON.stringify({message:'请先登录'}),{status:401})
  await assert.rejects(window.apiRequest('/api/account/team/overview'),/请先登录/)
  check('real expired account session still invalidates authentication',invalidations===1)
} finally { transport.close() }
console.log('Security UI regression: ' + passed + ' passed')
