# OWNER DECISION — MapLibre + OpenStreetMap for Radar map v001

Status: **OWNER_CONFIRMED — BINDING PRODUCT/TECH DIRECTION**
Date: 2026-10-07
Scope: GoBadminton Radar map / geographic rendering
Source: direct Product Owner instruction in project chat

## 1. Decision

For the GoBadminton Radar map, choose the following stack as the preferred MVP direction:

- **MapLibre** as the client-side map renderer;
- **OpenStreetMap-derived data** as the cartographic data source;
- **self-hosted map tiles/data** preferred for MVP where operationally reasonable;
- GoBadminton backend/domain contracts remain **map-provider neutral**.

Do not build the Radar domain around Yandex Maps, Google Maps or any provider-specific coordinate contract.

## 2. Product intent

The Radar map should be a normal recognizable geographic city map, not a synthetic radar plane.

For Moscow and later supported cities:
- user can orient themselves using actual city geography;
- Radar participants are shown at approximate but geographically meaningful positions;
- the map may show roads/areas/river/landmarks according to the selected style and zoom;
- Radar privacy/consent semantics remain governed by the separate Owner geographic-visibility decision.

This decision does not change the accepted product flow that the Players list may remain the primary Radar ON surface with map as a secondary view.

## 3. Rendering boundary

MapLibre is a presentation/rendering dependency.

The GoBadminton API should expose ordinary geographic values/DTOs needed by product semantics, not MapLibre-specific objects.

Do not introduce fields such as:
- maplibreX/maplibreY;
- providerTileId;
- yandex-specific/google-specific identifiers.

Preferred geographic contract remains WGS84/coarse display coordinates or another provider-neutral representation selected by Architect.

## 4. Tile/data hosting direction

For MVP, prefer a stack where GoBadminton controls the map-serving dependency rather than paying for a commercial map SDK.

Architect must evaluate the smallest practical self-hosted setup, including candidates such as:
- prebuilt vector-tile archive;
- PMTiles or equivalent static tile archive;
- MBTiles + lightweight tile server;
- OpenMapTiles-compatible generated vector tiles;
- another equivalent solution justified by operational simplicity.

The Owner does **not** require a heavyweight tile-generation platform or continuously running geodata database if static/prebuilt regional tiles are enough.

Moscow first. Additional cities should be addable as separate regional datasets/configuration.

## 5. OpenStreetMap usage/legal boundary

OpenStreetMap data may be used, but architecture must explicitly verify:
- attribution requirements;
- ODbL/database obligations relevant to the chosen derivative/distribution;
- public OSM tile-server usage policy;
- whether self-hosting/generated tiles avoid reliance on community public tile infrastructure;
- any third-party style/font/sprite licenses.

Do not treat the public `tile.openstreetmap.org` infrastructure as the production map backend unless current policy explicitly permits the intended usage and load.

## 6. Styling

Map style should be GoBadminton-controlled.

Requirements:
- restrained visual style compatible with current GoBadminton UI;
- Radar avatars/markers visually dominant over the base map;
- enough city detail for orientation without visual clutter;
- attribution remains visible where required;
- style assets/fonts/sprites must have clear licenses.

Exact visual styling remains Design/Product-owned after technical architecture is frozen.

## 7. Radar marker semantics

The map consumes the accepted approximate geographic Radar display position.

Markers:
- avatar/initials;
- selected state;
- collision handling;
- same current Radar result set as the list where product flow requires;
- no synthetic geographic displacement that moves a participant into an unrelated city area.

Small display-only collision offsets are allowed if they do not misrepresent the approximate area.

## 8. Multi-city

Architecture must support:
- Moscow first;
- Saint Petersburg and other Russian cities later;
- city-specific tile datasets/bounds/default viewport;
- no code rewrite when a city is added;
- city dataset/version manifest;
- safe unsupported-city fallback.

## 9. Web/PWA and native future

P0 implementation is Web/PWA.

Architect should keep the mapping layer compatible with later:
- MapLibre GL JS on web/PWA;
- MapLibre Native or another provider-neutral native renderer on iOS/Android.

Do not force native implementation now.

## 10. Routing/navigation

In-app turn-by-turn routing is **not P0**.

For MVP, venue/player navigation may continue to open an external map/navigation app if needed.

The selected architecture should not prevent adding self-hosted routing later, but do not add OSRM/Valhalla/openrouteservice now unless a current product requirement needs it.

## 11. Operational goals

Architect must optimize for:
- minimal VPS complexity;
- predictable bandwidth/storage;
- fast map load on mobile;
- CDN/cache friendliness;
- easy dataset refresh/rollback;
- no map-vendor runtime key dependency if self-hosting is selected;
- deterministic build/deploy of map assets.

Heavy geodata generation should not run on the resource-constrained Moscow frontend host if it can be built elsewhere and published as static artifacts.

## 12. Required next step

Architect must reconcile this map-rendering decision with the existing Radar geographic-visibility architecture task.

Architect should publish:
- selected tile/data packaging and serving strategy;
- web MapLibre integration boundary;
- provider-neutral Radar DTO compatibility;
- regional dataset lifecycle/update process;
- storage/bandwidth/resource estimate;
- attribution/license checklist;
- deployment/cache/nginx/CDN design;
- failure/fallback behavior;
- native extension boundary;
- exact PM/Implementation/QA successor artifacts.

This Owner decision does not itself authorize implementation or deployment.
