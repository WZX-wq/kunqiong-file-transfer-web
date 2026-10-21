/* 06 · 会员与团队 */
(function () {
  var K = window.KQ;

  function teamHeader() {
    return '<div class="team-top"><div class="team-ident"><span class="team-logo">' + K.icon("building", 20) + '</span><div><h1>鲲穹设计团队 <span class="badge blue">团队版</span></h1><p>所有者 林敬轩 · 8 位成员 · 创建于 2026-04-08</p></div></div><div class="page-actions"><button class="btn ghost sm" data-toast="邀请链接已复制">' + K.icon("userPlus", 14) + '邀请成员</button><a class="btn ghost sm" href="#/team-overview">' + K.icon("settings", 14) + '团队设置</a></div></div>' +
      '<div class="team-kpis"><div class="kpi"><span>' + K.icon("users", 14) + '团队成员</span><strong>8</strong><small>1 位待加入</small></div><div class="kpi"><span>' + K.icon("database", 14) + '团队文件</span><strong>126</strong><small>18 个分享与收集</small></div><div class="kpi"><span>' + K.icon("drive", 14) + '已用容量</span><strong>42.6 GB</strong><small>共 200 GB</small></div><div class="kpi"><span>' + K.icon("link", 14) + '活跃资源</span><strong>14</strong><small>近 7 天有访问</small></div></div>';
  }

  function teamTabs(active) {
    var tabs = [["team-members", "members", "成员观察", "users"], ["team-resources", "resources", "团队资源", "database"], ["team-permissions", "manage", "团队成员", "userCheck"], ["team-requests", "requests", "入团申请", "clipboard"]];
    return '<div class="team-tabs">' + tabs.map(function (t) {
      return '<a href="#/' + t[0] + '" class="' + (t[1] === active ? "active" : "") + '">' + K.icon(t[3], 15) + t[2] + (t[1] === "requests" ? '<span class="tab-count">2</span>' : '') + '</a>';
    }).join("") + '</div>';
  }

  function teamPage(active, body) {
    return '<div class="wrap mid">' + teamHeader() + teamTabs(active) + body + '</div>';
  }

  K.register([
    {
      id: "workspace", group: "space", nav: "space", title: "会员与团队空间", no: "38",
      render: function () {
        return '<div class="wrap">' +
          '<div class="page-hd"><div><div class="crumb"><a href="#/send-home">首页</a><i>/</i><span>会员与团队</span></div><h1>会员与团队空间</h1><p>存储空间、保存策略与团队协作能力由账号权益统一管控。</p></div><div class="page-actions"><a class="btn ghost sm" href="#/team-overview">' + K.icon("users", 14) + '团队管理</a><a class="btn primary sm" href="#/plan">' + K.icon("crown", 14) + '升级套餐</a></div></div>' +
          '<div class="plan-hero"><div class="ph-copy"><span class="ph-badge">' + K.icon("crown", 14) + '会员版</span><h2>20 GB 空间，发送不限速</h2><p>有效期至 2027-06-18 · 自动续费已关闭</p><div class="ph-actions"><a class="btn primary sm" href="#/plan">升级或续费</a><button class="btn ghost sm" data-toast="续费提醒已开启">开启到期提醒</button></div></div><div class="ph-side"><div class="ph-stat"><span>已用容量</span><b>6.6 GB <small>/ 20 GB</small></b><div class="progress sm"><i style="width:33%"></i></div></div><div class="ph-stat"><span>本月流量</span><b>12.6 GB <small>不限</small></b><div class="progress sm"><i style="width:18%"></i></div></div></div>' +
          '<div class="ph-metrics">' +
            [["upload", "单文件上限", "10 GB"], ["clock", "最长有效期", "30 天"], ["history", "记录保留", "180 天"], ["users", "团队空间", "200 GB"]].map(function (m) {
              return '<div><span>' + K.icon(m[0], 13) + m[1] + '</span><b>' + m[2] + '</b></div>';
            }).join("") +
          '</div>' +
          '</div>' +
          '<div class="split split-fill mt16">' +
            '<div class="card"><div class="card-hd"><div><p class="eyebrow">当前套餐</p><h3 style="margin-top:3px">' + K.icon("crown", 16) + ' 会员版</h3></div><a class="text-btn" href="#/plan">对比套餐</a></div><div class="card-bd">' +
              '<div class="benefit-grid">' +
                [["zap", "不限速传输", "分片并发，跑满带宽"], ["shield", "安全检测", "病毒与敏感内容拦截"], ["clock", "30 天有效期", "自定义到期时间"], ["users", "团队协作", "200 GB 共享空间"], ["qr", "取件码与二维码", "多渠道分享"], ["history", "长期记录", "180 天收发记录"]].map(function (b) {
                  return '<div class="benefit"><span>' + K.icon(b[0], 17) + '</span><div><b>' + b[1] + '</b><small>' + b[2] + '</small></div></div>';
                }).join("") +
              '</div>' +
              '<div class="banner info mt16">' + K.icon("info", 15) + '<div>会员版按年订阅，到期后未续费将降级为免费版：容量降至 5 GB，超出部分只读不可新增。</div></div>' +
            '</div></div>' +
            '<div class="side-col">' +
              '<div class="card side-card"><div class="card-hd"><h3>团队空间</h3><span class="badge ok"><i></i>已加入</span></div><div class="card-bd">' +
                '<div class="team-mini"><span class="team-logo">' + K.icon("building", 18) + '</span><div class="grow"><b>鲲穹设计团队</b><small>8 位成员 · 200 GB 共享</small></div></div>' +
                '<div class="cap-row"><span>团队已用 <b>42.6 GB</b> / 200 GB</span><span class="pct">21%</span></div>' +
                '<div class="progress sm"><i style="width:21%"></i></div>' +
                '<div class="side-foot"><div class="team-avatars"><span class="avatar sm">林</span><span class="avatar sm">王</span><span class="avatar sm">陈</span><span class="avatar sm">赵</span><span class="avatar sm more">+4</span></div><a class="text-btn" href="#/team-overview">团队管理 ' + K.icon("chevronRight", 13) + '</a></div>' +
              '</div></div>' +
              '<div class="card side-card"><div class="card-hd"><h3>存储用量</h3><a class="text-btn" href="#/settings-cleanup">清理空间 ' + K.icon("chevronRight", 13) + '</a></div><div class="card-bd">' +
                '<div class="usage-total"><b>6.6</b><span>GB / 20 GB</span><em>33%</em></div>' +
                '<div class="usage-bar">' +
                  '<i style="width:19.5%;background:#1f6bff"></i><i style="width:9%;background:#4f95ff"></i><i style="width:3.5%;background:#8fc0ff"></i><i style="width:1.2%;background:#c3d8f8"></i>' +
                '</div>' +
                '<div class="usage-legend">' +
                  [["#1f6bff", "分享文件", "3.9 GB"], ["#4f95ff", "收集任务", "1.8 GB"], ["#8fc0ff", "接收文件", "0.7 GB"], ["#c3d8f8", "回收站", "240 MB"]].map(function (u) {
                    return '<span><i style="background:' + u[0] + '"></i>' + u[1] + '<b>' + u[2] + '</b></span>';
                  }).join("") +
                '</div>' +
              '</div></div>' +
            '</div>' +
          '</div>' +
        '</div>';
      }
    },

    {
      id: "plan", group: "space", nav: "space", title: "会员套餐", no: "39",
      render: function () {
        return '<div class="wrap">' +
          '<div class="page-hd"><div><div class="crumb"><a href="#/workspace">会员与团队</a><i>/</i><span>套餐</span></div><h1>选择适合你的套餐</h1><p>随时升级，按剩余天数折算；年付比月付更省。</p></div><div class="bill-toggle"><button class="active">年付 · 省 26%</button><button>月付</button></div></div>' +
          '<div class="plan-grid">' +
            '<div class="plan-card"><div class="pc-top"><h3>免费版</h3><p>偶尔传文件</p></div><div class="pc-price"><b>¥ 0</b><span>/ 永久</span></div><ul><li>' + K.icon("check", 14) + '5 GB 存储空间</li><li>' + K.icon("check", 14) + '单文件 1.2 GB</li><li>' + K.icon("check", 14) + '3 天有效期</li><li>' + K.icon("check", 14) + '基础取件码</li></ul><button class="btn ghost block" disabled>当前套餐</button></div>' +
            '<div class="plan-card featured"><span class="plan-flag">推荐</span><div class="pc-top"><h3>会员版</h3><p>个人高频使用</p></div><div class="pc-price"><b>¥ 168</b><span>/ 年</span><em>约 ¥ 14 / 月</em></div><ul><li>' + K.icon("check", 14) + '20 GB 存储空间</li><li>' + K.icon("check", 14) + '单文件 10 GB</li><li>' + K.icon("check", 14) + '最长 30 天有效期</li><li>' + K.icon("check", 14) + '提取密码与下载限制</li><li>' + K.icon("check", 14) + '180 天收发记录</li></ul><a class="btn primary block" href="#/plan-pay">立即升级</a></div>' +
            '<div class="plan-card"><div class="pc-top"><h3>团队版</h3><p>小团队协作</p></div><div class="pc-price"><b>¥ 588</b><span>/ 年</span><em>约 ¥ 49 / 月</em></div><ul><li>' + K.icon("check", 14) + '200 GB 团队空间</li><li>' + K.icon("check", 14) + '10 位成员</li><li>' + K.icon("check", 14) + '单文件 20 GB</li><li>' + K.icon("check", 14) + '团队资源与权限</li><li>' + K.icon("check", 14) + '入团审批</li></ul><button class="btn ghost block" data-toast="已创建团队版升级意向">选择团队版</button></div>' +
            '<div class="plan-card"><div class="pc-top"><h3>企业版</h3><p>私有化与合规</p></div><div class="pc-price"><b>定制</b><span>/ 按需报价</span></div><ul><li>' + K.icon("check", 14) + '2 TB 起，可扩展</li><li>' + K.icon("check", 14) + '不限成员</li><li>' + K.icon("check", 14) + '私有化部署</li><li>' + K.icon("check", 14) + '专属客户经理</li><li>' + K.icon("check", 14) + '审计与发票</li></ul><button class="btn ghost block" data-toast="已提交企业版咨询，客户经理会联系你">联系销售</button></div>' +
          '</div>' +
          '<div class="card mt20"><div class="card-hd"><h3>权益对比</h3><span class="tiny">仅列出差异项</span></div><div class="card-bd" style="padding:0;overflow-x:auto"><table class="compare"><thead><tr><th>权益</th><th>免费版</th><th class="hl">会员版</th><th>团队版</th><th>企业版</th></tr></thead><tbody>' +
            [["存储空间", "5 GB", "20 GB", "200 GB", "2 TB 起"], ["单文件上限", "1.2 GB", "10 GB", "20 GB", "50 GB"], ["最长有效期", "3 天", "30 天", "90 天", "自定义"], ["下载限制", "—", "支持", "支持", "支持"], ["提取密码", "—", "支持", "支持", "支持"], ["团队协作", "—", "—", "10 人", "不限"], ["在线预览", "基础", "全格式", "全格式", "全格式"], ["发票", "—", "电子普票", "专票", "专票"]].map(function (r) {
              return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td class="hl">' + r[2] + '</td><td>' + r[3] + '</td><td>' + r[4] + '</td></tr>';
            }).join("") + '</tbody></table></div></div>' +
          '<div class="plan-faq"><h3>常见问题</h3><div class="grid2 mt12"><div class="faq-card"><b>升级后容量立即生效吗？</b><p>支付成功后立即生效，原套餐剩余价值按天折算抵扣。</p></div><div class="faq-card"><b>可以开发票吗？</b><p>会员版支持电子普票，团队版与企业版支持增值税专票。</p></div><div class="faq-card"><b>到期后文件会被删除吗？</b><p>容量降级后超出部分只读，30 天内可续费恢复，之后按清理规则处理。</p></div><div class="faq-card"><b>团队版成员如何计费？</b><p>最多 10 位成员，超出需升级企业版；成员变动不影响已付费用。</p></div></div></div>' +
        '</div>';
      },
      mount: function () {
        document.querySelectorAll(".bill-toggle button").forEach(function (b) {
          b.addEventListener("click", function () {
            document.querySelectorAll(".bill-toggle button").forEach(function (x) { x.classList.remove("active"); });
            b.classList.add("active");
          });
        });
      }
    },

    {
      id: "plan-pay", group: "space", nav: "space", title: "支付升级", no: "40",
      render: function () {
        return '<div class="wrap mid">' +
          '<a class="backlink" href="#/plan">' + K.icon("chevronLeft", 14) + '返回套餐</a>' +
          '<div class="page-hd"><div><h1>确认支付</h1><p>订单 15 分钟内有效，超时需重新创建。</p></div><span class="countdown">' + K.icon("clock", 14) + '剩余 <b class="mono">14:32</b></span></div>' +
          '<div class="pay-grid">' +
            '<div class="card"><div class="card-hd"><h3>订单信息</h3><span class="badge blue">待支付</span></div><div class="card-bd">' +
              '<div class="pay-plan"><span class="pay-ico">' + K.icon("crown", 20) + '</span><div class="grow"><b>会员版 · 年付</b><small>20 GB 空间 · 单文件 10 GB · 有效期 12 个月</small></div><b class="pay-price">¥ 168.00</b></div>' +
              '<dl class="detail-list three-col mt12"><div><dt>订单号</dt><dd class="mono" style="font-size:12.6px">KQ202610200031</dd></div><div><dt>优惠</dt><dd>年付立减 ¥ 60</dd></div><div><dt>应付金额</dt><dd style="font-size:17px;font-weight:700;color:var(--brand)">¥ 168.00</dd></div></dl>' +
              '<div class="pay-methods"><div class="pm-head"><h4>支付方式</h4><div class="pay-tabs"><button class="active">' + K.icon("scan", 16) + '微信扫码</button><button>' + K.icon("wallet", 16) + '支付宝</button></div></div>' +
                '<div class="pay-qr-area"><div class="qr">' + K.qrSvg(661122) + '</div><div><b style="font-size:13.6px">请使用微信扫一扫</b><p class="tiny" style="margin-top:5px">扫码后手机上确认支付，支付完成页面自动更新</p><p class="tiny" style="margin-top:8px">' + K.icon("shield", 12) + ' 由微信支付提供安全收银服务</p></div></div>' +
              '</div>' +
              '<div class="banner info mt12">' + K.icon("info", 15) + '<div>支付即表示同意 <a href="#/terms" style="color:#2a5ea8">会员服务协议</a>；虚拟权益开通后不支持无理由退款。</div></div>' +
            '</div><div class="card-ft"><div class="flex between"><span class="tiny">遇到问题？<a class="text-btn" href="#/help" style="font-size:12px">联系客服</a></span><div class="flex"><button class="btn ghost" data-go="plan">取消</button><button class="btn primary" data-go="order-detail">我已完成支付</button></div></div></div></div>' +
            '<aside><div class="card"><div class="card-hd"><h3>升级后立即生效</h3></div><div class="card-bd"><ul class="pay-benefits"><li>' + K.icon("checkCircle", 15) + '<div><b>容量升级到 20 GB</b><small>超出 5 GB 的部分可继续上传</small></div></li><li>' + K.icon("checkCircle", 15) + '<div><b>单文件上限 10 GB</b><small>大文件自动分片与续传</small></div></li><li>' + K.icon("checkCircle", 15) + '<div><b>有效期延长至 30 天</b><small>支持自定义到期时间</small></div></li><li>' + K.icon("checkCircle", 15) + '<div><b>历史记录保留 180 天</b><small>跨设备同步</small></div></li></ul><div class="pay-total"><span>应付</span><b>¥ 168.00</b></div></div></div>' +
              '<p class="tiny center mt12">支付遇到问题？<a class="text-btn" href="#/help" style="font-size:12px">获取帮助</a></p></aside>' +
          '</div>' +
        '</div>';
      },
      mount: function () {
        document.querySelectorAll(".pay-tabs button").forEach(function (b) {
          b.addEventListener("click", function () {
            document.querySelectorAll(".pay-tabs button").forEach(function (x) { x.classList.remove("active"); });
            b.classList.add("active");
            K.toast("已切换到" + b.textContent.trim());
          });
        });
      }
    },

    {
      id: "workspace-team", group: "space", nav: "space", title: "团队空间", no: "41",
      render: function () {
        return '<div class="wrap mid">' +
          '<div class="page-hd"><div><div class="crumb"><a href="#/workspace">会员与团队</a><i>/</i><span>团队空间</span></div><h1>团队空间</h1><p>团队共享容量、成员与专属资源。</p></div><div class="page-actions"><button class="btn ghost sm" data-toast="邀请链接已复制">' + K.icon("userPlus", 14) + '邀请成员</button><a class="btn primary sm" href="#/team-resources">' + K.icon("upload", 14) + '上传团队文件</a></div></div>' +
          '<div class="team-hero"><div class="th-copy"><span class="team-logo lg">' + K.icon("building", 26) + '</span><div><h2>鲲穹设计团队</h2><p>所有者 林敬轩 · 创建于 2026-04-08</p><div class="flex mt12"><span class="badge blue">团队版</span><span class="badge">有效至 2027-04-08</span></div></div></div><div class="th-stats"><div><span>团队容量</span><b>42.6 GB <small>/ 200 GB</small></b><div class="progress sm"><i style="width:21%"></i></div></div><div><span>成员</span><b>8 <small>/ 10</small></b><small class="tiny">1 位待加入</small></div></div></div>' +
          '<div class="grid3 mt16">' +
            '<div class="card"><div class="card-hd"><h3>最近资源</h3><a class="text-btn" href="#/team-resources">全部</a></div><div class="card-bd" style="padding-top:4px">' +
              [["品牌视觉规范.pdf", "ft-pdf", "王磊 · 2 小时前", "24.6 MB"], ["秋季活动素材.zip", "ico-folder", "陈静 · 昨天", "186.0 MB"], ["产品演示.pptx", "ft-ppt", "林敬轩 · 10-18", "48.2 MB"]].map(function (r) {
                return '<div class="res-mini"><img src="assets/icons/' + r[1] + '.png" alt=""/><div class="grow"><b>' + r[0] + '</b><small>' + r[2] + '</small></div><span class="tiny mono">' + r[3] + '</span></div>';
              }).join("") + '</div></div>' +
            '<div class="card"><div class="card-hd"><h3>成员动态</h3></div><div class="card-bd" style="padding-top:4px">' +
              '<div class="log-row"><i>' + K.icon("upload", 13) + '</i><span>王磊 上传了 2 个文件</span><small>今天 14:08</small></div>' +
              '<div class="log-row"><i>' + K.icon("userPlus", 13) + '</i><span>赵敏 接受了团队邀请</span><small>昨天 18:22</small></div>' +
              '<div class="log-row"><i>' + K.icon("download", 13) + '</i><span>陈静 下载了 品牌视觉规范.pdf</span><small>昨天 10:31</small></div>' +
              '<div class="log-row"><i>' + K.icon("settings", 13) + '</i><span>林敬轩 调整了成员权限</span><small>10-18</small></div>' +
            '</div></div>' +
            '<div class="card"><div class="card-hd"><h3>快捷入口</h3></div><div class="card-bd"><div class="quick-grid">' +
              '<a href="#/team-members">' + K.icon("users", 18) + '<span>成员观察</span></a><a href="#/team-resources">' + K.icon("database", 18) + '<span>团队资源</span></a><a href="#/team-permissions">' + K.icon("userCheck", 18) + '<span>成员权限</span></a><a href="#/team-requests">' + K.icon("clipboard", 18) + '<span>入团申请</span><span class="badge warn">2</span></a>' +
            '</div><div class="banner info mt16">' + K.icon("info", 15) + '<div>团队文件仅团队成员可见，离开团队后自动失去访问权。</div></div></div></div>' +
          '</div>' +
        '</div>';
      }
    },

    {
      id: "team-overview", group: "space", nav: "space", title: "团队管理", no: "42",
      render: function () {
        return teamPage("members",
          '<div class="card"><div class="card-hd"><div><p class="eyebrow">空间使用</p><h3 style="margin-top:3px">团队容量</h3></div><span class="badge ok">21% 已用</span></div><div class="card-bd">' +
            '<div class="capacity-line"><div class="flex between"><span class="tiny">团队已用 42.6 GB / 总容量 200 GB</span><span class="tiny">21%</span></div><div class="progress mt8"><i style="width:21%"></i></div></div>' +
            '<div class="capacity-meta"><span>8 个分享</span><span>10 个收集任务</span><span>126 个文件</span></div>' +
            '<p class="tiny mt12">这里显示团队共享空间额度；个人中心容量按个人套餐单独计算。</p>' +
          '</div></div>' +
          '<div class="card mt16"><div class="card-hd"><h3>成员使用量</h3><span class="tiny">8 位成员</span></div><div class="card-bd" style="padding-top:4px">' +
            [["林敬轩", "所有者", "12.4 GB", 29, "林"], ["王磊", "管理员", "9.8 GB", 23, "王"], ["陈静", "成员", "7.2 GB", 17, "陈"], ["赵敏", "成员", "6.1 GB", 14, "赵"], ["周涛", "成员", "4.2 GB", 10, "周"], ["孙悦", "成员", "2.9 GB", 7, "孙"]].map(function (m) {
              return '<div class="member-usage"><span class="avatar sm">' + m[4] + '</span><div class="grow"><div class="mu-line"><b>' + m[0] + '</b><small>' + m[1] + ' · ' + m[3] + ' 个文件</small></div><div class="progress sm"><i style="width:' + (m[3] * 3) + '%"></i></div></div><span class="mu-value"><b>' + m[2] + '</b><small>占总容量 ' + (m[3] / 4).toFixed(1) + '%</small></span></div>';
            }).join("") +
          '</div><div class="card-ft"><div class="flex between"><span class="tiny">显示 6 / 8 位成员</span><a class="text-btn" href="#/team-members">查看全部</a></div></div></div>'
        );
      }
    },

    {
      id: "team-members", group: "space", nav: "space", title: "成员观察", no: "43",
      render: function () {
        return teamPage("members",
          '<div class="card"><div class="card-hd" style="align-items:center"><div><p class="eyebrow">成员观察</p><h3 style="margin-top:3px">成员使用量</h3></div><label class="search-box sm">' + K.icon("search", 14) + '<input placeholder="检索成员姓名、账号或邮箱"/></label></div>' +
          '<div class="card-bd" style="padding-top:6px">' +
            '<div class="banner info" style="margin-bottom:14px">' + K.icon("info", 15) + '<div>团队已用 42.6 GB / 总容量 200 GB；下方百分比表示成员已用空间占团队总容量的比例。</div></div>' +
            [["林敬轩", "所有者", "12.4 GB", 29, "林", "linjx@kunqiong.cn"], ["王磊", "管理员", "9.8 GB", 23, "王", "wang.lei@kunqiong.cn"], ["陈静", "成员", "7.2 GB", 17, "陈", "chen.jing@kunqiong.cn"], ["赵敏", "成员", "6.1 GB", 14, "赵", "zhao.min@kunqiong.cn"], ["周涛", "成员", "4.2 GB", 10, "周", "zhou.tao@kunqiong.cn"], ["孙悦", "成员", "2.9 GB", 7, "孙", "sun.yue@kunqiong.cn"], ["李航", "待加入", "0 B", 0, "李", "li.hang@kunqiong.cn"], ["吴敏", "成员", "0 B", 0, "吴", "wu.min@kunqiong.cn"]].map(function (m) {
              return '<div class="member-usage"><span class="avatar sm">' + m[4] + '</span><div class="grow"><div class="mu-line"><b>' + m[0] + '</b><small>' + m[1] + ' · ' + m[5] + '</small></div><div class="progress sm ' + (m[3] ? "" : "empty") + '"><i style="width:' + (m[3] * 3) + '%"></i></div></div><span class="mu-value"><b>' + m[2] + '</b><small>' + (m[3] ? "占总容量 " + (m[3] / 4).toFixed(1) + "%" : "未使用") + '</small></span><button class="icon-act" title="更多">' + K.icon("more", 15) + '</button></div>';
            }).join("") +
          '</div><div class="card-ft"><div class="flex between"><span class="tiny">共 8 位成员</span><div class="pager"><button class="btn ghost sm" disabled>上一页</button><span class="tiny">1 / 1</span><button class="btn ghost sm" disabled>下一页</button></div></div></div>'
        );
      }
    },

    {
      id: "team-resources", group: "space", nav: "space", title: "团队资源", no: "44",
      render: function () {
        return teamPage("resources",
          '<div class="card"><div class="card-hd" style="align-items:center"><div><p class="eyebrow">团队资源</p><h3 style="margin-top:3px">专属团队文件</h3></div><div class="flex"><label class="search-box sm">' + K.icon("search", 14) + '<input placeholder="检索文件名或上传成员"/></label><button class="btn primary sm" data-toast="已选择 3 个文件">' + K.icon("upload", 14) + '批量上传</button><button class="btn ghost sm" data-toast="已选择文件夹">' + K.icon("folder", 14) + '上传文件夹</button></div></div>' +
          '<div class="card-bd" style="padding:0">' +
            '<div class="team-upload-draft"><div class="grow"><b>待上传 3 个文件</b><span>共 214.6 MB · 可继续选择文件追加</span></div><button class="btn primary sm" data-toast="开始上传 3 个文件">开始上传</button><button class="icon-act" data-toast="已清除待上传文件">' + K.icon("x", 15) + '</button></div>' +
            '<div class="res-table"><div class="res-head"><span>资源</span><span>上传者</span><span>大小</span><span>状态</span><span class="r">操作</span></div>' +
              [["品牌视觉规范.pdf", "ft-pdf", "王磊", "24.6 MB", "有效", "ok", "今天 14:08"], ["秋季活动素材.zip", "ico-folder", "陈静", "186.0 MB", "有效", "ok", "昨天 18:20"], ["产品演示.pptx", "ft-ppt", "林敬轩", "48.2 MB", "有效", "ok", "10-18"], ["供应商材料收集", "act-clipboard", "林敬轩", "23 个文件", "收集中", "blue", "10-20"], ["旧版报价单.pdf", "ft-pdf", "周涛", "8.2 MB", "已关闭", "", "10-12"]].map(function (r) {
                return '<div class="res-row"><div class="rec-name"><img src="assets/icons/' + r[1] + '.png" alt=""/><div><b>' + r[0] + '</b><small>' + r[6] + '</small></div></div><span class="rec-exp">' + r[2] + '</span><span class="mono rec-size">' + r[3] + '</span><span><span class="badge ' + r[5] + '"><i></i>' + r[4] + '</span></span><span class="row-acts"><button class="icon-act" title="预览">' + K.icon("eye", 15) + '</button><button class="icon-act" title="下载">' + K.icon("download", 15) + '</button><button class="icon-act" title="管理" data-go="share-manage">' + K.icon("settings", 15) + '</button><button class="icon-act danger" title="删除">' + K.icon("trash", 15) + '</button></span></div>';
              }).join("") + '</div>' +
          '</div><div class="card-ft"><div class="flex between"><span class="tiny">共 18 个资源 · 126 个文件</span><div class="pager"><button class="btn ghost sm" disabled>上一页</button><span class="tiny">1 / 2</span><button class="btn ghost sm">下一页</button></div></div></div>'
        );
      }
    },

    {
      id: "team-permissions", group: "space", nav: "space", title: "团队成员", no: "45",
      render: function () {
        return teamPage("manage",
          '<div class="card"><div class="card-hd" style="align-items:center"><div><p class="eyebrow">团队成员</p><h3 style="margin-top:3px">成员权限</h3></div><label class="search-box sm">' + K.icon("search", 14) + '<input placeholder="检索成员"/></label></div>' +
          '<div class="card-bd" style="padding-top:4px">' +
            [["林敬轩", "所有者", "owner", "林"], ["王磊", "管理员", "admin", "王"], ["陈静", "成员", "member", "陈"], ["赵敏", "成员", "member", "赵"], ["周涛", "成员", "member", "周"], ["孙悦", "成员", "member", "孙"], ["李航", "待加入", "invited", "李"]].map(function (m) {
              return '<div class="perm-row"><span class="avatar sm">' + m[3] + '</span><div class="grow"><b>' + m[0] + '</b><small>' + (m[2] === "invited" ? "邀请已发送 · 等待接受" : m[2] === "owner" ? "团队所有者 · 全部权限" : m[2] === "admin" ? "可管理成员与资源" : "可上传与下载团队文件") + '</small></div><span class="badge ' + (m[2] === "owner" ? "violet" : m[2] === "admin" ? "blue" : m[2] === "invited" ? "warn" : "") + '">' + m[1] + '</span>' +
                (m[2] === "owner" ? '<span class="tiny" style="width:74px;text-align:right">不可移除</span>' : '<div class="flex"><button class="btn ghost sm" data-toast="已更新' + m[0] + '的角色">' + (m[2] === "admin" ? "撤销管理员" : "设为管理员") + '</button><button class="icon-act danger" data-toast="已移除' + m[0] + '">' + K.icon("x", 15) + '</button></div>') + '</div>';
            }).join("") +
          '</div><div class="card-ft"><span class="tiny">成员上限 10 人，当前 8 人（1 人待加入）</span></div></div>' +
          '<div class="danger-zone mt16"><h4>' + K.icon("alertTriangle", 14) + '解散团队</h4><p>解散后全部成员立即失去团队空间访问权，团队无法恢复。各成员的个人文件与套餐权益不受影响。</p><button class="btn danger sm" data-toast="解散团队需要二次确认（原型演示）">' + K.icon("trash", 14) + '解散团队</button></div>'
        );
      }
    },

    {
      id: "team-requests", group: "space", nav: "space", title: "入团申请", no: "46",
      render: function () {
        return teamPage("requests",
          '<div class="card"><div class="card-hd"><div><p class="eyebrow">入团申请</p><h3 style="margin-top:3px">待处理申请</h3></div><span class="badge warn">2 条待处理</span></div><div class="card-bd">' +
            '<div class="request-card"><span class="avatar">郑</span><div class="grow"><b>郑一鸣</b><small>zheng.yiming@kunqiong.cn · 申请加入「鲲穹设计团队」</small><p class="req-note">"负责品牌视觉，想加入团队共享素材与设计规范。"</p><small class="tiny">申请于 今天 10:24 · 经由邀请链接</small></div><div class="req-actions"><button class="btn primary sm" data-toast="已通过郑一鸣的入团申请">通过</button><button class="btn ghost sm" data-toast="已拒绝该申请">拒绝</button></div></div>' +
            '<div class="request-card"><span class="avatar">许</span><div class="grow"><b>许文</b><small>xu.wen@kunqiong.cn · 申请加入「鲲穹设计团队」</small><p class="req-note">"外部合作方的交互设计师，需要查看共享的交付文件。"</p><small class="tiny">申请于 昨天 19:02 · 经由邀请链接</small></div><div class="req-actions"><button class="btn primary sm" data-toast="已通过许文的入团申请">通过</button><button class="btn ghost sm" data-toast="已拒绝该申请">拒绝</button></div></div>' +
            '<div class="banner info mt16">' + K.icon("info", 15) + '<div>通过后成员将立即获得团队资源访问权，可随时在「团队成员」中调整角色或移除。</div></div>' +
          '</div></div>' +
          '<div class="card mt16"><div class="card-hd"><h3>邀请链接</h3><span class="badge ok"><i></i>有效</span></div><div class="card-bd"><div class="copy-line"><input class="input" readonly value="https://kq.cn/e/kunqiong-design"/><button class="btn ghost sm" data-copy="https://kq.cn/e/kunqiong-design">' + K.icon("copy", 14) + '复制</button><button class="btn ghost sm" data-toast="邀请链接已重置">重置</button></div><p class="hint" style="margin-top:7px">任何持有链接的人都可以申请加入，需管理员审批。链接 7 天后过期。</p></div></div>'
        );
      }
    },

    {
      id: "invite", group: "space", title: "团队邀请", no: "47", layout: "public", noFooter: true,
      render: function () {
        return '<div class="invite-wrap"><div class="invite-card public-card">' +
          '<div class="invite-top"><span class="team-logo lg">' + K.icon("building", 24) + '</span><span class="badge blue">团队空间邀请</span></div>' +
          '<h1>你收到一个团队空间邀请</h1><p class="invite-sub">林敬轩 邀请你加入「鲲穹设计团队」，一起共享文件与收集任务。</p>' +
          '<div class="invite-team"><div class="flex between"><div><b>鲲穹设计团队</b><small>8 位成员 · 团队版</small></div><span class="badge">200 GB 共享空间</span></div><div class="team-avatars mt12"><span class="avatar sm">林</span><span class="avatar sm">王</span><span class="avatar sm">陈</span><span class="avatar sm">赵</span><span class="avatar sm more">+4</span></div></div>' +
          '<ul class="invite-benefits"><li>' + K.icon("checkCircle", 16) + '<div><b>共享 200 GB 团队空间</b><small>团队文件独立于个人容量</small></div></li><li>' + K.icon("checkCircle", 16) + '<div><b>访问团队专属资源</b><small>品牌素材、交付文件与设计规范</small></div></li><li>' + K.icon("checkCircle", 16) + '<div><b>参与团队收集任务</b><small>统一提交与归档</small></div></li></ul>' +
          '<button class="btn primary block lg" data-toast="已提交加入申请，等待管理员审批">接受邀请并加入</button>' +
          '<p class="tiny center" style="margin-top:12px">加入需要登录鲲穹账号 · 管理员审批后生效</p>' +
          '<div class="invite-foot"><span>邀请于 2026-10-20 发出</span><a href="#/send-home">暂不加入</a></div>' +
        '</div><p class="tiny center mt16" style="color:#a3b1c4">鲲穹文件传输 · 团队协作，从一次分享开始</p></div>';
      }
    }
  ]);
})();
