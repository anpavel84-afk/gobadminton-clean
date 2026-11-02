# Handoff · #394/#372 private peer typed report + assigned Cases source read

Assignment: `OWNER394_372_PRIVATE_PEER_REVIEW_TYPED_REPORT_AND_ASSIGNED_CASE_READING_SAVED_PARTIAL_COMPLETION`
Base: `bc8910658c3c3ee39f4e33db40a77f60ae573968` (QA3 PASS AdminSafeReport/ListItem; runtime apps unchanged)
Attempt: **19** (continues same Issue #394/#372 / same PR471; not a rewrite) · Prospective app: `0.1.0-alpha.19` · API `0.27.0` · UAT `NOT_TESTED` · `sourceSha: null`
#394 / #372 remain **PARTIAL**. Product runtime / code / auth / UI / versions untouched this attempt. Public venue writer CLOSED. No PROD. app alpha.19 / API 0.27 unchanged (no bump).

## Contract drift fixed (attempt 19) — AdminCaseLink + HTTP contract guard

**Drift:** `ActualCasesService.detail()` already emits optional `targetKind` on report links via `ar.target_kind`. OpenAPI `AdminCaseLink` (`additionalProperties: false`) still allowed only `id` / `sourceKind` / `sourceId`, so `AdminCaseDetail` body was invalid for both old player-report and new `game_review` links.

**Fix (OpenAPI only):**
- Added precise **optional** `targetKind` enum `player` | `game_review` on `AdminCaseLink`
- Game links remain valid without `targetKind`
- No body/author ids / private-field expansion; no general read-right change
- `AdminSafeReport` `game_review` omit of `targetPublicPlayerId` unchanged (optional null in spec fine)
- Public `CreateAbuseReport` player-only unchanged
- API `0.27.0` / app `alpha.19` unchanged

**Test (same existing file):** Extended `admin-cases.disposable.test.ts` with a local tiny AJV2020 helper (`ajv` 8 + `ajv-formats`, `strict: false`, compile root with `components` + `$ref` against current `packages/contracts/openapi.json`). Validates actual HTTP:
- `GameReviewReportReceipt`
- `AdminReportList` (queue before/after case link)
- `AdminCaseDetail` after link + after assignment (expects report-link `targetKind: "game_review"`)
- `AdminCaseReviewReportSource` assigned private-source read

Existing negative auth/version/consent/step-up/reassignment/COI checks stay. Does **not** relax `additionalProperties` to true. No new deps / framework / test file. Private fixture TTL unset like DEV; capture 422 preserved; no unknown private body copies.

### Prior PASS unchanged (not re-run here)

- Privacy QA2 PASS (source) — preserved
- QA3 PASS AdminSafeReport / AdminReportListItem — preserved on base
- Product runtime / Cases.tsx / Admin browser / Owner UAT — **unchanged / NOT_TESTED** this attempt

### Checks this attempt

- Schema assert (`AdminCaseLink.targetKind` optional enum; API info still `0.27.0`): **PASS** (author static)
- Disposable Cases DB suite with new AJV guards: **NOT RUN in author slot** (no DB / no `node_modules` install allowed) — trusted PMA runs `admin-cases.disposable.test.ts` after clean commit
- Full `check-openapi.mjs` / Product CI / DEV: **not claimed**
- No dependency install / model call / new source audit / ROOT / runtime / PROD / Git

## Remaining

- Trusted process: clean commit/import → PMA runs existing Cases disposable suite → Product CI on new head → independent QA if required → merge `dev` → DEV ACCEPTED
- No runtime/PROD claims from this schema+test-guard pass
- Public venue publication / broader reviewSafety; Owner/Admin UAT still NOT_TESTED
- Candidate SHA / DEV receipt unbound until trusted ACCEPTED

## Paths touched (attempt 19 allowed)

- `packages/contracts/openapi.json`
- `apps/api/test/integration/admin-cases.disposable.test.ts`
- `docs/handoffs/reviews394-private-safety.md`
