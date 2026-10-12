# OWNER DECISION — Shared MapLibre/OSM platform for Games/Venues map v001

Status: **OWNER_CONFIRMED — BINDING PRODUCT/TECH DIRECTION**
Date: 2026-10-07
Scope: GoBadminton Games discovery / Venue map
Source: direct Product Owner instruction in project chat

## 1. Decision

The MapLibre + OpenStreetMap stack selected for Radar is not a Radar-only one-off.

It becomes the preferred **shared map foundation** for GoBadminton web/PWA map surfaces.

The second required consumer is the existing Games discovery map placeholder:

> **«Рядом с вами · <город> на карте»**

For this surface, the map does **not** show player locations. It shows **Venues that currently have Games matching the same discovery filters as the Games list**.

## 2. Product semantics

The Games map is another representation of the current Games discovery result space.

For a selected city/date/activity/filter set:
- list shows matching public published Games;
- map shows the Venues on which those matching Games take place;
- one Venue is one geographic marker even if several matching Games exist there;
- selecting a Venue marker must let the user inspect the matching Games at that Venue and navigate to Game detail;
- changing discovery filters changes both list and map semantics consistently.

The map must not invent a separate catalogue whose results disagree with the Games list.

## 3. Venue coordinates

Venue coordinates are ordinary Venue geography, not privacy-sensitive Radar participant location.

Current GoBadminton Venue/Game contracts already contain WGS84 latitude/longitude for the Venue.

Architecture should reuse canonical Venue coordinates and must not introduce MapLibre-specific coordinate fields.

## 4. Shared map foundation

Reuse the same:
- MapLibre renderer integration;
- OSM-derived map data/tile stack;
- style/assets;
- attribution;
- hosting/cache/versioning;
- city dataset manifest;
- failure/fallback strategy

that is selected by the preceding Radar MapLibre/OSM architecture task.

Do not add a second map SDK, second tile platform or independent city-map pipeline for Games.

## 5. Discovery truth

The authoritative predicate remains Games discovery/business state.

Only Games eligible for ordinary public discovery may cause a Venue marker to appear.

At minimum the map must respect the same current filters that the Games discovery list uses, including:
- city;
- date/time window;
- activity kind;
- any admitted level/filter dimensions.

Cancelled, draft, unlisted or otherwise non-discoverable Games must not produce public map markers.

If Venue verification status is not itself a Games-discovery exclusion, the map must not silently add a different exclusion.

## 6. Marker aggregation

A Venue with multiple matching Games should appear once.

The marker/popup projection should be able to expose only the bounded data needed for discovery, such as:
- Venue id/name;
- Venue latitude/longitude;
- address if already public;
- count of matching Games;
- nearest/next matching Game time;
- bounded preview of matching Game ids/cards.

Exact visual composition is Product/Design-owned.

Architecture must avoid a query pattern that requires N+1 requests per Venue.

## 7. Pagination / completeness

The current Games list is paginated. A map that only displays the first list page may be misleading.

Architect must explicitly define whether:
- the existing Games endpoint is sufficient for a complete map at MVP scale; or
- a dedicated **map projection endpoint** is required.

If a new map projection is selected, it must reuse the same discovery predicate/query module as the list rather than duplicate business rules.

The map may use bounded result caps, viewport/city bounds or aggregation, but must disclose/fail safely rather than silently omit arbitrary matching Venues.

## 8. Map interaction

The existing sidebar placeholder should become a real entry point to the Games map.

The exact responsive interaction is not frozen here, but architecture must support:
- mobile/PWA;
- desktop;
- city default viewport;
- marker selection;
- return to/open Games list/detail;
- no mandatory user geolocation.

If the user grants location, a non-authoritative «Вы здесь» marker may be added later/within the implementation slice, but it is not required to display Games.

## 9. Multi-city

Use the shared map city dataset/config selected for Radar:
- Moscow first;
- other cities later;
- no separate Games-map onboarding pipeline.

Venue coordinates remain provider-neutral WGS84.

## 10. Routing

Turn-by-turn routing remains outside P0.

A Venue popup/detail may later offer an external navigation link. Do not add an in-app routing engine in this slice.

## 11. Failure/fallback

Map failure must not break Games discovery.

If MapLibre, style or map data fails:
- Games list remains usable;
- no Game becomes hidden merely because its map marker cannot render;
- UI shows a bounded map-unavailable state.

## 12. Required next step

After the preceding Radar MapLibre/OSM Architect task is complete, Architect must publish a **small follow-on reconciliation** for Games/Venues map.

It should reuse the selected shared map foundation and focus only on:
- discovery/map projection contract;
- filter parity;
- Venue aggregation;
- pagination/completeness;
- API/query reuse;
- responsive map integration boundary;
- QA/implementation decomposition.

This decision does not itself authorize code or deployment.
