# Issue #445 point 1 — Level range overlap pointer + dependent ARIA (A-01 / A-02)

From: Cursor Auto (`OWNER_STANDING_VISUAL_QA_445_A_LEVEL_RANGE_REPAIR`, attempt 2, base `5870d26d1e87d9d94ae800b54c890571546ad0ba`).
To: PMA Chrome helper re-proof (mobile390 equal-thumb left drag + ARIA) → independent Codex Sol Medium QA → mandatory Product CI → trusted DEV → Go Bad retest.
Status: SOURCE CANDIDATE only. **UAT = NOT_TESTED**. Do **not** close #445. Points 2–6 out of scope. PROD forbidden. No fake PASS.

## Retained first browser FAIL (product verdict input — not erased)

PMA actual component+React+CSS Chromium receipt (`visual445-component-browser-pass1/receipt.json`, status **FAIL**):

1. **A-01** `equal_maximum_thumbs_cannot_separate_lower_with_left_drag` @390: after keyboard both=7 and blur, touch shared thumb near left and drag left ~60px → both stayed 7. Upper painted above always captured pointer; `data-active-bound` z-index only after focus did not help ordinary touch.
2. **A-02** `logical_aria_range_not_updated_with_other_thumb` @390 and @1440: `aria-valuemin`/`aria-valuemax` stayed global 1..7 despite clamp against the other thumb.

Non-overlap native touch and keyboard paths in that receipt worked. WAI multi-thumb summary (input material): each thumb exposes limits it can actually select; native DOM min/max may stay global for visual coordinates.

Author pass1 `preqa-browser-findings.json` matches the same A-01/A-02. Fixture-build / harness errors are **not** a product verdict; the Chromium semanticFailures above are.

## Repair (this attempt — allowed paths only)

1. `GameLevelRange.tsx` — control-level pointer hit-testing + `setPointerCapture`; overlapped/equal thumbs resolve by left-of-center or drag direction (lower← / upper→) without prior keyboard focus; touch waits for horizontal intent so `touch-action: pan-y` can scroll; pointercancel / lostcapture / disabled / unmount cleanup; native keyboard inputs unchanged (two focusable ranges, no hidden manual values).
2. `game-level-range.ts` — `resolveNtrpLevelPointerBound`, `ntrpLevelValueFromTrackClientX`, `ntrpLevelAriaValueMin` / `Max`; existing clamp / inclusive payload / global visual % helpers retained.
3. `games.css` — thumbs paint-only (`pointer-events: none`); control owns pointer; `touch-action: pan-y`; active z-index retained for keyboard focus painting.
4. Tests — global visual DOM min/max 1..7 checked separately from dependent ARIA; overlapped equal-max pointer harness moves lower left; create-form wire reuse.

ARIA now: lower `aria-valuemin=1` / `aria-valuemax=CURRENT_UPPER`; upper `aria-valuemin=CURRENT_LOWER` / `aria-valuemax=7`. Native `min`/`max` stay 1..7.

## Author checks (not independent QA)

- `vitest` `test/game-level-range.test.tsx` + `test/create-game-venue-cta.test.tsx` — pass.
- Scoped `tsc --noEmit` + eslint on touched web files — pass.
- Author pointer harness exercises equal-max left drag → lower decreases; **not** a substitute for PMA Chrome native touch proof.
- Fixed native Touch / ARIA still **pending** PMA Chrome helper + independent QA + CI + DEV + Go Bad. No READY/ACTIVE claim.

## Non-goals

- #445 points 2–6 untouched; issue stays open.
- No Git / AGENTS / runtime / PROD / API / schema / release edits.
- No new gesture library or broad redesign.
- Standing AGENTS already in source — not edited by author.
