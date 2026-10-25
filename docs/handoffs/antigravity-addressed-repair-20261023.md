# Addressed #29 / #218 source handoff — 2026-10-23

From: bounded source author. To: PMA trusted bridge and fresh independent QA.
Status: IMPLEMENTED source, uncommitted. This record is neither independent QA nor CI/runtime acceptance.

## Preflight and authority

- Trusted rules: accepted commit `b4a746a0b9834d80b8c65ecb9a093257f989bae7`, SHA256 `0755f8b5eb2cce575e58137a0f0462448109d8af0173e36d67f6551342b35ba6`. Full trusted text was supplied; the local canonical file hashes identically.
- Source HEAD/base of this author diff: `cc55336f5cd5d1eb4d43443b61e17745dfabd7b4`; accepted comparison base supplied by assignment: `b0e4d233bc150f42ada86c4c0f56897c57e0d0fe`.
- Owner assignment: immutable comment `6362661117`, addressed OPS #29/#218 only. One author, supplied completed Astra briefs reused; no new diagnosis, delegation, provider/model execution, network, services, installation or deployment.
- Requested author route: protected Codex Sol High. Effective model/effort has no separately supplied runtime receipt and is not asserted here.
- Actual initial checkout was clean and HEAD matched the assignment. Origin was a local QA bundle, not a GitHub remote; this is provenance, not additional authority. No task-checkout Git writes, commits or publication were performed.
- Only assigned source/tests/manifest/helper/handoff paths changed. Workflow files were not edited. No runtime readiness or AGY-ready marker is inferred from these changes.

## Implemented contracts

`native_antigravity.py` has one addressed Technical PM / Product Analyst branch in the same native adapter. The existing `qa_qualification` stage remains the execution route. The first addressed grant is Medium analysis of the exact INERT #230 input `scripts/chatops/tests/fixtures/agy-230-inert-task-draft.json`, SHA256 `40c79986904243c77d0e06231f1a82802018b17137242212aec2513e0258bd55`.

Analysis removes the CLI `--json-schema` dependency and does not require finish DONE. It validates the entire response as one JSON object, including duplicate-key rejection and exact role/grant fingerprint. Multiple objects, trailing prose, malformed/truncated streams, model/conversation drift, denied/error events and unfinished/reopened tool steps fail closed. COMPLETE/INCOMPLETE has no QA verdict and never qualifies QA or release gates. Input hashes, complete stream-json stdin/EOF, finite timeout/output, private evidence, native permission mode and existing whole-process Landlock boundary remain in place. Only the addressed role label changes after the existing trusted-context validator checks the full accepted rules. QA retains its previous finish, structured output, schema and verdict requirements.

`antigravity_qa_recovery.py` adds only `GB_AGY_29_ADDRESSED_CALL_V1`, fixed to Owner comment6362661117 and lineage `owner-6362661117-agy29-218`. The new lineage admits at most four exact grants total, each at most one CLI reservation/charge. Old 2/2 and 1/1 records/counters remain immutable. Charge intent is exclusive and durable even when charging/launch fails; the existing Budget lock and invocation ledger are used. Global caps are never edited. This counts CLI reservations, not unobservable provider-internal calls.

A grant binds role, controller revision, base/head, exact input revision/path/hash, CLI/rules hashes, stream-json/permission mode, timeout1800, output4MiB and ceiling1. Two roles only: `technical_pm_product_analyst` and `independent_qa`. QA additionally requires a reviewed `GB_AGY_29_QA_TEST_CONTRACT_V1` document with exact source SHA, requirements, and successful command/output-hash receipts for that SHA. Store that receipt in a separate immutable input revision; embedding a commit's own SHA inside its source would create a fixed-point problem. Analysis input_revision must equal its head.

The closed `antigravity_addressed_upgrade.py` helper bootstraps reviewed code from b51 without assuming the new adapter is already installed or AGY is ready. It uses the existing installer, controller lock, backup/quiescence and hosted disabled-shadow primitives. It has no provider launcher or general OPS admission interface. Initial installation is disabled. Rollback is limited to preactivation phases and unchanged history/targets; it never rewinds live checkpoints, UNKNOWNs, reservations or ledgers.

The separate `reconcile` effect handles only fac7, generation87→88, exact process identity/death and before==after checkpoint, with durable intent. Its canonical operation digest was checked against the supplied operation: `0961f5ac0ef72436b033b62665e95bb02809e009462f16dccf90543c65923a2e`. It changes scheduling occupancy only, preserving the original operation/result/reservation and old ledgers. There is no general safe_release or unknown replay.

