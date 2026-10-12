# OWNER DECISION — Radar geographic visibility + explicit location sharing v001

Status: **OWNER_CONFIRMED — BINDING PRODUCT DIRECTION**
Date: 2026-10-07
Scope: GoBadminton · Players / Radar / geographic map
Source: direct Product Owner instruction in project chat

## 1. Owner intent

The current Radar privacy model is too restrictive for the intended product.

Radar is meant to be a conscious **location-sharing mode**.

When a user explicitly turns Radar ON, the product must clearly tell that user that their current approximate geographic location will become visible to other GoBadminton users through the Radar experience for as long as that Radar session remains active.

The user consents to this visibility by deliberately enabling Radar after the disclosure.

The product must not pretend that Radar dots are non-geographic or intentionally place people at synthetic angles unrelated to their real city position.

## 2. Required user-facing meaning

The core meaning is:

> **«Включая Radar, вы делаете своё примерное местоположение видимым другим пользователям GoBadminton, пока Radar включён.»**

Exact final copy may be refined by Product/Design, but it must preserve all of these meanings:
- location becomes visible;
- visibility is deliberate;
- location is approximate/geographic, not synthetic;
- visibility lasts while Radar is active;
- user can stop sharing by turning Radar OFF.

No silent opt-in from OAuth, profile creation, page load or ordinary directory use.

## 3. Geographic map requirement

Radar map must be a **recognizable city map**, not an abstract radar plane whose marker angle has no geographic meaning.

For Moscow:
- the map may be a lightweight GoBadminton-owned schematic/vector map;
- it may show a simplified city outline, river, districts/large areas or other useful city references;
- it does not need street-by-street cartographic detail;
- a player marker must appear in a geographically meaningful approximate part of Moscow;
- if a player is in/near Sokolniki, their marker must not be rendered on an unrelated random side of the city.

The same semantic model must generalize to other supported cities with their own city map assets/configuration.

No Yandex/Google embedded map SDK is required by this decision.

## 4. Precision boundary

Owner does **not** require exact building/home pins.

The accepted target is **approximate but real geographic placement**:
- district / large area / coarse geographic cell / equivalent;
- enough detail for another user to understand roughly where in the city the Radar participant is;
- no synthetic non-geographic angle as the primary map position.

Raw GPS may remain server-only.

Architecture should prefer the smallest meaningful representation, for example:
- existing coarse cell center;
- coarse latitude/longitude derived from that cell;
- region/district + normalized map coordinate;
- another stable coarse geographic display projection.

This is a product-utility decision, not an anonymity objective.

## 5. Visibility audience

When a user turns Radar ON, they authorize that approximate Radar location to be visible to authenticated GoBadminton users who can access the applicable Radar/map experience in that supported city.

**Viewer reciprocity is not a privacy requirement.**
A viewer does not need to publish their own location merely to be allowed to see users who voluntarily enabled Radar.

Product may still use the viewer's own location for nearest-first ranking or other convenience when available, but the architecture must not treat “both users must publish location” as the only lawful/product-valid visibility model.

Existing block/restriction/eligibility rules still apply.

## 6. What remains protected

This decision changes location-display semantics; it does not authorize unnecessary retention or passive tracking.

Retain:
- explicit Radar ON/OFF;
- foreground acquisition;
- bounded active session / expiry;
- explicit stop;
- session ownership/takeover protections;
- account restriction and bilateral block enforcement;
- no location history unless separately approved;
- no indefinite background tracking;
- no hidden activation;
- no exposure after stop/expiry/revoke;
- no unauthenticated public location feed.

A user's consent to active sharing does not justify storing a historical movement trail.

## 7. Supersession

This decision explicitly supersedes the prior Radar rules **only where they conflict with meaningful geographic visibility**.

Superseded for the map/result presentation:
- “no raw peer coordinates/client geographic position under any circumstances” as a blanket product invariant;
- synthetic `displaySlot` / non-geographic angle as the canonical map-placement mechanism;
- the requirement that the map must not convey a real district/area;
- prior instructions to keep Moscow motifs decorative with no geographic meaning;
- any architecture rationale that treats approximate participant location as something the product must conceal despite explicit Radar consent.

Specifically impacted prior records include:
- `docs/manifest/OWNER_DECISION_RADAR_MVP_V001.md` — Privacy / display boundary;
- `docs/workbench/architecture/social-player-network-messaging-v002/ADR-SOCIAL-004-radar-mvp-reconciliation.md` — synthetic-angle/client DTO/privacy portions;
- `docs/workbench/design/final-consumer-social-production-design-spec-v001/RADAR_MVP_UI_SPEC.md` — non-geographic canvas semantics;
- `docs/decisions/OWNER_DECISION_RADAR_TOGGLE_DIRECTORY_MAP_V001.md` — “exact location never published” / “no geographic DTO” wording, to the extent it prevents approximate geographic placement;
- `docs/prompts/pm/radar-schematic-moscow-map-product-rework-v001.md` — privacy-safe schematic placement where it prohibited meaningful geography.

Not superseded unless Architect finds a direct dependency:
- Radar toggle/list-first product flow;
- map as a separate/secondary view if that remains the accepted UX;
- K=1 Owner decision;
- result cap;
- session lifetime;
- block/restriction checks;
- proof-bound contact;
- no background tracking;
- no movement history.

## 8. Existing implementation fact to reuse

Current Radar already quantizes a foreground GPS fix into a coarse geographic cell and stores a `coarse_center` server-side.

Therefore the required change should be treated first as a **contract/authorization/presentation reconciliation**, not an assumption that entirely new geospatial storage is needed.

Architect must inspect the current implementation and decide whether the existing coarse-cell model is sufficient to expose a meaningful approximate map point safely and consistently.

## 9. Consent / disclosure evidence

Architecture must define a versioned, auditable way to prove which Radar location-sharing disclosure the user accepted.

The disclosure should be shown at first enable and again when the consent policy version materially changes.

Do not use a generic hidden privacy-policy acceptance as a substitute for the Radar-specific location-sharing disclosure.

## 10. Product acceptance

This direction is satisfied when:
1. Radar OFF means the user is not sharing Radar location.
2. Enabling Radar clearly discloses that approximate location will be visible to other users.
3. Radar ON publishes a geographically meaningful approximate location.
4. The city map lets another user understand roughly what part of the city the participant is in.
5. Turning Radar OFF / expiry / revoke removes the participant from Radar visibility.
6. The client does not need exact raw GPS if an existing coarse cell provides sufficient map utility.
7. The system no longer deliberately randomizes a user's map position away from their true city area.

## 11. Required next step

Architect must publish a bounded reconciliation before Implementation changes the contract.

The Architect should:
- trace all dependencies on `displaySlot`, `proximityBand`, mutual-opt-in viewer presence, and no-peer-geo DTO rules;
- define the new geographic display contract;
- define consent and visibility authorization;
- define multi-city map projection/config;
- preserve lifecycle/block/restriction controls;
- provide migration/compatibility strategy;
- produce exact PM/Implementation + independent QA successor prompts.

This Owner decision does not itself authorize code, deploy or production activation.
