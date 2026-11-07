# OWNER DECISION — temporary DEV moderation quantity-quota pause until 2027-01-01 · v001

**Status:** OWNER_DIRECT — BINDING FOR DEV SOURCE
**Date recorded:** 2026-11-08 (author pass; Owner decision via canonical #506)
**Canonical:** Issue [#506](https://github.com/anpavel84-afk/gobadminton-clean/issues/506) comment `6714311820`
**Refs:** [#488](https://github.com/anpavel84-afk/gobadminton-clean/issues/488) (user-quota / moderation attempt budget context)
**Assignment:** `OWNER506_DEV_ONLY_TEMPORARY_QUANTITY_QUOTA_PAUSE_UNTIL_20270101`

## Context (user quota reference)

Product moderation attempt budgets for **image** and **text** buckets are:

- **10** provider attempts per rolling **15 minutes** per user;
- **50** provider attempts per rolling **24 hours** per user;

implemented as atomic `content_moderation_rate_budgets` reservation before provider I/O (`reserveAttempt`). Cached ALLOW evidence does not consume a new attempt. Provider Retry-After / `next_allowed_at`, classification, local filters, publication gates, approvals, and human queue are separate controls.

Owner asked to remove these **quantity** limits for the next ~2 months on **DEV only**, until the beginning of January 2027, without weakening content gates or inventing a permanent kill switch.

## Exact scope

| Item | Binding value |
| --- | --- |
| Environments | Trusted DEV only: `NODE_ENV=production` and `APP_ENV` ∈ `{mvp, stage}` and **both** `PUBLIC_WEB_ORIGIN` and `PUBLIC_API_ORIGIN` exact `https://dev.gobadminton.ru` |
| Not DEV | `APP_ENV=dev` is **wrong** / non-admitting; local/test, PROD, mixed/unknown origins keep full 10/50 caps even before the deadline |
| Surfaces | Image + text moderation quantity predicates only |
| Hard expiry | `2027-01-01T00:00:00.000Z` (inclusive return of caps: active while `now() <` deadline) |
| Clock | Trusted server / SQL `now()` consistently; no new daemon |
| Request Origin | Must **not** enable pause |
| Admin/QA flags | Must **not** gate this pause |

## Behaviour while pause is active

1. Quantity predicates may permit counts **above** 10 / 50.
2. Reservation remains **atomic autocommit**; every actual provider attempt is still reserved and **increments** `count` / `day_count` (and retains rolling-window bookkeeping).
3. `next_allowed_at` (provider backoff) is **never** bypassed.
4. Classification / local filter / publication gates / approvals / human queue unchanged.
5. Real provider/account limits, Retry-After, timeouts, concurrency unchanged.
6. Attempt counts, history, and UNKNOWN fences retained — no counter reset, no alternate actor, no manual SQL wipe.

## Automatic return

At `2027-01-01T00:00:00Z` (SQL `now() < deadline` becomes false) the ordinary 10/15min and 50/24h quantity caps apply again automatically from the versioned policy helper. No scheduler, no config/env deployment variable, and no generic check kill switch.

## Out of scope / unchanged

- PROD and non-exact-DEV runtimes
- Release catalogue / alpha.51 claims / deploy / Git secrets
- Provider model alias, cache invalidation, decision policy
- New service, architecture, or Admin privilege changes
- Whole #506 B2/C/D and #507 (still pending)
- Already accepted A / B1a / B1b / B1c / M1 and gallery.49 fixes

## Cost / count retention

Paid and unpaid attempt history remains; pause does not zero budgets or invent free provider calls. Cached ALLOW still skips reservation. Unknown spend is not declared zero.
