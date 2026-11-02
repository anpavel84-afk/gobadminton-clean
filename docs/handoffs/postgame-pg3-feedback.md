# Issue #372 / PG-3 Private reviews + personal notes — Mode A author handoff

From: Cursor Auto (`OWNER_APPROVED_PG3_PRIVATE_ACTOR_BOUNDARY_REPAIR`, attempt 10, base `d5a0348f669bffcbcd65f68707a1e100e65e3020`).
To: one independent Codex Sol Medium QA → mandatory Product CI → trusted DEV release/smoke → Owner UAT.
Status: **SOURCE CANDIDATE** / UAT=NOT_TESTED / PG-3 writes default **OFF** / **NOT READY** / no DEV ACCEPTED claim for alpha.12 / no PROD.
Parent #372 PG-3 slice only. Full PG-3 typed Safety extension + PG-4 / comments #394 **not DONE**. Mode B binding NOT claimed. Author checks ≠ independent QA.
Prior pass9 final `d5a0348f669bffcbcd65f68707a1e100e65e3020` retained (**QA9 FAIL P1** — actor A private results visible under host B between getMe(B) and getGameResults). Pass8/source8 `bc3e1759f3cfd04e0ba5abaeac7961a47ed610cd` and original 4c / protocol HOLD / costs retained. Current accepted DEV alpha.11 `acec520281d07f30d3fa855043be7d613ba56db1`. C5 OFF / PROD unchanged. No feature expansion beyond private actor-boundary repair.

## Pass 10 — private actor boundary on getMe A→B (QA9 P1)

Allowed paths: `GameResultsComposition.tsx`, `game-results-mutation.test.tsx`, this handoff.

### Finding (QA9 P1, verbatim intent)

- Same-context soft reload kept the ready surface mounted (pass9).
- When `getMe()` returned actor B, `setMe(B)` ran **before** `getGameResults()` settled, so actor A private results / feedback panel stayed visible under host B.
- Clear paths covered 401 / session event, not actor-change via getMe nor results 403.
- Pass9 host tests did not cover actor switch.

### Repair

- `reload()` captures `boundActor` before `await getMe`.
- When returned `account.id` differs from bound actor: synchronously `clearSensitiveUi` + loading **before** exposing new me/host B (results, private forms, confirmedOperation, dispute/context drafts).
- Same confirmed actor A refresh still keeps panel/drafts mounted until matching validated completion (no QA8 always-hide regression).
- Prior actor pending original key/body stays under that actor’s scope; host epoch / actorRef / dispute fences reject late A.
- `clearSensitiveUi` also clears `confirmedOperation`; loading/clear on actor change and known unauthorized results **403/404** (not only 401 / session event).
- Initial load / game change / session logout clears unchanged. No auth weakening, fake permission, silent UNKNOWN clear, or new keys.

### Targeted author checks (this pass)

- Web unit: `game-results-mutation.test.tsx` — A→B delayed results GET (A panel gone before settle; B does not adopt A); A→B with results 403/404 keeps A hidden; prior same-actor PUT/DELETE/conflict/changed-draft cases retained.
- Author runs: `vitest run test/game-results-mutation.test.tsx` (+ reused `game-feedback` / `game-results` when present); `tsc -p tsconfig.json --noEmit` when available.
- No broad PG-1b / PG-2 / SMTP / DB / security re-matrix. Independent QA / Product CI / DEV smoke still required.

### Release metadata (prospective, unchanged claim)

- Candidate app `0.1.0-alpha.12` / API contract note `0.23.0` remain **prospective** — no invented DEV ACCEPTED / Owner PASS / CI green claim.
- Accepted alpha.11 historical seed retained. Design input unchanged; layout/API/migrations/notes backend/release history/UI unchanged.

## Outstanding (honest)

- Independent Sol Medium QA of private actor-boundary repair (must address QA9 P1 with real host evidence)
- Product CI + security checks + trusted DEV deploy/smoke + flag activation
- Owner UAT = NOT_TESTED
- Full PG-3 typed Safety complaint extension = **remaining**
- PG-4 / public comments #394 later

## Non-goals / stops

- No PROD, main promotion, C5, Mode B READY, whole-parent close
- No Git/root/runtime/PROD/API/security/schema/migrations/release-history/UI rewrite; no secrets; no AGENTS.md/CLAUDE.md/.cursor creation
- No new request engine / shared hook rewrite / scheduler / High / Astra
- No whole-suite matrix expansion; this is a new immutable repair after completed pass9 + concrete QA9 FAIL, not replay of an unknown old model operation
