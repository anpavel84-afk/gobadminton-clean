# AGY #29 package finish

Status: AUTHOR source change; no independent QA, CI, DEV acceptance or live install claimed. Base/candidate source: dev `bdd912a82a2f0087f4cfc9c6820edc8c49ee6527` plus the uncommitted reviewed diff. Assignment: Owner's AGY #29 package finish; sole author in this checkout, no PMA takeover. Rules: EOM 1.4, commit `13a8b6c54a45aaa57021e092a1bee54926d9eac4`, SHA-256 `8798ea76874ea5e42f708fff6d74f1ccbf526413c701e9f2349045fdc98be9d5`. Direct bounded AUTHOR route as assigned; effective model identity is supplied by the launcher, not asserted by source. Allowed effects here are the three-file scoped installer, archive-aware package validation, marker acceptance, tests and this runbook. Actual source/candidate merge SHA and independent QA/CI receipts must be recorded by the integrator before installation.

Hardening follow-up: fix-author continues the same branch and sole-writer scope at local source `127ff2f3edee50f94e3a2d246d271a1344144673` (the package-finish commit), with an uncommitted diff limited to this runbook, the installer and `test_actions_train_pkg_finish.py`. This follow-up changes checkout validation and the idle predicate only; pins, three install targets, verbs and write effects remain as above. No network, model CLI, root operation or live state access is part of this author task.

Package `6404499964` has a spent COMPLETE analysis and one unspent QA grant. Install the parser and package fixes before `--qa`; retain controller `41e12be2d551158e97ea30eaf8e95f992f998615`, workflow hash `b9703ca27b7bb3f494f379f8e259e62a6a48bc8f5ff50c6923e1712d8899d68d`, installed context_policy hash `d961079b9791f53cf7ce0ac208180b0c9d9100ef46b48c025c2938d2eb69a806` and rules hash `017441dec5ba197a1065b6ef90efdddb090b286ba48687241a7fbc09dd002269`.

## Preconditions and install

Trusted OPS prepares a clean, root-owned checkout of the reviewed dev merge commit, with the CLEAN origin. No release branch or workflow rewrite is needed. Copy the reviewed installer to `/root/agy29_pkg_finish_install.py`, root:root mode 0700 in a root-owned directory without group/world write permission. Use the existing authorized OPS mechanism; this document grants no host access. Both slots must be idle with no pending work, no model process, free worker/lease locks, inactive masked supervisor/slot units and no integration. A checkpoint is free when `active` is `None` or a dict with `phase == 'done'`, for either slot, matching the train's completed-record rule. Every other phase, a missing/odd phase or a non-dict active value is occupied; journal `pending` must still be `None`. The installer holds the existing controller lock for writes. Policy stays active and byte-identical; masking and lock exclusion provide the quiet boundary.

Before any Git subprocess, the bundle must have a real `.git` directory (`lstat`): gitfiles and symlinks refuse explicitly. The existing root-ownership/no-links/non-writable tree gate remains mandatory over the entire bundle. `.git/commondir`, `.git/gitdir`, `.git/objects/info/alternates`, `.git/modules` and `.git/info/attributes` refuse. Config bytes (`.git/config` and `.git/config.worktree` if present) are checked locally before Git: filter, alias, include/includeIf, credential and protocol sections refuse; so do diff textconv/command, core fsmonitor/sshCommand/pager/editor, url insteadOf and core hooksPath except explicit inert `none` or `/dev/null`. Key/section case and legacy dotted subsections are covered. Unsupported config syntax (including continuations) refuses conservatively. Any worktree `.gitattributes` or `.gitmodules` with `filter=` refuses, including nested or untracked files.

