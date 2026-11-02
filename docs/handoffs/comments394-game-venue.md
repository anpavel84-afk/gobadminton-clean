# Handoff — #394 experience-policy guard (narrow VENUE close)

**Assignment:** `OWNER_20261102_COMMENTS394_EXPERIENCE_POLICY_GUARD`
**Author:** cursor:auto · attempt 7
**Base:** `e3a284c732f96d284f105d607ee07a32fbee2166` (exact Owner assignment base)
**Publication branch (trusted process only):** `owner/comments394-experience-policy-20261102`
**QA route:** codex_sol_medium (independent delta) · Product CI / DEV by trusted integrator
**Author does not claim QA / CI / DEV PASS. Owner UAT=NOT_TESTED. source_sha:null for prospective alpha.15.**

## Materials read (confirmed)

- Independent Medium QA1 `final.txt` (reviewed_sha `e3a284c7…`, verdict **FAIL**, one P2)
- Release-agent note `alpha15-release-notes-readonly-review.md` (editorial only)
- Prior handoff attempt 6 evidence preserved below (not erased)

## QA1 FAIL preserved (exact)

- **Verdict:** FAIL · **reviewed_sha:** `e3a284c732f96d284f105d607ee07a32fbee2166`
- **P2** `apps/api/src/comments/comments.service.ts` ~418: same-key SUCCESS DELETE replay of own already-tombstoned legacy VENUE comment returned 404 because `authorizeReplay` called `lockOwnedLiveComment` (rejects deleted rows). Violates idempotent withdrawal. Disposable test covered only first delete.
- **Repair required:** DELETE authorizeReplay must recognize OWN tombstone + current public parent and return saved receipt for SAME key; keep MutationRunner session/capability fences; new DELETE key on tombstone must not create another revision; do not loosen create/update guards; add addressed same-key delete replay in disposable test.

## Attempt 7 repair (allowed paths only)

1. **DELETE authorizeReplay** (`comments.service.ts`): uses `lockOwnedTombstonedComment` (own + `deleted_at` set) then `lockAndAssertPublicParent`. Execute still uses `lockOwnedLiveComment` (new key on tombstone → 404, no extra revision). Create/update guards unchanged / still paired with `assertBroadVenueWriteClosed`.
2. **Disposable test**: same-key SUCCESS venue DELETE replay → equal receipt/status/version, single tombstone audit; new key on tombstone + foreign stay 404. Misleading “authorizeReplay success” comments on create/update 403 retries corrected; one pre-policy SUCCESS `comments.create` receipt seeded via `IdempotencyService` hashes + `idempotency_records` fixture proves current create authorizeReplay denies with `COMMENT_VENUE_WRITES_CLOSED`.
3. **CURRENT_NAMED_RELEASE only**: concise Russian user-facing additions/fixes; removed static «alpha.15 не принята — live alpha.14»; `source_sha: null`, `owner_uat: NOT_TESTED` kept. Alpha.14 accepted seed in `TRUSTED_HISTORICAL_SEED` unchanged.
4. This handoff appends attempt 7 without overwriting prior FAIL/history.

## Prior attempt 6 (preserved)

**Base then:** `d5bad5bdec556f029c49f89524fe0aa28f5ca8fc` → candidate `e3a284c7…`
1. API fail-closed broad VENUE create/reply/update + authorizeReplay → `COMMENT_VENUE_WRITES_CLOSED`. GET venue empty / `canCreate:false`. Owned delete left on live-lock path (P2 above). GAME Q&A unchanged.
2. VenuePage placeholder; contract/style/alpha15 notes; disposable deny cases.
3. Author unit/web checks exit 0; disposable PostGIS NOT_TESTED in that worktree (no disposable DB).

## Author verification commands / results (attempt 7)

```bash
export PATH=/opt/gb-slots/runtime/node/bin:$PATH
# Worktree has no node_modules (network install forbidden in this pass).
# vitest/tsc → NOT_TESTED here (binaries absent). Static review of allowed-path edits only.
# Input materials sha256 match TASK_DATA:
#   final.txt 0cb0a81d21bc55d460c48affedb5e8408c4998633a22c8df69e1737e324f4caf
#   alpha15-release-notes-readonly-review.md 2ec93986b9124b1ee8fa068696380649babca6ffe3010bef4d46cb06a7cdc6ab
# Disposable PostGIS → NOT_TESTED: RUN_DB_INTEGRATION/DATABASE_URL unset.
# Trusted PMA required: empty gobadminton_comments_disposable + same-key DELETE replay +
# pre-policy create SUCCESS-receipt deny; then independent delta QA + Product CI + DEV.
```

## Unresolved / residual #394

- Independent delta QA after this repair; Product CI; server DEV smoke / DEV ACCEPTED; Owner UAT=NOT_TESTED.
- Full experience-review / Cases / attendance eligibility UI — out of this pass.
- No Git publication / merge / deploy / PROD by author.
- Prior FAIL/history/expenses/UNKNOWN preserved; old admissions not rewritten.

## Allowed path diff (this repair / attempt 7)

- `apps/api/src/comments/comments.service.ts`
- `apps/api/test/integration/comments.disposable.test.ts`
- `apps/web/src/lib/releases.ts`
- `docs/handoffs/comments394-game-venue.md`
