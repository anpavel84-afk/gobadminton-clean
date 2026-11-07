# #498 — late valid map load recovery (point 3) + StyleGuide UI / release.40 candidate

Refs: Owner remaining-backlog train assignment `OWNER_REMAINING_TRAIN_MAP498_AND_PUSH496_STYLEGUIDE_UI_RELEASE40`; prior `OWNER_REMAINING_TRAIN_MAP498_RECOVER_LATE_VALID_LOAD`; visual-qa / Go Bad report on DEV `298917fe` (alpha.38); PMA Chromium diagnosis. Combined with observed #496 UI repair (same writer).

## Point 3 — pass 1 FAIL → pass 2 repair (source) — retained

**Pass 1 (reviewed `9263ed0c`, independent QA FAIL P1):** Startup timeout set `fatal=true` + `timeoutPending`, so a later genuine fatal (`error` kind style, or WebGL after grace) was ignored by `fail()`. A subsequent `load` of the same attempt still saw `timeoutPending` and cleared the banner / restored availability, erasing the real failure.

**Repair (control-flow only; preserved on base `c5c73ef0`, do not alter this pass):**
- Real fatal after a pending startup timeout **replaces/supersedes** the timeout (`timeoutPending` cleared; diagnostic updated).
- Late `load` recovers **only** a timeout-only pending failure with **no** active WebGL context-restore grace (`deadline` unset) and no superseding fatal.
- Context loss after timeout still opens the existing 4s restore grace; load during grace does not stale-set availability true; restore within grace re-enables timeout→load recovery; grace expiry becomes sticky webgl fatal.
- Unchanged: genuine fatal / retry / city / unmount fences; markers alone do not clear failure; 20s budget unchanged.

**Regression:** `apps/web/test/games-venue-map-lifecycle.test.tsx` — timeout→late load (recover); timeout→style→load (stay fatal); timeout→webglcontextlost→late load during grace (no recover) + restore-within-grace then load (recover); timeout→webgl grace expiry→late load (stay fatal). Prior true-fatal / retry / city / unmount cases retained.

**Files (pass 2):** `GamesVenueMap.tsx`, `games-venue-map-lifecycle.test.tsx`.

## Pass 3 — bounded UI + alpha.40 catalogue candidate (this author pass)

- Actual DEV alpha.**39** is **ACCEPTED** (`PR499` / SHA `01ea6f2f` / `r42359322474-a1`); trusted seed appended EXACT; current catalogue bumped to **alpha.40** / API **0.37.0** unchanged; current `source_sha` / accepted date **null**, Owner UAT **NOT_TESTED**.
- Release fixes (candidate only): late validated map load clears stale startup timeout without masking real errors; game-event notification settings use canonical StyleGuide toggles (see `push496-games.md`).
- **Does not claim** idle venue polling / city selector fixed (points 1/2/4 remain not reproduced / Go Bad pending).
- Prior 498 source QA FAIL P1 retained in history; **do not claim combined independent QA PASS** for this pass.

## Points 1 / 2 / 4 — remain OPEN (Go Bad)

PMA cold Chromium on DEV38/`298917fe` did **not** reproduce idle venue polling bursts, multi-request focus coalescing defects, or a separate fullscreen city selector in the current DOM. Go Bad findings for 1/2/4 remain open / auth-pending; this pass does **not** rewrite polling, coalescing, or city selection, and does not declare those PASS.

## Evidence limits

- No CI / DEV ACCEPTED / provider-real / physical iPhone / GoBad / Owner UAT claim from this author lane.
- No LIVE deploy/API/DB/Git/model/network calls in this author pass. Independent QA + Product CI + DEV smoke remain required before DONE.
