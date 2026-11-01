# Post-game PG-2 · dispute response / scoped case resolution

Status: **SOURCE CONTRACT for #372 PG-2** (implementation candidate). Does not claim DEV/PROD READY.
Owner visuals approved 2026-11-01; product model OWNER_CONFIRMED. Freeze matches `packages/contracts/openapi.json` **0.22.0**.

## Consumer

| Method/path | Actor | Notes |
|---|---|---|
| `POST /attendance-disputes/{id}/responses` | current manager | Explanation; optional correction present/absent/unknown. **Never closes** open dispute. |
| `POST /attendance-disputes/{id}/help` | subject participant | Escalation **progress** only — not abuse_report, not staff assignment. |
| `POST .../acknowledgements` | subject | Optional `resolvingDisputeId` + `expectedDisputeVersion` closes own open objection after accepting **current known** assertion. Response includes optional ACK-only `resolvedDispute` receipt (`id`, `resultingVersion=expected+1`, `status=resolved`, `contextId`, `attendanceVersion`) when that exact dispute closed in-transaction. Absence of open-dispute summary is **not** closure proof. Unknown cannot ACK. |
| `PUT .../attendance/{contextId}` | manager | Additive `unknown` value only as correction (version ≥ 1) with reason. |

## Admin (existing audience / step-up / assignment)

| Method/path | Permission | Notes |
|---|---|---|
| `POST /admin/cases/attendance-dispute-intake` | `case.manage` + step-up | Creates case **without** abuse_report; links `game`; unique dispute→case; assigns self. |
| `GET/POST /admin/cases/{caseId}/attendance-disputes/{disputeId}` | assigned `case.manage` or assigned `case.assigned.manage` | Exact case/dispute/attendance versions. Local read requires current assignment + capability + independent-party eligibility (no global `case.manage` bypass). Resolutions: uphold_current / correct_present / correct_absent / clear_unknown / insufficient_evidence. Server derives reviewer provenance; client cannot set `independently_verified`. Reviewer ≠ subject / any historic manager or creator / participant. Legacy Cases metadata APIs unchanged. |

## Invariants

- One open dispute; unique case mapping; one closing resolution per dispute.
- Manager response/correction leaves dispute OPEN.
- Withdraw does not rewrite attendance.
- No time-based presence/no-show/penalty.
- Migration **0047** additive; do not edit 0042/0046.
- Writes remain `POST_GAME_INTERNAL_ENABLED` default OFF.
