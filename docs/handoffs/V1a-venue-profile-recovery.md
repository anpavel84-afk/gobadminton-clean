# V1a venue profile recovery — #178

- From: assigned GoBadminton source author (Codex), 2026-10-22.
- To: existing Actions source bridge / integrator, then NEW independent QA.
- Status: **UNVERIFIED SOURCE CANDIDATE — NOT_TESTED — NOT ACCEPTED**.
- Assignment: [#178](https://github.com/anpavel84-afk/gobadminton-clean/issues/178),
  bounded V1a successor; original #170 attempt3/3 stays DEFERRED. This is not
  #170 attempt4 and does not reset attempts, leases, locks or history.
- Exact initial HEAD / supplied accepted DEV base:
  [`705db4860f3378253fe33652569ecd4664294de1`](https://github.com/anpavel84-afk/gobadminton-clean/tree/705db4860f3378253fe33652569ecd4664294de1).
- Observed branch: `automation/issue-178`; worktree:
  `/srv/gb-slots/slot1/worktrees/issue-178`; initial `git status --short` empty.
- Exact read-only reference:
  [`465db01c09b7a89bfb3a308c9abafb2561c73d90`](https://github.com/anpavel84-afk/gobadminton-clean/tree/465db01c09b7a89bfb3a308c9abafb2561c73d90),
  [original PR #173](https://github.com/anpavel84-afk/gobadminton-clean/pull/173).
  Read via local Git objects only; no checkout/reset, old-worktree access or
  modification of that PR. Original
  [source handoff](https://github.com/anpavel84-afk/gobadminton-clean/blob/465db01c09b7a89bfb3a308c9abafb2561c73d90/docs/handoffs/V1a-venue-profile-source.md)
  is historical reference, not current evidence.
- Final candidate commit / published artifact permalinks: **NOT AVAILABLE**.
  Author is forbidden Git mutations/publication. The base and reference SHAs
  above are not the new candidate SHA. The bridge must publish this source,
  task record and handoff and attach their actual immutable permalinks to #178.

## Authority and task record

Owner-approved product scope: the bounded V1a model/API recovery described below.
Implementation details are proposed source, not independent QA or acceptance.
The user supplied `Prior independent QA: {}` for this successor. The historical
#170 QA-a3 PASS and subsequent CI failures are assignment context only; neither
is a new QA verdict. No success is inferred from a previous SHA's green checks.

Canonical AGENTS/rules/record policy, Owner decisions, manifest/bootstrap,
architecture/module boundaries, ChatOps/PM route/onboarding and bounded venue/API
documents were read. The current user assignment governs this task worktree
and the narrower no-Git/no-QA effects despite older generic publication guidance.
No frontend changes; Style Guide presentation authority is not invoked.

Immutable supplied task JSON (data, not commands):

```json
{"acceptance": "V1: Reproduce complete original #170 V1a target (not only the CI fixes) from accepted DEV using original PR #173 solely as read-only reference; retain current DEV behavior and migration0039 new/additive with NULL meaning unknown, correct nullable/default semantics and integer bounds. New tests cover SQL CHECK, rollback, legacy old schema migration, public reads, admin edit/auth/version/audit and safe contacts. V2: apps/api/test/integration/venue-profile.test.ts compiles/typechecks with exact request cookie types; omit undefined-cookie entries or use typed strings without weakening auth coverage. V3: Same integration test uses valid existing content_moderation_approvals.decision enum/lifecycle to express rejected eligibility; do NOT disable SQL CHECK, drop scenario or assert fake status; verify public profile no photo, unchanged content date as appropriate. V4: Retain approved content-edit trigger behavior, cover credit URL fail-closed, N-1 compatibility, private/public contact fences, no fabricated gallery/rating/count, typed DTO and actual full Venue/AdminVenue OpenAPI projection with cityName plus existing generator read-only byte checks. V5: Restrict source to enumerated original product files and dedicated new handoff only. Offline source actor may author disposable DB tests but may not execute DB or mutate Git; record NOT_TESTED honestly. Independent NEW QA PASS, full exact-head Product CI including database and source(api) PASS, protected integration and DEV acceptance/rollback; never call success based on previous SHA's green QA. Shared schema-contracts lock with radar recovery; NOT a product depends_on.", "allowed_paths": ["apps/api/migrations/0039_venue_public_profile.sql", "apps/api/src/database/schema.ts", "apps/api/src/venues/venue-profile.ts", "apps/api/src/admin/venues.dto.ts", "apps/api/src/venues/admin-venues.service.ts", "apps/api/src/venues/venues.service.ts", "packages/contracts/openapi.json", "apps/api/test/unit/venue-profile.test.ts", "apps/api/test/integration/venue-profile.test.ts", "apps/api/test/integration/migration.smoke.test.ts", "docs/api/API_POLICY.md", "docs/api/P4_ADMIN_VENUES.md", "docs/handoffs/V1a-venue-profile-recovery.md"], "effort": "high", "goal": "OWNER-approved bounded V1a successor #178 after #170 original attempt3/3 DEFERRED. Never run #170 attempt4, edit PR #173, reset attempts, leases or history, or claim old QA PASS as new QA. Reproduce the previously independently reviewed #170 V1a product slice on fresh accepted DEV, using exact previous source commit 465db01c09b7a89bfb3a308c9abafb2561c73d90 (PR #173) as READ-ONLY Git-object reference on prior slot1. The existing slot1 repo has that object; inspect old approved hunks with git show/diff/status, port only safe necessary source to new dev base. No model Git mutating verbs/network; the existing Actions bridge handles source Git and promotion. Original source candidate QA-a3 PASS, but Product CI failed (1) TS2345 apps/api/test/integration/venue-profile.test.ts:180 because injected request has __Host-gb_admin_session?:undefined instead of string record; (2) failing disposable DB integration test at same file line219 sets content_moderation_approvals.decision to value prohibited by content_moderation_approvals_decision_check. Repair both regression TEST defects using valid typed fixtures and legitimate moderation state transitions. Do not weaken assertion or CHECK, do not bypass database tests, no fake green. Preserve all original D1-D8 invariants. Only nullable stored profile facts courtCount (0..2147483647), amenity parking/showers null/false/true, audited DB-generated public profile content updatedAt and strict cover-only eligible photo gallery, public contact separation, existing admin edit/version/idempotency/permissions, docs and migration0039. No new Gallery, ratings, venue counts, private bookingNote/contactPhone/contactWebsite exposure, arbitrary URLs, PROD or unrelated code. Independent source QA on NEW final SHA and all CI/DEV gates mandatory. No DB/network/tool installs/system runtime/secret extraction/git mutation/deploy by author/QA. Fixed approved Codex gpt-6.1-sol/high.", "kind": "source_only", "locks": ["api:venues", "db:migrations", "schema-contracts"], "max_attempts": 3, "model": "gpt-6.1-sol", "schema": "GOBADMINTON_AUTONOMY_V1", "target": "dev"}
```

Assigned exclusions are `api:venues`, `db:migrations`, `schema-contracts`. The
existing bridge/integrator must preserve shared schema-contracts exclusion with
Radar recovery (#149); it is file occupancy, **not a product depends_on**. Author
does not read private runtime lock state, acquire/reset leases or start another
writer. No automation, secret, service, install, network, deployment or PROD
effect is authorized or performed by this source change.

## Artifacts and behavior

Only the 13 enumerated paths are part of this candidate. The 12 product paths
port the complete reference slice onto the current base; the integration fixture
repairs and current assignment/document links are described below. Original
historical handoff is not copied into this worktree.

| Artifact | Source change |
| --- | --- |
| [0039 migration](../../apps/api/migrations/0039_venue_public_profile.sql) | New additive nullable facts/date; content-edit trigger; old migrations untouched. |
| [Schema mirror](../../apps/api/src/database/schema.ts) | Nullable integer/booleans/date, matching nonnegative CHECK. |
| [Shared profile](../../apps/api/src/venues/venue-profile.ts) | Strict bounded edit schema, typed safe projection, N-1 per-key SQL extraction, fail-closed exact credit URI validation. |
| [Admin edit DTO](../../apps/api/src/admin/venues.dto.ts) | Profile on existing edit only; no create/propose/media URL write. |
| [Admin service](../../apps/api/src/venues/admin-venues.service.ts) | List/detail/command projection; preserve/clear/replace bindings in existing transaction. |
| [Public service](../../apps/api/src/venues/venues.service.ts) | Shared complete profile on catalog, detail/aliases, fuzzy candidates, proposal reuse and INSERT RETURNING. |
| [OpenAPI](../../packages/contracts/openapi.json) | VenueProfile/Edit plus optional full Venue/AdminVenue extension, existing cityName and strict command edit. |
| [Unit source](../../apps/api/test/unit/venue-profile.test.ts) | Production validators/mappers/service bindings and actual full OpenAPI response/command AJV assertions. |
| [Integration source](../../apps/api/test/integration/venue-profile.test.ts) | Disposable synthetic DB scenarios, retained coverage and repaired cookie/moderation fixtures. |
| [Migration smoke](../../apps/api/test/integration/migration.smoke.test.ts) | Ledger0039, actual nullable/no-default types, CHECK and enabled trigger assertions; old assertions retained. |
| [API policy](../api/API_POLICY.md) | Public semantics, compatibility, privacy, current recovery context. |
| [Admin API](../api/P4_ADMIN_VENUES.md) | Edit/date/gallery/security behavior and current recovery context. |
| This dedicated handoff | Assignment, source/evidence boundaries, rollback and next recipient. |

Preserved original bounded invariants (not new product claims):

- Stored facts only: courtCount is NULL or integer 0..2147483647; parking/showers
  are NULL/false/true. Unknown is never inferred from names, games or demo data.
  No defaults, backfill or private-contact copy. Explicit 0/false survive.
- Existing admin edit: omission preserves all facts; null clears all three;
  complete strict object replaces. Unknown, coerced, private and read-only
  updatedAt/gallery keys are rejected. Create/propose surfaces stay unchanged.
- Existing cookie/exact Origin/CSRF/current permission/fresh step-up/CAS/replay
  authorization, catalog locks, collision no-profile-write and metadata-only
  audit/history/outbox remain in the existing transactional command path.
- DB-generated public date records actual stored public content edit after
  migration0039, following cover-credit reset. New inserts get DB time; legacy
  rows keep NULL until tracked change. No-op/equivalent normalized public input,
  omission, private-only, provenance/version/lifecycle-only writes and replay
  preserve it. Forged dates cannot override it. It is not factual freshness,
  verification/import time, generic updated_at or private contact_updated_at.
- Gallery is always `coverage=cover_only`, zero or one current owned moderated
  photo from venue_cover_url with unchanged valid HTTPS credit. Exact emitted
  URI is validated, so merely WHATWG-normalizable invalid URI bytes fail closed.
  Logo/illustration/unclassified/unsafe credit and ineligible media yield no
  photo. No arbitrary media URL, gallery total, rating or review/venue count.
- Public organization contacts come only from existing public_contacts
  validator/reader. Existing phone/URL/IDN/messenger normalization remains.
  Private contactPhone/contactWebsite/bookingNote stay confined to active
  owner/manager or confirmed participant of that game under #82; no public
  profile, list, detail, audit or outbox contact-payload exposure is introduced.
- Public N-1 per-key to_jsonb reads tolerate schema0037 missing profile/contact
  columns; old API explicit SQL can use additive schema. Contract profile is
  optional for rollout/old receipts, current responses emit complete objects.
- No Game/VenueSummary/Unified/Radar behavior, permission expansion, frontend,
  real factual import, new media platform or full-gallery completion claim.

## Two CI fixture repairs in this successor

The auth negative-request array uses the actual Fastify
`Pick<InjectOptions, "headers" | "cookies">` with an expected-status field removed
before injection. The anonymous request omits cookies entirely; authenticated
entries contain token strings. There is no undefined cookie value, `any` or type
cast to hide it. Missing cookie requires401; wrong Origin/CSRF and stale step-up
require403, and every denied write must leave venue facts/version/date unchanged.
Successful write, identical replay, and revoked-current-role replay403 remain.

The eligible-photo scenario uses existing migration0020 decisions
`allow → reject → allow`, updating checked_at for synthetic re-evaluation. The
SQL CHECK is untouched. Public rejected output must have empty cover-only
gallery, null cover URL and the original profile content date; stored date must
also remain unchanged. Re-allow must restore the same eligible photo and leave
the stored content date unchanged. Existing replacement/removal/credit/actor/
retirement scenarios remain, including the already-fixed explicit unverified
lifecycle in the fresh-schema INSERT.

## Authored coverage and NOT_TESTED evidence

**No tests, compiler, lint, generator, foundation checker, self-QA, DB/SQL,
migration runner, runtime, install or network command was executed by this
author.** This is the explicit source-only/no-self-QA assignment ceiling, not a
reported successful check or an unavailable-tool diagnosis. Read-only source
inspection and Git status/show/diff/log are not test results. No PASS is claimed.

| Required evidence | Current disposition |
| --- | --- |
| API TypeScript including exact integration request cookie types | NOT_TESTED; authored fix only. |
| API lint and unit/AJV full Venue/AdminVenue/AdminVenueCommand tests | NOT_TESTED. |
| OpenAPI check and existing Game/Unified/Friendship read-only generator byte checks | NOT_TESTED; generator sources/outputs untouched; run defaults without --write externally. |
| New profile DB integration and migration smoke | NOT_TESTED; DB execution forbidden to author. |
| Existing venue-contacts public/private game fences and moderation suites | NOT_TESTED; existing suites not weakened or changed. |
| Legacy schema upgrade/ledger rerun, SQL CHECK/bounds/default semantics | NOT_TESTED; disposable DB scenarios authored only. |
| Command/audit/history/outbox/receipt failure atomic rollback | NOT_TESTED; synthetic failure triggers confined in test source to isolated random DBs. |
| Actual N-1 old-image compatibility, backup/restore and app rollback | NOT_TESTED; synthetic old SQL is not actual image evidence. |
| NEW independent source QA on final published SHA | NOT_TESTED / pending; prior supplied QA is empty. |
| Full exact-head Product CI including database and source(api) | NOT_TESTED / pending existing Actions gates. |
| Protected integration, DEV acceptance/live identity and rollback | NOT_TESTED / pending authorized integrator/release gates. |

Integration source retains RUN_DB_INTEGRATION=1 gating, synthetic-only test/local/
fake-provider and loopback URL guard, separate random databases and cleanup.
It covers fresh nullable/no-default facts, SQL negative/overflow errors, forged
insert dates, 0037 reads, seeded0038→0039 upgrade/ledger preservation, old SQL,
public/admin edits/auth/version/collision, normalized/private/lifecycle/date
semantics, photo eligibility and transactional rollback. Unit source retains
exact invalid credit URL regressions and actual service-vs-OpenAPI validation,
strict inputs, safe contact neighbors, typed bindings, aliases/fuzzy/reuse and
omission/null/0/false. These descriptions are authored intent, never PASS.

Existing generator closures exclude full Venue/AdminVenue/AdminVenueCommand;
no generated file is edited or fabricated. External verification must use the
unchanged default read-only game, unified and friendship generator scripts and
full contract validation on this exact candidate, alongside actual runtime/AJV
projection checks. Neither historic generator PASS nor historic source QA can
be reused as new evidence.

## Rollback, risks and one next bounded action

Before publication, an authorized integrator may reverse only this task's source
diff after preserving the candidate; never reset unrelated work or task history.
Application rollback retains additive0039 schema/data/trigger, with no destructive
down migration or private-contact copy. Actual old-image compatibility and
backup/restore/rollback still require external evidence; this handoff does not
assert they ran. Real multi-photo gallery and rating/freshness sources remain
outside this slice; V1b/V3b/V2/FR-2 are not automatically started.

Next bounded action, recipient existing Actions bridge/integrator: preserve and
publish these 13 paths plus immutable task representation under #178 with actual
candidate SHA/permalinks while preserving the shared schema-contracts lock.
Route that NEW exact candidate to independent read-only source QA (no DB/network/
Git/runtime effects by QA), then unchanged full hosted source(api)/database
Product CI and protected integration/DEV acceptance/rollback gates under their
authorized operators. Any integration revision needs evidence for that exact
head. Do not call this source author result accepted, deployed or independently
passed; do not touch PR173/#170 history or use Owner as a file courier.
