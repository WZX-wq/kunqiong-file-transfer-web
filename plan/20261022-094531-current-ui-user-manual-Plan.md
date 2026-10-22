---
plan_id: 20261022-094531-current-ui-user-manual
title: Current UI User Manual
goal: Update the manual with current UI screenshots and matching instructions and prevent stale regeneration
status: completed
verification_status: verified
owner: main-agent
repo_root: D:/demo/鲲穹文件传输/kunqiong-file-transfer-web-main/kunqiong-file-transfer-web-main
branch: refactor/split-monoliths
base_sha: 0250e71
created: 2026-10-22 09:45
updated: 2026-10-22 12:04
closed: 2026-10-22 12:04
---

# Current UI User Manual

## Scope & Non-Goals

Update the generated manual, screenshot sources, build integration and validation. Preserve product features and all existing worktree edits. No production data changes.

## Acceptance Criteria

- [x] Every illustrated workflow uses current screenshots and matching visible labels
- [x] Include file management, personal center, membership and orders
- [x] Software icon, readable white/blue manual and responsive layout
- [x] Generator is repeatable and build serves identical current content

## Assumptions & Constraints

Use existing generator and installed sharp/jsdom rather than a new documentation framework. Capture only neutral demo data in an isolated localhost server through the supported browser runtime.

## Baseline Tests

Source, dist and HTTP SHA256 all equal 5a41864eac801383926c1323da4977ed131d86753aa009e341bf278387c5fb21. HTTP Cache-Control is no-cache. Generator still contains green colors, 2026-10-13 and obsolete UI labels. Previous product build passed.

## Diagram

Documentation task; no control-flow diagram necessary. Current UI -> named screenshots and reviewed text -> generator -> public -> Vite dist -> HTTP and browser checks.

## Task Checklist

| ID | Task | Owner | Deps | Done |
| --- | --- | --- | --- | --- |
| T1 | Identify stale source and reconcile current UI | main | - | [x] |
| T2 | Capture current workflows in isolated demo | main | T1 | [x] |
| T3 | Rewrite manual and generator with paired text/images | main | T2 | [x] |
| T4 | Add validation/build guard and verify actual served page | main | T3 | [x] |

## Sub-agent Registry

None. All tasks owned by main agent.

## Risks & Rollback

Keep existing user edits. Demo server copies backend into a fresh temp directory and uses synthetic users/files. Never seed the product storage. Preserve screenshot provenance in a manifest so obsolete image replacement fails validation.

## Blockers

None.

## Change Log

| Time | Task | File / Task | Change | By |
| --- | --- | --- | --- | --- |
| 2026-10-22 09:50 | T1 | Source/dist/HTTP/generator | Verified old generated content is actually served, not browser cache | main |
| 2026-10-22 10:40 | T2 | scripts/manual-demo-server.mjs; manual_shots/current | Isolated synthetic data and current screenshots with visible UI text; added repeatable record initialization | main |
| 2026-10-22 10:50 | T3 | docs/user-manual-content.mjs; _build_manual.mjs; public/user-manual.html; manual_shots/current/manifest.json | Rebuilt 16 current-UI chapters with 34 named locked screenshots, readable white/blue layout, software icon and image enlargement | main |
| 2026-10-22 10:50 | T4 | _manual_replace_shots.mjs; package.json; scripts/verify-user-manual.mjs; docs/user-manual-maintenance.md | Unified regeneration, build guard and reproducible maintenance instructions; verification pending | main |
| 2026-10-22 11:08 | T4 | manual_shots/current; docs/user-manual-content.mjs; dist/user-manual.html | Visually rechecked all 34 captures; replaced transition-state upload, file-management and join-request shots; corrected collection preview/settings caption; regenerated, built and checked served output | main |
| 2026-10-22 12:04 | T4 | Orders UI; manual_shots/current; docs/user-manual-content.mjs; scripts/manual-demo-server.mjs | Added provider-linked deletion explanation; refreshed membership and order list/detail/confirmation captures with synthetic demo orders; added configurable demo port; rebuilt and verified 37 screenshots from source, dist and HTTP on ports 8119 and 8045 | main |

## Verification Evidence

`npm run build`: passed; prebuild regenerates and validates 16 sections / 37 named screenshot-text pairs. `node scripts/verify-user-manual.mjs --dist --url=http://localhost:8045/user-manual.html` and the same check on port 8119 both passed with source/dist/HTTP SHA256 `d72cd59808e0481f99b2cd2279b73dbca8bdfdd1a84aede0d577500a787594f8`. Browser captures were visually checked for membership-column height, eligible deletion, provider-linked retention, and confirmation state. `git diff --check`: no whitespace errors (Git printed existing LF-to-CRLF normalization notices).

## Bug & Fix Log

| Time | Symptom | Root cause | Fix | Guard |
| --- | --- | --- | --- | --- |
| 2026-10-22 09:50 | Manual shows old UI | Generator and screenshot directory remained old; alternate replacement script only edited output using temp files by figure order | Unified content module and named locked screenshots; compatibility script delegates to the generator | Build precheck rejects missing/changed images, wrong visible labels, stale output and nondeterministic generation |
| 2026-10-22 11:08 | Several screenshots showed previous page or incomplete content | Screenshot was captured immediately after navigation while the app was still transitioning; a caption also described the split preview backwards | Re-captured stable upload queue, file-management list and join-request page, and fixed the collection page caption | Manually reviewed screenshot contact sheets, labels and target-page DOM before refreshing screenshot hashes |
| 2026-10-22 12:04 | Order deletion looked absent in a canceled order | The order already had a payment-platform number and must remain for reconciliation; the detail showed no reason | Added the reason and matching manual captures for eligible and provider-linked orders | Orders UI assertion plus 37 screenshot/text-pair validation |

## Completion Summary

Updated the current product manual to 16 chapters and 37 labeled, embedded screenshots. Replaced the stale generation path with a named content source, screenshot hash lock, build-time validation and compatibility wrapper. Corrected inaccurate instructions and screenshots, including the unsupported permanent-retention claim. Added up-to-date membership and order deletion screenshots with synthetic data, and verified identical source/dist/HTTP output from localhost:8045. Screenshots use an isolated local demo.

## Next Steps

No remaining work in this plan.
