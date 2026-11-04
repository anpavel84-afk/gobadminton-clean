# #457 Internal post-game organizer reminders — author handoff (pass1)

## Scope delivered (source only)

Bounded durable **in-app** reminders for the current organizer to record game outcome after `endsAt`, max **3** ordinals, «Подвести итоги» / «Позже». No auto `held`/`absent`/sanctions. No SMS/email/Web Push delivery. Existing PgBoss worker + `POST_GAME_INTERNAL_ENABLED` (default off).

## Design choices (local, not Owner SLA)

| Item | Choice |
|------|--------|
| Schedule | 1h / 24h / 72h after `endsAt` |
| Snooze («Позже») | 24h; same ordinal; does not reset max-3 |
| Organizer | Active `game_managers` role `owner`\|`manager` |
| Dedup | UNIQUE `(game_id, organizer_user_id, ordinal)` |
| Batch | 50 games per sweep |
| Probe | `to_regclass` before domain work; never catch `42P01` as success |

## Key paths

| Area | Paths |
|------|--------|
| Migration | `0056_postgame_reminders.sql` + rollback guard |
| Policy/service/API | `game-reminders.*` + `GamesModule` |
| Worker | `POSTGAME_REMINDERS_SWEEP_QUEUE` when post-game writes admitted |
| Web | `PostgameReminders` on My Games + Results; `game-reminders.ts` |
| Contract | OpenAPI **0.30.0** — `GET/POST /me/postgame-reminders` |
| Release | current **alpha.22**; historical alpha.21 seeds faa236… + 98f765… (25/30) |

## Invariants

- Lock order HTTP: Actor → Game → manager (MutationRunner)
- Worker: Game → managers (no Actor-before-Game inversion)
- Later keeps idempotency receipt; blind new-key retry not used for unknown writes
- Cross-account → private 404
- Attendance / disputes / outcomes unchanged by Later
- PR475 access fix preserved in alpha.21 history seed (98f765)

## Checks not run in author lane

No install / network / Git / live DB / runtime / PROD. PMA: unit + disposable `gobadminton_reminders_disposable` + migration.smoke + release tests + Sol Medium QA + CI + DEV.

## UAT

Owner authenticated display = **NOT_TESTED** until physical check.
