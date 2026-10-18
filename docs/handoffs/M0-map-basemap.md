# M0 — Games real basemap and honest failures

From: source author / To: independent QA and PM / Date: 2026-10-18
Status: WORKING_DRAFT, UNVERIFIED source-only candidate; no acceptance or deployment claimed.
Base: `84ded9aa95f2a290973c27674172ed072d63e575`, branch `automation/issue-84`; initial worktree clean.
Exact base: https://github.com/anpavel84-afk/gobadminton-clean/tree/84ded9aa95f2a290973c27674172ed072d63e575

## Assignment and effect boundary

Immutable M0 source-only assignment: restore the existing Moscow MapLibre 6.13 / pmtiles 4.5 basemap and diagnose honest failures. Only allowed web source/tests and this handoff may change. No API, database, contracts, dependencies, automation, secrets, services, git metadata, commits, pushes or PROD changes. No network deployment or author self-QA. Publication must be performed by the authorized downstream process; this candidate has no result commit/permalink yet. No additional slice (including M1 missing-coordinate behavior) is authorized.

## Facts, evidence and limits

Source FACT: the previous error listener treated every MapLibre error as unavailable, discarded its cause, accepted `load` without loaded vector tiles, and constructed the Map before checking layout dimensions. Those defects are addressed. The original allowlist already strips `pmtiles://`, parses URLs and accepts the bundle's encoded glyph, sprite, GeoJSON and PMTiles tile forms; no allowlist relaxation was justified. Added positive/negative fixtures preserve its security boundary.

Assignment-reported DEV facts (not independently rechecked by this author): style hash matches; archive/range/header/tiles, fonts, sprites and metro are healthy; iPhone showed markers and attribution but no vector content. The precise cause of missing vector content is NOT PROVEN from source. Zero-sized initialization is a suspect; broad error handling explains the misleading fallback, not necessarily the missing basemap. Do not report a confirmed Safari fix without browser evidence.

## Changes

- Pure diagnostics classify style/identity/origin/WebGL/init/timeout as fatal; tile failure becomes fatal only with zero loaded `protomaps` tiles eight seconds after load. Individual tile/glyph/sprite/GeoJSON errors remain warnings.
- Every classified error logs `[games-map]`, kind, path and status only; canvas container exposes latest kind and cumulative warning count. Raw messages, credentials and query strings are not logged.
- ResizeObserver gates construction on positive width/height; load and first idle resize explicitly. A 20-second startup timeout starts only after measurable layout, then an eight-second vector-tile watchdog replaces it after load. A fatal result cannot be cleared by a later load event.
- Fatal-only white Error card offers Russian reason, retry and list actions. Retry resets state and reruns the existing effect with cleanup (markers, listeners, observers, abort, timers and Map). GamesDiscoveryPage only gains the requested `changeView('list')` callback wiring.
- Existing public venue fallback remains usable and its missing-coordinate condition remains M1 scope. Existing attribution, Radar sharing, camera storage key/restoration, marker presentation/lifecycle and Moscow guard are retained.
- Added pure diagnostics/resource allowlist tests and a mocked Map lifecycle component test, including warning/fatal/retry/list/zero-tiles/zero-width cases. These are authored tests, not executed evidence.

## STYLE_GUIDE_PARITY

Authority: `docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md`; frozen guide https://nougat-wise-76949869.figma.site/#guide and kit https://nougat-wise-76949869.figma.site/#construction-kit.
Reused named families: Error + SurfacePanel + Buttons, using existing SurfacePanel and Button primitives; existing map composition remains in place. No OWNER_VISUAL_OVERRIDE.
STYLE_GUIDE_GAP: exact map-error overlay recipe/frozen source is not available in this checkout; the referenced `docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md` is absent. Bounded extension: a white SurfacePanel positioned over the map with primary retry and outline list actions, leaving bottom attribution exposed. Visual parity is unverified and requires independent review against the frozen guide.

## Required independent checks (not run)

Author self-QA, tests, lint, typecheck and build were not run per explicit assignment ceiling. A1–A5 are not claimed PASS. Independent QA must execute existing web tests, lint, typecheck and build, review allowed-path scope and the new tests, and confirm no dependency changes. No real personal data is needed.

Manual DEV procedure after authorized candidate delivery:

1. In Safari on iPhone and desktop Chrome, open Moscow Games → map. At zoom 10.5 and then 14, verify actual streets, parks, water and labels are visible, with venue markers, attribution and Radar intact. Pan/zoom and resize/orient the viewport. Check `[data-map-ready]`, `[data-map-settled]`, `[data-map-error]`, `[data-map-warnings]` and console; no `[games-map]` entry classified fatal may occur on a successful run. Fatality depends on kind/context; log format intentionally remains the specified four fields.
2. Open a venue and return; verify `gb-games-map-camera` restoration, selection and marker lifecycle. Verify the non-Moscow guard and existing missing-coordinate fallback remain unchanged.
3. With controlled browser request blocking, fail one glyph/sprite/metro/tile after successful render: map/markers remain usable; warning count increments; no fatal card/failure availability transition.
4. Block style or prevent every `protomaps` tile from loading. Verify Russian fatal card (immediate style error, or zero tiles eight seconds after load; startup timeout before load). Expand venue list and navigate to a venue. Unblock, press «Повторить» once: one Map is rebuilt, state resets and basemap returns. Press «← К списку»: Games list opens.
5. If the vector content is still missing, capture sanitized kind/path/status, tile-loading timing and browser evidence; do not infer that `load` or attribution proves basemap success. This is the next bounded diagnosis, not permission to switch tile source/architecture.

## Rollback and next action

Rollback: authorized integrator discards only this M0 candidate diff or reverts its eventual source commit; no runtime or data rollback is involved. Preserve unrelated work.
Next recipient: independent QA, one bounded action: review and verify this candidate against A1–A5, then attach durable results and exact candidate commit permalink through the authorized publishing workflow. PM records delivery/acceptance separately. This author has not published anything.
