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
- **⚠️ 套餐模型：个人套餐与团队权益彻底分离（核心不变量，勿破坏）**
  - `accountPersonalPlanForUser(user)` = 用户**自己**的套餐，只看 `user.planId`，与团队归属无关。
    个人空间容量、永久保存、分享有效期、单文件上限的**唯一依据**。
  - `accountTeamEntitlementForUser(user)` = 借用的团队侧能力，**只覆盖 `team` / `teamSpaceBytes`**，
    `totalBytes` / `permanent` / `label` 一律保留成员自己的。
  - `accountEffectivePlanForUser(user)` 保留原名，内部转发到 teamEntitlement（减少改动面）。
  - `organizationTeamSpaceBytes(org)` = 团队空间容量，唯一来源是**所有者**的个人套餐。
  - **历史 Bug（用户报障）**：旧实现里 `accountEffectivePlanForUser` 在「个人是 free」时
    直接 `return 所有者的套餐` → 基础版用户加入企业版团队后个人账户被误判为企业版：
    容量 20GB→2048GB、临时保存→永久保存、`payload.canReopen` 误 open、
    后台用户列表显示企业版、**且想购买会员版会被误判「已享有企业版权益」而拒绝**。
  - 因此 `accountUsageForUser` / `accountTeamUsageForOrganization` / `adminUserSummary` /
    `accountWorkspacePayload` / `publicAccountUser` / `accountBenefitsForUser` **全部改用 personal**。
  - 对外 payload 新增 `teamEntitlement: { organizationId, organizationName, role, canManage,
    teamSpaceBytes, canUseTeamSpace }`；前端据此区分「个人套餐」与「共享团队空间」。
  - 新注册用户默认 `free`：`normalizeAccountUser` 的 `planId: user.planId || null` +
    `normalizePlanId(null) → 'free'`，`mergeAccountUser` 也有 `|| 'free'` 兜底。
  - 回归：`node _verify_plan_isolation.mjs`（33 项）+ `_verify_member_ui.mjs`（9 项，真实浏览器）

- **⚠️ 头像模型：`avatar` 是「粘性」字段（核心不变量，勿破坏）**
  - 三个字段分工：`avatar`（当前展示图，data URL 或 provider URL）、`avatarSource`（`'custom'` = 用户自传 / `''` = 用 provider）、
    `providerAvatar`（上游 OAuth 头像，**独立保存**，用于「恢复登录头像」）。
  - `publicUser` 计算：`providerAvatar = user.providerAvatar || (!avatarSource ? user.avatar : null) || null`。
  - **规则**：一旦 `avatarSource === 'custom'`，任何"没表态"输入都**不得**改动它。
    只有两种操作能改：① `PATCH /api/auth/profile {avatar: <dataURL>}`（重新上传 → custom）；
    ② `{avatar: null}`（恢复登录头像 → 回落 provider）。
  - ⚠️ **「恢复登录头像」必须靠显式标记 `avatarRestoreRequested: true`，不能用 `avatar === null` 判断** ——
    恢复时 `avatar` 会被填成 provider 地址（truthy），不是 null。标记在 `mergeAccountUser` 末尾
    `delete merged.avatarRestoreRequested`，**绝不落库/下发**（`publicUser` 也不认识这个键）。
  - ⚠️ **`upsertAccountUser` / `normalizeAccountUserStore` 必须把「原始输入」交给 `mergeAccountUser`**，
    不能先过 `normalizeAccountUser` —— 后者只输出持久化白名单字段，会把意图标记吞掉
    （这是第二个隐藏缺陷，曾让「恢复登录头像」静默失效，靠插桩才看清）。
  - ⚠️ **`mergeAccountUser` 不能有 `if (!existing) return normalizeAccountUser(incoming)` 短路**，
    否则首条记录合并丢失标记。
  - ⚠️ **`PATCH /api/auth/profile` 与 `POST /api/account/bind` 以「用户表」为准合并，不要整体覆盖 `session.user`**：
    `session.user` 是可能过期的快照，整体覆盖会造成「保存昵称顺手把头像改没了」。
  - **历史 Bug（用户报障「上传过、下次登录就没了」）**：旧实现用
    `avatarSourceExplicit = hasOwnProperty(incoming,'avatarSource')`（**有没有这个键**）判断"是否表态"，
    但 OAuth 登录快照 / 会话快照 / 后台改库都会带**显式 `avatarSource: ''`** →
    `normalizeAccountUserStore` 在**每次重启**把 `metadata.sessions[].user` 合并回用户表时抹掉 custom。
  - 回归：`node _verify_avatar_restart.mjs`（17，抽取真实函数跑 7 场景）
    + `_verify_avatar_e2e.mjs`（15，真实 server 三度重启 + 模拟 OAuth 重登）
    + `_verify_avatar.mjs`（14，基础链路）+ `_probe_avatar_live.mjs`（12，线上）

