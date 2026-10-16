// 企业权限回归：真实接口和磁盘持久化，一次性副本中的合成账号，不操作真实团队。
import assert from 'node:assert/strict'
import { readFixtureMetadata } from './lib/read-audit-fixture.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-team-'))
function copy(from,to){fs.mkdirSync(to,{recursive:true});for(const e of fs.readdirSync(from,{withFileTypes:true})){const source=path.join(from,e.name),target=path.join(to,e.name);if(e.isDirectory())copy(source,target);else if(e.isFile())fs.copyFileSync(source,target)}}
copy(path.join(root, 'server'), path.join(fixture, 'server'))
fs.copyFileSync(path.join(root, 'package.json'), path.join(fixture, 'package.json'))
fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), 'junction')
fs.copyFileSync(path.join(root, 'server.mjs'), path.join(fixture, 'server.mjs'))
fs.appendFileSync(path.join(fixture,'server.mjs'), `
app.post('/__permission_fixture', async (req,res) => { const {metadata,persistMetadata}=await import('./server/lib/metadata-store.js'); if(req.body.userStatus)metadata.users[req.body.userStatus.id].status=req.body.userStatus.status; if(req.body.userPlan)metadata.users[req.body.userPlan.id].planId=req.body.userPlan.planId; persistMetadata();res.json({ok:true}); });
`);
fs.appendFileSync(path.join(fixture,'server.mjs'),"\nconst { default: permissionQr } = await import('qrcode');\nconst permissionQrOriginal = permissionQr.toDataURL;\nlet permissionHold = false, permissionWaiting = false, permissionRelease;\npermissionQr.toDataURL = async (...args) => {\n if (permissionHold) {permissionHold=false;permissionWaiting=true;await new Promise(resolve=>permissionRelease=resolve);permissionWaiting=false;}\n return permissionQrOriginal(...args);\n};\napp.post('/__permission_upload_gate',(req,res)=>{\n if(req.body.arm)permissionHold=true;\n if(req.body.release && permissionRelease){permissionRelease();permissionRelease=null;}\n res.json({waiting:permissionWaiting});\n});\n");
const now = new Date().toISOString(), future = new Date(Date.now() + 30*86400000).toISOString()
const ids = ['owner','member','member2','transfer','owner2','other','removeOwner','victim','leaveOwner','leaver','dissolveOwner','dissolveMember','outsider','accept','decline','expired','create','empty','long','control','duplicate',...Array.from({length:12},(_,i)=>'candidate'+i)]
const users = Object.fromEntries(ids.map((id,i)=>[id,{id,username:id,nickname:id,email:id+'@example.test',phone:'138'+String(i).padStart(8,'0'),planId:['transfer','member','member2','victim','leaver','dissolveMember','other','outsider','accept','decline','expired'].includes(id)?'free':'enterprise',status:'active',fileCleanup:{enabled:false,days:7}}]))
const boundaryUserId = 'u'.repeat(120)
users[boundaryUserId] = { id: boundaryUserId, username: 'id-boundary-fixture', nickname: 'ID边界用户', planId: 'free', status: 'active' }
for (const id of ['name-min', 'name-max', 'name-html', 'name-emoji', 'name-invalid', 'name-duplicate']) users[id] = { id, username: id, nickname: id, planId: 'enterprise', status: 'active' }
const org = (id, owner, members) => ({id,slug:id+'-slug',name:id+'团队',ownerUserId:owner,createdAt:now,updatedAt:now,members:[owner,...members].map(userId=>({id:'m-'+userId,userId,displayName:userId,role:userId===owner?'owner':'member',status:'active',joinedAt:now}))})
const organizations = Object.fromEntries([org('main','owner',['member','member2','transfer']),org('second','owner2',['other']),org('remove','removeOwner',['victim']),org('leave','leaveOwner',['leaver']),org('dissolve','dissolveOwner',['dissolveMember'])].map(o=>[o.id,o]))
for(const o of Object.values(organizations)) for(const m of o.members) Object.assign(users[m.userId],{organizationId:o.id,organizationRole:m.role})
organizations.main.members.push({id:'m-missing',userId:'missing-account',displayName:'失效账号',role:'member',status:'active',joinedAt:now})
const safe = fs.readFileSync(path.join(root,'测试数据/鲲穹文件传输测试数据包/01-安全文件集/TC-03-01-安全文本-可预览.txt'))
const makeShare = (id,ownerUserId,teamOrganizationId='') => ({id,code:id.toUpperCase(),manageToken:id+'-manage',ownerUserId,teamResource:!!teamOrganizationId,teamOrganizationId,status:'active',files:[{name:'safe.txt',storedName:'safe.txt',size:safe.length,reviewStatus:'clean',scanEngine:'clamav',scannedAt:now}],createdAt:now,expiresAt:future,downloadCount:0})
const shares = [makeShare('main-file','member','main'),makeShare('victim-team','victim','remove'),makeShare('victim-personal','victim'),makeShare('dissolve-team','dissolveMember','dissolve'),makeShare('dissolve-personal','dissolveMember'),makeShare('enterprise-personal','owner2'),makeShare('delete-own','member','main'),makeShare('delete-peer','member2','main'),makeShare('delete-race','member2','main'),makeShare('delete-cross','member','second'),makeShare('delete-personal','member'),makeShare('delete-removed','victim','remove')]
for (const id of ['controls-owner', 'controls-member', 'controls-admin', 'controls-peer', 'controls-closed', 'controls-limit', 'controls-file', 'controls-zip', 'controls-race', 'controls-attempts', 'controls-scan-password']) shares.push(makeShare(id, 'member', 'main'))
shares.find(s => s.id === 'controls-zip').files.push({ name: 'second.txt', storedName: 'second.txt', size: safe.length, reviewStatus: 'clean', scanEngine: 'clamav', scannedAt: now })
shares.find(s => s.id === 'delete-own').files.push({ name: 'second.txt', relativePath: 'folder/second.txt', storedName: 'second.txt', size: safe.length, reviewStatus: 'clean', scanEngine: 'clamav', scannedAt: now })
shares.find(s => s.id === 'delete-personal').ownerUserId = 'member2'
const records = { member: [{ id: 'my_sent:share:delete-own' }, { id: 'my_sent:share:main-file' }], owner: [{ id: 'sent_to_me:share:delete-own-manage' }, { id: 'sent_to_me:share:DELETE-OWN' }, { id: 'sent_to_me:share:main-file' }] }
shares.push(makeShare('delete-failure', 'member', 'main'), makeShare('delete-ownership', 'member2', 'main'), { ...makeShare('delete-closed', 'member', 'main'), status: 'closed' })
for (const action of ['preview', 'download', 'bundle']) shares.push(makeShare('scan-race-' + action, 'member', 'main'))
for (const action of ['preview', 'download', 'bundle']) shares.push({...makeShare('public-scan-race-' + action, 'member', 'main'),status:'closed'})
const blockedShare = makeShare('scan-blocked', 'member', 'main')
blockedShare.files[0].reviewStatus = 'blocked'
shares.push(blockedShare)
const collections = [{id:'task',token:'tasktoken',manageToken:'taskmanage',ownerUserId:'owner2',title:'TEAM collection',deadline:future,maxFileSizeMb:10,allowedTypes:['全部格式'],submissions:[],createdAt:now}]
fs.mkdirSync(path.join(fixture,'storage'),{recursive:true})
const metadataFile = path.join(fixture,'storage/metadata.json')
fs.writeFileSync(metadataFile,JSON.stringify({users,organizations,shares,collections,records,sessions:[...Object.values(users).map(user=>({id:user.id+'-session',user,expiresAt:future})),{id:'delete-expired-session',user:users.member,expiresAt:new Date(Date.now()-1000).toISOString()}],messages:{},upgradeOrders:[]}))
for(const share of shares){const dir=path.join(fixture,'storage/files',share.id);fs.mkdirSync(dir,{recursive:true});for(const file of share.files)fs.writeFileSync(path.join(dir,file.storedName),safe)}
let scans=0, holdScan=false, pendingScan=null
// 模拟 ClamAV INSTREAM 协议，验证实际上传和扫描调用；不是病毒引擎检出率测试。
const scanner=net.createServer(socket=>{let input=Buffer.alloc(0),command=false;socket.on('error',()=>{});socket.on('data',part=>{input=Buffer.concat([input,part]);if(!command){const end=input.indexOf(0);if(end<0)return;assert.equal(input.subarray(0,end).toString(),'zINSTREAM');input=input.subarray(end+1);command=true}while(input.length>=4){const n=input.readUInt32BE(0);if(input.length<n+4)return;input=input.subarray(n+4);if(!n){scans++;if(holdScan){holdScan=false;pendingScan=socket}else socket.end('stream: OK\0');return}}})})
await new Promise(r=>scanner.listen(0,'127.0.0.1',r))
let child,base,stderr='',passed=0,currentCase='',failures=[],cases=[],requests=[]
const cleanEnv={...process.env};for(const key of Object.keys(cleanEnv))if(/^(KUNQIONG_|OAUTH_)/.test(key))delete cleanEnv[key]
async function start(){const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));base='http://127.0.0.1:'+port;child=spawn(process.execPath,['server.mjs'],{cwd:fixture,windowsHide:true,env:{...cleanEnv,PORT:String(port),NODE_ENV:'production',KUNQIONG_DB_ENABLED:'false',KUNQIONG_HOST:'127.0.0.1',KUNQIONG_SCAN_MODE:'required',KUNQIONG_CLAMAV_HOST:'127.0.0.1',KUNQIONG_CLAMAV_PORT:String(scanner.address().port)},stdio:['ignore','ignore','pipe']});child.stderr.on('data',d=>stderr+=d);for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)return}catch{}await delay(50)}throw Error(stderr||'fixture did not start')}
async function stop(){if(!child||child.exitCode!==null)return;const ended=once(child,'exit');child.kill();await Promise.race([ended,delay(3000)])}
const stored=()=>readFixtureMetadata(metadataFile)
async function api(url,{user='owner',method='GET',body,headers={}}={}){const response=await fetch(base+url,{method,redirect:'manual',headers:{...(user?{cookie:`kunqiong_session=${user}-session`}:{}),...(body&&! (body instanceof FormData)?{'content-type':'application/json'}:{}),...headers},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});const bytes=Buffer.from(await response.arrayBuffer());let data;try{data=JSON.parse(bytes.toString())}catch{data={bytes:bytes.length}}requests.push({case:currentCase,method,url,user:user||'anonymous',status:response.status,response:JSON.parse(JSON.stringify(data,(k,v)=>/Token|sessionId|invitationId/.test(k)?'[redacted]':v))});return {status:response.status,data,bytes}}
function check(label,condition){if(condition){passed++;console.log('PASS '+currentCase+' '+label)}else{failures.push({id:currentCase,message:label});console.log('FAIL '+currentCase+' '+label)}}
async function group(id,fn){currentCase=id;const before=failures.length;try{await fn()}catch(e){failures.push({id,message:e.message});console.log('ERROR '+id+' '+e.stack)}cases.push({id,status:failures.length===before?'PASS':'FAIL'})}
const sessionBody=(name,size=safe.length)=>({mode:'team_resource',files:[{name,relativePath:name,size,mimeType:'text/plain'}],expiryDays:'0',downloadLimit:'unlimited'})
async function createUpload(user,name,size=safe.length){return api('/api/upload-sessions',{user,method:'POST',body:sessionBody(name,size)})}
async function chunks(user,sid,files=[{name:'safe.txt',content:safe}]){for(let i=0;i<files.length;i++){const fd=new FormData();fd.append('fileIndex',String(i));fd.append('chunkIndex','0');fd.append('totalChunks','1');fd.append('chunk',new Blob([files[i].content]),'chunk');const r=await api(`/api/upload-sessions/${sid}/chunks`,{user,method:'POST',body:fd});assert.equal(r.status,200,JSON.stringify(r.data))}}
async function invite(user){const r=await api('/api/account/workspace/members',{method:'POST',body:{userId:user}});assert.equal(r.status,201,JSON.stringify(r.data));return stored().organizations.main.members.find(m=>m.userId===user).invitationId}


