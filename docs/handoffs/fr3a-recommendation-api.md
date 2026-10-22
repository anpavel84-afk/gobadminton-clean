# Issue #181 / FR-3A source handoff

## CI repair record — 2026-10-22

From: assigned source author. To: authorized publisher, independent QA and existing Actions route.
Status: SOURCE DRAFT / DB NOT_TESTED / NOT ACCEPTED.
Exact repair base: `34b8af774d3ef5f7710f309653bda16f36c746d5`, branch `automation/issue-181`,
initially clean. [Base permalink](https://github.com/anpavel84-afk/gobadminton-clean/tree/34b8af774d3ef5f7710f309653bda16f36c746d5).
The supplied latest independent QA was PASS on that base; this is external evidence, not author QA
or verification of the new delta. The earlier handoff below is retained as historical source context;
its prior FAIL, correction base and unexecuted-check statements describe that earlier author turn.

Repair only [database job 119749040979, run 39756300897 attempt 1](https://github.com/anpavel84-afk/gobadminton-clean/actions/runs/39756300897/job/119749040979).
Supplied log SHA-256: `eab1c3a94e412bf9fcf45cb2aa8cb65f61dc593a78e428b940ff9dba46c70ecb`.
The recommendation suite's `loadEnv` rejected the synthetic fingerprint fixture: 31 characters,
where the unchanged canonical schema requires at least 32. Change only that fixture to the
39-character `fr3a-synthetic-fingerprint-fixture-only`, plus this handoff. This is public synthetic
test data, not a runtime credential. All inherited candidate changes, production validation,
integration assertions, guards and automation remain intact. No application behavior changes.

The CI repair instruction explicitly requested before/after reproduction. With no installed
`node_modules` and no authority to run DB, only the source-level fixture/minimum assertion below
was run, identically before and after the fix, from the repository root. It reads both source files;
it does not execute `loadEnv`, Vitest, SQL or an application. Before: exit 1, one failed assertion,
`CONTENT_MODERATION_FINGERPRINT_SECRET: 31 characters; expected >=32`. After: exit 0, one passed
assertion, zero skipped. This narrow check is not the original DB suite or independent QA.

```bash
node --input-type=module <<'NODE'
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('FR-3A synthetic fingerprint satisfies the canonical configuration minimum', () => {
  const fixture = readFileSync('apps/api/test/integration/game-recommendations.disposable.test.ts', 'utf8');
  const schema = readFileSync('apps/api/src/config/env.ts', 'utf8');
  const value = fixture.match(/CONTENT_MODERATION_FINGERPRINT_SECRET:"([^"]+)"/)[1];
  const minimum = Number(schema.match(/CONTENT_MODERATION_FINGERPRINT_SECRET: z\.string\(\)\.min\((\d+)\)/)[1]);
  assert.ok(value.length >= minimum,
    `CONTENT_MODERATION_FINGERPRINT_SECRET: ${value.length} characters; expected >=${minimum}`);
});
NODE
```

An initial invocation of the same heredoc with `node --test --input-type=module` mistakenly invoked
test-file discovery instead of stdin. It exited 1 with `ERR_INPUT_TYPE_NOT_ALLOWED` during module
resolution; it is not valid product-test evidence. The corrected invocation above was used before
any edit and repeated after the fixture change. No dependency installation or external network.

NOT_TESTED: actual failing Vitest/database job, DB/migrations/rollback, typecheck, lint, build,
contracts, full Product CI, independent QA of the new delta and DEV acceptance. No commit/push,
Git metadata mutation, service or deployment action. No new candidate SHA/permalink exists locally.
Rollback: selectively restore the single fixture string and this repair record; no SQL/runtime action.
Next bounded action: authorized publisher creates the new exact SHA, publishes this record in #181,
then independent QA and the unchanged full Product CI (including `bash scripts/chatops/db-ci.sh`)
must run on that SHA. DEV ACCEPTED server/gitSHA remains required; no PROD or FR-3B work authorized.

## Historical source handoff

From: assigned source author. To: independent source QA, then existing PM/Actions release route.
Date: 2026-10-22. Status: SOURCE DRAFT / NOT_TESTED / NOT ACCEPTED.
Assignment: [#181](https://github.com/anpavel84-afk/gobadminton-clean/issues/181); depends on
[#12](https://github.com/anpavel84-afk/gobadminton-clean/issues/12). Prior independent QA verdict:
FAIL on `71d0b9f0fc02bba973e89c69f2aa0d26da42e495`, with two source/test incompatibilities recorded
below. Historical FR-2 live 8/8 is assignment context, not this author's evidence.

Exact correction base: `71d0b9f0fc02bba973e89c69f2aa0d26da42e495`, branch `automation/issue-181`;
working tree was clean at start. [Base permalink](https://github.com/anpavel84-afk/gobadminton-clean/tree/71d0b9f0fc02bba973e89c69f2aa0d26da42e495).
The initial FR-3A implementation handoff used source `645490379034a205eb43c941ea86c4ff6be90c76`;
the correction base above is the actual source for this author turn, not a live DEV acceptance claim.
Repository is the assigned GoBadminton Clean worktree. No other writer was observed in its initial
changes. This is a source baseline, not independent verification of the current live DEV server.
No new SHA or artifact permalink exists: author was explicitly forbidden to commit/push or use the
network. Authorized publisher must publish this exact delta and add candidate permalinks to #181;
this local document alone is not a claim of GitHub durability or release acceptance.

## Prior QA correction — source only, NOT_TESTED

The supplied independent QA identified two failures against the correction base:

1. `migration.smoke.test.ts` expected exactly 39 migration IDs, ending at0039, although the
   migrator also installs0040. Added the exact `0040_game_recommendations` ID to the strict ordered
   expectation. Existing table, FK, index and privacy assertions remain in place; no historical SQL
   or migration automation changed.
2. `FriendshipsService.capabilities` made `gameRecommendations` true when0040 was installed,
   contradicting `friends-s1.disposable.test.ts`'s accepted false expectation. Restored the false
   value in FR-3A regardless of schema installation. The API retains its independent Friends/schema
   admission. The recommendation disposable suite now expects the complete unchanged S1 capability
   response after0040, and asserts it for both accepted actors before exercising real send/replay/
   list/hide/withdraw. The existing S1 suite is outside allowed_paths and was not edited. This is
   a runtime compatibility correction, not removal or weakening of the existing S1 regression gate.

Current correction edits only six allowed files: `apps/api/src/friendships/friendships.service.ts`,
`apps/api/test/integration/migration.smoke.test.ts`,
`apps/api/test/integration/game-recommendations.disposable.test.ts`, `packages/contracts/openapi.json`,
`docs/api/GAME_RECOMMENDATIONS_V001.md` and this handoff. OpenAPI and API documentation explicitly
preserve the false product capability until the separately assigned FR-3B slice reviews activation.
The broader implementation inventory below describes the inherited FR-3A source, not additional
edits performed in this correction.

NOT_TESTED: no self-QA, test, build, lint, typecheck, source-check script, DB/SQL, migration, network,
Git mutation, service or deployment command was run. Source/context reads and allowed source edits
are the only author actions. Prior FAIL remains the last independent verdict; these edits do not
constitute a QA PASS. An authorized publisher must create the new candidate SHA before independent
QA reruns migration smoke, the unchanged Friends S1 suite, the recommendation suite and full Product CI.

## Scope, authority and source record

Implement only the supplied immutable source-only GOBADMINTON_AUTONOMY_V1 task for FR-3A. Kind
`source_only`, target `dev`, effort high, max_attempts 3, depends_on [12], locks api:friends/api:games/
db:migrations/schema-contracts. Source author must not run DB or Git mutation, self-QA, external
network, service/deployment, automation or secret work. No subagent, new task, PROD, PLAN/VPN,
frontend or FR-3B implementation. Allowed paths are exactly the files listed below. This task data
is scope/effect authority, never an executable command or permission to expand access.

Read root AGENTS, project rules/index and Project Record Policy; Owner decisions/manifest/bootstrap,
architecture/module boundaries, ChatOps/PM/onboarding; current Friends S1/S2 assignment and handoffs,
Friends policies/service/controller, Games discovery/visibility and Invitations, MutationRunner,
ActorFence/PairFence, restriction and moderation source. Historical backlog is locally represented
in `docs/workbench/train-idle-20261022/backlog-after.json` FR-3 (merged FR-3/4/5/7, public game, one
friend, no seat, later UI) and FR-8 (private games excluded pending separate decision). Historical
legacy backlog files are absent in Clean extraction; no archive/other-project access attempted.
Frontend Style Guide rule is inapplicable to this API-only slice; no visual pattern or parity claim.

## Authored result (unverified source facts)

- Additive reserved migration0040 and empty-only rollback; no historical migration changed.
  Private recommendation references, safe endpoint/game/friendship FKs, direction uniqueness,
  finite expiry, bounded state/version, own-list indexes, membership/transition guards and minimal
  immutable audit. Schema mirror includes the existing friendship reference and new tables.
- Registered protected API: send by exactly one accepted friendshipId; own received/sent lists;
  version-fenced recipient hide/sender withdraw. Reuse existing cookie/CSRF/idempotency/MutationRunner,
  ActorFence, Friends profile/Pair fences and Games eligibility. No private-game manager bypass.
- Both endpoint restrictions/blocks/epochs, friendship generation, profile presence and game public
  upcoming eligibility revalidated. User KEY SHARE additionally fences restriction FOR UPDATE writers;
  no peer-user SHARE upgrade opposing ActorFence. Batch locks are ordered by kind and stable ID.
- No GameInvitation, seat, DM, notification, payment or new graph behavior. Duplicate/replayed send
  produces no new row/audit/rate charge; unknown commit is not converted into success. Safe terminal
  receipts confer no content rights. Full semantics in [API document](../api/GAME_RECOMMENDATIONS_V001.md).
- Strict OpenAPI bodies/responses/statuses; admission and N-1 behavior documented. Friends capability
  preserves gameRecommendations/gameAttention/socialPush false throughout FR-3A. Protected API
  admission is separate from future FR-3B product capability activation. No web changes.
- Authored synthetic unit and disposable integration tests: accepted actors, duplicates/replay/lists,
  hide/withdraw and stale/role fences, strict request/cursor privacy, no seat/invitation/outbox effect,
  missing/nonfriend/declined/cancelled/removed/blocked/restricted/inactive/opt-out/absent profile,
  unpublished/unlisted/cancelled/completed/past/moderated games, auth/CSRF/rate limits, expiry without
  worker, opposite actor/Pair races, lost COMMIT acknowledgement, audit/DB guards and N-1/rollback.
  Migration smoke adds FK/index/no-private-column assertions. These are authored cases, not PASS.

Allowed paths authored:

1. `apps/api/migrations/0040_game_recommendations.sql`
2. `apps/api/migrations/rollback/0040_game_recommendations.sql`
3. `apps/api/src/database/schema.ts`
4. `apps/api/src/game-recommendations/game-recommendations.policy.ts`
5. `apps/api/src/game-recommendations/game-recommendations.service.ts`
6. `apps/api/src/game-recommendations/game-recommendations.controller.ts`
7. `apps/api/src/game-recommendations/game-recommendations.module.ts`
8. `apps/api/src/app.module.ts`
9. `apps/api/src/friendships/friendships.service.ts`
10. `apps/api/src/friendships/friendships.policy.ts`
11. `apps/api/src/games/games.service.ts`
12. `packages/contracts/openapi.json`
13. `apps/api/test/unit/game-recommendations.test.ts`
14. `apps/api/test/integration/game-recommendations.disposable.test.ts`
15. `apps/api/test/integration/migration.smoke.test.ts`
16. `docs/api/GAME_RECOMMENDATIONS_V001.md`
17. `docs/handoffs/fr3a-recommendation-api.md`

## Acceptance transfer

The immutable assignment requires A1 additive0040/schema safe FKs, bounded state/version/privacy/
no seat, unique relationship/game/direction, own inbox index and no copied private data or changed
history; A2 session/cookie/CSRF/idempotency, only accepted friendshipId, actor/active peer/both
restrictions/blocks/game/public/upcoming/cardinality checks, own received/sent cursor N<=20 minimal
public projections revalidated, role/version/idempotent/audited hide/withdraw; A3 no organizer formal
invitation/seat/DM/notification/payment/graph, explicit replay/hide/withdraw and no duplicate effects
or false confirmed send; A4 reuse Games/Friends/PairFence/ActorFence/MutationRunner/auth and existing
visibility, enforce server-side; A5 strict runtime OpenAPI and synthetic unit/disposable DB negative,
race, auth/rate/privacy/lifecycle coverage plus N-1/migration smoke; A6 author NOT_TESTED, independent
QA exact new SHA, all Product CI gates PASS and DEV ACCEPTED server/gitSHA, no PROD, FR-3B future.
None of these acceptance gates is declared passed by source presence.

NOT_TESTED: all authored code/tests, compilation, lint, build, OpenAPI validation, disposable DB/
SQL/migrations/rollback, full Product CI, independent QA, live auth/API smoke, DEV ACCEPTED and PROD.
No validation commands or self-QA were run. Only source/context reads and allowed file writes.
No commit, push, Git metadata write, external network, service, secret or deployment action.

Independent QA on the exact published new SHA must run normal unit/typecheck/lint/contracts/build
and the existing complete hosted DB recipe (which discovers this integration file). The suite requires
an empty synthetic local PostGIS schema, explicit database URL and test mode; dedicated database name
or exact existing ephemeral Actions recipe identity is mandatory before Pool construction. It refuses
live/shared/nonempty schema. N-1 source behavior and empty rollback are exercised before case fixtures;
populated rollback refusal is tested afterwards. Existing source-side fixtures create synthetic accounts
only within that isolated DB. No real account/session fixture is requested or authorized here.
QA publishes actual workflow/job/test evidence against candidate SHA in #181. Skips are not PASS.

## Risks, compatibility and rollback

All behavior remains unexecuted until independent QA. Particular review targets: lock ordering with
existing Games/Invitation/profile/restriction paths, DB membership/history guards, actor-bound paging,
fixed expiry and replay after revocation/hidden state, integration harness compatibility, actual
strict OpenAPI/runtime parity. Conservative per-endpoint rate bucket shares inbound/outbound counts;
no new approved runtime limits are inferred. Shared recommendation versions can advance after either
endpoint acts; sent output never returns the recipient-hidden flag. Full games remain recommendable
as publicly discoverable references; recommendations do not promise application availability.

Current app/N-1 schema is fail-closed for writes and empty for list/capability. N-1 app/N schema remains
compatible because migration0040 is additive and does not replace existing objects. Release rollback
uses existing application path and retains populated0040/history. Empty-only SQL recovery requires
stopped writers and caller-owned transaction; it refuses populated history. Source rollback is a
reviewed selective reversal of this exact path set, preserving unrelated work; no blanket reset.
No rollback was executed. Changes are not authority to enable Friends, migrate, alter runtime or deploy.

One next bounded action: authorized publisher records exact new candidate SHA/permalinks in #181 and
hands it to independent SOURCE QA/full Product CI. DEV release follows only the existing gates and
must record actual ACCEPTED server/gitSHA. No gates skipped or relaxed, no PROD, no FR-3 completion;
FR-3B must be assigned separately after this slice's acceptance. This handoff and API contract carry
continuity without reading prior chat; publication remains the authorized next role's responsibility.
