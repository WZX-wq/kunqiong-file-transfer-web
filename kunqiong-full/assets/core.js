/* 鲲穹文件传输 · 原型运行时：图标、布局、路由、页面索引 */
(function () {
  "use strict";

  var ICONS = {
    send: '<path d="M21.5 12 3 4.5l3.2 7.5L3 19.5 21.5 12Z"/><path d="m6.2 12 8.6 0"/>',
    inbox: '<path d="M4 13.5V7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v6.5"/><path d="M4 13.5h4l1.4 2.2h5.2L16 13.5h4v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4Z"/>',
    history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4.5V9H8"/><path d="M12 8v4.4l2.9 1.7"/>',
    users: '<path d="M16.6 20v-1.6a3.6 3.6 0 0 0-3.6-3.6H6.6A3.6 3.6 0 0 0 3 18.4V20"/><circle cx="9.8" cy="8" r="3.4"/><path d="M21 20v-1.6a3.6 3.6 0 0 0-2.7-3.5"/><path d="M15.4 4.6a3.4 3.4 0 0 1 0 6.6"/>',
    crown: '<path d="m4 8 3.6 3L12 5l4.4 6L20 8l-1.3 9.4H5.3L4 8Z"/>',
    settings: '<circle cx="12" cy="12" r="3.1"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.9 19a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H2a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 3.7 7.9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H8a1.6 1.6 0 0 0 1-1.5V2a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V8a1.6 1.6 0 0 0 1.5 1H22a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/>',
    bell: '<path d="M18 8.5a6 6 0 1 0-12 0c0 7-3 8.5-3 8.5h18s-3-1.5-3-8.5"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    user: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20.5a7 7 0 0 1 14 0"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.4-3.4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    upload: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 16v2.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V16"/>',
    download: '<path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M4 16v2.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V16"/>',
    folder: '<path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h3.2l2 2.4H18a2.5 2.5 0 0 1 2.5 2.5v6.6a2.5 2.5 0 0 1-2.5 2.5H6a2.5 2.5 0 0 1-2.5-2.5V7.5Z"/>',
    file: '<path d="M14 3.5H7A2 2 0 0 0 5 5.5v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5l-5-5Z"/><path d="M14 3.5v5h5"/>',
    fileText: '<path d="M14 3.5H7A2 2 0 0 0 5 5.5v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5l-5-5Z"/><path d="M14 3.5v5h5M8 13h8M8 17h5"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
    trash: '<path d="M4 7h16M9 7V4.8h6V7M6.5 7l.8 13a1.8 1.8 0 0 0 1.8 1.7h5.8a1.8 1.8 0 0 0 1.8-1.7L18 7"/><path d="M10 11v6M14 11v6"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2.2"/><path d="M15 9V6.2A2.2 2.2 0 0 0 12.8 4H6.2A2.2 2.2 0 0 0 4 6.2v6.6A2.2 2.2 0 0 0 6.2 15H9"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    chevronRight: '<path d="m9 5 7 7-7 7"/>',
    chevronLeft: '<path d="m15 5-7 7 7 7"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.4"/><path d="M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7"/>',
    shield: '<path d="M12 3.2 5 6v5.4c0 4.4 3 7.9 7 9.4 4-1.5 7-5 7-9.4V6l-7-2.8Z"/><path d="m9 12 2.2 2.2L15.4 10"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.4V12l3.2 1.9"/>',
    calendar: '<rect x="3.5" y="5.5" width="17" height="15" rx="2.4"/><path d="M8 3.5v4M16 3.5v4M3.5 10.5h17"/>',
    link: '<path d="M10.2 13.8 13.8 10.2"/><path d="m9.4 7.2 1.3-1.3a3.7 3.7 0 0 1 5.2 5.2l-1.3 1.3"/><path d="m14.6 16.8-1.3 1.3a3.7 3.7 0 0 1-5.2-5.2l1.3-1.3"/>',
    qr: '<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1"/><path d="M14 14h3v3h-3zM20.5 14v3M14 20.5h6.5"/>',
    mail: '<rect x="3" y="5.5" width="18" height="13" rx="2.4"/><path d="m3.5 7 8.5 6 8.5-6"/>',
    card: '<rect x="3" y="5.5" width="18" height="13" rx="2.4"/><path d="M3 10h18M6.5 15h4"/>',
    database: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
    sliders: '<path d="M5 20V14M5 10V4M12 20v-8M12 8V4M19 20v-4M19 12V4"/><path d="M2.8 14h4.4M9.8 8h4.4M16.8 16h4.4"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    logout: '<path d="M9 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3"/><path d="m15 16 4-4-4-4M19 12H9"/>',
    refresh: '<path d="M20 11.5A8 8 0 0 0 6.3 6.3L4 8.5"/><path d="M4 4v4.5h4.5"/><path d="M4 12.5a8 8 0 0 0 13.7 5.2L20 15.5"/><path d="M20 20v-4.5h-4.5"/>',
    alert: '<circle cx="12" cy="12" r="8.6"/><path d="M12 8v4.6M12 16h.01"/>',
    info: '<circle cx="12" cy="12" r="8.6"/><path d="M12 11v5M12 8h.01"/>',
    checkCircle: '<circle cx="12" cy="12" r="8.6"/><path d="m8.4 12.2 2.4 2.4 4.8-4.8"/>',
    external: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v4.5A2.5 2.5 0 0 1 15.5 21h-9A2.5 2.5 0 0 1 4 18.5v-9A2.5 2.5 0 0 1 6.5 7H11"/>',
    play: '<path d="m8 5 11 7-11 7V5Z"/>',
    pause: '<path d="M9 5v14M15 5v14"/>',
    sparkles: '<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z"/><path d="M19 15.5 19.8 18l2.5.8-2.5.8-.8 2.4-.8-2.4-2.4-.8 2.4-.8.8-2.5Z"/>',
    drive: '<rect x="3" y="4.5" width="18" height="6" rx="2"/><rect x="3" y="13.5" width="18" height="6" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
    key: '<circle cx="8.2" cy="9.2" r="3.6"/><path d="m10.8 12 8.2 8.2M16 17.2l1.8-1.8M18.6 19.8l1.8-1.8"/>',
    message: '<path d="M20.5 12a8.5 8.5 0 0 1-12.4 7.5L3.5 21l1.6-4.4A8.5 8.5 0 1 1 20.5 12Z"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    arrowLeft: '<path d="M20 12H4M10 6l-6 6 6 6"/>',
    arrowRight: '<path d="M4 12h16M14 6l6 6-6 6"/>',
    globe: '<circle cx="12" cy="12" r="8.6"/><path d="M3.4 12h17.2M12 3.4c2.4 2.3 3.6 5.3 3.6 8.6S14.4 18.3 12 20.6c-2.4-2.3-3.6-5.3-3.6-8.6S9.6 5.7 12 3.4Z"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.4"/><circle cx="9" cy="9.6" r="1.6"/><path d="m4.5 17 4.8-4.8 4 4 2.4-2.4 3.8 3.8"/>',
    video: '<rect x="3" y="5.5" width="12.5" height="13" rx="2.4"/><path d="m15.5 10.5 5-3v9l-5-3"/>',
    archive: '<rect x="3.5" y="4.5" width="17" height="4.5" rx="1.4"/><path d="M5 9v9.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V9"/><path d="M10 13h4"/>',
    code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>',
    building: '<rect x="4.5" y="3.5" width="15" height="17" rx="2"/><path d="M8.5 8h2M13.5 8h2M8.5 12h2M13.5 12h2M10 20.5v-3.5h4v3.5"/>',
    userPlus: '<circle cx="9.5" cy="8" r="3.5"/><path d="M3.5 20a6 6 0 0 1 12 0"/><path d="M18.5 8v6M15.5 11h6"/>',
    userCheck: '<circle cx="9.5" cy="8" r="3.5"/><path d="M3.5 20a6 6 0 0 1 12 0"/><path d="m16.5 11 2 2 4-4"/>',
    pencil: '<path d="m4 20 4.5-1 9.6-9.6a2.2 2.2 0 0 0-3.1-3.1L5.4 15.9 4 20Z"/><path d="m13.8 7.4 3 3"/>',
    filter: '<path d="M4 5.5h16l-6.2 7.2V19l-3.6-2v-4.3L4 5.5Z"/>',
    zap: '<path d="m13.5 2.5-8 11h6l-1 8 8-11h-6l1-8Z"/>',
    globe2: '<circle cx="12" cy="12" r="8.6"/><path d="M3.4 12h17.2M12 3.4a13 13 0 0 1 0 17.2 13 13 0 0 1 0-17.2Z"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.4"/><path d="M10.6 5.2h2.8M11 18.6h2"/>',
    scan: '<path d="M4 8.5V6a2 2 0 0 1 2-2h2.5M15.5 4H18a2 2 0 0 1 2 2v2.5M20 15.5V18a2 2 0 0 1-2 2h-2.5M8.5 20H6a2 2 0 0 1-2-2v-2.5"/><path d="M4 12h16"/>',
    creditCard: '<rect x="3" y="5.5" width="18" height="13" rx="2.4"/><path d="M3 10h18M7 15h3"/>',
    wallet: '<path d="M20 8.5V7a2 2 0 0 0-2-2H5.5A2.5 2.5 0 0 0 3 7.5v9A2.5 2.5 0 0 0 5.5 19H18a2 2 0 0 0 2-2v-1.5"/><path d="M21 9.5h-4.5a2.5 2.5 0 0 0 0 5H21v-5Z"/>',
    trend: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    sidebar: '<rect x="3" y="4" width="18" height="16" rx="2.4"/><path d="M9 4v16"/>',
    home: '<path d="m3.5 10.5 8.5-7 8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5.5h4V20"/>',
    minimize: '<path d="M4 14h6v6M20 10h-6V4"/>',
    maximize: '<path d="M9 4H4v5M15 20h5v-5"/>',
    share: '<circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="6" r="2.6"/><circle cx="18" cy="18" r="2.6"/><path d="m8.4 10.8 7.2-3.6M8.4 13.2l7.2 3.6"/>',
    xCircle: '<circle cx="12" cy="12" r="8.6"/><path d="m9.5 9.5 5 5M14.5 9.5l-5 5"/>',
    alertTriangle: '<path d="M12 3.8 21 20H3l9-16.2Z"/><path d="M12 9.5v4.4M12 17h.01"/>',
    helpCircle: '<circle cx="12" cy="12" r="8.6"/><path d="M9.6 9.4a2.5 2.5 0 0 1 4.9.7c0 1.7-2.5 2-2.5 3.6M12 17h.01"/>',
    fileCheck: '<path d="M14 3.5H7A2 2 0 0 0 5 5.5v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5l-5-5Z"/><path d="M14 3.5v5h5"/><path d="m8.6 14.6 2 2 3.8-3.8"/>',
    server: '<rect x="3.5" y="4" width="17" height="7" rx="2"/><rect x="3.5" y="13" width="17" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
    puzzle: '<path d="M9 4.5h2a1.8 1.8 0 1 1 3.6 0h2.4a1 1 0 0 1 1 1V8a1.8 1.8 0 1 1 0 3.6v2.4a1 1 0 0 1-1 1H15a1.8 1.8 0 1 0-3.6 0H7a1 1 0 0 1-1-1V9.4a1.8 1.8 0 1 0 0-3.6V5.5a1 1 0 0 1 1-1Z"/>'
  };

  function icon(name, size) {
    size = size || 16;
    var body = ICONS[name] || ICONS.file;
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
  }

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fmtBytes(n) {
    n = Number(n) || 0;
    if (!n) return "0 B";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
    return (n / 1024 / 1024 / 1024).toFixed(2) + " GB";
  }

  function qrSvg(seed, size) {
    var n = 25, cell = 6, total = n * cell, s = Number(seed) || 20261020;
    function rnd() { s = (s * 9301 + 49297) % 233280; return s / 233280; }
    function finder(x, y) {
      return '<rect x="' + (x * cell) + '" y="' + (y * cell) + '" width="' + (7 * cell) + '" height="' + (7 * cell) + '" rx="2" fill="#0f1b2d"/>' +
        '<rect x="' + ((x + 1) * cell) + '" y="' + ((y + 1) * cell) + '" width="' + (5 * cell) + '" height="' + (5 * cell) + '" fill="#fff"/>' +
        '<rect x="' + ((x + 2) * cell) + '" y="' + ((y + 2) * cell) + '" width="' + (3 * cell) + '" height="' + (3 * cell) + '" fill="#0f1b2d"/>';
    }
    var rects = "";
    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        var inFinder = (x < 7 && y < 7) || (x > n - 8 && y < 7) || (x < 7 && y > n - 8);
        if (inFinder) continue;
        if (rnd() > 0.55) rects += '<rect x="' + (x * cell) + '" y="' + (y * cell) + '" width="' + cell + '" height="' + cell + '" fill="#0f1b2d"/>';
      }
    }
    return '<svg viewBox="0 0 ' + total + ' ' + total + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="二维码" style="width:' + (size || "100%") + ';height:auto;display:block">' +
      finder(0, 0) + finder(n - 7, 0) + finder(0, n - 7) + rects + '</svg>';
  }

  var PAGES = [];
  function register(list) {
    list.forEach(function (p) { PAGES.push(p); });
  }

  var GROUPS = [
    { key: "send", label: "01 · 发送与取件" },
    { key: "share", label: "02 · 接收与分享管理" },
    { key: "collect", label: "03 · 文件收集" },
    { key: "records", label: "04 · 记录与消息" },
    { key: "account", label: "05 · 账户与设置" },
    { key: "space", label: "06 · 会员与团队" },
    { key: "admin", label: "07 · 运营后台" },
    { key: "help", label: "08 · 帮助与规则" }
  ];

  function groupLabel(key) {
    for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i].key === key) return GROUPS[i].label;
    return key;
  }

  function isEmbed() { return /[?&]embed=1/.test(location.search); }
  function isStatic() { return /[?&]static=1/.test(location.search); }

  function topbar(active, opts) {
    opts = opts || {};
    var items = [
      ["send-home", "send", "发文件"],
      ["collect-create", "collect", "收集文件"],
      ["records", "records", "收发记录"],
      ["workspace", "space", "会员与团队"]
    ];
    var nav = items.map(function (it) {
      return '<a href="#/' + it[0] + '" class="' + (it[1] === active ? "active" : "") + '">' + it[2] + '</a>';
    }).join("");
    return '<header class="topbar"><div class="wrap topbar-in">' +
      '<a class="brand" href="#/send-home"><img class="brand-mark" src="assets/icons/ico-cloud.png" alt=""/><span>鲲穹文件传输</span><i class="ver-pill">58 屏全量版</i></a>' +
      '<nav class="nav">' + nav + '</nav>' +
      '<div class="top-actions">' +
      '<a class="icon-btn" href="#/help" title="帮助中心">' + icon("search", 18) + '</a>' +
      '<a class="icon-btn" href="#/messages" title="消息中心">' + icon("bell", 18) + '<i class="dot-badge"></i></a>' +
      '<div class="user"><button class="avatar-btn" id="userBtn" aria-label="账户菜单"><img src="assets/icons/ico-user.png" alt=""/></button>' +
      '<div class="user-menu" id="userMenu">' +
      '<div class="um-head"><b>林敬轩</b><span>linjx@kunqiong.cn · 会员版</span></div>' +
      '<a href="#/settings-profile">' + icon("user", 15) + '个人资料</a>' +
      '<a href="#/settings-orders">' + icon("fileText", 15) + '我的订单</a>' +
      '<a href="#/workspace">' + icon("crown", 15) + '会员与团队</a>' +
      '<a href="#/admin-dashboard">' + icon("shield", 15) + '运营后台</a>' +
      '<hr/><a href="#/login">' + icon("logout", 15) + '退出登录</a>' +
      '</div></div></div></div></header>';
  }

  function publicTop(right) {
    return '<header class="public-top"><div class="wrap topbar-in" style="height:62px;gap:16px">' +
      '<a class="brand" href="#/send-home"><img class="brand-mark" src="assets/icons/ico-cloud.png" alt=""/><span>鲲穹文件传输</span><i class="ver-pill">58 屏全量版</i></a>' +
      '<div class="right">' + (right || '<a href="#/help" style="color:#7d8ea6">使用帮助</a><a class="btn ghost sm" href="#/login">登录</a>') + '</div>' +
      '</div></header>';
  }

  function footer() {
    return '<footer class="site-foot"><div class="wrap in"><span>© 2026 鲲穹文件传输 · 让文件传输更简单</span>' +
      '<span class="links"><a href="#/help">帮助中心</a><a href="#/terms">服务协议</a><a href="#/privacy">隐私政策</a><a href="#/email">邮件通知</a></span></div></footer>';
  }

  function settingsNav(active) {
    var items = [
      ["settings-profile", "profile", "个人资料", "user"],
      ["settings-security", "security", "账号与安全", "shield"],
      ["settings-notice", "notice", "消息通知", "bell"],
      ["settings-cleanup", "cleanup", "文件清理", "trash"],
      ["settings-orders", "orders", "我的订单", "fileText"]
    ];
    return '<aside class="side-nav"><div class="sn-user"><span class="avatar">林</span><div><b>林敬轩</b><small>会员版 · 至 2027-06-18</small></div></div>' +
      items.map(function (it) {
        return '<a href="#/' + it[0] + '" class="' + (it[1] === active ? "active" : "") + '">' + icon(it[3], 16) + it[2] + '</a>';
      }).join("") +
      '<div class="sn-foot"><a href="#/workspace">' + icon("crown", 16) + '会员与团队空间</a><a href="#/send-home">' + icon("arrowLeft", 16) + '返回发文件</a></div></aside>';
  }

  function settingsLayout(active, body, title, sub, actions) {
    return '<div class="wrap mid">' +
      '<div class="page-hd"><div><div class="crumb"><a href="#/send-home">首页</a><i>/</i><span>账户设置</span></div><h1>' + (title || "账户设置") + '</h1><p>' + (sub || "管理账号资料、安全与通知偏好。") + '</p></div>' +
      (actions ? '<div class="page-actions">' + actions + '</div>' : '') + '</div>' +
      '<div class="side-layout">' + settingsNav(active) + '<div>' + body + '</div></div></div>';
  }

  var ADMIN_TABS = [
    ["admin-dashboard", "dashboard", "数据看板", "chart"],
    ["admin-resources", "resources", "资源管理", "database"],
    ["admin-users", "users", "用户管理", "users"],
    ["admin-logs", "security", "安全日志", "shield"],
    ["admin-config", "config", "系统配置", "sliders"]
  ];

  function adminShell(active, body) {
    var tabs = ADMIN_TABS.map(function (t) {
      return '<a href="#/' + t[0] + '" class="' + (t[1] === active ? "active" : "") + '">' + icon(t[3], 15) + t[2] + '</a>';
    }).join("");
    return '<header class="admin-top"><a class="brand" href="#/admin-dashboard"><img class="brand-mark" style="width:28px;height:28px" src="assets/icons/ico-cloud.png" alt=""/><span>鲲穹运营后台</span></a>' +
      '<span class="badge">生产环境</span><div class="right"><span>admin@kunqiong.cn</span><a href="#/send-home" style="color:#9fb4d1;display:flex;gap:6px;align-items:center">' + icon("external", 14) + '返回前台</a></div></header>' +
      '<nav class="admin-tabs">' + tabs + '</nav><main class="admin-page"><div class="admin-inner">' + body + '</div></main>';
  }

  function shellFor(page, html) {
    var layout = page.layout || "app";
    if (layout === "bare") return html;
    if (layout === "admin") return adminShell(page.adminTab || "dashboard", html);
    if (layout === "public") return publicTop(page.publicRight) + '<main class="public-main">' + html + '</main>' + (page.noFooter ? "" : footer());
    if (layout === "auth") return html;
    return topbar(page.nav || "") + '<main class="page">' + html + '</main>' + footer();
  }

  function pageIndexDrawer(currentId) {
    var groups = {};
    PAGES.forEach(function (p) {
      (groups[p.group] = groups[p.group] || []).push(p);
    });
    var html = '<div class="dock-panel" id="dockPanel"><div class="dock-head"><b>全部页面 · ' + PAGES.length + ' 屏</b><a href="board.html" style="color:#8fa3bd">总览板 ↗</a></div>';
    GROUPS.forEach(function (g) {
      var list = groups[g.key];
      if (!list || !list.length) return;
      html += '<div class="dock-group"><h5>' + g.label + '</h5><div class="dock-list">' +
        list.map(function (p) {
          return '<a class="dock-item ' + (p.id === currentId ? "on" : "") + '" href="#/' + p.id + '"><i>' + (p.no || "") + '</i><span>' + esc(p.title) + '</span></a>';
        }).join("") + '</div></div>';
    });
    html += '</div>';
    return html;
  }

  function dock(currentId) {
    return '<div class="dock"><button class="dock-nav" id="dockPrev" aria-label="上一页">' + icon("chevronLeft", 17) + '</button>' +
      '<button class="dock-main" id="dockToggle"><i class="dot"></i><span>页面导航</span></button>' +
      '<button class="dock-nav" id="dockNext" aria-label="下一页">' + icon("chevronRight", 17) + '</button></div>' +
      '<div id="dockHost">' + pageIndexDrawer(currentId) + '</div>';
  }

  var currentModalHost = null;

  function openModal(inner) {
    closeModal();
    var host = document.createElement("div");
    host.className = "modal-mask";
    host.innerHTML = '<div class="modal" role="dialog" aria-modal="true">' + inner + '</div>';
    document.body.appendChild(host);
    currentModalHost = host;
    host.addEventListener("click", function (e) {
      if (e.target === host || e.target.closest("[data-close]")) closeModal();
    });
    document.addEventListener("keydown", escClose);
    return host;
  }
  function closeModal() {
    if (currentModalHost) { currentModalHost.remove(); currentModalHost = null; }
    document.removeEventListener("keydown", escClose);
  }
  function escClose(e) { if (e.key === "Escape") closeModal(); }

  var toastTimer;
  function toast(msg) {
    var el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast"; el.className = "toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 1900);
  }

  function copyText(text) {
    function done() { toast("已复制到剪贴板"); }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else fallback();
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { toast("请手动复制：" + text); }
      ta.remove();
    }
  }

  function currentId() {
    var h = (location.hash || "").replace(/^#\/?/, "");
    if (!h) return PAGES.length ? PAGES[0].id : "";
    return h;
  }

  function findPage(id) {
    for (var i = 0; i < PAGES.length; i++) if (PAGES[i].id === id) return PAGES[i];
    return null;
  }

  function runMount(page, root) {
    try {
      if (typeof page.mount === "function") page.mount(root || document);
    } catch (err) {
      console.error("mount failed", page && page.id, err);
    }
  }

  function render() {
    var id = currentId();
    var page = findPage(id) || PAGES[0];
    if (!page) return;
    var host = document.getElementById("app");
    var html = page.render();
    host.innerHTML = shellFor(page, html) + dock(page.id);
    document.title = page.title + " · 鲲穹文件传输原型";
    window.scrollTo({ top: 0, behavior: "auto" });
    runMount(page, host);
    var toggle = document.getElementById("dockToggle");
    var panel = document.getElementById("dockPanel");
    if (toggle && panel) {
      toggle.addEventListener("click", function () { panel.classList.toggle("open"); });
    }
    var idx = PAGES.indexOf(page);
    var prev = document.getElementById("dockPrev");
    var next = document.getElementById("dockNext");
    if (prev) prev.onclick = function () { go(PAGES[(idx - 1 + PAGES.length) % PAGES.length].id); };
    if (next) next.onclick = function () { go(PAGES[(idx + 1) % PAGES.length].id); };
    document.body.classList.toggle("embed", isEmbed());
    document.body.classList.toggle("static", isStatic());
  }

  function go(id) {
    if (currentId() === id) render();
    else location.hash = "#/" + id;
  }

  document.addEventListener("click", function (e) {
    var t = e.target;
    var goEl = t.closest("[data-go]");
    if (goEl) { e.preventDefault(); go(goEl.getAttribute("data-go")); return; }
    var copyEl = t.closest("[data-copy]");
    if (copyEl) { e.preventDefault(); copyText(copyEl.getAttribute("data-copy")); return; }
    var toastEl = t.closest("[data-toast]");
    if (toastEl) { e.preventDefault(); toast(toastEl.getAttribute("data-toast")); return; }
    var closeEl = t.closest("[data-close]");
    if (closeEl) { e.preventDefault(); closeModal(); return; }
    var toggleEl = t.closest("[data-toggle]");
    if (toggleEl) {
      e.preventDefault();
      var sw = toggleEl.classList.contains("switch") ? toggleEl : toggleEl.closest(".switch");
      if (sw) {
        sw.classList.toggle("on");
        var msg = sw.getAttribute("data-toggle-msg");
        if (msg) toast(sw.classList.contains("on") ? msg : "已关闭");
      }
      return;
    }
    var openEl = t.closest("[data-open]");
    if (openEl) {
      e.preventDefault();
      var tpl = document.getElementById("tpl-" + openEl.getAttribute("data-open"));
      if (tpl) openModal(tpl.innerHTML);
      return;
    }
    var rm = t.closest("[data-remove]");
    if (rm) {
      e.preventDefault();
      var row = rm.closest(".trow, .file-row, .notice-row");
      if (row) { row.style.transition = "opacity .18s"; row.style.opacity = "0"; setTimeout(function () { row.remove(); }, 180); }
      toast("已移除");
      return;
    }
    var add = t.closest("[data-demo-add]");
    if (add) { e.preventDefault(); toast("原型演示：已追加 1 个示例文件"); return; }
  });

  document.addEventListener("click", function (e) {
    var menu = document.getElementById("userMenu");
    var btn = e.target.closest("#userBtn");
    if (btn && menu) { menu.classList.toggle("open"); return; }
    if (menu && !e.target.closest("#userMenu")) menu.classList.remove("open");
  });

  window.addEventListener("hashchange", render);
  window.KQ = {
    icon: icon, esc: esc, fmtBytes: fmtBytes, qrSvg: qrSvg, register: register,
    toast: toast, copyText: copyText, openModal: openModal, closeModal: closeModal,
    go: go, settingsLayout: settingsLayout, adminShell: adminShell, topbar: topbar,
    publicTop: publicTop, footer: footer, PAGES: PAGES, isEmbed: isEmbed, isStatic: isStatic
  };

  var KQ_ERRORS = [];
  window.addEventListener("error", function (e) { KQ_ERRORS.push(e.message); });

  function runCheck() {
    if (!/[?&]check=1/.test(location.search)) return;
    setTimeout(function () {
      var vw = document.documentElement.clientWidth;
      var offenders = [];
      var nodes = document.querySelectorAll("#app *");
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        if (el.closest(".dock-panel") || el.closest(".dock")) continue;
        var sc = el.parentElement, scrollable = false;
        while (sc && sc !== document.body) {
          var ov = getComputedStyle(sc).overflowX;
          if (ov === "auto" || ov === "scroll") { scrollable = true; break; }
          sc = sc.parentElement;
        }
        if (scrollable) continue;
        var r = el.getBoundingClientRect();
        if (r.width > 1 && r.right > vw + 1.5) {
          var tag = el.tagName.toLowerCase();
          var cls = (el.className && typeof el.className === "string") ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
          offenders.push(tag + cls + "@" + Math.round(r.right));
          if (offenders.length >= 6) break;
        }
      }
      var docW = document.documentElement.scrollWidth;
      document.title = "CHECK|vw=" + vw + "|doc=" + docW + "|err=" + (KQ_ERRORS.length ? KQ_ERRORS[0] : "none") + "|of=" + (offenders.length ? offenders.join(",") : "none") + "|h=" + Math.round(document.documentElement.scrollHeight) + "|ch=" + document.documentElement.clientHeight + "/" + window.innerHeight;
    }, 120);
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (!PAGES.length) return;
    render();
    runCheck();
  });
})();
