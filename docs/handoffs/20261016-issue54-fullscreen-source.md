# Issue #54 — venue map fullscreen corrective source

From: source author. To: independent SOURCE QA / authorized executor. Date: 2026-10-16.
Status: WORKING_DRAFT — NOT ACCEPTED. Source only; prior independent QA supplied: {}.
Base: `1d051174e1bad1209c6a3b382e94ab7b7787d1d7`, branch `automation/issue-54`, initially clean.
Base: https://github.com/anpavel84-afk/gobadminton-clean/tree/1d051174e1bad1209c6a3b382e94ab7b7787d1d7
Candidate SHA/permalink unavailable: user expressly forbids commit/push/git metadata changes.
This file is prepared for later authorized GitHub publication, not a published record.

## Immutable assignment and effects

GOBADMINTON_AUTONOMY_V1, source_only, DEV, max_attempts=3. Only apps/web/src/**,
apps/web/test/**, docs/handoffs/**. No extra task, self-QA, network deployment,
services, automation, configuration, secrets, Admin/DB/auth/privacy policy or PROD.
Owner UX15Oct2026 22:15 America/Sao_Paulo: #54 corrects #28. Marker numbers count
eligible games per venue (5/4/6), never participants/seats. Marker selects a full
venue screen with its whole eligible chronological schedule and exact-game Подробнее.
Earlier admissions 6205581608/6205784721 are superseded history, not competing authority.
The earlier compact-preview/popup interpretation is superseded. Preserve zero-game
venues, dates/timezones/pagination/privacy/discovery/expiry/capacity policies.
Fix actual horizontal document overflow at mobile 390/430 by containing chips.
Do not reinterpret existing SOURCEQA/CI/root ACCEPTED history or mobile UAT FAIL as
acceptance of this candidate. No historical artifacts modified or deleted.

## Source changes

Map and catalog-chip selection navigate to existing `/venues/[venueId]`, carrying
selected day and validated Games-only return URL. VenuePage keeps its identity,
place, cover and existing editor, adds complete selected-venue schedule through the
same pagination/refresh/eligibility code as map counts. No marker join/create.
Each existing DiscoveryGameCard keeps date/time, free seats and exact game links;
time now also has machine-readable datetime. Venue route retains normal shell/four
tabs. Back link restores map/day/activity; map camera is optional session storage,
validated and bounded, with blocked-storage fallback. Browser history remains normal.

Existing zero-game catalog policy retained. Complete page loads, failure handling,
expiry clock, session/focus/online refresh and unknown-count semantics retained.
MapLibre marker updates preserve its required positioning class instead of replacing
it. Pointer movement/cancel suppresses synthetic drag clicks; native keyboard click
remains available. Venue markers without games get a 44px target. Chip containers
have bounded intrinsic sizing and local mobile horizontal scrolling, preserving all
venues and map gestures; no body overflow masking.

## STYLE_GUIDE_PARITY

Binding reference: docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md.
Canonical public references: https://nougat-wise-76949869.figma.site/#guide and
https://nougat-wise-76949869.figma.site/#construction-kit . Decision names Navigation,
ContentCard, GameCard, SectionHeader, SurfacePanel, chips and responsive recipes.
Reuses existing full-page VenuePage/ConsumerShell navigation and previously bounded
VenueScheduleCard composition with existing GameCard, Button and VenueCover. No new
map stack, navigation platform or visual family. Existing documented
STYLE_GUIDE_GAP #28-venue-schedule remains proposed and requires independent visual
review; no claim of an independently verified frozen standalone VenueCard.
OWNER_VISUAL_OVERRIDE: none; fullscreen behavior is the explicit current Owner task.
Referenced docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md and historical
.tools/style-reference observations are absent in this worktree. External/frozen
reference inspection NOT_TESTED; previous handoff observations are history, not new
inspection evidence. Independent parity review remains required.

## Executable regressions prepared; no execution

Added 5/4/6 grouping/seat distinction and chronological association assertions,
route/context validation and pointer/keyboard gesture tests. Updated refresh tests
for route-based schedule composition rather than old below-map cards.
Added venue-fullscreen.browser.mjs for actual loaded map/visible number marker
hit-testing, 390/430/768/1024/1440 document bounds, full route schedules, exact-game
Подробнее, return, mouse pan and keyboard activation. Independent executor supplies
GB_MAP_ORIGIN and GB_MAP_VENUES JSON [{id,name,gameIds}] for controlled 5/4/6 public
fixtures, plus optional GB_BROWSER=webkit. Uses installed .tools Playwright convention.
Missing fixtures/readiness/markers fail explicitly, never substitute title-link tests.

ALL checks NOT_TESTED: tests/type/build, actual map provider/assets, browser/UAT,
iOS/WebKit, touch pan/pinch/zoom, date/resize/long-name overflow, auth/join,
privacy/error runtime negatives and accessibility. Script authoring is not execution.
No screenshots/receipts/PASS fabricated. Test coverage is not full device UAT.

## Next bounded action / rollback

Authorized executor publishes source candidate and this handoff, then independent
exact-SHA SOURCE QA. Full existing Product CI, normal DEV pipeline, real root-owned
ACCEPTED same SHA/noPending, then actual browser UAT remain distinct pending gates.
Keep bounded max three attempts without reset; this author does not own or modify
external attempt counters and claims no independent results. Do not deploy from
this session. No Owner acceptance or release is claimed.
Before publication discard only this task's diff if necessary; after publication
revert the exact candidate through the guarded workflow. No runtime rollback here.

## 2026-10-16 bounded hosted-CI source repair (same #54 unit)

From: source repair author. To: parent executor / independent SOURCE QA.
Status: WORKING_DRAFT — NOT ACCEPTED; local uncommitted patch only.
Exact base: `da4732e13042213d1ac245f001645be33c544391`, clean on entry,
branch `automation/issue-54` in the existing issue-54 worktree; sole writer per assignment.
Base permalink: https://github.com/anpavel84-afk/gobadminton-clean/tree/da4732e13042213d1ac245f001645be33c544391
Current durable scope is recorded by Supervisor on PR #58 (16 October), per supplied
assignment: https://github.com/anpavel84-afk/gobadminton-clean/pull/58 . No network
inspection was performed and no exact Supervisor comment ID was supplied.

Supplied actual hosted result (not independently fetched here): new independent
SOURCE QA PASS preceded actual-push Product CI run
https://github.com/anpavel84-afk/gobadminton-clean/actions/runs/38910451587 .
Web typecheck/lint FAIL; all other six jobs PASS, including Web unit PASS. That
SOURCE QA PASS does not override hosted CI FAIL and does not cover this new diff.
All prior FAIL history, including mobile UAT FAIL, remains retained and unsuperseded
as historical evidence. No feature DONE or self-approval is asserted.

Only three test files changed: typed navigation spy plus an explicit missing-call
failure before URL parsing; complete typed VenueSummary catalog driven by exact
5/4/6 counts, checked indexed venue/duplicate/schedule values; explicit Node process
import and browser document global declaration matching the existing browser-test
pattern. These are runtime-checked values, not assertions masking missing fixtures.
Duplicate elimination, chronological ordering, venue identity, privacy and navigation
assertions remain. Actual-map readiness, visible marker hit-testing, fullscreen/all
games/Подробнее/back, overflow, pan and keyboard logic remains unchanged.
No product/UI/API or visual source changed; known Guide gaps remain unchanged.

Local checks: `node --check apps/web/test/venue-fullscreen.browser.mjs` PASS.
`git diff --check` PASS (final patch). Web typecheck/lint/unit NOT_TESTED:
node_modules/.bin and .tools are absent; attempted `pnpm --offline --filter
@gobadminton/web run typecheck`, `lint`, and `test:unit` never started the checks.
The installed pnpm launcher invoked Corepack, which unexpectedly attempted registry
downloads despite --offline; all failed with EAI_AGAIN. This attempted network
access violated the session's intended offline ceiling; no download succeeded and
no retry/install was performed. No env/settings were changed to work around it.
Browser/provider/device/UAT checks, full hosted CI, existing DEV pipeline and real
root-owned ACCEPTED exact SHA/noPending are NOT_TESTED by this author.

Next bounded action: parent commits/publishes this SAME unit under existing authority,
then obtains new independent exact-SHA SOURCE QA, full existing hosted Product CI,
the original DEV pipeline, real root-owned ACCEPTED for that exact SHA/noPending,
then actual browser UAT, as distinct gates in that order. New candidate SHA and its
QA permalink are pending parent publication; no SHA or QA receipt is invented.
Original max_attempts=3 is unchanged, not reset or reinterpreted; this is no new unit.
Commit/push/git metadata, services, deployment and external gate execution were not
performed. Parent must publish this append with the source repair for durable record.
Rollback before publication: remove only this bounded four-file diff; after publication
use the guarded exact-candidate revert process. No runtime rollback is involved.
