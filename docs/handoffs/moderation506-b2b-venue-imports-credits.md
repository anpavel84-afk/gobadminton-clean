# #506 B2b — public-data description + media credits (SOURCE candidate)

Base frozen: `aa222e469c4125abf1e8fe08eaba4e05575ead72` (trusted alpha.52 ACCEPTED / `r42435428393-a1`). Application notes: **0.1.0-alpha.53** (`source_sha` null, UAT `NOT_TESTED`). API contract **0.37.0** (compatible). Cursor Auto sole source writer. Attempt 37. No fabricated CI/DEV PASS. Announce only B2b; C/D/#507 pending; no whole-MOD DONE.

## What landed

- Additive migration `0066_moderation_venue_imports_credits.sql` (+ non-destructive rollback): `venue_credit_text` surface + `venue_gallery_item` entity kind. 0061–0065 untouched as production migrations.
- Scoped helper `apps/api/src/venues/venue-import-moderation.ts` — description/credit candidates, trusted «Иллюстрация», public-data/cover admission fingerprints, bind helpers. Reuses `approveTexts`/`bindTexts`. No new service/broker/scheduler.
- `--public-data` import: NEW/CHANGED nonempty `public_description` only; durable `venue_public_data_batch_attempt` before text I/O (same audit pattern as gallery attempt). Clear/omit/noop/dry-run/known replay → zero provider egress. Identity/contacts keep domain validators; `sources[].note` and private contacts never forwarded.
- Admin gallery add/replace: `privilegedRunWithExternalPrepare` admits free credit text + image together; bind `venue_credit_text` to `venue_gallery_item` at published venue version. Trusted illustration skips text provider. Remove/reorder/main unchanged and provider-independent.
- Gallery importer: extends **same** durable attempt/receipt admission with text prepare before image; per-item failure leaves prior credits/cover/main.
- Legacy cover importer: additive attempt CAS (credit+source+imagehash + captured venue snapshot); fresh CAS before publish; preserves old image-hash digest compatibility without claiming historical CAS existed.
- Image path still `approveImage`/`bindImage`/M1; no pipeline rewrite. #488 photos and #509 credit layout untouched. Legacy cover upload API still has no free-credit field.
- B4U_SOURCE_V1 club names stay LEGACY_UNREVIEWED; no active writer → future writer entrypoint required (not claimed IMPLEMENTED).
- Tests: `public-venue-import-credit-moderation.test.ts` (+ adapted gallery-import stubs / venue-profile 0066 / migration smoke / releases alpha.53). Parent runs target DB/CLI suites — author does not invent runtime PASS.

## Paths

| Area | Path |
| --- | --- |
| Migration | `apps/api/migrations/0066_moderation_venue_imports_credits.sql` (+ rollback) |
| Helper | `apps/api/src/venues/venue-import-moderation.ts` |
| Text policy | `apps/api/src/moderation/text-policy.ts` |
| Public-data / gallery / cover CLI | `apps/api/src/database/import-venue-covers.ts` |
| Admin gallery | `apps/api/src/venues/venue-gallery.service.ts` |
| Integration | `apps/api/test/integration/public-venue-import-credit-moderation.test.ts` |
| Metadata 53 | `apps/web/src/lib/releases.ts` (+ tests); trusted 52 seed copied exact into history |
| Coverage | `docs/decisions/CONTENT_MODERATION_V2_COVERAGE_V001.md` |
| Handoff | this file |

## Limits (honest)

- Author did not declare Product CI / DEV ACCEPTED / Owner UAT PASS.
- Private external OFF; GoBad / Owner / live Admin / iPhone NOT_TESTED.
- No PROD; no Mode B binding claim; no whole-B/MOD READY/ACTIVE.
- Quantity pause hard Jan 1 unchanged; content checks remain.

## Next gates

Independent Codex Sol Medium QA → Product CI → trusted merge/DEV → smoke → Owner UAT (NOT_TESTED until then).
