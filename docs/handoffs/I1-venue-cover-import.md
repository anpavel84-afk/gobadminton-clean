# I1 — reviewed venue cover batch import

From: source author. To: independent QA / PM. Date: 2026-10-19.
Status: WORKING_DRAFT, source-only candidate; NOT APPROVED, no independent QA.
Assignment: issue-109, immutable GOBADMINTON_AUTONOMY_V1 I1, DEV only.
Requested base: `6dd3972d7e5ff237b68878980fc4d11beeecda66`.
Actual supplied HEAD: `687fa9229dfa2cb9eb0bcf5d630e8b2b2c4c1ec1`, branch `automation/issue-109` (also labelled automation/issue-108).
Continued on the supplied checkout as explicitly instructed; no Git metadata changes.
Base reference: https://github.com/anpavel84-afk/gobadminton-clean/tree/687fa9229dfa2cb9eb0bcf5d630e8b2b2c4c1ec1
No candidate commit/permalink exists: commit, push, publication and network are forbidden in this source-author assignment. Authorized delivery must retain this handoff with the source diff in GitHub.

## Scope and source

New files only: `apps/api/src/venues/venue-cover-import.ts`,
`apps/api/src/database/import-venue-covers.ts`, the corresponding new unit/integration
`venue-cover-import.test.ts` files, and this handoff. No package/dependency/schema,
contract, frontend, map, automation, service or PROD changes.

Pure core validates strict JSON shapes, credit rules, bytes/hash and plans empty
eligible venues. File adapter uses canonical directory, basename-only paths,
O_NOFOLLOW, regular-file checks and bounded reads. Entire batch is validated before
DB access or staging. Original bytes are retained in memory so later path changes
do not substitute the reviewed image.
Digest: SHA-256 of each manifest item's sha256 converted to lowercase, sorted
ascending, joined with a single LF (`\n`); no trailing LF. Empty batch hashes the
empty string. Digest output is lowercase hexadecimal.

M6 names used: `cover_credit_kind`, `cover_credit_text`, `cover_credit_url`, CHECK
`venue_cover_credit_shape`, trigger `venue_cover_credit_reset` calling
`clear_stale_venue_cover_credit()`. URL length is additionally bounded to M6's 300
characters. All three credit columns and cover_key are assigned in ONE UPDATE.
The trigger preserves newly supplied credit because only empty covers/credits are
eligible; existing keys OR existing credit kinds are skipped.

CLI environment guards run before batch read/DB access: mvp/stage, exact
https://dev.gobadminton.ru, configured AVATAR_MEDIA_ROOT, OpenAI provider only.
Normal loadEnv additionally validates real provider credentials. No fake-provider
CLI bypass. Core permits injected existing services for local test fixtures.
Actor requires an active principal, active superadmin grant and active user;
transaction rechecks authority under the shared admin authority advisory lock.
No sessions, users, grants or other authority are created.

Uses existing sanitizeAvatar cover processing, moderation approveImage/bindImage,
AvatarService stage/verifyStage/releaseStage and adminTransaction/appendAudit.
Staging precedes moderation here so a moderation refusal has a released GC journal
entry, as required by C3. This differs from VenueCoverService's approve-before-stage
ordering; neither provider nor sanitization runs under the publish transaction.
verifyStage stays inside the publish transaction, matching VenueCoverService:
its journal row lock must protect actual staged bytes until publish commits.
No lifecycle hooks/collector are started by the CLI.

Each venue has its own publish transaction: authority recheck, venue lock,
eligibility recheck, bound approval, combined cover/credit/version update,
GC journal consumption, audit and venue_admin_actions. Failure rolls back that
transaction and releases its stage for the ordinary collector. Moderation's existing
rate-budget/approval bookkeeping is outside this publish transaction. Refusal and
other failures continue to later rows. Any FAILED makes exit code 1.
Reruns skip occupied venues before touching provider/storage. Concurrent publishers
are rechecked under the venue lock. basis_note exists only in audit after_diff;
stdout contains only venueId/name/kind/action/reason, totals and digest. Error
messages, input paths, credentials and basis_note are not printed. Recognized
moderation problem codes are retained; other errors use IMPORT_ROW_FAILED.

## Operator runbook (DEV only; not executed)

Ops supplies a reviewed directory mounted inside the DEV API container. Do not put
images or the manifest into Git. Confirm the directory is read-only to untrusted
writers. Manifest is a regular basename file <=256 KiB with schema
VENUE_COVER_BATCH_V1, batch [a-z0-9-]{1,40}, matching count <=50, and unique items:
venueId UUID, file exactly venueId.jpg, sha256 hex64, kind photo/logo/illustration,
credit_text <=120 characters, source_page_url HTTPS <=300 or null, basis_note <=600.
Photo text starts `Фото: `, logo `Логотип: `, both require a URL. Illustration text
is exactly `Иллюстрация` with null URL. Each image is a regular JPEG <=2 MiB.

After the normal reviewed build/delivery, inside the existing DEV API container:

```sh
node dist/database/import-venue-covers.js --dir /reviewed-covers --manifest batch.json --actor-principal-id <active-superadmin-principal-uuid>
```

Review each READY/SKIPPED/FAILED row and the digest against the reviewed batch.
Dry-run writes no DB rows/files and invokes no provider; it performs read/authority
checks only. READY means planned, not imported. Then, in the same DEV container:

