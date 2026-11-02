# Issue #372 / PG-4 same PR #462 — Mode A CI fixture+lint repair (pass 3)

From: Cursor Auto (`OWNER_APPROVED_PG4_EXISTING_PR462_CI_FIXTURE_AND_LINT_REPAIR`, attempt 3, base `8ee38567aa9af4e31c1a9d4e2366e5530660f032`).
To: PMA → mandatory Product CI → trusted process (publish/QA/integration). Author ≠ independent QA.
Status: **SOURCE CANDIDATE repaired** / UAT=**NOT_TESTED** / no DEV ACCEPTED claim / no PROD.
Parent #372 PG-4; Source QA2 behavior + QA3 metadata PASS unchanged. Mode B binding NOT claimed. C5 OFF.

## Handoff (4 lines)

1. **CI reason:** Product CI `41392243885` — lint: unused `review` arg (`GameReviewsHistory.tsx:20`) + unused `hrefs` helper (`game-reviews-history.test.tsx:120`); webtests 9 FAIL all in `game-results-mutation.test.tsx` (`useRouter`/`useSearchParams` without provider → app-router invariant / null useContext).
2. **Repair:** drop unused lint symbols; add stable `next/navigation` mock (`replace` + empty `URLSearchParams` → default attendance) in mutation fixtures only — no production navigation removal, no stubbed components, no skipped cases.
3. **Checks:** `vitest` `game-results-mutation` + `game-results` + `game-reviews-history` → 3 files / 36 PASS; eslint on 3 changed files exit 0; `tsc --noEmit` exit 0. No release/seed/contract/deps edits.
4. **Native DONE** for this fixture/lint repair only — publication / independent QA / DEV acceptance / alpha.13 install left to PMA. Prior FAIL/costs preserved. PROD not claimed.
