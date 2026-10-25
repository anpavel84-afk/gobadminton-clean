# Issue #37 — operator-directed CI correction4

From: source author. To: parent publisher → independent QA4. Date: 2026-10-15.
Status: READY_FOR_REVIEW / runtime UNVERIFIED; no self-approval.
Base: `432ae92f40750d4d4f9faa28e165a2b91890379b`, branch `automation/issue-37`, initially clean.
Exact source: https://github.com/anpavel84-afk/gobadminton-clean/tree/432ae92f40750d4d4f9faa28e165a2b91890379b

## Immutable chronology / bounded authority

- Source3 independent QA3: PASS, reviewed SHA above, findings `[]` (operator-supplied evidence).
- Subsequent hosted Product CI [38780337205](https://github.com/anpavel84-afk/gobadminton-clean/actions/runs/38780337205) and PR CI [38780344158](https://github.com/anpavel84-afk/gobadminton-clean/actions/runs/38780344158): FAIL (operator-supplied evidence). Neither historical result is overwritten.
- Operator explicitly authorized exactly one correction4 under standing Owner fix-and-continue. Original admission max3 remains unchanged; no automatic fifth correction.
- Only three named tests and this chronology may change. No product, env guard, auth policy, migration SQL, deployment/CI or other task changes; Issues #46/#47 remain separate.

## Changes

- Web venue-cover protocol mock returns a fresh Response per invocation. Typed call tuples are narrowed by an explicit missing-call error; DELETE body is narrowed to JSON text. All existing protocol assertions remain.
- Migration smoke exact ordered ledger adds actual `0034_venue_cover`; all other assertions remain.
- Disposable venue-cover fixture retains its loopback-only DB check and unique synthetic DB. Explicit loopback HOST, separate consumer `http://127.0.0.1:19442` and admin `http://localhost:19440` origins, distinct synthetic consumer/admin peppers and same-admin-origin VK/Yandex redirects prevent relevant inherited CI values from violating the existing Admin A0a guard. Actual auth/security outcomes remain exercised by the unchanged suite.
- STYLE_GUIDE_PARITY: test/config-only repair; no presentation or layout changes.

## Author checks and limits

- `git diff --check`: completed successfully.
- Node v24.21.0 built-in `stripTypeScriptTypes` parsed both changed API test files successfully; syntax only, no imports or DB executed.
- Plain `node --check` on those TypeScript files failed because that check interpreted TypeScript syntax as JavaScript; superseded only for syntax parsing by the explicit TypeScript strip check, not a test PASS.
- Local node_modules/.bin directories are absent. Typecheck, Vitest/Web runtime, disposable DB regressions and full CI: NOT_TESTED.
- `pnpm --version` unexpectedly triggered Corepack bootstrap download; DNS failed (`EAI_AGAIN`), no download completed. No retry or dependency installation performed.
- These limited author checks are not independent QA. No hosted CI, browser/UAT, DEV release/acceptance or PROD work performed. No commit, push or git metadata changes by author.

## Continuity / rollback

Rollback: reverse only this correction's three test diffs and remove this handoff; no SQL/data rollback. Production source stays at source3 behavior.
Next bounded action: parent publishes a normal commit and attaches exact candidate/artifact permalinks, then requests readonly independent QA4 and full hosted CI for that SHA. Existing DEV gates still require backup/rollback, paired immutable image digests, synthetic authorized/negative UAT including actual games venue cover/default updates, and genuine root-owned ACCEPTED exact SHA/digests/pending=false. All remain NOT_TESTED here. Candidate SHA/publication is pending parent; no fabricated permalink or acceptance.
