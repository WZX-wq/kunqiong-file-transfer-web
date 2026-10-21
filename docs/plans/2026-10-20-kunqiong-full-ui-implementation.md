# 鲲穹原型页面融入现有产品实施计划

**目标：** 将 `C:\Users\admin\WorkBuddy\2026-10-20-09-32-04\kunqiong-full` 中与现有产品能力对应的页面和状态融入正式 React 应用，保留产品已有但原型未展示的功能与入口，不新增原型独有的邮件预览入口。

**实现方式：** 先建立双向覆盖矩阵：把原型页面映射到产品现有路由/状态，同时盘点原型未展示的产品页面、入口和能力并列入保留验收。按业务域迁移视觉和交互，真实流程沿用现有组件与 API；瞬态表现为流程状态或弹窗，不为每张原型截图复制一份页面。原型的静态样例数据只作为视觉参照，不进入正式业务数据流。

**技术栈：** React 18、Vite、现有 Express API、`lucide-react`、现有 QR/文件传输组件与 `src/styles` 分层；不新增依赖。

---

## 范围与页面清单

原型的 58 屏分为 8 组，均纳入映射核对。产品现有页脚已提供帮助中心、服务协议和隐私政策，继续保留并复用现有内容入口；游客额度使用现有提示。邮件预览是唯一没有对应产品能力的原型内容页，本轮不新增。其余原型只用于对应产品现有能力的视觉和状态呈现，不覆盖产品已有的其他页面、入口或行为。验收不要求每个原型状态单独占一个 pathname。

| 组 | 原型屏幕 | 正式应用对应范围 |
| --- | --- | --- |
| 发送与取件（8） | `send-home`、`send-selected`、`send-settings`、`send-uploading`、`send-success`、`send-qr`、`send-resume`、`retrieve` | `/` 的发送/上传队列、设置弹窗、上传进度与结果、二维码、断点续传提示；取件码弹窗由现有分享查询 API 驱动 |
| 接收与分享管理（8） | `share-public`、`share-locked`、`share-expired`、`share-manage`、`share-manage-settings`、`file-preview`、`download-progress`、`share-closed` | `/share/:token`、`/share/manage/:token` 及现有文件预览、下载进度、关闭/过期状态 |
| 文件收集（8） | `collect-create`、`collect-created`、`collect-manage`、`collect-settings`、`collect-submit`、`collect-submit-anon`、`collect-submitted`、`collect-closed` | `/?view=collect`、`/collect/:token`、`/collect/manage/:token`；创建、提交、匿名/登录差异、截止和管理状态 |
| 记录与消息（6） | `records`、`records-sent`、`records-received`、`records-files`、`record-detail`、`messages` | `/?view=records` 的筛选、文件中心和详情，以及现有消息中心；需要核实消息入口和详情状态是否能保留可分享的 URL |
| 账户与设置（7） | `login`、`settings-profile`、`settings-security`、`settings-notice`、`settings-cleanup`、`settings-orders`、`order-detail` | 现有统一登录流程、`/settings/{profile,security,notice,cleanup,orders}` 和订单详情状态 |
| 会员与团队（10） | `workspace`、`plan`、`plan-pay`、`workspace-team`、`team-overview`、`team-members`、`team-resources`、`team-permissions`、`team-requests`、`invite` | `/workspace` 套餐/容量/升级流程、`/team` 团队管理与成员/资源/申请视图、现有团队邀请链接 |
| 运营后台（6） | `admin-login`、`admin-dashboard`、`admin-resources`、`admin-users`、`admin-logs`、`admin-config` | `/admin` 独立管理员会话及看板、资源、用户、安全日志、配置标签页 |
| 帮助与规则（5） | `help`、`terms`、`privacy`、`guest-quota`、`email` | `help`、`terms`、`privacy` 复用产品现有页脚入口与内容弹窗；`guest-quota` 映射到产品现有游客额度提示/弹窗；`email` 是原型独有内容页，本轮不新增 |

映射范围为 57 个对应现有产品能力的原型屏幕/状态；原型独有的 `email` 内容页仅登记为排除项，不实施。产品独有页面和能力数量由任务 1 的现状盘点确定，全部保留并纳入回归。

## 实施任务

### 任务 1：锁定映射和回归基线

**主要文件：** 新建页面覆盖矩阵/验收脚本；核对 `src/main.jsx`、`src/pages/*`、`src/lib/*`、`server/routes/*`。

