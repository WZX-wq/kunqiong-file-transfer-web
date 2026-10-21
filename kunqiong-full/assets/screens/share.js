/* 02 · 接收与分享管理 */
(function () {
  var K = window.KQ;

  var SHARE_FILES = [
    { n: "2026 产品报价单.pdf", s: 13 * 1024 * 1024, t: "ft-pdf" },
    { n: "项目交付资料.zip", s: 268.4 * 1024 * 1024, t: "ico-folder" },
    { n: "季度复盘演示.pptx", s: 48.2 * 1024 * 1024, t: "ft-ppt" },
    { n: "界面截图.png", s: 5.6 * 1024 * 1024, t: "ft-jpg" }
  ];

  function senderBar() {
    return '<div class="sender"><span class="avatar">林</span><div class="who"><b>林敬轩</b><small>通过鲲穹文件传输分享 · 今天 16:08</small></div><span class="badge blue"><i></i>安全检测通过</span></div>';
  }

  function fileRow(f) {
    return '<div class="share-file-row"><img class="ftype" src="assets/icons/' + f.t + '.png" alt=""/><div class="grow"><span class="fname">' + K.esc(f.n) + '</span><small>点击右侧下载，或在线预览</small></div><span class="size mono">' + K.fmtBytes(f.s) + '</span><button class="icon-act" title="预览" data-go="file-preview">' + K.icon("eye", 17) + '</button><button class="btn soft sm" data-toast="开始下载：' + K.esc(f.n) + '">' + K.icon("download", 14) + '下载</button></div>';
  }

  K.register([
    {
      id: "share-public", group: "share", title: "分享接收页", no: "09", layout: "public",
      render: function () {
        return '<div class="share-main">' +
          '<div class="share-hero"><span class="eyebrow">鲲穹临时分享</span><h1>有人给你发来了文件</h1><p>文件将在 3 天后过期，请及时下载保存。</p></div>' +
          senderBar() +
          '<div class="public-card share-card"><div class="card-bd">' +
            '<div class="pkg-head"><div><h3 style="font-size:16.5px;font-weight:650">4 个文件</h3><p class="tiny">共 323.0 MB · 上传于今天 16:08</p></div><span class="badge warn"><i></i>剩余 2 天 20 小时</span></div>' +
            '<div style="margin-top:8px">' + SHARE_FILES.map(fileRow).join("") + '</div>' +
            '<div class="share-actions"><button class="btn primary" data-toast="已开始打包下载 4 个文件">' + K.icon("download", 16) + '全部下载（323.0 MB）</button><button class="btn ghost" data-open="qr">' + K.icon("qr", 15) + '二维码</button><span class="tiny" style="margin-left:auto">' + K.icon("shield", 13) + ' 已通过安全检查</span></div>' +
          '</div></div>' +
          '<p class="share-note">' + K.icon("lock", 13) + ' 文件仅用于本次分享，到期后自动清理 · 由鲲穹文件传输提供</p>' +
          '<div id="tpl-qr" hidden><div class="modal-hd"><div><h3>扫码在手机上下载</h3><p>二维码 30 天内有效，转发给好友同样可用。</p></div><button class="icon-btn" data-close aria-label="关闭">' + K.icon("x", 18) + '</button></div><div class="modal-bd" style="display:grid;place-items:center"><div class="qr lg">' + K.qrSvg(889912) + '</div></div><div class="modal-ft"><button class="btn ghost" data-close>关闭</button></div></div>' +
          '</div>';
      }
    },

    {
      id: "share-locked", group: "share", title: "提取密码", no: "10", layout: "public",
      render: function () {
        return '<div class="password-card public-card"><div class="card-bd">' +
          '<img class="big-ico" src="assets/icons/ico-lock.png" alt=""/>' +
          '<h2>此分享已加密</h2><p>请输入发送人提供的 4–16 位提取密码</p>' +
          '<div class="pwd-field"><input class="input" type="password" value="KQ2026" aria-label="提取密码"/><button class="pwd-eye" data-toggle-eye aria-label="显示密码">' + K.icon("eye", 17) + '</button></div>' +
          '<button class="btn primary block mt16" data-go="share-public">解锁并查看文件</button>' +
          '<div class="banner warn" style="margin-top:18px;text-align:left">' + K.icon("alertTriangle", 15) + '<div>连续输错 5 次将锁定 10 分钟。忘记密码请联系发送人重新分享。</div></div>' +
          '<p class="tiny mt16">分享人：林敬轩 · 4 个文件 · 323.0 MB</p>' +
        '</div></div>';
      },
      mount: function () {
        var eye = document.querySelector("[data-toggle-eye]");
        if (!eye) return;
        eye.addEventListener("click", function () {
          var input = eye.parentElement.querySelector("input");
          input.type = input.type === "password" ? "text" : "password";
        });
      }
    },

    {
      id: "share-expired", group: "share", title: "分享已过期", no: "11", layout: "public",
      render: function () {
        return '<div class="state-card public-card"><div class="card-bd">' +
          '<div class="state-icon gray">' + K.icon("clock", 28) + '</div>' +
          '<h2>这个分享已过期</h2><p>文件保留期已结束，内容已进入清理流程，无法继续下载。<br/>如需再次获取，请联系发送人重新分享。</p>' +
          '<div class="expired-meta"><div><span>分享人</span><b>林敬轩</b></div><div><span>过期时间</span><b>2026-10-18 09:12</b></div><div><span>文件</span><b>4 个 · 323.0 MB</b></div></div>' +
          '<div class="flex" style="justify-content:center;margin-top:22px"><a class="btn ghost" href="#/retrieve">输入其他取件码</a><a class="btn primary" href="#/send-home">我也要发文件</a></div>' +
        '</div></div>';
      }
    },

    {
      id: "share-manage", group: "share", nav: "send", title: "分享管理", no: "12",
      render: function () {
        return '<div class="wrap mid">' +
          '<div class="crumb"><a href="#/send-home">发文件</a><i>/</i><span>分享管理</span></div>' +
          '<div class="manage-head"><div><h1>2026 产品报价单.pdf <span class="badge ok"><i></i>分享中</span></h1><p>创建于 2026-10-20 16:08 · 管理链接含访问凭证，请勿公开转发</p></div><div class="page-actions"><button class="btn ghost sm" data-copy="https://kq.cn/s/K7Q2M9">' + K.icon("copy", 14) + '复制链接</button><button class="btn ghost sm" data-go="share-manage-settings">' + K.icon("settings", 14) + '分享设置</button></div></div>' +
          '<div class="manage-stats">' +
            '<div class="manage-stat"><span>下载次数</span><b>12</b><small>不限次数</small></div>' +
            '<div class="manage-stat"><span>访问量</span><b>37</b><small>近 24 小时 +9</small></div>' +
            '<div class="manage-stat"><span>剩余有效期</span><b>2 天 20 时</b><small>10-23 18:00 到期</small></div>' +
            '<div class="manage-stat"><span>文件大小</span><b>323.0 MB</b><small>4 个文件</small></div>' +
          '</div>' +
          '<div class="manage-grid">' +
            '<div>' +
              '<div class="card"><div class="card-hd"><h3>文件列表</h3><span class="tiny">支持在线预览的文件可直接打开</span></div><div class="card-bd" style="padding-top:4px">' +
                SHARE_FILES.map(function (f) {
                  return '<div class="share-file-row"><img class="ftype" src="assets/icons/' + f.t + '.png" alt=""/><div class="grow"><span class="fname">' + K.esc(f.n) + '</span><small>下载 3 次 · 最近 15:58</small></div><span class="size mono">' + K.fmtBytes(f.s) + '</span><button class="icon-act" data-go="file-preview" title="预览">' + K.icon("eye", 16) + '</button><button class="icon-act" data-toast="开始下载" title="下载">' + K.icon("download", 16) + '</button></div>';
                }).join("") +
              '</div></div>' +
              '<div class="card mt16"><div class="card-hd"><h3>访问动态</h3><span class="tiny">最近 7 条</span></div><div class="card-bd" style="padding-top:6px">' +
                '<div class="log-row"><i>' + K.icon("download", 13) + '</i><span>匿名访客下载了 项目交付资料.zip</span><small>今天 15:58</small></div>' +
                '<div class="log-row"><i>' + K.icon("eye", 13) + '</i><span>访客通过二维码打开分享</span><small>今天 15:42</small></div>' +
                '<div class="log-row"><i>' + K.icon("lock", 13) + '</i><span>密码验证成功（IP 183.***.21）</span><small>今天 15:40</small></div>' +
                '<div class="log-row"><i>' + K.icon("download", 13) + '</i><span>王磊 下载了全部文件</span><small>今天 14:20</small></div>' +
              '</div></div>' +
            '</div>' +
            '<aside>' +
              '<div class="card"><div class="card-hd"><h3>分享信息</h3></div><div class="card-bd">' +
                '<dl class="sum-list"><div><dt>取件码</dt><dd class="mono">K7Q2M9</dd></div><div><dt>提取密码</dt><dd class="mono">KQ2026</dd></div><div><dt>下载限制</dt><dd>不限次数</dd></div><div><dt>已下载</dt><dd>12 次</dd></div><div><dt>到期时间</dt><dd>2026-10-23 18:00</dd></div></dl>' +
                '<div class="qr" style="margin:14px auto 0;width:140px;height:140px">' + K.qrSvg(20260615) + '</div>' +
                '<p class="tiny center" style="margin-top:8px">扫码取件 · <a class="text-btn" href="#/send-qr" style="font-size:12px">放大</a></p>' +
              '</div></div>' +
              '<div class="danger-zone"><h4>' + K.icon("alertTriangle", 14) + '关闭分享</h4><p>关闭后链接、取件码和二维码立即失效，已下载文件不受影响。</p><button class="btn danger sm" data-toast="分享已关闭（原型演示）">' + K.icon("xCircle", 14) + '立即关闭</button></div>' +
            '</aside>' +
          '</div>' +
        '</div>';
      }
    },

    {
      id: "share-manage-settings", group: "share", nav: "send", title: "分享设置", no: "13",
      render: function () {
        return '<div class="wrap narrow">' +
          '<a class="backlink" href="#/share-manage">' + K.icon("chevronLeft", 14) + '返回分享管理</a>' +
          '<div class="page-hd"><div><h1>分享设置</h1><p>修改后立即生效，不影响已经开始的下载。</p></div></div>' +
          '<div class="card form-card">' +
            '<div class="form-row"><label>分享状态</label><div class="body"><div class="switch-row" style="padding:0;border:0"><div><b>允许访问</b><small>关闭后所有人无法通过链接或取件码访问。</small></div><button class="switch on" data-toggle data-toggle-msg="分享已开启"></button></div></div></div>' +
            '<div class="form-row"><label>到期时间</label><div class="body"><div class="field" style="max-width:300px"><input class="input" type="date" value="2026-10-23"/><p class="hint">当前剩余 2 天 20 小时；到期后文件进入清理队列。</p></div></div></div>' +
            '<div class="form-row"><label>下载次数上限</label><div class="body"><div class="seg"><button>不限</button><button class="active">20 次</button><button>50 次</button><button>自定义</button></div><p class="hint">已使用 12 次，达到上限后链接自动失效。</p></div></div>' +
            '<div class="form-row"><label>提取密码</label><div class="body"><div class="flex"><input class="input mono" value="KQ2026" style="max-width:220px"/><button class="btn ghost sm" data-toast="已生成新密码：8F2K9L">随机生成</button><button class="btn danger sm" data-toast="已关闭密码保护">关闭保护</button></div><p class="hint">修改后旧密码立即失效，请重新告知收件人。</p></div></div>' +
            '<div class="form-row"><label>下载通知</label><div class="body"><div class="switch-row" style="padding:0;border:0"><div><b>有人下载时通知我</b><small>通过站内消息与邮件提醒，每天最多 3 条。</small></div><button class="switch" data-toggle data-toggle-msg="已开启下载通知"></button></div></div></div>' +
            '<div class="form-foot"><button class="btn ghost" data-go="share-manage">取消</button><button class="btn primary" data-go="share-manage">保存设置</button></div>' +
          '</div>' +
        '</div>';
      }
    },

    {
      id: "file-preview", group: "share", nav: "send", title: "文件在线预览", no: "14",
      render: function () {
        return '<div class="wrap mid">' +
          '<a class="backlink" href="#/share-public">' + K.icon("chevronLeft", 14) + '返回文件列表</a>' +
          '<div class="page-hd"><div><h1>在线预览</h1><p>无需下载即可查看文档内容，预览不会计入下载次数。</p></div><div class="page-actions"><span class="badge ok"><i></i>安全检测通过</span></div></div>' +
          '<div class="preview-shell">' +
            '<div class="preview-bar"><img src="assets/icons/ft-pdf.png" alt="" style="width:20px;height:20px;object-fit:contain"/><span class="fname">2026 产品报价单.pdf</span><span style="color:#7f97b5">· 13.0 MB</span><div class="acts"><button title="缩小">' + K.icon("minimize", 15) + '</button><button title="放大">' + K.icon("maximize", 15) + '</button><button title="下载" data-toast="开始下载">' + K.icon("download", 15) + '</button><button title="关闭" data-go="share-public">' + K.icon("x", 16) + '</button></div></div>' +
            '<div class="preview-body"><div class="preview-page">' +
              '<h4>鲲穹文件传输 · 报价单</h4>' +
              '<div class="doc-title">产品报价单</div><div class="doc-sub">报价编号 KQ-2026-1020 · 有效期 30 天</div>' +
              '<table><thead><tr><th style="width:42%">项目</th><th>规格</th><th>数量</th><th>金额</th></tr></thead><tbody>' +
                '<tr><td>企业版团队空间</td><td>20 人 / 2 TB</td><td>1</td><td>¥ 12,800</td></tr>' +
                '<tr><td>大文件加速包</td><td>单文件 50 GB</td><td>2</td><td>¥ 3,600</td></tr>' +
                '<tr><td>专属部署服务</td><td>私有化部署</td><td>1</td><td>¥ 28,000</td></tr>' +
                '<tr><td colspan="3" style="text-align:right;font-weight:600">合计</td><td style="font-weight:600">¥ 44,400</td></tr>' +
              '</tbody></table>' +
              '<p>备注：以上价格含一年服务期，续费按年计。付款方式支持对公转账与在线支付，交付周期为合同签署后 5 个工作日。</p>' +
              '<p style="text-align:right;color:#93a3b9">鲲穹科技 · 2026-10-20</p>' +
            '</div></div>' +
            '<div class="preview-foot"><span>' + K.icon("shield", 13) + ' 只读预览 · 已阻止外部链接</span><span class="pager"><button class="icon-act" style="color:#a9c0dd">' + K.icon("chevronLeft", 15) + '</button>1 / 3<button class="icon-act" style="color:#a9c0dd">' + K.icon("chevronRight", 15) + '</button></span></div>' +
          '</div>' +
        '</div>';
      }
    },

    {
      id: "download-progress", group: "share", title: "下载进行中", no: "15", layout: "public",
      render: function () {
        return '<div class="share-main">' +
          '<div class="share-hero"><span class="eyebrow">鲲穹临时分享</span><h1>正在下载文件</h1><p>保持页面打开可查看进度，下载完成后浏览器会提示保存位置。</p></div>' +
          senderBar() +
          '<div class="public-card share-card"><div class="card-bd">' +
            '<div class="pkg-head"><div><h3 style="font-size:16.5px;font-weight:650">4 个文件</h3><p class="tiny">共 323.0 MB · 无需登录</p></div><span class="badge blue"><i></i>下载中</span></div>' +
            '<div style="margin-top:8px">' + SHARE_FILES.map(function (f, i) {
              var pct = [100, 64, 32, 0][i];
              return '<div class="share-file-row"><img class="ftype" src="assets/icons/' + f.t + '.png" alt=""/><div class="grow"><span class="fname">' + K.esc(f.n) + '</span><div class="progress sm mt8"><i style="width:' + pct + '%;background:' + (pct === 100 ? "linear-gradient(90deg,#3ed598,#12a862)" : "linear-gradient(90deg,#4f95ff,#1667f0)") + '"></i></div></div><span class="size mono">' + (pct === 100 ? "已完成" : pct + "%") + '</span><button class="icon-act" title="暂停">' + K.icon(pct === 100 ? "check" : "pause", 16) + '</button></div>';
            }).join("") + '</div>' +
            '<div class="share-actions"><div class="tiny">' + K.icon("zap", 13) + ' 8.6 MB/s · 预计还需 22 秒</div><button class="btn ghost sm" style="margin-left:auto" data-toast="已暂停全部下载">全部暂停</button><button class="btn ghost sm" data-toast="已取消下载">取消</button></div>' +
          '</div></div>' +
        '</div>' +
        '<div class="download-panel"><div class="dp-head"><img src="assets/icons/act-download.png?v=2" alt="" style="width:20px;height:20px"/><span>下载任务</span><span class="badge blue">2 / 4</span></div><div class="dp-body"><div class="progress sm"><i style="width:58%"></i></div><div class="dp-row"><span class="grow">正在下载 项目交付资料.zip</span><span class="mono">64%</span></div><div class="dp-row"><span class="grow">8.6 MB/s · 剩余 22 秒</span><button class="text-btn" data-toast="下载已暂停">暂停</button></div></div></div>';
      }
    },

    {
      id: "share-closed", group: "share", title: "分享已关闭", no: "16", layout: "public",
      render: function () {
        return '<div class="state-card public-card"><div class="card-bd">' +
          '<div class="state-icon gray">' + K.icon("lock", 26) + '</div>' +
          '<h2>分享已被关闭</h2><p>发送人已停止此分享，链接与取件码都无法继续访问。<br/>如果你是接收方，请联系发送人重新分享。</p>' +
          '<div class="banner info" style="text-align:left;margin-top:20px">' + K.icon("info", 15) + '<div>关闭分享不会删除云端文件，发送人仍可在「收发记录」中重新开启或再次分享。</div></div>' +
          '<div class="flex" style="justify-content:center;margin-top:20px"><a class="btn ghost" href="#/retrieve">输入其他取件码</a><a class="btn primary" href="#/send-home">返回首页</a></div>' +
        '</div></div>';
      }
    }
  ]);
})();
