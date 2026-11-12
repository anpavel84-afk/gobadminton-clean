# Two-slot commissioning — 21 October 2026

From: PM/OPS → next PM/OPS. Status: INSTALLED_AND_ACTIVATED, real-task commissioning incomplete.
Base: dev `9d3e092cc30796ffc0096c50584a771e60c18ef3`.
Owner authorized completion in the PM chat. Target Germany `vmi3510488`, GoBadminton CLEAN only. PROD and unrelated services are out of scope.

## Verified installation facts

Task admission compatibility, two-slot monitor and isolated Node/pnpm/Codex runtime are installed following exact-SHA independent reviews and dry runs. The new slot2 account has its own freshly enrolled Codex login and repository deploy key. A standard SSH client authenticated as the repository deploy key; git push --dry-run confirmed write capability without creating a branch. No legacy credentials were copied.

A wrapper-only Codex runtime failed inside the actual sandbox. The pinned standalone Codex binary and its matching code-mode host are now installed inside the permitted runtime tree. Real author and separate QA calls with actual tool execution both passed under slot2 UID978, with network disabled and own authentication/SSH directories denied to model tools. These are capability probes, not product task completion or DEV release.

Installed installer SHA256:

| Installer | SHA256 |
|---|---|
| slots-admission | ae1b947bb865154698e09169ebe7172dcf76f46f33ba3f7e34bdd88bbf47e985 |
| slots-monitor | 2f45523de308745e690dc7585d3ecd51d7798369ab5edd96a39fd59979b1766e |
| slots-runtime | cdbc8c2a34f20ee116964c6ecf6d5b33b52bf138442b8d1fdda1625893a7b167 |
| slots-node-runtime | abd3b746b7515cea1d53b7b50e6e3c4bd2e563de4c19f39df05fdf39de0fee0f |
| slots-codex-runtime | 299213044b1adca2f3a6d052926c69e016bd4966307da9dd69fa0685cc5ebe1b |
| slots-code-mode-runtime | 5ccc92a1a04008b9dc42722e3dca92d5ebf6dbe52944703981890bd1153acfbf |

Core and both slots are now installed and activated. The legacy user executor is stopped/disabled after byte-verified migration of all 34 done issues and parked/history state. Both slot units and supervisor are active with max_parallel=2. Real task execution and acceptance remain pending.

## Current core candidate and review

Candidate `60477b1fb8370b277d8310c7a3ed70c6c124abcf8ad86310c90d2968c73a5a0d` passed independent review16 (PID7306, `/var/lib/gb-ops-stage/files/slots-final-commission-review16.log`). Do not start duplicate reviews or install a candidate with FAIL. Root allowlist must match exact installer bytes.

Corrections preserve executor/slot payloads and full budget history. Shared locks use distinct group gb-slots-clean/GID65042. Root inventory found no existing files, groups or running process references to that GID; receipt `/root/gb-slots-gid65042-audit.json` expires after four hours. Historical gb-slots/GID970 and its archives remain untouched. Existing service accounts are validated, not modified. Legacy paths are pinned to the exact CLEAN checkout/state/trust locations; Git common directory is pinned to `/srv/gobadminton-clean/repo/.git`.

Backups open eligible single-link regular files through verified descriptors; tar never reopens user-controlled paths. Migration comparison uses these safe archives, not broader before-* filename globs. Root-private Git mirror preparation avoids recursive ownership changes in a user-writable directory. Rollback retains and restarts slot1 if it has advanced or cannot be reconciled safely; it does not restore a stale legacy checkpoint. Remove refuses before stopping working services if history has advanced.

150 offline checks passed, including the latest migration-glob and advanced-idle rollback regressions. Live DRY passed for this exact candidate (slots-final-commission-dry16.log). Reproducible check: `umask 077; bash scripts/chatops/parallel-slots/commission-tests/run.sh /var/tmp/OWNED_SCRATCH` as an ordinary user. Choose a scratch directory with traversable/readable ancestors (the production worktree parents deliberately restrict directory listing).

## Next bounded action

