# Handoff · #394/#372 private peer typed report + assigned Cases source read

Assignment: `OWNER394_372_PRIVATE_PEER_REVIEW_TYPED_REPORT_AND_ASSIGNED_CASE_READING_SAVED_PARTIAL_COMPLETION`
Base: `59cf40925629860a95a2cfa9907cf08e81cfcb73`
Attempt: **16** (continues same Issue #394/#372; not a rewrite) · Prospective app: `0.1.0-alpha.19` · API `0.27.0` · UAT `NOT_TESTED` · `sourceSha: null`
#394 / #372 remain **PARTIAL** after Independent QA FAIL (P2 race only). Public venue writer CLOSED. No PROD. app alpha.19 / API 0.27 unchanged (no version bump).

## Independent QA (pass1) — FAIL preserved

- Reviewed SHA `59cf40925629860a95a2cfa9907cf08e81cfcb73`
- **P2 only**: `Cases.tsx` `readReviewReport` committed `reviewSource` after await without re-checking current fresh/selected case; step-up expiry mid-request cleared text via effect, then late success reintroduced private body under `fresh=false`
- Server guards / schema / consent binding / tests: reviewed and accepted unchanged
- API/web/Admin type + feedback DB / migration / current Case HTTP: PASS (not re-run this attempt)
- Admin browser UAT / Owner UAT: **NOT_TESTED**

## Attempt 16 — address exact IndependentQA1 P2 race only

No Astra / new architecture / permissions / version / contract / backend / dependency / PROD / Git changes. Backend guards and UI pending-idempotency mechanism unchanged.

1. **`Cases.tsx`**: local `reviewReadGen` + `reviewScope` refs; bump/invalidate pending source reads on `fresh=false`, case id/version/assignment change, and unmount; commit `setReviewSource` only when gen+fresh+case/version/assignment still match; late errors ignore superseded scope (do not clear unrelated new case); render private source only when `fresh` and `detail.id===reviewSource.caseId`.
2. **`apps/admin/test/cases.test.tsx`**: one meaningful async-component regression (React/Vitest harness pattern from `attendance-disputes` / venue edit): hold `adminRequest` review-report promise, expire fresh / change case, resolve old success, assert private comment not visible. Not a source-toContain mirror. Existing real HTTP auth Cases tests untouched.
3. This handoff only claims the P2 race fix candidate — not independent QA re-PASS, CI, DEV ACCEPTED, or READY/ACTIVE.

## Paths touched (attempt 16 allowed)

- `apps/admin/src/components/Cases.tsx`
- `apps/admin/test/cases.test.tsx`
- `docs/handoffs/reviews394-private-safety.md`

## Checks

### Prior (accepted unchanged; not re-run here)
- Server guards / schema / consent binding
- API/web/Admin typechecks; feedback DB; migration; Case HTTP auth paths

### Attempt 16 author
- Race fix + targeted Cases async regression written in workspace
- Admin `typecheck` / `vitest` cases.test: **not run here** — no `node_modules` in this worktree; dependency install forbidden by assignment. Trusted PMA verifies Admin typecheck + targeted test after import.
- Independent QA re-review / Product CI / security / DEV smoke / DEV ACCEPTED: **still pending**
- Admin live browser UAT: **NOT_TESTED**
- No live DB / auth / runtime / net / PROD / root / Git / models touched by author

## Remaining

- Trusted PMA: Admin typecheck + `cases.test.tsx` after import
- Independent QA on race fix → CI → merge dev → DEV ACCEPTED
- Public venue publication / broader reviewSafety
- Auto hide/delete by report count; new staff roles/scheduler
- Owner/Admin UAT with real accounts (NOT_TESTED)
- Candidate SHA / DEV receipt unbound until trusted ACCEPTED
