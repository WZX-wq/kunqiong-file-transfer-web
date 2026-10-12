import assert from 'node:assert/strict'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { JSDOM, VirtualConsole } from 'jsdom'
import { build, transformWithEsbuild } from 'vite'

const root = path.resolve(import.meta.dirname, '..').replaceAll('\\', '/')
const entry = '\0boundary-controls.jsx'
const source = `
import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
import {SettingsModal} from ${JSON.stringify(root + '/src/pages/workspace.jsx')};
import {AdminLoginModal} from ${JSON.stringify(root + '/src/pages/AdminPage.jsx')};
import {SharePage} from ${JSON.stringify(root + '/src/pages/public.jsx')};
import {FilePreviewModal} from ${JSON.stringify(root + '/src/components/ui.jsx')};
const mode = window.boundaryMode; const api = window.boundaryControls = {saved:0,credentials:null,settings:null};
function Controls() {
  const [settings,setSettings] = useState({expiryDays:'7',downloadLimit:'custom',customDownloadLimit:'1',codeLength:'6',passwordEnabled:true,password:'legal',...window.boundarySettings});
  api.settings = settings;
  if(mode==='settings') return <SettingsModal settings={settings} setSettings={setSettings} user={{plan:{permanent:true}}} onClose={()=>{}} onSave={()=>api.saved++}/>;
  if(mode==='admin') return <AdminLoginModal onSubmit={value=>api.credentials=value} onBackHome={()=>{}}/>;
  if(mode==='public') return <SharePage token='fixture'/>;
  return <FilePreviewModal preview={{kind:'text',url:'/protected-preview',unlockUrl:'/unlock',file:{name:'safe.txt',size:4}}} onClose={()=>{}}/>;
}
createRoot(document.getElementById('root')).render(<Controls/>);
`
const bundle = await build({root,configFile:false,logLevel:'silent',plugins:[{name:'boundary-entry',resolveId(id){if(id==='boundary-controls')return entry},async load(id){if(id===entry)return (await transformWithEsbuild(source,'boundary-controls.jsx',{loader:'jsx'})).code}}],build:{write:false,minify:false,rollupOptions:{input:'boundary-controls',output:{format:'iife',inlineDynamicImports:true}}}})
const code = bundle.output.find(item=>item.type==='chunk').code
let passed = 0
async function test(name,run){await run();passed++;console.log('PASS '+name)}
async function waitFor(run){for(let i=0;i<200;i++){if(run())return;await delay(10)}assert.fail('React control did not mount')}
async function mount(mode,settings={}){
  const errors=[],virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',error=>errors.push(error))
  const dom=new JSDOM('<div id="root"></div>',{url:'http://fixture.local/',pretendToBeVisual:true,runScripts:'outside-only',virtualConsole})
  const {window}=dom, document=window.document
  window.boundaryMode=mode;window.boundarySettings=settings
  window.fetch=async(url)=>new Response(JSON.stringify(url==='/protected-preview'?{message:'请输入提取密码'}:url.startsWith('/api/shares/token/')?{requiresPassword:true,share:{id:'fixture',code:'CODE',files:[]}}:url==='/api/account/records'?{records:[]}:{user:null}),{status:url==='/protected-preview'?401:200,headers:{'content-type':'application/json'}})
  window.eval(code)
  await waitFor(()=>document.querySelector('input[type="password"]'))
  const input=async(element,value)=>{assert.ok(element);Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(element,value);element.dispatchEvent(new window.Event('input',{bubbles:true}));await delay(20)}
  return {dom,window,document,errors,input}
}
await test('Settings reject empty, fractional and out-of-range custom downloads immediately',async()=>{
  const f=await mount('settings');try{
    const field=f.document.querySelector('input[type="number"]'), save=()=>[...f.document.querySelectorAll('button')].find(button=>button.textContent.includes('保存设置'))
    for(const value of ['','0','10000','1.5','-1']){await f.input(field,value);assert.equal(save().disabled,true);assert.match(f.document.querySelector('[role="alert"]').textContent,/1–9999/);save().click();assert.equal(f.window.boundaryControls.saved,0)}
    for(const value of ['1','9999']){await f.input(field,value);assert.equal(save().disabled,false)}
    save().click();assert.equal(f.window.boundaryControls.saved,1)
  }finally{f.dom.window.close()}
})
await test('Settings show password limits, block whitespace, and preserve full Unicode',async()=>{
  const f=await mount('settings');try{
    const field=f.document.querySelector('input[type="password"]'),save=()=>[...f.document.querySelectorAll('button')].find(button=>button.textContent.includes('保存设置'))
    assert.equal(field.maxLength,128)
    await f.input(field,'   ');assert.equal(save().disabled,true);assert.match(f.document.querySelector('[role="alert"]').textContent,/空格/)
    await f.input(field,'a'.repeat(127)+'😀');assert.equal(field.value,'a'.repeat(127));assert.equal(f.window.boundaryControls.settings.password.length,127)
    await f.input(field,'b'.repeat(128));assert.equal(save().disabled,false);assert.ok(f.document.body.textContent.includes('128/128'))
  }finally{f.dom.window.close()}
})
await test('Invalid saved settings cannot be approved before correction',async()=>{
  const f=await mount('settings',{password:'x'.repeat(129)});try{assert.equal([...f.document.querySelectorAll('button')].find(button=>button.textContent.includes('保存设置')).disabled,true)}finally{f.dom.window.close()}
})
await test('Admin login caps actual controlled values before authentication',async()=>{
  const f=await mount('admin');try{
    const inputs=f.document.querySelectorAll('input'),username=inputs[0],password=inputs[1]
    assert.equal(username.maxLength,120);assert.equal(password.maxLength,128)
    await f.input(username,'u'.repeat(121));await f.input(password,'p'.repeat(129));assert.equal(username.value.length,120);assert.equal(password.value.length,128)
    f.document.querySelector('form').dispatchEvent(new f.window.Event('submit',{bubbles:true,cancelable:true}));assert.equal(f.window.boundaryControls.credentials.username.length,120);assert.equal(f.window.boundaryControls.credentials.password.length,128)
    assert.equal(f.errors.length,0)
  }finally{f.dom.window.close()}
})
for(const mode of ['public','preview'])await test(mode+' password accepts the maximum and clamps oversize input',async()=>{
  const f=await mount(mode);try{
    const field=f.document.querySelector('input[type="password"]');assert.equal(field.maxLength,128)
    await f.input(field,'p'.repeat(128));assert.equal(field.value.length,128)
    await f.input(field,'p'.repeat(127)+'😀');assert.equal(field.value,'p'.repeat(127));assert.equal(f.errors.length,0)
  }finally{f.dom.window.close()}
})
console.log(`Boundary UI: ${passed} behavior groups passed`)
