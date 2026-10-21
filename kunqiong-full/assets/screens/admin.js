/* 07 · 运营后台 */
(function () {
  var K = window.KQ;

  var NAV = [["admin-dashboard", "数据看板"], ["admin-resources", "资源管理"], ["admin-users", "用户管理"], ["admin-logs", "安全日志"], ["admin-config", "系统配置"]];

  function adminHeading(title, sub, actions) {
    return '<div class="admin-heading"><div><p class="eyebrow">鲲穹运营后台</p><h1>' + title + '</h1><p>' + sub + '</p></div><div class="admin-heading-actions">' + (actions || '<span class="admin-identity">' + K.icon("shield", 13) + ' admin@kunqiong.cn</span><button class="btn ghost sm" data-toast="数据已刷新">' + K.icon("refresh", 13) + '刷新数据</button><button class="btn ghost sm" data-go="admin-login">' + K.icon("logout", 13) + '退出</button>') + '</div></div>';
  }

  K.register([
    {
      id: "admin-login", group: "admin", title: "管理员登录", no: "48", layout: "bare",
      render: function () {
        return '<div class="admin-login">' +
          '<div class="al-left"><div class="al-brand"><img src="assets/icons/ico-cloud.png?v=2" alt=""/><span>鲲穹运营后台</span><span class="badge">内部系统</span></div>' +
            '<div class="al-copy"><span class="eyebrow" style="color:#7fa4d8">Operations Console</span><h1>统一查看用户、<br/>资源与系统运行状态</h1><p>仅限授权管理员访问。所有操作都会写入审计日志，请妥善保管账号。</p>' +
            '<ul><li>' + K.icon("shield", 15) + '独立管理员会话</li><li>' + K.icon("database", 15) + '资源与容量管理</li><li>' + K.icon("sliders", 15) + '运行参数配置</li></ul></div>' +
            '<p class="al-foot">© 2026 鲲穹科技 · 内部系统，请勿对外分享</p>' +
          '</div>' +
          '<div class="al-right"><div class="al-card">' +
            '<h2>管理员登录</h2><p class="sub">使用后台账号登录，与前台账号相互独立。</p>' +
            '<div class="field mt20"><span class="label">管理员账号</span><input class="input" value="admin@kunqiong.cn" autocomplete="off"/></div>' +
            '<div class="field mt14"><span class="label">密码</span><input class="input" type="password" value="••••••••••" autocomplete="off"/></div>' +
            '<div class="flex between mt14"><label class="checkline"><input type="checkbox" checked/> 记住此设备</label><a class="text-btn" href="#/help" style="font-size:12.4px">忘记密码</a></div>' +
            '<button class="btn primary block mt20" data-go="admin-dashboard">登录后台</button>' +
            '<div class="banner warn mt16">' + K.icon("alertTriangle", 15) + '<div>连续 5 次失败将锁定 30 分钟；异常登录会触发安全告警。</div></div>' +
            '<p class="tiny center mt16"><a href="#/send-home" style="color:#7d8ea6">← 返回前台</a></p>' +
          '</div></div>' +
        '</div>';
      }
    },

    {
      id: "admin-dashboard", group: "admin", adminTab: "dashboard", title: "数据看板", no: "49", layout: "admin",
      render: function () {
        var trend = [["10-14", 58, 74, 62], ["10-15", 64, 82, 68], ["10-16", 72, 91, 74], ["10-17", 66, 78, 70], ["10-18", 81, 106, 88], ["10-19", 74, 96, 79], ["10-20", 88, 118, 96]];
        function colH(v) { return (v / 1.2).toFixed(1) + "%"; }
        return adminHeading("系统管理", "统一查看用户、安全日志、运行配置和系统概览。") +
          '<div class="admin-kpi-grid">' +
            [["用户总数", "1,284", "+38 本周", "users"], ["活跃用户", "412", "近 7 天", "zap"], ["资源总数", "3,796", "分享 2,410 · 收集 1,386", "database"], ["存储占用", "8.42 TB", "共 12 TB", "drive"]].map(function (k) {
              return '<div class="admin-kpi"><span>' + K.icon(k[3], 16) + ' ' + k[0] + '</span><strong>' + k[1] + '</strong><small>' + k[2] + '</small></div>';
            }).join("") +
          '</div>' +
          '<div class="admin-columns">' +
            '<div class="public-card admin-panel"><div class="admin-panel-heading"><div><p class="eyebrow">近 7 天</p><h2>运营趋势</h2></div><span class="badge ok">较上周 +12%</span></div>' +
              '<div class="admin-trend-chart">' +
                '<div class="tc-axis">' + [120, 80, 40, 0].map(function (v, i) { return '<span style="top:' + (i * 33.3333).toFixed(2) + '%">' + v + '</span>'; }).join("") + '</div>' +
                '<div class="tc-plot"><div class="tc-lines"><i></i><i></i><i></i><i></i></div><div class="tc-groups">' +
                  trend.map(function (d) {
                    return '<div class="tc-day" data-tip="活跃 ' + d[1] + ' · 上传 ' + d[2] + ' · 下载 ' + d[3] + '"><b class="a" style="height:' + colH(d[1]) + '"></b><b class="u" style="height:' + colH(d[2]) + '"></b><b class="d" style="height:' + colH(d[3]) + '"></b></div>';
                  }).join("") +
                '</div></div>' +
                '<div class="tc-x">' + trend.map(function (d) { return '<span>' + d[0] + '</span>'; }).join("") + '</div>' +
              '</div>' +
              '<small class="admin-trend-legend"><span><i></i>活跃用户</span><span><i class="upload"></i>上传</span><span><i class="download"></i>下载</span></small></div>' +
            '<div class="public-card admin-panel"><div class="admin-panel-heading"><div><p class="eyebrow">资源状态</p><h2>运营概览</h2></div></div><div class="admin-status-list"><span><i class="status-dot active"></i> 活跃资源 <strong>3,412</strong></span><span><i class="status-dot muted"></i> 已禁用用户 <strong>17</strong></span><span><i class="status-dot review"></i> 团队空间 <strong>46</strong></span><span><i class="status-dot warn"></i> 待清理资源 <strong>284</strong></span></div>' +
              '<div class="admin-log-list">' +
                [["管理员 admin 导出资源清单", "今天 15:42 · 成功"], ["清理任务释放 126 GB", "今天 04:00 · 成功"], ["拦截高风险上传 3 次", "今天 11:08 · 已阻止"], ["团队空间 鲲穹设计 续费", "昨天 18:20 · 成功"]].map(function (l) {
                  return '<div><span>' + l[0] + '</span><small>' + l[1] + '</small></div>';
                }).join("") + '</div></div>' +
          '</div>' +
          '<div class="public-card admin-panel mt16"><div class="admin-panel-heading"><div><p class="eyebrow">快捷操作</p><h2>常用入口</h2></div></div><div class="admin-quick"><a href="#/admin-resources">' + K.icon("database", 18) + '<b>资源管理</b><small>查看与删除分享、收集</small></a><a href="#/admin-users">' + K.icon("users", 18) + '<b>用户管理</b><small>调整套餐与禁用账号</small></a><a href="#/admin-logs">' + K.icon("shield", 18) + '<b>安全日志</b><small>审计与异常追踪</small></a><a href="#/admin-config">' + K.icon("sliders", 18) + '<b>系统配置</b><small>上传限制与套餐参数</small></a></div></div>';
      }
    },

    {
      id: "admin-resources", group: "admin", adminTab: "resources", title: "资源管理", no: "50", layout: "admin",
      render: function () {
        return adminHeading("资源管理", "查看全部分享与收集任务，支持按名称、ID、提取码或归属用户检索。", '<span class="admin-identity">' + K.icon("shield", 13) + ' admin@kunqiong.cn</span><button class="btn ghost sm" data-toast="已导出资源清单 CSV">' + K.icon("download", 13) + '导出</button>') +
          '<div class="public-card admin-panel"><div class="admin-panel-heading"><div><p class="eyebrow">分享与收集</p><h2>全部资源</h2></div><span>共 3,796 个资源 · 仅显示前 200 条</span></div>' +
            '<label class="admin-search">' + K.icon("search", 15) + '<input placeholder="搜索资源名称、ID、提取码或归属用户"/></label>' +
            '<div class="admin-table"><div class="admin-table-row head"><span>资源</span><span>类型</span><span>状态</span><span>大小</span><span>创建时间</span><span class="r">操作</span></div>' +
              [["2026 产品报价单.pdf", "share", "林敬轩", "有效", "13.0 MB", "2026-10-20 16:08"], ["项目交付资料.zip", "share", "林敬轩", "有效", "268.4 MB", "2026-10-20 14:22"], ["2026 Q4 供应商资质材料", "collect", "林敬轩", "收集中", "1.8 GB", "2026-10-19 10:12"], ["秋季活动照片收集", "collect", "陈静", "已截止", "3.2 GB", "2026-09-28 09:40"], ["旧版合同.pdf", "share", "王磊", "已过期", "8.2 MB", "2026-09-12 15:02"], ["品牌视觉规范.pdf", "share", "赵敏", "已禁用", "24.6 MB", "2026-10-18 11:20"]].map(function (r) {
                return '<div class="admin-table-row"><div class="admin-user-identity"><strong>' + r[0] + '</strong><span>' + (r[1] === "share" ? "分享" : "收集") + ' · 归属 ' + r[2] + ' · ID ' + (r[1] === "share" ? "s_" : "c_") + Math.random().toString(36).slice(2, 8) + '</span></div><span><span class="badge ' + (r[1] === "share" ? "blue" : "violet") + '">' + (r[1] === "share" ? "分享" : "收集") + '</span></span><span><span class="badge ' + (r[3] === "有效" || r[3] === "收集中" ? "ok" : r[3] === "已禁用" ? "danger" : "") + '">' + r[3] + '</span></span><span class="mono tiny">' + r[4] + '</span><span class="tiny">' + r[5] + '</span><span class="row-acts"><button class="icon-act" title="查看" data-go="share-manage">' + K.icon("eye", 15) + '</button><button class="icon-act danger" title="删除" data-toast="资源已删除（原型演示）">' + K.icon("trash", 15) + '</button></span></div>';
              }).join("") + '</div>' +
            '<div class="admin-pager"><span class="tiny">共 3,796 条 · 每页 20 条</span><div class="pager"><button class="btn ghost sm" disabled>上一页</button><span class="tiny">1 / 190</span><button class="btn ghost sm">下一页</button></div></div>' +
          '</div>';
      }
    },

    {
      id: "admin-users", group: "admin", adminTab: "users", title: "用户管理", no: "51", layout: "admin",
      render: function () {
        return adminHeading("用户管理", "查看账号、套餐与容量使用情况，可调整套餐或禁用账号。") +
          '<div class="public-card admin-panel"><div class="admin-panel-heading"><div><p class="eyebrow">账号与权益</p><h2>用户列表</h2></div><span>共 1,284 个用户</span></div>' +
            '<label class="admin-search">' + K.icon("search", 15) + '<input placeholder="搜索账号、手机号、邮箱或用户 ID"/></label>' +
            '<div class="admin-table"><div class="admin-table-row head"><span>用户</span><span>套餐</span><span>已用容量</span><span>状态</span><span class="r">操作</span></div>' +
              [["林敬轩", "linjx@kunqiong.cn", "会员版", "6.4 GB", "活跃"], ["王磊", "wang.lei@kunqiong.cn", "团队版", "9.8 GB", "活跃"], ["陈静", "chen.jing@kunqiong.cn", "会员版", "7.2 GB", "活跃"], ["赵敏", "zhao.min@kunqiong.cn", "免费版", "4.1 GB", "活跃"], ["周涛", "zhou.tao@kunqiong.cn", "免费版", "3.6 GB", "已禁用"], ["孙悦", "sun.yue@kunqiong.cn", "团队版", "2.9 GB", "活跃"]].map(function (u) {
                return '<div class="admin-table-row"><div class="admin-user-identity"><strong>' + u[0] + '</strong><span>' + u[1] + '</span></div><span><select class="admin-user-plan"><option' + (u[2] === "免费版" ? " selected" : "") + '>免费版</option><option' + (u[2] === "会员版" ? " selected" : "") + '>会员版</option><option' + (u[2] === "团队版" ? " selected" : "") + '>团队版</option><option>企业版</option></select></span><span class="mono tiny">' + u[3] + '</span><span><span class="badge ' + (u[4] === "活跃" ? "ok" : "danger") + '"><i></i>' + u[4] + '</span></span><span class="row-acts"><button class="btn ghost sm" data-toast="已' + (u[4] === "活跃" ? "禁用" : "启用") + '账号 ' + u[0] + '">' + (u[4] === "活跃" ? "禁用" : "启用") + '</button><button class="icon-act" title="详情">' + K.icon("more", 15) + '</button></span></div>';
              }).join("") + '</div>' +
            '<div class="admin-pager"><span class="tiny">共 1,284 个用户 · 每页 20 条</span><div class="pager"><button class="btn ghost sm" disabled>上一页</button><span class="tiny">1 / 65</span><button class="btn ghost sm">下一页</button></div></div>' +
          '</div>' +
          '<div class="banner info mt16">' + K.icon("info", 15) + '<div>调整套餐会立即生效，并按剩余天数折算；禁用账号后其分享链接仍可访问，但无法登录或上传。</div></div>';
      }
    },

    {
      id: "admin-logs", group: "admin", adminTab: "security", title: "安全日志", no: "52", layout: "admin",
      render: function () {
        return adminHeading("安全日志", "审计管理员操作、访问请求与安全拦截记录。", '<button class="btn ghost sm" data-toast="已导出最近 100 条日志">' + K.icon("download", 13) + '导出日志</button>') +
          '<div class="public-card admin-panel"><div class="admin-panel-heading"><div><p class="eyebrow">安全与访问</p><h2>审计日志</h2></div><span>共 8,642 条 · 显示最近 100 条</span></div>' +
            '<div class="admin-filters"><select class="select"><option>全部类型</option><option>管理员操作</option><option>安全拦截</option><option>访问记录</option></select><select class="select"><option>全部状态</option><option>成功</option><option>失败</option></select><input class="input" type="date" value="2026-10-20" style="width:160px"/><button class="btn ghost sm" data-toast="已应用筛选">' + K.icon("filter", 13) + '筛选</button></div>' +
            '<div class="admin-log-list admin-log-list-large">' +
              [["security", "上传拦截：压缩包内文件命中风险规则", "今天 15:52", "已阻止", "183.***.21"], ["admin", "admin 调整用户 U-882014 套餐为会员版", "今天 15:42", "成功", "10.0.2.14"], ["access", "下载分享 s_K7Q2M9（取件码验证通过）", "今天 15:40", "成功", "183.***.21"], ["security", "连续密码错误 5 次，已临时锁定", "今天 14:36", "已阻止", "45.***.88"], ["admin", "admin 导出资源清单 CSV", "今天 14:28", "成功", "10.0.2.14"], ["access", "创建收集任务 c_C8T4R2", "今天 10:12", "成功", "116.***.7"], ["security", "疑似脚本请求被限流", "昨天 22:05", "已阻止", "203.***.46"], ["admin", "执行过期资源清理任务", "今天 04:00", "成功", "system"]].map(function (l) {
                return '<div><span><strong class="' + l[0] + '">' + (l[0] === "security" ? "安全拦截" : l[0] === "admin" ? "管理员操作" : "访问") + '</strong> ' + l[1] + '</span><small>' + l[2] + ' · ' + l[3] + ' · IP ' + l[4] + '</small></div>';
              }).join("") + '</div>' +
            '<div class="admin-pager"><span class="tiny">显示 1–8 / 100 条</span><div class="pager"><button class="btn ghost sm" disabled>上一页</button><span class="tiny">1 / 13</span><button class="btn ghost sm">下一页</button></div></div>' +
          '</div>';
      }
    },

    {
      id: "admin-config", group: "admin", adminTab: "config", title: "系统配置", no: "53", layout: "admin",
      render: function () {
        return adminHeading("系统配置", "调整上传限制、有效期与套餐运行参数，保存后立即生效。") +
          '<div class="admin-config-grid">' +
            '<div class="public-card admin-panel"><div class="admin-panel-heading"><div><p class="eyebrow">上传与存储</p><h2>上传参数</h2></div></div><div class="admin-form">' +
              '<div class="form-row"><label>单文件上限（GB）</label><div class="body"><input class="input" value="10"/><p class="hint">对所有套餐生效，套餐上限低于此值时以套餐为准。</p></div></div>' +
              '<div class="form-row"><label>单批文件数</label><div class="body"><input class="input" value="100"/></div></div>' +
              '<div class="form-row"><label>分片大小（MB）</label><div class="body"><input class="input" value="8"/><p class="hint">大文件按此大小分片，异常中断可续传 11 小时。</p></div></div>' +
              '<div class="form-row"><label>游客单文件上限（GB）</label><div class="body"><input class="input" value="1.2"/></div></div>' +
              '<div class="form-row"><label>安全检测</label><div class="body"><div class="switch-row" style="padding:0;border:0"><div><b>启用上传安全检测</b><small>检测病毒、脚本与敏感内容，命中后阻止整批上传。</small></div><button class="switch on" data-toggle></button></div></div></div>' +
            '</div></div>' +
            '<div class="public-card admin-panel"><div class="admin-panel-heading"><div><p class="eyebrow">分享与清理</p><h2>生命周期</h2></div></div><div class="admin-form">' +
              '<div class="form-row"><label>默认有效期（天）</label><div class="body"><input class="input" value="3"/></div></div>' +
              '<div class="form-row"><label>最长有效期（天）</label><div class="body"><input class="input" value="30"/></div></div>' +
              '<div class="form-row"><label>过期宽限期（天）</label><div class="body"><input class="input" value="7"/><p class="hint">到期后文件保留天数，期间仍可通过管理链接恢复。</p></div></div>' +
              '<div class="form-row"><label>自动清理</label><div class="body"><div class="switch-row" style="padding:0;border:0"><div><b>每天 04:00 执行清理</b><small>清理过期分享、收集与接收文件。</small></div><button class="switch on" data-toggle></button></div></div></div>' +
              '<div class="form-row"><label>回收站保留（天）</label><div class="body"><input class="input" value="30"/></div></div>' +
            '</div></div>' +
            '<div class="public-card admin-panel"><div class="admin-panel-heading"><div><p class="eyebrow">套餐</p><h2>套餐价格</h2></div><span class="badge">4 个套餐</span></div><div class="admin-form">' +
              [["免费版", "0", "5"], ["会员版", "168", "20"], ["团队版", "588", "200"], ["企业版", "定制", "2048"]].map(function (p) {
                return '<div class="admin-plan-row"><b>' + p[0] + '</b><label><span>年费 ¥</span><input class="input" value="' + p[1] + '"/></label><label><span>容量 GB</span><input class="input" value="' + p[2] + '"/></label></div>';
              }).join("") +
              '<div class="banner warn mt12">' + K.icon("alertTriangle", 15) + '<div>修改价格只影响新订单，已支付订单按原价与有效期执行。</div></div>' +
            '</div></div>' +
            '<div class="public-card admin-panel"><div class="admin-panel-heading"><div><p class="eyebrow">安全</p><h2>访问与限流</h2></div></div><div class="admin-form">' +
              '<div class="form-row"><label>管理员会话（分钟）</label><div class="body"><input class="input" value="30"/></div></div>' +
              '<div class="form-row"><label>登录失败锁定</label><div class="body"><div class="flex"><input class="input" value="5" style="max-width:100px"/><span class="tiny">次 /</span><input class="input" value="30" style="max-width:100px"/><span class="tiny">分钟</span></div></div></div>' +
              '<div class="form-row"><label>取件码长度</label><div class="body"><div class="seg"><button>4 位</button><button class="active">6 位</button><button>8 位</button></div></div></div>' +
              '<div class="form-row"><label>接口限流</label><div class="body"><div class="switch-row" style="padding:0;border:0"><div><b>启用请求限流</b><small>按 IP 与账号维度限制高频请求。</small></div><button class="switch on" data-toggle></button></div></div></div>' +
            '</div></div>' +
          '</div>' +
          '<div class="admin-save-bar"><span class="tiny">最近保存：2026-10-19 18:22 · admin@kunqiong.cn</span><div class="flex"><button class="btn ghost" data-toast="已放弃修改">放弃修改</button><button class="btn primary" data-toast="系统配置已保存">保存配置</button></div></div>';
      }
    }
  ]);
})();
