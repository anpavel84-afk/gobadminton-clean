# M2 — Venue preview over Games map

## CI repair — 2026-10-19

From: source author (Codex). To: integrator / independent QA.
Status: READY_FOR_REVIEW; execution checks NOT_TESTED.
Repair base: `0b8369f6deebe91888c505ae2489688ae8912082`.
Exact base: https://github.com/anpavel84-afk/gobadminton-clean/tree/0b8369f6deebe91888c505ae2489688ae8912082

FACT: bounded repair for CI run `39303585450`, job `118234800021`, failing
second Escape assertion in `games-map-selection.test.tsx:116`. Only
`GamesMapView.tsx` and this handoff are changed relative to the repair base.
The capture listener reads current selection from a ref updated by the selection
effect, and clears that ref synchronously when consuming Escape. Thus a subsequent
Escape is not consumed, including before React commits the state update. The listener
is registered once with cleanup; dialog/defaultPrevented guards remain before mutation.
All existing candidate code and tests are otherwise preserved; no visual changes.
STYLE_GUIDE_PARITY remains UNVERIFIED, with the original STYLE_GUIDE_GAP M2 below.

Requested repair checks, each attempted separately with `COREPACK_ENABLE_NETWORK=0`:

- `pnpm --filter @gobadminton/web run typecheck`
- `pnpm --filter @gobadminton/web run lint`
- `pnpm --filter @gobadminton/web exec vitest run test/games-map-selection.test.tsx`
- `pnpm --filter @gobadminton/web run test:unit`

Each exited **1** before execution: Corepack required
`https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz` and reported
`Network access disabled by the environment; can't reach` that URL.
All four checks are **NOT_TESTED**, not PASS. No install or network access enabled.
`git diff --check`: exit **0**, no whitespace diagnostics.
No independent self-QA, commit, push, deployment or Git metadata changes performed.

PROPOSED next bounded action: integrator runs these four checks with provisioned
tooling and obtains independent review of this repair before integration. Existing
prior QA PASS applies only to the base SHA, not this uncommitted repair.
Rollback: remove only this repair's GamesMapView and handoff diff against the repair
base, preserving all original candidate changes. Publication and a resulting exact
commit permalink remain the integrator's responsibility.

From: source author (Codex)
To: GoBadminton integrator / independent QA
Date: 2026-10-19
Status: WORKING_DRAFT — source ready for review, checks NOT_TESTED
Base: `f0168eac864914122d3604519772966188fd6ca7` (dev assignment base, checkout HEAD on `automation/issue-112`).
Base permalink: https://github.com/anpavel84-afk/gobadminton-clean/tree/f0168eac864914122d3604519772966188fd6ca7

## Assignment and effects

Source-only immutable GOBADMINTON_AUTONOMY_V1 assignment for issue-112, target DEV,
M2 venue selection and compact preview. Only the nine paths below are changed.
API, DB, contracts, lockfiles, workflows, runtime and PROD are out of scope.
No network, install, Git writes, commit, push, deployment or independent self-QA.
The source author has not published this candidate; an exact candidate commit permalink
must be supplied by the integrator after authorized publication. This handoff is local
source awaiting durable GitHub publication, not an assertion of publication or acceptance.

## FACT — source changes

- `apps/web/src/components/consumer/games/GamesMapView.tsx`: controlled nullable venue
  selection; repeated selection keeps the card; city change/removal clears selection.
  Preview reads the existing all-days schedule with current activity. Escape uses a
  capture listener and preventDefault, respects dialogs and defaultPrevented, and has cleanup.
  Only real opening dispatches gb-map-return and writes the existing return/selection flags.
  Card and fallback preserve venueMapPath, day and returnTo.
- `apps/web/src/components/consumer/games/GamesVenueMap.tsx`: controlled aria-pressed,
  legacy storage fallback only for undefined selection; selection reconciles existing
  markers. Ready canvas listener deselects and cleans up. Marker drag/keyboard guard remains.
  Creation/cleanup effect [attempt], polling, diagnostics and Radar lifecycle are unchanged.
