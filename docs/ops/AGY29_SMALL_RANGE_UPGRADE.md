# AGY #29 small-range upgrade — two installed library files

Status: AUTHOR OPS source at base `2d926322c2a7a4d68e09e128c3e1ba2d01a4c6c8`
(dev, PR #328 merge). Uncommitted author checks are not independent QA, CI,
DEV acceptance or installation. The installation bundle must be the future
reviewed dev merge **containing this installer**; the base alone is unusable.

## Purpose and exact effects

This installer installs only the reviewed small-range Owner-package library
pair from PR #328. It does not create or accept a package, grant, admission or
budget, call a model, use the network, reconcile UNKNOWN, clear pending state,
change policy/rules/markers/slots/ledgers/journals, or start/unmask units.
The separate reconciliation of slot2 pending UNKNOWN is outside this change;
any pending operation makes this installer refuse.

| File under `/usr/local/lib/gb-actions-train/` | Required installed SHA-256 | New SHA-256 |
| --- | --- | --- |
| `antigravity_qa_recovery.py` | `e0785eeefa1117f0e0d3219637c2f58493412dfa945986e3f63c21a86f20f45a` | `93efc05c7aa46fc7ff0d6da70f0db01a9ebda434dbc7d99066590e0459a92a2e` |
| `owner_package_admission.py` | `4adbed703b420ab435a3d1d545c2c076a7bd5574bdf940143f8cf8447a9c74ae` | `bb5bf8516d26ae293f16d794c2e46f90b01d0c27b34da15febbd0bff4398c7c5` |

Writes are limited to those two files (root:root 0644), their two `after`
values in `STATE/backup.json` (root:root 0600),
`STATE/agy29-small-range-upgrade-backup/` (0700, containing `inventory` and
both modules, each root:root 0600), and
`STATE/agy29-small-range-upgrade.json` (root:root 0600).
Here `STATE` is `/var/lib/gobadminton-actions-train`.
The existing controller lock is held without changing its bytes.

Each old 64-hex inventory value must occur exactly once in the original bytes;
each new value must be absent. The replacements must parse as exactly the two
changed entries. Length, layout, every other field and saved metadata survive.
The inventory retains exactly 32 entries and manifest
`0f16f0d60e05d13fa1778f5e9220341b4f62149ddc3e99ced10235344cf21944`.
The observed inventory SHA `c2c571a36cff4781c32eb8a0f2a0d8afb024570a39d006e070c7c303f8b764eb`
is a factsC observation, not a permanent runtime constant. The live inventory
must be the exact byte result of #326's inventory edit, reconstructed from its
pinned receipt/backups, and every entry must match its live file.
No manifest.json or other bundle entry is installed.

## Preconditions and preserved gates

Only trusted OPS, using the existing authorized host mechanism after independent
review and integration checks, may run this tool. This document gives no new
host authority. The repository script is 0644. Its copied host script must be
root:root, exactly 0700, single-linked, in a root-owned directory without
group/world writes; all trusted path/no-follow checks remain mandatory.

The bundle must be a clean root-owned plain checkout with a real `.git`
directory and exact 40-hex HEAD, a two-parent merge descending from PR #326 merge
`aa9ece4d74d3e984ce75e59457304117a1438ff6`. Origin must be exactly
`https://github.com/anpavel84-afk/gobadminton-clean.git` or
`git@github.com:anpavel84-afk/gobadminton-clean.git`.
The running installer must equal its bundle commit blob. Script, both targets,
manifest and workflow must each match their exact Git blobs.

Bundle manifest must hash to
`3b39bb7fb810e97e4d6163dfc93356260d2a966ecbc66b4410c8b06deab0e150`;
both target entries and bytes must equal the new pins above.
Workflow stays `b9703ca27b7bb3f494f379f8e259e62a6a48bc8f5ff50c6923e1712d8899d68d`
and contains `ref: 41e12be2d551158e97ea30eaf8e95f992f998615`.
Policy must be active with this exact controller/workflow pair.

The complete bundle tree passes the root-owned trusted-tree check before Git.
Gitfiles, symlinks, `.git/{commondir,gitdir,objects/info/alternates,modules,info/attributes}`,
filter attributes, executable/helper/include/credential/protocol config,
dangerous core/diff/url keys, ambiguous syntax and continuations refuse.
Only inert hooksPath values are accepted. Scrubbed Git uses explicit git-dir
and work-tree, no inherited credentials/config, replacement objects, hooks,
attributes, fsmonitor, untrackedCache or optional locks; `protocol.allow=never`.
The template's status ignore/index/submodule semantics are preserved alongside
the five explicit blob comparisons.

Installed trusted imports and the full final lib table remain pinned.
The two changing entries use old/new checks at the transaction stages;
every other table value equals #326, including native_antigravity
`01d4816e881765da6361af07a15765528aef274dad0eb780b1afab6b0e5e0f72` and
rules `017441dec5ba197a1065b6ef90efdddb090b286ba48687241a7fbc09dd002269`.
Component-wise no-follow reads, single links, size limits, metadata/race checks,
O_EXCL temporary files, saved fchown/fchmod, fsync/rename/readback all remain.
Protected-state hashes stream up to 1 GiB; pinned/bundle/lib reads keep 64 MiB.

The `idle()` predicate is identical to #326: each journal pending is None;
checkpoint active is None or a dict with phase `done`; no model processes;
worker/lease locks unheld; units inactive, MainPID=0 and masked; no
integration.json. The installer never edits state to make these gates pass.

## Immutable installed chain

The mandatory active receipt chain is C5 → re-record → pkg-finish → admission.
All #326 checks for C5 rules provenance and the two earlier transactions,
including exact backup sets and hashes, remain unchanged.

| Layer | Receipt SHA-256 | Commit |
| --- | --- | --- |
| C5 | `04106cc1a6a2afa0bd840244b270947b129b661cca77834eed7f1fe1e008a704` | controller `41e12be2d551158e97ea30eaf8e95f992f998615` |
| Re-record | `eddb548a46d4f3fd2ab22683cf207c77fecfdcc937b5298e939a1c2f4df6bfed` | `e6af59ea2bc6922ed12585b128d9e14b263e9f20` |
| Pkg-finish | `690e49a05f6127558c8e0ef8c2c69abbfcf7df7043f95f320fbae3518fb127da` | `f948d367292e85fc422dba2f8a3f6efd44400777` |
| Admission #326 | `963575dd50a34137bf52999f73a2aa73c7b85aa36813e582af360ae9d66e54b6` | `aa9ece4d74d3e984ce75e59457304117a1438ff6` |

`agy29-admission-upgrade.json` must have schema
`GB_AGY29_ADMISSION_UPGRADE_V1`, phase `active`, the commit above, manifest
`be349608b39d33cad2af86069eccf09c8fb170a2daac3a472ade573c8e613742`,
script SHA `67a43953b86c5955739a2336ab4aa904f39437705f67065dfc672247a8ce9df9`,
and new SHA equal to the installed admission pin in the first table.
Its backup set must be exactly admission module and inventory. Both backup
hashes/recorded metadata must match its observation; the observation digest
must verify. Its admission backup must be
`f5dfd7e08b726f0a5318e7f6edb9eb15bbd39052a398ad7125ea35eb39569417`.
Its inventory backup must equal the pkg-finish result. Replaying #326's unique
single-value byte edit reconstructs the exact required current inventory.
The pre-#326 state refuses, even if the earlier layers are correct.

## Root commands and fresh-dry binding

Replace `<token>` with the reviewed host-copy identifier;
`/root/gb-agy29-small-range-bundle-<reviewed-merge-token>` denotes the prepared
root-owned local bundle path, not a download command. `<REVIEWED_MERGE_SHA>`
must be the future reviewed merge containing this installer. These commands
are for authorized trusted OPS; they are not executed in the author session.

```sh
/usr/bin/python3 -B /root/gb-agy29-small-range-upgrade-<token>.py dry --bundle /root/gb-agy29-small-range-bundle-<reviewed-merge-token> --commit <REVIEWED_MERGE_SHA>
/usr/bin/python3 -B /root/gb-agy29-small-range-upgrade-<token>.py apply --bundle /root/gb-agy29-small-range-bundle-<reviewed-merge-token> --commit <REVIEWED_MERGE_SHA> --observation-sha256 <FRESH_DRY_OBSERVATION_SHA256>
/usr/bin/python3 -B /root/gb-agy29-small-range-upgrade-<token>.py verify --bundle /root/gb-agy29-small-range-bundle-<reviewed-merge-token> --commit <REVIEWED_MERGE_SHA>
/usr/bin/python3 -B /root/gb-agy29-small-range-upgrade-<token>.py rollback --bundle /root/gb-agy29-small-range-bundle-<reviewed-merge-token> --commit <REVIEWED_MERGE_SHA>
```

`dry` writes nothing. Its JSON binds the script, exact inventory, both target
metadata, lower receipts and full protected-state observation; planned writes
show two lib files/two inventory values and zero model/policy effects.
Only this layer's receipt/backups, inventory and controller.lock are excluded
under STATE; both changing library targets have separate strict checks.
Every other STATE file, all lower receipts/backups, slot state, histories,
ledgers, required admissions, policy, marker and budget remain protected.

**Run apply immediately after a fresh dry.** The digest includes routine
train-watch rewrites such as planning.json. `dry observation changed; rerun dry`
means repeat dry and bind its new digest; no installed write has occurred.
Do not exclude routine state or reuse an older digest.

Apply holds the controller lock, binds the observation, backs up both files
and inventory, and re-observes before installed writes. Receipt schema
`GB_AGY29_SMALL_RANGE_UPGRADE_V1` advances `backed_up` → `target_installed`
→ `active`. The durable write-ahead receipt precedes either target replacement;
`backed_up` can therefore also describe a partial pair after interruption.
The new_sha256 field is a per-module map. Each target is rechecked immediately
before its write, and both new hashes/metadata are checked before inventory.

Import-only smoke runs for UIDs 1002 and 978 in `unshare -n` + `setpriv`, with
scrubbed environment and Python `-I -B`. It imports both modules, checks
`EXPECTED_PINS`, callable `accept`, `OWNER_PACKAGE_SOURCES` and callable
`package_rules_ok`. It calls none of those functions and performs no fixture,
bytecode, live-state or model operation. It retains #326's import-smoke gate.
Apply ends in verify. Failures after the write-ahead stage attempt exact
restoration of both targets and inventory. Backup/pre-receipt failures do not
write installed files; a completed write-ahead receipt is retained on a
post-write receipt error. Backups and receipts are never blindly discarded
once the transaction is recorded.

An identical active verified apply is an idempotent read-only no-op. Other
existing transaction states refuse. Verify requires active phase, idle state,
unchanged protected state, the complete pinned chain, new target hashes and
saved metadata, the exact two-value inventory edit and all live entry hashes.

Rollback requires idle/unchanged protected state and accepts only each target's
old/new bytes and the original/edited inventory bytes. It checks **all** files
before any restore writes, restores exact backups and metadata, and records
`rolled_back`; another rollback refuses. Foreign bytes are never overwritten.
If restore fails or protected state drifts, phase becomes `rollback_failed`;
retain evidence and reconcile the exact outcome rather than retry blindly.

## Earlier installers and unwind limitation

The three existing installers/docs remain byte-identical. #326 admission and
#325 pkg-finish refuse the new bundle as `bundle manifest drift`; substituting
only that manifest pin still fails their old target pins. They cannot install
this pair. #324 re-record has **no bundle manifest/target gate**: its source
check may accept a descendant bundle with its unchanged script. Reuse on the
required already-installed stack refuses through its existing guarded
transaction/state checks. No claim that #324 itself rejects the new manifest
is made; tests preserve this distinction.

Logical unwind is small-range → admission → pkg-finish → re-record.
After this rollback, both files, inventory and all lower evidence are restored
or unchanged byte-for-byte. As with #326, a full lower unwind remains blocked:
this layer's retained receipt/backups are new protected state for the older
installers. Tests show #326 verify/rollback refuse both while active and after
rollback. Any lower unwind needs separately reviewed reconciliation of this
preserved evidence. This tool never deletes/moves it or edits old observations.

## Validation boundary

Tests use TMPDIR synthetic hosts, substituted test ownership and mocked host
commands; bundle tests use synthetic Git responses and actual repository blobs.
No live paths, network or models are used. The future merged installer bundle,
real root ownership, unshare/setpriv and host operation are NOT_TESTED.
Targeted regressions, write-stage failure injections, scratch mutations,
foundation/diff checks and file hashes are recorded in the evidence directory's
AUTHOR_REPORT.txt. Independent QA and CI remain required before installation.
