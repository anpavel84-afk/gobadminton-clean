# Radar player games — Issue #308 source handoff

From: bounded source author. To: existing Actions bridge / independent exact-SHA QA.
Date: 2026-10-25. Status: SOURCE CANDIDATE; independent QA, Product CI and DEV NOT_TESTED.

## Preflight and provenance

- Repository: `anpavel84-afk/gobadminton-clean`; assigned Germany workspace
  `/srv/gb-slots/slot1/worktrees/issue-308`. Initial working tree was clean.
- Base/source HEAD: `3f0dad1335c324bed37341c3a7f70c9a5005cc8d`
  (`Merge pull request #305`). This is the supplied current DEV base; no network
  or live DEV verification was performed by the source author.
- Trusted launcher rules: `bc8bad0c38a861f8e72296d0a323e2941b9322e0`,
  `docs/rules/ENGINEERING_OPERATING_MODEL.md`, SHA256
  `017441dec5ba197a1065b6ef90efdddb090b286ba48687241a7fbc09dd002269`.
  Read-only `git show <revision>:<path> | sha256sum` matched. The supplied
  common/author scoped_v1 capsule and immutable #308 task govern this stage;
  newer working-tree navigation does not rewrite that admission.
- Role: source author only, one writer within the 16 task-listed paths and four
  assignment locks (`api:radar`, `api:games`, `web:radar`, `schema-contracts`).
  Product requested route is `cursor:auto`; this source stage runs through the
  admitted Codex author fallback. No routing/runtime qualification is inferred
  from repository Markdown.
- Git is read only. Candidate SHA/PR are not yet assigned: changes are uncommitted
  in this workspace, for publication by the bridge. No Git metadata, workflow,
  rules, admission, counters, protected receipts, services or environment changed.
- Existing objects `60c942d86c8d59bc095e53812c2ecc9b80fec28e`, `a80a4485`
  and `f1e1a83ff59a79d7a54304d5320e232bc61ffc47` were unavailable to read-only
  `git cat-file -t`. No fetch/checkout was attempted. This is reimplementation on
  the supplied base, not a cherry-pick or claim to reproduce unavailable bytes.

## Carried forward and reimplemented

Carried forward: current proof redemption, pair/presence lock order, auth/CSRF/key
controller, ordinary directory, dynamic Radar map loader, shared map/camera,
navigation and current public Game/venue/media eligibility helpers. No migrations,
new endpoint, dependency, module wiring or browser participation scraping.

Reimplemented: Games-owned bounded schedule projection, strict OpenAPI summary
and generated types, final revision/actor/proof coverage of added work, compact
to expanded on-map card, checked empty/error/retry, complete response guard and
whole-schedule invalidation. Contact actions still use existing proof authority.

Privacy truth table:

| Target association | Viewer | Schedule contribution |
| --- | --- | --- |
| Current directory-public immutable creator | Unblocked authenticated proof viewer | Eligible upcoming public Games |
| Radar-only/nonpublic creator | Ordinary viewer | None through creator association |
| Confirmed target participant | Active Game owner/manager viewer | Eligible upcoming public Game |
| Confirmed target participant | Ordinary/revoked-manager viewer | None through participation |
| Invitation, nonconfirmed membership, target manager/trainer only | Any viewer | None through that association |
| Invalid proof/session, opt-out, blocked/restricted identity, elapsed TTL | Any viewer | No schedule response |

Eligibility is applied before LIMIT. Candidate Game fences are bounded to three,
ordered by UUID, followed by fresh eligibility/relationship reads. Both branches
use current state. The final global revision fence covers nongeographic changes,
and the existing final proof/session checks run after waits. DTOs explicitly omit
internal IDs, contacts, roster, booking notes, geo and metrics.

## D1 / D2 source evidence

- **D1:** new `apps/web/test/radar-player-games.test.tsx` declares a complete
  `UnifiedSnapshot` with `totals.{matchingTotal,radarTotal,ordinaryOnlyTotal,
  completeness}` and no cast masking missing required snapshot properties.
  The actual RadarPage test accesses the total and covers controlled expansion,
  close/Escape/back/focus with the same shared-map reference. Hook state setters
  capture their own slots, preserving the earlier C8 repair.
- `shared-map-controller.test.ts` and `unified-legacy-compat.test.ts` now return
  complete typed `UnifiedPreview` fixtures: minimal permitted player, null
  proximityBand, full radar/geo/deadline/distance and upcomingGames. Directory
  row fields and resultRef are not spread into a strict preview. The production
  `liveUnifiedPreview` rejects partial/extra-field/invalid responses.
- **D2:** `radar.unified.test.ts` adds a real `gameFixture` venue INSERT with
  explicit `lifecycle_state='unverified'`, `normalized_name` and
  `normalized_address`, matching current synthetic venue fixtures. No schema
  constraint or assertion was relaxed. Existing tests remain; 25 new generated
  cases extend the current DEV suite from 42 to 67. Registration-only execution
  confirmed 67 distinct candidate case names; existing cases were retained. The unavailable PR #183 65-case suite could not
  be copied byte-for-byte; no current DEV test was removed to match its count.
