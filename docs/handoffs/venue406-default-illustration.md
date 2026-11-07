# #406 attempt 17 — illustration retry / aria-busy / ImgProps type repair

- From: source author (Cursor Auto), assignment
  `OWNER406_ILLUSTRATION46_QA_RETRY_BUSY_TYPE_REPAIR`, attempt 17,
  base `f73d3fd58450be843481d5464926de20aa8d9cb6`
- To: independent QA (parent reuses full 1566 / browser where unchanged)
- Date: 2026-11-07
- Status: WORKING_DRAFT / READY_FOR_INDEPENDENT_QA. Not ACCEPTED, not
  independent QA PASS, not CI, not DEV release, not Owner UAT.
- Git writes / live runtime / DB / provider / credentials / deploy: not performed
  (forbidden in this source slice). No release metadata / backend / M1 / #506.

## Owner / Sol Medium findings addressed

Independent Sol Medium reported TWO MEDIUM on completed pass15 `f73d3fd`:

1. **Picker zero-photo retry** — `VenuePickerDialog` sibling sheet expander was
   gated on `photos >= 1`, so compact (retry hidden) left genuine no-photo
   illustration with no reachable retry when default WebP failed. Fix: also open
   the existing `gb-venue-picker-photos` details for `showDefaultIllustrationLabel`
   with summary «Иллюстрация» and sheet `VenueGallery` (allowRetry). No nested
   buttons inside the select row, no fake gallery items, no fourth grid child.
   Real-photo `Фото · N` path unchanged.

2. **Zero-gallery aria-busy** — empty `VenueGallery` sheet/page and morph
   `coverSlot` (no legacy URL) now mirror shared cover/illustration
   pending/ready/error into `aria-busy` via `ZeroGalleryChrome` (capture +
   MutationObserver on the existing cover node; `coverFallback` wins for morph
   error). No second image request.

3. **Typecheck** — previous handoff claimed clean `tsc` on changed surfaces; actual
   full web typecheck failed:
   `test/venue-cover.test.tsx(222,29) TS2339 Property 'alt' does not exist on type 'ImgProps'`.
   Fix: add `alt?: string` to the test `ImgProps` mock typing (no `any` / cast hide).

Preserved: Astra v2 choices, existing 4 WebP, real-photo vs illustration error
distinction, native mouse guard / `draggable={false}`, keyboard/touch/map
gestures contract, release46 seed (untouched).

## Files touched (allowed paths only)

- `apps/web/src/components/consumer/games/VenuePickerDialog.tsx`
- `apps/web/src/components/consumer/venues/VenueGallery.tsx`
- `apps/web/test/venue-cover.test.tsx`
- `apps/web/test/venue-gallery.test.tsx`
- `apps/web/test/venue-preview-card.test.tsx` (unchanged content; in scope)
- `apps/web/test/venue-loader-navigation.browser.mjs` (aria-busy clear after ready)
- `docs/handoffs/venue406-default-illustration.md` (this file)

## Author checks run locally

- Vitest targeted: `venue-cover`, `venue-gallery`, `venue-preview-card` —
  3 files / 65 tests PASS (includes picker zero-photo failure→retry and
  aria-busy pending→ready/error regressions; original native mouse/touch
  gallery gesture tests preserved PASS)
- `tsc -p tsconfig.json --noEmit --incremental false` (apps/web) — PASS
  (previous ImgProps.alt FAIL corrected)
- `eslint .` (apps/web) — PASS
- Full host Vitest 157/1566 and actual browser loopback — not re-executed here;
  parent reuses unchanged suites and re-runs browser if relevant. Browser file
  asserts `aria-busy` is not `"true"` after default illustration ready.

## Honest corrections vs prior handoff

- Pass15 handoff types claim was incorrect: full typecheck had TS2339 on
  `ImgProps.alt`; recorded here and fixed in the test mock.
- Not claiming independent QA, Product CI, DEV ACCEPTED, or Owner UAT.

## Known limits

- `CURRENT_NAMED_RELEASE` / release catalogue not modified in this repair
- B1 #506 / moderation not in scope
- PROD / main product integration not authorized
