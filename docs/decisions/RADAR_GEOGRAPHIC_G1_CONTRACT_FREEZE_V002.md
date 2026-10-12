# Radar Geographic v002 — PM/Owner contract reconciliation and G1 freeze

**Status: OWNER_DIRECTION_ACCEPTED / G1_CONTRACT_FROZEN_FOR_SOURCE_IMPLEMENTATION / NO_RUNTIME_OR_LIVE_CONSENT_ACTIVATION**  
Date: 2026-10-07. Prepared directly by PM, **without Codex**.  
Source base for review: `2aa41d60831992ef63ca10d7f871731703ce1b11`.  
Binding Owner geography decision: `docs/decisions/OWNER_DECISION_RADAR_GEOGRAPHIC_VISIBILITY_V001.md`.  
Architect source package: `d18e8217e553ec9b0139df263bfb8317cf4f8ce8` (ADR005, geographic DTO/query, consent/transition, map registry and 30-case QA matrix).  
Original RV3 source prompt `e296b18d3a177d1a69b517ba77b84041e14ae0b3` is **historical** and cannot be executed verbatim; it requires a registered MapLibre basis and the updated geographic contract, not old Leaflet/raw map extraction.

## Owner-closed semantics

1. Radar ON is an **explicit, temporary geographic publication** of approximate 1-km-grid derived location, with fresh disclosure and valid current policy consent. No silent ON, inferred OAuth/privacy consent, background tracking or movement history. Stop and expiry must work independently of viewer access.
2. Authenticated **Radar OFF viewer may browse current consenting publishers** for a supported city, without GPS, own publication, reciprocal presence or sharing consent. Guest cannot read location-bearing results. K=1; one eligible target may be shown. Viewer OFF does not change their incoming-message preference.
3. Only real **coarse center** WGS84 `latitude/longitude` may appear in authorized results, never raw GPS or random `displaySlot`. Precision is approximate; 1-km cell does not justify exact-meter or home-distance labels. Without origin, never label city results as nearest. A wrong/missing map must fail to **list-only** without fictional points.
4. Existing Players directory remains usable for ordinary profiles with its existing filters, search, avatar and contact capability. Geographic map markers include only authorized Radar publishers with valid coarse positions. Directory-only people do not get made-up markers, proofs or distances.
5. Keep `K=1`, cap20, query/preview budgets and expiry/generation/session/block fences; do not reintroduce reciprocal ON or k=3. A returned signed v2 resultRef is proof of a prior authorized result, not a substitute for current eligibility on contact. A stale/invalid supplied proof fails, never falls back to generic directory.
6. Static MapLibre/OSM PMTiles infrastructure on Moscow is **separate** from API, publishing, consent and session logic. Reuse existing accepted versioned Moscow asset/origin where verified; never rerun legacy Leaflet/raster/Geofabrik installation, invent a city map, or require an additional map server.
7. Current user-facing Radar shell/toggle, PlayerCard, mobile navigation and Style Guide are preserved. G2 is a scoped patch, not a wholesale Make/Figma import or screen replacement.

## Frozen G1 backend wire/data contract

The reviewed Architect `RADAR_GEOGRAPHIC_VISIBILITY_CONTRACT_V001.md` is the **authoritative geographic subset** for G1, with these clarified composition boundaries:
- `GET /v1/radar/config`: version/capability/registered-map/disclosure metadata, authenticated but **no publishing side effect**.
- `POST /v1/radar/results/query`: CSRF-protected authenticated read, city/nearby with explicit origin union; city+none requires no GPS; no arbitrary bbox/target enumeration. Stable deterministic ranking **before cap20**. Snapshot `contractVersion=radar-geographic-v1`, policy `radar-geographic-sharing-v1`, validUntil and no-store. Only eligible current consented publishers.
- `POST /v1/radar/results/preview`: v2 signed resultRef, viewer session/target generation and current policy fences; no viewer publishing requirement.
- `POST /v1/me/radar/activations` and takeover: explicit ON with current disclosure receipt and current foreground fix, preserving one-account ownership and short lease; renew/heartbeat cannot extend fix validity. `DELETE /v1/me/radar/activations/current` and consent withdrawal remain available when quotas/policy change.
- Consent evidence is an additive non-geographic audit of exact disclosure ID/hash/policy and acceptance/withdrawal; legacy boolean or existing presence **cannot** be upgraded silently. No durable raw/coarse location table or history.
- G1 can be implemented with synthetic identities and disposable PostgreSQL/PostGIS independently of the map artwork. G1 must not enable live geographic policy or expose previously consented live users.

