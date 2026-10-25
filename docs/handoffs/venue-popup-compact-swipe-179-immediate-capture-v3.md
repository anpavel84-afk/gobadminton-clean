# GoBadminton CLEAN · #179 iPhone compact preview gesture — v3

**Status:** SOURCE READY FOR CI — OWNER UAT NOT ACCEPTED  
**Date:** 2026-10-22  
**Owner observation:** The real iPhone still only expands via the small gray handle. V1 (#180, release r39734797666-a1) and V2 (#186, release r39739495842-a1) both failed Owner UAT. Issue #179 MUST remain OPEN.  
**Exact DEV base:** `645490379034a205eb43c941ea86c4ff6be90c76`.  
**Scope:** Owner-authorized narrow UI repair of compact `VenuePopup` only; original direct DEV authorization remains.  
**No new infrastructure / API / DB / workflows / train / PROD / PLAN / VPN.**

## Source-evidence comparison, not a verified iPhone root cause
The gray handle already works on iPhone because it calls `setPointerCapture` on **pointerdown** and has `touch-action:none`. The collapsed preview content did not do this: it waited until pointer movement exceeded 8px before capture. On iOS Safari, native gesture processing may cancel an uncaptured pointer stream before that. A second possible trigger is the window's `resize` listener, which previously reset every active gesture when iOS collapses/expands browser chrome. Both differences are visible in the source; neither was proven by an actual Safari event trace.

## V3 implementation
- On pointerdown **within the compact card**, capture the original preview button immediately, not the outer shell only after 8px. Preserve its native tap/click target. For non-button whitespace, capture the stable popup shell. The handle keeps its own unchanged code.
- Continue to determine vertical vs horizontal intent at 8px; horizontal gestures never expand or dismiss.
- Keep the preview DOM permanently mounted during drag (V2 fix). Apply compact-only `touch-action:none` to the actual button, not only an ancestor, and prevent unwanted text selection.
- Prevent a `window.resize` (iOS Safari dynamic viewport) from resetting a **compact active** swipe; expanded/handle interactions continue using the previous resize logic.
- No new behavior for expanded popup. Existing tap, keyboard, handle, down-dismiss, right/left mouse and map behavior preserved.

## Bounded touched files
`apps/web/src/components/consumer/games/VenuePopup.tsx`  
`apps/web/src/styles/venue-popup.css`  
`apps/web/test/venue-sheet.test.tsx` — tests for immediate capture, tap release, viewport resize during a two-move gesture, original V1/V2 regression, horizontal/cancel and expanded behavior.

## Evidence / next steps
1. Full Product CI including targeted web test, typecheck and lint — **PENDING**.
2. Merge only if CI SUCCESS, then use existing DEV Actions pipeline with normal rollback/receipts. Verify live exact SHA before reporting installed.
3. Per explicit Owner direction **NO VPS browser or separate test deployment**. Owner personally evaluates the released UI on real iPhone; do not assert mobile visual PASS based solely on source tests.
4. If V3 fails Owner UAT, obtain evidence of actual Safari `pointercancel` / `resize` / move sequence before another speculative implementation. No more blind changes.

Rollback: revert the narrow PR via existing DEV pipeline; no data changes, preserve all earlier #179 / #156 histories.
