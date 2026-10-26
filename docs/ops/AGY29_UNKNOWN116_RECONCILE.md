# Slot2 UNKNOWN116 scheduling reconciliation

Prepared source for independent review; author verification is offline only. This document is not execution authority or an independent QA verdict. The source is `scripts/chatops/ops/agy29_unknown116_reconcile.py`.

This one-operation script releases scheduling occupancy for operation `36aec3485a221a0c61fe84941877b15d57c8a07efbc8e081e20c478e61dcc210`, issue 29, QA qualification, run `40316758633`, attempt 1. Its recorded result is terminal `unknown`, reason `AGY_INPUT_LIMIT`, `safe_release=false`. The refusal happened before any model call; phase-03 says `not_charged`. The separate reservation, grant charge and historical charge receipts stay intact.

The only persistent change to an existing protected file is `/var/lib/gobadminton-actions-train/slot2.json`: generation `115` becomes `116` and `pending` becomes `null`. Every other journal field, including the complete operations map and UNKNOWN result, remains unchanged. The UNKNOWN stays consumed: never replayed, refunded or reset. Another model call requires a NEW Owner package through the existing admission process; this script does not create one.

Policy `/etc/gobadminton-actions-train/policy.json` is temporarily disabled for the transaction and restored byte-exact with mode `0644`, owner `root:root`. The journal stays `0600 root:root`. Apply creates root-owned transaction metadata under controller state: `agy29-unknown116-scheduling-reconciliation.json` and `agy29-unknown116-scheduling-backup/` (journal, policy and state-manifest backups). These are additional audit artifacts, not changes to other existing state files. Writes use `.rec116` temporary files, fsync, atomic replacement, and explicit owner/mode checks.

No model, GitHub/network, replay/refund, PROD, Supervisor, checkout movement, module installation, attempt edits or `/etc/gobadminton-slots/*.json` writes are performed. Slot1's generation is deliberately not pinned: it must be idle and remain byte-stable during the transaction.

## Preconditions

