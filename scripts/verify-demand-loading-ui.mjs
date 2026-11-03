import assert from 'node:assert/strict'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { JSDOM, VirtualConsole } from 'jsdom'
import { build } from 'vite'

const root = path.resolve(import.meta.dirname, '..')
const bundle = await build({ root, configFile: false, logLevel: 'silent', worker: { format: 'es' }, build: { write: false, minify: false, rollupOptions: { input: path.join(root,'src/main.jsx'), output: { format:'iife', inlineDynamicImports:true } } } })
const code = bundle.output.find(item=>item.type==='chunk').code
let passed=0
const check=(label,condition)=>{ assert.ok(condition,label); passed++; console.log('PASS '+label) }
async function waitFor(fn,label) { for(let index=0;index<300;index++){if(fn())return;await delay(10)} assert.fail(label) }
async function mount(route) {
  const errors=[], calls=[], console=new VirtualConsole()
  console.on('jsdomError',error=>errors.push(error))
  const dom=new JSDOM('<div id="root"></div>',{url:'http://fixture.local'+route,pretendToBeVisual:true,runScripts:'outside-only',virtualConsole:console})
  const {window}=dom, document=window.document
  window.setInterval=()=>1;window.clearInterval=()=>{}
  let messages=Array.from({length:45},(_,index)=>({id:'m'+index,title:'消息 '+index,body:'正文 '+index,unread:true,category:'other',createdAt:new Date(Date.now()-index*1000).toISOString()}))
  const records=Array.from({length:55},(_,index)=>({id:'record-'+index,scope:index%2?'sent_to_me':'my_sent',kind:'share',shareId:'share-'+index,name:'文档 '+index,code:'CODE'+index,files:[{name:'document-'+index+'.txt',size:4}],status:'active',createdAt:new Date().toISOString()}))
  const resources=Array.from({length:19},(_,index)=>({id:'resource-'+index,name:'团队文档 '+index,ownerUserId:'alice',kind:'share',files:[{name:'team-'+index+'.txt',size:4}],fileCount:1,status:'active',canManage:true,canDelete:true,totalSize:4}))
  window.fetch=async(url,options={})=>{
    const request=new URL(url,'http://fixture.local'), method=options.method||'GET', params=request.searchParams
    calls.push({url,method,body:options.body})
    let data={}
    if(request.pathname==='/api/auth/me')data={user:{id:'alice',nickname:'Alice',planId:'enterprise'}}
    else if(request.pathname==='/api/account/messages'&&method==='GET') {
      if(params.get('summary'))data={total:messages.length,unreadCount:messages.filter(item=>item.unread).length}
      else {const start=Number(params.get('cursor')||0), limit=Number(params.get('limit'));data={messages:messages.slice(start,start+limit),pagination:{nextCursor:start+limit<messages.length?String(start+limit):null},settings:{}}}
    } else if(request.pathname==='/api/account/messages'&&method==='PATCH'){messages=messages.map(item=>({...item,unread:false}));data={ok:true}}
    else if(request.pathname.startsWith('/api/account/messages/')&&method==='DELETE'){messages=messages.filter(item=>item.id!==request.pathname.split('/').at(-1));data={ok:true}}
    else if(request.pathname==='/api/account/records'){
      const scope=params.get('scope'), q=params.get('q')||''
      let filtered=records.filter(item=>(!scope||scope==='all'||scope===item.scope)&&(!q||item.name.includes(q)))
      if(q==='slow') {await delay(700);filtered=records.slice(0,1)}
      const limit=Number(params.get('limit')||8),page=Math.min(Number(params.get('page')||1),Math.max(1,Math.ceil(filtered.length/limit)))
      data={records:filtered.slice((page-1)*limit,page*limit),pagination:{total:filtered.length,limit,page,scopeCounts:{all:55,my_sent:28,sent_to_me:27},categoryCounts:{all:55,document:55}}}
    } else if(request.pathname==='/api/account/team/overview'){
      const q=params.get('q')||'',filtered=resources.filter(item=>!q||item.name.includes(q)),page=Number(params.get('page')||1),limit=Number(params.get('limit')||8)
      data={organization:{id:'org',name:'测试团队',ownerUserId:'alice',members:[]},plan:{id:'enterprise',team:true},canManage:true,isOwner:true,capacity:{usedBytes:76,totalBytes:1024**3,fileCount:19,shareCount:19},memberUsage:[],joinRequests:[],resources:filtered.slice((page-1)*limit,page*limit),resourceSummary:{total:19,fileCount:19,active:19},pagination:{page,limit,total:filtered.length}}
    }
    return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}})
  }
  window.eval(code)
  await waitFor(()=>document.querySelector('.app-shell,.team-kpi-grid'),'page mounted')
  const button=label=>[...document.querySelectorAll('button')].find(item=>item.textContent.trim()===label||item.getAttribute('aria-label')===label)
  const input=(element,value)=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(element,value);element.dispatchEvent(new window.Event('input',{bubbles:true}))}
  return {dom,window,document,calls,errors,button,input}
}

