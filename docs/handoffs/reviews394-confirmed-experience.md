# Handoff · #394 confirmed experience + missing mark

Assignment: `OWNER_20261102_REVIEWS394_CONFIRMED_EXPERIENCE_AND_MISSING_MARK`
Base (this repair): `ac52039af98abe3ec3e562df64b074a6c6c13101`
Attempt: 12 · Prospective app: `0.1.0-alpha.16` · API `0.26.0` · UAT `NOT_TESTED` · `sourceSha: null`
#394 remains **PARTIAL** until venue-publication / typed reviewSafety.

## CI FAIL (database job) — fixture only

CI `41442521684`: six jobs PASS; database ONLY 1 failure in existing PG-1a `test/integration/game-outcomes.disposable.test.ts:391` strict `feedback` `toEqual`. Expected capabilities missing optional new field `peerCreateReason`; actual includes `peerCreateReason: null` (schema 0048 not applied → empty actor-scoped slice). QA2 PASS on actual product code; changed feedback/disputes/admin/migration suites passed. Ordinary fixture compatibility — no Astra.

## Repair delivered (attempt 12)

- **Fixture only.** Expected `managerBody.feedback.capabilities` now includes `peerCreateReason: null`. Kept strict `toEqual`; guest/outsider/revoked-manager 404 and replay-after-revoke negatives unchanged.
- No production code / version / API / gate / schema change. No assert relaxation to partial match. No skip.

## Prior repairs (preserved)

- **P1.** Shared `assertCurrentPeerCreateAdmission` under game lock for peer create (replay / ownedPrior / insert).
- **P2.** `GameResultsComposition`: missing = `my.version===0`; existing unknown = `my.value==='unknown' && version>0`.

## Not in this pass

Migration / admin / release / digest edits. Public venue writer. PROD. C5. New test framework/matrix/modules.

## Checks (author; not independent QA / not DEV)

- Disposable PostGIS for addressed outcome DB test: **notrun** here (isolated DB not available in author slot). Trusted PMA runs after import; no live DB / new auth.
- Product CI / security / DEV smoke / Owner UAT: not claimed READY. Independent QA still required after this repair.
