# 鲲穹文件传输 Web — 项目记忆

> 只记「不变量 / 约定 / 坑」。当日过程见同目录 `YYYY-MM-DD.md`；验证脚本清单、本机环境约束、测试排查纪律见 `TESTING.md`。

## 1. 项目概览
企业级文件传输/收集 Web 应用（kunqiong-transfer-demo v0.1.0），对接鲲穹统一登录。
- **前端** React 18 + Vite 6，**无路由库** —— `App()` 按 pathname 手动分发；全在 `src/main.jsx`(~6800 行) + `src/styles.css`
- **后端** Express 4 单文件 `server.mjs`(~5200 行，90+ 路由)；multer/archiver/nodemailer/qrcode
- **存储** MySQL `kqai_web_send.kunqiong_app_state`(`state_key='metadata'`，payload 为整份 JSON)；本地 `storage/metadata.json` 只是缓存(已 gitignore)，误改可从 DB payload 还原

## 2. 路由与功能
- `/` 主应用三视图 `send/collect/records`(`?view=` 持久化)；`/share|collect /:token`(+`/manage`)；`/e/:slug/...` 企业路径(不带 token → `TeamInvitePage`)；`/settings /workspace /team /admin`
- 发送 ≤100 文件、≤5GB/文件；小文件直传 `/api/shares`，大文件分片 `/api/upload-sessions`(TTL 12h)；**团队资源只能走分片会话**(`mode:'team_resource'`，直传 `/api/shares` 造不出 teamResource)
- 收集限类型(8 类)/大小/截止日期；记录四类 scope；账户 OAuth2 对接 `login.kunqiongai.com`，cookie `kunqiong_session`；分享密码 15min 短期 cookie
- 套餐 `free`(20GB,永久✗)/`member`(100GB,✓)/`team`(500GB,teamSpace 250GB)/`enterprise`(2048GB,1TB)；`ACCOUNT_PLAN_RANK` 升序

## 3. 核心不变量（破坏即线上事故）

### 3.1 个人套餐 ⊥ 团队权益（彻底分离）
- `accountPersonalPlanForUser` 只看 `user.planId` —— 个人容量/永久/有效期/单文件上限**唯一依据**
- `accountTeamEntitlementForUser` 只覆盖 `team/teamSpaceBytes`；`organizationTeamSpaceBytes` 唯一来源是**所有者**个人套餐
- `accountUsageForUser`/`accountTeamUsageForOrganization`/`adminUserSummary`/`accountWorkspacePayload`/`publicAccountUser`/`accountBenefitsForUser` 全用 personal；对外 payload 带 `teamEntitlement{...}`
- 新用户默认 free：`planId: user.planId || null` + `|| 'free'` 兜底
- 历史坑：个人 free 直接 return 所有者套餐 → 容量/永久/后台显示全错且无法购买会员版。回归 `_verify_plan_isolation`(33)+`_verify_member_ui`(9)

### 3.1b 团队资源「永久」由团队决定
- `readShareOptions(body, user, isTeamResource=false)`；true 跳过个人 permanent 校验（否则基础版成员往企业版团队上传恒 403）
- ⚠️ 只放行团队资源这一条，**个人分享 permanent 校验必须原样**
- 团队资源不计个人用量；容量走所有者 teamSpaceBytes。回归 `_verify_team_upload`(23)+`_verify_team_upload_ui`(14)+`_verify_team_upload_live`(6)

### 3.2 `avatar` 是「粘性」字段
- 三字段 `avatar`/`avatarSource`('custom'/'')/`providerAvatar`；`avatarSource==='custom'` 后任何「没表态」的输入不得改它
- 只有 ① PATCH /api/auth/profile {avatar} ② 显式 `avatarRestoreRequested:true`(恢复登录头像) 能改；该标记在 `mergeAccountUser` 末尾 delete，绝不落库
- `upsertAccountUser`/`normalizeAccountUserStore` 必须把**原始输入**给 `mergeAccountUser`（不能先 normalize 吞标记）；`mergeAccountUser` 不能有 `if(!existing) return normalize(incoming)` 短路
- `PATCH /api/auth/profile` 与 `POST /api/account/bind` 以**用户表**为准合并，别整体覆盖 `session.user`
- 历史坑：用「有无 avatarSource 键」判表态，OAuth 显式带 `avatarSource:''` → 重启合并抹掉 custom。回归 `_verify_avatar_restart`(17)+`_verify_avatar_e2e`(15)+`_verify_avatar`(14)

