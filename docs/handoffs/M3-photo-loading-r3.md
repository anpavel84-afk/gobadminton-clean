# M3-PHOTO-R3 · #147 · source handoff

From: source author (Codex)
To: DEV integrator, then independent QA
Date: 2026-10-21
Status: WORKING_DRAFT — NOT_TESTED — NOT APPROVED

## Assignment and authority

Task base: `13d0f76c5db4f841b8f3e04b4645808c8df71fb6`. Actual revision checkout / correction base: `af45f6e937c8fedfee2dea0db23ae82f6a03a932` (HEAD observed with `git log -1`; initial working diff empty). This correction preserves the existing implementation and edits only the resource, two allowed tests and this handoff; the three integration components already exist in the correction base.
Canonical repository: `anpavel84-afk/gobadminton-clean`; worktree: `/srv/gobadminton-clean/worktrees/issue-147`.
Exact assignment: supplied immutable `GOBADMINTON_AUTONOMY_V1`, source_only, DEV, M3-PHOTO-R3 #147, successor to #144/#141. Historical PASS reports are not current evidence; the supplied prior QA finding defines this correction. Prior independent QA on `af45f6e937c8fedfee2dea0db23ae82f6a03a932`: FAIL. Last-ref disposal recreated img/src during React 19 StrictMode callback-ref replay; passive-effect cleanup also disposed the resource during replay. Previous harnesses omitted these lifecycle replays. This correction is not independently reviewed.

Scope: preserve the selected venue image across compact/info presentations without repeated image creation/source assignment during a transfer. Contacts from #142, popup gestures, focus, schedule, map lifecycle and all other cover consumers retain their existing behavior. Cold network loading is not promised to be instantaneous.

No commit, push, Git metadata change, network access, installation, service operation, deployment, PROD action or independent QA was performed. Publication is explicitly reserved to the integrator by this source-only assignment. This local handoff requires a versioned GitHub representation when integrated; the integrator adds candidate SHA and exact permalinks. A newer DEV must be combined manually.

## Source artifacts / D1

Modified:

- `apps/web/src/components/consumer/games/GamesMapView.tsx`: unconditional selected-cover resource hook outside the popup; compact and info slots passed to the two cards.
- `apps/web/src/components/consumer/games/VenuePreviewCard.tsx`: optional `coverSlot`, previous `VenueCover` when omitted.
- `apps/web/src/components/consumer/games/VenueSheet.tsx`: optional `coverSlot` and cover substitution only; public contacts unchanged.

Created:

- `apps/web/src/components/consumer/venues/SelectedVenueCover.tsx`: resource hook and empty span slot. Resource identity is city/id/validated URL, excluding name. DOM creation/movement occurs through commit refs; passive effects update alt and dispose. Compact creates one eager/async image before assigning src; info takes priority, detach returns it to compact. Uploaded error falls back once to court; generation/image guards reject obsolete error callbacks. No load callback changes resource state. Final detach removes the error listener, DOM parent and src attribute. No image clone, portal, cache, Blob, request or photo timer.
- `apps/web/test/selected-venue-cover.test.tsx`.
- `apps/web/test/venue-photo-lifecycle.test.tsx`.
- This handoff.

`VenuePopup.tsx`, existing tests/handoffs, CSS, APIs, DB, contracts, dependencies, workflows and control documentation were not edited. Other `VenueCover` consumers remain lazy/async.


## StrictMode correction

The resource now separates listener setup from source assignment. Last-ref detach immediately removes the image from its parent, removes listeners and invalidates captured callbacks. Final `removeAttribute('src')` and image release occur in a queued microtask. A synchronous ref reattachment cancels that final release, restores listeners with a new generation and reuses the existing img/src. Passive-effect cleanup uses the same conditional release, and effect setup retains the resource. No timer, image cache or extra request is introduced. Identity changes remove the old visible image during commit; old-source release completes at the microtask checkpoint.

This microtask boundary reconciles final cleanup with React 19's synchronous node → null → node replay: clearing src synchronously at the intermediate null would require assigning src again on replay. Final-ref cleanup assertions now await that checkpoint; they still assert immediate removal from the parent on identity change.

D2–D3 additions: resource harness explicitly replays callback refs and passive-effect cleanup/setup, then asserts one image/source, working fallback, preserved info priority and final disposal. D4 addition: the real component integration tree replays committed refs before the existing moving/settling/schedule/refresh scenario and asserts one image/source. Its already mounted map effects are not artificially replayed. These authored tests are NOT_TESTED, not independent QA evidence.

