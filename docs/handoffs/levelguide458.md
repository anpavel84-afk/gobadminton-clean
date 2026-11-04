# #458 LevelGuide — beginner level help (pass1)

From: Cursor Auto (`OWNER_NIGHT_BEGINNER458_LEVEL_GUIDANCE_DEV`, attempt 1, base `e637e937d7fa780983daaac92cbe22e26c82ef1b`).
To: PMA deterministic checks → independent Codex Sol Medium QA → Product CI → DEV accept/smoke → Owner UAT.
Status: **SOURCE CANDIDATE**. UAT = **NOT_TESTED**. No fake PASS. DEV/PROD publication by trusted process only.

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
| Lib | `apps/web/src/lib/level-guide.ts` (+ colocated unit test) |
| UI | `apps/web/src/components/consumer/LevelGuide.tsx` |
| CSS | `apps/web/src/styles/level-guide.css` |
| Profile | `apps/web/src/components/consumer/pages/ProfilePage.tsx` |
| Discovery | `apps/web/src/components/consumer/pages/GamesDiscoveryPage.tsx` |
| Release | `apps/web/src/lib/releases.ts` → **alpha.23** / API **0.30.0** unchanged; historical **alpha.22** seed from #457 receipt |
| Tests | `level-guide*.test.*`, fr01/fr03/owner-a discovery, releases* |
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

Source-only in worktree. No Git / network / install / live / root. Node modules absent here — PMA runs vitest for allowed suites. Native status is not PASS.

## UAT

Owner authenticated / physical-device = **NOT_TESTED** until real check.
