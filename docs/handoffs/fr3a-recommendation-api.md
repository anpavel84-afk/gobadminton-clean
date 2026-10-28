# Issue #181 / FR-3A source handoff — Mode A author pass 3/3 (Owner 28.10.2026)

From: Cursor Auto author attempt 3 (`OWNER_LEAN_MODE_A_FR3A_EXISTING_CI_FIXTURES`). To: trusted ephemeral PostGIS checks, then one Medium delta QA + mandatory CI.
Status: SOURCE DRAFT / NOT_TESTED / NOT ACCEPTED.
Preserved history: prior FAIL **FR3A-QA-001** (temporal lock revalidation) repaired on pass 2 and left unchanged this turn; CI focused log `181-ci1-focused-failures.txt` (2 disposable failures after other first-candidate CI jobs PASS). No Astra; no new framework.
Assignment: Mode A #181 final authorized prospective pass 3/3; #284 third Mode A delivery replacement; preserve old C5 attempt3 / raw history; no budget reset. Author calls this turn: 3 of max 3.

Product base `777c88f96706c38e6f76d35a55a1a1cb2138a1ec`; candidate base `e491f33d126032a2b2d1e8127c83dc7c415a7501`.
Work limited to allowed_paths in the CLEAN tree. No Git writes, network, secrets, package install,
DB/SQL/runtime, frontend/OPS, UI182, production auth/limit changes, C5, or unrelated test/architecture churn.
Pass 2 temporal QA-001 repair (service + disposable race shape + GAME_RECOMMENDATIONS_V001 note) remains untouched; this pass is test harness + factual handoff only.

## Exact CI FAIL addressed (fixture / expectation only)

Input: `181-ci1-focused-failures.txt` — disposable suite 34/36; exactly two failures.

1. **restriction `account.access`**: assertion expected 403, runtime 401.
   Current auth fence: `account.access` fails closed at session lookup / actor fence (`unauthorized` → 401) when the restricted actor is the caller. `profile.public` / `social.directory` still assert mutation capability `forbidden` → 403. Peer-side restriction keeps no-data inbox + neutral send 404. Fixture expects 401 only for `account.access`; 403 retained for the other two. No production auth change; no broadened status list.

2. **recipient rate fixture**: `FRIENDS_RECEIVE_LIMIT=1` was set before `accepted(c,b)`, so friend-request `friend.receive` hit the shared quota and returned 404 before recommendation API ran. Friendship fixture is built while receive quota is still open, then receive limit is lowered; assertion targets real `game.recommend` recipient-cap neutral 404 and no inserted game row. Existing sender 429 + duplicate unbilled 200 retained. Production limits not raised/disabled; counters not erased.

## Changed files (this turn)

1. `apps/api/test/integration/game-recommendations.disposable.test.ts` — restriction status split; rate friendship-before-quota order
2. `docs/handoffs/fr3a-recommendation-api.md` — this handoff

## Unchanged (pass 2 must remain)

- `apps/api/src/game-recommendations/game-recommendations.service.ts` (temporal post-lock revalidation)
- Disposable race cases for expiry / game-start lock wait
- `docs/api/GAME_RECOMMENDATIONS_V001.md`

## Checks

Source-only fixture repair against the focused CI log and current auth/rate practices. `node_modules` / disposable DB / typecheck / lint / unit / contracts / Product CI: **NOT_TESTED** in this author sandbox. Do not treat this handoff as PASS. Prior FR3A-QA-001 repair is not re-validated here (**NOT_TESTED** this turn for unactioned suites beyond the two fixture cases).

## Limits / out of scope

- No delete/skip/`.only`, no Astra, no broad matrix, no new framework/scheduler/review stream.
- No production auth behavior change for stale expectation; no raise/disable of production rate limits.
- No migration / UI182 / OpenAPI / packages / deploy / Git / DB / network / install / root.
- Mode B / main / cleanup / further migration deferred.
- C5 remains off; #361 parked.
- DONE needs independent Medium delta QA + CI + DEV release/smoke under Mode A — not author self-check.

## Acceptance transfer

Trusted ephemeral PostGIS must re-run the disposable suite on the exact new candidate; independent Medium QA verifies the two fixture fixes (criteria + diff + related risks) without regressing pass 2 temporal repair. PROD only by separate Owner decision. Next independent task after DONE/BLOCKED is PMA-assigned.
