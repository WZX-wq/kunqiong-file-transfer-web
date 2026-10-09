# 架构说明

本文档记录项目的代码组织约定与重构历史。新增代码时请遵循这里的约定。

## 目录结构

```
├── server.mjs              # 服务端入口：应用装配、中间件、启动与优雅退出（292 行）
├── server/                 # 服务端分层模块
│   ├── config.js           # 环境变量、路径与业务常量（唯一配置来源）
│   ├── state.js            # 运行期共享状态（连接池 + 限流/会话/上传计数表 + 缓存）
│   ├── services/           # 业务服务层：按业务域聚合领域逻辑
│   │   ├── account.js      # 账号域：身份会话 / 账号数据 / 套餐用量 / 升级支付 / 团队组织
│   │   ├── shares.js       # 分享/上传域：上传会话 / 文件落盘扫描 / 分享创建查询管理下载
│   │   ├── admin.js        # 后台/身份域：管理员会话 / OAuth 回调 / 运维清理
│   │   └── collections.js  # 收集域：匿名文件收集 / 提交 / 汇总下载
│   ├── routes/             # 路由层：只做 HTTP 适配，调用 services
│   │   ├── account.js      # /api/auth/* + /api/account/{基础}
│   │   ├── workspace.js    # /api/account/workspace* + /api/organizations/*
│   │   ├── upgrade.js      # /api/account/upgrade-*
│   │   ├── shares.js       # /api/shares（创建 + 查询/管理/下载/预览）
│   │   ├── upload.js       # /api/upload-sessions/*
│   │   ├── admin.js        # /api/admin/* + /auth/callback
│   │   └── collections.js  # /api/collections/*
│   └── lib/
│       ├── env-file.js     # .env 文件加载
│       ├── http.js         # HTTP 错误构造与通用纯函数
│       ├── upload.js       # multer 实例 + 上传中间件 + 文件名规范化（多域共用）
│       ├── audit.js        # 审计日志工具（requestIp / sanitizeAuditPath，多域共用）
│       ├── metadata-store.js # 元数据快照：载入 / 合并 / CAS 落盘（不含领域规范化）
│       └── metadata-normalizers.js # 领域规范化聚合点（唯一允许 import 多个领域的地方）
├── src/
│   ├── main.jsx            # 前端入口（React 应用与页面组件）
│   ├── office-html.js      # Office 文档 HTML 清洗
│   ├── styles.css          # 样式入口：只做 @import 汇总，不放规则
│   └── styles/             # 样式分层
│       ├── base.css        # 基础层：布局骨架、通用控件、公共组件
│       └── components.css  # 组件层：页面组件、响应式、设计增强层
└── scripts/
    ├── refactor/           # 重构工具与验证脚本（非业务代码）
    └── verify-*.mjs        # 接口/行为回归脚本
```

## 样式分层（2026-10-09 拆分）

原 `src/styles.css` 1784 行拆为「入口 + 两层」，**只做连续区间切分，未重排任何规则**。

```
src/styles.css        13 行   入口，只放 @import
src/styles/base.css  857 行   原文件第 2–848 行
src/styles/components.css 944 行  原文件第 849–末尾
```

**关键规则：**

1. **`src/styles.css` 里不放任何规则。** CSS 规范要求 `@import` 位于所有规则之前，
   入口只放 import 正好合规。
2. **导入顺序不可调整：base → components。** 文件里存在多处「同特异性下后者胜出」
   的覆盖（如 `.workspace-lower-row`、`.team-invite-page .team-join-card` 处都有注释说明），
   层叠依赖书写顺序，调整次序会静默改变渲染结果。
3. **文件内部的规则顺序同样不可重排。** 本次拆分未按选择器族重排过规则——
   该文件的选择器族是跨全文件交错的（如 `team` 横跨 45–1017、`collection` 横跨 361–1723），
   按族重排属于独立任务，需配视觉验收。
4. **新增样式优先追加到 `components.css` 末尾。**
   原「视觉微调统一放设计增强层（文件最末）」的约定，改为「追加到 `components.css` 最末」。
5. **验证方式**：CSS 拆分的判据是**构建产物的 CSS 逐字节一致**——
   `npm run build` 后比对 `dist/assets/index-*.css` 的 sha256。本次拆分前后同为
   `a5c9d2184661474a`（140043 字节），连同产物文件名 hash 都未变。

