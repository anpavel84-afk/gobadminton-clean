# Issue #182 / FR-3B source handoff — Mode A author attempt 2 (narrow repair)

From: Cursor Auto SOURCE AUTHOR. To: one independent PMA QA (not claimed here).
Status: SOURCE DRAFT / NOT_TESTED / NOT ACCEPTED. No paid QA, DEV, UAT, merge, push, or deploy claimed.

## Scope delivered

Bounded web UI on accepted FR-3A API only. No backend/auth/C5/runtime edits. `gameRecommendations` capability gate respected (remains false until Owner/PMA activation); UI shows truthful unavailable. No author Git/push/deploy; no dependency installs in this worktree.

## Repair vs attempt 1

1. **JSX** — `GameRecommendationButton` ready-state wrapped in a fragment (TS2657 / adjacent nodes / esbuild `Expected ')'`).
2. **B2 privacy** — components no longer use `useSocialMutation` default `persist=true`. Module-level in-memory pending Map + ownership in `game-recommendations.ts` keeps path/body/key across remount; no `sessionStorage` writes of `me.id` / `friendshipId`. Shared messaging hook untouched.
3. **Ownership** — session/expiry invalidates callback ownership without erasing unresolved UNKNOWN ops; late success does not publish into a new actor/view; explicit same-key retry only; no automatic write retries on foreground.
4. **Copy** — unavailable: «Рекомендации сейчас недоступны. Попробуйте позже.» (no internal jargon).
5. **Guest auth** — parent `onLogin` **or** local `AuthChooser`, never both (GameDetailPage keeps its single chooser).
6. **Picker foreground** — while open, `visibilitychange` → visible clears stale friends and re-reads capabilities/friends; no write retries.
7. **Tests** — `my-games-recommendations.test.tsx` targets new mutation + UI lifecycles; ordinary list/path helpers kept. Author did not run vitest (`node_modules` absent); PMA runs checks.

## Files (allowed paths only)

1. `apps/web/src/lib/game-recommendations.ts` — wire types, paths, gates, in-memory pending Map + `useGameRecommendationMutation`
2. `apps/web/src/components/consumer/games/GameRecommendationButton.tsx` — detail CTA, picker, guest auth, foreground refresh
3. `apps/web/src/components/consumer/games/GameRecommendationsSection.tsx` — My Games received/sent, hide/withdraw
4. `apps/web/src/components/consumer/pages/GameDetailPage.tsx` — wire button (unchanged this pass; already passes `onLogin`)
5. `apps/web/src/components/consumer/pages/MyGamesPage.tsx` — wire section (unchanged this pass)
6. `apps/web/test/game-recommendations.test.tsx` — gates, eligibility, paths, share separation, guest auth copy
7. `apps/web/test/my-games-recommendations.test.tsx` — in-memory mutation ownership + bounded UI lifecycle
8. `docs/handoffs/fr3b-recommendation-ui.md` — this handoff

Not touched: backend, contracts, deps, C5, GameCard/DiscoveryGameCard, shared `useSocialMutation`, Git.

## Contract notes (derived, not guessed)

- Send body: `{ friendshipId }` only
- Hide/withdraw body: `{ expectedVersion: number }`
- List: `view=received|sent`
- Receipt outcomes: `sent` | `hidden` | `withdrawn`
- Capability `gameRecommendations:false` blocks activation; no override

## Limitations

- Backend capability remains false — send UX stays on unavailable until separate activation.
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
