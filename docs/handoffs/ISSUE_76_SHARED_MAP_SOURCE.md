# Issue 76 — shared fullscreen map source

From: source author. To: independent exact-SHA QA / PM. Date: 2026-10-18.
Status: WORKING_DRAFT, uncommitted source only; no acceptance claim.
Base: 598bc7ab846db214530dcb6e6fa4b978a3da1e07, automation/issue-76, initially clean.
Scope: immutable Issue 76 source_only assignment supplied by dispatcher; successor of blocked #68, not based on PR #74. Single writer. No git metadata, automation, services, credentials or releases authorized.

## Pre-edit behaviour inventory (preserve)

- GeographicRadarMap: approved style hash/resource validation, PMTiles worker, timeout/error fallback, bounds/rotation constraints, resize cleanup, keyboard map label, controller camera, valid coarse person coordinates, publicPlayerId selected state, initials, click selection, venue fetch/popup/address, counts/failure status, published coarse-centre neighborhood, manual zoom/fit.
- RadarPage: session/config/city eligibility; current-activation query and 30-second recovery; expiring-pin fence and exact deadline tick; map page fetch and nextMapCursor/map(true); persistent RadarStatusAffordance; selected/list sheet, close, expansion, touch gestures, focus restoration; unavailable/auth fallback; body lifecycle cleanup.
- RadarSessionProvider / RadarStatusAffordance: persistent identity/config controllers, session epoch fencing, CSRF/config reconciliation, visibility/private expiry handling, timers, permission observation; status/countdown, explicit consent/start/renew/location/stop, popover outside/Escape and native consent dialog. Preserve API/privacy semantics.
- RadarControls: entry/toggle, status/recovery, geolocation acquisition and honest notice paths; unchanged.
- UnifiedPlayerPreview: publicPlayerId lookup, exact expiry fences, preview loading, Avatar fallback, level/distance/uncertainty, profile/contact permissions, dialog option, Escape and focus.
- GamesMapViewport: visualViewport resize/scroll and ResizeObserver lifecycle, zero scroll on entry, frame measurement; extend for fullscreen without deleting bounded mode.
- GamesDiscoveryPage: city/day/activity URL/history, list-scroll/page-depth persistence, all pagination/loading/stale/error/empty/retry paths, request fences/cache, focus/visibility refresh, create/auth, hero/filter/cards/sidebar; keep list composition.
- radar-controller / radar-camera: consent/session/lease/location/privacy state machine and coarse neighborhood validation; unchanged.
- GamesMapView / GamesVenueMap: public venue + complete upcoming-game polling, day/type eligible counts, zero-game venues, missing-coordinate/unavailable list fallback, exact venue route and returnTo, approved basemap, keyboard/pan/pinch, marker drag suppression/ID reconciliation, selected ring, saved camera.

## Plan / recovery

Extend existing map components to share one MapLibre instance and reuse GeographicRadarMap person paths; use existing presentation tokens/Avatar and consent. Expected files: consumer games/radar/pages/icon components, styles, test specification and this handoff only. Rollback: discard this task's source diff via authorized integrator; no runtime change exists. Author does not run self-QA per assignment. Independent QA must execute checks, browser evidence and hosted gates after candidate publication by dispatcher.

## STYLE_GUIDE_PARITY

Read binding frontend decision and local consumer tokens/icons. Reuse Button, Avatar, Modal/Drawer, focus and palette families. Canonical references: https://nougat-wise-76949869.figma.site/#guide and https://nougat-wise-76949869.figma.site/#construction-kit . OWNER_VISUAL_OVERRIDE: immutable assignment cites Owner 17Oct2026 12:32-03 / 12:40-03 OPTION3 Svetlaya kapsula (white/lime/violet capsule and fullscreen composition). STYLE_GUIDE_GAP: referenced operations guide, frozen PLAN source and local reference capture absent; exact Make parity UNVERIFIED. Native shuttlecock extends current icon system using the same stroke/palette; no bitmap.

## Source result / behaviour deltas

- Both `/games?view=map` and `/players/radar` now compose existing GamesMapViewport → GamesMapView → GamesVenueMap. GamesVenueMap gives its loaded MapLibre instance to existing RadarPage → GeographicRadarMap. No second map is constructed in shared mode. GeographicRadarMap's standalone map/resource/venue-popup paths remain intact.
- ConsumerShell gains an optional fullscreen flag; Games removes its navigation components while in map mode, avoiding a second mounted consent owner. Existing RadarStatusAffordance is mounted once on the map. Native consent, controls, duration and API semantics remain. Escape in native/external role dialogs is guarded.
- Fullscreen viewport measurement follows visualViewport dimensions/offsets, independently of app chrome. Previous bounded measurement remains the default. Existing list geometry/content is preserved except the authorized entry capsule and coherent desktop entry.
- Same public venues, all upcoming-game pages, chronological schedules, day/type filters, eligible green counts, selected/focus rings, pointer-drag guard and exact venue/game routes remain. A native SVG feather fan + cork replaces the court glyph on white disks. Valid missing-coordinate fallback remains; coordinates are not synthesized.
- Shared mode omits legacy header/summary/camera controls visually; their original code paths remain available in standalone mode or the retained sheet. To preserve pagination without permanent controls, dragging requests the existing next bounded map window; PageDown does the same, L opens the existing list sheet. Canvas aria-description documents these shortcuts. Hidden legacy summary uses `hidden`, so it creates no invisible focus stops. No people accumulation/export is introduced.
- Person markers use existing Avatar and publicPlayerId selection. Current identity's existing social-profile projection supplies own avatar/publicPlayerId; only published coarseCenter supplies its coordinate. Own marker is 60px vs 48px neighbours, with purple/white token ring. Nearby venue presentation offsets avoid coverage; underlying coordinates stay unchanged. No ID-specific logic.
- `createRadarEntryCamera` extends radar-camera's existing validation: claim first valid published neighborhood once per entry, regardless of saved camera; subsequent publication/toggle updates do not reframe. Explicit venue return resumes saved view. Camera is saved on return, venue activation, pagehide and unmount, not every move. No continuous tracking.
- Preview uses the existing native ProfileDialog option (visible close button, focus containment, Escape); marker click explicitly focuses its own button before existing selection. Same-URL preview history entry lets browser Back close it before leaving map. Original sheet close/expand/touch handlers remain. Mobile return chooses a rendered entry button, and GamesViewAction rebinds its nav measurement when view changes.