## 分层约定

### 服务端

| 层 | 位置 | 职责 | 可否依赖上层 |
|---|---|---|---|
| 配置层 | `server/config.js` | 环境变量、路径、业务常量与默认项 | 仅可依赖 `lib/env-file.js` |
| 状态层 | `server/state.js` | 连接池、限流/会话/上传计数表、缓存、CAS 计数 | 仅可依赖配置层 |
| 存储层 | `server/lib/metadata-store.js` | 元数据快照的载入、合并与 CAS 落盘 | 可依赖配置层与状态层 |
| 规范化层 | `server/lib/metadata-normalizers.js` | 把原始 JSON 规范化为内存模型 | 可依赖以上各层 |
| 工具层 | `server/lib/*.js` | 无状态纯函数、错误构造、多域共用的中间件（`upload.js` 的 multer 实例） | 可依赖以上各层 |
| 服务层 | `server/services/*.js` | 按业务域聚合领域逻辑（账号域已迁出） | 不得依赖 `routes/` 与入口 |
| 路由层 | `server/routes/*.js` | 按业务域注册路由，只做 HTTP 适配 | 可依赖服务层及以下 |
| 入口层 | `server.mjs` | 应用装配、路由注册、启动与优雅退出 | 可依赖以上各层 |

**关键规则：**

1. **配置只在 `server/config.js` 读取。** 不要在业务代码里直接写 `process.env.XXX`——集中读取便于排查配置问题，也避免同一变量在多处解析出不一致的默认值。

2. **配置层不持有运行期资源。** `config.js` 只导出值，不创建连接池、不注册定时器。连接池由 `server/state.js` 创建并持有。（历史上 `config.js` 里曾有一份连接池，因引用未定义变量导致开 MySQL 就崩，已于 2026-10-09 移除。）

3. **`server/lib/` 内不持有可变状态**（`metadata-store.js` 的 `metadata` 是唯一例外，见第 5 条）。其余需要状态的一律放 `state.js`。

4. **`server/state.js` 里的 Map/Set 必须全进程唯一。** 这些是限流计数、上传会话、管理后台会话、OAuth state —— 各自持有一份副本会静默失效（限流不生效、会话查不到），所以集中在一处 export，各模块按需 import。

5. **`metadata-store.js` 不得 import 任何领域模块。** 领域规范化函数由入口在启动时通过 `installNormalizer` 注入，顺序不可颠倒：

   ```js
   installNormalizer(normalizeMetadata)                    // ① 先注入
   initMetadata(normalizeMetadata(await loadMetadata()))   // ② 再初始化
   ```

   原因：`normalizeMetadata` 依赖 11 个领域 normalizer，而它的调用点在存储层内部；
   若存储层直接 import 领域模块，就会形成
   `metadata-store → 领域模块 → metadata-store`（领域模块要 persist）的循环。
   ESM 下成环不抛错，表现为运行期 `undefined`，极难排查。

6. **`metadata` 快照只在启动时就地填充一次，之后只做属性级修改，绝不整体替换。**
   路由与定时器持有的是同一个引用，替换对象会让它们继续写到废弃的快照上。
   （`applyMergedMetadata` 里有同样说明。）

7. **`server/services/` 是业务域逻辑的唯一归属，不得反向依赖 `routes/` 与入口。**
   依赖方向只能 `routes → services → lib → state → config`。
   同理，`lib/`、`state.js`、`config.js` 都不得 import `services/`。
   新增业务域时：领域逻辑进 `services/<域>.js`（导出函数），
   路由只做参数解析与响应封装，放 `routes/<域>.js`，并导出 `registerXxxRoutes(app)`。

8. **路由注册顺序 = Express 匹配顺序，`server.mjs` 中的 `registerXxxRoutes(app)` 调用顺序不可调整。**
   各路由文件内部按原始顺序排列，新路由追加到所属文件末尾。
   一个路由文件可以导出多个注册函数，用于在流水线的不同位置插入（如
   `routes/shares.js` 的「创建」在 upload-sessions 之前、「访问」在其之后）；
   但**调用点顺序必须与原文件一致**。

9. **路由模块之间不得互相依赖。** 相邻域共享的中间件与工具应下沉到 `lib/`，
   例如 multer 实例放 `lib/upload.js`（`/api/shares` 与 `/api/collections` 都要用）。
   `verify:refactor` 会强制这条规则。

