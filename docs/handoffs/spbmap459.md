# #459 · Saint Petersburg map city support (source candidate)

## Binding

| Field | Value |
| --- | --- |
| Issue | #459 |
| Base SHA | `cc771c3700accae431e7bff9131433cd7be694ae` (#458 ACCEPTED) |
| App / API | `0.1.0-alpha.24` / `0.31.0` |
| Author | Cursor Auto (source only) |
| UAT | `NOT_TESTED` (physical/Safari/authenticated Owner) |

### Closed city packs

| City | cityId | mapId | version | client styleHash |
| --- | --- | --- | --- | --- |
| Moscow (unchanged) | `a0000000-0000-4000-8000-000000000001` | `moscow` | `moscow-20261007-p4-098a869f-v001` | `0ed883…` (API env `a9d887…`) |
| Saint Petersburg | `a0000000-0000-4000-8000-000000000002` | `saint-petersburg` | `saint-petersburg-20261104-p4-b7d3b1a8-v001` | `d87e1b4a28944babc70133ce9bb89dce2ccbd6ac7d5594f4691c79ccf54cb6ea` |

SPb pack prefix: `https://dev.gobadminton.ru/map-assets/releases/saint-petersburg-20261104-p4-b7d3b1a8-v001/`  
Immutable candidate: `saint-petersburg-20261104-p4-b7d3b1a8-v001` · tile SHA `b7d3b1a8…` · **PACKAGED_NOT_PUBLISHED** (404 URLs expected until PMA publish).

## Source behaviour

- `radar-map-assets.ts`: second fixed bundle + `mapBundleForCity`; Moscow literals untouched; resource allowlist per selected pack.
- Backend: separate `RADAR_DEV_SPB_MAP_PREVIEW_*` (default `0`); Moscow flags/hash unchanged; same DEV/PROD origin gates.
- OpenAPI `UnifiedMap`: closed missing | moscow | saint-petersburg pairs; types regenerated.
- Games/Radar map readers use selected city center/bounds/hash; city change remounts map, clears camera/selection; camera/selected storage scoped (Moscow keeps legacy keys).
- Unknown city → honest unavailable + list; no Moscow→SPb relabel; no new map engine/deps/data collection.
- Privacy unchanged: public venues/games; people pins only via existing signed query/consent.

## Reused (not rewritten)

MapLibre v6 bundled worker, PMTiles protocol, CSP/origin gates, shared map + venue sheet gestures, keyboard, WebGL/Safari fallback path, fonts/sprites/licenses from accepted Moscow theme (SPb style reuses; Moscow metro layers intentionally absent — no SPb metro claim).

## Pending PMA (not this author)

1. Independent data review + guarded static publish of the SPb pack.
2. Set DEV env `RADAR_DEV_SPB_MAP_PREVIEW_ENABLED=1` + exact version/style SHA after publish.
3. QA → Product CI → DEV release/smoke; Owner UAT separately.
4. PROD not authorised by this source.

## Status

Bounded source candidate complete. Descriptor `source_sha`/acceptance date remain null until trusted DEV acceptance. No metro/completeness/physical Safari claims.
