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
async function mount(route='/settings/profile',userId='alice',storage={},ttl=0,displayName=userId,contacts={}) {
 const errors=[],virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',e=>errors.push(e))
 const dom=new JSDOM('<div id="root"></div>',{url:'http://fixture.local'+route,pretendToBeVisual:true,runScripts:'outside-only',virtualConsole})
 const {window}=dom,document=window.document
 for(const [key,value]of Object.entries(storage))window.localStorage.setItem(key,value)
 let currentUser=userId,calls=[]
 let holdProfile=false,releaseProfile=null
 let codeResponse={status:201,data:{message:'验证码已发送'}}
 const expiresAt=ttl?Date.now()+ttl:0
 const records=id=>Array.from({length:11},(_,i)=>({id:`${i===9?'sent_to_me':'my_sent'}:share:${id}-${i}`,kind:'share',scope:i===9?'sent_to_me':'my_sent',name:`${id}文件${i}`,shareId:`${id}-${i}`,shareUrl:`http://fixture.local/share/${id}-${i}`,status:'有效',createdAt:new Date().toISOString(),files:[{name:`${id}-${i}.txt`,size:4}]}))
 window.fetch=async(url,options={})=>{
  const method=options.method||'GET';calls.push({url,method,body:options.body});let status=200,data={}
  if(expiresAt&&Date.now()>=expiresAt)currentUser=''
  if(url==='/api/auth/me') data={user:currentUser?{id:currentUser,nickname:displayName,email:'',...contacts,notificationSettings:{},fileCleanup:{enabled:false,days:3}}:null,sessionExpiresAt:expiresAt?new Date(expiresAt).toISOString():null}
  else if(url==='/api/auth/code'){status=codeResponse.status;data=codeResponse.data}
  else if(url==='/api/account/bind'){const target=JSON.parse(options.body).target;data={user:{id:currentUser,nickname:displayName,...contacts,[target.includes('@')?'email':'phone']:target}}}
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
  else if(url==='/api/account/file-cleanup-overview')data={usedBytes:4,totalBytes:1024**3,fileCount:1,shareCount:1,collectionCount:0,activeBytes:4,expiringBytes:0,expiredBytes:0,expiredShareCount:0,expiredCollectionCount:0,expiredFileCount:0,settings:{enabled:false,days:3}}
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
 return {dom,window,document,calls,errors,setCodeResponse:response=>codeResponse=response,expire:()=>currentUser='',holdProfile:()=>holdProfile=true,profilePending:()=>Boolean(releaseProfile),releaseProfile:()=>releaseProfile?.(),storage:()=>Object.fromEntries(Array.from({length:window.localStorage.length},(_,i)=>{const key=window.localStorage.key(i);return[key,window.localStorage.getItem(key)]})),click:async(text)=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text||b.getAttribute('aria-label')===text);assert.ok(b,'button '+text);b.click();await delay(40)}}
}
async function scenario(id,fn){try{await fn();cases.push({id,status:'PASS'});console.log('CASE '+id+' PASS')}catch(e){failures.push({id,message:e.message});cases.push({id,status:'FAIL',message:e.message});console.log('CASE '+id+' FAIL: '+e.message)}}
async function input(f,element,value){assert.ok(element,'input found');Object.getOwnPropertyDescriptor(f.window.HTMLInputElement.prototype,'value').set.call(element,value);element.dispatchEvent(new f.window.Event('input',{bubbles:true}));await delay(30)}
await scenario('AUTH-public-header',async()=>{
 for(const route of ['/team','/workspace','/share/private']) {
  const f=await mount(route);try{
   const entry=()=>f.document.querySelector('.topbar [aria-label="个人中心"]');
   check(route+' keeps the signed-in account entry in the header',entry()?.textContent.includes('alice'));
   entry().click();await delay(20);
   const menu=()=>f.document.querySelector('.topbar [role="menu"]');
   check(route+' account menu includes settings, orders and logout',['账户设置','我的订单','退出登录'].every(label=>menu()?.textContent.includes(label)));
   f.window.dispatchEvent(new f.window.KeyboardEvent('keydown',{key:'Escape'}));await delay(20);
   check(route+' Escape closes the account menu',!menu());
   entry().click();await delay(20);f.document.body.click();await delay(20);
   check(route+' outside click closes the account menu',!menu());
   entry().click();await delay(20);await f.click('退出登录');
   await waitFor(()=>!entry(),'logout clears public account entry');
   check(route+' logout uses the account API',f.calls.some(call=>call.url==='/api/auth/logout'&&call.method==='POST'));
   check(route+' anonymous header keeps the login entry',!!f.document.querySelector('.topbar [aria-label="登录"]'));
   check(route+' account menu has no runtime errors',f.errors.length===0);
  }finally{f.dom.window.close()}
 }
})
await scenario('AUTH-live-phone-format',async()=>{
 const f=await mount('/settings/security');try{
  await f.click('绑定手机号');const target=f.document.querySelector('.account-bind-modal .settings-input-field input');const send=()=>f.document.querySelector('.account-bind-code-row button'),submit=()=>f.document.querySelector('.account-bind-modal button[type="submit"]')
  check('empty phone cannot request verification',send().disabled&&submit().disabled)
  await input(f,target,'12507786589');check('invalid prefix is explained live',target.getAttribute('aria-invalid')==='true'&&f.document.getElementById(target.getAttribute('aria-describedby'))?.textContent.includes('11')&&send().disabled)
  await input(f,target,'135077865891111');check('phone paste limited to eleven digits',target.value==='13507786589')
  check('valid phone enables code only',!send().disabled&&submit().disabled)
  send().click();await delay(40);check('valid phone requests SMS type',JSON.parse(f.calls.find(c=>c.url==='/api/auth/code').body).type==='phone')
  const codeInput=f.document.querySelector('.account-bind-code-row input');await input(f,codeInput,'12345');check('incomplete code cannot bind',submit().disabled)
  await input(f,codeInput,'123456');check('complete verification enables binding',!submit().disabled)
  await input(f,target,'13800001111');check('changing phone clears previous code',codeInput.value===''&&submit().disabled&&!f.document.body.textContent.includes('验证码已发送'))
  check('no phone binding runtime errors',f.errors.length===0)
 }finally{f.dom.window.close()}
})
await scenario('AUTH-live-email-format',async()=>{
 const f=await mount('/settings/security');try{
  await f.click('绑定邮箱');const target=f.document.querySelector('.account-bind-modal .settings-input-field input');const send=()=>f.document.querySelector('.account-bind-code-row button')
  for(const value of ['1160012403@qq.com111111','a..b@example.test','a@-example.test','<b>@example.test']){await input(f,target,value);check('malformed email blocked in real time: '+value,target.getAttribute('aria-invalid')==='true'&&send().disabled)}
  check('invalid email never requests a code',!f.calls.some(c=>c.url==='/api/auth/code'))
  await input(f,target,'name+tag@sub.example.test');check('valid subdomain and plus address accepted',target.getAttribute('aria-invalid')!=='true'&&!send().disabled)
  await input(f,target,'x'.repeat(200));check('email paste has bounded length',target.value.length<=160&&send().disabled)
 }finally{f.dom.window.close()}
})
await scenario('AUTH-sms-failure-clears-demo',async()=>{
 const f=await mount('/settings/security');try{
  const tickers=[],setInterval=f.window.setInterval.bind(f.window);f.window.setInterval=(fn,ms,...args)=>{if(ms===1000)tickers.push(fn);return setInterval(fn,ms,...args)}
  await f.click('绑定手机号');const target=f.document.querySelector('.account-bind-modal .settings-input-field input');await input(f,target,'13500007777')
  f.setCodeResponse({status:201,data:{debugCode:'123456',message:'测试环境未配置短信服务'}});await f.click('获取验证码')
  check('test-only demo code initially visible',f.document.body.textContent.includes('演示验证码'))
  for(let i=0;i<60;i++)tickers.forEach(fn=>fn());await delay(30)
  f.setCodeResponse({status:400,data:{message:'手机号格式不正确，请检查 11 位中国大陆手机号'}});await f.click('重新发送')
  check('rejected SMS displays a readable error',f.document.querySelector('[role="alert"]')?.textContent.includes('手机号格式不正确'))
  check('rejected SMS clears old demo and success notice',!f.document.body.textContent.includes('演示验证码')&&!f.document.body.textContent.includes('测试环境未配置短信服务'))
 }finally{f.dom.window.close()}
})
await scenario('SHARE-self-contact-live',async()=>{
 const f=await mount('/','alice',{},0,'alice',{email:'sender@example.test',phone:'13507786589'});try{
  const picker=f.document.querySelector('input[type="file"]');Object.defineProperty(picker,'files',{configurable:true,value:[new File(['safe'],'safe.txt',{type:'text/plain',lastModified:123})]});picker.dispatchEvent(new f.window.Event('change',{bubbles:true}));await delay(50)
  const target=f.document.querySelector('.delivery-field input');const start=()=>[...f.document.querySelectorAll('.queue-actions button')].find(b=>b.textContent.includes('开始上传'))
  for(const value of ['13507786589','+8613507786589','SENDER@EXAMPLE.TEST','other@example.test，sender@example.test']){await input(f,target,value);check('self recipient explained and blocked: '+value,target.getAttribute('aria-invalid')==='true'&&/自己|本人/.test(f.document.getElementById(target.getAttribute('aria-describedby'))?.textContent)&&start().disabled)}
  check('self recipient makes no upload request',!f.calls.some(c=>c.url==='/api/upload-sessions'))
  await input(f,target,'other@example.test');check('other recipient restores upload button',!start().disabled&&target.getAttribute('aria-invalid')!=='true')
  await input(f,target,'');check('public sharing remains allowed',!start().disabled)
  check('no recipient runtime errors',f.errors.length===0)
 }finally{f.dom.window.close()}
})
await scenario('AUTH-008',async()=>{
 const f=await mount();try{
  const orderEntry=[...f.document.querySelectorAll('.settings-nav button')].find(button=>button.textContent.trim()==='我的订单')
  check('my orders follows file cleanup in the account sidebar',orderEntry?.previousElementSibling?.textContent.trim()==='文件清理'&&orderEntry.textContent.trim()==='我的订单')
  for(const [label,suffix]of [['账号与安全','security'],['消息通知','notice'],['文件清理','cleanup'],['个人资料','profile']]){
   await f.click(label);await waitFor(()=>f.window.location.pathname.endsWith('/'+suffix),'route follows '+label);await waitFor(()=>f.document.querySelector('h1')?.textContent===label,'correct settings heading');check('route follows '+label,f.window.location.pathname.endsWith('/'+suffix));check('correct settings heading',f.document.querySelector('h1')?.textContent===label)
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
 const f=await mount();try{f.expire();await f.click('保存资料');await waitFor(()=>f.document.body.textContent.includes('登录后管理账户设置'),'401 clears account');check('mutation 401 removes account data',!f.document.body.textContent.includes('alice'))}finally{f.dom.window.close()}
})
await scenario('AUTH-006-HTML-display',async()=>{
 const nickname='<img src=x onerror=alert(1)>'
 const f=await mount('/settings/profile','alice',{},0,nickname);try{check('HTML nickname displayed as text',f.document.body.textContent.includes(nickname));check('nickname does not create active HTML',f.document.querySelectorAll('img[src="x"], [onerror],script').length===0);check('HTML retained literally in input',f.document.querySelector('input[placeholder="请输入昵称"]').value===nickname)}finally{f.dom.window.close()}
})
await scenario('AUTH-012-late-response',async()=>{
 const f=await mount();try{f.holdProfile();await f.click('保存资料');await waitFor(f.profilePending,'profile response held');f.expire();f.window.dispatchEvent(new f.window.Event('focus'));await waitFor(()=>f.document.body.textContent.includes('登录后管理账户设置'),'session cleared before response');f.releaseProfile();await delay(80);check('old success response cannot restore expired account',!f.document.body.textContent.includes('alice')&&!f.document.querySelector('.settings-nav'));check('late response has no runtime errors',f.errors.length===0)}finally{f.releaseProfile();f.dom.window.close()}
})
await scenario('AUTH-disabled-login-message',async()=>{
 const message='该账号已被后台禁用，暂时无法登录，请联系管理员。'
 const f=await mount('/?login=failed&message='+encodeURIComponent(message),'');try{
  await waitFor(()=>f.document.querySelector('[role="alert"]')?.textContent.includes(message),'disabled account login message shown')
  check('disabled account login explains the actual reason',f.document.querySelector('[role="alert"]')?.textContent===message)
  check('disabled account login message has no runtime errors',f.errors.length===0)
 }finally{f.dom.window.close()}
})
const result={executedAt:new Date().toISOString(),passed,failures,cases}
if(process.env.AUTH_TEST_EVIDENCE_DIR){fs.mkdirSync(process.env.AUTH_TEST_EVIDENCE_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.AUTH_TEST_EVIDENCE_DIR,'auth-ui-results.json'),JSON.stringify(result,null,2))}
console.log(JSON.stringify(result,null,2));process.exitCode=failures.length?1:0
