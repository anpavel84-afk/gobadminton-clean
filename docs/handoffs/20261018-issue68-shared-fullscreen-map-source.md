# #68 shared fullscreen map — source handoff

From: source author. To: same admitted executor / independent QA.
Date: 2026-10-18. Status: WORKING_DRAFT — UNVERIFIED, NOT ACCEPTED.
Base: `598bc7ab846db214530dcb6e6fa4b978a3da1e07`, branch `automation/issue-68`.
Base permalink: https://github.com/anpavel84-afk/gobadminton-clean/tree/598bc7ab846db214530dcb6e6fa4b978a3da1e07
Initial worktree clean. No second writer or delegation started. Exact assignment:
user-supplied immutable GOBADMINTON_AUTONOMY_V1 source_only DEV #68, max_attempts 3,
prior independent QA {}, original body plus Owner clarifications A/B and OPS
18Oct admission after #66 c1acfc8f and RESUME_V1 598bc7ab. No counters modified.

## Scope / source changes

Only consumer components, styles, lib and this handoff edited. No commit, push,
git metadata, automation, dependencies, API, DB, auth, services or deployment.
GamesDiscoveryPage returns FullscreenMap instead of the application shell in map
mode. RadarPage uses that identical FullscreenMap + GamesMapView; the old
GeographicRadarMap is a compatibility adapter, not a second map implementation.
Public venue catalog, filtered schedules, all zero venues, marker navigation and
missing-coordinate fallback continue through the existing Games data path.
No header/filter/count/refresh/navigation chrome in successful map mode.
Viewport follows visualViewport resize/scroll with CSS dynamic viewport fallback;
attribution and compact back capsule account for safe insets. No global overflow
suppression. Exceptional loading/error/catalog fallback remains bounded.

Option3 list entry uses opaque white capsule, inset lime tile and violet native
folded-map glyph; desktop entry uses the same family. Zero/unknown venue disks
use a new native feather-fan/cork SVG; eligible game counts retain green circles.
Existing selected/focus rings and 44px venue targets remain. List hero, create,
filters and cards retain their composition.

SharedRadarLayer reuses the session/config/unified controller and existing query
eligibility, activation, expiry and server coarse positions. People are a layer
on the same public map; removal on Radar OFF does not recreate the map or venues.
Canonical Avatar handles uploaded/provider/fallback. Own social profile identifies
self without Owner IDs; own avatar uses only active published coarseCenter,
54px vs 44px neighbours, and is excluded from neighbours by publicPlayerId.
Initial centering is once and respects saved camera/manual movement. Missing
published center gets an honest notice; no fake coordinate or tracking added.
Person tap retains unified preview; Escape closes preview before exiting map.

## STYLE_GUIDE_PARITY

Read binding frontend decision, local consumer-tokens/foundation, navigation/icon
system, Avatar and #66 handoff. Frozen authority:
https://nougat-wise-76949869.figma.site/#guide and #construction-kit,
source hash 5a04ac69a259245c72da3ed5618326e8398396b4dd2c861b6eef4aecd726b1d6.
Operational docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md is absent.
External frozen source/mockup was not fetched. OWNER_VISUAL_OVERRIDE: supplied
Owner Option3 capsule and one fullscreen map instructions (17Oct 12:32/12:40,
clarifications comments 6235958611 / 6235967267). Reused frozen palette, radius,
spacing/shadow/control tokens, existing Avatar and preview families.
STYLE_GUIDE_GAP: local icon assets have court/navigation glyph, no shuttlecock;
bounded native SVG extension records feather fan + cork. Visual parity needs
independent review; source author claims no visual acceptance.

## Validation / remaining release gates

Per explicit source-author restriction, NO self-QA, tests, typecheck, lint, build,
synthetic/browser checks, screenshots or live requests executed. All NOT_TESTED.
Physical iOS/WebKit and authenticated Radar UAT NOT_TESTED; no session fabricated.
Candidate has no SHA yet because commit/push are forbidden for this role.
Executor must publish exact candidate SHA and this handoff's durable GitHub
permalink. Local handoff is prepared for publication, not already durable GitHub.

Independent QA must verify exact candidate source and changed navigation, real
MapLibre/tiles/live API at 390/430/768/1024/1440, 390x600/390x1000/900x390,
rotation, safe areas, keyboard/pinch/pan, readable attribution, list/back/history/
scroll/filter/camera, missing coordinates, zero-game venue -> chronological full
schedule/time/free places -> exact game -> return. Verify real Radar ON/OFF,
privacy expiry/access, focus removal, avatar fallback, own once-only centering,
no duplicate self, no recenter after pan, legitimate unavailable-position fallback.
Check source typing and preview focus across data refreshes independently.
Preserve #66 geometry FAIL, #54 historical FAIL and historical
PASS_LIMITED_REAL_NAVIGATION_UAT15 on 3c1f7c84; none proves this candidate.
Full hosted ProductCI including Admin, original commissioned three-image DEV
backup/rollback, fresh root ACCEPTED/liveMETA exactSHA/noPending remain separate
executor gates. No assertions loosened and no force clicks introduced.

## Next bounded action / rollback