```sh
node dist/database/import-venue-covers.js --dir /reviewed-covers --manifest batch.json --actor-principal-id <active-superadmin-principal-uuid> --apply
```

Expected JSON Lines: `{venueId,name,kind,action:"APPLIED",reason:"IMPORTED"}`
or SKIPPED (EXISTING_COVER / VENUE_INELIGIBLE) or FAILED with a safe code.
Last line: `{totals:{APPLIED,SKIPPED,FAILED,READY},digest:"<hex64>"}`.
Unknown IDs are FAILED/VENUE_NOT_FOUND. Nonzero failures require review; successful
rows remain committed. Rerun safely skips them. Environment/manifest/authority
failure aborts before import writes, prints VENUE_COVER_IMPORT_REFUSED and exits 1.
Build output is `dist/database/import-venue-covers.js` under the existing build config.

Revert imported covers using the existing authenticated admin cover DELETE command
with the current expectedVersion; M6 clears the credit with the key. This is a new
normal audited mutation, not history deletion. Never restore the whole database.
Source revert: authorized delivery removes these five new files; no migration exists.

## Required author checks / evidence

All five commands attempted with COREPACK_ENABLE_NETWORK=0; every command exited 1
before its package script ran. Corepack's exact reason:
`Network access disabled by the environment; can't reach https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz`.
pnpm 10.18.0 is unavailable locally. No installation/download was attempted.

| Command (all prefixed COREPACK_ENABLE_NETWORK=0) | Exit | Status |
| --- | --- | --- |
| pnpm --filter @gobadminton/api run typecheck | 1 | NOT_TESTED: unavailable pnpm |
| pnpm --filter @gobadminton/api run lint | 1 | NOT_TESTED: unavailable pnpm |
| pnpm --filter @gobadminton/api run build | 1 | NOT_TESTED: unavailable pnpm |
| pnpm --filter @gobadminton/api run test:unit -- test/unit/venue-cover-import.test.ts | 1 | NOT_TESTED: unavailable pnpm |
| pnpm --filter @gobadminton/api run test:integration -- test/integration/venue-cover-import.test.ts | 1 | NOT_TESTED: unavailable pnpm |

Tests generate JPEG fixtures using sharp and commit no binaries. Integration suite
is opt-in RUN_DB_INTEGRATION=1, requires a loopback disposable PostGIS connection,
creates/drops its own database and uses a temporary media root with the existing
NODE_ENV=test / APP_ENV=local fake provider. No DB connection was attempted here;
DB availability is NOT_TESTED. No full suite or independent self-QA was performed.
Live provider, real storage, DEV data, built executable and real container execution:
NOT_TESTED. Test source is evidence of intended coverage, not a passing result.

## Continuity / next bounded action

PM delivers this source-only diff and handoff as one versioned GitHub candidate;
independent QA runs strict typecheck, lint, build and only these new test files with
provisioned tooling and a disposable DB, including review of the documented staging
order. No permission for another implementation slice or DEV population follows
from this handoff. PROD remains outside scope.

## Revision after independent QA FAIL (source attempt 2)

Source base / reviewed revision: `ec76598b6439cdefd5845cde88654e2a681eb272`.
Reference: https://github.com/anpavel84-afk/gobadminton-clean/commit/ec76598b6439cdefd5845cde88654e2a681eb272
This revision changes only the integration test and this handoff. The earlier
supplied-HEAD note above describes attempt 1, not this revision's base.

Addressed findings in source:
- Venue fixture INSERT now uses separate `$4`/`$5` text parameters for
  normalized_name/normalized_address; `$1` is used only for the UUID ID.
- Actor rejection tests call CLI `main` with parsed arguments and `--apply`, a
  regular empty manifest, the disposable database URL and DEV guard-compatible
  environment. Missing active superadmin grant, suspended principal and inactive
  user must each reject with IMPORT_ACTOR_REFUSED. Snapshots assert unchanged
  venue/action/audit rows, stage/approval counts and media directory entries.
  The CLI uses its real OpenAI adapter with a synthetic unused key; an empty
  batch and actor rejection require no provider request. The core integration
  cases retain local test fake-provider rules. No CLI fake bypass was added.

C6 commands were reattempted with COREPACK_ENABLE_NETWORK=0 in this revision:

| Command (prefix COREPACK_ENABLE_NETWORK=0) | Exit | Result |
| --- | --- | --- |
| pnpm --filter @gobadminton/api run typecheck | 1 | NOT_TESTED: unavailable pnpm |
| pnpm --filter @gobadminton/api run lint | 1 | NOT_TESTED: unavailable pnpm |
| pnpm --filter @gobadminton/api run build | 1 | NOT_TESTED: unavailable pnpm |
| pnpm --filter @gobadminton/api run test:unit -- test/unit/venue-cover-import.test.ts | 1 | NOT_TESTED: unavailable pnpm |
| pnpm --filter @gobadminton/api run test:integration -- test/integration/venue-cover-import.test.ts | 1 | NOT_TESTED: unavailable pnpm |

Every command stopped before its package script with the exact reason:
`Network access disabled by the environment; can't reach https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz`.
No download, DB execution, live provider, real storage or DEV data verification
occurred. These remain NOT_TESTED. No independent self-QA was performed.
Rollback of this revision: discard only this revision's two-file diff through the
authorized delivery process. No commit/push/publication or Git metadata mutation
was performed. Next recipient: independent QA via authorized external delivery;
re-run C6 with provisioned offline tooling and disposable PostGIS before acceptance.
