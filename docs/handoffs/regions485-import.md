# Regions #485 — fixed maps, public attribution, operator QA repair

Source-only work for Owner Direct #485 (attempt 2). Continues the DEV import adapter and adds public regional map packs + business-source credits. No PROD, no author-side apply/deploy/GitHub.

## Files (this milestone)

- `tools/venues/import-badminton4u-regions.cjs` (+ `.test.cjs`) — QA repair: actor lock SQL shape, contact provenance, PostGIS-authoritative 40 km / 150 m
- `packages/contracts/src/regional-cities.ts` — immutable 11 city UUID/center/timezone/40 km literals
- `apps/web/src/lib/regional-map-packs.ts` — 11 packaged Protomaps 4.15.2 descriptors (not published by author)
- `apps/web/src/lib/radar-map-assets.ts` — `mapBundleForCity` / `mapIdForBundle` extended for the 11 packs only
- `apps/api/src/venues/venue-catalog-source.ts` — strict `B4U_SOURCE_V1` → public `catalogSource`
- `apps/api/src/venues/venue-profile.ts` / `venues.service.ts` — profile projection + regional `ST_DWithin(…, 40000)` on catalog search for the 11 ids only
- `apps/web/src/components/consumer/venues/VenueSourceCredit.tsx` (+ gallery wiring)
- `apps/web/src/lib/releases.ts` — alpha.30 / API 0.35.0 candidate; historical seed for accepted alpha.29 only (no fake candidate receipt)
- This handoff

## Operator QA repairs (independent FAIL → fix)

1. **Actor lock** — `FOR UPDATE OF p,u` on a non-aggregate principal+user query, then separate `GROUP BY` grants read (revocation serialization preserved).
2. **Contact provenance** — every nonempty public phone/website/messenger requires a matching `contactSources` `{contactType,value}`; empty contacts remain valid.
3. **Spatial authority** — spherical haversine never rejects 40 km or 150 m; `ST_DWithin` geography is authoritative for city radius, existing catalog pairs, and new batch pairs.

## Runtime assumptions

Execute import inside the existing API container (`cwd` `/app/apps/api`). Trusted parent owns: disposable PostGIS integration, map-asset publication, reviewed manifest `--apply` on DEV, Product CI, and DEV acceptance. Author must not run live import/deploy.

## Out of scope / limitations

- Claiming Mode B / AGY READY, QA PASS, or DEV ACCEPTED
- PROD, main merge, gallery rewrite, Radar people-region expansion, UnifiedMap enum expansion
- Fake deploy receipt/date for the current alpha.30 candidate
