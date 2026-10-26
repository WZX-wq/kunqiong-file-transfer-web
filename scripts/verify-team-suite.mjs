// TEAM-001–013：真实接口和磁盘持久化，一次性副本中的合成账号，不操作真实团队。
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
const control = `
const { default: fixtureFs } = await import('node:fs');
const fixtureRm = fixtureFs.promises.rm;
let failResourceRemoval = false;
fixtureFs.promises.rm = async (directory, ...args) => {
 if (failResourceRemoval && String(directory).endsWith('delete-failure')) { failResourceRemoval = false; const error = new Error('fixture: storage cannot remove resource'); error.code = 'EACCES'; throw error; }
 return fixtureRm(directory, ...args);
};
app.post('/__team_fixture', async (req, res) => {
 const { metadata, persistMetadata } = await import('./server/lib/metadata-store.js');
 if (req.body.purgeExpiredTrash) { const { purgeExpiredTrash } = await import('./server/services/trash.js'); purgeExpiredTrash(); }
 if (req.body.expireInvitation) for (const org of Object.values(metadata.organizations)) for (const member of org.members) if (member.invitationId === req.body.expireInvitation) { member.invitedAt = new Date(Date.now()-8*86400000).toISOString(); member.invitationExpiresAt = new Date(Date.now()-1).toISOString(); }
 if (req.body.expireTrashResourceId) { const share = metadata.shares.find(item => item.id === req.body.expireTrashResourceId); if (share?.deletedAt) share.trashExpiresAt = new Date(Date.now()-1).toISOString(); }
 if (req.body.extendTrashResourceId) { const share = metadata.shares.find(item => item.id === req.body.extendTrashResourceId); if (share?.deletedAt) share.trashExpiresAt = new Date(Date.now()+7*86400000).toISOString(); }
 if (req.body.quota !== undefined) { metadata.shares = metadata.shares.filter(s=>s.id!=='quota-filler'); if (req.body.quota < 1024**4) metadata.shares.push({id:'quota-filler',ownerUserId:'transfer',teamResource:true,teamOrganizationId:'main',status:'active',createdAt:new Date().toISOString(),files:[{name:'quota-filler.bin',size:1024**4-req.body.quota}]}); }
 if (req.body.failResourceRemoval) failResourceRemoval = true;
 persistMetadata(); res.json({ok:true});
});
`
fs.writeFileSync(path.join(fixture, 'server.mjs'), fs.readFileSync(path.join(root, 'server.mjs'), 'utf8').replace('registerWorkspaceRoutes(app)', control + '\nregisterWorkspaceRoutes(app)'))
const now = new Date().toISOString(), future = new Date(Date.now() + 30*86400000).toISOString()
const ids = ['owner','member','member2','transfer','owner2','other','removeOwner','victim','leaveOwner','leaver','dissolveOwner','dissolveMember','outsider','accept','decline','expired','create','empty','long','control','duplicate',...Array.from({length:12},(_,i)=>'candidate'+i)]
const users = Object.fromEntries(ids.map((id,i)=>[id,{id,username:id,nickname:id,email:id+'@example.test',phone:'138'+String(i).padStart(8,'0'),planId:['member','member2','transfer','victim','leaver','dissolveMember','other','outsider','accept','decline','expired'].includes(id)?'free':'enterprise',status:'active',fileCleanup:{enabled:false,days:7}}]))
const boundaryUserId = 'u'.repeat(120)
users[boundaryUserId] = { id: boundaryUserId, username: 'id-boundary-fixture', nickname: 'ID边界用户', planId: 'free', status: 'active' }
for (const id of ['name-min', 'name-max', 'name-html', 'name-emoji', 'name-invalid', 'name-duplicate']) users[id] = { id, username: id, nickname: id, planId: 'enterprise', status: 'active' }
const org = (id, owner, members) => ({id,slug:id+'-slug',name:id+'团队',ownerUserId:owner,teamPlanId:users[owner].planId,teamPlanStartedAt:now,teamPlanExpiresAt:users[owner].planId==='free'?null:future,createdAt:now,updatedAt:now,members:[owner,...members].map(userId=>({id:'m-'+userId,userId,displayName:userId,role:userId===owner?'owner':'member',status:'active',joinedAt:now}))})
const organizations = Object.fromEntries([org('main','owner',['member','member2','transfer']),org('second','owner2',['other']),org('remove','removeOwner',['victim']),org('leave','leaveOwner',['leaver']),org('dissolve','dissolveOwner',['dissolveMember'])].map(o=>[o.id,o]))
for(const o of Object.values(organizations)) for(const m of o.members) Object.assign(users[m.userId],{organizationId:o.id,organizationRole:m.role})
const safe = fs.readFileSync(path.join(root,'测试数据/鲲穹文件传输测试数据包/01-安全文件集/TC-03-01-安全文本-可预览.txt'))
const makeShare = (id,ownerUserId,teamOrganizationId='') => ({id,code:id.toUpperCase(),manageToken:id+'-manage',ownerUserId,teamResource:!!teamOrganizationId,teamOrganizationId,status:'active',files:[{name:'safe.txt',storedName:'safe.txt',size:safe.length,reviewStatus:'clean',scanEngine:'clamav',scannedAt:now}],createdAt:now,expiresAt:future,downloadCount:0})
const shares = [makeShare('main-file','member','main'),makeShare('victim-team','victim','remove'),makeShare('victim-personal','victim'),makeShare('dissolve-team','dissolveMember','dissolve'),makeShare('dissolve-personal','dissolveMember'),makeShare('enterprise-personal','owner2'),makeShare('delete-own','member','main'),makeShare('delete-peer','member2','main'),makeShare('delete-race','member2','main'),makeShare('delete-cross','member','second'),makeShare('delete-personal','member'),makeShare('delete-removed','victim','remove')]
shares.find(s => s.id === 'delete-own').files.push({ name: 'second.txt', relativePath: 'folder/second.txt', storedName: 'second.txt', size: safe.length, reviewStatus: 'clean', scanEngine: 'clamav', scannedAt: now })
shares.find(s => s.id === 'delete-personal').ownerUserId = 'member2'
const records = { member: [{ id: 'my_sent:share:delete-own' }, { id: 'my_sent:share:main-file' }], owner: [{ id: 'sent_to_me:share:delete-own-manage' }, { id: 'sent_to_me:share:DELETE-OWN' }, { id: 'sent_to_me:share:main-file' }] }
shares.push(makeShare('delete-failure', 'member', 'main'), makeShare('delete-ownership', 'member2', 'main'), { ...makeShare('delete-closed', 'member', 'main'), status: 'closed' })
const collections = [{id:'task',token:'tasktoken',manageToken:'taskmanage',ownerUserId:'owner2',title:'TEAM collection',deadline:future,maxFileSizeMb:10,allowedTypes:['全部格式'],submissions:[],createdAt:now}]
fs.mkdirSync(path.join(fixture,'storage'),{recursive:true})
const metadataFile = path.join(fixture,'storage/metadata.json')
fs.writeFileSync(metadataFile,JSON.stringify({users,organizations,shares,collections,records,sessions:[...Object.values(users).map(user=>({id:user.id+'-session',user,expiresAt:future})),{id:'delete-expired-session',user:users.member,expiresAt:new Date(Date.now()-1000).toISOString()}],messages:{},upgradeOrders:[]}))
for(const share of shares){const dir=path.join(fixture,'storage/files',share.id);fs.mkdirSync(dir,{recursive:true});for(const file of share.files)fs.writeFileSync(path.join(dir,file.storedName),safe)}
let scans=0
// 模拟 ClamAV INSTREAM 协议，验证实际上传和扫描调用；不是病毒引擎检出率测试。
const scanner=net.createServer(socket=>{let input=Buffer.alloc(0),command=false;socket.on('error',()=>{});socket.on('data',part=>{input=Buffer.concat([input,part]);if(!command){const end=input.indexOf(0);if(end<0)return;assert.equal(input.subarray(0,end).toString(),'zINSTREAM');input=input.subarray(end+1);command=true}while(input.length>=4){const n=input.readUInt32BE(0);if(input.length<n+4)return;input=input.subarray(n+4);if(!n){scans++;socket.end('stream: OK\0');return}}})})
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
try{
 await start()
 await group('TEAM-INPUT-LIMITS', async () => {
  const before = stored().organizations.main.members.length
  for (const body of [
   { target: 'x'.repeat(161) },
   { target: 'x'.repeat(160) + ' ' },
   { userId: boundaryUserId + 'x' },
   { target: 'accept\u0000' },
   { target: ['accept'] },
  ]) {
   const result = await api('/api/account/workspace/members', { method: 'POST', body })
   check('非法邀请输入明确拒绝 ' + JSON.stringify(body).slice(0, 35), result.status === 400)
  }
  check('非法邀请不增加成员或邀请', stored().organizations.main.members.length === before)
  check('160字符邀请目标无需截断且正常查找', (await api('/api/account/workspace/members', { method: 'POST', body: { target: 'x'.repeat(160) } })).status === 404)
  check('120字符账号ID可正常邀请', (await api('/api/account/workspace/members', { method: 'POST', body: { userId: boundaryUserId } })).status === 201)
  for (const query of ['x'.repeat(161), 'x'.repeat(160) + ' ']) check('超长搜索拒绝 ' + query.length, (await api('/api/account/workspace/member-search?q=' + encodeURIComponent(query))).status === 400)
  check('160字符搜索正常处理', (await api('/api/account/workspace/member-search?q=' + 'x'.repeat(160))).status === 200)
 })
 await group('TEAM-NAME-BOUNDARIES', async () => {
  const before = Object.keys(stored().organizations).length
  for (const name of ['', '   ', '名'.repeat(81), '名'.repeat(79) + '😀', 'name\n', 'name\u0000', null, ['team']]) {
   check('非法创建名称拒绝 ' + JSON.stringify(name).slice(0, 20), (await api('/api/account/workspace', { user: 'name-invalid', method: 'POST', body: { name } })).status === 400)
  }
  check('非法创建不产生组织或账号归属', Object.keys(stored().organizations).length === before && !stored().users['name-invalid'].organizationId)
  for (const [user, name] of [['name-min', '一'], ['name-max', '名'.repeat(80)], ['name-html', '<img src=x onerror=alert(1)>'], ['name-emoji', '名'.repeat(78) + '😀']]) {
   const result = await api('/api/account/workspace', { user, method: 'POST', body: { name } })
   check('合法名称边界完整创建 ' + user, result.status === 201 && result.data.organization.name === name)
  }
  check('重复名称去空白后拒绝', (await api('/api/account/workspace', { user: 'name-duplicate', method: 'POST', body: { name: ' 一 ' } })).status === 409)
  const snapshot = (await api('/api/account/workspace', { user: 'name-max' })).data.organization
  for (const name of ['', '   ', '名'.repeat(81), 'name\u007f', ['team']]) check('修改非法名称拒绝', (await api('/api/account/workspace', { user: 'name-max', method: 'PATCH', body: { name } })).status === 400)
  check('失败修改保留原名和ID', (await api('/api/account/workspace', { user: 'name-max' })).data.organization.name === snapshot.name)
  check('修改为重复名称拒绝', (await api('/api/account/workspace', { user: 'name-max', method: 'PATCH', body: { name: '一' } })).status === 409)
  await stop(); await start()
  const after = (await api('/api/account/workspace', { user: 'name-max' })).data.organization
  check('80字符名称重启后完整且ID/slug稳定', after.name === snapshot.name && after.id === snapshot.id && after.slug === snapshot.slug)
 })
 await group('TEAM-001',async()=>{for(const url of ['/api/account/workspace','/api/account/team/overview','/api/account/workspace/member-search?q=owner']){const r=await api(url,{user:''});check('游客拒绝 '+url,r.status===401&&!JSON.stringify(r.data).includes('main团队'))}})
 await group('TEAM-002',async()=>{
  for(const [user,name] of [['empty','  '],['long','名'.repeat(81)],['control','name\u0000']])check('异常名称拒绝 '+user,(await api('/api/account/workspace',{user,method:'POST',body:{name}})).status===400)
  const valid=await api('/api/account/workspace',{user:'create',method:'POST',body:{name:'TEAM合法团队'}});check('合法创建',valid.status===201);assert.ok(valid.data.organization);check('slug唯一',new Set(Object.values(stored().organizations).map(o=>o.slug)).size===Object.keys(stored().organizations).length)
  check('重复名称拒绝',(await api('/api/account/workspace',{user:'duplicate',method:'POST',body:{name:'TEAM合法团队'}})).status===409)
  check('同账号重复创建拒绝',(await api('/api/account/workspace',{user:'create',method:'POST',body:{name:'另一个团队'}})).status===409)
  check('创建后的邀请入口可探测',(await api('/api/organizations/'+valid.data.organization.slug+'/join-request',{user:''})).data.reason==='anonymous')
 })
 await group('TEAM-003',async()=>{
  const before=stored().organizations.main
  check('普通成员不能修改团队名称',(await api('/api/account/workspace',{user:'member',method:'PATCH',body:{name:'无权改名'}})).status===403)
  check('拒绝改名后原名保留',stored().organizations.main.name===before.name)
  const r=await api('/api/account/workspace',{method:'PATCH',body:{name:'TEAM重命名'}})
  check('名称修改',r.status===200)
  await stop();await start()
  const after=(await api('/api/account/workspace')).data.organization
  check('重启持久化且ID slug不变',after.name==='TEAM重命名'&&after.id===before.id&&after.slug===before.slug)
  check('邀请入口名称同步',(await api('/api/organizations/main-slug/join-request',{user:''})).data.organizationName===after.name)
  check('资源归属不变',stored().shares.find(s=>s.id==='main-file').teamOrganizationId==='main')
  check('修改超长拒绝',(await api('/api/account/workspace',{method:'PATCH',body:{name:'a'.repeat(81)}})).status===400)
 })
 await group('TEAM-TRASH-ENDPOINT', async () => {
  check('游客不能读取团队回收站', (await api('/api/account/team/trash', { user: '' })).status === 401)
  const manager = await api('/api/account/team/trash')
  check('团队管理员可加载回收站及保留期限', manager.status === 200 && Array.isArray(manager.data.items) && manager.data.retentionDays === 7)
  const member = await api('/api/account/team/trash', { user: 'member' })
  check('普通成员可加载自己有权查看的回收站', member.status === 200 && Array.isArray(member.data.items))
 })
 await group('TEAM-RESOURCE-DELETE', async () => {
  const ownUrl = '/api/account/team/resources/delete-own'
  const trashUrl = '/api/account/team/trash'
  const before = (await api('/api/account/team/overview')).data
  const ownerResources = before.resources
  const memberResources = (await api('/api/account/team/overview', { user: 'member' })).data.resources
  check('所有者可删除团队资源', ownerResources.every(r => r.canDelete === true))
  check('普通成员仅可删除本人上传资源', memberResources.every(r => r.canDelete === (r.ownerUserId === 'member')))
  const snapshot = JSON.stringify(stored().shares)
  for (const [label, url, options, status] of [
   ['游客', ownUrl, { user: '' }, 401],
   ['无效会话', ownUrl, { user: 'no-session' }, 401],
   ['过期会话', ownUrl, { user: 'delete-expired' }, 401],
   ['他人资源和伪造上传者', ownUrl, { user: 'member2', body: { ownerUserId: 'member2', canDelete: true, manageToken: 'delete-own-manage' } }, 403],
   ['跨团队所有者', ownUrl, { user: 'owner2' }, 404],
   ['跨团队上传者', '/api/account/team/resources/delete-cross', { user: 'member' }, 404],
   ['个人资源', '/api/account/team/resources/delete-personal', { user: 'member2' }, 404],
   ['尚未入团账号', ownUrl, { user: 'decline' }, 404],
   ['跨域来源', ownUrl, { user: 'owner', headers: { origin: 'https://evil.example.test', 'sec-fetch-site': 'cross-site' } }, 403],
  ]) check(label + '删除拒绝', (await api(url, { method: 'DELETE', ...options })).status === status)
  check('GET不执行删除', (await api(ownUrl)).status === 404)
  check('非法请求不改变资源或文件', JSON.stringify(stored().shares) === snapshot && fs.existsSync(path.join(fixture, 'storage/files/delete-own/second.txt')))
  const own = await api(ownUrl, { user: 'member', method: 'DELETE' })
  check('上传者可将本人整组文件移入回收站', own.status === 200 && own.data.deletedResourceId === 'delete-own' && own.data.deletedFileCount === 2 && own.data.releasedBytes === 0 && own.data.retainedBytes === safe.length * 2)
  const trashedOwn = stored().shares.find(s => s.id === 'delete-own')
  check('删除写入7天保留标记且保留文件', Boolean(trashedOwn?.deletedAt && trashedOwn?.trashExpiresAt) && Date.parse(trashedOwn.trashExpiresAt) - Date.parse(trashedOwn.deletedAt) === 7 * 86400000 && fs.existsSync(path.join(fixture, 'storage/files/delete-own/second.txt')))
  const afterSoftDelete = (await api('/api/account/team/overview')).data
  check('移入回收站后仍占团队和成员容量', before.capacity.usedBytes === afterSoftDelete.capacity.usedBytes && before.memberUsage.find(m => m.userId === 'member').usedBytes === afterSoftDelete.memberUsage.find(m => m.userId === 'member').usedBytes)
  check('团队文件列表隐藏已删除资源', !afterSoftDelete.resources.some(r => r.id === 'delete-own') && own.data.capacity?.usedBytes === afterSoftDelete.capacity.usedBytes)
  const managerTrash = await api(trashUrl)
  const memberTrash = await api(trashUrl, { user: 'member' })
  const peerTrash = await api(trashUrl, { user: 'member2' })
  check('团队管理者可看到回收站资源但不拿到管理凭证', managerTrash.status === 200 && managerTrash.data.items.some(item => item.id === 'delete-own' && item.canDelete && !Object.hasOwn(item, 'manageToken') && !Object.hasOwn(item, 'code')))
  check('普通成员只看到自己上传的回收站资源', memberTrash.data.items.some(item => item.id === 'delete-own' && item.canRestore && !item.canDelete) && !peerTrash.data.items.some(item => item.id === 'delete-own'))
  check('非上传者成员不能恢复该回收站资源', (await api(`${trashUrl}/delete-own/restore`, { user: 'member2', method: 'POST' })).status === 403)
  const crossOriginRestore = await api(`${trashUrl}/delete-own/restore`, { user: 'member', method: 'POST', headers: { origin: 'https://evil.example.test', 'sec-fetch-site': 'cross-site' } })
  check('跨站恢复请求拒绝且资源仍在回收站', crossOriginRestore.status === 403 && stored().shares.find(s => s.id === 'delete-own')?.deletedAt)
  for (const url of ['/api/shares/token/delete-own', '/api/shares/manage/delete-own-manage', '/api/shares/delete-own/files/0/preview', '/api/shares/delete-own/files/0/download', '/api/shares/delete-own/download']) check('删除后原链接失效 ' + url, (await api(url, { user: 'member' })).status === 404)
  await api('/__team_fixture', { method: 'POST', body: { expireTrashResourceId: 'delete-own' } })
  check('超过保留期限后拒绝恢复', (await api(`${trashUrl}/delete-own/restore`, { user: 'member', method: 'POST' })).status === 410)
  await api('/__team_fixture', { method: 'POST', body: { extendTrashResourceId: 'delete-own' } })
  const restore = await api(`${trashUrl}/delete-own/restore`, { user: 'member', method: 'POST' })
  check('上传者可恢复且资源保持关闭', restore.status === 200 && restore.data.item.id === 'delete-own' && !stored().shares.find(s => s.id === 'delete-own').deletedAt && stored().shares.find(s => s.id === 'delete-own').status === 'closed' && stored().shares.find(s => s.id === 'delete-own').closeReason === 'team_trash_restore')
  const anonymousRestoredLink = await api('/api/shares/token/delete-own', { user: '' })
  check('恢复不会重新开放原分享链接', anonymousRestoredLink.status >= 400)
  check('恢复资源回到列表但仍关闭', (await api('/api/account/team/overview')).data.resources.some(r => r.id === 'delete-own' && r.status === 'closed'))
  check('普通成员不能永久删除', (await api(`${trashUrl}/delete-own`, { user: 'member', method: 'DELETE' })).status === 403)
  const ownTrashedAgain = await api(ownUrl, { user: 'member', method: 'DELETE' })
  check('资源恢复后可再次移入回收站', ownTrashedAgain.status === 200)
  check('重复移入回收站拒绝', (await api(ownUrl, { user: 'member', method: 'DELETE' })).status === 404)
  const crossOriginPermanent = await api(`${trashUrl}/delete-own`, { user: 'owner', method: 'DELETE', headers: { origin: 'https://evil.example.test', 'sec-fetch-site': 'cross-site' } })
  check('跨站永久删除请求拒绝且保留文件', crossOriginPermanent.status === 403 && fs.existsSync(path.join(fixture, 'storage/files/delete-own')))
  const reusedPath = await api('/api/upload-sessions', { user: 'member', method: 'POST', body: { ...sessionBody('second.txt'), files: [{ name: 'second.txt', relativePath: 'folder/second.txt', size: 4, mimeType: 'text/plain' }] } })
  check('回收站内的完整文件路径可重新上传', reusedPath.status === 201)
  if (reusedPath.data.sessionId) await api('/api/upload-sessions/' + reusedPath.data.sessionId, { user: 'member', method: 'DELETE' })
  check('资源上传者不能永久删除回收站内容', (await api(`${trashUrl}/delete-own`, { user: 'member', method: 'DELETE' })).status === 403 && fs.existsSync(path.join(fixture, 'storage/files/delete-own')))
  const permanentBefore = (await api('/api/account/team/overview')).data
  const permanent = await api(`${trashUrl}/delete-own`, { method: 'DELETE' })
  check('团队管理者可永久删除并释放容量', permanent.status === 200 && !fs.existsSync(path.join(fixture, 'storage/files/delete-own')) && !stored().shares.some(s => s.id === 'delete-own') && permanent.data.capacity.usedBytes === permanentBefore.capacity.usedBytes - safe.length * 2)
  check('彻底删除清理关联记录并保留其他资源', ['owner', 'member'].every(user => stored().records[user].length === 1 && stored().records[user][0].id.endsWith(':main-file')))
  const restoreOrphan = await api('/api/account/records', { user: 'member', method: 'POST', body: { record: { id: 'my_sent:share:delete-own' } } })
  check('客户端同步不能复活已彻底删除的记录', restoreOrphan.status === 201 && !restoreOrphan.data.records.some(r => r.id === 'my_sent:share:delete-own'))
  check('重复删除明确返回不存在', (await api(ownUrl, { user: 'member', method: 'DELETE' })).status === 404)
  check('管理者可将其他成员资源移入回收站', (await api('/api/account/team/resources/delete-peer', { method: 'DELETE' })).status === 200 && stored().shares.find(s => s.id === 'delete-peer')?.deletedAt)
  check('原上传者仍可恢复自己的资源', (await api(`${trashUrl}/delete-peer/restore`, { user: 'member2', method: 'POST' })).status === 200)
  const race = await Promise.all(['owner', 'member2'].map(user => api('/api/account/team/resources/delete-race', { user, method: 'DELETE' })))
  check('并发移入回收站安全且文件保留', race.some(r => r.status === 200) && race.every(r => [200, 404].includes(r.status)) && stored().shares.find(s => s.id === 'delete-race')?.deletedAt && fs.existsSync(path.join(fixture, 'storage/files/delete-race/safe.txt')) && stored().shares.some(s => s.id === 'main-file') && fs.readFileSync(path.join(fixture, 'storage/files/main-file/safe.txt')).equals(safe))
  check('回收站操作记录操作者与组织审计', stored().auditLogs.some(log => log.action === '移入团队回收站' && log.userId === 'member' && log.targetId === 'delete-own' && log.details.organizationId === 'main'))
  const releasedPath = await api('/api/upload-sessions', { user: 'member', method: 'POST', body: { ...sessionBody('second.txt'), files: [{ name: 'second.txt', relativePath: 'folder/second.txt', size: 4, mimeType: 'text/plain' }] } })
  check('删除后的完整路径可以再次上传', releasedPath.status === 201)
  if (releasedPath.data.sessionId) await api('/api/upload-sessions/' + releasedPath.data.sessionId, { user: 'member', method: 'DELETE' })
  const failureBefore = (await api('/api/account/team/overview')).data.capacity.usedBytes
  check('将失败样例文件移入回收站', (await api('/api/account/team/resources/delete-failure', { user: 'member', method: 'DELETE' })).status === 200)
  await api('/__team_fixture', { method: 'POST', body: { failResourceRemoval: true } })
  const failedDelete = await api(`${trashUrl}/delete-failure`, { method: 'DELETE' })
  check('存储删除失败不虚报成功或释放容量', failedDelete.status === 500 && stored().shares.some(s => s.id === 'delete-failure') && fs.existsSync(path.join(fixture, 'storage/files/delete-failure/safe.txt')) && (await api('/api/account/team/overview')).data.capacity.usedBytes === failureBefore)
  check('永久删除失败后可重试', (await api(`${trashUrl}/delete-failure`, { method: 'DELETE' })).status === 200 && !stored().shares.some(s => s.id === 'delete-failure'))
  check('已关闭资源可移入回收站且仍保留文件', (await api('/api/account/team/resources/delete-closed', { user: 'member', method: 'DELETE' })).status === 200 && stored().shares.find(s => s.id === 'delete-closed')?.deletedAt && fs.existsSync(path.join(fixture, 'storage/files/delete-closed')))
  await api('/__team_fixture', { method: 'POST', body: { expireTrashResourceId: 'delete-closed' } })
  check('过期资源不可恢复', (await api(`${trashUrl}/delete-closed/restore`, { user: 'member', method: 'POST' })).status === 410)
  await api('/__team_fixture', { method: 'POST', body: { purgeExpiredTrash: true } })
  check('到期清理移除过期团队文件和元数据', !stored().shares.some(s => s.id === 'delete-closed') && !fs.existsSync(path.join(fixture, 'storage/files/delete-closed')))
  await stop(); await start()
  check('过期清理结果重启后保留', !stored().shares.some(s => s.id === 'delete-closed') && !fs.existsSync(path.join(fixture, 'storage/files/delete-closed')))
  const afterRestart = (await api('/api/account/team/overview')).data
  check('回收站和容量在重启后持久化', !(afterRestart.resources || []).some(r => ['delete-own', 'delete-race'].includes(r.id)) && !stored().shares.some(s => s.id === 'delete-own') && (await api(trashUrl)).data.items.some(item => item.id === 'delete-race'))
 })
 await group('TEAM-TRASH-EMPTY', async () => {
  const trashUrl = '/api/account/team/trash'
  // 准备两条团队回收站资源、一条个人回收站资源，以及仍在使用中的团队资源。
  check('上传者可再次将已恢复资源移入团队回收站', (await api('/api/account/team/resources/delete-peer', { user: 'member2', method: 'DELETE' })).status === 200)
  check('个人资源移入个人回收站', (await api('/api/account/records', { user: 'member2', method: 'DELETE', body: { ids: ['my_sent:share:delete-personal'] } })).status === 200)
  await api('/api/account/records', { user: 'member2', method: 'POST', body: { records: [{ id: 'my_sent:share:delete-peer' }, { id: 'my_sent:share:delete-race' }] } })
  await api('/api/account/records', { user: 'owner', method: 'POST', body: { record: { id: 'sent_to_me:share:delete-peer-manage' } } })
  check('团队回收站包含两条待清空资源', (await api(trashUrl)).data.items.filter(item => ['delete-peer', 'delete-race'].includes(item.id)).length === 2)
  check('个人回收站与团队回收站相互隔离', (await api('/api/account/trash', { user: 'member2' })).data.items.some(item => item.id === 'delete-personal'))
  check('游客不能清空团队回收站', (await api(trashUrl, { user: '', method: 'DELETE' })).status === 401)
  check('普通成员不能清空团队回收站', (await api(trashUrl, { user: 'member', method: 'DELETE' })).status === 403)
  check('其他团队不能清空本团队回收站', (await api(trashUrl, { user: 'owner2', method: 'DELETE' })).data.deletedCount === 0 && (await api(trashUrl)).data.items.some(item => item.id === 'delete-race'))
  const beforeEmpty = (await api('/api/account/team/overview')).data.capacity.usedBytes
  const emptied = await api(trashUrl, { method: 'DELETE' })
  check('团队管理员可一键清空回收站并返回删除统计', emptied.status === 200 && emptied.data.deletedCount === 2 && emptied.data.deletedFileCount === 2 && emptied.data.releasedBytes === safe.length * 2)
  check('清空后释放团队容量', emptied.data.capacity.usedBytes === beforeEmpty - safe.length * 2)
  check('清空仅删除回收站资源并保留活动资源', !stored().shares.some(s => ['delete-peer', 'delete-race'].includes(s.id)) && stored().shares.some(s => s.id === 'main-file') && stored().shares.some(s => s.id === 'delete-ownership'))
  check('清空移除回收站磁盘目录', !fs.existsSync(path.join(fixture, 'storage/files/delete-peer')) && !fs.existsSync(path.join(fixture, 'storage/files/delete-race')))
  check('清空不影响个人回收站', stored().shares.find(s => s.id === 'delete-personal')?.deletedAt && fs.existsSync(path.join(fixture, 'storage/files/delete-personal')) && (await api('/api/account/trash', { user: 'member2' })).data.items.some(item => item.id === 'delete-personal'))
  check('清空后团队回收站为空', (await api(trashUrl)).data.items.length === 0)
  check('清空清理关联的收发记录', !stored().records.member2?.some(record => /delete-(peer|race)/.test(record.id)) && !stored().records.owner?.some(record => record.id === 'sent_to_me:share:delete-peer-manage') && stored().records.member?.some(record => record.id === 'my_sent:share:main-file'))
  check('清空团队回收站写入审计', stored().auditLogs.some(log => log.action === '清空团队回收站' && log.userId === 'owner' && log.details.organizationId === 'main' && log.details.deletedResourceCount === 2))
  const emptyAgain = await api(trashUrl, { method: 'DELETE' })
  check('重复清空返回零删除且容量不变', emptyAgain.status === 200 && emptyAgain.data.deletedCount === 0 && emptyAgain.data.capacity.usedBytes === emptied.data.capacity.usedBytes)
 })
 await group('TEAM-004',async()=>{
  for(const q of ['accept',users.accept.email,users.accept.phone]){const r=await api('/api/account/workspace/member-search?q='+encodeURIComponent(q));check('精确搜索 '+q,r.status===200&&r.data.users.some(u=>u.id==='accept'));check('候选联系方式脱敏',r.data.users.every(u=>u.email!==users.accept.email&&u.phone!==users.accept.phone))}
  for(const q of ['missing','<script>alert(1)</script>',"' OR 1=1 --",'138'])check('不存在、恶意、模糊联系方式不枚举 '+q,(await api('/api/account/workspace/member-search?q='+encodeURIComponent(q))).data.users.length===0)
  const first=await api('/api/account/workspace/member-search?q=candidate');const second=await api('/api/account/workspace/member-search?q=candidate&page=2');check('分页不重复且页面大小受限',first.data.users.length===8&&second.data.users.length===4&&!first.data.users.some(u=>second.data.users.some(v=>v.id===u.id)))
  check('普通成员不能搜索',(await api('/api/account/workspace/member-search?q=accept',{user:'member'})).status===403)
  let limited=false;for(let i=0;i<35;i++){if((await api('/api/account/workspace/member-search?q=accept')).status===429){limited=true;break}}check('搜索限流',limited)
 })
 await group('TEAM-005',async()=>{const r=await api('/api/organizations/main-slug/join-request',{user:'outsider'});check('入团落地接口对应正确团队',r.status===200&&r.data.available&&r.data.organizationName==='TEAM重命名');check('无token不泄漏管理信息',!('members'in r.data)&&!('ownerUserId'in r.data));check('错误slug不可申请',!(await api('/api/organizations/bad-slug/join-request',{user:''})).data.available)})
 await group('TEAM-006',async()=>{
  const a=await invite('accept');check('非目标账号不能接受',(await api('/api/account/workspace/invitations/'+a,{user:'outsider',method:'POST',body:{decision:'accept'}})).status===404);check('目标接受',(await api('/api/account/workspace/invitations/'+a,{user:'accept',method:'POST',body:{decision:'accept'}})).status===200)
  const repeat=await api('/api/account/workspace/invitations/'+a,{user:'accept',method:'POST',body:{decision:'accept'}});check('重复接受无第二次流转',[200,409].includes(repeat.status)&&stored().organizations.main.members.filter(m=>m.userId==='accept'&&m.status==='active').length===1)
  const d=await invite('decline');check('拒绝邀请',(await api('/api/account/workspace/invitations/'+d,{user:'decline',method:'POST',body:{decision:'decline'}})).status===200);check('拒绝后重放不能加入',(await api('/api/account/workspace/invitations/'+d,{user:'decline',method:'POST',body:{decision:'accept'}})).status===404&&!(await api('/api/account/workspace',{user:'decline'})).data.organization)
  const e=await invite('expired');await api('/__team_fixture',{method:'POST',body:{expireInvitation:e}});await stop();await start();const expired=await api('/api/account/workspace/invitations/'+e,{user:'expired',method:'POST',body:{decision:'accept'}});check('过期邀请重启后仍拒绝',expired.status===410&&!(await api('/api/account/workspace',{user:'expired'})).data.organization)
  const fresh=await invite('expired');check('过期后可重新邀请且旧邀请失效',fresh!==e&&(await api('/api/account/workspace/invitations/'+e,{user:'expired',method:'POST',body:{decision:'accept'}})).status===404);check('新邀请可接受',(await api('/api/account/workspace/invitations/'+fresh,{user:'expired',method:'POST',body:{decision:'accept'}})).status===200)
  const request=await api('/api/organizations/main-slug/join-request',{user:'outsider',method:'POST',body:{message:'TEAM申请验证'}});check('邀请落地页可提交入团申请',request.status===201);assert.ok(request.data.requestId);check('重复申请不产生第二条记录',(await api('/api/organizations/main-slug/join-request',{user:'outsider',method:'POST',body:{}})).status===409)
  check('普通成员不能审批',(await api('/api/account/workspace/join-requests/'+request.data.requestId,{user:'member2',method:'POST',body:{decision:'approve'}})).status===403);check('正式成员不看到待审批申请',!(await api('/api/account/team/overview',{user:'member2'})).data.organization.members.some(m=>m.userId==='outsider'))
  check('所有者审批申请成功',(await api('/api/account/workspace/join-requests/'+request.data.requestId,{method:'POST',body:{decision:'approve'}})).status===200);check('重复审批不重复加入',(await api('/api/account/workspace/join-requests/'+request.data.requestId,{method:'POST',body:{decision:'approve'}})).status===404&&stored().organizations.main.members.filter(m=>m.userId==='outsider').length===1)
  const rejected=await api('/api/organizations/main-slug/join-request',{user:'decline',method:'POST',body:{}});assert.equal(rejected.status,201);check('所有者拒绝申请',(await api('/api/account/workspace/join-requests/'+rejected.data.requestId,{method:'POST',body:{decision:'reject'}})).status===200);check('拒绝后冷却与提示一致',(await api('/api/organizations/main-slug/join-request',{user:'decline',method:'POST',body:{}})).status===429&&(await api('/api/organizations/main-slug/join-request',{user:'decline'})).data.reason==='cooldown')
 })
 await group('TEAM-007',async()=>{
  check('所有者有管理权限',(await api('/api/account/team/overview')).data.canManage);const member=(await api('/api/account/team/overview',{user:'member2'})).data;check('成员无管理权限和他人管理令牌',!member.canManage&&member.resources.every(r=>r.ownerUserId==='member2'||!r.manageToken))
  for(const [url,method,body] of [['/api/account/workspace','PATCH',{name:'attack'}],['/api/account/workspace/transfer-ownership','POST',{targetMemberId:'m-transfer'}],['/api/account/workspace/dissolve','POST',{}],['/api/account/workspace/members/m-member','DELETE',{}]])check('成员操作拒绝 '+url,(await api(url,{user:'member2',method,body})).status===403)
  check('管理令牌不能绕过登录',(await api('/api/shares/manage/main-file-manage',{user:''})).status===401)
  check('知道他人令牌不能改团队资源',(await api('/api/shares/manage/main-file-manage',{user:'member2',method:'PATCH',body:{action:'close'}})).status===403)
  check('团队所有者可管理资源',(await api('/api/shares/manage/main-file-manage')).status===200)
  check('所有者不能被移除',(await api('/api/account/workspace/members/m-owner',{method:'DELETE'})).status===400&&stored().organizations.main.members.some(m=>m.userId==='owner'))
 })
 await group('TEAM-008',async()=>{
  const pending=await createUpload('victim','pending-removal.txt');assert.equal(pending.status,201);await chunks('victim',pending.data.sessionId)
  check('移除成功',(await api('/api/account/workspace/members/m-victim',{user:'removeOwner',method:'DELETE'})).status===200)
  check('旧会话无团队',(await api('/api/account/workspace',{user:'victim'})).data.organization===null)
  for(const url of ['/api/shares/token/victim-team','/api/shares/victim-team/files/0/preview','/api/shares/manage/victim-team-manage'])check('移除后原链接拒绝 '+url,(await api(url,{user:'victim'})).status===403)
  check('移除后未完成上传不能提交',(await api('/api/upload-sessions/'+pending.data.sessionId+'/complete',{user:'victim',method:'POST',body:{}})).status===403)
  check('个人文件仍可读取',(await api('/api/shares/manage/victim-personal-manage/files/0/preview',{user:'victim'})).status===200)
  check('移除上传者后团队资源仍归团队',(await api('/api/account/team/overview',{user:'removeOwner'})).data.resources.some(r=>r.id==='victim-team'))
  check('移除上传者后正确团队slug仍有效',(await api('/api/shares/token/victim-team?organization=remove-slug',{user:'removeOwner'})).status===200)
  check('移除上传者后团队所有者可管理资源',(await api('/api/shares/manage/victim-team-manage',{user:'removeOwner'})).status===200)
  check('被移除上传者旧会话不能删除自己的团队资源', (await api('/api/account/team/resources/delete-removed', { user: 'victim', method: 'DELETE' })).status === 404 && stored().shares.some(s => s.id === 'delete-removed'))
  const removedMemberResource = await api('/api/account/team/resources/delete-removed', { user: 'removeOwner', method: 'DELETE' })
  check('所有者可将已移除成员留下的资源移入团队回收站', removedMemberResource.status === 200 && stored().shares.find(s => s.id === 'delete-removed')?.deletedAt && fs.existsSync(path.join(fixture, 'storage/files/delete-removed')))
 })
 await group('TEAM-009',async()=>{const before=(await api('/api/account/team/overview')).data;const initiated=await api('/api/account/workspace/transfer-ownership',{method:'POST',body:{targetMemberId:'m-transfer'}});check('发起后原所有者不变',initiated.status===201&&stored().organizations.main.ownerUserId==='owner');const r=await api('/api/account/workspace/ownership-handovers/'+initiated.data.handover.id,{user:'transfer',method:'POST',body:{decision:'accept'}});const after=(await api('/api/account/team/overview',{user:'transfer'})).data;const transferredWorkspace=(await api('/api/account/workspace',{user:'transfer'})).data;check('转让成功',r.status===200&&stored().organizations.main.ownerUserId==='transfer');check('新所有者获取权限',after.canManage);check('原所有者降级',!(await api('/api/account/team/overview')).data.canManage);check('转让后团队套餐和容量保持不变',after.capacity.totalBytes===before.capacity.totalBytes&&after.capacity.totalBytes>0&&transferredWorkspace.teamEntitlement.teamSpaceBytes===before.capacity.totalBytes);check('新所有者个人套餐与团队套餐分开',transferredWorkspace.plan.id==='free'&&transferredWorkspace.teamEntitlement.canUseTeamSpace===true);check('旧请求不可再次转让',(await api('/api/account/workspace/transfer-ownership',{method:'POST',body:{targetMemberId:'m-member2'}})).status===403&&stored().organizations.main.ownerUserId==='transfer');check('仍只有一个所有者',stored().organizations.main.members.filter(m=>m.role==='owner').length===1)
  check('原所有者不能再删除他人成员资源', (await api('/api/account/team/resources/delete-ownership', { method: 'DELETE' })).status === 403 && stored().shares.some(s => s.id === 'delete-ownership'))
  check('转让后新所有者可删除团队成员资源', (await api('/api/account/team/resources/delete-ownership', { user: 'transfer', method: 'DELETE' })).status === 200)
 })
 await group('TEAM-010',async()=>{check('唯一所有者退出拒绝',(await api('/api/account/workspace/leave',{user:'leaveOwner',method:'POST'})).status===400);check('普通成员可退出',(await api('/api/account/workspace/leave',{user:'leaver',method:'POST'})).status===200);check('旧会话已无团队',(await api('/api/account/workspace',{user:'leaver'})).data.organization===null);check('原所有者转让后可退出',(await api('/api/account/workspace/leave',{method:'POST'})).status===200)})
 await group('TEAM-011',async()=>{check('解散成功',(await api('/api/account/workspace/dissolve',{user:'dissolveOwner',method:'POST'})).status===200);check('组织和成员归属清除',!stored().organizations.dissolve&&!(await api('/api/account/workspace',{user:'dissolveMember'})).data.organization);check('团队公开链接停用',(await api('/api/shares/token/dissolve-team',{user:''})).status===404);check('团队文件标记关闭',stored().shares.find(s=>s.id==='dissolve-team').status==='closed');check('专属入口失效',(await api('/api/organizations/dissolve-slug/join-request',{user:''})).data.reason==='unavailable');check('个人文件和套餐保留',(await api('/api/shares/manage/dissolve-personal-manage/files/0/preview',{user:'dissolveMember'})).status===200&&stored().users.dissolveMember.planId==='free')})
 await group('TEAM-012',async()=>{
  const nested=[{name:'同名.txt',relativePath:'批量资料/甲/同名.txt',content:Buffer.from('甲目录内容')},{name:'同名.txt',relativePath:'批量资料/乙/同名.txt',content:Buffer.from('乙目录内容')}]
  const folder=await api('/api/upload-sessions',{user:'member',method:'POST',body:{...sessionBody('unused'),files:nested.map(f=>({name:f.name,relativePath:f.relativePath,size:f.content.length,mimeType:'text/plain'}))}})
  check('不同目录同名文件可创建上传会话',folder.status===201)
  await chunks('member',folder.data.sessionId,nested)
  const folderDone=await api('/api/upload-sessions/'+folder.data.sessionId+'/complete',{user:'member',method:'POST',body:{}})
  check('文件夹完整上传并保留同名文件层级',folderDone.status===201&&JSON.stringify(folderDone.data.share.files.map(f=>f.relativePath))===JSON.stringify(['批量资料/甲/同名.txt','批量资料/乙/同名.txt']))
  for(let i=0;i<nested.length;i++){const content=await api('/api/shares/'+folderDone.data.share.id+'/files/'+i+'/download',{user:'member'});check('文件夹同名文件内容独立 '+i,content.status===200&&content.bytes.equals(nested[i].content))}
  check('相同完整路径重复上传仍拒绝',(await api('/api/upload-sessions',{user:'member',method:'POST',body:{...sessionBody('unused'),files:[{name:'同名.txt',relativePath:'批量资料/甲/同名.txt',size:1,mimeType:'text/plain'}]}})).status===409)
  const dir=path.join(root,'测试数据/鲲穹文件传输测试数据包/05-目录结构');const files=[];function walk(p){for(const e of fs.readdirSync(p,{withFileTypes:true})){const f=path.join(p,e.name);if(e.isDirectory())walk(f);else if(/TC-06-0[1-4]/.test(e.name))files.push({name:e.name,relativePath:path.relative(dir,f).replaceAll('\\','/'),content:fs.readFileSync(f)})}}walk(dir);assert.equal(files.length,4)
  const before=(await api('/api/account/team/overview',{user:'member'})).data;const r=await api('/api/upload-sessions',{user:'member',method:'POST',body:{...sessionBody('unused'),files:files.map(f=>({name:f.name,relativePath:f.relativePath,size:f.content.length,mimeType:'text/plain'}))}});assert.equal(r.status,201,JSON.stringify(r.data));await chunks('member',r.data.sessionId,files);const done=await api('/api/upload-sessions/'+r.data.sessionId+'/complete',{user:'member',method:'POST',body:{}});check('成员目录文件完整上传且扫描',done.status===201&&done.data.share.files.length===4&&done.data.share.files.every(f=>f.scanEngine==='clamav')&&scans>=4);assert.ok(done.data.share)
  const share=stored().shares.find(s=>s.id===done.data.share.id);check('组织归属与路径保存',share.teamResource&&share.teamOrganizationId==='main'&&share.files.some(f=>f.relativePath.includes('/')));const after=(await api('/api/account/team/overview',{user:'member'})).data;const bytes=files.reduce((n,f)=>n+f.content.length,0);check('成员和团队用量准确',after.capacity.usedBytes-before.capacity.usedBytes===bytes&&after.memberUsage.find(m=>m.userId==='member').usedBytes-before.memberUsage.find(m=>m.userId==='member').usedBytes===bytes);check('团队资源不占个人空间',(await api('/api/account/workspace',{user:'member'})).data.capacity.usedBytes===0)
  for(let i=0;i<files.length;i++){const download=await api('/api/shares/'+share.id+'/files/'+i+'/download',{user:'member'});check('上传文件下载字节完整 '+files[i].name,download.status===200&&download.bytes.equals(files[i].content))}
  check('成员可关闭自己的资源',(await api('/api/shares/manage/'+share.manageToken,{user:'member',method:'PATCH',body:{status:'closed'}})).status===200);check('关闭链接不释放仍保留文件的容量',(await api('/api/account/team/overview',{user:'member'})).data.capacity.usedBytes===after.capacity.usedBytes)
  await api('/__team_fixture',{method:'POST',body:{quota:after.capacity.usedBytes+10}});const pending=await createUpload('member','reserve.txt',8);check('额度内会话成功',pending.status===201);check('并发预留防超限',(await createUpload('member2','reserve2.txt',8)).status===507);await api('/api/upload-sessions/'+pending.data.sessionId,{user:'member',method:'DELETE'});check('入口超限拒绝',(await createUpload('member','too-large.txt',11)).status===507)
  const last=await createUpload('member','quota-changed.txt',8);assert.equal(last.status,201);await chunks('member',last.data.sessionId,[{name:'quota-changed.txt',content:Buffer.from('12345678')}]);await api('/__team_fixture',{method:'POST',body:{quota:after.capacity.usedBytes}});check('完成时重新校验容量',(await api('/api/upload-sessions/'+last.data.sessionId+'/complete',{user:'member',method:'POST',body:{}})).status===507);await api('/__team_fixture',{method:'POST',body:{quota:1024**4}})
 })
 await group('TEAM-013',async()=>{for(const [url,user,slug] of [['/api/shares/token/main-file','member','main-slug'],['/api/shares/token/enterprise-personal','','second-slug'],['/api/collections/tasktoken','','second-slug']]){const correct=await api(url+'?organization='+slug,{user});check('正确slug '+url,correct.status===200);for(const wrong of ['wrong',slug==='main-slug'?'second-slug':'main-slug'])check('错/其他组织slug '+url+' '+wrong,(await api(url+'?organization='+wrong,{user})).status===404)}check('上传者移除后不能借其他团队slug访问',(await api('/api/shares/token/victim-team?organization=second-slug',{user:'other'})).status===404)})
}finally{await stop();await new Promise(r=>scanner.close(r))}

const result={executedAt:new Date().toISOString(),passed,failures,cases,unsupported:[],fixture,scanner:'local INSTREAM emulator',requests}
if(process.env.TEAM_TEST_EVIDENCE_DIR){fs.mkdirSync(process.env.TEAM_TEST_EVIDENCE_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.TEAM_TEST_EVIDENCE_DIR,'team-api-results.json'),JSON.stringify(result,null,2))}
console.log(JSON.stringify({...result,requests:undefined},null,2));process.exitCode=failures.length?1:0
