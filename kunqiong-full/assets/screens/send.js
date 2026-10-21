/* 01 · 发送与取件 */
(function () {
  var K = window.KQ;

  var FILES = [
    { n: "2026 产品报价单.pdf", s: 13 * 1024 * 1024, t: "ft-pdf", d: "文档" },
    { n: "项目交付资料.zip", s: 268.4 * 1024 * 1024, t: "ico-folder", d: "压缩包 · 含 42 个文件" },
    { n: "季度复盘演示.pptx", s: 48.2 * 1024 * 1024, t: "ft-ppt", d: "演示文稿" },
    { n: "界面截图.png", s: 5.6 * 1024 * 1024, t: "ft-jpg", d: "图片" }
  ];

  function fileRows(list, opts) {
    opts = opts || {};
    return list.map(function (f, i) {
      return '<div class="trow" style="grid-template-columns:' + (opts.cols || "1fr 120px 110px 92px") + '">' +
        '<div class="file-cell"><img class="ftype" src="assets/icons/' + f.t + '.png" alt=""/><span><span class="fname">' + K.esc(f.n) + '</span><small>' + f.d + '</small></span></div>' +
        '<span class="muted mono">' + K.fmtBytes(f.s) + '</span>' +
        '<span>' + (opts.status || '<span class="badge ok"><i></i>就绪</span>') + '</span>' +
        '<span class="row-acts">' + (opts.actions || '<button class="icon-act" title="预览">' + K.icon("eye", 16) + '</button><button class="icon-act danger" data-remove title="移除">' + K.icon("x", 16) + '</button>') + '</span>' +
        '</div>';
    }).join("");
  }

  K.register([
    {
      id: "send-home", group: "send", nav: "send", title: "发送首页", no: "01",
      render: function () {
        return '<div class="home-fill"><div class="wrap">' +
          '<section class="home-hero">' +
            '<div class="hero-copy">' +
              '<span class="hero-pill"><i></i>无需注册 · 单文件最大 10 GB</span>' +
              '<h1>轻松发送<em>大文件</em></h1>' +
              '<p>支持多种文件格式，安全快速，随时随地分享</p>' +
              '<div class="hero-stats"><div><b>10 GB</b><span>单文件上限</span></div><div><b>100 个</b><span>单次文件数</span></div><div><b>3 天</b><span>默认有效期</span></div></div>' +
            '</div>' +
            '<div class="hero-art"><img src="assets/icons/hero.png" alt="大文件上传"/></div>' +
          '</section>' +

          '<div class="card drop-card">' +
            '<div class="guest-strip"><span>' + K.icon("zap", 15) + '游客模式 · 本次可用 <b>2.0 GB</b> / 5 GB</span><a href="#/login">登录后享 20 GB 与长期记录 ' + K.icon("chevronRight", 13) + '</a></div>' +
            '<div class="dropzone" data-go="send-selected">' +
              '<img class="drop-icon" src="assets/icons/ico-cloud.png?v=2" alt=""/>' +
              '<h3>拖拽文件或文件夹到这里</h3>' +
              '<p class="sub">支持 PDF / Office / 图片 / 视频 / 压缩包，自动分片上传，中断可续传</p>' +
              '<div class="dz-cta"><button class="btn primary lg" data-go="send-selected">' + K.icon("folder", 17) + '选择文件</button>' +
              '<button class="btn ghost lg" data-go="send-selected">' + K.icon("upload", 17) + '选择文件夹</button></div>' +
              '<div class="dz-code">' +
                '<span class="dz-or">' + K.icon("key", 14) + '或通过取件码获取文件</span>' +
                '<form class="code-inline" onsubmit="return false" onclick="event.stopPropagation()"><input class="input" placeholder="请输入 6 位取件码" maxlength="6"/><button class="btn primary" data-go="retrieve">查询</button></form>' +
                '<span class="dz-hint">区分大小写，可在发送成功页或邮件中找到</span>' +
              '</div>' +
            '</div>' +
          '</div>' +

          '<ul class="features">' +
            '<li><img class="f-ico" src="assets/icons/ico-bolt.png" alt=""/><div><b>高速传输</b><span>分片并发，跑满带宽</span></div></li>' +
            '<li><img class="f-ico" src="assets/icons/ico-shield.png" alt=""/><div><b>安全可靠</b><span>传输加密 + 病毒检测</span></div></li>' +
            '<li><img class="f-ico" src="assets/icons/act-share.png?v=2" alt=""/><div><b>多端可用</b><span>电脑 / 手机 / 平板</span></div></li>' +
            '<li><img class="f-ico" src="assets/icons/act-upload.png" alt=""/><div><b>简单易用</b><span>链接、二维码、取件码</span></div></li>' +
          '</ul>' +
          '<div class="home-trust"><span>' + K.icon("shield", 14) + '文件仅保留至有效期结束</span><span>' + K.icon("lock", 14) + '支持提取密码</span><span>' + K.icon("scan", 14) + '上传前安全检测</span></div>' +
        '</div></div>';
      }
    },

    {
      id: "send-selected", group: "send", nav: "send", title: "已选文件", no: "02",
      render: function () {
        var total = FILES.reduce(function (a, f) { return a + f.s; }, 0);
        return '<div class="wrap narrow">' +
          '<a class="backlink" href="#/send-home">' + K.icon("chevronLeft", 14) + '返回发文件</a>' +
          '<div class="page-hd"><div><h1>已选文件</h1><p>确认要发送的内容，可继续追加文件或文件夹。</p></div><div class="page-actions"><button class="btn ghost sm" data-demo-add>' + K.icon("plus", 15) + '添加文件</button></div></div>' +
          '<div class="summary-strip"><div><b>4</b><span>个文件</span></div><div><b>323.0 MB</b><span>总大小</span></div><div><b>0</b><span>个空文件夹</span></div><div class="summary-note">' + K.icon("info", 15) + '单文件上限 10 GB，最多 100 个文件</div></div>' +
          '<div class="card table-card mt16">' +
            '<div class="thead" style="grid-template-columns:1fr 120px 110px 92px"><span>文件名</span><span>大小</span><span>状态</span><span class="r">操作</span></div>' +
            fileRows(FILES) +
            '<button class="add-row" data-demo-add>' + K.icon("plus", 15) + '添加更多文件</button>' +
            '<div class="card-ft table-foot"><span class="tiny">共 <b style="color:#1c2b3f">4</b> 个文件 · 总大小 <b style="color:#1c2b3f">323.0 MB</b></span>' +
              '<div class="flex"><button class="btn ghost sm" data-go="send-home">取消</button><button class="btn primary" data-go="send-settings">下一步：发送设置 ' + K.icon("arrowRight", 15) + '</button></div></div>' +
          '</div>' +
          '<p class="tiny mt12">' + K.icon("shield", 13) + ' 上传完成后将自动进行安全检查，风险文件会被拦截并提示原因。</p>' +
        '</div>';
      }
    },

    {
      id: "send-settings", group: "send", nav: "send", title: "发送设置", no: "03",
      render: function () {
        return '<div class="wrap mid">' +
          '<a class="backlink" href="#/send-selected">' + K.icon("chevronLeft", 14) + '返回已选文件</a>' +
          '<div class="page-hd"><div><h1>发送设置</h1><p>设置有效期、下载次数与访问密码，创建后仍可修改。</p></div></div>' +
          '<div class="split">' +
            '<div class="card form-card form-compact">' +
              '<div class="form-row"><label>分享方式</label><div class="body"><div class="seg" id="shareMode"><button class="active">取件码分享</button><button>仅链接</button><button>发送到邮箱</button></div><p class="hint">取件码为 6 位字母数字，适合口头或短信告知。</p></div></div>' +
              '<div class="form-row"><label>有效期</label><div class="body"><div class="chips" id="expiryChips"><button class="chip">1 天</button><button class="chip active">3 天</button><button class="chip">7 天</button><button class="chip">30 天</button><button class="chip">自定义</button></div><p class="hint">到期后链接立即失效，文件进入清理流程。</p></div></div>' +
              '<div class="form-row"><label>下载次数</label><div class="body"><div class="chips" id="dlChips"><button class="chip active">不限次数</button><button class="chip">1 次</button><button class="chip">5 次</button><button class="chip">10 次</button><button class="chip">自定义</button></div><p class="hint">达到次数上限后链接自动失效。</p></div></div>' +
              '<div class="form-row"><label>提取密码</label><div class="body body-inline"><div class="switch-inline"><button class="switch on" data-toggle data-toggle-msg="已开启提取密码"></button><b>开启密码保护</b></div><div class="field"><input class="input" style="width:148px;letter-spacing:1px" value="KQ2026" aria-label="提取密码"/></div><p class="hint">4–16 位，区分大小写</p></div></div>' +
              '<div class="form-row"><label>收件人邮箱</label><div class="body"><div class="field grow"><div class="tag-input"><span class="tagi">wang.lei@kunqiong.cn<button aria-label="移除">' + K.icon("x", 12) + '</button></span><input placeholder="添加邮箱后回车" /></div></div><p class="hint">发送成功后自动通知收件人，不上传文件本体。</p></div></div>' +
              '<div class="form-row"><label>留言</label><div class="body"><div class="field grow"><textarea class="textarea" rows="2" maxlength="120" placeholder="给收件人留一句话（选填）">最新版报价与交付资料，请查收。</textarea></div><p class="hint">最多 120 字，会显示在取件页。</p></div></div>' +
              '<div class="form-foot between"><span class="tiny">' + K.icon("shield", 13) + ' 上传前将进行安全检测</span><button class="btn primary" data-go="send-uploading">开始上传 ' + K.icon("arrowRight", 15) + '</button></div>' +
            '</div>' +
            '<aside class="aside-sticky">' +
              '<div class="card"><div class="card-hd"><h3>发送摘要</h3><span class="badge blue">4 个文件</span></div><div class="card-bd">' +
                '<div class="mini-files">' + FILES.slice(0, 3).map(function (f) {
                  return '<div class="mini-file"><img src="assets/icons/' + f.t + '.png" alt=""/><span>' + K.esc(f.n) + '</span><small>' + K.fmtBytes(f.s) + '</small></div>';
                }).join("") + '<div class="mini-more">+1 个文件</div></div>' +
                '<dl class="sum-list"><div><dt>总大小</dt><dd>323.0 MB</dd></div><div><dt>有效期</dt><dd>3 天</dd></div><div><dt>下载次数</dt><dd>不限</dd></div><div><dt>提取密码</dt><dd class="mono">KQ2026</dd></div><div><dt>预计用时</dt><dd>约 26 秒</dd></div></dl>' +
              '</div><div class="card-ft"><p class="tiny">' + K.icon("lock", 12) + ' 链接与取件码在发送成功后生成，可随时在分享管理中关闭。</p></div></div>' +
            '</aside>' +
          '</div>' +
        '</div>';
      },
      mount: function () {
        document.querySelectorAll("#shareMode button, #expiryChips .chip, #dlChips .chip").forEach(function (b) {
          b.addEventListener("click", function () {
            var host = b.parentElement;
            host.querySelectorAll(".active").forEach(function (x) { x.classList.remove("active"); });
            b.classList.add("active");
          });
        });
      }
    },

    {
      id: "send-uploading", group: "send", nav: "send", title: "上传中", no: "04",
      render: function () {
        return '<div class="wrap mid">' +
          '<div class="page-hd"><div><div class="crumb"><a href="#/send-home">发文件</a><i>/</i><span>正在上传</span></div><h1>正在上传 4 个文件</h1><p>上传过程请保持页面打开，中断后 11 小时内可继续。</p></div><div class="page-actions"><button class="btn ghost sm" data-toast="已暂停上传">' + K.icon("pause", 14) + '暂停</button><button class="btn danger sm" data-go="send-home">取消上传</button></div></div>' +
          '<div class="card upload-card"><div class="card-bd">' +
            '<div class="upload-top"><div class="upload-file"><img class="ftype" src="assets/icons/ico-folder.png" alt=""/><div><b>项目交付资料.zip</b><span>256.8 MB · 分片 7/10</span></div></div><strong class="pct" id="upPct">68%</strong></div>' +
            '<div class="progress lg"><i id="upBar" style="width:68%"></i></div>' +
            '<div class="upload-meta"><span>' + K.icon("zap", 13) + ' 12.4 MB/s</span><span>' + K.icon("clock", 13) + ' 剩余约 8 秒</span><span>已上传 218.4 MB / 323.0 MB</span></div>' +
            '<div class="phase-list">' +
              '<div class="phase done"><i>' + K.icon("check", 12) + '</i><div><b>分片上传</b><small>4 个文件已全部写入</small></div></div>' +
              '<div class="phase active"><i>' + K.icon("shield", 12) + '</i><div><b>安全检查</b><small>正在检测压缩包内 42 个文件</small></div><span class="badge blue">进行中</span></div>' +
              '<div class="phase"><i>3</i><div><b>生成取件码</b><small>完成后生成链接、二维码与取件码</small></div></div>' +
            '</div>' +
            '<div class="banner info mt16">' + K.icon("info", 16) + '<div><b>安全检查说明</b><br/>系统会逐个文件检测病毒与敏感内容，通常需要几秒；命中风险时整批任务会停止并列出文件。</div></div>' +
          '</div></div>' +
          '<div class="card mt16"><div class="card-hd"><h3>队列</h3><span class="tiny">1 个上传中 · 3 个已完成</span></div><div class="card-bd" style="padding-top:6px;padding-bottom:6px">' +
            '<div class="queue-row"><img src="assets/icons/ico-folder.png" alt=""/><span>项目交付资料.zip</span><div class="progress sm" style="width:120px"><i style="width:68%"></i></div><small class="mono">68%</small></div>' +
            '<div class="queue-row"><img src="assets/icons/ft-pdf.png" alt=""/><span>2026 产品报价单.pdf</span><div class="progress sm green" style="width:120px"><i style="width:100%"></i></div><small>' + K.icon("check", 13) + '</small></div>' +
            '<div class="queue-row"><img src="assets/icons/ft-ppt.png" alt=""/><span>季度复盘演示.pptx</span><div class="progress sm green" style="width:120px"><i style="width:100%"></i></div><small>' + K.icon("check", 13) + '</small></div>' +
          '</div></div>' +
        '</div>';
      },
      mount: function (root) {
        var bar = root.querySelector("#upBar"), pct = root.querySelector("#upPct");
        if (!bar || !pct) return;
        if (K.isEmbed() || K.isStatic()) { bar.style.width = "68%"; pct.textContent = "68%"; return; }
        var v = 68;
        var timer = setInterval(function () {
          v = Math.min(100, v + 1);
          bar.style.width = v + "%";
          pct.textContent = v + "%";
          if (v >= 100) {
            clearInterval(timer);
            setTimeout(function () { K.go("send-success"); }, 600);
          }
        }, 420);
      }
    },

    {
      id: "send-success", group: "send", nav: "send", title: "发送成功", no: "05",
      render: function () {
        return '<div class="wrap mid">' +
          '<div class="card success-card"><div class="card-bd">' +
            '<img class="ok-badge" src="assets/icons/act-success.png" alt=""/>' +
            '<h2>文件发送成功</h2><p class="sub">已生成取件码与分享链接，对方无需注册即可下载。</p>' +
            '<div class="share-panel">' +
              '<div class="share-left">' +
                '<div class="share-item"><div class="share-label">' + K.icon("key", 13) + '取件码</div><div class="code-line"><span class="code">K7Q2M9</span><button class="btn ghost sm" data-copy="K7Q2M9">' + K.icon("copy", 14) + '复制</button><span class="badge ok"><i></i>6 位</span></div></div>' +
                '<div class="share-item"><div class="share-label">' + K.icon("link", 13) + '分享链接</div><div class="copy-line"><input class="input" readonly value="https://kq.cn/s/K7Q2M9"/><button class="btn ghost sm" data-copy="https://kq.cn/s/K7Q2M9">' + K.icon("copy", 14) + '复制</button></div></div>' +
                '<div class="share-item"><div class="share-label">' + K.icon("lock", 13) + '提取密码</div><div class="copy-line"><input class="input mono" readonly value="KQ2026" style="max-width:180px"/><button class="btn ghost sm" data-copy="KQ2026">复制</button><span class="tiny">与链接一起告知对方</span></div></div>' +
              '</div>' +
              '<div class="qr-wrap"><div class="qr">' + K.qrSvg(20260615) + '</div><span>扫码取件</span><a class="text-btn" href="#/send-qr" style="font-size:12.5px">放大二维码</a></div>' +
            '</div>' +
            '<div class="meta-strip"><div><span>文件</span><b>4 个 · 323.0 MB</b></div><div><span>有效期</span><b>3 天后（10-23 18:00）</b></div><div><span>下载次数</span><b>不限次数</b></div></div>' +
            '<div class="success-actions"><button class="btn primary" data-go="send-home">继续发送</button><button class="btn ghost" data-go="share-manage">管理此分享</button><button class="btn ghost" data-toast="取件信息已通过邮件发送">' + K.icon("mail", 15) + '发送到邮箱</button></div>' +
            '<p class="tiny" style="margin-top:14px">担心泄露？可随时在分享管理中关闭链接，关闭后立即失效。</p>' +
          '</div></div>' +
        '</div>';
      }
    },

    {
      id: "send-qr", group: "send", nav: "send", title: "二维码取件", no: "06",
      render: function () {
        return '<div class="wrap">' +
          '<a class="backlink" href="#/send-success">' + K.icon("chevronLeft", 14) + '返回发送结果</a>' +
          '<div class="card qr-page"><div class="card-bd">' +
            '<div class="qr-page-head"><div><span class="eyebrow">扫码取件</span><h1>用手机扫描二维码</h1><p>扫码后可直接预览并下载，无需登录；如设置了密码，需先输入。</p></div><img class="qr-page-icon" src="assets/icons/ico-scan.png" alt=""/></div>' +
            '<div class="qr-page-body"><div class="qr lg">' + K.qrSvg(20260615) + '</div>' +
              '<div class="qr-side"><div class="qr-code-block"><span>取件码</span><b class="mono">K7Q2M9</b><button class="btn ghost sm" data-copy="K7Q2M9">' + K.icon("copy", 14) + '复制</button></div>' +
              '<div class="qr-code-block"><span>链接</span><b class="mono" style="font-size:13.5px;font-weight:500">https://kq.cn/s/K7Q2M9</b><button class="btn ghost sm" data-copy="https://kq.cn/s/K7Q2M9">' + K.icon("copy", 14) + '复制</button></div>' +
              '<div class="banner info" style="margin-top:6px">' + K.icon("info", 15) + '<div>二维码包含取件码与链接，转发截图同样可用。</div></div></div></div>' +
            '<div class="qr-page-foot"><button class="btn ghost" data-toast="二维码图片已下载">' + K.icon("download", 15) + '下载二维码</button><button class="btn primary" data-go="share-manage">进入分享管理</button></div>' +
          '</div></div>' +
        '</div>';
      }
    },

    {
      id: "send-resume", group: "send", nav: "send", title: "断点续传", no: "07",
      render: function () {
        return '<div class="wrap mid">' +
          '<div class="page-hd"><div><h1>发现未完成的上传</h1><p>上次上传在 2 小时前中断，可在 11 小时内继续，无需从头开始。</p></div></div>' +
          '<div class="card"><div class="card-bd">' +
            '<div class="resume-head"><img src="assets/icons/ico-folder.png" alt=""/><div class="grow"><b>项目交付资料.zip</b><small>256.8 MB · 共 10 个分片，已完成 4 个</small></div><span class="badge warn"><i></i>已中断</span></div>' +
            '<div class="progress" style="margin:18px 0 8px"><i style="width:42%"></i></div>' +
            '<div class="flex between tiny"><span>已上传 108.2 MB</span><span>剩余约 12 秒（按当前网速）</span></div>' +
            '<div class="resume-meta"><div><span>开始时间</span><b>今天 15:42</b></div><div><span>最后活动</span><b>今天 15:47</b></div><div><span>续传凭证</span><b>有效至 明天 02:47</b></div></div>' +
            '<div class="banner warn mt16">' + K.icon("alertTriangle", 16) + '<div>若选择重新开始，已上传的分片会被清除，耗时更长。</div></div>' +
            '<div class="form-foot"><button class="btn ghost" data-go="send-home">放弃此次上传</button><button class="btn primary" data-go="send-uploading">' + K.icon("play", 15) + '继续上传</button></div>' +
          '</div></div>' +
        '</div>';
      }
    },

    {
      id: "retrieve", group: "send", nav: "send", title: "取件码取文件", no: "08",
      render: function () {
        return '<div class="wrap">' +
          '<div class="retrieve-wrap">' +
            '<div class="card retrieve-card"><div class="card-bd">' +
              '<img class="big-ico" src="assets/icons/ico-scan.png" alt=""/>' +
              '<h2>输入取件码</h2><p class="sub">取件码由 6 位字母和数字组成，不区分空格。</p>' +
              '<div class="otp" id="otp">' + "K7Q2M9".split("").map(function (c) { return '<span>' + c + '</span>'; }).join("") + '</div>' +
              '<button class="btn primary block" data-go="share-public">查询文件</button>' +
              '<div class="retrieve-help"><span>' + K.icon("helpCircle", 14) + '不知道取件码？请联系发送人</span><a href="#/help">查看帮助</a></div>' +
            '</div></div>' +
            '<div class="recent-retrieve"><h3>最近取件</h3>' +
              '<a class="recent-item" href="#/share-public"><img src="assets/icons/ft-pdf.png" alt=""/><div><b>2026 产品报价单.pdf</b><small>来自 林敬轩 · 今天 14:20</small></div><span class="badge ok">有效</span></a>' +
              '<a class="recent-item" href="#/share-expired"><img src="assets/icons/ico-folder.png" alt=""/><div><b>项目交付资料.zip</b><small>来自 林敬轩 · 10-18 09:12</small></div><span class="badge">已过期</span></a>' +
            '</div>' +
          '</div>' +
        '</div>';
      },
      mount: function () {
        var otp = document.getElementById("otp");
        if (!otp) return;
        otp.querySelectorAll("span").forEach(function (s) {
          s.addEventListener("click", function () { s.classList.toggle("focus"); });
        });
      }
    }
  ]);
})();
