# Issue 92 — M1e source handoff

From: source author. To: PM / independent QA. Date: 2026-10-19.
Status: READY_FOR_REVIEW source candidate; execution evidence NOT_TESTED. No acceptance or deployment claimed.

## Assignment and provenance

Implement only GOBADMINTON_AUTONOMY_V1 Issue 92, successor of parked #90 / PR #91 (three attempts; prior QA failure dc1d1b9f). Target dev, source_only. Reapply the M1c fullscreen shell from local PR #89 candidate, exclude M1d marker work, add mandatory C1/C2 Vitest coverage, attempt web unit/lint/typecheck/build, and record C1–C7 evidence. No API, DB, contracts, dependencies, automation, secrets, services or PROD changes. No additional task or self-QA.

Repository: anpavel84-afk/gobadminton-clean; branch automation/issue-92.
Exact base: `1d24f50dc8cb16c3f05f9611b840d5a9790c3bcf`; initial working tree clean.
Source: `0ce158e062d4509e8528abbbf33b520a21210ecf`.

Read-only command `git cat-file -t 0ce158e062d4509e8528abbbf33b520a21210ecf` returned:

```text
commit
```

Remote-tip check cancelled by assignment. No fetch/pull/clone/checkout/reset/stash, index writes, commit or push performed. Whole-file source contents were read through `git show` and written to allowed worktree paths. Partial GamesVenueMap changes include only error-card visibility callback/effect and sr-only status. The lifecycle test adds only matching error-card assertions. CSS copies only capsule/fullscreen/sr-only rules from radar-geographic.css; source venue-schedule-card.css contains marker-only additions, so none were copied.

Base reference: https://github.com/anpavel84-afk/gobadminton-clean/tree/1d24f50dc8cb16c3f05f9611b840d5a9790c3bcf
Source reference: https://github.com/anpavel84-afk/gobadminton-clean/tree/0ce158e062d4509e8528abbbf33b520a21210ecf
Candidate has no commit permalink: this assignment explicitly prohibits commit/push. PM must publish the allowed source diff and this record through the authorized delivery route.

## Changes and criterion evidence (implementation mapping, not QA verdicts)

All application/test paths below are relative to `apps/web/`.

| Criterion | Source | Test / evidence |
| --- | --- | --- |
| C1 | `src/components/consumer/games/GamesMapBackButton.tsx`: once-per-mount focus with preventScroll; dialog and existing control focus respected. Removed source candidate's sidebar/list-control exception because those are real controls. | New `test/games-map-back-focus.test.tsx`: duplicate effect setup plus rerender, dialog, existing control focus. `test/games-map-late-location.browser.mjs`: delayed location mount and overlay. |
| C2 | `GamesMapView.tsx`: single capsule before snapshot, working map and unsupported city; hide while M0 card owns return. `GamesVenueMap.tsx` reports card visibility on failure/retry/unmount. | `test/games-map-refresh.test.tsx`: pending, working, error, retry, other city and Moscow reinit. `test/games-map-shell.test.tsx`: one explicitly named button. `test/games-venue-map-lifecycle.test.tsx`: real M0 failure, retry rebuild, card return callback. |
| C3 | `src/styles/radar-geographic.css`: fullscreen map area and >=44px capsule. | `test/games-map-layout.browser.mjs`: 390/430/768/1024/1440, height changes and rotation; actual canvas dimensions, frame edges, scroll/overflow, attribution, capsule target/bounds. No zoom requirement or global-disable comments. NOT_TESTED browser geometry. |
| C4 | `src/components/consumer/pages/GamesDiscoveryPage.tsx`: list-only search; no map context/activity toolbar. `GamesMapView.tsx`: no map help/refresh/legend. `GamesViewAction.tsx`: null for map, original list entry. | `test/games-map-shell.test.tsx`; layout browser script checks old controls absent and list entry/create banner preserved. List feed remains hidden while map is active. |
| C5 | Page capsule callback invokes changeView('list'), pushes history; popstate and Escape retained. Map camera/Radar/marker resource lifecycle and Moscow guard retained. `src/lib/games-venue-map.ts` and separateMarkerPoints untouched. | Late-location browser script covers return and Browser Back; layout script covers return/map entry and attribution. Existing lifecycle test retains marker/rebuild assertions. Browser execution NOT_TESTED. |
| C6 | Real source diff includes new back button, GamesMapView, GamesDiscoveryPage, GamesViewAction, limited GamesVenueMap/CSS and tests. Only allowed paths edited; no dependency changes. | Four required checks attempted; all blocked before tool execution as detailed below. |
| C7 | This `docs/handoffs/ISSUE_92_M1E.md`. | Local source commit result above, explicit NOT_TESTED inventory below. |

## Commands and output

Initial context commands: `pwd` returned `/srv/gobadminton-clean/worktrees/issue-92`; `git status --short` returned no entries; `git rev-parse HEAD` returned base SHA above; `git branch --show-current` returned `automation/issue-92`. Local `git show` / `git diff` reads supplied source/partial-file content; no remote verification.

Each required check below exited 1 in Corepack before its requested executable ran:

```text
pnpm --filter @gobadminton/web run test:unit
pnpm --filter @gobadminton/web run lint
pnpm --filter @gobadminton/web run typecheck
pnpm --filter @gobadminton/web run build
```

All four produced the same diagnostic (Node.js v24.21.0):

```text
! Corepack is about to download https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz
Error: Error when performing the request to https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz
[cause]: [TypeError: fetch failed]
[cause]: Error: getaddrinfo EAI_AGAIN registry.npmjs.org
errno: -3001
code: 'EAI_AGAIN'
syscall: 'getaddrinfo'
hostname: 'registry.npmjs.org'
```

NOT_TESTED: unit tests, lint, typecheck and build, because the pinned package manager was unavailable locally and Corepack's registry DNS request failed. No installation workaround or test weakening performed.
NOT_TESTED: `games-map-layout.browser.mjs`, `games-map-fallback.browser.mjs`, `games-map-late-location.browser.mjs` and other browser scripts: source-only assignment, no authorized browser/server session or DEV origin supplied, no service startup/deployment permitted. Physical iOS, safe-area behavior on physical hardware, real tiles/WebGL, Radar interaction and end-to-end history/camera behavior remain NOT_TESTED. No independent QA performed by source author.

## STYLE_GUIDE_PARITY

Binding authority: `docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md`, frozen Make `https://nougat-wise-76949869.figma.site/#guide` / `#construction-kit`. Reused existing white pill map-return primitive, semantic tokens, arrow accent, existing list map-entry capsule, fullscreen map and Radar composition. Only the assignment's explicit map-only shell reduction and capsule were applied. No new visual pattern or claimed new Make inspection. `docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md` is absent and ignored as explicitly directed. STYLE_GUIDE_GAP: none introduced. OWNER_VISUAL_OVERRIDE: no additional override inferred.

## Continuity / rollback / next action

FACT: worktree source and test artifacts exist; source commit exists locally; required checks could not execute. No product acceptance, passing tests, independent QA or runtime release is asserted. No M1d marker separation/selection changes may be inferred from this handoff.

Rollback: restore only this task's allowed changed/new files from exact base contents using read-only `git show` and worktree writes (remove task-new files only). Preserve any later writer's changes; no Git metadata mutation is needed.

Next bounded action: PM publishes this source candidate and handoff, then independent QA runs C1–C7 against that exact revision in a dependency-equipped environment, including browser geometry and physical-iOS gaps. No automatic next implementation slice or PROD authorization.