1. 建立双向矩阵。原型侧记录 58 个 ID、页面状态、现有组件/URL/API、权限条件及处理结论（视觉迁移、复用状态或明确排除）；产品侧记录所有现有页面/入口和原型未展示的功能，明确保留方式与回归案例。
2. 用现有行为脚本作为基线，至少执行 `npm run build`、`npm run test:upload`、`npm run test:collections`、`npm run test:orders`、`npm run test:team`、`npm run test:messages`、`npm run test:auth`、`npm run test:acceptance`。
3. 对已有未提交文件逐一阅读 diff。当前已存在 `src/pages/workspace-page.jsx`、`src/styles/components.css` 的修改，以及 `ui-prototypes/`、`prototype/` 等未跟踪内容；不得覆盖或回退，遇到同一区域修改需在其现状上增量合并。

**完成条件：** 58 个原型屏幕都有迁移或排除结论；产品原有页面、入口、功能都有盘点和保留验收项；基线结果已记录。

### 任务 2：建立共享视觉骨架

**主要文件：** `src/main.jsx`、`src/pages/workspace.jsx`、`src/pages/settings.jsx`、`src/pages/public.jsx`、`src/pages/AdminPage.jsx`、`src/styles/base.css`、`src/styles/components.css`；必要时新增 `src/components` 下的共享页面组件。

1. 对照现有 React 页面和共享控件，检查 shadcn/ui、BeUI 等开源组件/模式是否有可适配部分；优先复用当前依赖与组件，只有确实匹配且适配成本低时才引入额外实现，并核对代码来源和许可证。
2. 从原型 `assets/theme.css`、`assets/pages.css` 提取实际使用的颜色、字号、间距、边框、表格/表单/弹窗和响应式规则，转换为 React 类与项目 CSS 变量。不要直接整体导入原型 CSS，以免全局选择器覆盖现有正式页面。
3. 统一现有应用导航、工作区页头/内容区、公开分享与收集外壳、账户设置侧栏、后台标签栏，以及按钮、输入、表格、空态、Toast、弹窗的视觉和焦点/关闭行为；只调整呈现，不删减或隐藏现有入口。
4. 复用现有 Lucide 图标和 `src/components/ui.jsx` 中的预览、二维码、下载、管理弹窗等组件；复用原型静态图片时核对文件用途并放入 `src/assets`，不把示例业务数据或原型脚本复制进正式应用。
5. 动效与状态反馈覆盖进入/退出、悬停、焦点、按压、弹窗和异步加载；支持 `prefers-reduced-motion`，并确保小屏不横向溢出。

**完成条件：** 共享外壳可供所有页面域复用，构建通过；CSS 仍按 `base.css` → `components.css` 的既定顺序加载。

### 任务 3：迁移发送、接收与分享流程

**主要文件：** `src/pages/workspace.jsx`、`src/pages/public.jsx`、`src/lib/transfer.js`、`src/lib/api.js`、`src/components/ui.jsx`、对应样式和发送/分享 UI 验证脚本。

1. 对齐发送首页、文件选择/队列、发送设置、上传中、成功、二维码、续传和取件弹窗；上传继续使用现有分片、取消、扫描、限额及游客额度机制。
2. 对齐公开接收页的正常、密码保护、过期/关闭状态；保留现有密码校验、下载次数和登录限制。
3. 对齐分享管理、设置、文件预览、下载进度和管理口令；二维码与链接必须来自真实 token/URL，预览必须沿用既有安全清洗和权限检查。
4. 为不同状态补充 loading、空态、错误、禁用、成功状态，并验证刷新/前进后退后页面不会显示错误对象或旧账号数据。

**验证：** `npm run test:upload`、`npm run test:security`、分享/预览现有脚本及桌面/手机端流程抽查。

### 任务 4：迁移收集、记录和消息

**主要文件：** `src/pages/workspace.jsx`、`src/pages/records.jsx`、`src/pages/public.jsx`、`src/lib/records.js`、`src/components/ui.jsx`、相应样式和验证脚本。

1. 对齐收集创建、创建结果、二维码、管理、设置、已登录提交、匿名提交、提交成功和截止状态；保留文件类型/大小/期限/人数限制、上传扫描和会话恢复行为。
2. 对齐收发记录总览、发送/接收筛选、文件管理中心、记录详情及行内操作，数据仍来自本地/云端记录实现。
3. 将消息中心视觉和交互对齐原型，保留未读计数、分类筛选、标记已读/全部已读、删除、邀请处理及账号切换隔离。
4. 若记录详情或消息中心需直接分享/刷新访问，则在现有主页面路由约定下加可恢复的 query 状态；不要单纯为了原型屏幕新增重复页面组件。

**验证：** `npm run test:collections`、`npm run test:messages`、相关记录/收集 UI 验证及匿名、登录、过期、无权限状态抽查。

### 任务 5：迁移账户、会员、团队和后台

