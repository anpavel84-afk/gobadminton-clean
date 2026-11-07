# #406 Venue loader skeleton + desktop gallery arrows

- From: source author (Cursor Auto), #506 pass 11 native image drag
- To: parent host rerun of targeted UI types/lint/tests + original browser
  against exact candidate; then independent delta QA → CI → guarded DEV
- Date: 2026-11-07
- Status: WORKING_DRAFT / READY_FOR_PARENT_RERUN. Not ACCEPTED, not
  independent QA PASS, not CI, not DEV release, not Owner UAT.
- Assignment: `OWNER406_ACTUAL_NATIVE_IMAGE_DRAG_POINTERCANCEL_REPAIR`,
  attempt 11, base `43f60f8ec5eacb1eae859978cae27883a4359e0c`
- Git writes / live runtime / DB / provider / credentials / deploy / installs:
  not performed (forbidden in this source slice)
- Allowed paths only: 3 media components + regression tests + this handoff.
  No #506 text policy/fixtures, #507, API, deps, CI, or PROD changes.

## Independent inputs actually read

- Pass-10 `actual-swipe-failure.json`: pointerdown IMG → pointermove DIV
  (capture) → native HTML dragstart IMG → pointercancel DIV; no pointerup;
  count stays 1/2 (expected 2/2). Other native arrow 390/1280 checks PASS.
  Genuine horizontal IMAGE drag failure — not a source-regex issue.

## Exact repairs (this pass)

1. `VenueGallery.tsx` — current gallery `<img>`: `draggable={false}` +
   `onDragStart` preventDefault. Gestures/capture/interactive guard unchanged.
2. `SelectedVenueCover.tsx` — morph `document.createElement("img")`:
   `draggable = false` + dragstart preventDefault before src (gallery borrows).
3. `VenueCover.tsx` — owned cover/fallback `<img>`: same draggable=false +
   dragstart preventDefault. No controller/dimensions/pipeline/API changes.
4. `venue-gallery.test.tsx` — bounded regression: img draggable false,
   dragstart preventDefault, pointercancel clears drag (no late advance).
5. `selected-venue-cover.test.tsx` — fixture requires draggable=false before src.
6. `venue-loader-navigation.browser.mjs` — swipe starts on actual IMG; asserts
   no dragstart/pointercancel and count 2/2. Native assertion kept (not skipped).
7. This handoff — truthful pass-11 status only.

## Checks

| Check | Result |
| --- | --- |
| Pass-10 swipe failure JSON read | DONE |
| Minimal media-image drag disable | DONE |
| Gestures / interactive guard / ownership preserved | DONE (source) |
| Targeted unit tests (gallery + selected cover) | NOT_TESTED here — no node_modules; parent |
| Parent loopback original browser vs candidate | NOT_TESTED here — parent |
| Independent delta QA / Product CI / DEV | NOT_TESTED — pending |
| Owner UAT | NOT_TESTED — do not claim PASS |

## NOT_TESTED / limits

- Parent reruns targeted UI types/lint/tests and actual original browser on
  exact candidate archive before final delta QA / CI7 → guarded DEV45.
- Installed DEV / Owner UAT / authenticated picker: NOT_TESTED.
- Mode B binding / AGY READY: not claimed.
- Prior attempts/FAIL/UNKNOWN and costs retained; no paid whole-architecture
  reanalysis.
