# Venue experience reviews · #394 (API 0.34)

Public venue experience after confirmed held participation. Legacy `entity_comments` VENUE create/reply stay closed.

## Eligibility

Server-derived only: game ended + `outcome=held` + no open attendance/outcome dispute + historical eligible participation + permitted present (`manager_explicit` / `case_reviewer`, not self) + immutable `game_played_at_venue_attributions` row resolved to canonical venue. Mutable `games.venue_id` alone is never historical proof; missing/conflicted attribution → `missing_history` (no backfill). Venue creator / historic venue-admin actor cannot self-review that venue.

## Audience & publication

- Default `self_draft` (private own).
- Public requires unchecked per-revision consent of exact generic projection (author label «Участник игры» only).
- One author/canonical-venue slot; one author/venue/game fence; later eligible game updates the same slot with its own per-game window.
- Submit window: 14 days from server-derived first eligible (max of ends_at / first held revision / first permitted present); ordinary toggles/probes do not reset. Appeal pauses remaining; favorable resolve grants `max(remaining, 7d)`.
- Public visibility: independent Case approve of exact revision **and** `now >= max(approved_at, last_material_edit_at + 48h)` computed on ordinary reads — no scheduler. Old approved text remains while a pending revision waits. Report count / basis_under_review alone do not hide published criticism.
- No venue public-reply role in v1. No star aggregate / automatic skill change.

## Moderation

Durable pending intake created by applicant; staff creates real Case. Typed report/appeal bind exact revision. Independent assigned reviewer requires step-up + CAS; COI includes subject, historic game manager (any seat), participant, venue creator, and historic venue-admin actor. Organizer cannot delete criticism or act as venue representative.

## Routes

- `GET /venues/{venueId}/experience-reviews`
- `GET/POST /me/venue-reviews`, eligibility, consent-preview, commands, reports
- Admin: `GET /admin/venue-reviews/pending-intakes`, `POST /admin/cases/venue-review-intake`, `GET /admin/cases/{id}/venue-review-source`, Case action `venue_review_decide`
