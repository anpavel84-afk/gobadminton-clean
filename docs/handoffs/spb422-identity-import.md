# #422 SPB identity repair — public-data importer extension

From: source author (`cursor:auto`). To: independent QA / PM / trusted integrator.
Date: 2026-11-07. Status: WORKING_DRAFT, NOT INDEPENDENTLY VERIFIED. No QA/DEV/UAT PASS.
Assignment: `OWNER_SPB422_MINIMAL_COMPATIBLE_IDENTITY_REPAIR_EXISTING_IMPORTER` attempt 1.
Base: `a592511c0838de49ae1fad071f5c1defdc61f41d`. No Git/network/deploy/secrets in this pass.
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

## Checks (author, not independent QA)

Unit coverage extended in `venue-public-data-import.test.ts` (schema, fingerprint stability,
discriminator preserve, replay/drift, collision helper). Integration coverage extended for
rename/address success + key retention + exact replay SKIP + foreign collision / changed
manifest atomic refuse. Live PostGIS and full CI are for PM/independent QA; author pass did
not claim DEV ACCEPTED and did not run against live DB.
