# Issue #372 / PG-1b Attendance + Notice + Recourse — Mode A author handoff

From: Cursor Auto (`OWNER_APPROVED_PG1B_ATTENDANCE_NOTICE_RECOURSE_VERTICAL_SLICE`, attempt 2, base `dd115ee69c2ac106a678e5ab7fc04fc866eb0079`).
To: one independent Codex Sol Medium QA → mandatory Product CI → trusted DEV release/smoke.
Status: SOURCE CANDIDATE / pass-2 repair of disposable FAIL / **UAT=NOT_TESTED** / writes default **OFF**.
Parent #372 vertical slice only (not whole parent). Entire Postgame NOT claimed complete. Mode B binding NOT claimed READY.

## Image handoff acknowledged (opened as images)

| File | Role |
|---|---|
| `pg1-manager-ready-desktop.png` | Organizer Attendance (PG-1b) desktop |
| `pg1-participant-ready-mobile.png` | Participant Attendance ready mobile |
| `pg2-participant-disputed-mobile.png` | Clarification disputed (later slice; UI tab read-only) |
| `pg3-participant-ready-desktop.png` | Feedback (later; no fake write buttons) |

Approved galleries: `postgame/20261101-astra-v1` and `comments/20261101-astra-v1` on files.anpavel.ru (local inputs used; no network). Four approved images read-ack preserved.

## Pass-2 repair (deterministic DB FAIL)

- Disposable FAIL: roster incorrectly included withdrawn-before-start participation (line 245); idempotency/revoke PASS.
- Root cause: `eligibleFromTransitions` after `statusAtStart === withdrawn` fell back to any earlier confirmed + stale `confirmed_at` and re-admitted.
- Fix: latest definite as-of-start transition wins; never resurrect withdrawn/removed/rejected/pending before start. Current confirmed requires known `confirmed_at` within bounded game window (`<= ends_at`). Ambiguous history → no marking.
- Focused unit negative proof: later withdrawal before start overrides earlier confirmation even with stale `confirmed_at`. Existing API assertions unchanged (still require withdrawn excluded).
- Trusted PMA re-runs disposable DB after new import; author does not claim DB PASS here.

## Claim freeze

- Migration **0046** additive only; **0042 outcome not edited**.
- Reused PG-1a outcome API, MutationRunner / ActorFence / GameAuthority / Participation transitions, ConsumerShell / ProfileDialog / Onest tokens.
- `POST_GAME_INTERNAL_ENABLED` remains default OFF; PROD fail-closed; no root enable / installer / live-ON claim.
- Visual approval supersedes draft style text only — **not** proof of implementation/QA.

## Product slice delivered

- Schema: `game_attendance` + immutable revisions + durable own notices + disputes (one open) + dispute revisions.
- Eligible roster as-of game start via participation transitions / current confirmed within game window; withdrawn/rejected/pending/removed-before-start excluded; unsafe history → no marking guess.
- No automatic present/absent from time/status; late only with present; sources `manager_explicit` | `self_attested`.
- Commands: PUT attendance, POST bulk-present (exact selection, all-or-nothing), POST acknowledgements, POST disputes, GET/withdraw dispute, GET history, GET `/me/game-results`.
- GET `/games/{id}/results` additive `attendance` slice (reads when writes OFF).
- Cookie/Origin/CSRF + Idempotency + version CAS; Actor→Game→manager→participation→attendance; open dispute retained on correction; atomic notice with assertion.
- UI `/my-games/[gameId]/results`: compact context, Attendance tab usable, Clarification read-only for own open dispute, Feedback placeholder without fake writes. Links from PersonalGameCard + MyGames notices + **OwnedGameSummaryPage** Results CTA (`resultsPath`).
- Dead unimported `app/globals.css` removed (composition already imports `postgame.css`). Unmounted `ManageGamePage` / `MyGameDetailPage` helpers deleted; no fake route entry.
- Application descriptor proposed `0.1.0-alpha.3` with bounded PG-1b notes; alpha.1 baseline literal; alpha.2 accepted DEV/PROD seed appended. `source_sha` null until trusted acceptance. Flag default OFF.

## Changed files (allowed_paths)

See TASK_DATA allowed_paths — attendance policy/service (+ unit), OwnedGameSummary host, releases/CHANGELOG, handoff; deleted dead globals + unmounted helpers. OpenAPI semantic delta retained (no mechanical key-order rewrite without original base in private export). Outcomes controller/unit + env/module/migration unchanged this pass beyond prior import.

## Checks (author)

- API unit: `game-attendance` + `game-outcomes` → PASS (18)
- Web unit: `game-results` + `my-games-results` + `releases` + `releases-server` → PASS (26)
- API/Web `tsc --noEmit` → PASS
- Package-local eslint on touched paths → PASS
- Disposable PostGIS `game-attendance.disposable.test.ts` → NOT_RUN here (trusted PMA after import)
- Author self-check ≠ independent QA

## Unimplemented / live dependencies (honest)

- PG-2 manager response / independent adjudication not implemented (tab explains later).
- PG-3 feedback writes not implemented.
- Runtime flag OFF until trusted DEV activation; do not claim READY/exposed.
- Legal SLA/expiry/retention windows not invented.
- Candidate SHA / release ID / acceptance date not invented.
- Owner UAT=NOT_TESTED after gates.

## Non-goals / stops

- No PROD, main promotion, C5, Mode B READY claim, whole-parent #372 close.
- No rewrite of MutationRunner / new scheduler / global framework.
- Do not edit applied 0042 SQL; do not remove POST_GAME gate.
- No AGENTS/instruction/Git edits; no new framework/other models.
