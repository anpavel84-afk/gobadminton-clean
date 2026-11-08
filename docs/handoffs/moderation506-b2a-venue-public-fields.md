# #506 B2a — ordinary public venue name/address/description (SOURCE candidate)

Base frozen: `4cefe7a6ef780da13796c1df85eca6fdc27a50ef` (trusted alpha.51). Application notes: **0.1.0-alpha.52** (`source_sha` null, UAT `NOT_TESTED`). API contract **0.37.0** (compatible). Cursor Auto sole source writer. Attempt 35 = TEST-FIXTURE ONLY repair on existing PR after ProductCI `42432725008` (database FAIL / other 6 jobs PASS). Prior meaningful parent `e1bdbe6fe7a70e79b1bf50b5235f4a2d50c0fc49` (Codex Sol Medium QA PASS). Current DEV still 51/`4cefe7a6`; 52 not accepted. No fabricated CI/DEV PASS.

## What landed (product, prior)

- Consumer `create` / `propose` / `confirm-distinct`: `MutationRunner.runWithExternalPrepare` → readonly preflight → `approveTexts` when creating → catalog TX recheck → `bindTexts` on INSERT (`venue_name`/`venue_address`, entity `venue`).
- Admin create/edit/restore: `privilegedRunWithExternalPrepare` with public-field classification; private contacts never sent.
- Additive migration `0065_moderation_venue_public_fields.sql` (+ non-destructive rollback). 0061–0064 untouched as production migrations.
- Fake-provider integration + `p4.venue-lifecycle` budget isolation pattern.

## Attempt 35 — fixture-only CI repair (this pass)

Root cause from ProductCI plain log (not production API 500 on full schema 65):

1. **N-1 disposable suites** (`game-attendance` / `game-outcomes` / `game-recommendations`): venue create 500 because current VenuesModule external-prepare needs `idempotency_records.claim_nonce` (0062) and venue surface CHECKs (0065) beyond prior independent 0045+0061 cut. Added independent `0062` + `0065` only; ledger assertions updated to 45; isolated 0038→0039 / outcome / attendance / recommendation roundtrips preserved; no 0063/0064 mass-apply.
2. **`venue-profile` (<0058 harness)**: Admin create 500 on missing `admin_command_receipts.reservation_state` (0063) plus text/binding/surface deps. Added independent `0061`+`0062`+`0063`+`0065`; skipped `0064` (FK needs 0058 `venue_review_decisions`). Preserved SQL-only 0038→0039 upgrade test. Fake provider + budget isolation in beforeEach.
3. **`ls01` / `s00a`**: 429 after new venue/public-text checks because shared synthetic OAuth actors accumulate `content_moderation_rate_budgets` across unrelated cases. Isolated budgets only (p4 pattern); no production limit/backoff/DEV-pause/date changes.

Allowed paths only; production services/migrations/schema/CI/workflows/quota untouched. Metadata 52 / trusted 51 seed unchanged. Parent re-runs the 6 suites + full Product CI on SAME PR.

## Paths (fixture delta)

| Area | Path |
| --- | --- |
| Attendance N-1 harness | `apps/api/test/integration/game-attendance.disposable.test.ts` |
| Outcomes N-1 harness | `apps/api/test/integration/game-outcomes.disposable.test.ts` |
| Recommendations N-1 harness | `apps/api/test/integration/game-recommendations.disposable.test.ts` |
| Venue-profile harness | `apps/api/test/integration/venue-profile.test.ts` |
| LS-01 budget isolation | `apps/api/test/integration/ls01.profiles-safety.test.ts` |
| S-00A budget isolation | `apps/api/test/integration/s00a.transaction-auth.test.ts` |
| Handoff | this file |

## Limits (honest)

- Author did not declare Product CI / DEV ACCEPTED / Owner UAT PASS for this fixture repair.
- First CI failure `42432725008` and FAIL/HOLD history 31–34 preserved; not erased.
- No PROD; no Mode B binding claim; no whole-B READY/ACTIVE.

## Next gates

Parent Docker run of these 6 suites → independent delta QA → full Product CI (all 7) on SAME PR → trusted merge/DEV → smoke → Owner UAT.
