# #496 Game-event Web Push — author handoff (pass2)

## Scope delivered (source only)

Bounded DEV source extension of #456/#457 Web Push for allowlisted **new** game business events. Reuses existing `web_push_*` tables/claims/queue + worker. Preference event groups default **OFF** (also for existing message consent). No new service/scheduler/transport/queue/OPS/PROD/email. No historical outbox sweep.

## Pass2 repairs (Codex QA FAIL)

| Finding | Repair |
|---------|--------|
| Exact event revision | Delivery compares `eventKey` to trusted builders vs current row version; same-game + recipient; actor must remain active manager for invitation/decisions; new application checks applicant actor + participation version + `manager_updated_at` epoch snapshot (0060 additive); cancel requires current cancel version + snapshot; taken_down/hidden suppressed when GAME_MODERATION on; fences rechecked before **each** provider send |
| enqueueGamePush catch | Persist isolated via `SAVEPOINT web_push_game_intent`; PgBoss via existing savepoint; callers no longer swallow bare SQL (would abort business TX) |
| CI disposable guard | Mirrors reminders: dedicated `gobadminton_game_push_disposable` **or** Actions `gobadminton` + `GITHUB_ACTIONS`+`GMAP1_DISPOSABLE_DB`+`PG_CONTAINER`+`CI_DB_PORT` + loopback |
| Web / releases | SW click handler executed with mock `self` (safe game/results paths); seed deployments **46** after trusted alpha.37; alpha.38 prose = push additions + UNCONNECTED time/place limitation |

## Events

| Kind | Recipient | Copy (neutral) | User-facing wire |
|------|-----------|----------------|------------------|
| `game_invitation` | invitee | Приглашение на игру | connected (create invitation) |
| `participation_confirmed` | player | Заявка подтверждена | connected |
| `participation_rejected` | rejected player (not requiring confirmed) | Заявка отклонена | connected |
| `new_pending_application` | current active owner/manager | Новая заявка на игру | connected |
| `game_cancelled` | cancel-TX snapshot pending/confirmed | Игра отменена | connected |
| `game_time_changed` / `game_venue_changed` | pending/confirmed + managers when published values actually change | Изменено время/место игры | **UNCONNECTED/BLOCKED** — helper `applyPublishedScheduleChangeInTransaction` exists (test-only call sites); no HTTP/UI; Owner approval for future-game editing + played-at attribution **PENDING**. Do not claim user-facing done. |
| `outcome_reminder` | organizer on existing #457 `markVisible` ordinal 1..3 | Напоминание об итоге игры | connected |

Click paths: `/games/{id}` or `/my-games/{id}/results` (outcome). SW fence + ordinary auth fallback preserved. Game 404 policy not weakened.

## Key paths

| Area | Paths |
|------|--------|
| Migration | `0060_game_event_push.sql` (+ rollback); preserves 0055/0056/0059; additive `manager_updated_at` |
| Policy/intents/delivery | `game-push.policy.ts`, `game-push-intents.ts`, `game-push-delivery.ts` |
| Hooks | invitations create; participations request/confirm/reject; games cancel; reminders `markVisible`; schedule helper kept but **not** product-wired |
| Prefs/UI | preference columns + `PushSettings` five compact toggles; master/device still dominate |
| Tests | version-stale/revoke, CI guard, actual SW navigation; disposable + unit |
| Release | alpha.**38** / API **0.37.0**; trusted alpha.**37** seed appended EXACT; current SHA/date NULL; owner UAT NOT_TESTED; physical iPhone NOT_TESTED |

## Activation (PMA — not author)

1. Independent Sol Medium QA + Product CI + DEV smoke
2. Existing `WEB_PUSH_ENABLED` + VAPID path reused — no new runtime keys in this lane
3. Do **not** claim external provider delivery PASS from fake-transport tests
4. Owner UAT / physical iPhone = **NOT_TESTED**
5. Time/place push remains **UNCONNECTED/BLOCKED** until Owner replies on editing + attribution

## Checks not run in author lane

- No Git writes, live DB, host deploy, secrets, model calls
- Disposable/DB suites not executed here when isolated DB absent
- No fake READY/ACTIVE/PROD

## Suggested PMA targeted checks

- `apps/api/test/unit/game-push.test.ts`
- `apps/api/test/unit/web-push.test.ts`
- `apps/api/test/integration/game-push.disposable.test.ts` (`RUN_DB_INTEGRATION=1`, dedicated DB or Actions recipe)
- `apps/api/test/integration/web-push.disposable.test.ts` (eventPreferences default OFF)
- `apps/api/test/integration/migration.smoke.test.ts` (0060 names)
- `apps/web/test/web-push.test.tsx`, `apps/web/test/push-worker.test.ts`, release tests alpha.38 / seed 46
