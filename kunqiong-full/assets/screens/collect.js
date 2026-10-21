/* 03 · 文件收集 */
(function () {
  var K = window.KQ;

  function reqChips() {
    return '<span class="badge blue">全部格式</span><span class="badge">单文件 ≤ 500 MB</span><span class="badge">截止 10-30 18:00</span><span class="badge">需登录</span>';
  }

  function submitRow(name, count, size, time, files) {
    return '<div class="submission-card"><div class="submission-head"><span class="avatar sm">' + name.slice(0, 1) + '</span><div class="grow"><b>' + name + '</b><small>' + time + ' · ' + count + ' 个文件 · ' + size + '</small></div><button class="btn ghost sm" data-toast="已打包下载 ' + name + ' 的文件">' + K.icon("download", 13) + '下载全部</button></div><div class="submission-files">' +
      files.map(function (f) {
        return '<div class="sf-row"><img src="assets/icons/' + f.t + '.png" alt=""/><span class="grow">' + K.esc(f.n) + '</span><small class="mono">' + K.fmtBytes(f.s) + '</small><button class="icon-act" title="预览">' + K.icon("eye", 14) + '</button></div>';
      }).join("") + '</div></div>';
  }

  K.register([
    {
      id: "collect-create", group: "collect", nav: "collect", title: "创建收集任务", no: "17",
      render: function () {
        return '<div class="wrap mid">' +
          '<div class="page-hd"><div><div class="crumb"><a href="#/send-home">首页</a><i>/</i><span>收集文件</span></div><h1>创建收集任务</h1><p>生成一个提交链接，向多人收集文件，无需对方注册。</p></div><div class="page-actions"><a class="btn ghost sm" href="#/collect-manage">管理已有收集</a></div></div>' +
          '<div class="split split-fill">' +
            '<div class="card form-card form-compact">' +
              '<div class="form-row"><label>任务标题<span class="req">*</span></label><div class="body"><div class="field"><input class="input" maxlength="40" value="2026 Q4 供应商资质材料" placeholder="例如：秋季活动照片收集"/></div><p class="hint">最多 40 字，显示在提交页</p></div></div>' +
              '<div class="form-row"><label>说明</label><div class="body"><div class="field"><textarea class="textarea" rows="2" maxlength="120" placeholder="说明收集用途、命名规范或注意事项">请按「公司名称 + 材料类型」命名文件，营业执照与资质证书请提供加盖公章的扫描件。</textarea></div><p class="hint">最多 120 字，显示在提交页</p></div></div>' +
              '<div class="form-row"><label>截止时间</label><div class="body body-inline"><div class="field"><input class="input" type="datetime-local" value="2026-10-30T18:00" style="width:200px"/></div><span class="badge">10 天后</span><p class="hint">截止后提交页自动关闭，可重新开启</p></div></div>' +
              '<div class="form-row"><label>文件类型</label><div class="body"><div class="chips"><button class="chip active">全部格式</button><button class="chip">图片</button><button class="chip">文档</button><button class="chip">视频</button><button class="chip">压缩包</button></div><p class="hint">不限格式时仍会安全检查</p></div></div>' +
              '<div class="form-row"><label>单文件上限</label><div class="body"><div class="seg"><button>100 MB</button><button class="active">500 MB</button><button>1 GB</button><button>2 GB</button></div><p class="hint">会员版最多 2 GB</p></div></div>' +
              '<div class="form-row"><label>提交身份</label><div class="body body-inline"><div class="switch-inline"><button class="switch on" data-toggle data-toggle-msg="已要求登录后提交"></button><b>要求登录后提交</b></div><p class="hint">开启后可追溯提交人账号</p></div></div>' +
              '<div class="form-foot"><button class="btn ghost" type="button" data-toast="草稿已保存">保存草稿</button><button class="btn primary" data-go="collect-created">创建收集任务 ' + K.icon("arrowRight", 15) + '</button></div>' +
            '</div>' +
            '<aside class="aside-sticky"><div class="collect-preview"><div class="preview-label">收集任务预览</div><div class="preview-card"><div class="pc-head"><span class="preview-icon">' + K.icon("inbox", 18) + '</span><h4 id="pvTitle">2026 Q4 供应商资质材料</h4></div><p class="pc-desc" id="pvDesc">请按「公司名称 + 材料类型」命名文件，营业执照与资质证书请提供加盖公章的扫描件。</p><div class="pc-meta">' + reqChips() + '</div><div class="preview-drop">' + K.icon("upload", 18) + '<div style="margin-top:6px">拖拽文件到这里，或点击选择</div></div></div></div>' +
              '<div class="card mt16"><div class="card-bd"><dl class="sum-list"><div><dt>收集人</dt><dd>林敬轩</dd></div><div><dt>预计提交人数</dt><dd>不限制</dd></div><div><dt>容量占用</dt><dd>按实际文件计算</dd></div></dl><p class="tiny mt12">' + K.icon("shield", 12) + ' 所有提交文件会经过安全检查，风险文件不会入库。</p></div></div>' +
            '</aside>' +
          '</div>' +
        '</div>';
      },
      mount: function () {
        var title = document.querySelector(".form-card input.input");
        var pv = document.getElementById("pvTitle");
        if (title && pv) title.addEventListener("input", function () { pv.textContent = title.value || "未命名收集任务"; });
        document.querySelectorAll(".form-card .chips .chip").forEach(function (c) {
          c.addEventListener("click", function () { c.classList.toggle("active"); });
        });
      }
    },

    {
      id: "collect-created", group: "collect", nav: "collect", title: "收集任务已创建", no: "18",
      render: function () {
        return '<div class="wrap mid">' +
          '<div class="card success-card"><div class="card-bd">' +
            '<img class="ok-badge" src="assets/icons/act-success.png" alt=""/>' +
            '<h2>收集任务已创建</h2><p class="sub">把提交链接发给对方，对方上传后文件会出现在收集管理中。</p>' +
            '<div class="link-duo">' +
              '<div class="link-block"><div class="lb-head"><span>' + K.icon("link", 14) + '提交链接（发给提交人）</span><span class="badge blue">公开</span></div><div class="copy-line"><input class="input" readonly value="https://kq.cn/c/C8T4R2"/><button class="btn ghost sm" data-copy="https://kq.cn/c/C8T4R2">' + K.icon("copy", 14) + '复制</button></div></div>' +
              '<div class="link-block"><div class="lb-head"><span>' + K.icon("settings", 14) + '管理链接（仅自己可见）</span><span class="badge warn">含凭证</span></div><div class="copy-line"><input class="input" readonly value="https://kq.cn/c/manage/m_9f2a71"/><button class="btn ghost sm" data-copy="https://kq.cn/c/manage/m_9f2a71">' + K.icon("copy", 14) + '复制</button></div><p class="hint" style="margin-top:6px">管理链接可查看全部提交、修改设置与关闭任务，请勿公开。</p></div>' +
            '</div>' +
            '<div class="created-grid">' +
              '<div class="created-item"><span>截止时间</span><b>2026-10-30 18:00</b></div><div class="created-item"><span>允许类型</span><b>全部格式 · ≤ 500 MB</b></div><div class="created-item"><span>提交人</span><b>需登录</b></div>' +
            '</div>' +
            '<div class="created-foot"><div class="qr" style="width:112px;height:112px">' + K.qrSvg(774411) + '</div><div style="text-align:left"><b style="font-size:14px">扫码提交</b><p class="tiny" style="margin-top:4px">二维码与提交链接等价，适合会议现场或海报投放。</p><div class="flex mt12"><button class="btn ghost sm" data-toast="二维码已下载">' + K.icon("download", 13) + '下载</button><a class="btn ghost sm" href="#/collect-manage">查看收集管理</a></div></div></div>' +
          '</div></div>' +
        '</div>';
      }
    },

    {
      id: "collect-manage", group: "collect", nav: "collect", title: "收集管理", no: "19",
      render: function () {
        return '<div class="wrap mid">' +
          '<div class="crumb"><a href="#/collect-create">收集文件</a><i>/</i><span>收集管理</span></div>' +
          '<div class="manage-head"><div><h1>2026 Q4 供应商资质材料 <span class="badge ok"><i></i>收集中</span></h1><p>截止 2026-10-30 18:00 · 需登录提交 · 全部格式 ≤ 500 MB</p></div><div class="page-actions"><button class="btn ghost sm" data-go="collect-settings">' + K.icon("settings", 14) + '收集设置</button><button class="btn ghost sm" data-toast="提交链接已复制">' + K.icon("link", 14) + '提交链接</button></div></div>' +
          '<div class="manage-stats">' +
            '<div class="manage-stat"><span>提交人数</span><b>8</b><small>2 人未完成上传</small></div>' +
            '<div class="manage-stat"><span>收到文件</span><b>23</b><small>全部通过安全检查</small></div>' +
            '<div class="manage-stat"><span>已用容量</span><b>1.8 GB</b><small>占收集额度 3.6%</small></div>' +
            '<div class="manage-stat"><span>剩余时间</span><b>9 天 22 时</b><small>10-30 18:00 截止</small></div>' +
          '</div>' +
          '<div class="manage-grid">' +
            '<div>' +
              '<div class="card"><div class="card-hd"><h3>已收提交</h3><div class="flex"><button class="btn ghost sm" data-toast="已打包下载全部提交">' + K.icon("download", 13) + '全部下载</button><button class="btn ghost sm" data-toast="已导出提交清单 CSV">' + K.icon("fileText", 13) + '导出清单</button></div></div><div class="card-bd" style="padding-top:6px">' +
                submitRow("王磊", 3, "128.4 MB", "今天 15:42", [{ n: "营业执照-王磊.pdf", s: 4.2 * 1024 * 1024, t: "ft-pdf" }, { n: "资质证书.zip", s: 118 * 1024 * 1024, t: "ico-folder" }, { n: "法人授权书.docx", s: 6.2 * 1024 * 1024, t: "ft-doc" }]) +
                submitRow("陈静", 2, "86.2 MB", "今天 14:08", [{ n: "ISO9001-2026.pdf", s: 8.6 * 1024 * 1024, t: "ft-pdf" }, { n: "公司简介.pptx", s: 77.6 * 1024 * 1024, t: "ft-ppt" }]) +
                submitRow("赵敏", 4, "412.0 MB", "昨天 18:20", [{ n: "审计报告.pdf", s: 12.4 * 1024 * 1024, t: "ft-pdf" }, { n: "资质扫描件.zip", s: 386 * 1024 * 1024, t: "ico-folder" }, { n: "纳税证明.jpg", s: 3.2 * 1024 * 1024, t: "ft-jpg" }, { n: "承诺函.docx", s: 10.4 * 1024 * 1024, t: "ft-doc" }]) +
              '</div><div class="card-ft"><div class="flex between"><span class="tiny">共 8 位提交人 · 23 个文件 · 1.8 GB</span><div class="pager"><button class="btn ghost sm">上一页</button><button class="btn ghost sm">下一页</button></div></div></div></div>' +
            '</div>' +
            '<aside><div class="card"><div class="card-hd"><h3>任务信息</h3></div><div class="card-bd"><dl class="sum-list"><div><dt>提交链接</dt><dd class="mono" style="font-size:11.6px">kq.cn/c/C8T4R2</dd></div><div><dt>截止时间</dt><dd>2026-10-30 18:00</dd></div><div><dt>允许类型</dt><dd>全部格式</dd></div><div><dt>单文件上限</dt><dd>500 MB</dd></div><div><dt>提交人身份</dt><dd>需登录</dd></div></dl><div class="qr" style="margin:14px auto 0;width:132px;height:132px">' + K.qrSvg(774411) + '</div><p class="tiny center" style="margin-top:8px">扫码提交材料</p></div></div>' +
              '<div class="danger-zone"><h4>' + K.icon("clock", 14) + '关闭收集</h4><p>关闭后提交链接立即失效，已收到的文件仍会保留。</p><button class="btn danger sm" data-toast="收集任务已关闭（原型演示）">立即关闭</button></div>' +
            '</aside>' +
          '</div>' +
        '</div>';
      }
    },

    {
      id: "collect-settings", group: "collect", nav: "collect", title: "收集设置", no: "20",
      render: function () {
        return '<div class="wrap narrow">' +
          '<a class="backlink" href="#/collect-manage">' + K.icon("chevronLeft", 14) + '返回收集管理</a>' +
          '<div class="page-hd"><div><h1>收集设置</h1><p>修改后对新的提交立即生效。</p></div></div>' +
                    '<div class="card form-card form-compact">' +
            '<div class="form-row"><label>任务状态</label><div class="body body-inline"><div class="switch-inline"><button class="switch on" data-toggle data-toggle-msg="已重新开启收集"></button><b>接受新的提交</b></div><p class="hint">关闭后提交页显示「已截止」</p></div></div>' +
            '<div class="form-row"><label>任务标题</label><div class="body"><div class="field"><input class="input" value="2026 Q4 供应商资质材料" maxlength="40"/></div><p class="hint">提交页标题立即更新</p></div></div>' +
            '<div class="form-row"><label>说明</label><div class="body"><div class="field"><textarea class="textarea" rows="2" maxlength="120">请按「公司名称 + 材料类型」命名文件，营业执照与资质证书请提供加盖公章的扫描件。</textarea></div><p class="hint">最多 120 字</p></div></div>' +
            '<div class="form-row"><label>截止时间</label><div class="body body-inline"><div class="field"><input class="input" type="datetime-local" value="2026-10-30T18:00" style="width:200px"/></div><button class="btn ghost sm" data-toast="已延长 7 天">延长 7 天</button><p class="hint">截止后自动停止收集</p></div></div>' +
            '<div class="form-row"><label>文件类型</label><div class="body"><div class="chips"><button class="chip active">全部格式</button><button class="chip active">图片</button><button class="chip active">文档</button><button class="chip">视频</button><button class="chip active">压缩包</button></div></div></div>' +
            '<div class="form-row"><label>单文件上限</label><div class="body"><div class="seg"><button>100 MB</button><button class="active">500 MB</button><button>1 GB</button><button>2 GB</button></div></div></div>' +
            '<div class="form-row"><label>提交身份</label><div class="body body-inline"><div class="seg"><button class="active">需登录</button><button>允许匿名</button></div><p class="hint">匿名仍记录 IP 与提交时间</p></div></div>' +
            '<div class="form-row"><label>截止提醒</label><div class="body body-inline"><div class="switch-inline"><button class="switch" data-toggle data-toggle-msg="已开启截止提醒"></button><b>截止前 24 小时提醒</b></div><p class="hint">仅向已登录提交人发送一次</p></div></div>' +
            '<div class="form-foot"><button class="btn ghost" data-go="collect-manage">取消</button><button class="btn primary" data-go="collect-manage">保存设置</button></div>' +
          '</div>' +
        '</div>';
      }
    },

    {
      id: "collect-submit", group: "collect", title: "提交文件（需登录）", no: "21", layout: "public",
      render: function () {
        return '<div class="collect-submit-card">' +
          '<div class="public-card">' +
            '<div class="submit-hero"><span class="eyebrow">文件收集</span><h1>2026 Q4 供应商资质材料</h1><p>请按「公司名称 + 材料类型」命名文件，营业执照与资质证书请提供加盖公章的扫描件。</p><div class="submit-meta">' + reqChips() + '</div><div class="submit-by">' + K.icon("user", 13) + ' 收集人：林敬轩 · 剩余 9 天 22 小时</div></div>' +
            '<div class="submit-body">' +
              '<div class="submit-drop"><img src="assets/icons/ico-cloud.png?v=2" alt="" style="width:54px;height:auto"/><h4>拖拽文件到这里上传</h4><p>或点击选择文件，支持一次选择多个</p><div class="flex" style="justify-content:center;margin-top:12px"><button class="btn primary sm" data-demo-add>选择文件</button><button class="btn ghost sm" data-demo-add>选择文件夹</button></div></div>' +
              '<div class="submitted-files"><div class="submitted-file"><img src="assets/icons/ft-pdf.png" alt="" style="width:22px;height:22px"/><span class="grow">营业执照-王磊.pdf</span><small class="mono">4.2 MB</small><button class="icon-act" data-remove>' + K.icon("x", 14) + '</button></div><div class="submitted-file"><img src="assets/icons/ico-folder.png" alt="" style="width:22px;height:22px"/><span class="grow">资质证书.zip</span><small class="mono">118.0 MB</small><button class="icon-act" data-remove>' + K.icon("x", 14) + '</button></div></div>' +
              '<div class="form-grid mt20"><div class="field"><span class="label">联系人姓名<span class="req">*</span></span><input class="input" value="王磊"/></div><div class="field"><span class="label">公司名称<span class="req">*</span></span><input class="input" value="鲲穹供应链有限公司"/></div></div>' +
              '<div class="field mt16"><span class="label">留言（选填）</span><textarea class="textarea" rows="2" placeholder="补充说明，例如缺少某份材料的原因"></textarea><p class="hint">最多 200 字，会随提交一起出现在收集管理中。</p></div>' +
              '<div class="banner info mt16">' + K.icon("lock", 15) + '<div>你已登录为 <b>wang.lei@kunqiong.cn</b>，提交记录会关联到该账号；文件仅收集人可见。</div></div>' +
              '<div class="flex between mt20"><span class="tiny">共 2 个文件 · 122.2 MB</span><button class="btn primary" data-go="collect-submitted">提交 2 个文件 ' + K.icon("arrowRight", 15) + '</button></div>' +
            '</div>' +
          '</div>' +
        '</div>';
      }
    },

    {
      id: "collect-submit-anon", group: "collect", title: "提交文件（匿名）", no: "22", layout: "public",
      render: function () {
        return '<div class="collect-submit-card">' +
          '<div class="public-card">' +
            '<div class="submit-hero"><span class="eyebrow">文件收集</span><h1>2026 Q4 供应商资质材料</h1><p>本次收集允许匿名提交，请至少填写称呼与联系方式，便于收集人核对材料。</p><div class="submit-meta"><span class="badge blue">全部格式</span><span class="badge">单文件 ≤ 500 MB</span><span class="badge">截止 10-30 18:00</span><span class="badge ok">无需登录</span></div><div class="submit-by">' + K.icon("user", 13) + ' 收集人：林敬轩 · 剩余 9 天 22 小时</div></div>' +
            '<div class="submit-body">' +
              '<div class="banner warn" style="margin-bottom:16px">' + K.icon("info", 15) + '<div>匿名提交无法修改或撤回，请在提交前确认文件版本。如需留档，建议先登录。</div></div>' +
              '<div class="submit-drop"><img src="assets/icons/ico-cloud.png?v=2" alt="" style="width:54px;height:auto"/><h4>拖拽文件到这里上传</h4><p>单文件最大 500 MB，最多 20 个文件</p><div class="flex" style="justify-content:center;margin-top:12px"><button class="btn primary sm" data-demo-add>选择文件</button></div></div>' +
              '<div class="submitted-files"><div class="submitted-file"><img src="assets/icons/ft-pdf.png" alt="" style="width:22px;height:22px"/><span class="grow">营业执照-陈静.pdf</span><small class="mono">3.8 MB</small><button class="icon-act" data-remove>' + K.icon("x", 14) + '</button></div></div>' +
              '<div class="form-grid mt20"><div class="field"><span class="label">称呼<span class="req">*</span></span><input class="input" placeholder="例如：陈静"/></div><div class="field"><span class="label">邮箱或手机<span class="req">*</span></span><input class="input" placeholder="用于收集人核对材料"/></div></div>' +
              '<div class="field mt16"><span class="label">公司名称<span class="req">*</span></span><input class="input" placeholder="请输入公司全称"/></div>' +
              '<div class="field mt16"><span class="label">留言（选填）</span><textarea class="textarea" placeholder="补充说明"></textarea></div>' +
              '<div class="flex between mt20"><span class="tiny">共 1 个文件 · 3.8 MB</span><button class="btn primary" data-go="collect-submitted">提交文件 ' + K.icon("arrowRight", 15) + '</button></div>' +
            '</div>' +
          '</div></div>';
      }
    },

    {
      id: "collect-submitted", group: "collect", title: "提交成功", no: "23", layout: "public",
      render: function () {
        return '<div class="state-card public-card" style="max-width:520px"><div class="card-bd">' +
          '<img class="ok-badge" src="assets/icons/act-success.png" alt=""/>' +
          '<h2>文件提交成功</h2><p>收集人「林敬轩」已收到你的文件，无需重复提交。<br/>如需补充材料，可在截止前再次提交。</p>' +
          '<div class="receipt"><div class="receipt-row"><span>提交编号</span><b class="mono">SUB-20261020-0042</b></div><div class="receipt-row"><span>提交文件</span><b>2 个 · 122.2 MB</b></div><div class="receipt-row"><span>提交时间</span><b>2026-10-20 16:32</b></div><div class="receipt-row"><span>关联账号</span><b>wang.lei@kunqiong.cn</b></div></div>' +
          '<div class="flex" style="justify-content:center;margin-top:22px"><button class="btn ghost" data-toast="提交回执已复制">' + K.icon("copy", 14) + '复制回执</button><a class="btn primary" href="#/collect-submit">再提交一份</a></div>' +
          '<p class="tiny mt16">请勿关闭此页面前的提交，文件仍在安全检测中；检测通过后才会出现在收集管理里。</p>' +
        '</div></div>';
      }
    },

    {
      id: "collect-closed", group: "collect", title: "收集已截止", no: "24", layout: "public",
      render: function () {
        return '<div class="state-card public-card"><div class="card-bd">' +
          '<div class="state-icon gray">' + K.icon("clock", 27) + '</div>' +
          '<h2>收集已截止</h2><p>「2026 Q4 供应商资质材料」已于 2026-10-30 18:00 停止收集。<br/>如果你仍需要提交材料，请联系收集人重新开启。</p>' +
          '<div class="expired-meta"><div><span>收集人</span><b>林敬轩</b></div><div><span>已收到</span><b>8 位提交</b></div><div><span>截止时间</span><b>2026-10-30 18:00</b></div></div>' +
          '<div class="flex" style="justify-content:center;margin-top:22px"><a class="btn ghost" href="#/send-home">返回首页</a><a class="btn primary" href="#/login">登录查看我的提交</a></div>' +
        '</div></div>';
      }
    }
  ]);
})();
