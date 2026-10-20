# M3 UAT 1/2 — continuous venue popup and empty schedule CTA

- From: Codex, source author. To: GoBadminton integrator, then independent QA.
- Date: 2026-10-20. Status: READY_FOR_REVIEW; compiler/tests NOT_TESTED; no independent QA or Owner acceptance claimed.
- Exact base: `62c789975daa7e9a7effebb642c346f87891c476`, HEAD checkout on `automation/issue-133`. Initial tracked diff empty.
- Base: https://github.com/anpavel84-afk/gobadminton-clean/tree/62c789975daa7e9a7effebb642c346f87891c476
- Assignment: immutable source-only task for Issue #133, M3 UAT 1/2 after accepted #131. Offline author; only assigned paths. No commits, pushes, git metadata writes, dependencies, API/DB/contracts, workflows, services, deployment or PROD effects. This artifact records the assignment and implementation for publication by the integrator; no result permalink exists yet.

## Implementation and acceptance mapping

D1: `VenuePopup.tsx` is the persistent surface keyed by selected venue ID. `GamesMapView.tsx` keeps the existing map sibling and passes preview and sheet content into that surface. Pointer handlers live only on the popup handle. `VenuePreviewCard.tsx` and `VenueSheet.tsx` no longer own competing release-only gestures. The sheet retains info → schedule → game → back behavior; embedded/active props separate presentation from modal lifecycle. `venue-popup.css` supplies the measured compact/full bounds, clipping surface and independent scrolling content.

The handle captures only the primary pointer with button 0; ignores another active pointer; resolves the axis at 8px and rejects horizontal motion. Vertical pointermove synchronously updates height without a transition, clamped to measured full minus compact geometry. Release chooses direction at >=0.5px/ms, otherwise the geometric midpoint; samples older than 100ms are treated as stationary. Settlement uses 220ms cubic-bezier(.2,.8,.2,1); reduced motion removes settlement animation but retains continuous movement. Cancellation/lost capture returns to the original settled state. Resize/unmount releases capture and clears the settlement timer. No animation frames are queued by the gesture.

The persistent shell consumes one pointer-generated click after a drag, including across collapse; detail=0 keyboard clicks pass without consuming that guard. Native handle clicks support Enter/Space and tap; ArrowUp expands. The preview's arrow/button expands. Expanded X/Escape collapses to the selected venue; backdrop deselects. The sheet's shared `{ capture: true }` options object, Tab containment, close focus, initiator/fallback focus and overflow restoration from #131 are retained. Modal effects also clean up when active becomes false during settlement. Expanded content is absent from a settled compact popup.

The new primary link appears only for gamesReady=true and an empty schedule, with exact text «Создать игру на этой площадке» and `venueCreatePath(new URLSearchParams({venueId:venue.id}).toString())`. It navigates to the existing form; it does not reserve, create or publish. Nonempty schedules retain «Показать игры на этой площадке». Unverified games show only unavailable status, with no create link or stale games. Existing data loaders, loading/verified same-city snapshot semantics, polling, URL and venueId branch remain unchanged. City change or loss of the selected venue removes the popup.

D2–D3: `venue-preview-card.test.tsx` and `venue-sheet.test.tsx` retain real components and add separate popup hook storage, fake geometry/time, two distinct intermediate heights and sheet content before release, both directions, midpoint and velocity, clamping, mouse/touch/pen, primary/button/ID rejection, second pointer, horizontal rejection, cancel/lost capture, repeat drag, settlement and reduced motion, click guard, ArrowUp and resize/disposal. Existing cover/calendar/time/count tests and all modal focus/Tab/Escape/cleanup assertions remain. Additional sheet cases cover the encoded create link and active=false cleanup. These are source assertions, not executed evidence.

D4: `venue-sheet-integration.test.tsx` now drives the real popup handle around the real GamesMapView/GamesVenueMap and real sheet, using separate parent/map/popup/sheet hook storage. It checks intermediate motion before release, schedule/detail/back/collapse, stable constructor/marker/camera and no gesture-triggered transport/navigation/history/storage/return event. Existing polling/session invalidation/failure cases and remove=0 until cleanup/remove=1 after cleanup remain. `games-map-refresh.test.tsx` adapts component inspection through the popup while retaining #131 URL/request/venueId assertions. `games-map-selection.test.tsx` adapts inspection and replaces obsolete time-window suppression expectations with persistent popup identity; click suppression behavior is exercised in both component suites and integration.

D5: new `create-game-venue-cta.test.tsx` obtains the route from the real sheet CTA and invokes real CreateGamePage with a synthetic fetch transport. It covers guest 401 → AuthEntry.returnPath, cityless profile → setup returnTo, decoded venueId, unresolved catalog, loaded same-city selection, foreign-city/unknown rejection, and GET-only requests without creation/publication. No real server is used.

D6: required commands were attempted separately from the repository root. No full suite or unrelated checks were run; existing CI jobs were not modified. Runtime execution remains required before acceptance.

## Commands and evidence

```text
COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec tsc -p tsconfig.json --noEmit --incremental false
exit: 1 — NOT_TESTED

COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec vitest run --no-cache test/venue-preview-card.test.tsx test/venue-sheet.test.tsx test/venue-sheet-integration.test.tsx test/games-map-refresh.test.tsx test/games-map-selection.test.tsx test/create-game-venue-cta.test.tsx
exit: 1 — NOT_TESTED
```

Both commands emitted:

```text
! Corepack is about to download https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz
Network access disabled by the environment; can't reach https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz
```

Neither TypeScript nor Vitest started: required pnpm was unavailable locally. No installation or network fallback was attempted. Later source edits were not compiler/test-verified either. No new any, TS suppression, skips or tsconfig relaxation were introduced.

`git diff --check` from the repository root: exit 0, no output (whitespace PASS only). Visual/browser UAT: **NOT_TESTED**. Author source verification is not independent QA.

## STYLE_GUIDE_PARITY = UNVERIFIED

Binding source: `docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md`. Reused documented families: BottomSheet, Buttons, Empty/unavailable, media/image, motion/accessibility; palette/radii/safe-bottom from `consumer-tokens.css`; white/ink/lime surface and CTA. Compact retains the square image, name/address/schedule and upward arrow for 0/N games. Expanded retains one 16:9 image, 24px/800 name, 15px address, CTA and 88dvh limit. No invented rating, facilities, gallery or contacts.

Screen direction: `docs/decisions/OWNER_DECISION_MAP_POPUPS_V001.md` and its textual description of M3_venue_mockup.png. No external image or Make source was fetched. Frozen Make screen composition/parity was not verified offline. Referenced `docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md` is absent in this checkout. No STYLE_GUIDE_GAP or OWNER_VISUAL_OVERRIDE is asserted; Make unavailability is not a gap.

## Integration, rollback and slice 2/2 contract

Integrator manually combines this base-specific diff with newer dev, publishes source/handoff and supplies exact candidate commit permalinks. No author Git write or fabricated result permalink. The next bounded action is integrator review and independent QA with existing dependencies, including the two exact D6 commands and browser/product UAT. No green CI, release, deployment or acceptance follows from file presence.

Rollback: integrator removes/reverse-applies only this delivered diff in the allowed source/styles/six tests and this handoff, preserving unrelated work.

Slice 2/2: add `publicContacts` to the info content before the primary CTA. Keep the common popup gesture/capture/settlement and modal lifecycle intact. Contacts must remain independent of Radar/filters; do not replace this container or introduce another gesture implementation. No publicContacts/API change is part of this slice.
