# #422 SPB identity repair — public-data importer extension

From: source author (`cursor:auto`). To: independent QA / PM / trusted integrator.
Date: 2026-11-07. Status: WORKING_DRAFT, NOT INDEPENDENTLY VERIFIED. No QA/DEV/UAT PASS.
Assignment: `OWNER_SPB422_MINIMAL_COMPATIBLE_IDENTITY_REPAIR_EXISTING_IMPORTER` attempt 2 (fixtures).
Base: `fe236a8c365b74f55d6c9f1470d9b1868eace49a`. No Git/network/deploy/secrets in this pass.
Attempt 1 native API unit+types+lint PASS; isolated PostGIS suite 2 PASS / 3 FAIL retained.
New SPB venue creation, B4 UID forging, 11-city importer/source attribution, release files,
and actual40 receipt are out of scope (next 41 metadata). PROD not authorized.

## What changed

Minimal backward-compatible extension of `VENUE_PUBLIC_DATA_BATCH_V1` inside the existing
public-data importer (no new tool/service/architecture/rights/migration/API admin endpoint).

Optional per-item `identity` object with `name` and/or `address` only, for an **existing**
venue UUID. At least one of `publicContacts` / `profile` / `identity` is required.
`sources` + `checkedAt` remain required. Strict schema rejects create/delete/merge/verify/geo/
city/timezone/private contact/status/gallery fields.

## Compatibility

- Manifests that omit `identity` keep the same fingerprint/digest bit-for-bit (undefined
  identity is not serialized into the fingerprint payload).
- Old receipts without `identity` still load; replay still verifies only touched public fields.
- Gallery modes, cover import, and ordinary user rights are untouched.

## Apply semantics

1. Eligible lifecycle only: `unverified` | `verified`.
2. Own accepted receipt (batch+venue key) is checked **before** expectedName/address/version:
   matching fingerprint + current post-patch identity and all touched public fields → `SKIPPED`
   (`PUBLIC_DATA_REPLAY`) with zero writes. This is how exact batch replay works after a
   successful rename/address change (expected* still name the pre-patch identity).
3. Without own receipt: exact expected old name/address + CAS version; never accept a new
   identity solely because the row already shows it.
4. Identity resolve reuses `normalizeVenueText` / `extractIdentityDiscriminator` /
   `venueDedupeKey`. Only supplied name/address change; non-empty `identity_discriminator`
   is preserved (name-only fix must not erase unit/hall boundaries). Historical
   `venue_identity_keys` rows are retained; the new normal key is inserted
   (`ON CONFLICT DO NOTHING`) under the existing `gobadminton_venue_catalog` advisory fence.
5. Foreign claim on the new dedupe key → `VENUE_IDENTITY_CONFLICT`, no row/alias/audit writes.
   Collision/CAS/changed-manifest under the same key → FAIL, no partial writes. Drift after
   own receipt → `PUBLIC_DATA_DRIFT` (no restoration).
6. Single transaction: venue row CAS (name/address/normalized_*/discriminator + optional
   publicContacts/profile + version) first, then reserve the new identity key (historical keys
   kept), then public-data audit/receipt + admin action + outbox. Foreign key claim after the
   row write throws to roll back the transaction (no partial alias). Private contacts,
   location/geo, games venue refs, lifecycle, city, timezone remain untouched. No normalizer
   rebuild / new geo service.

## Audit / receipt projection

`after_diff` gains optional `identity` (the patch object) when identity was applied; before
records prior `{ name, address }`. Fingerprint and sources stay on the receipt. Load path
projects `identity` when present.

## Known bounds

- Does not create/verify/merge venues; does not mint B4 UIDs; does not change city importer.
- Does not provide Admin UI session; trusted CLI still requires active superadmin principal +
  `venue.manage` env guards (`APP_ENV` mvp/stage, DEV web origin, real moderation provider).
- Dry-run and apply both evaluate identity collision; apply re-checks under the catalog lock.
- Rollback of a bad apply needs a **fresh CAS** (`expectedVersion` + current expected name/
  address) and a new source-backed manifest; replaying an old successful identity receipt
  only SKIPs, it does not restore a later drift.

## Attempt 2 — integration fixture repair only

Allowed paths: `apps/api/test/integration/venue-public-data-import.test.ts` + this handoff.
No production/security/normalization/idempotency weakening; no ON CONFLICT DO NOTHING on
fixture key inserts to hide ownership.

Pass-1 PostGIS FAILs (retained history):

1. `venue()` now inserts real `venue_identity_keys`, but ordinary metadata tests reused the
   same default name/address/`""` discriminator → `venue_identity_keys_pkey` collision before
   assertions (fingerprint/drift + CAS/actor cases).
2. Foreign-collision case used `"Target Hall"` / `"Foreign Hall"` with empty stored
   discriminator. Resolve on empty disc extracts `hall:target` from `"Target Hall Target…"`,
   so the claim key differed from the target's stored `""` key and import returned 0 instead
   of `VENUE_IDENTITY_CONFLICT`. Different unit/hall aliases stay distinct by design — not a
   production merge bug; fixtures must own the **same** physical normal identity including
   the preserved discriminator.

Fixture fixes:

- Ordinary independent fixtures get unique physical name/address (UUID tag); manifest
  `expectedName`/`expectedAddress` match the actual fixture. All original CAS / fingerprint /
  actor / dry-run / rollback / replay assertions preserved.
- Collision fixtures share explicit `identityDiscriminator: "hall:2"` and rename foreign onto
  target's name+address so the derived dedupe key is the one the other UUID already owns.
  Negative assertions stay `FAILED` / `VENUE_IDENTITY_CONFLICT` with unchanged
  row/alias/audit/outbox; changed-manifest refuse assertions unchanged.

## Checks (author, not independent QA)

Unit coverage extended in `venue-public-data-import.test.ts` (schema, fingerprint stability,
discriminator preserve, replay/drift, collision helper) — attempt 1 PASS retained.
Integration coverage: rename/address success + key retention + exact replay SKIP + foreign
collision / changed manifest atomic refuse; attempt 2 repairs disposable PostGIS fixtures
only. Live PostGIS and full CI are for PM/independent QA; author pass does not claim
DEV ACCEPTED.
