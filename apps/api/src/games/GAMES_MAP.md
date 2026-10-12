# Public Games map backend (GMap-1)

Implementation candidate; independent QA and PM disposition are still required.
The wire source is `packages/contracts/openapi.json`, GET `/games/map`.
Original scope is PM publication `fb00d9c2cdffb46f40d7d50ab2fa0a0fb141a544`.
Current-main integration authority is `3071406b893a42ab37201481064fbab707d1d6d6`,
base `2b72a50367c84b510c4ac1bd08845cf6afff22ee`. Current OpenAPI version,
FB01 creator seats/private contact preferences and geographic schemas are preserved.

`games-discovery.query.ts` owns normalized public eligibility for list and map.
List pagination is applied after matching. Omitted list temporalScope still means
all explicit-window matches; upcoming uses PostgreSQL statement time. Valid alias
venueId filters resolve to the same effective identity used for city matching.

`effective-venue.query.ts` is a set-based, read-only Venue projection, shared by
Games list/detail/managed reads. It follows at most eight merged edges with cycle
detection. Failure preserves the original Venue in legacy reads and excludes its
map pin. Distinct canonical IDs never merge because coordinates match.

`games-map.query.ts` aggregates a single SQL snapshot, with input inspection capped
at 20001 Games and group inspection at 201 Venues. Exceeded bounds suppress ranking
and preview work and produce an explicit 422. Occupancy is counted only for the
selected maximum 600 previews and uses the existing server capacity calculation.
No verification, availability, trainer-status or deadline filter is added.

The map read uses three database query calls: BEGIN/read-only/settings, aggregate,
COMMIT. A 1500ms statement deadline and 2500ms operation deadline include pool wait;
timeouts/disconnects destroy a borrowed connection, rolling back its transaction.
A connection acquired after cancellation is released immediately. Successful
requests return their idle connection. SQL/internal errors become safe 503 responses.
All HTTP map outcomes have Cache-Control no-store, including parser errors. The
static map route precedes gameId and never consults consumer credentials.

Before returning a successful body, the reader checks encoded UTF-8 JSON <=2MiB
and validates the actual canonical OpenAPI schema with Ajv. generatedAt is statement
time, validUntil is min(30 seconds later, earliest matching start), including unmapped
Games. No persistent query context, cache, write, migration or spatial asset is added.

Tests require explicitly disposable, loopback PostgreSQL/PostGIS. The new suite
also requires GMAP1_DISPOSABLE_DB=1 because it intentionally constructs broken-FK
synthetic Venue fixtures. Tests never select live runtime configuration. Synthetic
performance evidence describes fixture scale only; it is not a production SLA.
