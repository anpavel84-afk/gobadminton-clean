# Handoff · Issue #506 · MOD-V2-A public text (author pass 2 repair)

Source-only candidate after pass-1 `da034129a54d7d3191b54eb492e0900af9955d92`. No DONE / QA / DEV / UAT claims.

## Pass-2 concrete repairs

1. `games.service.ts` — extend `lockGame` typed row + `FOR UPDATE` SELECT with stored `title`, `host_display_name`, `host_public_contact`, `training_description`, `settlement_terms`, `trainer_display_name_snapshot`; publish fence/bind uses those storage names (not DTO aliases). Preflight stays outside the transaction.
2. `releases-server.test.ts` — whitelist adds explicit `0.1.0-alpha.44` between 43 and CURRENT 45; seed count/dates unchanged.
3. `releases.test.tsx` — alpha.45 additions assert public-text moderation prose; fixes length 0; limitations stay strict; no WebP invented for 45; historical 44 assertions untouched.
4. `public-text-moderation.test.ts` — `setGlobalPrefix('v1')` + `ProblemExceptionFilter`; AUTH override array; assert callback HTTP 302+location before parse; loopback + `RUN_DB_INTEGRATION`/`GMAP1_DISPOSABLE_DB` before migrate; small HTTP coverage for draft/unlisted publish, reject/version/idempotent, visibility promotion, trainer reactivation. Fake provider only.
5. `ProfilePage.tsx` `failed()` — recognized moderation notice (incl. provider 503) keeps edit mode and `needsRefresh=false`; auth 401 / social-disabled / network 0 / version 409 unchanged.

## Unchanged from pass 1 (not re-architected)

- Common policy/adapter/M1; Mode B/C/D not started
- Application `0.1.0-alpha.45` notes already present; API contract `0.37.0`
- Migration `0061_content_moderation_text.sql`
- `api-client.ts` `publicTextModerationNotice` reused as-is (no edit this pass)

## Parent recheck scope

- API typecheck (publish path)
- Target integration `public-text-moderation.test.ts`
- Release 2 tests (`releases-server.test.ts`, `releases.test.tsx`)
- Unchanged 28 unit/API lint/web types reusable unless related source changed
- Then independent Codex Sol Medium + Product CI/DEV

## Still not claimed

- Overall PASS/DONE from source author
- Mode B binding / AGY author / PROD