Further `admit` effects append reviewed grants without renewing prior grants. Each advances scheduling generation while preserving prior operation/result objects, so analysis and QA on the same head cannot alias the same wire operation. Each grant uses a fresh native invocation/private HOME; acceptance also rejects a reused native conversation fingerprint. Analysis can never set the ready marker. Only a fresh, strict independent QA receipt with the exact source/test contract and observed successful run_command can do so. Acceptance leaves policy disabled and global caps unchanged. Product stages on slot2 are blocked while this addressed qualification bootstrap is canary. Team activation retains its existing real AGY-ready prerequisite.

#218 changes:

- `team_runtime_upgrade.py` uses closed `GB_TEAM_RUNTIME_218_PROOF_V2` with explicit implementation C and release R. It reads the actual pinned manifest and every payload blob from C, compares them with the release bundle, verifies all four real checkout steps, and permits only those ref substitutions in R. A deterministic Python probe of that payload exercises admission validation, request validation, QA/CI FAIL→failure_diagnosis and planning. Ref strings alone cannot satisfy the check.
- QA findings and validated CI assertion excerpts mentioning timeout/network.error reach Astra classification. Only whole recognized pre-call diagnostics are treated as infrastructure at the QA entry. No substring-wide infrastructure veto remains. Exact SHA/evidence requirements, cached bounded diagnosis and source_defect brief requirements still gate repair; environment/insufficient diagnoses cannot authorize source repair.
- Both task_review preflight and actual invocation share `core.task_review_route`, selecting compatible admitted Codex QA routes only. No route is added to the immutable task, no AGY task_review adapter is created, and ordinary complex QA still prefers qualified AGY. Recovery's four hash checks are unchanged.

## Local verification receipts

Final selected stdlib unittest run: **251 tests, 4.950s, OK, exit0**, with `TMPDIR="$PWD/.author-tmp" PYTHONDONTWRITEBYTECODE=1`. The selected modules/classes were:

```text
test_actions_train_addressed_218
test_actions_train_addressed_analysis
test_actions_train_addressed_grants
test_actions_train_addressed_upgrade
test_actions_train_failure_diagnosis
test_actions_train_recovery
test_actions_train_cost_policy
test_actions_train_team_upgrade
test_actions_train_team_routes
test_actions_train
test_actions_train_stages
test_actions_train_antigravity.Protocol
test_actions_train_antigravity.NativeToolScope
test_actions_train_antigravity.QualificationSeam
test_actions_train_antigravity_recovery
test_actions_train_antigravity_one_shot
test_actions_train_antigravity_one_shot_entry
test_actions_train_antigravity_entrypoint_patch
```

Plus these five `test_actions_train_antigravity_transport.Transport` methods:

```text
test_explicit_mode_and_actual_failure_stay_fail_closed
test_whole_unicode_wire_finite_bounds_before_charge_or_launch
test_real_cpython_pipe_large_full_input_eof_and_actual_write_count
test_review_receipt_matches_exact_captured_wire_and_preserves_rules
test_broken_timeout_short_absent_and_written_delivery_are_truthful
```

Reproduce with `python3` after adding `scripts/chatops/tests` to sys.path and passing these names to `unittest.defaultTestLoader.loadTestsFromNames`; use `unittest.TextTestRunner(verbosity=1)` and exit nonzero unless wasSuccessful(). No provider is invoked. Kernel owner metadata in watchdog unit fixtures is simulated; installed UID1002 ownership/permissions remain a runtime check.

Additional final checks: all **27/27** manifest payload hashes matched; all eight changed implementation/helper Python files parsed; `git diff --check` exit0. Manifest SHA256: `65b655d05596b99c92a6ac3425884aa7f76591cf408d5b75f9647bc50a39666e`.

Early aggregate runs encountered restricted /tmp ancestor traversal and were rerun using a private workspace temp directory without changing production security checks. Early legacy Collection/transport fixtures also created temporary Git repositories/commits, contrary to the literal no-Git-writes constraint; those temporary fixtures were cleaned by their tests, and task-checkout Git was never written. The final251 selection excludes Git-writing fixtures.

`JOB/historical-native-stream.jsonl` was not present and JOB was unset. No historical stream was imported or committed. A synthetic negative reproduction of the supplied proven contract failures is tested and explicitly labeled synthetic; the existing sanitized denied-stream fixture remains negative. Full historical-stream replay is **NOT_TESTED**.

## Exact bridge installation/release interface and next steps

