# 鲲穹文件传输 Web — 项目记忆

> 本文件是**精炼索引**：只记「不变量 / 约定 / 坑」。细节与当日过程见同目录 `YYYY-MM-DD.md`。

## 1. 项目概览
企业级文件传输/收集 Web 应用（kunqiong-transfer-demo v0.1.0），对接鲲穹统一登录。

- **前端** React 18 + Vite 6，**无路由库** —— `App()` 按 `pathname` 手动分发；全在 `src/main.jsx`(~6200 行) + `src/styles.css`
- **后端** Express 4 单文件 `server.mjs`(~4600 行，80+ 路由)；multer / archiver / nodemailer / qrcode
- **预览** xlsx、mammoth(docx)、pptxviewjs；admin 图表 chart.js
- **存储** MySQL `kqai_web_send.kunqiong_app_state`(`state_key='metadata'`，payload 为整份 JSON)；
  本地 `storage/metadata.json` 只是缓存(已 .gitignore)，误改可从 DB payload 还原

## 2. 路由与功能
| 路由 | 说明 |
|---|---|
| `/` | 主应用，三视图 `send` / `collect` / `records`，`?view=` 持久化 |
| `/share/:token`、`/share/manage/:token` | 分享访问 / 管理 |
| `/collect/:token`、`/collect/manage/:token` | 收集提交 / 管理 |
| `/e/:slug/...` | 企业（团队）路径；**不带 token** 时走 `TeamInvitePage` |
| `/settings`、`/workspace`、`/team`、`/admin` | 设置 / 工作台 / 团队 / 后台 |

- **发送** ≤100 文件/次、≤5GB/文件；小文件直传 `/api/shares`，大文件分片 `/api/upload-sessions`(TTL 12h)；
  分享码/链接/二维码，可设密码/有效期/次数；邮件模板 `email-templates/share-notification.html`
- **收集** 限类型(8 类白名单)/大小/截止日期；管理端可查看/下载/删除
- **记录** 四类 scope(我发的/发给我的/我收集的/收集给我的)，localStorage + 服务端同步
- **账户** OAuth2 授权码对接 `login.kunqiongai.com`，cookie `kunqiong_session`；分享密码用 15min 短期 cookie
- **套餐** `free`(20GB,永久✗) / `member`(100GB,永久✓) / `team`(500GB,teamSpace 250GB) /
  `enterprise`(2048GB,teamSpace 1TB)；`ACCOUNT_PLAN_RANK={free:0,member:1,team:2,enterprise:3}`

## 3. 核心不变量（改动前必读，破坏即出线上事故）

### 3.1 个人套餐 ⊥ 团队权益（必须彻底分离）
- `accountPersonalPlanForUser(user)` = 用户**自己**的套餐(只看 `user.planId`) —— 个人容量/永久/有效期/单文件上限的**唯一依据**
- `accountTeamEntitlementForUser(user)` = 借用团队侧能力，**只覆盖 `team`/`teamSpaceBytes`**；`totalBytes`/`permanent`/`label` 保留成员自己的
- `accountEffectivePlanForUser(user)` 保留原名(内部转发 teamEntitlement，减少改动面)
- `organizationTeamSpaceBytes(org)` 唯一来源是**所有者**个人套餐
- 故 `accountUsageForUser`/`accountTeamUsageForOrganization`/`adminUserSummary`/`accountWorkspacePayload`/`publicAccountUser`/`accountBenefitsForUser` **全用 personal**
- 对外 payload 带 `teamEntitlement:{organizationId,organizationName,role,canManage,teamSpaceBytes,canUseTeamSpace}`
- 新用户默认 free：`planId: user.planId || null` + `normalizePlanId(null)→'free'`；`mergeAccountUser` 也 `|| 'free'` 兜底
- **历史 Bug**：旧实现「个人 free」时直接 return 所有者套餐 → 进企业版团队后容量 20GB→2048GB、临时→永久、`canReopen` 误 open、后台显示企业版、**且无法购买会员版**
- 回归 `_verify_plan_isolation.mjs`(33) + `_verify_member_ui.mjs`(9)

