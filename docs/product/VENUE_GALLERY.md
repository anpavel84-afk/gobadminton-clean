# Venue gallery · Phase B (#422)

Ordered venue-owned media (max 8) with truthful credit/source/permission evidence, plus a short public description.

## Data

- Migration `0045_venue_gallery`: `venue_gallery_items` + `venues.public_description`.
- Existing `venues.cover_*` columns remain the projected **main** for games and older clients.
- Backfill copies every retained cover (photo/logo/illustration) to position 0 / main. Permission/source come from retained cover-import audit when present; otherwise `legacy_preserved_unknown` (never an invented license).

## Admin

- Gallery GET/add/replace/delete/reorder/set-main under `/v1/admin/venues/{id}/gallery*`.
- Same gates as cover: `venue.manage`, creator/superadmin, CSRF/Origin/session/fresh step-up, CAS version, idempotent replay reauthorization.
- Uploads reuse sanitize → stage → verify → ContentModerationService approval/binding and media GC.
- Admin UI (`VenuePhoto`) supports multi-file queue bounded by `8 − current`, sequential versioned commands, ordered preview, main/reorder/delete, and exact pending replay.

## Public

- Profile `gallery.coverage` is `ordered` (max 8 approved active items). Legacy single `cover` remains.
- `description` is optional public text (not `booking_note`); omitted edit preserves; explicit null clears.
- `VenueGallery` reuses existing 16:9 / max-200 desktop shell, icon arrows, counters, SelectedVenueCover morph slot when the shown item is the main cover URL. Horizontal image swipe is axis-locked so vertical sheet gestures stay intact.

## Out of scope

- No consumer uploads, new privileges, PROD, mass cleanup migration, or new frameworks/services.
