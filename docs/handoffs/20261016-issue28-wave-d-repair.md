# #28 Wave D — bounded source repair after independent FAIL

From: source author. To: independent SOURCE QA / PM. Date: 2026-10-16.
Status: WORKING_DRAFT — NOT ACCEPTED; all execution/UAT NOT_TESTED.
Base SHA: `14bb364e19b2e22842f95e1f8173917f1e971c8d`.
Base: https://github.com/anpavel84-afk/gobadminton-clean/tree/14bb364e19b2e22842f95e1f8173917f1e971c8d
Branch observed: `automation/issue-28`; initial worktree clean.
No candidate SHA/permalink: assignment prohibits commit/push/git metadata writes.
This local handoff requires later authorized GitHub publication; it is not yet a
published durable candidate. Exact immutable task and effects remain in the source
handoff's assignment section and supplied GOBADMINTON_AUTONOMY_V1 assignment.

## Implemented source changes (not execution evidence)

1. Remove jsdom and Testing Library usage from `games-map-view.test.tsx`.
   It now uses declared React DOM server and Vitest to exercise venue-card rendering,
   safe default, empty/date/error states, game/create links and return-path identity.
   These are server rendering and pure boundary tests, not browser interaction tests.
2. GamesVenueMap directly imports existing marker CSS, so direct Games entry no longer
   depends on visiting Players/Radar. Focus styling is provided on the Games surface.
3. Failed game loading passes null counts. Marker presentation announces unavailable
   schedules instead of verified zero. Missing count entries also remain unknown.
   A verified zero remains distinct; venues remain visible/selectable in every case.
4. Shared venueCreatePath carries the encoded immutable venueId through both login
   and profile setup, discarding unrelated query parameters. Current catalog remains
   the authority for resolving the venue after returning.
5. Isolate venue preview/schedule as VenueScheduleCard, composing inspected kit
   ContentCard image-top, SurfacePanel/SectionHeader, Button, GameCard and safe cover.
   Never render stale game rows while gamesReady is false.

## STYLE_GUIDE_PARITY

See corrected source handoff section. Supplied primary `.tools/style-reference`
observations were inspected; its README cites Owner admission
https://github.com/anpavel84-afk/gobadminton-clean/issues/28#issuecomment-6198534662 .
Guide text Map and Construction Kit 00–02 and actual guide-desktop.png establish
families; games-map-action manifest explicitly records OBSERVED_NOOP. Bounded
STYLE_GUIDE_GAP #28-venue-schedule is proposed for venue-specific composition using
those inspected families. No verified standalone VenueCard or exact map screen is
claimed. No OWNER_VISUAL_OVERRIDE. Visual acceptance remains UNVERIFIED. The linked
operations style guide and installed version-specific Next docs are absent locally;
no dependency install or framework API migration was attempted.

## Checks, UAT and next bounded action

No tests, typecheck, build, lint, browser smoke or self-QA were run, per assignment.
No PASS, independent QA, hosted CI, deployment or root receiver acceptance claimed.
No package/lockfile changes: those paths are outside the assignment. Existing API,
privacy, pagination/date/timezone tests remain for independent execution.

Next recipient: independent SOURCE QA on an authorized publisher's exact new SHA.
Run Web unit tests/typecheck/build and API regression suites from the locked graph.
Verify direct Games entry loads styled/distinct markers; force schedule failure with
nonempty venues and ensure every marker says unavailable, never zero. Exercise
zero-game/date-filter selection, safe cover and keyboard actions at 390/1440 widths.
Guest → login → profile without city → setup → create must retain the venueId;
unknown/cross-city IDs must not become selected outside current catalog authority.
Verify complete pagination, venue-ID isolation, timezone ordering, expiry and
private/full/invitation negatives with the existing API/disposable fixtures.
PM hosted full CI / actual DEV paired-image/backup/receiver and synthetic product
smoke remain separate required gates, NOT_TESTED here. PROD requires separate GO.

## Rollback and continuity

Revert only this repair's edits/new files against the exact base; do not reset other
work. No migrations, DB, runtime, services, secrets, automation or deployment changes.
Retain original independent FAIL and source handoff; repair is not acceptance.
Publish this handoff and corrected source parity record with the source candidate
when authorized, then append exact candidate links and independent evidence in #28.
