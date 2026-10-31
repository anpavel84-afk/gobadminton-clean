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
- **Metadata wire encoding:** `X-Gallery-Credit-Text`, `X-Gallery-Credit-Url`, `X-Gallery-Source-Url`, `X-Gallery-Source-Author`, and `X-Gallery-Permission-Basis` are sent as `encodeURIComponent` ASCII ByteStrings (Fetch `Headers` rejects raw Cyrillic). `parseGalleryEvidenceHeaders` decodes exactly once before semantic validation; malformed encoding, control characters, and multi-value header arrays are rejected. Kind/fingerprint stay plain ASCII; optional empties use the literal token `null`. Decoded Russian text and source URLs are what evidence/fingerprint validation and storage see.

## Public

- Profile `gallery.coverage` is `ordered` (max 8 approved active items). Legacy single `cover` remains.
- `description` is optional public text (not `booking_note`); omitted edit preserves; explicit null clears.
- `VenueGallery` reuses existing 16:9 / max-200 desktop shell, icon arrows, counters, SelectedVenueCover morph slot when the shown item is the main cover URL. Horizontal image swipe is axis-locked so vertical sheet gestures stay intact.

## Presentation fallback (Owner #422 · generic v1)

- When a venue has no usable uploaded cover (missing or failed image), consumer UI shows one of four source-controlled equipment illustrations under `apps/web/public/discovery/venue-illustrations/{racket,hand,shuttles,pair}-v1.webp` (provenance: `docs/product/assets/venue-illustrations-v1.json`).
- Selection is stable by venue id (deterministic hash shared SSR/client); same venue keeps the same illustration on page, map compact/expanded, desktop, and create-venue picker. Not random, time-based, or list-index based.
- These are **generated app illustrations**, not uploaded venue photos: they never become gallery records, never count in photo statistics, and never override real photo/logo/illustration credits or main selection. Uploaded covers and gallery items always take precedence.
- Alt text is `Иллюстрация: бадминтон`; credit/badge say `Иллюстрация` (not a claim of a real court or specific hall). Marker: `data-fallback="illustration"`.

## Out of scope

- No consumer uploads, new privileges, PROD, mass cleanup migration, or new frameworks/services.
