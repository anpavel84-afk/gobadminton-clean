# Handoff — #394 GAME+VENUE public comments (pass 5 own-menu write-cap repair)

**Assignment:** `OWNER_20261102_COMMENTS394_OWN_READONLY_MENU_REPAIR`
**Author:** cursor:auto · attempt 5
**Base / exact candidate:** `b6cbf467d97835b5fab477ce775a49e641817b78`
**Publication branch (trusted process only):** `owner/comments394-public-20261102`
**QA route:** codex_sol_medium (independent) · Product CI / DEV by trusted integrator
**Author does not claim QA / CI / DEV PASS.**

## Materials read (confirmed)

- `/tmp/gb-cursor-211-owner-quota-se9s4h6k/data/design-inputs/final.txt` (Codex Medium FAIL · SHA `b6cbf467…` · 1 finding P2 own Edit/Delete under canCreate=false)

## Exact repair delivered (allowed paths only)

1. **Own write menu gate** (`CommentsSection.tsx`): own Edit/Delete (and edit form / delete dialog) require bound `currentPage.canCreate`, same write capability as composer/replies. Own comment body stays readable. Independent author safety actions on other authors unchanged. Guest remains read-only. Stale open edit/delete chrome cleared when caps revoke. `admitMutation` rejects POST/PUT/DELETE when `!canCreate` (API unchanged; errors not suppressed).
2. **Boundary harness** (`comments-private-boundary.test.tsx`): extend with own comment under `canCreate=false` — body visible, own Edit/Delete absent, read-only note; allowed `canCreate=true` still shows Edit/Delete + composer. Prior guest / late-2xx / CSRF / pending-id / UNKNOWN / actor-bind cases preserved.
3. **Handoff** updated for this pass. No API / migration / layout / release / global-hook changes.

## Author verification commands / results

```bash
export PATH=/opt/gb-slots/runtime/node/bin:$PATH

# web (comments boundary + SSR only)
cd apps/web
../../node_modules/.bin/vitest run \
  test/comments-private-boundary.test.tsx test/comments.test.tsx
# → 2 files · 8 passed (6 boundary + 2 SSR) · exit 0

../../node_modules/.bin/tsc -p tsconfig.json --noEmit
# → exit 0

../../node_modules/.bin/eslint \
  src/components/consumer/comments/CommentsSection.tsx \
  test/comments-private-boundary.test.tsx
# → exit 0 · clean
```

**NOT RUN by author:** disposable PostGIS / business DB (API unchanged — no repeat). Migration unchanged. Root migration/type version/styling shell unchanged.

Reuse frozen (not re-run by author): migration0051 PASS · prior disposable/business evidence · prior web matrix on accepted base.

## Unresolved / out of scope

- Independent Codex QA, Product CI, DEV ACCEPTED, Owner UAT=NOT_TESTED.
- No Git publication / merge / deploy by author.
- Player-profile comments (pending Owner audience/opt-out).
- Prior 3 independent Medium findings remain accepted; original FAIL/history preserved.

## Allowed path diff (this repair)

- `apps/web/src/components/consumer/comments/CommentsSection.tsx`
- `apps/web/test/comments-private-boundary.test.tsx`
- `docs/handoffs/comments394-game-venue.md`
