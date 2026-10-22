# #177 — Radar player/game recovery source handoff

From: source AUTHOR. To: existing Actions bridge, integrator and a NEW independent
read-only source QA actor. Date: 2026-10-22.
Status: **READY_FOR_REVIEW / UNVERIFIED / NOT_RELEASED**.
This document records an uncommitted source patch, not an independent QA verdict,
CI result, deployment, server ACCEPTED record or Owner acceptance.

## Assignment and exact source

Implement only the supplied immutable `GOBADMINTON_AUTONOMY_V1` #177 source-only
assignment: recover the original #149 M2R + M2R-G product behavior on the supplied
fresh accepted DEV worktree. Original binding product reference:
[#149 / comment 6332442731](https://github.com/anpavel84-afk/gobadminton-clean/issues/149#issuecomment-6332442731).
The assignment specifies gpt-6.1-sol/high, max_attempts 3, depends_on #151/#157
(supplied as accepted), and locks `api:radar`, `api:games`, `web:radar`,
`schema-contracts`. This handoff does not alter attempts, admission or execution
state. #149 remains deferred at its original **3/3**; neither #149 nor PR #169 is
resumed or modified.

Original recovery's clean starting worktree: `/srv/gb-slots/slot2/worktrees/issue-177`, branch
`automation/issue-177`, original accepted DEV base
[`47feaf78828b5984097bc54803350622b842ae6c`](https://github.com/anpavel84-afk/gobadminton-clean/commit/47feaf78828b5984097bc54803350622b842ae6c).
Accepted-DEV status is supplied by the assignment, not independently established
by the author. Git was used only for status/branch/HEAD/log/show/diff reads.

Read-only source reference: [PR #169](https://github.com/anpavel84-afk/gobadminton-clean/pull/169),
head [`f1e1a83ff59a79d7a54304d5320e232bc61ffc47`](https://github.com/anpavel84-afk/gobadminton-clean/commit/f1e1a83ff59a79d7a54304d5320e232bc61ffc47),
reference base [`865d02c7ea39ae8210172629c3cb8e20c8fa52a8`](https://github.com/anpavel84-afk/gobadminton-clean/commit/865d02c7ea39ae8210172629c3cb8e20c8fa52a8).
The allowed implementation/contract/test/API-document paths had no intervening
committed changes between that reference base and the original accepted DEV base;
only their bounded product changes were ported. The fresh base's other work,
including #174/#176 map game actions, remains outside the patch. No old
handoff, prompt deletion, workbench deletion or automation hunk was ported.

The bridge published the original #177 source candidate as
[`f52ffc06d8fe4475d4043145b814ab9466e9c4c1`](https://github.com/anpavel84-afk/gobadminton-clean/commit/f52ffc06d8fe4475d4043145b814ab9466e9c4c1).
That is the observed clean HEAD/base for this QA-finding correction on
`automation/issue-177`; its full API/web/contract implementation is retained.
No new candidate commit exists yet: the source actor cannot write Git. The existing
Actions bridge must publish this correction and handoff, then attach exact candidate,
review and CI permalinks to #177. A future new commit permalink cannot honestly
be supplied before that publication. This local handoff is not yet durable
GitHub publication.

## Scoped artifacts and implemented behavior

The original recovery edits/creates the sixteen task-allowed paths below.
This correction edits only `apps/web/test/radar-player-games.test.tsx` and this
handoff. Runtime source, contract and visual composition are unchanged by the correction.

- API: `apps/api/src/radar/radar.service.ts`, `apps/api/src/games/games.service.ts`.
- Contract: `packages/contracts/openapi.json`, `packages/contracts/src/unified.generated.ts`.
- API tests: `apps/api/test/unit/radar-player-games.test.ts`, `apps/api/test/integration/radar.unified.test.ts`.
- Web: `apps/web/src/lib/unified-directory.ts`, `apps/web/src/components/consumer/radar/RadarPage.tsx`, `apps/web/src/components/consumer/radar/UnifiedPlayerPreview.tsx`, `apps/web/src/styles/radar-geographic.css`.
- Web tests: `apps/web/test/unified-directory.test.ts`, `apps/web/test/radar-player-games.test.tsx`, `apps/web/test/shared-map-controller.test.ts`, `apps/web/test/unified-legacy-compat.test.ts`.
- Documentation: `docs/api/UNIFIED_PLAYERS_RADAR_V001.md`, this handoff.

C1/C8: Marker selection opens a compact identity card; explicit expansion shows
player detail and real API game summaries inside the same mounted map panel.
Selection-specific expansion, close/Escape/back, focus restoration (trigger or
canvas fallback), retry, responsive panel bounds and reduced motion are retained.
The basemap owner/reference, camera, bounded marker window, accepted CloseButton
and RadarMapModuleLoading/dynamic loader are preserved. The map expansion has no
profile navigation; ordinary directory dialog/profile actions remain.

C2/C4/C5: The existing resultRef-only POST preview u1 branch calls the Games-owned
`readRadarPlayerGames` with the **same PoolClient** and redeemed target. It reuses
`eligibleGames(normalizeDiscovery({temporalScope:'upcoming'}))`, moderation,
effective venue CTEs, gameSelectColumns/mapGameRow and canonical cover projection.
The query applies relationship/discovery eligibility before LIMIT 3, returns
distinct games ordered by startsAt/id, and exposes no hidden total. No new
endpoint, public-player-ID lookup, browser scraping, fake games/metrics/activity,
service wiring, database schema or migration is introduced.

`UnifiedPreview` requires `upcomingGames`; `UnifiedUpcomingGame` is closed at all
levels: public game id/title/activityKind/startsAt/endsAt/timezone,
cover.uploadedUrl, venue.name and venue.cover.uploadedUrl only. Legacy non-u1
responses are unchanged. Generated bytes were created using the repository's
OpenAPI generator, not hand-edited.

## Privacy truth table and serialization (C3–C6)

Every allowed row first requires the same current viewer/session-bound u1 proof,
namespace/filter/origin, consent receipt, model, activation/version, owner session,
lease/TTL, account/restriction and bilateral block fences. A queryRef alone is
never schedule authority. A public game is not permission to expose membership.

| Current association / viewer | Future published/public/classified discovery-eligible game | All other games |
| --- | --- | --- |
| Immutable created_by_user_id target with current active directory-public identity, directory feature/social eligibility/restrictions and block checks satisfied | Public creator association allowed | Excluded |
| Confirmed target participation AND viewer active game_managers owner/manager | Existing roster authority allows association | Excluded |
| Ordinary viewer, including confirmed co-participant | Membership excluded | Excluded |
| Radar-only creator without viewer roster authority | Creator shortcut excluded; truthful empty allowed | Excluded |
| Arbitrary manager/trainer/organizer, invitation only, pending/rejected/withdrawn/removed/expired/cancelled_by_game participation | Excluded | Excluded |
| Invalid, stale, forged, expired, wrong-viewer/session/namespace proof, opt-out, block, restriction or invalidated session | Entire preview denied | Entire preview denied |

No private/unlisted/draft/cancelled/past/unclassified/hidden/taken-down game,
internal user/manager/participation/provider identifier, contact, booking note,
private relationship or personal source location is added to the response.
Public game/player IDs and the already-approved approximate geo remain their
existing permitted projections. No fabricated counts or private-data fallback.

After existing pair/presence fences, at most three deterministic Game SHARE
fences are held through commit. A separate READ COMMITTED read after waits
rechecks relationships and eligibility over held ids; retired candidates are
omitted without refilling from unfenced games. The preview captures and compares
players_query_revision under its final SHARE fence, rechecks actor/session, and
performs final wall-clock proof validation before and after projecting games.
Lock/statement waits are bounded at two seconds. Failures roll back without
returning any partial schedule.

The controller aborts/epochs selections and retires loaded or late schedules on
selection replacement, close, map window, filter/city/activation change,
hide/background, STOP, identity/CSRF replacement, expiry and dispose. Loading,
retryable error and authorized empty are distinct. Empty text is exactly
«Нет доступных ближайших публичных игр» and says nothing about private games.
Admission AND rendering require matching identity, finite live deadlines, a
complete closed preview (including nested level/avatar/Radar/geo/distance), and
up to three distinct future startsAt/id-ordered games. Game start is also a
render/controller deadline. Malformed or extra-field successful responses are
rejected, not adapted. Proofs/schedules stay in memory, never URLs/storage/logs.

## QA-a3 recovery and historical diagnostics

The two newly authorized existing test paths now construct typed, complete
`UnifiedPreview` fixtures with explicit player and preview-Radar allowlists,
proximityBand:null and upcomingGames. Directory players/map proof envelopes are
not spread into a preview. Fixtures use UUID public IDs and complete geo. Existing
same-name selection, map paging, reference-only refresh, capability/error and
late-response semantics remain. Positive acceptance and negative incomplete/
private-field rejection assertions were added. **liveUnifiedPreview was not
relaxed**; nested closed-object validation and future-game checks were tightened.
The other newly ported preview tests likewise use the closed current contract.

Historical diagnostic source:
[f1e1a83 handoff](https://github.com/anpavel84-afk/gobadminton-clean/blob/f1e1a83ff59a79d7a54304d5320e232bc61ffc47/docs/handoffs/radar-player-games.md).
It records earlier source-review outcomes and
[CI run 39723783236](https://github.com/anpavel84-afk/gobadminton-clean/actions/runs/39723783236),
attempt 1, against older candidate `2e924a6c73a7de1445779bef294ceb204ab59396`:
database, web unit and API typecheck failures. That reference includes the
CommonJS type-only generated-leaf import fix and current expectedVersion opt-out
fixture fix, both retained here. It also diagnoses the two formerly out-of-scope
fixtures now authorized by #177. These are historical records, not a new review
or a claim that those diagnostics have passed on this patch. Network was not
used to fetch the original issue comment or current hosted logs. Prior independent
QA for the original #177 author session was supplied as `{}`. The current
assignment supplies an independent **FAIL** against `f52ffc06d8fe4475d4043145b814ab9466e9c4c1`:
`apps/web/test/radar-player-games.test.tsx:93` asserted an incomplete object as
`UnifiedSnapshot`. On pageHarness's second render the map becomes active and
`RadarPage.tsx:121` reads `snapshot?.totals.radarTotal`; absent totals throws before
the expansion, navigation and unmount assertions. QA reproduced that expression
with dependency-free Node; full Vitest was unavailable because dependencies were
absent. This is supplied evidence, not a command executed by this source author.

The correction supplies a complete explicitly typed `UnifiedSnapshot` with query
metadata, exact totals, map registration, items and page metadata. It also fills
the existing mapPage fixture to its complete contract and removes both type
assertions hiding those incomplete shapes. The existing marker/expansion test
now asserts the rendered map summary `На карте: 1 из 1`; its map-reference,
selection, collapse and API-content assertions remain. Navigation, Escape/back,
focus restoration and unmount scenarios remain intact. No live guard is relaxed
and the existing QA-a3 valid/invalid preview coverage is retained.

## Authored checks and actual execution

Authored API unit coverage exercises the actual preview/projection with mocked
PoolClient: same redeemed target/client, budgets, allowlist, bounded deterministic
fences/dedup/order, fresh omission, failed redemption/revision/final proof/actor
session rollback, and unchanged legacy response shape. Mocks do not establish SQL
privacy correctness. The synthetic HTTP/PostGIS suite contains permitted creator
and owner/manager cases, ordinary-viewer/radar-only/nonconfirmed/invitation
negatives, strict payload/media checks, invalidated viewer and target sessions,
opt-out/block/restriction/TTL/wrong-session/namespace proofs, and observed-lock-wait
membership/revocation/cancellation/moderation/identity/TTL races.

Authored web coverage exercises actual controller deferred responses/fake clocks,
closed preview admission, nested private-field rejection, identity and schedule
expiry, retry/empty and cancellation. Local hook/SSR component tests exercise
actual RadarPage/UnifiedPlayerPreview compact/expanded controls, selection reset,
Escape/back/close/focus, map-reference continuity and ordinary dialog behavior.
They do not establish browser/canvas/mobile parity.

**No tests, lint, typechecks, builds, database scripts, browser runs or self-QA
were executed in this #177 author session**, per the explicit author-role ceiling.
No PASS is claimed. Historical missing-dependency failures are not represented
as newly attempted commands. Current package dependencies were not installed.

The original author session recorded one executed generation command:
`node packages/contracts/scripts/generate-unified-types.mjs --write` (exit 0): it
produced the allowed generated source from openapi.json. This is source
generation, not contract validation or independent evidence. This correction
executes no generation, tests or self-QA. OpenAPI equality,
Swagger validation, TypeScript, lint and all test execution remain **NOT_TESTED**.
Read-only Git/source inspection is not a QA verdict.

## STYLE_GUIDE_PARITY (source references; rendered parity UNVERIFIED)

Authority read: `docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md`.
Frozen [guide](https://nougat-wise-76949869.figma.site/#guide) and
[construction kit](https://nougat-wise-76949869.figma.site/#construction-kit)
source tree SHA256 `5a04ac69a259245c72da3ed5618326e8398396b4dd2c861b6eef4aecd726b1d6`.
The original approved assignment identifies RadarMapPage/RadarPlayerPreview,
PlayerUpcomingGames/CompactUpcomingGame, Drawer/BottomSheet and Empty/Error/
Skeleton as the source families. The recovery reuses the approved bounded
composition from the read-only candidate, Avatar, GameCover, Button, CloseButton,
existing foundation tokens and accepted map loader. It copies no demo activity,
rating, preferences, counts or photos.

**STYLE_GUIDE_GAP:** expand player details/games inside the mounted map's existing
Drawer/BottomSheet instead of the Make demo's profile-route transition.
No OWNER_VISUAL_OVERRIDE is claimed. Local read access to
`/opt/gobadminton-clean-qa/style-guide/src` was denied; no bypass was attempted.
The referenced `docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md` and installed
Next documentation directory were absent. No Next routing/runtime API change was
introduced. Frozen-source comparison and browser/mobile/desktop parity therefore
remain mandatory independent gates, not author-verified facts.

## Publication lock, remaining gates and rollback

The task declares exclusive `schema-contracts` along with API/web locks. No
model-managed lock, automation or execution state was changed. The existing
admission/integration system must serialize this OpenAPI/generated change with
the V1a successor before publishing/integrating; do not race schema writers.
V1a is **not a product dependency** and is not added to depends_on. No next slice
is authorized.

Next bounded action: the existing bridge publishes the exact #177 source
candidate and handoff under the admitted locks, then obtains a NEW independent
read-only source QA review. The reviewer cannot repair source. Required execution
belongs to that existing QA/Actions process, including focused API/web tests,
contract equality/validation, typecheck/lint, the synthetic DB harness/races and
full required Product CI jobs on the exact published head. Example focused
commands for that role (all UNRUN here):

- `pnpm --filter @gobadminton/api exec vitest run --project unit test/unit/radar-player-games.test.ts`
- `pnpm --filter @gobadminton/web exec vitest run test/unified-directory.test.ts test/radar-player-games.test.tsx test/shared-map-controller.test.ts test/unified-legacy-compat.test.ts`
- `pnpm --filter @gobadminton/api run typecheck` and `pnpm --filter @gobadminton/web run typecheck`
- `pnpm --filter @gobadminton/contracts run check` (includes generated equality)
- Existing database CI harness only in the admitted disposable environment.

Release remains absent until independent source QA PASS, all exact-head required
Product CI jobs PASS, integration/merge QA and CI (renewed after any rebase), DEV
smoke and server ACCEPTED are verified by the existing Actions process. Retain
exact source/integration head and evidence links; a green run on another SHA is
insufficient. PROD still requires separate Owner GO.

No network, Git write, dependency install, auth/secret access, service startup,
DB/migration execution, deployment, PROD, PLAN, VPN, automation edit or other
project access was performed. No additional agent or source writer was started.
Rollback for this correction: integrator reverts only its test fixture/summary
assertion and handoff changes relative to `f52ffc06d8fe4475d4043145b814ab9466e9c4c1`.
Rollback for the full recovery: integrator reverts the bounded sixteen-path source change and renews
checks through existing gates; no schema/data/runtime mutation is part of the
patch. The source author performs no revert, Git publication or deployment.

## CI repair intake — 2026-10-22 — BLOCKED, no source fix

From: source AUTHOR. To: existing Actions bridge/integrator. Status:
**UNVERIFIED / NOT_RELEASED — failure reproduction unavailable**. This section
records the current CI-repair intake; the earlier author-session descriptions
and their NOT_TESTED statements above remain historical.

Observed clean starting HEAD on `automation/issue-177`:
[`a80a448504a69b2fffc56d3f90724a52ab4e74ea`](https://github.com/anpavel84-afk/gobadminton-clean/commit/a80a448504a69b2fffc56d3f90724a52ab4e74ea).
The supplied independent QA verdict for that SHA is PASS with no findings; this
is supplied evidence, not an author QA verdict. The supplied CI failure is
[`39736065444`, attempt 1](https://github.com/anpavel84-afk/gobadminton-clean/actions/runs/39736065444/attempts/1),
job `database`, step `Run bash scripts/chatops/db-ci.sh`. No failing test name,
diagnostic, stack trace or test report was included. No local CI report was found
in the worktree.

The repair instruction requires reproducing the failing check before changing
code and rerunning it after a fix. The following targeted integration command
was attempted from the repository root before any edit:

```text
pnpm --filter @gobadminton/api exec vitest run --project integration test/integration/radar.unified.test.ts
```

Actual result: exit **254**, `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`,
`Command "vitest" not found`. No tests ran, so this does **not** reproduce or
diagnose the CI database failure. There is no post-fix run because no source fix
was made. No PASS is claimed. Local dependency directories are absent; dependency
installation and network access are forbidden by this assignment.

Read-only inspection of `scripts/chatops/db-ci.sh` confirms that executing the
full job would create and run a disposable PostGIS container and execute
migrations/integration tests. DB execution and service/runtime mutation remain
outside this source actor's authorization; the script was not run, and its
GitHub Actions guard was not bypassed. Typechecks, lint, builds, independent QA,
DEV smoke and server acceptance were not run in this repair intake.

All candidate implementation, contracts, tests, assertions and CI automation
remain unchanged. The only edit is this handoff addition. No Git metadata,
attempt counter, lock or runtime state was changed. Rollback of this intake is
removal of this appended section by the authorized integrator.

Next bounded action: the existing bridge/integrator supplies the exact failing
diagnostic/test report from the linked run and enables reproduction in the
already authorized disposable CI environment. The author requested that
diagnostic in the current session. Until the failure can be reproduced within
the actor's permitted effects, a speculative source change would violate the
repair instruction. Preserve the full `a80a448` candidate and the independent
QA record; exact-head Product CI and all subsequent release gates remain open.
The bridge must publish this handoff through its existing Git transport; no new
commit or publication is claimed by the source author.
