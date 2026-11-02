# Handoff · #394/#372 private peer typed report + assigned Cases source read

Assignment: `OWNER394_372_PRIVATE_PEER_REVIEW_TYPED_REPORT_AND_ASSIGNED_CASE_READING_SAVED_PARTIAL_COMPLETION`
Base: `6422bcd1f0da016fb035cb6b2264b54d25b87502` (existing PR471 head)
Attempt: **18** (continues same Issue #394/#372; not a rewrite) · Prospective app: `0.1.0-alpha.19` · API `0.27.0` · UAT `NOT_TESTED` · `sourceSha: null`
#394 / #372 remain **PARTIAL**. Product runtime / code / UI untouched this attempt. Public venue writer CLOSED. No PROD. app alpha.19 / API 0.27 unchanged (no second bump).

## Contract drift fixed (attempt 18) — ADMIN READ schemas only

**Drift:** Published API 0.27 schemas `AdminReportListItem` and `AdminSafeReport` still had `targetKind` `const: "player"` and non-nullable `targetPublicPlayerId` UUID. Actual `AdminCasesService.report()` minimal DTO returns `targetKind: "game_review"` and omits `targetPublicPlayerId` for received peer-review reports (queue + `report_summary` capture via `AdminSafeReport`). Player summaries unchanged in runtime.

**Fix:** Extended only those two ADMIN READ schemas with a precise `oneOf` discriminated variant:
- `player` — `targetPublicPlayerId` required UUID (existing summaries preserved)
- `game_review` — `targetPublicPlayerId` optional `null` only when present (matches omit-or-null typed metadata; no private text/detail/author ids/review body)

`CreateAbuseReport` / public `/reports` left player-only. New `/reviews/:id/report` remains the only private-review path. No feature code, permissions, versions, or UI changes.

### Prior PASS unchanged (not re-run)

- Privacy QA2 PASS (source) — preserved
- All actual HTTP checks PASS — preserved
- Product runtime / Cases.tsx race guards / Admin browser / Owner UAT — **unchanged / NOT_TESTED** this attempt

### Checks this attempt

- Narrow schema assert (oneOf kinds + CreateAbuseReport player-only): **PASS**
- `packages/contracts/scripts/check-admin-protocol.mjs`: **PASS** (42 ops)
- Full `check-openapi.mjs` / SwaggerParser: **unavailable** (no `node_modules` / no install allowed) — trusted CI must re-run on **new head** after import
- No new test matrix / deps / network / install / Git / root / runtime / models

## Remaining

- Trusted process: commit/import → Product CI on new head (incl. contracts check) → independent QA if required → merge `dev` → DEV ACCEPTED
- No runtime/PROD claims from this schema-only pass
- Public venue publication / broader reviewSafety; Owner/Admin UAT still NOT_TESTED
- Candidate SHA / DEV receipt unbound until trusted ACCEPTED

## Paths touched (attempt 18 allowed)

- `packages/contracts/openapi.json`
- `docs/handoffs/reviews394-private-safety.md`
