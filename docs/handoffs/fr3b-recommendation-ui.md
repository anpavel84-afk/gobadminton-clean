# Issue #182 / FR-3B source handoff — Mode A author attempt 3 (narrow repair)

From: Cursor Auto SOURCE AUTHOR. To: one independent PMA QA (not claimed here).
Status: SOURCE DRAFT / NOT_TESTED / NOT ACCEPTED. No paid QA, DEV, UAT, merge, push, or deploy claimed.

## Scope delivered

Bounded web UI on accepted FR-3A API only. No backend/auth/C5/runtime edits. `gameRecommendations` capability gate respected (remains false until Owner/PMA activation); UI shows truthful unavailable. No author Git/push/deploy; no dependency installs in this worktree.

## Repair vs attempt 2 (independent FR3B-QA-01 / FR3B-QA-02)

1. **FR3B-QA-01** — Same-key recovery of an already-UNKNOWN write: a definitive replay rejection (404/409/…) no longer clears `pendingByScope`. Exact path/body/key stay; replacement writes stay blocked; actor-owned list reread is offered (`rereadOwnList` + refresh on failed recovery). Failed recovery is not treated as proof the original commit was absent. Fresh definitive rejection (no prior UNKNOWN) still clears pending as before. Exact same-key transport unchanged.
2. **FR3B-QA-02** — Received/sent first page `{items:[], nextCursor:<non-null>}` is not claimed as an empty inbox. Intermediate copy + «Ещё»; count `0` is not shown while a cursor remains. Empty-then-item continuation covered by one targeted UI test.
3. **Pending lifetime** — Module `pendingByScope` survives component remount **within the current document only**. Full page reload / tab close loses key/body/UNKNOWN. No durable storage, sessionStorage, or new framework added.

## Files (allowed paths only)

1. `apps/web/src/lib/game-recommendations.ts` — UNKNOWN recovery preserve + `rereadOwnList`
2. `apps/web/src/components/consumer/games/GameRecommendationButton.tsx` — actor-owned list reread control while pending
3. `apps/web/src/components/consumer/games/GameRecommendationsSection.tsx` — empty+cursor honest intermediate; reread control; count guard
4. `apps/web/src/components/consumer/pages/GameDetailPage.tsx` — unchanged this pass
5. `apps/web/src/components/consumer/pages/MyGamesPage.tsx` — unchanged this pass
6. `apps/web/test/game-recommendations.test.tsx` — unchanged this pass (prior suite reused)
7. `apps/web/test/my-games-recommendations.test.tsx` — +rejected UNKNOWN replay; +empty continuation then item
8. `docs/handoffs/fr3b-recommendation-ui.md` — this handoff

Not touched: backend, contracts, deps, C5, GameCard/DiscoveryGameCard, shared `useSocialMutation`, Git.

## Contract notes (derived, not guessed)

- Send body: `{ friendshipId }` only
- Hide/withdraw body: `{ expectedVersion: number }`
- List: `view=received|sent`; empty page with `nextCursor` is valid (bounded scan)
- Receipt outcomes: `sent` | `hidden` | `withdrawn`
- Capability `gameRecommendations:false` blocks activation; no override
- Failed same-key replay ≠ proof of noncommit (GAME_RECOMMENDATIONS_V001 Send/hide/withdraw and retries)

## Limitations

- Backend capability remains false — send UX stays on unavailable until separate activation. **Release dependency; API scope unchanged.**
- `pendingByScope` is **document-lifetime only** (survives remount, not full reload/tab close). No claim of durable reload persistence or paid live E2E.
- No live user actions; Product CI / DEV smoke / Owner UAT are PMA/trusted process.
- Typecheck/lint/vitest **NOT_TESTED** here (no deps in private export). PMA: lockfile offline install, then targeted:
  - `pnpm --filter @gobadminton/web exec vitest run test/game-recommendations.test.tsx test/my-games-recommendations.test.tsx`
  - `pnpm --filter @gobadminton/web typecheck`
  - scoped lint equivalent

## Remaining for DONE

1. PMA install + targeted tests/typecheck/lint PASS
2. One independent QA PASS on exact candidate
3. Product CI + DEV release/smoke; Owner UAT with NOT_TESTED where applicable
4. Capability activation (separate) before real send leaves «недоступны»
5. PROD only by separate Owner decision
