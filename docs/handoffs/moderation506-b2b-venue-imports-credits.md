# #506 B2b — public-data description + media credits (SOURCE repair candidate)

Base frozen: `16882cbeeeb7726bff28809d69269df32a5c872e` (attempt 37 candidate; DEV alpha.52 ACCEPTED `52aa222`; alpha.53 not published, `source_sha` null). Application notes: **0.1.0-alpha.53** (UAT `NOT_TESTED`). API contract **0.37.0** (compatible). Cursor Auto sole source writer. **Attempt 38** = bounded repair of QA exact2 HIGH + 2 fixture failures. Preserve all 37 results/costs; 38 never replays UNKNOWN. No fabricated CI/DEV PASS. Repair source only — QA/CI/DEV pending. Do not claim whole-MOD DONE. C/D/#507 pending.

## Attempt 38 repair (this handoff)

- **HIGH1** `importVenueCovers`: admission (accepted/attempt input fingerprint) before `EXISTING_COVER` shortcircuit; immutable INPUT fingerprint independent of captured venue snapshot; captured CAS retained for first publish; exact accepted replay SKIP without restoring deleted cover; changed credit/source/image/kind/basis → `COVER_IMPORT_CONFLICT` even when cover exists. Optional `coverSnapshotDigest` on audit only.
- **HIGH2** `importVenuePublicData`: retained attempt/input fingerprint checked before provider vs clear/omit branch; changed bound input → `PUBLIC_DATA_CONFLICT` before write; fresh clear/omit still zero egress; concurrent claim re-check under clear/omit TX.
- **Fixture1** credit-moderation `jpeg(label)`: deterministic distinct RGB per label (legacy identical bytes caused gallery `EXISTING_SOURCE_FINGERPRINT` SKIP / textCalls 0).
- **Fixture2** cover-import refused stage: update manifest sha with new bytes for real provider-reject GC; separate tamper case keeps early hash reject / provider0 / no new staged GC.
- Added bounded admission replay/conflict/deletion-replay and 503→clear/omit assertions. No migration 001..65 edits. No PROD/runtime/config writes.

## What landed (through 37, preserved)

- Additive migration `0066_moderation_venue_imports_credits.sql` (+ non-destructive rollback): `venue_credit_text` surface + `venue_gallery_item` entity kind. 0061–0065 untouched as production migrations.
- Scoped helper `apps/api/src/venues/venue-import-moderation.ts` — description/credit candidates, trusted «Иллюстрация», public-data/cover admission fingerprints, bind helpers. Reuses `approveTexts`/`bindTexts`. No new service/broker/scheduler.
- `--public-data` import: NEW/CHANGED nonempty `public_description` only; durable `venue_public_data_batch_attempt` before text I/O. Clear/omit/noop/dry-run/known replay → zero provider egress when no conflicting retained attempt.
- Admin gallery add/replace: free credit text + image; trusted illustration skips text provider.
- Gallery/cover importers: durable attempt/receipt admission; image path still `approveImage`/`bindImage`/M1.
- B4U_SOURCE_V1 club names stay LEGACY_UNREVIEWED; no active writer → future writer entrypoint required (not claimed IMPLEMENTED).
- B2a actual 52 metadata/source SHA null for 53; trusted 52 entire seed/history unchanged. Current 3data/7g prepared facts not applied (waiting real 53).

## Paths (38 touched)

| Area | Path |
| --- | --- |
| Helper | `apps/api/src/venues/venue-import-moderation.ts` |
| Cover / public-data CLI | `apps/api/src/database/import-venue-covers.ts` |
| Integration | `apps/api/test/integration/public-venue-import-credit-moderation.test.ts` |
| Integration | `apps/api/test/integration/venue-cover-import.test.ts` |
| Handoff | this file |

## Limits (honest)

- Author marks **repair source only**; independent SolMedium QA (exact findings + related delta), Product CI, DEV ACCEPTED, Owner UAT — **pending**.
- Private external OFF; GoBad / Owner / live Admin / iPhone NOT_TESTED.
- No PROD; no Mode B binding claim; no whole-B/MOD READY/ACTIVE.
- Quantity pause hard Jan 1 unchanged; content checks remain.

## Next gates

Independent Codex Sol Medium QA (exact findings/related delta only) → Product CI → trusted merge/DEV → smoke → Owner UAT (NOT_TESTED until then).
