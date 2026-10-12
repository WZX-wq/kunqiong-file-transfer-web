import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { JSDOM, VirtualConsole } from 'jsdom'
import { build } from 'vite'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const bundle=await build({root,configFile:false,logLevel:'silent',build:{write:false,minify:false,rollupOptions:{input:path.join(root,'src/main.jsx'),output:{format:'iife',inlineDynamicImports:true}}}})
const code=bundle.output.find(x=>x.type==='chunk').code
let passed=0,failures=[],cases=[]
function check(name,value){assert.ok(value,name);passed++;console.log('PASS '+name)}
async function waitFor(fn,name){for(let i=0;i<200;i++){if(fn())return;await delay(10)}assert.fail(name)}
async function mount(route='/settings/profile',userId='alice',storage={},ttl=0,displayName=userId) {
 const errors=[],virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',e=>errors.push(e))
 const dom=new JSDOM('<div id="root"></div>',{url:'http://fixture.local'+route,pretendToBeVisual:true,runScripts:'outside-only',virtualConsole})
 const {window}=dom,document=window.document
 for(const [key,value]of Object.entries(storage))window.localStorage.setItem(key,value)
 let currentUser=userId,calls=[]
 let holdProfile=false,releaseProfile=null
 const expiresAt=ttl?Date.now()+ttl:0
 const records=id=>Array.from({length:11},(_,i)=>({id:`${i===9?'sent_to_me':'my_sent'}:share:${id}-${i}`,kind:'share',scope:i===9?'sent_to_me':'my_sent',name:`${id}文件${i}`,shareId:`${id}-${i}`,shareUrl:`http://fixture.local/share/${id}-${i}`,status:'有效',createdAt:new Date().toISOString(),files:[{name:`${id}-${i}.txt`,size:4}]}))
 window.fetch=async(url,options={})=>{
  const method=options.method||'GET';calls.push({url,method,body:options.body});let status=200,data={}
  if(expiresAt&&Date.now()>=expiresAt)currentUser=''
  if(url==='/api/auth/me') data={user:currentUser?{id:currentUser,nickname:displayName,email:'',notificationSettings:{},fileCleanup:{enabled:false,days:3}}:null,sessionExpiresAt:expiresAt?new Date(expiresAt).toISOString():null}
  else if(url==='/api/auth/profile'&&!currentUser){status=401;data={message:'请先登录'}}
  else if(url==='/api/auth/profile'){
   data={user:{id:currentUser,nickname:displayName,fileCleanup:{enabled:false,days:3}}}
   if(holdProfile)await new Promise(resolve=>releaseProfile=resolve)
  }
  else if(url==='/api/auth/logout'){currentUser='';data={ok:true}}
  else if(url.startsWith('/api/account/')&&!currentUser){status=401;data={message:'请先登录'}}
  else if(url==='/api/account/records')data={records:method==='GET'?records(currentUser):JSON.parse(options.body||'{}').records||[]}
  else if(url==='/api/account/messages')data={messages:[],settings:{}}
  else if(url==='/api/account/file-cleanup-settings')data={settings:{enabled:false,days:3}}
  else if(url==='/api/account/notification-settings')data={settings:{}}
  else if(url==='/api/account/upgrade-pricing')data={source:'local',pricing:{}}
  else if(url==='/api/account/team/overview')data={organization:{name:'机密团队',members:[]},members:[],memberUsage:[],resources:[],canManage:true}
  else if(url==='/api/account/workspace')data={plan:{id:'free',label:'基础版',totalBytes:1024**3},plans:[],capacity:{},orders:[]}
  else if(url.startsWith('/api/shares/token/')){const id=url.split('/').pop();data={share:{id,code:'CODE',files:[{name:id+'.txt',size:4}],expiresAt:id.endsWith('-0')?new Date(Date.now()-1000).toISOString():new Date(Date.now()+86400000).toISOString(),status:id.endsWith('-0')?'closed':'active',downloadCount:0}};if(!currentUser&&id==='private'){status=401;data={message:'请先登录',code:'directed_login_required'}}}
  else if(url==='/api/guest/quota')data={enabled:false}
  return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}})
 }
 window.eval(code)
 await waitFor(()=>document.querySelector('.app-shell,.public-shell'), 'app mounts')
 await delay(80)
 return {dom,window,document,calls,errors,expire:()=>currentUser='',holdProfile:()=>holdProfile=true,profilePending:()=>Boolean(releaseProfile),releaseProfile:()=>releaseProfile?.(),storage:()=>Object.fromEntries(Array.from({length:window.localStorage.length},(_,i)=>{const key=window.localStorage.key(i);return[key,window.localStorage.getItem(key)]})),click:async(text)=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text||b.getAttribute('aria-label')===text);assert.ok(b,'button '+text);b.click();await delay(40)}}
}
async function scenario(id,fn){try{await fn();cases.push({id,status:'PASS'});console.log('CASE '+id+' PASS')}catch(e){failures.push({id,message:e.message});cases.push({id,status:'FAIL',message:e.message});console.log('CASE '+id+' FAIL: '+e.message)}}
await scenario('AUTH-008',async()=>{
 const f=await mount();try{
  for(const [label,suffix]of [['账号与安全','security'],['消息通知','notice'],['文件清理','cleanup'],['个人资料','profile']]){
   await f.click(label);check('route follows '+label,f.window.location.pathname.endsWith('/'+suffix));check('correct settings heading',f.document.querySelector('h1')?.textContent===label)
  }
  f.window.history.back();await waitFor(()=>f.window.location.pathname.endsWith('/cleanup'),'back to cleanup');check('back preserves column',f.document.querySelector('h1')?.textContent==='文件清理')
  f.window.history.forward();await waitFor(()=>f.window.location.pathname.endsWith('/profile'),'forward profile');check('forward preserves column',f.document.querySelector('h1')?.textContent==='个人资料')
  check('no runtime errors',f.errors.length===0)
 }finally{f.dom.window.close()}
 for(const route of ['profile','security','notice','cleanup']){const f=await mount('/settings/'+route);try{check('refresh preserves '+route,f.document.querySelector('.settings-nav .active')!==null)}finally{f.dom.window.close()}}
})
await scenario('AUTH-011',async()=>{
 const f=await mount('/?view=records');let storage
 try {
  await waitFor(()=>f.calls.some(c=>c.url==='/api/account/records'&&c.method==='PUT'),'records synchronized')
  await delay(50)
  check('pagination shows eight records',f.document.querySelectorAll('.record-row').length===8)
  check('server expiry appears in records',/已失效|已关闭|已过期/.test(f.document.body.textContent))
  await f.click('下一页');check('second page shows remaining three',f.document.querySelectorAll('.record-row').length===3)
  const receive=[...f.document.querySelectorAll('button')].find(b=>b.textContent.includes('发给我的'));assert.ok(receive);receive.click();await delay(30);check('receive filter displays one record',f.document.querySelectorAll('.record-row').length===1)
  storage=f.storage()
 }finally{f.dom.window.close()}
 const other=await mount('/?view=records','bob',storage);try{await waitFor(()=>other.calls.some(c=>c.url==='/api/account/records'&&c.method==='PUT'),'records synchronized');check('another account never uploads previous account records',other.calls.filter(c=>c.url==='/api/account/records'&&c.method==='PUT').every(c=>!c.body.includes('alice')));check('another account does not display previous account data',!other.document.body.textContent.includes('alice-'))}finally{other.dom.window.close()}
})
await scenario('AUTH-012-settings',async()=>{
 const f=await mount();try{check('signed-in profile shown',f.document.querySelector('input[placeholder="请输入昵称"]')?.value==='alice');f.expire();f.window.dispatchEvent(new f.window.Event('focus'));await waitFor(()=>f.document.body.textContent.includes('登录后管理账户设置'),'expired profile clears on focus');check('private data removed',!f.document.querySelector('.settings-nav')&&!f.document.body.textContent.includes('alice'))}finally{f.dom.window.close()}
})
await scenario('AUTH-012-team',async()=>{
 const f=await mount('/team');try{await waitFor(()=>f.document.body.textContent.includes('机密团队'),'team shown');f.expire();f.window.dispatchEvent(new f.window.Event('focus'));await waitFor(()=>!f.document.body.textContent.includes('机密团队'),'expired team removed');check('team cleared on session expiry',!f.document.body.textContent.includes('机密团队'))}finally{f.dom.window.close()}
})
await scenario('AUTH-012-share',async()=>{
 const f=await mount('/share/private');try{await waitFor(()=>f.document.body.textContent.includes('private.txt'),'private share shown');await waitFor(()=>f.calls.some(c=>c.url==='/api/account/records'&&c.method==='POST'),'received share saved to server');check('received share record stored on server',f.calls.some(c=>c.url==='/api/account/records'&&c.method==='POST'&&c.body.includes('sent_to_me')));f.expire();f.window.dispatchEvent(new f.window.Event('focus'));await waitFor(()=>f.document.body.textContent.includes('使用收件账号登录'),'expired private share removed');check('private share requests login again',!f.document.body.textContent.includes('private.txt'))}finally{f.dom.window.close()}
})
await scenario('AUTH-012-short-TTL',async()=>{
 const f=await mount('/settings/profile','alice',{},500);try{check('short TTL initially has session',f.document.body.textContent.includes('alice'));await waitFor(()=>f.document.body.textContent.includes('登录后管理账户设置'),'short TTL expires without navigation');check('expiry removes old profile without user action',!f.document.querySelector('.settings-nav'))}finally{f.dom.window.close()}
})
await scenario('AUTH-012-401',async()=>{
 const f=await mount();try{f.expire();await f.click('保存昵称');await waitFor(()=>f.document.body.textContent.includes('登录后管理账户设置'),'401 clears account');check('mutation 401 removes account data',!f.document.body.textContent.includes('alice'))}finally{f.dom.window.close()}
})
await scenario('AUTH-006-HTML-display',async()=>{
 const nickname='<img src=x onerror=alert(1)>'
 const f=await mount('/settings/profile','alice',{},0,nickname);try{check('HTML nickname displayed as text',f.document.body.textContent.includes(nickname));check('nickname does not create active HTML',f.document.querySelectorAll('img[src="x"], [onerror],script').length===0);check('HTML retained literally in input',f.document.querySelector('input[placeholder="请输入昵称"]').value===nickname)}finally{f.dom.window.close()}
})
await scenario('AUTH-012-late-response',async()=>{
 const f=await mount();try{f.holdProfile();await f.click('保存昵称');await waitFor(f.profilePending,'profile response held');f.expire();f.window.dispatchEvent(new f.window.Event('focus'));await waitFor(()=>f.document.body.textContent.includes('登录后管理账户设置'),'session cleared before response');f.releaseProfile();await delay(80);check('old success response cannot restore expired account',!f.document.body.textContent.includes('alice')&&!f.document.querySelector('.settings-nav'));check('late response has no runtime errors',f.errors.length===0)}finally{f.releaseProfile();f.dom.window.close()}
})
const result={executedAt:new Date().toISOString(),passed,failures,cases}
if(process.env.AUTH_TEST_EVIDENCE_DIR){fs.mkdirSync(process.env.AUTH_TEST_EVIDENCE_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.AUTH_TEST_EVIDENCE_DIR,'auth-ui-results.json'),JSON.stringify(result,null,2))}
console.log(JSON.stringify(result,null,2));process.exitCode=failures.length?1:0