- Added mocked PoolClient/clock unit coverage of the actual projection and
  RadarService transaction. HTTP/disposable-DB cases cover creator/manager
  positives, ordinary participation negatives, all nonconfirmed statuses,
  discovery exclusions, invitation-only relationships, allowlist/order/bound,
  and observed pg lock waits for withdrawal, management, moderation, cancellation,
  directory opt-out and target-session revocation. Existing restriction, Stop,
  session and block cases include an otherwise eligible Game.

## Actual checks and limitations

Completed author checks (not independent QA):

- `node packages/contracts/scripts/generate-unified-types.mjs --write` succeeded;
  subsequent `node packages/contracts/scripts/generate-unified-types.mjs`
  verified byte equality with OpenAPI.
- `git diff --check` succeeded.
- Native `node:module.stripTypeScriptTypes` in transform mode parsed changed
  controller, generated types and non-JSX test sources. This is syntax parsing,
  not TypeScript typechecking or a TSX/build check.
- Registration-only Node execution of the transformed candidate integration suite
  (test callbacks and hooks disabled) confirmed 67 distinct cases. An initial
  count assertion expecting 65 failed with actual 67; the final check asserts
  the observed 67 without removing any tests. Source diff retains the existing
  cases and adds 25. An attempted automated baseline-name comparison using
  `child_process.execFileSync("git", ["show", "HEAD:<test path>"])` returned
  `spawnSync git EPERM` (errno -1; captured status 0 and source stdout), so that
  comparison did not complete. It was not repeated through another channel.
- Dependency-free Node author smoke executed the real transformed
  `unified-directory.ts` with injected synthetic request responses: accepted a
  complete preview, rejected nine malformed/private variants, fenced seven late
  response transitions, and cleared a valid schedule at TTL. No API/DB/network
  calls occurred. This does not replace Vitest or privacy integration evidence.

Unavailable / NOT_TESTED:

- Attempted `pnpm --filter @gobadminton/web run test:unit --
  test/radar-player-games.test.tsx test/unified-directory.test.ts
  test/shared-map-controller.test.ts test/unified-legacy-compat.test.ts`.
  Corepack lacked pnpm 10.18.0 and automatically attempted a registry download,
  which failed with `EAI_AGAIN registry.npmjs.org`; no tests started. No retry,
  dependency installation or network workaround was performed.
- `node packages/contracts/scripts/check-openapi.mjs` failed before validation:
  `ERR_MODULE_NOT_FOUND` for `@apidevtools/swagger-parser`. Full OpenAPI validation
  is NOT_TESTED despite generated-type equality passing.
- No local node_modules / TypeScript / ESLint / Vitest binaries. API unit tests,
  all web radar tests, typecheck, lint and build are NOT_TESTED. No DB execution,
  migrations or service startup was attempted. The 67-case count is registration
  enumeration, not an executed database result.
- No independent exact-SHA QA, hosted Product CI, integration/merge QA, browser
  rendering, mobile/desktop smoke, live `/v1/meta` check or server DEV ACCEPTED.

## STYLE_GUIDE_PARITY

Read the binding Style Guide first decision and the original #149 C1–C9 source
definition. The definition names frozen RadarPlayerPreview/RadarMapPage,
CompactUpcomingGame/PlayerUpcomingGames and Drawer/BottomSheet patterns.
Attempted read-only enumeration of
`/opt/gobadminton-clean-qa/style-guide` failed with OS `EACCES`; the local Next
framework guide/dependencies are also absent. No alternate path/identity was used.

The source composes existing Avatar, GameCover, Button and accepted CloseButton
within the existing responsive Radar panel. It preserves dynamic loading, map
ownership and map navigation; it removes the on-map profile-navigation expansion
and nested modal. Bounded `STYLE_GUIDE_GAP`: on-map detail composes those existing
primitives rather than the Make demo profile route, as specified in #149.
No fabricated activity, preferences, counts, rating or images. No additional
OWNER_VISUAL_OVERRIDE is claimed. Frozen-source comparison and rendered visual
parity remain NOT_TESTED and require the admitted independent reviewer.

## Bridge-owned remaining gates and recovery

Bridge must publish an exact candidate SHA/PR and obtain fresh independent QA
with objective findings, then all seven Product CI jobs SUCCESS including all
67 registered database cases (covering the requested recovery scenarios) and every web radar test. Refresh integration/merge QA and CI
after a rebase; use normal GitHub PR integration. Only the existing authorized
Germany DEV process may perform smoke/rollback and issue server DEV ACCEPTED
with live `/v1/meta.gitSha` equal to the merged head. Release remains absent until
all gates. The source author neither performs nor claims these effects.

This successor has at most two attempts (lineage 7–8). #149 1–3 and #177 1–3
remain consumed; prior FAIL/UNKNOWN, PR #169 and #183 and all counters are
untouched. The controller/bridge must record the actual lineage attempt and
receipts; this handoff allocates or resets none.

Rollback: bridge reverts this bounded source delta through the normal process;
no data/schema or environment rollback is introduced. Main residual risks are
unexecuted TypeScript/TSX/CI/DB checks, concurrency behavior requiring real
PostGIS tests, and unverified frozen/rendered visual parity.
