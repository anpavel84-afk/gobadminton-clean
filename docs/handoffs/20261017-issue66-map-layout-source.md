# Issue 66 — compact usable Games map viewport

From: source author. To: SAME existing executor / independent QA.
Date: 2026-10-17. Status: WORKING_DRAFT — NOT ACCEPTED, NOT_TESTED.
Base: af210f82e65ab028f8e06927a88175d1ac373c31, automation/issue-66.
Exact base: https://github.com/anpavel84-afk/gobadminton-clean/tree/af210f82e65ab028f8e06927a88175d1ac373c31
Initial working tree clean. Supplied immutable GOBADMINTON_AUTONOMY_V1 task is
this bounded source-only assignment; prior independent QA {}. max_attempts=3
for this separate defect remains unchanged. No old assignment/counter modified.
No claim to have fetched latest DEV or independently verified executor state.
No second writer/delegation started. No commit/push/git metadata/network release,
automation/runtime/control files, dependencies, secrets, services or PROD changed.
Publisher must supply exact candidate SHA and durable GitHub artifact permalink;
publication is explicitly outside this source-author authorization.

## Preserved actual FAIL (operator-supplied, not reproduced here)

Public DEV 3c1f7c84, source hash
511b2097b0f92d7f4b485bd96664ed1b63e89bf184ebeda9111ab9e28e24368f:
390x600 document 390x600/no overflow; header 0..73, city/date 73..143,
frame 255..464, actual canvas 323.5..424.25 (100.75px), action 464..524,
nav 524..600. 390x1000 frame 255..864, canvas 323.5..824.25.
900x390 frame 211..390, canvas 263..368.125 (105.125px).
Other 430/768/1024/1440 evidence reports canvas bottom 21.875px above frame.
Private evidence references only: rootmap62-live-layout-3c1f7c84 and
map62-layout-diagnosis-3c1f7c84. No private outside-sandbox evidence accessed.
Original FAIL/logs remain evidence, not replaced by this proposal.

## Source diagnosis and proposed composition

GamesMapView legitimately places missing-coordinate/map-unavailable disclosure
AFTER the canvas. Its closed summary and flex gap consume measured height; a
zero bottom gap assertion was incorrect in this state. All venues stay available
through that disclosure; closed details do not expose hidden catalog focus stops.
Toolbar wrapping and long refresh text consume additional rows above the canvas.
Generic canonical Button specificity also defeats the old toolbar's 32px rule.

Reuse compact city/date selectors, activity chips, outline return/refresh, details
help and existing above-nav dark view action. Short visible help/refresh labels
retain full accessible names. Toolbar does not wrap; expanded help scrolls within
a bounded region. Buttons retain 44px targets. Selector/context gaps use existing
4/8/12px tokens. Fallback retains all venues and bounded scrolling, no normal
catalog chip cloud. Canvas remains the sole flexible region, with required controls
in normal flow. No body overflow suppression, canvas overlap or fixed canvas height.

GamesMapViewport measures actual visible action top instead of subtracting 60px;
observes action height and a placement notification to avoid stale reservation
when nav/browser bars move. View action keeps approved placement and uses intrinsic
44px button plus token padding. Existing safe-area nav remains untouched.
GamesVenueMap clears settled on resize before MapLibre resize; genuine idle sets
it true again. Camera, selection, pan/tap guards and marker styles are unchanged.
List hero/create/filter/history/scroll and Admin/photo implementation remain intact.

## STYLE_GUIDE_PARITY

Read binding OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001, canonical local
consumer-tokens/foundation and prior 61/62 handoffs. Authority remains frozen
https://nougat-wise-76949869.figma.site/#guide and #construction-kit, source hash
5a04ac69a259245c72da3ed5618326e8398396b4dd2c861b6eef4aecd726b1d6.
Operational FRONTEND_STYLE_GUIDE_FIRST_V001.md is absent from checkout; frozen
external source not fetched. Reused existing canonical selector/chip/Button,
disclosure/status, spacing tokens and shell/navigation families, preserving
screen-specific LIST banners and approved 62 view switch/marker composition.
STYLE_GUIDE_GAP: exact compact near-fullscreen Games recipe is not locally
available; this bounded proposal composes the existing primitives, and needs
independent visual parity against frozen guide. No new visual family or claimed
Owner acceptance. Existing 61/62 authority remains unchanged.

## Prepared regression and required independent evidence

No tests, syntax/lint/typecheck/build, browser or self-QA executed. All checks and
before/after screenshots: NOT_TESTED / NOT_AVAILABLE. No PASS claimed.
Updated games-map-layout.browser.mjs retains widths 390/430/768/1024/1440,
600/1000 heights and 900-wide rotation, entry/return and LIST create assertions,
40%-of-viewport-minus-header minimum, exact 2px settlement/overflow constraints.
Measures actual MapLibre canvas, required visible direct frame children, flex gaps,
nav/action/visual viewport. Asserts exact canvas top/bottom against this budget,
frame bottom, resized actual canvas, visible required controls and attribution/zoom.
Closed necessary fallback is distinguished from absent normal catalog cloud.
Diagnostics are emitted before settlement wait and in finally; optional existing
GB_MAP_EVIDENCE_DIR receives full-page size-labelled PNGs (directory must exist).
No mocks, forced events/clicks, skip, loosened tolerance or public mutation added.

Independent QA must run exact-SHA regression and preserve logs on first failure;
capture paired before/after images with exact SHA, viewport and URL, including
390x600/390x1000/900x390, all five widths, rotation/browser bars/safe areas.
Verify keyboard help/fallback expansion and bounded scrolling, all venue reachability,
zero/green/unknown marker counts, genuine tiles/idle, pan non-navigation, ordinary
click/tap, exact venue/full chronological schedule/time/free places/game detail,
URL/history/list pagination/scroll/camera, loading/error/retry and missing-coordinate
and unavailable fallbacks. Separate local mocked regressions from actual public
map browser evidence and legitimate authenticated UAT; no real session fabricated.
Navigation failures must be reported separately from map geometry.

Sourceguard after 64: existing approved standalone Admin entry is /admin/;
authenticated BFF is /admin/v1/admin/auth/me (scripts/chatops/smoke.mjs).
The unprefixed upstream /v1/admin/auth/me is not the standalone browser entry.
Any stale external guard using another entry requires operator diagnosis, not
runtime/control changes here. No sourceguard execution/PASS claimed.

## Next bounded action / rollback

Publisher records candidate SHA/permalink and obtains NEW independent exact-SHA
source QA plus full existing seven-job hosted CI including Admin/receiver.
Then existing authorized three-image DEV pipeline only, preserving Admin/photo and
all prior releases, original image backups/rollback and fresh root ACCEPTED/liveSHA/
noPending/exact image evidence. Actual public-map UAT is a separate gate. No next
slice automatically admitted. Previous 61/62 assignments, max3 and FAILs untouched.
Before publication rollback removes only this task's six source/test edits and this
new handoff; after publication use reviewed exact-candidate revert through existing
pipeline. No runtime rollback or deployment performed by author.
