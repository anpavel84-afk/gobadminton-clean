# MAP-PERF1 — Games map module loading

- From: source author (Codex), task worktree `issue-151`.
- To: PM, for independent QA and publication outside the author sandbox.
- Date: 2026-10-21.
- Status: WORKING_DRAFT / SOURCE_ONLY; implementation and tests authored, execution checks unavailable. NOT independently QA verified, NOT accepted, NOT deployed.
- Assignment: immutable `GOBADMINTON_AUTONOMY_V1`, `source_only`, target `dev`, MAP-PERF1, lock `web:games-map-loader`, no prior independent QA supplied (`{}`). No historical PASS claimed.
- Exact assigned base: `9d3e092cc30796ffc0096c50584a771e60c18ef3` (`dev` per assignment). [Base reference](https://github.com/anpavel84-afk/gobadminton-clean/tree/9d3e092cc30796ffc0096c50584a771e60c18ef3).

## Scope and source facts

Only these five task paths were edited/created:

1. `apps/web/src/components/consumer/games/GamesMapView.tsx`
2. `apps/web/src/styles/discovery.css`
3. `apps/web/src/components/consumer/games/GamesMapModuleLoading.tsx` (new)
4. `apps/web/test/games-map-module-loading.test.tsx` (new)
5. `docs/handoffs/slots-loader-games.md` (new)

Repository rules and the exact supplied assignment were read. The assignment's offline/source-only limits override general publication instructions: no commit, push, Git metadata edits, dependency installation, service changes, deployment or network publication was performed. This handoff and the two other new files are uncommitted worktree artifacts; PM must include them when collecting the task. There is no result commit or published artifact permalink yet.

The worktree `.git` points to `/srv/gb-slots/slot1/repo/.git/worktrees/issue-151`. Its HEAD file names `refs/heads/automation/issue-151`; that loose ref contains the assigned base SHA above. However, `git show -s --format='%H %D' HEAD` failed with exit 128 (`fatal: bad object HEAD`), because Git cannot normalize the alternate object path `/srv/gb-slots/base.git/objects`. Object-level base verification and a reliable initial Git dirty/staged-state assessment were unavailable. Initial `git diff --name-only` / `git diff --cached --name-only` emitted object-store errors; their path output is not evidence of unrelated edits. Git metadata was left untouched. No additional writer or executor was started.

Before edits, the loading component, new test and this handoff were absent. Initial SHA-256 of the two existing allowed files:

- `GamesMapView.tsx`: `f18fe80c238d1913988f68fdd360354dc36a0a3c66f7581f80fd7c106d763cfd`
- `discovery.css`: `1c6ba4202aae4f68a92dc4dbd035ca799b7d08f8a046c34f81c5a1f062c5dee4`

## Implementation / D1–D5

These are authored source/test descriptions, not executed acceptance results.

- **D1:** the exact five-file scope above includes the implementation and a substantive new SSR/Vitest test. No existing tests or configuration were edited.
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
| `git diff --check` | 128 | NOT_TESTED: unavailable alternate object store; Git could not inspect the diff. |

Git's substantive output was:

```text
error: unable to normalize alternate object path: /srv/gb-slots/base.git/objects
fatal: unable to read a120726b0e8b583379afb9c7369c0ca0e4b318b5
```

The `node_modules` directories at the root and `apps/web` were also absent. No dependencies were installed and no settings were changed. The required installed-Next guide under `apps/web/node_modules/next/dist/docs/` could not be read. There were no executed compiler, lint or test-suite results to classify as source PASS or source FAIL. Code and tests remain for external execution. These author command attempts are not independent QA, CI evidence or Owner acceptance.

## STYLE_GUIDE_PARITY

- Authority read: `docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md`; canonical families requested by the assignment are ConstructionKit → Feedback & loading → Skeleton / Progress and EmptyState / ErrorState, including `.progress-set` / `.indeterminate`, `progressMove`, `.empty-error-family`.
- **UNVERIFIED:** `/opt/gobadminton-clean-qa/style-guide/src/App.tsx` and `/opt/gobadminton-clean-qa/style-guide/src/index.css` were unavailable (`No such file or directory`). The referenced `docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md` was also absent. No visual parity PASS is claimed.
- Progress uses the task's explicit geometry/motion and existing `consumer-tokens.css` palette. ErrorState is a local alert composition of existing `SurfacePanel`, heading, explanation and outline `Button`, with the existing parent return action and availability-dependent list retained. No shared component named `ErrorState` was present in this checkout; no shared primitive was created or edited. Exact canonical ErrorState fidelity remains UNVERIFIED pending the frozen reference.
- Screen-specific composition: the existing `GamesMapView` catalogue statuses, return capsule and fallback disclosure are retained, and the temporary shell occupies the existing map-area flex slot until module resolution. Successful `GamesVenueMap` keeps its own shell. Applicability is limited to module wait/import failure; tile readiness and catalogue readiness are separate.
- `STYLE_GUIDE_GAP`: none asserted; missing access to the reference is not evidence of a missing canonical pattern.
- `OWNER_VISUAL_OVERRIDE`: none asserted. The assigned dimensions/tokens are implemented without inventing new palette values or viewport geometry.

## Limits, rollback and next recipient

Browser/iPhone rendering, real React effects, populated-list disclosure after failure, actual Next transitions/chunk behavior, module timing, tile loading and visual comparison are **NOT_TESTED**. Test execution, TypeScript and lint remain **NOT_TESTED** for the exact environment reasons above. Independent QA/CI/acceptance are pending.

Rollback is for the integrator: remove only this task's additions to `GamesMapView.tsx` and appended local rules in `discovery.css`, and remove the three new task files if they contain no later work. Do not reset the worktree or replace unrelated changes. A newer `dev` must be reconciled manually by the integrator as assigned.

Next bounded action: PM collects these exact five source artifacts, restores access to the assigned Git objects/dependencies and frozen reference outside this sandbox, and sends the candidate for independent QA covering D1–D6 and actual UI/effect behavior. PM owns publication and durable result permalinks. This author handoff does not authorize another slice, release or PROD effects.
