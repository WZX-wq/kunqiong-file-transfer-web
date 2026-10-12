import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { JSDOM, VirtualConsole } from 'jsdom'
import { build } from 'vite'
import { systemConfigError } from '../server/lib/admin-validation.js'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const bundle=await build({root,configFile:false,logLevel:'silent',build:{write:false,minify:false,rollupOptions:{input:path.join(root,'src/main.jsx'),output:{format:'iife',inlineDynamicImports:true}}}})
const code=bundle.output.find(x=>x.type==='chunk').code
let passed=0,failures=[]
function check(label,value){if(value){passed++;console.log('PASS '+label)}else{failures.push(label);console.log('FAIL '+label)}}
async function wait(fn){for(let i=0;i<150;i++){if(fn())return;await delay(10)}throw Error('render timeout')}
const plans=[{id:'free',label:'基础版',totalBytes:20*1024**3,monthlyPrice:0},{id:'member',label:'会员版',totalBytes:100*1024**3,monthlyPrice:1900,validityDays:30}]
const defaultConfig=()=>({defaultShareDays:3,maxShareDays:30,anonymousMaxFileSizeMb:500,anonymousTotalSizeMb:1024,maxBatchFiles:100,auditLogRetentionDays:90,orphanGraceHours:24,maintenanceMode:false,planOverrides:{}})
const overview=()=>({stats:{users:1},totals:{users:1,resources:1,auditLogs:0},users:[{id:'fixture',nickname:'敏感用户记录',planId:'free',status:'active'}],resources:[{id:'fixture',kind:'share',name:'敏感文件',status:'active',totalSize:4}],trend:[],auditLogs:[],plans,config:defaultConfig()})
async function mount(route,{priceError=false,unavailable=false,authenticated=true,resourceCount=1}={}){
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message))
 const dom=new JSDOM('<div id="root"></div>',{url:'http://fixture.local'+route,runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc})
 const {window}=dom,document=window.document;let admin=authenticated,held=null,hold=false,calls=[]
 const adminData=overview();if(resourceCount>1){adminData.resources=Array.from({length:resourceCount},(_,i)=>({id:'fixture-'+i,kind:'share',name:i===5?'<img src=x onerror=alert(1)>':'验收资源-'+i,status:'active',totalSize:4}));adminData.totals.resources=resourceCount}
 window.fetch=async(url,opts={})=>{calls.push({url,method:opts.method||'GET',body:opts.body?JSON.parse(opts.body):undefined});let status=200,data={}
  if(url==='/api/auth/me')data={user:{id:'fixture',nickname:'fixture'}}
  else if(url==='/api/account/workspace')data={plan:plans[0],plans,capacity:{},orders:[]}
  else if(url==='/api/account/upgrade-pricing'){if(priceError){status=502;data={message:'套餐价格加载失败，请稍后重试'}}else data={source:'remote',pricing:{member:unavailable?{available:false,message:'套餐暂不可用，请稍后重试'}:{available:true,priceCents:2900,validityDays:45}}}}
  else if(url==='/api/admin/session')data={authenticated:admin,admin:admin?{username:'fixture-admin'}:null}
  else if(url==='/api/admin/overview'){data=adminData;if(!admin){status=401;data={message:'请先登录后台'}}if(hold)await new Promise(r=>held=r)}
  else if(url==='/api/admin/logout'){admin=false;data={ok:true}}
  else if(url==='/api/admin/login'){admin=true;data={admin:{username:'fixture-admin'},overview:overview()}}
  else if(url==='/api/admin/cleanup')data={overview:overview()}
  else if(url==='/api/admin/config'){const body=JSON.parse(opts.body),message=systemConfigError(body,defaultConfig());status=message?400:200;data=message?{message}:{config:body}}
  else if(url.startsWith('/api/admin/resources/')){adminData.resources=adminData.resources.filter(x=>x.id!==url.split('/').at(-1));adminData.totals.resources=adminData.resources.length;data={ok:true,overview:adminData}}
  else if(url==='/api/guest/quota')data={enabled:false}
  return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}})
 }
 window.eval(code);await delay(120)
 const click=async label=>{const btn=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===label||b.getAttribute('aria-label')===label);assert.ok(btn,'button '+label);btn.click();await delay(40)}
 return{window,document,dom,errors,calls,click,expire:()=>admin=false,hold:()=>hold=true,held:()=>!!held,release:()=>held?.()}
}
for(const mode of['remote','error','unavailable']){const f=await mount('/workspace',{priceError:mode==='error',unavailable:mode==='unavailable'});try{await f.click('升级权益');await delay(60);const text=f.document.body.textContent;if(mode==='remote')check('PAY-001 远端价格与天数展示',text.includes('29')&&text.includes('45'));else if(mode==='error')check('PAY-001 价格失败可见且禁止创建',text.includes('套餐价格加载失败')&&f.document.querySelector('.upgrade-summary button')?.disabled);else check('PAY-001 不可用套餐禁止创建',text.includes('套餐暂不可用')&&(!f.document.querySelector('.upgrade-summary button')||f.document.querySelector('.upgrade-summary button').disabled));check('PAY UI 无运行错误',!f.errors.length)}finally{f.dom.window.close()}}
for(const event of['focus','pageshow']){const f=await mount('/admin');try{check('ADMIN 已登录后台',!!f.document.querySelector('.admin-page'));f.expire();f.window.dispatchEvent(new f.window.Event(event));await delay(150);check('ADMIN-011 '+event+'重新验证并清除旧数据',!!f.document.querySelector('.admin-login-modal')&&!f.document.body.textContent.includes('敏感用户记录'))}finally{f.dom.window.close()}}
const configUI=await mount('/admin');try{
 await configUI.click('系统配置');await configUI.click('保存配置');
 let body=configUI.calls.filter(x=>x.url==='/api/admin/config').at(-1)?.body;
 check('ADMIN-007 默认表单通过实际服务端校验',!!body&&!systemConfigError(body,defaultConfig()));
 check('ADMIN-007 空白套餐覆盖恢复默认且不变为永久',body&&Object.values(body.planOverrides).every(plan=>Object.keys(plan).length===0));
 const input=(name,value)=>{configUI.document.querySelector(`[name="${name}"]`).value=value};
 input('plan-member-gb','150');input('plan-member-price','0');input('plan-member-days','45');await configUI.click('保存配置');
 body=configUI.calls.filter(x=>x.url==='/api/admin/config').at(-1)?.body;
 check('ADMIN-007 指定覆盖含零价格保存有效',body&&!systemConfigError(body,defaultConfig())&&body.planOverrides.member.totalGb==='150'&&body.planOverrides.member.monthlyPrice==='0'&&body.planOverrides.member.validityDays==='45');
 input('plan-member-gb','');input('plan-member-price','');input('plan-member-days','');await configUI.click('保存配置');
 body=configUI.calls.filter(x=>x.url==='/api/admin/config').at(-1)?.body;
 check('ADMIN-007 清空覆盖后可恢复默认',body&&!systemConfigError(body,defaultConfig())&&Object.keys(body.planOverrides.member).length===0);
 check('ADMIN 配置 UI 无运行错误',configUI.errors.length===0);
}finally{configUI.dom.window.close()}
const resourceUI=await mount('/admin',{resourceCount:21});try{
 await resourceUI.click('资源管理');check('ADMIN-009 资源列表每页十条',resourceUI.document.querySelectorAll('.admin-table-row').length===10);
 await resourceUI.click('下一页');check('ADMIN-009 下一页范围正确',resourceUI.document.querySelector('.admin-pagination').textContent.includes('11-20 / 21'));
 const search=resourceUI.document.querySelector('input[placeholder="搜索资源名称、ID、提取码或归属用户"]');
 const searchFor=async(value)=>{Object.getOwnPropertyDescriptor(resourceUI.window.HTMLInputElement.prototype,'value').set.call(search,value);search.dispatchEvent(new resourceUI.window.Event('input',{bubbles:true}));await delay(60)};
 await searchFor('<img');check('NFR-011 后台搜索与资源名称按字面文本展示',resourceUI.document.querySelectorAll('.admin-table-row').length===1&&resourceUI.document.querySelector('.admin-table-row').textContent.includes('<img src=x onerror=alert(1)>')&&!resourceUI.document.querySelector('img[src=x],[onerror]'));
 await resourceUI.click('删除');check('ADMIN-009 删除需确认',!!resourceUI.document.querySelector('.confirm-modal'));await resourceUI.click('取消');check('ADMIN-009 取消删除没有请求',!resourceUI.calls.some(x=>x.method==='DELETE'));
 await resourceUI.click('删除');await resourceUI.click('删除资源');check('ADMIN-009 确认后单次删除且列表更新',resourceUI.calls.filter(x=>x.method==='DELETE').length===1&&resourceUI.document.body.textContent.includes('没有匹配的资源'));
 await searchFor('');check('ADMIN-009 清除搜索后资源总数准确',resourceUI.document.querySelector('.admin-pagination').textContent.includes('/ 20'));check('ADMIN 资源UI无运行错误',resourceUI.errors.length===0);
}finally{resourceUI.dom.window.close()}
const f=await mount('/admin');try{const before=f.calls.length;await f.click('执行清理');check('ADMIN-008 出现确认弹窗',!!f.document.querySelector('.confirm-modal'));await f.click('取消');check('ADMIN-008 取消不发清理请求',!f.calls.slice(before).some(x=>x.url==='/api/admin/cleanup'));await f.click('执行清理');f.document.querySelector('.confirm-modal .primary-button').click();await delay(60);check('ADMIN-008 确认只发一次POST',f.calls.filter(x=>x.url==='/api/admin/cleanup'&&x.method==='POST').length===1);await f.click('退出后台');check('ADMIN-011 退出清空界面',!!f.document.querySelector('.admin-login-modal'));check('ADMIN UI 无运行错误',f.errors.length===0)}finally{f.dom.window.close()}
const result={passed,failures};if(process.env.ACCEPTANCE_EVIDENCE_DIR){fs.mkdirSync(process.env.ACCEPTANCE_EVIDENCE_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.ACCEPTANCE_EVIDENCE_DIR,'finance-admin-ui-results.json'),JSON.stringify(result,null,2))}console.log(JSON.stringify(result,null,2));process.exitCode=failures.length?1:0
