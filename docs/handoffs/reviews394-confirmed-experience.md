# Handoff · #394 confirmed experience + missing mark

Assignment: `OWNER_20261102_REVIEWS394_CONFIRMED_EXPERIENCE_AND_MISSING_MARK`
Base: `36fd4b4cf4632efa3cc96e93f20a33c220b9708b` (alpha.15 ACCEPTED)
Prospective app: `0.1.0-alpha.16` · API `0.26.0` · UAT `NOT_TESTED` · `sourceSha: null`
#394 remains **PARTIAL** until venue-publication / typed reviewSafety.

## Delivered in this slice

- **A.** New private peer create requires held + lifecycle + historical eligibility + permitted present (manager_explicit/case_reviewer, actor≠subject) both sides + no open dispute. Predicate `isPermittedPresentAssertion` in attendance policy. Capability `peerCreateReason` additive.
- **B.** Missing mark: dispute `attendanceVersion` 0; migration `0052`; Cases first assertion via `expectedAttendanceVersion` 0; UI «Попросить уточнение» / «Оспорить отметку».
- **C.** Safe own reasons on feedback panel; no new modal; org/training/history/notes unchanged.
- **D.** Release notes: alpha.15 seed frozen in history; current descriptor alpha.16.

## Not in this slice

Public venue writer, public player wall/ratings, outcome arbitration SLA, new staff roles, PROD, C5.

## Checks

- Unit: feedback policy + attendance dispute policy + releases catalogue
- Web: game-feedback / game-results / releases focused
- Disposable DB (trusted PMA): feedback + attendance-disputes + admin-attendance-disputes after import
- Product CI mandatory later; do not fake PASS if DB unavailable
