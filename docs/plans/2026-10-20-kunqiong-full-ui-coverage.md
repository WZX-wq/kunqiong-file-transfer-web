# 原型与产品双向覆盖矩阵

来源：`C:\Users\admin\WorkBuddy\2026-10-20-09-32-04\kunqiong-full`，58 个原型页面 ID。视觉和状态映射到正式 React 页面；不复制原型脚本、演示数据或假成功流程。

## 原型页面映射

| 原型 ID | 正式页面 / 状态 | 处理 |
| --- | --- | --- |
| `send-home` | `/` SendView 空文件状态 | 对齐首页布局，复用真实文件选择和上传 API |
| `send-selected` | `/` SendView 文件队列 | 对齐队列视觉，保留批量/目录路径能力 |
| `send-settings` | `/` SettingsModal | 对齐设置弹窗，保留加密、期限和权限语义 |
| `send-uploading` | `/` UploadProgressPanel 上传/暂停/恢复状态 | 对齐进度呈现，保留分片、扫描、取消和续传 |
| `send-success` | `/` ShareResult | 对齐结果布局，链接、取件码和二维码来自真实 API |
| `send-qr` | `/` QrPreviewModal | 对齐放大状态，不使用静态示例码 |
| `send-resume` | `/` UploadProgressPanel 恢复状态 | 对齐续传提示，保留会话与原始文件校验 |
| `retrieve` | `/` RetrieveModal | 对齐查询状态，保留分享查询 API |
| `share-public` | `/share/:token` 有效公开分享 | 对齐详情布局，保留密码、权限和下载限制 |
| `share-locked` | `/share/:token` 密码保护状态 | 对齐锁定状态，由服务端校验密码 |
| `share-expired` | `/share/:token` 过期状态 | 对齐过期提示，状态以服务端响应为准 |
| `share-manage` | `/share/manage/:token` 管理页面 | 对齐管理布局，保留管理凭证与所有者权限 |
| `share-manage-settings` | `/share/manage/:token` ManageItemModal 设置状态 | 对齐设置状态，保留密码、次数、期限与 API 校验 |
| `file-preview` | FilePreviewModal | 对齐预览外观，沿用安全清洗和权限检查 |
| `download-progress` | DownloadProgressPanel 下载状态 | 对齐进度呈现，保留 Range、失败和重试 |
| `share-closed` | `/share/:token` 关闭状态 | 对齐关闭提示，保留管理/重开权限 |
| `collect-create` | `/?view=collect` 创建表单 | 对齐表单布局，保留套餐、类型、大小和期限限制 |
| `collect-created` | `/?view=collect` CollectionSuccess | 对齐成功状态，链接和二维码来自真实任务 |
| `collect-manage` | `/?view=collect` CollectionFilesPanel | 对齐管理列表，保留提交文件、扫描和删除权限 |
| `collect-settings` | `/?view=collect` ManageItemModal 设置状态 | 对齐设置状态，保留服务端限制和角色边界 |
| `collect-submit` | `/collect/:token` 登录用户提交 | 对齐提交页面，保留扫描和会话恢复 |
| `collect-submit-anon` | `/collect/:token` 匿名提交状态 | 对齐身份状态，只保留产品当前允许的行为 |
| `collect-submitted` | `/collect/:token` 提交成功状态 | 对齐成功反馈，以服务端完成状态为准 |
| `collect-closed` | `/collect/:token` 截止/关闭状态 | 对齐不可提交提示，由服务端提供状态 |
| `records` | `/?view=records` 收发记录总览 | 对齐记录布局，保留本地/云端同步 |
| `records-sent` | `/?view=records` 发送筛选状态 | 对齐筛选状态，保留现有 URL 约定 |
| `records-received` | `/?view=records` 接收筛选状态 | 对齐筛选状态，保留账号隔离和记录来源 |
| `records-files` | `/?view=records` 文件管理视图 | 对齐分类、搜索、到期筛选和行内操作 |
| `record-detail` | `/?view=records` 详情/管理弹窗 | 对齐可恢复详情状态，不新增重复 pathname |
| `messages` | 顶栏消息中心 | 对齐列表和分类，保留未读、删除、邀请处理和账号隔离 |
| `login` | 统一账户登录流程 | 复用 OAuth/验证码服务，不复制原型凭据流程 |
| `settings-profile` | `/settings/profile` | 对齐资料页，保留资料、头像保存和账号绑定 |
| `settings-security` | `/settings/security` | 对齐安全页，保留账号验证和绑定行为 |
| `settings-notice` | `/settings/notice` | 对齐通知页，保留云端偏好保存 |
| `settings-cleanup` | `/settings/cleanup` | 对齐清理页，保留期限配置、确认和真实删除语义 |
| `settings-orders` | `/settings/orders` | 对齐订单列表，保留分页、筛选、核对和支付状态 |
| `order-detail` | `/settings/orders` 订单详情弹窗 | 对齐详情状态，订单信息来自服务端 |
| `workspace` | `/workspace` | 对齐会员空间总览，保留个人/团队容量边界 |
| `plan` | `/workspace` 套餐选择状态 | 对齐套餐对比，价格和资格来自产品配置/API |
| `plan-pay` | `/workspace` 升级订单/支付状态 | 对齐支付呈现，保留真实通道、金额确认和对账 |
| `workspace-team` | `/workspace` 团队空间摘要 | 对齐团队入口和容量状态 |
| `team-overview` | `/team` 团队总览 | 对齐总览，保留当前角色与容量口径 |
| `team-members` | `/team` 成员观察/邀请状态 | 对齐成员视图，保留邀请、移除和分页限制 |
| `team-resources` | `/team` 团队资源视图 | 对齐资源列表，保留删除权限和用量同步 |
| `team-permissions` | `/team` 角色权限状态 | 对齐权限视图，保留服务端角色授权 |
| `team-requests` | `/team` 入团申请状态 | 对齐申请列表，保留审批接口和角色校验 |
| `invite` | `/e/:slug` 团队邀请落地页 | 对齐邀请状态，保留 token 和加入申请流程 |
| `admin-login` | `/admin` 未认证状态 | 对齐登录外观，继续使用独立管理员会话 |
| `admin-dashboard` | `/admin` 数据看板标签 | 对齐真实指标布局，不展示原型假统计 |
| `admin-resources` | `/admin` 资源管理标签 | 对齐资源列表，保留服务端权限和确认操作 |
| `admin-users` | `/admin` 用户管理标签 | 对齐用户列表，保留权益、禁用和审计行为 |
| `admin-logs` | `/admin` 安全日志标签 | 对齐日志列表，保留真实审计记录 |
| `admin-config` | `/admin` 系统配置标签 | 对齐配置表单，保留校验和服务端保存 |
| `help` | 产品页脚已有帮助中心弹窗 | 保留现有入口和内容，不增加重复入口 |
| `terms` | 产品页脚已有服务协议弹窗 | 保留现有入口和内容，不增加重复入口 |
| `privacy` | 产品页脚已有隐私政策弹窗 | 保留现有入口和内容，不增加重复入口 |
| `guest-quota` | `/` 游客额度提示/弹窗 | 对齐现有额度状态，保留真实额度数据和登录入口 |
| `email` | 原型静态邮件预览 | 排除：产品无对应邮件预览入口，不新增 |

