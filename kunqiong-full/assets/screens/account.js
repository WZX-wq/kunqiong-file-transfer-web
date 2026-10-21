/* 05 · 账户与设置 */
(function () {
  var K = window.KQ;

  K.register([
    {
      id: "login", group: "account", title: "登录", no: "31", layout: "auth",
      render: function () {
        return '<div class="auth-wrap">' +
          '<section class="auth-art">' +
            '<a class="brand" href="#/send-home"><img class="brand-mark" src="assets/icons/ico-cloud.png?v=2" alt=""/><span>鲲穹文件传输</span></a>' +
            '<h1>登录后<br/><em>文件走得更远</em></h1>' +
            '<p>20 GB 个人容量、跨设备收发记录、收集任务与团队协作，一次登录全部打通。</p>' +
            '<img class="art-img" src="assets/icons/hero.png" alt=""/>' +
            '<ul><li>' + K.icon("shield", 15) + '传输加密</li><li>' + K.icon("history", 15) + '记录同步</li><li>' + K.icon("users", 15) + '团队共享</li></ul>' +
          '</section>' +
          '<section class="auth-panel"><div class="auth-card">' +
            '<h2>欢迎回来</h2><p class="sub">使用微信扫码或手机号登录鲲穹账号</p>' +
            '<div class="auth-tabs"><button class="active">微信扫码</button><button>手机号登录</button></div>' +
            '<div class="login-qr"><div class="qr lg">' + K.qrSvg(551188) + '</div><p>打开微信扫一扫<br/><span>扫码后请在手机上确认登录</span></p></div>' +
            '<div class="oauth-row"><button class="oauth-btn" data-toast="正在唤起企业微信授权">' + K.icon("building", 15) + '企业微信</button><button class="oauth-btn" data-toast="正在唤起邮箱登录">' + K.icon("mail", 15) + '邮箱登录</button></div>' +
            '<div class="divider-or">或</div>' +
            '<div class="field"><div class="phone-row"><select class="select"><option>+86</option><option>+852</option></select><input class="input" placeholder="请输入手机号"/></div></div>' +
            '<div class="field mt12"><div class="code-row"><input class="input" placeholder="6 位短信验证码"/><button class="btn ghost">获取验证码</button></div></div>' +
            '<button class="btn primary block mt16" data-go="send-home">登录 / 注册</button>' +
            '<p class="auth-note">登录即表示同意 <a href="#/terms" style="color:#2a5ea8">服务协议</a> 与 <a href="#/privacy" style="color:#2a5ea8">隐私政策</a><br/>未注册的手机号将自动创建账号</p>' +
            '<p class="auth-note" style="margin-top:10px"><a href="#/send-home" style="color:#7d8ea6">暂不登录，以游客身份使用 →</a></p>' +
          '</div></section>' +
        '</div>';
      }
    },

    {
      id: "settings-profile", group: "account", nav: "", title: "个人资料", no: "32",
      render: function () {
        var body = '<div class="card form-compact">' +
          '<div class="profile-head"><span class="avatar lg">林</span><div class="grow"><b>林敬轩</b><small>账号 ID：U-882014 · 注册于 2025-03-12</small></div><div class="flex" style="gap:8px"><button class="btn ghost sm" data-toast="已选择新头像">更换头像</button><button class="btn ghost sm" data-toast="已恢复默认头像">恢复默认</button></div><div class="plan-chip">' + K.icon("crown", 14) + '<span>会员版</span><small>2027-06-18 到期</small></div></div>' +
          '<div class="form-row"><label>昵称</label><div class="body"><div class="field"><input class="input" value="林敬轩" maxlength="20"/></div><p class="hint">2–20 个字符，显示在分享页与团队列表</p></div></div>' +
          '<div class="form-row"><label>邮箱</label><div class="body"><div class="field"><input class="input" value="linjx@kunqiong.cn" style="max-width:300px"/></div><p class="hint">用于接收取件通知与安全提醒</p></div></div>' +
          '<div class="form-row"><label>手机号</label><div class="body body-inline"><div class="field"><input class="input" value="138****6721" style="max-width:200px"/></div><span class="badge ok"><i></i>已绑定</span><button class="btn ghost sm" data-toast="验证码已发送">更换</button><p class="hint">用于登录与安全验证</p></div></div>' +
          '<div class="form-row"><label>个人简介</label><div class="body"><div class="field"><textarea class="textarea" rows="2" maxlength="80" placeholder="介绍一下自己（选填）">产品设计师，负责鲲穹文件传输的体验与视觉。</textarea></div><p class="hint">最多 80 字，仅团队成员可见</p></div></div>' +
          '<div class="form-row"><label>默认署名</label><div class="body"><div class="field"><input class="input" value="林敬轩 · 鲲穹设计" style="max-width:300px"/></div><p class="hint">接收方在分享页看到的发送人</p></div></div>' +
          '<div class="form-foot"><button class="btn ghost" data-toast="已取消修改">取消</button><button class="btn primary" data-toast="资料已保存">保存资料</button></div>' +
        '</div>' +
        '<div class="card mt16 stat-strip"><div><span>已用容量</span><b>6.4 GB</b><small>/ 20 GB</small></div><div><span>本月发送</span><b>28 次</b><small>共 12.6 GB</small></div><div><span>收集任务</span><b>3 个</b><small>2 个进行中</small></div><a class="text-btn" href="#/settings-cleanup">容量明细 ' + K.icon("chevronRight", 13) + '</a></div>';
        return K.settingsLayout("profile", body, "个人资料", "管理在鲲穹文件传输中展示的账户信息。", '<a class="btn ghost sm" href="#/workspace">' + K.icon("crown", 14) + '会员权益</a>');
      }
    },

    {
      id: "settings-security", group: "account", nav: "", title: "账号与安全", no: "33",
      render: function () {
        var body = '<div class="card dense"><div class="card-hd"><h3>账号安全</h3><span class="tiny">已绑定 3 种登录方式</span></div><div class="card-bd group-list">' +
          '<div class="group-label">登录方式</div>' +
          '<div class="bind-row"><span class="bind-ico wechat">' + K.icon("message", 17) + '</span><div class="grow"><b>微信</b><small>已绑定 · 林敬轩（lin***@wx）</small></div><span class="badge ok"><i></i>已绑定</span><button class="btn ghost sm" data-toast="解绑前需验证其他登录方式">解绑</button></div>' +
          '<div class="bind-row"><span class="bind-ico phone">' + K.icon("phone", 17) + '</span><div class="grow"><b>手机号</b><small>138****6721 · 用于登录与安全验证</small></div><span class="badge ok"><i></i>已绑定</span><button class="btn ghost sm" data-toast="验证码已发送">更换</button></div>' +
          '<div class="bind-row"><span class="bind-ico mail">' + K.icon("mail", 17) + '</span><div class="grow"><b>邮箱</b><small>linjx@kunqiong.cn · 接收取件与到期通知</small></div><span class="badge ok"><i></i>已验证</span><button class="btn ghost sm" data-toast="验证邮件已发送">更换</button></div>' +
          '<div class="group-label">密码</div>' +
          '<div class="switch-row"><div><b>登录密码</b><small>上次修改 2026-06-18 · 建议每 6 个月更新一次</small></div><span class="badge">强度：中</span><button class="btn ghost sm" data-toast="已发送重置链接到邮箱">修改密码</button></div>' +
          '<div class="group-label">登录设备</div>' +
          '<div class="device-row"><span class="bind-ico">' + K.icon("server", 17) + '</span><div class="grow"><b>MacBook Pro · Chrome</b><small>上海 · 当前设备 · 今天 16:02</small></div><span class="badge ok"><i></i>在线</span></div>' +
          '<div class="device-row"><span class="bind-ico">' + K.icon("phone", 17) + '</span><div class="grow"><b>iPhone 16 Pro · 微信</b><small>上海 · 昨天 21:14</small></div><button class="btn ghost sm" data-toast="已退出该设备">退出</button></div>' +
          '<div class="device-row"><span class="bind-ico">' + K.icon("server", 17) + '</span><div class="grow"><b>Windows · Edge</b><small>杭州 · 10-16 09:30</small></div><button class="btn ghost sm" data-toast="已退出该设备">退出</button></div>' +
          '<div class="flex between" style="padding-top:12px"><span class="tiny">' + K.icon("shield", 13) + ' 开启双重验证后，新设备登录需要短信验证码。</span><button class="btn danger sm" data-toast="已退出除当前设备外的所有会话">退出其他设备</button></div>' +
        '</div></div>';
        return K.settingsLayout("security", body, "账号与安全", "查看登录方式、设备与安全状态。");
      }
    },

    {
      id: "settings-notice", group: "account", nav: "", title: "消息通知", no: "34",
      render: function () {
        var body = '<div class="card dense"><div class="card-hd"><h3>通知设置</h3><span class="tiny">修改后自动保存</span></div><div class="card-bd group-list">' +
          '<div class="group-label">通知方式</div>' +
          '<div class="switch-row"><div><b>站内消息</b><small>在消息中心接收文件动态、收集提交与系统通知。</small></div><button class="switch on" data-toggle data-toggle-msg="已开启站内消息"></button></div>' +
          '<div class="switch-row"><div><b>邮件通知</b><small>发送到 linjx@kunqiong.cn，可随时关闭。</small></div><button class="switch on" data-toggle data-toggle-msg="已开启邮件通知"></button></div>' +
          '<div class="switch-row"><div><b>浏览器推送</b><small>需要浏览器授权，适合及时接收上传完成提醒。</small></div><button class="switch" data-toggle data-toggle-msg="已开启浏览器推送"></button></div>' +
          '<div class="group-label">文件与任务动态</div>' +
          '<div class="switch-row"><div><b>收到新文件</b><small>有人通过链接发文件给我时提醒。</small></div><button class="switch on" data-toggle></button></div>' +
          '<div class="switch-row"><div><b>分享即将到期</b><small>到期前 24 小时提醒，每天最多一次。</small></div><button class="switch on" data-toggle></button></div>' +
          '<div class="switch-row"><div><b>文件被下载</b><small>分享文件被下载时提醒；高频下载会合并为一条。</small></div><button class="switch on" data-toggle></button></div>' +
          '<div class="switch-row"><div><b>收集任务有新提交</b><small>提交人上传完成后立即提醒。</small></div><button class="switch on" data-toggle></button></div>' +
          '<div class="switch-row"><div><b>收集任务即将截止</b><small>截止前 24 小时提醒任务创建者。</small></div><button class="switch" data-toggle></button></div>' +
          '<div class="group-label">免打扰</div>' +
          '<div class="switch-row"><div><b>夜间免打扰</b><small>22:00–08:00 不发送邮件与推送，站内消息仍会记录。</small></div><button class="switch on" data-toggle></button></div>' +
          '<div class="flex between" style="padding-top:10px"><span class="tiny">当前时段：22:00 – 次日 08:00</span><button class="btn ghost sm" data-toast="免打扰时间已更新">调整时间</button></div>' +
        '</div></div>';
        return K.settingsLayout("notice", body, "消息通知", "选择你希望收到的账户和文件动态提醒，修改会自动保存。");
      }
    },

    {
      id: "settings-cleanup", group: "account", nav: "", title: "文件清理", no: "35",
      render: function () {
        var body = '<div class="card dense"><div class="card-hd"><h3>存储与清理</h3><span class="badge violet">会员版 20 GB</span></div><div class="card-bd group-list">' +
          '<div class="group-label">存储空间</div>' +
          '<div class="storage-head"><div><b>6.4 GB</b><span> / 20 GB</span></div><span class="tiny">已用 32%</span></div><div class="progress"><i style="width:32%"></i></div>' +
          '<div class="storage-legend"><span><i style="background:#1f6bff"></i>有效文件 3.9 GB</span><span><i style="background:#9cc2ff"></i>即将过期 1.2 GB</span><span><i style="background:#e2ebf8"></i>已过期待清理 1.3 GB</span></div>' +
          '<div class="banner warn mt12">' + K.icon("alertTriangle", 15) + '<div>已过期文件仍占用容量，清理后才会释放。</div></div>' +
          '<div class="group-label">自动清理规则</div>' +
          '<div class="switch-row"><div><b>到期后自动删除文件</b><small>关闭后文件到期仍会保留 7 天，之后进入清理队列。</small></div><button class="switch on" data-toggle data-toggle-msg="已开启自动清理"></button></div>' +
          '<div class="switch-row"><div><b>清理已下载的接收文件</b><small>接收并下载完成的文件保留 7 天后自动清理。</small></div><button class="switch on" data-toggle></button></div>' +
          '<div class="switch-row"><div><b>清理无访问的分享</b><small>连续 30 天无访问的分享自动关闭并清理。</small></div><button class="switch" data-toggle></button></div>' +
          '<div class="form-row" style="padding-bottom:0"><label>清理宽限期</label><div class="body"><div class="seg"><button>立即</button><button class="active">7 天</button><button>15 天</button><button>30 天</button></div><p class="hint">宽限期内仍可通过原链接访问</p></div></div>' +
          '<div class="group-label">手动清理<span class="tiny" style="font-weight:400;letter-spacing:0">可释放约 2.5 GB</span></div>' +
          '<div class="clean-row"><img src="assets/icons/ico-folder.png" alt=""/><div class="grow"><b>已过期分享文件</b><small>18 个文件 · 1.3 GB · 最早 2026-09-12</small></div><button class="btn ghost sm" data-toast="已清理 18 个文件，释放 1.3 GB">清理</button></div>' +
          '<div class="clean-row"><img src="assets/icons/act-download.png?v=2" alt=""/><div class="grow"><b>已下载的接收文件</b><small>9 个文件 · 1.2 GB</small></div><button class="btn ghost sm" data-toast="已清理 9 个文件，释放 1.2 GB">清理</button></div>' +
          '<div class="clean-row"><img src="assets/icons/act-trash.png" alt=""/><div class="grow"><b>回收站</b><small>3 个文件 · 240 MB · 保留 30 天</small></div><button class="btn danger sm" data-toast="回收站已清空">清空</button></div>' +
        '</div></div>';
        return K.settingsLayout("cleanup", body, "文件清理", "控制已过期文件是否自动删除，清理后才会释放账号容量。");
      }
    },

    {
      id: "settings-orders", group: "account", nav: "", title: "我的订单", no: "36",
      render: function () {
        var orders = [
          ["KQ202610180012", "会员版 · 年付", "¥ 168.00", "已开通", "paid", "2026-10-18 10:12", "有效期至 2027-06-18"],
          ["KQ202606180007", "会员版 · 年付", "¥ 168.00", "已开通", "paid", "2026-06-18 09:40", "已续期"],
          ["KQ202603020021", "团队版 · 月付", "¥ 39.00", "已取消", "cancel", "2026-03-02 14:05", "未支付，15 分钟后关闭"],
          ["KQ202512120003", "会员版 · 月付", "¥ 19.00", "已过期", "expire", "2025-12-12 20:11", "支付超时"]
        ];
        var body = '<div class="card"><div class="card-hd" style="align-items:center"><div class="flex"><h3>订单记录</h3><span class="badge">4</span></div><div class="flex"><select class="select" style="width:132px;height:34px"><option>全部状态</option><option>已开通</option><option>待支付</option><option>已取消</option><option>已过期</option></select><button class="btn ghost sm" data-toast="已导出订单 CSV">' + K.icon("download", 13) + '导出</button></div></div>' +
          '<div class="card-bd" style="padding:0">' +
            orders.map(function (o) {
              return '<div class="order-row"><div class="order-main"><span class="order-ico">' + K.icon("crown", 17) + '</span><div class="grow"><b>' + o[1] + '</b><small>订单号 ' + o[0] + ' · ' + o[5] + '</small></div><div class="order-amount"><b>' + o[2] + '</b><small>' + o[6] + '</small></div><span class="orders-status ' + o[4] + '"><i></i>' + o[3] + '</span><a class="btn ghost sm" href="#/order-detail">查看</a></div></div>';
            }).join("") +
          '</div><div class="card-ft"><div class="flex between"><span class="tiny">共 4 笔订单 · 累计支付 ¥ 336.00</span><div class="pager"><button class="btn ghost sm" disabled>上一页</button><span class="tiny">1 / 1</span><button class="btn ghost sm" disabled>下一页</button></div></div></div></div>' +
          '<div class="banner info mt16">' + K.icon("info", 15) + '<div>订单用于记录会员与团队套餐购买。企业版或对公转账订单请联系客户经理，不在此列表中。</div></div>';
        return K.settingsLayout("orders", body, "我的订单", "查询会员套餐订单和支付状态。");
      }
    },

    {
      id: "order-detail", group: "account", nav: "", title: "订单详情", no: "37",
      render: function () {
        var body = '<div class="card"><div class="card-hd"><div><p class="eyebrow">订单详情</p><h3 style="margin-top:4px">会员版 · 年付</h3></div><span class="orders-status paid"><i></i>已开通</span></div><div class="card-bd">' +
          '<div class="order-hero"><div><span>实付金额</span><b>¥ 168.00</b></div><span class="tiny">支付时间 2026-10-18 10:12</span></div>' +
          '<dl class="detail-list two-col"><div><dt>订单号</dt><dd class="mono">KQ202610180012</dd></div><div><dt>套餐</dt><dd>会员版 · 年付（12 个月）</dd></div><div><dt>支付方式</dt><dd>微信支付</dd></div><div><dt>开通时间</dt><dd>2026-10-18 10:12</dd></div><div><dt>有效期</dt><dd>2026-10-18 至 2027-10-18</dd></div><div><dt>发票</dt><dd><button class="text-btn" data-toast="已提交开票申请">申请电子发票</button></dd></div></dl>' +
          '<div class="timeline compact"><div class="tl-item done"><i>' + K.icon("check", 11) + '</i><div><b>订单已创建</b><small>2026-10-18 10:10</small></div></div><div class="tl-item done"><i>' + K.icon("check", 11) + '</i><div><b>支付成功</b><small>2026-10-18 10:12 · 微信支付 ¥ 168.00</small></div></div><div class="tl-item done"><i>' + K.icon("check", 11) + '</i><div><b>会员权益已开通</b><small>2026-10-18 10:12 · 容量升级至 20 GB</small></div></div></div>' +
          '<div class="banner success mt16">' + K.icon("checkCircle", 15) + '<div>本单权益已生效，可在 <a href="#/workspace" style="color:#0d7a4c;text-decoration:underline">会员与团队空间</a> 查看当前容量与到期时间。</div></div>' +
          '<div class="form-foot"><button class="btn ghost" data-toast="订单凭证已下载">下载凭证</button><a class="btn primary" href="#/workspace">查看会员权益</a></div>' +
        '</div></div>';
        return K.settingsLayout("orders", body, "订单详情", "查看本笔订单的支付与开通记录。", '<a class="btn ghost sm" href="#/settings-orders">' + K.icon("chevronLeft", 14) + '返回订单列表</a>');
      }
    }
  ]);
})();