1. Fresh independent QA reviews this uncommitted source diff and CI validates the published exact implementation. The bridge publishes implementation commit **C** containing this payload/manifest/tests/helpers. Do not substitute a guessed SHA or treat these author tests as QA/CI acceptance.
2. Prepare separate reviewed release commit **R**, changing only the existing four checkout refs in `train-dispatch.yml` and `train-stage.yml` to the real C. Review C and R independently and bind R's two workflow hashes, C's manifest hash and every exact installed target delta. This author did not edit those workflows. The release verifier requires a local immutable R repository containing C; no fetch is performed.
3. Obtain the existing disabled/quiescent protected root bridge boundary and preserve all current work/history. In a fresh reviewed maintenance process load the addressed helper by its reviewed path; call `execute(action, bundle_R, proof_path, independently_reviewed_proof_sha256, run_id=None)`. It loads the corrected qualification modules only in that maintenance process after validating the manifest hashes; it does not hot-patch a receiver process. The closed proof schema is `GB_AGY_29_ADDRESSED_UPGRADE_V1`; exact fields are `KEYS` in the helper. The standing scope/Owner comment is fixed; proof hashes do not manufacture broader authority.
4. `execute('reconcile', ...)` is a separate scheduling effect against the exact disabled **b51e7c1c18103247606d35a414c82b04f5dd53ee** baseline. Bind pre-reconciliation slot2/history hashes in that proof. After reconciliation obtain a separately reviewed installation proof with the new slot2 hash; original op/result/reservation/ledger hashes must still match. There is no blanket release of UNKNOWNs.
5. Prepare the clean immutable canary worktree at the grant's exact head, retaining the existing fixed qualification worktree path. Bind the exact #230 input file hash and a Medium analysis grant with all closed fields. Call `dry`, then `apply` with the exact post-reconciliation proof. Both verify actual C/R provenance and payload protocol. `apply` backs up exact targets and finishes `installed-disabled`. No AGY-ready prerequisite is imposed for this bootstrap.
6. Run the existing hosted disabled shadow on the reviewed release. Supply its real run_id to `activate`. Activation is write-ahead/idempotent and permits only the existing addressed qualification stage on slot2 while canary. It does not call a provider itself. The existing train reserves and executes at most the one current grant. Reconcile process/receipt outcomes before any next step; a spent/UNKNOWN grant is never replayed.
7. After useful analysis, disable policy at a safe boundary. Use `admit` with a new independently reviewed exact role/source/test-input grant and exact marker/ledger/slot2-generation deltas, retaining the same max4 lineage. Each repeated admit is idempotent and never refunds prior calls. Use a new disabled shadow and `activate` for that admitted grant. New ambiguous outcomes require a separately reviewed exact reconciliation; this helper intentionally has no generic release path for them.
8. Fresh independent QA qualification remains separate from analysis. After its actual strict success, disable policy and call `accept` with that grant's reviewed proof. It verifies the exact receipt and independent session, marks ready while disabled, and leaves all caps unchanged. Analysis acceptance is rejected. There is no product activation or release-gate qualification from COMPLETE.
9. Subsequent product/team installation and activation use the reviewed `team_runtime_upgrade.execute(..., baseline=<actual ready controller>)` V2 proof and its existing real AGY-ready requirement. Global normal-QA budget/availability remains a distinct prerequisite; this change does not make exhausted normal budgets unlimited. The actual future C/R revisions, proofs, native calls, exact CI and DEV receipts must be recorded by the bridge.

Before initial activation, `rollback` restores only backed-up code/marker/initial new-ledger targets and the disabled policy/inventory when exact state/history checks permit. The separate fac7 reconciliation is preserved and is not undone. After activation, or after history/counters change, this rollback refuses. No database/data rollback, PROD release, daemon, credentials or service change is included.

## Remaining factual limits

No native analysis, shell capability qualification, fresh independent native QA, hosted CI/shadow, installed controller update or DEV scenario ran in this author session. Old UNKNOWNs and the supplied native QA incompatibility remain historical failures. QA still requires finish DONE and structured_output; if a fresh admitted native QA call again omits them or supplies ambiguous output, it must remain UNKNOWN. The precise remaining QA-specific delta would be a separately diagnosed/reviewed producer/contract capability change, with a corrected candidate and a remaining exact grant; do not relax the parser to accept the old stream. Installing a further adapter revision after this initial b51 upgrade requires review against the actual installed baseline and preserved lineage; it is not authorized by resetting this helper or substituting historical identifiers.
