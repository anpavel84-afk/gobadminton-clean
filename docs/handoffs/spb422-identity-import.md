# #422 SPB identity repair — public-data importer + alpha.41 package

From: source author (`cursor:auto`). To: independent QA / PM / trusted integrator.
Date: 2026-11-07. Status: AUTHOR CANDIDATE, NOT INDEPENDENTLY VERIFIED.
No QA PASS, no CI PASS, no DEV ACCEPTED, no Owner UAT claimed in this pass.
Assignment: `OWNER_SPB422_REPAIR_CONFIRMED_QA_LEGACY_REPLAY_AND_RELEASE41` attempt 3.
Base: `766266eabf62244403fad20af7bc8c61af6b2798`. No Git/network/deploy/secrets/paid models.
Related visual-qa: #496 (narrow CSS only). PROD not authorized.

## Independent QA FAIL retained (pass1 → this repair)

Independent QA FAIL on HEAD `85cfbbc` (severity): for public-data items that omit
`identity`, accepted receipt was checked before `expectedName`/`expectedAddress`.
Old receipts have no `identity`, so replay compared only previously touched public
fields. After a contact/profile-only import, an external name/address change made
the same batch return `SKIPPED` / `PUBLIC_DATA_REPLAY` instead of
`VENUE_IDENTITY_MISMATCH`. Prior disposable PostGIS 5/5 passed but did not cover
this legacy-replay finding. All prior author calls and that FAIL remain history.

## Attempt 3 — confirmed P1 fix + ordinary alpha.41 package

Allowed paths only (this pass):

- `apps/api/src/database/import-venue-covers.ts`
- `apps/api/test/integration/venue-public-data-import.test.ts`
- `apps/web/src/styles/push-notifications.css`
- `apps/web/src/lib/releases.ts`
- `apps/web/src/lib/releases.test.ts`
- `apps/web/test/releases.test.tsx`
- `apps/web/test/releases-server.test.ts`
- `docs/handoffs/spb422-identity-import.md`

### Public-data planner

In `planPublicDataItemState`:

- Item **without** `identity`: keep legacy `expectedName`/`expectedAddress` check
  **before** the accepted-receipt branch.
- Item **with** `identity`: keep receipt-first so own rename/address replay still
  `SKIPPED` / `PUBLIC_DATA_REPLAY` against post-identity row.
- Altered fingerprint / drift / foreign collision / CAS continue to FAIL with no
  partial writes. Strict schema, current aliases, rights, immutable old receipts,
  old manifest fingerprints, transactional audit unchanged. No create/geo/city/
  lifecycle/private changes.

### Integration regression (focused)

New disposable PostGIS case: successful contact+profile-only batch → external
name/address change → same batch replay → `FAILED` / `VENUE_IDENTITY_MISMATCH`
with zero additional audit/admin/outbox/identity-key writes; separate own-rename
replay still `SKIPPED` / `PUBLIC_DATA_REPLAY`. Existing CAS / conflict / drift /
collision assertions retained, not weakened.

### Push settings CSS (#496)

Installed alpha.40 measurement: five canonical toggle rows had uneven widths and
misaligned right switches. Added only:

`.fr3 .gb-push-settings__event-list .toggle-row { width: 100%; }`

to existing `push-notifications.css`. No React/auth/API/consent/behavior edits.
No cosmetic implementation-mirroring test; root checks installed browser.

### Release package alpha.41 / API 0.37.0

- `CURRENT_APPLICATION_VERSION` → `0.1.0-alpha.41`; API contract stays `0.37.0`.
- Appended exact trusted ACTUAL alpha.40 seed (`0d6dd485…`, release
  `r42362366120-a1`, `accepted_at` literal `2026-11-07T10:09:04Z`) → 49 historical
  deployments (previous 48 preserved).
- Current named release: `source_sha` null, Owner UAT `NOT_TESTED`.
- Russian notes: existing Admin-operated importer can correct existing venue
  name/address while preserving venue identity; no new creation/geo/rights claimed;
  enables later checked data application; does **not** claim Ceh/Nord names already
  changed; time/venue editing and related push remain deferred; includes narrow
  notification row alignment fix.

## Pre-release status (truthful)

| Gate | Status |
| --- | --- |
| Author source edit | Done in allowed paths |
| Independent QA | Prior FAIL retained; re-run required after this candidate |
| Product CI | Not run / not claimed in this author pass |
| Disposable PostGIS | Root/PM re-run required; not claimed PASS here |
| DEV release / ACCEPTED | Not claimed |
| Owner UAT | `NOT_TESTED` |

## What this importer still is

Minimal backward-compatible extension of `VENUE_PUBLIC_DATA_BATCH_V1` inside the
existing public-data importer (no new tool/service/architecture/rights/migration/
API admin endpoint). Optional per-item `identity` with `name` and/or `address`
only for an **existing** venue UUID. Manifests that omit `identity` keep the same
fingerprint/digest bit-for-bit.

## Known bounds

- Does not create/verify/merge venues; does not mint B4 UIDs; does not change city importer.
- Does not provide Admin UI session; trusted CLI still requires active superadmin.
- Rollback of a bad apply needs a fresh CAS and a new source-backed manifest.
- Attempt 1–2 history (unit PASS; fixture repair for unique physical keys / shared
  discriminator collision) retained; not replayed as new admissions.
