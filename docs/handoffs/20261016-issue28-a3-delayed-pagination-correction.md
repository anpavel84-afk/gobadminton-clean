# Issue #28 — bounded operator correction after independent QA a3

From: native source author, Germany issue-28 worktree. To: authorized publisher / NEW independent SOURCE QA.
Date: 2026-10-16. Status: SOURCE_READY / WORKING_DRAFT, UNVERIFIED, no self-approval.
Base/reviewed SHA: `a6d8550f3130a4bc194c664b3a5c10caddfc895d`.
Base: https://github.com/anpavel84-afk/gobadminton-clean/tree/a6d8550f3130a4bc194c664b3a5c10caddfc895d
Branch: `automation/issue-28`; initial worktree clean. User states primary executor
stopped under existing Storeflock; no competing writer or agent launched here.

## Assignment and preserved finding

One bounded source correction, after automatic three attempts exhausted. Latest
independent QA a3 verdict on base remains **FAIL**: unconditional 30-second refresh
invalidates pending sequential pagination through effect cleanup, discards loads
longer than 30 seconds indefinitely, and leaves requests running. Fix only this
finding with delayed-pagination regression; no redesign or next task.
Allowed writes: GamesMapView.tsx, strictly necessary existing map utilities under
apps/web/src/lib, apps/web/test, relevant docs/handoffs. No network, models, commit,
push, automation, secrets, live DB/env/services, PROD, PLAN or VPN actions authorized.
This local handoff is prepared for later durable publication, not already published.
No new SHA or candidate permalink exists.

## Source correction

- Existing games-venue-map utility now owns a completion-based refresh scheduler:
  immediate initial load, one pending snapshot at a time, then 30 quiet seconds
  after settlement. Focus/online during pending work do not restart it.
- GamesMapView uses that lifecycle, retaining public venue geography and clearing
  unverified game counts/rows during revalidation. Successful completion releases
  loading; incomplete results retain existing error/unavailable schedule behavior.
- Cleanup aborts pending HTTP requests and clears polling on city/date changes,
  session invalidation and unmount. Session invalidation restarts permission reads;
  aborted responses cannot update snapshots or schedule another refresh.
- Existing api-client map pagination functions pass optional AbortSignal through
  every page; after an aborted response they do not continue pagination, even if
  a transport returns a late result. Existing callers remain compatible.
- New games-map-refresh.test.tsx exercises the actual component with an explicit
  state/effect harness, real API pagination and schedule rendering, fake timers
  and delayed fetch. Two pages per resource take 40 seconds. Cases cover visible
  schedule completion, no overlapping polling/focus/online refreshes, retained
  venues/error/loading state, city/date/session/unmount cancellation, and late
  responses from an abort-ignoring transport. It is not a browser lifecycle test.

All-venue geography, immutable IDs, date-only game filtering, server authority,
guest/private/game-seat privacy and existing Radar consent mechanisms are preserved
by scope; their acceptance still requires independent evidence.

## STYLE_GUIDE_PARITY

Read Owner Style Guide first decision and admitted .tools/style-reference README,
map-action observation manifest and Guide DOM. Reuses current Button, status/error,
ContentCard/SectionHeader/GameCard composition without presentation changes.
Map action reference is OBSERVED_NOOP, not a canonical map screen. Existing proposed
STYLE_GUIDE_GAP #28-venue-schedule and earlier parity records remain unchanged.
No new STYLE_GUIDE_GAP or OWNER_VISUAL_OVERRIDE. Linked operations Style Guide file
is absent locally. Visual/browser parity remains UNVERIFIED.

## Checks and limits

`git diff --check`: completed successfully (source whitespace only).
Attempted once, with `COREPACK_ENABLE_NETWORK=0`:

    pnpm --filter @gobadminton/web exec vitest run test/games-map-refresh.test.tsx test/games-map-pagination.test.ts test/games-map-view.test.tsx test/games-venue-map.test.ts

NOT_TESTED: Corepack lacks pnpm-10.18.0 locally and refuses download with network
disabled. No dependency installation or network retry performed. No local
node_modules/.bin or apps/web/node_modules/.bin was present. Test success,
typecheck, lint, build, full CI, independent QA and real DEV behavior are NOT_TESTED.
Previous tests, handoffs and QA FAIL history retained. No PASS or acceptance claimed.

## Next bounded action / rollback

Authorized publisher supplies exact new SHA and durable artifact links, followed by
NEW independent SOURCE QA including executable tests. Full hosted Product CI and
real DEV backup/paired-image/browser/receiver gates, PM mobile390/desktop and
permission-negative smoke, actual root-owned ACCEPTED same SHA/digests/pending=false
remain later requirements. No PROD authority; separate Owner GO required.
Rollback only this repair's component, api-client signal additions, scheduler,
new regression and this handoff against exact base; preserve prior QA/history.