10. **搬迁按「先函数、后路由」的顺序。** 路由处理器直接引用业务函数；
   若先搬路由，就得让入口反向导出函数给路由用，那是循环依赖。
   搬迁方法：用脚本算 `app.get/post/...` 处理器的**函数闭包**（而非手写清单），
   再确认闭包对顶层符号零逃逸，然后整块搬移。

11. **`lib/` 里只放被多域共用的东西。** 判断标准是「有没有第二个消费者」，
   而不是「看起来通用」。`normalizeUploadFileName` 从 `services/account.js`
   下沉到 `lib/upload.js` 就是因为它被 account / shares / lib / 入口四处使用；
   只被一个域用的工具留在该域的 service 里。

**验证**：`npm run verify:refactor` 会检查循环依赖、结构约束、未使用导入、缺失导入，并算出依赖层级（当前最大深度 7）。

### 前端

前端**逻辑**目前仍集中在 `src/main.jsx`（7150 行；AST 实测 239 个命名函数，
其中 66 个 React 组件 + 173 个工具函数）。组件按页面域组织，
共享的工具函数与 API 请求封装在文件内的 `apiRequest`、`readRecords` 等处。

> 已知结构问题（待拆分，方案见 `拆分方案-2026-10-09.md`）：
> `WorkspaceApp` 一个组件占 942 行，构成为 46 行状态 + **665 行、45 个内联 handler** + 121 行 JSX——
> 臃肿的是 handler 而非 JSX。`RecordsView` 461 行、`TeamPage` 442 行次之。
> 样式部分已于 2026-10-09 先行拆分（见上文「样式分层」）。

## 重构历史

### 2026-10-09：抽出服务端基础设施层

**动机**：`server.mjs` 单文件 6037 行，配置、工具、业务逻辑、路由混在一起，
修改任何一处都要在六千行里定位。

**做法**：把配置与通用工具逐字抽取为独立模块，路由与业务逻辑保持原位。

| 产物 | 行数 | 内容 |
|---|---|---|
| `server/config.js` | 184 | 89 个导出：路径、上传限制、OAuth、SMTP、短信、支付、账号限制、扫描配置、测试开关、收集类型 |
| `server/lib/http.js` | 57 | `httpError`、`parseRecipients`、`firstHeader`、`firstValue`、`escapeHtml`、`createToken`、`hashSecret`、`parseJson`、`removeDirectory` |
| `server/lib/env-file.js` | 22 | `loadEnvFile` |

`server.mjs` 由 6037 行降至 5881 行。

**原则**：所有常量与函数从原文**逐字搬运**，仅追加 `export` 前缀。
未手写任何业务常量——例如 `COLLECTION_TYPE_EXTENSIONS` 的键是中文分类名
（`图片`/`文档`/...），手写极易丢失语义导致收集任务的文件白名单失效。

**验证**（`scripts/refactor/verify-runtime.mjs`）：
- 92 个导入符号全部存在于目标模块
- 8 项常量不变量断言（收集类型中文键名、5GB 上限、分片大小、套餐映射等）
- 7 项工具函数行为断言
- 服务真实启动，`/api/health`、`/api/runtime-config`、`/api/guest/quota`、
  `/api/auth/me` 均返回 200，鉴权端点正确返回 401
- 79 个路由注册数量与重构前一致
- 前端 `vite build` 通过，产物大小无变化

### 2026-10-09：拆出样式分层（`styles.css` → 入口 + 两层）

**动机**：`src/styles.css` 单文件 1784 行、1289 条规则，绝大多数是单行规则，
且**没有任何注释分节**——要改某个类名得先全文搜索。

**做法**：按**连续区间**切分，未重排任何规则：

| 产物 | 行数 | 内容 |
|---|---|---|
| `src/styles.css` | 13 | 入口，只放 `@import` |
| `src/styles/base.css` | 857 | 原第 2–848 行 |
| `src/styles/components.css` | 944 | 原第 849 行至末尾 |

切分点取中原点附近最近的**选择器前缀切换处**（行 849，`.workspace-*` → `.team-page`），
落在两条完整规则之间，避免切断规则块。

**为什么不做按选择器族重排**：文件里存在多处「同特异性下后者胜出」的覆盖
（`.workspace-lower-row`、`.team-invite-page .team-join-card` 等处都有注释专门说明），
层叠完全依赖书写顺序；而选择器族本身是跨全文件交错的（`team` 横跨 45–1017、
`collection` 横跨 361–1723），按族重排会静默改变覆盖结果。族重排属独立任务，需配视觉验收。

