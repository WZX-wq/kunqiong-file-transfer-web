/* ===== 基础：图标、原子组件、图表 ===== */
const ICONS = {
  transfer:'<path d="M14 3.2h3.8A3 3 0 0 1 20.8 6.2v11.6a3 3 0 0 1-3 3H14"/><path d="M3.2 12h10.6"/><path d="M9.6 7.8 13.8 12l-4.2 4.2"/>',
  upload:'<path d="M12 16V5"/><path d="M7.5 9.5 12 5l4.5 4.5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  folderUp:'<path d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 15v-4"/><path d="M10 13l2-2 2 2"/>',
  folder:'<path d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  file:'<path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M13.5 3v5.5H19"/>',
  files:'<path d="M9 3h6.5L19 6.5V17a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M15 3v4h4"/><path d="M5 7v12a2 2 0 0 0 2 2h8"/>',
  shield:'<path d="M12 3.2l7 2.9v5.6c0 4.2-2.9 7.4-7 8.9-4.1-1.5-7-4.7-7-8.9V6.1z"/>',
  shieldCheck:'<path d="M12 3.2l7 2.9v5.6c0 4.2-2.9 7.4-7 8.9-4.1-1.5-7-4.7-7-8.9V6.1z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
  lock:'<rect x="4.5" y="10" width="15" height="10.5" rx="2"/><path d="M8 10V7.2a4 4 0 0 1 8 0V10"/>',
  users:'<circle cx="9.2" cy="8" r="3.2"/><path d="M3.2 19.6a6 6 0 0 1 12 0"/><path d="M16.4 5.4a3.2 3.2 0 0 1 0 5.2"/><path d="M17.6 14.6a5.6 5.6 0 0 1 3.2 5"/>',
  user:'<circle cx="12" cy="8" r="3.6"/><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0"/>',
  userPlus:'<circle cx="9.5" cy="8" r="3.4"/><path d="M3 19.5a6.5 6.5 0 0 1 13 0"/><path d="M18.5 8v6M15.5 11h6"/>',
  building:'<path d="M4.5 20.5V5a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 16.5 5v15.5"/><path d="M16.5 9.5h2a1.5 1.5 0 0 1 1.5 1.5v9.5"/><path d="M3 20.5h18"/><path d="M8 8h1.5M12 8h1.5M8 12h1.5M12 12h1.5M8 16h1.5M12 16h1.5"/>',
  copy:'<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 5.5V5a2 2 0 0 0-2-2H5.5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2H6"/>',
  check:'<path d="M4.5 12.5l5 5L19.5 7"/>',
  x:'<path d="M6 6l12 12M18 6L6 18"/>',
  chevronRight:'<path d="M9.5 6l6 6-6 6"/>',
  chevronDown:'<path d="M6 9.5l6 6 6-6"/>',
  chevronLeft:'<path d="M14.5 6l-6 6 6 6"/>',
  download:'<path d="M12 4v11"/><path d="M7.5 10.5 12 15l4.5-4.5"/><path d="M4.5 19.5h15"/>',
  search:'<circle cx="10.8" cy="10.8" r="6.3"/><path d="M15.5 15.5 20 20"/>',
  trash:'<path d="M4 7h16"/><path d="M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7"/><path d="M6.2 7l.9 12.1a1.8 1.8 0 0 0 1.8 1.7h6.2a1.8 1.8 0 0 0 1.8-1.7L17.8 7"/><path d="M10.5 11v6M13.5 11v6"/>',
  clock:'<circle cx="12" cy="12" r="8.2"/><path d="M12 7.6V12l3.2 2"/>',
  bell:'<path d="M18 9.5a6 6 0 1 0-12 0c0 4.2-1.5 5.5-1.5 5.5h15S18 13.7 18 9.5z"/><path d="M10 18.5a2.2 2.2 0 0 0 4 0"/>',
  gear:'<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l1.7-1.3-1.9-3.3-2 .8a7 7 0 0 0-2-1.2L14.4 3h-3.8l-.3 1.8a7 7 0 0 0-2 1.2l-2-.8L4.4 8.5l1.7 1.3A7 7 0 0 0 6 12c0 .4 0 .8.1 1.2L4.4 14.5l1.9 3.3 2-.8a7 7 0 0 0 2 1.2l.3 1.8h3.8l.3-1.8a7 7 0 0 0 2-1.2l2 .8 1.9-3.3-1.7-1.3c.1-.4.1-.8.1-1.2z"/>',
  card:'<rect x="3" y="5.5" width="18" height="13" rx="2.2"/><path d="M3 10h18"/><path d="M6.5 14.5h4"/>',
  more:'<circle cx="6" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18" cy="12" r="1.3"/>',
  link:'<path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7l-1.4 1.4"/><path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 0 0 5.7 5.7l1.4-1.4"/>',
  qr:'<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1"/><path d="M14 14h2.5v2.5H14zM18.5 14h2M14 18.5V21M18.5 18.5h2V21h-2z"/>',
  mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.8 6.5l7.3 5.4a1.5 1.5 0 0 0 1.8 0l7.3-5.4"/>',
  alert:'<path d="M12 4.5l8.5 15h-17z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
  refresh:'<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4.5V9h-4.5"/>',
  filter:'<path d="M3.5 6h17"/><path d="M6.5 12h11"/><path d="M10 18h4"/>',
  calendar:'<rect x="3.5" y="5.5" width="17" height="15" rx="2"/><path d="M3.5 10h17"/><path d="M8 3.5v4M16 3.5v4"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  edit:'<path d="M4 20l.8-4.2L15.6 5a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L8.2 19.2z"/><path d="M14.2 6.4l3.4 3.4"/>',
  eye:'<path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  eyeOff:'<path d="M4 4l16 16"/><path d="M9.9 5.2A9.6 9.6 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-3.4 4.3"/><path d="M6.2 6.9A17 17 0 0 0 2.5 12S6 19 12 19a9.4 9.4 0 0 0 4.1-.9"/><path d="M10.1 10.3a2.8 2.8 0 0 0 3.7 3.9"/>',
  logout:'<path d="M15 5.5V4a1.5 1.5 0 0 0-1.5-1.5H5.5A1.5 1.5 0 0 0 4 4v16a1.5 1.5 0 0 0 1.5 1.5h8A1.5 1.5 0 0 0 15 20v-1.5"/><path d="M9.5 12h11"/><path d="M17 8.5l4 3.5-4 3.5"/>',
  key:'<circle cx="8" cy="8" r="4.2"/><path d="M11 11l8.5 8.5"/><path d="M17 17l2-2M18.6 18.6l2-2"/>',
  chart:'<path d="M4 20V4"/><path d="M4 20h16"/><path d="M8 16v-4M12.5 16V8M17 16v-6"/>',
  activity:'<path d="M3 12h3.5l2.5 6 4-13 2.5 7h5.5"/>',
  sliders:'<path d="M4 8h9M18 8h2M4 16h4M13 16h7"/><circle cx="15.5" cy="8" r="2.2"/><circle cx="10.5" cy="16" r="2.2"/>',
  server:'<rect x="3.5" y="4" width="17" height="7" rx="1.8"/><rect x="3.5" y="13" width="17" height="7" rx="1.8"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  globe:'<circle cx="12" cy="12" r="8.2"/><path d="M3.8 12h16.4"/><path d="M12 3.8c2.2 2.3 3.4 5.1 3.4 8.2s-1.2 5.9-3.4 8.2c-2.2-2.3-3.4-5.1-3.4-8.2S9.8 6.1 12 3.8z"/>',
  monitor:'<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M9 20.5h6M12 16.5v4"/>',
  mobile:'<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18.5h2"/>',
  cloud:'<path d="M7.5 18.5a4.2 4.2 0 0 1-.4-8.4 6 6 0 0 1 11.4 1.6 3.6 3.6 0 0 1-.5 7.1"/>',
  arrowRight:'<path d="M4.5 12h14"/><path d="M13.5 7l5 5-5 5"/>',
  arrowLeft:'<path d="M19.5 12h-14"/><path d="M10.5 7l-5 5 5 5"/>',
  send:'<path d="M20.5 3.5L10 14"/><path d="M20.5 3.5l-6.4 17-4.1-6.5L3.5 10z"/>',
  inbox:'<path d="M3.5 13.5h4l1.5 3h6l1.5-3h4"/><path d="M4.8 5.4L3.5 13.5v4a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-4l-1.3-8.1a2 2 0 0 0-2-1.7H6.8a2 2 0 0 0-2 1.7z"/>',
  wifi:'<path d="M4 9.5a12 12 0 0 1 16 0"/><path d="M7 13a8 8 0 0 1 10 0"/><path d="M10 16.5a3.5 3.5 0 0 1 4 0"/><path d="M12 20h.01"/>',
  history:'<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4.5V9h4.5"/><path d="M12 8.5V12l2.8 1.7"/>'
};

function icon(name, size = 16, sw = 1.6) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:0 0 auto">${ICONS[name] || ''}</svg>`;
}

const mark = (size = 26) => `<svg width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true" style="flex:0 0 auto">
  <rect width="32" height="32" rx="8.4" fill="#1677FF"/>
  <g fill="#fff">
    <circle cx="11.5" cy="19" r="4.6"/>
    <circle cx="17.8" cy="16.8" r="5.6"/>
    <circle cx="22.1" cy="19.4" r="3.8"/>
    <rect x="10.6" y="18" width="12.8" height="5" rx="2.5"/>
  </g>
  <g fill="none" stroke="#1677FF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M16.7 21.8V13.4"/>
    <path d="M13.4 16.7 16.7 13.4l3.3 3.3"/>
  </g>
</svg>`;

const brand = () => `<span class="brand">${mark()}鲲穹<span style="font-size:13px;color:var(--ink-4);font-weight:400;letter-spacing:.08em;margin-left:4px">文件传输</span></span>`;

const avatar = (name, cls = '') => {
  const t = /[A-Za-z]/.test(name) ? name.slice(0, 2).toUpperCase() : name.slice(-2);
  return `<span class="avatar ${cls}">${t}</span>`;
};

const tag = (text, kind = '', dot = false) =>
  `<span class="tag ${kind ? 'tag--' + kind : ''}">${dot ? '<i class="dot"></i>' : ''}${text}</span>`;

const EXT_LABEL = { pdf: 'PDF', doc: 'DOCX', xls: 'XLSX', zip: 'ZIP', img: 'PNG', vid: 'MP4', fig: 'FIG', gen: 'FILE' };
const ftype = (ext = 'gen', lg = false) =>
  `<span class="ftype ftype--${ext}${lg ? ' ftype--lg' : ''}">${EXT_LABEL[ext] || 'FILE'}</span>`;

function fileRow({ name, ext = 'pdf', meta = '', right = '', iconAfter = '' }) {
  return `<div class="filerow">${ftype(ext)}<div class="flex1"><div class="nm trunc">${name}${iconAfter}</div><div class="mt">${meta}</div></div>${right}</div>`;
}

/* 伪二维码：确定性图案，用于原型展示 */
function qrSVG(size = 200) {
  const n = 25, cell = size / n;
  let seed = 20261019;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const finder = (x, y) => `<rect x="${x * cell}" y="${y * cell}" width="${7 * cell}" height="${7 * cell}" fill="#0A1B33"/><rect x="${(x + 1) * cell}" y="${(y + 1) * cell}" width="${5 * cell}" height="${5 * cell}" fill="#fff"/><rect x="${(x + 2) * cell}" y="${(y + 2) * cell}" width="${3 * cell}" height="${3 * cell}" fill="#0A1B33"/>`;
  const inFinder = (x, y) => (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
  let cells = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (inFinder(x, y)) continue;
    if (rnd() > 0.52) cells += `<rect x="${x * cell}" y="${y * cell}" width="${cell}" height="${cell}" fill="#0A1B33"/>`;
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="分享二维码">${cells}${finder(0, 0)}${finder(n - 7, 0)}${finder(0, n - 7)}</svg>`;
}

/* 趋势折线图 */
function trendChart({ w = 520, h = 170, data, data2 = null, max, labels, unit = '' }) {
  const padL = 46, padB = 26, padT = 10, padR = 26;
  const iw = w - padL - padR, ih = h - padT - padB;
  const pts = data.map((v, i) => [padL + (iw * i) / (data.length - 1), padT + ih - (ih * v) / max]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = `${line} L ${padL + iw} ${padT + ih} L ${padL} ${padT + ih} Z`;
  const grid = [0, 0.5, 1].map(t => {
    const y = padT + ih - ih * t;
    return `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="#E6EEF9" stroke-width="1"/><text x="${padL - 8}" y="${y + 3.5}" text-anchor="end" font-size="13" fill="#93A5BC" font-family="var(--mono)">${Math.round(max * t)}</text>`;
  }).join('');
  const xlab = labels.map((l, i) => `<text x="${padL + (iw * i) / (labels.length - 1)}" y="${h - 6}" text-anchor="middle" font-size="13" fill="#93A5BC">${l}</text>`).join('');
  const dots = pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="2.6" fill="#fff" stroke="#1677FF" stroke-width="1.8"/>`).join('');
  let line2 = '';
  if (data2) {
    const p2 = data2.map((v, i) => [padL + (iw * i) / (data2.length - 1), padT + ih - (ih * v) / max]);
    line2 = `<path d="${p2.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')}" fill="none" stroke="#A9C6F0" stroke-width="1.8" stroke-dasharray="5 4" stroke-linejoin="round"/>`;
  }
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="趋势图"><defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1677FF" stop-opacity=".18"/><stop offset="1" stop-color="#1677FF" stop-opacity="0"/></linearGradient></defs>${grid}<path d="${area}" fill="url(#ga)"/><path class="trendline" pathLength="1" d="${line}" fill="none" stroke="#1677FF" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${line2}${dots}${xlab}</svg>`;
}

/* 横向条形 */
function bars({ rows, w = 300, max = 100, unit = '%' }) {
  return `<div class="col g12" style="width:${w}px">${rows.map(r => {
    const [k, v, c] = Array.isArray(r) ? r : [r.k, r.v, r.c];
    return `<div>
      <div class="between" style="font-size:13px;color:#4B5F79"><span>${k}</span><span class="mono" style="color:#0A1B33">${v}${unit}</span></div>
      <div class="bar bar--thin mt6"><i style="width:${(v / max) * 100}%;background:${c || '#1677FF'}"></i></div>
    </div>`;
  }).join('')}</div>`;
}

const money = n => '¥' + n.toFixed(2).replace(/\.00$/, '');

/* 确定性条码：给单据一个可核对的"物证" */
function barcode(w = 176, h = 32) {
  let seed = 483917;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let bars = '', x = 0;
  while (x < w - 3) {
    const bw = 1 + Math.round(rnd() * 2.2);
    const gap = 1 + Math.round(rnd() * 1.7);
    if (rnd() > 0.3) {
      const tall = rnd() > 0.42;
      bars += `<i style="width:${bw}px;height:${tall ? 100 : 74}%"></i>`;
    } else {
      bars += `<i style="width:${bw}px;height:100%;background:transparent"></i>`;
    }
    x += bw + gap;
  }
  return `<div class="barcode" style="width:${w}px;height:${h}px" aria-hidden="true">${bars}</div>`;
}

/* 四角定位标记 */
const ticks = () => ['tl', 'tr', 'bl', 'br'].map(k => `<i class="tick tick--${k}"></i>`).join('');

/* 骑缝章 */
const stamp = (en = 'SCAN PASSED', cn = '扫描通过', style = '') =>
  `<span class="stamp" style="${style}"><small>${en}</small><b>${cn}</b></span>`;

