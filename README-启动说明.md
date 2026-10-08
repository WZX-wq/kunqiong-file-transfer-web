# 鲲穹文件传输 Web Demo

## 运行环境

- Windows、macOS 或 Linux
- Node.js 18 或更高版本
- 能够访问 npm 镜像或 npm 官方仓库

## Windows 启动方式

1. 解压项目压缩包。
2. 双击项目根目录下的 `start.bat`。
3. 等待终端出现前端地址。
4. 浏览器打开：

   `http://localhost:4173/`

第一次启动会自动安装依赖，之后再次启动会直接运行。

## 命令行启动方式

在项目根目录打开终端，执行：

```bash
npm install
npm run dev
```

然后访问：

```text
http://localhost:4173/
```

## 测试服务器部署

在测试服务器上建议使用同源部署，前端构建产物由 Node 服务直接托管：

```bash
npm ci
npm run build
npm start
```

默认服务端口是 `8045`，浏览器访问 `http://服务器IP:8045/`。部署前复制 `.env.example` 为 `.env`，把 `KUNQIONG_APP_URL` 和 `KUNQIONG_AUTH_CALLBACK_URL` 改成测试服务器 IP 或正式域名；腾讯云 SMTP 参数配置在 `KUNQIONG_SMTP_*` 环境变量中，密码只放在服务器 `.env`，不要提交到代码仓库。`KUNQIONG_SMTP_TEMPLATE_ID` 当前作为模板标识保留，SMTP 链路使用项目内 HTML 邮件模板发送。

当前仓库已包含 Gitea Actions 测试部署流程：推送到 Gitea 的 `main` 分支后会由服务器 runner 自动构建并部署到测试环境，测试环境使用独立 `.env`，不会覆盖本地 `.env`。

## 文件安全扫描

上传文件发布前会通过 ClamAV 流式扫描。默认 `KUNQIONG_SCAN_MODE=required`；扫描服务未连接、超时或返回异常时，文件不会发布。

- 使用 `scripts/deploy-test.sh` 的 Docker 部署时，会一并启动 ClamAV 服务，并使用 `deployment/clamd.conf` 配置扫描上限。
- 本地运行 `npm run dev` 或手动运行 `npm start` 时，需要另行启动 ClamAV，并让它在 `.env` 配置的主机和端口上接受连接；默认是 `127.0.0.1:3310`。ClamAV 病毒库也需要保持更新。
- 应用单文件上传上限为 5 GB，ClamAV 的流和文件扫描上限需要覆盖该值。没有可用扫描服务时上传会失败关闭，不会跳过扫描。

## 局域网内给别人看

如果对方和启动项目的电脑连接在同一个 Wi-Fi 或局域网：

1. 在启动电脑执行 `ipconfig`。
2. 找到本机 IPv4 地址，例如 `192.168.1.11`。
3. 对方浏览器访问：

   `http://192.168.1.11:4173/`

如果无法访问，需要允许 Windows 防火墙放行 Node.js 或 4173 端口。

## 发送压缩包时

建议不要压缩以下目录和文件：

- `node_modules`
- `dist`
- `storage`
- `*.log`
- `qa-*.png`
- `_docx_extract*`
- `_requirements*`
- `_api-*.txt`

保留 `package.json` 和 `package-lock.json`，对方会在第一次启动时自动安装依赖。

## 停止服务

在运行窗口按 `Ctrl + C`，然后按提示确认即可。

## 注意

这是本地 Demo 版本。上传文件会保存在启动电脑的 `storage` 目录中；不同电脑之间不会自动共享数据。邮件通知已支持通过 SMTP 真实发送，短信通知仍是模拟展示。

短信模板文案位于 `notification-templates/sms-templates.json`，包括绑定验证码、登录验证码、团队邀请、文件分享、会员开通和到期提醒六类。提交腾讯云审核后，把对应模板 ID 填入 `.env`。支付结果文案位于 `notification-templates/payment-messages.json`，支付接入时用于站内消息和支付结果提示。

数据库模式使用 MySQL 配置 `KUNQIONG_DB_*`。首次启动时，如果 `kunqiong_app_state` 表为空，服务会把本地 `storage/metadata.json` 迁移进去；后续账号、分享、团队、消息和订单元数据会同步保存到数据库。文件内容仍保存于 `storage/files` 和 `storage/collections`，部署测试服和正式服时需要同步这两个目录或改接对象存储。

会员支付使用 `web_member_subsite_api.md` 中的主站接口。配置 `KUNQIONG_WEB_MEMBER_API_BASE` 和 `KUNQIONG_WEB_MEMBER_SUBSITE_NAME`，可选填三个主站 `package_id`。用户重新登录后，系统会用统一登录返回的会话 Token 创建微信扫码或支付宝订单，并轮询主站支付状态；支付成功后自动开通本地对应权益。支付回调仍由主站处理，本项目不模拟回调。
