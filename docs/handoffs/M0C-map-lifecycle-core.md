# M0c — Games map lifecycle core

From: source author (Codex), issue-98 worktree  
To: integrator / independent QA  
Date: 2026-10-19  
Status: WORKING_DRAFT — source and tests provided; checks NOT_TESTED

## Assignment and authority

Immutable GOBADMINTON_AUTONOMY_V1 source_only assignment, target dev, M0c bounded Games map lifecycle slice. Base is [0c61960868b85cf40b761d953c7ea1b7565ecda9](https://github.com/anpavel84-afk/gobadminton-clean/tree/0c61960868b85cf40b761d953c7ea1b7565ecda9), matching supplied checkout HEAD (automation/issue-98). Initial tracked diff was empty. Only the four assigned source paths, four assigned test paths and this newly created handoff were edited. No commit, git metadata writes, publication, dependency installation, network deployment, services or PROD effects were authorized or performed. Candidate permalink: publisher to populate after publication; none invented here.

## FACT versus hypothesis/history

FACT from local base: immediate fatal WebGL handling; marker updates rewrote DOM and coordinates; counts rebuilt on a one-second clock; positive layout observations always resized; initial venue failure could leave snapshot null and prevent mounting the map. These are code observations, not a proven cause of iPhone flicker.

Reported history: M0b #96 failed independent QA after three attempts; CI attempt 2 reportedly had TS2339 for marker presentation/position. CI history was not independently accessed or confirmed. The marker entry now explicitly declares those optional fields, and reconciliation uses its explicit generic type, without any/ts-ignore.

Hypothesis: reducing avoidable lifecycle/DOM churn may improve the reported iPhone behavior. No Safari/device diagnosis or PASS is claimed. Prior independent QA supplied with this assignment was `{}`.

## Changes → regression coverage

- GamesVenueMap: original canvas DOM loss event is prevented; classified WebGL errors and context loss share a non-extending 4000ms grace. Restore strictly before deadline cancels it and repaints. Fatal state is retained until retry, including late restore/load. Visibility repaints only when visible; other fatal diagnostics and tile watchdog remain independent. Cleanup removes canvas/visibility listeners and clears grace/RAF. Lifecycle tests cover 3999/4000ms, repeated loss/error, fresh grace, late events, retry, cleanup and watchdog/other fatal.
- games-venue-map helpers: sameVenueCounts and stableVenueCounts compare map contents independent of order and distinguish null from an empty verified map. Helper tests cover identity, changed keys/values and null semantics.
- GamesMapView: retains same-city verified snapshots during pending poll/focus; current games OR venues failure, or rejection, invalidates hints while preserving geography. Session aborts/invalidate immediately; city gating prevents old counts. Day/activity derive schedules from current filters. Clock checks every 30000ms and changes now only across minute buckets; successful response and visible event update immediately. Refresh tests preserve pagination/abort assertions, update pending expectations and add separate failures, session invalidation and eligibility expiry.
- Moscow MapView mounts with empty geography/unknown counts during initial load and survives first venue failure. Non-Moscow uses existing list fallback; venueId returns only the venue schedule. New continuity test runs real GamesMapView → GamesVenueMap with separate state/ref/memo/effect storage through initial venue failure, success, day change and rejected refresh, then unmount; asserts one construct/no remove until unmount.
- Typed VenueMarkerEntry keeps button/focus and skips unchanged presentation fields and coordinates. Separate effect no longer depends on counts. Lifecycle test asserts unchanged marker renders avoid DOM replacement/setLngLat.
- Layout coalesces ResizeObserver notifications into one RAF, tracks positive size and observed zero; retains load/first-idle resize. Viewport writes inline geometry only when changed. Lifecycle tests cover resize batching/zero transitions and both viewport modes, including RAF cleanup.

Existing map asset authority, resource allowlist, MapLibre 6.13.0, pmtiles 4.5.0, camera storage, Radar sharedMap, error card, back capsule and marker activation policy are retained. No API/DB/contracts/dependency/workflow changes.

## Commands and actual results

Run offline in the required order:

| Command | Exit | Result |
| --- | --- | --- |
| `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web run typecheck` | 1 | NOT_TESTED — Corepack could not obtain pnpm 10.18.0 locally |
| `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web run lint` | 1 | NOT_TESTED — same tool bootstrap failure |
| `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web run test:unit` | 1 | NOT_TESTED — same tool bootstrap failure |

All three printed: `Corepack is about to download https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz`, followed by `Network access disabled by the environment; can't reach https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz`. No checker/test process started. No installation/download workaround was attempted. Added/modified tests remain unexecuted. This is source author evidence only, not independent QA.

## STYLE_GUIDE_PARITY

Reused Error, SurfacePanel, Button and existing marker patterns; existing screen composition retained. Presentation authority read: docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md (frozen Make #guide / #construction-kit references). The additionally named docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md is absent in this checkout. No external design fetch was made under the offline assignment. STYLE_GUIDE_GAP / OWNER_VISUAL_OVERRIDE: новых нет. No new visual composition was introduced.

## Limitations / risks / continuation

Compilation, lint and unit behavior are NOT_TESTED because the required package manager was unavailable offline. Regression tests are authored coverage, not execution evidence; independent QA must assess completeness of A1–A6, including changed marker attributes/coordinates, minute timing, stale requests and all continuity transitions. Browser/native event ordering and real MapLibre context recovery still require validation. No independent QA, release, deployment or Owner acceptance occurred.

Rollback: integrator removes only this M0c diff; no runtime migration or metadata rollback is needed. Base discrepancies belong to the integrator for manual merge; do not fetch/reset or replace unrelated work.

Next bounded action: independent QA obtains the publisher's exact candidate, runs A7 with provisioned offline tools, reviews A1–A6 against the source/tests and records evidence against that candidate. A later iPhone scenario is `/games?view=map`, observe 30s, pan/zoom, background 10s and return. It is future QA, not this source diff's gate and not Safari PASS.
