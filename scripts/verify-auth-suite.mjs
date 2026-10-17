// AUTH-001–013：真实路由/持久化；OAuth、SMTP 和时间边界在一次性副本中控制。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import net from 'node:net'
import crypto from 'node:crypto'
import sharp from 'sharp'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-auth-'))
function copy(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.isDirectory()) copy(path.join(from, e.name), path.join(to, e.name))
    else if (e.isFile()) fs.copyFileSync(path.join(from, e.name), path.join(to, e.name))
  }
}
copy(path.join(root, 'server'), path.join(fixture, 'server'))
// 只替换短信网关 HTTP 传输；真实发送、错误分类和验证码清理由生产服务执行。
const accountFile=path.join(fixture,'server/services/account.js')
fs.appendFileSync(accountFile,`\nconst fetch = (...args) => args[0] === 'https://sms.tencentcloudapi.com' && process.env.AUTH_FIXTURE_SMS_ERROR
 ? Promise.resolve(new Response(JSON.stringify({Response:{Error:{Code:process.env.AUTH_FIXTURE_SMS_ERROR==='invalid'?'InvalidParameterValue.IncorrectPhoneNumber':'FailedOperation',Message:process.env.AUTH_FIXTURE_SMS_ERROR==='invalid'?'incorrect number format':'provider unavailable'}}}),{status:200}))
 : globalThis.fetch(...args);\n`)
