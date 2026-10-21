/* 04 · 记录与消息 */
(function () {
  var K = window.KQ;

  var ROWS = [
    { id: 1, n: "2026 产品报价单.pdf", t: "ft-pdf", scope: "发出", sc: "out", size: "13.0 MB", status: "分享中", tone: "ok", exp: "剩余 2 天", act: "管理" },
    { id: 2, n: "项目交付资料.zip", t: "ico-folder", scope: "发出", sc: "out", size: "268.4 MB", status: "分享中", tone: "ok", exp: "剩余 2 天", act: "管理" },
    { id: 3, n: "品牌视觉规范.pdf", t: "ft-pdf", scope: "接收", sc: "in", size: "24.6 MB", status: "有效", tone: "ok", exp: "剩余 5 天", act: "打开" },
    { id: 4, n: "秋季活动照片.zip", t: "ico-folder", scope: "提交", sc: "sub", size: "186.0 MB", status: "已提交", tone: "blue", exp: "10-28 截止", act: "查看" },
    { id: 5, n: "供应商资质材料", t: "act-clipboard", scope: "收集", sc: "col", size: "23 个文件", status: "收集中", tone: "ok", exp: "10-30 截止", act: "管理" },
    { id: 6, n: "旧版合同.pdf", t: "ft-pdf", scope: "发出", sc: "out", size: "8.2 MB", status: "已过期", tone: "", exp: "10-15 过期", act: "重新分享" },
    { id: 7, n: "客户反馈.xlsx", t: "ft-xls", scope: "接收", sc: "in", size: "1.2 MB", status: "已下载", tone: "", exp: "已清理", act: "详情" }
  ];

  function recordRow(r, checked) {
    return '<div class="rec-row">' +
      '<span class="rec-check"><input type="checkbox" ' + (checked ? "checked" : "") + ' aria-label="选择"/></span>' +
      '<div class="rec-name"><img src="assets/icons/' + r.t + '.png" alt=""/><div><b>' + K.esc(r.n) + '</b><small>' + (r.sc === "col" ? "收集任务 · 8 位提交人" : r.sc === "sub" ? "提交给 林敬轩" : r.sc === "out" ? "分享给 3 人" : "来自 林敬轩") + '</small></div></div>' +
      '<span class="rec-dir ' + r.sc + '">' + r.scope + '</span>' +
      '<span class="rec-size mono">' + r.size + '</span>' +
      '<span><span class="badge ' + r.tone + '"><i></i>' + r.status + '</span></span>' +
      '<span class="rec-exp">' + r.exp + '</span>' +
      '<span class="row-acts"><button class="btn ghost sm" data-go="' + (r.sc === "col" ? "collect-manage" : r.sc === "out" ? "share-manage" : "record-detail") + '">' + r.act + '</button><button class="icon-act" title="更多">' + K.icon("more", 16) + '</button></span>' +
      '</div>';
  }

  function recordsHeader(activeScope) {
    var tabs = [["全部", 7], ["我发送的", 3], ["发给我的", 2], ["我收集的", 1], ["向我收集的", 1]];
    return '<div class="page-hd"><div><h1>收发记录</h1><p>集中查看发出去的分享、收到的文件与收集任务。</p></div><div class="page-actions"><a class="btn ghost sm" href="#/records-files">' + K.icon("folder", 14) + '文件管理</a><a class="btn primary sm" href="#/send-home">' + K.icon("plus", 14) + '发文件</a></div></div>' +
      '<div class="view-switch"><a class="active" href="#/records">' + K.icon("history", 15) + '收发记录</a><a href="#/records-files">' + K.icon("database", 15) + '文件管理中心</a></div>' +
      '<div class="scope-tabs">' + tabs.map(function (t) {
        return '<a class="' + (t[0] === activeScope ? "active" : "") + '" href="#/records">' + t[0] + '<span>' + t[1] + '</span></a>';
      }).join("") + '</div>' +
      '<div class="filter-bar"><label class="search-box">' + K.icon("search", 15) + '<input placeholder="搜索文件名、取件码或收件人"/></label>' +
        '<select class="select" style="width:126px"><option>全部日期</option><option>今天</option><option>近 7 天</option><option>近 30 天</option></select>' +
        '<select class="select" style="width:132px"><option>全部状态</option><option>有效/进行中</option><option>即将过期</option><option>已过期</option></select>' +
        '<button class="btn ghost sm" data-toast="已按条件筛选">' + K.icon("filter", 14) + '筛选</button>' +
        '<button class="btn ghost sm" style="margin-left:auto" data-toast="已清空当前分类记录（原型演示）">' + K.icon("trash", 14) + '清空记录</button></div>';
  }

  K.register([
    {
      id: "records", group: "records", nav: "records", title: "收发记录", no: "25",
      render: function () {
        return '<div class="wrap">' + recordsHeader("全部") +
          '<div class="card rec-card"><div class="card-bd" style="padding:0">' +
            '<div class="rec-head"><span class="rec-check"><input type="checkbox" aria-label="全选"/></span><span>名称</span><span>方向</span><span>大小</span><span>状态</span><span>有效期</span><span class="r">操作</span></div>' +
            ROWS.map(function (r) { return recordRow(r); }).join("") +
          '</div><div class="card-ft"><div class="flex between"><span class="tiny">共 7 条记录 · 已选择 0 条</span><div class="pager"><button class="btn ghost sm" disabled>上一页</button><span class="tiny">1 / 1</span><button class="btn ghost sm" disabled>下一页</button></div></div></div></div>' +
          '<p class="tiny mt12">' + K.icon("info", 13) + ' 未登录时的记录只保存在当前浏览器，登录后可跨设备同步。 <a class="text-btn" href="#/login" style="font-size:12px">去登录</a></p>' +
        '</div>';
      }
    },

    {
      id: "records-sent", group: "records", nav: "records", title: "我发送的", no: "26",
      render: function () {
        return '<div class="wrap">' + recordsHeader("我发送的") +
          '<div class="card rec-card"><div class="card-bd" style="padding:0">' +
            '<div class="rec-head"><span class="rec-check"><input type="checkbox" aria-label="全选"/></span><span>名称</span><span>方向</span><span>大小</span><span>状态</span><span>有效期</span><span class="r">操作</span></div>' +
            [ROWS[0], ROWS[1], ROWS[5]].map(function (r) { return recordRow(r, r.id === 1); }).join("") +
          '</div><div class="card-ft"><div class="flex between"><span class="tiny">共 3 条记录 · 已选择 1 条</span><div class="flex"><button class="btn ghost sm" data-toast="已续期 3 天">批量续期</button><button class="btn ghost sm" data-toast="已复制 3 个分享链接">批量复制链接</button><button class="btn danger sm" data-toast="已删除所选记录">删除</button></div></div></div></div>' +
          '<div class="banner info mt16">' + K.icon("info", 15) + '<div>「我发送的」包含分享与邮件发送记录。关闭分享后记录仍保留，可重新开启或再次分享。</div></div>' +
        '</div>';
      }
    },

    {
      id: "records-received", group: "records", nav: "records", title: "发给我的", no: "27",
      render: function () {
        return '<div class="wrap">' + recordsHeader("发给我的") +
          '<div class="card rec-card"><div class="card-bd" style="padding:0">' +
            '<div class="rec-head"><span class="rec-check"><input type="checkbox" aria-label="全选"/></span><span>名称</span><span>方向</span><span>大小</span><span>状态</span><span>有效期</span><span class="r">操作</span></div>' +
            [ROWS[2], ROWS[6]].map(function (r) { return recordRow(r); }).join("") +
          '</div><div class="card-ft"><div class="flex between"><span class="tiny">共 2 条记录</span><div class="pager"><button class="btn ghost sm" disabled>上一页</button><span class="tiny">1 / 1</span><button class="btn ghost sm" disabled>下一页</button></div></div></div></div>' +
          '<div class="card mt16"><div class="card-hd"><h3>已保存到我的文件</h3><span class="tiny">下载完成的文件会在此保留 7 天</span></div><div class="card-bd" style="padding-top:4px">' +
            '<div class="saved-row"><img src="assets/icons/ft-pdf.png" alt=""/><div class="grow"><b>品牌视觉规范.pdf</b><small>24.6 MB · 来自 林敬轩 · 今天 11:20</small></div><button class="btn ghost sm" data-toast="已开始下载">' + K.icon("download", 13) + '下载</button></div>' +
            '<div class="saved-row"><img src="assets/icons/ft-xls.png" alt=""/><div class="grow"><b>客户反馈.xlsx</b><small>1.2 MB · 来自 陈静 · 10-18 09:40</small></div><span class="badge">已清理</span></div>' +
          '</div></div>' +
        '</div>';
      }
    },

    {
      id: "records-files", group: "records", nav: "records", title: "文件管理中心", no: "28",
      render: function () {
        var cats = [["全部类型", 23, "layers"], ["图片", 6, "image"], ["文档", 9, "fileText"], ["视频", 2, "video"], ["音频", 1, "message"], ["压缩包", 3, "archive"], ["代码文件", 1, "code"], ["收集任务", 1, "inbox"]];
        return '<div class="wrap">' +
          '<div class="page-hd"><div><h1>文件管理中心</h1><p>按类型查看所有发送、接收与收集的文件，快速定位与清理。</p></div><div class="page-actions"><a class="btn ghost sm" href="#/records">' + K.icon("history", 14) + '返回收发记录</a><button class="btn primary sm" href="#/send-home">' + K.icon("upload", 14) + '上传文件</button></div></div>' +
          '<div class="files-layout">' +
            '<aside class="file-cats"><h4>文件类型</h4>' + cats.map(function (c, i) {
              return '<button class="' + (i === 0 ? "active" : "") + '">' + K.icon(c[2], 15) + '<span>' + c[0] + '</span><em>' + c[1] + '</em></button>';
            }).join("") + '<div class="cat-divider"></div><h4>存储</h4><div class="storage-box"><div class="flex between"><span>已用 6.4 GB</span><small>共 20 GB</small></div><div class="progress sm mt8"><i style="width:32%"></i></div><p class="tiny" style="margin-top:6px">会员版容量 · 清理过期文件可释放空间</p></div></aside>' +
            '<div class="card rec-card"><div class="card-hd" style="align-items:center"><div class="flex"><h3>全部文件</h3><span class="badge">23</span></div><div class="flex"><label class="search-box sm">' + K.icon("search", 14) + '<input placeholder="搜索文件"/></label><button class="btn ghost sm">' + K.icon("filter", 14) + '筛选</button></div></div>' +
              '<div class="card-bd" style="padding:0">' +
                '<div class="file-head"><span class="rec-check"><input type="checkbox" aria-label="全选"/></span><span>文件名</span><span>类型</span><span>来源</span><span>大小</span><span>状态</span><span class="r">操作</span></div>' +
                [
                  ["品牌视觉规范.pdf", "ft-pdf", "PDF", "接收 · 林敬轩", "24.6 MB", "有效", "ok"],
                  ["项目交付资料.zip", "ico-folder", "压缩包", "发出 · 3 人", "268.4 MB", "分享中", "ok"],
                  ["秋季活动照片.zip", "ico-folder", "压缩包", "提交 · 林敬轩", "186.0 MB", "已提交", "blue"],
                  ["2026 产品报价单.pdf", "ft-pdf", "PDF", "发出 · 5 人", "13.0 MB", "分享中", "ok"],
                  ["季度复盘演示.pptx", "ft-ppt", "PPT", "发出 · 1 人", "48.2 MB", "即将过期", "warn"],
                  ["客户反馈.xlsx", "ft-xls", "XLSX", "接收 · 陈静", "1.2 MB", "已清理", ""],
                  ["界面截图.png", "ft-jpg", "PNG", "发出 · 2 人", "5.6 MB", "有效", "ok"]
                ].map(function (f) {
                  return '<div class="file-row2"><span class="rec-check"><input type="checkbox" aria-label="选择"/></span><div class="rec-name"><img src="assets/icons/' + f[1] + '.png" alt=""/><div><b>' + f[0] + '</b><small>' + f[3] + '</small></div></div><span class="badge">' + f[2] + '</span><span class="rec-exp">' + f[3].split(" · ")[0] + '</span><span class="mono rec-size">' + f[4] + '</span><span><span class="badge ' + f[6] + '"><i></i>' + f[5] + '</span></span><span class="row-acts"><button class="icon-act" title="预览">' + K.icon("eye", 15) + '</button><button class="icon-act" title="下载">' + K.icon("download", 15) + '</button><button class="icon-act danger" title="删除">' + K.icon("trash", 15) + '</button></span></div>';
                }).join("") +
              '</div><div class="card-ft"><div class="flex between"><span class="tiny">共 23 个文件 · 已选择 0 个</span><div class="pager"><button class="btn ghost sm" disabled>上一页</button><span class="tiny">1 / 3</span><button class="btn ghost sm">下一页</button></div></div></div>' +
          '</div></div>';
      }
    },

    {
      id: "record-detail", group: "records", nav: "records", title: "记录详情", no: "29",
      render: function () {
        return '<div class="wrap narrow">' +
          '<a class="backlink" href="#/records">' + K.icon("chevronLeft", 14) + '返回收发记录</a>' +
          '<div class="manage-head"><div><h1>项目交付资料.zip <span class="badge ok"><i></i>分享中</span></h1><p>分享编号 SH-20261020-0186 · 创建于 2026-10-20 16:08</p></div><div class="page-actions"><button class="btn ghost sm" data-go="share-manage">' + K.icon("settings", 14) + '分享管理</button><button class="btn primary sm" data-go="share-public">' + K.icon("external", 14) + '打开分享页</button></div></div>' +
          '<div class="manage-stats"><div class="manage-stat"><span>文件数</span><b>4</b><small>323.0 MB</small></div><div class="manage-stat"><span>访问</span><b>37</b><small>独立访客 21</small></div><div class="manage-stat"><span>下载</span><b>12</b><small>不限次数</small></div><div class="manage-stat"><span>到期</span><b>2 天</b><small>10-23 18:00</small></div></div>' +
          '<div class="manage-grid">' +
            '<div><div class="card"><div class="card-hd"><h3>文件</h3><span class="tiny">4 个</span></div><div class="card-bd" style="padding-top:4px">' +
              [["2026 产品报价单.pdf", "ft-pdf", "13.0 MB"], ["项目交付资料.zip", "ico-folder", "268.4 MB"], ["季度复盘演示.pptx", "ft-ppt", "48.2 MB"], ["界面截图.png", "ft-jpg", "5.6 MB"]].map(function (f) {
                return '<div class="share-file-row"><img class="ftype" src="assets/icons/' + f[1] + '.png" alt=""/><div class="grow"><span class="fname">' + f[0] + '</span><small>通过安全检查</small></div><span class="size mono">' + f[2] + '</span><button class="icon-act" data-go="file-preview">' + K.icon("eye", 16) + '</button></div>';
              }).join("") + '</div></div>' +
              '<div class="card mt16"><div class="card-hd"><h3>访问明细</h3><span class="tiny">最近 4 条</span></div><div class="card-bd" style="padding-top:6px">' +
                '<div class="log-row"><i>' + K.icon("download", 13) + '</i><span>匿名访客下载了 项目交付资料.zip</span><small>今天 15:58</small></div>' +
                '<div class="log-row"><i>' + K.icon("eye", 13) + '</i><span>访客通过二维码打开分享</span><small>今天 15:42</small></div>' +
                '<div class="log-row"><i>' + K.icon("lock", 13) + '</i><span>密码验证成功</span><small>今天 15:40</small></div>' +
                '<div class="log-row"><i>' + K.icon("mail", 13) + '</i><span>取件邮件已送达 wang.lei@kunqiong.cn</span><small>今天 16:09</small></div>' +
              '</div></div></div>' +
            '<aside><div class="card"><div class="card-hd"><h3>分享信息</h3></div><div class="card-bd"><dl class="sum-list"><div><dt>取件码</dt><dd class="mono">K7Q2M9</dd></div><div><dt>提取密码</dt><dd class="mono">KQ2026</dd></div><div><dt>下载限制</dt><dd>不限次数</dd></div><div><dt>来源</dt><dd>网页上传</dd></div><div><dt>创建时间</dt><dd>2026-10-20 16:08</dd></div></dl><button class="btn ghost sm block mt12" data-copy="https://kq.cn/s/K7Q2M9">' + K.icon("copy", 14) + '复制分享链接</button></div></div>' +
              '<div class="danger-zone"><h4>' + K.icon("trash", 14) + '删除记录</h4><p>删除记录会同时关闭分享并清理文件，操作不可撤销。</p><button class="btn danger sm" data-toast="记录已删除（原型演示）">删除记录</button></div></aside>' +
          '</div>' +
        '</div>';
      }
    },

    {
      id: "messages", group: "records", nav: "records", title: "消息中心", no: "30",
      render: function () {
        var msgs = [
          ["王磊 下载了你分享的文件", "「项目交付资料.zip」已下载 1 次，分享剩余 2 天。", "今天 15:58", "download", "unread", "文件动态"],
          ["你的收集任务收到新提交", "陈静 提交了 2 个文件，共 86.2 MB。", "今天 14:08", "inbox", "unread", "收集动态"],
          ["分享将在 24 小时内到期", "「2026 产品报价单.pdf」将于明天 18:00 到期，可续期或关闭。", "今天 09:00", "clock", "unread", "到期提醒"],
          ["团队邀请已接受", "赵敏 已加入「鲲穹设计团队」，当前成员 8 人。", "昨天 18:22", "users", "", "团队"],
          ["订单支付成功", "会员版年付订单已开通，有效期至 2027-06-18。", "10-18 10:12", "card", "", "账户"],
          ["安全检查拦截提示", "一个压缩包内文件命中风险规则，上传已阻止。", "10-17 16:40", "shield", "", "安全"]
        ];
        return '<div class="wrap narrow">' +
          '<div class="page-hd"><div><h1>消息中心 <span class="badge blue">3 条未读</span></h1><p>文件动态、收集提交、到期提醒与团队通知。</p></div><div class="page-actions"><button class="btn ghost sm" data-toast="已全部标为已读">' + K.icon("check", 14) + '全部已读</button><button class="btn ghost sm" data-toast="已清理已读消息">' + K.icon("trash", 14) + '清理已读</button></div></div>' +
          '<div class="msg-tabs"><button class="active">全部<span>6</span></button><button>未读<span>3</span></button><button>文件动态</button><button>收集动态</button><button>账户与团队</button></div>' +
          '<div class="card"><div class="card-bd" style="padding:6px 0">' +
            msgs.map(function (m) {
              return '<div class="msg-row ' + (m[4] || "") + '"><span class="msg-ico">' + K.icon(m[3], 17) + '</span><div class="grow"><div class="msg-title"><b>' + m[0] + '</b><span class="badge">' + m[5] + '</span></div><p>' + m[1] + '</p><small>' + m[2] + '</small></div><button class="icon-act" title="标为已读" data-toast="已标为已读">' + K.icon("check", 15) + '</button><button class="icon-act danger" title="删除" data-remove>' + K.icon("trash", 15) + '</button></div>';
            }).join("") +
          '</div></div>' +
          '<p class="tiny center mt16">没有更多消息了 · 消息保留 30 天</p>' +
        '</div>';
      }
    }
  ]);
})();
