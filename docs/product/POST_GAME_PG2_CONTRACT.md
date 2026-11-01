# Post-game PG-2 · dispute response / scoped case resolution

Status: **SOURCE CONTRACT for #372 PG-2** (implementation candidate). Does not claim DEV/PROD READY.
Owner visuals approved 2026-11-01; product model OWNER_CONFIRMED. Freeze matches `packages/contracts/openapi.json` **0.22.0**.

## Consumer

| Method/path | Actor | Notes |
|---|---|---|
| `POST /attendance-disputes/{id}/responses` | current manager | Explanation; optional correction present/absent/unknown. **Never closes** open dispute. |
| `POST /attendance-disputes/{id}/help` | subject participant | Escalation **progress** only — not abuse_report, not staff assignment. |
| `POST .../acknowledgements` | subject | Optional `resolvingDisputeId` + `expectedDisputeVersion` closes own open objection after accepting **current known** assertion. Unknown cannot ACK. |
| `PUT .../attendance/{contextId}` | manager | Additive `unknown` value only as correction (version ≥ 1) with reason. |

## Admin (existing audience / step-up / assignment)

| Method/path | Permission | Notes |
|---|---|---|
| `POST /admin/cases/attendance-dispute-intake` | `case.manage` + step-up | Creates case **without** abuse_report; links `game`; unique dispute→case; assigns self. |
| `GET/POST /admin/cases/{caseId}/attendance-disputes/{disputeId}` | `case.manage` or assigned `case.assigned.manage` | Exact case/dispute/attendance versions. Resolutions: uphold_current / correct_present / correct_absent / clear_unknown / insufficient_evidence. Server derives reviewer provenance; client cannot set `independently_verified`. Reviewer ≠ subject/manager/participant. |

## Invariants

- One open dispute; unique case mapping; one closing resolution per dispute.
- Manager response/correction leaves dispute OPEN.
- Withdraw does not rewrite attendance.
- No time-based presence/no-show/penalty.
- Migration **0047** additive; do not edit 0042/0046.
- Writes remain `POST_GAME_INTERNAL_ENABLED` default OFF.
