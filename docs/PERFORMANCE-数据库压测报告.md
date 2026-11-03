# 本机数据库层压测报告

执行时间：2026-11-02（Asia/Shanghai）。全部在本机隔离实例完成，未连接、未写入测试服务器，也未触碰本机真实库 `kunqiong_file_transfer`。

## 环境与目标

| 项目 | 值 |
| --- | --- |
| 被测实例 | 独立 Docker 容器 `kq-perf-mysql-db`，127.0.0.1:3308 |
| MySQL 版本 | 8.4.5（生产本机为 8.0.41，见“测量限制”） |
| 容器资源 | 4 CPU / 3 GiB 内存；数据卷为 Docker 本地卷 |
| buffer pool / redo | 128 MiB / 48 MiB（默认配置） |
| 连接与隔离 | `max_connections=151`，REPEATABLE-READ，`innodb_flush_log_at_trx_commit=1`，`sync_binlog=1`，doublewrite ON |
| 压测机 | 本机 Windows，16 逻辑 CPU / 31.6 GiB，Node v24.12.0（mysql2 连接池） |
| 表结构 | 应用真实结构：`docs/数据库设计-2026-10-29/03-现有功能关系表设计.sql`（21 张表）+ 应用启动时补充的 `006` 迁移列/索引（write_version、entity_payload_json、分页索引等）与 `kq_write_lock`、`kq_resource_usage`、`kq_relational_store_state` |

## 数据规模与方法

新建空库后一次性造数（确定性随机，可复现），耗时 19.1 秒，落盘约 270 MiB：

| 表 | 行数 | 大小 MiB |
| --- | ---: | ---: |
| kq_user | 5,022 | 2.03 |
| kq_auth_session | 4,882 | 3.63 |
| kq_resource | 19,958 | 8.70 |
| kq_share_config | 14,554 | 5.75 |
| kq_resource_file | 39,371 | 32.67 |
| kq_resource_usage | 19,617 | 1.83 |
| kq_account_record | 197,368 | 91.77 |
| kq_message | 99,237 | 33.13 |
| kq_audit_log | 197,096 | 90.22 |

每个场景为闭环压测：固定并发 worker 持续发请求直到 10 秒窗口结束，统计包含网络与 SQL 完成的整段耗时；连接池固定 `connectionLimit=5`（与生产默认一致）。指标由 `SHOW GLOBAL STATUS` 前后差值计算，关键读 SQL 另做 `EXPLAIN`。

## 核心结论

1. **读路径健康**：点查、会话鉴权、分享码联查均为 `const` 主键/唯一键查询，P95 3.7–4.6 ms；聚合查询 P95 2.25 ms。128 MiB buffer pool 下命中率 99.7%–100%。
2. **写入是主要瓶颈**：单条审计写入 132 次/秒（P95 18.9 ms），一个 5 条 SQL 的提交事务 70.7 次/秒（P95 36.7 ms）。受 `flush_log_at_trx_commit=1` + 每次事务 fsync 限制，属于本地单实例的预期成本。
3. **同实体并发写有明显行锁排队**：20 并发反复更新同一用户行只有 56.8 次/秒，期间 5,701 次行锁等待，但不报错；说明热点实体应尽量缩短事务、避免把外部 IO 放进事务。
4. **发现一个真实设计缺陷：写锁获取方式会死锁**。应用 `lockWriteScope` 采用 `INSERT IGNORE` 再 `SELECT ... FOR UPDATE` 的写法；20 并发竞争同一个锁 key 时，8,464 次事务里 6,347 次（75%）被 MySQL 判定为 `ER_LOCK_DEADLOCK`，这是共享锁升级为排他锁的经典 S→X 死锁模式。生产代码没有对 `ER_LOCK_DEADLOCK` 的重试或映射（全局错误处理会返回 500“服务器处理失败”）。
5. **连接池是并发上限的放大器**：`connectionLimit=2` + 50 并发时吞吐 345.8 次/秒，排队等待 P95 18.1 ms；`connectionLimit=5` 的混合 OLTP 在 C5/C20/C50 下稳定在 216–226 次/秒，P95 从 6.4 ms 升到 30.1 ms，主要成本是排队而非 SQL 执行。
6. **分页查询存在 filesort**：资源列表、收发记录、站内消息三条分页 SQL 都出现 `Using filesort`，当前数据量下单用户行数少（20–40 行）所以代价小，但数据量增长后会放大。

## 场景结果

