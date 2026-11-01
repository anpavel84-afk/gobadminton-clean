# Owner #448 — CI database repair (migration flush + fixture defaults)

From: Cursor Auto (`OWNER_SOCIAL448_CI_DATABASE_REPAIR`, attempt 1, base `3858cc8404e50cac26f27ddf7ef4428c92b49f36`).
To: independent Codex Sol Medium delta-QA → mandatory Product CI → trusted DEV → Owner UAT.
Status: SOURCE CANDIDATE. **UAT = NOT_TESTED**. Refs #448 / PR449.
No Git/runtime/root/PROD by author. Deployment NOT DONE.

## CI FAIL preserved (PR449 database)

Product CI database job failed while Source/API/web/admin/contracts/foundation PASS.
Actual log: `ci-database.log` (SHA256 `ea04b692…`). Synthetic receipt/rollback ERROR lines from passing tests ignored.

| Class | Finding | This pass |
| --- | --- | --- |
| A | Populated upgrade (`avatar-moderation-migration`, `friends-s1`) fails in 0049: `cannot ALTER TABLE player_social_profiles because it has pending trigger events` after provenance UPDATEs under native BEGIN/COMMIT | **Fixed** — `SET CONSTRAINTS ALL IMMEDIATE` before later DDL (same pattern as 0040) |
| B | Fixtures assumed virtual getOwn v0 / directory OFF; Owner #448 materializes physical ON v1 → 404→200, 409 cascades, provenance check violations | **Fixed** in allowed test files only |

## Repair A — migration ordering

`0049_social_profile_defaults.sql`: after legacy provenance labeling UPDATEs, flush deferred constraint triggers (`players_query_revision_change` DEFERRABLE INITIALLY DEFERRED) via `SET CONSTRAINTS ALL IMMEDIATE` before `ALTER COLUMN … SET DEFAULT/NOT NULL` and constraint DDL. Does **not** disable triggers, replication role, or clear ledger. Data/backfill predicates/OFF/consent/Radar guards unchanged. Old migrations/rollback/RootOps untouched.

## Repair B — fixtures only (policy/auth/guards unchanged)

- **cover-upload**: after upload, explicit visibility API hide before owner-only 404; public restore SQL sets `user_consent` provenance + stamps.
- **ls03**: SQL restore after opt-out sets `owner_default` provenance; getOwn expects v1/ON; closed contact retention intact (no directory/epoch bump from DM close).
- **lsr1**: materialized Owner ON bootstrap (account displayName, no fake city/consent); radar patch uses actual version.
- **lsr2**: synthetic peers inserted PRIVATE (`directory_visible=false`, `user_opt_out`, `closed`); target restore SQL sets truthful provenance.
- **migration.smoke**: registry includes `0049_social_profile_defaults` (no skipped upgrade checks).
- **owner-a**: OAuth/getOwn uses actual version → city save 200; directory ON expectations; venue bootstrap no longer cascades `VENUE_ID_INVALID`; private preference independence vs game ops retained.
- **p2**: baseline social rows after OAuth, compare after preference put (not zero-count); other city via UPDATE; consent restore sets provenance.
- **radar.demo-activation**: fetch own version before consent patch (avoids 409 after materialization).

## Author checks (this pass)

- Model environment: no disposable PostGIS — full suite **not executed** here.
- Operator: import candidate → targeted disposable runs of the failed files above → independent delta-QA → mandatory Product CI.
- No product time/venue/auth logic edits; no new test framework/matrix; no Git/liveDB/runtime/PROD/root/credentials.

## Changed paths (exact allowed only)

- `apps/api/migrations/0049_social_profile_defaults.sql`
- `docs/handoffs/social448-defaults.md`
- `apps/api/test/integration/cover-upload.test.ts`
- `apps/api/test/integration/ls03.text-dm.test.ts`
- `apps/api/test/integration/lsr1.radar-presence.test.ts`
- `apps/api/test/integration/lsr2.radar-contact-recovery.test.ts`
- `apps/api/test/integration/migration.smoke.test.ts`
- `apps/api/test/integration/owner-a.create-setup.test.ts`
- `apps/api/test/integration/p2.discovery-preferences.test.ts`
- `apps/api/test/integration/radar.demo-activation.test.ts`

Unchanged allowed paths (migration flush sufficient): `avatar-moderation-migration.test.ts`, `friends-s1.disposable.test.ts`.

## Input materials read

| Material | Delivered path | SHA256 | Read |
| --- | --- | --- | --- |
| CI database FAIL log | `…/design-inputs/ci-database.log` | `ea04b692a5537076ca34e82cf58ea4e19d5a62cfadd64ee05b8502bae87f2c72` | Yes — FAIL/testcases only |

## Non-goals / unresolved

- No Astra/High; no disable tests/security/gates; no PROD; no old migration/rollback edits.
- Author did not run disposable DB checks (no deps/socket here) — operator must.
- Unresolved: none specific beyond operator execution of targeted failed files + CI.
