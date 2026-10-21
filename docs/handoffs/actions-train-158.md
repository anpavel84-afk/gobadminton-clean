# OPS #158 · implementation notes / handoff

From: bounded Germany Codex author. To: PMA integrator/installer. Date: 2026-10-22.
Status: **LOCAL IMPLEMENTATION + AUTHOR TESTS; NOT INSTALLED, NOT INDEPENDENT QA, NOT ACCEPTED**.
Authority: [Owner Direct OPS #158](https://github.com/anpavel84-afk/gobadminton-clean/issues/158),
Pavel 2026-10-21; this assignment authorizes implementation, not installation/acceptance.

## Source and limits

Requested base dev `4977074ee7b45ea612dde592b88b354d99839aea`.
Actual provided branch `chatops/actions-train-20261021`, HEAD
`60b734fe129748cb807df10dc4f9ee4875a2d06c`; initial status had no local changes.
Git reported inaccessible alternate objects at `/srv/gobadminton-clean/repo/.git/objects`;
later `git diff/status` could not read tree `39a11db4654fc275709a3f171e5ec8187d05d82e`.
The author did not repair Git metadata, change base, commit, push, fetch or use network/install.
PMA must resolve repository object access in its authorized integration environment and review
the actual base difference before producing a commit. No invented candidate SHA/permalink exists.

Read-only source: `/var/lib/gb-actions-migration/context`, supplied LIVE code/monitor/helper/slots.
The observed snapshot is `2026-10-21T22:23Z`: slot1 #151 attempt 3; slot2 #156 developing;
slot1 done count 34 and slot2 done #152. Snapshot is not a fresh live process observation.
No old worker was stopped; no actual checkpoint, 14 Owner parks, attempt, budget, state or history
was edited. Neither auth/session files nor key bytes were read/copied.

## Delivered

- Two hosted workflows: finite reconcile/rescue and bounded per-slot stage execution; default-main
  checks, commissioning tests + inline read-only probe, queue:max, no cancel-in-progress, explicit
  continuation only for a real transition. Remote API token is read-only; write continuation stays hosted.
- Small authenticated client and exact pinned LIVE libraries. One-stage adapter uses existing
  author/QA/sandbox/lease/budget/gate primitives, not the old worker loop. Renewed QA/CI on dev merge,
  bounded concrete repair, factual clean deferral, independent task isolation.
- Installed-only DEV root receiver: closed JSON before deploy lock, atomic pending/results/history,
  process identity, cancellation/reboot exclusion, read-only uncertain-effect reconciliation,
  nonroot execution, memory/token isolation, persistent serialized DEV reservation.
- Existing helper changed only by the DEV train hook/read relocation. Test reconstructs the exact
  original LIVE helper SHA; PROD retains its original read/lock/deploy path.
- Exact-hash disabled-first installer with actual before backups, DRY without managed writes,
  clean-boundary takeover, enabled-state preservation and compatible rollback without history reset.
- Additive monitor process/model/workflow source and exact-hash mapping payload; no redesign,
  no changes to `GB_SLOT_STATUS_V1`, no invented alert channel.
- Profiles preserve LIVE bans: Codex only proven executable author/QA; Cursor disabled;
  agy author/QA forbidden, advisory review only. Auto reports measured call caps, not fictional
  token balances across unavailable providers.

Operational contract, request/stage/recovery/install/profile details:
[Actions train](../operations/chatops/ACTIONS_TRAIN.md).
Trusted payload hashes: [manifest](../../scripts/chatops/actions_train/manifest.json).
Manifest SHA256: `c34299cc509d091077d05cd6ab85b3de42e79c5b2821d3c2003bfe3d8eb1e420`.
Tests: `scripts/chatops/tests/test_actions_train*.py`.

## Actual checks

- `python3 -B -m unittest discover -s scripts/chatops/tests -p 'test_actions_train*.py'`:
  **58 tests passed** at final implementation checkpoint. Covers exact admission, double-author,
  two disjoint versus overlapping/pending claims, lost-queue rescue, routing/budgets, bounded
  repair, failure isolation, unknown push reconciliation, cancel/reboot/process identities,
  exact CI/DEV gates, token redaction, archival dedupe, installer DRY and isolated full reversal.
- `python3 -B scripts/chatops/tests/test_dev_workflow.py`: **1 passed**.
- `python3 -B scripts/chatops/tests/test_admin_deploy.py`: **20 passed** (isolated fake protocol).
- Python AST parse, PyYAML parse of both train workflows, Bash syntax of helper, Node syntax of
  monitor extension: passed. No actionlint binary was available; GitHub workflow acceptance is pending.
- LIVE library SHA pins verified; helper remainder reconstructed byte-for-byte to LIVE hash.

All checks are author simulations/static checks. No actual workflow, model-stage inference,
root installation, service migration, remote push, Product CI, DEV deploy/smoke/ACCEPTED or rollback
was run. No repeated V6 model review was performed. Installed and accepted are separate facts.

## Pending live review / next bounded action

PMA reviews changed controller/receiver/journal/installer/monitor integration risks, resolves the
provided worktree's Git object/base discrepancy, commits only allowed files, and opens the reviewed
branch/PR with exact commit permalinks. This is the next bounded action; do not start product work.
Then follow the separate reviewed main-control/disabled install/probe/drain/activation sequence.
Confirm actual old unit names, executable paths, group 65042, V6 continuity policy, main Environment
access, default-branch workflow availability, restricted SSH and real before hashes. Do not stop
#151/#156 to make an installer test pass. Unknown author/QA/push/deploy stays fail closed.

Monitor module/browser mapping still requires PMA application to actual installed monitor paths;
prepared extension files are not a claim that the live monitor changed. Root proof must cite an
actual successful shadow probe, not this local test suite. PROD is outside authority.

Rollback first disables new dispatch and restores old runtime only at a compatible quiescent
boundary. It never overwrites new history/attempts/budgets or silently re-enables scheduling of
Actions-only deferrals. A future team can continue from this file, the linked contract, manifests,
root receipts and exact GitHub result artifacts without reading the original chat.

## PMA integration corrections · 2026-10-21 UTC

FACT: author finished rc0; no duplicate author. The source base is correct: HEAD60b734fe is the PMA prompt-only commit on DEV4977074e, not application drift. Git object read restrictions affected only the author sandbox; normal authorized integrator Git works. No global access/alternates repair was needed.

Real hosted probe39686800647 was rejected before any runner step because environment dev permits exactly branch dev. It did not test SSH and is not a credential failure. Keep the environment protection unchanged. Default main contains only event/registration workflows; secret-bearing dispatcher/stage runs are explicitly dispatched on dev and checkout an immutable reviewed controller commit. Root verifies the exact reviewed stage workflow bytes at the run's SHA, allowing normal product DEV advancement but refusing a modified workflow or checkout pin. No candidate code is executed with deployment credentials.

Integration changes: existing slot2 known_hosts path; task-specific routing profile persists over continuations; ordinary promotion drift returns to finite integration without a push; non-model old unit cgroup checks avoid inspecting unrelated same-UID processes; only a root-recorded exact quiescent unpublished promoting checkpoint can transfer. Unknown mutation states remain refused. Monitor writer/app payloads are exact original hashes plus additive Actions source/rendering and are included in the installer backup/rollback; no extra static route, PIN or CSP change.

PMA independently ran 67 targeted tests in an isolated filesystem copy as nonroot: PASS. A direct run inside the private source checkout hit directory-read ACL restrictions in synthetic installer fixtures; the isolated copy retained file/ownership/security assertions and passed. No tests were disabled. This is deterministic integrator validation, not independent model review or live acceptance.

Old Supervisor was paused22:51:31Z; both workers were stopped only at verified clean child-free checkpoints22:54:54Z. Root record /var/lib/gb-actions-migration/quiescent-handoff.json preserves full state and no-push evidence. #151 promoting a3 a6077ba7, #156 ci a1 6f8b0cf3; no history/budget reset. The new train is still NOT installed/activated at this record. Restore old units if cutover cannot be completed safely.

## Hosted probe correction: canonical repository API root

FACT: hosted dispatcher39694116517/job119547217258 reached the permitted dev environment and immutable checkout but failed before SSH with GitHub response404. Reproduced from Germany: GET repository root with trailing slash404; canonical root without slash200/id1416250340/default main. Corrected only empty-path URL joining in core.API. Added canonical-root and wrong-identity negative tests; token destination, permissions, task admission, model roles and limits unchanged. New payload manifest records the one changed runtime file. Server remained disabled with #151/#156 checkpoints preserved; next proof must be an actual successful hosted run. No credential reset or copied session.