### 3.1b 团队资源的「永久保存」由团队决定，不看上传者个人套餐
- 前端上传团队文件固定传 `expiryDays:'0'`(永久)。`readShareOptions` 曾用 `accountEffectivePlanForUser(user).permanent` 校验
  → **基础版成员(permanent=false)往企业版团队空间上传恒 403**（「永久保存需要会员版或更高权益」）
- **正确语义**：团队资源是否永久由**团队空间**决定(容量属于所有者)，与上传者个人套餐无关
- 实现 `readShareOptions(body, user, isTeamResource=false)`，true 时跳过个人 permanent 校验；会话创建处
  `const isTeamResourceSession = req.body.mode === 'team_resource'` 并透传（`POST /api/shares` 直传**不**传第三参）
- ⚠️ 只放行「团队资源」这一条。**个人分享**永久校验必须原样 —— 绝不能用 `accountEffectivePlanForUser().team` 之类宽条件，
  否则基础版成员在团队里就能开个人永久分享
- 对照：团队资源不计入个人用量(`accountUsageForUser` 已滤 `teamResource`)；容量走 `accountTeamUsageForOrganization`(所有者 `teamSpaceBytes`)
- 前端 `/team` 上传按钮门控只看「是否 active 成员」，与个人套餐无关(本就正确)
- 回归 `_verify_team_upload.mjs`(23) + `_verify_team_upload_ui.mjs`(14，真实 Chrome) + `_verify_team_upload_live.mjs`(6，线上)

### 3.2 `avatar` 是「粘性」字段
- 三字段 `avatar`(当前展示)、`avatarSource`(`'custom'`=自传/`''`=provider)、`providerAvatar`(上游 OAuth，独立保存)
- `publicUser`：`providerAvatar = user.providerAvatar || (!avatarSource ? user.avatar : null) || null`
- **规则** `avatarSource==='custom'` 后，任何"没表态"的输入**不得**改动它。只有 ① `PATCH /api/auth/profile {avatar:<dataURL>}`(→custom) ② 恢复登录头像(回落 provider) 能改
- ⚠️ 恢复靠显式标记 `avatarRestoreRequested: true`，**不能**用 `avatar===null` 判断(恢复时 avatar 是 truthy)。该标记在 `mergeAccountUser` 末尾 `delete`，**绝不落库/下发**
- ⚠️ `upsertAccountUser`/`normalizeAccountUserStore` 必须把**原始输入**交给 `mergeAccountUser`(先过 `normalizeAccountUser` 会吞掉意图标记)
- ⚠️ `mergeAccountUser` **不能**有 `if (!existing) return normalizeAccountUser(incoming)` 短路
- ⚠️ `PATCH /api/auth/profile` 与 `POST /api/account/bind` 以**用户表**为准合并，别整体覆盖 `session.user`(过期快照会「保存昵称顺手把头像改没」)
- **历史 Bug**「上传过、下次登录就没了」：旧实现用「有没有 `avatarSource` 键」判断表态，但 OAuth/快照/后台改库都带**显式 `avatarSource:''`** → 重启合并 `metadata.sessions[].user` 时抹掉 custom
- 回归 `_verify_avatar_restart.mjs`(17) + `_verify_avatar_e2e.mjs`(15) + `_verify_avatar.mjs`(14) + `_probe_avatar_live.mjs`(12)

### 3.3 metadata 落盘必须原子
- `persistMetadata` 用**临时文件 + `renameSync`**，绝不直接 `writeFileSync(metadataPath)`(先截断目标，并发读拿到半截 JSON)
- `loadLocalMetadata` 解析失败**先尝试 `.bak` 还原并 console.warn**，都失败才返回空库；绝不静默吞损坏(最坏：空库启动 → 全部数据丢失)
- 回归 `_verify_atomic_store.mjs`(12，40 写 + 400 并发读零撕裂)

