# 会员、后台、非功能与发布冒烟测试报告

测试日期：2026-10-10（Asia/Shanghai）。依据用户附件逐条核对 44 个用例，并按用户“先完成本机可执行的全部修复和测试”补做真实并发与容器故障验证，最终为 **38 通过、3 部分通过、2 环境阻塞、1 未通过**。存在 P0 未通过项，不能判定本批用例全部通过或可据此完成上线验收。

| 范围 | 通过 | 部分通过 | 环境阻塞 | 未通过 |
| --- | ---: | ---: | ---: | ---: |
| PAY-001～010 | 10 | 0 | 0 | 0 |
| ADMIN-001～012 | 12 | 0 | 0 | 0 |
| NFR-001～014 | 8 | 3 | 2 | 1 |
| SMOKE-01～08 | 8 | 0 | 0 | 0 |
| 合计 | 38 | 3 | 2 | 1 |

## 环境与执行边界

代码基线：`2b28997152162caabbf0e792408d0ee4fa4c7140`，加当前未提交的修复。Node.js 24.12.0，Windows；浏览器实测为 Codex 内置浏览器，不能等同于指定版本 Chrome、Edge 或手机真机。

支付采用本机会员服务测试桩，应用真实路由、磁盘元数据和重启回补流程均实际运行；没有向真实支付商户发起扣款。后台使用一次性副本与合成管理员、账号及资源。普通受控 NFR 套件使用 INSTREAM 扫描协议测试桩；另以真实 ClamAV 1.5.4 独立执行小文件、Office/HTML/图片、5GB 和 EICAR 集成验证。没有对实际企业账号、团队进行清理、禁用或删除操作。

结果“通过”适用于本报告所列环境和验证范围。测试脚本内部的 PASS 表示具体断言通过；例如受控 128MB 断言通过，不代表 NFR-005 的真实 5GB 全流程通过。最终用例状态以本报告为准。

## 十 会员套餐与支付流程

| 用例 | 优先级 | 结果 | 实际执行与证据 | 缺陷编号 |
| --- | --- | --- | --- | --- |
| PAY-001 | P1 | 通过（测试桩） | 显式套餐 ID、金额、天数与订单映射一致；价格服务失败显示错误，缺失套餐禁止创建，React 界面验证通过。 | DEF-PAY-01 已修复 |
| PAY-002 | P1 | 通过（测试桩） | 并发创建得到一条 201、一条 409；用户隔离、微信二维码与支付宝入口、金额与套餐绑定通过；日志无支付凭证。 | — |
| PAY-003 | P0 | 通过（测试桩） | 有效会员购买同套餐成功，在原到期时间上追加 30 天。 | — |
| PAY-004 | P0 | 通过（测试桩） | 同订单并发 confirm 只创建一个远端订单；并发查询与重复查询仅开通一次、通知一次。 | — |
| PAY-005 | P1 | 通过（测试桩） | 未支付保留 pending_payment；已支付开通企业永久权益；远端异常不给权益且错误脱敏。 | DEF-PAY-02 已修复 |
| PAY-006 | P0 | 通过（测试桩） | 应用停止后将远端订单置为已支付，再启动自动回补；二次重启不重复顺延。 | — |
| PAY-007 | P2 | 通过（测试桩） | 取消可重复执行，已取消 confirm 返回 409；取消与确认竞争最终状态一致；列表状态正确。 | DEF-PAY-03 已修复 |
| PAY-008 | P1 | 通过 | 到期前团队权益有效，到期后降为基础版且拒绝创建团队；7 天资源宽限内保留，8 天后旧链接失效。 | — |
| PAY-009 | P1 | 通过 | free/member/team/enterprise 的 20/100/500/2048GiB 空间、团队能力与企业永久属性核对；各套餐 5GiB+1 单文件明确拒绝。套餐界面窄屏容量文字已修复。 | DEF-UI-01 已修复 |
| PAY-010 | P1 | 通过（测试桩） | 未知套餐、null/空值/负值/NaN/不足一分及超过两位小数的金额、响应金额或套餐不一致均拒绝；不挂接支付订单、不标 paid、不授予权益。 | DEF-PAY-02 已修复 |

## 十一 后台管理

