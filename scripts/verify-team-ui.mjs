// 真实 React 路由与事件：仅 HTTP 响应在 JSDOM 中替换，高风险操作不触碰真实团队。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { JSDOM, VirtualConsole } from 'jsdom'
import { build } from 'vite'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const bundle=await build({root,configFile:false,logLevel:'silent',worker:{format:'es'},build:{write:false,minify:false,rollupOptions:{input:path.join(root,'src/main.jsx'),output:{format:'iife',inlineDynamicImports:true}}}})
const code=bundle.output.find(x=>x.type==='chunk').code
let passed=0,failures=[],cases=[]
function check(label,ok){assert.ok(ok,label);passed++;console.log('PASS '+label)}
async function waitFor(fn,label){for(let i=0;i<200;i++){if(fn())return;await delay(10)}assert.fail(label)}
async function mount(route='/team',role='owner',teamName='隔离验证团队',hasOrganization=true,resourceFileCount=1,navigation={}){
 const calls=[],errors=[],virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',e=>{if(!/navigation/.test(e.message))errors.push(e)})
 const dom=new JSDOM('<div id="root"></div>',{url:'http://fixture.local'+route,...(navigation.referrer?{referrer:navigation.referrer}:{}),pretendToBeVisual:true,runScripts:'outside-only',virtualConsole})
 const {window}=dom,document=window.document
 if(navigation.includeResourceStyles){const style=document.createElement('style');style.textContent=['base.css','components.css','app-team.css','app-records.css'].map(file=>fs.readFileSync(path.join(root,'src/styles',file),'utf8')).join('\n');document.head.append(style)}
 if(navigation.previousRoutes?.length){window.history.replaceState(null,'',navigation.previousRoutes[0]);for(const previous of navigation.previousRoutes.slice(1))window.history.pushState(null,'',previous);window.history.pushState(null,'',route)}
 const copiedTexts=[];Object.defineProperty(window.navigator,'clipboard',{configurable:true,value:{writeText:async value=>copiedTexts.push(String(value))}})
 let roleChangeFailure=false; let currentRole=role,removed=!hasOrganization,name=teamName,hasTeam=hasOrganization,renameFailure=false,resourceDeleted=Boolean(navigation.teamTrashFixture),resourcePermanentlyDeleted=false,resourceRestored=false,trashDeleted=Boolean(navigation.teamTrashFixture),deleteFailure=false,holdDelete=false,releaseDelete=null,holdTrash=false,releaseTrash=null,resourceUnlocked=false,quotaUsed=false
 let pendingHandover=navigation.pendingHandover||null, handoverHistory=navigation.handoverHistory||[], handoverFailure=false, holdHandover=false, releaseHandover=null
 let personalTrashItems=navigation.personalTrashItems||[]
 const plan={id:'enterprise',label:'企业版',team:true,totalBytes:2048*1024**3,teamSpaceBytes:1024**4,permanent:true,features:[]}
 const members=[{id:'m-owner',userId:'owner',displayName:'所有者',role:'owner',status:'active',usedBytes:0,fileCount:0},{id:'m-member',userId:'member',displayName:'普通成员',role:'member',status:'active',usedBytes:4,fileCount:1}]
 const permittedMembers=()=>members.map(member=>({...member,canRemove:['owner','admin'].includes(currentRole)&&member.role!=='owner'&&(currentRole==='owner'||member.role==='member'),canChangeRole:currentRole==='owner'&&member.role!=='owner',canTransfer:currentRole==='owner'&&member.role!=='owner'&&!pendingHandover}));
 const organization=()=>({id:'org',slug:'team-slug',name,ownerUserId:currentRole==='owner'?'owner':'new-owner',members:permittedMembers(),ownershipHandover:pendingHandover,ownershipHandoverHistory:handoverHistory,createdAt:new Date().toISOString()})
 const overview=()=>({organization:organization(),canManage:['owner','admin'].includes(currentRole),isOwner:currentRole==='owner',plan,capacity:{usedBytes:resourcePermanentlyDeleted?0:4,totalBytes:1024**4,shareCount:resourcePermanentlyDeleted?0:1,fileCount:resourcePermanentlyDeleted?0:1},memberUsage:permittedMembers().map(m=>m.userId==='member'&&resourcePermanentlyDeleted?{...m,usedBytes:0,fileCount:0}:m),joinRequests:[],resources:resourceDeleted?[]:[{id:'teamfile',code:'TEAM01',kind:'share',name:'安全文件.txt',files:[{name:'安全文件.txt',size:4,mimeType:'text/plain'}],ownerUserId:'member',status:resourceRestored?'closed':navigation.resourceStatus||'active',fileCount:resourceFileCount,totalSize:4*resourceFileCount,canManage:['owner','admin','member'].includes(currentRole),canDelete:['owner','admin','member'].includes(currentRole),...(['owner','admin','member'].includes(currentRole)?{manageToken:'test',manageUrl:'/share/manage/test'}:{})}]})
 window.fetch=async(url,options={})=>{const method=options.method||'GET';calls.push({url,method,body:options.body,headers:options.headers});let data={},status=200
  const pathname = new URL(url, 'http://fixture.local').pathname
  if (navigation.resourcePassword && pathname.startsWith('/api/shares/')) {
   if (pathname.endsWith('/unlock') || pathname.includes('/lookup/')) {
    if (JSON.parse(options.body).password !== '中文密码123') return new Response(JSON.stringify({message:'提取密码不正确',code:'share_password_invalid'}),{status:401})
    resourceUnlocked=true
    return new Response('{}')
   }
   if (quotaUsed) return new Response(null,{status:410,headers:{'x-error-message':encodeURIComponent('下载次数已用完')}})
   if (!resourceUnlocked) return new Response(null,{status:403,headers:{'x-error-message':encodeURIComponent('请输入提取密码')}})
   return new Response(method==='HEAD'?null:'团队正文',{headers:{'content-type':'text/plain'}})
  }
  if(url==='/api/auth/me')data={user:currentRole?{id:currentRole==='owner'?'owner':currentRole==='peer'?'peer':currentRole==='admin'?'admin':'member',nickname:'UI测试',plan,organization:hasTeam?{id:'org',slug:'team-slug',name,ownerUserId:currentRole==='owner'?'owner':'new-owner'}:null}:null}
  else if(url==='/api/account/team/overview'){
   if(removed){status=404;data={message:'你尚未加入团队空间'}}
   else {
    data=overview()
    if(navigation.includeReadOnlyResource)data.resources.push({...data.resources[0],id:'readonlyfile',name:'只读文件.txt',canDelete:false,manageToken:'readonly',manageUrl:'/share/manage/readonly'})
    if(navigation.usageFixture){
     data.capacity={...data.capacity,totalBytes:navigation.usageFixture.totalBytes,usedBytes:navigation.usageFixture.usedBytes}
     data.memberUsage=data.memberUsage.map(member=>member.userId==='member'?{...member,usedBytes:navigation.usageFixture.memberBytes}:member)
    }
   }
  }
  else if(pathname==='/api/account/trash'&&method==='GET'){if(holdTrash)await new Promise(resolve=>releaseTrash=resolve);data={items:personalTrashItems,retentionDays:7}}
  else if(pathname==='/api/account/trash'&&method==='DELETE'){
   const deletedCount=personalTrashItems.length
   const deletedFileCount=personalTrashItems.reduce((sum,item)=>sum+Number(item.fileCount||0),0)
   const releasedBytes=personalTrashItems.reduce((sum,item)=>sum+Number(item.totalSize||0),0)
   personalTrashItems=[]
   data={ok:true,deletedCount,deletedFileCount,releasedBytes}
  }
  else if(pathname.startsWith('/api/account/trash/')&&method==='DELETE'){
   const parts=pathname.split('/')
   const id=decodeURIComponent(parts[parts.length-1])
   const kind=decodeURIComponent(parts[parts.length-2])
   const index=personalTrashItems.findIndex(item=>item.id===id&&item.kind===kind)
   if(index>=0)personalTrashItems.splice(index,1)
   data={ok:true,item:{id,kind}}
  }
  else if(pathname==='/api/account/team/trash'&&method==='GET'){if(holdTrash)await new Promise(resolve=>releaseTrash=resolve);data={items:trashDeleted&&currentRole!=='peer'?[{id:'teamfile',kind:'share',name:'安全文件.txt',ownerUserId:'member',ownerName:'普通成员',deletedByUserId:'member',deletedByName:'普通成员',deletedAt:new Date(Date.now()-3600000).toISOString(),trashExpiresAt:new Date(Date.now()+6*86400000).toISOString(),fileCount:resourceFileCount,totalSize:4,canRestore:['owner','admin','member'].includes(currentRole),canDelete:['owner','admin'].includes(currentRole)}]:[],retentionDays:7}}
  else if(pathname==='/api/account/team/trash'&&method==='DELETE'){
   if(!['owner','admin'].includes(currentRole)){status=403;data={message:'仅团队所有者或管理员可以清空团队回收站'}}
   else{const deletedCount=trashDeleted?1:0;trashDeleted=false;if(deletedCount)resourcePermanentlyDeleted=true;data={ok:true,deletedCount,deletedFileCount:deletedCount?resourceFileCount:0,releasedBytes:deletedCount?4:0,capacity:overview().capacity}}
  }
  else if(pathname==='/api/account/team/trash/teamfile/restore'&&method==='POST'){trashDeleted=false;resourceDeleted=false;resourceRestored=true;data={item:{id:'teamfile'}}}
  else if(pathname==='/api/account/team/trash/teamfile'&&method==='DELETE'){trashDeleted=false;resourcePermanentlyDeleted=true;data={ok:true,item:{id:'teamfile'},capacity:overview().capacity}}
  else if(pathname==='/api/account/team/resources/teamfile'&&method==='DELETE'){
   if(holdDelete)await new Promise(resolve=>releaseDelete=resolve)
   if(deleteFailure||currentRole==='peer'){deleteFailure=false;status=403;data={message:'你已失去删除权限'}}
   else{resourceDeleted=true;trashDeleted=true;data={ok:true,deletedResourceId:'teamfile',deletedFileCount:1,releasedBytes:0,retainedBytes:4,trashExpiresAt:new Date(Date.now()+7*86400000).toISOString(),capacity:overview().capacity}}
  }
  else if(url==='/api/account/workspace'){if(method==='PATCH'&&renameFailure){renameFailure=false;status=409;data={message:'团队名称已存在，请使用其他名称'}}else{if(method==='PATCH'||method==='POST'){name=JSON.parse(options.body).name;hasTeam=true}data={plan,plans:[plan],capacity:{usedBytes:0,totalBytes:plan.totalBytes},organization:hasTeam?organization():null,canManage:hasTeam&&['owner','admin'].includes(currentRole),isOwner:currentRole==='owner',teamEntitlement:{role:currentRole,canManage:hasTeam&&['owner','admin'].includes(currentRole),canUseTeamSpace:hasTeam,teamSpaceBytes:plan.teamSpaceBytes},orders:[]}}}
  else if(url.startsWith('/api/account/workspace/member-search'))data={users:[{id:'candidate',displayName:'候选成员',username:'candidate',email:'c***@example.test',phone:'138****9999'}]}
  else if(url==='/api/account/workspace/members/m-member/role'&&method==='PATCH'){if(roleChangeFailure){roleChangeFailure=false;status=403;data={message:'角色调整被拒绝'}}else{members.find(member=>member.id==='m-member').role=JSON.parse(options.body).role;data={organization:organization()}}}
  else if(url==='/api/account/workspace/transfer-ownership'){pendingHandover={id:'handover-1',fromUserId:'owner',toUserId:'member',fromName:'所有者',toName:'普通成员',status:'pending',initiatedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+7*86400000).toISOString(),canCancel:true,canRespond:false};status=201;data={transferred:false,handover:pendingHandover}}
  else if(url.startsWith('/api/account/workspace/ownership-handovers/')){
   if(holdHandover)await new Promise(resolve=>releaseHandover=resolve)
   if(handoverFailure){handoverFailure=false;status=409;data={message:'交接已失效，请刷新后查看'}}
   else{const decision=JSON.parse(options.body).decision;handoverHistory=[{...pendingHandover,status:{accept:'accepted',decline:'declined',cancel:'canceled'}[decision],resolvedAt:new Date().toISOString()},...handoverHistory];pendingHandover=null;if(decision==='accept')currentRole='owner';data={transferred:decision==='accept'}}
  }
  else if(url==='/api/account/workspace/leave'){removed=true;data={leftOrganizationId:'org'}}
  else if(url==='/api/account/workspace/dissolve'){removed=true;data={dissolvedOrganizationId:'org'}}
  else if(url.startsWith('/api/organizations/'))data=url.includes('wrong')?{available:false,reason:'unavailable'}:{available:!!currentRole,reason:currentRole?'eligible':'anonymous',organizationName:name}
  else if(url==='/api/account/upgrade-pricing')data={source:'local',pricing:{}}
  else if(url==='/api/account/messages')data={messages:[],settings:{}}
   else if(url==='/api/upload-sessions'){status=navigation.uploadFailure?415:400;data=navigation.uploadFailure||{message:'fixture: stop before uploading bytes'}}
  return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}})
 }
 window.eval(code);await waitFor(()=>document.querySelector('.public-shell, .app-shell'),'page mounts');await delay(100)
 const buttons=()=>[...document.querySelectorAll('button')]
 const find=(label)=>buttons().find(b=>b.getAttribute('aria-label')===label||b.textContent.trim()===label)
 const click=async(label)=>{const button=find(label);assert.ok(button,'button '+label);button.click();await delay(45)}
 const input=async(element,value)=>{assert.ok(element,'input found');Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(element,value);element.dispatchEvent(new window.Event('input',{bubbles:true}));await delay(30)}
 const file=(name,relativePath=name)=>{const item=new File(['test'],name,{type:'text/plain',lastModified:123});Object.defineProperty(item,'webkitRelativePath',{value:relativePath});return item}
 const choose=async(items,folder=false)=>{const picker=document.querySelector(folder?'input[webkitdirectory]':'input[type="file"]:not([webkitdirectory])');assert.ok(picker,'file picker');Object.defineProperty(picker,'files',{configurable:true,value:items});picker.dispatchEvent(new window.Event('change',{bubbles:true}));await delay(30)}
 return {failNextHandover:()=>handoverFailure=true,holdNextHandover:()=>holdHandover=true,releaseHandover:()=>{holdHandover=false;releaseHandover?.()},exhaustDownloads:()=>quotaUsed=true,failNextRoleChange:()=>roleChangeFailure=true,dom,window,document,calls,errors,copiedTexts,click,find,input,file,choose,remove:()=>removed=true,failNextRename:()=>renameFailure=true,failNextResourceDelete:()=>deleteFailure=true,holdNextResourceDelete:()=>holdDelete=true,releaseResourceDelete:()=>{holdDelete=false;releaseDelete?.()},holdNextTrash:()=>holdTrash=true,releaseTrash:()=>{holdTrash=false;releaseTrash?.()}}
}
async function scenario(id,fn){try{await fn();cases.push({id,status:'PASS'})}catch(e){failures.push({id,message:e.message});cases.push({id,status:'FAIL'});console.log('FAIL '+id+' '+e.stack)}}
await scenario('TEAM-BACK-NAVIGATION', async () => {
 for (const navigation of [
  { previousRoutes: ['/team'], referrer: 'http://fixture.local/team' },
  { previousRoutes: ['/team', '/workspace', '/team'], referrer: 'http://fixture.local/team?tab=resources' },
  { previousRoutes: ['/workspace'], referrer: 'http://fixture.local/workspace' },
  { previousRoutes: ['/'], referrer: 'https://external.example.test/' },
  {},
 ]) {
  const f = await mount('/workspace', 'member', '隔离验证团队', false, 1, navigation)
  try {
   const back = f.document.querySelector('.workspace-back-button')
   check('会员空间返回首页，不随历史回到团队页 ' + JSON.stringify(navigation.previousRoutes || []), back?.tagName === 'A' && back.getAttribute('href') === '/')
   check('无团队会员空间仍正常展示', !!f.document.querySelector('.workspace-page') && !f.document.querySelector('.team-page'))
  } finally { f.dom.window.close() }
 }
 const missing = await mount('/team', 'member', '隔离验证团队', false, 1, { previousRoutes: ['/workspace'], referrer: 'http://fixture.local/workspace' })
 try {
  check('无团队时明确恢复至会员空间', missing.document.body.textContent.includes('你尚未加入团队空间') && missing.document.querySelector('.state-block a')?.getAttribute('href') === '/workspace')
 } finally { missing.dom.window.close() }
 const team = await mount('/team?tab=resources', 'member', '隔离验证团队', true, 1, { previousRoutes: ['/team', '/workspace'], referrer: 'http://fixture.local/workspace' })
 try {
  check('有团队时返回会员空间，不依赖历史记录', team.document.querySelector('.team-page-actions a[href="/workspace"]')?.textContent.includes('返回会员空间'))
  check('团队空间提供固定返回首页入口', team.document.querySelector('.team-page-actions a[href="/"]')?.textContent.includes('返回首页'))
  check('导航入口无页面错误', team.errors.length === 0)
 } finally { team.dom.window.close() }
})
await scenario('TEAM-CAPACITY-LABELS', async () => {
 const f=await mount('/team')
 try {
  const capacity=f.document.querySelector('.team-capacity-number')
  check('团队容量明确区分已用和总容量',capacity?.textContent.includes('已用')&&capacity.textContent.includes('总容量'))
  check('总容量展示团队1TB而非个人2TB',capacity?.textContent.includes('1024.00 GB')&&!capacity.textContent.includes('2048.00 GB'))
  check('成员用量说明与团队总容量一致',f.document.querySelector('.team-usage-description').textContent.includes('总容量 1024.00 GB'))
 } finally { f.dom.window.close() }
})
await scenario('TEAM-MEMBER-CAPACITY-PERCENTAGE', async () => {
 const gb=1024**3, mb=1024**2
 for(const item of [
  {label:'仅上传一个小文件',totalBytes:250*gb,usedBytes:4.6*mb,memberBytes:4.6*mb,text:'<0.01%',width:4.6/2560},
  {label:'团队仅此成员使用',totalBytes:250*gb,usedBytes:25*gb,memberBytes:25*gb,text:'10.0%',width:10},
  {label:'其他成员已用空间增加',totalBytes:250*gb,usedBytes:125*gb,memberBytes:25*gb,text:'10.0%',width:10},
  {label:'小于百分之一',totalBytes:250*gb,usedBytes:1.25*gb,memberBytes:1.25*gb,text:'0.50%',width:0.5},
  {label:'总容量已用满',totalBytes:250*gb,usedBytes:250*gb,memberBytes:250*gb,text:'100.0%',width:100},
  {label:'未上传文件',totalBytes:250*gb,usedBytes:0,memberBytes:0,text:'未使用',width:0},
  {label:'团队暂无容量',totalBytes:0,usedBytes:4,memberBytes:4,text:'0.00%',width:0},
 ]) {
  const f=await mount('/team','owner','隔离验证团队',true,1,{usageFixture:item})
  try {
   const row=[...f.document.querySelectorAll('.team-member-usage-row')].find(row=>row.querySelector('strong')?.textContent==='普通成员')
   const bar=row.querySelector('[role="progressbar"]')
   check(item.label+'百分比以团队总容量为准',row.querySelector('.team-usage-value em').textContent===(item.memberBytes?'占总容量 '+item.text:item.text))
   check(item.label+'进度条使用实际百分比',Math.abs(parseFloat(bar.querySelector('i').style.width)-item.width)<1e-9)
   check(item.label+'无障碍值与实际比例一致',Math.abs(Number(bar.getAttribute('aria-valuenow'))-item.width)<1e-9)
   check(item.label+'说明明确总容量口径',f.document.querySelector('.team-usage-description').textContent.includes('成员已用空间占团队总容量的百分比'))
   if(item.memberBytes)check(item.label+'提示采用总容量口径',bar.title==='占团队总容量 '+item.text)
   check(item.label+'页面无运行错误',f.errors.length===0)
  } finally {f.dom.window.close()}
 }
})
await scenario('TRASH-UNIFIED', async () => {
 const member=await mount('/trash?tab=team','member','隔离验证团队',true,1,{teamTrashFixture:true})
 try {
  await waitFor(()=>member.document.querySelector('.trash-scope-tabs')&&member.document.querySelector('.trash-row'),'member trash row loads')
  const tabs=[...member.document.querySelectorAll('.trash-scope-tabs [role="tab"]')]
  check('统一回收站提供个人与团队页签',tabs.length===2&&tabs.some(tab=>tab.textContent.includes('个人回收站'))&&tabs.some(tab=>tab.textContent.includes('团队回收站')))
  check('团队页签可通过链接直达并默认选中',member.document.querySelector('[role="tab"][aria-selected="true"]')?.textContent.includes('团队回收站'))
  const note=member.document.querySelector('.trash-retention-note')
  check('团队回收站说明保留期限、容量和恢复链接状态',note?.textContent.includes('团队资源保留 7 天')&&note?.textContent.includes('仍占用团队容量')&&note?.textContent.includes('分享保持关闭'))
  check('普通成员可恢复自己的资源但不能彻底删除',!!member.find('恢复')&&!member.find('彻底删除'))
  check('普通成员看不到清空团队回收站入口',!member.find('清空回收站'))
  check('加载团队回收站请求带当前会话',member.calls.some(call=>new URL(call.url,'http://fixture.local').pathname==='/api/account/team/trash'&&call.method==='GET'))
  await member.click('恢复')
  await waitFor(()=>member.document.body.textContent.includes('团队回收站为空'),'restore removes item from trash')
  check('恢复请求返回团队资源并提示分享仍关闭',member.calls.some(call=>call.url==='/api/account/team/trash/teamfile/restore'&&call.method==='POST')&&member.document.body.textContent.includes('分享仍保持关闭'))
  await member.click('个人回收站')
  await waitFor(()=>member.document.body.textContent.includes('个人回收站为空'),'personal tab loads')
  check('个人页签切换到个人回收站接口',member.calls.some(call=>new URL(call.url,'http://fixture.local').pathname==='/api/account/trash'&&call.method==='GET')&&!member.document.querySelector('.trash-scope-tabs [role="tab"][aria-selected="true"]')?.textContent.includes('团队'))
  check('成员回收站页面无运行错误',member.errors.length===0)
 } finally {member.dom.window.close()}
 const admin=await mount('/trash?tab=team','owner','隔离验证团队',true,1,{teamTrashFixture:true})
 try {
  await waitFor(()=>admin.document.querySelector('.trash-row'),'manager trash row loads')
  check('团队管理员可看到彻底删除操作',!!admin.find('彻底删除'))
  await admin.click('彻底删除')
  check('团队彻底删除使用页面确认弹窗',!!admin.document.querySelector('.confirm-modal')&&!admin.calls.some(call=>call.url==='/api/account/team/trash/teamfile'&&call.method==='DELETE'))
  const teamDialog=admin.document.querySelector('.confirm-modal')
  check('团队彻底删除弹窗说明文件数、容量和不可撤销',teamDialog?.textContent.includes('安全文件.txt')&&teamDialog?.textContent.includes('1 个文件')&&teamDialog?.textContent.includes('释放团队容量')&&teamDialog?.textContent.includes('无法撤销'))
  await admin.click('取消')
  check('取消团队彻底删除不发送请求',!admin.document.querySelector('.confirm-modal')&&!admin.calls.some(call=>call.url==='/api/account/team/trash/teamfile'&&call.method==='DELETE'))
  await admin.click('彻底删除')
  admin.document.querySelector('.confirm-modal .primary-button').click()
  await waitFor(()=>admin.document.body.textContent.includes('团队回收站为空'),'permanent deletion removes item')
  check('管理员永久删除请求清理团队资源',admin.calls.some(call=>call.url==='/api/account/team/trash/teamfile'&&call.method==='DELETE'))
  check('管理员回收站页面无运行错误',admin.errors.length===0)
 } finally {admin.dom.window.close()}
 const bulkAdmin=await mount('/trash?tab=team','owner','隔离验证团队',true,1,{teamTrashFixture:true})
 try {
  await waitFor(()=>bulkAdmin.document.querySelector('.trash-row'),'manager bulk trash loads')
  const bulkDeletesBefore=bulkAdmin.calls.filter(call=>call.method==='DELETE').length
  check('团队管理员可看到清空回收站入口',!!bulkAdmin.find('清空回收站')&&bulkAdmin.find('清空回收站')?.classList.contains('danger-lite'))
  await bulkAdmin.click('清空回收站')
  check('团队清空回收站使用页面确认弹窗',!!bulkAdmin.document.querySelector('.confirm-modal')&&bulkAdmin.calls.filter(call=>call.method==='DELETE').length===bulkDeletesBefore)
  const bulkDialog=bulkAdmin.document.querySelector('.confirm-modal')
  check('团队清空弹窗展示项目、文件数、容量和不可撤销',bulkDialog?.textContent.includes('1 个项目')&&bulkDialog?.textContent.includes('1 个文件')&&bulkDialog?.textContent.includes('释放团队容量')&&bulkDialog?.textContent.includes('无法撤销'))
  await bulkAdmin.click('取消')
  check('取消清空团队回收站不发送请求',!bulkAdmin.document.querySelector('.confirm-modal')&&bulkAdmin.calls.filter(call=>call.method==='DELETE').length===bulkDeletesBefore)
  await bulkAdmin.click('清空回收站')
  bulkAdmin.document.querySelector('.confirm-modal .primary-button').click()
  await waitFor(()=>bulkAdmin.document.body.textContent.includes('团队回收站为空'),'team trash emptied')
  check('清空团队回收站发送一次批量删除请求',bulkAdmin.calls.filter(call=>new URL(call.url,'http://fixture.local').pathname==='/api/account/team/trash'&&call.method==='DELETE').length===1)
  check('清空团队回收站提示容量释放并隐藏入口',bulkAdmin.document.body.textContent.includes('已清空团队回收站')&&bulkAdmin.document.body.textContent.includes('团队容量已释放')&&!bulkAdmin.find('清空回收站'))
  check('团队清空回收站无运行错误',bulkAdmin.errors.length===0)
 } finally {bulkAdmin.dom.window.close()}
 const peer=await mount('/trash?tab=team','peer','隔离验证团队',true,1,{teamTrashFixture:true})
 try {
  await waitFor(()=>peer.document.body.textContent.includes('团队回收站为空'),'peer sees scoped empty state')
  check('普通成员不能看到他人资源或彻底删除入口',!peer.document.querySelector('.trash-row')&&!peer.find('彻底删除'))
  check('普通成员看不到清空团队回收站入口',!peer.find('清空回收站'))
  check('无权限成员空状态无运行错误',peer.errors.length===0)
 } finally {peer.dom.window.close()}
 const solo=await mount('/trash','member','隔离验证团队',false)
 try {
  await waitFor(()=>solo.document.body.textContent.includes('个人回收站为空'),'solo personal trash loads')
  check('未加入团队时不展示团队回收站页签',!solo.document.querySelector('.trash-scope-tabs'))
  check('空回收站不显示清空入口',!solo.find('清空回收站'))
  check('个人回收站空状态无运行错误',solo.errors.length===0)
 } finally {solo.dom.window.close()}
 const teamShell=await mount('/team?tab=resources','member','隔离验证团队',true)
 try {
  const trashLink=teamShell.document.querySelector('.topbar-trash-link')
  const bell=teamShell.document.querySelector('.public-message-link[href*="panel=messages"]')
  check('团队页顶栏回收站入口位于通知左侧',trashLink?.getAttribute('href')==='/trash?tab=team'&&Boolean(bell)&&Boolean(trashLink.compareDocumentPosition(bell)&teamShell.window.Node.DOCUMENT_POSITION_FOLLOWING))
  check('团队页顶栏回收站使用垃圾筐图标',trashLink?.querySelector('svg')?.classList.contains('lucide-trash2')===true)
 } finally {teamShell.dom.window.close()}
 const workspaceShell=await mount('/workspace','member','隔离验证团队',false)
 try {
  check('会员空间顶栏回收站入口指向个人回收站',workspaceShell.document.querySelector('.topbar-trash-link')?.getAttribute('href')==='/trash')
 } finally {workspaceShell.dom.window.close()}
})
await scenario('TRASH-PAGINATION', async () => {
 const personalTrashItems=Array.from({length:18},(_,index)=>({id:`share-${index+1}`,kind:'share',name:`文件 ${index+1}.txt`,deletedAt:new Date(Date.now()-(index+1)*3600000).toISOString(),trashExpiresAt:new Date(Date.now()+6*86400000).toISOString(),fileCount:1,totalSize:10}))
 const f=await mount('/trash','member','隔离验证团队',false,1,{personalTrashItems})
 try {
  await waitFor(()=>f.document.querySelector('.trash-row'),'personal trash pagination loads')
  check('回收站每页最多展示 8 个项目',f.document.querySelectorAll('.trash-row').length===8)
  check('回收站分页显示总数与当前范围',f.document.querySelector('.trash-list-footer')?.textContent.includes('共 18 个项目')&&f.document.querySelector('.trash-list-footer')?.textContent.includes('第 1–8 个'))
  check('回收站分页提供页码',[...f.document.querySelectorAll('.trash-pagination button')].some(button=>button.textContent.trim()==='2'))
  await f.click('2')
  await waitFor(()=>f.document.querySelector('.trash-list-footer')?.textContent.includes('第 9–16 个'),'trash page 2 loads')
  check('翻页后展示下一页项目',f.document.querySelectorAll('.trash-row').length===8&&f.document.querySelector('.trash-pagination button.active')?.textContent.trim()==='2')
  const deletesBefore=f.calls.filter(call=>call.method==='DELETE').length
  await f.click('彻底删除')
  check('个人彻底删除使用页面确认弹窗',!!f.document.querySelector('.confirm-modal')&&f.calls.filter(call=>call.method==='DELETE').length===deletesBefore)
  const personalDialog=f.document.querySelector('.confirm-modal')
  check('个人彻底删除弹窗展示资源名称与不可恢复提示',personalDialog?.textContent.includes('文件 9.txt')&&personalDialog?.textContent.includes('无法恢复'))
  await f.click('取消')
  check('取消个人彻底删除不发送请求',!f.document.querySelector('.confirm-modal')&&f.calls.filter(call=>call.method==='DELETE').length===deletesBefore)
  await f.click('彻底删除')
  f.document.querySelector('.confirm-modal .primary-button').click()
  await waitFor(()=>f.document.querySelector('.trash-list-footer')?.textContent.includes('共 17 个项目'),'personal permanent deletion removes item')
  check('确认后仅发送一次个人彻底删除请求',f.calls.filter(call=>call.method==='DELETE').length===deletesBefore+1)
  const bulkDeletesBefore=f.calls.filter(call=>call.method==='DELETE').length
  check('个人回收站提供清空入口并使用危险样式',!!f.find('清空回收站')&&f.find('清空回收站')?.classList.contains('danger-lite'))
  await f.click('清空回收站')
  check('个人清空回收站使用页面确认弹窗',!!f.document.querySelector('.confirm-modal')&&f.calls.filter(call=>call.method==='DELETE').length===bulkDeletesBefore)
  const clearDialog=f.document.querySelector('.confirm-modal')
  check('个人清空弹窗展示全部项目数、文件数和不可撤销',clearDialog?.textContent.includes('17 个项目')&&clearDialog?.textContent.includes('17 个文件')&&clearDialog?.textContent.includes('无法撤销'))
  await f.click('取消')
  check('取消清空个人回收站不发送请求',!f.document.querySelector('.confirm-modal')&&f.calls.filter(call=>call.method==='DELETE').length===bulkDeletesBefore)
  await f.click('清空回收站')
  f.document.querySelector('.confirm-modal .primary-button').click()
  await waitFor(()=>f.document.body.textContent.includes('个人回收站为空'),'personal trash emptied')
  await waitFor(()=>f.document.body.textContent.includes('已清空个人回收站'),'personal clear toast')
  check('清空个人回收站发送一次批量删除请求',f.calls.filter(call=>new URL(call.url,'http://fixture.local').pathname==='/api/account/trash'&&call.method==='DELETE').length===1)
  check('清空个人回收站提示删除数量并隐藏入口',f.document.body.textContent.includes('已清空个人回收站')&&f.document.body.textContent.includes('共删除 17 个项目')&&!f.find('清空回收站')&&!f.document.querySelector('.trash-list-footer'))
  check('回收站分页无运行错误',f.errors.length===0)
 } finally {f.dom.window.close()}
})
await scenario('TRASH-REFRESH-FEEDBACK', async () => {
 const personalTrashItems=[{id:'share-refresh',kind:'share',name:'刷新反馈.txt',deletedAt:new Date(Date.now()-3600000).toISOString(),trashExpiresAt:new Date(Date.now()+6*86400000).toISOString(),fileCount:1,totalSize:10}]
 const f=await mount('/trash','member','隔离验证团队',false,1,{personalTrashItems,includeResourceStyles:true})
 try {
  await waitFor(()=>f.document.querySelector('.trash-row'),'personal refresh fixture loads')
  const loadsBefore=f.calls.filter(call=>new URL(call.url,'http://fixture.local').pathname==='/api/account/trash'&&call.method==='GET').length
  f.holdNextTrash()
  await f.click('刷新')
  await waitFor(()=>f.find('刷新中'),'refresh shows loading label')
  const loadingButton=f.find('刷新中')
  check('点击刷新立即显示加载文案与旋转图标',loadingButton?.disabled===true&&Boolean(loadingButton?.querySelector('.trash-refresh-icon.is-spinning')))
  check('刷新按钮宽度固定避免文案切换抖动',f.window.getComputedStyle(loadingButton).minWidth==='92px')
  f.releaseTrash()
  await waitFor(()=>f.document.querySelector('.toast.success')?.textContent.includes('个人回收站已刷新'),'personal refresh success toast')
  const toast=f.document.querySelector('.toast.success')
  const toastStyle=f.window.getComputedStyle(toast)
  const iconStyle=f.window.getComputedStyle(toast.querySelector('.toast-icon'))
  check('刷新成功提示使用绿色语义样式',toastStyle.color==='rgb(13, 122, 76)'&&toastStyle.backgroundColor==='rgb(240, 251, 245)'&&iconStyle.backgroundColor==='rgb(14, 159, 110)')
  check('刷新成功提示不再使用蓝色',toastStyle.color!=='rgb(39, 66, 107)'&&toastStyle.backgroundColor!=='rgb(239, 243, 250)')
  check('刷新后重新请求个人回收站并恢复按钮文案',f.calls.filter(call=>new URL(call.url,'http://fixture.local').pathname==='/api/account/trash'&&call.method==='GET').length===loadsBefore+1&&!!f.find('刷新')&&!f.find('刷新中'))
  check('个人刷新反馈无运行错误',f.errors.length===0)
 } finally {f.dom.window.close()}
 const team=await mount('/trash?tab=team','member','隔离验证团队',true,1,{teamTrashFixture:true,includeResourceStyles:true})
 try {
  await waitFor(()=>team.document.querySelector('.trash-row'),'team refresh fixture loads')
  await team.click('刷新')
  await waitFor(()=>team.document.querySelector('.toast.success')?.textContent.includes('团队回收站已刷新'),'team refresh success toast')
  check('团队刷新成功提示使用绿色语义样式',team.window.getComputedStyle(team.document.querySelector('.toast.success')).color==='rgb(13, 122, 76)')
  check('团队刷新反馈无运行错误',team.errors.length===0)
 } finally {team.dom.window.close()}
})
await scenario('TEAM-RESOURCE-DELETE', async () => {
 for (const role of ['owner', 'member', 'peer']) {
  const f = await mount('/team?tab=resources', role)
  try {
   const allowed = role !== 'peer'
   check(role + '移入回收站按钮与资源权限一致', !!f.find('移入回收站 安全文件.txt') === allowed)
   if (!allowed) continue
   await f.click('移入回收站 安全文件.txt')
   check(role + '删除前确认保留期限、容量和链接状态', f.document.querySelector('[role="dialog"]')?.textContent.includes('1 个文件') && f.document.querySelector('[role="dialog"]')?.textContent.includes('保留 7 天') && f.document.querySelector('[role="dialog"]')?.textContent.includes('仍占用团队容量') && !f.calls.some(c => c.method === 'DELETE'))
   await f.click('取消')
   check(role + '取消不发送删除请求', !f.calls.some(c => c.method === 'DELETE') && !!f.document.querySelector('.team-resource-row'))
   f.holdNextResourceDelete()
   await f.click('移入回收站 安全文件.txt')
   const confirm = f.find('移入回收站')
   confirm.click(); confirm.click()
   await waitFor(() => f.calls.some(c => c.url === '/api/account/team/resources/teamfile' && c.method === 'DELETE'), 'delete submitted')
   check(role + '移入期间防止重复操作', f.find('移入回收站 安全文件.txt')?.disabled === true && f.calls.filter(c => c.url === '/api/account/team/resources/teamfile' && c.method === 'DELETE').length === 1)
   f.releaseResourceDelete()
   await waitFor(() => !f.document.querySelector('.team-resource-row'), 'resource moved out of active list')
   await waitFor(() => f.document.body.textContent.includes('文件已移入团队回收站'), 'trash feedback')
   const capacityStat=[...f.document.querySelectorAll('.team-kpi')].find(item=>item.textContent.includes('已用容量'))
   check(role + '移入回收站后资源从列表隐藏且容量继续计入', capacityStat?.textContent.includes('4 B') && !f.document.querySelector('.team-resource-row'))
   check(role + '删除无页面运行错误', f.errors.length === 0)
  } finally { f.releaseResourceDelete(); f.dom.window.close() }
 }
 const f = await mount('/team?tab=resources', 'member')
 try {
  f.failNextResourceDelete()
  await f.click('移入回收站 安全文件.txt'); await f.click('移入回收站')
  check('删除失败保留文件且显示权限提示', !!f.document.querySelector('.team-resource-row') && f.document.body.textContent.includes('你已失去删除权限'))
  check('失败后可重新操作', f.find('移入回收站 安全文件.txt')?.disabled === false)
 } finally { f.dom.window.close() }
 const batch = await mount('/team?tab=resources', 'owner', '隔离验证团队', true, 2)
 try {
  await batch.click('移入回收站 安全文件.txt')
  check('批量资源确认明确整组删除数量', batch.document.querySelector('[role="dialog"]')?.textContent.includes('2 个文件'))
  await batch.click('取消')
  check('取消批量删除保留整组资源', !!batch.document.querySelector('.team-resource-row') && !batch.calls.some(c => c.method === 'DELETE'))
 } finally { batch.dom.window.close() }
})
await scenario('TEAM-RESOURCE-ACTION-ALIGNMENT', async () => {
 const f=await mount('/team?tab=resources','owner','隔离验证团队',true,1,{includeReadOnlyResource:true,includeResourceStyles:true})
 try {
  const rows=[...f.document.querySelectorAll('.team-resource-row')]
  const actionWidths=rows.map(row=>f.window.getComputedStyle(row.querySelector('.team-resource-actions')).width)
  const gridTracks=rows.map(row=>f.window.getComputedStyle(row).gridTemplateColumns)
  const statusStyles=rows.map(row=>f.window.getComputedStyle(row.querySelector('.team-resource-status')))
  check('可删除与只读团队资源同时显示',rows.length===2)
  check('无删除权限的资源仍隐藏删除按钮',!!rows[0].querySelector('.team-resource-delete')&&!rows[1].querySelector('.team-resource-delete'))
  check('不同权限行保留相同操作区宽度和列表列轨道',actionWidths.every(width=>width==='134px')&&gridTracks.every(tracks=>tracks===gridTracks[0]))
  check('状态底色贴合文字并保持居中',statusStyles.every(style=>style.display==='inline-flex'&&style.width==='max-content'&&style.justifySelf==='center'&&style.alignItems==='center'))
 } finally { f.dom.window.close() }
})
await scenario('TEAM-012-PICKERS',async()=>{
 const f=await mount('/team?tab=resources','member')
 try{
  check('团队页有批量文件和文件夹入口',!!f.find('批量上传文件')&&!!f.find('上传文件夹'))
  const filePicker=f.document.querySelector('input[type="file"]:not([webkitdirectory])'),folderPicker=f.document.querySelector('input[webkitdirectory]')
  check('文件和文件夹选择器支持多文件',filePicker.multiple&&folderPicker.multiple)
  let opened=0;folderPicker.addEventListener('click',e=>{opened++;e.preventDefault()})
  await f.click('上传文件夹');check('文件夹入口打开目录选择器',opened===1)
  const first=f.file('甲.txt'),second=f.file('乙.txt'),third=f.file('丙.txt')
  await f.choose([first,second,third])
  check('批量选中全部文件且可查看清单',f.document.querySelectorAll('.team-upload-files li').length===3)
  await f.choose([]);check('取消选择保留待上传文件',f.document.querySelectorAll('.team-upload-files li').length===3)
  await f.choose([first,f.file('丁.txt')]);check('追加选择不覆盖且同一文件去重',f.document.querySelectorAll('.team-upload-files li').length===4)
  await f.click('移除 乙.txt');check('移除单个文件保留其余文件',f.document.querySelectorAll('.team-upload-files li').length===3&&!f.document.querySelector('.team-upload-files').textContent.includes('乙.txt'))
  await f.choose([f.file('同名.txt','资料/甲/同名.txt'),f.file('同名.txt','资料/乙/同名.txt')],true)
  check('不同目录同名文件都保留且展示层级',f.document.querySelectorAll('.team-upload-files li').length===5&&f.document.querySelector('.team-upload-files').textContent.includes('资料/乙/同名.txt'))
  await f.click('开始上传');await waitFor(()=>f.calls.some(c=>c.url==='/api/upload-sessions'),'team upload manifest')
  const manifest=JSON.parse(f.calls.find(c=>c.url==='/api/upload-sessions').body)
  check('团队批量上传发送全部文件和完整路径',manifest.mode==='team_resource'&&JSON.stringify(manifest.files.map(x=>x.relativePath))===JSON.stringify(['甲.txt','丙.txt','丁.txt','资料/甲/同名.txt','资料/乙/同名.txt']))
  await f.click('清除待上传文件');check('清空后移除待上传清单',!f.document.querySelector('.team-upload-files')&&!f.find('开始上传'))
  await f.choose(Array.from({length:101},(_,i)=>f.file('边界'+i+'.txt')))
  check('超出批量上限时提示并禁止上传',f.find('开始上传').disabled&&f.document.body.textContent.includes('单次最多上传 100 个文件'))
  await f.click('移除 边界100.txt');check('移除超限文件后可以上传',!f.find('开始上传').disabled&&f.document.querySelectorAll('.team-upload-files li').length===100)
  check('团队文件选择无运行错误',!f.errors.length)
 }finally{f.dom.window.close()}
})
await scenario('TEAM-UPLOAD-RISK-DETAILS', async () => {
 for (const failure of [
  {code:'scan_threat_detected',message:'疑似木马程序，已阻止发布',scanFile:'安装包/截图助手.rar',scanFinding:{label:'疑似木马程序',signature:'Win.Trojan.Fixture-1',advice:'请勿运行该文件；使用杀毒软件检查并从官方来源重新获取。'}},
  {code:'scan_size_limit',message:'压缩包嵌套层数超过安全扫描上限，请减少嵌套后再上传',scanFile:'资料/多层压缩包.zip',scanLimit:'MaxRecursion'},
 ]) {
  const f=await mount('/team?tab=resources','member','隔离验证团队',true,1,{uploadFailure:failure})
  try {
   await f.choose([f.file('fixture.txt')]);await f.click('开始上传')
   await waitFor(()=>f.document.querySelector('.upload-security-failure'),'persistent risk explanation shown')
   const panel=f.document.querySelector('.upload-security-failure')
   check('团队上传明确显示涉及文件 '+failure.code,panel.textContent.includes(failure.scanFile))
   check('团队上传说明拦截原因 '+failure.code,panel.textContent.includes(failure.scanFinding?.label||failure.message))
   if(failure.scanFinding){check('团队上传显示检测名称与处理建议',panel.textContent.includes(failure.scanFinding.signature)&&panel.textContent.includes(failure.scanFinding.advice));check('威胁拦截不允许继续发布',f.find('风险文件已阻止')?.disabled)}
   else check('扫描限制可重试且不标为威胁',!!f.find('重试安全检查')&&!panel.textContent.includes('风险类型'))
   await delay(3300)
   check('临时通知消失后具体原因仍保留 '+failure.code,!!f.document.querySelector('.upload-security-failure'))
   await f.click('清除待上传文件')
   check('清除上传后移除旧风险说明 '+failure.code,!f.document.querySelector('.upload-security-failure'))
   check('风险说明无运行错误 '+failure.code,!f.errors.length)
  } finally {f.dom.window.close()}
 }
})
await scenario('TEAM-001',async()=>{for(const [route,title] of [['/team','登录后查看团队'],['/workspace','登录后使用团队空间']]){const f=await mount(route,'');try{check('游客页面要求登录 '+route,f.document.body.textContent.includes(title));check('游客不读取团队管理数据 '+route,!f.calls.some(c=>c.url==='/api/account/team/overview'||c.url==='/api/account/workspace'));check('游客无团队名称/管理按钮 '+route,!f.document.body.textContent.includes('隔离验证团队')&&!f.find('解散团队'))}finally{f.dom.window.close()}}})
await scenario('TEAM-NAME-BOUNDARIES', async () => {
 const f = await mount('/workspace')
 try {
  // Existing team: exercise the real rename form; reuse the no-team response for creation below.
  await f.click('编辑团队名称')
  const field = f.document.querySelector('input[aria-label="团队名称"]')
  await f.input(field, '名'.repeat(81))
  check('修改团队名称超长粘贴限制为80字符', field.value === '名'.repeat(80))
  await f.input(field, '名'.repeat(79) + '😀')
  check('团队名称不会截断半个emoji', field.value === '名'.repeat(79))
  await f.input(field, '   ')
  check('空白名称不能保存', f.find('保存团队名称').disabled)
  await f.input(field, '名'.repeat(80))
  await f.click('保存团队名称')
  check('80字符名称完整提交', f.calls.some(c => c.url === '/api/account/workspace' && c.method === 'PATCH' && JSON.parse(c.body).name === '名'.repeat(80)))
 } finally { f.dom.window.close() }
 const create = await mount('/workspace', 'owner', '创建边界测试', false)
 try {
  const field = create.document.querySelector('input[placeholder="例如：鲲穹设计团队"]')
  check('创建团队名称原生限制80字符', field.maxLength === 80)
  await create.input(field, '   ')
  check('空白团队名称不能创建', create.find('创建团队').disabled)
  await create.input(field, '名'.repeat(81))
  check('创建团队名称超长粘贴受限', field.value === '名'.repeat(80))
  await create.input(field, '名'.repeat(79) + '😀')
  check('创建团队名称不保留半个emoji', field.value === '名'.repeat(79))
  await create.input(field, '名'.repeat(80))
  await create.click('创建团队')
  check('创建团队完整提交80字符', create.calls.some(c => c.url === '/api/account/workspace' && c.method === 'POST' && JSON.parse(c.body).name === '名'.repeat(80)))
 } finally { create.dom.window.close() }
})
await scenario('TEAM-003',async()=>{
 const f=await mount('/team?tab=resources')
 try{
  check('团队管理页有明确的编辑名称入口',!!f.find('编辑团队名称'))
  const inviteLink='http://fixture.local/e/team-slug/share/'
  await f.click('邀请成员')
  check('团队邀请入口复制当前邀请链接',f.copiedTexts.at(-1)===inviteLink)
  await f.click('编辑团队名称')
  const field=f.document.querySelector('input[aria-label="团队名称"]')
  check('团队管理页名称输入限制80字符',field.maxLength===80)
  await f.input(field,'名'.repeat(81))
  check('团队管理页超长粘贴限制80字符',field.value==='名'.repeat(80))
  await f.input(field,'   ')
  check('团队管理页空白名称禁止保存',f.find('保存团队名称').disabled)
  await f.input(field,'UI改名团队')
  await f.click('保存团队名称')
  await waitFor(()=>f.document.querySelector('.team-page-heading h1')?.textContent.trim()==='UI改名团队','team name shown')
  check('改名只提交一次且参数正确',f.calls.filter(c=>c.url==='/api/account/workspace'&&c.method==='PATCH').length===1&&JSON.parse(f.calls.find(c=>c.method==='PATCH').body).name==='UI改名团队')
  await f.click('邀请成员')
  check('改名后邀请链接稳定',f.copiedTexts.at(-1)===inviteLink)
  check('改名后保留团队资源栏目',!!f.document.querySelector('.team-resource-table'))
  await f.click('编辑团队名称')
  await f.input(f.document.querySelector('input[aria-label="团队名称"]'),'取消的名称')
  await f.click('取消编辑团队名称')
  check('取消编辑保持原名且不请求保存',f.document.querySelector('.team-page-heading h1').textContent.trim()==='UI改名团队'&&f.calls.filter(c=>c.method==='PATCH').length===1)
  await f.click('编辑团队名称')
  await f.input(f.document.querySelector('input[aria-label="团队名称"]'),'重复团队')
  f.failNextRename()
  await f.click('保存团队名称')
  check('服务端拒绝时提示可见并保留输入',f.document.body.textContent.includes('团队名称已存在')&&f.document.querySelector('input[aria-label="团队名称"]').value==='重复团队')
  await f.click('取消编辑团队名称')
  check('保存失败不改变团队名称且邀请入口仍可用',f.document.querySelector('.team-page-heading h1').textContent.trim()==='UI改名团队'&&!!f.find('邀请成员'))
  check('团队改名无运行错误',!f.errors.length)
 }finally{f.dom.window.close()}
 const member=await mount('/team','member')
 try{check('普通成员没有编辑名称入口',!member.find('编辑团队名称')&&!member.document.querySelector('input[aria-label="团队名称"]'))}finally{member.dom.window.close()}
})
await scenario('TEAM-INPUT-LIMITS', async () => {
 const f = await mount()
 try {
  const longText = '测试'.repeat(100)
  for (const field of [
   { name: '邀请成员', selector: '.team-invite-form input' },
   { name: '成员观察搜索', selector: '.team-search input' },
   { name: '团队资源搜索', selector: '.team-resource-toolbar .team-search input', tab: '团队资源' },
   { name: '成员权限搜索', selector: '.team-management-search input', tab: '团队成员' },
  ]) {
   if (field.tab) { [...f.document.querySelectorAll('[role="tab"]')].find(b => b.textContent.includes(field.tab)).click(); await delay(30) }
   const input = f.document.querySelector(field.selector)
   await f.input(input, longText)
   check(field.name + '超长粘贴受限', input.value === longText.slice(0, 160))
   check(field.name + '原生输入限制', input.maxLength === 160)
   await f.input(input, '正常查询')
   check(field.name + '正常输入保留', input.value === '正常查询')
  }
  await delay(220)
  check('候选查询不发送超长值', f.calls.filter(c => c.url.startsWith('/api/account/workspace/member-search')).every(c => new URL(c.url, 'http://fixture.local').searchParams.get('q').length <= 160))
 } finally { f.dom.window.close() }
})
await scenario('TEAM-004',async()=>{const f=await mount();try{await f.input(f.document.querySelector('input[placeholder*="直接邀请成员"]'),'candidate');await waitFor(()=>f.document.querySelector('.team-suggestions button'),'suggestions');f.document.querySelector('.team-suggestions button').click();await delay(30);await f.click('邀请');check('脱敏候选通过账号ID邀请',f.calls.some(c=>c.url==='/api/account/workspace/members'&&JSON.parse(c.body).target==='candidate'))}finally{f.dom.window.close()}})
await scenario('TEAM-005',async()=>{for(const suffix of ['/share/','/collect/','/']){const f=await mount('/e/team-slug'+suffix,'');try{await waitFor(()=>f.document.body.textContent.includes('登录后申请加入'),'invite login');check('无token显示入团落地页 '+suffix,f.document.body.textContent.includes('你收到一个团队空间邀请')&&f.document.body.textContent.includes('隔离验证团队'));check('入口探测正确团队 '+suffix,f.calls.some(c=>c.url==='/api/organizations/team-slug/join-request'));check('未请求空token资源 '+suffix,!f.calls.some(c=>c.url.startsWith('/api/shares/')||c.url.startsWith('/api/collections/')))}finally{f.dom.window.close()}}const f=await mount('/e/wrong/');try{check('无效邀请明确提示',f.document.body.textContent.includes('这个邀请链接已失效'))}finally{f.dom.window.close()}})
await scenario('TEAM-007',async()=>{for(const role of ['owner','admin','member']){const f=await mount('/team',role);try{const manager=['owner','admin'].includes(role);check(role+' 管理栏目权限一致',!![...f.document.querySelectorAll('[role="tab"]')].find(b=>b.textContent.includes('团队成员'))===manager);check(role+' 搜索邀请权限一致',!!f.document.querySelector('input[placeholder*="直接邀请成员"]')===manager);if(manager){const tab=[...f.document.querySelectorAll('[role="tab"]')].find(b=>b.textContent.includes('团队成员'));tab.click();await delay(30)}check(role+' 解散按钮权限一致',!!f.find('解散团队')===(role==='owner'));check(role+' 退出按钮权限一致',!!f.find('退出团队空间')===(role!=='owner'));check(role+' 无运行错误',f.errors.length===0)}finally{f.dom.window.close()}}})

