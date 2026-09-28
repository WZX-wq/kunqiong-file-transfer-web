# 鲲穹文件传输 Web — 项目记忆

> 只记「不变量 / 约定 / 坑」。当日过程见 `YYYY-MM-DD.md`；验证脚本清单见 `TESTING.md`。

## 1. 项目概览
企业文件传输/收集 Web 应用。**前端** React18+Vite6 无路由库（`App()` 按 pathname 分发），全在 `src/main.jsx`(~6800行)+`src/styles.css`；**后端** Express4 单文件 `server.mjs`(~5200行,90+路由)；**存储** MySQL `kqai_web_send.kunqiong_app_state`('metadata'整份 JSON)，本地 `storage/metadata.json` 仅缓存可从 DB 还原。

## 2. 路由与功能要点
- `/` 三视图 send/collect/records(`?view=`持久化)；`/share|collect/:token`；`/e/:slug/...`(无token→TeamInvitePage)；`/settings /workspace /team /admin`
- 发送≤100文件、≤5GB/文件；小文件直传 `/api/shares`，大文件/团队资源走分片 `/api/upload-sessions`(TTL12h)
- **分片=offset直写架构**：createSession 预分配，chunk 按 `chunkIndex*chunkSize` pwrite+`.done`；complete 只校验 size+rename，**绝不能改回事后合并**(曾冻结全进程10~35s)。探针 `_probe_direct_write.mjs`
- 套餐订阅制：free(20GB,✗)/member(100GB,30天)/team(500GB,90天) permanent=false，enterprise(2048GB)=买断永久；到期 `accountPlanForUser` 自动回落 free，续费 `Math.max` 顺延；`ACCOUNT_PLAN_RANK` 升序；主站卡=轻享月卡¥19/30天、成长季卡¥49/90天、永久会员¥159
- **展示价真源=主站支付套餐**：`/api/account/upgrade-pricing`(60s缓存)→前端 `useRemotePlanPricing`+`mergePlanPricing` 三处注入(工作台/升级弹窗/设置页)；remotePriced 时有效期跟随主站(null=永久)，拉不到回落本地价。**改价/支付测试只能改主站后台套餐价**（主站套餐 ID member=1/team=2/enterprise=5；`create_web_member_order` 无金额参数，扫码实付=主站价，改本站展示价是假修复）；主站改价后 60s 内本站展示/下单自动跟随；**套餐表跨子站共享**，0.01 测试窗口内所有子站在售价同步变，窗口尽量短
- **分享特权两级**：会员特权(改有效期/重开/canReopen)=付费且有效期内(hasMembership: permanent||id!=='free')；永久特权(永久分享'0')=仅 permanent(enterprise/团队资源)；回归 `_verify_subscription_plan`(23)

## 3. 核心不变量（破坏即事故）
- **3.1 个人套餐⊥团队权益**：个人容量/永久/单文件上限唯一看 `user.planId`；团队空间唯一来源是**所有者**个人套餐；usage/payload/public 全用 personal。个人 free 误 return 所有者套餐曾是事故。回归 `_verify_plan_isolation`(33)
- **3.1b 团队资源「永久」由团队定**：`readShareOptions(body,user,isTeamResource)` true 跳过个人 permanent 校验，**个人分享校验必须原样**；团队资源不计个人用量
- **3.1c 前端会员特权预检=hasMembership 口径**：改有效期/重开分享的 UI 入口预检必须 `plan.permanent || planId!=='free'`（与 server applyShareUpdate 同口径），**不能用 plan.permanent**（那是永久保存专属）——曾有月卡会员被前端本地拦截改不了有效期的 bug；「UI 报错但 curl 直测 200」= 前端本地预检的特征。⚠️ ShareExpiryModal.submit 内部也曾残留同类拦截（2026-09-28 修复）：凡带预检的组件，弹窗内的 submit/按钮 disabled 分支都要逐处核对，不能只改入口
- **3.2 avatar 粘性**：`avatarSource==='custom'` 后「没表态」的输入不得改它；只有 PATCH profile{avatar} 和显式 `avatarRestoreRequested` 能改（后者用完即删不落库）；merge 必须收原始输入、无短路。回归 `_verify_avatar_restart`
- **3.3 metadata 落盘原子**：临时文件+`renameSync`；解析失败先试 `.bak` 且 warn
- **3.4 /team 门控**：manage/requests 页签与面板都需 `data.canManage`；leave 接口所有者400/未登录401/不在团404/成员200
- **3.5 入团申请**：复用 members 第三态 `status:'requested'`；**身份判定 cooldown 排在 invited 之前**
- **3.6 roster 快照**：`syncOrganizationMemberProfile` 只补「有值且变了」，不抹已有
- **3.7 收集提交者**：`resolveCollectionSubmitter(req)` 唯一入口，服务端会话为准防伪造，**两条提交路径都要带**（直传+分片）；`normalizeRecordSubmissions` 保留 submitter 字段；manage/:manageToken 是 bearer 凭证非所有者 200 是预期
- **3.9 /admin 唯一鉴权通道**：只认口令(ljxkjadmin/jxljxkj009900,env可覆盖)；限流键**禁用 XFF**(用 socket 真实地址)；**绝不给 ADMIN_USER_IDS 白名单开第二通道**；`publicAccountUser` 不下发 isAdmin
- **3.11 团队预览是分享维度**：name=files[0].name；`/api/shares/:id/files/:idx/preview` 任意下标均 200，「预览不好使」先 curl；`.ghost-icon:disabled` 是 wait，「不适用」用 `.icon-inapplicable`
- **3.12 UI 约定**：前景对自身背景 ≥4.5:1；`--muted=#567570`；图标 lucide 13~17；微调放 styles.css 末尾「设计增强层」
- **3.13 删除联动**：`DELETE /api/account/records` 只清归属者名下**非活跃**资源；`purgeStaleResources` **只挂 POST /api/admin/cleanup**，绝不进定时链路；teamResource 永不自动清理；`runMaintenanceCleanup` 返回真实计数

