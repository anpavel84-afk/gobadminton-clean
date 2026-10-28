# Issue #181 / FR-3A source handoff — Mode A repair pass 2/3 (Owner 28.10.2026)

From: Cursor Auto author attempt 2 (`OWNER_LEAN_MODE_A_FR3A_QA001_REPAIR`). To: independent QA (Codex Sol Medium), then trusted publish/CI/DEV route.
Status: SOURCE DRAFT / NOT_TESTED / NOT ACCEPTED.
Preserved FAIL: **FR3A-QA-001** (P2/medium, blocking) on exactsource `c339bb6`. No Astra; no new framework.
Assignment: Mode A #181 repair; #284 third Mode A delivery replacement; preserve old C5 attempt3 / raw history; no budget reset. Author calls this turn: 2 of max 3.

Product base `777c88f96706c38e6f76d35a55a1a1cb2138a1ec`; prior candidate base `c339bb6e72b5ffce32fdee7e4b016b562ed3cac3`.
Work limited to allowed_paths in the CLEAN tree. No Git writes, network, secrets, package install,
DB/SQL/runtime, frontend/OPS, UI182, old 0040, C5, or unrelated test/architecture churn.

## Exact FAIL addressed

`FR3A-QA-001`: Send and same-key replay could confirm expired / no-longer-upcoming recommendations
after waiting on the Recommendation row lock, because `ctx.now` and game eligibility were captured
before `locate(..., true)` / direction `FOR UPDATE` and not refreshed afterward.

## This author turn (temporal revalidation)

After the final Recommendation row lock, both `replaySend` and existing-direction `send` now:
1. Re-read upcoming game eligibility via `GamesService.recommendationSummary` (Game SHARE already held).
2. Refresh DB clock with `clock_timestamp()`.
3. Re-run `current()` (expiry + relationship fences held earlier) / active/hidden/version checks before any sent receipt.

Same-key replay still fails closed with generic 404. Expired duplicate direction still uses documented
stale/conflict 409 when the game remains upcoming. No lock-order inversion; authorization fence fields
retained. Fresh-insert temporal checks unchanged.

Focused disposable regressions (reuse existing harness): terminal-style uncommitted `FOR UPDATE` holder
on the recommendation row; observe real PG lock waiter; cross expiry or game start; holder `ROLLBACK`;
assert no sent receipt (replay 404; expired duplicate 409; start-crossed duplicate 404).

Docs: `GAME_RECOMMENDATIONS_V001.md` notes post-lock clock/game revalidation. This handoff updated.

## Changed files (this turn)

1. `apps/api/src/game-recommendations/game-recommendations.service.ts`
2. `apps/api/test/integration/game-recommendations.disposable.test.ts`
3. `docs/api/GAME_RECOMMENDATIONS_V001.md`
4. `docs/handoffs/fr3a-recommendation-api.md`

## Checks

Source-only review of the temporal repair and disposable race shape. `node_modules` / disposable DB /
typecheck / lint / unit / contracts / Product CI: **NOT_TESTED** in this author sandbox. Do not treat
this handoff as PASS. Prior candidate11 unit/typecheck/lint/contracts PASS and in-flight Product CI
are not acceptance for this repair SHA.

## Limits / out of scope

- No Astra diagnostics, no new scheduler/framework/review stream.
- No migration 0040 / UI182 / OpenAPI / packages / deploy / Git.
- Mode B / main / cleanup / further migration deferred.
- C5 remains off; #361 parked.
- DONE needs independent QA + CI + DEV release/smoke under Mode A — not author self-check.

## Acceptance transfer

Independent Medium QA must verify FR3A-QA-001 is fixed on the exact candidate (criteria + diff +
related risks), including disposable races. PROD only by separate Owner decision. Next independent
task after DONE/BLOCKED is PMA-assigned.
