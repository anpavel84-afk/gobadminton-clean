# Issue #372 / PG-3 Private reviews + personal notes — Mode A author handoff

From: Cursor Auto (`OWNER_APPROVED_PG3_PRIVATE_FEEDBACK_PERSONAL_NOTES`, attempt 3, base `f88b633aa5722ea86757ba635107fc2a817c3dc9`).
To: trusted operator disposable re-run → one independent Codex Sol Medium QA → mandatory Product CI → trusted DEV release/smoke.
Status: **SOURCE CANDIDATE (narrow progress repair)** / UAT=NOT_TESTED / PG-3 writes default **OFF** / **NOT READY** / no DEV claim / no PROD.
Parent #372 PG-3 slice only. PG-4 and #394 not done. Mode B binding NOT claimed. Author checks ≠ independent QA.
Immutable older SQL / privacy / auth / history restrictions preserved. No new feature or public feedback/ratings/complaint policy. Shared form styling from pass1 unchanged.

## Inputs preserved

- PMA preQA findings (NOT independent QA): `preqa-findings.json` sha256 `c319f24f34f53dedb9ff24f2608d21c3dfaa615c0ba945b8ac1edeee65916096`
- First DBFAIL (pass1): duplicate `23505` → aborted txn `25P02` → HTTP 500; pass2 SAVEPOINT/precheck retained; migration **0048** unchanged proof retained.

## Narrow repair (attempt 3) — exact PMA findings

Allowed paths only:

### 1. `apps/api/src/games/game-feedback.service.ts` (PG3-PRE-01)

- `resolveAccessRole` still returns manager first (unchanged attendance API).
- Peer capabilities / `createReview` peer gate no longer require `role === "participant"`.
- New `ownEligibleParticipation`: concrete own row + `eligibleFromTransitions` (same historical proof as `loadPeerSubjects` / attendance roster).
- Playing organizer with proven eligible own participation can peer-create and see `canCreatePeer` / peerSubjects.
- Nonplaying manager and manager with merely pending (ineligible) context stay denied — no manager-as-participant inference.
- Authorize/replay, UNIQUE precheck+SAVEPOINT duplicate path, note create-vs-edit-after-revoke unchanged.

### 2. `apps/api/test/integration/game-feedback.disposable.test.ts` (PG3-PRE-02)

- Compound exactflow + first duplicate fix retained.
- No-skill / no-abuse: real before/after `COUNT(*)` equality on `trainer_profiles` and `abuse_reports`; no `typeof`/`catch`-to-PASS.
- New focused cases: playing-manager peer create/capabilities; negative nonplaying + pending manager; owner note read/edit/delete after manager revoke + foreign 404; new note create after revoke still forbidden.
- No disabled tests / blanket always-true.

### 3. This handoff

## Checks (author, attempt 3)

- `@gobadminton/api` typecheck — **PASS** (`tsc -p tsconfig.json --noEmit`)
- api unit `test/unit/game-feedback.test.ts` — **PASS** (6)
- Disposable PostGIS compound + new manager/note cases — **not run here**; trusted operator owns disposable DB (`DATABASE_URL` / `RUN_DB_INTEGRATION` unset in this author worktree)
- Product CI / independent Sol Medium QA / DEV smoke / Owner UAT — outstanding; **no CI/runtime/UAT/READY claim**

## Remaining runtime gates

- Independent Sol Medium QA of this narrow repair candidate
- Disposable integration re-run on owned PostGIS (duplicate path + compound + manager eligibility + note-after-revoke)
- Product CI + trusted DEV deploy/smoke + flag activation
- Owner UAT = NOT_TESTED
- Typed review Safety complaint extension = **remaining**
- PG-4 / #394 later

## Non-goals / stops

- No PROD, main promotion, C5, Mode B READY, whole-parent close
- No AGENTS/Git/runtime/PROD changes by author; no secrets
- No edit of applied/immutable older SQL; no new engine/framework
- No whole-suite matrix expansion; no public feedback/ratings/complaint policy change
