# #61 compact Games map — source handoff

From: source author. To: existing authorized executor / independent QA. Date: 2026-10-16.
Status: WORKING_DRAFT — NOT ACCEPTED. Prior independent QA supplied: {}.
Base: `abac53035bdec26f3d6128c037be68c4fc19c349`, initially clean,
branch `automation/issue-61`, existing Germany issue-61 worktree.
Base permalink: https://github.com/anpavel84-afk/gobadminton-clean/tree/abac53035bdec26f3d6128c037be68c4fc19c349
Candidate commit/permalink pending: committing/pushing/git metadata changes expressly prohibited.
Prepared for authorized GitHub publication; this local artifact is not yet a durable published record.

## Assignment and boundaries

User supplied immutable GOBADMINTON_AUTONOMY_V1 source_only DEV assignment #61,
including Owner addendum https://github.com/anpavel84-afk/gobadminton-clean/issues/61#issuecomment-6223251207
(16 October 16:35 -03), related #54/#28. Source authority is the supplied JSON;
no remote task or private harness was read. Maximum three attempts remains unchanged;
this session neither reads nor resets external counters. One writer; no delegation.
Only permitted consumer source/styles/tests/handoff paths changed. No commits, pushes,
automation, build/dependencies, flags, services, auth/API/DB/Admin/media or runtime edits.
#62 floating mobile switch and new zero-game marker artwork remain proposal-only.

## Source behavior

Map mode omits marketing Hero/CreateBanner while list mode retains original components
and create authentication path. Existing city/date selectors and list/map chips remain.
Activity state stays in the existing URL/return context; map eligibility semantics are
unchanged. Four bottom tabs remain in the ordinary shell. Map-only desktop footer is
removed to avoid a trailing footer gap. No global overflow suppression.

GamesMapViewport measures the frame top, visible viewport bottom and actual bottom-nav
rectangle (including existing safe-area padding). It observes compact controls, header,
nav and viewport resize/scroll; MapLibre's existing container ResizeObserver resizes the
actual map. Entering map starts at document top, including switching from a scrolled list.
The canvas flexes into available height rather than using the old 60vh/300px minimum.

Normal map no longer mounts the full venue chip cloud. A closed, bounded, scrollable
fallback catalog is mounted only when the map is unavailable, city unsupported, or any
venue lacks usable coordinates. All venues, including verified zero-game venues, remain
in data/markers and fallback navigation; unchanged exact venue/full chronological schedule/
free-place/exact-game links carry original day and return context. Numeric marker counts,
privacy, pagination and refresh semantics remain. Existing map unavailable status remains
truthful. Existing MapLibre zoom controls are enabled without a new map stack.

## STYLE_GUIDE_PARITY

Read binding docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md.
Canonical references: https://nougat-wise-76949869.figma.site/#guide and
https://nougat-wise-76949869.figma.site/#construction-kit . Frozen hashes remain as
recorded there. Reused canonical selector/chip/button families and existing shell,
header, bottom navigation, Onest/colors/radii. List HomePage Hero/CreateBanner retained.
OWNER_VISUAL_OVERRIDE: supplied #61/addendum requires compact header-following,
near-full-height map and removal of the below-map venue cloud only in MAP mode.
STYLE_GUIDE_GAP: no locally available frozen recipe for measured viewport map/failure
catalog; bounded extension composes existing controls and native disclosure, with no
new marker art or switch design. Frozen external visual source was not fetched;
independent visual parity review remains pending. Referenced
`docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md` is absent in this checkout.

## Prepared regressions; execution status

ALL tests/typecheck/lint/build/browser/UAT NOT_RUN by source author, per explicit
no-self-QA instruction. No PASS, independent QA, actual map or authenticated session
result is claimed. No installation, service startup or deployment performed.

- games-map-refresh.test.tsx: existing transport/timer regressions retained; added normal
  map absence of redundant venue controls and closed fallback on unavailable map.
- games-map-layout.browser.mjs: actual authorized DEV map required, widths
  390/430/768/1024/1440, heights 600/1000 plus landscape resize; real header/control/map/
  nav geometry, document width/height, no catalog focus stops, list hero/create retention.
- venue-fullscreen.browser.mjs: existing exact-venue/schedule/game/navigation and pan
  assertions retained; waits for map settlement and real center hit-testing. Framing uses
  at most three real zoom-out clicks, then fails. No force, event dispatch or mocks.
  Runs with existing .tools Playwright convention, GB_MAP_ORIGIN and controlled
  GB_MAP_VENUES [{id,name,gameIds}] (existing 5/4/6 fixture contract). Layout script uses
  GB_MAP_ORIGIN only. Neither script manufactures fixtures or authenticates.

