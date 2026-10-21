import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {build} from 'esbuild'
import {JSDOM,VirtualConsole} from 'jsdom'
import postcss from 'postcss'
import {pages,variants} from './data.js'
const root=path.dirname(fileURLToPath(import.meta.url))
const bundle=await build({entryPoints:[path.join(root,'app.jsx')],bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'})
const code=bundle.outputFiles[0].text
const failures=[],warnings=[],summaries=[],links=new Set()
const routes=['/','/index.html',...Object.keys(variants).flatMap(v=>[...pages.map(p=>`/${v}/${p.id}.html`),`/${v}/pages.html`])]
for(const route of routes){
 const console=new VirtualConsole(),errors=[]
 console.on('jsdomError',e=>errors.push(String(e)))
 console.on('error',(...a)=>errors.push(a.join(' ')))
 const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'http://localhost:4280'+route,runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:console,beforeParse(w){
  w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}})
  w.HTMLCanvasElement.prototype.getContext=()=>({clearRect(){},fillRect(){},createImageData:(x,y)=>({data:new Uint8ClampedArray(x*y*4)}),putImageData(){}})
  w.HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/png;base64,'
  w.URL.createObjectURL=()=> 'blob:prototype';w.URL.revokeObjectURL=()=>{}
 }})
 try{
  dom.window.eval(code)
  await new Promise(r=>setTimeout(r,32))
  const doc=dom.window.document,text=doc.body.textContent
  if(!doc.querySelector('h1'))failures.push({route,error:'No primary heading'})
  if(text.includes('页面不存在'))failures.push({route,error:'Unmapped screen'})
  if(errors.length)failures.push({route,errors})
  for(const a of doc.querySelectorAll('a[href]')){
   const u=new URL(a.href)
   if(u.origin==='http://localhost:4280'){
    links.add(u.pathname)
    if(!fs.existsSync(path.join(root,u.pathname==='/'?'index.html':u.pathname)))failures.push({route,broken:u.pathname})
   }
  }
  if(doc.querySelector('aside'))warnings.push({route,error:'Unexpected sidebar'})
  summaries.push({route,heading:doc.querySelector('h1')?.textContent,links:doc.querySelectorAll('a[href]').length,dialogs:doc.querySelectorAll('[role=dialog]').length})
 }catch(e){failures.push({route,error:String(e)})}finally{dom.window.close()}
}
const css=fs.readFileSync(path.join(root,'style.css'),'utf8')
const themeCss=fs.readFileSync(path.join(root,'theme-overrides.css'),'utf8')
const uploadCss=fs.readFileSync(path.join(root,'upload-centered.css'),'utf8')
const transitionCss=fs.readFileSync(path.join(root,'page-transitions.css'),'utf8')
let desktopFontRules=0
for(const [file,source] of [['style.css',css],['theme-overrides.css',themeCss],['upload-centered.css',uploadCss],['page-transitions.css',transitionCss]])postcss.parse(source).walkDecls('font-size',decl=>{
 let mobile=false
 for(let node=decl.parent;node;node=node.parent)if(node.type==='atrule'&&node.name==='media'&&node.params.replaceAll(' ','').includes('max-width:640px'))mobile=true
 if(mobile)return
 desktopFontRules++
 if(decl.value.endsWith('px')&&parseFloat(decl.value)<13)failures.push({file,selector:decl.parent.selector,fontSize:decl.value,error:'Desktop font below 13px'})
})
for(const feature of ['@view-transition','prefers-reduced-motion',':focus-visible','view-transition-name:transfer-surface','@media(max-width:640px)'])if(!css.includes(feature))failures.push({feature,error:'Missing interaction/accessibility rule'})
for(const feature of ['::view-transition-old(root)','animation: route-slide-out 420ms','::view-transition-new(root)','animation: route-slide-in 560ms','translate3d(-12px, 0, 0) scale(.996)','translate3d(18px, 0, 0) scale(.994)','opacity: 0','prefers-reduced-motion'])if(!transitionCss.includes(feature))failures.push({feature,error:'Missing smooth page transition rule'})
const result={checkedAt:new Date().toISOString(),routes:routes.length,pagesPerDesign:pages.length,designs:Object.keys(variants).length,uniqueLinkTargets:links.size,desktopFontRules,failures,warnings,summary:summaries}
fs.writeFileSync(path.join(root,'verification.json'),JSON.stringify(result,null,2))
process.stdout.write(JSON.stringify({...result,summary:undefined},null,2)+'\n')
if(failures.length||warnings.length)process.exitCode=1
