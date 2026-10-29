# Issue #375 / PG-1a GameOutcome API — Mode B author handoff

From: Cursor Auto (`OD018_PG1A_OUTCOME_API_DEV`, revision `f05846318753600e7c9f78db9ae1465816aa11b369ab7c35b190b3edb644f5f4`).
To: one independent Codex Medium QA → mandatory Product CI → trusted DEV release/smoke.
Status: SOURCE CANDIDATE / QA repair (provenance + bounded revisions) / author checks local where possible / **UAT=NOT_TESTED** / writes default **OFF**.
Parent #372 remains open for attendance/notices/disputes/reviews/UI. Entire Postgame NOT claimed complete.

Continuation: prior author1 recovered bundle reused (NOT_QA_ACCEPTED / shell-only OpenAPI was absent). Compatibility pass against current accepted `dev` (0041 recommendations + social/capability modules preserved). Immutable prior author1 stays in continuation_history/expenses; this is not a replay of the old operation.

QA repair (exact findings): `provenance.recordedAt` projects current revision time (`updated_at`) with separate immutable `createdAt`; manager revision history is a newest bounded window (`revisionsLimit` default 20 / max 50) with `revisionsNextCursor` for older continuation.

## Claim freeze

- Next free migration on accepted checkout: **0042** (0040 URL storage, 0041 recommendations present). No path collision; do not invent a parallel migration.
- Spec sources: approved #73 package docs (`POST_GAME_*` / Owner model) as design-inputs; architecture commit `193276ee…` for semantics. Old admissions not rewritten.
- Recovered `env.ts` / `games.module.ts` were **not** copied wholesale: only `POST_GAME_INTERNAL_ENABLED` + GameOutcomes controller/service registration merged into current module/config.

## Product slice delivered

- `GET /v1/games/{gameId}/results` — unknown/version 0 when absent; manager revision history; participant own-game outcome only; guest/outsider/revoked-without-seat → private 404; `Cache-Control: no-store`. Reads survive write flag OFF.
- `PUT /v1/games/{gameId}/outcome` — current GameManager; `held`/`not_held` after `endsAt`; `expectedVersion` (0 absent) + Idempotency-Key + cookie/Origin/CSRF; reason required for `not_held`/correction; plain text ≤500.
- Additive `game_outcomes` + append-only `game_outcome_revisions`; atomic save; Actor → Game → manager → outcome/revision; authorize replay on current rights with private 404 (no revoked-manager disclosure on this surface).
- `published` → existing `completed` only on explicit command; completed correction does not reopen; cancelled stays cancelled; `held` on cancelled rejected; draft/pre-end rejected; seats/participations untouched.
- `POST_GAME_INTERNAL_ENABLED` default `0`; fail-closed outside local test or exact DEV mvp/stage origins; PROD config rejected. No attendance/no-show/UI/reviews/notifications.

## Changed files (allowed_paths only)

1. `apps/api/migrations/0042_game_outcomes.sql`
2. `apps/api/migrations/rollback/0042_game_outcomes.sql`
3. `apps/api/src/games/game-outcomes.policy.ts`
4. `apps/api/src/games/game-outcomes.service.ts`
5. `apps/api/src/games/game-outcomes.controller.ts`
6. `apps/api/src/games/games.module.ts` (additive registration only)
7. `apps/api/src/config/env.ts` (additive `POST_GAME_INTERNAL_ENABLED` only)
8. `apps/api/test/unit/game-outcomes.test.ts`
9. `apps/api/test/integration/game-outcomes.disposable.test.ts` (auto-picked by existing `db-ci.sh`; dedicated DB `gobadminton_outcomes_disposable` or hosted Actions allowlist)
10. `packages/contracts/openapi.json` (v0.20.0 PostGame paths/schemas; completed via existing contract tooling, not recovered shell-only mutation)
11. `docs/handoffs/postgame-pg1a-outcome-api.md`

## Checks

- Author: `@gobadminton/contracts check`; `game-outcomes` unit; API typecheck/eslint on touched paths (see run log).
- Disposable PostGIS suite intended for existing `db-ci.sh` auto-pickup; local Docker may be unavailable in author sandbox.
- Independent Codex Medium QA required; author self-check is not QA.
- DEV release/smoke after CI; **Owner UAT = NOT_TESTED**; no fictitious user PASS.
- Real-user writes remain default disabled until parent notice/recourse/retention readiness.

## Non-goals / stops

- No attendance/absent/no-show, reviews, UI, staff adjudication, Mode B runtime READY claim, PROD, main promotion, C5, parent #372 close.
- Do not edit applied SQL; if 0042 taken by a prior admitted release, HOLD collision (not applicable on this checkout).
- Prospective AGY QA only under OD-020 Medium capacity failure policy; do not replay unknown/complete Codex ops.
