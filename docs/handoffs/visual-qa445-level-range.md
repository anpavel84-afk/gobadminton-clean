# Issue #445 point 1 — Create game level range common-track repair

From: Cursor Auto (`OWNER_STANDING_VISUAL_QA_445_A_LEVEL_RANGE_REPAIR`, attempt 1, base `84cedf79ec6d0582ef1197589acd808f9470f62c`).
To: PMA Chrome proof (mobile+desktop) → independent Codex Sol Medium QA → mandatory Product CI → trusted DEV ACCEPTED → Go Bad retest.
Status: SOURCE CANDIDATE only. **UAT = NOT_TESTED**. Source PASS ≠ visual UAT. Do **not** close #445. Points 2–6 out of scope. PG3 parked separately (do not claim installed). PROD forbidden.

## Defect (verbatim Go Bad / source PR #433, canonical #432)

**Create game level range (#433)**: two separate sliders («От»/«До») instead of one two-handle slider. «До» thumb position wrong/inverted: at До=3.5 (max) thumb sits ~13% of track; when От moves to 3.5, До thumb goes to 0%.

- Route: existing create-game form.
- Expected: one shared visual track / two bounds; stable thumb positions; usable mobile/desktop.
- Actual (before): two tracks with changing min/max → incompatible coordinates.
- PMA: global NTRP v1 range 1..7 step 0.5; 3.5 is default upper, not max 7. Do not change global level scale / API payload to fit the report wording.

## Design inputs (acknowledged)

- Owner-approved design URL: `https://files.anpavel.ru/projects/gobadminton/design/style-guide/sitewide/20261029-owner-v3/index.html#create/form/desktop` and `#create/form/mobile`
- Local verified PNGs (capture-receipt **PASS**):
  - `create-approved-v3-desktop.png`
  - `create-approved-v3-mobile.png`
- Static mock shows text field `3.0, 3.5`; Owner report explicitly requires one common track + two handles. No new Astra/design round/UI library.

## Repair (scoped)

1. `GameLevelRange.tsx` — both native ranges keep `min=1` `max=7`; stacked on one `.gb-game-level-range__control` with rail + selected fill; separate labels/focus/aria; active-bound z-index so overlapping equal thumbs stay reachable; disabled preserved.
2. `game-level-range.ts` — `ntrpLevelVisualPercent` / `ntrpLevelSelectedFillStyle`; existing clamp helpers unchanged (`min<=max`, inclusive ids, defaults 3.0..3.5).
3. `games.css` — styles scoped under `.gb-game-level-range` only.
4. Tests — common-track contract, shared coordinates, two accessible handles, Home/End extremes, equal-thumb, disabled; create-form wire reuse.
5. Releases — prospective app `0.1.0-alpha.6` (API `0.22.0` unchanged); alpha.4 + dual alpha.5 (06991 SMTP + 84ced worker) seeded; alpha.6 SHA/date unbound until DEV receipt.
6. `SITEWIDE_UI_STYLE_GUIDE.md` + `CHANGELOG.md` + this handoff.

## Checks (author)

- Affected web unit tests / typecheck / lint — see evidence run.
- Independent Sol Medium QA + Product CI + DEV ACCEPTED + Go Bad browser retest — outstanding trusted process.
- Author self-check ≠ independent QA.

## Remaining / non-goals

- #445 points 2–6 not fixed; issue stays open.
- No modelRoot / Git / AGENTS / runtime / PROD / auth / sessions / API / schema changes.
- No PG3/4/comments DONE claim; no mass cleanup; no new framework.
- Owner UAT after DEV: NOT_TESTED until Go Bad browser PASS.
