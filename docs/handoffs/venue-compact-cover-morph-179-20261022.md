# Owner UAT #179 · Compact venue cover follows upward swipe (visual correction)

**Status:** SOURCE READY FOR PRODUCT CI — not yet DEV accepted or Owner UAT accepted  
**Date:** 2026-10-22  
**From:** Owner-authorized manual UI work  
**To:** GitHub Product CI / ordinary DEV release / Owner iPhone UAT  
**Canonical repo:** anpavel84-afk/gobadminton-clean  
**Exact base:** `9f1fa97426f13b77748614b825125d17227cb70f` (`dev` at branch creation)  
**Issue:** https://github.com/anpavel84-afk/gobadminton-clean/issues/179

## Owner confirmation and new defect
Owner tested on real iPhone on DEV: full-card swipe up/down and single-tap Close (X) now behave correctly. The remaining visual defect is **immediate full-sized photo on initial drag**, including DOWN swipes, producing a jarring image jump. Owner requests the image scale up *during* sheet expansion rather than on initial touch.

## Exact source reason
`VenuePopup.tsx`: `visible = expanded || moving || settling` mounted the expanded `VenueSheet` as soon as the first 8px upward gesture set `moving = true`. The venue resource `SelectedVenueCover` intentionally owns **one** image which automatically moves from `slots.compact` to `slots.info` when the latter mounts. Thus large photo immediately replaced compact thumbnail, even though the shell had barely moved. The screenshot also captured the big image sticking out in a compact/partially collapsed panel.

## Bounded correction
- Keep the real selected image in its **compact** DOM slot for the whole upward drag and its 220ms snap animation. The full `VenueSheet` only mounts after the compact-origin animation completes, at which point `SelectedVenueCover` transfers the **same image**, with no duplicate image/network request.
- Interpolate compact photo width, height and top offset **in pixels based on actual sheet travel**, from 64×64 thumbnail to responsive 16:9 info-cover geometry. Fade compact title/address/arrow progressively. CSS transitions of width/height/top/opacity follow the established 220ms snap curve.
- A downward swipe from the compact state leaves the small 64×64 photo and compact text in place, and does not mount the expanded image. Swipe-down to dismiss remains identical.
- Original handle capture, full-card pointer capture, click suppression/first-tap Close, expanded sheet scrolling/forms and regular map state are **unchanged**.
- Reduced-motion user preference retains immediate transition and skips the size tween.
- Three changed files only: `VenuePopup.tsx`, `venue-popup.css`, `venue-sheet.test.tsx`.

## Evidence and limits
- New/updated source tests verify: upward gesture's image grows proportionally (not 100% on first touch); expanded VenueSheet not mounted mid-touch; full handoff only after settle; compact DOWN gesture never grows photo; preexisting handle, focus/Close tests retained.
- Full Product CI (web TS/lint/tests and other required gates) **PENDING**.
- Real mobile visual animation is **NOT YET TESTED**: Owner will manually check on actual iPhone after exact DEV release. No VPS browser or parallel test site requested.
- No API, DB, asset pipeline, auth, queue, model train, PROD, PLAN, VPN or independent game card changes.
- Rollback: revert this narrow UI PR through existing DEV pipeline. Existing accepted release and the unaccepted #179 visual history remain durable.

## Mandatory next step
1. Wait for all normal Product CI jobs PASS. Do not bypass unrelated DB gates.
2. Merge this PR if clean and release via existing DEV Actions checks/images/deploy with server receipt **ACCEPTED** and live SHA match.
3. Owner confirms compact DOWN swipe stays small, UP swipe smoothly grows photo and lands exactly in opened popup, X closes with first tap, other expanded behavior unchanged. Keep #179 open until acceptance.
