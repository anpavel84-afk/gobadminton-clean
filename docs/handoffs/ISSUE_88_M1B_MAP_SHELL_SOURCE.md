# M1 — полноэкранная оболочка карты

From: source author / To: independent QA, authorized integrator / Date: 2026-10-18
Status: WORKING_DRAFT — UNVERIFIED source-only candidate. No deployment or acceptance.

## Assignment, base and effects

Exact base: `1d24f50dc8cb16c3f05f9611b840d5a9790c3bcf`, branch `automation/issue-86`, initially clean.
Base permalink: https://github.com/anpavel84-afk/gobadminton-clean/tree/1d24f50dc8cb16c3f05f9611b840d5a9790c3bcf
Immutable assignment: M1 after assignment-reported M0 DEV acceptance; web-only fullscreen map shell with one return control, final white/lime/selected venue markers, bounded screen separation and safe areas. Existing Moscow MapLibre 6.13 / pmtiles 4.5 only. No new API, contracts, DB, dependencies, services, automation, secrets, real personal data, PROD or M2 navigation changes.
Local `dev` ref does not exist; current checkout source was reread. Remote DEV freshness and M0 acceptance were not independently verified. No network fetch, commit, push or git metadata writes authorized or performed. Result permalink must be added by the authorized publishing process; this local document is not yet durable GitHub publication.

## Source changes

- GamesDiscoveryPage renders search and city notice only in list mode; removes map context/chips and focuses the new return button through the existing map-open effect. URL day/activity state and changeView history/scroll flow remain.
- GamesViewAction returns null for map mode. GamesMapView owns the new return capsule and hides it when M0 reports unavailable; M0 retry/list callback prop remains intact. Toolbar removed. Loading messages use clipped status text; catalog/schedule errors and unsupported-city alert remain visible.
- Coordinates fallback appears only for map failure or unsupported city. Missing coordinates are still excluded by existing marker reconciliation.
- selectedVenueId optionally controls aria-pressed; absent value uses existing sessionStorage. Selection ring preserves white/lime base states and has highest venue stacking. Marker activation still opens the venue page.
- separateMarkerPoints returns ID-ordered deterministic offsets, zero for isolated points, capped at 22px (within both the 28px budget and the smallest 44px target radius). Own-marker avoidance is applied separately after these bounded venue offsets, preserving the existing 64px clearance without capping it to the venue radius. Recomputed on moveend, zoomend and own-marker updates. Coordinates never change. Dense clusters are best-effort; complete non-overlap within a bounded radius cannot be guaranteed.
- Fullscreen map area fills the measured dynamic viewport; existing Radar and inset attribution retained. Authored pure/component tests and refreshed browser scripts cover new shell expectations.

## STYLE_GUIDE_PARITY

Authority: docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md; https://nougat-wise-76949869.figma.site/#guide and #construction-kit, plus assignment's Owner-approved UI V001.
Reused existing map-return capsule primitive and foundation tokens (white, purple, lime, pill, shadow); M0 SurfacePanel/Error/Buttons retained. V001 is the exact screen composition authority in this assignment.
STYLE_GUIDE_GAP: referenced docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md and frozen Make source are absent in this checkout; external guide not inspected. Visual parity is unverified. No additional OWNER_VISUAL_OVERRIDE inferred.

## Evidence and next bounded action

No self-QA, tests, lint, typecheck, build or browser checks run, per explicit instruction. Authored tests are not PASS evidence. No independent QA supplied (`{}`).
Next recipient: independent QA, verify A1–A6 on the published candidate: one return control, M0 retry/list exclusivity, URL/focus/Back, unchanged full list UI, zero/positive/unavailable counts and selected ring, separation stability/cap, fallback conditions, Radar/camera/lifecycle, safe areas at 390/430, short/landscape; run web tests/lint/typecheck/build and record exact candidate permalink. Integrator must first confirm base freshness against actual DEV without reverting others' work.
Rollback: discard only this candidate diff, or revert its eventual source commit through the authorized integrator. No runtime/data rollback needed. Do not reinterpret source authorship as QA, release, Owner acceptance or permission for M2.

## Correction after independent QA FAIL — 2026-10-18

Source author → independent QA / authorized integrator. Status: WORKING_DRAFT — UNVERIFIED.
Exact correction base: `97707b1f73d40249dda277c2b632d5bd91472d10`, branch `automation/issue-86`, clean before edits.
Reviewed base: https://github.com/anpavel84-afk/gobadminton-clean/commit/97707b1f73d40249dda277c2b632d5bd91472d10

Supplied independent QA verdict: FAIL. Finding: the combined 22px clamp regressed the existing 64px own-marker separation, leaving coincident venue and own-marker targets overlapping.
Correction scope: only GamesVenueMap.tsx and this handoff. Bounded venue separation is applied first; own-marker distance is calculated from that displaced screen point and any remaining distance to 64px is added without a final clamp. Coincident displaced points use the existing positive-X fallback. Geographic coordinates, pure venue offset bounds, map events and UI patterns remain unchanged.

