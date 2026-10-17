# #62 bounded Games navigation and venue markers

From: source author. To: SAME existing executor / new independent read-only QA.
Date: 2026-10-17. Status: WORKING_DRAFT — source only, NOT ACCEPTED.
Exact clean base: c932ae2aae2aa72cb3f45d5d0535c8eda5b61bfc.
Base: https://github.com/anpavel84-afk/gobadminton-clean/tree/c932ae2aae2aa72cb3f45d5d0535c8eda5b61bfc
Branch: automation/issue-62. No commit or publication authorized in this session;
candidate SHA/permalink must be supplied by the existing publisher. This file is
prepared for durable GitHub publication and is not yet a published project record.

## Authority and scope

Immutable user-supplied GOBADMINTON_AUTONOMY_V1 source_only DEV task #62 is the
assignment. OWNER_CONFIRMED per supplied task: Owner 16 October 16:58:55 -03
supersedes the earlier proposal-only status of #62; earlier #61 records are untouched.
No remote assignment, executor state, live DEV or acceptance claim was fetched.
No independent QA supplied ({}). Original max_attempts=3 remains binding; no
counter read/reset, new executor, second writer or delegation. Base already contains
#61 and its repairs; no fetching/rebasing or claim to have verified latest live DEV.
Only permitted consumer source, styles, focused test and handoff paths edited.
No git metadata, commits, pushes, dependencies, build/CI/deployer/control files,
services, secrets, auth/RBAC/API architecture, Admin or PROD changes.

## Source changes

- DiscoveryComposition: existing right-hand map card now has functional dark
  “Все игры на карте” action. Decorative city illustration remains explicitly such;
  obsolete disabled entry removed. No eligibility/privacy expansion.
- GamesDiscoveryPage: view pills removed. Desktop map has compact “К списку игр”;
  mobile has one separate icon/text “Карта” / “Список” action above existing nav.
  Activity chips remain a separately labelled filter in each view. List DOM/feed
  remains mounted while hidden so current pagination survives an in-page return.
- URL carries view/day/activity/cityId; supported city IDs select local discovery
  context without writing account preferences. View actions push history; popstate
  rereads context. Scroll is saved per city/day/activity in optional session storage
  and restored after list/feed rendering. Existing optional MapLibre camera storage
  remains. This is source intent, not demonstrated browser acceptance.
- GamesViewAction measures actual nav top and visual viewport for its bottom edge.
  Its 60px band has a bounded canonical button and no gesture interception outside
  the button. Map viewport reserves this band at the same 720px breakpoint; list
  and footer reserve it. Existing safe-area nav and four tabs unchanged.
- GamesMapView filters eligible schedules/counts by selected activity. VenuePage
  derives activity from existing returnTo and uses the same filter for full venue
  schedule. Chronological ordering, pagination, exact IDs, free places, privacy,
  refresh, unknown-count errors/loading and fallback remain existing logic.
- GamesVenueMap uses existing canonical /brand/games.svg court glyph as CSS mask.
  White filled 32px circles show purple court; actual button is 44px. Eligible counts
  retain existing larger green numeric circles. Unknown schedules retain explicit
  unavailable accessible labels. Selected venue ID is optionally remembered and
  receives an outline; keyboard focus has its own outline. Drag guard unchanged.

## STYLE_GUIDE_PARITY

Read docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md; its frozen
source hashes and canonical references remain authority:
https://nougat-wise-76949869.figma.site/#guide and
https://nougat-wise-76949869.figma.site/#construction-kit . External frozen source
was not available locally/fetched. Referenced operational document
`docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md` is absent in this checkout.
Reused canonical Button dark/outline, discovery pin, C23 games/court icon asset,
Onest/color/radius tokens, activity chips, map card, shell and existing bottom nav.
List Hero/CreateBanner and community card retained; #61 map framing retained.
STYLE_GUIDE_GAP: no locally available frozen recipe for the specific above-nav
view action or zero-game marker; bounded composition uses existing primitives and
canonical court icon. OWNER_VISUAL_OVERRIDE: supplied #62 expressly authorizes
this placement and white/purple circular glyph direction. No new icon family or
broad design system. Independent visual parity still required.

## Tests/evidence — NOT_TESTED

Per explicit no-self-QA instruction, NO tests, lint, typecheck, build, browser,
syntax checks or source QA executed. No PASS is claimed.
Prepared games-map-view.test.tsx expectations now distinguish empty glyph text
from count text while retaining unavailable/zero/count accessible semantics.
Prepared games-map-layout.browser.mjs uses new responsive action labels and actual
reserved action geometry; retains real map readiness/idle, widths and rotation,
normal clicks and existing overflow/height assertions. No mock/force/dispatch added.
Existing exact-venue/full schedule/game/pan/settlement regressions remain intact.
Tests are preparation only; actual short-height geometry may expose failures and
must be repaired within the original bound, never waived by this handoff.

Before/after screenshot index: NOT_AVAILABLE. No browser or live access performed;
independent executor must capture paired list/map mobile/desktop evidence against
base above and exact candidate, with width/height/URL/SHA. No invented screenshots.
Public widths 390/430/768/1024/1440, short/tall/rotation, keyboard/safe-area/browser
bars, URL back/forward, scroll with pagination, camera, marker hit targets/overlap,
selected/focus states, real worker/tiles and map-pan non-navigation: NOT_TESTED.
Local synthetic API tests are not public map evidence. Legitimate authenticated
UAT: NOT_TESTED; no real session supplied and no fabrication/bypass authorized.
All historical #54 UAT FAILs, #61 QA/CI FAILs and rollback records remain real.

## Next bounded action / rollback

Existing executor publishes exact candidate plus this handoff and obtains NEW
independent exact-SHA read-only source QA. Then full hosted seven-job Product CI,
including actual Admin build/HTTP and receiver, followed only by original commissioned
THREE-image DEV pipeline with backup/rollback; record exact root ACCEPTED/liveSHA/
noPending while preserving accepted Admin abac53035bdec26f3d6128c037be68c4fc19c349
and all newer product fixes. Actual product UAT/screenshots and Owner acceptance
are separate facts; source completion, CI and server acceptance do not establish them.
Do not edit immutable #61 assignment or advance another slice. Before publication,
rollback removes only this task patch; after publication use existing guarded
exact-candidate revert. No runtime rollback performed here.
