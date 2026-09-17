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
- **组织 roster 的 displayName/email/phone 是入团快照**，改昵称不会自动回写。
  `syncOrganizationMemberProfile(user)` 负责同步，挂在两处：`PATCH /api/auth/profile` 与 `createAuthSession`。
  规则：只补「有值且变了」的字段，账号侧为空时保留 roster 历史值，绝不抹掉已有信息。
  改动涉及成员资料展示时务必回归这条链路。
- **团队邀请链接**：`/e/<slug>/share/`（**不带 token**），两个入口渲染 —— `/workspace` 团队卡片内（`workspace-invite-link`）、
  `/team` 页顶部（`team-invite-link-card`，仅 canManage）。都带复制按钮（`copyTextToClipboard`）。
  ⚠️ 不带 token 的企业路径（`/e/<slug>/share/`、`/e/<slug>/collect/`、`/e/<slug>/`、`/e/<slug>`）由 **`TeamInvitePage`** 渲染
  （hero 卡片 + `TeamJoinRequestCard`）；带 token 才走 SharePage / CollectionSubmitPage。
  早期 `App()` 要求 `parts[2]==='share' && parts[3]`，导致邀请链接落到 WorkspaceApp 兜底、**访客看不到任何入团入口**（已修）。
  改动路由分支时必须回归 `_verify_invite.mjs`。
- 管理后台 /admin：**账号口令登录**（默认 ljxkjadmin / jxljxkj009900，env 可覆盖），
  cookie `kunqiong_admin_session`，TTL 12h，timingSafeEqual 比对 + 8 次/10 分钟限流；
  同时兼容鲲穹管理员账号（ADMIN_USER_IDS）。requireAdminSession 返回 { type, session, user }
- **工作台 /workspace 栅格布局**：12 列 CSS Grid（`.workspace-grid`）。
  hero、`.workspace-benefits-card`、`.workspace-lower-row` 均为 `grid-column: 1 / -1` 通栏。
  团队卡 + 状态卡**并排**装在 `.workspace-lower-row` 内（通栏 + 内部 `minmax(0,1.6fr) minmax(0,1fr)`）。
  ⚠️ 三个必须遵守的约束（都踩过坑）：
  1. `.workspace-team-card` **绝不能**再写 `grid-column: 1 / -1` —— 它在只有 2 列的
     lower-row 里会横跨两栏独占整行，把状态卡挤到下一行。定位交给
     `.workspace-lower-row > .workspace-team-card { grid-column: 1 / 2 }`（status 同理占 `2 / 3`）。
  2. `.workspace-grid .public-card { width: 100% }` 必须是**后代**选择器。写成 `>` 匹配不到
     lower-row 里的孙元素，两卡会回落 `.public-card` 的 `min(570px,100%)` 被硬顶成 570px。
     并在 lower-row 内加 `.workspace-lower-row > .public-card { max-width: none }`。
  3. 子元素有显式 `grid-column` 后，**900px 断点必须显式复位成 `1 / -1`**，
     否则会盖过 `.workspace-lower-row` 的单列定义，窄屏把状态卡压成窄条。
  回归：`node _verify_layout_real.mjs`（真实 Chrome 布局，46 项）+ `_verify_layout.mjs` / `_verify_served.mjs`
  ⚠️ 改此区域后必须确认 `dist/` 已重新构建（浏览器加载产物）

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

## 可复用的验证脚本（根目录 `_verify_*.mjs`，注意各自的输出文件名）
| 脚本 | 覆盖 | 输出 | 项数 |
|---|---|---|---|
| `_verify_flow.mjs` | 真实 HTTP 端到端，完整入团链路 | `_flow.log` | 48 |
| `_verify_nickname.mjs` | roster 昵称/联系方式同步 | `_nick.log` | 19 |
| `_verify_link.mjs` | 邀请链接静态契约 + jsdom 渲染 | `_link.log` | 23 |
| `_verify_layout.mjs` | CSS 契约 + breakpoint 配平 + jsdom 渲染 | `_layout.log` | 39 |
| `_verify_served.mjs` | 直接执行 dist 产物做 DOM 断言 | `_served.log` | 21 |
| `_verify_layout_real.mjs` | **真实 Chrome 布局测量** | `_verify_layout_real.txt` | 46 |
| `_verify_invite.mjs` | 邀请链接路由（真实产物，子进程渲染）+ 入团接口全链路 | `_invite.log` | 38 |
| `_verify_invite_browser.mjs` | **真实 Chrome** 打开邀请落地页，双视口截图 | `_invite_browser.txt` | 12 |