Every Git call uses one helper, explicit verified `--git-dir`/`--work-tree`, `--no-optional-locks`, `--no-replace-objects` and only that bundle's `safe.directory`. Its environment is built from scratch: `PATH=/usr/bin:/bin`, `LC_ALL=C`, `HOME=/nonexistent`, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_SYSTEM=/dev/null`, `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`, `GIT_ATTR_NOSYSTEM=1`. No other inherited Git/config/credential variables reach Git. Command-line config forces fsmonitor off, hooksPath and attributesFile to `/dev/null`, untrackedCache off and protocol.allow to `never`.

Dirty detection retains `status --porcelain=v1 --untracked-files=all`, adding `--ignore-submodules=all`: staged changes, ordinary tracked modifications/deletions and non-ignored untracked paths refuse. Git ignore/index flags and stat/conversion semantics still apply; ignored files and submodule worktree contents are not an all-files byte audit. Before acceptance, the three target files, manifest and workflow additionally require exact worktree bytes equal to `git show <commit>:<path>` and the existing pins. Git status is reached only after config/attribute validation, so configured clean/smudge drivers cannot execute. No patch rendering, textconv or external diff is requested.

Replace `<MERGE_SHA>` and `/root/agy29-finish-bundle` with the exact reviewed commit and its local checkout. Verbs never fetch or clone. Run dry again after any train activity:

```sh
/usr/bin/python3 -B /root/agy29_pkg_finish_install.py dry --bundle /root/agy29-finish-bundle --commit <MERGE_SHA>
/usr/bin/python3 -B /root/agy29_pkg_finish_install.py apply --bundle /root/agy29-finish-bundle --commit <MERGE_SHA> --observation-sha256 <DRY_OBSERVATION_SHA256>
/usr/bin/python3 -B /root/agy29_pkg_finish_install.py verify --bundle /root/agy29-finish-bundle --commit <MERGE_SHA>
```

Dry is read-only. Its full observation includes journals, history, ledgers, slot state, budget, marker, policy, unchanged lib/monitor bytes and file metadata. Apply requires the observation digest, rechecks it under lock, saves the three targets plus inventory, policy and marker in `STATE/agy29-pkg-finish-backup`, and writes `STATE/agy29-pkg-finish-install.json` before any lib replacement. Backup policy/marker bytes are evidence only and are never restored over live state. Apply uses verified atomic replacements preserving target owner/group/mode, then read-only smoke tests under `unshare -n` and `setpriv` as UIDs 1002 and 978 with the unchanged installed context_policy. Smoke includes `qa_ready` against an inert archived COMPLETE analysis. Failures attempt exact rollback; inspect a `rollback_failed` receipt before any retry. A partial backup before J exists produces no installed delta and requires trusted OPS inspection; never blindly remove evidence or rerun an unknown outcome.

Only native_antigravity.py, antigravity_qa_recovery.py and owner_package_admission.py and their three `backup.json.after` entries change. The inventory `manifest` field remains the prior full-install manifest: installing three deltas does not install the full dev manifest. J records the candidate manifest and commit. All other manifest entries are ignored for writing; monitor bytes deliberately remain installed versions. Context, accepted rules, controller, workflows, policy, marker, budgets, slot journals, grants, ledgers, admission_pm, other adapters and deployment are unchanged.

### Post-C5 rules inventory entry

