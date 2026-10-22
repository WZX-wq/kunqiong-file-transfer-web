import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import sharp from 'sharp'
import { manualVersion, screenshots, sections } from './docs/user-manual-content.mjs'

const root = import.meta.dirname
const shotRoot = path.join(root, 'manual_shots/current')
const manifestPath = path.join(shotRoot, 'manifest.json')
const output = path.join(root, 'public/user-manual.html')
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const escape = text => String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])
const captures = new Map(JSON.parse(fs.readFileSync(path.join(shotRoot, 'captures.json'), 'utf8')).map(capture => [capture.name, capture]))

// Only an explicit screenshot review updates the lock. Normal builds reject changed images.
if (process.argv.includes('--refresh-screenshots')) {
  const entries = []
  for (const [name, description] of screenshots) {
    const capture = captures.get(name)
    if (!capture || description.labels.some(label => !capture.snapshot.includes(label))) throw new Error(`Screenshot labels do not match: ${name}`)
    const bytes = fs.readFileSync(path.join(shotRoot, `${name}.png`))
    const { width, height } = await sharp(bytes).metadata()
    entries.push({ name, file: `${name}.png`, sha256: sha256(bytes), width, height, url: capture.url, labels: description.labels })
  }
  fs.writeFileSync(manifestPath, JSON.stringify({ version: manualVersion, screenshots: entries }, null, 2) + '\n')
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
if (manifest.version !== manualVersion) throw new Error('Manual version and screenshot manifest differ')
const locked = new Map(manifest.screenshots.map(entry => [entry.name, entry]))
const embedded = new Map()
for (const [name, description] of screenshots) {
  const entry = locked.get(name)
  const capture = captures.get(name)
  if (!entry || entry.file !== `${name}.png`) throw new Error(`Missing named screenshot: ${name}`)
  const bytes = fs.readFileSync(path.join(shotRoot, entry.file))
  if (sha256(bytes) !== entry.sha256) throw new Error(`Screenshot changed without review: ${name}`)
  if (JSON.stringify(entry.labels) !== JSON.stringify(description.labels) || !capture || entry.url !== capture.url || description.labels.some(label => !capture.snapshot.includes(label))) throw new Error(`Screenshot/text pairing changed: ${name}`)
  embedded.set(name, `data:image/png;base64,${bytes.toString('base64')}`)
}
if (locked.size !== screenshots.size) throw new Error('Unexpected screenshots in manifest')
const logo = `data:image/png;base64,${fs.readFileSync(path.join(root, 'public/app-icon.png')).toString('base64')}`
let figureNumber = 0
const rendered = sections.map((section, index) => `<section id="${section.id}" aria-labelledby="heading-${section.id}"><h2 id="heading-${section.id}"><span>${String(index + 1).padStart(2, '0')}</span>${section.title}</h2>${section.body.replace(/<manual-shot name="([a-z-]+)"><\/manual-shot>/g, (_, name) => {
  const entry = locked.get(name)
  const description = screenshots.get(name)
  if (!entry || !description) throw new Error(`Unknown screenshot in section: ${name}`)
  figureNumber++
  return `<figure class="shot" data-shot="${name}" data-sha256="${entry.sha256}"><button type="button" class="shot-open" aria-label="放大图片：${escape(description.caption)}"><img src="${embedded.get(name)}" alt="${escape(description.caption)}" width="${entry.width}" height="${entry.height}" loading="lazy" decoding="async"></button><figcaption><span>图 ${figureNumber} · ${escape(description.caption)}</span><button type="button" class="image-zoom" data-zoom="${name}" aria-label="查看大图：${escape(description.caption)}">查看大图</button></figcaption></figure>`
})}</section>`).join('\n')
const nav = sections.map((section, index) => `<a href="#${section.id}"><span>${String(index + 1).padStart(2, '0')}</span>${section.title}</a>`).join('')

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="manual-version" content="${manualVersion}">
<meta name="description" content="鲲穹文件传输当前界面使用手册，含发文件、收集文件、收发记录、文件管理、个人中心、会员与团队操作图解。">
<title>鲲穹文件传输 · 使用手册</title>
<link rel="icon" type="image/png" href="${logo}">
<style>
:root{color-scheme:light;--blue:#2563eb;--ink:#172033;--muted:#526174;--line:#dde5ef;--soft:#eff6ff}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:94px}body{margin:0;background:#fff;color:var(--ink);font:16px/1.85 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;letter-spacing:0}a{color:var(--blue);text-decoration:none}button{font:inherit;cursor:pointer}a,button{transition:color .16s,background-color .16s,box-shadow .16s,transform .16s}a:focus-visible,button:focus-visible,summary:focus-visible,[tabindex]:focus-visible{outline:3px solid #93b4ff;outline-offset:4px}button:active{transform:scale(.98)}
.topbar{position:sticky;top:0;z-index:10;border-bottom:1px solid var(--line);background:#fff}.top-inner{max-width:1500px;margin:auto;min-height:80px;padding:12px 36px;display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{display:flex;align-items:center;gap:12px;color:var(--ink);font-size:21px;font-weight:750;line-height:1.3}.brand img{width:48px;height:48px;object-fit:contain}.brand small{display:block;color:var(--muted);font-size:13px;font-weight:450;margin-top:4px}.tools{display:flex;align-items:center;gap:12px}.tools a,.tools button{border:1px solid var(--line);border-radius:6px;padding:7px 14px;background:#fff;color:var(--ink);font-size:14px;white-space:nowrap}.tools a:hover,.tools button:hover{background:var(--soft);border-color:#a8c3ff}
.layout{max-width:1500px;margin:auto;display:grid;grid-template-columns:250px minmax(0,1fr);gap:48px;padding:36px}.sidebar{position:sticky;top:112px;align-self:start;max-height:calc(100vh - 140px);overflow:auto;padding-right:16px;border-right:1px solid var(--line)}.sidebar h2{font-size:13px;color:var(--muted);margin:0 0 14px;letter-spacing:0}.sidebar nav{display:flex;flex-direction:column;gap:3px}.sidebar a{display:flex;gap:9px;padding:7px 8px;border-radius:5px;font-size:13px;line-height:1.6;color:#334155}.sidebar a span{color:#7a8798;font-variant-numeric:tabular-nums}.sidebar a:hover,.sidebar a[aria-current="location"]{color:#1d4ed8;background:var(--soft)}main{min-width:0}.intro{padding:0 0 30px;border-bottom:1px solid var(--line)}.eyebrow{color:var(--blue);font-size:13px;font-weight:650;margin:0 0 8px}h1{font-size:34px;line-height:1.4;margin:0 0 12px;font-weight:750}.intro p{max-width:760px;margin:10px 0;color:var(--muted)}.version{display:flex;gap:10px;flex-wrap:wrap;font-size:13px;color:var(--muted);margin-top:16px}.version span{padding:3px 10px;border:1px solid var(--line);border-radius:4px}section{padding-top:42px}section>h2{display:flex;gap:12px;align-items:baseline;margin:0 0 18px;font-size:25px;line-height:1.5}section>h2>span{color:var(--blue);font-size:15px;font-variant-numeric:tabular-nums}h3{font-size:19px;margin:26px 0 10px}p{margin:12px 0}b{font-weight:650}ol,ul{padding-left:25px}.steps{padding-left:28px}.steps li{padding-left:5px;margin:10px 0}.steps li::marker{color:var(--blue);font-weight:700}.note{border-left:3px solid #75a2fa;background:#f2f7ff;color:#294367;padding:14px 18px;margin:20px 0;font-size:14px;line-height:1.85}
.shot{margin:24px 0 28px;border:1px solid var(--line);border-radius:7px;overflow:hidden;background:#fff}.shot-open{display:block;width:100%;border:0;padding:0;background:#f8fafc;line-height:0;cursor:zoom-in}.shot-open img{display:block;width:100%;height:auto}.shot-open:hover{box-shadow:inset 0 0 0 2px #8ab1ff}.shot figcaption{padding:12px 16px;border-top:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:14px;font-size:13px;color:var(--muted);line-height:1.7}.image-zoom{flex-shrink:0;background:transparent;color:var(--blue);border:0;padding:3px 0;font-size:13px}.image-zoom:hover{text-decoration:underline}.table-scroll{max-width:100%;overflow:auto;border:1px solid var(--line);border-radius:6px;margin:20px 0}table{border-collapse:collapse;width:100%;font-size:14px;line-height:1.75}th,td{text-align:left;vertical-align:top;padding:12px 15px;border-bottom:1px solid #e8edf4}th{color:#334155;background:#f5f8fc;font-weight:650;white-space:nowrap}tbody tr:last-child td{border-bottom:0}td:first-child{font-weight:550;min-width:125px}details{border-bottom:1px solid var(--line);padding:16px 0}summary{font-weight:650;cursor:pointer}details p{font-size:15px;color:var(--muted);margin-bottom:2px}footer{margin-top:44px;padding:26px 0;border-top:1px solid var(--line);font-size:13px;color:var(--muted)}.back-top{display:inline-block;margin-top:10px}
.image-dialog{padding:0;width:min(97vw,2000px);max-width:97vw;max-height:95vh;border:1px solid #cbd5e1;border-radius:7px;color:var(--ink)}.image-dialog::backdrop{background:rgb(15 23 42 / .72)}.dialog-heading{position:sticky;top:0;display:flex;gap:20px;align-items:center;justify-content:space-between;padding:12px 18px;background:#fff;border-bottom:1px solid var(--line);z-index:1;font-size:14px}.dialog-heading p{margin:0}.dialog-heading button{border:1px solid var(--line);background:#fff;border-radius:5px;min-width:64px;padding:5px 10px;font-size:14px}.dialog-image{padding:12px;overflow:auto;background:#f8fafc}.dialog-image img{display:block;max-width:none;height:auto;width:auto;margin:auto}.dialog-hint{margin:0;padding:9px 18px;color:var(--muted);font-size:12px;background:#fff}
@media(min-width:1700px){.layout{grid-template-columns:260px minmax(0,1fr);gap:60px}}@media(max-width:1050px){.layout{grid-template-columns:205px minmax(0,1fr);gap:26px;padding:28px 22px}.top-inner{padding:12px 22px}.sidebar{padding-right:10px}.sidebar a{font-size:12px;padding:6px 4px}section>h2{font-size:23px}}
@media(max-width:760px){html{scroll-padding-top:100px}.top-inner{padding:12px 16px;gap:10px;min-height:76px}.brand{font-size:17px;gap:8px}.brand img{width:40px;height:40px}.brand small{font-size:11px}.tools{gap:6px}.tools a,.tools button{font-size:12px;padding:6px 8px}.print-action{display:none}.layout{display:block;padding:24px 16px}.sidebar{position:static;max-height:none;border:0;border-bottom:1px solid var(--line);padding:0 0 20px;margin-bottom:24px}.sidebar nav{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px}.sidebar a{font-size:12px;padding:5px;min-width:0}.sidebar h2{margin-bottom:10px}h1{font-size:28px}.intro p{font-size:15px}section{padding-top:34px}section>h2{font-size:22px;gap:9px}body{font-size:15px}th,td{padding:10px 12px}.note{padding:12px 14px}.shot figcaption{display:block;padding:10px 12px}.image-zoom{display:block;margin-top:5px}.image-dialog{width:98vw;max-width:98vw}.dialog-heading{padding:10px 12px}.dialog-image{max-height:75vh}.dialog-image img{max-width:none}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*,*::before,*::after{transition:none!important;animation:none!important}}@media print{.topbar,.sidebar,.tools,.image-zoom,.back-top,.image-dialog{display:none}.layout{display:block;padding:0;max-width:none}body{font-size:10pt;color:#000}.intro{padding-bottom:12px}section{padding-top:18px}section>h2{font-size:18pt;break-after:avoid}h3{break-after:avoid}figure,.note,tr{break-inside:avoid}.shot{margin:14px 0}.table-scroll{overflow:visible}a{color:inherit}footer{margin-top:20px}}
</style>
</head>
<body id="top">
<header class="topbar"><div class="top-inner"><a class="brand" href="/"><img src="${logo}" width="48" height="48" alt="鲲穹文件传输软件图标"><span>鲲穹文件传输<small>使用手册 · 当前界面图解</small></span></a><div class="tools"><a href="/">返回产品</a><button type="button" class="print-action">打印手册</button></div></div></header>
<div class="layout"><aside class="sidebar"><h2>操作目录</h2><nav aria-label="手册章节">${nav}</nav></aside><main><div class="intro"><p class="eyebrow">使用手册</p><h1>按当前页面，完成每一步操作</h1><p>从发送文件、参与收集到管理资源、会员与团队，每个图解都对应实际页面中的入口与按钮。点击配图可放大查看原始截图。</p><div class="version"><span>界面核对 ${manualVersion}</span><span>${sections.length} 个章节</span><span>${screenshots.size} 张当前界面截图</span></div></div>${rendered}<footer>鲲穹文件传输 · 使用手册 · 更新于 ${manualVersion}<br><a class="back-top" href="#top">回到顶部 ↑</a></footer></main></div>
<dialog class="image-dialog" aria-labelledby="image-title"><div class="dialog-heading"><p id="image-title"></p><form method="dialog"><button type="submit" aria-label="关闭大图">关闭</button></form></div><div class="dialog-image"><img alt=""></div><p class="dialog-hint">按原始尺寸显示，可滚动查看；按 Esc 或点击关闭返回正文</p></dialog>
<script>
const dialog = document.querySelector('.image-dialog');
document.querySelector('.print-action').addEventListener('click', () => window.print());
document.querySelectorAll('.shot-open,.image-zoom').forEach(button => button.addEventListener('click', () => {
  const source = button.closest('figure').querySelector('img');
  const target = dialog.querySelector('img');
  target.src = source.src; target.alt = source.alt;
  document.getElementById('image-title').textContent = source.alt;
  dialog.showModal();
}));
dialog.addEventListener('close', () => dialog.querySelector('img').removeAttribute('src'));
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    document.querySelectorAll('.sidebar a').forEach(link => {
      if (link.hash === '#' + entry.target.id) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }), { rootMargin: '-100px 0px -65% 0px' });
  document.querySelectorAll('main section').forEach(section => observer.observe(section));
}
</script>
</body></html>
`
if (figureNumber !== screenshots.size) throw new Error('Every locked screenshot must appear exactly once')
fs.writeFileSync(output, html)
console.log(`Manual ${manualVersion}: ${sections.length} sections, ${figureNumber} reviewed screenshots, ${(Buffer.byteLength(html) / 1024 ** 2).toFixed(2)} MB`)