**主要文件：** `src/pages/settings.jsx`、`src/pages/orders.jsx`、`src/pages/workspace-page.jsx`、`src/pages/team.jsx`、`src/pages/AdminPage.jsx`、`src/main.jsx`、相应样式和验证脚本。

1. 对齐登录入口、资料、安全绑定、通知偏好、文件清理、订单列表和订单详情；登录仍经统一账户服务，不新增本地凭据流程。
2. 对齐会员/团队空间、套餐、升级支付、团队空间、总览、成员观察、资源、成员权限、入团申请和邀请落地页；保持个人套餐与团队授权边界、套餐限制和真实支付状态。
3. 对齐管理员登录、看板、资源、用户、安全日志和系统配置，继续使用独立管理员 Cookie、接口授权、审计和确认操作。
4. 让独立标签视图的 URL 能恢复对应标签/筛选/详情，沿用当前 pathname/query 规则和旧链接兼容；无权限操作继续显示真实错误/引导状态。

**验证：** `npm run test:auth`、`npm run test:orders`、`npm run test:team`、`npm run test:acceptance`，另执行管理员会话、普通账号过期与权限角色的 UI 回归。

### 任务 6：核验并保留产品独有页面与能力

**主要文件：** 任务 1 的双向覆盖矩阵、受影响的现有页面模块与 UI 验证脚本。

1. 核对产品独有的页面、导航项、账户/工作区操作、记录与消息管理、上传/分享/收集状态、权限入口和后台控制项；逐项与改版前基线对照。
2. 产品已有而原型未展示的页面和入口维持原路由、可见性和行为；如共享样式调整影响其外观，只做兼容性适配并加入截图/交互回归。
3. 保留产品当前页脚中的帮助中心、服务协议、隐私政策、使用手册和问题反馈入口及其现有行为，不新增重复入口；`guest-quota` 只覆盖产品现有额度提示，不另建帮助页面或导航入口；`email` 标记为原型独有且本轮排除。

**验证：** 改版前后逐项核对产品独有页面/入口、直接访问和关键交互；`npm run build`。

### 任务 7：全量验收与回归

**主要文件：** 覆盖矩阵、必要 UI 验证脚本与页面实现。

1. 按映射矩阵验收 57 个对应现有产品能力的原型屏幕/状态，并确认原型独有的邮件预览没有被加入；逐项核对产品独有页面、入口和功能仍然可访问且行为不变。
2. 至少覆盖登录、游客、会员、团队所有者/成员、管理员、密码分享、已过期/关闭、上传/下载失败等权限和异常条件。
3. 桌面 1440px、1024px 与手机 390px 检查；核对加载、空、错误、成功、禁用状态；操作导航、浏览器前进后退、刷新、键盘焦点和减少动态效果。
4. 运行所有上述分域脚本、`npm run test:remediation`、`npm run test:security` 与 `npm run build`；若页面更改暴露前端与服务端契约缺口，先补充契约测试，再用最小范围修复。
5. 记录逐屏验收证据及产品独有能力的保留回归结果；正式应用运行时不依赖 WorkBuddy 原型目录。

**完成条件：** 57 个范围内的原型屏幕对应正式页面或可恢复的业务状态，原型独有的邮件预览未新增；产品独有页面、入口和功能均保留；关键交互调用真实 API，必要回归通过，布局无明显遮挡/溢出，已有工作区改动完整保留。

## 主要风险与处理

- 原型按截图拆状态，而正式应用把多个状态放在一个 React 流程中：用覆盖矩阵映射到 URL 或本地流程状态，避免重复组件和状态失配。
- 原型和产品的页面范围不一致：先建立双向清单；原型独有入口不新增，产品独有功能和入口不删除、不隐藏，并作为单独的回归集合。
- 原型里的假数据/假成功提示与服务端权限、套餐、限额可能不同：实现只信任正式 API 的响应，并复用已有校验与错误码。
- 全局 CSS 和当前正式样式较多：只迁移必要 token/组件规则，限定选择器作用域，按业务域逐批视觉验收。
- 后台、支付、上传、分享等状态改动影响面较大：分域运行已有回归脚本，页面外观更新不得绕过服务端鉴权、审计或安全扫描。
- 仓库已有未提交修改：开始实施前检查最新 `git status` 和逐文件 diff；对冲突文件基于当时工作区状态合并，不覆盖用户修改。

## 不在本轮计划内

- 重写服务端业务、改变支付/扫描/套餐策略或新增认证方式。
- 将原型的示例登录、删除、授权和支付操作原样复制到正式数据流。
- 新增原型有而产品没有的邮件预览入口。
- 引入新 UI 框架或依赖，或把 58 个屏幕机械地改为 58 个独立路由页面。
