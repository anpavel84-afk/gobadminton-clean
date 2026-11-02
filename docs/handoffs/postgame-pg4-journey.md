# Issue #372 / PG-4 connected private history journey — Mode A author handoff

From: Cursor Auto (`OWNER_APPROVED_PG4_CONNECTED_PRIVATE_HISTORY_JOURNEY`, attempt 1, base `6383ef406f5944a299843939d391ab7886fdb5dd`).
To: one independent Codex Sol Medium QA → mandatory Product CI → trusted DEV release/smoke → Owner UAT.
Status: **SOURCE CANDIDATE** / UAT=**NOT_TESTED** / **NOT READY** / no DEV ACCEPTED claim / no PROD.
Parent #372 PG-4 UI slice only. Typed Safety complaint extension **remaining**. Public comments #394 later. Mode B binding NOT claimed. Author checks ≠ independent QA.
C5 OFF. Antigravity Author not required. API contract note remains `0.23.0` (unchanged). Alpha.13 release metadata **pending PMA** — alpha.12 ACCEPTED record not supplied in this pass; release files not bumped to alpha.13.

## Materials read (images opened as images)

- `pg4-manager-ready-desktop.png` (sha256 `54a9c6eb…`) — manager history composition reference
- `pg4-participant-ready-mobile.png` (sha256 `0cf9fe33…`) — participant history composition reference
- `OWNER_DECISION_POST_GAME_MODEL_V001.md` (sha256 `54820a47…`)
- `docs/product/POST_GAME_STYLE_GUIDE.md` (current accepted)

## Delivered slice (prospective)

1. **Own authoritative history on public getGame 404 / membership change**
   - Compact `OwnResultsHistoryCard` from `/me/game-results` (title/date/own mark/provenance/pending notice only; no invented venue/opponent).
   - Dedupes with ordinary participation/managed cards; orphan private rows surface on history.
   - Cursor load-more preserves prior rows; non-401 list failure is retryable error (not empty); 401/unavailable distinguished.
   - Session/private-expired clears own results + cursors immediately; stale fetches ignored.

2. **Private sent/received reviews on history**
   - `GameReviewsHistory` via `listMyReviews` (page 20, cursor, RU labels).
   - Links to exact game results `?section=feedback`; mutations remain only in `GameFeedbackPanel`.
   - Validated `parseResultsSection` + tab sync on legitimate route change; default attendance; back to `/my-games?view=history`.

3. **Review row honesty**
   - Kind/context, rating labels «Сыграл бы снова» / «Нейтрально» / «Были трудности», text/version/edited/reply when present; no fake author name; context «К итогам игры» when title absent.

4. **Preserved**
   - Shared container / left rail on upcoming / mobile inset / one main scroll; no sitewide redesign; no automatic play-again; no new staff/retention; no API/schema/auth changes.

## Author checks run

```text
apps/web vitest run test/my-games-results.test.tsx test/game-results.test.tsx test/game-reviews-history.test.tsx
→ 3 files / 18 tests PASS

apps/web tsc --noEmit
→ exit 0

apps/web vitest run test/releases.test.tsx test/releases-server.test.ts
→ PASS (alpha.12 retained; known-limit copy only)
```

## Release metadata

- Application version left at candidate `0.1.0-alpha.12` (no alpha.13 without alpha.12 acceptance record).
- Known-limit copy improved for user-facing Safety/PROD wording; does **not** claim Safety implemented.
- API `0.23.0` unchanged. No predicted SHA / DEV receipt.

## Residual / explicit non-claims

- Typed review-specific Safety extension — **REMAINING** (outside this UI slice)
- Authorized browser Owner UAT — **NOT_TESTED**
- Public comments #394 — later
- Full PG-3/PG-4/parent DONE — **not claimed**
- PROD / main / C5 / Mode B READY — **not claimed**

## Allowed paths touched

`MyGamesPage.tsx`, `GameResultsComposition.tsx`, `GameDetailComposition.tsx`, `GameReviewsHistory.tsx` (new), `game-results.ts`, `postgame.css`, focused tests, `releases.ts` (known-limit copy only), this handoff.
