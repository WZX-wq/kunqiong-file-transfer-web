# 架构说明

本文档记录项目的代码组织约定与重构历史。新增代码时请遵循这里的约定。

## 目录结构

```
├── server.mjs              # 服务端入口：应用装配、运行期状态、路由注册
├── server/                 # 服务端分层模块
│   ├── config.js           # 环境变量、路径与业务常量（唯一配置来源）
│   └── lib/
│       ├── env-file.js     # .env 文件加载
│       └── http.js         # HTTP 错误构造与通用纯函数
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
| 配置层 | `server/config.js` | 读取环境变量、定义路径与业务常量 | 不依赖任何业务代码 |
| 工具层 | `server/lib/*.js` | 无状态纯函数、错误构造 | 仅依赖配置层 |
| 入口层 | `server.mjs` | 应用装配、路由注册、状态持有 | 可依赖以上各层 |

**关键规则：**

1. **配置只在 `server/config.js` 读取。** 不要在业务代码里直接写 `process.env.XXX`——
   集中读取便于排查配置问题，也避免同一变量在多处解析出不一致的默认值。
2. **`server/lib/` 内不持有可变状态。** 这里只放纯函数；一旦需要状态，说明它不属于工具层。
3. **`metadata` 等可变状态仍是单例**，由 `server.mjs` 持有。需要读写状态的代码留在入口层。

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

## 值得注意的技术债

### 1. 函数按功能分散书写，彼此交错

`server.mjs` 中同一业务域的函数往往分散在不同位置。例如 admin 域的 15 个函数
横跨 2807–3388 行，中间夹着 401 行其他业务代码。这使"按域拆分模块"需要
多次不连续的行区间删除，每次都有人为失误风险。

**建议**：若后续要继续拆分，先在文件内**按业务域重排函数顺序**（纯位置调整，
不改逻辑），让同一域的函数连续，再整体搬迁。这样每步都可独立验证。

### 1b. `metadata` 的规范化依赖形成环（继续拆分前必须先解决）

`normalizeMetadata()` 依赖 **11 个领域规范化函数**（`normalizeAccountUserStore`、
`normalizeAccountRecordStore`、`normalizeUpgradeOrders`、`normalizeOrganizations` ……）
外加 `createToken` 与运行期标量 `metadataNeedsPersist`。

真正的麻烦在于**它的三个调用点全部位于元数据层内部**：启动时的
`normalizeMetadata(await loadMetadata())`、`loadMetadata()` 内的本地→MySQL 迁移、
`mergeMetadataSnapshots()` 的返回值。

⇒ **把正常化函数抽成独立文件解决不了问题**——存储层自己就要调用它，
`metadata-store → 领域模块 → metadata-store` 仍是闭环（ESM 下不抛错，
表现为运行期 `undefined`，极难排查）。

**正确解法是注入**：存储层暴露 `installNormalizer(fn)`，由入口在启动时把
`metadata-normalizers.js` 的 `normalizeMetadata` 注进去。单向依赖图：

```
config.js ← state.js ← metadata-store.js ← 各领域模块 ← metadata-normalizers.js ← server.mjs
```

详见 `拆分方案-2026-10-09.md` 第 2 章。

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

| 脚本 | 用途 |
|---|---|
| `extract-config.mjs` | 从 `server.mjs` 逐字抽取配置与工具层（幂等，需先准备 `server.mjs.orig`） |
| `rewrite-server-header.mjs` | 改写 `server.mjs` 头部为 import（幂等，含边界校验） |
| `verify-runtime.mjs` | 重构安全网：导入完整性 + 常量/函数行为断言 |

`verify-runtime.mjs` 建议在后续任何服务端改动后运行：

```bash
node scripts/refactor/verify-runtime.mjs
```