**验证**（本次拆分的判据是产物级，不是文件级）：
1. **逐字节无损**：把两份新文件拼接回去，与原文件（除首行远程字体 `@import`）**sha256 完全一致**
2. **产物零变化**：`npm run build` 后 `dist/assets/index-*.css` 的 sha256 与拆分前同为
   `a5c9d2184661474a`（140043 字节），连同产物文件名 hash 都未变
3. **运行时冒烟**：真实启动后 `/api/health`、`/`、`/assets/index-*.css` 均 200；
   抽查跨越切分点的选择器（`.workspace-status-card` / `.team-page` / `.team-resource-row`）、
   `@media`、设计增强层 `@keyframes` 均在产物中
4. **回归**：`verify:refactor` 94 符号通过；`test:remediation` 三个套件通过（Payment UI 10/10）

### 2026-10-09：抽出 `server/state.js` + 修复 MySQL 模式无法启动的 P0

**动机**：`server.mjs` 顶部散落着 12 个运行期 Map/Set（限流计数、上传会话、升级锁、支付对账、管理后台会话、OAuth state）加一个连接池。它们必须在全进程共享同一实例，按域拆分模块时若各自持有一份会静默失效，所以先把它们集中。

**做法**：搬迁为 `server/state.js`（零改名，仅加 `export`），`server.mjs` 改为 import。

**顺带修掉的 P0**：`KUNQIONG_DB_ENABLED=true` 时服务完全起不来。

回归源头是 `a37017c`（抽出配置层）——把 `databasePassword` 的**使用**搬进了 `config.js`，却没搬它的**定义**；`server.mjs` 侧同样丢了定义但留下引用。实测三层连锁：

```
config.js:181    ReferenceError: databasePassword is not defined
server.mjs:143   ReferenceError: mysql is not defined
server.mjs:2469  ReferenceError: databaseHost is not defined
```

**为什么长期没被发现**：三处引用都位于环境分支内，默认 `KUNQIONG_DB_ENABLED=false` 时永不执行。静态检查看不到（没有 import 语句可查），常规启动也走不到，只有真正开 MySQL 才会炸。

**修复后的行为**：越过模块加载，抛出有意义的业务错误「数据库模式已开启，但数据库连接参数不完整」，而不是 `ReferenceError`。

**由此固化的两条检查**（见 `scripts/refactor/verify-runtime.mjs`）：

1. **配置模块环境分支覆盖** —— 带环境分支的模块必须在每个分支下各跑一次导入。以子进程方式在「默认」与 `KUNQIONG_DB_ENABLED=true` 下分别 import 一次 `config.js`。
2. **缺失导入检测** —— 某符号在本项目其他模块有导出、本文件也引用了它，但既没 import 也没本地声明。这正是本次能逐层挖出三处引用的工具。

### 2026-10-09：抽出元数据存储层，用注入式 normalizer 打破依赖环

**背景**：这是服务端拆分里最难的一环。`normalizeMetadata` 依赖 11 个领域 normalizer，
而它的 **3 个调用点全部位于存储层内部**——启动时的 `normalizeMetadata(await loadMetadata())`、
`loadMetadata` 内的本地→MySQL 迁移、`mergeMetadataSnapshots` 的返回值。

所以「把 normalizer 抽成独立文件」**并不解决问题**：存储层自己就要调用它，
`metadata-store → 领域模块 → metadata-store` 的环依然闭环。ESM 下成环不抛错，
表现为运行期 `undefined`，极难排查。

**做法**：存储层留一个注入缝，由入口在启动时把 `normalizeMetadata` 注进去。

```js
// metadata-store.js
let normalizeSnapshot = (value) => value      // 注入前恒等，模块可独立加载
export function installNormalizer(fn) { ... }

// server.mjs —— 顺序不可颠倒
installNormalizer(normalizeMetadata)                    // ① 先注入
initMetadata(normalizeMetadata(await loadMetadata()))   // ② 再初始化
```

`metadata` 迁移为 `export const metadata = {}`，启动时就地填充一次，之后只做属性级修改 ——
沿用既有的「同一引用」不变量。

**搬迁内容**：21 个函数（分三段连续块）+ 3 个常量。

