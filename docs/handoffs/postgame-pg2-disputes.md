# Issue #372 / PG-2 Dispute response + scoped case resolution — Mode A author handoff

From: Cursor Auto (`OWNER_APPROVED_PG2_RESPONSE_CORRECTION_SCOPED_CASE_RESOLUTION`, attempt 1, base `7b75fbed6b2582c9594ff71566566df625b5672d`).
To: one independent Codex Sol Medium QA → mandatory Product CI → trusted DEV release/smoke.
Status: SOURCE CANDIDATE / **UAT=NOT_TESTED** / writes default **OFF** / **NOT READY** / no DEV claim.
Parent #372 PG-2 slice only. PG-3/PG-4 not done. Mode B binding NOT claimed. Author checks ≠ independent QA.

## Delivered source (this pass)

1. Migration **0047** additive: versioned `unknown`, `case_reviewer`, dispute response/help/case-link/resolution tables; rollback refuses populated history.
2. Consumer: manager `POST /attendance-disputes/{id}/responses` (optional correction, never closes); participant help progress; ACK with `resolvingDisputeId`+`expectedDisputeVersion`; unknown no ACK.
3. Admin: intake without abuse_report; `GET/POST /admin/cases/:caseId/attendance-disputes/:disputeId` with step-up, assignment, reviewer conflict checks, server-derived provenance; `insufficient_evidence` leaves OPEN.
4. UI: clarification tab old/current side-by-side, respond/consent/withdraw/help, Admin Cases embedded reviewer; compact date badge + panel/rail margin polish only.
5. OpenAPI **0.22.0**; proposed app `0.1.0-alpha.4`. Alpha.3 DEV ACCEPTED seed retained (`7b75fbed…` / `r41298675161-a1` / `1793530473`). **Not** claiming alpha.4 READY.

## Checks (author, pass-1)

- Contracts game types verify — PASS (`0.22.0`)
- API typecheck (`tsc -p apps/api`) — PASS
- Web typecheck — PASS
- Admin typecheck — PASS
- API eslint (package config, changed attendance/admin dispute files) — PASS
- API unit `game-attendance.test.ts` + `game-attendance-disputes.test.ts` — 10 PASS
- Web unit releases / releases-server / game-results* / my-games-results — 43 PASS
- Admin unit `attendance-disputes.test.tsx` — 2 PASS
- Disposable PostGIS `game-attendance-disputes.disposable` + `admin-attendance-disputes.disposable` — **NOT RUN** (no disposable DB in author env; trusted operator/CI). Do not claim DB PASS.
- Browser / Product CI / DEV — outstanding trusted process.

## Unresolved technical gates

- Independent QA of this candidate.
- Disposable DB + Product CI + trusted DEV deploy/smoke.
- Owner UAT = NOT_TESTED.
- Runtime flag remains OFF until trusted activation; PROD forbidden.

## Non-goals / stops

- No PROD, main promotion, C5, Mode B READY, whole-parent close.
- No rewrite of MutationRunner / new scheduler / RBAC role grants / AGENTS / Git / root.
- Do not edit applied 0042/0046 SQL.