/* 迷你趋势线 */
function spark(data, w = 112, h = 16, color = 'currentColor') {
  const max = Math.max(...data), min = Math.min(...data);
  const pts = data.map((v, i) => [2 + (w - 4) * i / (data.length - 1), h - 2 - (h - 4) * (v - min) / (max - min || 1)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" aria-hidden="true" style="display:block"><path class="sparkline" pathLength="1" d="${d}" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${pts[pts.length - 1][0]}" cy="${pts[pts.length - 1][1]}" r="1.9" fill="${color}"/></svg>`;
}


/* ===== 页面骨架 ===== */

const NAV_ITEMS = ['发文件', '收集文件', '收发记录', '团队空间'];
const NAV_ROUTES = {
  '发文件': 'index.html',
  '收集文件': 'collect.html',
  '收发记录': 'records.html',
  '团队空间': 'team.html'
};

function appTopbar(active = '发文件') {
  return `<header class="topbar topbar--flush">
    <div class="topbar__in">
      <a href="index.html" class="brand-link" aria-label="返回首页">${brand()}</a>
      <nav class="nav">
        ${NAV_ITEMS.map(n => `<a href="${NAV_ROUTES[n]}" class="${n === active ? 'on' : ''}">${n}</a>`).join('')}
      </nav>
      <div class="tb-right">
        <a href="plan.html" class="tag tag--mute" style="height:26px;padding:0 9px;gap:6px;font-weight:400;text-decoration:none">${icon('card', 13)}会员版 · 剩余 142 天</a>
        <a href="messages.html" class="iconbtn" aria-label="消息" style="text-decoration:none">${icon('bell', 18)}<i class="dotred"></i></a>
        <a href="settings-profile.html" class="iconbtn" aria-label="设置" style="text-decoration:none">${icon('sliders', 18)}</a>
        <div class="vdiv" style="height:22px;margin:0 2px"></div>
        <a href="settings-profile.html" class="me" style="text-decoration:none">${avatar('李明', 'avatar--sm')}<span style="font-size:13px">李明</span>${icon('chevronDown', 13)}</a>
      </div>
    </div>
  </header>`;
}

function appShell({ active = '发送文件', title = '', sub = '', actions = '', body = '', tight = false }) {
  return `${appTopbar(active)}
  <div class="container page" style="${tight ? 'padding-top:22px' : ''}">
    ${title ? `<div class="page-hd">
      <div><h1 class="h1">${title}</h1>${sub ? `<p class="lead" style="margin-top:6px">${sub}</p>` : ''}</div>
      <div class="row g8">${actions}</div>
    </div>` : ''}
    <div class="col g16" style="flex:1;min-height:0">${body}</div>
  </div>`;
}

function settingsShell({ active, title, sub, actions = '', body }) {
  const items = [
    ['个人资料', 'user', 'settings-profile.html'], ['账号与安全', 'shield', 'settings-security.html'],
    ['消息通知', 'bell', 'settings-notice.html'], ['我的订单', 'card', 'settings-orders.html'],
    ['会员与套餐', 'card', 'plan.html']
  ];
  return appShell({
    active: '设置',
    title,
    sub,
    actions,
    body: `<div class="settings">
      <aside class="set-rail">
        <div class="grp">账户设置</div>
        ${items.map(([n, ic, href]) => `<a href="${href}" class="${n === active ? 'on' : ''}">${icon(ic, 16)}${n}</a>`).join('')}
        <div class="grp">工作台</div>
        <a href="index.html">${icon('history', 16)}返回工作台</a>
      </aside>
      <div class="set-main">${body}</div>
    </div>`
  });
}

function pubHeader({ nav = [], right = '', inner = '' }) {
  return `<header class="topbar topbar--flush" style="height:68px;flex:0 0 68px">
    <div class="topbar__in ${inner}">
      <a href="index.html" class="brand-link" aria-label="返回首页">${brand()}</a>
      ${nav.length ? `<nav class="nav" style="height:68px">${nav.map((n, i) => `<a href="#" class="${i === 0 ? 'on' : ''}" style="height:68px">${n}</a>`).join('')}</nav>` : ''}
      <div class="tb-right">${right}</div>
    </div>
  </header>`;
}

function pubShell({ header, body, cls = 'pub', foot = true }) {
  return `<div class="${cls}">
    ${header}
    ${body}
    ${foot ? `<footer class="pub-foot"><span>鲲穹 · 企业文件传输</span><span>传输加密 · 到期销毁 · 服务条款 · 隐私政策</span></footer>` : ''}
  </div>`;
}

function adminShell({ active, crumb, title, sub, actions = '', body, wide = false }) {
  const items = [
    ['数据看板', 'chart', 'admin-dashboard.html'], ['资源管理', 'files', 'admin-resources.html'],
    ['用户管理', 'users', 'admin-users.html'], ['安全日志', 'shield', 'admin-logs.html'],
    ['系统配置', 'sliders', 'admin-config.html']
  ];
  return `<div class="admin">
    <aside class="arail">
      <div class="abrand">${mark(24)}鲲穹<span class="latin">运营后台</span></div>
      <div class="anav">
        ${items.map(([n, ic, href]) => `<a href="${href}" class="${n === active ? 'on' : ''}">${icon(ic, 16)}${n}</a>`).join('')}
      </div>
      <div class="agrp">其他</div>
      <div class="anav" style="padding-top:0">
        <a href="index.html">${icon('globe', 16)}返回官网</a>
        <a href="admin-config.html">${icon('file', 16)}接口文档</a>
      </div>
      <div class="afoot">${avatar('张衡', 'avatar--sm avatar--navy')}<div><div style="color:#E7EFFA">张衡</div><div style="font-size:13px;color:#6C84A3">超级管理员</div></div></div>
    </aside>
    <div class="amain">
      <div class="abar">
        <div class="crumb">运营后台 ${icon('chevronRight', 12)} <b>${crumb || active}</b></div>
        <div class="tb-right">
          <span class="tag tag--mute" style="height:24px">生产环境</span>
          <button class="iconbtn" aria-label="通知">${icon('bell', 18)}</button>
          <div class="vdiv" style="height:20px"></div>
          <div class="row g8">${avatar('张衡', 'avatar--sm')}<span style="font-size:13px;color:var(--ink-2)">张衡</span>${icon('chevronDown', 12)}</div>
        </div>
      </div>
      <div class="abody">
        ${title ? `<div class="page-hd" style="flex:0 0 auto">
          <div><h1 class="h1" style="font-size:24px;line-height:32px">${title}</h1>${sub ? `<p class="sub" style="margin-top:4px">${sub}</p>` : ''}</div>
          <div class="row g8">${actions}</div>
        </div>` : ''}
        ${body}
      </div>
    </div>
  </div>`;
}

/* 小工具：搜索框、下拉、分页 */
const searchBox = (ph, w = 260) => `<div style="position:relative;width:${w}px">
  <span style="position:absolute;left:11px;top:11px;color:var(--ink-4)">${icon('search', 15)}</span>
  <div class="input input--sm" style="padding-left:33px;color:var(--ink-4);font-size:13px">${ph}</div>
</div>`;

const selectBox = (label, w = 128, on = false) => `<div class="select" style="width:${w ? w + 'px' : '100%'}">
  <div class="input input--sm ${on ? 'is-focus' : ''}" style="color:${on ? 'var(--ink)' : 'var(--ink-3)'}">${label}</div>
  ${icon('chevronDown', 14)}
</div>`;

const pagerBottom = (total, cur = 1) => `<div style="margin-top:auto">${pager(total, cur)}</div>`;

const pager = (total, cur = 1) => `<div class="pager"><span>共 ${total} 条</span><div class="pg">
  <b>${icon('chevronLeft', 12)}</b><b class="on">${cur}</b><b>2</b><b>3</b><b>${icon('chevronRight', 12)}</b>
</div></div>`;


/* ===== 01–11 发送与取件 ===== */

const dropArt = (s = 108) => `<svg width="${s}" height="${Math.round(s * .78)}" viewBox="0 0 104 81" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M8 31a6 6 0 0 1 6-6h21l7 8h50a6 6 0 0 1 6 6v32a6 6 0 0 1-6 6H14a6 6 0 0 1-6-6z"/>
  <path d="M52 66V43"/><path d="M43 52l9-9 9 9"/>
  <path d="M21 25h18" opacity=".4"/>
</svg>`;

/* ---------- 01 首页 · 发文件 ---------- */
function sendHomeBody() {
  const setRow = (k, v) => `<button class="setrow"><span class="setrow__k">${k}</span><span class="setrow__v">${v}${icon('chevronDown', 14)}</span></button>`;
  const rows = [
    ['pdf', '报价单-2026Q4.pdf', '3 个文件 · 248.6 MB', '483 917', '等待取件', '', '10-26 18:00', 'share.html'],
    ['zip', '项目资料-终稿.zip', '1 个文件 · 86.2 MB', '902 471', '已下载 2 次', 'ok', '10-24 09:30', 'share.html'],
    ['fig', '设计稿-v12.fig', '1 个文件 · 312.4 MB', '117 058', '已过期', 'mute', '10-18 12:00', 'records.html'],
    ['doc', '合同附件-补充条款.docx', '2 个文件 · 4.8 MB', '640 215', '已下载 1 次', 'ok', '10-15 16:40', 'records.html'],
    ['xls', '项目排期-十月.xlsx', '1 个文件 · 1.2 MB', '358 204', '已下载 3 次', 'ok', '10-12 10:20', 'records.html'],
    ['zip', '旧版LOGO归档.zip', '1 个文件 · 64.2 MB', '204 913', '已过期', 'mute', '10-09 15:00', 'records.html']
  ];
  return `<div class="pub">
  <header class="topbar topbar--flush" style="height:64px;flex:0 0 64px">
    <div class="topbar__in">
      <a href="index.html" class="brand-link" aria-label="返回首页">${brand()}</a>
      <nav class="nav" style="height:64px">
        <a href="index.html" class="on" style="height:64px">发文件</a>
        <a href="collect.html" style="height:64px">收集文件</a>
        <a href="records.html" style="height:64px">收发记录</a>
        <a href="team.html" style="height:64px">团队空间</a>
      </nav>
      <div class="tb-right">
        <a href="#" class="link" style="color:var(--ink-3);font-size:13.5px">登录</a>
        <a href="records.html" class="btn btn--ghost btn--sm" style="height:32px;padding:0 13px">我的文件</a>
      </div>
    </div>
  </header>

  <div class="pub-body" style="align-items:flex-start">
    <div class="container hp">
      <div class="between hp-hd">
        <div>
          <h1 class="hp-title">发文件</h1>
          <p class="hp-sub">拖进来就能发，对方输入 6 位取件码即可下载，无需注册</p>
        </div>
        <a href="retrieve.html" class="hp-retrieve">取件码取文件${icon('arrowRight', 14)}</a>
      </div>

      <div class="hp-main">
        <div class="dz">
          <span class="dz__ic">${icon('upload', 24, 1.5)}</span>
          <div class="dz__t">把文件拖到这里</div>
          <div class="dz__s">也可以从本机选择，支持文件夹与断点续传</div>
          <div class="row g10" style="margin-top:20px">
            <button class="btn btn--primary btn--pk">选择文件</button>
            <button class="btn btn--ghost btn--pk">选择文件夹</button>
          </div>
          <div class="dz__hint">单个文件最大 10 GB · 一次最多 200 个 · 可直接粘贴截图</div>
        </div>

        <aside class="hp-set">
          <div class="hp-set__hd">传输设置</div>
          ${setRow('有效期', '48 小时后')}
          ${setRow('取件密码', '未设置')}
          ${setRow('下载次数', '不限')}
          ${setRow('指定接收人', '任何人')}
          <p class="hp-set__note">到期后文件与副本一并删除，取件码同时失效</p>
          <div class="hp-usage">
            <div class="between" style="font-size:13px">
              <span style="color:var(--ink-4)">已用存储</span>
              <span style="color:var(--ink-2)">2.4 GB / 10 GB</span>
            </div>
            <div class="hp-usage__bar"><i style="width:24%"></i></div>
            <a href="plan.html" class="hp-usage__link">升级获得 1 TB${icon('chevronRight', 13)}</a>
          </div>
        </aside>
      </div>

      <section class="hp-recent">
        <div class="between hp-recent__hd">
          <h2>最近发送</h2>
          <a href="records.html" class="link">全部记录</a>
        </div>
        ${rows.map(([ext, name, meta, code, st, kind, time, href]) => `<a class="hp-row" href="${href}">
          ${ftype(ext)}
          <span class="hp-row__main"><span class="hp-row__name">${name}</span><span class="hp-row__meta">${meta}</span></span>
          <span class="hp-row__code">${code}</span>
          <span class="tag ${kind ? 'tag--' + kind : ''}">${st}</span>
          <span class="hp-row__time">${time}</span>
          <span class="hp-row__go">${icon('chevronRight', 15)}</span>
        </a>`).join('')}
      </section>
    </div>
  </div>

  <footer class="pub-foot"><span>鲲穹 · 企业文件传输</span><span>传输加密 · 到期销毁 · 服务条款 · 隐私政策</span></footer>
</div>`;
}

/* ---------- 02 取件码弹窗 ---------- */
function s02() {
  const boxes = ['4', '8', '3', '9', '1', ''].map((d, i) =>
    `<span class="box ${d ? 'filled' : 'active caret'}">${d}</span>`).join('');
  return `<div class="frame">
    ${sendHomeBody()}
    <div class="scrim"></div>
    <div class="modal modal--md modal--accent" style="top:47%">
      <div class="modal-hd">
        <div>
          <div class="eyebrow" style="margin-bottom:7px">Step 02 / Pickup</div>
          <h2 class="h2" style="font-size:21px">输入取件码</h2>
          <p class="sub" style="margin-top:5px">取件码由发送者提供，一共 6 位数字</p>
        </div>
        <button class="modal-x" aria-label="关闭">${icon('x', 16)}</button>
      </div>
      <div class="modal-bd">
        <div class="code6">${boxes}</div>
        <div class="row between" style="margin-top:9px">
          <span class="mono" style="font-size:13px;color:var(--ink-4)">已输入 5 / 6</span>
          <a href="#" class="link" style="font-size:13px">粘贴取件码</a>
        </div>
        <div class="mt16">${`<button class="btn btn--primary btn--lg btn--block">打开文件${''}</button>`}</div>
        <div class="sec-note mt14">
          ${icon('shieldCheck', 15)}
          <span>取件码只在有效期内可用。<br>连续输错 5 次将锁定 10 分钟。</span>
        </div>
        <div class="center mt14">
          <a href="#" class="link" style="font-size:13px;color:var(--ink-3)">没有取件码？请发送者重新分享</a>
        </div>
      </div>
    </div>
  </div>`;
}

/* ---------- 03 访客分享页 ---------- */
function s03() {
  const files = [
    ['品牌手册_v4.pdf', 'pdf', 'PDF 文档', '42.4 MB'],
    ['设计交付_源文件.zip', 'zip', '压缩包', '186.2 MB'],
    ['首页动效.fig', 'fig', 'Figma 文件', '20.0 MB']
  ];
  return pubShell({
    header: `<header class="topbar topbar--flush" style="height:64px;flex:0 0 64px">
      <div class="topbar__in">
        <a href="index.html" class="brand-link" aria-label="返回首页">${brand()}</a>
        <div class="tb-right">
          <a href="retrieve.html" class="link" style="color:var(--ink-3);font-size:13.5px">取件码取文件</a>
          <a href="index.html" class="btn btn--ghost btn--sm" style="height:32px;padding:0 13px">${icon('send', 14)}我要发文件</a>
        </div>
      </div>
    </header>`,
    body: `<div class="pub-body">
      <div class="container sh">
        <div class="sh-main">
          <div class="sh-sender">
            ${avatar('李明', 'avatar--sm')}
            <span style="font-size:13px;color:var(--ink-2)"><b style="font-weight:600">李明</b> 分享了这些文件</span>
            <span style="color:var(--line-2)">·</span>
            <span style="font-size:13px;color:var(--ink-4)">2026-10-19 14:32</span>
            <span style="margin-left:auto">${tag('安全扫描通过', 'ok', true)}</span>
          </div>

          <div class="sh-hd">
            <h1>设计交付_2026Q3</h1>
            <p>3 个文件 · 248.6 MB · 10 月 26 日 18:00 到期</p>
          </div>

          <div class="sh-list">
            <div class="sh-list__hd"><span>文件清单</span><span>共 3 个，248.6 MB</span></div>
            ${files.map(([n, e, k, sz]) => `<div class="sh-row">
              ${ftype(e)}
              <div class="flex1" style="min-width:0">
                <div class="sh-row__n trunc">${n}</div>
                <div class="sh-row__m">${k} · ${sz}</div>
              </div>
              <button class="btn btn--sm btn--quiet">预览</button>
              <button class="btn btn--sm btn--ghost">${icon('download', 14)}下载</button>
            </div>`).join('')}
          </div>

          <div class="sh-ft">
            <span class="row g7" style="font-size:13px;color:var(--ink-4)">${icon('clock', 14)}剩余 6 天 3 小时，到期后自动删除</span>
            <div class="row g8">
              <button class="btn btn--ghost">保存到我的空间</button>
              <button class="btn btn--primary">${icon('download', 16)}下载全部</button>
            </div>
          </div>
        </div>

        <aside class="sh-side">
          <div class="sh-code">
            <div class="sh-code__k">取件码</div>
            <div class="row between" style="margin-top:9px;align-items:flex-start">
              <div>
                <div class="sh-code__v">483 917</div>
                <div class="sh-code__h">在 kunqiong.cn 首页输入<br>这 6 位数字即可取件</div>
              </div>
              <span class="qrbox" style="padding:6px">${qrSVG(76)}</span>
            </div>
          </div>

          <div class="sh-block">
            <div class="sh-block__t">这次传输是安全的</div>
            <div class="col g10">
              ${['传输全程 TLS 1.3 加密，落地存储加密',
                 '3 个文件已通过病毒扫描',
                 '到期后原件与副本一并删除'].map(t => `<div class="row g8" style="align-items:flex-start"><span style="color:var(--green);margin-top:1px">${icon('check', 13, 2)}</span><span style="font-size:13px;line-height:19px;color:var(--ink-3)">${t}</span></div>`).join('')}
            </div>
          </div>

          <div class="sh-block">
            <div class="between">
              <span class="sh-block__t" style="margin:0">剩余有效期</span>
              <span style="font-size:13px;color:var(--ink-2)">6 天 03 小时</span>
            </div>
            <div class="row g4" style="margin-top:9px">
              ${['on','on','on','on','on','on','off'].map(v => `<i style="flex:1;height:4px;border-radius:2px;background:${v === 'on' ? 'var(--blue)' : '#E4EDF9'}"></i>`).join('')}
            </div>
            <div class="between" style="margin-top:7px;font-size:13px;color:var(--ink-4)">
              <span>10 月 26 日 18:00 到期</span><span>有效期 7 天</span>
            </div>
          </div>

          <div class="sh-report">
            ${icon('alert', 13)}<span>不是你预期的文件？<a href="#" class="link">举报此分享</a></span>
          </div>
        </aside>
      </div>
    </div>`
  });
}

/* ---------- 04 分享密码验证 ---------- */
function s04() {
  return `<div class="pub">
  <div class="utility"><div class="in">
    <div class="row g20">
      <span class="row g7"><i class="dot"></i>传输服务正常</span>
      <span class="sep">/</span><span>TLS 1.3 全链路加密</span>
      <span class="sep">/</span><span>等保三级</span>
    </div>
    <div class="row g18">
      <span>CN · 简体中文</span><span class="sep">/</span><a href="#">帮助中心</a>
    </div>
  </div></div>
    <header class="topbar topbar--flush" style="height:68px;flex:0 0 68px">
      <div class="topbar__in">
        ${brand()}
        <div class="tb-right"><a href="#" class="link" style="color:var(--ink-3)">需要帮助</a></div>
      </div>
    </header>
    <div class="pub-body grid-tex" style="align-items:center;position:relative">
      <div style="position:relative;width:900px" class="pub-card">
        ${ticks()}
        <div class="row between" style="padding:12px 26px;border-bottom:1px solid var(--line)">
          <span class="eyebrow eyebrow--ink">Access control / 04</span>
          <span class="row g6" style="font-family:var(--mono);font-size:13px;letter-spacing:.05em;color:var(--ink-4)">${icon('lock', 13)}<span>需要授权</span></span>
        </div>
        <div style="display:flex">
          <div style="flex:1;min-width:0;padding:34px 40px 30px 32px">
            <div class="mono-label">受保护的分享链接</div>
            <h1 class="h2" style="margin-top:10px;font-size:25px;line-height:34px">这份文件需要一个密码</h1>
            <p class="sub" style="margin-top:8px;max-width:496px;line-height:23px">密码由发送者单独告知，不会随通知邮件一起发出。验证通过后可查看此链接中的 3 个文件。</p>

            <div class="codebox" style="margin-top:24px">
              <i class="dot"></i><i class="dot"></i><i class="dot"></i><i class="dot"></i><i class="caret"></i><i></i>
            </div>
            <div class="row g8" style="margin-top:11px;font-family:var(--mono);font-size:13px;color:var(--ink-4)">
              <span>已输入 4 / 6</span><span class="sep">·</span><a href="#" class="link" style="color:var(--blue-700)">粘贴密码</a>
            </div>

            <button class="btn btn--primary btn--block" style="margin-top:22px;height:48px;font-size:15px">验证并打开</button>

            <div class="row g10" style="margin-top:20px;padding-top:16px;border-top:1px solid var(--rule);align-items:flex-start;color:var(--ink-4)">
              ${icon('shieldCheck', 15)}
              <span style="font-size:13px;line-height:20px;color:var(--ink-3)">密码只在本地校验，服务端仅保存哈希值；验证通过后链接有效期不延长。</span>
            </div>
          </div>

          <div style="width:300px;flex:0 0 300px;border-left:1px solid var(--rule);background:#FBFDFF;padding:34px 26px 24px;display:flex;flex-direction:column">
            <div class="mono-label">链接信息</div>
            <div class="spec" style="margin-top:8px">
              <div class="spec__row"><span class="k">文件</span><span class="v">3 个 · 218 MB</span></div>
              <div class="spec__row"><span class="k">发件人</span><span class="v">李明</span></div>
              <div class="spec__row"><span class="k">发送</span><span class="v num">10-19 14:32</span></div>
              <div class="spec__row"><span class="k">到期</span><span class="v num" style="color:var(--notice)">10-26 18:00</span></div>
            </div>
            <div style="margin-top:auto;padding-top:14px;border-top:1px dashed #D3E1F4">
              ${barcode(184, 26)}
              <div class="mono" style="font-size:13px;letter-spacing:.16em;color:var(--ink-4);margin-top:8px">8F2C 2A91 4D07</div>
            </div>
          </div>
        </div>
        <div class="row g10" style="padding:11px 26px;border-top:1px solid var(--rule);background:#FBFDFF;font-family:var(--mono);font-size:13px;color:var(--ink-4)">
          <span>连错 5 次 · 锁定 10 分钟</span><span class="sep">/</span><span>到期后自动销毁，不可恢复</span>
          <a href="#" class="link" style="margin-left:auto;color:var(--ink-3)">返回首页</a>
        </div>
      </div>
    </div>
    <footer class="pub-foot"><span>鲲穹 · 企业文件传输</span><span>传输加密 · 到期销毁 · 服务条款</span></footer>
  </div>`;
}

/* ---------- 05 团队邀请落地页 ---------- */
function s05() {
  return `<div class="pub">
  <div class="utility"><div class="in">
    <div class="row g20">
      <span class="row g7"><i class="dot"></i>传输服务正常</span>
      <span class="sep">/</span><span>TLS 1.3 全链路加密</span>
      <span class="sep">/</span><span>等保三级</span>
    </div>
    <div class="row g18">
      <span>CN · 简体中文</span><span class="sep">/</span><a href="#">帮助中心</a>
    </div>
  </div></div>
    <header class="topbar topbar--flush" style="height:68px;flex:0 0 68px">
      <div class="topbar__in">
        ${brand()}
        <div class="tb-right">
          <span class="sub" style="font-size:13px">已经是成员？</span>
          <a href="#" class="link">登录</a>
        </div>
      </div>
    </header>
    <div class="pub-body grid-tex" style="align-items:center;position:relative">
      <div style="position:relative;width:860px" class="pub-card">
        ${ticks()}
        <div class="row between" style="padding:12px 26px;border-bottom:1px solid var(--line)">
          <span class="eyebrow eyebrow--ink">团队空间</span>
          <span class="mono" style="font-size:13px;letter-spacing:.05em;color:var(--ink-4)">INVITE NO. KQ7F-2A91</span>
        </div>
        <div style="display:flex">
          <div style="flex:1;min-width:0;padding:30px 34px 28px 26px">
            <div class="row g10">
              ${avatar('王清', 'avatar--sm')}
              <div>
                <div style="font-size:13px;font-weight:500">王清 邀请你加入团队空间</div>
                <div class="mono" style="font-size:13px;color:var(--ink-4);margin-top:1px">鲲穹设计中心 · 空间管理员</div>
              </div>
              <span style="margin-left:auto">${tag('团队版', 'navy')}</span>
            </div>

            <h1 class="h2" style="margin-top:20px;font-size:32px;line-height:42px;letter-spacing:-.032em">加入「鲲穹设计中心」</h1>
            <p class="lead" style="margin-top:9px;max-width:432px">加入后可以和 24 位成员共享文件夹、统一管理分享权限，团队的文件到期策略也会一并生效。</p>

            <div class="feat3" style="margin-top:22px">
              <div style="min-height:0;padding-right:16px"><div class="n">01</div><div class="t">500 GB 共享容量</div><div class="d">成员共享，合并计算</div></div>
              <div style="min-height:0;padding-right:16px"><div class="n">02</div><div class="t">24 位成员协作</div><div class="d">按角色分配权限</div></div>
              <div style="min-height:0;padding-right:0"><div class="n">03</div><div class="t">统一审计策略</div><div class="d">分享可追溯，离职回收</div></div>
            </div>

            <div class="row g12" style="margin-top:24px">
              <button class="btn btn--primary btn--lg" style="flex:1">登录并申请加入</button>
              <button class="btn btn--lg btn--edge">先看看里面有什么</button>
            </div>
            <p class="hint" style="margin-top:10px">加入需要管理员审批，登录后会自动提交申请，通常 1 个工作日内处理。</p>
          </div>

          <div style="width:300px;flex:0 0 300px;border-left:1px solid var(--rule);background:#FBFDFF;padding:26px 24px 20px;display:flex;flex-direction:column">
            <div class="mono-label">邀请凭证</div>
            <div class="mono" style="font-size:24px;line-height:30px;letter-spacing:.08em;font-weight:500;margin-top:8px">KQ7F 2A91</div>
            <div class="center" style="margin-top:14px;padding:9px;background:#fff;border:1px solid var(--rule-2);border-radius:6px;display:flex;justify-content:center">
              ${qrSVG(132)}
            </div>
            <div class="center mono" style="font-size:13px;color:var(--ink-4);margin-top:7px">扫码在手机上接受邀请</div>
            <div class="spec" style="margin-top:16px;border-top:1px solid var(--rule);padding-top:8px">
              <div class="spec__row"><span class="k">你的角色</span><span class="v">成员</span></div>
              <div class="spec__row"><span class="k">邀请人</span><span class="v">王清</span></div>
              <div class="spec__row"><span class="k">失效</span><span class="v num" style="color:var(--notice)">10-22 14:32</span></div>
            </div>
            <div style="margin-top:auto;padding-top:12px">${barcode(168, 24)}</div>
          </div>
        </div>
        <div class="row g10" style="padding:11px 26px;border-top:1px solid var(--rule);background:#FBFDFF;font-family:var(--mono);font-size:13px;color:var(--ink-4)">
          <span>邀请 3 天后失效</span><span class="sep">/</span><span>仅限收到链接的账号使用</span>
          <a href="#" class="link" style="margin-left:auto;color:var(--ink-3)">先了解团队版</a>
        </div>
      </div>
    </div>
    <footer class="pub-foot"><span>鲲穹 · 企业文件传输</span><span>传输加密 · 到期销毁 · 服务条款</span></footer>
  </div>`;
}

/* ---------- 06 登录后发文件页 ---------- */
function workbenchBody() {
  return `<div style="display:flex;gap:20px;flex:1;min-height:0">
      <div class="panel" style="flex:1;min-width:0;display:flex;flex-direction:column">
        <div class="panel-hd" style="height:46px;flex:0 0 46px">
          <span class="h4">新建传输</span>
          <span style="font-size:13px;color:var(--ink-4)">尚未选择文件</span>
        </div>

        <div style="display:flex;flex:1;min-height:0">
          <div style="flex:1;min-width:0;padding:16px;display:flex;flex-direction:column">
            <div class="wb-drop">
              <span class="dz__ic">${icon('upload', 24, 1.5)}</span>
              <div class="dz__t">把文件拖到这里</div>
              <div class="dz__s">也可以从本机选择，支持文件夹与断点续传</div>
              <div class="row g10" style="margin-top:18px">
                <button class="btn btn--primary btn--pk">选择文件</button>
                <button class="btn btn--ghost btn--pk">选择文件夹</button>
              </div>
            </div>

            <div class="between" style="margin-top:20px;padding-bottom:9px;border-bottom:1px solid var(--line)">
              <span style="font-size:13px;font-weight:600;color:var(--ink-2)">待发送文件</span>
              <span style="font-size:13px;color:var(--ink-4)">0 个 · 0 B</span>
            </div>
            <div class="wb-empty">选择文件后会出现在这里，发送前可随时移除</div>

            <div class="wb-facts">
              ${[['单文件上限', '10 GB', '会员版'], ['并发分片', '8 路', '自动'], ['断点保留', '7 天', '可续传']].map(([k, v, s]) => `
                <div class="wb-fact"><span class="k">${k}</span><span class="v">${v}</span><span class="s">${s}</span></div>`).join('')}
            </div>
          </div>

          <aside style="width:256px;flex:0 0 256px;border-left:1px solid var(--line);padding:16px 18px 18px;display:flex;flex-direction:column">
            <div class="between">
              <span class="mono-label">传输设置</span>
              <a href="#" class="link" style="font-size:13px">全部</a>
            </div>
            <div class="ledger mt8">
              ${[['有效期', '7 天'], ['提取密码', '已开启'], ['下载次数', '不限'], ['在线预览', '允许'], ['到期后删除原件', '开启'], ['下载通知', '仅站内']].map(([k, v]) => `
                <div class="ledger__row" style="padding:11px 0">
                  <span class="k">${k}</span>
                  <span class="row g6"><span class="v" style="font-size:13px">${v}</span><span style="color:#B3C5DA">${icon('chevronRight', 12)}</span></span>
                </div>`).join('')}
            </div>
            <div style="margin-top:10px;font-size:13px">
              <a href="#" class="link" style="color:var(--ink-3)">保存为默认设置</a>
            </div>
            <div class="sec-note" style="margin-top:12px;padding:10px 11px">
              ${icon('shieldCheck', 14)}
              <span>上传完成后自动进行病毒扫描，未通过的文件不会进入分享。</span>
            </div>
            <div style="margin-top:auto;padding-top:14px;border-top:1px solid var(--line)">
              <div class="between"><span class="mono-label" style="font-size:13px">当前容量</span><span class="mono" style="font-size:13px;color:var(--ink)">12.4 / 50 GB</span></div>
              <div class="bar mt8"><i style="width:24.8%"></i></div>
              <div class="row between mt6"><span class="sub" style="font-size:13px">剩余 37.6 GB</span><a href="plan.html" class="link" style="font-size:13px">扩容</a></div>
            </div>
          </aside>
        </div>
      </div>

      <div class="panel" style="width:392px;display:flex;flex-direction:column">
        <div class="panel-hd"><span class="h4">近期传输</span><a href="records.html" class="link" style="font-size:13px">全部记录</a></div>
        <div style="padding:4px 16px 0;flex:1;display:flex;flex-direction:column">
          ${[
            ['品牌手册_v4.pdf', 'pdf', '已取件 · 2 小时前', tag('已完成', 'ok', true)],
            ['设计交付_源文件.zip', 'zip', '等待取件 · 今天 09:12', tag('待取件', 'wait', true)],
            ['项目排期.xlsx', 'xls', '已过期 · 昨天 18:40', tag('已过期', 'mute', true)],
            ['宣传片_1080p.mp4', 'vid', '已取件 · 10 月 17 日', tag('已完成', 'ok', true)],
            ['字体授权说明.docx', 'doc', '等待取件 · 10 月 18 日', tag('待取件', 'wait', true)],
            ['合同扫描件_盖章版.pdf', 'pdf', '已关闭 · 10 月 15 日', tag('已关闭', 'mute', true)],
            ['首页动效_导出.mp4', 'vid', '已取件 · 10 月 14 日', tag('已完成', 'ok', true)],
            ['团队周报_2026W41.pdf', 'pdf', '等待取件 · 10 月 13 日', tag('待取件', 'wait', true)],
            ['报价单_终版.xlsx', 'xls', '已取件 · 10 月 11 日', tag('已完成', 'ok', true)],
            ['旧版LOGO.rar', 'zip', '已过期 · 10 月 09 日', tag('已过期', 'mute', true)]
          ].map(([n, e, m, t]) => `
            <div class="filerow" style="padding:0;flex:1">
              ${ftype(e)}
              <div class="flex1" style="min-width:0"><div class="nm trunc">${n}</div><div class="mt">${m}</div></div>
              ${t}
            </div>`).join('')}
        </div>
        <div style="padding:12px 16px 14px;border-top:1px solid var(--line)" class="row between">
          <span class="mono" style="font-size:13px;color:var(--ink-4)">本月 38 个文件 · 1.2 TB</span>
          <a href="records.html" class="link" style="font-size:13px">查看统计</a>
        </div>
      </div>
    </div>`;
}

const SEND_HEAD = {
  active: '发文件',
  title: '下午好，李明',
  sub: '把文件拖进来，两步就能交到对方手上。',
  actions: `<button class="btn btn--ghost btn--sm" style="height:32px">${icon('inbox', 14)}输入取件码</button>`
};

function s06() {
  return `<div class="frame">${appShell({ ...SEND_HEAD, body: workbenchBody() })}</div>`;
}

/* ---------- 07 分享设置弹窗 ---------- */
function s07() {
  return `<div class="frame">
    ${appShell({ ...SEND_HEAD, body: workbenchBody() })}
    <div class="scrim"></div>
    <div class="modal modal--lg modal--accent" style="top:50%">
      <div class="modal-hd">
        <div>
          <div class="eyebrow" style="margin-bottom:7px">Share settings</div>
          <h2 class="h2" style="font-size:21px">分享设置</h2>
          <p class="sub" style="margin-top:4px">3 个文件 · 248.6 MB · 应用后立即生效</p>
        </div>
        <button class="modal-x" aria-label="关闭">${icon('x', 16)}</button>
      </div>
      <div class="modal-bd" style="padding-top:14px">
        <div class="mono-label">有效期</div>
        <div class="row g8 mt8" style="display:grid;grid-template-columns:repeat(4,1fr)">
          ${[['1 天', ''], ['7 天', 'on'], ['30 天', ''], ['永久', '']].map(([t, on]) => `
            <div class="opt-row ${on}" style="justify-content:center;font-size:13px">${t}${on ? `<span style="color:var(--blue)">${icon('check', 13, 2.2)}</span>` : ''}</div>`).join('')}
        </div>

        <div class="divider mt20 mb16"></div>

        <div class="between">
          <div class="mono-label">下载次数</div>
          <div class="row g16">
            <span class="radio-row"><span class="radio on"></span>限制次数</span>
            <span class="radio-row" style="color:var(--ink-4)"><span class="radio"></span>不限</span>
          </div>
        </div>
        <div class="row g8 mt10">
          <div class="input input--sm" style="width:76px;justify-content:center;height:34px">3</div>
          <span class="sub">次下载后自动失效</span>
        </div>

        <div class="divider mt20 mb4"></div>

        <div class="switch-row">
          <div><div class="t">提取密码</div><div class="d">取件时需要额外输入 6 位密码</div></div>
          <div class="sw on"><i></i></div>
        </div>
        <div class="row g8" style="padding:0 0 12px">
          <span class="mono" style="font-size:14px;letter-spacing:.14em;color:var(--ink)">483 917</span>
          <a href="#" class="link" style="font-size:13px">重新生成</a>
        </div>

        <div class="divider mb4"></div>

        <div class="switch-row" style="padding-bottom:0">
          <div><div class="t">允许在线预览</div><div class="d">对方可在浏览器中查看图片、PDF 与 Office 文档，无需下载</div></div>
          <div class="sw on"><i></i></div>
        </div>
      </div>
      <div class="modal-ft">
        <span class="mono" style="font-size:13px;color:var(--ink-4);margin-right:auto">7 天 · 限 3 次 · 需密码</span>
        <button class="btn btn--ghost">取消</button>
        <button class="btn btn--primary">保存设置</button>
      </div>
    </div>
  </div>`;
}

/* ---------- 08 上传队列页 ---------- */
const QUEUE = [
  ['品牌手册_v4.pdf', 'pdf', '42.4 MB'],
  ['合同扫描件_盖章版.pdf', 'pdf', '8.2 MB'],
  ['首页动效.fig', 'fig', '96.1 MB'],
  ['项目排期.xlsx', 'xls', '1.8 MB'],
  ['宣传片_1080p.mp4', 'vid', '420.0 MB'],
  ['字体授权说明.docx', 'doc', '640 KB']
];

function s08() {
  return `<div class="frame">${appShell({
    active: '发文件',
    title: '待上传文件',
    sub: '确认清单后开始上传，上传过程中可以继续添加。',
    actions: `<button class="btn btn--quiet">清空列表</button><button class="btn btn--primary">${icon('upload', 15)}开始上传</button>`,
    body: `<div class="panel" style="flex:1;display:flex;flex-direction:column;min-height:0">
      <div class="row" style="height:38px;padding:0 20px;border-bottom:1px solid var(--ink-0);background:#fff;font-family:var(--mono);font-size:13px;color:#6F849F;letter-spacing:.04em">
        <span style="width:22px" class="row"><span class="check indet"></span></span>
        <span style="flex:1;padding-left:12px">文件名</span>
        <span style="width:120px">大小</span>
        <span style="width:120px">状态</span>
        <span style="width:60px"></span>
      </div>
      <div style="padding:0 20px;flex:1;display:flex;flex-direction:column;min-height:0">
        ${QUEUE.map(([n, e, s], i) => `
        <div class="row" style="flex:1;min-height:64px;border-bottom:1px solid var(--line)">
          <span style="width:22px" class="row">${i < 2 ? '<span class="check on"></span>' : '<span class="check"></span>'}</span>
          <div style="flex:1;display:flex;align-items:center;gap:12px;padding-left:12px;min-width:0">
            ${ftype(e)}<div><div class="nm trunc" style="font-size:13px;font-weight:500">${n}</div><div class="mt" style="font-size:13px;color:var(--ink-4)">${e === 'vid' ? '视频 · 已自动压缩预览' : '添加于 14:32'}</div></div>
          </div>
          <span style="width:120px" class="num sub">${s}</span>
          <span style="width:120px">${tag('等待上传', 'mute')}</span>
          <span style="width:60px" class="right"><button class="iconbtn" style="width:28px;height:28px" aria-label="移除">${icon('trash', 15)}</button></span>
        </div>`).join('')}
      </div>
      <div style="padding:12px 20px 14px">
        <div style="width:100%;border:1px dashed #C9D9EE;border-radius:6px;height:62px;display:flex;align-items:center;justify-content:center;gap:8px;color:var(--ink-4);font-size:13px;background:#FBFDFF">
          ${icon('plus', 15)}<span>继续拖入文件，或 <span class="blue">选择文件</span></span>
        </div>
      </div>
      <div class="row between" style="padding:14px 20px;border-top:1px solid var(--line);background:#FCFDFF">
        <div class="row g16">
          <span style="font-size:13px;color:var(--ink-2)">已选 2 个 · <b class="num">50.6 MB</b></span>
          <span class="sub" style="font-size:13px">总量 568.5 MB / 单文件上限 10 GB</span>
        </div>
        <div class="row g10">
          <span class="sub" style="font-size:13px">保存时效</span>
          ${selectBox('7 天', 108)}
        </div>
      </div>
    </div>`
  })}</div>`;
}

/* ---------- 09 上传进度与安全扫描 ---------- */
function s09() {
  const rows = [
    { n: '品牌手册_v4.pdf', e: 'pdf', s: '42.4 MB', p: 62, st: '上传中', meta: '8.4 MB/s · 剩余 12 秒', kind: 'live' },
    { n: '首页动效.fig', e: 'fig', s: '96.1 MB', p: 100, st: '安全检查中', meta: '已扫描 68%，预计 8 秒', kind: 'scan' },
    { n: '合同扫描件_盖章版.pdf', e: 'pdf', s: '8.2 MB', p: 100, st: '已完成', meta: '扫描通过 · 14:33', kind: 'ok' },
    { n: '项目排期.xlsx', e: 'xls', s: '1.8 MB', p: 100, st: '已完成', meta: '扫描通过 · 14:33', kind: 'ok' },
    { n: '宣传片_1080p.mp4', e: 'vid', s: '420 MB', p: 24, st: '上传中', meta: '3.1 MB/s · 剩余 2 分 10 秒', kind: 'live' },
    { n: '字体授权说明.docx', e: 'doc', s: '640 KB', p: 18, st: '上传失败', meta: '网络中断，已自动重试 2 次', kind: 'bad' }
  ];
  const statusTag = (r) => {
    if (r.kind === 'scan') return `<span class="tag tag--live">${icon('shield', 12)}安全检查中</span>`;
    if (r.kind === 'ok') return tag('已完成', 'ok', true);
    if (r.kind === 'bad') return tag('上传失败', 'bad', true);
    return `<span class="tag">上传中</span>`;
  };
  return `<div class="frame">${appShell({
    active: '发文件',
    title: '正在上传 6 个文件',
    sub: '上传完成后会自动进行安全扫描，扫描通过才会生成取件码。',
    actions: `<button class="btn btn--ghost">${icon('refresh', 14)}全部重试</button><button class="btn btn--quiet">取消上传</button>`,
    body: `<div class="panel" style="padding:18px 20px;display:flex;align-items:center;gap:28px">
        <div style="width:180px">
          <div class="row g8" style="align-items:baseline"><span style="font-size:28px;font-weight:600;letter-spacing:-.02em" class="num">68</span><span class="sub">%</span></div>
          <div class="sub" style="font-size:13px;margin-top:2px">总进度 · 3.4 GB / 5.0 GB</div>
        </div>
        <div style="flex:1">
          <div class="bar bar--lg"><i style="width:68%"></i></div>
          <div class="row g20 mt10" style="font-size:13px;color:var(--ink-4)">
            <span class="row g6"><i class="dot" style="color:var(--blue)"></i>进行中 3</span>
            <span class="row g6"><i class="dot" style="color:var(--green)"></i>已完成 2</span>
            <span class="row g6"><i class="dot" style="color:var(--red)"></i>失败 1</span>
            <span style="margin-left:auto">整体预计剩余 2 分 24 秒</span>
          </div>
        </div>
      </div>
      <div class="panel" style="flex:1;display:flex;flex-direction:column;min-height:0">
        <div class="panel-hd"><span class="h4">文件列表</span><span class="sub" style="font-size:13px">上传与扫描互不阻塞</span></div>
        <div style="flex:1;padding:0 20px;display:flex;flex-direction:column">
          ${rows.map(r => `
          <div class="row" style="flex:1;min-height:76px;border-bottom:1px solid var(--line)">
            ${ftype(r.e)}
            <div style="flex:1;padding-left:12px;min-width:0">
              <div class="row g8"><span class="nm trunc" style="font-size:13px;font-weight:500">${r.n}</span>
                ${r.kind === 'scan' ? `<span class="scanring" style="width:6px;height:6px;background:var(--cyan)"></span>` : ''}
              </div>
              <div class="row g10 mt6">
                <div class="bar ${r.kind === 'ok' ? 'bar--ok' : r.kind === 'bad' ? 'bar--bad' : r.kind === 'scan' ? 'bar--live' : ''}" style="width:320px">
                  <i style="width:${r.p}%${r.kind === 'scan' ? ';background:linear-gradient(90deg,#1677FF,#0FBED2)' : ''}"></i>
                </div>
                <span class="sub num" style="font-size:13px">${r.meta}</span>
              </div>
            </div>
            <span style="width:132px">${statusTag(r)}</span>
            <span style="width:88px" class="right">${r.kind === 'bad'
              ? `<button class="btn btn--sm btn--ghost">重试</button>`
              : `<span class="num sub" style="font-size:13px">${r.s}</span>`}</span>
          </div>`).join('')}
        </div>
        <div class="row between" style="padding:12px 20px;border-top:1px solid var(--line);background:#FCFDFF">
          <span class="row g8 sub" style="font-size:13px">${icon('shieldCheck', 14)}<span>检测到 0 个风险文件，扫描结果会记录在分享详情中</span></span>
          <a href="#" class="link" style="font-size:13px">查看扫描规则</a>
        </div>
      </div>`
  })}</div>`;
}

/* ---------- 10 分享结果页 ---------- */
function resultBody() {
  return `<div style="flex:1;display:flex;flex-direction:column;min-height:0">
  <div style="display:flex;gap:30px;padding-top:22px;justify-content:center;min-height:0;flex:1">
    <div style="width:712px;flex:0 0 712px">
      <div class="between" style="align-items:flex-end;padding-bottom:13px;border-bottom:1px solid var(--line)">
        <div>
          <h1 class="h1" style="margin-top:2px;font-size:25px;line-height:33px">文件已发出</h1>
        </div>
        <div class="right">
          <div class="mono" style="font-size:13px;color:var(--ink-4)">2026-10-19 · 14:32:08 CST</div>
          <div class="row g6" style="justify-content:flex-end;margin-top:5px;color:var(--green);font-size:13px">${icon('shieldCheck', 14)}<span>扫描通过 · 3/3</span></div>
        </div>
      </div>

      <div class="sheet" style="margin-top:24px">
        ${ticks()}
        <div class="receipt__hd" style="padding-top:15px">
          <div class="between">
            <span class="mono-label">取件凭证</span>
            
          </div>
          <div class="row between" style="margin-top:16px;align-items:flex-start">
            <div>
              <div class="mono-label">取件码</div>
              <div class="receipt__code" style="margin-top:10px">483 917</div>
              <div class="sub" style="margin-top:10px">对方在 kunqiong.cn 首页输入这 6 位数字即可取件</div>
            </div>
            <div style="flex:0 0 auto">
              <span class="qrbox" style="padding:6px;border-radius:4px;border-color:#D6E3F4">${qrSVG(94)}</span>
            </div>
          </div>
        </div>
        <div class="receipt__grid">
          <div class="receipt__cell"><div class="k">文件</div><div class="v">3 个 · 248.6 MB</div></div>
          <div class="receipt__cell"><div class="k">到期</div><div class="v">10 月 26 日 18:00</div></div>
          <div class="receipt__cell"><div class="k">取件限制</div><div class="v">6 位码 · 无密码</div></div>
          <div class="receipt__cell"><div class="k">状态</div><div class="v row g6" style="color:var(--amber)"><i class="dot" style="background:var(--amber)"></i>等待取件</div></div>
        </div>
        <div class="receipt__ft">
          <div>
            <div class="mono-label" style="font-size:13px">分享链接</div>
            <div class="mono" style="font-size:13px;color:var(--ink-2);margin-top:4px">kunqiong.cn/s/7Kd2mQ</div>
          </div>
          <button class="btn btn--sm btn--edge">${icon('copy', 12)}复制</button>
        </div>
      </div>

      <div class="row between" style="margin-top:22px">
        <div class="row g10">
          <button class="btn btn--primary btn--pk" style="height:40px">${icon('link', 15)}复制链接</button>
          <button class="btn btn--ghost" style="height:40px">${icon('copy', 15)}复制取件码</button>
          <button class="btn btn--ghost" style="height:40px">${icon('qr', 15)}查看二维码</button>
        </div>
        <a href="#" class="link" style="font-size:13px">修改分享设置</a>
      </div>

      <div style="margin-top:26px;border-top:1px solid var(--ink-0);display:grid;grid-template-columns:repeat(3,1fr)">
        ${[
          ['复制链接', '发给同事，点开即可下载', '复制链接'],
          ['口述取件码', '念 6 位数字，不用发链接', '复制取件码'],
          ['出示二维码', '适合当面交付或会议投屏', '查看二维码']
        ].map(([t, d, a], i) => `<div style="padding:13px 20px 0 ${i ? '20px' : '0'};border-right:${i < 2 ? '1px solid var(--rule)' : '0'}">
          <div style="font-size:13.5px;font-weight:600">${t}</div>
          <div style="font-size:13px;color:var(--ink-4);margin-top:3px;line-height:19px">${d}</div>
          <a href="#" class="link" style="font-size:13px;display:inline-block;margin-top:8px">${a}</a>
        </div>`).join('')}
      </div>
    </div>

    <div style="width:368px;flex:0 0 368px;display:flex;flex-direction:column;gap:16px;padding-top:4px">
      <div class="panel" style="display:flex;flex-direction:column">
        <div class="panel-hd"><span class="h4">本次传输</span><span class="mono" style="font-size:13px;color:var(--ink-4)">3 个文件</span></div>
        <div style="padding:4px 16px 0">
          ${[
            ['品牌手册_v4.pdf', 'pdf', '42.4 MB'],
            ['设计交付_源文件.zip', 'zip', '186.2 MB'],
            ['首页动效.fig', 'fig', '20.0 MB']
          ].map(([n, e, s], i) => `<div class="manifest__row">
            <span class="manifest__no">0${i + 1}</span>
            ${ftype(e)}
            <div class="flex1" style="min-width:0"><div class="manifest__name trunc">${n}</div></div>
            <span class="manifest__size">${s}</span>
          </div>`).join('')}
        </div>
        <div class="panel-ft" style="padding:10px 16px"><span class="mono-label" style="font-size:13px">合计</span><span class="mono" style="font-size:13px;color:var(--ink)">248.6 MB</span></div>
      </div>

      <div class="panel">
        <div class="panel-hd"><span class="h4">接下来</span></div>
        <div style="padding:4px 18px 8px">
          ${[
            ['01', '对方输入取件码', '在任意设备打开首页即可'],
            ['02', '通过病毒扫描', '下载前再校验一次文件指纹'],
            ['03', '到期自动销毁', '原件与副本一并删除，不留备份']
          ].map(([, t, d], i, a) => `<div style="padding:11px 0;${i < a.length - 1 ? 'border-bottom:1px solid var(--rule)' : ''}">
            <div style="font-size:13px;font-weight:500;color:var(--ink)">${t}</div>
            <div class="sub" style="margin-top:3px">${d}</div>
          </div>`).join('')}
        </div>
      </div>

      <div class="panel">
        <div class="panel-hd"><span class="h4">安全凭证</span></div>
        <div style="padding:4px 18px 6px">
          ${[
            ['传输加密', 'TLS 1.3'],
            ['文件指纹', 'SHA-256'],
            ['病毒扫描', '3 / 3 通过'],
            ['销毁方式', '到期自动删除']
          ].map(([k, v]) => `<div class="ledger__row" style="padding:8px 0"><span class="k">${k}</span><span class="v mono" style="font-size:13px">${v}</span></div>`).join('')}
        </div>
      </div>

      <p class="hint" style="margin-top:auto">关闭分享会立即失效，已下载的文件不受影响；可以随时在「分享管理」重新开启。</p>
    </div>
  </div>

  <div class="row between" style="margin-top:auto;padding-top:12px;border-top:1px solid var(--ink-0);font-family:var(--mono);font-size:13px;color:var(--ink-4);letter-spacing:.02em">
    <span>传输编号 2026-1019-4837 · SHA-256 7C4A…9E21</span>
    <span class="row g14"><span>本次操作已记入审计日志</span><a href="#" class="link" style="font-size:13px">查看</a></span>
  </div>
</div>`;
}

function s10() {
  return `<div class="frame">${appShell({
    active: '发文件',
    title: '',
    body: resultBody()
  })}</div>`;
}

/* ---------- 11 二维码预览弹窗 ---------- */
function s11() {
  return `<div class="frame">
    ${appShell({ active: '发文件', title: '', body: resultBody() })}
    <div class="scrim"></div>
    <div class="modal" style="width:404px;top:50%">
      <div class="modal-hd" style="padding-bottom:0">
        <span class="h4" style="font-size:14px">二维码</span>
        <button class="modal-x" aria-label="关闭">${icon('x', 16)}</button>
      </div>
      <div class="modal-bd center" style="padding-bottom:24px">
        <div class="qrbox" style="padding:14px;border-color:#DCE9FA">${qrSVG(216)}</div>
        <div class="mt16" style="font-size:14px;font-weight:600">设计交付_2026Q3</div>
        <div class="mono sub mt4" style="font-size:13px">kunqiong.cn/s/7Kd2mQ</div>
        <div class="row g10 mt20">
          <button class="btn btn--ghost btn--block">${icon('copy', 14)}复制链接</button>
          <button class="btn btn--primary btn--block">${icon('download', 14)}保存二维码</button>
        </div>
        <p class="hint mt10">用手机相机扫码即可打开取件页</p>
      </div>
    </div>
  </div>`;
}


/* ===== 16 收发记录 / 17 文件管理 / 24 分享管理 ===== */

const RECORDS = [
  ['品牌手册_v4.pdf', 'pdf', '483 917', ['已完成', 'ok'], '10-26 18:00', '42.4 MB'],
  ['设计交付_源文件.zip', 'zip', '—', ['待取件', 'wait'], '10-22 12:00', '186.2 MB'],
  ['项目排期.xlsx', 'xls', '294 105', ['已过期', 'mute'], '10-15 09:00', '1.8 MB'],
  ['宣传片_1080p.mp4', 'vid', '771 046', ['已完成', 'ok'], '11-02 20:00', '420.0 MB'],
  ['合同扫描件_盖章版.pdf', 'pdf', '520 883', ['已关闭', 'mute'], '—', '8.2 MB'],
  ['字体授权说明.docx', 'doc', '—', ['待取件', 'wait'], '10-21 10:00', '640 KB'],
  ['首页动效.fig', 'fig', '638 214', ['已完成', 'ok'], '10-30 16:00', '96.1 MB'],
  ['品牌指南_打印版.pdf', 'pdf', '812 466', ['已完成', 'ok'], '10-24 09:00', '24.8 MB'],
  ['报价单_终版.xlsx', 'xls', '907 233', ['待取件', 'wait'], '11-05 10:00', '1.2 MB'],
  ['旧版LOGO.rar', 'zip', '—', ['已过期', 'mute'], '10-09 12:00', '64.2 MB']
];

function s16() {
  return `<div class="frame">${appShell({
    active: '收发记录',
    title: '收发记录',
    sub: '这里保留下所有发送、接收与收集任务的记录。',
    actions: `<button class="btn btn--ghost btn--sm" style="height:32px">${icon('download', 14)}导出 CSV</button>`,
    body: `<div class="tabs">
        <a href="#" class="on">全部 <span class="count">48</span></a>
        <a href="#">我发送的 <span class="count">32</span></a>
        <a href="#">我收到的 <span class="count">11</span></a>
        <a href="#">收集任务 <span class="count">5</span></a>
      </div>

      <div class="row between" style="margin-top:-4px">
        <div class="row g8">
          ${searchBox('搜索文件名或取件码', 280)}
          ${selectBox('全部状态', 120)}
          ${selectBox('近 30 天', 120)}
        </div>
        <div class="row g8">
          <button class="iconbtn" aria-label="刷新" style="border-color:var(--line-2);width:32px;height:32px">${icon('refresh', 15)}</button>
          <span class="sub" style="font-size:13px">最后更新 14:36</span>
        </div>
      </div>

      <div class="panel" style="flex:1;display:flex;flex-direction:column;min-height:0">
        <table class="table">
          <thead><tr>
            <th style="width:52px">No.</th><th style="width:286px">文件名</th><th style="width:126px">取件码</th><th style="width:118px">状态</th>
            <th style="width:160px">有效期</th><th style="width:96px" class="r">大小</th><th style="width:144px" class="r">操作</th>
          </tr></thead>
          <tbody>
          ${RECORDS.map(([n, e, code, st, exp, size], i) => `<tr>
            <td class="idx">${String(i + 1).padStart(2, '0')}</td>
            <td><div class="table__name">${ftype(e)}<span class="trunc" style="font-weight:500;color:var(--ink)">${n}</span></div></td>
            <td><span class="${code === '—' ? 'dim' : 'mono'}" style="font-size:13px;letter-spacing:.06em">${code}</span></td>
            <td>${tag(st[0], st[1], true)}</td>
            <td class="num" style="color:var(--ink-3);font-size:13px">${exp}</td>
            <td class="r num" style="font-size:13px">${size}</td>
            <td class="r"><a href="#" class="link" style="font-size:13px">复制链接</a>
              <span style="color:var(--line-2);margin:0 8px">|</span>
              <a href="#" class="link" style="font-size:13px;color:var(--ink-3)">更多</a></td>
          </tr>`).join('')}
          </tbody>
        </table>
        ${pagerBottom(48)}
      </div>`
  })}</div>`;
}

const FILES = [
  ['品牌手册_v4.pdf', 'pdf', '设计资料', '42.4 MB', '10-19 14:32', '10-26 18:00'],
  ['设计交付_源文件.zip', 'zip', '设计资料', '186.2 MB', '10-19 14:32', '10-22 12:00'],
  ['首页动效.fig', 'fig', '设计资料', '96.1 MB', '10-18 09:20', '10-30 16:00'],
  ['项目排期.xlsx', 'xls', '项目管理', '1.8 MB', '10-16 11:05', '11-15 09:00'],
  ['宣传片_1080p.mp4', 'vid', '市场素材', '420.0 MB', '10-14 16:40', '11-02 20:00'],
  ['合同扫描件_盖章版.pdf', 'pdf', '合同', '8.2 MB', '10-12 10:12', '10-20 10:00'],
  ['字体授权说明.docx', 'doc', '设计资料', '640 KB', '10-10 17:30', '10-25 10:00'],
  ['品牌指南_打印版.pdf', 'pdf', '市场素材', '24.8 MB', '10-08 15:20', '10-24 09:00']
];

function s17() {
  return `<div class="frame">${appShell({
    active: '',
    title: '文件管理',
    sub: '所有上传过的文件都在这里，可批量清理或延长保存时间。',
    actions: `<button class="btn btn--ghost btn--sm" style="height:32px">${icon('folder', 14)}新建文件夹</button><button class="btn btn--primary btn--sm" style="height:32px">${icon('upload', 14)}上传文件</button>`,
    body: `<div class="kpis" style="grid-template-columns:repeat(4,1fr);border-top:1px solid var(--ink-0)">
        <div class="kpi">
          <div class="k"><span>管理项目</span><a href="#" class="link" style="font-size:13px;letter-spacing:0;text-transform:none">查看</a></div>
          <div class="v">12<small>个</small></div>
          <div class="d">含 4 个收集任务 · 3 个已归档</div>
        </div>
        <div class="kpi">
          <div class="k"><span>文件总数</span></div>
          <div class="v">348<small>个</small></div>
          <div class="d">本周新增 26 个</div>
        </div>
        <div class="kpi">
          <div class="k"><span>占用空间</span><span style="color:var(--ink-3);letter-spacing:0">85%</span></div>
          <div class="v">42.6<small>GB / 50 GB</small></div>
          <div class="kpi__bar"><i style="width:85%"></i></div>
        </div>
        <div class="kpi" style="border-right:0">
          <div class="k"><span>7 天内过期</span><span class="mono" style="letter-spacing:0;color:var(--notice)">注意</span></div>
          <div class="v" style="color:var(--notice)">6<small>个</small></div>
          <div class="d">建议延长保存时间</div>
        </div>
      </div>

      <div class="panel" style="flex:1;display:flex;flex-direction:column;min-height:0">
        <div class="toolbar" style="padding:11px 16px">
          <div class="row g8">
            ${searchBox('搜索文件名', 240)}
            ${selectBox('全部分类', 120)}
            ${selectBox('有效期', 110)}
          </div>
          <div class="row g8">
            <span class="tag tag--mute tag--mono" style="height:26px">已选 3 个</span>
            <button class="btn btn--sm btn--ghost">${icon('download', 13)}批量下载</button>
            <button class="btn btn--sm btn--danger">${icon('trash', 13)}批量删除</button>
          </div>
        </div>
        <table class="table">
          <thead><tr>
            <th style="width:44px"><span class="check indet"></span></th>
            <th style="width:300px">文件名</th><th style="width:130px">分类</th>
            <th style="width:100px" class="r">大小</th><th style="width:150px">上传时间</th>
            <th style="width:170px">有效期</th><th style="width:120px" class="r">操作</th>
          </tr></thead>
          <tbody>
          ${FILES.map(([n, e, c, s, t, exp], i) => `<tr>
            <td><span class="check ${i < 3 ? 'on' : ''}"></span></td>
            <td><div class="table__name">${ftype(e)}<span class="trunc" style="font-weight:500;color:var(--ink)">${n}</span></div></td>
            <td><span class="tag tag--mute">${c}</span></td>
            <td class="r num" style="font-size:13px">${s}</td>
            <td class="num" style="font-size:13px;color:var(--ink-3)">${t}</td>
            <td class="num" style="font-size:13px;${i === 5 ? 'color:var(--notice)' : 'color:var(--ink-3)'}">${exp}${i === 5 ? '<span class="tag tag--wait" style="margin-left:6px;height:18px">2 天</span>' : ''}</td>
            <td class="r"><a href="#" class="link" style="font-size:13px">预览</a><span style="color:var(--line-2);margin:0 8px">|</span><span style="color:var(--ink-3);font-size:13px">更多</span></td>
          </tr>`).join('')}
          </tbody>
        </table>
        <div style="margin-top:auto">${pager(348)}</div>
      </div>`
  })}</div>`;
}

function s24() {
  return `<div class="frame">${appShell({
    active: '收发记录',
    title: '设计交付_2026Q3',
    sub: '链接分享 · 创建于 10 月 19 日 14:32',
    actions: `<button class="btn btn--ghost btn--sm" style="height:32px">${icon('edit', 14)}编辑分享</button>
      <button class="btn btn--ghost btn--sm" style="height:32px;color:var(--red);border-color:#EFD2CE">关闭分享</button>
      <button class="btn btn--primary btn--sm" style="height:32px">${icon('download', 14)}下载全部</button>`,
    body: `<div style="display:flex;gap:18px;flex:1;min-height:0">
      <div class="panel" style="flex:1;display:flex;flex-direction:column;min-height:0">
        <div class="panel-hd">
          <div class="row g10"><span class="h4">文件清单</span><span class="tag tag--ok" style="height:20px"><i class="dot"></i>进行中</span></div>
          <span class="mono" style="font-size:13px;color:var(--ink-4)">3 个文件 · 248.6 MB</span>
        </div>
        <div class="manifest" style="padding:0 20px">
          ${[
            ['品牌手册_v4.pdf', 'pdf', 'PDF 文档 · 42.4 MB · 下载 5 次'],
            ['设计交付_源文件.zip', 'zip', '压缩包 · 186.2 MB · 下载 3 次'],
            ['首页动效.fig', 'fig', 'Figma 文件 · 20.0 MB · 未被下载']
          ].map(([n, e, m], i) => `<div class="manifest__row">
            <span class="manifest__no">${String(i + 1).padStart(2, '0')}</span>
            ${ftype(e, true)}
            <div class="flex1" style="min-width:0"><div class="manifest__name">${n}</div><div class="manifest__meta">${m}</div></div>
            <button class="btn btn--sm btn--quiet">预览</button>
            <button class="btn btn--sm btn--ghost">${icon('download', 13)}下载</button>
          </div>`).join('')}
        </div>

        <div class="row between" style="padding:10px 20px;border-top:1px solid var(--ink-0);border-bottom:1px solid var(--rule);margin-top:4px">
          <div class="row g10"><span style="font-size:13px;font-weight:600">访问明细</span><span class="mono" style="font-size:13px;color:var(--ink-4)">最近 5 条 / 共 12 条</span></div>
          <a href="#" class="link" style="font-size:13px">全部记录</a>
        </div>
        <div style="flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column">
          <table class="table table--dense" style="font-size:13px;height:100%">
            <thead><tr>
              <th style="width:112px">时间</th><th>访问者</th><th style="width:118px">地区</th>
              <th style="width:126px">IP</th><th style="width:200px">行为</th>
            </tr></thead>
            <tbody>
            ${[
              ['今天 14:31', '访客 · 未登录', '上海 · 联通', '116.24.72.18', '打开分享链接', 'mute'],
              ['今天 14:28', '访客 · 未登录', '上海 · 联通', '116.24.72.18', '下载 品牌手册_v4.pdf', 'ok'],
              ['今天 11:06', '陈默 · 团队成员', '深圳 · 电信', '183.14.29.77', '下载 设计交付_源文件.zip', 'ok'],
              ['昨天 18:42', '访客 · 未登录', '杭州 · 移动', '112.10.55.203', '验证密码后预览', 'mute'],
              ['昨天 16:20', '访客 · 未登录', '北京 · 联通', '61.148.32.9', '下载 品牌手册_v4.pdf', 'ok']
            ].map(([t, who, loc, ip, act, k]) => `<tr>
              <td class="num" style="font-size:13px;color:var(--ink-3)">${t}</td>
              <td style="font-size:13px;color:var(--ink)">${who}</td>
              <td style="font-size:13px;color:var(--ink-3)">${loc}</td>
              <td class="num" style="font-size:13px;color:var(--ink-3)">${ip}</td>
              <td><span class="row g8"><i class="dot" style="background:${k === 'ok' ? 'var(--green)' : 'var(--ink-4)'}"></i><span style="font-size:13px;color:var(--ink-2);white-space:nowrap">${act}</span></span></td>
            </tr>`).join('')}
            </tbody>
          </table>
        </div>

        <div class="row between" style="padding:12px 20px;border-top:1px solid var(--line);background:#FCFDFF">
          <span class="sub" style="font-size:13px">最近一次访问：今天 14:31，来自上海 · 116.24.72.18</span>
          <a href="#" class="link" style="font-size:13px">导出记录</a>
        </div>
      </div>

      <div style="width:360px" class="col g16">
        <div class="panel panel--flat" style="padding:16px 18px 14px">
          <div class="between"><span class="mono-label">取件码</span><a href="#" class="link" style="font-size:13px">复制</a></div>
          <div class="mono" style="font-size:34px;line-height:40px;letter-spacing:.12em;margin-top:6px;font-weight:500">483 917</div>
          <div style="margin-top:12px;padding-top:12px;border-top:1px dashed #D3E1F4">
            <div class="between">
              <span class="mono-label">分享链接</span>
              <button class="btn btn--sm btn--quiet" style="font-size:13px">${icon('copy', 12)}复制</button>
            </div>
            <div class="mono trunc" style="font-size:13px;color:var(--ink-2);margin-top:6px">kunqiong.cn/s/7Kd2mQ</div>
          </div>
          <div style="margin-top:12px;padding-top:10px;border-top:1px dashed #D3E1F4">${barcode(276, 24)}</div>
        </div>

        <div class="panel panel--flat">
          <div class="panel-hd" style="height:44px;padding:0 18px"><span class="h4">分享设置</span><a href="#" class="link" style="font-size:13px">修改</a></div>
          <div style="padding:4px 18px 8px">
            ${[
              ['有效期至', '10 月 26 日 18:00'],
              ['下载次数', '不限'],
              ['提取密码', '已开启'],
              ['在线预览', '允许'],
              ['访问次数', '12 次'],
              ['已下载', '8 次']
            ].map(([k, v]) => `<div class="ledger__row"><span class="k">${k}</span><span class="v" style="font-size:13px">${v}</span></div>`).join('')}
          </div>
        </div>

        <a href="#" class="panel panel--flat row g12" style="padding:12px 16px;margin-top:auto;align-items:center;text-decoration:none;color:inherit">
          <span style="width:32px;height:32px;border-radius:4px;background:var(--blue-50);color:var(--blue);display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto">${icon('qr', 16)}</span>
          <div class="flex1" style="min-width:0">
            <div style="font-size:13px;color:var(--ink);font-weight:500">扫码在手机取件</div>
            <div style="font-size:13px;color:var(--ink-4);margin-top:2px">或手动输入取件码 483 917</div>
          </div>
          <span style="color:var(--ink-4)">${icon('chevronRight', 14)}</span>
        </a>

        <div class="panel panel--tint" style="padding:14px 16px">
          <div class="row g8"><span style="color:var(--blue)">${icon('shieldCheck', 15)}</span><span style="font-size:13px;color:var(--ink-2)">到期后自动删除</span></div>
          <p class="hint" style="margin-top:6px">关闭分享会立即失效，已下载的文件不受影响。可以随时重新开启。</p>
        </div>
      </div>
    </div>`
  })}</div>`;
}


/* ===== 12–15 文件收集 ===== */

function collectHeader({ logged = false } = {}) {
  return `  <div class="utility"><div class="in">
    <div class="row g20">
      <span class="row g7"><i class="dot"></i>提交通道正常</span>
      <span class="sep">/</span><span>TLS 1.3 全链路加密</span>
      <span class="sep">/</span><span>截止后自动关闭</span>
    </div>
    <div class="row g18"><span>CN · 简体中文</span><span class="sep">/</span><a href="#">帮助中心</a></div>
  </div></div>
<header class="topbar topbar--flush" style="height:68px;flex:0 0 68px">
    <div class="topbar__in">
      ${brand()}
      <div class="tb-right">
        ${logged
          ? `<a href="#" class="btn btn--ghost btn--sm" style="height:32px;padding:0 13px">我的文件</a>
             <div class="vdiv" style="height:20px"></div>
             <div class="row g8">${avatar('李明', 'avatar--sm')}<span style="font-size:13px">李明</span>${icon('chevronDown', 12)}</div>`
          : `<a href="#" class="link" style="color:var(--ink-3)">帮助</a>
             <a href="#" class="btn btn--ghost btn--sm" style="height:32px;padding:0 13px">登录</a>`}
      </div>
    </div>
  </header>`;
}

/* ---------- 12 创建文件收集任务 ---------- */
function s12() {
  return `<div class="frame">${appShell({
    active: '收集文件',
    title: '新建收集任务',
    sub: '生成一个提交链接，别人上传的文件会统一出现在这里。',
    actions: `<button class="btn btn--ghost btn--sm" style="height:32px">取消</button><button class="btn btn--primary btn--sm" style="height:32px">创建任务</button>`,
    body: `<div style="display:flex;gap:18px;flex:1;min-height:0">
      <div class="panel" style="flex:1;display:flex;flex-direction:column;min-height:0">
        <div class="panel-hd"><span class="h4">任务设置</span><span class="sub" style="font-size:13px">带 * 为必填</span></div>
        <div style="padding:18px 20px;overflow:hidden">
          <div class="field">
            <div class="label"><span class="req">*</span>任务名称</div>
            <div class="input is-focus">2026 校招作品集收集</div>
          </div>
          <div class="field mt16">
            <div class="label">收集说明</div>
            <div class="input input--ta" style="min-height:70px">请提交 PDF 格式的作品集，文件名统一为「姓名_岗位」。超过 200 MB 的文件请先压缩。</div>
            <div class="hint">这段说明会显示在提交页顶部，最多 500 字。</div>
          </div>
          <div class="row g16 mt16">
            <div class="field flex1">
              <div class="label">截止日期</div>
              <div class="input"><span class="mono" style="font-size:13px">2026-10-31 18:00</span><span style="margin-left:auto;color:var(--ink-4)">${icon('calendar', 15)}</span></div>
            </div>
            <div class="field flex1">
              <div class="label">单文件大小限制</div>
              ${selectBox('200 MB', 0)}
            </div>
          </div>
          <div class="field mt16">
            <div class="label">允许的文件类型</div>
            <div class="row g8 wrap">
              ${[['PDF', 1], ['ZIP', 1], ['JPG / PNG', 1], ['DOCX', 0], ['XLSX', 0], ['MP4', 0]].map(([t, on]) => `
                <span class="opt-row ${on ? 'on' : ''}" style="height:32px;padding:0 10px;font-size:13px">
                  ${on ? `<span style="color:var(--blue)">${icon('check', 12, 2.2)}</span>` : `<span class="check" style="width:14px;height:14px"></span>`}${t}
                </span>`).join('')}
            </div>
          </div>
          <div class="divider mt18 mb14"></div>
          <div class="between">
            <div>
              <div class="label">要求提交人填写的信息</div>
              <div class="hint" style="margin-top:2px">提交时以表单形式出现，最多 5 项</div>
            </div>
            <button class="btn btn--sm btn--ghost">${icon('plus', 12)}添加字段</button>
          </div>
          <div class="row g8 mt10">
            ${['姓名', '岗位', '联系电话'].map((f, i) => `<span class="opt-row ${i < 2 ? 'on' : ''}" style="height:32px;padding:0 10px;font-size:13px;gap:6px">
              <span class="mono" style="font-size:13px;color:${i < 2 ? 'var(--blue-700)' : 'var(--ink-4)'}">0${i + 1}</span>${f}
              <span style="color:${i < 2 ? '#8FB4E8' : 'var(--ink-4)'};margin-left:2px">${icon('x', 11)}</span>
            </span>`).join('')}
          </div>
          <div class="divider mt18 mb4"></div>
          <div class="mono-label" style="margin:10px 0 2px">提交规则</div>

          <div class="switch-row">
            <div><div class="t">要求提交人填写备注</div><div class="d">例如岗位、姓名、作品说明</div></div>
            <div class="sw on"><i></i></div>
          </div>
          <div class="switch-row" style="padding-top:0">
            <div><div class="t">允许提交人修改已提交的文件</div><div class="d">截止前可重新上传，旧版本会保留</div></div>
            <div class="sw"><i></i></div>
          </div>

        </div>
        <div class="panel-ft" style="margin-top:auto">
          <span class="sub" style="font-size:13px">创建后可在「收集任务」中查看提交情况</span>
          <a href="#" class="link" style="font-size:13px">查看示例任务</a>
        </div>
      </div>

      <div style="width:392px" class="col g16">
        <div class="panel panel--flat">
          <div class="panel-hd"><span class="h4">提交页预览</span><span class="tag tag--live">实时</span></div>
          <div style="padding:18px">
            <span class="tag tag--navy" style="height:20px">收集任务</span>
            <div class="h3 mt10" style="font-size:15px">2026 校招作品集收集</div>
            <p class="sub mt6" style="font-size:13px;line-height:19px">请提交 PDF 格式的作品集，文件名统一为「姓名_岗位」。</p>
            <div class="divider" style="margin:14px 0"></div>
            <div class="ledger">
              ${[['截止时间', '10 月 31 日 18:00'], ['文件类型', 'PDF、ZIP、JPG'], ['单文件上限', '200 MB']].map(([k, v]) => `<div class="ledger__row" style="padding:7px 0"><span class="k">${k}</span><span class="v" style="font-size:13px">${v}</span></div>`).join('')}
            </div>
            <div class="drop" style="height:86px;margin-top:14px">
              <div style="font-size:13px;color:var(--ink-3)">拖入文件，或<span class="blue"> 选择文件</span></div>
            </div>
          </div>
        </div>

        <div class="panel panel--flat" style="padding:16px 18px">
          <div class="label" style="font-size:13px">提交链接</div>
          <div class="row between mt8">
            <span class="mono trunc" style="font-size:13px;color:var(--ink-2);max-width:220px">kunqiong.cn/c/9Fq3Tz</span>
            <button class="btn btn--sm btn--ghost">${icon('copy', 12)}复制</button>
          </div>
          <div class="row g10 mt14" style="align-items:flex-start">
            <span class="qrbox" style="padding:6px">${qrSVG(70)}</span>
            <p class="hint" style="max-width:220px">把链接或二维码发给需要提交的人，对方无需注册也可以上传。</p>
          </div>
        </div>

        <div class="panel panel--flat" style="padding:16px 18px">
          <div class="label" style="font-size:13px">提交之后</div>
          <div class="col g10 mt10">
            ${[['1', '文件自动归档到这个任务，按提交人分组'], ['2', '你和提交人各收到一封确认邮件'], ['3', '截止后可以一键打包下载全部作品']].map(([n, t]) => `
              <div class="row g10" style="align-items:flex-start">
                <span class="mono" style="width:18px;height:18px;flex:0 0 18px;border-radius:4px;background:var(--blue-50);color:var(--blue-700);display:inline-flex;align-items:center;justify-content:center;font-size:13px">${n}</span>
                <span style="font-size:13px;color:var(--ink-3);line-height:18px">${t}</span>
              </div>`).join('')}
          </div>
        </div>
      </div>
    </div>`
  })}</div>`;
}

/* ---------- 13 收集任务管理 ---------- */
function s13() {
  const subs = [
    ['陈亦然', 'chenyr@studio.cn', '今天 11:24', ['作品集_陈亦然_视觉设计.pdf', 'ZIP 源文件.zip'], '视觉设计岗，附 3 个完整项目'],
    ['周雨桐', 'zhouyt@studio.cn', '今天 10:02', ['作品集_周雨桐.pdf'], '交互设计岗'],
    ['林可', 'linke@studio.cn', '昨天 19:48', ['作品集_林可_品牌.pdf', '作品集补充.pdf'], '品牌方向，含 2 份补充材料'],
    ['高维', 'gaowei@studio.cn', '昨天 16:30', ['作品集_高维.zip'], '—'],
    ['吴桐', 'wutong@studio.cn', '昨天 14:05', ['作品集_吴桐.pdf'], '动效方向'],
    ['许清和', 'xuqh@studio.cn', '10-16 09:22', ['作品集_许清和.pdf'], '视觉设计岗，应届'],
    ['孙其', 'sunqi@studio.cn', '10-15 17:10', ['作品集_孙其_交互.pdf'], '交互设计岗'],
    ['何川', 'hechuan@studio.cn', '10-15 11:36', ['作品集_何川.zip'], '品牌方向'],
    ['赵一鸣', 'zhaoym@studio.cn', '10-14 20:02', ['作品集_赵一鸣.pdf', '作品集_附录.pdf'], '动效方向，附作品说明']
  ];
  return `<div class="frame">${appShell({
    active: '收集文件',
    title: '2026 校招作品集收集',
    sub: '任务创建于 10 月 12 日，提交链接已分享给 96 位候选人。',
    actions: `<button class="btn btn--ghost btn--sm" style="height:32px">${icon('copy', 13)}复制链接</button>
      <button class="btn btn--ghost btn--sm" style="height:32px">${icon('qr', 13)}二维码</button>
      <button class="btn btn--ghost btn--sm" style="height:32px">${icon('edit', 13)}编辑任务</button>
      <button class="btn btn--sm" style="height:32px;color:var(--red);border:1px solid #EFD2CE">关闭任务</button>`,
    body: `<div class="kpis" style="grid-template-columns:repeat(5,1fr);border-top:1px solid var(--ink-0)">
        <div class="kpi">
          <div class="k"><span>提交数量</span><span class="mono" style="letter-spacing:0;color:var(--ink-3)">54%</span></div>
          <div class="v">27<small>份 / 目标 50</small></div>
          <div class="kpi__bar"><i style="width:54%"></i></div>
        </div>
        <div class="kpi">
          <div class="k"><span>参与人数</span></div>
          <div class="v">24<small>人</small></div>
          <div class="d">3 人提交了 2 次</div>
        </div>
        <div class="kpi">
          <div class="k"><span>总大小</span></div>
          <div class="v">5.8<small>GB</small></div>
          <div class="d">单文件最大 186 MB</div>
        </div>
        <div class="kpi">
          <div class="k"><span>剩余时间</span></div>
          <div class="v">12<small>天</small></div>
          <div class="d">10-31 18:00 截止</div>
        </div>
        <div class="kpi" style="border-right:0">
          <div class="k"><span>任务状态</span></div>
          <div class="v" style="font-size:22px;line-height:36px;display:flex;align-items:center;gap:9px"><i style="width:8px;height:8px;border-radius:50%;background:#0E9F6E;display:block;flex:0 0 8px"></i>进行中</div>
          <div class="d">链接已访问 96 次</div>
        </div>
      </div>

      <div class="panel" style="flex:1;display:flex;flex-direction:column;min-height:0">
        <div class="toolbar" style="padding:11px 16px">
          <div class="row g8">${searchBox('搜索提交人或文件名', 260)}${selectBox('全部状态', 120)}</div>
          <div class="row g8"><span class="mono" style="font-size:13px;color:var(--ink-4)">按时间排序 ↓</span></div>
        </div>
        <table class="table">
          <thead><tr><th style="width:44px">No.</th><th style="width:260px">提交人</th><th style="width:130px">提交时间</th><th style="width:340px">文件</th><th>备注</th><th style="width:104px" class="r">操作</th></tr></thead>
          <tbody>
          ${subs.map(([n, m, t, files, note], i) => `<tr>
            <td class="idx">${String(i + 1).padStart(2, '0')}</td>
            <td><div class="row g10">${avatar(n, 'avatar--sm')}<div><div style="font-size:13px;color:var(--ink);font-weight:500">${n}</div><div class="sub" style="font-size:13px">${m}</div></div></div></td>
            <td class="num" style="font-size:13px;color:var(--ink-3)">${t}</td>
            <td><div class="col g4">${files.map(f => `<div class="row g6" style="font-size:13px"><span style="color:var(--ink-4)">${icon('file', 13)}</span><span class="trunc" style="max-width:270px">${f}</span><a href="#" class="link" style="font-size:13px;margin-left:4px">下载</a></div>`).join('')}</div></td>
            <td><span class="sub trunc" style="display:block;max-width:240px;font-size:13px">${note}</span></td>
            <td class="r"><button class="btn btn--sm btn--ghost">${icon('download', 12)}下载</button></td>
          </tr>`).join('')}
          </tbody>
        </table>
        ${pagerBottom(27)}
      </div>`
  })}</div>`;
}

/* ---------- 14 登录用户提交文件 ---------- */
function s14() {
  return `<div class="frame"><div class="pub">
    ${collectHeader({ logged: true })}
    <div class="pub-body blueprint" style="align-items:center;position:relative">
      <div style="width:760px;position:relative">
        <div class="row between" style="align-items:flex-end">
          <div>
            <div class="eyebrow">收集任务 · KQ-C-2609</div>
            <h1 class="h1" style="font-size:32px;line-height:42px;letter-spacing:-.032em;margin-top:11px">2026 校招作品集收集</h1>
          </div>
          <div class="right">
            <div class="mono-label">剩余时间</div>
            <div class="mono" style="font-size:19px;margin-top:3px">12 天 04:18</div>
          </div>
        </div>
        <p class="lead" style="margin-top:9px;max-width:620px">请提交 PDF 格式的作品集，文件名统一为「姓名_岗位」。超过 200 MB 的文件请先压缩。</p>
        <div class="row g14" style="margin-top:12px;padding-bottom:13px;border-bottom:1px solid var(--ink-0);font-family:var(--mono);font-size:13px;color:var(--ink-4)">
          <span>截止 10-31 18:00</span><span class="sep">/</span><span>PDF · ZIP · JPG</span><span class="sep">/</span><span>单文件 200 MB</span><span class="sep">/</span><span>由 鲲穹设计中心 · 王清 发起</span>
        </div>

        <div class="panel" style="margin-top:16px;padding:12px 16px;display:flex;align-items:center;gap:12px;background:#fff;border-left:2px solid var(--blue)">
          ${avatar('李明', 'avatar--md')}
          <div class="flex1">
            <div class="row g8"><span style="font-size:13.5px;font-weight:600">李明</span><span class="tag tag--ok" style="height:19px">已登录</span></div>
            <div class="mono" style="font-size:13px;color:var(--ink-4);margin-top:2px">liming@studio.cn · 提交后接收方能看到你的身份</div>
          </div>
          <a href="#" class="link" style="font-size:13px">切换账号</a>
        </div>

        <div class="panel mt12" style="padding:14px">
          <div class="drop" style="height:172px">
            <div class="drop__art" style="margin-bottom:10px">${dropArt(74)}</div>
            <div class="drop__title" style="font-size:15px">拖入文件，或 <span class="blue">选择文件</span></div>
            <div class="drop__sub" style="margin-top:5px">支持 PDF、ZIP、JPG，单个不超过 200 MB</div>
          </div>

          <div class="mt10">
            ${fileRow({ name: '作品集_李明_视觉设计.pdf', ext: 'pdf', meta: '86.4 MB · 已完成上传', right: `<button class="btn btn--sm btn--quiet">${icon('x', 14)}</button>` })}
            ${fileRow({ name: '作品集补充_李明.zip', ext: 'zip', meta: '124.8 MB · 已完成上传', right: `<button class="btn btn--sm btn--quiet">${icon('x', 14)}</button>` })}
          </div>

          <div class="field mt12">
            <div class="label">备注（选填）</div>
            <div class="input input--ta" style="min-height:58px">视觉设计岗，附 3 个完整项目。</div>
          </div>

          <div class="row between mt14">
            <span class="sub" style="font-size:13px">提交后可在截止前重新上传，旧版本会保留</span>
            <button class="btn btn--primary btn--lg" style="min-width:132px">提交文件</button>
          </div>
        </div>
      </div>
    </div>
  </div></div>`;
}

/* ---------- 15 匿名提交文件 ---------- */
function s15() {
  return `<div class="frame"><div class="pub">
    ${collectHeader({ logged: false })}
    <div class="pub-body" style="align-items:center;background:var(--blue-50)">
      <div style="width:720px">
        <div class="row g8 mb12"><span class="tag tag--navy">收集任务</span><span class="sub" style="font-size:13px">无需注册即可提交</span></div>
        <h1 class="h1" style="font-size:26px;line-height:34px">2026 校招作品集收集</h1>
        <p class="lead" style="margin-top:8px">请提交 PDF 格式的作品集，文件名统一为「姓名_岗位」。超过 200 MB 的文件请先压缩。</p>

        <div class="panel mt16" style="padding:18px 20px">
          <div class="row between">
            <div class="field" style="width:380px">
              <div class="label"><span class="req">*</span>你的名字</div>
              <div class="input is-focus">李明<span class="caret"></span></div>
              <div class="hint">接收方会看到这个名字，用来对应你的作品集。</div>
            </div>
            <div class="row g6" style="align-self:flex-end;padding-bottom:22px;font-size:13px">
              <span class="sub">已有账号？</span><a href="#" class="link">登录后提交</a>
            </div>
          </div>

          <div class="drop mt16" style="height:158px">
            <div class="drop__art" style="margin-bottom:8px">${dropArt(70)}</div>
            <div class="drop__title" style="font-size:15px">拖入文件，或 <span class="blue">选择文件</span></div>
            <div class="drop__sub" style="margin-top:5px">PDF、ZIP、JPG · 单个不超过 200 MB</div>
          </div>

          <div class="mt8">
            ${fileRow({ name: '作品集_李明_视觉设计.pdf', ext: 'pdf', meta: '86.4 MB · 已完成上传', right: `<span class="tag tag--ok">已就绪</span>` })}
          </div>

          <div class="field mt12">
            <div class="label">备注（选填）</div>
            <div class="input input--ta" style="min-height:56px"><span class="ph">可以补充岗位方向或作品说明</span></div>
          </div>

          <div class="row between mt14">
            <p class="hint" style="max-width:360px">匿名提交也会记录提交时间与设备信息，仅用于文件溯源，不会公开展示。</p>
            <button class="btn btn--primary btn--lg" style="min-width:132px">提交文件</button>
          </div>
        </div>
        <p class="center hint" style="margin-top:14px">提交即表示同意将文件提供给任务发起方使用</p>
      </div>
    </div>
  </div></div>`;
}


/* ===== 18–23、29 账户 / 会员 / 团队 / 消息 ===== */

const PLANS = [
  { name: '基础版', price: '免费', sub: '个人偶尔用', tag: '' },
  { name: '会员版', price: '¥168 / 年', sub: '当前套餐', tag: '当前' },
  { name: '团队版', price: '¥1,680 / 年', sub: '5 人起', tag: '' },
  { name: '企业版', price: '按需报价', sub: '私有化部署', tag: '' }
];

function planTable(hl = 1) {
  const rows = [
    ['单文件上限', ['2 GB', '10 GB', '20 GB', '不限']],
    ['存储容量', ['5 GB', '50 GB', '500 GB 共享', '按合同']],
    ['保存时效', ['7 天', '30 天', '90 天', '自定义']],
    ['提取密码 / 预览', ['—', '支持', '支持', '支持']],
    ['团队协作', ['—', '—', '24 人', '不限']],
    ['审计与日志', ['—', '—', '90 天', '自定义保留']],
    ['文件恢复', ['—', '7 天内', '30 天内', '按需恢复']],
    ['发票与合同', ['—', '电子发票', '发票 + 合同', '合同与对公']],
    ['专属客服', ['—', '工单', '专属群', '客户成功经理']]
  ];
  return `<table class="plan-table">
    <thead><tr><th style="width:150px">权益</th>
      ${PLANS.map((p, i) => {
        const [amt, unit] = p.price.split(' / ');
        return `<th class="${i === hl ? 'col-hl' : ''}">
        <div class="row g6"><span style="font-size:13.5px;font-weight:600">${p.name}</span>${p.tag ? `<span class="tag" style="height:18px">${p.tag}</span>` : ''}</div>
        <div class="row g4" style="align-items:baseline;margin-top:5px">
          <span class="mono" style="font-size:18px;line-height:22px;font-weight:500;letter-spacing:-.01em;color:${i === hl ? 'var(--blue-700)' : 'var(--ink-0)'}">${amt}</span>
          ${unit ? `<span class="mono" style="font-size:13px;color:var(--ink-4)">/ ${unit}</span>` : ''}
        </div>
        <div style="font-size:13px;color:var(--ink-4);margin-top:2px">${p.sub}</div>
      </th>`; }).join('')}
    </tr></thead>
    <tbody>
      ${rows.map(([k, vals]) => `<tr><th>${k}</th>${vals.map((v, i) => `<td class="${i === hl ? 'col-hl' : ''}" style="${v === '—' ? 'color:var(--ink-4)' : ''}">${v}</td>`).join('')}</tr>`).join('')}
      <tr><th></th>
        ${PLANS.map((p, i) => `<td class="${i === hl ? 'col-hl' : ''}" style="padding:14px 16px">
          ${i === hl ? `<button class="btn btn--sm btn--ghost" style="width:100%">续费</button>`
            : i === 0 ? `<button class="btn btn--sm btn--ghost" style="width:100%;color:var(--ink-3)">当前不可降级</button>`
            : i === 3 ? `<button class="btn btn--sm btn--ghost" style="width:100%">联系我们</button>`
            : `<button class="btn btn--primary btn--sm" style="width:100%">升级</button>`}
        </td>`).join('')}
      </tr>
    </tbody>
  </table>`;
}

/* ---------- 18 会员与企业版工作台 ---------- */
function s18() {
  return `<div class="frame">${appShell({
    active: '',
    title: '会员与套餐',
    sub: '当前使用的是会员版，2027 年 3 月 12 日到期。',
    actions: `<a href="#" class="btn btn--ghost btn--sm" style="height:32px">订单记录</a>`,
    body: `<div class="panel" style="padding:14px 22px;display:flex;align-items:center;gap:26px">
        <div style="width:232px">
          <div class="row g8"><span class="mono-label">当前套餐</span>${tag('会员版', 'navy')}</div>
          <div class="row g8" style="margin-top:6px;align-items:baseline">
            <span class="mono" style="font-size:22px;font-weight:500;letter-spacing:-.02em">50 GB</span>
            <span style="font-size:13px;color:var(--ink-4)">个人容量</span>
          </div>
        </div>
        <div style="width:1px;align-self:stretch;background:var(--rule)"></div>
        <div style="flex:1">
          <div class="between mono" style="font-size:13px;color:var(--ink-4)">
            <span>已用 12.4 GB</span><span>剩余 37.6 GB</span>
          </div>
          <div class="bar bar--lg" style="margin-top:8px"><i style="width:24.8%"></i></div>
          <div class="row g18" style="margin-top:9px;font-family:var(--mono);font-size:13px;color:var(--ink-4)">
            <span>有效期至 2027-03-12</span><span class="sep">/</span><span>单文件上限 10 GB</span><span class="sep">/</span><span>保存时效 30 天</span>
          </div>
        </div>
        <div class="row g8">
          <button class="btn btn--ghost">续费一年</button>
          <button class="btn btn--primary">升级团队版</button>
        </div>
      </div>

      <div class="panel" style="flex:1;display:flex;flex-direction:column;min-height:0">
        <div class="panel-hd"><span class="h4">套餐对比</span><span class="sub" style="font-size:13px">价格含税，支持对公转账与发票</span></div>
        ${planTable(1)}
      </div>

      <div class="panel panel--flat" style="padding:14px 18px;display:flex;align-items:center;gap:14px;background:#FBFDFF">
        ${icon('building', 18)}
        <div class="flex1">
          <div style="font-size:13px;font-weight:500">鲲穹设计中心 · 团队空间</div>
          <div class="sub" style="font-size:13px">24 位成员 · 已用 168 GB / 500 GB · 你是所有者</div>
        </div>
        <a href="#" class="btn btn--sm btn--ghost">进入空间</a>
      </div>`
  })}</div>`;
}

/* ---------- 19 套餐升级与支付弹窗 ---------- */
function s19() {
  const bg = s18().replace('<div class="frame">', '').replace(/<\/div>$/, '');
  const perks = [['01', '500 GB 团队共享容量'], ['02', '24 位成员 · 按角色授权'], ['03', '90 天审计日志与到期策略'], ['04', '离职成员文件自动回收']];
  return `<div class="frame">
    ${bg}
    <div class="scrim"></div>
    <div class="modal modal--xl" style="top:50%;width:848px">
      <div class="modal-hd" style="margin:0 26px;padding:18px 0 12px;border-bottom:1px solid var(--ink-0);align-items:flex-end">
        <div>
          <div class="eyebrow">订单结算</div>
          <h2 class="h2" style="font-size:22px;line-height:30px;margin-top:6px">升级到团队版</h2>
        </div>
        <button class="modal-x" aria-label="关闭" style="margin-bottom:2px">${icon('x', 16)}</button>
      </div>
      <div class="modal-bd" style="padding:0 26px">
        <div style="display:flex">
          <div style="flex:1;min-width:0;padding:16px 26px 20px 0">
            <div class="row between" style="align-items:flex-start;padding-bottom:14px;border-bottom:1px solid var(--rule)">
              <div>
                <div class="row g8"><span style="font-size:15px;font-weight:600;color:var(--ink)">团队版 · 年付</span><span class="tag" style="height:19px">推荐</span></div>
                <div class="mono" style="font-size:13px;color:var(--ink-4);margin-top:5px;letter-spacing:.02em">5 人起 · 剩余会员时长按比例折抵</div>
              </div>
              <div class="right">
                <div class="mono" style="font-size:27px;line-height:32px;letter-spacing:-.02em;font-weight:500;color:var(--ink-0)">¥1,680</div>
                <div class="mono dim" style="font-size:13px;text-decoration:line-through;margin-top:1px">¥2,160</div>
              </div>
            </div>

            <div class="mono-label" style="margin-top:15px">包含权益</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--rule);margin-top:8px;border-bottom:1px solid var(--rule)">
              ${perks.map(([, t]) => `<div style="background:#fff;padding:11px 12px">
                <div style="font-size:13px;color:var(--ink-2)">${t}</div>
              </div>`).join('')}
            </div>

            <div class="mono-label" style="margin-top:16px">支付方式</div>
            <div class="row g10" style="margin-top:8px">
              <div style="flex:1;border:1px solid var(--blue);background:#F7FAFF;border-radius:6px;padding:10px 12px;display:flex;align-items:center;gap:9px">
                <span class="radio on"></span><span style="font-size:13px;font-weight:500;flex:1">微信支付</span><span class="mono" style="font-size:13px;color:var(--blue-700)">默认</span>
              </div>
              <div style="flex:1;border:1px solid var(--rule-2);border-radius:6px;padding:10px 12px;display:flex;align-items:center;gap:9px">
                <span class="radio"></span><span style="font-size:13px;flex:1;color:var(--ink-2)">支付宝</span>
              </div>
            </div>

            <div class="row between" style="margin-top:12px;font-size:13px;color:var(--ink-4)">
              <span>需要发票？可在支付后 7 天内申请</span>
              <a href="#" class="link">填写开票信息</a>
            </div>
          </div>

          <div style="width:272px;flex:0 0 272px;border-left:1px solid var(--rule);padding:16px 0 20px 24px;display:flex;flex-direction:column">
            <div class="mono-label">扫码支付</div>
            <div style="margin-top:8px;padding:9px;border:1px solid var(--rule-2);border-radius:6px;display:flex;justify-content:center">${qrSVG(150)}</div>
            <div class="row between" style="margin-top:8px">
              <span class="mono" style="font-size:13px;color:var(--ink-4)">订单有效期</span>
              <span class="mono" style="font-size:14px;color:var(--notice);font-weight:500">14:52</span>
            </div>
            <div class="spec" style="margin-top:12px;border-top:1px solid var(--rule);padding-top:8px">
              <div class="spec__row"><span class="k">数量</span><span class="v">1 年</span></div>
              <div class="spec__row"><span class="k">订单号</span><span class="v mono" style="font-weight:400">KQ261019143208</span></div>
              <div class="spec__row"><span class="k">优惠</span><span class="v mono" style="color:#0A7350;font-weight:400">−¥480.00</span></div>
            </div>
            <div class="row between" style="margin-top:auto;padding-top:12px;border-top:1px solid var(--ink-0);align-items:baseline">
              <span style="font-size:13px;color:var(--ink-3)">应付</span>
              <span class="mono" style="font-size:22px;font-weight:600;letter-spacing:-.02em">¥1,680.00</span>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-ft" style="padding:13px 26px">
        <span class="mono" style="margin-right:auto;font-size:13px;color:var(--ink-4)">支付即表示同意《服务协议》与《退款政策》</span>
        <button class="btn btn--ghost">取消</button>
        <button class="btn btn--primary">我已完成支付</button>
      </div>
    </div>
  </div>`;
}

/* ---------- 20 我的订单 ---------- */
function s20() {
  const orders = [
    ['会员版 · 年付', 'KQ20260312091822', '2026-03-12 09:18', '168.00', ['已支付', 'ok']],
    ['容量扩容包 50 GB', 'KQ20260128164005', '2026-01-28 16:40', '68.00', ['已支付', 'ok']],
    ['团队版 · 年付', 'KQ20251120103044', '2025-11-20 10:30', '1,680.00', ['已退款', 'mute']],
    ['会员版 · 年付', 'KQ20250312090211', '2025-03-12 09:02', '168.00', ['已支付', 'ok']],
    ['会员版 · 月付', 'KQ20260212081130', '2026-02-12 08:11', '18.00', ['待支付', 'wait']],
    ['会员版 · 月付', 'KQ20260112102833', '2026-01-12 10:28', '18.00', ['已支付', 'ok']],
    ['容量扩容包 50 GB', 'KQ20251215094412', '2025-12-15 09:44', '68.00', ['已退款', 'mute']]
  ];
  return `<div class="frame">${settingsShell({
    active: '我的订单',
    title: '我的订单',
    sub: '共 7 笔订单，累计支付 ¥422.00。',
    actions: `<button class="btn btn--ghost btn--sm" style="height:32px">${icon('card', 13)}开票信息</button>`,
    body: `<div class="kpis" style="grid-template-columns:repeat(3,1fr);border-top:1px solid var(--ink-0)">
        <div class="kpi">
          <div class="k"><span>累计支付</span></div>
          <div class="v mono" style="font-size:26px">¥422.00</div>
          <div class="d">近 12 个月 ¥204.00</div>
        </div>
        <div class="kpi">
          <div class="k"><span>订单数量</span></div>
          <div class="v">7<small>笔</small></div>
          <div class="d">已退款 2 笔 · 待支付 1 笔</div>
        </div>
        <div class="kpi" style="border-right:0">
          <div class="k"><span>当前套餐</span></div>
          <div class="v" style="font-size:22px;line-height:36px">会员版</div>
          <div class="d">2027-03-12 到期</div>
        </div>
      </div>

      <div class="panel" style="flex:1;display:flex;flex-direction:column;min-height:0">
        <div class="toolbar" style="padding:11px 16px">
          <div class="row g8">
            ${searchBox('搜索订单号', 240)}
            ${selectBox('全部状态', 120)}
            ${selectBox('近一年', 110)}
          </div>
          <span class="mono" style="font-size:13px;color:var(--ink-4)">按日期排序 ↓</span>
        </div>
        <div style="flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column">
        <table class="table" style="height:100%">
          <thead><tr><th style="width:40px">No.</th><th style="width:210px">套餐名称</th><th style="width:190px">订单号</th><th style="width:160px">创建时间</th>
            <th style="width:100px" class="r">金额</th><th style="width:96px">支付状态</th><th class="r">操作</th></tr></thead>
          <tbody>
          ${orders.map(([n, no, t, amt, st], i) => `<tr>
            <td class="idx">${String(i + 1).padStart(2, '0')}</td>
            <td><div style="font-weight:500;color:var(--ink);font-size:13px">${n}</div><div class="mono" style="font-size:13px;line-height:18px;color:var(--ink-4)">鲲穹 · 线上支付</div></td>
            <td><span class="mono" style="font-size:13px">${no}</span></td>
            <td class="num" style="font-size:13px;color:var(--ink-3)">${t}</td>
            <td class="r mono num" style="font-size:13px">¥${amt}</td>
            <td>${tag(st[0], st[1], true)}</td>
            <td class="r" style="white-space:nowrap"><a href="#" class="link" style="font-size:13px">查看详情</a><span style="color:var(--line-2);margin:0 8px">|</span><a href="#" class="link" style="font-size:13px;color:var(--ink-3)">发票</a></td>
          </tr>`).join('')}
          </tbody>
        </table>
        </div>
        ${pagerBottom(7)}
      </div>`
  })}</div>`;
}

/* ---------- 21 个人资料设置 ---------- */
function s21() {
  return `<div class="frame">${settingsShell({
    active: '个人资料',
    title: '个人资料',
    sub: '这些信息会显示在分享页与团队空间中。',
    actions: `<a href="#" class="btn btn--ghost btn--sm" style="height:32px">返回工作台</a>`,
    body: `<div style="display:flex;gap:18px;flex:1;min-height:0">
      <div class="panel" style="flex:1;display:flex;flex-direction:column">
        <div class="panel-hd"><span class="h4">基本信息</span><span class="mono" style="font-size:13px;color:var(--ink-4)">最后编辑 09-03</span></div>
        <div style="padding:18px 20px 20px">
          <div class="row g14" style="align-items:center;padding-bottom:16px;border-bottom:1px solid var(--rule)">
            ${avatar('李明', 'avatar--xl')}
            <div class="flex1">
              <div class="row g8"><span style="font-size:17px;font-weight:600;letter-spacing:-.015em">李明</span>${tag('会员版', 'navy')}</div>
              <div class="mono" style="font-size:13px;color:var(--ink-4);margin-top:3px">liming@studio.cn · 加入于 2024-06</div>
            </div>
            <div class="row g8"><button class="btn btn--sm btn--ghost">更换头像</button><button class="btn btn--sm btn--quiet" style="color:var(--ink-4)">移除</button></div>
          </div>

          <div class="row g16">
            <div class="field flex1"><div class="label">昵称</div><div class="input">李明</div></div>
            <div class="field flex1"><div class="label">职位</div><div class="input">视觉设计负责人</div></div>
          </div>
          <div class="field mt16">
            <div class="label">邮箱 <span class="tag tag--ok" style="height:18px">已验证</span></div>
            <div class="input">liming@studio.cn<span style="margin-left:auto"><a href="#" class="link" style="font-size:13px">更换</a></span></div>
          </div>
          <div class="field mt16">
            <div class="label">手机号 <span class="tag tag--ok" style="height:18px">已绑定</span></div>
            <div class="input"><span class="mono" style="font-size:13px">138 **** 6621</span><span style="margin-left:auto"><a href="#" class="link" style="font-size:13px">更换</a></span></div>
          </div>
          <div class="field mt16">
            <div class="label">默认保存时效</div>
            ${selectBox('30 天（会员版）', 0)}
            <div class="hint">新建分享时默认使用这个时效，仍可在分享设置中单独修改。</div>
          </div>
          <div class="row g16 mt16">
            <div class="field flex1"><div class="label">界面语言</div>${selectBox('简体中文', 0)}</div>
            <div class="field flex1"><div class="label">时区</div>${selectBox('(GMT+8) 北京时间', 0)}</div>
          </div>
        </div>
        <div class="row" style="margin-top:auto;border-top:1px solid var(--rule)">
          ${[['导出我的数据', 'ZIP 打包全部记录'], ['登录设备管理', '3 台设备在线'], ['注销账号', '30 天后彻底删除']].map(([t, d], i) => `
            <a href="#" style="flex:1;padding:14px 20px;border-right:${i === 2 ? '0' : '1px solid var(--rule)'};text-decoration:none;color:inherit">
              <div style="font-size:13px;font-weight:500;color:${i === 2 ? 'var(--red)' : 'var(--ink)'}">${t}</div>
              <div style="font-size:13px;color:var(--ink-4);margin-top:2px">${d}</div>
            </a>`).join('')}
        </div>
        <div class="panel-ft">
          <span class="mono" style="font-size:13px;color:var(--ink-4)">修改后立即生效</span>
          <div class="row g8"><button class="btn btn--ghost">取消</button><button class="btn btn--primary">保存修改</button></div>
        </div>
      </div>

      <div style="width:360px" class="col g16">
        <div class="panel panel--flat" style="padding:18px">
          <div class="between"><span class="h4">会员权益</span><a href="#" class="link" style="font-size:13px">管理套餐</a></div>
          <div class="row g8 mt10" style="align-items:baseline"><span style="font-size:18px;font-weight:600">会员版</span><span class="sub" style="font-size:13px">2027-03-12 到期</span></div>
          <div class="bar mt12"><i style="width:24.8%"></i></div>
          <div class="between sub mt8" style="font-size:13px"><span>已用 12.4 GB</span><span>50 GB</span></div>
          <div class="spec" style="margin-top:6px;border-top:1px solid var(--rule);padding-top:8px">
            <div class="spec__row"><span class="k">单文件上限</span><span class="v mono">10 GB</span></div>
            <div class="spec__row"><span class="k">保存时效</span><span class="v mono">30 天</span></div>
            <div class="spec__row"><span class="k">提取密码</span><span class="v">支持</span></div>
            <div class="spec__row"><span class="k">在线预览</span><span class="v">支持</span></div>
          </div>
          <button class="btn btn--ghost btn--block mt14">升级到团队版</button>
        </div>

        <div class="panel panel--flat" style="padding:18px">
          <div class="row between"><span class="h4">账号</span><a href="#" class="link" style="font-size:13px">账号与安全</a></div>
          <div class="ledger mt6">
            <div class="ledger__row"><span class="k">账号 ID</span><span class="v mono" style="font-size:13px">KQ-88213047</span></div>
            <div class="ledger__row"><span class="k">注册时间</span><span class="v" style="font-size:13px">2024-06-18</span></div>
            <div class="ledger__row"><span class="k">登录方式</span><span class="v" style="font-size:13px">邮箱 + 密码</span></div>
          </div>
        </div>
      </div>
    </div>`
  })}</div>`;
}

/* ---------- 22 账号与安全 ---------- */
function s22() {
  return `<div class="frame">${settingsShell({
    active: '账号与安全',
    title: '账号与安全',
    sub: '管理登录方式、安全验证与绑定的第三方账号。',
    actions: `<a href="#" class="btn btn--ghost btn--sm" style="height:32px">返回工作台</a>`,
    body: `
    <div class="row g10" style="flex:0 0 auto;padding:11px 14px;background:#fff;border:1px solid var(--rule-2);border-left:2px solid #0E9F6E">
      <span style="color:var(--green)">${icon('shieldCheck', 16)}</span>
      <span style="font-size:13px;color:var(--ink);font-weight:500">最近 30 天没有异常登录</span>
      <span class="sep">/</span>
      <span class="mono" style="font-size:13px;color:var(--ink-4)">登录行为记录保留 180 天</span>
      <a href="#" class="link" style="font-size:13px;margin-left:auto">查看登录记录</a>
    </div>

    <div class="panel">
      <div class="panel-hd"><span class="h4">当前登录</span><span class="tag tag--ok" style="height:20px"><i class="dot"></i>本次会话</span></div>
      <div style="padding:6px 20px 16px">
        <div class="row g12" style="padding:14px 0;border-bottom:1px solid var(--line)">
          <span style="width:36px;height:36px;border-radius:8px;background:var(--blue-50);display:flex;align-items:center;justify-content:center;color:var(--ink-3);border:1px solid var(--line)">${icon('monitor', 18)}</span>
          <div class="flex1">
            <div style="font-size:13px;color:var(--ink)">Chrome on macOS · 上海</div>
            <div class="sub" style="font-size:13px;margin-top:1px">10.24.***.18 · 当前正在使用 · 14:32 登录</div>
          </div>
          <button class="btn btn--sm btn--ghost">退出该设备</button>
        </div>
        <div class="row g12" style="padding:14px 0">
          <span style="width:36px;height:36px;border-radius:8px;background:var(--blue-50);display:flex;align-items:center;justify-content:center;color:var(--ink-3);border:1px solid var(--line)">${icon('mobile', 18)}</span>
          <div class="flex1">
            <div style="font-size:13px;color:var(--ink)">iPhone 16 · 上海</div>
            <div class="sub" style="font-size:13px;margin-top:1px">116.24.***.62 · 2 天前登录</div>
          </div>
          <button class="btn btn--sm btn--ghost">退出该设备</button>
        </div>
      </div>
      <div class="panel-ft" style="justify-content:space-between">
        <span class="sub" style="font-size:13px">2 台设备保持登录状态</span>
        <button class="btn btn--sm" style="color:var(--red);border:1px solid #EFD2CE">${icon('logout', 13)}退出所有设备</button>
      </div>
    </div>

    <div style="display:flex;gap:18px">
      <div class="panel flex1">
        <div class="panel-hd"><span class="h4">安全验证</span><span class="sub" style="font-size:13px">已启用 2 项</span></div>
        <div style="padding:4px 20px 8px">
          ${[
            ['key', '登录密码', '上次修改：2026-07-21', tag('已设置', 'ok')],
            ['mobile', '手机号', '138 **** 6621', tag('已绑定', 'ok')],
            ['shield', '两步验证', '登录新设备时需要邮箱验证码', tag('未开启', 'wait')],
            ['mail', '安全邮箱', 'liming@studio.cn', tag('已验证', 'ok')]
          ].map(([ic, t, d, st]) => `<div class="row g12" style="padding:13px 0;border-bottom:1px solid var(--line)">
            <span style="color:var(--ink-4)">${icon(ic, 17)}</span>
            <div class="flex1"><div style="font-size:13px">${t}</div><div class="sub" style="font-size:13px;margin-top:1px">${d}</div></div>
            ${st}
            <a href="#" class="link" style="font-size:13px;margin-left:10px">${t === '两步验证' ? '开启' : '修改'}</a>
          </div>`).join('')}
        </div>
      </div>

      <div class="panel" style="width:400px">
        <div class="panel-hd"><span class="h4">第三方绑定</span></div>
        <div style="padding:4px 20px 12px">
          ${[
            ['微信', '已绑定 · 李明', '解绑', 'ok'],
            ['企业微信', '未绑定 · 可用于团队登录', '绑定', 'mute'],
            ['飞书', '未绑定', '绑定', 'mute']
          ].map(([t, d, act, st]) => `<div class="row g12" style="padding:13px 0;border-bottom:1px solid var(--line)">
            <span class="avatar avatar--sm" style="background:#F1F6FD;color:var(--ink-3)">${icon('link', 14)}</span>
            <div class="flex1"><div style="font-size:13px">${t}</div><div class="sub" style="font-size:13px;margin-top:1px">${d}</div></div>
            <a href="#" class="link" style="font-size:13px;color:${act === '解绑' ? 'var(--ink-3)' : 'var(--blue-700)'}">${act}</a>
          </div>`).join('')}
        </div>
        <div style="padding:0 20px 18px">
          <div class="sec-note">${icon('alert', 14)}<span>解绑微信后，将无法使用微信扫码登录，请确保邮箱可用。</span></div>
        </div>
      </div>
    </div>`
  })}</div>`;
}

/* ---------- 23 消息通知设置 ---------- */
function s23() {
  const rows = [
    ['文件被取件', '对方打开或下载你的文件时通知你', 1],
    ['文件即将过期', '到期前 24 小时提醒一次', 1],
    ['收集任务有新提交', '有人向你的收集任务提交文件', 1],
    ['团队邀请与申请', '收到邀请或入团申请时通知', 1]
  ];
  return `<div class="frame">${settingsShell({
    active: '消息通知',
    title: '消息通知',
    sub: '选择哪些变化需要提醒你，其余会安静地留在消息中心。',
    actions: `<span class="row g6" style="font-size:13px;color:var(--green)">${icon('check', 14, 2.2)}<span>所有更改已保存</span></span>`,
    body: `<div style="display:flex;gap:18px;flex:1;min-height:0">
      <div style="flex:1" class="col g16">
        <div class="panel">
          <div class="panel-hd"><span class="h4">站内消息</span><span class="sub" style="font-size:13px">显示在消息中心</span></div>
          <div style="padding:2px 20px 10px">
            ${rows.map(([t, d, on]) => `<div class="switch-row" style="border-bottom:1px solid var(--line)">
              <div><div class="t">${t}</div><div class="d">${d}</div></div>
              <div class="sw ${on ? 'on' : ''}"><i></i></div>
            </div>`).join('')}
          </div>
        </div>

        <div class="panel">
          <div class="panel-hd"><span class="h4">邮件通知</span><span class="sub" style="font-size:13px">发送到 liming@studio.cn</span></div>
          <div style="padding:2px 20px 10px">
            ${[
              ['有人取走我的文件', 1],
              ['收集任务每日汇总', 1],
              ['账单与订单状态', 1],
              ['产品更新与活动', 0]
            ].map(([t, on]) => `<div class="switch-row" style="border-bottom:1px solid var(--line)">
              <div class="t">${t}</div><div class="sw ${on ? 'on' : ''}"><i></i></div>
            </div>`).join('')}
            <div class="row between" style="padding:14px 0 4px">
              <div><div class="t" style="font-size:13.5px;color:var(--ink-2)">邮件发送频率</div><div class="d" style="font-size:13px;color:var(--ink-4);margin-top:2px">多条通知会合并成一封</div></div>
              ${selectBox('实时发送', 140)}
            </div>
          </div>
        </div>
      </div>

      <div style="width:340px" class="col g16">
        <div class="panel panel--flat" style="padding:18px">
          <div class="h4">免打扰</div>
          <p class="hint" style="margin-top:6px">免打扰期间的通知不会推送，仍会在消息中心保留。</p>
          <div class="switch-row" style="border-bottom:1px solid var(--line)">
            <div class="t">开启免打扰</div><div class="sw on"><i></i></div>
          </div>
          <div class="row g8 mt12">
            <div class="input input--sm" style="justify-content:center">22:00</div>
            <span class="dim">至</span>
            <div class="input input--sm" style="justify-content:center">08:00</div>
          </div>
          <div class="hint mt6">仅工作日生效</div>
        </div>

        <div class="panel panel--flat panel--tint" style="padding:18px">
          <div class="row g8"><span style="color:var(--blue)">${icon('bell', 16)}</span><span class="h4" style="font-size:13px">推送通道</span></div>
          <div class="ledger" style="margin-top:4px">
            <div class="ledger__row"><span class="k">浏览器通知</span><span class="v" style="font-size:13px">已允许</span></div>
            <div class="ledger__row"><span class="k">微信服务号</span><span class="v" style="font-size:13px">已关注</span></div>
          </div>
          <a href="#" class="link mt10" style="display:inline-block;font-size:13px">管理推送通道</a>
        </div>
      </div>
    </div>`
  })}</div>`;
}

/* ---------- 29 消息中心 ---------- */
function s29() {
  const msgs = [
    [1, 'share', '王清 取走了你的文件', '品牌手册_v4.pdf · 取件码 483 917', '12 分钟前'],
    [1, 'collect', '陈亦然 提交了作品集', '2026 校招作品集收集 · 2 个文件', '1 小时前'],
    [1, 'shield', '安全提醒：异地登录已拦截', '广州 · Windows · 已阻止并通知你', '今天 09:12'],
    [1, 'team', '周雨桐 申请加入 鲲穹设计中心', '申请理由：新入职视觉设计师', '昨天 18:40'],
    [0, 'card', '会员续费成功', '会员版 · 年付 ¥168 · 有效期至 2027-03-12', '10 月 17 日'],
    [0, 'share', '你分享的文件将在 24 小时后过期', '设计交付_2026Q3 · 3 个文件', '10 月 16 日'],
    [1, 'card', '发票已开具', '订单 KQ20260312091822 · 电子普通发票', '10 月 15 日'],
    [0, 'shield', '新设备登录提醒', 'macOS · 上海 · 如非本人操作请立即改密', '10 月 14 日'],
    [0, 'collect', '收集任务将在 3 天后关闭', '2026 校招作品集收集 · 已收 18 份作品', '10 月 13 日'],
    [0, 'share', '分享链接累计访问 12 次', '设计交付_2026Q3 · 最近一次来自上海', '10 月 12 日']
  ];
  const icoMap = { share: 'send', collect: 'inbox', shield: 'shield', team: 'users', card: 'card' };
  return `<div class="frame">${appShell({
    active: '消息中心',
    title: '消息中心',
    sub: '未读 5 条。文件动态、团队邀请与安全提醒都在这里。',
    actions: `<button class="btn btn--ghost btn--sm" style="height:32px">${icon('check', 14)}全部标记已读</button>`,
    body: `<div style="display:flex;gap:18px;flex:1;min-height:0">
      <div style="width:188px;flex:0 0 188px">
        <div class="col g2">
          ${[['全部消息', 14, 1], ['文件分享', 5, 0], ['收集任务', 3, 0], ['团队邀请', 1, 0], ['支付通知', 3, 0], ['安全提醒', 2, 0]]
            .map(([t, c, on]) => `<a href="#" style="display:flex;align-items:center;justify-content:space-between;height:36px;padding:0 10px;border-radius:6px;font-size:13px;text-decoration:none;${on ? 'background:var(--blue-100);color:var(--blue-700);font-weight:500' : 'color:var(--ink-3)'}">
              <span>${t}</span><span class="mono" style="font-size:13px;color:${on ? 'var(--blue-700)' : 'var(--ink-4)'}">${c}</span></a>`).join('')}
        </div>
        <div class="hairline" style="margin:14px 0"></div>
        <div class="col g8" style="padding:0 10px">
          <div class="label" style="font-size:13px">按时间</div>
          <a href="#" class="sub" style="font-size:13px;text-decoration:none">今天</a>
          <a href="#" class="sub" style="font-size:13px;text-decoration:none">最近 7 天</a>
          <a href="#" class="sub" style="font-size:13px;text-decoration:none">更早</a>
        </div>
      </div>

      <div class="panel" style="flex:1;display:flex;flex-direction:column;min-height:0">
        <div style="padding:0 22px;flex:1">
          ${msgs.map(([unread, k, t, d, time], i) => `<div class="row g14" style="padding:15px 0;border-bottom:${i === msgs.length - 1 ? '0' : '1px solid var(--line)'};align-items:flex-start">
            <span style="width:32px;height:32px;border-radius:8px;background:${unread ? 'var(--blue-50)' : '#F7F9FD'};border:1px solid var(--line);display:flex;align-items:center;justify-content:center;color:${unread ? 'var(--blue-700)' : 'var(--ink-4)'}">${icon(icoMap[k], 16)}</span>
            <div class="flex1">
              <div class="row g8">
                ${unread ? '<i class="dot" style="color:var(--blue)"></i>' : ''}
                <span style="font-size:13.5px;font-weight:${unread ? '600' : '400'};color:var(--ink)">${t}</span>
              </div>
              <div class="sub" style="font-size:13px;margin-top:3px">${d}</div>
            </div>
            <span class="sub num" style="font-size:13px;white-space:nowrap">${time}</span>
            <a href="#" class="link" style="font-size:13px;margin-left:10px">查看</a>
          </div>`).join('')}
        </div>
        <div class="panel-ft" style="justify-content:center">
          <a href="#" class="link" style="font-size:13px">加载更早的消息</a>
        </div>
      </div>
    </div>`
  })}</div>`;
}


/* ===== 25–28 团队空间 ===== */

function teamStats() {
  return `<div class="kpis" style="grid-template-columns:repeat(5,1fr)">
    <div class="kpi"><div class="k">团队成员</div><div class="v">24<span style="font-size:14px;font-weight:400;color:var(--ink-4);margin-left:3px">人</span></div><div class="d">3 位管理员 · 2 位待接受</div></div>
    <div class="kpi"><div class="k">团队容量</div><div class="v">168<span style="font-size:14px;font-weight:400;color:var(--ink-4);margin-left:3px">/ 500 GB</span></div><div class="d">已使用 33.6%</div></div>
    <div class="kpi"><div class="k">本月传输</div><div class="v">1.2<span style="font-size:14px;font-weight:400;color:var(--ink-4);margin-left:3px">TB</span></div><div class="d">较上月 +18%</div></div>
    <div class="kpi"><div class="k">团队套餐</div><div class="v" style="font-size:20px;line-height:30px;padding-top:2px">团队版</div><div class="d">2027-03-12 到期</div></div>
    <div class="kpi"><div class="k">你的角色</div><div class="v" style="font-size:20px;line-height:30px;padding-top:2px">所有者</div><div class="d">可管理成员与策略</div></div>
  </div>`;
}

function s25() {
  return `<div class="frame">${appShell({
    active: '团队空间',
    title: '鲲穹设计中心',
    sub: '团队空间 · 创建于 2025 年 11 月 · 你是空间所有者',
    actions: `<button class="btn btn--ghost btn--sm" style="height:32px">${icon('sliders', 14)}团队设置</button><button class="btn btn--primary btn--sm" style="height:32px">${icon('userPlus', 14)}邀请成员</button>`,
    body: `${teamStats()}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;flex:1;min-height:0">
        <div class="panel" style="display:flex;flex-direction:column">
          <div class="panel-hd"><span class="h4">邀请链接</span><span class="tag tag--mute" style="height:19px">7 天后失效</span></div>
          <div style="padding:16px 18px">
            <div class="row between" style="padding:9px 12px;border:1px solid var(--line);border-radius:8px;background:#FBFDFF">
              <span class="mono trunc" style="font-size:13px">kunqiong.cn/t/design-qiong</span>
              <button class="btn btn--sm btn--quiet">${icon('copy', 13)}复制</button>
            </div>
            <div class="row g12 mt10" style="align-items:flex-start">
              <span class="qrbox" style="padding:5px">${qrSVG(60)}</span>
              <div class="flex1">
                <div style="font-size:13px;color:var(--ink-3);line-height:19px">成员通过链接申请加入，需要管理员审批。也可以给指定邮箱发送邀请。</div>
                <a href="#" class="link mt6" style="display:inline-block;font-size:13px">按邮箱邀请</a>
              </div>
            </div>
            <div class="divider" style="margin:10px 0 7px"></div>
            <div class="between"><span class="mono-label">最近通过链接加入</span><span class="mono" style="font-size:13px;color:var(--ink-4)">近 30 天 3 人</span></div>
            <div class="row g8" style="margin-top:8px">
              <div class="avastack">${['许', '孙', '何'].map(n => avatar(n, 'avatar--sm')).join('')}</div>
              <span style="font-size:13px;color:var(--ink-3)">许清和、孙其、何川</span>
              <span class="mono" style="font-size:13px;color:var(--ink-4);margin-left:auto">最近 10-16</span>
            </div>
          </div>
          <div class="panel-ft" style="margin-top:auto">
            <span class="sub" style="font-size:13px">链接已访问 46 次</span>
            <button class="btn btn--sm btn--ghost">${icon('refresh', 12)}重置链接</button>
          </div>
        </div>

        <div class="panel" style="display:flex;flex-direction:column">
          <div class="panel-hd"><span class="h4">成员概览</span><a href="#" class="link" style="font-size:13px">管理成员</a></div>
          <div style="padding:16px 18px">
            <div class="row g12">
              <div class="avastack">
                ${['王清', '周雨桐', '林可', '高维'].map(n => avatar(n.slice(0, 1), 'avatar--sm')).join('')}
              </div>
              <span class="sub" style="font-size:13px">王清、周雨桐 等 24 位成员</span>
            </div>
            <div class="ledger mt10">
              <div class="ledger__row"><span class="k">所有者</span><span class="v" style="font-size:13px">李明</span></div>
              <div class="ledger__row"><span class="k">管理员</span><span class="v" style="font-size:13px">王清、周雨桐</span></div>
              <div class="ledger__row"><span class="k">本月新增</span><span class="v" style="font-size:13px">4 人</span></div>
              <div class="ledger__row"><span class="k">待接受邀请</span><span class="v" style="font-size:13px">2 人</span></div>
            </div>
            <div class="row g8 mt10" style="font-size:13px;color:var(--ink-4)">${icon('clock', 14)}<span>最近加入：许清和 · 2026-09-28</span></div>
          </div>
          <div class="panel-ft" style="margin-top:auto">
            <span class="sub" style="font-size:13px">2 位成员待接受邀请</span>
            <a href="#" class="link" style="font-size:13px">查看申请</a>
          </div>
        </div>

        <div class="panel">
          <div class="panel-hd"><span class="h4">容量使用</span><span class="sub" style="font-size:13px">168 GB / 500 GB</span></div>
          <div style="padding:16px 18px">
            ${bars({ rows: [['设计资料', 96, '#1677FF'], ['市场素材', 42, '#1677FF'], ['合同与法务', 18, '#1677FF'], ['其他', 12, '#A9C6F0']], max: 100, unit: ' GB' })}
            <div class="row between" style="margin-top:12px"><span class="hint">按文件夹统计，前 4 项占用最多</span><a href="#" class="link" style="font-size:13px">清理过期文件</a></div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-hd"><span class="h4">团队管理</span><span class="sub" style="font-size:13px">仅所有者可见</span></div>
          <div style="padding:4px 18px 10px">
            ${[['users', '成员与权限', '24 位成员 · 3 个角色'], ['shield', '审计日志', '保留 90 天 · 最近 12 条'], ['clock', '团队分享策略', '默认 30 天 · 强制密码']].map(([ic, t, d]) => `
              <a href="#" style="display:flex;align-items:center;gap:11px;padding:11px 0;border-bottom:1px solid var(--line);text-decoration:none">
                <span style="color:var(--ink-4)">${icon(ic, 16)}</span>
                <div class="flex1"><div style="font-size:13px;color:var(--ink)">${t}</div><div class="sub" style="font-size:13px;margin-top:1px">${d}</div></div>
                <span style="color:var(--ink-4)">${icon('chevronRight', 15)}</span>
              </a>`).join('')}
          </div>
          <div style="padding:0 18px 14px"><a href="#" class="link" style="font-size:13px">转让团队所有权</a></div>
        </div>
      </div>`
  })}</div>`;
}

const MEMBERS = [
  ['李明', 'liming@studio.cn', ['所有者', 'navy'], '2025-11-03', 24.6, ['正常', 'ok']],
  ['王清', 'wangqing@studio.cn', ['管理员', ''], '2025-11-03', 18.2, ['正常', 'ok']],
  ['周雨桐', 'zhouyt@studio.cn', ['管理员', ''], '2025-11-12', 12.8, ['正常', 'ok']],
  ['林可', 'linke@studio.cn', ['成员', 'mute'], '2026-01-08', 8.4, ['正常', 'ok']],
  ['高维', 'gaowei@studio.cn', ['成员', 'mute'], '2026-03-21', 6.1, ['正常', 'ok']],
  ['吴桐', 'wutong@studio.cn', ['成员', 'mute'], '2026-05-16', 3.2, ['正常', 'ok']],
  ['许清和', 'xuqh@studio.cn', ['成员', 'mute'], '2026-09-28', 0, ['待接受', 'wait']],
  ['陈默', 'chenmo@studio.cn', ['成员', 'mute'], '2026-06-02', 2.4, ['正常', 'ok']],
  ['林小满', 'linxm@studio.cn', ['成员', 'mute'], '2026-07-19', 1.1, ['正常', 'ok']],
  ['赵一鸣', 'zhaoym@studio.cn', ['访客', 'mute'], '2026-08-30', 0.4, ['正常', 'ok']],
  ['孙其', 'sunqi@studio.cn', ['成员', 'mute'], '2026-09-11', 0.8, ['正常', 'ok']],
  ['何川', 'hechuan@studio.cn', ['成员', 'mute'], '2026-09-25', 0.2, ['正常', 'ok']]
];

function memberTable(hover = -1) {
  return `<table class="table table--dense">
    <thead><tr>
      <th style="width:44px">No.</th>
      <th style="width:280px">成员</th><th style="width:110px">角色</th><th style="width:130px">加入时间</th>
      <th style="width:200px">空间使用</th><th style="width:100px">状态</th><th class="r">操作</th>
    </tr></thead>
    <tbody>
    ${MEMBERS.map(([n, m, role, t, use, st], i) => `<tr style="${i === hover ? 'background:#FBFDFF;box-shadow:inset 2px 0 0 var(--blue)' : ''}">
      <td class="idx">${String(i + 1).padStart(2, '0')}</td>
      <td><div class="row g10">${avatar(n, 'avatar--sm')}<div><div style="font-size:13px;color:var(--ink);font-weight:500">${i === hover ? n + '<span class="tag" style="height:18px;margin-left:6px;font-weight:400">正在操作</span>' : n}</div><div class="mono" style="font-size:13px;line-height:18px;color:var(--ink-4)">${m}</div></div></div></td>
      <td>${tag(role[0], role[1])}</td>
      <td class="num" style="font-size:13px;color:var(--ink-3)">${t}</td>
      <td><div class="row g8"><span class="mono num" style="font-size:13px;width:66px;white-space:nowrap;color:var(--ink-2)">${use.toFixed(1)}<span style="color:var(--ink-4)"> GB</span></span><div class="bar bar--thin" style="width:72px"><i style="width:${Math.min(use * 2, 100)}%"></i></div></div></td>
      <td>${tag(st[0], st[1], true)}</td>
      <td class="r"><button class="iconbtn" style="width:28px;height:28px;${i === hover ? 'background:var(--blue-100);color:var(--blue-700)' : ''}" aria-label="更多">${icon('more', 15)}</button></td>
    </tr>`).join('')}
    </tbody>
  </table>`;
}

function teamMembersBody(hover = -1) {
  return `<div class="row between" style="flex:0 0 auto;padding:9px 2px 10px;border-bottom:1px solid var(--ink-0)">
      <div class="row g14" style="font-family:var(--mono);font-size:13px;letter-spacing:.04em;color:var(--ink-4)">
        <span>成员 <b style="color:var(--ink);font-weight:500">36</b></span><span class="sep">/</span>
        <span>待接受 <b style="color:var(--ink-2);font-weight:500">2</b></span><span class="sep">/</span>
        <span>已用存储 <b style="color:var(--ink);font-weight:500">168 GB</b> / 500 GB</span><span class="sep">/</span>
        <span>角色 <b style="color:var(--ink);font-weight:500">4</b></span>
      </div>
      <span class="row g6" style="font-size:13px;color:var(--ink-4)">${icon('info', 13)}<span>邀请 7 天后自动失效</span></span>
    </div>

    <div class="panel" style="flex:1;display:flex;flex-direction:column;min-height:0">
    <div class="toolbar" style="padding:11px 16px">
      <div class="row g8">${searchBox('搜索姓名或邮箱', 250)}${selectBox('全部角色', 120)}${selectBox('全部状态', 120)}</div>
      <span class="mono" style="font-size:13px;color:var(--ink-4)">按加入时间排序 ↓</span>
    </div>
    ${memberTable(hover)}
    <div style="margin-top:auto">${pager(36)}</div>
  </div>`;
}

function s26() {
  return `<div class="frame">${appShell({
    active: '团队空间',
    title: '团队成员',
    sub: '按角色分配查看、上传与管理的权限。',
    actions: `<button class="btn btn--ghost btn--sm" style="height:32px">${icon('download', 13)}导出成员</button><button class="btn btn--primary btn--sm" style="height:32px">${icon('userPlus', 14)}邀请成员</button>`,
    body: teamMembersBody()
  })}</div>`;
}

function s27() {
  return `<div class="frame">
    ${appShell({
      active: '团队空间',
      title: '团队成员',
      sub: '按角色分配查看、上传与管理的权限。',
      actions: `<button class="btn btn--ghost btn--sm" style="height:32px">${icon('download', 13)}导出成员</button><button class="btn btn--primary btn--sm" style="height:32px">${icon('userPlus', 14)}邀请成员</button>`,
      body: teamMembersBody(2)
    })}
    <div class="menu" style="position:absolute;right:132px;top:436px;z-index:9">
      <div class="menu__item">${icon('eye', 15)}查看成员</div>
      <div class="menu__item is-on">${icon('sliders', 15)}调整角色</div>
      <div class="menu__item">${icon('link', 15)}复制邀请信息</div>
      <div class="menu__sep"></div>
      <div class="menu__item menu__item--danger">${icon('trash', 15)}移除成员</div>
    </div>
  </div>`;
}

/* ---------- 28 入团申请 ---------- */
function s28() {
  const reqs = [
    ['周雨桐', 'zhouyt@studio.cn', '今天 09:12', '新入职视觉设计师，工位在 3 楼设计区，需要访问「品牌资料」文件夹。'],
    ['许清和', 'xuqh@studio.cn', '昨天 18:40', '外部合作方，负责 Q4 包装设计，预计协作 3 个月。'],
    ['陈亦然', 'chenyr@studio.cn', '10 月 17 日 14:05', '校招候选人，作品集评审期间需要查看设计规范。']
  ];
  return `<div class="frame">${appShell({
    active: '团队空间',
    title: '入团申请',
    sub: '通过后成员会立即获得「成员」角色，可随时调整权限。',
    body: `<div class="kpis" style="grid-template-columns:repeat(4,1fr);border-top:1px solid var(--ink-0)">
        <div class="kpi kpi--hl">
          <div class="k"><span>待处理</span><span class="mono" style="letter-spacing:0;color:var(--ink-4)">PENDING</span></div>
          <div class="v">3<small>条</small></div>
          <div class="d">最早一条等待 2 天 4 小时</div>
        </div>
        <div class="kpi">
          <div class="k"><span>本月通过</span></div>
          <div class="v">8<small>人</small></div>
          <div class="d">其中 2 位为外部协作方</div>
        </div>
        <div class="kpi">
          <div class="k"><span>本月拒绝</span></div>
          <div class="v">1<small>人</small></div>
          <div class="d">未说明协作关系</div>
        </div>
        <div class="kpi" style="border-right:0">
          <div class="k"><span>平均处理时长</span></div>
          <div class="v">2.4<small>小时</small></div>
          <div class="d">目标 4 小时内</div>
        </div>
      </div>

      <div class="panel" style="flex:0 0 auto">
        <div style="padding:0 20px">
        ${reqs.map(([n, m, t, why], i) => `<div class="row g12" style="padding:12px 0;border-bottom:${i === reqs.length - 1 ? '0' : '1px solid var(--rule)'};align-items:flex-start">
          <span class="manifest__no" style="padding-top:3px">${String(i + 1).padStart(2, '0')}</span>
          ${avatar(n, 'avatar--md')}
          <div class="flex1" style="min-width:0">
            <div class="row g10">
              <span style="font-size:13.5px;font-weight:600;color:var(--ink)">${n}</span>
              <span class="mono" style="font-size:13px;color:var(--ink-4)">${m}</span>
              <span class="sep">·</span>
              <span class="mono" style="font-size:13px;color:var(--ink-3)">${t}</span>
              <span class="tag tag--mute" style="height:18px;margin-left:2px">默认角色 成员</span>
            </div>
            <div style="margin-top:6px;padding-left:10px;border-left:2px solid var(--rule-2);font-size:13px;line-height:20px;color:var(--ink-3)">${why}</div>
          </div>
          <div class="row g8" style="padding-top:2px">
            <button class="btn btn--ghost btn--sm">拒绝</button>
            <button class="btn btn--primary btn--sm">通过</button>
          </div>
        </div>`).join('')}
        </div>
      </div>

      <div class="panel" style="flex:1;display:flex;flex-direction:column;min-height:0">
        <div class="panel-hd"><span class="h4">最近处理</span><span class="mono" style="font-size:13px;color:var(--ink-4)">近 30 天</span></div>
        <table class="table table--dense">
          <thead><tr><th style="width:44px">No.</th><th style="width:240px">申请人</th><th style="width:120px">结果</th><th style="width:160px">处理人</th><th style="width:150px">处理时间</th><th class="r">备注</th></tr></thead>
          <tbody>
            ${[
              ['郑云', 'zhengyun@corp.cn', ['已通过', 'ok'], '王清', '10-18 16:20', '外部合作方'],
              ['苏迟', 'suchi@studio.cn', ['已通过', 'ok'], '李明', '10-17 11:05', '转正入职'],
              ['何一', 'heyi@outlook.com', ['已拒绝', 'bad'], '王清', '10-16 09:41', '未说明协作关系'],
              ['柳青', 'liuqing@corp.cn', ['已通过', 'ok'], '周雨桐', '10-15 15:12', '临时项目协作'],
              ['闻舟', 'wenzhou@studio.cn', ['已拒绝', 'bad'], '李明', '10-14 10:08', '重复申请']
            ].map(([n, m, st, who, t, note], i) => `<tr>
              <td class="idx">${String(i + 1).padStart(2, '0')}</td>
              <td><div class="row g10">${avatar(n, 'avatar--sm')}<div><div style="font-size:13px;color:var(--ink);font-weight:500">${n}</div><div class="sub" style="font-size:13px">${m}</div></div></div></td>
              <td>${tag(st[0], st[1], true)}</td>
              <td style="font-size:13px">${who}</td>
              <td class="num" style="font-size:13px;color:var(--ink-3)">${t}</td>
              <td class="r" style="font-size:13px;color:var(--ink-3)">${note}</td>
            </tr>`).join('')}
          </tbody>
        </table>
        <div class="panel-ft" style="margin-top:auto">
          <span style="font-family:var(--mono);font-size:13px;color:var(--ink-4)">审批结果会通过邮件与站内消息通知申请人</span>
          <a href="#" class="link" style="font-size:13px">导出审批记录</a>
        </div>
      </div>`
  })}</div>`;
}


/* ===== 30–35 运营后台 ===== */

/* ---------- 30 管理员登录 ---------- */
function s30() {
  return `<div class="pub">
    <div class="pub-body grid-tex" style="position:relative">
      <div style="position:relative;width:760px">
        <div style="display:flex;border:1px solid #C4D5EA;border-radius:8px;overflow:hidden;background:#fff;box-shadow:0 24px 56px -32px rgba(10,27,51,.34)">
          <div class="inkblock" style="width:286px;flex:0 0 286px;border-radius:0;padding:26px 24px 22px;display:flex;flex-direction:column">
            <div class="row g9" style="align-items:center">
              <span style="color:#fff">${mark(24)}</span>
              <span style="font-size:15px;font-weight:600;letter-spacing:-.01em;color:#fff">鲲穹</span>
              <span class="mono" style="font-size:13px;letter-spacing:.14em;color:#7E9AC0;margin-left:2px">运营后台</span>
            </div>
            <div class="eyebrow" style="margin-top:26px">Secure access</div>
            <div style="font-size:22px;line-height:30px;letter-spacing:-.02em;font-weight:600;color:#fff;margin-top:8px">运营后台</div>
            <p style="font-size:13px;line-height:20px;color:#8FA6C4;margin-top:7px">生产环境控制台，仅向授权运营人员开放。</p>

            <div style="margin-top:22px;border-top:1px solid #1B3252;padding-top:12px">
              ${[['节点', 'cn-east-1'], ['版本', 'v2.4.1'], ['证书', '有效 87 天'], ['状态', '全部正常']].map(([k, v], i) => `
                <div class="row between" style="padding:6px 0;font-family:var(--mono);font-size:13px">
                  <span style="color:#6C84A3">${k}</span>
                  <span class="row g6" style="color:#C6D8EF">${i === 3 ? '<i style="width:5px;height:5px;background:#2FD3A6;display:block"></i>' : ''}${v}</span>
                </div>`).join('')}
            </div>

            
          </div>

          <div style="flex:1;padding:30px 34px 26px">
            <div class="mono-label">管理员登录</div>
            <h1 class="h2" style="font-size:24px;line-height:32px;margin-top:8px">登录后台</h1>
            <p class="sub" style="margin-top:6px">使用企业邮箱登录，登录行为会被记录。</p>

            <div style="margin-top:22px">
              <div class="mono-label">管理员账号</div>
              <div class="input is-focus" style="margin-top:7px">admin@kunqiong.cn</div>
            </div>
            <div style="margin-top:14px">
              <div class="mono-label">密码</div>
              <div class="input" style="margin-top:7px"><span class="mono" style="letter-spacing:.3em;font-size:13px">••••••••••</span><span style="margin-left:auto;color:var(--ink-4)">${icon('eyeOff', 16)}</span></div>
            </div>

            <div class="row between" style="margin-top:14px">
              <span class="row g6" style="font-size:13px;color:var(--ink-3)">${icon('shieldCheck', 14)}<span>已开启两步验证</span></span>
              <a href="#" class="link" style="font-size:13px;color:var(--ink-3)">忘记密码</a>
            </div>

            <button class="btn btn--primary btn--block" style="margin-top:18px;height:44px;font-size:14px">登录后台</button>

            <div class="row g8" style="margin-top:14px;padding-top:13px;border-top:1px solid var(--rule);color:var(--ink-4)">
              ${icon('lock', 14)}
              <span style="font-size:13px;line-height:19px">本次登录将记录 IP、设备与时间，用于安全审计。</span>
            </div>
          </div>
        </div>
        <div class="center" style="margin-top:18px"><a href="#" class="link" style="color:var(--ink-3);font-size:13px">${icon('arrowLeft', 12)} 返回官网</a></div>
      </div>
    </div>
  </div>`;
}

/* ---------- 31 管理员数据看板 ---------- */
function s31() {
  return `<div class="frame">${adminShell({
    active: '数据看板',
    title: '数据概览',
    sub: '统计截至 2026-10-19 14:30，每 5 分钟刷新一次。',
    actions: `${selectBox('近 7 天', 120)}<button class="btn btn--ghost btn--sm" style="height:32px">${icon('download', 13)}导出报表</button>`,
    body: `<div class="kpis" style="grid-template-columns:repeat(5,1fr)">
        ${[
          ['用户数', '12,486', '+3.2% 较上周', [3, 3.4, 3.1, 3.8, 4.2, 4.1, 4.6], ''],
          ['活跃资源', '3,842', '分享 2,418 · 收集 1,424', [4.2, 4.4, 4.1, 4.8, 4.6, 5.1, 5.2], ''],
          ['今日上传', '8.4 TB', '较昨日 +6.1%', [6, 6.8, 6.2, 7.4, 7, 7.8, 8.4], 'kpi--hl'],
          ['今日下载', '12.1 TB', '较昨日 −2.4%', [13, 13.8, 13.2, 14.4, 13.6, 15, 12.1], ''],
          ['团队空间', '486', '覆盖 9,120 位成员', [4.4, 4.5, 4.6, 4.6, 4.7, 4.8, 4.85], '']
        ].map(([k, v, d, sp, cls]) => `<div class="kpi ${cls}">
          <div class="k"><span>${k}</span></div>
          <div class="v">${v}</div>
          <div class="d">${d}</div>
          <div class="spark">${spark(sp, 104, 16, cls ? '#1677FF' : '#9EBBDF')}</div>
        </div>`).join('')}
      </div>

      <div style="display:flex;gap:16px;flex:0 0 300px">
        <div class="panel" style="flex:1.9;display:flex;flex-direction:column">
          <div class="panel-hd"><span class="h4">上传与下载趋势</span>
            <div class="row g14" style="font-family:var(--mono);font-size:13px;color:var(--ink-3)">
              <span class="row g6"><i style="width:14px;height:2px;background:var(--blue);display:inline-block"></i>上传 TB</span>
              <span class="row g6"><i style="width:14px;height:2px;background:#A9C6F0;display:inline-block"></i>下载 TB</span>
            </div>
          </div>
          <div style="padding:10px 12px 4px">
            ${trendChart({ w: 690, h: 230, max: 16, labels: ['10-13', '10-14', '10-15', '10-16', '10-17', '10-18', '10-19'], data: [9.2, 10.4, 9.8, 11.6, 10.9, 12.8, 8.4], data2: [12.1, 13.4, 12.8, 14.2, 13.1, 15.4, 12.1] })}
          </div>
        </div>

        <div class="panel" style="flex:1;display:flex;flex-direction:column">
          <div class="panel-hd"><span class="h4">资源状态</span><a href="#" class="link" style="font-size:13px">查看全部</a></div>
          <div style="padding:16px 18px 4px">
            <div class="row" style="height:10px;border-radius:2px;overflow:hidden;background:#EEF4FC">
              ${[['62', '#1677FF'], ['18', '#4D9CFF'], ['14', '#A9C6F0'], ['6', '#D6E4F7']].map(([p, c]) => `<i style="width:${p}%;background:${c};height:100%"></i>`).join('')}
            </div>
            <div class="row between mt8" style="font-family:var(--mono);font-size:13px;color:var(--ink-4)">
              <span>0</span><span>5,266 个资源</span>
            </div>
            <div class="col g0 mt14">
              ${[
                ['有效分享', '2,418', '#1677FF', '62%'],
                ['收集中', '1,424', '#4D9CFF', '18%'],
                ['已过期', '986', '#A9C6F0', '14%'],
                ['待清理', '438', '#D6E4F7', '6%']
              ].map(([k, n, c, p]) => `<div class="row between" style="padding:9px 0;border-bottom:1px solid var(--rule)">
                <span class="row g8"><i style="width:7px;height:7px;border-radius:1px;background:${c};display:inline-block"></i><span style="font-size:13px;color:var(--ink-3)">${k}</span></span>
                <span class="row g10"><span class="mono" style="font-size:13px;color:var(--ink)">${n}</span><span class="mono" style="font-size:13px;color:var(--ink-4);width:34px;text-align:right">${p}</span></span>
              </div>`).join('')}
            </div>
          </div>
          <div class="panel-ft" style="margin-top:auto">
            <span class="mono" style="font-size:13px;color:var(--ink-3)">存储占用</span>
            <span class="mono" style="font-size:13px;color:var(--ink)">62.4 / 100 TB</span>
          </div>
        </div>
      </div>

      <div class="panel" style="flex:1;display:flex;flex-direction:column;min-height:0">
        <div class="panel-hd"><span class="h4">最近审计日志</span><a href="#" class="link" style="font-size:13px">全部日志</a></div>
        <table class="table table--dense" style="flex:1">
          <thead><tr><th style="width:170px">时间</th><th style="width:170px">事件类型</th><th>操作内容</th><th style="width:150px">操作人</th><th style="width:130px">IP</th><th style="width:100px">状态</th></tr></thead>
          <tbody>
            ${[
              ['10-19 14:28:12', '管理员操作', '修改系统配置：默认保存时效 7 天', '张衡', '10.24.***.18', ['成功', 'ok']],
              ['10-19 14:12:46', '安全拦截', '拦截异常批量下载（同一 IP 请求 620 次）', '系统', '116.24.***.62', ['已拦截', 'bad']],
              ['10-19 13:52:03', '管理员操作', '禁用账号 user_88214', '李维', '10.24.***.22', ['成功', 'ok']],
              ['10-19 13:20:38', '访问记录', '导出资源清单（1,842 条）', '张衡', '10.24.***.18', ['成功', 'ok']],
              ['10-19 11:04:19', '安全拦截', '取件码连续错误 5 次，锁定 10 分钟', '系统', '58.62.***.41', ['已拦截', 'bad']]
            ].map(([t, k, c, who, ip, st]) => `<tr>
              <td class="mono" style="font-size:13px;color:var(--ink-3)">${t}</td>
              <td>${k === '安全拦截' ? tag('安全拦截', 'bad') : tag(k, 'mute')}</td>
              <td class="trunc" style="max-width:420px;font-size:13px">${c}</td>
              <td style="font-size:13px">${who}</td>
              <td class="mono" style="font-size:13px;color:var(--ink-3)">${ip}</td>
              <td>${tag(st[0], st[1], true)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`
  })}</div>`;
}

/* ---------- 32 管理员资源管理 ---------- */
function s32() {
  const res = [
    ['设计交付_2026Q3', ['分享', 'navy'], '李明', '有效', 3, '248.6 MB', '10-26 18:00'],
    ['2026 校招作品集收集', ['收集', 'mute'], '王清', '收集中', 18, '4.2 GB', '10-31 18:00'],
    ['品牌手册_v4.pdf', ['分享', 'navy'], '李明', '有效', 1, '42.4 MB', '10-26 18:00'],
    ['合同扫描件_2026', ['分享', 'navy'], '周雨桐', '已过期', 6, '18.4 MB', '10-15 09:00'],
    ['Q4 市场素材包', ['分享', 'navy'], '高维', '已关闭', 24, '1.8 GB', '—'],
    ['外包设计稿收集', ['收集', 'mute'], '林可', '收集中', 7, '620 MB', '11-02 20:00'],
    ['字体授权文件', ['分享', 'navy'], '许清和', '有效', 2, '640 KB', '10-25 10:00'],
    ['品牌视觉资产收集', ['收集', 'mute'], '周雨桐', '收集中', 12, '2.4 GB', '11-06 18:00'],
    ['Q3 复盘材料', ['分享', 'navy'], '吴桐', '有效', 5, '86.2 MB', '10-28 12:00']
  ];
  return `<div class="frame">${adminShell({
    active: '资源管理',
    title: '资源管理',
    sub: '共 3,842 个活跃资源，其中 986 个将在 7 天内过期。',
    actions: `<button class="btn btn--ghost btn--sm" style="height:32px">${icon('trash', 13)}批量清理</button><button class="btn btn--ghost btn--sm" style="height:32px">${icon('download', 13)}导出</button>`,
    body: `<div class="kpis" style="grid-template-columns:repeat(4,1fr);border-top:1px solid var(--ink-0)">
        <div class="kpi">
          <div class="k"><span>活跃资源</span></div>
          <div class="v">3,842<small>个</small></div>
          <div class="d">分享 2,418 · 收集 1,424</div>
        </div>
        <div class="kpi">
          <div class="k"><span>7 天内过期</span></div>
          <div class="v" style="color:var(--notice)">986<small>个</small></div>
          <div class="d">占总量 25.7%</div>
        </div>
        <div class="kpi">
          <div class="k"><span>今日新建</span></div>
          <div class="v">214<small>个</small></div>
          <div class="d">其中匿名上传 32 个</div>
        </div>
        <div class="kpi" style="border-right:0">
          <div class="k"><span>存储总量</span></div>
          <div class="v">42.6<small>TB</small></div>
          <div class="d">本月流入 3.8 TB</div>
        </div>
      </div>

      <div class="panel" style="flex:1;display:flex;flex-direction:column;min-height:0">
      <div class="toolbar" style="padding:11px 16px">
        <div class="row g8">
          ${searchBox('搜索资源名称或所属用户', 280)}
          ${selectBox('全部类型', 116)}
          ${selectBox('全部状态', 116)}
        </div>
        <span class="mono" style="font-size:13px;color:var(--ink-4)">按创建时间排序 ↓</span>
      </div>
      <table class="table">
        <thead><tr><th style="width:44px">No.</th><th style="width:300px">资源名称</th><th style="width:90px">类型</th><th style="width:130px">所属用户</th>
          <th style="width:100px">状态</th><th style="width:80px" class="r">文件数</th><th style="width:100px" class="r">大小</th>
          <th style="width:140px">有效期</th><th class="r">操作</th></tr></thead>
        <tbody>
        ${res.map(([n, ty, owner, st, cnt, size, exp], i) => `<tr>
          <td class="idx">${String(i + 1).padStart(2, '0')}</td>
          <td><div class="table__name"><span style="width:30px;height:36px;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;background:${ty[0] === '分享' ? '#EAF1FE' : '#EFF6F2'};border:1px solid ${ty[0] === '分享' ? '#D3E2FA' : '#D8E9E1'};color:${ty[0] === '分享' ? '#1256C4' : '#0A7048'}">${icon(ty[0] === '分享' ? 'send' : 'inbox', 15)}</span><span class="trunc" style="font-weight:500;color:var(--ink)">${n}</span></div></td>
          <td>${tag(ty[0], ty[1])}</td>
          <td style="font-size:13px">${owner}</td>
          <td>${st === '有效' || st === '收集中' ? tag(st, 'ok', true) : st === '已过期' ? tag(st, 'wait', true) : tag(st, 'mute', true)}</td>
          <td class="r num" style="font-size:13px">${cnt}</td>
          <td class="r num" style="font-size:13px">${size}</td>
          <td class="num" style="font-size:13px;color:var(--ink-3)">${exp}</td>
          <td class="r"><a href="#" class="link" style="font-size:13px">查看</a><span style="color:var(--line-2);margin:0 8px">|</span><a href="#" class="link" style="font-size:13px;color:var(--red)">删除</a></td>
        </tr>`).join('')}
        </tbody>
      </table>
      ${pagerBottom(3842)}
    </div>`
  })}</div>`;
}

/* ---------- 33 管理员用户管理 ---------- */
function s33() {
  const users = [
    ['李明', 'liming@studio.cn', ['会员版', ''], '12.4 GB / 50 GB', '今天 14:32', ['正常', 'ok']],
    ['王清', 'wangqing@studio.cn', ['团队版', 'navy'], '62.8 GB / 500 GB', '今天 13:05', ['正常', 'ok']],
    ['周雨桐', 'zhouyt@studio.cn', ['团队版', 'navy'], '48.2 GB / 500 GB', '今天 11:40', ['正常', 'ok']],
    ['高维', 'gaowei@studio.cn', ['基础版', 'mute'], '3.1 GB / 5 GB', '昨天 20:18', ['正常', 'ok']],
    ['陈亦然', 'chenyr@studio.cn', ['会员版', ''], '6.2 GB / 50 GB', '10-17 09:02', ['正常', 'ok']],
    ['吴桐', 'wutong@studio.cn', ['基础版', 'mute'], '4.9 GB / 5 GB', '10-15 16:44', ['已禁用', 'bad']],
    ['郑云', 'zhengyun@corp.cn', ['企业版', 'navy'], '1.2 TB / 不限', '10-14 10:20', ['正常', 'ok']],
    ['许清和', 'xuqh@studio.cn', ['会员版', ''], '2.6 GB / 50 GB', '10-13 19:32', ['正常', 'ok']],
    ['苏迟', 'suchi@outlook.com', ['基础版', 'mute'], '1.1 GB / 5 GB', '10-12 08:45', ['正常', 'ok']]
  ];
  return `<div class="frame">${adminShell({
    active: '用户管理',
    title: '用户管理',
    sub: '12,486 位注册用户 · 本周新增 328 位。',
    actions: `<button class="btn btn--ghost btn--sm" style="height:32px">${icon('download', 13)}导出用户</button>`,
    body: `<div class="kpis" style="grid-template-columns:repeat(4,1fr);border-top:1px solid var(--ink-0)">
        <div class="kpi">
          <div class="k"><span>注册用户</span></div>
          <div class="v">12,486<small>位</small></div>
          <div class="d">本周新增 328 位</div>
        </div>
        <div class="kpi">
          <div class="k"><span>付费用户</span><span class="mono" style="letter-spacing:0;color:var(--ink-3)">17.1%</span></div>
          <div class="v">2,140<small>位</small></div>
          <div class="d">会员 1,684 · 团队 402 · 企业 54</div>
        </div>
        <div class="kpi">
          <div class="k"><span>本月活跃</span></div>
          <div class="v">8,932<small>位</small></div>
          <div class="d">近 30 天有上传或下载</div>
        </div>
        <div class="kpi" style="border-right:0">
          <div class="k"><span>禁用账号</span></div>
          <div class="v">36<small>位</small></div>
          <div class="d">其中 12 位因违规分享</div>
        </div>
      </div>

      <div class="panel" style="flex:1;display:flex;flex-direction:column;min-height:0">
      <div class="toolbar" style="padding:11px 16px">
        <div class="row g8">
          ${searchBox('搜索账号、邮箱或手机号', 300)}
          ${selectBox('全部套餐', 120)}
          ${selectBox('全部状态', 116)}
        </div>
        <span class="mono" style="font-size:13px;color:var(--ink-4)">按最近登录排序 ↓</span>
      </div>
      <table class="table">
        <thead><tr><th style="width:44px">No.</th><th style="width:300px">账号</th><th style="width:120px">套餐等级</th><th style="width:210px">空间使用</th>
          <th style="width:150px">最近登录</th><th style="width:100px">状态</th><th class="r">操作</th></tr></thead>
        <tbody>
        ${users.map(([n, m, plan, use, t, st], i) => {
          const mm = use.match(/([\d.]+)\s*(GB|TB)\s*\/\s*([\d.]+)\s*(GB|TB)/);
          const pct = mm ? Math.min(100, Math.round(parseFloat(mm[1]) * (mm[2] === 'TB' ? 1024 : 1) / (parseFloat(mm[3]) * (mm[4] === 'TB' ? 1024 : 1)) * 100)) : 0;
          return `<tr>
          <td class="idx">${String(i + 1).padStart(2, '0')}</td>
          <td><div class="row g10">${avatar(n, 'avatar--sm')}<div><div style="font-size:13px;color:var(--ink);font-weight:500">${n}</div><div class="mono" style="font-size:13px;line-height:18px;color:var(--ink-4)">${m}</div></div></div></td>
          <td>${tag(plan[0], plan[1])}</td>
          <td><div class="row g8"><span class="mono" style="font-size:13px;white-space:nowrap;color:var(--ink-2)">${use}</span>${pct ? `<div class="bar bar--thin" style="width:56px"><i style="width:${pct}%"></i></div>` : ''}</div></td>
          <td class="num" style="font-size:13px;color:var(--ink-3)">${t}</td>
          <td>${tag(st[0], st[1], true)}</td>
          <td class="r"><a href="#" class="link" style="font-size:13px">查看</a><span style="color:var(--line-2);margin:0 8px">|</span>
            <a href="#" class="link" style="font-size:13px;color:${st[0] === '正常' ? 'var(--red)' : 'var(--blue-700)'}">${st[0] === '正常' ? '禁用' : '启用'}</a></td>
        </tr>`; }).join('')}
        </tbody>
      </table>
      ${pagerBottom(12486)}
    </div>`
  })}</div>`;
}

/* ---------- 34 管理员安全日志 ---------- */
function s34() {
  const logs = [
    ['10-19 14:12:46', '安全拦截', '拦截异常批量下载：同一 IP 10 分钟内请求 620 次', '已拦截', 'bad', '116.24.***.62'],
    ['10-19 13:52:03', '管理员操作', '禁用账号 user_88214（涉嫌违规分享）', '成功', 'ok', '10.24.***.22'],
    ['10-19 12:40:11', '访问记录', '运营账号登录后台（MFA 通过）', '成功', 'ok', '10.24.***.18'],
    ['10-19 11:04:19', '安全拦截', '取件码连续错误 5 次，链接锁定 10 分钟', '已拦截', 'bad', '58.62.***.41'],
    ['10-19 10:22:57', '管理员操作', '修改系统配置：匿名上传上限 2 GB → 1 GB', '成功', 'ok', '10.24.***.18'],
    ['10-19 09:48:02', '访问记录', '导出用户清单（12,158 条）', '成功', 'ok', '10.24.***.22'],
    ['10-19 03:12:36', '安全拦截', '检测到暴力破解尝试，来源 IP 已加入黑名单', '已拦截', 'bad', '45.133.***.7'],
    ['10-18 22:05:40', '访问记录', '内容扫描命中 1 个疑似侵权文件，已隔离', '待复核', 'wait', '系统'],
    ['10-18 17:31:09', '管理员操作', '为企业账号 corp_204 延长团队容量至 2 TB', '成功', 'ok', '10.24.***.18'],
    ['10-18 15:08:55', '访问记录', '批量下载审计日志（286 条）', '成功', 'ok', '10.24.***.22'],
    ['10-18 11:20:14', '管理员操作', '重置管理员 张衡 的登录密码', '成功', 'ok', '10.24.***.18'],
    ['10-18 09:05:37', '安全拦截', '拒绝来自高风险地区的取件请求（3 次）', '已拦截', 'bad', '103.21.***.9'],
    ['10-17 18:44:02', '访问记录', '查看团队空间「鲲穹设计中心」成员清单', '成功', 'ok', '10.24.***.22'],
    ['10-17 16:12:50', '管理员操作', '新增 IP 白名单：10.24.0.0/16', '成功', 'ok', '10.24.***.18']
  ];
  return `<div class="frame">${adminShell({
    active: '安全日志',
    title: '安全日志',
    sub: '记录安全拦截、管理员操作与访问行为，保留 180 天。',
    actions: `<button class="btn btn--ghost btn--sm" style="height:32px">${icon('download', 13)}导出日志</button>`,
    body: `<div class="panel" style="flex:1;display:flex;flex-direction:column;min-height:0">
        <div class="toolbar" style="padding:8px 16px;border-bottom:1px solid var(--ink-0)">
          <div class="row g6">
            ${[['全部', 286, 1], ['安全拦截', 42, 0], ['管理员操作', 118, 0], ['访问记录', 126, 0]].map(([t, c, on]) => `
              <span class="opt-row ${on}" style="height:30px;padding:0 11px;font-size:13px;gap:7px">${t}<b class="mono" style="font-weight:400;color:${on ? 'var(--blue-700)' : 'var(--ink-4)'}">${c}</b></span>`).join('')}
          </div>
          <div class="row g8">${selectBox('近 7 天', 116)}${searchBox('搜索 IP 或操作人', 220)}</div>
        </div>
        <table class="table table--dense">
          <thead><tr><th style="width:150px">时间</th><th style="width:130px">事件类型</th><th>操作内容</th>
            <th style="width:130px">来源 IP</th><th style="width:110px">状态</th><th class="r" style="width:90px">详情</th></tr></thead>
          <tbody>
          ${logs.map(([t, k, c, st, kind, ip]) => `<tr>
            <td class="mono" style="font-size:13px;color:var(--ink-3)">${t}</td>
            <td>${k === '安全拦截' ? tag(k, 'bad') : tag(k, 'mute')}</td>
            <td class="trunc" style="max-width:520px;font-size:13px;color:${kind === 'bad' ? 'var(--ink)' : 'var(--ink-2)'}">${c}</td>
            <td class="mono" style="font-size:13px;color:var(--ink-3)">${ip}</td>
            <td>${tag(st, kind, true)}</td>
            <td class="r"><a href="#" class="link" style="font-size:13px">查看</a></td>
          </tr>`).join('')}
          </tbody>
        </table>
        ${pagerBottom(286)}
      </div>`
  })}</div>`;
}

/* ---------- 35 管理员系统配置 ---------- */
function s35() {
  const cfgField = (label, val, unit, hint) => `<div style="padding:13px 0 12px;border-bottom:1px solid var(--rule)">
    <div class="row between" style="align-items:baseline">
      <span class="mono-label">${label}</span>
      <span class="mono" style="font-size:13px;color:var(--ink-4)">${unit}</span>
    </div>
    <div class="row between" style="align-items:baseline;margin-top:5px;border-bottom:1px dashed #B7CEEA;padding-bottom:5px">
      <span class="mono" style="font-size:18px;color:var(--ink-0);letter-spacing:-.01em">${val}</span>
      
    </div>
    ${hint ? `<div class="hint" style="margin-top:5px">${hint}</div>` : ''}
  </div>`;
  return `<div class="frame">${adminShell({
    active: '系统配置',
    title: '系统配置',
    sub: '修改后对新发起的传输生效，已在进行的分享不受影响。',
    actions: `<span class="mono" style="font-size:13px;color:var(--ink-4)">LAST EDIT 10-19 10:22 · 张衡</span>`,
    body: `<div style="display:flex;gap:16px;flex:1;min-height:0">
      <div style="flex:1" class="col g16">
        <div class="panel">
          <div class="panel-hd"><span class="h4">传输与保存策略</span><span class="tag tag--mute tag--mono" style="height:19px">全局</span></div>
          <div style="padding:2px 20px 14px;display:grid;grid-template-columns:1fr 1fr;gap:0 40px">
            ${cfgField('默认保存时效 / TTL', '7', '天', '用户未修改时使用')}
            ${cfgField('最大分享期限 / MAX', '90', '天', '含会员与团队版')}
            ${cfgField('审计日志保留 / LOG', '180', '天', '到期自动归档')}
            ${cfgField('匿名上传上限 / ANON', '2', 'GB', '未登录用户')}
            ${cfgField('批量文件数量 / BATCH', '200', '个', '超出需分批上传')}
            ${cfgField('超大文件阈值 / CHUNK', '5', 'GB', '低于阈值按整文件上传')}
          </div>
        </div>

        <div class="panel" style="flex:1;display:flex;flex-direction:column;min-height:0">
          <div class="panel-hd"><span class="h4">会员权益配置</span><span class="mono" style="font-size:13px;color:var(--ink-4)">4 PLANS</span></div>
          <div style="padding:0 20px 8px;display:flex;flex-direction:column;flex:1;min-height:0">
            <div class="row" style="height:32px;border-bottom:1px solid var(--ink-0);font-family:var(--mono);font-size:13px;letter-spacing:.04em;color:#6F849F">
              <span style="width:120px">套餐</span>
              <span style="flex:1">容量</span><span style="flex:1">单文件</span><span style="flex:1">时效</span>
            </div>
            ${[['基础版', '5 GB', '2 GB', '7 天'], ['会员版', '50 GB', '10 GB', '30 天'], ['团队版', '500 GB', '20 GB', '90 天'], ['企业版', '按合同', '不限', '自定义']].map(([n, a, b, c], i) => `
              <div class="row" style="flex:1;min-height:44px;border-bottom:${i === 3 ? '0' : '1px solid var(--rule)'}">
                <span style="width:120px;font-size:13px;color:var(--ink);font-weight:500">${n}</span>
                <span style="flex:1" class="mono num">${a}</span>
                <span style="flex:1" class="mono num">${b}</span>
                <span style="flex:1;color:var(--ink-3)" class="mono num">${c}</span>
              </div>`).join('')}
          </div>
        </div>
      </div>

      <div style="width:392px" class="col g16">
        <div class="panel">
          <div class="panel-hd"><span class="h4">维护模式</span><span class="tag tag--wait" style="height:19px">未启用</span></div>
          <div style="padding:14px 20px">
            <div class="switch-row" style="padding-top:0">
              <div><div class="t">启用维护模式</div><div class="d">官网与上传入口显示维护公告</div></div>
              <div class="sw"><i></i></div>
            </div>
            <div class="field mt10">
              <div class="mono-label">维护公告文案</div>
              <div class="input input--ta" style="min-height:64px;margin-top:6px"><span class="ph">例如：今晚 23:00—24:00 进行存储升级，期间上传会短暂失败。</span></div>
            </div>
            <div class="hint mt8">已登录用户仍可查看与下载已有文件。</div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-hd"><span class="h4">安全基线</span><span class="mono" style="font-size:13px;color:var(--ink-4)">3 / 4 ON</span></div>
          <div style="padding:4px 20px 10px">
            ${[['强制管理员两步验证', 1], ['禁止匿名下载可执行文件', 1], ['分享链接默认带提取密码', 0], ['限制单个 IP 每日下载量', 1]].map(([t, on], i) => `
              <div class="switch-row" style="border-bottom:${i === 3 ? '0' : '1px solid var(--rule)'}"><div class="t">${t}</div><div class="sw ${on ? 'on' : ''}"><i></i></div></div>`).join('')}
          </div>
        </div>

        <div class="panel" style="padding:14px 16px;border-left:2px solid var(--blue)">
          <div class="row g8"><span style="color:var(--blue)">${icon('alert', 15)}</span><span style="font-size:13px;color:var(--ink-2)">配置变更会记入审计日志</span></div>
          <p class="hint" style="margin-top:6px">保存后 1 分钟内下发到全部节点。</p>
        </div>
      </div>
    </div>
    <div class="row between" style="flex:0 0 auto;padding:12px 20px;background:#fff;border:1px solid var(--rule-2);border-left:2px solid var(--amber)">
      <span class="row g8"><i style="width:6px;height:6px;border-radius:50%;background:var(--amber);display:block"></i><span class="mono" style="font-size:13px;color:var(--ink-2)">3 项配置已修改 · 尚未保存</span></span>
      <div class="row g8"><button class="btn btn--ghost">放弃修改</button><button class="btn btn--primary">保存配置</button></div>
    </div>`
  })}</div>`;
}


/* ===== 36 邮件通知预览 + 画板注册 + 查看器 ===== */

function s36() {
  return `<div style="height:1024px;background:#EEF3FA;background-image:radial-gradient(circle at 1px 1px,rgba(10,27,51,.055) 1px,transparent 0);background-size:24px 24px;display:flex;align-items:center;justify-content:center">
    <div style="width:1056px;display:flex;gap:64px;align-items:flex-start">
      <aside style="width:328px;flex:0 0 328px;padding-top:14px">
        <div class="eyebrow eyebrow--ink">Notification / 09</div>
        <h1 class="h1" style="margin-top:12px;font-size:30px;line-height:38px">邮件通知</h1>
        <p class="lead" style="margin-top:9px;font-size:14px;line-height:23px">分享创建后，系统立即向接收人发送这封邮件。取件码与链接同时给出，二选一即可。</p>

        <div class="rule-hd" style="margin-top:24px"><span class="t">邮件规格</span></div>
        <div class="ledger">
          ${[
            ['触发事件', '分享创建成功'],
            ['发件人', 'no-reply@kunqiong.cn'],
            ['主题', '李明 向你分享了一个文件'],
            ['预header', '3 个文件 · 10 月 26 日到期'],
            ['模板宽度', '600 px · 单列']
          ].map(([k, v]) => `<div class="ledger__row" style="padding:9px 0"><span class="k">${k}</span><span class="v" style="font-size:13px;max-width:190px">${v}</span></div>`).join('')}
        </div>

        <div class="mt20">
          <div class="mono-label">可用变量</div>
          <div class="row wrap g6 mt8">
            ${['sender', 'title', 'count', 'size', 'expires', 'code', 'url'].map(v => `<span class="tag tag--mono tag--mute">{{${v}}}</span>`).join('')}
          </div>
        </div>

        <div class="sec-note" style="margin-top:20px">
          ${icon('mail', 15)}
          <span>邮件仅用于通知，不在邮件内直接附文件；取件码 6 位，有效期与分享设置一致。</span>
        </div>
      </aside>

      <div style="flex:1;min-width:0;display:flex;justify-content:center;position:relative">
        <div class="mail">
          <div style="height:2px;background:var(--blue)"></div>
          <div class="mail__hd" style="padding:16px 28px">
            ${brand()}
            <div class="right">
              <div class="mono" style="font-size:13px;color:var(--ink-4);letter-spacing:.06em">文件分享通知</div>
              <div class="mono" style="font-size:13px;color:var(--ink-4);margin-top:2px">2026-10-19 14:32</div>
            </div>
          </div>
          <div class="mail__bd" style="padding:26px 30px 26px">
            <div class="between">
              <span class="eyebrow">Incoming transfer</span>
              <span class="mono" style="font-size:13px;color:var(--ink-4)">NO. 2026-1019-4837</span>
            </div>
            <h1 style="font-size:22px;line-height:32px;font-weight:600;letter-spacing:-.02em;margin-top:10px">李明 向你分享了一个文件</h1>
            <p style="margin-top:9px;font-size:13.5px;line-height:22px;color:var(--ink-3)">你好，李明通过鲲穹向你分享了「设计交付_2026Q3」，共 3 个文件，合计 248.6 MB。请在 10 月 26 日 18:00 前下载。</p>

            <div style="margin-top:20px;border:1px solid #D6E3F4;border-radius:6px;overflow:hidden">
              <div style="padding:13px 16px;background:#F7FAFF;border-bottom:1px solid #E3ECF8">
                <div class="between">
                  <div style="font-size:13.5px;font-weight:600">设计交付_2026Q3</div>
                  <span class="mono" style="font-size:13px;color:var(--ink-4)">3 个文件</span>
                </div>
                <div class="mono" style="font-size:13px;color:var(--ink-4);margin-top:3px">248.6 MB · 有效期至 10 月 26 日 18:00</div>
              </div>
              <div style="padding:8px 16px">
                ${['品牌手册_v4.pdf', '设计交付_源文件.zip', '首页动效.fig'].map((n, i) => `
                  <div class="row g10" style="padding:8px 0;${i === 2 ? '' : 'border-bottom:1px solid #F1F5FB'}">
                    ${ftype(['pdf', 'zip', 'fig'][i])}
                    <span style="flex:1;font-size:13px;color:var(--ink-2)">${n}</span>
                    <span class="mono" style="font-size:13px;color:var(--ink-4)">${['42.4 MB', '186.2 MB', '20.0 MB'][i]}</span>
                  </div>`).join('')}
              </div>
              <div style="padding:0 16px 14px">
                <div class="row between" style="padding:11px 14px;border:1px dashed #C9D9F0;border-radius:5px;background:#FBFDFF">
                  <div>
                    <div class="mono-label" style="font-size:13px">取件码</div>
                    <div class="mono" style="font-size:20px;letter-spacing:.14em;margin-top:3px;color:var(--ink)">483 917</div>
                  </div>
                  <div class="right">
                    <div class="mono-label" style="font-size:13px">或打开链接</div>
                    <div class="mono" style="font-size:13px;color:var(--ink-2);margin-top:4px">kunqiong.cn/s/7Kd2mQ</div>
                  </div>
                </div>
              </div>
            </div>

            <div style="margin-top:20px" class="row g10">
              <a href="#" style="display:inline-flex;align-items:center;gap:8px;height:42px;padding:0 20px;background:var(--blue);color:#fff;border-radius:7px;text-decoration:none;font-size:14px;font-weight:500">查看并下载 ${icon('arrowRight', 16)}</a>
              <span class="mono" style="font-size:13px;color:var(--ink-4)">按钮链接带签名，30 天内有效</span>
            </div>

            <div style="margin-top:18px;padding-top:13px;border-top:1px solid var(--line)" class="row g8">
              <span style="color:var(--green);margin-top:2px">${icon('shieldCheck', 14)}</span>
              <span style="font-size:13px;line-height:18px;color:var(--ink-4)">文件已通过病毒扫描，传输与存储全程加密。链接到期后文件自动删除，无需手动清理。</span>
            </div>
          </div>
          <div class="mail__ft">
            <div>这是一封系统通知邮件，请勿直接回复。需要帮助？联系 support@kunqiong.cn</div>
            <div class="row between" style="margin-top:8px">
              <span>鲲穹 · 企业文件传输 · 上海市徐汇区</span>
              <span><a href="#" style="color:var(--ink-4)">邮件偏好</a> · <a href="#" style="color:var(--ink-4)">退订</a></span>
            </div>
          </div>
        </div>
        <div class="mono" style="position:absolute;left:50%;bottom:-26px;transform:translateX(-50%);font-size:13px;color:#93A8C2;letter-spacing:.08em;white-space:nowrap">600 × AUTO · DESKTOP</div>
      </div>
    </div>
  </div>`;
}

const s01 = () => `<div class="frame">${sendHomeBody()}</div>`;

/* ---------- 画板清单 ---------- */
const SCREENS = [
  { id: 1, g: '发送与取件', name: '首页 · 发文件空状态', fn: s01 },
  { id: 2, g: '发送与取件', name: '首页 · 取件码弹窗', fn: s02 },
  { id: 3, g: '接收与分享', name: '访客分享页', fn: s03 },
  { id: 4, g: '接收与分享', name: '分享密码验证', fn: s04 },
  { id: 5, g: '团队空间', name: '团队邀请落地页', fn: s05 },
  { id: 6, g: '发送与取件', name: '登录后发文件', fn: s06 },
  { id: 7, g: '发送与取件', name: '分享设置弹窗', fn: s07 },
  { id: 8, g: '发送与取件', name: '上传队列', fn: s08 },
  { id: 9, g: '发送与取件', name: '上传进度与安全扫描', fn: s09 },
  { id: 10, g: '发送与取件', name: '分享结果', fn: s10 },
  { id: 11, g: '发送与取件', name: '二维码预览弹窗', fn: s11 },
  { id: 12, g: '文件收集', name: '创建收集任务', fn: s12 },
  { id: 13, g: '文件收集', name: '收集任务管理', fn: s13 },
  { id: 14, g: '文件收集', name: '登录用户提交文件', fn: s14 },
  { id: 15, g: '文件收集', name: '匿名提交文件', fn: s15 },
  { id: 16, g: '接收与分享', name: '收发记录', fn: s16 },
  { id: 17, g: '接收与分享', name: '文件管理中心', fn: s17 },
  { id: 18, g: '账户与会员', name: '会员与套餐', fn: s18 },
  { id: 19, g: '账户与会员', name: '升级支付弹窗', fn: s19 },
  { id: 20, g: '账户与会员', name: '我的订单', fn: s20 },
  { id: 21, g: '账户与会员', name: '个人资料设置', fn: s21 },
  { id: 22, g: '账户与会员', name: '账号与安全', fn: s22 },
  { id: 23, g: '账户与会员', name: '消息通知设置', fn: s23 },
  { id: 24, g: '接收与分享', name: '分享管理', fn: s24 },
  { id: 25, g: '团队空间', name: '团队空间 · 所有者', fn: s25 },
  { id: 26, g: '团队空间', name: '团队成员', fn: s26 },
  { id: 27, g: '团队空间', name: '成员操作菜单', fn: s27 },
  { id: 28, g: '团队空间', name: '入团申请', fn: s28 },
  { id: 29, g: '账户与会员', name: '消息中心', fn: s29 },
  { id: 30, g: '运营后台', name: '管理员登录', fn: s30 },
  { id: 31, g: '运营后台', name: '数据看板', fn: s31 },
  { id: 32, g: '运营后台', name: '资源管理', fn: s32 },
  { id: 33, g: '运营后台', name: '用户管理', fn: s33 },
  { id: 34, g: '运营后台', name: '安全日志', fn: s34 },
  { id: 35, g: '运营后台', name: '系统配置', fn: s35 },
  { id: 36, g: '邮件模板', name: '邮件通知预览', fn: s36 }
];

/* ---------- 页面挂载 ---------- */
function boot(id) {
  const screen = SCREENS.find(x => x.id === id) || SCREENS[0];
  const frame = document.getElementById('frame');
  if (!frame) return;
  document.body.dataset.page = screen.id;
  document.title = screen.name.replace(/ · /g, ' ') + ' · 鲲穹文件传输';
  frame.innerHTML = screen.fn();
  if (typeof polishText === 'function') polishText(frame);
  if (typeof bindLinks === 'function') bindLinks(frame);
  if (typeof motionEnter === 'function') motionEnter(frame);
  if (typeof fitPage === 'function') fitPage();
}


/* ============================================================
   页面运行时 · 跳转绑定 / 进场编排 / 微交互
   ============================================================ */

const MOTION_Q = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function motionReduced() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* ---------- 按真实页面结构做跳转 ---------- */
const LINK_ROUTES = {
  '发文件': 'index.html',
  '发送文件': 'index.html',
  '我的文件': 'records.html',
  '返回首页': 'index.html',
  '返回官网': 'index.html',
  '返回工作台': 'index.html',
  '登录': 'send-files.html',
  '切换账号': 'index.html',
  '收集文件': 'collect.html',
  '收集任务': 'collect.html',
  '收发记录': 'records.html',
  '文件管理': 'files.html',
  '团队空间': 'team.html',
  '进入空间': 'team.html',
  '个人资料': 'settings-profile.html',
  '账号与安全': 'settings-security.html',
  '消息通知': 'settings-notice.html',
  '我的订单': 'settings-orders.html',
  '订单记录': 'settings-orders.html',
  '会员与套餐': 'plan.html',
  '管理套餐': 'plan.html',
  '先了解团队版': 'plan.html',
  '价格': 'plan.html',
  '取件码取文件': 'retrieve.html',
  '粘贴取件码': 'retrieve.html',
  '查看登录记录': 'settings-security.html',
  '查看二维码': 'send-result-qr.html',
  '查看全部': 'records.html',
  '全部日志': 'admin-logs.html',
  '邮件偏好': 'settings-notice.html',
  '管理推送通道': 'settings-notice.html',
  '修改分享设置': 'send-settings.html',
  '全部记录': 'records.html',
  '查看统计': 'records.html',
  '数据看板': 'admin-dashboard.html',
  '资源管理': 'admin-resources.html',
  '用户管理': 'admin-users.html',
  '安全日志': 'admin-logs.html',
  '系统配置': 'admin-config.html'
};

const BTN_ROUTES = {
  '选择文件': 'send-files.html',
  '选择文件夹': 'send-files.html',
  '把文件拖到这里': 'send-files.html',
  '开始上传': 'send-uploading.html',
  '发送文件': 'send-uploading.html',
  '分享设置': 'send-settings.html',
  '创建收集任务': 'collect-manage.html',
  '登录后台': 'admin-dashboard.html',
  '加入团队': 'team.html',
  '接受邀请': 'team.html',
  '登录并申请加入': 'team.html',
  '验证并打开': 'share.html',
  '立即升级': 'plan-pay.html',
  '升级': 'plan-pay.html',
  '续费': 'plan-pay.html',
  '续费一年': 'plan-pay.html',
  '升级团队版': 'plan-pay.html',
  '创建任务': 'collect-manage.html',
  '输入取件码': 'retrieve.html',
  '查看二维码': 'send-result-qr.html',
  '我已完成支付': 'settings-orders.html',
  '取消上传': 'index.html'
};

/* 同一文案在不同页面指向不同状态 */
const PAGE_BTN = {
  '6': { '选择文件': 'send-queue.html', '选择文件夹': 'send-queue.html' },
  '8': { '开始上传': 'send-uploading.html' }
};

function leaveTo(href) {
  if (!href) return;
  if (motionReduced()) { window.location.href = href; return; }
  document.body.classList.add('is-leaving');
  setTimeout(() => { window.location.href = href; }, 140);
}

window.addEventListener('pageshow', () => document.body.classList.remove('is-leaving'));

function bindLinks(root) {
  if (!root) return;

  /* 站内链接：先播退场再跳，避免白屏硬切 */
  root.querySelectorAll('a[href$=".html"]').forEach(a => {
    a.addEventListener('click', e => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      leaveTo(a.getAttribute('href'));
    });
  });

  root.querySelectorAll('a[href="#"]').forEach(a => {
    const text = a.textContent.replace(/\s+/g, ' ').trim();
    const to = LINK_ROUTES[text];
    if (to) {
      a.setAttribute('href', to);
      return;
    }
    a.addEventListener('click', e => e.preventDefault());
  });

  root.querySelectorAll('button').forEach(b => {
    const text = b.textContent.replace(/\s+/g, ' ').trim();
    const page = document.body.dataset.page;
    const to = (PAGE_BTN[page] && PAGE_BTN[page][text]) || BTN_ROUTES[text];
    if (!to) return;
    b.addEventListener('click', e => {
      e.preventDefault();
      leaveTo(to);
    });
  });
}

/* 文本整理：界面短句不留句末句号，标题不背标点 */
function polishText(root) {
  if (!root) return;
  const UI = 'h1,h2,h3,h4,h5,.h1,.h2,.h3,.h4,.lead,.sub,.hint,.label,.tag,.btn,a,button,dt,dd,li,' +
             '.mono-label,.eyebrow,.kpi,.spec__row,.ledger__row,.receipt__cell,.manifest__meta,.cell,.k,.d';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const hits = [];
  while (walker.nextNode()) hits.push(walker.currentNode);
  hits.forEach(n => {
    const raw = n.nodeValue;
    if (!raw || !/。\s*$/.test(raw)) return;
    const p = n.parentElement;
    if (!p || p.closest('script,style,textarea')) return;
    if (p.closest(UI) || raw.trim().length <= 24) n.nodeValue = raw.replace(/。\s*$/, '');
  });
}

/* ---------- 进场：版块 / 容器 / 行 三层节奏 ---------- */
const SEL_A = '.page-hd,.pub-body>*,.abody>*,.container.page>.col>*,.set-main>*';
const SEL_B = '.panel,.sheet,.kpis,.manifest,.receipt,.intake,.blueprint,.statstrip,.feat3,.settings,.paper';
const SEL_C = '.manifest__row,.filerow,.table tbody tr,.kpi,.step';

function motionEnter(frame) {
  if (!frame || motionReduced()) return;

  const marked = new WeakSet();
  const mark = (el, cls, delay) => {
    if (!el || marked.has(el)) return;
    if (el.closest('.topbar,.arail,.abar,.set-rail,.scrim')) return;
    marked.add(el);
    el.style.setProperty('--d', Math.round(delay) + 'ms');
    el.classList.add(cls);
  };

  const blocks = MOTION_Q(SEL_A, frame).filter(el => !el.closest('.topbar'));
  blocks.forEach((a, ai) => {
    const base = Math.min(ai, 5) * 60;
    mark(a, 'm-rise', base);
    MOTION_Q(SEL_B, a).forEach((el, i) => mark(el, 'm-fade', base + 60 + Math.min(i, 6) * 28));
    MOTION_Q(SEL_C, a).slice(0, 14).forEach((el, i) => mark(el, 'm-row', base + 90 + i * 16));
  });

  /* 进度条从 0 推到目标值 */
  MOTION_Q('.bar>i,.kpi__bar>i', frame).forEach(el => {
    const target = el.style.width;
    if (!target || target === '0%') return;
    el.style.transition = 'none';
    el.style.width = '0%';
    void el.offsetWidth;
    el.style.transition = '';
    requestAnimationFrame(() => { el.style.width = target; });
  });
}

/* ---------- 弹窗退场 ---------- */
function closeModal(modal) {
  if (!modal || modal.classList.contains('is-out')) return;
  const scrim = document.querySelector('.scrim');
  modal.classList.add('is-out');
  if (scrim) scrim.classList.add('is-out');
  setTimeout(() => {
    modal.remove();
    if (scrim) scrim.remove();
  }, 180);
}

document.addEventListener('click', e => {
  const hit = e.target.closest('.modal-x') || e.target.closest('.scrim');
  if (!hit) return;
  const modal = document.querySelector('.modal');
  if (modal) closeModal(modal);
  else window.history.length > 1 ? window.history.back() : (window.location.href = 'index.html');
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const modal = document.querySelector('.modal');
  if (modal) closeModal(modal);
});

/* 视口不足 1440 时整体缩排，不做拉伸 */
function fitPage() {
  const frame = document.getElementById('frame');
  if (!frame) return;
  const viewport = document.documentElement.clientWidth || window.innerWidth;
  const scale = Math.min(1, viewport / 1440);
  frame.style.zoom = scale === 1 ? '' : String(scale);
}
window.addEventListener('resize', fitPage);