## 4. metadata 字段
`users`(map by userId)、`messages[userId]`、`sessions[{id,user,expiresAt}]`(user 带完整快照否则显示回落)、`organizations`、`auditLogs`、`shares[{id=分享token,code=提取码,manageToken}]`、`collections[{id=token}]`、`guestUsage`（游客累计传输计账，条目上限 20000）
- **3.14 游客配额**：未登录累计传输上限 `systemConfig.anonymousTotalSizeMb`(默认1024MB,0=不限)；key=cookie`kq_guest_id`，无 cookie 头按 IP 计但**仍要签发 cookie**（防脚本换 key 绕过）；计账只在成功后（直传/分片 complete/收集提交），create 仅预校验；超限 413+`code:guest_quota_exceeded`+guestQuota 详情，错误 handler 白名单透传。回归 `_verify_guest_quota.mjs`

## 5. 开发 / 部署
- dev：`npm run dev`(8045+4173)；prod：build 后同源 8045 托管 dist/，**改前端后要重建 dist**
- vite manualChunks 已配好勿删（主 chunk ~270kB）；双远端 origin=Gitee+gitea **都要推**；判断生效：比对 `/api/health` release 与 main
- **改 server.mjs 后必须重启 8045**（比对进程 StartTime vs mtime）。⚠️ 沙箱派生进程全被回收（bash后台~10s/detached/schtasks/playwright-cli 浏览器均活不过单条命令）——重启只能用户在真实终端 `taskkill /F /PID <pid>` 后跑 `E:\node\node.exe server.mjs`
- **playwright-cli 验证法**：浏览器会话活不过命令间隙，必须**单条 Bash 串完整链**(open→fill→click→snapshot→grep 提取 ref 动态下传)；登录页 ref 稳定 e32/e40/e49
- 本机演示 env：`KUNQIONG_DB_ENABLED=false`+`KUNQIONG_TEST_ENFORCE_ENTERPRISE_ALLOWLIST=false`；admin 登录路由是 `POST /api/admin/login`(不是 /session)；impersonate 仅 NODE_ENV=test 且要自拼 cookie
- Bash 需 `export PATH="/usr/bin:/bin:$PATH"` 前缀；git 远端核对用 `git ls-remote`（沙箱静默丢 remotes 引用）
- 测试服：`KUNQIONG_TEST_ENFORCE_ENTERPRISE_ALLOWLIST=true` 仅白名单留企业版；部署容器持端口**不能一律 rm -f**

## 6. 待办 / 风险
- ⚠️ `.gitea/workflows/deploy-test.yml` 明文硬编码凭据，仓库匿名可访问 → 迁 Gitea Secrets 需用户确认
- ⚠️ impersonate 后门：生产务必 NODE_ENV≠test
- 短信模拟；SMTP 未配置邮件只留本地记录
- `_run_regression.mjs` 并发 Chrome 会假 FAIL，异常套件单独复跑；PASS/FAIL 统计以「结果：x/y」为准
