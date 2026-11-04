# #457 Internal post-game organizer reminders — author handoff (pass4)

## Scope delivered (source only)

Bounded durable **in-app** reminders for the current organizer to record game outcome after `endsAt`, max **3** activation rounds / ordinals, «Подвести итоги» / «Позже». No auto `held`/`absent`/sanctions. No SMS/email/Web Push delivery. Existing PgBoss worker + `POST_GAME_INTERNAL_ENABLED` (default off).

## Repair pass4 (exact findings from pass3 DB FAIL + R1/stop)

| Finding | Fix |
|---------|-----|
| Later cap expects activated=1 got 0 | Fixture clock axis: `t0` = fixed now; after HTTP Later read persisted `snoozed_until`; next fake sweep = `max(until, prevActivation+MIN_GAP)+1ms` (HTTP uses real `clock_timestamp`) |
| R1 overdue cooling starvation | Candidate SQL for scheduled-due mirrors `canActivateAnother` (count&lt;3 + min 24h gap) **before** `LIMIT`; cooling 4d-ended games drop out so batchLimit 2 reaches the third |
| Stop gated on `ends_at<=now`; no `account.access` | Stop authorities independent of due-end gate; candidate + `processGame` apply cancel/outcome/role/inactive/`unrestrictedSql(account.access)` when enabled; future-rescheduled cancel + restriction subcases |

## Design choices (local, not Owner SLA)

| Item | Choice |
|------|--------|
| Schedule | 1h / 24h / 72h after `endsAt` |
| Activation gap | min 24h between actual activations (no 3-card catch-up) |
| Snooze («Позже») | 24h; advances to next ordinal on expiry; does not reset max-3 activations |
| Organizer | Active `game_managers` role `owner`\|`manager` |
| Dedup | UNIQUE `(game_id, organizer_user_id, ordinal)` |
| Batch | 50 actionable games per sweep |
| Probe | `to_regclass` before domain work; never catch `42P01` as success |

## Key paths (this pass)

| Area | Paths |
|------|--------|
| Command | `apps/api/src/games/game-reminders.command.ts` only |
| Disposable | `apps/api/test/integration/game-reminders.disposable.test.ts` |
| Handoff | `docs/handoffs/reminders457.md` |

## Invariants preserved

- R2: max 3 activations / one visible card / min spacing
- R3: consistent locks (HTTP Actor→Game→manager→Reminder; worker Game→managers→reminders)
- No schema/gates/versions/root/live/network/models rewrite
- Cross-account → private 404; Later does not touch attendance/disputes/outcomes

## Checks not run in author lane

No install / network / Git / live DB / runtime / PROD. Native status is not PASS. PMA: prior 7/8 + type/lint/foundation/unit/web/migration PASS reused; run all 8 disposable + new assertions together, then first independent Sol Medium content QA.

## UAT

Owner authenticated display = **NOT_TESTED** until physical check.
