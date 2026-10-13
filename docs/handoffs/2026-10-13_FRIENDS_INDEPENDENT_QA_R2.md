# Independent Friends QA, 2026-10-13

Executed independently on original Germany vmi3510488 using Desktop Commander root session. No Runner queue completion, deployment, protected evidence or author CI approval is claimed.

Exact original PR20 source: SHA 08a68a2b5ae861f22e7d440a01e32d14496a68fe, tree 24aa4ff7472a56bb1e59b3d005c34167b909ac07. Extracted git archive to /tmp/friends-independent-qa-20261013/source; reused dependencies read-only by symlink, portable Nest decorator transformer copied as QA instrumentation. Node24.21.0, Vitest3.2.7.

Original source tests independently executed: 22 unit PASS (PID3069586), 32 disposable PostGIS integration PASS (PID3072119). This coverage missed actual defect. Enhanced prepared regression tests against original product source: 4 FAIL,30 PASS (PID3077510). Failure: existing relationship serializes capabilities.canRequest=false after remove/block-unblock, decline, cancel and TTL expiration despite permitted fresh request. Original SHA fails independent regression QA.

Already prepared Germany source repair copied only into temporary archive: 57 PASS (23 unit,34 integration), PID3082317. This patch has no published candidate SHA; approval requires exact published SHA retest. Tracked diff SHA256 0c975123ad4ec49f040507acade1d2bf7c43dab510f2e7d540f9d21ef5bdd2c4.

Minimal publication paths:
- apps/api/src/friendships/friendships.policy.ts
- apps/api/src/friendships/friendships.service.ts
- apps/api/test/unit/friendships.test.ts
- apps/api/test/integration/friends-s1.disposable.test.ts
- apps/api/migrations/rollback/0032_friendship_core.sql (new; required by enhanced suite)
- apps/api/vitest.typescript.config.ts (new; portable Nest DI-preserving test transformer)

Database safety inspected first: suite refuses missing/nonlocal/non-test URL, exact disposable DB name required, empty application tables required. Created dedicated Docker postgis/postgis:18-3.6 container friends-independent-qa-20261013, fresh isolated data each run, no volumes, localhost32768. No existing databases queried or changed. Container removed after tests.

Executed integration coverage: additive migrations0001–0031 then unchanged0032; feature OFF on schema0031; guarded rollback preserving users and refusing populated immutable ledger SQLSTATE23514; actual API authentication/CSRF; block/privacy redaction; lifecycle epochs; expiration; idempotency replay; fault transaction rollback; concurrent recipient accepts; opposed sends; accept/cancel and block/accept races; account/profile closure fences; atomic rate limits. Real PostgreSQL lock waits were logged; no simulated DB concurrency.

Remote logs SHA256:
- base-unit.log 913e4326d6a530a7c705e75b39b94ba104ef37dc0b3c888dff3919f0c3a887b9
- base-db.log 22a5e56789b033aba8c36f94b1d44ebe30dc2a42107bef33e195913f3664bce8
- base-regression.log aaf34eb2d6bccd3dddd843b36a2e1bb2b3f3dc21ad5c1493dba2b9f245d5aed1
- candidate.log 328b76fd39df0c7f7cae8697feb0da033095b3d83204a370ecdcc169b28f0edb

Product repair file SHA256: policy b805337d089cf97281cbaebc9663c866e16e982aecbcfe55a2a87df9b687a223; service aa101189bbdc58522f00ad9c6a49f5702ac3d57d57bc68e664a63e194a9caab2; rollback be16f0c4e10fa0d7ef2a423bb604c058b8dd925924d7760960ef5e6098e1bc6e.

## Final immutable candidate verification

Final independent verdict: PASS for Friends source and isolated API/database scope. Published exact SHA f98b1ed42e3f3847ac305e487cf3a706d6a458f2, tree8e28c766e2b6f657869ba497a5adf352d9d0ee17, parent08a68a2b5ae861f22e7d440a01e32d14496a68fe. Independently fetched from GitHub into separate /tmp/friends-independent-qa-20261013/published detached checkout. Commit modifies exactly six previously reviewed files, each byte-for-byte identical to existing Germany repair, verified by PID3103616; no unreviewed source changes.

Final fresh PostGIS container friends-independent-qa-final-20261013 ID117f5532dd65b52b4b903b2aeb37e5f1d40eb6a7b06d826ce885f238c95ec257, no volumes, localhost32768. PID3102819 executed 57/57 PASS (23 unit+34 actual integration) then API typecheck PASS, overall exit0. Node24.21.0, Vitest3.2.7. All schema/recovery/locking/role/privacy/epochs/TTL/idempotency cases above executed on exact published source. Container removed by same completed job; live DB untouched.

Final exact-SHA test log /tmp/friends-independent-qa-20261013/final-sha-tests.log SHA2568d87d3da50c18089762e8d922980c8bc74bdb5155cb9f4eda45128fa169fa0a5.
Typecheck log /tmp/friends-independent-qa-20261013/final-sha-typecheck.log SHA256e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 (empty successful output).

This is independently executed manual QA, not canonical Runner queue completion, protected root QA evidence, browser QA or a DEV release receipt. No author CI status was reused as QA approval.
