# OWNER DECISION — Map popups only, venue mockup v001

Status: **OWNER_CONFIRMED — BINDING PRODUCT DIRECTION**
Date: 2026-10-19
Scope: GoBadminton Games/Venues map, Radar players on map (tranche TR1: M3, M2R, MAP-FILTER)
Source: direct Product Owner (Pavel) instruction in project chat

## 1. Decision (2026-10-19 17:17)

- Map mode has **no right arrow** and **no navigation** to venue or player pages (no `/venues/...` links from the map).
- Venues and Radar players open **only as a popup over the map**.
- The compact card has a **drag handle** plus an **up-arrow button** that expands the popup.

## 2. Primary venue mockup (2026-10-19 17:34)

Reference (versioned, outside GitHub — images are never stored in the repo): https://files.anpavel.ru/projects/gobadminton/design/map/M3_venue_mockup.png
Approximate target; adapt to the current Style Guide. Text description:

- Compact cards are identical for venues with and without games.
- Expanded popup: photo carousel, name, rating, address, facts chips, block «Контакты площадки», CTA «Показать игры на этой площадке»; closes with X or swipe.
- Games sheet: date chips and game cards.
- Markers: number clusters for venues with games; shuttlecock icon for venues without games.

Other mockups: M2R — https://files.anpavel.ru/projects/gobadminton/design/map/M2R_mockup.png; MAP-FILTER — https://files.anpavel.ru/projects/gobadminton/design/map/MAP-FILTER_mockup.png (sha256 in SHA256SUMS in the same folder).

## 3. Delivery rule (2026-10-19 16:51)

No self-overwriting stages: do not split a feature into stages where a later stage rewrites the previous one.

## 4. Prior M3 history

- M2 (#112, PR #113) delivered the venue preview card over the map.
- Earlier M3 bodies (TR1-M3 v1–v5) were rejected in pre-publication review because this decision and the mockup were not in the repo; no separate M3 issue had been published before.
