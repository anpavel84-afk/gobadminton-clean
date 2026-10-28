# Issue #182 / FR-3B source handoff — Mode A author (Owner backlog Lean Mode A)

From: Cursor Auto SOURCE AUTHOR. To: one independent PMA QA (not claimed here).
Status: SOURCE DRAFT / NOT_TESTED / NOT ACCEPTED. No paid QA, DEV, UAT, merge, push, or deploy claimed.

## Scope delivered

Bounded web UI on accepted FR-3A API only. No backend/auth/C5/runtime edits. `gameRecommendations` capability gate respected (remains false until PMA activation); UI shows truthful unavailable.

## Files (allowed paths only)

1. `apps/web/src/lib/game-recommendations.ts` — wire types from OpenAPI/`recommendationSummary`, list/send/hide/withdraw paths, eligibility + friend filters, capability helper
2. `apps/web/src/components/consumer/games/GameRecommendationButton.tsx` — detail «Посоветовать другу», one accepted friend, CSRF/idempotency via `useSocialMutation`, separate from `GameShare`
3. `apps/web/src/components/consumer/games/GameRecommendationsSection.tsx` — My Games received/sent, hide/withdraw, pagination cursor, private-view clear on logout/expiry/foreground
4. `apps/web/src/components/consumer/pages/GameDetailPage.tsx` — wire button on public published future games
5. `apps/web/src/components/consumer/pages/MyGamesPage.tsx` — wire section + session/private clear
6. `apps/web/test/game-recommendations.test.tsx` — gates, eligibility, paths/list encoding, share separation, seat disclaimer
7. `apps/web/test/my-games-recommendations.test.tsx` — hide/withdraw bodies, UNKNOWN same-key retry, auth failure without fake success
8. `docs/handoffs/fr3b-recommendation-ui.md` — this handoff

Not touched: GameCard/DiscoveryGameCard (TASK_DATA paths omit them; detail entry suffices), backend, contracts regeneration, deps, Git.

## Contract notes (derived, not guessed)

- Send body: `{ friendshipId }` only
- Hide/withdraw body: `{ expectedVersion: number }`
- List: `view=received|sent`, items with `game{id,title,startsAt,endsAt,timezone}` + `peer{publicPlayerId,displayName}`
- Receipt outcomes: `sent` | `hidden` | `withdrawn`
- Capability `gameRecommendations:false` blocks UI activation; no override

## Checks

- `node_modules` **absent** in this worktree — typecheck/lint/vitest **NOT_TESTED**. PMA: install from existing lockfile/cache, then run targeted:
  - `pnpm --filter @gobadminton/web exec vitest run test/game-recommendations.test.tsx test/my-games-recommendations.test.tsx`
  - `pnpm --filter @gobadminton/web typecheck`
  - `pnpm --filter @gobadminton/web lint` (or repo-equivalent scoped lint)
- No live user actions. Independent QA + Product CI + DEV smoke remain PMA/trusted process.
- Mobile render / Owner UAT: **NOT_TESTED**

## Remaining for DONE

1. PMA install + targeted tests/typecheck/lint PASS  
2. One independent QA PASS on exact candidate SHA  
3. Product CI + DEV release/smoke; hand to Owner UAT with NOT_TESTED where applicable  
4. Narrow capability activation (separate PMA work) before real send UX leaves «недоступны»  
5. PROD only by separate Owner decision
