# Implementation · Radar MapLibre / Places / Consent-gated Players

ID radar-dev-map-ui-20261013-v001; Owner Issues #13 #14. Source-only Germany DEV. Work from existing clean main without replacing existing Radar controller or rebuilding the product.

Confirmed code: apps/web/src/components/consumer/radar/GeographicRadarMap.tsx exists with MapLibre/PMTiles and pin rendering; RadarPage currently gates candidateMapAllowed() to localhost. Add an obvious КАРТА / СПИСОК control in Players/Radar navigation for desktop and mobile, including keyboard labels, active state, loading, offline and fallback states.

German DEV has verified public local static candidate assets: https://dev.gobadminton.ru/map-assets/releases/moscow-20261007-p4-098a869f-v001/style-dev.json SHA256 0ed88388e2cbc21b99425af5164430abda36b599c68f02623725779ec8ab731d ; moscow.pmtiles SHA256 098a869fbddff6f9fb4b7b2cf31128fb5c108b7d88f234d18e7f62af6b347a01 and HTTP 206 range. Rebind MOSCOW_BUNDLE prefix, style pin, transformRequest, MapLibre worker and actual Germany DEV image; never claim map registered until explicit source/provider acceptance.

Use existing /v1/venues city-filtered catalog (about 105 Germany DEV records) for distinct VENUE markers; label site/venue and public address/click action, with pagination and no invented place geodata. Moscow and St Petersburg are distinct cities; avoid placing mixed-city venues in wrong region. Existing backend PostGIS geo point is truth, not browser guess.

Only include PEOPLE markers from existing backend-approved Radar snapshot with explicit active consent/expiry/visibility, not every user profile or a list-derived guessed location. Demo synthetic opt-in may be shown only when truly activated in DEV and labeled demo. No coordinates exposed after stop/expiry, stale session, block, age/privacy fence, or no consent.

Do not mutate PROD tiles, Xray/VPN, German PROD Nginx or PROD PostGIS. Source candidate must be built/tested in distinct worktree and published by authorized Writer, independently QA-reviewed, then paired Web/API DEV-only deploy with rollback.

Acceptance: German style GET200 compressed, 206 PMTiles, glyph/sprite loads, MapLibre map paints with accessible button and visible public venues, consented players only, real browser smoke on dev.gobadminton.ru with proper attribution.
