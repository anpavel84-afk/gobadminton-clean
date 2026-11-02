# Post-game feedback · confirmed experience + typed private peer report (#394 slice)

Status: **SOURCE CONTRACT** for confirmed private peer create + missing-mark clarification +
received private peer typed report with assigned Cases source read.
Does not claim full #394 DONE, venue publication, content removal, or public player wall.
API contract **0.27.0**. Application candidate **0.1.0-alpha.19**. Overall #394/#372 **PARTIAL**.

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

## Received private peer typed report (#394/#372)

- `POST /reviews/:reviewId/report` via GameFeedbackController/Service + MutationRunner.
- Cookie + CSRF + Origin + Idempotency. Body: `expectedVersion`, supported `reasonCode`/`detail`, literal `shareReviewWithSupport:true`, `gameId` (client correlation; server verifies).
- Only current authorized **recipient** of a **peer** review may report that received text — not author, not organization/training, not private notes, not other games, not revoked accounts.
- No new attendance gate for reporting historical received private text.
- Server derives game/author/recipient/target; never accepts identity proofs from the client.
- Migration **0053**: `abuse_reports.target_kind` includes `game_review`; binding table `game_review_report_bindings` references exact immutable `game_review_revisions` + explicit consent. Player reports + self-report constraint retained. No private text snapshot under synthetic classification; rollback refuses when typed report history exists.
- Same actor/review/version must not create more `abuse_reports`; same-key replay rechecks audience/session/authority; version conflict retains draft; uncertain outcome retries original key only.
- Lock order: review → game (reply convention). Edit after report never changes bound evidence.
- Receipt: `{ reportId, status: "submitted", reviewId, version }` — no body/recipient/identity.
- Additive `allowedActions.canReport` (received peer only). `complaintReuse: existing_player_report` for profile complaints remains.

## Assigned Cases source read

- Reuse Cases list/create/link/assign/version/audit.
- `GET /admin/cases/:id/review-reports/:reportId`: exact linked report + **currently assigned** reviewer with `evidence.assigned.read` + fresh step-up.
- `case.manage` alone / unassigned staff / general superadmin without assignment is **not** a private-content read right.
- Reuse attendance-dispute COI (author, recipient, game creator/managers/participants).
- Reassignment / session expiry / revoked grant → safe 403/404 immediately. Every private read audited; no mutation for read.
- Case metadata / `report_summary` for `game_review` must not copy private text into `case_evidence_items` (still `internal_synthetic_v1` only). Do not modify SyntheticCaseEvidencePolicy. Return source from immutable revision via authorized audited read.
- Status/note commands may record resolution without altering private review. No claim of content removal, appeal, or public venue moderation.

## Remaining (out of this slice)

- Public venue experience publication / broader typed reviewSafety
- Automatic hide/delete by report count
- New staff roles, scheduler, classifier, or retention policy
- Outcome arbitration timers/SLA
- PROD / main mass migration
