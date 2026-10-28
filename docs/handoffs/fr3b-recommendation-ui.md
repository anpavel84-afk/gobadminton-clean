# Issue #182 / FR-3B source handoff — Mode A author attempt 4 (FR3B-QA-01 residual)

From: Cursor Auto SOURCE AUTHOR. To: one independent PMA QA (not claimed here).
Status: SOURCE DRAFT / NOT_TESTED / NOT ACCEPTED. No paid QA, DEV, UAT, merge, push, or deploy claimed.

## Scope delivered

Bounded residual repair on send recovery only. Closed R1 pagination and UNKNOWN-core components not redone. No backend/cap activation/C5/deps/Git/publication/deploy.

## Repair vs attempt 3 (FR3B-QA-01 residual)

**FR3B-QA-01** — Send surface `Обновить свой список` no longer routes through friends reload. `useGameRecommendationMutation` `onRefresh` / `rereadOwnList` now triggers actor-owned `listGameRecommendations('sent')` with live/session/game/unmount guards. Empty or failed sent read keeps UNKNOWN path/body/key and replacement-write block; no auto POST; no success/noncommit claim from list absence. Truthful recovery feedback + link `/my-games?rec=sent` opens My Games recommendations on the sent entry view. Friends load remains picker-only.

One new focused send-component integration assertion: recovery transport must be sent-recommendations GET (not friends, not injected refresh spy alone). Prior 19 targeted assertions reused.

## Files (allowed paths only)

1. `apps/web/src/components/consumer/games/GameRecommendationButton.tsx` — sent-list recovery + honest copy + My Games sent link
2. `apps/web/src/components/consumer/games/GameRecommendationsSection.tsx` — optional `initialView` for sent entry
3. `apps/web/src/components/consumer/pages/MyGamesPage.tsx` — `?rec=sent` → sent recommendations entry
4. `apps/web/test/my-games-recommendations.test.tsx` — +send recovery GET sent assertion
5. `docs/handoffs/fr3b-recommendation-ui.md` — this handoff

Unchanged this pass: `game-recommendations.ts` (hook `rereadOwnList` already correct; wiring was the defect), `GameDetailPage.tsx`, `game-recommendations.test.tsx`.

## Contract notes

- Recovery reread: `GET /v1/me/game-recommendations?view=sent&limit=20`
- Failed/empty list ≠ proof of noncommit; pending UNKNOWN preserved
- UI copy plain (no key/protocol details)

## Limitations

- Typecheck/lint/vitest **NOT_TESTED** here (no deps in private export). PMA: lockfile offline install, then targeted:
  - `pnpm --filter @gobadminton/web exec vitest run test/game-recommendations.test.tsx test/my-games-recommendations.test.tsx`
  - `pnpm --filter @gobadminton/web typecheck`
  - scoped lint equivalent
- Capability remains false until separate activation.
- No live E2E; Product CI / DEV smoke / Owner UAT are PMA/trusted process.

## Remaining for DONE

1. PMA install + targeted tests/typecheck/lint PASS
2. One independent QA PASS on exact candidate
3. Product CI + DEV release/smoke; Owner UAT with NOT_TESTED where applicable
4. Capability activation (separate)
5. PROD only by separate Owner decision
