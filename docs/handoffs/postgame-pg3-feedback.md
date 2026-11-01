# Issue #372 / PG-3 Private reviews + personal notes — Mode A author handoff

From: Cursor Auto (`OWNER_APPROVED_PG3_PRIVATE_FEEDBACK_PERSONAL_NOTES`, attempt 5, base `e2fb967808c1e8c50e2f72177b4e807b04e0d92b` after trusted ordinary merge of accepted DEV SMTP `06991b099317a702dc102eeef53ee64cfa841f0e`).
To: one independent Codex Sol Medium QA → mandatory Product CI → trusted DEV release/smoke → Owner UAT.
Status: **SOURCE CANDIDATE** / UAT=NOT_TESTED / PG-3 writes default **OFF** / **NOT READY** / no DEV ACCEPTED claim / no PROD.
Parent #372 PG-3 slice only. PG-4 and #394 not done. Mode B binding NOT claimed. Author checks ≠ independent QA.
Product PG-3 code + pass4 disposable fixture repair retained. Migration **0048** PASS unchanged — not re-run for this catalogue-only pass. No feature expansion or protocol change.

## Pass 5 — version catalogue reconciliation only

Allowed paths only: `apps/web/src/lib/releases.ts`, `apps/web/test/releases.test.tsx`, `apps/web/test/releases-server.test.ts`, `docs/releases/CHANGELOG.md`, this handoff.

### What changed

- Prospective current application version: **`0.1.0-alpha.6`** (API contract note **`0.23.0`** unchanged).
- `CURRENT_NAMED_RELEASE` remains PG-3 delta; `source_sha` / acceptance date **null/unbound** until accepted live projection.
- `TRUSTED_HISTORICAL_SEED` preserves alpha.1–alpha.3 and appends exact accepted seeds:
  - **alpha.4** PG-2 `7a36b8d94a5df412426155e5852fddd9da7b0045` / `r41310911419-a1` / `2026-11-01T13:34:38Z`
  - **alpha.5** SMTP `06991b099317a702dc102eeef53ee64cfa841f0e` / `r41317332177-a1` / `2026-11-01T14:52:56Z` (SMTP notes/features kept; not replaced by PG-3)
- CHANGELOG: prospective PG-3 alpha.6 on top; historical SMTP alpha.5 and PG-2 alpha.4 retained accurately.
- PROD remains **alpha.2 / email=false**; no real mailbox delivery UAT claimed from supplied evidence.
- Scoped release tests assert distinct alpha.4 + alpha.5 exact history and proposed alpha.6.

### Retained from earlier passes (not re-authored here)

- Product PG-3 implementation + pass1 shared form styling.
- Pass2 SAVEPOINT/precheck; pass3 `ownEligibleParticipation` peer gate.
- Pass4 disposable fixture: secondary manager actor preserving creator history; own disposable DB **3/3 PASS** at `175b1193b49b0e295cfcb97df941f9f94707e311` retained as prior fact.
- Upstream merge verified auth/config/package/lockfile EXACT SMTP; prior conflict hunks on release files were temporary PG-3 side and are reconciled here.

## Outstanding (honest)

- Independent Sol Medium QA of this source candidate
- Product CI + trusted DEV deploy/smoke + flag activation
- Owner UAT = NOT_TESTED
- Full PG-3 typed Safety complaint extension = **remaining**
- PG-4 / public comments #394 later

## Non-goals / stops

- No PROD, main promotion, C5, Mode B READY, whole-parent close
- No AGENTS/Git/runtime/PROD/auth modifications by author; no secrets
- No migration re-run; no feature expansion; no new engine/framework
- No whole-suite matrix expansion; no ModelHigh; no Astra diagnosis
