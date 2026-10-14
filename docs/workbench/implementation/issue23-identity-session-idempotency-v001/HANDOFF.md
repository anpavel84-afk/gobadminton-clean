# Issue #23 — Identity/session idempotency first slice

WORKING DRAFT — NOT APPROVED — NOT CANONICAL

From: implementation engineer. To: assigned PM/reviewer and independent QA.
Date: 2026-10-14. Status: READY_FOR_REVIEW; DB/TypeScript behavior UNVERIFIED locally.
Repository: `anpavel84-afk/gobadminton-clean`.
Assignment: [Clean issue #23](https://github.com/anpavel84-afk/gobadminton-clean/issues/23),
Owner direct first implementation slice.
Exact source/base: `55e3775cc284e4266f1537052e9a3260a73b79ef`.
Worktree: `/srv/gobadminton-clean/worktrees/chatops-issue23-idempotency-20261014`.
Branch: `fix/chatops-issue23-idempotency-20261014`.

Owner explicitly requires source-only changes, no commit/push. This artifact and
code remain uncommitted; no result commit/permalink exists and GitHub publication
has not occurred. The base source is
[exact revision](https://github.com/anpavel84-afk/gobadminton-clean/tree/55e3775cc284e4266f1537052e9a3260a73b79ef).
This handoff does not grant publication or release authority.

## Scope and source changes

- `apps/api/src/auth/auth.service.ts`: requireKey and global MutationRunner for
  provider unlink and single-session revoke; transaction-bound response projections.
- `apps/api/src/auth/identity.service.ts`: extract client-bound unlink retaining
  recent-auth, existing actor/method SQL locks and last usable OAuth/email protection;
  retain standalone transactional helper. Provider replay rechecks current own-account
  recent-auth policy; actor-scoped receipt + provider hash authorize the deleted target.
- `apps/api/src/auth/session.service.ts`: client-bound owned-session lock/revoke and
  active-session list; keep standalone helper. Revoke/presence removal/receipt share
  one transaction. Replay checks target ownership/audience/current-session exclusion.
- `packages/contracts/openapi.json`: exact cookie-only OAuth initiation marker and
  required Origin/CSRF declarations; both DELETEs require a key, with no request body.
- `scripts/check_foundation.py`, `scripts/test_check_foundation.py`: narrowly bound
  OAuth-initiation exemption and contract mutation negatives; admin rules unchanged.
- `apps/api/test/integration/account-security.controls.test.ts`: valid keys on existing
  happy/conflict paths; security, concurrent duplicates, target/context reuse,
  last-method race, exact snapshots, no repeated effect after relink, ownership replay,
  recent-auth replay, receipt-failure rollback (including radar presence), revoked
  session/inactive actor rejection before replay, actual OAuth binding/state tests.
- `apps/api/test/integration/email-auth.foundation.test.ts`: valid keys preserve
  OAuth/email last-method happy paths and independent-key provider race semantics.
- `apps/api/test/unit/auth-security.test.ts`: update direct constructor fixtures for
  global services; existing security tests retained.
- `docs/api/API_POLICY.md`: actual semantics and limitations, including OAuth edge
  auth vs callback locks, one-time state consumption before exchange, optional
  legacy returnPath fallback, stale authorized snapshots and session-relative hash.

Web `apiFetch` inspected: adds a fresh key to every non-GET/HEAD call and preserves
an explicit key. No web caller/client/visual changes are needed. No avatar handler,
gate, migration, environment, Docker, policy, sudo, SSH, DEV/PROD SQL or deployment
changes. No new architecture or global mutation/fence changes.

## Verification and limits

FACT — executed locally:

- `python3 -B scripts/test_check_foundation.py`: 7 tests passed.
- `python3 -B scripts/test_email_contract_policy.py`: 1 test passed.
- `python3 -B scripts/check_foundation.py`: exit 1 with exactly two blocking findings:
  `PUT /me/avatar` and `DELETE /me/avatar` need required Idempotency-Key. No other
  contract/body/doc findings. This is expected residual failure, not foundation PASS.
- `git diff --check`: passed.

Typecheck/lint/Vitest/DB integration NOT RUN: no suitable node_modules in the
sandbox; no package install. These await hosted GitHub CI. Tests remain on the
existing disposable PostGIS harness; no SQL was executed in this task.
Self-review and static checks are not independent QA or deployment/acceptance.

## Next bounded action and rollback

Assigned reviewer/QA: review this uncommitted diff, then run hosted API typecheck,
lint, unit tests and integration tests against disposable PostGIS when publication
is separately authorized. Preserve both avatar findings as release blockers; do
not advance automatically to avatar implementation or deploy this slice.

Rollback: restore only this slice's listed source/doc changes to the exact base,
and remove this new draft handoff, after preserving any later unrelated edits.
No database rollback is needed: no schema/data/deployment change was performed.