| 用例 | 优先级 | 结果 | 实际执行与证据 | 缺陷编号 |
| --- | --- | --- | --- | --- |
| ADMIN-001 | P0 | 通过 | 正确合成管理员登录真实后台与浏览器；身份可见；Cookie 有 HttpOnly、SameSite=Lax、Path=/，HTTPS 场景有 Secure。 | — |
| ADMIN-002 | P0 | 通过 | 移除管理员配置的副本返回 503 和未配置提示，源码默认口令不能登录。 | — |
| ADMIN-003 | P1 | 通过 | 连续错误登录触发 429；伪造 X-Forwarded-For 不能绕过，窗口内正确密码受限；密码不写日志。 | — |
| ADMIN-004 | P0 | 通过 | session 与 overview 刷新一致；注销后旧 Cookie 对 overview、cleanup、config 返回 401。 | — |
| ADMIN-005 | P1 | 通过 | 概览统计与磁盘元数据核对，趋势与数据限量可见；返回结果不含支付凭证、管理令牌。 | — |
| ADMIN-006 | P0 | 通过 | 合法用户套餐/到期时间修改持久化且即时影响账号权益；禁用生效并审计；未知用户、套餐与无效日期拒绝。 | DEF-ADMIN-01 已修复 |
| ADMIN-007 | P0 | 通过 | 未知字段、负数与无效套餐覆盖拒绝；容量覆盖保存、重启后继续生效，游客额度即时生效。默认空白表单、指定值、零价格、清空恢复默认均通过实际校验和 React 测试；真实浏览器保存成功。 | DEF-ADMIN-01、02 已修复 |
| ADMIN-008 | P0 | 通过 | 界面取消不发请求，确认仅发一次 POST；只清理过期/陈旧对象，孤儿宽限期及活跃文件保留，统计和审计正确；GET 不清理。 | — |
| ADMIN-009 | P0 | 通过 | 21 项列表十条分页、下一页范围、搜索、取消/确认删除、更新后总数均通过 React 测试；真实接口核对管理员删除、文件及元数据同步、旧链接失效，普通用户不可删除。 | — |
| ADMIN-010 | P1 | 通过 | 仅 test 环境且有效管理员可为已有测试用户签发验收会话并审计；未知用户拒绝，production 返回 404。 | — |
| ADMIN-011 | P1 | 通过 | 退出后旧会话失效；focus/pageshow 重新验证并清空旧管理数据；浏览器实际退出显示登录界面。 | DEF-ADMIN-03 已修复 |
| ADMIN-012 | P0 | 通过 | 游客、普通用户、错误 Cookie 对概览、清理、配置、用户修改、资源删除均拒绝；页面先要求管理员登录。 | — |

## 十二 兼容性、性能与安全

