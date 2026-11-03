# 鲲穹文件传输 · 本机压测总览（2026-11-02）

全部测试在本机完成：未连接、未部署、未访问 Gitea 测试服务器；未修改 `package.json`、`.env`、`server` 源码或既有报告。本轮覆盖三层：

| 层 | 被测对象 | 实例 | 主要产物 |
| --- | --- | --- | --- |
| 数据库层 | MySQL 真实关系表结构 + 规模化合成数据 | 隔离 Docker MySQL 8.4.5（4C/3GiB） | [数据库压测报告](PERFORMANCE-数据库压测报告.md) |
| 应用层 | MySQL 关系存储（按请求按需查询）模式 | 隔离 MySQL + 临时项目副本 | [MySQL 应用压测报告](PERFORMANCE-MySQL应用压测报告.md) |
| 真实实例抽检 | 本机运行中的 8045 服务 | 真实 MySQL 8.0.41（3 用户 / 116 资源 / 1.1 万审计） | `performance-evidence/live-local/results.json` |

## 一、一句话结论

读路径健康（点查 P95 3.7 ms、真实实例健康检查 P95 3.8 ms/9,773 rps），但**并发写入存在可复现的死锁缺陷**：写锁获取用 `INSERT IGNORE` + `SELECT ... FOR UPDATE` 的共享锁升级排他锁模式，数据库层 20 并发同 key 时 75% 事务死锁，应用层实测出现 55 次 `ER_LOCK_DEADLOCK`，导致上传完成和收集提交返回 503/409，并出现“实际已落库却返回失败”的假失败语义。同时 MySQL 按需模式每个业务读取请求约 25 条 SQL，5 连接池在 C30 即排队 46，吞吐封顶在 26–29 req/s、P95 2–3 秒。

## 二、三组实测核心数字

### A. 数据库层（MySQL 8.4.5，约 60 万行 / 270 MiB）

| 指标 | 结果 |
| --- | ---: |
| 主键/唯一键点查 C20 | 703 ops/s，P95 3.71 ms |
| 会话鉴权查询 C20 | 680 ops/s，P95 3.94 ms |
| 资源/记录/消息分页 C20 | 209–560 ops/s，P95 5–14 ms |
| 空间用量聚合 C10 | 606 ops/s，P95 2.25 ms |
| 审计单条写入 C20 | 132 ops/s，P95 18.9 ms |
| 5 条 SQL 提交事务 C20 | 70.7 ops/s，P95 36.7 ms |
| 同实体行更新 C20 | 56.8 ops/s，5,701 次行锁等待 |
| 混合 OLTP C5/C20/C50 | 216 / 223 / 226 ops/s |
| 连接池 2 + 50 并发 | 346 ops/s，排队获取连接 P95 18 ms |
| 死锁注入（反序更新两行，20 轮） | 20/20 被 MySQL 检测并回滚 |
| 写锁获取事务 C20 | **75% 事务 `ER_LOCK_DEADLOCK`**（6,347/8,464） |

### B. 应用层 MySQL 模式（20 用户 / 201 资源 / 400 记录 / 5000 审计）

| 场景 | 结果 |
| --- | ---: |
| 健康检查 C50 | 7,282 req/s，P95 15.7 ms |
| 前端页面 C50 | 4,005 req/s，P95 16.0 ms |
| 业务混合读取 C1 | 23.8 req/s，P95 94 ms |
| 业务混合读取 C30 | 27.4 req/s，P95 1,997 ms |
| 业务混合读取 C50 | 29.1 req/s，P95 3,091 ms |
| 持续稳定 C30（30 秒） | 26.3 req/s，P95 2,154 ms，0 失败 |
| 每请求按需 SQL | 25–26 条（SELECT 24.4 条，行读约 722 行） |
| 连接池峰值 | 已建 5/5，排队峰值 46 |
| 16 MiB 上传 C4 / C8 | 3/4、7/8 失败（503+409） |
| 16 MiB 下载 C1/C4/C8 | 10.5 / 16.2 / 17.4 文件/s，0 失败，SHA-256 全通过 |
| 收集任务 40 人提交 | 仅 1 次返回 201，实际落库 24 条 |
| 服务端日志 | `ER_LOCK_DEADLOCK` 55 次、`CAPACITY_CHANGED` 8 次 |

