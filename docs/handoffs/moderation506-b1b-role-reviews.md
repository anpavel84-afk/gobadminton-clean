# Handoff — #506 MOD-V2-B1b · Role48 metadata + known-reject semantics (attempt 24)

## Assignment

- Issue: #506 continuation (`OWNER506_ROLE48_TRUE_METADATA_MIGRATION_FIX_KNOWN_DECISION_SEMANTICS`)
- Author: Cursor Auto (sole app source writer)
- Base (task): `40f2b3ecb0d15b345c9e34fcba2fa51ae57c5238` (root ZERO overlap of accepted `47cf0349ad` into role23 `0c851`)
- CURRENT actual DEV **47** `cf0349ad52d5caf10a8b40e209e8c837e9c4da43` / `r42403605993-a1` ACCEPTED `2026-11-07T19:05:58Z` remains parent/runtime fact (A + B1a + #406); **this roles candidate unpublished**
- Scope: bounded finalization24 only — migration.smoke 0063 applied-list/fixtures; known-moderation-reject helper rename/comments (no wire/payment hints); release metadata 48 + trusted 47 seed; coverage/handoff honesty; small helper regressions
- Not in this pass: live/DB/provider/network/git/deploy, APPLIED 0061/62 or business migration edits, new architecture/roles/venue/features/M1, fake DEV.48 receipt, forced QA PASS

## Independent QA findings reconciled (Sol Medium / role23 — two MEDIUM)

PMA code evidence (not a waiver):

1. **MEDIUM1/2** `evaluateLocalText` prose never returns `reject` (local-text-policy 185–203). All `runWithExternalPrepare` surfaces `comment_body` / `role_review_body` / `role_reply_body` are prose (`text-policy` 65–80). `assessReviewTexts` restricts `REVIEW_TEXT_SURFACES` (both prose). Unpaid local reject on these routes is **not currently reachable**. Global `approveTexts` identity/contact *can* local-reject, but those A callers do **not** use external-prepare.
2. Helper contract clarified (no Owner product-rule change): a KNOWN moderation REJECT (local **or** provider) is an immutable decision for one exact key; durable error receipt stores the real 422 and **never implies** external attempt/payment. Provider budget = `beforeAttempt` counters only; local-result = 0. Ordinary validation/auth/budget 4xx/429 retain unpaid cleanup. Unknown stays unknown/non-publishing/no TTL replay.
3. Rename only: `isPaid*` → `isKnownModerationReject` / `isAdminKnownModerationReject` (+ comments). **No** `paidAttempt` hints, origin columns, fake branches, or local-policy alteration to invent prose HTTP reject.

Independent final QA must verify this proof and may FAIL on a real counterexample; no forced PASS. Baseline 701 missing-durable-receipt regression remains honest (parent stopped before 2nd call).

## What changed (source)

- `migration.smoke.test.ts`: expected applied list ends with **0063**; asserts admin `reservation_state`/`response_state` allow `error`; rollback retains error allowlist. 0061/62 untouched; migrations SQL unmodified.
- `MutationRunner` / `AdminService`: known-reject naming + contract comments; behavior unchanged.
- Unit: mutation-runner known-422 replay + 429 unpaid cleanup; new `admin-external-prepare.test.ts` helper regressions.
- Web releases: **0.1.0-alpha.48** current (SHA/date NULL, UAT NOT_TESTED, API 0.37.0); historical **47** from trusted seed `cf0349ad` / `r42403605993-a1` / digests / `2026-11-07T19:05:58Z`. 46/45 unchanged.
- Coverage + this handoff: A+B1a ACTUAL 47 accepted; B1b SOURCE candidate (not DEV.48).

## Coverage honesty

| Scope | Status this pass |
| --- | --- |
| A | ACTUAL DEV.47 ACCEPTED proof — not re-claimed |
| B1a comments | Independently QA-PASS / DEV.47 ACCEPTED — not re-claimed |
| B1b role review/reply | **SOURCE_CANDIDATE** (role48 metadata + known-reject semantics) — not DEV, not READY/ACTIVE; QA23 two MEDIUM pending independent reconciliation |
| B1c / B2 / C / D / #507 | pending |

## Checks run by author

- Targeted API typecheck / mutation-runner + admin-external-prepare units / web releases tests / related lint where feasible.
- Full isolated disposable PostGIS migration.smoke + independent final QA → CI → DEV: **parent**.
- No `.evidence` scratch, no fake future PR/SHA/CI/GoBad/Owner UAT/device. UAT stays NOT_TESTED.

## Remaining / next (parent)

1. Parent reruns actual disposable PostGIS migration.smoke (0063 applied).
2. Independent final QA on known-reject semantics proof → Product CI → trusted merge/DEV after frozen47 boundary.
3. No fake DEV/UAT claims. B1c venue reviews next within #506 when admitted.
