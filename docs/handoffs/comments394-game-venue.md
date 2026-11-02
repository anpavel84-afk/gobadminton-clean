# Handoff — #394 experience-policy guard (narrow VENUE close)

**Assignment:** `OWNER_20261102_COMMENTS394_EXPERIENCE_POLICY_GUARD`
**Author:** cursor:auto · attempt 9
**Base:** `670dffcdce4cce5872f745a3120f27c5756387e8` (exact Owner assignment base)
**Publication branch (trusted process only):** `owner/comments394-experience-policy-20261102`
**QA route:** codex_sol_medium (independent delta) · Product CI / DEV by trusted integrator
**Author does not claim QA / CI / DEV PASS. Owner UAT=NOT_TESTED. source_sha:null for prospective alpha.15.**
**Scope this attempt:** CURRENT_NAMED_RELEASE user-facing Russian prose wording repair + short handoff only.

## Attempt 9 repair (allowed paths only)

1. **CI web FAIL preserved:** `releases.test.tsx` assertion `currentProse` must not match `/PROD остаётся alpha\.2|не развёрнут|не установлен/i` — matched user-facing limitation «…этим кандидатом не установлены» (CI run 41432385143; 1435 other web tests PASS).
2. **releases.ts only:** reword CURRENT_NAMED_RELEASE `known_limitations` — remove Cases/PG3/#394/technical install phrasing; avoid brittle «не установлены»; state plainly: venue reviews await attendance confirmation + disputed-mark resolution; player feedback stays private (not a public profile wall); Owner UAT not done; full post-game review flow unfinished. Keep game Q&A addition and closed venue publication fix. No version/history/source_sha change; no gates/tests weakened.
3. Prior FAIL/history/expenses/UNKNOWN preserved; backend/API/UI/reviewguards/disposable already independent QA3 PASS — not re-audited.

## Materials read (confirmed)

- CI web failure excerpt `ci-web-failure-excerpt.txt` — sha256 `6caaef743c608aa1a172c53febf4ff023d48675fea6379380650c7d2b28df912`
- Prior QA1/QA2 FAIL + attempts 6–8 history preserved below (not erased)

## QA1 FAIL preserved (exact)

- **Verdict:** FAIL · **reviewed_sha:** `e3a284c732f96d284f105d607ee07a32fbee2166`
- **P2** `apps/api/src/comments/comments.service.ts` ~418: same-key SUCCESS DELETE replay of own already-tombstoned legacy VENUE comment returned 404 because `authorizeReplay` called `lockOwnedLiveComment` (rejects deleted rows). Violates idempotent withdrawal. Disposable test covered only first delete.
- **Repair required:** DELETE authorizeReplay must recognize OWN tombstone + current public parent and return saved receipt for SAME key; keep MutationRunner session/capability fences; new DELETE key on tombstone must not create another revision; do not loosen create/update guards; add addressed same-key delete replay in disposable test.

## QA2 FAIL preserved (exact)

- **Verdict:** FAIL · **reviewed_sha:** `84a1a320e43df7f20ce23b40a25d802b96e1f4c0`
- **P2** `apps/api/test/integration/comments.disposable.test.ts` ~421: pre-policy SUCCESS replay fixture manually INSERTed a completed idempotency receipt with an arbitrary comment id, without a successful mutation / matching `entity_comments` row. Does not prove replay of a real prior SUCCESS write.
- **Repair required:** In disposable test, create legacy VENUE comment + SUCCESS receipt in one successful operation via existing `MutationRunner` and `IdempotencyService`, then same-key HTTP request must fail under current guard.
- **QA2 checks noted:** DELETE replay owner/tombstone/public-parent/session/capabilities OK; disposable PostGIS evidence then had 1 PASS for same-key DELETE; release edit already accepted; backend code accepted after QA2 — latest issue is fixture-only.

## Attempt 8 repair (allowed paths only)

