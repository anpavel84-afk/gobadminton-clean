# #458 LevelGuide — beginner level help (pass3 scale/version identity)

From: Cursor Auto (`OWNER_NIGHT_BEGINNER458_LEVEL_GUIDANCE_DEV`, attempt 3, base `ce592050745a4367d07fccbf0615c083cdd58c83`).
To: PMA changed checks (types/lint + targeted vitest) → independent Sol Medium **bounded** closure review of **LG458-01** + related delta (not whole-feature re-audit) → Product CI → DEV accept/smoke → Owner UAT.
Status: **SOURCE CANDIDATE** (LG458-01 repair). UAT = **NOT_TESTED**. No fake PASS. DEV/PROD publication by trusted process only.

## Pass3 correction (LG458-01)

Independent Sol Medium QA P2 on SHA `ce592050…`: control inferred ntrp from bare numeric `levelId` for valid foreign scales such as `{scaleId:'custom-club',scaleVersion:9,levelId:'3.0'}`, while no-op Save preserved the custom object — UI promised ntrp, Save did not apply it.

Fix (allowed paths only):

1. Typed draft `LevelGuideChoice` (`none` | `keep` | `ntrp` | `pilot`) with scale+version identity — preserved full level is a distinct control option from catalog ntrp/v1 and exact `gb-social-pilot`/v1 even when `levelId` collides.
2. Internal select token `LEVEL_GUIDE_KEEP_CONTROL` for keep; **never** persisted as `SocialLevel.levelId`. Explicit pick of ntrp/v1 `3.0` from stored custom-club/v9 `3.0` → `ntrp`/`v1`/`self_declared` on Save.
3. Exact pilot/ntrp catalog checks use scaleId+scaleVersion; foreign scales reusing `beginner` or half-step ids stay as keep — no silent coerce of unknown scales/versions.
4. Profile hydrates/reopens via `levelGuideChoiceFromProfile` (resets intent on actor/editor reopen). Discovery filter still raw ntrp id string; callsite maps to/from choice only.
5. Pure transition regression (collision no-op vs explicit) + SSR distinct preserved vs NTRP options. No pretend click/callback tests; no raw source-string coverage. Release catalog untouched.

## Product result

Reusable Russian **LevelGuide** for approximate self-declared ntrp v1 half-steps (1.0…7.0) with «Не знаю» / skip:

| Surface | Behavior |
| --- | --- |
| Profile edit | Typed chooser + optional details help; Save via existing `patchMySocialProfile` + `expectedVersion` + CSRF |
| Games discovery | Client list filter on loaded pages only; raw feed/cache/`loadMore` unchanged; map honesty note when filter active |

No new API/schema/rating/worker/auth. No auto-write on open/help. No auto-filter from profile. No release/version/API contract change in this pass.

## Key paths

| Area | Path |
| --- | --- |
| Lib | `apps/web/src/lib/level-guide.ts` |
| UI | `apps/web/src/components/consumer/LevelGuide.tsx` |
| CSS | `apps/web/src/styles/level-guide.css` (unchanged this pass) |
| Profile | `apps/web/src/components/consumer/pages/ProfilePage.tsx` |
| Discovery | `apps/web/src/components/consumer/pages/GamesDiscoveryPage.tsx` |
| Tests (CI include) | `apps/web/test/level-guide-logic.test.ts`, `apps/web/test/level-guide.test.tsx`, `apps/web/test/fr03-players-profile.test.tsx` |
| Handoff | `docs/handoffs/levelguide458.md` |

## Invariants

- Explicit numeric choice → `ntrp` / `v1` / `self_declared` (never wrap as `gb-social-pilot`)
- Keep / no-op → preserve full existing `SocialLevel` object (scale/version/value)
- Exact `gb-social-pilot`/v1 symbols retained in profile chooser; foreign symbol reuse ≠ pilot
- Discovery membership: inclusive normalized half-step ∈ `allowedLevelIds` only when `scaleId=ntrp` && `scaleVersion=1`
- Legacy/other scales: not claimed compatible; disclosed in UI keep option
- Map does not apply level filter (honest helper, same pattern as trainer)

## Versioning

- Release catalog / alpha.23 / API 0.30.0 **not modified** this pass (out of allowed repair scope)
- Historical seed alpha.22 @ `e637e937…` / `r41818484518-a1` remains as previously delivered

## Author checks

Source-only in worktree. No Git / network / install / live / root. Node modules absent here — PMA runs changed vitest suites + types/lint. Native status is not PASS. Pass3 claims LG458-01 source fix + targeted regressions only; not interaction/network UAT.

## UAT

Owner authenticated / physical-device = **NOT_TESTED** until real check.