### 3.4 团队页权限门控
- `/team` 四页签中「团队成员 manage」「入团申请 requests」**页签与面板都需 `data.canManage` 门控**；成员只能看 members/resources + 退出卡片
- 面板用 `visibleTab`(无权页签回落 `'members'`)，页签高亮仍用 `activeTab`
- **历史 Bug**：manage 页签与面板都漏门控，任何成员可见完整名单与移除按钮
- 退出团队 `POST /api/account/workspace/leave`：所有者 400 / 未登录 401 / 不在团 404 / 成员 200；清 `organizationId/organizationRole` + 写审计 + 通知所有者；**不需要团队权益或管理权限**

### 3.5 入团申请
- 分享链接页(`/e/:slug/share|collect/:token`)内嵌 `TeamJoinRequestCard`
- **复用 `organization.members` 新增第三态 `status:'requested'`**(不另建表)；member 新增 `joinRequestId/joinSource/joinMessage/requestedAt/reviewedAt`
- 接口 `GET/POST /api/organizations/:slug/join-request`、`POST /api/account/workspace/join-requests/:requestId`(所有者审批)
- ⚠️ 身份判定分支顺序必须 **cooldown 排在 invited 之前** —— 被拒记录用 `status:'invited'`+`reviewedAt` 存冷却锚点，顺序写错冷却永不可达
- ⚠️ `publicOrganization()` 对非所有者要过滤 `requested`；`team/overview` 的 `memberUsage` 也必须排除(否则成员数虚高)

### 3.6 组织 roster 资料
- roster 的 `displayName/email/phone` 是**入团快照**，改昵称不自动回写。`syncOrganizationMemberProfile(user)` 挂在 `PATCH /api/auth/profile` 与 `createAuthSession` 两处
- 规则：只补「有值且变了」的字段；账号侧为空时保留 roster 历史值，**绝不抹掉已有信息**

### 3.7 收集任务提交者身份（登录 / 匿名双轨）
- `resolveCollectionSubmitter(req)` 唯一判定入口：登录用户以**服务端会话**为准，落库 `submitterUserId`/`submitterName` 并**覆盖客户端 `participantName`**(防伪造)；未登录回落请求体名称
- **不能强制登录** —— 强制会让外部协作者链路断掉，故设计为登录/匿名双轨
- submission 两字段分工：`submitterUserId`(去规范化，管理端据此查**当前**昵称) + `submitterName`(提交时快照，账号被删兜底)；`publicSubmissionSubmitter` 下发 `submitter` 块
- ⚠️ 两条提交路径都要带：表单直传 `/api/collections/:token/submissions` + 分片 `/api/upload-sessions`(建会话时记，`complete` 时写进 submission)
- ⚠️ `normalizeRecordSubmissions` 必须保留这两字段，否则记录同步会丢
- ⚠️ 提交页登录态**隐藏手填框**(`.collection-identity`)、显示账号身份卡；未登录保留手填 + 「登录后提交」入口。管理端按 `submission.submitter` 渲染「账号提交/匿名提交」徽标(`.submission-account-badge`/`.submission-anon-badge`)
- ⚠️ `/api/collections/manage/:manageToken` **是 bearer 凭证，不校验登录身份**，非所有者 200 是**预期行为**，别写成 403 断言
- 回归 `_verify_collect_login.mjs`(43) + `_verify_collect_login_ui.mjs`(14，真实 Chrome)

### 3.8 团队邀请链接
- 形态 `/e/<slug>/share/`(**不带 token**)，入口：`/workspace` 团队卡片(`.workspace-invite-link`)、`/team` 顶部(`.team-invite-link-card`，仅 canManage)；都带复制按钮
- ⚠️ 不带 token 的企业路径(`/e/<slug>/share/`、`/e/<slug>/collect/`、`/e/<slug>/`、`/e/<slug>`)由 **`TeamInvitePage`** 渲染(hero + `TeamJoinRequestCard`)；带 token 才走 SharePage / CollectionSubmitPage
  早期 `App()` 要求 `parts[2]==='share' && parts[3]` → 邀请链接落到 WorkspaceApp 兜底、**访客看不到入团入口**
- 回归 `_verify_invite.mjs`(38) + `_verify_invite_browser.mjs`(12)

