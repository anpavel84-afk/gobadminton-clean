# #456 PWA Web Push — author handoff (attempt3 / repair pass3)

## Scope delivered (source only)

End-to-end DEV source for standards Web Push on **new** Direct Messages (including first incoming) and Game Chat. Preference default **OFF**. No invitations, offline cache, background sync, PROD, or historical outbox replay.

Pass3 repairs remaining PUSH-01/08/09/10 from Sol Medium QA pass2 + DB findings against candidate `515a83ee5ec389c1f6f38ef48360020919d718a6`. Closed PUSH-02..07 preserved unchanged.

## Pass3 repairs

| ID | Fix |
|----|-----|
| PUSH-01 | Recover: pending→queued + pg-boss enqueue share one atomic TX via `fromPoolClient` on the same client; enqueue failure rolls back (intent stays pending). No mark-queued-then-nontransactional-send. Message-TX durable intent + SAVEPOINT enqueue preserved. |
| PUSH-08 | No 120s auto-reclaim of `claimed`. Ambiguous transport → durable `unknown` claim (skipped on duplicates). Known HTTP 503 → `failed`/retry. Library classifies known status vs ambiguous exception. |
| PUSH-09 | Disposable DB: each scenario mints a distinct direct conversation pair (real `conversations_pair_direct_uidx`); no shared-pair re-INSERT; preference/status isolation via separate actors. |
| PUSH-10 | `push-client` single promise chain + generation token checked after awaits and immediately before SW `postMessage`; PushLifecycle clear→fetch→set shares one generation. No permission prompt on mount. |

## Pass2 repairs (closed — do not reopen)

PUSH-02..07 as previously accepted (mixed-device retry, account fence, ArrayBuffer keys, alpha.20/21 release tests, SW cleanup, atob decoder).

## Platform refs read

- Owner short Mode A rules; Issue #456 assignment Exact515a83ee…
- Independent QA pass2 `final.txt` + DB findings `push456-pass2-db-findings.txt`
- Existing `fromPoolClient` / SAVEPOINT enqueue primitives

## Key paths

| Area | Paths |
|------|--------|
| Migration | `apps/api/migrations/0055_role_web_push.sql` (+ `unknown` claim status; not deployed — in-place) |
| Delivery | `push-delivery.ts` recover TX + claim reclaim + transport classify |
| Worker | `worker-runtime.ts` recover uses `fromPoolClient` enqueue |
| Web fence | `push-client.ts`, `PushLifecycle.tsx` |
| Tests | unit classify; disposable isolated pairs + recover TX; web fence out-of-order |
| Release | alpha.**21** / API **0.29.0** unchanged |

## Runtime activation (PMA — not done in author lane)

1. Reviewed source + independent QA + Product CI
2. Root-only DEV VAPID generate; set `WEB_PUSH_ENABLED=1` + VAPID_* on existing API Compose; worker already copies API env via `scripts/mail/dev-worker.py`
3. Backup / CAS / readback / rollback
4. **Do not** treat env flag or source PASS as installed runtime
5. Physical iPhone / auth UAT = **NOT_TESTED** until Owner tests

## Invariants

- Payload titles only: «Новое сообщение» / «Новое сообщение в чате игры»; same-origin `/messages?…` deep links
- No endpoint/p256dh/auth/VAPID private in logs, responses, or other-account leaks
- Endpoint host allowlist (FCM/Mozilla/Apple); no arbitrary HTTPS
- Preference independent of OS permission; no permission prompt on page load
- External transport / PgBoss enqueue failure must not roll back committed messages
- Default `WEB_PUSH_ENABLED=0` preserves existing queues/tests
- UNKNOWN external effect is not blind-retried

## Checks not run in author lane

- No `pnpm install` / network / Git / PR / live DB / host configs
- Unit/integration/disposable suites not executed here when deps absent
- No fake DEV ACCEPTED / READY / physical-device PASS

## Suggested PMA targeted checks

- `apps/api/test/unit/web-push.test.ts` (incl. known vs ambiguous transport)
- `apps/api/test/integration/web-push.disposable.test.ts` (`RUN_DB_INTEGRATION=1`, DB `gobadminton_web_push_disposable`) — full 5-test suite in one run
- `apps/api/test/integration/migration.smoke.test.ts` (expects `0055_role_web_push` + intents + unknown status)
- `apps/web/test/web-push.test.tsx` (fence out-of-order), `apps/web/test/push-worker.test.ts`
- Existing release tests (alpha.20 seed + alpha.21 current)
- Contract/package pin checks; then CI → DEV → #457 without Owner GO
