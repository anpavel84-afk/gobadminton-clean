# Two-slot commissioning — 21 October 2026

From: PM/OPS → next PM/OPS. Status: WORKING_DRAFT, commissioning incomplete.
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

The legacy user executor is still the active executor. Core slots are not installed or activated. Supporting component installation must not be reported as successful parallel execution.

## Current core candidate and review

Candidate `23344282184774c2a2fd5f4eadab8f7c825a248ec9d217a8611b0e87378a35b2` is undergoing independent review (PID3927789, `/var/lib/gb-ops-stage/files/slots-final-commission-review13.log`). Do not start duplicate reviews or install a candidate with FAIL. Root allowlist must match exact installer bytes.

Corrections preserve executor/slot payloads and full budget history. Shared locks use distinct group gb-slots-clean/GID65042. Root inventory found no existing files, groups or running process references to that GID; receipt `/root/gb-slots-gid65042-audit.json` expires after four hours. Historical gb-slots/GID970 and its archives remain untouched. Existing service accounts are validated, not modified. Legacy paths are pinned to the exact CLEAN checkout/state/trust locations; Git common directory is pinned to `/srv/gobadminton-clean/repo/.git`.

Backups open eligible single-link regular files through verified descriptors; tar never reopens user-controlled paths. Migration comparison uses these safe archives, not broader before-* filename globs. Root-private Git mirror preparation avoids recursive ownership changes in a user-writable directory. Rollback retains and restarts slot1 if it has advanced or cannot be reconciled safely; it does not restore a stale legacy checkpoint. Remove refuses before stopping working services if history has advanced.

146 offline checks passed, including the latest migration-glob and advanced-idle rollback regressions. Live DRY passed for this exact candidate (slots-final-commission-dry13.log). Reproducible check: `umask 077; bash scripts/chatops/parallel-slots/commission-tests/run.sh /var/tmp/OWNED_SCRATCH` as an ordinary user. Choose a scratch directory with traversable/readable ancestors (the production worktree parents deliberately restrict directory listing).

## Next bounded action

Read review13 and expanded test results; resolve findings, obtain exact-SHA PASS and run current live DRY. Then install the core once. Move slot2 own new enrollment directories by rename to its canonical home (no legacy session/key copying), verify normal clients, publish factual root-owned capability proof. Configure conservative host author/QA daily limits of 30, per-slot limits at most 30, accounting for pre-cutover calls rather than resetting the approved ceiling40. Current-day prior legacy work conservatively counts six calls per role; capability probes currently add three author and two QA calls. OPS installer/body reviews use their separate review role.

Run slot2 preflight and activation only when idle. Then admit two exact independently reviewed disjoint real tasks, observe concurrent author/QA progress, serial integration/CI and accepted DEV evidence. Proposed bounded tasks are map-module loading feedback for games and Radar; neither closes all of MAP-PERF1. Their drafts are on the server; optional-fields prompt review must wait for installed slot support (first games body review correctly rejected absent installation evidence). Do not publish failed or merely revised bodies as approved.

## Recovery and non-loss requirements

Use exact reviewed installer --remove, first with DRY=1. Once slots advance, automatic removal refuses until completed-issue history is reconciled. Never restore stale state, delete histories or revoke authentication during rollback. Do not alter legacy private trust/credentials, historical groups/archives, PROD, PLAN or unrelated services.

Capability receipts contain timestamps and binding metadata only: `/root/gb-slot2-capability-probes-runtime-full.json`, `/root/gb-slot2-ssh-probe.json`. Do not commit private enrollment directories or auth/key files. Browser/iPhone behavior and real product-task concurrency are not yet verified.

## Additional exact commissioning corrections

All root reads of legacy code/checkpoints/public status now open pinned non-symlink directory chains and single-link bounded regular-file descriptors, and detect replacement or mutation during reads. Regression fixtures verify that rejected symlink, ancestor symlink, hardlink, FIFO and oversize inputs never reach byte reading. Known-hosts validation also rejects hardlinks. The runtime payload hashes remain unchanged.

Git ownership guards rejected the initial per-command safe.directory clone arrangement on the real installed Git version. Source preparation now streams a Git bundle as the source owner into a root-owned temporary file, then clones only that root-owned bundle into the private mirror. This avoids root reads of the user-controlled Git tree. The bundle includes both historical pins, even if otherwise unreachable from branch refs. Each slot clone passes exact-path trust to its own upload-pack child; there is no global wildcard trust. Host-only reproduction: `python3 scripts/chatops/parallel-slots/commission-tests/git-ownership-fixture.py` as root. The scratch fixture passed two UIDs, a clean dev checkout, unreachable-pin retention, read-only common base and denied peer directory traversal. It uses no network, services, real project data or credentials.

Review9 identified the generic network-code rule applied to ordinary project source tests. The root-controlled exact-SHA exception is limited to the already requested non-root executor fetching this one CLEAN repository for Owner/PM-admitted DEV tasks and running source tests under the unchanged offline, credentials-denied model sandbox. Root network code execution, other repositories, arbitrary scripts, dependency installation, gate bypasses and PROD/PLAN/VPN remain excluded. Review10/11 additionally found the legacy-code symlink read; the current descriptor guard fixes it. Historical FAIL reports are evidence of rejected candidates, never installation approval.