Same admitted executor publishes this candidate and requests NEW independent
exact-SHA source QA, then existing authorized CI/release gates only. No next slice
admitted. Before publication undo only this handoff and the #68 source edits;
after publication use a reviewed exact-candidate revert through the existing
pipeline. No runtime rollback performed or authorized by this handoff.

## Independent QA repair — 2026-10-18

From: source author. To: admitted executor / independent exact-SHA QA.
Status: WORKING_DRAFT, UNVERIFIED. Repair base:
`e1074226b43e3b8ef01c3f3ca2b0d162101e5293` (clean working tree).
Prior independent verdict: FAIL, two findings supplied in immutable assignment:
session-wide camera prevented fresh Radar-ON centering; map pagination unreachable.

Camera restoration now belongs to the map's browser history entry, matched to its
exact path/search. Opening a new Games map entry clears inherited camera state.
A venue selection saves a return camera; the explicit venue-to-map action arms a
one-shot restoration consumed on map creation. A saved browsing camera alone no
longer suppresses initial own-position centering. Centering also waits for an
eligible, consenting own profile, remains once-only, and respects manual movement.
Browser history restoration and the explicit venue return preserve camera.

Restored the existing nextMapCursor action via controller.map(true), only while
Radar is permitted. It replaces the bounded private map window (no automatic
city-wide accumulation), disables during requests and disappears with Radar OFF.
This necessary participant-page action is map content, positioned above legal
attribution with safe insets; it adds no header, filter, legend or map toolbar.
STYLE_GUIDE_PARITY: existing frozen outline Button, white surface, spacing,
shadow and focus tokens reused; original Option3 Owner override retained.
No new visual pattern or API/privacy semantics introduced.

Changed source: GamesVenueMap, SharedRadarLayer, GamesDiscoveryPage, VenuePage,
fullscreen-map.css and this handoff. Rollback: revert only this repair diff against
the repair base; no git operation performed by source author.
No tests, self-QA, browser sessions, CI, deployment, commits or pushes performed,
as explicitly required by the source-only instruction. All acceptance criteria
remain UNVERIFIED for this candidate, including authenticated Radar and physical
iOS/WebKit. Historical limitations/failures above remain in force.
Next bounded action: executor publishes the candidate and obtains new independent
exact-SHA source QA; CI/release remain separate authorized executor stages.
No immutable assignment or attempt counter changed. GitHub publication is pending
executor transport; this local source handoff is not a published durable record.

## Independent QA repair — Radar control and marker identity

From: source author. To: same admitted executor / independent QA.
Date: 2026-10-18. Status: WORKING_DRAFT — UNVERIFIED, NOT ACCEPTED.
Exact repair base: `6c14575e1da83e518b34e87b58e8311837bcafc5`, clean
`automation/issue-68` worktree. Base source:
https://github.com/anpavel84-afk/gobadminton-clean/tree/6c14575e1da83e518b34e87b58e8311837bcafc5
The supplied independent source QA verdict for this base is FAIL: the fullscreen
map lacked Radar management, and selection used nonunique display names.

The shared FullscreenMap now mounts the existing RadarStatusAffordance for both
GamesDiscoveryPage and RadarPage. The established explicit consent/start/stop,
status and privacy flow is reused; no alternate toggle or permission path added.
Its compact existing circular control floats at the safe upper-right edge, with
no header or toolbar. The popover is bounded and scrollable for short viewports;
Escape is left to the Radar popover/dialog while present before map exit.
Session updates flow into the existing people layer without keying/remounting the
map component. Venue and camera ownership are unchanged.

SharedRadarLayer stores publicPlayerId on each portal record and compares selected
identity directly. Equal display names no longer identify selection. Own avatar
records remain distinct and do not receive neighbour aria-pressed state.

STYLE_GUIDE_PARITY: reused existing owner-approved RadarStatusAffordance,
Radar glyph/countdown, popover, consent dialog and Button families, plus frozen
white/spacing/shadow tokens. Clarification A and supplied independent QA require
in-map Radar management alongside the Option3 return control. No new visual
family; original documented Option3 override and shuttlecock gap remain.
The referenced operations Style Guide document remains absent; frozen external
source was not fetched. No visual parity acceptance is claimed.

Changed files: GamesMapViewport.tsx, SharedRadarLayer.tsx, fullscreen-map.css and
this handoff, all within allowed_paths. No tests, typecheck, lint, build, browser,
screenshots, live API, self-QA or independent QA executed by this source author.
Authenticated Radar, physical iOS/WebKit and every release acceptance criterion
remain NOT_TESTED / UNVERIFIED for this repair. No commit, push, git metadata,
automation, counters, services, secrets or deployments changed. Prior historical
FAIL / PASS_LIMITED qualifications above remain unchanged.

Next bounded action: admitted executor publishes the candidate and this handoff,
then requests NEW independent exact-SHA source QA including duplicate-name
selection and Radar ON/OFF from both entrypoints with camera/filter/venue/focus
preservation, Escape and short-viewport popover access. Existing hosted CI and
release gates remain separate. Publication and exact candidate permalink are
pending executor transport, not claimed complete here. Rollback is only this
four-file repair diff against the exact base above; no rollback performed.
