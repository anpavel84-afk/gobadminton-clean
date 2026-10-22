# MAP-PERF1 — Games map module loading

## Current CI repair handoff — 2026-10-22

- From: source author (Codex), assigned `issue-151` worktree.
- To: PM for independent QA, full Product CI and publication outside the author sandbox.
- Status: WORKING_DRAFT / SOURCE_ONLY; narrow type repair authored, compiler/lint/test execution **NOT_TESTED** because the offline package manager is unavailable. No new independent QA, CI, acceptance or deployment result is claimed.
- Exact repair base / checkout HEAD: `b9aebc69f2d61f232554d030645432ad1cf8f789`, branch `automation/issue-151`; initial working diff was empty. [Candidate](https://github.com/anpavel84-afk/gobadminton-clean/tree/b9aebc69f2d61f232554d030645432ad1cf8f789).
- Original task base: `9d3e092cc30796ffc0096c50584a771e60c18ef3`. Both commit objects are now readable. The earlier alternate-object blocker recorded below is historical and no longer applies.
- Supplied prior independent QA: PASS, findings `[]`, reviewed SHA `b9aebc69f2d61f232554d030645432ad1cf8f789`. This is assignment evidence for the existing candidate, not this author's review or a result for the repair.
- Supplied failure: [Product CI 39640478582, attempt 1](https://github.com/anpavel84-afk/gobadminton-clean/actions/runs/39640478582/attempts/1), `source (web)` / `Run pnpm --filter @gobadminton/web run typecheck`, `test/games-map-module-loading.test.tsx(46,33)` TS2349: `Loader` includes a non-callable `LoaderComponent`.

### Repair and retained D1–D5 scope

Only the test's loader type and this handoff change relative to the repair base. `MapLoader = Extract<Loader<MapProps>, () => unknown>` selects Next's callable loader member. Both the mock parameter and captured loader use it, so `resolveMap` can call the actual registered function while retaining Next's return type. The promise alternative accepted by Next is outside this mock's actual input contract. No `any`, cast, diagnostic suppression or runtime workaround was added.

- **D1:** the full original-base-to-working-tree diff contains exactly the five allowed paths listed in the historical handoff below, including the substantive test. This repair retains the three implementation files byte-for-byte from the candidate.
- **D2:** loading markup, accessibility assertions and all temporary CSS remain unchanged.
- **D3:** the real loader is still invoked for successful and rejected mocked imports; exact export identity, stable error component, SSR and subsequent mock dynamic rendering assertions remain unchanged. This mock does not prove real Next/browser/chunk timing.
- **D4:** the Moscow/other-city/venue branches and return-button assertions remain unchanged. SSR does not execute availability effects or prove populated-list behavior.
- **D5:** all seven test cases and every assertion are preserved. Production behavior, map props, catalogue statuses, privacy, requests, timers and map instances remain unchanged by this repair. No files outside allowed paths, existing checks, configuration or dependencies were edited.

### D6 — exact local command evidence

Commands were invoked separately from the repository root. Before editing, both the CI typecheck script and the required non-incremental compiler command were attempted. Both stopped before TypeScript started; the supplied TS2349 could therefore **not be reproduced locally**. After the edit, both commands were repeated, alongside the required lint and targeted test commands.

| Exact command | Before edit | After edit | Result |
| --- | --- | --- | --- |
| `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web run typecheck` | exit 1 | exit 1 | NOT_TESTED: Corepack cannot obtain pnpm 10.18.0 offline; TypeScript did not start. |
| `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec tsc -p tsconfig.json --noEmit --incremental false` | exit 1 | exit 1 | NOT_TESTED: same package-manager blocker. |
| `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web run lint` | — | exit 1 | NOT_TESTED: same blocker; ESLint did not start. |
| `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec vitest run --no-cache test/games-map-module-loading.test.tsx` | — | exit 1 | NOT_TESTED: same blocker; Vitest did not start. |
| `git diff --check` | — | exit 0 | No whitespace diagnostics. |

Substantive output for every pnpm attempt:

```text
! Corepack is about to download https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz
Network access disabled by the environment; can't reach https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz
```

Neither root nor web `node_modules` is present; installed Next documentation is unavailable. No dependency installation or network operation was performed. The known CI source failure is recorded above and is not reclassified as an environment failure; the repair still needs compiler validation outside this sandbox.

### D7 / STYLE_GUIDE_PARITY, limits and next action

No visual/composition change is part of this repair. The existing Progress and ErrorState composition is retained as described below. The Owner Style Guide First decision was read. Frozen `style-guide/src/App.tsx` and `src/index.css` returned `Permission denied`; the referenced repository operations guide is absent. Canonical visual parity remains **UNVERIFIED**, with no `STYLE_GUIDE_GAP` or `OWNER_VISUAL_OVERRIDE` asserted. Browser/iPhone, actual effects, Next transitions and load timing remain **NOT_TESTED**. Local author command attempts do not constitute independent QA or CI.

No commit, push, Git metadata change, automation/service/secret change, network publication or PROD action was performed. The next bounded action belongs to PM: collect this repair with the existing five-file candidate, publish the durable artifact/permalink, obtain independent QA, and run full Product CI for the resulting exact SHA. No new result permalink exists in this source-only sandbox.

Rollback: the integrator may remove only this repair's test-type and handoff diff relative to `b9aebc69f2d61f232554d030645432ad1cf8f789`; retain the candidate's existing implementation and seven tests. If rolling back the entire MAP-PERF1 task instead, remove only its five-path diff relative to the original base and preserve unrelated work.

## Historical handoff — retained from the candidate

The following records the earlier attempt and its then-current environment. The current repair section above supersedes its QA, Git-object availability, date, command evidence and next-action statements.

- From: source author (Codex), task worktree `issue-151`.
- To: PM, for independent QA and publication outside the author sandbox.
- Date: 2026-10-21.
- Status: WORKING_DRAFT / SOURCE_ONLY; implementation and tests authored, execution checks unavailable. NOT independently QA verified, NOT accepted, NOT deployed.
- Assignment: immutable `GOBADMINTON_AUTONOMY_V1`, `source_only`, target `dev`, MAP-PERF1, lock `web:games-map-loader`. Prior independent QA: **FAIL**, reviewed SHA `fb849d364c96c8a386606ffab518832c13b4a53a`; the supplied findings establish verification limitations, not a source defect. No historical PASS claimed.
- Exact assigned base: `9d3e092cc30796ffc0096c50584a771e60c18ef3` (`dev` per assignment). [Base reference](https://github.com/anpavel84-afk/gobadminton-clean/tree/9d3e092cc30796ffc0096c50584a771e60c18ef3).

## Scope and source facts

The complete task consists of these five source artifacts, already present when this continuation began:

1. `apps/web/src/components/consumer/games/GamesMapView.tsx`
2. `apps/web/src/styles/discovery.css`
3. `apps/web/src/components/consumer/games/GamesMapModuleLoading.tsx` (created by the prior attempt)
4. `apps/web/test/games-map-module-loading.test.tsx` (created by the prior attempt)
5. `docs/handoffs/slots-loader-games.md` (created by the prior attempt)

Repository rules and the exact supplied assignment were read. The assignment's offline/source-only limits override general publication instructions: no commit, push, Git metadata edits, dependency installation, service changes, deployment or network publication was performed in this continuation. No other writer or executor was started. This continuation adds an explanatory comment to `GamesMapView`, strengthens the substantive SSR test (no hidden module status, no percentage value, no retry action, exactly one parent return capsule), and updates this handoff. The loading component and CSS from the prior attempt are retained. No runtime defect was established by the supplied QA; no unrelated implementation was added to work around its environmental findings.

The worktree `.git` points to `/srv/gb-slots/slot1/repo/.git/worktrees/issue-151`. Its HEAD file names `refs/heads/automation/issue-151`; the loose ref currently contains `fb849d364c96c8a386606ffab518832c13b4a53a`, matching the supplied prior QA reviewed SHA, rather than the assignment's stated base. Reading this metadata does not verify its commit object. `git show --no-patch --format='%H %D' HEAD` and `git cat-file -t 9d3e092cc30796ffc0096c50584a771e60c18ef3` both failed (exit 128): Git cannot normalize the alternate object path `/srv/gb-slots/base.git/objects` or read the assigned base. Exact-base diff also failed (exit 128, `fatal: bad object 9d3e092cc30796ffc0096c50584a771e60c18ef3`). An index-relative diff for the current comment/test changes is readable with the alternate-store diagnostic. The full base-to-candidate diff, exact five-file scope and preservation of original code cannot be certified here. Git metadata was left untouched.

PM must collect the prior implementation plus this continuation against the exact assigned base, rather than treating the small continuation diff as the complete five-file task. There is no newly authored result commit or published artifact permalink; publication belongs to PM outside this sandbox.

## Implementation / D1–D5

These are authored source/test descriptions, not executed acceptance results.

- **D1:** the five task artifacts above contain implementation and a substantive new SSR/Vitest test. No pre-existing tests outside this task or configuration were edited. Exact-base five-file diff verification remains unavailable; the continuation alone is not the complete task diff.
- **D2:** `GamesMapModuleLoading` is a pure component with its own temporary `gb-games-map-area` shell. It renders `Загружаем карту…`, one `role="status"` with `aria-live="polite"` / `aria-atomic="true"`, and an `aria-hidden="true"` progress track. New local CSS centers the content in the existing flex area, with `min-height: 0`, `min-width: 0`, 16px padding, ink/paper tokens, a track up to 160px and available width, 6px height/radius, line token, 40% lime-deep segment, 1.2s ease infinite motion, and reduced-motion disabling animation. Existing map rules and dimensions were preserved. The new test uses real `renderToStaticMarkup` to assert the standalone shell, text and accessibility markup.
- **D3:** `MapView` remains a module-level `next/dynamic` declaration with `ssr: false`. Its loading option references the real component. Its loader returns the original `GamesVenueMap` export on success and catches import rejection into the stable module-level `GamesMapModuleError`. It adds no preload, retry or cached-rejection replay. The typed dynamic mock captures the real loader/options. Isolated success/rejection import mocks exercise that loader, exact successful export identity, stable error identity, standalone SSR and subsequent modeled dynamic rendering. The mock models pending/resolved rendering only; it does not verify actual Next, browser or chunk timing.
- **D4:** the real `GamesMapView` is SSR rendered under that mock for Moscow, another city and `venueId`. Error coverage checks both exact error texts, `role="alert"`, retained `GamesMapBackButton` when `onReturnToList` is supplied, and `/games` list navigation without a callback. The ordinary error-component `useEffect` calls `onAvailability?.(false)`. It does not call `onErrorCardChange(true)`; the existing `mapAvailable`-dependent details and parent return-button condition remain unchanged. SSR does not execute effects or demonstrate a populated venue list.
- **D5:** the successful map JSX and all its props remain unchanged. The new success test checks the props delivered by the parent to the resolved mock. Existing catalogue loading/error messages, venue selection, counts, schedules, other-city/venue branches, polling, map runtime error handling and privacy behavior were left intact. `GamesVenueMap`, `RadarPage`, `radar-map-assets`, photos and consent code were read where relevant and not edited. Radar's shared-map branch does not render `GamesMapView`; its no-shared-map branch inherits this component change. No requests, timers, map instances, dependencies or API/contract/DB/auth/configuration changes were added. Tests use React SSR and Vitest, with typed props/loader/options and guarded optional access; no custom React renderer, hook/state replacement, stabilization loop, source-string tests, TypeScript suppression or explicit `any` was introduced.

## D6 — command evidence

Each required command was invoked separately from the repository root, with networking disabled for pnpm. The TypeScript, lint and Vitest commands all stopped in Corepack before their tools ran:

```text
! Corepack is about to download https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz
Network access disabled by the environment; can't reach https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz
```

| Command | Exit | Result |
| --- | --- | --- |
| `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec tsc -p tsconfig.json --noEmit --incremental false` | 1 | NOT_TESTED: required pnpm 10.18.0 unavailable locally; Corepack refused download. |
| `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web run lint` | 1 | NOT_TESTED: same Corepack failure, eslint did not start. |
| `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec vitest run --no-cache test/games-map-module-loading.test.tsx` | 1 | NOT_TESTED: same Corepack failure, Vitest did not start. |
| `git diff --check` | 0 | Completed for the available index-relative diff with an alternate-store diagnostic; no whitespace findings. This does not verify the inaccessible exact-base diff or its five-file scope. |

Git's substantive output was:

```text
error: unable to normalize alternate object path: /srv/gb-slots/base.git/objects
```

The installed-Next documentation paths at the root and `apps/web/node_modules/next/dist/docs/` were absent. No dependencies were installed and no settings were changed. There were no executed compiler, lint or test-suite results to classify as source PASS or source FAIL. Code and tests remain for external execution. These required author command attempts are not an independent QA run, CI evidence or Owner acceptance; no additional self-QA was performed.

## STYLE_GUIDE_PARITY

- Authority read: `docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md`; canonical families requested by the assignment are ConstructionKit → Feedback & loading → Skeleton / Progress and EmptyState / ErrorState, including `.progress-set` / `.indeterminate`, `progressMove`, `.empty-error-family`.
- **UNVERIFIED:** `/opt/gobadminton-clean-qa/style-guide/src/App.tsx` and `/opt/gobadminton-clean-qa/style-guide/src/index.css` were unavailable (`No such file or directory`). The referenced `docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md` was also absent. No visual parity PASS is claimed.
- Progress uses the task's explicit geometry/motion and existing `consumer-tokens.css` palette. ErrorState is a local alert composition of existing `SurfacePanel`, heading, explanation and outline `Button`, with the existing parent return action and availability-dependent list retained. No shared component named `ErrorState` was present in this checkout; no shared primitive was created or edited. Exact canonical ErrorState fidelity remains UNVERIFIED pending the frozen reference.
- Screen-specific composition: the existing `GamesMapView` catalogue statuses, return capsule and fallback disclosure are retained, and the temporary shell occupies the existing map-area flex slot until module resolution. Successful `GamesVenueMap` keeps its own shell. Applicability is limited to module wait/import failure; tile readiness and catalogue readiness are separate.
- `STYLE_GUIDE_GAP`: none asserted; missing access to the reference is not evidence of a missing canonical pattern.
- `OWNER_VISUAL_OVERRIDE`: none asserted. The assigned dimensions/tokens are implemented without inventing new palette values or viewport geometry.

## Limits, rollback and next recipient

Browser/iPhone rendering, real React effects, populated-list disclosure after failure, actual Next transitions/chunk behavior, module timing, tile loading and visual comparison are **NOT_TESTED**. Test execution, TypeScript and lint remain **NOT_TESTED** for the exact environment reasons above. Independent QA/CI/acceptance are pending.

Rollback is for the integrator after restoring exact-base access: remove only this task's diff in the five allowed paths, including the prior attempt's implementation. Remove the three task-created files only if they contain no later work. Do not reset the worktree or replace unrelated changes. A newer `dev` must be reconciled manually by the integrator as assigned.

Next bounded action: PM collects these exact five source artifacts, restores access to the assigned Git objects/dependencies and frozen reference outside this sandbox, and sends the candidate for independent QA covering D1–D6 and actual UI/effect behavior. PM owns publication and durable result permalinks. This author handoff does not authorize another slice, release or PROD effects.
