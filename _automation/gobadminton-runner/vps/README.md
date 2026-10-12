# GoBadminton Germany VPS execution host

This directory contains the reproducible VPS-native execution transport.

Runtime layout:
- repo: `/srv/gobadminton-dev/repo`
- worktrees: `/srv/gobadminton-dev/worktrees`
- runner state: `/srv/gobadminton-dev/runner`
- local PLAN recovery artifacts: `/srv/gobadminton-dev/plan-artifacts`

The live backend tree `/srv/gobadminton` is not the development checkout and is never a writable runner workspace.

The runner supports task-level fields:
- `executor`: `cursor` or `codex`
- `model`: optional provider model
- `effort`: optional `low|medium|high|xhigh`
- `sandbox`: `workspace` (default) or explicitly admitted `full`

Default is Cursor AUTO. Codex is selected intentionally per task. If a Codex task omits `model`, the VPS runner fails safe to configured `codex_default_model` (`gpt-6-sol`); PM/autopilot should still set an explicit model. Use `gpt-6-luna` for mechanical work, `gpt-6-sol` for ordinary engineering/review, and `gpt-6-astra` only when the task explicitly justifies the extra reasoning cost.

Cursor/Codex sessions run in their own process groups. After the CLI exits, the runner/autopilot terminates any remaining helper process group (for example Cursor `worker-server`) so a stale language/worker helper cannot hold the single-writer gate.

On the current Ubuntu/AppArmor host, Cursor's native user-namespace sandbox is unavailable. Normal `sandbox=workspace` Cursor tasks therefore run in **force-approved headless + sandbox disabled** mode under the dedicated non-root execution user. Interactive Auto-review is intentionally not used for the continuous train because an unattended classifier approval prompt must never become a publication gate. `sandbox=full` remains an explicit exceptional admission. Set `cursor_workspace_mode=native_sandbox` only after a verified native-sandbox preflight succeeds.

Git-native transport is sufficient: pushed branch + immutable SHA + durable handoff. GitHub API / PR creation is optional. QA must bind an exact SHA; merge remains separate from deployment.

Services:
- `gobadminton-runner.service`
- `gobadminton-autopilot.service`
- `gobadminton-dashboard.service`
- `gobadminton-monitor-push.service`

Dashboard/monitor:
- local read-only status API: `http://127.0.0.1:17650/api/status`;
- `monitor_push.py` sends that status to the existing Moscow HTTPS ingest endpoint;
- runtime credential file: `/srv/gobadminton-dev/runner/monitor-push-credentials.txt`;
- the credential is a runtime secret and MUST NOT be committed to GitHub;
- monitor transport is observability only and grants no execution/deploy authority.

Both services run as a non-root execution identity and survive reboot. `prod_authorized=false` is mandatory.

## Codex CLI launch compatibility

On installed Codex CLI 0.155.1, `--approve-for-me` already selects the workspace-write sandbox and cannot be combined with explicit `--sandbox workspace-write`. The VPS runner therefore uses `--approve-for-me` alone for normal Codex workspace tasks and closes executor stdin with DEVNULL so headless systemd launches cannot wait on inherited input.

Three pre-fix S-00A re-QA launches exited at argument parsing before task execution or receipt creation; they are infrastructure launch failures, not QA/product repair attempts.

## Cursor to Codex infrastructure failover

The VPS runner can fail over a Cursor-assigned task to Codex within the same
task and repair attempt when Cursor cannot produce a valid receipt because of
executor infrastructure: quota or usage exhaustion, authentication failure,
rate limiting, service/network failure, missing CLI, sandbox launch failure,
or any non-zero Cursor exit without a valid receipt.

A valid Cursor receipt always wins. Semantic product or QA FAIL/BLOCKED
receipts are never reinterpreted as an executor outage.

Runtime knobs:
- cursor_failover_enabled = true
- cursor_failover_codex_model = gpt-6-sol
- cursor_failover_codex_effort = high

Failover preserves source prompt, task id, receipt path, sandbox scope and the
single-writer lock. Later bounded repair attempts for that same task stay on
Codex, avoiding repeated probes of an exhausted Cursor account. The next
independent Cursor task may probe Cursor again.

## PM autopilot planner executor

The PM autopilot planner can use Codex GPT-6.1 Sol/high when Cursor usage is exhausted, so queue transitions do not depend on Cursor availability.

## Continuous train repair v001 (candidate; requires independent QA/install)

Managed PM planner exemption requires cwd `worktrees/pm-autopilot`, an ancestor
executing the exact development `runner/autopilot.py`, an explicit command workspace matching the PM worktree, and that ancestor's cgroup
exactly `/system.slice/gobadminton-autopilot.service`. Missing proof blocks like any external
GoBadminton Codex/Cursor. Queue executor PIDs always block. This is Linux/service
identity proof; manually launched planners receive no exemption.

Terminal BLOCKED is immutable. `retry-blocked` refuses to delete its receipt or
history. An explicit failed GoBadminton receipt with matching task ID,
`owner_blocker=false` and `blocker_scope=lane_local` permits PM planning at a
blocked safe boundary. Absent/unknown scope, Owner blockers, state `global_gates`,
`project_global_blocker`, or project-global/Owner `gate_wait` remain hard stops.
An alive terminal executor also prevents recovery.

PM disables the blocked task in canonical backlog with its terminal status,
pushes main and atomically syncs runtime backlog. A successful planner receipt
(action `quarantined`, `enqueued`, `merged_and_enqueued`, or `merged`) includes
`result_commit` (full published main SHA). Autopilot writes `blocked-release.json`
with the exact original `blocked` snapshot and SHA. Only runner releases state:
it verifies remote main SHA, exact canonical/runtime backlog equality and disabled
terminal entry, appends a release audit snapshot, then clears `current`/`blocked`.
Receipt/history/attempts remain intact; old task IDs cannot be queued again.
All normal task gates still apply. Remote/head mismatch fails closed; PM can
reconcile publication in a later bounded cycle. Old scope-less receipts stay held;
do not retroactively edit terminal evidence to invent a lane scope.

Monitor progress is active only for matching running/blocked `current.id`;
idle/planning shows no stale completed bar. Recent history publishes only safe
ID/status/time metadata. Owner/planner note redaction remains unchanged.
