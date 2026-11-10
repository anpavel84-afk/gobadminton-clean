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


## S2 selected private revision editing · API 0.41.0

`GET /v1/me/venue-reviews/:id` requires the owner's cookie session and returns
`Cache-Control: no-store`. Absent, malformed and another owner's ID return the
same `404 RESOURCE_UNAVAILABLE` before game/attendance reads. Collection latest50
is still incomplete; only an actually returned own ID opens this UI.

`SelectedOwnVenueReview` in OpenAPI is the primary wire contract. The consistent
read-only snapshot returns the exact pending revision, otherwise approved revision:
`editContext.revisionId`, `resourceVersion`, persisted `gameId`, and current `basis`
(admission/reason/helpHint, outcome/attendance versions, firstEligibleAt). Slot
`version` is distinct from revision `resourceVersion`. This is the selected
revision's game, not a claim about the slot's first game. No admission scan of
latest30/latest50 or association by venue/text is used. Missing or withdrawn basis
returns null context and `editUnavailableReason`; missing canonical history,
hold, deny and closed windows remain unavailable. Current per-game window and
appeal semantics use existing policy; GET initializes no fences or windows.

The private collection reads the selection before opening the existing Composer.
Editing pre-fills exact text, topics and audience, with public consent unchecked.
Before each new command it rereads the selected owner resource and submits the
existing `POST /v1/me/venue-reviews/:id/commands` `submit_revision` action with exact
expectedVersion, gameId, expectedBasisVersions, text/topics/audience and current
public consentProjectionHash. Write-time checks remain authoritative. A changed
revision, basis or slot version invalidates consent and requires a successful
selected fresh read and new deliberate confirmation. A failed read keeps the
conflict fence; a collection GET cannot clear an edit conflict. Successful reads
never automatically submit. Creation keeps its existing fixed-game flow.

Unresolved edits keep the identical in-memory packet, key, actor and CSRF through
native close/reopen and deliberate retry. Neither GET nor a version change proves
an unresolved write. Actor/session/revoke fences discard visible private state
and ignore late callbacks; no private persistence. Edit receipt validation is
separate from withdrawal validation. Withdrawal remains independent of admission,
window and moderation availability, except while another operation is unresolved
or a confirmed stale version still requires a fresh read. Public quotation keeps
the S1 exact-handle public-read path: private pending text is never quoted as the
old public revision. This change adds no migration, policy or public provenance.
