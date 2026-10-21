# M3-PHOTO-R2 #144 — CI repair of candidate 2f5ac944

From: Codex source author
To: GoBadminton integrator / independent QA
Date: 2026-10-21
Status: WORKING_DRAFT — NOT_TESTED — NOT APPROVED

## Exact assignment and base

This supplement records only the authorized repair of CI run 39520227812,
attempt 1, source (web), unit-test step. Actual starting HEAD:
`2f5ac94422ecd449a02c9745ea53cfd7f536848c`, branch `automation/issue-144`.
Initial tracked diff was empty. The original requested DEV base remains
`f50eb6f0f1703efabe86ef1de5b8f42948fc4497`; no integration against newer DEV
was performed. Prior independent QA PASS applies only to the supplied starting
SHA and is user-reported, not independent evidence for this repair.

The immutable assignment and CI repair note supplied by the owner authorize
source-only edits in allowed_paths, offline checks, and a handoff. No commit,
push, Git metadata mutation, dependency installation, automation/service change,
network deployment or PROD action was performed. The previous handoff remains
unchanged; this supplement supersedes its layout-effect description only.

## Repair facts and acceptance continuity

- D1: repair edits only SelectedVenueCover.tsx and the two assigned new tests,
  plus this new handoff. All other candidate changes are retained.
- D2–D3: name-only alt updates now use the existing useEffect lifecycle supported
  by the old hand-rendered suites, instead of reaching the real React dispatcher
  through useLayoutEffect. The resource test harness runs that effect at commit.
  Resource identity still excludes name. Native image creation, eager/async
  ordering, source assignment, slot priority/movement, fallback, generation
  invalidation and final-ref cleanup are unchanged. Render remains free of DOM
  effects; no production test detection or dummy hook was added.
- D4: lifecycle transport mock now exports apiFetch with its real imported
  function type. It returns a typed unavailable-transport result, without a real
  request. This supplies the UnifiedDirectoryController constructor dependency
  reached through RadarSessionProvider/RadarPage. Existing venue/game transport
  responses and all gesture, focus, map, privacy and navigation assertions remain.
  The click helper still selects the actual button by tag before matching text.
- D5: real GamesVenueMap and GeographicRadarMap, distinct dynamic loader wrappers,
  synchronous hoisted loader registration, post-import resolution, Fragment
  narrowing and traversal/settle limits are unchanged. No await import cycle,
  skipped assertion, timeout expansion, new cast or test/config/dependency change
  was introduced.
- D6: the exact required checks were attempted below. None could start through
  the unavailable offline pnpm launcher. These are NOT_TESTED, never PASS.
  Author checks do not constitute independent QA.

## Commands / exits / output

Executed from the repository root:

```text
COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec tsc -p tsconfig.json --noEmit --incremental false
exit 1

COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web run lint
exit 1

timeout --kill-after=5s 60s env COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec vitest run --no-cache test/selected-venue-cover.test.tsx test/venue-photo-lifecycle.test.tsx
exit 1 (collection did not start; not exit 124)
```

Each command emitted:

```text
! Corepack is about to download https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz
Network access disabled by the environment; can't reach https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz
```

The full web unit suite is NOT_TESTED: the same pnpm launcher is unavailable,
so the conditional subsequent full-suite execution cannot start. No network or
installation workaround was attempted. Required on a provisioned exact candidate:
the focused command above, then `COREPACK_ENABLE_NETWORK=0 pnpm --filter
@gobadminton/web run test:unit`, plus typecheck/lint and complete standard CI.

Whitespace evidence: `git diff --check` and
`git diff --no-index --check /dev/null docs/handoffs/M3-photo-loading-r2-ci-repair.md`;
results recorded in the final author response.

## STYLE_GUIDE_PARITY and limits

MediaBlock / BottomSheet patterns and existing cover classes/composition remain
unchanged. Make composition and STYLE_GUIDE_PARITY: UNVERIFIED; the assigned
frozen App.tsx is unavailable locally, and the operations Style Guide document
is absent in this checkout. No STYLE_GUIDE_GAP or OWNER_VISUAL_OVERRIDE is claimed.
Browser/iPhone/flicker: NOT_TESTED, no measurements. Cold-network completion is
not promised instant. Contacts #142, CSS, API/DB/contracts/auth, workflows and
all existing tests are untouched.

## Integration / rollback

Next bounded action: integrator publishes the repaired candidate with exact SHA
and GitHub permalinks, then obtains independent QA on that SHA and complete web
Product CI. An unchanged CI rerun is insufficient. No acceptance, deployment or
independent QA is claimed here. Publication is prohibited in this author session,
so SHA/permalinks for the repaired result must be added by the integrator.

Rollback: reverse-apply only this repair diff, preserving the original candidate
and unrelated work. The previous M3-photo-loading-r2.md remains historical
context; this supplement supplies the current repair evidence without rewriting it.
