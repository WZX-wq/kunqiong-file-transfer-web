# 鲲穹文件传输 Web — 项目记忆

## 项目定位
企业级文件传输/收集 Web Demo（kunqiong-transfer-demo v0.1.0），对接鲲穹统一登录。

## 路由
/ 主应用(send/collect/records 三视图, ?view= 持久化)；/share/:token、/share/manage/:token；/collect/:token、/collect/manage/:token；/e/:slug/...；/settings；/workspace；/admin

## 技术栈
- 前端：React 18 + Vite 6，无路由库（App() 按 pathname 手动分发），全部代码在 src/main.jsx（约 5400 行）+ src/styles.css
- 后端：Express 4 单文件 server.mjs（约 3300 行），multer 上传、archiver 打包 zip、nodemailer 邮件、qrcode 二维码
- 预览：xlsx / mammoth(docx) / pptxviewjs、chart.js（admin 图表）
- 存储：MySQL `kqai_web_send.kunqiong_app_state`（state_key='metadata'，payload 为整份 JSON）；
  本地 storage/metadata.json 只是缓存，被 .gitignore 忽略，误改可从 DB payload 还原

## 核心功能
- 发送(share)：单次≤100 文件、单文件≤5GB；小文件直传 /api/shares，大文件分片上传 /api/upload-sessions（TTL 12h）；分享码/链接/二维码，可设密码、有效期、次数限制；邮件通知模板 email-templates/share-notification.html
- 收集(collection)：创建收集任务，限制类型(8 类格式白名单)/大小/截止日期；他人提交，管理端可查看/下载/删除
- 记录(records)：scope 四类（我发的/发给我的/我收集的/收集给我的），本地 localStorage + 服务端同步
- 账户：OAuth2 授权码模式对接 login.kunqiongai.com，session cookie (kunqiong_session)；分享访问密码用短期 cookie (15min)；绑定手机/邮箱走验证码
- 组织/企业：/e/:slug/... 路径，工作台成员管理；套餐 free/member/team/enterprise（ACCOUNT_PLANS + ACCOUNT_PLAN_RANK）
- 入团申请：分享链接页（/e/:slug/share|collect/:token）内嵌 `TeamJoinRequestCard`，可直接申请加入。
  **复用 organization.members 并新增第三态 `status:'requested'`**（不另建 joinRequests 表），
  member 新增 `joinRequestId/joinSource/joinMessage/requestedAt/reviewedAt`。
  接口：GET/POST `/api/organizations/:slug/join-request`、POST `/api/account/workspace/join-requests/:requestId`（所有者审批）。
  ⚠️ 所有身份判定的分支顺序必须把 **cooldown 排在 invited 之前** —— 被拒记录用 `status:'invited'`+`reviewedAt` 存冷却锚点，
  顺序写错会让冷却永远不可达（已修）。
  ⚠️ `publicOrganization()` 对非所有者过滤 `requested`；`team/overview` 的 `memberUsage` 也必须排除 `requested`，
  否则「团队成员」计数虚高。
- 管理后台 /admin：**账号口令登录**（默认 ljxkjadmin / jxljxkj009900，env 可覆盖），
  cookie `kunqiong_admin_session`，TTL 12h，timingSafeEqual 比对 + 8 次/10 分钟限流；
  同时兼容鲲穹管理员账号（ADMIN_USER_IDS）。requireAdminSession 返回 { type, session, user }

## metadata 内部字段名（易踩错）
- 用户表：`metadata.users`（对象 map，key=userId）—— **不是** `accountUsers`
- 消息：`metadata.messages[userId] = [ ... ]`
- 会话：`metadata.sessions`，形状 `{ id, user, expiresAt }`
- 组织：`metadata.organizations`；审计：`metadata.auditLogs`

## 本地开发陷阱
- server.mjs 顶部 `loadEnvFile('.env')` 会自动加载，而 .env 里 `KUNQIONG_DB_ENABLED=true`
  → 本地跑 server 会连远程 MySQL，本地文件改动会被覆盖。隔离测试必须显式 `KUNQIONG_DB_ENABLED=false`
- Bash 工具本机不可用（缺 ls/cat/head/sleep，bash 路由到被禁用的 WSL，npm build 管道输出乱码）：
  用绝对路径 Node + `node -e` 或临时 .mjs 脚本；shell 语法校验用 PortableGit bash.exe -n
- PowerShell 工具 stdout 会被吞，重定向到文件后用 Read 读
- **脚本内 spawn 子进程会 exit 127 且零输出**（沙箱限制）。要测服务端就同进程内测：
  拷 server.mjs 到临时沙箱 + node_modules junction + **先写 storage/metadata.json 快照再 import**
  （server 启动即加载），`await import(pathToFileURL(沙箱/server.mjs).href)` 在同进程起 Express 再 fetch。
  Windows 绝对路径 import 必须 `pathToFileURL()`。快照 `sessions[].user` 要带完整 nickname/email，
  只写 `{id}` 会让 `displayAccountName` 回落成「鲲穹用户」造成假阳性。

## 部署
- dev: npm run dev（server 8045 + vite 4173）
- prod: npm run build && npm start，同源 8045，server 托管 dist/；有 Dockerfile
- CI: Gitea Actions（.gitea/workflows/deploy-test.yml），push main 自动部署测试服 43.154.197.96:8045
- **部署脚本关键约束**：测试机 8045 由 compose 管理的容器持有端口绑定，
  不能对同名容器一律 `docker rm -f`（会导致 CI 绿但线上旧）。按 compose 项目归属分流处理。
  脚本已内置部署后 release 校验（比对容器内 /api/health 的 release 与提交 SHA）
- 测试服权益收敛：`KUNQIONG_TEST_ENFORCE_ENTERPRISE_ALLOWLIST=true` 时，
  仅 `KUNQIONG_TEST_ENTERPRISE_USER_KEYS`（wx_Ba7AZPo6U9）保留企业版，其余强制回落 free
- Windows 一键启动：start.bat / start.ps1 / start.vbs

## 注意事项
- CI yml 中明文提交了 OAUTH_CLIENT_SECRET / DB 口令 / 腾讯云密钥，属安全隐患，待提醒用户迁到 Secrets
- 短信通知为模拟；SMTP 未配置时邮件通知只留本地记录
