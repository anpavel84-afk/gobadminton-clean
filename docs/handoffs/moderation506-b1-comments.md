# Handoff — #506 MOD-V2-B1a public comment gate (B1a bounded QA repair)

## Assignment

- Issue: #506 continuation (`OWNER506_B1A_BOUNDED_QA_ROLLBACK_CONCURRENT_IDEMPOTENCY_FIX`)
- Base reviewed FAIL: `d0240f4b91babdbb1ead1f4cbbd98b5836de6d9e` (Sol Medium first QA receipt retained)
- Author: Cursor Auto
- Scope: bounded repair of QA HIGH rollback + QA MEDIUM concurrent same-key provider race only
- Not claimed: B1b/B2/C/D, #507 Done, PROD, release metadata/deploy

## Prior independent QA (retained)

Sol Medium FAIL on `d0240f4…`:

1. HIGH — `rollback/0062` restored 0061 CHECKs that reject real `comment_body` / `entity_comment` rows after publication; empty-DB smoke missed this.
2. MEDIUM — concurrent same-key create/update both missed `findReplay` and called `approveTexts` before key reservation; `runIdempotent` resolved too late.

## What changed (this repair)

- `migrations/rollback/0062_content_moderation_comments.sql`: additive/non-destructive. Removes only the `schema_migrations` marker. **Retains** expanded CHECK allowlists and all approval/binding/comment rows. Documented: narrowing to 0061 would lose/reject retained B1a publication history; original A surfaces remain valid under the kept expanded CHECKs. Re-apply of `0062` is an idempotent widen.
- `MutationRunner.runWithExternalPrepare`: durable same-key `processing` claim committed **before** external prepare; prepare runs with no DB/advisory lock held; final fence re-locks the claim and completes. Concurrent same hash → `COMMAND_IN_PROGRESS` (no provider). Different payload same key → `IDEMPOTENCY_KEY_REUSED` before prepare. Known 4xx releases the claim; `503` keeps it until finite TTL (120s) so same-key retries do not blindly re-enter paid provider work. Multi-instance: Postgres UNIQUE row is the cross-worker fence (not process-local only).
- `CommentsService.create` / `update`: use `runWithExternalPrepare` (authorize preflight → `approveTexts` inside prepare; final publication fence unchanged). Delete unchanged.
- `public-comment-moderation.test.ts`: self-contained Admin recipe (`HOST=127.0.0.1`, `ADMIN_INTERNAL_ENABLED`, isolated `ADMIN_ORIGIN`/`ADMIN_AUTH_PEPPER`) like `comments.disposable.test.ts`; adds concurrent same-key race with provider deliberately blocked (assert ≤1 provider attempt + CIP + replay + hash mismatch).
- `migration.smoke.test.ts`: populated comment approval/binding rows + rollback + re-apply; expects retained `comment_body` / `entity_comment` compatibility.
- Unit: `mutation-runner.test.ts` for claim/CIP/replay/hash-mismatch paths.

## Checks run by author

- API unit: `mutation-runner` 3, `text-moderation` 4, `comments` 6 — PASS.
- API `tsc --noEmit` and eslint on touched source/tests — PASS.
- Disposable DB integration / populated rollback / concurrent provider-block race: not run here (no disposable Postgres in author env); parent runs exact disposable + populated rollback.
- No real provider, live DEV/PROD DB, paid analysis, release, or independent QA claim.

## Remaining / next

- Independent QA delta only (findings against this repair); first FAIL receipt stays on record.
- Mandatory product CI + guarded DEV release/smoke still required before B1a DONE.
- Owner UAT = NOT_TESTED until Owner tests.
- B1b / B2 / C / D and #507 I1 remain future; venue comments stay CURRENT closed pending #507.
- Source A45 unchanged reuse; no image M1 rewrite; no private egress; no app version/history edits here.
