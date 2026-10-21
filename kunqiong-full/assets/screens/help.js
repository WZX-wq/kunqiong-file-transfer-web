/* 08 · 帮助与规则 */
(function () {
  var K = window.KQ;

  K.register([
    {
      id: "help", group: "help", title: "帮助中心", no: "54",
      render: function () {
        return '<div class="wrap mid">' +
          '<div class="help-hero"><span class="eyebrow">使用帮助</span><h1>有什么可以帮你？</h1><p>从发送、取件到收集与团队协作，这里有你需要的答案。</p><label class="help-search">' + K.icon("search", 17) + '<input placeholder="搜索问题，例如「取件码失效」「如何扩容」"/><button class="btn primary sm" data-toast="已搜索：取件码">搜索</button></label></div>' +
          '<div class="help-cats">' +
            [["send", "发送与取件", "上传、分片续传、取件码与二维码", "05 篇"], ["inbox", "收集文件", "创建任务、截止时间与提交管理", "06 篇"], ["users", "团队与套餐", "成员权限、容量与升级", "05 篇"], ["shield", "安全与合规", "密码、检测、审计与清理", "04 篇"]].map(function (c) {
              return '<a class="help-cat" href="#/help">' + K.icon(c[0], 19) + '<b>' + c[1] + '</b><small>' + c[2] + '</small><em>' + c[3] + '</em></a>';
            }).join("") + '</div>' +
          '<div class="help-grid">' +
            '<div class="card"><div class="card-hd"><h3>常见问题</h3><span class="tiny">按热度排序</span></div><div class="card-bd" style="padding-top:4px">' +
              [["取件码提示已过期怎么办？", "取件码与分享有效期绑定。到期后文件进入清理队列，无法恢复；请联系发送人重新分享。", true],
               ["上传中断后需要重新开始吗？", "不需要。未完成的分片会在本地保留 11 小时，重新打开页面会提示继续上传。", false],
               ["对方打开链接需要登录吗？", "不需要。取件码、链接和二维码都支持匿名下载；如果开启了提取密码，只需输入密码。", false],
               ["如何把单文件上限提高到 10 GB？", "升级到会员版即可，容量与单文件上限会立即生效；团队版可到 20 GB。", false],
               ["收集任务可以限制文件类型吗？", "可以。创建或设置收集任务时可选择图片、文档、视频、压缩包等分类，也可限定单个文件大小。", false]].map(function (q, i) {
                return '<details class="faq-item" ' + (q[2] ? "open" : "") + '><summary>' + q[0] + '<span class="faq-chev">' + K.icon("chevronDown", 15) + '</span></summary><p>' + q[1] + '</p></details>';
              }).join("") +
            '</div></div>' +
            '<aside><div class="card help-side"><div class="card-hd"><h3>仍未解决？</h3><span class="badge ok"><i></i>在线</span></div><div class="card-bd">' +
              '<p class="side-note">工作时间 9:00–21:00，通常 2 小时内回复。</p>' +
              '<button class="btn primary sm block mt10" data-toast="已打开在线客服（原型演示）">' + K.icon("message", 14) + '联系在线客服</button>' +
              '<button class="btn ghost sm block mt6" data-toast="已复制支持邮箱">' + K.icon("mail", 14) + 'support@kunqiong.cn</button>' +
              '<div class="side-divider"><span>快速入口</span></div>' +
              '<div class="quick-grid">' +
                [["upload", "发文件", "send-home"], ["key", "取件码取文件", "retrieve"], ["inbox", "创建收集", "collect-create"], ["crown", "套餐与权益", "plan"]].map(function (q) {
                  return '<a href="#/' + q[2] + '">' + K.icon(q[0], 14) + '<span>' + q[1] + '</span></a>';
                }).join("") +
              '</div>' +
            '</div></div></aside>' +
          '</div>' +
        '</div>';
      }
    },

    {
      id: "terms", group: "help", title: "服务协议", no: "55",
      render: function () {
        return '<div class="wrap mid">' +
          '<div class="legal-head"><span class="eyebrow">平台规则</span><h1>服务协议</h1><p>最后更新：2026-09-28 · 适用于鲲穹文件传输全部服务</p></div>' +
          '<div class="legal-layout"><aside class="legal-toc"><b>目录</b><a href="#/terms" class="active">服务范围</a><a href="#/terms">用户义务</a><a href="#/terms">服务限制</a><a href="#/terms">知识产权</a><a href="#/terms">协议变更</a></aside>' +
            '<div class="card"><div class="card-bd legal-body">' +
              '<h2>1. 服务范围</h2><p>鲲穹文件传输提供临时文件发送、取件码分享、文件收集、记录管理和基础账号同步能力。</p><p>本服务用于合法、合规的文件传输场景，不承诺作为长期备份、归档或容灾存储使用。</p><p>部分高级能力可能需要会员版、团队版或企业版权益，具体以页面展示和实际配置为准。</p>' +
              '<h2>2. 用户义务</h2><p>你应确保上传、分享和收集的文件拥有合法权利，不侵犯他人知识产权、隐私权或其他合法权益。</p><p>禁止上传违法违规、恶意程序、钓鱼欺诈、侵害他人权益或破坏服务安全稳定的内容。</p><p>你需要妥善保管取件码、管理链接和账号登录状态，由泄露导致的访问风险由分享者自行承担。</p>' +
              '<h2>3. 服务限制</h2><p>平台可能根据容量、文件大小、有效期、安全审核或系统维护需要限制、暂停或清理相关文件。</p><p>因不可抗力、网络故障、第三方服务异常或用户配置错误导致的服务中断，平台会尽力恢复但不承担超出法律规定的责任。</p>' +
              '<div class="banner info">' + K.icon("info", 15) + '<div>继续使用本服务即表示你理解并接受当前协议内容；正式商业版本上线后可能更新协议条款。</div></div>' +
              '<h2>4. 知识产权</h2><p>你保留上传文件的所有权利。为提供服务，你授予平台在必要范围内存储、传输与展示文件的非独占许可。</p>' +
              '<h2>5. 协议变更</h2><p>协议更新时会在页面显著位置提示；继续使用视为接受更新后的协议。</p>' +
              '<div class="legal-foot"><span>如对协议有疑问，请联系 legal@kunqiong.cn</span><a class="btn ghost sm" href="#/privacy">查看隐私政策</a></div>' +
            '</div></div></div>' +
        '</div>';
      }
    },

    {
      id: "privacy", group: "help", title: "隐私政策", no: "56",
      render: function () {
        return '<div class="wrap mid">' +
          '<div class="legal-head"><span class="eyebrow">数据保护</span><h1>隐私政策</h1><p>最后更新：2026-09-28 · 我们如何收集、使用与保护你的信息</p></div>' +
          '<div class="legal-layout"><aside class="legal-toc"><b>目录</b><a href="#/privacy" class="active">处理的信息</a><a href="#/privacy">使用与保存</a><a href="#/privacy">安全与控制</a><a href="#/privacy">你的权利</a><a href="#/privacy">联系我们</a></aside>' +
            '<div class="card"><div class="card-bd legal-body">' +
              '<h2>1. 我们处理的信息</h2><p>为完成文件传输，我们会处理上传文件、文件名、大小、类型、分享设置、取件码、收集任务和提交记录。</p><p>登录后会保存账号标识、昵称、头像、邮箱或手机号等必要账户资料，以及容量和消息通知设置。</p><p>系统可能记录访问时间、IP、接口路径和操作结果，用于安全审计、故障排查和服务稳定性维护。</p>' +
              '<h2>2. 使用与保存</h2><p>文件默认按你设置的有效期保存，到期或被删除后会进入清理流程；会员或团队能力以实际权益为准。</p><p>头像等个人资料仅用于账户展示；自定义头像优先显示，恢复后会回到第三方登录头像或默认头像。</p><p>未配置 SMTP 等第三方通道时，邮件通知只做本地记录，不会向外部邮箱发送真实邮件。</p>' +
              '<div class="privacy-table"><div class="pt-row head"><span>信息类型</span><span>用途</span><span>保存期限</span></div><div class="pt-row"><span>文件与传输记录</span><span>完成发送、取件与收集</span><span>有效期 + 7 天宽限</span></div><div class="pt-row"><span>账号资料</span><span>登录、展示与团队协作</span><span>账号存续期间</span></div><div class="pt-row"><span>访问日志</span><span>安全审计与故障排查</span><span>180 天</span></div></div>' +
              '<h2>3. 安全与控制</h2><p>我们通过登录会话、管理链接、提取密码、访问校验和文件格式标签降低误访问风险。</p><p>你可以删除分享、关闭收集任务、恢复登录头像或退出登录，以管理自己的内容和账户状态。</p>' +
              '<h2>4. 你的权利</h2><p>你可以访问、更正或删除账号资料，也可以申请导出或注销账号。注销后与账号关联的文件和记录将按清理规则处理。</p>' +
              '<div class="legal-foot"><span>隐私相关问题请联系 privacy@kunqiong.cn</span><a class="btn ghost sm" href="#/terms">查看服务协议</a></div>' +
            '</div></div></div>' +
        '</div>';
      }
    },

    {
      id: "guest-quota", group: "help", title: "游客额度", no: "57", layout: "public",
      render: function () {
        return '<div class="state-card public-card" style="max-width:500px"><div class="card-bd">' +
          '<div class="state-icon blue">' + K.icon("zap", 26) + '</div>' +
          '<h2>本次游客额度已用完</h2><p>游客模式每天可上传 5 GB，你已使用 5.0 GB。<br/>登录后可获得 20 GB 空间、长期记录与更大单文件上限。</p>' +
          '<div class="quota-bar"><div class="flex between"><span>今日已用</span><b>5.0 GB / 5 GB</b></div><div class="progress mt8"><i style="width:100%;background:linear-gradient(90deg,#ffb35c,#f79009)"></i></div><p class="tiny" style="margin-top:6px">额度将在明天 00:00 重置</p></div>' +
          '<div class="quota-compare"><div><span>游客</span><b>5 GB / 天</b><small>单文件 1.2 GB</small></div><div class="hl"><span>登录后</span><b>20 GB</b><small>单文件 10 GB</small></div></div>' +
          '<div class="flex" style="justify-content:center;margin-top:20px"><a class="btn ghost" href="#/send-home">稍后再说</a><a class="btn primary" href="#/login">登录 / 注册</a></div>' +
        '</div></div>';
      }
    },

    {
      id: "email", group: "help", title: "通知邮件", no: "58", layout: "public", noFooter: true,
      render: function () {
        return '<div class="wrap mid">' +
          '<div class="page-hd" style="padding-top:10px"><div><span class="eyebrow">通知模板</span><h1 style="margin-top:6px">取件通知邮件</h1><p>收件人收到的邮件示例，含取件码、链接与有效期。</p></div><div class="page-actions"><button class="btn ghost sm" data-toast="已切换为纯文本预览">纯文本</button><button class="btn ghost sm" data-toast="测试邮件已发送">发送测试</button></div></div>' +
          '<div class="mail-shell"><div class="mail-meta"><div><span>发件人</span><b>鲲穹文件传输 &lt;no-reply@kunqiong.cn&gt;</b></div><div><span>收件人</span><b>wang.lei@kunqiong.cn</b></div><div><span>主题</span><b>林敬轩 给你发送了 4 个文件（取件码 K7Q2M9）</b></div></div>' +
            '<div class="mail-body"><div class="mail-brand"><img src="assets/icons/ico-cloud.png?v=2" alt=""/><span>鲲穹文件传输</span></div>' +
              '<h2>林敬轩 给你发来了文件</h2><p class="mail-p">共 4 个文件，合计 323.0 MB。请在 2026-10-23 18:00 前下载，到期后文件将自动清理。</p>' +
              '<div class="mail-code"><span>取件码</span><b>K7Q2M9</b><a class="mail-btn" href="#/share-public">查看并下载</a></div>' +
              '<div class="mail-files">' + [["2026 产品报价单.pdf", "13.0 MB"], ["项目交付资料.zip", "268.4 MB"], ["季度复盘演示.pptx", "48.2 MB"], ["界面截图.png", "5.6 MB"]].map(function (f) { return '<div class="mf-row"><span>' + f[0] + '</span><b>' + f[1] + '</b></div>'; }).join("") + '</div>' +
              '<p class="mail-p">提取密码：<b class="mono">KQ2026</b>；也可以直接打开链接：<a href="#/share-public" style="color:#1f6bff">https://kq.cn/s/K7Q2M9</a></p>' +
              '<div class="mail-tip">' + K.icon("shield", 13) + ' 此邮件由系统发送，请勿直接回复。文件仅保留至有效期结束。</div>' +
              '<p class="mail-sign">鲲穹科技 · 让文件传输更简单<br/><span>上海市浦东新区 · 客服 support@kunqiong.cn</span></p>' +
            '</div></div>' +
        '</div>';
      }
    }
  ]);
})();
