# Regions #485 — compact attribution + qualified import residue

Source-only continuation (Owner Direct #485, attempt 8). Closes compact map-card attribution layout and bounded operator import extensions. No PROD, no author-side apply/deploy/GitHub.

## Files (this milestone)

- `apps/web/.../VenueGallery.tsx` — optional `showSourceCredit` (default true), separate from photo `showCredit`
- `apps/web/.../VenueSourceCredit.tsx` — `compactPrimary` variant (first club source only)
- `apps/web/.../VenuePreviewCard.tsx` / `VenuePickerDialog.tsx` — source credit sibling footer outside select/row buttons; restore 64px / minmax(0,1fr) / 44px row
- `apps/web/src/styles/venue-popup.css` / `venue-gallery.css` — with-source 100px row + 28px footer inside existing 128px preview budget
- `tools/venues/import-badminton4u-regions.cjs` (+ `.test.cjs`) — optional `sourceVenueAliases`, optional `reviewResolution`, enriched-contact same-digest SKIP
- `apps/web/src/lib/releases.ts` — alpha.32 / API 0.36.0 candidate; historical seed for accepted alpha.31
- This handoff

## Operator adapter extensions (optional manifest fields)

Strict V1 manifests without the new keys stay byte-compatible (no extra markers).

### `sourceVenueAliases` (optional string[])

Example (Rostov same physical hall, clubs 198+269):

```json
{
  "sourceVenueId": "B4U-V-8CAA0D60",
  "sourceVenueAliases": ["B4U-V-0123E53D"],
  "clubSources": [
    { "clubId": "B4U-C-198", "name": "…", "url": "https://badminton4u.ru/clubs/198" },
    { "clubId": "B4U-C-269", "name": "…", "url": "https://badminton4u.ru/clubs/269" }
  ]
}
```

- Primary canonical UUID remains `uuidv5(namespace + primary sourceVenueId)`.
- Each alias is strict `B4U-V-[0-9A-F]{8}`, non-primary, unique in the batch, and must not collide with another row or durable `SOURCE_VENUE_ID=` marker.
- Persisted as extra `SOURCE_VENUE_ID=` markers plus `sourceVenueAliases` inside `B4U_SOURCE_V1` JSON.
- Same canonical manifest replay → SKIP (no extra audits/outbox). No name-only merge.

### `reviewResolution` (optional object)

Example (Dinsk / Ramon-style explicit public correction; original archive untouched):

```json
{
  "reviewResolution": {
    "kind": "EXPLICIT_PUBLIC_SOURCE_ADDRESS_POINT_CORRECTION",
    "original": {
      "address": "Динская",
      "latitude": null,
      "longitude": null,
      "sourceVenueId": "B4U-V-F943CB45",
      "importReady": "no",
      "collectedAt": "2026-10-07"
    },
    "corrected": {
      "address": "Краснодарский край, станица Динская, улица Тельмана, 139/1",
      "latitude": 45.1964268,
      "longitude": 39.2437748
    },
    "primaryAddressSourceURL": "https://sport-dinsk.ru/…",
    "pointSourceURL": "https://nominatim.openstreetmap.org/…",
    "pointCheckedAt": "2026-11-06T17:17:43.100165+00:00",
    "reason": "…"
  }
}
```

- Whitelists original tuple; corrected address+point must match the manifest venue row exactly.
- URLs are public HTTPS only (no credentials); adapter does not fetch/execute them.
- Persisted as `B4U_REVIEW_RESOLUTION_V1=…` in `review_markers` before trusted apply; never silently replaces a verified point.
- Existing 40 km / 150 m PostGIS gates unchanged. Absent field → no resolution marker (legacy digest replay compatible).

### Enriched contact replay

Same `sourceVenueId` + same `REGIONS485_DIGEST` + matching identity/source markers → SKIP even when `public_contacts` were later enriched (preserves TennisNSK-style authorized public-data updates; zero writes). Different digest / identity collision still refuses. No blind skip of arbitrary existing UUIDs.

## Runtime assumptions

Execute import inside the existing API container (`cwd` `/app/apps/api`). Trusted parent owns: disposable PostGIS integration, reviewed manifest `--apply` on DEV, Product CI, and DEV acceptance. Author must not run live import/deploy or copy About/photos/logos/reviews/Raw phone/FIO.

## Out of scope / limitations

- Claiming Mode B / AGY READY, QA PASS, Owner UAT, or DEV ACCEPTED
- PROD, main merge, live DB, media pipeline, privilege broadening, new tables/services/schedulers
- Fake deploy receipt/date for the current alpha.32 candidate
