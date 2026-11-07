# #496 Game-event Web Push — author handoff (pass1)

## Scope delivered (source only)

Bounded DEV source extension of #456/#457 Web Push for allowlisted **new** game business events. Reuses existing `web_push_*` tables/claims/queue + worker. Preference event groups default **OFF** (also for existing message consent). No new service/scheduler/transport/queue/OPS/PROD/email. No historical outbox sweep.

## Events

| Kind | Recipient | Copy (neutral) |
|------|-----------|----------------|
| `game_invitation` | invitee | Приглашение на игру |
| `participation_confirmed` | player | Заявка подтверждена |
| `participation_rejected` | rejected player (not requiring confirmed) | Заявка отклонена |
| `new_pending_application` | current active owner/manager | Новая заявка на игру |
| `game_cancelled` | cancel-TX snapshot pending/confirmed | Игра отменена |
| `game_time_changed` / `game_venue_changed` | pending/confirmed + managers when published values actually change | Изменено время/место игры |
| `outcome_reminder` | organizer on existing #457 `markVisible` ordinal 1..3 | Напоминание об итоге игры |

Click paths: `/games/{id}` or `/my-games/{id}/results` (outcome). SW fence + ordinary auth fallback preserved. Game 404 policy not weakened.

## Key paths

| Area | Paths |
|------|--------|
| Migration | `0060_game_event_push.sql` (+ rollback); preserves 0055/0056/0059 |
| Policy/intents/delivery | `game-push.policy.ts`, `game-push-intents.ts`, `game-push-delivery.ts` |
| Hooks | invitations create; participations request/confirm/reject; games cancel + `applyPublishedScheduleChangeInTransaction`; reminders `markVisible` |
| Prefs/UI | preference columns + `PushSettings` five compact toggles; master/device still dominate |
| Tests | `game-push.test.ts`, `game-push.disposable.test.ts`; migration smoke expects `0060_game_event_push`; adapted PushState fixtures |
| Release | alpha.**38** / API **0.37.0**; trusted alpha.**37** seed appended EXACT; current SHA/date NULL; owner UAT NOT_TESTED; physical iPhone NOT_TESTED |

## Activation (PMA — not author)

1. Independent Sol Medium QA + Product CI + DEV smoke
2. Existing `WEB_PUSH_ENABLED` + VAPID path reused — no new runtime keys in this lane
3. Do **not** claim external provider delivery PASS from fake-transport tests
4. Owner UAT / physical iPhone = **NOT_TESTED**

## Checks not run in author lane

- No Git writes, live DB, host deploy, secrets, model calls
- Disposable/DB suites not executed here when isolated DB absent
- No fake READY/ACTIVE/PROD

## Suggested PMA targeted checks

- `apps/api/test/unit/game-push.test.ts`
- `apps/api/test/unit/web-push.test.ts`
- `apps/api/test/integration/game-push.disposable.test.ts` (`RUN_DB_INTEGRATION=1`, DB `gobadminton_game_push_disposable`)
- `apps/api/test/integration/web-push.disposable.test.ts` (eventPreferences default OFF)
- `apps/api/test/integration/migration.smoke.test.ts` (0060 names)
- `apps/web/test/web-push.test.tsx`, `apps/web/test/push-worker.test.ts`, release tests alpha.38
