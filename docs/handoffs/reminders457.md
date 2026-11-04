# #457 Internal post-game organizer reminders — author handoff (pass6)

## Scope delivered (source only)

Bounded durable **in-app** reminders for the current organizer to record game outcome after `endsAt`, max **3** activation rounds / ordinals, «Подвести итоги» / «Позже». No auto `held`/`absent`/sanctions. No SMS/email/Web Push delivery. Existing PgBoss worker + `POST_GAME_INTERNAL_ENABLED` (default off).

## Repair pass6 (exact Sol Medium QA FAIL P2 on `db4f4751`)

| Finding | Fix |
|---------|-----|
| R457-1 ensure-missing monopolizes batch | Pre-LIMIT ensure-missing EXISTS mirrors `accountGate`: `users.status='active'` + `unrestrictedSql(account.access)` on `gm.user_id`. Ineligible managers with zero rows no longer occupy bounded sweep; open-row stop path unchanged. Regression: older inactive + restricted before newer eligible, `batchLimit` 2 → newer ensures/activates; ineligible stay at 0 rows |
| R457-2 Later receipt leaks other games | `authorizeReplay` still validates target locks/manager; then **current-projects** stored `ReminderListView` in place via `listMineWithClient` (MutationRunner returns stored body). After revoke of other game B, same A key/body replay omits B/title and does not re-mutate. Unchanged-perms equality replay preserved |

## Prior repairs retained (pass4/pass5)

| Finding | Fix |
|---------|-----|
| Later cap / fixture clock | `snoozed_until` + min-gap axis for next fake sweep |
| R1 overdue cooling starvation | Candidate scheduled-due mirrors `canActivateAnother` before LIMIT |
| Stop gated on ends_at / no account.access | Stop authorities independent of due-end; cancel/outcome/role/inactive/restriction |

## Design choices (local, not Owner SLA)

| Item | Choice |
|------|--------|
| Schedule | 1h / 24h / 72h after `endsAt` |
| Activation gap | min 24h between actual activations (no 3-card catch-up) |
| Snooze («Позже») | 24h; advances to next ordinal on expiry; does not reset max-3 activations |
| Organizer | Active `game_managers` role `owner`\|`manager` + active user + account.access |
| Dedup | UNIQUE `(game_id, organizer_user_id, ordinal)` |
| Batch | 50 actionable games per sweep |
| Probe | `to_regclass` before domain work; never catch `42P01` as success |
| Later replay | Target auth + current list projection; no MutationRunner extension |

## Key paths (this pass — only4)

| Area | Paths |
|------|--------|
| Command | `apps/api/src/games/game-reminders.command.ts` |
| Service | `apps/api/src/games/game-reminders.service.ts` |
| Disposable | `apps/api/test/integration/game-reminders.disposable.test.ts` |
| Handoff | `docs/handoffs/reminders457.md` |

## Invariants preserved

- R2: max 3 activations / one visible card / min spacing
- R3: consistent locks (HTTP Actor→Game→manager→Reminder; worker Game→managers→reminders)
- Cap3 / attempts / history / local restrictions overlay
- No schema/gates/versions/root/live/network/models/framework/migration/worker/API-contract rewrite
- Cross-account → private 404; Later does not touch attendance/disputes/outcomes

## Checks / publication (author lane)

**Source-only.** No install / network / Git / live DB / runtime / DEV / PROD in this pass. Native status is not PASS. No DEV ACCEPTED claim. Prior DB 8/8 + type/lint/foundation/unit/web receipts at reviewed SHA reused as baseline; PMA: re-run disposable suite including the two new regressions, then independent Sol Medium content QA.

## UAT

Owner authenticated display = **NOT_TESTED** until physical check.
