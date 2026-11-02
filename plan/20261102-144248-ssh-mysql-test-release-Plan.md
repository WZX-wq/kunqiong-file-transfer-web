---
plan_id: 20261102-144248-ssh-mysql-test-release
title: SSH MySQL test release
goal: Optimize SQL queries and login state, deploy latest working copy by SSH, verify live CRUD with a 60000 ms client deadline; backup and historical conversion cancelled
status: completed
verification_status: verified
owner: main-agent
repo_root: D:/demo/鲲穹文件传输/kunqiong-file-transfer-web-main/kunqiong-file-transfer-web-main
branch: deploy/user-file-isolation-20261029
base_sha: a27ffc32cac606688f2f8a62f3e978fd5cc6d74b
created: 2026-11-02 14:42
updated: 2026-11-02 18:46
closed: 2026-11-02 18:46
---

# SSH MySQL test release

## Scope & Non-Goals
Latest user instructions: stop backups and historical conversion; fix all affected SQL reads and login state; deploy the latest reviewed working copy through SSH and exercise live CRUD. User now permits a moderate timeout increase: client query/transaction acknowledgement deadline 60000 ms; set application SQL session cap to 60000 ms while preserving GLOBAL at 15000 ms. No Git commit/push. Existing mysql2 library is the open-source implementation base.

## Acceptance Criteria
- [x] Backup/conversion workers stopped; heartbeat deleted; source data preserved.
- [x] Request-scoped reads, version-checked bounded cache, MySQL 5.7 message query and login-state recovery implemented.
- [x] Client defaults/deploy/manifest updated to 60000 ms with 30000 ms acquisition budget.
- [x] SQL regression and workspace UI retry checked; production build passes.
- [x] Latest working-copy manifest verified remotely, required indexes present, fixed-name app deployed.
- [x] Actual authenticated test-server reads and isolated create/update/delete pass with timings.

## Assumptions & Constraints
Use the existing mysql2 implementation and Docker/Compose deployment. User explicitly requested SSH, superseding the older Gitea-only deployment preference for this release. Preserve container name kunqiong-file-transfer-web, port 8045, scanner and existing volumes/configuration. Preserve automatic container stop policy; do not maintain or reopen a runtime slot. Use the previously authorized SSH login, never print credentials. Keep unrelated workspace changes and do not upload .runtime, .env, storage or node_modules.

2026-11-02 16:20 user explicitly permits starting containers; panel configuration independently includes kunqiong-file-transfer-web with expiry 21:20:21 +0800. Start within that existing slot and do not extend or alter it. Do not stop/recreate the healthy new application for remaining background maintenance.

## Baseline Tests
Previous MySQL/startup tests: 32 passed; existing storage tests: 48 passed; feature regressions/build passed. Local database upgraded with application-table backup during the authorized local restart. SSH inventory: target app/scanner containers absent, existing test image revision ends in http-first-20261102, storage volumes and /opt configuration present. No service listening on 8045 before deployment.

## Diagram
```mermaid
flowchart LR
  Fix[Bounded SQL reads and login state] --> Test[SQL and UI regression]
  Test --> Bundle[Reviewed source and hash manifest]
  Bundle --> Build[SSH image build]
  Build --> Index[Only additive pagination indexes if required]
  Index --> Deploy[Fixed-name Compose app]
  Deploy --> CRUD[Authenticated live CRUD and timings]
```

## Task Checklist
- [x] T1 [main] Reconcile local/remote state and cancel obsolete workers (deps: none)
- [x] T2 [main] Optimize reads and repair UI auth state (deps: T1)
- [x] T3 [main] Adjust bounded client/connection deadlines as authorized (deps: T2)
- [x] T4 [main] SQL tests, UI recovery and production build (deps: T3)
- [x] T5 [main] Review/package/build latest working copy and deploy by SSH; align queue default in final image (deps: T4)
- [x] T6 [main] Live authenticated CRUD and release/config checks (deps: T5)
- [x] T7 [main] Record evidence and cleanup own local fixture (deps: T6)

## Sub-agent Registry
No delegated work; main agent owns this release.