| 块 | 内容 |
|---|---|
| 载入 | `emptyMetadata` / `readMetadataFileFrom` / `loadLocalMetadata` / `readLocalMetadataRevision` / `loadMetadata` / `readRemoteMetadataRow` / `ensureDatabaseStateTable` |
| 合并 | `metadataIdSets` / `metadataRecordTime` / `mergeMetadata*` / `applyMergedMetadata` / `rememberMetadataBaseIds` |
| 持久化 | `persistMetadata` / `withLocalMetadataLock` / `persistLocalMetadata` / `writeMetadataToDatabase` |

块内对 `normalizeMetadata` 的 2 处调用改写为注入的 `normalizeSnapshot`。
`DEFAULT_SYSTEM_CONFIG` 移入 `config.js`（存储层与业务层都要用）。

**结果**：`server.mjs` 6243 → 5873 行，新增 `metadata-store.js` 408 行。
依赖层级变为干净的单向链：`env-file/http → config → state → metadata-store → server.mjs`（深度 4）。

**验证**：`metadata-cas` 12/12（两个真实进程并发写 + 重启恢复，这是对持久化路径最深的检验）、
`upload` 10/10、`remediation` 61 PASS、`payment-ui` 10/10、`docker-copy` 200、构建 8.31s。

### 2026-10-09：抽出元数据规范化层

`normalizeMetadata` 的**传递依赖闭包**（43 个函数 / 600 行）迁到
`server/lib/metadata-normalizers.js`。闭包由脚本从 AST 算出，**未手写清单** ——
漏一个就是运行期 `ReferenceError`。

覆盖账号（用户/消息/通知设置）、记录、组织、支付、游客配额、系统配置、验证码、
审计等领域的规范化，以及同簇的小工具。

该模块是「唯一允许 import 多个领域」的聚合点。实测**无循环依赖**：
闭包对 `metadata-store` 的唯一需求（落盘）是通过 `runtime.metadataNeedsPersist = true`
标记 + 由 store 统一落盘完成的，不需要反向 import。

同时把业务常量归位 `config.js`：`ACCOUNT_PLANS` / `ACCOUNT_PLAN_RANK` /
`DEFAULT_NOTIFICATION_SETTINGS` / `DEFAULT_FILE_CLEANUP_SETTINGS` / `DEFAULT_ACCOUNT_MESSAGES`。
理由：规范化层与业务层都要用，放配置层避免互相 import。

**结果**：`server.mjs` 5873 → 5198 行，新增 `metadata-normalizers.js` 646 行。

### 2026-10-09：抽出账号域（services + routes 两层）

第一个完整的业务域拆分，建立了后续各域可复用的流程。

**做法：用脚本算闭包，不手写清单。** 先把 41 条路由（account / auth / workspace /
organizations-join / upgrade）的处理器作为种子，算函数依赖闭包 → 105 个函数 / 1237 行。
再确认三件事后才动手：

1. 闭包对「顶层但不在闭包内」的符号**零引用**（自包含，可整块搬）
2. 路由处理器的 27 个自由标识符**全部来自 import**，无一来自 `server.mjs` 本地声明
3. 相关常量（`LOOPBACK_HOSTS`、`VERIFICATION_*`、`REMOTE_PRICING_TTL`）仅闭包内使用

**为什么不按子域继续拆成 4 个文件**：实测「身份 / 套餐 / 组织 / 数据」四块
**每一对之间都有双向引用边**（11 条子域级环）。硬拆必须引入大范围注入，
得不偿失。1425 行超出 1000 行软目标，是依赖密度决定的 —— 已在文件头注明。

**搬迁顺序**：先函数（`services/account.js`）后路由（`routes/*.js`）。
反过来会让入口反向导出函数给路由，那是循环依赖。

**`registerXxxRoutes(app)` 不带 `ctx`**：实践证伪了方案中「必须注入 ctx」的假设 ——
路由只依赖 import。不加 `ctx` 也避免它长成新的上帝对象。

**验证**：搬迁前后逐条比对 **85 条路由注册的方法/路径/顺序完全一致**（含
`app.set`/`app.use`）。这是「Express 匹配行为未变」的直接证据。
另有完整回归矩阵（CAS 12/12、上传 10/10、remediation 61 PASS、支付 UI 10/10、
真实启动探测、构建）。