### 3.3 metadata 落盘必须原子
- `persistMetadata` = 临时文件 + `renameSync`，绝不直接 `writeFileSync`；`loadLocalMetadata` 解析失败先试 `.bak` 并 console.warn，绝不静默吞损坏
- 回归 `_verify_atomic_store`(12)

### 3.4 团队页权限门控
- `/team` 的 manage/requests **页签与面板都需 `data.canManage`**；面板用 `visibleTab`(无权回落 'members')，高亮用 `activeTab`
- 退出团队 `POST /api/account/workspace/leave`：所有者 400/未登录 401/不在团 404/成员 200；**不需要团队权益或管理权限**

### 3.5 入团申请
- 复用 `organization.members` 第三态 `status:'requested'`；接口 GET/POST `/api/organizations/:slug/join-request`、POST `/api/account/workspace/join-requests/:requestId`
- ⚠️ 身份判定 **cooldown 排在 invited 之前**（被拒记录用 invited+reviewedAt 存冷却锚点，顺序错冷却永不可达）
- `publicOrganization()` 对非所有者过滤 requested；`team/overview` 的 memberUsage 排除 requested

### 3.6 组织 roster 资料
- `displayName/email/phone` 是入团快照；`syncOrganizationMemberProfile(user)` 挂在 PATCH profile 与 createAuthSession 两处；只补「有值且变了」，绝不抹掉已有信息

### 3.7 收集提交者身份（登录/匿名双轨）
- `resolveCollectionSubmitter(req)` 唯一入口：登录以服务端会话为准，落 `submitterUserId`/`submitterName` 并覆盖客户端 participantName(防伪造)；**不能强制登录**
- ⚠️ 两条提交路径都要带：表单直传 `/api/collections/:token/submissions` + 分片 `/api/upload-sessions`
- ⚠️ `normalizeRecordSubmissions` 必须保留这两字段；提交页登录态隐藏手填框、管理端按 `submission.submitter` 渲染徽标
- ⚠️ `/api/collections/manage/:manageToken` 是 bearer 凭证不校验登录身份，非所有者 200 是预期，别写 403 断言
- 回归 `_verify_collect_login`(43)+`_verify_collect_login_ui`(14)

### 3.8 团队邀请链接
- 形态 `/e/<slug>/share/`（不带 token）→ `TeamInvitePage`(hero+TeamJoinRequestCard)；带 token 才走 SharePage。入口：workspace 团队卡片、team 顶部(仅 canManage)，带复制按钮
- 回归 `_verify_invite`(38)+`_verify_invite_browser`(12)

### 3.9 /admin 只有一条鉴权通道
- 只认口令(默认 ljxkjadmin/jxljxkj009900，env 可覆盖)；cookie TTL 12h，timingSafeEqual+8 次/10 分钟限流
- ⚠️ 限流键**不可用 XFF**(trust proxy=true 可伪造)——用 `adminRateLimitKeys(req)`(socket 真实地址+proxy+global 兜底桶)；限流函数签名是 `(req)`
- ⚠️ **绝不能给 `KUNQIONG_ADMIN_USER_IDS` 白名单开第二条通道**（曾致免密进后台）；`/api/admin/session` 与 `requireAdminSession` 两处必须同时保留/移除；`isAdminUser()` 只用于服务端豁免
- `assertServiceWritable` 须同时豁免口令会话与白名单账号；`publicAccountUser` 不下发 isAdmin
- 回归 `_verify_admin_auth`(27)+`_verify_admin_ui`(17)+`_verify_admin_live`(12)+`_verify_admin_audit`(24)

