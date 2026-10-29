# MAP-PERF1 remainder — bounded Games map preload (#368 / PR369)

- From: source author (Cursor Auto), Lean Mode A / OD-016 attempt **2** (narrow repair MAP-PRELOAD-01).
- To: PMA → one Medium independent QA (Codex), then Product CI / DEV release / Owner UAT.
- Status: WORKING_DRAFT / SOURCE_ONLY. Author checks below are **NOT_TESTED** (no `node_modules` / package install in this sandbox). No commit, push, deploy, or PROD action.
- Assignment: Owner continue MAP-PERF1 remainder; canonical Issue **#368**; base `fd28e7aa88aee177d64080ae7801eaa1f279d1eb`. Previous FAIL (MAP-PRELOAD-01) preserved and addressed. #151/#152 loaders and #184 filters remain done; not reimplemented. #182 OFF; C5 disabled; #361 parked.

## Scope (allowed paths)

1. `apps/web/src/lib/map-preload.ts` — eligibility, idle schedule, deduped optional module+style warm (unchanged this pass).
2. `apps/web/src/components/consumer/games/GamesMapView.tsx` — `warmGamesVenueMapModule()`; existing `next/dynamic` literal (unchanged this pass).
3. `apps/web/src/components/consumer/pages/GamesDiscoveryPage.tsx` — one cancellable idle+intent effect; **no parallel unsignaled sidebar preload**.
4. `apps/web/src/components/consumer/discovery/DiscoveryComposition.tsx` — desktop map CTA click only; intent via root delegation on `.gb-map-desktop-entry`.
5. `apps/web/test/map-preload.test.ts` — dedupe, eligibility, retry, abort; **+ delayed module + shared-signal abort blocks style fetch for idle+intent**.
6. `apps/web/test/map-preload-entry.test.tsx` — dynamic pattern, warm without instantiate, entry class for root intent, entry keeps the selectors used by the existing root delegation. Single signaled production wiring is a source-review closure; no implementation-string assertion is treated as runtime integration.
7. `docs/handoffs/map-perf1-preload.md` — this handoff.

## MAP-PRELOAD-01 repair (attempt 2)

- Finding: desktop `onMapIntent` called `preloadGamesMapAssets` without the list/city `AbortSignal`; after cleanup a deferred module resolve could start an old-city `style-dev.json` GET.
- Fix: removed the parallel sidebar callback; idle and desktop/mobile intent share the effect-owned `kick` + `abort.signal`. Root capture listeners on `[data-surface="games-discovery"]` already target `.gb-map-desktop-entry` and `.gb-games-view-action`. No unused public `onMapIntent` prop left for tests.
- After list leave / city change / unmount: abort + remove listeners; no late unsignaled style fetch from a stale intent path. Map nav still does not await optional warm.

## Behavior

- While the user is on the Games **list** for supported Moscow + exact `https://dev.gobadminton.ru`, optionally warm the existing GamesVenueMap JS chunk and fetch public `style-dev.json` with `credentials: "omit"` (normal HTTP cache).
- Skip when saveData / offline / hidden / unsupported city / wrong origin.
- No PMTiles archive, range crawl, image loading, hidden map/WebGL/worker, Radar/people/geolocation, private snapshots, new cache/provider/scheduler/framework, or dependencies.
- Preload failures are caught; they do not replace the live MapView dynamic import / chunk-error fallback. Live GamesVenueMap style hash + resource validation remain authority.
- Cross-city / leave-list cleanup aborts the effect signal; map open does not await preload. Timing / iPhone savings: **UNKNOWN / NOT_TESTED** (no percentages claimed).

## Author checks (NOT_TESTED here)

| Check | Result |
| --- | --- |
| `pnpm --filter @gobadminton/web run typecheck` | NOT_TESTED — no installed workspace deps |
| `pnpm --filter @gobadminton/web run lint` (scoped) | NOT_TESTED |
| `pnpm --filter @gobadminton/web exec vitest run test/map-preload.test.ts test/map-preload-entry.test.tsx` | NOT_TESTED |

PMA should run the table above (prior PMA 12/12 + typecheck/lint PASS on attempt 1; re-run focused suite after this repair), then one Medium independent QA on **MAP-PRELOAD-01 only** plus related changes (reuse prior passed privacy/dynamic/gates), Product CI, DEV smoke, and Owner UAT (explicitly NOT_TESTED for unmeasured client timing).

PMA scope adjustment before publication: rejected one newly proposed regex/source-string wiring assertion as redundant implementation mirroring; no pre-existing test was disabled. Actual delayed-module/shared-signal regression is retained and passes. Final addressed evidence: 9 helper tests +4 entry tests; source wiring is independently reviewed, not claimed as browser integration.
