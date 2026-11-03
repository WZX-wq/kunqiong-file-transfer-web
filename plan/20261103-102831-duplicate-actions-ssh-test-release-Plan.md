---
plan_id: 20261103-102831-duplicate-actions-ssh-test-release
title: duplicate-actions-ssh-test-release
goal: 通过SSH部署防重复操作及文件覆盖修复并核验记录分页和真实业务读写
status: completed
verification_status: partial
owner: main-agent
repo_root: D:/demo/鲲穹文件传输/kunqiong-file-transfer-web-main/kunqiong-file-transfer-web-main
branch: deploy/user-file-isolation-20261029
base_sha: df916af1c71cbf8b04ba998b41ee5115b18b5301
created: 2026-11-03 10:28
updated: 2026-11-03 10:44
supersedes: ""
closed: 2026-11-03 10:44
---

# 防重复操作 SSH 测试服部署

## Scope & Non-Goals

部署已通过本地验证的工作区代码，包含操作禁用、请求合并、任务幂等和文件覆盖确认。保留既有用户数据和配置；不提交推送、不备份或恢复历史转换。

## Acceptance Criteria

- [x] 镜像修订和工作区源码清单匹配
- [x] 固定容器名kunqiong-file-transfer-web、8045端口和scanner配置保持正确
- [x] 008记录投影完整且登录记录分页成功
- [x] 同一请求并发创建只产生一个任务，同名文件检测与覆盖有效
- [x] 新版本和scanner健康，公网可访问

## Assumptions & Constraints

SSH部署已由用户授权。10:28实际运行时隙允许项目至2026-11-03 15:13:55 +0800，切换前再次核实。保留应用查询60000ms、连接等待30000ms和MySQL GLOBAL 15000ms。凭据只在内存使用。验收写入使用可清理的独立测试数据。

## Baseline Tests

| Item | Command | Baseline result |
| --- | --- | --- |
| 前置本地验证 | 见20261103-094311-duplicate-action-prevention计划 | 操作按钮12项、幂等6项、集合139项、覆盖23项、真实MySQL25项及构建通过 |
| 测试服状态 | SSH docker inspect及health/live | app/scanner healthy，旧镜像0e52018c30b3、release demand-9ce0f91f98fd |
| 工作区 | git status --short | 保留既有未提交修改及新增运行模块 |

## Diagram

```mermaid
flowchart LR
 A[核对服务器] --> B[打包校验和构建]
 B --> C[核对008结构]
 C --> D[保留回退后切换]
 D --> E[真实业务与公网验证]
```

## Task Checklist

| ID | Task | Owner | Deps | Done |
| --- | --- | --- | --- | --- |
| T1 | 核实运行时隙和旧配置 | [main] | - | [x] |
| T2 | 打包SHA256清单、上传和构建 | [main] | T1 | [x] |
| T3 | 核对008和记录投影 | [main] | T1 | [x] |
| T4 | 固定容器切换与健康回退 | [main] | T2,T3 | [x] |
| T5 | 分页、任务去重、文件覆盖及持久化验收 | [main] | T4 | [x] |
| T6 | 公网和配置复核并报告 | [main] | T5 | [x] |

## Sub-agent Registry

无委派，主代理顺序执行。

## Risks & Rollback

| Risk | Mitigation | Rollback |
| --- | --- | --- |
| 外部MySQL链路间歇卡顿 | 保留已有查询预算，验收记录真实耗时 | 保留旧镜像标签及原.env，健康检查失败自动回退 |
| 线上测试污染用户数据 | 独立测试身份和标记，finally清理 | 输出清理核验，禁止修改现有任务 |

## Blockers

无。

## Change Log

| Time | Task ID | File / Task | Change | By |
| --- | --- | --- | --- | --- |
| 10:28 | T1 | 服务器状态 | 确认时隙、健康、镜像、卷和配置；不干扰其他备份任务 | main |

| 10:31 | T3 | 008投影 | 服务器45/45投影就绪；无需迁移；global15000/session60000ms | main |
| 10:34 | T2 | 源包 | 298个源码文件SHA256校验通过，镜像构建启动 | main |

| 10:32 | T2 | 新镜像 | 构建成功，manual生成与校验通过；镜像48372819ffb4；切换脚本已启动 | main |

