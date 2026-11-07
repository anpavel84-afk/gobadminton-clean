# #406 pass 15 — true no-photo visual illustration (alpha.46)

- From: source author (Cursor Auto), assignment
  `OWNER406_TRUE_NO_PHOTO_VISUAL_ILLUSTRATION_AFTER45`, attempt 15,
  base `2650fcbe21976564b8b1ff90aac67ea4eca5b569`
- To: independent QA → full CI → guarded DEV46 → API/native 390/1280 smoke
- Date: 2026-11-07
- Status: WORKING_DRAFT / READY_FOR_INDEPENDENT_QA. Not ACCEPTED, not
  independent QA PASS, not CI, not DEV release, not Owner UAT.
- Git writes / live runtime / DB / provider / credentials / deploy: not performed
  (forbidden in this source slice). No `.evidence` scratch in repo.

## Owner correction implemented

Text-only «Фотографии площадки пока нет» replaced with the accepted Astra High v2
default illustration path:

- Genuine no published photo/media → `venueIllustrationUrl(venueId)` (FNV-1a,
  one of 4 checked-in WebP). Same venue ⇒ same asset across page/map/compact/picker.
- Ready: raster + visible «Иллюстрация» + alt `Иллюстрация: бадминтон`.
- Pending: static skeleton + `data-pending="illustration"` (no equipment SVG).
- Failed illustration: honest error + bounded retry of the same asset.
- Known uploaded photo failure stays photo error/retry — never disguised as
  illustration. Gallery `data-count` / arrows follow real items only (0 for default).

## Files touched (allowed paths only)

- `VenueCover.tsx`, `SelectedVenueCover.tsx`, `VenueGallery.tsx`
- `VenuePreviewCard.tsx`, `VenuePickerDialog.tsx` (row label outside 64px thumb)
- `games.css` (badge / compact label via `:has`)
- Tests listed in assignment + release catalogue
- `releases.ts` → current `0.1.0-alpha.46` / API `0.37.0`; append alpha.45 from
  trusted seed `2650fcbe…` / `r42393881246-a1` / `2026-11-07T17:12:03Z`
- This handoff

## Author checks run locally

- Vitest (10 files / 206 tests): venue-cover, selected-venue-cover, venue-gallery,
  venue-public-access, venue-popup-owner-fixes, venue-sheet, venue-preview-card,
  venue-sheet-integration, releases.test.tsx, releases-server.test.ts — PASS
- `tsc --noEmit` — no errors on changed venue/release surfaces
- Deterministic check: venue `c64190f9-…` → `racket-v1.webp`
- Browser loopback `venue-loader-navigation.browser.mjs` not executed here
  (needs parent Playwright loopback host); assertions updated for default
  illustration / `data-count=0` / no fake arrows

## Known limits (honest)

- `CURRENT_NAMED_RELEASE.source_sha` remains null until acceptance; UAT=NOT_TESTED
- B1 #506 / moderation #507 not implemented in this slice
- PROD / main product integration not authorized
