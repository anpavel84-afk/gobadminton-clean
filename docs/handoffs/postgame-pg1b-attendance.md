# Issue #372 / PG-1b Attendance + Notice + Recourse — Mode A author handoff

From: Cursor Auto (`OWNER_APPROVED_PG1B_ATTENDANCE_NOTICE_RECOURSE_VERTICAL_SLICE`, attempt 5, base `eaece72d8ef4907fc6576022e2a88fa48287bddc`).
To: one independent Codex Sol Medium QA → mandatory Product CI → trusted DEV release/smoke.
Status: SOURCE CANDIDATE / pass-5 IndependentCodexMedium P2 repairs / **UAT=NOT_TESTED** / writes default **OFF**.
Parent #372 vertical slice only (not whole parent). Entire Postgame NOT claimed complete. Mode B binding NOT claimed READY. Author checks ≠ independent QA. **NOT READY / no DEV claim.**

## Pass-5 repairs (five IndependentCodexMedium P2 findings only)

1. **QA1 eligibility** — `eligibleFromTransitions`: definite pre-start non-confirmed (withdrawn/removed/rejected/pending) stays unmarkable; current/later confirmation must not restore as-of-start eligibility. No late-join expansion. Prior confirmed-as-of-start and empty-history current_confirmed cases preserved.
2. **QA2 dual-role own section** — manager roster and own attendance/provenance/ack/objection/history render independently; creator without `myAttendance` still not treated as participant.
3. **QA3 ack receipt** — `validateGameResultsSuccess` ack accepts only `present`/`absent` with exact positive version+acknowledgedVersion; `unknown`/malformed stay UNKNOWN. Bulk/outcome/target/session binding unchanged.
4. **QA4 corrupt storage HOLD** — opt-in `holdCorruptStorage` on postgame host: unparseable persisted JSON preserved, HOLD set, new writes+retry blocked; default social callers unchanged; scope A HOLD does not block scope B.
5. **QA5 ProfileDialog skin** — all five forms use `profile-dialog--postgame` + `lockBodyScroll`; players/desktop-overlays selectors extended (no whole-page `.fr3`); nested bulk/history list max-height/overflow removed so `.profile-dialog__body` is sole scroll owner.

## Claim freeze (unchanged)

- Migration **0046** additive only; **0042 outcome not edited**.
- Reused PG-1a outcome API, MutationRunner / ActorFence / GameAuthority / Participation transitions, ConsumerShell / ProfileDialog / Onest tokens; **no new mutation framework**.
- `POST_GAME_INTERNAL_ENABLED` remains default OFF; PROD fail-closed; no root enable / installer / live-ON claim.
- Existing alpha.3 metadata and alpha2 history unchanged.
- Visual approval supersedes draft style text only — **not** proof of implementation/QA.
- Backend/schema/release/approved images not rewritten beyond the five findings.

## Checks (author)

- Focused API unit + web mutation/social/render regressions for the five findings (incl. QA probes)
- `tsc`/lint on touched packages when run from package CWD
- Browser CSS/overlay verification and disposable API concurrency remain **remaining runtime** (not claimed here)

## Actual remaining limits / runtime work

- Trusted disposable API: mixed-bulk rollback, concurrent version CAS, replay after manager revocation.
- Trusted browser: repaired overlays, focus/busy guards, single-scroll mobile/desktop; Owner UAT=**NOT_TESTED**.
- Mandatory Product CI/security, trusted DEV release and applicable smoke outstanding; source QA ≠ DEV acceptance.
- PG-2 manager response / independent adjudication not implemented.
- PG-3 feedback writes not implemented.
- Runtime flag OFF until trusted DEV activation; do not claim READY/exposed.

## Non-goals / stops

- No PROD, main promotion, C5, Mode B READY claim, whole-parent #372 close.
- No rewrite of MutationRunner / new scheduler / global framework / AGENTS / Git / root.
- Do not edit applied 0042 SQL; do not remove POST_GAME gate.
- No fake QA/READY/DEV in this handoff. Preserve FAIL history from pass-1 IndependentCodexMedium verdict.
