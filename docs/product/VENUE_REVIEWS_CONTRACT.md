# Venue experience reviews · #394 (API 0.34)

Public venue experience after confirmed held participation. Legacy `entity_comments` VENUE create/reply stay closed.

## Eligibility

Server-derived only: game ended + `outcome=held` + historical eligible participation + permitted present (`manager_explicit` / `case_reviewer`, not self) + no open attendance dispute + resolved canonical played-at venue. Creator of venue row cannot self-attest as venue experience. Missing/conflicted venue attribution → `missing_history` (honest limitation).

## Audience & publication

- Default `self_draft` (private own).
- Public requires unchecked per-revision consent of exact generic projection (author label «Участник игры» only).
- One author/canonical-venue slot; one author/venue/game fence; later eligible game updates the same slot.
- Submit window: 14 days from first server-derived `first_eligible_at` (ordinary toggles do not reset).
- Public visibility: independent Case approve of exact revision **and** `now >= max(approved_at, last_material_edit_at + 48h)` computed on ordinary reads — no scheduler. Old approved text remains while a pending revision waits.
- No venue public-reply role in v1. No star aggregate / automatic skill change.

## Moderation

Durable pending intake created by applicant; staff creates real Case. Typed report/appeal bind exact revision. Organizer cannot delete criticism or act as venue representative. Negative opinion allowed; report count alone does not hide.

## Routes

- `GET /venues/{venueId}/experience-reviews`
- `GET/POST /me/venue-reviews`, eligibility, consent-preview, commands, reports
- Admin: `GET /admin/venue-reviews/pending-intakes`, `POST /admin/cases/venue-review-intake`, `GET /admin/cases/{id}/venue-review-source`, Case action `venue_review_decide`
