# GoBadminton CLEAN · UAT #179 · iPhone compact swipe continuity repair (v2)

Status: **OWNER UAT FAIL (original PR #180), v2 CODE READY FOR CI, NOT ACCEPTED**  
Date: 2026-10-22  
From: Owner-authorized manual frontend integrator  
To: Product CI / existing DEV pipeline / Owner iPhone UAT  
Exact base commit: `705db4860f3378253fe33652569ecd4664294de1`  
Issue: https://github.com/anpavel84-afk/gobadminton-clean/issues/179  
Rejected release: `r39734797666-a1` (was technically DEV ACCEPTED, **NOT** Owner visual accepted)

## Confirmed Owner observation
When touching the compact venue preview anywhere outside its handle and swiping upward on iPhone, the card twitches slightly and returns to place. Only the small gray handle opens the full popup. The originally reported issue is **not fixed**; do not close Issue #179.

## Source-level diagnosis
`VenuePopup.tsx` used `visible = expanded || moving || settling` and rendered the compact card inside `<div hidden={visible}>{preview}</div>`. On the **first** recognized upward pointer move it set `moving = true`, converting that wrapper to native `display:none` while the finger was still on the preview button. Safari may then cancel the gesture's pointer stream. The earlier synthetic hook tests invoked event handlers directly and did not reproduce DOM disappearance or WebKit pointer cancellation.

## V2 patch (narrow scope)
- Keep the original compact preview button **mounted** inside a stable absolutely positioned surface at `top:44px`, `height:128px` (original geometry unchanged).
- While dragging, use `opacity:0` only to reveal expanded content, **not** the `hidden` attribute / `display:none`; keep the captured root/active target pointer-addressable until pointerup.
- Apply `touch-action:none` to the compact preview wrapper only to stop iPhone native panning stealing the vertical gesture. Expanded popup retains the old gesture and content scrolling.
- Add source-level regression asserting pointer target is still present (not hidden) throughout multiple moves, pointer capture remains active, subsequent move grows the sheet, pointerup opens it.
- Existing compact handle, tap, keyboard, downward dismiss, expanded scroll, close/back, internal forms, map and other game UI remain unchanged.

## Verification and next action
1. Mandatory Product CI and relevant venue popup tests must pass.
2. Existing GitHub Actions DEV release only, with normal smoke/rollback and exact live SHA confirmation. Never touch PROD, PLAN, VPN or train.
3. Per Owner's explicit instruction, **do not launch a browser on VPS**. Owner will retest swipe on the existing https://dev.gobadminton.ru on a real iPhone.
4. Technical DEV acceptance does NOT equal Owner UAT approval. Keep issue open until Owner explicitly accepts the new behavior.
5. If the iPhone still cancels, capture an actual browser pointer trace or use a touch-specific handler after explicit Owner direction; do not declare success on synthetic tests alone.

Rollback: revert only this tiny V2 UI PR via normal DEV pipeline. No API/DB/scheduler modifications.
