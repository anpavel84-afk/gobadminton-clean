# Handoff — #506 MOD-V2-B1b · role review/reply human-case gate (attempt 21)

## Assignment

- Issue: #506 continuation (`OWNER506_MOD_V2_B1B_ROLE_REVIEW_AND_REPLY_EXACT_HUMAN_CASE_GATE`)
- Author: Cursor Auto (sole app source writer)
- Base (task): `a579213898a3f78b4f0bf35660dd3ad03b8bfc50` (independently QA-PASS B1a candidate47 / PR #511 / Product CI `42402270957`, not yet DEV.47)
- CURRENT actual DEV.46 SHA `264d9e1c` ACCEPTED with A+#406 illustrations remains parent/runtime fact — this staged WT does not claim DEV.47 or release metadata
- Scope: coherent public organizer/trainer review text + reply moderation only (existing RoleReputation public submission + Admin exact approve/restore paths)
- Not in this pass: venue reviews (B1c), venueAdmin/import (B2), private C, avatars/Admin metadata D, #507 I1 open, PROD, deploy, release metadata, architecture rewrite

## What changed (source)

- Migration **0063** (additive): `role_review_body` / `role_reply_body` surfaces; `role_review_revision` / `role_reply_revision` entity kinds; nullable `content_moderation_bindings.role_reputation_decision_id` FK to exact human `role_reputation_decisions` (publication only). 0061/0062 untouched. Rollback retains history/expanded CHECKs.
- `assessReviewTexts` + `bindReviewTexts`: hard-safety categories → 422; soft/ambiguous → persisted `decision=review` (never forged allow); clean classifier ALLOW still creates **real human pending intake** + candidate binding (no auto-publish).
- Consumer `RoleReputationService` create/resubmit/reply submit use `runWithExternalPrepare` (authorize → provider outside locks → final version/consent/fences + candidate bind). Withdraw/appeal/reject paths stay provider-independent; prior approved tip retained on 422/503.
- Admin approve/restore: authorize + consent/independence preflight; assess exact consented public text outside privileged TX when needed; inside TX revalidate and bind publication with human decision FK. Read/reject/withdraw: no provider. Provider `review` stays `review` on human allow.
- Ordinary A/B1a `approveTexts` rejecting semantics unchanged. Image M1 alias/cache untouched. Broad venue comments remain runtime-closed pending #507 (not permanent policy). Role-only paths do not open venue/player comments.
- UI: RoleReviewComposer + Admin RoleReputationCases surface moderation errors without logging private content. OpenAPI create/command/reply descriptions updated for B1b errors.
- Tests: `public-role-review-moderation.test.ts` (parent own DB); targeted unit/migration/web/admin extensions. No `.evidence` scratch in repo.

## Coverage honesty

| Scope | Status this pass |
| --- | --- |
| A | SOURCE/PASS CI pending (parent DEV ACCEPTED separately) — not re-claimed here |
| B1a comments | Independently QA-PASS candidate47 / PR #511 / CI `42402270957` per Owner task; **not yet DEV.47** |
| B1b role review/reply | **SOURCE_CANDIDATE** — not DEV, not READY/ACTIVE |
| B1c venue reviews / B2 / C / D / #507 | pending |

## Checks run by author

- Targeted unit text-policy B1b surfaces; TypeScript/lint on touched paths where feasible in this environment.
- Full isolated DB integration + independent Codex QA + Product CI + DEV release: **parent**.

## Remaining / next (parent)

1. Isolated DB run of `public-role-review-moderation.test.ts` + related disposable role-reputation suites.
2. Independent Codex Sol Medium QA → Product CI → trusted merge/DEV after frozen47 boundary + accepted47 integration.
3. No fake DEV/UAT claims. UAT stays NOT_TESTED until Owner tests after DEV ACCEPTED.
4. B1c venue reviews next within #506 when admitted.
