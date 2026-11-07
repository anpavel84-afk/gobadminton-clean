# #506 B1c — venue public review classifier (SOURCE candidate)

Base frozen: `61855b810f69957107516305f722c4217fc45cbb` (attempt 27 FIX). Trusted DEV alpha.49 `519489d9` ACCEPTED unchanged. Application notes: **0.1.0-alpha.50** (`source_sha` null, UAT `NOT_TESTED`). API contract **0.37.0**. Cursor Auto sole source writer. QA/CI/DEV still pending — not DEV ACCEPTED.

## Source 27 fixes (QA26 + parent FAIL)

1. **Preflight eligibility:** `authorizePublicSubmitPreflight` mirrors `writeRevision` withdrawn-slot + 14-day/appeal-paused submit-window checks **before** `assessReviewTexts` (create / submit_revision / resubmit). Existing permission/affiliation/consent/CAS fences unchanged. Focused HTTP fake-provider tests: closed window + withdrawn → `textCalls=0`, no new revision/binding/intake.
2. **alpha.50 release prose:** user-facing limitations without `#507` / B2/C/D / nonce jargon. Test expectations match actual review-50 title/additions/limitations (not gallery-49). Trusted alpha.49 seed exact; no DEV-50 acceptance claimed.
3. **Human approve cache:** soft candidate already caches `decision=review`; approve reuses exact stored approval (`textCalls=0`), publication twin + human FK + classification bind assertions kept strong.

## What landed (prior)

- Public-consented venue create / submit_revision / resubmit: authorize → `assessReviewTexts` outside locks → candidate bind `venue_review_body` / `venue_review_revision`. ALLOW still human-pending.
- Admin approve/restore: `privilegedRunWithExternalPrepare`. Approve creates published twin; candidate stays on submitted; publication bind + `venue_review_decision_id` on twin. Restore classifies actual `approved_revision_id` tip.
- Private `self_draft`, withdraw, appeal, report, Case notes: zero provider egress.
- Soft provider `review` preserved on human allow. Hard reject / 503 / 429 retain prior tip + draft form.
- Additive migration `0064_moderation_venue_review_bindings.sql` (+ rollback). 0061–0063 / 0064 DDL unchanged this delta.

## Paths (this delta)

| Area | Path |
| --- | --- |
| Consumer preflight | `apps/api/src/venues/venue-reviews.service.ts` |
| Integration | `apps/api/test/integration/public-venue-review-moderation.test.ts` |
| Releases | `apps/web/src/lib/releases.ts`, `apps/web/test/releases.test.tsx` |
| Handoff | `docs/handoffs/moderation506-b1c-venue-reviews.md` |

## Limits (honest)

- B2 venue public text/import, C private messages, D avatar metadata, broad venue discussion: **pending**.
- Author did not run disposable DB / Product CI / DEV smoke (parent gates). No fake PASS.
- Authorized Admin UI, GoBad visual, Owner UAT: **NOT_TESTED**.
- No PROD; no Mode B binding claim; no whole-B READY/ACTIVE.

## Next gates

Independent delta QA → mandatory Product CI → trusted merge/DEV → smoke → Owner UAT.
