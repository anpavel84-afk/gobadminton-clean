# Issue #37 — retained hidden venue cover deletion correction

From: source author. To: trusted publisher → independent SOURCE QA.
Date: 2026-10-15. Status: READY_FOR_REVIEW / UNVERIFIED.
Exact base and prior reviewed SHA: `e92c966ee7df4b1dfe214d7356b857b1abc5f527`, branch `automation/issue-37`, initially clean.
Base permalink: https://github.com/anpavel84-afk/gobadminton-clean/tree/e92c966ee7df4b1dfe214d7356b857b1abc5f527 .

## Assignment and finding

Bounded correction under the caller's immutable source-only task preserved in `ISSUE_37_TASK.json`; prior independent QA verdict FAIL: VenueCoverEditor disabled delete when uploadedUrl was null, including a retained cover hidden by moderation reject/review. No additional slice, map, RBAC architecture, release or acceptance authority.

## Source changes

- `apps/api/src/venues/venue-cover.service.ts`: scoped locked venue read obtains `cover_key IS NOT NULL` as retained presence, after the existing venue.manage/current-active-owner checks. Protected GET/access returns `hasCover`; new mutation receipts return committed presence. Public URL remains exclusively determined by venue_cover_url. Public DTOs/media authorization and all mutation/replay authorization remain unchanged.
- `packages/contracts/src/venue-cover.ts` and `packages/contracts/openapi.json`: protected receipt/access contract adds boolean `hasCover`, independent of public visibility. No storage key or moderation detail is disclosed. No migration required.
- `apps/web/src/components/consumer/venues/VenueCoverEditor.tsx`: existing delete button uses hasCover, retaining busy/preparation/uncertain fences. Receipt and refresh update presence through the existing state flow.
- `apps/api/test/integration/venue-cover.test.ts`: authored reject/review parameterized regression for retained presence, hidden public bytes, foreign/support delete denial, owner delete, cleared binding, updated version and absent presence after refresh. Public DTO does not expose hasCover.
- `apps/web/test/venue-cover.browser.mjs`: mock models presence separately; after replacement, moderation hides the URL, page reloads to default, delete remains enabled, successful delete disables it. Existing responsive widths remain. This is synthetic UI coverage, not actual authorization evidence.
- `apps/web/test/venue-cover.test.tsx`: access fixture conforms to updated protected contract.

Compatibility: additive protected response field only; older clients ignore it. Retained pre-update idempotency receipts may lack hasCover until an authoritative GET refresh; no replay payload/history is rewritten. Existing CAS, audit, cache, GC and approved public derivative logic is reused.

## STYLE_GUIDE_PARITY

Binding reference: docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md; published frozen guide https://nougat-wise-76949869.figma.site/#guide and #construction-kit . Prior screen provenance and bounded gap: `ISSUE_37_VENUE_COVER_SOURCE.md`, STYLE_GUIDE_PARITY / gap #37-venue-media-management. This correction changes only the existing Button disabled condition; no styling, geometry, composition, navigation or media slot changes. No new STYLE_GUIDE_GAP or OWNER_VISUAL_OVERRIDE. The linked operations style-guide file is absent in this checkout. Visual parity remains NOT_TESTED.

## Evidence and limits

Source edits are facts; runtime correctness is UNVERIFIED. Per caller's explicit no-self-QA restriction, no tests, browser, typecheck, lint, build, static validation, migration, disposable DB or deployment were run. No PASS or acceptance claim. Prior QA FAIL is historical evidence, not superseded by author approval.

Independent QA must run the added API/browser regressions and existing contract/Web/API/game projection tests against the published exact candidate SHA. Full hosted Product CI, synthetic DEV UAT (including Games list/detail with exact venueId after replace/delete/hide), backup/rollback, paired image digests and root-owned ACCEPTED state all remain NOT_TESTED by this author. Existing original handoff describes the broader unchanged slice.

## Rollback / continuity

Revert only this correction's source diff; no SQL or data rollback is required. Returning to the base restores the known hidden-cover deletion UI defect. No Git metadata, commit, push, automation, secrets, services, live data, deployment or PROD changes were made.

Next bounded action: trusted publisher publishes this source diff and handoff through the authorized workflow, attaches candidate SHA and exact GitHub artifact permalinks, then independent SOURCE QA evaluates that SHA. Author publication is prohibited by the current assignment, so no candidate SHA or durable GitHub publication is fabricated here.
