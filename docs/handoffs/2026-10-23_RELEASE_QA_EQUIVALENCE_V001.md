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
