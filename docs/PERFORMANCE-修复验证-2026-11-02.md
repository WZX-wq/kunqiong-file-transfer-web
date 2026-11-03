# 压测问题修复验证报告（2026-11-02）

针对 [本机压测总览](PERFORMANCE-压测总览-2026-11-02.md) 中的 P0/P1 问题，本轮已完成代码修复、回归测试与同口径复测。全部在本机隔离 MySQL 8.4.5 容器验证，未连接测试服务器或 3306 真实库。

## 一、结论

| 问题 | 修复前 | 修复后 | 判定 |
| --- | --- | --- | --- |
| P0 写锁 S→X 死锁 | 应用层 55 次 `ER_LOCK_DEADLOCK`；数据库层同 key 20 并发 75% 死锁 | 两种压测均 **0 次死锁**；同 key 20 并发 20/20 成功 | ✅ 已修复 |
| P0 假失败语义 | 上传 C4/C8 失败 3/4、7/8；收集 40 人仅 1 次 201、落库 24、39 次失败 | 上传 C4/C8 **0 失败**；收集 **40 次 201、落库 40、0 失败**；`METADATA_WRITE_FAILED` 30→0 | ✅ 已修复 |
| P1 按需 SQL 放大 | 混合读取约 25–26 条 SQL/请求，C30 吞吐 27.4 req/s、P95 2.0 s | 20.8 条 SQL/请求（−19%），C30 中位 48 req/s、P95 0.8–1.5 s；C50 约 50 req/s | ✅ 明显改善 |
| P1 审计保留上限 | 真实库 16,905 行 / 隔离库 6,971 行，写入路径无裁剪 | 新增 `trimToLimit()` + 60 秒维护 + 每 200 条触发；压测结束 5,053 行（≈上限+单批缓冲） | ✅ 已生效 |
| P1 分页 filesort | 资源列表/记录/消息三条 SQL 均 filesort | 资源列表由新索引直接消除；记录/消息应用层 `FORCE INDEX` 固定 `(user_id,id)`，EXPLAIN 对照无 filesort | ✅ 已处理（附优化器限制说明） |

## 二、修复内容

1. **写锁改为直接取排他锁**（`server/db/write-locks.js`）
   `INSERT IGNORE` + `SELECT ... FOR UPDATE` 改为 `INSERT ... ON DUPLICATE KEY UPDATE lock_key = lock_key`，重复键路径直接持有排他行锁，消除共享锁→排他锁升级死锁。
2. **提交有界重试**（`server/db/commit-retry.js`、`server/db/request-store.js`）
   死锁、锁等待超时、`CAPACITY_CHANGED`、`COLLECTION_COUNT_CHANGED` 在事务回滚后自动重试；默认 8 次、指数退避+抖动（上限 80 ms）。重试前释放连接并刷新请求内用量基线（`refreshConflictState`），避免连接池饥饿与重复冲突。`DATABASE_QUERY_TIMEOUT` 等“提交结果未知”错误**不自动重放**。
3. **“已提交但响应失败”按成功返回**（`server/services/shares.js`、`server/routes/upload.js`、`server/lib/metadata-store.js`）
   发布后再校验是否已落库；已落库则返回成功并清除粘性 `persistenceError`（该错误此前会被 `res.json` 包装器改写成 409/503 假失败）。上传完成、分享创建、收集提交均覆盖；通知邮件失败只降级记录。
4. **幂等重放**（`server/services/shares.js`）
   同一 `uploadSessionId` 的分享/收集提交重试直接返回既有结果，不重复发布。
5. **读取放大优化**（`server/db/request-store.js`）
   - 团队/工作区通知由“每成员一次 SELECT”改为窗口函数一次批量取回（`ROW_NUMBER() OVER PARTITION BY user_id`），移除 N+1。
   - 组织图按 org id 记录已加载子图，同一请求内重复调用不再重复查成员/交接/资源。
6. **分页索引与查询固定**（`server/db/pagination-indexes.js`、`server/db/on-demand-schema.js`、`server/db/request-store.js`）
   新增迁移 `007-pagination-indexes`（`idx_resource_owner_page`、`idx_records_scope_page`，消息 `(user_id,id)` 已存在则跳过），串入 `migrateOnDemandSchema`；分页查询对记录/消息固定索引，避免 MySQL 8.4 优化器误选旧索引回退 filesort。
7. **审计保留上限**（`server/lib/audit-store.js`、`server/lib/relational-maintenance.js`、`server/db/request-audit-store.js`）
   `trimToLimit()` 先删最旧 access、再删最旧 critical，分批 `DELETE ... ORDER BY ... LIMIT`；维护任务每 60 秒执行，写入路径每 200 条触发一次，防止持续写入期间长期超限。
8. **可重试语义**（`server.mjs`）
   对 `METADATA_WRITE_FAILED`、`DATABASE_RETRY_EXHAUSTED`、`CAPACITY_CHANGED` 等错误响应附带 `retryable: true`，客户端可据此决定重试；新增环境变量 `KUNQIONG_DB_COMMIT_ATTEMPTS`（默认 8）。

## 三、同口径复测（前后对比）

同一台机器、同样 20 用户 / 201 资源 / 400 记录 / 5000 审计、MySQL 8.4.5 隔离容器、连接池 5；修复前为 `http-mysql-before-fix`，修复后主数据取 `http-mysql-after-final`。