**结果**：`server.mjs` 5196 → 2774 行；新增 `services/account.js` 1425 行 +
`routes/{account,workspace,upgrade}.js` 共 1118 行。
搬迁途中校验器自动抓出 94 个失效导入。

### 2026-10-09：抽出分享/上传域（第二个业务域）

沿用账号域确立的流程：算闭包 → 三确认 → 先 services 后 routes → 逐条比对路由顺序。

**同样遇到「子簇不可拆」**：upload 与 shares 实测互相引用（6 条双向边：
`assertUploadCapacity` → `assertCollectionFiles` / `collectionCapacityBytes` /
`assertTeamCapacity` / `assertAccountCapacity`，而 `collectionCapacityBytes` →
`guestQuotaLimitBytes`），故合并为单个 `services/shares.js`。

**multer 中间件的归属**：`upload.array('files', N)` 同时被 `/api/shares`（本轮搬出）
与 `/api/collections/:token/submissions`（仍在入口）使用。放在 service 里会让
「收集」这个未来的 route 反向依赖「分享」的 service；故下沉到 `lib/upload.js`，
并为此新增校验规则「路由模块之间不得互相依赖」。

**一个路由文件可导出多个注册函数**：`POST /api/shares` 在源文件中位于
upload-sessions 路由之前，因此 `routes/shares.js` 分成 `registerShareCreateRoutes`
与 `registerShareAccessRoutes` 两个入口，在流水线的两个位置分别调用 ——
保持「注册顺序与原文件逐条一致」这条不变量不破。

**顺带下沉通用工具**：`normalizeUploadFileName` / `looksLikeMojibake` 原在
`services/account.js`，但被四个模块使用；lib 不得反向 import services，
故下沉到 `lib/upload.js`。

**结果**：`server.mjs` 2774 → 1238 行；新增 `services/shares.js` 1186 行、
`routes/{shares,upload}.js` 467 行、`lib/upload.js` 42 行。

**行尾统一**：此前 `server/` 下 CRLF / LF / 混合三种并存（历次脚本产出不统一），
本轮一并规范化为 CRLF，与 `core.autocrlf=true` 的检出结果对齐。

### 2026-10-09：抽出后台/收集域（服务端拆分完成）

最后两个业务域迁出，`server.mjs` 收敛到 **292 行**。

**归属决策**：
- `requestIp` / `sanitizeAuditPath` 下沉 `lib/audit.js`（中间件与 admin 共用）
- `reconcileActiveUpgradeOrders` 迁 `services/account.js`（支付对账，非后台）
- `adminSessionFromRequest` / `cleanupExpiredAdminSessions` **留在 shares.js**：
  被 shares 的 `assertServiceWritable` 依赖，搬回 admin 会形成 shares→admin 环

**crypto 教训（重要）**：`safeEqualString` 依赖 `crypto.timingSafeEqual`，
但抽取脚本的 JS_GLOBALS 误把 `crypto` 当成 `globalThis.crypto` 过滤，漏生成
`import crypto from 'node:crypto'`。`node --check` 和 verify:refactor 都挡不住
（default 导入的本地名无法静态确认真实来源），直到跑 remediation 的 admin 登录
用例才暴露 `TypeError`。**结论：default 导入缺失是运行时才暴露的一类错误，
搬迁后必须跑覆盖该路径的真实回归。**

**结果**：`server.mjs` 1238 → 292 行；新增 `services/{admin,collections}.js`、
`routes/{admin,collections}.js`、`lib/audit.js`。服务端拆分全部完成。

## 服务端拆分进度（2026-10-09 —— 已完成）

原 `server.mjs` 6261 行 → 现在 **292 行**（仅装配、启动、中间件与静态托管）。

