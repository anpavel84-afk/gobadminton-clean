# Issue #372 / PG-3 Private reviews + personal notes — Mode A author handoff

From: Cursor Auto (`OWNER_CLEANUP_RESUME_PRESERVED_PG3_PRIVATE_FEEDBACK_NOTES`, attempt 8, base `f5db303776beee8ff5453f409e45659831ac5cb5`).
To: one independent Codex Sol Medium QA → mandatory Product CI → trusted DEV release/smoke → Owner UAT.
Status: **SOURCE CANDIDATE** / UAT=NOT_TESTED / PG-3 writes default **OFF** / **NOT READY** / no DEV ACCEPTED claim for alpha.12 / no PROD.
Parent #372 PG-3 slice only. Full PG-3 typed Safety extension + PG-4 / comments #394 **not DONE**. Mode B binding NOT claimed. Author checks ≠ independent QA.
Original preserved SHA `4c020d88d66e3d618f2fe8d31ae27a416eaefa41` not discarded. Current accepted DEV alpha.11 `acec520281d07f30d3fa855043be7d613ba56db1`. QAFAIL/attempts history retained. No feature expansion beyond lifecycle + release metadata.

## Pass 8 — remaining create-note / deleteNote draft lifecycle

Allowed paths: `GameFeedbackPanel.tsx`, `game-feedback.test.tsx`, `releases.ts` (+ co-located/release tests), `docs/releases/CHANGELOG.md`, this handoff, `AGENTS.md`.

### Finding — premature create-note draft reset + premature editor close on delete

- `saveNote` (existing / preexisting / new) no longer calls `resetCreateNoteDraft` after `mutation.run` (run admission is not success).
- Create draft clears only after confirmed success of the matching frozen PUT with unchanged `noteContextId` / `noteText` / game host (same fence as pass7 `submitReview` / `saveExistingNote`).
- `deleteNote` no longer calls `resetEditNoteDraft` after DELETE admission.
- Edit editor closes on DELETE only after matching validated success of that note/version DELETE with unchanged current editor.
- Unrelated confirmed commands do not reset create draft or close the editor; changed current draft after submit is preserved.
- UNKNOWN / network timeout / malformed 2xx / conflict / stale callback: text and flight identity retained; validators not weakened; success not inferred from `pending==null` / await void / GET / time.
- Own-note edit after `canCreateNote` withdrawn remains supported (prior test retained).

### Release metadata (prospective)

- Candidate app `0.1.0-alpha.12` / API contract note `0.23.0` (existing PG-3 wire; API/schema not rewritten).
- Accepted alpha.11 historical seed supplied and retained in `TRUSTED_HISTORICAL_SEED`.
- No fabricated deployed / Owner PASS for alpha.12; alpha.8 PROD unchanged.
- Design input unchanged (Owner-approved postgame Astra v1); no PG-1a/1b/2 or public-comments redesign.

### Targeted author checks (this pass)

- Web unit: `game-feedback.test.tsx` — create-note + deleteNote retain-on-UNKNOWN / matching confirm / unrelated+changed draft.
- Release integrity: `releases.test.ts`, `releases.test.tsx`, `releases-server.test.ts`.
- Author ran: `vitest run test/game-feedback.test.tsx test/releases.test.tsx test/releases-server.test.ts` → **32/32 PASS**; `tsc -p tsconfig.json --noEmit` → exit 0.
- No broad unchanged PG-1b / PG-2 / SMTP / DB / security re-matrix. Independent QA / Product CI / DEV smoke still required.

## Outstanding (honest)

- Independent Sol Medium QA of create-note + delete lifecycle
- Product CI + security checks + trusted DEV deploy/smoke + flag activation
- Owner UAT = NOT_TESTED
- Full PG-3 typed Safety complaint extension = **remaining**
- PG-4 / public comments #394 later; #445/#450 per-point verify only

## Non-goals / stops

- No PROD, main promotion, C5, Mode B READY, whole-parent close
- No Git/root/runtime/PROD/API/security/schema rewrite; no secrets
- No new request engine / shared hook rewrite / scheduler
- No whole-suite matrix expansion; no new paid model calls beyond this author operation
