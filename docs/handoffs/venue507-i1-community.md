# Handoff — #507 I1 F4/F5 context summaries + coherent public invalidation

**Author:** Cursor Auto
**Admission (attempt 16):** `OWNER507_I1_F4_F5_CONTEXT_SUMMARIES_AND_COHERENT_INVALIDATION`
**Base SHA (frozen admission):** `03273e436e9cffecd9ae832c765a85bf79f4be79` (source15 consumer reports; parent web types/lint/tests PASS)
**Phase:** SOURCE partial — F4/F5 consumer context wiring + release metadata alpha.58 / API.40
**Prior:** Admin F3 QA14 PASS; consumer report F3 attempt 15; actual DEV.57 / API.39 / SHA `895e97fd` PR525 ACCEPTED; backend API40/schema68 unpublished; source1/source7 UNKNOWN retained

## This attempt scope (SOURCE)

Allowed paths (+ genuine extras noted below):
- `apps/web/src/lib/use-venue-community.ts` — batched public summaries, stable dedupe ≤200, invalidation subscribe, identity reset
- `apps/web/src/lib/venue-community-api.ts` — public invalidation bus; mutation network vs HTTP errors; no actor/CSRF in public keys
- `apps/web/src/components/consumer/venues/VenueCommunityRating.tsx` — parent-owned full still loads `/me`; UNKNOWN same key; allowedActions; compact link/text modes
- Map/picker/sheet/preview/contacts composition + CSS
- `apps/web/src/lib/releases.ts` — CURRENT alpha.58 / API.40 unaccepted; historical alpha.57 ten-field seed ACCEPTED
- Mounted RTL `venue-community-contexts.test.tsx` + release/contact test updates
- Handoff + CONTENT_MODERATION coverage note

### Implemented (attempt 16 — F4/F5)

1. **F4 compact contexts:** `GamesMapView` batches loaded venue IDs (≤200) once; `VenuePreviewCard` / `VenueSheet` share parent summary without nested double render (compact vs expanded); `VenuePickerDialog` shows compact summary + `#ratings` link outside the select button; `GameVenueContacts` labelled link to `/venues/:id#ratings` (static, guest-safe, no `/me`).
2. **F5 invalidation:** module public-only `invalidateCommunitySummaries` after confirmed vote/update/withdraw; mounted hooks refresh canonical + loaded alias peers; coalesce via existing batch queue; no focus/visibility/timer refresh loop; abort/generation/stale guards; mutable `onSummaryChange` via ref (no fetch loops).
3. **Vote mutation safety:** frozen idempotency key + body + exact actor/CSRF/venue; UNKNOWN keeps same key (reconcile via `/me` or explicit same-key retry); no UI success under unknown; no automatic new-key POST; respect update/withdraw/upsert allowedActions; withheld moderation not cleared by author.
4. **Release:** CURRENT `0.1.0-alpha.58` / API `0.40.0` source-only (`source_sha: null`, UAT `NOT_TESTED`); TRUSTED_HISTORICAL_SEED gains accepted alpha.57 from Owner ten-field seed (`895e97fd` / `r42486594258-a1` / `2026-11-08T13:53:05Z` / digests). I2 UGC images and I3 candidate remain deferred/unpublished in notes.

### Explicit NOTDONE / NOT claimed

- Whole I1 **NOT READY** / SOURCE pending independent QA → CI → DEV.58; factual current remains **actual DEV.57 / API.39**
- Mode B binding / AGY author — not claimed
- I2 photos / I3 candidate — deferred
- PROD / merge / push / deploy / C5 — not performed
- source1/source7 UNKNOWN + costs retained; no receipt reset

### Genuine additional paths (reported, not invented components)

- `apps/web/src/components/consumer/pages/CreateGamePage.tsx` — selected-venue chip in create form is **not** in allowed `GameCreatePage.tsx`/`GameForm.tsx` (those paths do not exist). Picker rows covered; create-trigger summary needs a future allowed path if required.
- `apps/web/test/game-venue-contacts.test.tsx` — contact-authority matrix updated to ignore `#ratings` community link and tolerate UNVERIFIED Node `xn--` omit edges.
- `apps/web/src/lib/releases.test.ts` — co-located release literals bumped to alpha.58 / API.40 + alpha.57 historical facts.

## Checks this author pass

- Mounted RTL contexts + report + venue-community unit + releases + contacts: PASS
- Web typecheck / eslint on affected sources: run in author pass
- No Git / push / deploy / live API writes / fake session claim

## Preserve

- PR521 training card + PR523 alignment (now historical alpha.57); MOD506 policies; backend/Admin bytes untouched this pass
- Compact training/Next UI; verified experience reviews distinct from community discussion
- Historical admissions; attempts 1–15 history; UNKNOWN costs
