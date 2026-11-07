# #406 Venue loader skeleton + desktop gallery arrows

- From: source author (Cursor Auto), repair attempt 2
- To: independent delta QA (Codex Sol Medium by default); parent host for affected tests/types/lint/browser, then CI/DEV after #506 integration
- Date: 2026-11-07
- Status: WORKING_DRAFT / READY_FOR_INDEPENDENT_DELTA_QA. Not ACCEPTED, not independent QA PASS, not CI, not DEV release, not Owner UAT.
- Assignment: `OWNER406_REPAIR_INDEPENDENT_QA_AND_HOST_REGRESSIONS`, attempt 2, base `79fad6efaee798034286f8330309ef239e9ec9e7`
- Worktree: `/tmp/gb-cursor-211-owner-quota-fcbqukai/work`
- Git writes / live runtime / DB / provider / credentials / deploy / installs: not performed (forbidden in this source slice)
- Alpha number: not assigned in this source slice
- #506 / #507 / PR #508 code and release metadata: not edited

## Design / QA inputs actually read

- Independent QA `final.txt` (FAIL @ `79fad6ef…`): empty coverSlot blank; missing `onCoverRetry` wiring; single picker thumb no retry; browser script DOM+handler copy + lint `getComputedStyle` no-undef
- Host `host-web-target.log`: 85 PASS / 5 FAIL (selected-venue-cover ×3, venue-gallery compact caption, venue-popup-owner-fixes illustration filler)
- Host `host-web-lint.log`: 2× `getComputedStyle` no-undef in `venue-loader-navigation.browser.mjs`
- Prior handoff + Astra loader addendum semantics retained (static paper/line skeleton; interactive-descendant guard before `setPointerCapture`)

## Exact repairs (attempt 2)

1. `VenueGallery.tsx` — zero-gallery `coverSlot` without published URL overlays neutral «Фотографии площадки пока нет» on the single morph slot (compact + expanded); compact pending no longer emits visible/sr «Загружаем…» caption; desktop nav uses nested SVG glyphs (pointer cause unchanged: `closest` interactive guard).
2. `SelectedVenueCover.tsx` — `fallback` is a live getter over `getSnapshot()` while `useSyncExternalStore` still drives parent re-renders (preserves selected-resource error + StrictMode assertions without stale boolean).
3. `GamesMapView.tsx` → `VenuePreviewCard.tsx` / `VenueSheet.tsx` → `VenueGallery` — wire `onCoverRetry={selectedCover.retry}`.
4. `VenuePickerDialog.tsx` — sibling photo sheet when `photos >= 1` so a single failed thumb has reachable retry outside the select button (no nested controls).
5. Tests: popup create-game empty → neutral empty; gallery compact caption + morph empty; picker single-photo sheet; preview/sheet retry forwarding; obsolete illustration expectations aligned.
6. `venue-loader-navigation.browser.mjs` — replaced fixture DOM+copied handlers with actual VenueGallery on parent loopback `:18984` (guest synthetic fixtures only); lint globals include `getComputedStyle`.

## Checks

| Check | Result |
| --- | --- |
| Independent QA findings + host fail/lint logs read | DONE |
| Targeted source edits in allowed_paths only | DONE |
| No `.evidence` / out-of-scope scratch in product source | DONE |
| `vitest` affected suites / types / lint / browser | NOT_TESTED here — host deps/`node_modules` / Playwright `.tools` / loopback Next absent in this author sandbox; parent reruns |
| Product CI / security / DEV smoke | Parent after #506 integration (do not touch #506 candidate) |
| Independent delta QA | PENDING |
| DEV release / Owner UAT | NOT_TESTED — do not claim PASS |

## NOT_TESTED / limits

- Host rerun of the 5 prior FAILs + lint + actual browser against loopback 18984: parent.
- Live LIME FITNESS Slow4G + real desktop mouse on installed DEV: NOT_TESTED.
- Authenticated create-game picker retry UX: NOT_TESTED (source path wired; no live session).
- Mode B binding / AGY READY: not claimed.
- No fake DEV or UAT PASS. Prior source/cost/HOLD retained; no paid replay.