| 用例 | 优先级 | 结果 | 实际执行与证据、尚缺覆盖 | 缺陷编号 |
| --- | --- | --- | --- | --- |
| NFR-001 | P1 | 环境阻塞 | 当前没有可控制的 Chrome。内置浏览器核心冒烟和 1280px 验证通过，不能替代指定 Chrome 最新稳定版验收。 | ENV-01 |
| NFR-002 | P1 | 环境阻塞 | Edge 连接返回不支持当前认证方式，无法执行。未绕过浏览器连接策略。 | ENV-02 |
| NFR-003 | P1 | 部分通过 | 375/414px 下首页、登录、上传、取件、收集、个人设置、后台及 Logo/头像显示验证；375px 实际小文件上传、二维码及下载通过。未覆盖手机真机键盘弹出和各移动浏览器。 | ENV-03 |
| NFR-004 | P1 | 通过（内置浏览器视口） | 320/375/414/1280px × 12 个核心路由，共 48 项；另 320/375px × 5 个登录后的后台模块，共 10 项。按 clientWidth、按钮内部 scrollWidth 核对无截断；修复记录/团队/设置/后台栏目和套餐容量溢出。 | DEF-UI-01 已修复 |
| NFR-005 | P0 | **未通过** | 真实 5GiB 文件上传 640 个 8MiB 分片；重启后查询、完整磁盘 SHA256 一致，但真实 ClamAV 返回 MaxFileSize FOUND，应用拒绝发布。完整扫描、发布、5GB 下载链路未完成。受控 128MiB 上传/扫描和内存断言通过。 | **DEF-NFR-01 未解决** |
| NFR-006 | P1 | 通过（受控扫描服务） | 实际 100 个数据文件全部上传并经过扫描协议；ZIP 解析核对 100 个文件名和解压后的原始字节，删除失效；第 101 个明确返回 413。 | — |
| NFR-007 | P1 | 通过（本机真实容器） | 三个合成用户同时执行真实 500MiB 普通分享、分片分享和分片收集，全部经 ClamAV 1.4.6 扫描通过。下载/落盘 SHA256 一致；三片后查询进度并重复上传不增加片数。两个 500MiB 会话争用 750MiB 账号/匿名收集容量均只允许一个；他人查询、写片、完成拒绝；取消释放容量。并发后端 RSS 增量 46825472 字节（约 44.7MiB），测试负载共 1.5GiB，耗时 71854ms。 | ENV-04 已补齐 |
| NFR-008 | P1 | 部分通过 | 128MiB 下载读取部分后中断、Range 206 恢复、总字节与 SHA256 相同；后缀 Range、预览 Range、非法范围 416 正确。真实 5GB 未发布，不能验证其下载中断恢复。 | DEF-NFR-02 已修复；DEF-NFR-01 关联 |
| NFR-009 | P0 | 部分通过 | 下载交给浏览器，客户端下载代码无一次性 response.blob()/arrayBuffer()；实际 128MiB 流式下载后端 RSS 增量约 11.2MiB。未完成真实 5GB 浏览器 Performance/Memory 面板测量。 | DEF-NFR-01 关联 |
| NFR-010 | P0 | 通过 | 用数据包 DOCX/XLSX 生成一次性危险链接/字面 HTML 测试副本，实际转换器和净化 DOM 验证；四类文件经真实 ClamAV 上传，再打开实际浏览器预览：DOCX 危险 href 移除且中文表格、1×1 嵌入 PNG、安全链接保留；XLSX 危险链接移除、字面脚本保留；HTML 按源码文本显示；PNG 正常显示。没有活跃脚本/事件 DOM。 | — |
| NFR-011 | P0 | 通过（所列样本） | 账号昵称、团队名称/成员搜索、收集标题说明、文件名路径和后台资源搜索覆盖 HTML/SQL/模板字符串与超长输入；字面保存/显示、权限拒绝及路径不逃逸通过。未将样本测试视为穷尽式安全审计。 | — |
| NFR-012 | P1 | 通过 | 验证码、后台登录、取件码及三类创建接口限流；真实来源 IP 计数，伪造 XFF 不绕过；创建路由在窗口内返回 429/Retry-After，到期后恢复。 | DEF-NFR-03 已修复 |
| NFR-013 | P0 | 通过（本机真实容器） | 应用容器重启后分享/收集完整；实际停止扫描器，新上传和完成返回 503，不发布，已有安全文件可读，已上传片保留；启动扫描器后同一会话完成成功。独立实例使用同一文件系统的 32MiB tmpfs 存储，实际占用 31MiB 后上传 8MiB 返回 507/ENOSPC，不增加资源；释放占用后重试成功，清理保留活跃资源。受控注入与真实 EICAR 既有证据保留。 | DEF-NFR-04 已修复；ENV-05 已补齐 |
| NFR-014 | P1 | 通过（受控 release） | 成功、失败、权限拒绝、扫描/支付失败操作留有请求、状态、release、请求 ID、错误码；日志和响应无测试密码、完整 Cookie、支付凭证或堆栈。实际本机 release 未设置的差异列在 SMOKE-06。 | DEF-NFR-04 已修复 |

## 发布冒烟

