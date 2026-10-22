# V1a technical definition preparation — 2026-10-22

WORKING DRAFT — NOT APPROVED — NOT CANONICAL

From: bounded technical task-definition preparer. To: exact-definition reviewer / PM / authorized integrator. This is neither implementation nor independent review. No admission, acceptance, QA, CI, deployment or runtime result is claimed.

Source snapshot supplied by Owner: `anpavel84-afk/gobadminton-clean`, exact accepted DEV base `865d02c7ea39ae8210172629c3cb8e20c8fa52a8`.
Base permalink: https://github.com/anpavel84-afk/gobadminton-clean/tree/865d02c7ea39ae8210172629c3cb8e20c8fa52a8
Existing product-scope record: https://github.com/anpavel84-afk/gobadminton-clean/issues/170

No `.git` exists in this read-only snapshot. The base/accepted-DEV status is supplied context, not independently verified branch/HEAD/worktree/remote state. No Git state or live issue state was fetched. Issue #170 already records product scope according to Owner; its live body, update state and execution admission were not checked or changed. This package does not create, edit or admit an issue. No new GB number, approval, architecture, Owner decision or Actions change is fabricated.

Prepared body: `/var/lib/gb-next170-20261022/prep/body.txt`.
Exact SHA-256 of body bytes, including marker and terminal newline: `0dd1934ab6dca5dd2756051d8b9708a192ccf3b07e7195828d826b9e3ba548b0`.

## Scope and why it is one useful implementation task

The backlog's V1a is a one-pass model/API obligation, not another public-contact rollout. #82 already implemented private venue booking contacts in authorized game detail; #142 already implemented independent organization publicContacts. The missing coherent result is persisted court/amenity facts, their safe public projections and truthful date, a bounded existing-command write path, API contract and meaningful tests. The body contains 13 explicit paths, eight criteria, max_attempts=3, model=gpt-6.1-sol, effort=high, target=dev, kind=source_only. There is no handoff-only or invented slot-filling task.

Technical choices in the body are proposed within current patterns, NOT words/decisions attributed to Owner. Three simple nullable SQL fact columns and a nullable public-content timestamp extend the existing venues row. There is no new storage service, profile subsystem, endpoint, auth model or architecture. An actually used shared venue-profile.ts isolates validation/public mapping for both services; it is not a speculative foundation for another stage. Existing admin edit carries these facts alongside existing publicContacts, with strict whole-facts replacement and omission/clear semantics. No separate admin operation/controller is needed. Create remains its existing strict shape. Future V3b UI can use this backend surface without a new write design.

The gallery is deliberately represented as an honest current capability: `coverage: 'cover_only'`, 0 or 1 eligible current photo. It reuses `venue_cover_url` and existing photo attribution; it cannot accept arbitrary uploaded/reference URLs. Full multi-photo gallery is an unimplemented residual, not silently dropped or declared satisfied. The full model/API/date/privacy pass remains together; splitting persistence/normalization from API purely to run beside #149 would fragment this requirement and is not proposed. A truthful empty gallery object and nullable facts are useful source behavior; they are not assertions that production data was populated.

V1b is later public profile/game contact presentation (and retains its M3 dependency). V3b is later Admin UI. V2 is later actual DEV import with provenance/repeatability/report and an authorized operator. These dependency meanings come from `docs/workbench/train-idle-20261022/backlog-after.json` entries V1a,V1b,V3b,V2. This preparer did not reassign or execute them.

FR-2 is operational verification of Friends request -> accept -> list. Owner reports FRIENDS_INTERNAL_ENABLED=1 already on actual DEV; no live flag probe or smoke was performed here. It is not a source_only author task and is not a second body or dependency invented for V1a. Preserve its operational meaning and obtain existing runtime evidence/operator smoke separately; do not reimplement Friends or change flags.

## Findings verified in this snapshot

