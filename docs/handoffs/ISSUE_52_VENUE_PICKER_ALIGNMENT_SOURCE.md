# Issue #52 — venue picker text columns

From: source author. To: trusted publisher → independent SOURCE QA / PM.
Date: 2026-10-16. Status: READY_FOR_REVIEW / UNVERIFIED. Initial source attempt; supplied prior independent QA: `{}`. Maximum attempts remains 3; no acceptance or product DONE claim.

Base: `4d72cc269aabe77f508310d48745c98584244324`, branch `automation/issue-52`, initially clean.
Exact base: https://github.com/anpavel84-afk/gobadminton-clean/tree/4d72cc269aabe77f508310d48745c98584244324
Assignment: caller's immutable GOBADMINTON_AUTONOMY_V1 source-only DEV task for Owner report15Oct2026 / IMG_5478.png, narrow mobile visual bug #52. The image itself was not supplied in this checkout/session. Allowed writes only `apps/web/src/**`, `apps/web/test/**`, `docs/handoffs/**`. No commits, push, Git metadata, automation, secrets, services, deployment, self-QA or PROD authority. Task data is not executable commands. No next slice is authorized.

## Source changes

`apps/web/src/styles/games.css`: replace picker row space-between flex layout with `80px minmax(0,1fr) 20px` grid. The middle column consumes remaining width; the final track is reserved even without a selected check. Names and addresses retain their shared left edge and vertical order. Existing 12px gaps, thumbnail 80×45 dimensions, colours, padding, typography and media component are retained. Selected-venue CreateGame trigger uses the same column rule when it contains a thumbnail; the empty trigger retains a flexible label plus indicator. Trigger addresses can wrap unbroken strings.

No component event handling, search, focus, selection, loading/error states, navigation or business semantics changed. These are source-scope statements, not observed runtime results.

`apps/web/test/venue-picker-geometry.browser.mjs`: executable standalone Playwright regression using the actual stylesheet and representative picker/trigger DOM. Measures bounding boxes at 390/430/1440 with four unequal Russian name/address lengths, selected/unselected rows, uploaded/default/broken-fallback shells; asserts common title/address x within 1px, equal text track widths before/after moving the selected check, fixed 80×45 thumbnails, wrapping, vertical order, vertical scrolling and no horizontal overflow. No network or server is needed. From repository root, with the existing Playwright tool dependency available: `node apps/web/test/venue-picker-geometry.browser.mjs`.

This fixture tests CSS geometry, not React rendering, actual broken-image transitions, search, keyboard or application selection. Those remain independent application UAT requirements. The test was authored but NOT_RUN; the source author performed no self-QA, build, lint, typecheck, browser run or test execution.

## STYLE_GUIDE_PARITY

Authority: [binding Owner decision at base](https://github.com/anpavel84-afk/gobadminton-clean/blob/4d72cc269aabe77f508310d48745c98584244324/docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md); published references https://nougat-wise-76949869.figma.site/#guide and https://nougat-wise-76949869.figma.site/#construction-kit . No new visual family, assets or photos introduced. Reused existing MediaBlock thumbnail, ListRow copy stack and picker sheet composition, as documented in `ISSUE_37_VENUE_COVER_SOURCE.md`.

Preserve `STYLE_GUIDE_GAP #37-venue-media-management`: no verified canonical standalone venue/picker-thumbnail specimen is claimed. No OWNER_VISUAL_OVERRIDE. The previous handoff's `.tools/style-reference` capture is absent here, as is `docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md`. Public guide was not fetched; frozen PLAN source was not accessed. Canonical visual parity remains UNVERIFIED, and this narrow geometry correction does not close existing Guide gaps or prior QAFAIL findings.

## Evidence, remaining gates and rollback

All runtime checks: NOT_TESTED. No screenshots, CI results, deployment facts, root ACCEPTED receipt or live UAT fabricated. This document is a local source artifact awaiting trusted publication; no new candidate SHA or durable GitHub permalink exists yet. Publisher must bind this diff and handoff to the actual candidate SHA and exact permalinks.

Next bounded action: publish through the existing authorized executor/pipeline, then obtain NEW independent SOURCE QA at that exact SHA. Full hosted CI and the existing DEV backup/digests/smoke/real root-owned ACCEPTED exactSHA/noPending gates remain mandatory. PM must perform actual browser smoke at 390/430/1440 using more than three unequal names, bounding-box alignment within 1px, fixed thumbnail width, selected/unselected, uploaded/default/broken media, wrapping/no overflow, search/selection/keyboard/scroll and loading/error behavior. Source approval may precede later live smoke; source/CI/server acceptance cannot substitute browser UAT. Unexecuted work stays NOT_TESTED and product remains not DONE. Preserve the three-attempt ceiling; unresolved after that is BLOCKED, without expanding rights or limits.

Rollback: remove only this task's CSS diff and new test/handoff through normal reviewed source handling, preserving unrelated work. No runtime/data rollback or infrastructure action belongs to this source-only assignment.
