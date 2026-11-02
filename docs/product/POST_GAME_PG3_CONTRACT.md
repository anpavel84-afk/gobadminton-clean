# Post-game PG-3 · private reviews + personal notes

Status: **SOURCE CONTRACT for #372 PG-3** (implementation candidate). Does not claim DEV/PROD READY.
Owner visuals approved 2026-11-01; product model OWNER_CONFIRMED. Freeze matches `packages/contracts/openapi.json` **0.23.0**.

## Consumer

| Method/path | Actor | Notes |
|---|---|---|
| `POST /games/{gameId}/reviews` | authorized participant (peer) or participant/manager (org/training) | Requires `experienceAssertion=i_experienced_this_game`. Server derives recipient. No self-peer. UNIQUE → owned receipt/conflict. Discrepancy required unless attendance present / not_participant_manager. |
| `PATCH /reviews/{id}` | author | Editable fields + `expectedVersion`; identity/recipient/kind immutable; edited marker/history. |
| `PUT /reviews/{id}/reply` | designated recipient | Singleton reply; `expectedVersion` 0 creates. |
| `GET /me/reviews` | self | `direction=sent\|received`, limit 1–50 default 20. |
| `PUT /games/{gameId}/notes/{contextId}` | current manager creates; existing author edits after revoke | Server-derived author/subject. Tombstoned notes cannot resurrect. |
| `DELETE /games/{gameId}/notes/{contextId}` | author | Versioned tombstone/history. |
| `GET /games/{gameId}/notes/{contextId}` | author | Narrow private read; foreign/missing → private 404. |

Optional additive `GameResults.feedback` projection (capabilities + own notes/reviews). Backward compatible.

## Frozen bounds (no invented time windows)

- comment / reply / note / discrepancy: plain text 1–500
- peer tags: ≤3 from `communication` \| `teamwork` \| `agreements`
- organizationScore: 1–5 optional; org needs score **or** comment
- `actorMutationBudgetPerGame`: **80** revision inserts per actor per game (count cap only)
- me/reviews page: 1–50

## Invariants

- No public rating, skill mutation, aggregates, or public review route.
- Manager cannot delete negative review; no general staff reading.
- Creator is not automatic participant; reject pending/unknown foreign contexts.
- Held/not_held/unknown/contested attendance is not time inference.
- Complaint: reuse existing player report UI/contract; typed review Safety extension = **remaining** (not full PG3 DONE).
- Migration **0048** additive; do not edit 0042/0046/0047.
- Writes remain `POST_GAME_INTERNAL_ENABLED` default OFF.
