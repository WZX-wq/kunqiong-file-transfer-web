# 鲲穹文件传输 Web — 项目记忆

> **精炼索引**：只记「不变量 / 约定 / 坑」。当日过程见同目录 `YYYY-MM-DD.md`；
> 验证脚本清单、本机环境约束、测试排查纪律见 **`TESTING.md`**。

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
- 回归 `_verify_team_upload.mjs`(23) + `_verify_team_upload_ui.mjs`(14) + `_verify_team_upload_live.mjs`(6)

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
- 回归 `_verify_collect_login.mjs`(43) + `_verify_collect_login_ui.mjs`(14)

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

### 3.11 团队资源「预览」是分享维度，不是文件维度
- 团队资源行渲染的是**分享**：`name = files[0].name`，副标题「{fileCount} 个文件」，`files` 是完整数组。
  因此「多文件分享」是**正常对象**，任何按 `files.length !== 1` 禁用按钮的写法都是错的。
- 预览按钮可用性只看 **`resource.files.some(canPreviewFile)`**；多个可预览文件时
  **复用 `RecordPreviewChooser`** 弹选择器（与「记录」页一致），不要自己造选择 UI。
- 后端 `/api/shares/:id/files/:idx/preview` **本来就支持任意下标**（0..n-1 均 200）。
  排查「预览不好使」时先 curl 该接口，200 就说明是纯前端判断问题。
- ⚠️ `.ghost-icon:disabled` 是 `cursor: wait` —— **「不适用」必须另加 `.icon-inapplicable`**
  把光标改成 `not-allowed`。用 `wait` 表达「不可用」会被用户读成「一直在转圈加载」。
- 回归 `_verify_team_preview.mjs`(16) + `_verify_team_preview_live.mjs`(21，线上真实数据)

### 3.12 文字对比度与图标（UI 约定）
- **所有前景色必须对「自身背景」** ≥ 4.5:1(白底正文)；低于 4.5 一律按 **HSV 只降 V、保住 H/S** 修，
  取值满足双阈值 `cr(c,bg)>=4.55 && cr(c,'#fff')>=4.3`。
  ⚠️ 只对彩底(`#e6f4ef` 这类淡彩)达标会一路压到纯黑 —— 同一色值复用在不同底色上，必须双阈值。
- `--muted` = `#567570`(5.03:1)；文本层级底线是 `#5f7873`(≈5.0)，**不要再更浅**。
- 图标统一 **lucide-react**，尺寸 13~17，按钮内由 `inline-flex + gap` 自动居中；
  无 flex 的按钮(`.page-footer button`/`.message-mark-all`)记得补 `inline-flex`，否则图标与文字不齐。
- 套餐分层图标 `ACCOUNT_PLAN_ICON = {free:HardDrive, member:Sparkles, team:Users, enterprise:Crown}`
  + `accountPlanIcon(id)`，用于 `.plan-title-line`(权益对比条) 与 `.upgrade-plan-icon`(升级弹层)。
- `/records` 的视图切换页签**刻意不带图标**(文字+计数徽标)，不是遗漏。
- 追加式微调统一放 `styles.css` 末尾「设计增强层」，避免改动既有规则。

## 4. metadata 内部字段名（易踩错）
- 用户表：`metadata.users`（对象 map，key=userId）—— **不是** `accountUsers`
- 消息：`metadata.messages[userId] = [...]`；会话：`metadata.sessions`，形状 `{id, user, expiresAt}`
- 组织：`metadata.organizations`；审计：`metadata.auditLogs`
- ⚠️ 种子数据的形状必须照抄真实结构（上面三个都是**以 id 为键的对象**而非数组）；种子 `sessions[].user`
  必须带**完整**用户快照(nickname/email/avatar)，只写 `{id}` 会让 `displayAccountName` 回落「鲲穹用户」

## 5. 开发 / 部署
- dev：`npm run dev`（server 8045 + vite 4173）；prod：`npm run build && npm start`，同源 8045，server 托管 `dist/`；有 Dockerfile
- **双远端**：`origin` = Gitee `zhanlinhai/kunqiong-file-transfer-web`；
  `gitea` = `http://43.154.197.96/giteaadmin/kunqiong-file-transfer-web.git`。**两个都要推。**
