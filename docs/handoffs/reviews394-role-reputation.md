# Handoff · #394 role reputation pre-join API foundation (attempt 20)

Assignment: `OWNER394_ROLE_REPUTATION_PREJOIN_API_FOUNDATION`
Base (accepted): `7f33e9da0cf7b52d260567bbfb37114a3613d479`
Attempt: **20** · continues preserved #394 history (not UNKNOWN replay)
Parent: #372 · Private peer report #471 alpha19 **unchanged**
C5 OFF · PROD forbidden · no Git commit/push/deploy in this author pass

## Scope of this pass

Backend/contract foundation only for ONE coordinated organizer/trainer pre-join reputation delivery.
**UI + alpha20 changelog + release notes follow on the SAME source branch / SAME PR**, then one independent QA → CI → DEV.
This pass does **not** claim whole usecase DONE and must not publish/install partial backend alone.

## Delivered paths

### Migration
- `apps/api/migrations/0054_role_reputation.sql` (+ rollback)
  - `role_reputation_subjects` (opaque handles)
  - `game_role_proof_revisions` / `game_role_proofs` (planned at publish, performed at held; no current-manager backfill)
  - `role_review_slots` + durable `role_review_event_fences`
  - `role_review_revisions` / replies + reply revisions
  - `role_reputation_pending_intakes` (durable waiting intake **without** fake `admin_principal`)
  - reports / case links / decisions; `support_immutable` on append-only history

### Consumer API
- `role-reputation.{policy,dto,service,controller}.ts` registered in `games.module.ts`
- Publish freeze in `games.service.ts`; held confirm in `game-outcomes.service.ts`
- Endpoints: role summary by handle / game / public player; eligibility; consent preview; create; own commands; reply commands; reports

### Admin / Cases
- `admin/role-reputation.{service,controller,dto}.ts` + `admin.module.ts`
- Pending intake list + human intake creating real Case with genuine actor
- Scoped `GET /admin/cases/:id/role-review-source`
- `role_review_decide` / `role_basis_resolve` on existing `POST /admin/cases/:id/commands` (generic `status=resolved` does **not** publish)

### Contracts
- OpenAPI **0.28.0** additive paths/schemas; private peer `game_review` guards retained
- Admin protocol inventory **45** (was 42)

### Tests
- Unit: `test/unit/role-reputation.policy.test.ts` (admission + held count + consent hash)
- Disposable HTTP (skip unless `RUN_DB_INTEGRATION=1`):
  - `test/integration/role-reputation.disposable.test.ts`
  - `test/integration/admin-role-reputation.disposable.test.ts`

### Safety / profiles
- `safety.service.ts`: player-only abuse report guard preserved; role reports stay in domain table
- `profiles.service.ts`: documents public-profile gate reused by projector (unavailable ≠ zero)

## Remaining (same branch / same PR — next author pass)

1. Consumer UI: discovery trainer filter, game detail, public profile sections, own composer/consent, review drawer
2. Admin Cases UI buttons for pending kind + decide/basis
3. Alpha20 changelog / release-agent description
4. Trusted PMA: real DB migrate, types, contracts check, disposable HTTP with PostGIS
5. Independent Codex Sol Medium QA → Product CI/security → merge `dev` → DEV ACCEPTED smoke
6. Human moderation UAT = **NOT_TESTED** until authorized Admin session observes approve/remove/restore

## Author checks run / not run

| Check | Result |
|---|---|
| Unit policy test | author should run locally if vitest available |
| Disposable DB HTTP | **notrun** (no dedicated disposable DB in author slot) |
| Product CI / security / DEV smoke | not claimed |
| Independent QA | not started |
| Owner UAT | NOT_TESTED |

## Known issues / notes

- Missing historical proof for pre-0054 games remains honest `missing_history` (no auto backfill).
- Venue writer CLOSED unchanged; private PG-3 never published via this path.
- Knowing opaque `roleHandle` alone cannot bypass profile/game surface gates.
- Pending submissions wait for human intake; offline reviewer does not block consumer POST receipt.
