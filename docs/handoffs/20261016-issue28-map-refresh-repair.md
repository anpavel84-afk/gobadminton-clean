# #28 Wave D — marker identity and refresh continuity repair

From: source author. To: independent SOURCE QA / PM. Date: 2026-10-16.
Status: WORKING_DRAFT / UNVERIFIED; not accepted or published.
Exact base: `7bacc4f2de102ae16fd6fa7cb79dd83eb53a2c9a`.
Base permalink: https://github.com/anpavel84-afk/gobadminton-clean/tree/7bacc4f2de102ae16fd6fa7cb79dd83eb53a2c9a
Assignment: supplied immutable GOBADMINTON_AUTONOMY_V1, Issue #28 Product#24,
Wave D Games map; bounded repair of the two independent FAIL findings on this base.
Allowed effects: source edits only under task allowed_paths; no commit, push,
git metadata changes, network deployment, automation, secrets, services or PROD.
Initial branch automation/issue-28; clean worktree. No additional writer launched.

## Source changes (not evidence of runtime success)

GamesVenueMap reconciles markers by immutable venue ID. Clock/count/date updates
change button presentation and callback on the existing element; only removed or
unmappable venues lose controls. Map teardown explicitly cleans marker registry.
GamesMapView retains same-city public venues and selected schedule card during
refresh, including failed venue fetches. Map component remains mounted, preserving
camera. Revalidation immediately clears game rows/counts and marks schedules
unavailable until a successful game response; failures cannot show stale hints.
City changes do not reuse another city's venue surface. Existing error notice
continues to report incomplete catalog/schedule loading.
Added games-map-marker-lifecycle.test.ts for identity across count/unknown updates,
activation and removal. It exercises the reconciliation adapter without a DOM;
actual browser focus/camera behavior still requires independent verification.

## STYLE_GUIDE_PARITY

Reused existing map/buttons, kit Error/Status notices and the venue schedule
ContentCard/SectionHeader/GameCard composition recorded in previous source handoffs.
Inspected admitted .tools/style-reference README, guide text and map-action manifest:
exact map action is OBSERVED_NOOP, not evidence of an exact canonical map screen.
Existing STYLE_GUIDE_GAP #28-venue-schedule remains proposed; no new visual pattern,
no OWNER_VISUAL_OVERRIDE. Linked operations style-guide file is absent locally.
Visual parity remains UNVERIFIED.

## Checks / UAT / next recipient

No self-QA, tests, typecheck, build, lint, browser or deployment checks run, per user
instruction. All new tests NOT_TESTED. Prior independent verdict remains FAIL until
independent review; dependency/Corepack EAI_AGAIN limitation is preserved from the
provided prior review, not newly reproduced. No PASS or acceptance claimed.
Next bounded action: authorized publisher creates exact candidate SHA and publishes
this handoff; independent SOURCE QA runs existing API/Web suites and new regression.
Browser UAT: focus a marker for several clock ticks, activate with Enter/Space;
change date and counts; retain camera/selected card across 30s, focus, online and
manual refresh; fail venues/games independently and together, verify all retained
public venues selectable with unknown counts/no stale rows. Switch cities and
sessions during pending refresh; ensure no cross-city or stale schedule data.
Then follow existing full CI and PM DEV mobile390/desktop/privacy smoke gates on
exact SHA; backup/paired images/root receiver acceptance remain separate NOT_TESTED.
PROD requires separate Owner GO.

## Rollback / durable record

Revert only this repair's component/helper/test/handoff edits against exact base;
no migrations or runtime changes. Preserve previous FAIL and handoffs.
No new SHA/permalink exists because commit/push are prohibited. Authorized publisher
must add candidate permalink and independent evidence to #28; this local artifact
is prepared for durable GitHub publication, not claimed already published.