## Authored coverage / D2–D5

These are authored assertions, not executed test results.

D2: accepted uploaded URL; absent/invalid/external URL default; eager/async before src; alt and cover/fallback attributes; original slot classes; load/open/close/open/name refresh preserves the one image/source.

D3: city/id/URL invalidation including equal image URLs; old error/load events after replacement; fallback in both slots; obsolete fallback callback; court error without cycling; repeated refs; final cleanup of parent/src/listeners.

D4: real GamesMapView/GamesVenueMap/VenuePopup/VenuePreviewCard/VenueSheet/slot tree, with transport/MapLibre/DOM/hooks/Next mocks. Before/after image load: drag moving/settling, nonempty schedule output and return to info, close/reopen and rename refresh; city/deselect disposal and unselected venues without photo loading. Fatal map failure uses a fallback button and its actual onClick. Cancel/lostcapture, horizontal reset and consume-once, drag click guard after Sheet unmount, shared dialog/handle boundary, Tab in both directions with identical capture options cleanup and focus restoration; empty/unavailable schedule copy; map count/navigation/transport assertions.

D5: per-component hook stores and stable per-slot setters, lazy initialization and current-value functional updates, Object.is dirty checks, length/Object.is dependencies, effect cleanup before replacement/on unmount, commit refs, arrays, Fragment before string narrowing. Traversal limits: 10,000 nodes / depth 128 / 20 render rounds, throwing on excess. Async transport flushing is finite. Resource suite includes harness setter/init/update/isolation/dependency/cleanup assertions. Synchronous next/dynamic factory uses a hoisted registry populated after static imports with distinct real GamesVenueMap and GeographicRadarMap wrappers. Typed partial api-client mock includes apiFetch. No async UI import chain, dummy UI, production logic copy, runAllTimers, skip, explicit any, TS suppression, indexed non-null assertion or import() type was added.

## Commands / D6

All executed offline from the worktree. The following three commands each returned **exit 1 before their checker/test runner started**:

```sh
COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec tsc -p tsconfig.json --noEmit --incremental false
COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web run lint
timeout --kill-after=5s 60s env COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec vitest run --no-cache test/selected-venue-cover.test.tsx test/venue-photo-lifecycle.test.tsx
```

Common complete output:

```text
! Corepack is about to download https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz
Network access disabled by the environment; can't reach https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz
```

Result: typecheck **NOT_TESTED**, lint **NOT_TESTED**, new tests **NOT_TESTED**. Collection did not begin; no test PASS is claimed. The timeout was not increased and did not expire (not exit 124). No installation or network workaround was attempted. Strict/noUncheckedIndexedAccess compilation remains required in the dependency-equipped integration environment; the base tsconfig enables both.

`git diff --check`: exit 0, no output. This correction uses tracked files from its actual HEAD; no Git write or metadata operation was performed. This is whitespace validation only, not typecheck or QA.

## STYLE_GUIDE_PARITY

Canonical patterns: MediaBlock for the existing media slots; BottomSheet for the existing popup/sheet. This mapping is supplied by the exact assignment and is consistent with the pattern families named by `docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md`. Owner popup text: `docs/decisions/OWNER_DECISION_MAP_POPUPS_V001.md`; external PNG was not accessed.

Frozen `/opt/gobadminton-clean-qa/style-guide/src/App.tsx` and `src/index.css`: **UNVERIFIED**, both absent in this environment (`No such file or directory`). `docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md` is also absent. No network access was used. Screen-specific Figma Make composition: **UNVERIFIED**. No STYLE_GUIDE_GAP or OWNER_VISUAL_OVERRIDE is introduced.

Existing CSS classes preserve compact 64×64, info 16:9, white/ink/lime and info ordering: cover → name → address → public contacts → CTA. No gallery/rating/amenities were added. Browser/iPhone rendering, actual network reuse, loading flicker and visual parity: **NOT_TESTED**.

## Next bounded action and rollback

Integrator: review this source diff, resolve newer DEV manually, supply dependencies in the authorized environment, run D6 and independent QA plus the full standard web Product CI on the exact integrated SHA. Only then decide readiness under normal release gates. No acceptance or deployment is inferred from source presence.

Rollback: reverse this diff (including removing its newly added files). Preserve #142 contacts and unrelated integrator changes. Integrator supplies versioned artifact permalinks and final evidence; this document does not authorize another task or production action.
