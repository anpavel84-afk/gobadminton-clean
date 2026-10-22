# #171 · Venue popup mobile UAT — manual Owner-authorized UI pass

Status: **READY_FOR_INDEPENDENT_QA — NOT DEV ACCEPTED**
From: Owner-authorized Advisor manual implementation (not Actions train)
To: independent UI QA / DEV integrator
Date: 2026-10-22
Owner request: #171, follow-up to #156
Exact source base: `865d02c7ea39ae8210172629c3cb8e20c8fa52a8` (branch fork from dev)
Target: `dev` only; PROD, VPN and PLAN not affected.

## Owner-observed defects and expected result
User inspected embedded **Create game** in the VenuePopup on an iPhone. Form scrolled sideways/clipped left, title/close scrolled out of view, selected dark chips had unreadable dark text, form primary action disappeared far below the fold. The venue schedule cards displayed a narrow, vertically stretched court photo. Owner explicitly approved square left photo (~96–104px), time/title/levels to the right, with avatar/name and free seats in a bottom row.

## Bounded implementation
- `apps/web/src/components/consumer/games/VenueSheet.tsx`: independent square-cover/summary row plus organizer and seats footer, preserving one clickable row, GameCover/Avatar source fallback, accessible organizer label. Adds a view-state marker to distinguish the overlay-info close treatment from the expanded create/schedule header.
- `apps/web/src/styles/venue-popup.css`: explicit square media dimensions; remove blanket dark `button` color that defeated pressed-chip text; scope pressed-state contrast to embedded create; bound widths of real form fields/grid; wrap in-popup chips; sticky header and form actions relative to the **popup's** scrollport, not the viewport, with safe-area; sticky embedded preview action bar.
- `apps/web/src/components/consumer/pages/CreateGamePage.tsx`: share the existing publish buttons between standalone and embedded variants, moving **only** embedded publish buttons to a bottom-of-preview sticky action surface. No mutation/auth/photo/recovery semantics changed; `/games/create` keeps its established structure.
- `apps/web/test/venue-popup-owner-fixes.test.tsx`: real React SSR structure tests for square-row hierarchy and one publish action surface per variant. Existing tests and assertions retained.

No API, DB, contracts, secrets, workflow, dependency, scheduler, or task budget changes. No extra model author was started. The existing train is not paused or altered.

## Style Guide parity
Reuses canonical **BottomSheet / Drawer**, **FormGroup + StickyActionBar**, **GameCard/ListRow media**, **Avatar**, and approved CloseButton families from `docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md`. The Owner selected the compact row arrangement directly for this screen. This is a bounded screen composition, not a new global component family or an assertion that the frozen design was independently rendered.

## Acceptance still required
1. Mandatory Product CI: web TypeScript, lint and all relevant unit/UI tests, including current popup/venue map continuity and source tests.
2. **Independent** behavioral/visual QA on the exact final commit, including 390/430px iPhone/Safari or equivalent; confirm scrollWidth <= clientWidth for full form, keyboard and input focus, date and venue pickers, selected and disabled contrast, fixed X/back/actions while scrolling, safe-area, long game title and names, uploaded/fallback media, no action-layer overlay of the last field.
3. Verify standalone `/games/create` unaffected. Auth/CSRF, photo preview/publish/recovery and map position/return semantics unchanged.
4. DEV promotion only through existing checked pipeline and server ACCEPTED receipt/live SHA match. Until all evidence exists **do not mark DONE, visual PASS or DEV ACCEPTED**.

The self-authored markup assertions are NOT independent QA and cannot establish visual layout. No browser verification is claimed in this handoff.

## Rollback
Revert the exact UI PR/commit from `dev`, then release through normal DEV rollback/CI rules; no data migration or operational state rollback. Original #156 3/3 attempt and recovery acceptance histories remain untouched.

## Next bounded action
Review/test this branch, correct any demonstrated defects without broad new model review, then merge and release only after independent QA + CI pass. Report exact links and the rendering evidence to Owner.