### 3.9 管理后台 /admin 只有一条鉴权通道
- 只认账号口令(默认 `ljxkjadmin`/`jxljxkj009900`，env `KUNQIONG_ADMIN_USERNAME`/`KUNQIONG_ADMIN_PASSWORD` 可覆盖)；cookie `kunqiong_admin_session` TTL 12h，`timingSafeEqual` + 8 次/10 分钟限流
- ⚠️ **限流键不可用 X-Forwarded-For**(`trust proxy=true` 下 XFF 可伪造 = 限流作废)。用 `adminRateLimitKeys(req)` = socket 真实地址 + proxy 地址 + global 兜底桶，任一超限即拦(全局桶 ×6)。三个限流函数签名是 `(req)` 不是 `(ip)`
- ⚠️ **永远不要给 `KUNQIONG_ADMIN_USER_IDS` 白名单开第二条通道**：曾 `/api/admin/session` 与 `requireAdminSession` 各有 `mode:'kunqiong'` 分支 → 白名单账号**免密码进后台**(用户反馈「部分账号还能进去」的真因)。两处必须**同时**保留/移除
- `isAdminUser()` 仍存在但**只用于维护模式等服务端豁免**，不参与后台鉴权
- `assertServiceWritable` 必须同时豁免「口令会话」与「白名单账号」，否则管理员进后台后反而不能传文件
- `publicAccountUser` **不再下发 `isAdmin`**；顶栏也不再按账号身份显示「后台管理」
- ⚠️ env 未配置时空字符串 falsy 会**静默回落内置默认口令**，已加启动告警
- 回归 `_verify_admin_auth.mjs`(27，沙箱内**故意配白名单**证明漏洞已堵) + `_verify_admin_ui.mjs`(17) + `_verify_admin_live.mjs`(12) + `_probe_live_admin.mjs`(18) + `_verify_admin_audit.mjs`(24)

### 3.10 工作台 /workspace 栅格布局
12 列 CSS Grid(`.workspace-grid`)。hero、`.workspace-benefits-card`、`.workspace-lower-row` 均 `grid-column: 1 / -1` 通栏；团队卡 + 状态卡并排装在 lower-row 内(`minmax(0,1.6fr) minmax(0,1fr)`)。三条铁律：
1. `.workspace-team-card` **绝不能**再写 `grid-column: 1 / -1` —— 在只有 2 列的 lower-row 里会独占整行把状态卡挤下去。定位交给 `.workspace-lower-row > .workspace-team-card { grid-column: 1 / 2 }`(status 占 `2 / 3`)
2. `.workspace-grid .public-card { width: 100% }` 必须是**后代**选择器。写成 `>` 匹配不到孙元素，两卡会回落 `.public-card` 的 `min(570px,100%)` 被硬顶；并加 `.workspace-lower-row > .public-card { max-width: none }`
3. 子元素有显式 `grid-column` 后，**900px 断点必须显式复位成 `1 / -1`**，否则窄屏把状态卡压成窄条
- 回归 `_verify_layout_real.mjs`(46，真实 Chrome) + `_verify_layout.mjs`(39) / `_verify_served.mjs`(21)；⚠️ 改此区后必须确认 `dist/` 已重建

## 4. metadata 内部字段名（易踩错）
- 用户表：`metadata.users`（对象 map，key=userId）—— **不是** `accountUsers`
- 消息：`metadata.messages[userId] = [...]`；会话：`metadata.sessions`，形状 `{id, user, expiresAt}`
- 组织：`metadata.organizations`；审计：`metadata.auditLogs`

## 5. 开发 / 部署
- dev：`npm run dev`（server 8045 + vite 4173）；prod：`npm run build && npm start`，同源 8045，server 托管 `dist/`；有 Dockerfile
- **双远端**：`origin` = Gitee `zhanlinhai/kunqiong-file-transfer-web`；
  `gitea` = `http://43.154.197.96/giteaadmin/kunqiong-file-transfer-web.git`。**两个都要推。**
