# Handoff — backlog P0 residual #445 / #450 (alpha.11 candidate)

**Assignment:** `OWNER_BACKLOG_P0_VISUAL445_450_RESIDUAL` · attempt 1
**Author:** cursor:auto · base `1dc5000280d617c3160fc959ee87607db394410c` (alpha.10)
**App candidate:** `0.1.0-alpha.11` · API wire `0.22.0` · UAT=`NOT_TESTED`
**Refs:** #445 · #450 · Grok reports · Style Guide v3 · alpha11 brief + alpha10 history seed

## Source repairs (this pass)

### #445 map — false empty catalogue (FIXED)

**Cause:** `GamesMapView` announced «В каталоге города пока нет площадок» whenever `!venues.length`, including initial loading and failed venue responses (`venues=[]` before a fulfilled current-city response).

**Fix:** track `venuesFulfilled` from the latest venues response; emit the sr-only empty status only when `!loading && snapshot.cityId === cityId && venuesFulfilled && !venues.length`. Same-city retain/abort/pagination/failure and public venue access unchanged.

**Visible overlay vs sr-only:** empty claim and GamesVenueMap «Загружаем карту города…» are `gb-map-sr-only`. Visible cold-entry overlay remains `GamesMapModuleLoading` («Загружаем карту…») until the dynamic GamesVenueMap chunk resolves.

### #445 map — loader >3.5s after pins (INVESTIGATED · no fake repair)

**Flow:** next/dynamic `GamesMapModuleLoading` → GamesVenueMap MapLibre init → `load` sets `ready` + clears sr-only status in the same turn → markers reconcile on `ready`. Pins therefore require module already resolved and map `load` fired; inventing a timeout PASS or hiding the loader would mask genuine loading/error/timeout.

**Factual limitation:** cold network/chunk fetch for GamesVenueMap (and, when Radar `mapped`, a later Radar GeographicRadarMap dynamic with visible «Загружаем карту…») can exceed 3.5s and still clear correctly. No map asset/pin/policy/CSP or second MapLibre instance changes. Radar paths were out of this lease; no fake readiness. PMA browser before/after on actual DEV.

### #450 ordinary non-trainer 404 (FIXED on profile + create)

**Cause:** `ProfilePage` and `CreateGamePage` always `GET /v1/me/trainer-profile`; absence is legitimate 404 for non-trainers.

**Fix:** gate on authoritative `OwnSocialProfile.trainer` (`hasActiveTrainer`). Skip automatic trainer fetch when false. When true, still fetch real version/status and handle 401/404 races without fake success. `TrainerProfileEditPage` untouched (may load inactive). No backend/API contract change. Profile action band from alpha.10 unchanged. Transient null/unavailable own profile still fails closed (no silent authorize).

**Out of scope (preserved):** Kirill visibility / Owner #448 defaults; chat 404 for non-participant; second unknown 404 without path evidence; fixture bio data correction.

## Releases

- `CURRENT_APPLICATION_VERSION` → `0.1.0-alpha.11`; `source_sha` null until trusted ACCEPTED.
- Accepted alpha.10 seed added to `TRUSTED_HISTORICAL_SEED` from delivered JSON (`r41349542541-a1`, `2026-11-01T21:03:36Z`).
- Alpha.8 PROD history preserved. First alpha.1 baseline literal.

## Checks

- Targeted: map refresh empty-gate + module-loading family; profile/create trainer gate source assertions; release catalogue tests.
- Web typecheck + targeted vitest when deps present; sandbox without install reports honestly for PMA.
- No Astra on ordinary FAIL. No PROD / main merge by this writer.

## Explicit non-claims

- Not all of #445/#450 PASS / READY / ACCEPTED.
- Source candidate only; runtime DEV ACCEPTED and Owner UAT remain separate.
- Chat non-participant privacy boundary unchanged.