## 产品独有能力保留清单

以下功能在正式产品中已有，原型未展示或未完整表达；保持其 URL、入口、可见性、权限和业务行为，并纳入回归：

- 顶栏消息中心、登录/账户菜单、会员与企业版入口、条件显示的团队空间入口。
- 页脚使用手册、问题反馈、帮助中心、服务协议和隐私政策；后三项继续复用现有弹窗。
- `/orders` 旧链接兼容跳转至 `/settings/orders`；`/e/:slug/share`、`/e/:slug/collect` 企业链接及团队邀请落地入口。
- 文件拖放、批量/目录选择、嵌套路径、定向收件人、本人收件人拦截、分片暂停/续传/取消、扫描风险详情与失败重试。
- 分享管理口令、密码解锁、下载次数、预览授权、过期时间、关闭/重开和管理凭证隔离。
- 收集任务类型/大小/期限/人数限制、匿名/登录身份差异、扫描、刷新续传和提交管理。
- 收发记录本地/云端合并、账号隔离、复制/二维码/预览/重命名/清理、到期管理与浏览器状态恢复。
- 账户验证码/OAuth、联系资料绑定、云端通知偏好和文件清理、会话过期与账号切换清理。
- 个人与团队套餐授权边界、订单支付与核对、待支付订单恢复、服务端价格和容量策略。
- 团队所有者/管理员/成员权限、邀请审批、成员角色、资源权限、所有权转让、退出与解散确认。
- 后台独立管理员 Cookie、审计日志、权限保护、看板、资源/用户/配置管理和危险操作确认。

## 基线结果

起始基线日期：2026-10-20。`npm run build`、`npm run test:upload`、`npm run test:collections`、`npm run test:orders`、`npm run test:messages`、`npm run test:team` 通过；`npm run test:auth` 有既有 UI 断言失败：`AUTH-011 pagination shows eight records`。本轮串行复核 `npm run test:acceptance`：支付、管理员 UI 和管理员配置持久化通过，NFR smoke 仍有 4 项基线失败：`NFR-007` 并发测试后读取到缺失的 share token、`NFR-005` 5GB 边界会话创建、`NFR-011` 超长输入无堆栈、`NFR-012` 限流窗口到期后恢复请求。页面更改后按相同矩阵回归，区分基线失败与本轮回归。