同机 JSON 模式对照：本机 Windows JSON 基线 C30 仅 11.3 req/s/P95 3.2 秒（受 `open/link/unlink` 文件锁与同步落盘限制），MySQL 模式约为其 2.3–3.6 倍。但该对照**不能外推生产**：历史 Linux 容器 JSON 基线 C30 约 36 req/s、关闭审计后约 2,377 req/s；同一份代码跨平台差异巨大。JSON 基线脚本的上传校验仍按旧 `storage/files/<id>/` 布局读取，产生 ENOENT（脚本侧问题，非服务端失败），上传列不可用。

### C. 本机真实运行实例只读抽检（8045 + MySQL 8.0.41）

| 场景 | 并发 | 吞吐 | P50 | P95 | P99 | 失败 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `/api/health` | 20 | 9,773 req/s | 1.61 ms | 3.81 ms | 7.44 ms | 0 |
| `/team` 页面 | 20 | 5,960 req/s | 2.97 ms | 5.82 ms | 9.03 ms | 0 |
| `/api/admin/session` | 5 | 427 req/s | 11.5 ms | 20.1 ms | 29.3 ms | 0 |
| `/api/admin/overview`（多段聚合 SQL） | 5 | 102 req/s | 39.4 ms | 62.3 ms | 221 ms | 0 |

真实实例在真实数据 + MySQL 8.0 下读路径无失败；管理总览是唯一出现百毫秒级 P99 的只读接口（聚合查询较多）。

## 三、问题与根因（按优先级）

1. **P0 · 写锁 S→X 升级死锁（可复现的代码级根因）**：`server/db/write-locks.js` 的 `lockWriteScope` 在同一事务里先 `INSERT IGNORE`（重复行取共享锁）再 `SELECT ... FOR UPDATE`（排他锁）。任意两个同 key 事务都会互相等锁形成死锁。数据库层压测 20 并发同 key 时 75% 死锁；应用层压测日志 55 次 `ER_LOCK_DEADLOCK`。建议改为 `INSERT ... ON DUPLICATE KEY UPDATE lock_key = lock_key`（直接取排他锁），或把“确保锁行存在”拆到独立提交，再在新事务 `SELECT ... FOR UPDATE`；同时生产提交路径捕获死锁/锁等待超时，做有上限的指数退避重试（带抖动）并返回可重试状态码。
2. **P0 · 假失败语义**：收集提交 24 条实际落库、仅 1 条返回 201；上传完成返回 503 但部分文件已合并。客户端无法判断是否应重试，会产生重复提交或数据不一致。需为写接口提供幂等键/结果查询，或在“已提交但响应失败”时返回明确的可重试错误码。
3. **P1 · 按需 SQL 放大 + 连接池 5**：每个业务读取请求 25–26 条 SQL，连接池 5 在 C30 排队 46，吞吐在 C10 后封顶、P95 线性上升。建议同一请求内复用连接并合并查询（multi-statement/JOIN）、缓存系统配置与套餐快照、按目标并发标定 `KUNQIONG_DB_CONNECTION_LIMIT` 与 `queueLimit`，并暴露连接池排队指标。
4. **P1 · 审计保留上限未生效**：配置保留 5000 条，隔离库实测 6,971 条、真实本机库已到 16,905 条，写入路径没有裁剪。建议补基于时间的清理任务并监控增长。
5. **P2 · 分页 filesort**：资源列表、收发记录、站内消息分页均出现 `Using filesort`。建议 `kq_resource(owner_user_id, resource_kind, status, deleted_at, gmt_create)`、`kq_account_record(user_id, scope, id)`，并复核消息分页未选到 `(user_id, id)` 的原因。
6. **P2 · 写热点与 fsync**：单行热点更新 56.8 ops/s，审计单条 132 ops/s，事务 70.7 ops/s。建议缩短事务、批量审计提交、避免事务内做外部 IO。
7. **P3 · 测量波动**：本机 Windows 同一脚本 MySQL 模式 C30 四轮为 40.63 / 36.83 / 26.50 / 26.31 req/s（±35%），报告主数据取最后一轮；容量结论需多轮复测。

