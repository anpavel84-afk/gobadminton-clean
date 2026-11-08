# #506 B2a — ordinary public venue name/address/description (SOURCE candidate)

Base frozen: `4cefe7a6ef780da13796c1df85eca6fdc27a50ef` (trusted alpha.51). Application notes: **0.1.0-alpha.52** (`source_sha` null, UAT `NOT_TESTED`). API contract **0.37.0** (compatible). Cursor Auto sole source writer. QA/CI/DEV still pending — not DEV ACCEPTED. No fabricated runtime PASS.

## What landed

- Consumer `create` / `propose` / `confirm-distinct`: `MutationRunner.runWithExternalPrepare` → readonly preflight (city/session identity/token/fuzzy) → `approveTexts` only when creating → final catalog TX recheck → `bindTexts` on INSERT (`venue_name`/`venue_address`, entity `venue`). Exact reuse and fuzzy prompt: zero provider egress. Race needing create without prepared text → `VENUE_TEXT_PREPARE_STALE`. Token validate-without-consume in preflight; consume rolls back with failed TX.
- Admin create/edit/restore: `privilegedRunWithExternalPrepare`. Edit classifies only changed non-empty public fields (retired included). Restore classifies exact current public snapshot. Clear/omit description and unchanged name/address: no egress; private `contact_*` / `booking_note` never sent. verify/retire/merge remain provider-independent.
- Additive migration `0065_moderation_venue_public_fields.sql` (+ non-destructive rollback). Surfaces `venue_name`/`venue_address`/`venue_description`; entity kind `venue`. Local `factual` kind for addresses. 0061–0064 untouched.
- Fake-provider integration `public-venue-fields-moderation.test.ts` (narrow). Existing venue unit/integration fixtures adapted for required moderation dependency (no production bypass). N-1 ordinary bindings preserved.
- Releases: alpha.52 current delta; trusted alpha.51 seed exact in catalogue; 50/49 unchanged. Temporary DEV quantity pause deadline `2027-01-01` UTC retained in user copy (not disabled).

## Paths

| Area | Path |
| --- | --- |
| Consumer | `apps/api/src/venues/venues.service.ts` |
| Admin | `apps/api/src/venues/admin-venues.service.ts` |
| Policy | `apps/api/src/moderation/text-policy.ts`, `local-text-policy.ts` |
| Migration | `apps/api/migrations/0065_moderation_venue_public_fields.sql` (+ rollback) |
| Integration | `apps/api/test/integration/public-venue-fields-moderation.test.ts` |
| Releases / matrix / handoff | `apps/web/src/lib/releases.ts`, `docs/decisions/CONTENT_MODERATION_V2_COVERAGE_V001.md`, this file |

## Limits (honest)

- B2b imports/gallery credits, C private messages, D avatar metadata, #507 UI: **pending**.
- Author did not run disposable DB / Product CI / DEV smoke (parent gates). No fake PASS.
- Authorized Admin UI, GoBad visual, Owner UAT: **NOT_TESTED**.
- No PROD; no Mode B binding claim; no whole-B READY/ACTIVE.

## Next gates

Independent QA → mandatory Product CI → trusted merge/DEV → smoke → Owner UAT.