Core installation, byte-verified migration, own slot2 enrollment finalization and max_parallel=2 activation are complete. Next: obtain exact-body independent approval for the two disjoint map-module loading tasks, publish immutable Owner issues, and observe both independent task runs through exact-SHA QA/CI and accepted DEV evidence. Their scope excludes full MAP-PERF1. Do not publish failed or merely revised bodies as approved.

## Recovery and non-loss requirements

Use exact reviewed installer --remove, first with DRY=1. Once slots advance, automatic removal refuses until completed-issue history is reconciled. Never restore stale state, delete histories or revoke authentication during rollback. Do not alter legacy private trust/credentials, historical groups/archives, PROD, PLAN or unrelated services.

Capability receipts contain timestamps and binding metadata only: `/root/gb-slot2-capability-probes-runtime-full.json`, `/root/gb-slot2-ssh-probe.json`. Do not commit private enrollment directories or auth/key files. Browser/iPhone behavior and real product-task concurrency are not yet verified.

## Additional exact commissioning corrections

All root reads of legacy code/checkpoints/public status now open pinned non-symlink directory chains and single-link bounded regular-file descriptors, and detect replacement or mutation during reads. Regression fixtures verify that rejected symlink, ancestor symlink, hardlink, FIFO and oversize inputs never reach byte reading. Known-hosts validation also rejects hardlinks. The runtime payload hashes remain unchanged.

Git ownership guards rejected the initial per-command safe.directory clone arrangement on the real installed Git version. Source preparation now streams a Git bundle as the source owner into a root-owned temporary file, then clones only that root-owned bundle into the private mirror. This avoids root reads of the user-controlled Git tree. The bundle includes both historical pins, even if otherwise unreachable from branch refs. Each slot clone passes exact-path trust to its own upload-pack child; there is no global wildcard trust. Host-only reproduction: `python3 scripts/chatops/parallel-slots/commission-tests/git-ownership-fixture.py` as root. The scratch fixture passed two UIDs, a clean dev checkout, unreachable-pin retention, read-only common base and denied peer directory traversal. It uses no network, services, real project data or credentials.

Review9 identified the generic network-code rule applied to ordinary project source tests. The root-controlled exact-SHA exception is limited to the already requested non-root executor fetching this one CLEAN repository for Owner/PM-admitted DEV tasks and running source tests under the unchanged offline, credentials-denied model sandbox. Root network code execution, other repositories, arbitrary scripts, dependency installation, gate bypasses and PROD/PLAN/VPN remain excluded. Review10/11 additionally found the legacy-code symlink read; the current descriptor guard fixes it. Historical FAIL reports are evidence of rejected candidates, never installation approval.

## Monitor correction from Owner screenshot

The legacy checkpoint retains its last completed task. The old UI placed phase=done under “Сейчас выполняется” and called snapshot freshness “данные свежие”, which did not establish task progress. Exact reviewed monitor-idle-ui installer 16f39a1d70ecfa3694eb0cfe9afd2397fd39aedddc5cd1c2c9d09e32c33e6d5f was dry-run/applied; the existing monitor web service was restarted and is active. Public app.js hash is 9c4a4eb86ca9aab9905af8cb6963383d0654fd50d7407da4410ae5b623714035. Completed tasks now appear under executor state with “Активной задачи нет” and a last-completed-result label; slots have their own state heading. The badge says “Снимок обновлён”. Four runtime render states passed the Node DOM harness; an actual iPhone post-change view is not yet observed. Reload an already open page to load the new static JS.

The task147 title metadata had an obsolete typecheckFAIL/resume note. It was reconciled against actual independent QA PASS, all seven CI jobs successful (including web typecheck), accepted release r39598091682-a1 and live /v1/meta matching 9d3e092cc30796ffc0096c50584a771e60c18ef3. This modifies display metadata only, preserving original task/review history.

