# Issue #372 / PG-1b Attendance + Notice + Recourse — Mode A author handoff

From: Cursor Auto (`OWNER_APPROVED_PG1B_ATTENDANCE_NOTICE_RECOURSE_VERTICAL_SLICE`, attempt 3, base `5306853e5ccc640f60c32d3be81c8c891432bf4d`).
To: one independent Codex Sol Medium QA → mandatory Product CI → trusted DEV release/smoke.
Status: SOURCE CANDIDATE / pass-3 PMA-findings repair / **UAT=NOT_TESTED** / writes default **OFF**.
Parent #372 vertical slice only (not whole parent). Entire Postgame NOT claimed complete. Mode B binding NOT claimed READY. Author checks ≠ independent QA.

## Pass-3 repairs (PMA pre-QA findings — concrete risks only)

1. **UNKNOWN client writes** — `GameResultsComposition` no longer uses a transient boolean / fresh-key helpers for writes. Narrow `useGameResultsMutation` reuses `useSocialMutation` with immutable `actorId:game-results:gameId` scope, frozen method/path/body/key, `validateSuccess(data, pending)` target check, no clear-on-reload, no new intent while pending (incl. double-click), no silent pending delete on logout, no POST-on-mount; malformed/cross-context 2xx keeps UNKNOWN. Optional pending second arg is back-compatible.
2. **Inflight auth race** — session/game change synchronously bumps epoch, clears me/results/game/dialog targets/selections; late GET cannot restore prior private roster; mutation success callback gated to current actor; prior actor pending retained under old scope (not resent).
3. **Own historical recourse** — `resolveAccessRole` admits own post-game context via current confirmed **or** durable own attendance/notice **or** frozen as-of-start eligibility (removed-after-start). Participant projection stays own-only (no manager roster / outsider grant). Disposable API case: mark → remove-after-start → own results/history/dispute/ack; outsider 404.
4. **Correction reason** — removed invented «Исправление» fallback; empty correction rejected in UI; server already requires reason.
5. **Eligibility ambiguity** — after latest pre-start withdraw/remove/reject/pending, stale `current=confirmed` with old `confirmed_at` cannot override; only a new `confirmed_at` strictly after that as-of-start status (within ends) establishes markable context.

Ack copy: «Согласен с этой отметкой» = explicit agreement with exact mark version (not mere ознакомление). Releases alpha.3 wording corrected accordingly; version stays `0.1.0-alpha.3` (no invented runtime ON / new release number).

## Claim freeze

- Migration **0046** additive only; **0042 outcome not edited**.
- Reused PG-1a outcome API, MutationRunner / ActorFence / GameAuthority / Participation transitions, ConsumerShell / ProfileDialog / Onest tokens; **no new mutation framework**.
- `POST_GAME_INTERNAL_ENABLED` remains default OFF; PROD fail-closed; no root enable / installer / live-ON claim.
- Visual approval supersedes draft style text only — **not** proof of implementation/QA.

## Checks (author)

- Focused web: `game-results-mutation`, `social-mutation`, `game-results` (+ prior my-games/releases as needed)
- Focused API unit: `game-attendance` eligibility negatives preserved + stale-confirmed case
- Disposable PostGIS case added for removed-after-start own recourse — run by trusted PMA after import (author does not claim DB PASS here unless locally evidenced)
- `tsc` / package-local eslint on touched paths when runnable
- Author self-check ≠ independent QA

## Actual remaining limits

- PG-2 manager response / independent adjudication not implemented.
- PG-3 feedback writes not implemented.
- Runtime flag OFF until trusted DEV activation; do not claim READY/exposed.
- Legal SLA/expiry/retention windows not invented.
- Candidate SHA / release ID / acceptance date not invented.
- Owner UAT=NOT_TESTED after gates.
- Pass-2 disposable evidence (2/2) retained as prior fact; pass-3 adds removed-after-start case — needs trusted re-run.

## Non-goals / stops

- No PROD, main promotion, C5, Mode B READY claim, whole-parent #372 close.
- No rewrite of MutationRunner / new scheduler / global framework / AGENTS / Git / root.
- Do not edit applied 0042 SQL; do not remove POST_GAME gate.
