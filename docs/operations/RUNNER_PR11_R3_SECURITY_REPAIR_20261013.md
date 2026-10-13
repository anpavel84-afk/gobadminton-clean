# Runner PR11 · independent R2 findings → bounded R3 repair · 2026-10-13

**Owner requested fully autonomous execution of Friends, Radar map/Germany map hosting and game organizer avatar repair. Execution does not relax QA or privacy safeguards.**

## Real independent review of previous clean SHA

`233f64ef59bef6271e147baa8ad0938440778d3c`, Codex original-host read-only source reviewer, R2 verdict: **FAIL / 3 blocking findings**:
1. `source_qa` and `release_handoff` tasks declared `sandbox=read-only`, but Codex launch used `--approve-for-me` with writable Runner root and worktrees. Declared sandbox != actual sandbox.
2. `_workspace_args` lowercased Codex `-C` and confused lower-case `-c model_reasoning_effort=...` with filesystem path, causing false external-writer holds.
3. Control Agent changed ROOT path but still targeted legacy `gobadminton-runner.service` and other legacy/missing units, risking wrong service restart if later enabled.

## Exact R3 scoped source repair

- `runner.py` now launches Codex read-only QA with **actual `--sandbox read-only`**, without `--approve-for-me` or any `--add-dir`. The model cannot write workspace files. The independent Codex host CLI can save only the final **raw JSON answer** to a task-ID validated, Runner-owned fixed `receipts/<id>.json` via `--output-last-message`; custom redirect paths and unsafe IDs are refused. It is not root-signed evidence: downstream `test_job_contract`, independent reviewer and source bindings remain necessary. Cursor read-only task launch denied unless a separately verified executor is available.
- Correct `_workspace_args` case handling: exact `-C` only, plus `--cd`, `--workspace`; lowercase `-c` is never a filesystem target.
- `control_agent.py` restart/watchdog targets only **`gobadminton-clean-runner.service`** with explicit allowlist; legacy and uncommissioned clean Autopilot/dashboard/monitor services are refused before systemctl. Root now uses correct existing Python venv; old Moscow Owner control endpoint is deliberately unset and fail-closed until a new trusted clean endpoint is commissioned.
- New test `test_qa_pr11_sandbox_control_r3_v001.py` proves real CLI arguments from `launch_agent`, receipt path constraints, Cursor refusal, regular implementation workspace-mode, `-C/-c` parser, legacy unit denial without systemctl and no legacy owner endpoint.
- Scope additive changes: `runner.py`, `control_agent.py`, one targeted regression, CI test inclusion and this receipt. **No Runner/Publisher/Autopilot activation or data mutation by this source repair.**

## Actual original-host test

Isolated Germany staged clean source: **43/43 scoped Python unittest PASS**, including previous 34 and 9 newly introduced, `exit0`; log SHA256 `aec267459fd3a6fcd75ac80f9a3778f6515bd32d9cc57596213bcd4fb8c8032e`. Compile PASS. This is author/operator test execution, **NOT independently accepted R3**.

Historical accepted legacy PR230 source R2 22/22 and new clean R1/R2 failures remain as separate facts. **Next:** independent read-only R3 review on new PR11 SHA, GitHub CI, root-protected issuance and single-writer/Owner-bound canonical task admission. Only then start Friends #12; next Radar #13, Germany map assets #14, organizer avatar fix #15. No PROD release or legacy 551 task import.