## Risks & Rollback
Environment/key, existing volumes and previous images are preserved. No backup or historical conversion is running, per the user's cancellation. The current release only adds bounded reads/cache/recovery and the independently applied pagination indexes; original audit rows remain untouched. Earlier schema changes are not undone by an image rollback. Public MySQL responses still exhibit intermittent transport/server-response stalls; passing a finite CRUD run is not a guarantee that future requests can never time out. Existing stop policy may stop installed containers after the panel slot; do not bypass it.

## Blockers
No deployment blocker remains. The final live run passes, but earlier failures and the constant-result probe demonstrate residual intermittent public MySQL stalls. Recovery is bounded and never returns stale data or replays an uncertain commit. Do not claim guaranteed absence of future timeouts.

## Change Log
- 2026-11-02 18:46: Final query60-9b339a10c526 live run passed all 25 checks, 18:42:37–18:44:37 +0800. Create 201 / 6.221 s; read 200 / 3.108 s; update 200 / 7.078 s; reread 200 / 2.594 s; delete 200 / 13.577 s. Direct MySQL checks confirm create/update/delete; unique test resource is absent. Auth/workspace/records/messages/trash/team summary and three repeated auth/records/workspace rounds all succeeded (maximum HTTP duration in this run 16.960 s). An earlier same-release auth read timed out; preserved separately rather than discarded. Runtime and SQL checks confirm client/session 60000 ms, acquire 30000 ms, GLOBAL unchanged at 15000 ms. Public homepage and live health return 200 with exact revision; app/scanner healthy, scanner LF checksum unchanged. All 286 deployed source hashes still match the latest working copy. Dedicated test MySQL PID 36168 / port 33429 gracefully shut down after checking its executable/datadir; normal local project left running.
- 2026-11-02 18:40: Deployed query60-9b339a10c526, image sha256:cba72e973063efce9cbf2a3d1812dfd0751322be28822125343feaac61598ff3. Archive SHA256 dbf94adcea78e113591bdeffbda68c90fdc21b5398999592780353ada44f1d7f; all 286 source inputs verified. New bounded transaction recovery destroys a failed connection and retries the entire uncommitted transaction once only before COMMIT is sent. Lost COMMIT acknowledgements remain uncertain and are never replayed. Regression 40/40, including actual InnoDB rollback of a temporary write and commit-acknowledgement loss with exactly one persisted version increment. Full image build/manual verification passed. Fixed app name/8045 and scanner retained. Live CRUD restarted; acceptance still pending.
- 2026-11-02 18:37: query60-49ebc45c2e33 reduced cold order reads to two rows per batch and excluded unused entitlement_json; 26/26 cache/integration tests passed. Live first workspace succeeded in 4.812 s, auth 1.862 s; records/messages/trash/team overview all 200. Create (17.065 s), read (15.621 s), update (24.654 s), reread (7.751 s) succeeded and were independently checked in MySQL. Delete failed while reading kq_collection_task inside its transaction; finally cleanup succeeded in 15.254 s, no fixture remained. An earlier run failed during two handshakes. Do not record either run as a full pass. A read-only 12-query protocol probe reproduced a 15.608-second delay returning a one-byte constant, with TCP retransmission/out-of-order evidence; no data values/credentials captured.
- 2026-11-02 18:10: Previous candidate update failed during transaction (DATABASE_QUERY_TIMEOUT), then its finally cleanup successfully deleted the unique test task; no write remains in flight. Maintenance also returned ER_QUERY_TIMEOUT under GLOBAL 15000 ms, so applications now initialize each MySQL connection with session max_execution_time matching the authorized 60000-ms client setting while leaving GLOBAL unchanged. Integration/pool tests 37/37 passed. Latest source query60-961d34e0b3a8, archive SHA256 1e88f9a090e62b29634e410aede76a91ad1969d786337ac98a633f731a22697a; verified all 286 source hashes. Notification-id and version-cache changes included. Do not confuse previously built intermediate candidates with the final running revision.
- 2026-11-02 18:07: Found workspace notification loader bypassed select() and still returned full recent-message unions. Changed it to union only ids, then fetch through the version-validated/batched message path. MySQL 5.7 compatibility and per-owner bounds retained. Isolation integration/concurrency/cache tests 33/33; cold small payloads remain batched, repeated 20-account notification read now verifies versions in <=5 queries. Added sanitized terminal-query diagnostics (table/projection/code only; no SQL values). Source query60-c4d15a8ae88a archive SHA256 79dee53acbecd8ddc0ce4009f463c7ffdc500dd45426871d43ddfc4cf9d77d07, 286 inputs verified; building. Prior candidate CRUD continues until its test fixture is deleted; do not interrupt a write.
- 2026-11-02 18:02: Live SQL collection CRUD passed and exact test resource was removed: create 56.995 s, read 46.536 s, update 12.496 s, read-updated 31.511 s, delete 24.264 s. Independent SQL confirms create/update/delete. Auth, records, messages, trash and team overview also returned 200. Workspace still had a 60-second read failure, so acceptance remains incomplete. Measured payload sizes: 18 orders ~50 KiB total; current user 505 bytes/session 1081 bytes; message individual ~500 bytes. Extended bounded version cache to orders/messages (512 rows, 8 MiB), cold batches ~32 KiB; preserved predicates/pagination and no stale fallback. SQL regression 54/54. Capped first read attempt at 5 seconds even with larger total budget to recover sooner; read-recovery regression 7/7. Latest candidate query60-14bb0bfef149 is building; do not mark full acceptance before live verification.
- 2026-11-02 17:57: Further live auth check failed in handshake with ETIMEDOUT before SQL. Added one acquisition-handshake retry inside its existing deadline; transaction statements are never replayed. Targeted pool tests 12/12 include authentication errors not retried and leased connection recovery before first SQL. Final reviewed bundle query60-faea624e2f6c: archive SHA256 b7c356887c9159a2b27bd832c6edbd015efddc3c600b4f3db742d303598887fe, all 286 hashes match; image 8de262f823cf. Client query 60000 ms and acquisition 30000 ms, database server cap unchanged. Deployed within restored panel slot; complete CRUD run is active.
- 2026-11-02 17:54: Query30 image 5ad43065c088 deployed; 286 manifest hashes match. Independently applied only additive 007 pagination indexes, verified 006 indexes already exist; no backfill. SQL regressions 52/52, workspace UI 331 assertions, build/manual verification pass. Live auth/workspace/records read succeeded but message read timed out; traced equivalent SQL to 6.0 s total with only 4.4 s for 10 messages, showing intermittent transport variance. Raised acquire budget from 5 to 15 seconds after cold-connect DATABASE_QUEUE_TIMEOUT; local pool regression 10/10. At 17:49 panel removed project and stopped app/scanner (non-OOM); did not bypass. User restored panel slot and app/scanner are healthy again at 17:53. Full live CRUD restarted.
- 2026-11-02 17:44: OAuth succeeded for wzx12; subsequent workspace read failure reproduced. Removed redundant profile/account data loads, added bounded version-checked user/org cache with small-row batching, changed message union to MySQL 5.7 syntax. UI retains authenticated user across workspace 503 and retries successfully. SQL suite initially exposed cold-cache N+1 (23 queries); batching corrected it and the regression now passes. 30-second client limit authorized; no GLOBAL SQL cap change. Prior backup/migration history below is superseded and retained only as a work record.
- 2026-11-02 16:53 T6: Login/callback no longer load the current session; callback account load excludes orders/settings/usage. Added sanitized callback failure stages. Isolated MySQL regression: 24/24 including fresh OAuth account/session, revocation and restart; standalone auth suite passes. Initial extra assertion expected null for replaced session, corrected to the existing HTTP 401 contract. Unrelated workspace changes preserved.
- 2026-11-02 14:42 T1: Confirmed query timeout; authenticated SSH and inventoried only the target app/configuration/storage.
- 2026-11-02 14:46 T2: Set query defaults to 15000 in bounded pool, state and deployment script; updated docs and excluded .runtime from Git/build contexts to protect local backups.

