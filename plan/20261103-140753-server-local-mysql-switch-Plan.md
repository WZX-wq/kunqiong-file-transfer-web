---
plan_id: 20261103-140753-server-local-mysql-switch
title: server-local-mysql-switch
goal: Migrate existing business data excluding audit into test server built-in MySQL, switch app and verify real CRUD and login
status: completed
verification_status: verified
owner: main-agent
repo_root: D:/demo/鲲穹文件传输/kunqiong-file-transfer-web-main/kunqiong-file-transfer-web-main
branch: deploy/user-file-isolation-20261029
base_sha: df916af1c71cbf8b04ba998b41ee5115b18b5301
created: 2026-11-03 14:07
updated: 2026-11-03 14:59
closed: 2026-11-03 14:59
---

# server-local-mysql-switch - Plan

## Scope & Non-Goals
User explicitly selected migration preserving existing users/tasks/files/records. Reuse installed MySQL 8.0.45 and native mysqldump/mysql; no new database container or dependencies. Exclude data from kq_audit_log and kunqiong_audit_log, keep their empty structures. Existing uploads stay in the same named storage volume and encryption key remains unchanged. No commit/push, guard change, unrelated server/database changes, source data deletion or JSON storage fallback.

## Acceptance Criteria
- [x] Existing MySQL is healthy and isolated application schema/account created with scoped access.
- [x] All non-audit business tables migrate with verified row counts and content; audit tables empty before app starts.
- [x] Application fixed name/port and current release remain; only database connection settings change.
- [x] Existing authorized wzx1 account retains 8 records and its collection with 2 submissions; normal OAuth sign-in, real read/create/update/delete and cross-account denial pass.
- [x] Live app and scanner healthy and database query timings substantially below remote baseline.

## Assumptions & Constraints
Current release query-recovery-1edc5bf633d5; app and scanner healthy. Panel slot expires 15:13:55. Local root access available through existing /root/.my.cnf socket credentials; never print credentials. Existing nonproject schemas must remain untouched. Destination schema must be new, not reused or overwritten. Remote source MySQL 5.7.44. Preserve source until validation completes; rollback config if switch fails before writes; after writes avoid split-brain rollback.

## Baseline Tests
Previous recovery tests: backend26 + auth6, MySQL/HTTP28, navigation49, authUI91, demandUI15 passed; production image built and source hashes verified. Remote runtime still intermittently reconnects/timeouts. Source contains 30 tables, about 2MB business data plus excluded audit. Server built-in MySQL8.0.45 active on3306;55GB free. No matching local schema exists. Own task/records read succeeded on recovery release before this task.

## Diagram
```mermaid
flowchart LR
 A[Remote MySQL] --> B[Native transaction dump excluding audit data]
 B --> C[New local schema]
 C --> D[Verify stage]
 D --> E[Stop app and capture full source row hashes]
 E --> F[Sync changed tables and verify exact rows]
 F --> G[Switch environment and start app]
 G --> H[Account and CRUD acceptance]
```

## Task Checklist
| ID | Task | Owner | Deps | Done |
| --- | --- | --- | --- | --- |
| T1 | Inspect local MySQL, source tables and authorization | [main] | - | [x] |
| T2 | Create isolated schema/user; export and stage import | [main] | T1 | [x] |
| T3 | Freeze app writes, final sync and content validation | [main] | T2 | [x] |
| T4 | Switch database connection, verify login/data/CRUD/timings | [main] | T3 | [x] |
| T5 | Record rollout evidence and close plans | [main] | T4 | [x] |

## Sub-agent Registry
No delegation; main owns all tasks.

## Risks & Rollback
Only own new schema may be cleared during repeated imports. Remote source stays untouched. Save root-only rollback environment. Hold app stopped during final snapshot/cutover, restart old config on pre-cutover failure. Scoped user allowed only project Docker subnet; no firewall or global MySQL settings altered. Source and destination counts/content compared with application stopped. Do not roll back writes to stale remote DB after live acceptance starts.

## Blockers
None. User explicitly authorized preservation migration.

