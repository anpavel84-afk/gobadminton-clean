# Issue #372 / PG-1b Attendance + Notice + Recourse — Mode A author handoff

From: Cursor Auto (`OWNER_APPROVED_PG1B_ATTENDANCE_NOTICE_RECOURSE_VERTICAL_SLICE`, attempt 6, base `858c585b96d9d3a63240f0de240b243fb3d0f7bf`).
To: one independent Codex Sol Medium QA → mandatory Product CI → trusted DEV release/smoke.
Status: SOURCE CANDIDATE / pass-6 IndependentCodexMedium remaining P2 repair / **UAT=NOT_TESTED** / writes default **OFF**.
Parent #372 vertical slice only (not whole parent). Entire Postgame NOT claimed complete. Mode B binding NOT claimed READY. Author checks ≠ independent QA. **NOT READY / no DEV claim.** Prior FAIL/history retained.

## Pass-6 repair (single remaining IndependentCodexMedium P2)

1. **ACK attendanceVersion positive integer** — `validateGameResultsPending` (ack) and `validateGameResultsSuccess` (ack) now require a positive integer `attendanceVersion` via `asPositiveInt` (≥1). Zero / negative / non-integer pending bodies are rejected; zero-version present/absent receipts with `version`/`acknowledgedVersion` both 0 no longer clear UNKNOWN. Exact context/version/ack binding and UNKNOWN pending semantics preserved. Dispute/mark/bulk/outcome admission unchanged.

## Prior pass-5 repairs (retained; not re-claimed as fresh DONE)

1. **QA1 eligibility** — `eligibleFromTransitions`: definite pre-start non-confirmed stays unmarkable; no late-join expansion.
2. **QA2 dual-role own section** — manager roster and own attendance/ack/objection independent; creator without `myAttendance` not treated as participant.
3. **QA3 ack receipt** — ack success only `present`/`absent` with exact version+acknowledgedVersion; `unknown` stays UNKNOWN (pass-6 tightens version positivity).
4. **QA4 corrupt storage HOLD** — opt-in `holdCorruptStorage`; unparseable JSON retained HOLD.
5. **QA5 ProfileDialog skin** — `profile-dialog--postgame` + `lockBodyScroll`; sole body scroll owner.

## Claim freeze (unchanged)

- Migration **0046** additive only; **0042 outcome not edited**.
- Reused PG-1a outcome API, MutationRunner / ActorFence / GameAuthority / Participation transitions, ConsumerShell / ProfileDialog / Onest tokens; **no new mutation framework**.
- `POST_GAME_INTERNAL_ENABLED` remains default OFF; PROD fail-closed; no root enable / installer / live-ON claim.
- Existing alpha.3 metadata and alpha2 history unchanged.
- Visual approval supersedes draft style text only — **not** proof of implementation/QA.
- Backend/schema/release/approved images not rewritten beyond the admitted finding.

## Checks (author, pass-6)

- Focused web mutation regressions only: zero/negative/noninteger ACK pending+success rejection; valid positive ACK still confirms
- Package lint on `@gobadminton/web` when run from package CWD
- No full API/DB matrix re-run; browser/CSS/disposable concurrency remain **remaining runtime**

## Actual remaining limits / runtime work

- Independent Codex recheck of the ACK positivity repair.
- Trusted disposable API: mixed-bulk rollback, concurrent version CAS, replay after manager revocation.
- Trusted browser: overlays, focus/busy guards, single-scroll mobile/desktop; Owner UAT=**NOT_TESTED**.
- Mandatory Product CI/security, trusted DEV release and applicable smoke outstanding; source QA ≠ DEV acceptance.
- PG-2 manager response / independent adjudication not implemented.
- PG-3 feedback writes not implemented.
- Runtime flag OFF until trusted DEV activation; do not claim READY/exposed.

## Non-goals / stops

- No PROD, main promotion, C5, Mode B READY claim, whole-parent #372 close.
- No rewrite of MutationRunner / new scheduler / global framework / AGENTS / Git / root.
- Do not edit applied 0042 SQL; do not remove POST_GAME gate.
- No fake QA/READY/DEV in this handoff. Preserve FAIL history from IndependentCodexMedium pass-2 zero-version ACK verdict.
