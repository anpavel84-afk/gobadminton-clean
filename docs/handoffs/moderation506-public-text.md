# Handoff · Issue #506 · MOD-V2-A public text (author pass 5 · location eligibility)

Bounded repair for independent delta QA HIGH on frozen HEAD
`90ce3fcebbc69044d19d011400ab7074e695ef8c`. Prior game-authority and
actor/session/caps/replay preflight repairs remain accepted. No DONE / QA /
CI / DEV / UAT claims from this source pass.

## Delta QA finding (actual FAIL)

`preflightEligibleBeforeTextProvider` only required location non-null. A
validly shaped unsupported-region or stale fix reached external text
moderation; later `fix()` rejected it and the mutation rolled back without
binding, so retries could burn further provider I/O for an unactivatable
request.

## Pass-5 concrete repair

1. `unified-publishing.service.ts` — before any text-provider I/O on
   start/takeover, preflight now runs pure location eligibility that mirrors
   source `fix()` / `quantizeFix` / `quantizeUnified` gates:
   - time bounds (`RADAR_FIX_MAX_AGE_SECONDS`, future tolerance, and the
     `capturedAt + 60s` stale check)
   - live/synthetic region allowlist via existing `resolveRadarRegion`
     (Moscow only live; Moscow+SPB synthetic)
   - no `consumeGeo`, no PostGIS/network under the preflight transaction
   - final mutation still revalidates via `fix()`; consent/activation/
     resource/freshness fences unchanged; preflight is not a substitute

2. `radar.unified.test.ts` — meaningful cases: valid-shape unsupported region
   and stale fixes never increment `textCalls`, create no presence, and do
   not mutate an existing activation on both start and takeover; allowed
   activation + exact-hash replay still works.

## Author sandbox status

- Edits limited to allowed paths only (service + radar unified test + this
  handoff).
- No actual provider transport, live DB, credentials, Git, runtime, or root
  used here.
- Full disposable PostgreSQL suites / Product CI / DEV45 not run in this
  sandbox (parent owns pinned disposable DB + gates).
- No broader refactor, deps, #507 writer, or release changes.
- Attempts / FAIL history preserved; no PASS/DONE claim.

## Parent next (exact)

```bash
# From CLEAN repo at this source SHA (after trusted integrate of pass-5 paths):
cd apps/api
RUN_DB_INTEGRATION=1 pnpm exec vitest run test/integration/radar.unified.test.ts
# Own PG / Radar / types / lint as previously for #506 A
# Then independent delta QA on location-eligibility preflight
# Then Product CI + DEV45 (NOT_TESTED UAT)
```

Focus checks for delta QA:

- Unsupported-region and stale start/takeover reject with
  `RADAR_REGION_UNSUPPORTED` / `LOCATION_TOO_OLD` before any text provider call
- No presence/mutation/binding on those denies; allowed activation/replay intact
- Preflight still does not consume geo budget or run PostGIS; final `fix()`
  race fences remain

## Still not claimed

- Overall PASS/DONE from source author
- Independent QA / Product CI / DEV ACCEPTED
- Mode B binding / AGY author / PROD
