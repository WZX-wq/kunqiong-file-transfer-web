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
│   └── styles.css          # 全局样式
└── scripts/
    └── refactor/           # 重构工具与验证脚本（非业务代码）
```

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

前端目前集中在 `src/main.jsx`（约 7100 行，57 个组件）。组件按页面域组织，
共享的工具函数与 API 请求封装在文件内的 `apiRequest`、`readRecords` 等处。

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

## 值得注意的技术债

### 1. 函数按功能分散书写，彼此交错

`server.mjs` 中同一业务域的函数往往分散在不同位置。例如 admin 域的 15 个函数
横跨 2807–3388 行，中间夹着 401 行其他业务代码。这使"按域拆分模块"需要
多次不连续的行区间删除，每次都有人为失误风险。

**建议**：若后续要继续拆分，先在文件内**按业务域重排函数顺序**（纯位置调整，
不改逻辑），让同一域的函数连续，再整体搬迁。这样每步都可独立验证。

### 2. 前端 `src/main.jsx` 尚未拆分

57 个组件集中在一个文件。组件间通过 props 传递数据，耦合相对服务端更低，
拆分可行性更好。

**建议**：按页面域拆为 `src/pages/`（send、collect、records、team、settings、admin），
共享组件放 `src/components/`，API 封装抽到 `src/lib/api.js`。
注意 `main.jsx` 内的状态提升较深，拆分时优先从叶子组件开始。

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