The C5 install (#294, receipt `STATE/agy29-nopolicy294-scoped-install.json`) wrote the EOM 1.4 `accepted-engineering-rules.md` (`017441de…2269`) but left that one `backup.json.after` entry at EOM 1.3 (`38c34012…1c1c`). The live-inventory byte check therefore accepts exactly one mismatch: path `LIB/accepted-engineering-rules.md`, inventory `38c34012…`, live `017441de…`, and only while the C5 receipt is byte-identical to its pin (`04106cc1…a704`), is `active` with the C5 controller/manifest/rules/backup hashes, and `STATE/agy29-nopolicy294-scoped-backup/rules` still hashes to the EOM 1.3 pin. The provenance is part of the observation digest, so apply refuses if it changes after dry. Every other path, any third hash, the reverse mismatch, a missing or altered receipt or backup refuse as `live inventory byte drift` or `C5 receipt ...`. `backup.json` is not edited and the rules file and its inventory entry stay byte-exact through apply, verify and rollback. Other installed consumers of the same inventory (`installer.activate`, `recovery_upgrade`) are not changed here and will still refuse on this entry until the inventory is reconciled by a separate reviewed change.

## QA and package acceptance

After successful install/verify, use the existing authorized dispatcher process for the one remaining QA call. The `--qa` command below only re-pins the canary marker and bumps slot2 generation; it starts no model itself. Its existing transaction still uses its existing authenticated Owner-comment lookup and disabled policy window. No new network path is added by this change.

```sh
/usr/bin/python3 -B /usr/local/lib/gb-actions-train/owner_package_admission.py --qa 6404499964
```

Once that exact QA call has finished PASS, and both slots are idle again:

```sh
/usr/bin/python3 -B /usr/local/lib/gb-actions-train/owner_package_admission.py --accept-dry 6404499964
/usr/bin/python3 -B /usr/local/lib/gb-actions-train/owner_package_admission.py --accept 6404499964
```

Accept uses local trusted ledger/admission receipts without an Owner-comment HTTP request. It validates the spent analysis and QA through the same gates in live or archived state, the exact QA marker/module pins, controller and rules, QA generation, and unique run/conversation identity. Receipt `STATE/antigravity-29-package-accept-6404499964.json` precedes the sole effect: atomic canary → ready marker with accepted_canary identity. No disabled window is needed for this single-file replacement. Re-running completes the same intent or reports the same ready result; a foreign state change refuses. FAIL/UNKNOWN QA refuses; no new call or retry is authorized.

Budgets and both grants remain spent/unchanged. Ready does not authorize unlimited AGY QA: finite budget/cap changes require a separate Owner rights decision. C5 comment 6396105635 and its installed document pins remain unchanged. admission_pm is not installed or changed; its standalone source lineage scan still assumes a live index. The delegated runtime path in Q supplies its existing accounting validator archived references, without installing the out-of-scope module.

## Rollback and validation limits

Before any `--qa`, dispatch or other train state change, rollback restores exactly the three target files and original inventory bytes and modes:

```sh
/usr/bin/python3 -B /root/agy29_pkg_finish_install.py rollback --bundle /root/agy29-finish-bundle --commit <MERGE_SHA>
```

Rollback refuses if protected state changed. After `--qa`, rollback is therefore a separate OPS reconciliation decision; do not restore old parser bytes under a new canary or rewrite marker/ledgers manually. Completed rollback cannot be repeated. An interrupted install retains J/BK and must be verified or rolled back rather than re-applied.

AUTHOR verification evidence is recorded in the task handoff. New regression tests are in `test_actions_train_pkg_finish.py`; existing owner-package fixtures now include full real operation binding fields. Each new test is also run with pristine dev code in a scratch copy. Root ownership, real namespace/setpriv execution, real installed context bytes, live state and deployment are NOT_TESTED here. Compatibility regression uses the dev context_policy implementation with only RULES_SHA256 overridden to the installed hash; it does not claim byte-equivalence to the unavailable older module. Full regression comparisons must distinguish baseline sandbox EACCES from candidate failures. Author self-tests are not independent QA.

AUTHOR validation, 2026-10-26: pristine `bdd912a82a2f0087f4cfc9c6820edc8c49ee6527` ran 929 Actions tests; candidate ran 940. Both reported 30 errors, one skip and zero FAIL; the exact error-label sets matched, with no additions/removals. Baseline exceptions were 23 PermissionError and seven FileNotFoundError (including missing fixture/patch receipts); these checks remain unpassed. All 11 new regression methods passed on candidate and failed/errored on pristine code. Both phase runs passed 51 tests; foundation passed. The final full candidate run used an unchanged source tree. No commit/PR, CI, DEV, root install or real model call was made in this AUTHOR task.