| 场景 | 修复前 req/s | 修复后 req/s | 修复前 P95 | 修复后 P95 | 修复前失败 | 修复后失败 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 健康检查 C50 | 7,282 | 7,780 | 15.7 ms | 12.2 ms | 0 | 0 |
| 前端页面 C50 | 4,005 | 3,268 | 16.0 ms | 21.7 ms | 0 | 0 |
| 业务混合读取 C1 | 23.8 | 26.9 | 94.2 ms | 63.7 ms | 0 | 0 |
| 业务混合读取 C10 | 28.1 | 48.5 | 630.8 ms | 276.7 ms | 0 | 0 |
| 业务混合读取 C30 | 27.4 | 51.6 | 1,997 ms | 744.5 ms | 0 | 0 |
| 业务混合读取 C50 | 29.1 | 49.6 | 3,091 ms | 1,250 ms | 0 | 0 |
| 业务读取持续 C30（30 秒） | 26.3 | 41.0 | 2,154 ms | 1,093 ms | 0 | 0 |
| 16MiB 上传 C1 | 1.08 | 1.78 | 926 ms | 563 ms | 0 | 0 |
| 16MiB 上传 C4 | 2.04 | 2.81 | 1,963 ms | 1,420 ms | 3 | **0** |
| 16MiB 上传 C8 | 2.52 | 3.71 | 3,178 ms | 2,154 ms | 7 | **0** |
| 16MiB 下载 C8 | 17.4 | 18.5 | 525 ms | 619 ms | 0 | 0 |
| 收集任务 40 人提交 C4 | 15.8 | 9.9 | 446 ms | 589 ms | 39 | **0** |
| 诊断对照（关闭审计）C30 | 52.3 | 49.4 | 1,039 ms | 785 ms | 0 | 0 |

可靠性日志对比：

| 事件 | 修复前 | 修复后 |
| --- | ---: | ---: |
| `ER_LOCK_DEADLOCK` | 55 | **0** |
| `ER_LOCK_WAIT_TIMEOUT` | 0 | 0 |
| `METADATA_WRITE_FAILED` | 30 | **0** |
| `CAPACITY_CHANGED`（已自动重试） | 8 | 32（重试后成功，无对外失败） |
| 收集提交非 2xx | 39 | **0** |
| 上传失败（C1/C4/C8） | 0/3/7 | **0/0/0** |

修复后共跑了 3 轮复测，业务混合读取 C30 为 40.9 / 51.6 / 35.8 req/s，持续 C30 为 29.4 / 41.0 / 27.1 req/s，C50 为 49.0 / 49.6 / 52.6 req/s；方向一致，绝对值受本机 Windows 调度与宿主负载影响约 ±25%，不作为精确容量承诺。按需 SQL 稳定在 20.8 条/请求（修复前约 25–26 条）。

## 四、回归测试

全部在本机 3308 隔离实例执行（`KUNQIONG_TEST_DB_PORT=3308`，root 空密码）：

| 命令 | 结果 |
| --- | --- |
| `npm run test:db-concurrency` | 7/7 通过（写锁死锁、重试分类/次数、不可重试立即失败、通知批量查询、分页固定索引） |
| `npm run test:db-retention` | 7/7 通过（审计裁剪 4 项、分页索引 3 项） |
| `npm run test:db-on-demand` | 32/32 通过（含 SQL 事务、并发提交、恢复、审计、备份恢复） |
| `npm run test:db-schema` | 15/15 通过 |
| `npm run test:db-upload-sessions` | 1/1 通过 |

## 五、上线注意

1. 新增迁移 `007-pagination-indexes` 已串入 `migrateOnDemandSchema`；发布时按现有流程执行 `npm run db:on-demand:apply`（或镜像内 `node scripts/db/migrate-on-demand.mjs --apply`）即可补索引与迁移标记，已应用同版本不会重复执行。
2. 提交重试默认 8 次，可通过 `KUNQIONG_DB_COMMIT_ATTEMPTS` 调整（1–10）；重试只覆盖可安全重放的错误，不会自动重放“提交确认丢失”。
3. 记录/消息分页在应用层固定了 `(user_id, id)` 索引（`PAGE_INDEX_HINTS`）；若后续删除或重命名该索引，需要同步更新。
4. 审计裁剪在写入路径每 200 条触发、维护任务每 60 秒兜底，压测结束 5,053 行（上限 5,000 + 单批缓冲）；如需严格等于上限，可调低触发阈值。
5. 修复后仍有 `CAPACITY_CHANGED` 重试日志（32 次/轮），属并发配额校验的预期重试，最终无对外失败；后续可评估把“配额预校验”与“实际写入”合并为单事务进一步减少重试。

## 六、证据

- 修复前：`docs/performance-evidence/http-mysql-before-fix/`（results.json、server.log）
- 修复后：`docs/performance-evidence/http-mysql-after-final/`（主数据）、`http-mysql-after-final2/`（审计裁剪复测）、`http-mysql-after/`、`http-mysql-after2/`（中间轮次）
- JSON 模式基线：`docs/performance-evidence/http-json/`
- 复现：`PERFORMANCE_EVIDENCE_DIR=<dir> PERFORMANCE_REPORT_PATH=<dir>/report.md node scripts/performance-load-mysql.mjs`（需自行准备 3309 隔离 MySQL）