- **⚠️ metadata 落盘必须原子（核心不变量，勿破坏）**
  - `persistMetadata` 用**临时文件 + `renameSync`** 原子替换，绝不直接 `writeFileSync(metadataPath)` ——
    直接写会先截断目标文件，并发读（重启、其他进程、测试脚本）可能读到半截 JSON
    （真实撞过：回归测试报「Unexpected end of JSON input」）。
  - `loadLocalMetadata` 解析失败时**先尝试 `${metadataPath}.bak` 还原并 console.warn**，
    都失败才返回空库 —— 绝不能静默吞掉损坏（最坏情况：服务重启按空库启动，全部用户/团队/记录丢失）。
  - 回归：`node _verify_atomic_store.mjs`（12，40 写 + 400 并发读零撕裂）。

- **⚠️ 团队页权限门控（核心不变量，勿破坏）**
  - `/team` 页四个页签中「团队成员 manage」「入团申请 requests」**页签和面板都必须 `data.canManage` 门控**；
    成员只能看「成员观察 members」「团队资源 resources」+ 退出团队卡片。
  - 面板渲染用 `visibleTab`（无权页签归一化回落 'members'），页签高亮仍用 `activeTab`。
  - 历史 Bug：manage 页签与面板都漏了门控，任何成员都能看到完整成员名单和移除按钮（真实 Chrome 复核确认）。
  - 退出团队：`POST /api/account/workspace/leave`（所有者 400、未登录 401、不在团 404、成员 200；
    清 `organizationId/organizationRole`、写审计、通知所有者；**不需要团队权益或管理权限**——退出是成员自身权利）。

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
- 管理后台 /admin：**只认账号口令登录**（默认 ljxkjadmin / jxljxkj009900，env `KUNQIONG_ADMIN_USERNAME`/`KUNQIONG_ADMIN_PASSWORD` 可覆盖），
  cookie `kunqiong_admin_session`，TTL 12h，timingSafeEqual 比对 + 8 次/10 分钟限流。
  ⚠️ **限流键不可用 X-Forwarded-For**：`app.set('trust proxy', true)` 下 XFF 可被任意伪造，
  用 XFF 当限流键等于把限流作废（无限次暴力破解）。现用 `adminRateLimitKeys(req)` 返回
  `socket 真实地址` + `proxy 地址` + `global 全局兜底桶`，任一超限即拦（全局桶额度 ×6）。
  三个限流函数签名是 `(req)` 不是 `(ip)`。改这里必须回归 `_verify_admin_audit.mjs`。
  ⚠️ **后台只有这一条鉴权通道，永远不要给 `KUNQIONG_ADMIN_USER_IDS` 白名单开第二条**：
  曾经 `/api/admin/session` 与 `requireAdminSession` 各有一个 `mode:'kunqiong'` 分支，
  白名单账号一登录就能**跳过密码直接进后台**（用户反馈「部分账号还能进去」的真因）。
  两处都必须同时保留/同时移除 —— 它们是双保险，只关一个另一个仍放行。
  `isAdminUser()` **仍然存在，但只用于维护模式等服务端豁免，不参与后台鉴权**。
  `assertServiceWritable` 里必须同时豁免「口令会话」与「白名单账号」，否则管理员登录后台后反而不能传文件。
  `publicAccountUser` **不再下发 `isAdmin`**，顶栏也不再按账号身份显示「后台管理」按钮。
  ⚠️ env 未配置时空字符串是 falsy 会**静默回落内置默认口令**，已加启动告警。改这里必须回归
  `_verify_admin_auth.mjs`（27，沙箱内**故意配置白名单**以证明漏洞已堵）+ `_verify_admin_ui.mjs`（17）
  + `_verify_admin_live.mjs`（12，线上真实浏览器居中校验）+ `_probe_live_admin.mjs`（18，线上接口）
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
  ⚠️ 实测触发有延迟/可能排队（观察到 20 秒 ~ 20+ 分钟不等，取决于 runner 是否空闲）。
  **验证部署靠 `/api/health` 的 `release` 字段与提交 SHA 比对**，别用固定等待时间。
  实测 `5367362` 只用了约 20 秒 —— 所以长时间没更新表示在排队，不代表链路坏了。
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
| `_verify_admin_auth.mjs` | **后台鉴权绕过回归**（沙箱内故意配白名单） | `_admin.log` | 27 |
| `_verify_admin_ui.mjs` | 独立 server + 真实 Chrome 验 /admin 弹窗与居中 | `_admin_ui.txt` | 17 |
| `_verify_admin_live.mjs` | **线上**真实 Chrome 验收 /admin（居中/口令/后台） | `_admin_live.txt` | 12 |
| `_probe_live_admin.mjs` | **线上接口**鉴权实测（未登录全 401 等） | `_admin_live_api.txt` | 18 |
| `_verify_plan_isolation.mjs` | **个人套餐 vs 团队权益**分离（核心业务不变量） | `_plan.log` | 33 |
| `_verify_admin_audit.mjs` | 后台安全审计（删除/自禁用/限流绕过） | `_admin_audit.log` | 24 |
| `_verify_member_ui.mjs` | **真实 Chrome** 验基础版成员工作台界面 | `_member_ui.txt` | 9 |
| `_verify_avatar.mjs` | 头像保存→落盘→重登合并基础链路 | `_avatar_probe.txt` | 14 |
| `_verify_avatar_restart.mjs` | **抽取真实函数**验重启归一化 7 场景（头像粘性） | `_avatar_restart.txt` | 17 |
| `_verify_avatar_e2e.mjs` | **真实 server 三度重启** + 模拟 OAuth 重登 | `_avatar_e2e.txt` | 15 |
| `_probe_avatar_live.mjs` | **线上**头像修复验收 + 后台鉴权未受影响 | `_avatar_live.txt` | 12 |
| `_verify_fixes.mjs` | 五项 UI 改动静态契约 + 退出团队真实 HTTP 全链路 | `_fixes.txt` | 50 |
| `_verify_atomic_store.mjs` | **metadata 落盘原子性**（并发读写压力 + 损坏回退） | `_atomic_store.txt` | 12 |
| `_verify_visual_fixes.mjs` | **真实 Chrome** 复核五项 UI（字号/对齐/门控/弹窗） | `_visual.txt` | 27 |
| `_run_regression.mjs` | 一键跑全部离线套件并汇总（跳过需线上/长时的） | `_regression.txt` | — |

