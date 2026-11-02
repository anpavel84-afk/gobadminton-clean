# Handoff — #394 GAME+VENUE public comments (pass 3 settlement fence)

**Assignment:** `OWNER_20261102_COMMENTS394_FINAL_SETTLEMENT_FENCE_REPAIR`
**Author:** cursor:auto · attempt 3
**Base / exact candidate:** `b696bc35dbabfc494119c2779ff2ceddfd2a7f02`
**Publication branch (trusted process only):** `owner/comments394-public-20261102`
**QA route:** codex_sol_medium (independent) · Product CI / DEV by trusted integrator
**Author does not claim QA / CI / DEV PASS.**

## Materials read (confirmed)

None delivered for this pass (`input_materials: []`). Prior pass-2 fixture/DB/session evidence retained as history; not re-run.

## Exact repair delivered (allowed paths only)

1. **`validateSuccess` settlement fence** (`CommentsSection.tsx`): rejects when `sessionLive` is false or live kind/entity/actor+csrf identity mismatches — before shared `useSocialMutation` `save(null)`. Expiry/session-changed with unchanged `me.id` can no longer clear UNKNOWN on a valid mine 2xx. Raw frozen storage + same-key retry preserved; shared hook untouched.
2. **Auth identity ref + CSRF reactivation**: in-memory actor+csrf ref (not in storage keys/DOM/logs); captured in root GET, reply GET, validators, success/refresh callbacks. Effect deps include `hostCsrf` so same-actor reauth reactivates one fresh public read. Entity/actor prop boundary clears privileged surface synchronously. No getMe / full-page reload.
3. **Tests** (`comments-private-boundary.test.tsx`): after each expiry/session event assert captured `validateSuccess(valid mine 2xx)` is `false`; same-actor/new-csrf reactivates and rejects stale pre-boundary reply closure. Actual `isCommentView` from module (not hardcoded false). Exact pending comment-id + corrupt-storage hold tests preserved.

## Author verification commands / results

```bash
pnpm --filter @gobadminton/web exec vitest run \
  test/comments-private-boundary.test.tsx test/comments.test.tsx
# → 5 passed (3 boundary + 2 SSR) · exit 0

pnpm --filter @gobadminton/web exec tsc -p tsconfig.json --noEmit
# → exit 0

pnpm --filter @gobadminton/web exec eslint \
  src/components/consumer/comments/CommentsSection.tsx \
  test/comments-private-boundary.test.tsx
# → exit 0 · clean
```

API / migrations / OpenAPI / alpha15 / exact alpha14 seed: unchanged (not in allowed paths).
Prior FAIL/costs retained. No extra QA/model call by author.

## Unresolved / out of scope

- Independent Codex QA, Product CI, DEV ACCEPTED, Owner UAT.
- No Git publication / merge / deploy by author.
- Player-profile comments (pending Owner audience/opt-out).
- Disposable PostGIS / migration 0051 / web7: prior candidate evidence — not re-run this pass.

## Allowed path diff (this repair)

- `apps/web/src/components/consumer/comments/CommentsSection.tsx`
- `apps/web/test/comments-private-boundary.test.tsx`
- `docs/handoffs/comments394-game-venue.md`