### ⚠️ 渲染 dist 产物必须放子进程
产物是 ESM，同进程内重复 `import` 会被**模块缓存**命中（第二次 import 直接返回缓存，React 不再重新挂载）；
用 `?v=xxx` 绕缓存又会让 Vite 的 URL 处理拿到脏路径而崩。
→ 一个路由一个子进程，用 `execFileSync(process.execPath, [child.mjs, urlPath, outFile])`，结果写 JSON 回读。

### ⚠️ CSS 优先级：width 与 max-width 是两回事
`.team-join-card`（line 899）写在 `.public-card`（line 1168）**之前**，同特异性（都 0,1,0），
**后写的赢** → `.public-card` 的 `width: min(570px,100%)` 把卡片硬顶成 570px。
只在外层写 `max-width: none` **管不住 width**，必须显式 `width: 100%`。
**排查「元素比预期窄」时先看 `width` 而不是只盯 `max-width`，并核对两条规则的先后顺序。**

### ⚠️ jsdom ≠ 布局引擎
jsdom **不做真实布局**。它能断言 DOM 结构（父子/兄弟关系），
但「结构正确 ≠ 视觉正确」—— 两卡同父同层，仍可能因为 `grid-column` / `width` 而竖排。
**凡是「位置、宽度、是否同一行」这类问题，必须用真实浏览器测**，见下。

### 真实浏览器测试模板（可复用）
本机 Chrome：`C:\Program Files\Google\Chrome\Application\chrome.exe`（Edge 同目录也有）。
无 puppeteer/playwright，直接用 **CDP over 原生 WebSocket**（Node 22 内置 `WebSocket`）：
1. `spawn chrome --headless=new --remote-debugging-port=PORT --user-data-dir=<临时目录> --disable-extensions`
   轮询 `GET http://127.0.0.1:PORT/json/version` 直到就绪
2. 连 **browser 级** ws（`version.webSocketDebuggerUrl`），调
   **`Target.createTarget {url:'about:blank'}`**
   ⚠️ `/json/list` 初始可能只有 background_page，**必须自己建 target**
3. 再从 `/json/list` 找该 `targetId` 的 `webSocketDebuggerUrl`，连**页面级** ws
4. `Page.enable` + `Runtime.enable`
5. **注入登录态**（关键）：`Page.addScriptToEvaluateOnNewDocument` 覆写 `window.fetch`，
   让 `/api/auth/me` 返回已登录用户、`/api/account/workspace` 返回团队数据。
   否则 `/workspace` 只渲染「登录后使用团队空间」，量不到任何目标元素（我在这卡了一轮）
6. `Emulation.setDeviceMetricsOverride {width,height,deviceScaleFactor:1}` 设视口
   → `Page.navigate` → 等 ~2s → `Runtime.evaluate` 读 `getBoundingClientRect()` / `getComputedStyle()`
7. `Page.captureScreenshot {format:'png', captureBeyondViewport:true}` 出 PNG 肉眼复核
8. 收尾：`chrome.kill()` + 删除 `--user-data-dir` 临时目录

### 「改了没生效」的排查顺序
产物 CSS → 产物 JS → 构建时间 vs 源码时间 → 本地起 server 验返回 hash → **真实浏览器断言几何**。
若前四步都过、几何仍不对，那就是真 bug（别急着归因缓存 —— 我就误判过一次）。

### 写测试断言的纪律
断言要描述**期望行为**，不要描述**当时的实现**。
我曾把「team-card 通栏 grid-column:1/-1」写成断言，结果这行正是 bug 根源，
修 bug 时反被自己的测试拦住。改用 `_verify_layout_real.mjs` 后立刻复现了真问题。
另一条同源教训：**产物经 minify 后函数名会被 mangle**，不能断言标识符名（如 `TeamInvitePage`），
只能断言字符串字面量与 className。

### fetch stub 的纪律
stub 的返回体必须**结构完整**：页面读 `data.share.files.length`，就得回 `{share:{files:[...]}}` 而不是 `{}`，
否则 control 组直接抛 TypeError、整个脚本崩在开头，真实结论一条都读不到。
另外注入脚本里别做 `JSON.stringify(JSON.stringify(obj))` 双重序列化 —— 注入后是字符串不是对象，
表现为「组件渲染了但状态全空」，很容易误判成代码 bug。
排查手法：先在真实浏览器里记录 `window.fetch` 实际收到的 URL 与响应，别靠猜。

## 注意事项
- CI yml 中明文提交了 OAUTH_CLIENT_SECRET / DB 口令 / 腾讯云密钥，属安全隐患，待提醒用户迁到 Secrets
- 短信通知为模拟；SMTP 未配置时邮件通知只留本地记录
