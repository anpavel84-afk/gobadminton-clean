# QA brief: independent READ-ONLY review of `install_c5.py` (path B, stage C5 = PR #294 + PR #297)

Status: brief only. Nothing here has been pushed, applied, or run on the VPS or PROD. QA must stay **read-only**: no push, no comments, no VPS access, no tokens, no apply of any verb. Offline unit tests on a scratch copy are fine.

## 0. Artifacts under review (FINAL, published for QA on GitHub)
Status update (2026-10-25): C5/R5 are now PUSHED. Release branch `chatops/agy-c5-release-20261025` (draft PR #299 into dev, **do not merge**) = R5 on top of C5. CI on R5 head: 7/7 jobs success (twice: push + PR event). These QA artifacts live on branch `chatops/c5-installer-qa-20261025` under `qa-artifacts/c5/` (no PR; the branch is only a transport for review; it is not part of the release).
Still true: nothing has been applied on the VPS or PROD. QA must stay READ-ONLY.

| file (in `qa-artifacts/c5/`) | sha256 |
|---|---|
| `install_c5.final.py` (**the file to review**; real C5/R5/manifest/native/context/admission/stage filled by `fill_c5.py`) | `dfa27b02ac83731262636bca1df0d5ed0bb78fddf544ab7a5091f7d1d9d653fc` |
| `install291_c5.py` (monitor #291 installer rebased on C5; see section 5) | `4d577f6b8fd80f5145dee507d2a82c1367af4f4ce01ac3583ae5f5a14627f4e7` |
| `test_install_c5.py` (18 offline tests, all OK on the box; needs the box-only files `fill_c5.py`, the draft `install_c5.py` and the `c5work` clone, so on GitHub it is for static review; re-derive the shas from git instead) | `545f45c845fa931e8998670f0239bc8049263511c2fb9a91ad9620ba142d82d7` |
| `owner_comment_body_C5_REAL.txt` (Owner package body for Issue #29 built for the real C5; NOT posted) | `9121756c5e958b565cf4ed7115da65682ad0f9f970808792dabac9b97fbb80c9` |
| `make_owner_comment_c5.py` (generator: `make_owner_comment_c5.py <C5 40hex> [owner_comment_id]`, pins EOM 1.4 `017441de…`) | `d9e99e22ecb70328d233306cdc15e3594ce6405d5f078368cdf432b824c0fdbb` |
| `gb-agy-profile-unload-20261024.py` (host AppArmor unload; own checklist `QA_CHECKLIST_host_unload.md`) | `d212a079401de46e39a65751a0815379c9797fec7d572c2fcdfc1b4620e45b19` |
| `c5_plan_section0.md` (excerpt: section 0 of `c5_plan.md`; older sections there are stale and omitted) | see `SHA256SUMS` |

Real values to verify against git (public repo `anpavel84-afk/gobadminton-clean`):
- C5 `41e12be2d551158e97ea30eaf8e95f992f998615` = merge of #294 head `c9b67f9e9aaa6ee029d3695eb2ce7db5f7ed7ca4` + #297 head `0d160f6722e404745e065176fea9221a48a37232` (author/committer `PMA Offline <pma-offline@invalid>`, 2026-10-25T02:12:00Z).
- R5 `05f06a7ab1197c81f795f35df2ab41f9625501a8` = ref-only sole-parent child of C5 (4 `ref:` pins C4 `7d3d6ca0…` -> C5; changes only `train-dispatch.yml` and `train-stage.yml`).
- manifest.json (C5 = R5) `0f16f0d60e05d13fa1778f5e9220341b4f62149ddc3e99ced10235344cf21944`; train-stage.yml@R5 `b9703ca27b7bb3f494f379f8e259e62a6a48bc8f5ff50c6923e1712d8899d68d`.
Baseline for diffing: the #292 installer `install292.py` (already QA'd and applied; not in this directory: see git history of PR #292/#293 or ask for it). Every change vs it is intended to come from `build_c5.py` counted substitutions (not published here).
Offline check on the box: `python3 -B test_install_c5.py` -> `Ran 18 tests ... OK`.

## 1. What the installer must do
Atomically (fail-closed, root 0700, controller flock, receipt by phase, auto-restore) change the live train controller from C4 (#292) to C5:
1. `native_antigravity.py` `349b4b49…` -> `99e70d960b1db2567c32dea10a7341487b3aeb511a1aa5a51b85be86cded2d42` (#294)
2. `context_policy.py` `82d869d74a9918694663c3acbc72bf9df2919ef2801a380013afb736c77b3aef` -> `d961079b9791f53cf7ce0ac208180b0c9d9100ef46b48c025c2938d2eb69a806` (#297)
3. `owner_package_admission.py` `5987d7d1ff5f5440d66ab745ab2369cf4b35d6ef28391e8da335bef1b449e824` -> `d72c85dada60dee30e7fd53f17eac65ddff7f9dafffb508615ec02a0ae22f026` (#297; only the `RULES` line changes)
4. **non-manifest** file `/usr/local/lib/gb-actions-train/accepted-engineering-rules.md`: EOM 1.3 `38c34012f10974496a7d7cbc74ecacb62bf7847278e295edfeb107d69a5d1c1c` (100818 B) -> EOM 1.4 `017441dec5ba197a1065b6ef90efdddb090b286ba48687241a7fbc09dd002269` (**113203 B**), source = tracked `docs/rules/ENGINEERING_OPERATING_MODEL.md` in the root clone at R5 == git object `bc8bad0c38a861f8e72296d0a323e2941b9322e0`. (`installer.payload()` only copies manifest files, so this needs its own put/backup/restore.)
5. policy: `controller_sha=C5`, `stage_workflow_sha256=sha(train-stage.yml@R5)`, `recovery.source_sha=C5`, mode back to `active` only after smoke; inventory `manifest` + `after[...]` for the 3 manifest targets.
Verbs: `dry`, `apply`, `verify`, `verify-merged`, `rollback`. Sequence in the whole operation: host AppArmor unload -> `install_c5 apply` -> release PR merge (merge commit) -> `verify-merged`. Fail-closed window between apply and merge is expected (receiver refuses train requests until dev workflow == R5 workflow).

## 2. Explicit checks (please answer PASS/FAIL/FINDING for each, with line refs)
### A. Exact shas / pins
- A1. Every sha, size and commit constant above matches the git objects: re-derive from `c5work` (`git show <C5>:path | sha256sum`), do not trust the comments. `RULES_*` (new), `RULES_OLD_*`, old/new sha for native/context/admission, `MANIFEST_OLD`, `OLD`, `OLD_RELEASE`, monitor/unchanged shas.
- A2. `fill_c5.values()` computes (never types) C5/R5/manifest/native/context/admission/stage shas; it asserts R5 is the sole-parent ref-only child, manifest identical at C5 and R5, both QA'd heads are ancestors of C5, `bc8bad0c` is an ancestor, and `docs/rules/...` at C5 == `017441de…`/113203 B. Confirm no placeholder can survive into a runnable file (`main()` refuses; `test_placeholders_refuse_every_verb`).
- A3. `rules_pins()` verifies the release `context_policy.py` pins (`RULES_COMMIT/SHA256/SIZE/REVISION`) and `owner_package_admission.py` `RULES=` equal the EOM 1.4 values (exactly once each); EOM 1.3 payload must be refused.
- A4. The C5 merge tree: native == #294 head, context/admission == #297 head, `manifest.json` entries come only from those two (test `test_c5_contains_both_qa_heads_and_tree_is_their_union`). Confirm independently with `git diff` that C5 adds nothing beyond the two PRs (`git diff c9b67f9e C5` == `git diff 2446bcc5 0d160f67` for the non-overlapping files).

### B. Rules file replacement
- B1. Preflight (`rules_old_state`): installed rules file is regular, root-owned (`trusted_target`), nlink 1, not group/world-writable, sha/size == EOM 1.3 baseline; otherwise refuse before any write.
- B2. `backups()` copies it byte-exact with mode into `BK/rules`; `old_values()` re-verifies the backup is EOM 1.3.
- B3. `apply` writes via `I.put` (tmp file O_EXCL|O_NOFOLLOW, fsync, `os.replace`, dir fsync) from the clone file after re-checking its sha/size; mode = backed-up mode; post-check `rules_new_state()` (sha, size, mode). Source clone must equal the immutable git object (`source()` checks `git show bc8bad0c:docs/rules/...`, worktree bytes, and `merge-base --is-ancestor bc8bad0c R5`).
- B4. Partial failure (crash after manifest targets, before the rules copy; or after the rules copy) -> `restore()` returns all of native/context/admission/**rules**/inventory byte-exact, then policy. Test `test_restore_rewrites_rules_after_partial_install`, `test_restore_exact`.
- B5. `rollback` refuses foreign rules bytes (neither EOM 1.3 nor EOM 1.4) and keeps policy disabled (test `test_rollback_refuses_foreign_rules...`). Check there is no path where rules end up EOM 1.4 while policy is `active` with C4 pins, or EOM 1.3 while policy `active` with C5 pins (context_policy.load would then fail on every model start).
- B6. `unchanged_foreign()` no longer assumes rules are unchanged: confirm it cannot mask a rules change in `idle()`/`verify()` (idle requires EOM 1.3; verify requires EOM 1.4).

### C. Rollback order
- C1. Inside `restore()`: policy -> `disabled` FIRST (`disable()`), then `RESTORE_ORDER = native, context, admission, rules, inventory`, then policy rewritten as disabled-with-old-values, `restored_checks`, receipt `restored_disabled`, then original policy BYTES restored last, `rolled_back`. Receiver never active with half-restored payload. Check `except BaseException` path leaves policy disabled and phase `rollback_failed`.
- C2. Operation-level order documented in `c5_plan.md`: **`install_c5 rollback` BEFORE the host AppArmor-unload rollback** (the C5 rollback verifies the profile is absent; C4 adapter needs the profile). Confirm `rollback()` / `restored_checks()` do not require the profile to be loaded and that the `MANUAL` text points to the right script.
- C3. Idempotency: second `rollback` after `rolled_back` is a no-op or a clean refusal, never a partial rewrite.

### D. Fail-closed preflight
- D1. Refuses (no write, receiver untouched) on: any placeholder; not root / not 0700; script path != `SCRIPT`; clone not detached at R5, wrong origin, dirty, symlinks/untrusted files, R5 not ref-only/sole-parent child of C5; profile still loaded; missing/changed receipts (`J292` etc.); slots not idle / pending / locks held; installed hashes != expected old (any of native/context/admission/rules/stage/mapping/guard/content_identity); monitor files != payload; `R.GROUP != 65042`; predicted merge of dev workflow != R5 workflow (`predicted_merge`); policy not exactly the C4 values.
- D2. `source()` no longer says "unexpected installed payload delta" for the 3-file delta, but still refuses any 4th delta (`set(changes)==set(TARGETS)`).
- D3. flock/receipt: controller lock taken before reading state, released after; receipt phases written before each irreversible step; auto-restore on any exception after the first write.
- D4. `dry` performs zero writes (no mkdir/copy/chmod outside `/var/tmp` smoke temp that is removed).

### E. No policy weakening
- E1. Policy only gets `controller_sha`, `stage_workflow_sha256`, `recovery.source_sha` rewritten, never `shadow`, no widened `owned`, no new trusted uid, no removed refusal. Grep the diff vs `install292.py` for anything touching `trusted_uids`, `setgroups`, `SOURCE_POLICY`, network, tokens, `systemctl start/enable/unmask`.
- E2. The smoke runs under `unshare -n` (no network), isolated python (`-I -B`), no model call, no AGY exec, no credential read, no protected-state write.
- E3. Rules file mode never widened (preserved backed-up mode; group/world-writable refused in both directions).

### F. Registry group 65042
- F1. `smoke` asserts `N.REGISTRY_GROUP == 65042`, `'CAP_SETGID'` and `'does not name gid 65042'` in `N.REGISTRY_GROUP_NOTE`; root probe `BOUNDARY_CODE` (root -> `978:968:[]:1:0`); new `CONTOUR_CODE` probe as uid 978 gid 968 with `--groups 65042` must ACCEPT and with `--clear-groups` must REFUSE (`PermissionError`). **These setpriv/unshare probes cannot run in the offline sandbox** (no privileges) — review the code carefully; please run them on a scratch root VM if available.
- F2. `RULES_CODE` (root, `unshare -n`): context_policy pins == installed rules bytes, `P.load(path, trusted_uids=(0,))`, and the `RULES=` pin in the installed `owner_package_admission.py`. For label `source` it reads the clone file, for `installed` the live file.
- F3. The residual risk (gid 65042 is not named in Owner waiver t317u) must stay visible: the installer must not claim isolation; receipt records `registry_group`.

### G. Process
- G1. Nothing in the script pushes, fetches new objects at apply time beyond what the original did, or posts. Release clone is root-owned; `REMOTE`/`RELEASE_BRANCH` constants.
- G2. Anything in `install_c5.py` still describing C4/#292-only semantics (docstring, messages, `INSTALL294_REFUSED` strings) that would mislead an operator.

## 3. Known gaps (already disclosed, do not count as findings unless worse than stated)
- CI on pushed R5 is green; independent QA on the C5 merge tree is what this review provides.
- `unshare`/`setpriv` probes are untested offline; `dry` itself requires the VPS.
- Slot clones may not contain object `bc8bad0c` (scoped-rules fallback not verified).
- `RELEASE_BRANCH` in `install_c5.final.py` names the real branch `chatops/agy-c5-release-20261025` (informational constant).
- Group 65042 is not named in Owner waiver t317u (residual risk, see F).

## 4. Deliverable
Verdict (PASS / PASS WITH FINDINGS / FAIL) + findings by severity (P0-P3) with file:line, and the exact sha256 of the `install_c5.py` / `install_c5.final.py` you reviewed. Do not edit the artifacts; report required changes.

## 5. install291_c5.py (rebase of the monitor #291 installer onto C5) - secondary review
Generated from the old `install291.py` (sha `2d483ea99436fe0558b3c85c6642370cde8f79f12895a8d82b00227cd7ef2dbb`, applied-after-#292 design) by counted substitutions. Diff old vs new, expected changes only:
- `CONTROLLER` -> C5 `41e12be2…`; new `CONTROLLER_C4 = 7d3d6ca0…` (the canary marker `adapter_revision` is not rewritten by install_c5, so the marker may carry C4 or C5).
- `STAGE_WF` -> `b9703ca2…` (train-stage.yml@R5, what the policy pins after install_c5); `INV_MANIFEST` (the old installer's name for the inventory manifest, i.e. `MANIFEST_OLD`) -> `0f16f0d6…`.
- **Prerequisite receipt dependency**: `idle()` now reads `J294 = agy29-nopolicy294-scoped-install.json` and requires `phase == 'active'` and `controller_sha == C5` (was J292 / C4). `J294` is added to the required-state list (J292 kept). Therefore install291 cannot run before `install_c5 apply` has completed and the release is active.
- AppArmor: the old `sha(APPARMOR) == PROFILE` checks are replaced by `apparmor_absent()` (profile file absent and `gb-agy-runtime` not loaded), because install_c5 requires the host unload. `PROFILE` constant removed.
- Everything else (targets app/writer/server/extension/mapping, PR_HEAD `7dc38064…`, rollback, state manifest) unchanged. Monitor payload shas are identical in the C5 manifest (checked) so `MONITOR` entries stay valid.
Questions: PASS/FAIL on (i) no stale C4/J292 reference that would make it refuse or, worse, accept a wrong state; (ii) `apparmor_absent()` reads `/sys/kernel/security/apparmor/profiles` correctly; (iii) the state manifest (walks `R.STATE`) tolerates the new J294 receipt and install_c5 backup dir. Existing offline tests (7) pass on the rebased file; the new checks are not exercised offline. Not verified: that PR #291 itself merges cleanly into dev after the release.

## 6. Owner package body
`owner_comment_body_C5_REAL.txt` is built by `make_owner_comment_c5.py` for the real C5 and carries EOM 1.4 `rules_sha256 017441de…` and `controller_sha = C5`. `owner_package_admission.py` (C5) binds both; the older `make_owner_comment.py` (EOM 1.3) must NOT be used. Please check that the body's pins equal the admission constants at C5 and that nothing in it is a secret or a live instruction beyond the intended package. It is not posted anywhere.
