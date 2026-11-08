# Handoff — #507 I1 F3 consumer venue_community report UI

**Author:** Cursor Auto
**Admission (attempt 15):** `OWNER507_I1_F3_CONSUMER_REPORT_UI_EXISTING_CASES`
**Base SHA (frozen admission):** `a24718e27f057f68ab00653adc8636364303b212` (WIP carry of fe238157 Admin onto actual DEV.57; source1/source7 UNKNOWN retained, no replay)
**Phase:** SOURCE partial — consumer report UI only (bounded 16 paths)
**Prior:** Admin Cases F3 QA14 PASS on fe238157; actual DEV.57 / API.39 / SHA 895e97fd PR525 ACCEPTED; backend contracts.40 / migration 0068 unpublished until future 58

## This attempt scope (SOURCE)

Allowed paths only (16):
- `apps/web/src/lib/venue-community-api.ts`
- `apps/web/src/lib/comments-types.ts` (unchanged this pass)
- `apps/web/src/components/consumer/venues/VenueCommunityRating.tsx`
- `apps/web/src/components/consumer/venues/VenueCommunityReportDialog.tsx` (new)
- `apps/web/src/components/consumer/venues/VenuePage.tsx`
- `apps/web/src/components/consumer/comments/CommentsSection.tsx`
- `apps/web/src/styles/venue-community.css`
- `apps/web/package.json` + `pnpm-lock.yaml` (exact Admin pins for DEV-only RTL/jsdom)
- `apps/web/test/venue-community-report.test.tsx` (new mounted)
- `apps/web/test/venue-community.test.tsx` / `venue-community-api.test.ts` / `comments*.tsx`
- `docs/handoffs/venue507-i1-community.md`
- `docs/decisions/CONTENT_MODERATION_V2_COVERAGE_V001.md`

### Implemented (attempt 15 — F3 consumer report UI)

1. Typed `venue-community-api` helper for `POST /v1/reports` `targetKind=venue_community` with exact subject kinds `aggregate` | `own_vote` | `venue_comment`, reason codes, receipt guard, and body builder — no new endpoint/provider; reuses `apiFetch` + CSRF + Idempotency-Key.
2. `VenueCommunityReportDialog` on existing ProfileDialog/CloseButton/Button: in-memory actorId+csrfToken bind (exact `===`, no hash), `useSocialMutation` UNKNOWN same key/payload, retry only same authorized context, close during in-flight ≠ cancel, double-submit guard, neutral success copy without auto-takedown/count change.
3. Full `VenueCommunityRating` aggregate report affordance; own-vote report for current non-withdrawn version (including withheld appeal); guest → AuthChooser. Labels distinguish community rating vs verified experience reviews.
4. `CommentsSection` venue-only comment/reply report with selected `commentId`+`version`; tombstones blocked; game comments unchanged (no venue_community / no player-report fallback).
5. Mounted RTL/jsdom tests for POST shapes, guest/auth, version selection, no auto-hide, failure/unknown same key, actor/CSRF change + late promise isolation. Web gains exact Admin `@testing-library/*` + `jsdom` pins (DEV-only).

### Explicit NOTDONE / NOT claimed

- Whole I1 **NOT READY** / SOURCE partial — no CI/DEV.58 claim; factual current remains **actual DEV.57 / API.39**
- F4 all venue contexts + F5 public canonical alias shared summary invalidation — next source 16
- I2 UGC photos / I3 creator candidate photos — later
- Release file / application version / PROD / C5 / backend / RBAC / API / scheduler — not edited
- Product CI; DEV release/smoke; Owner UAT (**NOT_TESTED**)
- Mode B binding / AGY author — not claimed
- source1/source7 UNKNOWN + costs retained; no receipt reset; no paid architecture reconfirmation

## Checks this author pass

- Targeted web typecheck/lint + new mounted report tests + existing venue-community/comments tests
- No Git / push / deploy / live API writes / fake authorized session claim

## Preserve

- PR521 training card + PR523 button alignment UI; media pipeline; verified VenueReviews/organizer/trainer/player feedback gates/48h/Cases
- Admin F3 Cases QA14 CSRF memory proof; backend report intake already QAed — Core bytes unchanged this pass
- Historical admissions; attempts 1–14 history
