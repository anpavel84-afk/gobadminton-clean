# Issue #372 / PG-2 Dispute response + scoped case resolution — Mode A author handoff

From: Cursor Auto (`OWNER_APPROVED_PG2_RESPONSE_CORRECTION_SCOPED_CASE_RESOLUTION`, attempt 5, base `f6a06b8af76a21b88f672b8bdb1e0625cb042866`).
To: one independent Codex Sol Medium QA → mandatory Product CI → trusted DEV release/smoke.
Status: SOURCE CANDIDATE repair of **0047 cross-schema catalog lookups** only / prior business-logic sourceQA **PASS** preserved / **UAT=NOT_TESTED** / PG-2 source default **OFF**, **NOT_INSTALLED / NOT_QUALIFIED** on runtime / **NOT READY** / no DEV claim for PG-2.
Parent #372 PG-2 slice only. PG-3/PG-4 not done. Mode B binding NOT claimed. Author checks ≠ independent QA.
Existing PR #441. App **0.1.0-alpha.4** / API **0.22.0** unchanged (same unreleased candidate; no bump; no new PR).

## Runtime / flag accuracy (do not mis-state)

- Live DEV **PG-1b** flag is already **ON** (do not claim the whole post-game runtime is OFF).
- **PG-2** source remains default **OFF**, **NOT_INSTALLED / NOT_QUALIFIED** until trusted install + qualification. Not full-parent DONE. PROD forbidden.

## Root cause (actual CI run 41306844515 / candidate `578808cd…`)

Unreleased `0047_attendance_dispute_resolution.sql` scanned `pg_constraint` / `pg_trigger` by `rel.relname` or global `conname`/`tgname` only. After public apply, a second schema with `search_path=side,public` picked public constraint names and `ALTER TABLE`/`DROP` targeted the side relation (missing names → FAIL, e.g. `game_attendance_revisions_late_value_check`). Global `IF NOT EXISTS` on constraint/trigger names also skipped creating the required side-local checks and all 6 history-immutability triggers. Not solved by blanket `IF EXISTS` hiding the wrong table.

## Pass-5 repair (0047 catalog OID binding only)

1. `apps/api/migrations/0047_attendance_dispute_resolution.sql` — every `pg_constraint` / `pg_trigger` lookup binds to search_path-resolved table OID (`conrelid`/`tgrelid` = `'…'::regclass`); dynamic `ALTER`/`CREATE TRIGGER` targets the same `regclass`. Constraint definitions, uniqueness/history/unknown/source/late semantics unchanged. No edits to applied 0042/0046/older SQL.
2. `apps/api/migrations/rollback/0047_attendance_dispute_resolution.sql` — inspected; already table-scoped / populated rollback guard; **unchanged**.
3. `apps/api/test/integration/migration.smoke.test.ts` — ledger appends exact `0047_attendance_dispute_resolution`; asserts public new tables; narrowly reuses dual `side,public` apply fixture to assert side-local 0047 constraints + all 6 immutability triggers on `side.*` OIDs (public rows cannot mask). Prior assertions preserved. Does **not** edit `admin-a0a.security.test.ts` / `url-storage-authority.test.ts`.
4. This handoff.

## Checks (author, pass-5)

- `@gobadminton/api` typecheck (`tsc -p tsconfig.json --noEmit`) — PASS
- eslint `test/integration/migration.smoke.test.ts` — PASS
- Disposable PostGIS suites (**not run by author**; no live DB/root): trusted operator must re-run exact three that failed — `admin-a0a.security.test.ts`, `url-storage-authority.test.ts`, `migration.smoke.test.ts`. **DB PASS not claimed.**
- Unchanged controller/client/auth/role/business source — **reused**, prior sourceQA acceptance.
- Browser / Product CI / DEV — outstanding trusted process.

## Unresolved technical gates

- Independent QA of this 0047 OID-binding repair + non-regression of already-accepted business paths.
- Trusted operator: exact 3 DB suites above on disposable PostGIS.
- Product CI + trusted DEV deploy/smoke for PG-2.
- Owner UAT = NOT_TESTED.
- PG-2 runtime remains NOT_INSTALLED / NOT_QUALIFIED; PROD forbidden.

## Non-goals / stops

- No PROD, main promotion, C5, Mode B READY, whole-parent close, High/Astra, new deps/runner, source-broad review.
- No controller/client/auth/role/business changes.
- No AGENTS/Git/live/PROD; author cannot access live DB/root.
- Original failures/raw/usage preserved; no budgets reset.
