# Issue #37 — admin protocol inventory correction

From: source author. To: trusted publisher → independent SOURCE QA.
Date: 2026-10-15. Status: READY_FOR_REVIEW / UNVERIFIED.

Exact source/base: `91eb14feddea723de52bdbf4cd07f6feebc029bc`, branch `automation/issue-37`; worktree initially clean. Assignment: caller's immutable source-only Issue #37 task, preserved in `ISSUE_37_TASK.json`. This is a bounded correction to the supplied independent QA FAIL, not another product slice.

Supplied independent QA reported that the admin protocol check expected 28 operations while OpenAPI contained 32, failing the contracts gate at the base SHA. `packages/contracts/scripts/check-admin-protocol.mjs` now deliberately inventories 32 operations: the prior 28 plus GET/POST/DELETE `/admin/venues/{id}/cover` and GET `/admin/venues/{id}/cover/access`. Existing per-operation protocol assertions and proof-ceremony checks remain in place. No API, OpenAPI, Web, migration or visual behavior changes; existing STYLE_GUIDE_PARITY and gaps in `ISSUE_37_VENUE_COVER_SOURCE.md` remain applicable.

Checks: NOT_TESTED. Per caller prohibition, the author did not run self-QA, contract checks, tests, lint, typecheck, builds, browser checks or migrations. The supplied FAIL is external evidence, not an author-executed result. No PASS or acceptance is claimed. Full hosted Product CI, independent SOURCE QA, synthetic authenticated DEV UAT including Games covers, release backup/rollback, paired immutable images and root-owned ACCEPTED state remain NOT_TESTED by this author.

Rollback: revert only this correction's script change and handoff; this restores the known inventory mismatch. No schema/data/runtime rollback is required. No commit, push, Git metadata, automation configuration, secrets, services, live data, deployment or PROD was changed.

Next bounded action: trusted publisher publishes the allowed source diff and this handoff, records candidate SHA and exact GitHub permalinks, then independent SOURCE QA runs `node packages/contracts/scripts/check-admin-protocol.mjs` and the required contracts check at that exact SHA. Existing broader acceptance gates remain unchanged. No candidate SHA or durable GitHub publication is fabricated; publication is prohibited for this source author.
