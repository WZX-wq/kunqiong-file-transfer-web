import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import net from 'node:net'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import assert from 'node:assert/strict'
import sharp from 'sharp'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, '.workbuddy/boundary-regression')
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-boundary-audit-'))
const results = []
function copy(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.isDirectory()) copy(path.join(from, entry.name), path.join(to, entry.name))
    else if (entry.isFile()) fs.copyFileSync(path.join(from, entry.name), path.join(to, entry.name))
  }
}
copy(path.join(root, 'server'), path.join(fixture, 'server'))
copy(path.join(root, 'email-templates'), path.join(fixture, 'email-templates'))
fs.copyFileSync(path.join(root, 'package.json'), path.join(fixture, 'package.json'))
fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), 'junction')
// Gate only the copied decoder to reproduce another request while decoding is pending.
const avatarModule = path.join(fixture, 'server/lib/avatar-validation.js')
fs.writeFileSync(avatarModule, fs.readFileSync(avatarModule, 'utf8').replace('export async function normalizeAvatarData(', 'async function decodeAvatarData(') + `
let gate, releaseGate; export let avatarStarted = false;
export function setAvatarGate(enabled) { avatarStarted = false; if(enabled) gate = new Promise(resolve => releaseGate = resolve); else { releaseGate?.(); gate = null; } }
export async function normalizeAvatarData(value) { if(gate) { avatarStarted = true; await gate; } return decodeAvatarData(value); }
`)
const control = `
import { resourceCreateAttempts, uploadSessions, verificationTargetLastSent, verificationIpAttempts } from './server/state.js'
import { setAvatarGate, avatarStarted } from './server/lib/avatar-validation.js'
app.post('/__boundary/avatar-gate', (req,res) => { setAvatarGate(req.body.enabled); res.json({ok:true}); });
app.get('/__boundary/avatar-gate', (_req,res) => res.json({started:avatarStarted}));
app.post('/__boundary/upload/:id', (req,res) => { const item = uploadSessions.get(req.params.id); if(req.body.createdAt) item.createdAt = req.body.createdAt; if(req.body.file) Object.assign(item.files[0],req.body.file); res.json({ok:true}); });
app.post('/__boundary/reset', (req,res) => {
  initMetadata(normalizeMetadata(req.body));
  resourceCreateAttempts.clear(); uploadSessions.clear(); verificationTargetLastSent.clear(); verificationIpAttempts.clear();
  persistMetadata(); res.json({ok:true});
});
app.post('/__boundary/oauth', async (req,res,next) => { try { const {createAuthSession} = await import('./server/services/admin.js'); res.json(createAuthSession(req.body)); } catch(e) { next(e) } });
app.post('/__boundary/payment', async (req,res,next) => { try { const {activatePaidUpgradeOrder} = await import('./server/services/account.js'); const order={id:'boundary-order',userId:'owner',planId:'member',status:'pending_payment',remotePackageDays:30}; activatePaidUpgradeOrder(order,req.body.expiry); res.json(order); } catch(e) { next(e) } });
app.get('/__boundary/snapshot', (_req,res) => res.json({metadata,uploads:[...uploadSessions].map(([id,item])=>({id,mode:item.mode,files:item.files.map(file=>({...file,chunks:[...file.chunks]}))}))}));
`
const source = fs.readFileSync(path.join(root, 'server.mjs'), 'utf8')
fs.writeFileSync(path.join(fixture, 'server.mjs'), source.replace('// 按域注册业务路由（顺序即 Express 匹配顺序，不可调整）', control + '\n// 按域注册业务路由（顺序即 Express 匹配顺序，不可调整）'))
fs.mkdirSync(path.join(fixture, 'storage'), { recursive: true })
const now = new Date().toISOString()
const future = new Date(Date.now() + 20 * 86400000).toISOString()
const past = new Date(Date.now() - 86400000).toISOString()
const users = Object.fromEntries(['owner','member','other','creator'].map(id => [id,{id,username:id,nickname:id,status:'active',planId:'enterprise',email:id+'@example.test',phone:id==='owner'?'13800001111':'',organizationId:['owner','member'].includes(id)?'org':''}]))
const sharedFile = { name:'safe.txt',relativePath:'safe.txt',storedName:'safe.txt',size:4,mimeType:'text/plain',reviewStatus:'approved',scanEngine:'clamav',scannedAt:now }
const share = {id:'share-a',code:'ABCD',manageToken:'manage-a',ownerUserId:'owner',createdAt:now,expiresAt:future,status:'active',downloadLimit:10,downloadCount:0,passwordHash:crypto.createHash('sha256').update('secret-test').digest('hex'),files:[sharedFile]}
const collection = {id:'task-a',token:'task-a',manageToken:'task-manage',ownerUserId:'owner',title:'original',description:'safe',deadline:future,status:'active',maxFileSizeMb:500,allowedTypes:['图片'],createdAt:now,qrDataUrl:'data:image/png;base64,fixture',submissions:[]}
const seed = {users,sessions:Object.values(users).map(user=>({id:user.id+'-session',user,expiresAt:future})),shares:[share,{...share,id:'share-stale',code:'EFGH',manageToken:'manage-stale',expiresAt:past,status:'closed',passwordHash:null}],collections:[collection],organizations:{org:{id:'org',slug:'test-org',name:'existing',ownerUserId:'owner',createdAt:now,members:[{id:'owner-member',userId:'owner',displayName:'owner',role:'owner',status:'active'},{id:'member-id',userId:'member',displayName:'member',role:'member',status:'active'}]}},records:{owner:[{id:'my_sent:share:share-a',scope:'my_sent',kind:'share',shareId:'share-a',name:'original',createdAt:now},{id:'my_sent:share:share-stale',scope:'my_sent',kind:'share',shareId:'share-stale',name:'stale',createdAt:now}]},messages:{owner:[{id:'msg',title:'fixture',body:'safe',unread:true,createdAt:now,category:'system'}]},notificationSettings:{owner:{email:false}},verificationCodes:[],upgradeOrders:[],systemConfig:{anonymousTotalSizeMb:1024}}
fs.writeFileSync(path.join(fixture, 'storage/metadata.json'), JSON.stringify(seed))
for(const id of ['share-a','share-stale']) { const dir=path.join(fixture,'storage/files',id);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'safe.txt'),'safe') }
fs.writeFileSync(path.join(fixture,'storage/files/share-a/download-large.bin'),crypto.randomBytes(16*1024*1024))
let child, base, errors=''
async function request(url, {method='GET',body,user='owner',headers={},form,raw}={}) {
  const response = await fetch(base+url,{method,redirect:'manual',signal:AbortSignal.timeout(8000),headers:{...(user?{cookie:`kunqiong_session=${user}-session`}:{}),...((body!==undefined||raw!==undefined)?{'content-type':'application/json'}:{}),...headers},body:form||raw||(body!==undefined?JSON.stringify(body):undefined)})
  const text = await response.text()
  let data;try{data=JSON.parse(text)}catch{data=text.slice(0,180)}
  return {status:response.status,data,headers:Object.fromEntries(response.headers)}
}
async function reset(next=seed) { const response=await request('/__boundary/reset',{method:'POST',body:next});if(response.status!==200)throw new Error('Reset failed'); }
async function snapshot(){return (await request('/__boundary/snapshot')).data}
async function probe(id, label, fn) {
  try { const evidence=await fn();results.push({id,label,...evidence}); }
  catch(error){results.push({id,label,probeError:error.message})}
}
async function apiProbe(id,label,url,options={},after) {await probe(id,label,async()=>{await reset();const response=await request(url,options);return{kind:'http',status:response.status,response:response.data,...(after?{after:await after(response)}:{})}})}
async function chunk(sessionId, {index=0,total=1,fileIndex=0,bytes='safe',hash}={}) {
  const form=new FormData();form.append('fileIndex',String(fileIndex));form.append('chunkIndex',String(index));form.append('totalChunks',String(total));form.append('chunk',new Blob([bytes]),'chunk.bin');if(hash!==undefined)form.append('chunkHash',hash)
  return request(`/api/upload-sessions/${sessionId}/chunks`,{method:'POST',form})
}