await scenario('TEAM-PASSWORD-AND-LIMIT',async()=>{
 for (const role of ['owner','admin','member','peer']) {
  const f=await mount('/team?tab=resources',role,'隔离验证团队',true,1,{resourcePassword:true})
  try {
   let anchors=0, invalidations=0
   f.document.addEventListener('click',event=>{if(event.target.tagName==='A'&&event.target.download){anchors++;event.preventDefault()}})
   f.window.addEventListener('kunqiong:account-session',()=>invalidations++)
   await f.click('下载 安全文件.txt')
   await waitFor(()=>f.document.querySelector('.download-progress input[type=password]'),'download password prompt')
   check(role+' 未解锁不发起文件下载',anchors===0&&f.calls.filter(c=>String(c.url).includes('/api/shares/')).every(c=>c.method==='HEAD'))
   await f.input(f.document.querySelector('.download-progress input'),'wrong');await f.click('验证并下载')
   check(role+' 错误密码保留输入入口',!!f.document.querySelector('.download-progress input')&&f.document.body.textContent.includes('提取密码不正确')&&anchors===0)
   await f.input(f.document.querySelector('.download-progress input'),'中文密码123');await f.click('验证并下载')
   await waitFor(()=>anchors===1,'native download after unlock')
   check(role+' 中文密码JSON解锁后下载',f.calls.some(c=>c.method==='POST'&&JSON.parse(c.body).password==='中文密码123')&&f.document.body.textContent.includes('已交给浏览器下载'))
   check(role+' 密码不进入URL或HTTP头',f.calls.every(c=>!String(c.url).includes('中文密码')&&!c.headers?.['x-share-password']))
   check(role+' 密码错误不注销账号',invalidations===0&&!!f.document.querySelector('.team-page'))
   f.exhaustDownloads();await f.click('下载 安全文件.txt')
   check(role+' 次数耗尽禁止再次下载',anchors===1&&f.document.body.textContent.includes('下载次数已用完'))
  } finally {f.dom.window.close()}
  const preview=await mount('/team?tab=resources',role,'隔离验证团队',true,1,{resourcePassword:true})
  try {
   await preview.click('预览 安全文件.txt')
   await waitFor(()=>preview.document.querySelector('.preview-modal input[type=password]'),'preview password prompt')
   check(role+' 密码校验前不读取正文',!preview.calls.some(c=>String(c.url).includes('/api/shares/')&&c.method==='GET'))
   await preview.input(preview.document.querySelector('.preview-modal input'),'wrong');await preview.click('验证并预览')
   check(role+' 错误密码不展示正文',preview.document.body.textContent.includes('提取密码不正确')&&!preview.document.querySelector('.text-preview'))
   await preview.input(preview.document.querySelector('.preview-modal input'),'中文密码123');await preview.click('验证并预览')
   await waitFor(()=>preview.document.querySelector('.text-preview'),'preview content after unlock')
   check(role+' 正确密码才展示正文',preview.document.querySelector('.text-preview').textContent==='团队正文')
   check(role+' 密码交互无页面错误',preview.errors.length===0)
  } finally {preview.dom.window.close()}
 }
})

