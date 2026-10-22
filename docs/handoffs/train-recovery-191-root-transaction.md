# One-time #191 recovery correction installation — controlled root transaction

Status: **SOURCE IMPLEMENTED, NOT INSTALLED, NOT ACTIVATED**
Owner authorization: Issue #185, PR #188 and scope correction PR #191.
Date: 2026-10-22 UTC. Repository: anpavel84-afk/gobadminton-clean.
No PROD/PLAN/VPN, app source/DB, provider or model-code changes.

## Exact verified premise

The existing recovered Actions train is active at root controller `ba02b9d9f9d56c7b07379da22d128c3dfa7341e1`. Its original `upgrade-185.json` and backup have been retained; normal source/QA stages have advanced checkpoints since initial install. Its installer is intentionally **one-shot**, and its original rollback refuses changed state. It must never be reset, overwritten or reused for a second upgrade.

PR #191 exact source correction was merged and reviewed: `recovery.py` SHA256 `579ea87375a1008481f29a736f818944adb40bd5d924719824bee410849050ea` replacing current root file SHA256 `2f6ae741ccffff673e667735cd0b9d8201c6ce03b2e1a9ccc8f1e817605b2739`.

Original #177/#181 recovery receipts are already spent `diagnose=1,task_review=0,successor=0`, `status=needs-owner`, `recovery control path forbidden`. This installer does NOT reset/replay them. Original 3/3 source attempts and immutable Owner admission are unchanged. New automatic work can be accepted only with verified new source 3/3 or new independent Owner-approved Issue.

## Scope and trust boundary

`scripts/chatops/ops/recovery_hotfix_191.py` is a **single-use reviewed root operator tool, not a new worker**. Source is stored in GitHub and must be copied into a root-owned, hash-verified checkout before execution. Run with `python3 -I` as root after independent review and mandatory CI.

It imports only the existing trusted root-installed libraries and accepts no shell/candidate commands. With the existing `controller.lock` it checks:
- both legacy systemd workers inactive/disabled, no pending/unknown new stage or active source task, no integration/DEV in progress, and free legacy locks;
- original policy/controller, installed code SHA, complete manifest target list and exact single changed file `recovery.py`;
- existing GitHub Actions `train-stage.yml` and `train-dispatch.yml` immutable controller checkouts and exact stage checksum;
- unmodified slot checkpoints, spent recovery receipts and budgets before/after.

`dry` changes nothing. `apply` writes its own `hotfix-191.json` and root-only backup of recovery.py/policy/backup-record, disables root dispatch FIRST, replaces the one reviewed file, updates the current manifest record and remains disabled. All original #185 upgrade artifacts remain immutable. `activate` requires explicit verified hosted shadow probe and unchanged state; it then sets mode to active under controller lock. `rollback` only before activation with unchanged state, restoring root file/record and leaving dispatch disabled. It will not silently rollback a runtime that has executed new tasks.

## Activation sequence (not claimed)

1. Independent precise Ops source QA and Product CI PASS. Merge this script source as an immutable controller commit `C` into `dev`.
2. Narrow independently reviewed workflow pin PR updates **both** existing train-stage and train-dispatch checkout refs to immutable `C`; CI + merge. Do not modify GitHub main relayer PR #194.
3. Verify no active stages and root policy matches old pin. Copy exact `dev` checkout into root-owned staging; compare source/workflow/manifest hashes with GitHub and reviewed records.
4. Run root `dry` with exact new manifest checksum, controller commit C and stage checksum. Only if safe run `apply` under controller.lock.
5. Trigger read-only hosted dispatcher while root is disabled and verify SUCCESS using **pinned** controller and new workflow hashes. Provide real run ID as activation proof; root script additionally checks stage/policy immutable hashes and no stage state changes.
6. `activate`, dispatch a normal permitted train reconcilation and verify root heartbeat, no duplicate author, and truthful ready/deferred/not-admitted counts. A real 3/3→diagnose→review→successor→source/QA/CI/DEV transition still requires a NEW safe deferred issue; do not fake one.
7. Record exact journal/checksums/QA/CI/host evidence in Issue #185.

## Tests and limitation

Initial synthetic transaction tests: `test_actions_train_hotfix191.py`, 3 focused tests PASS unprivileged on Germany VPS. These are not independent QA. Source PR must still pass Product CI, independent review and real DRY (the last is NOT_TESTED until recorded).

Owner-approved product backlog still needs admission preparation. An automatic Owner Issue-comment relay has separately been installed in default-branch GitHub via PR #194; it triggers existing dev dispatcher after real exact signed Owner assignment. It does not invent task authority.

This handoff is a continuation checkpoint, not an acceptance statement or permission for weakened security checks.
