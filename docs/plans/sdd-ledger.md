# SDD ledger - plan: docs/plans/2026-10-20-kunqiong-full-ui-implementation.md

## Setup
- Branch refactor/split-monoliths, HEAD at setup: dabe885.
- Existing uncommitted work preserved and committed as-is: PlanCarousel in workspace-page.jsx (89d2f48, 2a4f8b3), prototype file type icons (24d02aa).
- Prototype source: C:/Users/admin/WorkBuddy/2026-10-20-09-32-04/kunqiong-full (58 screens; 57 mapped, email preview excluded by user rule).

## Task conflict scan
- workspace.jsx touched only by ui_send_collect (send/collect/messages/nav). records.jsx only by ui_records. public.jsx only by ui_public. settings.jsx+orders.jsx only by ui_settings. team.jsx+AdminPage.jsx+workspace-page.jsx only by ui_team_admin.
- Shared layer (prototype-ui.jsx, prototype-ui.css, app-*.css entry) committed before dispatch so agents share tokens without editing shared files.
- Conflict: workspace-page.jsx already has user's PlanCarousel change - ui_team_admin must preserve it verbatim.
- Conflict: existing UI verify scripts assert class names - ruled: agents adapt JSX, never the scripts.

## Rulings
- Ruling: global green brand stays for product logo/brand mark; prototype blue used as page accent only.
- Ruling: help/terms/privacy keep existing footer entries; no new entries; email screen excluded - explicit user constraints.
- Ruling: baseline test failures carried, not regressions: AUTH-011 pagination shows eight records; acceptance NFR when run in parallel.

## Progress
- Task 1 complete: 58 prototype IDs mapped (57 included, email excluded), product-only paths and capabilities catalogued. Existing tracked change is an unrelated binary DOCX and remains untouched; prototype assets and plan files remain user workspace content.
- Baseline: build passes. Previously recorded `test:upload`, `test:collections`, `test:orders`, `test:messages`, `test:team` pass; `test:auth` retains AUTH-011 pagination assertion. Serial `test:acceptance` passes payment/admin/admin-plan suites; NFR smoke retains NFR-007 token fixture error, NFR-005 5GB boundary, NFR-011 oversized-input stack and NFR-012 rate-limit recovery failures. Details are in the coverage matrix.
- Task 2 partial: shared visual skeleton exists (`prototype-ui.css/jsx`, `app-*.css` entries in `styles.css`), and the base build passes. Existing assets include the logo, hero art and prototype icons. Domain CSS files are placeholders; route components still need visual migration. Commits: 89d2f48 + 2a4f8b3.
- Prior UI-domain agent work was interrupted before implementation. Continue serially in the current checkout, preserving the existing plan carousel, prototype assets, and all user changes.