- `apps/web/src/components/consumer/games/VenuePreviewCard.tsx`: real VenueCover,
  labeled region, one button, unavailable versus checked empty schedule.
- `apps/web/src/lib/venue-popup.ts`: pure nearest-game formatting without input mutation;
  venue timezone, local-calendar tomorrow across DST, Russian dates and HH:mm range.
- `apps/web/src/styles/venue-popup.css`: component-imported token-only card styling,
  96x72 media, 96px/minmax(0,1fr)/44px grid, safe bottom and scoped attribution offset.
- `apps/web/test/venue-preview-card.test.tsx`: real card/cover render, activation,
  unavailable/empty states, date labels, UTC-day and DST fixtures.
- `apps/web/test/games-map-selection.test.tsx`: real GamesMapView with local hook and
  fetch harness; captures map props; selection, URLs, activity/day, Escape, city/removal,
  unavailable snapshot. The map lifecycle itself is covered directly by the next test.
- `apps/web/test/games-venue-selection.test.tsx`: direct real GamesVenueMap invocation
  with effect execution and local MapLibre/DOM stubs; controlled selection, identities,
  camera, flags, canvas/marker/control distinction, drag/keyboard, cleanup, legacy storage.
- `docs/handoffs/M2-venue-preview.md`: this handoff.

Existing tests are unchanged. Added tests are source artifacts, not passing evidence.
No coordinates were added to logs. No fabricated rating, facilities or photo counts.

## Validation evidence

Each requested command was attempted separately from repository root, without install:

1. `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec tsc -p tsconfig.json --noEmit --incremental false`
2. `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web run lint`
3. `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec vitest run --no-cache test/venue-preview-card.test.tsx test/games-map-selection.test.tsx test/games-venue-selection.test.tsx`

All three: exit **1**, checks **NOT_TESTED** (tool bootstrap failed before checks):

```text
! Corepack is about to download https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz
Network access disabled by the environment; can't reach https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz
```

No root or web node_modules and no tsc/vitest executable were available in PATH.
`git diff --check`: exit **0**, no output for tracked changes; new files also checked
with `git diff --no-index --check /dev/null <path>` (exit 1 denotes new-file diff,
no whitespace diagnostics). No PASS claim for typecheck, lint, test execution or QA.
Browser/iPhone 390/430px: **NOT_TESTED**. Independent QA: **NOT_PERFORMED**.

## STYLE_GUIDE_PARITY

Authority: [Owner Style Guide first](../decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md),
frozen https://nougat-wise-76949869.figma.site/#guide and
https://nougat-wise-76949869.figma.site/#construction-kit.
Families: **ContentCard image-side**, **MediaBlock**, **Popover**, **CTA**.
Screen composition: bounded overlay on existing map; actual frozen Make screen comparison
was unavailable offline. Parity: **UNVERIFIED**.
**STYLE_GUIDE_GAP M2**: venue preview overlay composed from these families according to
immutable assignment dimensions/tokens; frozen-source visual comparison still required.
`docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md` is absent from this checkout.
No OWNER_VISUAL_OVERRIDE is claimed.

## PROPOSED / limitations / next bounded action

This implementation is PROPOSED, not ACCEPTED and not deployed. Offline tooling blocks
executed TypeScript/lint/test evidence. DOM/MapLibre harnesses do not prove browser geometry,
native event propagation, iPhone safe-area or attribution usability. Those remain review risks.
Do not reinterpret source presence as passing QA or DEV release.

Next bounded action: integrator combines this exact source slice with newer dev manually,
runs the four D5 checks in a provisioned offline-capable environment, then requests independent
M2 QA including 390/430px attribution and visual parity. Publish source plus this handoff in
the authorized GitHub branch/PR and add the exact candidate permalink. No next product slice.
Rollback: discard/revert only these nine task paths against the stated base after preserving
any integrator changes; no runtime or database rollback is involved.
