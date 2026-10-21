import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {pages,variants} from './data.js'
const root=path.dirname(fileURLToPath(import.meta.url))
function html(title){return `<!doctype html>\n<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="color-scheme" content="light"><title>${title} · 鲲穹 UI 原型</title></head><body><div id="root"></div><script type="module" src="/app.jsx"></script></body></html>\n`}
fs.writeFileSync(path.join(root,'index.html'),html('四版设计提案'))
for(const v of Object.keys(variants)){
 fs.mkdirSync(path.join(root,v),{recursive:true})
 for(const p of pages) fs.writeFileSync(path.join(root,v,p.id+'.html'),html(p.title+' · '+variants[v].name))
 fs.writeFileSync(path.join(root,v,'pages.html'),html('完整页面目录 · '+variants[v].name))
}
console.log(`Generated ${pages.length} pages + 1 directory per design × ${Object.keys(variants).length} designs, and a comparison entry`)
