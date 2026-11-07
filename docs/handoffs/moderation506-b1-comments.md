# Handoff — #506 MOD-V2-B1a public comment gate (B1a repair19 claim-owner / unknown)

## Assignment

- Issue: #506 continuation (`OWNER506_B1A_EXACT_CLAIM_OWNER_UNKNOWN_PROVIDER_NO_REPLAY`)
- Base reviewed FAIL: `2e8c70fedff02c9f4da8e75e3808c18c2096a106` (Sol Medium QA18 HIGH retained)
- Author: Cursor Auto
- Scope: bounded repair of QA HIGH — claimExternalOnce TTL reclaim of processing/unknown + missing claim-owner fencing on complete/release
- Not claimed: B1b/B2/C/D, #507 Done, PROD, release metadata/deploy, UI406/release46 frozen branch

## Prior independent QA (retained)

1. First Sol Medium FAIL on `d0240f4…`: rollback CHECK narrowing + concurrent same-key provider race — **resolved** in prior repair; receipts retained.
2. QA18 HIGH on `2e8c70f…`: after 120s, `claimExternalOnce` deleted a processing claim even for UNKNOWN provider outcome and allowed another paid same-key attempt; no ownership token so late original complete/release could mutate a replacement claim.

## What changed (this repair)

- `migrations/0062_content_moderation_comments.sql`: additive `idempotency_records.claim_nonce` + `reservation_state` allowlist includes `unknown`; widened `state_fields_chk`. Comment surfaces CHECKs unchanged in meaning.
- `migrations/rollback/0062_…`: still non-destructive — removes only migration marker; **retains** claim_nonce, unknown allowlist, expanded moderation CHECKs and history.
- `MutationRunner.runWithExternalPrepare`:
  - Inserts opaque `claim_nonce` on claim; `completeExternalOnce` / `releaseExternalClaim` require exact nonce (owner fencing). Soft TTL is observational only — **never** deletes processing/unknown on clock advance.
  - Reclaim path deletes only expired **completed** receipts (aligned with `IdempotencyService`).
  - Provider **503** seals `reservation_state=unknown` with durable 503 body (conservative, non-publishing); same-key retry replays 503 without a second paid prepare. Known 4xx still releases for correction.
  - Late original with wrong/replaced nonce cannot complete or release; multi-instance authority remains Postgres UNIQUE row; no I/O under DB locks.
- Unit regressions: TTL-after-503 no second prepare; wrong-owner complete/release; preserved CIP / hash-mismatch / replay / 4xx-release.
- `schema.ts`: `claimNonce` column. Handoff updated. No fictitious releases / old receipt mutation.

## Checks run by author

- API unit: `mutation-runner` (+ new regressions), related comments/text-moderation as applicable.
- API `tsc --noEmit` and eslint on touched source/tests.
- Disposable DB integration / populated rollback: parent runs actual DB; author env may lack disposable Postgres.
- No real provider, live DEV/PROD DB, paid analysis, release, or independent QA claim.

## Remaining / next

- Independent QA **delta only** against this HIGH (prior rollback/concurrent findings stay resolved on record).
- Mandatory product CI + guarded DEV release/smoke still required before B1a DONE.
- Owner UAT = NOT_TESTED until Owner tests.
- B1b / B2 / C / D and #507 remain future; private egress OFF; M1 unchanged.
- Source A45 unchanged reuse; no app version/history/deploy edits here.
