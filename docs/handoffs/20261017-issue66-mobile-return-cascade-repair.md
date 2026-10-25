# Issue 66 — mobile return visibility correction

From: source author. To: existing executor / independent QA.
Date: 2026-10-17. Status: WORKING_DRAFT — NOT ACCEPTED — NOT_TESTED.
Base: `fdab39e4aa9555951ffff5bc23420619d0086ebb`, branch `automation/issue-66`.
Base permalink: https://github.com/anpavel84-afk/gobadminton-clean/tree/fdab39e4aa9555951ffff5bc23420619d0086ebb
Initial working tree clean. Scope is the supplied immutable issue-66 source-only
assignment and its prior independent QA finding. No extra slice or delegation.

## Preserved FAIL and correction

Independent QA of the base reported FAIL: foundation's `.gb-consumer .gb-c23-btn`
overrides the mobile `.gb-games-list-return` display rule. At 390px the redundant
return button wraps with activity chips into a separate row despite the bottom
List action, retaining an unnecessary 44px row and failing the retained 40% canvas
height requirement with the necessary missing-coordinate fallback.

The mobile selector now scopes through consumer/map context and its direct return
button, outranking foundation without `!important`. This removes the duplicate
button from mobile layout and keyboard focus while preserving desktop return and
the approved mobile List action. No fallback or venue removed. No canvas height,
overflow masking, fixed allocation or tolerance change introduced.

Prepared regression adds explicit inline-return and mobile-List visibility checks
at every existing resized viewport, including 390x600 and rotation. Existing 40%
minimum, exact measured canvas/control/fallback budget, overflow and settlement
assertions remain. Tests were edited, not executed.

Original public DEV FAIL and supplied measurements remain in
[the initial handoff](20261017-issue66-map-layout-source.md): at 390x600 canvas
323.5..424.25 (100.75px), frame 255..464; at 390x1000 frame 255..864 and canvas
323.5..824.25; at 900x390 canvas 263..368.125 (105.125px).
These are historical operator evidence, not measurements of this correction.
Private evidence roots are references only; no private files accessed.

## STYLE_GUIDE_PARITY

Read binding frontend Style Guide decision, local consumer tokens/foundation and
the initial issue-66 parity record. Frozen authority remains
https://nougat-wise-76949869.figma.site/#guide and #construction-kit.
Reuse existing Button, activity chips, compact controls and approved above-nav
view action; preserve LIST hero/create and map marker composition. This correction
implements the intended existing mobile visibility, with no new visual pattern.
The initial compact recipe STYLE_GUIDE_GAP and pending independent parity remain.
The referenced operational style-guide document is absent locally; external frozen
source was not fetched. No OWNER_VISUAL_OVERRIDE claimed.

## Checks, limits and next action

No self-QA, tests, browser, syntax, lint, build, CI or public UAT run, per explicit
source-author restriction. New geometry/screenshots: NOT_TESTED / NOT_AVAILABLE.
Prior QA's source syntax/whitespace/foundation checks apply only to the base;
dependency/browser tests were unavailable there. No PASS or acceptance claimed.

Next bounded action: independent exact-candidate source QA and 390x600 browser
measurement with necessary missing-coordinate fallback, then existing viewport/
rotation matrix and seven-job CI. Preserve original logs and obtain paired exact
SHA screenshots, genuine tiles/idle and ordinary interaction evidence as specified
in the initial handoff. Deployment/backup/rollback/public-UAT gates remain pending
with the authorized operator. No counters or immutable assignments changed.

Only discovery.css, games-map-layout.browser.mjs and this handoff changed. Rollback
is the inverse patch to these edits. No commit, push, git metadata, automation,
runtime/control file, secret, service, dependency or PROD changes. Publication is
outside this authorization: publisher must provide candidate SHA and durable
GitHub permalink; this local draft does not claim publication.
