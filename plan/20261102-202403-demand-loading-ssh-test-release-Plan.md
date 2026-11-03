---
plan_id: 20261102-202403-demand-loading-ssh-test-release
title: demand-loading-ssh-test-release
goal: 部署按需加载与审计保留优化到测试服，并核验运行版本和业务读写
status: completed
verification_status: partial
owner: main-agent
repo_root: D:/demo/鲲穹文件传输/kunqiong-file-transfer-web-main/kunqiong-file-transfer-web-main
branch: deploy/user-file-isolation-20261029
base_sha: df916af1c71cbf8b04ba998b41ee5115b18b5301
created: 2026-11-02 20:24
updated: 2026-11-02 20:48
supersedes: ""
---

# 按需加载优化 SSH 测试服部署

## Scope & Non-Goals

将已验证的按需加载和审计保留工作区版本部署到测试服，显式执行008记录投影并实测关键读写路径。不提交或推送，不运行历史数据转换或备份，不修改既有超时、容器守卫、存储卷和scanner配置。

## Acceptance Criteria

- [x] 运行镜像版本与工作区源清单一致，固定容器名和8045端口保持不变
- [x] 008迁移登记，所有记录列表投影就绪
- [x] 真实登录会话、消息摘要、记录和团队分页及集合CRUD通过
- [x] 响应压缩、请求指标、运行时限和审计保留配置核实
- [x] 测试服应用和scanner健康

## Assumptions & Constraints

SSH目标为43.154.197.96:22。服务器允许运行时隙至2026-11-02 21:20:21 +0800，本次切换时有充分余量。容器名固定为`kunqiong-file-transfer-web`，端口8045；应用查询上限60000ms，连接等待30000ms，MySQL全局执行上限15000ms。scanner配置SHA256保持`38a16f9cc7e87a771f0b55c24f3eaecd5dbf40bbfac21a4dbf93e5181d6bbbef2`。仅用SSH部署，不提交或推送。

## Baseline Tests

| 检查 | 起始状态 |
| --- | --- |
| 本地回归和构建 | 55项SQL/审计/启动/指标测试通过；生产构建通过；导航、认证、团队、消息、会员和订单界面测试通过，证据见上一性能计划 |
| 服务器 | 20:26旧版app和scanner健康，旧镜像`sha256:cba72e973063efce9cbf2a3d1812dfd0751322be28822125343feaac61598ff3` |
| 源状态 | `df916af1c71cbf8b04ba998b41ee5115b18b5301`工作区版本，包含未提交的本任务优化 |

## Diagram

```mermaid
flowchart LR
 A[核对时隙和旧服务] --> B[打包与校验源码]
 B --> C[构建镜像]
 C --> D[单独执行008]
 D --> E[固定容器切换]
 E --> F[线上接口与持久化验收]
```

## Task Checklist

| ID | Task | Owner | Deps | Done |
| --- | --- | --- | --- | --- |
| T1 | 核对时隙、旧镜像和服务器配置 | [main] | - | [x] |
| T2 | 打包、逐文件SHA256核验并构建镜像 | [main] | T1 | [x] |
| T3 | 只执行008增量迁移并核对43条记录投影 | [main] | T2 | [x] |
| T4 | 固定容器名切换、健康检查及回滚保护 | [main] | T3 | [x] |
| T5 | 真实登录会话、分页、消息和CRUD验收 | [main] | T4 | [x] |
| T6 | 审计保留、压缩、运行时限核验并记录结果 | [main] | T5 | [x] |

## Sub-agent Registry

无委派。

## Risks & Rollback

| 风险 | 缓解 | 回滚 |
| --- | --- | --- |
| 公网MySQL连接有间歇性停顿 | 保留60秒应用查询预算并用请求指标记录真实耗时；不承诺外部链路永不超时 | 保留旧镜像标签和原`.env`，切换脚本健康检查失败会恢复旧配置并重建固定容器 |
| 008分页投影未完成 | 新分页检查008标记且逐行回填，总数核验43/43 | 保留新增列和迁移标记；必要时回到旧镜像 |