- 2026-11-02 14:52 T2/T3: Nine targeted tests, shell syntax and full npm production build passed (manual generation/verification included). Uploaded 8,150,322-byte reviewed bundle; archive SHA256 32d2e8989acbc455560062a73ddd1d52a26cd8bf0d5d83f4f9469904c78f5fe2 and all 281 input hashes matched on server. Release a27ffc32cac606688f2f8a62f3e978fd5cc6d74b-mysql15-7ad6203b2c17. Existing slot is allocated to other projects; selected configuration-only installation and left policy unchanged.

## Verification Evidence
Final evidence: `.runtime/query60-release-evidence/runtime.json`, `live-crud-result.json`, and `first-run-failure.log`. Remote evidence lives under `/opt/kunqiong-file-transfer-web/releases/query60-9b339a10c526/`. All recorded evidence excludes cookies, SQL parameters and credentials.

Commands: `node --test scripts/db/concurrency-safety.test.mjs scripts/db/read-reconnect.test.mjs scripts/db/request-store.integration.test.mjs` against explicit isolated port 33429 (40/40); earlier full SQL regression 55/55 and cache/order integration 26/26; `node scripts/verify-team-ui.mjs` production-bundle recovery checks (331 assertions, no failures). Build command `DOCKER_BUILDKIT=1 docker build --label org.opencontainers.image.revision=<release> -t kunqiong-file-transfer-web:query60-9b339a10c526 .` exited 0 and runs `npm run build` including manual generation/verification. Live command `docker exec kunqiong-file-transfer-web node live-crud.mjs` exited 0 with `ok=true`, 25 checks, `cleanupPending=false` and exact release. Independent public `Invoke-WebRequest` homepage and `/api/health/live` returned 200. Browser refresh displayed authenticated wzx12, capacity and team details; the final backend-only transaction change retained the same frontend bundle.