| 10:33 | T4 | 服务切换 | 新镜像健康；固定容器名、端口和revision匹配；扫描器健康 | main |

| 10:39 | T5 | 任务去重验收 | 两个并发请求201/200返回相同token，独立SQL只有一条；键冲突409；空列表断言已纠正；继续剩余验收 | main |

| 10:42 | T5 | 文件覆盖验收 | 真实ClamAV扫描上传成功；重复文件409提示；确认覆盖201；下载新字节且SQL只有一个文件 | main |

| 10:44 | T5-T6 | 收尾 | 业务验收完成；两轮测试数据清理；运行与公网健康、配置和产物复核完成 | main |

## Verification Evidence

| Time | Command | Result | Notes |
| --- | --- | --- | --- |
| 10:28 | SSH health/live及docker inspect | 正常 | 旧release与上次部署一致 |

| 10:35 | 线上源码与产物校验 | 81个运行源码文件SHA256一致 | 前端包含禁用状态、幂等键和覆盖确认 |
| 10:35 | 公网首页及health/live | HTTP200且release匹配 | 新容器和scanner healthy |
| 10:35 | 独立账号登录查询 | HTTP200，40088ms | 外部MySQL历史高延迟仍在，继续验收 |

| 10:44 | 构建及发布 | actions-c63b4de2f333 | 源SHA256 c63b4de2f333e3282d5a5fd00f104d9bb9046290a5fec0d0fc562d56d1ce0e34；镜像48372819ffb4471f22f7b75e3db1bb374e09497dfa2f0cf79ddf741601f6fbe0 |
| 10:44 | 真实任务幂等 | 两个请求201/200指向同一任务；独立SQL一条；重放200、不同内容409 | releases/actions-c63b4de2f333/live-check.log；临时脚本的空列表假设失败已纠正，无产品回归 |
| 10:44 | 文件覆盖及CRUD | 更新、扫描上传、确认覆盖、下载新内容、删除均通过；SQL持久化一致 | overwrite-check-result.json中ok=true，无待清理数据 |
| 10:44 | 数据库及配置 | 45/45记录投影；GLOBAL15000、session60000ms；.env仅release改变 | scanner SHA256保持38a16f9cc7e87a771f0b55c24f3eaecd5dbf40bbfac21a4dbf93e5181d6bbef2 |
| 10:44 | 公网静态资源 | 首页和入口JS200，JS与容器SHA256一致 | index-Cov7EjIY.js；14089d84a328626e2e00938040966c676d261796388992ea11041d0a7bcfad86 |
| 10:44 | 最终健康与清理 | app/scanner healthy，health和health/live ready | 两轮独立测试账号与任务均删除，容器内临时助手已移除 |
| 10:44 | 现有账号会话检查 | 跳过wzx12既有会话分页检查，因无有效会话 | 已用独立登录账号验证分页；其余真实SQL与文件验证通过，标记partial |

## Bug & Fix Log

| Time | Symptom | Root cause | Fix | Guard |
| --- | --- | --- | --- | --- |
| 10:39 | 验收脚本对空记录列表断言失败 | 创建任务API不自动写客户端个人记录，独立新账号允许为空 | 临时验收脚本改为校验分页结构与上限 | 去重已通过不重复测试；前轮测试账号与任务均已清理 |

## Completion Summary

SSH部署完成，版本df916af1c71cbf8b04ba998b41ee5115b18b5301-actions-c63b4de2f333。防重复创建、内容冲突、同名文件提示及确认覆盖均由真实API和独立SQL验证；新字节下载一致。保留固定容器名、8045端口、存储卷、扫描器和既有查询预算。所有测试身份和资源已清理，未提交推送。验证为partial仅因既有wzx12登录会话已失效，未伪造该账号登录；独立账号登录与记录分页正常。数据库连接仍偶发重连/延迟：第一轮创建约93至98秒，第二轮约8秒；这次部署不代表外部链路延迟已消除。完整证据保存在服务器本release目录和本地.runtime/actions-deploy-evidence.json。

## Next Steps

已完成部署；用户可在http://43.154.197.96:8045/刷新后验收。若核验原账号个性化记录，需用户重新登录获得有效会话。
