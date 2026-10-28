# MAP-PERF1 remainder — bounded Games map preload (#368)

- From: source author (Cursor Auto), Lean Mode A / OD-016.
- To: PMA → one Medium independent QA (Codex), then Product CI / DEV release / Owner UAT.
- Status: WORKING_DRAFT / SOURCE_ONLY. Author checks below are **NOT_TESTED** (no `node_modules` / package install in this sandbox). No commit, push, deploy, or PROD action.
- Assignment: Owner continue MAP-PERF1 remainder; canonical Issue **#368**; base `5b9a58671a428edc89f6f0a115794635614290e8`. #151/#152 loaders and #184 filters remain done; not reimplemented. #182 OFF; C5 disabled.

## Scope (7 paths only)

1. `apps/web/src/lib/map-preload.ts` — eligibility, idle schedule, deduped optional module+style warm.
2. `apps/web/src/components/consumer/games/GamesMapView.tsx` — export `warmGamesVenueMapModule()`; keep existing `next/dynamic` literal `import("./GamesVenueMap")` with `ssr: false` / loading fallback.
3. `apps/web/src/components/consumer/pages/GamesDiscoveryPage.tsx` — one cancellable idle effect on list + entry intent listeners; never awaited by map navigation.
4. `apps/web/src/components/consumer/discovery/DiscoveryComposition.tsx` — optional `onMapIntent` on desktop map CTA (focus/pointerenter).
5. `apps/web/test/map-preload.test.ts` — dedupe, eligibility skips, optional error retry, abort.
6. `apps/web/test/map-preload-entry.test.tsx` — dynamic pattern preserved, warm without instantiate, sidebar intent wiring.
7. `docs/handoffs/map-perf1-preload.md` — this handoff.

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

PMA should run the table above, then one Medium independent QA on the coherent candidate, Product CI, DEV smoke, and Owner UAT (explicitly NOT_TESTED for unmeasured client timing).
