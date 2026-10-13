// 构建用户使用手册：单文件 HTML，截图 base64 内嵌 + 内联 SVG 示意图
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const SHOTS = path.join(ROOT, 'manual_shots')
// 输出到 vite public/：build 时自动拷入 dist/，dev server 与生产 express 均可直接访问 /user-manual.html
const OUT_DIR = path.join(ROOT, 'public')
const OUT = path.join(OUT_DIR, 'user-manual.html')

const img64 = (name) => `data:image/png;base64,${fs.readFileSync(path.join(SHOTS, `${name}.png`)).toString('base64')}`
const fig = (name, caption, num) => `<figure class="shot"><img src="${img64(name)}" alt="${caption}" loading="lazy" /><figcaption>图 ${num}　${caption}</figcaption></figure>`

const A = '#168b73', AD = '#0d6d5a', PALE = '#d8efe9', SOFT = '#edf5f2', INK = '#1f2b2a', MUTED = '#78908b', LINE = '#dde8e4'

// ---------- SVG 示意图 ----------
const box = (x, y, w, h, fill, stroke, rx = 10) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`
const txt = (x, y, s, size = 14, color = INK, weight = 500, anchor = 'middle') => `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}" text-anchor="${anchor}">${s}</text>`
const arrowH = (x1, x2, y, color = A) => `<line x1="${x1}" y1="${y}" x2="${x2 - 8}" y2="${y}" stroke="${color}" stroke-width="2" marker-end="url(#ah)"/><circle cx="${x1}" cy="${y}" r="3" fill="${color}"/>`

const defs = `<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${A}"/></marker></defs>`

// D1 产品全景
const d1 = `<svg viewBox="0 0 680 330" xmlns="http://www.w3.org/2000/svg">${defs}
${box(20, 20, 640, 60, SOFT, LINE)}${txt(340, 48, '登录用户使用鲲穹统一账号', 14, AD, 600)}
${box(20, 100, 150, 90, '#fff', LINE)}${txt(95, 138, '访客', 15, INK, 600)}${txt(95, 162, '无需注册', 11, MUTED)}
${box(190, 100, 150, 90, '#fff', LINE)}${txt(265, 132, '登录用户', 15, INK, 600)}${txt(265, 156, '发送/收集/记录', 11, MUTED)}${txt(265, 172, '工作台/团队', 11, MUTED)}
${box(360, 100, 150, 90, '#fff', LINE)}${txt(435, 132, '团队所有者', 15, INK, 600)}${txt(435, 156, '成员/申请管理', 11, MUTED)}${txt(435, 172, '团队容量供给', 11, MUTED)}
${box(530, 100, 130, 90, '#fff', LINE)}${txt(595, 132, '团队成员', 15, INK, 600)}${txt(595, 156, '团队文件协作', 11, MUTED)}${txt(595, 172, '共享团队空间', 11, MUTED)}
${box(20, 210, 640, 100, PALE, 'transparent', 14)}${txt(340, 240, '核心模块', 13, AD, 700)}
${['发送文件', '接收取件', '文件收集', '收发记录', '团队空间'].map((m, i) => `${box(45 + i * 120, 255, 110, 38, '#fff', A)}${txt(100 + i * 120, 279, m, 12.5, AD, 600)}`).join('')}
</svg>`

// D2 发送流程
const d2 = `<svg viewBox="0 0 680 150" xmlns="http://www.w3.org/2000/svg">${defs}
${[['选择文件', 20], ['分享设置', 150], ['开始上传', 280], ['取件码/链接/二维码', 410], ['对方取件下载', 560]].map(([t, x], i) => `${box(x, 45, 105, 52, i === 4 ? PALE : '#fff', A)}${txt(x + 52, 68, t.split('/')[0], 12.5, AD, 600)}${i < 4 ? arrowH(x + 105, x + 130, 71) : ''}`).join('')}
${txt(72, 112, '≤100 个/次', 11, MUTED)}${txt(202, 112, '有效期·次数·密码', 11, MUTED)}${txt(332, 112, '大文件自动分片', 11, MUTED)}${txt(462, 112, '三种方式任选', 11, MUTED)}${txt(612, 112, '免登录', 11, MUTED)}
</svg>`

// D3 收集流程
const d3 = `<svg viewBox="0 0 680 150" xmlns="http://www.w3.org/2000/svg">${defs}
${[['创建收集任务', 20], ['分发链接/二维码', 150], ['他人提交', 280], ['统一管理查看', 410], ['打包归档下载', 560]].map(([t, x], i) => `${box(x, 45, 105, 52, i === 4 ? PALE : '#fff', A)}${txt(x + 52, 76, t, 12.5, AD, 600)}${i < 4 ? arrowH(x + 105, x + 130, 71) : ''}`).join('')}
${txt(72, 112, '类型/大小/截止', 11, MUTED)}${txt(202, 112, '提交者免注册', 11, MUTED)}${txt(332, 112, '互相不可见', 11, MUTED)}${txt(462, 112, '单个/打包', 11, MUTED)}
</svg>`

