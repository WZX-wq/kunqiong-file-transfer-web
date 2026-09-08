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

默认服务端口是 `8045`，浏览器访问 `http://服务器IP:8045/`。部署前复制 `.env.example` 为 `.env`，把 `KUNQIONG_APP_URL` 和 `KUNQIONG_AUTH_CALLBACK_URL` 改成测试服务器 IP 或正式域名；SMTP 相关参数可以先留空，邮件通知会保留为本地记录。

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

这是本地 Demo 版本。上传文件会保存在启动电脑的 `storage` 目录中；不同电脑之间不会自动共享数据。真实短信、邮件通知目前仍是模拟展示。
