# Issue #372 / PG-3 Private reviews + personal notes — Mode A author handoff

From: Cursor Auto (`OWNER_APPROVED_PG3_PRIVATE_FEEDBACK_PERSONAL_NOTES`, attempt 7, base `d0b210b43228a85fe9b3c4338ceefcd61dee7936`).
To: one independent Codex Sol Medium QA → mandatory Product CI → trusted DEV release/smoke → Owner UAT.
Status: **SOURCE CANDIDATE (revised after QAFAIL pass2)** / UAT=NOT_TESTED / PG-3 writes default **OFF** / **NOT READY** / no DEV ACCEPTED claim / no PROD.
Parent #372 PG-3 slice only. Full PG-3 typed Safety extension + PG-4 / comments #394 **not DONE**. Mode B binding NOT claimed. Author checks ≠ independent QA.
Frozen clean SHA `d0b210b43228a85fe9b3c4338ceefcd61dee7936`. QAFAIL raw preserved (Sol Medium pass1 + pass2). No feature expansion; alpha.6 / API 0.23 and historical SMTP alpha.5 / PG-2 alpha.4 records unchanged. Server/schema/API/DB unchanged — reuse prior disposable evidence; no migration re-run.

## Pass 7 — exact two Sol Medium QA2 residual lifecycle findings

Allowed paths: `useSocialMutation.ts`, `useGameResultsMutation.ts`, `GameResultsComposition.tsx`, `GameFeedbackPanel.tsx`, `game-feedback.test.tsx`, `game-results-mutation.test.tsx`, this handoff.

### Finding 1 — premature review draft reset

- `submitReview` no longer calls `resetForm()` after `mutation.run` (run admission is not success; transport validation is async).
- Host forwards exact frozen pending (`path`/`body`/`key`/`method`) from the existing validated-success branch via optional `onSuccess` second arg (old single-arg callbacks remain compatible).
- Panel clears matching review fields only when confirmed operation equals the frozen request **and** current draft/subject/game are unchanged.
- UNKNOWN / network timeout / malformed 2xx / stale conflict: input and flight identity retained; no automatic new key / UNKNOWN clear.
- Unrelated reply/outcome/attendance/note success does not clear the review draft; changed current draft after submit is preserved.

### Finding 2 — premature note editor close

- `saveExistingNote` no longer calls `resetEditNoteDraft` immediately after PUT.
- Editor closes only after confirmed success of the matching note context/version/text operation with unchanged editor draft.
- Unrelated confirmed commands do not close the note editor; changed editor text after submit is preserved.
- Accepted pass6 validator + own-note-edit gating retained; create-note / delete / reply / PG-1b/2 / SMTP not re-audited.

### Targeted author checks (this pass)

- Web unit: `game-feedback.test.tsx` (lifecycle retain-on-UNKNOWN + matching confirm clear + unrelated/changed draft) and `game-results-mutation.test.tsx` (frozen pending forwarded on confirmed success; single-arg compatibility).
- Typecheck/lint scoped to related web files when run.
- No broad unchanged PG-1b / PG-2 / SMTP / DB re-matrix.
- Issue #445 visual QA defects are out of scope for this repair.

## Outstanding (honest)

- Independent Sol Medium QA re-check of both repaired lifecycle findings (PG3 QA2 must close before PG3 publication)
- Product CI + security checks + trusted DEV deploy/smoke + flag activation
- Owner UAT = NOT_TESTED
- Full PG-3 typed Safety complaint extension = **remaining**
- PG-4 / public comments #394 later; #445 UI repairs precede new UI of same screen / PG4

## Non-goals / stops

- No PROD, main promotion, C5, Mode B READY, whole-parent close
- No AGENTS/Git/runtime/PROD/API/security/schema modifications by author; no secrets
- No migration re-run; no feature expansion; no new request engine/framework/test runner/polling
- No whole-suite matrix expansion; no ModelHigh; no Astra diagnosis; no new paid models for known void/async issue
