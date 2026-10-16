# Issue #28 / Product #24 — Wave D source handoff

From: source author. To: independent SOURCE QA / PM. Date: 2026-10-16.
Status: WORKING_DRAFT — NOT ACCEPTED. No self-QA performed, no tests executed.
Base: `4c1938978ab40806e60e69dc7e3ed499990695d7`, branch `automation/issue-28`.
Base permalink: https://github.com/anpavel84-afk/gobadminton-clean/tree/4c1938978ab40806e60e69dc7e3ed499990695d7
Candidate SHA/permalink: unavailable: committing/pushing explicitly prohibited by this assignment.

## Assignment / effects

Immutable GOBADMINTON_AUTONOMY_V1 task, source_only, target dev, max_attempts 3;
Wave D of Owner night train #5#issuecomment-6182091853, continuing #28 after Radar/media/Friends.
Only apps/api/**, apps/web/src/**, apps/web/test/**, apps/web/public/**,
packages/contracts/**, docs/handoffs/** may change. No git mutation, deployment,
automation, network provisioning, services, secrets, live DB, VPN, PLAN or PROD.
This source handoff is prepared for later authorized GitHub publication; it is not
already a durable published candidate. Prior independent QA supplied: {}.

## Source behavior

Games retains its shell/navigation and adds list/map selection. Public venue catalog
is fetched independently of games/date through existing paginated deduplicating
catalog API. All catalog venues remain selectable in an accessible list, including
venues without coordinates or games. Date affects schedule/count only. MapLibre /
PMTiles uses the existing pinned Moscow style hash, asset allowlist and bounds;
origin must equal the pinned DEV asset origin. No new transport or map dependency.
Unsupported cities retain a venue list with an explicit basemap notice.

Complete upcoming public discovery pages are deduplicated by game ID; repeating
cursors, failures or the 100-page bound fail closed rather than return partial
counts. Catalog's existing 20-page bound likewise fails closed. Schedule joins use
venue IDs only, never names. Cancelled/nonpublic/full/past/deadline-expired games
are excluded from hints. Day selection uses venue timezone and schedule sorts by
instant then ID. No-games-on-date differs from no-upcoming-available-games.
Counts are public discovery hints, never seat authority. Refresh every 30 seconds,
focus, online and session change; expiry is re-evaluated every second. Failed refresh
removes hints. If games fail but venues load, the public catalog remains available
with unknown counts and an unavailable-schedule notice. Pagination is not an atomic server snapshot; detail/join still use
current server permissions/capacity. Public discovery intentionally does not add
private invitations or invitation metadata, even for signed-in viewers.

Venue selection uses safe VenueCover/default, address, schedule and existing game
links. Create link carries exact venueId; create form resolves it only from the
selected city's current catalog and preserves it through its auth return path.
No cover-service availability is required to display the default. No people,
contacts, participant locations, Radar consent/session/pins or browser location APIs
are read by this view. API contract and backend runtime behavior are unchanged.

## STYLE_GUIDE_PARITY

Binding source: docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md;
published canonical references https://nougat-wise-76949869.figma.site/#guide and
https://nougat-wise-76949869.figma.site/#construction-kit .
Canonical families cited there: chips/selectors, ContentCard, GameCard, media,
Empty/Error, responsive recipes. Reuses DiscoveryHero/CreateBanner, existing city/date
selectors, chip/button tokens, DiscoveryGameCard and safe VenueCover. Shell and four
mobile bottom tabs unchanged. Games screen-specific existing hero/sidebar/list
composition remains for list mode.
Correction after independent FAIL on `14bb364e19b2e22842f95e1f8173917f1e971c8d`:
the earlier assertion that reference material was unavailable was incorrect.
Author inspected supplied `.tools/style-reference/README.md`, `guide.txt`
(including Map primitives and Construction Kit sections 00–02), actual
`guide-desktop.png`, `games-map-action.txt` and its manifest. These are primary
public rendered observations captured 2026-10-15, admitted by Owner:
https://github.com/anpavel84-afk/gobadminton-clean/issues/28#issuecomment-6198534662 .
The guide explicitly provides ContentCard image-top, SurfacePanel, SectionHeader,
responsive mobile stacking, GameCard and map selected preview / mobile bottom sheet.
The Games map action was OBSERVED_NOOP, not an inspectable dedicated map screen.
No standalone VenueCard specimen was verified in these supplied observations.

STYLE_GUIDE_GAP #28-venue-schedule: bounded composition of the inspected ContentCard
image-top + SurfacePanel + SectionHeader + existing GameCards, safe VenueCover and
Button actions, now isolated in `VenueScheduleCard.tsx` with scoped responsive CSS.
This is a proposed venue-specific composition, not a claim that a standalone frozen
VenueCard was found or that all external reference states lack one. No invented
screen-specific parity or frozen PLAN tree/hash verification. OWNER_VISUAL_OVERRIDE:
none. Independent visual review remains required for canonical VenueCard acceptance.
Marker styling is imported directly by GamesVenueMap, independent of visiting Radar.

## Checks / UAT — all NOT_TESTED

Added executable web tests: games-venue-map.test.ts (ID isolation, zero-game venues,
date/UTC midnight, DST, dedupe/order, private/full/cancelled/deadline expiry),
games-map-pagination.test.ts (complete pages, stable lower bound, repeat cursor,
failed page), games-map-view.test.tsx (zero-game selection, exact create link,
unsupported city and complete-load error). Added API unit regression
wave-d-discovery-privacy.test.ts for existing public canonical-ID predicate.
Existing real PostgreSQL games.map / game.discovery / invitation / seat suites
remain independent QA inputs, not evidence of execution here.

Next bounded action: independent SOURCE QA on a newly published exact candidate SHA.
Run relevant Vitest tests, type/build checks and existing public discovery/privacy /
seat integration suites in the authorized disposable environment. Extend browser
coverage for create preselection after login/city change and game detail/join.
No author PASS, hosted CI, browser, API integration, accessibility, mobile390,
desktop, authenticated synthetic negatives or map resource checks are claimed.

PM UAT: verify actual DEV tiles and attribution, keyboard markers/selectors,
all venues including no-game venue, date changes without hiding venues, chronological
schedule, game detail/join, create preselection, guest login return, city switch,
expired/full/cancelled/private/invitation negatives, offline/Range/CSP/hash failures,
and 390px/desktop layout. Check venues with missing/out-of-bounds coordinates remain
in list. Validate count refresh race and large catalog pagination under churn.

Acceptance still requires exact-SHA full hosted Product CI, normal DEV backup/paired
images/browser smoke/receiver, actual root-owned ACCEPTED matching SHA/digests with
pending=false, and PM real DEV product smoke. These are outside source-author effects.
No HTTP200 or source file is release evidence. PROD requires separate Owner GO.

## Rollback / continuity

Before publication, remove only this task's source diff; preserve unrelated work.
After an authorized candidate exists, revert its exact source commit through the
normal guarded DEV pipeline. No migrations, environment or service changes to undo.
Do not execute rollback/deploy from this source-only session. Do not reinterpret
this handoff as QA, visual acceptance, deployment or Owner acceptance.
