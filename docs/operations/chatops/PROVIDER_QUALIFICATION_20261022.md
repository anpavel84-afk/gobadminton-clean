# Cursor and Antigravity qualification, 2026-10-22

Status: PARTIAL QUALIFICATION, neither role adapter activated.
Refs #211; Owner explicitly requested Cursor and Antigravity. This record adds no model-author permissions.

## Cursor

Initial CLI 2026.10.01-e373342 failed before inference with sandbox enabled: AppArmor unprivileged_userns denied sys_admin. The approved narrow qualification copies all 460 version files without symlinks to root-owned `/opt/gobadminton-cursor-cli/2026.10.01-e373342`, verifies byte hashes and loads only this attachment:

```text
abi <abi/4.0>,
include <tunables/global>
profile gobadminton_cursor_sandbox /opt/gobadminton-cursor-cli/2026.10.01-e373342/cursorsandbox flags=(default_allow) {
  userns,
}
```

No global sysctl, setuid, capabilities, sandbox-disable or service changes. Helper SHA256 `615ec4dd5ebfbc31868ee7043781a7c060e3909c4f4b085816a1ff5518ad5ef7`; complete root receipt manifest SHA256 `5aa6a2d70ef44363b6651e55d4aadc29f6c886e6f5cbe4720bce1d110c1fa46f`.
One actual UID1002 Auto ask with `--sandbox enabled`, epoch1792701430–1792701447, exit0, exact `CURSOR_READONLY_PROBE_OK`, no stderr. No product assignment was invoked.

Deterministic helper checks then passed with workspace read boundary, no network and explicit runtime readonly paths: public input readable; synthetic outside file and symlink escape denied; SSH directory and root controller state denied; socket creation denied. Workspace readonly denied writes; readwrite allowed only the test write. First diagnostic harness failed on denied socket construction (expected denial, harness corrected); no model inference was repeated. These checks prove the explicitly supplied native helper policy, not that every actual CLI tool is wired to that exact policy.

Root-only receipts: `/var/lib/gobadminton-actions-train/cursor-qualification-20261022/{manifest,probe,boundaries,boundaries-corrected}.json`.

Remaining: enforce and verify the same restrictions for all real CLI tools, credential handling, task path ceilings, exact role and model receipts; independent review; controlled canary through the existing router. Do not enable ADAPTERS merely from this startup PASS.
Rollback of this isolated qualification, when no Cursor process is live: unload this exact profile and remove only the root-owned pinned copy after checking its manifest. Never relax host userns restrictions.

## Antigravity

Previous candidate `9eda3980dfa5d49cd6ebba2c1002c3f3154fff6a` failed independent QA; durable evidence issue #29 comment6200772175. Seven defects: tool authority isolation; argv/stdin/time-unit mismatch; JSON hidden denied operations; incompatible event/result parsing; missing-context false PASS; filename filter false rejection; intended/effective model and policy receipts.
Existing tools-empty agent configuration is not an OS permission boundary; old probes advertised baseline tools and emitted denied tool errors despite final SUCCESS. Native --sandbox help is not proof of complete isolation.

Remaining: exact-SHA public-source-only bundle, isolated home, OS filesystem/network/credential restrictions, complete stream event audit, actual effective model/policy receipts, exact reviewed SHA, fail on missing context or unexpected tools, bounded process-group cleanup. Qualify restricted independent review before lifting the existing author/QA prohibition. Stale agy PID3366685 started Oct19 was neither killed nor reused; no duplicate inference was launched.

## Later actual file-tool trial

UID1002 real Auto canary, epoch1792702659–1792702692: exit0, empty stderr; allowed README read and output.txt edit succeeded, exact `CURSOR_AUTHOR_CANARY_OK` plus newline. Explicit outside read returned Permission denied; edit returned readPermissionDenied. Outside synthetic file unchanged; sandbox/permission fields unchanged. Cursor stream usage: input6767, output520, cacheRead25472, cacheWrite0; no monetary estimate. Full durable receipt: https://github.com/anpavel84-afk/gobadminton-clean/issues/211#issuecomment-6351225134 .

Initial root-readonly CLI config caused pre-inference EACCES on mandatory atomic settings writes; private per-invocation config outside the worktree resolved it without changing global config/auth. This trial proves the explicit tested rules, not generic cross-worktree protection or every shell/network/MCP/plugin path. Outside edit was blocked on pre-read. Router activation remains unclaimed.
