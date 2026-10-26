# Map + venue modal split (offline, NOT published)
Base: dev b601d075 (cursor-github clone), Owner spec UI/UX V001 (DEV only). Adapter checked: /workspace/ai_dev.py (validate_issue + 17 negative controls per body, all rejected). Bodies: M0.body.txt, M1.body.txt (6.7 and 7.3 KB; goal <=6000 chars, acceptance <=6000, max_attempts 3).

## Path check
- Games list/map switcher: components/consumer/games/GamesViewAction.tsx and components/consumer/pages/GamesDiscoveryPage.tsx. Both ALLOWED (apps/web/src/components/**).
- Map files: GamesVenueMap.tsx, GamesMapView.tsx, GamesMapViewport.tsx, lib/games-venue-map.ts, lib/radar-map-assets.ts, styles/*.css. ALLOWED.
- RESTRICTED/avoided: apps/web/src/app/** ([param] routes, e.g. app/venues/[venueId]/page.tsx and app/games/[gameId]). Not needed: the modal lives inside the map; the old venue page stays as deep-link target. Any later need to edit it must be an explicit Owner/ops decision.

## Order (one at a time, each after previous DEV ACCEPTED)
| # | Issue | Size | Depends |
|---|---|---|---|
| M0 | Basemap: error classification/logging, size-before-init, allowlist check, honest error card (Повторить / ← К списку) | S | #82 done |
| M1 | Full-screen shell: single '← К списку', remove search/chips/bottom capsule/toolbar/legend, marker states (white shuttle / lime count / violet+lime ring), overlap separation | M | M0 |
| M2 | Selection state + compact preview card (VenuePreviewCard.tsx); marker tap no longer location.assign; camera kept | M | M1 |
| M3 | Bottom sheet venue card (VenueSheet.tsx): drag handle, X, swipe-down, Esc, scroll lock, focus trap; photo 16:9 (+source pill only if data), name/address, Маршрут, Поделиться, 'Пока нет игр' + create game if permitted | M | M2 |
| M4 | Games state in the same sheet: big lime 'Показать игры на этой площадке →', back arrow, X, date chips (venue timezone), compact game cards, empty state; reuses venueSchedules | M | M3 |
| M5 | Polish: animations + reduced motion, desktop floating panel, 390/430/short/landscape, 44px targets, focus return to marker, browser tests, retire dead code | S | M4 |
| M6 | Venue photo source data (API+migration+contracts+admin edit, field photo_source/photo_source_url) + web pill 'Фото: <source> ↗' | M | independent; shares plan with venue photos; before pill is useful |
| M7 | City registry replacing MOSCOW_BUNDLE + enable Saint Petersburg (needs SPb map files on server, operator task) | M | M1; blocked on server files |
Radar stays Moscow-only until a separate task.

## Notes
- M0 cannot prove the cause from source alone (server verified healthy; tiles populated). It ships diagnostics + all plausible fixes + honest error; the Owner/QA DEV check decides. Screenshot evidence: attribution and markers shown but no water/roads/labels and the 'unavailable' branch fired => likely swallowed MapLibre error(s).
- Style layers use source-layers boundaries, earth, landcover, landuse, places, roads, water only (tiles also have buildings, pois): pale map expected until a richer style is wanted (Owner decision D2).
- Bodies for M2-M7 are not written yet.

## Owner decisions
D1 Venues without coordinates (e.g. Arena Sk, BADMCLUB, ВС Krasnogorsk) will be invisible on the map in success mode: accept, or keep a small 'Площадки без точки' entry?
D2 Basemap richness: keep current style (no buildings/POIs) or ask for a richer one (server-side style file, operator).
D3 Activity/day filters disappear in map mode (spec: no filters): they keep applying from the list. OK?
D4 Photo source field (M6): approve the data model and when to fill it.
