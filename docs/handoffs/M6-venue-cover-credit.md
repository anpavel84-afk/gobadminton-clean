# M6 — venue cover credit

From: source author. To: independent QA / PM; I1 source author.
Date: 2026-10-19. Status: WORKING DRAFT — source-only candidate, NOT APPROVED.
Base: dev / checkout HEAD `1b4c97be0bf257fdf4edfa49426fa7e0aa3c7fa4`.
Assignment: immutable GOBADMINTON_AUTONOMY_V1 M6 source_only task supplied for issue-106.
No commit, push, publication, deployment, service changes or independent QA performed.
This local handoff must travel with the candidate into GitHub through the authorized external delivery process; no candidate commit permalink exists yet.
Base reference: https://github.com/anpavel84-afk/gobadminton-clean/tree/1b4c97be0bf257fdf4edfa49426fa7e0aa3c7fa4

## Implemented source

Migration 0037 adds nullable text columns `cover_credit_kind`, `cover_credit_text`, `cover_credit_url`.
Allowed kinds: `photo`, `logo`, `illustration` (CHECK, not a PostgreSQL enum).
Text limit: 120 characters. URL limit: 300 characters, HTTPS prefix required.
`venue_cover_credit_shape` wraps the complete shape expression in `IS TRUE`:
all NULL, or a non-NULL cover_key and one complete attribution shape.
Photo requires `Фото: %` plus URL; logo requires `Логотип: %` plus URL;
illustration requires exactly `Иллюстрация` and NULL URL.

I1 must update the new key and all credit fields together.
`clear_stale_venue_cover_credit()` / BEFORE UPDATE OF cover_key trigger
`venue_cover_credit_reset` clears all three fields when the key changes and
all three new attribution values equal their old values using IS NOT DISTINCT FROM.
An unchanged key preserves attribution. A changed key plus changed attribution preserves
the submitted attribution subject to CHECK. Explicitly resending identical attribution
with a different key clears it. Removing the key through existing admin or account-retirement
updates clears stale attribution; this does not authorize any admin implementation changes.

All four venues.service cover URL projections include attribution columns, including
INSERT RETURNING and venueSelectSql. Public venue cover returns `{uploadedUrl, credit}`;
credit is NULL for hidden/missing images or absent attribution.
No attribution write endpoint was added. Game projections were outside this slice.

Contract credit is optional for backward compatibility. Its non-NULL object requires
kind/text/url and disallows additional properties. Generated game types were produced by
`node packages/contracts/scripts/generate-game-types.mjs --write` (exit 0).

VenuePage displays VenueCoverCredit immediately after gb-venue-media.
Photo/logo HTTPS attribution opens a separate tab with noopener noreferrer nofollow;
illustration and unsafe/missing URL render escaped text. The editor callback preserves
credit for the same uploaded URL and clears it for a different URL.

## Files

- apps/api/migrations/0037_venue_cover_credit.sql
- apps/api/migrations/rollback/0037_venue_cover_credit.sql
- apps/api/src/venues/venues.service.ts
- apps/api/test/integration/venue-cover-credit.test.ts
- apps/api/test/integration/venue-cover.test.ts
- apps/api/test/integration/migration.smoke.test.ts
- packages/contracts/openapi.json
- packages/contracts/src/venue-cover.ts
- packages/contracts/src/game.generated.ts
- apps/web/src/components/consumer/venues/VenueCoverCredit.tsx
- apps/web/src/components/consumer/venues/VenuePage.tsx
- apps/web/src/lib/consumer-types.ts
- apps/web/test/venue-cover-credit.test.tsx
- docs/handoffs/M6-venue-cover-credit.md

## Required author checks

Each command below was attempted with `COREPACK_ENABLE_NETWORK=0`; each exited 1
before running the package script. Corepack has no available pnpm 10.18.0 and reported:
“Network access disabled by the environment; can't reach
https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz”.
No dependencies were installed or downloaded.

| Command (prefix COREPACK_ENABLE_NETWORK=0) | Exit | Result |
| --- | --- | --- |
| pnpm --filter @gobadminton/web run typecheck | 1 | NOT_TESTED: unavailable pnpm |
| pnpm --filter @gobadminton/web exec vitest run test/venue-cover-credit.test.tsx | 1 | NOT_TESTED: unavailable pnpm |
| pnpm --filter @gobadminton/api run typecheck | 1 | NOT_TESTED: unavailable pnpm |
| pnpm --filter @gobadminton/contracts run check | 1 | NOT_TESTED: unavailable pnpm |
| pnpm --filter @gobadminton/api run test:integration -- test/integration/venue-cover-credit.test.ts test/integration/venue-cover.test.ts test/integration/migration.smoke.test.ts | 1 | NOT_TESTED: unavailable pnpm |

The API runner never reached the database: DB availability was not tested.
The new integration suite requires RUN_DB_INTEGRATION=1 and a disposable loopback
PostGIS DATABASE_URL; it creates and drops its own database. A skipped suite is not PASS.
CI / independent QA must run the required checks with provisioned tooling and DB.
The tests cover shape failures, valid kinds and boundaries, key-change semantics,
public detail/catalog visibility and guarded rollback. No full suite was attempted.

## STYLE_GUIDE_PARITY

Parity: UNVERIFIED.
Authority: docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md,
frozen Make #guide / #construction-kit.
Reused family: Foundation meta typography / attribution adjacent to a media block,
using inline --c23-meta, --c23-meta-lh and --gb-text-secondary as assigned.
Screen composition: existing venue media block retained, attribution immediately after it.
No CSS, cover renderer or map changes.
STYLE_GUIDE_GAP: none claimed. OWNER_VISUAL_OVERRIDE: none claimed.
The referenced docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md is absent from
this checkout; frozen Make visual parity could not be verified offline.

## Rollback and next action

Source rollback: remove this task's diff through the authorized delivery process.
Schema rollback: execute migrations/rollback/0037_venue_cover_credit.sql in a transaction
only after all three attribution columns are NULL for every venue. Populated attribution
causes SQLSTATE 23514. Rollback drops only the new trigger/function/constraint/columns
and 0037 ledger record. API rollback can retain this additive schema.

Next bounded action: independent QA of the candidate diff and required checks.
No next implementation slice is authorized here. The DEV attribution appears after I1
populates covers/credits; that population is not an M6 gate.
