// Temporary browser fixture: synthetic OAuth and administrator, real local ClamAV.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
const root=path.resolve(import.meta.dirname,'..'),fixture=process.argv[2]?path.resolve(process.argv[2]):fs.mkdtempSync(path.join(os.tmpdir(),'kunqiong-browser-'))
if(!fixture.startsWith(path.join(os.tmpdir(),'kunqiong-browser-')))throw Error('Requires disposable browser fixture')
function copy(a,b){fs.mkdirSync(b,{recursive:true});for(const e of fs.readdirSync(a,{withFileTypes:true})){const x=path.join(a,e.name),y=path.join(b,e.name);if(e.isDirectory())copy(x,y);else fs.copyFileSync(x,y)}}
for(const name of['server','dist','email-templates'])copy(path.join(root,name),path.join(fixture,name))
for(const name of['server.mjs','package.json'])fs.copyFileSync(path.join(root,name),path.join(fixture,name))
if(!fs.existsSync(path.join(fixture,'node_modules')))fs.symlinkSync(path.join(root,'node_modules'),path.join(fixture,'node_modules'),process.platform==='win32'?'junction':'dir')
const now=new Date().toISOString(),future=new Date(Date.now()+86400000).toISOString()
const user={id:'browser-owner',username:'browser-owner',nickname:'验收测试用户',planId:'enterprise',status:'active',organizationId:'browser-team',organizationRole:'owner'}
const file={name:'验收安全文本.txt',storedName:'safe.txt',size:12,mimeType:'text/plain',reviewStatus:'clean',scanEngine:'clamav',scannedAt:now}
const share={id:'browser-share',manageToken:'browser-share-manage',code:'BRTEST',ownerUserId:user.id,status:'active',expiresAt:future,createdAt:now,files:[file]}
const task={id:'browser-task',token:'browser-task',manageToken:'browser-task-manage',title:'验收收集任务',description:'仅用于测试',deadline:future,maxFileSizeMb:500,allowedTypes:['全部格式'],ownerUserId:user.id,status:'active',createdAt:now,submissions:[]}
fs.mkdirSync(path.join(fixture,'storage/files/browser-share'),{recursive:true});fs.writeFileSync(path.join(fixture,'storage/files/browser-share/safe.txt'),'safe fixture')
if(!fs.existsSync(path.join(fixture,'storage/metadata.json')))fs.writeFileSync(path.join(fixture,'storage/metadata.json'),JSON.stringify({users:{[user.id]:user},sessions:[],shares:[share],collections:[task],organizations:{'browser-team':{id:'browser-team',slug:'browser-team',name:'验收测试团队',ownerUserId:user.id,createdAt:now,members:[{id:'browser-owner-member',userId:user.id,role:'owner',status:'active',displayName:user.nickname,joinedAt:now}]}},records:{[user.id]:[{id:'my_sent:share:browser-share',kind:'share',scope:'my_sent',name:file.name,shareId:share.id,manageToken:share.manageToken,shareUrl:'http://localhost:18045/share/browser-share',status:'有效',createdAt:now,files:[file]}]}}))
const mock=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost:18046');res.setHeader('content-type','application/json');if(url.pathname==='/authorize'){res.setHeader('content-type','text/html; charset=utf-8');const target=new URL(url.searchParams.get('redirect_uri'));target.searchParams.set('state',url.searchParams.get('state'));target.searchParams.set('code','fixture-only');res.end('<h1>隔离验收登录</h1><p>仅使用合成账号。</p><a href="'+target.href.replaceAll('&','&amp;')+'">测试账号登录</a>');return}if(url.pathname==='/oauth/token'){res.end(JSON.stringify({code:200,data:{access_token:'synthetic-only',api_web_token:'synthetic-only',expires_in:3600,user}}));return}res.end(JSON.stringify({code:1,data:{packages:[{id:1,name:'会员版',price_yuan:19,days:30},{id:2,name:'团队版',price_yuan:49,days:90},{id:5,name:'企业版',price_yuan:159,days:0}]}}))})
await new Promise(r=>mock.listen(18046,'127.0.0.1',r))
const env={...process.env};for(const k of Object.keys(env))if(/^(KUNQIONG_|OAUTH_)/.test(k))delete env[k]
const child=spawn(process.execPath,['server.mjs'],{cwd:fixture,windowsHide:true,env:{...env,PORT:'18045',NODE_ENV:'production',KUNQIONG_DB_ENABLED:'false',KUNQIONG_HOST:'127.0.0.1',KUNQIONG_SCAN_MODE:'required',KUNQIONG_CLAMAV_HOST:'127.0.0.1',KUNQIONG_CLAMAV_PORT:'3310',KUNQIONG_ADMIN_USERNAME:'fixture-admin',KUNQIONG_ADMIN_PASSWORD:'fixture-password',KUNQIONG_OAUTH_CLIENT_ID:'fixture-only',KUNQIONG_OAUTH_CLIENT_SECRET:'fixture-only',KUNQIONG_OAUTH_AUTHORIZE_URL:'http://localhost:18046/authorize',KUNQIONG_OAUTH_TOKEN_URL:'http://localhost:18046/oauth/token',KUNQIONG_AUTH_CALLBACK_URL:'http://localhost:18045/auth/callback',KUNQIONG_WEB_MEMBER_API_BASE:'http://localhost:18046',KUNQIONG_RELEASE_SHA:'browser-fixture'},stdio:['ignore','inherit','inherit']})
console.log(JSON.stringify({base:'http://localhost:18045',fixture,admin:'fixture-admin (synthetic)',scanner:'localhost:3310 (real ClamAV)'}))
const close=()=>{child.kill();mock.close();process.exit(0)};process.on('SIGINT',close);process.on('SIGTERM',close);child.on('exit',()=>{mock.close()})
