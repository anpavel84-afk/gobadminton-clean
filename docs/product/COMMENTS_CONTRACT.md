# Public entity comments — GAME + VENUE first slice (#394)

**Status:** source candidate for prospective `0.1.0-alpha.15` / API `0.25.0`. Parent #394 remains PARTIAL (player-profile audience/opt-out pending Owner). Owner UAT: NOT_TESTED. No PROD.

## Scope

- Real public comments on ordinary **GameDetailPage** (published + visibility public) and **VenuePage** (canonical selectable unverified/verified id after UI alias resolution).
- Shared `CommentsSection` after game terms/contacts (and optional chat link) / after venue map in main column. Not map popup, Radar, or inspector.
- Player-profile comments **not** enabled. Private Postgame reviews/notes and chats stay separate — never imported or exposed.

## Data

- Migration `0051_entity_comments`: `entity_comments` + private `entity_comment_revisions`.
- Fixed kinds `game` | `venue` with UUID parent invariants; reply parent must be same-entity root; reply-to-reply rejected.
- Soft delete: public `body=null` / tombstone; audit retains prior body privately and never exposes it.

## Visibility and fencing

- Read only when parent is currently public/available:
  - Game: `published` + `visibility=public` + not `taken_down` (existing moderation flag).
  - Venue: lifecycle `unverified|verified`, `canonical_venue_id IS NULL` (merged/retired stale ids → indistinguishable 404).
- Parent locked in a short transaction; re-read after waiting so projection cannot diverge from visibility.
- Guest may read public contexts. Create/reply/edit/delete require active authenticated cookie mutation (CSRF / Origin / Idempotency-Key) plus `account.access` + `profile.public`.
- Only the comment author edits/deletes own entry. No new organizer/venue-owner/admin moderation rights.
- Authenticated readers do not receive blocked-pair author body/avatar/identity in list/count. Writers cannot reply to a blocked author or post into a game when blocked with its organizer. Pair checks re-run on execute and replay.
- Inactive/restricted/private author projection uses safe public display (`Игрок`) without email, private user id, or protected avatar.

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/games/{id}/comments` | Guest-ok when parent public |
| POST | `/v1/games/{id}/comments` | Create root or reply (`parentCommentId`) |
| GET | `/v1/venues/{id}/comments` | Guest-ok when parent public |
| POST | `/v1/venues/{id}/comments` | Create root or reply |
| PUT | `/v1/comments/{id}` | Own edit + `expectedVersion` CAS |
| DELETE | `/v1/comments/{id}` | Own tombstone + `expectedVersion` CAS |

- Cursor: stable `created_at+id`, validates kind/entity/parent/order; page default 20 / max 50.
- Roots and replies paginated separately; no unbounded nested return.
- `visibleCount` counts visible entries only (or null) — never a misleading global number.
- Text: max 1000 Unicode characters; reject whitespace-only; HTML rendered as text.
- Idempotent create/reply/edit/delete via MutationRunner: frozen key/body; authorize current parent/actor/pair again on replay; stale version → conflict.

## UI

- List + composer, local reply disclosure, own edit/delete via existing `ProfileDialog` / CloseButton / Escape / focus / busy.
- Guest auth entry; loading / error / empty; load more; four-line clamp with explicit expand.
- Safety actions reuse existing player report/block with truthful label **on author** — not a comment-report endpoint or auto-hide promise.
- Scoped `comments.css` local tokens; Onest via shell; insets 40 desktop / 20 mobile.
- Session/expiry: VenuePage clears `me` on `gb-private-expired` without getMe reload (no 401 loop); session-changed permits one fenced getMe. CommentsSection fences root/reply GET and mutation callbacks on both events, clears privileged drafts/menus immediately, denies new mutations under the expired fence, and does not call getMe; a new host me/csrf boundary reactivates with fresh public read. Pending PUT/DELETE success binds exact comment id in `pending.path`; corrupt storage held; UNKNOWN markers are not deleted on logout.

## Non-goals

- Player routes/UI/DB rows, likes/ratings/notifications, new admin privileges, capacity/booking/contacts/friendship/profile-visibility changes, C5, PROD, new framework.
