# API boundary

NestJS 11 + Fastify executable for GoBadminton.

## Implemented routes

Foundation (F-01):
- `GET /v1/health`
- `GET /v1/ready`
- `GET /v1/meta`

Identity / browser session (F-02):
- `GET /v1/auth/providers`
- `GET /v1/auth/{vk|yandex}/start`
- `GET /v1/auth/{vk|yandex}/callback`
- `POST /v1/auth/logout`
- `GET /v1/me`

Live VK/Yandex credentials are optional. Without them, provider adapters remain real but start fails closed with `PROVIDER_UNAVAILABLE`. No synthetic public login provider is exposed.

Game/participation business endpoints remain unimplemented.

## Commands

```sh
pnpm --filter @gobadminton/api run typecheck
pnpm --filter @gobadminton/api run lint
pnpm --filter @gobadminton/api run test:unit
pnpm --filter @gobadminton/api run db:migrate
pnpm --filter @gobadminton/api run test:integration
pnpm --filter @gobadminton/api run build
```

Integration tests require real PostgreSQL/PostGIS and `RUN_DB_INTEGRATION=1`.

[Auth](../../docs/integrations/AUTH.md), [Providers](../../docs/integrations/PROVIDERS.md), [contract](../../packages/contracts/openapi.json).

Email E1 is source-only/internal-test-only. Default availability is disabled; there is no SMTP adapter.
See [email contract](../../docs/api/EMAIL_AUTH_E1_ADDENDUM_V001.md) and
[decision](../../docs/decisions/ADR-0015-EMAIL-AUTH-INTERNAL-FOUNDATION.md). The fake deterministic
memory mailbox has no HTTP accessor and requires loopback local NODE_ENV=test with three
distinct dedicated EMAIL_AUTH_HMAC_SECRET / EMAIL_AUTH_ENCRYPTION_SECRET /
EMAIL_AUTH_RATE_SECRET values. Worker and API reuse the same pg-boss schema. Never copy test
configuration into public environments. Email current-address proof, change and unlink are included; see EMAIL_AUTH_E2E3_ADDENDUM_V001.md.
