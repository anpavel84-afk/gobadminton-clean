# #406 Venue loader skeleton + desktop gallery arrows

- From: source author (Cursor Auto)
- To: independent QA (Codex Sol Medium by default); parent host for CI/DEV after #506 integration
- Date: 2026-11-07
- Status: WORKING_DRAFT / READY_FOR_INDEPENDENT_QA. Not ACCEPTED, not independent QA PASS, not CI, not DEV release, not Owner UAT.
- Assignment: `OWNER406_ACTUAL_ALPHA44_UAT_SKELETON_AND_DESKTOP_ARROWS`, attempt 1, base `b27f91beceee24029311b9be2e26eca12b343ccb`
- Worktree: `/tmp/gb-cursor-211-owner-quota-rp2oscwy/work` (assignment also named `/home/agentagency-dev/owner-venue406-skeleton-arrows-20261107`)
- Git writes / live runtime / DB / provider / credentials / deploy: not performed (forbidden in this source slice)
- Alpha number: not assigned in this source slice
- #506 / #507 code and release metadata: not edited

## Design inputs actually read

- Astra README + design-manifest.json (delivered under `data/design-inputs/`)
- PNG `page-loading-390.png` and `page-error-1280.png` opened as images
- Read-only reproduction report (LIME FITNESS desktop arrow capture steal; Slow4G racket placeholder)
- Public design URL noted: `https://files.anpavel.ru/projects/gobadminton/design/style-guide/venue-loader/20261107-astra-v1/index.html` (network fetch NOT_TESTED in this offline author pass)

## Exact edits

1. `apps/web/src/lib/venue-illustration.ts` — removed equipment SVG pending data-URI; added `venueMediaSkeletonStyle()` (static paper/line gradients). Kept `VENUE_ILLUSTRATION_URLS` / `venueIllustrationUrl` for published illustration assets.
2. `apps/web/src/components/consumer/venues/VenueGallery.tsx` — interactive-descendant guard before `setPointerCapture` (`closest` covers nested SVG/span glyphs); static skeleton pending; explicit failed/retry and empty no-photo; photo credit only when ready; loading/error captions; optional `onCoverRetry` for morph.
3. `apps/web/src/components/consumer/venues/VenueCover.tsx` — pending skeleton; failed/retry; genuine no-media text; discovery court/trainer preserved without venueId; `allowRetry={false}` for nested picker thumbs.
4. `apps/web/src/components/consumer/venues/SelectedVenueCover.tsx` — shared morph slots use skeleton pending; uploaded failure is terminal failed + `retry()` (no silent illustration fill); null URL with venueId is empty/no-media.
5. `apps/web/src/styles/venue-gallery.css` / `apps/web/src/styles/games.css` — skeleton, status, retry, empty/error frame styles; illustration badge only when ready (not pending/error).
6. `apps/web/src/components/consumer/games/VenuePickerDialog.tsx` — comments only: compact stays free of nested retry; sheet retry remains outside the select button.
7. Tests updated for obsolete racket expectations; new unit guard coverage; new `apps/web/test/venue-loader-navigation.browser.mjs` (Playwright/CDP native mouse, including SVG glyph).

## Checks

| Check | Result |
| --- | --- |
| Design PNG + README/manifest/report read | DONE |
| Targeted unit/browser source edits | DONE (files written) |
| `vitest` venue-cover / venue-gallery / selected-venue-cover | NOT_TESTED — host deps/`node_modules` not installed in this sandbox |
| `node apps/web/test/venue-loader-navigation.browser.mjs` | NOT_TESTED — Playwright `.tools` path may be absent here |
| Product CI / security / DEV smoke | Parent after #506 integration |
| Independent QA | PENDING |
| DEV release / Owner UAT | NOT_TESTED — do not claim PASS |

## NOT_TESTED / limits

- Live LIME FITNESS `/venues/4b44905f-99a3-5be5-8604-77c32247e3cb` Slow4G + real desktop mouse on installed DEV: NOT_TESTED (no live/runtime).
- Authenticated create-game picker retry UX: NOT_TESTED.
- Morph `onCoverRetry` wiring in map parents (`VenuePreviewCard` / `VenueSheet` / popup): prop added; parents outside allowed_paths still pass only `coverFallback` — retry button appears when parent passes `onCoverRetry={resource.retry}`.
- Out-of-scope tests that still expect automatic venue illustration filler (e.g. `venue-popup-owner-fixes.test.tsx`) may FAIL until parent updates them; not edited here.
- WebP negotiation / allowlists / credits / cache hits: preserved by not changing media URL rules; runtime NOT_TESTED.
- No fake DEV or UAT PASS.
