# Handoff · #386 venue arrangement (combined D1 / T0a-2 / T0a-4)

Author: Cursor Auto · Assignment: `OWNER_20261102_COMBINED_VENUE_ARRANGEMENT_DEV`
Base: `c936031114f57c23f6faa9a01757374b912819ed` (alpha.13 ACCEPTED)
Candidate: application `0.1.0-alpha.14` / API `0.24.0` · `source_sha` null until trusted ACCEPTED
QA route: Codex Sol Medium · Independent CI/DEV by trusted PMA · UAT=NOT_TESTED

## STYLE_GUIDE_PARITY

- Reused: existing create-game form groups, `VenuePublicContacts` ListRow-style
  outlined contact rows, game section / status panel patterns, `useSocialMutation`
  UNKNOWN fence, desktop overlay create composition unchanged.
- Screen-specific Make composition: create form place/time section; owned summary
  and game detail grids kept.
- STYLE_GUIDE_GAP: bounded closed `<details>` checklist + readonly draft textarea
  for T0a-2 (no new modal engine); compact organizer status select for T0a-4.
- OWNER_VISUAL_OVERRIDE: none. Guide texts
  `386-OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md` and
  `386-DESKTOP_OVERLAY_STYLE_GUIDE.md` acknowledged as text references (not new mockups).

## Delivered files (allowed_paths only)

- API: `0050_game_court_booking(.sql|/rollback)`, `game-court-booking.{policy,service,controller}.ts`,
  `games.module.ts`, unit + disposable integration tests, migration smoke list.
- Web: extracted `venues/VenuePublicContacts.tsx` (compatible re-export from `VenueSheet`),
  `VenueBookingHelp.tsx`, `venue-booking-help.ts`, `GameCourtBooking.tsx`,
  CreateGame / OwnedGameSummary / GameDetail wiring, `api-client` + `consumer-types`,
  `games.css`, focused web tests, releases alpha.14 + exact alpha.13 history seed.
- Contracts/docs: OpenAPI `0.24.0` path+schemas, product contract + this handoff,
  CHANGELOG candidate note.

## Author verification run

```bash
export PATH=/opt/gb-slots/runtime/node/bin:$PATH
export TMPDIR=/tmp/gb-cursor-211-owner-quota-1ij_cl05/tmp-node
pnpm --filter @gobadminton/contracts exec node scripts/check-openapi.mjs
# → CONTRACT CHECK: PASS (176 paths, OpenAPI 3.1.1, info 0.24.0)
pnpm --filter @gobadminton/web exec vitest run \
  test/venue-booking-help.test.tsx \
  test/game-court-booking.test.tsx \
  test/create-game-venue-cta.test.tsx \
  test/releases.test.tsx \
  test/releases-server.test.ts
# → 5 files / 34 tests PASS
pnpm --filter @gobadminton/api exec vitest run test/unit/game-court-booking.test.ts
# → 7 tests PASS
pnpm --filter @gobadminton/web exec tsc --noEmit -p tsconfig.json
pnpm --filter @gobadminton/api exec tsc --noEmit -p tsconfig.json
pnpm --filter @gobadminton/web exec eslint <changed web files>
pnpm --filter @gobadminton/api exec eslint <changed api files>
# → typecheck + eslint PASS
# Disposable DB compound (PMA / outside author sandbox — not run here):
# RUN_DB_INTEGRATION=1 DATABASE_URL=postgres://…/gobadminton_court_booking_disposable \
#   pnpm --filter @gobadminton/api exec vitest run \
#   test/integration/game-court-booking.disposable.test.ts
#   (+ migration.smoke with disposable PostGIS)
```

Not run by author: full Product CI, live Docker/DB / disposable PostGIS compound,
authorized browser UAT, independent Codex QA, DEV install/smoke.

## Remaining gates

Independent Codex Sol Medium QA → Product CI → merge `dev` → server DEV ACCEPTED
→ release agent binds source SHA / receipt / UAT=NOT_TESTED. PROD not authorized.
Parent #386 / #373 remain canonical; #394 and full catalogue not DONE.

## Known limits

- No platform booking/payments; status is organizer-declared only.
- Old AGY #386 worktree not imported; raw/charged attempts retained, not replayed.
- Mode B binding / AGY Author not claimed READY.