## Blockers

无。审计调度的完整60分钟间隔未在本次等待实测；清理策略和实际清理SQL已单独验收。公网MySQL仍偶有通用后台维护查询超时。

## Change Log

| Time | Task ID | File / Task | Change | By |
| --- | --- | --- | --- | --- |
| 20:26 | T1 | 测试服配置 | 确认旧容器、scanner、存储卷、运行时隙和数据库版本 | main |
| 20:31 | T2 | SSH发布包 | 294个文件逐一SHA256校验并构建新镜像 | main |
| 20:31 | T3 | 初次迁移 | 长连接超时后停止维护容器并恢复旧app；数据库记录未删除 | main |
| 20:38 | T3 | `008-record-list-projection` | 独立短连接逐行迁移；迁移登记和43/43投影完成 | main |
| 20:40 | T4 | 固定容器切换 | 部署新镜像，保持旧镜像和原配置可回退 | main |
| 20:48 | T5-T6 | 验收记录 | 验证37项业务检查、MySQL CRUD、审计清理、gzip、页面导航和健康状态 | main |

## Verification Evidence

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 发布包与构建 | 294文件校验通过；镜像`sha256:0e52018c30b3d918997db4c63482481e8a0d6819b0265d38f664f7471e5cdbc9`构建成功 | 服务器`releases/demand-9ce0f91f98fd/build.log`；源SHA256 `9ce0f91f98fd9dbe0f4318570d9ef9579ef24c5c5de4ad56b8e1e3e336c54257` |
| 008迁移 | 已登记；43/43投影完整 | 服务器`migration-fresh.log`和`live-crud-result.json` |
| 容器和健康 | 固定名称、8045端口、镜像标签匹配；app/scanner healthy；首页及健康接口200 | 服务器`deploy-final.log`、`health-after-deploy.json`；页面`http://43.154.197.96:8045/` |
| 业务接口与MySQL CRUD | 37项检查通过；新增/修改/删除均由独立SQL核实 | 服务器`demand-live-crud-result.json` |
| 性能与压缩 | 首页gzip；身份/摘要、记录页、团队页、消息摘要返回预期结构；最慢实测更新约28秒，未超过60秒 | `demand-live-crud-result.json`；内部健康接口不带Server-Timing，业务API均带指标 |
| 审计保留 | 测试服配置7/90天和60分钟；过期访问/关键日志清除，近期关键日志保留，测试数据清理 | `demand-audit-fixtures.log`及本次SSH数据库检查 |
| 界面 | 已登录账号从会员页切首页再返回，用户名保持且无需重新登录 | Edge测试服页面可访问性状态 |

验证状态为partial：本次验证了审计策略和真实清理实现，但未等待完整60分钟周期观察自动调度。测试过程中请求在外部MySQL上耗时从毫秒至约28秒不等，服务器还记录通用`DATABASE_QUERY_TIMEOUT`后台维护事件；没有把瞬时成功扩大为未来不超时的保证。

## Bug & Fix Log

| 症状 | 根因 | 处理 | 防护 |
| --- | --- | --- | --- |
| 首次008运行超时且维护进程退出迟缓 | 公网MySQL单次读取超过查询预算 | 自动回退旧app；以短连接、逐行事务续跑后完成 | 迁移锁、逐行写入、完整性计数和可恢复进度 |

## Completion Summary

按需加载版本已部署并通过服务端实际数据验证。005/006/007保持原状，仅新执行008。真实登录视图、列表分页、消息摘要、团队页面和集合CRUD均成功；访问日志压缩和审计清理业务规则得到验证。保留60秒应用预算和15秒MySQL全局限制，没有改变运行时隙或扫描配置。公网MySQL偶发长延迟仍是明确残余风险；审计小时调度未等待满周期，因此验证标为partial。本次未提交或推送。

## Next Steps

继续观察测试服在正常用户流量下的数据库时延与通用后台维护超时；审计保留定时器将在保存的60分钟间隔内运行。
