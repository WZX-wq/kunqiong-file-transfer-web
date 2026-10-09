# 架构说明

本文档记录项目的代码组织约定与重构历史。新增代码时请遵循这里的约定。

## 目录结构

```
├── server.mjs              # 服务端入口：应用装配、路由注册、启动与优雅退出
├── server/                 # 服务端分层模块
│   ├── config.js           # 环境变量、路径与业务常量（唯一配置来源）
│   ├── state.js            # 运行期共享状态（连接池 + 限流/会话/上传计数表 + 缓存）
│   └── lib/
│       ├── env-file.js     # .env 文件加载
│       ├── http.js         # HTTP 错误构造与通用纯函数
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
| 工具层 | `server/lib/*.js` | 无状态纯函数、错误构造 | 可依赖以上各层 |
| 路由层 | `server/routes/*.js`（待建） | 按业务域注册路由 | 可依赖以上各层 |
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

**验证**：`npm run verify:refactor` 会检查循环依赖、结构约束、未使用导入、缺失导入，并算出依赖层级（当前最大深度 4）。

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

## 服务端拆分进度（2026-10-09）

原 `server.mjs` 6261 行 → 现在 **5196 行**，已抽出 5 个模块。

| 已抽出 | 行数 | 说明 |
|---|---:|---|
| `server/config.js` | 249 | 环境变量、路径、业务常量与默认项 |
| `server/state.js` | 84 | 12 个可变 Map/Set + `runtime` 容器 + 连接池 + 缓存 |
| `server/lib/metadata-store.js` | 408 | 元数据载入/合并/CAS 落盘（21 函数） |
| `server/lib/metadata-normalizers.js` | 671 | 领域规范化闭包（43 函数） |
| `server/lib/http.js` / `env-file.js` | 78 | 通用纯函数 |

`verify:refactor` 实测依赖层级（深度 4）：

```
层0  lib/env-file.js, lib/http.js
层1  config.js
层2  state.js
层3  lib/metadata-store.js, lib/metadata-normalizers.js
层4  server.mjs
```

### 剩余工作

`server.mjs` 余下 5196 行 ≈ 214 个顶层函数（2760 行）+ 80 条路由的内联处理器（1824 行）。

**顺序不能颠倒**：路由处理器直接引用这些函数，若先搬路由，就得让 `server.mjs`
反向导出函数给路由用 —— 那是循环依赖。必须先按域把函数搬进 `server/lib/*.js`，
再搬路由。

**路由域边界**（按内联处理器行数排序，可直接当拆分单位）：

| 前缀 | 路由数 | 处理器行数 |
|---|---:|---:|
| `/api/account` | 34 | 731 |
| `/api/upload-sessions` | 4 | 237 |
| `/api/collections` | 11 | 225 |
| `/api/auth` | 5 | 173 |
| `/api/shares` | 10 | 152 |
| `/api/admin` | 9 | 132 |
| `/api/organizations` | 2 | 114 |
| 其余（health / guest / runtime-config / 根路径） | 5 | 60 |

搬路由时用计划中的 `registerXRoutes(app, ctx)`：`ctx` 只放真正共享的可变状态与
跨域函数，各域内部专用函数直接 import，避免 `ctx` 长成新的上帝对象。

全部抽完后，`server.mjs` 预计收敛到 200–400 行（仅装配与启动）。

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
