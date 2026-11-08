# Handoff — #507 I1 independent QA17 FAIL4 repair (attempt 18)

**Author:** Cursor Auto
**Admission (attempt 18):** `OWNER507_I1_INDEPENDENT_QA_FOUR_FINDINGS_REPAIR`
**Base SHA (frozen admission):** `d3c1ebfca2af6206fb5b1b7b67fb1c7e87887857` (source17 testonly123 PASS; reviewer135 PASS/typecheck; backend/Admin 46 paths byte-identical accepted)
**Phase:** SOURCE pending independent QA → CI → DEV
**Prior:** Admin F3 QA14 PASS; consumer report F3 attempt 15; F4/F5 attempt 16; source17 Unicode/JSONL transport recovered without model replay; actual DEV.57 / API.39 / SHA `895e97fd` ACCEPTED; target alpha.58 / API.40 / schema68 source only; source1/source7 UNKNOWN retained

## This attempt scope (SOURCE)

Allowed paths only:
- `VenueCommunityRating.tsx` — F1 UNKNOWN vote reconcile
- `use-venue-community.ts` — F2 subscription vs request generation
- `GameVenueContacts.tsx` — F3 real compact public summary
- `CreateGamePage.tsx` — F4 selected-venue compact summary
- `venue-community.css` — selected-community spacing
- Mounted/contact/create fixtures listed in admission
- Handoff + CONTENT_MODERATION coverage note

### Implemented (attempt 18 — QA17 FAIL4)

1. **F1 UNKNOWN vote path:** `reconcileUnknown` keeps frozen idempotency key + request body + actor/CSRF/venue/expectedVersion until `/me` own-read proves the requested upsert/withdraw effect (value/withdrawn + version advance). Unchanged or mismatching/higher non-proving revision leaves UNKNOWN; only explicit same-key retry under exact authorized context; no automatic POST / fresh key; star changes do not alter retry body; no «saved» before confirmed; network/503 stay UNKNOWN; terminal 409 → consistent conflict. Withdraw UNKNOWN equally safe. Mounted regression: unknown → own-read old → same-key retry → one successful resolve.
2. **F2 hook generation:** `useVenueCommunitySummaries` separates subscription/entity lifetime from request generation so consecutive invalidations keep refreshing; stale earlier responses cannot undo later; unsubscribe cleanup; stable ID set / no loops; public-only ≤200 batch preserved.
3. **F3 GameVenueContacts:** always mounts real compact public avg/count/empty/loading/error/unavailable + `#ratings` transition via shared `useVenueCommunitySummaries` + real `VenueCommunityRating` leaf; contact list omitted when empty/legacy/null; phone/URL scanners unchanged; never `/me` from compact. Contact-authority fixture mocks leaf only; new mounted context test uses real leaf/hook.
4. **F4 CreateGamePage:** after picker closes, selected venue shows coherent compact public summary on the same public batch path (selected ID only); A→B / clear / picker-open hide / error covered by `create-game-venue-community.test.tsx`.

### Explicit NOTDONE / NOT claimed

- Whole I1 **NOT READY** / SOURCE pending independent QA → CI → DEV.58; factual current remains **actual DEV.57 / API.39**
- Mode B binding / AGY author — not claimed
- I2 photos / I3 candidate — deferred
- PROD / merge / push / deploy / C5 — not performed
- source1/source7 UNKNOWN + costs retained; no receipt reset; no fake 58 ACCEPTED

## Checks this author pass

- Mounted RTL contexts + create selected-venue + report + venue-community unit + contacts + sheet integration: PASS (141)
- Web typecheck / eslint on affected sources: run in author pass
- No Git / push / deploy / live API writes / fake session claim
- Full Product CI deferred until independent delta QA PASS

## Preserve

- PR521 training card + historical alpha.57; MOD506 policies; backend/Admin bytes untouched this pass
- source15 reports affordances; unchanged full backend/Admin QA proof reused
- Historical admissions; attempts 1–17 history; UNKNOWN costs; original receipts retained
