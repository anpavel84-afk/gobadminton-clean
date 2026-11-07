# #406 map idle catalog refresh — source handoff

From: Cursor Auto (source writer). To: independent QA / trusted integrator / Owner UAT.
Date: 2026-11-07. Assignment: OWNER_NIGHT_MAP_IDLE_REFRESH · attempt 1.
Status: SOURCE_COMPLETE / NOT_TESTED (no author network, install, CI, DEV, or browser run).
Exact base: `859bb6a635ad704ad0971f8a7ad748b02eda0017` (accepted alpha.37).
Owner UAT: NOT_TESTED (iPhone). `source_sha` / acceptedAt for alpha.38 remain null until trusted acceptance.

## Goal

Eliminate the unnecessary full venues+games catalog poll that ran ~30s after map settlement while the tab stayed idle. Keep required pagination pairs, same-city snapshot, abort/generations, session invalidation, and marker continuity. No new cache/service/OPS/PROD/header policy. PR495 84-marker map behaviour preserved (not edited).

## Source changes (allowed paths only)

| Path | Change |
| --- | --- |
| `apps/web/src/lib/games-venue-map.ts` | `startVenueMapRefresh` no longer schedules a 30s idle full-catalog reload. Explicit initial `run()` always starts. `refresh()` rejects hidden document; shares one in-flight; drops focus/visibility twins within a bounded cooldown after a refresh start (initial load does not arm cooldown). Load rejections swallowed so `void` callers are not unhandled. |
| `apps/web/src/components/consumer/games/GamesMapView.tsx` | Local 30s `now` clock unchanged for expiry/counts. Catalog reload on focus/online and on `visibilitychange`→visible; session change still `stop` + remount (not coalesced away). City/day/manual `refresh` remount unchanged. |
| `apps/web/test/games-map-refresh.test.tsx` | Drop obsolete idle-poll expectation; assert 75s idle keeps VENUES count; visibility return + focus burst = one pagination pair; hidden refresh rejected; focus retry after error; other assertions preserved. |
| `apps/web/test/games-map-continuity.test.tsx` | Idle 75s must not refetch; focus refresh keeps marker/camera continuity; day + failure paths preserved. |
| `apps/web/src/lib/releases.ts` | CURRENT → `0.1.0-alpha.38` / API `0.36.0` unchanged; append trusted alpha.37 seed exactly (`r42327405382-a1`, accepted `2026-11-07T02:10:06Z` from seed unix `1794017406`). Push-496 / 0060 candidate source kept out. |
| `apps/web/src/lib/releases.test.ts` | Descriptor/seed assertions for alpha.38 + alpha.37. |
| `apps/web/test/releases.test.tsx` | Length 41 rows / 46 deployments; alpha.37 + current prose. |
| `apps/web/test/releases-server.test.ts` | Expected trusted records 46 (was 45); allowlist + latest `accepted_at` list. |
| `docs/handoffs/map406-idle-refresh.md` | This handoff. |

## Target behaviour (for QA / 75s browser)

- 75s idle on open Moscow map: no extra `/v1/venues` (or games) full-catalog poll after the initial necessary pagination pair (~50+34). All 84 initial markers remain.
- Return to visible tab: exactly one venues+games pagination pair despite focus/visibility burst.
- Current city/day change, manual retry, session change still reload; session invalidation is not coalesced away.
- Stop/abort: no late updates; unknown vs zero/loading/error/retry preserved; no map remount/camera jump.
- Hidden refresh rejected unless the explicit initial load.

## Out of author path / follow-up

`apps/web/test/venue-sheet-integration.test.tsx` still expects obsolete idle `30000` catalog poll (same continuity block). Not in allowed_paths; integrator/QA should align it with continuity (idle no-fetch + focus refresh) before full CI green, or expand writer path.

AGENTS.md absent in this checkout snapshot; START_HERE / assignment rules used. No Git writes, network, models, live DB, or GH from author.

## Release notes (candidate)

- Version: `0.1.0-alpha.38` · API contract `0.36.0`
- Title: «Карта площадок без лишнего опроса каталога в простое»
- Fix: idle map no longer repeats full venue catalog load
- Owner UAT / iPhone: NOT_TESTED · gitSha/acceptedAt: null until ACCEPTED

## Checks

Author: bounded source only. Root/trusted process: host target tests + independent QA + full CI + DEV + real 75s browser; then Owner UAT. Author self-check is not independent QA.