- CI：Gitea Actions（`.gitea/workflows/deploy-test.yml`），push main 自动部署测试服 `43.154.197.96:8045`。
  ⚠️ 触发有延迟/可能排队（20 秒 ~ 20+ 分钟）。CI 日志无需登录可读：
  `/giteaadmin/<repo>/actions/runs/<id>/jobs/0/logs`（页面按 `<div class="flex-item tw-items-center">` 切块解析）
- **验证部署的正确方法**：比对 `/api/health` 的 `release` 与**仓库 main**。
  ⚠️ 但 release 只反映 commit，**不反映运行时代码是否变化**：仅测试脚本/文档变动的提交，
  `server.mjs`+`src/` 未变 → Vite 产物哈希不变 → 容器无需重建，此时「对外 release 落后于 main」是**正常现象**。
  判断是否真生效应比对 `git diff --name-only <线上release> <main>` 是否触及 `server.mjs`/`src/`/`index.html`/`package.json`
- 部署脚本：测试机 8045 由 compose 管理的容器持有端口绑定，**不能对同名容器一律 `docker rm -f`**
  （会 CI 绿但线上旧）；按 compose 项目归属分流。脚本已内置部署后 release 校验。
- 测试服权益收敛：`KUNQIONG_TEST_ENFORCE_ENTERPRISE_ALLOWLIST=true` 时仅
  `KUNQIONG_TEST_ENTERPRISE_USER_KEYS`（`wx_Ba7AZPo6U9`）保留企业版，其余强制回落 free
- Windows 一键启动：`start.bat` / `start.ps1` / `start.vbs`

## 6. 本机演示环境（做截图 / 手册 / 走查时用）
- 隔离起服务：`KUNQIONG_DB_ENABLED=false`(否则连远程 MySQL 覆盖本地)；
  且 `KUNQIONG_TEST_ENFORCE_ENTERPRISE_ALLOWLIST=false`(**test 模式默认 true，会把所有非白名单用户压成 free**)
- Bash `VAR=x node server.mjs &` **不传 env** → 写 `xxx.mjs` 先 `process.env.PORT='8045'` 再 `await import(pathToFileURL('server.mjs'))`
- 拿真实会话：`POST /api/admin/impersonate`(仅 `NODE_ENV=test` 存在) → 用 Node fetch + `headers.getSetCookie()`
  （curl `-c` cookie-jar 曾 exit 23 写坏 cookie）
- 演示数据脚本：`_seed_manual_demo.mjs`（3 用户/1 团队/10 分享/5 收集/记录），文件由
  `kq项目/使用手册/_build/make_transfer_demo_files.py` 生成；跑完**务必备份并还原** `storage/metadata.json`(`.manualbak`)
- 手册生成链：`kq项目/使用手册/_build/` → `kit.py`(Word 库) + `figs.py`/`figs_transfer.py`(PIL 示意图) + `gen07_transfer.py`(正文)

## 7. 待办 / 风险
- ⚠️ **`.gitea/workflows/deploy-test.yml` 明文硬编码凭据**(第 20 行 `KUNQIONG_OAUTH_CLIENT_SECRET`，另有 `OAUTH_CLIENT_ID`/`ADMIN_USER_IDS`/`TEST_ENTERPRISE_USER_KEYS`)，而该 Gitea 仓库匿名可访问 → **建议迁到 Gitea Secrets**。需用户确认后再动
- ⚠️ **`POST /api/admin/impersonate` 是测试服专用后门**：仅 `NODE_ENV==='test'` 存在(其余 404)，且必须持管理员口令会话。
  它能为任意已存在用户签发登录态 —— **生产部署务必确认 `NODE_ENV` 不是 `test`**，否则等于绕开用户密码。
  回归 `_verify_impersonate.mjs`(7) 覆盖「生产 404 / 未登录 401 / 用户不存在 404 / 缺参 400」
- 短信通知为模拟；SMTP 未配置时邮件通知只留本地记录
- `_run_regression.mjs` 全套串行跑时并发 Chrome 互相争抢，会导致个别套件超时/假 FAIL(`_verify_member_ui`/`_verify_message_expand`/`_verify_transfer_dissolve`/`_verify_transfer_ui` 曾出现，单独重跑均通过)。看整套结果先单独复跑异常套件再下结论
