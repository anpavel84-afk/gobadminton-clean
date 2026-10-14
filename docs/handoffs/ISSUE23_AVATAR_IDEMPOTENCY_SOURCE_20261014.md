# Issue #23 — avatar keyed mutation source handoff

WORKING DRAFT — NOT APPROVED — NOT CANONICAL

- From: Codex implementation; To: Issue #23 integrator / hosted CI / independent QA.
- Date: 2026-10-14. Status: source prepared; TypeScript/runtime behavior UNVERIFIED.
- Assignment: Owner direct, avatar-only source slice for [Clean issue #23](https://github.com/anpavel84-afk/gobadminton-clean/issues/23).
- Exact base/unchanged HEAD: [`55e3775cc284e4266f1537052e9a3260a73b79ef`](https://github.com/anpavel84-afk/gobadminton-clean/tree/55e3775cc284e4266f1537052e9a3260a73b79ef).
- Branch: `fix/chatops-issue23-avatar-20261014`.
- Worktree: `/srv/gobadminton-clean/worktrees/chatops-issue23-avatar-20261014`.
- Owner effect ceiling: no commits, pushes, deployment, runtime DB/host changes,
  network dependency installation, or writes to the parallel agent's paths.
  This file is local and uncommitted; its GitHub representation and exact candidate
  permalink must be supplied by the authorized integrator. No publication is claimed.

## Implementation for review

PUT and DELETE require the existing IdempotencyService key validation in their
controller after cookie Origin/CSRF/session checks. Both commands use the shared
`profiles.avatar.mutate` scope, so changing action under the same actor/key is
`409 IDEMPOTENCY_KEY_REUSED`. The request hash includes action, owning actor target,
numeric X-Profile-Version, MIME, and SHA-256 over the original binary upload.
Random storage keys and sanitized derivatives do not define command identity.

MutationRunner now exposes a non-reserving `findReplay` preflight using the same
actor/session and capability fences and replay authorization as final execution.
A miss commits no reservation. A hit returns the saved status/JSON body without
decode, moderation, staging, profile CAS or projection regeneration. Avatar's
response status remains 200. Current account/session authorization always precedes
reading a saved private result. Existing receipt TTL and final DB retry policy apply.

The upload generation/version snapshot precedes preflight, so a committed same-key
receipt wins over a stale snapshot. Moderation, filesystem creation, fsync and the
on-disk fingerprint input read occur outside actor/profile-locked transactions.
Final MutationRunner execution fences the current session again, reserves or
replays, checks profile version/generation, binds moderation, publishes metadata,
removes the stage journal and completes the receipt in one transaction. Rollback
removes both metadata effects and reservation/completion. Technical retries reuse
the already staged file and approval; they do not repeat external preparation.

Staging uses the existing durable avatar_media_gc journal, inserted before disk
creation. Staging I/O holds only its journal row, never an actor/profile lock.
Collector transactions take the same journal lock with SKIP LOCKED and recheck
references before unlink. Final publication requires and locks the journal row;
a stage already collected cannot publish a missing file. Concurrent preparation
retains the existing two upload slots per API process. Normal losers/rollbacks
make their journal immediately due and attempt cleanup, while interrupted staging
retains its one-hour journal and scheduled cleanup. Ambiguous COMMIT never causes
unconditional file deletion; referenced possibly committed files remain protected.

This provides exactly-once **committed metadata**, within the existing receipt
lifetime. Overlapping requests can still independently perform moderation and
create temporary files before one wins the final transaction. No exactly-once
claim is made for upstream calls or uncommitted filesystem preparation.

## Exact edited files

1. `apps/api/src/profiles/avatar.controller.ts`
2. `apps/api/src/profiles/avatar.service.ts`
3. `apps/api/src/common/idempotency.service.ts`
4. `apps/api/src/common/mutation-runner.service.ts`
5. `apps/api/test/unit/avatar-image.test.ts`
6. `apps/api/test/integration/avatar-upload.test.ts`
7. `apps/api/test/integration/avatar-moderation.test.ts`
8. `docs/handoffs/ISSUE23_AVATAR_IDEMPOTENCY_SOURCE_20261014.md`

Existing successful avatar commands and version-race tests now supply realistic
keys. Their previous negative assertions remain. The stale-stage retryable GC
test explicitly injects one cleanup outage, because successful normal cleanup now
collects losers immediately. The ambiguous-COMMIT fault shim triggers on the
publication COMMIT, not the new preflight COMMIT.

Added coverage includes missing/short/long keys, valid boundary key lengths,
upload and DELETE exact JSON/status replay without extra version increments,
replay after replacement/restart, original bytes/MIME/version/action mismatch,
same-key concurrent uploads/deletes, losing-stage collection, CSRF/Origin on replay,
edge and direct-service revoked/inactive actor rejection, moderation failures with
no receipt, rollback after writing a completed receipt, and a collected stage that
must fail publication. Unit coverage exercises non-reserving authorized preflight.

## Verification facts and limits

- `git diff --check`: passed at final source review.
- `python3 scripts/test_check_foundation.py`: passed, 5 tests.
- `python3 scripts/check_foundation.py`: exit 1, exactly the five baseline missing
  Idempotency-Key declarations: linked-provider link, linked-provider DELETE,
  session DELETE, avatar PUT and avatar DELETE. No new findings. OpenAPI and
  Foundation scanner are intentionally untouched; their integration is separately owned.
- Root and API `node_modules` are absent, including local tsc/Vitest executables.
  No dependencies were installed. Typecheck, lint, avatar unit/integration tests
  were **not run** and have no PASS claim.
- No migration runner, database connection, runtime service, host configuration,
  deployment command, GitHub write, commit or push was executed.
- These are author checks, not independent QA or acceptance evidence.

Forbidden paths remain unchanged: `packages/contracts/openapi.json`,
`scripts/check_foundation.py`, `docs/api/API_POLICY.md`, `apps/api/src/auth/**`,
`apps/web/**`, workflows and host/DEV/PROD configuration. Existing business-key
Foundation findings remain for their assigned integration owners.

## Next bounded action and rollback

Integrator: review and integrate these eight files together with separately owned
Issue #23 contract/auth changes, publish this handoff with an exact candidate SHA,
then run hosted API typecheck/lint and the existing avatar unit and two integration
files. Integration tests migrate/write their configured DB and therefore require
the disposable CI database; do not run them against DEV/PROD. Independent QA must
confirm the real concurrency/GC behavior before release claims.

Rollback before integration is removal of this isolated source diff, preserving
any subsequent integrator edits. No schema/data/runtime rollback is needed for
this source-only delivery. No next product slice or deployment is authorized here.