| 用例 | 结果 | 实际执行与尚缺覆盖 | 缺陷编号 |
| --- | --- | --- | --- |
| SMOKE-01 | 通过 | 内置浏览器首页 Logo、favicon、顶部导航和四种尺寸无水平溢出。 | — |
| SMOKE-02 | 通过（本机） | 游客真实路由上传安全小文件、取件码、分享 URL、二维码、原字节下载；独立真实 ClamAV 浏览器上传/二维码开关/预览/浏览器下载验证；下载文件 SHA256 与数据包相同。 | — |
| SMOKE-03 | 通过（本机受控扫描服务） | 创建任务、匿名提交、管理者查看并 ZIP 下载原字节；收集套件目录与恢复测试回归通过。 | — |
| SMOKE-04 | 通过（隔离管理员） | 浏览器合成管理员登录、概览可见、退出显示登录框；退出后接口拒绝。 | — |
| SMOKE-05 | 通过（隔离账号） | 定向收件人可读，stranger 返回 403。 | — |
| SMOKE-06 | 通过（本机隔离部署） | 实际 Dockerfile 构建；容器 health 的 release 为 `2b28997152162caabbf0e792408d0ee4fa4c7140-worktree`，明确包含未提交修复；容器 server.mjs 的 SHA256 与工作区一致。部署版本检查已改为等待健康后严格比较完整 release，缺失d'wa、错误及相同短前缀均失败。原开发进程 8045 的 release 仍为空；未执行远端 CI 部署。 | DEF-DEPLOY-01 已修复；ENV-06 本机覆盖已补齐 |
w



d| DEF-DEPLOY-02 已修复；ENV-07 已补齐 |
| SMOKE-08 | 通过（本机隔离部署） | 实际 restart 应用容器后，游客分享取件及原文件下载、匿名收集管理和 ZIP 下载均成功，原字节一致。 | ENV-07 已补齐 |

## 修复与剩余缺陷

| 编号 | 状态 | 问题与处理 |
| --- | --- | --- |
| DEF-PAY-01 | 已修复 | 展示价格与订单使用的套餐映射不同、价格失败静默回落。改为同一映射并明确加载失败/不可用，禁止创建不可用套餐订单。 |
| DEF-PAY-02 | 已修复 | 无效/不一致支付金额可能接受，远端错误可能泄露服务内容。严格校验正的整数分、套餐、有效期、支付类型，校验后才保存远端订单；通用错误脱敏。增加不足一分金额的回归。 |
| DEF-PAY-03 | 已修复 | 重复取消非幂等，取消与确认存在竞争。取消与确认共用订单锁，重复取消成功且不能再确认。 |
| DEF-ADMIN-01 | 已修复 | 配置/用户输入缺少严格校验，持久化后的 totalBytes 覆盖在再次规范化时丢失。未知/无效值拒绝并保留容量覆盖。 |
| DEF-ADMIN-02 | 已修复 | 默认空白套餐覆盖保存返回“套餐容量无效”，有效期空白被序列化为永久。空白项不发送覆盖值，恢复套餐默认；指定零价格保留。 |
| DEF-ADMIN-03 | 已修复 | 返回/重新聚焦后台可能显示失效会话的旧数据。重新验证并清空数据，用请求代次忽略迟到响应。 |
| DEF-UI-01 | 已修复 | 窄屏团队、记录、设置、后台栏目，以及后台顶栏按钮和套餐容量截断。窄屏网格、内容最小宽度与容量纵向布局，58 项布局实测通过。 |
| DEF-NFR-01 | **未解决，P0** | 允许 5GiB 上传，但真实 ClamAV 引擎把 MaxFileSize 强制限制为 `INT_MAX - 2`（2147483645 字节），配置 5G 不会生效。官方 1.5.4 others.c 676～689 行及部署版本 1.4.6 的 618～628 行均确认此限制，与真实扫描结果一致。保持 415/scan_size_limit、不发布和全部分片可恢复。5GB 验收需要支持该体积的整文件扫描能力；不能关闭扫描/上限告警或缩小要求后标记通过。 |
| DEF-NFR-02 | 已修复 | `Range: bytes=-N` 的结束位置计算错误。下载和预览均修正为文件尾部，并拒绝无效/非安全整数范围。 |
| DEF-NFR-03 | 已修复 | 资源创建接口缺少频率限制。三类 POST 创建路由增加 60 次/5 分钟/IP/路由限制，multipart 解析前执行。 |
| DEF-NFR-04 | 已修复 | 存储错误提示和请求日志上下文不足，扫描上限与威胁提示混用。增加 ENOSPC/EDQUOT 507、release/requestId/errorCode 和扫描上限专用错误码；日志不直接输出任意错误正文。 |
| DEF-DEPLOY-01 | 已修复 | runtime 部署检查在 release 不匹配时仅警告、缺失值跳过，且只比较前七位。现在先等待 health，再要求完整 release 一致，否则失败；5 项运行门禁回归通过。 |
| DEF-DEPLOY-02 | 已修复 | 应用镜像没有 HEALTHCHECK。增加验证 health.ok 的实际探针，Compose 实测 healthy；排除多 GB 测试数据，构建上下文为 53.63MB。 |
| DEF-TEST-01 | 已修复 | Docker COPY 验证脚本在 Windows 杀掉子进程后立即 process.exit 会触发 libuv 断言。等待 close、消费 health 响应并正常退出后，验证退出码为 0。 |