await scenario('TEAM-CLOSED-MANAGEMENT',async()=>{
 for(const role of ['owner','admin','member','peer']){
  const f=await mount('/team?tab=resources',role,'隔离验证团队',true,1,{resourceStatus:'closed'});
  try{
   check(role+' 已关闭文件预览权限一致',f.find('预览 安全文件.txt')?.disabled===(role==='peer'));
   check(role+' 已关闭文件下载权限一致',f.find('下载 安全文件.txt')?.disabled===(role==='peer'));
   if(role!=='peer'){
    await f.click('预览 安全文件.txt');
    await waitFor(()=>f.calls.some(call=>String(call.url).includes('/api/shares/manage/test/files/0/preview')),'管理预览请求');
    check(role+' 预览使用管理接口',f.calls.some(call=>String(call.url).includes('/api/shares/manage/test/files/0/preview')));
   }
  }finally{f.dom.window.close()}
 }
})

await scenario('TEAM-ADMIN-CONTROLS',async()=>{
 const owner=await mount('/team','owner');try{
  await owner.click('团队成员 2');
  check('所有者可见任命按钮',!!owner.find('将普通成员设为管理员'));
  await owner.click('将普通成员设为管理员');check('任命先确认',!owner.calls.some(call=>call.url.endsWith('/role')));await owner.click('取消');check('取消角色修改无请求',!owner.calls.some(call=>call.url.endsWith('/role')));
  await owner.click('将普通成员设为管理员');await owner.click('确认修改');check('提交管理员角色',owner.calls.some(call=>call.url.endsWith('/role')&&JSON.parse(call.body).role==='admin'));
  await waitFor(()=>!!owner.find('取消普通成员的管理员身份'),'管理员任命后按钮更新');
  owner.failNextRoleChange();await owner.click('取消普通成员的管理员身份');await owner.click('确认修改');check('拒绝时角色保留',!!owner.find('取消普通成员的管理员身份')&&owner.document.body.textContent.includes('角色调整被拒绝'));
  check('角色操作无运行错误',owner.errors.length===0);
 }finally{owner.dom.window.close()}
 const adminWorkspace=await mount('/workspace','admin');try{check('管理员会员空间无改名入口',!adminWorkspace.find('编辑团队名称'));check('管理员会员空间正确标识角色',adminWorkspace.document.body.textContent.includes('团队管理员'));}finally{adminWorkspace.dom.window.close()}
 const admin=await mount('/team','admin');try{
  check('管理员无改名入口',!admin.find('编辑团队名称'));
   await admin.click('团队成员 2');check('管理员无所有权和任免按钮',!admin.find('解散团队')&&!admin.find('转让给普通成员')&&!admin.find('将普通成员设为管理员')&&!admin.document.querySelector('.team-handover-panel'));
  check('管理员能移除普通成员',!!admin.find('移除普通成员'));
  check('管理员有退出入口',!!admin.find('退出团队空间'));
 }finally{admin.dom.window.close()}
})

