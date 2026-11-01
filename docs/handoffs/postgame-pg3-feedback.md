# Issue #372 / PG-3 Private reviews + personal notes — Mode A author handoff

From: Cursor Auto (`OWNER_APPROVED_PG3_PRIVATE_FEEDBACK_PERSONAL_NOTES`, attempt 6, base `9a7b4b12301291154a05ccf7f83989858c3e06b6`).
To: one independent Codex Sol Medium QA → mandatory Product CI → trusted DEV release/smoke → Owner UAT.
Status: **SOURCE CANDIDATE (revised after QAFAIL)** / UAT=NOT_TESTED / PG-3 writes default **OFF** / **NOT READY** / no DEV ACCEPTED claim / no PROD.
Parent #372 PG-3 slice only. Full PG-3 typed Safety extension + PG-4 / comments #394 **not DONE**. Mode B binding NOT claimed. Author checks ≠ independent QA.
Frozen clean SHA `9a7b4b12301291154a05ccf7f83989858c3e06b6`. QAFAIL raw preserved (Sol Medium pass1). No feature expansion; alpha.6 / API 0.23 and historical SMTP alpha.5 / PG-2 alpha.4 records unchanged. Own disposable DB API 3/3 + migration smoke already PASS on exact 9a — server/schema unchanged, reuse that evidence.

## Pass 6 — exact two Sol Medium QA findings

Allowed paths only: `useGameResultsMutation.ts`, `GameFeedbackPanel.tsx`, `game-feedback.test.tsx`, this handoff.

### Finding 1 — `reviewCreate` success validator

- Explicit duplicate POST 200 returns the prior owned projection without applying new fields.
- Validator now checks kind/game/subject and normalized requested fields against the response (`peerRating` / `organizationScore` / `comment` / `tags` / `experienceAssertion` / `discrepancyExplanation` as applicable).
- Same-body existing projection → confirmed idempotent success.
- Mismatched body / cross kind or subject → stays unconfirmed (UNKNOWN); no false UI success reset; exact pending body/key preserved; no automatic new key.
- Existing non-create result guards not loosened.

### Finding 2 — notes edit vs `canCreateNote`

- Create form remains gated by `caps.canCreateNote` (NEW note only, `expectedVersion: 0`).
- Existing own note edit uses `note.contextId` / `note.version` and `note.allowedActions.canEdit`, independent of create capability (manager revoke case).
- Foreign isolation retained (`myNotes` only); readonly when `canEdit` false; delete still on `canDelete`; edit draft reset only for the matching note command; no accidental version-0 create from a stale edit draft.

### Targeted author checks (this pass)

- Web unit: `game-feedback.test.tsx` (validator regressions + panel render/handler for own-edit without create / no-edit when `canEdit` false).
- Typecheck/lint scoped to related web files when run.
- No broad unchanged PG-1b / PG-2 / SMTP re-matrix.

## Outstanding (honest)

- Independent Sol Medium QA re-check of both repaired findings
- Product CI + security checks + trusted DEV deploy/smoke + flag activation
- Owner UAT = NOT_TESTED
- Full PG-3 typed Safety complaint extension = **remaining**
- PG-4 / public comments #394 later

## Non-goals / stops

- No PROD, main promotion, C5, Mode B READY, whole-parent close
- No AGENTS/Git/runtime/PROD/API/security modifications by author; no secrets
- No migration re-run; no feature expansion; no new engine/framework/test runner
- No whole-suite matrix expansion; no ModelHigh; no Astra diagnosis