- CI：Gitea Actions（`.gitea/workflows/deploy-test.yml`），push main 自动部署测试服 `43.154.197.96:8045`。
  ⚠️ 触发有延迟/可能排队（20 秒 ~ 20+ 分钟，取决于 runner 空闲度）。
- **验证部署的正确方法**：比对 `/api/health` 的 `release` 与**仓库 main**。
  ⚠️ 但 release 只反映 commit，**不反映运行时代码是否变化**：
  仅测试脚本/文档变动的提交，`server.mjs`+`src/` 未变 → Vite 产物哈希不变 → 容器无需重建，
  此时「对外 release 落后于 main」是**正常现象**。判断部署是否真生效应比对
  `git diff --name-only <线上release> <main>` 是否触及 `server.mjs` / `src/` / `index.html` / `package.json`。
- CI 日志无需登录可读：`/giteaadmin/<repo>/actions/runs/<id>/jobs/0/logs`；
  运行列表页面按 `<div class="flex-item tw-items-center">` 切块解析（`title=` / `data-tooltip-content=` / `commit/<sha>`）。
- 部署脚本：测试机 8045 由 compose 管理的容器持有端口绑定，**不能对同名容器一律 `docker rm -f`**
  （会 CI 绿但线上旧）；按 compose 项目归属分流。脚本已内置部署后 release 校验。
- 测试服权益收敛：`KUNQIONG_TEST_ENFORCE_ENTERPRISE_ALLOWLIST=true` 时仅
  `KUNQIONG_TEST_ENTERPRISE_USER_KEYS`（`wx_Ba7AZPo6U9`）保留企业版，其余强制回落 free。
- Windows 一键启动：`start.bat` / `start.ps1` / `start.vbs`

## 6. 验证脚本（根目录 `_verify_*.mjs` / `_probe_*.mjs`，一键 `node _run_regression.mjs` → `_regression.txt`）
| 脚本 | 覆盖 | 输出 | 项 |
格式：`脚本 (项数) → 输出文件`；标 🌐 者依赖真实 Chrome，标 ☁ 者打线上。

- `_verify_flow.mjs`(48)→`_flow.log` 真实 HTTP 端到端，完整入团链路
- `_verify_nickname.mjs`(19)→`_nick.log` roster 昵称/联系方式同步
- `_verify_link.mjs`(23)→`_link.log` 邀请链接静态契约 + jsdom
- `_verify_layout.mjs`(39)→`_layout.log` CSS 契约 + breakpoint 配平 + jsdom
- `_verify_layout_real.mjs`(46) 🌐 真实 Chrome 布局测量
- `_verify_served.mjs`(21)→`_served.log` 直接执行 dist 产物做 DOM 断言
- `_verify_invite.mjs`(38)→`_invite.log` 邀请链接路由(产物子进程渲染) + 入团接口
- `_verify_invite_browser.mjs`(12) 🌐 邀请落地页双视口截图
- `_verify_admin_auth.mjs`(27)→`_admin.log` **后台鉴权绕过回归**(沙箱内故意配白名单)
- `_verify_admin_ui.mjs`(17) 🌐 /admin 弹窗居中
- `_verify_admin_live.mjs`(12) 🌐☁ 线上验收 /admin
- `_probe_live_admin.mjs`(18)→`_admin_live_api.txt` ☁ 线上接口鉴权实测
- `_verify_admin_audit.mjs`(24)→`_admin_audit.log` 删除/自禁用/限流绕过
- `_verify_plan_isolation.mjs`(33)→`_plan.log` **个人套餐 vs 团队权益**分离
- `_verify_member_ui.mjs`(9) 🌐 基础版成员工作台
- `_verify_avatar.mjs`(14)→`_avatar_probe.txt` 头像保存→落盘→重登
- `_verify_avatar_restart.mjs`(17) 抽取真实函数验重启归一化 7 场景
- `_verify_avatar_e2e.mjs`(15) 真实 server 三度重启 + 模拟 OAuth 重登
- `_probe_avatar_live.mjs`(12)→`_avatar_live.txt` ☁ 线上头像验收
- `_verify_fixes.mjs`(50)→`_fixes.txt` 五项 UI 契约 + 退出团队全链路
- `_verify_atomic_store.mjs`(12) metadata 落盘原子性(40 写 + 400 并发读)
- `_verify_visual_fixes.mjs`(27)→`_visual.txt` 🌐 复核五项 UI
- `_verify_collect_login.mjs`(43)→`_collect_login.txt` 收集提交登录态
- `_verify_collect_login_ui.mjs`(14) 🌐 收集提交页两种身份态 + 窄屏
- `_verify_team_upload.mjs`(23)→`_team_upload.txt` 团队资源上传权限 + 反向对照
- `_verify_team_upload_ui.mjs`(14) 🌐 基础版成员 /team 完整上传链路
- `_verify_team_upload_live.mjs`(6)→`_probe_team_live.txt` ☁ 团队上传权限 + release 一致性

