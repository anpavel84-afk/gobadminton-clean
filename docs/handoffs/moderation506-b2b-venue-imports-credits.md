# #506 B2b — public-data description + media credits (SOURCE repair candidate)

Base frozen: `af8836b0474956944b2c2a781ff2cdbf74d40667` (attempt 39 candidate). Application notes: **0.1.0-alpha.53** (UAT `NOT_TESTED`). API contract **0.37.0** (compatible). Cursor Auto sole source writer. **Attempt 40** = bounded repair of QA39 single HIGH (accepted+attempt coexistence; fingerprint before accepted/eligibility). Preserve all 37/38/39 results/costs; 40 never replays UNKNOWN. Cover replay independently accepted — not re-architected. No fabricated CI/DEV PASS. Repair source only — QA/CI/DEV pending. Do not claim whole-MOD DONE. C/D/#507 pending.

## Attempt 40 repair (this handoff)

- **HIGH** `importVenuePublicData`: after successful moderated apply both attempt and accepted coexist. After real actor auth, compare retained attempt fingerprint/digest **before** accepted branch and mutable eligibility/version planning. Mismatch → `PUBLIC_DATA_CONFLICT` (clear/omit change must not become `VENUE_INELIGIBLE`). Matching accepted retains known replay/drift via planning — never convert to pending HOLD. Matching pending stays HOLD/zero egress.
- Same guard ordering in narrow `commitPublicDataAttemptOrReplay` and clear/omit race entry (attempt mismatch before accepted; matching accepted does not HOLD).
- One targeted regression: successful moderated apply creates attempt+accepted; unchanged replay → `PUBLIC_DATA_REPLAY`; version+retire drift + changed clear/omit → `PUBLIC_DATA_CONFLICT`; zero egress; no mutation. Keep pending-only regression from 39.
- No cover-path changes. No migration/schema/release metadata. No PROD/runtime/config/budget/UNKNOWN reset.

## Attempt 39 (preserved)

- **HIGH** `importVenuePublicData`: after real actor authorization, compare retained attempt / immutable input fingerprint **before** mutable venue planning (eligibility / version shortcircuit), including clear/omit. Accepted receipt remains authoritative via existing planning. Version/eligibility drift must not mask changed admission → `PUBLIC_DATA_CONFLICT`. Fresh ops still run CAS/eligibility; no writes on conflict; no cached disclosure before auth; zero egress + exact HOLD UNKNOWN replay retained.
- One targeted regression: prior attempt → venue version+eligibility drift → changed clear/omit → `PUBLIC_DATA_CONFLICT`; exact same input → `OPERATION_OUTCOME_UNKNOWN`; zero egress; no mutation.
- No cover-path changes. No migration/schema/release metadata. No PROD/runtime/config/budget/UNKNOWN reset.

## Attempt 38 (preserved)

- **HIGH1** `importVenueCovers`: admission before `EXISTING_COVER` shortcircuit; immutable INPUT fingerprint; exact accepted replay SKIP without restoring deleted cover; changed credit/source/image → `COVER_IMPORT_CONFLICT`.
- **HIGH2** `importVenuePublicData`: retained attempt before provider vs clear/omit branch (39 further orders attempt before eligibility/version).
- Fixture jpeg(label) distinct RGB; cover refused-stage manifest sha updates.

## What landed (through 37, preserved)

- Additive migration `0066_moderation_venue_imports_credits.sql` (+ non-destructive rollback): `venue_credit_text` surface + `venue_gallery_item` entity kind. 0061–0065 untouched as production migrations.
- Scoped helper `apps/api/src/venues/venue-import-moderation.ts` — description/credit candidates, trusted «Иллюстрация», public-data/cover admission fingerprints, bind helpers. Reuses `approveTexts`/`bindTexts`. No new service/broker/scheduler.
- `--public-data` import: NEW/CHANGED nonempty `public_description` only; durable `venue_public_data_batch_attempt` before text I/O. Clear/omit/noop/dry-run/known replay → zero provider egress when no conflicting retained attempt.
- Admin gallery add/replace: free credit text + image; trusted illustration skips text provider.
- Gallery/cover importers: durable attempt/receipt admission; image path still `approveImage`/`bindImage`/M1.
- B4U_SOURCE_V1 club names stay LEGACY_UNREVIEWED; no active writer → future writer entrypoint required (not claimed IMPLEMENTED).
- B2a actual 52 metadata/source SHA null for 53; trusted 52 entire seed/history unchanged. Current 3data/7g prepared facts not applied (waiting real 53).

## Paths (40 touched)

| Area | Path |
| --- | --- |
| Public-data CLI | `apps/api/src/database/import-venue-covers.ts` |
| Integration | `apps/api/test/integration/public-venue-import-credit-moderation.test.ts` |
| Handoff | this file |

## Limits (honest)

- Author marks **SOURCE repair pending QA/CI/DEV** — not DONE.
- Independent SolMedium QA (exact finding + related delta), Product CI, DEV ACCEPTED, Owner UAT — **pending**.
- Private external OFF; GoBad / Owner / live Admin / iPhone NOT_TESTED.
- No PROD; no Mode B binding claim; no whole-B/MOD READY/ACTIVE.
- Quantity pause hard Jan 1 unchanged; content checks remain.

## Next gates

Independent Codex Sol Medium QA (exact findings/related delta only) → Product CI → trusted merge/DEV → smoke → Owner UAT (NOT_TESTED until then).
