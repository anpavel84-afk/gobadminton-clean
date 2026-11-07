# #496 Game-event Web Push — author handoff (pass5 product + pass3 StyleGuide UI)

## Owner decision (6704777482, 07Nov2026)

**RELEASE ONLY** six existing actions: invitation; new pending application → active organizer; confirmed/rejected → player; cancelled → prior properly linked participants; #457 outcome reminder max3/Later.

**Time/venue edit and push = DEFERRED NOT_IMPLEMENTED.** No editing API/UI, no schedule-change helper, no hidden test-only producer. Immutable venue attribution unchanged. Previous four passes/costs/failures retained.

## Scope (source only)

Bounded DEV source on #456/#457 Web Push for the six allowlisted kinds. Reuses `web_push_*` tables/claims/queue + worker. Preference groups default **OFF** (also for existing message consent). No new service/scheduler/transport/queue/OPS/PROD/email. No historical outbox sweep.

## Pass5 bounded repair (product — retained; actual DEV39 ACCEPTED)

| Item | Action |
|------|--------|
| Dead helper | Removed `applyPublishedScheduleChangeInTransaction` and time/venue outbox/push emit paths from unreleased 0060 source |
| Schema | 0060 kind/shape CHECK lists only the six released kinds; deferred kinds refuse at DB |
| Runtime | Payload/policy gates reject `game_time_changed` / `game_venue_changed`; focused unit + disposable negative coverage |
| Prefs/UI | API group `gameChanges` kept (no gratuitous rename); UI label honest **«Отмена игры»** only — no time/place promise |
| Protections retained | Explicit OFF opt-in; separate message consent; neutral copy; business version fences; SQL microsecond manager proof; actor/block/mute/session/device; cancel snapshot; rejection semantics; dedupe/recover/UNKNOWN; savepoint isolation; max3/Later |
| Migrations | Do not alter accepted 0055/0056/0059 |
| Release | Trusted **alpha.39** seed appended EXACT after DEV ACCEPTED (`01ea6f2f` / `r42359322474-a1`); alpha.38/37 preserved |

## Pass3 — StyleGuide toggle UI + alpha.40 candidate (this author pass)

Observed alpha.39 installed screenshots: event groups looked like unstyled browser fieldset / bullets with checkbox misalignment.

| Item | Action |
|------|--------|
| UI | Five event keys use existing `ProfileComposition.Toggle` (`.fr3 .toggle-row`); same keys / callback / CAS / OFF defaults / disabled+busy; message consent unchanged |
| Copy | Removed technical «Мастер-выключатель…»; helper «Выберите, какие уведомления об играх получать.» |
| CSS | Narrow list-reset / row gap / fieldset header tokens in `push-notifications.css` only; no new toggle implementation / settings chrome |
| Unchanged | Permission gesture / session fences / API / SW; no automatic opt-in; screenshot NaN badge = synthetic inbox fixture (not app change); no new cosmetic-mirroring tests |
| Release | Current **alpha.40** / API **0.37.0**; SHA/date null; Owner UAT / physical iPhone / GoBad = **NOT_TESTED**; time/place still **DEFERRED_NOT_IMPLEMENTED** |
| QA | Prior 498 source QA FAIL P1 retained; combined independent QA after this pass — **do not claim QA PASS yet** |

## Events (released)

| Kind | Recipient | Copy (neutral) | Wire |
|------|-----------|----------------|------|
| `game_invitation` | invitee | Приглашение на игру | connected |
| `participation_confirmed` | player | Заявка подтверждена | connected |
| `participation_rejected` | rejected player | Заявка отклонена | connected |
| `new_pending_application` | current active owner/manager | Новая заявка на игру | connected |
| `game_cancelled` | cancel-TX snapshot pending/confirmed | Игра отменена | connected |
| `outcome_reminder` | organizer on #457 `markVisible` ordinal 1..3 | Напоминание об итоге игры | connected |

Deferred (not in enum / rejected at runtime): `game_time_changed`, `game_venue_changed`.

Click paths: `/games/{id}` or `/my-games/{id}/results` (outcome). SW fence + ordinary auth fallback preserved. Game 404 policy not weakened.

## Key paths

| Area | Paths |
|------|--------|
| Migration | `0060_game_event_push.sql` (+ rollback); preserves 0055/0056/0059; additive `manager_updated_at` |
| Policy/intents/delivery | `game-push.policy.ts`, `game-push-intents.ts`, `game-push-delivery.ts` |
| Hooks | invitations create; participations request/confirm/reject; games cancel; reminders `markVisible` |
| Prefs/UI | preference columns + `PushSettings` + `push-notifications.css`; `gameChanges` = cancellation only; StyleGuide toggles |
| Tests | six-kind unit; deferred negative; cancel disposable; existing web-push/SW + release alpha.40 / seed **48** deployments |
| Release | alpha.**40** / API **0.37.0**; trusted alpha.**39** + alpha.**38** + alpha.**37** seeds preserved |

## Activation (PMA — not author)

1. Independent Sol Medium QA + Product CI + DEV smoke
2. Existing `WEB_PUSH_ENABLED` + VAPID path reused — no new runtime keys in this lane
3. Do **not** claim external provider delivery PASS from fake-transport tests
4. Owner UAT / physical iPhone / GoBad = **NOT_TESTED**
5. Time/place remains **DEFERRED NOT_IMPLEMENTED** until a future Owner decision

## Checks not run in author lane

- No Git writes, live DB, host deploy, secrets, model/network/provider calls
- Disposable/DB suites not executed here when isolated DB absent
- No fake READY/ACTIVE/PROD/CI PASS / DEV ACCEPTED / iPhone / GoBad / UAT claim

## Suggested PMA targeted checks

- `apps/api/test/unit/game-push.test.ts`
- `apps/api/test/unit/web-push.test.ts`
- `apps/api/test/integration/game-push.disposable.test.ts` (`RUN_DB_INTEGRATION=1`, dedicated DB or Actions recipe)
- `apps/api/test/integration/web-push.disposable.test.ts` (eventPreferences default OFF)
- `apps/api/test/integration/migration.smoke.test.ts` (0060 names)
- `apps/web/test/web-push.test.tsx`, `apps/web/test/push-worker.test.ts`
- `apps/web/src/lib/releases.test.ts`, `apps/web/test/releases.test.tsx`, `apps/web/test/releases-server.test.ts` (alpha.40 / seed 48)
