# TR1-M3 — venue sheet source handoff

From: Codex, source author. To: integrator, then independent QA.
Date: 2026-10-20. Status: PROPOSED / SOURCE_ONLY / NOT_TESTED runtime.
Target: DEV source candidate; no release or visual acceptance.

## Source revision after independent QA (2026-10-20)

From: Codex source author. To: integrator / independent QA. Status: PROPOSED;
TypeScript and Vitest NOT_TESTED, no source PASS or visual acceptance claim.
This revision starts at observed HEAD `113525c27e4b7d0728d5297492762c1a6f5a02b4`
(prior source attempt), with empty initial tracked diff. Requested task base remains
`faade9a313e92b77b1b89d6ea7b77991a8350cda`; no checkout or Git metadata writes
were performed. The implementation and five test files below are inherited from
the reviewed HEAD, not newly authored by this revision.

Prior independent QA reported FAIL: missing preview clearance for both lower
MapLibre control corners, and unavailable D6 tools. This bounded correction changes
only venue-popup.css and this handoff. It restores both data-venue-preview control
selectors inside .gb-consumer. Explicit title/address line heights make the preview
150px tall: handle 44 + copy 90 (22/20/18/18 and three 4px gaps) + padding 16.
Control bottom is 174px + safe-bottom: card height + its 12px bottom offset + a
12px clearance. This protects attribution and other lower controls in both corners,
with and without games. No map state, camera, requests or component logic changes.

D1–D4: inherited implementation/coverage, no new execution evidence. D5: scoped
clearance correction above; browser geometry at 390/430px remains NOT_TESTED.
D6 repeated from repository root for this revision:

- `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec tsc -p tsconfig.json --noEmit --incremental false` — exit 1 before compiler startup.
- `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec vitest run --no-cache test/venue-preview-card.test.tsx test/games-map-selection.test.tsx test/games-map-refresh.test.tsx test/venue-sheet.test.tsx test/venue-sheet-integration.test.tsx` — exit 1 before test startup.
- Both report missing pnpm 10.18.0: Corepack attempts its registry download, then reports `Network access disabled by the environment; can't reach https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz`. Result: NOT_TESTED; no installation/network workaround attempted.
- `git diff --check` — exit 0 after this correction.

STYLE_GUIDE_PARITY below still applies: documented families are a PROPOSED
composition, external Make/mockup parity UNVERIFIED. No new visual pattern,
STYLE_GUIDE_GAP or OWNER_VISUAL_OVERRIDE is asserted. Rollback for this revision:
reverse its two-file diff only. Integrator owns independent QA, publication and
the exact candidate permalink. Historical first-attempt notes follow.

## Assignment and base

Bounded assignment: TR1-M3, issue-117 worktree, immutable GOBADMINTON_AUTONOMY_V1 source_only task supplied by Owner. Implement marker/fallback selection → preview → information → schedule → game detail in one sheet above the existing map. No new requests, participation actions, page navigation, history mutation, API/DB/contracts/dependencies/workflows/control-document changes.

Requested base: dev faade9a313e92b77b1b89d6ea7b77991a8350cda.
Observed checkout/base: d9f88b68049b0651b50ba7c71cca0235c4dd4405, branch automation/issue-117.
Initial git diff --stat produced no output. The base mismatch was preserved, without checkout/reset or metadata writes. Integrator must reconcile with current dev manually.

Observed-base permalink: https://github.com/anpavel84-afk/gobadminton-clean/tree/d9f88b68049b0651b50ba7c71cca0235c4dd4405

Candidate has no commit or exact published permalink: commit/push were explicitly prohibited. New files remain local source files for integrator inclusion; ordinary unstaged git diff does not include new files.

## Source changes

- GamesMapView.tsx: local expansion state; marker/fallback choices reset to preview. Removed openVenue, location.assign, gb-map-return dispatch and selection/return flag writes from this scenario; removed venueMapPath import. Existing venueId branch and other return mechanisms remain. Map keeps its JSX location, component type and key. City/removal clear selection. Preview Escape is consumed in capture.
- VenuePreviewCard.tsx: real VenueCover, 64×64 image, handle, up arrow, reserved two status lines, Russian 1/2/5 plural forms; unavailable does not present stale time/count or checked zero.
- New VenueSheet.tsx: one expanded modal with X/focus trap/overflow cleanup, background dismissal, handle gestures, honest venue information, timezone date chips, schedule ListRows, Avatar and formatSeats, and GameHero + GameTerms detail. No fabricated venue data, carousel index, player/game/venue links or participation requests.
- GameDetailComposition.tsx: optional GameTerms.onVenueClick button; absent callback retains existing Link.
- apps/web/src/lib/venue-popup.ts: pure date grouping, pluralization and handle gesture handlers. Schedule is still derived from all.get(venue.id), existing venueSchedules activity/eligibility/order and existing polling.
- apps/web/src/styles/venue-popup.css: changed rules scoped to .gb-consumer; token palette, modal/backdrop layers 104/103, responsive sheet sizing, safe bottom, scroll, one-column game composition. No animation or map camera changes.

