# #458 LevelGuide — beginner level help (pass2 test-quality)

From: Cursor Auto (`OWNER_NIGHT_BEGINNER458_LEVEL_GUIDANCE_DEV`, attempt 2, base `b7ae4c175fe8e9eb3e065e3abd60d79ef3ca09dd`).
To: PMA changed tests/types/lint → independent Codex Sol Medium full-feature QA → Product CI → DEV accept/smoke → Owner UAT.
Status: **SOURCE CANDIDATE** (narrow test-path repair only). UAT = **NOT_TESTED**. No fake PASS. DEV/PROD publication by trusted process only.

## Pass2 correction (test quality only)

No app/UI/lib/version/API/schema changes. Only listed test/handoff paths.

1. Critical pure helper tests moved from `apps/web/src/lib/level-guide.test.ts` (outside vitest `include`) to `apps/web/test/level-guide-logic.test.ts` so Product CI discovers them. Old colocated file deleted (not duplicated). Existing `releases.test.ts` baseline untouched.
2. `test/level-guide.test.tsx`: removed tautological direct `tree.props.onChange(spy)` block and unused `ReactElement`/`vi` imports; removed separate-render actor-switch pretend interaction. Retained SSR markup checks: accessibility/options/disabled/known+unknown rendering.
3. Deleted `test/level-guide-integration.test.tsx` (source-string `toContain` mirrors, HTML-without-fetch ≠ network proof, duplicated helper asserts). Parent wiring / current actor / explicit Save remain for independent content QA and PMA installed/local browser with synthetic transport — not claimed as interaction proof from raw source strings.

Honest limits: pure invariants now under actual CI include; SSR proves markup only, not actor/interaction/network UAT.

## Product result

Reusable Russian **LevelGuide** for approximate self-declared ntrp v1 half-steps (1.0…7.0) with «Не знаю» / skip:

| Surface | Behavior |
| --- | --- |
| Profile edit | Controlled chooser + optional details help; Save via existing `patchMySocialProfile` + `expectedVersion` + CSRF |
| Games discovery | Client list filter on loaded pages only; raw feed/cache/`loadMore` unchanged; map honesty note when filter active |

No new API/schema/rating/worker/auth. No auto-write on open/help. No auto-filter from profile.

## Key paths

| Area | Path |
| --- | --- |
| Lib | `apps/web/src/lib/level-guide.ts` |
| UI | `apps/web/src/components/consumer/LevelGuide.tsx` |
| CSS | `apps/web/src/styles/level-guide.css` |
| Profile | `apps/web/src/components/consumer/pages/ProfilePage.tsx` |
| Discovery | `apps/web/src/components/consumer/pages/GamesDiscoveryPage.tsx` |
| Release | `apps/web/src/lib/releases.ts` → **alpha.23** / API **0.30.0** unchanged; historical **alpha.22** seed from #457 receipt |
| Tests (CI include) | `apps/web/test/level-guide-logic.test.ts`, `apps/web/test/level-guide.test.tsx`; plus fr01/fr03/owner-a discovery, releases* |
| Handoff | `docs/handoffs/levelguide458.md` |

## Invariants

- Numeric explicit choice → `ntrp` / `v1` / `self_declared` (never wrap as `gb-social-pilot`)
- Same `levelId` on Save → preserve existing `SocialLevel` object (unknown custom scale kept)
- Pilot beginner/intermediate/advanced retained in profile chooser
- Discovery membership: inclusive normalized half-step ∈ `allowedLevelIds` only when `scaleId=ntrp` && `scaleVersion=1`
- Legacy/other scales: not claimed compatible; disclosed in UI
- Map does not apply level filter (honest helper, same pattern as trainer)

## Versioning

- Current: `0.1.0-alpha.23`, `source_sha=null`, `owner_uat=NOT_TESTED`
- Historical seed appended: alpha.22 @ `e637e937…` / `r41818484518-a1` / digests from FINAL_RECEIPT
- Seeds 26 / deployments 31; FIRST_ALPHA_FEATURES=35; unnamed historical=2 preserved
- faa236 + 98f765 alpha.21 rows kept separate

## Style / gap notes (non-blocking)

Tokens: Onest / lime / ink from consumer scope. Compact details+select — no whole-page redesign, onboarding modal, or forced quiz. Style Guide excerpts approximate only per Owner supersession.

## Author checks

Source-only in worktree. No Git / network / install / live / root. Node modules absent here — PMA runs changed vitest suites + types/lint. Native status is not PASS. Pass2 does not claim interaction/network UAT.

## UAT

Owner authenticated / physical-device = **NOT_TESTED** until real check.