## 7. 环境与工具约束（本机 Windows）
- **Bash 工具不可用**：缺 `ls`/`cat`/`head`/`sleep`/`cut`/`grep`/`tail`(bash 路由到被禁用的 WSL) → 用**绝对路径 Node** + `node -e` 或临时 `.mjs`；语法校验用 `PortableGit\...\bash.exe -n`
- ⚠️ `node -e "..."` 里**别用反引号**(Bash 先做命令替换 → SyntaxError)；复杂脚本写成临时 `.mjs`
- **PowerShell 工具 stdout 会被吞** → 重定向到文件后用 Read 读
- **Bash `rm -f` 可能静默失败**(safe-bin shim 报 `dirname: command not found` 后不删) → 用 **PowerShell `Remove-Item -Force`** 或 Node `fs.unlinkSync`，再用 `git status` 复核
- **Bash 下 node 脚本 exit code 不可信**：包装器自身返回 127(shim 缺 `dirname`)，与脚本真实退出码无关 → 判成功看**脚本自己写的日志文件**或 `echo NODE_EXIT=$?`
- **脚本内 spawn exit 127 且零输出**(沙箱限制)。测服务端要**同进程内**：拷 `server.mjs` 到临时沙箱 + node_modules junction + **先写 `storage/metadata.json` 快照再 import**(server 启动即加载)，`await import(pathToFileURL(沙箱/server.mjs).href)` 起 Express 再 fetch。Windows 绝对路径必须 `pathToFileURL()`。快照 `sessions[].user` 要带完整 nickname/email，只写 `{id}` 会让 `displayAccountName` 回落「鲲穹用户」造成假阳性
- 例外：需**真实 HTTP 到独立端口**(如真实浏览器套件)时用 `spawn` 并在其 `cwd` 内跑，但**必须消费 stdout/stderr**(见 §8 死锁)
- **`fs.cpSync(目录,目录,{recursive:true})` 会静默杀掉整个 node 进程**(exit 127、零输出) → 自写 `copyTree` 递归 `copyFileSync`，或优先 `fs.symlinkSync(真实 node_modules, 沙箱/node_modules, 'junction')`
- **`server.mjs` 不导出 app**(`Object.keys(mod)` 为空)，靠 side effect 自行 listen。验证脚本**不要**自己 `server.listen()`(抛错静默退出)；应设 `process.env.PORT` → import → 轮询 `/api/health`
- **测试顺序会互相污染**：消耗配额/改状态的用例(如限流)必须放在校验类用例**之后**
- **脚本"卡住零输出"先怀疑前面某步耗时过长**：一次 `_verify_avatar_e2e.mjs` 零输出真因是开头 `fs.rmSync(旧沙箱)` 耗时 ~87s 触发工具超时。**定位手段永远是分步 `trace()` 写文件，别靠猜**
- **从源码抽取函数做单测**：`src.indexOf('function name(')` 只命中声明行(真实签名常跨行) → 先找 `'\nfunction name('`，再 `indexOf(')')` 定位签名末尾，从末尾往后找第一个 `{` 配平。抽出函数依赖几十个自由变量，需补最小桩，桩里用 `let metadataNeedsPersist`(函数会赋值)
- 隔离测试必须显式 `KUNQIONG_DB_ENABLED=false`(`.env` 默认 `true`，本地会连远程 MySQL 并覆盖本地改动)
- 探针路由**必须从 server.mjs 核对，别猜**：后台只有 `PATCH /api/admin/users/:userId`，没有 GET 单用户。**404「接口不存在」= 探针写错了，与鉴权无关**

