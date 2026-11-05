# Handoff · #394 venue experience · attempt 35

## Candidate

Continuation of pass1 source on public venue experience (API/web/Admin/Cases).

### Policy corrections in this attempt

1. **Historical played-at** — additive `game_played_at_venue_attributions` (immutable). Written prospectively on `games.publish` and `outcome=held`. `loadAdmission` / eligibility never treat mutable `games.venue_id` as proof; missing row → `missing_history`. No historical backfill.
2. **14-day window** — `first_eligible_at` derived from max(ends_at, first held revision, first permitted present). Fence insert uses that stamp, not probe/`new Date()`. Window is **per-game** (not forever blocked by slot-level first game). Appeal pause + favorable resume `max(remaining,7d)` via mutable `venue_review_submit_windows`.
3. **Outcome dispute / publication / COI** — open role-proof `open_dispute` or open non-attendance/non-venue-review Cases on the game hold admission; reports do not hide published text; approve reaffirms eligibility; reviewer COI covers historic manager seats + venue-admin actors; author affiliation includes venue-admin proof.
4. **Composition** — `GameResultsComposition` wires `venueId={game?.venue?.id}` into `GameFeedbackPanel`.

### Disposable tests

`venue-reviews.disposable.test.ts` and `admin-venue-reviews.disposable.test.ts` now contain real auth/CSRF/idempotency/Admin WebAuthn paths (skipped unless `RUN_DB_INTEGRATION=1`). Pattern mirrors role-reputation disposables.

## Metadata retained

- alpha.28 / API 0.34.0; alpha.27 seed ACCEPTED facts unchanged
- CURRENT `source_sha` null until trusted freeze
- No DEV/UAT/PROD claims by author

## Not claimed / Root remaining

- Live disposable DB execution by author
- Independent QA / Product CI / DEV smoke / Owner UAT
- Exact release SHA/receipt freeze

## Checks run by author

- Targeted unit file edits; Root runs full tests + independent QA
