# Handoff — #394 GAME+VENUE public comments (pass 4 independent QA repair)

**Assignment:** `OWNER_20261102_COMMENTS394_INDEPENDENT_QA_REPAIR`
**Author:** cursor:auto · attempt 4
**Base / exact candidate:** `24b0f86993cd709463ca8a6ff9d93dbc13c9a71d`
**Publication branch (trusted process only):** `owner/comments394-public-20261102`
**QA route:** codex_sol_medium (independent) · Product CI / DEV by trusted integrator
**Author does not claim QA / CI / DEV PASS.**

## Materials read (confirmed)

- `/tmp/gb-cursor-211-owner-quota-0wr4xbbk/data/design-inputs/final.txt` (Codex Medium FAIL · SHA `51c84d99…` · 3 findings F1–F3)

## Exact repair delivered (allowed paths only)

1. **F1 P1 page bind fence** (`CommentsSection.tsx`): every loaded page binds immutable kind/entity/actor+csrf read context; render hides count/list/mine/actions when bind or session mismatches **before effects** (no setPage-in-render). Responses accepted only under the exact bound fence. Harness test: load under A → render under B before effects; prior body/count/mine not visible.
2. **F2 P2 guest public reactivation** (`CommentsSection.tsx`): `gb-private-expired` / guest `gb-session-changed` with host `me=null` unchanged → clear auth-private surface, one bounded public guest re-read (no getMe / mutation replay / new keys). Stale in-flight GET rejected; fresh guest response accepted; sort + user retry restore public read. Existing late-2xx / CSRF / pending-id / corrupt-marker cases retained.
3. **F3 P2 canCreate projection** (`comments.service.ts` + UI + disposable): `canCreate` from active viewer + `account.access`/`profile.public` restrictions + game organizer block gate; guest false; read preserved. Composer only when `canCreate`; guest auth entry unchanged; authenticated read-only concise note (no login button / capability jargon). Write execute/replay checks unchanged. Disposable: restricted list `canCreate=false` + write 403; unrestricted true; guest false.

## Author verification commands / results

```bash
# web (related comments only)
../../node_modules/.bin/vitest run \
  test/comments-private-boundary.test.tsx test/comments.test.tsx
# → 2 files · 7 passed (5 boundary + 2 SSR) · exit 0

../../node_modules/.bin/tsc -p tsconfig.json --noEmit
# → exit 0

../../node_modules/.bin/eslint \
  src/components/consumer/comments/CommentsSection.tsx \
  test/comments-private-boundary.test.tsx test/comments.test.tsx
# → exit 0 · clean

# api (related type/lint only)
../../node_modules/.bin/tsc -p tsconfig.json --noEmit
# → exit 0

../../node_modules/.bin/eslint \
  src/comments/comments.service.ts \
  test/integration/comments.disposable.test.ts
# → exit 0 · clean
```

**NOT RUN by author:** disposable PostGIS / business DB compound (API `canCreate` projection changed — trusted PMA re-runs). Migration 0051 unchanged — no repeat. Root migration/type version/styling shell unchanged.

Reuse frozen (not re-run by author): migration0051 PASS · business DB compound on b696 PASS · web124 PASS.

## Unresolved / out of scope

- Independent Codex QA, Product CI, DEV ACCEPTED, Owner UAT=NOT_TESTED.
- No Git publication / merge / deploy by author.
- Disposable business compound: **not run** here — hand to trusted PMA (API `canCreate` projection changed; migration unchanged).
- Player-profile comments (pending Owner audience/opt-out).

## Allowed path diff (this repair)

- `apps/api/src/comments/comments.service.ts`
- `apps/api/test/integration/comments.disposable.test.ts`
- `apps/web/src/components/consumer/comments/CommentsSection.tsx`
- `apps/web/test/comments-private-boundary.test.tsx`
- `apps/web/test/comments.test.tsx` (unchanged expectations; lint path)
- `docs/handoffs/comments394-game-venue.md`
- `docs/product/COMMENTS_CONTRACT.md`
