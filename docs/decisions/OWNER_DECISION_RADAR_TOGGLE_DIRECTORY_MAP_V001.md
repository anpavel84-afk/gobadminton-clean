# OWNER DECISION — Radar as toggle + distance list + optional map v001

Status: **OWNER_CONFIRMED — BINDING PRODUCT DIRECTION**
Date: 2026-10-07
Scope: GoBadminton consumer Players / Radar experience

## Owner intent

Radar is not a separate mode whose primary entry immediately opens a map.

Radar is an availability / nearby-discovery state controlled from the main **Игроки** surface.

### Radar OFF

- The normal Players directory remains visible.
- Existing directory/search/filter behavior remains the default.
- Radar users are not implicitly preferred or mixed into a pseudo-distance order.

### Radar ON

- The main Players surface becomes the nearby Radar list.
- Show **only other users whose Radar presence is currently active and eligible**.
- Sort them from nearer to farther using server-side coarse distance.
- Do not expose raw coordinates, exact peer location, bearing, last-seen or a precise meter value.
- Existing safe proximity labels/bands may be used in the UI.
- One eligible peer is enough to show a result. The current sparse cohort requirement of three peers is rejected for this consumer behavior.
- A separate **На карте / Посмотреть на карте** action appears while Radar is ON.
- The map is an alternate representation of the same active Radar result set, not the mechanism that turns Radar on.

## Activation semantics

- The Players page uses a real Radar ON/OFF toggle/switch, not a navigation link disguised as activation.
- First activation may require authentication, consent and browser geolocation.
- Successful activation leaves the user on the Players page and changes that page into Radar-nearby mode.
- Turning Radar OFF explicitly removes/stops the user's Radar presence and returns the Players page to the normal directory.
- Opening or closing the map must not itself start or stop Radar.

## Lifetime / navigation

Radar presence must not depend on keeping the dedicated map page mounted.

The client must maintain Radar session/heartbeat at an app/shell level sufficient for ordinary consumer navigation while the document/PWA is foreground-visible.

Existing privacy/safety lifetime rules remain authoritative:
- foreground lease / expiry still applies;
- hidden/background browser behavior remains fail-closed;
- exact location is never published;
- session ownership, consent, freshness/accuracy, TTL, block/social-eligibility and proof fences remain intact.

No requirement is created for indefinite background tracking.

## Matching / ranking

- Change sparse minimum from the effective current behavior of 3 peers to **1 peer**.
- The server may compute coarse distance for ordering but the public Radar result contract should continue to avoid exact distance leakage unless separately Owner-approved.
- Primary ordering in Radar ON list is nearest → farther.
- Use a deterministic privacy-safe tie-breaker for equal/near-equal ordering.
- Result cap may remain bounded.
- Region partitioning remains required. This decision does not globally remove region/privacy gates.
- Existing Owner-only global-debug exception remains a test exception, not general product policy.

## Map

- Keep the existing GoBadminton schematic/Radar visual language unless Product/UX identifies a Style Guide reason to adjust it.
- Do not introduce Yandex/Google/full map SDK as part of this slice.
- The map must use the same server result cohort/order semantics as the list.
- It must be reachable from Radar ON state and provide a clear return to the Players list.

## Architecture classification

This is **not a new platform architecture program**.

It is a bounded product/UX and implementation reconciliation:
- backend matching threshold/order;
- frontend Radar lifecycle ownership;
- Players page composition;
- existing Radar map role.

If implementation discovers a genuinely incompatible backend contract or a privacy/security invariant that cannot support this Owner direction without architecture change, stop and record `ARCHITECTURE_REVIEW_REQUIRED`; do not silently redesign the system.

## Supersession of prior schematic-map direction

Prior Owner direction is recorded at:
`docs/prompts/pm/radar-schematic-moscow-map-product-rework-v001.md`

This decision **supersedes only its map-first interaction model**:
- Radar ON must no longer default into the map as the primary experience;
- the primary Radar ON experience is the nearest-first player list on `/players`;
- the map is opened explicitly as a secondary view.

The earlier visual goal may be retained:
- a branded schematic Moscow-style map is still desirable for the secondary map view;
- no Yandex/Google embedded map is introduced;
- approximate/privacy-safe placement remains required.

If recognizably geographic Moscow placement would require a new peer-location contract, Product/UX must prefer the smallest no-architecture alternative for this slice. Do not invent a new exact/coarse geographic DTO unless a later explicit architecture review is authorized.

## Style Guide

All visual/composition work remains bound by:
`docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md`

Use existing toggle, PlayerCard, buttons, banners/notices, drawer/bottom-sheet and Radar families before inventing new primitives.

Every implementation handoff must include `STYLE_GUIDE_PARITY`.
