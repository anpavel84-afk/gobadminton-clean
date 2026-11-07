# #406 Venue loader skeleton + desktop gallery arrows

- From: source author (Cursor Auto), #506 pass 10 browser-only
- To: parent host rerun of this script on loopback candidate archive, then
  independent delta QA → CI → guarded DEV
- Date: 2026-11-07
- Status: WORKING_DRAFT / READY_FOR_PARENT_BROWSER_RERUN. Not ACCEPTED,
  not independent QA PASS, not CI, not DEV release, not Owner UAT.
- Assignment: `OWNER406_REAL_BROWSER_REGRESSION_REMOVE_SOURCE_TEXT_FALSE_POSITIVE`,
  attempt 10, base `98685c07af807f6bdd408fead67961c0b7d39c19`
- Git writes / live runtime / DB / provider / credentials / deploy / installs:
  not performed (forbidden in this source slice)
- Allowed paths only: browser script + this handoff. No production/API/
  metadata/deps/CI changes.

## Independent QA inputs actually read

- Final integration QA `final.txt` (FAIL @ `98685c07…`): ONE test-only HIGH —
  browser preflight `/shimmer/i` matches a CSS *comment* in `games.css`
  («no spinner/shimmer/equipment SVG») before Playwright starts. Production
  API/UI, fixture repairs, 185 web tests/types/lint, 17 representative PG
  tests already accepted. Prior overly broad racket filename assertion already
  fixed. Not a product/style defect.

## Exact repairs (this pass — browser + handoff only)

1. `venue-loader-navigation.browser.mjs` — removed brittle source-file regex
   preflight (fs/path reads of illustration/gallery/CSS) and unused imports.
   Kept 127.0.0.1 origin guard and actual mounted VenueGallery assertions:
   pending computed `animationName=none` / no inline `svg+xml` / linear-gradient
   background; native mouse including nested SVG; keyboard; horizontal swipe;
   loading → loaded; single-image no arrows; empty neutral text. No new
   source-text literal match; no skip; no copied DOM/handlers; no new deps.
2. This handoff — truthful pass-10 status only.

## Checks

| Check | Result |
| --- | --- |
| QA final.txt read (shimmer comment false positive) | DONE |
| Targeted edits in allowed_paths only | DONE |
| No production CSS/UI/API/deps/CI in this pass | DONE |
| Parent loopback browser rerun vs candidate archive | NOT_TESTED here — parent |
| Independent delta QA / Product CI / DEV | NOT_TESTED — pending |
| Owner UAT | NOT_TESTED — do not claim PASS |

## NOT_TESTED / limits

- Parent will rerun this fixed original browser script against exact candidate
  archive on loopback before final delta QA/CI.
- Installed DEV / Owner UAT / authenticated picker: NOT_TESTED.
- Mode B binding / AGY READY: not claimed.
- Prior CI FAIL `42388403418`, paid attempts, and UNKNOWN retained.
