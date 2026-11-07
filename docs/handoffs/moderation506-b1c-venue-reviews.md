# #506 B1c — venue public review classifier (SOURCE candidate)

Base: DEV alpha.49 `519489d9` ACCEPTED. Application notes: **0.1.0-alpha.50** (`source_sha` null, UAT `NOT_TESTED`). API contract **0.37.0**. Cursor Auto sole source writer. Not DEV ACCEPTED in this pass.

## What landed

- Public-consented venue create / submit_revision / resubmit: authorize → `assessReviewTexts` outside locks → candidate bind `venue_review_body` / `venue_review_revision`. ALLOW still human-pending.
- Admin approve/restore: `privilegedRunWithExternalPrepare`. Approve creates published twin; candidate stays on submitted; publication bind + `venue_review_decision_id` on twin. Restore classifies actual `approved_revision_id` tip.
- Private `self_draft`, withdraw, appeal, report, Case notes: zero provider egress.
- Soft provider `review` preserved on human allow. Hard reject / 503 / 429 retain prior tip + draft form.
- Additive migration `0064_moderation_venue_review_bindings.sql` (+ rollback). 0061–0063 untouched.

## Paths

| Area | Path |
| --- | --- |
| Consumer | `apps/api/src/venues/venue-reviews.service.ts`, `venues.module.ts` |
| Admin | `apps/api/src/admin/venue-reviews.service.ts` |
| Policy/binder | `apps/api/src/moderation/text-policy.ts`, `moderation.service.ts` |
| Schema | `apps/api/src/database/schema.ts`, `migrations/0064_*` |
| Tests | `apps/api/test/integration/public-venue-review-moderation.test.ts`, unit `text-moderation.test.ts`, migration smoke |
| Releases/coverage | `apps/web/src/lib/releases.ts` (+tests), `docs/decisions/CONTENT_MODERATION_V2_COVERAGE_V001.md` |
| OpenAPI / UI | `packages/contracts/openapi.json`, `VenueReviewComposer.tsx` (moderation notice only) |

## Limits (honest)

- B2 venue public text/import, C private messages, D avatar metadata, #507 broad venue discussion: **pending**.
- Author did not run disposable DB / Product CI / DEV smoke (parent gates). No fake PASS.
- Authorized Admin UI, GoBad visual, Owner UAT: **NOT_TESTED**.
- No PROD; no Mode B binding claim; no whole-B READY/ACTIVE.

## Next gates

Independent QA (Codex Sol Medium) → mandatory Product CI → trusted merge/DEV → smoke → Owner UAT.
