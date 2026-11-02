# Handoff · #394/#372 private peer typed report + assigned Cases source read

Assignment: `OWNER394_372_PRIVATE_PEER_REVIEW_TYPED_REPORT_AND_ASSIGNED_CASE_READING_SAVED_PARTIAL_COMPLETION`
Base: `7c59df3182d3a57f2f8c32b60667e0e2b5a784fe`
Attempt: **17** (continues same Issue #394/#372; not a rewrite) · Prospective app: `0.1.0-alpha.19` · API `0.27.0` · UAT `NOT_TESTED` · `sourceSha: null`
#394 / #372 remain **PARTIAL**. Product source untouched this attempt. Public venue writer CLOSED. No PROD. app alpha.19 / API 0.27 unchanged (no version bump).

## Independent QA (pass1) — FAIL preserved

- Reviewed SHA `59cf40925629860a95a2cfa9907cf08e81cfcb73`
- **P2 only**: `Cases.tsx` `readReviewReport` committed `reviewSource` after await without re-checking current fresh/selected case; step-up expiry mid-request cleared text via effect, then late success reintroduced private body under `fresh=false`
- Server guards / schema / consent binding / tests: reviewed and accepted unchanged
- API/web/Admin type + feedback DB / migration / current Case HTTP: PASS (not re-run this attempt)
- Admin browser UAT / Owner UAT: **NOT_TESTED**

## Attempt 16 — P2 race fix (product source; already on base)

- `Cases.tsx` epoch+fresh guards landed on base `7c59df3…`; **unchanged this attempt**
- Async Cases regression fixture added; Admin typecheck PASS on prior path; vitest candidate failed before race body (fixture path bug)

## Attempt 17 — fixture-only: relative path equality + positive control

No product source / permissions / version / API / root / Git / runtime / PROD / model calls / install / network / full matrix.

### Original FAIL (attached `admin-race.log`, sha256 `5814fce7700d24467c6fcd717ac87104580731ebf74985fd4a2fc774e49f2fba`)

```
FAIL  test/cases.test.tsx > Admin Cases private review-source read race >
  does not render private review body from a late success after fresh expiry or case change
AssertionError: expected false to be true // Object.is equality
 ❯ test/cases.test.tsx:209:105
    expect(transport.calls.some((c) => c.path.includes(`/cases/${CASE_…`))).toBe(true)
```

Root cause: actual `adminRequest` contract is relative `cases/${caseId}/review-reports/${reportId}` (**no** leading `/`). Fixture used `.includes(\`/cases/...\`)` at the call assert and the second deferred handler matched the same wrong leading-slash prefix, so a valid request was not recognized **before** race assertions ran.

### Fixture correction (`apps/admin/test/cases.test.tsx` only)

1. Both call assert and deferred handlers use **exact** equality on `cases/${CASE_A}/review-reports/${REPORT_A}` (not leading-slash `.includes`, not any-request).
2. Preserve deferred promise / hook harness; not a source-toContain mirror.
3. Small positive control: with `fresh=true` + current case, a completed read **does** show `PRIVATE_COMMENT`; then held late success after `fresh=false` and after case change does **not**; restoring `fresh` (and prior case) does **not** resurrect the old response — proves guards are not merely hiding all views.
4. Prod `Cases.tsx` epoch+fresh guards left unchanged.

### Checks

- Command attempted: `PATH=/opt/gb-slots/runtime/node/bin:$PATH pnpm --filter @gobadminton/admin exec vitest run test/cases.test.tsx`
- Result in this worktree: **vitest not found** (`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` / no `node_modules`); install/network forbidden by assignment — **not claimed PASS here**
- Trusted PMA rechecks Admin type + this targeted vitest after import
- Independent QA / Product CI / DEV smoke / DEV ACCEPTED: still pending
- Admin live browser UAT: **NOT_TESTED**

## Paths touched (attempt 17 allowed)

- `apps/admin/test/cases.test.tsx`
- `docs/handoffs/reviews394-private-safety.md`

## Remaining

- Trusted PMA: Admin typecheck + `cases.test.tsx` after import (deps present)
- Independent QA on race fix → CI → merge dev → DEV ACCEPTED
- Public venue publication / broader reviewSafety
- Auto hide/delete by report count; new staff roles/scheduler
- Owner/Admin UAT with real accounts (NOT_TESTED)
- Candidate SHA / DEV receipt unbound until trusted ACCEPTED
