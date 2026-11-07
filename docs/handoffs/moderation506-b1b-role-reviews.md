# Handoff — #506 MOD-V2-B1b · role review/reply human-case gate (attempt 22)

## Assignment

- Issue: #506 continuation (`OWNER506_ROLE_REVIEW_QA_ADMIN_PREPARE_FENCES_AND_TYPE_FIX`)
- Author: Cursor Auto (sole app source writer)
- Base (task): `33baf0d3839c73750bec6195343b173abcc2dc4e` (Sol Medium FAIL: TS2322 narrowing + admin assess-before-version/receipt)
- CURRENT actual DEV.46 SHA `264d9e1c` ACCEPTED remains parent/runtime fact — this staged WT does not claim DEV.47/48 or release metadata
- Comment release merged `cf0349ad` and deploying in existing guarded workflow is parent fact; actual still 46 until receipt
- Scope: bounded B1b repair only (type narrowing + admin approve/restore preflight fences + web partial mock)
- Not in this pass: venue B1c/B2/C/D/#507, PROD, deploy, release metadata, architecture rewrite, fake CI/DEV.48

## Independent QA findings fixed (Sol Medium / attempt 21)

1. **BLOCKING TS2322** `admin/role-reputation.service.ts`: closure lost narrowing of `input.decision` into `assertCurrentPublishGates`. Fixed with explicit `const publishDecision: "approve" | "restore"` (no `any` / unsafe cast).
2. **HIGH** Admin approve/restore called assess before `expectedCaseVersion` and before existing command receipt — stale/duplicate same-key could pay. Fixed via bounded `AdminService.privilegedRunWithExternalPrepare`: authorize + case/revision/consent/independence + same-key claim **before** provider; completed receipt replay / fingerprint mismatch / processing CIP / unknown seal with **zero** paid I/O; concurrent same-key ≤1 paid attempt without DB/advisory locks across network.
3. **PARENT web 2/6**: `vi.mock('../src/lib/api-client')` omitted `publicTextModerationNotice` required by `games-api` helper. Fixed with partial mock keeping the real export; 422 `fields.text` / 503 notice tests retained.

## What changed (source)

- Migration **0063** additive: `admin_command_receipts.reservation_state|claim_nonce|expires_at`; `response_ciphertext` nullable only for processing/unknown; completed rows keep ciphertext. 0061/0062 untouched. Rollback retains history/columns.
- `AdminService.privilegedRunWithExternalPrepare` + replay/command readers honor processing/unknown (no TTL reclaim / paid replay). Nonces / exact claim owner / unknown no-TTL semantics aligned with QA-accepted consumer `MutationRunner`. Admin session/step-up/origin/CSRF/RBAC/assigned-case scope unchanged — not replaced by consumer ActorFence.
- `AdminRoleReputationService.decide`: reject/remove/retain/request_correction stay provider-independent via `privilegedCommand`; approve/restore use external prepare + narrowed publish decision.
- Web role-reputation test: partial `api-client` mock.
- Integration tests added: stale `expectedCaseVersion` → 0 provider; authorized receipt replay → 0 provider; concurrent same-key legacy pending delayed → one attempt + TTL non-reclaim; unknown seal survives TTL + wrong `claim_nonce` cannot complete.

## Coverage honesty

| Scope | Status this pass |
| --- | --- |
| A | parent/runtime — not re-claimed |
| B1a comments | Independently QA-PASS candidate47 / PR #511 — **not yet DEV.47** |
| B1b role review/reply | **SOURCE_CANDIDATE repair22** — not DEV, not READY/ACTIVE |
| B1c / B2 / C / D / #507 | pending |

## Checks run by author

- Targeted API typecheck on touched admin/role paths; web role-reputation tests; related unit/lint where feasible.
- Full isolated DB integration of `public-role-review-moderation.test.ts` (+ related disposable suites): **parent**.
- No `.evidence` scratch in repo. Existing Astra reconciliation reused (complete).

## Remaining / next (parent)

1. Isolated DB run of new fence cases + existing public-role / disposable role-reputation suites.
2. Independent Codex Sol Medium QA → Product CI → trusted merge/DEV after frozen47 boundary.
3. No fake DEV/UAT claims. UAT stays NOT_TESTED until Owner tests after DEV ACCEPTED.
4. B1c venue reviews next within #506 when admitted.
