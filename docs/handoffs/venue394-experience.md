# Handoff · #394 venue experience · attempt 36

## Candidate

Bounded SolMedium P1 correction on same #394 public venue feature (attempt 36). Base `e9ed23a1`. No redesign / no gate changes.

### Fixes

1. **VENUE-394-01** — Public list/count and own `publicVisible` select the latest immutable `lifecycle=published` revision with `not_before <= now` (history), so approving B before its 48h delay no longer hides previously visible A. `approved_revision_id` may still point at B.
2. **VENUE-394-02** — Private `self_draft` over an already `published` / `revision_waiting` slot with an approved tip keeps `revision_waiting` (same fence as public pending edit), so A stays publicly listed.
3. **VENUE-394-03** — Admin `decide` approve (and submit-bound correction/remove/restore) rejects `exactRevisionId` that is not current `pending_revision_id` (`REVISION_NOT_CURRENT`); `applyApprove` enforces the same. Linked Case/history retained; no side-effect on reject.

### Disposable regressions

- `venue-reviews.disposable.test.ts`: early approve delay keeps A; private draft after pending B keeps A.
- `admin-venue-reviews.disposable.test.ts`: stale Case approve after replace fails without published twin / decision row.
- Unit: `isPubliclyVisible` under `revision_waiting` with past vs future not_before.

## Metadata retained

- alpha.28 / API 0.34.0; alpha.27 seed ACCEPTED facts unchanged
- CURRENT `source_sha` null until trusted freeze
- No DEV/UAT/PROD claims by author

## Not claimed / Root remaining

- Live disposable DB execution by author
- Independent QA / Product CI / DEV smoke / Owner UAT
- Exact release SHA/receipt freeze

## Checks run by author

- Targeted unit policy file; Root runs disposable DB + independent QA