| 场景 | 并发 | 操作数 | 成功 | 失败 | 每秒操作 | P50 ms | P95 ms | P99 ms | 每条操作 SQL 数 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 用户主键/唯一键点查 | 20 | 70,356 | 70,356 | 0 | 703.4 | 2.69 | 3.71 | 5.79 | 1.00 |
| 会话鉴权查询 | 20 | 68,048 | 68,048 | 0 | 680.3 | 2.77 | 3.94 | 5.46 | 1.00 |
| 资源列表分页 | 20 | 54,746 | 54,746 | 0 | 547.2 | 3.33 | 5.37 | 8.53 | 1.00 |
| 收发记录游标分页 | 20 | 20,925 | 20,925 | 0 | 209.1 | 9.08 | 13.77 | 18.32 | 2.00 |
| 站内消息游标分页 | 20 | 56,031 | 56,031 | 0 | 560.1 | 3.21 | 5.43 | 7.66 | 1.00 |
| 分享码联查 | 20 | 61,910 | 61,910 | 0 | 618.9 | 3.00 | 4.64 | 6.21 | 1.00 |
| 空间用量聚合 | 10 | 60,601 | 60,601 | 0 | 605.9 | 1.57 | 2.25 | 2.85 | 1.00 |
| 审计写入 | 20 | 13,246 | 13,246 | 0 | 132.3 | 14.73 | 18.92 | 22.52 | 1.00 |
| 写事务：记录+审计+版本号 | 20 | 7,092 | 7,092 | 0 | 70.7 | 27.10 | 36.70 | 44.38 | 5.01 |
| 同实体并发更新（行锁竞争） | 20 | 5,702 | 5,702 | 0 | 56.8 | 34.29 | 40.60 | 52.17 | 1.01 |
| 写锁获取事务（同 key 串行化） | 20 | 8,464 | 2,117 | 6,347 | 84.5 | 23.36 | 27.98 | 32.56 | 4.25 |
| 混合 OLTP | 5 | 21,598 | 21,598 | 0 | 215.9 | 1.00 | 6.42 | 8.17 | 1.50 |
| 混合 OLTP | 20 | 22,298 | 22,298 | 0 | 222.6 | 7.92 | 13.56 | 18.01 | 1.50 |
| 混合 OLTP | 50 | 22,637 | 22,637 | 0 | 225.9 | 20.94 | 30.06 | 39.59 | 1.50 |

“写事务”每事务为：BEGIN → INSERT 收发记录 → INSERT 审计 → UPDATE 用户 write_version → COMMIT，共 5 条 SQL；“写锁获取事务”为 BEGIN → `INSERT IGNORE kq_write_lock` → `SELECT ... FOR UPDATE` → UPDATE → COMMIT。

### 连接池饱和

| 配置 | 并发 | 吞吐 | 排队获取连接 P50 / P95 | 总耗时 P95 | 失败 |
| --- | ---: | ---: | --- | --- | ---: |
| connectionLimit=2 | 50 | 345.8 次/秒 | 13.2 ms / 18.1 ms | 18.8 ms | 0 |

连接池 5 的混合场景在 C50 时 P95 30 ms，仍低于应用自身的获取超时（5 s）与查询超时（15 s）；瓶颈是排队而非超时，因此不会触发 503，但会线性抬高延迟。

### 锁与死锁

| 测试 | 结果 |
| --- | --- |
| 20 并发更新同一用户行 | 5,701 次行锁等待，无失败，P95 40.6 ms |
| 20 并发同 key `INSERT IGNORE` + `SELECT FOR UPDATE` | 6,347 / 8,464 事务死锁（75%），P95 27.98 ms |
| 两事务反序更新两行（死锁注入 20 轮） | 20 / 20 轮均检测到 `ER_LOCK_DEADLOCK`，MySQL 正常回滚牺牲者 |

## 执行计划（EXPLAIN）

| 查询 | 访问方式 | 使用索引 | 额外信息 |
| --- | --- | --- | --- |
| 用户按 legacy_id 点查 | const | uk_user_legacy_id | — |
| 会话按 token_hash 鉴权 | const + const | uk_session_token_hash + PRIMARY | — |
| 资源列表按 owner/kind/status 分页 | ref | idx_resource_owner_kind_status | Using index condition; **Using filesort** |
| 收发记录游标分页 | ref | idx_account_record_user_scope_time | Using index condition; **Using filesort** |
| 站内消息游标分页 | ref | idx_message_user_read_time | Using index; **Using filesort** |
| 分享码联查 | const + const | uk_share_config_code + PRIMARY | — |
| 空间用量聚合 | ref + eq_ref | idx_resource_owner_kind_status + PRIMARY | Using index |
| 审计列表按类型+时间 | index 反向扫描 | idx_audit_time | Using where; Backward index scan |

