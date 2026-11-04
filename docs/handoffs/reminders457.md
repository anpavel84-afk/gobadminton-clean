# #457 Internal post-game organizer reminders — author handoff (pass2)

## Scope delivered (source only)

Bounded durable **in-app** reminders for the current organizer to record game outcome after `endsAt`, max **3** activation rounds / ordinals, «Подвести итоги» / «Позже». No auto `held`/`absent`/sanctions. No SMS/email/Web Push delivery. Existing PgBoss worker + `POST_GAME_INTERNAL_ENABLED` (default off).

## Repair pass2 (exact findings)

| Finding | Fix |
|---------|-----|
| Policy `dueAtForOrdinal` offset possibly undefined | `Record<1\|2\|3, number>` offsets map |
| Web test inline `typeof import(...)` | Normal `import type * as GameRemindersLib` |
| Disposable `loadEnv(... USER_RESTRICTIONS=1)` | loadEnv without flag; test-only `env.USER_RESTRICTIONS_INTERNAL_ENABLED=true` overlay |
| R1 batch starvation | Actionable candidate SQL (due / ensure / stop); idle visible cards drop out of batch |
| R2 burst + unbounded Later resurfacing | One visible card; max 3 `activated` events; min 24h gap; Later advances next ordinal / stops at cap (`superseded`) |
| R3 lock inversion | HTTP Later: unlocked tip → Game → manager → Reminder (matches worker Game→Reminder) |

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

## Key paths

| Area | Paths |
|------|--------|
| Migration | `0056_postgame_reminders.sql` (+ `superseded` stop reason) + rollback guard |
| Policy/service/API | `game-reminders.*` + `GamesModule` |
| Worker | `POSTGAME_REMINDERS_SWEEP_QUEUE` when post-game writes admitted |
| Web | `PostgameReminders` on My Games + Results; `game-reminders.ts` |
| Contract | OpenAPI **0.30.0** — `GET/POST /me/postgame-reminders` |
| Release | current **alpha.22**; historical alpha.21 seeds unchanged |

## Invariants

- Lock order HTTP: Actor → Game → manager → Reminder (MutationRunner + tip read)
- Worker: Game → managers → reminders (no Actor-before-Game inversion)
- Later keeps idempotency receipt; blind new-key retry not used for unknown writes
- Cross-account → private 404
- Attendance / disputes / outcomes unchanged by Later
- PR475 access fix preserved in alpha.21 history seed (98f765)

## Checks not run in author lane

No install / network / Git / live DB / runtime / PROD. Native status is not PASS. PMA: unit + disposable `gobadminton_reminders_disposable` + migration.smoke + release tests + independent QA + CI + DEV.

## UAT

Owner authenticated display = **NOT_TESTED** until physical check.
