# Issue #372 / PG-2 Dispute response + scoped case resolution — Mode A author handoff

From: Cursor Auto (`OWNER_APPROVED_PG2_RESPONSE_CORRECTION_SCOPED_CASE_RESOLUTION`, attempt 2, base `86384b598883052e0391cf7367a4fcb1c42db359`).
To: one independent Codex Sol Medium QA → mandatory Product CI → trusted DEV release/smoke.
Status: SOURCE CANDIDATE repair of PMA PG2-01..05 / **UAT=NOT_TESTED** / PG-2 source default **OFF**, **NOT_INSTALLED / NOT_QUALIFIED** on runtime / **NOT READY** / no DEV claim for PG-2.
Parent #372 PG-2 slice only. PG-3/PG-4 not done. Mode B binding NOT claimed. Author checks ≠ independent QA.
Prior pass-1 native result/raw/HOLD/import record preserved; this is a new productive repair admission (no history reset).

## Runtime / flag accuracy (do not mis-state)

- Live DEV **PG-1b** flag is already **ON** (do not claim the whole post-game runtime is OFF).
- **PG-2** source remains default **OFF**, **NOT_INSTALLED / NOT_QUALIFIED** until trusted install + qualification. Not full-parent DONE. PROD forbidden.

## Pass-2 repair (PMA PG2-01..05)

1. **PG2-01 Admin positive qualification** — Extended `admin-attendance-disputes.disposable.test.ts` with real ended-game/manager/participant/attendance/revisions/notice/open dispute/help fixture; HTTP intake → assigned read → `insufficient_evidence` leaves OPEN → versioned `correct_present` resolve → history/audit/notice readback; same-key replay; negatives (wrong case, stale versions, unassigned, subject/former-manager party, assignment-loss replay, stale step-up); prior consumer 404 + support intake denial retained.
2. **PG2-02 Lock order** — Consumer `lockOwnDispute` / `lockManagerDispute` and admin intake/resolve: read dispute tip without lock → lock Game → participation → reselect dispute under lock. Admin may lock existing Case before Game; intake creates case only after Game. ACK attendance→dispute order preserved. Bounded ACK(consent) vs admin resolve concurrency barrier (Game held, enqueue, release); skipped/`NOT RUN` without disposable DB.
3. **PG2-03 Assigned read** — Local admin dispute read requires assignment + capability + independent eligibility; `canResolve` from the same conditions; legacy Cases metadata APIs untouched.
4. **PG2-04 Historic party conflict** — Reviewer conflict includes creator and any historic `game_managers` seat (not only active); intake/resolve authorizeScope revalidates eligibility/assignment without rejecting legitimate exact replay merely because dispute is now resolved.
5. **PG2-05 Fixture guard + audit atomicity** — Admin disposable target guard requires dedicated `/gobadminton_admin_attendance_disputes_disposable` or hosted CI localhost/`PG_CONTAINER`/port contract before Pool/CREATE DATABASE; audit-failure trigger rolls back privileged resolve (attendance/dispute/case/resolution/history/notice/receipt).

## Delivered source (retained from pass-1 + this repair)

1. Migration **0047** additive; rollback refuses populated history.
2. Consumer manager responses / help / ACK with dispute consent; Admin intake + scoped read/resolve.
3. UI/OpenAPI **0.22.0** / proposed app `0.1.0-alpha.4` unchanged this pass. Alpha.3 DEV ACCEPTED seed retained. **Not** claiming alpha.4 READY.

## Checks (author, pass-2)

- API typecheck (`tsc -p apps/api`) — PASS
- API eslint (changed attendance/admin dispute + admin disposable fixture) — PASS
- API unit `game-attendance-disputes.test.ts` — 4 PASS
- Disposable PostGIS `admin-attendance-disputes.disposable` + `game-attendance-disputes.disposable` (incl. ACK vs admin concurrency) — **NOT RUN** (no dedicated/hosted disposable DB / `RUN_DB_INTEGRATION` in author env). Trusted operator runs them. Do not claim DB PASS.
- Browser / Product CI / DEV — outstanding trusted process.

## Unresolved technical gates

- Independent QA of this candidate.
- Disposable DB + Product CI + trusted DEV deploy/smoke for PG-2.
- Owner UAT = NOT_TESTED.
- PG-2 runtime remains NOT_INSTALLED / NOT_QUALIFIED; PROD forbidden.

## Non-goals / stops

- No PROD, main promotion, C5, Mode B READY, whole-parent close.
- No rewrite of MutationRunner / new scheduler / RBAC role grants / AGENTS / Git / root.
- Do not edit applied 0042/0046 SQL.
