# Issue #181 / FR-3A source handoff — Mode A reuse (Owner 28.10.2026)

From: Cursor Auto author attempt 1. To: independent QA (Codex Sol Medium), then trusted publish/CI/DEV route.
Status: SOURCE DRAFT / NOT_TESTED / NOT ACCEPTED.
Assignment: OWNER_LEAN_MODE_A_FR3A_REUSE_PR189 replacing #284 as third Mode A delivery.
Product base `777c88f96706c38e6f76d35a55a1a1cb2138a1ec`; merge base `b9c6aa2dd7a7ffd220bbd2d887d9905045b11284`.
Work limited to allowed_paths in the CLEAN tree. No Git writes, network, secrets, package install,
DB/SQL/runtime, frontend/OPS, UI182, C5, or reimplementation of already-present recommendation code.

## This author turn (compatibility repair)

Registry fact: accepted DEV already owns `0040_external_http_url_storage`. The merged candidate still
had colliding `0040_game_recommendations` (+ rollback). Renamed only that pair to
`0041_game_recommendations` (+ rollback) after confirming next free id is 0041. External URL
migration/rollback were not edited. Schema comment, disposable harness (`f<"0041"`, migrate/rollback
`0041_*`, empty-rollback count 40), migration smoke ordered id + FR-3A table/FK/index/privacy
assertions, API doc, and this handoff were updated accordingly.

Shared OpenAPI and migration.smoke had been resolved to CURRENT DEV (recommendations additions
absent). Reapplied ONLY FR-3A contract additions from the supplied exact old patch, adapted to the
current schema: `GameRecommendations` tag; four cookie-session paths matching the Nest controller
(`/games/{gameId}/recommendations`, `/me/game-recommendations`, hide/withdraw); request/response
schemas; Friends description clarifications; `SocialCapabilities.gameRecommendations` remains false
with migration 0041 noted. OpenAPI write descriptions say migration0041, not 0040.

Inherited PR189 implementation kept: module/controller/service/policy, Friends/Games seams,
schema mirror, unit + disposable suites, `gameRecommendations: false` capability. No UI182.
No new framework. Product invariants (public upcoming eligibility, accepted friendship, bilateral
block/restriction/epoch fences, session/CSRF, role/expectedVersion/idempotency/unknown-commit,
read-time revalidation, no seat/invitation/DM) preserved in source review; not re-executed here.

## Changed files (this turn)

1. `apps/api/migrations/0041_game_recommendations.sql` (renamed from colliding 0040_*)
2. `apps/api/migrations/rollback/0041_game_recommendations.sql` (renamed; id/message → 0041)
3. removed `apps/api/migrations/0040_game_recommendations.sql` and matching rollback
4. `apps/api/src/database/schema.ts` (Migration0041 comment only)
5. `apps/api/test/integration/migration.smoke.test.ts`
6. `apps/api/test/integration/game-recommendations.disposable.test.ts`
7. `packages/contracts/openapi.json` (recommendations additions only atop current DEV)
8. `docs/api/GAME_RECOMMENDATIONS_V001.md`
9. `docs/handoffs/fr3a-recommendation-api.md`

## Checks

Executed (source-only, no deps): OpenAPI JSON parse; migration registry uniqueness/order;
rollback id string; smoke/disposable/controller/capability string assertions; route/OpenAPI path
alignment. `node_modules` absent — typecheck, lint, unit, contracts package check, disposable DB,
migration smoke SQL, build, CI: **NOT_TESTED**. Do not treat this handoff as PASS.

## Remaining risks

- Independent QA must run unit + disposable PostGIS + migration smoke (N incl. 0040_external + 0041)
  and full Product CI on the published SHA.
- Confirm OpenAPI status/body parity against live Nest responses once CI executes the suite.
- Lock ordering and rate-bucket sharing remain review targets; no runtime proof in this turn.
- Empty-only SQL rollback still refuses populated history; release rollback stays application-path.

## Acceptance transfer

DONE requires criteria + independent QA/CI + DEV release/smoke under Mode A — not author presence.
PROD only by separate Owner decision. FR-3B UI remains unassigned here. Preserve old C5 attempt3 /
raw history; no budget reset narrative. Next independent task after DONE/BLOCKED is PMA-assigned.

## Historical handoffs (context only)

Earlier CI fixture repair and 2026-10-22 FR-3A correction handoffs referred to reserved migration
0040 before accepted DEV claimed `0040_external_http_url_storage`. Those sections are historical
process context; current registry truth is 0041 for recommendations. Prior NOT_TESTED / FAIL
statements are not cleared by this source turn.
