# AGY #29 admission upgrade — one installed library file

Status: AUTHOR OPS source; uncommitted worktree additions at base
`483379888843db31f39dbdbf3326ac645ef9d394` (dev, PR #325 merge).
No independent QA, CI, DEV acceptance or live installation is claimed.
The future reviewed dev merge containing this installer is the install bundle
commit; the base above is not a usable installer bundle.

## Purpose and exact effects

PR #325 makes `owner_package_admission.quiescent()` accept a finished slot
checkpoint (`active` is a dict with `phase == 'done'`). The installed file must
move from `f5dfd7e08b726f0a5318e7f6edb9eb15bbd39052a398ad7125ea35eb39569417`
to `4adbed703b420ab435a3d1d545c2c076a7bd5574bdf940143f8cf8447a9c74ae`.
The existing package-finish installer pins an older manifest and the
`d72c85da…` → `f5dfd7e0…` pair; it refuses this bundle as `bundle manifest drift`.
It is unchanged and must not be used to install or roll back the new file.

The new `scripts/chatops/ops/agy29_admission_upgrade.py` writes only:

- `/usr/local/lib/gb-actions-train/owner_package_admission.py`, root:root 0644;
- the single matching `STATE/backup.json.after` value, root:root 0600;
- `STATE/agy29-admission-upgrade-backup/` (0700), containing `inventory` and
  `owner_package_admission.py` (0600), and
  `STATE/agy29-admission-upgrade.json` (0600).

The inventory edit replaces exactly one occurrence of the old 64-hex value
with the new value, only if the new value is absent. Length, layout, owner,
group, mode and all other parsed fields are preserved. The inventory `manifest`
remains `0f16f0d60e05d13fa1778f5e9220341b4f62149ddc3e99ced10235344cf21944`.
No other manifest entry is installed. There are no policy, marker, rules,
budget, slot, ledger or admission writes, network calls or model calls.
The controller lock is held using the existing file without changing its bytes.

## Preconditions

Trusted OPS uses the existing authorized host mechanism, after independent
review and required integration checks. This document gives no host authority.
Copy the reviewed installer to a root-owned non-writable directory, root:root,
single link, mode 0700. Its repository mode remains 0644 like the template.

All template hardening remains: root-only execution; trusted installed import
paths and the full unchanged-lib table (including the package-finish versions
of native_antigravity and qa_recovery); component-wise no-follow reads, single
links, bounded sizes and race checks; streamed protected-state hashes up to
1 GiB. Pinned/bundle/lib reads retain the 64 MiB bound.

The bundle must be a clean, root-owned plain checkout with a real `.git`
directory. Its exact 40-hex HEAD must be a two-parent merge descending from
`bdd912a82a2f0087f4cfc9c6820edc8c49ee6527`. The origin must be the exact CLEAN
HTTPS or SSH URL ending `.git`. The running script must equal the reviewed
installer blob. Installer, target, manifest and workflow worktree bytes must
all equal `git show <commit>:<path>`.

Before any Git subprocess the complete tree must pass the trusted-tree gate;
gitfiles, symlinks and `.git/{commondir,gitdir,objects/info/alternates,modules,info/attributes}`
refuse. Local config and config.worktree refuse executable/helper/include/
credential/protocol sections, dangerous core/diff/url keys, unsupported syntax
and continuations. Only inert hooksPath values are allowed. Filter attributes
in `.gitattributes` or `.gitmodules` refuse. The copied scrubbed Git helper
uses explicit git-dir/work-tree, disables optional locks and replacement
objects, hooks, attributes, fsmonitor and untrackedCache, and sets
`protocol.allow=never`. No inherited Git configuration or credentials reach it.
Git status retains the template's ignore/index/submodule semantics; the four
explicit blob comparisons remain additional mandatory checks.

The bundle manifest SHA-256 must be
`be349608b39d33cad2af86069eccf09c8fb170a2daac3a472ade573c8e613742`;
its target entry and target bytes must both equal `4adbed70…74ae`.
Mismatch refuses as `bundle manifest drift`. The workflow must hash to
`b9703ca27b7bb3f494f379f8e259e62a6a48bc8f5ff50c6923e1712d8899d68d`
and contain `ref: 41e12be2d551158e97ea30eaf8e95f992f998615`.

Policy must remain active at that controller/workflow pair. For both slots,
`pending` must be `None` and `active` either `None` or a dict with `phase='done'`.
Every other phase and non-dict value refuses as `slot occupied`. Model processes
must be absent; worker/lease locks unheld; units inactive with MainPID=0 and
masked; integration.json absent. Policy bytes are never rewritten to get idle.

## Immutable lower stack

Both lower transactions must be active, byte-pinned and semantically exact:

| Layer | Receipt SHA-256 | Commit |
| --- | --- | --- |
| Re-record | `eddb548a46d4f3fd2ab22683cf207c77fecfdcc937b5298e939a1c2f4df6bfed` | `e6af59ea2bc6922ed12585b128d9e14b263e9f20` |
| Pkg-finish | `690e49a05f6127558c8e0ef8c2c69abbfcf7df7043f95f320fbae3518fb127da` | `f948d367292e85fc422dba2f8a3f6efd44400777` |

The re-record schema is `GB_AGY29_INVENTORY_RERECORD_V1`, with
`new_sha256=4a7d4c07f2c8a856f60d3797f39fdbf5905f08838f457ae711044726ae859981`
and `script_sha256=6de969a9070384c7a45deb605771e93a969fbc82f7d11d829d9603d31ce50712`.
Its backup inventory must hash to its receipt's value (`588877c2…c0776`).
The pkg-finish schema is `GB_AGY29_PKG_FINISH_INSTALL_V1`, with manifest
`b2c4dd72a1844e972d007a9034cc89f5c120cf8f934c7fdfef9fae1efe275ed5` and observation
`2b06fd3f53386a63bd0e4114a80c6c54943938eb7151c5d5d54ea33b370f691a`.
Its backup set is exactly the three package targets, inventory, marker and
policy. Every backup's bytes must match its recorded SHA. Its admission backup
must be `d72c85da…f026`; its inventory backup SHA must equal the re-record's
`new_sha256`. The existing pinned active C5 rules receipt/backup proof also
remains mandatory.

The current inventory must equal the pkg-finish backup inventory parsed with
exactly its three target entries replaced by their pkg-finish new pins:
native `01d4816e…0f72`, qa_recovery `e0785eee…f45a`, admission `f5dfd7e0…9417`.
It must contain exactly 32 entries and the old full manifest. Rules must already
be `017441de…2269`; there is no stale-rules exception. Every entry must equal its
live file hash, and the live admission target must be the old hash.

## Dry, apply, verify, rollback

Replace placeholders with the future reviewed merge and its local bundle.
These commands are for authorized trusted OPS, not this source-author session:

```sh
/usr/bin/python3 -B /root/agy29_admission_upgrade.py dry --bundle /root/agy29-admission-bundle --commit <MERGE_SHA>
/usr/bin/python3 -B /root/agy29_admission_upgrade.py apply --bundle /root/agy29-admission-bundle --commit <MERGE_SHA> --observation-sha256 <DRY_OBSERVATION_SHA256>
/usr/bin/python3 -B /root/agy29_admission_upgrade.py verify --bundle /root/agy29-admission-bundle --commit <MERGE_SHA>
/usr/bin/python3 -B /root/agy29_admission_upgrade.py rollback --bundle /root/agy29-admission-bundle --commit <MERGE_SHA>
```

`dry` writes nothing and emits one JSON line including script/observation SHA,
full observation, target/inventory change, planned writes and `model_calls=0`.
The protected walk excludes only this layer's J/BK, backup.json and
controller.lock under STATE. The changing library target is checked separately.
All lower receipts/backups, C5 evidence and every other STATE file remain
protected. **The digest also binds routine train-watch rewrites, including
planning.json. Run apply immediately after a fresh dry.** On
`dry observation changed; rerun dry`, repeat dry then apply; nothing was written.
Do not exclude the changing file or reuse the stale digest.

`apply` locks, binds the observation, backs up target/inventory and re-observes.
The write-ahead receipt schema `GB_AGY29_ADMISSION_UPGRADE_V1` advances through
`backed_up` → `target_installed` → `active`. Replacements use O_EXCL/NOFOLLOW
temps, saved fchown/fchmod metadata, fsync, rename and readback. Before the
inventory edit an import-only smoke runs in `unshare -n` + `setpriv` as UIDs
1002 and 978 with a scrubbed environment and Python `-I -B`. It imports the
installed module, checks nonempty EXPECTED_PINS and callable accept, and calls
neither accept nor any live-state or model operation. It creates no fixture or
bytecode files. Apply ends with verify; failures attempt exact target/inventory
restoration. If guarded restoration cannot complete, J becomes `rollback_failed`;
retain J/BK and reconcile, never blindly retry an unknown outcome.

An already active identical verified transaction re-applies as a read-only
no-op. Any other pre-existing J/BK refuses. `verify` is read-only and requires
active phase, idle state, unchanged protected state, both pinned lower receipts,
new target bytes and saved metadata, the exact single inventory edit, and all
live inventory hashes. `rollback` requires idle and unchanged protected state,
accepts only old/new target and original/edited inventory bytes, restores exact
old bytes and metadata, and records `rolled_back`. A second rollback refuses.
Protected-state drift blocks both verify and rollback; automatic restore can
therefore leave `rollback_failed` rather than overwriting foreign state.

## Unwinding and a pre-existing lower-layer limitation

Logical unwind order is admission upgrade → pkg-finish → re-record. While this
upgrade is active, lower verify/rollback refuse: the target/inventory pair has
changed, and this layer's J/BK are new protected state. After this upgrade's
rollback, the pkg-finish target/inventory pair and all lower receipts/backups
are byte-identical to their pre-upgrade state.

**Full lower-layer unwind is not directly executable with the unchanged lower
installers.** They do not exclude this new layer's J/BK, which must survive
rollback as audit evidence. Thus even after the pair is restored, their
protected-state checks still refuse. A synthetic regression demonstrates this
with the existing pkg-finish verifier and rollback. Before a lower rollback,
trusted OPS needs a separately reviewed reconciliation of this preserved
upgrade evidence. This installer neither deletes/moves it nor rewrites lower
observations/receipts. Claiming automatic three-layer unwind would be false;
resolving that gap is outside the three allowed new files.

## Author validation boundary

Tests use only synthetic state and test-identity ownership substitutions.
They exercise atomic replacement, mode preservation, observations, strict
lower receipts/backups, refusal paths, automatic recovery and idle predicates.
Bundle tests use local synthetic blob responses; the actual future merge is
not available in this uncommitted source task. Real root ownership, actual
unshare/setpriv isolation, installed host state and deployment are NOT_TESTED.
The evidence directory's AUTHOR_REPORT.txt records targeted tests, pristine
comparison, mutation sanity, foundation/diff checks and final file hashes.
These are author checks, not independent QA or runtime acceptance.
