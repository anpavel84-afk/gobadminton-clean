# Issue #372 / PG-1b Attendance + Notice + Recourse — Mode A author handoff

From: Cursor Auto (`OWNER_APPROVED_PG1B_ATTENDANCE_NOTICE_RECOURSE_VERTICAL_SLICE`, attempt 1, base `38a4700c68ed85189007dcab3c859c98eb37bf46`).
To: one independent Codex Sol Medium QA → mandatory Product CI → trusted DEV release/smoke.
Status: SOURCE CANDIDATE / author checks local where possible / **UAT=NOT_TESTED** / writes default **OFF**.
Parent #372 vertical slice only (not whole parent). Entire Postgame NOT claimed complete. Mode B binding NOT claimed READY.

## Image handoff acknowledged (opened as images)

| File | Role |
|---|---|
| `pg1-manager-ready-desktop.png` | Organizer Attendance (PG-1b) desktop |
| `pg1-participant-ready-mobile.png` | Participant Attendance ready mobile |
| `pg2-participant-disputed-mobile.png` | Clarification disputed (later slice; UI tab read-only) |
| `pg3-participant-ready-desktop.png` | Feedback (later; no fake write buttons) |

Approved galleries: `postgame/20261101-astra-v1` and `comments/20261101-astra-v1` on files.anpavel.ru (local inputs used; no network).

## Claim freeze

- Migration **0046** (0045 latest on checkout). Additive only; **0042 outcome not edited**.
- Reused PG-1a outcome API, MutationRunner / ActorFence / GameAuthority / Participation transitions, ConsumerShell / ProfileDialog / Onest tokens.
- `POST_GAME_INTERNAL_ENABLED` remains default OFF; PROD fail-closed; no root enable / installer / live-ON claim.
- Visual approval supersedes draft style text only — **not** proof of implementation/QA.

## Product slice delivered

- Schema: `game_attendance` + immutable revisions + durable own notices + disputes (one open) + dispute revisions.
- Eligible roster as-of game start via participation transitions / current confirmed proof; withdrawn/rejected/pending/removed-before-start excluded; unsafe history → no marking guess.
- No automatic present/absent from time/status; late only with present; sources `manager_explicit` | `self_attested`.
- Commands: PUT attendance, POST bulk-present (exact selection, all-or-nothing), POST acknowledgements, POST disputes, GET/withdraw dispute, GET history, GET `/me/game-results`.
- GET `/games/{id}/results` additive `attendance` slice (reads when writes OFF).
- Cookie/Origin/CSRF + Idempotency + version CAS; Actor→Game→manager→participation→attendance; open dispute retained on correction; atomic notice with assertion.
- UI `/my-games/[gameId]/results`: compact context, Attendance tab usable, Clarification read-only for own open dispute, Feedback placeholder without fake writes. Links from PersonalGameCard + MyGames notices.

## Changed files (allowed_paths)

See TASK_DATA allowed_paths — migration 0046 pair, attendance controller/service/policy, outcomes enrich, games.module, openapi 0.21.0, web results UI/lib/css/tests, product style guides, this handoff. `env.ts` unchanged beyond existing PG-1a gate (no new flag).

## Checks (author)

- `@gobadminton/contracts check` → PASS (info 0.21.0)
- API unit: `game-attendance` + `game-outcomes` → PASS
- Web unit: `game-results` + `my-games-results` → PASS
- API/Web `tsc --noEmit` on workspace + eslint touched paths → PASS
- Disposable PostGIS suite `game-attendance.disposable.test.ts` auto-picked by `db-ci.sh` (**author may not Docker**; trusted integrator runs DB) → NOT_RUN here
- Migration smoke expectation updated for 0046 → NOT_RUN (needs disposable DB)

## Unimplemented / live dependencies (honest)

- PG-2 manager response / independent adjudication not implemented (tab explains later).
- PG-3 feedback writes not implemented.
- `/my-games/[gameId]/page.tsx` still hosts `OwnedGameSummaryPage` (outside allowed_paths); manage CTA added via `PersonalGameCard` + allowed `ManageGamePage` entry helper (not route-switched).
- Legal SLA/expiry/retention windows not invented.
- App version / release ledger **not** altered (trusted release-agent owns alpha.3).
- Author self-check ≠ independent QA. DEV smoke + Owner UAT=NOT_TESTED after gates.

## Non-goals / stops

- No PROD, main promotion, C5, Mode B READY claim, whole-parent #372 close.
- No rewrite of MutationRunner / new scheduler / global framework.
- Do not edit applied 0042 SQL; do not remove POST_GAME gate.
