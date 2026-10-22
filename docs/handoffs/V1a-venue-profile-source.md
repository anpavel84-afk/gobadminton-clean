# V1a venue profile source — #170

- From: assigned GoBadminton source author (Codex), 2026-10-22.
- To: integrator / NEW independent read-only source QA session.
- Status: **UNVERIFIED — source candidate only**. Prior candidate failed
  independent source QA; the correction below awaits a new independent review.
  No admission, acceptance, deployment or full-gallery completion is asserted.
- Product record: https://github.com/anpavel84-afk/gobadminton-clean/issues/170.
- Exact accepted DEV base / initial author HEAD: `865d02c7ea39ae8210172629c3cb8e20c8fa52a8`;
  [base source](https://github.com/anpavel84-afk/gobadminton-clean/tree/865d02c7ea39ae8210172629c3cb8e20c8fa52a8).
- Branch observed: `automation/issue-170`; worktree
  `/srv/gb-slots/slot1/worktrees/issue-170`, initially clean.
- Actual candidate commit/permalinks: **NOT PUBLISHED / not available**. Author
  was explicitly forbidden Git mutations/publication. Never substitute base SHA
  for candidate SHA. Integrator must publish the actual source/body/handoff as a
  versioned GitHub record tied to #170 and supply its exact commit/permalinks.

## Assignment and authority record

The supplied immutable `GOBADMINTON_AUTONOMY_V1` task for #170 is the bounded
source-only assignment, target dev. It allows only the 13 paths below, source/test/
doc edits and the listed offline author checks. It forbids commits/push/Git
metadata changes, other models, DB/SQL/migration execution, runtime/services,
network/dependency installation, automation/config changes, secrets, deployment
and PROD. It does not authorize another task or acceptance. Prior independent
QA supplied with the initial assignment was `{}`; the follow-up assignment
supplied the FAIL recorded below. Canonical rules/Owner decisions,
manifest/bootstrap/module boundaries, ChatOps/onboarding, API docs and the
V1a/V1b/V3b/V2 backlog snapshot were read from this checkout.

Owner-approved **product scope** is one coherent venue profile + organization
contacts model/API (V1a). The trigger/projection/validation/compatibility details
below are **proposed technical source choices** within that scope, not new Owner
product facts or an acceptance decision. V1b consumer UI, V3b admin UI, V2 real
contact import and Friends/operational FR-2 stay separate. No frontend work or
new visual pattern, game/Radar changes, permission expansion or media platform.
Assigned exclusions are api:venues, db:migrations, schema-contracts. The integrator
must preserve schema-contracts file occupancy exclusion with #149; this is not a
product dependency on149. No other slot, private runtime state or forbidden path
was opened, and no lock/automation metadata was changed by this author.

## Changed artifacts

Only these assigned paths form the candidate; NEW markers distinguish new files:

1. NEW [migration0039](../../apps/api/migrations/0039_venue_public_profile.sql):
   additive facts/date + venue-owned trigger; historical migrations untouched.
2. [schema mirror](../../apps/api/src/database/schema.ts): nullable columns and
   matching nonnegative court-count CHECK.
3. NEW [shared profile](../../apps/api/src/venues/venue-profile.ts): strict bounded
   edit schema, complete safe mapper and N-1 per-key SQL projection helper.
4. [admin DTO](../../apps/api/src/admin/venues.dto.ts): profile on edit only.
5. [admin venue service](../../apps/api/src/venues/admin-venues.service.ts):
   profile on list/detail/receipts, existing moderated URL projection, bounded
   preserve/clear/replace SQL bindings within the existing transaction.
6. [public venue service](../../apps/api/src/venues/venues.service.ts): same mapper
   on catalog, alias/detail, fuzzy, proposal/reuse/INSERT RETURNING.
7. [OpenAPI](../../packages/contracts/openapi.json): VenueProfile/VenueProfileEdit,
   optional full Venue/AdminVenue extension, strict edit, existing cityName.
8. NEW [unit tests](../../apps/api/test/unit/venue-profile.test.ts): production
   validators/mappers/service SQL bindings with typed fakes; actual service
   output/command fixtures checked against actual OpenAPI using existing AJV.
9. NEW [DB integration tests](../../apps/api/test/integration/venue-profile.test.ts):
   authored only; RUN_DB_INTEGRATION=1 gate, synthetic test/local/loopback guard,
   isolated random databases and cleanup. Never executed by source author.
10. [migration smoke](../../apps/api/test/integration/migration.smoke.test.ts):
    ledger0039 plus physical columns/CHECK/trigger; prior assertions retained.
11. [API policy](../api/API_POLICY.md): public semantics/compatibility/privacy.
12. [admin API](../api/P4_ADMIN_VENUES.md): strict edit/date/gallery/security.
13. NEW this handoff: reproducible source record, evidence and next action.

## Field and write semantics

Every current full Venue/AdminVenue response emits:

```json
{"courtCount":null,"amenities":{"parking":null,"showers":null},"updatedAt":null,"gallery":{"coverage":"cover_only","items":[]}}
```

`court_count` is nullable PostgreSQL integer with CHECK >=0; DTO bound matches
0..2147483647. `amenity_parking`/`amenity_showers` are nullable booleans. NULL is
unknown; 0/false are explicit known facts and survive mapping/binding. No defaults,
legacy backfill, private-contact copy, data inference from games/names/demo data,
or real factual import. No established rating/review-count source exists; no
rating/review/count fields or computations are added.

Existing admin edit only accepts optional `profile`: omission preserves all
three facts, null clears all three SQL values, complete strict object replaces.
Object requires courtCount and amenities; amenities requires parking and showers.
No coercion or unknown/private/read-only keys. updatedAt/gallery are server-owned
and rejected as input. Create/propose inputs remain unchanged. No arbitrary
media URL write. Existing admin cookie/exact Origin/CSRF/current venue.manage/
fresh step-up/CAS409/idempotent replay/catalog locks/identity collision review
continue. Collision leaves venue/profile/version unchanged and commits only the
existing audited review metadata. Audit/outbox never contain profile/contact
payloads. Command/audit/history/outbox/receipt failure rolls all venue changes,
date and effects back in the existing transaction.

## Public date and gallery limits

The BEFORE INSERT/UPDATE trigger generates DB clock time at insertion or actual
stored change of name/address/timezone/location/identity discriminator,
public_contacts, facts, cover binding or credit. PostgreSQL name ordering runs
it after existing cover-credit reset. Null-safe comparison of stored normalized
values preserves the old date for equivalent normalized public input, no-op/
omission, private-only edit, provenance/version/lifecycle-only write and replay.
Legacy rows retain NULL until a tracked content change. Trigger ignores supplied
dates; no private contact_updated_at/generic updated_at is reused.

Meaning: last recorded stored public-profile **content edit since0039**, not
verification, factual freshness/import time or every dynamic moderation visibility
change. A moderation-decision-only change does not touch the venue date; an
inactive actor's existing retirement trigger that clears a cover does change
stored public content and therefore the date. Replay returns its stored snapshot.

Gallery always says coverage=cover_only, with zero or one actual current owned
cover returned by venue_cover_url and classified photo with nonempty text and
safe HTTPS attribution, retaining its credit. Denied moderation/inactive actor/
venue retirement/no cover/replacement/removal/logo/illustration/unclassified or
unsafe credit means no eligible photo. Existing cover behavior is retained.
No generated pictures, gallery total, rating, review count or full-gallery claim.
Empty items do not say a complete gallery was checked. A real multi-photo gallery
is an explicit residual of the single-cover platform, not implemented here.

## Preserved privacy and compatibility

Public organization contacts come **only** from public_contacts through existing
#142 validator/reader. Phone: trim after rejecting controls, 7–15 ASCII digits,
max40 chars and existing ASCII punctuation, no country-code guessing. URL:
WHATWG HTTP(S)/IDN serialization, canonical href length<=300, no controls,
backslash, credentials or nondefault port. Messengers: unique kinds, HTTPS
whitelist t.me/wa.me/vk.com and non-root normalized path. Tolerant reads null
invalid neighbors/filter invalid messengers. Private contactPhone/contactWebsite/
bookingNote are never republished. #82 remains active owner/manager or confirmed
participant of **THAT game only**; all other viewers omit private keys. No
Game/VenueSummary/Unified/Radar schema/projection changes.

Per-key to_jsonb extraction makes schema0037 missing columns NULL without SQL
parse-time new-column references. Catalog lifecycle/order/limit and canonical
alias resolution are preserved. Old API explicit SQL still works on additive
schema; old responses/receipts may omit profile. AdminVenue.cityName, already
emitted, is now declared under additionalProperties:false and retained.

Current generators cover Game/Participation/CreateGame-related, Unified* and
Friendship* closures, excluding full Venue/AdminVenue/AdminVenueCommand. No new
generator or fabricated generated edit. Runtime-vs-OpenAPI AJV assertions cover
this currently ungenerated surface, representative actual service results and
strict edit fixtures, including negative types/bounds/private/read-only keys.

## Authored coverage, not executed evidence

Unit source exercises validation and safe/tolerant mapping, explicit 0/false,
unknown/null values, current photo eligibility/unsafe attribution, #142 phone/URL/
messenger regressions; typed service fakes check catalog/canonical aliases/fuzzy/
reuse/INSERT RETURNING, shared projections, admin list/detail/edit receipt,
omission/null/replacement, CAS/collision no-write and metadata-only audit/outbox.
AJV loads the actual updated OpenAPI and validates actual mapped service results
and admin edit fixtures, plus negative cases and optional old response bodies.

New integration suite is **AUTHORED ONLY / NOT EXECUTED**. It describes fresh
schema/no-default/check/bounds and forged-date prevention; schema0037 public reads;
0038→0039 upgrade seeded with legacy public and private contacts, legacy NULL
date, real ledger-runner rerun preservation, old API SQL on additive schema;
admin cookie/Origin/CSRF/step-up/current-role revocation before replay, version
and collision no-write; normalized/no-op/private/lifecycle/public-content date
cases; real moderated photo/credit, replacement/removal/denial/inactive actor/
retirement; command/audit/history/outbox/receipt failure atomic rollback. Existing
#82/#142 venue-contacts DB cases remain unchanged and must also run in hosted CI.
No authored case or skip is independent QA or a PASS.

## Initial offline author command evidence

All commands were invoked from repository root with `COREPACK_ENABLE_NETWORK=0`.
No installation or network fallback was attempted. At this author environment,
Corepack cannot find locally available pnpm10.18.0. Each pnpm command below
exited1 before the requested compiler/linter/test/check could execute, with:

```text
! Corepack is about to download https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz
Network access disabled by the environment; can't reach https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz
```

| Command (each prefixed COREPACK_ENABLE_NETWORK=0) | Exit / disposition |
| --- | --- |
| `pnpm --filter @gobadminton/api exec tsc -p tsconfig.json --noEmit` | 1; NOT_TESTED: unavailable offline pnpm, compiler never started |
| `pnpm --filter @gobadminton/api run lint` | 1; NOT_TESTED: same Corepack reason, linter never started |
| `RUN_DB_INTEGRATION=0 pnpm --filter @gobadminton/api exec vitest run --project unit --no-cache test/unit/venue-profile.test.ts` | 1; NOT_TESTED: same reason, unit/AJV tests never started |
| `RUN_DB_INTEGRATION=0 pnpm --filter @gobadminton/api exec vitest run --project integration --no-cache test/integration/venue-contacts.test.ts` | 1; NOT_TESTED: same reason, existing ungated offline cases never started; DB cases not executed |
| `pnpm run check:contracts` | 1; NOT_TESTED: same reason; contract check never started |
| `python3 scripts/check_foundation.py` | Initial exit1 while this referenced handoff was not yet created; final exit0 after file creation |
| `node packages/contracts/scripts/generate-game-types.mjs` | 0; `Game types verified: .../packages/contracts/src/game.generated.ts` |
| `node packages/contracts/scripts/generate-unified-types.mjs` | 0; `Unified types verified: .../packages/contracts/src/unified.generated.ts` |
| `node packages/contracts/scripts/generate-friendship-types.mjs` | 0; `Friendship types verified: .../packages/contracts/src/friendship.generated.ts` |

All three generators ran individually with their default read-only behavior,
WITHOUT --write, and verified byte equality with current generated source.
These successful narrow checks do not substitute for the unexecuted contract,
compiler, lint, tests, independent QA or release gates.

Final Foundation invocation exited0:

```text
FOUNDATION STATIC CHECK: PASS (227 Markdown files, 168 draft API operations)
Scope: local paths, required files, JSON/local refs and bounded contract rules only.
Not runtime, full OpenAPI validation, independent QA, deployment or store approval.
```

NOT_TESTED by assignment: RUN_DB_INTEGRATION=1, SQL/migrations/real DB, runtime,
full source/database/restore/actual old-image compatibility gates, hosted CI,
DEV/PROD effects and independent QA. No gate was skipped by weakening its source.
Existing Actions/integrator must run unchanged full gates against the actual
candidate before release, including all new and existing integration suites.

## Independent QA finding correction — 2026-10-22

Follow-up began on clean branch `automation/issue-170`, exact observed HEAD and
independently reviewed source `8d6ea56834cf116e2996bc96e3879b5ee990ce09`
([reviewed source](https://github.com/anpavel84-afk/gobadminton-clean/tree/8d6ea56834cf116e2996bc96e3879b5ee990ce09)).
Supplied independent QA verdict: **FAIL**, one P2 finding at
`apps/api/test/integration/venue-profile.test.ts:108`: the fresh-schema INSERT
omitted `lifecycle_state`, which migration0018 makes NOT NULL without a default,
so PostgreSQL23502 would prevent the date/default/bounds assertions from running.
That QA did not execute database tests.

Correction: the INSERT now explicitly supplies the valid `unverified` lifecycle
state. Forged-date prevention, nullable/no-default facts and bounds assertions
are retained. Only that integration-test fixture and this handoff changed in
this follow-up; production source, migrations and contract remain unchanged.
Rollback of this follow-up is the bounded reversal of those two file diffs;
application rollback semantics above remain unchanged. No Git mutation or
publication was performed; the corrected candidate SHA/permalinks must be
supplied by the integrator after publication, not inferred from reviewed HEAD.

All eight pnpm/node commands listed in the initial evidence table were invoked
again from repository root with `COREPACK_ENABLE_NETWORK=0`, unchanged arguments
and `RUN_DB_INTEGRATION=0` on both Vitest commands. The five pnpm commands each
exited1 with the exact same Corepack/network-disabled output quoted above:
typecheck, lint, unit/AJV, offline venue-contacts cases and contract check remain
**NOT_TESTED** because pnpm10.18.0 is unavailable offline. No dependency was
installed and no network fallback attempted. Each of the three individual
read-only node generators exited0 with its respective `types verified` output
and no `--write`; all generated bytes remain unchanged.

`COREPACK_ENABLE_NETWORK=0 python3 scripts/check_foundation.py` was rerun after
this handoff update: exit0, `FOUNDATION STATIC CHECK: PASS (228 Markdown files,
168 draft API operations)`. This is the same bounded static check described
above, not independent QA or runtime evidence. DB suites, SQL/migrations,
services, restore/actual-old-image/hosted gates remain **NOT_TESTED** under the
source-only assignment. The fixture correction is authored, not a demonstrated
database-test success; a NEW independent read-only review must assess the actual
corrected candidate before integrator-owned unchanged full gates and release.

## Latest independent QA corrections — reviewed a7e2a4c, 2026-10-22

This follow-up started with a clean worktree on `automation/issue-170`, observed
HEAD `a7e2a4ce466649021c2f4b7b6b9cdbe3d4dd3349`, exactly the supplied independent
QA reviewed SHA
([reviewed source](https://github.com/anpavel84-afk/gobadminton-clean/tree/a7e2a4ce466649021c2f4b7b6b9cdbe3d4dd3349)).
The accepted DEV base remains `865d02c7ea39ae8210172629c3cb8e20c8fa52a8`.
Supplied verdict: **FAIL**, with two P2 findings:

1. `readVenueProfile` validated WHATWG-normalized attribution but returned the
   original string. Existing cover storage permits `https://example.com/a b`;
   emitting that literal space violates VenueProfile's OpenAPI `format: uri`.
2. Unit/integration test imports of AdminService, IdempotencyService and
   MutationRunner were value imports used only as types. QA reported the
   consistent-type-imports violation; its lint command was NOT_TESTED because
   pnpm10.18.0/dependencies were unavailable offline.

The shared production mapper now also validates the exact emitted attribution
with the existing AJV/ajv-formats URI validator, compiled once. It retains the
existing HTTPS safety checks and preserves valid original credit bytes, including
an HTTPS URL without a trailing slash and properly percent-encoded paths. A
normalizable but invalid URI causes empty gallery items, with no silent credit
rewrite. Public-contact normalization and existing cover behavior are preserved.
Both venue services already use this mapper. The identified test imports now
use `import type`.

The new runtime-versus-OpenAPI unit regression authors literal-space, raw Unicode,
pipe and malformed-percent attribution cases. It demonstrates the contract's URI
rejection of those credits and requires production public detail/catalog and
admin list responses to exclude their gallery item and validate against the
actual full Venue/AdminVenue schemas. Positive cases require unchanged valid
credits, including percent encoding. These assertions are **authored but not
executed**, and are not independent QA evidence.

This follow-up changes exactly six allowed paths: shared profile mapper, unit
profile tests, integration profile test imports, both existing API docs, and this
handoff. No migration/schema/contract/generated bytes or automation were edited.
The earlier lifecycle fixture correction remains in place. Rollback for this
follow-up is reversal of these six local diffs after preserving the candidate;
application rollback still retains additive schema/data/trigger. No commits,
pushes, Git metadata writes, other models, DB execution or publication occurred.
The reviewed SHA is not the corrected candidate SHA; integrator must supply the
actual candidate revision/permalinks after its authorized publication.

The following commands were each invoked from repository root in this follow-up.
Every command had `COREPACK_ENABLE_NETWORK=0`; neither generator used `--write`.

| Command (prefix COREPACK_ENABLE_NETWORK=0) | Exit / actual result |
| --- | --- |
| `pnpm --filter @gobadminton/api exec tsc -p tsconfig.json --noEmit` | 1; NOT_TESTED: Corepack reason below, compiler never started |
| `pnpm --filter @gobadminton/api run lint` | 1; NOT_TESTED: same reason, linter never started |
| `RUN_DB_INTEGRATION=0 pnpm --filter @gobadminton/api exec vitest run --project unit --no-cache test/unit/venue-profile.test.ts` | 1; NOT_TESTED: same reason, unit/AJV suite never started |
| `RUN_DB_INTEGRATION=0 pnpm --filter @gobadminton/api exec vitest run --project integration --no-cache test/integration/venue-contacts.test.ts` | 1; NOT_TESTED: same reason, existing ungated offline cases never started |
| `pnpm run check:contracts` | 1; NOT_TESTED: same reason, contract check never started |
| `node packages/contracts/scripts/generate-game-types.mjs` | 0; `Game types verified: /srv/gb-slots/slot1/worktrees/issue-170/packages/contracts/src/game.generated.ts` |
| `node packages/contracts/scripts/generate-unified-types.mjs` | 0; `Unified types verified: /srv/gb-slots/slot1/worktrees/issue-170/packages/contracts/src/unified.generated.ts` |
| `node packages/contracts/scripts/generate-friendship-types.mjs` | 0; `Friendship types verified: /srv/gb-slots/slot1/worktrees/issue-170/packages/contracts/src/friendship.generated.ts` |
| `python3 scripts/check_foundation.py` | 0; `FOUNDATION STATIC CHECK: PASS (228 Markdown files, 168 draft API operations)`; bounded static check only |

All five pnpm commands returned exactly:

```text
! Corepack is about to download https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz
Network access disabled by the environment; can't reach https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz
```

No install/network fallback was attempted. RUN_DB_INTEGRATION=1 and all DB/SQL/
migrations, runtime/services, full source/database/restore/actual old-image,
hosted CI and release gates remain **NOT_TESTED** here. No check was weakened.
The corrected source remains **UNVERIFIED**, pending a NEW independent read-only
source QA session and integrator-owned unchanged full gates on the actual
candidate before release. Neither the successful narrow generator checks nor
the authored regression constitutes acceptance, admission or deployment.

## Rollback and next bounded action

Application rollback retains migration0039 additive columns, data and trigger;
old API explicit SQL continues. Do not run destructive down migrations, erase
facts/public contacts or copy private contacts. Historical migrations remain
immutable. Pre-publication source can be reverted only within these assigned
paths by the authorized integrator after preserving this candidate; do not
reset/overwrite unrelated concurrent work.

Next action: integrator preserves this exact uncommitted source as a versioned
GitHub candidate tied to #170, publishes the immutable task body + this handoff
with actual candidate SHA/permalinks, and hands that exact candidate to a NEW
independent read-only source QA session. QA never implements fixes. Integrator/
hosted CI then runs the required unchanged checks, full disposable DB/restore
and actual old-image gates, attaching evidence to that revision. Fix findings
only under the bounded assignment; do not advance to V1b/V3b/V2/FR-2 or declare
admission/acceptance/DEV release from this handoff. Owner is not the file courier.