真实 5GiB 文件：5368709120 字节，640 个分片。原始文件与组装文件 SHA256 均为：

`e39785878efe1705f546bbd5ebad93838b1072477680ce3d9ebe79032581d91d`

扫描拒绝后会话仍可查询全部 640 个分片，未发布不完整/未扫描资源。一次性副本的大文件清理被自动审批拒绝（返回“blocked by policy”），暂时保留于 `C:/Users/admin/AppData/Local/Temp/kunqiong-browser-0SWFWG/storage/tmp/upload-sessions/867344d4d710c44ae2/0.target`；原始边界测试文件保留。

## 自动验证与证据

最终本机复跑：支付/后台 API **114**、支付/后台 React UI **28**、受控 NFR/冒烟 **50**、真实 Docker/500MiB/故障集成 **27**、部署 release 门禁 **5**，共 **224 通过、0 失败**。Docker COPY 校验亦以退出码 0 通过。另真实 Office 转换/扫描 **6 通过**、浏览器四类预览 **4 通过**、真实 5GB 集成仍为 **6 通过、1 失败**。断言数与上方 44 个用例状态分开计算；224 项通过不能替代尚未通过的 5GB 验收。

受控 128MiB 内存测量：8MiB 分片，上传后端 RSS 基线 117633024、峰值 169451520、增量 51818496 字节（约 49.4MiB）；下载 RSS 增量 11792384 字节（约 11.2MiB）。这不是 5GB 浏览器内存结论。

收集回归最终重跑：API 72、截止时间界面 8、文件夹/批量选择界面 23、续传界面 19，全部通过。此前已运行账号 API 80/UI 34、团队 API 107/UI 43、修复 API 83/支付 UI 10、分片 10、记录预览 23、分享 26 回归及 Office 净化测试。团队独立管理员角色缺失的既有部分通过结论仍保留在团队报告，不计入当前 44 项。

构建成功，`git diff --check`（兼容 CRLF）通过。Vite 保留已有依赖大块提示。当前修复未提交或推送。

Docker 使用 Node20 Alpine 实际构建并启动。新容器测试使用独立项目、合成用户和独立卷，未改动真实账号或业务存储。第一、二次容器测试中缺少取件码、给登录收集任务设置匿名容量、跨文件系统 tmpfs 及空存储尚未持久化的夹具问题已修正，前两次失败证据保留；最终 27 项完整复跑通过，未修改产品扫描或容量策略。

最终服务检查：前端 4173 返回 200，后端 8045 health 为 ok；以隐藏进程恢复运行。测试副本服务已停止。原浏览器标签停留在错误页面时，恢复操作被浏览器 URL 安全策略拒绝，未绕过策略；用户可刷新现有页面。

所有本轮证据目录：

[acceptance-after](C:/Users/admin/.codex/visualizations/2026/10/10/01a124db-f624-7ae1-a455-edb46f0350a9/acceptance-after)

