# Web boundary

Next.js 16 App Router executable skeleton for F-01.

- Server-rendered foundation page with API health indicator
- Talks to API through `API_BASE_URL` only (no direct DB access)
- No product visual design / F-03 UI

## Commands

```sh
pnpm --filter @gobadminton/web run typecheck
pnpm --filter @gobadminton/web run lint
pnpm --filter @gobadminton/web run test:unit
pnpm --filter @gobadminton/web run build
```

[Web spec](../../docs/platforms/WEB_AND_ADMIN.md), [API](../../docs/api/API_POLICY.md).