### Narrow G1 versus G2 contract separation

**G1 geographic subset:** eligible publishers + coarse location + optional private origin + v2 proof + consent and lifecycle correctness. The contract's original `cap20`, **no pagination** and city/nearby scope remain in force **for this Radar-only subset**. G1 must not claim this is the complete ordinary directory, and must not replace normal directory pagination/search/filters with the Radar cap.

**G2 integrated Players list:** ordinary directory keeps its current independent filters and pagination. Radar ON or an authorized OFF viewer may add a distinct authorized geographic subset; map/list can share that geographic snapshot. Never merge only the first page of ordinary users with 20 Radar users and claim a globally nearest sorted complete directory. Any request for one unified, filtered, globally sorted directory (including directory-only profiles and numeric distance ordering) requires a **separately reviewed unified API contract** before changing ordinary directory semantics. Until then, present Radar subset and ordinary directory honestly, using labels/filters without fabricated distances. This resolves the documented Architect vs current-Players Figma conflict **without blocking G1**.

**Map assets:** the current MapLibre/PMTiles Moscow static origin is a shared rendering substrate. G2 must bind its exact accepted version, CRS/bounds/landmark calibration and attribution; `map.availability=registered` only after asset/registry verification. The older standalone SVG registry and Leaflet code from RV3 are **superseded as implementation choices**, while correct WGS84/coarse-position mapping, missing-city list fallback, local licensed attribution and independent asset QA remain binding.

## G1 independent QA before downstream

Run exact synthetic GEO-01..05,07,09,11..29 where backend-applicable: OFF-viewer no presence; one peer; 1km derived center; old consent never publishes; atomic stop/withdraw/session revoke/block; v2 proof/current target; city/radius/cap ordering and query budgets; stale/expired and concurrent contact; restore zero presence; redaction/no location-bearing logs; fresh/upgraded migrations; typecheck/lint/contract/build and real disposable PostGIS.

QA must bind **new implementation SHA** and return zero blockers with explicit merge recommendation. Source QA/merge does **not** authorize policy cutover, live consent migration, real-user data/GPS tests or deployment.

## Delivery order

1. PM merges this **docs-only Owner contract freeze**, then rebinds the existing `rv3-backend-v001` task to a **new exact G1 source-only implementation prompt** with independent QA and `api + schema-contracts` locks; do not reactivate old failed contract tasks or reset attempts.
2. In parallel, independently verify the **already installed** Moscow MapLibre/PMTiles artifact and prepare G2 visual contract/source with `docs` or asset-read-only lock. No duplicate map install. The original `rv3-moscow-map-assets-v001` task must be superseded/reconciled rather than executed verbatim.
3. After G1 accepted, implement G2 current-Players patch with real authorized coarse positions, map controls, mobile sheet and correct precision; independent browser QA.
4. Separate bounded **DEMO_PUBLIC preview** after G2 source QA/merge with rollback and postdeploy QA. No automatic real-user location exposure or conversion of old consent.

### Explicit STOP conditions

If fresh source reveals unresolved lock-order, current-user consent, proof/ID scope or profile-directory integration contradiction, implementer stops at `CONTRACT_REVIEW_REQUIRED` with exact code/line evidence; do not silently weaken authorization. If no registered asset, G1 continues and G2 remains list-only until map QA. Existing unrelated Xray/VPN, nginx, static map staging, real users and active Runner writers remain no-touch.

This document **freezes the product/contract decision for synthetic G1 development**, not the correctness of implementation or deployment.
