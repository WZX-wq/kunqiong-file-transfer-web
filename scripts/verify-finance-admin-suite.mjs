// PAY / ADMIN: real routes and persisted metadata in an isolated, disposable server.
import assert from 'node:assert/strict'
import { readFixtureMetadata } from './lib/read-audit-fixture.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-finance-admin-'))
function copy(from,to){fs.mkdirSync(to,{recursive:true});for(const e of fs.readdirSync(from,{withFileTypes:true})){const a=path.join(from,e.name),b=path.join(to,e.name);if(e.isDirectory())copy(a,b);else fs.copyFileSync(a,b)}}
copy(path.join(root,'server'),path.join(fixture,'server'))
fs.copyFileSync(path.join(root,'package.json'),path.join(fixture,'package.json'))
fs.symlinkSync(path.join(root,'node_modules'),path.join(fixture,'node_modules'),process.platform==='win32'?'junction':'dir')
const control=`
const fixtureRealNow = Date.now;
let fixtureClock = null;
Date.now = () => fixtureClock ?? fixtureRealNow();
app.post('/__fixture', async (req,res)=>{
 const {metadata,persistMetadata}=await import('./server/lib/metadata-store.js');
 const state=await import('./server/state.js'); state.remotePricingCache.data=null; state.paymentReconcileAttempts.clear(); state.adminLoginAttempts.clear();
 if(req.body.user) Object.assign(metadata.users[req.body.user],req.body.patch);
 if(req.body.shares) metadata.shares.push(...req.body.shares);
 if(req.body.orders) metadata.upgradeOrders.push(...req.body.orders);
 if(req.body.orderPatch) Object.assign(metadata.upgradeOrders.find(o=>o.id===req.body.orderPatch.id),req.body.orderPatch.patch);
 if(Object.hasOwn(req.body,'clock')) fixtureClock=req.body.clock;
 if(req.body.config) metadata.systemConfig=req.body.config;
 persistMetadata(); res.json({ok:true});
});
`
fs.writeFileSync(path.join(fixture,'server.mjs'),fs.readFileSync(path.join(root,'server.mjs'),'utf8').replace('registerWorkspaceRoutes(app)',control+'\nregisterWorkspaceRoutes(app)'))
const now=new Date().toISOString(),future=new Date(Date.now()+20*86400000).toISOString()
const ids=['ttl','ttl-slow','pricing','wechat','alipay','renew','concurrent','status','restart','cancel','expire','invalid','free','member','team','enterprise','managed','stranger','date-sql','date-iso','date-offset','date-retry','history','repair-one','repair-two','repair-expired','repair-unpaid','repair-admin','repair-disabled','repair-enterprise','repair-retained','repair-live']
const users=Object.fromEntries(ids.map(id=>[id,{id,username:id,nickname:id,planId:['member','team','enterprise'].includes(id)?id:'free',status:'active',planExpiresAt:id==='enterprise'?null:future}]))
users.renew.planId='member'; users.expire.planId='team'
fs.mkdirSync(path.join(fixture,'storage'),{recursive:true})
const metadataFile=path.join(fixture,'storage/metadata.json')
fs.writeFileSync(metadataFile,JSON.stringify({users,sessions:Object.values(users).map(user=>({id:user.id+'-session',user,apiWebToken:'payment-fixture-'+user.id,expiresAt:future})),shares:[],collections:[],upgradeOrders:[],messages:{},systemConfig:{planOverrides:{member:{monthlyPrice:10,totalGb:100}}}}))
const packagesDefault=()=>[{id:1,name:'会员版',price_yuan:19,days:30},{id:2,name:'团队版',price_yuan:49,days:90},{id:3,name:'半年卡',price_yuan:79,days:180},{id:4,name:'年卡',price_yuan:129,days:365},{id:5,name:'企业版',price_yuan:159,days:0}]
let packages=packagesDefault(),remoteError=false,amountOverride,packageOverride,holdCreate=false,createRelease,seq=0
const orders=new Map()
// The member API documents expire_at as China local time (Y-m-d H:i:s).
const sqlDate = value => new Date(new Date(value).getTime() + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ')
const remote=http.createServer(async(req,res)=>{let body='';for await(const b of req)body+=b;const p=new URLSearchParams(body);res.setHeader('content-type','application/json');if(remoteError){res.end(JSON.stringify({code:0,msg:'provider secret_fixture_password token=payment-fixture-status'}));return}let data={};if(req.url.endsWith('get_web_member_package_info'))data={packages};else if(req.url.endsWith('create_web_member_order')){if(holdCreate)await new Promise(r=>createRelease=r);const pkg=packages.find(x=>x.id===Number(p.get('package_id')));const order_no='remote-'+(++seq);orders.set(order_no,{paid:false,token:req.headers.token,amountCents:Math.round(Number(amountOverride===undefined?pkg.price_yuan:amountOverride)*100)});data={order_no,package_id:packageOverride??pkg.id,pay_amount:amountOverride===undefined?pkg.price_yuan:amountOverride,pay_type:Number(p.get('pay_type')),package_days:pkg.days,...(Number(p.get('pay_type'))===2?{alipaysubmit_html:'<form action="https://pay.example.test"><input name="order" value="fixture"></form>'}:{code_url:'weixin://fixture'})}}else if(req.url.endsWith('check_web_member_order_paystatus')){const order=orders.get(p.get('order_no'));assert.ok(order&&order.token===req.headers.token);data={pay_status:order.paid?1:0,expire_at:order.paid?(order.expireAt??null):null}}res.end(JSON.stringify({code:1,data}))})
await new Promise(r=>remote.listen(0,'127.0.0.1',r))
let child,base,log='',cookie='',passed=0,current='',failures=[],cases=[],requests=[]
const env={...process.env};for(const k of Object.keys(env))if(/^(KUNQIONG_|OAUTH_)/.test(k))delete env[k]
env.TZ='UTC' // Parsing provider dates must not depend on the server's timezone.
async function start(extra={}){const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));base='http://127.0.0.1:'+port;child=spawn(process.execPath,['server.mjs'],{cwd:fixture,windowsHide:true,env:{...env,PORT:String(port),NODE_ENV:'test',KUNQIONG_TEST_ENFORCE_ENTERPRISE_ALLOWLIST:'false',KUNQIONG_DB_ENABLED:'false',KUNQIONG_HOST:'127.0.0.1',KUNQIONG_WEB_MEMBER_API_BASE:'http://127.0.0.1:'+remote.address().port,KUNQIONG_ADMIN_USERNAME:'fixture-admin',KUNQIONG_ADMIN_PASSWORD:'secret_fixture_password',KUNQIONG_RELEASE_SHA:'fixture-release',...extra},stdio:['ignore','pipe','pipe']});child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)return}catch{}await delay(50)}throw Error('Startup failed')}
async function stop(){if(!child||child.exitCode!==null)return;const end=once(child,'exit');child.kill();await Promise.race([end,delay(3000)])}
const stored=()=>readFixtureMetadata(metadataFile)
async function api(url,{user='',admin=false,method='GET',body,headers={}}={}){const response=await fetch(base+url,{method,redirect:'manual',headers:{...(admin?{cookie}:user?{cookie:'kunqiong_session='+user+'-session'}:{}),...(body?{'content-type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});const data=await response.json().catch(()=>({}));requests.push({case:current,method,url,status:response.status,user:admin?'admin':user||'anonymous',message:data.message});return{status:response.status,data,headers:response.headers}}
function check(label,condition){if(condition){passed++;console.log('PASS '+current+' '+label)}else{failures.push({id:current,message:label});console.log('FAIL '+current+' '+label)}}
async function group(id,fn){current=id;const n=failures.length;try{await fn()}catch(e){failures.push({id,message:e.message});console.log('ERROR '+id+' '+e.message)}cases.push({id,status:failures.length===n?'PASS':'FAIL'})}
async function ctl(body={}){const r=await api('/__fixture',{method:'POST',body});assert.equal(r.status,200)}
async function create(user,planId='member'){const r=await api('/api/account/upgrade-orders',{user,method:'POST',body:{planId}});assert.equal(r.status,201,JSON.stringify(r.data));return r.data.order}
const confirm=(user,o,payType=1)=>api('/api/account/upgrade-orders/'+o.id+'/confirm',{user,method:'POST',body:{payType}})
const status=(user,o)=>api('/api/account/upgrade-orders/'+o.id+'/pay-status',{user,method:'POST'})
const cancel=(user,o)=>api('/api/account/upgrade-orders/'+o.id+'/cancel',{user,method:'POST'})
async function login(){const r=await api('/api/admin/login',{method:'POST',body:{username:'fixture-admin',password:'secret_fixture_password'}});assert.equal(r.status,200);cookie=r.headers.get('set-cookie').split(';')[0];return r}
try{
 await start({KUNQIONG_WEB_MEMBER_PACKAGE_MEMBER_ID:'9'})
 await group('PAY-001',async()=>{
  packages=[...packagesDefault(),{id:9,name:'指定月卡',price_yuan:29,days:45}];
  const workspace=(await api('/api/account/workspace',{user:'pricing'})).data;
  check('历史十分钱覆盖不再污染套餐展示',workspace.plans.find(p=>p.id==='member').monthlyPrice===1900&&!Object.hasOwn(stored().systemConfig.planOverrides.member,'monthlyPrice'));
  const p=await api('/api/account/upgrade-pricing',{user:'pricing'});const o=await create('pricing');
  check('展示与显式套餐映射一致',p.data.pricing?.member?.packageId===9&&p.data.pricing.member.priceCents===o.amount&&p.data.pricing.member.validityDays===45);
  const checkout=await confirm('pricing',o);
  check('历史价格覆盖不影响主站实际收款',checkout.status===200&&checkout.data.order.amount===2900&&orders.get(checkout.data.order.remoteOrderNo)?.amountCents===2900);
  await cancel('pricing',o);remoteError=true;await ctl();
  const fail=await api('/api/account/upgrade-pricing',{user:'pricing'});
  check('服务失败明确提示且不泄露远端错误',fail.status>=400&&!!fail.data.message&&!JSON.stringify(fail.data).includes('secret_fixture_password'));
  remoteError=false;packages=packagesDefault();await stop();await start();await ctl();
 })
 await group('PAY-002',async()=>{const result=await Promise.all([api('/api/account/upgrade-orders',{user:'wechat',method:'POST',body:{planId:'member'}}),api('/api/account/upgrade-orders',{user:'wechat',method:'POST',body:{planId:'member'}})]);check('并发本地订单只创建一次',result.filter(r=>r.status===201).length===1&&result.filter(r=>r.status===409).length===1);const o=result.find(r=>r.status===201).data.order;const r=await confirm('wechat',o);check('微信金额/套餐/二维码',r.status===200&&r.data.order.amount===1900&&r.data.order.remotePackageId===1&&r.data.payment.qrcode_img_url.startsWith('data:image/png'));check('绑定用户隔离',(await confirm('stranger',o)).status===404);const ali=await confirm('alipay',await create('alipay'),2);check('支付宝入口',ali.status===200&&!!ali.data.payment.alipaysubmit_html);check('日志不包含支付凭证',!log.includes('payment-fixture-'))})
 await group('PAY-003',async()=>{const o=await create('renew');const r=await confirm('renew',o);orders.get(r.data.order.remoteOrderNo).paid=true;const done=await status('renew',o);check('同套餐允许续费',done.status===200&&done.data.order.status==='paid');check('追加原到期时间',new Date(stored().users.renew.planExpiresAt).getTime()===new Date(future).getTime()+30*86400000)})
 await group('PAY-004',async()=>{const o=await create('concurrent','team');const before=seq;const results=await Promise.all([confirm('concurrent',o),confirm('concurrent',o)]);check('并发确认一个远端订单',results.every(r=>r.status===200)&&seq===before+1);orders.get(results[0].data.order.remoteOrderNo).paid=true;await Promise.all([status('concurrent',o),status('concurrent',o)]);const expiry=stored().users.concurrent.planExpiresAt;await status('concurrent',o);check('权益只开通一次',stored().users.concurrent.planExpiresAt===expiry&&stored().messages.concurrent.filter(m=>m.eventType==='membershipActivated').length===1)})
 await group('PAY-005',async()=>{const o=await create('status','year');const r=await confirm('status',o);check('未支付不授予权益',(await status('status',o)).data.order.status==='pending_payment'&&stored().users.status.planId==='free');remoteError=true;const err=await status('status',o);check('异常不成功且错误脱敏',err.status>=400&&!JSON.stringify(err.data).includes('secret_fixture_password')&&stored().users.status.planId==='free');remoteError=false;orders.get(r.data.order.remoteOrderNo).paid=true;const done=await status('status',o);check('已支付年卡按期限开通',done.data.order.status==='paid'&&stored().users.status.planId==='year'&&Math.round((new Date(stored().users.status.planExpiresAt)-Date.now())/86400000)===365)})
 await group('PAY-006',async()=>{
  const o=await create('restart'),r=await confirm('restart',o)
  const expectedExpiry=new Date(Math.floor((Date.now()+60*86400000)/1000)*1000).toISOString()
  await stop()
  Object.assign(orders.get(r.data.order.remoteOrderNo),{paid:true,expireAt:sqlDate(expectedExpiry)})
  await start()
  for(let i=0;i<100&&stored().users.restart.planId!=='member';i++)await delay(50)
  const expiry=stored().users.restart.planExpiresAt
  check('主站日期格式支持重启支付回补',stored().users.restart.planId==='member'&&expiry===expectedExpiry)
  await api('/api/account/workspace',{user:'restart'});await stop();await start()
  check('再次重启无重复顺延',stored().users.restart.planExpiresAt===expiry)
 })
 await group('PAY-007',async()=>{const o=await create('cancel');check('第一次取消',(await cancel('cancel',o)).status===200);check('重复取消幂等',(await cancel('cancel',o)).status===200);check('取消后确认拒绝',(await confirm('cancel',o)).status===409);check('列表状态',(await api('/api/account/upgrade-orders',{user:'cancel'})).data.orders.find(x=>x.id===o.id).status==='canceled');const race=await create('cancel');holdCreate=true;const request=confirm('cancel',race);for(let i=0;i<100&&!createRelease;i++)await delay(10);const canceled=cancel('cancel',race);holdCreate=false;createRelease();await Promise.all([request,canceled]);check('取消与确认竞争最终取消',stored().upgradeOrders.find(x=>x.id===race.id).status==='canceled')})
 await group('PAY-008',async()=>{const before=(await api('/api/account/workspace',{user:'expire'})).data;check('到期前团队权益',before.plan.id==='team');await ctl({user:'expire',patch:{planExpiresAt:new Date(Date.now()-1000).toISOString()}});const after=(await api('/api/account/workspace',{user:'expire'})).data;check('到期降级',after.plan.id==='free'&&after.capacity.totalBytes===20*1024**3);check('到期后创建团队拒绝',(await api('/api/account/workspace',{user:'expire',method:'POST',body:{name:'expired'}})).status===403);const share={id:'grace-file',code:'GRACE1',manageToken:'grace-manage',ownerUserId:'expire',status:'active',createdAt:now,expiresAt:null,files:[]};await ctl({shares:[share]});check('七天宽限期仍有效',(await api('/api/shares/token/grace-file')).status===200);await ctl({user:'expire',patch:{planExpiresAt:new Date(Date.now()-8*86400000).toISOString()}});check('宽限期后失效',(await api('/api/shares/token/grace-file')).status===410)})
 await group('PAY-009',async()=>{for(const [id,gb,teamSpace,permanent,fileGB]of[['free',20,0,false,2],['member',100,0,false,5],['team',500,200,false,10],['enterprise',2048,1024,true,20]]){const w=(await api('/api/account/workspace',{user:id})).data;check(id+'权益配置',w.plan.id===id&&w.plan.totalBytes===gb*1024**3&&!!w.plan.team===(teamSpace>0)&&!!w.plan.permanent===permanent&&(!permanent||w.planExpiresAt===null));const oversize=await api('/api/upload-sessions',{user:id,method:'POST',body:{files:[{name:'limit.bin',size:fileGB*1024**3+1}]}});check(id+'单文件套餐上限',oversize.status===413)}})
 await group('PAY-010',async()=>{check('未知套餐拒绝',(await api('/api/account/upgrade-orders',{user:'invalid',method:'POST',body:{planId:'unknown'}})).status===400);for(const amount of [null,'',-1,'NaN',0.000000001,0.001,19.001]){packages[0].price_yuan=amount;await ctl();const r=await api('/api/account/upgrade-orders',{user:'invalid',method:'POST',body:{planId:'member'}});check('套餐无效金额拒绝 '+String(amount),r.status===502);if(r.status===201)await cancel('invalid',r.data.order)}packages=packagesDefault();for(const amount of [null,'',-1,'NaN',0,20]){const o=await create('invalid');amountOverride=amount;const r=await confirm('invalid',o);check('支付无效/不一致金额拒绝 '+String(amount),r.status===502&&!stored().upgradeOrders.find(x=>x.id===o.id).remoteOrderNo&&stored().users.invalid.planId==='free');await cancel('invalid',o)}amountOverride=undefined;const o=await create('invalid');packageOverride=999;const r=await confirm('invalid',o);check('支付套餐错配拒绝',r.status===502&&!stored().upgradeOrders.find(x=>x.id===o.id).remoteOrderNo);packageOverride=undefined;await cancel('invalid',o);remoteError=true;check('创建远端错误安全失败',(await api('/api/account/upgrade-orders',{user:'invalid',method:'POST',body:{planId:'member'}})).status===502);remoteError=false})
 await group('PAY-011',async()=>{
  const expectedExpiry = new Date(Math.floor((Date.now()+100*86400000)/1000)*1000).toISOString()
  for (const [user,expiry] of [['date-sql',sqlDate(expectedExpiry)],['date-iso',expectedExpiry],['date-offset',sqlDate(expectedExpiry).replace(' ','T')+'+08:00']]) {
   const o=await create(user,'team'), checkout=await confirm(user,o,2)
   assert.equal(checkout.status,200)
   check('未支付不能因有效期字段开通 '+user,(await status(user,o)).data.order.status==='pending_payment'&&stored().users[user].planId==='free')
   Object.assign(orders.get(checkout.data.order.remoteOrderNo),{paid:true,expireAt:expiry})
   const done=await status(user,o)
   check('支付宝团队订单确认成功 '+user,done.status===200&&done.data.order.status==='paid')
   check('到期时间统一为正确的UTC时间 '+user,done.data.order?.remoteExpireAt===expectedExpiry&&stored().users[user].planExpiresAt===expectedExpiry)
   check('刷新返回团队权益 '+user,done.data.workspace?.plan.id==='team'&&(await api('/api/account/workspace',{user})).data.plan.id==='team')
   await Promise.all([status(user,o),status(user,o)])
   check('重复刷新不会重复续期 '+user,stored().users[user].planExpiresAt===expectedExpiry&&stored().messages[user]?.filter(m=>m.eventType==='membershipActivated').length===1)
  }
  const o=await create('date-retry','team'),checkout=await confirm('date-retry',o,2),remoteOrder=orders.get(checkout.data.order.remoteOrderNo)
  remoteOrder.paid=true
  for (const expiry of ['invalid','9999-12-31 15:16:34','2027-02-30 15:16:34','2027-01-01 24:00:00','2027-01-01 15:60:00',true,{},[]]) {
   remoteOrder.expireAt=expiry
   const rejected=await status('date-retry',o)
   check('非法支付到期时间仍拒绝 '+JSON.stringify(expiry),rejected.status===502&&stored().users['date-retry'].planId==='free'&&stored().upgradeOrders.find(item=>item.id===o.id).status==='pending_payment')
  }
  remoteOrder.expireAt=sqlDate(expectedExpiry)
  const before=seq,recovered=await status('date-retry',o)
  check('原订单重新查询可恢复已付款权益',recovered.status===200&&recovered.data.order.status==='paid'&&recovered.data.workspace?.plan.id==='team'&&seq===before)
  await stop();await start()
  check('团队权益和到期时间重启后持久化',stored().users['date-retry'].planId==='team'&&stored().users['date-retry'].planExpiresAt===expectedExpiry&&(await api('/api/account/workspace',{user:'date-retry'})).data.planExpiresAt===expectedExpiry)
 })
 await group('PAY-012',async()=>{
  const fixtureOrders=Array.from({length:25},(_,i)=>({id:'history-'+i,orderNo:'HISTORY-'+String(i).padStart(2,'0'),userId:'history',planId:'team',amount:4900,status:i===0?'pending_payment':i===1?'paid':i===2?'expired':'canceled',createdAt:new Date(Date.now()-i*60000).toISOString(),updatedAt:now,remoteOrderNo:i===1?'PAYMENT-HISTORY-01':'',paidAt:i===1?now:null,remoteExpireAt:i===1?future:null,payment:{alipaysubmit_html:'<form>PRIVATE-CHECKOUT</form>'}}))
  await ctl({orders:fixtureOrders})
  const listing=await api('/api/account/upgrade-orders?page=1&limit=10&status=all',{user:'history'})
  check('订单中心服务端分页',listing.status===200&&listing.data.orders.length===10&&listing.data.pagination?.total===25&&listing.data.pagination?.totalPages===3)
  const compact=await api('/api/account/upgrade-orders?page=2&limit=5',{user:'history'})
  check('个人中心每页五条且翻页无重复遗漏',compact.status===200&&compact.data.orders.length===5&&compact.data.pagination?.totalPages===5&&compact.data.orders.map(o=>o.id).join(',')===fixtureOrders.slice(5,10).map(o=>o.id).join(','))
  check('订单按创建时间倒序',listing.data.orders.map(o=>o.id).join(',')===fixtureOrders.slice(0,10).map(o=>o.id).join(','))
  check('统计仅包含本人订单',listing.data.counts?.all===25&&listing.data.counts?.paid===1&&listing.data.counts?.canceled===22)
  check('列表不返回收银台和支付凭证',!JSON.stringify(listing.data).includes('PRIVATE-CHECKOUT')&&!JSON.stringify(listing.data).includes('payment-fixture-')&&listing.data.orders.every(o=>!Object.hasOwn(o,'payment')))
  check('第三页可查询历史订单',(await api('/api/account/upgrade-orders?page=3&limit=10',{user:'history'})).data.orders.length===5)
  const filtered=await api('/api/account/upgrade-orders?page=1&status=paid&q=payment-history-01',{user:'history'})
  check('状态和支付平台订单号组合搜索',filtered.status===200&&filtered.data.pagination?.total===1&&filtered.data.orders[0]?.id==='history-1')
  check('本站订单号搜索',(await api('/api/account/upgrade-orders?page=1&q=HISTORY-24',{user:'history'})).data.orders[0]?.id==='history-24')
  check('空结果有完整分页',(await api('/api/account/upgrade-orders?page=1&q=NOT-FOUND',{user:'history'})).data.pagination?.total===0)
  check('越界页自动收敛',(await api('/api/account/upgrade-orders?page=99',{user:'history'})).data.pagination?.page===3)
  const own=await api('/api/account/upgrade-orders/history-1',{user:'history'})
  check('本人订单详情可查询',own.status===200&&own.data.order.remoteOrderNo==='PAYMENT-HISTORY-01'&&own.data.order.remoteExpireAt===future)
  check('他人订单详情不可查询',(await api('/api/account/upgrade-orders/history-1',{user:'stranger'})).status===404)
  check('游客不能查看订单列表',(await api('/api/account/upgrade-orders?page=1')).status===401)
  check('游客不能查看订单详情',(await api('/api/account/upgrade-orders/history-1')).status===401)
  check('其他账号搜索不泄漏订单',(await api('/api/account/upgrade-orders?page=1&q=HISTORY',{user:'stranger'})).data.pagination?.total===0)
  check('不能核对他人订单',(await status('stranger',fixtureOrders[1])).status===404)
  check('不能取消他人订单',(await cancel('stranger',fixtureOrders[0])).status===404)
  for(const query of ['page=0','page=1.5','page=-1','limit=0','limit=51','status=unknown','status[]=paid','q[]=HISTORY','q='+ 'a'.repeat(81),'q=%00','q=%3Cscript%3E']){
   check('订单搜索边界拒绝 '+query,(await api('/api/account/upgrade-orders?'+query,{user:'history'})).status===400)
  }
  check('查询不改变订单与权益',stored().upgradeOrders.find(o=>o.id==='history-1').status==='paid'&&stored().users.history.planId==='free')
 })
 await group('PAY-TTL',async()=>{
  try {
   const o=await create('ttl'),deadline=new Date(o.createdAt).getTime()+15*60000
   check('订单返回创建后15分钟的支付截止时间',new Date(o.paymentExpiresAt).getTime()===deadline)
   await ctl({clock:deadline-1})
   const checkout=await confirm('ttl',o)
   check('截止前仍可加载支付码',checkout.status===200&&!!checkout.data.payment.qrcode_img_url)
   const before=seq
   await ctl({clock:deadline})
   const rejected=await confirm('ttl',o)
   check('15分钟边界拒绝继续支付',rejected.status===409&&rejected.data.order?.status==='expired'&&!rejected.data.payment&&seq===before)
   check('过期响应不再暴露支付码',!rejected.data.order?.payment)
   const history=await api('/api/account/upgrade-orders?page=1&status=expired',{user:'ttl'})
   check('订单中心过期状态与统计同步',history.data.counts.expired===1&&history.data.orders[0]?.id===o.id)
   check('过期仍保留支付对账凭证',!!stored().upgradeOrders.find(x=>x.id===o.id).paymentQueryCredential)
   await ctl({clock:null})
   const replacement=await create('ttl')
   check('过期不必等待30分钟即可重新下单',replacement.id!==o.id&&replacement.status==='pending_payment')
   orders.get(checkout.data.order.remoteOrderNo).paid=true
   const recovered=await status('ttl',o)
   check('临界时刻已付款的过期单仍能开通权益',recovered.data.order?.status==='paid'&&stored().users.ttl.planId==='member')
   await cancel('ttl',replacement)
   const slow=await create('ttl-slow')
   holdCreate=true;createRelease=null
   const request=confirm('ttl-slow',slow,2)
   for(let i=0;i<100&&!createRelease;i++)await delay(10)
   assert.ok(createRelease,'Slow provider request started')
   await ctl({clock:new Date(slow.createdAt).getTime()+15*60000})
   holdCreate=false;createRelease()
   const delayed=await request
   check('跨过截止时间的慢支付响应不返回收银台',delayed.status===409&&delayed.data.order?.status==='expired'&&!delayed.data.payment&&!delayed.data.order?.payment)
   const late=await create('ttl-slow')
   await ctl({orderPatch:{id:late.id,patch:{createdAt:new Date(Date.now()-16*60000).toISOString()}},clock:null})
   const list=await api('/api/account/upgrade-orders?page=1&status=expired',{user:'ttl-slow'})
   check('未打开支付窗口的旧订单也会过期',list.data.orders.some(x=>x.id===late.id)&&list.data.counts.pending_payment===0)
  } finally { holdCreate=false;await ctl({clock:null}) }
 })
 await group('ADMIN-001',async()=>{const r=await login();const c=r.headers.get('set-cookie');check('管理员登录身份',r.data.admin.username==='fixture-admin');check('Cookie安全属性',c.includes('HttpOnly')&&c.includes('SameSite=Lax')&&c.includes('Path=/'));const secure=await api('/api/admin/login',{method:'POST',headers:{'x-forwarded-proto':'https'},body:{username:'fixture-admin',password:'secret_fixture_password'}});check('HTTPS Cookie Secure',secure.headers.get('set-cookie').includes('Secure'))})
 await group('ADMIN-002',async()=>{await stop();await start({KUNQIONG_ADMIN_USERNAME:'',KUNQIONG_ADMIN_PASSWORD:''});const r=await api('/api/admin/login',{method:'POST',body:{username:'admin',password:'admin'}});check('未配置503明确提示',r.status===503&&r.data.message.includes('未配置'));await stop();await start();await login()})
 await group('ADMIN-003',async()=>{for(let i=0;i<8;i++)check('错误登录 '+i,(await api('/api/admin/login',{method:'POST',headers:{'x-forwarded-for':'10.0.0.'+i},body:{username:'fixture-admin',password:'wrong-fixture'}})).status===401);check('伪造IP无法绕过限流',(await api('/api/admin/login',{method:'POST',body:{username:'fixture-admin',password:'secret_fixture_password'}})).status===429);check('密码不写日志',!log.includes('secret_fixture_password')&&!JSON.stringify(stored().auditLogs).includes('wrong-fixture'));await ctl();await login()})
 await group('ADMIN-004',async()=>{check('有效会话',(await api('/api/admin/session',{admin:true})).data.authenticated);check('overview刷新',(await api('/api/admin/overview',{admin:true})).status===200);await api('/api/admin/logout',{admin:true,method:'POST'});check('注销会话',(await api('/api/admin/session',{admin:true})).data.authenticated===false);for(const[url,method]of[['/api/admin/overview','GET'],['/api/admin/cleanup','POST'],['/api/admin/config','PATCH']])check('旧Cookie拒绝 '+url,(await api(url,{admin:true,method,body:method==='PATCH'?{}:undefined})).status===401);await login()})
 await group('ADMIN-005',async()=>{const r=await api('/api/admin/overview',{admin:true});check('统计真实',r.data.stats.users===Object.keys(stored().users).length&&r.data.stats.shares===stored().shares.length);check('趋势与限量',r.data.trend.length===7&&r.data.users.length<=200&&r.data.auditLogs.length<=100&&r.data.totals.users===r.data.stats.users);check('支付凭证和管理令牌不暴露',!JSON.stringify(r.data).includes('payment-fixture-')&&!JSON.stringify(r.data).includes('grace-manage'))})
 await group('ADMIN-006',async()=>{const patch=body=>api('/api/admin/users/managed',{admin:true,method:'PATCH',body});check('未知用户404',(await api('/api/admin/users/missing',{admin:true,method:'PATCH',body:{planId:'member'}})).status===404);check('未知plan拒绝',(await patch({planId:'invalid'})).status===400);check('非法有效期拒绝',(await patch({planExpiresAt:'invalid'})).status===400);check('合法权益修改',(await patch({planId:'team',planExpiresAt:future})).status===200);check('账号权益即时',(await api('/api/account/workspace',{user:'managed'})).data.plan.id==='team');await stop();await start();await login();check('持久化权益',stored().users.managed.planId==='team'&&stored().users.managed.planExpiresAt===future);check('禁用账号',(await patch({status:'disabled'})).status===200&&(await api('/api/account/workspace',{user:'managed'})).status===401);check('审计记录',stored().auditLogs.some(x=>x.targetId==='managed'&&x.action==='更新用户状态或权益'))})
 await group('ADMIN-007',async()=>{
  const patch=body=>api('/api/admin/config',{admin:true,method:'PATCH',body});
  for(const b of[{anonymousTotalSizeMb:-1},{unknown:true},{planOverrides:{bogus:{totalGb:3}}},{planOverrides:{member:{totalGb:-1}}},{maintenanceMode:'false'}])check('非法配置拒绝 '+JSON.stringify(b),(await patch(b)).status===400);
  for(const id of ['free','member','team','halfyear','year']){
   const rejected=await patch({planOverrides:{[id]:{monthlyPrice:10,totalGb:123}}});
   check('禁止本站改价并说明主站入口 '+id,rejected.status===400&&rejected.data.message.includes('会员主站统一管理'));
  }
  const r=await patch({anonymousMaxFileSizeMb:2,anonymousTotalSizeMb:4,planOverrides:{member:{totalGb:123,validityDays:45}}});
  check('合法配置保存',r.status===200&&!Object.hasOwn(r.data.config.planOverrides.member,'monthlyPrice'));
  check('套餐覆盖立即生效',(await api('/api/account/workspace',{user:'member'})).data.plan.totalBytes===123*1024**3);
  const p=await api('/api/account/upgrade-pricing',{user:'pricing'}),o=await create('pricing');
  check('本地权益保存不改变实际支付价格',p.data.pricing.member.priceCents===1900&&o.amount===1900);
  await cancel('pricing',o);
  const over=await api('/api/upload-sessions',{method:'POST',body:{files:[{name:'anon.bin',size:3*1024**2}]}});check('游客额度即时生效',over.status===413);
  await stop();await start();await login();
  check('套餐覆盖重启持久化',(await api('/api/account/workspace',{user:'member'})).data.plan.totalBytes===123*1024**3);
  const afterRestart=(await api('/api/admin/overview',{admin:true})).data.config;
  check('重启后不恢复历史价格设置',Object.values(afterRestart.planOverrides).every(plan=>!Object.hasOwn(plan,'monthlyPrice')));
  await ctl({config:{}});
 })
 await group('ADMIN-008',async()=>{const mk=(id,expired)=>({id,code:id,manageToken:id+'-manage',ownerUserId:'free',status:expired?'closed':'active',createdAt:now,expiresAt:expired?new Date(Date.now()-86400000).toISOString():future,files:[{name:'safe.txt',storedName:'safe.txt',size:4,reviewStatus:'clean'}]});await ctl({shares:[mk('cleanup-old',true),mk('cleanup-live',false)]});for(const id of['cleanup-old','cleanup-live','orphan-old','orphan-new']){const dir=path.join(fixture,'storage/files',id);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'safe.txt'),'safe');if(id==='orphan-old')fs.utimesSync(dir,new Date(0),new Date(0))}check('GET无清理副作用',(await api('/api/admin/cleanup',{admin:true})).status===404&&fs.existsSync(path.join(fixture,'storage/files/cleanup-old')));const r=await api('/api/admin/cleanup',{admin:true,method:'POST'});check('只清理陈旧资源',r.status===200&&!stored().shares.some(x=>x.id==='cleanup-old')&&stored().shares.some(x=>x.id==='cleanup-live'));await delay(150);check('孤儿宽限期',!fs.existsSync(path.join(fixture,'storage/files/orphan-old'))&&fs.existsSync(path.join(fixture,'storage/files/orphan-new')));check('存活文件保留和审计',fs.existsSync(path.join(fixture,'storage/files/cleanup-live/safe.txt'))&&stored().auditLogs.some(x=>x.action==='手动执行存储清理'))})
 await group('ADMIN-009',async()=>{check('普通用户不能删除',(await api('/api/admin/resources/share/cleanup-live',{user:'free',method:'DELETE'})).status===401);const r=await api('/api/admin/resources/share/cleanup-live',{admin:true,method:'DELETE'});await delay(150);check('删除元数据和文件',r.status===200&&!stored().shares.some(x=>x.id==='cleanup-live')&&!fs.existsSync(path.join(fixture,'storage/files/cleanup-live')));check('旧链接失效',(await api('/api/shares/token/cleanup-live')).status===404)})
 await group('ADMIN-010',async()=>{check('无管理员拒绝',(await api('/api/admin/impersonate',{user:'free',method:'POST',body:{userId:'member'}})).status===401);const r=await api('/api/admin/impersonate',{admin:true,method:'POST',body:{userId:'member'}});check('test已有用户验收会话',r.status===200&&!!r.data.sessionId);check('不存在不能签发',(await api('/api/admin/impersonate',{admin:true,method:'POST',body:{userId:'missing'}})).status===404);check('签发审计',stored().auditLogs.some(x=>x.action==='签发验收会话'));await stop();await start({NODE_ENV:'production'});await login();check('生产404',(await api('/api/admin/impersonate',{admin:true,method:'POST',body:{userId:'member'}})).status===404)})
 await group('ADMIN-011',async()=>{await api('/api/admin/logout',{admin:true,method:'POST'});check('旧会话不能恢复',(await api('/api/admin/overview',{admin:true})).status===401&&(await api('/api/admin/session',{admin:true})).data.authenticated===false)})
 await group('ADMIN-012',async()=>{for(const user of['','free'])for(const[url,method,body]of[['/api/admin/overview','GET'],['/api/admin/cleanup','POST'],['/api/admin/config','PATCH',{}],['/api/admin/users/member','PATCH',{planId:'team'}],['/api/admin/resources/share/x','DELETE']])check('权限拒绝 '+(user||'游客')+' '+url,(await api(url,{user,method,body})).status===401);check('错误Cookie拒绝',(await api('/api/admin/overview',{headers:{cookie:'kunqiong_admin_session=forged'}})).status===401)})
 await group('PAY-013',async()=>{
  const expiry = new Date(Date.now()+90*86400000).toISOString()
  const past = new Date(Date.now()-86400000).toISOString()
  const paidAt = new Date(Date.now()-60000).toISOString()
  const repairedIds = ['repair-one','repair-two','repair-expired','repair-unpaid','repair-admin','repair-disabled','repair-enterprise']
  for (const id of repairedIds) await ctl({user:id,patch:{planId:'free',planStartedAt:paidAt,planExpiresAt:id==='repair-expired'?past:id==='repair-enterprise'?null:expiry,status:id==='repair-disabled'?'disabled':'active'}})
  await ctl({user:'repair-retained',patch:{planId:'team',planExpiresAt:expiry}})
  await ctl({orders:repairedIds.map(id=>({id:'paid-'+id,orderNo:'PAID-'+id,userId:id,planId:id==='repair-enterprise'?'enterprise':'team',status:id==='repair-unpaid'?'pending_payment':'paid',amount:4900,remoteOrderNo:id==='repair-unpaid'?'':'provider-'+id,createdAt:paidAt,updatedAt:paidAt,paidAt:id==='repair-unpaid'?null:paidAt,remoteExpireAt:id==='repair-expired'?past:id==='repair-enterprise'?null:expiry}))})
  await login()
  check('管理员可显式撤销历史会员', (await api('/api/admin/users/repair-admin',{admin:true,method:'PATCH',body:{planId:'free'}})).status===200)
  await stop()
  const snapshot = stored()
  for (const session of snapshot.sessions) if ([...repairedIds,'repair-retained'].includes(session.user.id)) session.user={...snapshot.users[session.user.id]}
  for (const id of ['repair-one','repair-two']) {
   snapshot.organizations[id]={id,slug:id,name:id,ownerUserId:id,members:[{id:'owner-'+id,userId:id,role:'owner',status:'active'}],createdAt:paidAt}
  }
  fs.writeFileSync(metadataFile,JSON.stringify(snapshot))
  await start({KUNQIONG_TEST_ENFORCE_ENTERPRISE_ALLOWLIST:'true',KUNQIONG_TEST_ENTERPRISE_USER_KEYS:'pricing'})
  for (const id of ['repair-one','repair-two']) {
   const me=(await api('/api/auth/me',{user:id})).data.user
   const team=(await api('/api/account/team/overview',{user:id})).data
   const workspace=(await api('/api/account/workspace',{user:id})).data
   check('独立已支付账号恢复团队权益 '+id,me?.planId==='team'&&workspace.plan?.id==='team'&&workspace.planExpiresAt===expiry)
   check('团队容量恢复为200GB且不混用500GB个人空间 '+id,team.capacity?.totalBytes===200*1024**3&&workspace.capacity?.totalBytes===500*1024**3)
  }
  check('正常非白名单付费套餐不被降级', (await api('/api/account/workspace',{user:'repair-retained'})).data.plan?.id==='team')
  check('白名单测试账号仍可获得演示企业权益', (await api('/api/account/workspace',{user:'pricing'})).data.plan?.id==='enterprise')
  check('历史已支付企业永久权益可恢复', (await api('/api/account/workspace',{user:'repair-enterprise'})).data.plan?.id==='enterprise'&&stored().users['repair-enterprise'].planExpiresAt===null)
  for (const id of ['repair-expired','repair-unpaid','repair-admin']) check('过期未支付或管理员撤销不恢复 '+id,(await api('/api/account/workspace',{user:id})).data.plan?.id==='free')
  check('禁用账号不恢复套餐或访问权限',stored().users['repair-disabled'].planId==='free'&&(await api('/api/account/workspace',{user:'repair-disabled'})).status===401)
  const live=await create('repair-live','team'),checkout=await confirm('repair-live',live)
  Object.assign(orders.get(checkout.data.order.remoteOrderNo),{paid:true,expireAt:expiry})
  check('白名单模式新购买立即生效',(await status('repair-live',live)).data.workspace?.plan.id==='team')
  const before=stored(), liveExpiry=before.users['repair-live'].planExpiresAt
  await stop();await start({KUNQIONG_TEST_ENFORCE_ENTERPRISE_ALLOWLIST:'true',KUNQIONG_TEST_ENTERPRISE_USER_KEYS:'pricing'})
  check('恢复和新购买重启后不丢失或重复续期',stored().users['repair-one'].planId==='team'&&stored().users['repair-one'].planExpiresAt===expiry&&stored().users['repair-live'].planId==='team'&&stored().users['repair-live'].planExpiresAt===liveExpiry)
  check('恢复不重复创建订单或开通通知',stored().upgradeOrders.length===before.upgradeOrders.length&&JSON.stringify(stored().messages)===JSON.stringify(before.messages))
  await login();await api('/api/admin/users/repair-one',{admin:true,method:'PATCH',body:{planId:'free'}})
  await stop();await start({KUNQIONG_TEST_ENFORCE_ENTERPRISE_ALLOWLIST:'true'})
  check('修复后仍尊重管理员主动撤销',stored().users['repair-one'].planId==='free')
 })
}finally{await stop();await new Promise(r=>remote.close(r))}
const result={executedAt:new Date().toISOString(),passed,failures,cases,fixture,requests,logChecks:{passwordAbsent:!log.includes('secret_fixture_password'),paymentTokenAbsent:!log.includes('payment-fixture-')}}
if(process.env.ACCEPTANCE_EVIDENCE_DIR){fs.mkdirSync(process.env.ACCEPTANCE_EVIDENCE_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.ACCEPTANCE_EVIDENCE_DIR,'finance-admin-results.json'),JSON.stringify(result,null,2))}
console.log(JSON.stringify({...result,requests:undefined},null,2));process.exitCode=failures.length?1:0
