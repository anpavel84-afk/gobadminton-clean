# Handoff · #394 venue experience · attempt 34

## Candidate

End-to-end source for public venue experience on existing API/web/Admin/Cases.

- Migration `0058_venue_experience_reviews` (+ rollback)
- `VenueReviewsService` / controller; admin intake/decide; Cases hint `venueReview`
- Web VenuePage panel + composer (self_draft default, public consent/preview)
- OpenAPI **0.34.0**; releases current **alpha.28** (alpha.27 seed ACCEPTED facts retained; CURRENT `source_sha` null until trusted freeze)
- Shared predicate `game-experience.ts` reused from game-feedback

## Not claimed

- DEV ACCEPTED / smoke / Owner UAT / PROD
- Live disposable DB execution by author
- Wiring `venueId` into `GameFeedbackPanel` from `GameResultsComposition` (file outside allowed_paths — bounded follow-up)
- Full disposable integration bodies (harness placeholders; CI to expand)

## Remaining checks (trusted process)

1. Unit: `venue-reviews.policy.test.ts`, web venue-reviews tests, releases alpha.28, admin VenueReviewCases surface, admin protocol count 50
2. Independent QA (Codex Sol Medium)
3. Product CI + migration smoke includes `0058`
4. Disposable auth/CSRF/idempotency path + approve+48h guest projection
5. DEV release + version history freeze with exact SHA/receipt when Root provides facts
