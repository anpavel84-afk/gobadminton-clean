# Issue #372 / PG-1b Attendance + Notice + Recourse — Mode A author handoff

From: Cursor Auto (`OWNER_APPROVED_PG1B_ATTENDANCE_NOTICE_RECOURSE_VERTICAL_SLICE`, attempt 8, base `e5e04c9431074911aed4954340d025607b73520d`).
To: one independent Codex Sol Medium QA → mandatory Product CI → trusted DEV release/smoke.
Status: SOURCE CANDIDATE / pass-8 Product CI 41296605722 repair only / **UAT=NOT_TESTED** / writes default **OFF**.
Parent #372 vertical slice only (not whole parent). Entire Postgame NOT claimed complete. Mode B binding NOT claimed READY. Author checks ≠ independent QA. **NOT READY / no DEV claim.** Prior FAIL/history retained. Source logic frozen.

## Pass-8 repair (Product CI 41296605722 + release note only; no source logic)

1. **PG-1a disposable assertion** — `game-outcomes.disposable.test.ts` manager privacy test: top-level keys include additive `attendance` (PG-1b enrich on outcome/results). Replaced obsolete blanket forbid of `roster|attendance|absent` in manager JSON; keep `PRIVATE TERMS SENTINEL` / `telegram:@synthetic_private` forbidden. Assert exact empty attendance slice for this fixture (0046 not applied here: `installed:false`, null roster/summary/myAttendance). Participant and revoked-manager-with-seat: same own-only empty slice (no roster/summary). Guest/outsider 401/404 and revoked write/replay protection retained. No production/SQL/permission/pipeline edits.
2. **Release catalogue note** — `API_CONTRACT_VERSION_NOTE` only: `0.20.0` → `0.21.0` to match current `OpenAPI.info.version`. Historical seed `api_contract_version` values for alpha.1/alpha.2 remain `0.20.0`; current application stays `0.1.0-alpha.3`. No other version change.

Disposable PostGIS integration fixture for this suite **not run in this author pass** (trusted operator runs exact existing CI fixture). Author package checks below only.

## Prior pass-7 repair (retained)

1. **WEB typecheck** — `apps/web/test/game-results-mutation.test.tsx`: `importOriginal` typed as `typeof React` (same pattern as sibling react mocks). Fixes TS2698/TS18046 on spread/`actual.useState|useRef|useEffect`. No assertion weakening; no `any` / `@ts-ignore`.
2. **Foundation** — `docs/product/POST_GAME_STYLE_GUIDE.md`: replace out-of-repo relative gallery link with Owner-approved published gallery URL (`https://files.anpavel.ru/projects/gobadminton/design/style-guide/postgame/20261101-astra-v1/index.html`); status/final paragraph now reflect Owner visual approval while preserving product/privacy contracts and not claiming implementation/QA/DEV acceptance. Checker unchanged.

## Prior pass-6 repair (retained)

1. **ACK attendanceVersion positive integer** — `validateGameResultsPending` (ack) and `validateGameResultsSuccess` (ack) require positive integer `attendanceVersion` via `asPositiveInt` (≥1).

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
- Existing alpha.3 metadata and alpha2 history unchanged (pass-8 only bumps exported `API_CONTRACT_VERSION_NOTE` to 0.21.0).
- Visual approval supersedes draft style text only — **not** proof of implementation/QA.
- Backend/schema/release/approved images not rewritten beyond the admitted finding.

## Checks (author, pass-8)

- Package API typecheck — PASS
- Package API lint scoped `game-outcomes.disposable.test.ts` — PASS
- Package API unit `game-attendance.test.ts` — 6 PASS
- Package WEB typecheck — PASS
- Package WEB lint scoped `src/lib/releases.ts` — PASS
- Package WEB unit `releases-server.test.ts` — 15 PASS
- Disposable PostGIS `game-outcomes.disposable` — **NOT RUN** in this author environment; trusted operator executes exact existing CI fixture. Do not claim DB PASS here.
- Existing other62integration suites already passed on CI 41296605722 except this repaired outcomes assertion; no new matrix.
- Preserve FAIL history from IndependentCodexMedium pass-2 zero-version ACK and Product CI 41296011226 / 41296605722.

## Actual remaining limits / runtime work

- Independent Codex recheck of pass-8 CI repair only (outcomes assertion + contract note).
- Trusted disposable API: this repaired `game-outcomes.disposable` fixture plus prior remaining concurrency/revoke paths as applicable.
- Trusted browser: overlays, focus/busy guards, single-scroll mobile/desktop; Owner UAT=**NOT_TESTED**.
- Mandatory Product CI/security, trusted DEV release and applicable smoke outstanding; source QA ≠ DEV acceptance.
- PG-2 manager response / independent adjudication not implemented.
- PG-3 feedback writes not implemented.
- Runtime flag OFF until trusted DEV activation; do not claim READY/exposed.

## Non-goals / stops

- No PROD, main promotion, C5, Mode B READY claim, whole-parent #372 close.
- No rewrite of MutationRunner / new scheduler / global framework / AGENTS / Git / root.
- Do not edit applied 0042 SQL; do not remove POST_GAME gate.
- No fake QA/READY/DEV in this handoff. Prior FAILs retained.