Prior #54 UAT failures are retained: initial Sokol x=-40 outside canvas was harness
framing evidence, not proven overlay; panned follow-up navigation timeout is NOT PASS.
The prepared settling/framing diagnostics have not demonstrated a fix or acceptance.
Zero-game/long-name/error/loading/fallback keyboard/touch, actual phone browser bars,
safe-area/rotation, provider resources, camera/filter returns and legitimate authenticated
UAT remain required independent checks. Local source transport tests are mocked API
coverage and must never be represented as actual public map or authenticated UAT.

## Next bounded action and rollback

Existing executor publishes exact candidate and this handoff, then obtains new exact-SHA
independent read-only QA, full hosted Product CI, original existing DEV pipeline with
root backup/rollback and all three-image Admin opt-ins preserved. Confirm exact root
ACCEPTED/live SHA/noPending separately from actual mobile/desktop product UAT and Owner
acceptance. No release gate is satisfied by this source handoff. Preserve #36/#47/#52/#54/
#57 delivered semantics and current Admin/CI. No active immutable assignment was edited.
Before publication discard only this task's patch; afterward revert exact candidate via
existing guarded process. No runtime rollback attempted or authorized in this session.


## 2026-10-17 — bounded native CI repair

From: native source repair author. To: parent publisher / independent QA.
Status: WORKING_DRAFT — uncommitted, NOT ACCEPTED; no independent QA or product DONE.
Exact base: `b20757cd1170206a3764e7836654bfe235e1f2a9`, initially clean,
branch `automation/issue-61`, sole writer in the assigned worktree.
Base: https://github.com/anpavel84-afk/gobadminton-clean/tree/b20757cd1170206a3764e7836654bfe235e1f2a9
Failing Product CI: https://github.com/anpavel84-afk/gobadminton-clean/actions/runs/38959446897
Assignment-supplied evidence: Web lint and one of 522 Web tests failed; Web
typecheck and the other six jobs passed. Not fetched or independently verified
here: network is outside scope. This historical FAIL and all prior FAILs remain.

Authorized scope: ONE bounded repair, only the two specified test files and this
append. No product, dependencies, network, environment, services, runtime/control
files, permissions, secrets, live DB, other worktrees or git metadata changed.
No commit/push; parent handles publication. No #62/#64 work or delegation.
Original maximum three attempts remains unchanged; no counter read or reset.

Diagnosis and narrowed fix:

- Removed only the unused getComputedStyle global declaration from
  games-map-layout.browser.mjs; browser regression logic is unchanged.
- The fetch harness returns venues with the requested cityId, but its original
  game's nested venue uses cityId "city". The new normal-map case requested
  MOSCOW_BUNDLE.cityId. Real listAllUpcomingCityGames filters out mismatching
  game.venue.cityId, so the actual fallback count was correctly zero.
- Introduced a per-test responseGame reset to the original game in beforeEach.
  Only the new normal-map case explicitly sets its nested venue to the selected
  Moscow city. Existing city/date/stale-response regressions retain their fixtures.
  Explicit day 2026-10-18 is used consistently across this case's renders. With
  the existing 2026-10-16 fake clock, the published/public game starts on that
  Moscow date, has two available places and a future application deadline.
- The existing real component/API pagination/eligibility flow remains: initial
  render runs effects, 40 seconds resolves both sequential pages, later renders
  read the snapshot; after onAvailability(false), another render reads fallback
  state. Real pagination deduplicates the repeated game ID to exactly one game.
  Exact Venue · 1, normal-map no-catalog/no-chip and closed-fallback assertions
  remain. Existing date/city zero-game assertions remain; no expected count was
  weakened, no test skipped and no additional fake hook or map mock introduced.

Checks actually executed:

- node --check apps/web/test/games-map-layout.browser.mjs: exit 0.
- git diff --check: exit 0, including final append.
- Focused Vitest, ESLint, typecheck and full suite: NOT_TESTED. Root and web
  node_modules/.bin are absent; vitest/eslint are absent from PATH. No install
  or download attempted. Node syntax checking does not establish lint/test success.
- Actual public map/browser, DEV and legitimate authenticated mobile/desktop
  product UAT: NOT_TESTED. This existing mocked-transport/dynamic-map harness
  cannot establish actual map behavior or authenticated UAT.

Next bounded action: parent reviews/publishes the exact patch and handoff and
records the resulting candidate SHA/permalink. NEW independent exact-SHA read-only
QA and full hosted Product CI are still required. Then use only the original
existing DEV pipeline with root backup/rollback and all current three-image Admin
opt-ins preserved; establish exact root ACCEPTED/live SHA/noPending separately
from actual mobile/desktop product UAT. Root ACCEPTED is not product acceptance.
All original acceptance criteria, historical #54/CI FAILs and the original max-3
bound remain binding. No release or acceptance is claimed. Before publication,
rollback is removal of only this repair diff in the three allowed files; afterward
parent uses the existing guarded exact-candidate revert process. No commit or
candidate permalink was created because publication is reserved to the parent.
