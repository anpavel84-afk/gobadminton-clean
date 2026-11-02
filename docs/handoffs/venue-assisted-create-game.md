# Handoff · #386 venue arrangement — pass2 targeted repair

Author: Cursor Auto · Assignment: `OWNER_20261102_VENUE_ARRANGEMENT_TARGETED_ACCESS_RACE_SESSION_REPAIR`
Base: `4a642ac582d135c89fe641d3ef37bbc42aaf355d` (QA FAIL pass1)
Prepared predecessor: `c936031114f57c23f6faa9a01757374b912819ed` (alpha.13 ACCEPTED)
Candidate: application `0.1.0-alpha.14` / API `0.24.0` · `source_sha` null until trusted ACCEPTED
QA route: Codex Sol Medium · Independent CI/DEV by trusted PMA · UAT=NOT_TESTED
Authority: Owner #373 OD-018 + #175 comment 6569329697 · attempt 2 · OD-016

## QA FAIL addressed (Codex pass1)

- **P1** `game-court-booking.service.ts` GET: short `BEGIN` + Game `FOR SHARE` +
  role/status read + row read + `COMMIT` (rollback on error). Same fence as
  revoke/participation. Revoked manager who remains confirmed participant retains
  readonly. Added disposable two-connection SQL-barrier regressions for
  non-playing manager revoke and participant removal (actual `pg_blocking_pids`,
  not timing-only `Promise.all`).
- **P2** `GameCourtBookingPanel` + `OwnedGameSummaryPage`: both listen to
  `gb-private-expired` and `gb-session-changed`. Synchronous clear of private UI /
  epoch fence so late GET/PUT/onRefresh cannot repopulate. Owned page uses captured
  epoch across `getMe` / `getMyManagedGame` awaits. `private-expired` does **not**
  bump reloadToken (no getMe 401 → expiry loop); `session-changed` reloads via
  existing path. Actor+game scoped `useSocialMutation` UNKNOWN marker preserved.
  Copy: «Со слов организатора. Приложение не проверяет бронь.»

## Touched allowed_paths only

- `apps/api/src/games/game-court-booking.service.ts`
- `apps/api/test/integration/game-court-booking.disposable.test.ts`
- `apps/web/src/components/consumer/games/GameCourtBooking.tsx`
- `apps/web/src/components/consumer/pages/OwnedGameSummaryPage.tsx`
- `apps/web/test/game-court-booking.test.tsx`
- `apps/web/test/venue-booking-private-boundary.test.tsx` (new)
- `docs/handoffs/venue-assisted-create-game.md`
- `docs/product/VENUE_COURT_ARRANGEMENT_CONTRACT.md`

Unchanged / not re-audited: VenuePublicContacts, copy-draft create flow, OpenAPI
0.24 / alpha.14 / migrations / release seeds (no frozen-contract change required).

## Author verification run (actual)

```bash
export PATH=/opt/gb-slots/runtime/node/bin:$PATH
export TMPDIR=/tmp/gb-cursor-211-owner-quota-b70xizra/tmp-node
mkdir -p "$TMPDIR"
pnpm --filter @gobadminton/web exec vitest run \
  test/game-court-booking.test.tsx \
  test/venue-booking-private-boundary.test.tsx
# → 2 files / 7 tests PASS
pnpm --filter @gobadminton/api exec vitest run test/unit/game-court-booking.test.ts
# → 7 tests PASS (unchanged unit surface)
pnpm --filter @gobadminton/web exec tsc --noEmit -p tsconfig.json   # PASS
pnpm --filter @gobadminton/api exec tsc --noEmit -p tsconfig.json   # PASS
pnpm --filter @gobadminton/web exec eslint \
  src/components/consumer/games/GameCourtBooking.tsx \
  src/components/consumer/pages/OwnedGameSummaryPage.tsx \
  test/game-court-booking.test.tsx \
  test/venue-booking-private-boundary.test.tsx   # PASS
pnpm --filter @gobadminton/api exec eslint \
  src/games/game-court-booking.service.ts   # PASS
```

**NOT RUN (honest):** disposable PostGIS compound
`game-court-booking.disposable.test.ts` (incl. new FOR SHARE race cases) —
author sandbox has no disposable DB; PMA reuses unchanged migration smoke + runs
compound. Also not run: full Product CI, live Docker, browser UAT, independent QA,
DEV install/smoke. Prior pass1 web 34 remain for untouched surfaces.

## Remaining gates

Independent Codex Sol Medium QA → Product CI → merge `dev` → server DEV ACCEPTED
→ release agent binds source SHA / receipt / UAT=NOT_TESTED. PROD not authorized.
Parent #386 / #373 remain canonical; #394 and full catalogue not DONE.
Author native DONE ≠ independent PASS / DEV / UAT.

## Known limits

- No platform booking/payments; status is organizer-declared only.
- No new model/High/Astra/AGENTS/runtime/PROD/controller repair.
- Mode B binding / AGY Author not claimed READY.
