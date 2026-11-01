# Issue #372 / PG-2 Dispute response + scoped case resolution — Mode A author handoff

From: Cursor Auto (`OWNER_APPROVED_PG2_RESPONSE_CORRECTION_SCOPED_CASE_RESOLUTION`, attempt 3, base `30ef78ac88c2e39abe75b953aeaa5baeb5f0956d`).
To: one independent Codex Sol Medium QA → mandatory Product CI → trusted DEV release/smoke.
Status: SOURCE CANDIDATE repair of Independent Codex P2 F1–F4 / **UAT=NOT_TESTED** / PG-2 source default **OFF**, **NOT_INSTALLED / NOT_QUALIFIED** on runtime / **NOT READY** / no DEV claim for PG-2.
Parent #372 PG-2 slice only. PG-3/PG-4 not done. Mode B binding NOT claimed. Author checks ≠ independent QA.
Native first-source HOLD and prior FAIL/usage preserved; this is a new productive repair admission (no history reset). Independent source review of authorization/assignment/party/replay/lock/DB/0047 accepted — those parts not rewritten.

## Runtime / flag accuracy (do not mis-state)

- Live DEV **PG-1b** flag is already **ON** (do not claim the whole post-game runtime is OFF).
- **PG-2** source remains default **OFF**, **NOT_INSTALLED / NOT_QUALIFIED** until trusted install + qualification. Not full-parent DONE. PROD forbidden.

## Pass-3 repair (Independent Codex P2 F1–F4 only)

1. **F1 Admin Intake UNKNOWN** — Transport/timeout/parse and non-definite failures preserve frozen pending `{kind,path,key,body,actor}`; recover dispatches `pending.kind` (intake works with `detail=null`); second intent cannot mint a new key while UNKNOWN; ordinary refresh does not clear preserved UNKNOWN; session principal mismatch refuses recovery attach.
2. **F2 Admin Resolve binding** — POST receipt validated against frozen case/dispute/resolution/version/leavesOpen before success; reread must match receipt identities; malformed `{}` success stays UNKNOWN (no «Решение зафиксировано.»); retry copy derives from frozen resolution; `insufficient_evidence` messaging stays open.
3. **F3 Consumer resolving ACK** — ACK response may include optional typed `resolvedDispute` receipt only when the exact requested dispute closed in-transaction; client requires id/`resultingVersion=expected+1`/resolved/contextId/attendanceVersion; missing/wrong/withdrawn/stale keep UNKNOWN; ordinary ACK unchanged; OpenAPI 0.22.0 additive schema; disposable DB test asserts receipt + same-key replay (operator-run).
4. **F4 Manager multiple disputes** — Roster «Открыть уточнение» + clarification pills select each authorized open roster dispute; draft resets on deliberate selection; late fetch A fenced after selecting B; UNKNOWN path remains mutation-bound (not reattributed); bounded current-page roster only.

## Delivered source

1. Prior PG2-01..05 / 0047 / consumer+admin paths retained.
2. UI/OpenAPI **0.22.0** / proposed app `0.1.0-alpha.4` unchanged this pass (not bumped to alpha.5). Alpha.3 DEV ACCEPTED seed retained. **Not** claiming alpha.4 READY.

## Checks (author, pass-3)

- `@gobadminton/{admin,web,api,contracts}` typecheck — PASS
- `@gobadminton/{admin,web,api,contracts}` lint — PASS
- `@gobadminton/admin` units (incl. attendance-disputes) — PASS
- `@gobadminton/web` units (incl. game-results + mutation resolving ACK / two-open-dispute list) — PASS
- `@gobadminton/api` units (game-attendance-disputes) — PASS
- `@gobadminton/contracts` OpenAPI/admin-protocol — PASS (0.22.0; inventory 41 after completing PG-2 admin op metadata)
- Targeted client probes (private copy; originals untouched) — repaired outcomes:
  - resolving ACK missing/wrong withdrawn → reject; valid `resolvedDispute` → accept
  - intake network → UNKNOWN; second intent blocked (no new key)
  - intake 500 recover → same-key retry (count 2)
  - malformed resolve `{}` → UNKNOWN; notice ≠ «Решение зафиксировано.»; dispute remains open
- Disposable PostGIS `game-attendance-disputes.disposable` (ACK `resolvedDispute`) — **NOT RUN** (no dedicated/hosted disposable DB in author env). Trusted operator runs. Do not claim DB PASS.
- Browser / Product CI / DEV — outstanding trusted process.

## Companion note (contracts inventory)

Completing `x-client-surface` / `AdminSessionCookie` / Idempotency+CSRF on the three existing PG-2 admin OpenAPI operations required bumping `packages/contracts/scripts/check-admin-protocol.mjs` inventory **38→41** so contracts can validate. That one-line inventory update is outside the literal allowed_paths list but is the direct companion to `openapi.json` protocol completion for those same three paths; no other off-list source edits.

## Unresolved technical gates

- Independent QA of this candidate (F1–F4 + non-regression of accepted paths).
- Disposable DB + Product CI + trusted DEV deploy/smoke for PG-2.
- Owner UAT = NOT_TESTED.
- PG-2 runtime remains NOT_INSTALLED / NOT_QUALIFIED; PROD forbidden.

## Non-goals / stops

- No PROD, main promotion, C5, Mode B READY, whole-parent close.
- No rewrite of MutationRunner / new scheduler / RBAC role grants / AGENTS / Git / root.
- Do not edit applied 0042/0046 SQL.
- No broad re-audit of accepted authorization/assignment/party/replay/lock/0047.