- `apps/api/migrations/0036_venue_contacts.sql` adds private contact_phone/contact_website/booking_note/contact_updated_at. #82's documented role fence is active game owner/manager or confirmed participant of the exact game; other consumers omit the keys entirely. A social block alone grants no access. `docs/api/API_POLICY.md`, `docs/api/P4_ADMIN_VENUES.md` and `docs/handoffs/ISSUE_82_T0A_1_VENUE_CONTACTS_SOURCE_ONLY.md` record this convention.
- `0038_public_venue_contacts.sql` adds nullable jsonb with no backfill/default and strict SQL validation functions. Public organization contacts do not derive from the private columns. `schema.ts` mirrors these fields. No court/parking/shower/public-profile-time columns currently exist; 0038 is the highest numbered top-level migration.
- `apps/api/src/venues/public-venue-contacts.ts` already provides strict nullable publicVenueContactsSchema and tolerant readPublicVenueContacts. Phone normalization is trimming under the existing optional-plus / ASCII digits and spaces/parentheses/hyphens contract: 7-15 digits, <=40 characters, controls/backslash rejected before trim. There is no established E.164/country inference rule. Reuse this convention; do not introduce a country rewrite or duplicate module. Websites use WHATWG URL serialization (IDN -> punycode, default ports removed, dot segments normalized), explicit HTTP(S), no credentials/nondefault port/control/backslash and <=300 normalized characters. Messenger types have HTTPS exact-host/non-root-path and uniqueness limits. Tolerant reads keep valid neighbors and discard unsafe/unknown data. Existing #142 behavior should be tested, not reimplemented.
- `VenuesService` has repeated explicit SELECT/RETURNING projections, one mapVenue, and catalog/detail/fuzzy/proposal/reuse paths. Search selects only unverified/verified with stable pagination; getById follows merged aliases up to eight edges and returns canonical id plus resolvedFromVenueId. New profile must reach every mapVenue input, not only getById.
- Current public_contacts is extracted as `to_jsonb(row)->'public_contacts'`, per key, so current public reads also work on schema0037. Direct references to new absent columns would break existing schema0037 cover-credit integration tests at SQL parse time. Apply the same per-public-key absent->NULL technique to the new fields. Do not ship whole-row JSON or private columns to the public application mapper. Schema0037 is the current reader compatibility floor, not arbitrary older schemas. New profile writes require schema0039, as #142 public writes require schema0038; no hidden write fallback.
- `AdminVenuesService` uses venue-owned writes within AdminService privilegedCommand and existing catalog advisory fence, row locks, expectedVersion and collision review. Edit currently replaces only supplied publicContacts; omitted values survive, null binds SQL NULL, object is normalized then serialized. contact_updated_at changes only for private value differences. Generic updated_at/version/provenance change on edits and lifecycle/merge operations: neither that timestamp nor contact_updated_at is a truthful public-profile date.
- Admin list/detail/command receipts share dto; SQL currently loads v.* only on the privileged surface, then explicitly maps response fields. It already emits cityName from city_name, but AdminVenue OpenAPI lacks cityName while additionalProperties=false. D6 explicitly allows documenting that existing output while adding profile, so actual response/schema validation is feasible without stripping current behavior.
- Existing `AdminVenuesController` provides strict parse, no-store headers and same routes for reads/commands. No controller change is necessary for extending DTO/service. AdminService rechecks current permission on replay. Keep AdminSessionCookie, exact Origin, CSRF, current role/grants/principal/session, fresh step-up, expectedVersion, reason/idempotency, audit/history/outbox and rollback. No consumer cookie/bearer shortcut or new capability.
- `0034_venue_cover.sql` defines one unique sanitized PNG key and moderation approval/actor binding, not a multi-photo gallery. `venue_cover_url(id)` emits only the public derivative path when venue lifecycle is unverified/verified, actor active and matching cover_image approval allow. Existing cleanup/account-inactivation triggers and media-service authority remain. `0037_venue_cover_credit.sql` adds photo/logo/illustration attribution and resets stale credit when cover changes. Gallery must not turn logos/illustrations/unknown classification into photographs or leak an unavailable key. New gallery mapping fails closed on unsafe attribution; existing cover is retained.
- A BEFORE INSERT/UPDATE content timestamp trigger in the NEW migration can cover both admin profile writes and current cover/import writers without editing media/import services. Use null-safe persisted-field comparisons and ensure it observes final cover-credit reset results (existing BEFORE trigger is venue_cover_credit_reset; PostgreSQL orders same-kind triggers by name). Lifecycle/moderation availability is distinct from stored content-edit time. No extra trigger on moderation tables or new event platform is justified.
- `src/database/migrate.ts` discovers sorted top-level *.sql and uses schema_migrations plus transaction/advisory lock. NEW 0039 needs no registry/runner change. Additive nullable columns preserve old code; schema mirror and existing migration smoke ledger need changes. Application rollback should retain populated schema, trigger and data. No destructive down migration is needed or authorized; a future removal would need a separate data-preservation plan.

## Concrete model and genuine residuals

