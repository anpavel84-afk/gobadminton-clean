# Handoff — #506 MOD-V2-B1b · Admin replay / known paid rejection (attempt 23)

## Assignment

- Issue: #506 continuation (`OWNER506_EXACT_ADMIN_REPLAY_CURRENT_REVISION_KNOWN_REJECTION_RECEIPTS`)
- Author: Cursor Auto (sole app source writer)
- Base (task): `701257d26c4c74f44c778a0b2820e0b1d7ff8456` (Sol Medium FAIL: three HIGH — version-before-receipt, pending-after-assess, paid-422 claim release)
- CURRENT actual DEV `47cf0349ad` / `r42403605993-a1` ACCEPTED remains parent/runtime fact (A + B1a + #406); **this roles candidate unpublished**
- Scope: bounded repair23 only (admin authorizeReplayScope vs authorizeNewPublication, pending preflight, durable paid 422 receipts for Admin + MutationRunner)
- Not in this pass: venue B1c/C/D/#507, architecture rewrite, new service/scheduler, live/DB/provider/network/git/deploy/release metadata, APPLIED 0061/62 edits, fake DEV.48

## Independent QA findings fixed (Sol Medium / attempt 22)

1. **HIGH1** `admin/role-reputation.service.ts`: preflight checked `expectedCaseVersion` before completed receipt → authorized same-key replay after approve returned VERSION_CONFLICT (409) instead of original 200. Fixed via `AdminService.privilegedRunWithExternalPrepare` split: `authorizeReplayScope` (session/RBAC/assignment/independence) always; `authorizeNewPublication` (case version / current pending / consent / publication eligibility) **only on receipt miss**. Matching completed/error receipt replays original success/error without requiring original `expectedCaseVersion` still current.
2. **HIGH2** Approve pending currency ran only inside `executeDecideMutation` after paid assess. Mirrored current-pending eligibility in `authorizeNewPublication` for review and reply approve paths (restore keeps existing approved-tip rules). Obsolete pending → `REVISION_NOT_CURRENT` with **provider0**. Replays after own success do not re-require pending.
3. **HIGH3** Paid `PUBLIC_TEXT_CONTENT_REJECTED` 422 deleted processing claim → same immutable key paid again. Persist durable Admin `reservation_state='error'` sealed Problem (replay exact 422/fields, zero provider). Same hazard on consumer `MutationRunner.runWithExternalPrepare`: seal completed status 422; replay throws actual problem (not 200+Problem); authorizeReplay by request resource IDs only. Ordinary unpaid 4xx/429 still release. 503 unknown / wrong-nonce / no-TTL reclaim preserved. Minimal 0063 CHECK extension for `'error'`.

## What changed (source)

- Migration **0063** additive: `admin_command_receipts.reservation_state` allows `error`; response-state CHK requires ciphertext for completed|error. 0061/0062 untouched.
- `AdminService.privilegedRunWithExternalPrepare` + all receipt readers honor `error` (throw sealed 422; never typed success).
- `AdminRoleReputationService.decide` approve/restore: split replay vs new-publication authorize; pending fence before provider.
- `MutationRunner`: paid classification reject → durable completed 422; no reclaim of status≥400; unit regressions updated.
- Integration: obsolete pending provider0; admin paid-reject error receipt + replay; consumer role + comment same-key 422 replay provider0.
- Web/Admin UI and APPLIED migrations unchanged.

## Coverage honesty

| Scope | Status this pass |
| --- | --- |
| A | parent/runtime DEV.47 ACCEPTED — not re-claimed |
| B1a comments | Independently QA-PASS / DEV.47 ACCEPTED — not re-claimed; only MutationRunner paid-reject fence + comment regression |
| B1b role review/reply | **SOURCE_CANDIDATE repair23** — not DEV, not READY/ACTIVE |
| B1c / B2 / C / D / #507 | pending |

## Checks run by author

- Targeted API typecheck / mutation-runner unit / web role-reputation / related lint where feasible.
- Full isolated DB integration of `public-role-review-moderation` (+ comment paid-reject regression): **parent**.
- No `.evidence` scratch, no retro DEV/48 acceptance claim. UAT stays NOT_TESTED.

## Remaining / next (parent)

1. Isolated DB run of new fence cases + existing public-role / disposable / comment suites (parent).
2. Independent Codex Sol Medium delta QA → Product CI → trusted merge/DEV after frozen47 boundary.
3. No fake DEV/UAT claims. B1c venue reviews next within #506 when admitted.
