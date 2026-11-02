# Handoff · #394/#372 private peer typed report + assigned Cases source read

Assignment: `OWNER394_372_PRIVATE_PEER_REVIEW_TYPED_REPORT_AND_ASSIGNED_CASE_READING_SAVED_PARTIAL_COMPLETION`
Base: `74843a5d9f07a3199a1373643d2a49c14e79f6f7`
Attempt: **15** (continues same Issue #394/#372; not a rewrite) · Prospective app: `0.1.0-alpha.19` · API `0.27.0` · UAT `NOT_TESTED` · `sourceSha: null`
#394 / #372 remain **PARTIAL**. Public venue writer CLOSED. No PROD. alpha.18 history / app alpha.19 / API 0.27 unchanged (no version bump).

## Prior attempt 14 (preserved)

- Guarded completed source already imported/committed on base
- Reported: API/web/Admin typechecks PASS; API unit PASS; 59 web tests PASS; real feedback DB 5/5 PASS; new constraint/migration PASS
- Only new Admin fixture FAIL: `admin-cases.disposable` capture_evidence expected 200, actual **422** `CASE_EVIDENCE_POLICY_DISABLED` (exact log supplied)
- Independent QA / CI / DEV ACCEPTED / Owner UAT: still pending

## Attempt 15 — targeted fixture / overlay / mirror-test finish

No new source architecture, version, API, backend privilege, or policy changes. No TTL enable. No dependency install / full test audit / network / root / Git / runtime / PROD / model calls by author.

1. **`admin-cases.disposable`**: synthetic TTL UNSET like actual DEV (unchanged). Assigned private source read already 200 / exact old revision PASS. Capture now correctly expects **422** `CASE_EVIDENCE_POLICY_DISABLED`; asserts **no** `case_evidence_items` row and **unchanged** case version. Removed only the impossible `evidenceId` read sequence. COI / reassignment / resolution negatives preserved. Legacy A3 enabled-TTL synthetic capture left untouched.
2. **`GameFeedbackPanel` report dialog**: add accepted family props `className="profile-dialog--postgame"` + `lockBodyScroll` (same as GameResultsComposition). No redesign / new dialog / CSS / global button / API. No new unit tests; browser PMA checks dialog at 390/1440.
3. **Removed** unpublished mirror `apps/admin/test/cases.test.tsx` (source-toContain only; does not prove Admin UAT). All existing HTTP authorization / revision E2E preserved. Admin browser UAT stays `NOT_TESTED`.
4. This handoff only — no claim of independent QA / CI / DEV yet.

## Paths touched (attempt 15 allowed)

- `apps/api/test/integration/admin-cases.disposable.test.ts`
- `apps/web/src/components/consumer/games/GameFeedbackPanel.tsx`
- `apps/admin/test/cases.test.tsx` (**deleted**)
- `docs/handoffs/reviews394-private-safety.md`

## Checks

### Prior (attempt 14 import; not re-run here)
- API/web/Admin typecheck PASS; API unit PASS; 59 web tests PASS
- Real feedback DB 5/5 PASS; constraint/migration PASS
- `admin-cases.disposable` FAIL at capture line → addressed in attempt 15 source only

### Attempt 15 author
- Fixture expectation + dialog props + mirror-test removal completed in workspace
- **Not run here** (Trusted PMA runs corrected disposable DB test after import): disposable Admin cases, Product CI, security, DEV smoke
- Independent QA / CI / DEV ACCEPTED / Owner UAT: **still pending** — do not claim READY/ACTIVE
- No live DB / auth / runtime / net / PROD / root / Git / models touched by author

## Remaining

- Trusted PMA: corrected `admin-cases.disposable` + any addressed gates after import
- Independent QA → CI → merge dev → DEV ACCEPTED
- Public venue publication / broader reviewSafety
- Auto hide/delete by report count; new staff roles/scheduler
- Owner/Admin UAT with real accounts (NOT_TESTED); browser visual check of report dialog overlay
- Candidate SHA / DEV receipt unbound until trusted ACCEPTED