Full Venue/AdminVenue gets an optional-for-rollout `profile`; current server emits all nested keys. Response: courtCount integer|null, amenities.parking boolean|null, amenities.showers boolean|null, updatedAt ISO date-time|null, gallery.coverage='cover_only', gallery.items of eligible current photo URL + credit. New write `profile` omits updatedAt/gallery and allows null to clear all facts, otherwise a strict object with all facts required; omission preserves. SQL integer is nonnegative up to its native signed-int bound; null is unknown, 0/false are known values, with no fabricated defaults or inference from games. The 32-bit upper bound is a storage consistency choice, not a claimed product maximum.

Only court count and parking/showers are concretized: these are the facts referenced in current venue handoff/design descriptions. More amenities, descriptions, opening hours, prices or per-court inventory are not invented. Frozen `/opt/gobadminton-clean-qa/style-guide/src/App.tsx` contains generic media/gallery/placeholder primitives (MediaBlock around line1377); it supplies no real venue inventory, ratings, verification times or photography rights. The Owner map-popup decision in `docs/decisions/OWNER_DECISION_MAP_POPUPS_V001.md` calls for carousel/rating/facts, but its external image was not fetched and no 21 October image export was supplied in this prep. Prior handoff wording and mock text are not actual venue data or a fresh Owner decision. No visual changes or parity/override claims are in this source task.

Remaining concrete unknowns:

1. Actual court counts and amenity truth for each venue are unknown; no source dataset is supplied. Keep fields null until authorized factual entry. No real edits/import are made by implementation or QA.
2. Full ordered gallery storage, additional-photo rights, source/ordering and write lifecycle are absent. Only one moderated cover exists. Return eligible cover-only data and explicitly report full gallery unfilled. A new media platform is outside this assignment.
3. Rating/review count has no established producer or authoritative source. No field/value is synthesized from games, covers or demo. Source/data decisions remain a separate residual; do not demand a nonexistent source to finish this bounded code.
4. Existing public profile content has no trustworthy historic public-change time. Leave legacy time null. The new timestamp proves a recorded stored-content edit since migration, not fact verification, complete public-change history or dynamic moderation visibility time.

These unknowns are represented in behavior/contracts/handoff and do not cause an impossible early stop or a fabricated Owner answer. Missing tooling also does not excuse a handoff-only diff. Full gallery/rating/data population cannot be claimed accepted by completing the feasible source subset.

## Exact paths and purpose

| Allowed path | State at base | Essential purpose |
|---|---|---|
| apps/api/migrations/0039_venue_public_profile.sql | NEW | Four nullable columns, nonnegative integer constraint and content timestamp trigger; no applied-migration edits |
| apps/api/src/database/schema.ts | existing | Mirror persisted fields |
| apps/api/src/venues/venue-profile.ts | NEW | Shared production strict facts validator and safe read/gallery mapper |
| apps/api/src/admin/venues.dto.ts | existing | Extend current edit input only; reject server/private/unknown profile keys |
| apps/api/src/venues/admin-venues.service.ts | existing | Versioned transactional edit and current read/receipt mapping |
| apps/api/src/venues/venues.service.ts | existing | All full public venue projections and mapping, N-1 reader compatibility |
| packages/contracts/openapi.json | existing; occupied by #149 | Actual canonical response/edit contract, safe additive rollout and cityName documentation |
| apps/api/test/unit/venue-profile.test.ts | NEW | Real validators/mappers, typed service fakes, response/edit JSON Schema validation and privacy/normalization edge cases |
| apps/api/test/integration/venue-profile.test.ts | NEW | Authored gated disposable migration/API/security/time/gallery/rollback cases |
| apps/api/test/integration/migration.smoke.test.ts | existing | Mandatory full ledger/physical schema assertions without weakening old checks |
| docs/api/API_POLICY.md | existing | Public semantics/privacy/compatibility/date/gallery contract |
| docs/api/P4_ADMIN_VENUES.md | existing | Exact existing-command input/read/version/security conventions |
| docs/handoffs/V1a-venue-profile-source.md | NEW | Reviewable source/evidence/unknowns/rollback/publication continuity |

No glob or directory expansion is present. Five NEW and eight existing files were checked for absence/presence. No other source path is authorized. In particular, private contact helper, controllers/modules, media services/import, applied SQL, generators/generated types, all web/Admin UI and Actions remain outside writes. Source history/handoff statements are contextual evidence, not proof that runtime tests passed.