| 层 | 模块 | 行数 | 说明 |
|---|---|---:|---|
| 配置 | `server/config.js` | 249 | 环境变量、路径、业务常量与默认项 |
| 状态 | `server/state.js` | 84 | 12 个可变 Map/Set + `runtime` 容器 + 连接池 + 缓存 |
| 工具 | `server/lib/http.js` / `env-file.js` | 78 | HTTP 错误构造与通用纯函数 / .env 加载 |
| 工具 | `server/lib/upload.js` | 42 | multer 实例 + 文件名规范化（多域共用） |
| 工具 | `server/lib/audit.js` | 20 | requestIp / sanitizeAuditPath（中间件与 admin 共用） |
| 存储 | `server/lib/metadata-store.js` | 408 | 元数据载入/合并/CAS 落盘 |
| 规范化 | `server/lib/metadata-normalizers.js` | 671 | 领域规范化闭包（43 函数） |
| 服务 | `server/services/account.js` | 1433 | 账号域（身份/套餐/支付/组织） |
| 服务 | `server/services/shares.js` | 1186 | 分享/上传域 |
| 服务 | `server/services/admin.js` | 434 | 后台管理/身份/运维清理 |
| 服务 | `server/services/collections.js` | 112 | 匿名收集域 |
| 路由 | `server/routes/{account,workspace,upgrade,shares,upload,admin,collections}.js` | 2044 | 全部 80 条业务路由 |

`verify:refactor` 实测依赖层级（深度 8）：

```
层0  lib/env-file.js, lib/http.js
层1  config.js
层2  state.js, lib/upload.js
层3  lib/metadata-store.js, lib/metadata-normalizers.js, lib/audit.js
层4  services/account.js
层5  services/shares.js, services/admin.js, services/collections.js,
     routes/{account,upgrade,workspace}.js
层6  routes/{shares,upload,admin,collections}.js
层7  server.mjs
```

### 拆分完成，无需剩余工作

全部 80 条业务路由与它们的函数闭包都已迁出。`server.mjs` 里只剩：

- `app.set`/`app.use` 全局中间件（JSON 解析、审计日志、安全头）
- `/api/health`、`/api/runtime-config`、`/api/guest/quota` 三条基础设施路由
- 各域 `registerXxxRoutes(app)` 的调用（顺序不可调整）
- 启动、优雅退出、支付对账定时器、维护清理定时器
- `/auth/callback` 的注册（归 admin 域）

**顺序不变量**：`registerXxxRoutes(app)` 的调用顺序 = 原单文件中路由出现的顺序。
拆分过程中每一轮都用脚本逐条比对（展开 register 调用 vs `git show HEAD:server.mjs`），
最终 **85 条路由注册的方法/路径/顺序完全一致**。

### 关键决策记录

1. **不按子域硬拆高耦合簇**。account 域内「身份/套餐/组织/数据」、shares 域内
   「上传/分享」都实测存在子簇间双向边，硬拆必成环，故各自合并为单模块。
2. **`registerXxxRoutes(app)` 不带 `ctx`**。实践证伪了方案里的 ctx 假设 ——
   路由自由标识符全部来自 import，加 ctx 只会催生上帝对象。
3. **共享中间件下沉 lib**。multer 实例、审计工具等被多域共用的东西放 lib，
   避免 routes 之间互相依赖。
4. **default 导入缺失是运行时才暴露的错误**（见下方「重构历史」的 crypto 教训）。

## 值得注意的技术债

### 1. 函数按功能分散书写，彼此交错

`server.mjs` 中同一业务域的函数往往分散在不同位置。例如 admin 域的 15 个函数
横跨 2807–3388 行，中间夹着 401 行其他业务代码。这使"按域拆分模块"需要
多次不连续的行区间删除，每次都有人为失误风险。

**建议**：若后续要继续拆分，先在文件内**按业务域重排函数顺序**（纯位置调整，
不改逻辑），让同一域的函数连续，再整体搬迁。这样每步都可独立验证。

### 1b. ~~`metadata` 的规范化依赖形成环~~（2026-10-09 已解决，留档）

`normalizeMetadata()` 依赖 **11 个领域规范化函数**（`normalizeAccountUserStore`、
`normalizeAccountRecordStore`、`normalizeUpgradeOrders`、`normalizeOrganizations` ……）
外加 `createToken` 与运行期标量 `metadataNeedsPersist`。

真正的麻烦在于**它的三个调用点全部位于元数据层内部**：启动时的
`normalizeMetadata(await loadMetadata())`、`loadMetadata()` 内的本地→MySQL 迁移、
`mergeMetadataSnapshots()` 的返回值。

⇒ **把正常化函数抽成独立文件解决不了问题**——存储层自己就要调用它，
`metadata-store → 领域模块 → metadata-store` 仍是闭环（ESM 下不抛错，
表现为运行期 `undefined`，极难排查）。

**解法（已实施）**：存储层暴露 `installNormalizer(fn)`，由入口在启动时把
`normalizeMetadata` 注进去。见上文重构历史「抽出元数据存储层」。

