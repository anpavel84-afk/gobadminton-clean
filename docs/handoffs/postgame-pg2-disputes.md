# Issue #372 / PG-2 Dispute response + scoped case resolution — Mode A author handoff

From: Cursor Auto (`OWNER_APPROVED_PG2_RESPONSE_CORRECTION_SCOPED_CASE_RESOLUTION`, attempt 6, base `ff8d883a8a8ad384b07010ddd5c63acdc86c1b40`).
To: one independent Codex Sol Medium QA → mandatory Product CI → trusted DEV release/smoke.
Status: SOURCE CANDIDATE repair of **0047 revision snapshot/reason guard regression** / pass-5 OID-binding fix **preserved** / prior business-logic sourceQA **PASS** preserved / **UAT=NOT_TESTED** / PG-2 source default **OFF**, **NOT_INSTALLED / NOT_QUALIFIED** on runtime / **NOT READY** / no DEV claim for PG-2.
Parent #372 PG-2 slice only. PG-3/PG-4 not done. Mode B binding NOT claimed. Author checks ≠ independent QA.
Existing PR #441. App **0.1.0-alpha.4** / API **0.22.0** unchanged (same unreleased candidate; no bump; no new PR).

## Runtime / flag accuracy (do not mis-state)

- Live DEV **PG-1b** flag is already **ON** (do not claim the whole post-game runtime is OFF).
- **PG-2** source remains default **OFF**, **NOT_INSTALLED / NOT_QUALIFIED** until trusted install + qualification. Not full-parent DONE. PROD forbidden.

## Root cause (PMA catalog proof after 0047)

Own isolated catalog after 0047: `revision_snapshot_guard_present=false` (evidence `revision-guard-proof.json`, sha256 `324a32ef15d0b22d11e510cf45c74d5146f270fcf62af3104c7ec5fccade4695`).
Unreleased `0047` blindly `DROP CONSTRAINT IF EXISTS game_attendance_revisions_check/check1/check2` before the OID-targeted `after_late` scan. Applied 0046 has a second anonymous CHECK: `resource_version=1` ⇒ all before-snapshot fields NULL; `version>1` ⇒ `before_value`/`before_late`/`reason` NOT NULL. Those auto-names covered the snapshot/reason guard; 0047 dropped it and never restored. Versioned unknown / `case_reviewer` expansion does **not** require dropping that guard. Pass-5 OID binding for dual-schema apply remains required and is preserved.

## Pass-6 repair (0047 stop dropping unrelated unnamed checks)

1. `apps/api/migrations/0047_attendance_dispute_resolution.sql` — removed blanket drops of `game_attendance_revisions_check` / `check1` / `check2`. Late constraint replacement remains OID + `after_late` def only; 0046 snapshot/reason guard preserved exactly. Pass-5 `conrelid`/`tgrelid` OID binding unchanged. No 0042/0046 edits; no always-true / loosened guard.
2. `apps/api/migrations/rollback/0047_attendance_dispute_resolution.sql` — inspected; forward path leaves original unnamed snapshot guard populated; rollback re-adds only the late check as `game_attendance_revisions_check` and does not touch the surviving snapshot guard — **unchanged**.
3. `apps/api/test/integration/migration.smoke.test.ts` — existing dual-schema assertions kept; added catalog assertions that the snapshot/reason CHECK exists on exact `public` and `side` relation OIDs via `pg_get_constraintdef` (not global conname / SQL text alone).
4. `apps/api/test/integration/game-attendance-disputes.disposable.test.ts` — one real 23514 negative: valid FK/context, unused `resource_version>1`, null before-snapshot fields and null reason (avoids 23505 masking).
5. This handoff.

## Checks (author, pass-6)

- `@gobadminton/api` typecheck (`tsc -p tsconfig.json --noEmit`) — PASS
- eslint `migration.smoke.test.ts` + `game-attendance-disputes.disposable.test.ts` — PASS
- Disposable PostGIS migration + PG-2 writes — **DB NOT RUN** (no disposable DATABASE_URL / author has no live DB/root). Trusted operator must re-run `migration.smoke.test.ts` + `game-attendance-disputes.disposable.test.ts` after freeze.
- Unchanged controller/client/auth/role/business source — **reused**, prior sourceQA acceptance.
- Browser / Product CI / DEV — outstanding trusted process.

## Unresolved technical gates

- Independent QA of this snapshot-guard preservation + non-regression of pass-5 OID binding and already-accepted business paths.
- Trusted operator: migration.smoke + PG-2 disposable writes on disposable PostGIS.
- Product CI + trusted DEV deploy/smoke for PG-2.
- Owner UAT = NOT_TESTED.
- PG-2 runtime remains NOT_INSTALLED / NOT_QUALIFIED; PROD forbidden.

## Non-goals / stops

- No PROD, main promotion, C5, Mode B READY, whole-parent close, High/Astra, new deps/runner, source-broad review.
- No controller/client/auth/role/business/root/AGENTS/Git/live/PROD changes.
- No 0042/0046 edits; no app/API version bump; no new PR.
- Original failures/raw/usage preserved; no budgets/history reset.