## 四、优化动作清单（可直接排期）

| 优先级 | 动作 | 涉及文件/配置 | 验收方式 |
| --- | --- | --- | --- |
| P0 | 改写写锁获取方式，消除 S→X 升级死锁 | `server/db/write-locks.js` | 数据库层“写锁获取事务”场景死锁率 <1%；回归 `npm run test:db-on-demand` |
| P0 | 提交路径对死锁/锁等待超时有界重试 + 可重试错误码 | `server/db/request-store.js`、`server.mjs` 错误映射 | 应用层收集/上传并发场景 0 个 503；日志不再出现未处理 `ER_LOCK_DEADLOCK` |
| P0 | 写接口幂等/结果可查询，消除“假失败” | 上传完成、收集提交路由 | 压测中“落库数 = 返回成功数” |
| P1 | 请求内 SQL 合并 + 只读缓存 + 连接池标定 | `server/db/request-store.js`、`server/config.js` | 每请求 SQL 数下降 50%+；C50 P95 明显下降 |
| P1 | 审计保留策略与批量落盘 | `server/db/request-audit-store.js`、维护任务 | `kq_audit_log` 稳定在阈值附近 |
| P2 | 分页组合索引（新增迁移版本） | `docs/数据库设计-2026-10-29`、迁移脚本 | EXPLAIN 无 filesort |
| P2 | 热点实体写合并/串行化提示 | 业务层 | 同实体 C20 P95 下降 |

## 五、副作用与清理

- 本机真实库未被修改业务数据；只读抽检经正常审计中间件新增约 5,277 条 `kq_audit_log`（健康检查不计审计），当前 `kq_user=3`、`kq_resource=116`、`kq_audit_log=16,905`。
- 两个隔离 MySQL 容器（3308/3309）已删除，自建库已 DROP；本次产生的临时副本已清理（`%TEMP%\kunqiong-performance-*` 今天产生的已删除）；无残留被测服务进程；8045 与 3306 正常（`/api/health` 200）。
- 未改动 `package.json`、`.env`、`server` 源码与既有 `docs/PERFORMANCE-*` 历史报告；新增内容仅为 3 个压测脚本、2 份报告、1 份总览与证据目录。

## 六、证据与复现

证据根目录：`docs/performance-evidence/`

- `db-stress/`：results.json（场景/EXPLAIN/表大小/MySQL 状态增量）、run.log、execution.log、mysql-settings.json
- `http-mysql/`：results.json、server.log、db-metrics.jsonl、repeat-runs.json、normal/diagnostic.cpuprofile
- `http-json/`：performance-results.json、report.md（JSON 模式对照基线）
- `live-local/`：results.json（真实实例只读抽检）

```powershell
cd D:\demo\鲲穹文件传输\kunqiong-file-transfer-web-main\kunqiong-file-transfer-web-main
node scripts/performance-db-stress.mjs        # 需自行准备隔离 MySQL（脚本默认 127.0.0.1:3308）
node scripts/performance-load-mysql.mjs       # 需自行准备隔离 MySQL（脚本默认 127.0.0.1:3309）
node scripts/performance-live-check.mjs       # 只读抽检本机 8045 运行实例
```

> 说明：两个压测脚本默认连接本轮使用的隔离容器 3308/3309（容器已清理），复现前请按脚本开头的环境变量说明准备实例；所有测试只应在本机进行，不要指向测试服务器或生产库。

## 七、测量限制

- 数据库层与应用层均使用 **MySQL 8.4.5 容器**（4C/3GiB、buffer pool 128 MiB），本机真实库为 **8.0.41**；表结构一致但优化器/默认参数存在差异，数字不能直接等同生产。
- 应用层压测的临时副本与压测客户端同机，CPU 会与被测服务竞争；上传仅 13 个文件、下载仅 26 次，分位数样本有限。
- JSON 与 MySQL 的跨模式对比只在本机 Windows 有意义；历史 Linux 容器基线差异极大，不能互换。
- 未覆盖：跨机网络、长时间稳定性、500 MiB/5 GiB 大文件、真实 ClamAV 病毒库扫描、多实例共享同一 MySQL、浏览器首屏。
- 结论用于本机容量诊断与缺陷定位，不是生产容量承诺。