- [支付/后台接口结果](C:/Users/admin/.codex/visualizations/2026/10/10/01a124db-f624-7ae1-a455-edb46f0350a9/acceptance-after/finance-admin-results.json)
- [支付/后台界面结果](C:/Users/admin/.codex/visualizations/2026/10/10/01a124db-f624-7ae1-a455-edb46f0350a9/acceptance-after/finance-admin-ui-results.json)
- [受控 NFR 与冒烟结果](C:/Users/admin/.codex/visualizations/2026/10/10/01a124db-f624-7ae1-a455-edb46f0350a9/acceptance-after/nfr-smoke-results.json)
- [真实 5GB 结果](C:/Users/admin/.codex/visualizations/2026/10/10/01a124db-f624-7ae1-a455-edb46f0350a9/acceptance-after/real-large-file-results.json)
- [扫描器配置、日志、健康与下载哈希](C:/Users/admin/.codex/visualizations/2026/10/10/01a124db-f624-7ae1-a455-edb46f0350a9/acceptance-after/environment-evidence.json)
- [48 项核心布局](C:/Users/admin/.codex/visualizations/2026/10/10/01a124db-f624-7ae1-a455-edb46f0350a9/acceptance-after/layout-strict-results.json)；[10 项后台布局](C:/Users/admin/.codex/visualizations/2026/10/10/01a124db-f624-7ae1-a455-edb46f0350a9/acceptance-after/admin-layout-results.json)
- [真实 Office 转换与扫描结果](C:/Users/admin/.codex/visualizations/2026/10/10/01a124db-f624-7ae1-a455-edb46f0350a9/acceptance-after/preview-security-results.json)；[实际浏览器预览 DOM](C:/Users/admin/.codex/visualizations/2026/10/10/01a124db-f624-7ae1-a455-edb46f0350a9/acceptance-after/preview-browser-results.json)
- [浏览器冒烟结果](C:/Users/admin/.codex/visualizations/2026/10/10/01a124db-f624-7ae1-a455-edb46f0350a9/acceptance-after/browser-smoke-results.json)；[收集回归日志](C:/Users/admin/.codex/visualizations/2026/10/10/01a124db-f624-7ae1-a455-edb46f0350a9/acceptance-after/collections.log)
- [最终服务及临时文件状态](C:/Users/admin/.codex/visualizations/2026/10/10/01a124db-f624-7ae1-a455-edb46f0350a9/acceptance-after/final-service-results.json)
- [真实容器、500MiB 并发与故障结果](C:/Users/admin/.codex/visualizations/2026/10/10/01a124db-f624-7ae1-a455-edb46f0350a9/acceptance-after/container-acceptance-results.json)；[运行日志](C:/Users/admin/.codex/visualizations/2026/10/10/01a124db-f624-7ae1-a455-edb46f0350a9/acceptance-after/container-runtime.log)
- [部署版本回归结果](C:/Users/admin/.codex/visualizations/2026/10/10/01a124db-f624-7ae1-a455-edb46f0350a9/acceptance-after/deploy-release-results.json)；[修复前失败证据](C:/Users/admin/.codex/visualizations/2026/10/10/01a124db-f624-7ae1-a455-edb46f0350a9/acceptance-after/deploy-release-before.json)
- [ClamAV 1.5.4 官方源码证据](C:/Users/admin/.codex/visualizations/2026/10/10/01a124db-f624-7ae1-a455-edb46f0350a9/acceptance-after/clamav-1.5.4-others.c:676)（[官方来源](https://github.com/Cisco-Talos/clamav/blob/clamav-1.5.4/libclamav/others.c#L676)）

![320px 后台修复](C:/Users/admin/.codex/visualizations/2026/10/10/01a124db-f624-7ae1-a455-edb46f0350a9/acceptance-after/admin-mobile.jpg)

![危险链接与字面脚本的实际预览](C:/Users/admin/.codex/visualizations/2026/10/10/01a124db-f624-7ae1-a455-edb46f0350a9/acceptance-after/security-preview.jpg)

复跑受控验收：`npm run test:acceptance`。真实扫描/浏览器测试需启动 `scripts/serve-acceptance-ui.mjs` 并登录其合成账号，然后运行 `scripts/verify-preview-security.mjs <临时副本目录>`；真实 5GB 测试为 `scripts/verify-real-large-file.mjs <临时副本目录>`，扫描失败时退出码 1 是实际失败，不能忽略。

复跑本机容器验收：先 `docker build -t kunqiong-acceptance:local .`，再运行 `node scripts/verify-container-acceptance.mjs`；需要 Docker、Compose、ClamAV 1.4 镜像和真实 500MiB 数据。`node scripts/verify-deploy-release.mjs` 使用 Ubuntu Bash 和本地 Docker 测试桩，仅运行 release 门禁，不执行真实部署。设置 `ACCEPTANCE_EVIDENCE_DIR` 可保存结果；测试容器结束后停止，卷和日志保留。
