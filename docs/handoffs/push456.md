# #456 PWA Web Push — author handoff (attempt2 / repair pass2)

## Scope delivered (source only)

End-to-end DEV source for standards Web Push on **new** Direct Messages (including first incoming) and Game Chat. Preference default **OFF**. No invitations, offline cache, background sync, PROD, or historical outbox replay.

Pass2 repairs PUSH-01..07 from Sol Medium QA + deterministic findings against candidate `0ecd95b0039b6f14f308232930442c67361df222`.

## Pass2 repairs

| ID | Fix |
|----|-----|
| PUSH-01 | Durable `web_push_delivery_intents` in message TX; PgBoss enqueue isolated by SAVEPOINT; existing worker schedule recovers pending intents (no new service) |
| PUSH-02 | Retry on **any** known transient device failure; sent claims skipped; concurrent recent `claimed` not re-sent; unknown transport preserved (no blind retry) |
| PUSH-03 | Before delivery: `users.status = active` + `account.access` via existing `unrestrictedSql` / session policy |
| PUSH-04 | `urlBase64ToUint8Array` returns ArrayBuffer-backed `Uint8Array` for PushManager BufferSource |
| PUSH-05 | `releases-server.test.ts` allowlist + seed assertions include confirmed alpha.20; alpha.21 current preserved |
| PUSH-06 | SW dead placeholders removed; worker globals scoped; PushSettings prefer-const; type import in web-push test |
| PUSH-07 | Decoder uses `globalThis.atob` (node-safe pure decode) |
| Account-switch | PushLifecycle generation invalidation + clear-before-async; SW activation before set-fence; click checks fence / auth fallback |

## Platform refs read

- `PUSH_PLATFORM_CHECK.md` (WebKit/Apple/MDN/web-push 3.6.7)
- `NEXT16_PWA_GUIDE.md` (framework reference only; Nest REST used, not demo Server Actions)
- Owner decision `docs/decisions/OWNER_DECISION_PWA_WEB_PUSH_MESSAGING_V001.md`
- Issue snapshot #456; alpha.21 brief + alpha.20 seed
- QA JSON + deterministic findings (pass1)

## Key paths

| Area | Paths |
|------|--------|
| Migration | `apps/api/migrations/0055_role_web_push.sql` + rollback (intents in-place; no 0056) |
| API | `apps/api/src/push/*`, env `WEB_PUSH_*` / VAPID, OpenAPI **0.29.0** |
| Jobs/worker | `job-enqueue.service` intent+SAVEPOINT enqueue; `worker-runtime` deliver + recover_intents schedule |
| Emit | `messaging.service` (createRequest + sendMessage), `game-chat.service` sendMessage |
| Session unbind | `session.service` → `PushService.unbindSessions` |
| Web | `PushSettings`, `PushLifecycle` (ConsumerShell), `public/sw-push.js`, `push-client.ts` |
| Release | alpha.**21** / API **0.29.0**; alpha.20 seed preserved |
| DEV overlay | `scripts/push/dev-push-compose.yml` (env **names** only) |

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

## Checks not run in author lane

- No `pnpm install` / network / Git / PR / live DB / host configs
- Unit/integration/disposable suites not executed here (no `node_modules` in export)
- No fake DEV ACCEPTED / READY / physical-device PASS

## Suggested PMA targeted checks

- `apps/api/test/unit/web-push.test.ts`
- `apps/api/test/integration/web-push.disposable.test.ts` (`RUN_DB_INTEGRATION=1`, DB `gobadminton_web_push_disposable`) — includes mixedSuccessRetry, accessRestriction, queueFailureIsolated+recover
- `apps/api/test/integration/migration.smoke.test.ts` (expects `0055_role_web_push` + intents table)
- `apps/web/test/web-push.test.tsx`, `apps/web/test/push-worker.test.ts`
- Existing release tests (alpha.20 seed + alpha.21 current)
- Contract/package pin checks; then CI → DEV → #457 without Owner GO
