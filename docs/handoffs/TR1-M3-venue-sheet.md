# TR1-M3 — venue sheet source handoff

From: source author (Codex). To: integrator, then independent QA.
Date: 2026-10-20. Status: WORKING_DRAFT / NOT_TESTED; no acceptance or release claim.
Base: `b2cd0f03bf420cdd1bb3c62d54c75b2f14337edf` (initial HEAD, branch automation/issue-127).
Base permalink: https://github.com/anpavel84-afk/gobadminton-clean/tree/b2cd0f03bf420cdd1bb3c62d54c75b2f14337edf

## Repair after independent QA FAIL — 2026-10-20

Actual repair base: `1b705883be12e3f271e71a533993de99dc60dde9`, clean tracked diff at entry.
https://github.com/anpavel84-afk/gobadminton-clean/commit/1b705883be12e3f271e71a533993de99dc60dde9
The JSON's original dev base remains b2cd0f03bf420cdd1bb3c62d54c75b2f14337edf;
no checkout or metadata was changed to reconcile that difference.

Independent QA supplied by the assignment: FAIL on the actual repair base.
Findings D3 (suppression lost on unmount), D2–D3 (missing gesture/focus cases),
D4 (empty schedules and discarded sheet output). This repair is source-author
work, not independent QA or acceptance.

D1/D3: the persistent GamesMapView section now owns a bounded 500ms post-swipe
click guard. Both swipe directions notify it before replacing the child. Thus
collapse/unmount cannot remove the interceptor. Guard consumes one click and
expires without a timer/listener. Existing sheet effects still restore overflow,
focus and keyboard listeners on unmount.
D2/D3: preview tests drive 80/81px, horizontal/control/cancel and click handlers;
sheet tests use distinct focus targets, actual first/last boundaries, interior Tab,
connected initiator restoration and disconnected preview fallback.
D4: integration retains rendered sheet output, supplies a complete future Game,
drives schedule/detail/back and a downward swipe, actually removes the sheet and
passes the subsequent click to the surviving parent. Session invalidation and
three transport failures are checked while expanded, with no stale game or CTA.
Map construction/removal, stable camera calls, transport counts and navigation /
history / return-storage spies cover the transitions. All five required test files
have repair changes. Existing tests for legacy venueId, pagination and polling remain.
D5: no CSS or visual composition change in this repair. Original parity limitations
below remain. D6: commands attempted below; no runtime PASS claimed.

Validation (repository root, no installation or network enabled):

- `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec tsc -p tsconfig.json --noEmit --incremental false`: exit 1, NOT_TESTED.
- `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec vitest run --no-cache test/venue-preview-card.test.tsx test/games-map-selection.test.tsx test/games-map-refresh.test.tsx test/venue-sheet.test.tsx test/venue-sheet-integration.test.tsx`: exit 1, NOT_TESTED.
- Both failed before tool execution with identical Corepack output:
  `Network access disabled by the environment; can't reach https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz`.
  These are environment bootstrap failures, not observed TypeScript/Vitest errors.
- `git diff --check`: exit 0, no output (whitespace only).

No self-QA verdict, commit, push, deployment, publication or candidate permalink.
Integrator must publish the final source/handoff with an exact commit permalink,
obtain GitHub Actions tsc/vitest PASS on that exact commit before integration or DEV
release; CI FAIL prohibits both. Then independent QA reviews D1–D6. Browser
390/430px and native focus remain NOT_TESTED. Rollback: reverse this repair diff.

The original implementation handoff below is historical; its statements about
no prior QA and unattempted checks are superseded by this repair record.

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
