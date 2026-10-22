# Recovery #185 · Product-document scope false refusal — focused follow-up

Status: **SOURCE PATCH / NOT INSTALLED / NOT REVIEWED INDEPENDENTLY**
Date: 2026-10-22 UTC
Role: Owner-direct Advisor implementation, not a new autonomous developer assignment.
Owner authority: https://github.com/anpavel84-afk/gobadminton-clean/issues/185
Base: current `dev` at branch fork. Predecessor PR: https://github.com/anpavel84-afk/gobadminton-clean/pull/188

## Real evidence, not guessed from monitor
Root policy on `vmi3510488` at 10:49 UTC: mode=active; controller_sha=`ba02b9d9f9d56c7b07379da22d128c3dfa7341e1`, recovery185 enabled.
Original #177 and #181 source attempts/QA/CI history and 3/3 remain. Both were actually enrolled, each performed one read-only `diagnose`, and each reached `needs-owner` with exact reason `recovery control path forbidden`. The root receipts remain spent (diagnose=1, review=0, successor=0). There are no active model writers; normal dispatcher reports no admitted ready product tasks (18 nonadmitted, 13 deferred, 2 dependencies). No source/reservation/budget state was modified during this investigation.

Original allowed_path lists for #177 and #181 both include product API docs/handoff files. Controller `recovery.revised()` nevertheless blanket-rejected ANY `docs/` diagnostic path as forbidden, even when already within immutable Owner paths. That is a validation false positive; this change does NOT claim that a particular retained model diagnosis was source-correct.

## Bounded source patch
- `scripts/chatops/actions_train/recovery.py`: allow ONLY original-approved `docs/api/**` and `docs/handoffs/**` product DATA paths as a supplement to >=1 real `apps/**` or `packages/**` source/test path.
- Continue refusing arbitrary `docs/**`, governance, operations, `.github/**`, `scripts/**`, `packages/tooling/**`, path traversal, paths not in original allowed_paths and documentary-only diagnoses.
- The diagnosis prompt explicitly requests at least one real source/test path and forbids system/control changes. Independent definition review, exact QA/CI evidence, source attempts, budgets and root authority are untouched.
- Regression tests in `scripts/chatops/tests/test_actions_train_recovery.py` cover allowed product docs, no-source rejection, control path and traversal denial.
- `scripts/chatops/actions_train/manifest.json` hashes the exact edited recovery.py bytes; all other manifest entries unchanged.

## Testing at author stage
21 existing focused Receipts/ExactCI/ModelBoundary Python unit tests PASS (new checks included).
The full local recovery test suite under unprivileged agent could not run all simulated root-upgrade tests: four tests tried reading an unrelated protected live policy path and failed with PermissionError. This is NOT_TESTED (environment permission), not a claim of PASS. GitHub Product CI and independent OPS QA on the final commit are required before any runtime installation.

## Important boundaries and unfinished work
- This PR alone does not change the live root recovery controller or its pinned GitHub workflow; runtime hash/policy and owner delegation stay at their established code. Existing #177/#181 spent diagnostic receipts are NOT reset, replayed or declared recovered.
- Product and OPS work must never be mixed in the same source writer. No duplicate autonomous author for #177, #181, #178.
- Do not `scp` a source file into the live runtime, modify root policy, change checkout pins or rerun a spent model call directly. A follow-up reviewed, transactional OPS patch/upgrade (controller lock, quiescence, exact manifests, DRY/APPLY, backup/rollback and hosted read-only probe) is mandatory for activating any new runtime.
- Root `needs-owner` receipts require distinct legitimate disposition/evidence. If the model's attempted fix needs unapproved control files or only documentation, leaving it blocked is the correct safety outcome.
- Ordinary backlog admission is separate: an empty ready queue cannot be fixed by replaying deferred product authors.

Rollback: revert this source PR. Any future installed patch must have a separately proven runtime-only rollback; no history, attempts or budget rewind.

Next bounded action: independent exact-source OPS review and Product CI; then decide with real retained evidence whether the existing controller's receipt dispositions can be safely improved WITHOUT rerunning a spent diagnosis. Install only through a reviewed existing OPS boundary and prove at least one genuine automatic successor or honest needs-owner status.
