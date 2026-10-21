# M3-PHOTO-R2 #144 — source correction, attempt 2

From: Codex source author
To: GoBadminton integrator / independent QA
Date: 2026-10-21
Status: WORKING_DRAFT — NOT_TESTED — NOT APPROVED

## Assignment, base and scope

Exact assignment: supplied immutable GOBADMINTON_AUTONOMY_V1 task for M3-PHOTO-R2 #144, source only. This is attempt 2 within max3, not a reset. Prior independent QA reported FAIL on `320701ee19c837956908958b536c0d85d2b0262c`: lifecycle click lookup matched a parent container before its button.

Actual starting HEAD: `320701ee19c837956908958b536c0d85d2b0262c`, branch `automation/issue-144`; initial tracked diff empty. Requested original base `f50eb6f0f1703efabe86ef1de5b8f42948fc4497` differs from this checkout. No Git mutation or historical candidate lookup performed. Integrator reconciles newer DEV manually.

Only `apps/web/test/venue-photo-lifecycle.test.tsx` and this new handoff are changed by this correction. Existing implementation, resource test and original `M3-photo-loading-r2.md` remain in the checkout and are preserved. This is a source test correction, not a handoff-only diff. No network, installation, publication, automation, secrets, services or deployment changes.

## D1–D6

- D1: correction restricted to allowed test/handoff paths. The starting HEAD already contains the three component integrations, SelectedVenueCover and both required tests; this attempt does not recreate them.
- D2–D3: resource implementation and resource assertions unchanged. No new runtime evidence claimed.
- D4: `Harness.click()` now requests a host of type `button`. Matching descendant text on the single-venue group div can no longer intercept the venue selection. General `host()` lookup still supports container assertions. No click assertions or lifecycle cases removed; real component boundaries remain intact.
- D5: optional tag filtering occurs before label matching; a missing button or missing button handler throws explicitly. Dynamic loader registry, separate wrappers, Fragment narrowing, traversal and render/settle limits remain unchanged.
- D6: required author commands attempted once below. No typecheck/lint/test PASS claimed; these checks are not independent QA.

## Commands and results

From repository root:

```text
COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec tsc -p tsconfig.json --noEmit --incremental false
exit 1

COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web run lint
exit 1

timeout --kill-after=5s 60s env COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec vitest run --no-cache test/selected-venue-cover.test.tsx test/venue-photo-lifecycle.test.tsx
exit 1 (collection did not start; not exit124)
```

All three emitted exactly:

```text
! Corepack is about to download https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz
Network access disabled by the environment; can't reach https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz
```

Execution: NOT_TESTED because pnpm 10.18.0 is unavailable to Corepack offline. No installation or network workaround attempted. `git diff --check`: exit 0, empty output for tracked correction; new handoff checked separately with `git diff --no-index --check /dev/null docs/handoffs/M3-photo-loading-r2-attempt-2.md`, exit 0, empty output.

## STYLE_GUIDE_PARITY and limits

Existing patterns: MediaBlock (cover), BottomSheet (popup). This correction changes no presentation or CSS. Make / STYLE_GUIDE_PARITY=UNVERIFIED: assigned frozen App.tsx is absent; original handoff records both frozen files unavailable. No gap/override asserted. Browser/iPhone/flicker: NOT_TESTED, no measurements. Cold network completion remains browser-dependent.

## Continuity and rollback

Original implementation record: `docs/handoffs/M3-photo-loading-r2.md`; its original base/evidence describe the prior attempt, not this correction. Current scope and evidence are above. No new SHA or GitHub permalink exists under the no-commit/no-publication instruction. Integrator adds exact candidate SHA/permalinks, then obtains independent QA and full standard web Product CI on that exact SHA; workflows remain unchanged. No next slice authorized.

Rollback: reverse-apply only this correction diff, including removal of this new handoff; preserve the starting implementation and unrelated work.
