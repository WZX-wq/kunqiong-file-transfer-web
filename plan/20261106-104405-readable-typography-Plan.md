---
plan_id: 20261106-104405-readable-typography
title: 全站文字可读性优化
goal: 落实已确认的黑色正文、深灰辅助文字和适度增大字号方案，并验证响应式布局
status: completed
verification_status: verified
owner: main-agent
repo_root: D:/demo/鲲穹文件传输/kunqiong-file-transfer-web-main/kunqiong-file-transfer-web-main
branch: deploy/user-file-isolation-20261029
base_sha: a200814141a011ddff5354c7ff86aa108027035e
created: 2026-11-05
updated: 2026-11-05
supersedes: ""
---

# 全站文字可读性优化

## Scope & Non-Goals

覆盖全站 CSS 文字颜色及小字号、公共控件、会员升级卡片和相关响应式布局。沿用现有 React 组件与样式体系，无需新增组件库或字体依赖。此次不修改业务逻辑、账号权限、数据库或服务器；不提交、推送或部署。保留原有未跟踪需求文档目录。

## Acceptance Criteria

- [x] 普通文字使用 #111111，辅助文字使用 #404040，保持蓝色交互、白色主按钮文字及语义状态颜色
- [x] 原有不足 13px 的 CSS 字号提高至至少 13px，正文与表单字号适度增大
- [x] 会员卡片标题 18px、价格 22px、权益说明 14px，当前套餐不再降低整卡透明度
- [x] 320–1440px 会员弹窗文字完整、页面无横向溢出、购买按钮可到达
- [x] 首页、记录、个人中心和团队页面在 1440px/390px 无横向溢出
- [x] 收集设置、关闭确认及订单支付弹窗布局回归通过
- [x] 生产前端构建及 diff 空白检查通过

## Assumptions & Constraints

保持现有字体、蓝色品牌色、状态色、交互动效与减少动态效果设置。大字号允许正常换行，会员卡片继续通过现有横向轮播浏览。测试使用合成数据，不写真实业务数据。

## Baseline Tests

起点为 a200814，原有会员权益说明仅 10.5px，当前套餐另有 opacity: .82。修改前未跑完整基线套件；此次验证限于相关布局和前端构建，不将修改后的测试冒充基线结果。

## Diagram

纯 CSS 阅读样式调整，无新增业务调用链，不需要流程图。

## Task Checklist

| ID | Task | Owner | Deps | Done |
| --- | --- | --- | --- | --- |
| T1 | 审查现有文字色与字号，落实已批准方案 | main | - | [x] |
| T2 | 统一普通文字颜色和过小字号 | main | T1 | [x] |
| T3 | 调整会员卡片、公共控件和手机布局 | main | T2 | [x] |
| T4 | Chromium 几何验证、截图检查、生产构建 | main | T3 | [x] |

## Sub-agent Registry

未委派子代理。

## Risks & Rollback

字体放大可能增加换行与弹窗高度。通过实际 Chromium 检查页面宽度、弹窗范围、内容滚动及按钮可点击性，并复用既有收集与支付布局回归。需撤回时仅反向应用本次样式补丁和新增文件，不影响其他改动。

## Blockers

无。

## Change Log

| Task | Files | Change |
| --- | --- | --- |
| T1/T2 | src/styles/*.css | 将分散的中性色文字声明统一到公共变量，提高过小字号，保留背景、边框及语义色 |
| T3 | src/styles/typography.css, src/styles.css | 最后导入统一阅读标尺；扩大会员卡片、标题、价格和权益说明，恢复当前套餐清晰度，调整手机表单字号 |
| T3 | src/styles/typography.css | 确认框使用对称安全区留白，消除手机上下留白不一致导致的居中偏移 |
| T4 | scripts/verify-typography-layout.mjs | 增加真实 Chromium 的会员卡片及主要页面可读性/响应式验证，使用合成 API 数据 |

## Verification Evidence

| Command | Result | Notes |
| --- | --- | --- |
| node scripts/verify-typography-layout.mjs | PASS | 会员弹窗 1440/1280/768/390/320px；黑色权益文本、14/18/22px 字号、当前卡片白底及透明度、文字完整、按钮可访问；首页/记录/个人中心/团队 1440/390px 无横向溢出 |
| node scripts/verify-collection-layout.mjs | PASS | 1/5 自定义字段、手机无溢出、设置滚动、确认框居中、鼠标点击、取消和 Escape、关闭请求仅一次 |
| node scripts/verify-order-layout.mjs | PASS | 5 种桌面/手机/横屏尺寸，详情与微信/支付宝弹窗完整、二维码和按钮可访问、无浏览器脚本错误 |
| npx vite build | PASS | 前端生产构建成功；既有 viewer chunk 大于 500kB 提示仍存在 |
| git -c core.safecrlf=false diff --check | PASS | 无空白错误 |

会员桌面与手机截图以及主要页面截图位于忽略目录 .runtime/typography-*.png，已人工查看首页、记录、个人资料、团队及会员弹窗。验收验证针对本地合成数据，未声称测试服务器已生效。

## Bug & Fix Log

| Symptom | Root cause | Fix | Guard |
| --- | --- | --- | --- |
| 手机确认框垂直偏移约 1px | 原有响应式上下留白分别为 10px/12px，放大内容后触发严格居中检查 | 对称 padding-block 并兼容上下安全区 | verify-collection-layout.mjs 通过 |
| 开发测试页初次无法渲染 | 测试夹具绕过 Vite HTML preamble，依赖缓存路径不稳定 | 使用正常模块导入、transformIndexHtml 与独立缓存目录 | 完整 typography 验证通过 |

## Completion Summary

已落实全站黑色/深灰文字与更大字号，重点优化会员套餐对比阅读体验，修正放大后的确认框居中偏移。相关 Chromium 布局验证和前端生产构建通过；未改业务逻辑，未部署。

## Next Steps

本次实现已完成，等待用户查看本地效果或另行要求部署。

## 后续调整：适中字号

用户追加要求：升级权益、会员与团队空间、团队空间三处字号折中缩小。此次以本节替代前述会员卡片 18/22/14px 的尺寸要求：套餐标题 16px、价格 20px、容量 17px、权益说明 13px；会员页标题 22px、摘要 23px，团队标题 23px、统计数字 21px，手机标题 21px。保留黑色与深灰对比度、支付 Logo 及其他页面样式。

已重新运行 verify-typography-layout.mjs（增加 /workspace 桌面及手机检查），全部通过；npx vite build 和 diff --check 通过。已查看三处桌面截图，容量数值不再被大字号挤换行。本次仍仅本地修改，未提交或部署。

追加修复：用户反馈会员摘要指标仍未对齐。将标签图标、标签文字、数值拆成独立网格列，数值和标签通过基线对齐，图标单独在文字行居中。Chromium 在桌面与手机验证四组指标的网格基线属性、单行尺寸和图标中心，会员页不横向溢出；生产构建通过。

补充修复：针对用户反馈的聚焦搜索/邀请输入出现蓝色方框，全站输入控件的键盘聚焦不再绘制默认蓝色 outline；团队、后台、订单、记录等搜索容器统一使用中性边框且不叠加蓝色光晕，团队邀请输入也取消容器光晕。Chromium 检查 8 类搜索/邀请输入在桌面与手机视口下均无输入轮廓/焦点方框，并确认站点各主页面无横向溢出；生产构建和 diff --check 通过。