1. **Disposable test only:** replaced hand-fabricated `idempotency_records` INSERT with `app.get(MutationRunner).runIdempotent` + `IdempotencyService` hashes. Execute inserts real venue root + matching private audit revision and returns status 201 `CommentView` for that row; receipt completes in the same MutationRunner transaction. Asserts receipt id/hash/status match persisted comment+audit; same-key HTTP POST → `403 COMMENT_VENUE_WRITES_CLOSED` without a second row/revision; GET (list + thread) hides the fixture. Prior create/update 403 retries, same-key DELETE replay, no duplicate tombstone audit, foreign negative, and direct-seeded legacy GET/withdrawal assertions kept.
2. **No production / release edits** this attempt (backend already accepted after QA2).
3. This handoff appends attempt 8 without overwriting QA1/QA2 FAIL history.

## Prior attempt 7 (preserved)

**Base then:** `e3a284c732f96d284f105d607ee07a32fbee2166` → candidate `84a1a320…`
1. **DELETE authorizeReplay** (`comments.service.ts`): uses `lockOwnedTombstonedComment` then `lockAndAssertPublicParent`. Execute still `lockOwnedLiveComment`. Create/update guards unchanged.
2. Disposable: same-key SUCCESS venue DELETE replay; misleading create/update comments fixed; pre-policy create SUCCESS receipt was still manually seeded (QA2 P2).
3. CURRENT_NAMED_RELEASE Russian user-facing notes; `source_sha: null`, `owner_uat: NOT_TESTED`; alpha.14 seed unchanged.

## Prior attempt 6 (preserved)

**Base then:** `d5bad5bdec556f029c49f89524fe0aa28f5ca8fc` → candidate `e3a284c7…`
1. API fail-closed broad VENUE create/reply/update + authorizeReplay → `COMMENT_VENUE_WRITES_CLOSED`. GET venue empty / `canCreate:false`. Owned delete left on live-lock path (QA1 P2). GAME Q&A unchanged.
2. VenuePage placeholder; contract/style/alpha15 notes; disposable deny cases.
3. Author unit/web checks exit 0; disposable PostGIS NOT_TESTED in that worktree (no disposable DB).

## Author verification commands / results (attempt 9)

```bash
export PATH=/opt/gb-slots/runtime/node/bin:$PATH
pnpm install --offline --frozen-lockfile --ignore-scripts
# → ERR_PNPM_NO_OFFLINE_TARBALL (next-16.3.8.tgz missing from store); node_modules absent.
# Addressed vitest releases.test.tsx + releases-server.test.ts → NOT_TESTED here (deps unavailable).
# Trusted PMA has store/deps and will run addressed tests after import.
# Local deterministic prose regex check vs CI assertion patterns → ALL PASS
#   (комментар; игр|площадк; forbid Safety/PG-4/PG-3/PROD/не установлен/Cases/#394; приёмк).
# Input material sha256 match: 6caaef743c608aa1a172c53febf4ff023d48675fea6379380650c7d2b28df912
# No broad web matrix; no API/disposable re-run this attempt.
# Version 0.1.0-alpha.15 / source_sha:null / history seed unchanged.
```

## Author verification commands / results (attempt 8 — preserved)

```bash
export PATH=/opt/gb-slots/runtime/node/bin:$PATH
# Worktree has no node_modules (network install forbidden).
# vitest/tsc → NOT_TESTED here (binaries absent).
# Input material sha256 match TASK_DATA:
#   final.txt fb65064f1224467510f56f12194656a82204e78dfc249164ea6f7b5aac57abd2
# Disposable PostGIS → NOT_TESTED: RUN_DB_INTEGRATION/DATABASE_URL unset; no local gobadminton_comments_disposable.
# Trusted PMA required after import: empty disposable schema + addressed comments.disposable.test.ts
#   (MutationRunner legacy create receipt + same-key 403 + GET hide + DELETE replay suite);
# then independent delta QA + Product CI + DEV. Do not invent runtime DB PASS.
```

## Unresolved / residual #394

- Independent delta QA after prose repair; Product CI; server DEV smoke / DEV ACCEPTED; Owner UAT=NOT_TESTED.
- Full experience-review / attendance eligibility UI / public venue writing — out of this pass; not claimed available.
- No Git publication / merge / deploy / PROD by author.
- Prior FAIL/history/expenses/UNKNOWN preserved; old admissions not rewritten.

## Allowed path diff (this repair / attempt 9)

- `apps/web/src/lib/releases.ts`
- `docs/handoffs/comments394-game-venue.md`
