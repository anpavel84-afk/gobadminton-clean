# Handoff · #394/#372 private peer typed report + assigned Cases source read

Assignment: `OWNER394_372_PRIVATE_PEER_REVIEW_TYPED_REPORT_AND_ASSIGNED_CASE_READING_SAVED_PARTIAL_COMPLETION`
Base: `6cd66a77068d6ab2faa283867d6320896b0c5177`
Attempt: **14** (continues same Issue #394/#372; not a rewrite) · Prospective app: `0.1.0-alpha.19` · API `0.27.0` · UAT `NOT_TESTED` · `sourceSha: null`
#394 / #372 remain **PARTIAL**. Public venue writer CLOSED. No PROD.

## Prior attempt 13 (preserved, not replayed)

- Hit 1200s timeout; no native finish; original HOLD / cost UNKNOWN / raw preserved
- All original processes dead; writer lease free; no Git push / DEV effects
- Trusted PMA saved exact source patch only after permission/config/material/secret/scope checks (`partial-source.patch` sha256 `8f103e0be37f09cdd18860064833f3afeefd4fb30f4a9912aedb7dcdc22b65bf`)
- Diagnostic partial proofs (not native finish / QA / CI / DEV): API/web/Admin type PASS; API unit PASS; 59 web tests PASS; disposable Admin case E2E PASS; legacy A3 PASS; outcome PASS; migration PASS; one feedback negative wrong 401 vs actual 403

## Attempt 14 source completion

Applied preserved patch once, then addressed remaining repairs only:

1. Migration `0053`: removed fake `CHECK(TRUE)`; additive `UNIQUE(id,review_id,game_id,resource_version)` on `game_review_revisions` + composite FK from bindings; `support_immutable` trigger on bindings; rollback drops new empty table/constraint/trigger only when safe, refuses typed history
2. Guestish no-cookie/no-CSRF report expects precise existing denial **403** (production auth unchanged)
3. `admin-cases.disposable` primary typed source-read E2E: `CASE_EVIDENCE_SYNTHETIC_TTL_SECONDS` **unset** like DEV; A3 synthetic-evidence tests retain their own TTL policy
4. Minimal DB negatives: mismatched revision tuple → `23503`; binding UPDATE/DELETE → `42501`

### Schema
- `apps/api/migrations/0053_private_review_reports.sql` (+ rollback)
- Extends `abuse_reports.target_kind` with `game_review`; nullable `target_public_player_id` for that kind
- `game_review_report_bindings` → exact `game_review_revisions` tuple + `share_consent=true`
- Rollback refuses when typed report history exists (no history deletion)

### API
- `POST /reviews/:reviewId/report` — GameFeedbackController/Service + MutationRunner
- Cookie+CSRF+Origin+Idempotency; body `expectedVersion`, reason/detail, `shareReviewWithSupport:true`, `gameId`
- Recipient of private **peer** only; no new attendance gate; derives identities server-side
- Same actor/review/version does not create more reports; receipt `{reportId,status,reviewId,version}`
- Additive `allowedActions.canReport`
- `GET /admin/cases/:id/review-reports/:reportId` — assigned + `evidence.assigned.read` + step-up
- COI reuse attendance-dispute rules; case.manage / unassigned insufficient
- `report_summary` for `game_review` stays minimal (no private text into `case_evidence_items`)
- SyntheticCaseEvidencePolicy untouched; private source endpoint independent of synthetic TTL

### Web / Admin
- Received peer: «Пожаловаться на отзыв» + unchecked consent dialog; pending-key preserved
- Admin Cases: typed queue hint, linked source button, sensitive payload cleared on case/poll/reassign/401–404/step-up

### Releases / contracts
- App `0.1.0-alpha.19`, API `0.27.0` (from patch; **no second version bump**)
- alpha.18 seeded into `TRUSTED_HISTORICAL_SEED` from provided JSON (notes preserved verbatim)
- OpenAPI paths/schemas for report + admin source read; Admin protocol inventory 41→42

## Paths touched (allowed)

See Owner `allowed_paths` for this attempt (API feedback/cases/migration, web feedback/mutation/releases, admin Cases, contracts, docs). Attempt-14 deltas after patch import: migration 0053 + rollback, `game-feedback.disposable`, `admin-cases.disposable`, `migration.smoke`, this handoff.

## Checks

### Prior diagnostic partials (attempt 13; not re-run here)
- API/web/Admin typecheck PASS; API unit `game-feedback` PASS; addressed web tests PASS
- Disposable Admin cases / A3 / outcomes / migration PASS under isolated DB
- `game-feedback.disposable` FAIL: guestish expected 401, actual 403

### Attempt 14 author
- Source repairs completed in workspace after single patch import
- **Not run here** (per assignment: Trusted PMA runs addressed tests + real DB after completed import): disposable DB suites, typecheck, unit, Product CI, security, DEV smoke
- Independent QA / CI / DEV ACCEPTED / Owner UAT: **still pending** — do not claim READY/ACTIVE
- No live DB / auth / runtime / net / PROD / root / Git / models touched by author

## Remaining

- Trusted PMA: addressed tests + real disposable DB proof of repairs
- Independent QA → CI → merge dev → DEV ACCEPTED
- Public venue publication / broader reviewSafety
- Auto hide/delete by report count; new staff roles/scheduler
- Owner/Admin UAT with real accounts (NOT_TESTED)
- Candidate SHA / DEV receipt unbound until trusted ACCEPTED