Change summary: route-specific SQL loading, MySQL 5.7 notification query, version-checked bounded row cache, safe read/handshake recovery, one pre-COMMIT transaction recovery, workspace auth-state/error retry, and matching timeout/deployment defaults. No commit/push. Pre-existing public database stalls remain a documented operational risk; the final successful run does not erase the first-run failure.

The following paragraphs are historical evidence from the superseded backup/conversion work and earlier 15-second release:

Nine targeted database/startup tests passed; default driver query timeout was verified as 15000 ms; full production build, manual verification, shell syntax and diff whitespace checks passed. Remote release task is running; final SQL backup/migration and image/configuration verification remain pending.

Remote image built with revision a27ffc32cac606688f2f8a62f3e978fd5cc6d74b-mysql15-9fdbc35ba663; native build and manual verification passed. Operation-only maintenance adapters use mysql2 protocol compression, per-transaction fresh connections, scoped advisory-lock holders and single-row migration pages to tolerate the slow public database route. No runtime application source is modified by these adapters. The normal application and global query limit remain 15000 ms. Migration 005 completed; migration 006 has converted users/organizations and continues through resources and remaining business entities.

2026-11-02 16:13: Installed current Compose/environment and created the fixed-name app/scanner containers without starting them. verify_container_configuration passed, and configuration-install-status.json records exitCode 0. App/scanner were subsequently absent before the independent inspect; do not repeatedly recreate them or claim a running service. At 16:16 independently verified saved Compose/environment and image revision. Image ID sha256:371804be11a54a9ff2840374005f35b4d0383eca7f6e458c314c64ff762402e6b. Remote configuration-verification.json records release, query timeout 15000, fixed name and installation proof.

The remaining migration runs in the background under direct-install.mjs. Host-only migration-tcp-bridge.py uses TCP_MAXSEG 512; Docker maintenance uses host networking solely to reach that loopback SQL bridge and opens no application port. migration-progress.json is mounted as an operational checkpoint and records only the prior completed entity cursor. No application source changes are made by these adapters. start-background-after-install.sh waits for successful migration status, then starts the audit-excluding consistent business snapshot. Remote background-backup-status.json is authoritative for its final result, not a partial .gz.

Created a 5-minute thread heartbeat named 测试服业务转换与备份, automation ID automation, to complete/check the requested background work. It stays quiet without meaningful change and must pause after validated success. It must not start services, alter runtime slots, submit Git changes or copy audit logs.

2026-11-02 16:25: User explicitly allowed containers and the panel slot was already open. Scanner initially failed with Incorrect argument format for option Foreground because deployment/clamd.conf contained 30 CRLF lines. Normalized its content to LF, added .gitattributes LF policy locally and normalized .conf during future SSH packaging. Runtime config SHA256 38a16f9cc7e87a771f0b55c24f3eaecd5dbf40bbfac21a4dbf93e5181d6bbbef2 is recorded separately from the image/source manifest. Scanner became healthy. A created app disappeared while waiting for scanner; re-created and started app once after scanner was healthy. Both containers healthy, server and independent public requests returned HTTP 200 for homepage and /api/health, ready=true and expected release. runtime-verification.json confirms running image and 15000-ms query setting.