// D4 团队加入/退出
const d4 = `<svg viewBox="0 0 680 210" xmlns="http://www.w3.org/2000/svg">${defs}
${box(20, 20, 300, 170, '#fff', LINE, 12)}${txt(170, 48, '加入团队（三种方式）', 14, AD, 700)}
${box(45, 65, 250, 32, SOFT, 'transparent', 8)}${txt(170, 85, '① 所有者搜索账号直接邀请', 12.5, INK)}
${box(45, 105, 250, 32, SOFT, 'transparent', 8)}${txt(170, 125, '② 打开团队邀请链接申请', 12.5, INK)}
${box(45, 145, 250, 32, SOFT, 'transparent', 8)}${txt(170, 165, '③ 企业专属分享页内申请', 12.5, INK)}
${box(360, 20, 300, 170, '#fff', LINE, 12)}${txt(510, 48, '退出团队（成员自主）', 14, AD, 700)}
${box(385, 65, 250, 32, SOFT, 'transparent', 8)}${txt(510, 85, '团队空间页 → 退出团队空间', 12.5, INK)}
${box(385, 105, 250, 32, PALE, 'transparent', 8)}${txt(510, 125, '个人文件/套餐/容量不受影响', 12, AD, 600)}
${box(385, 145, 250, 32, SOFT, 'transparent', 8)}${txt(510, 165, '所有者先转让所有权，之后即可退出', 12, INK)}
<line x1="320" y1="105" x2="352" y2="105" stroke="${A}" stroke-width="2" marker-end="url(#ah)"/>
</svg>`

// D5 容量模型
const d5 = `<svg viewBox="0 0 680 170" xmlns="http://www.w3.org/2000/svg">${defs}
${box(20, 20, 310, 120, '#fff', LINE, 12)}${txt(175, 48, '成员个人（基础版）', 14, AD, 700)}
${box(45, 68, 260, 26, PALE, 'transparent', 7)}${txt(175, 85, '个人空间 20 GB（永远是自己那份）', 12, INK)}
${box(45, 102, 260, 26, SOFT, 'transparent', 7)}${txt(175, 119, '个人文件 · 个人分享 · 有效期权益', 12, INK)}
${box(350, 20, 310, 120, '#fff', LINE, 12)}${txt(505, 48, '团队空间（借用共享池）', 14, AD, 700)}
${box(375, 68, 260, 26, PALE, 'transparent', 7)}${txt(505, 85, '容量 = 所有者的套餐（如 1024 GB）', 12, INK)}
${box(375, 102, 260, 26, SOFT, 'transparent', 7)}${txt(505, 119, '团队文件 · 团队收集 · 成员共用', 12, INK)}
<line x1="330" y1="80" x2="350" y2="80" stroke="${A}" stroke-width="2" marker-end="url(#ah)"/>
${txt(340, 158, '退出团队只收回「团队空间」使用权，个人那份分毫不动', 12.5, MUTED)}
</svg>`