## Real #149 conflict and dependency distinction

Current active #149 constraints were supplied by Owner and corroborated by `docs/workbench/train-idle-20261022/definition149-scope.json`. The exact intersection of this body's 13 paths with that scope is ONLY `packages/contracts/openapi.json`. This indispensable shared file remains explicitly in allowed_paths; removing it would make the API task incomplete.

#149 also occupies `apps/api/src/radar/radar.service.ts`, `apps/api/src/games/games.service.ts`, `packages/contracts/src/unified.generated.ts`, `apps/api/test/unit/radar-player-games.test.ts`, `apps/api/test/integration/radar.unified.test.ts`, `apps/web/src/lib/unified-directory.ts`, `apps/web/src/components/consumer/radar/RadarPage.tsx`, `apps/web/src/components/consumer/radar/UnifiedPlayerPreview.tsx`, `apps/web/src/styles/radar-geographic.css`, `apps/web/test/unified-directory.test.ts`, `apps/web/test/radar-player-games.test.tsx`, `docs/api/UNIFIED_PLAYERS_RADAR_V001.md`, `docs/handoffs/radar-player-games.md`. None is assigned here.

Proposed locks: api:venues, db:migrations, schema-contracts. They truthfully represent module, new migration and shared contract ownership. #149 locks are api:radar, api:games, web:radar, schema-contracts; shared lock is schema-contracts. db:migrations does not authorize runtime SQL. No depends_on=[149] is added: V1a consumes no #149 product behavior. PM/integrator must serialize shared-file ownership, then manually reconcile a newer base/candidate and review it. We do not assert the current holder released its lock or any slot is free. There is no complete independent slice satisfying the requested one-pass model/API here, and no task was fragmented to manufacture one.

## Wire/generated-type drift: exact current surfaces

Canonical schema is `packages/contracts/openapi.json`. Relevant existing schemas are Venue, AdminVenue and the inline edit-fields object in AdminVenueCommand.anyOf[action=edit]. New VenueProfile response/input schemas can be referenced from those current objects. AdminVenueCreate and CreateVenue keep their existing input shape; VenueSummary/Game/Unified schemas must not be broadened. Top-level profile is optional in read schemas for rollout; nested current-server keys are complete.

Current generator entry points:

- `packages/contracts/scripts/generate-game-types.mjs` -> `packages/contracts/src/game.generated.ts`: explicit roots DiscoveryCityId/Hint/Preference/PutDiscoveryPreference, ParticipationConfirmedPayload, GamePreferences/PatchGamePreferences/SavePublicContactDefault, CreateGame, Game, Participation and transitive refs. Includes VenueSummary and VenueCover, NOT full Venue/AdminVenue.
- `packages/contracts/scripts/generate-unified-types.mjs` -> `packages/contracts/src/unified.generated.ts`: Unified* roots and refs. At this base there are NO declared venue-named types in this output. Changes limited to full Venue/AdminVenue/edit do not reach it.
- `packages/contracts/scripts/generate-friendship-types.mjs` -> `packages/contracts/src/friendship.generated.ts`: current Friendship* reference closure; no full venue profile surface.
- `packages/contracts/scripts/check-openapi.mjs` imports all three generators in default byte-verification mode plus check-admin-protocol.mjs, then SwaggerParser validation. Admin protocol currently inventories 32 operations; no new route is needed, so no inventory/check-script change is justified. `packages/contracts/src/index.ts` exports current generated types/cover types, not a generated full Venue type.

Consequently there is no necessary generated-file edit at this exact base, including the file occupied by #149. This is a checked closure fact, not an attempt to hide shared-contract occupancy. Mandatory read-only generator-byte checks still detect accidental drift. Existing full VenueDto is hand-declared in venues.service.ts; new shared helper provides profile type for it and Admin mapping. New unit tests must validate representative service results against actual updated OpenAPI (existing API dependencies already include ajv/ajv-formats), including cityName, nested required fields, null/false/0 and forbidden input. Merely asserting property names or typechecking a duplicate shape is insufficient.

## Tests and feasible commands