## R1–R7 evidence contract (authored, NOT executed)

No author self-QA is authorized. The following are coverage definitions, not PASS results.

| ID | Automated test or explicit browser assertion for independent QA |
| --- | --- |
| R1 | `apps/web/test/shared-map-return.test.ts`: delayed/invalid publication, fresh entry, repeated publication/OFF-ON, new entry and explicit venue resume. In a legitimate Radar-ON session set a different saved camera, enter fresh, assert own marker midpoint equals canvas midpoint within 2px; pan/zoom, refresh publication and assert camera stays at manually chosen position. Leave/re-enter and verify fresh centring; venue → Back must resume the previous camera. |
| R2 | Existing UnifiedDirectoryController.map(next) is unchanged: nextMapCursor and limit 100 remain. Browser assert a legitimate multi-page query: drag, observe `/v1/players/query/map` body uses current nextMapCursor and `limit:100`, then PageDown and assert a later-page publicPlayerId is reachable. Window replacement must remain bounded, not accumulation. |
| R3 | At both entry URLs, use the existing status affordance in an authorized authenticated UAT session. Record canvas geometry, venue IDs/counts, filters and camera after initial centring; OFF must remove `.g2-person-marker` and their focus stops, leave venue/camera/filter state untouched; ON again must not reframe the same entry. No guest pin may appear. |
| R4 | Two permitted rows with identical displayName and distinct publicPlayerId: click first, assert only its button aria-pressed=true and exact preview ID; close, click second, assert inverse. Existing selection/update path compares publicPlayerId; names are labels only. |
| R5 | At both entries open consent: assert `dialog[open]`, press Escape, assert consent closes/cancels, URL and canvas/camera remain, no onBack. Repeat with an external `[role=dialog]` to verify page Escape guard. Popover itself must still close with Escape. |
| R6 | `apps/web/test/shared-map-public.browser.mjs` asserts mobile rendered `На карте` gets activeElement after return, and capsule geometry/gap. At desktop assert visible desktop entry receives focus. Repeat Escape and browser Back and check city/day/activity, list scroll/page depth. No display:none desktop twin may receive focus. |
| R7 | Tap actual person marker on mobile; assert native preview `dialog[open]`, visible enabled close button with >=44px target, focus remains inside while Tab cycles. Close by button, Escape and browser Back separately; each must return focus to that exact connected marker, preserve map and avoid a second history back. Original sheet L/close/expansion/touch paths also require regression assertions. |

## Verification and evidence status

- NOT_RUN: unit tests, typecheck, lint, build, all hosted Product CI including Admin, independent source QA.
- NOT_TESTED: actual public browser, real MapLibre/tiles/live API, geometry and screenshots (before/after), authenticated Radar UAT, physical iOS/WebKit.
- Authored `shared-map-public.browser.mjs` for independent Chromium public guest execution against DEV only; it captures screenshots/geometry, full viewport/rotation, attribution, markers/hit targets, keyboard pan, no private pins, no API mutations, list capsule gap/focus. This is not synthetic evidence and has NOT been executed. Existing local fallback tests remain synthetic/local; neither replaces real browser evidence.
- No commit/push/metadata changes or network/deployment actions performed. There is no new candidate SHA or exact result permalink until the authorized dispatcher publishes these working-tree files. Base permalink: https://github.com/anpavel84-afk/gobadminton-clean/tree/598bc7ab846db214530dcb6e6fa4b978a3da1e07 . Publication remains the dispatcher's responsibility under the source-only restriction.
- No DEV release, three-image backup/rollback, root ACCEPTED, live META exact-SHA/no-Pending or Owner acceptance claimed. Those gates remain required after fresh independent exact-SHA QA.
- Preserve historical #66 geometry FAIL, #54 FAIL and blocked #68/PR #74 records. Historical UAT PASS on `3c1f7c84` proves nothing for this source. No counters or immutable assignments changed.

Next bounded action: authorized dispatcher publishes this candidate and handoff, then assigns independent exact-SHA source QA and the existing hosted gates. Browser/authenticated assertions above remain open until actual evidence exists. Do not mark this source accepted or deploy from chat.

Additional authored coverage (NOT_RUN): `shared-map-controller.test.ts` exercises the actual unchanged UnifiedDirectoryController wire request for R2 (`map(true)`, exact cursor, limit 100, bounded window, no extra request at end), and R4 same-name distinct-ID preview/resultRef selection plus OFF privacy clearing. DOM focus/pressed state and authenticated UAT assertions remain open.