// ---------- HTML ----------
const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>鲲穹文件传输 · 用户使用手册</title>
<style>
  :root { --accent:${A}; --accent-dark:${AD}; --pale:${PALE}; --soft:${SOFT}; --ink:${INK}; --muted:${MUTED}; --line:${LINE}; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Noto Sans SC', 'Microsoft YaHei', 'PingFang SC', sans-serif; color: var(--ink); background: #f5f8f7; line-height: 1.75; }
  .wrap { max-width: 980px; margin: 0 auto; padding: 0 28px 80px; }
  header.cover { background: linear-gradient(135deg, ${AD}, ${A}); color: #fff; padding: 64px 28px 56px; }
  header.cover .wrap { padding-bottom: 0; }
  .cover-badge { display: inline-block; border: 1px solid rgba(255,255,255,.45); border-radius: 999px; padding: 3px 14px; font-size: 13px; letter-spacing: 2px; }
  .cover h1 { margin: 18px 0 8px; font-size: 40px; letter-spacing: 1px; }
  .cover p.sub { margin: 0 0 26px; font-size: 16px; opacity: .92; }
  .cover .meta { font-size: 13px; opacity: .8; }
  nav.toc { background: #fff; border: 1px solid var(--line); border-radius: 14px; padding: 22px 28px; margin: 28px 0 40px; box-shadow: 0 10px 40px rgba(40,84,74,.07); }
  nav.toc h2 { margin: 0 0 12px; font-size: 16px; color: var(--accent-dark); }
  nav.toc ol { margin: 0; padding-left: 22px; columns: 2; column-gap: 42px; font-size: 14px; }
  nav.toc li { margin: 4px 0; break-inside: avoid; }
  nav.toc a { color: var(--ink); text-decoration: none; }
  nav.toc a:hover { color: var(--accent); }
  h2.sec { font-size: 26px; margin: 52px 0 6px; padding-top: 18px; border-top: 2px solid var(--line); }
  h2.sec .no { color: var(--accent); margin-right: 10px; }
  h3 { font-size: 18.5px; margin: 30px 0 8px; color: var(--accent-dark); }
  p.lead { color: var(--muted); margin-top: 0; }
  p, li { font-size: 14.5px; }
  .kwd { background: var(--pale); color: var(--accent-dark); border-radius: 5px; padding: 1px 7px; font-size: 13px; white-space: nowrap; }
  .note, .warn { border-radius: 10px; padding: 12px 16px; margin: 14px 0; font-size: 13.5px; }
  .note { background: var(--soft); border: 1px solid var(--line); }
  .warn { background: #fdf3ee; border: 1px solid #f0d9cc; }
  .note b, .warn b { color: var(--accent-dark); }
  .warn b { color: #b4552d; }
  figure.shot { margin: 18px 0 26px; }
  figure.shot img { width: 100%; border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 14px 44px rgba(40,84,74,.10); display: block; }
  figure.shot figcaption { text-align: center; color: var(--muted); font-size: 12.5px; margin-top: 8px; }
  figure.diagram { margin: 18px 0 8px; }
  figure.diagram svg { width: 100%; height: auto; display: block; background: #fbfdfc; border: 1px solid var(--line); border-radius: 12px; }
  figure.diagram figcaption { text-align: center; color: var(--muted); font-size: 12.5px; margin-top: 8px; }
  table.tbl { width: 100%; border-collapse: collapse; margin: 14px 0 22px; font-size: 13.5px; background: #fff; border-radius: 10px; overflow: hidden; }
  table.tbl th { background: var(--soft); color: var(--accent-dark); text-align: left; padding: 9px 13px; border: 1px solid var(--line); font-size: 13px; }
  table.tbl td { padding: 8px 13px; border: 1px solid var(--line); vertical-align: top; }
  ol.steps { padding-left: 0; list-style: none; counter-reset: st; margin: 14px 0; }
  ol.steps li { counter-increment: st; position: relative; padding: 0 0 14px 44px; }
  ol.steps li::before { content: counter(st); position: absolute; left: 0; top: 1px; width: 26px; height: 26px; border-radius: 50%; background: var(--accent); color: #fff; font-size: 13.5px; font-weight: 600; display: flex; align-items: center; justify-content: center; }
  ol.steps li b { display: block; }
  ol.steps li span { color: var(--muted); font-size: 13.5px; }
  details.faq { background: #fff; border: 1px solid var(--line); border-radius: 10px; padding: 4px 18px; margin: 10px 0; }
  details.faq summary { cursor: pointer; font-weight: 600; font-size: 14.5px; padding: 10px 0; color: var(--accent-dark); }
  details.faq p { color: var(--ink); }
  .back-top { position: fixed; right: 22px; bottom: 22px; background: var(--accent); color: #fff; border-radius: 999px; padding: 9px 16px; font-size: 13px; text-decoration: none; box-shadow: 0 8px 24px rgba(13,109,90,.35); }
  @media print { body { background: #fff; } .back-top { display: none; } figure.shot img { box-shadow: none; } }
  @media (max-width: 720px) { nav.toc ol { columns: 1; } .cover h1 { font-size: 30px; } }
</style>
</head>
<body>
<header class="cover" id="top"><div class="wrap">
  <span class="cover-badge">USER MANUAL</span>
  <h1>鲲穹文件传输 · 用户使用手册</h1>
  <p class="sub">企业级文件传输与收集平台 —— 临时传输、轻量上陈，把文件交给该交的人。</p>
  <p class="meta">适用版本 v0.1.x ｜ 文档更新：2026-10-13 ｜ 适用端：Web 浏览器（桌面 / 移动）</p>
</div></header>
<div class="wrap">

<nav class="toc"><h2>目录</h2><ol>
  <li><a href="#s1">产品概述</a></li>
  <li><a href="#s2">快速上手：三分钟学会</a></li>
  <li><a href="#s3">发送文件</a></li>
  <li><a href="#s4">接收文件</a></li>
  <li><a href="#s5">管理我的分享</a></li>
  <li><a href="#s6">文件收集</a></li>
  <li><a href="#s7">收发记录</a></li>
  <li><a href="#s8">消息与通知</a></li>
  <li><a href="#s9">工作台与个人账户</a></li>
  <li><a href="#s10">团队空间</a></li>
  <li><a href="#s11">套餐与权益</a></li>
  <li><a href="#s12">常见问题 FAQ</a></li>
  <li><a href="#s13">注意事项与最佳实践</a></li>
  <li><a href="#s14">附录：功能限制速查表</a></li>
</ol></nav>

<h2 class="sec" id="s1"><span class="no">01</span>产品概述</h2>
<p class="lead">鲲穹文件传输是一款面向企业与团队的 Web 端文件传输/收集工具。它不提供永久云盘，而是把「临时把文件交给对方」这件事做到最轻：拖进来、生成链接、对方即开即下，到期自动清理，不占用任何人的网盘空间。</p>
<p>本手册面向访客、登录用户、团队所有者与成员，介绍文件传输、收集、个人账户和团队协作的使用方法。</p>

<h3>1.1 它适合做什么</h3>
<table class="tbl">
  <tr><th>场景</th><th>推荐用法</th></tr>
  <tr><td>给客户/同事传大文件（单文件最大 5 GB）</td><td>发送文件 → 把链接或取件码发给对方</td></tr>
  <tr><td>向外收集素材、作业、周报等</td><td>创建收集任务 → 分发链接 → 统一管理下载</td></tr>
  <tr><td>团队内部共享工作文件</td><td>团队空间 → 成员共用团队容量</td></tr>
  <tr><td>临时传一次、用完即走</td><td>免注册直传，默认 3 天后自动清理</td></tr>
</table>

<h3>1.2 角色与功能全景</h3>
<figure class="diagram">${d1}<figcaption>图 1　产品角色与模块全景</figcaption></figure>
<table class="tbl">
  <tr><th>角色</th><th>能做什么</th><th>是否需要登录</th></tr>
  <tr><td>访客</td><td>免注册直传文件；凭链接/取件码/二维码取件；提交收集任务</td><td>不需要</td></tr>
  <tr><td>登录用户</td><td>以上全部 + 收发记录、消息通知、个人资料、套餐权益</td><td>需要（鲲穹统一登录）</td></tr>
  <tr><td>团队所有者</td><td>登录用户全部 + 邀请/移除成员、审批入团申请、团队容量由其套餐提供</td><td>需要</td></tr>
  <tr><td>团队成员</td><td>登录用户全部 + 使用团队空间，可随时自主退出</td><td>需要</td></tr>
</table>

<h3>1.3 访问方式与环境要求</h3>
<ul>
  <li>推荐使用最新版 Chrome、Edge、Firefox 或 Safari 浏览器。</li>
  <li>部署地址以企业实际下发的网址为准。截图中的账号、文件和分享链接为演示数据，示例链接不用于实际取件。</li>
  <li>大文件上传期间请保持页面与网络连接稳定；上传支持分片与断点续传，意外中断后可在原页面上重试续传。</li>
</ul>

<h2 class="sec" id="s2"><span class="no">02</span>快速上手：三分钟学会</h2>
<h3>2.1 发送方：三步把文件交出去</h3>
<figure class="diagram">${d2}<figcaption>图 2　发送文件全流程</figcaption></figure>
<ol class="steps">
  <li><b>打开首页，拖入文件</b><span>无需注册登录，把文件拖到虚线框内，或点击「选择文件 / 选择文件夹」。</span></li>
  <li><b>（可选）点「分享设置」</b><span>调整有效期、下载次数、取件码长度，或开启提取密码。</span></li>
  <li><b>点「开始上传」</b><span>完成后立刻生成取件码、分享链接和二维码，用任意一种方式发给对方即可。</span></li>
</ol>
${fig('01-home', '简洁首页 —— 中央上传区，下方保留四项功能说明', '2-1')}
${fig('08-share-result', '上传完成：6 位取件码 + 分享链接 + 二维码一次生成', '2-2')}

<h3>2.2 接收方：三步拿到文件</h3>
<ol class="steps">
  <li><b>打开分享链接，或扫码</b><span>也可以在首页点「取件码」，输入分享者给你的 4-6 位取件码。</span></li>
  <li><b>（如有密码）输入提取密码验证</b><span>密码由分享者另行告知。</span></li>
  <li><b>点「下载全部文件」或单个文件旁的下载图标</b><span>多个文件会自动打包为 zip，保持原有目录结构。</span></li>
</ol>
${fig('01b-retrieve-modal', '取件码取件窗口 —— 输入 4-6 位取件码即可查找文件', '2-3')}
${fig('02-visitor-share', '访客取件页 —— 免登录，直接下载或逐个预览', '2-4')}

<h2 class="sec" id="s3"><span class="no">03</span>发送文件</h2>
<h3>3.1 界面导览</h3>
<p>登录后进入发送视图（默认视图）。顶栏从左到右依次是：<span class="kwd">发送文件</span> <span class="kwd">收集文件</span> <span class="kwd">收发记录</span> 三个主视图入口，右侧为团队入口、消息中心铃铛、套餐标识与账号菜单。</p>
${fig('05-send-logged-in', '登录后的发送视图 —— 右上角显示当前团队、消息中心与账号', '3-1')}

<h3>3.2 选择文件</h3>
<ul>
  <li>三种方式：拖拽到上传框、点「选择文件」、点「选择文件夹」（保留文件夹层级结构）。</li>
  <li>单次最多 <b>100 个</b>文件/文件夹；单个文件最大 <b>5 GB</b>。</li>
  <li>选中后进入「待发送文件」队列，可逐个移除或一键清空。</li>
</ul>
${fig('07-upload-queue', '待发送队列 —— 支持定向发送、分享设置与开始上传', '3-2')}

<h3>3.3 分享设置：让文件按你的规则失效</h3>
<p>点队列下方的 <span class="kwd">分享设置</span>，可以调整四件事：</p>
<table class="tbl">
  <tr><th>设置项</th><th>可选值</th><th>说明</th></tr>
  <tr><td>分享有效期</td><td>1 天 / 3 天 / 7 天 / 永久</td><td>到期后文件自动清理、链接失效。「永久」需要会员版及以上权益。</td></tr>
  <tr><td>下载次数</td><td>不限 / 10 次 / 1 次 / 自定义</td><td>达到上限后自动关闭分享。</td></tr>
  <tr><td>取件码长度</td><td>4 / 5 / 6 位</td><td>取件码是对方凭码取件的凭证。</td></tr>
  <tr><td>提取密码</td><td>开关 + 自定义密码</td><td>开启后对方需先输入密码才能看到文件。</td></tr>
</table>
${fig('06-share-settings-modal', '分享设置弹窗 —— 有效期 / 下载次数 / 取件码长度 / 提取密码', '3-3')}

<h3>3.4 定向发送（可选）</h3>
<p>在队列顶部「定向发送」输入框填入对方手机号或邮箱（多个用逗号分隔），上传完成后系统会向这些联系人发送包含链接与取件码的通知邮件。未配置邮件服务时只保留本地发送记录。</p>

<h3>3.5 上传与大文件分片</h3>
<ul>
  <li>点 <span class="kwd">开始上传</span> 后显示实时进度；大文件自动分片上传（每片 5 MB），单文件越大越能体现优势。</li>
  <li>上传中途可以「暂停 / 继续上传」；失败可「重试上传」，已传分片不浪费，断网重连后续传。</li>
  <li>上传期间请勿关闭或刷新页面。</li>
</ul>

<h3>3.6 上传完成：三种分享方式</h3>
<p>上传完成后，页面中央会生成一个大号取件码，右侧是二维码，下方是分享链接（如你所在企业开通了企业空间，还会额外生成一条企业专属链接）。任选其一发给对方：</p>
<ul>
  <li><b>取件码</b>：对方在本系统首页点「取件码」输入即可。</li>
  <li><b>链接</b>：微信/邮件/任意渠道发送，点开即见文件。</li>
  <li><b>二维码</b>：线下场景（会议投屏、打印）最方便。</li>
</ul>
${fig('09-qr-modal', '分享二维码弹窗 —— 可复制链接或复制二维码图片', '3-4')}

<h2 class="sec" id="s4"><span class="no">04</span>接收文件</h2>
<h3>4.1 通过链接或二维码</h3>
<p>点开对方发来的链接（或扫码）即进入取件页：顶部显示文件数量、总大小与有效期，中部是文件列表，底部是「下载全部文件」。文件名右侧的图标分别用于<b>在线预览</b>（支持图片 / PDF / Word / Excel / PPT 等常见格式）与<b>单文件下载</b>。</p>
${fig('02-visitor-share', '取件页：3 个文件，可预览、单下、打包下载', '4-1')}

<h3>4.2 密码保护分享</h3>
<p>如果对方开启了提取密码，取件页会先要求输入密码，验证通过后才会显示文件列表。密码请向分享者索取。</p>
${fig('03-visitor-share-password', '密码验证通过前只显示密码输入框', '4-2')}

<h3>4.3 注意</h3>
<div class="note"><b>提示：</b>取件与下载全程无需注册登录。若链接打不开，先确认是否已过有效期或达到下载次数上限，然后联系分享者重新生成。</div>

<h2 class="sec" id="s5"><span class="no">05</span>管理我的分享</h2>
<p>每次上传完成时，系统会同时生成一条<b>管理链接</b>（也可在「收发记录」中找到它）。通过管理链接可以：</p>
<ul>
  <li>查看剩余有效期、剩余下载次数与下载统计；</li>
  <li>延长有效期、修改提取密码与下载上限；</li>
  <li>复制分享信息或重新分享；</li>
  <li>手动关闭分享（文件立即不可访问，并按清理策略删除）。</li>
</ul>
<div class="warn"><b>重要：</b>管理链接等同于分享的「遥控器」，请妥善保管，不要与分享链接一起外发。</div>
${fig('19-share-manage', '分享管理页 —— 修改设置或随时关闭分享', '5-1')}

<h2 class="sec" id="s6"><span class="no">06</span>文件收集</h2>
<h3>6.1 创建收集任务</h3>
<p>顶栏切到 <span class="kwd">收集文件</span>，创建任务时可以设定：任务名称与说明、截止时间、允许的文件类型（图片/文档/视频/音频/压缩包/代码文件等白名单组合）、单文件大小上限（MB）。创建完成自动生成提交链接与二维码。</p>
<figure class="diagram">${d3}<figcaption>图 3　收集任务全流程</figcaption></figure>
${fig('10-collect-create', '收集文件视图 —— 填写任务信息并设定限制', '6-1')}

<h3>6.2 分发与提交</h3>
<ul>
  <li>把提交链接或二维码发给提交者；对方打开链接即可提交，<b>不强制登录</b>。</li>
  <li><b>登录鲲穹账号后提交</b>（推荐）：页面会直接显示你的账号身份，不必再手填名称；本次提交会记入你的账号，收集方一看就知道是谁提交的，也便于你日后在「收发记录 → 收集给我的」里回看。</li>
  <li><b>未登录也能提交</b>：手动填写「提交人名称」即可完成匿名提交，适合发给外部协作方。匿名提交在管理端会标注为「匿名提交」。</li>
  <li>提交者只能看到自己的提交，<b>互相不可见</b>；只有创建者能通过管理链接查看全部。</li>
  <li>超过截止时间、超过大小限制或类型不符时，系统会明确拒绝并提示原因。</li>
</ul>
${fig('11b-collect-submit-logged-in', '登录后提交 —— 直接显示账号身份，无需手填名称', '6-2')}
${fig('11c-collect-submit-anonymous', '未登录提交 —— 手动填写名称，匿名提交', '6-3')}

<h3>6.3 管理提交</h3>
<p>在「收发记录」或创建完成页进入管理链接，可以看到每一份提交：提交人、时间、文件列表，支持逐个预览/下载、删除违规提交，或一键打包下载全部提交（自动按提交人分目录）。</p>
<p>每份提交都带来源标识：<span class="kwd">账号提交</span> 表示提交者已登录，鼠标悬停可看到其账号名；<span class="kwd">匿名提交</span> 表示对方未登录、填写的是自报名称。来源标识按<b>账号当前昵称</b>实时显示，提交当时的名称会作为历史快照保留，不会被后续改名改写。</p>
${fig('11-collect-manage', '收集任务管理 —— 查看提交、下载、打包归档', '6-4')}
<div class="note"><b>提示：</b>任务截止后建议及时打包下载；如开启自动清理，过期文件会被定期删除。</div>

<h2 class="sec" id="s7"><span class="no">07</span>收发记录</h2>
<p>顶栏 <span class="kwd">收发记录</span> 汇总你名下的全部传输痕迹，分为四类：</p>
<table class="tbl">
  <tr><th>分类</th><th>含义</th></tr>
  <tr><td>我发的</td><td>你上传并分享出去的文件（含取件码、管理链接、剩余状态）</td></tr>
  <tr><td>发给我的</td><td>定向发送给你的分享（通过手机号/邮箱匹配）</td></tr>
  <tr><td>我收集的</td><td>你创建的收集任务与收到的全部提交</td></tr>
  <tr><td>收集给我的</td><td>你以提交者身份参与过的收集任务</td></tr>
</table>
<p>每条记录可以直接跳转「管理分享 / 管理任务」，也可以修改有效期、复制链接。</p>
${fig('12-records', '收发记录 —— 四个标签页覆盖全部收发历史', '7-1')}

<h2 class="sec" id="s8"><span class="no">08</span>消息与通知</h2>
<h3>8.1 消息中心</h3>
<p>顶栏铃铛图标是消息中心，汇总：分享被下载、收集任务收到新提交、入团申请、团队邀请等站内事件，可单条删除、全部已读或清除全部。</p>
${fig('17-message-center', '消息中心 —— 站内事件一手掌握', '8-1')}

<h3>8.2 邮件通知</h3>
<p>邮件通知启用后，分享下载、收集提交、定向分享等事件会同步发送邮件通知。邮件通知不可用时，可在消息中心查看站内记录。</p>
${fig('26-email-preview', '邮件通知示意 —— 收件人看到的分享通知样式', '8-2')}

<h2 class="sec" id="s9"><span class="no">09</span>工作台与个人账户</h2>
<h3>9.1 工作台总览</h3>
<p>账号菜单进入 <span class="kwd">工作台</span>：一页看清当前套餐、空间用量（个人空间条）、各套餐对比，以及你的团队空间状态。企业版/团队版权益下还会展示团队入口。</p>
${fig('13-workspace', '工作台 —— 套餐、容量、团队空间一页总览', '9-1')}

<h3>9.2 个人资料：昵称与头像</h3>
<ul>
  <li>在 <span class="kwd">设置</span> 页可修改昵称；团队内展示名会在保存后自动同步到所在团队。</li>
  <li><b>头像</b>：上传本地图片（≤2 MB，支持 png/jpg/webp/gif）后优先显示自定义头像；点「恢复登录头像」可回到鲲穹账号的登录头像。未上传时默认显示鲲穹账号的登录头像。</li>
</ul>
${fig('18-settings', '设置页 —— 昵称、头像、账号绑定与偏好', '9-2')}

<h3>9.3 绑定手机 / 邮箱</h3>
<p>设置页支持绑定手机号与邮箱（验证码校验）。绑定后：定向分享能准确送达你；加入团队、接收通知更可靠。</p>

<h2 class="sec" id="s10"><span class="no">10</span>团队空间</h2>
<h3>10.1 它是怎么运作的</h3>
<p>团队空间让成员共用一个「共享池」：<b>容量由团队所有者的套餐决定</b>（例如所有者是企业版，团队空间即 1024 GB）。成员自己的个人空间、个人分享、个人权益完全独立、不受影响。</p>
<figure class="diagram">${d5}<figcaption>图 4　个人空间与团队空间的容量模型</figcaption></figure>

<h3>10.2 加入团队的三种方式</h3>
<figure class="diagram">${d4}<figcaption>图 5　加入与退出团队</figcaption></figure>
<p>所有者可以在团队空间页复制<b>团队邀请链接</b>发给同事；对方登录鲲穹账号后打开链接即可申请加入，申请会出现在所有者的「入团申请」里等待审批。</p>
${fig('04-join-landing', '团队邀请落地页 —— 对方登录后点「申请加入团队」', '10-1')}

<h3>10.3 所有者：邀请与管理成员</h3>
<p>团队空间页提供四块信息：团队邀请链接、成员/空间/资源统计（KPI）、团队容量进度，以及四个页签：</p>
<table class="tbl">
  <tr><th>页签</th><th>用途</th></tr>
  <tr><td>成员观察</td><td>按成员查看用量排行；顶部搜索框可按邮箱/手机号/账号<b>直接邀请</b>成员</td></tr>
  <tr><td>团队资源</td><td>团队共享文件：成员可上传（受团队容量约束）、检索、下载</td></tr>
  <tr><td>团队成员</td><td>完整成员名单与角色，可转让所有权、移除成员（仅所有者可见）</td></tr>
  <tr><td>入团申请</td><td>审批通过链接提交的加入申请；拒绝后 24 小时内不可重复申请（仅所有者可见）</td></tr>
</table>
${fig('14-team-owner', '团队空间（所有者视角）：邀请链接 + KPI + 容量 + 页签', '10-2')}
${fig('15-team-manage-tab', '「团队成员」页签 —— 名单、角色与成员操作', '10-3')}
${fig('16-team-requests-tab', '「入团申请」页签 —— 审批同事的加入请求', '10-4')}

<h3>10.4 所有者：转让所有权与解散团队</h3>
<p>团队所有者拥有团队的最高管理权，同时也可以把团队交出去或结束它——两种操作都在 <span class="kwd">团队成员</span> 页签完成：</p>
<ul>
  <li><b>转让所有权</b>：在成员行点击 <b>👑 转让</b> 按钮，二次确认后该成员立即成为新所有者（负责成员管理、入团审批与容量），你则变为普通成员，此后可随时退出团队空间。注意：团队空间容量由<b>当前所有者</b>的套餐提供——若对方套餐不含团队版/企业版权益，团队空间功能会停用（成员的个人文件与套餐不受影响），转让确认弹窗中会明确提示。</li>
  <li><b>解散团队</b>：页签底部的红色「解散团队」区域，需经过<b>两次确认</b>。解散后全部成员立即失去团队空间访问权，团队的分享、收集与专属链接一并停止，且<b>无法恢复</b>；所有成员的个人文件、空间容量与套餐权益不受影响，并会收到站内通知。</li>
</ul>
${fig('15b-team-manage-actions', '「团队成员」页签操作区 —— 成员行的转让（👑）与移除（✕），底部为解散团队危险区', '10-5')}

<h3>10.5 成员：随时自主退出</h3>
<p>成员打开团队空间页，顶部会看到「退出团队空间」卡片。点击后二次确认即完成退出：</p>
<ul>
  <li>团队文件的访问权限立即收回；</li>
  <li><b>你个人的文件、空间容量、套餐权益完全不受影响</b>；</li>
  <li>团队所有者会收到退出通知；之后仍可通过邀请重新加入。</li>
</ul>
${fig('20-team-member', '成员视角 —— 顶部「退出团队空间」入口，页签只剩成员可见项', '10-6')}
<div class="note"><b>提示：</b>团队所有者不能直接退出自己的团队——先在「团队成员」页签把所有权转让给某位成员（见 10.4），之后即可退出；不想移交时也可以直接解散团队。</div>

<h2 class="sec" id="s11"><span class="no">11</span>套餐与权益</h2>
<p>个人套餐决定你的<b>个人</b>能力；团队相关能力只在加入团队后以「团队权益」形式借用，且仅限团队空间范围。具体容量与价格以工作台「查看权益详情」实时展示为准：</p>
<table class="tbl">
  <tr><th>权益维度</th><th>基础版</th><th>会员版</th><th>团队版</th><th>企业版</th></tr>
  <tr><td>个人空间</td><td>20 GB</td><td>100 GB</td><td>500 GB</td><td>2048 GB</td></tr>
  <tr><td>文件永久保存</td><td>—</td><td>✓</td><td>✓</td><td>✓</td></tr>
  <tr><td>可创建团队空间（作为所有者）</td><td>—</td><td>—</td><td>✓ 250 GB 团队空间</td><td>✓ 1024 GB 团队空间</td></tr>
  <tr><td>加入团队借用团队空间</td><td>✓</td><td>✓</td><td>✓</td><td>✓</td></tr>
</table>
<div class="note"><b>套餐说明：</b>加入高等级团队<b>不会</b>把你的个人套餐升级——个人容量、永久保存、分享有效期始终按你自己的套餐计算，可在工作台查看。</div>

<h2 class="sec" id="s12"><span class="no">12</span>常见问题 FAQ</h2>
<details class="faq"><summary>上传到一半断了怎么办？</summary><p>大文件采用分片上传并支持断点续传：回到原页面点「重试上传」即可续传，已上传部分不会浪费。请尽量保持页面打开、网络稳定。</p></details>
<details class="faq"><summary>单个文件最大多大？一次最多几个？</summary><p>登录后单文件最大 5 GB，未登录最大 500 MB；单次最多 100 个文件，文件夹内的文件也计入总数。实际限制以上传页面提示为准。</p></details>
<details class="faq"><summary>对方说打不开链接？</summary><p>按顺序检查：① 分享是否已过有效期或达到下载次数（在收发记录/管理链接查看状态）；② 是否开启了提取密码（对方需先验密码）；③ 链接是否被复制不完整。必要时在管理链接中延长有效期或重新生成分享。</p></details>
<details class="faq"><summary>取件码忘了发给对方怎么办？</summary><p>在「收发记录 → 我发的」找到该分享，取件码与管理链接都在详情里，可随时复制重发。</p></details>
<details class="faq"><summary>文件会被保存多久？</summary><p>按分享设置的有效期（默认 3 天，可设 1/7 天或永久）。到期后文件自动清理，链接立即失效。「永久」需要会员版及以上权益。</p></details>
<details class="faq"><summary>我上传的自定义头像怎么不见了？</summary><p>自定义头像一旦上传就会稳定保存，重新登录也不会丢。如果想恢复鲲穹账号的登录头像，到「设置 → 头像」点「恢复登录头像」即可。</p></details>
<details class="faq"><summary>加入团队后我的个人空间变大了？</summary><p>没有。团队空间是「共享池」，只在团队范围内使用；你的个人套餐、容量与权益始终按你自己原来的计算。退出团队也只收回团队空间使用权。</p></details>
<details class="faq"><summary>提交收集任务时提示类型/大小不符？</summary><p>任务创建者设置了类型白名单与单文件上限。请核对任务页标注的「文件类型」与「单人上限」，必要时压缩或转换格式后再提交。</p></details>
<details class="faq"><summary>入团申请被拒绝后还能再申请吗？</summary><p>可以，但被拒绝后 24 小时内不能重复申请同一团队，冷却期结束后再试。</p></details>
<details class="faq"><summary>误删/误关了分享能恢复吗？</summary><p>关闭后的分享不可访问。会员版及以上用户可在管理链接中对未清理的文件重新开启（reopen）；若文件已到期清理则无法恢复，请重新上传。</p></details>

<h2 class="sec" id="s13"><span class="no">13</span>注意事项与最佳实践</h2>
<h3>安全</h3>
<ul>
  <li><b>管理链接 = 控制权</b>：它与分享链接一一对应，泄露出去别人就能改设置甚至关闭分享。只在可信渠道传递。</li>
  <li>对外发送敏感文件时，建议同时开启<b>提取密码</b>并另行（口头/私信）告知密码。</li>
  <li>设置下载次数上限（如 1 次）可用于一次性交付场景。</li>
</ul>
<h3>有效期与清理</h3>
<ul>
  <li>临时分享默认 3 天；重要文件请提前延长有效期或使用永久保存权益。</li>
  <li>到期文件会自动清理以释放空间；需要长期归档请下载到本地或网盘后再分享。</li>
</ul>
<h3>大文件</h3>
<ul>
  <li>上传大文件期间保持标签页前台、避免系统休眠；分片机制能扛网络抖动，但不能弥补页面被关闭。</li>
  <li>多文件传输用「选择文件夹」可完整保留目录层级，接收方打包下载后结构一致。</li>
</ul>
<h3>隐私</h3>
<ul>
  <li>收集任务的提交者互相不可见，只有任务创建者可查看全部提交。</li>
  <li>登录后提交会把你的账号与显示名告知任务创建者（这是「登录提交」的用途）；若不想暴露账号，可不登录、改用匿名方式提交。</li>
  <li>团队空间内所有者与成员均可查看团队资源列表，请勿存放与团队无关的私人文件。</li>
</ul>

<h2 class="sec" id="s14"><span class="no">14</span>附录：功能限制速查表</h2>
<table class="tbl">
  <tr><th>项目</th><th>默认限制</th><th>备注</th></tr>
  <tr><td>单文件大小</td><td>登录后 ≤ 5 GB；未登录 ≤ 500 MB</td><td>以上传页面提示为准</td></tr>
  <tr><td>单次文件数</td><td>≤ 100 个</td><td>文件+文件夹合计</td></tr>
  <tr><td>取件码</td><td>4-6 位（默认 6 位）</td><td>分享设置中可选</td></tr>
  <tr><td>分享有效期</td><td>默认 3 天，可选 1/7 天/永久</td><td>永久需会员版+；以分享设置可选项为准</td></tr>
  <tr><td>下载次数</td><td>默认不限</td><td>可设 10 次 / 1 次 / 自定义</td></tr>
  <tr><td>自定义头像</td><td>≤ 2 MB</td><td>png / jpg / webp / gif</td></tr>
  <tr><td>收集任务类型白名单</td><td>图片/文档/视频/音频/压缩包/代码文件/其他</td><td>创建任务时勾选</td></tr>
  <tr><td>入团申请冷却</td><td>被拒后 24 小时</td><td>同一团队同一用户</td></tr>
  <tr><td>分片大小</td><td>5 MB/片</td><td>大文件自动启用断点续传</td></tr>
</table>

<p style="margin-top:56px;color:#9aada7;font-size:12.5px;text-align:center;">— 手册完 · 鲲穹文件传输 · 临时传输，轻装上阵 —</p>
</div>
<a class="back-top" href="#top">回到顶部 ↑</a>
</body>
</html>`

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(OUT, html)
console.log(`手册已生成: ${OUT}`)
console.log(`大小: ${(fs.statSync(OUT).size / 1024 / 1024).toFixed(2)} MB`)