STYLE_GUIDE_PARITY: no new visual pattern or composition; retains the M1 marker primitives and restores existing own-marker clearance. Existing guide availability limitation above remains.
No self-QA, tests, lint, typecheck, build or browser checks run, as instructed. The correction is not a PASS claim. No commit, push, git metadata write, network deployment or runtime change performed. Current DEV freshness beyond the supplied checkout is unverified.
Next bounded action: independent QA recheck coincident points, a venue offset toward the own marker, and ordinary bounded venue separation; run required acceptance checks on the authorized published candidate. The authorized publisher must attach the correction permalink; none exists yet for these local edits.
Rollback: undo only this correction's local source and handoff edits against the exact correction base; preserve all prior M1 work.

## Issue 88 — M1b successor, 2026-10-19

From: source author. To: independent QA / authorized integrator.
Status: WORKING_DRAFT — UNVERIFIED, source-only; supersedes the implementation notes above where D1–D3 are concerned. Original M1 handoff content above is retained verbatim as historical source, not a fresh PASS claim.

Assignment: Issue 88 successor of blocked Issue 86 (three attempts exhausted; candidate 135bc87310e4184e09779f8ecda0fa42a1d39e48, PR 87). Do not change Issue 86, its branch/PR, counters or runtime. Implement only M1 reapplication plus D1–D3; no M2, API, database, contracts, dependencies, automation, secrets, services or PROD. User-supplied prior independent QA for this task is `{}`; predecessor D1 failure is assignment-reported.

Exact initial base: `1d24f50dc8cb16c3f05f9611b840d5a9790c3bcf`, clean worktree `automation/issue-88`.
Re-applied from `135bc87310e4184e09779f8ecda0fa42a1d39e48`:
https://github.com/anpavel84-afk/gobadminton-clean/commit/135bc87310e4184e09779f8ecda0fa42a1d39e48
The exact Git object already existed locally. Read it with `git show` and wrote only allowed working-tree paths; did not fetch or use index-writing checkout because the enclosing source-only instruction prohibits Git metadata changes. No remote branch tip/fresh DEV verification was performed. Base equals the specified predecessor base, so no intervening checkout changes required manual merging. The geometry script deliberately retains the base version with equivalent fullscreen assertions rather than importing the predecessor's shortened script.

### D1–D3 and authored coverage

- D1: GamesMapBackButton now owns a ref and a once-per-mount effect using preventScroll. The effect declines focus when a dialog/modal is open or another control already owns focus (preserving pointer/overlay returns); ordinary map-entry controls are allowed. Removed only the stale map-focus frame from GamesDiscoveryPage; Escape and list-return focus logic retained. `games-map-late-location.browser.mjs` delays identity while the page location is null, flushes animation frames, then resolves location with venue requests still pending and requires the mounted return to receive focus once. This assertion targets the predecessor failure. Dialog focus is retained during snapshot completion. Removed the old direct function invocation test because the component now legitimately uses hooks; browser activation checks the actual list URL instead.
- D2: return capsule is visible during snapshot loading and in unsupported cities, independent of map availability left over from another city; hidden when the current Moscow map reports its fatal M0 card. The new browser regression checks loading, Petersburg, one named return, error-card exclusivity, retry, list URL and Browser Back. Existing fallback browser coverage retains M0 exclusivity.
- D3: `games-map-layout.browser.mjs` starts from the base/dev geometry script. Retains widths 390/430/768/1024/1440, heights 600/1000, rotated 900-by-width, settlement diagnostics/screenshots, frame/canvas sizing, flow-control bounds, attribution/zoom bounds, horizontal/document overflow, scroll and minimum map height. Removed UI's desktop/mobile return assertions become exactly-one capsule and >=44px target/bounds assertions. Header/search gap assertions become fullscreen frame top/map edge/return gap assertions because search/context are intentionally absent. Underlying header/nav no longer bound the fullscreen overlay; blockers are measured inside it. List create banner, map/list navigation, closed fallback/accessibility and duplicate-pill checks retained. Existing lint-safe globals and globalThis.Event retained; no global-disable added.

### STYLE_GUIDE_PARITY

No new pattern beyond the source M1 capsule, marker and fullscreen composition; D1/D2 change lifecycle/availability only. Canonical Owner rule was read. The referenced operational guide file and frozen Make source remain absent locally; external visual parity is UNVERIFIED, the inherited STYLE_GUIDE_GAP remains. No additional OWNER_VISUAL_OVERRIDE inferred.

### Evidence, rollback and next action

NOT_TESTED: all component/browser tests, lint, typecheck, build and runtime checks. User expressly prohibited self-QA. Authored assertions are proposed coverage, not observed FAIL/PASS evidence. NOT_TESTED: physical iOS, safe-area hardware and browser chrome behavior. No deployment, commit, push, Git metadata mutation or durable publication performed. Publishing process must attach a candidate commit permalink; no result permalink exists for these uncommitted files.

Scope review: working-tree changed-path listing only, against exact initial base; no test execution. Allowed application files are the M1 paths listed in the assignment; tests and this handoff remain under allowed directories. Rollback: authorized integrator discards only this source diff against the initial base; no data/runtime rollback. Preserve other writers' changes if any arise after handoff.

Next single bounded action: authorized publisher records the source candidate in GitHub, then independent QA runs B1–B5 and A1–A6, demonstrates D1 regression on the predecessor, executes web tests/lint/typecheck/build and records exact evidence. This source handoff does not authorize release or Owner acceptance.