The audit-excluding business backup started independently after runtime allowance, but its first attempt lost the database connection while reading kq_collection_submission (MySQL 2013). Its temporary session and TCP helpers exited; partial output is not a valid backup. Started retry-business-backup.sh with a flock and at most three attempts, logging background-backup-retry.log. The heartbeat prompt now tracks this runtime allowance, preserves the healthy application and excludes audit. deploy-before-background-backup.sh no longer recreates Compose after normalization; it only completes the maintenance command. Migration 006 remains pending, and backup should complete before further DDL/normalization work.

## Bug & Fix Log
- 2026-11-02 16:37: All three retries in background-backup-retry.log finished unsuccessfully by 16:34. Final sanitized diagnostic: lost connection (2013) during SHOW TABLE STATUS for kq_account_record. All helper sessions exited. Switched only native dump transport to zlib protocol compression through the already-tested compressed session adapter, retaining its loopback binding, 120-second idle bound, native consistent transaction and audit exclusions. Started single attempt PID 2925047, log background-backup-compressed.log. No application/configuration restart or persistent timeout change.
- 2026-11-02 14:54: First SSH source bundle omitted the root server.mjs entry. Docker COPY failed before database preflight, backup or migration. Corrected the packaging list, also included deployment/clamd.conf required by the deployment script, and verified these inputs explicitly before retrying.
- 2026-11-02 14:57: Uploaded corrected release a27ffc32cac606688f2f8a62f3e978fd5cc6d74b-mysql15-9fdbc35ba663. Compressed archive SHA256 a292e47382f14e67b7971c951a57f63fb23e48c00b182dc2f27f781138608bf4; all 283 source hashes verified on the server. Worker 2589849 is building the corrected image. Previous image/config/key backup is retained.
- 2026-11-02 15:20: Image 371804be11a5 built successfully and unchanged-schema preflight passed. MariaDB dump stalled and native MySQL dump identified error 3024 on audit rows. Host MySQL 8 requires isolated client defaults and SSL matching the existing configuration. Temporary session-only adapter was tested end to end: backup session 1800000 ms, global 15000 ms. Native consistent snapshot backup worker 2659806 is running on the host; its raised session is closed automatically at completion. No application service or runtime slot was started.
- 2026-11-02 15:43: User requested latest deployment immediately with full SQL backup in the background. Stopped the incomplete native dump and old backup-gated installer. The unchanged 50-row migration read exceeded 15 seconds; a deployment-only adapter uses single-row migration pages and an isolated 300000-ms maintenance deadline. App settings and GLOBAL max_execution_time remain 15000 ms. Migration is now progressing; the background snapshot helper is prepared with a longer isolated backup session, native consistent transaction, gzip/hash verification and automatic connection shutdown.
- 2026-11-02 15:54: User excludes unused audit logs; background business dump now ignores both audit tables without deleting source rows. Public connections occasionally stop returning results even for small operations; maintenance mysql2 pool uses protocol compression. Confirmed 54 of 56 resource-usage rows committed, then completed the last two with an operation-only checkpoint filter while writers remain stopped. Migration 006 has advanced through additive columns/indexes into normalized business entities. The backup helper records its explicit business-without-audit scope.

## Completion Summary
Implemented and SSH-deployed query60-9b339a10c526 to fixed container kunqiong-file-transfer-web on 8045. Final live CRUD and repeated reads passed all 25 checks, with independent SQL persistence checks and no test fixtures left. Regression/build/UI checks pass; app/scanner healthy and exact source/runtime revisions match. Client/session query limit is 60000 ms; GLOBAL remains 15000 ms. Residual public MySQL response stalls were observed in earlier runs, so perpetual absence of timeouts is not promised. Backup/historical conversion and heartbeat remain cancelled; no Git submission/push was performed. Earlier maintenance evidence is retained only as history.

## Next Steps
No remaining release tasks. If public MySQL timeouts recur, use the saved failure/packet timing evidence for database endpoint or network diagnostics; do not silently increase timeouts indefinitely, restore cancelled workers or bypass the panel slot.
