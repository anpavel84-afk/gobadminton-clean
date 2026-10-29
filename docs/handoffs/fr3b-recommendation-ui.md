# Issue #182 / FR-3B — OD-018 guarded DEV capability (Mode B)

From: Cursor Auto SOURCE AUTHOR (`OD018_FR3B_SOCIAL_GAMES_DEV`). To: one independent Codex Sol Medium QA (default), then mandatory Product CI + trusted DEV.
Status: SOURCE DRAFT / NOT_TESTED / NOT ACCEPTED. No paid QA, DEV release, UAT, merge, push, or PROD claimed.

## Scope delivered

Minimal backend capability delta only. Reuses accepted PR #367 recommendation UI and FR-3A API/migration. Does **not** rebuild UI/backend, enable all Social, or claim Social Games complete.

`GET /v1/me/social-capabilities.gameRecommendations` is true only when:
1. existing `friendsEnabled(env)` admits (fail-closed PROD / outside DEV),
2. actor is Friends-eligible (same fence as `friends`),
3. `friendships` and `game_recommendations` tables are installed.

No new env/shell toggle. Guests/restricted/table-missing stay false. `gameAttention` / `socialPush` remain false. Authorization/CSRF/idempotency negatives unchanged.

## Files (allowed paths)

1. `apps/api/src/friendships/friendships.service.ts` — capability derived from friends + recommendation schema
2. `apps/api/test/unit/friends-dev-admission.test.ts` — table/eligibility matrix; restricted stays false
3. `apps/api/test/integration/game-recommendations.disposable.test.ts` — post-0041 expects true; Friends OFF stays false
4. `apps/web/src/lib/game-recommendations.ts` — comment: UI follows server cap only
5. `apps/web/src/components/consumer/games/GameRecommendationButton.tsx` — comment alignment
6. `docs/handoffs/fr3b-recommendation-ui.md` — this handoff

Unchanged this pass: recommendation routes/policy/service, My Games / detail UI behavior (already server-gated), prior QA/CI history for UI candidate.

## Preserved evidence (do not reset)

- Original UI head `62f1bb9` Medium R3 PASS + Product CI `40727200985` 7/7 retained
- Prepared merge bases / transport fix history retained; no admission rewrite
- Full-reload UNKNOWN caveat from PR #367 remains honest if not separately addressed in UAT

## Checks

Targeted (when deps available):

```bash
pnpm --filter @gobadminton/api exec vitest run test/unit/friends-dev-admission.test.ts test/unit/friendships.test.ts test/unit/game-recommendations.test.ts
pnpm --filter @gobadminton/web exec vitest run test/game-recommendations.test.tsx test/my-games-recommendations.test.tsx
```

Disposable PostGIS suite + Product CI 7/7 + trusted DEV ACCEPTED/live SHA: trusted process. Author sandbox: unit/deps **NOT_TESTED** if `node_modules` absent.

## Limits / out of scope

- No PROD, no global social enable, no C5, no second writer, no new framework
- No shell/env flip before gated release
- Owner UAT: two synthetic friends + organizer journey; if no authorized browser session → **UAT=NOT_TESTED**
- After DEV ACCEPTED, next eligible Project #1 task proceeds per OD-018 (#375 under #372) without PMA chat

## Acceptance transfer

Independent QA verifies capability fail-closed matrix + no UI/API rebuild + retained prior receipts. DONE needs QA + CI + trusted merge + DEV ACCEPTED exact SHA + public live smoke. PROD only by separate Owner decision.
