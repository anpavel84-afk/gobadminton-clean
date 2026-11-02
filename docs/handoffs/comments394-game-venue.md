# Handoff — #394 GAME+VENUE public comments (pass 2 repair)

**Assignment:** `OWNER_20261102_COMMENTS394_DB_FIXTURE_SESSION_BOUNDARY_REPAIR`
**Author:** cursor:auto · attempt 2
**Base / exactclean candidate:** `76cef4d05db3afc306772431644e7a0e5326f862`
**Publication branch (trusted process only):** `owner/comments394-public-20261102`
**QA route:** codex_sol_medium (independent) · Product CI / DEV by trusted integrator
**Author does not claim QA / CI / DEV PASS.**

## Materials read (confirmed)

| Kind | Delivered path | sha256 |
|---|---|---|
| text | `…/disposable-comments.disposable.log` | `f63fa2c7d2c51d57a593e4ea4bf101bb9b1a4a056f43dfc398173b8311d376a2` |

Pass-1 genuine 24 web / 6 API unit / contract / type / lint proof retained. Real migration on disposable PostGIS PASS (prior). Comments DB compound failed BEFORE execution due fixture env (log above) — fixed in this pass without disabling validation/gates.

## Exact repair delivered

1. **Integration fixture** (`comments.disposable.test.ts`): isolated Admin simulation — `HOST=127.0.0.1`, `ADMIN_INTERNAL_ENABLED`, `ADMIN_ORIGIN=http://localhost:19494` (distinct from PUBLIC_WEB), dedicated `ADMIN_AUTH_PEPPER`, fingerprint ≥32 chars; restriction/moderation flags remain TRUE. DBnameguard intact. `env.ts` untouched.
2. **VenuePage getMe lifecycle**: expiry clears `me` + invalidates epoch, **no** getMe reload (no 401 loop). Session-changed clears then one fresh getMe fenced by epoch. Pattern matches accepted OwnedGameSummaryPage.
3. **CommentsSection**: local `sessionLive` + generation/actor/entity fences on root GET, reply GET, and mutation success/refresh; privileged drafts/menus cleared on both `gb-private-expired` and `gb-session-changed`; mutations denied under expired fence; no getMe. Host me/csrf boundary reactivates with fresh public read.
4. **Pending**: `holdCorruptStorage: true`; PUT/DELETE `validateSuccess` binds exact `pending.path` comment id. UNKNOWN storage not deleted on logout/expiry.
5. **Tests**: `comments-private-boundary.test.tsx` — VenuePage deferred getMe, CommentsSection late reply/mutation after fence, exact pending id validation. Existing 2 SSR `comments.test.tsx` unchanged.

## Author verification commands / results

```bash
pnpm --filter @gobadminton/web exec vitest run \
  test/comments-private-boundary.test.tsx test/comments.test.tsx
# → 5 passed (3 boundary + 2 SSR)

pnpm --filter @gobadminton/web exec tsc -p tsconfig.json --noEmit   # exit 0
pnpm --filter @gobadminton/api exec tsc -p tsconfig.json --noEmit   # exit 0

# Scoped eslint on allowed changed TS/TSX: clean

# Fixture loadEnv parse (no DB): FIXTURE_LOADENV_PASS admin+restrictions+moderation true, fingerprint len 43
```

Disposable PostGIS compound: `apps/api/test/integration/comments.disposable.test.ts`
Guard: `DATABASE_URL` → `/gobadminton_comments_disposable` (or hosted `gb-ci-394-2-timestamp` /gobadminton) + `RUN_DB_INTEGRATION=1`.
**DB status for this author pass:** NOT_RUN (no disposable PostGIS attached in author environment). Fixture env parse PASS only — do not claim DB PASS. Trusted PMA reruns real DB then independent Medium reviews.

## Unresolved / out of scope

- Player-profile comments (pending Owner audience/opt-out).
- Independent Codex QA, Product CI, DEV ACCEPTED, Owner UAT.
- No Git publication / merge / deploy by author.
- Release/migration/global unchanged audit not repeated (per assignment).

## Allowed path diff (this repair)

- `apps/api/test/integration/comments.disposable.test.ts`
- `apps/web/src/components/consumer/comments/CommentsSection.tsx`
- `apps/web/src/components/consumer/venues/VenuePage.tsx`
- `apps/web/test/comments-private-boundary.test.tsx` (new)
- `docs/handoffs/comments394-game-venue.md`
- `docs/product/COMMENTS_CONTRACT.md` (session-boundary note only if needed)
