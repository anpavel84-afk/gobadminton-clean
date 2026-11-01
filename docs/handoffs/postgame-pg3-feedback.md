# Issue #372 / PG-3 Private reviews + personal notes — Mode A author handoff

From: Cursor Auto (`OWNER_APPROVED_PG3_PRIVATE_FEEDBACK_PERSONAL_NOTES`, attempt 1, base `7a36b8d94a5df412426155e5852fddd9da7b0045`).
To: one independent Codex Sol Medium QA → mandatory Product CI → trusted DEV release/smoke.
Status: **SOURCE CANDIDATE** / UAT=NOT_TESTED / PG-3 writes default **OFF** / **NOT READY** / no DEV claim / no PROD.
Parent #372 PG-3 slice only. PG-4 and #394 not done. Mode B binding NOT claimed. Author checks ≠ independent QA.
App **0.1.0-alpha.5** / API **0.23.0** (candidate). Alpha.3 + alpha.4 history preserved in CHANGELOG.

## Design inputs acknowledged (filenames)

- `pg3-participant-ready-desktop.png` (sha256 `ace9c458…1c0b`)
- `pg3-participant-ready-mobile.png` (sha256 `f35a5a19…e33a`)
- `clarification-manager-1440.png` (sha256 `f1cc636a…e2b57d`) — manager explanation field visual defect fixed in `postgame.css`
- `POST_GAME_CONTRACT_V001.md`, `OWNER_DECISION_POST_GAME_MODEL_V001.md`
- PG-2 `delivery-receipt.json` (alpha.4 DEV ACCEPTED evidence)

## Changed paths (allowed scope)

- `apps/api/migrations/0048_game_reviews_notes.sql` + rollback
- `apps/api/src/games/game-feedback.{policy,service,controller}.ts`, `games.module.ts`
- `apps/api/src/games/game-outcomes.{policy,service}.ts` — optional `feedback` enrich
- `apps/api/test/unit/game-feedback.test.ts`
- `apps/api/test/integration/game-feedback.disposable.test.ts`
- `apps/api/test/integration/migration.smoke.test.ts` — ledger `0048_game_reviews_notes`
- `packages/contracts/openapi.json` **0.23.0** + generated game types
- `apps/web` GameFeedbackPanel + ResultsComposition + mutation fencing + api-client/types + postgame.css
- `apps/web` releases alpha.5 / tests
- `docs/product/POST_GAME_PG3_CONTRACT.md`, `docs/releases/CHANGELOG.md`, this handoff

## Checks (author)

- `pnpm --filter @gobadminton/contracts run check` — PASS (OpenAPI 0.23.0, 175 paths)
- `@gobadminton/api` + `@gobadminton/web` typecheck — PASS (Node 24.21)
- eslint affected feedback/outcomes/web files — PASS
- api unit suite — PASS (464), includes `game-feedback.test.ts` (6)
- web vitest `game-feedback` + `game-results` + `releases` — PASS (15)
- Disposable PostGIS `game-feedback.disposable` + migration.smoke — **DB NOT RUN** (no owned disposable DATABASE_URL in this author environment)
- Product CI / DEV smoke / Owner UAT — outstanding trusted process

## Remaining runtime gates

- Independent QA of this candidate
- Disposable integration + migration smoke on owned PostGIS
- Product CI + trusted DEV deploy/smoke + flag activation
- Owner UAT = NOT_TESTED
- Typed review Safety complaint extension = **remaining** (do not call full PG3 DONE)
- PG-4 / #394 later

## Non-goals / stops

- No PROD, main promotion, C5, Mode B READY, whole-parent close
- No root runtime / Cases flags / live user data / secrets / Git writes by author
- No edit of applied 0042/0046/0047; no new engine/framework
