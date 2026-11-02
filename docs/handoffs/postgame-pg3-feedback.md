# Issue #372 / PG-3 Private reviews + personal notes — Mode A author handoff

From: Cursor Auto (`OWNER_APPROVED_PG3_ADDITIVE_RESULTS_CI_FIXTURE_COMPATIBILITY`, attempt 11, base `70ddca0e29d199c02b018e7b4e1738c399118790`).
To: one independent Codex Sol Medium QA → mandatory Product CI → trusted DEV release/smoke → Owner UAT.
Status: **SOURCE CANDIDATE** / UAT=NOT_TESTED / PG-3 writes default **OFF** / **NOT READY** / no DEV ACCEPTED claim for alpha.12 / no PROD.
Parent #372 PG-3 / current PR #454. Full PG-3 typed Safety extension + PG-4 / comments #394 **not DONE**. Mode B binding NOT claimed. Author checks ≠ independent QA.
Prior pass10 UI actor-boundary work and QA history retained. Product CI `41366669157`: 6 jobs PASS; **database FAIL only** — stale exact-keys assertion in `game-outcomes.disposable.test.ts:352` (expected 6 top-level keys, received 7 with approved additive `feedback`). Current accepted DEV alpha.11 retained historically. C5 OFF / PROD unchanged. No product/schema/contract change in this pass.

## Pass 11 — PG-1a disposable exact-keys fixture + PG-3 `feedback`

Allowed paths: `apps/api/test/integration/game-outcomes.disposable.test.ts`, this handoff.

### CI reason (honest)

- Product CI run `41366669157` / database job: `Object.keys(saved.json()).sort()` expected `Array(6)` vs received `Array(7)` with `feedback` between `attendance` and `gameId`.
- Failure site: `apps/api/test/integration/game-outcomes.disposable.test.ts:352` — manager history vs participant projection test.
- Root cause: legacy PG-1a exact top-level shape lagged approved PG-3 additive `GameResults.feedback` (already present in live API / PG-3 service and passed their CI). Not an auth/privacy product bug; not a gate disable.

### Repair

- Keep **strict** `Object.keys(...).sort().toEqual([...])` (no `arrayContaining`, no filtering `feedback` away).
- Add `"feedback"` as seventh expected top-level key; refresh comment that PG-1b attendance + PG-3 feedback are additive and this fixture does not apply 0046/0048 → empty actor-scoped slices.
- Assert actor-scoped empty feedback shape for this seeded fixture (`installed: false`, empty `myNotes` / `gameReviews`, capabilities with no create flags / no peerSubjects) per existing GameResults / emptyFeedbackSlice contract when 0048 is absent; do **not** invent public review fields.
- Preserve every guest/outsider/revoked-manager 404, idempotency/replay-denied, seat/lifecycle, and attendance empty-slice assertions unchanged.
- Do **not** remove `feedback` from product response, disable tests/gates, or change schema/backend/contract.

### Targeted author checks (this pass)

- Scope: one disposable DB fixture file + handoff only. PMA runs **only** this disposable DB file via existing runner + required CI after final delta QA.
- Author does **not** run live DEV DB / Docker / root from sandbox.
- Reuse: current web/source QA10 PASS and 64 tests/typecheck unchanged — not re-run here.

### Release metadata (prospective, unchanged claim)

- Candidate app `0.1.0-alpha.12` / API contract note `0.23.0` remain **prospective** — no invented DEV ACCEPTED / Owner PASS / CI green claim.
- Previous FAILs, costs, and history preserved. Same PR #454; no new PR / task reset.

## Outstanding (honest)

- Independent Sol Medium QA of this fixture-compat delta (exact keys + empty feedback slice; no product rewrite)
- Product CI + security checks + trusted DEV deploy/smoke + flag activation
- Owner UAT = NOT_TESTED
- Full PG-3 typed Safety complaint extension = **remaining**
- PG-4 / public comments #394 later

## Non-goals / stops

- No PROD, main promotion, C5, Mode B READY, whole-parent close
- No Git/root/runtime/PROD/schema/backend/contract/AGENTS/config instruction files; no secrets; no other models
- No Astra / High / failure_diagnosis; no new matrix; no feedback removal from product response
- Native DONE after this 1 fixture file + handoff scope
