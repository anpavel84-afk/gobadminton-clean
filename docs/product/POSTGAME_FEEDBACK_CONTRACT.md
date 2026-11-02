# Post-game feedback · confirmed experience (#394 slice)

Status: **SOURCE CONTRACT** for confirmed private peer create + missing-mark clarification.
Does not claim full #394 DONE, venue publication, or typed reviewSafety. API contract **0.26.0**.

## Peer create gate (new private peer only)

Server requires, under the game lock / current transaction:

1. Game ended; status `published` or `completed`
2. Explicit outcome `held`
3. Historical participation eligibility (`eligibleFromTransitions`) for **author and recipient** in the same game
4. Explicit current `present` with permitted provenance for **both**: `manager_explicit` or `case_reviewer`
5. Actor of the assertion ≠ subject userId (self-mark / self_attested never qualifies)
6. No open attendance dispute for either side

Creator/manager is not an automatic participant. Identities and venue are derived server-side.
Fail with safe typed reason (`FEEDBACK_PEER_EXPERIENCE_UNCONFIRMED`); do not disclose foreign attendance.
`canCreatePeer` / `peerSubjects` stay consistent; list only eligible same-game peers.

Organization / training / notes keep existing discrepancy and manager rules — a cancelled or unmarked experience may still use those paths. Editing existing private reviews does **not** require newly acquired attendance permission. Public venue writer remains CLOSED; public player wall/ratings remain OFF.

## Capability reason (additive)

Optional `FeedbackCapabilities.peerCreateReason`:

| Code | UI copy |
|---|---|
| `game_not_confirmed` | Игра ещё не подтверждена |
| `attendance_unmarked` | Посещение ещё не отмечено |
| `attendance_clarifying` | Уточняем посещение |
| `no_eligible_peers` | Пока нет участников для отзыва |

Own/generic only — never foreign attendance reasons.

## Missing / unknown attendance clarification

- Extend dispute request: `attendanceVersion` **0** only when no attendance row exists; unknown/known rows use actual version (CAS).
- Migration **0052** allows `challenged_version = 0` (additive; do not edit 0046/0047).
- Projection: `canDispute` for missing/unknown; no ACK for unknown/missing; help = requested (not assigned).
- UI: «Попросить уточнение» (missing/unknown), «Оспорить отметку» (known).
- Cases: assigned independent reviewer may create first assertion with `expectedAttendanceVersion: 0` (`correct_present` / `correct_absent`); insufficient evidence stays open. Manager correction does not auto-resolve an open dispute.

## Remaining (out of this slice)

- Public venue experience publication / typed reviewSafety
- Outcome arbitration timers/SLA
- New staff roles or auto-assignment