### ⚠️ 本机环境三个新坑（都已踩过，务必规避）
1. **`fs.cpSync(目录, 目录, {recursive:true})` 会静默杀掉整个 node 进程**（exit 127、零输出、无异常）。
   沙箱里复制 `dist/` 必踩。→ 自写 `copyTree` 递归逐文件 `copyFileSync`。
   排查手法：`fs.appendFileSync` 分步写日志定位到具体语句。**别凭直觉归因成 spawn 不可用**
   （实测单独 `spawn` Chrome 完全正常）。
2. **`server.mjs` 不导出 app**（`Object.keys(mod)` 为空），靠 side effect 自行 listen。
   验证脚本里**不要**自己 `server.listen()`，否则抛错静默退出。
   正确做法：设 `process.env.PORT` → `await import(sandbox/server.mjs)` → 轮询 `/api/health` 等就绪。
3. **测试顺序会互相污染**：消耗配额/改变状态的用例（如限流测试）必须放在校验类用例**之后**。
   我把「空账号密码→400」放在限流测试后就吃过假失败（额度已耗尽，被 429 抢答）。
4. **沙箱化真实 server 优先用 `fs.symlinkSync(真实node_modules, 沙箱/node_modules, 'junction')`** ——
   780MB 目录秒建，比 `copyTree` 快几个数量级，且不受坑 1 影响。