**剩余工作**：11 个领域 normalizer 目前仍留在 `server.mjs`。
后续按 `拆分方案-2026-10-09.md` 第 2 章迁到 `server/lib/metadata-normalizers.js`
（它是唯一允许 import 所有领域模块的地方），届时 `server.mjs` 只做注入与编排。

### 2. 前端 `src/main.jsx` 尚未拆分

7150 行、66 个组件集中在一个文件（样式部分已于 2026-10-09 先行拆出，见上文）。
组件间通过 props 传递数据，耦合相对服务端更低，拆分可行性更好。

**AST 实测的真实形状**（与直觉不同）：

| 组件 | 行数 | 构成 |
|---|---:|---|
| `WorkspaceApp` | 942 | 46 行状态 + **665 行、45 个内联 handler** + 121 行 JSX |
| `RecordsView` | 461 | |
| `TeamPage` | 442 | |
| `WorkspacePage` | 267 | |
| `SettingsPage` | 253 | |
| `UpgradeModal` | 230 | |

**重点不是 JSX 臃肿，而是 handler 臃肿**——`WorkspaceApp` 的 JSX 只有 121 行，
但里面定义了 45 个 handler。这 45 个天然按域聚类（认证/消息/发送上传/记录/收集/管理/取件/导航），
适合先抽成域内 hook，而不是直接拆 JSX。

**建议**：按页面域拆为 `src/pages/`，共享组件放 `src/components/`，
API 封装抽到 `src/lib/api.js`。先搬叶子组件，最后处理 `WorkspaceApp` 的 handler。
详见 `拆分方案-2026-10-09.md`。

### 3. `.env` 中含真实凭据

`.env` 已由 `.gitignore` 排除，不会进入版本库。
但注意其中包含真实的 OAuth client secret 与管理员口令，**不要将文件内容复制到任何会提交的位置**。

## 重构工具

`scripts/refactor/` 下是与业务无关的重构辅助脚本，保留用于复现与回归：

| 脚本 | npm script | 用途 |
|---|---|---|
| `locate.mjs` | `verify:locate` | **符号定位**：按符号边界输出函数/路由/可变状态的当前行号，取代手写行号；含结构完整性断言 |
| `verify-runtime.mjs` | `verify:refactor` | **重构安全网**：模块图校验 + 常量/函数行为断言 |
| `check-docker-copy.mjs` | `verify:docker-copy` | 解析 Dockerfile 的 COPY 清单并物化目录真实启动，验证镜像形态可启动 |
| `extract-config.mjs` | — | 历史脚本：从 `server.mjs` 逐字抽取配置与工具层（一次性，勿重跑） |
| `rewrite-server-header.mjs` | — | 历史脚本：改写 `server.mjs` 头部为 import（一次性，勿重跑） |
| `_probe-config.mjs` | — | 供 `verify-runtime.mjs` 以子进程导入，覆盖 `config.js` 的环境分支 |

### `verify:refactor` 检查项

| 检查 | 说明 |
|---|---|
| 符号解析 | 每个具名/默认导入在目标模块确有导出 |
| **未使用导入** | 导入却全文未引用 —— 搬迁后最常见的手尾 |
| **缺失导入** | 本文件引用了、其他模块也导出了，但既没 import 也没本地声明 —— 运行到该行即 `ReferenceError` |
| 循环依赖 | DFS 三色标记（ESM 成环不抛错，必须静态抓） |
| 结构约束 | 入口不可被依赖、config 只依赖 env-file、路由只由入口引用 等显式规则 |
| 依赖层级 | 算出拓扑深度并展示，>6 层告警 |
| 常量/函数断言 | 收集类型中文键名、5GB 上限、分片大小、套餐映射等不变量 |
| **环境分支覆盖** | 在「默认」与 `KUNQIONG_DB_ENABLED=true` 下各导入一次 `config.js` |

`verify-runtime.mjs` 建议在后续任何服务端改动后运行：

```bash
npm run verify:refactor
```

**已知环境限制**：`fs.cpSync(目录, 目录, { recursive: true })` 在受限执行环境下会让进程被直接终止（无输出 + exit 127，极难定位）。需要复制目录时请用逐文件递归（见 `verify-metadata-cas.mjs` 的 `copyDirectory`）。`cpSync(文件, 文件)` 不受影响。
