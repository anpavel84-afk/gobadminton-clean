# Implementation · Friends S1 API

ID friends-dev-s1-api-20261013-v001; Owner Issue #12. Source-only; work in a new clean Git task worktree. No changes to PROD DB, production accounts, VPN or release.

Use current Germany DEV API/PostGIS state with 31 migrations and existing 20 synthetic users as compatibility truth. Historical Friends PR #198 (legacy source SHA 0562bf1d2dc9ed5fc17f044cacfcf2cb061da17d) contains additive migration 0032_friendship_core.sql and friends module/policy/service tests; reuse or rebase carefully onto current clean main, not blind cherry-pick.

Deliver friendship request/send, received list, outgoing list, accept/decline/cancel/unfriend; any block/revoke flags already in accepted social/privacy contract. Enforce actor identity from existing session, no impersonation by userId. Respect blocked accounts, profile discoverability/visibility, contact sharing preferences, deletion epochs, idempotency, duplicate requests, race conditions, concurrent accept, and request expiry.

Write atomic DB migrations and comprehensive unit/integration tests on disposable PostGIS; never copy real PROD user or token tables; no unsafe SQL writes. Mock or stub outbound notifications in synthetic DEV until user authorizes delivery.

Use existing games invitation contract without making friends auto-join a game, auto-reserve seats, or bypass host/manager permission. Preserve accepted player/radar privacy.

Receipt requirements: source branch in clean repo, exact candidate SHA + tree, modified paths and protected tests with exit codes, rollback for migration and two example synthetic accounts. No self-issued independent QA PASS. If Publisher write is unavailable, HOLD and state exact blocker rather than use Runner read-only deploy key to push.

Acceptance: clean API typecheck, contract tests, 0032 migration forward/rollback in disposable database, no unauthorized friend traversal, conflict/race tests. After QA, separate DEV-only deployment and browser flow.