try {
 await start();
 await group('TEAM-SHARE-CONTROLS', async () => {
  await api('/api/account/workspace/members/m-transfer/role', { method: 'PATCH', body: { role: 'admin' } })
  for (const [role, user] of [['owner', 'owner'], ['member', 'member'], ['admin', 'transfer']]) {
   const id = 'controls-' + role, manage = '/api/shares/manage/' + id + '-manage', publicBase = '/api/shares/' + id
   const patch = await api(manage, { user, method: 'PATCH', body: { password: 'team-secret', downloadLimit: '10' } })
   check(role + '密码和次数保存', patch.status === 200 && patch.data.share.requiresPassword && patch.data.share.downloadLimit === 10)
   check(role + '管理解锁未提供密码拒绝', (await api(manage + '/unlock', { user, method: 'POST', body: {} })).status === 403)
   for (const route of [manage + '/download', manage + '/files/0/download', manage + '/files/0/preview', publicBase + '/download', publicBase + '/files/0/download', publicBase + '/files/0/preview']) {
    check(role + '未解锁拒绝 ' + route, (await api(route, { user })).status === 403)
    check(role + '错误密码拒绝 ' + route, (await api(route, { user, headers: { 'x-share-password': 'wrong' } })).status === 401)
    check(role + '正确密码允许 ' + route, (await api(route, { user, method: 'HEAD', headers: { 'x-share-password': 'team-secret' } })).status === 200)
   }
   const head = await fetch(base + manage + '/download', { method: 'HEAD', headers: { cookie: `kunqiong_session=${user}-session`, 'x-share-password': 'team-secret' } })
   const cookies = head.headers.getSetCookie()
   check(role + '管理HEAD发放管理入口解锁凭证', cookies.some(c => c.includes('Path=/api/shares/manage/' + id + '-manage')))
   const cookie = cookies.map(c => c.split(';')[0]).join('; ')
   check(role + 'HEAD后原生GET可下载', (await api(manage + '/download', { user, headers: { cookie: `kunqiong_session=${user}-session; ${cookie}` } })).status === 200)
   await api(manage, { user, method: 'PATCH', body: { password: 'changed-secret' } })
   check(role + '修改密码使旧解锁失效', (await api(manage + '/files/0/preview', { user, headers: { cookie: `kunqiong_session=${user}-session; ${cookie}` } })).status === 403)
   check(role + '旧密码失效', (await api(publicBase + '/files/0/preview', { user, headers: { 'x-share-password': 'team-secret' } })).status === 401)
   await api(manage, { user, method: 'PATCH', body: { clearPassword: true } })
   check(role + '清除密码立即生效', (await api(manage + '/files/0/preview', { user })).status === 200)
   await api(manage, { user, method: 'PATCH', body: { password: '中文密码123' } })
   const unlocked = await fetch(base + manage + '/unlock', { method: 'POST', headers: { cookie: `kunqiong_session=${user}-session`, 'content-type': 'application/json' }, body: JSON.stringify({ password: '中文密码123' }) })
   const unlockedCookie = unlocked.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
   check(role + '中文密码JSON解锁管理预览', unlocked.ok && (await api(manage + '/files/0/preview', { user, headers: { cookie: `kunqiong_session=${user}-session; ${unlockedCookie}` } })).status === 200)
  }
  await api('/api/account/workspace/members/m-transfer/role', { method: 'PATCH', body: { role: 'member' } })
  const closed = '/api/shares/manage/controls-closed-manage'
  await api(closed, { method: 'PATCH', body: { status: 'closed', password: 'closed-secret', downloadLimit: '1' } })
  check('关闭公开分享后管理下载仍需密码', (await api(closed + '/download')).status === 403)
  check('关闭公开分享后正确密码可管理下载', (await api(closed + '/download', { headers: { 'x-share-password': 'closed-secret' } })).status === 200)
  check('关闭公开分享也不能绕过次数', (await api(closed + '/download', { headers: { 'x-share-password': 'closed-secret' } })).status === 410)
  await api('/api/shares/manage/controls-peer-manage', { method: 'PATCH', body: { password: 'peer-secret' } })
  const peerResource = (await api('/api/account/team/overview', { user: 'member2' })).data.resources.find(r => r.id === 'controls-peer')
  check('普通成员有解锁入口且无管理凭证', peerResource?.code === 'CONTROLS-PEER' && !peerResource.manageToken)
  check('普通成员无密码不能预览', (await api('/api/shares/controls-peer/files/0/preview', { user: 'member2' })).status === 403)
  check('普通成员错误密码不能解锁', (await api('/api/shares/lookup/CONTROLS-PEER', { user: 'member2', method: 'POST', body: { password: 'wrong' } })).status === 401)
  const unlockedPeer = await fetch(base + '/api/shares/lookup/CONTROLS-PEER', { method: 'POST', headers: { cookie: 'kunqiong_session=member2-session', 'content-type': 'application/json' }, body: JSON.stringify({ password: 'peer-secret' }) })
  const peerCookie = unlockedPeer.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
  check('普通成员解锁不泄漏管理令牌', unlockedPeer.headers.getSetCookie().every(c => !c.includes('controls-peer-manage')))
  check('普通成员可通过密码解锁预览', unlockedPeer.ok && (await api('/api/shares/controls-peer/files/0/preview', { user: 'member2', headers: { cookie: 'kunqiong_session=member2-session; ' + peerCookie } })).status === 200)
  check('解锁密码不提升管理权限', (await api('/api/shares/manage/controls-peer-manage/download', { user: 'member2', headers: { cookie: 'kunqiong_session=member2-session; ' + peerCookie } })).status === 403)
  for (const [id, first] of [['controls-limit', '/download'], ['controls-file', '/files/0/download'], ['controls-zip', '/download']]) {
   const manage = '/api/shares/manage/' + id + '-manage'
   await api(manage, { user: 'member', method: 'PATCH', body: { downloadLimit: '1' } })
   check(id + 'HEAD不占用次数', (await api(manage + first, { method: 'HEAD' })).status === 200 && stored().shares.find(s => s.id === id).downloadCount === 0)
   check(id + '预览不占用次数', (await api(manage + '/files/0/preview')).status === 200 && stored().shares.find(s => s.id === id).downloadCount === 0)
   if (id !== 'controls-zip') check(id + '无效Range不占用次数', (await api(manage + first, { headers: { range: 'bytes=999999999-' } })).status === 416)
   check(id + '首次下载成功', (await api(manage + first)).status === 200)
   for (let attempt = 0; attempt < 100 && stored().shares.find(s => s.id === id).downloadCount !== 1; attempt++) await delay(10)
   check(id + '下载计数持久化', stored().shares.find(s => s.id === id).downloadCount === 1)
   for (const route of [manage + '/download', manage + '/files/0/download', '/api/shares/' + id + '/download', '/api/shares/' + id + '/files/0/download']) check(id + '所有入口共享最后一次额度 ' + route, (await api(route, { user: 'member' })).status === 410)
  }
  const race = '/api/shares/manage/controls-race-manage'
  await api(race, { method: 'PATCH', body: { downloadLimit: '1' } })
  const downloads = await Promise.all([race + '/download', race + '/files/0/download', '/api/shares/controls-race/download', '/api/shares/controls-race/files/0/download'].map(route => api(route)))
  check('管理和公开入口并发仅一次成功', downloads.filter(r => r.status === 200).length === 1 && downloads.filter(r => r.status === 410).length === 3)
  const attempts = '/api/shares/manage/controls-attempts-manage'
  await api(attempts, { method: 'PATCH', body: { password: 'secret' } })
  for (let i=0; i<8; i++) check('第'+(i+1)+'次错误密码被拒绝', (await api(attempts + '/unlock', { method: 'POST', body: { password: 'wrong' } })).status === 401)
  check('管理密码校验有错误次数限制', (await api(attempts + '/unlock', { method: 'POST', body: { password: 'secret' } })).status === 429)
  holdScan=true
  const scanning=api('/api/shares/manage/controls-scan-password-manage/download')
  for(let i=0;i<100&&!pendingScan;i++)await delay(20)
  assert.ok(pendingScan,'下载扫描进入等待')
  await api('/api/shares/manage/controls-scan-password-manage', { method: 'PATCH', body: { password: 'new-secret' } })
  pendingScan.end('stream: OK\0');pendingScan=null
  check('扫描期间新增密码在发送前生效', (await scanning).status===403)
  await stop(); await start()
  check('重启仍保留次数限制', (await api('/api/shares/manage/controls-limit-manage/download')).status === 410)
  check('重启仍需密码', (await api('/api/shares/manage/controls-peer-manage/download')).status === 403)
  check('重启后正确密码有效', (await api('/api/shares/manage/controls-peer-manage/download', { headers: { 'x-share-password': 'peer-secret' } })).status === 200)
 })
 await group('TEAM-PRIVACY',async()=>{
  await invite('accept');
  for(const route of ['/api/account/workspace','/api/account/team/overview']){
   const r=await api(route,{user:'member2'});const roster=r.data.organization.members;
   check('成员不获得待邀请人员 '+route,!roster.some(m=>m.userId==='accept'));
   check('成员不获得邀请凭证 '+route,roster.every(m=>!m.invitationId&&!m.joinRequestId&&!m.joinMessage));
   check('他人手机邮箱脱敏 '+route,roster.filter(m=>m.userId!=='member2').every(m=>m.email!==users[m.userId]?.email&&m.phone!==users[m.userId]?.phone));
   if(r.data.memberUsage)check('用量列表同步脱敏',r.data.memberUsage.filter(m=>m.userId!=='member2').every(m=>m.email!==users[m.userId]?.email&&m.phone!==users[m.userId]?.phone));
  }
 });
 await group('TEAM-MANAGER-FILE-ACCESS',async()=>{
  for(const action of ['preview','download'])check('所有者可管理成员文件 '+action,(await api('/api/shares/manage/main-file-manage/files/0/'+action)).status===200);
  await api('/api/shares/manage/main-file-manage',{user:'member',method:'PATCH',body:{status:'closed'}});
  check('所有者可管理下载关闭资源',(await api('/api/shares/manage/main-file-manage/download')).status===200);
  check('所有者可预览关闭资源',(await api('/api/shares/main-file/files/0/preview')).status===200);
  check('普通他人成员不能管理文件',(await api('/api/shares/manage/main-file-manage/files/0/preview',{user:'member2'})).status===403);
  for (const [user, status] of [['',401],['owner2',403],['member2',403]]) check('整包管理下载拒绝越权 '+(user||'游客'),(await api('/api/shares/manage/main-file-manage/download',{user})).status===status);
  check('管理下载仍阻止安全拦截文件',(await api('/api/shares/manage/scan-blocked-manage/download')).status===415);
  const zip = await api('/api/shares/manage/delete-own-manage/download');
  check('所有者可打包成员多文件',zip.status===200&&zip.bytes.subarray(0,2).toString()==='PK');
  // Use a separate directed session to exercise actual recipient resolution.
  const directed=await api('/api/upload-sessions',{user:'member',method:'POST',body:{...sessionBody('directed-only.txt'),recipients:'member2'}});
  await chunks('member',directed.data.sessionId,[{name:'directed-only.txt',content:safe}]);
  const done=await api('/api/upload-sessions/'+directed.data.sessionId+'/complete',{user:'member',method:'POST',body:{}});assert.equal(done.status,201);
  const token=done.data.share.manageToken;
  check('所有者可管理定向团队资源',(await api('/api/shares/manage/'+token)).status===200);
  check('所有者可关闭定向团队资源',(await api('/api/shares/manage/'+token,{method:'PATCH',body:{status:'closed'}})).status===200);
  check('跨团队仍禁止访问',(await api('/api/shares/manage/'+token,{user:'owner2'})).status===403);
 });
 await group('TEAM-RECORD-PURGE',async()=>{
  await api('/api/shares/manage/victim-team-manage',{user:'victim',method:'PATCH',body:{status:'closed'}});
  await api('/api/account/workspace/members/m-victim',{user:'removeOwner',method:'DELETE'});
  const result=await api('/api/account/records',{user:'victim',method:'DELETE',body:{ids:['my_sent:share:victim-team']}});
  check('移除成员删除记录不清团队资源',result.status===200&&!result.data.purged.some(x=>x.id==='victim-team')&&stored().shares.some(s=>s.id==='victim-team'));
  check('团队文件仍保留',fs.existsSync(path.join(fixture,'storage/files/victim-team')));
 });
 await group('TEAM-ADMIN-ROLE',async()=>{
  const roleUrl='/api/account/workspace/members/m-transfer/role';
  check('普通成员不能任命管理员',(await api(roleUrl,{user:'member',method:'PATCH',body:{role:'admin'}})).status===403);
  const grant=await api(roleUrl,{method:'PATCH',body:{role:'admin'}});check('所有者可任命管理员',grant.status===200);if(grant.status!==200)return;
  const overview=await api('/api/account/team/overview',{user:'transfer'});
  check('管理员获得管理权且非所有者',overview.data.canManage===true&&overview.data.isOwner===false);
  const me = (await api('/api/auth/me',{user:'transfer'})).data.user;
  check('管理员任命不提升个人套餐',me.planId==='free'&&me.plan.id==='free'&&stored().users.transfer.planId==='free');
  check('基础套餐管理员保留团队权益',me.teamEntitlement.role==='admin'&&me.teamEntitlement.canManage===true&&me.teamEntitlement.canUseTeamSpace===true);
  check('管理员可检索邀请候选',(await api('/api/account/workspace/member-search?q=candidate',{user:'transfer'})).status===200);
  check('管理员可邀请成员',(await api('/api/account/workspace/members',{user:'transfer',method:'POST',body:{userId:'candidate0'}})).status===201);

  await api('/api/organizations/main-slug/join-request',{user:'candidate1',method:'POST',body:{message:'加入'}});
  const request=stored().organizations.main.members.find(member=>member.userId==='candidate1');
  check('普通成员不能审批',(await api('/api/account/workspace/join-requests/'+request.joinRequestId,{user:'member',method:'POST',body:{decision:'approve'}})).status===403);
  check('管理员可审批入团',(await api('/api/account/workspace/join-requests/'+request.joinRequestId,{user:'transfer',method:'POST',body:{decision:'approve'}})).status===200);
  await api('/api/account/workspace/members/'+request.id+'/role',{method:'PATCH',body:{role:'admin'}});
  check('管理员不能移除同级管理员',(await api('/api/account/workspace/members/'+request.id,{user:'transfer',method:'DELETE'})).status===403);
  check('管理员不能移除所有者',(await api('/api/account/workspace/members/m-owner',{user:'transfer',method:'DELETE'})).status===400);
  check('跨团队不能任命角色',(await api('/api/account/workspace/members/m-other/role',{method:'PATCH',body:{role:'admin'}})).status===404);
  check('管理员可预览成员文件',(await api('/api/shares/manage/main-file-manage/files/0/preview',{user:'transfer'})).status===200);
  check('管理员不能访问他人个人资源',(await api('/api/shares/manage/victim-personal-manage/files/0/preview',{user:'transfer'})).status===403);

  check('管理员可移除普通成员',(await api('/api/account/workspace/members/m-member2',{user:'transfer',method:'DELETE'})).status===200);
  check('管理员可管理团队资源',(await api('/api/shares/manage/main-file-manage',{user:'transfer'})).status===200);
  for(const [url,body] of [['/api/account/workspace/dissolve',{}],['/api/account/workspace/transfer-ownership',{targetMemberId:'m-member'}]])check('管理员不能所有权操作 '+url,(await api(url,{user:'transfer',method:'POST',body})).status===403);
  check('管理员不能修改团队名',(await api('/api/account/workspace',{user:'transfer',method:'PATCH',body:{name:'forbidden'}})).status===403);
  check('管理员不能任免角色',(await api('/api/account/workspace/members/m-member/role',{user:'transfer',method:'PATCH',body:{role:'admin'}})).status===403);
  for(const value of ['owner','invalid',['admin'],null])check('非法角色拒绝 '+JSON.stringify(value),(await api(roleUrl,{method:'PATCH',body:{role:value}})).status===400);
  for (const body of [{}, {role:'admin',ownerUserId:'owner2'}, ['admin']]) check('角色请求结构拒绝 '+JSON.stringify(body),(await api(roleUrl,{method:'PATCH',body})).status===400);
  const invalidMember = (await api('/api/account/team/overview')).data.memberUsage.find(member=>member.id==='m-missing');
  check('失效账号无任命或转让入口',invalidMember.canChangeRole===false&&invalidMember.canTransfer===false);
  check('失效账号不能任命',(await api('/api/account/workspace/members/m-missing/role',{method:'PATCH',body:{role:'admin'}})).status===400);
  check('不能调整所有者角色',(await api('/api/account/workspace/members/m-owner/role',{method:'PATCH',body:{role:'member'}})).status===400);
  check('不能任命待加入成员',(await api('/api/account/workspace/members/'+stored().organizations.main.members.find(m=>m.userId==='candidate0').id+'/role',{method:'PATCH',body:{role:'admin'}})).status===400);
  await stop();await start();check('管理员角色重启持久化',(await api('/api/account/team/overview',{user:'transfer'})).data.canManage===true&&stored().organizations.main.members.find(m=>m.userId==='transfer').role==='admin');
  check('所有者可撤销管理员',(await api(roleUrl,{method:'PATCH',body:{role:'member'}})).status===200);
  check('撤销后旧管理令牌失效',(await api('/api/shares/manage/main-file-manage',{user:'transfer'})).status===403);
  check('旧会话管理权立即撤回',(await api('/api/account/workspace/member-search?q=candidate',{user:'transfer'})).status===403);
 });
 await group('TEAM-SCAN-REVOCATION',async()=>{
  const roleUrl='/api/account/workspace/members/m-transfer/role';
  for (const action of ['preview','download','bundle']) {
   assert.equal((await api(roleUrl,{method:'PATCH',body:{role:'admin'}})).status,200);
   holdScan=true;
   const suffix=action==='bundle'?'/download':'/files/0/'+action;
   const reading=api('/api/shares/manage/scan-race-'+action+'-manage'+suffix,{user:'transfer'});
   for(let n=0;n<100&&!pendingScan;n++)await delay(20);
   assert.ok(pendingScan,'扫描应进入等待状态');
   assert.equal((await api(roleUrl,{method:'PATCH',body:{role:'member'}})).status,200);
   pendingScan.end('stream: OK\0');pendingScan=null;
   check('扫描期间撤权不返回文件 '+action,(await reading).status===403);
  }
  for (const action of ['preview','download','bundle']) {
   assert.equal((await api(roleUrl,{method:'PATCH',body:{role:'admin'}})).status,200);
   holdScan=true;
   const suffix=action==='bundle'?'/download':'/files/0/'+action;
   const reading=api('/api/shares/public-scan-race-'+action+suffix,{user:'transfer'});
   for(let n=0;n<100&&!pendingScan;n++)await delay(20);
   assert.ok(pendingScan,'公开入口扫描应进入等待状态');
   assert.equal((await api(roleUrl,{method:'PATCH',body:{role:'member'}})).status,200);
   pendingScan.end('stream: OK\0');pendingScan=null;
   check('公开入口扫描期间撤权不读取关闭文件 '+action,(await reading).status===410);
  }
 });
 await group('TEAM-UPLOAD-REVOCATION',async()=>{
  const pending=await createUpload('member','revoked-upload.txt');assert.equal(pending.status,201);await chunks('member',pending.data.sessionId,[{name:'revoked-upload.txt',content:safe}]);
  const sharesBefore=stored().shares.length;
  const directoriesBefore=fs.readdirSync(path.join(fixture,'storage/files')).sort();
  await api('/__permission_upload_gate',{method:'POST',body:{arm:true}});
  const completing=api('/api/upload-sessions/'+pending.data.sessionId+'/complete',{user:'member',method:'POST',body:{}});
  let waiting=false;for(let n=0;n<50;n++){if((await api('/__permission_upload_gate',{method:'POST',body:{probe:true}})).data.waiting){waiting=true;break}await delay(20)}assert.ok(waiting);
  await api('/api/account/workspace/members/m-member',{method:'DELETE'});
  await api('/__permission_upload_gate',{method:'POST',body:{release:true}});
  const result=await completing;
  check('完成前撤权拒绝发布',result.status===403);
  check('撤权后没有新资源',stored().shares.length===sharesBefore);
  check('撤权后没有孤立文件目录',JSON.stringify(fs.readdirSync(path.join(fixture,'storage/files')).sort())===JSON.stringify(directoriesBefore));
 });
 await group('TEAM-DISABLED-TRANSFER',async()=>{
  await api('/__permission_fixture',{method:'POST',body:{userStatus:{id:'transfer',status:'disabled'}}});
  check('禁用账号不能任命',(await api('/api/account/workspace/members/m-transfer/role',{method:'PATCH',body:{role:'admin'}})).status===400);
  check('禁用账号不能接管',(await api('/api/account/workspace/transfer-ownership',{method:'POST',body:{targetMemberId:'m-transfer'}})).status===400&&stored().organizations.main.ownerUserId==='owner');
  check('原所有者权限保留',(await api('/api/account/workspace',{method:'PATCH',body:{name:'still-managed'}})).status===200);
 });
}finally{pendingScan?.destroy();await stop();await new Promise(resolve=>scanner.close(resolve));}
const report={executedAt:new Date().toISOString(),passed,failures,cases,fixture,requests};fs.mkdirSync(path.join(root,'.workbuddy/team-permissions'),{recursive:true});fs.writeFileSync(path.join(root,'.workbuddy/team-permissions/results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,requests:undefined},null,2));process.exitCode=failures.length?1:0;
