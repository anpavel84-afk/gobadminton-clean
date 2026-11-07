# #488 photo import native maintenance + #509 item4 fixed credit slot

From: Cursor Auto (sole source writer). To: independent QA / PM.
Date: 2026-11-07. Status: WORKING_DRAFT — source-only candidate; NOT APPROVED.
Assignment: OWNER488_PHOTO_IMPORT_NATIVE_MAINTENANCE_AND_OWNER509_P4_FIXED_CREDIT_SLOT attempt 1.
Requested base: `608f44e9af26da7ea24881fe31c2c7e49ed8aeb3`. DEV only.
This pass does **not** edit release metadata, invent alpha48/49 acceptance, live photo counts, or touch frozen DEV48 deploy.

## Scope (allowed paths only)

### #509 item4 — stable VenueGallery photo-credit slot
- `apps/web/src/components/consumer/venues/VenueGallery.tsx`
- `apps/web/src/styles/venue-gallery.css`
- `apps/web/test/venue-gallery.test.tsx`

Root cause reproduced in source: morph MAIN loan never sets `framePending`, so slide1 often rendered **no** credit block; swipe to a credited non-morph slide mounted `.gb-venue-gallery__credit` (~margin 8px + meta line ≈ 30 CSS px). Fix: sheet/page always reserve `.gb-venue-gallery__photo-credit` (fixed `--c23-meta-lh` height) for pending/error/ready/empty; morph MAIN shows credit when the shared slot is active; long credits ellipsis without growing height (`title` on the slot wrapper keeps full accessible text); catalog source remains a separate stable sibling; compact `showCredit={false}` gains no slot/spacing. Zero/no-photo stays illustration badge + optional catalog source only (no fake gallery items).

### #488 — native gallery maintenance (no provider I/O)
- `apps/api/src/venues/venue-gallery-maintenance.ts` (new schema/plan/fingerprint)
- `apps/api/src/venues/venue-gallery.service.ts` (export shared `applyOrderedGalleryPositions`)
- `apps/api/src/database/import-venue-covers.ts` (`--gallery-maintenance`, `importVenueGalleryMaintenance`)
- `apps/api/test/unit/venue-gallery-import.test.ts`
- `apps/api/test/integration/venue-gallery-maintenance.test.ts`

CLI (DEV container; dry-run default = 0 DB/media writes; no moderation construction):

```sh
node dist/database/import-venue-covers.js \
  --gallery-maintenance \
  --dir /reviewed-maintenance \
  --manifest batch.json \
  --actor-principal-id <active-superadmin-principal-uuid>
# mutating:
# … --apply
```

Manifest `VENUE_GALLERY_MAINTENANCE_V1`: exact `venueId` / name / address / `expectedVersion`, `orderedActiveIds`, `mainId` (= ordered[0] or null), `removeIds` (soft `active=false`, historical rows retained). Reuses `adminTransaction`, superadmin actor fence, catalog advisory lock, `applyOrderedGalleryPositions`, `projectVenueMainCover`, audited receipt (`venue.gallery_reorder` / `venue_gallery_maintenance`). Same admission key + body fingerprint → conflict; known receipt → SKIPPED replay. Append importer (`--gallery`) semantics unchanged.

Packet note (from supplied REPORT): 138 accepted rows after Owner exclusion of Territory 03 changing-room + 04 café; existing changing-room public item is an exact `removeIds` target; four cover-replacement venues need promote/reorder only (zero new packet rows). Prepared import batches remain separate operator work after this source lands; this pass only adds the maintenance tool + credit UI.

## Out of scope / preserved
- No release metadata, PROD, live DB/service writes, provider budget, moderation redesign, #506 A/B1a/B1b redesign, mass delete, new scheduler/auth, C5, or unknown replay.
- Existing gallery append importer idempotency/unknown attempts unchanged.

## Author checks
Targeted unit/typecheck commands depend on provisioned pnpm 10.18.0 + (for integration) `RUN_DB_INTEGRATION=1` disposable PostGIS. Run in CI / QA environment:

| Check | Target |
| --- | --- |
| Web gallery credit slot | `pnpm --filter @gobadminton/web exec vitest run test/venue-gallery.test.tsx` |
| API maintenance unit | `pnpm --filter @gobadminton/api exec vitest run test/unit/venue-gallery-import.test.ts` |
| API maintenance integration | `RUN_DB_INTEGRATION=1 pnpm --filter @gobadminton/api exec vitest run test/integration/venue-gallery-maintenance.test.ts` |
| Typecheck (web + api) | `pnpm --filter @gobadminton/web --filter @gobadminton/api run typecheck` |

UAT: NOT_TESTED (source pass only; DEV release/finalize later with real alpha48 ACCEPTED seed from PM).
