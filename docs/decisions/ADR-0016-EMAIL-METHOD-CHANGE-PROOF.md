# ADR-0016 — bounded email change proof and browser status
Status: TECH_SELECTED within internally admitted E2/E3 source; READY_FOR_REVIEW, NO_RELEASE. 2026-10-08.

Exact authority: PM assignment/admission at 33e6c5e39ecd3fb5136b8b9e5ff7ca51d7c182ab, current/new-mailbox semantics from architecture dba12af8033dc686b1d27790b97c6ba75a53128b. E1 independently accepted eeeda94a9a46cb0f3fcde77f5bfd750048a940f9.

Reuse the existing challenge/queue/rate/fake transport, with additive change_current/change purposes. The first challenge proves the current stored mailbox, captures original credential ID and exact session, and may authorize only one new-address challenge before its original expiry. New proof atomically replaces the exact original credential under mailbox-owner then User/session/challenge fences. No session timestamp refresh or recovery bypass is introduced. A provider reauthentication alternative remains future scope; current mailbox proof is required for all implemented email replacement.

A unique change_proof_id plus original_method_id preserves one-use and stale-credential safety without a second token platform. Proof IDs alone convey no authority: session/CSRF/Origin, consumed state, expiry, credential identity and recent auth are all rechecked. Invalid/collision proofs consume attempts/proof according to E1. User fence serializes OAuth/email unlink to retain at least one stored supported method. OAuth unlink freshness aligns with email unlink. Login rechecks credential after the same User fence so a revoke/change committed while login waited cannot authenticate an old owner.

Browser same-origin GET does not reliably emit Origin. Add JSON POST status aliases with strict E1 mutation-context guards; existing GET routes remain for compatible clients. These aliases are read-only, carry no mailbox/code and use the narrow explicitly enumerated auth-challenge contract-policy exception. No general exception to command idempotency is added.

Consequences: changing address requires two mailbox challenges and a recent session; loss of current mailbox has no shortcut. Issuance response loss requires restarting proof; consumed verification responses are not replayed. UI supplies clear recovery and rereads method inventory. Default/public email remains disabled until separately admitted sender gate.

Compatibility/rollback: OpenAPI additions and migration0026 only; existing E1/OAuth routes retained. Older code ignores additive fields/purposes; keep email disabled when reverting, preserve credential data and forward-fix future releases. No live data/migration/deploy effects are authorized. Verification/evidence are producer self-checks; independent queued QA must review the exact new candidate.

P3 composition 2026-10-10: reviewed historical decision retained under ADR-0015/0016 to avoid current ADR-0011/0012 identities. Current assignment edbf26e39d7aeba475caecfbb6635e8e5be99208 admits source composition onto c39e1942035e526ecf83427329999e65200ee1dd; migrations now 0025/0026. Author evidence: docs/workbench/product-rebaseline/p3-email-composition; fresh candidate requires separate queued QA.
