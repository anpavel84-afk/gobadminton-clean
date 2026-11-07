# #488 / #509 · CI repair3 — morph pending is not ready (PR #513)

From: Cursor Auto (sole source writer). To: independent QA / CI / parent.
Date: 2026-11-07. Status: SOURCE_REPAIR_CANDIDATE — author checks only; no push / DEV.49 / GoBad PASS.
Assignment: `OWNER488_CI_WEB_MORPH_PENDING_IS_NOT_READY_REPAIR` attempt 3.
Base: `2596c2fc542960293ac78428b3c980063f2331d8`. Same PR #513. No next alpha.50; alpha.49 not accepted.

## Known CI failure (Product CI 42415393574 source web)

- Job: source (web) — **FAILED 1 of 1573**; other jobs still running — do not interrupt/replay.
- `test/selected-venue-cover.test.tsx` F1 line 590:
  - New venue morph owns **PENDING** photo; expect no `Фото: Клуб`; actual rendered photo credit.
  - Root cause: `VenueGallery` treated `useMorphSlot` (borrowed physical DOM img) as decoded ready.
  - Meaningful truthful-readiness regression — not a stale fixture. F1 negative assertion retained.

## Fix (allowed paths only)

| Path | Change |
| --- | --- |
| `SelectedVenueCover.tsx` | Expose live `ready` getter (`loaded && !failed`); syncVersion + emit on real decode; fallback getter unchanged |
| `VenueGallery.tsx` | Optional `coverReady`; ready credit only when `imageReady \|\| (useMorphSlot && coverReady)`; morph pending keeps reserved caption |
| `GamesMapView.tsx` / `VenueSheet.tsx` / `VenuePreviewCard.tsx` | Forward `coverReady` from shared resource |
| `selected-venue-cover.test.tsx` | Wire `coverReady`; keep F1; add load/remount/failure+retry/stable-row readiness cases |
| `venue-gallery.test.tsx` | Morph loan alone ≠ credit; credit only with `coverReady` |
| `venue-sheet` / `venue-preview-card` tests | Forward `coverReady` |

Constraints kept: one physical img; no invented readiness via `!fallback`/slot presence; fallback/API back-compat; no new image loader/M1; caption height stable; defaults/retry/gestures/map untouched; no PROD/C5/alpha.49 DEV claim.

## Author checks (not Product CI / not independent QA)

Targeted: `selected-venue-cover` + `venue-gallery` + `venue-preview-card` (+ sheet forward) + web typecheck.
Parent runs full Web 157 files for the actual CI regression. No fake full-CI / DEV.49 / GoBad PASS.

## Honest status

- Independent QA 2596 PASS retained for prior fullsource; this is **CI repair** on same candidate lineage.
- Product CI web FAIL at base is the repair target; author results are local evidence only.
- Admin UI / Owner / GoBad UAT: **NOT_TESTED**. Private egress OFF. PROD/C5/slots untouched.