const failures = []
let passed = 0
async function test(name, run) {
  try { await reset(); await run(); passed++; console.log('PASS ' + name) }
  catch (error) { failures.push({ name, message: error.message.slice(0,500) }); console.error('FAIL ' + name + ': ' + error.message.slice(0,180)) }
}
async function reject(url, body, method='POST', status=400) {
  const r=await request(url,{method,body});assert.equal(r.status,status,String(r.data?.message || r.status));return r
}
async function upload(body) { return request('/api/upload-sessions',{method:'POST',body:{files:[{name:'a.txt',size:4}],...body}}) }
try {
  const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));base=`http://127.0.0.1:${port}`
  const env={...process.env};for(const key of Object.keys(env))if(/^(KUNQIONG_|OAUTH_)/.test(key))delete env[key]
  child=spawn(process.execPath,['server.mjs'],{cwd:fixture,windowsHide:true,env:{...env,PORT:String(port),KUNQIONG_HOST:'127.0.0.1',NODE_ENV:'production',KUNQIONG_DB_ENABLED:'false',KUNQIONG_SCAN_MODE:'optional',KUNQIONG_ADMIN_USERNAME:'a'.repeat(120),KUNQIONG_ADMIN_PASSWORD:'synthetic-audit-password',KUNQIONG_WEB_MEMBER_API_BASE:base+'/no-external-service'},stdio:['ignore','ignore','pipe']})
  child.stderr.on('data',data=>errors+=data)
  let ready=false;for(let i=0;i<100;i++){try{if((await request('/api/health')).status===200){ready=true;break}}catch{}if(child.exitCode!==null)throw new Error('Fixture exited: '+errors);await delay(50)}if(!ready)throw new Error('Fixture start timeout')

  for(const ids of [undefined,[],null,'invalid',[null],[{}]])await test('BND-001 invalid delete cannot erase records '+JSON.stringify(ids),async()=>{
    await reject('/api/account/records',{ids},'DELETE');const s=await snapshot();assert.equal(s.metadata.records.owner.length,2);assert.ok(s.metadata.shares.some(x=>x.id==='share-stale'))
  })
  await test('BND-001 explicit clear-all remains available',async()=>{const r=await request('/api/account/records',{method:'DELETE',body:{all:true}});assert.equal(r.status,200);assert.equal((await snapshot()).metadata.records.owner.length,0)})
  for(const records of [null,{},'bad',[null]])await test('BND-002 invalid replacement preserves records '+JSON.stringify(records),async()=>{await reject('/api/account/records',{records},'PUT');assert.equal((await snapshot()).metadata.records.owner.length,2)})
  await test('BND-003 only one concurrent download can reserve the last slot',async()=>{const next=structuredClone(seed);next.shares[0].passwordHash=null;next.shares[0].downloadLimit=1;await reset(next);const r=await Promise.all(Array.from({length:6},()=>request('/api/shares/share-a/download')));assert.equal(r.filter(x=>x.status===200).length,1);assert.equal((await snapshot()).metadata.shares[0].downloadCount,1)})
  for(const value of ['false',[],{}])await test('BND-004 invalid clearPassword preserves protection '+JSON.stringify(value),async()=>{await reject('/api/shares/manage/manage-a',{clearPassword:value},'PATCH');assert.ok((await snapshot()).metadata.shares[0].passwordHash)})
  for(const value of ['false',[],{}])await test('BND-004 invalid cleanup flag rejected '+JSON.stringify(value),async()=>{await reject('/api/account/file-cleanup-settings',{settings:{enabled:value,days:7}},'PATCH')})
  await test('BND-004 invalid notification flag rejected',async()=>{await reject('/api/account/notification-settings',{settings:{email:'false'}},'PUT')})
  await test('BND-005 failed share update is atomic',async()=>{await reject('/api/shares/manage/manage-a',{downloadLimit:5,status:'bad'},'PATCH');assert.equal((await snapshot()).metadata.shares[0].downloadLimit,10)})
  await test('BND-005 failed collection update is atomic',async()=>{await reject('/api/collections/manage/task-manage',{title:'changed',maxFileSizeMb:-1},'PATCH');assert.equal((await snapshot()).metadata.collections[0].title,'original')})
  for(const index of [1,9999])await test('BND-006 zero byte file rejects extra chunk '+index,async()=>{const u=await upload({files:[{name:'empty.txt',size:0}]});assert.equal((await chunk(u.data.sessionId,{index,total:10000,bytes:''})).status,400)})
  await test('BND-006 declared total must match server layout',async()=>{const u=await upload({});assert.equal((await chunk(u.data.sessionId,{total:9999})).status,400)})
  await test('BND-006 empty chunk indices rejected',async()=>{const u=await upload({});assert.equal((await chunk(u.data.sessionId,{index:'',fileIndex:''})).status,400)})
  for(const mode of ['direct','chunk'])await test('BND-007 collection rejects changed extension '+mode,async()=>{
    if(mode==='direct'){const form=new FormData();form.append('files',new Blob(['safe']),'safe.png');form.append('relativePaths','["safe.exe"]');form.append('participantName','audit');assert.equal((await request('/api/collections/task-a/submissions',{method:'POST',form})).status,400)}
    else assert.equal((await upload({mode:'collection',collectionToken:'task-a',participantName:'audit',files:[{name:'safe.png',size:4}],relativePaths:['safe.exe']})).status,400)
  })
  for(const file of [{name:'a\u0000.txt',size:4},{name:'a'.repeat(270)+'.txt',size:4},{name:'a\ud800.txt',size:4},{name:'a.txt',size:4,mimeType:'text/plain\r\nX-Test: bad'}])await test('BND-008 reject unusable metadata before uploading '+JSON.stringify(file).slice(0,70),async()=>{assert.equal((await upload({files:[file]})).status,400)})
  for(const recipients of ['123456','user@example.com123'])await test('BND-010 invalid recipient rejected before uploading '+recipients,async()=>{assert.equal((await upload({recipients})).status,400)})
  for(const downloadLimit of [0,-1,0.5,1.9,10000,'invalid',true,[5]])await test('BND-011 invalid download limit '+JSON.stringify(downloadLimit),async()=>{await reject('/api/shares/manage/manage-a',{downloadLimit},'PATCH')})
  for(const maxFileSizeMb of [0.5,5121,true,[5],'1e12'])await test('BND-012 invalid collection size '+JSON.stringify(maxFileSizeMb),async()=>{await reject('/api/collections',{title:'audit',maxFileSizeMb})})
  for(const allowedTypes of [['bad'],{},'图片',[],['图片','bad']])await test('BND-013 invalid types cannot open all extensions '+JSON.stringify(allowedTypes),async()=>{await reject('/api/collections/manage/task-manage',{allowedTypes},'PATCH');assert.deepEqual((await snapshot()).metadata.collections[0].allowedTypes,['图片'])})
  for(const deadline of ['2027-02-30','2027-13-01',0])await test('BND-014 invalid calendar date '+deadline,async()=>{await reject('/api/collections',{title:'audit',deadline})})
  for(const nickname of [{},['alice'],true,'x\u202Ey'])await test('BND-015/023 invalid nickname '+JSON.stringify(nickname),async()=>{await reject('/api/auth/profile',{nickname},'PATCH')})
  for(const title of [{},['a'],true,'x\u0000y','x\u202Ey'])await test('BND-015 invalid title '+JSON.stringify(title),async()=>{await reject('/api/collections',{title})})
  for(const participantName of ['x'.repeat(41),{},['alice'],'x\u0000y'])await test('BND-016 invalid anonymous name '+JSON.stringify(participantName),async()=>{const r=await request('/api/upload-sessions',{method:'POST',user:'',body:{mode:'collection',collectionToken:'task-a',participantName,files:[{name:'safe.png',size:4}]}});assert.equal(r.status,400)})
  for(const message of ['x'.repeat(121),{},'x\u0000y'])await test('BND-016 invalid join message '+JSON.stringify(message),async()=>{assert.equal((await request('/api/organizations/test-org/join-request',{method:'POST',user:'other',body:{message}})).status,400)})
  await test('BND-017 corrupted PNG rejected',async()=>{const b=Buffer.alloc(45);Buffer.from([137,80,78,71,13,10,26,10]).copy(b);b.write('IEND',37);await reject('/api/auth/profile',{avatar:'data:image/png;base64,'+b.toString('base64')},'PATCH')})
  for(const files of [[null],[{}],[{name:'',size:0}],[{name:'a.txt',size:true}],[{name:'a.txt',size:[4]}]])await test('BND-018 invalid file description '+JSON.stringify(files),async()=>{assert.equal((await upload({files})).status,400)})
  await test('BND-018 unknown upload mode rejected',async()=>{assert.equal((await upload({mode:'bad'})).status,400)})
  for(const paths of ['null','{}','"abc"','not json','[{}]'])await test('BND-019 direct paths require string array '+paths,async()=>{const form=new FormData();form.append('files',new Blob(['safe']),'safe.txt');form.append('relativePaths',paths);assert.equal((await request('/api/shares',{method:'POST',form})).status,400)})
  await test('BND-019 deep paths rejected',async()=>{assert.equal((await upload({files:[{name:'a.txt',relativePath:'dir/'.repeat(1000)+'a.txt',size:4}]})).status,400)})
  for(const update of [{planId:['member']},{planExpiresAt:'2027-02-30'},{planExpiresAt:'9999-12-31'},{}])await test('BND-020 invalid admin user patch '+JSON.stringify(update),async()=>{const login=await request('/api/admin/login',{method:'POST',user:'',body:{username:'a'.repeat(120),password:'synthetic-audit-password'}});assert.equal((await request('/api/admin/users/other',{method:'PATCH',user:'',headers:{cookie:login.headers['set-cookie']?.split(';')[0]},body:update})).status,400)})
  await test('BND-022 corrupt session expiry fails closed',async()=>{const next=structuredClone(seed);next.sessions[0].expiresAt='invalid';await reset(next);assert.equal((await request('/api/auth/me')).data.user,null)})
  await test('BND-024 unsafe record number rejected',async()=>{await reject('/api/account/records',{record:{id:'big',totalSize:1e100,downloadCount:true}})})
  await test('BND-024 alias over UI limit rejected',async()=>{await reject('/api/account/records',{record:{id:'alias',alias:'a'.repeat(81)}})})
  await test('BND-024 oversized record batch rejected',async()=>{await reject('/api/account/records',{records:Array.from({length:201},(_,i)=>({id:'entry-'+i}))},'PUT')})
  await test('BND-025 transfer member ID must be scalar',async()=>{await reject('/api/account/workspace/transfer-ownership',{targetMemberId:['member-id']});assert.equal((await snapshot()).metadata.organizations.org.ownerUserId,'owner')})
  for(const password of [true,{},' ','a'.repeat(129)])await test('BND-026 invalid password '+JSON.stringify(password).slice(0,40),async()=>{assert.equal((await upload({password})).status,400)})
  for(const options of [{expiryDays:-1},{expiryDays:0.5},{expiryDays:99999},{codeLength:4.5}])await test('BND-026 invalid share options '+JSON.stringify(options),async()=>{assert.equal((await upload(options)).status,400)})
  await test('BND-027 unexpected multipart file field is client error',async()=>{const form=new FormData();form.append('unexpected',new Blob(['safe']),'safe.txt');assert.equal((await request('/api/shares',{method:'POST',form})).status,400)})
  await test('BND-027 oversized multipart field is 413',async()=>{const form=new FormData();form.append('relativePaths','a'.repeat(1024*1024+1));form.append('files',new Blob(['safe']),'safe.txt');assert.equal((await request('/api/shares',{method:'POST',form})).status,413)})
  await test('BND-027 excessive multipart fields are bounded',async()=>{const form=new FormData();form.append('files',new Blob(['safe']),'safe.txt');for(let i=0;i<21;i++)form.append('field'+i,'value');assert.equal((await request('/api/shares',{method:'POST',form})).status,413)})
  await test('BND-028 duplicate recipients notify once',async()=>{const u=await upload({recipients:['other','other']});assert.equal(u.status,201);assert.equal((await chunk(u.data.sessionId)).status,200);const c=await request(`/api/upload-sessions/${u.data.sessionId}/complete`,{method:'POST',body:{}});assert.equal(c.status,201);assert.equal(c.data.share.notificationLog.length,1)})
  await test('BND-028 aliases of one recipient notify once',async()=>{const u=await upload({recipients:['other','other@example.test']});assert.equal(u.status,201);await chunk(u.data.sessionId);const c=await request(`/api/upload-sessions/${u.data.sessionId}/complete`,{method:'POST',body:{}});assert.equal(c.status,201);assert.equal(c.data.share.notificationLog.length,1);assert.equal((await snapshot()).metadata.messages.other.filter(message=>message.eventType==='incomingShare').length,1)})
  for(const url of ['/api/shares/manage/manage-a','/api/collections/manage/task-manage'])await test('scalar status enum '+url,async()=>{await reject(url,{status:['closed']},'PATCH')})
  for(const record of [{id:'nested',files:Array.from({length:121},()=>({name:'a.txt'}))},{id:'nested',submissions:[{id:'sub',files:[{size:true}]}]},{id:'nested',submissions:[null]},{id:'nested',allowedTypes:[{}]}])await test('BND-024 invalid nested records rejected '+JSON.stringify(record).slice(0,80),async()=>{await reject('/api/account/records',{record})})
  await test('verification code requires a six-digit scalar string',async()=>{const next=structuredClone(seed);next.verificationCodes=[{type:'email',target:'new@example.test',scene:'bind',codeHash:crypto.createHash('sha256').update('123456').digest('hex'),createdAt:now,expiresAt:future,attempts:0}];await reset(next);await reject('/api/account/bind',{type:'email',target:'new@example.test',code:['123456']});assert.equal((await snapshot()).metadata.users.owner.email,'owner@example.test')})
  await test('BND-008 direct multipart MIME is bounded',async()=>{const form=new FormData();form.append('files',new Blob(['safe'],{type:'text/'+ 'a'.repeat(105)}),'safe.txt');assert.equal((await request('/api/shares',{method:'POST',form})).status,400)})
  await test('BND-008 direct multipart name is not silently trimmed',async()=>{const form=new FormData();form.append('files',new Blob(['safe']),'safe.txt ');assert.equal((await request('/api/shares',{method:'POST',form})).status,400)})
  await test('BND-028 account notification ignores other users matching nickname',async()=>{const next=structuredClone(seed);next.users.creator.nickname='other';await reset(next);const u=await upload({recipients:['other']});assert.equal(u.status,201);await chunk(u.data.sessionId);const c=await request(`/api/upload-sessions/${u.data.sessionId}/complete`,{method:'POST',body:{}});assert.equal(c.status,201);assert.deepEqual(c.data.share.notificationLog[0].deliveredUserIds,['other'])})
  await test('BND-008 persisted session metadata rechecked before publishing',async()=>{const u=await upload({});await chunk(u.data.sessionId);await request('/__boundary/upload/'+u.data.sessionId,{method:'POST',body:{file:{relativePath:'a.exe'}}});assert.equal((await request(`/api/upload-sessions/${u.data.sessionId}/complete`,{method:'POST',body:{}})).status,400)})
  await test('RULE-005 upload TTL enforced without sweep',async()=>{const u=await upload({});await request('/__boundary/upload/'+u.data.sessionId,{method:'POST',body:{createdAt:past}});assert.equal((await request('/api/upload-sessions/'+u.data.sessionId)).status,410);assert.equal((await snapshot()).uploads.length,0)})
  await test('BND-003 HEAD and failed Range release the last slot',async()=>{const next=structuredClone(seed);next.shares[0].passwordHash=null;next.shares[0].downloadLimit=1;await reset(next);const url='/api/shares/share-a/files/0/download';assert.equal((await request(url,{method:'HEAD'})).status,200);assert.equal((await snapshot()).metadata.shares[0].downloadCount,0);assert.equal((await request(url,{headers:{range:'bytes=999-1000'}})).status,416);assert.equal((await request(url)).status,200);assert.equal((await snapshot()).metadata.shares[0].downloadCount,1)})
  await test('BND-003 aborted stream releases last slot',async()=>{const next=structuredClone(seed);Object.assign(next.shares[0],{passwordHash:null,downloadLimit:1,files:[{...sharedFile,name:'download-large.bin',relativePath:'download-large.bin',storedName:'download-large.bin',size:16*1024*1024,mimeType:'application/octet-stream'}]});await reset(next);const url='/api/shares/share-a/files/0/download';await new Promise((resolve,reject)=>{const req=http.get(base+url,{headers:{cookie:'kunqiong_session=owner-session'}},response=>{assert.equal(response.statusCode,200);response.once('data',()=>{response.destroy();req.destroy();resolve()})});req.on('error',reject)});await delay(100);assert.equal((await snapshot()).metadata.shares[0].downloadCount,0);assert.equal((await request(url)).status,200);assert.equal((await snapshot()).metadata.shares[0].downloadCount,1)})
  await test('legal five-character pickup code remains supported',async()=>{const u=await upload({codeLength:5});assert.equal(u.status,201);await chunk(u.data.sessionId);const c=await request(`/api/upload-sessions/${u.data.sessionId}/complete`,{method:'POST',body:{}});assert.equal(c.status,201);assert.equal(c.data.share.code.length,5)})
  for(const chunkSize of [true,[],0,-1,1.5,'bad'])await test('invalid negotiated chunk type '+JSON.stringify(chunkSize),async()=>{assert.equal((await upload({chunkSize})).status,400)})
  await test('legal direct folder preserves names and bytes',async()=>{const form=new FormData();form.append('files',new Blob(['safe']),'safe.txt');form.append('relativePaths','["folder/safe.txt"]');const c=await request('/api/shares',{method:'POST',form});assert.equal(c.status,201);assert.equal(c.data.share.files[0].relativePath,'folder/safe.txt');assert.equal((await request(`/api/shares/manage/${c.data.share.manageToken}/files/0/download`)).data,'safe')})
  for(const downloadLimit of [1,9999])await test('legal download limit '+downloadLimit,async()=>{assert.equal((await request('/api/shares/manage/manage-a',{method:'PATCH',body:{downloadLimit}})).status,200);assert.equal((await snapshot()).metadata.shares[0].downloadLimit,downloadLimit)})
  for(const maxFileSizeMb of [1,5120])await test('legal collection file limit '+maxFileSizeMb,async()=>{assert.equal((await request('/api/collections',{method:'POST',body:{title:'legal',maxFileSizeMb}})).status,201)})
  const avatar='data:image/png;base64,'+(await sharp({create:{width:1,height:1,channels:3,background:'#4488ff'}}).png().toBuffer()).toString('base64')
  for(const revoke of [false,true])await test('profile decoding rechecks '+(revoke?'revoked session':'concurrent nickname'),async()=>{await request('/__boundary/avatar-gate',{method:'POST',body:{enabled:true}});const pending=request('/api/auth/profile',{method:'PATCH',body:{avatar}});try {let started=false;for(let i=0;i<100;i++){if((await request('/__boundary/avatar-gate')).data.started){started=true;break}await delay(10)}assert.ok(started);if(revoke)await request('/api/auth/logout',{method:'POST',body:{}});else assert.equal((await request('/api/auth/profile',{method:'PATCH',body:{nickname:'new-name'}})).status,200);}finally{await request('/__boundary/avatar-gate',{method:'POST',body:{enabled:false}})}const r=await pending;assert.equal(r.status,revoke?401:200);const s=await snapshot();if(!revoke)assert.equal(s.metadata.users.owner.nickname,'new-name');else assert.equal(s.metadata.users.owner.avatar,null)})
  await test('legal zero-byte file publishes',async()=>{const u=await upload({files:[{name:'empty.txt',size:0}]});assert.equal((await chunk(u.data.sessionId,{bytes:''})).status,200);const c=await request(`/api/upload-sessions/${u.data.sessionId}/complete`,{method:'POST',body:{}});assert.equal(c.status,201);assert.equal(c.data.share.files[0].size,0)})
  for(const body of [{},[],{unexpected:true}])await test('BND-029 empty or unknown patch rejected '+JSON.stringify(body),async()=>{await reject('/api/shares/manage/manage-a',body,'PATCH')})
  await test('BND-030 administrator identifier must not be truncated before authentication',async()=>{assert.equal((await request('/api/admin/login',{method:'POST',user:'',body:{username:'a'.repeat(120)+'extra',password:'synthetic-audit-password'}})).status,400)})
  await test('RULE-002 negotiated chunk size is returned on creation',async()=>{const u=await upload({chunkSize:1});assert.equal(u.data.chunkSize,1048576)})
  for(const expires_in of [0,-1,0.5,1e12,'invalid','Infinity',true])await test('BND-021 invalid OAuth TTL creates no user '+expires_in,async()=>{await reject('/__boundary/oauth',{expires_in,user:{id:'bad-oauth',username:'bad'}});assert.equal((await snapshot()).metadata.users['bad-oauth'],undefined)})
  await test('BND-021 valid short OAuth TTL preserved',async()=>{const before=Date.now();const r=await request('/__boundary/oauth',{method:'POST',body:{expires_in:1,user:{id:'short-oauth',username:'short'}}});assert.equal(r.status,200);assert.ok(new Date(r.data.expiresAt).getTime()-before<2000)})
  for(const expiry of ['invalid','9999-12-31','2027-02-30'])await test('RULE-006 invalid payment expiry never activates '+expiry,async()=>{await reject('/__boundary/payment',{expiry},'POST',502);assert.equal((await snapshot()).metadata.users.owner.planId,'enterprise')})
  await test('legal file still uploads and downloads intact',async()=>{const u=await upload({password:'valid-secret',downloadLimit:'unlimited'});assert.equal(u.status,201);assert.equal((await chunk(u.data.sessionId)).status,200);const c=await request(`/api/upload-sessions/${u.data.sessionId}/complete`,{method:'POST',body:{}});assert.equal(c.status,201);const r=await request(`/api/shares/manage/${c.data.share.manageToken}/files/0/download`);assert.equal(r.status,200);assert.equal(r.data,'safe')})
} finally {
  if(child&&child.exitCode===null){const ended=once(child,'exit');child.kill();await Promise.race([ended,delay(3000)])}
  fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({passed,failures},null,2));fs.writeFileSync(path.join(output,'stderr.log'),errors)
}
console.log(`Boundary regression: ${passed} passed, ${failures.length} failed`)
if(failures.length)process.exitCode=1