Current root/API scripts and Vitest projects were read, not executed as preparation. API unit project includes test/unit/**/*.test.ts. Integration project includes test/integration/**/*.test.ts, serial disposable harness conventions and `test/vitest.setup.ts` with synthetic moderation. Existing venue-contacts.test.ts contains BOTH gated DB suites and ungated validation/service fake tests; RUN_DB_INTEGRATION=0 must be set explicitly for offline execution. Those fakes currently assert preserved publicContacts CASE bind positions (13/14); appending new profile binds permits keeping them without editing the existing test. Do not break or disable those guards. Use the existing HTTP inject/typed Pool/AdminService patterns; new DB fixtures must be loopback-only, random DB, synthetic, finally cleaned up. DB runtime/migration execution belongs only to CI/integrator.

Commands in body D7, from repository root (set COREPACK_ENABLE_NETWORK=0 for each pnpm command; never install):

```sh
COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/api exec tsc -p tsconfig.json --noEmit
COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/api run lint
RUN_DB_INTEGRATION=0 COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/api exec vitest run --project unit --no-cache test/unit/venue-profile.test.ts
RUN_DB_INTEGRATION=0 COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/api exec vitest run --project integration --no-cache test/integration/venue-contacts.test.ts
COREPACK_ENABLE_NETWORK=0 pnpm run check:contracts
node packages/contracts/scripts/generate-game-types.mjs
node packages/contracts/scripts/generate-unified-types.mjs
node packages/contracts/scripts/generate-friendship-types.mjs
python3 scripts/check_foundation.py
```

The three direct generator commands verify, without --write. Contract check includes SwaggerParser and all generator-byte checks. No source test/typecheck/lint/foundation/contract check was run by this preparer: NOT_TESTED. No dependency-cache/install availability claim is made. Missing compiler/pnpm/parser/AJV dependencies in the eventual author environment must be recorded precisely and do not permit installation, weakened checks, dropping tests or abandoning meaningful source work.

Integrator/hosted CI must run the full existing source jobs and actual database gates, including authored new suite and unchanged venue-contact/privacy, venue-cover, venue-cover-credit, p4 venue lifecycle, migration smoke, fresh/upgrade/rerun/restore and older-image compatibility against the real candidate. The existing command is `pnpm --filter @gobadminton/api run test:integration` with RUN_DB_INTEGRATION=1 on an explicitly disposable provisioned environment; source-only author/QA MUST NOT execute it, start DB/services or create runtime fixtures here. Separate source review is not execution evidence. No Actions edit or gate exemption is part of the body.

## Preparation checks, preserved boundaries and next recipient

Only requested prep outputs were written. Performed read-only repository/source/design/protocol inspection and local parsing of the prepared JSON; checked current schema constraints/limits, path presence/absence, duplicates, NEW states, #149 intersection, no required generated closure changes, field counts/body limits and actual output hash. These are preparation consistency checks, NOT implementation acceptance, an independent verdict, migration execution or live evidence. No other models, agents, runtime, network, Git mutations or publication were invoked.

The source body uses exactly the existing seven required schema fields plus locks/model/effort; no new schema/architecture/provider/Actions policy is proposed. Marker is the first line, then one JSON object, no Markdown fence. goal/acceptance each fit the current <=6000-character check and complete body fits <=16384 UTF-8 bytes. max_attempts is integer3 and model/effort match the current closed pair requested by Owner. depends_on is intentionally absent.

Required security fences are preserved: organization/public vs role-private contacts; exact-game membership rights; strict admin cookie/origin/CSRF/step-up/current authorization on replay; expected version; transaction/audit/history/outbox integrity without profile/contact payloads; catalog/dedupe/lifecycle canonical mapping; sanitized moderated cover visibility/ownership/attribution/GC; API-only client boundary. No real dataset, generic admin bypass, public data backfill, secret/client permission source, court booking/payments/chat/ERP/multisport or PROD effect.

Rollback of this preparation is removal of these two new prep files only. Future application rollback keeps schema/data/trigger; no schema-down execution is authorized. Future source changes must carry their own precise source/handoff diff and integrator-owned rollback record.

Next bounded action: independent definition review of EXACT body SHA above and the 13 paths, then PM handles source admission/serialized ownership using existing protocol, without asserting a dependency on #149 for occupancy alone. A changed base/definition must be reconciled and reviewed, not silently substituted. Existing #170 product scope is preserved; this preparer does not decide whether to replace an issue body or publish another execution record. Authorized integrator/PM must publish this exact body and notes as versioned GitHub prompt/workbench artifacts tied to #170 and later the actual source/handoff/candidate permalinks under Project Record Policy. Local prep files are not durable GitHub representation; no published permalink is available or fabricated. This bounded prep cannot publish under its explicit effect ceiling. No further task is selected automatically.
