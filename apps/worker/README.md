# Worker

Executable process of the **same backend release** as `apps/api` — not a separately versioned microservice.

## LS-02 wiring

- Dependency pin: `pg-boss@12.36.0` (declared on `@gobadminton/api`; worker runs the shared release entrypoint).
- Same-physical-transaction enqueue uses `pg.PoolClient` via `fromPoolClient` (`apps/api/src/jobs/from-pool-client.ts`).
- Job queue: `social.expiry.cleanup` — looking-intent + RadarPresence expiry, plus LS-03 `dm_request` expiry and message body retention purge on sweep. Payloads carry only opaque ids/kind/version (no coordinates/cells/message bodies/PII dumps).
- Radar/directory/DM expiry remains correct on read/commands when this process is down (ADR-SOCIAL-004 / LS-03 on-read fences).
- Legacy `outbox_events`: **KEEP_AS_EVIDENCE** — not replayed into pg-boss or notifications.

## Run

```bash
# after api build
pnpm --filter @gobadminton/worker start

# dev
pnpm --filter @gobadminton/worker start:dev
```

Requires the same `DATABASE_URL` / env as the API. Bounded pool via `DATABASE_POOL_MAX` (default 4 for worker). Graceful shutdown on SIGINT/SIGTERM.

Business mutations call owning-module cleanup commands; the worker does not bypass domain policy with raw SQL side doors outside those commands.
