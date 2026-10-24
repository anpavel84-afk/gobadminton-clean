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