const mailbox=await mount('/')
try {
  await waitFor(()=>mailbox.calls.some(item=>item.url.includes('summary=1')),'unread summary requested')
  check('homepage only requests message counts',!mailbox.calls.some(item=>item.url.includes('/messages?limit=')))
  mailbox.document.querySelector('.message-center-wrap .message-trigger').click()
  await waitFor(()=>mailbox.document.querySelectorAll('.message-item').length===20,'first message page')
  check('mailbox fetches twenty messages initially',mailbox.document.querySelectorAll('.message-item').length===20)
  const more=[...mailbox.document.querySelectorAll('button')].find(item=>item.textContent.includes('加载更多'))
  assert.ok(more);more.click()
  await waitFor(()=>mailbox.document.querySelectorAll('.message-item').length===40,'second message page')
  check('load more appends without duplicates',new Set([...mailbox.document.querySelectorAll('.message-item')].map(item=>item.textContent)).size===40)
  const reads=()=>mailbox.calls.filter(item=>item.url.includes('/messages?limit=')).length
  const before=reads()
  mailbox.document.querySelector('.message-item button[aria-label*="删除"],.message-item .message-delete').click()
  await waitFor(()=>mailbox.document.querySelectorAll('.message-item').length===39,'message removed')
  await delay(40)
  check('deleting one message preserves the loaded pages without refetching',reads()===before)
  mailbox.button('全部已读').click()
  await waitFor(()=>!mailbox.document.querySelector('.message-item.unread'),'all messages marked read')
  check('mark all read does not reload message bodies',reads()===before)
  check('message interaction has no runtime errors',!mailbox.errors.length)
} finally {mailbox.dom.window.close()}

const files=await mount('/?view=records')
try {
  await waitFor(()=>files.document.querySelectorAll('.record-row').length===8,'record first page')
  files.button('下一页').click()
  await waitFor(()=>files.document.body.textContent.includes('文档 8'),'record second page')
  check('record navigation fetches the next server page',files.calls.some(item=>item.url.includes('/records?')&&item.url.includes('page=2')))
  check('browsing records never sends full replacement PUT',!files.calls.some(item=>item.method==='PUT'))
  const search=files.document.querySelector('input[aria-label="搜索文件名或取件码"]')
  files.input(search,'slow')
  await waitFor(()=>files.calls.some(item=>item.url.includes('q=slow')),'slow query issued')
  files.input(search,'文档 42')
  await waitFor(()=>files.document.querySelectorAll('.record-row').length===1&&files.document.body.textContent.includes('文档 42'),'new query shown')
  await delay(800)
  check('a late response cannot overwrite newer record search results',files.document.querySelectorAll('.record-row').length===1&&files.document.querySelector('.record-row').textContent.includes('文档 42'))
  check('record filtering has no runtime errors',!files.errors.length)
} finally {files.dom.window.close()}

const team=await mount('/team?tab=resources')
try {
  await waitFor(()=>team.document.querySelectorAll('.team-resource-row').length===8,'team first page')
  check('team initial page sends one overview request',team.calls.filter(item=>item.url.includes('/team/overview')).length===1)
  check('team totals represent all pages',team.document.querySelector('.team-kpi-grid').textContent.includes('19'))
  team.button('下一页').click()
  await waitFor(()=>team.document.body.textContent.includes('团队文档 8'),'team second page')
  check('team pagination fetches only the requested page',team.document.querySelectorAll('.team-resource-row').length===8&&team.calls.some(item=>item.url.includes('page=2')))
  team.input(team.document.querySelector('input[placeholder="检索文件名或上传成员"]'),'团队文档 18')
  await waitFor(()=>team.document.querySelectorAll('.team-resource-row').length===1,'team server search')
  check('team search resets pagination and retains global totals',team.document.querySelector('.team-resource-row').textContent.includes('团队文档 18')&&team.document.querySelector('.team-kpi-grid').textContent.includes('19'))
  check('team pagination has no runtime errors',!team.errors.length)
} finally {team.dom.window.close()}
console.log(`Demand loading UI: ${passed} passed`)
