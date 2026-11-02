# Handoff — #394 experience-policy guard (narrow VENUE close)

**Assignment:** `OWNER_20261102_COMMENTS394_EXPERIENCE_POLICY_GUARD`
**Author:** cursor:auto · attempt 6
**Base:** `d5bad5bdec556f029c49f89524fe0aa28f5ca8fc` (merged PR465 broad VENUE superseded before DEV install)
**Publication branch (trusted process only):** `owner/comments394-experience-policy-20261102`
**QA route:** codex_sol_medium (independent) · Product CI / DEV by trusted integrator
**Author does not claim QA / CI / DEV PASS. Alpha15 not accepted. Live remains alpha14.**

## Materials read (confirmed)

- `OWNER_DIRECTION.md` (Owner 02 Nov attendance/experience clarification)
- `RECOMMENDATION.md` / **FIRST section** of `CURSOR_BRIEF.md` (bounded repair only; subsequent Cases design = proposal OUTSIDE THIS PASS)
- Proposal mock scene-4 (not installed): https://files.anpavel.ru/projects/gobadminton/design/style-guide/reviews/20261102-astra-v1/index.html

## Exact repair delivered (allowed paths only)

1. **API fail-closed broad VENUE** (`comments.service.ts`): create/reply/update + authorizeReplay → `COMMENT_VENUE_WRITES_CLOSED`. GET venue list after public parent + normal params → empty page / `canCreate:false` (no legacy row/count/reply/identity leak). Owned delete/withdrawal unchanged (auth/version/idempotency/tombstone). GAME Q&A fences unchanged. No attendance fabrication.
2. **VenuePage**: remove broad `CommentsSection`; `SurfacePanel` placeholder «Отзывы после игр появятся здесь». Contacts/gallery/map intact.
3. **Contract / style / handoff / alpha15 notes**: GAME = public questions; VENUE broad writer closed pending postgame eligibility; PG3 private; proposal link marked proposed vs installed. Preserve alpha14 receipt; `source_sha: null` for prospective alpha15.
4. **Tests**: disposable cases for venue create/reply/update/replay deny, seeded legacy GET hide, owned delete vs foreign 404, GAME path preserved; web VenuePage no composer + game CommentsSection unaffected; private-boundary VenuePage placeholder.

## Author verification commands / results

```bash
export PATH=/opt/gb-slots/runtime/node/bin:$PATH

# api unit
cd apps/api && ../../node_modules/.bin/vitest run --project unit test/unit/comments.test.ts
# → 1 file · 6 passed · exit 0

# web addressed
cd apps/web && ../../node_modules/.bin/vitest run \
  test/comments.test.tsx test/comments-private-boundary.test.tsx
# → 2 files · 9 passed · exit 0

# typecheck + eslint on touched paths → exit 0

# disposable PostGIS comments.disposable.test.ts
# → NOT_TESTED by author: RUN_DB_INTEGRATION / DATABASE_URL unset (no disposable DB in this worktree).
#   Trusted PMA should run on empty gobadminton_comments_disposable.
```

## Unresolved / residual #394

- Full experience-review / Cases / attendance eligibility UI — **out of this pass** (proposal only).
- Independent Codex QA, Product CI, DEV ACCEPTED, Owner UAT=NOT_TESTED.
- No Git publication / merge / deploy by author.
- Cancelled DEV `41424816628` never installed; do not claim alpha15 accepted.
- Prior FAIL/history/expenses/UNKNOWN preserved; old admissions not rewritten.

## Allowed path diff (this repair)

- `apps/api/src/comments/comments.service.ts`
- `apps/api/test/integration/comments.disposable.test.ts`
- `apps/api/test/unit/comments.test.ts` (unchanged expectations; GAME unit transport retained)
- `apps/web/src/components/consumer/venues/VenuePage.tsx`
- `apps/web/test/comments.test.tsx`
- `apps/web/test/comments-private-boundary.test.tsx`
- `apps/web/src/lib/releases.ts`
- `docs/releases/CHANGELOG.md`
- `docs/product/COMMENTS_CONTRACT.md`
- `docs/product/COMMENTS_STYLE_GUIDE.md`
- `docs/handoffs/comments394-game-venue.md`
