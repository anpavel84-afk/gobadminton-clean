# Actions train recovery #185 — integration handoff

From: Owner-authorized Advisor/integrator. To: independent OPS QA / next PMA.
Date: 2026-10-22. Status: SOURCE_IMPLEMENTED, INSTALLATION_NOT_YET_CLAIMED.
Base: 705db4860f3378253fe33652569ecd4664294de1. Task: https://github.com/anpavel84-afk/gobadminton-clean/issues/185

## Actual failures
#177 exhausted3/3, after prior manual successor from149. The last candidate changed only a handoff because local vitest/tsc/eslint were unavailable; repair assignment had only failed job/step labels. Its retained CI failure is database/run39736065444 at exact attempt2 head a80a448504a69b2fffc56d3f90724a52ab4e74ea. Missing tools are NOT_TESTED, not code diagnosis.
#178 (successor of170) is now truly blocked by stopped independent QA run39740537759. Original source attempt1 remains; phaseqa/head258252213d60734c95ff94d21ceef3be32b06a00; root has completed unknown-operation receipt, no living process, saved QA belongs to0f5c96ed... and is not valid for the new SHA. This is different from exhausted source attempts and needs a read-only reconciliation, not a fourth author.

## Implemented finite transitions
1. Known safe exhausted3/3 deferral is frozen: source/head/base, task, QA/CI, attempt history and manual lineage. The original archive never changes. Explicit enrollment177, future proven safe deferrals only; excluded149/170 with active successors and156 already recovered/accepted.
2. Existing dispatcher gives ordinary ready tasks priority. An idle slot with QA budget and no conflicting reservation can execute one read-only diagnose and one separate read-only task-review. Reservation is written before process/budget/model; unknown/crash cannot blindly replay a spent call.
3. Diagnosis receives exact completed failure annotations and bounded log excerpts for the frozen run/job/head. A completed workflow's success is not treated as QA PASS. Environmental failures or insufficient data stop clearly.
4. A revised assignment retains original allowed_paths, acceptance, locks, dependencies, model and all product requirements; appends only concrete within-scope repair requirements; max_attempts2. Review binds receipt/proposal/diagnosis/evidence hashes. One successor per root lineage is reserved before any Issue write.
5. Separate hosted publish_recovery job (no DEV environment/SSH key) uses Issues-write GITHUB_TOKEN to publish exact canonical recovery envelope. Root admission requires real bot identity plus installed Owner185 delegation and exact root-reviewed receipt; original numerical Owner admission remains pinned and unchanged. Do not impersonate Owner or treat generic bot text as permission.
6. Normal claim/source/QA/CI/integrate/DEV stages execute the separate child. New branch starts from retained original candidate, not a fresh blank DEV and not the old source branch. Old attempt counters remain3/3; child own max2 is explicit and linked. A failed successor ends automatic recovery for its lineage.
7. Failed hosted publication is reconciled idempotently by exact body before a bounded retry (max3 workflow attempts), never reruns diagnosis/review. Unknown writes are not replayed blindly.
8. Stopped unknown QA is revalidated by root against completed receipt and unchanged checkpoint. Exact saved verdict can be reused; another-SHA verdict cannot. Otherwise at most one new independent read-only QA session; previous primary verdict is preserved in a hash-bound archive. No product source attempt increment/replay.
9. Ordinary CI repair BEFORE reaching3/3 now receives the same concrete failure evidence, not bare failure labels. Missing exact evidence refuses before author budget spend.

## Verification
126 focused Actions/installer/authority/crash/replay tests PASS via Python stdlib under nonroot agentagency-dev. Evidence: docs/workbench/train-recovery-185/tests-integration.txt. This is integrator verification, NOT independent QA. Independent reviewed exact candidate and Product CI are required before installing.
A scoped source author call ended at its900s budget timeout; its substantive source was retained and completed manually by the integrator. No second source author and no false completion claim. No application product modifications in this OPS worktree.

## Source surfaces
Existing core/client/receiver/stage; recovery.py, recovery_admission.py, recovery_publish.py, qa_recovery.py, recovery_upgrade.py; closed manifest; train-stage and trusted checkout pins; existing Product CI receiver job also runs the focused Actions regression suite; focused tests. Pinned live libraries, monitor.py, deploy-helper implementation and application code remain unchanged. No new daemon or permanent worker.

## Safe install and rollback
Runtime upgrade is reviewed-only, exact manifest and proof digest. Hold existing controller.lock, verify disabled old services and no live CLI, worker/lease locks, no integration pending. Known stopped QA178 may remain pending ONLY when the exact after-hash/process/finished receipt proves no active work. Never erase its pending receipt to make upgrade pass.
Dry run writes nothing. Apply requires new dispatch disabled, snapshots exact runtime/policy/record files and state/budget hashes, installs only bounded runtime payloads, preserves all task/history/budget bytes and leaves mode disabled. It enrolls exact177 archive with explicit lineages. Activation is separate after hosted controller/workflow SHA pins and independent review are verified. Reconcile178 through the new ordinary Actions mechanism after activation, not a manual source retry.
Rollback restores runtime/control files only, never task counters, source branches, ledgers or accepted results. It refuses changed task state and ends disabled for reconciliation. All backup paths and actual activation/probe/transition evidence must be added to Issue185 before declaring installed.

## Remaining gates
Exact independent OPS review; Product CI; mechanical workflow checkout pin to immutable controller commit; safe root dry/apply and active-policy probe; prove actual recovery and normal-queue transitions. Monitor/Projects UI #175 is separate. Until real evidence is recorded, this file does not claim installed, autonomous product completion, Owner acceptance or PROD authorization.

Immutable controller source: `096fc67ee9ceef4f8a2111dc04856354ed25bc14`. Both train workflow checkouts are pinned to this commit in the follow-up mechanical workflow commit; root policy must match this controller and the final train-stage.yml SHA256. This avoids a self-referential source/workflow hash.

## Independent R1 and addressed findings
Independent read-only review of62c8f2475bfae8f9bfcbb59192208b1d5d79fe98 returned FAIL. Preserved report/reproductions are under docs/workbench/train-recovery-185/independent-r1-*.
P1: an exact-SHA receipt written before original QA cleanliness checks could be reaccepted after QA rejected its modified worktree. Corrected: original QA worktree must exist, have the exact HEAD, and be clean before receipt reuse; otherwise the finite new read-only QA path is required. Added dirty/wrong-head reproductions.
P2: a publisher retry API failure aborted ordinary task dispatch. Corrected: failures are isolated per receipt and defensively at the caller, with evidence; normal ready tasks still dispatch. Added actual planner/dispatcher regression.
Current integrator suite128 PASS, including both failure regressions. Pending recovery rerun now retains old operation receipt in recovery_history and reports the current workflow identity. Independent targeted R2 remains a required gate; original R1 FAIL is not rewritten.

Final R1-corrected controller source: `ba02b9d9f9d56c7b07379da22d128c3dfa7341e1`; supersedes the initial096fc67 controller pin. Mechanical train workflow pin update follows this immutable commit.