## 8. 测试与排查纪律
- **断言要描述期望行为，不要描述当时的实现**：曾把「team-card 通栏」写进断言，而它正是 bug 根源，修 bug 时反被自己的测试拦住。产物 minify 后**函数名会被 mangle**，只能断言字符串字面量与 className
- **jsdom 不做真实布局**：能断言结构，但「结构对 ≠ 视觉对」。「位置/宽度/是否同一行」必须用**真实浏览器**测
- **CSS `width` 与 `max-width` 是两回事**：`.team-join-card` 写在 `.public-card` 之前且同特异性 → 后者赢，`width: min(570px,100%)` 把卡片硬顶成 570px。只写 `max-width: none` 管不住 width，必须显式 `width: 100%`
- **负向断言必须精确到特征串**：`!/该团队/.test(html)` 会误命中正常说明句 → 假阳性
- **兜底文案在「对象不存在」路径上会变成误导**：`state.organizationName || '该团队'` 在团队已删除时变成「加入『该团队』团队空间」且无按钮。**对象不存在的分支要显式渲染「不可用」状态，不要回落默认值**(邀请页已改为 `reason==='unavailable'`)
- **fetch stub 返回体必须结构完整**：页面读 `data.share.files.length` 就得回 `{share:{files:[...]}}`；stub 注入脚本里别做 `JSON.stringify(JSON.stringify(obj))`(表现为「组件渲染了但状态全空」)
- **验证脚本的依赖组件必须入库**：`_verify_invite.mjs` 依赖 `_invite_child.mjs`，曾误删导致 18 项 MODULE_NOT_FOUND。**清理临时文件前先确认没有脚本 import 它**
- **修安全漏洞的验证纪律**：要证明「漏洞已堵」，测试环境必须**保留原本会触发漏洞的配置**；只在默认配置下跑等于什么也没验证
- **渲染 dist 产物必须放子进程**：产物是 ESM，同进程重复 `import` 命中模块缓存(React 不再挂载)，用 `?v=` 绕缓存又会让 Vite URL 处理崩 → 一个路由一个子进程 `execFileSync(process.execPath, [child.mjs, urlPath, outFile])`，结果写 JSON 回读
- **「改了没生效」排查顺序**：产物 CSS → 产物 JS → 构建时间 vs 源码时间 → 本地起 server 验返回 hash → **真实浏览器断言几何**。前四步都过而几何仍不对，那就是真 bug(别急着归因缓存)
- **断言响应结构前先读源码**：管理端 collection 返回 `{collection:{submissions}}` 而非 `{task:{submissions}}`；猜错结构得一堆假 FAIL
- **写断言前先确认产品意图**：曾想把「非所有者访问 manage 链接应 403」写成断言，但该链路设计就是 **token 即凭证**(非所有者 200 是正确行为)。把「我以为的权限模型」当成期望行为，会写出与产品冲突的测试
- **改库后内存态不重载**：服务启动即加载 `metadata.json`，脚本手工改库必须**重启服务**才生效
- **会话快照会覆盖 users 表**：`normalizeAccountUserStore` 用 `metadata.sessions[].user` 合并进用户表，快照的 nickname 覆盖 users。验证「显示名跟随账号」必须走真实接口 `PATCH /api/auth/profile`(会同步快照)，直接改库会被覆盖 → 假失败
- **种子 session 必须写完整用户快照**(踩过两次)：`_capture_manual_shots.mjs` 只写 `user:{id}`，截图里提交者显示成「鲲穹用户」。**所有写 metadata 种子的地方都要统一检查**
- **「权限类 Bug」先复现再改，别读代码猜**：团队上传 403 的全部信息就是一句 toast，真因(`readShareOptions` 用个人 `permanent` 校验团队资源)靠**沙箱复现**才锚定；复现脚本第一步就把 403 原样打出来，改完立刻变 201 —— 前后对照即证据
- **修复要限定在出问题的那条路径**：团队资源放宽 permanent 时，必须同时断言「基础版成员**个人**永久分享仍 403」。放宽一个条件很容易连带放开相邻语义，每个不变量都要有反向对照断言
- **UI 断言「成功提示」必须轮询等待**：上传完成会触发一次 `load()` 刷新，toast 渲染有延迟；固定 `sleep` 取样会误判失败(真实踩到：后端已落库 + 无报错，仅 toast 未捕获) → 循环 sleep 轮询目标条件，命中即 break
- **`spawn` 子进程只 pipe 不读 = 死锁**：`stdio:['ignore','pipe','pipe']` 却只监听 `stderr`，子进程 stdout 缓冲写满后阻塞在 write，表现为**脚本卡在「子进程已启动」零输出**。同一脚本先前能跑通只是缓冲还没写满 —— 偶发性陷阱 → **每个 pipe 出来的流都必须消费**
- **脚本里写死 commit 哈希 = 每轮部署都误报**：`_verify_team_upload_live.mjs` 曾断言 `release.startsWith('603ca9f')`，下次推送即红 → **断言目标要从仓库动态取**(`git rev-parse origin/main`，取不到就 `git fetch` 一次)，并对「差异仅为非运行时代码」放宽(见 §5)

