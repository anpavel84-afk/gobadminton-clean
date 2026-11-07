# Handoff · Issue #506 · MOD-V2-A public text (author pass 4 · test-fixture only)

Source-only test correction after independent FAIL on disposable PG suites
(pass-3 QA logs). Production patch from pass 3 unchanged. No DONE / QA / CI /
DEV / UAT claims.

## Pass-4 concrete repairs (exactly two fixture corrections)

1. `public-text-moderation.test.ts` — foreign-publish case: draft create already
   approved the exact host fields, so owner publish must **reuse** the decision
   cache (`afterOwnerPublishCalls === beforeCalls`). Replaced obsolete
   `toBeGreaterThan(beforeCalls)` with strict cache equality plus publication
   binding assertions that link exact `game` / current published
   `resource_version` / `PUBLIC_TEXT_POLICY_VERSION` / `allow` for the four host
   surfaces. Foreign private/unlisted 404 / version / no-egress assertions kept.

2. `radar.unified.test.ts` — start/takeover text-provider gate: freeze the
   original `startBody()` payload once and reuse that exact object for genuine
   same-key start replay (and takeover payload derived from it). Calling
   `startBody()` again minted a new `capturedAt`, changed `requestHash`, and
   correctly returned 409 — not an idempotency production bug. Status assertions
   include response body diagnostics. Strict 201/wire metadata / 0 new text calls
   / revoked+ineligible 0-provider / allowed activation preserved; suite still
   69 cases.

## Author sandbox status

- Edits limited to allowed paths only (two integration tests + this handoff).
- Full disposable DB integration / Product CI / DEV45 not run in this sandbox
  (parent owns pinned disposable DB + gates). Sandbox gate test remains for
  `RUN_DB_INTEGRATION≠1`.
- No production / architecture / metadata / skip / relax / full-matrix rewrite.
- Separate 507 Astra High design artifacts out of scope.

## Parent next

- Parent re-runs only these two PG suites
- Independent delta QA
- Then full Product CI / real DEV45 (live DEV still 44)

## Still not claimed

- Overall PASS/DONE from source author
- QA / CI / DEV ACCEPTED
- Mode B binding / AGY author / PROD
