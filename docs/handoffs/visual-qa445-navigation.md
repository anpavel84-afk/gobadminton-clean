# Issue #445 points 3 + 5 — Map/venues aliases + finder prerequisite copy (group C)

From: Cursor Auto (`VISUAL445_C_NAVIGATION_EMPTY_COPY`, attempt 1, base `6907b0e78504eb1b1f8b52f4eee5cef9c03009f4`).
To: independent Codex Sol Medium QA → mandatory Product CI → trusted DEV → Go Bad browser retest.
Status: SOURCE CANDIDATE only. **UAT = NOT_TESTED**. Do **not** close #445 (`Refs #445`, no Closes). Points 1/2/4/6 out of scope. PROD forbidden. No fake READY/PASS.

## Read ack / design provenance

| Material | Delivered path | SHA256 | Read |
| --- | --- | --- | --- |
| Admission (`admission.json`) | `/tmp/gb-cursor-211-owner-quota-qj77qn0_/data/design-inputs/admission.json` | `93317942e8e480a2e42bcc39ba7f27b6caf847cda1f0e4ccfd1515b7822691a0` | Yes — group C = points 3+5; source_prs 429/439 for finder only |
| HTTP before (`navigation-before.json`) | `/tmp/gb-cursor-211-owner-quota-qj77qn0_/data/design-inputs/navigation-before.json` | `2f7dc66640ae6e51d6c1c30172df5fcbe5c4c8eb518a0f6f233eb40120b5b631` | Yes — `/games/map` HTML 200 + API 422; `/venues` 404; `/games?view=map` 200 |
| Sitewide owner-v3 | `/tmp/gb-cursor-211-owner-quota-qj77qn0_/data/design-inputs/index.html` | `cd1675a742304b585526d09337c568ce6ac807ff3f4bcf002a93447c0ba538ac` | Selective — shell/`statebox`, venue `Назад к карте`→`map`, game loading state. No redesign |
| Players desktop-v5 (`20261030-desktop-v5`) | **Not in ACTUAL INPUT MATERIALS** | — | **Missing original local copy** — not invented; copy change follows Owner assignment neutral wording only |

Map source PR was not provided in the report; not invented. Finder source PRs: #429 / #439 per admission.

## Defects addressed

3. **Map**: `/games/map` was captured by `[gameId]` → infinite «Загружаем игру» + `GET /v1/games/map` 422. Venue «← Назад к карте» / `/venues` 404 while canonical map is `/games?view=map`. Existing `gamesMapReturnPath` already falls back to `/games?view=map` (privacy-safe); preserved.
5. **Players finder**: desktop tab «По одному» showed empty/prerequisite text still naming «В режиме «Свайп»…».

## Repair (allowed paths only)

1. `apps/web/src/app/games/map/page.tsx` — static redirect → `/games?view=map` (no catalogue, no query open-redirect).
2. `apps/web/src/app/venues/page.tsx` — same static redirect for legacy `/venues` entrance (does not replace `/venues/[venueId]`).
3. `apps/web/src/app/games/[gameId]/page.tsx` — non-UUID `gameId` → `notFound()` before `GameDetailPage` (no API call). UUID regex case-insensitive; no generation/variant overvalidation.
4. `usePlayerBrowseOffers.ts` + `PlayerBrowseOffers.tsx` — prerequisite message: «Предложения доступны, когда ваш профиль виден в каталоге.» Mobile CTA «Свайп» / desktop «По одному» and privacy gates unchanged.

## Author checks (not independent QA)

- Model environment: **no installed deps** — full suite / CLI vitest **not** run here.
- Added/updated source regressions: `map-route-aliases.test.tsx`, `player-browse-discovery.test.tsx`, `player-browse-friendship.test.tsx`.
- Trusted operator should run those targeted files after import.

## Remaining real browser checks (Go Bad / trusted DEV)

- `/games/map` and `/venues` land on existing map (`/games?view=map`), no «Загружаем игру», no `GET /v1/games/map`.
- Venue page «← Назад к карте» reaches map (via existing `returnTo` / fallback).
- Invalid path like `/games/not-a-uuid` is terminal unavailable/404, not infinite load.
- Valid UUID game detail still loads (uppercase OK).
- Finder prerequisite (profile hidden): desktop «По одному» and mobile «Свайп» show neutral catalogue-visibility text, not «В режиме «Свайп»».

## Non-goals / unchanged

- No backend/chat/social capability changes; no other #445 points; no AGENTS/runtime/versions/release metadata.
- No new map or venues catalogue UI; no C5/PROD/Git credentials.
- Base dependency note from admission: publishing follow-up assumes PR #446 DEV ACCEPTED then ordinary merge to `dev` (not source-as-runtime).

## Changed paths

- `apps/web/src/app/games/map/page.tsx`
- `apps/web/src/app/venues/page.tsx`
- `apps/web/src/app/games/[gameId]/page.tsx`
- `apps/web/src/components/consumer/players/PlayerBrowseOffers.tsx`
- `apps/web/src/components/consumer/players/usePlayerBrowseOffers.ts`
- `apps/web/test/map-route-aliases.test.tsx`
- `apps/web/test/player-browse-discovery.test.tsx`
- `apps/web/test/player-browse-friendship.test.tsx`
- `docs/handoffs/visual-qa445-navigation.md`