- An authorized integrator has independently reviewed these exact source bytes and installed the script at the exact root path below. Source authoring does not install it.
- Policy is active under controller `41e12be2d551158e97ea30eaf8e95f992f998615`; policy bytes, mode and owner match the pins. The journal has the exact eight-key shape, pinned bytes, generation 115 and `pending == OP` exactly.
- The entire operation digest, binding, result, process identity and idle checkpoint `{active: null, done: [152, 205, 216]}` match the observations. The original process is dead. All 13 immutable file pins match.
- Evidence contains exactly phase-01 through phase-03. Full JSON content proves preflight, selected model `claude-sonnet-5-5-medium`, then terminal pre-model `AGY_INPUT_LIMIT`; no stdout/stderr files exist.
- Worktree `/srv/gb-slots/slot2/worktrees/antigravity-qa-29-canary` has HEAD exactly `12f35ac4430348ae811cf712d9bb24d2a19b62e6`. Before **every** Git command, regular-file reads (no Git config subprocess) inspect `.git` as a directory or normal linked-worktree pointer, including the common directory, config/config.worktree, info and hooks. Only a deliberately narrow config grammar is accepted: core repositoryformatversion=0, bare=false, filemode/ignorecase/precomposeunicode booleans, logallrefupdates/symlinks=true; extensions.worktreeConfig=true; user name/email; remote URL/fetch; branch remote/merge; status.showUntrackedFiles=no/normal/all. Every other section/key, includes, escapes and continuations are refused. Only info/exclude and inert hooks/*.sample are accepted in those auxiliary directories; alternates and shallow layouts are refused. No local executable-helper configuration is accepted, even if a command-line override would disable it.
- Git reads run as `gb-slot2` with a scrubbed environment, global/system config disabled, replacement objects and lazy fetching disabled, `--no-optional-locks`, and forced core.fsmonitor=false, core.hooksPath=/dev/null, core.untrackedCache=false, protocol.allow=never, core.pager=cat. HEAD uses `rev-parse --verify HEAD^{commit}`. Status forces `--untracked-files=all --ignored=matching --ignore-submodules=all`; every `ls-files -v` tag must be H. The stage-0 index must equal the recursive HEAD tree, and raw diff-index (no renames, external diff, textconv or submodule recursion) must be empty. Independently, every tracked file is read without following links and hashed as a raw Git blob in Python, bypassing index flags/stat caches and all attribute filters; its executable bit must match HEAD.
- This proves observed raw regular-file content and executable-bit equality, plus absence of files reported untracked or ignored by forced status. Symlinks, hardlinks, gitlinks/submodules, non-SHA1 trees, unsupported configs/layouts, unsafe paths and over-limit inputs fail closed. It does not prove other metadata, unobserved external state, preservation against concurrent writers, or a filesystem-wide atomic snapshot. Operational quiescence remains required. Git commands have a 20-second timeout and combined stdout/stderr cap of 16 MiB; config/auxiliary files are capped at 64 KiB, pointer files at 4 KiB, auxiliary directories at 128 entries. Content proof allows at most 10,000 tracked files, 16 MiB per file, 256 MiB total and a 20-second hashing window. A later separately reviewed step may move that checkout. If it has moved, this script refuses and never moves it back. The supplied observations have `work_head=null`; the source does not treat that as proof of HEAD or cleanliness.
- Both slots are idle apart from the exact Slot2 occupancy being reconciled; worker/lease locks are unheld, units inactive and masked, no model processes and no integration. The installed admission tool's own `quiescent()` must pass with the predicted journal during dry, and with the live released journal after apply. Dry's current-state quiescence refusal for the known pending occupancy is informational only.
- Slot1's checkpoint must have `active: null` or exactly `active: {issue: 313, phase: "done", head: "bdd912a82a2f0087f4cfc9c6820edc8c49ee6527", attempt: 1}` with integer `313` already present in its saved `done` list. This is **not generic tolerance of any done checkpoint**: another issue/head/attempt, extra active fields, missing matching done entry, or a blocked/running phase refuses before writes. The exact terminal record is only an immutable observed idle status, never a new claim/admission. No Slot1 checkpoint is cleared or edited; the full observed Slot1 state and protected-state manifest must remain equal before/after and during verify.
- There is no existing transaction receipt/backup or stale protected-file temporary. Apply and rollback acquire existing `controller.lock` without creating or replacing it.

## Commands and ordering

Run **fresh dry immediately before apply**, on the same reviewed script and unchanged state. Dry is read-only; this ordering is an operator precondition, not a fabricated persisted dry authorization. Apply repeats strict preflight twice and refuses any drift. Save stdout/stderr through the existing authorized evidence process.

```text
/usr/bin/python3 -B /root/gb-agy29-unknown116-scheduling-reconcile-20261026.py dry
/usr/bin/python3 -B /root/gb-agy29-unknown116-scheduling-reconcile-20261026.py apply
/usr/bin/python3 -B /root/gb-agy29-unknown116-scheduling-reconcile-20261026.py verify
```

Only proceed after `DRY_RUN_PASS`. Apply writes backups and a write-ahead receipt before disabling policy or changing the journal. It checks the full protected-state manifest before and after, allowing only `state/slot2.json` to differ, rechecks evidence/process/worktree, restores policy bytes/mode/owner, and rechecks postconditions. Verify writes nothing and requires the same manifest, operation, policy, checkpoint and proof.

The manifest retains the template's boundaries: controller state and both autonomy slot-state trees, budget, marker, and lease bytes. Transaction receipt/backups, controller lock and policy are excluded; policy has separate exact checks. Slot-tree `.lock` entries are observed for held locks rather than included in the content manifest. Outbox telemetry is outside these traversed trees; it is not pinned. Planning and other changing state files have no fixed historical pins, but must be stable across this transaction and match the saved manifest at verify/rollback. The manifest proves content, not preservation of every other file's timestamps or metadata.

The subprocess scope is bounded read-only Git against this one worktree through `/usr/sbin/runuser -u gb-slot2`, and bounded read-only `systemctl show/is-*` through the inherited receiver/admission checks. This module's own helper allows only its exact `systemctl show` argv and six exact Git queries. There are no other subprocess kinds. The additional unit-property read is retained: `R.units_quiet` accepts disabled **or** masked, while this operation requires masked. `R.no_models` additionally checks slot cgroups; admission quiescence remains mandatory. These inherited checks are not a git-only subprocess scope.

## Rollback and failure handling

```text
/usr/bin/python3 -B /root/gb-agy29-unknown116-scheduling-reconcile-20261026.py rollback
```

Rollback returns the journal to its exact original bytes (generation 115 and the same pending UNKNOWN), restores policy exactly, and retains audit artifacts. The operation and all accounting/history remain unchanged. Repeated rollback validates the receipt, backups and restored state, then returns `ALREADY_ROLLED_BACK` without writes. Apply is not repeated against an existing transaction.

Rollback refuses foreign receipt, backup, policy or journal bytes and manifest drift before any protected write. Unlike the broader template, it does not adopt a later controller policy or tolerate later state changes. Resolve that situation through a separately reviewed operation; never overwrite it here. Rollback also requires the original proof and quiescence conditions.

An apply failure attempts exact automatic restoration under the lock. If restoration cannot be proven, the receiver is left disabled, the receipt records `restore_failed` where writable, and stderr prints the exact manual rollback command. Do not re-enable policy while preservation is unproven. A backup-phase failure before protected writes removes only known partial backup files if state is still identical. If state drifted, it leaves policy disabled and prints the template's inspection hint; without a usable receipt, ordinary rollback cannot claim restoration.

Restoration checks the original manifest **before** restoring active policy, then again afterwards. The early check must refuse foreign state without even temporarily reactivating policy; the later check alone cannot provide that guarantee.

## Offline author evidence

Tests use a checked-in observation subset, synthetic receiver/admission modules and scratch repositories under TMPDIR or tempfile's fallback when TMPDIR is unset. A Git executor is injected: scratch Git runs as the test identity, and real runuser/systemctl never execute. They execute no live script command or protected-path read. The author report, test logs and mutation results are in the task evidence directory supplied with the assignment. Independent QA, installed admission compatibility, live dry/apply/verify and CI remain separate gates.