## Change Log
| Time | Task ID | File / Task | Change | By |
| --- | --- | --- | --- | --- |
| 2026-11-03 14:09 | T1 | SSH inspection | Confirmed local8.0.45/root socket/available space and30 source tables; destination absent | main |
| 2026-11-03 14:19 | T2 | .runtime/stage-local-mysql.py and server schema | Created dedicated kunqiong_file_transfer schema and subnet-scoped account; container connection61ms; per-table native retrying export active | main |
| 2026-11-03 14:19 | T3/T4 | .runtime/finalize-local-mysql.py and verify-local-mysql.mjs | Prepared guarded write freeze, exact content comparison, connection-only switch and cleanup-scoped CRUD acceptance | main |

| 2026-11-03 14:48 | T3 | frozen snapshot and cutover |28 business tables943 rows exactly match, no changed table sync needed; switched5 environment keys and resumed app after164.83s | main |
| 2026-11-03 14:57 | T4 | real OAuth/browser/API/SQL |wzx1 login,8 records,2 submissions, range download,14 CRUD/dedupe/denial checks21-168ms; temporary task removed | main |
| 2026-11-03 15:00 | T5 | server/local evidence and plan |Archived accepted status, corrected recording-only changedKeys issue, source DB and credentials protected; no app rebuild | main |

## Verification Evidence
Final evidence in /opt/kunqiong-file-transfer-web/releases/local-mysql-20261103-1408: business-verification.json (28 tables943 rows), runtime-verification.json (5 changed DB keys, stable image/volume/key, both healthy, health200), business-acceptance.json (14 real HTTP checks). Safe copies in .runtime/local-mysql-*.json. Final status accepted. inspect-local-mysql.py rerun14:57 passes. Real browser login and original task2 submissions visible; screenshot .runtime/local-mysql-existing-task.png. OAuth callback178-248ms in runtime logs; denial logs match intentional foreign-owner checks. No database timeout observed in acceptance.

Local SELECT VERSION succeeded; installed native clients present. Source table inventory captured without credentials. Source30 tables, exclude2 audit tables data. Container bridge192.168.192.0/20; gateway192.168.192.1. Dedicated target account connection verified61ms. All30 schemas exported,25/28 staged data tables complete. Three larger tables use HEX-safe paged SQL via native mysql; task-only loopback TCP relay MSS1024, no route/firewall changes.32KB transport probe succeeded2.1s; page progress reached160 resource files. Native client compatibility/default config issues corrected. Exact pre-cutover row content validation remains mandatory.

## Bug & Fix Log
Acceptance helper initially assumed legacy715 belonged to wzx1; normal OAuth login proved legacy9. Corrected helper only, with live-session SQL mapping; no identity/ownership data changed. Initial scripted POST used an untrusted loopback Origin and was correctly403; retested via actual configured origin without changing security protections. final-status changedKeys had a local variable shadowing bug; corrected against independently verified5-key environment difference, archived corrected helper without rerunning migration.

| Time | Symptom | Root cause | Fix | Guard |
| --- | --- | --- | --- | --- |
| 2026-11-03 14:09 | Remote database stalls | Cross-server transport intermittently fails even compact queries | Move application database onto existing server MySQL | Full data comparison and real business checks pending |

## Completion Summary
Completed switch to existing server MySQL8.0.45, isolated kunqiong_file_transfer schema and project-subnet-scoped user. All28 business tables/943 rows matched frozen remote source by per-row SHA256.30 table schemas preserved; old audit rows excluded. Application reused original release/image/storage/encryption key; only5 database environment keys changed, pause164.83s. Normal OAuth sign-in with authorized wzx1 confirms SQL user legacy9 and new local session.14 real HTTP business checks passed, including8 existing records,2 historical submissions, old file download, ownership denial, workspace/messages, new collection CRUD and idempotent replay. All measured requests21-168ms from server through configured HTTP origin. Temporary task removed. App/scanner remain healthy. Existing query timeout60000ms retained; long-term availability/load not guaranteed by this short acceptance. Original remote database retained; do not roll back live writes to stale source. No commit/push or unrelated workload changes.

## Next Steps
None for this migration. Continue using server-local MySQL. Future deployments must preserve the updated server environment. No active migration/backup job should be resumed from old plans.

Progress 2026-11-03 14:42:27/28 business export tables completed. Last resource48/58; remote large individual records require4096-byte SQL fragments. Source data not edited; stage only. Final sync compares all row hashes first, refreshes only mismatched destination tables, then compares target against frozen source hash snapshot before switching.

Stage complete14:44:13:30 schemas,28 business data tables,2.47MB SQL. Users14/resources58/files266/records45/orders49. Both audit tables0. Final frozen-source content capture and guarded switch started14:45.
