# GoBadminton public Runner Monitor — two simultaneous process cards (v001)

**Status:** Owner-requested read-only presentation improvement; source and synthetic QA, then separately verified public-monitor HTML replacement. Not a Runner scheduler repair.

## Source authority

This directory preserves the **actual Moscow public monitor** HTML rather than overwriting the older Germany dashboard variant.

- Canonical source: `_automation/gobadminton-runner/vps/public-monitor/dashboard.html`
- Moscow serving file: `/srv/gobadminton-runner-monitor/dashboard.html`
- Moscow service `gobadminton-runner-monitor.service` serves static UI through `gobadminton.ru/runner-monitor/`; nginx proxies to `127.0.0.1:17651`.
- Snapshot endpoint: existing read-only `GET /runner-monitor/api/status`. It already provides `runner.active[]`, `runner.max_parallel` and `progresses[task_id]`.
- Germany canonical dashboard/runner runtime, private Owner Controls and current public monitor's remaining pipeline are separate and **unchanged**.
- Previous Moscow dashboard file digest (SHA-256): `00a82c08256337841ab0ac052052ebb60686b06b13825d2fd463e8b75926c1b4`, 52,385 bytes.
- Candidate two-lane dashboard digest (SHA-256): `d1c112f1fda7877b0e508d257e646629609abe0d0ab542e8c360fd08997d5faf`, 59,563 bytes, Git blob `83bf813d32fc50de5873435818bc3af58b056de1`.

## Behavior

- When `runner.active` has two members, show **two full cards side by side** on desktop and stacked at width <=980px. Each card has its own task title/description, executor/model/effort, exact PID-independent task ID, attempt, current block, progress bars, full list of blocks and last update time.
- Prefer the `web` lock on the left if one is present; otherwise preserve live array ordering.
- If only one claim is active, show it and a truthful **Free slot** placeholder. At zero active claims, retain the legacy Now Playing fallback and Next Planned view.
- Use `progresses[active.id]` for each independently; never use `runner.current` as the second task's progress. `runner.current` remains used only as a compatibility view for the older Current Delivery Flow panel.
- Keep both live tasks marked RUNNING in Priority Pipeline and exclude both from Next Planned/Held. Preserve the existing Next Planned card, Current Delivery Flow, backlog, Runtime/Owner Controls, and read-only view.
- Escape all task-generated titles, block text and states before HTML rendering. No new endpoints, scripts from third parties, REST control actions, log/secret access, new authentication bypass or changes to public telemetry fields.
- Refreshed through the existing 4-second polling.

## Source-only checks

```sh
node --check _automation/gobadminton-runner/vps/public-monitor/tests/dual-lanes-verify.cjs
node _automation/gobadminton-runner/vps/public-monitor/tests/dual-lanes-verify.cjs
```

Test cases: two simultaneous claims with distinct block progress, 2/2 status and correct pipeline; one claim + free slot; zero claim legacy fallback; escaped untrusted task title; missing second progress must not copy first. Mock DOM and API snapshots, **not** physical Safari/Chromium visual acceptance.

## Deployment verification / rollback (separate operational effect)

At exact released source candidate, with no competing writer on the public monitor HTML:

1. Verify published source blob matches local candidate (`git hash-object`) and the existing Moscow HTML still matches expected prior SHA-256. Stop on drift.
2. Preserve previous file as timestamped mode 0644 root-owned backup outside public paths.
3. Atomic replacement: same-filesystem candidate mode 0644 root-owned and rename onto `/srv/gobadminton-runner-monitor/dashboard.html`. Do not restart Runner, autopilot, nginx or unrelated processes. The public-monitor service reads the file per GET.
4. Check `GET https://gobadminton.ru/runner-monitor/` returns 200 and exact candidate source content/digest. Check `GET .../api/status` still returns healthy/read-only, `runner.active` two members and distinct `progresses`. Compare privacy headers/Owner Controls status. Do not claim a current user-visible task is definitely RUNNING if the snapshot is stale (>90 seconds).
5. In browser (when available) visually check wide and mobile layout. If JS/HTTP/visual smoke fails, **restore exact timestamped backup atomically** and verify public original checksum. No change to task receipts/history/runtime state.

Deployment is a read-only monitor UI operation only. No application/production release authority or other-project VPN access is implied.