## 瓶颈与优化建议

按优先级排列，均保留现有权限校验与审计：

1. **P0 修复写锁死锁**：`lockWriteScope` 把 `INSERT IGNORE`（重复行取共享锁）与 `SELECT ... FOR UPDATE`（排他锁）放在同一事务，任何两个同 key 事务都会形成 S→X 升级死锁。建议改为 `INSERT ... ON DUPLICATE KEY UPDATE lock_key = lock_key`（直接取排他锁），或先独立提交确保锁行存在，再在新事务里 `SELECT ... FOR UPDATE`；同时在生产提交路径捕获 `ER_LOCK_DEADLOCK` / `ER_LOCK_WAIT_TIMEOUT`，做有上限的指数退避重试（带随机抖动），失败后返回可重试状态码，而不是落到全局 500。
2. **P1 补齐分页组合索引，消除 filesort**：`kq_resource` 增加 `(owner_user_id, resource_kind, status, deleted_at, gmt_create)`；`kq_account_record` 增加 `(user_id, scope, id)`；复核 `kq_message` 为何未选到 `(user_id, id)`（迁移新增索引已存在但优化器选了带 `read_at` 的旧索引）。索引变更需要新增迁移版本，不要改已应用的 `001`。
3. **P1 给写热点减压**：同实体并发更新只有 56.8 次/秒，且每条操作都产生行锁等待。提交事务内应避免外部 IO 与重复查询，缩短持锁时间；对同一资源的并发操作在前端/接口层做合并或串行化提示。
4. **P2 审计写入批量化**：单条审计 132 次/秒受 fsync 限制。应用本身已按队列批量写入，压测证明单条提交成本高；建议核对批量上限与提交频率，在不丢失高风险审计的前提下合并提交。
5. **P2 连接池按核数调参并观测排队**：默认 5 连接适合单实例；若单机多实例或并发升高，需要按 CPU 核数与 SQL 平均耗时估算池大小，并暴露连接池排队时长，避免出现“无报错但 P95 线性上升”的容量假象。
6. **P3 容量与保留策略**：`kq_account_record`、`kq_audit_log` 各约 90 MiB/20 万行（含 JSON 快照与审计详情）。按保留策略定期清理并监控表增长，避免 buffer pool 被历史数据挤占。

## 测量限制

- 本机隔离实例为 **MySQL 8.4.5**，生产为本机 **8.0.41**；表结构、索引与 InnoDB 行为一致，但优化器版本、默认参数与 8.4 的部分默认值存在差异，数字不能直接等同生产。
- 容器限制 4 CPU / 3 GiB，buffer pool 128 MiB；宿主还有其它压测同时进行（应用层压测在其后独立进行），此处结果相对保守。
- 数据为合成均匀分布，真实业务中热点用户、超大 JSON 快照、团队资源与组织关联会更集中；本测试未覆盖组织/团队成员表、上传会话表、清理队列表的业务查询。
- 客户端与服务端同机回环，未计入跨机网络延迟；未使用真实 ClamAV、未覆盖文件上传下载路径（由应用层压测覆盖）。
- 每场景 10 秒、连接池 5，样本量足够看数量级与瓶颈，不适合作为精确容量承诺。

## 复现

```powershell
cd D:\demo\鲲穹文件传输\kunqiong-file-transfer-web-main\kunqiong-file-transfer-web-main
node scripts/performance-db-stress.mjs
# 可选：PERFORMANCE_DB_STAGE_SECONDS=10 PERFORMANCE_DB_SEED_SCALE=1 PERFORMANCE_DB_KEEP=true
```

脚本自动建库、建表、造数、压测，结束时删除 `kq_perf_stress` 并输出证据。证据文件：

- [results.json](performance-evidence/db-stress/results.json)：全部场景指标、MySQL 状态增量、EXPLAIN、表大小
- [run.log](performance-evidence/db-stress/run.log)、[execution.log](performance-evidence/db-stress/execution.log)：逐阶段执行日志
- [mysql-settings.json](performance-evidence/db-stress/mysql-settings.json)：实例参数快照