### 3.10 /workspace 栅格
- `.workspace-team-card` 绝不能再写 `grid-column:1/-1`（在 lower-row 2 列里会独占整行）；后代选择器 `.workspace-grid .public-card` 不能写成 `>`；900px 断点显式复位子元素 grid-column
- 回归 `_verify_layout_real`(46,真实 Chrome)；改后确认 dist/ 已重建

### 3.11 团队资源「预览」是分享维度
- 行渲染的是分享：name=files[0].name，多文件是正常对象；预览可用性看 `files.some(canPreviewFile)`；多可预览文件复用 `RecordPreviewChooser`
- 后端 `/api/shares/:id/files/:idx/preview` 任意下标均 200 —— 「预览不好使」先 curl 再查前端
- ⚠️ `.ghost-icon:disabled` 是 cursor:wait，「不适用」必须另加 `.icon-inapplicable`
- 回归 `_verify_team_preview`(16)+`_verify_team_preview_live`(21)

### 3.12 对比度与图标（UI 约定）
- 前景色对**自身背景** ≥4.5:1；只降 V 保 H/S；双阈值 `cr(c,bg)>=4.55 && cr(c,'#fff')>=4.3`；`--muted=#567570`，文本底线 `#5f7873`
- 图标统一 lucide-react 13~17；无 flex 按钮补 `inline-flex`；套餐图标 `ACCOUNT_PLAN_ICON`；`/records` 页签刻意无图标；微调放 styles.css 末尾「设计增强层」

## 4. metadata 内部字段名
- `metadata.users`(对象 map，key=userId)、`messages[userId]=[...]`、`sessions{[{id,user,expiresAt}]}`、`organizations`、`auditLogs`
- 种子数据必须照抄真实结构；sessions[].user 带完整快照，否则 displayAccountName 回落「鲲穹用户」

## 5. 开发 / 部署
- dev：`npm run dev`(server 8045+vite 4173)；prod：build+start 同源 8045 托管 dist/
- vite.config 已配 manualChunks（react/icons/docs/viewer/charts），主 chunk ~267kB；改业务代码只重下业务 chunk，勿删此配置
- 双远端：origin=Gitee、gitea=43.154.197.96，**两个都要推**；CI push main 自动部署测试服
- 判断是否真生效：比对 `/api/health` release 与 main，且 `git diff --name-only <release> main` 是否触及 server.mjs/src/
- 部署脚本：测试机 8045 容器持端口，**不能对同名容器一律 rm -f**
- 测试服权益收敛：`KUNQIONG_TEST_ENFORCE_ENTERPRISE_ALLOWLIST=true` 时仅白名单(`wx_Ba7AZPo6U9`)保留企业版
- 本机演示：`KUNQIONG_DB_ENABLED=false` + `KUNQIONG_TEST_ENFORCE_ENTERPRISE_ALLOWLIST=false`；拿会话用 `POST /api/admin/impersonate`(仅 NODE_ENV=test)+`headers.getSetCookie()`(impersonate 不下发 cookie，要自己构造 `kunqiong_session=<sessionId>`)
- Bash 环境坑：需 `export PATH="/usr/bin:/bin:$PATH"` 前缀，否则 dirname/ls not found

## 6. 待办 / 风险
- ⚠️ `.gitea/workflows/deploy-test.yml` **明文硬编码凭据**（OAUTH_CLIENT_SECRET 等），仓库匿名可访问 → 建议迁 Gitea Secrets，需用户确认
- ⚠️ `POST /api/admin/impersonate` 测试服后门（仅 NODE_ENV=test，须口令会话）：**生产务必确认 NODE_ENV≠test**
- 短信模拟；SMTP 未配置时邮件只留本地记录
- `_run_regression.mjs` 串行跑并发 Chrome 争抢会假 FAIL/超时（member_ui/message_expand/transfer_* 等），异常套件单独复跑再下结论；其 PASS/FAIL 统计用 `\bPASS\b` 正则，会把「结果：PASS=x FAIL=0」里的字样也计入（FAIL 多算 1），看「结果：x/y」声明为准
- `_audit_team_token_leak.mjs`：团队 manageToken 越权泄漏的复现脚本（造团队分享→成员拉概览→无登录用 token 管理他人分享），自动还原 metadata+清理
