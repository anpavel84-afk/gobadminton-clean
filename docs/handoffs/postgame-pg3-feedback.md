# Issue #372 / PG-3 Private reviews + personal notes — Mode A author handoff

From: Cursor Auto (`OWNER_APPROVED_PG3_REAL_HOST_DRAFT_LIFECYCLE_REPAIR`, attempt 9, base `67217a17819e3901b6d26b7b5b0074f1c41ba8bf`).
To: one independent Codex Sol Medium QA → mandatory Product CI → trusted DEV release/smoke → Owner UAT.
Status: **SOURCE CANDIDATE** / UAT=NOT_TESTED / PG-3 writes default **OFF** / **NOT READY** / no DEV ACCEPTED claim for alpha.12 / no PROD.
Parent #372 PG-3 slice only. Full PG-3 typed Safety extension + PG-4 / comments #394 **not DONE**. Mode B binding NOT claimed. Author checks ≠ independent QA.
Prior pass8/source8 final `bc3e1759f3cfd04e0ba5abaeac7961a47ed610cd` retained (QA8 FAIL P2). Current accepted DEV alpha.11 `acec520281d07f30d3fa855043be7d613ba56db1`. QAFAIL/attempts/UNKNOWN history retained. No feature expansion beyond host draft lifecycle repair.

## Pass 9 — real host same-context draft lifecycle (QA8 P2)

Allowed paths: `GameResultsComposition.tsx`, `GameFeedbackPanel.tsx`, `useGameResultsMutation.ts`, `game-feedback.test.tsx`, `game-results.test.tsx`, `game-results-mutation.test.tsx`, this handoff.

### Finding (QA8 P2, verbatim intent)

- `GameResultsComposition.reload()` set `state` to `loading` and unmounted `GameFeedbackPanel` after successful mutation (`onSuccess` → reload) and on 4xx `onRefresh`.
- Panel-local drafts and `noteCreateFlight` / `noteEditFlight` were lost **before** matching `confirmedOperation` handling.
- Pass8 standalone panel tests missed this real host lifecycle.

### Repair

- Same-context reload no longer forces `loading` when `me` and `results` are already present; initial/boundary loads (no me/results) still enter loading.
- Ready surface mount gate keeps the panel for `ready` **or** `loading` while `results` remain; loading banner only when `loading && !results`.
- Auth / not-found / session / game-boundary paths still `clearSensitiveUi` and unmount; no automatic retry, no new keys, no UNKNOWN clearing, no shared mutation-engine rewrite.
- Matching `confirmedOperation` remains the sole form-clearing proof; changed current draft after submit is preserved.

### Targeted author checks (this pass)

- Web unit: `game-results-mutation.test.tsx` — real host+panel soft reload after confirmed note PUT/DELETE, 4xx conflict retain, changed draft retain, session clear; source soft-reload guard.
- Prior panel validators reused: `game-feedback.test.tsx` (unchanged PASS).
- Helpers: `game-results.test.tsx` PASS.
- Author ran: `vitest run test/game-results-mutation.test.tsx test/game-feedback.test.tsx test/game-results.test.tsx` → targeted PASS; `tsc -p tsconfig.json --noEmit` when available.
- No broad PG-1b / PG-2 / SMTP / DB / security re-matrix. Independent QA / Product CI / DEV smoke still required.

### Release metadata (prospective, unchanged claim)

- Candidate app `0.1.0-alpha.12` / API contract note `0.23.0` remain **prospective** — no invented DEV ACCEPTED / Owner PASS.
- Accepted alpha.11 historical seed retained. Design input unchanged (Owner-approved postgame Astra v1 comment 6555581830); layout unchanged.

## Outstanding (honest)

- Independent Sol Medium QA of host+panel same-context draft lifecycle
- Product CI + security checks + trusted DEV deploy/smoke + flag activation
- Owner UAT = NOT_TESTED
- Full PG-3 typed Safety complaint extension = **remaining**
- PG-4 / public comments #394 later

## Non-goals / stops

- No PROD, main promotion, C5, Mode B READY, whole-parent close
- No Git/root/runtime/PROD/API/security/schema rewrite; no secrets; no AGENTS.md/CLAUDE.md/.cursor creation
- No new request engine / shared hook rewrite / scheduler / UI redesign
- No whole-suite matrix expansion; no repeated paid old call — this is a new repair on a new immutable base