await scenario('TEAM-009',async()=>{
 const f=await mount()
 try{
  await f.click('团队成员 2');await f.click('转让给普通成员')
  check('交接先确认且未提交',!!f.document.querySelector('[role="dialog"]')&&!f.calls.some(c=>c.url.endsWith('transfer-ownership')))
  check('提示明确待确认和套餐保留',f.document.querySelector('[role="dialog"]').textContent.includes('对方接受后')&&f.document.querySelector('[role="dialog"]').textContent.includes('套餐和容量继续保留'))
  await f.click('取消');check('取消发起不发送请求',!f.calls.some(c=>c.url.endsWith('transfer-ownership')))
  await f.click('转让给普通成员');await f.click('发起交接')
  check('交接只提交一次',f.calls.filter(c=>c.url.endsWith('transfer-ownership')).length===1)
   check('在团队成员页发起后显示待确认事项并保持所有者权限',!!f.document.querySelector('.team-handover-pending')&&new URL(f.window.location.href).searchParams.get('tab')==='manage'&&!!f.find('团队设置')&&!f.find('退出团队空间'))
   check('交接与成员列表共用团队成员页面',!!f.document.querySelector('.team-management-list')&&!!f.document.querySelector('.team-kpi-grid')&&!f.find('负责人交接 1'))
  check('所有者可取消待办且不能代确认',!!f.find('取消本次交接')&&!f.find('接受交接'))
   check('待确认时不显示第二次交接入口',!f.find('转让给普通成员'))
   await f.click('取消本次交接');await f.click('再想想')
  check('取消决定未确认时无请求',!f.calls.some(c=>c.url.includes('ownership-handovers/')))
  await f.click('取消本次交接');await f.click('确认取消交接')
  check('确认取消后记录更新',!f.document.querySelector('.team-handover-pending')&&f.document.querySelector('.team-handover-history').textContent.includes('已取消'))
   check('团队成员页交接流程无运行错误',!f.errors.length)
 }finally{f.dom.window.close()}
})
await scenario('TEAM-HANDOVER-RECIPIENT',async()=>{
 const pending={id:'recipient-1',fromName:'所有者',toName:'普通成员',initiatedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),canRespond:true,canCancel:false}
 for(const decision of ['accept','decline']){
   const f=await mount('/team?tab=members','member','隔离验证团队',true,1,{pendingHandover:pending})
  try{
    check('普通接收者在原成员页查看交接并处理',!!f.find('接受交接')&&!!f.find('拒绝交接')&&!f.find('取消本次交接')&&!!f.document.querySelector('.team-handover-panel'))
   await f.click(decision==='accept'?'接受交接':'拒绝交接');await f.click('再想想')
   check(decision+'取消确认不提交',!f.calls.some(c=>c.url.includes('ownership-handovers/')))
   f.holdNextHandover();await f.click(decision==='accept'?'接受交接':'拒绝交接')
   const confirm=f.find(decision==='accept'?'确认接受':'确认拒绝');confirm.click();confirm.click()
   await waitFor(()=>f.calls.some(c=>c.url.includes('ownership-handovers/')),'decision submitted')
   check(decision+'处理中禁用按钮并防重复',f.find('接受交接').disabled&&f.calls.filter(c=>c.url.includes('ownership-handovers/')).length===1)
   f.releaseHandover();await waitFor(()=>!f.document.querySelector('.team-handover-pending')&&f.document.querySelector('.team-handover-history'),'decision resolved with history')
   check(decision+'结果和授权正确',f.document.querySelector('.team-handover-history').textContent.includes(decision==='accept'?'已完成':'已拒绝')&&!!f.find('团队设置')===(decision==='accept'))
    check(decision+'留在团队成员页面且无运行错误',new URL(f.window.location.href).searchParams.get('tab')===(decision==='accept'?'manage':'members')&&!f.errors.length)
  }finally{f.releaseHandover();f.dom.window.close()}
 }
  const failed=await mount('/team?tab=members','member','隔离验证团队',true,1,{pendingHandover:pending})
 try{failed.failNextHandover();await failed.click('接受交接');await failed.click('确认接受');check('交接失败显示原因并恢复操作',failed.document.body.textContent.includes('交接已失效')&&!failed.find('接受交接').disabled&&!failed.find('团队设置'))}finally{failed.dom.window.close()}
 const history=Array.from({length:7},(_,index)=>({id:'history-'+index,fromName:'发起人'+index,toName:'接收人'+index,status:'canceled',initiatedAt:new Date().toISOString(),resolvedAt:new Date().toISOString()}))
  const paged=await mount('/team?tab=manage','owner','隔离验证团队',true,1,{handoverHistory:history})
 try{check('记录每页最多五条',paged.document.querySelectorAll('.team-handover-history li').length===5);await paged.click('下一页');check('记录分页可查看剩余条目',paged.document.querySelectorAll('.team-handover-history li').length===2&&paged.document.querySelector('.team-handover-history').textContent.includes('发起人6'))}finally{paged.dom.window.close()}
  const legacyOwner=await mount('/team?tab=handover','owner','隔离验证团队',true,1,{pendingHandover:{...pending,canRespond:false,canCancel:true}})
  try{check('旧负责人交接链接自动落到团队成员管理',new URL(legacyOwner.window.location.href).searchParams.get('tab')==='manage'&&!!legacyOwner.document.querySelector('.team-handover-panel'))}finally{legacyOwner.dom.window.close()}
  const legacyRecipient=await mount('/team?tab=handover','member','隔离验证团队',true,1,{pendingHandover:pending})
  try{check('旧接收人交接链接自动落到原团队成员页',new URL(legacyRecipient.window.location.href).searchParams.get('tab')===null&&!!legacyRecipient.find('接受交接'))}finally{legacyRecipient.dom.window.close()}
})
await scenario('TEAM-010',async()=>{const f=await mount('/team','member');try{await f.click('退出团队空间');await f.click('再想想');check('取消退出无请求',!f.calls.some(c=>c.url.endsWith('/leave')));await f.click('退出团队空间');await f.click('确认退出');check('退出提交一次',f.calls.filter(c=>c.url.endsWith('/leave')).length===1);check('退出后清除团队面板',f.document.body.textContent.includes('暂未加入团队空间')&&!f.document.querySelector('.team-kpi-grid'))}finally{f.dom.window.close()}})
await scenario('TEAM-011',async()=>{const f=await mount();try{[...f.document.querySelectorAll('[role="tab"]')].find(b=>b.textContent.includes('团队成员')).click();await delay(30);await f.click('解散团队');check('解散先确认且未发请求',!!f.document.querySelector('[role="dialog"]')&&!f.calls.some(c=>c.url.endsWith('/dissolve')));await f.click('取消');check('取消第一步保持团队',!f.calls.some(c=>c.url.endsWith('/dissolve'))&&!!f.document.querySelector('.team-kpi-grid'));await f.click('解散团队');await f.click('下一步');await f.click('再想想');check('取消最终确认不解散',!f.calls.some(c=>c.url.endsWith('/dissolve')));await f.click('解散团队');await f.click('下一步');await f.click('确认解散');check('两次确认后仅一次解散',f.calls.filter(c=>c.url.endsWith('/dissolve')).length===1)}finally{f.dom.window.close()}})
await scenario('TEAM-013',async()=>{const html='<img src=x onerror=alert(1)>';const f=await mount('/team','owner',html);try{check('团队名称HTML按文本展示',f.document.body.textContent.includes(html));check('无脚本或事件属性注入',!f.document.querySelector('img[src=x],[onerror]'))}finally{f.dom.window.close()}})

const result={executedAt:new Date().toISOString(),passed,failures,cases,environment:'JSDOM real production React bundle, HTTP fixtures'}
if(process.env.TEAM_TEST_EVIDENCE_DIR){fs.mkdirSync(process.env.TEAM_TEST_EVIDENCE_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.TEAM_TEST_EVIDENCE_DIR,'team-ui-results.json'),JSON.stringify(result,null,2))}
console.log(JSON.stringify(result,null,2));process.exitCode=failures.length?1:0
