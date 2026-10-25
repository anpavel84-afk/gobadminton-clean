# Antigravity CLI native `run_command` — inner sandbox EACCES evidence for vendor

**Purpose:** Redacted, reproducible diagnostic dossier for [GoBadminton CLEAN Issue #29](https://github.com/anpavel84-afk/gobadminton-clean/issues/29). **Status: VENDOR-LEVEL BLOCKER / NOT YET QUALIFIED** (24 October 2026 UTC). This is documentation only; not a fix, a new backlog, or an admission. No additional model/provider calls were used in the diagnosis.

## 1. Exact observed failure

- Accepted controller source: `82e1d389d6766a8f26ee7ff394c3254f674da022`; accepted GitHub ref-only release: `32d4a535f00b5cc402595120d2ab29210d1db08e`. Only custom-agent YAML `tools: [view_file, run_command]` was newly introduced, source QA PASS, hosted CI 7/7 PASS, installed by guarded rollback-capable deployment.
- Executable: `/opt/gb-slots/runtime/antigravity/agy` (Linux x86-64 ELF, root-owned, mode 0755, SHA256 `8af8e7a2a68f72fa7164e00bb59b8902c018fa43e528fc401ad7db8c2972583c`). ELF `.go.buildinfo` states `go1.28-20261015-RC02 cl/1000353293`; **this is compiler/build information, NOT a confirmed product semantic version**.
- Host: Ubuntu Linux kernel `6.8.0-147-generic`, x86_64. AppArmor enabled; `kernel.apparmor_restrict_unprivileged_userns=1`; profile `unprivileged_userns` enforce. Target ELF on ext4 root mount with `rw` and **no `noexec`**. Executor identity UID978 (`gb-slot2`), exact existing Landlock boundary + `no_new_privs`.
- CLI flags included `--sandbox --dangerously-skip-permissions --agent gobadminton-text-review --input-format stream-json --output-format stream-json --add-dir /srv/gb-slots/slot2/worktrees/antigravity-qa-29-canary`; custom agent's YAML explicitly allows only `view_file` and `run_command`. Original strict source gate requires **successful** native tool DONE events and source SHA evidence.
- Authenticated Owner train stage: [GitHub Actions #40041142967](https://github.com/anpavel84-afk/gobadminton-clean/actions/runs/40041142967); protected operation `30df33b9b606cd677ada349700f306279951c9f934ed550d581c589de085235f`. Actual requested tool operation:

  ```text
  native run_command({CommandLine: "/usr/bin/git -C /srv/gb-slots/slot2/worktrees/antigravity-qa-29-canary rev-parse HEAD"})
  Tool step 2: ACTIVE -> ERROR
  {"type":"TOOL_ERROR","message":"fork/exec /opt/gb-slots/runtime/antigravity/agy: permission denied"}
  ```

- **Important distinction:** This error names the **CLI ELF itself**, not the target Git binary. The ELF's compiled function-name table includes `google3/devtools/ai/sandbox/selfexec.Invocation.Command`, `selfexec.loaderLaunch`, `selfexec.parseLoaderLaunch`, `exebox.(*Box).startSbox` and `exebox.jailMain`. These show that the binary includes a sandbox **self-exec/loader** implementation. They provide a strong explanation for re-executing `agy` when a `run_command` is requested, but **the exact runtime call chain, syscall returning EACCES and inner mount rules are not proven from these symbol names alone**. Go's `fork/exec <path>: permission denied` text can also wrap failures during child process setup, not necessarily a failed final `execve(2)`.
- The native stream had a single `run_command` tool call, `ACTIVE→ERROR`, then a terminal response that described `INCOMPLETE` with no source reads/hashes; the response was wrapped in Markdown JSON fences, so the intentionally strict adapter recorded `AGY_PARSE_FAILED`, `status=UNKNOWN`, `safe_release=false`. **The parser failure is separate from the tool EACCES**. It is not permissible to turn UNKNOWN into COMPLETE or relax parser/source gates.
- Immutable native evidence: `/var/lib/gobadminton-autonomy/slots/slot2/antigravity-evidence/15a91aa94fcf49dca76e0345ef5a76cf/`; saved `stdout` SHA256 `d69676dc3904d6262ec731f3d816e187e06491c79dc7be8dd87623ba0f9703aa`, `phase-13.json` SHA256 `6c16586ddecbe27724a269ce70e4d084efdb797eaaaed755bf6d6cba179431df`. `input_delivery=written`, `charge_state=charged`, CLI exit 0 and stderr empty. Do not publish OAuth/token files or private agent prompts.

## 2. Minimal **NO-MODEL** controls performed

| Probe (same host) | Actual result | Meaning |
| --- | --- | --- |
| UID978 directly executes `agy --help` | exit 0 | ELF/mount/UID allow normal execution |
| UID978 + original Landlock/no_new_privs executes `agy --help` | exit 0 | Outer Landlock alone does not explain EACCES |
| UID978 + outer Landlock + `unshare(CLONE_NEWUSER)` + `execv(agy, ["agy","--help"])` | exit 0 | Basic user namespace does not explain EACCES |
| UID978 + outer Landlock + `unshare(CLONE_NEWUSER | CLONE_NEWNS)` + `execv(agy, ["agy","--help"])` | exit 0 | Simple nested mount/user namespace without new mounts does not explain EACCES |
| UID978 + `unshare --user --mount --propagation unchanged -- agy --help` | exit 0 | Namespace creation itself works |
| UID978 + `unshare --user --mount -- agy --help` (default propagation change) | exits 1, `unshare: cannot change root filesystem propagation: Permission denied` | AppArmor restricts mount namespace setup |
| UID978 + `unshare --user --map-root-user ...` | fails writing `uid_map`, `Operation not permitted` | AppArmor restricts namespace-local CAP_SYS_ADMIN; **not proof** of original EACCES |
| Original native provider `run_command` | `fork/exec agy: permission denied` | Requires inspection of CLI's **inner** terminal executor; different from the no-model controls |

The kernel audit at the original failure timestamp (Unix `1792798955.039`) shows an `agy` process transitioning `unconfined → unprivileged_userns` on `userns_create`, **not a recorded `DENIED exec`**. A separate no-model root filesystem propagation probe has exact audit:

```text
apparmor="DENIED" operation="mount" class="mount"
info="failed mntpnt match" error=-13
profile="unprivileged_userns" name="/" flags="rw, rprivate"
```

Thus AppArmor mount-propagation restrictions are **proven**, but their causality for the earlier self-exec EACCES remains **unproven**. The current sandbox may additionally rely on a mount plan, executable mapping, loader path, AppArmor transition, clone SysProcAttr, or process-start sequence not visible in stored native event envelopes.

## 3. Vendor / maintainer questions — exact requested data

1. On this pinned Linux CLI build, does `run_command` initialize `exebox/selfexec` by re-executing the current `agy` ELF before `/usr/bin/git`? Which `argv`, loader mode, mount namespace transition and filesystem visibility apply at that fork/exec boundary?
2. Does the inner sandbox mount the original executable path `/opt/gb-slots/runtime/antigravity/agy` read-execute? Could a missing path, bind mount with `noexec`, or AppArmor `unprivileged_userns` profile lead to this `EACCES` before the target Git command?
3. Is there a **supported, no-provider** diagnostic mode or sandbox-launch preflight which exercises the actual `selfexec/exebox` child path, reporting the failing syscall/errno, mountinfo and effective AppArmor label **without** turning off the sandbox, widening host rights, or accessing authentication?
4. Does the CLI support a minimally confined fix under Ubuntu AppArmor restricted user namespaces, such as a vendor-signed executable loader installed in the **already permitted** read-execute tree, **without** altering the caller's Landlock/UID or allowing general host execution?
5. For headless `--input-format=stream-json`, is a tool-error + fenced JSON response a known structured-output issue? This is a distinct follow-on question: the GoBadminton acceptance gate **must remain strict**.

Official contract: [Antigravity terminal sandbox](https://antigravity.google/docs/sandbox?tab=cli) (Linux kernel namespaces, only explicitly mounted paths visible), and [CLI source repository/bug reports](https://github.com/google-antigravity/antigravity-cli/issues). Its public repository publishes documentation/examples rather than the compiled `google3/devtools/ai/sandbox/exebox` implementation; the internal mount policy could not be reconstructed from the publicly supported interface.

## 4. Protected GoBadminton state / next legal action

- **No new AGY model calls, no new grants, no refund/replay.** The last Owner package is 1/2 with analyst spent and independent QA unused. Historical addressed 3/4 and supplemental 1/2 plus previous Owner packages remain unchanged.
- Original `UNKNOWN/safe_release=false` operation and immutable native receipts preserved.
- Bounded root scheduling-only reconciliation for Slot2 generation101 completed **without provider call**: receipt `/var/lib/gobadminton-actions-train/agy29-unknown101-scheduling-reconciliation.json`, phase COMPLETE, SHA256 `e58c3d7b753aa55e17cba9cbfa076f314220f96967337b37942ec7fca21aafa4`; Slot1 FREE/62, Slot2 FREE/102, installed controller `82e1d389d6766a8f26ee7ff394c3254f674da022` ACTIVE.
- **HOLD:** do not speculate with AppArmor, Landlock, `--sandbox`, binary paths, mount rights, parsing or COMPLETE gates. Obtain exact supported inner loader/sandbox diagnostic from the vendor or a demonstrably equivalent no-model reproducer first. Only then permit a proven narrow patch, independent changed-risk QA/CI and guarded installation with rollback. A distinct authenticated finite qualification can follow that acceptance, never as a blind test.
- Stage4 #248 code remains installed; downstream live verification has not been declared DONE because Stage3.2 is still blocked.


## 5. Historical comparison — 15 October vs current native failure

This section supplements the original no-model vendor evidence, **not** a qualification or source/host repair. The exact historical control logs were recovered under the prior runner UID1002, and [Issue #29 comparison checkpoint](https://github.com/anpavel84-afk/gobadminton-clean/issues/29#issuecomment-6377277992) records their hashes and outcomes.

| Property | Issue #37 / PR #45 (15 Oct) | Issue #53 research (15 Oct UTC / 16 Oct Germany local) | Issue #29 failure (23 Oct UTC / 24 Oct Germany local) |
| --- | --- | --- | --- |
| Model | Claude Sonnet 5.5 Medium | Gemini 3.8 Flash Medium | Claude Sonnet 5.5 Medium |
| Unix identity | UID1002 (agentagency-dev) | UID1002 (agentagency-dev) | UID978 (gb-slot2) |
| Native executable | `/home/agentagency-dev/.local/bin/agy` | Same UID1002 user CLI | `/opt/gb-slots/runtime/antigravity/agy` (root 0755) |
| CLI version | Onboarding evidence states **1.3.6** | Used 15 Oct user install (1.3.6 onboarding baseline; no per-batch binary digest) | `agy --version` reports **1.4.5**, SHA256 `8af8e7a2...` |
| Arguments (proved) | Exact launch argv NOT SAVED; text prompt expressly forbids tools/commands; structured output saved | `--sandbox --disable-slash-commands --model gemini-3.8-flash-medium --output-format stream-json --json-schema ... --print-timeout 180s -p <prompt>`; no `--agent` | `--sandbox --dangerously-skip-permissions --disable-slash-commands --agent gobadminton-text-review --input-format stream-json --output-format stream-json --add-dir <exact worktree>` |
| Agent, tool execution | CI patch proposed from **supplied text only**; model explicitly stated no tool command run; separate Bridge applied and CI/QA verified | 10 saved batches, **124 real `search_web` ACTIVE events**, no `run_command` | Custom agent `tools:[view_file,run_command]`; real `run_command` ACTIVE→ERROR EACCES |
| External isolation | No current protected Slot2 Landlock evidence; old AppArmor/mount details unretained | No GoBadminton UID978 Landlock; vendor sandbox flag set but web tool does not exercise nested terminal | Existing external Landlock/no_new_privs plus CLI internal sandbox, UID978, AppArmor userns transition |
| What was proved | Useful Sonnet text analysis and subsequent CI patch acceptance, **not** native shell | Search-web provider transport and web tool, **not** native shell | Native command *invocation*, **not** execution or COMPLETE |

Historical artifacts and hashes:
- Onboarding verifier `/home/agentagency-dev/.cache/agy-official-install-20261015/verification.json` SHA256 `23f780c7b56925f369d6ad7bce406cba8ba276f80a7280a891aa9504735b7464`, `uid=1002`, `version=1.3.6`, permission `request-review`.
- Issue37 `/home/agentagency-dev/.cache/gb-autonomy-p0/agy-issue37-ci5/input.txt` starts with *No tools, no filesystem reads/writes, no commands*. `stdout.json` SHA256 `9b4d601c406227467f0ee72dacb014c151d0a4e4b068f6ccab1533c551be5005` returned SUCCESS, self-reported no commands/tests. Final [PR #45](https://github.com/anpavel84-afk/gobadminton-clean/pull/45) SHA `734aaa05d166da4b6a98a4c78d5609471e6257f8`; independent QA PASS and Product CI `38794399754` 7/7 PASS were **separate tools**.
- Issue53 launcher `/home/agentagency-dev/.cache/gb-autonomy-p0/venue-photo-research53.py` and ten preserved `batch-01..10.jsonl` in `venue-photo-research53/` show **124** starts, every terminal status SUCCESS. These were unapproved photo metadata candidates, not image reuse approvals.
- Official GitHub [CLI 1.3.6 release](https://github.com/google-antigravity/antigravity-cli/releases/tag/1.3.6) published 15 Oct, verified `linux_x64.tar.gz` SHA256 `e88ed835cbc4af504f64dfe20175f5572dc2a425dbfa2fcf55c0358bb444d80c`. Privately unpacked under `/root/gb-agy-historical-136-offline` for no-provider comparison only: ELF reports v1.3.6, SHA256 `e14253aa79d4e910cbf8bcb40b68e80f9e85476725e130ed085122c98face92b`. **Historical 15 Oct installed binary SHA was not captured**, so byte-for-byte equivalence to that restored ELF cannot be asserted.
- Current version v1.4.5 was [published 22 Oct](https://github.com/google-antigravity/antigravity-cli/releases/tag/1.4.5); currently identical newer copies at `/home/agentagency-dev/.local/bin/agy` and `/opt/gb-slots/runtime/antigravity/agy` hash `8af8e7a2...` — their *current* equality does not establish the old Oct15 bytes. Both verified vendor ELF versions contain `selfexec.Invocation.Command`, `selfexec.loaderLaunch`, `exebox.(*Box).startSbox`, and `exebox.jailMain` Go symbol names. Thus the selfexec mechanism is **not new to v1.4.5**; release notes 1.4.0–1.4.5 contain other sandbox/Auto changes but do not identify this error as a fixed or introduced regression. Root causality by version is **NOT PROVEN**.
- Additional no-model *negative control*: under UID978, synthetic stricter inner Landlock makes the same absolute `/opt/.../agy` file readable but **omits** its EXECUTE right. Attempted `execve` returns **errno 13 EACCES** on the exact path; this faithfully reproduces the Linux symptom, but is **not evidence** that the proprietary CLI actually installs that exact inner rule. Direct CLI and outer Landlock+userns execution still succeed.
- [Official CLI terminal sandbox contract](https://antigravity.google/docs/sandbox/?tab=cli) documents namespace-based filesystem mounts and that only expressly permitted paths remain visible. Public [vendor issues](https://github.com/google-antigravity/antigravity-cli/issues) have no clearly verified match proving this precise EACCES selfexec path. It requires an upstream no-model `selfexec/exebox` mount/LSM/exec syscall trace and a supported least-privilege fix. **Do not disable `--sandbox`, broaden /opt mount rules, or change AppArmor/host rights without that proof.**

## 6. Exact no-model Go `os/exec` reproducer and technical fork — 24 Oct 2026

**New result:** under the *unchanged*, preexisting GoBadminton `native_guard._landlock` and `no_new_privileges`, **actual UID978/GID968**, a standalone, compiled **Go 1.27.3** reproducer exercises the real Go process API rather than imitating it with Python. Go toolchain was downloaded into an isolated temporary diagnostic directory from official `go.dev` with SHA256 `65efbc80fdc1fa2cd2631cad5b481777a68e8725f34e89f50fc6ac714e379b40`; no system installation or external packages. Diagnostic executable SHA256 `5db1b0b996db49bbb957874f9658bd5e33ff5e97af78d2bb3960fa6dda8c97e2`; **no model or privileged work was invoked**.

Exact Go configuration:

```go
cmd := exec.Command("/opt/gb-slots/runtime/antigravity/agy", "--help")
cmd.SysProcAttr = &syscall.SysProcAttr{
    Cloneflags: syscall.CLONE_NEWUSER | syscall.CLONE_NEWNS,
    UidMappings: []syscall.SysProcIDMap{{ContainerID: 0, HostID: 978, Size: 1}},
    GidMappings: []syscall.SysProcIDMap{{ContainerID: 0, HostID: 968, Size: 1}},
    GidMappingsEnableSetgroups: false,
}
err := cmd.Run() // same `fork/exec /opt/.../agy: permission denied`
```

An independent **targeted syscall trace of that same exact configuration, still subject to the same Landlock**, reproduced the same Go error and identified the precise failing stage:

```text
clone(..., flags=CLONE_PIDFD|CLONE_NEWNS|CLONE_NEWUSER|SIGCHLD, ...) = 1713077
openat(AT_FDCWD, "/proc/1713077/uid_map", O_RDWR) = -1 EACCES (Permission denied)
```

Thus **namespace creation succeeds; the parent cannot open the child's `uid_map`**, even before successfully writing UID/GID mappings, preparing mounts or executing the target ELF. The `fork/exec` error label is misleading if read as `execve(agy)` failing. The Go standard library `syscall/exec_linux.go` writes `/proc/<child>/uid_map`, `setgroups` and `gid_map` from the parent after clone. Existing `native_antigravity.filesystem_roots()` explicitly disallows `/proc` process inspection and the Landlock allowlist has only static `/usr`, selected `/etc`, `/dev`, the candidate worktree, private writable root and AGY ELF. A dynamic `/proc/<child>/uid_map` O_RDWR is **not in those allowances**. This is a demonstrated incompatibility between the current external protection and Go's namespace-UID/GID-mapping code path. No matching AppArmor uid_map DENIED event was found for this diagnostic; other LSM restrictions could independently apply.

**Critical inference limit:** The original Google proprietary `selfexec/exebox` native event reported the *same* `fork/exec agy: EACCES`, but its actual syscall trace has **not** been captured. Therefore this result proves the precise stage for the equivalent **Go os/exec reproducer**, not the exact Google internal implementation. Do not silently relabel it a vendor-confirmed fix or a successful `run_command` invocation.

**Safe-repair decision:** Supporting mapped `CLONE_NEWUSER` through this `os/exec` path requires write access to dynamically named `/proc/<child>/uid_map` (and subsequent `setgroups/gid_map`) or a vendor-supported different initialization mechanism. Adding broad `/proc` allowances or changing Landlock/AppArmor, running unsandboxed, routing through a new helper or moving binaries on speculation violates the approved protected policy. **No in-scope local fix is currently established.** Keep Antigravity `#29` VENDOR HOLD until Google provides a supported inner selfexec trace and compatible least-privilege remedy.

### Official Gemini CLI — alternative qualification assessment, not installation

- The separate **[google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli)** is distributed as `@google/gemini-cli`, whose package declares **Node >=20**. Germany already has Node **v24.21.0**, but **Gemini CLI is not installed**.
- Supported [headless options](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/cli-reference.md): `gemini -p`, `--output-format stream-json`, `--model`, `--approval-mode=plan`, policy engine for exact tools; Gemini's tool is `run_shell_command`, **not** Antigravity's `run_command`.
- [Authentication](https://github.com/google-gemini/gemini-cli/blob/main/docs/get-started/authentication.mdx) in headless mode requires distinct supported API-key or Vertex AI credentials; do **not** reuse Antigravity OAuth tokens. [Gemini sandboxing](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/sandbox.md) may use Docker/Podman/gVisor on Linux; none is implicitly authorized in the protected slot and any nested-sandbox requirements must be assessed independently.
- Existing GoBadminton `core.route`/`stage` allowlists accept only **codex, cursor, agy**. Gemini is **not a drop-in route**. A future qualification, if chosen, should add a restricted adapter to the *same* Actions train, preserve Owner-addressed role grants and immutable source/rules, independently review the CLI supply chain and tool/sandbox security, demonstrate actual allowed tools and denied writes, measure token/cost receipts, then pass scoped independent QA/CI, backup/rollback installation and an exact finite model-qualification grant.
- **In this stage:** assessment only, **no Gemini installation, credential access, model call, new architecture, new grants or product work**. #248 remains downstream of a correctly qualified route, not DONE merely because a new provider is proposed.

[Canonical protected checkpoint and full exact trace summary](https://github.com/anpavel84-afk/gobadminton-clean/issues/29#issuecomment-6377524003).

## Addendum 2026-10-24 — AppArmor profile `gb-agy-runtime` abandoned (Owner decision, Issue #29)

The Stage 3 canary failed with `failed to create PTY: open /dev/ptmx: permission denied` under profile `gb-agy-runtime`. The Owner abandoned the special profile for Antigravity only and rejected piecemeal profile allowances. The AGY adapter now relies on ordinary Unix permissions for the unprivileged slot2 account: UID978, GID968, no supplementary groups, no capabilities, `no_new_privs`, not root, separation of system users, and real file permissions on controller state. Evidence field `filesystem_boundary` is `uid978_unix_permissions_nnp`.

**Owner waiver (not verified safety):** Antigravity (UID978) may read other projects' files, secrets and PROD data on the Owner's server, and the unprivileged account can write world-writable paths owned by other projects. The Owner accepted this explicitly; no chmod/ACL/firewall hardening of other projects is claimed. The success receipt repeats this waiver and does not claim writable or readonly roots (`filesystem_roots_enforced` is false).

**Candidate integrity (detection, not a root-owned checkout).** `gb-slot2` is UID978. The installed receiver creates the QA worktree with `git worktree add --detach` as that user. `slot2_preflight` requires the worktrees directory, `repo/.git` and `repo/.git/objects` to be owned by UID978 with `mode & 077 == 0`. A root-owned tree is not used: git in this adapter refuses it as dubious ownership (`safe.directory` is not set), and the slot preflight would reject it. No `chown` to root is required on the VPS.

The threat covered here is accidental modification (a `run_command`, a test, a generated file). A malicious writer with the same uid is out of scope under the Owner waiver and is named on the receipt as residual risk. `candidate_integrity` is `detected_accidental_modification_only`. There is no `uid978_read_only_foreign_owned_tree` claim.

Before the call the adapter runs `chmod a-w` on the worktree files and directories and leaves the Git metadata directory writable. That is `write_guard=worktree_chmod_a_w_excluding_gitdir`, a guard, not a boundary: the owner can chmod the bits back. Git runs with `GIT_OPTIONAL_LOCKS=0`. The before/after snapshot is taken only after the vendor session has been reaped and, when the host delegates one, the invocation cgroup has no remaining processes. The receipt field `executor_reap` is `cgroup-quiet`, `cgroup-busy` or `cgroup-absent`. A host that does not delegate a cgroup can still return a verdict; a process that has already left the session can write afterwards, and that is the same residual risk, not a boundary. The snapshot is git-native: HEAD equals the requested sha, `git status --porcelain=v1 --ignored --untracked-files=all` is empty, `git diff-index --cached` and `git diff-files` are clean, `git write-tree` matches `HEAD^{tree}`, `git ls-files -s -v` tags are only `H`, file bytes and modes (including `0600` versus `0644` and empty directories) come from one descriptor, and the binding covers config, hooks through a symlink, exclude, alternates and `git config --show-origin --list` (`include.path`, including a leading `~`, `core.hooksPath`, `core.worktree`, `core.fsmonitor`).

**Host step.** Nothing in this adapter changes ownership. The only host action still outstanding is unloading the already loaded AppArmor profile `gb-agy-runtime` with a separate guarded profile-scoped command. Global AppArmor stays untouched. That unload is not part of this change.

The profile source file `scripts/chatops/ops/gb_agy_runtime.apparmor` is removed from the repository. Removing the already loaded profile from the host (profile-scoped only, global AppArmor untouched) is a separate guarded OPS action. The kernel `unprivileged_userns` restriction remains global; whether the vendor `run_command` needs a user namespace is settled only by the next canary.
