# #459 · Saint Petersburg map city support (source candidate)

## Binding

| Field | Value |
| --- | --- |
| Issue | #459 |
| Assignment | `OWNER_NIGHT_SPB459_EXISTING_MAP_CITY_SUPPORT_DEV` attempt 2 (repair) |
| Base SHA | `d35a12779b49232230e41fd40c9944364ddc3945` (pass1 known-terminal; HOLD preserved) |
| Prerequisite | #458 `cc771c3700accae431e7bff9131433cd7be694ae` · `r41825585671-a1` · TECHNICAL_DEV_ACCEPTED |
| App / API | `0.1.0-alpha.24` / `0.31.0` (unchanged this pass) |
| Author | Cursor Auto (source only; five allowed paths) |
| UAT | `NOT_TESTED` (physical/Safari/authenticated Owner) |

### Closed city packs

| City | cityId | mapId | version | client styleHash |
| --- | --- | --- | --- | --- |
| Moscow (unchanged) | `a0000000-0000-4000-8000-000000000001` | `moscow` | `moscow-20261007-p4-098a869f-v001` | `0ed883…` (API env `a9d887…`) |
| Saint Petersburg | `a0000000-0000-4000-8000-000000000002` | `saint-petersburg` | `saint-petersburg-20261104-p4-b7d3b1a8-v001` | `d87e1b4a28944babc70133ce9bb89dce2ccbd6ac7d5594f4691c79ccf54cb6ea` |

SPb pack prefix: `https://dev.gobadminton.ru/map-assets/releases/saint-petersburg-20261104-p4-b7d3b1a8-v001/`  
Immutable candidate: `saint-petersburg-20261104-p4-b7d3b1a8-v001` · tile SHA `b7d3b1a8…` · **PACKAGED_NOT_PUBLISHED** (404 URLs expected until PMA publish).

## Pass2 repair (this attempt)

Observed local failures from delivered pass1 logs (`web-typecheck.log`, `web-map-release-tests.log`):

1. **`GamesVenueMap.tsx`** — `pack` stayed `FixedMapBundle \| null` across nested async `start()`, so TS18047/TS2345 on style/hash/resource/camera/aria paths; null would also coerce toward `allowedMapResource`’s default Moscow parameter. Fix: unsupported-city early return unchanged; after guard, capture `const pack: FixedMapBundle = selectedPack` for the whole effect lifecycle; city-change still remounts via `[attempt, cityId]` cleanup. No non-null assertions, casts, or Moscow default leak.
2. **`games-map-module-loading.test.tsx`** — required `cityId` on ErrorComponent callsite; expected forwarded props include `cityId: MOSCOW_BUNDLE.cityId`. Other assertions preserved.
3. **`radar-map-module-loading.test.tsx`** — required `cityId: MOSCOW_BUNDLE.cityId` on alert-component render callsite. Other assertions preserved.
4. **`releases-server.test.ts`** — expected `accepted_at` list completed with already-seeded alpha.23 value `2026-11-04T12:06:05Z` from `releases.ts` (`r41825585671-a1`). Seed count 32 and version allowlist already included alpha.23; no invented timestamps, no history deletion, no weakened counts.

Paths touched: only the five allowed. No API/contracts/release catalogue/map data/config/runtime/dependencies/Git/network changes.

## Source behaviour (unchanged product intent)

- `radar-map-assets.ts`: second fixed bundle + `mapBundleForCity`; Moscow literals untouched; resource allowlist per selected pack.
- Backend: separate `RADAR_DEV_SPB_MAP_PREVIEW_*` (default `0`); Moscow flags/hash unchanged; same DEV/PROD origin gates.
- OpenAPI `UnifiedMap`: closed missing | moscow | saint-petersburg pairs; types regenerated.
- Games/Radar map readers use selected city center/bounds/hash; city change remounts map, clears camera/selection; camera/selected storage scoped (Moscow keeps legacy keys).
- Unknown city → honest unavailable + list; no Moscow→SPb relabel; no new map engine/deps/data collection.
- Privacy unchanged: public venues/games; people pins only via existing signed query/consent.

## Author environment notes

- Workspace has no `.git` / no `node_modules`; installed Next `apps/web/node_modules/next/dist/docs/` absent — no framework docs read; no dependency install or broad checks in model sandbox.
- Pass1 evidence: typecheck FAIL (GamesVenueMap + two module-loading callsites); map/release suite 83/85 PASS with the two test failures above. API/static checks previously PASS per assignment.
- Author did not rerun typecheck/vitest here; PMA reruns web typecheck and affected test files, then independent full candidate QA.

## Pending PMA (not this author)

1. Independent data review + guarded static publish of the SPb pack.
2. Set DEV env `RADAR_DEV_SPB_MAP_PREVIEW_ENABLED=1` + exact version/style SHA after publish.
3. QA → Product CI → DEV release/smoke; Owner UAT separately.
4. PROD not authorised by this source.

## Status

Pass2 repair candidate complete for the four observed local failures. Descriptor `source_sha`/acceptance date remain null until trusted DEV acceptance. No metro/completeness/physical Safari claims. UAT=`NOT_TESTED`.
