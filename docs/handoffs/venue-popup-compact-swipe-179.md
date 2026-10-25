# Owner UAT #179 · Collapsed venue preview swipe area

Status: **SOURCE READY FOR CI · OWNER MOBILE VISUAL ACCEPTANCE PENDING**
Owner: direct iPhone UAT request on 2026-10-22.
From: manual Owner-authorized implementation.
To: independent review / GitHub Actions / DEV / Owner.
Issue: https://github.com/anpavel84-afk/gobadminton-clean/issues/179
Exact base: `47feaf78828b5984097bc54803350622b842ae6c` (`dev`).
Target: existing `https://dev.gobadminton.ru` only. No PROD, PLAN, VPN, train or other product changes.

## Intended UX
The compact venue card (~172px) must be fully draggable:
- Swipe **up from anywhere on the compact card** (photo/title/address/status/arrow/background) → live upward growth and expansion to existing full popup.
- Swipe **down from anywhere on the compact card**, including its gray handle → deselect venue/close the compact card through the already existing `onDeselect`.
- Normal tap still opens the same venue, with existing keyboard support. Horizontal scroll, misaligned swipes, secondary pointers, cancellation and synthesized clicks must not produce duplicate actions.
- **Expanded popup is OUT OF SCOPE**. Its ordinary form/list vertical scrolling, interactive controls, backdrop/close button, existing handle collapse and focus behavior are unchanged. No new global popup drag listeners when expanded.

## Bounded changes
- `VenuePopup.tsx`: existing handle drag remains. Adds a *compact-only* touch tracking state on the stable popup shell, with deferred pointer capture after 8px vertical intent detection. No capture on initial press, preserving click. Live height follows upward movement, with ~56px open threshold and 64px downward dismissal threshold; horizontal and cancelled gestures stop without selecting or deselecting. Full-screen content remains unmodified. Compact handle also dismisses on downward swipe.
- `venue-popup.css`: `touch-action: pan-x pinch-zoom` is scoped to compact state; expanded retains default touch scrolling. No layout or dimensions changed.
- `venue-sheet.test.tsx`: existing handle, map-stability and focus regression suite retained; tests added for full-surface upward drag, down-close, click, horizontal/cancel, capture cleanup and expanded-only isolation.

## Style Guide
Reuses existing BottomSheet and current compact preview arrow/handle behavior, extending only the compact hit zone. Owner explicitly chose this gesture change. No new design family or animation API.

## Verification and release
- Run existing Product CI including web typecheck/lint/all unit tests and current repo gates. Own focused tests do not substitute independent rendered acceptance.
- User explicitly directs that no browser/visual QA run on VPS and will test actual iPhone behavior on the existing DEV after deployment. Mark actual iPhone UAT **NOT_TESTED** until feedback.
- Merge through normal PR upon gates PASS and trigger the existing DEV deploy. Assert exact acceptance receipt and live SHA match before saying deployed.
- No source-test, budget, CI, PROD or workflow bypass.

## Rollback
Revert the narrow PR and issue a normal DEV release; no data/DB migrations, lock state or scheduler changes. Retain previous `#156/#171/#174` history and this exact document for handoff.
