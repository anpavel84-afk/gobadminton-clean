# Issue #372 / PG-2 Dispute response + scoped case resolution — Mode A author handoff

From: Cursor Auto (`OWNER_APPROVED_PG2_RESPONSE_CORRECTION_SCOPED_CASE_RESOLUTION`, attempt 4, base `4c622bb374d2f13e5b787d7dd4bb784da43f5e37`).
To: one independent Codex Sol Medium QA → mandatory Product CI → trusted DEV release/smoke.
Status: SOURCE CANDIDATE repair of remaining Independent QA2 **P2 intake recovery** / **UAT=NOT_TESTED** / PG-2 source default **OFF**, **NOT_INSTALLED / NOT_QUALIFIED** on runtime / **NOT READY** / no DEV claim for PG-2.
Parent #372 PG-2 slice only. PG-3/PG-4 not done. Mode B binding NOT claimed. Author checks ≠ independent QA.
Prior Independent QA2 acceptance of original 4 findings / 7 selection checks / server authority / DB / API receipt paths is preserved — not rewritten. This pass repairs only the remaining F2 P2 intake reread version lock.

## Runtime / flag accuracy (do not mis-state)

- Live DEV **PG-1b** flag is already **ON** (do not claim the whole post-game runtime is OFF).
- **PG-2** source remains default **OFF**, **NOT_INSTALLED / NOT_QUALIFIED** until trusted install + qualification. Not full-parent DONE. PROD forbidden.

## Pass-4 repair (remaining Independent QA2 P2 only)

**F2 intake recovery later-version lock** — After lost POST → same frozen path/body/key → exact valid intake receipt (`validateIntakeReceipt` unchanged: exact transition/identity/shape), authorized same case/dispute/assignee reread may carry later monotonic integer `dispute.version` / `caseVersion` **≥** receipt. Confirm historical intake separately from current assignment/action availability: clear UNKNOWN and keep showing the reread's `allowedActions` (do not invent new actor/assignee authority or claim latest state unchanged). Reject wrong case/dispute, wrong assignee, malformed versions, and regress/stale lower versions; keep frozen key/body while unconfirmed. Mere HTTP 200 without validated receipt+reread still leaves UNKNOWN.

## Delivered source (only allowed paths)

1. `apps/admin/src/components/AttendanceDisputes.tsx` — `rereadMatchesIntake` accepts ≥ receipt versions with exact identities.
2. `apps/admin/test/attendance-disputes.test.tsx` — later-version positive recovery + wrong-identity/lower-version negatives; exact same-version still confirms.
3. This handoff. App **0.1.0-alpha.4** / API **0.22.0** unchanged (same unreleased candidate; no version bump; not claiming READY).

## Checks (author, pass-4)

- `@gobadminton/admin` typecheck — PASS
- `@gobadminton/admin` lint — PASS
- `@gobadminton/admin` unit `attendance-disputes.test.tsx` (6) — PASS
- Unchanged API/DB/consumer checks — **reused, not re-run** (prior Independent QA2 acceptance).
- Private later-version probe (`/tmp/.../tmp/postgame372-pass4-intake-later-version-probes.cjs`; original QA evidence untouched) — PASS (later-version recovery; wrong-identity/lower-version rejects; exact same-version; no third request).
- Browser / Product CI / DEV — outstanding trusted process.

## Unresolved technical gates

- Independent QA of this remaining F2 repair + non-regression of already-accepted paths.
- Product CI + trusted DEV deploy/smoke for PG-2.
- Owner UAT = NOT_TESTED.
- PG-2 runtime remains NOT_INSTALLED / NOT_QUALIFIED; PROD forbidden.

## Non-goals / stops

- No PROD, main promotion, C5, Mode B READY, whole-parent close.
- No whole-component rewrite / full-site audit / new deps / framework / Git / AGENTS / root / SSH / live.
- Do not edit original QA evidence under `qa-postgame372-disputes-pass2/`.
