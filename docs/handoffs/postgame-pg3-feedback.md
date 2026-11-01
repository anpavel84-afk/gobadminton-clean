# Issue #372 / PG-3 Private reviews + personal notes — Mode A author handoff

From: Cursor Auto (`OWNER_APPROVED_PG3_PRIVATE_FEEDBACK_PERSONAL_NOTES`, attempt 2, base `c6586109e225fb1c6c5a9eeeae48055636b1e95f`).
To: one independent Codex Sol Medium QA → mandatory Product CI → trusted DEV release/smoke.
Status: **SOURCE CANDIDATE (narrow repair)** / UAT=NOT_TESTED / PG-3 writes default **OFF** / **NOT READY** / no DEV claim / no PROD.
Parent #372 PG-3 slice only. PG-4 and #394 not done. Mode B binding NOT claimed. Author checks ≠ independent QA.
Immutable older SQL / privacy / auth / history restrictions preserved. No new feature or semantics change.

## Pass-1 DBFAIL (real defect — expected narrow repair)

Disposable compound exactflow FAIL (pass 1 evidence
`disposable-game-feedback.disposable.log`, sha256
`30daeabc1135aa2ade92054a1edaa2055dc12d77f1f4808cda35d5545914f953`):

- Duplicate create after owned peer review: Postgres `23505` caught in
  `createReview`, then `findOwnedDuplicate` SELECT raised `25P02`
  (current transaction is aborted) → HTTP **500** instead of owned
  receipt `200` or conflict `409`.
- Stack: `GameFeedbackService.findOwnedDuplicate` ← catch at service
  lines ~550–607 (pass-1 source) ← `MutationRunner` ← `createReview`.
- Assertion: `expected [ 200, 409 ] to include 500` at disposable test
  duplicate step. Flag-off write refuse still PASS.
- Classification: product/transaction defect on duplicate path, not process
  noise. No Astra diagnosis required (OD / assignment).

## Narrow repair (attempt 2)

Allowed paths only:

- `apps/api/src/games/game-feedback.service.ts` — after existing `games`
  `FOR UPDATE` lock: **precheck** owned duplicate → return `200` with
  **existing** projection (requested fields not applied); INSERT under
  **SAVEPOINT** `game_review_insert` so a late `23505` can
  `ROLLBACK TO SAVEPOINT` then owned lookup / `FEEDBACK_DUPLICATE` `409`
  without aborting the outer txn (`25P02`). Unrelated DB errors still
  rethrown after savepoint rollback. UNIQUE indexes unchanged.
- `apps/api/test/integration/game-feedback.disposable.test.ts` — same
  compound flow; duplicate step asserts `200` keeps original
  `peerRating` (`play_again`), not the replay payload (`neutral`).
- This handoff.

## Checks (author, attempt 2)

- `@gobadminton/api` typecheck — **PASS**
- api unit `test/unit/game-feedback.test.ts` — **PASS** (6)
- Disposable PostGIS compound re-run — **trusted operator** owns disposable DB
  (author has no owned disposable `DATABASE_URL` for this pass)
- Product CI / independent QA / DEV smoke / Owner UAT — outstanding

## Remaining runtime gates

- Independent QA of this narrow repair candidate
- Disposable integration re-run on owned PostGIS (duplicate path + full compound)
- Product CI + trusted DEV deploy/smoke + flag activation
- Owner UAT = NOT_TESTED
- Typed review Safety complaint extension = **remaining**
- PG-4 / #394 later

## Non-goals / stops

- No PROD, main promotion, C5, Mode B READY, whole-parent close
- No AGENTS/Git/runtime/PROD changes by author; no secrets
- No edit of applied/immutable older SQL; no new engine/framework
- No whole-suite rerun; no test relaxation; no swallowing unrelated DB errors
