# M3-PHOTO-R2 — #144 source handoff

From: Codex source author
To: GoBadminton integrator / independent QA
Date: 2026-10-21
Status: WORKING_DRAFT — NOT_TESTED — NOT APPROVED

## Assignment and base

Bounded assignment: M3-PHOTO-R2 #144, successor to #141; source only, DEV target. The supplied GOBADMINTON_AUTONOMY_V1 task authorizes only three existing components, the new selected-cover component, two new tests and this handoff. No Git writes, publication, dependency installation, services, automation or deployment are authorized. Contact work #142 is separate.

Requested base: `f50eb6f0f1703efabe86ef1de5b8f42948fc4497`.
Actual checkout base: `13d0f76c5db4f841b8f3e04b4645808c8df71fb6`, branch `automation/issue-144` (also decorated `automation/issue-142`). Initial tracked diff was empty. No checkout/reset/rebase or other Git mutation was performed. The base discrepancy is unresolved; integration against newer DEV is manual. Historical predecessor SHAs were not read as Git inputs. Prior QA history in the assignment is PM_REPORTED/UNVERIFIED_BY_THIS_REVIEW, not evidence for this diff.

## Implementation facts and D1–D6 mapping

- D1: edited `GamesMapView.tsx`, `VenuePreviewCard.tsx`, `VenueSheet.tsx`; created `SelectedVenueCover.tsx`, `selected-venue-cover.test.tsx`, `venue-photo-lifecycle.test.tsx` and this file. No other source changes intended. New files are untracked because staging/committing is prohibited.
- D2: selected resource is memoized outside VenuePopup by city, venue id and normalized uploaded URL. Name is excluded and updates alt during layout commit. Compact callback ref creates one native img with eager/async set before src. Info ref takes priority and appendChild moves the same node; info detach returns it to compact. Existing VenueCover remains the fallback for callers without coverSlot and retains lazy/async. Resource tests cover valid/missing/invalid/external URLs, alt/data attributes, existing slot classes, cold/loaded reopening and name refresh.
- D3: changed callback refs release old identity during commit; last slot detach invalidates event generation, removes the error listener and node, and removes the src attribute. Uploaded error switches once to court; saved old error closures cannot trigger another switch. Tests cover identity/URL replacement, saved events after fallback/unmount, and reconnecting after final detach. There is no load handler or load-dependent mutation; stale load is inert.
- D4: added real-component lifecycle harness with independent hook stores and commit refs/cleanup. Cases exercise cold/loaded images, moving/settling, nonempty schedule and return to info, collapse/reopen, city change, deselection, empty/error messages, capture-phase Tab with both Shift values, cancellation/lostcapture and horizontal consume-once. MapLibre and transport are mocked; actual map/popup/preview/sheet/resource components execute. Map error is injected through the fake MapLibre event transport to expose the existing venue list. URL navigation is asserted absent. Runtime results remain NOT_TESTED. Existing gesture/focus/navigation implementations and previous tests were not edited.
- D5: synchronous next/dynamic mock registers each loader in vi.hoisted state and returns its own wrapper. Loaders resolve after static imports; actual GamesVenueMap and GeographicRadarMap results are checked as distinct. Fragment is handled before string narrowing; array children are traversed. Each render has a 10000-node/depth128 bound and at most 20 settle passes, with explicit errors. No runAllTimers or copied popup lifecycle/handlers.
- D6: required local checks were attempted offline; toolchain could not start (details below). No PASS claim for typechecking, lint or tests. Test files use the repository's strict/noUncheckedIndexedAccess configuration; no any, TS suppression, index non-null assertion, skip or timeout expansion added.

## Commands and evidence

Executed from repository root:

```text
COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec tsc -p tsconfig.json --noEmit --incremental false
exit 1 (same launcher failure on two invocations)

COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web run lint
exit 1

timeout --kill-after=5s 60s env COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec vitest run --no-cache test/selected-venue-cover.test.tsx test/venue-photo-lifecycle.test.tsx
exit 1; collection did not start, not exit124
```

All three commands emitted:

```text
! Corepack is about to download https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz
Network access disabled by the environment; can't reach https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz
```

Neither root nor apps/web has node_modules/.bin. No install/network workaround was attempted. These checks are NOT_TESTED, not failing application assertions. Commands above remain the required checks on the integrator's provisioned exact candidate. Author checks are not independent QA.

`git diff --check`: exit 0, no output for tracked changes. New files were also checked through `git diff --no-index --check /dev/null <file>`; see final author output. No full web Product CI ran.

## STYLE_GUIDE_PARITY

Patterns: MediaBlock for the cover, BottomSheet for the popup. Existing white/ink/lime tokens and cover classes are retained: compact 64×64, info 16:9 followed by name/address/action. CSS is unchanged. No gallery/rating/amenities added. Sheet changes are limited to the optional prop/slot and its type import; contacts remain untouched.

Make composition: UNVERIFIED. Both assigned frozen files `/opt/gobadminton-clean-qa/style-guide/src/App.tsx` and `src/index.css` are absent (ENOENT). `docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md` is also absent in this checkout. Owner decisions for map popups and Style Guide first were read. No STYLE_GUIDE_GAP or OWNER_VISUAL_OVERRIDE is asserted. STYLE_GUIDE_PARITY=UNVERIFIED.

## Limits, continuity and next action

Browser/iPhone/flicker: NOT_TESTED, no measurements. Cold-network completion is not promised instant; the browser owns img.src loading. API/DB/contracts/auth/CSS/NGINX/service worker/dependencies/workflows/control documents are unchanged. No general cache, Blob, manual request, city preloading, photo timer, Image/clone/portal or retained hidden Sheet was introduced. VenuePopup remains unchanged with `visible = expanded || moving || settling`.

This is an unpublished working-tree result, not an accepted candidate, DEV deployment or independent QA. The integrator must add candidate SHA and exact GitHub permalinks when publishing; none can honestly be supplied under the no-publication instruction. Required next bounded action: integrate only this diff, resolve the requested/actual base discrepancy, run the specified checks and independent QA plus the full standard web Product CI on that exact SHA. Workflows must remain unchanged. No next product slice is authorized here.

Rollback: reverse-apply only this diff, including removal of its newly created files; preserve unrelated work. No runtime rollback is necessary because no runtime effects were performed.
