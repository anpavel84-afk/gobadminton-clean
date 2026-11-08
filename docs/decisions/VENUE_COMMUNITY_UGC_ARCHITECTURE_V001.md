# Venue community UGC architecture — repository copy (#507 I1)

**Original authorship:** Astra High design + architecture S v1 (2026-11-07), Owner Issue #507 / addendum 6708483107.
**Current reconciliation:** Cursor Auto source writer, Mode A admission OWNER507_I1 on accepted DEV base `524088767e2b7e77d569c2f0a47689db854ab7b0` (alpha.56 / API 0.39 / schema 67). This file is a bounded repository copy of accepted architecture for implementers — not a new independent task registry.

## Scope of this copy

- **I1 (this delivery):** independent community numeric ratings (1–5) + open moderated public venue text discussion; coherent summary UI on venue surfaces.
- **I2 / I3:** photo attachments / community gallery / creator official-photo candidate remain **NEXT**. Do not present working photo upload until I2.

## Binding inputs (hashed at admission)

| Material | SHA256 |
| --- | --- |
| 507-approved-architecture.md | e36606544061503feda403c7f471e527ff201069574265858793b97eaa0c0107 |
| 507-approved-slices.json | f27414fc3556ef3f60899bc7b84ade9cb4349a23e702713cf6db2db499fc6335 |
| 507-approved-ui-readme.md | 1ed1926bb30f89abdbe8c15a5388c511e8deeaa31cb9810b2a5ff3198b793e05 |
| 507-loader-addendum.md | 2522b07aa97dc8a9e2e2fbf5790d75bcf06d2e032637a4f78632479513efc325 |
| trusted-alpha56-seed.json | 9426ae14883b22170fcd0bcbb360b836be9c61de912a85db7c0ad80d3809e847 |

## Integration points (reconciled to current tree)

| Concern | Existing symbol | I1 change |
| --- | --- | --- |
| Open venue discussion | `CommentsService` / optional-session venue routes | Remove empty-list + `COMMENT_VENUE_WRITES_CLOSED` for eligible canonical venues; guest read; registered create/reply/edit/delete own without attendance; reuse `comment_body` gate |
| Ratings | `VenuesService` + `venue-community.policy/query` | Current vote + immutable revisions; batch summaries max 200; own-vote `/me` no-store |
| Canonical identity | `effective-venue.query` | Votes/comments resolve aliases; merge reconciles votes under Admin exclusive catalog fence |
| Verified reviews | `/experience-reviews` | Unchanged attendance/consent/48h/Cases path |
| Official gallery | `VenueGalleryService` | Unchanged; UGC photos are I2 |

## Aggregate eligibility (query-time)

Eligible vote: current unsuperseded row, value 1–5, not withdrawn, moderation `clear`, author active without effective `account.access` / `profile.public` restriction, venue terminal `unverified|verified`. Directory opt-out does not withdraw. Average = server-rounded `sum/count` one decimal; empty `average:null,count:0`; unavailable `average:null,count:null`.

## Merge tie-break (architecture choice)

Per user, latest explicit accepted user action among source/target wins (timestamp, then row id). Withdrawal participates. Any current withholding from either row is retained until authorized restore. No duplicate counting; no brand-wide branch mixing.

## Honest intermediate status

Ratings and open text discussion are the I1 claim. Photo-only comments, bottom gallery/viewer, and creator official candidate remain I2/I3. Owner/GoBad UAT and live privileged sessions remain NOT_TESTED until performed. CI/DEV PASS are not claimed from source alone.