The previous full core candidate (23344282...) obtained independent PASS in review13. Review12 of an earlier candidate separately identified the global filesystem scan in group removal. Current review16 removes that scan and automatic group deletion entirely. Empty membership and archive/GID history are preserved; reinstall requires OPS reconciliation of the retained new group. This deliberately avoids inspecting or changing unrelated PROD/PLAN/VPN paths during cleanup. It is not a permission to apply an older snapshot with a known finding.


## Latest transaction corrections

Review14 rejected arbitrary unit symlinks and aliases. The candidate now pins root-owned regular unit bytes and systemd Id/Names/FragmentPath/DropInPaths/NeedDaemonReload before any service mutation, including rollback. Legacy identity also requires its exact Id/Names. Offline fixtures reject foreign aliases, fragments, drop-ins, stale metadata and missing or nonregular units before mutation.

Review15 rejected zero-status signal exits that could skip rollback after stopping legacy. HUP/INT/TERM now explicitly exit 129/130/143 and trigger the existing EXIT rollback; recovery ignores repeated catchable termination until history and service recovery finishes. A regression executes all three real signals for install, activation and removal, checking nonzero status, retained checkpoint history and appropriate service recovery. SIGKILL and host power loss remain outside shell trap guarantees. 150 offline tests and the exact live DRY passed. Review16 subsequently PASSed; see actual cutover evidence below.


## Trusted installed-format metadata

The read-only slot-review-metadata patch was independently approved (review-slot-review-metadata-20261021T160342Z-4183504), dry-run and installed through gb-run. Installer SHA256 6b74c56e0722456f06baf171e17fc2e60e6ee88531b0157911081c12ea7f7790; protected review wrapper exact after SHA256 8f627b8945255d1a251703e87f4aad8f0634b448d4685c7ddab96681bf52b8a4. This reports installed optional task-format support only after exact pinned root-owned parser and slots files are present; otherwise it explicitly reports NOT_INSTALLED_OR_UNVERIFIED. It grants no admission, task verdict or gate bypass. This avoids treating older DEV source schema as proof of runtime installation. A root-controlled exception records the previously authorized exact compatibility scope.


## Actual core installation and two-slot activation

Independent core review16 PASS: `/var/lib/gb-ops-stage/ops-patches/review-parallel-slots-final-20261021T160541Z-7306/`. Exact SHA256 60477b1fb8370b277d8310c7a3ed70c6c124abcf8ad86310c90d2968c73a5a0d is allowlisted. gb-run live DRY passed. Applying through gb-run exposed nested acquisition of the same global lock (wrapper FD9 and installer FD8); the waiting flock was terminated before any changes. No lock or reviewed code was changed. The exact allowlisted bytes were copied root:root0600 to `/root/gb-parallel-slots-reviewed-20261021.sh` and executed with the installer's own global transaction lock. Direct execution completed successfully, including descriptor-backed migration check and all isolation checks. Backup `/root/gb-parallel-slots.20261021-181415`; log `/var/lib/gb-ops-stage/files/slots-final-root-install16.log`.

The same slot2 user's own freshly enrolled .ssh/.codex directories were renamed intact into its canonical private home; no credential bytes were read or copied. Canonical-home normal Codex login status and authenticated GitHub push --dry-run passed. Root capability proof binds the actual prior separate author/QA inference receipts and exact runtime executable. Conservative new host caps30/role and explicit per-slot caps30 reserve the prior legacy and manual probe calls under the approved ceiling40; no historical counters were reset.

Exact reviewed `--preflight-slot2` returned ready=true with failures=[], activation DRY passed, and `--activate-slot2` completed. Both slot units and supervisor are enabled/active, max_parallel=2. Logs: slot2-finalize-enrollment.log, slot2-final-preflight.log, slot2-activation-dry.log, slot2-activation.log under `/var/lib/gb-ops-stage/files/`. At this point task assignment was empty: concurrent product execution, exact-SHA independent QA/CI and accepted DEV releases are not yet claimed. Games and Radar module-loading tasks remain subject to exact-body review before issue publication.


## Backlog display correction during commissioning

