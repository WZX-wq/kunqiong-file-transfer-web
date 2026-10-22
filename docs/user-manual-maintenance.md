# 使用手册维护

正文唯一来源为 `docs/user-manual-content.mjs`，命名截图位于
`manual_shots/current/`。`_build_manual.mjs` 生成 `public/user-manual.html`，
Vite 构建再复制到 `dist/user-manual.html`。不要只修改生成后的 HTML。

## 更新步骤

1. 按当前产品页面核对正文、入口与按钮名称。
2. 执行 `npm run manual:demo` 创建独立的本机演示环境。该环境使用临时目录、
   合成账号与演示文件，不读取产品 storage；终端输出访问地址和演示信息。
   若默认端口 `8118` 已被另一个演示环境占用，可设置
   `KUNQIONG_MANUAL_DEMO_PORT=8119` 后再启动。
3. 团队套餐失效提示截图可在演示环境运行后执行
   `npm run manual:capture-team-expired`；脚本以过期团队成员身份打开会员空间，
   保存命名截图及页面 DOM 文本。其他截图通过浏览器采集实际页面。保持截图命名稳定，并将当前 URL、截图名称、
   同次采集的 DOM 文字保存到 `manual_shots/current/captures.json`。
4. 将对应图片覆盖到 `manual_shots/current/<name>.png`，在正文中使用同名
   `fig`，配置该图真实显示的按钮或标题。不要用 figure 顺序配图。
5. 完成人工图文核对后执行 `node _build_manual.mjs --refresh-screenshots`，
   显式更新截图 SHA256、尺寸、来源和可见文字清单。普通构建不更新这份锁定清单。
6. 执行 `npm run build`，再执行
   `node scripts/verify-user-manual.mjs --dist --url=http://localhost:8045/user-manual.html`。
   端口按实际服务调整。浏览器核对桌面、窄屏、图片放大与章节跳转。

`npm run build` 的 prebuild 会重新生成并校验手册，图片缺失、哈希变化、图文
配对变化或旧正文都会阻止构建。兼容入口 `_manual_replace_shots.mjs`
仅转发到统一生成器，不再从临时目录按顺序替换图片。

截图是当前版本的操作示例，文件名、账号、容量和日期可随演示环境不同。
截图中不要包含真实用户信息、真实管理链接或认证凭据。不要运行历史
`_seed_manual_demo.mjs` 给正在使用的产品数据填充演示记录。