5. **脚本卡住先怀疑前面那步耗时过长**：一次 `_verify_avatar_e2e.mjs` "零输出"的真因是
   开头 `fs.rmSync(旧沙箱)` 清理耗时约 87s 触发工具超时，**不是** junction 或 spawn 的问题。
   定位手段永远是**分步 `trace()` 写文件**，别靠猜。
6. **从源码抽取函数做单测时**：`src.indexOf('function name(')` 只命中**声明行**；
   真实签名常跨行（`function f(a = {}) {` 的 `{` 在下一行）→
   先找 `'\nfunction name('`，再 `indexOf(')')` 定位签名末尾，从签名末尾往后找第一个 `{` 开始配平。
   抽出来的函数往往依赖几十个自由变量，需要补一层最小桩（`metadata` / `configuredAccountPlan` /
   `accountUserById` 等），并在桩里用 `let metadataNeedsPersist` 而非 `const`（函数会赋值）。

### ⚠️ 探针路由必须从 server.mjs 核对，别猜
第一版线上探针我写了 `GET /api/admin/users/:userId`，实测 **404 接口不存在**（不是 401，我差点当成鉴权缺陷）。
后台只有 `PATCH /api/admin/users/:userId`。
→ 先 `grep "app\.\(get\|post\|patch\|delete\)('/api/admin"` 拿到真实注册表再写探针；
**404「接口不存在」说明探针自己写错了，与鉴权无关**，别混为一谈。

### ⚠️ 修安全漏洞时的验证纪律
要证明「漏洞已堵」，测试环境必须**保留原本会触发漏洞的配置**（这里就是 `KUNQIONG_ADMIN_USER_IDS`）。
只在默认配置下跑，等于什么也没验证。

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

### 验证脚本的依赖组件必须入库
`_verify_invite.mjs` 依赖 `_invite_child.mjs`（子进程渲染探针）。
我曾把它当临时文件删掉，18 项直接报子进程 MODULE_NOT_FOUND。
**清理临时文件前先确认没有验证脚本 import 它。**

### ⚠️ 兜底文案在「对象不存在」路径上会变成误导
`state.organizationName || '该团队'` 这种兜底，在团队已删除时会把页面变成
「加入『该团队』团队空间」+ 无任何按钮 —— 自相矛盾。
**对象不存在的分支要显式渲染「不可用」状态，不要回落默认值。**
邀请落地页已按此处理：`reason==='unavailable'` → hero 换成「这个邀请链接已失效」，且不渲染加入卡片。

### 负向断言的纪律
`!/该团队/.test(html)` 会误命中「**该团队**不存在或已解散」这句正常说明 → 假阳性。
**负向断言必须精确到特征串**（如 `/加入「该团队」/`），别用一个通用词。

## 注意事项
- CI yml 中明文提交了 OAUTH_CLIENT_SECRET / DB 口令 / 腾讯云密钥，属安全隐患，待提醒用户迁到 Secrets
- 短信通知为模拟；SMTP 未配置时邮件通知只留本地记录
