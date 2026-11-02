# Public entity comments — GAME Q&A + VENUE restriction (#394)

**Status:** source candidate for prospective `0.1.0-alpha.15` / API `0.25.0`. Parent #394 remains PARTIAL (experience-review / player-profile audience pending). Owner UAT: NOT_TESTED. No PROD. Broad VENUE writer from superseded PR465 policy is **closed** after Owner clarification 02.11.2026 (attendance-gated experience reviews) — this file describes **installed source policy**, not the proposed full review flow.

## Scope

- Real public **GAME** questions/comments on ordinary **GameDetailPage** (published + visibility public).
- **VENUE** broad create/reply/update is fail-closed centrally in API (including authorizeReplay). GET `/v1/venues/{id}/comments` verifies public canonical parent + normal params, then returns a contract-compatible **empty** page with `canCreate:false` — does not expose legacy/unproven venue-comment rows, counts, replies, or identities. No fabricated attendance eligibility.
- **VenuePage** does **not** mount broad `CommentsSection`; honest placeholder only: «Отзывы после игр появятся здесь». Contacts / gallery / map / game create unchanged.
- Author **owned delete/withdrawal** of a legacy venue row remains on the existing owned-delete path (auth, version CAS, idempotency, tombstone audit). Shared public-parent check still applies; it must not block authorized withdrawal. No migration rewrite; data/revisions retained.
- Player-profile comments **not** enabled. Private Postgame (PG3) reviews/notes and chats stay separate — never imported or exposed as public player reviews.
- Confirmed **private peer** create + missing-mark clarification (not venue publication) is specified in `POSTGAME_FEEDBACK_CONTRACT.md` (API `0.26.0` candidate). Public venue experience-review / typed reviewSafety remain **not installed**; proposal material: https://files.anpavel.ru/projects/gobadminton/design/style-guide/reviews/20261102-astra-v1/index.html.

## Data

- Migration `0051_entity_comments`: `entity_comments` + private `entity_comment_revisions` (unchanged; no rewrite).
- Fixed kinds `game` | `venue` with UUID parent invariants; reply parent must be same-entity root; reply-to-reply rejected.
- Soft delete: public `body=null` / tombstone; audit retains prior body privately and never exposes it.

## Visibility and fencing

- Read only when parent is currently public/available:
  - Game: `published` + `visibility=public` + not `taken_down` (existing moderation flag). List projects live comments as before.
  - Venue: lifecycle `unverified|verified`, `canonical_venue_id IS NULL` (merged/retired stale ids → indistinguishable 404). After parent check, list is empty until a future eligibility-backed projection.
- Parent locked in a short transaction; re-read after waiting so projection cannot diverge from visibility.
- Guest may read public game contexts. Create/reply/edit/delete require active authenticated cookie mutation (CSRF / Origin / Idempotency-Key) plus `account.access` + `profile.public`.
- List `canCreate`: GAME mirrors write gates (active viewer + restrictions + game↔organizer block); VENUE always `false` (no invented attendance). UI shows composer only when `canCreate`.
- Only the comment author edits/deletes own **game** entry; venue **update** is closed with create/reply (`COMMENT_VENUE_WRITES_CLOSED`); venue **owned delete** remains. No new organizer/venue-owner/admin moderation rights.
- Authenticated readers do not receive blocked-pair author body/avatar/identity in GAME list/count. Writers cannot reply to a blocked author or post into a game when blocked with its organizer. Pair checks re-run on execute and replay.
- Inactive/restricted/private author projection uses safe public display (`Игрок`) without email, private user id, or protected avatar.

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/games/{id}/comments` | Guest-ok when parent public |
| POST | `/v1/games/{id}/comments` | Create root or reply (`parentCommentId`) |
| GET | `/v1/venues/{id}/comments` | Parent public check; empty page / `canCreate:false` (no legacy row leak) |
| POST | `/v1/venues/{id}/comments` | Fail-closed `COMMENT_VENUE_WRITES_CLOSED` (create + reply + replay) |
| PUT | `/v1/comments/{id}` | Own edit + CAS for GAME; VENUE updates fail-closed |
| DELETE | `/v1/comments/{id}` | Own tombstone + CAS (GAME and legacy VENUE withdrawal) |

- Cursor: stable `created_at+id`, validates kind/entity/parent/order; page default 20 / max 50.
- Roots and replies paginated separately; no unbounded nested return.
- `visibleCount` counts visible entries only (or null) — never a misleading global number. Venue list reports `0`.
- Text: max 1000 Unicode characters; reject whitespace-only; HTML rendered as text.
- Idempotent create/reply/edit/delete via MutationRunner: frozen key/body; authorize current parent/actor/pair again on replay; stale version → conflict. Venue create/update authorizeReplay re-applies the closed gate.

## UI

- **GameDetailPage:** List + composer, local reply disclosure, own edit/delete via existing `ProfileDialog` / CloseButton / Escape / focus / busy. Guest auth entry; loading / error / empty; load more; four-line clamp with explicit expand.
- **VenuePage:** no unrestricted questions/comments composer; small styled placeholder via existing `SurfacePanel`. No fake eligibility / checkmark / working appeal.
- Safety actions reuse existing player report/block with truthful label **on author** — not a comment-report endpoint or auto-hide promise.
- Scoped `comments.css` local tokens; Onest via shell; insets 40 desktop / 20 mobile.
- Session/expiry fences for CommentsSection (GAME) unchanged. VenuePage no longer binds comments `me` / getMe for a broad venue composer.

## Non-goals (this pass)

- Full experience-review implementation, 48h/14d gates, new moderation platform, new migrations, rating, staff roles, public player reviews, PG3 changes, player routes, likes/notifications, C5, PROD, new framework.
