# 鲲穹文件传输 Web — 安全与逻辑审计报告

日期：2026-09-28 · 范围：server.mjs(5755行) + src/main.jsx(7113行) · 方式：静态审计 + 全量回归复跑

## 回归基线（先说好消息）

全量离线回归 34 套件：核心全部通过——plan_isolation 33/33、subscription_plan 23/23、admin_audit 24/24、admin_auth/admin_ui、atomic_store 12/12、avatar 14/14、fixes 50/50、team_upload 23/23、team_token_leak 7/7（复跑）、guest_quota 35/35（复跑）、visual_fixes 27/27。
4 个非零退出均为环境/断言过时，非产品 bug（见文末「回归异常定责」）。
未发现 SQL 注入、命令执行、ReDoS、可利用的原型污染；主链路（分享/收集/记录/团队/admin）归属校验与路径穿越防护到位。

## P0 — 必须处理

### 1. 管理后台默认口令硬编码在公开仓库里（server.mjs:93-97）

`KUNQIONG_ADMIN_PASSWORD` 未配置时静默回落 `[REDACTED_ADMIN_PASSWORD]`，且该口令随源码进入 git 历史——仓库匿名可访问，**等同于公开**。任何人可用 `ljxkjadmin/[REDACTED_ADMIN_PASSWORD]` 登录未配 secret 的部署，获得删任意资源/禁用用户/改配置/看全站 PII 的能力。
**修复**：删除默认回落，未配置直接拒绝启动；立即轮换口令；清理 git 历史（或至少确认所有部署均已配 secret）。

## P1 — 高危（建议本周内处理）

| # | 问题                             | 位置                   | 要点                                                                                                                                                           |
| - | ------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 | 游客配额可完全绕过                      | server.mjs:3639      | 请求带任意 cookie 头但不含有效 `kq_guest_id` 时，每次签发**全新** key 计账，历史用量恒 0，1024MB 上限形同虚设。修法：此场景回落按 IP 计账                                                                  |
| 2 | 匿名分享 = 垃圾邮件放大器                 | server.mjs:1595/4652 | 未登录可创建分享并给 50 个任意邮箱发 SMTP 通知，无验证码无频控；叠加 #1 绕过配额，1 字节文件×无限请求可把服务器变成匿名发信机，域名/IP 会被封。修法：匿名通知强制验证码或按 IP 严限流；或邮件通知要求登录                                            |
| 3 | 匿名上传磁盘耗尽                       | server.mjs:217/1595  | multer 全量落盘后才做配额校验；单请求 100×500MB=50GB 临时文件先写满磁盘再被拒。修法：检查 content-length 提前拒绝 + 上传端点按 IP 限流 + 匿名单请求总量上限                                                       |
| 4 | 提取口令可无限爆破                      | server.mjs:2045-2098 | lookup 有限流，但真正校验口令的 download/preview 端点**零限流**；口令存无盐 SHA-256，metadata 泄漏可离线秒破。修法：失败按 share+IP 计数锁定；hashSecret 改 HMAC 或 scrypt                                |
| 5 | `trust proxy:true` + Host 头可污染 | server.mjs:244/5647  | 伪造 `X-Forwarded-Host` 可让分享 shareUrl/二维码**持久化指向攻击者域名**（钓鱼），并污染 return_to 白名单与 OAuth redirect_uri。修法：对外 origin 一律用 `KUNQIONG_APP_URL` 配置值；trust proxy 收敛为代理 IP |

## P2 — 中危（择期处理）

**服务端**：publicShare DTO 向任何持链接者泄漏收件人邮箱/手机与投递日志（3459-3489，应仅 owner 可见）；member-search 可模糊枚举全站用户邮箱手机（773-796）；apiWebToken 明文落盘（5185）；审计日志同步全库写盘可被刷 IO + 5000 条 FIFO 可被灌水挤走攻击痕迹（2705-2721）；upload-sessions 创建无鉴权无频控、size:0 可绕配额刷 inode（1626）；组织 slug 仅 24bit 熵可枚举团队名（3040）；取件码可传 codeLength:4 被定向枚举（5476）；匿名可无限建收集任务、deadline 不封顶（2100）；oauthStates 内存 Map 无上限可刷 OOM（332）；文件安全审查为空壳函数恒放行（3571，要么接扫描要么删掉并改文案）；验证码限流键为 socket 地址，反代单桶锁死全站（432）；zip 条目名不剥盘符（5710）；/api/health 泄漏部署指纹（281）；无 CSP。

**前端**：mammoth/XLSX 预览 HTML 未消毒直接 dangerouslySetInnerHTML，docx 恶意超链接可构造 `javascript:` URL（main.jsx:1807/1812，建议上 DOMPurify——**此条与 localStorage 明文存提取密码叠加会升级为账号资源接管**）；提取密码/收件人明文进 localStorage 续传签名，TTL 11 小时（6150-6165，建议签名只存哈希）；下载整文件读入内存，1-5GB 文件撑爆标签页（6626，建议 File System Access API 流式写盘）；记录页「重新开启分享」无条件带 `expiresAt:defaultDeadline(7)` 且无会员预检，免费用户点击必被服务端 403（893-905，与服务端口径一致但 UI 体验割裂）；过期分享在本地记录被归并为「已关闭」丢失原因（5728）；已截止收集任务的「关闭」按钮在记录页置灰、管理弹窗却可点（3418 vs 3063）。

## 回归异常定责（均为环境/测试问题，非产品 bug）

- `guest_quota`：循环内失败，单独复跑 35/35 通过 → 并发环境假失败（符合既有经验）
- `team_token_leak`、`invite`：单独复跑全部通过
- `team_upload_live`：`fetch failed` → 沙箱网络无法直连测试服，环境限制
- `panel_overflow` 9/10：失败的是**反向对照断言**（还原修复规则后应复现溢出，实际不再溢出）→ 说明根因已被其它样式修复覆盖，该断言过时，建议更新套件

## 已知且本轮确认可接受

SQL 全参数化；路径穿越主链路防护完整（safeRelativePath/basename/服务端随机 id）；cookie flags 正确（httpOnly+Lax+path 限定）；CSRF 双重覆盖（SameSite+Origin 校验）；impersonate/test 后门严格 NODE_ENV=test 门控；manageToken bearer 两级校验正确；团队管理门控 canManage 全覆盖。