copy(path.join(root, 'email-templates'), path.join(fixture, 'email-templates'))
fs.copyFileSync(path.join(root, 'package.json'), path.join(fixture, 'package.json'))
fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), 'junction')
// 此控制路由仅写入临时副本，生产源文件中没有测试入口。
const control = `
app.post('/__auth_fixture', async (req, res) => {
 const { oauthStates, verificationTargetLastSent, verificationIpAttempts } = await import('./server/state.js');
 const { metadata, persistMetadata } = await import('./server/lib/metadata-store.js');
 if (req.body.state) oauthStates.get(req.body.state).createdAt = Date.now() - 600001;
 if (req.body.session) metadata.sessions.find(s => s.id === req.body.session).expiresAt = new Date(Date.now()-1).toISOString();
 if (req.body.expireCode) metadata.verificationCodes.filter(c=>c.target===req.body.expireCode).forEach(c=>c.expiresAt=new Date(Date.now()-1).toISOString());
 if (req.body.resetLimits) { verificationTargetLastSent.clear(); verificationIpAttempts.clear(); }
 if (req.body.seedCode) {
   const { createToken } = await import('./server/lib/http.js');
   const { keyedDigest } = await import('./server/lib/private-key.js');
   metadata.verificationCodes = metadata.verificationCodes.filter(c=>c.target!==req.body.seedCode);
   const type=req.body.seedCode.includes('@')?'email':'phone';
   metadata.verificationCodes.push({id:createToken(10),type,target:req.body.seedCode,scene:'bind',codeHash:'hmac:'+keyedDigest(type+':'+req.body.seedCode+':bind:123456'),createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+600000).toISOString()});
 }
 persistMetadata(); res.json({ok:true});
});
`
fs.writeFileSync(path.join(fixture, 'server.mjs'), fs.readFileSync(path.join(root, 'server.mjs'), 'utf8').replace('registerAccountRoutes(app)', control + '\nregisterAccountRoutes(app)'))
const future = new Date(Date.now() + 86400000 * 30).toISOString()
const users = Object.fromEntries(['alice','bob','logout','expire','disabled'].map(id => [id, { id, username:id, nickname:id, planId:'free', status:id==='disabled'?'disabled':'active', providerAvatar:'https://example.invalid/avatar.png' }]))
users.bob.email = 'occupied@example.test'
users.bob.phone = '13800009999'
const share = (id, owner, expiry) => ({ id, code:id.toUpperCase(), ownerUserId:owner, status:'active', createdAt:new Date().toISOString(), expiresAt:expiry, files:[{ name:'safe.txt', storedName:'safe.txt', size:4, scanStatus:'clean' }] })
const old = new Date(Date.now() - 86400000 * 8).toISOString()
const recent = new Date(Date.now() - 3600000).toISOString()
const shares = [share('past','alice',old),share('grace','alice',recent),share('live','alice',future),share('other','bob',old),share('sent','alice',future),share('received','bob',future)]
const collections = [{ id:'task',token:'tasktoken',manageToken:'taskmanage',ownerUserId:'alice',title:'AUTH collection',deadline:old,createdAt:new Date().toISOString(),allowedTypes:['全部格式'],submissions:[{id:'submission',participantName:'test',files:[{name:'safe.txt',storedName:'safe.txt',size:4,scanStatus:'clean'}]}] }]
fs.mkdirSync(path.join(fixture,'storage'), {recursive:true})
const metadataFile = path.join(fixture,'storage','metadata.json')
fs.writeFileSync(metadataFile,JSON.stringify({users,sessions:Object.values(users).map(user=>({id:user.id+'-session',user,apiWebToken:'PRIVATE_FIXTURE_TOKEN',expiresAt:future})),shares,collections,messages:{alice:[{id:'alice-message',title:'test',body:'fixture',category:'system',unread:true,createdAt:new Date().toISOString()}],bob:[{id:'bob-message',title:'other',category:'system',unread:true,createdAt:new Date().toISOString()}]},records:{},upgradeOrders:[]}))
for (const s of shares) { const dir=path.join(fixture,'storage','files',s.id);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'safe.txt'),'safe') }
const cdir=path.join(fixture,'storage','collections','task','submission');fs.mkdirSync(cdir,{recursive:true});fs.writeFileSync(path.join(cdir,'safe.txt'),'safe')
let exchanges=[]
const oauth=http.createServer(async(req,res)=>{
  let raw='';for await(const part of req)raw+=part
  const data=JSON.parse(raw||'{}');exchanges.push(data)
  res.setHeader('content-type','application/json')
  if(data.code==='fail') res.end(JSON.stringify({code:400,message:'secret=FIXTURE_CLIENT_SECRET token=PRIVATE_FIXTURE_TOKEN'}))
  else {
    const user=data.code==='contact-conflict'?{...users.alice,id:'duplicate-oauth',email:'occupied@example.test',phone:'13800009999'}:data.code==='stale-contact'?{...users.alice,email:'stale@example.test',phone:'13500003333'}:data.code==='disabled'?{...users.disabled,status:'active'}:users.alice
    res.end(JSON.stringify({code:200,data:{access_token:'PRIVATE_FIXTURE_TOKEN',expires_in:3600,user}}))
  }
})
await new Promise(r=>oauth.listen(0,'127.0.0.1',r))
// 最小 SMTP 协议接收器，仅接受本机测试邮箱；验证码从邮件取得，不从接口取得。
let delivered=[]
const smtp=net.createServer(socket=>{
  socket.write('220 fixture ESMTP\r\n');let buffer='',mail='',inData=false
  socket.on('data',part=>{
    buffer+=part.toString()
    while(buffer.includes('\r\n')) {
      const pos=buffer.indexOf('\r\n'),line=buffer.slice(0,pos);buffer=buffer.slice(pos+2)
      if(inData) { if(line==='.') {delivered.push(mail);mail='';inData=false;socket.write('250 OK\r\n')} else mail+=line+'\n';continue }
      if(/^EHLO/.test(line)) socket.write('250-fixture\r\n250 AUTH PLAIN LOGIN\r\n')
      else if(/^AUTH/.test(line)) socket.write('235 OK\r\n')
      else if(line==='DATA') {inData=true;socket.write('354 Send\r\n')}
      else if(line==='QUIT') socket.end('221 Bye\r\n')
      else socket.write('250 OK\r\n')
    }
  });socket.on('error',()=>{})
})
await new Promise(r=>smtp.listen(0,'127.0.0.1',r))
let child,base,stderr='',passed=0,failures=[],cases=[],requests=[]
const cleanEnv={...process.env};for(const key of Object.keys(cleanEnv))if(/^(KUNQIONG_|OAUTH_)/.test(key))delete cleanEnv[key]
async function start(mail=false,smsError='') {
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));base=`http://127.0.0.1:${port}`
 child=spawn(process.execPath,['server.mjs'],{cwd:fixture,windowsHide:true,env:{...cleanEnv,PORT:String(port),NODE_ENV:smsError?'test':'production',KUNQIONG_HOST:'127.0.0.1',KUNQIONG_AUTH_CALLBACK_URL:base+'/auth/callback',KUNQIONG_OAUTH_AUTHORIZE_URL:`http://127.0.0.1:${oauth.address().port}/authorize`,KUNQIONG_OAUTH_TOKEN_URL:`http://127.0.0.1:${oauth.address().port}/token`,KUNQIONG_OAUTH_CLIENT_ID:'fixture-client',KUNQIONG_OAUTH_CLIENT_SECRET:'FIXTURE_CLIENT_SECRET',...(smsError?{AUTH_FIXTURE_SMS_ERROR:smsError,KUNQIONG_TEST_ENFORCE_ENTERPRISE_ALLOWLIST:'false',KUNQIONG_TENCENT_SECRET_ID:'fixture',KUNQIONG_TENCENT_SECRET_KEY:'fixture',KUNQIONG_TENCENT_SMS_SDK_APP_ID:'fixture',KUNQIONG_TENCENT_SMS_SIGN_NAME:'fixture',KUNQIONG_TENCENT_SMS_TEMPLATE_BIND_CODE_ID:'fixture'}:{}),...(mail?{KUNQIONG_SMTP_HOST:'127.0.0.1',KUNQIONG_SMTP_PORT:String(smtp.address().port),KUNQIONG_SMTP_SECURE:'false',KUNQIONG_SMTP_USER:'fixture',KUNQIONG_SMTP_PASSWORD:'fixture',KUNQIONG_SMTP_FROM:'fixture@example.test'}:{})},stdio:['ignore','ignore','pipe']})
 child.stderr.on('data',d=>stderr+=d)
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)return}catch{}await delay(50)}throw new Error('Fixture did not start '+stderr)
}
async function stop(){if(!child||child.exitCode!==null)return;const ended=once(child,'exit');child.kill();await Promise.race([ended,delay(3000)])}
async function api(url,{user='alice',cookie,method='GET',body,headers={}}={}) {
 const response=await fetch(base+url,{method,redirect:'manual',headers:{...(cookie!==undefined?{cookie}:user?{cookie:`kunqiong_session=${user}-session`}:{}),...(body?{'content-type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined})
 const data=await response.json().catch(()=>({}))
 requests.push({method,url,user:user||'anonymous',status:response.status,request:safeEvidence(body),response:safeEvidence(data)})
 return {status:response.status,data,response}
}
function safeEvidence(value){return value===undefined?null:JSON.parse(JSON.stringify(value,(key,item)=>/^(code|state|avatar|codeHash|apiWebToken|client_secret)$/.test(key)&&item?'[redacted]':item))}
const stored=()=>JSON.parse(fs.readFileSync(metadataFile,'utf8'))
const cookieOf=res=>res.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')
async function login(returnTo=base+'/settings/security',headers={}) {
 const response=await fetch(base+'/api/auth/login?return_to='+encodeURIComponent(returnTo),{redirect:'manual',headers})
 const location=new URL(response.headers.get('location'));return {response,location,state:location.searchParams.get('state'),cookie:cookieOf(response)}
}
async function callback(l,code='ok',cookie=l.cookie){return fetch(base+`/auth/callback?code=${code}&state=${l.state}`,{redirect:'manual',headers:{cookie}})}
function check(label,value){assert.ok(value,label);passed++;console.log('PASS '+label)}
async function group(id,fn){try{await fn();cases.push({id,status:'PASS'});console.log('CASE '+id+' PASS')}catch(e){failures.push({id,message:e.message});cases.push({id,status:'FAIL',message:e.message});console.log('CASE '+id+' FAIL: '+e.message)}}
try {
 await start()
 await group('AUTH-001',async()=>{
  const l=await login();check('authorization parameters',l.location.pathname==='/authorize'&&l.location.searchParams.get('client_id')==='fixture-client'&&/^[a-f0-9]{32,}$/.test(l.state))
  const r=await callback(l);const target=new URL(r.headers.get('location'));check('callback restores original settings route',target.pathname==='/settings/security'&&target.searchParams.get('login')==='success')
  check('exchange uses same redirect URI',exchanges.at(-1).redirect_uri===l.location.searchParams.get('redirect_uri'))
  const wrong=await login('https://evil.invalid/path');const result=await callback(wrong);check('external return URL refused',new URL(result.headers.get('location')).origin===base)
  const proxied=await login('http://127.0.0.1:4173/settings/profile',{'x-forwarded-host':'127.0.0.1:4173','x-forwarded-proto':'http'});const proxyCallback=await callback(proxied);check('proxied login preserves route',new URL(proxyCallback.headers.get('location')).pathname==='/settings/profile')
 })
 await group('AUTH-002',async()=>{
  const count=stored().sessions.length,exchangeCount=exchanges.length
  const forged=await callback({state:'forged',cookie:''});check('forged state refused without exchange/session',new URL(forged.headers.get('location')).searchParams.get('login')==='failed'&&stored().sessions.length===count&&exchanges.length===exchangeCount)
  const expired=await login();await api('/__auth_fixture',{method:'POST',body:{state:expired.state}});check('expired state refused',new URL((await callback(expired)).headers.get('location')).searchParams.get('login')==='failed')
  const valid=await login();await callback(valid);const replay=await callback(valid);check('replayed state refused',new URL(replay.headers.get('location')).searchParams.get('login')==='failed')
  const bound=await login(),before=stored().sessions.length;const unbound=await callback(bound,'ok','');check('state tied to initiating browser',new URL(unbound.headers.get('location')).searchParams.get('login')==='failed'&&stored().sessions.length===before)
  const second=await login();check('another browser nonce refused',new URL((await callback(bound,'ok',second.cookie)).headers.get('location')).searchParams.get('login')==='failed')
  check('rejected callback does not burn legitimate state',new URL((await callback(bound)).headers.get('location')).searchParams.get('login')==='success')
  check('parallel login state can also complete',new URL((await callback(second)).headers.get('location')).searchParams.get('login')==='success')
  check('state cookie is HttpOnly with SameSite Lax',second.response.headers.get('set-cookie').includes('HttpOnly')&&second.response.headers.get('set-cookie').includes('SameSite=Lax'))
  const errorCount=stored().sessions.length,error=await callback(await login(),'fail');check('upstream errors do not disclose secrets',!decodeURIComponent(error.headers.get('location')).includes('FIXTURE_CLIENT_SECRET')&&!decodeURIComponent(error.headers.get('location')).includes('PRIVATE_FIXTURE_TOKEN'))
  check('failed exchange does not create session',stored().sessions.length===errorCount)
 })
 await group('AUTH-003',async()=>{
  check('anonymous me has null user',(await api('/api/auth/me',{user:''})).data.user===null)
  const me=await api('/api/auth/me');check('me returns user, plan and avatar',me.data.user.id==='alice'&&me.data.user.plan&&'avatar'in me.data.user)
  check('me hides credentials',!JSON.stringify(me.data).includes('PRIVATE_FIXTURE_TOKEN')&&!('apiWebToken'in me.data.user))
  check('malformed cookie treated as anonymous',(await api('/api/auth/me',{cookie:'kunqiong_session=%ZZ'})).data.user===null)
 })
 await group('AUTH-OAuth-contact-exclusive',async()=>{
  const before=stored().sessions.length
  const response=await callback(await login(),'contact-conflict')
  check('OAuth import cannot duplicate another account contact',new URL(response.headers.get('location')).searchParams.get('login')==='failed'&&stored().sessions.length===before&&!stored().users['duplicate-oauth'])
 })
  await group('AUTH-OAuth-disabled-account',async()=>{
   const before=stored().sessions.length
   const response=await callback(await login(),'disabled')
   const location=new URL(response.headers.get('location'))
   check('disabled OAuth account is rejected before session creation',location.searchParams.get('login')==='failed'&&stored().sessions.length===before)
   check('disabled OAuth account receives actionable message',location.searchParams.get('message')==='该账号已被后台禁用，暂时无法登录，请联系管理员。')
  })
 await group('AUTH-004-disabled',async()=>{
  for(const target of ['mail@example.test','13500001111']){const r=await api('/api/auth/code',{method:'POST',body:{target}});check('disabled channel gives clear 503 without code: '+JSON.stringify({status:r.status,...r.data}),r.status===503&&!('debugCode'in r.data)&&/未配置/.test(r.data.message))}
 })
 await group('AUTH-contact-format',async()=>{
  for(const target of ['123456','12507786589','135077865891111','135abc07786589','1160012403@qq.com111111','a..b@example.test','a@-example.test','a@exa_mple.test','a'.repeat(65)+'@example.test']) {
   const before=stored().verificationCodes.length
   check('malformed contact rejected before code generation: '+target,(await api('/api/auth/code',{method:'POST',body:{target}})).status===400&&stored().verificationCodes.length===before)
  }
  check('phone field cannot bind email',(await api('/api/auth/code',{method:'POST',body:{target:'valid@example.test',type:'phone'}})).status===400)
  check('email field cannot bind phone',(await api('/api/account/bind',{method:'POST',body:{target:'13500001111',type:'email',code:'123456'}})).status===400)
  const boundary='a'.repeat(64)+'@'+'b'.repeat(63)+'.'+'c'.repeat(26)+'.test'
  check('valid 160-character email reaches sending',(await api('/api/auth/code',{method:'POST',body:{target:boundary}})).status===503)
  check('161-character email rejected',(await api('/api/auth/code',{method:'POST',body:{target:boundary+'a'}})).status===400)
 })
 await group('AUTH-contact-exclusive',async()=>{
  for(const target of ['OCCUPIED@EXAMPLE.TEST','13800009999','+86 13800009999']) {
   const sent=await api('/api/auth/code',{method:'POST',body:{target}})
   check('occupied contact rejected before sending: '+target,sent.status===409&&!sent.data.user&&!sent.data.userId)
   await api('/__auth_fixture',{method:'POST',body:{seedCode:target.includes('@')?'occupied@example.test':'13800009999'}})
   check('occupied contact rejected at binding: '+target,(await api('/api/account/bind',{method:'POST',body:{target,code:'123456'}})).status===409)
  }
  for(const target of ['race@example.test','13900008888']) {
   await api('/__auth_fixture',{method:'POST',body:{seedCode:target}})
   const responses=await Promise.all(['bob','alice'].map(user=>api('/api/account/bind',{user,method:'POST',body:{target,code:'123456'}})))
   check('parallel binding has exactly one winner: '+target,responses.filter(r=>r.status===200).length===1&&responses.filter(r=>r.status===409).length===1)
   check('contact belongs to one stored account: '+target,Object.values(stored().users).filter(u=>(target.includes('@')?u.email:u.phone)===target).length===1)
  }
  await api('/__auth_fixture',{method:'POST',body:{seedCode:'replacement@example.test'}})
  check('owner can replace own email',(await api('/api/account/bind',{user:'bob',method:'POST',body:{target:'replacement@example.test',code:'123456'}})).status===200)
  check('previous email released after replacement',(await api('/api/auth/code',{method:'POST',body:{target:'occupied@example.test'}})).status===503)
 })
 await group('AUTH-005',async()=>{
  const r=await api('/api/auth/logout',{user:'logout',method:'POST'});check('logout clears cookie',r.status===200&&r.response.headers.get('set-cookie').includes('Max-Age=0'))
  check('old cookie cannot access account',(await api('/api/account/records',{user:'logout'})).status===401&&(await api('/api/auth/me',{user:'logout'})).data.user===null)
 })
 await group('AUTH-006',async()=>{
  for(const nickname of ['', 'x'.repeat(41)])check('invalid nickname rejected',(await api('/api/auth/profile',{method:'PATCH',body:{nickname}})).status===400)
  const html='<img src=x onerror=alert(1)>';check('HTML retained as literal text',(await api('/api/auth/profile',{method:'PATCH',body:{nickname:html}})).data.user.nickname===html)
  check('control characters refused',(await api('/api/auth/profile',{method:'PATCH',body:{nickname:'name\u0000\r\n'}})).status===400)
  const anomaly=fs.readFileSync(path.join(root,'测试数据/鲲穹文件传输测试数据包/06-安全与异常输入/TC-07-03-路径穿越与控制字符.txt'),'utf8').trim()
  check('provided anomalous input refused',(await api('/api/auth/profile',{method:'PATCH',body:{nickname:anomaly}})).status===400)
  check('valid nickname saved',(await api('/api/auth/profile',{method:'PATCH',body:{nickname:'AUTH测试昵称'}})).status===200&&stored().users.alice.nickname==='AUTH测试昵称')
  for(const target of ['', 'x'.repeat(170)+'@example.test','<script>12345678901</script>'])check('invalid contact refused',(await api('/api/auth/code',{method:'POST',body:{target}})).status===400)
 })
 const image=fs.readFileSync(path.join(root,'测试数据/鲲穹文件传输测试数据包/01-安全文件集/TC-03-04-图片预览-1x1.png'))
 await group('AUTH-007',async()=>{
  const avatar='data:image/png;base64,'+image.toString('base64')
  const saved=(await api('/api/auth/profile',{method:'PATCH',body:{avatar}})).data.user?.avatar
  check('real dataset avatar saved',Boolean(saved?.startsWith('data:image/webp;base64,')))
  const decoded=await sharp(Buffer.from(saved.split(',')[1],'base64')).raw().toBuffer({resolveWithObject:true})
  check('saved avatar is a decodable image',decoded.info.width===1&&decoded.info.height===1)
  check('avatar persists in me',(await api('/api/auth/me')).data.user.avatar===saved)
  for(const avatar of ['data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,bm90LWFuLWltYWdl'])check('invalid image rejected',(await api('/api/auth/profile',{method:'PATCH',body:{avatar}})).status===400)
  check('restore provider avatar',(await api('/api/auth/profile',{method:'PATCH',body:{avatar:null}})).data.user.avatar==='https://example.invalid/avatar.png')
 })
 await group('AUTH-009',async()=>{
  await api('/api/account/file-cleanup-settings',{method:'PUT',body:{settings:{enabled:false,days:1}}});check('disabled cleanup retains expired file',fs.existsSync(path.join(fixture,'storage/files/past/safe.txt')))
  const r=await api('/api/account/file-cleanup-settings',{method:'PUT',body:{settings:{enabled:true,days:1}}});check('cleanup settings saved',r.data.settings.enabled&&stored().users.alice.fileCleanup.days===1)
  for(let i=0;i<100&&fs.existsSync(path.join(cdir,'safe.txt'));i++)await delay(10)
  check('expired share and collection deleted',!fs.existsSync(path.join(fixture,'storage/files/past/safe.txt'))&&!fs.existsSync(path.join(cdir,'safe.txt')))
  check('active, grace and other account files retained',['live','grace','other'].every(id=>fs.existsSync(path.join(fixture,`storage/files/${id}/safe.txt`))))
  await api('/api/account/file-cleanup-settings',{method:'PUT',body:{settings:{enabled:false,days:3}}})
 })
 await group('AUTH-010',async()=>{
  await api('/api/account/notification-settings',{method:'PUT',body:{settings:{shareDownloaded:false,collectionSubmitted:false}}});check('notification prefs persisted',!(await api('/api/account/notification-settings')).data.settings.shareDownloaded)
  await api('/api/account/messages/alice-message',{method:'PATCH'});check('read state persisted',!(await api('/api/account/messages')).data.messages.find(m=>m.id==='alice-message').unread)
  check('other user message cannot be read',(await api('/api/account/messages/bob-message',{method:'PATCH'})).status===404)
  await api('/api/account/messages/bob-message',{method:'DELETE'});check('other user deletion has no effect',(await api('/api/account/messages',{user:'bob'})).data.messages.some(m=>m.id==='bob-message'))
  await api('/api/account/messages/alice-message',{method:'DELETE'});check('single delete persists',!(await api('/api/account/messages')).data.messages.some(m=>m.id==='alice-message'))
  await api('/api/account/messages',{method:'DELETE'});check('all delete persists',(await api('/api/account/messages')).data.messages.length===0)
 })
 await group('AUTH-011',async()=>{
  const records=[{id:'my_sent:share:sent',scope:'my_sent',kind:'share',name:'sent',shareUrl:base+'/share/sent'},{id:'sent_to_me:share:received',scope:'sent_to_me',kind:'share',name:'received',shareUrl:base+'/share/received'},{id:'my_collections:collection:tasktoken',scope:'my_collections',kind:'collection',name:'collected',publicUrl:base+'/collect/tasktoken'}]
  const r=await api('/api/account/records',{method:'POST',body:{records}});check('send/receive/collection records stored',r.status===201&&r.data.records.length===3)
  check('fresh device retrieves server records',(await api('/api/account/records')).data.records.length===3)
  check('records isolated by user',(await api('/api/account/records',{user:'bob'})).data.records.length===0)
 })
 await group('AUTH-012',async()=>{
  await api('/__auth_fixture',{method:'POST',body:{session:'expire-session'}})
  for(const url of ['/api/account/records','/api/account/messages','/api/account/file-cleanup-settings','/api/account/team/overview','/api/account/workspace'])check('expired session refused '+url,(await api(url,{user:'expire'})).status===401)
  check('expired me has null user',(await api('/api/auth/me',{user:'expire'})).data.user===null)
 })
 await group('AUTH-013',async()=>{
  const original=stored().users.alice.nickname
  for(const method of ['POST','PUT','PATCH','DELETE'])check('foreign Origin blocked '+method,(await api('/api/auth/profile',{method,body:{nickname:'evil'},headers:{Origin:'https://evil.invalid'}})).status===403)
  check('opaque Origin blocked',(await api('/api/auth/profile',{method:'PATCH',body:{nickname:'evil'},headers:{Origin:'null'}})).status===403)
  check('cross-site request without Origin blocked',(await api('/api/auth/profile',{method:'PATCH',body:{nickname:'evil'},headers:{'Sec-Fetch-Site':'cross-site'}})).status===403)
  check('GET ignores mutation payload',(await api('/api/auth/profile?nickname=evil')).status!==200&&stored().users.alice.nickname===original)
  check('same-origin mutation accepted',(await api('/api/auth/profile',{method:'PATCH',body:{nickname:original},headers:{Origin:base}})).status===200)
 })
 await stop();await start(true)
 await group('AUTH-004-enabled',async()=>{
  const target='bind@example.test';const r=await api('/api/auth/code',{method:'POST',body:{target}});check('SMTP send succeeds without code in response: '+JSON.stringify({status:r.status,...r.data}),r.status===201&&!('debugCode'in r.data)&&!('code'in r.data)&&delivered.length>0)
  check('target cooldown enforced',(await api('/api/auth/code',{method:'POST',body:{target}})).status===429)
  const code=delivered.at(-1).match(/\b\d{6}\b/)?.[0];assert.ok(code,'code received over SMTP')
  for(let i=0;i<5;i++)check('wrong code rejected',(await api('/api/account/bind',{method:'POST',body:{target,code:'wrong'}})).status===400)
  check('five failed attempts revoke code',(await api('/api/account/bind',{method:'POST',body:{target,code}})).status===400)
  await api('/__auth_fixture',{method:'POST',body:{resetLimits:true}});await api('/api/auth/code',{method:'POST',body:{target}});const freshCode=delivered.at(-1).match(/\b\d{6}\b/)[0]
  check('valid email binding persists',(await api('/api/account/bind',{method:'POST',body:{target,code:freshCode}})).data.user.email===target&&stored().users.alice.email===target)
  check('used verification code rejected',(await api('/api/account/bind',{method:'POST',body:{target,code:freshCode}})).status===400)
  await api('/__auth_fixture',{method:'POST',body:{resetLimits:true}});await api('/api/auth/code',{method:'POST',body:{target:'ttl@example.test'}});const expiredCode=delivered.at(-1).match(/\b\d{6}\b/)[0];await api('/__auth_fixture',{method:'POST',body:{expireCode:'ttl@example.test'}})
  check('TTL expired code refused',(await api('/api/account/bind',{method:'POST',body:{target:'ttl@example.test',code:expiredCode}})).status===400)
  await api('/__auth_fixture',{method:'POST',body:{resetLimits:true}});for(let i=0;i<10;i++)await api('/api/auth/code',{method:'POST',body:{target:`rate${i}@example.test`}})
  check('per-IP request limit enforced',(await api('/api/auth/code',{method:'POST',body:{target:'rate11@example.test'}})).status===429)
 })
 await group('AUTH-persistence',async()=>{
  check('profile survives restart',(await api('/api/auth/me')).data.user.nickname==='AUTH测试昵称')
  check('messages deleted after restart',(await api('/api/account/messages')).data.messages.length===0)
  check('records restored after restart',(await api('/api/account/records')).data.records.length===3)
  check('cleanup preference restored',!(await api('/api/account/file-cleanup-settings')).data.settings.enabled)
 })
 await group('AUTH-binding-relogin',async()=>{
  await api('/__auth_fixture',{method:'POST',body:{seedCode:'13700002222'}})
  check('phone binding succeeds',(await api('/api/account/bind',{method:'POST',body:{target:'13700002222',type:'phone',code:'123456'}})).status===200)
  const response=await callback(await login(),'stale-contact')
  check('login remains usable after local binding',new URL(response.headers.get('location')).searchParams.get('login')==='success')
  check('relogin preserves verified contacts instead of stale provider values',stored().users.alice.email==='bind@example.test'&&stored().users.alice.phone==='13700002222')
  const next='13900004444';await api('/__auth_fixture',{method:'POST',body:{seedCode:next}})
  check('explicit replacement of verified phone remains available',(await api('/api/account/bind',{method:'POST',body:{target:next,type:'phone',code:'123456'}})).status===200&&stored().users.alice.phone===next)
 })
 for(const smsError of ['invalid','unavailable']) {
  await stop();await start(true,smsError)
  await group('AUTH-sms-no-fallback-'+smsError,async()=>{
   const target='13500007777',r=await api('/api/auth/code',{method:'POST',body:{target,type:'phone'}})
   check('gateway rejection is a failure even in debug mode',r.status===(smsError==='invalid'?400:502)&&!('debugCode'in r.data)&&!('code'in r.data)&&!r.data.ok)
   check('SMS error is explained without demo or provider jargon',/手机号|短信/.test(r.data.message)&&!/演示|incorrect number|provider unavailable/.test(r.data.message))
   check('failed delivery invalidates the verification code',!stored().verificationCodes.some(c=>c.target===target)&&(await api('/api/account/bind',{method:'POST',body:{target,code:'123456'}})).status===400)
   check('verified contact survives restart',(await api('/api/auth/me')).data.user.phone==='13900004444')
  })
 }
} finally {await stop();await Promise.all([new Promise(r=>oauth.close(r)),new Promise(r=>smtp.close(r))])}
const result={executedAt:new Date().toISOString(),passed,failures,cases,fixture}
if(process.env.AUTH_TEST_EVIDENCE_DIR){fs.mkdirSync(process.env.AUTH_TEST_EVIDENCE_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.AUTH_TEST_EVIDENCE_DIR,'auth-api-results.json'),JSON.stringify({...result,requests},null,2))}
console.log(JSON.stringify(result,null,2))
process.exitCode=failures.length?1:0
