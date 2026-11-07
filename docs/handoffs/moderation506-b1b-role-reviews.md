# Handoff — #506 MOD-V2-B1b · CI N-1 non-review compatibility repair (attempt 25)

## Assignment

- Issue: #506 continuation (`OWNER506_ALPHA48_CI_N_MINUS_ONE_NONREVIEW_COMPATIBILITY_REPAIR`)
- Author: Cursor Auto (sole app source writer)
- Base (task): `5af3a0425e9e3123d8ac76c9172ac4e029019ba4` (PR #512 head)
- CURRENT actual DEV **47** `cf0349ad52d5caf10a8b40e209e8c837e9c4da43` ACCEPTED remains parent/runtime fact; **48 NOT deployed**
- Prior independent QA **24 PASS** retained; Product CI `42409618201` 6/7 PASS, database FAIL (4 N-1 disposable suites)
- Scope: bounded CI repair25 only — ordinary A/comment binder + ordinary Admin receipt SELECT/INSERT compatibility with intentional N-1 schema cuts; small unit regressions; this handoff
- Not in this pass: edit of the 4 failing integration fixtures/migrations/business fixtures; live/DB/provider/network/git/deploy/release metadata/schema DDL; architecture; B1c/B2/C/D/#507; PROD; paid replay; history reset

## Failure cause (CI 42409618201)

Shared runtime named 0063-only columns on ordinary non-review paths while intentional N-1 fixtures omit them:

1. `content_moderation_bindings.role_reputation_decision_id` missing — 42 PG errors (generic A game/profile/comment text binds always named the nullable Role FK).
2. `admin_command_receipts.reservation_state` missing — 6 PG errors (ordinary Admin Venue/command receipt readers explicitly SELECTed the new state column).

N-1 schema cuts are intentional product contracts. Do not weaken/drop those suites or blindly apply latest 63 to fixtures.

## What changed (source)

- `moderation.service.ts`: generic A/comment and candidate binds INSERT only original binding columns (no `role_reputation_decision_id` name). Human role publication path alone names the FK. `bindReviewTexts` keeps STRICT required human reference for `publication` + typed surface/classification checks; candidate null human ref remains default-compatible under 63. No missing-column catch/fallback that would allow role publication without FK.
- `admin.service.ts`: ordinary `privilegedReplay` / `privilegedCommand` / `command` use `SELECT *` + `adminReceiptReservationState` (absent/null → historical `completed` only; present `processing`/`unknown`/`error` retain exact deny/replay). Ordinary completed INSERTs omit new 63 columns (DEFAULT `completed` on 63). `privilegedRunWithExternalPrepare` still requires 63 columns/nonce and cannot fall open.
- Units: binder SQL omit/name regressions in `text-moderation.test.ts`; receipt-state normalization in `admin-external-prepare.test.ts`.
- Prior QA24 PASS, FAIL/logs, A/B1a/role/classifier/named-release48 source metadata/known-reject local contract unchanged except this compatibility fix.

## Coverage honesty

| Scope | Status this pass |
| --- | --- |
| A | ACTUAL DEV.47 ACCEPTED proof — not re-claimed |
| B1a comments | Independently QA-PASS / DEV.47 ACCEPTED — not re-claimed |
| B1b role review/reply | SOURCE candidate on PR #512 (compat repair25) — not DEV.48, not READY/ACTIVE |
| B1c / B2 / C / D / #507 | pending; private egress OFF; no PROD |

## Checks run by author

- Targeted unit: text-moderation binding SQL + admin receipt reservation_state normalization (and retained known-reject helpers).
- API typecheck / related lint where feasible.
- Full isolated disposable PostGIS 4 N-1 suites + independent delta QA → CI7 → guarded DEV.48: **parent** after actual checks.
- No `.evidence` scratch, no fake future PR/SHA/CI/GoBad/Owner UAT. UAT stays NOT_TESTED.

## Remaining / next (parent)

1. Independent delta QA on this compatibility repair → Product CI (expect 7/7 including the 4 N-1 suites) → trusted merge/guarded DEV.48 after frozen47 boundary.
2. No fake DEV/UAT claims. B1c venue reviews next within #506 when admitted.