An OPS metadata update used unsupported status “в работе”; the existing strict backlog validator rejects the whole data file if any item has an unknown status. This was an operator data error, not loss of backlog records. Restored supported “ожидает” while retaining the note that both slots are installed/active and await actual task commissioning. Both temporary and final files passed the actual load_backlog_strict validator before republishing. Published snapshot available=true with42 visible items and all49 source records retained (2026-10-21T16:18:27Z). Further metadata writes must pass the actual validator before replacement.


## Product execution and backlog reconciliation (follow-up)

Both exact reviewed task bodies were published as #151 Games and #152 Radar and separately assigned to slot1/slot2. Actual own-UID author execution produced PR153 and PR154; slot1 has progressed to attempt2, slot2 to independent QA. This proves real execution in both slots, but does not yet assert accepted DEV for either task. Requested model remains distinct from observed model identity.

The live backlog was consolidated from49 source entries to32; strict loader and dependency DAG checks passed before atomic replacement, and the subsequent live snapshot has available=true with24 visible pending entries. Full before/after, mapping for all49 original entries and consolidated briefs are in backlog-audit-20261021/. V0 was linked to completed issue114, stale147 CI note corrected, OPS commissioning moved out of the pending product queue. No active admission body or execution history was changed. Existing completed ledger entries remain in the source only as dependency anchors and are hidden by the monitor. Operator photo import and Friends activation/UAT remain explicitly unproven rather than declared complete from source-only delivery.


## Own-repository object repair

Slot1 independent QA attempt1 explicitly failed to inspect immutable base because the alternate object store was outside its sandbox. Both own repositories borrowed /srv/gb-slots/base.git/objects. Materialized reachable objects using git repack -a as each owning UID (without deleting existing packs), then renamed only its own objects/info/alternates to alternates.commission-backup. git fsck --connectivity-only --no-dangling passed independently for both repositories. No sandbox read root, credentials, executor binary, candidate commit, or QA verdict was changed. The original alternate paths are retained for recovery. This fixes base-object availability without granting either model access to a shared ancestor. Existing source-only pnpm/style-reference limitations still must be reported honestly by QA; GitHub CI remains mandatory.


## Live telemetry installed (17:09 UTC)

Exact installer SHA256 7d3b5c5eea2eca61d124a6e0ca658c0b82e7f08e856cbcf8f7afc9946880040c passed independent review7, no waivers: /var/lib/gb-ops-stage/ops-patches/review-slot-live-telemetry-20261021T170524Z-363189/notes.txt. gb-run DRY and apply both rc0, logs slot-live-telemetry-dry7.log and slot-live-telemetry-install7.log. Both own-UID timers active, first telemetry17:09:54Z reports process active/running PIDs79318/79319 and exact checkpoint facts. Snapshot projects both slots FRESH with real commits/PRs and slot2 QA PASS bound to4977074e. App now uses the existing seven-stage progress bar for each slot. Missing future QA/CI is explicitly not-yet-received, requested model is labelled requested; observation age and checkpoint age are separate.

Public HTTPS healthz and app.js returned200 no-store; served app SHA256 9e9980c6c0580e54b01e42eda52bff573b45af9cd43b2f060cf70fea4f6ea379 equals installed bytes. Authenticated snapshot access still requires the existing PIN session; cloud browser was at the sign-in screen, so no logged-in browser visual verification is claimed. Offline DOM tests cover stage bars and actual installed UI semantics. No PIN/authentication flow changed.


## Exact-head product QA/CI follow-up

Slot1 attempt2 independent QA now PASS at b9aebc69f2d61f232554d030645432ad1cf8f789 after the own-object repair. Slot2 QA PASS at4977074ee7b45ea612dde592b88b354d99839aea and Product CI push39639481114 success. Slot1 Product CI push39640478582 failed only web typecheck TS2349 at test/games-map-module-loading.test.tsx46:33 (Loader union not always callable); web unit tests passed. Exact issue151/head/attempt2 GOBADMINTON_RESUME_V1 ci_fix marker6321988371 was published under existing owner authorization, requesting a real narrow typing repair and fresh QA/CI, without disabling checks. DEV acceptance for both remains unclaimed.
