# #248 — Release identity, QA reuse and slot isolation

23 October 2026. SOURCE IMPLEMENTATION; independent review/hosted CI and runtime install are separate gates.
Owner scope: Issue #248. Base `3ac82ea068a5b2b0539caa552342d320e4b216ef`. No Antigravity/grant/slot/budget changes.

## Implemented

- `prepare_train_release.py prepare` deterministically constructs one ref-only release child with exactly four immutable controller checkout refs. `--publish-ref` performs a local CAS update only; it never pushes, changes the source index/worktree, modifies a checked-out branch or installs runtime. Repeating the same preparation returns the same release commit.
- `check` finds and validates the actual C→R ancestor. Later test/handoff-only commits are classified by actual file bytes and modes, not simply a different HEAD. Endpoint equality also recognizes a fully reverted intermediate code change; this is not permission to replay unknown runtime/deploy effects. New runtime changes are reported as `runtime_identity_reusable=false`; `--require-reusable` refuses those until a new release is prepared.
- CI calls this validator. Every manifest member and live-library pin is checked against real Git blobs. Rules, contracts, build inputs, lockfiles, unclassified files, file removals, executable changes and symlinks are never silently exempted.
- Real `Bridge.review` saves an immutable provenance sidecar for an actual independent PASS. Real integration/author repair carries its origin. At QA stage, equivalent code/task/admission/rules and base can reuse that review. New exact-SHA CI remains required; test changes receive a small independent delta review. Original `reviewed_sha`, result, attempts and history are never rewritten. Later CI/promote/DEV gates recompute the equivalence and original receipt hash.
- Historical PASS receipts without a provenance sidecar remain valid on their original exact SHA only. Initial cross-SHA reuse is deliberately conservative: all non-exempt repository contents must match. Changed dependencies or an unknown classification fall back to normal addressed QA, not a global train stop.
- A finite dispatch pass validates all descriptors first, records each outcome and continues a second eligible slot after a request-local HTTP rejection or unknown HTTP outcome. Authentication, rate-limit and integrity errors remain blocking. There is no new root reservation journal, queue, scheduler or worker. Existing receiver generation/operation history is the sole execution deduplicator. No immediate retry of ambiguous POST; a later normal reconcile reads durable state. This does not promise exactly-once HTTP delivery, only preservation of existing no-duplicate stage execution controls.

## Operator usage

After the implementation commit is complete and the source checkout is clean:

```sh
python3 -B scripts/chatops/ops/prepare_train_release.py prepare \
  --implementation "$C" --expected-head "$C" \
  --publish-ref refs/heads/ops/release-equivalence-20261023
python3 -B scripts/chatops/ops/prepare_train_release.py check \
  --revision refs/heads/ops/release-equivalence-20261023 --require-reusable
```

The trusted operator publishes the resulting ref through the existing authorized Git channel and receives exact-release QA/CI. Do not pin workflows to their own future SHA. A changed branch/CAS fails without overwriting someone else's work.

## Verification completed before first publication

- 26 focused cases PASS, including real disposable Git commit/merge/rebase histories, detached C, repeated deterministic R, CAS race, modes/symlinks/dependencies/policy rejection, unchanged original receipt, actual Bridge/stage integration and real loopback HTTP 422→204 across two descriptors.
- Full `test_actions_train*.py`: 491 tests, PASS, one existing skip, executed as ordinary nonroot operator in the isolated Germany source checkout.
- `git diff --check`: PASS.
- Model-author sandbox initially could not run some pre-existing tests because of explicit `/tmp` and protected `/etc` paths; no protection was relaxed. Full suite subsequently passed in the normal nonroot test environment. Initial source-author call ended at its bounded timeout; source and logs were preserved, no child remained, and the operator finished the local changes. This is not independent QA.

No production train tasks, native Antigravity calls, protected-state edits or runtime installation were executed by this task. Model/HTTP boundaries in most unit scenarios are synthetic; Git and loopback HTTP operations are real. Hosted CI is a separate acceptance requirement. Do not represent these fixtures as live product E2E.

## Rollout and rollback

Keep PMA's active Antigravity operation untouched. Source acceptance is not installation. Install only on the existing quiescent OPS boundary with exact manifest, reviewed backup/rollback, and no overlap with PMA. Preserve historical receipts and state. A rollback of code must never rewind task outcomes or grant usage.


## R2 repair after independent R1 FAIL

Original R1 FAIL receipt `4032cb9f9fe24c802cea7628956341732f29aa9b98cc2a2a3856c0b1d14978d6` remains immutable. A separate Astra High diagnosis confirmed exactly F1/F2/F3, receipt `73bf0a80a45d1e2dad0dc2cdd67c664ddbbe860b017d37afb01450415e5b857b`. Source repair and operator integration are not independent acceptance.

F1: task QA equivalence now inspects immutable endpoint dependency blobs with the existing native import extractor, without changing the native adapter. Direct/transitive imports, package initializers, aliases, dynamic/file-loader uncertainty, build inputs and changed base are addressed. An uncertain dependency proof declines automatic reuse locally. A valid previous receipt instead scopes a real NEW independent review to the changed files and affected dependency/base risks; it never manufactures a new PASS or repeatedly orders a global audit. Strict original task/acceptance still applies. Safe isolated test changes retain the original runtime PASS plus actual test-delta review. The dependency extractor is intentionally conservative; arbitrary loaders are not claimed statically solved.

F2: the existing receiver CI job now automatically invokes `auto` using a separately checked-out immutable tools revision, with contents:read and no new credentials. It selects the actual PR head (not GitHub's synthetic merge SHA), tolerates base advancement through the real fork point, validates current manifest, and either reuses an existing controller release or forms deterministic C→R and uploads a reconstructible Git bundle/proof. Source HEAD/index/refs remain unchanged. Publication of that exact artifact is still the existing trusted OPS action, not an automatic merge/admission. No new workflow/service/scheduler.

There are two distinct identities. Release packaging checks the complete **installed controller manifest**, exact workflow lineage and non-runtime descendant paths; it is not permission to reuse a task's QA. The real #247 d07a7f test-only descendant therefore keeps its identical installed controller identity, while still requiring exact-candidate CI and test review. Task QA separately requires dependency-aware equivalence or fresh addressed review. This avoids making an unrelated application tsconfig invalidate identical installed controller bytes.

F3: structured verified evidence travels outside the unchanged terminal snapshot. Root enrollment rechecks protected receipts and Git under the fixed slot UID. Frozen recovery, diagnosis cache, execution and successor certificates preserve the evidence; a successor gets parent provenance, not the parent's current-task PASS. Historical exact-SHA frozen serialization remains unchanged. Unverified cross-SHA proof remains refused.

Operator combined regression run: **511 tests PASS, one existing skip**, including seven actual automatic release/artifact reconstruction cases, real Git merge/rebase, imported-test negative cases, original QA receipt preservation, terminal CI failure/recovery/successor chain and real HTTP two-descriptor isolation. A previous standalone F2 probe passed seven cases. These are real Git/HTTP operations with fixture tasks, not live product/model E2E. Hosted CI and fresh exact-release independent QA remain separate gates.

Current PMA runtime and Antigravity task state are outside this repair. Source acceptance must not be confused with safe runtime installation; check current controller, grants and PMA ownership before any rollout.
