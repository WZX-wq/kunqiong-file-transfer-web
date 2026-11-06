// Real Chromium geometry checks. Synthetic API responses never touch live data.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'


const fixtureSource = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {UpgradeModal} from '/src/pages/workspace-page.jsx';
import '/src/styles.css';
const GB=1024**3;
const plans=[['free','基础版',0,20],['member','月卡会员',1900,100],['team','团队季卡',4900,500],['halfyear','半年卡',7900,1024],['year','年卡',12900,1024]].map(([id,label,price,total],i)=>({id,label,monthlyPrice:price,totalBytes:total*GB,teamSpaceBytes:i>1?500*GB:0,team:i>1,validityDays:i===4?365:i===3?180:30,singleFileLimitBytes:20*GB,features:[total+' GB 个人空间','单文件最大 20 GB','每个收集任务最多 300 人','同时进行 50 个收集任务','文件临时保存，到期自动失效'],tagline:i>1?'临时保存 · 团队协作':'临时保存'}));
window.fetch=async ()=>new Response(JSON.stringify({source:'remote',pricing:Object.fromEntries(plans.filter(p=>p.id!=='free').map(p=>[p.id,{available:true,priceCents:p.monthlyPrice,validityDays:p.validityDays}]))}),{headers:{'content-type':'application/json'}});
createRoot(document.getElementById('root')).render(React.createElement(UpgradeModal,{workspace:{plan:plans[0],plans,orders:[],teamEntitlement:{},paymentReconciliation:{}},onClose(){},onRefresh(){},onNotify(){}}));
`;

const root = path.resolve(import.meta.dirname, '..')
const chromePath = [process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean).find(candidate => fs.existsSync(candidate))
assert.ok(chromePath, 'Chrome or Edge is required for layout verification')
async function freePort() {
  const server = net.createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
async function waitFor(check, label) {
  const until = Date.now() + 15000
  while (Date.now() < until) { try { if (await check()) return } catch {} await delay(50) }
  assert.fail(label)
}
const vitePort = await freePort(), debugPort = await freePort()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kunqiong-layout-chrome-'))
let vite, chrome, cdp
try {
  vite = await createServer({ root, cacheDir: path.join(profile, 'vite-cache'), configFile: false, plugins: [react(), { name: 'typography-fixture', configureServer(server) { server.middlewares.use(async (req,res,next) => { if (req.url !== '/typography-fixture') return next(); res.setHeader('content-type','text/html'); res.end(await server.transformIndexHtml(req.url, '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module" src="/typography-fixture.js"></script>')) }) }, resolveId(id) { if (id === '/typography-fixture.js') return '\0typography-fixture' }, load(id) { if (id === '\0typography-fixture') return fixtureSource } }], appType: 'spa', server: { host: '127.0.0.1', port: vitePort, strictPort: true } })
  await vite.listen()
  chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--no-sandbox', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok, 'Chrome did not start')
  const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })).json()
  cdp = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { cdp.addEventListener('open', resolve, { once: true }); cdp.addEventListener('error', reject, { once: true }) })
  let requestId = 0
  const pending = new Map()
  cdp.addEventListener('message', event => {
    const message = JSON.parse(event.data), entry = pending.get(message.id)
    if (message.method === 'Runtime.exceptionThrown') console.error(JSON.stringify(message.params.exceptionDetails));
    if (!entry) return
    pending.delete(message.id)
    if (message.error) entry.reject(new Error(message.error.message))
    else entry.resolve(message.result)
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++requestId; pending.set(id, { resolve, reject }); cdp.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
    return result.result.value
  }
  await send('Page.enable')
  await send('Runtime.enable')

  for (const viewport of [{width:1440,height:1000},{width:1280,height:720},{width:768,height:800},{width:390,height:844},{width:320,height:620}]) {
    await send('Emulation.setDeviceMetricsOverride',{...viewport,deviceScaleFactor:1,mobile:viewport.width<760});
    await send('Page.navigate',{url:`http://127.0.0.1:${vitePort}/typography-fixture`});
    await waitFor(()=>evaluate("document.querySelectorAll('.upgrade-plan-card').length===5"),'Upgrade cards did not render');
    await evaluate('document.fonts.ready');
    await waitFor(()=>evaluate("!document.querySelector('.upgrade-summary .primary-button').disabled"),'Fixture prices did not load');
    await evaluate('Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {})))');
    const state=await evaluate(`(() => {
      const rect=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
      const style=s=>getComputedStyle(document.querySelector(s));
      const modal=document.querySelector('.upgrade-modal');
      return {modal:rect(modal),pageWidth:document.documentElement.scrollWidth,viewport:innerWidth,
        color:style('.upgrade-plan-features li').color,featureSize:parseFloat(style('.upgrade-plan-features li').fontSize),
        titleSize:parseFloat(style('.upgrade-plan-top strong').fontSize),priceSize:parseFloat(style('.upgrade-plan-price').fontSize),
        opacity:style('.upgrade-plan-card.is-current').opacity,
        cards:[...document.querySelectorAll('.upgrade-plan-card')].map(n=>({width:n.clientWidth,scrollWidth:n.scrollWidth})),
        cardBackground:style('.upgrade-plan-card.is-current').backgroundColor,
        features:[...document.querySelectorAll('.upgrade-plan-features li')].map(n=>({height:n.clientHeight,scrollHeight:n.scrollHeight})),
        button:rect(document.querySelector('.upgrade-summary .primary-button'))};
    })()`);
    assert.equal(state.color,'rgb(17, 17, 17)');assert.equal(state.featureSize,13);assert.equal(state.titleSize,16);assert.equal(state.priceSize,20);
    assert.equal(state.opacity,'1');assert.equal(state.cardBackground,'rgb(255, 255, 255)');
    assert.ok(state.pageWidth<=state.viewport);assert.ok(state.modal.x>=0&&state.modal.right<=viewport.width+1&&state.modal.y>=0&&state.modal.bottom<=viewport.height+1);
    for(const c of state.cards)assert.ok(c.scrollWidth<=c.width+1,'Plan text must not overflow its card');
    for(const f of state.features)assert.ok(f.scrollHeight<=f.height+1,'Benefit lines must not clip');
    await evaluate("document.querySelector('.upgrade-summary .primary-button').scrollIntoView({block:'center'})");
    assert.ok(await evaluate(`(() => {const n=document.querySelector('.upgrade-summary .primary-button'),r=n.getBoundingClientRect();return r.y>=0&&r.bottom<=innerHeight&&n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()`),'Purchase button must remain reachable');
    if(process.env.TYPOGRAPHY_SCREENSHOT_DIR && [1440,390].includes(viewport.width)) {
      await evaluate("document.querySelector('.upgrade-modal-body').scrollTop=0");
      const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(process.env.TYPOGRAPHY_SCREENSHOT_DIR,'typography-upgrade-'+viewport.width+'.png'),Buffer.from(shot.data,'base64'));
    }
    console.log('PASS upgrade readability and containment '+viewport.width+'px');
  }

  await send('Page.addScriptToEvaluateOnNewDocument', {source: `
    window.fetch = async url => {
      const route = new URL(url, location.href).pathname;
      const user = {id:'typography-user',username:'readable-user',nickname:'清晰文字测试用户',email:'reader@example.com',planId:'enterprise'};
      let data = {};
      if (route === '/api/auth/me') data = {user};
      else if (route === '/api/account/records') data = {records:[{id:'record-1',kind:'share',scope:'my_sent',name:'项目验收文档及相关文件.zip',code:'A1B2C3',shareId:'example',files:[{name:'项目验收文档.pdf',size:1024}],status:'active',createdAt:new Date().toISOString()}],pagination:{total:1,page:1,limit:8,scopeCounts:{all:1,my_sent:1},categoryCounts:{all:1}}};
      else if (route === '/api/account/messages') data = {messages:[],settings:{},total:0,unreadCount:0};
      else if (route === '/api/account/workspace') data = {plan:{id:'halfyear',label:'半年卡',totalBytes:1024**4,teamSpaceBytes:500*1024**3,team:true,monthlyPrice:7900,validityDays:180,features:['1024 GB 个人空间','500 GB 团队空间','单文件最大 15 GB','每个收集任务最多 300 人','同时可进行 50 个收集任务','权益有效期 180 天']},plans:[],orders:[],capacity:{usedBytes:1800000,totalBytes:1024**4,fileCount:4,shareCount:2,collectionCount:1}};
      else if (route === '/api/account/team/overview') data = {organization:{id:'org',name:'文字可读性测试团队',ownerUserId:user.id,members:[{userId:user.id,username:user.username,email:user.email,role:'owner'}]},plan:{id:'enterprise',team:true},canManage:true,isOwner:true,capacity:{usedBytes:1024,totalBytes:1024**3,fileCount:1,shareCount:1},memberUsage:[],joinRequests:[],resources:[],resourceSummary:{total:0,fileCount:0,active:0},pagination:{page:1,limit:8,total:0}};
      else if (route === '/api/account/file-cleanup-settings') data = {settings:{enabled:false,days:3}};
      return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
    };
  `});
  for (const width of [1440,390]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<760});
    for (const [route, selector] of [['/','.send-prototype-hero'],['/?view=records','.record-row'],['/settings/profile','.settings-page'],['/workspace','.workspace-plan-hero'],['/team','.team-kpi-grid']]) {
      await send('Page.navigate',{url:'http://127.0.0.1:'+vitePort+route});
      await waitFor(()=>evaluate('Boolean(document.querySelector('+JSON.stringify(selector)+'))'),'Page did not render '+route);
      await delay(300);
      const state = await evaluate(`({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,ink:getComputedStyle(document.body).getPropertyValue('--ink').trim(),muted:getComputedStyle(document.body).getPropertyValue('--muted').trim()})`);
      assert.ok(state.scrollWidth<=state.width,route+' must not overflow horizontally');
      assert.equal(state.ink,'#111111');assert.equal(state.muted,'#404040');
      const searchFocus = await evaluate(`(() => {
        const targets = [['team-page','team-search'],['team-page','team-inline-search'],['team-page','team-invite-input'],['admin-page','admin-search'],['orders-page','orders-search'],['records-page','record-search-box'],['records-page','records-search-box'],['records-page','file-center-search']];
        return targets.map(([page,field]) => {
          const root = document.createElement('div'), wrapper = document.createElement('label'), input = document.createElement('input');
          root.className = page; wrapper.className = field; input.type = field === 'record-search-box' ? 'search' : 'text';
          wrapper.append(input); root.append(wrapper); document.body.append(root); input.focus();
          const result = {field,ring:getComputedStyle(input).outlineStyle,wrapperRing:getComputedStyle(wrapper).outlineStyle,shadow:getComputedStyle(wrapper).boxShadow,border:getComputedStyle(wrapper).borderColor};
          root.remove(); return result;
        });
      })()`);
      for (const focus of searchFocus) {
        assert.equal(focus.ring,'none',focus.field+' must not show an input outline');
        assert.equal(focus.wrapperRing,'none',focus.field+' wrapper must not show a blue outline');
        if (focus.field !== 'team-inline-search') assert.equal(focus.shadow,'none',focus.field+' must not show a focus halo');
        if (focus.field !== 'team-inline-search') assert.equal(focus.border,'rgb(139, 146, 156)',focus.field+' keeps a restrained neutral focus border');
      }
      if (route === '/workspace') {
        const metrics = await evaluate(`(() => {
          const textBox = node => { const range = document.createRange(); range.selectNodeContents(node); const r = range.getBoundingClientRect(); return {top:r.top,bottom:r.bottom,height:r.height}; };
          const box = node => { const r = node.getBoundingClientRect(); return {top:r.top,bottom:r.bottom,height:r.height}; };
          return {align: getComputedStyle(document.querySelector('.workspace-plan-metrics > div')).alignItems,
            columns:getComputedStyle(document.querySelector('.workspace-plan-metrics > div')).gridTemplateColumns,
            count: document.querySelectorAll('.workspace-plan-metrics > div').length,
            labels: [...document.querySelectorAll('.workspace-plan-metrics > div > span')].every(node => node.getClientRects().length === 1),
            values: [...document.querySelectorAll('.workspace-plan-metrics > div > b')].every(node => node.getClientRects().length === 1),
            lines:[...document.querySelectorAll('.workspace-plan-metrics > div')].map(node => ({label:box(node.querySelector('span')),value:box(node.querySelector('b')),icon:box(node.querySelector('svg'))}))};
        })()`);
        assert.equal(metrics.count, 4);
        assert.equal(metrics.align, 'baseline', 'Metric labels and values must align by text baseline');
        assert.equal(metrics.columns.split(' ').length, 3, 'Icon, label, and value must occupy separate grid columns');
        assert.ok(metrics.labels && metrics.values, 'Metric labels and values must stay on one line');
        for (const line of metrics.lines) {
          assert.ok(Math.abs(line.label.top-line.value.top) <= 1, 'Metric label and value line boxes must align');
          assert.ok(Math.abs((line.icon.top+line.icon.height/2)-(line.label.top+line.label.height/2)) <= 1, 'Metric icon must center against its text row');
        }
      }
      if(process.env.TYPOGRAPHY_SCREENSHOT_DIR) {
        const shot=await send('Page.captureScreenshot',{format:'png'});
        fs.writeFileSync(path.join(process.env.TYPOGRAPHY_SCREENSHOT_DIR,'typography-page-'+route.replace(/[^a-z]/g,'-')+'-'+width+'.png'),Buffer.from(shot.data,'base64'));
      }
      console.log('PASS page typography and width '+width+'px '+route);
    }
  }
} finally {
  cdp?.close()
  if (chrome && chrome.exitCode === null) {
    const exited = once(chrome, 'exit'); chrome.kill(); await Promise.race([exited, delay(3000)])
  }
  await vite?.close()
  try { fs.rmSync(profile, { recursive: true, force: true }) } catch {}
}