Component paths are under apps/web/src/components/consumer/games/. On gamesReady=false, the render itself immediately excludes schedule/detail/CTA; reconciliation also resets the internal view so a later successful refresh cannot resurrect an old detail. Checked empty displays «Пока нет игр». Missing date falls back to the first remaining day; missing game returns to schedule.

## D1–D6 evidence and limits

These are authored coverage and implementation notes, **not PASS claims**.

| Criterion | Candidate evidence | Status / limit |
| --- | --- | --- |
| D1 | Source changes above; three existing tests changed and two new test files authored. Selection/expansion no longer navigates or writes return flags. | Implemented source; runtime NOT_TESTED |
| D2 | venue-preview-card exercises the real preview/cover/handle, 1/2/5 counts, empty/error, midnight and DST. venue-sheet exercises real sheet transitions, dates/order, missing dates/games, organizer/seats, honest data, GameTerms callback/default Link. | Authored; NOT_TESTED |
| D3 | Real sheet effects/handlers under Node DOM stubs cover X, background, internal content, back controls, focus boundaries, Escape, listener/overflow/focus cleanup. Real gesture helper and preview handle exercise 80/81px, horizontal movement, cancellation, controls, scrollTop and click suppression. | Authored; native focus, pointer capture/click synthesis and browser event ordering NOT_TESTED |
| D4 | Selection tests replace navigation expectations and cover reset/error/removal/city. Refresh tests retain pagination, polling, cancellation/session scenarios and add request stability on expansion. New integration executes GamesMapView/GamesVenueMap/VenueSheet with separate hook stores, expanded next/dynamic, mocked transport and MapLibre, map identity/key/tree position/camera/request/navigation/storage assertions, session invalidation/removal/city/unmount. | Authored; NOT_TESTED |
| D5 | Scoped CSS uses consumer tokens; active chip ink/white, inactive white/ink-soft/line, lime-deep count; 32% ink backdrop; sheet constraints and targets. | Source implementation only. Actual 390/430px geometry and native focus NOT_TESTED |
| D6 | Exact commands and exits below. | TypeScript/Vitest NOT_TESTED; diff whitespace check exit 0 |

Executed from worktree root, without installation or enabled network:

1. COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec tsc -p tsconfig.json --noEmit --incremental false
   - Exit 1 before compiler startup.
2. COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec vitest run --no-cache test/venue-preview-card.test.tsx test/games-map-selection.test.tsx test/games-map-refresh.test.tsx test/venue-sheet.test.tsx test/venue-sheet-integration.test.tsx
   - Exit 1 before test startup; repeated after finishing test edits, same result.
3. git diff --check
   - Exit 0. This checks tracked diff whitespace; new files require integrator inclusion.

Both pnpm invocations reported that Corepack was about to download https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz, then:
Network access disabled by the environment; can't reach https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz.

There is no installed workspace node_modules in this checkout. No package installation, service operation, deployment, Git metadata write, commit, push or independent self-QA was performed. Tests have no any or TypeScript suppression additions, but their compilation/execution remains unverified.

## STYLE_GUIDE_PARITY

Binding repository sources:

- [Map popup Owner decision §§1–4](../decisions/OWNER_DECISION_MAP_POPUPS_V001.md).
- [Style Guide first Owner decision](../decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md).
- Consumer palette: apps/web/src/styles/consumer-tokens.css.
- docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md is referenced by AGENTS but absent in this checkout; no substitute document was invented.

PROPOSED composition uses the documented BottomSheet, media/image blocks, ListRow and chips families. Existing VenueCover and Avatar are reused unchanged. Screen-specific Make composition is UNVERIFIED.

Frozen Make:
https://nougat-wise-76949869.figma.site/#guide
https://nougat-wise-76949869.figma.site/#construction-kit

External approximate mockup:
https://files.anpavel.ru/projects/gobadminton/design/map/M3_venue_mockup.png

External sources were not fetched. Their parity is UNVERIFIED, with no visual acceptance claim. Unavailability is not a STYLE_GUIDE_GAP; no OWNER_VISUAL_OVERRIDE is claimed. No new gap is asserted.

Per decision §4, the recorded v1–v5 rejection reason was the absence of the decision and mockup reference in the repository. This is pre-publication review history, not restored primary QA. No additional rejection reasons or QA quotations are inferred.

## Continuity, rollback and next action

Rollback: reverse the tracked source diff and remove the three newly authored source/test files plus this handoff, scoped to this candidate. Preserve unrelated integrator work. No runtime/database rollback is involved.

Next bounded action: integrator includes all allowed-path files, reconciles actual base with current dev, runs D6 in a prepared offline dependency environment, obtains independent QA and separate visual/native-browser review. Publication, exact candidate permalink and any DEV release remain integrator responsibilities. PROD requires separate Owner GO.