### 真实浏览器测试模板（可复用）
Chrome：`C:\Program Files\Google\Chrome\Application\chrome.exe`。无 puppeteer/playwright，
用 **CDP over 原生 WebSocket**（Node 22 内置 `WebSocket`）：
1. `spawn chrome --headless=new --remote-debugging-port=PORT --user-data-dir=<临时> --disable-extensions`，
   轮询 `GET http://127.0.0.1:PORT/json/version` 直到就绪
2. 连 **browser 级** ws（`version.webSocketDebuggerUrl`），调 `Target.createTarget {url:'about:blank'}`
   ⚠️ `/json/list` 初始可能只有 background_page，**必须自己建 target**
3. 从 `/json/list` 找该 `targetId` 的 `webSocketDebuggerUrl`，连**页面级** ws
4. `Page.enable` + `Runtime.enable`
5. **注入登录态**（关键）：`Page.addScriptToEvaluateOnNewDocument` 覆写 `window.fetch`，
   让 `/api/auth/me` 返回已登录用户、`/api/account/workspace` 返回团队数据，
   否则 `/workspace` 只渲染「登录后使用团队空间」，量不到目标元素
6. `Emulation.setDeviceMetricsOverride {width,height,deviceScaleFactor:1}` → `Page.navigate` → 等 ~2s →
   `Runtime.evaluate` 读 `getBoundingClientRect()` / `getComputedStyle()`
7. `Page.captureScreenshot {format:'png', captureBeyondViewport:true}` 出 PNG 肉眼复核
8. 收尾：`chrome.kill()` + 删临时 `--user-data-dir`
   （`spawn` 时记得消费 stdout/stderr，见 §8 死锁坑）

## 9. 待办 / 风险
- ⚠️ **`.gitea/workflows/deploy-test.yml` 明文硬编码凭据**(第 20 行 `KUNQIONG_OAUTH_CLIENT_SECRET`，另有 `OAUTH_CLIENT_ID`/`ADMIN_USER_IDS`/`TEST_ENTERPRISE_USER_KEYS`)，而该 Gitea 仓库匿名可访问 → **建议迁到 Gitea Secrets**。需用户确认后再动
- 短信通知为模拟；SMTP 未配置时邮件通知只留本地记录
- `_run_regression.mjs` 全套串行跑时并发 Chrome 互相争抢，会导致个别套件超时/假 FAIL(`_verify_member_ui`/`_verify_message_expand`/`_verify_transfer_dissolve`/`_verify_transfer_ui` 曾出现，单独重跑均通过)。看整套结果先单独复跑异常套件再下结论
