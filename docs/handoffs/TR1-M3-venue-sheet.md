# TR1-M3 — venue sheet source handoff

From: source author (Codex). To: integrator, then independent QA.
Date: 2026-10-20. Status: WORKING_DRAFT / NOT_TESTED; no acceptance or release claim.
Base: `b2cd0f03bf420cdd1bb3c62d54c75b2f14337edf` (initial HEAD, branch automation/issue-127).
Base permalink: https://github.com/anpavel84-afk/gobadminton-clean/tree/b2cd0f03bf420cdd1bb3c62d54c75b2f14337edf

## Assignment and effects

Only TR1-M3 source changes in the supplied allowed_paths. Offline, no install,
Git writes, commit/push, automation, API/DB/contracts/dependencies, services or PROD.
User explicitly forbids self-QA. The task JSON's command strings are recorded below
for the integrator, not executed as commands from task data. Publishing and exact
candidate permalinks remain the integrator's responsibility under the explicit
source-only ceiling. No independent QA was provided (`{}`).

Goal: selected marker/fallback row → uniform preview → venue information → dated
schedule → GameHero + GameTerms over the same map, with no new navigation or
requests. The legacy venueId schedule and Radar are outside this change.

## Source deliverables / D1–D6

- D1: GamesMapView selection expands VenueSheet; fallback selects preview. Removed
  openVenue, venueMapPath import and selection/opening return-event/storage writes.
  Existing map position and key, polling and venueId branch retained.
- D2: Preview adds handle/up arrow and pluralized count with reserved status rows.
  VenueSheet uses a single cover/default, venue timezone dates and startsAt/id
  order, date preservation, game disappearance fallback and error invalidation.
  GameTerms accepts optional onVenueClick, retaining the old Link otherwise.
- D3: Expanded modal has labelled dialog, X focus, keyboard containment, Escape,
  body overflow cleanup, focus restoration, handle gestures and click suppression.
  Backdrop deselects; X/Escape/down swipe collapse. Preview up swipe expands.
- D4: Existing selection tests updated for popup behavior. Refresh suite retained
  with annotation. New integration suite derives from games-map-continuity,
  uses real GamesMapView/GamesVenueMap/VenueSheet, separate hook storage and mocked
  transport/MapLibre. It exercises selection/expansion/collapse and map lifetime.
  Coverage is authored source, not executed evidence; full D4 compliance requires QA.
- D5: Scoped token CSS, fixed height preview, controls clearance, responsive sheet,
  single-column detail, date chips, safe bottom, scroll, no animation. games.css unchanged.
- D6: All five required test files are present in this source change. No test,
  typecheck, browser or diff-check run is claimed. No independent QA performed.

## Commands / exit / output

All commands below: **NOT_TESTED**, exit N/A, output none. Reason: explicit user
instruction “No ... self-QA”; this is an execution-role restriction, not an observed
pnpm/Corepack failure or a code error. Offline tool availability was not tested.

```sh
COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec tsc -p tsconfig.json --noEmit --incremental false
COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec vitest run --no-cache test/venue-preview-card.test.tsx test/games-map-selection.test.tsx test/games-map-refresh.test.tsx test/venue-sheet.test.tsx test/venue-sheet-integration.test.tsx
git diff --check
```

Corepack context: [M2](M2-venue-preview.md), [V0](V0-public-venues.md).
Browser 390/430px and native focus: NOT_TESTED. No screenshots or visual PASS.
No runtime/deployment/Owner acceptance evidence. These environment limitations
must remain distinct from any code errors discovered by the integrator/QA.

## STYLE_GUIDE_PARITY

Binding sources: docs/decisions/OWNER_DECISION_MAP_POPUPS_V001.md §§1–4 and
OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md. Tokens:
apps/web/src/styles/consumer-tokens.css.
Proposed mapping: BottomSheet → sheet; media/image → cover; ListRow → schedule
row; chips → dates. Existing VenueCover, Avatar, GameHero and GameTerms reused.
These mappings are **PROPOSED**, not verified canonical parity.

https://nougat-wise-76949869.figma.site/#guide and #construction-kit and
https://files.anpavel.ru/projects/gobadminton/design/map/M3_venue_mockup.png are
**UNVERIFIED** in this offline assignment. Frozen source on PLAN not accessed.
The referenced docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md is absent in
this checkout. Inaccessibility is not a STYLE_GUIDE_GAP. No gap or
OWNER_VISUAL_OVERRIDE is asserted. No visual approval is claimed.

## Next bounded action / continuity

Integrator: review source diff, run the above checks, fix any code errors, and
obtain GitHub Actions CI **PASS for tsc/vitest on the exact final commit before
integration or DEV release**. CI FAIL prohibits both. Publish branch/PR and this
handoff with exact resulting commit permalinks, then independent QA against D1–D6.
Newer dev must be reconciled manually; this author did not alter the base.
Source test coverage is not acceptance evidence. Preserve no-navigation scope
only for this new flow; do not remove legacy venueId/Radar history behavior.
Rollback: reverse this bounded diff, preserving unrelated integrator changes.
