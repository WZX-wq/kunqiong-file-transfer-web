# 鲲穹 UI 四版交互原型

独立的设计评审原型，供用户选择方向。正式产品 UI 待选定后实施。复用项目现有 React、Lucide 和二维码依赖，功能页面和关键状态来自当前项目。

## 预览

打开 http://localhost:4280/index.html

| 方案 | 视觉方向 | 入口 | 全部页面 |
| --- | --- | --- | --- |
| A 钴蓝传输 | 白色主面、钴蓝强调、宽松居中上传区与柔和卡片 | /a/send.html | /a/pages.html |
| B 石墨控制台 | 深石墨表面、青色状态、分区布局与紧凑表格 | /b/send.html | /b/pages.html |
| C 纸白松绿 | 纸感浅底、墨色与松绿、衬线标题与细线排版 | /c/send.html | /c/pages.html |
| D 工业信号 | 冷灰白底、黑色结构、信号橙与硬朗网格 | /d/send.html | /d/pages.html |

每版有相同的 56 个页面与关键状态，共 224 页，另有 4 个目录和 1 个总览入口。总览的 `/` 和 `/index.html` 均可访问，共验证 230 个地址。页面使用独立 HTML 与真实链接，支持直接访问和浏览器前进后退。顶部为业务导航，右上角「全部 56 页与状态」为评审目录。

## 运行与验证

在仓库根目录运行：

```powershell
node ui-prototypes/generate.mjs
npx vite --config ui-prototypes/vite.config.mjs
```

```powershell
node ui-prototypes/verify.mjs
npx vite build --config ui-prototypes/vite.config.mjs
```

构建输出为 `ui-prototypes/build`。主题和页面定义在 `data.js`，公共业务渲染在 `app.jsx`，公共样式在 `style.css`，四套主题差异在 `theme-overrides.css`，跨页动效在 `page-transitions.css`。生成和构建配置均从 `variants` 自动读取全部方案。

2026-10-20 根据评审意见，四版保留各自的版式与配色表达，不复用正式产品的插画和固定上传风格。发送页采用 720px 居中上传区，上传图标使用 Lucide；面板边框、背景、圆角与强调色分别匹配四种方向。空状态、文件队列、进度和结果沿用一致的中心轴与宽度。

## 完整范围

`data.js` 的 `route` 和 `source` 记录当前业务路由或组件来源。

| 模块 | 每版数量 | 范围 |
| --- | ---: | --- |
| 文件发送与提取 | 16 | 文件、设置、上传、检查、重试、结果、二维码、取件、公开分享、密码、失效、管理、预览、游客额度 |
| 文件收集 | 9 | 创建、结果、二维码、管理、设置、登录与匿名提交、成功、截止 |
| 记录与消息 | 3 | 收发记录、文件管理、消息中心 |
| 会员与团队 | 10 | 空间、套餐、支付状态、成员观察、资源、成员、申请、权限、邀请 |
| 账户设置 | 8 | 资料、安全、绑定、通知、清理、订单、详情、统一登录入口 |
| 运营后台 | 6 | 登录、看板、资源、用户、日志、配置 |
| 帮助与规则 | 4 | 帮助、协议、隐私、通知邮件预览 |
| 合计 | 56 | 四版采用一致业务清单 |

## 字号、动效和交互

桌面样式原先 249 处小于 13px 的字号声明已提高到 13px，包括普通桌面规则及 1150px、900px 断点。640px 以下仍保留原移动规则。自动验证会阻止桌面声明出现小于 13px 的值。

浏览器在 1440px 和 1024px 两种宽度下检查四版全部页面、目录、总览与两个首页地址，共 230 个路由、460 次页面检查。可见文字实际计算字号最低 13px，低于 13px 的页面为 0，页面级横向溢出为 0。数据见 `font-verification.json`。

图标使用开源 Lucide。页面整体与内容组有进入和退出动效，跨页通过 View Transitions 维持导航、标题和传输面板的连续过渡。按钮、输入框、开关和行操作有悬停、聚焦、按压或状态反馈。支持 `prefers-reduced-motion`、键盘焦点、弹窗焦点限制和 Esc 关闭。不支持 View Transitions 时保留普通链接跳转。

各版使用独立 sessionStorage 状态。使用「使用示例文件走完整流程」即可体验发送，无需选择个人文件。

## 演示边界

文件只保存名称和大小，预览和下载内容为示例。登录、上传、支付、消息、团队权限、清理和删除操作均为本地演示，不连接业务 API，不产生真实订单或扣款。二维码指向本地原型路径。套餐价格使用项目回落配置的展示值。

## 参考和许可

- SwissTransfer：参考上传作为主入口、发送设置接近操作的位置 https://www.swisstransfer.com/
- Smash：参考简洁上传主操作和结果页下一步层级 https://fromsmash.com/
- shadcn/ui：参考 Data Table 的筛选、行选择、行操作和分页组织 https://ui.shadcn.com/docs/components/base/data-table
- 未复制竞品代码或 shadcn/ui 组件源码。shadcn/ui MIT 许可：https://github.com/shadcn-ui/ui/blob/main/LICENSE.md
- 直接复用已有 React / React DOM（MIT）、Lucide React（ISC，含 Feather MIT 来源）、qrcode（MIT），许可原文见 `THIRD_PARTY_NOTICES.md`。

## 验证记录

四版 230 个地址渲染和站内链接检查通过，0 失败、0 警告；独立生产构建通过。详见 `verification.json`。

浏览器全量检查桌面字号与页面溢出，视觉和交互以关键流程抽查为主，包括四版发送首页、D 分享设置与完整发送、C 创建与提交收集、B 表格筛选、设置弹窗和后台。真实后端集成不属于本轮范围。

390px 手机宽度已抽查总览与四版发送页，均未出现页面级横向溢出。四版首页截图及对比拼图已逐张核对。

`previews` 保存总览和四版发送首页截图。

