# Issue #372 / PG-1b Attendance + Notice + Recourse — Mode A author handoff

From: Cursor Auto (`OWNER_APPROVED_PG1B_ATTENDANCE_NOTICE_RECOURSE_VERTICAL_SLICE`, attempt 4, base `cb320a7f20965b0512d23022de2b1f8817c9e4f1`).
To: one independent Codex Sol Medium QA → mandatory Product CI → trusted DEV release/smoke.
Status: SOURCE CANDIDATE / pass-4 pre-QA UI repair (receipt binding + A→B ownership) / **UAT=NOT_TESTED** / writes default **OFF**.
Parent #372 vertical slice only (not whole parent). Entire Postgame NOT claimed complete. Mode B binding NOT claimed READY. Author checks ≠ independent QA. **NOT READY / no DEV claim.**

## Pass-4 repairs (PMA pre-QA concrete client gaps only)

1. **Receipt ↔ frozen intent** — `validateGameResultsSuccess` now matches exact recognized path+method (no broad `.includes` fallback) to frozen body:
   - bulk: same unique contextId set/count; each item `version === expected+1`, `value === "present"`, `late === false`; empty/duplicate/unexpected/missing rejected
   - mark: target context, `version === expected+1`, value+late equal input
   - ack: `acknowledgedVersion === attendanceVersion` and current `version` matches
   - dispute: game+context+challengedVersion, status `open`, valid revision
   - outcome: game + outcome value + `version === expectedVersion+1` (stale `unknown`/v0 for held correction rejected)
   - malformed/cross-context still keeps UNKNOWN; matching known successful shapes still pass
2. **A→B / game ownership** — `GameResultsComposition` mounts `GameResultsMutationHost` keyed by `` `${me.id}:${gameId}` `` (immutable actor+game child over existing `useSocialMutation`). Session/game change synchronously nulls `actorRef` before late callbacks. `useSocialMutation` gains opt-in `validatePending` + scope-generation fence: scope without marker clears in-memory pending (other scopes' storage untouched); late prior-scope response cannot settle; invalid restored marker = HOLD (no retry/delete); no auto-POST on restore/switch. Default callers unchanged.

## Claim freeze (unchanged)

- Migration **0046** additive only; **0042 outcome not edited**.
- Reused PG-1a outcome API, MutationRunner / ActorFence / GameAuthority / Participation transitions, ConsumerShell / ProfileDialog / Onest tokens; **no new mutation framework**.
- `POST_GAME_INTERNAL_ENABLED` remains default OFF; PROD fail-closed; no root enable / installer / live-ON claim.
- Visual approval supersedes draft style text only — **not** proof of implementation/QA.
- Backend/schema/release/approved images not rewritten in this pass.

## Checks (author)

- Focused web: `game-results-mutation`, `social-mutation`, `game-results` — PASS locally
- Exact negative probes from pass-3 materials: empty bulk for nonempty frozen → false; old unknown outcome for expectedVersion 1 held → false
- Same-instance A pending→B retry does not POST under B; late A cannot clear B; game change; reload restore without auto POST; malformed HOLD
- `tsc` on touched paths: no errors in allowed sources (author self-check ≠ independent QA)
- Backend untouched — reuse prior API/DB evidence

## Actual remaining limits

- PG-2 manager response / independent adjudication not implemented.
- PG-3 feedback writes not implemented.
- Runtime flag OFF until trusted DEV activation; do not claim READY/exposed.
- Legal SLA/expiry/retention windows not invented.
- Candidate SHA / release ID / acceptance date not invented.
- Owner UAT=NOT_TESTED after gates.
- Pass-2 disposable evidence retained as prior fact; pass-3 removed-after-start case — needs trusted re-run if not already accepted.

## Non-goals / stops

- No PROD, main promotion, C5, Mode B READY claim, whole-parent #372 close.
- No rewrite of MutationRunner / new scheduler / global framework / AGENTS / Git / root.
- Do not edit applied 0042 SQL; do not remove POST_GAME gate.
- No fake QA/READY/DEV in this handoff.
